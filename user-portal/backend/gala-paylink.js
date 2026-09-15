/**
 * gala-paylink.js — the Gala leg of a review-held Zagreb registration.
 *
 * THE GAP THIS CLOSES (found 2026-09-15, two live victims).
 * The Zagreb form (POST /api/croatians-abroad/register, source='plexus') hands a suspicious
 * registration to the review gate INSTEAD of Stripe: every selected leg is written at
 * 'pending-review' and no checkout session is ever created. When the registration is later
 * released — the owner clicking Approve in the review email, or the registrant proving an
 * institutional inbox, both of which run the SAME approve(id) handler — the free legs were
 * replayed and confirmed, but the Gala leg simply stayed at gala_status='awaiting_payment'
 * with gala_registrations.status='awaiting_payment' and pay_token NULL. No link was ever
 * minted, so no email could carry one. Ana Franceschi and Magdalena Zebrowska sat in that
 * state for days.
 *
 * Three entry points, one per moment:
 *   sendGalaPayLink()      at APPROVE. Ensures the gala row exists, flips it to 'approved',
 *                          mints pay_token, and sends ONE "approved — one step left" email.
 *                          When the gala leg is unpaid this is the ONLY email approval sends:
 *                          the free-events confirmation (and its QR) is deliberately NOT
 *                          replayed, because the combined ticket after payment is the one
 *                          ticket that covers everything, and nobody may end up holding two
 *                          QRs for the same registration. galaLegNeedsPayment() is the
 *                          predicate server.js gates that suppression on.
 *   fulfilLinkedCaGala()   at PAYMENT. /pay/gala mints its Stripe session with
 *                          metadata.type 'gala-ticket' (NOT 'croatians-abroad-gala'), so the
 *                          webhook's standalone-Gala branch used to answer a Plexus
 *                          multi-event guest with a bare receipt: no QR, no conference or
 *                          bridges lines, and the CA row left at 'awaiting_payment' forever.
 *                          This issues the ONE combined party ticket instead.
 *   sendUnpaidGalaNudge()  LATER, by hand. The owner-triggered reminder for a seat that is
 *                          approved and still unpaid. Never scheduled.
 *   notifyInvoiceNeeded()  at PAYMENT, from BOTH webhook branches (Path B 'croatians-abroad-gala'
 *                          and the pay-link 'gala-ticket' route through fulfilLinkedCaGala).
 *                          A registrant who ticked "I need an official invoice made out to my
 *                          company or institution" on the Zagreb form gets the finance lead
 *                          (vp@medx.hr) told ONCE — name, amount, payment ref, and the billing
 *                          details (company, address, country, VAT) collected on the form —
 *                          so the invoice can be issued via FIRA with no back-and-forth.
 *                          Nothing is generated here and the registrant is not written to.
 *
 * SEATS. guest_count is ADDITIONAL guests, never the party total — the register route caps it
 * as "+guests, max 2", Path B charges effectiveGalaPrice() * (1 + guests), both FIRA blocks
 * bill quantity 1 + guest_count, admin-portal v2/gala-ops seatsOf() and all four partyOf()
 * sites in the admin door list read 1 + guest_count, and Ana Franceschi's guest_count of 1
 * carries exactly one named row in ca_registration_guests. Party size is 1 + guest_count
 * everywhere in this file, and the registrant pays for the whole party.
 *
 * Deliberately a separate file. The logic is then hermetically testable
 * (tests/ca-approve-paylink.test.js drives it against a scratch sqlite carrying the real
 * schema) instead of being buried in a 30,000-line route file, and server.js keeps a small
 * wiring diff at each site. Every collaborator is INJECTED — this module opens no database,
 * sends no mail and reads no env of its own beyond the public base URL.
 *
 * Deps contract:
 *   { query, db, saveDb, flushDb, sendEmail, effectiveGalaPrice, log? }
 *   fulfilLinkedCaGala also: buildTicketQrBlock(), qrPngAttachment() (buildEmailTemplate is
 *   accepted for compatibility but no longer used — every email here is on the house shell)
 */
'use strict';

const crypto = require('crypto');
const reviewGate = require('./review-gate');
const tpl = require('./v2/email-templates');   // house shell — the finance note wears the same dark shell as the gate's emails

// One outgoing email of each kind per registration, ever. The markers live in the row's own
// notes — the same restart-safe channel the review gate uses for VERIFY-REQUESTED /
// VERIFY-SENT — so a second Approve click, a re-delivered institutional confirmation, a
// repeated nudge sweep and a redeploy mid-flight all read the same truth.
const PAYLINK_MARKER = 'GALA-PAYLINK-SENT';
const NUDGE_MARKER = 'GALA-NUDGE-SENT';
const INVOICE_MARKER = 'INVOICE-MIRO-NOTIFIED';

// Who is told when a paid registrant asked for an official invoice. Invoices are issued only
// via FIRA, by a person — this module never generates one.
const FINANCE_TO = process.env.FINANCE_EMAIL || 'vp@medx.hr';

// Matches every other pay_token in the codebase (admin server.js gala approve + pay-link,
// v2/gala-ops add-guest + waitlist accept): 24 random bytes rendered as 48 hex chars.
// /pay/gala/:token requires >= 16 chars before it will even look in the database.
const mintPayToken = () => crypto.randomBytes(24).toString('hex');

const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const publicBase = () => String(process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com')
    .replace(/\/+$/, '');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// '€150' for a round price, '€150.50' when the admin sets cents.
function fmtEur(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return '€' + (Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2));
}

// '2026-12-05' -> '5 December 2026' (same shape as server.js fmtEventDate).
function fmtDate(d) {
    if (!d) return '';
    try {
        const dt = new Date(String(d) + 'T00:00:00Z');
        if (isNaN(dt.getTime())) return String(d);
        return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    } catch (e) { return String(d); }
}
// '2026-09-15' -> '15 September' (the deadline reads as a date this season, not a year away).
function fmtDayMonth(d) {
    if (!d) return '';
    try {
        const dt = new Date(String(d) + 'T00:00:00Z');
        if (isNaN(dt.getTime())) return String(d);
        return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    } catch (e) { return String(d); }
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysSince = iso => {
    const t = Date.parse(String(iso || '').replace(' ', 'T') + (String(iso || '').includes('T') ? '' : 'Z'));
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
};

// ---------------------------------------------------------------- seats + price
// Party size. guest_count is ADDITIONAL guests (see the header) — 1 + guest_count is the
// number of seats, and the main registrant pays for all of them.
const partySeats = row => 1 + Math.max(0, parseInt(row && row.guest_count, 10) || 0);

/**
 * What this row's payment link should charge, and how to put it on a Stripe line item.
 *
 * A stamped invoice_number together with a positive amount_paid is written by exactly ONE
 * thing — /pay/gala/:token, at the moment it sent this person to a Stripe checkout for that
 * exact amount. That is a quote already shown to a human, so it is honoured rather than
 * recomputed: Masakazu Toi is holding a link quoted at €150 before seats were billed as a
 * party, and doubling it under him is the one thing this change must not do. He is the only
 * such row in production; every other unpaid row has both columns NULL and gets party pricing
 * on its first visit. (The alternative — charge every held row the full party price
 * immediately — would re-quote him from €150 to €300 without warning. Whether he is asked for
 * the second seat is a conversation, not a silent repricing.)
 */
function quoteGalaSeats(effectiveGalaPrice, galaRow) {
    const seats = partySeats(galaRow);
    const seatPrice = round2(typeof effectiveGalaPrice === 'function' ? effectiveGalaPrice() : 0);
    const quoted = Number(galaRow && galaRow.amount_paid);
    if (galaRow && galaRow.invoice_number && Number.isFinite(quoted) && quoted > 0) {
        return {
            seats, seatPrice, total: round2(quoted), honoured: true,
            lineName: 'Plexus 2026 — Gala Evening',
            lineQuantity: 1,
            lineUnitAmount: Math.round(round2(quoted) * 100)
        };
    }
    return {
        seats, seatPrice, total: round2(seats * seatPrice), honoured: false,
        lineName: 'Plexus 2026 — Gala Evening' + (seats > 1 ? ` — ${seats} seats` : ''),
        lineQuantity: seats,
        lineUnitAmount: Math.round(seatPrice * 100)
    };
}

// "2 seats · €300 (€150 per seat, early-bird until 15 September)" — the owner's line.
// One seat drops the redundant per-seat figure; an honoured quote states only the amount the
// link will actually charge, because its per-seat arithmetic no longer holds.
function seatsLine(quote, earlyBirdDeadline) {
    const seatsWord = `${quote.seats} seat${quote.seats === 1 ? '' : 's'}`;
    if (quote.honoured) return `${seatsWord} · ${fmtEur(quote.total)}`;
    const early = earlyBirdDeadline && String(earlyBirdDeadline) >= todayIso()
        ? `early-bird until ${fmtDayMonth(earlyBirdDeadline)}` : '';
    const inner = [quote.seats > 1 ? `${fmtEur(quote.seatPrice)} per seat` : '', early].filter(Boolean).join(', ');
    return `${seatsWord} · ${fmtEur(quote.total)}${inner ? ` (${inner})` : ''}`;
}

// "the Conference, Building Bridges Zagreb and the Gala Evening" — the owner's names for the
// three legs, in the order the form offers them.
function selectionPhrase({ wantConference, wantBridges, wantGala }) {
    const parts = [
        wantConference ? 'the Conference' : null,
        wantBridges ? 'Building Bridges Zagreb' : null,
        wantGala ? 'the Gala Evening' : null
    ].filter(Boolean);
    if (parts.length <= 1) return parts[0] || 'Plexus Week 2026';
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

// ---------------------------------------------------------------- the approval email
// House dark shell, registrant voice, the owner's wording. Built pure so the test can assert
// every claim in it (seats, total, per-seat price, deadline, token, one-ticket promise)
// without a database or a mail provider.
function buildPayLinkEmail({ firstName, payUrl, quote, earlyBirdDeadline, galaDate, galaVenue,
                             wantConference, wantBridges }) {
    const facts = [];
    const when = [fmtDate(galaDate), galaVenue].filter(Boolean).join(' · ');
    if (when) facts.push(['Gala Evening', when]);
    facts.push(['Gala reservation', seatsLine(quote, earlyBirdDeadline)]);

    const selected = selectionPhrase({ wantConference, wantBridges, wantGala: true });

    return reviewGate.emailShell('Your registration is approved',
        `<p style="margin:0 0 10px;">Dear ${esc(firstName || 'guest')},</p>
         <p style="margin:0 0 10px;">Great news — your registration for <b class="em-ink">Plexus Week 2026</b> is approved: ${esc(selected)}.</p>
         <p style="margin:0;">To complete your registration for everything, please finish the last step — the payment for the Gala Evening:</p>`,
        'Complete my registration', payUrl,
        {
            eyebrow: 'Registration approved',
            preheader: 'Your registration is approved — one step left to complete it.',
            facts,
            footNote: 'As soon as the payment is done you will receive <b class="em-ink">one ticket</b> that covers all your events.'
        });
}

// ---------------------------------------------------------------- the nudge email
// Gentle, owner-triggered, and it offers the way out: pay, or take the free events alone.
function buildNudgeEmail({ firstName, payUrl, quote, earlyBirdDeadline, galaDate, galaVenue,
                           wantConference, wantBridges, daysWaiting }) {
    const facts = [];
    const when = [fmtDate(galaDate), galaVenue].filter(Boolean).join(' · ');
    if (when) facts.push(['Gala Evening', when]);
    facts.push(['Gala reservation', seatsLine(quote, earlyBirdDeadline)]);

    // No leading article here — this list sits after "your", where "your the Conference" reads wrong.
    const freeLegs = [
        wantConference ? 'Conference' : null,
        wantBridges ? 'Building Bridges Zagreb' : null
    ].filter(Boolean);
    const fallback = freeLegs.length
        ? `If your plans have changed, just reply to this email and we will send your ${esc(freeLegs.join(' and '))} ticket on its own — no Gala seat, nothing to pay.`
        : 'If your plans have changed, just reply to this email and we will release the seat — nothing to pay.';

    return reviewGate.emailShell('Your Gala seat is still waiting',
        `<p style="margin:0 0 10px;">Dear ${esc(firstName || 'guest')},</p>
         <p style="margin:0 0 10px;">Your place at Plexus Week 2026 is approved and your Gala seat is being held for you — the payment is the one thing still outstanding.</p>
         <p style="margin:0;">You can complete it here whenever suits you:</p>`,
        'Complete my Gala reservation', payUrl,
        {
            eyebrow: 'A gentle reminder',
            preheader: 'Your Gala seat is still held — the payment is the last step.',
            facts,
            footNote: fallback
        });
}

// ---------------------------------------------------------------- the finance note (to Miro)
// Internal, on the dark house shell like the gate's own FYI to the organizer. Built pure so the
// test can assert every fact in it. No button: the ask is a conversation with the registrant.
function buildInvoiceNeededEmail({ name, email, institution, country, seats, amount, paymentRef, registrationId, billing }) {
    const T = tpl.T;
    const DT = { ink: '#f2e7d6', soft: '#d3c5b2', gold: '#d7b56c', hair: 'rgba(240,228,210,.18)',
                 factBg: '#342718', factBorder: 'rgba(240,228,210,.16)' };
    // billing = {company, address, country, vat} straight from the form. Older rows ticked the
    // box before the form asked for these — for them the email falls back to asking Miro to
    // collect the details himself.
    const b = billing && billing.company ? billing : null;
    const facts = [
        ['Name', name || '—'],
        ['Email', email || '—'],
        ['Institution', institution || '(not given)'],
        !b && country ? ['Country', country] : null,
        ...(b ? [
            ['Invoice to', b.company],
            ['Billing address', b.address || '—'],
            ['Billing country', b.country || '—'],
            ['VAT / tax number', b.vat || 'not provided']
        ] : []),
        ['Gala seats', String(seats || 1)],
        ['Amount paid', fmtEur(amount) || '—'],
        ['Payment ref', paymentRef || '—'],
        registrationId ? ['Registration', String(registrationId).slice(0, 8).toUpperCase()] : null
    ].filter(Boolean);
    const factsHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-fact" style="margin-top:16px;background:${DT.factBg};border:1px solid ${DT.factBorder};"><tr><td style="padding:4px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${facts.map(([label, value], i) => {
            const sep = i ? `border-top:1px solid ${DT.hair};` : '';
            return `<tr>
              <td class="em-goldlab em-hair" style="${sep}padding:9px 14px 9px 0;font-family:${T.sans};font-weight:600;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:${DT.gold};vertical-align:middle;white-space:nowrap;">${esc(label)}</td>
              <td class="em-ink em-hair" style="${sep}padding:9px 0;font-family:${T.sans};font-size:12.5px;line-height:1.45;color:${DT.ink};word-break:break-word;">${esc(value)}</td>
            </tr>`;
        }).join('')}
        </table>
      </td></tr></table>`;
    const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 40px 30px;">
      <div class="em-goldlab" style="font-family:${T.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${DT.gold};">Finance &middot; Gala Evening</div>
      <div class="em-ink" style="font-family:${T.serif};font-weight:500;font-size:26px;line-height:1.2;color:${DT.ink};margin-top:10px;">Official invoice needed</div>
      <div class="em-soft" style="font-family:${T.sans};font-size:14px;line-height:1.7;color:${DT.soft};margin-top:14px;"><b class="em-ink" style="color:${DT.ink};">${esc(name || 'A registrant')}</b> ticked &ldquo;I need an official invoice made out to my company or institution&rdquo; when registering for Plexus Week 2026, and has now paid for the Gala Evening. ${b
        ? 'The billing details they gave on the form are below — please issue the invoice via FIRA.'
        : 'Please reach out to them for the billing details (legal name, address, OIB / VAT ID) and issue the invoice via FIRA.'}</div>${factsHtml}
      <div class="em-soft" style="font-family:${T.sans};font-size:12px;line-height:1.65;color:${DT.soft};margin-top:14px;">The registrant has not been written to about this${b ? '' : ' — the conversation is yours to open'}.</div>
    </td></tr></table>`;
    return tpl.shell({
        tone: 'dark',
        title: 'Official invoice needed — Med&X',
        preheader: `${name || 'A registrant'} paid for the Gala and needs a company/institution invoice.`,
        headerRightLabel: 'FINANCE',
        rule: 'gold',
        bodyHtml: body,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Sent only to the finance lead']
    });
}

// ---------------------------------------------------------------- the party line on the ticket
/**
 * What the combined ticket says about the party, under the QR.
 *
 * ONE QR admits everyone, so the only thing the registrant has to know is whether their
 * guests already hold a copy. Guests who gave an email get their own copy automatically
 * (below); anyone who did not is reachable only through the registrant, so the ticket asks
 * them to forward it. A party of one says nothing at all — there is nobody to admit but them.
 *
 * `guestsWithEmail` counts named ca_registration_guests rows carrying an address. A guest
 * nobody named at all (guest_count of 1, no guest row) is, correctly, a guest with no email.
 */
function partyNote(seats, guestsWithEmail) {
    const guests = Math.max(0, seats - 1);
    if (!guests) return '';
    const missing = Math.max(0, guests - Math.max(0, guestsWithEmail || 0));
    const tail = missing === 0
        ? `Your guest${guests === 1 ? ' has' : 's have'} received the same QR by email.`
        : `Please share this email with your guest${missing === 1 ? '' : 's'} who did not give us an email address — the same QR admits them.`;
    return `This QR admits your whole party of ${seats}. ${tail}`;
}

// ---------------------------------------------------------------- shared row resolution
function galaRowFor(query, caRow) {
    if (!caRow || !caRow.gala_registration_id) return null;
    return query.get('SELECT * FROM gala_registrations WHERE id = ?', [caRow.gala_registration_id]);
}
const isPaid = g => !!g && (g.payment_status === 'paid' || g.status === 'confirmed');

/**
 * Does this registration still owe money on its Gala leg?
 *
 * server.js gates the Path-A suppression on this: when it answers true, approval sends ONLY
 * the payment email, because the combined ticket that follows payment is the one ticket that
 * covers everything and a free-events QR now would be a second, conflicting ticket. False —
 * no Gala, or a seat already paid — leaves the free-events confirmation exactly as it was.
 */
function galaLegNeedsPayment(query, caRow) {
    if (!caRow || !Number(caRow.selected_gala)) return false;
    const gala = galaRowFor(query, caRow);
    if (!gala) return true;                       // no row yet — sendGalaPayLink will create one
    return !isPaid(gala);
}

function settingsOf(query) {
    try { return query.get("SELECT date, venue, early_bird_deadline FROM gala_settings WHERE id = 'default'") || {}; }
    catch (e) { return {}; }
}

// ---------------------------------------------------------------- APPROVE: mint + send
/**
 * Release the Gala leg of a review-held Zagreb registration.
 *
 * Reads the CA row LIVE, so when the institutional-confirmation path has already re-pointed
 * the row at the verified inbox (review-gate.js calls h.setEmail BEFORE h.approve), the
 * email follows to that address by construction.
 *
 * opts.preview — build the email from this row but send it to opts.to with a "[PREVIEW] "
 *                subject and mutate NOTHING: no token minted, no status moved, no marker
 *                stamped. Used to show the owner the email before anyone real gets it.
 *
 * @returns {Promise<{status:'done'|'already'|'no-gala'|'already-paid'|'notfound'|'preview'|'no-email'|'send-failed', ...}>}
 */
async function sendGalaPayLink(deps, caId, opts = {}) {
    const { query, db, saveDb, flushDb, sendEmail, effectiveGalaPrice } = deps;
    const log = deps.log || ((...a) => console.log('[GalaPayLink]', ...a));
    const preview = !!opts.preview;

    const row = query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [caId]);
    if (!row) return { status: 'notfound' };
    if (!Number(row.selected_gala)) return { status: 'no-gala' };

    const to = preview ? String(opts.to || '').trim() : String(row.email || '').trim();
    if (!to) return { status: 'no-email' };

    // The gala row is normally created by the register route; ensure it for a row that lost
    // it (an older held registration, a partial write) so the link always has a target.
    let gala = galaRowFor(query, row);
    if (!gala && !preview) {
        const newId = crypto.randomUUID();
        db.run(
            `INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, dietary, requests, guest_count, user_id)
             VALUES (?, ?, ?, ?, ?, 'approved', 'pending', ?, ?, ?, ?)`,
            [newId, row.first_name, row.last_name || '', row.email, row.institution || '',
             row.dietary || null, row.notes || null, Math.max(0, parseInt(row.guest_count, 10) || 0), row.user_id || null]);
        db.run('UPDATE croatians_abroad_registrations SET gala_registration_id = ? WHERE id = ?', [newId, caId]);
        gala = query.get('SELECT * FROM gala_registrations WHERE id = ?', [newId]);
        log(`gala row was missing for CA ${caId} — created ${newId}`);
    }

    // Paid already (a manual fix, a replayed webhook): there is nothing to complete, and a
    // "please pay" email to somebody who has paid is the one mistake worth guarding hardest.
    if (gala && !preview && isPaid(gala)) {
        return { status: 'already-paid', gala_registration_id: gala.id };
    }
    if (!preview && reviewGate.getMarker(row.notes, PAYLINK_MARKER)) {
        return { status: 'already', gala_registration_id: gala && gala.id, email: to };
    }

    const settings = settingsOf(query);
    const quote = quoteGalaSeats(effectiveGalaPrice, gala || row);

    let token;
    if (preview) {
        // A preview never mints a live payment link for a guest who has not been released.
        // An existing token is reused; otherwise the button carries a sample that lands on
        // the friendly "invalid link" page.
        token = (gala && gala.pay_token) || 'sample' + crypto.randomBytes(21).toString('hex');
    } else {
        token = gala.pay_token || mintPayToken();
        // status='approved' is what /pay/gala/:token demands before it will mint a Stripe
        // session, and what the admin Gala list reads to show "Awaiting payment" with its
        // Pay-link action. Both were unreachable while the row said 'awaiting_payment'.
        db.run('UPDATE gala_registrations SET status = ?, pay_token = ? WHERE id = ?', ['approved', token, gala.id]);
        // Committed BEFORE the send: if the provider then rejects the email, the seat is still
        // approved and the token still resolves, so the admin's Pay-link button works and the
        // retry re-sends the SAME link rather than minting a second one.
        try { saveDb && saveDb(); } catch (e) {}
        try { flushDb && flushDb(); } catch (e) {}
    }

    const html = buildPayLinkEmail({
        firstName: row.first_name,
        payUrl: `${publicBase()}/pay/gala/${token}`,
        quote,
        earlyBirdDeadline: settings.early_bird_deadline,
        galaDate: settings.date,
        galaVenue: settings.venue,
        wantConference: !!Number(row.selected_conference),
        wantBridges: !!Number(row.selected_bridges)
    });
    const subject = (preview ? '[PREVIEW] ' : '') + 'Your registration is approved — one step left';

    const sent = await sendEmail(to, subject, html);
    if (sent && (sent.success === false || sent.mock)) {
        // Loud, and NOT stamped: an unsent link must stay re-sendable.
        log(`[EMAIL-FAIL] approval + pay link for CA ${caId} did not reach ${to}:`,
            sent.mock ? 'mock mode (no provider configured)' : (sent.error || 'unknown'));
        if (!preview) return { status: 'send-failed', gala_registration_id: gala.id, token, email: to };
    }

    if (preview) return { status: 'preview', email: to, token, quote, subject };

    db.run('UPDATE croatians_abroad_registrations SET notes = ? WHERE id = ?',
        [reviewGate.upsertMarker(row.notes, PAYLINK_MARKER, todayIso()), caId]);
    try { saveDb && saveDb(); } catch (e) {}
    try { flushDb && flushDb(); } catch (e) {}
    log(`approval + pay link sent for CA ${caId} -> ${to} (gala ${gala.id}, ${quote.seats} seat(s), ${fmtEur(quote.total)})`);
    return { status: 'done', gala_registration_id: gala.id, token, email: to, quote, subject };
}

// ---------------------------------------------------------------- NUDGE (owner-triggered)
/**
 * Every approved-but-unpaid Gala seat on a Zagreb registration that has been waiting longer
 * than `days`. Scoped to CA-linked rows on purpose: the copy offers to fall back to the free
 * events, which only exists on this flow, and standalone gala guests already have the admin
 * Gala list's own Pay-link and reminder machinery.
 *
 * The clock runs from when the person was actually asked to pay (the GALA-PAYLINK-SENT
 * marker) and falls back to the gala row's creation date.
 */
function listUnpaidGalaNudges(deps, { days = 7 } = {}) {
    const { query } = deps;
    const minDays = Math.max(0, parseInt(days, 10) || 0);
    let rows = [];
    try {
        rows = query.all(
            `SELECT c.id AS ca_id, c.first_name, c.last_name, c.email, c.notes,
                    c.selected_conference, c.selected_bridges,
                    g.id AS gala_id, g.status, g.payment_status, g.pay_token, g.guest_count,
                    g.amount_paid, g.invoice_number, g.created_at, g.requests, g.admin_notes
               FROM croatians_abroad_registrations c
               JOIN gala_registrations g ON g.id = c.gala_registration_id
              WHERE c.selected_gala = 1
                AND g.status = 'approved'
                AND COALESCE(g.payment_status, '') <> 'paid'
              ORDER BY g.created_at ASC`) || [];
    } catch (e) { return []; }

    return rows.map(r => {
        const asked = reviewGate.getMarker(r.notes, PAYLINK_MARKER);
        const since = asked || r.created_at;
        const waited = daysSince(since);
        const quote = quoteGalaSeats(deps.effectiveGalaPrice, r);
        return {
            ca_id: r.ca_id, gala_id: r.gala_id,
            name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
            email: r.email,
            seats: quote.seats, amount_due: quote.total, quote_honoured: quote.honoured,
            waiting_since: since, days_waiting: waited,
            has_pay_link: !!r.pay_token,
            already_nudged: !!reviewGate.getMarker(r.notes, NUDGE_MARKER),
            is_test: /TEST/i.test(`${r.requests || ''} ${r.admin_notes || ''}`)
        };
    }).filter(r => !r.is_test && (r.days_waiting == null || r.days_waiting >= minDays));
}

/** Send one gentle reminder. Idempotent through the GALA-NUDGE-SENT marker. */
async function sendUnpaidGalaNudge(deps, caId) {
    const { query, db, saveDb, flushDb, sendEmail, effectiveGalaPrice } = deps;
    const log = deps.log || ((...a) => console.log('[GalaPayLink]', ...a));

    const row = query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [caId]);
    if (!row) return { status: 'notfound' };
    if (!Number(row.selected_gala)) return { status: 'no-gala' };
    const gala = galaRowFor(query, row);
    if (!gala) return { status: 'no-gala-row' };
    if (isPaid(gala)) return { status: 'already-paid' };
    if (!gala.pay_token) return { status: 'no-pay-link' };       // send the approval email first
    if (reviewGate.getMarker(row.notes, NUDGE_MARKER)) return { status: 'already' };
    const to = String(row.email || '').trim();
    if (!to) return { status: 'no-email' };

    const settings = settingsOf(query);
    const quote = quoteGalaSeats(effectiveGalaPrice, gala);
    const asked = reviewGate.getMarker(row.notes, PAYLINK_MARKER) || gala.created_at;

    const html = buildNudgeEmail({
        firstName: row.first_name,
        payUrl: `${publicBase()}/pay/gala/${gala.pay_token}`,
        quote,
        earlyBirdDeadline: settings.early_bird_deadline,
        galaDate: settings.date,
        galaVenue: settings.venue,
        wantConference: !!Number(row.selected_conference),
        wantBridges: !!Number(row.selected_bridges),
        daysWaiting: daysSince(asked)
    });

    const sent = await sendEmail(to, 'Your Gala seat is still waiting — Plexus 2026', html);
    if (sent && (sent.success === false || sent.mock)) {
        log(`[EMAIL-FAIL] nudge for CA ${caId} did not reach ${to}:`,
            sent.mock ? 'mock mode (no provider configured)' : (sent.error || 'unknown'));
        return { status: 'send-failed', email: to };
    }
    db.run('UPDATE croatians_abroad_registrations SET notes = ? WHERE id = ?',
        [reviewGate.upsertMarker(row.notes, NUDGE_MARKER, todayIso()), caId]);
    try { saveDb && saveDb(); } catch (e) {}
    try { flushDb && flushDb(); } catch (e) {}
    log(`nudge sent for CA ${caId} -> ${to} (${quote.seats} seat(s), ${fmtEur(quote.total)})`);
    return { status: 'done', email: to, seats: quote.seats, amount_due: quote.total };
}

// ---------------------------------------------------------------- the combined party ticket (dark shell)
// Ana Franceschi's ticket arrived on the OLD navy template (logo invisible, green pill) while
// every gate/approval email had long been on the dark house shell — and with the OLD wording:
// commit 90705c7 renamed the Path B webhook copy to "Plexus Week 2026" but never touched THIS
// module's fulfilLinkedCaGala, which is the branch every pay-link payer actually goes through.
// Both problems end here: one pure builder, house shell, "Plexus Week 2026" throughout, used by
// fulfilLinkedCaGala AND the Path B webhook so the two can never drift again.
const DTK = { ink: '#f2e7d6', soft: '#d3c5b2', gold: '#d7b56c', green: '#8fce9f',
              hair: 'rgba(240,228,210,.18)', cardBg: '#342718', cardBorder: 'rgba(215,181,108,.42)' };

// The three-event reservations list, restyled for the espresso shell (substance unchanged).
function buildReservationsHtml({ wantConf, wantBridges, seats }) {
    const T = tpl.T;
    const seatsLabel = seats > 1 ? `CONFIRMED &amp; PAID &middot; ${seats} SEATS` : 'CONFIRMED &amp; PAID';
    const row = (name, status, meta, last) => `<tr><td style="padding:12px 16px;${last ? '' : `border-bottom:1px solid ${DTK.hair};`}">
        <span style="font-family:${T.sans};font-weight:600;font-size:13.5px;color:${DTK.ink};">${name}</span>
        <span style="font-family:${T.sans};font-weight:700;font-size:10px;letter-spacing:.12em;color:${DTK.green};margin-left:8px;">${status}</span>
        <div style="font-family:${T.sans};font-size:11.5px;color:${DTK.soft};margin-top:3px;">${meta}</div></td></tr>`;
    const rows = [
        wantConf ? row('Plexus Conference', 'PRE-REGISTERED (INCLUDED)', '4 December 2026 &middot; Zagreb &middot; program to follow') : '',
        wantBridges ? row('Croatian Biomedical Bridges', 'PRE-REGISTERED (INCLUDED)', '4 or 5 December 2026 &middot; Zagreb &middot; date and venue to be confirmed') : '',
        row('Plexus Gala Evening', seatsLabel, '5 December 2026 &middot; Hotel Esplanade Zagreb &middot; arrival from 7:00 PM', true)
    ].filter(Boolean).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:${DTK.cardBg};border:1px solid ${DTK.cardBorder};">
        <tr><td style="padding:10px 16px;border-bottom:1px solid ${DTK.hair};font-family:${T.sans};font-weight:600;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:${DTK.gold};">Your Plexus Week 2026 reservations</td></tr>
        ${rows}
    </table>`;
}

/**
 * The ONE ticket email a paid Zagreb registration receives — house dark shell, logo visible,
 * "Plexus Week 2026" in the subject (callers), the reservations header and the QR label.
 * Pure: the QR card html and every fact are injected, so tests assert it without a database.
 */
function buildCombinedTicketEmail({ firstName, amount, seats, invoiceNumber, wantConf, wantBridges, qrBlockHtml, partyNoteText, source, walletHtml }) {
    const T = tpl.T;
    const paid = Number(amount) || 0;
    const partyHtml = partyNoteText
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:${DTK.cardBg};border-left:3px solid ${DTK.gold};"><tr>
             <td style="padding:12px 16px;font-family:${T.sans};font-size:13px;line-height:1.6;color:${DTK.ink};">${esc(partyNoteText)}</td></tr></table>`
        : '';
    const programNote = (wantConf || wantBridges)
        ? `<p style="margin:16px 0 0;">We will email you ${[wantConf ? 'the <b class="em-ink">Conference program</b>' : null, wantBridges ? 'the <b class="em-ink">Croatian Biomedical Bridges date and venue</b>' : null].filter(Boolean).join(' and ')} as soon as ${(wantConf && wantBridges) ? 'they are' : 'it is'} finalized.</p>`
        : '';
    const body = `<p style="margin:0 0 10px;">Dear ${esc(firstName || 'guest')},</p>
        <p style="margin:0;">Your payment of <b class="em-ink">&euro;${paid.toFixed(2)}</b> for <b class="em-ink">Plexus Week 2026</b> has been received${seats > 1 ? ` &mdash; <b class="em-ink">${seats} Gala seats</b>` : ''}. Your ticket is below.</p>
        ${buildReservationsHtml({ wantConf, wantBridges, seats })}
        ${invoiceNumber ? `<p style="margin:12px 0 0;font-size:12px;color:${DTK.soft};"><b style="color:${DTK.ink};">Invoice:</b> ${esc(invoiceNumber)}</p>` : ''}
        ${qrBlockHtml || ''}
        ${walletHtml || ''}
        ${partyHtml}
        ${programNote}
        <p style="margin:18px 0 0;">We look forward to welcoming you ${source === 'plexus' ? 'to Plexus Week 2026' : 'home'} in Zagreb.</p>`;
    return reviewGate.emailShell('Payment confirmed', body, null, null, {
        eyebrow: 'Plexus Week 2026 &middot; Your ticket',
        preheader: 'Payment received — your Plexus Week 2026 ticket and check-in QR are inside.'
    });
}

// The named guest's copy of the party QR — same shell, same facts as before (who registered
// them, when and where, seat paid, shared QR, black tie, tables to follow).
function buildGuestEntryEmail({ guestFirst, registrantName, qrBlockHtml, walletHtml }) {
    const body = `<p style="margin:0 0 10px;">Dear ${esc(guestFirst || 'there')},</p>
        <p style="margin:0;"><b class="em-ink">${esc(registrantName)}</b> has registered you as their guest for the <b class="em-ink">Plexus Gala Evening</b> &mdash; 5 December 2026 &middot; 19:00 &middot; Hotel Esplanade, Mihanovi&#263;eva 1, Zagreb. Your seat is paid for.</p>
        ${qrBlockHtml || ''}
        ${walletHtml || ''}
        <p style="margin:16px 0 0;">Dress code: black tie. Table reservations will follow closer to the event.</p>`;
    return reviewGate.emailShell('Your Gala Evening entry', body, null, null, {
        eyebrow: 'Plexus Week 2026 &middot; Gala Evening',
        preheader: 'Your seat at the Gala Evening is paid — your entry QR is inside.'
    });
}

// ---------------------------------------------------------------- PAYMENT: the finance note
/**
 * The Gala seat of a Zagreb registration was just PAID. If the registrant ticked
 * "official invoice" on the form, tell the finance lead once. Both webhook branches call
 * this (Path B directly; the pay-link route through fulfilLinkedCaGala), so the guard is the
 * INVOICE-MIRO-NOTIFIED marker on the CA row's notes — a second call, from whichever branch,
 * sends nothing. Rows without the flag return 'not-needed' and touch nothing.
 *
 * @param {{caId?:string, galaRegId?:string, amount?:number, invoiceNumber?:string}} p
 * @returns {Promise<{status:'done'|'already'|'not-needed'|'notfound'|'send-failed', to?:string}>}
 */
async function notifyInvoiceNeeded(deps, { caId, galaRegId, amount, invoiceNumber } = {}) {
    const { query, db, saveDb, flushDb, sendEmail } = deps;
    const log = deps.log || ((...a) => console.log('[GalaPayLink]', ...a));

    const ca = caId
        ? query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [caId])
        : (galaRegId ? query.get('SELECT * FROM croatians_abroad_registrations WHERE gala_registration_id = ?', [galaRegId]) : null);
    if (!ca) return { status: 'notfound' };
    if (!Number(ca.needs_invoice)) return { status: 'not-needed' };
    if (reviewGate.getMarker(ca.notes, INVOICE_MARKER)) return { status: 'already' };

    const galaRow = (galaRegId || ca.gala_registration_id)
        ? query.get('SELECT guest_count, invoice_number, amount_paid FROM gala_registrations WHERE id = ?', [galaRegId || ca.gala_registration_id])
        : null;
    const paid = Number(amount) || Number(ca.amount_paid) || Number(galaRow && galaRow.amount_paid) || 0;
    const ref = invoiceNumber || ca.invoice_number || (galaRow && galaRow.invoice_number) || '';
    const name = `${ca.first_name || ''} ${ca.last_name || ''}`.trim();

    // The billing details from the form (may be absent on rows ticked before the form asked).
    let billing = null;
    try { billing = JSON.parse(ca.invoice_details || 'null'); } catch (e) { billing = null; }

    const html = buildInvoiceNeededEmail({
        name, email: ca.email, institution: ca.institution, country: ca.country,
        seats: partySeats(galaRow || ca), amount: paid, paymentRef: ref, registrationId: ca.id,
        billing
    });
    const sent = await sendEmail(FINANCE_TO, `Official invoice needed — ${name || ca.email}, Gala Evening`, html);
    if (!sent || sent.success === false || sent.mock) {
        log(`[EMAIL-FAIL] invoice note for CA ${ca.id} did not reach ${FINANCE_TO}:`,
            sent && sent.mock ? 'mock mode (no provider configured)' : ((sent && sent.error) || 'unknown'));
        return { status: 'send-failed', to: FINANCE_TO };
    }
    db.run('UPDATE croatians_abroad_registrations SET notes = ? WHERE id = ?',
        [reviewGate.upsertMarker(ca.notes, INVOICE_MARKER, todayIso()), ca.id]);
    try { saveDb && saveDb(); } catch (e) {}
    try { flushDb && flushDb(); } catch (e) {}
    log(`invoice note for CA ${ca.id} (${name}, ${fmtEur(paid)}, ${ref || 'no ref'}) -> ${FINANCE_TO}`);
    return { status: 'done', to: FINANCE_TO };
}

// ---------------------------------------------------------------- PAYMENT: one party ticket
/**
 * A 'gala-ticket' Stripe session just completed. If this gala row belongs to a Zagreb
 * multi-event registration, square the CA row and issue the ONE combined party ticket
 * instead of the standalone Gala receipt (which carries no QR and never mentions the free
 * events).
 *
 * @returns {Promise<{handled:boolean, duplicate?:boolean, email?:string, events?:string[], seats?:number}>}
 *          handled=false means "not a CA row" — the caller keeps its own behaviour untouched.
 */
async function fulfilLinkedCaGala(deps, { galaRegId, amount, invoiceNumber, sessionEmail } = {}) {
    const { query, db, saveDb, flushDb, sendEmail, buildTicketQrBlock, qrPngAttachment } = deps;
    const log = deps.log || ((...a) => console.log('[GalaPayLink]', ...a));
    // Wallet passes (plexus-pass.js) — optional deps so the module still works without them.
    const links = (kind, id) => { try { return deps.walletLinks ? deps.walletLinks(kind, id) : null; } catch (e) { log('wallet links failed (non-blocking):', e.message); return null; } };
    const stack = l => { try { return deps.walletStackHtml && l ? deps.walletStackHtml(l) : ''; } catch (e) { return ''; } };
    if (!galaRegId) return { handled: false };

    const ca = query.get('SELECT * FROM croatians_abroad_registrations WHERE gala_registration_id = ?', [galaRegId]);
    if (!ca) return { handled: false };
    if (ca.gala_payment_status === 'paid') {
        log(`CA ${ca.id} gala already paid — duplicate, nothing re-sent`);
        return { handled: true, duplicate: true };
    }

    const galaRow = query.get('SELECT guest_count FROM gala_registrations WHERE id = ?', [galaRegId]);
    const seats = partySeats(galaRow || ca);
    const wantConf = !!Number(ca.selected_conference);
    const wantBridges = !!Number(ca.selected_bridges);
    const to = String(ca.email || sessionEmail || '').trim();
    const paid = Number(amount) || 0;

    db.run(`UPDATE croatians_abroad_registrations
            SET gala_status = 'confirmed', gala_payment_status = 'paid', amount_paid = ?, invoice_number = ?
            WHERE id = ?`, [paid, invoiceNumber || ca.invoice_number || null, ca.id]);
    try { saveDb && saveDb(); } catch (e) {}
    try { flushDb && flushDb(); } catch (e) {}

    // The finance note goes out BEFORE the ticket so a registrant with no usable address (the
    // early return below) still gets their invoice request in front of a person. Idempotent.
    try { await notifyInvoiceNeeded(deps, { caId: ca.id, galaRegId, amount: paid, invoiceNumber: invoiceNumber || ca.invoice_number }); }
    catch (e) { log('invoice note failed (non-blocking):', e.message); }

    const events = [wantConf ? 'conference' : null, wantBridges ? 'bridges' : null, 'gala'].filter(Boolean);
    if (!to) {
        log(`CA ${ca.id} marked paid but carries no email — no ticket could be sent`);
        return { handled: true, email: null, events, seats };
    }

    // The QR carries BOTH ids so the scanner verifies it in gala AND conference/bridges modes,
    // and `guests` so the door reads the party the same way every other Med&X ticket does.
    let atts = [];
    try {
        atts = await qrPngAttachment({
            type: 'MEDX_MEMBER', caRegId: ca.id, regId: galaRegId, email: to,
            name: `${ca.first_name || ''} ${ca.last_name || ''}`.trim(),
            evt: 'gala', evtName: 'Plexus 2026 — Gala Evening', events,
            guests: seats - 1, amt: paid, diet: ca.dietary || ''
        });
    } catch (e) { log('QR attachment failed (non-blocking):', e.message); }

    // Read the named party BEFORE composing, so the ticket can tell the registrant whether
    // their guests already hold a copy or need this email forwarded. Rows with an address get
    // their own copy further down; the rest are reachable only through the registrant.
    let namedGuests = [];
    try { namedGuests = query.all('SELECT id, name, email FROM ca_registration_guests WHERE registration_id = ?', [ca.id]) || []; }
    catch (e) { namedGuests = []; }
    const guestsWithEmail = namedGuests.filter(g => String(g.email || '').trim()).length;
    const party = partyNote(seats, guestsWithEmail);

    const html = buildCombinedTicketEmail({
        firstName: ca.first_name, amount: paid, seats, invoiceNumber: invoiceNumber || ca.invoice_number,
        wantConf, wantBridges, source: ca.source,
        qrBlockHtml: buildTicketQrBlock(galaRegId, { label: 'Your Plexus Week 2026 check-in QR', caption: 'Present this QR at the entrance of each event you registered for' }),
        partyNoteText: party,
        walletHtml: stack(links('gala', galaRegId))
    });

    const sent = await sendEmail(to, 'Your ticket — Plexus Week 2026', html, atts);
    if (!sent || sent.success === false || sent.mock) {
        log(`[EMAIL-FAIL] PAID guest ${to} (CA ${ca.id}, gala ${galaRegId}) did NOT receive the combined ticket:`,
            sent && sent.mock ? 'mock mode (no provider configured)' : ((sent && sent.error) || 'unknown'));
    }

    // Named guests with an email get the SAME party QR — one QR admits the whole party.
    // (Those without one are covered by the forward-this-email line on the ticket above.)
    try {
        for (const g of namedGuests.filter(x => String(x.email || '').trim())) {
            const gFirst = String(g.name || 'there').split(' ')[0];
            await sendEmail(g.email, 'Your Gala Evening entry — Plexus Week 2026', buildGuestEntryEmail({
                guestFirst: gFirst,
                registrantName: `${ca.first_name || ''} ${ca.last_name || ''}`.trim(),
                qrBlockHtml: buildTicketQrBlock(galaRegId, { label: 'Your entry QR (shared with your party)', caption: 'Present this QR at the entrance — it admits your whole party, arriving together or separately' }),
                walletHtml: stack(g.id ? links('guest', g.id) : null)
            }));
        }
    } catch (e) { log('party guest entry emails failed (non-blocking):', e.message); }

    log(`CA ${ca.id} gala PAID via pay link — combined ticket for ${seats} seat(s) (${events.join(' + ')}) sent to ${to}`);
    return { handled: true, email: to, events, seats, invoice_number: invoiceNumber || null };
}

module.exports = {
    PAYLINK_MARKER,
    NUDGE_MARKER,
    INVOICE_MARKER,
    FINANCE_TO,
    mintPayToken,
    fmtEur,
    fmtDate,
    fmtDayMonth,
    partySeats,
    partyNote,
    quoteGalaSeats,
    seatsLine,
    selectionPhrase,
    galaLegNeedsPayment,
    buildPayLinkEmail,
    buildNudgeEmail,
    buildInvoiceNeededEmail,
    buildReservationsHtml,
    buildCombinedTicketEmail,
    buildGuestEntryEmail,
    sendGalaPayLink,
    sendUnpaidGalaNudge,
    listUnpaidGalaNudges,
    notifyInvoiceNeeded,
    fulfilLinkedCaGala
};
