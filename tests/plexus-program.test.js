/**
 * tests/plexus-program.test.js — "Your Plexus Week 2026 program & ticket", the one-touch re-send
 * (user-portal/backend/plexus-program.js). Hermetic: scratch sqlite, stub express, capturing
 * sendEmail, an in-memory S3 stub, no network. NOTHING here can reach a registrant.
 *
 * Run:  node tests/plexus-program.test.js
 */
'use strict';
const assert = require('node:assert');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

for (const k of Object.keys(process.env)) if (/^(APPLE_WALLET_|GOOGLE_WALLET_)/.test(k)) delete process.env[k];
delete process.env.PLEXUS_PROGRAM_PDF_KEY;
process.env.RENDER_EXTERNAL_URL = 'https://medx-user-portal.onrender.com';
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const mountProgram = require('../user-portal/backend/plexus-program.js');
const gate = require('../user-portal/backend/review-gate.js');

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok    ' + name); } catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); } }

// ---------------------------------------------------------------- scratch sqlite
const raw = new DatabaseSync(':memory:');
raw.exec(`CREATE TABLE croatians_abroad_registrations (
    id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT, country TEXT, notes TEXT,
    selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0,
    conference_status TEXT, bridges_status TEXT, gala_status TEXT, gala_payment_status TEXT,
    gala_registration_id TEXT, guest_count INTEGER DEFAULT 0, source TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
raw.exec(`CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, status TEXT, payment_status TEXT,
    amount_paid REAL, invoice_number TEXT, guest_count INTEGER DEFAULT 0, seat_number TEXT, pay_token TEXT)`);
raw.exec(`CREATE TABLE ca_registration_guests (id TEXT PRIMARY KEY, registration_id TEXT, name TEXT, institution TEXT, email TEXT)`);
raw.exec(`CREATE TABLE plexus_settings (id TEXT PRIMARY KEY DEFAULT 'default', conference_start_date TEXT, conference_end_date TEXT,
    conference_venue TEXT, bridges_zagreb_date TEXT, bridges_zagreb_time TEXT, bridges_zagreb_venue TEXT, updated_at TEXT)`);
raw.exec(`INSERT INTO plexus_settings (id, conference_start_date, conference_end_date) VALUES ('default', '2026-12-04', '2026-12-05')`);
const query = {
    get: (sql, p = []) => { const r = raw.prepare(sql).get(...p); return r === undefined ? null : r; },
    all: (sql, p = []) => raw.prepare(sql).all(...p)
};
const db = { run: (sql, p = []) => { p.length ? raw.prepare(sql).run(...p) : raw.exec(sql); } };

const ins = (ca, g) => {
    if (g) raw.prepare('INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, amount_paid, invoice_number, guest_count, seat_number, pay_token) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(g.id, ca.first, ca.last, ca.email, g.status, g.payment_status, g.amount_paid || null, g.invoice || null, g.guests || 0, g.seat || null, g.pay_token || null);
    raw.prepare(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, institution, country, notes, selected_conference, selected_bridges, selected_gala,
        conference_status, bridges_status, gala_status, gala_payment_status, gala_registration_id, guest_count, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ca.id, ca.first, ca.last, ca.email, ca.inst || 'Uni', ca.country || 'Croatia', ca.notes || '',
        ca.conf ? 1 : 0, ca.bridges ? 1 : 0, g ? 1 : 0, ca.confSt || null, ca.bridgesSt || null, g ? (ca.galaSt || 'awaiting_payment') : null, g ? (g.payment_status || 'pending') : null,
        g ? g.id : null, g ? (g.guests || 0) : 0, 'plexus');
};
const ANA = 'aaaaaaaa-0000-4000-8000-000000000001', ANA_G = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TOI = 'bbbbbbbb-0000-4000-8000-000000000002', TOI_G = 'bbbbbbbb-0000-4000-8000-00000000000b';
const IVA = 'cccccccc-0000-4000-8000-000000000003';
const HELD = 'dddddddd-0000-4000-8000-000000000004', HELD_G = 'dddddddd-0000-4000-8000-00000000000d';
const GONE = 'eeeeeeee-0000-4000-8000-000000000005';
const SOLO = 'ffffffff-0000-4000-8000-000000000006', SOLO_G = 'ffffffff-0000-4000-8000-00000000000f';
const ROZ = '99999999-0000-4000-8000-000000000007', ROZ_G = '99999999-0000-4000-8000-000000000009';
ins({ id: ANA, first: 'Ana', last: 'Franceschi', email: 'ana@example.org', conf: 1, bridges: 1, confSt: 'pre-registered', bridgesSt: 'pre-registered', galaSt: 'confirmed' },
    { id: ANA_G, status: 'confirmed', payment_status: 'paid', amount_paid: 300, invoice: 'GALA26-0041', guests: 1 });
raw.prepare('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)').run('11111111-0000-4000-8000-000000000011', ANA, 'Emeric du Mas de Paysac', 'Sorbonne', 'emeric@example.org');
ins({ id: TOI, first: 'Masakazu', last: 'Toi', email: 'toi@example.org', conf: 1, bridges: 1, confSt: 'pre-registered', bridgesSt: 'pre-registered', galaSt: 'awaiting_payment' },
    { id: TOI_G, status: 'approved', payment_status: 'pending', amount_paid: 300, invoice: 'GALA26-0038', guests: 1, pay_token: 't'.repeat(40) });
ins({ id: IVA, first: 'Iva', last: 'Free', email: 'iva@example.org', conf: 1, bridges: 1, confSt: 'pre-registered', bridgesSt: 'pre-registered' }, null);
ins({ id: HELD, first: 'Held', last: 'Row', email: 'held@example.org', conf: 1, bridges: 0, confSt: 'pending-review', galaSt: 'pending-review' },
    { id: HELD_G, status: 'pending-review', payment_status: 'pending' });
ins({ id: GONE, first: 'Gone', last: 'Away', email: 'gone@example.org', conf: 1, bridges: 1, confSt: 'cancelled', bridgesSt: 'cancelled' }, null);
ins({ id: SOLO, first: 'Solo', last: 'Gala', email: 'solo@example.org', conf: 0, bridges: 0, galaSt: 'awaiting_payment' },
    { id: SOLO_G, status: 'approved', payment_status: 'pending', pay_token: 's'.repeat(40) });
ins({ id: ROZ, first: 'Janez', last: 'Rozman', email: 'roz@example.org', conf: 1, bridges: 1, confSt: 'pre-registered', bridgesSt: 'pre-registered', galaSt: 'awaiting_payment' },
    { id: ROZ_G, status: 'awaiting_payment', payment_status: 'pending' });   // abandoned Stripe, no pay link

// ---------------------------------------------------------------- stubs
const sent = [];
const sendEmail = async (to, subject, html, attachments) => { sent.push({ to, subject, html, attachments: attachments || [] }); return { success: true }; };
const store = new Map();
const s3 = {
    isConfigured: () => true,
    headObject: async k => store.has(k) ? { size: store.get(k).length, lastModified: '2026-11-01T09:00:00.000Z' } : null,
    getObject: async k => { if (!store.has(k)) throw new Error('S3 GET 404 for ' + k); return store.get(k); },
    putObject: async (k, body) => { store.set(k, Buffer.from(body)); return { etag: 'x' }; }
};
function makeApp() { const routes = {}; const reg = m => (p, ...h) => { routes[m + ' ' + p] = h[h.length - 1]; }; return { get: reg('GET'), post: reg('POST'), put: reg('PUT'), routes }; }
function makeRes() { const r = { statusCode: 200, headers: {}, body: undefined }; const res = { status(c) { r.statusCode = c; return res; }, json(o) { r.body = o; return res; }, send(x) { r.body = x; return res; }, set() { return res; }, setHeader() {}, redirect(c, u) { r.statusCode = c; r.headers.location = u; }, get headersSent() { return false; }, _r: r }; return res; }
async function call(app, method, p, { params, query: qs, body, file } = {}) { const h = app.routes[method + ' ' + p]; if (!h) throw new Error('route not mounted: ' + method + ' ' + p); const res = makeRes(); await h({ params: params || {}, query: qs || {}, body: body || {}, file, get: () => '' }, res); return res._r; }
const SECRET = 'program-test-secret';
const KEY = crypto.createHmac('sha256', SECRET).update('plexus-admin').digest('hex').slice(0, 40);
const app = makeApp();
const mod = mountProgram(app, {
    query, db, saveDb: () => {}, flushDb: () => {}, JWT_SECRET: SECRET, sendEmail, s3,
    qrImageUrl: id => `https://medx-user-portal.onrender.com/qr/${id}.png`,
    walletLinks: (kind, id) => ({ apple: `https://x/api/plexus/pass/${kind}-${id}.pkpass`, google: `https://x/api/plexus/wallet/${kind}-${id}` }),
    log: () => {}
});
const ca = id => query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [id]);
const to = e => sent.filter(m => m.to === e);

(async () => {
    console.log('plexus-program.test.js — hermetic (scratch sqlite, stub express, stub S3, no network)\n');

    await t('classify: paid / unpaid-gala / free / held / cancelled / unpaid-only', () => {
        const states = Object.fromEntries(mod.rows().map(r => [r.ca.id, r.state]));
        assert.strictEqual(states[ANA], 'paid');
        assert.strictEqual(states[TOI], 'unpaid-gala');
        assert.strictEqual(states[IVA], 'free');
        assert.strictEqual(states[HELD], 'held');
        assert.strictEqual(states[GONE], 'cancelled');
        assert.strictEqual(states[SOLO], 'unpaid-only', 'an unpaid Gala with no free legs has no ticket to send');
        assert.strictEqual(states[ROZ], 'unpaid-gala', 'an abandoned direct payer keeps their free legs');
        const roz = mod.rows().find(r => r.ca.id === ROZ);
        assert.strictEqual(roz.payLink, false, 'but has no pay link to offer (status awaiting_payment, no token)');
        const toi = mod.rows().find(r => r.ca.id === TOI);
        assert.strictEqual(toi.payLink, true);
        assert.deepStrictEqual(mod.rows().find(r => r.ca.id === ANA).legs, ['conference', 'bridges', 'gala']);
        assert.deepStrictEqual(toi.legs, ['conference', 'bridges'], 'the unpaid Gala is not on the ticket');
        const c = mod.summary(mod.rows());
        assert.deepStrictEqual([c.eligible, c.sent, c.paid, c.unpaid_gala, c.free, c.skipped_held, c.skipped_cancelled, c.skipped_unpaid_gala_only], [4, 0, 1, 2, 1, 1, 1, 1]);
    });

    await t('the status route: counts, rows, settings, facts — and a wrong key is a 404', async () => {
        assert.strictEqual((await call(app, 'GET', '/api/plexus/program', { query: { key: 'nope' } })).statusCode, 404);
        const r = await call(app, 'GET', '/api/plexus/program', { query: { key: KEY } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.program.present, false, 'no PDF yet');
        assert.strictEqual(r.body.counts.eligible, 4);
        assert.strictEqual(r.body.rows.length, 7);
        assert.ok(r.body.rows.find(x => x.id === ANA).party === 2);
        assert.strictEqual(r.body.facts.bridges.confirmed, undefined, 'Bridges date not set yet');
        assert.strictEqual(r.body.marker, 'PROGRAM-TICKET-SENT');
    });

    await t('the three shapes: paid = combined + guests; unpaid = free legs + the pay button; free = free legs — all program-framed, all three wallet/calendar buttons', () => {
        const rowsNow = mod.rows();
        const paid = mod.buildFor(rowsNow.find(r => r.ca.id === ANA), { programAttached: true });
        assert.ok(paid.includes('YOUR PROGRAM &amp; TICKET') || paid.includes('YOUR PROGRAM & TICKET'), 'kicker');
        assert.ok(paid.includes('your program and your ticket'), 'headline');
        assert.ok(paid.includes('Your <b>program</b> is attached'), 'program note');
        assert.ok(paid.includes('2 Gala seats') && paid.includes('GALA26-0041') && paid.includes('Emeric du Mas de Paysac'), 'party, invoice, guests');
        assert.ok(paid.includes(`/qr/${ANA_G}.png`) && paid.includes(`/api/plexus/pass/gala-${ANA_G}.pkpass`) && paid.includes('ADD TO CALENDAR'), 'QR, wallet, calendar');
        assert.ok(!/updated our systems|apolog|\bhonest\b/i.test(paid), 'no apology framing, never that word');

        const unpaid = mod.buildFor(rowsNow.find(r => r.ca.id === TOI), { programAttached: true });
        assert.ok(unpaid.includes('COMPLETE MY GALA RESERVATION'), 'the pay button');
        assert.ok(unpaid.includes('/pay/gala/' + 't'.repeat(40)), 'their existing pay link');
        assert.ok(unpaid.includes(`/qr/${TOI}.png`) && unpaid.includes(`/api/plexus/pass/ca-${TOI}.pkpass`), 'the FREE-legs QR and pass (ca kind), not the unpaid gala');
        assert.ok(!unpaid.includes('GALA26-0038'), 'no invoice for an unpaid seat');
        assert.ok(!/Gala Evening — /.test(unpaid.replace(/Gala Evening seat/g, '')), 'the Gala is not on the WHEN lines');

        const noLink = mod.buildFor(rowsNow.find(r => r.ca.id === ROZ), { programAttached: false });
        assert.ok(!noLink.includes('COMPLETE MY GALA RESERVATION') && noLink.includes('reply to this email and we will send you the payment link'), 'no token → no button, a reply line instead');
        assert.ok(!noLink.includes('Your <b>program</b> is attached'), 'no program claim when it is not attached');

        const free = mod.buildFor(rowsNow.find(r => r.ca.id === IVA), { programAttached: true });
        assert.ok(free.includes('There is nothing to pay') && free.includes(`/qr/${IVA}.png`) && free.includes('ADD TO GOOGLE WALLET'));
    });

    await t('preview without the PDF goes out to the reviewer, marked; the real sends refuse', async () => {
        const p = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: 'preview' } });
        assert.strictEqual(p.statusCode, 200, JSON.stringify(p.body));
        assert.strictEqual(p.body.program_attached, false);
        assert.deepStrictEqual(p.body.previews.map(x => x.variant), ['paid', 'unpaid', 'free']);
        const pv = to(gate.REVIEW_TO);
        assert.strictEqual(pv.length, 3);
        assert.ok(pv.every(m => /^\[PREVIEW · program & ticket · (paid|unpaid gala|free only) · program PDF not uploaded yet\]/.test(m.subject)), pv.map(m => m.subject).join(' | '));
        assert.ok(pv.every(m => m.attachments.length === 0));
        const all = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: 'all' } });
        assert.strictEqual(all.statusCode, 400);
        assert.ok(/Upload the program PDF first/.test(all.body.error));
        const one = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: ANA } });
        assert.strictEqual(one.statusCode, 400);
        assert.strictEqual(sent.filter(m => m.to !== gate.REVIEW_TO).length, 0, 'not one registrant email');
    });

    await t('the program upload: PDF only, magic-checked, then the gate opens', async () => {
        const bad = await call(app, 'POST', '/api/plexus/program', { query: { key: KEY }, file: { originalname: 'program.pdf', buffer: Buffer.from('not a pdf at all') } });
        assert.strictEqual(bad.statusCode, 400);
        const ok = await call(app, 'POST', '/api/plexus/program', { query: { key: KEY }, file: { originalname: 'Plexus-Week-2026-Program.pdf', buffer: Buffer.from('%PDF-1.7\n' + 'x'.repeat(500)) } });
        assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body));
        const st = await call(app, 'GET', '/api/plexus/program', { query: { key: KEY } });
        assert.strictEqual(st.body.program.present, true);
    });

    await t('send to all: eligible rows only, program attached, guests get their copy, marker stamped, second run sends nothing', async () => {
        const before = sent.length;
        const r = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: 'all' } });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.deepStrictEqual(r.body.sent.sort(), ['ana@example.org', 'iva@example.org', 'roz@example.org', 'toi@example.org']);
        assert.strictEqual(r.body.guests, 1, "Ana's named guest");
        assert.strictEqual(r.body.failed.length, 0);
        for (const e of ['held@example.org', 'gone@example.org', 'solo@example.org']) assert.strictEqual(to(e).length, 0, e + ' must never be emailed by this tool');
        const ana = to('ana@example.org')[0];
        assert.strictEqual(ana.subject, 'Your Plexus Week 2026 program & ticket');
        assert.strictEqual(ana.attachments.length, 1);
        assert.strictEqual(ana.attachments[0].filename, 'Plexus-Week-2026-Program.pdf');
        const em = to('emeric@example.org')[0];
        assert.strictEqual(em.subject, 'Your Plexus Week 2026 program & Gala entry');
        assert.ok(em.html.includes('Guest of Ana Franceschi') && em.html.includes(`/api/plexus/pass/guest-11111111-0000-4000-8000-000000000011.pkpass`), 'guest copy with their own pass');
        assert.strictEqual(em.attachments.length, 1, 'the program rides with the guest copy too');
        for (const id of [ANA, TOI, IVA, ROZ]) assert.ok(/PROGRAM-TICKET-SENT \d{4}-\d{2}-\d{2}/.test(String(ca(id).notes)), 'stamped ' + id.slice(0, 4));
        assert.ok(!/PROGRAM-TICKET-SENT/.test(String(ca(HELD).notes)));
        const again = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: 'all' } });
        assert.deepStrictEqual(again.body.sent, []);
        assert.strictEqual(again.body.skipped_already_sent, 4);
        assert.strictEqual(sent.length, before + 5 + 0, 'four registrants + one guest, then nothing');
    });

    await t('a single-row send always re-sends; held / cancelled ids are refused with a reason', async () => {
        const n = to('iva@example.org').length;
        const r = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: IVA } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(to('iva@example.org').length, n + 1);
        const held = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: HELD } });
        assert.strictEqual(held.statusCode, 409);
        assert.ok(/held/.test(held.body.error));
        const gone = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: GONE } });
        assert.strictEqual(gone.statusCode, 409);
        const nope = await call(app, 'POST', '/api/plexus/program/send', { query: { key: KEY }, body: { to: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } });
        assert.strictEqual(nope.statusCode, 404);
    });

    await t('settings: the Building Bridges date/venue flow into the WHEN line and the .ics; bad values are dropped', async () => {
        const bad = await call(app, 'PUT', '/api/plexus/program/settings', { query: { key: KEY }, body: { bridges_zagreb_date: 'next friday' } });
        assert.strictEqual(bad.statusCode, 200);
        assert.strictEqual(bad.body.settings.bridges_zagreb_date, null, 'not a date → null');
        const ok = await call(app, 'PUT', '/api/plexus/program/settings', { query: { key: KEY }, body: { bridges_zagreb_date: '2026-12-05', bridges_zagreb_time: '14:00', bridges_zagreb_venue: 'Hotel Esplanade, Zagreb', conference_venue: 'Novinarski dom, Perkovčeva 2' } });
        assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body));
        assert.strictEqual(ok.body.facts.bridges.when, '5 December 2026 · 14:00');
        assert.strictEqual(ok.body.facts.bridges.confirmed, true);
        assert.strictEqual(ok.body.facts.conference.venue, 'Novinarski dom, Perkovčeva 2');
        const html = mod.buildFor(mod.rows().find(r => r.ca.id === IVA), { programAttached: true });
        assert.ok(html.includes('<strong>Building Bridges Zagreb</strong> — 5 December 2026 · 14:00 · Hotel Esplanade, Zagreb'), 'the final date on the ticket');
        assert.ok(!html.includes('date and venue to be confirmed'), 'no longer pending');
        const pt = require('../user-portal/backend/plexus-ticket.js');
        const ics = pt.icsFor(['bridges'], ok.body.facts);
        assert.ok(ics.includes('DTSTART;TZID=Europe/Zagreb:20261205T140000') && ics.includes('DTEND;TZID=Europe/Zagreb:20261205T170000'), 'the calendar follows the setting');
    });

    await t('only the reviewer and real registrants were ever addressed; no network', () => {
        const others = sent.filter(m => !/@example\.org$/.test(m.to) && m.to !== gate.REVIEW_TO);
        assert.strictEqual(others.length, 0);
        assert.throws(() => global.fetch(), /NETWORK DISABLED/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
