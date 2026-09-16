/**
 * tests/plexus-pass.test.js — Apple + Google Wallet passes for every Plexus Week ticket
 * (user-portal/backend/plexus-pass.js), no login, Boston-style HMAC tokens.
 *
 * Hermetic: scratch in-memory sqlite carrying the real croatians_abroad_registrations /
 * gala_registrations / ca_registration_guests columns the module reads, a stub express, mock
 * wallet env (a throwaway RSA key), global.fetch disabled. Apple signing is NOT exercised — it
 * needs openssl + the real PEMs — the route is proven up to the 503 gate and the model is
 * asserted field by field.
 *
 * Run:  node tests/plexus-pass.test.js
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- hermetic env
for (const k of Object.keys(process.env)) if (/^(APPLE_WALLET_|GOOGLE_WALLET_|PLEXUS_GOOGLE_)/.test(k)) delete process.env[k];
delete process.env.PUBLIC_BASE_URL;
process.env.RENDER_EXTERNAL_URL = 'https://medx-user-portal.onrender.com';
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const pp = require('../user-portal/backend/plexus-pass.js');
const payLink = require('../user-portal/backend/gala-paylink.js');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

// ---------------------------------------------------------------- scratch sqlite
const raw = new DatabaseSync(':memory:');
raw.exec(`CREATE TABLE croatians_abroad_registrations (
    id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT, country TEXT, dietary TEXT,
    selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0,
    conference_status TEXT, bridges_status TEXT, gala_status TEXT, gala_payment_status TEXT,
    gala_registration_id TEXT, amount_paid REAL, invoice_number TEXT, guest_count INTEGER DEFAULT 0, source TEXT)`);
raw.exec(`CREATE TABLE gala_registrations (
    id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT,
    status TEXT, payment_status TEXT, amount_paid REAL, invoice_number TEXT, guest_count INTEGER DEFAULT 0, seat_number TEXT)`);
raw.exec(`CREATE TABLE ca_registration_guests (id TEXT PRIMARY KEY, registration_id TEXT, name TEXT, institution TEXT, email TEXT)`);
const query = {
    get: (sql, params = []) => { const r = raw.prepare(sql).get(...params); return r === undefined ? null : r; },
    all: (sql, params = []) => raw.prepare(sql).all(...params)
};
const run = (sql, params = []) => raw.prepare(sql).run(...params);

// Ana-shaped fixture: conference + bridges + gala, party of 2, paid €300, one named guest.
const CA = '16085925-6d6b-44be-8f85-68eefcbdc721', GALA = '88ee6223-f4c6-4296-88c0-05933eb5d4d5', GUEST = 'aaaaaaaa-1111-4222-8333-444444444444';
run(`INSERT INTO croatians_abroad_registrations VALUES (?, 'Ana','Franceschi','franceschi.am@gmail.com','Northwell Health','United States',NULL, 1,1,1, 'pre-registered','pre-registered','confirmed','paid', ?, 300, 'GALA26-0041', 1, 'plexus')`, [CA, GALA]);
run(`INSERT INTO gala_registrations VALUES (?, 'Ana','Franceschi','franceschi.am@gmail.com','Northwell Health','confirmed','paid',300,'GALA26-0041',1,NULL)`, [GALA]);
run(`INSERT INTO ca_registration_guests VALUES (?, ?, 'Emeric du Mas de Paysac','Sorbonne','emericdumas@gmail.com')`, [GUEST, CA]);
// Unpaid party (approved, awaiting payment) — not a ticket yet
const CA2 = '22222222-2222-4222-8222-222222222222', GALA2 = '33333333-3333-4333-8333-333333333333';
run(`INSERT INTO croatians_abroad_registrations VALUES (?, 'Toi','Masakazu','masakazut98@gmail.com','TMCIDC','Japan',NULL, 1,1,1, 'pre-registered','pre-registered','awaiting_payment','pending', ?, NULL, NULL, 1, 'plexus')`, [CA2, GALA2]);
run(`INSERT INTO gala_registrations VALUES (?, 'Masakazu','Toi','masakazut98@gmail.com','TMCIDC','approved','pending',300,'GALA26-0038',1,NULL)`, [GALA2]);
// Free events only (conference + bridges), no gala
const CA3 = '44444444-4444-4444-8444-444444444444';
run(`INSERT INTO croatians_abroad_registrations VALUES (?, 'Iva','Free','iva@example.org','Uni','Croatia','Vegan', 1,1,0, 'pre-registered','pre-registered',NULL,NULL, NULL, NULL, NULL, 0, 'plexus')`, [CA3]);
// Standalone gala (no CA row), vip-comp, table assigned
const GALA4 = '55555555-5555-4555-8555-555555555555';
run(`INSERT INTO gala_registrations VALUES (?, 'Lord','Smith','lord@example.org','Cambridge','vip-comp','vip-comp',0,NULL,0,'7')`, [GALA4]);
// Cancelled paid row — no pass
const GALA5 = '66666666-6666-4666-8666-666666666666';
run(`INSERT INTO gala_registrations VALUES (?, 'Gone','Away','gone@example.org','X','cancelled','paid',150,'GALA26-0001',0,NULL)`, [GALA5]);
// Held (pending-review) free row — not released → no pass
const CA6 = '77777777-7777-4777-8777-777777777777';
run(`INSERT INTO croatians_abroad_registrations VALUES (?, 'Held','Row','held@example.org','Uni','Nigeria',NULL, 1,0,0, 'pending-review',NULL,NULL,NULL, NULL, NULL, NULL, 0, 'plexus')`, [CA6]);

const SECRET = 'plexus-pass-test-secret';

// ---------------------------------------------------------------- stub express
function makeApp() { const routes = {}; const reg = m => (p, ...h) => { routes[m + ' ' + p] = h[h.length - 1]; }; return { get: reg('GET'), post: reg('POST'), routes }; }
function makeRes() {
    const r = { statusCode: 200, headers: {}, body: undefined };
    const res = {
        status(c) { r.statusCode = c; return res; }, json(o) { r.body = o; return res; }, send(x) { r.body = x; return res; },
        set(k, v) { r.headers[String(k).toLowerCase()] = v; return res; }, setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; },
        redirect(code, url) { r.statusCode = code; r.headers.location = url; }, get headersSent() { return false; }, _r: r
    };
    return res;
}
async function call(app, method, p, { params, query: qs } = {}) {
    const h = app.routes[method + ' ' + p];
    if (!h) throw new Error('route not mounted: ' + method + ' ' + p);
    const res = makeRes();
    await h({ params: params || {}, query: qs || {}, get: () => '' }, res);
    return res._r;
}
const logs = [];
const app = makeApp();
const mounted = pp(app, { query, JWT_SECRET: SECRET, log: (...a) => logs.push(a.join(' ')) });

// The /qr/:id.png route's croatians_abroad branch, in the exact shape server.js paints it.
function qrRouteShape(ca) {
    const events = [ca.selected_conference ? 'conference' : null, ca.selected_bridges ? 'bridges' : null, ca.selected_gala ? 'gala' : null].filter(Boolean);
    const p = { type: 'MEDX_MEMBER', caRegId: ca.id, regId: ca.gala_registration_id || ca.id, email: ca.email,
        name: `${ca.first_name} ${ca.last_name || ''}`.trim(), evt: ca.selected_gala ? 'gala' : 'croatians-abroad',
        evtName: ca.selected_gala ? 'Plexus 2026 — Gala Evening' : 'Plexus 2026', events };
    if (ca.amount_paid) p.amt = ca.amount_paid;
    if (ca.dietary) p.diet = ca.dietary;
    return JSON.stringify(p);
}

(async () => {
    console.log('plexus-pass.test.js — hermetic (scratch sqlite, stub express, mock wallet env, no network)\n');

    // ==================== tokens ====================
    await t('tokens: mint/verify round-trips for every kind; forged sig, wrong kind, tampered id → null', () => {
        for (const kind of pp.KINDS) {
            const tok = pp.passToken(SECRET, kind, GALA);
            assert.ok(/^[0-9a-f]{32}\.(gala|ca|guest)\.[0-9a-f-]+$/.test(tok), 'shape: ' + tok);
            assert.deepStrictEqual(pp.verifyPassToken(SECRET, tok), { kind, id: GALA });
        }
        const good = pp.passToken(SECRET, 'gala', GALA);
        assert.strictEqual(pp.verifyPassToken(SECRET, 'f'.repeat(32) + good.slice(32)), null, 'forged signature');
        assert.strictEqual(pp.verifyPassToken('other-secret', good), null, 'another secret');
        assert.strictEqual(pp.verifyPassToken(SECRET, good.replace('.gala.', '.ca.')), null, 'kind swapped under the same sig');
        assert.strictEqual(pp.verifyPassToken(SECRET, good.slice(0, -1) + (good.endsWith('1') ? '2' : '1')), null, 'id tampered');
        assert.strictEqual(pp.verifyPassToken(SECRET, good.replace('.gala.', '.member.')), null, 'unknown kind');
        assert.strictEqual(pp.verifyPassToken(SECRET, ''), null);
        assert.throws(() => pp.passToken(SECRET, 'member', GALA), /unknown kind/);
    });

    // ==================== resolving the ticket ====================
    await t('gala kind on a paid Zagreb row = the COMBINED ticket: all legs, party 2, same QR as the emailed image', () => {
        const tk = pp.resolveTicket(query, 'gala', GALA);
        assert.ok(tk, 'resolved');
        assert.deepStrictEqual(tk.legs, ['conference', 'bridges', 'gala']);
        assert.strictEqual(tk.party, 2);
        assert.strictEqual(tk.name, 'Ana Franceschi');
        assert.strictEqual(tk.invoice, 'GALA26-0041');
        assert.strictEqual(tk.gala, true);
        assert.strictEqual(tk.guestOf, null);
        assert.strictEqual(tk.qr, qrRouteShape(query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [CA])),
            'byte-identical to what /qr/:id.png paints');
        assert.ok(tk.qr.includes('"caRegId":"' + CA + '"') && tk.qr.includes('"regId":"' + GALA + '"'), 'both ids → all three doors');
        assert.strictEqual(tk.serial, 'medx-t-gala-' + GALA, 'same serial as the member-portal pass — one card, replaced not duplicated');
    });

    await t('an unpaid seat is a reservation, not a ticket — gala kind → null until paid', () => {
        assert.strictEqual(pp.resolveTicket(query, 'gala', GALA2), null);
        run("UPDATE gala_registrations SET payment_status = 'paid' WHERE id = ?", [GALA2]);
        const tk = pp.resolveTicket(query, 'gala', GALA2);
        assert.ok(tk && tk.party === 2, 'paid → a party-of-2 ticket');
        run("UPDATE gala_registrations SET payment_status = 'pending' WHERE id = ?", [GALA2]);
    });

    await t('ca kind = the free-events pass; a ca row that holds a paid Gala collapses to the combined ticket', () => {
        const free = pp.resolveTicket(query, 'ca', CA3);
        assert.ok(free);
        assert.deepStrictEqual(free.legs, ['conference', 'bridges']);
        assert.strictEqual(free.gala, false);
        assert.strictEqual(free.party, 1);
        assert.strictEqual(free.qr, qrRouteShape(query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [CA3])));
        assert.ok(free.qr.includes('"evt":"croatians-abroad"') && free.qr.includes('"diet":"Vegan"'), 'the free-events shape, diet included like the route');
        const combined = pp.resolveTicket(query, 'ca', CA);
        assert.strictEqual(combined.kind, 'gala', 'never two passes for one person');
        assert.strictEqual(combined.id, GALA);
        // Gala selected but unpaid: the FREE-events pass is issued now (Alen 2026-09-16 — an approved
        // pay-later registrant must not be left without a pass), under the gala row's identity so
        // the combined pass replaces it in the wallet the moment they pay.
        const pending = pp.resolveTicket(query, 'ca', CA2);
        assert.ok(pending && pending.kind === 'ca' && !pending.gala && !pending.paid, 'unpaid gala → the free-events pass, not nothing');
        assert.ok(!pending.legs.includes('gala') && pending.legs.length >= 1, 'only the free legs are on it');
        const ca2 = query.get('SELECT gala_registration_id FROM croatians_abroad_registrations WHERE id = ?', [CA2]);
        assert.strictEqual(pending.serial, `medx-t-gala-${ca2.gala_registration_id}`, 'same serial as the future combined pass — one card, upgraded on payment');
        assert.strictEqual(pp.resolveTicket(query, 'ca', CA6), null, 'a held row is not released — no pass');
    });

    await t('ONE identity across payment: the free pass and the later combined pass share caRegId, regId, serial and objectKey', () => {
        // Before: approved, unpaid → the free-events pass under the gala row's identity.
        const before = pp.resolveTicket(query, 'ca', CA2);
        const qBefore = JSON.parse(before.qr);
        // Then Toi pays.
        run(`UPDATE gala_registrations SET status = 'confirmed', payment_status = 'paid' WHERE id = ?`, [GALA2]);
        run(`UPDATE croatians_abroad_registrations SET gala_status = 'confirmed', gala_payment_status = 'paid', amount_paid = 300 WHERE id = ?`, [CA2]);
        try {
            const after = pp.resolveTicket(query, 'ca', CA2);           // the same token the free email carried
            const afterGala = pp.resolveTicket(query, 'gala', GALA2);   // the token the combined email carries
            const qAfter = JSON.parse(after.qr);
            assert.strictEqual(after.kind, 'gala', 'the old free-pass token now resolves to the combined ticket');
            assert.strictEqual(qBefore.caRegId, qAfter.caRegId, 'same CA row in the QR');
            assert.strictEqual(qBefore.regId, qAfter.regId, 'same gala row in the QR');
            assert.strictEqual(qBefore.regId, GALA2);
            assert.strictEqual(before.serial, after.serial, 'Apple serial unchanged → the wallet card is replaced, not duplicated');
            assert.strictEqual(before.objectKey, after.objectKey, 'Google object id unchanged');
            assert.strictEqual(after.serial, afterGala.serial); assert.strictEqual(after.objectKey, afterGala.objectKey);
            // the ONLY difference the doors could see is the amount — and doors admit by row + DB state, never by the QR's events list
            const strip = o => { const c = { ...o }; delete c.amt; return c; };
            assert.deepStrictEqual(strip(qBefore), strip(qAfter), 'the QR payload is the same identity before and after payment');
        } finally {
            run(`UPDATE gala_registrations SET status = 'approved', payment_status = 'pending' WHERE id = ?`, [GALA2]);
            run(`UPDATE croatians_abroad_registrations SET gala_status = 'awaiting_payment', gala_payment_status = 'pending', amount_paid = NULL WHERE id = ?`, [CA2]);
        }
    });

    await t('source contract — the admin doors resolve a CA scan by its ids and DB state, never by the events list inside the QR', () => {
        const adminSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'admin-portal', 'backend', 'server.js'), 'utf8');
        assert.ok(/parsed\.regId \|\| parsed\.caRegId/.test(adminSrc), 'universal check-in reads regId / caRegId');
        const doors = adminSrc.slice(adminSrc.indexOf("app.post('/api/admin/checkin/verify'"), adminSrc.indexOf("app.post('/api/checkin'"));
        assert.ok(doors.length > 2000, 'verify route found');
        assert.ok(!/parsed\.events\.includes|qr\.events\.includes|payload\.events\.includes/.test(doors), 'admissibility never keys off the QR events array');
    });

    await t('guest kind = the named guest\'s copy: their name, "guest of", the SAME party QR', () => {
        const g = pp.resolveTicket(query, 'guest', GUEST);
        assert.ok(g);
        assert.strictEqual(g.name, 'Emeric du Mas de Paysac');
        assert.strictEqual(g.guestOf, 'Ana Franceschi');
        assert.strictEqual(g.email, 'emericdumas@gmail.com');
        assert.strictEqual(g.party, 2);
        assert.strictEqual(g.qr, pp.resolveTicket(query, 'gala', GALA).qr, 'one QR admits the whole party');
        assert.strictEqual(g.serial, 'medx-t-galaguest-' + GUEST, 'its own card on the guest\'s phone');
        assert.strictEqual(pp.resolveTicket(query, 'guest', 'aaaaaaaa-0000-4000-8000-000000000000'), null);
    });

    await t('standalone gala rows: vip-comp is a ticket (sparse QR, table on the pass); cancelled is not', () => {
        const vip = pp.resolveTicket(query, 'gala', GALA4);
        assert.ok(vip);
        assert.deepStrictEqual(vip.legs, ['gala']);
        assert.strictEqual(vip.qr, JSON.stringify({ type: 'MEDX_MEMBER', regId: GALA4, evt: 'gala' }), 'the /qr standalone branch, byte for byte');
        assert.strictEqual(vip.seat, '7');
        assert.strictEqual(pp.resolveTicket(query, 'gala', GALA5), null, 'cancelled');
        assert.strictEqual(pp.resolveTicket(query, 'gala', 'not-an-id'), null);
        assert.strictEqual(pp.resolveTicket(query, 'bogus', GALA), null);
    });

    // ==================== the Apple model ====================
    await t('Apple model: Plexus header, legs on the back, ADMITS 2 only for a party, black tie only with a Gala', () => {
        const m = pp.applePassModel(pp.resolveTicket(query, 'gala', GALA));
        assert.strictEqual(m.style, 'eventTicket');
        assert.deepStrictEqual(m.fields.header, [{ key: 'event', label: 'PLEXUS WEEK 2026', value: 'Zagreb' }]);
        assert.strictEqual(m.fields.secondary[0].value, '4–5 December 2026');
        assert.ok(m.fields.auxiliary.some(f => f.label === 'ADMITS' && f.value === '2'), 'admits 2');
        assert.ok(m.fields.auxiliary.some(f => f.label === 'NAME' && f.value === 'Ana Franceschi'));
        assert.ok(m.fields.auxiliary.some(f => f.label === 'N°' && f.value === 'GALA26-0041'), 'invoice as the ref');
        const inc = m.fields.back.find(f => f.key === 'included').value;
        assert.ok(/Plexus Conference — 4 December 2026 · 17:00–21:00, Novinarski dom, Zagreb/.test(inc) && /Building Bridges Zagreb/.test(inc) && /Gala Evening — 5 December 2026 · 19:00, Hotel Esplanade, Zagreb/.test(inc), inc);
        assert.ok(m.fields.back.some(f => f.label === 'DRESS CODE' && f.value === 'Gala Evening: black tie · Conference and Building Bridges: business casual'), 'both dress codes when free legs are held');
        assert.ok(pp.applePassModel(pp.resolveTicket(query, 'gala', GALA4)).fields.back.some(f => f.label === 'DRESS CODE' && f.value === 'Black tie'), 'gala only → black tie');
        assert.ok(m.fields.back.some(f => f.label === 'INVOICE' && f.value === 'GALA26-0041'));
        assert.strictEqual(m.qrMessage, pp.resolveTicket(query, 'gala', GALA).qr, 'barcode = the emailed QR payload');
        assert.strictEqual(m.relevantDate, '2026-12-04T17:00:00+01:00', 'relevant from the conference start (17:00, Alen 2026-09-16)');
        assert.ok(!m.stripFiles && !m.logoFiles, 'the default Plexus strip + wordmark — Boston\'s skyline stays in Boston');

        const solo = pp.applePassModel(pp.resolveTicket(query, 'ca', CA3));
        assert.ok(!solo.fields.auxiliary.some(f => f.label === 'ADMITS'), 'no ADMITS for a party of one');
        assert.ok(!solo.fields.back.some(f => f.label === 'DRESS CODE'), 'no black tie without a Gala');
        assert.strictEqual(solo.fields.secondary[0].value, '4–5 December 2026');
        assert.strictEqual(solo.fields.auxiliary.find(f => f.label === 'N°').value, CA3.replace(/-/g, '').slice(0, 8).toUpperCase(), 'short code when nothing was invoiced');

        const vip = pp.applePassModel(pp.resolveTicket(query, 'gala', GALA4));
        assert.strictEqual(vip.fields.secondary[0].value, '5 December 2026 · 19:00');
        assert.strictEqual(vip.fields.secondary[1].value, 'Hotel Esplanade, Zagreb');
        assert.ok(vip.fields.back.some(f => f.label === 'TABLE' && f.value === 'Table 7'));

        const guest = pp.applePassModel(pp.resolveTicket(query, 'guest', GUEST));
        assert.ok(guest.fields.auxiliary.some(f => f.label === 'GUEST' && /Emeric/.test(f.value)));
        assert.ok(guest.fields.back.some(f => f.label === 'GUEST OF' && f.value === 'Ana Franceschi'));
    });

    // ==================== Google ====================
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const SA = { client_email: 'wallet@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const googleOn = () => {
        process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000012345678';
        process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify(SA);
        process.env.GOOGLE_WALLET_EVENT_CLASS_ID = '3388000000012345678.plexus_week_2026_approved';
    };
    const googleOff = () => { delete process.env.GOOGLE_WALLET_ISSUER_ID; delete process.env.GOOGLE_WALLET_SA_KEY; delete process.env.GOOGLE_WALLET_EVENT_CLASS_ID; };
    // Works for sync AND async bodies — the env stays up until an async body has settled.
    const withGoogle = fn => {
        googleOn();
        let out;
        try { out = fn(); } catch (e) { googleOff(); throw e; }
        if (out && typeof out.then === 'function') return out.finally(googleOff);
        googleOff();
        return out;
    };
    await t('Google object: the approved Plexus class, barcode = the same QR payload, party in the category, legs listed', () => withGoogle(() => {
        const tk = pp.resolveTicket(query, 'gala', GALA);
        const { classBody, object } = pp.googleObjects(tk, 'https://medx-user-portal.onrender.com');
        assert.strictEqual(classBody.id, '3388000000012345678.plexus_week_2026_approved', 'the approved class wins');
        assert.strictEqual(classBody.eventName.defaultValue.value, 'Plexus Week 2026');
        assert.strictEqual(object.classId, classBody.id);
        assert.strictEqual(object.barcode.type, 'QR_CODE');
        assert.strictEqual(object.barcode.value, tk.qr, 'scans like the email');
        assert.strictEqual(object.ticketHolderName, 'Ana Franceschi');
        assert.strictEqual(object.ticketNumber, 'GALA26-0041');
        assert.strictEqual(object.id, '3388000000012345678.tkt_' + GALA, 'one object per registration');
        const txt = Object.fromEntries(object.textModulesData.map(m => [m.id, m.body]));
        assert.strictEqual(txt.category, 'Plexus Week 2026 · admits 2');
        assert.strictEqual(txt.events, 'Plexus Conference · Building Bridges Zagreb · Gala Evening');
        assert.strictEqual(txt.dress, 'Gala Evening: black tie · Conference and Building Bridges: business casual');
        assert.strictEqual(txt.status, 'Paid');
        const g = pp.googleObjects(pp.resolveTicket(query, 'guest', GUEST), 'https://x');
        assert.strictEqual(g.object.id, '3388000000012345678.tkt_g-' + GUEST, 'the guest gets their own object');
        assert.strictEqual(g.object.barcode.value, tk.qr);
        assert.ok(/Guest of Ana Franceschi/.test(Object.fromEntries(g.object.textModulesData.map(m => [m.id, m.body])).status));
    }));

    // ==================== links ====================
    await t('walletLinks: nothing when neither platform env exists; each button appears with its env; not-a-ticket → nothing', () => {
        assert.deepStrictEqual(pp.walletLinks(query, SECRET, 'gala', GALA), { apple: null, google: null }, 'bare env');
        withGoogle(() => {
            const l = pp.walletLinks(query, SECRET, 'gala', GALA);
            assert.strictEqual(l.apple, null);
            assert.ok(l.google && l.google.startsWith('https://medx-user-portal.onrender.com/api/plexus/wallet/' + pp.passToken(SECRET, 'gala', GALA)), l.google);
            assert.deepStrictEqual(pp.walletLinks(query, SECRET, 'gala', GALA2), { apple: null, google: null }, 'unpaid → no links');
            assert.deepStrictEqual(pp.walletLinks(query, SECRET, 'ca', CA6), { apple: null, google: null }, 'held → no links');
        });
        for (const k of ['APPLE_WALLET_CERT_PEM', 'APPLE_WALLET_KEY_PEM', 'APPLE_WALLET_WWDR_PEM', 'APPLE_WALLET_TEAM_ID', 'APPLE_WALLET_PASS_TYPE_ID']) process.env[k] = 'x';
        try {
            const l = pp.walletLinks(query, SECRET, 'ca', CA3);
            assert.ok(l.apple && l.apple.endsWith('/api/plexus/pass/' + pp.passToken(SECRET, 'ca', CA3) + '.pkpass'), l.apple);
        } finally { for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_')) delete process.env[k]; }
    });

    await t('the email stack + page buttons render both buttons, and nothing at all without links', () => {
        const html = pp.walletStackHtml({ apple: 'https://x/a.pkpass', google: 'https://x/g' });
        assert.ok(html.includes('ADD TO APPLE WALLET') && html.includes('ADD TO GOOGLE WALLET'));
        assert.ok(html.includes('href="https://x/a.pkpass"') && html.includes('href="https://x/g"'));
        assert.strictEqual(pp.walletStackHtml({ apple: null, google: null }), '');
        assert.strictEqual(pp.walletStackHtml(null), '');
        const page = pp.walletButtonsPageHtml({ apple: 'https://x/a.pkpass', google: null });
        assert.ok(page.includes('Add to Apple Wallet') && !page.includes('Google'));
        assert.strictEqual(pp.walletButtonsPageHtml({}), '');
    });

    // ==================== routes ====================
    await t('routes: forged / unknown / ineligible tokens are 404s; a valid Apple token without signing env is a 503', async () => {
        const forged = await call(app, 'GET', '/api/plexus/pass/:token.pkpass', { params: { token: 'f'.repeat(32) + '.gala.' + GALA } });
        assert.strictEqual(forged.statusCode, 404);
        const other = await call(app, 'GET', '/api/plexus/pass/:token.pkpass', { params: { token: pp.passToken('other', 'gala', GALA) } });
        assert.strictEqual(other.statusCode, 404);
        const unpaid = await call(app, 'GET', '/api/plexus/pass/:token.pkpass', { params: { token: pp.passToken(SECRET, 'gala', GALA2) } });
        assert.strictEqual(unpaid.statusCode, 404, 'a real token for a row that is not a ticket → still 404');
        const ok = await call(app, 'GET', '/api/plexus/pass/:token.pkpass', { params: { token: pp.passToken(SECRET, 'gala', GALA) } });
        assert.strictEqual(ok.statusCode, 503, 'valid, but no Apple signing env in the test');
        assert.ok(/not enabled/.test(ok.body.error));
        const gw = await call(app, 'GET', '/api/plexus/wallet/:token', { params: { token: 'f'.repeat(32) + '.gala.' + GALA } });
        assert.strictEqual(gw.statusCode, 404);
        const gwOff = await call(app, 'GET', '/api/plexus/wallet/:token', { params: { token: pp.passToken(SECRET, 'gala', GALA) } });
        assert.strictEqual(gwOff.statusCode, 503, 'no Google env → 503, not a broken redirect');
    });

    await t('routes: with the Google env the wallet route 302s to a signed save link (or hands it back as JSON)', async () => withGoogle(async () => {
        const r = await call(app, 'GET', '/api/plexus/wallet/:token', { params: { token: pp.passToken(SECRET, 'gala', GALA) } });
        assert.strictEqual(r.statusCode, 302);
        assert.ok(String(r.headers.location).startsWith('https://pay.google.com/gp/v/save/'), r.headers.location);
        const jwt = String(r.headers.location).split('/save/')[1];
        const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
        assert.strictEqual(claims.typ, 'savetowallet');
        assert.strictEqual(claims.payload.eventTicketObjects[0].barcode.value, pp.resolveTicket(query, 'gala', GALA).qr, 'the JWT carries the same QR');
        assert.deepStrictEqual(claims.origins, ['https://medx-user-portal.onrender.com']);
        const j = await call(app, 'GET', '/api/plexus/wallet/:token', { params: { token: pp.passToken(SECRET, 'guest', GUEST) }, query: { format: 'json' } });
        assert.strictEqual(j.statusCode, 200);
        assert.ok(j.body.configured && String(j.body.save_url).startsWith('https://pay.google.com/gp/v/save/'));
    }));

    // ==================== the emails carry the buttons ====================
    await t('the combined ticket and the guest copy carry both wallet buttons when links exist — and stay clean when they do not', () => {
        const links = { apple: 'https://medx-user-portal.onrender.com/api/plexus/pass/tok.pkpass', google: 'https://medx-user-portal.onrender.com/api/plexus/wallet/tok' };
        const html = payLink.buildCombinedTicketEmail({
            firstName: 'Ana', fullName: 'Ana Franceschi', amount: 300, seats: 2, invoiceNumber: 'GALA26-0041', wantConf: true, wantBridges: true, source: 'plexus',
            qrPngUrl: 'https://medx-user-portal.onrender.com/qr/' + GALA + '.png', partyNoteText: 'This QR admits your whole party of 2.',
            wallet: links
        });
        assert.ok(html.includes('ADD TO APPLE WALLET') && html.includes('ADD TO GOOGLE WALLET') && html.includes('ADD TO CALENDAR'), 'all three buttons');
        assert.ok(html.indexOf('/qr/' + GALA + '.png') < html.indexOf('ADD TO APPLE WALLET'), 'right under the QR card');
        assert.ok(html.indexOf('ADD TO GOOGLE WALLET') < html.indexOf('whole party of 2'), 'before the party note');
        const guest = payLink.buildGuestEntryEmail({ guestFirst: 'Emeric', guestName: 'Emeric du Mas de Paysac', registrantName: 'Ana Franceschi', qrPngUrl: 'https://x/qr/' + GALA + '.png', wallet: links });
        assert.ok(guest.includes('ADD TO APPLE WALLET') && guest.includes('ADD TO GOOGLE WALLET'));
        const bare = payLink.buildCombinedTicketEmail({ firstName: 'A', amount: 150, seats: 1, wantConf: false, wantBridges: false, qrPngUrl: 'https://x/qr/1.png', wallet: { apple: null, google: null } });
        assert.ok(!/WALLET/.test(bare), 'no dangling wallet buttons when the env is absent');
        assert.ok(bare.includes('ADD TO CALENDAR'), 'the calendar button needs no env');
    });

    await t('server.js wires the passes into every surface: mount, pay-link deps, Path B, standalone receipt, ticket page, pre-registration email', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');
        assert.ok(src.includes("require('./plexus-pass')(app, { query, JWT_SECRET })"), 'mounted');
        assert.ok(src.includes('walletLinks: plexusPass.walletLinks, walletStackHtml: plexusPass.walletStackHtml'), 'gala-paylink deps');
        assert.strictEqual((src.match(/plexusPass\.walletLinks\('gala', galaRegId\)/g) || []).length, 2, 'Path B ticket + standalone receipt');
        assert.ok(src.includes("plexusPass.walletLinks('guest', pg.id)"), 'Path B guest copies');
        assert.ok(src.includes("plexusPass.walletLinks('gala', g.id) : (ca ? plexusPass.walletLinks('ca', ca.id)"), 'the ticket pages (gala + free)');
        assert.ok(src.includes("wallet: plexusPass.walletLinks(finalGala ? 'gala' : 'ca', finalGala ? qrId : regId)"), 'the free-events pre-registration email');
        assert.ok(src.includes("const links = plexusPass.walletLinks(kind, qrId);"), 'the institutional-confirmation page (ticketAssets)');
        const gp = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'gala-paylink.js'), 'utf8');
        assert.ok(gp.includes("wallet: links('gala', galaRegId)") && gp.includes("wallet: g.id ? links('guest', g.id) : null"), 'fulfilLinkedCaGala: ticket + guest copies');
        // The /qr route still paints the croatians_abroad branch in the order qrPayloadFor mirrors.
        const route = src.slice(src.indexOf("app.get('/qr/:id.png'"), src.indexOf("app.get('/qr/:id.png'") + 3000);
        for (const k of ['type: \'MEDX_MEMBER\'', 'caRegId: ca.id', 'regId: ca.gala_registration_id || ca.id', 'email: ca.email', 'evt: ca.selected_gala ? \'gala\' : \'croatians-abroad\'', 'events']) {
            assert.ok(route.includes(k), '/qr route still carries ' + k);
        }
        assert.ok(route.indexOf('caRegId') < route.indexOf('regId: ca.gala') && route.indexOf('email: ca.email') < route.indexOf('name:'), 'field order unchanged');
    });

    await t('no network was touched', () => {
        assert.throws(() => global.fetch(), /NETWORK DISABLED/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
