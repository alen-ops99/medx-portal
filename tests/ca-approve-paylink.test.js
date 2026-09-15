/**
 * tests/ca-approve-paylink.test.js — the Gala leg of a review-held Zagreb registration
 * (user-portal/backend/gala-paylink.js).
 *
 * THE BUG UNDER TEST. A /plexus registration that the review gate HELD never reached Stripe.
 * Approving it replayed the free-events confirmation but left the Gala leg at
 * gala_registrations.status='awaiting_payment' with pay_token NULL — no payment link was ever
 * minted, so no email could carry one. Two real registrants (Ana Franceschi, Magdalena
 * Zebrowska, September 2026) sat in that state. And when such a guest finally DID pay, the
 * Stripe webhook answered them on the 'gala-ticket' branch — a bare receipt with no QR and no
 * mention of the Conference or Bridges they had also registered for — leaving the CA row at
 * 'awaiting_payment' for good.
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
// VERBATIM from user-portal/backend/server.js (initializeApp), minus columns no path here reads.
raw.exec(`CREATE TABLE croatians_abroad_registrations (
    id TEXT PRIMARY KEY,
    invite_link_id TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT NOT NULL,
    institution TEXT,
    country TEXT,
    role TEXT,
    dietary TEXT,
    notes TEXT,
    selected_conference INTEGER DEFAULT 0,
    selected_bridges INTEGER DEFAULT 0,
    selected_gala INTEGER DEFAULT 0,
    conference_status TEXT,
    bridges_status TEXT,
    gala_status TEXT,
    gala_payment_status TEXT,
    gala_registration_id TEXT,
    stripe_session_id TEXT,
    amount_paid REAL,
    invoice_number TEXT,
    guest_count INTEGER DEFAULT 0,
    custom_answers TEXT,
    applied_for TEXT,
    source TEXT DEFAULT 'croatians-abroad',
    user_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE gala_registrations (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    institution TEXT,
    title TEXT,
    dietary TEXT,
    requests TEXT,
    pricing TEXT,
    status TEXT DEFAULT 'pending',
    payment_status TEXT,
    amount_paid REAL,
    invoice_number TEXT,
    stripe_session_id TEXT,
    pay_token TEXT,
    guest_count INTEGER DEFAULT 0,
    user_id TEXT,
    admin_notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE gala_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    title TEXT, date TEXT, venue TEXT,
    price_gala_only REAL, price_gala_early_bird REAL, price_gala_regular REAL,
    early_bird_deadline TEXT
)`);
raw.exec(`CREATE TABLE ca_registration_guests (
    id TEXT PRIMARY KEY, registration_id TEXT, name TEXT, institution TEXT, email TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
// The live production values on 2026-09-15 (read from Turso), so the asserted copy is the copy
// a real registrant would read.
raw.exec(`INSERT INTO gala_settings (id, title, date, venue, price_gala_only, price_gala_early_bird, price_gala_regular, early_bird_deadline)
          VALUES ('default', 'Plexus Gala Evening 2026', '2026-12-05', 'Hotel Esplanade Emerald Ballroom; Zagreb, Croatia', 150, 150, 175, '2026-09-15')`);

// server.js-shaped helpers over node:sqlite
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

const GALA_PRICE = 150;
const deps = () => ({
    query, db,
    saveDb: () => {}, flushDb: () => {},
    sendEmail: sendEmailFlaky,
    effectiveGalaPrice: () => GALA_PRICE,
    // The real helpers' contracts, reduced to what the assertions need.
    buildEmailTemplate: (title, body) => `<!DOCTYPE html><html><body data-title="${title}">${body}</body></html>`,
    buildTicketQrBlock: (regId, o = {}) => `<div class="qr" data-reg="${regId}">${o.label || ''}</div>`,
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
        guest_count: 0, notes: '', source: 'plexus'
    }, over);
    // Exactly what the register route writes for a HELD row.
    db.run(`INSERT INTO croatians_abroad_registrations
            (id, first_name, last_name, email, institution, country, selected_conference, selected_bridges, selected_gala,
             conference_status, bridges_status, gala_status, gala_payment_status, gala_registration_id, guest_count, notes, source)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [caId, f.first_name, f.last_name, f.email, f.institution, f.country,
         f.selected_conference, f.selected_bridges, f.selected_gala,
         f.selected_conference ? 'pending-review' : null,
         f.selected_bridges ? 'pending-review' : null,
         f.selected_gala ? 'pending-review' : null,
         f.selected_gala ? 'pending' : null,
         galaId, f.guest_count, f.notes, f.source]);
    if (galaId) {
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, guest_count)
                VALUES (?,?,?,?,?, 'pending-review', 'pending', ?)`,
            [galaId, f.first_name, f.last_name || '', f.email, f.institution || '', f.guest_count]);
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
const ca = id => query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [id]);
const gala = id => query.get('SELECT * FROM gala_registrations WHERE id = ?', [id]);
const lastTo = to => [...sent].reverse().find(m => m.to === to);

(async () => {
    console.log('ca-approve-paylink.test.js — hermetic (scratch sqlite, no network, no mail)\n');

    // ==================== 1. APPROVE WITH GALA ====================
    await t('approve with Gala: pay email sent once, status approved, token works, marker stamped', async () => {
        const { caId, galaId, email } = makeHeldCa();
        releaseStatuses(caId);
        const before = sent.length;

        const out = await payLink.sendGalaPayLink(deps(), caId);

        assert.strictEqual(out.status, 'done', 'approve must release the gala leg');
        assert.strictEqual(sent.length, before + 1, 'exactly ONE email');
        const msg = sent[sent.length - 1];
        assert.strictEqual(msg.to, email, 'goes to the registrant');
        assert.strictEqual(msg.subject, 'Your registration is confirmed — complete your Gala reservation');

        const g = gala(galaId);
        assert.strictEqual(g.status, 'approved', "/pay/gala refuses anything but status='approved'");
        assert.ok(g.pay_token && /^[0-9a-f]{48}$/.test(g.pay_token), 'a real secure-random hex token: ' + g.pay_token);
        assert.ok(g.pay_token.length >= 16, '/pay/gala/:token will not even look up a shorter token');
        assert.strictEqual(g.payment_status, 'pending', 'still unpaid — payment is still the filter');

        // The link in the email is the link in the database.
        assert.ok(msg.html.includes(`https://medx-user-portal.onrender.com/pay/gala/${g.pay_token}`),
            'the email carries the working /pay/gala link');
        assert.ok(msg.html.includes('Complete my Gala reservation'), 'the button label the owner asked for');

        // The owner's own words, and the facts a guest needs to act.
        assert.ok(msg.html.includes('Great news'), 'owner wording: "Great news"');
        assert.ok(/registration is confirmed/i.test(msg.html), 'says the registration is confirmed');
        assert.ok(msg.html.includes('please pay for your Gala ticket here'), 'owner wording: the ask');
        assert.ok(msg.html.includes('€150'), 'states the price from effectiveGalaPrice()');
        assert.ok(msg.html.includes('5 December 2026'), 'states the Gala date from gala_settings');
        assert.ok(/one ticket/i.test(msg.html), 'promises ONE ticket covering everything after payment');
        assert.ok(msg.html.includes('Plexus Conference') && msg.html.includes('Croatian Biomedical Bridges'),
            'names the free events the one ticket will cover');
        assert.ok(msg.html.includes('laura.rodman@medx.hr'), 'Laura footer');
        // House dark shell, same as every other review-gate registrant email.
        assert.ok(msg.html.includes('background:#120e0a'), 'dark shell canvas');
        assert.ok(msg.html.includes('REGISTRATION'), 'house header label');

        // The CA row keeps 'awaiting_payment' — the webhook is what confirms it.
        assert.strictEqual(ca(caId).gala_status, 'awaiting_payment');
        assert.strictEqual(ca(caId).conference_status, 'pre-registered', 'free legs untouched');
        assert.ok(gate.getMarker(ca(caId).notes, 'GALA-PAYLINK-SENT'), 'notes stamped GALA-PAYLINK-SENT');
    });

    await t('the early-bird deadline appears only while it is still ahead', async () => {
        const { caId } = makeHeldCa();
        releaseStatuses(caId);
        const today = new Date().toISOString().slice(0, 10);

        db.run("UPDATE gala_settings SET early_bird_deadline = '2020-01-01' WHERE id = 'default'");
        await payLink.sendGalaPayLink(deps(), caId);
        assert.ok(!/Early-bird price until/.test(sent[sent.length - 1].html),
            'a deadline in the past is a stale promise — never printed');

        const b = makeHeldCa();
        releaseStatuses(b.caId);
        db.run("UPDATE gala_settings SET early_bird_deadline = '2030-06-01' WHERE id = 'default'");
        await payLink.sendGalaPayLink(deps(), b.caId);
        assert.ok(/Early-bird price until/.test(sent[sent.length - 1].html), 'a live deadline is stated');
        assert.ok(sent[sent.length - 1].html.includes('1 June 2030'), 'formatted, not raw ISO');

        // Today's own date counts as still ahead (the production deadline is 2026-09-15).
        const c = makeHeldCa();
        releaseStatuses(c.caId);
        db.run("UPDATE gala_settings SET early_bird_deadline = ? WHERE id = 'default'", [today]);
        await payLink.sendGalaPayLink(deps(), c.caId);
        assert.ok(/Early-bird price until/.test(sent[sent.length - 1].html), 'the deadline day itself still counts');
        db.run("UPDATE gala_settings SET early_bird_deadline = '2026-09-15' WHERE id = 'default'");
    });

    await t('a party of more than one is stated but never priced (the link charges one seat)', async () => {
        const { caId } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        const html = sent[sent.length - 1].html;
        assert.ok(/notes one guest/.test(html), 'the guest is acknowledged');
        assert.ok(!/€300/.test(html), 'no party total is invented — /pay/gala charges one seat');
        assert.ok(html.includes('€150'), 'the stated price is what the link will actually charge');
    });

    // ==================== 2. NO GALA ====================
    await t('approve without Gala: nothing is sent and nothing changes', async () => {
        const { caId } = makeHeldCa({ selected_gala: 0 });
        releaseStatuses(caId);
        const before = sent.length;
        const snapshot = JSON.stringify(ca(caId));

        const out = await payLink.sendGalaPayLink(deps(), caId);

        assert.strictEqual(out.status, 'no-gala');
        assert.strictEqual(sent.length, before, 'no email');
        assert.strictEqual(JSON.stringify(ca(caId)), snapshot, 'the row is byte-identical');
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

        const out3 = await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(out3.status, 'already', 'and again');
        assert.strictEqual(sent.length, after1);
    });

    await t('a seat that is already paid is never asked to pay again', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);
        db.run("UPDATE gala_registrations SET payment_status = 'paid', status = 'confirmed' WHERE id = ?", [galaId]);
        const before = sent.length;
        const out = await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(out.status, 'already-paid');
        assert.strictEqual(sent.length, before, 'no "please pay" email to somebody who has paid');
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
        assert.strictEqual(gala(galaId).status, 'approved', 'and the seat is approved anyway');

        const retry = await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(retry.status, 'done', 'the retry goes through');
        assert.strictEqual(gala(galaId).pay_token, token, 'and carries the SAME link, not a second one');
    });

    // ==================== 4. INSTITUTIONAL PATH ====================
    await t('institutional confirmation: the pay email follows the re-pointed address', async () => {
        const { caId, galaId } = makeHeldCa({ email: 'shady.freemail@gmail.com' });
        releaseStatuses(caId);
        // review-gate.js calls h.setEmail(id, instEmail) BEFORE h.approve(id) — verbatim order.
        const instEmail = 'a.franceschi@northwell.edu';
        db.run('UPDATE croatians_abroad_registrations SET email = ? WHERE id = ?', [instEmail, caId]);

        const out = await payLink.sendGalaPayLink(deps(), caId);

        assert.strictEqual(out.status, 'done');
        assert.strictEqual(out.email, instEmail, 'reported recipient is the institutional inbox');
        const msg = sent[sent.length - 1];
        assert.strictEqual(msg.to, instEmail, 'the pay link goes to the verified inbox');
        assert.ok(!sent.some(m => m.to === 'shady.freemail@gmail.com'), 'the original free-mail address gets nothing');
        assert.ok(msg.html.includes(gala(galaId).pay_token), 'still the real token');
    });

    // ==================== 5. THE MISSING GALA ROW ====================
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
        assert.ok(gala(newId).pay_token, 'and carries a token');
    });

    await t('an unknown id is refused without side effects', async () => {
        const before = sent.length;
        const out = await payLink.sendGalaPayLink(deps(), crypto.randomUUID());
        assert.strictEqual(out.status, 'notfound');
        assert.strictEqual(sent.length, before);
    });

    // ==================== 5b. WHAT THE ADMIN SEES ====================
    await t('admin visibility: the row reads "Approved · awaiting payment" and its Pay-link action works', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);

        // BEFORE: the state the gap left behind. Both admin predicates fail on it.
        const held = gala(galaId);
        assert.strictEqual(held.status, 'awaiting_payment');
        assert.ok(!(held.status === 'approved' && held.payment_status !== 'paid'),
            'admin-portal/frontend renders the "Awaiting payment" row + Pay-link button off exactly this predicate');
        assert.ok(!held.pay_token, 'and there was no token for the button to hand out');

        await payLink.sendGalaPayLink(deps(), caId);

        // AFTER: verbatim the two conditions the admin portal applies.
        const g = gala(galaId);
        assert.ok(g.status === 'approved' && g.payment_status !== 'paid',
            'admin-portal/frontend/index.html: r.status === \'approved\' && r.payment_status !== \'paid\'');
        // admin-portal/backend/server.js GET /api/gala/registrations/:id/pay-link, verbatim:
        assert.ok(!(g.status !== 'approved'), "…rejects 'Guest must be approved first' unless status === 'approved'");
        assert.ok(!(g.payment_status === 'paid'), "…and rejects 'Already paid'");
        assert.ok(g.pay_token, '…then hands out pay_token rather than minting a second one');
        // v2/gala-ops computeGalaSummary: active + unpaid = a seat to chase, and 'approved' is active.
        assert.ok(!['cancelled', 'rejected', 'declined', 'expired'].includes(String(g.status).toLowerCase()),
            'counts as an active seat in the Gala summary');
    });

    // ==================== 6. PREVIEW ====================
    await t('preview: same email, [PREVIEW] subject, sent to the owner, row untouched', async () => {
        const { caId, galaId } = makeHeldCa({ first_name: 'Ana', last_name: 'Franceschi' });
        releaseStatuses(caId);
        const snapCa = JSON.stringify(ca(caId));
        const snapGala = JSON.stringify(gala(galaId));

        const out = await payLink.sendGalaPayLink(deps(), caId, { preview: true, to: gate.REVIEW_TO });

        assert.strictEqual(out.status, 'preview');
        const msg = sent[sent.length - 1];
        assert.strictEqual(msg.to, gate.REVIEW_TO, 'addressed to the owner');
        assert.strictEqual(gate.REVIEW_TO, 'juginovic.alen@gmail.com', 'which is Alen');
        assert.ok(msg.subject.startsWith('[PREVIEW] '), 'subject is prefixed');
        assert.ok(msg.subject.endsWith('Your registration is confirmed — complete your Gala reservation'),
            'and otherwise identical to the real one');
        assert.ok(msg.html.includes('Dear Ana'), "built from Ana's row");
        assert.ok(msg.html.includes('€150') && msg.html.includes('Complete my Gala reservation'), 'same body');

        assert.strictEqual(JSON.stringify(ca(caId)), snapCa, 'the CA row is byte-identical');
        assert.strictEqual(JSON.stringify(gala(galaId)), snapGala, 'the gala row is byte-identical');
        assert.strictEqual(gala(galaId).pay_token, null, 'NO live payment link is minted by a preview');
        assert.ok(!gate.getMarker(ca(caId).notes, 'GALA-PAYLINK-SENT'), 'and no marker is stamped');
        // The registrant themselves must not have been written to.
        assert.ok(!sent.slice(-1).some(m => m.to === ca(caId).email), 'the registrant received nothing');
    });

    // ==================== 7. THE WEBHOOK: hold -> approve -> pay ====================
    await t('webhook: a hold→approve→pay row gets the ONE combined ticket, not a bare receipt', async () => {
        const { caId, galaId, email } = makeHeldCa();
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);           // approve: link minted + sent
        const before = sent.length;

        // What server.js's 'gala-ticket' webhook branch passes once Stripe confirms.
        const out = await payLink.fulfilLinkedCaGala(deps(), {
            galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0042',
            sessionEmail: email
        });

        assert.strictEqual(out.handled, true, 'the branch must recognise a linked CA row');
        assert.deepStrictEqual(out.events, ['conference', 'bridges', 'gala'], 'the ticket covers all three');
        assert.strictEqual(sent.length, before + 1, 'exactly ONE ticket email');

        const msg = sent[sent.length - 1];
        assert.strictEqual(msg.to, email);
        assert.strictEqual(msg.subject, 'Payment Confirmed — Plexus 2026');
        assert.ok(msg.html.includes('PAYMENT CONFIRMED'), 'reads as a receipt');
        assert.ok(/(€|&euro;)150\.00/.test(msg.html), 'states the amount actually charged');
        assert.ok(msg.html.includes('GALA26-0042'), 'carries the invoice number');
        // The thing the old 'gala-ticket' receipt never had.
        assert.ok(msg.html.includes(`data-reg="${galaId}"`), 'carries the check-in QR block');
        assert.ok(msg.attachments.length === 1 && msg.attachments[0].filename === 'plexus-ticket-qr.png',
            'and the QR is attached as a PNG');
        assert.deepStrictEqual(msg.attachments[0]._payload.events, ['conference', 'bridges', 'gala'],
            'the QR payload admits all three events, so the scanner verifies every mode');
        assert.strictEqual(msg.attachments[0]._payload.caRegId, caId, 'and carries BOTH ids');
        assert.strictEqual(msg.attachments[0]._payload.regId, galaId);
        assert.ok(msg.html.includes('Plexus Conference') && msg.html.includes('Croatian Biomedical Bridges')
            && msg.html.includes('Plexus Gala Evening'), 'all three events are listed');
        assert.ok(msg.html.includes('CONFIRMED &amp; PAID'), 'the Gala line reads as paid');

        // Statuses square up on BOTH tables.
        const c = ca(caId);
        assert.strictEqual(c.gala_status, 'confirmed');
        assert.strictEqual(c.gala_payment_status, 'paid');
        assert.strictEqual(c.amount_paid, 150);
        assert.strictEqual(c.invoice_number, 'GALA26-0042');
    });

    await t('webhook: a duplicate delivery re-sends nothing', async () => {
        const { caId, galaId } = makeHeldCa();
        releaseStatuses(caId);
        await payLink.sendGalaPayLink(deps(), caId);
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0043' });
        const after = sent.length;

        const dup = await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0043' });
        assert.strictEqual(dup.handled, true);
        assert.strictEqual(dup.duplicate, true);
        assert.strictEqual(sent.length, after, 'no second ticket');
        assert.strictEqual(ca(caId).invoice_number, 'GALA26-0043', 'and the invoice is not renumbered');
    });

    await t('webhook: a standalone gala row is NOT claimed — the existing receipt still owns it', async () => {
        const soloId = crypto.randomUUID();
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, pay_token)
                VALUES (?,?,?,?,?, 'approved', 'pending', ?)`,
            [soloId, 'Solo', 'Guest', 'solo@example.org', 'Somewhere', 'a'.repeat(48)]);
        const before = sent.length;
        const out = await payLink.fulfilLinkedCaGala(deps(), { galaRegId: soloId, amount: 150, invoiceNumber: 'GALA26-0044' });
        assert.strictEqual(out.handled, false, 'handled:false leaves server.js on its untouched path');
        assert.strictEqual(sent.length, before, 'and this module sends nothing');
    });

    await t('webhook: a named party guest gets the SAME shared QR', async () => {
        const { caId, galaId, email } = makeHeldCa({ guest_count: 1 });
        releaseStatuses(caId);
        db.run('INSERT INTO ca_registration_guests (id, registration_id, name, institution, email) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), caId, 'Emeric du Mas de Paysac', 'Sorbonne', 'guest@example.org']);
        const before = sent.length;

        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0045' });

        assert.strictEqual(sent.length, before + 2, 'registrant + one named guest');
        const g = lastTo('guest@example.org');
        assert.ok(g, 'the guest was written to');
        assert.strictEqual(g.subject, 'Your Gala Evening entry — Plexus 2026');
        assert.ok(g.html.includes(`data-reg="${galaId}"`), 'the same party QR, not a second ticket');
        assert.ok(g.html.includes('Emeric'), 'addressed by first name');
        assert.ok(lastTo(email).html.includes('PAYMENT CONFIRMED'), 'and the registrant still got the receipt');
    });

    await t('webhook: a Gala-only registration is confirmed without inventing free events', async () => {
        const { caId, galaId } = makeHeldCa({ selected_conference: 0, selected_bridges: 0 });
        releaseStatuses(caId);
        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 175, invoiceNumber: 'GALA26-0046' });
        const msg = sent[sent.length - 1];
        assert.ok(msg.html.includes('Plexus Gala Evening'));
        assert.ok(!msg.html.includes('Plexus Conference'), 'no event they did not register for');
        assert.ok(!msg.html.includes('Croatian Biomedical Bridges'));
        assert.strictEqual(ca(caId).gala_status, 'confirmed');
    });

    // ==================== 8. THE SHAPE OF THE WHOLE STORY ====================
    await t('end to end: hold -> approve -> pay leaves exactly two emails and clean state', async () => {
        const { caId, galaId, email } = makeHeldCa({ first_name: 'Magdalena', last_name: 'Zebrowska',
            email: 'magdalena@meduniwien.example', country: 'Austria' });
        const mine = () => sent.filter(m => m.to === email);
        releaseStatuses(caId);

        await payLink.sendGalaPayLink(deps(), caId);
        assert.strictEqual(mine().length, 1, 'one email at approve');

        const token = gala(galaId).pay_token;
        // /pay/gala/:token's own gate, asserted verbatim: it resolves by token and REQUIRES approved.
        const resolved = query.get('SELECT * FROM gala_registrations WHERE pay_token = ?', [token]);
        assert.ok(resolved && token.length >= 16, 'the emailed token resolves a row');
        assert.strictEqual(resolved.status, 'approved', 'and passes the /pay/gala status gate');
        assert.notStrictEqual(resolved.payment_status, 'paid', 'and is not short-circuited as already paid');

        await payLink.fulfilLinkedCaGala(deps(), { galaRegId: galaId, amount: 150, invoiceNumber: 'GALA26-0047' });
        assert.strictEqual(mine().length, 2, 'one email at payment — two in total, never three');

        const c = ca(caId);
        assert.deepStrictEqual(
            [c.conference_status, c.bridges_status, c.gala_status, c.gala_payment_status],
            ['pre-registered', 'pre-registered', 'confirmed', 'paid'],
            'every leg ends where it should');
    });

    await t('no email escaped the stub and no network was touched', () => {
        assert.ok(sent.length > 0, 'the stub did capture sends');
        assert.throws(() => global.fetch(), /NETWORK DISABLED/, 'fetch stayed disabled throughout');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
