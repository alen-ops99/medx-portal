'use strict';
const fs = require('fs');
const path = require('path');
/**
 * Task visibility (owner's rule, Alen Juginović, 25 Sept 2026):
 *   "I would only like the person who is tagged in it to actually see these stuff ...
 *    because some of it's gonna be personal."
 *
 * A project_tasks row is visible ONLY to
 *   (a) its creator  : project_tasks.created_by = the caller's users.id,
 *   (b) its assignee : project_tasks.assigned_to is ANY team_members row whose user_id is the
 *                      caller (joined on user_id, never a cached member id, so duplicate member
 *                      rows still match), and
 *   (c) its tagged people (owner request, same day: "let us tag more than one person"): any
 *                      v2_task_people row of the task whose member_id is a team_members row of
 *                      the caller (same user_id join), but ONLY while the tag rows are live, i.e.
 *                      assigned_to is one of them. The redesign portal writes the tag set
 *                      (assigned_to stays its first tagged person). This portal knows one person
 *                      per task, so its writers keep the set to that one person whenever they move
 *                      assigned_to (setTaskPeople below, the same thing the redesign tree's copies
 *                      of these routes do). Tag rows whose assigned_to is missing from them were
 *                      left by a one-person writer that did not do this (an older deploy): they are
 *                      stale and grant nothing, and the task is its one assignee's (fail closed),
 *                      the same rule the redesign applies to the same rows.
 * A subtask follows its parent task. There is NO founder, president or section override.
 * A task the caller cannot see answers exactly like a missing one (same 404, same body) on reads
 * AND writes, so its existence never leaks. Reassigning, unassigning or untagging moves
 * visibility with it: a hand-off on this portal leaves the task to the new person (and its
 * creator) only.
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

// The people tagged on a task (one row per person; assigned_to is always also one of them when the
// redesign writes). Created at boot by BOTH servers next to project_tasks, because every task
// reader below joins it. Same columns as the redesign backend, which shares this database, and no
// foreign keys: whichever service boots first creates it.
const TASK_PEOPLE_DDL = `CREATE TABLE IF NOT EXISTS v2_task_people (
        task_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        added_by TEXT,
        added_at TEXT,
        PRIMARY KEY (task_id, member_id)
    )`;

/**
 * SQL fragment + params that keep only the rows of `alias` (a project_tasks alias in the caller's
 * FROM clause) the user may see. Always alias the outer project_tasks table.
 *   const v = visibleTaskSql('pt', req.user.id);
 *   query.all(`SELECT pt.* FROM project_tasks pt WHERE pt.project = ? AND ${v.sql}`, [p, ...v.params]);
 * Tags are read on the TOP-level task, so a subtask follows its parent's people, and they count
 * only while the top-level task's assigned_to is among them (live tag rows, see (c) above).
 */
function visibleTaskSql(alias, userId) {
    const a = alias || 'pt';
    const uid = userId == null || userId === '' ? NO_USER : userId;
    return {
        sql: `EXISTS (SELECT 1 FROM project_tasks vis_top
                WHERE vis_top.id = COALESCE(NULLIF(${a}.parent_id, ''), ${a}.id)
                  AND (vis_top.created_by = ?
                       OR vis_top.assigned_to IN (SELECT vis_tm.id FROM team_members vis_tm WHERE vis_tm.user_id = ?)
                       OR (EXISTS (SELECT 1 FROM v2_task_people vis_tp
                                   JOIN team_members vis_ptm ON vis_ptm.id = vis_tp.member_id
                                   WHERE vis_tp.task_id = vis_top.id AND vis_ptm.user_id = ?)
                           AND EXISTS (SELECT 1 FROM v2_task_people vis_tp0
                                       WHERE vis_tp0.task_id = vis_top.id AND vis_tp0.member_id = vis_top.assigned_to))))`,
        params: [uid, uid, uid]
    };
}

/**
 * Tag rows to drop when a task is deleted: its own and its subtasks'. Run it BEFORE deleting the
 * project_tasks row (the parent delete cascades the subtasks away, and with them their ids).
 *   db.run(taskVis.FORGET_TASK_PEOPLE_SQL, [id, id]);
 */
const FORGET_TASK_PEOPLE_SQL = 'DELETE FROM v2_task_people WHERE task_id = ? OR task_id IN (SELECT id FROM project_tasks WHERE parent_id = ?)';

/**
 * Write the people on task `taskId`: exactly `memberIds` (first = assigned_to; [] = no one). Rows
 * for people who stay keep their added_at, new rows are inserted in the order given, everyone
 * else's row goes, and assigned_to is set to the first. `run(sql, params)` is the caller's writer.
 * The same function, body and table as the redesign tree's setTaskPeople (the database is shared).
 * This portal is a one-person writer: it passes [assignee] when it creates a task with one, and
 * [newAssignee] (or [] on an unassign) whenever a PUT moves assigned_to, so a hand-off here leaves
 * the task to exactly the new person. A PUT that leaves assigned_to alone never touches the tags.
 */
function setTaskPeople(run, taskId, memberIds, addedBy, nowIso) {
    const ids = [];
    for (const m of memberIds || []) { const s = m == null ? '' : String(m); if (s && !ids.includes(s)) ids.push(s); }
    const now = nowIso || new Date().toISOString();
    if (ids.length) run(`DELETE FROM v2_task_people WHERE task_id = ? AND member_id NOT IN (${ids.map(() => '?').join(',')})`, [String(taskId), ...ids]);
    else run('DELETE FROM v2_task_people WHERE task_id = ?', [String(taskId)]);
    for (const m of ids) run('INSERT OR IGNORE INTO v2_task_people (task_id, member_id, added_by, added_at) VALUES (?,?,?,?)', [String(taskId), m, addedBy || null, now]);
    run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', [ids[0] || null, String(taskId)]);
    return ids;
}

/**
 * A one-person writer moved (or may have moved) assigned_to from `before` to `after`: when it
 * really changed, the tag set becomes exactly the new person ([] when unassigned). Returns true
 * when it rewrote the tags. ('' and null are the same "no one".)
 */
function handOffTaskPeople(run, taskId, before, after, addedBy) {
    const b = before == null ? '' : String(before);
    const a = after == null ? '' : String(after);
    if (a === b) return false;
    setTaskPeople(run, taskId, a ? [a] : [], addedBy);
    return true;
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
 * A task nudge, even a neutral one, says "this person was nudged about a task", so in the admin
 * readers only its sender and receiver see the row at all:
 *   userId given, a party   -> the row as stored
 *   userId given, not party -> null (drop it: `.map(...).filter(Boolean)`)
 *   userId null             -> the row with the neutral body (for a prompt: never task text)
 * Nudges sent before 25 Sept 2026 stored the task title and due date in the message; this is
 * read-time only, stored rows are never rewritten here (redacting them is the owner's call).
 * Every other message passes through unchanged.
 */
function redactTaskReminderDm(row, userId) {
    if (!row || row.sender_type !== 'admin' || row.title !== TASK_REMINDER_TITLE) return row;
    if (userId == null || userId === '') return { ...row, content: TASK_REMINDER_BODY };
    return row.sender_id === userId || row.receiver_id === userId ? row : null;
}

/** SQL (on the direct_messages alias) that drops task nudges the user is not a party to. */
function taskReminderDmScope(alias, userId) {
    const uid = userId == null || userId === '' ? NO_USER : userId;
    return { sql: `NOT (${alias}.sender_type = 'admin' AND ${alias}.title = ? AND COALESCE(${alias}.sender_id,'') <> ? AND COALESCE(${alias}.receiver_id,'') <> ?)`,
        params: [TASK_REMINDER_TITLE, uid, uid] };
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
    // A demo-purge backup (_purged_<table>) carries the same rows as its table, so it gets the same
    // scope. A purged task is gone from project_tasks, so its backup rows are visible to nobody.
    switch (String(table || '').toLowerCase().replace(/^_purged_/, '')) {
        case 'project_tasks':
            return visibleTaskSql(a, uid);
        case 'task_files':
            return viaTask('task_id', 'scope_t');
        case 'v2_task_people': // no text, but "these people are on task X" is the task's own business
            return viaTask('task_id', 'scope_t');
        case 'v2_task_comments': // the redesign's comments and its activity lines ("Laura tagged Alen and Miro")
            return viaTask('task_id', 'scope_t');
        case 'nag_items': {
            const v = viaTask('subject_id', 'scope_t');
            return { sql: `(${a}.kind NOT IN (${taskKinds}) OR ${v.sql})`, params: v.params };
        }
        case 'direct_messages':
            return taskReminderDmScope(a, uid);
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
    TASK_PEOPLE_DDL, FORGET_TASK_PEOPLE_SQL, setTaskPeople, handOffTaskPeople,
    visibleTaskSql, findVisibleTask, nagItemVisible,
    redactTaskReminderDm, taskReminderDmScope, redactAuditRow, techRowScope,
    isTaskUploadPath, taskFileOnDisk
};
