#!/usr/bin/env node
/**
 * Task visibility test (owner rule, 25 Sept 2026): "I would only like the person who is tagged in
 * it to actually see these stuff."
 *
 * A project task is visible ONLY to its creator and its assignee (subtasks follow their parent).
 * No founder override. A non-participant gets the SAME 404 as a missing task on reads and writes.
 *
 * Boots BOTH portal backends against one throwaway SQLite file (no Turso, no Stripe, no email
 * provider). Laura (A) creates task T assigned to Bob (B), with a subtask S, a file F and a
 * checklist task K. Carol (C, plain admin) and Alen (founder) are non-participants and must not
 * list, read, search, count or modify any of it, on the admin AND the member-portal backend.
 * Reassigning T to Carol moves visibility: Bob loses it, Carol gains it, Laura keeps it.
 *
 *   node tests/task-visibility.test.js
 *
 * Exits 1 on any failure. Cleans up its servers + scratch dir.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3111';
const ADMIN = 'http://localhost:3112';

// The servers' hand-rolled .env loader fills EMPTY env vars from a backend .env file, which could
// point a test boot at the live database. Refuse to run if one is present.
for (const dir of ['admin-portal/backend', 'user-portal/backend']) {
    if (fs.existsSync(path.join(ROOT, dir, '.env'))) {
        console.error('ABORT: ' + dir + '/.env exists; this test must never boot against a real database.');
        process.exit(1);
    }
}

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
};

const api = async (base, p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) {}
    return { status: r.status, d, text };
};
const upload = async (base, p, token, name, content) => {
    const fd = new FormData();
    fd.append('file', new Blob([content], { type: 'text/plain' }), name);
    const r = await fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
    const text = await r.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) {}
    return { status: r.status, d, text };
};

const waitUp = async (base, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('server at ' + base + ' did not come up');
};

const SECRET = 'PERSONAL-'; // every private title/description carries this marker
const listFiles = (dir) => { try { return fs.readdirSync(dir).sort(); } catch (e) { return []; } };

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-taskvis-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(scratch, 'scratch.db'),
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', ANTHROPIC_API_KEY: '',
        JWT_SECRET: 'task-visibility-test-secret',
        NODE_ENV: 'test',
    };
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        p.stderr.on('data', () => {});
        procs.push(p);
        return p;
    };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('user-portal/backend', 3111);
        await waitUp(USER);
        boot('admin-portal/backend', 3112);
        await waitUp(ADMIN);

        // ---- people: founder (seeded) + three granted admins, each with a team_members row ----
        // A fresh DB runs the admin boot's one-time founder unlock (temp password + forced change),
        // so sign in with that temp password and set a real one first.
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'MedX-Unlock-2026' } });
        if (r.status !== 200) r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'admin123' } });
        const alen = r.d && r.d.token;
        if (alen && r.d.mustChangePassword) await api(ADMIN, '/api/auth/change-password', { method: 'POST', token: alen, body: { newPassword: 'task-vis-founder-9' } });
        check('scratch boot: seeded founder login works', r.status === 200 && alen, r.text);

        const people = {};
        for (const [key, first] of [['a', 'Laura'], ['b', 'Bob'], ['c', 'Carol']]) {
            const email = `qa.robot+taskvis-${key}@example.com`;
            r = await api(ADMIN, '/api/admin/team/grant', { method: 'POST', token: alen, body: { email, password: 'task-vis-pass-9', first_name: first, last_name: 'Test', role: 'admin' } });
            check(`grant admin ${first}`, r.status === 200, r.text);
            r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email, password: 'task-vis-pass-9' } });
            check(`${first} logs in`, r.status === 200 && r.d && r.d.token, r.text);
            people[key] = { token: r.d && r.d.token, name: first };
        }
        people.f = { token: alen, name: 'Alen (founder)' };
        for (const key of ['a', 'b', 'c', 'f']) {
            r = await api(ADMIN, '/api/team', { method: 'POST', token: people[key].token, body: { name: people[key].name + ' Test', role: 'Admin' } });
            people[key].tm = r.d && r.d.id;
            check(`${people[key].name} has a team member id`, r.status === 200 && people[key].tm, r.text);
        }
        const { a: A, b: B, c: C, f: F } = people;

        r = await api(ADMIN, '/api/tasks/plexus', { token: A.token });
        check('granted admin reaches the task board (no section lock)', r.status === 200 && Array.isArray(r.d), r.status + ' ' + r.text);

        // ---- Laura creates T (assigned to Bob, overdue), subtask S, file F, checklist task K ----
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: { project: 'plexus', title: SECRET + 'T doctor appointment', description: SECRET + 'desc private', assigned_to: B.tm, priority: 'high', due_date: yesterday } });
        const T = r.d && r.d.id;
        check('A creates T assigned to B', r.status === 200 && T, r.text);
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: { project: 'plexus', title: SECRET + 'S subtask', parent_id: T } });
        const S = r.d && r.d.id;
        check('A creates subtask S under T', r.status === 200 && S, r.text);
        r = await upload(ADMIN, `/api/tasks/${T}/files`, A.token, 'personal-note.txt', 'private file body');
        const Fid = r.d && r.d.id;
        check('A attaches file F to T', r.status === 200 && Fid, r.text);
        r = await api(ADMIN, '/api/admin/tasks', { method: 'POST', token: A.token, body: { project: 'plexus', title: SECRET + 'K checklist', assigned_to: B.tm } });
        const K = r.d && r.d.id;
        check('A creates checklist task K assigned to B', r.status === 200 && K, r.text);

        // ---- participants (creator A, assignee B) see everything ----
        for (const P of [A, B]) {
            r = await api(ADMIN, '/api/tasks/plexus', { token: P.token });
            const t = (r.d || []).find(x => x.id === T);
            check(`${P.name}: board lists T with subtask S and file F`, t && (t.subtasks || []).some(s => s.id === S) && (t.files || []).some(f => f.id === Fid));
            r = await api(ADMIN, '/api/tasks', { token: P.token });
            check(`${P.name}: /api/tasks summary includes T`, r.d && r.d.by_project && r.d.by_project.plexus.some(x => x.id === T));
            r = await api(ADMIN, '/api/search?q=' + encodeURIComponent(SECRET), { token: P.token });
            const ids = (r.d && r.d.tasks || []).map(x => x.id);
            check(`${P.name}: search finds T and S`, ids.includes(T) && ids.includes(S), JSON.stringify(ids));
            r = await api(ADMIN, '/api/admin/tasks', { token: P.token });
            const cl = (r.d || []).map(x => x.id);
            check(`${P.name}: checklist lists T and K`, cl.includes(T) && cl.includes(K));
            r = await api(ADMIN, '/api/admin/tasks?project=plexus', { token: P.token });
            const clp = (r.d || []).map(x => x.id);
            check(`${P.name}: project-filtered checklist lists T and K`, clp.includes(T) && clp.includes(K));
        }
        r = await api(ADMIN, '/api/dashboard/summary', { token: B.token });
        check('B: dashboard counts his three open tasks (T, S, K)', r.d && r.d.tasks && r.d.tasks.total === 3 && r.d.plexus.pending_tasks === 3, JSON.stringify(r.d && r.d.tasks));
        r = await api(ADMIN, '/api/dashboard/portal-stats', { token: B.token });
        check('B: portal-stats counts T as overdue + urgent', r.d && r.d.tasks && r.d.tasks.overdue === 1 && r.d.tasks.urgent === 1, JSON.stringify(r.d && r.d.tasks));

        // ---- non-participants (C, founder) see nothing, on BOTH backends ----
        const missing = '00000000-0000-4000-8000-000000000000';
        for (const P of [C, F]) {
            for (const [label, base] of [['admin', ADMIN], ['member', USER]]) {
                r = await api(base, '/api/tasks/plexus', { token: P.token });
                check(`${P.name} @${label}: board has no trace of T/S/F`, r.status === 200 && !r.text.includes(SECRET) && !r.text.includes(T) && !r.text.includes(Fid), r.status);
                r = await api(base, '/api/tasks', { token: P.token });
                check(`${P.name} @${label}: /api/tasks summary has no trace`, r.status === 200 && !r.text.includes(SECRET) && !r.text.includes(T));
                r = await api(base, '/api/search?q=' + encodeURIComponent(SECRET), { token: P.token });
                check(`${P.name} @${label}: search finds nothing`, r.status === 200 && r.d && r.d.tasks.length === 0 && !r.text.includes(SECRET));
                r = await api(base, '/api/dashboard/summary', { token: P.token });
                const expectTotal = P === C ? 0 : null; // the founder keeps the seeded demo tasks assigned to him
                if (expectTotal !== null) check(`${P.name} @${label}: dashboard task counts are zero`, r.d && r.d.tasks.total === 0 && r.d.tasks.urgent === 0 && r.d.plexus.pending_tasks === 0, JSON.stringify(r.d && r.d.tasks));
            }
            r = await api(ADMIN, '/api/admin/tasks', { token: P.token });
            check(`${P.name}: checklist has no trace of T/K`, r.status === 200 && !r.text.includes(SECRET));
            r = await api(ADMIN, '/api/admin/tasks?project=plexus', { token: P.token });
            check(`${P.name}: project-filtered checklist has no trace of T/K`, r.status === 200 && !r.text.includes(SECRET));
        }
        r = await api(ADMIN, '/api/dashboard/portal-stats', { token: C.token });
        check('C: portal-stats overdue/urgent are zero', r.d && r.d.tasks && r.d.tasks.overdue === 0 && r.d.tasks.urgent === 0, JSON.stringify(r.d && r.d.tasks));

        // ---- non-participant writes: identical 404 to a missing task, and nothing changes ----
        const docsDir = path.join(ROOT, 'admin-portal/backend/uploads/documents');
        const docsBefore = listFiles(docsDir);
        for (const P of [C, F]) {
            for (const [label, base] of [['admin', ADMIN], ['member', USER]]) {
                const miss = await api(base, `/api/tasks/${missing}`, { method: 'PUT', token: P.token, body: { title: 'x' } });
                check(`@${label}: PUT on a missing task is 404`, miss.status === 404, miss.text);
                const same = (x, name) => check(`${P.name} @${label}: ${name} answers exactly like a missing task`, x.status === 404 && x.text === miss.text, x.status + ' ' + x.text);
                same(await api(base, `/api/tasks/${T}`, { method: 'PUT', token: P.token, body: { title: 'hijacked', status: 'done' } }), 'PUT T');
                same(await api(base, `/api/tasks/${S}`, { method: 'PUT', token: P.token, body: { title: 'hijacked' } }), 'PUT subtask S');
                same(await api(base, `/api/tasks/${T}/toggle`, { method: 'POST', token: P.token }), 'toggle T');
                same(await api(base, `/api/tasks/${T}`, { method: 'DELETE', token: P.token }), 'DELETE T');
                same(await api(base, `/api/tasks/${S}`, { method: 'DELETE', token: P.token }), 'DELETE S');
                same(await api(base, '/api/tasks', { method: 'POST', token: P.token, body: { project: 'plexus', title: 'sneaky child', parent_id: T } }), 'POST subtask under T');
                const fMiss = await api(base, `/api/tasks/files/${missing}`, { method: 'DELETE', token: P.token });
                const fHid = await api(base, `/api/tasks/files/${Fid}`, { method: 'DELETE', token: P.token });
                check(`${P.name} @${label}: DELETE file F answers exactly like a missing file`, fHid.status === 404 && fHid.text === fMiss.text, fHid.text);
            }
            const upMiss = await upload(ADMIN, `/api/tasks/${missing}/files`, P.token, 'x.txt', 'x');
            const upHid = await upload(ADMIN, `/api/tasks/${T}/files`, P.token, 'x.txt', 'x');
            check(`${P.name}: upload to T answers exactly like a missing task`, upHid.status === 404 && upHid.text === upMiss.text, upHid.text);
            const kMiss = await api(ADMIN, `/api/admin/tasks/${missing}`, { method: 'PUT', token: P.token, body: { done: 1 } });
            const kPut = await api(ADMIN, `/api/admin/tasks/${K}`, { method: 'PUT', token: P.token, body: { done: 1 } });
            const kDel = await api(ADMIN, `/api/admin/tasks/${K}`, { method: 'DELETE', token: P.token });
            check(`${P.name}: checklist PUT/DELETE K answer exactly like a missing task`, kPut.status === 404 && kPut.text === kMiss.text && kDel.status === 404 && kDel.text === kMiss.text, kPut.text + ' / ' + kDel.text);
        }
        check('denied uploads leave no stray file behind', JSON.stringify(listFiles(docsDir)) === JSON.stringify(docsBefore));
        r = await api(ADMIN, '/api/tasks/plexus', { token: A.token });
        const tAfter = (r.d || []).find(x => x.id === T);
        check('after all denied writes T is untouched (title, status, subtask, file)', tAfter && tAfter.title === SECRET + 'T doctor appointment' && tAfter.status === 'todo' && tAfter.subtasks.length === 1 && tAfter.subtasks[0].title === SECRET + 'S subtask' && tAfter.files.length === 1);
        r = await api(ADMIN, '/api/admin/tasks', { token: A.token });
        const kAfter = (r.d || []).find(x => x.id === K);
        check('after all denied writes K is still open', kAfter && kAfter.status === 'todo');

        // ---- Action Center: the overdue-task item is seen and actionable only by participants ----
        r = await api(ADMIN, '/api/admin/nag/run', { method: 'POST', token: F.token });
        check('nag scan runs', r.status === 200, r.text);
        r = await api(ADMIN, '/api/admin/nag/items', { token: B.token });
        const nag = (r.d && r.d.items || []).find(x => x.subject_id === T);
        check('B (assignee) sees the overdue-task item for T', nag && nag.kind === 'task_overdue');
        for (const P of [C, F]) {
            r = await api(ADMIN, '/api/admin/nag/items', { token: P.token });
            check(`${P.name}: Action Center has no trace of T`, r.status === 200 && !r.text.includes(SECRET) && !r.text.includes(T));
            if (nag) {
                const nMiss = await api(ADMIN, `/api/admin/nag/items/${missing}/done`, { method: 'POST', token: P.token });
                for (const act of ['done', 'act', 'dismiss', 'claim']) {
                    const x = await api(ADMIN, `/api/admin/nag/items/${nag.id}/${act}`, { method: 'POST', token: P.token });
                    check(`${P.name}: nag ${act} on T's item answers like a missing item`, x.status === 404 && x.text === nMiss.text, x.text);
                }
            }
        }
        r = await api(ADMIN, '/api/tasks/plexus', { token: B.token });
        check('T is still open after the denied Action Center "done"', ((r.d || []).find(x => x.id === T) || {}).status === 'todo');

        // ---- reassignment moves visibility: B -> C ----
        r = await api(ADMIN, `/api/tasks/${T}`, { method: 'PUT', token: B.token, body: { title: SECRET + 'T doctor appointment', description: SECRET + 'desc private', assigned_to: C.tm, priority: 'high', status: 'todo', due_date: yesterday, project: 'plexus' } });
        check('B (assignee) may edit and reassign T to C', r.status === 200, r.text);
        r = await api(ADMIN, '/api/tasks/plexus', { token: B.token });
        check('B lost T after reassignment (not the creator)', r.status === 200 && !r.text.includes(T));
        r = await api(ADMIN, `/api/tasks/${T}`, { method: 'PUT', token: B.token, body: { title: 'late edit' } });
        check('B can no longer write T', r.status === 404);
        r = await api(ADMIN, '/api/tasks/plexus', { token: C.token });
        check('C now sees T with its subtask and file', ((r.d || []).find(x => x.id === T) || {}).subtasks?.length === 1);
        r = await api(ADMIN, '/api/tasks/plexus', { token: A.token });
        check('A (creator) still sees T', (r.d || []).some(x => x.id === T));
        r = await api(ADMIN, '/api/tasks/plexus', { token: F.token });
        check('founder still does not see T', r.status === 200 && !r.text.includes(T));

        // ---- cleanup through the API (removes the uploaded file from disk) ----
        r = await api(ADMIN, `/api/tasks/files/${Fid}`, { method: 'DELETE', token: A.token });
        check('creator can delete file F', r.status === 200, r.text);
        r = await api(ADMIN, `/api/tasks/${T}`, { method: 'DELETE', token: C.token });
        check('new assignee C can delete T', r.status === 200, r.text);
    } catch (e) {
        check('unexpected error: ' + e.message, false);
    } finally {
        cleanup();
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
