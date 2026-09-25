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
 * Side channels (leak re-check, same day): the Action Center nudge, the shared admin inbox, the
 * audit-log feed, the /nag/run counts, the tech DB tools (a test TECH_PASSWORD) and the task file
 * gate carry no task text to a non-participant, including older rows written before the fix.
 *
 * More than one person (owner request, same day): tag rows in v2_task_people (written by the
 * redesign; inserted straight into the scratch DB here) put a second person on T on both backends
 * (board, search, summary, dashboard, Action Center, file gate, tech tools), while the founder stays
 * an outsider with the missing-task 404. Untagging takes it away again, a subtask's own tag row
 * grants nothing, and every delete route of this portal drops the task's (and subtasks') tag rows.
 * A hand-off or unassign on THIS portal (admin PUT, checklist PUT, member PUT) leaves the task to
 * exactly the new person: the tag rows collapse to [new] (or []), and every formerly tagged person
 * gets the missing-task 404 on both backends. Tag rows a one-person writer left stale (assigned_to
 * not among them) grant nothing. The tech tools scope the redesign's v2_task_comments and the
 * demo-purge backups (_purged_*) like their live tables, and the table list counts only own rows.
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

const api = async (base, p, { method = 'GET', body, token, headers: extra } = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(extra || {}) };
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
const TECH_PASS = 'task-vis-tech-pass-9'; // throwaway TECH_PASSWORD for the scratch servers only
const taskVis = require(path.join(ROOT, 'shared/task-visibility'));
const listFiles = (dir) => { try { return fs.readdirSync(dir).sort(); } catch (e) { return []; } };

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-taskvis-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(scratch, 'scratch.db'),
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', ANTHROPIC_API_KEY: '',
        JWT_SECRET: 'task-visibility-test-secret',
        TECH_PASSWORD: TECH_PASS,
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
        // ---- unit: the side-channel helpers ----
        const oldNudge = { sender_type: 'admin', title: 'Task reminder', sender_id: 'u-a', receiver_id: 'u-b', content: 'Reminder: "' + SECRET + 'x" (due 2026-09-24) needs your attention.' };
        check('unit: a task nudge is dropped for a third party', taskVis.redactTaskReminderDm(oldNudge, 'u-c') === null);
        check('unit: any other message passes through', taskVis.redactTaskReminderDm({ sender_type: 'admin', title: 'Hello', content: 'x' }, 'u-c').content === 'x');
        check('unit: its sender and receiver still read it', taskVis.redactTaskReminderDm(oldNudge, 'u-a').content === oldNudge.content && taskVis.redactTaskReminderDm(oldNudge, 'u-b').content === oldNudge.content);
        check('unit: with no caller (the drafting prompt) it is always neutral', taskVis.redactTaskReminderDm(oldNudge, null).content === taskVis.TASK_REMINDER_BODY);
        check('unit: new nudge body carries no task text', !/PERSONAL|due \d/.test(taskVis.TASK_REMINDER_BODY));
        const someId = '11111111-2222-4333-8444-555555555555';
        check('unit: older task.create audit title is hidden, a new id is kept', taskVis.redactAuditRow({ action: 'task.create', detail: SECRET + 'x' }).detail === '(task title hidden)' && taskVis.redactAuditRow({ action: 'task.create', detail: someId }).detail === someId);
        check('unit: older nag.act task line loses the name, sponsor lines keep theirs', !taskVis.redactAuditRow({ action: 'nag.act', detail: 'task_overdue -> assignee nudged (Bob Test)' }).detail.includes('Bob') && taskVis.redactAuditRow({ action: 'nag.act', detail: 'sponsor_deliverable -> assignee nudged (Ann)' }).detail.includes('Ann'));
        check('unit: /uploads/tasks is blocked in any spelling', ['/tasks/a.txt', '/TASKS/a', '/%74asks/a', '/documents/../tasks/a', '/tasks'].every(taskVis.isTaskUploadPath) && !taskVis.isTaskUploadPath('/documents/a.txt') && !taskVis.isTaskUploadPath('/taskslist/a'));

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
        for (const [key, first] of [['a', 'Laura'], ['b', 'Bob'], ['c', 'Carol'], ['d', 'Dave']]) {
            const email = `qa.robot+taskvis-${key}@example.com`;
            r = await api(ADMIN, '/api/admin/team/grant', { method: 'POST', token: alen, body: { email, password: 'task-vis-pass-9', first_name: first, last_name: 'Test', role: 'admin' } });
            check(`grant admin ${first}`, r.status === 200, r.text);
            r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email, password: 'task-vis-pass-9' } });
            check(`${first} logs in`, r.status === 200 && r.d && r.d.token, r.text);
            people[key] = { token: r.d && r.d.token, name: first };
        }
        people.f = { token: alen, name: 'Alen (founder)' };
        for (const key of ['a', 'b', 'c', 'd', 'f']) {
            r = await api(ADMIN, '/api/team', { method: 'POST', token: people[key].token, body: { name: people[key].name + ' Test', role: 'Admin' } });
            people[key].tm = r.d && r.d.id;
            check(`${people[key].name} has a team member id`, r.status === 200 && people[key].tm, r.text);
        }
        const { a: A, b: B, c: C, d: D, f: F } = people;

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

        // ================= side channels (leak re-check) =================
        const emailOf = { a: 'qa.robot+taskvis-a@example.com', b: 'qa.robot+taskvis-b@example.com', c: 'qa.robot+taskvis-c@example.com', d: 'qa.robot+taskvis-d@example.com', f: 'juginovic.alen@gmail.com' };
        const auditOf = async (P) => { const x = await api(ADMIN, '/api/admin/audit-log?limit=500', { token: P.token }); return { ...x, rows: Array.isArray(x.d) ? x.d : [] }; };

        // /nag/run answers with the caller's own counts (the same filter as /nag/items).
        const runOpen = {};
        for (const P of [B, C]) {
            r = await api(ADMIN, '/api/admin/nag/run', { method: 'POST', token: P.token });
            const listed = await api(ADMIN, '/api/admin/nag/items', { token: P.token });
            runOpen[P.name] = r.d && r.d.open;
            check(`${P.name}: /nag/run "open" equals their own Action Center count`, r.status === 200 && r.d.open === listed.d.counts.open && !r.text.includes(SECRET) && !r.text.includes(T), `run ${r.d && r.d.open} vs list ${listed.d && listed.d.counts && listed.d.counts.open}`);
        }
        check('/nag/run counts differ by exactly T\'s item between assignee and non-participant', runOpen[B.name] === runOpen[C.name] + 1, JSON.stringify(runOpen));

        // The creator nudges the assignee: the message carries no task text.
        r = await api(ADMIN, `/api/admin/nag/items/${nag && nag.id}/act`, { method: 'POST', token: A.token });
        check('A (creator) nudges B about T', r.status === 200 && r.d && r.d.action === 'nudge_sent', r.text);
        r = await api(USER, '/api/messages', { token: B.token });
        const bNudge = (Array.isArray(r.d) ? r.d : []).find(m => m.title === 'Task reminder');
        check('B receives the nudge, with no title or due date in it', bNudge && bNudge.content === taskVis.TASK_REMINDER_BODY, JSON.stringify(bNudge));
        const nudgeRows = (x) => (Array.isArray(x.d) ? x.d : []).filter(m => m.title === 'Task reminder');
        r = await api(ADMIN, '/api/admin/messages', { token: A.token });
        check('A (sender) sees her nudge to B in the admin inbox', nudgeRows(r).length === 1, nudgeRows(r).length);
        for (const P of [C, F]) {
            r = await api(ADMIN, '/api/admin/messages', { token: P.token });
            check(`${P.name}: shared admin inbox shows no task text and no nudge row`, r.status === 200 && !r.text.includes(SECRET) && !r.text.includes('(due ') && nudgeRows(r).length === 0, r.status + ' rows ' + nudgeRows(r).length);
            r = await api(ADMIN, '/api/admin/messages/' + encodeURIComponent(emailOf.b), { token: P.token });
            check(`${P.name}: B's admin thread shows no task text and no nudge row`, r.status === 200 && !r.text.includes(SECRET) && !r.text.includes('(due ') && nudgeRows(r).length === 0, r.status + ' rows ' + nudgeRows(r).length);
            const au = await auditOf(P);
            check(`${P.name}: audit feed has no task title and names nobody on a task nudge`, au.status === 200 && !au.text.includes(SECRET) && !au.rows.some(a => a.action === 'nag.act' && /Bob|task_/.test(a.detail || '')), JSON.stringify(au.rows.filter(a => a.action === 'nag.act')));
            check(`${P.name}: audit feed carries no global scan counts`, !au.rows.some(a => a.action === 'nag.scan' && /open/.test(a.detail || '')));
        }

        // A subtask given to someone who is not on the parent task is never nudged to them.
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: B.token, body: { project: 'plexus', title: SECRET + 'S2 for Carol', parent_id: T, assigned_to: C.tm, due_date: yesterday } });
        const S2 = r.d && r.d.id;
        check('B creates subtask S2 under T assigned to C (not on T)', r.status === 200 && S2, r.text);
        await api(ADMIN, '/api/admin/nag/run', { method: 'POST', token: B.token });
        r = await api(ADMIN, '/api/admin/nag/items', { token: B.token });
        const nagS2 = (r.d && r.d.items || []).find(x => x.subject_id === S2);
        check('B sees the overdue item for S2 (nudge offered)', nagS2 && nagS2.action_kind === 'nudge_assignee', JSON.stringify(nagS2 && nagS2.action_kind));
        r = await api(ADMIN, `/api/admin/nag/items/${nagS2 && nagS2.id}/act`, { method: 'POST', token: B.token });
        check('nudging C about S2 is refused (C cannot see T)', r.status === 400 && !r.text.includes(SECRET), r.status + ' ' + r.text);
        r = await api(USER, '/api/messages', { token: C.token });
        check('C received no message about S2', r.status === 200 && !r.text.includes(SECRET) && !r.text.includes('Task reminder'));
        r = await api(ADMIN, '/api/admin/nag/items', { token: C.token });
        check('C does not see the S2 item', r.status === 200 && !r.text.includes(SECRET) && !r.text.includes(S2));
        r = await api(ADMIN, `/api/tasks/${S2}`, { method: 'DELETE', token: B.token });
        check('B removes S2', r.status === 200, r.text);

        // Older rows written before the fix (title in the nudge, title/name in the audit detail) are
        // hidden when read. Written straight into the scratch DB, the way live already holds them.
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const raw = new Database(env.DATABASE_PATH);
        const uidOf = (email) => (raw.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email) || {}).id;
        const [aId, bId] = [uidOf(emailOf.a), uidOf(emailOf.b)];
        const { randomUUID } = require('crypto');
        raw.prepare("INSERT INTO direct_messages (id, sender_id, receiver_id, sender_type, receiver_type, title, content, is_read, created_at) VALUES (?, ?, ?, 'admin', 'user', 'Task reminder', ?, 0, datetime('now'))")
            .run(randomUUID(), aId, bId, 'Reminder: "' + SECRET + 'legacy nudge" (due 2026-09-24) needs your attention.');
        raw.prepare('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), aId, emailOf.a, 'task.create', SECRET + 'legacy checklist');
        raw.prepare('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), aId, emailOf.a, 'nag.act', 'task_overdue -> assignee nudged (Bob Test)');
        raw.close();
        check('legacy rows written', !!(aId && bId));
        for (const P of [C, F]) {
            r = await api(ADMIN, '/api/admin/messages', { token: P.token });
            check(`${P.name}: older nudge is hidden in the admin inbox`, r.status === 200 && !r.text.includes(SECRET) && nudgeRows(r).length === 0);
            r = await api(ADMIN, '/api/admin/messages/' + encodeURIComponent(emailOf.b), { token: P.token });
            check(`${P.name}: older nudge is hidden in B's thread`, r.status === 200 && !r.text.includes(SECRET) && nudgeRows(r).length === 0);
            const au = await auditOf(P);
            check(`${P.name}: older task titles / nudge names are hidden in the audit feed`, !au.text.includes(SECRET) && !au.rows.some(a => a.action === 'nag.act' && /Bob/.test(a.detail || '')));
        }
        r = await api(ADMIN, '/api/admin/messages', { token: A.token });
        check('A (the sender) still reads the older nudge', r.text.includes(SECRET + 'legacy nudge'));
        r = await api(ADMIN, '/api/admin/messages/' + encodeURIComponent(emailOf.b) + '/draft-reply', { method: 'POST', token: C.token });
        check('C: a reply draft for B never picks up a nudge C is not party to', r.status === 404 && !r.text.includes(SECRET), r.status + ' ' + r.text.slice(0, 120));
        r = await api(ADMIN, '/api/admin/messages/' + encodeURIComponent(emailOf.b) + '/draft-reply', { method: 'POST', token: A.token });
        check('A: the reply draft works on her own nudge and carries no task text', r.status === 200 && !r.text.includes(SECRET), r.status + ' ' + r.text.slice(0, 120));

        // Tech DB tools: the task tables show only the caller's own tasks.
        const TECH = { 'x-tech-password': TECH_PASS };
        const techTables = ['project_tasks', 'task_files', 'nag_items', 'direct_messages', 'push_outbox', 'scheduled_emails', 'audit_log'];
        for (const P of [C, F]) {
            for (const t of techTables) {
                r = await api(ADMIN, `/api/admin/tech/tables/${t}?limit=500`, { token: P.token, headers: TECH });
                check(`${P.name}: tech table ${t} has no task text`, r.status === 200 && !r.text.includes(SECRET) && !r.text.includes('personal-note.txt'), r.status + ' ' + r.text.slice(0, 120));
            }
            r = await api(ADMIN, '/api/admin/tech/tables/project_tasks?search=' + encodeURIComponent(SECRET), { token: P.token, headers: TECH });
            check(`${P.name}: tech search finds no private task (total 0)`, r.status === 200 && r.d.total === 0, JSON.stringify(r.d && r.d.total));
            r = await api(ADMIN, '/api/admin/tech/export-all', { token: P.token, headers: TECH });
            check(`${P.name}: tech export-all has no task text`, r.status === 200 && !r.text.includes(SECRET) && !r.text.includes('personal-note.txt'), r.status);
        }
        r = await api(ADMIN, '/api/admin/tech/tables/project_tasks?limit=500', { token: A.token, headers: TECH });
        check('A (creator): tech table project_tasks still shows T', r.status === 200 && r.text.includes(T));
        r = await api(ADMIN, '/api/admin/tech/tables/scheduled_emails?limit=500', { token: B.token, headers: TECH });
        // the digest is title-free (digest_v 2, same format as the redesign backend): B's row is there, the title is not
        check('B: tech table scheduled_emails shows his own title-free digest', r.status === 200 && r.text.includes('digest_v') && !r.text.includes(SECRET), r.status + ' ' + r.text.slice(0, 160));

        // Task file gate: never served statically; the download route checks the rule.
        r = await api(ADMIN, '/api/tasks/plexus', { token: A.token });
        const fRow = (((r.d || []).find(x => x.id === T) || {}).files || [])[0] || {};
        for (const u of ['/uploads/tasks/' + fRow.filename, '/uploads/%74asks/' + fRow.filename, '/uploads/TASKS/' + fRow.filename]) {
            const x = await fetch(ADMIN + u);
            check(`static ${u.replace(fRow.filename, '<file>')} is 404`, fRow.filename && x.status === 404, x.status);
        }
        const dl = async (P, id) => { const x = await fetch(`${ADMIN}/api/tasks/files/${id}/download`, { headers: P ? { Authorization: 'Bearer ' + P.token } : {} }); return { status: x.status, text: await x.text() }; };
        let x = await dl(B, Fid);
        check('B (assignee) downloads F through the gate', x.status === 200 && x.text === 'private file body', x.status);
        x = await dl(null, Fid);
        check('no session: the gate refuses', x.status === 401 || x.status === 403, x.status);
        for (const P of [C, F]) {
            const miss = await dl(P, missing);
            x = await dl(P, Fid);
            check(`${P.name}: download F answers exactly like a missing file`, x.status === 404 && x.text === miss.text, x.status + ' ' + x.text);
        }

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
        x = await dl(B, Fid);
        check('after reassignment B can no longer download F', x.status === 404, x.status);
        x = await dl(C, Fid);
        check('after reassignment C downloads F', x.status === 200 && x.text === 'private file body', x.status);

        // ================= more than one person on a task (v2_task_people) =================
        // Owner request, same day: "let us tag more than one person". The redesign writes the tag
        // rows (assigned_to = the first tagged person); this portal only reads them, so they are
        // written straight into the scratch DB. T now: creator A, assigned_to C (first tagged),
        // B tagged second, the founder on nothing. A subtask's own tag row grants nothing: S
        // follows T's people.
        const tagDb = new Database(env.DATABASE_PATH);
        const cols = tagDb.prepare('PRAGMA table_info(v2_task_people)').all();
        check('boot created v2_task_people with the shared columns and key',
            JSON.stringify(cols.map(c => c.name)) === JSON.stringify(['task_id', 'member_id', 'added_by', 'added_at'])
            && JSON.stringify(cols.filter(c => c.pk).map(c => c.name)) === JSON.stringify(['task_id', 'member_id']), JSON.stringify(cols));
        const tagRows = (ids) => tagDb.prepare(`SELECT COUNT(*) AS c FROM v2_task_people WHERE task_id IN (${ids.map(() => '?').join(',')})`).get(...ids).c;
        const tag = (taskId, P) => tagDb.prepare("INSERT OR IGNORE INTO v2_task_people (task_id, member_id, added_by, added_at) VALUES (?, ?, ?, datetime('now'))").run(taskId, P.tm, aId);
        const untag = (taskId, P) => tagDb.prepare('DELETE FROM v2_task_people WHERE task_id = ? AND member_id = ?').run(taskId, P.tm);
        check('unit: the rule reads the tag table for all three disjuncts', taskVis.visibleTaskSql('pt', 'u').params.length === 3 && /v2_task_people/.test(taskVis.visibleTaskSql('pt', 'u').sql));

        r = await api(ADMIN, '/api/dashboard/summary', { token: B.token });
        const bTotalBefore = r.d && r.d.tasks && r.d.tasks.total;
        r = await api(ADMIN, '/api/admin/nag/items', { token: B.token });
        check('before tagging, B has no Action Center item for T', r.status === 200 && !(r.d.items || []).some(it => it.subject_id === T));

        tag(T, C); // the first person, the same as assigned_to
        tag(T, B); // a second tagged person, not the assignee, not the creator
        tag(S, B); // a subtask's own tag row (the redesign may write one); dropped with T below

        for (const [label, base] of [['admin', ADMIN], ['member', USER]]) {
            for (const P of [B, C]) {
                r = await api(base, '/api/tasks/plexus', { token: P.token });
                const t = (r.d || []).find(y => y.id === T);
                check(`tagged ${P.name} @${label}: board lists T with subtask S and file F`, t && (t.subtasks || []).some(s => s.id === S) && (t.files || []).some(f => f.id === Fid));
                r = await api(base, '/api/search?q=' + encodeURIComponent(SECRET), { token: P.token });
                const ids = (r.d && r.d.tasks || []).map(y => y.id);
                check(`tagged ${P.name} @${label}: search finds T and S`, ids.includes(T) && ids.includes(S), JSON.stringify(ids));
            }
            r = await api(base, '/api/tasks', { token: B.token });
            check(`tagged Bob @${label}: /api/tasks summary includes T`, r.d && r.d.by_project && r.d.by_project.plexus.some(y => y.id === T));
            // two tagged, one outsider: the founder still sees nothing, and T answers like a missing task
            r = await api(base, '/api/tasks/plexus', { token: F.token });
            check(`outsider ${F.name} @${label}: board has no trace of T while two people are tagged`, r.status === 200 && !r.text.includes(T) && !r.text.includes(SECRET));
            r = await api(base, '/api/search?q=' + encodeURIComponent(SECRET), { token: F.token });
            check(`outsider ${F.name} @${label}: search finds nothing`, r.status === 200 && r.d && r.d.tasks.length === 0);
            const miss = await api(base, `/api/tasks/${missing}`, { method: 'PUT', token: F.token, body: { title: 'x' } });
            const hid = await api(base, `/api/tasks/${T}`, { method: 'PUT', token: F.token, body: { title: 'hijacked' } });
            check(`outsider ${F.name} @${label}: PUT T answers exactly like a missing task`, hid.status === 404 && hid.text === miss.text, hid.text);
        }
        r = await api(ADMIN, '/api/dashboard/summary', { token: B.token });
        check('tagged Bob: dashboard counts T and its subtask S (+2)', r.d && r.d.tasks && r.d.tasks.total === bTotalBefore + 2, `${bTotalBefore} -> ${r.d && r.d.tasks && r.d.tasks.total}`);
        r = await api(ADMIN, '/api/admin/nag/items', { token: B.token });
        check('tagged Bob: the Action Center shows T\'s overdue item', r.status === 200 && (r.d.items || []).some(it => it.subject_id === T));
        r = await api(ADMIN, '/api/admin/nag/items', { token: F.token });
        check(`outsider ${F.name}: the Action Center has no trace of T`, r.status === 200 && !r.text.includes(T) && !r.text.includes(SECRET));
        x = await dl(B, Fid);
        check('tagged Bob downloads F through the gate', x.status === 200 && x.text === 'private file body', x.status);
        x = await dl(F, Fid);
        const fMissDl = await dl(F, missing);
        check(`outsider ${F.name}: download F answers exactly like a missing file`, x.status === 404 && x.text === fMissDl.text, x.status);
        r = await api(ADMIN, '/api/admin/tech/tables/v2_task_people?limit=500', { token: B.token, headers: TECH });
        // T's two rows, S's row, and K's row (a v1 create writes its one person's tag row)
        check('tagged Bob: tech table v2_task_people shows the people of his tasks (T, S, K)', r.status === 200 && r.text.includes(T) && r.text.includes(K) && r.d.total === 4, r.status + ' total ' + (r.d && r.d.total));
        r = await api(ADMIN, '/api/admin/tech/tables/v2_task_people?limit=500', { token: F.token, headers: TECH });
        check(`outsider ${F.name}: tech table v2_task_people shows nobody on T (total 0)`, r.status === 200 && !r.text.includes(T) && !r.text.includes(S) && r.d.total === 0, r.status + ' total ' + (r.d && r.d.total));
        r = await api(ADMIN, '/api/admin/tech/export-all', { token: F.token, headers: TECH });
        check(`outsider ${F.name}: tech export-all carries no tag row of T`, r.status === 200 && Array.isArray(r.d.tables.v2_task_people) && r.d.tables.v2_task_people.length === 0 && !r.text.includes(SECRET), r.status);

        // B writes T as a tagged person (keeps C as the assignee), then is untagged and loses it.
        r = await api(ADMIN, `/api/tasks/${T}`, { method: 'PUT', token: B.token, body: { title: SECRET + 'T doctor appointment', description: SECRET + 'desc private', assigned_to: C.tm, priority: 'high', status: 'todo', due_date: yesterday, project: 'plexus' } });
        check('tagged Bob may edit T', r.status === 200, r.text);
        untag(T, B);
        for (const [label, base] of [['admin', ADMIN], ['member', USER]]) {
            r = await api(base, '/api/tasks/plexus', { token: B.token });
            check(`untagged Bob @${label}: board lost T (he keeps his own checklist task K)`, r.status === 200 && !r.text.includes(T) && !r.text.includes(S));
            r = await api(base, '/api/search?q=' + encodeURIComponent(SECRET), { token: B.token });
            const ids = (r.d && r.d.tasks || []).map(y => y.id);
            check(`untagged Bob @${label}: search finds neither T nor S (S's own tag row grants nothing)`, r.status === 200 && !ids.includes(T) && !ids.includes(S) && ids.includes(K), JSON.stringify(ids));
            const miss = await api(base, `/api/tasks/${missing}`, { method: 'PUT', token: B.token, body: { title: 'x' } });
            const hid = await api(base, `/api/tasks/${T}`, { method: 'PUT', token: B.token, body: { title: 'late edit' } });
            check(`untagged Bob @${label}: PUT T answers exactly like a missing task`, hid.status === 404 && hid.text === miss.text, hid.text);
            r = await api(base, '/api/tasks/plexus', { token: C.token });
            check(`C (first tagged, the assignee) @${label}: still sees T`, (r.d || []).some(y => y.id === T));
        }
        x = await dl(B, Fid);
        check('untagged Bob can no longer download F', x.status === 404, x.status);
        r = await api(ADMIN, '/api/dashboard/summary', { token: B.token });
        check('untagged Bob: dashboard back to his own count', r.d && r.d.tasks && r.d.tasks.total === bTotalBefore, `${bTotalBefore} vs ${r.d && r.d.tasks && r.d.tasks.total}`);
        r = await api(ADMIN, '/api/admin/nag/items', { token: B.token });
        check('untagged Bob: the Action Center lost T\'s item', r.status === 200 && !(r.d.items || []).some(it => it.subject_id === T));
        r = await api(ADMIN, '/api/tasks/plexus', { token: A.token });
        check('A (creator) still sees T', (r.d || []).some(y => y.id === T));

        // ================= a one-person hand-off on this portal =================
        // Reviewer's probe (25 Sept 2026): the redesign tags [Bob, Carol], then THIS portal moves
        // assigned_to. The tags must not keep granting the task: the v1 writers collapse the tag set
        // to the new person ([] on an unassign), and tag rows an older one-person writer left stale
        // (assigned_to not among them) grant nothing. Checked on the admin AND the member backend.
        const peopleOf = (id) => tagDb.prepare('SELECT member_id FROM v2_task_people WHERE task_id = ? ORDER BY rowid').all(id).map(y => y.member_id);
        const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
        const seesOn = async (base, P, id) => { const y = await api(base, '/api/tasks/plexus', { token: P.token }); return y.status === 200 && (y.d || []).some(t => t.id === id); };
        const lost = async (label, P, id) => {
            for (const [bl, base] of [['admin', ADMIN], ['member', USER]]) {
                const board = await api(base, '/api/tasks/plexus', { token: P.token });
                const found = await api(base, '/api/search?q=' + encodeURIComponent(SECRET), { token: P.token });
                const miss = await api(base, `/api/tasks/${missing}`, { method: 'PUT', token: P.token, body: { title: 'x' } });
                const hid = await api(base, `/api/tasks/${id}`, { method: 'PUT', token: P.token, body: { title: 'late edit' } });
                check(`${label}: ${P.name} @${bl} lost it (board, search, PUT = the missing-task 404)`,
                    board.status === 200 && !board.text.includes(id) && found.status === 200 && !(found.d && found.d.tasks || []).some(y => y.id === id)
                    && hid.status === 404 && hid.text === miss.text, `board ${board.text.includes(id)} put ${hid.status}`);
            }
            const cl = await api(ADMIN, '/api/admin/tasks', { token: P.token });
            check(`${label}: ${P.name} checklist has no trace of it`, cl.status === 200 && !cl.text.includes(id));
        };
        const keeps = async (label, P, id) => check(`${label}: ${P.name} sees it on both backends`, await seesOn(ADMIN, P, id) && await seesOn(USER, P, id));
        const fullBody = (title, who) => ({ project: 'plexus', title, description: SECRET + 'handoff desc', assigned_to: who, priority: 'high', status: 'todo', due_date: yesterday });

        // H1: admin PUT hand-off Bob -> Dave (Dave was never tagged)
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: fullBody(SECRET + 'H1 therapy', B.tm) });
        const H1 = r.d && r.d.id;
        check('H1: a v1 create writes its one person\'s tag row', r.status === 200 && same(peopleOf(H1), [B.tm]), JSON.stringify(peopleOf(H1)));
        tag(H1, C); // the redesign tags Carol second
        await keeps('H1 tagged [Bob, Carol]', C, H1);
        r = await api(ADMIN, `/api/tasks/${H1}`, { method: 'PUT', token: A.token, body: fullBody(SECRET + 'H1 therapy', D.tm) });
        check('H1: Laura hands it to Dave on the old portal (admin PUT)', r.status === 200, r.text);
        check('H1: tag rows collapse to exactly [Dave]', same(peopleOf(H1), [D.tm]), JSON.stringify(peopleOf(H1)));
        await lost('H1 after admin hand-off', B, H1);
        await lost('H1 after admin hand-off', C, H1);
        await keeps('H1 after admin hand-off', D, H1);
        await keeps('H1 after admin hand-off (creator)', A, H1);

        // H2: checklist PUT hand-off Bob -> Dave
        r = await api(ADMIN, '/api/admin/tasks', { method: 'POST', token: A.token, body: { project: 'plexus', title: SECRET + 'H2 checklist', assigned_to: B.tm } });
        const H2 = r.d && r.d.id;
        check('H2: a checklist create writes its one person\'s tag row', r.status === 200 && same(peopleOf(H2), [B.tm]), JSON.stringify(peopleOf(H2)));
        tag(H2, C);
        r = await api(ADMIN, `/api/admin/tasks/${H2}`, { method: 'PUT', token: A.token, body: { assigned_to: D.tm } });
        check('H2: checklist PUT hands it to Dave', r.status === 200 && same(peopleOf(H2), [D.tm]), r.text + ' ' + JSON.stringify(peopleOf(H2)));
        await lost('H2 after checklist hand-off', B, H2);
        await lost('H2 after checklist hand-off', C, H2);
        await keeps('H2 after checklist hand-off', D, H2);
        r = await api(ADMIN, `/api/admin/tasks/${H2}`, { method: 'PUT', token: D.token, body: { done: 1 } });
        check('H2: a checklist PUT that leaves the person alone keeps the tags', r.status === 200 && same(peopleOf(H2), [D.tm]), JSON.stringify(peopleOf(H2)));
        r = await api(ADMIN, `/api/admin/tasks/${H2}`, { method: 'PUT', token: A.token, body: { assigned_to: '' } });
        check('H2: checklist unassign drops every tag row', r.status === 200 && same(peopleOf(H2), []), JSON.stringify(peopleOf(H2)));
        await lost('H2 after checklist unassign', D, H2);

        // H3: admin PUT unassign ('') on a tagged task
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: fullBody(SECRET + 'H3 unassign', B.tm) });
        const H3 = r.d && r.d.id;
        tag(H3, C);
        r = await api(ADMIN, `/api/tasks/${H3}`, { method: 'PUT', token: A.token, body: fullBody(SECRET + 'H3 unassign', '') });
        check('H3: admin PUT unassign drops every tag row', r.status === 200 && same(peopleOf(H3), []), r.text + ' ' + JSON.stringify(peopleOf(H3)));
        await lost('H3 after admin unassign', B, H3);
        await lost('H3 after admin unassign', C, H3);
        await keeps('H3 after admin unassign (creator)', A, H3);

        // H4: member backend, Bob hands his own task to Dave
        r = await api(USER, '/api/tasks', { method: 'POST', token: A.token, body: fullBody(SECRET + 'H4 member', B.tm) });
        const H4 = r.d && r.d.id;
        check('H4: a member-backend create writes its one person\'s tag row', r.status === 200 && same(peopleOf(H4), [B.tm]), JSON.stringify(peopleOf(H4)));
        tag(H4, C);
        r = await api(USER, `/api/tasks/${H4}`, { method: 'PUT', token: B.token, body: fullBody(SECRET + 'H4 member', D.tm) });
        check('H4: Bob hands it to Dave on the member backend', r.status === 200 && same(peopleOf(H4), [D.tm]), r.text + ' ' + JSON.stringify(peopleOf(H4)));
        await lost('H4 after member hand-off', B, H4);
        await lost('H4 after member hand-off', C, H4);
        await keeps('H4 after member hand-off', D, H4);

        // H5: hand-off to someone ALREADY tagged: the set is still exactly the new person
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: fullBody(SECRET + 'H5 to tagged', B.tm) });
        const H5 = r.d && r.d.id;
        tag(H5, C);
        r = await api(ADMIN, `/api/tasks/${H5}`, { method: 'PUT', token: A.token, body: fullBody(SECRET + 'H5 to tagged', C.tm) });
        check('H5: handing to Carol (already tagged) leaves exactly [Carol]', r.status === 200 && same(peopleOf(H5), [C.tm]), JSON.stringify(peopleOf(H5)));
        await lost('H5 after hand-off to a tagged person', B, H5);
        await keeps('H5 after hand-off to a tagged person', C, H5);

        // H6: a PUT that leaves assigned_to alone never touches the tags
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: fullBody(SECRET + 'H6 keep', B.tm) });
        const H6 = r.d && r.d.id;
        tag(H6, C);
        r = await api(USER, `/api/tasks/${H6}`, { method: 'PUT', token: C.token, body: fullBody(SECRET + 'H6 keep, edited by Carol', B.tm) });
        check('H6: a tagged person edits it, same assignee: the tags stay [Bob, Carol]', r.status === 200 && same(peopleOf(H6), [B.tm, C.tm]), JSON.stringify(peopleOf(H6)));
        await keeps('H6 after an edit', B, H6);
        await keeps('H6 after an edit', C, H6);

        // H7: tag rows left stale by an older one-person writer (assigned_to moved, tags untouched,
        // written straight into the DB the way an earlier deploy did): they grant nothing.
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: fullBody(SECRET + 'H7 stale', B.tm) });
        const H7 = r.d && r.d.id;
        tag(H7, C);
        tagDb.prepare('UPDATE project_tasks SET assigned_to = ? WHERE id = ?').run(D.tm, H7);
        check('H7: stale tag rows [Bob, Carol] with assigned_to Dave', same(peopleOf(H7), [B.tm, C.tm]), JSON.stringify(peopleOf(H7)));
        await lost('H7 stale tags', B, H7);
        await lost('H7 stale tags', C, H7);
        await keeps('H7 stale tags', D, H7);
        r = await api(ADMIN, '/api/dashboard/summary', { token: C.token });
        const cTasks = await api(ADMIN, '/api/tasks', { token: C.token });
        check('H7: Carol\'s counts carry none of H1-H5/H7 (only H6 and her own)', r.status === 200 && ![H1, H2, H3, H4, H7].some(id => cTasks.text.includes(id)), JSON.stringify(r.d && r.d.tasks));

        // ---- tech tools: the redesign's comments + activity lines, purge backups, table counts ----
        tagDb.exec(`CREATE TABLE IF NOT EXISTS v2_task_comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, author_id TEXT,
            author_name TEXT, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'comment', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        tagDb.prepare("INSERT INTO v2_task_comments (id, task_id, author_id, author_name, body, kind) VALUES (?, ?, ?, 'Laura Test', 'Laura tagged Bob and Carol', 'system')").run(randomUUID(), H6, aId);
        tagDb.prepare("INSERT INTO v2_task_comments (id, task_id, author_id, author_name, body, kind) VALUES (?, ?, ?, 'Laura Test', ?, 'comment')").run(randomUUID(), H6, aId, SECRET + 'comment about the diagnosis');
        tagDb.exec('CREATE TABLE IF NOT EXISTS _purged_project_tasks AS SELECT * FROM project_tasks WHERE 0');
        tagDb.prepare("INSERT INTO _purged_project_tasks (id, project, title, status) VALUES (?, 'plexus', ?, 'todo')").run(randomUUID(), SECRET + 'purged backup row');
        r = await api(ADMIN, '/api/admin/tech/tables/v2_task_comments?limit=500', { token: F.token, headers: TECH });
        check(`outsider ${F.name}: tech table v2_task_comments hands out nothing (total 0)`, r.status === 200 && r.d.total === 0 && !r.text.includes(SECRET) && !r.text.includes('tagged Bob'), r.status + ' total ' + (r.d && r.d.total));
        r = await api(ADMIN, '/api/admin/tech/tables/_purged_v2_task_comments?limit=500', { token: F.token, headers: TECH });
        check('a table name that does not exist is still refused', r.status === 400, r.status);
        r = await api(ADMIN, '/api/admin/tech/tables/_purged_project_tasks?limit=500', { token: F.token, headers: TECH });
        check(`outsider ${F.name}: tech table _purged_project_tasks hands out nothing (total 0)`, r.status === 200 && r.d.total === 0 && !r.text.includes(SECRET), r.status + ' total ' + (r.d && r.d.total));
        r = await api(ADMIN, '/api/admin/tech/tables/v2_task_comments?limit=500', { token: C.token, headers: TECH });
        check('tagged Carol: tech table v2_task_comments shows H6\'s two rows', r.status === 200 && r.d.total === 2 && r.text.includes('tagged Bob'), r.status + ' total ' + (r.d && r.d.total));
        r = await api(ADMIN, '/api/admin/tech/export-all', { token: F.token, headers: TECH });
        check(`outsider ${F.name}: tech export-all carries no comment, activity line or purged task`, r.status === 200 && Array.isArray(r.d.tables.v2_task_comments) && r.d.tables.v2_task_comments.length === 0
            && (r.d.tables._purged_project_tasks || []).length === 0 && !r.text.includes(SECRET) && !r.text.includes('tagged Bob'), r.status);
        r = await api(ADMIN, '/api/admin/tech/tables', { token: F.token, headers: TECH });
        const countOf = (y, name) => ((y.d && y.d.tables || []).find(t => t.name === name) || {}).rowCount;
        check(`outsider ${F.name}: the tech table list counts none of the task rows he is not on`,
            r.status === 200 && countOf(r, 'v2_task_people') === 0 && countOf(r, 'v2_task_comments') === 0 && countOf(r, '_purged_project_tasks') === 0,
            JSON.stringify({ people: countOf(r, 'v2_task_people'), comments: countOf(r, 'v2_task_comments'), purged: countOf(r, '_purged_project_tasks') }));
        const cList = await api(ADMIN, '/api/admin/tech/tables', { token: C.token, headers: TECH });
        check('tagged Carol: the tech table list counts her own task rows', countOf(cList, 'v2_task_comments') === 2 && countOf(cList, 'v2_task_people') > 0, JSON.stringify({ people: countOf(cList, 'v2_task_people'), comments: countOf(cList, 'v2_task_comments') }));
        for (const id of [H1, H2, H3, H4, H5, H6, H7]) await api(ADMIN, `/api/tasks/${id}`, { method: 'DELETE', token: A.token });
        check('H1-H7 deleted by their creator, with their tag rows', tagRows([H1, H2, H3, H4, H5, H6, H7]) === 0, tagRows([H1, H2, H3, H4, H5, H6, H7]));

        // Tag rows on K (checklist route) and on a task T3 made on the member backend, for the
        // delete checks below: every delete route of this portal drops the task's tag rows.
        tag(K, C);
        r = await api(USER, '/api/tasks', { method: 'POST', token: A.token, body: { project: 'plexus', title: SECRET + 'T3 member-side', assigned_to: B.tm } });
        const T3 = r.d && r.d.id;
        check('A creates T3 on the member backend', r.status === 200 && T3, r.text);
        tag(T3, B); tag(T3, C);
        r = await api(USER, '/api/tasks/plexus', { token: C.token });
        check('C (tagged second on T3) sees T3 on the member backend', (r.d || []).some(y => y.id === T3));

        // ---- cleanup through the API (removes the uploaded file from disk) ----
        r = await api(ADMIN, `/api/tasks/files/${Fid}`, { method: 'DELETE', token: A.token });
        check('creator can delete file F', r.status === 200, r.text);
        check('before the delete, T and S carry tag rows', tagRows([T, S]) === 2, tagRows([T, S]));
        r = await api(ADMIN, `/api/tasks/${T}`, { method: 'DELETE', token: C.token });
        check('new assignee C can delete T', r.status === 200, r.text);
        check('deleting T dropped its tag rows and its subtask S\'s', tagRows([T, S]) === 0, tagRows([T, S]));
        r = await api(ADMIN, `/api/admin/tasks/${K}`, { method: 'DELETE', token: A.token });
        check('checklist delete of K dropped its tag row', r.status === 200 && tagRows([K]) === 0, r.text + ' rows ' + tagRows([K]));
        r = await api(USER, `/api/tasks/${T3}`, { method: 'DELETE', token: C.token });
        check('member-backend delete of T3 (by C, tagged second) dropped its tag rows', r.status === 200 && tagRows([T3]) === 0, r.text + ' rows ' + tagRows([T3]));
        tagDb.close();
    } catch (e) {
        check('unexpected error: ' + e.message, false);
    } finally {
        cleanup();
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
