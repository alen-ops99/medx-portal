/**
 * gala-paylink.js — the Gala payment link a HELD registration never received.
 *
 * THE GAP THIS CLOSES (found 2026-09-15, two live victims).
 * The Zagreb form (POST /api/croatians-abroad/register, source='plexus') hands a suspicious
 * registration to the review gate INSTEAD of Stripe: every selected leg is written at
 * 'pending-review' and no checkout session is ever created. When the registration is later
 * released — the owner clicking Approve in the review email, or the registrant proving an
 * institutional inbox, both of which run the SAME approve(id) handler — the free legs were
 * replayed and confirmed, but the Gala leg simply stayed at gala_status='awaiting_payment'
 * with gala_registrations.status='awaiting_payment' and pay_token NULL. No link was ever
 * minted, so no email could carry one: the guest was told to "reply and we will send the
 * ticket link". Ana Franceschi and Magdalena Zebrowska sat in that state for days.
 *
 * Two entry points, one per moment:
 *   sendGalaPayLink()    — at APPROVE. Ensures the gala row exists, flips it to 'approved',
 *                          mints pay_token, and sends ONE "complete your Gala reservation"
 *                          email carrying /pay/gala/<token>. Idempotent via a notes marker.
 *   fulfilLinkedCaGala() — at PAYMENT. /pay/gala mints a Stripe session with metadata.type
 *                          'gala-ticket' (NOT 'croatians-abroad-gala'), so the webhook's
 *                          gala-ticket branch used to answer a Plexus multi-event guest with
 *                          a bare receipt: no QR, no conference/bridges lines, and the CA row
 *                          left at 'awaiting_payment' forever. This issues the ONE combined
 *                          ticket instead and squares the CA row.
 *
 * Deliberately a separate file. The logic is then hermetically testable
 * (tests/ca-approve-paylink.test.js drives it against a scratch sqlite carrying the real
 * schema) instead of being buried in a 30,000-line route file, and server.js keeps a
 * two-line wiring diff at each site. Every collaborator is INJECTED — this module opens no
 * database, sends no mail and reads no env of its own beyond the public base URL.
 *
 * Deps contract (both functions):
 *   { query, db, saveDb, flushDb, sendEmail, log? }
 *   sendGalaPayLink    also: effectiveGalaPrice()
 *   fulfilLinkedCaGala also: buildEmailTemplate(), buildTicketQrBlock(), qrPngAttachment()
 */
'use strict';

const crypto = require('crypto');
const reviewGate = require('./review-gate');

// One outgoing pay-link email per registration, ever. The marker lives in the row's own
// notes (the same restart-safe channel the review gate uses for VERIFY-REQUESTED /
// VERIFY-SENT), so a second Approve click, a re-delivered institutional confirmation and a
// redeploy mid-flight all read the same truth.
const PAYLINK_MARKER = 'GALA-PAYLINK-SENT';

// Matches every other pay_token in the codebase (admin server.js gala approve + pay-link,
// v2/gala-ops add-guest + waitlist accept): 24 random bytes rendered as 48 hex chars.
// /pay/gala/:token requires >= 16 chars before it will even look in the database.
const mintPayToken = () => crypto.randomBytes(24).toString('hex');

const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const publicBase = () => String(process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com')
    .replace(/\/+$/, '');

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

const todayIso = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- the pay-link email
// House dark shell, registrant voice, the owner's own words for the ask. Built pure so the
// test can assert every claim in it (price, deadline, token, one-ticket promise) without a
// database or a mail provider.
function buildPayLinkEmail({ firstName, payUrl, price, earlyBirdDeadline, galaDate, galaVenue,
                             wantConference, wantBridges, guestCount }) {
    const facts = [];
    const when = [fmtDate(galaDate), galaVenue].filter(Boolean).join(' · ');
    if (when) facts.push(['Gala Evening', when]);
    if (price) facts.push(['Gala ticket', fmtEur(price)]);
    // Only while the early-bird price is genuinely still ahead — a deadline in the past is a
    // stale promise, and the registrant would be charged the regular price on arrival.
    if (earlyBirdDeadline && String(earlyBirdDeadline) >= todayIso()) {
        facts.push(['Early-bird price until', fmtDate(earlyBirdDeadline)]);
    }

    const alsoRegistered = [
        wantConference ? 'the Plexus Conference' : null,
        wantBridges ? 'Croatian Biomedical Bridges' : null
    ].filter(Boolean);
    const coverLine = alsoRegistered.length
        ? `After the payment goes through we send you <b class="em-ink">one ticket</b> — a single QR that covers ${esc(alsoRegistered.join(' and '))} and the Gala Evening together.`
        : 'After the payment goes through we send you <b class="em-ink">one ticket</b> — a single QR that covers everything you registered for.';

    // A party of more than one is stated, never priced: this link charges one Gala seat (the
    // /pay/gala route has always done so), and inventing a party total in the email would
    // promise a charge the link does not make.
    const guests = Math.max(0, parseInt(guestCount, 10) || 0);
    const guestNote = guests
        ? `Your registration also notes ${guests === 1 ? 'one guest' : guests + ' guests'} — we will confirm ${guests === 1 ? 'their seat' : 'their seats'} with you separately.`
        : '';

    return reviewGate.emailShell('Your registration is confirmed',
        `<p style="margin:0 0 10px;">Dear ${esc(firstName || 'guest')},</p>
         <p style="margin:0 0 10px;">Great news — your registration is confirmed. Thank you very much.</p>
         <p style="margin:0 0 10px;">To complete your Gala Evening reservation, please pay for your Gala ticket here:</p>`,
        'Complete my Gala reservation', payUrl,
        {
            eyebrow: 'Registration confirmed',
            preheader: 'Your registration is confirmed — one step left to hold your Gala seat.',
            facts,
            footNote: `${coverLine}${guestNote ? '<br><br>' + guestNote : ''}`
        });
}

// ---------------------------------------------------------------- APPROVE: mint + send
/**
 * Release the Gala leg of a review-held Zagreb registration.
 *
 * Reads the CA row LIVE, so when the institutional-confirmation path has already re-pointed
 * the row at the verified inbox (review-gate.js calls h.setEmail BEFORE h.approve), the pay
 * email follows to that address by construction.
 *
 * opts.preview  — build the email from this row but send it to opts.to with a "[PREVIEW] "
 *                 subject and mutate NOTHING: no token is minted, no status moves, no marker
 *                 is stamped. Used to show the owner the email before anyone real gets it.
 *
 * @returns {Promise<{status:'done'|'already'|'no-gala'|'already-paid'|'notfound'|'preview'|'no-email', ...}>}
 */
async function sendGalaPayLink(deps, caId, opts = {}) {
    const { query, db, saveDb, flushDb, sendEmail, effectiveGalaPrice } = deps;
    const log = deps.log || ((...a) => console.log('[GalaPayLink]', ...a));
    const preview = !!opts.preview;

    const row = query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [caId]);
    if (!row) return { status: 'notfound' };
    // Never touched for a registration that did not ask for the Gala.
    if (!Number(row.selected_gala)) return { status: 'no-gala' };

    const to = preview ? String(opts.to || '').trim() : String(row.email || '').trim();
    if (!to) return { status: 'no-email' };

    // The gala row is normally created by the register route; ensure it for a row that lost
    // it (an older held registration, a partial write) so the link always has a target.
    let gala = row.gala_registration_id
        ? query.get('SELECT * FROM gala_registrations WHERE id = ?', [row.gala_registration_id])
        : null;
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
    if (gala && !preview && (gala.payment_status === 'paid' || gala.status === 'confirmed')) {
        return { status: 'already-paid', gala_registration_id: gala.id };
    }
    if (!preview && reviewGate.getMarker(row.notes, PAYLINK_MARKER)) {
        return { status: 'already', gala_registration_id: gala && gala.id, email: to };
    }

    const price = typeof effectiveGalaPrice === 'function' ? effectiveGalaPrice() : null;
    let settings = {};
    try { settings = query.get("SELECT date, venue, early_bird_deadline FROM gala_settings WHERE id = 'default'") || {}; } catch (e) {}

    let token;
    if (preview) {
        // A preview never mints a live payment link for a guest who has not been released.
        // An existing token is reused (the owner can then click it for real); otherwise the
        // button carries a sample that lands on the friendly "invalid link" page.
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
        price,
        earlyBirdDeadline: settings.early_bird_deadline,
        galaDate: settings.date,
        galaVenue: settings.venue,
        wantConference: !!Number(row.selected_conference),
        wantBridges: !!Number(row.selected_bridges),
        guestCount: row.guest_count
    });
    const subject = (preview ? '[PREVIEW] ' : '') + 'Your registration is confirmed — complete your Gala reservation';

    const sent = await sendEmail(to, subject, html);
    if (sent && (sent.success === false || sent.mock)) {
        // Loud, and NOT stamped: an unsent link must stay re-sendable.
        log(`[EMAIL-FAIL] pay link for CA ${caId} did not reach ${to}:`,
            sent.mock ? 'mock mode (no provider configured)' : (sent.error || 'unknown'));
        if (!preview) return { status: 'send-failed', gala_registration_id: gala.id, token, email: to };
    }

    if (preview) return { status: 'preview', email: to, token, price, subject };

    db.run('UPDATE croatians_abroad_registrations SET notes = ? WHERE id = ?',
        [reviewGate.upsertMarker(row.notes, PAYLINK_MARKER, todayIso()), caId]);
    try { saveDb && saveDb(); } catch (e) {}
    try { flushDb && flushDb(); } catch (e) {}
    log(`Gala pay link sent for CA ${caId} -> ${to} (gala ${gala.id}, ${fmtEur(price)})`);
    return { status: 'done', gala_registration_id: gala.id, token, email: to, price, subject };
}

// ---------------------------------------------------------------- PAYMENT: one combined ticket
/**
 * A 'gala-ticket' Stripe session just completed. If this gala row belongs to a Zagreb
 * multi-event registration, square the CA row and issue the ONE combined ticket instead of
 * the standalone Gala receipt (which carries no QR and never mentions the free events).
 *
 * @returns {Promise<{handled:boolean, duplicate?:boolean, email?:string, events?:string[]}>}
 *          handled=false means "not a CA row" — the caller keeps its own behaviour untouched.
 */
async function fulfilLinkedCaGala(deps, { galaRegId, amount, invoiceNumber, sessionEmail } = {}) {
    const { query, db, saveDb, flushDb, sendEmail, buildEmailTemplate, buildTicketQrBlock, qrPngAttachment } = deps;
    const log = deps.log || ((...a) => console.log('[GalaPayLink]', ...a));
    if (!galaRegId) return { handled: false };

    const ca = query.get('SELECT * FROM croatians_abroad_registrations WHERE gala_registration_id = ?', [galaRegId]);
    if (!ca) return { handled: false };
    if (ca.gala_payment_status === 'paid') {
        log(`CA ${ca.id} gala already paid — duplicate, nothing re-sent`);
        return { handled: true, duplicate: true };
    }

    const wantConf = !!Number(ca.selected_conference);
    const wantBridges = !!Number(ca.selected_bridges);
    const to = String(ca.email || sessionEmail || '').trim();
    const paid = Number(amount) || 0;

    db.run(`UPDATE croatians_abroad_registrations
            SET gala_status = 'confirmed', gala_payment_status = 'paid', amount_paid = ?, invoice_number = ?
            WHERE id = ?`, [paid, invoiceNumber || ca.invoice_number || null, ca.id]);
    try { saveDb && saveDb(); } catch (e) {}
    try { flushDb && flushDb(); } catch (e) {}

    const events = [wantConf ? 'conference' : null, wantBridges ? 'bridges' : null, 'gala'].filter(Boolean);
    if (!to) {
        log(`CA ${ca.id} marked paid but carries no email — no ticket could be sent`);
        return { handled: true, email: null, events };
    }

    const eventListHtml = [
        wantConf ? `<tr><td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;border-left:3px solid #a78bfa;">
            <strong style="color:#0f172a;">Plexus Conference</strong>
            <span style="color:#22c55e;font-size:12px;font-weight:600;margin-left:8px;">PRE-REGISTERED (INCLUDED)</span>
            <div style="color:#64748b;font-size:12px;margin-top:3px;">4 December 2026 &middot; Zagreb &middot; program to follow</div></td></tr>` : '',
        wantBridges ? `<tr><td style="padding:12px 14px;border-bottom:1px solid #f1f5f9;border-left:3px solid #2dd4bf;">
            <strong style="color:#0f172a;">Croatian Biomedical Bridges</strong>
            <span style="color:#22c55e;font-size:12px;font-weight:600;margin-left:8px;">PRE-REGISTERED (INCLUDED)</span>
            <div style="color:#64748b;font-size:12px;margin-top:3px;">4 or 5 December 2026 &middot; Zagreb &middot; date and venue to be confirmed</div></td></tr>` : '',
        `<tr><td style="padding:12px 14px;border-left:3px solid #c9a962;">
            <strong style="color:#0f172a;">Plexus Gala Evening</strong>
            <span style="color:#22c55e;font-size:12px;font-weight:600;margin-left:8px;">CONFIRMED &amp; PAID</span>
            <div style="color:#64748b;font-size:12px;margin-top:3px;">5 December 2026 &middot; Hotel Esplanade Zagreb &middot; arrival from 7:00 PM</div></td></tr>`
    ].filter(Boolean).join('');

    // The QR carries BOTH ids so the scanner verifies it in gala AND conference/bridges modes.
    let atts = [];
    try {
        atts = await qrPngAttachment({
            type: 'MEDX_MEMBER', caRegId: ca.id, regId: galaRegId, email: to,
            name: `${ca.first_name || ''} ${ca.last_name || ''}`.trim(),
            evt: 'gala', evtName: 'Plexus 2026 — Gala Evening', events, amt: paid, diet: ca.dietary || ''
        });
    } catch (e) { log('QR attachment failed (non-blocking):', e.message); }

    const html = buildEmailTemplate('Payment Confirmed', `
        <div style="text-align:center;margin-bottom:8px;">
            <div style="display:inline-block;background:#22c55e;color:#fff;font-size:13px;font-weight:600;padding:6px 20px;border-radius:20px;letter-spacing:0.5px;">PAYMENT CONFIRMED</div>
        </div>
        <p style="margin-top:18px;">Dear <strong>${esc(ca.first_name || 'guest')}</strong>,</p>
        <p>Your payment of <strong>&euro;${paid.toFixed(2)}</strong> for <strong style="color:#C9A962;">Plexus 2026</strong> has been received. Your ticket is below.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr><td style="background:#f8fafc;padding:10px 14px;font-size:12px;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0;">Your Plexus 2026 Reservations</td></tr>
            ${eventListHtml}
        </table>
        ${invoiceNumber ? `<p style="font-size:13px;color:#64748b;"><strong>Invoice:</strong> ${esc(invoiceNumber)}</p>` : ''}
        ${buildTicketQrBlock(galaRegId, { label: 'Your Plexus 2026 Check-in QR', caption: 'Present this QR at the entrance of each event you registered for' })}
        ${(wantConf || wantBridges) ? `<p>We will email you ${[wantConf ? 'the <strong>Conference program</strong>' : null, wantBridges ? 'the <strong>Croatian Biomedical Bridges date and venue</strong>' : null].filter(Boolean).join(' and ')} as soon as ${(wantConf && wantBridges) ? 'they are' : 'it is'} finalized.</p>` : ''}
        <p style="margin-top:24px;">We look forward to welcoming you ${ca.source === 'plexus' ? 'to Plexus 2026' : 'home'} in Zagreb.</p>
        <p style="font-size:13px;color:#64748b;">Questions? <a href="mailto:laura.rodman@medx.hr" style="color:#C9A962;font-weight:500;">Laura Rodman</a><br><span style="font-size:12px;">Best regards, <strong style="color:#334155;">The Med&amp;X Team</strong></span></p>
    `);

    const sent = await sendEmail(to, 'Payment Confirmed — Plexus 2026', html, atts);
    if (!sent || sent.success === false || sent.mock) {
        log(`[EMAIL-FAIL] PAID guest ${to} (CA ${ca.id}, gala ${galaRegId}) did NOT receive the combined ticket:`,
            sent && sent.mock ? 'mock mode (no provider configured)' : ((sent && sent.error) || 'unknown'));
    }

    // Named guests with an email get the SAME party QR — one QR admits the whole party.
    try {
        const party = query.all(
            "SELECT name, email FROM ca_registration_guests WHERE registration_id = ? AND COALESCE(email, '') <> ''",
            [ca.id]) || [];
        for (const g of party) {
            const gFirst = String(g.name || 'there').split(' ')[0];
            await sendEmail(g.email, 'Your Gala Evening entry — Plexus 2026', buildEmailTemplate('Your Gala Evening entry', `
                <p>Dear ${esc(gFirst)},</p>
                <p><strong>${esc(`${ca.first_name || ''} ${ca.last_name || ''}`.trim())}</strong> has registered you as their guest for the <strong>Plexus 2026 Gala Evening</strong> — December 5, 2026 · 19:00 · Hotel Esplanade, Mihanovićeva 1, Zagreb.</p>
                ${buildTicketQrBlock(galaRegId, { label: 'Your entry QR (shared with your party)', caption: 'Present this QR at the entrance — it admits your whole party, arriving together or separately' })}
                <p>Dress code: black tie. Table reservations will follow closer to the event.</p>
                <p style="font-size:13px;color:#64748b;">Questions? Reply to this email or write to laura.rodman@medx.hr.</p>
            `));
        }
    } catch (e) { log('party guest entry emails failed (non-blocking):', e.message); }

    log(`CA ${ca.id} gala PAID via pay link — combined ticket (${events.join(' + ')}) sent to ${to}`);
    return { handled: true, email: to, events, invoice_number: invoiceNumber || null };
}

module.exports = {
    PAYLINK_MARKER,
    mintPayToken,
    fmtEur,
    fmtDate,
    buildPayLinkEmail,
    sendGalaPayLink,
    fulfilLinkedCaGala
};
