'use strict';
/**
 * shared/task-visibility.js — WHO MAY SEE A TASK. The one rule, used by every reader of
 * project_tasks in both portals (admin-portal/backend/v2/tasks.js, admin-portal/backend/server.js,
 * user-portal/backend/server.js).
 *
 * Alen, 25 Sept 2026: "for the tasks part, I would only like the person who is tagged in it to
 * actually see these stuff. So not everyone to see everything but if Laura tags me I only see that
 * task … because some of it's gonna be personal."
 *
 * A task is visible ONLY to
 *   (a) its creator   — project_tasks.created_by = the caller's users.id, and
 *   (b) its assignee  — project_tasks.assigned_to is a team_members row whose user_id is the caller
 *                       (joined on user_id every time, never a cached member id, so a second team
 *                       row for the same account still matches).
 * No founder or section override. A subtask follows its top-level parent. A row whose parent is
 * itself a subtask, or whose parent is gone, is visible to nobody (fail closed). Reassigning a
 * task moves it: the old assignee loses it unless they created it.
 *
 * Callers answer a non-participant exactly as they answer a missing task (same status, same body),
 * so a task's existence never leaks.
 */

const TASK_NAG_KINDS = ['task_overdue', 'task_due_soon'];

/**
 * SQL fragment that is true when the project_tasks row aliased `alias` is visible to `userId`.
 * Returns { sql, params } — splice `sql` into a WHERE clause and its `params` into the bind list at
 * the same position. With no user id it is the constant false ('0'), never a match on ''.
 */
function visibleTaskSql(alias, userId) {
    const a = String(alias || 'pt');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) throw new Error('task-visibility: bad alias');
    const uid = userId == null ? '' : String(userId);
    if (!uid) return { sql: '0', params: [] };
    return {
        sql: `EXISTS (SELECT 1 FROM project_tasks vis_root
                      WHERE vis_root.id = COALESCE(NULLIF(${a}.parent_id, ''), ${a}.id)
                        AND (vis_root.parent_id IS NULL OR vis_root.parent_id = '')
                        AND (vis_root.created_by = ? OR vis_root.assigned_to IN (SELECT vis_tm.id FROM team_members vis_tm WHERE vis_tm.user_id = ?)))`,
        params: [uid, uid]
    };
}

/**
 * The project_tasks row `taskId` when `userId` may see it, else null (missing and hidden look the
 * same). `get(sql, params)` is the caller's synchronous single-row reader. `columns` defaults to *.
 */
function visibleTaskRow(get, userId, taskId, columns) {
    if (!taskId) return null;
    const v = visibleTaskSql('pt', userId);
    try { return get(`SELECT ${columns || 'pt.*'} FROM project_tasks pt WHERE pt.id = ? AND ${v.sql}`, [String(taskId), ...v.params]) || null; }
    catch (e) { return null; }
}

/** True when `userId` may see task `taskId`. */
function canSeeTask(get, userId, taskId) { return !!visibleTaskRow(get, userId, taskId, 'pt.id'); }

/**
 * The task_files row `fileId` when `userId` may see the task it hangs on, else null.
 */
function visibleTaskFile(get, userId, fileId) {
    if (!fileId) return null;
    const v = visibleTaskSql('pt', userId);
    try { return get(`SELECT f.* FROM task_files f JOIN project_tasks pt ON pt.id = f.task_id WHERE f.id = ? AND ${v.sql}`, [String(fileId), ...v.params]) || null; }
    catch (e) { return null; }
}

/**
 * Action Center (nag_items) rows: a task nag carries the task title, so it is shown only to the
 * people who may see that task. Non-task nags pass through untouched. Returns { sql, params } for a
 * WHERE clause over nag_items aliased `alias`.
 */
function visibleNagSql(alias, userId) {
    const a = String(alias || 'nag_items');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) throw new Error('task-visibility: bad alias');
    const v = visibleTaskSql('nag_pt', userId);
    return {
        sql: `(${a}.kind NOT IN (${TASK_NAG_KINDS.map(() => '?').join(',')})
               OR EXISTS (SELECT 1 FROM project_tasks nag_pt WHERE nag_pt.id = ${a}.subject_id AND ${v.sql}))`,
        params: [...TASK_NAG_KINDS, ...v.params]
    };
}
const isTaskNag = kind => TASK_NAG_KINDS.includes(String(kind || ''));

/**
 * Tables whose rows carry task content (titles, descriptions, results, comments, files, Action
 * Center task titles), and the demo-purge backups of them (_purged_<table>). Whole-table readers
 * that cannot apply the rule row by row (the tech table browser and JSON export) never hand these out.
 */
const TASK_PRIVATE_TABLES = ['project_tasks', 'task_files', 'v2_task_comments', 'nag_items'];
const baseTable = name => String(name || '').toLowerCase().replace(/^_purged_/, '');
function isTaskPrivateTable(name) { return TASK_PRIVATE_TABLES.includes(baseTable(name)); }

// ---- side channels: places outside project_tasks where task text used to land ----
const checkAlias = (a) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) throw new Error('task-visibility: bad alias'); return a; };

/**
 * The Action Center nudge is a direct message sent as 'admin' (and a push). Every admin reader of
 * direct_messages (Messages, a thread, the Inbox threads, the registrant timeline, the reply
 * drafter) shows admin-sent rows to every admin, so a task nudge names no task (no title, no due
 * date: the assignee opens their own board), and those readers return a nudge only to its sender
 * and its receiver: even a neutral one says "this person was nudged about a task". Nudges sent
 * before 25 Sept 2026 stored the task title; they are hidden at read time, never rewritten.
 */
const TASK_REMINDER_TITLE = 'Task reminder';
const TASK_REMINDER_BODY = 'A task on your board needs your attention. Open your tasks in the Med&X admin portal to see which one.';

/**
 * SQL over direct_messages aliased `alias` that drops the task nudges `userId` is not a party to.
 * With no user id it drops every task nudge (a Claude prompt never gets one).
 */
function taskReminderDmScope(alias, userId) {
    const a = checkAlias(String(alias || 'direct_messages'));
    const uid = userId == null ? '' : String(userId);
    return {
        sql: `NOT (COALESCE(${a}.sender_type,'') = 'admin' AND COALESCE(${a}.title,'') = ?
                   AND (? = '' OR (COALESCE(${a}.sender_id,'') <> ? AND COALESCE(${a}.receiver_id,'') <> ?)))`,
        params: [TASK_REMINDER_TITLE, uid, uid, uid]
    };
}

/**
 * The audit feed goes to every admin. A row about a task (task.*, and the Action Center's actions
 * on a task item: new rows start with the item kind, older nudge rows named the assignee and older
 * done rows said "(+task completed)") is returned only to the admin who did it. SQL over audit_log
 * aliased `alias`; with no user id it drops every such row.
 */
function taskAuditScope(alias, userId) {
    const a = checkAlias(String(alias || 'audit_log'));
    const uid = userId == null ? '' : String(userId);
    const about = `(COALESCE(${a}.action,'') LIKE 'task.%'
                    OR (COALESCE(${a}.action,'') LIKE 'nag.%' AND (COALESCE(${a}.detail,'') LIKE 'task\\_%' ESCAPE '\\'
                                                                  OR COALESCE(${a}.detail,'') LIKE '%(+task completed)%')))`;
    return { sql: `NOT (${about} AND (? = '' OR COALESCE(${a}.actor_id,'') <> ?))`, params: [uid, uid] };
}

/**
 * The tech DB tools (behind TECH_PASSWORD) read raw rows: a table of task content is never handed
 * out (isTaskPrivateTable), and a table that holds task side-channel rows among everything else keeps
 * only the caller's: their own nudges and pushes, their own daily digest, their own task audit rows.
 * Returns { sql, params } for a WHERE over `alias`, or null when the table carries no task text.
 * `user` is req.user ({ id, email }).
 */
function techRowScope(table, alias, user) {
    const a = checkAlias(String(alias || 't'));
    const uid = user && user.id ? String(user.id) : '';
    const email = user && user.email ? String(user.email).trim().toLowerCase() : '';
    switch (baseTable(table)) {
        case 'direct_messages': return taskReminderDmScope(a, uid);
        case 'push_outbox':
            return { sql: `NOT (COALESCE(${a}.title,'') = ? AND (? = '' OR LOWER(COALESCE(${a}.target_email,'')) <> ?))`, params: [TASK_REMINDER_TITLE, email, email] };
        case 'scheduled_emails':   // the daily digest is one person's own list
            return { sql: `NOT (COALESCE(${a}.source_engine,'') = 'nag-digest' AND (? = '' OR LOWER(COALESCE(${a}.recipient_email,'')) <> ?))`, params: [email, email] };
        case 'audit_log': return taskAuditScope(a, uid);
        default: return null;
    }
}

module.exports = {
    visibleTaskSql, visibleTaskRow, canSeeTask, visibleTaskFile, visibleNagSql, isTaskNag, TASK_NAG_KINDS,
    TASK_PRIVATE_TABLES, isTaskPrivateTable,
    TASK_REMINDER_TITLE, TASK_REMINDER_BODY, taskReminderDmScope, taskAuditScope, techRowScope
};
