/**
 * tests/ca-resubmit.test.js — one person, ONE Plexus registration: what a RESUBMISSION of the
 * Zagreb form does to the row this e-mail already holds (user-portal/backend/ca-resubmit.js,
 * wired into POST /api/croatians-abroad/register — audit item D, 2026-09-17).
 *
 * THE BUG UNDER TEST. A resubmission that added nothing was answered with the existing row
 * (guard of 2026-09-16), but one that ADDED a leg INSERTed a second croatians_abroad_registrations
 * row — and, with the Gala in it, a second gala_registrations row and a second Stripe checkout.
 * 14 e-mails ended up with 2–3 rows and 9 abandoned Gala seats next to the same person's paid
 * one. A resubmission that DROPPED the Gala left the unpaid seat and its checkout standing.
 *
 * Hermetic, in the shape of tests/ca-approve-paylink.test.js: a scratch in-memory sqlite
 * (node:sqlite) carrying the REAL croatians_abroad_registrations / gala_registrations /
 * ca_registration_guests schema copied from server.js, a capturing sendEmail stub that renders
 * the REAL plexus-ticket.js ticket, a recording Stripe-expire seam, and global.fetch disabled.
 * NO EMAIL, NO NETWORK, NO STRIPE CALL IS POSSIBLE HERE. The route's own sequence (decide →
 * apply → finishFree / Path B) is replayed in shape, and source-contract checks prove server.js
 * still keeps that sequence.
 *
 * Run:  node tests/ca-resubmit.test.js
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- hermetic env
delete process.env.BREVO_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_SHEETS_WEBHOOK;
process.env.RENDER_EXTERNAL_URL = 'https://medx-user-portal.onrender.com';
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const resub = require('../user-portal/backend/ca-resubmit.js');
const gate = require('../user-portal/backend/review-gate.js');
const plexusTicket = require('../user-portal/backend/plexus-ticket.js');
const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

// ---------------------------------------------------------------- scratch sqlite (real schema)
const raw = new DatabaseSync(':memory:');
raw.exec(`CREATE TABLE croatians_abroad_registrations (
    id TEXT PRIMARY KEY, invite_link_id TEXT,
    first_name TEXT NOT NULL, last_name TEXT, email TEXT NOT NULL,
    institution TEXT, country TEXT, role TEXT, dietary TEXT, notes TEXT,
    selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0,
    conference_status TEXT, bridges_status TEXT, gala_status TEXT, gala_payment_status TEXT,
    gala_registration_id TEXT, amount_paid REAL, stripe_session_id TEXT, invoice_number TEXT,
    source TEXT DEFAULT 'croatians-abroad', user_id TEXT, needs_invoice INTEGER DEFAULT 0, invoice_details TEXT,
    custom_answers TEXT, applied_for TEXT, reg_link_token TEXT, guest_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE gala_registrations (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
    institution TEXT, title TEXT, dietary TEXT, requests TEXT, pricing TEXT,
    status TEXT DEFAULT 'pending', payment_status TEXT, amount_paid REAL, invoice_number TEXT,
    stripe_session_id TEXT, pay_token TEXT, guest_count INTEGER DEFAULT 0, user_id TEXT,
    admin_notes TEXT, needs_invoice INTEGER DEFAULT 0, invoice_details TEXT, custom_answers TEXT, applied_for TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE ca_registration_guests (
    id TEXT PRIMARY KEY, registration_id TEXT, name TEXT, institution TEXT, email TEXT,
    conference INTEGER DEFAULT 0, bridges INTEGER DEFAULT 0, gala INTEGER DEFAULT 0, ticket_sent_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

const query = {
    get: (sql, params = []) => { const r = raw.prepare(sql).get(...params); return r === undefined ? null : r; },
    all: (sql, params = []) => raw.prepare(sql).all(...params)
};
const db = { run: (sql, params = []) => { params.length ? raw.prepare(sql).run(...params) : raw.exec(sql); } };

// ---------------------------------------------------------------- stubs
const sent = [];                       // every "email" — rendered with the real ticket family
const sheetRows = [];                  // every Sheets mirror call
const expired = [];                    // every Stripe checkout the route asked to expire
const BASE = 'https://medx-user-portal.onrender.com';

// The route's caSendPreRegConfirmation, in shape: the real plexus-ticket.js card for the legs
// it is handed, sent through the capturing stub. What matters for these tests is WHICH legs and
// WHICH kind the module asks for — that is the contract with the real sender.
async function sendPreRegConfirmation({ regId, first_name, last_name, email, finalConf, finalBridges, finalGala, regSource }) {
    const legs = [finalConf ? 'conference' : null, finalBridges ? 'bridges' : null, finalGala ? 'gala' : null].filter(Boolean);
    const html = plexusTicket.ticketEmail(finalGala ? 'combined' : 'free', {
        firstName: first_name, fullName: `${first_name || ''} ${last_name || ''}`.trim(), legs, seats: 1, amount: 0,
        source: regSource, ticketCode: String(regId).slice(0, 8).toUpperCase(),
        qrPngUrl: `${BASE}/qr/${regId}.png`, wallet: { apple: null, google: null }, calendarUrl: plexusTicket.calendarUrl(BASE, legs)
    });
    sent.push({ to: email, subject: finalGala ? 'Your ticket — Plexus Week 2026' : "You're pre-registered — Plexus Week 2026", html, legs, kind: finalGala ? 'combined' : 'free' });
    return { success: true };
}
const finishDeps = () => ({
    sendPreRegConfirmation,
    mirrorToSheets: row => sheetRows.push(row),
    ticketPageUrl: (base, id) => `${base}/plexus/ticket/SIG/${id}`,
    galaTicketPageUrl: (base, id) => `${base}/gala/ticket/SIG/${id}`,
    log: () => {}
});
const applyDeps = (over = {}) => ({ query, db, expireCheckout: async id => { expired.push(id); }, log: () => {}, ...over });

// ---------------------------------------------------------------- fixtures
let seq = 0;
// A LIVE prior row, the way the fresh path writes it: free legs 'pre-registered', a Gala leg
// 'awaiting_payment' with its linked gala row (Path B shape: stripe_session_id, no pay_token).
function makeLive(over = {}) {
    const caId = crypto.randomUUID();
    const f = Object.assign({
        first_name: 'Ivan', last_name: 'Horvat', email: `live${++seq}@kbc-zagreb.hr`,
        institution: 'KBC Zagreb', country: 'Croatia', role: 'Physician', dietary: '', notes: '',
        conference: 1, bridges: 0, gala: 0, galaPaid: false, galaRow: true, session: null,
        guest_count: 0, source: 'plexus', applied_for: null
    }, over);
    const galaId = f.gala && f.galaRow ? crypto.randomUUID() : null;
    db.run(`INSERT INTO croatians_abroad_registrations
            (id, first_name, last_name, email, institution, country, role, dietary, notes, selected_conference, selected_bridges, selected_gala,
             conference_status, bridges_status, gala_status, gala_payment_status, gala_registration_id, stripe_session_id, guest_count, source, applied_for)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [caId, f.first_name, f.last_name, f.email, f.institution, f.country, f.role, f.dietary, f.notes, f.conference, f.bridges, f.gala,
         f.conference ? 'pre-registered' : null, f.bridges ? 'pre-registered' : null,
         f.gala ? (f.galaPaid ? 'confirmed' : 'awaiting_payment') : null, f.gala ? (f.galaPaid ? 'paid' : 'pending') : null,
         galaId, f.session, f.guest_count, f.source,
         f.applied_for || resub.appliedFor({ conference: f.conference, bridges: f.bridges, gala: f.gala })]);
    if (galaId) {
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, stripe_session_id, guest_count, amount_paid, invoice_number)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [galaId, f.first_name, f.last_name, f.email, f.institution, f.galaPaid ? 'confirmed' : 'awaiting_payment', f.galaPaid ? 'paid' : 'pending',
             f.session, f.guest_count, f.galaPaid ? 150 : null, f.galaPaid ? 'CA-GALA-2026-0007' : null]);
    }
    return { caId, galaId, email: f.email };
}
const ca = id => query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [id]);
const gala = id => query.get('SELECT * FROM gala_registrations WHERE id = ?', [id]);
const rowsFor = email => query.all('SELECT * FROM croatians_abroad_registrations WHERE LOWER(email) = LOWER(?)', [email]);
const galaRowsFor = email => query.all('SELECT * FROM gala_registrations WHERE LOWER(email) = LOWER(?)', [email]);
const lastTo = to => [...sent].reverse().find(m => m.to === to);
const allTo = to => sent.filter(m => m.to === to);

// The route's own prior-row lookup (verbatim SQL) + linked gala row, then the module's decision.
function priorFor(email) {
    const prior = query.get(`SELECT * FROM croatians_abroad_registrations WHERE LOWER(email) = LOWER(?)
        AND (conference_status IN ('pre-registered','confirmed') OR bridges_status IN ('pre-registered','confirmed')
             OR gala_status IN ('awaiting_payment','approved','confirmed'))
        ORDER BY rowid DESC LIMIT 1`, [email]);
    const priorGala = prior && prior.gala_registration_id ? query.get('SELECT * FROM gala_registrations WHERE id = ?', [prior.gala_registration_id]) : null;
    return { prior, priorGala };
}
// The route's resubmission sequence, in shape: decide → (covered? existing branch) → apply →
// finishFree when no Gala seat is added (a resubmission that adds one continues into Path B).
async function resubmit(email, want, form = {}, deps = {}) {
    const { prior, priorGala } = priorFor(email);
    assert.ok(prior, 'fixture: a live prior row exists');
    const decision = resub.decide({ prior, priorGala, want });
    if (decision.covered) return { decision, covered: true };
    const applied = await resub.apply(applyDeps(deps), { prior, priorGala, decision, form: { appliedFor: resub.appliedFor(decision.legsAfter), ...form } });
    if (decision.adds.gala) return { decision, applied, pathB: true };     // the route's Path B takes it from here
    const body = await resub.finishFree(finishDeps(), { prior, decision, applied, base: BASE, regSource: prior.source, sheet: { caAppliedFor: resub.appliedFor(decision.legsAfter) } });
    return { decision, applied, body };
}

(async () => {
    console.log('ca-resubmit.test.js — hermetic (scratch sqlite, no network, no mail, no Stripe)\n');

    // ==================== (a) ADD A LEG → the prior row is updated, no twin ====================
    await t('(a) add Bridges to a Conference row: no new row, bridges leg live, ticket re-sent for BOTH legs', async () => {
        const { caId, email } = makeLive({ conference: 1, bridges: 0, gala: 0, notes: 'GALA-PAYLINK-SENT 2026-09-10 | vegetarian please' });
        const before = sent.length;
        const out = await resubmit(email, { conference: true, bridges: true, gala: false }, { institution: 'KBC Rebro', role: 'Resident', dietary: 'vegetarian', notes: 'coming with a colleague' });

        assert.strictEqual(out.decision.covered, false);
        assert.deepStrictEqual(out.decision.adds, { conference: false, bridges: true, gala: false });
        assert.deepStrictEqual(out.decision.changes, ['+bridges']);
        assert.strictEqual(rowsFor(email).length, 1, 'ONE row for this e-mail — the twin is not inserted');
        const r = ca(caId);
        assert.strictEqual(Number(r.selected_bridges), 1);
        assert.strictEqual(r.bridges_status, 'pre-registered', 'the same initial status a fresh row gets');
        assert.strictEqual(Number(r.selected_conference), 1);
        assert.strictEqual(r.conference_status, 'pre-registered', 'the leg already held is untouched');
        assert.strictEqual(Number(r.selected_gala), 0);
        assert.strictEqual(r.gala_status, null);
        assert.strictEqual(r.applied_for, 'Plexus Conference, Croatian Biomedical Bridges', 'applied_for now names both legs');
        // profile refresh — non-empty values only; identity untouched
        assert.strictEqual(r.institution, 'KBC Rebro');
        assert.strictEqual(r.role, 'Resident');
        assert.strictEqual(r.dietary, 'vegetarian');
        assert.strictEqual(r.country, 'Croatia', 'a blank re-sent country keeps the old one');
        assert.strictEqual(r.first_name, 'Ivan');
        assert.strictEqual(r.email, email);
        // notes: the marker channel survives, the new note is appended, the resubmission is stamped
        assert.strictEqual(gate.getMarker(r.notes, 'GALA-PAYLINK-SENT'), '2026-09-10', 'existing markers survive');
        assert.ok(r.notes.includes('vegetarian please') && r.notes.includes('coming with a colleague'), 'old and new free text both kept');
        assert.ok(/^\d{4}-\d{2}-\d{2} \+bridges$/.test(gate.getMarker(r.notes, resub.RESUBMIT_MARKER) || ''), 'RESUBMITTED marker records what changed');

        // the ticket for what the row now holds, once, to the prior row's e-mail
        assert.strictEqual(sent.length, before + 1, 'exactly one email');
        const msg = lastTo(email);
        assert.strictEqual(msg.kind, 'free');
        assert.deepStrictEqual(msg.legs, ['conference', 'bridges'], 'Conference + Bridges on the ticket');
        assert.ok(msg.html.includes('<strong>Plexus Conference</strong>') && msg.html.includes('<strong>Building Bridges Zagreb</strong>'), 'both legs on the card');
        assert.ok(!msg.html.includes('<strong>Gala Evening</strong>'), 'no Gala on it');
        // response: the frontend contract {success, id} with id = the PRIOR row, plus updated:true
        assert.strictEqual(out.body.success, true);
        assert.strictEqual(out.body.id, caId);
        assert.strictEqual(out.body.updated, true);
        assert.strictEqual(out.body.status, 'pre-registered');
        assert.strictEqual(out.body.ticket_url, `${BASE}/plexus/ticket/SIG/${caId}`);
        // the Sheet gets a row for the ADDED leg only
        const sheet = sheetRows[sheetRows.length - 1];
        assert.deepStrictEqual(sheet.events, ['bridges'], 'only the Bridges tab — the Conference tab already has this person');
        assert.strictEqual(sheet.regId, caId);
    });

    await t('(a) a resubmission never drops a free leg: re-ticking only the Conference keeps the Bridges', async () => {
        const { caId, email } = makeLive({ conference: 1, bridges: 1, gala: 0 });
        const out = await resubmit(email, { conference: true, bridges: false, gala: false });
        assert.strictEqual(out.covered, true, 'nothing to add, nothing to drop → the existing "already registered" branch');
        const r = ca(caId);
        assert.strictEqual(Number(r.selected_bridges), 1);
        assert.strictEqual(r.bridges_status, 'pre-registered');
    });

    await t('(a) add a free leg while a PAID Gala is held: the combined ticket is re-sent, the seat untouched', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, bridges: 0, gala: 1, galaPaid: true });
        const snapGala = JSON.stringify(gala(galaId));
        const out = await resubmit(email, { conference: true, bridges: true, gala: true });
        assert.deepStrictEqual(out.decision.changes, ['+bridges']);
        assert.strictEqual(out.decision.galaPaid, true);
        assert.strictEqual(JSON.stringify(gala(galaId)), snapGala, 'the paid gala row is byte-identical');
        const r = ca(caId);
        assert.strictEqual(r.gala_status, 'confirmed'); assert.strictEqual(r.gala_payment_status, 'paid'); assert.strictEqual(r.gala_registration_id, galaId);
        const msg = lastTo(email);
        assert.strictEqual(msg.kind, 'combined', 'the paid Gala rides along, exactly as the covered branch sends it');
        assert.deepStrictEqual(msg.legs, ['conference', 'bridges', 'gala']);
        assert.strictEqual(out.body.ticket_url, `${BASE}/gala/ticket/SIG/${galaId}`, 'the Gala ticket page, as the covered branch answers');
        assert.strictEqual(rowsFor(email).length, 1);
    });

    await t('(a) add a free leg while an UNPAID Gala is still wanted: leg added, NO ticket yet (one-ticket doctrine)', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, bridges: 0, gala: 1, session: 'cs_test_keep' });
        const before = sent.length;
        const out = await resubmit(email, { conference: true, bridges: true, gala: true });
        assert.deepStrictEqual(out.decision.changes, ['+bridges']);
        assert.strictEqual(out.decision.galaUnpaidKept, true);
        assert.strictEqual(ca(caId).bridges_status, 'pre-registered');
        assert.strictEqual(gala(galaId).status, 'awaiting_payment', 'the seat is kept as it was');
        assert.strictEqual(sent.length, before, 'no free-events QR while the seat is owed');
        assert.deepStrictEqual(expired, [], 'and its checkout is NOT expired');
        assert.strictEqual(out.body.status, 'awaiting_payment');
        assert.strictEqual(out.body.updated, true);
        assert.strictEqual(out.body.id, caId);
        assert.ok(/now also includes the Croatian Biomedical Bridges/.test(out.body.message) && /payment link/.test(out.body.message), out.body.message);
        assert.strictEqual(galaRowsFor(email).length, 1, 'no second seat');
    });

    // ==================== (b) ADD THE GALA → one seat minted and linked; Path B takes over ====================
    await t('(b) add the Gala to a Conference row: exactly ONE gala row minted, linked, awaiting payment; row count unchanged', async () => {
        const { caId, email } = makeLive({ conference: 1, bridges: 0, gala: 0 });
        const out = await resubmit(email, { conference: true, bridges: false, gala: true }, { needsInvoice: 1, invoiceDetailsJson: JSON.stringify({ company: 'KBC', address: 'Kišpatićeva 12', country: 'Croatia', vat: '' }) });
        assert.strictEqual(out.pathB, true, 'the route continues into its Path B checkout');
        assert.deepStrictEqual(out.decision.changes, ['+gala']);
        assert.deepStrictEqual(out.decision.legsAfter, { conference: true, bridges: false, gala: true });
        assert.strictEqual(rowsFor(email).length, 1, 'still ONE CA row');
        const galas = galaRowsFor(email);
        assert.strictEqual(galas.length, 1, 'exactly ONE gala row');
        const g = galas[0];
        assert.strictEqual(g.status, 'awaiting_payment'); assert.strictEqual(g.payment_status, 'pending');
        assert.strictEqual(g.first_name, 'Ivan'); assert.strictEqual(g.email, email);
        assert.strictEqual(Number(g.needs_invoice), 1); assert.ok(g.invoice_details.includes('KBC'));
        const r = ca(caId);
        assert.strictEqual(r.gala_registration_id, g.id, 'linked from the prior row');
        assert.strictEqual(Number(r.selected_gala), 1);
        assert.strictEqual(r.gala_status, 'awaiting_payment'); assert.strictEqual(r.gala_payment_status, 'pending');
        assert.strictEqual(r.stripe_session_id, null, 'the old session slot is cleared — Path B stamps the new one');
        assert.strictEqual(r.applied_for, 'Plexus Conference, Gala Evening');
        assert.strictEqual(out.applied.galaRegistrationId, g.id, 'the id Path B puts in the Stripe metadata');
        assert.strictEqual(out.applied.regId, caId, 'next to the PRIOR row id — the webhook settles that row');
    });

    await t('(b) server.js: Path B runs on the prior row id, only for a seat ADDED now, and answers updated:true', () => {
        const src = SERVER_SRC;
        assert.ok(src.includes("const regId = resub ? resub.prior.id : require('crypto').randomUUID();"), 'regId = the prior row on a resubmission');
        assert.ok(src.includes('finalGala = decision.adds.gala;'), 'Path B only when the Gala is the leg being added');
        assert.ok(src.includes('finalConf = decision.legsAfter.conference;') && src.includes('finalBridges = decision.legsAfter.bridges;'), 'bundle_* flags = the legs the row holds afterwards');
        assert.ok(/ca_registration_id: regId,\s*gala_registration_id: galaRegistrationId,/.test(src), 'the Stripe metadata still carries both ids');
        assert.ok(src.includes("return res.json({ success: true, id: regId, checkout_url: session.url, ...(resub ? { updated: true, changes: resub.applied.changes } : {}) });"), 'Path B response adds updated:true on a resubmission');
        assert.ok(src.includes("expireCheckout: stripe ? id => stripe.checkout.sessions.expire(id) : null"), 'the abandoned checkout is expired through Stripe when configured, skipped cleanly when not');
        assert.ok(/if \(!stripe\) \{\s*return res\.status\(500\)\.json\(\{ error: 'Payment processor not configured/.test(src), 'no Stripe → the clean "not configured" answer, as before');
        const galaInsert = src.indexOf('INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, dietary, requests, user_id, needs_invoice, invoice_details)', src.indexOf("app.post('/api/croatians-abroad/register'"));
        const elseBranch = src.lastIndexOf('} else {', galaInsert);
        assert.ok(elseBranch > 0 && src.slice(elseBranch - 400, elseBranch).includes('no new row'), 'the fresh INSERTs sit in the else of `if (resub)`');
    });

    await t('(b) after a dropped seat, re-adding the Gala mints a FRESH row — the cancelled one is not revived', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, gala: 1, session: 'cs_test_old' });
        await resubmit(email, { conference: true, bridges: false, gala: false });          // drop
        assert.strictEqual(gala(galaId).status, 'cancelled');
        const out = await resubmit(email, { conference: true, bridges: false, gala: true });   // re-add
        assert.strictEqual(out.pathB, true);
        const r = ca(caId);
        assert.ok(r.gala_registration_id && r.gala_registration_id !== galaId, 'a new seat id');
        assert.strictEqual(gala(r.gala_registration_id).status, 'awaiting_payment');
        assert.strictEqual(gala(galaId).status, 'cancelled', 'the old one stays cancelled');
        assert.strictEqual(rowsFor(email).length, 1);
    });

    // ==================== (c) DROP THE GALA (unpaid) → seat cancelled, checkout expired, ticket re-sent ====================
    await t('(c) drop an UNPAID Gala: leg + gala row cancelled, checkout expired, free-events ticket re-sent, row count unchanged', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, bridges: 1, gala: 1, session: 'cs_test_abandoned' });
        const before = sent.length;
        const out = await resubmit(email, { conference: true, bridges: true, gala: false });

        assert.deepStrictEqual(out.decision.changes, ['-gala']);
        assert.strictEqual(out.decision.dropGala, true);
        assert.strictEqual(rowsFor(email).length, 1, 'no new CA row');
        assert.strictEqual(galaRowsFor(email).length, 1, 'no new gala row');
        const g = gala(galaId);
        assert.strictEqual(g.status, 'cancelled', "the seat is soft-cancelled, the admin's convention");
        assert.strictEqual(g.payment_status, 'pending', 'the payment record is untouched');
        const r = ca(caId);
        assert.strictEqual(Number(r.selected_gala), 0, 'selected_gala 0 — every member-side reader keys on it');
        assert.strictEqual(r.gala_status, 'cancelled', 'and the leg reads cancelled');
        assert.strictEqual(r.gala_registration_id, galaId, 'the link to the cancelled seat is kept for the audit trail');
        assert.strictEqual(r.conference_status, 'pre-registered'); assert.strictEqual(r.bridges_status, 'pre-registered');
        assert.deepStrictEqual(expired.slice(-1), ['cs_test_abandoned'], 'the abandoned checkout is expired');
        assert.strictEqual(out.applied.droppedGalaId, galaId);
        assert.strictEqual(out.applied.checkoutExpired, true);
        assert.strictEqual(gate.getMarker(r.notes, resub.RESUBMIT_MARKER).endsWith(' -gala'), true);

        assert.strictEqual(sent.length, before + 1, 'exactly one email');
        const msg = lastTo(email);
        assert.strictEqual(msg.to, email);
        assert.strictEqual(msg.kind, 'free');
        assert.deepStrictEqual(msg.legs, ['conference', 'bridges'], 'the remaining legs');
        assert.strictEqual(msg.subject, "You're pre-registered — Plexus Week 2026");
        assert.ok(msg.html.includes('<strong>Plexus Conference</strong>') && msg.html.includes('<strong>Building Bridges Zagreb</strong>'));
        assert.ok(!msg.html.includes('<strong>Gala Evening</strong>'), 'no Gala on the re-sent ticket');
        assert.strictEqual(out.body.status, 'pre-registered');
        assert.strictEqual(out.body.updated, true);
        assert.strictEqual(out.body.id, caId);
        assert.strictEqual(out.body.ticket_url, `${BASE}/plexus/ticket/SIG/${caId}`);
        assert.ok(!sheetRows.some(s => s.regId === caId), 'nothing added → no new Sheet row');
    });

    await t('(c) drop the Gala AND add Bridges in one go: both applied, one ticket for Conference + Bridges', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, bridges: 0, gala: 1 });
        const before = sent.length;
        const out = await resubmit(email, { conference: true, bridges: true, gala: false });
        assert.deepStrictEqual(out.decision.changes, ['+bridges', '-gala']);
        assert.strictEqual(gala(galaId).status, 'cancelled');
        assert.strictEqual(ca(caId).bridges_status, 'pre-registered');
        assert.strictEqual(Number(ca(caId).selected_gala), 0);
        assert.strictEqual(sent.length, before + 1);
        assert.deepStrictEqual(lastTo(email).legs, ['conference', 'bridges']);
        assert.deepStrictEqual(sheetRows[sheetRows.length - 1].events, ['bridges']);
    });

    await t('(c) a stale prior row whose gala row is gone still owes nothing after the drop', async () => {
        const { caId, email } = makeLive({ conference: 1, gala: 1, galaRow: false });
        assert.strictEqual(ca(caId).gala_registration_id, null);
        const out = await resubmit(email, { conference: true, bridges: false, gala: false });
        assert.strictEqual(out.decision.dropGala, true, 'gala_status awaiting_payment with no row is still an owed seat');
        const r = ca(caId);
        assert.strictEqual(Number(r.selected_gala), 0); assert.strictEqual(r.gala_status, 'cancelled');
        assert.strictEqual(lastTo(email).kind, 'free');
    });

    await t('(c) no Stripe configured (expireCheckout null): the drop still applies, nothing throws', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, gala: 1, session: 'cs_test_nostripe' });
        const n = expired.length;
        const out = await resubmit(email, { conference: true, bridges: false, gala: false }, {}, { expireCheckout: null });
        assert.strictEqual(gala(galaId).status, 'cancelled');
        assert.strictEqual(Number(ca(caId).selected_gala), 0);
        assert.strictEqual(expired.length, n, 'no expire attempted');
        assert.strictEqual(out.applied.checkoutExpired, false);
    });

    await t('(c) a Stripe expire that throws (session already lapsed) is swallowed — the drop stands', async () => {
        const { galaId, email } = makeLive({ conference: 1, gala: 1, session: 'cs_test_lapsed' });
        const out = await resubmit(email, { conference: true, bridges: false, gala: false }, {}, { expireCheckout: async () => { throw new Error('No such checkout.session'); } });
        assert.strictEqual(gala(galaId).status, 'cancelled');
        assert.strictEqual(out.applied.checkoutExpired, false);
    });

    // ==================== (d) A PAID GALA IS NEVER TOUCHED ====================
    await t('(d) drop the Gala when the seat is PAID: nothing changes, the covered branch answers', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, bridges: 0, gala: 1, galaPaid: true });
        const snapCa = JSON.stringify(ca(caId)), snapGala = JSON.stringify(gala(galaId));
        const before = sent.length, nExp = expired.length;
        const out = await resubmit(email, { conference: true, bridges: false, gala: false });
        assert.strictEqual(out.covered, true, 'a paid seat is not dropped → nothing to change → existing branch');
        assert.strictEqual(out.decision.dropGala, false);
        assert.strictEqual(out.decision.galaPaid, true);
        assert.strictEqual(JSON.stringify(ca(caId)), snapCa, 'the CA row is byte-identical');
        assert.strictEqual(JSON.stringify(gala(galaId)), snapGala, 'the gala row is byte-identical');
        assert.strictEqual(sent.length, before, 'this harness sends nothing on the covered branch (the route re-sends the combined ticket, as before)');
        assert.strictEqual(expired.length, nExp);
    });

    await t('(d) every paid indicator protects the seat: CA paid, CA confirmed, row paid, row confirmed, vip-comp, comp', () => {
        const base = { selected_conference: 1, conference_status: 'pre-registered', selected_gala: 1, gala_status: 'awaiting_payment', gala_payment_status: 'pending' };
        const want = { conference: true, bridges: false, gala: false };
        const cases = [
            [{ ...base, gala_payment_status: 'paid' }, { status: 'awaiting_payment', payment_status: 'pending' }],
            [{ ...base, gala_status: 'confirmed' }, { status: 'awaiting_payment', payment_status: 'pending' }],
            [base, { status: 'approved', payment_status: 'paid' }],
            [base, { status: 'confirmed', payment_status: 'pending' }],
            [base, { status: 'approved', payment_status: 'vip-comp' }],
            [base, { status: 'vip-comp', payment_status: null }],
            [base, { status: 'approved', payment_status: 'comp' }]
        ];
        for (const [prior, priorGala] of cases) {
            const d = resub.decide({ prior, priorGala, want });
            assert.strictEqual(d.galaPaid, true, JSON.stringify([prior, priorGala]));
            assert.strictEqual(d.dropGala, false);
            assert.strictEqual(d.covered, true);
            assert.strictEqual(resub.decide({ prior, priorGala, want: { ...want, gala: true } }).adds.gala, false, 'and it is never re-minted');
        }
    });

    await t('(d) apply() refuses at the SQL too: a seat that turned paid between read and write is kept, and the CA leg with it', async () => {
        const { caId, galaId, email } = makeLive({ conference: 1, gala: 1 });
        const { prior, priorGala } = priorFor(email);
        const decision = resub.decide({ prior, priorGala, want: { conference: true, bridges: false, gala: false } });
        assert.strictEqual(decision.dropGala, true);
        db.run("UPDATE gala_registrations SET payment_status = 'paid', status = 'confirmed' WHERE id = ?", [galaId]);   // the webhook lands first
        const applied = await resub.apply(applyDeps(), { prior, priorGala, decision, form: {} });
        assert.strictEqual(gala(galaId).status, 'confirmed', 'not cancelled');
        assert.strictEqual(Number(ca(caId).selected_gala), 1, 'the CA leg is kept');
        assert.strictEqual(ca(caId).gala_status, 'awaiting_payment', 'exactly as it was (the webhook stamps confirmed on its own path)');
        assert.strictEqual(applied.droppedGalaId, null);
        assert.deepStrictEqual(applied.changes, [], 'and the marker records no drop');
    });

    // ==================== (e) FULLY REGISTERED → the existing branch, unchanged ====================
    await t('(e) the same legs again → covered → the route\'s existing "already registered" branch, untouched', async () => {
        const free = makeLive({ conference: 1, bridges: 1, gala: 0 });
        assert.strictEqual((await resubmit(free.email, { conference: true, bridges: true, gala: false })).covered, true, 'free legs');
        assert.strictEqual((await resubmit(free.email, { conference: true, bridges: false, gala: false })).covered, true, 'a subset of the free legs');
        const unpaid = makeLive({ conference: 1, gala: 1 });
        assert.strictEqual((await resubmit(unpaid.email, { conference: true, bridges: false, gala: true })).covered, true, 'an unpaid seat still wanted → "the payment link completes it"');
        const paid = makeLive({ conference: 1, gala: 1, galaPaid: true });
        assert.strictEqual((await resubmit(paid.email, { conference: true, bridges: false, gala: true })).covered, true, 'a paid seat → the combined ticket again');
        assert.strictEqual(rowsFor(free.email).length + rowsFor(unpaid.email).length + rowsFor(paid.email).length, 3, 'nothing written');

        // and the branch itself is still there, word for word
        const src = SERVER_SRC;
        assert.ok(src.includes('if (decision.covered) {'), 'the covered branch is gated on the module decision');
        assert.ok(src.includes("return res.json({ success: true, id: prior.id, status: 'awaiting_payment', duplicate: true,"), 'the unpaid-seat answer');
        assert.ok(src.includes("message: 'You are already registered — the Gala payment link in your email completes it.' });"));
        assert.ok(src.includes("return res.json({ success: true, id: prior.id, status: 'pre-registered', duplicate: true,"), 'the re-sent ticket answer');
        assert.ok(src.includes("console.log(`[CA register] duplicate submission for ${email} → existing ${prior.id} answered, nothing written`);"));
    });

    // ==================== the gate, the guard order and the wiring ====================
    await t('server.js: a resubmission the review gate would HOLD never rewrites the live row — it falls through to the held path', () => {
        const src = SERVER_SRC;
        const i = src.indexOf("app.post('/api/croatians-abroad/register'");
        const guard = src.indexOf('const decision = caResubmit.decide({ prior, priorGala, want: { conference: wantConf, bridges: wantBridges, gala: wantGala } });', i);
        const gateCalc = src.indexOf('const gateHeld = gateGibberish || gateCountryHold || gateCoherenceHold;', i);
        const priorHeld = src.indexOf("if (priorHeld) return res.json({ success: true, id: priorHeld.id, status: 'pending-review', held: true });", i);
        assert.ok(gateCalc > 0 && gateCalc < guard, 'the gate verdict is computed BEFORE the resubmission decision');
        assert.ok(priorHeld > 0 && priorHeld < guard, 'and an address the gate is still holding is answered before it');
        assert.ok(/if \(!gateHeld\) \{\s*resub = \{ prior, priorGala, decision \};/.test(src), 'resub is set only when the gate passes');
        assert.ok(src.includes("'Already registered': `YES — live registration ${priorLive.id}"), 'the review email names the live row when a held payload falls through');
        const held = src.indexOf('// ---------- HELD: review gate — stop here', i);
        const resubA = src.indexOf('if (resub && !finalGala) {', i);
        const pathA = src.indexOf('// ---------- PATH A: Free-only (no Gala) → confirm immediately ----------', i);
        assert.ok(held > 0 && held < resubA && resubA < pathA, 'held → resubmission finish → fresh Path A, in that order');
        assert.ok(src.includes('const body = await caResubmit.finishFree({') && src.includes('sendPreRegConfirmation: caSendPreRegConfirmation, mirrorToSheets: caMirrorPreRegToSheets,'), 'finishFree is handed the real ticket sender and Sheets mirror');
    });

    await t('server.js: guests on a resubmission — seats re-priced only for a Gala added now, guests merged by identity', () => {
        const src = SERVER_SRC;
        assert.ok(src.includes("if (!resub || finalGala) db.run('UPDATE croatians_abroad_registrations SET guest_count = ? WHERE id = ?', [galaGuestCount, regId]);"), 'guest_count untouched for a kept seat');
        assert.ok(src.includes('const existing = resub ? caGuestRows(regId) : [];') && src.includes('const known = existing.find(a => sameGuest(a, g));'), 're-listed guests are merged, not duplicated');
    });

    await t('decide(): truth table for adds / drop / covered', () => {
        const live = { selected_conference: 1, conference_status: 'pre-registered', selected_bridges: 0, bridges_status: null, selected_gala: 0, gala_status: null, gala_payment_status: null };
        const d1 = resub.decide({ prior: live, priorGala: null, want: { conference: true, bridges: false, gala: false } });
        assert.strictEqual(d1.covered, true);
        const d2 = resub.decide({ prior: live, priorGala: null, want: { conference: false, bridges: true, gala: false } });
        assert.deepStrictEqual(d2.adds, { conference: false, bridges: true, gala: false });
        assert.deepStrictEqual(d2.legsAfter, { conference: true, bridges: true, gala: false }, 'the Conference is kept even though it was not re-ticked');
        const d3 = resub.decide({ prior: live, priorGala: null, want: { conference: false, bridges: false, gala: true } });
        assert.deepStrictEqual(d3.changes, ['+gala']);
        assert.deepStrictEqual(d3.legsAfter, { conference: true, bridges: false, gala: true });
        // an admin-cancelled Conference leg is re-activated by a resubmission that asks for it (as a new row would have)
        const cancelledConf = { ...live, conference_status: 'cancelled', selected_bridges: 1, bridges_status: 'pre-registered' };
        assert.deepStrictEqual(resub.decide({ prior: cancelledConf, priorGala: null, want: { conference: true, bridges: true, gala: false } }).changes, ['+conference']);
        // a gala row already cancelled (admin) with selected_gala still 1: not owed, not dropped; wanting it again adds a fresh seat
        const galaCancelled = { ...live, selected_gala: 1, gala_status: 'cancelled', gala_payment_status: 'pending' };
        const d4 = resub.decide({ prior: galaCancelled, priorGala: { status: 'cancelled', payment_status: 'pending' }, want: { conference: true, bridges: false, gala: false } });
        assert.strictEqual(d4.covered, true);
        assert.strictEqual(resub.decide({ prior: galaCancelled, priorGala: { status: 'cancelled', payment_status: 'pending' }, want: { conference: true, bridges: false, gala: true } }).adds.gala, true);
        // an approved-but-unpaid seat (pay link sent) is owed → dropped when left out
        const approved = { ...live, selected_gala: 1, gala_status: 'awaiting_payment', gala_payment_status: 'pending' };
        assert.strictEqual(resub.decide({ prior: approved, priorGala: { status: 'approved', payment_status: 'pending', pay_token: 'x' }, want: { conference: true, bridges: false, gala: false } }).dropGala, true);
    });

    await t('mergeNotes(): free text appended once, markers kept, RESUBMITTED stamped and replaced on the next one', () => {
        const n1 = resub.mergeNotes('GALA-PAYLINK-SENT 2026-09-10', 'allergic to nuts', ['+bridges'], '2026-09-17');
        assert.strictEqual(gate.getMarker(n1, 'GALA-PAYLINK-SENT'), '2026-09-10');
        assert.ok(n1.includes('allergic to nuts'));
        assert.strictEqual(gate.getMarker(n1, 'RESUBMITTED'), '2026-09-17 +bridges');
        const n2 = resub.mergeNotes(n1, 'allergic to nuts', ['-gala'], '2026-09-18');
        assert.strictEqual((n2.match(/allergic to nuts/g) || []).length, 1, 'the same note is not appended twice');
        assert.strictEqual(gate.getMarker(n2, 'RESUBMITTED'), '2026-09-18 -gala', 'one RESUBMITTED marker, the latest');
        assert.strictEqual(resub.mergeNotes('', '', [], '2026-09-17'), 'RESUBMITTED 2026-09-17');
    });

    await t('no email escaped the stub and no network was touched', () => {
        assert.ok(sent.every(m => typeof m.to === 'string' && m.html.length > 100));
        let threw = false;
        try { global.fetch('https://api.brevo.com/v3/smtp/email'); } catch (e) { threw = /NETWORK DISABLED/.test(e.message); }
        assert.ok(threw, 'fetch is disabled for the whole run');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
