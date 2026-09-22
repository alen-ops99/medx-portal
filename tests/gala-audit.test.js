/**
 * tests/gala-audit.test.js — the Gala payment auditor (user-portal/backend/gala-audit.js).
 *
 * Alen, 22 Sept 2026: "an auditor for every person that pays the Gala, to make sure everything
 * regarding payment, the total cost and the FIRA invoice is correct; if not, double-check, and
 * if it's really incorrect notify me immediately."
 *
 * Hermetic, in the shape of tests/ca-approve-paylink.test.js: a scratch in-memory sqlite
 * (node:sqlite) carrying the REAL gala_registrations / croatians_abroad_registrations /
 * ca_registration_guests / gala_settings / finance_transactions / promo_codes columns the auditor
 * reads, a capturing sendEmail stub, an injected timer queue in place of the 90 s setTimeout, a
 * fake Stripe client, and global.fetch disabled. NO EMAIL, NO NETWORK, NO STRIPE CALL IS POSSIBLE.
 *
 * Run:  node tests/gala-audit.test.js
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- hermetic env
delete process.env.BREVO_API_KEY;
delete process.env.GALA_AUDIT_DISABLED;
delete process.env.GALA_AUDIT_ALERT_TO;
process.env.FIRA_API_KEY = 'test-key';          // fira.isConfigured() → true, so the 'fira' check is live
process.env.NODE_ENV = 'test';
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const audit = require('../user-portal/backend/gala-audit.js');
const fira = require('../user-portal/backend/fira-service.js');

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

// ---------------------------------------------------------------- scratch sqlite (real columns)
const raw = new DatabaseSync(':memory:');
raw.exec(`CREATE TABLE gala_registrations (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
    institution TEXT, title TEXT, dietary TEXT, requests TEXT, pricing TEXT,
    status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'unpaid', amount_paid REAL, invoice_number TEXT,
    stripe_session_id TEXT, pay_token TEXT, guest_count INTEGER DEFAULT 0, user_id TEXT,
    admin_notes TEXT, needs_invoice INTEGER DEFAULT 0, invoice_details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE croatians_abroad_registrations (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT, email TEXT NOT NULL,
    institution TEXT, country TEXT, notes TEXT, selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0,
    gala_status TEXT, gala_payment_status TEXT, gala_registration_id TEXT, stripe_session_id TEXT, amount_paid REAL, invoice_number TEXT,
    guest_count INTEGER DEFAULT 0, source TEXT DEFAULT 'plexus', created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE ca_registration_guests (
    id TEXT PRIMARY KEY, registration_id TEXT, name TEXT, institution TEXT, email TEXT,
    conference INTEGER DEFAULT 0, bridges INTEGER DEFAULT 0, gala INTEGER DEFAULT 0, ticket_sent_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE gala_settings (
    id TEXT PRIMARY KEY DEFAULT 'default', price_gala_only REAL, price_gala_early_bird REAL, price_gala_regular REAL, early_bird_deadline TEXT
)`);
raw.exec(`CREATE TABLE finance_transactions (
    id TEXT PRIMARY KEY, transaction_number TEXT UNIQUE, transaction_type TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL,
    description TEXT, project TEXT, work_unit_id TEXT, category TEXT, payment_method TEXT, reference TEXT, status TEXT DEFAULT 'completed',
    fiscal_year INTEGER, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE promo_codes (id TEXT PRIMARY KEY, code TEXT, event_type TEXT, discount_type TEXT, discount_value REAL, used_count INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1)`);
// Live production values (Turso, 2026-09-22): early-bird €150 until 1 Oct, then €175.
raw.exec(`INSERT INTO gala_settings (id, price_gala_only, price_gala_early_bird, price_gala_regular, early_bird_deadline) VALUES ('default', 150, 150, 175, '2026-10-01')`);

const query = {
    get: (sql, params = []) => { const r = raw.prepare(sql).get(...params); return r === undefined ? null : r; },
    all: (sql, params = []) => raw.prepare(sql).all(...params)
};
const db = { run: (sql, params = []) => { params.length ? raw.prepare(sql).run(...params) : raw.exec(sql); } };

// ---------------------------------------------------------------- stubs
const sent = [];
const sendEmail = async (to, subject, html) => { sent.push({ to, subject, html }); return { success: true }; };
const timers = [];                                             // the injected 90 s retry queue
const defer = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
async function runTimers() { while (timers.length) { const { fn } = timers.shift(); await fn(); } }
const stripeSessions = {};                                     // id → session, what the fake Stripe returns on re-audit
const fakeStripe = { checkout: { sessions: { retrieve: async id => { if (!stripeSessions[id]) throw new Error(`No such checkout.session: ${id}`); return stripeSessions[id]; } } } };
let NOW = new Date('2026-09-22T12:00:00Z');

const deps = (over = {}) => ({
    query, db, saveDb: () => {}, flushDb: () => {},
    sendEmail, defer, retryMs: 90000, stripe: () => fakeStripe, fira,
    now: () => NOW, log: () => {}, adminBase: 'https://medx-admin-portal.onrender.com',
    epoch: '2026-09-22T00:00:00Z',                 // "the auditor went live" — before NOW, so post-epoch rules apply
    ...over
});
const A = audit.create(deps());

// ---------------------------------------------------------------- fixtures
let seq = 0;
const isoNow = () => NOW.toISOString().slice(0, 19).replace('T', ' ');
function seatOrder({ invoice, name, seats, unit, brutto, paymentType = 'KARTICA' }) {
    // The exact shape fira-service's 0%-VAT retry POSTs (the account is not in PDV).
    return { webshopType: 'CUSTOM', webshopOrderNumber: invoice, invoiceType: 'FISKALNI_RAČUN', paymentType, currency: 'EUR', taxesIncluded: true,
        lineItems: [{ name: 'Plexus 2026 — Gala Evening seat', price: unit, quantity: seats, taxRate: 0, unit: 'kom' }],
        netto: brutto, taxValue: 0, brutto, taxExempt: true, billingAddress: { name, country: 'HR' } };
}
function paidRow(over = {}) {
    const n = ++seq;
    const f = Object.assign({
        first_name: 'Ana', last_name: `Payer${n}`, email: `payer${n}@hermetic.invalid`, guests: 0, unit: 150,
        invoice: `CA-GALA-2026-9${String(n).padStart(3, '0')}`, withCa: true, ledger: true, sessionAmountCents: null, discount: 0, coupon: '', created: null
    }, over);
    const createdAt = f.created || isoNow();
    const seats = 1 + f.guests;
    const amount = Math.round((seats * f.unit - f.discount) * 100) / 100;
    const galaId = crypto.randomUUID(), caId = f.withCa ? crypto.randomUUID() : null, sessionId = `cs_test_${n}_${crypto.randomBytes(4).toString('hex')}`;
    db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, amount_paid, invoice_number, stripe_session_id, guest_count, created_at)
            VALUES (?,?,?,?,'confirmed','paid',?,?,?,?,?)`, [galaId, f.first_name, f.last_name, f.email, amount, f.invoice, sessionId, f.guests, createdAt]);
    if (caId) db.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_gala, gala_status, gala_payment_status, gala_registration_id, stripe_session_id, amount_paid, invoice_number, guest_count, created_at)
                      VALUES (?,?,?,?,1,'confirmed','paid',?,?,?,?,?,?)`, [caId, f.first_name, f.last_name, f.email, galaId, sessionId, amount, f.invoice, f.guests, createdAt]);
    if (f.ledger) db.run(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, payment_method, reference, fiscal_year)
                          VALUES (?,?,?,?,?,?,?,?,?,?,2026)`, [crypto.randomUUID(), `P-2026-T${n}`, 'income', f.ledgerAmount != null ? f.ledgerAmount : amount, NOW.toISOString().slice(0, 10), `Gala 2026 (CA) — ${f.first_name} ${f.last_name}`, 'gala-2026', 'gala-ticket', 'card', f.invoice]);
    const session = { id: sessionId, payment_status: 'paid', amount_total: f.sessionAmountCents != null ? f.sessionAmountCents : Math.round(amount * 100), currency: 'eur', created: Math.floor(NOW.getTime() / 1000),
        metadata: { type: caId ? 'croatians-abroad-gala' : 'gala-ticket', gala_registration_id: galaId, ca_registration_id: caId || '', invoice_number: f.invoice, guest_count: String(f.guests), discount_amount: String(f.discount), coupon_code: f.coupon } };
    stripeSessions[sessionId] = session;
    const name = `${f.first_name} ${f.last_name}`;
    const firaResult = { firaId: `fira-${n}`, invoiceNumber: `${n}/1/1`, status: 'ok', rawResponse: { id: `fira-${n}`, invoiceNumber: `${n}/1/1` },
        order: seatOrder({ invoice: f.invoice, name, seats, unit: f.firaUnit != null ? f.firaUnit : Math.round((amount / seats) * 100) / 100, brutto: f.firaBrutto != null ? f.firaBrutto : amount }) };
    return { galaId, caId, sessionId, session, amount, seats, name, email: f.email, invoice: f.invoice, firaResult };
}
const byCheck = (checks, name) => checks.find(c => c.check === name);
const failingNames = checks => checks.filter(c => c.ok === false).map(c => c.check);

// ================================================================ tests
(async () => {
    console.log('\ngala-audit — the Gala payment auditor\n');

    await t('a correct payment passes every check and is stored silently as ok', async () => {
        const r = paidRow({ guests: 1 });
        const out = await A.auditPayment({ galaRegId: r.galaId, caRegId: r.caId, stripeSession: r.session, amount: r.amount, invoiceNumber: r.invoice, firaResult: r.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(out.status, 'ok', JSON.stringify(out.checks, null, 1));
        assert.deepStrictEqual(out.checks.map(c => c.check), ['charge', 'price', 'seats', 'fira', 'ledger', 'duplicates', 'ticket']);
        assert.ok(out.checks.every(c => c.ok === true), 'every check true: ' + JSON.stringify(out.checks));
        assert.strictEqual(byCheck(out.checks, 'price').expected, '2 × €150 = €300');
        assert.strictEqual(byCheck(out.checks, 'fira').actual, '2 × €150 = €300 = €300, 1/1/1');
        const row = A.getAudit(r.galaId);
        assert.strictEqual(row.status, 'ok');
        assert.strictEqual(row.seats, 2);
        assert.strictEqual(Number(row.amount_paid), 300);
        assert.ok(row.fira_json && JSON.parse(row.fira_json).order.lineItems[0].quantity === 2, 'the FIRA payload is persisted for re-audits');
        assert.strictEqual(sent.length, 0, 'no email for a passing audit');
        assert.strictEqual(timers.length, 0, 'no retry scheduled');
    });

    await t('charge mismatch → retrying, re-run after 90 s still failing → failed + exactly ONE alert with expected/actual lines', async () => {
        sent.length = 0;
        const r = paidRow({ guests: 0, sessionAmountCents: 17500 });         // Stripe took €175, the row says €150
        const first = await A.auditPayment({ galaRegId: r.galaId, caRegId: r.caId, stripeSession: r.session, amount: r.amount, invoiceNumber: r.invoice, firaResult: r.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(first.status, 'retrying');
        assert.deepStrictEqual(failingNames(first.checks), ['charge']);
        assert.strictEqual(A.getAudit(r.galaId).status, 'retrying');
        assert.strictEqual(sent.length, 0, 'nothing is sent on the first failure');
        assert.strictEqual(timers.length, 1);
        assert.strictEqual(timers[0].ms, 90000, 'the double-check waits 90 s');
        await runTimers();                                                   // fresh rows, Stripe still says 17500
        const row = A.getAudit(r.galaId);
        assert.strictEqual(row.status, 'failed');
        assert.ok(row.alerted_at, 'alerted_at stamped');
        assert.strictEqual(sent.length, 1, 'exactly one alert');
        const m = sent[0];
        assert.strictEqual(m.to, 'juginovic.alen@gmail.com');
        assert.strictEqual(m.subject, `⚠ Gala payment audit failed — ${r.name} · ${r.invoice}`);
        assert.ok(m.html.includes(r.email) && m.html.includes('€150') && m.html.includes(r.invoice), 'person, amount, invoice in the body');
        assert.ok(/charge<\/b>: expected <b>15000 cents, paid<\/b> &middot; actual <b[^>]*>17500 cents, paid<\/b>/.test(m.html), 'expected vs actual for the failing check: ' + m.html.slice(m.html.indexOf('Failing checks'), m.html.indexOf('Failing checks') + 400));
        assert.ok(m.html.includes('payment itself: succeeded (Stripe collected €175'), 'payment itself line');
        assert.ok(m.html.includes('https://medx-admin-portal.onrender.com/#gala'), 'link to the admin Gala card');
        assert.ok(!m.html.includes('price</b>: expected'), 'passing checks are not listed as failing');
        // A third run (manual rerun, still wrong) never sends a second email.
        const again = await A.auditPayment({ galaRegId: r.galaId, secondPass: true, reason: 'manual' });
        assert.strictEqual(again.status, 'failed');
        assert.strictEqual(sent.length, 1, 'still exactly one alert');
    });

    await t('FIRA line unit × quantity ≠ brutto (the 2026-09-22 bug shape) → failed after the double-check', async () => {
        sent.length = 0;
        const r = paidRow({ guests: 1, firaUnit: 300 });                     // 2 × €300 printed, €300 total
        const first = await A.auditPayment({ galaRegId: r.galaId, caRegId: r.caId, stripeSession: r.session, amount: r.amount, invoiceNumber: r.invoice, firaResult: r.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(first.status, 'retrying');
        assert.deepStrictEqual(failingNames(first.checks), ['fira']);
        assert.ok(byCheck(first.checks, 'fira').actual.includes('lines sum €600 ≠ brutto €300'), byCheck(first.checks, 'fira').actual);
        await runTimers();                                                   // second pass reads the STORED payload back
        assert.strictEqual(A.getAudit(r.galaId).status, 'failed');
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].html.includes('lines sum €600 ≠ brutto €300'), 'the printed-line defect is in the email');
        assert.ok(byCheck(JSON.parse(A.getAudit(r.galaId).checks_json), 'fira').note === 'from the payload stored at creation', 'second pass used the persisted FIRA payload');
    });

    await t('a FIRA buyer that is not the registrant, or a bank payment type on a card payment, fails the fira check', async () => {
        const r = paidRow({ guests: 0 });
        r.firaResult.order.billingAddress.name = 'Some Institution d.o.o.';
        r.firaResult.order.paymentType = 'TRANSAKCIJSKI';
        const out = await A.auditPayment({ galaRegId: r.galaId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true }, noRetry: true, reason: 'webhook' });
        const f = byCheck(out.checks, 'fira');
        assert.strictEqual(f.ok, false);
        assert.ok(f.actual.includes('buyer "Some Institution d.o.o."') && f.actual.includes('paymentType TRANSAKCIJSKI'), f.actual);
    });

    await t('a second PAID row with the same email is flagged as a possible double charge', async () => {
        sent.length = 0;
        const a = paidRow({ guests: 0, email: 'twice@hermetic.invalid' });
        const okOut = await A.auditPayment({ galaRegId: a.galaId, stripeSession: a.session, firaResult: a.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(okOut.status, 'ok');
        const b = paidRow({ guests: 0, email: 'TWICE@hermetic.invalid' });          // same person, different case
        const out = await A.auditPayment({ galaRegId: b.galaId, stripeSession: b.session, firaResult: b.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(out.status, 'retrying');
        assert.deepStrictEqual(failingNames(out.checks), ['duplicates']);
        assert.ok(byCheck(out.checks, 'duplicates').actual.includes(a.invoice), 'names the other paid row');
        await runTimers();
        assert.strictEqual(A.getAudit(b.galaId).status, 'failed');
        assert.strictEqual(sent.length, 1);
        assert.ok(sent[0].html.includes('double charge unless it is a different party'));
    });

    await t('a failure that resolves by the second run (replica lag) ends ok with no alert', async () => {
        sent.length = 0;
        const r = paidRow({ guests: 1, ledger: false });                    // the ledger row is "late"
        const first = await A.auditPayment({ galaRegId: r.galaId, caRegId: r.caId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(first.status, 'retrying');
        assert.deepStrictEqual(failingNames(first.checks), ['ledger']);
        // ...the income row lands before the 90 s re-check
        db.run(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, payment_method, reference, fiscal_year) VALUES (?,?,?,?,?,?,?,2026)`,
            [crypto.randomUUID(), 'P-2026-LATE', 'income', r.amount, '2026-09-22', 'card', r.invoice]);
        await runTimers();
        assert.strictEqual(A.getAudit(r.galaId).status, 'ok');
        assert.strictEqual(sent.length, 0, 'no alert');
    });

    await t('GALA_AUDIT_DISABLED=1: the verdict is still stored, no alert leaves, the sweep does not run', async () => {
        sent.length = 0;
        process.env.GALA_AUDIT_DISABLED = '1';
        try {
            const r = paidRow({ guests: 0, sessionAmountCents: 1 });
            await A.auditPayment({ galaRegId: r.galaId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true }, reason: 'webhook' });
            await runTimers();
            assert.strictEqual(A.getAudit(r.galaId).status, 'failed');
            assert.strictEqual(A.getAudit(r.galaId).alerted_at, null);
            assert.strictEqual(sent.length, 0);
            const sw = await A.sweep();
            assert.deepStrictEqual(sw, { skipped: true });
            // Fixture cleanup: with alerts back on, a sweep would (rightly) page this never-alerted
            // failure — keep it out of the later sweep tests.
            db.run('DELETE FROM gala_payment_audits WHERE gala_registration_id = ?', [r.galaId]);
            db.run('DELETE FROM gala_registrations WHERE id = ?', [r.galaId]);
        } finally { delete process.env.GALA_AUDIT_DISABLED; }
    });

    await t('the sweep audits a paid row nobody audited (missed webhook) and settles a row left retrying by a restart', async () => {
        sent.length = 0; timers.length = 0;
        const missed = paidRow({ guests: 0, created: '2026-09-15 10:00:00' });   // paid before the auditor existed, never audited
        const stuck = paidRow({ guests: 0, sessionAmountCents: 99 });        // failed once, process restarted before the 90 s timer
        await A.auditPayment({ galaRegId: stuck.galaId, stripeSession: stuck.session, firaResult: stuck.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        timers.length = 0;                                                   // "restart": the in-memory timer is gone
        assert.strictEqual(A.getAudit(stuck.galaId).status, 'retrying');
        const cands = A.sweepCandidates().map(c => c.id);
        assert.ok(cands.includes(missed.galaId), 'unaudited paid row is a candidate');
        assert.ok(cands.includes(stuck.galaId), 'retrying row is a candidate');
        const tally = await A.sweep();
        assert.ok(tally.candidates >= 2, JSON.stringify(tally));
        // missed: re-audit from scratch — Stripe fetched by id, FIRA lines not verifiable (no stored
        // payload, pre-epoch), the ticket via the Brevo log which is off in tests → skipped.
        const m = A.getAudit(missed.galaId);
        assert.strictEqual(m.status, 'ok', m.checks_json);
        const mc = JSON.parse(m.checks_json);
        assert.strictEqual(byCheck(mc, 'charge').actual, `${missed.amount * 100} cents, paid`);
        assert.ok(byCheck(mc, 'fira').note.includes('not verifiable'));
        // stuck: its second pass happens in the sweep → failed → alerted once
        assert.strictEqual(A.getAudit(stuck.galaId).status, 'failed');
        assert.strictEqual(sent.filter(m => m.subject.includes(stuck.name)).length, 1);
        // a second sweep: the failed rows take a decisive pass (no flapping back to retrying), nothing more is sent
        const before = sent.length;
        await A.sweep();
        assert.strictEqual(sent.length, before);
        assert.strictEqual(A.getAudit(stuck.galaId).status, 'failed', 'an already-alerted failure stays failed');
        assert.ok(!A.sweepCandidates().map(c => c.id).includes(missed.galaId), 'an ok row leaves the sweep');
    });

    await t('a row paid AFTER the auditor went live with no FIRA record is a failure (was the fiscal invoice created?)', async () => {
        const r = paidRow({ guests: 0 });
        const out = await A.auditPayment({ galaRegId: r.galaId, stripeSession: r.session, firaError: 'FIRA API returned 500: boom', ticketSend: { success: true }, noRetry: true, reason: 'webhook' });
        assert.strictEqual(byCheck(out.checks, 'fira').ok, false);
        assert.ok(byCheck(out.checks, 'fira').note.includes('boom'));
        // ...and the re-audit (no webhook evidence, nothing stored) still says so
        const again = await A.runChecks({ galaRegId: r.galaId });
        assert.strictEqual(byCheck(again.checks, 'fira').ok, false);
        assert.ok(byCheck(again.checks, 'fira').note.includes('after the auditor went live'));
    });

    await t('price: a coupon discount and the regular price after the early-bird deadline are both honoured', async () => {
        const r = paidRow({ guests: 1, discount: 150, coupon: 'GALA-PLEXUS-50' });   // 2 × 150 − 150 = 150
        const out = await A.auditPayment({ galaRegId: r.galaId, caRegId: r.caId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true }, noRetry: true, reason: 'webhook' });
        assert.strictEqual(byCheck(out.checks, 'price').ok, true, JSON.stringify(byCheck(out.checks, 'price')));
        assert.strictEqual(byCheck(out.checks, 'price').expected, '2 × €150 − €150 = €150');
        // after the deadline: €175 is right, €150 is wrong (unless a Forum member — no forum_members table here)
        const saved = NOW; NOW = new Date('2026-10-20T12:00:00Z');
        try {
            const late = paidRow({ guests: 0, unit: 175 });
            const lateOut = await A.auditPayment({ galaRegId: late.galaId, stripeSession: late.session, firaResult: late.firaResult, ticketSend: { success: true }, noRetry: true, reason: 'webhook' });
            assert.strictEqual(byCheck(lateOut.checks, 'price').ok, true, JSON.stringify(byCheck(lateOut.checks, 'price')));
            const stale = paidRow({ guests: 0, unit: 150 });
            const staleOut = await A.auditPayment({ galaRegId: stale.galaId, stripeSession: stale.session, firaResult: stale.firaResult, ticketSend: { success: true }, noRetry: true, reason: 'webhook' });
            assert.strictEqual(byCheck(staleOut.checks, 'price').ok, false);
            assert.strictEqual(byCheck(staleOut.checks, 'price').expected, '1 × €175 = €175');
            assert.strictEqual(byCheck(staleOut.checks, 'price').actual, '€150');
        } finally { NOW = saved; }
    });

    await t('a seat-code (SLOVENIA-PLEXUS) settlement: no Stripe, no FIRA, price = k × seat price, never paged', async () => {
        const galaId = crypto.randomUUID(), caId = crypto.randomUUID();
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, amount_paid, guest_count, requests, created_at)
                VALUES (?,?,?,?,'confirmed','paid',300,1,'Allergies: None | Gala paid by bank transfer — code SLOVENIA-PLEXUS',?)`, [galaId, 'Radko', 'Komadina', 'radko@hermetic.invalid', isoNow()]);
        db.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_gala, gala_status, gala_payment_status, gala_registration_id, amount_paid, guest_count, created_at)
                VALUES (?,?,?,?,1,'confirmed','paid',?,300,1,?)`, [caId, 'Radko', 'Komadina', 'radko@hermetic.invalid', galaId, isoNow()]);
        const out = await A.auditPayment({ galaRegId: galaId, caRegId: caId, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(out.status, 'ok', JSON.stringify(out.checks));
        assert.ok(byCheck(out.checks, 'charge').note.includes('seat code'));
        assert.strictEqual(byCheck(out.checks, 'price').note, '2 seat(s) covered by the pool');
    });

    await t('comps (vip-comp) are €0 and skipped through', async () => {
        const galaId = crypto.randomUUID();
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, amount_paid, guest_count, created_at) VALUES (?,?,?,?,'confirmed','vip-comp',0,0,?)`, [galaId, 'Lord', 'Smith', 'lord@hermetic.invalid', isoNow()]);
        const out = await A.runChecks({ galaRegId: galaId });
        assert.ok(['charge', 'price', 'fira', 'ledger'].every(n => byCheck(out.checks, n).ok === true && /comp/.test(byCheck(out.checks, n).note)), JSON.stringify(out.checks));
    });

    await t("the 15 pre-fix multi-seat invoices are seeded 'known' and never alert, even when their lines are wrong", async () => {
        sent.length = 0;
        const B = audit.create(deps());                                      // a fresh process
        const inv = audit.KNOWN_UNIT_PRICE_INVOICES[3];                      // CA-GALA-2026-0010, Kruezi, 3 seats
        const r = paidRow({ guests: 2, invoice: inv, firaUnit: 450 });      // 3 × €450 printed, €450 total
        assert.strictEqual(audit.KNOWN_UNIT_PRICE_INVOICES.length, 15);
        const out = await B.auditPayment({ galaRegId: r.galaId, caRegId: r.caId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true }, reason: 'manual', secondPass: true });
        assert.strictEqual(out.status, 'known');
        assert.strictEqual(out.verdict, 'failed', 'the defect is still recorded in the checks');
        const row = B.getAudit(r.galaId);
        assert.strictEqual(row.status, 'known');
        assert.strictEqual(row.note, audit.KNOWN_NOTE);
        assert.strictEqual(sent.length, 0, 'no alert for a known invoice');
        assert.ok(!B.sweepCandidates().map(c => c.id).includes(r.galaId), 'known rows stay out of the sweep');
    });

    await t('a ledger row parked in _purged_finance_transactions (the admin boot purge) is undecided, not a page', async () => {
        sent.length = 0; timers.length = 0;
        raw.exec(`CREATE TABLE IF NOT EXISTS _purged_finance_transactions AS SELECT * FROM finance_transactions WHERE 0`);
        const r = paidRow({ guests: 0, ledger: false });
        db.run(`INSERT INTO _purged_finance_transactions (id, transaction_number, transaction_type, amount, date, payment_method, reference, fiscal_year) VALUES (?,?,?,?,?,?,?,2026)`,
            [crypto.randomUUID(), 'P-2026-PARKED', 'income', r.amount, '2026-09-22', 'card', r.invoice]);
        const out = await A.auditPayment({ galaRegId: r.galaId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true }, reason: 'webhook' });
        assert.strictEqual(out.status, 'uncertain');
        assert.strictEqual(byCheck(out.checks, 'ledger').ok, null);
        assert.ok(byCheck(out.checks, 'ledger').actual.includes('P-2026-PARKED'));
        assert.strictEqual(sent.length, 0);
        assert.strictEqual(timers.length, 0, 'uncertain never schedules the alert path');
        assert.ok(A.sweepCandidates().map(c => c.id).includes(r.galaId), 'an uncertain row is re-audited by the sweep');
    });

    await t('the ticket check: a provider rejection fails; a mock send fails only in production', async () => {
        const r = paidRow({ guests: 0 });
        const rej = await A.runChecks({ galaRegId: r.galaId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: false, error: 'Brevo 400 invalid sender' } });
        assert.strictEqual(byCheck(rej.checks, 'ticket').ok, false);
        assert.ok(byCheck(rej.checks, 'ticket').note.includes('invalid sender'));
        const dev = await A.runChecks({ galaRegId: r.galaId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true, mock: true } });
        assert.strictEqual(byCheck(dev.checks, 'ticket').ok, true);
        process.env.NODE_ENV = 'production';
        try {
            const prod = await A.runChecks({ galaRegId: r.galaId, stripeSession: r.session, firaResult: r.firaResult, ticketSend: { success: true, mock: true } });
            assert.strictEqual(byCheck(prod.checks, 'ticket').ok, false);
        } finally { process.env.NODE_ENV = 'test'; }
    });

    await t('the alert email shape (pure builder): subject, person, amount, invoice, expected/actual, payment itself, admin link', () => {
        const m = audit.buildAlertEmail({ name: 'Ena Suppan', email: 'ena@example.org', amount: 300, seats: 2, invoice: 'CA-GALA-2026-0006', galaRegId: 'g-1', caRegId: 'c-1',
            failing: [{ check: 'fira', expected: '2 × €150 = €300', actual: 'lines sum €600 ≠ brutto €300' }], uncertain: [], paymentState: 'succeeded (Stripe collected €300, session cs_x)', adminBase: 'https://medx-admin-portal.onrender.com' });
        assert.strictEqual(m.subject, '⚠ Gala payment audit failed — Ena Suppan · CA-GALA-2026-0006');
        for (const s of ['Ena Suppan', 'ena@example.org', '€300', '2 seats', 'CA-GALA-2026-0006', 'expected <b>2 × €150 = €300</b>', 'lines sum €600 ≠ brutto €300', 'payment itself: succeeded (Stripe collected €300', 'https://medx-admin-portal.onrender.com/#gala']) {
            assert.ok(m.html.includes(s), 'html carries: ' + s);
        }
        assert.ok(m.text.includes('fira: expected 2 × €150 = €300 · actual lines sum €600 ≠ brutto €300'), m.text);
    });

    await t('fira-service: createFiscalInvoice returns the accepted order payload; fetchOrder never throws and is null without a read endpoint', async () => {
        const posted = [];
        global.fetch = async (url, opts) => {
            if (!opts || !opts.method) return { ok: false, status: 400, text: async () => 'requestRejected', json: async () => ({}) };   // every GET shape FIRA has
            posted.push(JSON.parse(opts.body));
            if (posted.length === 1) return { ok: false, status: 400, text: async () => 'Cannot add taxes while company is not in the PDV system' };
            return { ok: true, status: 200, json: async () => ({ id: 'f1', invoiceNumber: '99/1/1', status: 'ok' }) };
        };
        try {
            const res = await fira.createFiscalInvoice({ invoiceNumber: 'CA-GALA-2026-TEST', ticketName: 'Plexus 2026 — Gala Evening seat', ticketPrice: 150, quantity: 2, addons: [], billing: { name: 'Test Guest', country: 'HR' }, invoiceType: 'FISKALNI_RAČUN', paymentType: 'KARTICA' });
            assert.strictEqual(res.invoiceNumber, '99/1/1');
            assert.ok(res.order && res.order.lineItems[0].price === 150 && res.order.lineItems[0].quantity === 2 && res.order.brutto === 300, JSON.stringify(res.order));
            const a = audit.firaOrderArithmetic(res.order);
            assert.strictEqual(a.sum, a.brutto);
            assert.strictEqual(await fira.fetchOrder('CA-GALA-2026-TEST'), null);
        } finally { global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); }; }
    });

    await t('07:00 Europe/Zagreb is always 1 s … 24 h away, in either DST regime', () => {
        for (const d of ['2026-09-22T12:00:00Z', '2026-09-22T04:59:00Z', '2026-09-22T05:00:30Z', '2026-12-15T23:30:00Z', '2026-03-28T23:00:00Z', '2026-10-24T23:00:00Z']) {
            const ms = audit.msUntilZagrebHour(7, new Date(d));
            assert.ok(ms >= 1000 && ms <= 24 * 3600 * 1000, `${d} → ${ms}`);
            const at = new Date(Date.parse(d) + ms);
            const hh = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
            assert.strictEqual(hh, '07:00', `${d} → fires at ${hh} Zagreb`);
        }
    });

    await t('server.js wiring: all three Gala payment paths call the auditor LAST, the sweep is scheduled, the admin mirror carries the table', () => {
        const fs = require('node:fs'), path = require('node:path');
        const up = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');
        const ad = fs.readFileSync(path.join(__dirname, '..', 'admin-portal', 'backend', 'server.js'), 'utf8');
        const calls = up.match(/galaAudit\.auditPayment\(\{/g) || [];
        assert.strictEqual(calls.length, 2, 'two webhook sites (gala-ticket covers standalone + pay-link; croatians-abroad-gala is the form)');
        const gala = up.indexOf("metadata.type === 'gala-ticket'"), ca = up.indexOf("metadata.type === 'croatians-abroad-gala'");
        const site1 = up.indexOf('galaAudit.auditPayment({ galaRegId, stripeSession: session, amount, invoiceNumber: galaInvoice');
        const site2 = up.indexOf('galaAudit.auditPayment({ galaRegId, caRegId, stripeSession: session, amount, invoiceNumber, firaResult');
        assert.ok(gala < site1 && site1 < ca && ca < site2, 'each call sits inside its own branch');
        const b1 = up.slice(gala, ca), b2 = up.slice(ca, up.indexOf("metadata.type.startsWith('invite-')"));
        const c1 = b1.indexOf('galaAudit.auditPayment('), c2 = b2.indexOf('galaAudit.auditPayment(');
        assert.ok(b1.indexOf("payment_status = 'paid', status = 'confirmed'") < c1 && b1.indexOf('createFinanceIncomeRecord(') < c1 && b1.indexOf('fulfilLinkedCaGala(') < c1 && b1.indexOf('GOOGLE_SHEETS_WEBHOOK') < c1, 'gala-ticket: the auditor runs after the row update, the ledger, the ticket and the Sheets mirror');
        assert.ok(b2.indexOf("gala_payment_status = 'paid'") < c2 && b2.indexOf('createFinanceIncomeRecord(') < c2 && b2.indexOf('buildCombinedTicketEmail(') < c2 && b2.indexOf('GOOGLE_SHEETS_WEBHOOK') < c2, 'CA: the auditor runs after the row update, the ledger, the ticket and the Sheets mirror');
        assert.ok(b1.slice(c1).indexOf('} catch (dbErr)') < 400 && b2.slice(c2).indexOf('return res.json({ received: true })') < 300, 'each call is the last statement of its branch');
        assert.ok(up.includes("require('./gala-audit').create({") && up.includes('galaAudit.scheduleSweeps()') && up.includes('galaAudit.mountRoutes(app, { auth, adminOnly, JWT_SECRET })'));
        assert.ok(up.includes('CREATE TABLE IF NOT EXISTS gala_payment_audits') && ad.includes('CREATE TABLE IF NOT EXISTS gala_payment_audits'), 'both schema mirrors');
        assert.ok(ad.includes("app.get('/api/admin/gala/audits'"), 'admin read route');
        assert.ok(up.includes('return { handled: true, email: to, events, seats, invoice_number: invoiceNumber || null, ticketSend: sent || null };') === false, 'server.js does not inline the paylink return');
        const pl = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'gala-paylink.js'), 'utf8');
        assert.ok(pl.includes('ticketSend: sent || null'), 'the pay-link fulfilment surfaces the ticket send result');
    });

    await t('demo-purge no longer wipes the real ledger: only seed rows match, and the restore puts real rows back once', () => {
        const purge = require('../admin-portal/backend/demo-purge.js');
        const target = purge.purgeTargets().find(x => x[0] === 'finance_transactions');
        assert.strictEqual(target[1], purge.FINANCE_SEED_WHERE);
        assert.notStrictEqual(target[1], '1=1');
        // a scratch admin-shaped DB: 1 seed row + 1 webhook row live, 2 real rows only in the backup
        const r2 = new DatabaseSync(':memory:');
        r2.exec(`CREATE TABLE finance_transactions (id TEXT PRIMARY KEY, transaction_number TEXT UNIQUE, transaction_type TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL, description TEXT, project TEXT, work_unit_id TEXT, category TEXT, payment_method TEXT, reference TEXT, status TEXT DEFAULT 'completed', fiscal_year INTEGER, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        r2.exec(`CREATE TABLE _purged_finance_transactions AS SELECT * FROM finance_transactions WHERE 0`);
        r2.exec(`CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)`);
        r2.exec(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, fiscal_year) VALUES ('s1','P-2026-001','income',17500,'2026-01-05','EU Horizon first tranche','plexus','grant',2026)`);
        r2.exec(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, payment_method, reference, fiscal_year) VALUES ('w1','P-2026-052','income',300,'2026-09-21','Gala 2026 (CA) — Ana Tikvica Luetic','gala-2026','gala-ticket','card','CA-GALA-2026-0047',2026)`);
        r2.exec(`INSERT INTO _purged_finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, work_unit_id, category, payment_method, reference, fiscal_year) VALUES ('p1','P-2026-051','income',300,'2026-09-21','Gala 2026 (CA) — Žarko Alfirević','gala-2026','wu-gone','gala-ticket','card','CA-GALA-2026-0046',2026)`);
        r2.exec(`INSERT INTO _purged_finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, fiscal_year) VALUES ('p2','P-2026-002','income',5000,'2026-01-08','Pharma Corp sponsorship','plexus','sponsorship',2026)`);
        const q2 = { get: (s, p = []) => { const r = r2.prepare(s).get(...p); return r === undefined ? null : r; }, all: (s, p = []) => r2.prepare(s).all(...p) };
        const d2 = { run: (s, p = []) => { p.length ? r2.prepare(s).run(...p) : r2.exec(s); } };
        const n = purge.restoreRealFinanceRows(d2, q2);
        assert.strictEqual(n, 1, 'only the real backed-up row comes back');
        assert.strictEqual(q2.get("SELECT work_unit_id FROM finance_transactions WHERE id = 'p1'").work_unit_id, null, 'FK to the emptied work-units table is dropped');
        assert.strictEqual(purge.restoreRealFinanceRows(d2, q2), 0, 'marker-guarded: never twice');
        const survivors = q2.all(`SELECT id FROM finance_transactions WHERE NOT (${purge.FINANCE_SEED_WHERE})`).map(r => r.id).sort();
        assert.deepStrictEqual(survivors, ['p1', 'w1'], 'the purge WHERE leaves every real row alone');
        assert.deepStrictEqual(q2.all(`SELECT id FROM finance_transactions WHERE ${purge.FINANCE_SEED_WHERE}`).map(r => r.id), ['s1'], 'and still catches the seed');
    });

    await t("demo-purge: no finance table is purged with '1=1' any more — a real row survives a full production purge in every one of them, the seed rows do not", () => {
        const purge = require('../admin-portal/backend/demo-purge.js');
        for (const [table, where] of purge.purgeTargets()) if (table.startsWith('finance_')) assert.notStrictEqual(where, '1=1', `${table} is still purged with 1=1`);
        // A scratch admin-shaped DB with the real column sets (prod PRAGMA table_info, 2026-09-22).
        const r3 = new DatabaseSync(':memory:');
        r3.exec(`CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT)`);
        r3.exec(`CREATE TABLE finance_work_units (id TEXT PRIMARY KEY, code TEXT, name TEXT, description TEXT, grant_source TEXT, fiscal_year INTEGER, budget_total REAL, budget_used REAL, status TEXT, created_at TEXT, closed_at TEXT)`);
        r3.exec(`CREATE TABLE finance_transactions (id TEXT PRIMARY KEY, transaction_number TEXT UNIQUE, transaction_type TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL, description TEXT, project TEXT, work_unit_id TEXT, category TEXT, payment_method TEXT, reference TEXT, status TEXT DEFAULT 'completed', fiscal_year INTEGER, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        r3.exec(`CREATE TABLE finance_invoices (id TEXT PRIMARY KEY, invoice_number TEXT, invoice_type TEXT, direction TEXT, status TEXT, issue_date TEXT, due_date TEXT, paid_date TEXT, fiscalized INTEGER, party_name TEXT, party_address TEXT, party_oib TEXT, party_email TEXT, subtotal REAL, discount_total REAL, vat_total REAL, total REAL, currency TEXT, payment_reference TEXT, payment_iban TEXT, notes TEXT, project TEXT, work_unit_id TEXT, fiscal_year INTEGER, transaction_id TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        r3.exec(`CREATE TABLE finance_invoice_items (id TEXT PRIMARY KEY, invoice_id TEXT, description TEXT, quantity REAL, unit_price REAL, discount_percent REAL, discount_amount REAL, vat_rate REAL, vat_amount REAL, line_total REAL, sort_order INTEGER)`);
        r3.exec(`CREATE TABLE finance_travel_orders (id TEXT PRIMARY KEY, order_number TEXT, traveler_id TEXT, traveler_name TEXT, destination TEXT, purpose TEXT, status TEXT, planned_departure TEXT, planned_return TEXT, project TEXT, work_unit_id TEXT, fiscal_year INTEGER, assigned_by TEXT, assigned_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        r3.exec(`CREATE TABLE finance_payment_orders (id TEXT PRIMARY KEY, order_number TEXT, recipient_name TEXT, recipient_iban TEXT, payment_type TEXT, amount REAL, reference TEXT, date TEXT, execution_date TEXT, status TEXT, description TEXT, project TEXT, work_unit_id TEXT, fiscal_year INTEGER, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        r3.exec(`CREATE TABLE finance_bank_balance (id TEXT PRIMARY KEY, balance REAL, date TEXT, notes TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        const ins = (sql, p) => r3.prepare(sql).run(...p);
        // SEEDS — byte-for-byte what the two seed blocks write (no author column, June/January dates)
        ins(`INSERT INTO finance_work_units (id, code, name, grant_source, fiscal_year, budget_total, budget_used, status) VALUES (?,?,?,?,2026,?,?,?)`, ['wu-seed', 'RJ-2026-001', 'EU Horizon Grant - Plexus', 'EU Horizon Europe', 50000, 12850, 'active']);
        ins(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, fiscal_year) VALUES (?,?,?,?,?,?,?,?,2026)`, ['tx-seed', 'P-2026-001', 'income', 17500, '2026-01-05', 'EU Horizon first tranche', 'plexus', 'grant']);
        ins(`INSERT INTO finance_invoices (id, invoice_number, invoice_type, direction, status, party_name, subtotal, total, project, fiscal_year) VALUES (?,?,?,?,?,?,?,?,?,2026)`, ['inv-seed', 'UR-2026-001', 'standard', 'incoming', 'pending', 'Hotel Esplanade Zagreb', 4500, 4500, 'plexus']);
        ins(`INSERT INTO finance_invoice_items (id, invoice_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?)`, ['item-seed', 'inv-seed', 'Venue deposit', 1, 4500, 4500]);
        ins(`INSERT INTO finance_travel_orders (id, order_number, traveler_id, traveler_name, destination, status, planned_departure, project, fiscal_year) VALUES (?,?,?,?,?,?,?,?,2026)`, ['to-seed', 'PUT-2026-001', 'u-miro', 'Miro Vukovic', 'Vienna, Austria', 'approved', '2026-02-10', 'plexus']);
        ins(`INSERT INTO finance_payment_orders (id, order_number, recipient_name, payment_type, amount, reference, date, status, project) VALUES (?,?,?,?,?,?,?,?,?)`, ['po-seed', 'PN-2026-001', 'Hotel Esplanade Zagreb', 'outgoing', 4500, 'Deposit Plexus 2026', '2026-01-15', 'executed', 'plexus']);
        ins(`INSERT INTO finance_bank_balance (id, balance, date, notes) VALUES (?,?,?,?)`, ['bb-seed', 125000, '2026-01-01', 'Starting balance 2026']);
        // REAL rows — exactly what the Finance UI (created_by / assigned_by = req.user.id) and the webhook (payment_method + reference) write,
        // deliberately reusing seed-looking numbers and names so only the author / payment columns can save them
        ins(`INSERT INTO finance_work_units (id, code, name, grant_source, fiscal_year, budget_total) VALUES (?,?,?,?,2026,?)`, ['wu-real', 'RJ-2026-002', 'HRZZ project grant', 'HRZZ', 40000]);
        ins(`INSERT INTO finance_work_units (id, code, name, grant_source, fiscal_year, budget_total) VALUES (?,?,?,?,2026,?)`, ['wu-real2', 'RJ-2026-001', 'EU Horizon Grant - Plexus', 'EU Horizon Europe (agreement 2026/77)', 50000]);
        ins(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, payment_method, reference, fiscal_year) VALUES (?,?,?,?,?,?,?,?,?,?,2026)`, ['tx-real', 'P-2026-052', 'income', 300, '2026-09-21', 'Gala 2026 (CA) — Ana Tikvica Luetic', 'gala-2026', 'gala-ticket', 'card', 'CA-GALA-2026-0047']);
        ins(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, fiscal_year, created_by) VALUES (?,?,?,?,?,?,?,?,2026,?)`, ['tx-real2', 'R-2026-004', 'expense', 120, '2026-01-20', 'Domain renewal', 'general', 'operations', 'u-miro']);
        ins(`INSERT INTO finance_invoices (id, invoice_number, invoice_type, direction, status, party_name, subtotal, total, project, fiscal_year, created_by) VALUES (?,?,?,?,?,?,?,?,?,2026,?)`, ['inv-real', 'UR-2026-002', 'standard', 'incoming', 'draft', 'Hotel Esplanade Zagreb', 9000, 9000, 'plexus', 'u-miro']);
        ins(`INSERT INTO finance_invoice_items (id, invoice_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?)`, ['item-real', 'inv-real', 'Ballroom hire', 1, 9000, 9000]);
        ins(`INSERT INTO finance_travel_orders (id, order_number, traveler_id, traveler_name, destination, status, planned_departure, project, fiscal_year, assigned_by, assigned_at) VALUES (?,?,?,?,?,?,?,?,2026,?,datetime('now'))`, ['to-real', 'PUT-2026-002', 'u-laura', 'Laura Rodman', 'Boston, USA', 'assigned', '2026-09-19', 'bridges', 'u-alen']);
        ins(`INSERT INTO finance_payment_orders (id, order_number, recipient_name, payment_type, amount, reference, date, status, project, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`, ['po-real', 'PN-2026-002', 'Esplanade Zagreb d.d.', 'outgoing', 9000, 'Ballroom hire', '2026-09-20', 'pending', 'plexus', 'u-miro']);
        ins(`INSERT INTO finance_bank_balance (id, balance, date, notes, created_by) VALUES (?,?,?,?,?)`, ['bb-real', 18240.5, '2026-01-31', 'PBZ statement', 'u-miro']);
        const q3 = { get: (s, p = []) => { const r = r3.prepare(s).get(...p); return r === undefined ? null : r; }, all: (s, p = []) => r3.prepare(s).all(...p) };
        const d3 = { run: (s, p = []) => { p.length ? r3.prepare(s).run(...p) : r3.exec(s); } };
        const out = purge.runDemoPurge(d3, q3, () => {}, { force: true });        // the production boot purge, end to end
        const ids = t => q3.all(`SELECT id FROM ${t} ORDER BY id`).map(r => r.id);
        assert.deepStrictEqual(ids('finance_work_units'), ['wu-real', 'wu-real2'], 'work units: the seed triple goes, a real unit with a seed code (even the seed name with a different grant source) stays');
        assert.deepStrictEqual(ids('finance_transactions'), ['tx-real', 'tx-real2'], 'ledger: webhook row (payment_method + reference) and hand-entered row (created_by) stay');
        assert.deepStrictEqual(ids('finance_invoices'), ['inv-real'], 'invoices: created_by keeps a real UR-2026-* invoice');
        assert.deepStrictEqual(ids('finance_invoice_items'), ['item-real'], 'invoice items follow their invoice');
        assert.deepStrictEqual(ids('finance_travel_orders'), ['to-real'], 'travel orders: assigned_by keeps a real PUT-2026-* order');
        assert.deepStrictEqual(ids('finance_payment_orders'), ['po-real'], 'payment orders: created_by keeps a real PN-2026-* order');
        assert.deepStrictEqual(ids('finance_bank_balance'), ['bb-real'], 'bank balance: created_by keeps a real January entry');
        assert.ok(out.detail.some(d => d.startsWith('finance_work_units:1')) && out.detail.some(d => d.startsWith('finance_transactions:1')), JSON.stringify(out));
        // idempotent: a second boot removes nothing more
        const again = purge.runDemoPurge(d3, q3, () => {}, { force: true });
        assert.ok(!again.detail.some(d => d.startsWith('finance_')), JSON.stringify(again));
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
})();
