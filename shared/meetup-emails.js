/**
 * shared/meetup-emails.js — the eight Plexus Week MEETUP emails, one builder each.
 *
 * PURE functions: plain params in, one full HTML document out. No DB, no ctx, no network —
 * so both backends (member `v2/meetups.js`, admin `v2/meetups-ops.js`) render byte-identical
 * mail and the tests can assert on the strings without a server.
 *
 * House style (design/MEETUPS-SPEC.md §3 "Emails"): the espresso/cappuccino DARK shell —
 * tpl.shell({ tone:'dark' }) + tpl.btn — the same single look the review-gate emails use, because
 * dark backgrounds pass through Outlook/Gmail dark transforms untouched. Registrant voice, warm,
 * never the "Building Bridges evening" phrasing, "all three events" rather than "evenings".
 *
 * EVERY attendee email carries the manage/cancel link (the spec's "hey, you can cancel here"),
 * and a recipient with no Med&X account gets the one-line signup nudge.
 *
 *   joinedConfirmed · waitlisted · promoted · invited · cancelledByYou
 *   meetupCancelled · reminder · hostFyi
 *
 * The shell lives in the member portal's template library (user-portal/backend/v2/email-templates.js
 * — the house brand, already required by boston.js and review-gate.js). It is loaded lazily and
 * defensively: a checkout without it degrades to a plain readable document instead of crashing a
 * module mount.
 */
'use strict';

let _tpl = null;
function tpl() {
    if (_tpl) return _tpl;
    try { _tpl = require('../user-portal/backend/v2/email-templates'); }
    catch (e) { _tpl = null; }
    return _tpl;
}

// Espresso tokens — identical to review-gate.js DT (one look across every gate/meetup email).
const DT = {
    ink: '#f2e7d6',
    soft: '#d3c5b2',
    gold: '#d7b56c',
    hair: 'rgba(240,228,210,.18)',
    factBg: '#342718',
    factBorder: 'rgba(240,228,210,.16)'
};
const FONTS = { serif: "Fraunces,Georgia,'Times New Roman',serif", sans: "Inter,Helvetica,Arial,sans-serif" };

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escUrl(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^(https?:|\/)/i.test(s)) return '#';
    return esc(s);
}
const T = () => (tpl() ? tpl().T : FONTS);
function btn(label, href, kind, extra) {
    const t = tpl();
    if (t) return t.btn(label, href, kind, extra);
    return `<a href="${escUrl(href)}" style="display:inline-block;padding:14px 30px;background:#a8232b;color:#fff7ea;font-family:${FONTS.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;">${label}</a>`;
}

// ---------------------------------------------------------------- the one body shell
// Eyebrow · Fraunces headline · body copy · optional facts card · one primary button ·
// optional secondary links · the manage line · a warm sign-off.
function meetupShell({ eyebrow, headline, bodyHtml, facts, buttonLabel, buttonUrl, extraHtml, footNote, preheader, title, rule, headerRightLabel, footerItems }) {
    const t = T();
    const factsHtml = (facts && facts.length) ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-fact" style="margin-top:16px;background:${DT.factBg};border:1px solid ${DT.factBorder};"><tr><td style="padding:4px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${facts.map(([label, value], i) => {
            const sep = i ? `border-top:1px solid ${DT.hair};` : '';
            return `<tr>
              <td class="em-goldlab em-hair" style="${sep}padding:9px 14px 9px 0;font-family:${t.sans};font-weight:600;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:${DT.gold};vertical-align:middle;white-space:nowrap;">${esc(label)}</td>
              <td class="em-ink em-hair" style="${sep}padding:9px 0;font-family:${t.sans};font-size:12.5px;line-height:1.45;color:${DT.ink};word-break:break-word;">${esc(value)}</td>
            </tr>`;
        }).join('\n')}
        </table>
      </td></tr></table>` : '';
    const noteHtml = footNote ? `<div class="em-soft" style="font-family:${t.sans};font-size:12px;line-height:1.65;color:${DT.soft};margin-top:14px;">${footNote}</div>` : '';
    const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:36px 40px 32px;">
      <div class="em-goldlab" style="font-family:${t.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${DT.gold};">${esc(eyebrow || 'Plexus Week')}</div>
      <div class="em-ink" style="font-family:${t.serif};font-weight:500;font-size:27px;line-height:1.18;letter-spacing:-.01em;color:${DT.ink};margin-top:10px;">${headline}</div>
      <div class="em-soft" style="font-family:${t.sans};font-size:14px;line-height:1.7;color:${DT.soft};margin-top:16px;">${bodyHtml}</div>${factsHtml}
      ${(buttonLabel && buttonUrl) ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px;">${btn(buttonLabel, buttonUrl, 'solid', 'width:300px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;background:#a8232b;')}</td></tr></table>` : ''}
      ${extraHtml || ''}${noteHtml}
      <div class="em-soft em-hair" style="margin-top:24px;padding-top:14px;border-top:1px solid ${DT.hair};font-family:${t.sans};font-size:11.5px;line-height:1.7;color:${DT.soft};">Questions? Just reply to this email — or write to Laura Rodman at laura.rodman@medx.hr.</div>
    </td></tr></table>`;
    const t2 = tpl();
    const opts = {
        tone: 'dark',
        title: title || (String(headline).replace(/<[^>]+>/g, '') + ' — Med&X'),
        preheader: preheader || '',
        headerRightLabel: headerRightLabel || 'PLEXUS WEEK · MEETUPS',
        rule: rule || 'gold',
        bodyHtml: body,
        footerItems: footerItems
    };
    if (t2) return t2.shell(opts);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title)}</title></head>
<body style="margin:0;background:#120e0a;"><table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="600" style="max-width:600px;background:#291e14;">${body}</table></td></tr></table></body></html>`;
}

// ---------------------------------------------------------------- shared fragments
const KIND_WORD = {
    coffee: 'a coffee', lunch: 'lunch', dinner: 'dinner',
    walk: 'a walk', visit: 'a visit', other: 'a get-together'
};
function kindWord(kind) { return KIND_WORD[String(kind || '').toLowerCase()] || KIND_WORD.other; }

/** "Cancel or manage your place" — the line every attendee email carries. */
function manageLine(manageUrl, label) {
    if (!manageUrl) return '';
    const t = T();
    return `<div class="em-soft" style="font-family:${t.sans};font-size:12px;line-height:1.65;color:${DT.soft};margin-top:18px;">
      ${esc(label || 'Plans change — you can')} <a href="${escUrl(manageUrl)}" style="color:${DT.gold};text-decoration:underline;">${esc(label ? 'manage your place here' : 'cancel your place here')}</a>, any time. Letting us know early hands the seat to someone on the waitlist.
    </div>`;
}
/** Non-members get one warm line, never a second ask. */
function signupNudge(signupUrl, isMember) {
    if (isMember || !signupUrl) return '';
    const t = T();
    return `<div class="em-soft" style="font-family:${t.sans};font-size:12px;line-height:1.65;color:${DT.soft};margin-top:12px;">
      Prefer everything in one place? <a href="${escUrl(signupUrl)}" style="color:${DT.gold};text-decoration:underline;">Create your Med&amp;X account</a> and your meetups, tickets and passes all live on one page.
    </div>`;
}
/** The wallet / calendar stack, one width, stacked for narrow clients. */
function assetStack({ applePassUrl, walletSaveUrl, calendarUrl }) {
    const rows = [];
    const W = 'width:260px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;';
    if (applePassUrl) rows.push(`<tr><td align="center" style="padding:0 0 10px;">${btn('ADD TO APPLE WALLET →', applePassUrl, 'ink', W)}</td></tr>`);
    if (walletSaveUrl) rows.push(`<tr><td align="center" style="padding:0 0 10px;">${btn('ADD TO GOOGLE WALLET →', walletSaveUrl, 'gold', W)}</td></tr>`);
    if (calendarUrl) rows.push(`<tr><td align="center" style="padding:0 0 10px;">${btn('ADD TO CALENDAR →', calendarUrl, 'ghost', W)}</td></tr>`);
    if (!rows.length) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;"><tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr></table>`;
}
/** The entry QR, hosted as a PNG (Gmail strips data: URIs — the hosted image is load-bearing). */
function qrBlock(qrPngUrl, altCode) {
    if (!qrPngUrl) return '';
    const t = T();
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td align="center">
      <img src="${escUrl(qrPngUrl)}" alt="Your meetup code" width="150" height="150" style="display:block;border:6px solid #fdfaf3;background:#fdfaf3;width:150px;height:150px;">
      ${altCode ? `<div style="font-family:${t.sans};font-size:10px;letter-spacing:.16em;color:${DT.gold};margin-top:8px;text-transform:uppercase;">${esc(altCode)}</div>` : ''}
    </td></tr></table>`;
}
function factRows({ meetup, hostLine, seatLine }) {
    const m = meetup || {};
    const facts = [];
    if (m.whenLabel) facts.push(['When', m.whenLabel]);
    if (m.venue_name) facts.push(['Where', [m.venue_name, m.venue_address].filter(Boolean).join(' · ')]);
    if (hostLine) facts.push(['Host', hostLine]);
    if (seatLine) facts.push(['Your place', seatLine]);
    return facts;
}

// ================================================================ 01 · JOINED — CONFIRMED
function joinedConfirmed(p = {}) {
    const m = p.meetup || {};
    const name = esc(p.firstName || 'there');
    const title = esc(m.title || 'a Plexus Week meetup');
    return meetupShell({
        eyebrow: 'You are in',
        headline: `Your place is held, <i>${name}</i>.`,
        preheader: `${m.title || 'Your meetup'} — your place is confirmed.`,
        bodyHtml: `<p style="margin:0 0 10px;">You have a place at <b class="em-ink" style="color:${DT.ink};">${title}</b> during Plexus Week.</p>
                   <p style="margin:0;">Small table, real conversation — that is the whole idea. Bring your questions; ${esc(p.hostFirstName || 'your host')} is looking forward to it.</p>`,
        facts: factRows({ meetup: m, hostLine: p.hostLine, seatLine: p.seatLine || 'Confirmed' }),
        extraHtml: qrBlock(p.qrPngUrl, p.shortCode) + assetStack(p) + manageLine(p.manageUrl) + signupNudge(p.signupUrl, p.isMember),
        footNote: p.note || null,
        headerRightLabel: 'PLEXUS WEEK · MEETUPS',
        rule: 'gold'
    });
}

// ================================================================ 02 · WAITLISTED
function waitlisted(p = {}) {
    const m = p.meetup || {};
    const name = esc(p.firstName || 'there');
    const pos = Number(p.position) || 1;
    const ord = pos === 1 ? 'first in line' : `number ${pos} in line`;
    return meetupShell({
        eyebrow: 'On the waitlist',
        headline: `You are ${esc(ord)}, <i>${name}</i>.`,
        preheader: `${m.title || 'The meetup'} is full — you are ${ord}.`,
        bodyHtml: `<p style="margin:0 0 10px;">Every place at <b class="em-ink" style="color:${DT.ink};">${esc(m.title || 'this meetup')}</b> is taken for now, so we have put you on the waitlist.</p>
                   <p style="margin:0;">These tables move — people's plans change during the week. If a place opens, the first person in line gets it automatically, and we write to you the moment it is yours.</p>`,
        facts: factRows({ meetup: m, hostLine: p.hostLine, seatLine: `Waitlist · ${ord}` }),
        extraHtml: manageLine(p.manageUrl, 'If you would rather not wait, you can') + signupNudge(p.signupUrl, p.isMember),
        rule: 'crimson'
    });
}

// ================================================================ 03 · PROMOTED FROM THE WAITLIST
function promoted(p = {}) {
    const m = p.meetup || {};
    const name = esc(p.firstName || 'there');
    return meetupShell({
        eyebrow: 'A place opened',
        headline: `You are in, <i>${name}</i>.`,
        preheader: `A place opened at ${m.title || 'the meetup'} — it is yours.`,
        bodyHtml: `<p style="margin:0 0 10px;">Good news: a place opened at <b class="em-ink" style="color:${DT.ink};">${esc(m.title || 'the meetup')}</b> and it went to you — you were next in line.</p>
                   <p style="margin:0;">Nothing else to do. Your code is below, and it also lives in your wallet.</p>`,
        facts: factRows({ meetup: m, hostLine: p.hostLine, seatLine: 'Confirmed — moved up from the waitlist' }),
        extraHtml: qrBlock(p.qrPngUrl, p.shortCode) + assetStack(p) + manageLine(p.manageUrl) + signupNudge(p.signupUrl, p.isMember),
        rule: 'gold'
    });
}

// ================================================================ 04 · INVITATION (invite-only)
function invited(p = {}) {
    const m = p.meetup || {};
    const name = esc(p.firstName || 'there');
    const t = T();
    const kw = kindWord(m.kind);
    const hostName = esc(p.hostName || 'one of our hosts');
    const buttons = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:0 0 10px;">${btn('YES, I WOULD LOVE TO →', p.acceptUrl, 'solid', 'width:280px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;background:#a8232b;')}</td></tr>
        <tr><td align="center">${btn("I CAN'T MAKE IT", p.declineUrl, 'ghost', 'width:280px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;')}</td></tr>
      </table></td></tr></table>`;
    return meetupShell({
        eyebrow: 'An invitation',
        headline: `Would you join ${hostName} for ${esc(kw)}?`,
        preheader: `${p.hostName || 'A Plexus Week host'} would like you at ${m.title || 'a small meetup'}.`,
        bodyHtml: `<p style="margin:0 0 10px;">Dear ${name},</p>
                   <p style="margin:0 0 10px;">During Plexus Week, ${hostName} is hosting <b class="em-ink" style="color:${DT.ink};">${esc(m.title || 'a small meetup')}</b> — ${esc(kw)} with a handful of people, no panel, no slides.</p>
                   <p style="margin:0;">${esc(m.description || 'Just good conversation, and the time to have it.')}</p>`,
        facts: factRows({ meetup: m, hostLine: p.hostLine, seatLine: m.capacity ? `${m.capacity} places in total` : null }),
        extraHtml: buttons + `<div class="em-soft" style="font-family:${t.sans};font-size:12px;line-height:1.65;color:${DT.soft};margin-top:16px;">Either answer is welcome — one tap and we will know.</div>` + signupNudge(p.signupUrl, p.isMember),
        rule: 'gold'
    });
}

// ================================================================ 05 · YOUR PLACE IS RELEASED
// Two voices, one builder: a receipt when the person cancelled it themselves, and a plain notice
// when an organizer released it for them — the thank-you would read strangely in that case.
function cancelledByYou(p = {}) {
    const m = p.meetup || {};
    const name = esc(p.firstName || 'there');
    const byOrganizer = !!p.byOrganizer;
    const elsewhere = p.browseUrl
        ? `there are usually a few places left elsewhere in the week — <a href="${escUrl(p.browseUrl)}" style="color:${DT.gold};text-decoration:underline;">have a look</a>.`
        : 'write to us and we will see what is still open.';
    return meetupShell({
        eyebrow: byOrganizer ? 'A change to your place' : 'Cancelled',
        headline: `Your place is released, <i>${name}</i>.`,
        preheader: `You are no longer on the list for ${m.title || 'the meetup'}.`,
        bodyHtml: byOrganizer
            ? `<p style="margin:0 0 10px;">One of the organizers has released your place at <b class="em-ink" style="color:${DT.ink};">${esc(m.title || 'the meetup')}</b>${p.reason ? `: ${esc(p.reason)}` : '.'} Nothing is owed and nothing is needed from you.</p>
               <p style="margin:0;">If that was not what you expected, just reply to this email and we will put it right. Otherwise, ${elsewhere}</p>`
            : `<p style="margin:0 0 10px;">You are off the list for <b class="em-ink" style="color:${DT.ink};">${esc(m.title || 'the meetup')}</b>, and the place has gone to the next person waiting. Thank you for telling us — that is exactly how it should work.</p>
               <p style="margin:0;">If your plans change again, ${elsewhere}</p>`,
        facts: factRows({ meetup: m, hostLine: p.hostLine }),
        rule: 'crimson'
    });
}

// ================================================================ 06 · THE MEETUP WAS CANCELLED
function meetupCancelled(p = {}) {
    const m = p.meetup || {};
    const name = esc(p.firstName || 'there');
    return meetupShell({
        eyebrow: 'Change of plan',
        headline: `${esc(m.title || 'This meetup')} will not go ahead.`,
        preheader: `${m.title || 'A meetup'} has been cancelled.`,
        bodyHtml: `<p style="margin:0 0 10px;">Dear ${name},</p>
                   <p style="margin:0 0 10px;">We are sorry — <b class="em-ink" style="color:${DT.ink};">${esc(m.title || 'this meetup')}</b> has been cancelled${p.reason ? `: ${esc(p.reason)}` : '.'}${p.reason ? '' : ''} Nothing is owed and nothing is needed from you.</p>
                   <p style="margin:0;">The rest of Plexus Week runs exactly as planned${p.browseUrl ? `, and there are other tables with places left — <a href="${escUrl(p.browseUrl)}" style="color:${DT.gold};text-decoration:underline;">see what is open</a>.` : '.'}</p>`,
        facts: factRows({ meetup: m, hostLine: p.hostLine }),
        rule: 'crimson'
    });
}

// ================================================================ 07 · REMINDER (24 h before)
function reminder(p = {}) {
    const m = p.meetup || {};
    const name = esc(p.firstName || 'there');
    return meetupShell({
        eyebrow: 'Tomorrow',
        headline: `See you tomorrow, <i>${name}</i>.`,
        preheader: `${m.title || 'Your meetup'} is tomorrow — here is where and when.`,
        bodyHtml: `<p style="margin:0 0 10px;">A short note before <b class="em-ink" style="color:${DT.ink};">${esc(m.title || 'your meetup')}</b> — everything you need is below.</p>
                   <p style="margin:0;">Come as you are. ${esc(p.hostFirstName || 'Your host')} will be there.</p>`,
        facts: factRows({ meetup: m, hostLine: p.hostLine, seatLine: 'Confirmed' }),
        extraHtml: (m.venue_map_url ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;"><tr><td align="center">${btn('OPEN THE MAP →', m.venue_map_url, 'ghost', 'width:260px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;')}</td></tr></table>` : '')
            + qrBlock(p.qrPngUrl, p.shortCode) + manageLine(p.manageUrl, 'If something came up, please') + signupNudge(p.signupUrl, p.isMember),
        rule: 'gold'
    });
}

// ================================================================ 08 · HOST FYI (one line)
function hostFyi(p = {}) {
    const m = p.meetup || {};
    const t = T();
    const line = esc(p.line || 'Your attendee list changed.');
    return meetupShell({
        eyebrow: 'For your information',
        headline: `${esc(m.title || 'Your meetup')} — list update`,
        preheader: line,
        bodyHtml: `<p style="margin:0 0 10px;">${line}</p>
                   <p style="margin:0;">Nothing to do — the place was filled automatically. Your up-to-date list is one tap away.</p>`,
        facts: factRows({ meetup: m, seatLine: p.headcountLine }),
        buttonLabel: p.hostUrl ? 'OPEN MY MEETUP →' : null,
        buttonUrl: p.hostUrl || null,
        headerRightLabel: 'PLEXUS WEEK · HOST',
        rule: 'gold',
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Sent to you because you are hosting this meetup.']
    });
}

module.exports = {
    joinedConfirmed, waitlisted, promoted, invited,
    cancelledByYou, meetupCancelled, reminder, hostFyi,
    // fragments (exported for tests and for the host page's inline reuse)
    meetupShell, kindWord, esc, escUrl, DT
};
