'use strict';
const fs = require('fs');
const path = require('path');
/**
 * Task visibility (owner's rule, Alen Juginović, 25 Sept 2026):
 *   "I would only like the person who is tagged in it to actually see these stuff ...
 *    because some of it's gonna be personal."
 *
 * A project_tasks row is visible ONLY to
 *   (a) its creator  : project_tasks.created_by = the caller's users.id, and
 *   (b) its assignee : project_tasks.assigned_to is ANY team_members row whose user_id is the
 *                      caller (joined on user_id, never a cached member id, so duplicate member
 *                      rows still match).
 * A subtask follows its parent task. There is NO founder, president or section override.
 * A task the caller cannot see answers exactly like a missing one (same 404, same body) on reads
 * AND writes, so its existence never leaks. Reassigning a task moves visibility with it.
 *
 * Both portals read the same database, so every task reader in both servers goes through here,
 * and so does every side channel that used to carry task text (Action Center nudges, the audit
 * feed, the tech DB tools): see the helpers at the bottom.
 */

const TASK_404 = 'That task is not here.';

// Action Center (nag_items) kinds whose subject_id is a project_tasks id and whose title carries
// the task title.
const TASK_NAG_KINDS = new Set(['task_overdue', 'task_due_soon']);

const NO_USER = '__task_visibility_no_user__'; // never equals a stored id, so a caller without an id sees nothing

/**
 * SQL fragment + params that keep only the rows of `alias` (a project_tasks alias in the caller's
 * FROM clause) the user may see. Always alias the outer project_tasks table.
 *   const v = visibleTaskSql('pt', req.user.id);
 *   query.all(`SELECT pt.* FROM project_tasks pt WHERE pt.project = ? AND ${v.sql}`, [p, ...v.params]);
 */
function visibleTaskSql(alias, userId) {
    const a = alias || 'pt';
    const uid = userId == null || userId === '' ? NO_USER : userId;
    return {
        sql: `EXISTS (SELECT 1 FROM project_tasks vis_top
                WHERE vis_top.id = COALESCE(NULLIF(${a}.parent_id, ''), ${a}.id)
                  AND (vis_top.created_by = ?
                       OR vis_top.assigned_to IN (SELECT vis_tm.id FROM team_members vis_tm WHERE vis_tm.user_id = ?)))`,
        params: [uid, uid]
    };
}

/**
 * The task row when the user may see it, else null (identical for "missing" and "not yours").
 * `get(sql, params)` is the caller's synchronous single-row reader (query.get).
 */
function findVisibleTask(get, userId, taskId) {
    if (!taskId) return null;
    const v = visibleTaskSql('t', userId);
    try {
        return get(`SELECT t.* FROM project_tasks t WHERE t.id = ? AND ${v.sql}`, [taskId, ...v.params]) || null;
    } catch (e) { return null; }
}

/** An Action Center item is visible unless it is about a task the user may not see. */
function nagItemVisible(get, userId, item) {
    if (!item) return false;
    if (!TASK_NAG_KINDS.has(item.kind)) return true;
    return !!findVisibleTask(get, userId, item.subject_id);
}

// ---- Side channels: places outside project_tasks where task text used to land ----
//
// The Action Center nudge is a direct message sent as 'admin', and the shared admin inbox shows
// every admin-sent message to every admin. So a task nudge carries NO task text (no title, no due
// date): the assignee opens their own task list to see which task it is.
const TASK_REMINDER_TITLE = 'Task reminder';
const TASK_REMINDER_BODY = 'A task assigned to you needs your attention. Open your tasks in the Med&X portal to see which one.';

/**
 * Nudges sent before 25 Sept 2026 stored the task title and due date in the message. Anyone but
 * the sender and the receiver reads the neutral text instead. Read-time only: stored rows are
 * never rewritten here (redacting them in the database is the owner's call).
 */
function redactTaskReminderDm(row, userId) {
    if (!row || row.sender_type !== 'admin' || row.title !== TASK_REMINDER_TITLE) return row;
    if (userId && (row.sender_id === userId || row.receiver_id === userId)) return row;
    return { ...row, content: TASK_REMINDER_BODY };
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_NAG_AUDIT_RE = /^task_(overdue|due_soon)\b/;

/**
 * The audit-log feed goes to every admin. Task audit lines now carry only ids; older rows held the
 * task title ('task.create') or named the nudged assignee ('nag.act' on a task item). Those older
 * details are hidden when read. Read-time only, the stored rows are not changed.
 */
function redactAuditRow(row) {
    if (!row || !row.detail) return row;
    const d = String(row.detail);
    if (row.action === 'task.create' && !ID_RE.test(d.trim())) return { ...row, detail: '(task title hidden)' };
    if (row.action === 'nag.act' && TASK_NAG_AUDIT_RE.test(d)) return { ...row, detail: 'task item -> assignee nudged' };
    return row;
}

/**
 * Tech DB tools (behind TECH_PASSWORD) read raw rows. Tables that carry task text keep only the
 * rows the caller may see. Returns { sql, params } to AND into a WHERE clause on `alias` (the
 * table's alias in the caller's FROM), or null when the table carries no task text.
 * `user` is req.user ({ id, email }).
 */
function techRowScope(table, alias, user) {
    const a = alias;
    const uid = user && user.id ? user.id : NO_USER;
    const email = user && user.email ? String(user.email).toLowerCase() : NO_USER;
    const taskKinds = [...TASK_NAG_KINDS].map((k) => `'${k}'`).join(',');
    const viaTask = (col, inner) => {
        const v = visibleTaskSql(inner, uid);
        return { sql: `EXISTS (SELECT 1 FROM project_tasks ${inner} WHERE ${inner}.id = ${a}.${col} AND ${v.sql})`, params: v.params };
    };
    switch (table) {
        case 'project_tasks':
            return visibleTaskSql(a, uid);
        case 'task_files':
            return viaTask('task_id', 'scope_t');
        case 'nag_items': {
            const v = viaTask('subject_id', 'scope_t');
            return { sql: `(${a}.kind NOT IN (${taskKinds}) OR ${v.sql})`, params: v.params };
        }
        case 'direct_messages':
            return { sql: `NOT (${a}.sender_type = 'admin' AND ${a}.title = ? AND COALESCE(${a}.sender_id,'') <> ? AND COALESCE(${a}.receiver_id,'') <> ?)`,
                params: [TASK_REMINDER_TITLE, uid, uid] };
        case 'push_outbox':
            return { sql: `NOT (${a}.title = ? AND LOWER(COALESCE(${a}.target_email,'')) <> ?)`, params: [TASK_REMINDER_TITLE, email] };
        case 'scheduled_emails': // the daily digest lists the recipient's own task titles
            return { sql: `NOT (${a}.source_engine = 'nag-digest' AND LOWER(COALESCE(${a}.recipient_email,'')) <> ?)`, params: [email] };
        case 'audit_log':
            return { sql: `NOT ((${a}.action = 'task.create' OR (${a}.action = 'nag.act' AND ${a}.detail LIKE 'task\\_%' ESCAPE '\\')) AND COALESCE(${a}.actor_id,'') <> ?)`,
                params: [uid] };
        default:
            return null;
    }
}

// ---- Task files: never served statically ----
// uploads/tasks/* is blocked on the public /uploads mount of both servers; the bytes go out only
// through GET /api/tasks/files/:fileId/download, which checks the rule on every request, so a
// reassignment revokes a former assignee's access and a bare URL is worth nothing.

/** True when an /uploads request path points into uploads/tasks (decoded, normalised, any case). */
function isTaskUploadPath(reqPath) {
    let p = String(reqPath || '');
    try { p = decodeURIComponent(p); } catch (e) { return true; } // malformed escape: refuse
    p = path.posix.normalize('/' + p.replace(/\\/g, '/')).toLowerCase();
    return p === '/tasks' || p.startsWith('/tasks/');
}

/** Absolute path of a task_files row on this server's disk, or null. */
function taskFileOnDisk(file, uploadsDir) {
    if (!file) return null;
    const candidates = [];
    if (file.filename) candidates.push(path.join(uploadsDir, 'tasks', path.basename(String(file.filename))));
    if (file.file_path) candidates.push(String(file.file_path));
    for (const c of candidates) {
        try { if (fs.statSync(c).isFile()) return c; } catch (e) { /* not on this server's disk */ }
    }
    return null;
}

module.exports = {
    TASK_404, TASK_NAG_KINDS, TASK_REMINDER_TITLE, TASK_REMINDER_BODY,
    visibleTaskSql, findVisibleTask, nagItemVisible,
    redactTaskReminderDm, redactAuditRow, techRowScope,
    isTaskUploadPath, taskFileOnDisk
};
