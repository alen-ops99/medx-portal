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
 * helper's SQL; the board copy). The server.js readers are covered by tests/tasks-privacy-routes.test.js.
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
        // a signed link never mints a fresh one (?json=1 hands back the SAME link, so it runs out and a
        // link held after a reassignment cannot renew itself)
        // (a link minted 100 s earlier than a fresh one would be, so a renewal cannot pass by coincidence)
        const exp2 = Number(u.searchParams.get('exp')) - 100;
        const sig2 = require('node:crypto').createHmac('sha256', 'tasks-test-secret').update('task-file:' + fileId + ':' + exp2).digest('hex').slice(0, 32);
        const again = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: fileId }, query: { exp: String(exp2), sig: sig2, json: '1' } });
        assert.strictEqual(again.status, 200, JSON.stringify(again.body));
        assert.strictEqual(again.body.url, `/api/v2/tasks/files/${encodeURIComponent(fileId)}?exp=${exp2}&sig=${sig2}`, 'the same exp + sig, not a renewal');
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
    let pid = null, pfid = null, pfurl = null;
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
        const r = await call('GET', '/api/v2/tasks/files/:fid', null, { params: { fid: pfid }, query: { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
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
    });

    await t('PRIVACY: the board never promises "everyone" and says who can see a card (add bar + drawer)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/views/tasks.js'), 'utf8');
        assert.ok(!/'EVERYONE'/.test(src), 'no EVERYONE filter');
        assert.ok(/Only you and \$\{who\} will see this task\./.test(src), 'the add bar line');
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
