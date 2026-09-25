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
 *   (b) its people    — project_tasks.assigned_to (the first person tagged) or any team_members row
 *                       tagged on it in v2_task_people, whose user_id is the caller (joined on user_id
 *                       every time, never a cached member id, so a second team row for the same
 *                       account still matches).
 * No founder or section override. A subtask follows its top-level parent. A row whose parent is
 * itself a subtask, or whose parent is gone, is visible to nobody (fail closed). Taking someone off a
 * task moves it away from them: they lose it unless they created it.
 *
 * MORE THAN ONE PERSON (Alen, 25 Sept 2026: "in tasks please let us tag more than one person"):
 * v2_task_people (task_id, member_id → team_members.id, added_by, added_at) holds everyone tagged.
 * project_tasks.assigned_to stays the FIRST of them (Today, Calendar, the nag scan and every legacy
 * reader keep working) and every write in this tree keeps it in the tag rows too.
 * The old portals (main) share the database and know one person per task: they write assigned_to
 * alone. A trigger in the database (ensureTaskPeopleTable) turns such a write into what it means there,
 * "this task is now this one person's": when assigned_to changes and either the new person is not
 * tagged or the previous first person still is (so the write did not come through setTaskPeople,
 * which always takes the previous first person off before it promotes the next), every other tag row
 * of the task is deleted at once and the new person's row is written. Nobody is left dormant, so a
 * later move back never hands the task to people who were taken off it.
 * Second line of defence (a database without the trigger, a hand edit): a tag row counts only while
 * the task's assigned_to is among its tag rows; otherwise the task is its one assignee's. And every
 * boot deletes such stale rows (and the rows of tasks that are gone), so a set that went stale before
 * the trigger existed can never be revived by a later move back either. It only deletes rows the rule
 * already ignores (nothing anyone sees changes); there is never a boot backfill that adds rows.
 *
 * Callers answer a non-participant exactly as they answer a missing task (same status, same body),
 * so a task's existence never leaks.
 */

const TASK_NAG_KINDS = ['task_overdue', 'task_due_soon'];
const MAX_TASK_PEOPLE = 12;
const aliasOk = (a) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) throw new Error('task-visibility: bad alias'); return a; };

// the tag rows of task row `a` are live: its assigned_to is one of them (see MORE THAN ONE PERSON —
// the trigger keeps this true; the check is the fallback if a database ever lacks it)
const livePeopleSql = (a, p) => `EXISTS (SELECT 1 FROM v2_task_people ${p} WHERE ${p}.task_id = ${a}.id AND ${p}.member_id = ${a}.assigned_to)`;

/**
 * SQL fragment that is true when the project_tasks row aliased `alias` is visible to `userId`.
 * Returns { sql, params } — splice `sql` into a WHERE clause and its `params` into the bind list at
 * the same position. With no user id it is the constant false ('0'), never a match on ''.
 */
function visibleTaskSql(alias, userId) {
    const a = aliasOk(String(alias || 'pt'));
    const uid = userId == null ? '' : String(userId);
    if (!uid) return { sql: '0', params: [] };
    return {
        sql: `EXISTS (SELECT 1 FROM project_tasks vis_root
                      WHERE vis_root.id = COALESCE(NULLIF(${a}.parent_id, ''), ${a}.id)
                        AND (vis_root.parent_id IS NULL OR vis_root.parent_id = '')
                        AND (vis_root.created_by = ?
                             OR vis_root.assigned_to IN (SELECT vis_tm.id FROM team_members vis_tm WHERE vis_tm.user_id = ?)
                             OR (EXISTS (SELECT 1 FROM v2_task_people vis_tp JOIN team_members vis_tm2 ON vis_tm2.id = vis_tp.member_id
                                         WHERE vis_tp.task_id = vis_root.id AND vis_tm2.user_id = ?)
                                 AND ${livePeopleSql('vis_root', 'vis_tp0')})))`,
        params: [uid, uid, uid]
    };
}

/**
 * True when `userId` is ON the task row aliased `alias` (its first person or a live tag), not merely
 * its creator — the board's MINE filter and the "open for me" badge. Visibility is still visibleTaskSql's.
 */
function onTaskSql(alias, userId) {
    const a = aliasOk(String(alias || 'pt'));
    const uid = userId == null ? '' : String(userId);
    if (!uid) return { sql: '0', params: [] };
    return {
        sql: `(${a}.assigned_to IN (SELECT on_tm.id FROM team_members on_tm WHERE on_tm.user_id = ?)
               OR (EXISTS (SELECT 1 FROM v2_task_people on_tp JOIN team_members on_tm2 ON on_tm2.id = on_tp.member_id
                           WHERE on_tp.task_id = ${a}.id AND on_tm2.user_id = ?)
                   AND ${livePeopleSql(a, 'on_tp0')}))`,
        params: [uid, uid]
    };
}

/** True when team row `memberId` is on the task row aliased `alias` (FOR <NAME>, the daily digest). */
function onTaskMemberSql(alias, memberId) {
    const a = aliasOk(String(alias || 'pt'));
    const mid = memberId == null ? '' : String(memberId);
    if (!mid) return { sql: '0', params: [] };
    return {
        sql: `(${a}.assigned_to = ?
               OR (EXISTS (SELECT 1 FROM v2_task_people om_tp WHERE om_tp.task_id = ${a}.id AND om_tp.member_id = ?)
                   AND ${livePeopleSql(a, 'om_tp0')}))`,
        params: [mid, mid]
    };
}

/**
 * The people on a task, in order (member ids, first person first): `assignedTo` and the task's tag
 * rows (`tagMemberIds`, already in added order). The same rule as the SQL above — no assigned_to means
 * no one; an assigned_to missing from the tag rows means the tag rows are stale and only it counts.
 */
function orderTaskPeople(assignedTo, tagMemberIds) {
    const first = assignedTo == null ? '' : String(assignedTo);
    if (!first) return [];
    const tags = (tagMemberIds || []).map(String);
    if (!tags.includes(first)) return [first];
    return [first, ...tags.filter((m, i) => m !== first && tags.indexOf(m) === i)];
}

// ---- the tag table (created guarded, at boot, by every backend that reads the rule above) ----
function ensureTaskPeopleTable(run) {
    run(`CREATE TABLE IF NOT EXISTS v2_task_people (
        task_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        added_by TEXT,
        added_at TEXT,
        PRIMARY KEY (task_id, member_id)
    )`);
    run('CREATE INDEX IF NOT EXISTS idx_v2_task_people_member ON v2_task_people (member_id)');
    // A one-person write (the old portals on main, or this tree's own v1 routes) that changes assigned_to
    // makes the task that person's alone, inside the database, so no tag row is ever left dormant
    // (see MORE THAN ONE PERSON). setTaskPeople never matches the WHEN: before its UPDATE the new first
    // person is already tagged and the previous first person's row is already gone. A write that leaves
    // assigned_to as it was never fires (a legacy edit that re-sends the first person drops no one).
    run(`CREATE TRIGGER IF NOT EXISTS trg_task_people_one_person_write
        AFTER UPDATE OF assigned_to ON project_tasks
        FOR EACH ROW
        WHEN NEW.assigned_to IS NOT OLD.assigned_to
         AND (NOT EXISTS (SELECT 1 FROM v2_task_people WHERE task_id = NEW.id AND member_id = NEW.assigned_to)
              OR EXISTS (SELECT 1 FROM v2_task_people WHERE task_id = NEW.id AND member_id = OLD.assigned_to))
        BEGIN
            DELETE FROM v2_task_people WHERE task_id = NEW.id AND member_id IS NOT NEW.assigned_to;
            INSERT OR IGNORE INTO v2_task_people (task_id, member_id, added_by, added_at)
                SELECT NEW.id, NEW.assigned_to, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> '';
        END`);
    // stale rows (a set whose assigned_to is not among them, or a task with no one) and the rows of tasks
    // that are gone: the rule above already ignores them; deleted so no later move can revive them
    run(`DELETE FROM v2_task_people
         WHERE task_id NOT IN (SELECT id FROM project_tasks)
            OR task_id IN (SELECT pt.id FROM project_tasks pt
                           WHERE pt.assigned_to IS NULL OR pt.assigned_to = ''
                              OR NOT EXISTS (SELECT 1 FROM v2_task_people tp WHERE tp.task_id = pt.id AND tp.member_id = pt.assigned_to))`);
}

/**
 * Write the people on task `taskId`: exactly `memberIds` (first = assigned_to; [] = no one). Rows for
 * people who stay keep their added_at (so the next one is promoted in the order they were tagged),
 * new rows are inserted in the order given, everyone else's row goes. `run(sql, params)` is the
 * caller's writer. A one-person writer (the v1 routes) passes [newAssignee] when it changes assigned_to.
 * The UPDATE of assigned_to comes last and never trips the one-person trigger (ensureTaskPeopleTable):
 * by then the new first person is tagged and the previous first person's row is gone — when that
 * person stays on in a later place, their row steps aside for the UPDATE and is written again after it.
 */
function setTaskPeople(run, taskId, memberIds, addedBy, nowIso) {
    const ids = [];
    for (const m of memberIds || []) { const s = m == null ? '' : String(m); if (s && !ids.includes(s)) ids.push(s); }
    const now = nowIso || new Date().toISOString();
    const tid = String(taskId);
    if (!ids.length) {
        run('DELETE FROM v2_task_people WHERE task_id = ?', [tid]);
        run('UPDATE project_tasks SET assigned_to = NULL WHERE id = ?', [tid]);
        return ids;
    }
    // one statement, rows in the order given (same added_at, so rowid keeps the order)
    const tagAll = () => run(`INSERT OR IGNORE INTO v2_task_people (task_id, member_id, added_by, added_at) VALUES ${ids.map(() => '(?,?,?,?)').join(',')}`,
        ids.flatMap(m => [tid, m, addedBy || null, now]));
    run(`DELETE FROM v2_task_people WHERE task_id = ? AND member_id NOT IN (${ids.map(() => '?').join(',')})`, [tid, ...ids]);
    tagAll();
    run('DELETE FROM v2_task_people WHERE task_id = ? AND member_id = (SELECT assigned_to FROM project_tasks WHERE id = ?) AND member_id <> ?', [tid, tid, ids[0]]);
    run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', [ids[0], tid]);
    tagAll();   // the previous first person, when they stay on in a later place
    return ids;
}

/** Deleting a task deletes its tag rows and its subtasks' tag rows (call before the project_tasks delete). */
function deleteTaskPeople(run, taskId) {
    run('DELETE FROM v2_task_people WHERE task_id = ? OR task_id IN (SELECT id FROM project_tasks WHERE parent_id = ?)', [String(taskId), String(taskId)]);
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
    const a = aliasOk(String(alias || 'nag_items'));
    const v = visibleTaskSql('nag_pt', userId);
    return {
        sql: `(${a}.kind NOT IN (${TASK_NAG_KINDS.map(() => '?').join(',')})
               OR EXISTS (SELECT 1 FROM project_tasks nag_pt WHERE nag_pt.id = ${a}.subject_id AND ${v.sql}))`,
        params: [...TASK_NAG_KINDS, ...v.params]
    };
}
const isTaskNag = kind => TASK_NAG_KINDS.includes(String(kind || ''));

/**
 * Tables whose rows carry task content (titles, descriptions, results, comments, files, who is on a
 * task, Action Center task titles), and the demo-purge backups of them (_purged_<table>). Whole-table readers
 * that cannot apply the rule row by row (the tech table browser and JSON export) never hand these out.
 */
const TASK_PRIVATE_TABLES = ['project_tasks', 'task_files', 'v2_task_comments', 'v2_task_people', 'nag_items'];
const baseTable = name => String(name || '').toLowerCase().replace(/^_purged_/, '');
function isTaskPrivateTable(name) { return TASK_PRIVATE_TABLES.includes(baseTable(name)); }

// ---- side channels: places outside project_tasks where task text used to land ----
const checkAlias = aliasOk;

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
    onTaskSql, onTaskMemberSql, orderTaskPeople, ensureTaskPeopleTable, setTaskPeople, deleteTaskPeople, MAX_TASK_PEOPLE,
    TASK_PRIVATE_TABLES, isTaskPrivateTable,
    TASK_REMINDER_TITLE, TASK_REMINDER_BODY, taskReminderDmScope, taskAuditScope, techRowScope
};
