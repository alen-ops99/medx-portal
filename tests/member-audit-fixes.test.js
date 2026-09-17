/**
 * tests/member-audit-fixes.test.js — the member-portal audit fixes of 2026-09-17 that touch routes.
 *
 *  1. Building Bridges seats. GET /api/bridges/events counted every bridges_registrations row, so a
 *     cancelled guest still held a seat: Boston read FULLY BOOKED with empty chairs, while
 *     POST /api/bridges/events/:id/register kept taking registrations (it never looked at the
 *     admin's registration_open switch). Now registration_count = held seats only
 *     ('registered' / 'confirmed'), the capacity check counts the same, and a closed event refuses.
 *  3. Network directory. GET /api/v2/network/directory (+ suggestions, which share the CTE) listed
 *     accounts that never confirmed their email — accounts that cannot even log in. Now only
 *     users.email_verified = 1 is listed.
 *  6b. GET /api/accelerator/institutions folds the active program year's
 *     accelerator_institution_details row in (program_type, duration, mentors, requirements …) so
 *     the member page's host drawer can show every field; institutions without a row keep nulls.
 *
 * Scratch CI-style boot (mirrors tests/member-card-toggle.test.js): the user portal alone on a
 * throwaway SQLite file, no Turso, no mail provider, no Stripe. Rows are seeded straight into the
 * scratch file with the portal's own libsql. Nothing here can reach production.
 *
 * Run: node tests/member-audit-fixes.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3141';

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
};

const api = async (p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(USER + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let d = null;
    try { d = await r.json(); } catch (e) {}
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
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-audit-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '', STRIPE_SECRET_KEY: '',
        JWT_SECRET: 'member-audit-fixes-test-secret',
        NODE_ENV: 'test', PORT: '3141'
    };
    let proc = null, errbuf = '';
    const cleanup = () => {
        if (proc) { try { proc.kill('SIGKILL'); } catch (e) {} }
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        proc = spawn('node', ['server.js'], { cwd: path.join(ROOT, 'user-portal/backend'), env, stdio: ['ignore', 'ignore', 'pipe'] });
        proc.stderr.on('data', d => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        await waitUp(USER);

        // ---- three members: the viewer, one verified colleague, one who never confirmed ----
        const signup = async (tag, first, last) => {
            const r = await api('/api/auth/register', { method: 'POST', body: { email: `qa.audit+${tag}@example.com`, password: 'test-password-9', first_name: first, last_name: last, institution: 'Audit Institute' } });
            return { token: r.d && r.d.token, id: r.d && r.d.user && r.d.user.id, email: `qa.audit+${tag}@example.com`, status: r.status };
        };
        const me = await signup('viewer', 'Viewer', 'Auditsson');
        const verified = await signup('verified', 'Vera', 'Verified');
        const unverified = await signup('unverified', 'Uno', 'Unconfirmed');
        check('scratch boot: member signup works', me.status === 200 && me.token && verified.id && unverified.id);

        const Database = require(path.join(ROOT, 'user-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const q = (sql, params = []) => tdb.prepare(sql).run(...params);
        q('UPDATE users SET email_verified = 1, is_public_profile = 1 WHERE id IN (?, ?)', [me.id, verified.id]);
        q('UPDATE users SET email_verified = 0, is_public_profile = 1 WHERE id = ?', [unverified.id]);

        // ---- 1. Bridges: capacity 2, one registered + one confirmed + one cancelled ----
        const EV = 'bb-audit-seats';
        q(`INSERT INTO bridges_events (id, name, city, event_date, event_time, capacity, registration_open, is_published, price, status)
           VALUES (?, 'Building Bridges — Testville', 'Testville', '2031-03-01', '18:00', 2, 1, 1, 0, 'upcoming')`, [EV]);
        const reg = (id, email, status) => q(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status, qr_code) VALUES (?, ?, 'T', 'Guest', ?, ?, ?)`, [id, EV, email, status, 'MEDX-BB-' + id]);
        reg('r-held-1', 'held1@example.com', 'registered');
        reg('r-held-2', 'held2@example.com', 'confirmed');
        reg('r-gone-1', 'gone1@example.com', 'cancelled');

        let r = await api('/api/bridges/events', { token: me.token });
        let ev = Array.isArray(r.d) ? r.d.find(e => e.id === EV) : null;
        check('bridges list: registration_count counts held seats only (2, not 3)', ev && Number(ev.registration_count) === 2, 'count=' + (ev && ev.registration_count));
        r = await api('/api/bridges/events/' + EV, { token: me.token });
        check('bridges single: registration_count counts held seats only', r.status === 200 && Number(r.d.registration_count) === 2, 'count=' + (r.d && r.d.registration_count));

        r = await api('/api/bridges/events/' + EV + '/register', { method: 'POST', token: me.token, body: { name: 'Viewer Auditsson', email: me.email, institution: 'Audit Institute' } });
        check('register at capacity (2 held of 2): refused with 400', r.status === 400 && /capacity/i.test(String(r.d && r.d.error)), JSON.stringify(r.d));

        q(`UPDATE bridges_registrations SET status = 'cancelled' WHERE id = 'r-held-2'`);
        r = await api('/api/bridges/events/' + EV + '/register', { method: 'POST', token: me.token, body: { name: 'Viewer Auditsson', email: me.email, institution: 'Audit Institute' } });
        check('register after a seat is given back: accepted', r.status === 200 && r.d && r.d.success && !r.d.already_registered, JSON.stringify(r.d));
        r = await api('/api/bridges/events', { token: me.token });
        ev = Array.isArray(r.d) ? r.d.find(e => e.id === EV) : null;
        check('bridges list after the new registration: 2 held again', ev && Number(ev.registration_count) === 2, 'count=' + (ev && ev.registration_count));

        q(`UPDATE bridges_events SET capacity = 10, registration_open = 0 WHERE id = ?`, [EV]);
        r = await api('/api/bridges/events/' + EV + '/register', { method: 'POST', token: verified.token, body: { name: 'Vera Verified', email: verified.email } });
        check('register on a closed event (registration_open = 0): refused with 400', r.status === 400 && /not open/i.test(String(r.d && r.d.error)), JSON.stringify(r.d));
        r = await api('/api/bridges/events/' + EV + '/register', { method: 'POST', token: me.token, body: { name: 'Viewer Auditsson', email: me.email } });
        check('already registered stays idempotent even while closed', r.status === 200 && r.d && r.d.already_registered === true, JSON.stringify(r.d));
        q(`UPDATE bridges_events SET registration_open = 1 WHERE id = ?`, [EV]);
        r = await api('/api/bridges/events/' + EV + '/register', { method: 'POST', token: verified.token, body: { name: 'Vera Verified', email: verified.email } });
        check('reopened: registration accepted again', r.status === 200 && r.d && r.d.success, JSON.stringify(r.d));

        // ---- 3. Network directory: only confirmed accounts ----
        const names = async (p) => {
            const res = await api(p, { token: me.token });
            const rows = (res.d && (res.d.results || res.d.suggestions || res.d.members)) || [];
            return { status: res.status, rows, names: rows.map(x => x.name || [x.first_name, x.last_name].filter(Boolean).join(' ')) };
        };
        let dir = await names('/api/v2/network/directory?size=100');
        check('directory: answers 200', dir.status === 200, 'status=' + dir.status);
        check('directory: the verified colleague is listed', dir.names.some(n => /Vera Verified/.test(n)), dir.names.join(' · '));
        check('directory: the unconfirmed account is NOT listed', !dir.names.some(n => /Uno Unconfirmed/.test(n)), dir.names.join(' · '));
        q('UPDATE users SET email_verified = 1 WHERE id = ?', [unverified.id]);
        dir = await names('/api/v2/network/directory?size=100');
        check('directory: once confirmed, the same account appears', dir.names.some(n => /Uno Unconfirmed/.test(n)), dir.names.join(' · '));
        q('UPDATE users SET email_verified = 0 WHERE id = ?', [unverified.id]);
        const sug = await names('/api/v2/network/suggestions');
        check('suggestions share the gate: unconfirmed account absent', sug.status === 200 && !sug.names.some(n => /Uno Unconfirmed/.test(n)), sug.names.join(' · '));

        // ---- 6b. Accelerator institutions carry the current year's details ----
        const prog = tdb.prepare('SELECT year FROM accelerator_programs WHERE is_active = 1 ORDER BY year DESC LIMIT 1').get();
        const year = prog ? Number(prog.year) : new Date().getFullYear();
        if (!prog) q(`INSERT INTO accelerator_programs (id, name, year, is_active) VALUES ('prog-audit', 'Audit Program', ?, 1)`, [year]);
        q(`INSERT INTO accelerator_institutions (id, name, short_name, city, country, description, website_url, available_spots, is_active, sort_order)
           VALUES ('inst-audit-a', 'Audit Clinic', 'AC', 'Testville', 'Testland', 'A clinic for tests', 'https://audit.example.com', 3, 1, 90)`);
        q(`INSERT INTO accelerator_institutions (id, name, short_name, city, country, is_active, sort_order) VALUES ('inst-audit-b', 'Audit Lab', 'AL', 'Testville', 'Testland', 1, 91)`);
        q(`INSERT INTO accelerator_institution_details (id, institution_id, year, program_type, available_spots, internship_duration, mentors, requirements, is_active)
           VALUES ('det-audit-a', 'inst-audit-a', ?, 'clinical', 2, '10 weeks', 'Dr. Audit Mentor', 'Fluent English', 1)`, [year]);
        q(`INSERT INTO accelerator_institution_details (id, institution_id, year, program_type, available_spots, internship_duration, is_active)
           VALUES ('det-audit-old', 'inst-audit-b', ?, 'scientific', 9, '4 weeks', 1)`, [year - 1]);
        r = await api('/api/accelerator/institutions');
        const a = Array.isArray(r.d) ? r.d.find(i => i.id === 'inst-audit-a') : null;
        const b = Array.isArray(r.d) ? r.d.find(i => i.id === 'inst-audit-b') : null;
        check('institutions: public read still answers 200 with rows', r.status === 200 && a && b);
        check('institutions: this year\'s details are folded in (program_type · duration · mentors · requirements · year_spots · details_year)',
            a && a.program_type === 'clinical' && a.internship_duration === '10 weeks' && a.mentors === 'Dr. Audit Mentor' && a.requirements === 'Fluent English' && Number(a.year_spots) === 2 && Number(a.details_year) === year,
            JSON.stringify(a));
        check('institutions: the institution\'s own columns are untouched (available_spots · website_url · description)',
            a && Number(a.available_spots) === 3 && a.website_url === 'https://audit.example.com' && a.description === 'A clinic for tests');
        check('institutions: a details row for another year is NOT folded in (nulls)', b && b.program_type == null && b.internship_duration == null && b.details_year == null, JSON.stringify(b));

        tdb.close();
    } catch (e) {
        check('test run crashed', false, (e && e.stack || e) + '\n--- server stderr ---\n' + errbuf);
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    cleanup();
    process.exit(passed === results.length ? 0 : 1);
})();
