#!/usr/bin/env node
/**
 * door-hardening.test.js — round 3 Phase 0a, item 4 (door hardening), item 2 (the admin '*'
 * catch-all) and item 3 (the Bridges seed rows in admin-portal/backend/server.js).
 *
 * The verifier's five probes, at every door that exists on this line:
 *   1. a STRIPPED e-mail ('<4 hex of a real id>@zz.rst') and a bare e-mail as a SCANNED code
 *      → never resolves. The same e-mail or short code TYPED by door staff (method 'manual') does.
 *   2. an UNPAID Gala row → refused at every Gala door (and gives no Gala on the one pass).
 *   3. a COMPED speaker → admitted (a gala seat with payment 'comp', and the speaker ticket model:
 *      a conference registration with includes_gala and payment 'waived').
 *   4. a WAIVED row → admitted.
 *   5. an UNVERIFIED account → sees the e-mail-linked tickets while MEDX_VERIFIED_EMAIL_GATE is OFF
 *      (the default), and none of them once it is ON. A verified account keeps its own. A seat the
 *      account owns by user_id stays visible either way. The member reads run on both lines, the v2
 *      wallet and member QR only on the redesign line.
 * Plus: vip-comp and the gala-ops VIP / sponsor seats admitted, the invoice path (approved +
 * pending) and a dead status refused, the admin catch-all, the door-staff page script, the seeds.
 *   6. a TYPED invoice number (GALA26-NNNN, PLX26-NNNNNN) never resolves by an id prefix. A letter
 *      prefix used to be dropped first, so GALA26-0041 became 0041 and matched a stranger's seat.
 * RELEASE GATE checks (round 3 Phase 0a, second pass): the admin v2 Event Day frontend sends the
 * method on the ID-check lookup (manual for the typed form, qr for the camera) and carries it into
 * ADMIT, and the backend resolves a typed e-mail and a typed short code at /lookup with method manual.
 * The admin backend never deploys without that frontend. With MEDX_VERIFIED_EMAIL_GATE ON, every
 * member read that matches rows by e-mail hides them from an unverified account: the wallet, the
 * member QR, /api/gala/my-status, /api/gala/my, /api/gala/my-seat, /api/my/events and
 * /api/plexus/my-registration. The flag is switched on only when all of these pass.
 *
 * Boots both portals on a throwaway SQLite file (never Turso, never production). Rows the API cannot
 * make (comp, waived, vip-comp, a verified account) are written straight into that scratch file.
 * The redesign-only surfaces (v2 Event Day, the member wallet, gala-ops) SKIP on a line without them.
 *
 * Run: MEDX_TEST_USER_PORT=3813 MEDX_TEST_ADMIN_PORT=3814 node tests/door-hardening.test.js
 */
'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER_PORT = Number(process.env.MEDX_TEST_USER_PORT || 3813);
const ADMIN_PORT = Number(process.env.MEDX_TEST_ADMIN_PORT || 3814);
const USER = 'http://localhost:' + USER_PORT;
const ADMIN = 'http://localhost:' + ADMIN_PORT;
const ADMIN_V2 = 'https://medx-admin-portal-v2.netlify.app';

const HAS_EVENTDAY = fs.existsSync(path.join(ROOT, 'admin-portal/backend/v2/event-day.js'));
const HAS_WALLET = fs.existsSync(path.join(ROOT, 'user-portal/backend/v2/wallet.js'));
const HAS_GALAOPS = fs.existsSync(path.join(ROOT, 'admin-portal/backend/v2/gala-ops.js'));
// /api/plexus/my-registration reads a public /plexus-form place (croatians_abroad_registrations) by e-mail
// on the redesign line only. Main reads the Plexus place by user_id alone, so it has nothing to gate there.
const MEMBER_SRC = fs.readFileSync(path.join(ROOT, 'user-portal/backend/server.js'), 'utf8');
const MYREG_AT = MEMBER_SRC.indexOf("app.get('/api/plexus/my-registration'");
const MYREG_END = MEMBER_SRC.indexOf('\n    app.', MYREG_AT + 1);
const HAS_CA_MYREG = MYREG_AT > 0 && MYREG_END > MYREG_AT && /croatians_abroad_registrations/.test(MEMBER_SRC.slice(MYREG_AT, MYREG_END));

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail !== '' && detail !== undefined ? ' | ' + String(detail).slice(0, 200) : ''));
};
const skip = (name, why) => console.log('SKIP | ' + name + ' | ' + why);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const api = async (base, p, { method = 'GET', body, token, redirect = 'follow' } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, redirect, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) {}
    return { status: r.status, d, text, location: r.headers.get('location') };
};
const waitUp = async (base, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await sleep(400);
    }
    throw new Error('server at ' + base + ' did not come up');
};
const waitDown = async (port, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { await fetch('http://localhost:' + port + '/health'); } catch (e) { return; }
        await sleep(200);
    }
};

(async () => {
    // ---------------------------------------------------------------- source checks (no server)
    const adminSrc = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');
    const s0 = adminSrc.indexOf('SEED BUILDING BRIDGES EVENTS');
    const s1 = adminSrc.indexOf("'bridges_placeholder_migration_done', '1'", s0);
    const seeds = s0 > 0 && s1 > s0 ? adminSrc.slice(s0, s1) : '';
    check('SEEDS: both Bridges seed blocks found', seeds.length > 1000 && /realEvents/.test(seeds));
    check('SEEDS: no NIH, no ETH, no old NIH/ETH street address', !/\bNIH\b|\bETH\b|Rämistrasse|Rockville/.test(seeds), (seeds.match(/\bNIH\b|\bETH\b|Rämistrasse|Rockville/) || [''])[0]);
    check('SEEDS: Washington venue is the Embassy (both blocks)', (seeds.match(/venue_name: 'Embassy of the Republic of Croatia, Washington DC'/g) || []).length === 2);
    check('SEEDS: Zürich venue is "Zunfthaus zur Schmiden" (both blocks)', (seeds.match(/venue_name: 'Zunfthaus zur Schmiden'/g) || []).length === 2);
    check('SEEDS: city names unchanged', /city: 'Zurich'/.test(seeds) && /city: 'Washington DC'/.test(seeds));

    if (HAS_WALLET) {
        const ap = require(path.join(ROOT, 'user-portal/backend/v2/apple-pass.js'));
        check('GATE unit: apple-pass.js exports the one e-mail-link helper', typeof ap.emailLinkFor === 'function');
        if (typeof ap.emailLinkFor !== 'function') ap.emailLinkFor = () => null;
        const keep = process.env.MEDX_VERIFIED_EMAIL_GATE;
        delete process.env.MEDX_VERIFIED_EMAIL_GATE;
        check('GATE unit: OFF by default → an unverified account links by e-mail', ap.emailLinkFor({ email: 'A@X.HR', email_verified: 0 }) === 'a@x.hr');
        process.env.MEDX_VERIFIED_EMAIL_GATE = '1';
        check('GATE unit: ON → an unverified account links nothing (sentinel)', ap.emailLinkFor({ email: 'a@x.hr', email_verified: 0 }) === '__none__');
        check('GATE unit: ON → a verified account still links by e-mail', ap.emailLinkFor({ email: 'a@x.hr', email_verified: 1 }) === 'a@x.hr');
        check('GATE unit: ON → no email_verified field counts as unverified', ap.emailLinkFor({ email: 'a@x.hr' }) === '__none__');
        if (keep === undefined) delete process.env.MEDX_VERIFIED_EMAIL_GATE; else process.env.MEDX_VERIFIED_EMAIL_GATE = keep;
    } else skip('GATE unit', 'no user-portal/backend/v2/wallet.js on this line');

    // RELEASE GATE, the admin v2 Event Day frontend. The backend resolves an e-mail or a short code
    // only when it was typed (method 'manual'), and a lookup with no method counts as a scan. So the
    // ID-check lookup (the default door mode) must send the method, and every ADMIT that re-sends the
    // code must carry the method the code arrived by. tests/eventday-method-ui.py drives the same
    // paths in a browser (typed form, camera, ADMIT, ADMIT ONE MORE).
    const EVENTDAY_UI = path.join(ROOT, 'admin-portal/frontend-v2/js/views/eventday.js');
    if (HAS_EVENTDAY && fs.existsSync(EVENTDAY_UI)) {
        const ui = fs.readFileSync(EVENTDAY_UI, 'utf8');
        const between = (a, b) => { const i = ui.indexOf(a); const j = ui.indexOf(b, i + 1); return i >= 0 && j > i ? ui.slice(i, j) : ''; };
        const idf = between('async function identify(', 'function idCardHtml(');
        const hnd = (name) => between('  ' + name + ': (el) => {', '\n  },');
        check('RELEASE GATE UI: the ID-check lookup posts the method', /api\.post\('\/api\/v2\/eventday\/lookup', \{ code, rehearsal: st\.rehearsal, method \}\)/.test(idf));
        check('RELEASE GATE UI: the lookup method is manual only when typed, qr otherwise', /const method = opts\.method === 'manual' \? 'manual' : 'qr';/.test(idf));
        check('RELEASE GATE UI: the ID card and a failed lookup keep the method', /st\.idcard = Object\.assign\(\{ _code: code, _method: method \}, out\)/.test(idf) && /_code: code, _method: method \}\)\); return out;/.test(idf));
        check('RELEASE GATE UI: the camera sends qr (ID-check and instant admit)', /\(st\.instant \? scan : identify\)\(hit\.data, \{ method: 'qr' \}\)/.test(ui));
        check('RELEASE GATE UI: the typed form sends manual (ID-check and instant admit)', /if \(st\.instant\) scan\(v, \{ method: 'manual' \}\)/.test(ui) && /else identify\(v, \{ method: 'manual' \}\);/.test(ui));
        check('RELEASE GATE UI: a scan result remembers its method', /out\._method = body\.method;/.test(between('async function scan(', 'function showResult(')));
        check('RELEASE GATE UI: ADMIT from the ID card re-sends the ID card method', /const how = \(st\.idcard && st\.idcard\._method\) \|\| 'manual';/.test(hnd('idAdmit')) && /scan\(code, \{ method: how,/.test(hnd('idAdmit')) && /identify\(code, \{ method: how \}\)/.test(hnd('idAdmit')));
        check('RELEASE GATE UI: ADMIT ONE MORE and the override re-send the method of the result',
            /method: \(st\.last && st\.last\._method\) \|\| 'manual'/.test(hnd('admitMore')) && /method: \(st\.last && st\.last\._method\) \|\| 'manual'/.test(hnd('overrideAdmit')));
    } else skip('RELEASE GATE UI', 'no admin v2 Event Day on this line');

    // ---------------------------------------------------------------- boot
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-doors-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '',
        GOOGLE_SHEETS_WEBHOOK: '',
        JWT_SECRET: 'door-hardening-test-secret',
        NODE_ENV: 'test',
        MEDX_VERIFIED_EMAIL_GATE: '',
    };
    const procs = [];
    const boot = (dir, port, extra) => {
        const p = spawn('node', ['server.js'], { cwd: path.join(ROOT, dir), env: { ...env, ...(extra || {}), PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errbuf = '';
        p.stderr.on('data', (d) => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        p._errbuf = () => errbuf;
        procs.push(p);
        return p;
    };
    let tdb = null;
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { if (tdb) tdb.close(); } catch (e) {}
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        let userProc = boot('user-portal/backend', USER_PORT);
        await waitUp(USER);
        boot('admin-portal/backend', ADMIN_PORT);
        await waitUp(ADMIN);

        // The scratch file, opened the same way the servers open it (libsql, local file).
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        tdb = new Database(dbPath);
        try { tdb.exec('PRAGMA busy_timeout = 5000'); } catch (e) {}
        const put = (sql, args) => tdb.prepare(sql).run(...(args || []));
        const galaRow = (o) => {
            const id = o.id || crypto.randomUUID();
            put(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, amount_paid, pricing, admin_notes, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                [id, o.first || 'QA', o.last || 'Guest', o.email, 'QA', o.status, o.pay, o.amount == null ? 0 : o.amount, o.pricing || null, 'door-hardening test row', new Date().toISOString()]);
            if (o.invoice) put('UPDATE gala_registrations SET invoice_number = ? WHERE id = ?', [o.invoice, id]);
            return id;
        };

        // admin login (the founder's seeded password is replaced by the one-time unlock on a fresh DB)
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'admin123' } });
        if (!(r.status === 200 && r.d && r.d.token)) r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'vp@medx.hr', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('boot: seeded admin login', !!atok, r.status);

        // a conference + a €0 ticket for the conference-side probes
        r = await api(ADMIN, '/api/admin/conferences', { method: 'POST', token: atok, body: { name: 'Door Hardening Conf', year: 2026 } });
        const confId = r.d && r.d.id;
        r = await api(ADMIN, `/api/admin/conferences/${confId}/tickets`, { method: 'POST', token: atok, body: { name: 'General', price_regular: 0 } });
        const ticketId = r.d && r.d.id;
        check('boot: conference + ticket type', !!confId && !!ticketId);

        const register = async (email, first) => {
            const rr = await api(USER, '/api/auth/register', { method: 'POST', body: { email, password: 'door-test-pass-9', first_name: first || 'Door', last_name: 'Probe' } });
            return rr.d && rr.d.token;
        };
        const confReg = async (token) => (await api(ADMIN, '/api/registrations', { method: 'POST', token, body: { conference_id: confId, ticket_type_id: ticketId } })).d || {};
        const publicGala = async (email, first) => {
            await api(USER, '/api/gala/register', { method: 'POST', body: { first_name: first || 'Pub', last_name: 'Guest', email, institution: 'QA', pricing: 'gala' } });
            const l = await api(ADMIN, '/api/admin/gala/registrations', { token: atok });
            return (Array.isArray(l.d) ? l.d : []).find(x => String(x.email || '').toLowerCase() === email.toLowerCase());
        };
        const markPaid = async (id) => (await api(ADMIN, '/api/admin/registrant/gala/' + id + '/mark-paid', { method: 'POST', token: atok })).status === 200;
        const scan = (body) => api(ADMIN, '/api/v2/eventday/scan', { method: 'POST', token: atok, body });
        const verify = (body) => api(ADMIN, '/api/admin/checkin/verify', { method: 'POST', token: atok, body });
        const ticket = (body) => api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body });
        const galaCheckin = (code) => api(ADMIN, '/api/admin/gala/checkin', { method: 'POST', token: atok, body: { code } });
        const universal = (code) => api(ADMIN, '/api/checkin', { method: 'POST', token: atok, body: { code } });
        const lookup = (body) => api(ADMIN, '/api/v2/eventday/lookup', { method: 'POST', token: atok, body });

        // ============================================================ 1. stripped + bare e-mail
        const payerEmail = 'door.payer+' + Date.now() + '@example.com';
        const payerTok = await register(payerEmail, 'Payer');
        const payerReg = await confReg(payerTok);
        check('setup: payer conference registration', !!payerReg.registration_id);
        const H4 = String(payerReg.registration_id || '').replace(/-/g, '').slice(0, 4);
        const stripped = H4 + '@zz.rst';            // strips to exactly the 4 hex chars of a real id
        r = await ticket({ code: stripped, event: 'conference', mark: false, method: 'qr' });
        check('1 stripped e-mail scanned at /checkin/ticket → invalid (was a prefix match)', r.d && r.d.result === 'invalid', r.d && r.d.result);
        r = await ticket({ code: stripped, event: 'conference', mark: false, method: 'manual' });
        check('1 stripped e-mail TYPED at /checkin/ticket → invalid (an @ is never a short code)', r.d && r.d.result === 'invalid', r.d && r.d.result);
        r = await ticket({ code: 'Deborah', event: 'conference', mark: false, method: 'manual' });
        check('1 a typed name is never stripped to hex ("deba") and prefix-matched', r.d && r.d.result === 'invalid', r.d && r.d.result);
        const hex8 = String(payerReg.registration_id).replace(/-/g, '').slice(0, 8);
        r = await ticket({ code: hex8.toUpperCase(), event: 'conference', mark: false, method: 'manual' });
        check('1 the typed 8-character short code (as printed, upper case) resolves', r.d && r.d.result === 'valid' && r.d.ticket && r.d.ticket.registration_id === payerReg.registration_id, r.d && r.d.result);
        r = await ticket({ code: 'PLX26-' + hex8, event: 'conference', mark: false, method: 'manual' });
        check('1 a letter prefix is never dropped: a typed PLX26-<short code> → invalid (no printed code carries one)', r.d && r.d.result === 'invalid', r.d && r.d.result);

        // a paid public gala seat on the payer's address (bare e-mail probes)
        const payerGala = await publicGala(payerEmail, 'Payer');
        await markPaid(payerGala && payerGala.id);
        r = await verify({ event: 'gala', code: payerEmail, mark: false });
        check('1 bare e-mail scanned at the legacy gala verify → not_found', r.d && r.d.valid === false && r.d.reason === 'not_found', r.d && r.d.reason);
        r = await verify({ event: 'gala', code: payerEmail, mark: false, method: 'manual' });
        check('1 the same e-mail TYPED at the legacy gala verify → valid', r.d && r.d.valid === true, r.d && (r.d.reason || r.d.status_label));
        r = await verify({ event: 'conference', code: stripped, mark: false });
        check('1 stripped e-mail at the legacy conference verify → not_found', r.d && r.d.valid === false && r.d.reason === 'not_found', r.d && r.d.reason);
        if (HAS_EVENTDAY) {
            r = await scan({ event: 'gala', code: payerEmail, method: 'qr' });
            check('1 bare e-mail scanned at the v2 Event Day gala door → not_found', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && r.d.result);
            r = await scan({ event: 'gala', code: payerEmail });
            check('1 no method given → a scan → not_found', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && r.d.result);
            r = await scan({ event: 'gala', code: JSON.stringify({ type: 'MEDX_MEMBER', email: payerEmail }), method: 'qr' });
            check('1 a JSON QR carrying only an e-mail → not_found (an e-mail is not a credential)', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && r.d.result);
            r = await scan({ event: 'conference', code: stripped, method: 'qr' });
            check('1 stripped e-mail scanned at the v2 conference door → not_found', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && r.d.result);
            r = await lookup({ code: payerEmail });
            check('1 ID-check lookup of a scanned bare e-mail (no method) → not_found', r.d && r.d.ok === false, r.d && r.d.result);
            r = await lookup({ code: payerEmail, method: 'qr' });
            check('1 ID-check lookup of a scanned bare e-mail (method qr, what the camera sends) → not_found', r.d && r.d.ok === false, r.d && r.d.result);
            r = await lookup({ code: payerEmail, method: 'manual' });
            check('RELEASE GATE: ID-check lookup of a TYPED e-mail (method manual) → the person and their gala door', r.d && r.d.ok === true && (r.d.doors || []).some(d => d.event === 'gala' && d.ok), JSON.stringify(r.d && r.d.doors).slice(0, 120));
            r = await lookup({ code: hex8.toUpperCase(), method: 'manual' });
            check('RELEASE GATE: ID-check lookup of a TYPED short code (method manual) → the person and their conference door', r.d && r.d.ok === true && (r.d.doors || []).some(d => d.event === 'conference' && d.ok), JSON.stringify(r.d && r.d.doors).slice(0, 120));
            r = await scan({ event: 'gala', code: payerEmail, method: 'manual' });
            check('1 the same e-mail TYPED at the v2 gala door → admitted', r.d && r.d.ok === true, r.d && r.d.result);
            // the one-QR hop is untouched: a conference ticket token opens the gala door when a paid seat exists
            const tokRow = tdb.prepare('SELECT checkin_token FROM registrations WHERE id = ?').get(payerReg.registration_id);
            if (tokRow && tokRow.checkin_token) {
                r = await scan({ event: 'gala', code: tokRow.checkin_token, method: 'qr' });
                check('1 one-QR hop kept: conference token at the gala door → the paid seat (already in)', r.d && ['party_complete', 'over_capacity', 'admitted'].includes(r.d.result), r.d && r.d.result);
            }

            // the door-staff page (tokenized, no login)
            r = await api(ADMIN, '/api/v2/eventday/door-tokens', { method: 'POST', token: atok, body: { event: 'gala' } });
            const doorTok = r.d && r.d.url && r.d.url.split('/api/v2/door/')[1];
            check('door page: token minted', !!doorTok);
            if (doorTok) {
                const page = await api(ADMIN, '/api/v2/door/' + doorTok);
                const js = (page.text.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
                let compiles = false; try { new Function(js); compiles = true; } catch (e) {}
                check('door page: inline script compiles', page.status === 200 && js.length > 500 && compiles);
                check('door page: camera sends qr, typed form sends manual, the queue keeps the method',
                    /send\(hit\.data,1,'qr'\)/.test(js) && /send\(v,1,'manual'\)/.test(js) && /method:item\.method==='manual'\?'manual':'qr'/.test(js));
                r = await api(ADMIN, '/api/v2/door/' + doorTok + '/scan', { method: 'POST', body: { code: payerEmail } });
                check('door page: a scanned bare e-mail → not_found', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && r.d.result);
            }
        } else skip('1 v2 Event Day probes', 'no admin-portal/backend/v2/event-day.js on this line');

        // ============================================================ 2. unpaid gala row
        const unpaidEmail = 'door.unpaid+' + Date.now() + '@example.com';
        const unpaidTok = await register(unpaidEmail, 'Unpaid');
        const unpaidReg = await confReg(unpaidTok);
        const unpaidGala = await publicGala(unpaidEmail, 'Unpaid');
        check('setup: unpaid gala row', !!unpaidGala && unpaidGala.payment_status !== 'paid', unpaidGala && unpaidGala.payment_status);
        r = await api(ADMIN, '/api/admin/checkin/resolve?code=' + unpaidReg.registration_id, { token: atok });
        check('2 unpaid: the one pass lists no gala', r.d && r.d.ticket && !r.d.ticket.events.includes('gala'), r.d && r.d.ticket && r.d.ticket.events.join(','));
        r = await ticket({ code: unpaidReg.registration_id, event: 'gala', mark: true });
        check('2 unpaid: conference ticket at the gala gate → wrong_event (was admitted)', r.d && r.d.valid === false && r.d.result === 'wrong_event', r.d && r.d.result);
        r = await verify({ event: 'gala', code: unpaidGala.id, mark: true });
        check('2 unpaid: legacy gala verify → not_paid', r.d && r.d.valid === false && r.d.reason === 'not_paid', r.d && r.d.reason);
        r = await galaCheckin(unpaidGala.id);
        check('2 unpaid: /api/admin/gala/checkin → not_paid', r.d && r.d.success === false && r.d.reason === 'not_paid', r.d && r.d.reason);
        r = await universal(JSON.stringify({ evt: 'gala', regId: unpaidGala.id }));
        check('2 unpaid: universal /api/checkin → 403', r.status === 403, r.status);
        if (HAS_EVENTDAY) {
            r = await scan({ event: 'gala', code: unpaidGala.id, method: 'qr' });
            check('2 unpaid: v2 gala door → not_paid', r.d && r.d.ok === false && r.d.result === 'not_paid', r.d && r.d.result);
            r = await scan({ event: 'gala', code: unpaidReg.registration_id, method: 'qr' });
            check('2 unpaid: conference ticket at the v2 gala door → refused', r.d && r.d.ok === false && ['not_paid', 'wrong_event'].includes(r.d.result), r.d && r.d.result);
        }
        const unpaidAfter = tdb.prepare('SELECT checked_in FROM gala_registrations WHERE id = ?').get(unpaidGala.id);
        check('2 unpaid: the row was never checked in', unpaidAfter && !Number(unpaidAfter.checked_in));

        // invoice path + a dead status
        const invId = galaRow({ email: 'door.invoice@example.com', status: 'approved', pay: 'pending', amount: 150, pricing: 'invoice' });
        r = await verify({ event: 'gala', code: invId, mark: false });
        check('2 invoice path (approved + pending, amount recorded) → not_paid', r.d && r.d.reason === 'not_paid', r.d && r.d.reason);
        const rejId = galaRow({ email: 'door.rejected@example.com', status: 'rejected', pay: 'paid', amount: 150 });
        r = await galaCheckin(rejId);
        check('2 rejected but paid → refused at /api/admin/gala/checkin', r.d && r.d.success === false && r.d.reason === 'cancelled', r.d && r.d.reason);
        if (HAS_EVENTDAY) {
            r = await scan({ event: 'gala', code: rejId, method: 'qr' });
            check('2 rejected but paid → refused at the v2 gala door', r.d && r.d.ok === false && r.d.result === 'cancelled', r.d && r.d.result);
        }

        // ============================================================ 3 + 4. comped and waived rows admitted
        const admittedAtEveryGalaDoor = async (label, id) => {
            let x = await verify({ event: 'gala', code: id, mark: false });
            check(label + ' → legacy gala verify valid', x.d && x.d.valid === true, x.d && (x.d.reason || x.d.status_label));
            x = await universal(JSON.stringify({ evt: 'gala', regId: id }));
            check(label + ' → universal /api/checkin success', x.status === 200 && x.d && x.d.success === true, x.status + ' ' + (x.d && (x.d.error || '')));
            if (HAS_EVENTDAY) {
                x = await scan({ event: 'gala', code: id, method: 'qr' });
                check(label + ' → v2 gala door admitted', x.d && x.d.ok === true, x.d && x.d.result);
            }
        };
        const compId = galaRow({ first: 'Fellow', email: 'door.fellow@example.com', status: 'confirmed', pay: 'comp', pricing: 'fellowship' });
        await admittedAtEveryGalaDoor('3 comped (comp) Fellowship seat', compId);
        const compId2 = galaRow({ first: 'Speaker', email: 'door.speaker.seat@example.com', status: 'confirmed', pay: 'comp' });
        r = await galaCheckin(compId2);
        check('3 comped seat → /api/admin/gala/checkin success (was not_paid)', r.d && r.d.success === true, r.d && (r.d.reason || ''));
        const vipId = galaRow({ first: 'Vip', email: 'door.vip@example.com', status: 'confirmed', pay: 'vip-comp' });
        await admittedAtEveryGalaDoor('3 VIP invite seat (vip-comp)', vipId);
        const waivedId = galaRow({ first: 'Waived', email: 'door.waived@example.com', status: 'confirmed', pay: 'waived' });
        await admittedAtEveryGalaDoor('4 waived seat', waivedId);
        const waivedId2 = galaRow({ first: 'Waived2', email: 'door.waived2@example.com', status: 'confirmed', pay: 'waived' });
        r = await galaCheckin(waivedId2);
        check('4 waived seat → /api/admin/gala/checkin success (was not_paid)', r.d && r.d.success === true, r.d && (r.d.reason || ''));

        // the speaker ticket model: a conference registration that includes the Gala, payment waived
        const spkEmail = 'door.speaker+' + Date.now() + '@example.com';
        const spkTok = await register(spkEmail, 'Speaker');
        const spkReg = await confReg(spkTok);
        put("UPDATE registrations SET includes_gala = 1, payment_status = 'waived', status = 'confirmed' WHERE id = ?", [spkReg.registration_id]);
        r = await ticket({ code: spkReg.registration_id, event: 'gala', mark: true });
        check('3 comped speaker (conference ticket, includes Gala, waived) → gala gate valid', r.d && r.d.valid === true && r.d.result === 'valid', r.d && r.d.result);
        if (HAS_EVENTDAY) {
            r = await scan({ event: 'gala', code: spkReg.registration_id, method: 'qr' });
            check('3 comped speaker → v2 gala door admitted', r.d && r.d.ok === true, r.d && r.d.result);
        }
        // the same model UNPAID never opens the gala
        const freeEmail = 'door.bundle+' + Date.now() + '@example.com';
        const freeReg = await confReg(await register(freeEmail, 'Bundle'));
        put("UPDATE registrations SET includes_gala = 1, payment_status = 'pending' WHERE id = ?", [freeReg.registration_id]);
        r = await ticket({ code: freeReg.registration_id, event: 'gala', mark: false });
        check('3 includes_gala on an UNPAID ticket → wrong_event (was admitted)', r.d && r.d.result === 'wrong_event', r.d && r.d.result);

        // a waived gala seat reached through the one pass (passAccess)
        const wEmail = 'door.waivedpass+' + Date.now() + '@example.com';
        const wReg = await confReg(await register(wEmail, 'WaivedPass'));
        galaRow({ first: 'WaivedPass', email: wEmail, status: 'confirmed', pay: 'waived' });
        r = await ticket({ code: wReg.registration_id, event: 'gala', mark: false });
        check('4 waived gala seat → the one pass opens the gala gate', r.d && r.d.result === 'valid', r.d && r.d.result);

        if (HAS_GALAOPS) {
            for (const kind of ['vip', 'sponsor']) {
                r = await api(ADMIN, '/api/v2/gala-ops/registrations', { method: 'POST', token: atok, body: { name: 'Door ' + kind, email: 'door.' + kind + '.ops@example.com', kind } });
                const gid = r.d && r.d.registration && r.d.registration.id;
                check('3 gala-ops ' + kind + ' seat created', !!gid, JSON.stringify(r.d).slice(0, 100));
                if (gid) await admittedAtEveryGalaDoor('3 gala-ops ' + kind + ' seat', gid);
            }
        } else skip('3 gala-ops VIP and sponsor seats', 'no admin-portal/backend/v2/gala-ops.js on this line');

        // ============================================================ 6. a typed invoice number never resolves by id prefix
        // Live invoice formats: GALA26-NNNN, CA-GALA-2026-NNNN, INV-<digits>-<hex>, PLX26-NNNNNN. Each holds a
        // letter outside hex. The old strip turned GALA26-0041 into 0041 and matched Bob Other, a paid seat
        // whose id starts 00410000 and whose own invoice is GALA26-0007.
        const bobEmail = 'bob.other+' + Date.now() + '@example.com';
        const bobId = '00410000-' + crypto.randomUUID().slice(9);
        galaRow({ id: bobId, first: 'Bob', last: 'Other', email: bobEmail, status: 'confirmed', pay: 'paid', amount: 150, invoice: 'GALA26-0007' });
        r = await verify({ event: 'gala', code: 'GALA26-0041', mark: false, method: 'manual' });
        check('6 typed GALA26-0041 at the legacy gala verify → not_found', r.d && r.d.valid === false && r.d.reason === 'not_found', r.d && (r.d.reason || r.d.status_label));
        if (HAS_EVENTDAY) {
            r = await lookup({ code: 'GALA26-0041', method: 'manual' });
            check('6 typed GALA26-0041 at the ID-check lookup → not_found (was Bob Other)', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && (r.d.result || (r.d.person && r.d.person.name)));
            r = await scan({ event: 'gala', code: 'GALA26-0041', method: 'manual' });
            check('6 typed GALA26-0041 at the v2 gala door → not_found (was Bob Other, admitted)', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && (r.d.result + ' ' + ((r.d.ticket && r.d.ticket.name) || '')));
            r = await lookup({ code: 'CA-GALA-2026-0041', method: 'manual' });
            check('6 typed CA-GALA-2026-0041 at the ID-check lookup → not_found', r.d && r.d.ok === false, r.d && r.d.result);
            r = await lookup({ code: '00410000', method: 'manual' });
            check('RELEASE GATE: the typed short code of the seat (00410000) still resolves at the ID-check lookup', r.d && r.d.ok === true && r.d.person && r.d.person.email === bobEmail, r.d && (r.d.result || (r.d.person && r.d.person.email)));
        }
        const bobAfter = tdb.prepare('SELECT checked_in FROM gala_registrations WHERE id = ?').get(bobId);
        check('6 Bob Other was never checked in', bobAfter && !Number(bobAfter.checked_in));
        // the same trap on the registrations table (resolveRegFromCode → doorTypedShortCode)
        const plxReg = await confReg(await register('door.plx+' + Date.now() + '@example.com', 'Plx'));
        const plxId = '12345600-' + crypto.randomUUID().slice(9);
        put('UPDATE registrations SET id = ? WHERE id = ?', [plxId, plxReg.registration_id]);
        r = await ticket({ code: 'PLX26-123456', event: 'conference', mark: false, method: 'manual' });
        check('6 typed PLX26-123456 at /checkin/ticket → invalid (was the registration 12345600-…)', r.d && r.d.result === 'invalid', r.d && (r.d.result + ' ' + ((r.d.ticket && r.d.ticket.registration_id) || '')));
        r = await api(ADMIN, '/api/admin/checkin/resolve?method=manual&code=PLX26-123456', { token: atok });
        check('6 typed PLX26-123456 at /checkin/resolve → not found', r.d && r.d.found === false, JSON.stringify(r.d).slice(0, 100));
        if (HAS_EVENTDAY) {
            r = await scan({ event: 'conference', code: 'PLX26-123456', method: 'manual' });
            check('6 typed PLX26-123456 at the v2 conference door → not_found', r.d && r.d.ok === false && r.d.result === 'not_found', r.d && r.d.result);
        }
        r = await ticket({ code: '12345600', event: 'conference', mark: false, method: 'manual' });
        check('6 the typed short code 12345600 still resolves that registration', r.d && r.d.result === 'valid' && r.d.ticket && r.d.ticket.registration_id === plxId, r.d && r.d.result);

        // ============================================================ 5. unverified account (D17)
        // The member reads run on both lines. The v2 wallet, the member QR and the ticket PDF only where
        // they exist (the redesign line).
        {
            const uEmail ='door.unverified+' + Date.now() + '@example.com';
            const uTok = await register(uEmail, 'Unverified');
            check('5 setup: unverified signup gets a session token', !!uTok);
            // With no mail provider a scratch signup is born verified; production (a provider set)
            // creates it unverified. Put the scratch account in the production state.
            put('UPDATE users SET email_verified = 0 WHERE lower(email) = ?', [uEmail.toLowerCase()]);
            const uOwnReg = await confReg(uTok);                         // linked by user_id
            const uGala = await publicGala(uEmail, 'Unverified');        // linked by e-mail only
            await markPaid(uGala && uGala.id);
            const vEmail = 'door.verified+' + Date.now() + '@example.com';
            const vTok = await register(vEmail, 'Verified');
            put('UPDATE users SET email_verified = 1 WHERE lower(email) = ?', [vEmail.toLowerCase()]);
            const vGala = await publicGala(vEmail, 'Verified');
            await markPaid(vGala && vGala.id);
            const uVer = tdb.prepare('SELECT email_verified FROM users WHERE lower(email) = ?').get(uEmail.toLowerCase());
            check('5 setup: the account is unverified', uVer && Number(uVer.email_verified) !== 1);
            // a second unverified account with NO registration of its own: its member QR is built
            // from the e-mail-linked seat alone, so the QR shows what the gate does
            const qEmail = 'door.qronly+' + Date.now() + '@example.com';
            const qTok = await register(qEmail, 'QrOnly');
            put('UPDATE users SET email_verified = 0 WHERE lower(email) = ?', [qEmail.toLowerCase()]);
            const qGala = await publicGala(qEmail, 'QrOnly');
            await markPaid(qGala && qGala.id);
            // the member reads beside the wallet: a table from the picker console (e-mail keyed) for
            // the unverified account, a seat in the seating plan for the QR-only account, and a public
            // /plexus-form conference place (croatians_abroad_registrations) for a third unverified account
            put('INSERT INTO gala_table_assignments (id, email, table_no, guest_name, updated_at) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), uEmail.toLowerCase(), '7', 'Unverified Probe', new Date().toISOString()]);
            put('INSERT INTO gala_table_assignments (id, email, table_no, guest_name, updated_at) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), vEmail.toLowerCase(), '9', 'Verified Probe', new Date().toISOString()]);
            const tblId = crypto.randomUUID();
            put('INSERT INTO gala_tables (id, label, capacity) VALUES (?,?,?)', [tblId, 'Table Q', 10]);
            put('INSERT INTO gala_seat_assignments (id, table_id, registration_id) VALUES (?,?,?)', [crypto.randomUUID(), tblId, qGala.id]);
            const cEmail = 'door.caonly+' + Date.now() + '@example.com';
            const cTok = await register(cEmail, 'CaOnly');
            put('UPDATE users SET email_verified = 0 WHERE lower(email) = ?', [cEmail.toLowerCase()]);
            const caId = crypto.randomUUID();
            put(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, conference_status, source, created_at)
                 VALUES (?,?,?,?,?,?,?,?)`, [caId, 'CaOnly', 'Probe', cEmail, 1, 'confirmed', 'plexus', new Date().toISOString()]);
            // a paid gala seat the same unverified account owns by user_id (bought while signed in): the gate
            // hides e-mail-linked rows only, so this one stays visible with the gate ON
            const cUser = tdb.prepare('SELECT id FROM users WHERE lower(email) = ?').get(cEmail.toLowerCase());
            const cOwnGala = galaRow({ email: cEmail, first: 'CaOnly', status: 'confirmed', pay: 'paid', amount: 150 });
            put('UPDATE gala_registrations SET user_id = ? WHERE id = ?', [cUser && cUser.id, cOwnGala]);
            const evIds = (d) => [...((d && d.upcoming) || []), ...((d && d.past) || [])].map(i => i.id);
            const memberReads = async (label, on) => {
                const hide = (cond) => on ? !cond : cond;   // OFF: the row shows. ON: it is hidden.
                let x = await api(USER, '/api/gala/my-status', { token: uTok });
                check(label + ' /api/gala/my-status ' + (on ? 'hides' : 'shows') + ' the e-mail-linked seat', hide(x.d && x.d.registered === true && x.d.registration && x.d.registration.id === uGala.id), JSON.stringify(x.d).slice(0, 90));
                x = await api(USER, '/api/gala/my', { token: uTok });
                check(label + ' /api/gala/my ' + (on ? 'hides' : 'shows') + ' the e-mail-linked seat', hide(Array.isArray(x.d) && x.d.some(g => g.id === uGala.id)), Array.isArray(x.d) ? x.d.length : x.status);
                x = await api(USER, '/api/gala/my-seat', { token: uTok });
                check(label + ' /api/gala/my-seat ' + (on ? 'hides' : 'shows') + ' the table from the picker console (by e-mail)', hide(x.d && x.d.assigned === true && x.d.table_label === 'Stol 7'), JSON.stringify(x.d));
                x = await api(USER, '/api/gala/my-seat', { token: qTok });
                check(label + ' /api/gala/my-seat ' + (on ? 'hides' : 'shows') + ' the seating-plan table of the e-mail-linked seat', hide(x.d && x.d.assigned === true && x.d.table_label === 'Table Q'), JSON.stringify(x.d));
                x = await api(USER, '/api/my/events', { token: uTok });
                check(label + ' /api/my/events ' + (on ? 'hides' : 'shows') + ' the e-mail-linked seat', hide(evIds(x.d).includes(uGala.id)), evIds(x.d).length);
                check(label + ' /api/my/events keeps the account\'s own user_id-linked registration', evIds(x.d).includes(uOwnReg.registration_id));
                x = await api(USER, '/api/gala/my-status', { token: cTok });
                check(label + ' /api/gala/my-status keeps the seat the account owns by user_id', x.d && x.d.registration && x.d.registration.id === cOwnGala, JSON.stringify(x.d).slice(0, 90));
                x = await api(USER, '/api/my/events', { token: cTok });
                check(label + ' /api/my/events keeps the gala seat the account owns by user_id', evIds(x.d).includes(cOwnGala), evIds(x.d).length);
                if (HAS_CA_MYREG) {
                    x = await api(USER, '/api/plexus/my-registration', { token: cTok });
                    check(label + ' /api/plexus/my-registration ' + (on ? 'hides' : 'shows') + ' the e-mail-linked /plexus-form place', hide(x.d && x.d.ca === true && x.d.id === caId), JSON.stringify(x.d).slice(0, 90));
                } else skip(label + ' /api/plexus/my-registration', 'this line reads the Plexus place by user_id only, so no e-mail-linked /plexus-form row can show');
            };

            const ids = (d) => ((d && d.items) || []).map(i => i.id);
            const NO_WALLET = 'no user-portal/backend/v2/wallet.js on this line (main serves no v2 member wallet)';
            if (HAS_WALLET) {
                r = await api(USER, '/api/v2/wallet/tickets', { token: uTok });
                check('5 gate OFF (default): unverified account sees the e-mail-linked gala ticket', ids(r.d).includes(uGala.id), ids(r.d).length);
                check('5 gate OFF: no needs_verification flag', r.d && r.d.needs_verification === undefined);
                r = await api(USER, '/api/v2/wallet/member', { token: qTok });
                check('5 gate OFF: the member QR encodes the e-mail-linked seat', r.d && r.d.qr && r.d.qr.kind === 'registration' && r.d.qr.reg_id === qGala.id, JSON.stringify(r.d && r.d.qr));
            } else skip('5 gate OFF: the wallet and the member QR', NO_WALLET);
            await memberReads('5 gate OFF:', false);

            // switch the gate ON: restart the member backend on the same scratch file
            try { userProc.kill('SIGKILL'); } catch (e) {}
            await waitDown(USER_PORT);
            userProc = boot('user-portal/backend', USER_PORT, { MEDX_VERIFIED_EMAIL_GATE: '1' });
            await waitUp(USER);
            if (HAS_WALLET) {
                r = await api(USER, '/api/v2/wallet/tickets', { token: uTok });
                check('5 gate ON: the unverified account no longer sees the e-mail-linked ticket', r.d && !ids(r.d).includes(uGala.id), ids(r.d).join(','));
                check('5 gate ON: its own user_id-linked registration still shows', r.d && ids(r.d).includes(uOwnReg.registration_id));
                check('5 gate ON: the response says needs_verification', r.d && r.d.needs_verification === true);
                r = await api(USER, '/api/v2/wallet/tickets/' + uGala.id + '.pdf', { token: uTok });
                check('5 gate ON: the e-mail-linked ticket PDF is not served (404)', r.status === 404, r.status);
                r = await api(USER, '/api/v2/wallet/member', { token: qTok });
                check('5 gate ON: the member QR falls back to identity (no e-mail-linked seat)', r.d && r.d.qr && r.d.qr.kind === 'identity' && !r.d.qr.reg_id, JSON.stringify(r.d && r.d.qr));
                r = await api(USER, '/api/v2/wallet/tickets', { token: vTok });
                check('5 gate ON: a VERIFIED account keeps its e-mail-linked ticket', r.d && ids(r.d).includes(vGala.id) && r.d.needs_verification === undefined, ids(r.d).join(','));
            } else skip('5 gate ON: the wallet, the member QR and the ticket PDF', NO_WALLET);
            // RELEASE GATE for switching MEDX_VERIFIED_EMAIL_GATE on: every member read agrees with the wallet
            await memberReads('RELEASE GATE D17 · gate ON:', true);
            r = await api(USER, '/api/gala/my-status', { token: vTok });
            check('RELEASE GATE D17 · gate ON: a VERIFIED account keeps its seat in /api/gala/my-status', r.d && r.d.registration && r.d.registration.id === vGala.id, JSON.stringify(r.d).slice(0, 90));
            r = await api(USER, '/api/gala/my', { token: vTok });
            check('RELEASE GATE D17 · gate ON: a VERIFIED account keeps its seat in /api/gala/my', Array.isArray(r.d) && r.d.some(g => g.id === vGala.id));
            r = await api(USER, '/api/gala/my-seat', { token: vTok });
            check('RELEASE GATE D17 · gate ON: a VERIFIED account keeps its table in /api/gala/my-seat', r.d && r.d.assigned === true && r.d.table_label === 'Stol 9', JSON.stringify(r.d));
            r = await api(USER, '/api/my/events', { token: vTok });
            check('RELEASE GATE D17 · gate ON: a VERIFIED account keeps its seat in /api/my/events', evIds(r.d).includes(vGala.id));
        }

        // ============================================================ admin catch-all
        r = await api(ADMIN, '/', { redirect: 'manual' });
        check('catch-all: GET / → 302 to the admin portal (no v1 page)', r.status === 302 && String(r.location || '').startsWith(ADMIN_V2), r.status + ' ' + r.location);
        r = await api(ADMIN, '/some/old-v1-route', { redirect: 'manual' });
        check('catch-all: unknown path → 302 to the admin portal', r.status === 302 && String(r.location || '').startsWith(ADMIN_V2), r.status + ' ' + r.location);
        r = await api(ADMIN, '/api/definitely-not-a-route', { redirect: 'manual' });
        check('catch-all: unknown /api path → JSON 404, never HTML or a redirect', r.status === 404 && r.d && typeof r.d.error === 'string', r.status);
        r = await api(ADMIN, '/missing-file.js', { redirect: 'manual' });
        check('catch-all: a missing file → 404', r.status === 404, r.status);
        r = await api(ADMIN, '/health', { redirect: 'manual' });
        check('catch-all: /health still 200', r.status === 200);
        r = await api(ADMIN, '/vendor/jsqr.min.js', { redirect: 'manual' });
        check('catch-all: static files still served (door scanner jsQR)', r.status === 200 && r.text.length > 1000, r.status);
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
