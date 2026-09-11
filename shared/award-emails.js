/**
 * shared/award-emails.js — the Plexus Gala AWARDS emails, one builder each.
 *
 * PURE functions: plain params in, one full HTML document out. No DB, no ctx, no network — so
 * both backends (member `v2/awards.js`, admin `v2/awards-ops.js`) render byte-identical mail and
 * the tests can assert on the strings without a server.
 *
 * House style (design/AWARDS-SPEC.md §Non-negotiables): the espresso/cappuccino DARK shell —
 * tpl.shell({ tone:'dark' }) + tpl.btn — the same one look the review-gate and meetup emails
 * use. Registrant voice, warm, never the "Building Bridges evening" phrasing, "all three events"
 * rather than "evenings".
 *
 *   nominationReceived · nomineeNotified · applicationReceived · softAcknowledgment
 *   reviewerInvitation · winner · fellowshipWinner · shortlisted · declined · thankYouNominator
 *   presentationReminder
 *
 * The shell lives in the member portal's template library (user-portal/backend/v2/email-templates.js)
 * and is loaded lazily and defensively — a checkout without it degrades to a plain readable
 * document instead of crashing a module mount, exactly as shared/meetup-emails.js does.
 */
'use strict';

let _tpl = null;
function tpl() {
    if (_tpl) return _tpl;
    try { _tpl = require('../user-portal/backend/v2/email-templates'); }
    catch (e) { _tpl = null; }
    return _tpl;
}

// Espresso tokens — identical to review-gate.js DT and shared/meetup-emails.js DT.
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

const GALA_LINE = 'The Gala Evening · Saturday 5 December 2026 · Hotel Esplanade, Zagreb';

// ---------------------------------------------------------------- the one body shell
function awardShell({ eyebrow, headline, bodyHtml, facts, buttonLabel, buttonUrl, extraHtml, footNote,
                      preheader, title, rule, headerRightLabel, footerItems, hr }) {
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
      <div class="em-goldlab" style="font-family:${t.sans};font-weight:600;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${DT.gold};">${esc(eyebrow || 'Plexus Week · Awards')}</div>
      <div class="em-ink" style="font-family:${t.serif};font-weight:500;font-size:27px;line-height:1.18;letter-spacing:-.01em;color:${DT.ink};margin-top:10px;">${headline}</div>
      <div class="em-soft" style="font-family:${t.sans};font-size:14px;line-height:1.7;color:${DT.soft};margin-top:16px;">${bodyHtml}</div>${factsHtml}
      ${(buttonLabel && buttonUrl) ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px;">${btn(buttonLabel, buttonUrl, 'solid', 'width:300px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;background:#a8232b;')}</td></tr></table>` : ''}
      ${extraHtml || ''}${noteHtml}
      <div class="em-soft em-hair" style="margin-top:24px;padding-top:14px;border-top:1px solid ${DT.hair};font-family:${t.sans};font-size:11.5px;line-height:1.7;color:${DT.soft};">${hr
        ? 'Imate pitanje? Samo odgovorite na ovaj e-mail — ili pišite Lauri Rodman na laura.rodman@medx.hr.'
        : 'Questions? Just reply to this email — or write to Laura Rodman at laura.rodman@medx.hr.'}</div>
    </td></tr></table>`;
    const t2 = tpl();
    const opts = {
        tone: 'dark',
        title: title || (String(headline).replace(/<[^>]+>/g, '') + ' — Med&X'),
        preheader: preheader || '',
        headerRightLabel: headerRightLabel || 'PLEXUS WEEK · AWARDS',
        rule: rule || 'gold',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: footerItems
    };
    if (t2) return t2.shell(opts);
    return `<!DOCTYPE html><html lang="${hr ? 'hr' : 'en'}"><head><meta charset="utf-8"><title>${esc(opts.title)}</title></head>
<body style="margin:0;background:#120e0a;"><table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="600" style="max-width:600px;background:#291e14;">${body}</table></td></tr></table></body></html>`;
}

/** "You can look at it, change your mind, or withdraw" — the line every entry email carries. */
function manageLine(manageUrl, hr) {
    if (!manageUrl) return '';
    const t = T();
    return `<div class="em-soft" style="font-family:${t.sans};font-size:12px;line-height:1.65;color:${DT.soft};margin-top:18px;">
      ${hr ? 'Status svoje prijave možete pogledati — i povući je ako se predomislite — ' : 'You can check where it stands — and withdraw it if you change your mind — '}<a href="${escUrl(manageUrl)}" style="color:${DT.gold};text-decoration:underline;">${hr ? 'na ovoj stranici' : 'on this page'}</a>.
    </div>`;
}

// ================================================================ 01 · NOMINATION RECEIVED
function nominationReceived(p = {}) {
    const hr = p.locale === 'hr';
    const who = esc(p.nomineeName || (hr ? 'vašeg kandidata' : 'your nominee'));
    const award = esc(p.awardName || (hr ? 'nagradu' : 'the award'));
    const self = !!p.self;
    return awardShell({
        hr,
        eyebrow: hr ? 'Nominacija zaprimljena' : 'Nomination received',
        headline: self
            ? (hr ? `Zaprimili smo vašu prijavu.` : `We have your nomination.`)
            : (hr ? `Zaprimili smo vašu nominaciju <i>${who}</i>.` : `We received your nomination of <i>${who}</i>.`),
        preheader: hr ? `Vaša nominacija za ${p.awardName || 'nagradu'} je kod nas.` : `Your nomination for ${p.awardName || 'the award'} is with us.`,
        bodyHtml: self
            ? `<p style="margin:0 0 10px;">${hr ? 'Hvala vam — vaša samonominacija za' : 'Thank you — your self-nomination for'} <b class="em-ink" style="color:${DT.ink};">${award}</b> ${hr ? 'je zaprimljena i čita se jednako kao i svaka druga.' : 'is in, and it is read exactly like any other.'}</p>
               <p style="margin:0;">${hr ? 'Odluke se donose u studenome, a nagrade se uručuju na Gala večeri 5. prosinca. Do tada od vas ništa nije potrebno.' : 'Decisions are made in November and the awards are presented at the Gala Evening on 5 December. Nothing more is needed from you until then.'}</p>`
            : `<p style="margin:0 0 10px;">${hr ? 'Hvala vam. Vaša nominacija' : 'Thank you. Your nomination of'} <b class="em-ink" style="color:${DT.ink};">${who}</b> ${hr ? `za ${award} je zaprimljena.` : `for the <b class="em-ink" style="color:${DT.ink};">${award}</b> is with us.`}</p>
               <p style="margin:0;">${hr ? 'Svaku nominaciju čita panel u cijelosti. Odluke se donose u studenome, a nagrade se uručuju na Gala večeri 5. prosinca.' : 'Every nomination is read in full by the panel. Decisions are made in November, and the awards are presented at the Gala Evening on 5 December.'}</p>`,
        facts: [
            [hr ? 'Nagrada' : 'Award', p.awardName || '—'],
            [hr ? 'Kandidat' : 'Nominee', p.nomineeName || '—'],
            [hr ? 'Zatvaranje' : 'Nominations close', p.closesLabel || '1 November 2026'],
            [hr ? 'Dodjela' : 'Presented', GALA_LINE]
        ],
        extraHtml: manageLine(p.manageUrl, hr),
        rule: 'gold'
    });
}

// ================================================================ 02 · YOU HAVE BEEN NOMINATED
// Warm, and explicitly asks nothing of them — a nominee should never feel handed a task.
function nomineeNotified(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    const by = esc(p.nominatorName || (hr ? 'netko tko prati vaš rad' : 'someone who follows your work'));
    const award = esc(p.awardName || (hr ? 'nagradu' : 'the award'));
    return awardShell({
        hr,
        eyebrow: hr ? 'Nominirani ste' : 'You have been nominated',
        headline: hr ? `Netko vas je predložio, <i>${name}</i>.` : `Someone put your name forward, <i>${name}</i>.`,
        preheader: hr ? `${p.nominatorName || 'Netko'} vas je nominirao za ${p.awardName || 'nagradu'}.` : `${p.nominatorName || 'Someone'} nominated you for ${p.awardName || 'the award'}.`,
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Htjeli smo da to čujete od nas, a ne slučajno: ' : 'We wanted you to hear it from us rather than by accident: '}<b class="em-ink" style="color:${DT.ink};">${by}</b> ${hr ? `vas je nominirao za ${award} u sklopu Plexus tjedna 2026.` : `has nominated you for the <b class="em-ink" style="color:${DT.ink};">${award}</b> at Plexus Week 2026.`}</p>
                   <p style="margin:0 0 10px;">${hr ? 'Od vas ništa nije potrebno. Panel čita sve nominacije u studenome, a nagrade se uručuju na Gala večeri 5. prosinca u Esplanadi.' : 'Nothing is needed from you. The panel reads every nomination in November, and the awards are presented at the Gala Evening on 5 December at the Esplanade.'}</p>
                   <p style="margin:0;">${hr ? 'Ako biste radije da vaše ime ne bude u tome, javite nam jednim retkom i tako će biti.' : 'If you would rather your name were not in the running, tell us in one line and that is how it will be.'}</p>`,
        facts: [
            [hr ? 'Nagrada' : 'Award', p.awardName || '—'],
            [hr ? 'Nominirao/la vas je' : 'Nominated by', p.nominatorName || '—'],
            [hr ? 'Dodjela' : 'Presented', GALA_LINE]
        ],
        rule: 'gold'
    });
}

// ================================================================ 03 · APPLICATION RECEIVED (fellowship)
function applicationReceived(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    return awardShell({
        hr,
        eyebrow: hr ? 'Prijava zaprimljena' : 'Application received',
        headline: hr ? `Vaša prijava je kod nas, <i>${name}</i>.` : `Your application is in, <i>${name}</i>.`,
        preheader: hr ? 'Vaša prijava za Plexus stipendiju je zaprimljena.' : 'Your Plexus Fellowship application is with us.',
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Hvala vam što ste nam poslali svoju ideju za' : 'Thank you for sending us your idea for the'} <b class="em-ink" style="color:${DT.ink};">${esc(p.awardName || 'Plexus Fellowship')}</b>.</p>
                   <p style="margin:0 0 10px;">${hr ? 'Svaku prijavu čita panel u cijelosti — i na hrvatskom i na engleskom, bez razlike. Biraju se dva stipendista; svaki dobiva plaćeno mjesto na Gala večeri i tri minute na pozornici.' : 'Every application is read in full by the panel — Croatian and English alike, with no difference between them. Two Fellows are chosen; each receives a funded seat at the Gala Evening and three minutes on the stage.'}</p>
                   <p style="margin:0;">${hr ? 'Odluke stižu u studenome. Do tada od vas ništa nije potrebno.' : 'Decisions come in November. Nothing more is needed from you until then.'}</p>`,
        facts: [
            [hr ? 'Prijava' : 'Application', p.awardName || 'Plexus Fellowship'],
            [hr ? 'Škola / fakultet' : 'School', p.school || '—'],
            [hr ? 'Prilog' : 'Attachment', p.attachmentName || (hr ? 'bez priloga' : 'none')],
            [hr ? 'Zatvaranje' : 'Applications close', p.closesLabel || '1 November 2026'],
            [hr ? 'Dodjela' : 'Presented', GALA_LINE]
        ],
        extraHtml: manageLine(p.manageUrl, hr),
        rule: 'crimson'
    });
}

// ================================================================ 04 · SOFT ACKNOWLEDGMENT (held)
// A held submission gets a warm, ordinary-looking note. It never mentions review, holds or bots —
// a legitimate person reads "we have it, we are finishing a check", and a bot learns nothing.
function softAcknowledgment(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    const what = p.isApplication
        ? (hr ? 'vašu prijavu' : 'your application')
        : (hr ? 'vašu nominaciju' : 'your nomination');
    return awardShell({
        hr,
        eyebrow: hr ? 'Zaprimljeno' : 'Received',
        headline: hr ? `Zaprimili smo ${what}.` : `We received ${what}.`,
        preheader: hr ? 'Zaprimljeno — dovršavamo kratku provjeru.' : 'Received — we are completing a quick check.',
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Poštovani' : 'Dear'} ${name},</p>
                   <p style="margin:0 0 10px;">${hr ? `Zaprimili smo ${what}${p.awardName ? ' za <b class="em-ink" style="color:' + DT.ink + '">' + esc(p.awardName) + '</b>' : ''} i dovršavamo kratku provjeru.` : `We received ${what}${p.awardName ? ' for <b class="em-ink" style="color:' + DT.ink + '">' + esc(p.awardName) + '</b>' : ''} and are completing a quick check.`}</p>
                   <p style="margin:0;">${hr ? 'Javit ćemo vam se e-mailom čim provjera bude gotova. Do tada od vas ništa nije potrebno.' : 'We will write to you by email as soon as that is done. Nothing is needed from you until then.'}</p>`,
        rule: 'crimson'
    });
}

// ================================================================ 05 · REVIEWER INVITATION
function reviewerInvitation(p = {}) {
    const t = T();
    const name = esc(p.firstName || 'there');
    const cats = (p.categoryNames || []).filter(Boolean);
    return awardShell({
        eyebrow: 'An invitation to read',
        headline: `Would you help us choose, <i>${name}</i>?`,
        preheader: 'A small reading panel for the Plexus Gala awards — would you join it?',
        bodyHtml: `<p style="margin:0 0 10px;">Dear ${name},</p>
                   <p style="margin:0 0 10px;">Four awards are presented at the Med&amp;X Gala Evening this December, and the nominations are read by a small panel rather than by a committee of one. We would be glad if you were on it.</p>
                   <p style="margin:0 0 10px;">It is a real but bounded ask: read the entries in ${cats.length === 1 ? 'one category' : `${cats.length || 'your'} categories`}, score each on three criteria from 1 to 5, and add a line of comment where you have one. Most panellists finish in an evening. You never see anybody else's scores, and an entry you have any connection to is one click away from being set aside.</p>
                   <p style="margin:0;">Your reading room is behind the button below — the link is yours alone, no password, no account.</p>`,
        facts: [
            ['Reading', cats.length ? cats.join(' · ') : 'Assigned to you'],
            ['Scoring closes', p.closesLabel || 'mid-November 2026'],
            ['Presented', GALA_LINE]
        ],
        buttonLabel: 'OPEN MY READING ROOM →',
        buttonUrl: p.roomUrl || null,
        footNote: `<span style="color:${DT.soft};">If this is not for you this year, simply reply and say so — no explanation needed, and we will ask again another time.</span>`,
        headerRightLabel: 'PLEXUS WEEK · AWARDS PANEL',
        rule: 'gold',
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Sent to you because we would like you on the reading panel.']
    });
}

// ================================================================ 06 · WINNER
function winner(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    const award = esc(p.awardName || (hr ? 'nagradu' : 'the award'));
    return awardShell({
        hr,
        eyebrow: hr ? 'Odluka panela' : 'The panel has decided',
        headline: hr ? `Nagrada je vaša, <i>${name}</i>.` : `The award is yours, <i>${name}</i>.`,
        preheader: hr ? `Dobitnik ste nagrade ${p.awardName || ''} — uručenje 5. prosinca.` : `You are receiving the ${p.awardName || 'award'} — presented on 5 December.`,
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Poštovani' : 'Dear'} ${name},</p>
                   <p style="margin:0 0 10px;">${hr ? `Drago nam je što vam možemo javiti: panel je odabrao vas za <b class="em-ink" style="color:${DT.ink};">${award}</b>.` : `It is our pleasure to tell you that the panel has chosen you for the <b class="em-ink" style="color:${DT.ink};">${award}</b>.`}</p>
                   ${p.citation ? `<p style="margin:0 0 10px;">${hr ? 'Obrazloženje glasi' : 'The citation reads'}: <i class="em-ink" style="color:${DT.ink};">${esc(p.citation)}</i>.</p>` : ''}
                   <p style="margin:0;">${hr ? 'Nagrada se uručuje na Gala večeri, u subotu 5. prosinca 2026., u Esplanadi u Zagrebu. Uskoro vam šaljemo pojedinosti o večeri; za sada nam samo potvrdite da ćete moći doći.' : 'The award is presented at the Gala Evening on Saturday 5 December 2026 at the Esplanade in Zagreb. Details of the evening follow shortly — for now, just let us know that you can be there.'}</p>`,
        facts: [
            [hr ? 'Nagrada' : 'Award', p.awardName || '—'],
            [hr ? 'Laureat' : 'Laureate', p.laureateName || p.firstName || '—'],
            [hr ? 'Dodjela' : 'Presented', GALA_LINE],
            [hr ? 'Dress code' : 'Dress', hr ? 'Crna kravata' : 'Black tie']
        ],
        buttonLabel: p.replyUrl ? (hr ? 'POTVRDI DOLAZAK →' : 'CONFIRM I CAN BE THERE →') : null,
        buttonUrl: p.replyUrl || null,
        rule: 'gold'
    });
}

// ================================================================ 07 · FELLOWSHIP WINNER
// Carries the funded gala seat (a real comp registration, with its own entry QR), the slides
// upload link and the three-minute presentation ask — one email, everything in it.
function fellowshipWinner(p = {}) {
    const hr = p.locale === 'hr';
    const t = T();
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    const qr = p.qrPngUrl ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;"><tr><td align="center">
        <img src="${escUrl(p.qrPngUrl)}" alt="${hr ? 'Vaš ulazni QR' : 'Your entry QR'}" width="150" height="150" style="display:block;border:6px solid #fdfaf3;background:#fdfaf3;width:150px;height:150px;">
        <div style="font-family:${t.sans};font-size:10px;letter-spacing:.16em;color:${DT.gold};margin-top:8px;text-transform:uppercase;">${hr ? 'VAŠE MJESTO · GALA VEČER' : 'YOUR SEAT · GALA EVENING'}</div>
      </td></tr></table>` : '';
    const slides = p.slidesUrl ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr><td align="center">
        ${btn(hr ? 'POŠALJI SVOJE SLAJDOVE →' : 'UPLOAD YOUR SLIDES →', p.slidesUrl, 'gold', 'width:300px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;')}
      </td></tr></table>` : '';
    return awardShell({
        hr,
        eyebrow: hr ? 'Plexus stipendija' : 'Plexus Fellowship',
        headline: hr ? `Vi ste jedan od stipendista, <i>${name}</i>.` : `You are one of this year's Fellows, <i>${name}</i>.`,
        preheader: hr ? 'Odabrani ste za Plexus stipendiju — mjesto na Gala večeri je plaćeno.' : 'You have been chosen as a Plexus Fellow — your Gala seat is covered.',
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Poštovani' : 'Dear'} ${name},</p>
                   <p style="margin:0 0 10px;">${hr ? 'Panel je pročitao sve prijave i odabrao vašu. Čestitamo — vi ste jedan od dva ovogodišnja' : 'The panel read every application and chose yours. Congratulations — you are one of the two'} <b class="em-ink" style="color:${DT.ink};">${hr ? 'Plexus stipendista' : 'Plexus Fellows'}</b>${hr ? '.' : ' this year.'}</p>
                   <p style="margin:0 0 10px;">${hr ? 'Vaše mjesto na Gala večeri u subotu 5. prosinca u Esplanadi je osigurano i plaćeno — ništa ne plaćate. Ulazni QR je niže; pokažite ga na vratima.' : 'Your seat at the Gala Evening on Saturday 5 December at the Esplanade is held and paid for — there is nothing for you to pay. Your entry QR is below; show it at the door.'}</p>
                   <p style="margin:0;">${hr ? 'Jedno vas pitamo: tri minute na pozornici, o ideji koju ste nam poslali. Bez pritiska i bez formalnosti — slajdovi nisu obavezni, a ako ih želite, pošaljite ih preko donje poveznice do 28. studenoga.' : 'One thing we ask: three minutes on the stage, about the idea you sent us. No pressure and no formality — slides are optional, and if you would like them, send them through the link below by 28 November.'}</p>`,
        facts: [
            [hr ? 'Nagrada' : 'Award', p.awardName || 'Plexus Fellowship'],
            [hr ? 'Vaše mjesto' : 'Your seat', hr ? 'Plaćeno od strane Med&X' : 'Covered by Med&X'],
            [hr ? 'Prezentacija' : 'Presentation', hr ? 'Tri minute, na pozornici' : 'Three minutes, from the stage'],
            [hr ? 'Večer' : 'Evening', GALA_LINE],
            [hr ? 'Dress code' : 'Dress', hr ? 'Crna kravata' : 'Black tie']
        ],
        extraHtml: qr + slides + (p.confirmUrl ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;"><tr><td align="center">
        ${btn(hr ? 'POTVRĐUJEM PREZENTACIJU →' : 'YES, I WILL PRESENT →', p.confirmUrl, 'solid', 'width:300px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;background:#a8232b;')}
      </td></tr></table>` : ''),
        rule: 'gold'
    });
}

// ================================================================ 08 · SHORTLISTED, NOT SELECTED
function shortlisted(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    return awardShell({
        hr,
        eyebrow: hr ? 'Uži izbor' : 'The shortlist',
        headline: hr ? `Bili ste u najužem izboru, <i>${name}</i>.` : `You were on the final shortlist, <i>${name}</i>.`,
        preheader: hr ? 'Bili ste u najužem izboru za ovogodišnju nagradu.' : 'You reached the final shortlist for this year’s award.',
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Poštovani' : 'Dear'} ${name},</p>
                   <p style="margin:0 0 10px;">${hr ? `Panel je ove godine za ${esc(p.awardName || 'nagradu')} imao pred sobom mnogo jakih imena. Vaše je bilo među posljednjima o kojima se raspravljalo — i nagrada je na kraju otišla nekom drugom.` : `The panel had a strong field for the <b class="em-ink" style="color:${DT.ink};">${esc(p.awardName || 'award')}</b> this year. Yours was among the last names still being argued over — and the award went, in the end, to someone else.`}</p>
                   <p style="margin:0 0 10px;">${hr ? 'To pišemo jer mislimo da to trebate znati: razlika između posljednjeg „da” i prvog „ne” bila je neugodno tanka, i ovo je odluka o broju nagrada, a ne sud o vašem radu.' : 'We write because we think you should know it: the line between the final yes and the first no was uncomfortably thin, and this is a decision about how many awards there are, not a verdict on your work.'}</p>
                   <p style="margin:0;">${hr ? 'Vrata Gala večeri su vam otvorena, a nominacija ostaje kod nas za sljedeću godinu.' : 'You are welcome at the Gala Evening all the same, and the nomination stays on file with us for next year.'}</p>`,
        rule: 'crimson'
    });
}

// ================================================================ 09 · NOT SELECTED (kind)
function declined(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    const isApp = !!p.isApplication;
    return awardShell({
        hr,
        eyebrow: hr ? 'Odluka' : 'The decision',
        headline: hr ? `O vašoj ${isApp ? 'prijavi' : 'nominaciji'}, <i>${name}</i>.` : `About your ${isApp ? 'application' : 'nomination'}, <i>${name}</i>.`,
        preheader: hr ? 'Odluka panela o ovogodišnjoj nagradi.' : 'The panel’s decision on this year’s award.',
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Poštovani' : 'Dear'} ${name},</p>
                   <p style="margin:0 0 10px;">${hr ? `Panel je pročitao svaku ${isApp ? 'prijavu' : 'nominaciju'} u cijelosti, i ovu među njima. Ove godine nagrada ${esc(p.awardName || '')} nije otišla vama.` : `The panel read every ${isApp ? 'application' : 'nomination'} in full, this one included. This year the <b class="em-ink" style="color:${DT.ink};">${esc(p.awardName || 'award')}</b> went elsewhere.`}</p>
                   <p style="margin:0 0 10px;">${hr ? 'Broj nagrada je mali, a polje je bilo jako — to je cijela priča. Ništa u ovoj odluci ne govori da rad nije vrijedan.' : 'There are very few awards and the field was strong — that is the whole of it. Nothing in this decision says the work was not worth it.'}</p>
                   <p style="margin:0;">${hr ? 'Javite se sljedeće godine. Prijave ostaju kod nas, a prijava koja pokaže godinu pomaka čita se jače od prve.' : 'Come back next year. Entries stay on file with us, and one that shows a year of movement reads stronger than a first.'}</p>`,
        rule: 'crimson'
    });
}

// ================================================================ 10 · THANK YOU, NOMINATOR
function thankYouNominator(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    const who = esc(p.nomineeName || (hr ? 'osobu koju ste predložili' : 'the person you put forward'));
    return awardShell({
        hr,
        eyebrow: hr ? 'Hvala vam' : 'Thank you',
        headline: hr ? `Hvala što ste predložili <i>${who}</i>.` : `Thank you for nominating <i>${who}</i>.`,
        preheader: hr ? 'Odluke o nagradama su donesene — hvala na nominaciji.' : 'The award decisions are made — thank you for nominating.',
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Poštovani' : 'Dear'} ${name},</p>
                   <p style="margin:0 0 10px;">${hr ? 'Odluke su donesene i laureati su obaviješteni. Htjeli smo vam se javiti bez obzira na ishod: nominacija koju ste napisali stigla je do panela i bila je pročitana u cijelosti.' : 'The decisions are made and the laureates have been told. We wanted to write to you either way: the nomination you wrote reached the panel and was read in full.'}</p>
                   <p style="margin:0;">${hr ? 'Ovakve nagrade postoje samo zato što netko sjedne i napiše zašto nečiji rad zaslužuje da se vidi. Hvala vam što ste to učinili.' : 'Awards like these exist only because somebody sits down and writes out why another person’s work deserves to be seen. Thank you for doing that.'}</p>`,
        buttonLabel: p.galaUrl ? (hr ? 'GALA VEČER · 5. PROSINCA →' : 'THE GALA EVENING · 5 DECEMBER →') : null,
        buttonUrl: p.galaUrl || null,
        rule: 'gold'
    });
}

// ================================================================ 11 · PRESENTATION REMINDER
function presentationReminder(p = {}) {
    const hr = p.locale === 'hr';
    const name = esc(p.firstName || (hr ? 'kolegice ili kolega' : 'there'));
    return awardShell({
        hr,
        eyebrow: hr ? 'Tri minute' : 'Three minutes',
        headline: hr ? `Vaših tri minute, <i>${name}</i>.` : `Your three minutes, <i>${name}</i>.`,
        preheader: hr ? 'Potvrdite prezentaciju i pošaljite slajdove ako ih imate.' : 'Confirm your presentation and send slides if you have them.',
        bodyHtml: `<p style="margin:0 0 10px;">${hr ? 'Kratka poruka prije Gala večeri: treba nam samo vaša potvrda da ćete govoriti tri minute, i slajdovi ako ih želite koristiti.' : 'A short note before the Gala Evening: all we need is your confirmation that you will speak for three minutes, and your slides if you would like to use any.'}</p>
                   <p style="margin:0;">${hr ? 'Bez slajdova je posve u redu — mnogi su bolji bez njih.' : 'No slides at all is perfectly fine — many people are better without them.'}</p>`,
        buttonLabel: p.confirmUrl ? (hr ? 'POTVRDI I POŠALJI SLAJDOVE →' : 'CONFIRM AND SEND SLIDES →') : null,
        buttonUrl: p.confirmUrl || null,
        rule: 'gold'
    });
}

module.exports = {
    nominationReceived, nomineeNotified, applicationReceived, softAcknowledgment,
    reviewerInvitation, winner, fellowshipWinner, shortlisted, declined, thankYouNominator,
    presentationReminder,
    // fragments (exported for tests and for the admin's "preview this email" panel)
    awardShell, manageLine, esc, escUrl, DT, GALA_LINE
};
