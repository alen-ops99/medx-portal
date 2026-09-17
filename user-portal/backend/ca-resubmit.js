/**
 * ca-resubmit.js — one person, ONE Plexus registration: what a RESUBMISSION of the Zagreb
 * form does to the row this e-mail already holds (audit item D, 2026-09-17).
 *
 * THE BUG. POST /api/croatians-abroad/register answered a resubmission that added nothing
 * with the existing row (guard of 2026-09-16), but a resubmission that ADDED a leg still
 * INSERTed a second croatians_abroad_registrations row — and, when the Gala was in it, a
 * second gala_registrations row and a second Stripe checkout. 14 e-mails ended up with 2–3
 * rows and 9 abandoned Gala twins (an unpaid seat next to the same person's paid one). A
 * resubmission that DROPPED the Gala left the unpaid seat and its checkout standing.
 *
 * Three functions, all driven by the route, none opening a database or sending mail:
 *   decide()      pure. The prior row + its linked gala row + what the form wants now →
 *                 which legs are ADDED, whether the unpaid Gala is DROPPED, or nothing
 *                 changes (→ the route's untouched "already registered" branch).
 *   apply()       writes exactly those changes onto the PRIOR row — never a new one — and
 *                 mints (or reuses) the gala_registrations row when the Gala is the added leg.
 *   finishFree()  the response + ticket for a resubmission that did NOT add a Gala seat (a
 *                 resubmission that did continues into the route's own Path B checkout, with
 *                 the prior row's id in the Stripe metadata, so the webhook settles the same
 *                 row).
 *
 * RULES.
 *   - A PAID Gala leg is never touched — not dropped, not re-minted, not re-priced. "Paid"
 *     is read from every indicator the codebase uses: CA gala_payment_status 'paid' or
 *     gala_status 'confirmed', gala row payment_status paid / vip-comp / comp or status
 *     confirmed / vip-comp.
 *   - Free legs are never dropped by a resubmission. The form is a registration form, not
 *     an edit form: someone who re-ticks only the Conference keeps the Bridges they held. The
 *     Gala is the exception because an unpaid seat blocks the free-events ticket ("the
 *     payment link completes it") and its abandoned checkout is the twin the audit found.
 *   - Dropping the Gala: selected_gala → 0 and gala_status → 'cancelled' on the CA row, the
 *     linked gala row → status 'cancelled' with its payment record untouched (the same
 *     soft-cancel the admin's gala-ops performs), and the abandoned Stripe checkout expired
 *     best-effort. selected_gala goes to 0 because every member-side reader — the QR payload
 *     the doors scan, the wallet pass, the nudge list, the e-mail exports and this very
 *     guard — keys on that flag alone, and a fresh registration without the Gala is
 *     selected_gala = 0 too; gala_status 'cancelled' keeps the trace that a seat was asked
 *     for and given up.
 *   - Profile: a non-empty re-sent institution / country / role / dietary refreshes the row;
 *     a re-sent note is appended (notes also carry the review-gate and pay-link markers,
 *     which must survive — see review-gate.upsertMarker). Name and e-mail are identity and
 *     are never overwritten by a resubmission.
 *   - The review gate runs on a resubmission as on any submission. A HELD resubmission never
 *     reaches apply(): the route falls through to its untouched held path (a new held row the
 *     owner decides on) — a live row is never expanded on a payload the gate would hold.
 *
 * Deliberately a separate file, like gala-paylink.js: hermetically testable against a
 * scratch sqlite carrying the real schema (tests/ca-resubmit.test.js), a small wiring diff
 * in the 30,000-line route file.
 */
'use strict';

const crypto = require('crypto');
const reviewGate = require('./review-gate');

// The same vocab the route, plexus-pass.js and gala-paylink.js use.
const FREE_LIVE = ['pre-registered', 'confirmed'];
const GALA_PAID_PAYMENT = ['paid', 'vip-comp', 'comp'];
const GALA_PAID_STATUS = ['confirmed', 'vip-comp'];
const GALA_ROW_DEAD = ['cancelled', 'pending-review'];          // mirrors the route's galaLive
const CA_GALA_OWED = ['awaiting_payment', 'approved'];           // an unpaid CA gala leg with no live row still counts as owed
const LEG_NAMES = { conference: 'Plexus Conference', bridges: 'Croatian Biomedical Bridges', gala: 'Gala Evening' };
const RESUBMIT_MARKER = 'RESUBMITTED';

const lower = v => String(v == null ? '' : v).toLowerCase();
const freeLegLive = st => FREE_LIVE.includes(String(st || ''));
const galaRowLive = g => !!g && !GALA_ROW_DEAD.includes(String(g.status || ''));

/** Any indicator of a paid seat, on either row. Inclusive on purpose: a paid seat is never touched. */
function galaIsPaid(prior, galaRow) {
    if (prior && (lower(prior.gala_payment_status) === 'paid' || lower(prior.gala_status) === 'confirmed')) return true;
    if (!galaRow) return false;
    return GALA_PAID_PAYMENT.includes(lower(galaRow.payment_status)) || GALA_PAID_STATUS.includes(lower(galaRow.status));
}

/** 'Plexus Conference, Gala Evening' — the applied_for string the fresh path writes, from a legs map. */
const appliedFor = legs => ['conference', 'bridges', 'gala'].filter(k => legs && legs[k]).map(k => LEG_NAMES[k]).join(', ');

/**
 * decide({ prior, priorGala, want }) → {
 *   covered,          nothing to add, nothing to drop → the route's existing "already registered" branch
 *   adds:             { conference, bridges, gala }   legs the prior row does not hold live
 *   dropGala,         the form left the Gala out while the prior row owes an UNPAID seat
 *   galaPaid,         the prior row's seat is paid (never touched)
 *   galaUnpaidKept,   the form still wants a Gala the prior row already holds unpaid → no ticket yet
 *   legsAfter:        { conference, bridges, gala }   what the row holds once applied
 *   changes           ['+bridges', '-gala'] for the log and the notes marker
 * }
 * prior     = the live croatians_abroad_registrations row (the route's own SQL picks it)
 * priorGala = its linked gala_registrations row or null
 * want      = { conference, bridges, gala } booleans, already clamped by the route
 */
function decide({ prior, priorGala, want }) {
    const w = { conference: !!(want && want.conference), bridges: !!(want && want.bridges), gala: !!(want && want.gala) };
    const confLive = !!Number(prior.selected_conference) && freeLegLive(prior.conference_status);
    const bridgesLive = !!Number(prior.selected_bridges) && freeLegLive(prior.bridges_status);
    const galaSelected = !!Number(prior.selected_gala);
    const galaPaid = galaIsPaid(prior, priorGala);
    // A seat the row holds: paid, or reserved and awaiting payment. (A cancelled one is not.)
    const galaLive = galaSelected && (galaPaid || galaRowLive(priorGala));
    // A seat still owed: reserved, unpaid — with a live gala row, or with none at all.
    const galaOwed = galaSelected && !galaPaid && (galaRowLive(priorGala) || CA_GALA_OWED.includes(String(prior.gala_status || '')));

    const adds = { conference: w.conference && !confLive, bridges: w.bridges && !bridgesLive, gala: w.gala && !galaLive };
    const dropGala = !w.gala && galaOwed;
    const covered = !adds.conference && !adds.bridges && !adds.gala && !dropGala;
    const legsAfter = {
        conference: confLive || adds.conference,
        bridges: bridgesLive || adds.bridges,
        gala: adds.gala || (galaLive && !dropGala)
    };
    const changes = [
        adds.conference ? '+conference' : null, adds.bridges ? '+bridges' : null,
        adds.gala ? '+gala' : null, dropGala ? '-gala' : null
    ].filter(Boolean);
    return { covered, adds, dropGala, galaPaid, galaLive, galaUnpaidKept: w.gala && galaLive && !galaPaid, legsAfter, changes };
}

// Notes carry free text AND the ' | '-separated markers of review-gate.js / gala-paylink.js.
// A re-sent note is appended once; the RESUBMITTED marker records what this resubmission did.
function mergeNotes(priorNotes, newNote, changes, dateIso) {
    let notes = String(priorNotes || '');
    const n = String(newNote || '').trim();
    if (n && !notes.includes(n)) notes = notes ? notes + ' | ' + n : n;
    return reviewGate.upsertMarker(notes, RESUBMIT_MARKER, `${dateIso} ${changes.join(' ')}`.trim());
}

/**
 * apply(deps, { prior, priorGala, decision, form, linkedUserId }) → { regId, galaRegistrationId, droppedGalaId, checkoutExpired, changes }
 *   deps: { query, db, expireCheckout?, log?, now? }
 *     expireCheckout(sessionId) — best-effort; the route passes stripe.checkout.sessions.expire
 *     when Stripe is configured, null otherwise. Errors are swallowed (an expired / paid session
 *     throws — nothing to do).
 *   form: { institution, country, role, dietary, notes, appliedFor, customAnswersJson,
 *           inviteLinkId, needsInvoice, invoiceDetailsJson } — the resubmission's values.
 * Writes ONLY the prior row (and the gala row it links). Never inserts a CA row. The caller
 * saves/flushes; the guests, the Path B checkout and the emails stay in the route.
 */
async function apply(deps, { prior, priorGala, decision, form = {}, linkedUserId = null }) {
    const { query, db, expireCheckout, log = () => {} } = deps;
    const dateIso = (deps.now ? deps.now() : new Date()).toISOString().slice(0, 10);
    const out = { regId: prior.id, galaRegistrationId: null, droppedGalaId: null, checkoutExpired: false, changes: decision.changes.slice() };
    const sets = [], vals = [];
    const set = (sql, ...v) => { sets.push(sql); vals.push(...v); };

    if (decision.adds.conference) set("selected_conference = 1, conference_status = 'pre-registered'");
    if (decision.adds.bridges) set("selected_bridges = 1, bridges_status = 'pre-registered'");

    if (decision.adds.gala) {
        // The seat. A linked gala row that is still a seat (not cancelled; a paid one never
        // reaches here) is reused, so the id every scanner and e-mail already knows stays
        // valid; otherwise a fresh row is minted with the same initial values the fresh path
        // writes ('awaiting_payment' / 'pending' — the gate did not hold this submission).
        let galaId = null;
        if (priorGala && String(priorGala.status || '') !== 'cancelled') {
            galaId = priorGala.id;
            db.run(`UPDATE gala_registrations
                       SET status = 'awaiting_payment', payment_status = COALESCE(NULLIF(payment_status, ''), 'pending'),
                           institution = COALESCE(NULLIF(?, ''), institution), dietary = COALESCE(NULLIF(?, ''), dietary),
                           needs_invoice = ?, invoice_details = ?
                     WHERE id = ?`,
                [form.institution || '', form.dietary || '', form.needsInvoice ? 1 : 0, form.invoiceDetailsJson || null, galaId]);
        } else {
            galaId = crypto.randomUUID();
            db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, dietary, requests, user_id, needs_invoice, invoice_details)
                    VALUES (?, ?, ?, ?, ?, 'awaiting_payment', 'pending', ?, ?, ?, ?, ?)`,
                [galaId, prior.first_name, prior.last_name || '', prior.email, form.institution || prior.institution || '',
                 form.dietary || prior.dietary || null, form.notes || null, linkedUserId || prior.user_id || null,
                 form.needsInvoice ? 1 : 0, form.invoiceDetailsJson || null]);
        }
        out.galaRegistrationId = galaId;
        set("selected_gala = 1, gala_status = 'awaiting_payment', gala_payment_status = 'pending', gala_registration_id = ?, stripe_session_id = NULL, needs_invoice = ?, invoice_details = ?",
            galaId, form.needsInvoice ? 1 : 0, form.invoiceDetailsJson || null);
    }

    if (decision.dropGala) {
        let dropped = true;
        if (priorGala && String(priorGala.status || '') !== 'cancelled') {
            // The SQL guards again: a seat that turned paid between the read and this write is
            // left alone, and then the CA leg is left alone too.
            db.run(`UPDATE gala_registrations SET status = 'cancelled'
                     WHERE id = ? AND COALESCE(payment_status, '') NOT IN ('paid', 'vip-comp', 'comp')
                       AND COALESCE(status, '') NOT IN ('confirmed', 'vip-comp', 'cancelled')`, [priorGala.id]);
            const after = query.get('SELECT status FROM gala_registrations WHERE id = ?', [priorGala.id]);
            dropped = !!after && String(after.status || '') === 'cancelled';
            if (dropped) {
                out.droppedGalaId = priorGala.id;
                const sessionId = priorGala.stripe_session_id || prior.stripe_session_id || null;
                if (sessionId && typeof expireCheckout === 'function') {
                    try { await expireCheckout(sessionId); out.checkoutExpired = true; }
                    catch (e) { log(`[CA resubmit] checkout ${sessionId} not expired (${e && e.message}) — it lapses on its own`); }
                }
            } else {
                log(`[CA resubmit] gala ${priorGala.id} turned paid mid-request — seat kept`);
                out.changes = out.changes.filter(c => c !== '-gala');
            }
        }
        if (dropped) set("selected_gala = 0, gala_status = 'cancelled'");
    }

    // Profile refresh — non-empty values only; identity (name, e-mail) untouched.
    set("institution = COALESCE(NULLIF(?, ''), institution)", form.institution || '');
    set("country = COALESCE(NULLIF(?, ''), country)", form.country || '');
    set("role = COALESCE(NULLIF(?, ''), role)", form.role || '');
    set("dietary = COALESCE(NULLIF(?, ''), dietary)", form.dietary || '');
    set('notes = ?', mergeNotes(prior.notes, form.notes, out.changes, dateIso));
    set('applied_for = ?', form.appliedFor || appliedFor(decision.legsAfter) || null);
    if (form.customAnswersJson) set('custom_answers = ?', form.customAnswersJson);
    if (form.inviteLinkId) set('invite_link_id = COALESCE(invite_link_id, ?), reg_link_token = COALESCE(reg_link_token, ?)', form.inviteLinkId, form.inviteLinkId);
    if (linkedUserId) set('user_id = COALESCE(user_id, ?)', linkedUserId);
    vals.push(prior.id);
    db.run(`UPDATE croatians_abroad_registrations SET ${sets.join(', ')} WHERE id = ?`, vals);
    return out;
}

/**
 * finishFree(deps, ctx) → the JSON body for a resubmission that added NO Gala seat.
 *   deps: { sendPreRegConfirmation, mirrorToSheets?, ticketPageUrl, galaTicketPageUrl, log? }
 *         sendPreRegConfirmation = the route's caSendPreRegConfirmation (ticket + guest copies)
 *         mirrorToSheets         = the route's caMirrorPreRegToSheets
 *   ctx:  { prior, decision, applied, base, regSource, sheet }
 *         sheet = { institution, country, role, dietary, notes, caAppliedFor, customAnswers, inviteLabel }
 * ONE-ticket doctrine (same as the approve handler and the covered branch): while a Gala seat
 * the person still wants is unpaid, no free-events QR goes out — the combined ticket after
 * payment is the ticket. Otherwise the ticket for every leg the row now holds is (re)sent,
 * the paid Gala riding along exactly as the covered branch sends it.
 */
async function finishFree(deps, { prior, decision, applied, base, regSource, sheet = {} }) {
    const { sendPreRegConfirmation, mirrorToSheets, ticketPageUrl, galaTicketPageUrl, log = () => {} } = deps;
    const legs = decision.legsAfter;
    const changes = (applied && applied.changes) || decision.changes;
    const addedFree = [decision.adds.conference ? 'conference' : null, decision.adds.bridges ? 'bridges' : null].filter(Boolean);
    // Sheet tabs for the legs added NOW only — the tabs already holding this person keep one row.
    if (addedFree.length && typeof mirrorToSheets === 'function') {
        try {
            mirrorToSheets({
                regId: prior.id, first_name: prior.first_name, last_name: prior.last_name, email: prior.email,
                institution: sheet.institution, country: sheet.country, role: sheet.role, dietary: sheet.dietary, notes: sheet.notes,
                events: addedFree, regSource, caAppliedFor: sheet.caAppliedFor, customAnswers: sheet.customAnswers, inviteLabel: sheet.inviteLabel || ''
            });
        } catch (e) { log('[CA resubmit] sheet mirror failed (non-blocking): ' + (e && e.message)); }
    }
    const added = addedFree.map(k => LEG_NAMES[k]).join(' and ');
    if (decision.galaUnpaidKept) {
        return {
            success: true, id: prior.id, status: 'awaiting_payment', updated: true, changes,
            message: (added ? `Your registration now also includes the ${added} — ` : 'You are already registered — ')
                + 'the Gala payment link in your email completes it.'
        };
    }
    const galaOnTicket = !!(legs.gala && decision.galaPaid && prior.gala_registration_id);
    await sendPreRegConfirmation({
        regId: prior.id, first_name: prior.first_name, last_name: prior.last_name, email: prior.email,
        finalConf: !!legs.conference, finalBridges: !!legs.bridges, finalGala: galaOnTicket, regSource
    });
    return {
        success: true, id: prior.id, status: 'pre-registered', updated: true, changes,
        ticket_url: galaOnTicket ? galaTicketPageUrl(base, prior.gala_registration_id) : ticketPageUrl(base, prior.id)
    };
}

module.exports = {
    RESUBMIT_MARKER,
    LEG_NAMES,
    galaIsPaid,
    appliedFor,
    mergeNotes,
    decide,
    apply,
    finishFree
};
