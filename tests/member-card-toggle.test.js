#!/usr/bin/env node
/**
 * Member-card toggle test — scratch CI-style boot (mirrors the account-linking test approach).
 *
 * Boots BOTH portal backends against one throwaway SQLite file (no Turso, no Stripe, no email
 * provider) and proves the per-form + fixed-page "Već imate račun?" card toggles end to end:
 *
 *   - signup_forms.show_member_card stored EXPLICITLY on create (default ON)
 *   - builder checkbox round-trip via PUT /api/admin/signup-forms/:id
 *   - /f/:slug renders the card slot only while the form's toggle is ON; other forms unaffected
 *   - anonymous /f/:slug submits succeed identically in BOTH toggle states
 *   - fixed-page toggles (admin /api/admin/member-card-toggles -> rewards_settings) gate
 *     /donor-night, /building-bridges and /plexus link notes; unknown surfaces 400
 *   - GET /api/member-card-visibility feeds the SPA surfaces (spa-plexus / spa-gala)
 *   - account LINKING is unaffected while a card is hidden: a signed-in donor-night submit
 *     still lands with user_id set; an anonymous one stays NULL
 *
 *   node tests/member-card-toggle.test.js
 *
 * Exits 1 on any failure. Cleans up its servers + scratch dir.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3101';
const ADMIN = 'http://localhost:3102';

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 160) : ''));
};

const api = async (base, p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let d = null;
    try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
};
const html = async (base, p) => { const r = await fetch(base + p); return { status: r.status, t: await r.text() }; };

const waitUp = async (base, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('server at ' + base + ' did not come up');
};

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-mct-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(scratch, 'scratch.db'),
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '',
        JWT_SECRET: 'member-card-toggle-test-secret',
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
        // Boot the user portal first (it owns the heavier seed), then the admin portal on the same DB.
        boot('user-portal/backend', 3101);
        await waitUp(USER);
        boot('admin-portal/backend', 3102);
        await waitUp(ADMIN);

        // ---- admin session (seeded admin on a fresh DB) ----
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', r.status === 200 && atok);

        // ---- (1) create two builder forms; show_member_card stored explicitly ON ----
        r = await api(ADMIN, '/api/admin/signup-forms', { method: 'POST', body: { title: 'Toggle Target' }, token: atok });
        const formA = r.d && r.d.form;
        check('create form A', r.status === 200 && formA && formA.slug);
        check('form A stores show_member_card=1 explicitly on create', formA && formA.show_member_card === 1, 'value=' + (formA && formA.show_member_card));
        r = await api(ADMIN, '/api/admin/signup-forms', { method: 'POST', body: { title: 'Control Form' }, token: atok });
        const formB = r.d && r.d.form;
        check('create form B', r.status === 200 && formB && formB.slug);
        for (const f of [formA, formB]) await api(ADMIN, '/api/admin/signup-forms/' + f.id, { method: 'PUT', body: { status: 'open' }, token: atok });

        // ---- (2) default ON: both public pages render the member-card slot ----
        let a = await html(USER, '/f/' + formA.slug);
        let b = await html(USER, '/f/' + formB.slug);
        check('/f/A default: member-card slot present', a.status === 200 && a.t.includes('id="sfMemberCard"') && a.t.includes('SF_SHOW_MEMBER_CARD = true'));
        check('/f/B default: member-card slot present', b.status === 200 && b.t.includes('id="sfMemberCard"'));

        // ---- (3) toggle A OFF -> A hides the card, B keeps it; ON -> restored ----
        r = await api(ADMIN, '/api/admin/signup-forms/' + formA.id, { method: 'PUT', body: { show_member_card: false }, token: atok });
        check('PUT show_member_card=false accepted', r.status === 200);
        r = await api(ADMIN, '/api/admin/signup-forms/' + formA.id, { token: atok });
        check('form A round-trips show_member_card=0', r.d && r.d.show_member_card === 0, 'value=' + (r.d && r.d.show_member_card));
        a = await html(USER, '/f/' + formA.slug);
        b = await html(USER, '/f/' + formB.slug);
        check('/f/A toggle OFF: card slot gone', !a.t.includes('id="sfMemberCard"') && a.t.includes('SF_SHOW_MEMBER_CARD = false'));
        check('/f/B unaffected: card slot still present', b.t.includes('id="sfMemberCard"'));

        // ---- (4) anonymous submit works identically in BOTH states ----
        r = await api(USER, '/api/signup-forms/' + formA.slug + '/submit', { method: 'POST', body: { name: 'Anon Off', email: 'qa.robot+off@example.com', gdpr_consent: true, answers: {} } });
        check('anonymous submit with card OFF succeeds', r.status === 200 && r.d && r.d.success, JSON.stringify(r.d));
        await api(ADMIN, '/api/admin/signup-forms/' + formA.id, { method: 'PUT', body: { show_member_card: true }, token: atok });
        a = await html(USER, '/f/' + formA.slug);
        check('/f/A toggle back ON: card slot restored', a.t.includes('id="sfMemberCard"') && a.t.includes('SF_SHOW_MEMBER_CARD = true'));
        r = await api(USER, '/api/signup-forms/' + formA.slug + '/submit', { method: 'POST', body: { name: 'Anon On', email: 'qa.robot+on@example.com', gdpr_consent: true, answers: {} } });
        check('anonymous submit with card ON succeeds', r.status === 200 && r.d && r.d.success);

        // ---- (5) fixed-page toggles via the admin settings API ----
        r = await api(ADMIN, '/api/admin/member-card-toggles', { token: atok });
        const allOn = r.d && r.d.toggles && ['spa-plexus', 'spa-gala', 'page-plexus', 'page-building-bridges', 'page-donor-night'].every(k => r.d.toggles[k] === true);
        check('admin toggles: all five surfaces default ON', r.status === 200 && allOn, JSON.stringify(r.d && r.d.toggles));
        r = await api(ADMIN, '/api/admin/member-card-toggles', { method: 'PUT', body: { toggles: { nonsense: false } }, token: atok });
        check('admin toggles: unknown surface rejected with 400', r.status === 400);

        let dn = await html(USER, '/donor-night');
        check('/donor-night default: link-note present', dn.t.includes('id="peLinkNote"') && dn.t.includes('PE_SHOW_CARD = true'));
        r = await api(ADMIN, '/api/admin/member-card-toggles', { method: 'PUT', body: { toggles: { 'page-donor-night': false, 'page-plexus': false } }, token: atok });
        check('PUT fixed-page toggles OFF accepted', r.status === 200 && r.d.toggles['page-donor-night'] === false);
        dn = await html(USER, '/donor-night');
        const bb = await html(USER, '/building-bridges');
        check('/donor-night OFF: link-note gone', !dn.t.includes('id="peLinkNote"') && dn.t.includes('PE_SHOW_CARD = false'));
        check('/building-bridges unaffected: link-note still present', bb.t.includes('id="peLinkNote"') && bb.t.includes('PE_SHOW_CARD = true'));
        const px = await html(USER, '/plexus');
        check('/plexus OFF: link-note gone', px.status === 200 && !px.t.includes('id="plexLinkNote"') && px.t.includes('PLEX_SHOW_CARD = false'));

        // ---- (6) SPA visibility feed ----
        r = await api(USER, '/api/member-card-visibility');
        check('SPA visibility default: plexus+gala true', r.status === 200 && r.d.plexus === true && r.d.gala === true, JSON.stringify(r.d));
        await api(ADMIN, '/api/admin/member-card-toggles', { method: 'PUT', body: { toggles: { 'spa-gala': false } }, token: atok });
        r = await api(USER, '/api/member-card-visibility');
        check('SPA visibility: spa-gala OFF propagates to the user portal', r.d.plexus === true && r.d.gala === false, JSON.stringify(r.d));

        // ---- (7) account linking unaffected while cards are hidden ----
        r = await api(USER, '/api/auth/register', { method: 'POST', body: { email: 'qa.robot+linked@example.com', password: 'test-password-9', first_name: 'Linked', last_name: 'Member' } });
        const mtok = r.d && r.d.token, mid = r.d && r.d.user && r.d.user.id;
        check('member signup works on scratch boot', r.status === 200 && mtok && mid);
        r = await api(USER, '/api/public-events/register', { method: 'POST', token: mtok, body: { event: 'donor-night', first_name: 'Linked', last_name: 'Member', email: 'qa.robot+linked@example.com', institution: 'Inst', role: 'Guest' } });
        check('signed-in donor-night submit succeeds with card toggle OFF', r.status === 200, JSON.stringify(r.d).slice(0, 120));
        r = await api(USER, '/api/public-events/register', { method: 'POST', body: { event: 'donor-night', first_name: 'Anon', last_name: 'Guest', email: 'qa.robot+anonhidden@example.com', institution: 'Inst', role: 'Guest' } });
        check('anonymous donor-night submit succeeds with card toggle OFF', r.status === 200);
        r = await api(ADMIN, '/api/bridges/events', { token: atok });
        let linked = null, anon = null;
        for (const ev of (Array.isArray(r.d) ? r.d : [])) {
            const rr = await api(ADMIN, '/api/bridges/events/' + ev.id + '/registrations', { token: atok });
            for (const reg of (Array.isArray(rr.d) ? rr.d : [])) {
                if (reg.email === 'qa.robot+linked@example.com') linked = reg;
                if (reg.email === 'qa.robot+anonhidden@example.com') anon = reg;
            }
        }
        check('hidden-card signed-in row still LINKED (user_id set)', linked && linked.user_id === mid, 'user_id=' + (linked && linked.user_id));
        check('hidden-card anonymous row stays unlinked', anon && !anon.user_id);

        // ---- (8) restore every fixed-page toggle to ON (leave scratch state clean by principle) ----
        r = await api(ADMIN, '/api/admin/member-card-toggles', { method: 'PUT', body: { toggles: { 'spa-gala': true, 'page-donor-night': true, 'page-plexus': true } }, token: atok });
        check('restore: all toggles back ON', r.status === 200 && Object.values(r.d.toggles).every(v => v === true));
        dn = await html(USER, '/donor-night');
        check('/donor-night restored: link-note present again', dn.t.includes('id="peLinkNote"'));
    } catch (e) {
        check('unexpected error: ' + e.message, false);
    } finally {
        cleanup();
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
