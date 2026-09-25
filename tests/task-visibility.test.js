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
// ports: 3111/3112 unless TASKVIS_USER_PORT / TASKVIS_ADMIN_PORT say otherwise (parallel runs)
const USER_PORT = Number(process.env.TASKVIS_USER_PORT) || 3111;
const ADMIN_PORT = Number(process.env.TASKVIS_ADMIN_PORT) || 3112;
const USER = 'http://localhost:' + USER_PORT;
const ADMIN = 'http://localhost:' + ADMIN_PORT;

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
        const idOnly = `task_overdue item ${someId} -> assignee nudged`;
        check('unit: the id-only nudge line both portals write reads as stored (the redesign shows it the same)', taskVis.redactAuditRow({ action: 'nag.act', detail: idOnly }).detail === idOnly);

        // ---- source shape: what a stale replica read can never undo ----
        // Each backend reads from its own embedded replica, up to a minute behind the other backend's writes.
        // The checklist PUT must never write back a title, person or date it read (a done tick after a
        // redesign re-tag would hand the task back to the old first person, and the trigger would drop the
        // rest), and MAIN's Action Center audit rows use the redesign's '<kind> item <id>' form.
        const adminSrc = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');
        const clPut = (adminSrc.match(/app\.put\('\/api\/admin\/tasks\/:id'[\s\S]*?\n    \}\);/) || [''])[0];
        check('source: the checklist PUT writes title, assigned_to and due_date only when the body carries them',
            ['title', 'assigned_to', 'due_date'].every(c => clPut.includes(`${c} = CASE WHEN ? THEN ? ELSE ${c} END`)), clPut.slice(0, 160));
        check('source: the checklist PUT copies no title, person or date from the row it read',
            clPut.length > 0 && !/existing\.(title|assigned_to|due_date)\b/.test(clPut.replace(/^.*handOffTaskPeople.*$/gm, '')));
        check('source: the checklist PUT touches the tags only when the body carries assigned_to',
            /if \(b\.assigned_to !== undefined\) \{[\s\S]*?handOffTaskPeople\(/.test(clPut) && (clPut.match(/handOffTaskPeople\(/g) || []).length === 1);
        const nagSrc = (adminSrc.match(/app\.post\('\/api\/admin\/nag\/items\/:id\/act'[\s\S]*?app\.post\('\/api\/admin\/nag\/digest'/) || [''])[0];
        check('source: every Action Center action on a task item is logged in the redesign\'s form',
            nagSrc.length > 0 && !nagSrc.includes('-> nudge sent') && !/logAudit\(req, 'nag\.[a-z]+', (req\.params\.id|`\$\{req\.params\.id\})/.test(nagSrc)
            && ['nag.act', 'nag.done', 'nag.dismiss', 'nag.unclaim', 'nag.claim'].every(a => new RegExp(`logAudit\\(req, '${a.replace('.', '\\.')}', [^\\n]*nagAuditDetail\\(item`).test(nagSrc)));
        check('unit: /uploads/tasks is blocked in any spelling', ['/tasks/a.txt', '/TASKS/a', '/%74asks/a', '/documents/../tasks/a', '/tasks'].every(taskVis.isTaskUploadPath) && !taskVis.isTaskUploadPath('/documents/a.txt') && !taskVis.isTaskUploadPath('/taskslist/a'));

        // ---- unit, on an in-memory database: the rule, the tag writer, the boot sweep, the audit scope ----
        const LibsqlDb = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const memDb = ({ withPeople = true } = {}) => {
            const d = new LibsqlDb(':memory:');
            d.exec(`CREATE TABLE project_tasks (id TEXT PRIMARY KEY, parent_id TEXT, assigned_to TEXT, created_by TEXT);
                    CREATE TABLE team_members (id TEXT PRIMARY KEY, user_id TEXT);
                    CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT)`);
            const run = (sql, p) => d.prepare(sql).run(...(p || []));
            if (withPeople) taskVis.ensureTaskPeopleTable(run);
            return {
                d, run,
                tags: (id) => d.prepare('SELECT member_id FROM v2_task_people WHERE task_id = ? ORDER BY rowid').all(id).map(y => y.member_id),
                first: (id) => (d.prepare('SELECT assigned_to FROM project_tasks WHERE id = ?').get(id) || {}).assigned_to,
                hasTrigger: () => d.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_task_people_one_person_write'").get().c,
            };
        };
        const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

        // A grandchild (its parent is itself a subtask) and a row whose parent is gone: visible to nobody,
        // not even their creator (the redesign's rule on the same rows).
        {
            const m = memDb();
            m.d.exec(`INSERT INTO team_members VALUES ('tm-1', 'u-1');
                      INSERT INTO project_tasks VALUES ('top', NULL, NULL, 'u-1'), ('sub', 'top', NULL, 'u-1'),
                        ('grand', 'sub', 'tm-1', 'u-1'), ('orphan', 'gone', 'tm-1', 'u-1'), ('blank', '', NULL, 'u-1')`);
            const v = taskVis.visibleTaskSql('pt', 'u-1');
            const seen = m.d.prepare(`SELECT pt.id FROM project_tasks pt WHERE ${v.sql} ORDER BY pt.id`).all(...v.params).map(y => y.id);
            check('unit: the creator sees the task, its subtask and a blank-parent task, never a grandchild or an orphan', eq(seen, ['blank', 'sub', 'top']), JSON.stringify(seen));
            check('unit: findVisibleTask answers null for the grandchild', taskVis.findVisibleTask((s, p) => m.d.prepare(s).get(...p), 'u-1', 'grand') === null
                && !!taskVis.findVisibleTask((s, p) => m.d.prepare(s).get(...p), 'u-1', 'sub'));
            m.d.close();
        }

        // setTaskPeople racing a one-person write by the other portal (this portal's PUT: the UPDATE of
        // assigned_to, then handOffTaskPeople; or the bare UPDATE of an older deploy), landing before
        // any one of its statements. Whatever the interleaving, no tag set is left dormant (assigned_to
        // always among the tags, no tags on a task with no one) and no one outside the two writers' people
        // is on it. Reviewer's repro: [B, C] from {A, B, C} racing an unassign after the UPDATE.
        {
            const scenarios = [['B', 'C'], ['A', 'B', 'C', 'D'], ['E'], ['B', 'A'], []];
            const olds = [null, '', 'D', 'A', 'B'];
            let runs = 0;
            const bad = [];
            for (const want of scenarios) for (const old of olds) for (const bare of [false, true]) for (let gap = 0; gap < 8; gap++) {
                const m = memDb();
                m.run("INSERT INTO project_tasks (id, assigned_to, created_by) VALUES ('t', NULL, 'u-x')");
                taskVis.setTaskPeople(m.run, 't', ['A', 'B', 'C'], 'u-x');
                let n = 0;
                const inject = () => {
                    const before = m.first('t');
                    m.run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', [old, 't']);
                    if (!bare) taskVis.handOffTaskPeople(m.run, 't', before, old, 'u-old');
                };
                const racy = (sql, p) => { if (n++ === gap) inject(); return m.run(sql, p); };
                taskVis.setTaskPeople(racy, 't', want, 'u-x');
                if (n <= gap) { m.d.close(); continue; } // this scenario has fewer statements than the gap
                runs++;
                const f = m.first('t') == null ? '' : m.first('t');
                const t = m.tags('t');
                const stale = f ? !t.includes(f) : t.length > 0;
                const outside = t.filter(y => !want.includes(y) && y !== old);
                if (stale || outside.length) bad.push({ want, old, bare, gap, first: f, tags: t });
                m.d.close();
            }
            check(`unit: setTaskPeople racing a one-person write leaves no dormant or foreign tag in any of ${runs} interleavings`, runs > 100 && bad.length === 0, JSON.stringify(bad.slice(0, 3)));

            // the reviewer's end-to-end revival, step by step
            for (const unassignTo of [null, '']) {
                const m = memDb();
                m.run("INSERT INTO project_tasks (id, assigned_to, created_by) VALUES ('t', NULL, 'u-x')");
                taskVis.setTaskPeople(m.run, 't', ['A', 'B', 'C'], 'u-x');
                let armed = true;
                const racy = (sql, p) => {
                    const out = m.run(sql, p);
                    if (armed && /^UPDATE project_tasks SET assigned_to = \? WHERE id = \?/.test(sql)) { // right after the redesign's UPDATE
                        armed = false;
                        m.run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', [unassignTo, 't']);
                        taskVis.handOffTaskPeople(m.run, 't', 'B', unassignTo, 'u-old');
                    }
                    return out;
                };
                taskVis.setTaskPeople(racy, 't', ['B', 'C'], 'u-x');
                check(`unit: [B, C] racing an unassign to ${JSON.stringify(unassignTo)} right after the UPDATE leaves no tag rows`, eq(m.tags('t'), []) && !m.first('t'), JSON.stringify(m.tags('t')));
                m.run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', ['B', 't']); // then the old portal gives it to B alone
                taskVis.handOffTaskPeople(m.run, 't', unassignTo, 'B', 'u-old');
                check(`unit: ...and a later hand-off to B alone does not revive C (unassign ${JSON.stringify(unassignTo)})`, eq(m.tags('t'), ['B']), JSON.stringify(m.tags('t')));
                m.d.close();
            }

            // without a race: the previous first person who stays on in a later place is written again
            const m = memDb();
            m.run("INSERT INTO project_tasks (id, assigned_to, created_by) VALUES ('t', NULL, 'u-x')");
            taskVis.setTaskPeople(m.run, 't', ['A', 'B', 'C'], 'u-x');
            check('unit: setTaskPeople [A, B, C] tags three, A first', eq(m.tags('t'), ['A', 'B', 'C']) && m.first('t') === 'A');
            taskVis.setTaskPeople(m.run, 't', ['B', 'A'], 'u-x');
            check('unit: setTaskPeople [B, A] keeps A (written again after the UPDATE), drops C, B first', eq([...m.tags('t')].sort(), ['A', 'B']) && m.first('t') === 'B', JSON.stringify(m.tags('t')));
            check('unit: this portal\'s hand-off to D leaves exactly [D]', taskVis.handOffTaskPeople(m.run, 't', 'B', 'D', 'u-x') && eq(m.tags('t'), ['D']) && m.first('t') === 'D');
            check('unit: a hand-off that moves no one touches nothing', taskVis.handOffTaskPeople(m.run, 't', 'D', 'D', 'u-x') === false && eq(m.tags('t'), ['D']));
            m.d.close();
        }

        // ensureTaskPeopleTable: the stale-row sweep runs first and on its own, so a trigger DDL that fails
        // never skips it; a failing sweep never skips the trigger. Both failures still reach the caller.
        {
            const seedStale = (m) => m.d.exec(`CREATE TABLE IF NOT EXISTS v2_task_people (task_id TEXT NOT NULL, member_id TEXT NOT NULL, added_by TEXT, added_at TEXT, PRIMARY KEY (task_id, member_id));
                INSERT INTO project_tasks (id, assigned_to) VALUES ('stale', 'D'), ('noone', NULL), ('blank', ''), ('live', 'A');
                INSERT INTO v2_task_people (task_id, member_id) VALUES ('stale', 'B'), ('stale', 'E'), ('noone', 'B'), ('blank', 'C'), ('gone', 'B'), ('live', 'A'), ('live', 'B')`);
            const left = (m) => m.d.prepare('SELECT task_id || \':\' || member_id AS k FROM v2_task_people ORDER BY rowid').all().map(y => y.k);
            let m = memDb({ withPeople: false });
            seedStale(m);
            let thrown = null;
            try { taskVis.ensureTaskPeopleTable((sql, p) => { if (/CREATE TRIGGER/.test(sql)) throw new Error('simulated trigger DDL failure'); return m.run(sql, p); }); } catch (e) { thrown = e.message; }
            check('unit: a failing trigger DDL is still thrown to the boot (which logs it)', thrown === 'simulated trigger DDL failure', thrown);
            check('unit: ...and the stale-row sweep ran anyway (stale, no-one, blank, orphan rows gone, the live set kept)', eq(left(m), ['live:A', 'live:B']) && m.hasTrigger() === 0, JSON.stringify(left(m)));
            m.run('UPDATE project_tasks SET assigned_to = ? WHERE id = ?', ['B', 'stale']); // a move back, with no trigger yet
            check('unit: ...so a later move back to B revives no one', eq(m.tags('stale'), []), JSON.stringify(m.tags('stale')));
            taskVis.ensureTaskPeopleTable(m.run);
            taskVis.ensureTaskPeopleTable(m.run);
            check('unit: the next boots create the trigger once and keep the live set', m.hasTrigger() === 1 && eq(m.tags('live'), ['A', 'B']));
            m.d.close();

            m = memDb({ withPeople: false });
            seedStale(m);
            thrown = null;
            try { taskVis.ensureTaskPeopleTable((sql, p) => { if (/^\s*DELETE FROM v2_task_people/.test(sql)) throw new Error('simulated sweep failure'); return m.run(sql, p); }); } catch (e) { thrown = e.message; }
            check('unit: a failing sweep is thrown too, after the trigger was created', thrown === 'simulated sweep failure' && m.hasTrigger() === 1, thrown);
            m.d.close();
        }

        // The audit scope: a row about a task goes only to the admin who did it.
        {
            const m = memDb();
            const rows = [
                ['t1', 'u-b', 'task.comment', 'task X'], ['t2', 'u-b', 'task.update', 'task X: title, due_date'], ['t3', 'u-b', 'task.result', 'task X'],
                ['t4', 'u-b', 'task.archive', 'task X'], ['t5', 'u-b', 'task.file.upload', 'task X: file f (3 bytes)'], ['t6', 'u-b', 'task.file.remove', 'task X: file f'],
                ['t7', 'u-b', 'task.delete', 'task X'], ['t8', 'u-b', 'task.create', 'task X'], ['n1', 'u-b', 'nag.act', 'task_overdue item 9 -> nudged'],
                ['n2', 'u-b', 'nag.done', 'item 9 (+task completed)'], ['n3', 'u-b', 'nag.snooze', 'task_due_soon item 9'],
                ['k1', 'u-b', 'nag.act', 'sponsor_deliverable item 7'], ['k2', 'u-b', 'gala.mark_paid', 'reg 5'], ['k3', 'u-b', 'nag.done', 'taskless item 8'], ['s1', null, 'task.create', 'task Y'],
            ];
            for (const r of rows) m.run('INSERT INTO audit_log (id, actor_id, action, detail) VALUES (?,?,?,?)', r);
            const seen = (uid) => { const v = taskVis.taskAuditScope('al', uid); return m.d.prepare(`SELECT id FROM audit_log al WHERE ${v.sql} ORDER BY id`).all(...v.params).map(y => y.id); };
            check('unit: the actor sees every row of theirs, task rows included', eq(seen('u-b'), ['k1', 'k2', 'k3', 'n1', 'n2', 'n3', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']), JSON.stringify(seen('u-b')));
            check('unit: another admin sees none of the task rows, only the others', eq(seen('u-c'), ['k1', 'k2', 'k3']), JSON.stringify(seen('u-c')));
            check('unit: with no caller, no task row at all', eq(seen(null), ['k1', 'k2', 'k3']) && eq(seen(''), ['k1', 'k2', 'k3']));
            const tv = taskVis.techRowScope('audit_log', 'al', { id: 'u-c', email: 'c@example.com' });
            check('unit: the tech tools scope audit_log the same way', eq(m.d.prepare(`SELECT id FROM audit_log al WHERE ${tv.sql} ORDER BY id`).all(...tv.params).map(y => y.id), ['k1', 'k2', 'k3']));
            m.d.close();
        }

        boot('user-portal/backend', USER_PORT);
        await waitUp(USER);
        boot('admin-portal/backend', ADMIN_PORT);
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

        // The Action Center's audit rows on a task item use the redesign's '<kind> item <id>' form, so the
        // audit scope both portals share shows them only to the admin who acted: no one else learns that
        // someone nudged, claimed or released a task item, or when.
        if (nag) {
            r = await api(ADMIN, `/api/admin/nag/items/${nag.id}/claim`, { method: 'POST', token: B.token });
            const bClaimed = r.status === 200 && r.d && r.d.claimed === true;
            r = await api(ADMIN, `/api/admin/nag/items/${nag.id}/claim`, { method: 'POST', token: B.token });
            check('B (assignee) claims and releases T\'s Action Center item', bClaimed && r.status === 200 && r.d && r.d.claimed === false, r.text);
            const aFeed = await auditOf(A);
            check('A (the actor) reads her nudge row as "<kind> item <id> -> assignee nudged"', aFeed.rows.some(a => a.action === 'nag.act' && a.detail === `task_overdue item ${nag.id} -> assignee nudged`), JSON.stringify(aFeed.rows.filter(a => /^nag\./.test(a.action || '')).map(a => a.action + ': ' + a.detail)));
            const bFeed = await auditOf(B);
            check('B (the actor) reads his claim and release rows in the same form', bFeed.rows.some(a => a.action === 'nag.claim' && a.detail === `task_overdue item ${nag.id} -> Bob Test`) && bFeed.rows.some(a => a.action === 'nag.unclaim' && a.detail === `task_overdue item ${nag.id}`),
                JSON.stringify(bFeed.rows.filter(a => /^nag\./.test(a.action || '')).map(a => a.action + ': ' + a.detail)));
            check('B does not see A\'s nudge row on the same item', !bFeed.rows.some(a => a.action === 'nag.act' && String(a.detail || '').includes(nag.id)));
            for (const P of [C, F]) {
                const au = await auditOf(P);
                check(`${P.name}: the audit feed has no row about T's Action Center item (nudge, claim, release)`, au.status === 200 && !au.rows.some(a => String(a.detail || '').includes(nag.id)),
                    JSON.stringify(au.rows.filter(a => String(a.detail || '').includes(nag.id)).map(a => a.action + ': ' + a.detail)));
            }
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

        // The redesign's task audit rows (same database): task.comment / update / result / archive / file.* /
        // delete and the Action Center's actions on a task item go only to the admin who did them, in the
        // feed, the tech tools (rows, search totals, the table list count) and the registrant timeline.
        const AUD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';  // in every task row's detail
        const OTH = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';  // in the non-task rows next to them
        const REG_EMAIL = 'qa.robot+taskvis-reg@example.com';
        const v2TaskRows = [['task.comment', 'task ' + AUD], ['task.update', `task ${AUD}: title, due_date`], ['task.result', 'task ' + AUD],
            ['task.archive', 'task ' + AUD], ['task.unarchive', 'task ' + AUD], ['task.file.upload', `task ${AUD}: file f1 (3 bytes)`],
            ['task.file.remove', `task ${AUD}: file f1`], ['task.delete', 'task ' + AUD], ['nag.done', `item n-${AUD} (+task completed)`],
            ['nag.snooze', `task_due_soon item n-${AUD}`], ['task.comment', `task ${AUD} for ${REG_EMAIL}`]];
        const nonTaskRows = [['nag.act', `sponsor_deliverable item ${OTH}`], ['gala.mark_paid', `${REG_EMAIL} ${OTH}`]];
        const audDb = new Database(env.DATABASE_PATH);
        const insAudit = audDb.prepare('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?, ?, ?, ?, ?)');
        for (const [action, detail] of [...v2TaskRows, ...nonTaskRows]) insAudit.run(randomUUID(), bId, emailOf.b, action, detail);
        insAudit.run(randomUUID(), aId, emailOf.a, 'task.create', SECRET + 'legacy title naming ' + REG_EMAIL);
        const regId = randomUUID();
        audDb.prepare("INSERT INTO gala_registrations (id, first_name, last_name, email) VALUES (?, 'Reg', 'Test', ?)").run(regId, REG_EMAIL);
        const rawAuditCount = audDb.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
        audDb.close();
        const withText = (rows, s) => rows.filter(a => String(a.detail || '').includes(s)).length;
        let au = await auditOf(B);
        check('B (the actor) sees every task audit row he wrote, and his other rows', withText(au.rows, AUD) === v2TaskRows.length && withText(au.rows, OTH) === 2, `task ${withText(au.rows, AUD)} other ${withText(au.rows, OTH)}`);
        for (const P of [A, C, F]) {
            au = await auditOf(P);
            check(`${P.name}: the audit feed carries none of B's task rows (comment, update, result, archive, file, delete, task-item actions), only his other rows`,
                au.status === 200 && withText(au.rows, AUD) === 0 && withText(au.rows, OTH) === 2, `task ${withText(au.rows, AUD)} other ${withText(au.rows, OTH)}`);
            const myEmail = P === F ? emailOf.f : P === A ? emailOf.a : emailOf.c;
            check(`${P.name}: the audit feed carries no one else's task.* row`, !au.rows.some(a => /^task\./.test(a.action || '') && a.actor_email !== myEmail),
                JSON.stringify(au.rows.filter(a => /^task\./.test(a.action || '') && a.actor_email !== myEmail).map(a => a.action + ' by ' + a.actor_email)));
        }
        au = await auditOf(A);
        check('A still sees her own task.create rows (older titles hidden)', au.rows.some(a => a.action === 'task.create' && a.actor_email === emailOf.a) && !au.text.includes(SECRET));
        const techList = async (P) => { const y = await api(ADMIN, '/api/admin/tech/tables', { token: P.token, headers: TECH }); return ((y.d && y.d.tables || []).find(t => t.name === 'audit_log') || {}).rowCount; };
        for (const [P, want] of [[B, v2TaskRows.length], [C, 0], [F, 0]]) {
            r = await api(ADMIN, '/api/admin/tech/tables/audit_log?limit=500&search=' + AUD, { token: P.token, headers: TECH });
            check(`${P.name}: tech audit_log search for the task rows totals ${want}`, r.status === 200 && r.d.total === want, r.status + ' total ' + (r.d && r.d.total));
            r = await api(ADMIN, '/api/admin/tech/tables/audit_log?limit=500&search=' + OTH, { token: P.token, headers: TECH });
            check(`${P.name}: tech audit_log search for the other rows totals 2`, r.status === 200 && r.d.total === 2, r.status + ' total ' + (r.d && r.d.total));
        }
        for (const P of [C, F]) {
            r = await api(ADMIN, '/api/admin/tech/tables/audit_log?limit=1', { token: P.token, headers: TECH });
            const listed = await techList(P);
            check(`${P.name}: the tech table list counts audit_log like its rows route, without the hidden task rows`,
                r.status === 200 && listed === r.d.total && listed <= rawAuditCount - v2TaskRows.length - 1, `list ${listed} rows ${r.d && r.d.total} raw ${rawAuditCount}`);
        }
        for (const P of [A, B, C]) {
            r = await api(ADMIN, `/api/admin/registrant/gala/${regId}/activity`, { token: P.token });
            const titles = (r.d && r.d.events || []).map(e => e.title);
            check(`${P.name}: the registrant timeline shows no task row naming the registrant (even the actor's), and keeps the rest`,
                r.status === 200 && !titles.some(t => /^task\./.test(t || '')) && titles.includes('gala.mark_paid') && !r.text.includes(AUD) && !r.text.includes(SECRET), r.status + ' ' + JSON.stringify(titles));
        }

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

        // ---- a grandchild (its parent S is itself a subtask) is visible to nobody, its creator included ----
        // This portal never writes one (a subtask of a subtask is re-parented to the top), so it is written
        // straight into the scratch DB, created by and assigned to Laura (A), under her subtask S.
        const G = randomUUID();
        {
            const gDb = new Database(env.DATABASE_PATH);
            gDb.prepare("INSERT INTO project_tasks (id, project, title, parent_id, created_by, assigned_to, status, priority) VALUES (?, 'plexus', ?, ?, ?, ?, 'todo', 'medium')")
                .run(G, SECRET + 'G grandchild', S, aId, A.tm);
            gDb.close();
        }
        for (const P of [A, C, F]) {
            for (const [label, base] of [['admin', ADMIN], ['member', USER]]) {
                r = await api(base, '/api/search?q=' + encodeURIComponent(SECRET + 'G grandchild'), { token: P.token });
                check(`${P.name} @${label}: search never finds the grandchild`, r.status === 200 && r.d && r.d.tasks.length === 0 && !r.text.includes(G), r.text.slice(0, 160));
                r = await api(base, '/api/tasks', { token: P.token });
                check(`${P.name} @${label}: /api/tasks summary has no trace of the grandchild`, r.status === 200 && !r.text.includes(G));
                const miss = await api(base, `/api/tasks/${missing}`, { method: 'PUT', token: P.token, body: { title: 'x' } });
                for (const [what, y] of [['PUT', await api(base, `/api/tasks/${G}`, { method: 'PUT', token: P.token, body: { title: 'x' } })],
                    ['toggle', await api(base, `/api/tasks/${G}/toggle`, { method: 'POST', token: P.token })],
                    ['DELETE', await api(base, `/api/tasks/${G}`, { method: 'DELETE', token: P.token })]]) {
                    check(`${P.name} @${label}: ${what} on the grandchild answers exactly like a missing task`, y.status === 404 && y.text === miss.text, y.status + ' ' + y.text);
                }
            }
        }
        r = await api(ADMIN, '/api/admin/tech/tables/project_tasks?limit=500', { token: A.token, headers: TECH });
        check('A: the tech table project_tasks shows T and S but not the grandchild', r.status === 200 && r.text.includes(T) && r.text.includes(S) && !r.text.includes(G), r.status);
        {
            const gDb = new Database(env.DATABASE_PATH);
            const g = gDb.prepare('SELECT title, status FROM project_tasks WHERE id = ?').get(G);
            check('the grandchild is untouched after the denied writes', g && g.title === SECRET + 'G grandchild' && g.status === 'todo', JSON.stringify(g));
            gDb.prepare('DELETE FROM project_tasks WHERE id = ?').run(G);
            gDb.close();
        }

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
        check('boot created the one-person trigger (the same one the redesign creates), once',
            tagDb.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_task_people_one_person_write'").get().c === 1);
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
        check('H7: with the trigger, a bare one-person UPDATE to Dave (an older deploy\'s write) leaves exactly [Dave]', same(peopleOf(H7), [D.tm]), JSON.stringify(peopleOf(H7)));
        // the rows that deploy left before any trigger existed (INSERTs never fire it)
        untag(H7, D); tag(H7, B); tag(H7, C);
        check('H7: stale tag rows [Bob, Carol] with assigned_to Dave', same(peopleOf(H7), [B.tm, C.tm]), JSON.stringify(peopleOf(H7)));
        await lost('H7 stale tags', B, H7);
        await lost('H7 stale tags', C, H7);
        await keeps('H7 stale tags', D, H7);
        r = await api(ADMIN, `/api/tasks/${H7}`, { method: 'PUT', token: D.token, body: fullBody(SECRET + 'H7 stale', B.tm) });
        check('H7: Dave hands it back to Bob on this portal: exactly [Bob], Carol\'s stale row does not revive', r.status === 200 && same(peopleOf(H7), [B.tm]), r.text + ' ' + JSON.stringify(peopleOf(H7)));
        await lost('H7 after the hand-back', C, H7);
        await keeps('H7 after the hand-back', B, H7);
        r = await api(ADMIN, `/api/tasks/${H7}`, { method: 'PUT', token: B.token, body: fullBody(SECRET + 'H7 stale', D.tm) });
        check('H7: and to Dave again: exactly [Dave]', r.status === 200 && same(peopleOf(H7), [D.tm]), JSON.stringify(peopleOf(H7)));

        // H8: a v1 PUT that leaves assigned_to / due_date out changes neither (and never the tags), on
        // both backends. Before, a body without them unassigned the task and cleared its date, which
        // then took it from everyone tagged.
        r = await api(ADMIN, '/api/tasks', { method: 'POST', token: A.token, body: fullBody(SECRET + 'H8 partial', B.tm) });
        const H8 = r.d && r.d.id;
        tag(H8, C);
        const rowOf = (id) => tagDb.prepare('SELECT title, assigned_to, due_date, status FROM project_tasks WHERE id = ?').get(id) || {};
        r = await api(ADMIN, `/api/tasks/${H8}`, { method: 'PUT', token: A.token, body: { title: SECRET + 'H8 renamed' } });
        let h8 = rowOf(H8);
        check('H8: admin PUT { title } keeps assigned_to, due_date and the tags [Bob, Carol]', r.status === 200 && h8.title === SECRET + 'H8 renamed' && h8.assigned_to === B.tm && h8.due_date === yesterday && same(peopleOf(H8), [B.tm, C.tm]), JSON.stringify(h8) + ' ' + JSON.stringify(peopleOf(H8)));
        r = await api(USER, `/api/tasks/${H8}`, { method: 'PUT', token: C.token, body: { status: 'in_progress' } });
        h8 = rowOf(H8);
        check('H8: member PUT { status } by tagged Carol keeps assigned_to, due_date and the tags', r.status === 200 && h8.status === 'in_progress' && h8.assigned_to === B.tm && h8.due_date === yesterday && same(peopleOf(H8), [B.tm, C.tm]), JSON.stringify(h8) + ' ' + JSON.stringify(peopleOf(H8)));
        r = await api(ADMIN, `/api/admin/tasks/${H8}`, { method: 'PUT', token: C.token, body: { done: 1 } });
        h8 = rowOf(H8);
        check('H8: a checklist done tick by tagged Carol keeps title, assigned_to, due_date and the tags', r.status === 200 && h8.status === 'done' && h8.title === SECRET + 'H8 renamed' && h8.assigned_to === B.tm && h8.due_date === yesterday && same(peopleOf(H8), [B.tm, C.tm]), JSON.stringify(h8) + ' ' + JSON.stringify(peopleOf(H8)));
        await keeps('H8 after partial edits', B, H8);
        await keeps('H8 after partial edits', C, H8);
        r = await api(USER, `/api/tasks/${H8}`, { method: 'PUT', token: B.token, body: { due_date: null } });
        h8 = rowOf(H8);
        check('H8: a PUT that carries due_date: null clears the date and nothing else', r.status === 200 && h8.due_date == null && h8.assigned_to === B.tm && same(peopleOf(H8), [B.tm, C.tm]), JSON.stringify(h8));
        r = await api(ADMIN, `/api/tasks/${H8}`, { method: 'PUT', token: A.token, body: { assigned_to: null } });
        h8 = rowOf(H8);
        check('H8: a PUT that carries assigned_to: null unassigns it and drops every tag row', r.status === 200 && h8.assigned_to == null && same(peopleOf(H8), []), JSON.stringify(h8) + ' ' + JSON.stringify(peopleOf(H8)));
        await lost('H8 after unassign', B, H8);
        await lost('H8 after unassign', C, H8);
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
        for (const id of [H1, H2, H3, H4, H5, H6, H7, H8]) await api(ADMIN, `/api/tasks/${id}`, { method: 'DELETE', token: A.token });
        check('H1-H8 deleted by their creator, with their tag rows', tagRows([H1, H2, H3, H4, H5, H6, H7, H8]) === 0, tagRows([H1, H2, H3, H4, H5, H6, H7, H8]));

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
