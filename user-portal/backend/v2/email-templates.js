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

function btn(label, href, kind, extra) {
    const solid = `display:inline-block;white-space:nowrap;padding:15px 34px;background:${T.crimson};color:${T.cream};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const ghost = `display:inline-block;white-space:nowrap;padding:14px 30px;border:1px solid rgba(25,21,18,.3);color:${T.ink};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const gold = `display:inline-block;white-space:nowrap;padding:14px 30px;background:${T.gold};color:#191512;font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const ink = `display:inline-block;white-space:nowrap;padding:14px 30px;background:#191512;color:#f7f1e6;font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    return `<a href="${escUrl(href)}" style="${kind === 'ghost' ? ghost : kind === 'gold' ? gold : kind === 'ink' ? ink : solid}${extra || ''}">${label}</a>`;
}
// the wallet stack: three actions, ONE width — appended last so it beats the kind padding
const BTN_STACK_W = 'width:260px;max-width:100%;padding-left:0;padding-right:0;text-align:center;box-sizing:border-box;';

// The 600px shell: ink header (logo + right micro-label), accent rule, body, hairline footer.
// rule: 'crimson' | 'gold' | 'split' (newsletter's 50/50 crimson→gold).
function shell({ title, preheader, headerRightLabel, headerExtraHtml, rule, bodyHtml, footerItems, lang }) {
    const ruleBg = rule === 'gold' ? `background:${T.gold};`
        : rule === 'split' ? `background:${T.crimson};background:linear-gradient(90deg,${T.crimson} 0 50%,${T.gold} 50% 100%);`
        : `background:${T.crimson};`;
    const footer = (footerItems && footerItems.length ? footerItems : [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`])
        .map(it => `<div style="font-family:${T.sans};font-size:11px;color:${T.soft};line-height:1.7;">${it}</div>`).join('');
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
  <tr><td align="center" style="border-top:1px solid ${T.hairline};padding:18px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">${footer}</td></tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-top:12px;"><tr>
      <td style="${microStyle(T.goldDark, 9, '.16em')};vertical-align:middle;"><a href="https://medx.hr" style="color:${T.goldDark};text-decoration:none;">MEDX.HR</a></td>
      <td style="padding:0 0 0 16px;vertical-align:middle;"><a href="https://www.facebook.com/profile.php?id=61554188818525"><img src="https://medx-member-portal-v2.netlify.app/assets/social/facebook.png?v=2" width="16" height="16" style="display:block;border:0;" alt="Facebook"></a></td>
      <td style="padding:0 0 0 14px;vertical-align:middle;"><a href="https://www.instagram.com/medx_association/"><img src="https://medx-member-portal-v2.netlify.app/assets/social/instagram.png?v=2" width="16" height="16" style="display:block;border:0;" alt="Instagram"></a></td>
      <td style="padding:0 0 0 14px;vertical-align:middle;"><a href="https://www.linkedin.com/company/med-x-association/"><img src="https://medx-member-portal-v2.netlify.app/assets/social/linkedin.png?v=2" width="16" height="16" style="display:block;border:0;" alt="LinkedIn"></a></td>
    </tr></table>
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
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`,
            hr ? 'Ovu ste poruku primili jer je s ovom adresom otvoren račun.' : 'You received this because an account was created with this address.']
    });
}

// ---------------------------------------------------------------- 02 · TICKET CONFIRMATION
function ticketConfirmation({ firstName, eventName, dateLabel, whenLines, venue, qrPngUrl, passUrl, walletUrl,
                              calendarUrl, ticketLabel, priceLabel, guestLabel, ticketNumber,
                              dressLabel, tableLabel, headlineHtml, introHtml, note, ctaLabel, replyLine, walletSaveUrl, appleWalletUrl } = {}) {
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
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto 0;">
                ${appleWalletUrl ? `<tr><td align="center" style="padding:0 0 10px;">${btn('ADD TO APPLE WALLET →', appleWalletUrl, 'ink', BTN_STACK_W)}</td></tr>` : ''}
                ${walletSaveUrl ? `<tr><td align="center" style="padding:0 0 10px;">${btn('ADD TO GOOGLE WALLET →', walletSaveUrl, 'gold', BTN_STACK_W)}</td></tr>` : ''}
                ${calendarUrl ? `<tr><td align="center" style="padding:0 0 10px;">${btn('ADD TO CALENDAR →', calendarUrl, 'ghost', BTN_STACK_W)}</td></tr>` : ''}
              </table>
              <div style="font-family:${T.sans};font-size:11px;color:${T.soft};">Tap Add to Wallet to add your ticket to Apple or Google Wallet${calendarUrl ? ' — and Add to Calendar to save the dates' : ''}.</div>` : ''}
            </td>
          </tr></table>` : '';
    const ctaUrl = passUrl || walletUrl;
    const body = `
    <div style="padding:32px 28px 26px;">
      <span style="${microStyle(T.gold)}">YOU'RE GOING</span>
      <div style="font-family:${T.serif};font-size:26px;line-height:1.18;color:${T.ink};margin-top:10px;">${headlineHtml || `${esc(eventName || 'Your seat')} — seat <i>confirmed</i>.`}</div>
      ${introHtml ? `<div style="font-family:${T.sans};font-size:13.5px;color:${T.soft};line-height:1.65;margin-top:12px;">${introHtml}</div>` : ''}
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
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Questions? Reply to this email or write to laura.rodman@medx.hr']
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
            `© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`,
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
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Sent automatically when your registration was confirmed.']
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
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'Sent once a year — your year-in-review.']
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
            `© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`,
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
        footerItems: [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`, 'You received this because this address was entered in the Med&amp;X member portal.']
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
  <div class="ft"><span>© Med&amp;X ${new Date().getFullYear()} · Split, Croatia</span><b>·</b><span><a href="https://medx.hr" style="color:${T.soft};text-decoration:underline;">medx.hr</a></span></div>
</div>
</body>
</html>`;
}

// ================================================================ TRANSACTIONAL SET (2026-08-30)
// Eleven additional builders completing the portal's transactional surface — payments, transfers,
// cancellations, event reminders, Accelerator letters, Forum invitations, certificates, and the
// morning-after survey. Same contract as everything above: PURE functions, plain params in, one
// full HTML document out, rendered through the same shell()/btn() house style.
//
//   paymentReceived({ firstName, amountLabel, invoiceNumber, itemsLabel, qrPngUrl?, locale? })
//   paymentReminder({ firstName, amountLabel, payUrl, deadlineLabel?, locale? })
//   registrationCancelled({ firstName, eventName, locale? })
//   seatTransferred({ firstName, toName, eventName, locale? })
//   transferReceived({ firstName, fromName, eventName, qrPngUrl, walletSaveUrl?, appleWalletUrl?,
//                      calendarUrl?, locale? })
//   eventReminder({ firstName, eventName, whenLines, venueLines?, daysOut, qrPngUrl, locale? })
//   acceleratorReceived({ firstName, locale? })
//   acceleratorDecision({ firstName, accepted, locale? })
//   forumInvitation({ firstName, inviterLine?, code, enterUrl, locale? })
//   certificateOfAttendance({ firstName, eventName, downloadUrl, locale? })
//   surveyMorningAfter({ firstName, eventName, surveyUrl, locale? })
//
// locale: 'hr' renders first-class Croatian (written, not machine-translated); anything else
// renders English. Brand rules hold throughout: € never EUR · diacritics kept · no mailto links
// (contact addresses appear as plain footer text) · FIRA invoice NUMBERS are referenced only —
// invoices themselves are issued exclusively through FIRA, never generated here.

// ---- small shared pieces (used by the transactional set only — nothing above touches these) ----
const txCopyright = () => `© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`;
const txReplyLine = (hr) => hr
    ? 'Pitanja? Odgovorite na ovu poruku ili pišite na laura.rodman@medx.hr'
    : 'Questions? Reply to this email or write to laura.rodman@medx.hr';
const txEyebrow = (label) => `<span style="${microStyle(T.gold)}">${label}</span>`;
const txHeadline = (html) => `<div style="font-family:${T.serif};font-size:28px;line-height:1.15;color:${T.ink};margin-top:10px;">${html}</div>`;
const txPara = (html, mt) => `<div style="font-family:${T.sans};font-size:14px;color:${T.soft};line-height:1.65;margin-top:${mt == null ? 14 : mt}px;">${html}</div>`;
const txSmall = (html, mt) => `<div style="font-family:${T.sans};font-size:12px;color:${T.soft};line-height:1.6;margin-top:${mt == null ? 16 : mt}px;">${html}</div>`;
// ", <i>Ana</i>" headline suffix — English falls back to "there" (confirmEmail's convention),
// Croatian simply drops the clause when the name is unknown.
const txNameSuffix = (firstName, hr) => firstName ? `, <i>${esc(firstName)}</i>` : (hr ? '' : ', <i>there</i>');
const txFactRow = (label, valueHtml) => `
        <tr><td style="padding:5px 0;vertical-align:baseline;width:86px;${microStyle(T.soft, 9, '.12em')}">${label}</td>
            <td style="padding:5px 0 5px 10px;vertical-align:baseline;">${valueHtml}</td></tr>`;
const txFactValue = (v) => `<span style="font-family:${T.sans};font-size:13px;color:${T.ink};">${esc(v)}</span>`;
const txFactsCard = (rowsHtml, extraHtml) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid rgba(201,169,98,.65);background:${T.cardCream};">
        <tr><td style="padding:18px 20px;">
          ${rowsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>` : ''}
          ${extraHtml || ''}
        </td></tr>
      </table>`;
// One stacked WHEN line; the part before the first " — " renders bold (ticketConfirmation's rule).
const txWhenLine = (l) => {
    const s = String(l); const i = s.indexOf(' — ');
    const head = i > 0 ? s.slice(0, i) : null; const rest = i > 0 ? s.slice(i) : s;
    return `<span style="display:block;font-family:${T.sans};font-size:13px;line-height:1.6;color:${T.ink};">${head ? `<strong>${esc(head)}</strong>` : ''}${esc(rest)}</span>`;
};
const txPasteLine = (url, hr) => `<div style="font-family:${T.sans};font-size:12px;color:${T.soft};line-height:1.6;margin-top:14px;">${hr ? 'Ako gumb ne radi, zalijepite ovo u svoj preglednik:' : `If the button doesn't work, paste this into your browser:`}<br>
        <a href="${escUrl(url)}" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:${T.crimson};text-decoration:none;word-break:break-all;">${esc(url || '')}</a></div>`;
// Centred white-tile QR (120px — door scanners read it off a screen) with the optional
// Apple / Google / calendar stack underneath, all three actions one width (BTN_STACK_W).
function txQrPanel({ qrPngUrl, hr, walletSaveUrl, appleWalletUrl, calendarUrl } = {}) {
    if (!qrPngUrl) return '';
    const img = `<img src="${escUrl(qrPngUrl)}" alt="${hr ? 'Vaš QR kod za ulaz' : 'Your entry QR code'}" width="120" height="120" style="display:block;width:120px;height:120px;border:0;">`;
    const stack = (walletSaveUrl || appleWalletUrl || calendarUrl) ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto 0;">
                ${appleWalletUrl ? `<tr><td align="center" style="padding:0 0 10px;">${btn(hr ? 'DODAJTE U APPLE WALLET →' : 'ADD TO APPLE WALLET →', appleWalletUrl, 'ink', BTN_STACK_W)}</td></tr>` : ''}
                ${walletSaveUrl ? `<tr><td align="center" style="padding:0 0 10px;">${btn(hr ? 'DODAJTE U GOOGLE WALLET →' : 'ADD TO GOOGLE WALLET →', walletSaveUrl, 'gold', BTN_STACK_W)}</td></tr>` : ''}
                ${calendarUrl ? `<tr><td align="center" style="padding:0 0 10px;">${btn(hr ? 'DODAJTE U KALENDAR →' : 'ADD TO CALENDAR →', calendarUrl, 'ghost', BTN_STACK_W)}</td></tr>` : ''}
              </table>` : '';
    return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td align="center" style="padding-top:16px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ffffff;border:1px solid ${T.hairline};padding:8px;">
                <a href="${escUrl(qrPngUrl)}" style="display:block;text-decoration:none;">${img}</a>
              </td></tr></table>
              <div style="${microStyle(T.soft, 9, '.14em')};margin-top:8px;">${hr ? 'VAŠ QR ZA ULAZ · POKAŽITE NA VRATIMA' : 'YOUR ENTRY QR · SHOW AT THE DOOR'}</div>
              <div style="font-family:${T.sans};font-size:11px;color:${T.soft};margin-top:4px;">${hr ? 'Dodirnite QR da ga povećate — pa ga spremite u svoje fotografije.' : 'Tap the QR to enlarge it — then save it to your photos.'}</div>${stack}
            </td>
          </tr></table>`;
}

// ---------------------------------------------------------------- 09 · PAYMENT RECEIVED
// Confirms a processed payment and references its FIRA fiscal invoice NUMBER. The fiscal invoice
// itself is issued through FIRA (fiskalizacija) and arrives separately — this email never
// generates or replaces an invoice.
function paymentReceived({ firstName, amountLabel, invoiceNumber, itemsLabel, qrPngUrl, locale } = {}) {
    const hr = locale === 'hr';
    const rows = [
        amountLabel ? txFactRow(hr ? 'IZNOS' : 'AMOUNT', `<span style="font-family:${T.serif};font-size:16px;color:${T.ink};">${esc(amountLabel)}</span>`) : '',
        itemsLabel ? txFactRow(hr ? 'STAVKE' : 'ITEMS', txFactValue(itemsLabel)) : '',
        invoiceNumber ? txFactRow(hr ? 'RAČUN' : 'INVOICE', `<span style="font-family:ui-monospace,Menlo,monospace;font-size:13px;letter-spacing:.04em;color:${T.ink};">${esc(invoiceNumber)}</span>`) : ''
    ].join('');
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'UPLATA PRIMLJENA' : 'PAYMENT RECEIVED')}
      ${txHeadline((hr ? 'Uplata je primljena' : 'Payment received') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? 'Hvala vam — uplata je uspješno obrađena i sve je potvrđeno. Pojedinosti su u nastavku.'
        : 'Thank you — your payment went through and everything is confirmed. The details are below.')}
      ${txFactsCard(rows, qrPngUrl ? txQrPanel({ qrPngUrl, hr }) : '')}
      ${invoiceNumber ? txSmall(hr
        ? `Fiskalni račun izdan je kroz servis FIRA pod gornjim brojem i stiže vam zasebnom porukom — ovu potvrdu čuvajte za svoju evidenciju.`
        : `Your fiscal invoice was issued through FIRA under the number above and reaches you separately — keep this confirmation for your records.`) : ''}
    </div>`;
    return shell({
        title: hr ? 'Uplata primljena — Med&X' : 'Payment received — Med&X',
        preheader: hr
            ? `Uplata je primljena${invoiceNumber ? ' — račun ' + invoiceNumber : ''}.`
            : `Your payment is in${invoiceNumber ? ' — invoice ' + invoiceNumber : ''}.`,
        rule: 'gold',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Ovu ste poruku primili jer je vaša uplata uspješno obrađena.' : 'You received this because your payment was processed.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 10 · PAYMENT REMINDER
// Polite, unhurried, one clear action. Never sent to someone who has already paid — the copy
// still covers the crossing-in-the-mail case.
function paymentReminder({ firstName, amountLabel, payUrl, deadlineLabel, locale } = {}) {
    const hr = locale === 'hr';
    const amount = amountLabel ? `<strong style="color:${T.ink};">${esc(amountLabel)}</strong>` : (hr ? 'preostali iznos' : 'the remaining amount');
    const deadline = deadlineLabel ? `<strong style="color:${T.ink};">${esc(deadlineLabel)}</strong>` : '';
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'MALI PODSJETNIK' : 'A GENTLE REMINDER')}
      ${txHeadline((hr ? 'Vaše mjesto još čeka' : 'Your seat is still waiting') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? `Samo kratki podsjetnik — vaša je prijava zaprimljena, a do potvrđenog mjesta dijeli vas još samo uplata od ${amount}. Čim uplata stigne, ulaznica i QR kod kreću prema vama automatski.`
        : `Just a small nudge — your registration is in, and only the payment of ${amount} stands between you and a confirmed seat. The moment it arrives, your ticket and QR code follow automatically.`)}
      ${deadline ? txPara(hr
        ? `Kako bi mjesto ostalo vaše, molimo vas da uplatu dovršite do ${deadline}.`
        : `To keep the seat yours, please complete it by ${deadline}.`, 10) : ''}
      <div style="text-align:center;margin:26px 0;">${btn(hr ? 'DOVRŠITE UPLATU →' : 'COMPLETE MY PAYMENT →', payUrl)}</div>
      ${txSmall(hr
        ? 'Ako ste uplatu upravo izvršili, ova se poruka mimoišla s njom — slobodno je zanemarite.'
        : 'If you have just paid, this note simply crossed paths with your payment — please ignore it.', 0)}
      ${txPasteLine(payUrl, hr)}
    </div>`;
    return shell({
        title: hr ? 'Podsjetnik na uplatu — Med&X' : 'Payment reminder — Med&X',
        preheader: hr ? 'Vaše mjesto čeka još samo uplatu.' : 'Your seat is one payment away.',
        rule: 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Ovu ste poruku primili jer vaša prijava čeka uplatu.' : 'You received this because your registration is awaiting payment.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 11 · REGISTRATION CANCELLED
function registrationCancelled({ firstName, eventName, locale } = {}) {
    const hr = locale === 'hr';
    const ev = `<strong style="color:${T.ink};">${esc(eventName || 'Med&X')}</strong>`;
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'PRIJAVA OTKAZANA' : 'REGISTRATION CANCELLED')}
      ${txHeadline((hr ? 'Vaša je prijava otkazana' : 'Your registration is cancelled') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? `Vaša prijava za ${ev} upravo je otkazana i dosadašnji QR kod više ne vrijedi za ulaz. Ako je uplata bila izvršena, povrat ide natrag na karticu s koje je stigla — na izvodu se obično vidi u roku od 5 do 10 radnih dana.`
        : `Your registration for ${ev} has been cancelled, and its QR code no longer admits entry. If a payment was made, the refund travels back to the card it came from — it usually shows on a statement within 5 to 10 business days.`)}
      ${txPara(hr
        ? 'Žao nam je što se ovaj put mimoilazimo. Vrata ostaju otvorena — dobro nam došli na svako sljedeće Med&amp;X okupljanje.'
        : 'We are sorry to miss you this time. The door stays open — you are welcome at any Med&amp;X gathering to come.')}
    </div>`;
    return shell({
        title: hr ? 'Prijava otkazana — Med&X' : 'Registration cancelled — Med&X',
        preheader: hr
            ? `Vaša prijava za ${eventName || 'Med&X'} je otkazana.`
            : `Your ${eventName || 'Med&X'} registration has been cancelled.`,
        rule: 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Ovu ste poruku primili jer je prijava povezana s ovom adresom otkazana.' : 'You received this because a registration tied to this address was cancelled.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 12 · SEAT TRANSFERRED (to the original holder)
function seatTransferred({ firstName, toName, eventName, locale } = {}) {
    const hr = locale === 'hr';
    const ev = `<strong style="color:${T.ink};">${esc(eventName || 'Med&X')}</strong>`;
    const to = `<strong style="color:${T.ink};">${esc(toName || (hr ? 'vašeg kolegu' : 'your colleague'))}</strong>`;
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'ULAZNICA PRENESENA' : 'TICKET TRANSFERRED')}
      ${txHeadline(hr
        ? `Vaša ulaznica sada glasi na <i>${esc(toName || 'novog gosta')}</i>.`
        : `Your seat now belongs to <i>${esc(toName || 'your colleague')}</i>.`)}
      ${txPara(hr
        ? `Prijenos je dovršen — vaša ulaznica za ${ev} sada glasi na ${to}, a novi QR kod upravo je krenuo na tu adresu. Vaš dosadašnji kod više ne vrijedi za ulaz.`
        : `The transfer is complete — your ticket for ${ev} has been reissued to ${to}, whose own QR code is already on its way. Yours no longer admits entry.`)}
      ${txPara(hr
        ? 'Hvala vam što ste mjesto proslijedili dalje umjesto da ostane prazno — puno nam znači kad je dvorana puna pravih ljudi.'
        : 'Thank you for passing the seat on rather than letting it sit empty — a room full of the right people is what these evenings are made of.')}
    </div>`;
    return shell({
        title: hr ? 'Ulaznica prenesena — Med&X' : 'Ticket transferred — Med&X',
        preheader: hr
            ? `Vaša ulaznica za ${eventName || 'Med&X'} prenesena je na ${toName || 'novog gosta'}.`
            : `Your ${eventName || 'Med&X'} ticket now belongs to ${toName || 'your colleague'}.`,
        rule: 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Ovu ste poruku primili jer je ulaznica s ove adrese prenesena na drugu osobu.' : 'You received this because a ticket on this address was transferred to someone else.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 13 · TRANSFER RECEIVED (the warm welcome)
function transferReceived({ firstName, fromName, eventName, qrPngUrl, walletSaveUrl, appleWalletUrl, calendarUrl, locale } = {}) {
    const hr = locale === 'hr';
    const ev = `<strong style="color:${T.ink};">${esc(eventName || 'Med&X')}</strong>`;
    const from = `<strong style="color:${T.ink};">${esc(fromName || (hr ? 'Vaš kolega' : 'A colleague'))}</strong>`;
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'MJESTO S VAŠIM IMENOM' : 'A SEAT WITH YOUR NAME ON IT')}
      ${txHeadline((hr ? 'Mjesto je vaše' : 'The seat is yours') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? `${from} ovaj put ne može doći na ${ev} — pa svoje mjesto prepušta vama. I gotovo je: ulaznica sada glasi na vaše ime, a QR kod u nastavku samo je vaš.`
        : `${from} cannot make it to ${ev} this time — and asked us to give their seat to you. It is done: the ticket now carries your name, and the QR code below is yours alone.`)}
      ${txPara(hr
        ? 'Dobro nam došli. Sve što je išlo uz mjesto ide sada s vama — večer, program i društvo. Radujemo se što ćemo vas upoznati.'
        : 'Welcome. Everything that came with the seat now travels with you — the evening, the program, the company. We look forward to meeting you.')}
      ${txFactsCard('', txQrPanel({ qrPngUrl, hr, walletSaveUrl, appleWalletUrl, calendarUrl }))}
      ${txSmall(hr
        ? 'Na vratima samo pokažite QR — ništa drugo ne trebate ponijeti.'
        : 'At the door, just show the QR — there is nothing else you need to bring.')}
    </div>`;
    return shell({
        title: hr ? `Vaše mjesto — ${eventName || 'Med&X'}` : `Your seat — ${eventName || 'Med&X'}`,
        preheader: hr
            ? `${fromName || 'Kolega'} vam prepušta svoje mjesto — vaš QR je unutra.`
            : `${fromName || 'A colleague'} passed you their seat — your QR is inside.`,
        rule: 'gold',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Ovu ste poruku primili jer je Med&amp;X ulaznica prenesena na ovu adresu.' : 'You received this because a Med&amp;X ticket was transferred to this address.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 14 · EVENT REMINDER (T-7 / T-2)
// daysOut 7 opens with the plan and closes with the QR; daysOut 2 leads with the QR — two days
// out, the code IS the message.
function eventReminder({ firstName, eventName, whenLines, venueLines, daysOut, qrPngUrl, locale } = {}) {
    const hr = locale === 'hr';
    const two = Number(daysOut) === 2;
    const whenHtml = (Array.isArray(whenLines) ? whenLines : (whenLines ? [whenLines] : [])).map(txWhenLine).join('');
    const venueHtml = (Array.isArray(venueLines) ? venueLines : (venueLines ? [venueLines] : [])).map(txWhenLine).join('');
    const rows = [
        txFactRow(hr ? 'DOGAĐANJE' : 'EVENT', `<span style="font-family:${T.serif};font-size:16px;color:${T.ink};">${esc(eventName || 'Med&X')}</span>`),
        whenHtml ? txFactRow(hr ? 'KADA' : 'WHEN', whenHtml) : '',
        venueHtml ? txFactRow(hr ? 'GDJE' : 'WHERE', venueHtml) : ''
    ].join('');
    const qr = txQrPanel({ qrPngUrl, hr });
    const eyebrow = two
        ? (hr ? 'JOŠ DVA DANA' : 'TWO DAYS TO GO')
        : (hr ? 'JOŠ TJEDAN DANA' : 'ONE WEEK TO GO');
    const headline = two
        ? ((hr ? 'Vidimo se za dva dana' : 'See you in two days') + txNameSuffix(firstName, hr) + '.')
        : (hr ? `Tjedan dana do događanja <i>${esc(eventName || 'Med&X')}</i>.` : `One week until <i>${esc(eventName || 'Med&X')}</i>.`);
    const body = two ? `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(eyebrow)}
      ${txHeadline(headline)}
      ${txPara(hr
        ? 'Najvažnije odmah na vrh: vaš QR kod za ulaz. Pokažite ga na vratima — i to je sve.'
        : 'First things first: your entry QR. Show it at the door — that is all it takes.', 12)}
      ${txFactsCard('', qr)}
      ${txPara(hr ? 'A za svaki slučaj, još jednom gdje i kada:' : 'And once more, the where and when:', 18)}
      ${txFactsCard(rows)}
      ${txSmall(hr ? 'Radujemo se — vidimo se!' : 'We are looking forward to it — see you there.')}
    </div>` : `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(eyebrow)}
      ${txHeadline(headline)}
      ${txPara(hr
        ? `Za tjedan dana vidimo se uživo. Ovdje je sve na jednom mjestu — plan, mjesto i vaš QR za ulaz, spreman kad i vi budete.`
        : `A week from now we meet in person. Here is everything in one place — the plan, the venue, and your entry QR, ready when you are.`)}
      ${txFactsCard(rows, qr)}
      ${txSmall(hr
        ? 'Ne trebate ništa potvrđivati — vaše mjesto stoji. Ako ipak ne možete doći, javite nam se da mjesto ne ostane prazno.'
        : 'There is nothing to confirm — your seat stands. If your plans change, do let us know so the seat does not go empty.')}
    </div>`;
    return shell({
        title: hr
            ? `${two ? 'Za dva dana' : 'Za tjedan dana'}: ${eventName || 'Med&X'}`
            : `${two ? 'In two days' : 'One week out'}: ${eventName || 'Med&X'}`,
        preheader: hr
            ? `${eventName || 'Med&X'} ${two ? 'je za dva dana' : 'je za tjedan dana'} — vaš QR je unutra.`
            : `${eventName || 'Med&X'} is ${two ? 'two days' : 'one week'} away — your QR is inside.`,
        rule: two ? 'gold' : 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? `Poslano jer ste prijavljeni na ${esc(eventName || 'Med&X')}.` : `Sent because you are registered for ${esc(eventName || 'Med&X')}.`,
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 15 · ACCELERATOR — APPLICATION RECEIVED
function acceleratorReceived({ firstName, locale } = {}) {
    const hr = locale === 'hr';
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'PRIJAVA ZAPRIMLJENA' : 'APPLICATION RECEIVED')}
      ${txHeadline((hr ? 'Vaša je prijava kod nas' : 'Your application is in') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? 'Hvala vam što ste svoj projekt povjerili Med&amp;X Acceleratoru. Prijava je sada pred recenzentskim panelom — svaku čitamo u cijelosti, i to ljudi koji se ovim poslom i sami bave.'
        : 'Thank you for putting your project forward for the Med&amp;X Accelerator. It now sits with the review panel — every application is read in full, by people who do this work themselves.')}
      ${txPara(hr
        ? 'Javit ćemo vam se čim recenzija završi, kakav god ishod bio. Do tada ne trebate učiniti ništa — svaki pomak vidjet ćete na kartici svoje prijave u portalu.'
        : 'You will hear from us the moment the review closes, whichever way it goes. Until then there is nothing you need to do — any movement shows on your application card in the portal.')}
    </div>`;
    return shell({
        title: hr ? 'Prijava zaprimljena — Med&X Accelerator' : 'Application received — Med&X Accelerator',
        preheader: hr ? 'Vaša prijava u Accelerator je zaprimljena i ide na recenziju.' : 'Your Accelerator application is in and headed to review.',
        rule: 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Poslano na adresu iz vaše prijave u Med&amp;X Accelerator.' : 'Sent to the address on your Med&amp;X Accelerator application.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 16 · ACCELERATOR — DECISION
// The rejection letter is the one that matters: it is most of what most applicants will ever
// receive from us, so it is generous, specific about the numbers game, and leaves two doors
// open — reapply, and stay in the network. No corporate filler.
function acceleratorDecision({ firstName, accepted, locale } = {}) {
    const hr = locale === 'hr';
    if (accepted) {
        const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'DOBRO DOŠLI U GENERACIJU' : 'WELCOME TO THE COHORT')}
      ${txHeadline((hr ? 'Primljeni ste' : 'You are in') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? 'Recenzija je gotova i odluka je jednoglasna: vaše je mjesto u ovogodišnjoj generaciji Med&amp;X Acceleratora potvrđeno. Čestitamo — među mnogo dobrih prijava, vaša se izdvojila.'
        : 'The review is in, and the answer is yes: your place in this year\’s Med&amp;X Accelerator cohort is confirmed. Congratulations — in a strong field, yours stood out.')}
      ${txPara(hr
        ? 'Sve praktično — termini, mentori i prvi koraci — stiže vam u zasebnoj poruci ovih dana, a kartica vaše prijave u portalu već pokazuje novi status. Zasad samo jedno: bravo.'
        : 'Everything practical — dates, mentors, first steps — follows in a separate note over the coming days, and your application card in the portal already shows the new status. For now, just this: well done.')}
    </div>`;
        return shell({
            title: hr ? 'Primljeni ste — Med&X Accelerator' : 'You are in — Med&X Accelerator',
            preheader: hr ? 'Vaše mjesto u generaciji Acceleratora je potvrđeno.' : 'Your place in the Accelerator cohort is confirmed.',
            rule: 'gold',
            bodyHtml: body,
            lang: hr ? 'hr' : 'en',
            footerItems: [txCopyright(),
                hr ? 'Poslano na adresu iz vaše prijave u Med&amp;X Accelerator.' : 'Sent to the address on your Med&amp;X Accelerator application.',
                txReplyLine(hr)]
        });
    }
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'VAŠA PRIJAVA' : 'YOUR APPLICATION')}
      ${txHeadline((hr ? 'Ovaj put — ne' : 'Not this year') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? 'Vašu smo prijavu pročitali u cijelosti, i to više puta. Ovo je poruka koju najmanje volimo pisati: ove vam godine ne možemo ponuditi mjesto u generaciji.'
        : 'We read your application in full, more than once. This is the email we least like writing: we cannot offer you a place in this year\’s cohort.')}
      ${txPara(hr
        ? 'Da bude jasno što to znači, a što ne: generacija ima svega nekoliko mjesta, a ovaj je ciklus donio višestruko više prijava koje bismo rado primili nego mjesta koja imamo. Granica između posljednjeg \„da\“ i prvog \„ne\“ bila je neugodno tanka — ovo je odluka o kapacitetu, ne presuda o vašem radu.'
        : 'To be clear about what that means and what it does not: the cohort holds only a handful of places, and this cycle brought several times more applications we would gladly have taken than places we had. The line between the final yes and the first no was uncomfortably thin — this is a decision about capacity, not a verdict on your work.')}
      ${txPara(hr
        ? 'Prijavite se ponovno. Prozor za sljedeći ciklus otvorit će se u portalu, vaša prijava ostaje kod nas, a ponovljena prijava koja pokaže godinu dana pomaka čita se snažnije od prve — recenzenti to primijete.'
        : 'Apply again. The next cycle\’s window opens in the portal, your application stays on file with us, and a returning application that shows a year of movement reads stronger than a first one — reviewers notice.')}
      ${txPara(hr
        ? 'I ništa se od danas ne mijenja u vašem mjestu među nama: mreža članova, događanja i ljudi ostaju vam otvoreni. Ako bi vam prije sljedećeg prozora dobro došao još jedan par očiju na projektu, odgovorite na ovu poruku — čitamo svaku.'
        : 'And nothing about today changes your place among us: the member network, the events, and the people all stay open to you. If another pair of eyes on your project would help before the next window, reply to this email — we read every one.')}
      <div style="font-family:${T.serif};font-style:italic;font-size:16px;color:${T.ink};margin-top:22px;">${hr ? 'Gradite dalje. Nadamo se da ćemo vas ponovno čitati.' : 'Keep building. We hope to read you again.'}</div>
    </div>`;
    return shell({
        title: hr ? 'Odluka o vašoj prijavi — Med&X Accelerator' : 'About your application — Med&X Accelerator',
        preheader: hr ? 'Odluka o vašoj prijavi u Accelerator — i što dalje.' : 'The decision on your Accelerator application — and what comes next.',
        rule: 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Poslano na adresu iz vaše prijave u Med&amp;X Accelerator.' : 'Sent to the address on your Med&amp;X Accelerator application.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 17 · FORUM INVITATION
// Invitation-only register: quiet, personal, the code displayed large. inviterLine is an
// optional, already-composed sentence (e.g. "At the recommendation of Prof. Marija Horvat.").
function forumInvitation({ firstName, inviterLine, code, enterUrl, locale } = {}) {
    const hr = locale === 'hr';
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'BIOMEDICINSKI FORUM · ISKLJUČIVO UZ POZIVNICU' : 'THE BIOMEDICAL FORUM · BY INVITATION')}
      ${txHeadline(hr
        ? `Pozivnica u <i>Forum</i>${firstName ? ', ' + esc(firstName) : ''}.`
        : `An invitation to the <i>Forum</i>${firstName ? ', ' + esc(firstName) : ''}.`)}
      ${inviterLine ? `<div style="font-family:${T.serif};font-style:italic;font-size:15px;color:${T.ink};margin-top:12px;">${esc(inviterLine)}</div>` : ''}
      ${txPara(hr
        ? 'U ime Med&amp;X-a, zadovoljstvo nam je pozvati vas u Biomedicinski forum — stalnu mrežu ljudi koji vode medicinu, znanost i industriju, u koju se ulazi isključivo uz pozivnicu i koja se jednom godišnje okuplja uživo.'
        : 'On behalf of Med&amp;X, it is our pleasure to invite you to join the Biomedical Forum — a standing network of the people who lead medicine, science, and industry, entered by invitation only, gathering in person once a year.')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid rgba(201,169,98,.65);background:${T.cardCream};">
        <tr><td align="center" style="padding:20px 22px;">
          <span style="${microStyle(T.goldDark, 9, '.16em')}">${hr ? 'VAŠ POZIVNI KOD' : 'YOUR INVITATION CODE'}</span>
          <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:600;font-size:26px;letter-spacing:.14em;color:${T.ink};margin-top:8px;">${esc(code || '')}</div>
        </td></tr>
      </table>
      ${txSmall(hr ? 'Jedan kod vrijedi za jednu osobu i unosi se u članskom portalu.' : 'One code admits one person, entered in the member portal.', 12)}
      <div style="text-align:center;margin:24px 0;">${btn(hr ? 'UNESITE SVOJ KOD →' : 'ENTER MY CODE →', enterUrl)}</div>
      ${txPasteLine(enterUrl, hr)}
    </div>`;
    return shell({
        title: hr ? 'Pozivnica u Biomedicinski forum — Med&X' : 'Your invitation to the Biomedical Forum — Med&X',
        preheader: hr ? 'Osobna pozivnica u Biomedicinski forum — vaš kod je unutra.' : 'A personal invitation to the Biomedical Forum — your code is inside.',
        rule: 'gold',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Ova je pozivnica osobna i neprenosiva.' : 'This invitation is personal and non-transferable.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 18 · CERTIFICATE OF ATTENDANCE
function certificateOfAttendance({ firstName, eventName, downloadUrl, locale } = {}) {
    const hr = locale === 'hr';
    const ev = `<strong style="color:${T.ink};">${esc(eventName || 'Med&X')}</strong>`;
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'POTVRDA O SUDJELOVANJU' : 'CERTIFICATE OF ATTENDANCE')}
      ${txHeadline((hr ? 'Vaša je potvrda spremna' : 'Your certificate is ready') + txNameSuffix(firstName, hr) + '.')}
      ${txPara(hr
        ? `Hvala vam što ste bili s nama na ${ev}. Vaša potvrda o sudjelovanju potpisana je i spremna za preuzimanje — a trajno ostaje i u vašem novčaniku u portalu, kad god vam zatreba.`
        : `Thank you for being with us at ${ev}. Your certificate of attendance is signed and ready to download — and it stays in your portal wallet for good, whenever you need it.`)}
      <div style="text-align:center;margin:26px 0;">${btn(hr ? 'PREUZMITE POTVRDU →' : 'DOWNLOAD MY CERTIFICATE →', downloadUrl)}</div>
      ${txPasteLine(downloadUrl, hr)}
    </div>`;
    return shell({
        title: hr ? `Potvrda o sudjelovanju — ${eventName || 'Med&X'}` : `Certificate of attendance — ${eventName || 'Med&X'}`,
        preheader: hr ? 'Vaša potvrda o sudjelovanju spremna je za preuzimanje.' : 'Your certificate of attendance is ready to download.',
        rule: 'gold',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Poslano jer ste sudjelovali na Med&amp;X događanju.' : 'Sent because you attended a Med&amp;X event.',
            txReplyLine(hr)]
    });
}

// ---------------------------------------------------------------- 19 · MORNING-AFTER SURVEY
// Deliberately tiny — three sentences, one button, gone.
function surveyMorningAfter({ firstName, eventName, surveyUrl, locale } = {}) {
    const hr = locale === 'hr';
    const ev = `<strong style="color:${T.ink};">${esc(eventName || 'Med&X')}</strong>`;
    const body = `
    <div style="padding:36px 40px 30px;">
      ${txEyebrow(hr ? 'JUTRO POSLIJE' : 'THE MORNING AFTER')}
      ${txHeadline((hr ? 'Kako je bilo' : 'How was it') + txNameSuffix(firstName, hr) + '?')}
      ${txPara(hr
        ? `Hvala vam što ste sinoć bili s nama na ${ev}. Recite nam jednim dodirom kako je bilo — trideset sekundi, ne više. Upravo to oblikuje što gradimo sljedeće godine.`
        : `Thank you for being with us at ${ev} last night. Tell us in one tap how it was — thirty seconds, no more. It shapes what we build next year.`)}
      <div style="text-align:center;margin:26px 0 4px;">${btn(hr ? 'RECITE NAM U 30 SEKUNDI →' : 'TELL US IN 30 SECONDS →', surveyUrl)}</div>
    </div>`;
    return shell({
        title: hr ? `Kako je bilo? — ${eventName || 'Med&X'}` : `How was it? — ${eventName || 'Med&X'}`,
        preheader: hr ? 'Trideset sekundi — recite nam kako je bilo.' : 'Thirty seconds — tell us how it was.',
        rule: 'crimson',
        bodyHtml: body,
        lang: hr ? 'hr' : 'en',
        footerItems: [txCopyright(),
            hr ? 'Poslano jutro nakon događanja na kojem ste bili.' : 'Sent the morning after an event you attended.',
            txReplyLine(hr)]
    });
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
Object.assign(mount, {
    paymentReceived, paymentReminder, registrationCancelled, seatTransferred, transferReceived,
    eventReminder, acceleratorReceived, acceleratorDecision, forumInvitation,
    certificateOfAttendance, surveyMorningAfter
});
module.exports = mount;
