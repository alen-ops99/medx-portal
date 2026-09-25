'use strict';
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
 * Both portals read the same database, so every task reader in both servers goes through here.
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

module.exports = { TASK_404, TASK_NAG_KINDS, visibleTaskSql, findVisibleTask, nagItemVisible };
