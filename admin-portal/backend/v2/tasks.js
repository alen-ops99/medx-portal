/**
 * v2/tasks.js — the shared TASK BOARD (frontend-v2 › js/views/tasks.js, nav item TASKS).
 *
 * Why (Alen, 2026-09-20): he tells Laura tasks, she does them and texts him the result, and the
 * result gets buried ("she found Turkish Airlines flights and I can't find what she found"). A
 * task here is added, worked, and finished WITH THE RESULT attached — text, links, files — and
 * the board is the one place he goes to see what she did.
 *
 * Table: the legacy `project_tasks` (kept — Today, Calendar and the nag digest already read it),
 * with guarded columns added: result_text · result_links (JSON [{url,label}]) · seen_at · seen_by ·
 * updated_at · archived_at. `task_files` is reused for attachments. New: v2_task_comments (kind =
 * 'comment' | 'system' — every write appends a system row, so the drawer's activity log is the
 * full history: "Alen assigned to Laura", "Laura moved to Done").
 *
 * Status vocabulary: todo → doing → done → seen. Legacy values are normalised at load
 * ('open'/'pending' → todo, 'in_progress' → doing, 'completed' → done). `assigned_to` stays a
 * team_members.id (as every legacy reader expects); an admin user without a team_members row can
 * still be picked (`user:<id>`) — the row is created on first assignment.
 *
 * WHO SEES A TASK (Alen, 25 Sept 2026 — "if Laura tags me I only see that task … some of it's gonna
 * be personal"): only its creator and the people on it, through shared/task-visibility.js, on every
 * route below — list, badge, search, detail, every write, comments, files and the legacy surface.
 * Anyone else gets the same 404 / "That task is not here." as a missing task. No founder override.
 * Taking someone off a task moves it away from them: they lose it unless they created it.
 *
 * MORE THAN ONE PERSON (Alen, 25 Sept 2026 — "in tasks please let us tag more than one person"):
 * v2_task_people holds everyone tagged; `assigned_to` stays the first of them (so Today, Calendar,
 * the nag scan and every legacy reader keep working), untagging the first promotes the next one
 * tagged, untagging everyone clears it. A card carries people: [{ id, user_id, name, first }], first
 * person first. MINE, FOR <name> and the badge's assigned_open count every task the person is on.
 *
 * Routes (all auth + adminOnly; /api/v2/tasks is deliberately NOT in SECTION_ROUTE_MAP — every
 * admin has a board, and each board holds only that admin's own tasks):
 *   GET    /api/v2/tasks                       ?assignee=<member id|me|all> &status= &q= &archived=1
 *                                              → { tasks, people, me }
 *   GET    /api/v2/tasks/badge                 → { done_unseen, assigned_open } for the caller
 *   GET    /api/v2/tasks/:id                   → { task, comments, files }
 *   POST   /api/v2/tasks                       { title, description?, assignees?: [member id | 'user:<id>'] (≤ 12) | assigned_to?, due_date?, priority?, project? }
 *   PUT    /api/v2/tasks/:id                   { title?, description?, assignees? | assigned_to?, due_date?, priority?, status? }
 *                                              (assigned_to alone = one person: a different one makes the task theirs alone)
 *   PUT    /api/v2/tasks/:id/result            { result_text?, result_links? }
 *   POST   /api/v2/tasks/:id/seen              → status seen, seen_at/by
 *   POST   /api/v2/tasks/:id/archive · /unarchive
 *   GET    /api/v2/tasks/:id/comments · POST { body }
 *   GET    /api/v2/tasks/:id/files · POST multipart 'file' (≤ 25 MB, any type)
 *   GET    /api/v2/tasks/files/:fid            Bearer (a participant) OR a signed ?exp=&sig= (only a participant is ever handed one) — S3 302 / local stream
 *   DELETE /api/v2/tasks/files/:fid
 *   + the LEGACY surface, re-homed here from server.js so Today/Calendar/v1 keep working on the same rows:
 *   GET/POST /api/admin/tasks · PUT/DELETE /api/admin/tasks/:id   (status reads 'done' for seen rows; archived rows hidden)
 *
 * Files: S3 (the BB_S3_* bucket + SigV4 helper the Boston wing owns, under tasks/<task>/) when
 * configured — the Render service has no disk, so local files would vanish on redeploy; otherwise
 * the same uploads root inbox.js uses (user-portal/backend/uploads/tasks). Emails (sendEmail, team
 * only — recipients must be admin users, never guests): on tagging → each person newly tagged (never
 * someone already on it); on done → the creator, result quoted. Nothing is sent when the actor is the
 * recipient.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const taskVis = require('../../../shared/task-visibility');

const STATUSES = ['todo', 'doing', 'done', 'seen'];
const STATUS_LABEL = { todo: 'To do', doing: 'In progress', done: 'Done', seen: 'Seen' };
const LEGACY_STATUS = { open: 'todo', pending: 'todo', todo: 'todo', '': 'todo', in_progress: 'doing', progress: 'doing', doing: 'doing', done: 'done', completed: 'done', complete: 'done', seen: 'seen' };
const PRIORITIES = ['low', 'medium', 'high'];
const MAX_TITLE = 200, MAX_TEXT = 8000, MAX_COMMENT = 4000, MAX_LINKS = 20, MAX_LINK = 1000, MAX_LABEL = 160;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FILE_LINK_TTL_S = 60 * 60;   // signed download links handed out with a list live one hour

const normStatus = s => LEGACY_STATUS[String(s == null ? '' : s).trim().toLowerCase()] || 'todo';
const firstOf = n => String(n || '').trim().split(/\s+/)[0] || '';
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(String(s) + 'T00:00:00Z').getTime());
const cleanStr = (v, max) => (v === undefined ? undefined : String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max));
const sanitizeFilename = n => String(n || 'file').replace(/[\/\\]/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'file';
const extOf = name => { const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// result links: [{url,label}] — http(s) only, de-duplicated, capped; a bare string is a url
function cleanLinks(v) {
    if (v === undefined) return undefined;
    let arr = v;
    if (typeof v === 'string') { try { arr = JSON.parse(v); } catch (e) { arr = v.split(/\s+/); } }
    if (!Array.isArray(arr)) return NaN;
    const out = []; const seen = new Set();
    for (const it of arr.slice(0, MAX_LINKS)) {
        const url = String((it && typeof it === 'object' ? it.url : it) || '').trim().slice(0, MAX_LINK);
        if (!/^https?:\/\/\S+$/i.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ url, label: String((it && typeof it === 'object' && it.label) || '').trim().slice(0, MAX_LABEL) });
    }
    return out;
}
function parseLinks(raw) { try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter(l => l && l.url) : []; } catch (e) { return []; } }

module.exports = function mountTasks(app, ctx) {
    const { auth, adminOnly, saveDb, JWT_SECRET } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/tasks]', ...a));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const nowIso = () => new Date().toISOString();
    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    const persist = () => { try { saveDb && saveDb(); } catch (e) { /* periodic save still runs */ } };
    const fail = (res, e, what) => { console.error('[v2/tasks] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    const count = (sql, params) => { try { return Number((q.get(sql, params) || {}).c || 0); } catch (e) { return 0; } };
    function audit(req, action, detail) {
        try {
            q.run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [uuid(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 300)]);
        } catch (e) { /* best-effort */ }
    }
    const boardUrl = () => (process.env.ADMIN_PORTAL_URL || process.env.RENDER_EXTERNAL_URL || ('http://localhost:' + (process.env.PORT || 3002))).replace(/\/+$/, '');

    // ---- schema (additive, guarded — project_tasks / task_files are server.js's tables) ----
    for (const col of ['result_text TEXT', 'result_links TEXT', 'seen_at TEXT', 'seen_by TEXT', 'updated_at TEXT', 'archived_at TEXT']) {
        try { q.run('ALTER TABLE project_tasks ADD COLUMN ' + col); } catch (e) { /* exists */ }
    }
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_task_comments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            author_id TEXT,
            author_name TEXT,
            body TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'comment',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_task_comments_task ON v2_task_comments (task_id, created_at)');
    } catch (e) { log('comments schema failed:', e.message); }
    // everyone tagged on a task (server.js creates it too — the rule in shared/task-visibility.js reads it)
    try { taskVis.ensureTaskPeopleTable((sql, p) => q.run(sql, p)); } catch (e) { log('people schema failed:', e.message); }
    // one-time vocabulary normalisation of legacy rows (idempotent). A row the board has written
    // always carries updated_at; a tick-list row never does — so a legacy "done" (ticked in a list
    // where done simply meant "gone for everyone", nobody waiting to review it) files straight to
    // SEEN instead of piling up in DONE — FOR ALEN on the first morning of the board.
    try {
        q.run("UPDATE project_tasks SET status = 'todo' WHERE status IS NULL OR TRIM(status) IN ('', 'open', 'pending')");
        q.run("UPDATE project_tasks SET status = 'doing' WHERE status IN ('in_progress', 'progress')");
        q.run("UPDATE project_tasks SET status = 'done' WHERE status IN ('completed', 'complete')");
        q.run(`UPDATE project_tasks SET status = 'seen', seen_at = COALESCE(completed_at, created_at, ?), updated_at = COALESCE(completed_at, created_at, ?)
               WHERE status = 'done' AND updated_at IS NULL`, [nowIso(), nowIso()]);
    } catch (e) { log('status normalisation skipped:', e.message); }

    // ---- people: who can be assigned, who is acting ----
    function nameOfUser(u) { return [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.email || '').split('@')[0] || 'Someone'; }
    function actorOf(req) {
        const u = req.user || {};
        const row = q.get('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [u.id]) || {};
        const name = nameOfUser(Object.assign({ email: u.email }, row));
        const member = q.get('SELECT id, name FROM team_members WHERE user_id = ?', [u.id]);
        return { id: u.id, email: row.email || u.email || null, name, first: firstOf(name), member_id: member ? member.id : null };
    }
    // An admin account and an unlinked team row with the same name are one person (the seed
    // creates Laura's user before her team row and the link never lands): join them once, here,
    // so she is offered once and her emails have an address.
    // Names are self-editable, and a task is seen by the accounts of the people on it (shared/task-visibility.js),
    // so a row that already carries a task (assigned or tagged) is never linked by name: an admin who renamed themself
    // after it would inherit tasks that until now only their creators could see. Every link is logged.
    function healTeamLinks() {
        const admins = q.all('SELECT id, first_name, last_name, email FROM users WHERE is_admin = 1');
        const loose = q.all(`SELECT tm.id, tm.name FROM team_members tm WHERE (tm.user_id IS NULL OR tm.user_id = '')
                               AND NOT EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.assigned_to = tm.id)
                               AND NOT EXISTS (SELECT 1 FROM v2_task_people tp WHERE tp.member_id = tm.id)`);
        if (!admins.length || !loose.length) return;
        const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
        const linked = new Set(q.all('SELECT user_id FROM team_members WHERE user_id IS NOT NULL').map(r => r.user_id));
        let changed = false;
        for (const u of admins) {
            if (linked.has(u.id)) continue;
            const hit = loose.find(m => norm(m.name) && norm(m.name) === norm(nameOfUser(u)));
            if (!hit) continue;
            try {
                q.run(`UPDATE team_members SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = '')
                         AND NOT EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.assigned_to = team_members.id)
                         AND NOT EXISTS (SELECT 1 FROM v2_task_people tp WHERE tp.member_id = team_members.id)`, [u.id, hit.id]);
                loose.splice(loose.indexOf(hit), 1); linked.add(u.id); changed = true;
                try { q.run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)', [uuid(), null, 'system', 'team.link', `team row ${hit.id} linked to account ${u.id} (same name, no tasks on the row)`]); } catch (e) { /* best-effort */ }
                log(`team row ${hit.id} linked to account ${u.id} by name`);
            } catch (e) { /* unique clash — leave it */ }
        }
        if (changed) persist();
    }
    function people() {
        healTeamLinks();
        const members = q.all(`SELECT tm.id, tm.user_id, tm.name, tm.role, u.email, u.is_admin, u.is_founder
                               FROM team_members tm LEFT JOIN users u ON u.id = tm.user_id ORDER BY tm.name`);
        const linked = new Set(members.map(m => m.user_id).filter(Boolean));
        // a stale team row with no account next to a linked row of the same name (the live DB has
        // two "Laura Rodman") is not offered twice — the linked one is the person; old tasks on the
        // stale row still show her name through the join
        const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
        const linkedNames = new Set(members.filter(m => m.user_id).map(m => norm(m.name)));
        const out = members.filter(m => m.user_id || !linkedNames.has(norm(m.name)))
            .map(m => ({ id: m.id, user_id: m.user_id || null, name: m.name, first: firstOf(m.name), email: m.email || null, role: m.role || null, is_founder: !!Number(m.is_founder || 0) }));
        q.all('SELECT id, email, first_name, last_name, is_founder FROM users WHERE is_admin = 1 ORDER BY first_name, last_name, email')
            .filter(u => !linked.has(u.id))
            .forEach(u => out.push({ id: 'user:' + u.id, user_id: u.id, name: nameOfUser(u), first: firstOf(nameOfUser(u)), email: u.email, role: 'Admin', is_founder: !!Number(u.is_founder || 0) }));
        return out;
    }
    // '' → null · team_members.id → itself · 'user:<id>' → the member row for that admin (created once)
    function resolveAssignee(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return { id: null };
        if (s.startsWith('user:')) {
            const uid = s.slice(5);
            healTeamLinks();
            const u = q.get('SELECT id, email, first_name, last_name FROM users WHERE id = ? AND is_admin = 1', [uid]);
            if (!u) return { error: 'That person is not on the team.' };
            const have = q.get('SELECT id FROM team_members WHERE user_id = ?', [uid]);
            if (have) return { id: have.id };
            const id = uuid();
            q.run('INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)', [id, uid, nameOfUser(u), 'Team']);
            return { id };
        }
        const m = q.get('SELECT id FROM team_members WHERE id = ?', [s]);
        return m ? { id: m.id } : { error: 'That person is not on the team.' };
    }
    function memberInfo(memberId) {
        if (!memberId) return null;
        const m = q.get(`SELECT tm.id, tm.name, tm.user_id, u.email, u.is_admin FROM team_members tm LEFT JOIN users u ON u.id = tm.user_id WHERE tm.id = ?`, [memberId]);
        return m ? { id: m.id, name: m.name, first: firstOf(m.name), user_id: m.user_id || null, email: m.email || null, is_admin: !!Number(m.is_admin || 0) } : null;
    }
    // assignees: [member id | 'user:<id>'] → { ids } in the order given — each resolved exactly like
    // resolveAssignee, duplicates collapsed (the same row, or two rows of one account), at most 12 — or
    // { error }. Every entry is checked before any team row is created for a 'user:<id>'.
    function resolveAssignees(v) {
        if (!Array.isArray(v)) return { error: 'Tag people as a list.' };
        const raw = [];
        for (const x of v) { const s = String(x == null ? '' : x).trim(); if (s && !raw.includes(s)) raw.push(s); }
        if (raw.length > taskVis.MAX_TASK_PEOPLE) return { error: `A task can have at most ${taskVis.MAX_TASK_PEOPLE} people on it.` };
        for (const s of raw) {
            const ok = s.startsWith('user:') ? q.get('SELECT id FROM users WHERE id = ? AND is_admin = 1', [s.slice(5)]) : q.get('SELECT id FROM team_members WHERE id = ?', [s]);
            if (!ok) return { error: 'That person is not on the team.' };
        }
        const ids = []; const accounts = new Set();
        for (const s of raw) {
            const who = resolveAssignee(s);
            if (who.error) return who;
            if (!who.id || ids.includes(who.id)) continue;
            const acct = (q.get('SELECT user_id FROM team_members WHERE id = ?', [who.id]) || {}).user_id;
            if (acct) { if (accounts.has(acct)) continue; accounts.add(acct); }
            ids.push(who.id);
        }
        return { ids };
    }
    // the tag rows of these tasks, in the order they were tagged: Map task id → [member id]
    function tagRowsOf(taskIds) {
        const out = new Map(); const ids = Array.from(new Set((taskIds || []).filter(Boolean)));
        for (let i = 0; i < ids.length; i += 400) {
            const chunk = ids.slice(i, i + 400);
            q.all(`SELECT task_id, member_id FROM v2_task_people WHERE task_id IN (${chunk.map(() => '?').join(',')}) ORDER BY added_at, rowid`, chunk)
                .forEach(t => { if (!out.has(t.task_id)) out.set(t.task_id, []); out.get(t.task_id).push(t.member_id); });
        }
        return out;
    }
    // the people on one task (member ids, first person first) — the rule is shared/task-visibility.js's
    const peopleIdsOf = row => taskVis.orderTaskPeople(row.assigned_to, tagRowsOf([row.id]).get(row.id));
    // the people on each row for the card: Map task id → [{ id, user_id, name, first }], first person first
    function peopleOf(rows) {
        const tags = tagRowsOf(rows.map(r => r.id));
        const order = new Map(); const mids = new Set();
        for (const r of rows) { const o = taskVis.orderTaskPeople(r.assigned_to, tags.get(r.id)); order.set(r.id, o); o.forEach(m => mids.add(m)); }
        const members = new Map(); const all = Array.from(mids);
        for (let i = 0; i < all.length; i += 400) {
            const chunk = all.slice(i, i + 400);
            q.all(`SELECT id, name, user_id FROM team_members WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk).forEach(m => members.set(m.id, m));
        }
        const out = new Map();
        for (const r of rows) out.set(r.id, order.get(r.id).map(id => members.get(id)).filter(Boolean).map(m => ({ id: m.id, user_id: m.user_id || null, name: m.name || '', first: firstOf(m.name) })));
        return out;
    }
    // "Alen", "Alen and Miro", "Alen, Miro and Pjero"
    const nameList = names => names.length <= 1 ? (names[0] || '') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    const isActorMember = (actor, m) => !!m && ((m.user_id && m.user_id === actor.id) || (actor.member_id && m.id === actor.member_id));
    // the activity rows for a change of people: "Laura tagged Alen and Miro" · "Laura joined the task" ·
    // "Laura removed Miro" · "Laura left the task"
    function peopleNotes(actor, added, removed) {
        const notes = [];
        const addOthers = added.filter(m => !isActorMember(actor, m)).map(m => m.first || m.name);
        if (addOthers.length) notes.push(`${actor.first} tagged ${nameList(addOthers)}`);
        if (added.some(m => isActorMember(actor, m))) notes.push(`${actor.first} joined the task`);
        const remOthers = removed.filter(m => !isActorMember(actor, m)).map(m => m.first || m.name);
        if (remOthers.length) notes.push(`${actor.first} removed ${nameList(remOthers)}`);
        if (removed.some(m => isActorMember(actor, m))) notes.push(`${actor.first} left the task`);
        return notes;
    }

    // ---- rows ----
    const BASE_SELECT = `SELECT pt.*, tm.name AS assignee_name, tm.user_id AS assignee_user_id,
            cu.first_name AS creator_first_name, cu.last_name AS creator_last_name, cu.email AS creator_email,
            su.first_name AS seen_first_name, su.last_name AS seen_last_name,
            (SELECT COUNT(*) FROM task_files f WHERE f.task_id = pt.id) AS file_count,
            (SELECT COUNT(*) FROM v2_task_comments c WHERE c.task_id = pt.id AND c.kind = 'comment') AS comment_count
        FROM project_tasks pt
        LEFT JOIN team_members tm ON tm.id = pt.assigned_to
        LEFT JOIN users cu ON cu.id = pt.created_by
        LEFT JOIN users su ON su.id = pt.seen_by`;
    const TOP_LEVEL = `(pt.parent_id IS NULL OR pt.parent_id = '')`;
    // the row when the caller may see it (creator or on it), else null — hidden and missing look alike
    const taskRow = (id, userId) => { const v = taskVis.visibleTaskSql('pt', userId); return q.get(BASE_SELECT + ` WHERE pt.id = ? AND ${v.sql}`, [id, ...v.params]); };
    // the row regardless of who asks — server-side use only (notifications), never sent to a caller as is
    const rawTaskRow = id => q.get(BASE_SELECT + ' WHERE pt.id = ?', [id]);
    const uidOf = req => (req && req.user && req.user.id) || null;
    const canSee = (req, id) => taskVis.canSeeTask(q.get, uidOf(req), id);
    function shape(r, people) {
        const creatorName = [r.creator_first_name, r.creator_last_name].filter(Boolean).join(' ') || (r.creator_email ? String(r.creator_email).split('@')[0] : '');
        const seenName = [r.seen_first_name, r.seen_last_name].filter(Boolean).join(' ');
        return {
            id: r.id, project: r.project || 'general', title: r.title || '', description: r.description || '',
            assigned_to: r.assigned_to || null, assignee_name: r.assignee_name || null, assignee_first: firstOf(r.assignee_name), assignee_user_id: r.assignee_user_id || null,
            created_by: r.created_by || null, creator_name: creatorName || null, creator_first: firstOf(creatorName) || null,
            priority: PRIORITIES.includes(r.priority) ? r.priority : 'medium', status: normStatus(r.status),
            due_date: r.due_date && isYmd(String(r.due_date).slice(0, 10)) ? String(r.due_date).slice(0, 10) : null,
            created_at: r.created_at || null, updated_at: r.updated_at || r.created_at || null, completed_at: r.completed_at || null,
            seen_at: r.seen_at || null, seen_by: r.seen_by || null, seen_by_name: seenName || null, archived_at: r.archived_at || null,
            result_text: r.result_text || '', result_links: parseLinks(r.result_links),
            file_count: Number(r.file_count || 0), comment_count: Number(r.comment_count || 0),
            // everyone on the card, first person (= assigned_to) first: [{ id, user_id, name, first }]
            people: people || peopleOf([r]).get(r.id) || []
        };
    }
    const shapeAll = rows => { const ppl = peopleOf(rows); return rows.map(r => shape(r, ppl.get(r.id))); };
    function touch(id) { q.run('UPDATE project_tasks SET updated_at = ? WHERE id = ?', [nowIso(), id]); }
    function activity(taskId, actor, body, kind) {
        q.run('INSERT INTO v2_task_comments (id, task_id, author_id, author_name, body, kind, created_at) VALUES (?,?,?,?,?,?,?)',
            [uuid(), taskId, actor.id || null, actor.name, String(body).slice(0, MAX_COMMENT), kind || 'system', nowIso()]);
    }
    const commentsOf = id => q.all('SELECT id, task_id, author_id, author_name, body, kind, created_at FROM v2_task_comments WHERE task_id = ? ORDER BY created_at, rowid', [id]);

    // ---- files (S3 when the bucket is configured, else the shared uploads root inbox.js uses) ----
    function s3() { try { return require('../../../user-portal/backend/boston')._s3; } catch (e) { return null; } }
    const s3Ready = () => { const S = s3(); return !!(S && S.isConfigured && S.isConfigured()); };
    const LOCAL_DIR = path.join(String(ctx.ROOT || path.join(__dirname, '..', '..', '..')), 'user-portal', 'backend', 'uploads', 'tasks');
    let multerLib = null; try { multerLib = require('multer'); } catch (e) { multerLib = null; }
    const fileUpload = multerLib ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } }).fields([{ name: 'file', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]) : null;
    function uploadParser(req, res, next) {
        if (req.file && req.file.buffer) return next();   // already parsed (a test handing the route a buffer)
        if (!fileUpload) return res.status(503).json({ error: 'Uploads are momentarily unavailable on this server.' });
        fileUpload(req, res, err => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 25 MB limit — share a link to it instead.' });
                return res.status(400).json({ error: 'We could not read that upload — try again.' });
            }
            if (req.files) req.file = (req.files.file && req.files.file[0]) || (req.files.attachment && req.files.attachment[0]) || null;
            next();
        });
    }
    const signFile = (fid, exp) => crypto.createHmac('sha256', String(JWT_SECRET || 'medx')).update('task-file:' + fid + ':' + exp).digest('hex').slice(0, 32);
    function signedPath(fid) { const exp = Math.floor(Date.now() / 1000) + FILE_LINK_TTL_S; return `/api/v2/tasks/files/${encodeURIComponent(fid)}?exp=${exp}&sig=${signFile(fid, exp)}`; }
    function shapeFile(f) {
        return { id: f.id, task_id: f.task_id, name: f.original_name || f.filename, size: Number(f.file_size || 0), mime: f.mime_type || '', uploaded_at: f.uploaded_at || null, url: signedPath(f.id) };
    }
    const filesOf = id => q.all('SELECT * FROM task_files WHERE task_id = ? ORDER BY uploaded_at, rowid', [id]).map(shapeFile);
    // a signed link is as good as the Bearer the SPA holds (only a participant's detail/list hands one
    // out, and it lives an hour); the Bearer path is checked against the task rule in the handler
    function fileGate(req, res, next) {
        const fid = String(req.params.fid || ''); const exp = Number(req.query && req.query.exp); const sig = String((req.query && req.query.sig) || '');
        req.taskFileSigned = false;
        if (fid && exp && sig && exp > Math.floor(Date.now() / 1000) && sig.length === 32) {
            const want = signFile(fid, exp);
            if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) { req.taskFileSigned = true; return next(); }
        }
        return auth(req, res, () => adminOnly(req, res, next));
    }

    // ---- emails (team only; nothing goes to the actor themself) ----
    function emailHtml({ title, headline, lines, quote, links, cta, url }) {
        const sans = "Inter,Helvetica,Arial,sans-serif", serif = "Fraunces,Georgia,'Times New Roman',serif";
        const body = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:34px 40px 8px;">
          <div style="font-family:${sans};font-weight:600;font-size:10px;letter-spacing:.2em;color:#c9a962;text-transform:uppercase;">THE TASK BOARD</div>
          <div style="font-family:${serif};font-size:26px;line-height:1.15;color:#f6efe2;margin-top:10px;">${headline}</div>
          ${(lines || []).map(l => `<p style="font-family:${sans};font-size:14px;line-height:1.65;color:#d9cebd;margin:14px 0 0;">${l}</p>`).join('')}
          ${quote ? `<div style="margin-top:18px;padding:16px 18px;background:#2f251a;border-left:2px solid #c9a962;font-family:${sans};font-size:14px;line-height:1.6;color:#f6efe2;white-space:pre-wrap;">${quote}</div>` : ''}
          ${links && links.length ? `<div style="margin-top:14px;">${links.map(l => `<div style="font-family:${sans};font-size:13px;line-height:1.7;"><a href="${esc(l.url)}" style="color:#d7b56c;text-decoration:underline;">${esc(l.label || l.url)}</a></div>`).join('')}</div>` : ''}
          <div style="margin-top:26px;"><a href="${esc(url)}" style="display:inline-block;padding:14px 30px;background:#9b1b22;color:#f7f1e6;font-family:${sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;">${cta}</a></div>
        </td></tr></table>`;
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#120e0a;font-family:${sans};-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#120e0a;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#291e14;box-shadow:0 10px 34px rgba(0,0,0,.35);">
  <tr><td style="background:#191512;padding:22px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td align="left" style="vertical-align:middle;"><img src="https://medx-member-portal-v2.netlify.app/assets/logo-white.png" alt="med&amp;X" height="20" style="height:20px;width:auto;display:block;border:0;"></td>
    <td align="right" style="vertical-align:middle;font-family:${sans};font-weight:600;font-size:9px;letter-spacing:.2em;color:#c9a962;text-transform:uppercase;">ADMIN PORTAL</td>
  </tr></table></td></tr>
  <tr><td style="height:2px;font-size:0;line-height:0;background:#9b1b22;">&nbsp;</td></tr>
  <tr><td>${body}</td></tr>
  <tr><td style="border-top:1px solid rgba(240,228,210,.16);padding:18px 40px 22px;font-family:${sans};font-size:11px;line-height:1.7;color:#cbbca7;">© Med&amp;X ${new Date().getFullYear()} · Split, Croatia<br>Sent by the Med&amp;X admin portal because a task you gave or were given was updated.</td></tr>
</table></td></tr></table></body></html>`;
    }
    function teamEmailOf(userId) {
        if (!userId) return null;
        const u = q.get('SELECT id, email, first_name, last_name, is_admin FROM users WHERE id = ?', [userId]);
        return u && Number(u.is_admin) === 1 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(u.email || '')) ? u : null;
    }
    async function mail(to, subject, html) {
        if (!ctx.sendEmail) return;
        try { const r = await ctx.sendEmail(to, subject, html); if (r && r.success === false) log('email not sent to ' + to + ': ' + (r.error || '')); }
        catch (e) { log('email failed to ' + to + ': ' + e.message); }
    }
    function notifyAssigned(task, actor, member) {
        if (!member || !member.user_id || member.user_id === actor.id) return;
        const u = teamEmailOf(member.user_id); if (!u) return;
        const url = boardUrl() + '/tasks/' + encodeURIComponent(task.id);
        const due = task.due_date ? `Due ${task.due_date}.` : '';
        const html = emailHtml({
            title: `${actor.first} gave you a task`, headline: `${esc(actor.first)} gave you a task: <i>${esc(task.title)}</i>`,
            lines: [[task.description ? esc(task.description) : '', due].filter(Boolean).join(' ') || 'Open the board, do it, and put the result on the card — text, links or files — so it is never lost in a message.'],
            cta: 'OPEN THE BOARD', url
        });
        return mail(u.email, `${actor.first} gave you a task: ${task.title}`, html);
    }
    function notifyDone(task, actor) {
        if (!task.created_by || task.created_by === actor.id) return;
        const u = teamEmailOf(task.created_by); if (!u) return;
        const url = boardUrl() + '/tasks/' + encodeURIComponent(task.id);
        const links = parseLinks(task.result_links);
        const html = emailHtml({
            title: `${actor.first} finished: ${task.title}`, headline: `${esc(actor.first)} finished: <i>${esc(task.title)}</i>`,
            lines: [task.result_text || links.length ? 'The result is on the card — quoted here so it is in one place:' : 'No written result yet — the card may carry files. Open it to see, then mark it seen.'],
            quote: task.result_text ? esc(task.result_text) : '', links, cta: 'SEE THE RESULT', url
        });
        return mail(u.email, `${actor.first} finished: ${task.title} — result inside`, html);
    }

    // ---- core writes (shared by the v2 and the legacy surface) ----
    function createTask(req, b) {
        const actor = actorOf(req);
        const title = cleanStr(b.title, MAX_TITLE);
        if (!title) return { status: 400, body: { error: 'Give the task a title.' } };
        const description = cleanStr(b.description, MAX_TEXT) || null;
        const due = b.due_date == null || b.due_date === '' ? null : String(b.due_date).slice(0, 10);
        if (due && !isYmd(due)) return { status: 400, body: { error: 'The due date must be YYYY-MM-DD.' } };
        const priority = b.priority === undefined || b.priority === null || b.priority === '' ? 'medium' : String(b.priority).toLowerCase();
        if (!PRIORITIES.includes(priority)) return { status: 400, body: { error: 'Priority is low, medium or high.' } };
        // the people: assignees [..] (the first is assigned_to), or assigned_to alone (= one person)
        let who;
        if (b.assignees !== undefined && b.assignees !== null) who = resolveAssignees(b.assignees);
        else { const one = resolveAssignee(b.assigned_to); who = one.error ? one : { ids: one.id ? [one.id] : [] }; }
        if (who.error) return { status: 400, body: { error: who.error } };
        const status = b.status ? normStatus(b.status) : 'todo';
        const project = cleanStr(b.project, 60) || 'general';
        const id = uuid(); const now = nowIso();
        q.run(`INSERT INTO project_tasks (id, project, title, description, assigned_to, priority, status, due_date, created_by, created_at, updated_at, completed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, project, title, description, who.ids[0] || null, priority, status, due, actor.id || null, now, now, status === 'done' || status === 'seen' ? now : null]);
        taskVis.setTaskPeople((sql, p) => q.run(sql, p), id, who.ids, actor.id, now);
        const members = who.ids.map(memberInfo).filter(Boolean);
        // "Laura created the task and tagged Alen and Miro" · "… and joined it" · "…, joined it and tagged Alen"
        const others = members.filter(m => !isActorMember(actor, m)).map(m => m.first || m.name);
        const parts = (members.some(m => isActorMember(actor, m)) ? ['joined it'] : []).concat(others.length ? ['tagged ' + nameList(others)] : []);
        activity(id, actor, `${actor.first} created the task` + (parts.length === 2 ? `, ${parts[0]} and ${parts[1]}` : parts.length ? ' and ' + parts[0] : ''));
        audit(req, 'task.create', 'task ' + id);   // ids only — the audit feed is read by every admin, a title is private
        persist();
        const row = rawTaskRow(id);   // the creator always sees what they just made
        const task = shape(row);
        members.forEach(m => notifyAssigned(task, actor, m));   // each person tagged (never the actor, team admins only)
        return { status: 200, body: { success: true, id, task } };
    }
    // patch = { title?, description?, assignees?, assigned_to?, due_date?, priority?, status? } — each key optional
    function updateTask(req, id, patch) {
        const actor = actorOf(req);
        const cur = taskRow(id, actor.id);
        if (!cur) return { status: 404, body: { error: 'That task is not here.' } };
        const sets = []; const vals = []; const notes = []; const fields = []; let becameDone = false;
        let nextPeople = null; let addedPeople = []; let removedPeople = [];
        if (patch.title !== undefined) {
            const t = cleanStr(patch.title, MAX_TITLE); if (!t) return { status: 400, body: { error: 'Give the task a title.' } };
            if (t !== cur.title) { sets.push('title = ?'); vals.push(t); notes.push(`${actor.first} renamed it to “${t}”`); fields.push('title'); }
        }
        if (patch.description !== undefined) {
            const d = cleanStr(patch.description, MAX_TEXT) || null;
            if ((d || '') !== (cur.description || '')) { sets.push('description = ?'); vals.push(d); notes.push(`${actor.first} edited the notes`); fields.push('notes'); }
        }
        if (patch.due_date !== undefined) {
            const due = patch.due_date == null || patch.due_date === '' ? null : String(patch.due_date).slice(0, 10);
            if (due && !isYmd(due)) return { status: 400, body: { error: 'The due date must be YYYY-MM-DD.' } };
            if ((due || '') !== String(cur.due_date || '').slice(0, 10)) { sets.push('due_date = ?'); vals.push(due); notes.push(due ? `${actor.first} set the due date to ${due}` : `${actor.first} cleared the due date`); fields.push('due'); }
        }
        if (patch.priority !== undefined) {
            const p = String(patch.priority || 'medium').toLowerCase(); if (!PRIORITIES.includes(p)) return { status: 400, body: { error: 'Priority is low, medium or high.' } };
            if (p !== (cur.priority || 'medium')) { sets.push('priority = ?'); vals.push(p); notes.push(`${actor.first} set priority to ${p}`); fields.push('priority'); }
        }
        // the people. assignees = the whole set: whoever stays keeps their place (the first person stays
        // first unless taken off, then the next one tagged is promoted), newcomers join in the order given.
        // assigned_to alone is the one-person write it always was: a different person → the task is theirs
        // alone; the same first person → nothing changes (a legacy edit that re-sends it drops no one).
        const curPeople = peopleIdsOf(cur);
        if (patch.assignees !== undefined && patch.assignees !== null) {
            const who = resolveAssignees(patch.assignees); if (who.error) return { status: 400, body: { error: who.error } };
            const next = curPeople.filter(m => who.ids.includes(m)).concat(who.ids.filter(m => !curPeople.includes(m)));
            if (next.join('|') !== curPeople.join('|')) nextPeople = next;
        } else if (patch.assigned_to !== undefined) {
            const who = resolveAssignee(patch.assigned_to); if (who.error) return { status: 400, body: { error: who.error } };
            if ((who.id || null) !== (cur.assigned_to || null)) nextPeople = who.id ? [who.id] : [];
        }
        if (nextPeople) {
            addedPeople = nextPeople.filter(m => !curPeople.includes(m)).map(memberInfo).filter(Boolean);
            removedPeople = curPeople.filter(m => !nextPeople.includes(m)).map(memberInfo).filter(Boolean);
            notes.push(...peopleNotes(actor, addedPeople, removedPeople));
            fields.push('people');
        }
        if (patch.status !== undefined) {
            const s = normStatus(patch.status); if (!STATUSES.includes(s)) return { status: 400, body: { error: 'Status is todo, doing, done or seen.' } };
            const was = normStatus(cur.status);
            if (s !== was) {
                sets.push('status = ?'); vals.push(s);
                // done/seen keep the first completion time; anything earlier in the lifecycle clears it;
                // seen stamps who saw it and when; leaving seen clears the stamp again
                sets.push('completed_at = ?'); vals.push(s === 'done' || s === 'seen' ? (cur.completed_at || nowIso()) : null);
                sets.push('seen_at = ?'); vals.push(s === 'seen' ? nowIso() : null);
                sets.push('seen_by = ?'); vals.push(s === 'seen' ? (actor.id || null) : null);
                if (s === 'seen') notes.push(`${actor.first} marked it seen`);
                else notes.push(`${actor.first} moved to ${STATUS_LABEL[s]}` + ((was === 'done' || was === 'seen') && (s === 'todo' || s === 'doing') ? ' (reopened)' : ''));
                becameDone = s === 'done';
                fields.push('status ' + s);
            }
        }
        if (!sets.length && !nextPeople) return { status: 200, body: { success: true, task: shape(cur), unchanged: true } };
        sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(id);
        q.run(`UPDATE project_tasks SET ${sets.join(', ')} WHERE id = ?`, vals);
        if (nextPeople) {
            // stale tag rows (a one-person writer moved the task since — shared/task-visibility.js) go first,
            // so anyone tagged again now is tagged afresh, in order
            q.run(`DELETE FROM v2_task_people WHERE task_id = ?` + (curPeople.length ? ` AND member_id NOT IN (${curPeople.map(() => '?').join(',')})` : ''), [id, ...curPeople]);
            taskVis.setTaskPeople((sql, p) => q.run(sql, p), id, nextPeople, actor.id, nowIso());
        }
        notes.forEach(n => activity(id, actor, n));
        audit(req, 'task.update', `task ${id}: ${fields.join(', ')}`);
        persist();
        const row = rawTaskRow(id);
        if (addedPeople.length) { const task = shape(row); addedPeople.forEach(m => notifyAssigned(task, actor, m)); }   // only the newly tagged
        if (becameDone) notifyDone(row, actor);
        // taking yourself off a task you did not create (or handing it on) takes it off your board: from
        // here on only its creator and the people on it see it, so the answer carries no card
        const still = taskRow(id, actor.id);
        if (!still) return { status: 200, body: { success: true, task: null, handed_off: true } };
        return { status: 200, body: { success: true, task: shape(still) } };
    }

    // ================================================================ /api/v2/tasks
    app.get('/api/v2/tasks/badge', auth, adminOnly, (req, res) => {
        try {
            const me = actorOf(req);
            const v = taskVis.visibleTaskSql('pt', me.id);
            const done_unseen = count(`SELECT COUNT(*) AS c FROM project_tasks pt WHERE ${TOP_LEVEL} AND pt.archived_at IS NULL AND pt.status = 'done' AND pt.created_by = ? AND ${v.sql}`, [me.id || '', ...v.params]);
            // open tasks I am on — first or tagged, through ANY team row of my account (user_id join)
            const on = taskVis.onTaskSql('pt', me.id);
            const assigned_open = count(`SELECT COUNT(*) AS c FROM project_tasks pt WHERE ${TOP_LEVEL} AND pt.archived_at IS NULL AND pt.status NOT IN ('done','seen')
                    AND ${on.sql} AND ${v.sql}`, [...on.params, ...v.params]);
            res.json({ done_unseen, assigned_open, member_id: me.member_id });
        } catch (e) { fail(res, e, 'badge'); }
    });

    app.get('/api/v2/tasks', auth, adminOnly, (req, res) => {
        try {
            const me = actorOf(req);
            const vis = taskVis.visibleTaskSql('pt', me.id);
            const where = [TOP_LEVEL, vis.sql]; const vals = [...vis.params];   // only the caller's own tasks — created or assigned
            const archived = String(req.query.archived || '') === '1';
            where.push(archived ? 'pt.archived_at IS NOT NULL' : 'pt.archived_at IS NULL');
            const assignee = String(req.query.assignee || '').trim();
            if (assignee && assignee !== 'all') {
                // MINE / FOR <name>: every task that person is on (first or tagged), among the ones I may see
                if (assignee === 'me') { const o = taskVis.onTaskSql('pt', me.id); where.push(o.sql); vals.push(...o.params); }
                else if (assignee === 'none') where.push("(pt.assigned_to IS NULL OR pt.assigned_to = '')");
                else { const who = resolveAssignee(assignee); if (who.error) return res.status(400).json({ error: who.error }); const o = taskVis.onTaskMemberSql('pt', who.id); where.push(o.sql); vals.push(...o.params); }
            }
            const status = String(req.query.status || '').trim().toLowerCase();
            if (status) {
                const list = status.split(',').map(normStatus).filter(s => STATUSES.includes(s));
                if (list.length) { where.push(`pt.status IN (${list.map(() => '?').join(',')})`); vals.push(...list); }
            }
            const qs = String(req.query.q || '').trim().slice(0, 120);
            for (const tok of qs.split(/\s+/).filter(Boolean).slice(0, 6)) {
                const like = '%' + tok.replace(/[%_]/g, c => '\\' + c) + '%';
                where.push(`(pt.title LIKE ? ESCAPE '\\' OR pt.description LIKE ? ESCAPE '\\' OR pt.result_text LIKE ? ESCAPE '\\' OR pt.result_links LIKE ? ESCAPE '\\'
                             OR EXISTS (SELECT 1 FROM v2_task_comments c WHERE c.task_id = pt.id AND c.body LIKE ? ESCAPE '\\')
                             OR EXISTS (SELECT 1 FROM task_files f WHERE f.task_id = pt.id AND f.original_name LIKE ? ESCAPE '\\'))`);
                vals.push(like, like, like, like, like, like);
            }
            const rows = shapeAll(q.all(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(pt.updated_at, pt.created_at) DESC`, vals));
            res.json({ tasks: rows, people: people(), me: { id: me.id, name: me.name, first: me.first, member_id: me.member_id, email: me.email } });
        } catch (e) { fail(res, e, 'list'); }
    });

    app.post('/api/v2/tasks', auth, adminOnly, (req, res) => {
        try { const r = createTask(req, req.body || {}); res.status(r.status).json(r.body); } catch (e) { fail(res, e, 'create'); }
    });

    app.get('/api/v2/tasks/:id', auth, adminOnly, (req, res) => {
        try {
            const row = taskRow(String(req.params.id || ''), uidOf(req));
            if (!row) return res.status(404).json({ error: 'That task is not here.' });
            res.json({ task: shape(row), comments: commentsOf(row.id), files: filesOf(row.id) });
        } catch (e) { fail(res, e, 'detail'); }
    });

    app.put('/api/v2/tasks/:id', auth, adminOnly, (req, res) => {
        try { const r = updateTask(req, String(req.params.id || ''), req.body || {}); res.status(r.status).json(r.body); } catch (e) { fail(res, e, 'update'); }
    });

    app.put('/api/v2/tasks/:id/result', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = taskRow(id, uidOf(req));
            if (!cur) return res.status(404).json({ error: 'That task is not here.' });
            const b = req.body || {}; const actor = actorOf(req);
            const text = cleanStr(b.result_text, MAX_TEXT);
            const links = cleanLinks(b.result_links);
            if (links !== undefined && !Array.isArray(links)) return res.status(400).json({ error: 'Links must be a list of { url, label }.' });
            const sets = []; const vals = [];
            if (text !== undefined && (text || '') !== (cur.result_text || '')) { sets.push('result_text = ?'); vals.push(text || null); }
            if (links !== undefined && JSON.stringify(links) !== JSON.stringify(parseLinks(cur.result_links))) { sets.push('result_links = ?'); vals.push(JSON.stringify(links)); }
            if (!sets.length) return res.json({ success: true, task: shape(cur), unchanged: true });
            sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(id);
            q.run(`UPDATE project_tasks SET ${sets.join(', ')} WHERE id = ?`, vals);
            activity(id, actor, `${actor.first} ${cur.result_text || parseLinks(cur.result_links).length ? 'updated' : 'added'} the result`);
            audit(req, 'task.result', 'task ' + id);
            persist();
            res.json({ success: true, task: shape(taskRow(id, uidOf(req))) });
        } catch (e) { fail(res, e, 'result'); }
    });

    app.post('/api/v2/tasks/:id/seen', auth, adminOnly, (req, res) => {
        try { const r = updateTask(req, String(req.params.id || ''), { status: 'seen' }); res.status(r.status).json(r.body); } catch (e) { fail(res, e, 'seen'); }
    });

    function setArchived(req, res, on) {
        const id = String(req.params.id || ''); const cur = taskRow(id, uidOf(req));
        if (!cur) return res.status(404).json({ error: 'That task is not here.' });
        const actor = actorOf(req);
        if (!!cur.archived_at === on) return res.json({ success: true, task: shape(cur), unchanged: true });
        q.run('UPDATE project_tasks SET archived_at = ?, updated_at = ? WHERE id = ?', [on ? nowIso() : null, nowIso(), id]);
        activity(id, actor, on ? `${actor.first} archived it` : `${actor.first} brought it back from the archive`);
        audit(req, on ? 'task.archive' : 'task.unarchive', 'task ' + id);
        persist();
        res.json({ success: true, task: shape(taskRow(id, uidOf(req))) });
    }
    app.post('/api/v2/tasks/:id/archive', auth, adminOnly, (req, res) => { try { setArchived(req, res, true); } catch (e) { fail(res, e, 'archive'); } });
    app.post('/api/v2/tasks/:id/unarchive', auth, adminOnly, (req, res) => { try { setArchived(req, res, false); } catch (e) { fail(res, e, 'unarchive'); } });

    // ---- comments (kind 'comment'; the system rows share the table) ----
    app.get('/api/v2/tasks/:id/comments', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!canSee(req, id)) return res.status(404).json({ error: 'That task is not here.' });
            res.json({ comments: commentsOf(id) });
        } catch (e) { fail(res, e, 'comments'); }
    });
    app.post('/api/v2/tasks/:id/comments', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = taskVis.visibleTaskRow(q.get, uidOf(req), id, 'pt.id, pt.title');
            if (!cur) return res.status(404).json({ error: 'That task is not here.' });
            const body = cleanStr((req.body || {}).body, MAX_COMMENT);
            if (!body) return res.status(400).json({ error: 'Write the comment first.' });
            const actor = actorOf(req);
            activity(id, actor, body, 'comment');
            touch(id);
            audit(req, 'task.comment', 'task ' + id);
            persist();
            res.json({ success: true, comments: commentsOf(id) });
        } catch (e) { fail(res, e, 'comment'); }
    });

    // ---- files ----
    app.get('/api/v2/tasks/:id/files', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!canSee(req, id)) return res.status(404).json({ error: 'That task is not here.' });
            res.json({ files: filesOf(id), storage: s3Ready() ? 's3' : 'local' });
        } catch (e) { fail(res, e, 'files'); }
    });
    app.post('/api/v2/tasks/:id/files', auth, adminOnly, uploadParser, async (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = taskVis.visibleTaskRow(q.get, uidOf(req), id, 'pt.id, pt.title');
            if (!cur) return res.status(404).json({ error: 'That task is not here.' });
            const file = req.file;
            if (!file || !file.buffer || !file.buffer.length) return res.status(400).json({ error: 'Choose a file first — anything up to 25 MB.' });
            if (file.buffer.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'That file is over the 25 MB limit — share a link to it instead.' });
            const name = sanitizeFilename(file.originalname);
            const ext = extOf(name) || 'bin';
            const fid = uuid();
            const stored = `${fid}.${ext}`;
            const mime = String(file.mimetype || 'application/octet-stream').slice(0, 120);
            let filePath;
            // production disk is ephemeral: a task file is kept only in S3, never on local disk
            if (!s3Ready() && (process.env.NODE_ENV === 'production' || process.env.RENDER)) {
                return res.status(503).json({ error: 'File storage is not configured, so the file was not saved. The task itself is saved.' });
            }
            if (s3Ready()) {
                const key = `tasks/${id}/${stored}`;
                await s3().putObject(key, file.buffer, mime);   // S3 first — a DB row only for a stored file
                filePath = 's3:' + key;
            } else {
                fs.mkdirSync(LOCAL_DIR, { recursive: true });
                filePath = path.join(LOCAL_DIR, stored);
                fs.writeFileSync(filePath, file.buffer);
            }
            q.run(`INSERT INTO task_files (id, task_id, filename, original_name, file_path, file_size, mime_type, uploaded_at) VALUES (?,?,?,?,?,?,?,?)`,
                [fid, id, stored, name, filePath, file.buffer.length, mime, nowIso()]);
            const actor = actorOf(req);
            activity(id, actor, `${actor.first} attached ${name}`);
            touch(id);
            audit(req, 'task.file.upload', `task ${id}: file ${fid} (${file.buffer.length} bytes)`);
            persist();
            res.json({ success: true, file: shapeFile(q.get('SELECT * FROM task_files WHERE id = ?', [fid])), files: filesOf(id) });
        } catch (e) { log('upload failed:', e.message); res.status(502).json({ error: 'The upload did not go through — try again.' }); }
    });
    app.get('/api/v2/tasks/files/:fid', fileGate, (req, res) => {
        try {
            const fid = String(req.params.fid || '');
            // a valid signature was minted for a participant; a Bearer caller must be one right now
            const f = req.taskFileSigned ? q.get('SELECT * FROM task_files WHERE id = ?', [fid]) : taskVis.visibleTaskFile(q.get, uidOf(req), fid);
            if (!f) return res.status(404).json({ error: 'That file is not here.' });
            const name = f.original_name || f.filename || 'file';
            const wantJson = String((req.query && req.query.json) || '') === '1';
            if (String(f.file_path || '').startsWith('s3:')) {
                const S = s3();
                const url = S && S.presignGet ? S.presignGet(String(f.file_path).slice(3), { expires: 900, filename: name }) : null;
                if (!url) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
                if (wantJson) return res.json({ url, name });
                return res.redirect(302, url);
            }
            const local = f.file_path && fs.existsSync(f.file_path) ? f.file_path : path.join(LOCAL_DIR, f.filename || '');
            if (!f.filename || !fs.existsSync(local)) return res.status(404).json({ error: 'That file is no longer on this server.' });
            // a signed caller gets its own link back, never a fresh one (a link held after a reassignment
            // must run out, not renew itself); a Bearer caller has just passed the task rule
            if (wantJson) return res.json({ url: req.taskFileSigned ? `/api/v2/tasks/files/${encodeURIComponent(f.id)}?exp=${Number(req.query.exp)}&sig=${encodeURIComponent(String(req.query.sig))}` : signedPath(f.id), name });
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename="' + name.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(name));
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.sendFile(local);
        } catch (e) { fail(res, e, 'download'); }
    });
    app.delete('/api/v2/tasks/files/:fid', auth, adminOnly, (req, res) => {
        try {
            const f = taskVis.visibleTaskFile(q.get, uidOf(req), String(req.params.fid || ''));
            if (!f) return res.status(404).json({ error: 'That file is not here.' });
            q.run('DELETE FROM task_files WHERE id = ?', [f.id]);
            if (f.file_path && !String(f.file_path).startsWith('s3:')) { try { fs.unlinkSync(f.file_path); } catch (e) { /* already gone */ } }
            const actor = actorOf(req);
            activity(f.task_id, actor, `${actor.first} removed ${f.original_name || f.filename}`);
            touch(f.task_id);
            audit(req, 'task.file.remove', `task ${f.task_id}: file ${f.id}`);
            persist();
            res.json({ success: true, files: filesOf(f.task_id) });
        } catch (e) { fail(res, e, 'file remove'); }
    });

    // ================================================================ LEGACY /api/admin/tasks
    // Re-homed from server.js (2026-09-20) so the checklist callers — v2 Today/Calendar before they
    // moved to the board, the v1 SPA's Member Ops list — read and write the SAME rows with the same
    // shapes they always got: an array with assignee_name; { success, id }; { success }. Archived
    // rows stay out of the list; a 'seen' row reads as 'done' here because every legacy caller
    // decides "open" by `status !== 'done'` (the true board status rides along as board_status).
    app.get('/api/admin/tasks', auth, adminOnly, (req, res) => {
        try {
            const vis = taskVis.visibleTaskSql('pt', uidOf(req));
            const where = [TOP_LEVEL, 'pt.archived_at IS NULL', vis.sql]; const vals = [...vis.params];
            const project = String(req.query.project || '').trim();
            if (project) { where.push('pt.project = ?'); vals.push(project); }
            const raw = q.all(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY (pt.status IN ('done','seen')), (pt.due_date IS NULL), pt.due_date, pt.created_at`, vals);
            const ppl = peopleOf(raw);
            const rows = raw.map(r => { const t = shape(r, ppl.get(r.id)); return Object.assign({}, r, t, { board_status: t.status, status: t.status === 'seen' ? 'done' : t.status, result_links: JSON.stringify(t.result_links) }); });
            res.json(rows);
        } catch (e) { fail(res, e, 'legacy list'); }
    });
    app.post('/api/admin/tasks', auth, adminOnly, (req, res) => {
        try { const r = createTask(req, req.body || {}); res.status(r.status).json(r.status === 200 ? { success: true, id: r.body.id } : r.body); } catch (e) { fail(res, e, 'legacy create'); }
    });
    app.put('/api/admin/tasks/:id', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {}; const patch = {};
            for (const k of ['title', 'assigned_to', 'due_date', 'description', 'priority']) if (b[k] !== undefined) patch[k] = b[k];
            if (b.done !== undefined) {
                const cur = taskVis.visibleTaskRow(q.get, uidOf(req), String(req.params.id || ''), 'pt.status');
                const truthy = b.done === true || b.done === 1 || b.done === '1' || b.done === 'true';
                if (truthy) { if (!cur || !['done', 'seen'].includes(normStatus(cur.status))) patch.status = 'done'; }
                else patch.status = 'todo';
            } else if (b.status !== undefined) patch.status = b.status;
            const r = updateTask(req, String(req.params.id || ''), patch);   // gated inside: a non-participant gets the 404
            res.status(r.status).json(r.status === 200 ? { success: true } : r.body);
        } catch (e) { fail(res, e, 'legacy update'); }
    });
    app.delete('/api/admin/tasks/:id', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = taskVis.visibleTaskRow(q.get, uidOf(req), id, 'pt.id, pt.title');
            if (!cur) return res.status(404).json({ error: 'Task not found' });
            q.run('DELETE FROM v2_task_comments WHERE task_id = ?', [id]);
            q.all('SELECT * FROM task_files WHERE task_id = ?', [id]).forEach(f => { if (f.file_path && !String(f.file_path).startsWith('s3:')) { try { fs.unlinkSync(f.file_path); } catch (e) {} } });
            q.run('DELETE FROM task_files WHERE task_id = ?', [id]);
            taskVis.deleteTaskPeople((sql, p) => q.run(sql, p), id);   // its tag rows and its subtasks'
            q.run('DELETE FROM project_tasks WHERE id = ?', [id]);
            audit(req, 'task.delete', 'task ' + id);
            persist();
            res.json({ success: true });
        } catch (e) { fail(res, e, 'legacy delete'); }
    });

    log('tasks: /api/v2/tasks{,/badge,/:id,/:id/result,/:id/seen,/:id/archive,/:id/comments,/:id/files,/files/:fid} + legacy /api/admin/tasks · files → ' + (s3Ready() ? 'S3 tasks/' : LOCAL_DIR));
};

module.exports._internals = { normStatus, cleanLinks, parseLinks, isYmd, STATUSES, STATUS_LABEL };
