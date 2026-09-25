/**
 * tests/tasks-privacy-routes.test.js — the task rule on the server.js readers of BOTH portals.
 *
 * Alen, 25 Sept 2026: "if Laura tags me I only see that task … some of it's gonna be personal." A task is
 * seen ONLY by its creator and its assignee (shared/task-visibility.js). tests/tasks-board.test.js proves it
 * on the board module (admin-portal/backend/v2/tasks.js); this file proves it on the inline server.js routes
 * the board does not own:
 *   admin  GET /api/tasks/:project · GET /api/tasks · POST /api/tasks (parent_id) · PUT /api/tasks/:id ·
 *          POST /api/tasks/:id/files · DELETE /api/tasks/files/:fileId · POST /api/tasks/:id/toggle ·
 *          DELETE /api/tasks/:id · GET /api/search · GET /api/dashboard/summary · GET /api/dashboard/portal-stats ·
 *          GET /api/admin/nag/items (+ /act /done /dismiss /claim) · the daily digest · GET /api/admin/audit-log
 *   member the same legacy /api/tasks* routes, GET /api/search and GET /api/dashboard/summary
 * A = creator · B = assignee · C = neither · D = gets it on reassignment. A non-participant must get the
 * same answer as for a missing task, and nothing may change.
 *
 * Boots BOTH portals against one throwaway SQLite file with the network disabled (the tests/final-qa-backend
 * preload), same shape as tests/admin-audit-fixes.test.js. Made-up people only. NO email, NO live database.
 *
 * Run: node tests/tasks-privacy-routes.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://127.0.0.1:3290';
const ADMIN = 'http://127.0.0.1:3291';
const SECRET = 'tasks-privacy-test-secret';
const NO_NET = `
const net = require('net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const o = args[0] && typeof args[0] === 'object' ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (o && o.path) return connect.apply(this, args);
    const h = String((o && (o.host || o.hostname)) || 'localhost');
    if (!/^(localhost|127\\.0\\.0\\.1|::1|::ffff:127\\.0\\.0\\.1)$/.test(h)) {
        const e = new Error('NETWORK DISABLED IN TESTS (' + h + ')');
        process.nextTick(() => this.destroy(e));
        return this;
    }
    return connect.apply(this, args);
};
global.fetch = async (u) => { throw new Error('NETWORK DISABLED IN TESTS ' + String(u).slice(0, 80)); };
`;

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 260) : ''));
};
const api = async (base, p, { method = 'GET', body, token, form } = {}) => {
    const headers = {};
    if (!form) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
};
const same = (a, b) => a.status === b.status && JSON.stringify(a.d) === JSON.stringify(b.d);
const waitUp = async (base, ms = 150000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('server at ' + base + ' did not come up');
};

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-tasks-privacy-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const preload = path.join(scratch, 'no-network.js');
    fs.writeFileSync(preload, NO_NET);
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
        FIRA_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_SHEETS_WEBHOOK: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
        JWT_SECRET: SECRET, NODE_ENV: 'test',
    };
    for (const k of Object.keys(env)) if (k.startsWith('BB_S3_') || k.startsWith('RENDER')) delete env[k];
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['-r', preload, 'server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errbuf = '';
        p.stderr.on('data', (d) => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        p._errbuf = () => errbuf;
        procs.push(p);
    };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('user-portal/backend', 3290);
        await waitUp(USER);
        boot('admin-portal/backend', 3291);
        await waitUp(ADMIN);
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const jwt = require(path.join(ROOT, 'admin-portal/backend/node_modules/jsonwebtoken'));
        const tdb = new Database(dbPath);
        const x = (sql, params = []) => tdb.prepare(sql).run(...params);
        const g = (sql, params = []) => tdb.prepare(sql).get(...params);

        // ------------------------------------------------------------ four made-up admins, three team rows
        const P = { A: 'tp-user-a', B: 'tp-user-b', C: 'tp-user-c', D: 'tp-user-d' };
        const TM = { A: 'tp-tm-a', B: 'tp-tm-b', D: 'tp-tm-d' };
        for (const [k, id] of Object.entries(P)) {
            x(`INSERT INTO users (id, email, password_hash, first_name, last_name, is_admin, must_change_password) VALUES (?,?,?,?,?,1,0)`,
                [id, `qa.taskprivacy+${k.toLowerCase()}@example.com`, 'x', 'Qa' + k, 'Tester']);
        }
        for (const [k, id] of Object.entries(TM)) x(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, [id, P[k], 'Qa' + k + ' Tester', 'QA']);
        const tok = {}; for (const [k, id] of Object.entries(P)) tok[k] = jwt.sign({ id, email: `qa.taskprivacy+${k.toLowerCase()}@example.com` }, SECRET);

        // ------------------------------------------------------------ A gives B a private task (overdue, high), a subtask, a file row
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        x(`INSERT INTO project_tasks (id, project, title, description, assigned_to, priority, status, due_date, created_by, created_at, updated_at)
           VALUES ('tp-task', 'plexus', 'Qazwx dentist appointment', 'personal qazwx note', ?, 'high', 'todo', ?, ?, datetime('now'), datetime('now'))`, [TM.B, yesterday, P.A]);
        x(`INSERT INTO project_tasks (id, project, title, assigned_to, priority, status, created_by, parent_id) VALUES ('tp-sub', 'plexus', 'Qazwx subtask', NULL, 'medium', 'todo', ?, 'tp-task')`, [P.A]);
        const filePath = path.join(scratch, 'qa-file.txt'); fs.writeFileSync(filePath, 'qa');
        x(`INSERT INTO task_files (id, task_id, filename, original_name, file_path, file_size, mime_type) VALUES ('tp-file', 'tp-task', 'qa-file.txt', 'qazwx.txt', ?, 2, 'text/plain')`, [filePath]);
        // C's own task, so C's lists are not simply empty
        x(`INSERT INTO project_tasks (id, project, title, priority, status, created_by) VALUES ('tp-c-own', 'plexus', 'Qazwx C own errand', 'medium', 'todo', ?)`, [P.C]);
        const taskState = () => { const t = g(`SELECT title, status, assigned_to, description FROM project_tasks WHERE id = 'tp-task'`) || {}; return JSON.stringify([t.title, t.status, t.assigned_to, t.description]); };
        const state0 = taskState();

        const titlesIn = arr => (arr || []).map(t => t.title);
        for (const [label, base] of [['admin', ADMIN], ['member', USER]]) {
            // ---------------------------------------------------- lists
            let r = await api(base, '/api/tasks/plexus', { token: tok.C });
            check(`${label} GET /api/tasks/:project: C does not see A→B's task`, r.status === 200 && !titlesIn(r.d).some(t => /dentist/.test(t)) && titlesIn(r.d).includes('Qazwx C own errand'), JSON.stringify(titlesIn(r.d)));
            r = await api(base, '/api/tasks/plexus', { token: tok.B });
            const bTask = (r.d || []).find(t => t.id === 'tp-task');
            check(`${label} GET /api/tasks/:project: B (assignee) sees it with its subtask and file`, !!bTask && bTask.subtasks.some(s => s.id === 'tp-sub') && bTask.files.some(f => f.id === 'tp-file'), JSON.stringify(titlesIn(r.d)));
            r = await api(base, '/api/tasks/plexus', { token: tok.A });
            check(`${label} GET /api/tasks/:project: A (creator) sees it`, (r.d || []).some(t => t.id === 'tp-task'));
            r = await api(base, '/api/tasks', { token: tok.C });
            check(`${label} GET /api/tasks: C's summary holds only C's own task`, r.status === 200 && r.d.total === 1 && titlesIn(r.d.by_project.plexus).join() === 'Qazwx C own errand', JSON.stringify(r.d && r.d.by_project && titlesIn(r.d.by_project.plexus)));
            r = await api(base, '/api/tasks', { token: tok.B });
            check(`${label} GET /api/tasks: B's summary holds the task and its subtask`, r.status === 200 && r.d.total === 2, r.d && r.d.total);
            // ---------------------------------------------------- search
            r = await api(base, '/api/search?q=qazwx', { token: tok.C });
            check(`${label} GET /api/search: C finds only C's own task`, r.status === 200 && titlesIn(r.d.tasks).join() === 'Qazwx C own errand', JSON.stringify(titlesIn(r.d && r.d.tasks)));
            r = await api(base, '/api/search?q=dentist', { token: tok.B });
            check(`${label} GET /api/search: B finds it`, r.status === 200 && titlesIn(r.d.tasks).includes('Qazwx dentist appointment'));
            // ---------------------------------------------------- counts
            const sc = (await api(base, '/api/dashboard/summary', { token: tok.C })).d || {};
            const sb = (await api(base, '/api/dashboard/summary', { token: tok.B })).d || {};
            check(`${label} GET /api/dashboard/summary: task counts are the caller's own (C 1 · B 2, urgent C 0 · B 1)`,
                sc.tasks && sc.tasks.total === 1 && sc.tasks.urgent === 0 && sb.tasks.total === 2 && sb.tasks.urgent === 1 && sc.plexus.pending_tasks === 1 && sb.plexus.pending_tasks === 2,
                JSON.stringify({ c: sc.tasks, b: sb.tasks, cp: sc.plexus && sc.plexus.pending_tasks, bp: sb.plexus && sb.plexus.pending_tasks }));
            // ---------------------------------------------------- C gets exactly the missing answer on every write, and nothing moves
            const pairs = [
                ['PUT /api/tasks/:id', id => api(base, '/api/tasks/' + id, { method: 'PUT', token: tok.C, body: { title: 'Hijacked', status: 'done', assigned_to: null, due_date: null } })],
                ['POST /api/tasks/:id/toggle', id => api(base, '/api/tasks/' + id + '/toggle', { method: 'POST', token: tok.C })],
                ['POST /api/tasks (subtask under it)', id => api(base, '/api/tasks', { method: 'POST', token: tok.C, body: { project: 'plexus', title: 'Qazwx sneaky subtask', parent_id: id } })],
                ['POST /api/tasks/:id/files', id => { const f = new FormData(); f.append('file', new Blob(['qa'], { type: 'text/plain' }), 'qa.txt'); return api(base, '/api/tasks/' + id + '/files', { method: 'POST', token: tok.C, form: f }); }],
                ['DELETE /api/tasks/:id', id => api(base, '/api/tasks/' + id, { method: 'DELETE', token: tok.C })],
            ];
            for (const [name, fn] of pairs) {
                const hidden = await fn('tp-task'); const missing = await fn('tp-no-such-task');
                check(`${label} ${name}: C gets the same 404 as for a missing task`, hidden.status === 404 && same(hidden, missing), JSON.stringify([hidden, missing]));
            }
            const fh = await api(base, '/api/tasks/files/tp-file', { method: 'DELETE', token: tok.C });
            const fm = await api(base, '/api/tasks/files/tp-no-such-file', { method: 'DELETE', token: tok.C });
            check(`${label} DELETE /api/tasks/files/:fileId: C gets the same 404 as for a missing file`, fh.status === 404 && same(fh, fm), JSON.stringify([fh, fm]));
            check(`${label}: nothing C tried changed the task, its subtask or its file`, taskState() === state0 && !!g(`SELECT id FROM project_tasks WHERE id = 'tp-sub'`) && !!g(`SELECT id FROM task_files WHERE id = 'tp-file'`) && fs.existsSync(filePath)
                && !g(`SELECT id FROM project_tasks WHERE title = 'Qazwx sneaky subtask'`), taskState());
        }

        // ------------------------------------------------------------ admin: portal-stats, the Action Center, the digest, the audit feed
        let r = await api(ADMIN, '/api/dashboard/portal-stats', { token: tok.C });
        const rb = await api(ADMIN, '/api/dashboard/portal-stats', { token: tok.B });
        check('admin GET /api/dashboard/portal-stats: overdue/urgent are the caller\'s own (C 0 · B 1)', r.d && r.d.tasks && r.d.tasks.overdue === 0 && r.d.tasks.urgent === 0 && rb.d.tasks.overdue === 1 && rb.d.tasks.urgent === 1, JSON.stringify([r.d && r.d.tasks, rb.d && rb.d.tasks]));

        r = await api(ADMIN, '/api/admin/nag/run', { method: 'POST', token: tok.A });
        check('admin POST /api/admin/nag/run works', r.status === 200, JSON.stringify(r.d).slice(0, 160));
        const nag = g(`SELECT id, title FROM nag_items WHERE subject_id = 'tp-task' AND kind = 'task_overdue'`);
        check('the scan filed the overdue task as an Action Center row', !!nag, JSON.stringify(nag));
        const itemsOf = async k => ((await api(ADMIN, '/api/admin/nag/items', { token: tok[k] })).d || {});
        const ic = await itemsOf('C'), ib = await itemsOf('B'), ia = await itemsOf('A');
        check('admin GET /api/admin/nag/items: C does not get the task row (it carries the title)', !(ic.items || []).some(i => i.subject_id === 'tp-task'), (ic.items || []).map(i => i.title).join(' | ').slice(0, 200));
        check('admin GET /api/admin/nag/items: B and A do', (ib.items || []).some(i => i.subject_id === 'tp-task') && (ia.items || []).some(i => i.subject_id === 'tp-task'));
        check('admin GET /api/admin/nag/items: C\'s open count leaves it out', ib.counts && ic.counts && ib.counts.open === ic.counts.open + 1, JSON.stringify([ib.counts, ic.counts]));
        const hiddenStatus = await api(ADMIN, '/api/admin/nag/items?status=open', { token: tok.C });
        check('admin GET /api/admin/nag/items?status=open: C still does not get it', !((hiddenStatus.d && hiddenStatus.d.items) || []).some(i => i.subject_id === 'tp-task'));
        for (const verb of ['act', 'done', 'dismiss', 'claim']) {
            const h = await api(ADMIN, `/api/admin/nag/items/${nag.id}/${verb}`, { method: 'POST', token: tok.C });
            const m = await api(ADMIN, `/api/admin/nag/items/tp-no-such-item/${verb}`, { method: 'POST', token: tok.C });
            check(`admin POST /api/admin/nag/items/:id/${verb}: C gets the same 404 as a missing row`, h.status === 404 && same(h, m), JSON.stringify([h, m]));
        }
        check('…and the task C tried to close from the Action Center is still open', g(`SELECT status FROM project_tasks WHERE id = 'tp-task'`).status === 'todo' && g(`SELECT status, claimed_by FROM nag_items WHERE id = ?`, [nag.id]).status === 'open');

        // the digest: a task row filed under D's team row (stale assignee) must not reach D, who cannot see the task
        x(`INSERT INTO nag_items (id, kind, subject_id, title, action_kind, action_payload_json, assignee, status, created_at) VALUES ('tp-nag-stale', 'task_due_soon', 'tp-task', 'Task due soon: Qazwx dentist appointment', 'open_link', '{}', ?, 'open', datetime('now'))`, [TM.D]);
        x(`DELETE FROM scheduled_emails WHERE source_engine = 'nag-digest'`);
        r = await api(ADMIN, '/api/admin/nag/digest', { method: 'POST', token: tok.A });
        const digestTo = email => g(`SELECT payload_json FROM scheduled_emails WHERE source_engine = 'nag-digest' AND recipient_email = ?`, [email]);
        const dB = digestTo('qa.taskprivacy+b@example.com'), dD = digestTo('qa.taskprivacy+d@example.com');
        check('digest: B (the assignee) is told about the task', r.status === 200 && !!dB && /dentist/.test(dB.payload_json), JSON.stringify(r.d));
        check('digest: D (not on the task) is never sent its title', !dD || !/dentist/i.test(dD.payload_json), dD && dD.payload_json.slice(0, 200));
        x(`DELETE FROM nag_items WHERE id = 'tp-nag-stale'`);

        // the audit feed: a task action shows without its detail (old rows carried titles)
        x(`INSERT INTO audit_log (id, actor_id, actor_email, action, detail, created_at) VALUES ('tp-audit', ?, 'a@example.com', 'task.create', 'Qazwx dentist appointment → QaB Tester', datetime('now'))`, [P.A]);
        r = await api(ADMIN, '/api/admin/audit-log?limit=500', { token: tok.C });
        const row = (r.d || []).find(a => a.action === 'task.create' && a.actor_email === 'a@example.com');
        check('admin GET /api/admin/audit-log: a task row comes without its title', r.status === 200 && !!row && row.detail === null && !JSON.stringify(r.d).includes('Qazwx dentist'), JSON.stringify(row));

        // ------------------------------------------------------------ reassign B → D (by the creator, through the member v1 route): B loses it, D gains it
        r = await api(USER, '/api/tasks/tp-task', { method: 'PUT', token: tok.A, body: { assigned_to: TM.D, due_date: yesterday } });
        check('member PUT /api/tasks/:id: A (creator) reassigns B → D', r.status === 200, JSON.stringify(r.d));
        for (const [label, base] of [['admin', ADMIN], ['member', USER]]) {
            const lb = (await api(base, '/api/tasks/plexus', { token: tok.B })).d || [];
            const ld = (await api(base, '/api/tasks/plexus', { token: tok.D })).d || [];
            const la = (await api(base, '/api/tasks/plexus', { token: tok.A })).d || [];
            check(`${label} after reassignment: B lost it, D has it, A keeps it`, !lb.some(t => t.id === 'tp-task') && ld.some(t => t.id === 'tp-task') && la.some(t => t.id === 'tp-task'),
                JSON.stringify({ b: titlesIn(lb), d: titlesIn(ld) }));
            const sb2 = (await api(base, '/api/search?q=dentist', { token: tok.B })).d || {};
            check(`${label} after reassignment: B's search no longer finds it`, !titlesIn(sb2.tasks).some(t => /dentist/.test(t)));
        }
        r = await api(ADMIN, '/api/tasks/tp-task/toggle', { method: 'POST', token: tok.B });
        check('admin POST /api/tasks/:id/toggle: B (no longer on it) gets 404', r.status === 404);
        r = await api(ADMIN, '/api/tasks/tp-task/toggle', { method: 'POST', token: tok.D });
        check('admin POST /api/tasks/:id/toggle: D (now on it) can move it', r.status === 200 && r.d.new_status === 'in_progress', JSON.stringify(r.d));
        // a subtask created by D lands on the top-level task and follows it
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: tok.D, body: { project: 'plexus', title: 'Qazwx D subtask', parent_id: 'tp-sub' } });
        const dsub = g(`SELECT parent_id FROM project_tasks WHERE title = 'Qazwx D subtask'`);
        check('admin POST /api/tasks with a subtask as parent: filed under the top-level task', r.status === 200 && dsub && dsub.parent_id === 'tp-task', JSON.stringify(dsub));
    } catch (e) {
        check('run completed', false, e.stack || e.message);
        procs.forEach(p => { const b = p._errbuf && p._errbuf(); if (b) console.error(b.slice(-1500)); });
    }

    const failed = results.filter(r => !r[1]).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    cleanup();
    process.exit(failed ? 1 : 0);
})();
