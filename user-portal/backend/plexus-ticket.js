/**
 * plexus-ticket.js — the ONE ticket design for Plexus Week 2026 (Alen 2026-09-15: "form the
 * email style just like we did for Building Bridges, with Apple/Google Wallet").
 *
 * Boston's "You are in" email is built by v2/email-templates.ticketConfirmation(): the light
 * cream shell (the dark one looked wrong on white Gmail), the ink header with the wordmark, a
 * facts card (EVENT · WHEN per leg · WHERE · GUEST · N° · TICKET · PRICE · DRESS CODE · TABLES),
 * the QR in a white card with the manual code, and under it the same three buttons — Add to
 * Apple Wallet · Add to Google Wallet · Add to calendar. Every Plexus ticket email is now that
 * exact builder with Plexus facts, so the family reads as one:
 *
 *   combined ticket      — a paid Zagreb registration (both webhook branches)
 *   gala guest entry     — a named guest's copy of the party ticket
 *   standalone gala      — a paid / comped gala seat with no free legs
 *   free-events entry    — the pre-registration confirmation (Conference / Bridges only)
 *
 * The same facts render the on-screen ticket pages (/gala/ticket, /plexus/ticket, the
 * institutional-confirmation page), so what a person sees the moment they finish is what
 * arrives by email. The QR is the hosted /qr/:id.png — byte-identical to what the doors scan.
 *
 * Pure: every collaborator (query, wallet links, base URL) is passed in; no email is sent here.
 */
'use strict';

const crypto = require('crypto');
const emailTemplates = require('./v2/email-templates');

const SUPPORT_EMAIL = 'laura.rodman@medx.hr';
const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------------------------------------------------------------- the legs (one source for dates/venues)
const LEG = {
    conference: { name: 'Plexus Conference', when: '4 December 2026', venue: 'Novinarski dom, Zagreb',
                  start: '20261204T090000', end: '20261204T180000' },
    bridges:    { name: 'Building Bridges Zagreb', when: '4 or 5 December 2026 · date and venue to be confirmed', venue: 'Zagreb',
                  start: '20261204T180000', end: '20261204T210000' },
    gala:       { name: 'Gala Evening', when: '5 December 2026 · 19:00 · arrival from 7:00 PM', venue: 'Hotel Esplanade, Zagreb',
                  start: '20261205T190000', end: '20261205T233000' }
};
const LEG_ORDER = ['conference', 'bridges', 'gala'];
const legNames = (legs, facts) => legs.map(l => (facts || LEG)[l].name);
const joinAnd = arr => arr.length > 1 ? arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1] : (arr[0] || '');
// People per leg: the registrant plus every guest whose ticks include that leg; the Gala figure is
// the billed seats (1 + guest_count). Guests may join any leg since 2026-09-16, so "2 Gala seats"
// alone no longer says who is coming where — the count sits in brackets after each event instead:
// "Plexus Conference (2 seats), Building Bridges Zagreb and Gala Evening (2 seats)".
function partyByLeg(legs, guests, seats) {
    const on = v => v === 1 || v === true || v === '1';
    const legsOfGuest = g => { const l = [on(g && g.conference) ? 'conference' : null, on(g && g.bridges) ? 'bridges' : null, on(g && g.gala) ? 'gala' : null].filter(Boolean); return l.length ? l : ['gala']; };
    const party = {};
    for (const l of legs || []) party[l] = l === 'gala' ? Math.max(1, Number(seats) || 1) : 1 + (guests || []).filter(g => legsOfGuest(g).includes(l)).length;
    return party;
}
const legNamesWithParty = (legs, facts, party) => legs.map(l => {
    const n = party && Number(party[l]);
    return (facts || LEG)[l].name + (n > 1 ? ` (${n} seats)` : '');
});

/**
 * The leg facts with the admin-editable dates/venues applied (plexus_settings: conference_venue,
 * conference_start_date, bridges_zagreb_date / _time / _venue). Anything unset keeps the default,
 * so a half-filled settings row never blanks a line. Returns a fresh map — LEG itself is constant.
 */
function legFacts(settings) {
    const st = settings || {};
    const f = JSON.parse(JSON.stringify(LEG));
    const longDate = d => { try { const dt = new Date(String(d).slice(0, 10) + 'T12:00:00'); return isNaN(dt) ? null : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return null; } };
    const compact = d => String(d).slice(0, 10).replace(/-/g, '');
    const hhmm = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? m[1].padStart(2, '0') + m[2] : null; };
    if (st.conference_venue) f.conference.venue = String(st.conference_venue).trim();
    if (st.conference_start_date && longDate(st.conference_start_date)) {
        f.conference.when = longDate(st.conference_start_date);
        f.conference.start = compact(st.conference_start_date) + 'T090000';
        f.conference.end = compact(st.conference_start_date) + 'T180000';
    }
    if (st.bridges_zagreb_venue) f.bridges.venue = String(st.bridges_zagreb_venue).trim();
    if (st.bridges_zagreb_date && longDate(st.bridges_zagreb_date)) {
        const t = hhmm(st.bridges_zagreb_time);
        f.bridges.when = longDate(st.bridges_zagreb_date) + (t ? ` · ${t.slice(0, 2)}:${t.slice(2)}` : '');
        f.bridges.start = compact(st.bridges_zagreb_date) + 'T' + (t || '1800') + '00';
        const endH = Math.min(23, Number((t || '1800').slice(0, 2)) + 3);
        f.bridges.end = compact(st.bridges_zagreb_date) + 'T' + String(endH).padStart(2, '0') + (t || '1800').slice(2) + '00';
        f.bridges.confirmed = true;
    }
    return f;
}

/** The WHEN lines the facts card prints — the event name before " — " renders bold. */
const whenLinesFor = (legs, facts) => { const F = facts || LEG; return legs.map(l => `${F[l].name} — ${F[l].when}${(l === 'bridges' && !F[l].confirmed) ? '' : ' · ' + F[l].venue}`); };
const whereFor = (legs, facts) => legs.length === 1 ? (facts || LEG)[legs[0]].venue : 'Zagreb, Croatia';

// ---------------------------------------------------------------- calendar (.ics), per legs held
function icsFor(legs, facts) {
    const LEG = facts || module.exports.LEG;   // the admin-set dates when given
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const escIcs = s => String(s || '').replace(/([,;\\])/g, '\\$1');
    const events = legs.filter(l => LEG[l]).map(l => [
        'BEGIN:VEVENT',
        `UID:medx-plexus-week-2026-${l}@medx.hr`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Europe/Zagreb:${LEG[l].start}`,
        `DTEND;TZID=Europe/Zagreb:${LEG[l].end}`,
        `SUMMARY:${escIcs('Plexus Week 2026 — ' + LEG[l].name)}`,
        `LOCATION:${escIcs(LEG[l].venue)}`,
        `DESCRIPTION:${escIcs(l === 'bridges' && !LEG[l].confirmed ? 'Date and venue to be confirmed — we will email you.' : 'Your entry QR is in your ticket email and wallet pass.')}`,
        'STATUS:CONFIRMED', 'END:VEVENT'
    ].join('\r\n'));
    return [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Med&X//Plexus Week 2026//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VTIMEZONE', 'TZID:Europe/Zagreb',
        'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZNAME:CET', 'END:STANDARD',
        'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZNAME:CEST', 'END:DAYLIGHT',
        'END:VTIMEZONE',
        ...events,
        'END:VCALENDAR'
    ].join('\r\n');
}
const calendarUrl = (base, legs) => `${base}/plexus.ics?legs=${encodeURIComponent(legs.join(','))}`;
function parseLegs(raw) {
    const want = String(raw || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const legs = LEG_ORDER.filter(l => want.includes(l));
    return legs.length ? legs : LEG_ORDER.slice();
}

// ---------------------------------------------------------------- the email family
/**
 * One ticket email. `kind`: 'combined' | 'gala-guest' | 'gala' | 'free'.
 * f = { firstName, fullName, legs, seats, amount, invoice, seat, guestOf, qrPngUrl, wallet:{apple,google},
 *       calendarUrl, partyNote, guestsHtml, source }
 */
function ticketEmail(kind, f) {
    const F = f.facts || LEG;                     // admin-set dates/venues, when the caller has them
    const legs = (f.legs || []).filter(l => F[l]);
    const hasGala = legs.includes('gala');
    const seats = Math.max(1, Number(f.seats) || 1);
    const paid = Number(f.amount) || 0;
    const names = legNames(legs, F);
    const freeLegs = legs.filter(l => l !== 'gala');
    const first = esc(f.firstName || 'there');
    const eventName = kind === 'gala' || kind === 'gala-guest' ? 'Plexus Week 2026 — Gala Evening' : 'Plexus Week 2026 — Zagreb';

    let headlineHtml, introHtml, ticketLabel, priceLabel = null, kicker, subjectTitle, preheader;
    if (kind === 'combined') {
        headlineHtml = 'Plexus Week 2026 — you are <i>in</i>.';
        introHtml = `Dear ${first} — your payment of <b>&euro;${paid.toFixed(2)}</b> has been received and your registration is confirmed for ${esc(joinAnd(legNamesWithParty(legs, F, f.party || { gala: seats })))}. Med&amp;X looks forward to welcoming you ${f.source === 'plexus' ? 'to Plexus Week 2026' : 'home'} in Zagreb.`;
        ticketLabel = [freeLegs.length ? `${legNames(freeLegs, F).join(' + ')} — free` : null, `Gala Evening — ${seats} seat${seats === 1 ? '' : 's'}, paid`].filter(Boolean).join(' · ');
        priceLabel = `€${paid.toFixed(2)} paid${f.invoice ? ` · invoice ${f.invoice}` : ''}`;
        subjectTitle = 'Your ticket — Plexus Week 2026';
        preheader = `Payment received — your Plexus Week 2026 ticket, QR and wallet passes are inside.`;
    } else if (kind === 'gala-guest') {
        headlineHtml = 'Gala Evening — you are <i>in</i>.';
        introHtml = `Dear ${first} — <b>${esc(f.guestOf || 'your host')}</b> has registered you as their guest for the Plexus Week 2026 Gala Evening. Your seat is paid for, and the QR below admits your whole party, arriving together or separately.`;
        ticketLabel = `Guest of ${f.guestOf || 'the registrant'} · Gala seat, paid`;
        subjectTitle = 'Your Gala Evening entry — Plexus Week 2026';
        preheader = `${f.guestOf || 'Your host'} registered you for the Gala Evening — your entry QR and wallet passes are inside.`;
    } else if (kind === 'gala') {
        headlineHtml = 'Gala Evening — you are <i>in</i>.';
        introHtml = `Dear ${first} — ${paid > 0 ? `your payment of <b>&euro;${paid.toFixed(2)}</b> has been received and` : 'your seat is confirmed and'} your place at the Plexus Week 2026 Gala Evening is secured${seats > 1 ? ` — <b>${seats} seats</b>` : ''}. We look forward to welcoming you at the Hotel Esplanade.`;
        ticketLabel = `Gala Evening — ${seats} seat${seats === 1 ? '' : 's'}${paid > 0 ? ', paid' : ' · complimentary'}`;
        priceLabel = paid > 0 ? `€${paid.toFixed(2)} paid${f.invoice ? ` · invoice ${f.invoice}` : ''}` : null;
        subjectTitle = 'Your Gala Evening ticket — Plexus Week 2026';
        preheader = 'Your Gala Evening seat is confirmed — your entry QR and wallet passes are inside.';
    } else { // free
        headlineHtml = 'Plexus Week 2026 — you are <i>in</i>.';
        introHtml = f.guestOf
            ? `Dear ${first} — <b>${esc(f.guestOf)}</b> has registered you as their guest for ${esc(joinAnd(names))} at Plexus Week 2026 in Zagreb. Your place is confirmed and there is nothing to pay.`
            : `Dear ${first} — your registration for ${esc(joinAnd(legNamesWithParty(legs, F, f.party || {})))} at Plexus Week 2026 in Zagreb is confirmed. There is nothing to pay — bring the QR below.`;
        ticketLabel = f.guestOf ? `Guest of ${f.guestOf} · ${names.join(' + ')} — free` : `${names.join(' + ')} — free`;
        kicker = "YOU'RE IN";
        subjectTitle = f.guestOf ? 'Your Plexus Week 2026 entry' : "You're pre-registered — Plexus Week 2026";
        preheader = 'Your Plexus Week 2026 registration is confirmed — your entry QR and wallet passes are inside.';
    }

    const noteParts = [];
    if (f.partyNote) noteParts.push(esc(f.partyNote));
    noteParts.push(hasGala
        ? 'Present the QR above at the door of each event you hold — it admits your party at the Conference and Building Bridges, and your seats at the Gala. The same ticket lives in the wallet passes.'
        : 'Present the QR above at the door — it admits you at the events you registered for. The same ticket lives in the wallet passes.');
    if (freeLegs.length && kind !== 'gala-guest' && !f.programAttached) {
        const pending = [freeLegs.includes('conference') ? 'the <b>Conference program</b>' : null, (freeLegs.includes('bridges') && !F.bridges.confirmed) ? 'the <b>Building Bridges date and venue</b>' : null].filter(Boolean);
        if (pending.length) noteParts.push(`We will email you ${pending.join(' and ')} as soon as ${pending.length > 1 ? 'they are' : 'it is'} finalized.`);
    }
    if (f.programAttached) noteParts.push('Your <b>program</b> is attached to this email as a PDF.');
    if (f.extraNote) noteParts.push(f.extraNote);
    if (kind === 'free' && !f.guestOf) {
        noteParts.push('Would you also like to join the <b>Gala Evening</b> (5 December 2026, Hotel Esplanade)? Just reply to this email and we will send you the ticket link.');
    }

    return emailTemplates.ticketConfirmation({
        firstName: f.firstName, eventName,
        headlineHtml: f.headlineHtml || headlineHtml, introHtml: f.introHtml || introHtml, kicker: f.kicker || kicker,
        whenLines: whenLinesFor(legs, F), venue: whereFor(legs, F),
        passUrl: f.ctaUrl || undefined, ctaLabel: f.ctaLabel || undefined,
        guestLabel: f.fullName, ticketNumber: f.invoice || (f.ticketCode || ''),
        ticketLabel, priceLabel,
        dressLabel: hasGala ? (legs.length > 1 ? 'Gala Evening: black tie' : 'Black tie') : null,
        tableLabel: hasGala ? (f.seat ? `Table ${f.seat}` : 'Assigned closer to the Gala — shown at the door') : null,
        qrPngUrl: f.qrPngUrl,
        appleWalletUrl: f.wallet && f.wallet.apple, walletSaveUrl: f.wallet && f.wallet.google,
        calendarUrl: f.calendarUrl,
        extraHtml: f.guestsHtml || '',
        note: noteParts.join('<br><br>'),
        replyLine: `Questions? Laura Rodman — <a href="mailto:${SUPPORT_EMAIL}" style="color:#6f6256;">${SUPPORT_EMAIL}</a>.`,
        headerRightLabel: 'PLEXUS WEEK 2026 · ZAGREB',
        subjectTitle: f.subjectTitle || subjectTitle, preheader: f.preheader || preheader
    });
}

// A guest's legs from the per-event flags on ca_registration_guests (2026-09-16). Rows written
// before the flags existed were gala-only by definition (the form offered guests for the Gala
// alone) — the boot backfill stamps gala=1 on them, and this falls back to it as well.
function guestLegs(g) {
    const on = v => v === 1 || v === true || v === '1';
    const legs = [on(g && g.conference) ? 'conference' : null, on(g && g.bridges) ? 'bridges' : null, on(g && g.gala) ? 'gala' : null].filter(Boolean);
    return legs.length ? legs : ['gala'];
}
const guestEvents = g => guestLegs(g).map(l => LEG[l].name);

// The guests block under the facts card (who joins which event, and whether they got their own copy).
function guestsHtml(guests, eventsOf) {
    const rows = (guests || []).filter(g => g && (g.name || g.email));
    if (!rows.length) return '';
    if (!eventsOf) eventsOf = guestEvents;
    const T = emailTemplates.T;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid rgba(201,169,98,.45);background:${T.cardCream};"><tr><td style="padding:12px 18px;">
        <div style="font-family:${T.sans};font-weight:600;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:${T.goldDark};">Your guests</div>
        ${rows.map(g => `<div style="font-family:${T.sans};font-size:13.5px;line-height:1.6;color:${T.ink};margin-top:10px;padding-top:10px;border-top:1px solid rgba(201,169,98,.3);">
            <b>${esc(g.name || g.email)}</b> <span style="color:${T.soft};">&middot; ${esc((eventsOf ? eventsOf(g) : ['Gala Evening']).join(', '))}</span>
            <div style="margin-top:3px;font-size:13px;color:${g.email ? T.ink : T.goldDark};">${g.email
                ? `&#10003; Their own ticket was emailed to <b>${esc(g.email)}</b>.`
                : `<b>No email on file for this guest.</b> Your QR admits them too &mdash; please forward this email to them.`}</div>
          </div>`).join('')}
    </td></tr></table>`;
}

// ---------------------------------------------------------------- the on-screen ticket page
const pageSig = (secret, kind, id) => crypto.createHmac('sha256', String(secret)).update(`plexus-ticket-page:${kind}:${id}`).digest('hex').slice(0, 32);
// /gala/ticket keeps its original context (Stripe success_urls already minted carry it).
const galaPageSig = (secret, id) => crypto.createHmac('sha256', String(secret)).update('gala-ticket-page:' + String(id)).digest('hex').slice(0, 32);
const safeEq = (a, b) => { try { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; } };

/**
 * The page a person sees the moment their registration is complete — the email's twin.
 * p = { state:'ticket'|'pending', headline, sub, fullName, legs, party:{conference,bridges,gala}, seats,
 *       invoice, seat, ticketCode, qrPngUrl, wallet, calendarUrl, guests, emailTo, kicker }
 */
function ticketPageHtml(p) {
    const LEG = p.facts || module.exports.LEG;
    const legs = (p.legs || []).filter(l => LEG[l]);
    const party = p.party || {};
    const plus = n => n > 1 ? ` · you + ${n - 1} guest${n - 1 === 1 ? '' : 's'}` : '';
    const legRow = (l, last) => `<tr><td style="padding:12px 14px;${last ? '' : 'border-bottom:1px solid rgba(25,21,18,.1);'}">
        <span style="font-weight:600;font-size:14px;color:#191512;">${LEG[l].name}</span>
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#1e6e42;margin-left:8px;">${l === 'gala' ? (p.state === 'ticket' ? 'CONFIRMED &amp; PAID' + ((p.seats || 1) > 1 ? ' · ' + p.seats + ' SEATS' : '') : 'FINALIZING') : 'CONFIRMED'}</span>
        <div style="font-size:12px;color:#6e6455;margin-top:3px;">${esc(LEG[l].when)}${(l === 'bridges' && !LEG[l].confirmed) ? '' : ' · ' + esc(LEG[l].venue)}${esc(plus(party[l] || 0))}</div></td></tr>`;
    const w = p.wallet || {};
    const b = (href, label, skin) => `<a href="${esc(href)}" style="display:block;margin:10px auto 0;max-width:280px;padding:12px 18px;background:${skin === 'ink' ? '#241d18' : skin === 'gold' ? '#c9a962' : 'transparent'};border:1px solid ${skin === 'ghost' ? 'rgba(25,21,18,.3)' : 'transparent'};color:${skin === 'ink' ? '#f7f1e6' : skin === 'gold' ? '#191512' : '#3a322b'};font:600 12.5px Inter,sans-serif;letter-spacing:.4px;text-decoration:none;text-align:center;">${label}</a>`;
    const buttons = [w.apple ? b(w.apple, 'Add to Apple Wallet →', 'ink') : '', w.google ? b(w.google, 'Add to Google Wallet →', 'gold') : '', p.calendarUrl ? b(p.calendarUrl, 'Add to calendar →', 'ghost') : ''].join('');
    const guests = (p.guests || []).filter(g => g && (g.name || g.email));
    const guestsBlock = guests.length ? `<div class="sheet"><p class="slabel">Your guests</p>
        ${guests.map(g => `<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid rgba(201,169,98,.3);font-size:14px;line-height:1.55;color:#191512;"><b>${esc(g.name || g.email)}</b> <span style="color:#6e6455;">&middot; ${esc((g.events || ['Gala Evening']).join(', '))}</span><span style="display:block;margin-top:3px;font-size:13px;color:${g.email ? '#191512' : '#6e5626'};">${g.email ? '&#10003; Their own ticket was emailed to <b>' + esc(g.email) + '</b>.' : '<b>No email on file for this guest.</b> Your QR admits them too &mdash; please forward your ticket email to them.'}</span></p>`).join('')}</div>` : '';
    const ticketCard = p.state === 'ticket' ? `
      <div class="sheet" style="text-align:center;">
        <p class="slabel">Your ticket for the door</p>
        <span style="display:inline-block;background:#fff;border:1px solid rgba(25,21,18,.12);padding:10px;"><img src="${esc(p.qrPngUrl)}" alt="Your entry QR code" width="200" height="200" style="display:block;border:0;"></span>
        <p style="margin:12px 0 0;font:600 10px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8a7d6c;">${esc(p.fullName)} &middot; N&deg; ${esc(p.invoice || p.ticketCode || '')}${p.ticketCode && p.invoice ? ' &middot; code ' + esc(p.ticketCode) : ''}</p>
        <p style="margin:8px 0 0;font-size:12.5px;color:#8a7d6c;">${(p.seats || 1) > 1 ? `One QR admits your whole party — ${p.seats} Gala seats` : 'Save it to your photos, or add it to your phone below'}.</p>
        ${buttons ? `<div style="margin-top:14px;">${buttons}</div>` : ''}
      </div>` : '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${p.state === 'pending' ? '<meta http-equiv="refresh" content="5">' : ''}
<title>${esc(p.headline)} — Plexus Week 2026 · Med&X</title>
<meta name="robots" content="noindex, nofollow"><link rel="icon" type="image/png" href="/assets/favicon-x.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{min-height:100vh;font-family:Inter,-apple-system,system-ui,sans-serif;background:#f7f1e6;color:#191512;-webkit-font-smoothing:antialiased;}
.band{background:#1b1613;color:#f3ece0;text-align:center;padding:clamp(38px,7vw,58px) 22px clamp(56px,8vw,72px);}
.band img.logo{height:30px;width:auto;filter:brightness(0) invert(1);opacity:.95;}
.kicker{margin-top:22px;font:600 11px Inter,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#c9a962;}
.band h1{margin-top:12px;font-family:Fraunces,Georgia,serif;font-weight:500;font-size:clamp(27px,6.4vw,38px);line-height:1.14;letter-spacing:-.4px;color:#f7f1e6;}
.band h1 i{font-style:italic;font-weight:400;color:#c9a962;}
.band p.sub{margin:14px auto 0;max-width:520px;font-size:14px;line-height:1.7;color:rgba(243,236,224,.85);}
main{max-width:640px;margin:0 auto;padding:0 16px 56px;}
.sheet{background:#fdfaf3;border:1px solid rgba(201,169,98,.45);padding:clamp(24px,5vw,36px) clamp(20px,4.6vw,34px);margin-top:22px;box-shadow:0 22px 55px -30px rgba(25,21,18,.35);}
.sheet:first-child{margin-top:-34px;position:relative;}
.slabel{font:600 10.5px Inter,sans-serif;letter-spacing:2.4px;text-transform:uppercase;color:#6e5626;margin-bottom:14px;}
table.res{width:100%;border-collapse:collapse;border:1px solid rgba(25,21,18,.1);}
.foot{text-align:center;font-size:12px;color:#94897c;padding:26px 18px 40px;line-height:1.9;}
.foot a{color:#9b1b22;font-weight:600;text-decoration:none;}
</style></head><body>
<header class="band">
  <img class="logo" src="/assets/images/medx-logo.png" alt="Med&amp;X" onerror="this.outerHTML='<div style=&quot;font-weight:800;font-size:22px;color:#f7f1e6;&quot;>med&amp;<span style=&quot;color:#c9a962;&quot;>x</span></div>'">
  <p class="kicker">${esc(p.kicker || 'Plexus Week 2026 · Zagreb')}</p>
  <h1>${p.headline}</h1>
  <p class="sub">${p.sub}</p>
</header>
<main>
  <div class="sheet">
    <p class="slabel">Your Plexus Week 2026 reservations</p>
    <table class="res">${legs.map((l, i) => legRow(l, i === legs.length - 1)).join('')}</table>
  </div>
  ${ticketCard}
  ${guestsBlock}
</main>
<footer class="foot">Questions? Laura Rodman (<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>)<br><a href="https://medx.hr">www.medx.hr</a></footer>
</body></html>`;
}

module.exports = {
    LEG, LEG_ORDER, legFacts, legNames, legNamesWithParty, partyByLeg, whenLinesFor, whereFor, joinAnd,
    icsFor, calendarUrl, parseLegs,
    ticketEmail, guestsHtml, guestLegs, guestEvents,
    pageSig, galaPageSig, safeEq, ticketPageHtml
};
