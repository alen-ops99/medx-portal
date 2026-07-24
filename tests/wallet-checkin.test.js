/**
 * wallet-checkin.test.js — unified per-event QR check-in + Google Wallet event tickets.
 *
 * Boots BOTH portals in NODE_ENV=test against ONE throwaway SQLite file (never Turso/prod),
 * with a MOCK Google Wallet service-account key (an in-test RSA keypair) and the Google REST
 * endpoints pointed at a black-hole so nothing touches the network. Mirrors the boot/teardown
 * style of tests/member-card-toggle.test.js.
 *
 * Covers: valid scan · already-checked-in · simulated concurrent double-scan (exactly one wins) ·
 * invalid token · revoked ticket · wrong-event · not-yet-active · expired · manual lookup + manual
 * check-in · multi-event independence · audit rows · Google Wallet savetowallet JWT shape.
 *
 * Run: node tests/wallet-checkin.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3201';
const ADMIN = 'http://localhost:3202';
const ISSUER = '3388000000023175280';
const APPROVED_CLASS = '3388000000023175280.3388000000023175280.plexus_week_2026';

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
};

const api = async (base, p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

const decodeJwt = (t) => JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

(async () => {
    // --- Pure-module unit asserts first (no server needed) ---
    const wallet = require('../shared/wallet');
    check('wallet: unconfigured env → isConfigured false', wallet.isConfigured({}) === false);
    check('wallet: unconfigured classIdFor → empty string', wallet.classIdFor('plexus-2026', {}) === '');
    let threw = false; try { wallet.buildSaveUrl({ objects: [] }, {}); } catch (e) { threw = e.message === 'wallet_not_configured'; }
    check('wallet: buildSaveUrl throws when unconfigured', threw);

    // --- FIX 1 front-end wiring: the Quick Check-in scanner the owner taps (App.globalCheckin, opened
    //     from the floating QR button) must post to the UNIFIED /api/admin/checkin/ticket endpoint so a
    //     Google Wallet QR (a crypto token) validates, instead of the legacy /api/checkin that can only
    //     resolve raw registration ids. The live ADMIT round-trip through that endpoint is asserted below. ---
    const adminSrc = fs.readFileSync(path.join(__dirname, '../admin-portal/frontend/index.html'), 'utf8');
    check('FIX1 wiring: Quick Check-in delegates to POST /api/admin/checkin/ticket',
        adminSrc.includes("fetch('/api/admin/checkin/ticket'") && adminSrc.includes('async globalCheckin(code)') && adminSrc.includes('this._gateForCtx()'));
    check('FIX1 wiring: _gateForCtx maps the "Checking in for" selector to conference/gala/bridges gates',
        adminSrc.includes('_gateForCtx()') && adminSrc.includes("gala: 'gala'") && adminSrc.includes("'bridges-croatian': 'bridges'"));
    check('FIX1 wiring: unified door result renders ADMIT / ALREADY / WRONG-EVENT states',
        adminSrc.includes('_renderGlobalUnifiedResult') && adminSrc.includes("label: 'ADMIT") && adminSrc.includes("label: 'NOT VALID FOR THIS EVENT'"));
    check('FIX1 wiring: legacy /api/checkin retained as fallback (old gala/forum tickets still work)',
        adminSrc.includes("this.api('/api/checkin'"));

    // Mock service account (real RSA key so the RS256 JWT genuinely verifies).
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const saPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const saJson = JSON.stringify({ client_email: 'wallet-sa@medx.iam.gserviceaccount.com', private_key: saPem });

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-wallet-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(scratch, 'scratch.db'),
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '',
        JWT_SECRET: 'wallet-checkin-test-secret',
        NODE_ENV: 'test',
        PUBLIC_BASE_URL: 'https://medx.test',
        GOOGLE_WALLET_ISSUER_ID: ISSUER,
        GOOGLE_WALLET_EVENT_CLASS_ID: APPROVED_CLASS,
        GOOGLE_WALLET_SA_KEY: saJson,
        // Black-hole the REST calls so the fire-and-forget provisioning never touches the network.
        GOOGLE_WALLET_OAUTH_URL: 'http://127.0.0.1:9/token',
        GOOGLE_WALLET_OBJECTS_BASE: 'http://127.0.0.1:9/v1',
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
        const up = boot('user-portal/backend', 3201);
        await waitUp(USER);
        const ap = boot('admin-portal/backend', 3202);
        await waitUp(ADMIN);

        // --- admin login ---
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', r.status === 200 && !!atok, JSON.stringify(r.d).slice(0, 120));
        const adminEmail = 'juginovic.alen@gmail.com';

        // --- create a conference (fires the auto-wallet-class hook) + a €0 ticket type ---
        r = await api(ADMIN, '/api/admin/conferences', { method: 'POST', token: atok, body: { name: 'Wallet Test Conf', year: 2026 } });
        const confId = r.d && r.d.id, confSlug = r.d && r.d.slug;
        check('conference create → id + slug', r.status === 200 && !!confId && !!confSlug, confSlug);
        r = await api(ADMIN, `/api/admin/conferences/${confId}/tickets`, { method: 'POST', token: atok, body: { name: 'General', price_regular: 0 } });
        const ticketId = r.d && r.d.id;
        check('ticket type create → id', r.status === 200 && !!ticketId);

        const makeReg = async (token) => {
            const rr = await api(ADMIN, '/api/registrations', { method: 'POST', token, body: { conference_id: confId, ticket_type_id: ticketId } });
            return rr.d || {};
        };

        // Primary registration (admin-owned). Give the admin email GALA access too.
        const regMain = await makeReg(atok);
        check('registration create → registration_id + invoice', !!regMain.registration_id && !!regMain.invoice_number, regMain.invoice_number);
        r = await api(USER, '/api/gala/register', { method: 'POST', token: atok, body: { first_name: 'Alen', last_name: 'Juginovic', email: adminEmail } });
        check('gala registration for admin email (grants gala access)', r.status === 200 || r.status === 201);

        // --- gates / event selector ---
        r = await api(ADMIN, '/api/admin/checkin/events', { token: atok });
        const gateKeys = (r.d && r.d.events || []).map(e => e.event_key);
        check('GET checkin/events lists the four Plexus gates', ['conference', 'gala', 'donor', 'bridges'].every(k => gateKeys.includes(k)), gateKeys.join(','));
        check('GET checkin/events returns a default_event', !!(r.d && r.d.default_event), r.d && r.d.default_event);

        // --- resolve (preview, no mark) ---
        r = await api(ADMIN, '/api/admin/checkin/resolve?code=' + regMain.registration_id, { token: atok });
        check('resolve preview → found with rich ticket', r.d && r.d.found && r.d.ticket && !!r.d.ticket.name, JSON.stringify(r.d && r.d.ticket && { name: r.d.ticket.name, events: r.d.ticket.events }));
        check('resolve: pass includes conference AND gala', r.d && r.d.ticket && r.d.ticket.events.includes('conference') && r.d.ticket.events.includes('gala'), r.d && r.d.ticket && r.d.ticket.events.join(','));

        // --- valid scan (conference) ---
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regMain.registration_id, event: 'conference', mark: true } });
        check('VALID scan → result valid + admitted', r.d && r.d.valid === true && r.d.result === 'valid', r.d && r.d.result);

        // --- already checked in (repeat) ---
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regMain.registration_id, event: 'conference', mark: true } });
        check('ALREADY scan → already_checked_in + who/when', r.d && r.d.result === 'already_checked_in' && !!r.d.checked_in_at && !!r.d.checked_in_by, r.d && r.d.checked_in_by);

        // --- multi-event independence: gala still open after conference used ---
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regMain.registration_id, event: 'gala', mark: true } });
        check('MULTI-EVENT: gala check-in valid though conference already used', r.d && r.d.result === 'valid', r.d && r.d.result);
        r = await api(ADMIN, '/api/admin/checkin/resolve?code=' + regMain.registration_id, { token: atok });
        check('MULTI-EVENT: both conference + gala recorded independently', r.d && r.d.ticket && r.d.ticket.checkins && r.d.ticket.checkins.conference && r.d.ticket.checkins.gala, Object.keys((r.d && r.d.ticket && r.d.ticket.checkins) || {}).join(','));

        // --- concurrent double-scan: exactly one wins ---
        const regConc = await makeReg(atok);
        const both = await Promise.all([
            api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regConc.registration_id, event: 'conference', mark: true } }),
            api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regConc.registration_id, event: 'conference', mark: true } }),
        ]);
        const valids = both.filter(x => x.d && x.d.result === 'valid').length;
        const alreadys = both.filter(x => x.d && x.d.result === 'already_checked_in').length;
        check('CONCURRENT double-scan → exactly one valid', valids === 1, 'valid=' + valids + ' already=' + alreadys);
        check('CONCURRENT double-scan → the other is already_checked_in', alreadys === 1);

        // --- invalid token ---
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: 'totally-bogus-code-zzz', event: 'conference', mark: true } });
        check('INVALID token → result invalid', r.d && r.d.valid === false && r.d.result === 'invalid', r.d && r.d.result);

        // --- wrong event: a member with no gala access scanned at gala ---
        const mEmail = 'qa.wallet+' + Date.now() + '@example.com';
        r = await api(USER, '/api/auth/register', { method: 'POST', body: { email: mEmail, password: 'test-password-9', first_name: 'Ivo', last_name: 'Horvat' } });
        const mtok = r.d && r.d.token;
        check('member register → token', r.status === 200 && !!mtok);
        const regMember = await makeReg(mtok); // conference-only pass (member email not gala-registered)
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regMember.registration_id, event: 'gala', mark: true } });
        check('WRONG-EVENT → result wrong_event (not admitted)', r.d && r.d.valid === false && r.d.result === 'wrong_event', r.d && r.d.result);

        // --- revoked ticket ---
        r = await api(ADMIN, `/api/admin/tickets/${regMember.registration_id}/revoke`, { method: 'POST', token: atok, body: { reason: 'test revoke' } });
        check('revoke endpoint → success', r.d && r.d.success && r.d.revoked === true, JSON.stringify(r.d));
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regMember.registration_id, event: 'conference', mark: true } });
        check('REVOKED ticket scan → result revoked', r.d && r.d.valid === false && r.d.result === 'revoked', r.d && r.d.result);

        // --- not-yet-active + expired (drive via the gala gate window on a fresh pass) ---
        const regWin = await makeReg(atok); // admin-owned → has gala access
        await api(ADMIN, '/api/admin/checkin/events/gala', { method: 'PUT', token: atok, body: { valid_from: '2099-01-01T00:00:00', valid_until: null } });
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regWin.registration_id, event: 'gala', mark: true } });
        check('NOT-YET-ACTIVE → result not_active', r.d && r.d.result === 'not_active', r.d && r.d.result);
        await api(ADMIN, '/api/admin/checkin/events/gala', { method: 'PUT', token: atok, body: { valid_from: null, valid_until: '2000-01-01T00:00:00' } });
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regWin.registration_id, event: 'gala', mark: true } });
        check('EXPIRED → result expired', r.d && r.d.result === 'expired', r.d && r.d.result);
        // restore gala gate to always-valid so nothing else is disturbed
        await api(ADMIN, '/api/admin/checkin/events/gala', { method: 'PUT', token: atok, body: { valid_from: null, valid_until: null } });

        // --- manual lookup + manual check-in ---
        const regMan = await makeReg(atok);
        r = await api(ADMIN, '/api/admin/checkin/lookup?q=' + encodeURIComponent(adminEmail), { token: atok });
        const found = (r.d && r.d.results || []).some(x => x.registration_id === regMan.registration_id);
        check('MANUAL LOOKUP by email finds the pass', found, 'results=' + ((r.d && r.d.results) || []).length);
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regMan.registration_id, event: 'conference', mark: true, method: 'manual' } });
        check('MANUAL CHECK-IN → valid', r.d && r.d.valid === true && r.d.result === 'valid', r.d && r.d.result);

        // --- audit rows written ---
        r = await api(ADMIN, '/api/admin/checkin/audit?limit=200', { token: atok });
        const scans = (r.d && r.d.scans) || [];
        const seen = new Set(scans.map(s => s.result));
        check('AUDIT log written for every result type', ['valid', 'already_checked_in', 'invalid', 'wrong_event', 'revoked', 'not_active', 'expired'].every(x => seen.has(x)), [...seen].join(','));
        check('AUDIT log flags a manual scan', scans.some(s => s.method === 'manual' && s.result === 'valid'));
        check('AUDIT log records admin identity + token', scans.some(s => s.admin_email === adminEmail && s.token));

        // --- Google Wallet EventTicketObject JWT shape (mock SA, no real Google) ---
        const regW = await makeReg(atok);
        r = await api(USER, '/api/member/wallet/google/ticket/' + regW.registration_id, { token: atok });
        check('wallet ticket endpoint → configured + save_url', r.d && r.d.configured === true && typeof r.d.save_url === 'string' && r.d.save_url.startsWith('https://pay.google.com/gp/v/save/'), r.d && r.d.configured);
        let walletTok = null;
        if (r.d && r.d.save_url) {
            const claims = decodeJwt(r.d.save_url.split('/save/')[1]);
            const obj = claims.payload && claims.payload.eventTicketObjects && claims.payload.eventTicketObjects[0];
            check('wallet JWT: typ=savetowallet', claims.typ === 'savetowallet');
            check('wallet JWT: object.classId is <ISSUER>.<slug>', obj && obj.classId === ISSUER + '.' + confSlug, obj && obj.classId);
            check('wallet JWT: barcode.value is a 48-hex token', obj && /^[0-9a-f]{48}$/.test(obj.barcode.value), obj && obj.barcode.value);
            check('wallet JWT: carries holder name + textModules', obj && !!obj.ticketHolderName && Array.isArray(obj.textModulesData) && obj.textModulesData.length > 0);
            walletTok = obj && obj.barcode.value;
        }
        // The SAME token the wallet encodes resolves to the SAME registration at the door.
        if (walletTok) {
            r = await api(ADMIN, '/api/admin/checkin/resolve?code=' + walletTok, { token: atok });
            check('wallet token resolves to the same ticket at the scanner', r.d && r.d.found && r.d.ticket.registration_id === regW.registration_id);
        }

        // --- conference create stored a wallet_class_id (auto class provisioning) ---
        r = await api(USER, '/api/member/wallet/google/ticket/' + regMain.registration_id, { token: atok });
        check('auto class id used on member pass (<ISSUER>.<slug>)', r.d && r.d.save_url && decodeJwt(r.d.save_url.split('/save/')[1]).payload.eventTicketObjects[0].classId === ISSUER + '.' + confSlug);

        // --- auth: staff/admin required on the scanner endpoint ---
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', body: { code: regMain.registration_id, event: 'conference' } });
        check('scanner endpoint rejects unauthenticated (401)', r.status === 401);

    } catch (e) {
        check('unexpected error: ' + e.message, false, e.stack);
        procs.forEach(p => { const b = p._errbuf && p._errbuf(); if (b) console.log('--- server stderr ---\n' + b.slice(-1500)); });
    } finally {
        cleanup();
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
