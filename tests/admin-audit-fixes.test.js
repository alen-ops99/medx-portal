/**
 * tests/admin-audit-fixes.test.js — the server.js half of the 2026-09-17 admin-portal audit fixes.
 *
 *  B  Team Chat: legacy DM channels (project='dm', name 'dm:<a>:<b>', is_dm unset) must not be
 *     handed to every admin as workspace channels (the badge sat at 9 for everyone), and
 *     POST /api/chat/dm must stamp is_dm/dm_a/dm_b on the rows it creates.
 *  C  Plexus counts: /api/dashboard/summary, /api/dashboard/portal-stats and /api/admin/editions
 *     must agree, all counting PEOPLE (DISTINCT lower(email)) with live conference legs.
 *  E  PUT /api/accelerator/institutions/:id accepts city / available_spots / is_active (soft remove).
 *  J  PUT /api/admin/registration-links/:id renames a link ({label}); 400 empty, 404 unknown.
 *  K  System health "Bank transfer IBAN (service environment)" judges BOTH the live MEDX_IBAN and
 *     the saved v2_org_settings reference by mod-97; PUT /api/v2/settings/org rejects a bad checksum.
 *
 * Boots BOTH portals against one throwaway SQLite file (the user portal owns the
 * croatians_abroad_registrations columns), same shape as tests/gala-headcount.test.js.
 * Delta-style assertions so a seeded scratch DB never breaks them. NO network, NO email.
 *
 * Run: node tests/admin-audit-fixes.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3260';
const ADMIN = 'http://localhost:3261';

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 220) : ''));
};
const api = async (base, p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
};
const waitUp = async (base, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('server at ' + base + ' did not come up');
};

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-audit-fixes-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '',
        MEDX_IBAN: 'HR1234567890123456789',            // the known placeholder → the row must say so
        JWT_SECRET: 'audit-fixes-test-secret',
        NODE_ENV: 'test',
    };
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errbuf = '';
        p.stderr.on('data', (d) => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        p._errbuf = () => errbuf;
        procs.push(p);
        return p;
    };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('user-portal/backend', 3260);
        await waitUp(USER);
        boot('admin-portal/backend', 3261);
        await waitUp(ADMIN);

        // vp@medx.hr, not the founder seed: the one-time FOUNDER UNLOCK in the admin boot rewrites
        // juginovic.alen@gmail.com's scratch password on every fresh DB (must_change_password armed).
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'vp@medx.hr', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', r.status === 200 && !!atok, JSON.stringify(r.d).slice(0, 120));
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const q1 = (sql) => tdb.prepare(sql).get();
        const now = "strftime('%Y-%m-%d %H:%M:%S','now')";

        // ------------------------------------------------------------ C · one Plexus predicate, people not rows
        const plexusEditionRegs = async () => {
            const e = (await api(ADMIN, '/api/admin/editions', { token: atok })).d || {};
            const proj = (e.projects || []).find(p => p.project === 'plexus');
            const ed = proj && (proj.editions || []).find(x => x.status === 'active') || (proj && proj.editions[0]);
            return ed ? Number(ed.stats && ed.stats.registrations) : null;
        };
        const sum0 = (await api(ADMIN, '/api/dashboard/summary', { token: atok })).d || {};
        const ps0 = (await api(ADMIN, '/api/dashboard/portal-stats', { token: atok })).d || {};
        const ed0 = await plexusEditionRegs();
        check('baseline: the three Plexus counts already agree', sum0.plexus.registrations === ps0.plexus.registrations && (ed0 === null || ed0 === sum0.plexus.registrations), `${sum0.plexus.registrations} / ${ps0.plexus.registrations} / ${ed0}`);
        const seedCA = (id, email, status) => tdb.exec(
            `INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, conference_status, source, created_at)
             VALUES ('${id}', 'Audit', 'Fixes', '${email}', 1, '${status}', 'plexus', ${now})`);
        seedCA('af-ca-1', 'qa.robot+af1@example.com', 'pre-registered');
        seedCA('af-ca-2', 'QA.Robot+AF1@example.com', 'pre-registered');   // same person, different case → not counted twice
        seedCA('af-ca-3', 'qa.robot+af2@example.com', 'confirmed');
        seedCA('af-ca-4', 'qa.robot+af3@example.com', 'cancelled');        // dead leg → not counted
        const sum1 = (await api(ADMIN, '/api/dashboard/summary', { token: atok })).d || {};
        const ps1 = (await api(ADMIN, '/api/dashboard/portal-stats', { token: atok })).d || {};
        const ed1 = await plexusEditionRegs();
        check('summary: +2 people (4 rows, 1 duplicate email, 1 cancelled)', sum1.plexus.registrations - sum0.plexus.registrations === 2, `${sum0.plexus.registrations} -> ${sum1.plexus.registrations}`);
        check('portal-stats: same +2 as the summary', ps1.plexus.registrations - ps0.plexus.registrations === 2, `${ps0.plexus.registrations} -> ${ps1.plexus.registrations}`);
        check('editions: the Plexus edition card carries the same +2', ed0 !== null && ed1 - ed0 === 2, `${ed0} -> ${ed1}`);

        // ------------------------------------------------------------ B · legacy DMs stay private
        const me = (await api(ADMIN, '/api/teamchat/overview', { token: atok })).d || {};
        check('teamchat overview loads and knows me', !!(me.me && me.me.id), JSON.stringify(me.me));
        // Two OTHER seeded team members (FK: chat_messages.sender_id → team_members, team_members.user_id → users)
        const others = (me.roster || []).filter(m => !m.is_me).map(m => m.id);
        check('roster has at least two other seeded team members', others.length >= 2, others.length);
        const [otherA, otherB] = others;
        tdb.exec(`INSERT INTO chat_channels (id, name, description, project, is_default, created_by) VALUES ('af-dm-legacy', 'dm:${otherA}:${otherB}', 'legacy dm', 'dm', 0, '${otherA}')`);
        tdb.exec(`INSERT INTO chat_messages (id, sender_id, channel_id, message, created_at) VALUES ('af-msg-1', '${otherA}', 'af-dm-legacy', 'private note', ${now})`);
        const ov = (await api(ADMIN, '/api/teamchat/overview', { token: atok })).d || {};
        const leaked = (ov.channels || []).some(c => c.id === 'af-dm-legacy');
        check('legacy dm:* channel is NOT in my workspace channel list', !leaked, (ov.channels || []).map(c => c.name).join(','));
        check('…and its message is not in my unread total', !(ov.channels || []).some(c => c.id === 'af-dm-legacy' && c.unread > 0));
        r = await api(ADMIN, '/api/chat/dm', { method: 'POST', body: { target_member_id: otherA }, token: atok });
        const dmRow = r.status === 200 && r.d && r.d.id ? q1(`SELECT is_dm, dm_a, dm_b FROM chat_channels WHERE id = '${r.d.id}'`) : null;
        check('POST /api/chat/dm stamps is_dm=1 + dm_a/dm_b on the new channel', dmRow && Number(dmRow.is_dm) === 1 && dmRow.dm_a === me.me.id && dmRow.dm_b === otherA, JSON.stringify(dmRow) + ' status ' + r.status);
        const ov2 = (await api(ADMIN, '/api/teamchat/overview', { token: atok })).d || {};
        check('the new DM shows under dms, never under channels', (ov2.dms || []).some(d => d.id === r.d.id) && !(ov2.channels || []).some(c => c.id === r.d.id));

        // ------------------------------------------------------------ J · rename a registration link
        await api(ADMIN, '/api/admin/registration-links', { token: atok });   // the GET creates the table lazily on a fresh DB
        tdb.exec(`INSERT INTO registration_links (id, token, event_type, event_name, is_active, created_at) VALUES ('af-link-1', 'af-token-000000abcdef', 'plexus', 'Plexus Conference 2026', 1, ${now})`);   // no label column yet on a fresh DB — the PUT adds it
        r = await api(ADMIN, '/api/admin/registration-links/af-link-1', { method: 'PUT', body: { label: '  Deans — autumn wave  ' }, token: atok });
        check('PUT registration-links/:id renames (trimmed)', r.status === 200 && r.d.label === 'Deans — autumn wave' && q1(`SELECT label FROM registration_links WHERE id = 'af-link-1'`).label === 'Deans — autumn wave', JSON.stringify(r.d));
        r = await api(ADMIN, '/api/admin/registration-links/af-link-1', { method: 'PUT', body: { label: '   ' }, token: atok });
        check('PUT registration-links/:id rejects an empty label (400)', r.status === 400, r.status);
        r = await api(ADMIN, '/api/admin/registration-links/does-not-exist', { method: 'PUT', body: { label: 'x' }, token: atok });
        check('PUT registration-links/:id unknown id → 404', r.status === 404, r.status);
        r = await api(ADMIN, '/api/admin/registration-links/af-link-1/deactivate', { method: 'PUT', token: atok });
        check('the existing deactivate route still works beside it', r.status === 200 && Number(q1(`SELECT is_active FROM registration_links WHERE id = 'af-link-1'`).is_active) === 0, r.status);

        // ------------------------------------------------------------ E · institutions editable in place
        tdb.exec(`INSERT INTO accelerator_institutions (id, name, city, country, available_spots, is_active, sort_order) VALUES ('af-inst-1', 'Audit Clinic', 'Zagreb', 'Croatia', 5, 1, 999)`);
        r = await api(ADMIN, '/api/accelerator/institutions/af-inst-1', { method: 'PUT', body: { city: 'Split', available_spots: '3' }, token: atok });
        let inst = q1(`SELECT name, city, available_spots, is_active FROM accelerator_institutions WHERE id = 'af-inst-1'`);
        check('PUT institutions/:id updates city + available_spots, keeps the rest', r.status === 200 && inst.city === 'Split' && Number(inst.available_spots) === 3 && inst.name === 'Audit Clinic' && Number(inst.is_active) === 1, JSON.stringify(inst));
        r = await api(ADMIN, '/api/accelerator/institutions/af-inst-1', { method: 'PUT', body: { available_spots: -2 }, token: atok });
        check('PUT institutions/:id rejects negative spots (400)', r.status === 400, r.status);
        r = await api(ADMIN, '/api/accelerator/institutions/af-inst-1', { method: 'PUT', body: { is_active: 0 }, token: atok });
        inst = q1(`SELECT is_active FROM accelerator_institutions WHERE id = 'af-inst-1'`);
        const listed = ((await api(ADMIN, '/api/accelerator/institutions')).d || []).some(i => i.id === 'af-inst-1');
        check('PUT institutions/:id {is_active:0} soft-removes (row kept, gone from GET)', r.status === 200 && Number(inst.is_active) === 0 && !listed, JSON.stringify(inst) + ' listed=' + listed);
        r = await api(ADMIN, '/api/accelerator/institutions/nope', { method: 'PUT', body: { city: 'x' }, token: atok });
        check('PUT institutions/:id unknown id → 404', r.status === 404, r.status);

        // ------------------------------------------------------------ K · IBAN: one mod-97 rule for env + saved reference
        const ibanRow = async () => {
            const h = (await api(ADMIN, '/api/admin/system-health', { token: atok })).d || {};
            for (const g of (h.groups || [])) for (const c of (g.checks || [])) if (/Bank transfer IBAN/.test(c.name)) return c;
            return null;
        };
        let row = await ibanRow();
        check('health row is named "Bank transfer IBAN (service environment)"', row && row.name === 'Bank transfer IBAN (service environment)', row && row.name);
        check('placeholder MEDX_IBAN → fail, detail says the live service runs a placeholder', row && row.status === 'fail' && /placeholder/i.test(row.detail), row && row.detail);
        r = await api(ADMIN, '/api/v2/settings/org', { method: 'PUT', body: { oib: '', iban: 'HR76 2340 0091 1111 4550 2', fira_key: '' }, token: atok });
        check('PUT /api/v2/settings/org rejects an IBAN with a bad mod-97 checksum (400)', r.status === 400 && /checksum/i.test((r.d || {}).error || ''), r.status + ' ' + JSON.stringify(r.d));
        r = await api(ADMIN, '/api/v2/settings/org', { method: 'PUT', body: { oib: '', iban: 'HR76 2340 0091 1111 4550 1', fira_key: '' }, token: atok });
        check('PUT /api/v2/settings/org accepts a valid IBAN', r.status === 200, r.status + ' ' + JSON.stringify(r.d));
        row = await ibanRow();
        check('health detail now carries the saved reference with its own verdict', row && /Saved reference HR76…5501 is valid \(mod-97\)/.test(row.detail) && /placeholder/i.test(row.detail), row && row.detail);
        check('…and the fix line tells ops to set MEDX_IBAN', row && /MEDX_IBAN/.test(row.fix), row && row.fix);

        tdb.close();
    } catch (e) {
        check('unexpected error', false, (e && e.stack || e) + ' | admin stderr: ' + (procs[1] ? procs[1]._errbuf() : '') + ' | user stderr: ' + (procs[0] ? procs[0]._errbuf() : ''));
    } finally {
        const failed = results.filter(r => !r[1]).length;
        console.log(`\n${results.length - failed}/${results.length} passed`);
        cleanup();
        process.exit(failed ? 1 : 0);
    }
})();
