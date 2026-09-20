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
 * every signed-in admin).
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
        assert.deepStrictEqual(sys(taskId).map(x => x.body), ['Alen created the task and assigned it to Laura']);
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
        assert.match(up.body.file.url, /^\/api\/v2\/tasks\/files\/[^?]+\?exp=\d+&sig=[0-9a-f]{32}$/);
        const row = q.get('SELECT * FROM task_files WHERE id = ?', [fileId]);
        assert.ok(row.file_path.startsWith(path.join(tmpRoot, 'user-portal', 'backend', 'uploads', 'tasks')), 'stored under the shared uploads root: ' + row.file_path);
        assert.ok(fs.existsSync(row.file_path));
        assert.ok(sys(taskId).some(x => x.body === 'Laura attached TK itinerary — Boston.pdf'));
        const list = (await call('GET', '/api/v2/tasks', as.alen)).body.tasks.find(x => x.id === taskId);
        assert.strictEqual(list.file_count, 1);
        // the signed link opens the file with NO session (that is the point of it — a plain <a href>)
        const u = new URL('https://x' + up.body.file.url);
        const okDl = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(okDl.status, 200, JSON.stringify(okDl.body));
        assert.strictEqual(okDl.file, row.file_path);
        assert.match(String(okDl.headers['content-disposition']), /^attachment/);
        assert.strictEqual(okDl.headers['x-content-type-options'], 'nosniff');
        // a forged or expired signature falls back to the session gate → 401 without one
        const bad = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), sig: 'f'.repeat(32) } });
        assert.strictEqual(bad.status, 401);
        const expired = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: '1000', sig: u.searchParams.get('sig') } });
        assert.strictEqual(expired.status, 401);
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
        assert.ok(sys(taskId).some(x => x.body === 'Alen assigned to Miro'));
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
        // make it "done, unseen" first so the badge has something to lose
        await call('PUT', `/api/v2/tasks/:id`, as.laura, { params: { id: taskId }, body: { assigned_to: M.laura } });
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
