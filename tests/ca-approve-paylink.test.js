/**
 * tests/ca-approve-paylink.test.js — the Gala leg of a review-held Zagreb registration
 * (user-portal/backend/gala-paylink.js).
 *
 * THE BUGS UNDER TEST.
 *  1. A /plexus registration the review gate HELD never reached Stripe. Approving it replayed
 *     the free-events confirmation but left the Gala leg at status='awaiting_payment' with
 *     pay_token NULL — no link was ever minted, so none could be sent. Ana Franceschi and
 *     Magdalena Zebrowska sat in that state for days.
 *  2. When such a guest finally paid, /pay/gala's session carries metadata.type 'gala-ticket',
 *     so the webhook answered on the standalone branch: a bare receipt, no QR, no mention of
 *     the Conference or Bridges, and the CA row left 'awaiting_payment' for good.
 *  3. /pay/gala charged ONE seat however large the party. guest_count is ADDITIONAL guests
 *     everywhere in this codebase, so a registrant with a plus-one was billed half of what
 *     they booked.
 *  4. Approval used to send the free-events QR *and* (after payment) the combined ticket —
 *     the same person holding two conflicting QR codes.
 *
 * Hermetic, in the shape of tests/boston.test.js: a scratch in-memory sqlite (node:sqlite)
 * carrying the REAL croatians_abroad_registrations / gala_registrations / gala_settings /
 * ca_registration_guests schema copied from server.js, a capturing sendEmail stub, and
 * global.fetch disabled. NO EMAIL, NO NETWORK, NO STRIPE CALL IS POSSIBLE HERE.
 *
 * Run:  node tests/ca-approve-paylink.test.js
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
delete process.env.REVIEW_EMAIL;                      // default recipient must stay Alen
process.env.RENDER_EXTERNAL_URL = 'https://medx-user-portal.onrender.com';   // deterministic links
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const payLink = require('../user-portal/backend/gala-paylink.js');
const gate = require('../user-portal/backend/review-gate.js');

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
    gala_registration_id TEXT, stripe_session_id TEXT, amount_paid REAL, invoice_number TEXT,
    guest_count INTEGER DEFAULT 0, custom_answers TEXT, applied_for TEXT,
    source TEXT DEFAULT 'croatians-abroad', user_id TEXT, needs_invoice INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE gala_registrations (
    id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
    institution TEXT, title TEXT, dietary TEXT, requests TEXT, pricing TEXT,
    status TEXT DEFAULT 'pending', payment_status TEXT, amount_paid REAL, invoice_number TEXT,
    stripe_session_id TEXT, pay_token TEXT, guest_count INTEGER DEFAULT 0, user_id TEXT,
    admin_notes TEXT, needs_invoice INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE gala_settings (
    id TEXT PRIMARY KEY DEFAULT 'default', title TEXT, date TEXT, venue TEXT,
    price_gala_only REAL, price_gala_early_bird REAL, price_gala_regular REAL, early_bird_deadline TEXT
)`);
raw.exec(`CREATE TABLE ca_registration_guests (
    id TEXT PRIMARY KEY, registration_id TEXT, name TEXT, institution TEXT, email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
// The live production values on 2026-09-15 (read from Turso), so the asserted copy is the copy
// a real registrant would read.
raw.exec(`INSERT INTO gala_settings (id, title, date, venue, price_gala_only, price_gala_early_bird, price_gala_regular, early_bird_deadline)
          VALUES ('default', 'Plexus Gala Evening 2026', '2026-12-05', 'Hotel Esplanade Emerald Ballroom; Zagreb, Croatia', 150, 150, 175, '2026-09-15')`);

const query = {
    get: (sql, params = []) => { const r = raw.prepare(sql).get(...params); return r === undefined ? null : r; },
    all: (sql, params = []) => raw.prepare(sql).all(...params)
};
const db = { run: (sql, params = []) => { params.length ? raw.prepare(sql).run(...params) : raw.exec(sql); } };

// ---------------------------------------------------------------- stubs
const sent = [];
const sendEmail = async (to, subject, html, attachments) => {
    sent.push({ to, subject, html, attachments: attachments || [] });
    return { success: true };
};
let FAIL_NEXT_SEND = false;
const sendEmailFlaky = async (to, subject, html, attachments) => {
    if (FAIL_NEXT_SEND) { FAIL_NEXT_SEND = false; return { success: false, error: 'provider rejected' }; }
    return sendEmail(to, subject, html, attachments);
};

const SEAT_PRICE = 150;
const effectiveGalaPrice = () => SEAT_PRICE;
const deps = () => ({
    query, db,
    saveDb: () => {}, flushDb: () => {},
    sendEmail: sendEmailFlaky,
    effectiveGalaPrice,
    buildEmailTemplate: (title, body) => `<!DOCTYPE html><html><body data-title="${title}">${body}</body></html>`,
    buildTicketQrBlock: (regId, o = {}) => `<div class="qr" data-reg="${regId}">${o.label || ''}|${o.caption || ''}</div>`,
    qrPngAttachment: async (payload) => [{ filename: 'plexus-ticket-qr.png', content: Buffer.from('png'), type: 'image/png', _payload: payload }],
    log: () => {}
});

// ---------------------------------------------------------------- fixtures
let seq = 0;
function makeHeldCa(over = {}) {
    const caId = crypto.randomUUID();
    const galaId = over.selected_gala === 0 ? null : crypto.randomUUID();
    const f = Object.assign({
        first_name: 'Ana', last_name: 'Franceschi', email: `held${++seq}@example.org`,
        institution: 'Northwell Health', country: 'United States',
        selected_conference: 1, selected_bridges: 1, selected_gala: 1,
        guest_count: 0, notes: '', source: 'plexus', needs_invoice: 0
    }, over);
    db.run(`INSERT INTO croatians_abroad_registrations
            (id, first_name, last_name, email, institution, country, selected_conference, selected_bridges, selected_gala,
             conference_status, bridges_status, gala_status, gala_payment_status, gala_registration_id, guest_count, notes, source, needs_invoice)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [caId, f.first_name, f.last_name, f.email, f.institution, f.country,
         f.selected_conference, f.selected_bridges, f.selected_gala,
         f.selected_conference ? 'pending-review' : null,
         f.selected_bridges ? 'pending-review' : null,
         f.selected_gala ? 'pending-review' : null,
         f.selected_gala ? 'pending' : null,
         galaId, f.guest_count, f.notes, f.source, f.needs_invoice ? 1 : 0]);
    if (galaId) {
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, guest_count, needs_invoice)
                VALUES (?,?,?,?,?, 'pending-review', 'pending', ?, ?)`,
            [galaId, f.first_name, f.last_name || '', f.email, f.institution || '', f.guest_count, f.needs_invoice ? 1 : 0]);
    }
    return { caId, galaId, email: f.email };
}
// What the review-gate approve handler does to the statuses before it hands over to us.
function releaseStatuses(caId) {
    const r = query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [caId]);
    db.run(`UPDATE croatians_abroad_registrations SET conference_status = ?, bridges_status = ?, gala_status = ?, gala_payment_status = ? WHERE id = ?`,
        [Number(r.selected_conference) ? 'pre-registered' : null,
         Number(r.selected_bridges) ? 'pre-registered' : null,
         Number(r.selected_gala) ? 'awaiting_payment' : null,
         Number(r.selected_gala) ? 'pending' : null, caId]);
    if (r.gala_registration_id) {
        db.run(`UPDATE gala_registrations SET status = 'awaiting_payment' WHERE id = ? AND status = 'pending-review'`, [r.gala_registration_id]);
    }
}

// The approve handler's own sequence, verbatim in shape: decide, conditionally replay Path A,
// then release the gala leg. Asserting against THIS is asserting the contract server.js keeps
// (and the source check below proves server.js still keeps it).
async function runApprove(caId) {
    const row = query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [caId]);
    const pathA = [];
    const galaOwesPayment = payLink.galaLegNeedsPayment(query, row);
    if (!galaOwesPayment) {
        pathA.push('sent');
        await sendEmailFlaky(row.email, "You're pre-registered — Plexus 2026",
            `<html><body>Pre-Registration Confirmed <div class="qr" data-reg="${caId}">Your Check-in QR Code</div></body></html>`);
    }
    let galaPay = null;
    if (Number(row.selected_gala)) galaPay = await payLink.sendGalaPayLink(deps(), caId);
    return { galaOwesPayment, pathAReplayed: pathA.length === 1, galaPay };
}

const ca = id => query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [id]);
const gala = id => query.get('SELECT * FROM gala_registrations WHERE id = ?', [id]);
const lastTo = to => [...sent].reverse().find(m => m.to === to);
const allTo = to => sent.filter(m => m.to === to);

(async () => {
    console.log('ca-approve-paylink.test.js — hermetic (scratch sqlite, no network, no mail)\n');

    // ==================== 0. SEAT SEMANTICS ====================
    await t('guest_count is ADDITIONAL guests — party is 1 + guest_count, as everywhere else', () => {
        assert.strictEqual(payLink.partySeats({ guest_count: 0 }), 1, 'no guests = a party of one');
        assert.strictEqual(payLink.partySeats({ guest_count: 1 }), 2, "Ana's plus-one = a party of two");
        assert.strictEqual(payLink.partySeats({ guest_count: 2 }), 3);
        assert.strictEqual(payLink.partySeats({}), 1, 'missing = a party of one');
        assert.strictEqual(payLink.partySeats({ guest_count: -4 }), 1, 'never below one');
        // The same arithmetic the register route, both FIRA blocks, gala-ops seatsOf() and the
        // admin door list use: 1 + guest_count.
        const src = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');
        assert.ok(src.includes('// +guests, max 2'), 'the register route still documents guest_count as ADDITIONAL guests');
        assert.ok(src.includes('galaBase * (1 + guests)'), 'Path B still charges 1 + guests');
        assert.ok(src.includes('quantity: 1 + Math.max(0, parseInt(galaReg.guest_count, 10) || 0)'), 'FIRA still bills 1 + guest_count');
    });

    await t('quoteGalaSeats: a party of 2 owes 2 x the seat price, a party of 1 owes one', () => {
        const solo = payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 0 });
        assert.strictEqual(solo.seats, 1);
        assert.strictEqual(solo.total, 150);
        assert.strictEqual(solo.lineQuantity, 1);
        assert.strictEqual(solo.lineUnitAmount, 15000, 'Stripe minor units');
        assert.strictEqual(solo.lineName, 'Plexus 2026 — Gala Evening', 'a single seat needs no seat count');

        const pair = payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 1 });
        assert.strictEqual(pair.seats, 2);
        assert.strictEqual(pair.total, 300, 'the registrant pays for the whole party');
        assert.strictEqual(pair.lineQuantity, 2, 'Stripe shows 2 x');
        assert.strictEqual(pair.lineUnitAmount, 15000, 'at the per-seat price');
        assert.strictEqual(pair.lineName, 'Plexus 2026 — Gala Evening — 2 seats', 'the line item names the seats');
        assert.strictEqual(pair.lineQuantity * pair.lineUnitAmount, 30000, 'and the line item totals the quote');
    });

    await t('Masakazu Toi is protected: a link already quoted at a checkout keeps that amount', () => {
        // His real row, verbatim: guest_count 1 (a party of 2), but invoice GALA26-0038 and
        // amount_paid 150 were stamped by /pay/gala when it sent him to Stripe for €150.
        const toi = { guest_count: 1, invoice_number: 'GALA26-0038', amount_paid: 150 };
        const q = payLink.quoteGalaSeats(effectiveGalaPrice, toi);
        assert.strictEqual(q.honoured, true, 'an amount already shown at checkout is honoured');
        assert.strictEqual(q.total, 150, 'he is NOT silently re-quoted from €150 to €300');
        assert.strictEqual(q.lineQuantity * q.lineUnitAmount, 15000, 'and the line item charges exactly that');
        assert.strictEqual(q.seats, 2, 'while the party is still known to be two');

        // Every other unpaid row in production has both columns NULL and gets party pricing.
        const fresh = payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 1, invoice_number: null, amount_paid: null });
        assert.strictEqual(fresh.honoured, false);
        assert.strictEqual(fresh.total, 300);
        // A zero/!invoice amount is not a quote.
        assert.strictEqual(payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 1, invoice_number: 'X', amount_paid: 0 }).total, 300);
        assert.strictEqual(payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 1, amount_paid: 150 }).total, 300, 'amount without an invoice is not a quote');
    });

    await t('seatsLine reads the way the owner wrote it', () => {
        const pair = payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 1 });
        assert.strictEqual(payLink.seatsLine(pair, '2030-09-15'),
            '2 seats · €300 (€150 per seat, early-bird until 15 September)');
        const solo = payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 0 });
        assert.strictEqual(payLink.seatsLine(solo, '2030-09-15'),
            '1 seat · €150 (early-bird until 15 September)', 'one seat drops the redundant per-seat figure');
        assert.strictEqual(payLink.seatsLine(solo, '2020-01-01'), '1 seat · €150',
            'a deadline in the past is a stale promise — never printed');
        const toi = payLink.quoteGalaSeats(effectiveGalaPrice, { guest_count: 1, invoice_number: 'GALA26-0038', amount_paid: 150 });
        assert.strictEqual(payLink.seatsLine(toi, '2030-09-15'), '2 seats · €150',
            'an honoured quote states only what the link charges — its per-seat maths no longer holds');
    });

    await t('partyNote: party size stated, and whether the guests already hold a copy', () => {
        // A party of one has nobody to admit but themselves — the ticket says nothing.
        assert.strictEqual(payLink.partyNote(1, 0), '');

        // Every guest reachable by email already has their own copy.
        assert.strictEqual(payLink.partyNote(2, 1),
            'This QR admits your whole party of 2. Your guest has received the same QR by email.');
        assert.strictEqual(payLink.partyNote(3, 2),
            'This QR admits your whole party of 3. Your guests have received the same QR by email.');

        // Anyone we cannot reach is reachable only through the registrant.
        assert.strictEqual(payLink.partyNote(2, 0),
            'This QR admits your whole party of 2. Please share this email with your guest who did not give us an email address — the same QR admits them.');
        assert.strictEqual(payLink.partyNote(3, 0),
            'This QR admits your whole party of 3. Please share this email with your guests who did not give us an email address — the same QR admits them.');
        // Mixed: the plural follows the number actually MISSING, not the party size.
        assert.strictEqual(payLink.partyNote(3, 1),
            'This QR admits your whole party of 3. Please share this email with your guest who did not give us an email address — the same QR admits them.');
    });

    await t('selectionPhrase names the legs the way the owner names them', () => {
        assert.strictEqual(payLink.selectionPhrase({ wantConference: 1, wantBridges: 1, wantGala: 1 }),
            'the Conference, Building Bridges Zagreb and the Gala Evening');
        assert.strictEqual(payLink.selectionPhrase({ wantConference: 1, wantGala: 1 }),
            'the Conference and the Gala Evening');
        assert.strictEqual(payLink.selectionPhrase({ wantGala: 1 }), 'the Gala Evening');
    });

    // ==================== 1. APPROVE WITH GALA ====================
    await t('approve with Gala: exactly ONE email, and NO free-events QR', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        const before = sent.length;

        const out = await runApprove(caId);

        assert.strictEqual(out.galaOwesPayment, true, 'the gala leg is unpaid');
        assert.strictEqual(out.pathAReplayed, false, 'Path A is NOT replayed');
        assert.strictEqual(out.galaPay.status, 'done');
        assert.strictEqual(sent.length, before + 1, 'exactly ONE email leaves at approval');
        assert.strictEqual(allTo(email).length, 1);

        const msg = lastTo(email);
        assert.strictEqual(msg.subject, 'Your registration is approved — one step left');
        assert.ok(!/data-reg=/.test(msg.html), 'it carries NO QR block — the one ticket follows payment');
        assert.strictEqual(msg.attachments.length, 0, 'and no QR attachment');
        assert.ok(!/Pre-Registration Confirmed/.test(msg.html), 'not the free-events confirmation');

        // The owner's wording, line by line.
        assert.ok(/Dear Ana/.test(msg.html));
        assert.ok(/Great news/.test(msg.html), 'owner wording: "Great news"');
        assert.ok(/your registration for .*Plexus Week 2026.* is approved/.test(msg.html),
            'the WEEK covers all three events, so the approval names the week');
        assert.ok(!/registration for .*>Plexus 2026</.test(msg.html), 'never the bare "Plexus 2026" for the whole registration');
        assert.ok(msg.html.includes('the Conference, Building Bridges Zagreb and the Gala Evening'),
            'lists what they selected');
        assert.ok(msg.html.includes('To complete your registration for everything'), 'owner wording: the ask');
        assert.ok(msg.html.includes('the payment for the Gala Evening'), 'names the last step');
        assert.ok(msg.html.includes('2 seats · €300 (€150 per seat, early-bird until 15 September)'),
            'states the TOTAL for the party, not a per-seat price');
        assert.ok(msg.html.includes('Complete my registration'), 'the button label the owner asked for');
        assert.ok(/one ticket/.test(msg.html) && /covers all your events/.test(msg.html),
            'promises the one ticket after payment');
        assert.ok(!/confirm .*seat with you separately/i.test(msg.html),
            'the old guest-seat sentence is gone');
        assert.ok(msg.html.includes('laura.rodman@medx.hr'), 'Laura footer');
        assert.ok(msg.html.includes('background:#120e0a'), 'house dark shell');

        const g = gala(galaId);
        assert.strictEqual(g.status, 'approved', "/pay/gala refuses anything but status='approved'");
        assert.ok(g.pay_token && /^[0-9a-f]{48}$/.test(g.pay_token), 'a real secure-random hex token');
        assert.ok(msg.html.includes(`https://medx-user-portal.onrender.com/pay/gala/${g.pay_token}`),
            'the email carries the working /pay/gala link');
        assert.strictEqual(ca(caId).gala_status, 'awaiting_payment', 'payment is still the filter');
        assert.ok(gate.getMarker(ca(caId).notes, 'GALA-PAYLINK-SENT'), 'notes stamped');
    });

    await t('server.js really gates the Path-A replay on galaLegNeedsPayment', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');
        assert.ok(/const galaOwesPayment = galaPayLink\.galaLegNeedsPayment\(query, row\);/.test(src),
            'the approve handler computes the predicate');
        assert.ok(/if \(!galaOwesPayment\) \{\s*await caSendPreRegConfirmation\(/.test(src),
            'and the free-events confirmation is sent ONLY when nothing is owed');
        // The pay page must price the party through the shared quote, never a bare seat price.
        assert.ok(/const quote = galaPayLink\.quoteGalaSeats\(effectiveGalaPrice, reg\);/.test(src),
            '/pay/gala prices through quoteGalaSeats');
        assert.ok(/quantity: quote\.lineQuantity/.test(src) && /unit_amount: quote\.lineUnitAmount/.test(src),
            'and puts the whole party on the Stripe line item');
        assert.ok(/amount_paid = \? WHERE id = \?', \[invoiceNumber, quote\.total, reg\.id\]/.test(src),
            'and stamps the party total as the invoiced amount');
    });

    // ==================== 2. NO GALA — PATH A UNCHANGED ====================
    await t('approve without Gala: Path A is replayed exactly as before, with its QR', async () => {
        const { caId, email } = makeHeldCa({ selected_gala: 0 });
        releaseStatuses(caId);
        const before = sent.length;

        const out = await runApprove(caId);

        assert.strictEqual(out.galaOwesPayment, false, 'nothing is owed');
        assert.strictEqual(out.pathAReplayed, true, 'the free-events confirmation still goes out');
        assert.strictEqual(out.galaPay, null, 'and no pay link is even attempted');
        assert.strictEqual(sent.length, before + 1, 'exactly one email');
        const msg = lastTo(email);
        assert.ok(/Pre-Registration Confirmed/.test(msg.html), 'it IS the free-events confirmation');
        assert.ok(/data-reg=/.test(msg.html), 'and it still carries the check-in QR');
    });

    await t('approve with a Gala seat already paid: Path A is replayed, no chase email', async () => {
        const { caId, galaId, email } = makeHeldCa();
        releaseStatuses(caId);
        db.run("UPDATE gala_registrations SET payment_status='paid', status='confirmed' WHERE id=?", [galaId]);
        const before = sent.length;

        const out = await runApprove(caId);

        assert.strictEqual(out.galaOwesPayment, false);
        assert.strictEqual(out.pathAReplayed, true, 'a paid seat owes nothing, so the confirmation stands');
        assert.strictEqual(out.galaPay.status, 'already-paid');
        assert.strictEqual(sent.length, before + 1, 'one email, and it is not a payment request');
        assert.ok(!/Complete my registration/.test(lastTo(email).html));
    });

    await t('galaLegNeedsPayment truth table', () => {
        const a = makeHeldCa(); releaseStatuses(a.caId);
        assert.strictEqual(payLink.galaLegNeedsPayment(query, ca(a.caId)), true, 'unpaid gala');
        db.run("UPDATE gala_registrations SET payment_status='paid' WHERE id=?", [a.galaId]);
        assert.strictEqual(payLink.galaLegNeedsPayment(query, ca(a.caId)), false, 'paid gala');
        const b = makeHeldCa({ selected_gala: 0 }); releaseStatuses(b.caId);
        assert.strictEqual(payLink.galaLegNeedsPayment(query, ca(b.caId)), false, 'no gala selected');
        const c = makeHeldCa(); releaseStatuses(c.caId);
        db.run('DELETE FROM gala_registrations WHERE id=?', [c.galaId]);
        assert.strictEqual(payLink.galaLegNeedsPayment(query, ca(c.caId)), true, 'selected but the row is missing');
    });

    // ==================== 3. IDEMPOTENCE ====================
    await t('a second approve re-sends nothing and re-mints nothing', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        const token1 = gala(galaId).pay_token;
        const after1 = sent.length;

        const out2 = await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(out2.status, 'already');
        assert.strictEqual(sent.length, after1, 'nothing re-sent');
        assert.strictEqual(gala(galaId).pay_token, token1, 'the SAME link stays valid');
    });

    await t('a rejected send is NOT stamped — the retry re-sends the same link', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);
        FAIL_NEXT_SEND = true;
        const out = await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(out.status, 'send-failed');
        assert.ok(!gate.getMarker(ca(caId).notes, 'GALA-PAYLINK-SENT'), 'an unsent link must stay re-sendable');
        const token = gala(galaId).pay_token;
        assert.ok(token, 'the token is committed anyway, so the admin Pay-link button works');
        assert.strictEqual(gala(galaId).status, 'approved');

        const retry = await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(retry.status, 'done', 'the retry goes through');
        assert.strictEqual(gala(galaId).pay_token, token, 'and carries the SAME link');
    });

    // ==================== 4. INSTITUTIONAL PATH ====================
    await t('institutional confirmation: the email follows the re-pointed address', async () => {
        const { caId, galaId } = makeHeldCa({ email: 'shady.freemail@gmail.com' });
        releaseStatuses(caId);
        // review-gate.js calls h.setEmail(id, instEmail) BEFORE h.approve(id) — verbatim order.
        const instEmail = 'a.franceschi@northwell.edu';
        db.run('UPDATE croatians_abroad_registrations SET email = ? WHERE id = ?', [instEmail, caId]);

        const out = await payLink.sendGalaPayLink(deps(), caId);

        assert.strictEqual(out.status, 'done');
        assert.strictEqual(out.email, instEmail);
        assert.strictEqual(lastTo(instEmail).to, instEmail, 'the link goes to the verified inbox');
        assert.strictEqual(allTo('shady.freemail@gmail.com').length, 0, 'the free-mail address gets nothing');
        assert.ok(lastTo(instEmail).html.includes(gala(galaId).pay_token));
    });

    // ==================== 5. EDGE CASES ====================
    await t('a held row that lost its gala row gets one, rather than no link at all', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);
        db.run('DELETE FROM gala_registrations WHERE id = ?', [galaId]);
        db.run('UPDATE croatians_abroad_registrations SET gala_registration_id = NULL WHERE id = ?', [caId]);

        const out = await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(out.status, 'done');
        const newId = ca(caId).gala_registration_id;
        assert.ok(newId && newId !== galaId, 'a fresh gala row is linked');
        assert.strictEqual(gala(newId).status, 'approved');
        assert.ok(gala(newId).pay_token);
    });

    await t('an unknown id is refused without side effects', async () => {
        const before = sent.length;
        assert.strictEqual((await payLink.sendGalaPayLink(deps(), crypto.randomUUID())).status, 'notfound');
        assert.strictEqual(sent.length, before);
    });

    await t('admin visibility: the row reads "Approved · awaiting payment" and its Pay-link action works', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);
        const held = gala(galaId);
        assert.ok(!(held.status === 'approved' && held.payment_status !== 'paid'),
            'admin-portal/frontend renders the Awaiting-payment row + Pay-link button off exactly this predicate');
        assert.ok(!held.pay_token, 'and there was no token for the button to hand out');

        await payLink.sendGalaPayLink(deps(), caId);

        const g = gala(galaId);
        assert.ok(g.status === 'approved' && g.payment_status !== 'paid',
            "admin frontend: r.status === 'approved' && r.payment_status !== 'paid'");
        assert.ok(!(g.status !== 'approved'), "admin pay-link route: rejects unless status === 'approved'");
        assert.ok(g.pay_token, '…then hands out pay_token rather than minting a second one');
        assert.ok(!['cancelled', 'rejected', 'declined', 'expired'].includes(String(g.status).toLowerCase()),
            'counts as an active seat in the Gala summary');
    });

    // ==================== 6. PREVIEW ====================
    await t('preview: same email, [PREVIEW] subject, to the owner, row untouched', async () => {
        const { caId, galaId } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        const snapCa = JSON.stringify(ca(caId)), snapGala = JSON.stringify(gala(galaId));

        const out = await payLink.sendGalaPayLink(deps(), caId, { preview: true, to: gate.REVIEW_TO });

        assert.strictEqual(out.status, 'preview');
        const msg = sent[sent.length - 1];
        assert.strictEqual(msg.to, gate.REVIEW_TO);
        assert.strictEqual(gate.REVIEW_TO, 'juginovic.alen@gmail.com', 'which is Alen');
        assert.ok(msg.subject.startsWith('[PREVIEW] '));
        assert.ok(msg.subject.endsWith('Your registration is approved — one step left'));
        assert.ok(msg.html.includes('Dear Ana'), "built from Ana's row");
        assert.ok(msg.html.includes('2 seats · €300'), 'showing her party total');

        assert.strictEqual(JSON.stringify(ca(caId)), snapCa, 'the CA row is byte-identical');
        assert.strictEqual(JSON.stringify(gala(galaId)), snapGala, 'the gala row is byte-identical');
        assert.strictEqual(gala(galaId).pay_token, null, 'NO live payment link is minted by a preview');
        assert.ok(!gate.getMarker(ca(caId).notes, 'GALA-PAYLINK-SENT'));
    });

    // ==================== 7. THE WEBHOOK: hold -> approve -> pay ====================
    await t('webhook: a party of 2 gets ONE combined ticket issued as a party of 2', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        const before = sent.length;

        const out = await payLink.fulfilLinkedCaGala(deps(), {
            galaRegId: galaId, amount: 300, invoiceNumber: 'GALA26-0042', sessionEmail: email
        });

        assert.strictEqual(out.handled, true);
        assert.strictEqual(out.seats, 2, 'the ticket knows it is a party of two');
        assert.deepStrictEqual(out.events, ['conference', 'bridges', 'gala']);
        assert.strictEqual(sent.length, before + 1, 'exactly ONE ticket email');

        const msg = lastTo(email);
        assert.strictEqual(msg.subject, 'Payment Confirmed — Plexus 2026');
        assert.ok(/(€|&euro;)300\.00/.test(msg.html), 'states the party total actually charged');
        assert.ok(msg.html.includes('2 Gala seats'), 'says how many seats were bought');
        assert.ok(msg.html.includes('CONFIRMED &amp; PAID · 2 SEATS'), 'the Gala line reads as a party');
        assert.ok(msg.html.includes('admits your whole party of 2'), 'the QR caption states the party');
        assert.ok(msg.html.includes('GALA26-0042'), 'carries the invoice number');
        assert.ok(msg.html.includes(`data-reg="${galaId}"`), 'carries the check-in QR block');
        assert.strictEqual(msg.attachments.length, 1);
        assert.strictEqual(msg.attachments[0]._payload.guests, 1, 'the QR payload carries the +1, like every other Med&X ticket');
        assert.deepStrictEqual(msg.attachments[0]._payload.events, ['conference', 'bridges', 'gala']);
        assert.strictEqual(msg.attachments[0]._payload.caRegId, caId, 'and BOTH ids so every scanner mode verifies');
        assert.strictEqual(msg.attachments[0]._payload.regId, galaId);

        const c = ca(caId);
        assert.strictEqual(c.gala_status, 'confirmed');
        assert.strictEqual(c.gala_payment_status, 'paid');
        assert.strictEqual(c.amount_paid, 300);
    });

    await t('ticket: party of 2, guest HAS an email — says they already have the QR', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        db.run('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), caId, 'Emeric du Mas de Paysac', 'Sorbonne', 'emeric@example.org']);

        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 300, invoiceNumber: 'GALA26-0060' });

        const msg = lastTo(email);
        assert.ok(msg.html.includes('This QR admits your whole party of 2.'), 'states the party size');
        assert.ok(msg.html.includes('Your guest has received the same QR by email.'), 'and that the guest holds a copy');
        assert.ok(!/Please share this email/.test(msg.html), 'so no forwarding request');
        assert.ok(lastTo('emeric@example.org'), 'and the guest really did get their own copy');
    });

    await t('ticket: party of 2, guest has NO email — asks the registrant to forward it', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        db.run('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), caId, 'Unreachable Guest', 'Somewhere', '']);
        const before = sent.length;

        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 300, invoiceNumber: 'GALA26-0061' });

        assert.strictEqual(sent.length, before + 1, 'only the registrant is written to');
        const msg = lastTo(email);
        assert.ok(msg.html.includes('This QR admits your whole party of 2.'));
        assert.ok(msg.html.includes('Please share this email with your guest who did not give us an email address — the same QR admits them.'),
            'asks them to forward it');
        assert.ok(!/received the same QR by email/.test(msg.html));
    });

    await t('ticket: a guest nobody named at all counts as a guest with no email', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 1 });   // no ca_registration_guests row
        releaseStatuses(caId);
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 300, invoiceNumber: 'GALA26-0062' });
        const msg = lastTo(email);
        assert.ok(msg.html.includes('This QR admits your whole party of 2.'));
        assert.ok(msg.html.includes('Please share this email with your guest'), 'we cannot reach them, so the registrant must');
    });

    await t('ticket: party of 3 — both guests reachable, then one, then neither', async () => {
        // both reachable
        const a = makeHeldCa({ guest_count: 2 }); releaseStatuses(a.caId);
        for (const [n, e] of [['G One', 'g1@example.org'], ['G Two', 'g2@example.org']]) {
            db.run('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), a.caId, n, '', e]);
        }
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: a.galaId, amount: 450, invoiceNumber: 'GALA26-0063' });
        let msg = lastTo(a.email);
        assert.ok(msg.html.includes('This QR admits your whole party of 3.'), 'party of three');
        assert.ok(msg.html.includes('Your guests have received the same QR by email.'), 'plural, both covered');
        assert.ok(lastTo('g1@example.org') && lastTo('g2@example.org'), 'both guests got their own copy');

        // one reachable, one not -> the plural follows the MISSING one
        const b = makeHeldCa({ guest_count: 2 }); releaseStatuses(b.caId);
        db.run('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), b.caId, 'Named', '', 'g3@example.org']);
        db.run('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), b.caId, 'Anonymous', '', '']);
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: b.galaId, amount: 450, invoiceNumber: 'GALA26-0064' });
        msg = lastTo(b.email);
        assert.ok(msg.html.includes('This QR admits your whole party of 3.'));
        assert.ok(msg.html.includes('Please share this email with your guest who did not give us an email address'),
            'singular — only one guest is unreachable');

        // neither reachable
        const c = makeHeldCa({ guest_count: 2 }); releaseStatuses(c.caId);
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: c.galaId, amount: 450, invoiceNumber: 'GALA26-0065' });
        msg = lastTo(c.email);
        assert.ok(msg.html.includes('This QR admits your whole party of 3.'));
        assert.ok(msg.html.includes('Please share this email with your guests who did not give us an email address'),
            'plural — both are unreachable');
    });

    await t('webhook: a party of 1 is unchanged — no seat count anywhere', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 0 });
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0043' });

        const msg = lastTo(email);
        assert.ok(/(€|&euro;)150\.00/.test(msg.html));
        assert.ok(!/SEATS/.test(msg.html), 'no seat count on a party of one');
        assert.ok(!/whole party of/.test(msg.html), 'and no party line — there is nobody else to admit');
        assert.ok(!/share this email with your guest/.test(msg.html), 'and nothing to forward');
        assert.ok(msg.html.includes('CONFIRMED &amp; PAID'));
        assert.strictEqual(msg.attachments[0]._payload.guests, 0);
    });

    await t('webhook: a duplicate delivery re-sends nothing', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0044' });
        const after = sent.length;
        const dup = await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0044' });
        assert.strictEqual(dup.duplicate, true);
        assert.strictEqual(sent.length, after, 'no second ticket');
    });

    await t('webhook: a standalone gala row is NOT claimed — the existing receipt still owns it', async () => {
        const soloId = crypto.randomUUID();
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, pay_token)
                VALUES (?,?,?,?,?, 'approved', 'pending', ?)`,
            [soloId, 'Solo', 'Guest', 'solo@example.org', 'Somewhere', 'a'.repeat(48)]);
        const before = sent.length;
        const out = await payLink.fulfilLinkedCaGala(deps(), { galaRegId: soloId, amount: 150, invoiceNumber: 'GALA26-0045' });
        assert.strictEqual(out.handled, false, 'handled:false leaves server.js on its untouched path');
        assert.strictEqual(sent.length, before);
    });

    await t('webhook: a named party guest gets the SAME shared QR', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        db.run('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), caId, 'Emeric du Mas de Paysac', 'Sorbonne', 'guest@example.org']);
        const before = sent.length;

        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 300, invoiceNumber: 'GALA26-0046' });

        assert.strictEqual(sent.length, before + 2, 'registrant + one named guest');
        const g = lastTo('guest@example.org');
        assert.strictEqual(g.subject, 'Your Gala Evening entry — Plexus 2026');
        assert.ok(g.html.includes(`data-reg="${galaId}"`), 'the same party QR, not a second ticket');
        assert.ok(g.html.includes('Emeric'), 'addressed by first name');
        assert.ok(g.html.includes('Your seat is paid for'), 'and told their seat is covered');
    });

    // ==================== 8. THE NUDGE ====================
    await t('nudge dry-run lists approved-but-unpaid seats and sends nothing', async () => {
        const fresh = makeHeldCa({ first_name: 'Nudge', last_name: 'Fresh' });
        releaseStatuses(fresh.caId);
        await payLink.sendGalaPayLink(deps(), fresh.caId);
        // Age it: the clock runs from the GALA-PAYLINK-SENT marker.
        db.run('UPDATE croatians_abroad_registrations SET notes = ? WHERE id = ?',
            [gate.upsertMarker('', 'GALA-PAYLINK-SENT', '2026-01-01'), fresh.caId]);
        const before = sent.length;

        const rows = payLink.listUnpaidGalaNudges(deps(), { days: 7 });
        assert.strictEqual(sent.length, before, 'a listing sends nothing');
        const mine = rows.find(r => r.ca_id === fresh.caId);
        assert.ok(mine, 'the waiting seat is listed');
        assert.strictEqual(mine.has_pay_link, true);
        assert.strictEqual(mine.already_nudged, false);
        assert.strictEqual(mine.seats, 1);
        assert.strictEqual(mine.amount_due, 150);
        assert.ok(mine.days_waiting > 200, 'and how long they have waited');

        // A seat asked for only today is below the threshold.
        const today = makeHeldCa({ first_name: 'Nudge', last_name: 'Today' });
        releaseStatuses(today.caId);
        await payLink.sendGalaPayLink(deps(), today.caId);
        assert.ok(!payLink.listUnpaidGalaNudges(deps(), { days: 7 }).some(r => r.ca_id === today.caId),
            'a seat asked for today is not chased');
        assert.ok(payLink.listUnpaidGalaNudges(deps(), { days: 0 }).some(r => r.ca_id === today.caId),
            'days=0 lists everyone');
    });

    await t('nudge listing excludes paid seats, unselected galas and test rows', async () => {
        const paid = makeHeldCa(); releaseStatuses(paid.caId);
        await payLink.sendGalaPayLink(deps(), paid.caId);
        db.run("UPDATE gala_registrations SET payment_status='paid' WHERE id=?", [paid.galaId]);
        const noGala = makeHeldCa({ selected_gala: 0 }); releaseStatuses(noGala.caId);
        const testRow = makeHeldCa({ first_name: 'Scanner' }); releaseStatuses(testRow.caId);
        await payLink.sendGalaPayLink(deps(), testRow.caId);
        db.run("UPDATE gala_registrations SET requests='SCANNER TEST — safe to delete' WHERE id=?", [testRow.galaId]);

        const ids = payLink.listUnpaidGalaNudges(deps(), { days: 0 }).map(r => r.ca_id);
        assert.ok(!ids.includes(paid.caId), 'a paid seat is never chased');
        assert.ok(!ids.includes(noGala.caId), 'a registration with no Gala is not in this list');
        assert.ok(!ids.includes(testRow.caId), 'test rows are excluded');
    });

    await t('nudge real run sends once, then never again', async () => {
        const { caId, galaId, email } = makeHeldCa({ first_name: 'Magdalena', guest_count: 1 });
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        const before = sent.length;

        const out = await payLink.sendUnpaidGalaNudge(deps(), caId);
        assert.strictEqual(out.status, 'done');
        assert.strictEqual(sent.length, before + 1, 'exactly one reminder');
        const msg = lastTo(email);
        assert.strictEqual(msg.subject, 'Your Gala seat is still waiting — Plexus 2026');
        assert.ok(msg.html.includes('Dear Magdalena'));
        assert.ok(msg.html.includes(`/pay/gala/${gala(galaId).pay_token}`), 'the SAME payment link, not a new one');
        assert.ok(msg.html.includes('2 seats · €300'), 'states the party total');
        assert.ok(msg.html.includes('reply to this email and we will send your Conference and Building Bridges Zagreb ticket on its own'),
            'offers the free-events fallback, and reads as English');
        assert.ok(!/your the /.test(msg.html), 'no "your the Conference"');
        assert.ok(msg.html.includes('nothing to pay'), 'and says it costs nothing');
        assert.ok(msg.html.includes('laura.rodman@medx.hr'), 'Laura footer');
        assert.ok(gate.getMarker(ca(caId).notes, 'GALA-NUDGE-SENT'), 'stamped GALA-NUDGE-SENT');
        assert.ok(gate.getMarker(ca(caId).notes, 'GALA-PAYLINK-SENT'), 'and the approval marker survives');

        const again = await payLink.sendUnpaidGalaNudge(deps(), caId);
        assert.strictEqual(again.status, 'already');
        assert.strictEqual(sent.length, before + 1, 'a second sweep re-sends nothing');
        assert.ok(payLink.listUnpaidGalaNudges(deps(), { days: 0 }).find(r => r.ca_id === caId).already_nudged,
            'and the listing shows it as already nudged');
    });

    await t('nudge refuses a seat with no payment link, and a paid one', async () => {
        const noLink = makeHeldCa(); releaseStatuses(noLink.caId);
        const before = sent.length;
        assert.strictEqual((await payLink.sendUnpaidGalaNudge(deps(), noLink.caId)).status, 'no-pay-link',
            'send the approval email first');
        const paid = makeHeldCa(); releaseStatuses(paid.caId);
        await payLink.sendGalaPayLink(deps(), paid.caId);
        db.run("UPDATE gala_registrations SET payment_status='paid' WHERE id=?", [paid.galaId]);
        assert.strictEqual((await payLink.sendUnpaidGalaNudge(deps(), paid.caId)).status, 'already-paid');
        assert.strictEqual(sent.length, before + 1, 'only the approval email in this block');
    });

    await t('the nudge route defaults to a dry run in every shape', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');
        assert.ok(src.includes("app.post('/api/admin/gala/unpaid-nudge', auth, adminOnly"), 'mounted behind admin auth');
        assert.ok(/const dry = !\(q\.dry === 0 \|\| q\.dry === '0' \|\| q\.dry === false \|\| q\.dry === 'false' \|\| q\.dry === 'no'\)/.test(src),
            'only an explicit 0/false/no arms the send');
        assert.ok(!/setInterval[^\n]*unpaid-nudge|cron[^\n]*unpaid-nudge/i.test(src), 'and it is never scheduled');
    });

    // ==================== 9. THE SHAPE OF THE WHOLE STORY ====================
    await t('end to end: hold -> approve -> pay leaves exactly two emails and clean state', async () => {
        const { caId, galaId, email } = makeHeldCa({ first_name: 'Magdalena', last_name: 'Zebrowska',
            email: 'magdalena@meduniwien.example', country: 'Austria', guest_count: 0 });
        releaseStatuses(caId);

        await runApprove(caId);
        assert.strictEqual(allTo(email).length, 1, 'one email at approval');
        assert.ok(!/data-reg=/.test(lastTo(email).html), 'and it holds no QR');

        const token = gala(galaId).pay_token;
        // /pay/gala/:token's own gate, asserted verbatim.
        const resolved = query.get('SELECT * FROM gala_registrations WHERE pay_token = ?', [token]);
        assert.ok(resolved && token.length >= 16, 'the emailed token resolves a row');
        assert.strictEqual(resolved.status, 'approved', 'and passes the /pay/gala status gate');
        const q = payLink.quoteGalaSeats(effectiveGalaPrice, resolved);
        assert.strictEqual(q.total, 150, 'which will charge her one seat');

        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: q.total, invoiceNumber: 'GALA26-0047' });
        assert.strictEqual(allTo(email).length, 2, 'one email at payment — two in total, never three');
        assert.ok(/data-reg=/.test(lastTo(email).html), 'and THIS one carries the single ticket');

        const c = ca(caId);
        assert.deepStrictEqual(
            [c.conference_status, c.bridges_status, c.gala_status, c.gala_payment_status],
            ['pre-registered', 'pre-registered', 'confirmed', 'paid'],
            'every leg ends where it should');
    });

    // ==================== 10. THE OFFICIAL-INVOICE NOTE (to the finance lead) ====================
    // "I need an official invoice made out to my company or institution" — a tick on the Zagreb
    // form, only offered with the Gala. On PAYMENT the finance lead (vp@medx.hr) is told ONCE,
    // from whichever webhook branch the payment arrives on; the registrant is not written to.
    await t('invoice: the finance recipient is the VP, overridable by env only', () => {
        assert.strictEqual(payLink.FINANCE_TO, 'vp@medx.hr');
        assert.strictEqual(payLink.INVOICE_MARKER, 'INVOICE-MIRO-NOTIFIED');
    });

    await t('invoice: the note names the registrant, the amount, the ref, the seats — and asks for FIRA', () => {
        const html = payLink.buildInvoiceNeededEmail({
            name: 'Ivana Horvat', email: 'ivana@klinika.hr', institution: 'Klinika d.o.o.', country: 'Croatia',
            seats: 2, amount: 300, paymentRef: 'GALA26-0077', registrationId: 'abcdef12-3456'
        });
        for (const needle of ['Official invoice needed', 'Ivana Horvat', 'ivana@klinika.hr', 'Klinika d.o.o.', 'Croatia',
                              '€300', 'GALA26-0077', 'ABCDEF12', 'issue the invoice via FIRA',
                              'legal name, address, OIB / VAT ID', 'has not been written to']) {
            assert.ok(html.includes(needle), 'missing: ' + needle);
        }
        assert.ok(html.includes('>2<') || html.includes('>2</td>'), 'seat count in the facts');
        assert.ok(!/href="https?:\/\/[^"]*\/pay\/gala/.test(html), 'no payment link — this is not a registrant email');
    });

    await t('invoice: a row that did not tick the box sends nothing and is left alone', async () => {
        const { caId, galaId } = makeHeldCa({ needs_invoice: 0 });
        releaseStatuses(caId);
        const before = sent.length;
        const out = await payLink.notifyInvoiceNeeded(deps(), { caId, galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0080' });
        assert.strictEqual(out.status, 'not-needed');
        assert.strictEqual(sent.length, before);
        assert.strictEqual(gate.getMarker(ca(caId).notes, payLink.INVOICE_MARKER), null);
    });

    await t('invoice: a ticked row tells the finance lead once, stamps the marker, and never again', async () => {
        const { caId, galaId, email } = makeHeldCa({ needs_invoice: 1, guest_count: 1, institution: 'Northwell Health' });
        releaseStatuses(caId);
        const before = sent.length;
        const first = await payLink.notifyInvoiceNeeded(deps(), { caId, galaRegId: galaId, amount: 300, invoiceNumber: 'GALA26-0081' });
        assert.strictEqual(first.status, 'done');
        assert.strictEqual(first.to, 'vp@medx.hr');
        assert.strictEqual(sent.length, before + 1, 'exactly one email');
        const msg = sent[sent.length - 1];
        assert.strictEqual(msg.to, 'vp@medx.hr', 'to the finance lead, not the registrant');
        assert.notStrictEqual(msg.to, email);
        assert.strictEqual(msg.subject, 'Official invoice needed — Ana Franceschi, Gala Evening');
        assert.ok(msg.html.includes('Northwell Health'));
        assert.ok(msg.html.includes('€300'));
        assert.ok(msg.html.includes('GALA26-0081'));
        assert.ok(gate.getMarker(ca(caId).notes, payLink.INVOICE_MARKER), 'marker stamped on the CA row');

        // second call, by the id of the OTHER branch (gala id only) — nothing
        const again = await payLink.notifyInvoiceNeeded(deps(), { galaRegId: galaId, amount: 300, invoiceNumber: 'GALA26-0081' });
        assert.strictEqual(again.status, 'already');
        assert.strictEqual(sent.length, before + 1, 'no second note');
    });

    await t('invoice: a failed send stamps nothing, so the next delivery can try again', async () => {
        const { caId, galaId } = makeHeldCa({ needs_invoice: 1 });
        releaseStatuses(caId);
        FAIL_NEXT_SEND = true;
        const out = await payLink.notifyInvoiceNeeded(deps(), { caId, galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0082' });
        assert.strictEqual(out.status, 'send-failed');
        assert.strictEqual(gate.getMarker(ca(caId).notes, payLink.INVOICE_MARKER), null);
        const retry = await payLink.notifyInvoiceNeeded(deps(), { caId, galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0082' });
        assert.strictEqual(retry.status, 'done');
    });

    await t('invoice: the pay-link payment path fires it from inside the combined-ticket fulfilment', async () => {
        const { caId, galaId, email } = makeHeldCa({ needs_invoice: 1 });
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        const before = sent.length;
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0083' });
        const mine = sent.slice(before);
        assert.strictEqual(mine.length, 2, 'finance note + the combined ticket');
        assert.deepStrictEqual(mine.map(m => m.to).sort(), ['vp@medx.hr', email].sort());
        assert.ok(gate.getMarker(ca(caId).notes, payLink.INVOICE_MARKER));
        // a replayed webhook is a duplicate — neither email again
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0083' });
        assert.strictEqual(sent.length, before + 2);
    });

    await t('invoice: a ticked row that never paid tells nobody (the note is a payment event)', async () => {
        const { caId, email } = makeHeldCa({ needs_invoice: 1 });
        releaseStatuses(caId);
        const before = sent.length;
        await payLink.sendGalaPayLink(deps(), caId);           // approval email only
        assert.strictEqual(sent.length, before + 1);
        assert.strictEqual(sent[sent.length - 1].to, email);
        assert.strictEqual(gate.getMarker(ca(caId).notes, payLink.INVOICE_MARKER), null);
    });

    await t('invoice: server.js persists the tick on BOTH rows, shows it to the reviewer, and calls the note from Path B', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');
        assert.ok(src.includes("ADD COLUMN needs_invoice INTEGER DEFAULT 0"), 'column migration present');
        assert.ok(/INSERT INTO gala_registrations \(id, first_name, last_name, email, institution, status, payment_status, dietary, requests, user_id, needs_invoice\)/.test(src), 'gala row carries it');
        assert.ok(/gala_registration_id, source, user_id, needs_invoice\)/.test(src), 'CA row carries it');
        assert.ok(src.includes("'Official invoice': finalGala ? (needsInvoice ?"), 'review email lists it');
        assert.ok(src.includes("galaPayLink.notifyInvoiceNeeded(caPayLinkDeps(), { caId: caRegId, galaRegId, amount, invoiceNumber })"), 'Path B webhook calls the note');
        assert.ok(src.includes("official_invoice: caNeedsInvoice ? 'YES' : 'NO'"), 'Path B sheet row carries it');
        assert.ok(src.includes("official_invoice: Number(galaReg.needs_invoice) ? 'YES' : 'NO'"), 'pay-link sheet row carries it');
        assert.ok(src.includes('id="pf_invoice"'), '/plexus form offers the tick');
        assert.ok(src.includes('id="caInvoice"'), 'the Croatians Abroad form offers the tick');
        assert.ok(src.includes("invWrap.style.display = galaSel ? 'block' : 'none'"), '/plexus shows it only with the Gala');
        assert.ok(src.includes("caInvWrap.style.display = state.gala ? 'block' : 'none'"), 'CA form shows it only with the Gala');
        assert.ok(src.includes("const needsInvoice = finalGala &&"), 'ignored unless the Gala is selected');
        const admin = fs.readFileSync(path.join(__dirname, '..', 'admin-portal', 'backend', 'server.js'), 'utf8');
        assert.ok(admin.includes("ALTER TABLE croatians_abroad_registrations ADD COLUMN needs_invoice INTEGER DEFAULT 0"), 'admin mirrors the CA column');
        assert.ok(admin.includes("ALTER TABLE gala_registrations ADD COLUMN needs_invoice INTEGER DEFAULT 0"), 'admin mirrors the gala column');
    });

    await t('no email escaped the stub and no network was touched', () => {
        assert.ok(sent.length > 0, 'the stub did capture sends');
        assert.throws(() => global.fetch(), /NETWORK DISABLED/, 'fetch stayed disabled throughout');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
