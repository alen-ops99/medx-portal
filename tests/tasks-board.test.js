/**
 * tests/tasks-board.test.js — the shared TASK BOARD (admin-portal/backend/v2/tasks.js).
 *
 * Hermetic, in the house pattern (tests/big-ideas.test.js): a stub express app collects routes,
 * ONE in-memory libsql database (the same shared/db.js wrapper both portals use) carries the real
 * legacy schema (users · team_members · project_tasks · task_files · audit_log), and the module is
 * mounted on it exactly as production does. sendEmail is a capturing stub, global.fetch throws, no
 * S3 is configured (files land in a temp dir) — A REAL EMAIL OR NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Covers: the lifecycle todo → doing → done → seen (and reopen) · the result (text + links)
 * persisting · comments + system activity rows · the badge per user (done-unseen for the creator,
 * open for the assignee) · search reaching result text, comments and file names · archive hiding
 * and unarchive · files (upload, signed download link, gate, delete) · the assign / done emails
 * (team only, never the actor, never a guest) · the legacy /api/admin/tasks surface still working
 * on the same rows · legacy status normalisation at mount · the permission wiring (unmapped =
 * every signed-in admin reaches the routes) · the PRIVACY rule of 25 Sept 2026 (a task is seen only by
 * its creator and its assignee: a non-participant gets the same 404 as a missing task on every route
 * and finds it in no list, search or badge; reassignment moves it; no founder override; the shared
 * helper's SQL; the board copy) · STALE READS: each backend reads an embedded replica, so a change of people
 * syncs before it reads and reads again right before it writes (the old portal's hand-off or unassign is never
 * undone, 409 after three tries), modelled by a second mount reading a replica copy. The server.js readers are
 * covered by tests/tasks-privacy-routes.test.js.
 *
 * Run:  node tests/tasks-board.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('BB_S3_')) delete process.env[k];
process.env.ADMIN_PORTAL_URL = 'https://admin.test';

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

// ---------------------------------------------------------------- stub express
function stubApp() {
    const routes = {};
    const reg = m => (p, ...h) => { routes[m + ' ' + p] = h; };
    return {
        get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), delete: reg('DELETE'),
        routes,
        async call(method, p, opts = {}) {
            const chain = routes[method + ' ' + p];
            if (!chain) throw new Error('route not mounted: ' + method + ' ' + p);
            const req = {
                user: opts.user === undefined ? null : opts.user,
                params: opts.params || {}, query: opts.query || {}, body: opts.body || {},
                headers: opts.headers || {}, ip: '10.0.0.1', path: opts.path || p,
                file: opts.file || undefined,
                protocol: 'https', get: () => 'admin.test'
            };
            const r = { status: 200, body: undefined, headers: {} };
            let ended = false;
            const res = {
                status(c) { r.status = c; return res; },
                json(o) { r.body = o; ended = true; return res; },
                send(x) { r.body = x; ended = true; return res; },
                sendFile(f) { r.body = '[sendFile] ' + f; r.file = f; ended = true; },
                set(k, v) { r.headers[String(k).toLowerCase()] = v; return res; },
                setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; },
                redirect(c, u) { r.status = c; r.headers.location = u; ended = true; },
                get headersSent() { return ended; }
            };
            for (let i = 0; i < chain.length; i++) {
                if (ended) break;
                let advanced = false;
                await chain[i](req, res, () => { advanced = true; });
                if (!advanced && i < chain.length - 1) break;
            }
            return r;
        }
    };
}

// ---------------------------------------------------------------- the legacy schema (server.js DDL, verbatim shapes)
const db = createDatabase(Database, { localPath: ':memory:' });
db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, first_name TEXT, last_name TEXT, is_admin INTEGER DEFAULT 0, is_staff INTEGER DEFAULT 0, is_founder INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0, allowed_sections TEXT)`);
db.run(`CREATE TABLE team_members (id TEXT PRIMARY KEY, user_id TEXT UNIQUE, name TEXT NOT NULL, role TEXT, avatar_color TEXT DEFAULT '#C9A962', photo_url TEXT, is_online INTEGER DEFAULT 0, last_seen TEXT, FOREIGN KEY (user_id) REFERENCES users(id))`);
db.run(`CREATE TABLE project_tasks (
    id TEXT PRIMARY KEY, project TEXT NOT NULL, title TEXT NOT NULL, description TEXT, assigned_to TEXT,
    priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'todo', due_date TEXT, created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, sort_order INTEGER DEFAULT 0, parent_id TEXT,
    FOREIGN KEY (parent_id) REFERENCES project_tasks(id) ON DELETE CASCADE)`);
db.run(`CREATE TABLE task_files (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, filename TEXT NOT NULL, original_name TEXT, file_path TEXT, file_size INTEGER, mime_type TEXT, uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE)`);
db.run(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

function step(sql, params, all) { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) { out.push(st.getAsObject()); if (!all) break; } st.free(); return all ? out : (out[0] || null); }
const q = { run: (sql, p) => (p && p.length ? db.run(sql, p) : db.run(sql)), get: (sql, p) => step(sql, p, false), all: (sql, p) => step(sql, p, true) };

// people: Alen (founder), Laura (admin, linked team row), Miro (admin, NO team row), a guest member
const U = { alen: 'u-alen', laura: 'u-laura', miro: 'u-miro', guest: 'u-guest' };
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin, is_founder) VALUES (?,?,?,?,1,1)`, [U.alen, 'juginovic.alen@gmail.com', 'Alen', 'Juginovic']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,1)`, [U.laura, 'laura.rodman@medx.hr', 'Laura', 'Rodman']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,1)`, [U.miro, 'vp@medx.hr', 'Miro', 'Vukovic']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,0)`, [U.guest, 'guest@example.com', 'Guest', 'Member']);
const M = { alen: 'tm-alen', laura: 'tm-laura', ivan: 'tm-ivan', guest: 'tm-guest' };
q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, [M.alen, U.alen, 'Alen Juginovic', 'President']);
q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, [M.laura, U.laura, 'Laura Rodman', 'Executive Assistant']);
q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, [M.ivan, null, 'Ivan Nikolic', 'Plexus Lead']);
q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, [M.guest, U.guest, 'Guest Member', 'Volunteer']);
// legacy rows that predate the board — their statuses must normalise at mount
q.run(`INSERT INTO project_tasks (id, project, title, status, created_by) VALUES ('legacy-open', 'plexus', 'Legacy open task', 'open', ?)`, [U.alen]);
q.run(`INSERT INTO project_tasks (id, project, title, status, created_by) VALUES ('legacy-prog', 'plexus', 'Legacy in-progress task', 'in_progress', ?)`, [U.alen]);
q.run(`INSERT INTO project_tasks (id, project, title, status, created_by, completed_at) VALUES ('legacy-comp', 'plexus', 'Legacy completed task', 'completed', ?, '2026-01-01T00:00:00Z')`, [U.alen]);

// ---------------------------------------------------------------- mount
const app = stubApp();
const emails = [];
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-tasks-'));
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentication required' }));
const adminOnly = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admin only' }));
const mountTasks = require(path.join(ROOT, 'admin-portal/backend/v2/tasks.js'));
mountTasks(app, {
    db: () => db, auth, adminOnly, saveDb: () => {}, JWT_SECRET: 'tasks-test-secret', ROOT: tmpRoot, log: () => {},
    sendEmail: async (to, subject, html) => { emails.push({ to, subject, html }); return { success: true }; }
});
const as = { alen: { id: U.alen, email: 'juginovic.alen@gmail.com', is_admin: 1, is_founder: 1 }, laura: { id: U.laura, email: 'laura.rodman@medx.hr', is_admin: 1 }, miro: { id: U.miro, email: 'vp@medx.hr', is_admin: 1 } };
const call = (m, p, user, opts = {}) => app.call(m, p, Object.assign({ user }, opts));
const sys = id => q.all(`SELECT body, kind, author_name FROM v2_task_comments WHERE task_id = ? ORDER BY created_at, rowid`, [id]);

(async () => {
    console.log('tasks-board.test.js — hermetic (stub express, one in-memory libsql DB, captured emails, temp uploads)\n');
    let taskId = null, fileId = null;

    await t('every route is mounted', () => {
        for (const k of ['GET /api/v2/tasks', 'GET /api/v2/tasks/badge', 'GET /api/v2/tasks/:id', 'POST /api/v2/tasks', 'PUT /api/v2/tasks/:id',
            'PUT /api/v2/tasks/:id/result', 'POST /api/v2/tasks/:id/seen', 'POST /api/v2/tasks/:id/archive', 'POST /api/v2/tasks/:id/unarchive',
            'GET /api/v2/tasks/:id/comments', 'POST /api/v2/tasks/:id/comments', 'GET /api/v2/tasks/:id/files', 'POST /api/v2/tasks/:id/files',
            'GET /api/v2/tasks/files/:fid', 'DELETE /api/v2/tasks/files/:fid',
            'GET /api/admin/tasks', 'POST /api/admin/tasks', 'PUT /api/admin/tasks/:id', 'DELETE /api/admin/tasks/:id']) {
            assert.ok(app.routes[k], 'missing ' + k);
        }
    });

    await t('legacy statuses normalised at mount: open → todo, in_progress → doing, a pre-board completed → seen (nobody was waiting to review it)', () => {
        assert.strictEqual(q.get(`SELECT status FROM project_tasks WHERE id = 'legacy-open'`).status, 'todo');
        assert.strictEqual(q.get(`SELECT status FROM project_tasks WHERE id = 'legacy-prog'`).status, 'doing');
        const comp = q.get(`SELECT status, seen_at, updated_at FROM project_tasks WHERE id = 'legacy-comp'`);
        assert.strictEqual(comp.status, 'seen');
        assert.strictEqual(comp.seen_at, '2026-01-01T00:00:00Z');
        assert.ok(comp.updated_at, 'stamped so the migration never runs twice on it');
    });

    await t('no session → 401; a non-admin → 403', async () => {
        assert.strictEqual((await call('GET', '/api/v2/tasks', null)).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/tasks', { id: U.guest, email: 'guest@example.com', is_admin: 0 })).status, 403);
    });

    await t('the list carries the people (team rows + admins without one) and who I am', async () => {
        const r = await call('GET', '/api/v2/tasks', as.alen);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.me.member_id, M.alen);
        assert.strictEqual(r.body.me.first, 'Alen');
        const ids = r.body.people.map(p => p.id);
        assert.ok(ids.includes(M.laura) && ids.includes(M.alen) && ids.includes(M.ivan), 'team rows listed');
        assert.ok(ids.includes('user:' + U.miro), 'an admin without a team row is offered as user:<id>');
        assert.ok(!ids.includes('user:' + U.guest), 'a guest is never offered');
    });

    await t('Alen creates a task for Laura → todo, activity row, ONE email to Laura', async () => {
        emails.length = 0;
        const r = await call('POST', '/api/v2/tasks', as.alen, { body: { title: '  Find Turkish Airlines flights for Boston  ', description: 'Sep 20 out, Sep 23 back, economy.', assigned_to: M.laura, due_date: '2026-09-22', priority: 'high' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        taskId = r.body.id;
        const task = r.body.task;
        assert.strictEqual(task.title, 'Find Turkish Airlines flights for Boston');
        assert.strictEqual(task.status, 'todo');
        assert.strictEqual(task.assigned_to, M.laura);
        assert.strictEqual(task.assignee_first, 'Laura');
        assert.strictEqual(task.creator_first, 'Alen');
        assert.strictEqual(task.due_date, '2026-09-22');
        assert.strictEqual(task.priority, 'high');
        assert.deepStrictEqual(sys(taskId).map(x => x.body), ['Alen created the task and tagged Laura']);
        assert.deepStrictEqual(task.people.map(p => [p.id, p.first]), [[M.laura, 'Laura']], 'the card carries its people');
        assert.deepStrictEqual(q.all('SELECT member_id FROM v2_task_people WHERE task_id = ?', [taskId]).map(r => r.member_id), [M.laura], 'assigned_to alone = one tag row');
        assert.strictEqual(emails.length, 1);
        assert.strictEqual(emails[0].to, 'laura.rodman@medx.hr');
        assert.strictEqual(emails[0].subject, 'Alen gave you a task: Find Turkish Airlines flights for Boston');
        assert.match(emails[0].html, /https:\/\/admin\.test\/tasks\//);
        assert.match(emails[0].html, /OPEN THE BOARD/);
    });

    await t('validation: empty title 400 · bad date 400 · bad priority 400 · unknown assignee 400', async () => {
        assert.strictEqual((await call('POST', '/api/v2/tasks', as.alen, { body: { title: '   ' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/tasks', as.alen, { body: { title: 'x', due_date: '22/09/2026' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/tasks', as.alen, { body: { title: 'x', priority: 'urgent' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/tasks', as.alen, { body: { title: 'x', assigned_to: 'nobody' } })).status, 400);
    });

    await t('badge: Laura has 1 open · Alen has 0 waiting', async () => {
        const l = (await call('GET', '/api/v2/tasks/badge', as.laura)).body;
        const a = (await call('GET', '/api/v2/tasks/badge', as.alen)).body;
        assert.strictEqual(l.assigned_open, 1); assert.strictEqual(l.done_unseen, 0);
        assert.strictEqual(a.assigned_open, 0); assert.strictEqual(a.done_unseen, 0);
    });

    await t('Laura starts it → doing, activity "moved to In progress", no email', async () => {
        emails.length = 0;
        const r = await call('PUT', `/api/v2/tasks/:id`, as.laura, { params: { id: taskId }, body: { status: 'doing' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.task.status, 'doing');
        assert.ok(sys(taskId).some(x => x.body === 'Laura moved to In progress' && x.kind === 'system'));
        assert.strictEqual(emails.length, 0);
    });

    await t('the result persists — text + links (a non-http "link" is dropped, duplicates collapse)', async () => {
        const r = await call('PUT', `/api/v2/tasks/:id/result`, as.laura, { params: { id: taskId }, body: {
            result_text: 'Best option: TK 82 BOS→IST 20 Sep 22:15, TK 1055 IST→ZAG. €612 return, 1 stop.',
            result_links: [{ url: 'https://www.turkishairlines.com/booking/XYZ', label: 'Turkish Airlines — the fare' }, 'https://www.google.com/flights?q=bos-zag', 'javascript:alert(1)', { url: 'https://www.google.com/flights?q=bos-zag', label: 'dup' }]
        } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.task.result_links.length, 2);
        assert.strictEqual(r.body.task.result_links[0].label, 'Turkish Airlines — the fare');
        const d = (await call('GET', `/api/v2/tasks/:id`, as.alen, { params: { id: taskId } })).body;
        assert.match(d.task.result_text, /TK 82/);
        assert.strictEqual(d.task.result_links.length, 2);
        assert.ok(d.comments.some(c => c.body === 'Laura added the result'));
        const stored = q.get('SELECT result_links FROM project_tasks WHERE id = ?', [taskId]).result_links;
        assert.ok(!/javascript:/.test(stored));
    });

    await t('Laura moves it to Done → completed_at set, ONE email to Alen quoting the result', async () => {
        emails.length = 0;
        const r = await call('PUT', `/api/v2/tasks/:id`, as.laura, { params: { id: taskId }, body: { status: 'done' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.task.status, 'done');
        assert.ok(r.body.task.completed_at, 'completed_at stamped');
        assert.strictEqual(r.body.task.seen_at, null);
        assert.strictEqual(emails.length, 1);
        assert.strictEqual(emails[0].to, 'juginovic.alen@gmail.com');
        assert.strictEqual(emails[0].subject, 'Laura finished: Find Turkish Airlines flights for Boston — result inside');
        assert.match(emails[0].html, /TK 82 BOS/);
        assert.match(emails[0].html, /turkishairlines\.com\/booking\/XYZ/);
        assert.match(emails[0].html, /SEE THE RESULT/);
    });

    await t('badge flips: Alen has 1 waiting to see · Laura has 0 open', async () => {
        const l = (await call('GET', '/api/v2/tasks/badge', as.laura)).body;
        const a = (await call('GET', '/api/v2/tasks/badge', as.alen)).body;
        assert.strictEqual(l.assigned_open, 0);
        assert.strictEqual(a.done_unseen, 1);
    });

    await t('a comment lands as kind "comment" beside the system rows; comment_count counts only comments', async () => {
        const r = await call('POST', `/api/v2/tasks/:id/comments`, as.alen, { params: { id: taskId }, body: { body: 'Perfect — book the 22:15 one, the Zagreb connection works.' } });
        assert.strictEqual(r.status, 200);
        const kinds = r.body.comments.map(c => c.kind);
        assert.ok(kinds.includes('comment') && kinds.includes('system'));
        assert.strictEqual(r.body.comments.filter(c => c.kind === 'comment').length, 1);
        assert.strictEqual(r.body.comments.find(c => c.kind === 'comment').author_name, 'Alen Juginovic');
        const list = (await call('GET', '/api/v2/tasks', as.alen)).body.tasks.find(x => x.id === taskId);
        assert.strictEqual(list.comment_count, 1);
        assert.strictEqual((await call('POST', `/api/v2/tasks/:id/comments`, as.alen, { params: { id: taskId }, body: { body: '  ' } })).status, 400);
    });

    await t('search reaches the result text, the comments and the title — and misses cleanly', async () => {
        const hit = async term => (await call('GET', '/api/v2/tasks', as.alen, { query: { q: term } })).body.tasks.map(x => x.id);
        assert.ok((await hit('TK 82')).includes(taskId), 'result text');
        assert.ok((await hit('turkishairlines')).includes(taskId), 'result link');
        assert.ok((await hit('zagreb connection')).includes(taskId), 'comment body');
        assert.ok((await hit('turkish flights')).includes(taskId), 'two tokens across title');
        assert.deepStrictEqual(await hit('zzz-nothing-here'), []);
    });

    await t('filters: assignee=me (Laura) · status=done · assignee=none', async () => {
        const mine = (await call('GET', '/api/v2/tasks', as.laura, { query: { assignee: 'me' } })).body.tasks;
        assert.ok(mine.every(x => x.assigned_to === M.laura) && mine.some(x => x.id === taskId));
        const done = (await call('GET', '/api/v2/tasks', as.alen, { query: { status: 'done' } })).body.tasks;
        assert.ok(done.length >= 1 && done.every(x => x.status === 'done'));
        const none = (await call('GET', '/api/v2/tasks', as.alen, { query: { assignee: 'none' } })).body.tasks;
        assert.ok(none.every(x => !x.assigned_to));
    });

    await t('files: upload (no S3 → the shared uploads root), signed link, gate, delete', async () => {
        const buf = Buffer.from('%PDF-1.7\nTurkish Airlines itinerary\n%%EOF');
        const up = await call('POST', `/api/v2/tasks/:id/files`, as.laura, { params: { id: taskId }, file: { originalname: 'TK itinerary — Boston.pdf', mimetype: 'application/pdf', buffer: buf, size: buf.length } });
        assert.strictEqual(up.status, 200, JSON.stringify(up.body));
        fileId = up.body.file.id;
        assert.strictEqual(up.body.file.name, 'TK itinerary — Boston.pdf');
        assert.strictEqual(up.body.file.size, buf.length);
        assert.match(up.body.file.url, /^\/api\/v2\/tasks\/files\/[^?]+\?exp=\d+&uid=u-laura&sig=[0-9a-f]{32}$/, 'the link names the viewer it was handed to');
        const row = q.get('SELECT * FROM task_files WHERE id = ?', [fileId]);
        assert.ok(row.file_path.startsWith(path.join(tmpRoot, 'user-portal', 'backend', 'uploads', 'tasks')), 'stored under the shared uploads root: ' + row.file_path);
        assert.ok(fs.existsSync(row.file_path));
        assert.ok(sys(taskId).some(x => x.body === 'Laura attached TK itinerary — Boston.pdf'));
        const list = (await call('GET', '/api/v2/tasks', as.alen)).body.tasks.find(x => x.id === taskId);
        assert.strictEqual(list.file_count, 1);
        // the signed link opens the file with NO session (that is the point of it — a plain <a href>)
        const u = new URL('https://x' + up.body.file.url);
        const okDl = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), uid: u.searchParams.get('uid'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(okDl.status, 200, JSON.stringify(okDl.body));
        assert.strictEqual(okDl.file, row.file_path);
        assert.match(String(okDl.headers['content-disposition']), /^attachment/);
        assert.strictEqual(okDl.headers['x-content-type-options'], 'nosniff');
        // a forged or expired signature falls back to the session gate → 401 without one
        const bad = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), uid: u.searchParams.get('uid'), sig: 'f'.repeat(32) } });
        assert.strictEqual(bad.status, 401);
        const expired = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: '1000', uid: u.searchParams.get('uid'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(expired.status, 401);
        // the viewer is part of the signature: another uid on the same sig, or a link without one, is no link
        const swapped = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), uid: U.alen, sig: u.searchParams.get('sig') } });
        assert.strictEqual(swapped.status, 401);
        const noUid = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(noUid.status, 401);
        // a signed link never mints a fresh one (?json=1 hands back the SAME link, so it runs out and a
        // link held after a reassignment cannot renew itself)
        // (a link minted 100 s earlier than a fresh one would be, so a renewal cannot pass by coincidence)
        const exp2 = Number(u.searchParams.get('exp')) - 100;
        const sig2 = require('node:crypto').createHmac('sha256', 'tasks-test-secret').update('task-file:' + fileId + ':' + exp2 + ':' + U.laura).digest('hex').slice(0, 32);
        const again = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: String(exp2), uid: U.laura, sig: sig2, json: '1' } });
        assert.strictEqual(again.status, 200, JSON.stringify(again.body));
        assert.strictEqual(again.body.url, `/api/v2/tasks/files/${encodeURIComponent(fileId)}?exp=${exp2}&uid=${U.laura}&sig=${sig2}`, 'the same exp + uid + sig, not a renewal');
        // …and a Bearer session is always enough
        const withSession = await call('GET', '/api/v2/tasks/files/:fid', as.alen, { params: { fid: fileId }, query: { json: '1' } });
        assert.strictEqual(withSession.status, 200);
        assert.strictEqual(withSession.body.name, 'TK itinerary — Boston.pdf');
        // the file name is searchable too
        assert.ok((await call('GET', '/api/v2/tasks', as.alen, { query: { q: 'itinerary' } })).body.tasks.some(x => x.id === taskId));
        // empty upload → 400
        assert.strictEqual((await call('POST', `/api/v2/tasks/:id/files`, as.laura, { params: { id: taskId }, file: { originalname: 'e.txt', buffer: Buffer.alloc(0), size: 0 } })).status, 400);
        // delete
        const del = await call('DELETE', '/api/v2/tasks/files/:fid', as.alen, { params: { fid: fileId } });
        assert.strictEqual(del.status, 200);
        assert.ok(!fs.existsSync(row.file_path), 'local file unlinked');
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM task_files WHERE id = ?', [fileId]).c, 0);
        assert.ok(sys(taskId).some(x => x.body === 'Alen removed TK itinerary — Boston.pdf'));
    });

    await t('Alen marks it SEEN → status seen, seen_at/by, badge back to 0, activity row', async () => {
        const r = await call('POST', `/api/v2/tasks/:id/seen`, as.alen, { params: { id: taskId } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.task.status, 'seen');
        assert.ok(r.body.task.seen_at);
        assert.strictEqual(r.body.task.seen_by, U.alen);
        assert.strictEqual(r.body.task.seen_by_name, 'Alen Juginovic');
        assert.ok(r.body.task.completed_at, 'completion time kept');
        assert.strictEqual((await call('GET', '/api/v2/tasks/badge', as.alen)).body.done_unseen, 0);
        assert.ok(sys(taskId).some(x => x.body === 'Alen marked it seen'));
    });

    await t('reopen (seen → todo) clears completed_at and the seen stamp; the result stays', async () => {
        const r = await call('PUT', `/api/v2/tasks/:id`, as.alen, { params: { id: taskId }, body: { status: 'todo' } });
        assert.strictEqual(r.body.task.status, 'todo');
        assert.strictEqual(r.body.task.completed_at, null);
        assert.strictEqual(r.body.task.seen_at, null);
        assert.match(r.body.task.result_text, /TK 82/);
        assert.ok(sys(taskId).some(x => x.body === 'Alen moved to To do (reopened)'));
        // back to seen for the archive step
        await call('PUT', `/api/v2/tasks/:id`, as.laura, { params: { id: taskId }, body: { status: 'done' } });
        await call('POST', `/api/v2/tasks/:id/seen`, as.alen, { params: { id: taskId } });
    });

    await t('editing title / notes / due / priority / assignee writes one activity row each; unchanged → no row', async () => {
        const before = sys(taskId).length;
        const r = await call('PUT', `/api/v2/tasks/:id`, as.alen, { params: { id: taskId }, body: { title: 'Turkish Airlines flights — Boston trip', description: 'Sep 20 out, Sep 23 back. Economy is fine.', due_date: '2026-09-21', priority: 'medium' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(sys(taskId).length - before, 4);
        const again = await call('PUT', `/api/v2/tasks/:id`, as.alen, { params: { id: taskId }, body: { title: 'Turkish Airlines flights — Boston trip' } });
        assert.strictEqual(again.body.unchanged, true);
        assert.strictEqual(sys(taskId).length - before, 4);
    });

    await t('re-assigning to an admin WITHOUT a team row (user:<id>) creates the row and emails him; self-assign emails nobody', async () => {
        emails.length = 0;
        const r = await call('PUT', `/api/v2/tasks/:id`, as.alen, { params: { id: taskId }, body: { assigned_to: 'user:' + U.miro } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const tm = q.get('SELECT * FROM team_members WHERE user_id = ?', [U.miro]);
        assert.ok(tm, 'team row created');
        assert.strictEqual(r.body.task.assigned_to, tm.id);
        assert.strictEqual(r.body.task.assignee_first, 'Miro');
        assert.strictEqual(emails.length, 1);
        assert.strictEqual(emails[0].to, 'vp@medx.hr');
        assert.ok(sys(taskId).some(x => x.body === 'Alen tagged Miro'), 'assigned_to alone = the one person: Miro tagged…');
        assert.ok(sys(taskId).some(x => x.body === 'Alen removed Laura'), '…and Laura taken off');
        assert.deepStrictEqual(r.body.task.people.map(p => p.first), ['Miro']);
        emails.length = 0;
        await call('PUT', `/api/v2/tasks/:id`, as.alen, { params: { id: taskId }, body: { assigned_to: M.alen } });
        assert.strictEqual(emails.length, 0, 'no email to yourself');
    });

    await t('emails never go to a guest (team row linked to a non-admin) or to a row with no account', async () => {
        emails.length = 0;
        const g = await call('POST', '/api/v2/tasks', as.alen, { body: { title: 'Guest-assigned task', assigned_to: M.guest } });
        assert.strictEqual(g.status, 200);
        const i = await call('POST', '/api/v2/tasks', as.alen, { body: { title: 'Ivan task', assigned_to: M.ivan } });
        assert.strictEqual(i.status, 200);
        assert.strictEqual(emails.length, 0);
        // done by a self-creator → no email either
        await call('PUT', `/api/v2/tasks/:id`, as.alen, { params: { id: i.body.id }, body: { status: 'done' } });
        assert.strictEqual(emails.length, 0);
        await call('DELETE', '/api/admin/tasks/:id', as.alen, { params: { id: g.body.id } });
        await call('DELETE', '/api/admin/tasks/:id', as.alen, { params: { id: i.body.id } });
    });

    await t('archive hides it from the default list and the badge; archived=1 shows it; unarchive brings it back', async () => {
        // make it "done, unseen" first so the badge has something to lose. Alen (the creator) hands it
        // back to Laura — at this point it sits on Alen's own row, so Laura cannot see it (the 25 Sept rule)
        await call('PUT', `/api/v2/tasks/:id`, as.alen, { params: { id: taskId }, body: { assigned_to: M.laura } });
        await call('PUT', `/api/v2/tasks/:id`, as.laura, { params: { id: taskId }, body: { status: 'done' } });
        assert.strictEqual((await call('GET', '/api/v2/tasks/badge', as.alen)).body.done_unseen, 1);
        const a = await call('POST', `/api/v2/tasks/:id/archive`, as.alen, { params: { id: taskId } });
        assert.strictEqual(a.status, 200);
        assert.ok(a.body.task.archived_at);
        assert.ok(!(await call('GET', '/api/v2/tasks', as.alen)).body.tasks.some(x => x.id === taskId), 'hidden by default');
        assert.ok((await call('GET', '/api/v2/tasks', as.alen, { query: { archived: '1' } })).body.tasks.some(x => x.id === taskId), 'listed under archived');
        assert.strictEqual((await call('GET', '/api/v2/tasks/badge', as.alen)).body.done_unseen, 0, 'archived rows leave the badge');
        assert.ok(!(await call('GET', '/api/admin/tasks', as.alen)).body.some(x => x.id === taskId), 'legacy list hides archived rows too');
        const u = await call('POST', `/api/v2/tasks/:id/unarchive`, as.alen, { params: { id: taskId } });
        assert.strictEqual(u.body.task.archived_at, null);
        assert.ok((await call('GET', '/api/v2/tasks', as.alen)).body.tasks.some(x => x.id === taskId));
        assert.ok(sys(taskId).some(x => x.body === 'Alen archived it') && sys(taskId).some(x => x.body === 'Alen brought it back from the archive'));
    });

    await t('legacy /api/admin/tasks: list shape (assignee_name, status done for seen rows), create, tick, untick, delete', async () => {
        await call('POST', `/api/v2/tasks/:id/seen`, as.alen, { params: { id: taskId } });
        const rows = (await call('GET', '/api/admin/tasks', as.alen)).body;
        assert.ok(Array.isArray(rows));
        const mine = rows.find(x => x.id === taskId);
        assert.strictEqual(mine.assignee_name, 'Laura Rodman');
        assert.strictEqual(mine.status, 'done', 'a seen task reads as done for legacy callers');
        assert.strictEqual(mine.board_status, 'seen');
        const byProject = (await call('GET', '/api/admin/tasks', as.alen, { query: { project: 'plexus' } })).body;
        assert.ok(byProject.length >= 3 && byProject.every(x => x.project === 'plexus'));
        // the old Today card's POST — { title, assigned_to, due_date, project } → { success, id }
        emails.length = 0;
        const c = await call('POST', '/api/admin/tasks', as.alen, { body: { title: 'Book the Esplanade tasting call', assigned_to: M.laura, due_date: '2026-09-27', project: 'general' } });
        assert.strictEqual(c.status, 200);
        assert.ok(c.body.success && c.body.id);
        assert.strictEqual(emails.length, 1, 'the legacy create still tells the assignee');
        const created = q.get('SELECT * FROM project_tasks WHERE id = ?', [c.body.id]);
        assert.strictEqual(created.status, 'todo');
        assert.strictEqual(created.created_by, U.alen);
        // tick = done; the board sees it as done; untick = todo
        assert.strictEqual((await call('PUT', '/api/admin/tasks/:id', as.laura, { params: { id: c.body.id }, body: { done: true } })).status, 200);
        assert.strictEqual(q.get('SELECT status FROM project_tasks WHERE id = ?', [c.body.id]).status, 'done');
        assert.strictEqual((await call('GET', '/api/v2/tasks/badge', as.alen)).body.done_unseen, 1);
        assert.strictEqual((await call('PUT', '/api/admin/tasks/:id', as.laura, { params: { id: c.body.id }, body: { done: 0 } })).status, 200);
        assert.strictEqual(q.get('SELECT status FROM project_tasks WHERE id = ?', [c.body.id]).status, 'todo');
        // a legacy `status` write in the old vocabulary lands normalised
        await call('PUT', '/api/admin/tasks/:id', as.laura, { params: { id: c.body.id }, body: { status: 'in_progress' } });
        assert.strictEqual(q.get('SELECT status FROM project_tasks WHERE id = ?', [c.body.id]).status, 'doing');
        assert.strictEqual((await call('PUT', '/api/admin/tasks/:id', as.alen, { params: { id: 'nope' }, body: { done: true } })).status, 404);
        const d = await call('DELETE', '/api/admin/tasks/:id', as.alen, { params: { id: c.body.id } });
        assert.strictEqual(d.status, 200);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM project_tasks WHERE id = ?', [c.body.id]).c, 0);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM v2_task_comments WHERE task_id = ?', [c.body.id]).c, 0, 'its activity rows go with it');
        assert.strictEqual((await call('DELETE', '/api/admin/tasks/:id', as.alen, { params: { id: c.body.id } })).status, 404);
    });

    await t('an admin account and an unlinked team row with the same name are joined once (the seed leaves Laura unlinked)', async () => {
        q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES ('u-petra', 'petra@medx.hr', 'Petra', 'Horvat', 1)`);
        q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES ('tm-petra', NULL, 'Petra Horvat', 'Marketing')`);
        const people = (await call('GET', '/api/v2/tasks', as.alen)).body.people;
        const petra = people.filter(p => /petra/i.test(p.name));
        assert.strictEqual(petra.length, 1, 'offered once, not as a team row AND a user: entry');
        assert.strictEqual(petra[0].id, 'tm-petra');
        assert.strictEqual(petra[0].email, 'petra@medx.hr');
        assert.strictEqual(q.get(`SELECT user_id FROM team_members WHERE id = 'tm-petra'`).user_id, 'u-petra');
        emails.length = 0;
        const r = await call('POST', '/api/v2/tasks', as.alen, { body: { title: 'Petra task', assigned_to: 'tm-petra' } });
        assert.strictEqual(emails.length, 1); assert.strictEqual(emails[0].to, 'petra@medx.hr');
        await call('DELETE', '/api/admin/tasks/:id', as.alen, { params: { id: r.body.id } });
    });

    await t('PRIVACY: a team row that already carries a task is never linked by name (names are self-editable)', async () => {
        // a task on the unlinked row "Ivan Nikolic" is seen only by its creator; an admin with no team row
        // who renames themself "Ivan Nikolic" must not inherit it by opening the board
        q.run(`INSERT INTO project_tasks (id, project, title, status, assigned_to, created_by, updated_at) VALUES ('ivan-task', 'general', 'Qzv Ivan private errand', 'todo', ?, ?, ?)`, [M.ivan, U.alen, new Date().toISOString()]);
        q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES ('u-imp', 'imp@example.com', 'Ivan', 'Nikolic', 1)`);
        const imp = { id: 'u-imp', email: 'imp@example.com', is_admin: 1 };
        const r = await call('GET', '/api/v2/tasks', imp);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(q.get(`SELECT user_id FROM team_members WHERE id = ?`, [M.ivan]).user_id, null, 'the row with a task stays unlinked');
        assert.ok(!r.body.tasks.some(x => x.id === 'ivan-task'), 'the task is not on the renamed admin\'s board');
        assert.strictEqual((await call('GET', '/api/v2/tasks/:id', imp, { params: { id: 'ivan-task' } })).status, 404);
        assert.strictEqual((await call('POST', '/api/v2/tasks', imp, { body: { title: 'x', assigned_to: 'user:u-imp' } })).status, 200, 'assigning to them makes their OWN row');
        assert.notStrictEqual(q.get(`SELECT id FROM team_members WHERE user_id = 'u-imp'`).id, M.ivan);
        // the one earlier name link (Petra, no tasks on her row) was logged
        assert.ok(q.get(`SELECT detail FROM audit_log WHERE action = 'team.link' AND detail LIKE '%tm-petra%'`), 'a name link leaves an audit row');
        q.run(`DELETE FROM project_tasks WHERE id = 'ivan-task' OR created_by = 'u-imp'`);
        q.run(`DELETE FROM team_members WHERE user_id = 'u-imp'`);
        q.run(`DELETE FROM users WHERE id = 'u-imp'`);
    });

    await t('a stale unlinked team row beside a linked row of the same name is offered once (the live DB has two Laura rows)', async () => {
        q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES ('tm-laura-stale', NULL, 'Laura Rodman', 'Executive Assistant')`);
        const people = (await call('GET', '/api/v2/tasks', as.alen)).body.people;
        const lauras = people.filter(p => /^laura rodman$/i.test(p.name));
        assert.strictEqual(lauras.length, 1);
        assert.strictEqual(lauras[0].id, M.laura, 'the linked row is the person');
        assert.strictEqual(lauras[0].email, 'laura.rodman@medx.hr');
        // a task already on the stale row still shows her name
        q.run(`INSERT INTO project_tasks (id, project, title, status, assigned_to, created_by, updated_at) VALUES ('stale-task', 'general', 'Old task on the stale row', 'todo', 'tm-laura-stale', ?, ?)`, [U.alen, new Date().toISOString()]);
        const row = (await call('GET', '/api/v2/tasks', as.alen)).body.tasks.find(x => x.id === 'stale-task');
        assert.strictEqual(row.assignee_first, 'Laura');
        q.run(`DELETE FROM project_tasks WHERE id = 'stale-task'`);
    });

    // ================================================================ PRIVACY (Alen, 25 Sept 2026)
    // "if Laura tags me I only see that task … some of it's gonna be personal": a task is seen ONLY by its
    // creator and its assignee. A = Laura (creates) · B = Alen (assignee, and the founder — no override)
    // · C = Miro (neither) · D = Dora (gets it on reassignment).
    q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES ('u-dora', 'dora@medx.hr', 'Dora', 'Kovac', 1)`);
    q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES ('tm-dora', 'u-dora', 'Dora Kovac', 'Team')`);
    as.dora = { id: 'u-dora', email: 'dora@medx.hr', is_admin: 1 };
    let pid = null, pfid = null, pfurl = null, afurl = null;
    const MISSING = 'no-such-task-000';
    const listIds = async (user, query) => (await call('GET', '/api/v2/tasks', user, { query: query || {} })).body.tasks.map(x => x.id);
    const legacyIds = async user => (await call('GET', '/api/admin/tasks', user)).body.map(x => x.id);
    // every task route, as one caller, for one id → [status, body] — so a hidden task can be compared with a missing one
    const everyRoute = async (user, id) => {
        const pdf = () => ({ originalname: 'x.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7 x'), size: 10 });
        const out = {};
        const hit = async (k, m, p, opts) => { const r = await call(m, p, user, Object.assign({ params: { id } }, opts || {})); out[k] = [r.status, r.body]; };
        await hit('detail', 'GET', '/api/v2/tasks/:id');
        await hit('put', 'PUT', '/api/v2/tasks/:id', { body: { title: 'Hijacked', status: 'done', assigned_to: 'tm-miro-x' } });
        await hit('putStatus', 'PUT', '/api/v2/tasks/:id', { body: { status: 'done' } });
        await hit('result', 'PUT', '/api/v2/tasks/:id/result', { body: { result_text: 'overwritten' } });
        await hit('seen', 'POST', '/api/v2/tasks/:id/seen');
        await hit('archive', 'POST', '/api/v2/tasks/:id/archive');
        await hit('unarchive', 'POST', '/api/v2/tasks/:id/unarchive');
        await hit('commentsGet', 'GET', '/api/v2/tasks/:id/comments');
        await hit('commentsPost', 'POST', '/api/v2/tasks/:id/comments', { body: { body: 'peeking' } });
        await hit('filesGet', 'GET', '/api/v2/tasks/:id/files');
        await hit('filesPost', 'POST', '/api/v2/tasks/:id/files', { file: pdf() });
        await hit('legacyTick', 'PUT', '/api/admin/tasks/:id', { body: { done: true } });
        await hit('legacyEdit', 'PUT', '/api/admin/tasks/:id', { body: { title: 'Hijacked' } });
        await hit('legacyDelete', 'DELETE', '/api/admin/tasks/:id');
        return out;
    };

    await t('PRIVACY: Laura gives Alen a task (with a comment and a file) → one email, to Alen only', async () => {
        emails.length = 0;
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Dentist on Tuesday — move the call', description: 'personal', assigned_to: M.alen, due_date: '2026-09-01', priority: 'high' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        pid = r.body.id;
        assert.strictEqual((await call('POST', '/api/v2/tasks/:id/comments', as.laura, { params: { id: pid }, body: { body: 'the 10:00 one' } })).status, 200);
        const buf = Buffer.from('%PDF-1.7\nappointment\n%%EOF');
        const up = await call('POST', '/api/v2/tasks/:id/files', as.laura, { params: { id: pid }, file: { originalname: 'appointment.pdf', mimetype: 'application/pdf', buffer: buf, size: buf.length } });
        assert.strictEqual(up.status, 200, JSON.stringify(up.body));
        pfid = up.body.file.id; pfurl = up.body.file.url;
        assert.deepStrictEqual(emails.map(e => e.to), ['juginovic.alen@gmail.com'], 'the assign email goes to the assignee and nobody else');
    });

    await t('PRIVACY: Miro (neither creator nor assignee) gets the SAME 404 as a missing task on every route, and nothing changes', async () => {
        const before = q.get('SELECT title, status, archived_at, result_text, assigned_to FROM project_tasks WHERE id = ?', [pid]);
        const nComments = q.get('SELECT COUNT(*) AS c FROM v2_task_comments WHERE task_id = ?', [pid]).c;
        const nFiles = q.get('SELECT COUNT(*) AS c FROM task_files WHERE task_id = ?', [pid]).c;
        emails.length = 0;
        const hidden = await everyRoute(as.miro, pid);
        const missing = await everyRoute(as.miro, MISSING);
        for (const k of Object.keys(hidden)) {
            assert.strictEqual(hidden[k][0], 404, k + ' must be 404, got ' + hidden[k][0] + ' ' + JSON.stringify(hidden[k][1]));
            assert.deepStrictEqual(hidden[k], missing[k], k + ': a hidden task must answer exactly like a missing one');
        }
        // the file routes by file id: a Bearer that is not a participant gets the same 404 as a missing file
        const dl = await call('GET', '/api/v2/tasks/files/:fid', as.miro, { params: { fid: pfid }, query: { json: '1' } });
        const dlMissing = await call('GET', '/api/v2/tasks/files/:fid', as.miro, { params: { fid: 'no-such-file' }, query: { json: '1' } });
        assert.strictEqual(dl.status, 404); assert.deepStrictEqual([dl.status, dl.body], [dlMissing.status, dlMissing.body]);
        const rm = await call('DELETE', '/api/v2/tasks/files/:fid', as.miro, { params: { fid: pfid } });
        const rmMissing = await call('DELETE', '/api/v2/tasks/files/:fid', as.miro, { params: { fid: 'no-such-file' } });
        assert.strictEqual(rm.status, 404); assert.deepStrictEqual([rm.status, rm.body], [rmMissing.status, rmMissing.body]);
        // nothing moved
        assert.deepStrictEqual(q.get('SELECT title, status, archived_at, result_text, assigned_to FROM project_tasks WHERE id = ?', [pid]), before);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM v2_task_comments WHERE task_id = ?', [pid]).c, nComments);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM task_files WHERE task_id = ?', [pid]).c, nFiles);
        assert.strictEqual(emails.length, 0);
    });

    await t('PRIVACY: Miro finds it nowhere — board (every filter), search, badge, legacy list', async () => {
        for (const query of [{}, { assignee: 'all' }, { assignee: M.alen }, { assignee: 'me' }, { status: 'todo' }, { archived: '1' }, { q: 'dentist' }, { q: 'appointment' }, { q: '10:00' }]) {
            assert.ok(!(await listIds(as.miro, query)).includes(pid), 'visible to Miro with ' + JSON.stringify(query));
        }
        assert.ok(!(await legacyIds(as.miro)).includes(pid));
        const b = (await call('GET', '/api/v2/tasks/badge', as.miro)).body;
        assert.strictEqual(b.assigned_open, 0); assert.strictEqual(b.done_unseen, 0);
        // Miro sees only his own: nothing he made, nothing given to him that is still his
        const mine = await listIds(as.miro);
        for (const id of mine) {
            const r = q.get(`SELECT created_by, assigned_to FROM project_tasks WHERE id = ?`, [id]);
            const his = q.get(`SELECT id FROM team_members WHERE user_id = ?`, [U.miro]);
            assert.ok(r.created_by === U.miro || (his && r.assigned_to === his.id), 'Miro sees a task that is not his: ' + id);
        }
    });

    await t('PRIVACY: Alen (the assignee) sees it everywhere — detail, board, MINE, search, badge, legacy list, the file by Bearer', async () => {
        const d = await call('GET', '/api/v2/tasks/:id', as.alen, { params: { id: pid } });
        assert.strictEqual(d.status, 200);
        assert.strictEqual(d.body.task.creator_first, 'Laura');
        assert.strictEqual(d.body.files.length, 1);
        assert.ok((await listIds(as.alen)).includes(pid));
        assert.ok((await listIds(as.alen, { assignee: 'me' })).includes(pid));
        assert.ok((await listIds(as.alen, { q: 'dentist' })).includes(pid));
        assert.ok((await legacyIds(as.alen)).includes(pid));
        assert.ok((await call('GET', '/api/v2/tasks/badge', as.alen)).body.assigned_open >= 1);
        const dl = await call('GET', '/api/v2/tasks/files/:fid', as.alen, { params: { fid: pfid }, query: { json: '1' } });
        assert.strictEqual(dl.status, 200); assert.strictEqual(dl.body.name, 'appointment.pdf');
        assert.match(dl.body.url, new RegExp('&uid=' + U.alen + '&'), 'a Bearer caller is handed a link in their own name');
        afurl = dl.body.url;
        const au = new URL('https://x' + afurl);
        const byLink = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: pfid }, query: { exp: au.searchParams.get('exp'), uid: au.searchParams.get('uid'), sig: au.searchParams.get('sig') } });
        assert.strictEqual(byLink.status, 200, 'his link opens the file while he is on the task');
    });

    await t('PRIVACY: no founder override — a task Laura keeps for herself is a 404 for Alen and missing from his board', async () => {
        const own = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Laura personal errand', assigned_to: M.laura } });
        assert.strictEqual(own.status, 200);
        const hidden = await call('GET', '/api/v2/tasks/:id', as.alen, { params: { id: own.body.id } });
        const missing = await call('GET', '/api/v2/tasks/:id', as.alen, { params: { id: MISSING } });
        assert.deepStrictEqual([hidden.status, hidden.body], [missing.status, missing.body]);
        assert.strictEqual(hidden.status, 404);
        assert.ok(!(await listIds(as.alen)).includes(own.body.id));
        assert.ok(!(await legacyIds(as.alen)).includes(own.body.id));
        assert.ok((await listIds(as.laura)).includes(own.body.id));
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id: own.body.id } });
    });

    await t('PRIVACY: reassign B→D — Alen hands it to Dora: the answer carries no card, Alen loses it, Dora gains it, Laura keeps it', async () => {
        emails.length = 0;
        const r = await call('PUT', '/api/v2/tasks/:id', as.alen, { params: { id: pid }, body: { assigned_to: 'tm-dora' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.handed_off, true);
        assert.strictEqual(r.body.task, null, 'the one who handed it off gets no copy of the card back');
        assert.deepStrictEqual(emails.map(e => e.to), ['dora@medx.hr'], 'the new assignee is told, nobody else');
        // Alen: gone everywhere, same 404 as a missing task
        const a = await call('GET', '/api/v2/tasks/:id', as.alen, { params: { id: pid } });
        assert.strictEqual(a.status, 404);
        assert.ok(!(await listIds(as.alen)).includes(pid));
        assert.ok(!(await legacyIds(as.alen)).includes(pid));
        assert.strictEqual((await call('GET', '/api/v2/tasks/files/:fid', as.alen, { params: { fid: pfid }, query: { json: '1' } })).status, 404);
        // Dora: there, with its history
        const d = await call('GET', '/api/v2/tasks/:id', as.dora, { params: { id: pid } });
        assert.strictEqual(d.status, 200);
        assert.ok((await listIds(as.dora, { assignee: 'me' })).includes(pid));
        assert.strictEqual((await call('GET', '/api/v2/tasks/badge', as.dora)).body.assigned_open, 1);
        assert.strictEqual((await call('GET', '/api/v2/tasks/:id/comments', as.dora, { params: { id: pid } })).status, 200);
        // Laura (creator): always
        assert.strictEqual((await call('GET', '/api/v2/tasks/:id', as.laura, { params: { id: pid } })).status, 200);
        assert.ok((await listIds(as.laura)).includes(pid));
        // Miro: still nothing
        assert.strictEqual((await call('GET', '/api/v2/tasks/:id', as.miro, { params: { id: pid } })).status, 404);
    });

    await t('PRIVACY: the creator always sees it — Laura unassigns it: Dora loses it, Laura still has it (and can finish it)', async () => {
        const r = await call('PUT', '/api/v2/tasks/:id', as.laura, { params: { id: pid }, body: { assigned_to: '' } });
        assert.strictEqual(r.status, 200); assert.ok(r.body.task && r.body.task.id === pid, 'the creator keeps the card');
        assert.strictEqual((await call('GET', '/api/v2/tasks/:id', as.dora, { params: { id: pid } })).status, 404);
        assert.ok(!(await listIds(as.dora)).includes(pid));
        assert.strictEqual((await call('PUT', '/api/v2/tasks/:id', as.laura, { params: { id: pid }, body: { status: 'done' } })).status, 200);
    });

    await t('PRIVACY: a signed file link (handed only to a participant) still opens without a session', async () => {
        const u = new URL('https://x' + pfurl);
        const r = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: pfid }, query: { exp: u.searchParams.get('exp'), uid: u.searchParams.get('uid'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    });

    await t('PRIVACY: a signed link stops the moment its holder is off the task (inside its hour), with the missing-file answer', async () => {
        const au = new URL('https://x' + afurl);
        const q1 = { exp: au.searchParams.get('exp'), uid: au.searchParams.get('uid'), sig: au.searchParams.get('sig') };
        assert.ok(Number(q1.exp) > Math.floor(Date.now() / 1000), 'the link is still inside its hour');
        const gone = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: pfid }, query: q1 });
        const goneJson = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: pfid }, query: Object.assign({ json: '1' }, q1) });
        const missing = await call('GET', '/api/v2/tasks/files/:fid', as.alen, { params: { fid: 'no-such-file' } });
        assert.deepStrictEqual([gone.status, gone.body], [missing.status, missing.body], 'Alen, handed off, gets the missing-file answer');
        assert.deepStrictEqual([goneJson.status, goneJson.body], [missing.status, missing.body], 'and ?json=1 hands him no link either');
        // Laura (its creator, so still on it) is handed a link in her own name that opens it
        const ld = await call('GET', '/api/v2/tasks/:id', as.laura, { params: { id: pid } });
        assert.strictEqual(ld.status, 200);
        const lu = new URL('https://x' + ld.body.files[0].url);
        assert.strictEqual(lu.searchParams.get('uid'), U.laura);
        assert.strictEqual((await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: pfid }, query: { exp: lu.searchParams.get('exp'), uid: lu.searchParams.get('uid'), sig: lu.searchParams.get('sig') } })).status, 200);
    });

    await t('PRIVACY: a signed link opens only while the account it names is still an admin, and a malformed signature is a 401, never a 500', async () => {
        const ld = await call('GET', '/api/v2/tasks/:id', as.laura, { params: { id: pid } });
        const lu = new URL('https://x' + ld.body.files[0].url);
        const lq = { exp: lu.searchParams.get('exp'), uid: lu.searchParams.get('uid'), sig: lu.searchParams.get('sig') };
        const dl = query => call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: pfid }, query });
        // 32 characters but not 32 bytes: compared by byte length first, so the session gate answers (it used to throw)
        for (const sig of ['\u00e9'.repeat(32), '\u6587'.repeat(32), '\ud83d\ude00'.repeat(16)]) {
            assert.strictEqual(sig.length, 32);
            const r = await dl(Object.assign({}, lq, { sig }));
            assert.strictEqual(r.status, 401, 'sig of ' + Buffer.byteLength(sig) + ' bytes');
        }
        assert.strictEqual((await dl(lq)).status, 200);
        q.run('UPDATE users SET is_admin = 0 WHERE id = ?', [U.laura]);
        try { assert.strictEqual((await dl(lq)).status, 401, 'no longer an admin: the link is no link, the session gate answers'); }
        finally { q.run('UPDATE users SET is_admin = 1 WHERE id = ?', [U.laura]); }
        assert.strictEqual((await dl(lq)).status, 200, 'an admin again: it opens');
        // a correctly signed link naming an account that does not exist is no link either
        const nobodySig = require('node:crypto').createHmac('sha256', 'tasks-test-secret').update('task-file:' + pfid + ':' + lq.exp + ':u-nobody').digest('hex').slice(0, 32);
        assert.strictEqual((await dl(Object.assign({}, lq, { uid: 'u-nobody', sig: nobodySig }))).status, 401, 'an account that does not exist');
    });

    await t('PRIVACY: the audit trail carries task ids, never a title (the audit feed is read by every admin)', () => {
        const leaked = q.all(`SELECT action, detail FROM audit_log WHERE action LIKE 'task.%' AND (detail LIKE '%Dentist%' OR detail LIKE '%appointment%' OR detail LIKE '%personal errand%')`);
        assert.deepStrictEqual(leaked, []);
        assert.ok(q.get(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'task.create' AND detail = ?`, ['task ' + pid]).c === 1);
    });

    await t('PRIVACY: the helper itself — duplicate team rows, subtasks follow the parent, orphans and deeper chains fail closed, no user sees nothing', () => {
        const vis = require(path.join(ROOT, 'shared/task-visibility.js'));
        const d2 = createDatabase(Database, { localPath: ':memory:' });
        // no UNIQUE on user_id here: an account with TWO team rows must match through either one
        d2.run(`CREATE TABLE team_members (id TEXT PRIMARY KEY, user_id TEXT, name TEXT)`);
        d2.run(`CREATE TABLE project_tasks (id TEXT PRIMARY KEY, title TEXT, created_by TEXT, assigned_to TEXT, parent_id TEXT)`);
        d2.run(`CREATE TABLE task_files (id TEXT PRIMARY KEY, task_id TEXT)`);
        d2.run(`CREATE TABLE nag_items (id TEXT PRIMARY KEY, kind TEXT, subject_id TEXT)`);
        vis.ensureTaskPeopleTable(sql => d2.run(sql));
        vis.ensureTaskPeopleTable(sql => d2.run(sql));   // idempotent
        const g2 = (sql, p) => { const st = d2.prepare(sql); st.bind(p || []); const r = st.step() ? st.getAsObject() : null; st.free(); return r; };
        const all2 = (sql, p) => { const st = d2.prepare(sql); st.bind(p || []); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
        d2.run(`INSERT INTO team_members VALUES ('tmB1','uB','B'),('tmB2','uB','B again'),('tmD','uD','D'),('tmLoose',NULL,'B stale')`);
        d2.run(`INSERT INTO project_tasks VALUES
            ('t1','for B on row 2','uA','tmB2',NULL),
            ('s1','subtask of t1 by D','uD',NULL,'t1'),
            ('ss1','sub-subtask','uA',NULL,'s1'),
            ('orph','orphan subtask','uA',NULL,'gone'),
            ('nobody','seed row, no creator no assignee',NULL,NULL,NULL),
            ('loose','on a team row with no account','uA','tmLoose',''),
            ('empty','created_by empty string','',NULL,NULL)`);
        d2.run(`INSERT INTO task_files VALUES ('f1','t1'),('f2','orph')`);
        d2.run(`INSERT INTO nag_items VALUES ('n1','task_overdue','t1'),('n2','gala_unpaid','g1'),('n3','task_due_soon','nobody')`);
        const sees = uid => { const v = vis.visibleTaskSql('pt', uid); return all2(`SELECT pt.id FROM project_tasks pt WHERE ${v.sql} ORDER BY pt.id`, v.params).map(r => r.id); };
        assert.deepStrictEqual(sees('uA'), ['loose', 's1', 't1'], 'creator A: its tasks and their subtasks (never the orphan or the deeper chain)');
        assert.deepStrictEqual(sees('uB'), ['s1', 't1'], 'B through its SECOND team row, plus the subtask that follows the parent');
        assert.deepStrictEqual(sees('uD'), [], 'D made the subtask, but a subtask follows its parent — D is not on t1');
        assert.deepStrictEqual(sees('uC'), []);
        assert.deepStrictEqual(sees(''), [], 'no user id never matches the empty-string creator');
        assert.deepStrictEqual(sees(null), []);
        assert.ok(vis.canSeeTask(g2, 'uB', 't1') && !vis.canSeeTask(g2, 'uC', 't1') && !vis.canSeeTask(g2, 'uA', 'no-such'));
        assert.ok(vis.visibleTaskFile(g2, 'uB', 'f1') && !vis.visibleTaskFile(g2, 'uC', 'f1') && !vis.visibleTaskFile(g2, 'uA', 'f2'));
        const nags = uid => { const v = vis.visibleNagSql('nag_items', uid); return all2(`SELECT id FROM nag_items WHERE ${v.sql} ORDER BY id`, v.params).map(r => r.id); };
        assert.deepStrictEqual(nags('uB'), ['n1', 'n2'], 'the task nag for its assignee + every non-task nag');
        assert.deepStrictEqual(nags('uC'), ['n2'], 'a non-participant keeps the non-task nags only');
        // side channels: a task nudge only for its two parties (none at all with no user: a prompt),
        // a task audit row only for its actor, whole task tables never handed to the tech tools
        d2.run(`CREATE TABLE direct_messages (id TEXT, sender_id TEXT, receiver_id TEXT, sender_type TEXT, title TEXT)`);
        d2.run(`INSERT INTO direct_messages VALUES ('m1','uA','uB','admin','Task reminder'),('m2','uA','uB','admin','Hello'),('m3','uB','uA','user','Task reminder')`);
        const dms = uid => { const v = vis.taskReminderDmScope('dm', uid); return all2(`SELECT id FROM direct_messages dm WHERE ${v.sql} ORDER BY id`, v.params).map(r => r.id); };
        assert.deepStrictEqual(dms('uA'), ['m1', 'm2', 'm3']); assert.deepStrictEqual(dms('uB'), ['m1', 'm2', 'm3']);
        assert.deepStrictEqual(dms('uC'), ['m2', 'm3'], 'a third admin never gets the nudge (a member-sent row with that title is not one)');
        assert.deepStrictEqual(dms(null), ['m2', 'm3']);
        d2.run(`CREATE TABLE audit_log (id TEXT, actor_id TEXT, action TEXT, detail TEXT)`);
        d2.run(`INSERT INTO audit_log VALUES ('a1','uA','task.create','task t1'),('a2','uA','nag.act','task_overdue -> assignee nudged (B)'),('a3','uA','nag.done','n1 (+task completed)'),
                ('a4','uA','nag.act','gala_unpaid -> reminder queued'),('a5','uA','nag.dismiss','n2'),('a6','uA','login',NULL)`);
        const aud = uid => { const v = vis.taskAuditScope('al', uid); return all2(`SELECT id FROM audit_log al WHERE ${v.sql} ORDER BY id`, v.params).map(r => r.id); };
        assert.deepStrictEqual(aud('uA'), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
        assert.deepStrictEqual(aud('uC'), ['a4', 'a5', 'a6']);
        assert.ok(vis.isTaskPrivateTable('project_tasks') && vis.isTaskPrivateTable('_purged_task_files') && vis.isTaskPrivateTable('V2_TASK_COMMENTS') && !vis.isTaskPrivateTable('registrations'));
        assert.strictEqual(vis.techRowScope('registrations', 't', { id: 'uC' }), null);
        assert.throws(() => vis.visibleTaskSql('pt; DROP TABLE x', 'uA'));
        assert.ok(vis.isTaskPrivateTable('v2_task_people') && vis.isTaskPrivateTable('_purged_v2_task_people'), 'who is on a task is task content');
        // MORE THAN ONE PERSON: a tagged account sees the task (and its subtasks) through any of its team
        // rows; a tag row of a task whose assigned_to is not among its tag rows (an old one-person writer
        // moved it) is stale and counts for nobody; no assigned_to → no tag counts
        const run2 = (sql, p) => d2.run(sql, p);
        d2.run(`INSERT INTO team_members VALUES ('tmE','uE','E'),('tmF','uF','F')`);
        d2.run(`INSERT INTO project_tasks VALUES ('m1','multi','uA','tmB1',NULL),('m1s','sub of m1','uA',NULL,'m1'),('m2','stale','uA','tmD',NULL),('m3','cleared','uA',NULL,NULL)`);
        assert.deepStrictEqual(vis.setTaskPeople(run2, 'm1', ['tmB1', 'tmE', 'tmE', '', null, 'tmF'], 'uA', '2026-09-25T10:00:00Z'), ['tmB1', 'tmE', 'tmF'], 'duplicates and blanks collapse');
        vis.setTaskPeople(run2, 'm1s', ['tmD'], 'uA');                                 // a subtask's own tag row: the subtask follows its parent anyway
        d2.run(`INSERT INTO v2_task_people VALUES ('m2','tmE','uA','x'),('m2','tmF','uA','x'),('m3','tmE','uA','x')`);   // m2: assigned_to tmD is not tagged → stale
        assert.deepStrictEqual(sees('uE'), ['m1', 'm1s'], 'E: tagged on m1 (+ its subtask); m2 is stale, m3 has no one');
        assert.deepStrictEqual(sees('uF'), ['m1', 'm1s']);
        assert.deepStrictEqual(sees('uD'), ['m2'], 'D: the first person of m2; its own subtask tag on m1s grants nothing');
        assert.ok(vis.canSeeTask(g2, 'uB', 'm1') && vis.canSeeTask(g2, 'uE', 'm1s') && !vis.canSeeTask(g2, 'uE', 'm2') && !vis.canSeeTask(g2, 'uC', 'm1'));
        const on = uid => { const v = vis.onTaskSql('pt', uid); return all2(`SELECT pt.id FROM project_tasks pt WHERE pt.parent_id IS NULL AND ${v.sql} ORDER BY pt.id`, v.params).map(r => r.id); };
        assert.deepStrictEqual(on('uE'), ['m1']); assert.deepStrictEqual(on('uA'), [], 'the creator is not ON a task she only made'); assert.deepStrictEqual(on(null), []);
        const onM = mid => { const v = vis.onTaskMemberSql('pt', mid); return all2(`SELECT pt.id FROM project_tasks pt WHERE pt.parent_id IS NULL AND ${v.sql} ORDER BY pt.id`, v.params).map(r => r.id); };
        assert.deepStrictEqual(onM('tmF'), ['m1']); assert.deepStrictEqual(onM('tmD'), ['m2']); assert.deepStrictEqual(onM('tmB1'), ['m1']); assert.deepStrictEqual(onM('tmB2'), ['t1'], 'a team row, not the account');
        assert.deepStrictEqual(vis.orderTaskPeople('tmB1', ['tmE', 'tmB1', 'tmF']), ['tmB1', 'tmE', 'tmF'], 'the first person first, the rest in tag order');
        assert.deepStrictEqual(vis.orderTaskPeople('tmD', ['tmE', 'tmF']), ['tmD'], 'stale tags ignored');
        assert.deepStrictEqual(vis.orderTaskPeople(null, ['tmE']), [], 'no first person, no one');
        // untag the first person → the next one tagged is the first; untag everyone → assigned_to NULL
        vis.setTaskPeople(run2, 'm1', ['tmE', 'tmF'], 'uA');
        assert.strictEqual(g2(`SELECT assigned_to FROM project_tasks WHERE id = 'm1'`).assigned_to, 'tmE');
        assert.deepStrictEqual(sees('uB'), ['s1', 't1'], 'B lost m1 (and its subtask)');
        vis.setTaskPeople(run2, 'm1', [], 'uA');
        assert.strictEqual(g2(`SELECT assigned_to FROM project_tasks WHERE id = 'm1'`).assigned_to, null);
        assert.strictEqual(g2(`SELECT COUNT(*) AS c FROM v2_task_people WHERE task_id = 'm1'`).c, 0);
        assert.deepStrictEqual(sees('uE'), [], 'E lost it');
        assert.ok(vis.canSeeTask(g2, 'uA', 'm1'), 'the creator never does');
        vis.setTaskPeople(run2, 'm1', ['tmE'], 'uA');
        vis.deleteTaskPeople(run2, 'm1');
        assert.strictEqual(g2(`SELECT COUNT(*) AS c FROM v2_task_people WHERE task_id IN ('m1','m1s')`).c, 0, 'deleting a task deletes its tag rows and its subtasks\'');
        const nags2 = uid => { const v = vis.visibleNagSql('nag_items', uid); return all2(`SELECT id FROM nag_items WHERE ${v.sql} ORDER BY id`, v.params).map(r => r.id); };
        d2.run(`INSERT INTO nag_items VALUES ('n4','task_overdue','m2')`);
        assert.deepStrictEqual(nags2('uD'), ['n2', 'n4']); assert.deepStrictEqual(nags2('uE'), ['n2'], 'a stale tag never reaches the Action Center either');

        // THE ONE-PERSON TRIGGER: a write of assigned_to alone (the old portals) makes the task that person's
        // alone inside the database; a round trip back revives no one; setTaskPeople never trips it
        const tagsOf2 = id => all2('SELECT member_id FROM v2_task_people WHERE task_id = ? ORDER BY added_at, rowid', [id]).map(r => r.member_id);
        const first2 = id => g2('SELECT assigned_to FROM project_tasks WHERE id = ?', [id]).assigned_to;
        assert.strictEqual(g2(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_task_people_one_person_write'`).c, 1, 'created once (ensureTaskPeopleTable ran twice)');
        vis.setTaskPeople(run2, 'm1', ['tmB1', 'tmE', 'tmF'], 'uA');
        d2.run(`UPDATE project_tasks SET assigned_to = 'tmE' WHERE id = 'm1'`);            // (a) A→B, B already tagged
        assert.deepStrictEqual(tagsOf2('m1'), ['tmE']);
        assert.deepStrictEqual(sees('uB'), ['s1', 't1'], 'B (the previous first person) lost m1');
        assert.ok(!sees('uF').includes('m1'), 'F (tagged) lost m1');
        vis.setTaskPeople(run2, 'm1', ['tmB1', 'tmE', 'tmF'], 'uA');
        d2.run(`UPDATE project_tasks SET assigned_to = 'tmD' WHERE id = 'm1'`);            // (b) A→D, D untagged …
        assert.deepStrictEqual(tagsOf2('m1'), ['tmD']);
        d2.run(`UPDATE project_tasks SET assigned_to = 'tmB1' WHERE id = 'm1'`);           // … then D→A
        assert.deepStrictEqual(tagsOf2('m1'), ['tmB1'], 'the move back is to A alone');
        assert.ok(!sees('uE').includes('m1') && !sees('uF').includes('m1') && !sees('uD').includes('m1'), 'E and F stay off it, D lost it');
        d2.run(`UPDATE project_tasks SET assigned_to = NULL WHERE id = 'm1'`);
        assert.deepStrictEqual(tagsOf2('m1'), []);
        d2.run(`UPDATE project_tasks SET assigned_to = '' WHERE id = 'm1'`);
        assert.deepStrictEqual(tagsOf2('m1'), [], 'an empty assigned_to tags no one');
        vis.setTaskPeople(run2, 'm1', ['tmB1', 'tmE', 'tmF'], 'uA', '2026-09-25T10:00:00.000Z');
        d2.run(`UPDATE project_tasks SET title = 'renamed', assigned_to = 'tmB1' WHERE id = 'm1'`);   // same first person re-sent
        assert.deepStrictEqual(tagsOf2('m1'), ['tmB1', 'tmE', 'tmF'], 'a write that keeps assigned_to drops no one');
        // setTaskPeople: promote (the first off), replace, add in front of a first person who stays on
        vis.setTaskPeople(run2, 'm1', ['tmE', 'tmF'], 'uA');
        assert.deepStrictEqual([first2('m1'), tagsOf2('m1')], ['tmE', ['tmE', 'tmF']]);
        vis.setTaskPeople(run2, 'm1', ['tmD'], 'uA');
        assert.deepStrictEqual([first2('m1'), tagsOf2('m1')], ['tmD', ['tmD']]);
        vis.setTaskPeople(run2, 'm1', ['tmD', 'tmE'], 'uA', '2026-09-25T11:00:00.000Z');
        vis.setTaskPeople(run2, 'm1', ['tmF', 'tmD', 'tmE'], 'uA', '2026-09-25T12:00:00.000Z');
        assert.strictEqual(first2('m1'), 'tmF');
        assert.deepStrictEqual(vis.orderTaskPeople(first2('m1'), tagsOf2('m1')).slice().sort(), ['tmD', 'tmE', 'tmF'], 'the previous first person stays on (the trigger did not collapse the set)');
        assert.ok(sees('uD').includes('m1') && sees('uE').includes('m1') && sees('uF').includes('m1'));
        vis.deleteTaskPeople(run2, 'm1');
        // A SET THAT WENT STALE BEFORE THE TRIGGER EXISTED: {B1, E, F} on a task moved to D. A move back to B1
        // would not fire the trigger (B1 is tagged, D is not), so the boot sweep deletes such rows first
        d2.run(`INSERT INTO project_tasks VALUES ('m4','stale before the trigger','uA','tmD',NULL)`);
        d2.run(`INSERT INTO v2_task_people VALUES ('m4','tmB1','uA','x'),('m4','tmE','uA','x'),('m4','tmF','uA','x'),('gone-task','tmE','uA','x')`);
        assert.ok(!sees('uE').includes('m4'), 'the live-tag check hides the stale set');
        assert.deepStrictEqual(tagsOf2('m2'), ['tmE', 'tmF']); assert.deepStrictEqual(tagsOf2('m3'), ['tmE']);
        const keep = tagsOf2('m1s');
        vis.ensureTaskPeopleTable(sql => d2.run(sql));                                // the next boot
        assert.deepStrictEqual([tagsOf2('m4'), tagsOf2('m2'), tagsOf2('m3'), tagsOf2('gone-task')], [[], [], [], []], 'stale sets, a task with no one, a task that is gone: swept');
        assert.deepStrictEqual(tagsOf2('m1s'), keep, 'a live set is untouched');
        d2.run(`UPDATE project_tasks SET assigned_to = 'tmB1' WHERE id = 'm4'`);          // the old portal moves it back
        assert.deepStrictEqual(tagsOf2('m4'), ['tmB1']);
        assert.ok(!sees('uE').includes('m4') && !sees('uF').includes('m4') && sees('uB').includes('m4'), 'E and F are not revived');
    });

    await t('PRIVACY: the board never promises "everyone" and says who can see a card (add bar + drawer)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/views/tasks.js'), 'utf8');
        assert.ok(!/'EVERYONE'/.test(src), 'no EVERYONE filter');
        assert.ok(/untagged: 'Only you will see this task until you tag someone\.'/.test(src), 'the add bar line before anyone is tagged');
        assert.ok(/Only \$\{nameList\(\['you'\]\.concat\(names\)\)\} can see this task\./.test(src), 'the line that names who can see it ("Only you, Laura and Miro …")');
        assert.ok(/data-role="addPrivacy"/.test(src) && /data-role="privacy"/.test(src), 'both lines are rendered');
        assert.ok(!/\bhonest|\bplainly/i.test(src), 'house style');
        const chrome = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/chrome.js'), 'utf8');
        assert.ok(!/the shared board/.test(chrome));
    });

    await t('PRIVACY: every server.js task reader goes through the one helper (both portals)', () => {
        const need = {
            'admin-portal/backend/server.js': [
                /app\.get\('\/api\/tasks\/:project'[\s\S]{0,400}visTasks\(req\)/, /app\.get\('\/api\/tasks', auth, adminOnly[\s\S]{0,120}visTasks\(req\)/,
                /app\.put\('\/api\/tasks\/:id'[\s\S]{0,120}visTaskRow\(/, /app\.post\('\/api\/tasks\/:id\/files', auth, adminOnly, upload[\s\S]{0,120}visTaskRow\(/,
                /app\.delete\('\/api\/tasks\/files\/:fileId'[\s\S]{0,120}taskVis\.visibleTaskFile\(/, /app\.post\('\/api\/tasks\/:id\/toggle'[\s\S]{0,120}visTaskRow\(/,
                /app\.delete\('\/api\/tasks\/:id'[\s\S]{0,120}visTaskRow\(/, /app\.get\('\/api\/search'[\s\S]{0,400}taskVis\.visibleTaskSql\(/,
                /app\.get\('\/api\/dashboard\/summary'[\s\S]{0,400}taskVis\.visibleTaskSql\(/, /const tvStats = taskVis\.visibleTaskSql\(/,
                /app\.get\('\/api\/admin\/nag\/items'[\s\S]{0,300}taskVis\.visibleNagSql\(/, /const nagItemFor = [\s\S]{0,200}taskVis\.visibleNagSql\(/,
                /const nv = taskVis\.visibleNagSql\('nag_items', m\.user_id\)/, /app\.get\('\/api\/admin\/audit-log'[\s\S]{0,400}taskVis\.taskAuditScope\(/,
                /app\.get\('\/api\/admin\/audit-log'[\s\S]{0,800}\/\^task\\\.\//, /app\.post\('\/api\/admin\/nag\/run'[\s\S]{0,300}taskVis\.visibleNagSql\(/,
                /app\.get\('\/api\/admin\/messages', auth, adminOnly[\s\S]{0,700}taskVis\.taskReminderDmScope\(/, /app\.get\('\/api\/admin\/messages\/:userId'[\s\S]{0,400}taskVis\.taskReminderDmScope\(/,
                /draft-reply'[\s\S]{0,400}taskVis\.taskReminderDmScope\('direct_messages', null\)/, /app\.get\('\/api\/admin\/tech\/tables\/:name'[\s\S]{0,500}taskVis\.isTaskPrivateTable\(/,
                /app\.get\('\/api\/admin\/tech\/export-all'[\s\S]{0,400}taskVis\.techRowScope\(/
            ],
            'user-portal/backend/server.js': [
                /app\.get\('\/api\/tasks\/:project'[\s\S]{0,400}visTasks\(req\)/, /app\.get\('\/api\/tasks', auth, adminOnly[\s\S]{0,120}visTasks\(req\)/,
                /app\.put\('\/api\/tasks\/:id'[\s\S]{0,120}visTaskRow\(/, /app\.post\('\/api\/tasks\/:id\/files', auth, adminOnly, upload[\s\S]{0,120}visTaskRow\(/,
                /app\.delete\('\/api\/tasks\/files\/:fileId'[\s\S]{0,120}taskVis\.visibleTaskFile\(/, /app\.post\('\/api\/tasks\/:id\/toggle'[\s\S]{0,120}visTaskRow\(/,
                /app\.delete\('\/api\/tasks\/:id'[\s\S]{0,120}visTaskRow\(/, /app\.get\('\/api\/search'[\s\S]{0,400}taskVis\.visibleTaskSql\(/,
                /app\.get\('\/api\/dashboard\/summary'[\s\S]{0,400}taskVis\.visibleTaskSql\(/
            ]
        };
        for (const [file, res] of Object.entries(need)) {
            const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
            res.forEach(re => assert.ok(re.test(src), file + ' is missing ' + re));
            // no ungated read of a single task by id is left
            assert.ok(!/query\.get\('SELECT (id|status) FROM project_tasks WHERE id = \?'/.test(src), file + ' still reads a task by id without the rule');
        }
    });

    // ================================================================ MORE THAN ONE PERSON (Alen, 25 Sept 2026)
    // "in tasks please let us tag more than one person". A = Laura (creates) · B = Bea and C = Cleo (tagged)
    // · D = Dino (on nothing — the same 404 as a missing task everywhere) · E = Ema (an admin with no team
    // row, tagged as user:<id>). Fresh people, so every count below is exact.
    for (const [k, first, last] of [['bea', 'Bea', 'Babic'], ['cleo', 'Cleo', 'Cvitan'], ['dino', 'Dino', 'Dragic'], ['ema', 'Ema', 'Ercegovac']]) {
        q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,1)`, ['u-' + k, k + '@medx.hr', first, last]);
        if (k !== 'ema') q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, ['tm-' + k, 'u-' + k, first + ' ' + last, 'Team']);
        as[k] = { id: 'u-' + k, email: k + '@medx.hr', is_admin: 1 };
    }
    let mid = null, mfid = null;
    const tags = id => q.all('SELECT member_id FROM v2_task_people WHERE task_id = ? ORDER BY added_at, rowid', [id]).map(r => r.member_id);
    const assignedTo = id => (q.get('SELECT assigned_to FROM project_tasks WHERE id = ?', [id]) || {}).assigned_to;
    const detail = async (user, id) => call('GET', '/api/v2/tasks/:id', user, { params: { id } });
    const put = (user, id, body) => call('PUT', '/api/v2/tasks/:id', user, { params: { id }, body });
    const badgeOf = async user => (await call('GET', '/api/v2/tasks/badge', user)).body;

    await t('MULTI: Laura tags Bea AND Cleo on one task → assigned_to is Bea (the first), both tag rows, one email to each, one activity row', async () => {
        emails.length = 0;
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt Split venue shortlist', description: 'three halls, prices', assignees: ['tm-bea', 'tm-cleo'], due_date: '2026-09-02' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        mid = r.body.id;
        assert.strictEqual(assignedTo(mid), 'tm-bea');
        assert.deepStrictEqual(tags(mid), ['tm-bea', 'tm-cleo']);
        assert.deepStrictEqual(r.body.task.people, [{ id: 'tm-bea', user_id: 'u-bea', name: 'Bea Babic', first: 'Bea' }, { id: 'tm-cleo', user_id: 'u-cleo', name: 'Cleo Cvitan', first: 'Cleo' }]);
        assert.strictEqual(r.body.task.assignee_first, 'Bea', 'the legacy fields name the first person');
        assert.deepStrictEqual(sys(mid).map(x => x.body), ['Laura created the task and tagged Bea and Cleo']);
        assert.deepStrictEqual(emails.map(e => e.to).sort(), ['bea@medx.hr', 'cleo@medx.hr'], 'each person tagged, once; never the creator');
        assert.ok(emails.every(e => e.subject === 'Laura gave you a task: Qmt Split venue shortlist'));
        assert.strictEqual((await call('POST', '/api/v2/tasks/:id/comments', as.laura, { params: { id: mid }, body: { body: 'qmt-comment the one near the Riva' } })).status, 200);
        const buf = Buffer.from('%PDF-1.7\nqmt halls\n%%EOF');
        const up = await call('POST', '/api/v2/tasks/:id/files', as.laura, { params: { id: mid }, file: { originalname: 'qmt-halls.pdf', mimetype: 'application/pdf', buffer: buf, size: buf.length } });
        assert.strictEqual(up.status, 200); mfid = up.body.file.id;
    });

    await t('MULTI: Bea (first) and Cleo (tagged) both see it everywhere — detail, board, MINE, search, badge, comments, files, the file by Bearer, the legacy list', async () => {
        for (const k of ['bea', 'cleo']) {
            const d = await detail(as[k], mid);
            assert.strictEqual(d.status, 200, k);
            assert.deepStrictEqual(d.body.task.people.map(p => p.first), ['Bea', 'Cleo'], k);
            assert.ok((await listIds(as[k])).includes(mid), k + ' board');
            assert.ok((await listIds(as[k], { assignee: 'me' })).includes(mid), k + ' MINE');
            assert.ok((await listIds(as[k], { q: 'venue shortlist' })).includes(mid), k + ' search title');
            assert.ok((await listIds(as[k], { q: 'qmt-comment' })).includes(mid), k + ' search comment');
            assert.strictEqual((await badgeOf(as[k])).assigned_open, 1, k + ' badge');
            assert.strictEqual((await call('GET', '/api/v2/tasks/:id/comments', as[k], { params: { id: mid } })).status, 200, k + ' comments');
            assert.strictEqual((await call('POST', '/api/v2/tasks/:id/comments', as[k], { params: { id: mid }, body: { body: 'on it — ' + k } })).status, 200, k + ' comment');
            assert.strictEqual((await call('GET', '/api/v2/tasks/:id/files', as[k], { params: { id: mid } })).status, 200, k + ' files');
            const dl = await call('GET', '/api/v2/tasks/files/:fid', as[k], { params: { fid: mfid }, query: { json: '1' } });
            assert.strictEqual(dl.status, 200, k + ' file'); assert.strictEqual(dl.body.name, 'qmt-halls.pdf');
            assert.ok((await legacyIds(as[k])).includes(mid), k + ' legacy list');
            assert.strictEqual((await put(as[k], mid, { status: 'doing' })).status, 200, k + ' may move it');
        }
        // FOR <NAME>: Laura's filter for Cleo (tagged, not first) finds it, as it finds it for Bea
        assert.ok((await listIds(as.laura, { assignee: 'tm-cleo' })).includes(mid), 'FOR CLEO');
        assert.ok((await listIds(as.laura, { assignee: 'tm-bea' })).includes(mid), 'FOR BEA');
        assert.ok(!(await listIds(as.laura, { assignee: 'tm-dino' })).includes(mid), 'not FOR DINO');
        assert.ok(!(await listIds(as.laura, { assignee: 'me' })).includes(mid), 'Laura made it but is not on it: not in her MINE');
    });

    await t('MULTI: Dino (on nothing) gets the SAME 404 as a missing task on every route, finds it in no list, search or badge, and nothing changes', async () => {
        const before = q.get('SELECT title, status, archived_at, result_text, assigned_to FROM project_tasks WHERE id = ?', [mid]);
        const nTags = tags(mid).length;
        emails.length = 0;
        const hidden = await everyRoute(as.dino, mid);
        const missing = await everyRoute(as.dino, MISSING);
        for (const k of Object.keys(hidden)) {
            assert.strictEqual(hidden[k][0], 404, k + ' must be 404, got ' + hidden[k][0]);
            assert.deepStrictEqual(hidden[k], missing[k], k + ': hidden must answer exactly like missing');
        }
        const tagHidden = await put(as.dino, mid, { assignees: ['tm-dino'] });
        const tagMissing = await put(as.dino, MISSING, { assignees: ['tm-dino'] });
        assert.deepStrictEqual([tagHidden.status, tagHidden.body], [tagMissing.status, tagMissing.body], 'tagging himself on: the missing answer');
        const dl = await call('GET', '/api/v2/tasks/files/:fid', as.dino, { params: { fid: mfid }, query: { json: '1' } });
        const dlMissing = await call('GET', '/api/v2/tasks/files/:fid', as.dino, { params: { fid: 'no-such-file' }, query: { json: '1' } });
        assert.deepStrictEqual([dl.status, dl.body], [dlMissing.status, dlMissing.body]);
        for (const query of [{}, { assignee: 'me' }, { assignee: 'tm-bea' }, { assignee: 'tm-cleo' }, { q: 'venue' }, { q: 'qmt-comment' }, { q: 'qmt-halls' }, { archived: '1' }]) {
            assert.ok(!(await listIds(as.dino, query)).includes(mid), 'Dino sees it with ' + JSON.stringify(query));
        }
        assert.ok(!(await legacyIds(as.dino)).includes(mid));
        assert.deepStrictEqual(await badgeOf(as.dino), { done_unseen: 0, assigned_open: 0, member_id: 'tm-dino' });
        assert.deepStrictEqual(q.get('SELECT title, status, archived_at, result_text, assigned_to FROM project_tasks WHERE id = ?', [mid]), before);
        assert.strictEqual(tags(mid).length, nTags);
        assert.strictEqual(emails.length, 0);
    });

    await t('MULTI: assignees are resolved like assigned_to — duplicates collapse, user:<id> makes the team row, at most 12, an unknown person is refused before any row is made', async () => {
        const dup = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt dup', assignees: ['tm-bea', 'tm-bea', ' tm-bea ', 'user:u-bea', ''] } });
        assert.strictEqual(dup.status, 200); assert.deepStrictEqual(tags(dup.body.id), ['tm-bea'], 'one person, once');
        const rows = q.get('SELECT COUNT(*) AS c FROM team_members').c;
        const bad = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt bad', assignees: ['user:u-ema', 'nobody-here'] } });
        assert.strictEqual(bad.status, 400); assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM team_members').c, rows, 'no team row made for Ema by a refused request');
        assert.strictEqual((await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt notalist', assignees: 'tm-bea' } })).status, 400);
        for (let i = 0; i < 13; i++) q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, ['tm-crowd-' + i, null, 'Crowd Person ' + i, 'Volunteer']);
        const crowd = Array.from({ length: 13 }, (_, i) => 'tm-crowd-' + i);
        const tooMany = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt crowd', assignees: crowd } });
        assert.strictEqual(tooMany.status, 400); assert.match(tooMany.body.error, /at most 12/);
        const twelve = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt twelve', assignees: crowd.slice(0, 12) } });
        assert.strictEqual(twelve.status, 200); assert.strictEqual(tags(twelve.body.id).length, 12);
        // the cap counts people, not entries: 12 people given as 13 entries (Bea by her team row AND by user:<id>) is fine
        const twelveDup = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt twelve dup', assignees: crowd.slice(0, 11).concat(['tm-bea', 'user:u-bea']) } });
        assert.strictEqual(twelveDup.status, 200, JSON.stringify(twelveDup.body)); assert.strictEqual(tags(twelveDup.body.id).length, 12);
        const thirteen = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt thirteen', assignees: crowd.slice(0, 12).concat(['user:u-bea']) } });
        assert.strictEqual(thirteen.status, 400); assert.match(thirteen.body.error, /at most 12/);
        const junk = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt junk', assignees: Array.from({ length: 49 }, (_, i) => 'junk-' + i) } });
        assert.strictEqual(junk.status, 400); assert.match(junk.body.error, /at most 12/, 'an abuse bound on raw entries');
        for (const id of [dup.body.id, twelve.body.id, twelveDup.body.id]) await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
        q.run(`DELETE FROM team_members WHERE id LIKE 'tm-crowd-%'`);
    });

    await t('MULTI: untag Cleo → Cleo gets the 404 and loses it everywhere; Bea keeps it; "Laura removed Cleo"; nobody is emailed', async () => {
        emails.length = 0;
        const r = await put(as.laura, mid, { assignees: ['tm-bea'] });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.deepStrictEqual(r.body.task.people.map(p => p.first), ['Bea']);
        assert.deepStrictEqual(tags(mid), ['tm-bea']);
        const c = await detail(as.cleo, mid); const cm = await detail(as.cleo, MISSING);
        assert.deepStrictEqual([c.status, c.body], [cm.status, cm.body]);
        assert.ok(!(await listIds(as.cleo)).includes(mid) && !(await listIds(as.cleo, { assignee: 'me' })).includes(mid) && !(await listIds(as.cleo, { q: 'venue' })).includes(mid));
        assert.strictEqual((await badgeOf(as.cleo)).assigned_open, 0);
        assert.strictEqual((await call('GET', '/api/v2/tasks/files/:fid', as.cleo, { params: { fid: mfid }, query: { json: '1' } })).status, 404);
        assert.strictEqual((await detail(as.bea, mid)).status, 200);
        assert.ok(sys(mid).some(x => x.body === 'Laura removed Cleo'));
        assert.strictEqual(emails.length, 0);
    });

    await t('MULTI: tag Cleo again and Ema (user:<id>, no team row yet) → only the two NEWLY tagged are emailed, once; the same set again changes nothing', async () => {
        emails.length = 0;
        const r = await put(as.laura, mid, { assignees: ['tm-bea', 'tm-cleo', 'user:u-ema'] });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const emaRow = q.get(`SELECT id FROM team_members WHERE user_id = 'u-ema'`);
        assert.ok(emaRow, 'Ema\'s team row is made on her first tag');
        assert.deepStrictEqual(tags(mid), ['tm-bea', 'tm-cleo', emaRow.id]);
        assert.deepStrictEqual(emails.map(e => e.to).sort(), ['cleo@medx.hr', 'ema@medx.hr'], 'not Bea (already on it), not Laura (the actor)');
        assert.ok(sys(mid).some(x => x.body === 'Laura tagged Cleo and Ema'));
        emails.length = 0;
        const again = await put(as.laura, mid, { assignees: [emaRow.id, 'tm-cleo', 'tm-bea'] });
        assert.strictEqual(again.body.unchanged, true, 'the same people in another order is no change');
        assert.strictEqual(emails.length, 0);
        assert.strictEqual((await detail(as.ema, mid)).status, 200);
        assert.ok((await listIds(as.ema, { assignee: 'me' })).includes(mid));
    });

    await t('MULTI: untag Bea (the first person) → assigned_to moves to the next one tagged (Cleo); Bea loses it', async () => {
        const r = await put(as.laura, mid, { assignees: ['tm-cleo', q.get(`SELECT id FROM team_members WHERE user_id = 'u-ema'`).id] });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(assignedTo(mid), 'tm-cleo');
        assert.strictEqual(r.body.task.assignee_first, 'Cleo');
        assert.deepStrictEqual(r.body.task.people.map(p => p.first), ['Cleo', 'Ema']);
        assert.strictEqual((await detail(as.bea, mid)).status, 404);
        assert.strictEqual((await badgeOf(as.bea)).assigned_open, 0, 'nothing open for Bea any more');
        assert.ok(!(await listIds(as.bea, { assignee: 'me' })).includes(mid));
    });

    await t('MULTI: Cleo (not the creator) takes herself off → the answer carries no card (handed_off), "Cleo left the task", she gets the 404; Ema is first now', async () => {
        const r = await put(as.cleo, mid, { assignees: [q.get(`SELECT id FROM team_members WHERE user_id = 'u-ema'`).id] });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.handed_off, true); assert.strictEqual(r.body.task, null);
        assert.ok(sys(mid).some(x => x.body === 'Cleo left the task'));
        assert.strictEqual((await detail(as.cleo, mid)).status, 404);
        assert.strictEqual(assignedTo(mid), q.get(`SELECT id FROM team_members WHERE user_id = 'u-ema'`).id);
    });

    await t('MULTI: untag everyone → assigned_to NULL, no tag rows, only Laura (the creator) sees it', async () => {
        const r = await put(as.laura, mid, { assignees: [] });
        assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.body.task.people, []);
        assert.strictEqual(assignedTo(mid), null); assert.deepStrictEqual(tags(mid), []);
        for (const k of ['bea', 'cleo', 'ema', 'dino']) assert.strictEqual((await detail(as[k], mid)).status, 404, k);
        assert.strictEqual((await detail(as.laura, mid)).status, 200);
    });

    await t('MULTI: assigned_to alone is one person — the same first person changes nothing (a legacy edit drops no one); another person makes the task theirs alone', async () => {
        await put(as.laura, mid, { assignees: ['tm-bea', 'tm-cleo'] });
        emails.length = 0;
        const same = await call('PUT', '/api/admin/tasks/:id', as.laura, { params: { id: mid }, body: { title: 'Qmt Split venue shortlist (v2)', assigned_to: 'tm-bea' } });
        assert.strictEqual(same.status, 200);
        assert.deepStrictEqual(tags(mid), ['tm-bea', 'tm-cleo'], 'Cleo is still on it');
        const moved = await put(as.laura, mid, { assigned_to: 'tm-dino' });
        assert.strictEqual(moved.status, 200);
        assert.deepStrictEqual(tags(mid), ['tm-dino']); assert.strictEqual(assignedTo(mid), 'tm-dino');
        assert.strictEqual((await detail(as.bea, mid)).status, 404); assert.strictEqual((await detail(as.cleo, mid)).status, 404);
        assert.strictEqual((await detail(as.dino, mid)).status, 200);
        assert.deepStrictEqual(emails.map(e => e.to), ['dino@medx.hr']);
    });

    await t('MULTI: a one-person writer that knows nothing of tags (the old portals share the DB) moves assigned_to → the task is that person\'s alone, in the database (the trigger), and a move back revives no one', async () => {
        const oldPortalMove = to => q.run(`UPDATE project_tasks SET assigned_to = ? WHERE id = ?`, [to, mid]);   // what main's PUT /api/tasks/:id writes
        // (a) A→B where B was already tagged: A and C lose it at once (the reviewer's S1a)
        await put(as.laura, mid, { assignees: ['tm-bea'] });   // Bea first (the first person stays first on the board)
        await put(as.laura, mid, { assignees: ['tm-bea', 'tm-cleo', 'tm-dino'] });
        assert.deepStrictEqual(tags(mid), ['tm-bea', 'tm-cleo', 'tm-dino']);
        oldPortalMove('tm-cleo');
        assert.deepStrictEqual(tags(mid), ['tm-cleo'], 'the tag set collapsed to the one person');
        assert.strictEqual((await detail(as.bea, mid)).status, 404, 'Bea (moved away from in the old portal) loses it');
        assert.strictEqual((await detail(as.dino, mid)).status, 404, 'Dino (tagged) loses it too');
        assert.deepStrictEqual((await detail(as.cleo, mid)).body.task.people.map(p => p.first), ['Cleo']);
        // an old-portal edit that re-sends the same first person drops no one
        await put(as.laura, mid, { assignees: ['tm-cleo', 'tm-bea'] });
        q.run(`UPDATE project_tasks SET title = title, assigned_to = 'tm-cleo' WHERE id = ?`, [mid]);
        assert.deepStrictEqual(tags(mid), ['tm-cleo', 'tm-bea']);
        // (b) A→D (untagged) then D→A: Bea, the one tagged beside Cleo, stays off it, and never reads what Dino wrote while it was his alone (S1b)
        oldPortalMove('tm-dino');
        assert.deepStrictEqual(tags(mid), ['tm-dino']);
        assert.strictEqual((await detail(as.cleo, mid)).status, 404); assert.strictEqual((await detail(as.bea, mid)).status, 404);
        const note = await call('POST', '/api/v2/tasks/:id/comments', as.dino, { params: { id: mid }, body: { body: 'Qmt Dino private note while it was mine' } });
        assert.strictEqual(note.status, 200, JSON.stringify(note.body));
        oldPortalMove('tm-cleo');
        assert.deepStrictEqual(tags(mid), ['tm-cleo'], 'the move back is to Cleo alone');
        assert.strictEqual((await detail(as.bea, mid)).status, 404, 'Bea stays off it: no dormant tag comes back');
        assert.strictEqual((await detail(as.dino, mid)).status, 404, 'Dino lost it');
        const beaComments = await call('GET', '/api/v2/tasks/:id/comments', as.bea, { params: { id: mid } });
        assert.strictEqual(beaComments.status, 404);
        assert.ok(!(await listIds(as.bea, {})).includes(mid) && !(await listIds(as.bea, { assignee: 'me' })).includes(mid));
        assert.strictEqual((await badgeOf(as.dino)).assigned_open, 0);
        // clearing it in the old portal clears everyone
        await put(as.laura, mid, { assignees: ['tm-cleo', 'tm-bea'] });
        oldPortalMove(null);
        assert.deepStrictEqual(tags(mid), []); assert.strictEqual((await detail(as.bea, mid)).status, 404);
        // the board's own writes never trip the trigger: add, promote, replace
        let r = await put(as.laura, mid, { assignees: ['tm-dino', 'tm-cleo', 'tm-bea'] });
        assert.deepStrictEqual(tags(mid), ['tm-dino', 'tm-cleo', 'tm-bea']); assert.deepStrictEqual(r.body.task.people.map(p => p.first), ['Dino', 'Cleo', 'Bea']);
        r = await put(as.laura, mid, { assignees: ['tm-cleo', 'tm-bea'] });
        assert.deepStrictEqual(tags(mid), ['tm-cleo', 'tm-bea'], 'Dino off, Cleo promoted, Bea kept');
        r = await put(as.laura, mid, { assignees: ['tm-bea', 'tm-cleo', 'tm-dino'] });
        assert.deepStrictEqual(r.body.task.people.map(p => p.first), ['Cleo', 'Bea', 'Dino'], 'the first stays first; a newcomer joins at the end');
        r = await put(as.laura, mid, { assignees: ['tm-dino', 'tm-cleo'] });
        assert.deepStrictEqual(tags(mid), ['tm-cleo', 'tm-dino']); assert.strictEqual(assignedTo(mid), 'tm-cleo');
        assert.strictEqual((await detail(as.bea, mid)).status, 404);
    });

    await t('MULTI: the creator tagging herself too — "Laura created the task, joined it and tagged Bea"; she is on it (MINE)', async () => {
        emails.length = 0;
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt joint errand', assignees: [M.laura, 'tm-bea'] } });
        assert.deepStrictEqual(sys(r.body.id).map(x => x.body), ['Laura created the task, joined it and tagged Bea']);
        assert.deepStrictEqual(emails.map(e => e.to), ['bea@medx.hr'], 'never an email to yourself');
        assert.ok((await listIds(as.laura, { assignee: 'me' })).includes(r.body.id));
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id: r.body.id } });
    });

    await t('MULTI: an unlinked team row that is TAGGED (not first) on a task is never linked to an admin by name', async () => {
        q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES ('tm-gus', NULL, 'Gus Galic', 'Volunteer')`);
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt Gus private', assignees: ['tm-bea', 'tm-gus'] } });
        q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES ('u-gus-imp', 'gus@example.com', 'Gus', 'Galic', 1)`);
        const imp = { id: 'u-gus-imp', email: 'gus@example.com', is_admin: 1 };
        const list = await call('GET', '/api/v2/tasks', imp);
        assert.strictEqual(q.get(`SELECT user_id FROM team_members WHERE id = 'tm-gus'`).user_id, null, 'the tagged row stays unlinked');
        assert.ok(!list.body.tasks.some(x => x.id === r.body.id));
        assert.strictEqual((await detail(imp, r.body.id)).status, 404);
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id: r.body.id } });
        q.run(`DELETE FROM team_members WHERE id = 'tm-gus'`); q.run(`DELETE FROM users WHERE id = 'u-gus-imp'`);
    });

    await t('MULTI: deleting a task deletes its tag rows and its subtasks\' tag rows', async () => {
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qmt to delete', assignees: ['tm-bea', 'tm-cleo'] } });
        const id = r.body.id;
        q.run(`INSERT INTO project_tasks (id, project, title, status, created_by, parent_id) VALUES ('qmt-sub', 'general', 'Qmt sub', 'todo', ?, ?)`, [U.laura, id]);
        q.run(`INSERT INTO v2_task_people (task_id, member_id, added_by, added_at) VALUES ('qmt-sub', 'tm-cleo', ?, ?)`, [U.laura, new Date().toISOString()]);
        assert.strictEqual(q.get(`SELECT COUNT(*) AS c FROM v2_task_people WHERE task_id IN (?, 'qmt-sub')`, [id]).c, 3);
        const d = await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
        assert.strictEqual(d.status, 200);
        assert.strictEqual(q.get(`SELECT COUNT(*) AS c FROM v2_task_people WHERE task_id IN (?, 'qmt-sub')`, [id]).c, 0);
        q.run(`DELETE FROM project_tasks WHERE id = 'qmt-sub'`);
    });

    // ---- the drawer's deltas (tag / untag): applied to the people on the task NOW, never to a stale copy ----
    const emaId = () => q.get(`SELECT id FROM team_members WHERE user_id = 'u-ema'`).id;
    await t('DELTAS: a stale drawer adding Ema after Bea took Dino off does NOT put Dino back; only Ema is emailed and "tagged"', async () => {
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qdl stale drawer', assignees: ['tm-bea', 'tm-cleo', 'tm-dino'] } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const id = r.body.id;
        // Laura's drawer loaded [Bea, Cleo, Dino]; meanwhile Bea takes Dino off
        const off = await put(as.bea, id, { untag: ['tm-dino'] });
        assert.strictEqual(off.status, 200, JSON.stringify(off.body));
        assert.deepStrictEqual(tags(id), ['tm-bea', 'tm-cleo']);
        assert.ok(sys(id).some(x => x.body === 'Bea removed Dino'));
        // Laura, still looking at [Bea, Cleo, Dino], adds Ema: the change lands on [Bea, Cleo]
        emails.length = 0;
        const n0 = sys(id).length;
        const add = await put(as.laura, id, { tag: [emaId()] });
        assert.strictEqual(add.status, 200, JSON.stringify(add.body));
        assert.deepStrictEqual(tags(id), ['tm-bea', 'tm-cleo', emaId()], 'Dino stays off');
        assert.deepStrictEqual(add.body.task.people.map(p => p.first), ['Bea', 'Cleo', 'Ema']);
        assert.deepStrictEqual(emails.map(e => e.to), ['ema@medx.hr'], 'one email, to the one person newly tagged');
        assert.deepStrictEqual(sys(id).slice(n0).map(x => x.body), ['Laura tagged Ema'], 'one activity line, naming only Ema');
        const hidden = await detail(as.dino, id); const missing = await detail(as.dino, MISSING);
        assert.deepStrictEqual([hidden.status, hidden.body], [missing.status, missing.body], 'Dino gets the missing answer');
        // the whole-set form stays for create and compat (and would have carried the stale Dino): not what the drawer sends
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
    });

    await t('DELTAS: two quick × taps from the same drawer (and one untag of two) take off both, nobody is re-tagged or emailed', async () => {
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qdl double untag', assignees: ['tm-bea', 'tm-cleo', 'tm-dino', emaId()] } });
        const id = r.body.id;
        emails.length = 0;
        // both requests leave before either answers (the drawer still shows all four)
        const [a, b] = await Promise.all([put(as.laura, id, { untag: ['tm-cleo'] }), put(as.laura, id, { untag: ['tm-dino'] })]);
        assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200);
        assert.deepStrictEqual(tags(id), ['tm-bea', emaId()], 'both taken off');
        assert.strictEqual(emails.length, 0);
        for (const k of ['cleo', 'dino']) assert.strictEqual((await detail(as[k], id)).status, 404, k);
        // a × on someone already off (a drawer that is behind) is no change
        const again = await put(as.laura, id, { untag: ['tm-cleo'] });
        assert.strictEqual(again.status, 200); assert.strictEqual(again.body.unchanged, true);
        // tagging someone already on is no change and no email
        const dup = await put(as.laura, id, { tag: ['tm-bea', 'user:u-bea'] });
        assert.strictEqual(dup.body.unchanged, true); assert.strictEqual(emails.length, 0);
        // one untag of two: the first person goes too, and with everyone off assigned_to is cleared
        const both = await put(as.laura, id, { untag: ['tm-bea', 'user:u-ema'] });
        assert.strictEqual(both.status, 200, JSON.stringify(both.body));
        assert.deepStrictEqual(tags(id), []); assert.strictEqual(assignedTo(id), null);
        assert.ok(sys(id).some(x => x.body === 'Laura removed Bea and Ema'));
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
    });

    await t('DELTAS: untag takes off the account (any of its rows), wins over a tag of the same person, never makes a team row; tag is validated and capped; a non-participant gets the missing answer', async () => {
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qdl rules', assignees: ['tm-bea', 'tm-cleo'] } });
        const id = r.body.id;
        // untag by account (user:<id>) takes off her team row; untag first person promotes the next one
        let x = await put(as.laura, id, { untag: ['user:u-bea'] });
        assert.strictEqual(x.status, 200); assert.deepStrictEqual(tags(id), ['tm-cleo']); assert.strictEqual(assignedTo(id), 'tm-cleo');
        // the same person in both lists: taking off wins, and no team row is made for an account with none
        q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES ('u-fran', 'fran@medx.hr', 'Fran', 'Franic', 1)`);
        const rows = q.get('SELECT COUNT(*) AS c FROM team_members').c;
        x = await put(as.laura, id, { tag: ['user:u-fran', 'tm-dino'], untag: ['user:u-fran'] });
        assert.strictEqual(x.status, 200, JSON.stringify(x.body));
        assert.deepStrictEqual(tags(id), ['tm-cleo', 'tm-dino']);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM team_members').c, rows, 'no team row made for Fran');
        // an unknown person to tag is refused, and nothing changes; lists only
        const before = tags(id).join();
        assert.strictEqual((await put(as.laura, id, { tag: ['nobody-here'] })).status, 400);
        assert.strictEqual((await put(as.laura, id, { tag: 'tm-bea' })).status, 400);
        assert.strictEqual((await put(as.laura, id, { untag: 'tm-cleo' })).status, 400);
        assert.strictEqual(tags(id).join(), before);
        // an id to untag that is not on the task is a no-op, never an error (a drawer that is behind)
        assert.strictEqual((await put(as.laura, id, { untag: ['no-such-row'] })).body.unchanged, true);
        // the cap counts the set after the change
        for (let i = 0; i < 11; i++) q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, ['tm-dl-' + i, null, 'Delta Person ' + i, 'Volunteer']);
        const ten = Array.from({ length: 10 }, (_, i) => 'tm-dl-' + i);
        x = await put(as.laura, id, { tag: ten });
        assert.strictEqual(x.status, 200); assert.strictEqual(tags(id).length, 12);
        x = await put(as.laura, id, { tag: ['tm-dl-10'] });
        assert.strictEqual(x.status, 400); assert.match(x.body.error, /at most 12/); assert.strictEqual(tags(id).length, 12);
        // …refused before any team row is made for an admin tagged as user:<id>
        x = await put(as.laura, id, { tag: ['user:u-fran'] });
        assert.strictEqual(x.status, 400); assert.match(x.body.error, /at most 12/);
        assert.strictEqual(q.get(`SELECT COUNT(*) AS c FROM team_members WHERE user_id = 'u-fran'`).c, 0, 'no team row made for Fran by a refused request');
        x = await put(as.laura, id, { untag: ['tm-dl-0'], tag: ['tm-dl-10'] });
        assert.strictEqual(x.status, 200, 'one off and one on stays at 12'); assert.ok(tags(id).includes('tm-dl-10') && !tags(id).includes('tm-dl-0'));
        // Ema (not on it, not its creator) tagging herself on gets exactly the missing answer
        const hid = await put(as.ema, id, { tag: [emaId()] }); const mis = await put(as.ema, MISSING, { tag: [emaId()] });
        assert.deepStrictEqual([hid.status, hid.body], [mis.status, mis.body]);
        assert.ok(!tags(id).includes(emaId()));
        // someone on it (not the creator) taking herself off by delta: handed off, the card leaves her
        const left = await put(as.cleo, id, { untag: ['tm-cleo'] });
        assert.strictEqual(left.status, 200); assert.strictEqual(left.body.handed_off, true); assert.strictEqual(left.body.task, null);
        assert.ok(sys(id).some(x => x.body === 'Cleo left the task'));
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
        q.run(`DELETE FROM team_members WHERE id LIKE 'tm-dl-%'`); q.run(`DELETE FROM users WHERE id = 'u-fran'`);
    });

    await t('DELTAS: at the cap, a person both tagged and taken off is not counted (taking off wins), by team row or by account', async () => {
        q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES ('u-gita', 'gita@medx.hr', 'Gita', 'Galic', 1)`);
        q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES ('tm-gita', 'u-gita', 'Gita Galic', 'Team')`);
        for (let i = 0; i < 12; i++) q.run(`INSERT INTO team_members (id, user_id, name, role) VALUES (?,?,?,?)`, ['tm-cap-' + i, null, 'Cap Person ' + i, 'Volunteer']);
        const r = await call('POST', '/api/v2/tasks', as.laura, { body: { title: 'Qdl cap untag wins', assignees: Array.from({ length: 12 }, (_, i) => 'tm-cap-' + i) } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const id = r.body.id;
        assert.strictEqual(tags(id).length, 12);
        emails.length = 0;
        for (const body of [{ tag: ['tm-gita'], untag: ['user:u-gita'] }, { tag: ['user:u-gita'], untag: ['tm-gita'] }, { tag: ['tm-gita'], untag: ['tm-gita'] }]) {
            const x = await put(as.laura, id, body);
            assert.strictEqual(x.status, 200, JSON.stringify(body) + ' -> ' + JSON.stringify(x.body));
            assert.strictEqual(x.body.unchanged, true, JSON.stringify(body));
            assert.ok(!tags(id).includes('tm-gita') && tags(id).length === 12);
        }
        assert.strictEqual(emails.length, 0);
        // one taken off makes room for one on
        const x = await put(as.laura, id, { untag: ['tm-cap-0'], tag: ['tm-gita'] });
        assert.strictEqual(x.status, 200, JSON.stringify(x.body));
        assert.ok(tags(id).includes('tm-gita') && !tags(id).includes('tm-cap-0') && tags(id).length === 12);
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
        q.run(`DELETE FROM team_members WHERE id LIKE 'tm-cap-%' OR id = 'tm-gita'`); q.run(`DELETE FROM users WHERE id = 'u-gita'`);
    });

    await t('RACE: an old-portal unassign landing between setTaskPeople\'s UPDATE and its re-insert leaves no dormant rows (a later hand-off revives no one)', () => {
        const vis = require(path.join(ROOT, 'shared/task-visibility.js'));
        for (const unassigned of [null, '']) {
            const id = 'qrace-' + (unassigned === null ? 'null' : 'blank');
            q.run(`INSERT INTO project_tasks (id, project, title, status, created_by) VALUES (?, 'general', 'Qrace', 'todo', ?)`, [id, U.laura]);
            vis.setTaskPeople(q.run, id, ['tm-bea', 'tm-cleo'], U.laura);
            assert.deepStrictEqual(tags(id), ['tm-bea', 'tm-cleo']);
            // promote Cleo, Bea stays on later: her row steps aside for the UPDATE and is written again after it —
            // and right there the old portal (a second writer on the same database) unassigns the task
            let seenUpdate = false, injected = false;
            const run = (sql, p) => {
                if (/^UPDATE project_tasks SET assigned_to = \? WHERE id = \?/.test(sql)) seenUpdate = true;
                else if (seenUpdate && !injected && /^INSERT OR IGNORE INTO v2_task_people/.test(sql)) { injected = true; q.run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', [unassigned, id]); }
                return q.run(sql, p);
            };
            vis.setTaskPeople(run, id, ['tm-cleo', 'tm-bea'], U.laura);
            assert.ok(injected, 'the old-portal write landed in the gap');
            assert.deepStrictEqual(tags(id), [], 'no dormant rows on an unassigned task');
            // the old portal later hands it to Cleo alone: Bea is not revived
            q.run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', ['tm-cleo', id]);
            assert.deepStrictEqual(tags(id), ['tm-cleo']);
            assert.strictEqual((vis.visibleTaskRow(q.get, 'u-bea', id, 'pt.id')), null, 'Bea does not see it');
            // without the other portal, the same write keeps Bea on in her later place
            vis.setTaskPeople(q.run, id, ['tm-bea', 'tm-cleo'], U.laura);
            vis.setTaskPeople(q.run, id, ['tm-cleo', 'tm-bea'], U.laura);
            assert.deepStrictEqual(tags(id), ['tm-cleo', 'tm-bea']); assert.strictEqual(assignedTo(id), 'tm-cleo');
            vis.deleteTaskPeople(q.run, id); q.run('DELETE FROM project_tasks WHERE id = ?', [id]);
        }
    });

    // ================================================================ STALE READS (the embedded replica)
    // In production each backend reads a libsql embedded replica that pulls the primary about every 60 s (shared/db.js):
    // writes go to the primary, and a write brings the replica up to date (read your writes). Modelled here: a second
    // mount of the module whose reads come from a REPLICA copy of this test database, pulled on db.sync() and after each
    // of its own writes, never after a write by the old portal (main's PUT /api/tasks/:id: a raw UPDATE of assigned_to on
    // the primary, which the database's one-person trigger turns into "this one person's alone").
    const replicaMount = () => {
        const rep = createDatabase(Database, { localPath: ':memory:' });
        rep.run('PRAGMA foreign_keys = OFF');
        const rowsOf = (d, sql) => { const st = d.prepare(sql); st.bind([]); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
        const pull = () => {
            for (const tb of rowsOf(db, `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'audit_log'`)) {
                rep.run(`DROP TABLE IF EXISTS "${tb.name}"`); rep.run(tb.sql);
                for (const r of rowsOf(db, `SELECT rowid AS rid__, * FROM "${tb.name}"`)) {
                    const cols = Object.keys(r).filter(k => k !== 'rid__');
                    rep.run(`INSERT INTO "${tb.name}" (rowid, ${cols.map(c => `"${c}"`).join(', ')}) VALUES (${['?'].concat(cols.map(() => '?')).join(', ')})`, [r.rid__, ...cols.map(c => r[c])]);
                }
            }
        };
        const m = { syncs: 0, reads: 0, events: [], onSync: null, onTagRead: null };
        const facade = {
            run(sql, p) { const r = db.run(sql, p); pull(); return r; },   // to the primary, then read your writes
            getRowsModified: () => db.getRowsModified(),
            sync() { m.syncs++; m.events.push('sync'); if (m.onSync) m.onSync(m.syncs); pull(); },
            prepare(sql) {
                const st = rep.prepare(sql);
                if (!/^SELECT task_id, member_id FROM v2_task_people WHERE task_id IN/.test(sql)) return st;
                const step = st.step.bind(st); let first = true;   // the rows are fetched on the first step: the read is done
                st.step = () => { const more = step(); if (first) { first = false; m.reads++; m.events.push('read'); if (m.onTagRead) m.onTagRead(m.reads); } return more; };
                return st;
            }
        };
        pull();
        m.app = stubApp();
        mountTasks(m.app, {
            db: () => facade, auth, adminOnly, saveDb: () => {}, JWT_SECRET: 'tasks-test-secret', ROOT: tmpRoot, log: () => {},
            sendEmail: async (to, subject, html) => { emails.push({ to, subject, html }); return { success: true }; }
        });
        m.call = (meth, p, user, opts = {}) => m.app.call(meth, p, Object.assign({ user }, opts));
        m.put = (user, id, body) => m.call('PUT', '/api/v2/tasks/:id', user, { params: { id }, body });
        m.reset = () => { m.syncs = 0; m.reads = 0; m.events = []; m.onSync = null; m.onTagRead = null; };
        return m;
    };
    const REP = replicaMount();
    const oldPortal = (id, to) => q.run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', [to, id]);   // main's one-person write, on the primary
    const stOf = id => (assignedTo(id) || '-') + ':[' + tags(id).join(',') + ']';
    const staleTask = async title => {
        const r = await REP.call('POST', '/api/v2/tasks', as.laura, { body: { title, assignees: ['tm-bea', 'tm-cleo', 'tm-dino'] } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(stOf(r.body.id), 'tm-bea:[tm-bea,tm-cleo,tm-dino]');
        return r.body.id;
    };

    await t('STALE: the replica has not pulled the old portal\'s hand-off or unassign yet — every change of people syncs before it reads, so no one it took off comes back', async () => {
        for (const [to, want] of [['tm-dino', 'tm-dino:[tm-dino]'], [null, '-:[]']]) {
            const id = await staleTask('Qst sync ' + (to || 'unassign'));
            REP.reset(); emails.length = 0; const n0 = sys(id).length;
            oldPortal(id, to);   // on the primary: the replica still reads Bea, Cleo, Dino
            const r = await REP.put(as.laura, id, { untag: ['tm-cleo'] });
            assert.strictEqual(r.status, 200, JSON.stringify(r.body));
            assert.strictEqual(stOf(id), want, 'the old portal\'s move stands');
            assert.strictEqual(REP.events[0], 'sync', 'synced before the people were read: ' + REP.events.join(','));
            assert.strictEqual((await detail(as.bea, id)).status, 404, 'Bea is not re-tagged');
            if (to === null) assert.strictEqual((await detail(as.dino, id)).status, 404, 'nor Dino');
            assert.strictEqual(emails.length, 0);
            assert.deepStrictEqual(sys(id).slice(n0).map(x => x.body), [], 'Cleo was already off: nothing to say');
            await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
        }
        // the whole set, a tag and the legacy one-person write sync first too
        const id = await staleTask('Qst sync forms');
        for (const [how, go] of [['assignees', () => REP.put(as.laura, id, { assignees: ['tm-bea', 'tm-cleo'] })], ['tag', () => REP.put(as.laura, id, { tag: [emaId()] })],
                                  ['assigned_to', () => REP.call('PUT', '/api/admin/tasks/:id', as.laura, { params: { id }, body: { assigned_to: 'tm-cleo' } })]]) {
            REP.reset();
            const r = await go();
            assert.strictEqual(r.status, 200, how + ' ' + JSON.stringify(r.body));
            assert.strictEqual(REP.events[0], 'sync', how + ': ' + REP.events.join(','));
        }
        assert.strictEqual(stOf(id), 'tm-cleo:[tm-cleo]');
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
    });

    await t('STALE: the old portal moves the task between the read and the write (hand-off, unassign) — the change is worked out again on the task as it is now, nobody it took off comes back, lines and emails follow what was applied', async () => {
        const E = emaId();
        // [what V2 sends, the old portal's move, the end state, the activity lines, who is emailed, who must not see it]
        const cases = [
            [{ untag: ['tm-cleo'] }, 'tm-dino', 'tm-dino:[tm-dino]', [], [], ['bea', 'cleo']],
            [{ untag: ['tm-cleo'] }, null, '-:[]', [], [], ['bea', 'cleo', 'dino']],
            [{ tag: [E] }, 'tm-dino', `tm-dino:[tm-dino,${E}]`, ['Laura tagged Ema'], ['ema@medx.hr'], ['bea', 'cleo']],
            [{ tag: [E] }, null, `${E}:[${E}]`, ['Laura tagged Ema'], ['ema@medx.hr'], ['bea', 'cleo', 'dino']],
            [{ untag: ['tm-bea'] }, 'tm-cleo', 'tm-cleo:[tm-cleo]', [], [], ['bea', 'dino']],
            [{ assignees: ['tm-cleo', 'tm-dino', E] }, 'tm-dino', `tm-dino:[tm-dino,tm-cleo,${E}]`, ['Laura tagged Cleo and Ema'], ['cleo@medx.hr', 'ema@medx.hr'], ['bea']],
            [{ assignees: ['tm-bea', E] }, null, `tm-bea:[tm-bea,${E}]`, ['Laura tagged Bea and Ema'], ['bea@medx.hr', 'ema@medx.hr'], ['cleo', 'dino']],
        ];
        for (const [body, to, want, lines, mailed, off] of cases) {
            const label = JSON.stringify(body) + ' vs ' + (to || 'unassign');
            const id = await staleTask('Qst between ' + label);
            REP.reset(); emails.length = 0; const n0 = sys(id).length;
            REP.onTagRead = n => { if (n === 1) oldPortal(id, to); };   // right after V2 read Bea, Cleo, Dino
            const r = await REP.put(as.laura, id, body);
            assert.strictEqual(r.status, 200, label + ' ' + JSON.stringify(r.body));
            assert.strictEqual(stOf(id), want, label);
            assert.ok(REP.reads >= 2 && REP.syncs >= 2, label + ': read again before the write ' + REP.events.join(','));
            assert.deepStrictEqual(sys(id).slice(n0).map(x => x.body), lines, label + ': the lines follow the change as applied');
            assert.deepStrictEqual(emails.map(e => e.to).sort(), mailed, label + ': emails only to who was newly put on it');
            for (const k of off) assert.strictEqual((await detail(as[k], id)).status, 404, label + ': ' + k + ' stays off');
            // a later one-person move by the old portal (to Alen) revives no one either
            oldPortal(id, M.alen);
            assert.strictEqual(stOf(id), M.alen + ':[' + M.alen + ']', label + ': a later move is to Alen alone');
            for (const k of off) assert.strictEqual((await detail(as[k], id)).status, 404, label + ': ' + k + ' still off after the later move');
            await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
        }
    });

    await t('STALE: someone tagged (not the creator) changes the people while the old portal hands the task on to someone else — the same 404 as a missing task, and nothing is written', async () => {
        const id = await staleTask('Qst actor loses it');
        const before = q.get('SELECT updated_at FROM project_tasks WHERE id = ?', [id]).updated_at;
        REP.reset(); emails.length = 0; const n0 = sys(id).length;
        REP.onTagRead = n => { if (n === 1) oldPortal(id, 'tm-dino'); };   // right after Bea's request read Bea, Cleo, Dino
        const r = await REP.put(as.bea, id, { untag: ['tm-cleo'] });
        const missing = await REP.put(as.bea, MISSING, { untag: ['tm-cleo'] });
        assert.deepStrictEqual([r.status, r.body], [missing.status, missing.body], JSON.stringify(r.body));
        assert.strictEqual(stOf(id), 'tm-dino:[tm-dino]', 'the old portal\'s hand-off stands, Bea is not put back');
        assert.strictEqual(sys(id).length, n0); assert.strictEqual(emails.length, 0);
        assert.strictEqual(q.get('SELECT updated_at FROM project_tasks WHERE id = ?', [id]).updated_at, before, 'nothing written');
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
    });

    await t('STALE: when the people keep moving under the change, three tries then 409 "This task just changed. Reopen it and try again." and nothing is written', async () => {
        const id = await staleTask('Qst keeps moving');
        const before = q.get('SELECT updated_at FROM project_tasks WHERE id = ?', [id]).updated_at;
        REP.reset(); emails.length = 0; const n0 = sys(id).length;
        const order = ['tm-bea', 'tm-cleo', 'tm-dino'];
        REP.onSync = n => { if (n >= 2) oldPortal(id, order[n % 3]); };   // a different hand-off before every re-read
        const r = await REP.put(as.laura, id, { tag: [emaId()] });
        assert.strictEqual(r.status, 409, JSON.stringify(r.body));
        assert.deepStrictEqual(r.body, { error: 'This task just changed. Reopen it and try again.' });
        assert.strictEqual(REP.syncs, 4, 'one sync before the read, then three tries: ' + REP.events.join(','));
        assert.strictEqual(stOf(id), 'tm-cleo:[tm-cleo]', 'the old portal\'s last move stands, Ema is not on it');
        assert.strictEqual(sys(id).length, n0, 'no activity line'); assert.strictEqual(emails.length, 0, 'no email');
        assert.strictEqual(q.get('SELECT updated_at FROM project_tasks WHERE id = ?', [id]).updated_at, before, 'nothing written');
        // settled: the same change goes through
        REP.reset();
        const ok = await REP.put(as.laura, id, { tag: [emaId()] });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body)); assert.strictEqual(stOf(id), `tm-cleo:[tm-cleo,${emaId()}]`);
        await call('DELETE', '/api/admin/tasks/:id', as.laura, { params: { id } });
    });

    await t('BOOT: the stale-row sweep runs first and on its own — a trigger DDL that fails never skips it, a sweep that fails never skips the trigger', () => {
        const vis = require(path.join(ROOT, 'shared/task-visibility.js'));
        const mk = () => {
            const d = createDatabase(Database, { localPath: ':memory:' });
            d.run(`CREATE TABLE project_tasks (id TEXT PRIMARY KEY, title TEXT, created_by TEXT, assigned_to TEXT, parent_id TEXT)`);
            d.run(`CREATE TABLE v2_task_people (task_id TEXT NOT NULL, member_id TEXT NOT NULL, added_by TEXT, added_at TEXT, PRIMARY KEY (task_id, member_id))`);
            d.run(`INSERT INTO project_tasks (id, title, assigned_to) VALUES ('live', 'x', 'tm-a'), ('stale', 'x', 'tm-d'), ('noone', 'x', NULL)`);
            d.run(`INSERT INTO v2_task_people (task_id, member_id) VALUES ('live','tm-a'),('live','tm-b'),('stale','tm-b'),('stale','tm-e'),('noone','tm-f'),('gone','tm-a')`);
            const all = sql => { const st = d.prepare(sql); st.bind([]); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
            return { d, rows: () => all('SELECT task_id, member_id FROM v2_task_people ORDER BY task_id, member_id').map(r => r.task_id + ':' + r.member_id),
                     trigger: () => all(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_task_people_one_person_write'`).length };
        };
        const a = mk();
        assert.throws(() => vis.ensureTaskPeopleTable((sql, p) => { if (/CREATE TRIGGER/.test(sql)) throw new Error('trigger DDL refused'); return a.d.run(sql, p); }), /trigger DDL refused/);
        assert.deepStrictEqual(a.rows(), ['live:tm-a', 'live:tm-b'], 'the sweep ran although the trigger DDL failed');
        const b = mk();
        assert.throws(() => vis.ensureTaskPeopleTable((sql, p) => { if (/^\s*DELETE FROM v2_task_people/.test(sql)) throw new Error('sweep refused'); return b.d.run(sql, p); }), /sweep refused/, 'a failing sweep is still reported');
        assert.strictEqual(b.trigger(), 1, 'the trigger was created although the sweep failed');
        const c = mk();
        vis.ensureTaskPeopleTable((sql, p) => c.d.run(sql, p));
        assert.deepStrictEqual(c.rows(), ['live:tm-a', 'live:tm-b']); assert.strictEqual(c.trigger(), 1);
    });

    await t('MULTI: the board view — chips + ADD PERSON in the add bar and the drawer, up to three names on a card, the privacy line never names someone without an account', () => {
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/views/tasks.js'), 'utf8');
        assert.ok(/peopleField\(addChosen\(\), 'addWho', 'untagAdd'\)/.test(src), 'the add bar WHO is the chips field');
        assert.ok(/peopleField\(peopleOf\(t\), 'who', 'untag', !!st\.peopleBusy\)/.test(src), 'the drawer WHO is the chips field (waiting while a save is in flight)');
        assert.ok(/assignees: st\.addPeople/.test(src), 'the add bar sends the whole set (a new task)');
        assert.ok(/untag\.length \? \{ untag \} : \{ tag \}/.test(src) && !/\{ assignees: ids \}/.test(src), 'the drawer sends a change (tag / untag), never the whole set it last loaded');
        assert.ok(/savePeople\(\{ untag: \[el\.dataset\.id\] \}/.test(src) && /savePeople\(\{ tag: \[v\] \}/.test(src), 'the chip × untags one person, the picker tags one');
        assert.ok(/COPY\.confirm\.handOff\(keep\)\)\)\)\) \{ st\.peopleBusy = false; if \(st\.open\) rerenderDrawer\(\); return; \}/.test(src), 'KEEP IT on the hand-off question frees the × and the picker at once');
        assert.ok(/if \(!st\.open \|\| !st\.detail \|\| st\.peopleBusy\) return;/.test(src) && /markPeopleBusy\(\);/.test(src) && /finally \{ if \(st\) st\.peopleBusy = false; \}/.test(src), 'one people save at a time; the × and the picker wait for it');
        assert.ok(/aria-label="\$\{esc\(c\.remove\(n\)\)\}"\$\{off\}>/.test(src) && /aria-label="\$\{esc\(c\.pick\)\}"\$\{off\}>/.test(src), 'the × and the picker render disabled while busy');
        assert.ok(/loadDetail\(id, \{ quiet: true \}\)/.test(src) && /poll = setInterval\(async \(\) => \{[\s\S]{0,400}rerenderDrawer\(\)/.test(src), 'the 60 s poll reloads the open drawer too');
        assert.ok(/<span class="mx-person-flag">\$\{esc\(c\.noAccountMark\)\}<\/span>/.test(src) && /noAccountMark: 'NO ACCOUNT'/.test(src), 'a person with no portal account is marked on the chip (touch screens never show the tooltip)');
        assert.ok(/everyone you tag who has a portal account gets one short email/.test(src) && !/the person you pick gets one short email/.test(src), 'the empty board speaks of everyone tagged');
        assert.ok(/names\.slice\(0, 3\)\.join\(' · '\)/.test(src), 'up to three first names on a card');
        assert.ok(/if \(!p \|\| !p\.user_id \|\| isMePerson\(p\)/.test(src), 'a person without an account is never named');
        assert.ok(!/\bhonest|\bplainly/i.test(src));
        const today = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/views/today.js'), 'utf8');
        assert.ok(/const myTasks = tasks\.filter\(onMe\)/.test(today), 'Today\'s YOUR TASKS counts a task I am tagged on');
        assert.ok(/e\.status === 409 \|\| e\.status === 404\) && st && st\.open === t\.id\) \{ await loadDetail\(t\.id, \{ quiet: true \}\); try \{ await load\(\); \} catch \(x\) \{[^}]*\} reloaded = true; \}/.test(src) && /if \(saved \|\| reloaded\) rerenderBoard\(\);/.test(src),
            'a 409 (the people moved under the change) or a 404 (the task left me) reloads the drawer and the board');
        assert.ok(/emptyWhy: 'Add the next thing on the board — everyone you tag who has a portal account gets one short email\.'/.test(today) && !/the person you pick/.test(today),
            'Today\'s empty state speaks of everyone tagged, as the board does');
        assert.ok(!/;/.test(/emptyWhy: '([^']*)'/.exec(today)[1]) && !/\bhonest|\bplainly/i.test(today));
        const css = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/css/views/tasks.css'), 'utf8');
        assert.ok(/\.mx-person, \.mx-person-add \{ height: 44px; \}/.test(css), '44 px targets on a phone');
        assert.ok(/@media \(max-width: 760px\), \(pointer: coarse\) \{\n  \.mx-person, \.mx-person-add \{ height: 44px; \}/.test(css), '…and on any touch screen wider than a phone (a tablet)');
        assert.ok(/\.mx-tasks-add input\[data-role="addTitle"\] \{ flex-basis: 100% !important; min-height: 44px; box-sizing: border-box; \}/.test(css), 'the add bar title is a 44 px field on a phone');
        assert.ok(/\.mx-person\.noacct \{ border-style: dashed;/.test(css) && /\.mx-person-x:disabled/.test(css), 'no-account chips are dashed, a waiting × looks it');
        assert.ok(!/;/.test(Object.values(require('node:vm').runInNewContext('(' + /export const COPY = (\{[\s\S]*?\n\});/.exec(src)[1] + ')', {}).empty.board).join(' ')), 'no semicolon in the empty-board copy');
        const cal = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/views/calendar.js'), 'utf8');
        assert.ok(/exportPdfTitle: 'A print-ready year board in the Med&X look, one page\. Your browser\\'s print dialog opens, choose Save as PDF\.'/.test(cal), 'the calendar export title carries no semicolon');
        assert.ok(/\.mx-person-x \{ width: 44px; margin: -1px -1px -1px 0; \}/.test(css), 'the × itself is 44 × 44 on a phone');
        assert.ok(/\.mx-person-add select \{ inset: -1px; width: auto; height: auto; max-width: none; \}/.test(css), 'the picker fills the whole 44 px button');
        assert.ok(/function drawerPrivacyText\(t\) \{\n  const list = peopleOf\(t\)\.slice\(\);\n  if \(!list\.length && \(!t\.created_by \|\| t\.created_by === me\(\)\.id\)\) return COPY\.privacy\.untagged;/.test(src),
            'the drawer of my card with no one on it reads "Only you will see this task until you tag someone."');
    });

    await t('every write left an audit row', () => {
        const actions = q.all('SELECT DISTINCT action FROM audit_log').map(r => r.action);
        for (const a of ['task.create', 'task.update', 'task.result', 'task.comment', 'task.file.upload', 'task.file.remove', 'task.archive', 'task.unarchive', 'task.delete']) assert.ok(actions.includes(a), 'missing audit ' + a);
    });

    await t('permissions: /api/v2/tasks and /api/admin/tasks are NOT section-gated (every signed-in admin), and server.js no longer owns the legacy routes', () => {
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');
        const m = /const SECTION_ROUTE_MAP = \[([\s\S]*?)\n\];/.exec(src);
        assert.ok(m, 'SECTION_ROUTE_MAP found');
        const map = new Function('return [' + m[1] + '\n];')();
        const sectionFor = p => { for (const [prefix, section] of map) if (p === prefix || p.startsWith(prefix + '/')) return section; return null; };
        assert.strictEqual(sectionFor('/api/v2/tasks'), null);
        assert.strictEqual(sectionFor('/api/v2/tasks/badge'), null);
        assert.strictEqual(sectionFor('/api/admin/tasks'), null);
        assert.strictEqual(sectionFor('/api/admin/tasks/abc'), null);
        assert.ok(!/app\.get\('\/api\/admin\/tasks'/.test(src) && !/app\.put\('\/api\/admin\/tasks\/:id'/.test(src), 'legacy handlers live in v2/tasks.js now');
        assert.ok(/status NOT IN \('done','seen'\)/.test(src), 'the legacy counters treat seen as finished');
    });

    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})().catch(e => { console.error(e); process.exit(1); });
