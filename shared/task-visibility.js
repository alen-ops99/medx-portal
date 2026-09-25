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

module.exports = { visibleTaskSql, visibleTaskRow, canSeeTask, visibleTaskFile, visibleNagSql, isTaskNag, TASK_NAG_KINDS };
