/**
 * v2/email-templates.js — branded 600 px transactional-email builders for the redesigned
 * member portal. Recreated 1:1 from design/handoff/member-portal-2026-08-28/Emails.dc.html
 * (ink header + wordmark, 2px crimson/gold rule, cream body, Fraunces headlines, hairline
 * footer) with the artboard's flex rows translated to tables so Gmail/Outlook render them.
 *
 * PURE functions — no DB, no ctx: they take plain params and return a full HTML document
 * string for sendEmail(). Also exports brandedPage() (same brand, standalone web page shell)
 * used by v2/newsletter.js for the public preference-center / unsubscribe pages.
 *
 *   confirmEmail({ firstName, verifyUrl, locale?, validFor? })
 *   ticketConfirmation({ firstName, eventName, dateLabel, venue, qrPngUrl, passUrl,
 *                        walletUrl, calendarUrl?, ticketLabel?, priceLabel?, guestLabel?,
 *                        ticketNumber?, headlineHtml?, note? })
 *   newsletter({ monthLabel?, headline?, items:[{title, blurb, url, tag}], bodyHtml?,
 *                manageUrl, unsubscribeUrl })
 *   attendanceCard({ firstName, eventName, dateLabel?, venue?, cardImageUrl,
 *                    cardDownloadUrl?, walletUrl?, shareText? })
 *   yearInReview({ firstName, year?, stats?, cardImageUrl?, cardDownloadUrl?, walletUrl? })
 *   newsletterWelcome({ firstName, topics, manageUrl, unsubscribeUrl })
 *   newsletterConfirm({ firstName, email, confirmUrl })
 *
 * Logo: white wordmark for the ink header — EMAIL_LOGO_URL env first (read per call so tests
 * can override), else the public jsDelivr mirror of this repo's frontend-v2 asset.
 * Brand rules: € never EUR · diacritics kept (escaped, never stripped) · no mailto links.
 */
'use strict';

const T = {
    ink: '#191512',
    cream: '#f7f1e6',
    cardCream: '#fdfaf3',
    crimson: '#9b1b22',
    gold: '#c9a962',
    goldDark: '#6e5626',
    soft: '#4a4239',
    hairline: 'rgba(25,21,18,.16)',
    canvas: '#e9e2d2',
    serif: "Fraunces,Georgia,'Times New Roman',serif",
    sans: "Inter,Helvetica,Arial,sans-serif"
};

function logoUrl() {
    // Netlify CDN default: always on, no sleep, serves today (the jsDelivr @main path only
    // resolves after the redesign merges — it rendered as a broken image; fixed 2026-08-30).
    return process.env.EMAIL_LOGO_URL
        || 'https://medx-member-portal-v2.netlify.app/assets/logo-white.png';
}

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// href values: escape but keep a plain URL usable; block javascript: etc.
function escUrl(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^(https?:|mailto:|data:image\/|\/)/i.test(s)) return '#';
    return esc(s);
}

const microStyle = (color, size, spacing) =>
    `font-family:${T.sans};font-weight:600;font-size:${size || 10}px;letter-spacing:${spacing || '.18em'};color:${color};text-transform:uppercase;`;

function btn(label, href, kind) {
    const solid = `display:inline-block;padding:15px 34px;background:${T.crimson};color:${T.cream};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const ghost = `display:inline-block;padding:14px 30px;border:1px solid rgba(25,21,18,.3);color:${T.ink};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const gold = `display:inline-block;padding:14px 30px;background:${T.gold};color:#191512;font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const ink = `display:inline-block;padding:14px 30px;background:#191512;color:#f7f1e6;font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    return `<a href="${escUrl(href)}" style="${kind === 'ghost' ? ghost : kind === 'gold' ? gold : kind === 'ink' ? ink : solid}">${label}</a>`;
}

// The 600px shell: ink header (logo + right micro-label), accent rule, body, hairline footer.
// rule: 'crimson' | 'gold' | 'split' (newsletter's 50/50 crimson→gold).
function shell({ title, preheader, headerRightLabel, headerExtraHtml, rule, bodyHtml, footerItems, lang }) {
    const ruleBg = rule === 'gold' ? `background:${T.gold};`
        : rule === 'split' ? `background:${T.crimson};background:linear-gradient(90deg,${T.crimson} 0 50%,${T.gold} 50% 100%);`
        : `background:${T.crimson};`;
    const footer = (footerItems && footerItems.length ? footerItems : [`© Med&amp;X ${new Date().getFullYear()} · Zagreb`])
        .join(`</td><td style="font-family:${T.sans};font-size:11px;color:${T.gold};padding:0 6px;">·</td><td style="font-family:${T.sans};font-size:11px;color:${T.soft};line-height:1.5;">`);
    return `<!DOCTYPE html>
<html lang="${lang === 'hr' ? 'hr' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(title || 'Med&X')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&amp;family=Inter:wght@400..700&amp;display=swap" rel="stylesheet">
<style>@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap');</style>
</head>
<body style="margin:0;padding:0;background:${T.canvas};font-family:${T.sans};-webkit-text-size-adjust:100%;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.canvas};padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${T.cream};box-shadow:0 10px 34px rgba(25,21,18,.18);">
  <tr><td style="background:${T.ink};padding:${headerExtraHtml ? '26px 40px 22px' : '22px 40px'};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="left" style="vertical-align:middle;"><img src="${escUrl(logoUrl())}" alt="med&amp;X" height="20" style="height:20px;width:auto;display:block;border:0;"></td>
      <td align="right" style="vertical-align:middle;${microStyle(T.gold, 9, '.2em')}">${headerRightLabel || 'MEMBER PORTAL'}</td>
    </tr></table>
    ${headerExtraHtml || ''}
  </td></tr>
  <tr><td style="height:2px;font-size:0;line-height:0;${ruleBg}">&nbsp;</td></tr>
  <tr><td>${bodyHtml}</td></tr>
  <tr><td style="border-top:1px solid ${T.hairline};padding:18px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="font-family:${T.sans};font-size:11px;color:${T.soft};line-height:1.5;">${footer}</td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

// ---------------------------------------------------------------- 01 · CONFIRM YOUR EMAIL
function confirmEmail({ firstName, verifyUrl, locale, validFor } = {}) {
    const hr = locale === 'hr';
    const name = esc(firstName || (hr ? '' : 'there'));
    const hours = esc(validFor || (hr ? '48 sata' : '48 hours'));
    const body = `
    <div style="padding:36px 40px 30px;">
      <span style="${microStyle(T.gold)}">${hr ? 'JOŠ JEDAN KLIK' : 'ONE CLICK LEFT'}</span>
      <div style="font-family:${T.serif};font-size:28px;line-height:1.15;color:${T.ink};margin-top:10px;">${hr ? `Potvrdite svoju e-poštu${firstName ? ', <i>' + name + '</i>' : ''}.` : `Confirm your email, <i>${name}</i>.`}</div>
      <div style="font-family:${T.sans};font-size:14px;color:${T.soft};line-height:1.65;margin-top:14px;">${hr
        ? 'Dobro došli u Med&amp;X. Potvrdite ovu adresu i vaš račun otključava sve — registracije, ulaznice, mrežu članova i vaše poruke.'
        : 'Welcome to Med&amp;X. Confirm this address and your account unlocks everything — registrations, tickets, the member network, and your messages.'}</div>
      <div style="text-align:center;margin:26px 0;">${btn(hr ? 'POTVRDI MOJU E-POŠTU →' : 'CONFIRM MY EMAIL →', verifyUrl)}</div>
      <div style="font-family:${T.sans};font-size:12px;color:${T.soft};line-height:1.6;">${validFor === null
        ? (hr ? 'Ako gumb ne radi, zalijepite ovo u svoj preglednik:' : `If the button doesn't work, paste this into your browser:`)
        : hr
        ? `Poveznica vrijedi ${hours}. Ako gumb ne radi, zalijepite ovo u svoj preglednik:`
        : `The link is valid for ${hours}. If the button doesn't work, paste this into your browser:`}<br>
        <a href="${escUrl(verifyUrl)}" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:${T.crimson};text-decoration:none;word-break:break-all;">${esc(verifyUrl || '')}</a></div>
    </div>`;
    return shell({
        title: hr ? 'Potvrdite svoju e-poštu — Med&X' : 'Confirm your email — Med&X',
        preheader: hr ? 'Jedan klik i vaš je Med&X račun spreman.' : 'One click and your Med&X account is ready.',
        rule: 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Zagreb`,
            hr ? 'Ovu ste poruku primili jer je s ovom adresom otvoren račun.' : 'You received this because an account was created with this address.']
    });
}

// ---------------------------------------------------------------- 02 · TICKET CONFIRMATION
function ticketConfirmation({ firstName, eventName, dateLabel, whenLines, venue, qrPngUrl, passUrl, walletUrl,
                              calendarUrl, ticketLabel, priceLabel, guestLabel, ticketNumber,
                              dressLabel, tableLabel, headlineHtml, note, ctaLabel, replyLine, walletSaveUrl, appleWalletUrl } = {}) {
    const fieldRow = (label, valueHtml) => `
        <tr><td style="padding:5px 0;vertical-align:baseline;width:76px;${microStyle(T.soft, 9, '.12em')}">${label}</td>
            <td style="padding:5px 0 5px 10px;vertical-align:baseline;">${valueHtml}</td></tr>`;
    const guestLine = guestLabel
        ? esc(guestLabel) + (ticketNumber ? ` · N° ${esc(ticketNumber)}` : '')
        : (ticketNumber ? `N° ${esc(ticketNumber)}` : '');
    // WHEN: one stacked line per event; the event name before the first " — " renders bold
    // (mobile + readability fixes, 2026-08-30 per Alen's review)
    const whenLine = (l) => {
        const s = String(l); const i = s.indexOf(' — ');
        const head = i > 0 ? s.slice(0, i) : null; const rest = i > 0 ? s.slice(i) : s;
        return `<span style="display:block;font-family:${T.sans};font-size:13px;line-height:1.6;color:${T.ink};">${head ? `<strong>${esc(head)}</strong>` : ''}${esc(rest)}</span>`;
    };
    const whenHtml = Array.isArray(whenLines) && whenLines.length
        ? whenLines.map(whenLine).join('')
        : (dateLabel ? `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(dateLabel)}</span>` : '');
    const rows = [
        fieldRow('EVENT', `<span style="font-family:${T.serif};font-size:16px;color:${T.ink};">${esc(eventName || 'Med&X event')}</span>`),
        whenHtml ? fieldRow('WHEN', whenHtml) : '',
        venue ? fieldRow('WHERE', `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(venue)}</span>`) : '',
        guestLine ? fieldRow('GUEST', `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${guestLine}</span>`) : '',
        ticketLabel ? fieldRow('TICKET', `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(ticketLabel)}</span>`) : '',
        priceLabel ? fieldRow('PRICE', `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(priceLabel)}</span>`) : '',
        dressLabel ? fieldRow('DRESS CODE', Array.isArray(dressLabel)
            ? dressLabel.map(whenLine).join('')
            : `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(dressLabel)}</span>`) : '',
        tableLabel ? fieldRow('TABLES', `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(tableLabel)}</span>`) : ''
    ].join('');
    // QR: its own full-width centred row BELOW the facts (2026-08-30 — the old side cell crushed
    // the text column to ~80px on phones). 120px render so door scanners read it off a screen.
    const qrImg = `<img src="${escUrl(qrPngUrl)}" alt="Your entry QR code" width="120" height="120" style="display:block;width:120px;height:120px;border:0;">`;
    const qrBlock = qrPngUrl ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid rgba(25,21,18,.12);"><tr>
            <td align="center" style="padding-top:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ffffff;border:1px solid ${T.hairline};padding:8px;">
                <a href="${escUrl(qrPngUrl)}" style="display:block;text-decoration:none;">${qrImg}</a>
              </td></tr></table>
              <div style="${microStyle(T.soft, 9, '.14em')};margin-top:8px;">YOUR ENTRY QR · SHOW AT THE DOOR</div>
              <div style="font-family:${T.sans};font-size:11px;color:${T.soft};margin-top:4px;">Tap the QR to enlarge it — then save it to your photos.</div>
              ${(walletSaveUrl || appleWalletUrl) ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto 0;"><tr>
                ${walletSaveUrl ? `<td style="padding:0 6px 10px;">${btn('ADD TO GOOGLE WALLET →', walletSaveUrl, 'gold')}</td>` : ''}
                ${appleWalletUrl ? `<td style="padding:0 6px 10px;">${btn('ADD TO APPLE WALLET →', appleWalletUrl, 'ink')}</td>` : ''}
              </tr></table>
              <div style="font-family:${T.sans};font-size:11px;color:${T.soft};">Tap Add to Wallet to add your ticket to Apple or Google Wallet.</div>` : ''}
            </td>
          </tr></table>` : '';
    const ctaUrl = passUrl || walletUrl;
    const body = `
    <div style="padding:32px 28px 26px;">
      <span style="${microStyle(T.gold)}">YOU'RE GOING</span>
      <div style="font-family:${T.serif};font-size:26px;line-height:1.18;color:${T.ink};margin-top:10px;">${headlineHtml || `${esc(eventName || 'Your seat')} — seat <i>confirmed</i>.`}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid rgba(201,169,98,.65);background:${T.cardCream};">
        <tr><td style="padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          ${qrBlock}
        </td></tr>
      </table>
      <div style="font-family:${T.sans};font-size:12.5px;color:${T.soft};line-height:1.6;margin-top:14px;">${note || 'Present the QR above at the door — it admits you to everything you are registered for.'}</div>
      <div style="font-family:${T.sans};font-size:12.5px;color:${T.soft};line-height:1.6;margin-top:10px;">${replyLine || `Questions? Just reply to this email, or write to <a href="mailto:laura.rodman@medx.hr" style="color:${T.soft};">laura.rodman@medx.hr</a>.`}</div>
      ${ctaUrl ? `<div style="text-align:center;margin:22px 0 4px;">${btn(ctaLabel || 'OPEN MY TICKETS →', ctaUrl)}${calendarUrl ? `<span style="display:inline-block;width:8px;">&nbsp;</span>${btn('ADD TO CALENDAR', calendarUrl, 'ghost')}` : ''}</div>` : ''}
    </div>`;
    return shell({
        title: `${eventName || 'Ticket'} — confirmed`,
        preheader: `${eventName || 'Your seat'} is confirmed — your QR is inside.`,
        rule: 'gold',
        bodyHtml: body,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Zagreb`, 'Questions? Reply to this email or write to laura.rodman@medx.hr']
    });
}

// ---------------------------------------------------------------- 03 · THE NEWSLETTER
function newsletter({ monthLabel, headline, items, bodyHtml, manageUrl, unsubscribeUrl } = {}) {
    const month = monthLabel || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    const rowsHtml = list.map((it, i) => {
        const last = i === list.length - 1;
        return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${last ? '' : `border-bottom:1px solid rgba(25,21,18,.12);`}"><tr>
        <td style="width:26px;vertical-align:baseline;padding:${i === 0 ? '0' : '16px'} 0 ${last ? '20px' : '16px'};font-family:${T.serif};font-weight:600;font-size:13px;color:${T.crimson};">${String(i + 1).padStart(2, '0')}</td>
        <td style="vertical-align:baseline;padding:${i === 0 ? '0' : '16px'} 0 ${last ? '20px' : '16px'};">
          <span style="display:block;font-family:${T.serif};font-size:17px;color:${T.ink};">${it.url ? `<a href="${escUrl(it.url)}" style="color:${T.ink};text-decoration:none;">${esc(it.title)}</a>` : esc(it.title)}</span>
          ${it.blurb ? `<span style="display:block;font-family:${T.sans};font-size:12.5px;color:${T.soft};margin-top:4px;line-height:1.55;">${esc(it.blurb)}</span>` : ''}
          ${it.url ? `<a href="${escUrl(it.url)}" style="display:inline-block;margin-top:7px;${microStyle(T.crimson, 9.5, '.15em')}text-decoration:none;">${esc(it.tag || 'READ MORE')} →</a>` : ''}
        </td>
      </tr></table>`;
    }).join('');
    const body = `
    <div style="padding:30px 40px ${bodyHtml ? '30px' : '6px'};">${bodyHtml || rowsHtml}</div>`;
    return shell({
        title: 'The month at Med&X',
        preheader: list.length ? list.map(i => i.title).filter(Boolean).slice(0, 3).join(' · ') : 'The month at Med&X, in three minutes.',
        headerRightLabel: esc(month),
        headerExtraHtml: `<div style="font-family:${T.serif};font-style:italic;font-size:22px;color:${T.cream};margin-top:14px;">${headline || 'The month at Med&amp;X, in three minutes.'}</div>`,
        rule: 'split',
        bodyHtml: body,
        footerItems: [
            `© Med&amp;X ${new Date().getFullYear()} · Zagreb`,
            `<a href="${escUrl(manageUrl)}" style="color:${T.soft};text-decoration:underline;">Manage topics</a>`,
            `<a href="${escUrl(unsubscribeUrl)}" style="color:${T.soft};text-decoration:underline;">Unsubscribe</a>`
        ]
    });
}

// ---------------------------------------------------------------- attendance card email
// The card itself is redrawn in bulletproof HTML (Gmail cannot render an SVG <img>), with the
// stored file linked for download/sharing underneath.
function miniCardHtml({ eyebrow, line1, line2, metaLine, nameLine, subLine }) {
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.ink};margin-top:20px;"><tr><td style="padding:3px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(201,169,98,.55);"><tr><td style="padding:24px 26px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td align="left" style="vertical-align:middle;"><img src="${escUrl(logoUrl())}" alt="med&amp;X" height="14" style="height:14px;width:auto;display:block;border:0;"></td>
            <td align="right" style="vertical-align:middle;${microStyle(T.gold, 8.5, '.18em')}">${esc(eyebrow || '')}</td>
          </tr></table>
          <div style="border-top:1px solid rgba(201,169,98,.35);margin:14px 0 18px;font-size:0;line-height:0;">&nbsp;</div>
          <div style="font-family:${T.serif};font-style:italic;font-size:26px;line-height:1.15;color:${T.cream};">${esc(line1 || '')}</div>
          <div style="font-family:${T.serif};font-weight:600;font-size:26px;line-height:1.2;color:${T.cream};">${esc(line2 || '')}<span style="color:${T.gold};">.</span></div>
          ${metaLine ? `<div style="font-family:${T.sans};font-size:13px;color:rgba(247,241,230,.72);margin-top:9px;">${esc(metaLine)}</div>` : ''}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr>
            <td align="left" style="vertical-align:bottom;">
              <div style="width:42px;border-top:3px solid ${T.crimson};font-size:0;line-height:0;margin-bottom:8px;">&nbsp;</div>
              <div style="font-family:${T.serif};font-size:17px;color:${T.cream};">${esc(nameLine || '')}</div>
              ${subLine ? `<div style="font-family:${T.sans};font-size:11.5px;color:rgba(247,241,230,.55);margin-top:2px;">${esc(subLine)}</div>` : ''}
            </td>
            <td align="right" style="vertical-align:bottom;${microStyle(T.gold, 10, '.2em')}">medx.hr</td>
          </tr></table>
        </td></tr></table>
      </td></tr></table>`;
}

function attendanceCard({ firstName, eventName, dateLabel, venue, cardImageUrl, cardDownloadUrl,
                          walletUrl, shareText } = {}) {
    const name = esc(firstName || 'there');
    const meta = [venue, dateLabel].filter(Boolean).join(' · ');
    const isPng = /\.png(\?|$)/i.test(String(cardImageUrl || ''));
    const cardVisual = isPng
        ? `<img src="${escUrl(cardImageUrl)}" alt="I'm attending ${esc(eventName || 'Med&X')}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;margin-top:20px;">`
        : miniCardHtml({ eyebrow: 'MED&X · ATTENDANCE CARD', line1: "I'm attending", line2: eventName || 'Med&X', metaLine: meta, nameLine: firstName || '', subLine: '' });
    const body = `
    <div style="padding:36px 40px 30px;">
      <span style="${microStyle(T.gold)}">YOUR ATTENDANCE CARD</span>
      <div style="font-family:${T.serif};font-size:28px;line-height:1.15;color:${T.ink};margin-top:10px;">You're on the list, <i>${name}</i>.</div>
      <div style="font-family:${T.sans};font-size:14px;color:${T.soft};line-height:1.65;margin-top:14px;">Your seat at <strong style="color:${T.ink};">${esc(eventName || 'Med&X')}</strong> is confirmed — so we made you a card. Post it, send it, or just keep it: your name is on the guest list either way.</div>
      ${cardVisual}
      ${shareText ? `<div style="font-family:${T.sans};font-size:12.5px;color:${T.soft};line-height:1.6;margin-top:16px;">A line to share it with, if you'd like:<br><span style="font-family:${T.serif};font-style:italic;font-size:14px;color:${T.ink};">"${esc(shareText)}"</span></div>` : ''}
      <div style="text-align:center;margin:24px 0 4px;">
        ${btn('DOWNLOAD MY CARD →', cardDownloadUrl || cardImageUrl)}${walletUrl ? `<span style="display:inline-block;width:8px;">&nbsp;</span>${btn('OPEN MY WALLET', walletUrl, 'ghost')}` : ''}
      </div>
    </div>`;
    return shell({
        title: `I'm attending ${eventName || 'Med&X'}`,
        preheader: `Your ${eventName || 'Med&X'} attendance card is inside.`,
        rule: 'gold',
        bodyHtml: body,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Zagreb`, 'Sent automatically when your registration was confirmed.']
    });
}

// ---------------------------------------------------------------- year-in-review email
function yearInReview({ firstName, year, stats, cardImageUrl, cardDownloadUrl, walletUrl } = {}) {
    const y = year || new Date().getFullYear();
    const name = esc(firstName || 'there');
    const s = stats || {};
    const cells = [
        { n: s.events_registered, label: 'EVENTS' },
        { n: s.events_attended, label: 'ATTENDED' },
        { n: s.connections, label: 'CONNECTIONS' },
        { n: s.certificates, label: 'CERTIFICATES' },
        { n: s.talks, label: 'TALKS' }
    ].filter(c => Number(c.n) > 0).slice(0, 4);
    const statsHtml = cells.length ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid ${T.hairline};background:${T.cardCream};"><tr>
        ${cells.map((c, i) => `<td align="center" style="padding:18px 8px;${i ? `border-left:1px solid ${T.hairline};` : ''}">
          <div style="font-family:${T.serif};font-weight:600;font-size:26px;color:${T.crimson};">${esc(c.n)}</div>
          <div style="margin-top:4px;${microStyle(T.soft, 8.5, '.16em')}">${c.label}</div>
        </td>`).join('')}
      </tr></table>` : '';
    const isPng = /\.png(\?|$)/i.test(String(cardImageUrl || ''));
    const cardVisual = cardImageUrl && isPng
        ? `<img src="${escUrl(cardImageUrl)}" alt="My ${esc(y)} at Med&X" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;margin-top:20px;">`
        : miniCardHtml({ eyebrow: `MED&X · ${esc(y)}`, line1: 'My year at', line2: 'Med&X', metaLine: (s.cities && s.cities.length ? s.cities.join(' · ') : ''), nameLine: firstName || '', subLine: '' });
    const body = `
    <div style="padding:36px 40px 30px;">
      <span style="${microStyle(T.gold)}">${esc(y)} · YOUR YEAR AT MED&amp;X</span>
      <div style="font-family:${T.serif};font-size:28px;line-height:1.15;color:${T.ink};margin-top:10px;">Your <i>${esc(y)}</i>, ${name}.</div>
      <div style="font-family:${T.sans};font-size:14px;color:${T.soft};line-height:1.65;margin-top:14px;">A year of rooms, ideas and introductions — here is yours in one card. Thank you for being part of Med&amp;X.</div>
      ${statsHtml}
      ${cardVisual}
      <div style="text-align:center;margin:24px 0 4px;">
        ${cardDownloadUrl || cardImageUrl ? btn('DOWNLOAD MY CARD →', cardDownloadUrl || cardImageUrl) : ''}${walletUrl ? `<span style="display:inline-block;width:8px;">&nbsp;</span>${btn('OPEN MY MED&X', walletUrl, 'ghost')}` : ''}
      </div>
    </div>`;
    return shell({
        title: `Your ${y} at Med&X`,
        preheader: `Your ${y} at Med&X, in one card.`,
        rule: 'split',
        bodyHtml: body,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Zagreb`, 'Sent once a year — your year-in-review.']
    });
}

// ---------------------------------------------------------------- newsletter service mails
const TOPIC_LABELS = {
    all: 'All Med&X', plexus: 'Plexus', gala: 'Gala Evening',
    accelerator: 'Accelerator', bridges: 'Building Bridges', forum: 'Biomedical Forum'
};
function topicLabels(topics) {
    const list = (Array.isArray(topics) ? topics : []).map(t => TOPIC_LABELS[t] || t);
    return list.length ? list.join(' · ') : 'All Med&X';
}

function newsletterWelcome({ firstName, topics, manageUrl, unsubscribeUrl } = {}) {
    const name = esc(firstName || 'there');
    const body = `
    <div style="padding:36px 40px 30px;">
      <span style="${microStyle(T.gold)}">YOU'RE ON THE LIST</span>
      <div style="font-family:${T.serif};font-size:28px;line-height:1.15;color:${T.ink};margin-top:10px;">The newsletter is yours, <i>${name}</i>.</div>
      <div style="font-family:${T.sans};font-size:14px;color:${T.soft};line-height:1.65;margin-top:14px;">Once a month, the news that matters from the projects you picked — three minutes, no filler.</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;border-left:3px solid ${T.gold};background:${T.cardCream};width:100%;"><tr><td style="padding:14px 18px;">
        <span style="${microStyle(T.soft, 9, '.16em')}">YOUR TOPICS</span>
        <div style="font-family:${T.serif};font-size:16px;color:${T.ink};margin-top:6px;">${esc(topicLabels(topics))}</div>
      </td></tr></table>
      <div style="font-family:${T.sans};font-size:12.5px;color:${T.soft};line-height:1.6;margin-top:16px;">Change topics any time from <strong style="color:${T.ink};">Profile &amp; settings</strong> in the portal, or straight from any issue's footer.</div>
      <div style="text-align:center;margin:24px 0 4px;">${btn('MANAGE MY TOPICS →', manageUrl)}</div>
    </div>`;
    return shell({
        title: 'You are subscribed — Med&X',
        preheader: 'Your Med&X newsletter topics are set.',
        rule: 'split',
        bodyHtml: body,
        footerItems: [
            `© Med&amp;X ${new Date().getFullYear()} · Zagreb`,
            `<a href="${escUrl(manageUrl)}" style="color:${T.soft};text-decoration:underline;">Manage topics</a>`,
            `<a href="${escUrl(unsubscribeUrl)}" style="color:${T.soft};text-decoration:underline;">Unsubscribe</a>`
        ]
    });
}

function newsletterConfirm({ firstName, email, confirmUrl } = {}) {
    const name = esc(firstName || 'there');
    const body = `
    <div style="padding:36px 40px 30px;">
      <span style="${microStyle(T.gold)}">ONE CLICK LEFT</span>
      <div style="font-family:${T.serif};font-size:28px;line-height:1.15;color:${T.ink};margin-top:10px;">Confirm this address, <i>${name}</i>.</div>
      <div style="font-family:${T.sans};font-size:14px;color:${T.soft};line-height:1.65;margin-top:14px;">You asked for the Med&amp;X newsletter at <strong style="color:${T.ink};">${esc(email || 'this address')}</strong>. One click below and it starts arriving — if this wasn't you, simply ignore this email.</div>
      <div style="text-align:center;margin:26px 0;">${btn('CONFIRM MY SUBSCRIPTION →', confirmUrl)}</div>
      <div style="font-family:${T.sans};font-size:12px;color:${T.soft};line-height:1.6;">If the button doesn't work, paste this into your browser:<br>
        <a href="${escUrl(confirmUrl)}" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:${T.crimson};text-decoration:none;word-break:break-all;">${esc(confirmUrl || '')}</a></div>
    </div>`;
    return shell({
        title: 'Confirm your subscription — Med&X',
        preheader: 'One click and the Med&X newsletter starts arriving.',
        rule: 'crimson',
        bodyHtml: body,
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Zagreb`, 'You received this because this address was entered in the Med&amp;X member portal.']
    });
}

// ---------------------------------------------------------------- standalone branded page
// Same brand as the emails, for server-rendered public pages (preference center, unsubscribe
// confirmations). Not an email — a normal responsive page on the cream ground.
function brandedPage({ title, eyebrow, headlineHtml, bodyHtml } = {}) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || 'Med&X')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&amp;family=Inter:wght@400..700&amp;display=swap" rel="stylesheet">
<style>
  body{margin:0;background:${T.canvas};font-family:${T.sans};color:${T.ink};-webkit-text-size-adjust:100%}
  a{color:${T.crimson};text-decoration:none} a:hover{color:${T.ink}}
  .card{max-width:600px;margin:40px auto;background:${T.cream};box-shadow:0 10px 34px rgba(25,21,18,.18)}
  .hd{background:${T.ink};padding:22px 40px;display:flex;align-items:center}
  .hd img{height:20px;display:block}
  .hd span{margin-left:auto;font-weight:600;font-size:9px;letter-spacing:.2em;color:${T.gold};text-transform:uppercase}
  .rule{height:2px;background:linear-gradient(90deg,${T.crimson} 0 50%,${T.gold} 50% 100%)}
  .bd{padding:36px 40px 30px}
  .eyebrow{font-weight:600;font-size:10px;letter-spacing:.18em;color:${T.gold};text-transform:uppercase}
  h1{font-family:${T.serif};font-weight:400;font-size:28px;line-height:1.15;margin:10px 0 0}
  .ft{border-top:1px solid ${T.hairline};padding:18px 40px;font-size:11px;color:${T.soft};display:flex;gap:12px;flex-wrap:wrap}
  .ft b{color:${T.gold};font-weight:400}
  label.topic{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid rgba(25,21,18,.1);cursor:pointer;font-size:14px}
  label.topic input{accent-color:${T.crimson};margin-top:3px;width:15px;height:15px}
  label.topic .hint{display:block;font-size:11.5px;color:${T.soft};margin-top:2px}
  button.mx{margin-top:22px;padding:14px 30px;border:none;background:${T.crimson};color:${T.cream};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;cursor:pointer;text-transform:uppercase}
  button.mx:hover{background:#7e151b}
  .ghost{display:inline-block;margin-top:22px;padding:13px 26px;border:1px solid rgba(25,21,18,.3);color:${T.ink};font-weight:600;font-size:11px;letter-spacing:.16em;text-transform:uppercase}
  @media (max-width:640px){.bd,.hd,.ft{padding-left:22px;padding-right:22px}.card{margin:16px}}
</style>
</head>
<body>
<div class="card">
  <div class="hd"><img src="${escUrl(logoUrl())}" alt="med&amp;X"><span>MEMBER PORTAL</span></div>
  <div class="rule"></div>
  <div class="bd">
    ${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
    ${headlineHtml ? `<h1>${headlineHtml}</h1>` : ''}
    ${bodyHtml || ''}
  </div>
  <div class="ft"><span>© Med&amp;X ${new Date().getFullYear()} · Zagreb</span><b>·</b><span><a href="https://medx.hr" style="color:${T.soft};text-decoration:underline;">medx.hr</a></span></div>
</div>
</body>
</html>`;
}

// v2/index.js auto-mounts every .js file in this folder by calling it as (app, ctx) — this is
// a pure template library, so the export is a no-op mount function with the builders attached
// as properties: require('./v2/email-templates').ticketConfirmation({...}) works everywhere.
function mount(/* app, ctx */) { /* template library — no routes, no tables */ }
Object.assign(mount, {
    confirmEmail, ticketConfirmation, newsletter, attendanceCard, yearInReview,
    newsletterWelcome, newsletterConfirm, brandedPage,
    TOPIC_LABELS, topicLabels, esc, escUrl, T
});
module.exports = mount;
