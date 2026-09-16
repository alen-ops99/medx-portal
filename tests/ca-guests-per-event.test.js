// tests/ca-guests-per-event.test.js — guests may join the Conference and Building Bridges Zagreb,
// not only the Gala (Alen, 2026-09-16). Pure rules in ca-guests.js, the guest pass kind, the guest
// copy builder, and the source contracts that keep the register route, the doors and the emails
// on the same definition of "who joins what".
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ca = require(path.join(ROOT, 'user-portal/backend/ca-guests.js'));
const ticket = require(path.join(ROOT, 'user-portal/backend/plexus-ticket.js'));
const pass = require(path.join(ROOT, 'user-portal/backend/plexus-pass.js'));
const paylink = require(path.join(ROOT, 'user-portal/backend/gala-paylink.js'));
const userSrc = fs.readFileSync(path.join(ROOT, 'user-portal/backend/server.js'), 'utf8');
const adminSrc = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');

const all = { wantConf: true, wantBridges: true, wantGala: true };

test('a guest holds only the legs the host selected — client flags are masked, never trusted', () => {
    const out = ca.normalizeGuests([{ name: 'Ana Horvat', conference: true, bridges: true, gala: true }], { wantConf: true, wantBridges: false, wantGala: true });
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].conference, out[0].bridges, out[0].gala], [true, false, true]);
});

test('guest_count is the number of Gala-ticked guests, not the number of guests', () => {
    const out = ca.normalizeGuests([
        { name: 'Ana', conference: true, gala: false },
        { name: 'Marko', conference: true, gala: true }
    ], all);
    assert.equal(out.length, 2);
    assert.equal(ca.galaGuestCount(out), 1, 'one Gala seat beyond the registrant');
});

test('a guest with no leg left after masking is dropped; nameless + emailless guests are dropped; max two', () => {
    const out = ca.normalizeGuests([
        { name: 'Only Gala', gala: true },                       // host has no Gala → nothing left
        { name: '', email: '', conference: true },               // nobody
        { name: 'One', conference: true },
        { name: 'Two', bridges: true },
        { name: 'Three', conference: true }                      // beyond the cap
    ], { wantConf: true, wantBridges: true, wantGala: false });
    assert.deepEqual(out.map(g => g.name), [], 'the form sends at most two rows; the first two here were both invalid');
    const two = ca.normalizeGuests([{ name: 'One', conference: true }, { name: 'Two', bridges: true }, { name: 'Three', conference: true }], all);
    assert.deepEqual(two.map(g => g.name), ['One', 'Two'], 'never more than two guests');
});

test('a payload from before the flags existed (no keys) is a Gala guest, exactly as before', () => {
    const out = ca.normalizeGuests([{ name: 'Legacy Guest', email: 'LEGACY@Example.com' }], all);
    assert.equal(out.length, 1);
    assert.deepEqual([out[0].conference, out[0].bridges, out[0].gala], [false, false, true]);
    assert.equal(out[0].email, 'legacy@example.com', 'email normalised to lower case');
    assert.equal(ca.normalizeGuests([{ name: 'Legacy Guest' }], { wantConf: true, wantBridges: true, wantGala: false }).length, 0,
        'a legacy Gala guest without a Gala leg on the host disappears (it never had anywhere to go)');
});

test('stored rows: flags → legs → event names; an all-zero pre-flag row reads as a Gala guest', () => {
    assert.deepEqual(ca.legsOf({ conference: 1, bridges: 0, gala: 1 }), ['conference', 'gala']);
    assert.deepEqual(ca.legsOf({ conference: 0, bridges: 0, gala: 0 }), ['gala']);
    assert.deepEqual(ticket.guestLegs({ conference: '1', bridges: 1 }), ['conference', 'bridges']);
    assert.deepEqual(ticket.guestEvents({ bridges: 1 }), ['Building Bridges Zagreb']);
    assert.equal(ca.summary([{ name: 'Ana', conference: true, gala: true }, { email: 'm@x.hr', bridges: true }]),
        'Ana (Plexus Conference + Gala Evening); m@x.hr (Building Bridges Zagreb)');
});

test('the guests block on the ticket names each guest with THEIR events, not "Gala Evening" for all', () => {
    const html = ticket.guestsHtml([{ name: 'Ana Horvat', email: 'ana@x.hr', conference: 1, gala: 0 }, { name: 'Marko', conference: 0, gala: 1 }]);
    assert.match(html, /Ana Horvat<\/b> <span[^>]*>— Plexus Conference</);
    assert.match(html, /Marko<\/b> <span[^>]*>— Gala Evening</);
    assert.match(html, /their own ticket went to ana@x\.hr/);
    assert.match(html, /no email given/);
});

test('guest copy: a Gala guest reads the Gala card, a free-only guest the free-events card', () => {
    const base = { guestFirst: 'Ana', guestName: 'Ana Horvat', registrantName: 'Ivan Ivić', qrPngUrl: 'https://x/qr/1.png', wallet: null, ticketCode: 'ABCD1234' };
    const gala = paylink.buildGuestEntryEmail({ ...base, legs: ['conference', 'gala'] });
    assert.match(gala, /registered you as their guest for the Plexus Week 2026 Gala Evening/);
    assert.match(gala, /Plexus Conference/, 'the Conference leg the guest also holds is on the card');
    const free = paylink.buildGuestEntryEmail({ ...base, legs: ['conference'] });
    assert.match(free, /registered you as their guest for Plexus Conference at Plexus Week 2026/);
    assert.doesNotMatch(free, /Gala seat, paid/);
    const legacy = paylink.buildGuestEntryEmail(base);              // no legs given → Gala, as before
    assert.match(legacy, /Gala Evening/);
});

// A tiny in-memory `query` — enough for resolveTicket to walk host → gala → guest.
function fakeQuery(rows) {
    return {
        get(sql, params) {
            const id = params && params[0];
            if (/FROM ca_registration_guests/.test(sql)) return rows.guests.find(g => g.id === id) || null;
            if (/FROM croatians_abroad_registrations WHERE id/.test(sql)) return rows.cas.find(c => c.id === id) || null;
            if (/FROM croatians_abroad_registrations WHERE gala_registration_id/.test(sql)) return rows.cas.find(c => c.gala_registration_id === id) || null;
            if (/FROM gala_registrations/.test(sql)) return rows.galas.find(g => g.id === id) || null;
            return null;
        },
        all() { return []; }
    };
}
const HEX = '0123456789abcdef0123456789abcdef';
const GID = 'aaaaaaaa-1111-4222-8333-444444444444', CAID = 'bbbbbbbb-1111-4222-8333-444444444444', GALAID = 'cccccccc-1111-4222-8333-444444444444';

test('guest pass: a Conference-only guest gets a free-events card on the host QR; no Gala, no invoice', () => {
    const q = fakeQuery({
        guests: [{ id: GID, registration_id: CAID, name: 'Ana Horvat', email: 'ana@x.hr', conference: 1, bridges: 0, gala: 0 }],
        cas: [{ id: CAID, first_name: 'Ivan', last_name: 'Ivić', email: 'i@x.hr', selected_conference: 1, conference_status: 'pre-registered', selected_bridges: 1, bridges_status: 'pre-registered', selected_gala: 1, gala_registration_id: GALAID, guest_count: 0 }],
        galas: [{ id: GALAID, status: 'confirmed', payment_status: 'paid', guest_count: 0, first_name: 'Ivan', last_name: 'Ivić', invoice_number: 'GALA26-0099' }]
    });
    const t = pass.resolveTicket ? pass.resolveTicket(q, 'guest', GID) : pass._resolveTicket(q, 'guest', GID);
    assert.ok(t, 'a free-only guest is a ticket');
    assert.deepEqual(t.legs, ['conference']);
    assert.equal(t.gala, false); assert.equal(t.invoice, null); assert.equal(t.party, 1);
    assert.equal(t.guestOf, 'Ivan Ivić');
    assert.match(t.serial, /^medx-t-caguest-/);
    assert.match(t.qr, /"caRegId":"bbbbbbbb-1111-4222-8333-444444444444"/, 'the host CA QR — the same one the Conference door already scans');
});

test('guest pass: a Gala guest keeps the Gala card, plus the free legs they ticked; a guest with no live leg is not a ticket', () => {
    const rows = {
        guests: [{ id: GID, registration_id: CAID, name: 'Marko', email: 'm@x.hr', conference: 1, bridges: 0, gala: 1 }],
        cas: [{ id: CAID, first_name: 'Ivan', last_name: 'Ivić', selected_conference: 1, conference_status: 'pre-registered', selected_bridges: 0, selected_gala: 1, gala_registration_id: GALAID, guest_count: 1 }],
        galas: [{ id: GALAID, status: 'confirmed', payment_status: 'paid', guest_count: 1, first_name: 'Ivan', last_name: 'Ivić', invoice_number: 'GALA26-0099' }]
    };
    const resolve = pass.resolveTicket || pass._resolveTicket;
    const t = resolve(fakeQuery(rows), 'guest', GID);
    assert.deepEqual(t.legs, ['conference', 'gala']);
    assert.equal(t.party, 2); assert.equal(t.invoice, 'GALA26-0099'); assert.match(t.serial, /^medx-t-galaguest-/);
    rows.galas[0].payment_status = 'pending';                       // Gala not paid yet → only the Conference leg stands
    const t2 = resolve(fakeQuery(rows), 'guest', GID);
    assert.deepEqual(t2.legs, ['conference']); assert.equal(t2.gala, false);
    rows.guests[0].conference = 0;                                  // nothing live left
    assert.equal(resolve(fakeQuery(rows), 'guest', GID), null);
});

test('source contract — the register route persists guests for EVERY path and derives guest_count from the flags', () => {
    const i = userSrc.indexOf("const caGuests = caNormalizeGuests(req.body.guests");
    assert.ok(i > 0, 'guests are normalised server-side');
    const persist = userSrc.indexOf('persistGuests();', i);
    const held = userSrc.indexOf('// ---------- HELD: review gate — stop here', i);
    assert.ok(persist > 0 && persist < held, 'guests are written before the held / free / paid branching');
    assert.match(userSrc.slice(i, held), /caGuestsMod\.galaGuestCount\(caGuests\)/, 'guest_count = Gala-ticked guests');
    assert.doesNotMatch(userSrc.slice(i, held), /parseInt\(req\.body\.guest_count/, 'the client guest_count is never trusted');
    assert.match(userSrc.slice(i, held + 2000), /'Guests': heldGuests, 'Gala seats billed'/, 'the review email lists guests + events and the seats billed');
    assert.match(userSrc, /INSERT INTO ca_registration_guests \(id, registration_id, name, institution, email, conference, bridges, gala\)/);
});

test('source contract — the confirmation email lists guests and sends free-leg guests their own copy', () => {
    assert.match(userSrc, /guestsHtml: plexusTicket\.guestsHtml\(caGuestRows\(regId\)\)/);
    assert.match(userSrc, /await caSendGuestFreeCopies\(\{ regId, hostFirst: first_name, hostLast: last_name, regSource \}\)/);
    assert.match(userSrc, /plexusPass\.walletLinks\('guest', g\.id\)/, 'guest copies carry their own wallet passes');
    assert.match(userSrc, /guests_conference: gs\.filter/, 'the Sheet mirror counts guests per event');
});

test('source contract — both forms send per-guest event flags and only Gala-ticked guests count as seats', () => {
    for (const [tickFn, galaFn] of [['plexGuestTick(g, \'conference\')', 'plexGalaGuests()'], ["caGuestTick(g, 'conference')", 'caGalaGuests()']]) {
        assert.ok(userSrc.includes(tickFn), tickFn + ' on the form');
        assert.ok(userSrc.includes(galaFn), galaFn + ' drives the total');
    }
    assert.match(userSrc, /guest_count: sel\.gala \? plexGalaGuests\(\) : 0/);
    assert.match(userSrc, /guest_count: caGalaGuests\(\)/);
});

test('source contract — the admin doors show guests for THAT door and count people, not bookings', () => {
    assert.match(adminSrc, /guests: caGuestsForDoor\(caReg\.id, event\)/, 'Conference / Bridges verify reports guests on this leg');
    assert.doesNotMatch(adminSrc, /answers: appliedInfo\(caReg\)\.answers,\s*guests: caReg\.guest_count/, 'the Gala seat count no longer leaks to the free doors');
    assert.match(adminSrc, /const croatiansAbroadConference = caDoor\('selected_conference', 'conference_checked_in', 'conference'\)/);
    assert.match(adminSrc, /const bridges = caDoor\('selected_bridges', 'bridges_checked_in', 'bridges'\)/);
    for (const src of [userSrc, adminSrc]) {
        assert.match(src, /ALTER TABLE ca_registration_guests ADD COLUMN \$\{col\} INTEGER DEFAULT 0/, 'the flags are declared in both portals');
    }
    assert.match(userSrc, /ca_guest_events_backfill_v1/, 'the one-off backfill is marker-guarded');
    assert.doesNotMatch(adminSrc, /ca_guest_events_backfill_v1/, 'only the user portal runs the backfill');
});
