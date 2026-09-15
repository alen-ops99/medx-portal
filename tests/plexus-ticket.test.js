/**
 * tests/plexus-ticket.test.js — the one Plexus Week ticket design (user-portal/backend/plexus-ticket.js):
 * the Boston-style email family, the on-screen ticket page, the calendar file. Pure builders, no I/O.
 *
 * Run:  node tests/plexus-ticket.test.js
 */
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pt = require('../user-portal/backend/plexus-ticket.js');

let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ok    ' + name); } catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); } }

const W = { apple: 'https://x/api/plexus/pass/tok.pkpass', google: 'https://x/api/plexus/wallet/tok' };
const QR = 'https://x/qr/88ee6223-f4c6-4296-88c0-05933eb5d4d5.png';

console.log('plexus-ticket.test.js — pure builders\n');

t('the four emails share one Boston-style shell: light, PLEXUS WEEK header, facts card, QR, three buttons', () => {
    const kinds = {
        combined: pt.ticketEmail('combined', { firstName: 'Ana', fullName: 'Ana Franceschi', legs: ['conference', 'bridges', 'gala'], seats: 2, amount: 300, invoice: 'GALA26-0041', qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics?legs=conference%2Cbridges%2Cgala', partyNote: 'This QR admits your whole party of 2.', source: 'plexus' }),
        'gala-guest': pt.ticketEmail('gala-guest', { firstName: 'Emeric', fullName: 'Emeric du Mas de Paysac', legs: ['gala'], guestOf: 'Ana Franceschi', qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics?legs=gala', ticketCode: '88EE6223' }),
        gala: pt.ticketEmail('gala', { firstName: 'Lord', fullName: 'Lord Smith', legs: ['gala'], seats: 1, amount: 0, seat: '7', qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics?legs=gala', ticketCode: 'ABCDEF12' }),
        free: pt.ticketEmail('free', { firstName: 'Iva', fullName: 'Iva Free', legs: ['conference', 'bridges'], qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics?legs=conference%2Cbridges', ticketCode: '44444444' })
    };
    for (const [k, html] of Object.entries(kinds)) {
        assert.ok(html.includes('PLEXUS WEEK 2026 · ZAGREB'), k + ': header label');
        assert.ok(html.includes('you are <i>in</i>.'), k + ': the Boston headline');
        assert.ok(html.includes(QR), k + ': the hosted QR');
        assert.ok(html.includes('ADD TO APPLE WALLET') && html.includes('ADD TO GOOGLE WALLET') && html.includes('ADD TO CALENDAR'), k + ': the three buttons');
        assert.ok(html.includes('laura.rodman@medx.hr'), k + ': Laura');
        assert.ok(!html.includes('#342718'), k + ': never the dark shell');
        assert.ok(!/\bhonest\b/i.test(html), k + ': never that word');
        assert.ok(!/updated our systems|apolog/i.test(html), k + ': no apology framing');
    }
    assert.ok(kinds.combined.includes('&euro;300.00') && kinds.combined.includes('2 Gala seats') && kinds.combined.includes('GALA26-0041'), 'combined: amount, seats, invoice');
    assert.ok(kinds.combined.includes('Gala Evening: black tie') && kinds.combined.includes('Assigned closer to the Gala'), 'combined: dress + table');
    assert.ok(kinds.combined.includes('the <b>Conference program</b>') && kinds.combined.includes('the <b>Building Bridges date and venue</b>'), 'combined: program note');
    assert.ok(kinds['gala-guest'].includes('Guest of Ana Franceschi') && kinds['gala-guest'].includes('Your seat is paid for'), 'guest: host + paid');
    assert.ok(kinds.gala.includes('Table 7') && kinds.gala.includes('complimentary'), 'standalone comp: table + label');
    assert.ok(kinds.free.includes("YOU'RE IN") && kinds.free.includes('nothing to pay') && kinds.free.includes('join the <b>Gala Evening</b>'), 'free: kicker, free, the Gala invitation');
    assert.ok(!kinds.free.includes('DRESS CODE'), 'free: no dress code without a Gala');
});

t('WHEN lines carry each leg with its own date and venue; WHERE collapses to the single venue when one leg', () => {
    assert.deepStrictEqual(pt.whenLinesFor(['conference', 'gala']), [
        'Plexus Conference — 4 December 2026 · Novinarski dom, Zagreb',
        'Gala Evening — 5 December 2026 · 19:00 · arrival from 7:00 PM · Hotel Esplanade, Zagreb'
    ]);
    assert.strictEqual(pt.whereFor(['gala']), 'Hotel Esplanade, Zagreb');
    assert.strictEqual(pt.whereFor(['conference', 'gala']), 'Zagreb, Croatia');
    assert.strictEqual(pt.joinAnd(['A', 'B', 'C']), 'A, B and C');
});

t('the calendar file: one VEVENT per leg held, Europe/Zagreb, parseLegs tolerant', () => {
    const ics = pt.icsFor(['conference', 'gala']);
    assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(ics.includes('DTSTART;TZID=Europe/Zagreb:20261204T090000') && ics.includes('DTSTART;TZID=Europe/Zagreb:20261205T190000'));
    assert.ok(ics.includes('SUMMARY:Plexus Week 2026 — Gala Evening') && ics.includes('LOCATION:Hotel Esplanade\\, Zagreb'));
    assert.ok(!ics.includes('Building Bridges'), 'only the legs asked for');
    assert.deepStrictEqual(pt.parseLegs('gala,conference'), ['conference', 'gala'], 'canonical order');
    assert.deepStrictEqual(pt.parseLegs(''), ['conference', 'bridges', 'gala'], 'nothing asked → everything');
    assert.deepStrictEqual(pt.parseLegs('bogus'), ['conference', 'bridges', 'gala']);
    assert.strictEqual(pt.calendarUrl('https://x', ['conference', 'gala']), 'https://x/plexus.ics?legs=conference%2Cgala');
});

t('the ticket page: the email\'s twin — legs, party per leg, QR + code, wallet + calendar, guests; pending refreshes itself', () => {
    const html = pt.ticketPageHtml({
        state: 'ticket', headline: 'Plexus Week 2026 — you are <i>in</i>.', sub: 'Thank you',
        fullName: 'Ana Franceschi', legs: ['conference', 'bridges', 'gala'], party: { conference: 2, bridges: 2, gala: 2 }, seats: 2,
        invoice: 'GALA26-0041', ticketCode: '88EE6223', qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics?legs=conference%2Cbridges%2Cgala',
        guests: [{ name: 'Emeric du Mas de Paysac', email: 'e@x.org' }]
    });
    assert.ok(html.includes(QR) && html.includes('GALA26-0041') && html.includes('code 88EE6223'));
    assert.ok(html.includes('Add to Apple Wallet') && html.includes('Add to Google Wallet') && html.includes('Add to calendar'));
    assert.ok(html.includes('CONFIRMED &amp; PAID · 2 SEATS') && html.includes('you + 1 guest'));
    assert.ok(html.includes('Emeric du Mas de Paysac') && html.includes('their own ticket went to e@x.org'));
    assert.ok(html.includes('background:#f7f1e6') && html.includes('#1b1613'), 'cream page, ink band');
    assert.ok(!html.includes('http-equiv="refresh"'));
    const pending = pt.ticketPageHtml({ state: 'pending', headline: 'Finalizing', sub: 's', fullName: 'A', legs: ['gala'], party: {}, seats: 1 });
    assert.ok(pending.includes('http-equiv="refresh"') && pending.includes('FINALIZING') && !pending.includes('Add to Apple Wallet'));
});

t('page signatures: the gala page keeps its original HMAC context (minted success_urls stay valid); forged never equals', () => {
    assert.strictEqual(pt.galaPageSig('s', 'abc'), require('node:crypto').createHmac('sha256', 's').update('gala-ticket-page:abc').digest('hex').slice(0, 32));
    assert.notStrictEqual(pt.pageSig('s', 'ca', 'abc'), pt.galaPageSig('s', 'abc'));
    assert.ok(pt.safeEq('abcd', 'abcd') && !pt.safeEq('abcd', 'abce') && !pt.safeEq('abc', 'abcd'));
});

t('server.js: every Plexus ticket email and page goes through the family; the .ics route exists', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'server.js'), 'utf8');
    assert.ok(src.includes("plexusTicket.ticketEmail('gala', {"), 'standalone gala receipt');
    assert.ok(src.includes("plexusTicket.ticketEmail(finalGala ? 'combined' : 'free', {"), 'pre-registration confirmation');
    assert.ok(src.includes("app.get('/plexus/ticket/:sig/:id'") && src.includes("app.get('/gala/ticket/:sig/:id'") && src.includes("app.get('/plexus.ics'"), 'pages + calendar');
    assert.ok(src.includes('ticket_url: plexusTicketPageUrl('), 'the free-events register response hands the form its ticket page');
    assert.ok(src.includes("if(d.ticket_url){ window.location = d.ticket_url; return false; }") && src.includes('if (result.ticket_url) {'), 'both forms redirect to it');
    assert.ok(!src.includes("buildEmailTemplate('Pre-Registration Confirmed'"), 'the old pre-registration template is gone');
    // The Zagreb payment sites are off the old template (Accelerator / Forum / invite / paid-conference
    // receipts are other flows and keep theirs for now).
    const zagreb = src.slice(src.indexOf("if (metadata.type === 'croatians-abroad-gala')"), src.indexOf("// ===== INVITE LINK PAYMENT (any event type) ====="));
    assert.ok(zagreb.length > 1000 && !zagreb.includes("buildEmailTemplate('Payment Confirmed'"), 'Path B is off the old template');
    const galaBranch = src.slice(src.indexOf('let caCombined = { handled: false };'), src.indexOf('let caCombined = { handled: false };') + 4000);
    assert.ok(!galaBranch.includes("buildEmailTemplate('Payment Confirmed'"), 'and so is the standalone gala receipt');
    const gp = fs.readFileSync(path.join(__dirname, '..', 'user-portal', 'backend', 'gala-paylink.js'), 'utf8');
    assert.ok(gp.includes("plexusTicket.ticketEmail('combined'") && gp.includes("plexusTicket.ticketEmail('gala-guest'"), 'gala-paylink delegates to the family');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
