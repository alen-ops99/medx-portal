/**
 * shared/email-layout.js — THE Med&X email layout (2026-09-25).
 *
 * Every email both portals send is rendered in this one layout: a warm sand canvas, a cream card,
 * the ink band carrying the real med&X wordmark (hosted white PNG), a 2px crimson or gold rule,
 * Fraunces headlines (Georgia fallback), Inter text (Helvetica/Arial fallback), crimson buttons,
 * gold hairlines and one quiet footer.
 * It is the design of design/handoff/member-portal-2026-08-28/Emails.dc.html, made bulletproof:
 * table layout, inline CSS, 600px max, a phone media query, an Outlook wrapper, light-only
 * color-scheme metas unless a builder opts into its dark-mode classes.
 *
 * Forced dark mode and the white wordmark: Apple Mail honours the light-only metas; Gmail iOS and
 * Outlook for Windows invert colours on their own and would turn a plain ink band light, where the
 * white "med&" vanishes (images are never inverted). The band therefore carries its ink three
 * ways: bgcolor/background (every client), a linear-gradient background-image (Gmail iOS leaves
 * background images alone) and, for Outlook, a VML fill (Outlook's dark mode is known to leave
 * VML fills alone). Partial-invert clients (Outlook.com, Outlook iOS/Android, Gmail Android) keep
 * dark grounds as they are. These are the clients' documented behaviours; a real dark-mode inbox
 * check (Gmail iOS, Outlook for Windows) is still to be done.
 *
 * Ways in, one look out:
 *   layout({...})        the shell. v2/email-templates.js shell(), both buildEmailTemplate()s and
 *                        the hand-built shells all end here.
 *   block({...})         the standard content block (eyebrow · headline · text · facts · button ·
 *                        note) for mail that only has a title and a body.
 *   letterhead({...})    the old buildEmailTemplate(title, body) contract in the new layout, with
 *                        the old footer's words and links kept.
 *   ensureBranded(html)  the send boundary. sendEmail() in both backends passes every outgoing
 *                        message through it, so mail built anywhere else (older queued outbox
 *                        rows, raw fragments, alerts, the Gala payment request) arrives in the
 *                        same layout. Already-branded mail passes through untouched.
 *
 * Nothing here rewrites wording or links: restyle() edits only style / bgcolor / color attribute
 * values (and adds a style to bare headings, links and rules); layout() inserts bodies verbatim;
 * the unwrappers move content without changing a character of it. toText() builds the plain-text
 * alternative that travels with each message.
 */
'use strict';

const LAYOUT_VERSION = '2026-09-25';

const T = {
    ink: '#191512',
    cream: '#f7f1e6',
    cardCream: '#fdfaf3',
    paper: '#fdfaf3',
    crimson: '#9b1b22',
    gold: '#c9a962',
    goldDark: '#6e5626',
    soft: '#4a4239',
    muted: '#6f6256',
    hairline: 'rgba(25,21,18,.16)',
    canvas: '#e9e2d2',
    tint: '#f6efdf',
    serif: "Fraunces,Georgia,'Times New Roman',serif",
    sans: "Inter,Helvetica,Arial,sans-serif"
};

// The real wordmark: white "med&" with the crimson/gold X, 750x165 PNG on the member portal's
// Netlify CDN (always on). EMAIL_LOGO_URL overrides it; read per call so tests can swap it.
function logoUrl() {
    return process.env.EMAIL_LOGO_URL || 'https://medx-member-portal-v2.netlify.app/assets/logo-white.png';
}
const ICON = {
    facebook: 'https://medx-member-portal-v2.netlify.app/assets/social/facebook.png?v=2',
    instagram: 'https://medx-member-portal-v2.netlify.app/assets/social/instagram.png?v=2',
    linkedin: 'https://medx-member-portal-v2.netlify.app/assets/social/linkedin.png?v=2'
};
const ICON_ALT = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' };
const DEFAULT_LINKS = {
    site: { href: 'https://medx.hr', label: 'MEDX.HR' },
    social: [
        { kind: 'facebook', href: 'https://www.facebook.com/profile.php?id=61554188818525' },
        { kind: 'instagram', href: 'https://www.instagram.com/medx_association/' },
        { kind: 'linkedin', href: 'https://www.linkedin.com/company/med-x-association/' }
    ]
};

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

// Buttons: crimson fill (solid), outline (ghost), gold fill, ink fill — the square house corner.
// Outlook for Windows ignores padding on a link, so it would paint only a thin strip behind the
// label: there the side padding comes from two letter-spaced <i> spacers and the height from
// mso-text-raise (the "link button" pattern). Other clients never see the spacers (they sit in
// mso comments); the label's <span> is inert for them.
function btn(label, href, kind, extra) {
    const solid = `display:inline-block;white-space:nowrap;padding:15px 34px;background:${T.crimson};color:${T.cream};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const ghost = `display:inline-block;white-space:nowrap;padding:14px 30px;border:1px solid rgba(25,21,18,.3);color:${T.ink};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const gold = `display:inline-block;white-space:nowrap;padding:14px 30px;background:${T.gold};color:#191512;border:1px solid #191512;font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const ink = `display:inline-block;white-space:nowrap;padding:14px 30px;background:#191512;color:#f7f1e6;border:1px solid ${T.gold};font-family:${T.sans};font-weight:600;font-size:11px;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;`;
    const look = kind === 'ghost' ? ghost : kind === 'gold' ? gold : kind === 'ink' ? ink : solid;
    const fill = kind === 'ghost' ? T.cream : kind === 'gold' ? T.gold : kind === 'ink' ? T.ink : T.crimson;
    const side = kind === 'ghost' || kind === 'gold' || kind === 'ink' ? 30 : 34, top = side === 34 ? 15 : 14;
    const spacer = raise => `<!--[if mso]><i style="letter-spacing:${side}px;mso-font-width:-100%;${raise ? `mso-text-raise:${raise}pt;` : ''}" hidden>&nbsp;</i><![endif]-->`;
    return `<a class="mx-btn" href="${escUrl(href)}" style="${look}mso-padding-alt:0;text-underline-color:${fill};${extra || ''}">${spacer(top * 2)}<span style="mso-text-raise:${top}pt;">${label}</span>${spacer(0)}</a>`;
}

// Opt-in dark-mode CSS (darkReady): class-based overrides for clients that honour
// prefers-color-scheme (Apple Mail, Outlook iOS) and [data-ogsc] (Outlook.com).
const DARK_CSS = `<style>
@media (prefers-color-scheme: dark) {
  body, .em-canvas { background:#0f0c0a !important; }
  .em-cardbg { background:#251d16 !important; }
  .em-ink { color:#f6efe2 !important; }
  .em-soft { color:#d9cebd !important; }
  .em-goldlab { color:#d7b56c !important; }
  .em-hair { border-color:rgba(247,241,230,.2) !important; }
  .em-fact { background:#2f251a !important; border-color:rgba(247,241,230,.16) !important; }
  .em-reason { background:rgba(183,40,47,.3) !important; }
  .em-ghost { color:#f6efe2 !important; border-color:rgba(247,241,230,.5) !important; }
  .em-btn { background:#b3242c !important; color:#fff7ea !important; }
}
[data-ogsc] body, [data-ogsc] .em-canvas { background:#0f0c0a !important; }
[data-ogsc] .em-cardbg { background:#251d16 !important; }
[data-ogsc] .em-ink { color:#f6efe2 !important; }
[data-ogsc] .em-soft { color:#d9cebd !important; }
[data-ogsc] .em-goldlab { color:#d7b56c !important; }
[data-ogsc] .em-hair { border-color:rgba(247,241,230,.2) !important; }
[data-ogsc] .em-fact { background:#2f251a !important; }
[data-ogsc] .em-reason { background:rgba(183,40,47,.3) !important; }
[data-ogsc] .em-ghost { color:#f6efe2 !important; border-color:rgba(247,241,230,.5) !important; }
[data-ogsc] .em-btn { background:#b3242c !important; color:#fff7ea !important; }
[data-ogsb] body, [data-ogsb] .em-canvas { background:#0f0c0a !important; }
[data-ogsb] .em-cardbg { background:#251d16 !important; }
[data-ogsb] .em-fact { background:#2f251a !important; }
[data-ogsb] .em-reason { background:rgba(183,40,47,.3) !important; }
[data-ogsb] .em-btn { background:#b3242c !important; }
</style>`;

// Phone: the card runs edge to edge and every column steps in from 40 to 22px. Builders' own
// body cells (a first-level div, or a first-level table cell) follow through .mx-body.
const BASE_CSS = `<style>
body{margin:0;padding:0;width:100% !important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;font-size:inherit !important;font-family:inherit !important;font-weight:inherit !important;line-height:inherit !important;}
@media only screen and (max-width:480px){
  .mx-outer{padding:0 !important;}
  .mx-card{width:100% !important;}
  .mx-head{padding:18px 22px !important;}
  .mx-foot{padding:20px 22px 24px !important;}
  .mx-pad, .mx-body > div, .mx-body > table > tbody > tr > td, .mx-body > table > tr > td{padding-left:22px !important;padding-right:22px !important;}
  .mx-h1{font-size:25px !important;}
  .mx-btn{display:block !important;width:auto !important;max-width:100% !important;white-space:normal !important;box-sizing:border-box !important;padding-left:18px !important;padding-right:18px !important;text-align:center !important;}
  .mx-label{letter-spacing:.14em !important;}
}
</style>`;

// Outlook for Windows drops rgba() borders, so the layout's own hairlines are the solid colours the
// translucent ones resolve to on their grounds (identical everywhere else).
const HAIR_ON_CREAM = '#d3cec4';       // rgba(25,21,18,.16) on the cream card
const GOLD_FRAME = '#dbc595';          // rgba(201,169,98,.65) on paper
const ROW_RULE = '#e6e3dd';            // rgba(25,21,18,.1) on paper

const RULES = {
    crimson: `background:${T.crimson};`,
    gold: `background:${T.gold};`,
    split: `background:${T.crimson};background:linear-gradient(90deg,${T.crimson} 0 50%,${T.gold} 50% 100%);`
};

function footerLinksHtml(links) {
    const L = links || DEFAULT_LINKS;
    const cells = [];
    if (L.site && L.site.href) {
        cells.push(`<td style="${microStyle(T.goldDark, 10, '.16em')}vertical-align:middle;"><a href="${escUrl(L.site.href)}" style="color:${T.goldDark};text-decoration:none;">${L.site.label || 'MEDX.HR'}</a></td>`);
    }
    (L.social || []).forEach(s => {
        if (!s || !s.href || !ICON[s.kind]) return;
        cells.push(`<td style="padding:0 0 0 ${cells.length ? 14 : 0}px;vertical-align:middle;"><a href="${escUrl(s.href)}"><img src="${ICON[s.kind]}" width="16" height="16" style="display:block;border:0;width:16px;height:16px;" alt="${s.alt || ICON_ALT[s.kind]}"></a></td>`);
    });
    if (!cells.length) return '';
    return `<!--mx:skip--><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 0;"><tr>${cells.join('')}</tr></table><!--/mx:skip-->`;
}

/**
 * The shell. Every Med&X email is one of these.
 *   title        document <title>            preheader   hidden inbox preview line
 *   lang         'en' | 'hr'                 label       gold caps label right of the wordmark ('' = none)
 *   headerExtraHtml  a line inside the ink band (the newsletter's italic headline)
 *   headerPadX   band side padding (a builder with a 28px body column passes 28)
 *   rule         'crimson' | 'gold' | 'split' | '#hex' — the 2px accent under the band
 *   body         the content cell, inserted verbatim
 *   footer       footer lines (HTML)         links       { site:{href,label}, social:[{kind,href,alt}] }
 *   darkReady    opt into the class-based dark-mode CSS
 */
function layout(o) {
    o = o || {};
    const padX = Number(o.headerPadX) || 40;
    const scheme = o.darkReady ? 'light dark' : 'light';
    const lang = o.lang === 'hr' ? 'hr' : 'en';
    const ruleCss = RULES[o.rule] || (o.rule && /^#[0-9a-f]{3,8}$/i.test(o.rule) ? `background:${o.rule};` : RULES.crimson);
    const footer = (o.footer && o.footer.length ? o.footer : [`© Med&amp;X ${new Date().getFullYear()} · Split, Croatia`])
        .filter(Boolean)
        .map(it => `<div class="em-soft" style="font-family:${T.sans};font-size:12px;color:${T.soft};line-height:1.7;">${it}</div>`).join('\n    ');
    const label = o.label == null ? '' : String(o.label);
    const headPad = o.headerExtraHtml ? `26px ${padX}px 22px` : `22px ${padX}px`;
    return `<!DOCTYPE html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="${scheme}">
<meta name="supported-color-schemes" content="${scheme}">
<title>${esc(o.title || 'Med&X')}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if mso]><style>*{font-family:Arial,Helvetica,sans-serif !important;}h1,h2,h3,.mx-h1,h1 i,h1 em,h1 span,.mx-h1 i,.mx-h1 em,.mx-h1 span{font-family:Georgia,'Times New Roman',serif !important;}</style><![endif]-->
<!--[if !mso]><!-->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&amp;family=Inter:wght@400..700&amp;display=swap" rel="stylesheet">
<!--<![endif]-->
<style>:root{color-scheme:${scheme};supported-color-schemes:${scheme};}</style>
${BASE_CSS}
${o.darkReady ? DARK_CSS : ''}
</head>
<body class="em-canvas" data-mx-layout="${LAYOUT_VERSION}" style="margin:0;padding:0;background:${T.canvas};font-family:${T.sans};-webkit-text-size-adjust:100%;">
${o.preheader ? `<!--mx:skip--><div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${T.canvas};opacity:0;">${esc(o.preheader)}</div><!--/mx:skip-->` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-canvas" bgcolor="${T.canvas}" style="background:${T.canvas};"><tr><td align="center" class="mx-outer" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="em-cardbg mx-card" bgcolor="${T.cream}" style="width:100%;max-width:600px;background:${T.cream};box-shadow:0 10px 34px rgba(25,21,18,.18);">
  <tr><td class="mx-head" bgcolor="${T.ink}" style="background:${T.ink};padding:${headPad};background-image:linear-gradient(${T.ink},${T.ink});mso-padding-alt:0;">
    <!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" fillcolor="${T.ink}" style="width:600px;"><v:fill type="solid" color="${T.ink}" /><v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:true"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${headPad};"><![endif]-->
    <!--mx:skip--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" valign="middle" style="vertical-align:middle;"><img src="${escUrl(logoUrl())}" alt="med&amp;X" width="100" height="22" style="display:block;width:100px;height:22px;border:0;color:${T.cream};font-family:${T.serif};font-size:20px;line-height:22px;"></td>
      ${label ? `<td align="right" valign="middle" class="mx-label" style="vertical-align:middle;padding-left:16px;${microStyle(T.gold, 10, '.2em')}line-height:1.5;">${label}</td>` : ''}
    </tr></table><!--/mx:skip-->
    ${o.headerExtraHtml || ''}
    <!--[if gte mso 9]></td></tr></table></v:textbox></v:rect><![endif]-->
  </td></tr>
  <tr><td height="2" style="height:2px;font-size:0;line-height:0;${ruleCss}">&nbsp;</td></tr>
  <tr><td class="mx-body" style="font-family:${T.sans};color:${T.ink};">${o.body || ''}</td></tr>
  <tr><td align="center" class="em-hair mx-foot" style="border-top:1px solid ${HAIR_ON_CREAM};padding:20px 40px 24px;">
    ${footer}
    ${footerLinksHtml(o.links)}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

// A facts card: gold hairline frame on paper, caps label + value per row (values are HTML).
function facts(rows, opts) {
    const list = (rows || []).filter(r => r && r[0] != null && r[1] != null && r[1] !== '');
    if (!list.length) return '';
    const o = opts || {};
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-fact" style="margin-top:${o.mt == null ? 20 : o.mt}px;border:1px solid ${GOLD_FRAME};background:${T.cardCream};"><tr><td style="padding:8px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${list.map(([label, value], i) => `<tr>
          <td valign="top" style="${i ? `border-top:1px solid ${ROW_RULE};` : ''}padding:10px 14px 10px 0;width:110px;${microStyle(T.ink, 10, '.12em')}font-weight:700;vertical-align:top;">${label}</td>
          <td valign="top" style="${i ? `border-top:1px solid ${ROW_RULE};` : ''}padding:10px 0;font-family:${T.sans};font-size:14px;line-height:1.5;color:${T.ink};word-break:break-word;">${value}</td>
        </tr>`).join('')}
        </table>
      </td></tr></table>`;
}

/** The standard content block: eyebrow · headline · text · facts · button(s) · note (all HTML). */
function block(o) {
    o = o || {};
    const padX = o.padX == null ? 40 : o.padX;
    const buttons = (o.buttons || (o.button ? [o.button] : [])).filter(b => b && b.label && b.href);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="mx-pad" style="padding:${o.padTop == null ? 36 : o.padTop}px ${padX}px 34px;">
      ${o.eyebrow ? `<div class="em-goldlab" style="${microStyle(T.goldDark, 10, '.18em')}">${o.eyebrow}</div>` : ''}
      ${o.headline ? `<h1 class="mx-h1 em-ink" style="margin:${o.eyebrow ? 10 : 0}px 0 0;font-family:${T.serif};font-weight:400;font-size:28px;line-height:1.18;letter-spacing:-.005em;color:${T.ink};">${o.headline}</h1>` : ''}
      ${o.bodyHtml ? `<div class="em-soft" style="margin-top:${o.headline || o.eyebrow ? 16 : 0}px;font-family:${T.sans};font-size:15px;line-height:1.7;color:${T.soft};overflow-wrap:anywhere;word-break:break-word;">${o.bodyHtml}</div>` : ''}
      ${o.facts ? facts(o.facts) : ''}
      ${buttons.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding-top:26px;">${buttons.map((b, i) => (i ? '<span style="display:inline-block;width:8px;">&nbsp;</span>' : '') + btn(b.label, b.href, b.kind, b.extra)).join('')}</td></tr></table>` : ''}
      ${o.note ? `<div class="em-soft" style="margin-top:20px;font-family:${T.sans};font-size:13px;line-height:1.65;color:${T.soft};">${o.note}</div>` : ''}
    </td></tr></table>`;
}

// ============================================================ the retired letterhead
// buildEmailTemplate(title, body) lived twice (member + admin backend) as a navy letterhead.
// Its contract now renders here; its footer keeps every word and link it had (GDPR line,
// Privacy Policy · Terms, newsletter sign-up, the motto, ©) — only the look changes.
const LETTERHEAD = {
    member: {
        motto: 'Building Bridges in Biomedicine',
        privacy: 'https://medx-user-portal.onrender.com/privacy',
        terms: 'https://medx-user-portal.onrender.com/terms',
        links: hr => ({ site: { href: 'https://medx.hr', label: 'MEDX.HR' }, social: [
            { kind: 'linkedin', href: 'https://www.linkedin.com/company/med-x-association/' },
            { kind: 'instagram', href: 'https://www.instagram.com/medx_association/' },
            { kind: 'facebook', href: 'https://www.facebook.com/profile.php?id=61554188818525' }] })
    },
    admin: {
        motto: 'Building Bridges in Biomedicine',
        privacy: 'https://medx-user-portal.onrender.com/privacy',
        terms: 'https://medx-user-portal.onrender.com/terms',
        links: () => ({ site: { href: 'https://medx.hr', label: 'MEDX.HR' }, social: [
            { kind: 'linkedin', href: 'https://www.linkedin.com/company/med-x-croatia/' },
            { kind: 'instagram', href: 'https://www.instagram.com/medx.hr/' }] })
    }
};
function letterheadFooter(family, hr, newsletterUrl) {
    const F = LETTERHEAD[family] || LETTERHEAD.member;
    const a = (href, label) => `<a href="${href}" style="color:${T.goldDark};text-decoration:underline;">${label}</a>`;
    const gdpr = hr
        ? `Vaši se osobni podaci obrađuju u skladu s Općom uredbom EU o zaštiti podataka (GDPR) i koriste isključivo u svrhu organizacije i provedbe ovog događaja. ${a(F.privacy, 'Pravila privatnosti')} &nbsp;·&nbsp; ${a(F.terms, 'Uvjeti korištenja')}`
        : `Your personal data is processed in accordance with the EU General Data Protection Regulation (GDPR) and used solely for the purposes of organizing and delivering this event. ${a(F.privacy, 'Privacy Policy')} &nbsp;·&nbsp; ${a(F.terms, 'Terms')}`;
    const lines = [`<span style="font-family:${T.serif};font-style:italic;font-size:14px;color:${T.ink};">${F.motto}</span>`];
    if (family === 'admin' && newsletterUrl) lines.push(a(newsletterUrl, 'Sign up for our newsletter'));
    lines.push(`<span style="font-size:11px;line-height:1.6;color:${T.muted};">${gdpr}</span>`);
    lines.push(`&copy; ${new Date().getFullYear()} Med&amp;X. ${hr ? 'Sva prava pridržana.' : 'All rights reserved.'}`);
    return { footer: lines, links: F.links(hr) };
}
/**
 * letterhead({ family:'member'|'admin', title, bodyHtml, locale, accent, newsletterUrl })
 * The old buildEmailTemplate() in the layout: the title becomes the Fraunces headline, the body
 * is re-homed to the palette (restyle) and set in the standard block.
 */
function letterhead(o) {
    o = o || {};
    const hr = o.locale === 'hr';
    const f = letterheadFooter(o.family, hr, o.newsletterUrl);
    return layout({
        title: o.subjectTitle || stripTags(o.title) || 'Med&X',
        lang: hr ? 'hr' : 'en',
        rule: o.accent === 'gold' ? 'gold' : 'crimson',
        body: block({ headline: o.title || '', bodyHtml: restyle(o.bodyHtml || '') }),
        footer: f.footer,
        links: f.links
    });
}
function stripTags(s) { return decodeBasic(String(s == null ? '' : s).replace(/<[^>]+>/g, '')).trim(); }

// ================================================================== colour engine
// Re-homes the old palettes (navy/slate "blue stuff", Bootstrap greens and reds, cyan headers,
// cool greys) onto the Med&X palette, and translates the retired espresso shell. Warm browns,
// creams, golds and the house crimson are already on brand and pass through unchanged.
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080',
    navy: '#000080', orange: '#ffa500', silver: '#c0c0c0', darkgreen: '#006400', darkred: '#8b0000', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
    darkgray: '#a9a9a9', darkgrey: '#a9a9a9', teal: '#008080', purple: '#800080', crimson: '#dc143c', steelblue: '#4682b4',
    royalblue: '#4169e1', dodgerblue: '#1e90ff', slategray: '#708090', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', dimgray: '#696969' };
const COLOR_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)|\b(?:white|black|red|green|blue|gray|grey|navy|orange|silver|darkgreen|darkred|lightgray|lightgrey|darkgray|darkgrey|teal|purple|crimson|steelblue|royalblue|dodgerblue|slategray|whitesmoke|gainsboro|dimgray)\b/gi;

function parseColor(s) {
    s = String(s).trim().toLowerCase();
    if (NAMED[s]) s = NAMED[s];
    let m;
    if ((m = /^#([0-9a-f]{3})$/.exec(s))) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
    if ((m = /^#([0-9a-f]{6})$/.exec(s))) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
    if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s))) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
    return null;
}
function hsl(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h *= 60;
    }
    return { h, s, l };
}
function lum(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// a translucent colour over a ground → the opaque colour the reader sees
function over(c, ground) { if (!c || c.a >= 1 || !ground) return c; return { r: c.r * c.a + ground.r * (1 - c.a), g: c.g * c.a + ground.g * (1 - c.a), b: c.b * c.a + ground.b * (1 - c.a), a: 1 }; }
const hex2 = n => ('0' + Math.round(n).toString(16)).slice(-2);
function fmt(c, orig) {
    if (c.a < 1 || /^rgba/i.test(orig)) return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+(+c.a).toFixed(3)})`;
    return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
}
const P = (x, a) => { const p = parseColor(x); p.a = a == null ? 1 : a; return p; };

// The retired espresso shell's palette → its cream-family twin (by exact value).
const DARK_TO_LIGHT = {
    '#f2e7d6': T.ink, '#f6efe2': T.ink, '#f0e4d2': T.ink, '#fff7ea': T.ink, '#f4efe4': T.ink,
    '#d3c5b2': T.soft, '#d9cebd': T.soft, '#cbbca7': T.soft, '#c9b89f': T.soft,
    '#d7b56c': T.goldDark,
    '#342718': T.cardCream, '#2f251a': T.cardCream, '#2b2016': T.cardCream, '#251d16': T.cardCream,
    '#291e14': T.cream, '#120e0a': T.cream, '#1a1410': T.cream, '#0f0c0a': T.cream,
    '#a8232b': T.crimson, '#b3242c': T.crimson, '#c9313a': T.crimson, '#f0b9b4': T.crimson
};
function darkToLightColor(c) {
    const k = '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
    if (c.a < 1 && c.r >= 230 && c.g >= 215 && c.b >= 195) return P(T.ink, c.a < 0.3 ? 0.12 : 0.3);  // hairlines, ghost borders
    if (c.a < 1 && c.r === 183 && c.g === 40 && c.b === 47) return P(T.crimson, 0.07);                  // the "reason" wash
    if (DARK_TO_LIGHT[k]) return P(DARK_TO_LIGHT[k], c.a);
    return null;
}

// One colour, re-homed. kind: 'bg' | 'text' | 'border'; ctx.darkGround = it sits on a dark ground.
// Light/dark is judged by relative luminance (Y), hue family by HSL.
function brandColor(c, kind, ctx) {
    const { h, s, l } = hsl(c);
    const Y = lum(c);
    const dark = !!(ctx && ctx.darkGround);
    const a = c.a;
    if (c.r === 255 && c.g === 255 && c.b === 255) return null;                  // white stays (QR tiles, text on ink)
    if (c.r === 0 && c.g === 0 && c.b === 0) return a < 1 ? null : P(T.ink);     // black text warms to ink; shadows stay
    const warm = h >= 18 && h <= 62 && s <= 0.56;
    const houseRed = (h >= 345 || h <= 10) && s >= 0.35 && l >= 0.2 && l <= 0.5;
    if (warm || houseRed) return null;                                          // already Med&X
    const grey = s < 0.12;
    const cool = h >= 165 && h <= 300;
    if (grey || (cool && s < 0.45)) {                                           // greys and slates
        if (kind === 'bg') return P(Y < 0.03 ? T.ink : Y < 0.15 ? '#2b2520' : Y < 0.5 ? '#b9ad99' : Y < 0.8 ? '#efe7d8' : T.cardCream, a);
        if (kind === 'text') return P(Y < 0.03 ? T.ink : Y < 0.12 ? T.soft : Y < 0.3 ? T.muted : (dark ? '#e9dfcc' : '#8a8178'), a);
        return P(Y < 0.1 ? T.ink : Y < 0.55 ? '#cbbfa8' : '#e6dccb', a);
    }
    const band = Y < 0.1 ? 'dark' : Y < 0.55 ? 'mid' : 'light';
    let accentBg, accentText, accentLine;
    if (cool) { accentBg = T.crimson; accentText = T.crimson; accentLine = T.crimson; }             // blues, cyans, violets
    else if (h > 62 && h < 165) { accentBg = T.ink; accentText = T.goldDark; accentLine = T.gold; }  // greens
    else if (h >= 18 && h <= 62) { accentBg = T.gold; accentText = '#8a6d2f'; accentLine = T.gold; } // ambers, yellows
    else { accentBg = T.crimson; accentText = T.crimson; accentLine = T.crimson; }                  // reds, pinks
    const redFamily = !cool && !(h > 62 && h < 165) && !(h >= 18 && h <= 62);
    if (kind === 'bg') return P(band === 'dark' ? (redFamily ? '#5a1116' : T.ink) : band === 'mid' ? accentBg : (redFamily ? '#f8ecea' : T.tint), a);
    if (kind === 'text') return P(band === 'dark' ? (redFamily ? T.crimson : (h >= 18 && h <= 62 ? T.goldDark : T.ink)) : band === 'mid' ? accentText : (dark ? (redFamily ? '#f0cfcb' : T.cream) : accentText), a);
    return P(band === 'light' ? (redFamily ? '#e7c3c0' : '#e2cf9f') : accentLine, a);
}

function propKind(prop) {
    prop = prop.toLowerCase();
    if (prop === 'background' || prop === 'background-color' || prop === 'background-image') return 'bg';
    if (prop === 'color' || prop === '-webkit-text-fill-color') return 'text';
    if (/^(border|outline|box-shadow|text-decoration|column-rule)/.test(prop)) return 'border';
    return null;
}
function mapFontFamily(v) {
    const s = v.toLowerCase();
    if (/monospace|courier|menlo|consolas/.test(s)) return v;
    if (/fraunces|georgia|times|serif/.test(s) && !/sans-serif/.test(s)) return T.serif;
    if (/sans|arial|helvetica|inter|system|segoe|roboto|apple|blinkmac|verdana|tahoma/.test(s)) return T.sans;
    return v;
}

/**
 * Re-colour one style attribute value. Declarations that need no change are copied byte for
 * byte. Returns { style, bg (own resulting background), bgChanged, image (has a bg image) }.
 */
function restyleDecls(style, mode, ctx) {
    let ownBg = null, bgChanged = false, image = false;
    // this element's own ground (if it sets one) decides how its own text colour is read
    const own = bgOfStyle(style);
    if (own) {
        const mapped = mode === 'guard' ? own : mode === 'dark' ? (darkToLightColor(own) || own) : (brandColor(own, 'bg', ctx) || own);
        ctx = Object.assign({}, ctx, { darkGround: lum(mapped) < 0.18 });
    }
    const re = /((?:^|;)\s*)([a-zA-Z-]+)(\s*:\s*)((?:url\([^)]*\)|[^;])*)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(style))) {
        out += style.slice(last, m.index);
        last = re.lastIndex;
        const prop = m[2].toLowerCase();
        let val = m[4];
        const kind = propKind(prop);
        if (kind === 'bg' && /url\(/i.test(val)) image = true;
        if (mode === 'legacy' && prop === 'font-family') val = mapFontFamily(val);
        else if (mode === 'legacy' && prop === 'border-radius') val = val.replace(/(\d+(?:\.\d+)?)px/g, (x, n) => (+n <= 24 ? '0' : x));
        else if (mode === 'legacy' && prop === 'width' && /^\s*(\d{3,})px\s*$/.test(val) && +val.trim().replace('px', '') > 320) val = `100%;max-width:${val.trim()}`;
        else if (kind) {
            // colours only outside url(...) — an image address is never touched
            val = val.split(/(url\([^)]*\))/i).map((seg, i) => i % 2 ? seg : seg.replace(COLOR_RE, tok => {
                const c = parseColor(tok);
                if (!c) return tok;
                const n = mode === 'guard' ? null : mode === 'dark' ? darkToLightColor(c) : brandColor(c, kind, ctx);
                if (kind === 'bg' && !ownBg) ownBg = n || c;
                if (!n) return tok;
                if (kind === 'bg') bgChanged = true;
                return fmt(n, tok);
            })).join('');
        }
        out += m[1] + m[2] + m[3] + val;
        if (m[0] === '') re.lastIndex++;
    }
    out += style.slice(last);
    return { style: out, bg: ownBg, bgChanged, image };
}

// The contrast a text colour needs (WCAG AA): 3:1 for large text (18px, or 14px bold), else 4.5:1.
// Only the element's own declarations are read; text of unknown size counts as body text.
function textMin(style) {
    const st = String(style || '');
    const fs = /(?:^|;)\s*font-size\s*:\s*([\d.]+)px/i.exec(st) || /(?:^|;)\s*font\s*:[^;]*?([\d.]+)px/i.exec(st);
    const size = fs ? +fs[1] : 0;
    const bold = /(?:^|;)\s*font-weight\s*:\s*(bold|[6-9]00)\b/i.test(st) || /(?:^|;)\s*font\s*:\s*(bold|[6-9]00)\b/i.test(st);
    return size >= 18 || (bold && size >= 14) ? 3 : 4.5;
}
// Readability guard: after re-homing, a text colour must still read on its ground. min: the
// contrast below which the colour is swapped — a pale gold for the dark gold, a pale grey for the
// muted grey (so it stays quieter than the body text), anything else for ink / cream.
function guardText(style, ground, min) {
    if (!ground) return style;
    return style.replace(/((?:^|;)\s*color\s*:\s*)([^;]+)/i, (m0, pre, val) => {
        const imp = /!important/i.test(val);
        const c = parseColor(val.replace(/!important/i, '').trim());
        if (!c) return m0;
        const seen = over(c, ground);
        if (contrast(seen, ground) >= min) return m0;
        const { h, s } = hsl(c);
        const lightGround = contrast(P(T.ink), ground) >= contrast(P(T.cream), ground);
        const reads = col => contrast(P(col), ground) >= Math.max(min, 4.5);
        const pick = lightGround
            ? (h >= 25 && h <= 60 && s >= 0.25 && reads(T.goldDark) ? T.goldDark : s < 0.25 && reads(T.muted) ? T.muted : T.ink)
            : (s < 0.25 && reads(LIGHT_SOFT) ? LIGHT_SOFT : T.cream);
        return pre + pick + (imp ? ' !important' : '');
    });
}
const LIGHT_SOFT = '#d9cebd';   // the quiet text colour on an ink ground

// A link styled as a button (a fill or an outline, with padding) becomes the house button — crimson
// fill, or the ink outline — keeping only how it sits (block / width / margin / alignment).
function houseButton(style) {
    const st = String(style || '');
    if (!/padding\s*:/i.test(st)) return null;
    const bg = bgOfStyle(st);
    const filled = bg && !(bg.r > 240 && bg.g > 240 && bg.b > 240) && bg.a > 0;
    const outlined = !filled && /(^|;)\s*border\s*:\s*[^;]*solid/i.test(st);
    if (!filled && !outlined) return null;
    const keep = keepDecls(st, 'display|width|max-width|min-width|margin|margin-top|margin-bottom|margin-left|margin-right|text-align|box-sizing|white-space')
        .split(';').filter(d => d && !/^display\s*:\s*inline-block/i.test(d.trim())).join(';');
    const look = filled
        ? `display:inline-block;padding:15px 34px;background:${T.crimson};color:${T.cream};border:0;`
        : `display:inline-block;padding:14px 30px;background:transparent;color:${T.ink};border:1px solid rgba(25,21,18,.3);`;
    return { filled, style: look + `font-family:${T.sans};font-weight:600;font-size:11px;line-height:1.4;letter-spacing:.16em;text-decoration:none;text-transform:uppercase;border-radius:0;${keep ? keep + ';' : ''}` };
}

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
// a bare heading gets the serif (and a colour that reads on its ground, unless it has one)
function headStyle(st, darkGround) {
    let add = '';
    if (!/font-family\s*:/i.test(st)) add += `font-family:${T.serif};font-weight:500;letter-spacing:-.005em;`;
    if (!/(^|;)\s*color\s*:/i.test(st)) add += `color:${darkGround ? T.cream : T.ink};`;
    return add + st;
}

/**
 * restyle(html, { mode: 'legacy' | 'dark' | 'guard', ground })
 *   legacy  re-home the old palettes, fonts, corners and button links to the house style
 *   dark    translate the retired espresso palette to its cream twin
 *   guard   touch nothing but text that would not read on its ground (4.5:1; large text 3:1)
 * Walks the tags once with a stack of grounds (so light text on a band that became ink stays
 * light, and dark text in a box that became paper stays dark). Touches ONLY style="", bgcolor=""
 * and color="" values, plus a style on bare <h1–h4>, on <a> without a colour, and on <hr>.
 * Text and every other attribute (href, src, alt, id, class, data-*) are copied byte for byte.
 */
function restyle(html, opts) {
    const mode = (opts && opts.mode) || 'legacy';
    const baseGround = P((opts && opts.ground) || T.cream);
    const src = String(html == null ? '' : html);
    const stack = [];   // { tag, bg, changed, image }
    const ground = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].bg || stack[i].image) return stack[i]; return null; };
    let out = '', last = 0, m;
    const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
    while ((m = tagRe.exec(src))) {
        out += src.slice(last, m.index);
        last = tagRe.lastIndex;
        if (m[0].charCodeAt(1) === 33) { out += m[0]; continue; }       // <!-- comment -->
        const tag = m[2].toLowerCase();
        if (m[1] === '/') {
            for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
            out += m[0];
            continue;
        }
        const g = ground();
        const groundColor = g ? (g.bg || null) : baseGround;
        const ctx = { darkGround: groundColor ? lum(over(groundColor, baseGround)) < 0.18 : false };
        let attrs = m[3] || '';
        let ownBg = null, bgChanged = false, image = false, changed = false;
        attrs = attrs.replace(/(\s)(bgcolor|color)(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi, (a0, sp, name, eq, q, v1, v2, v3) => {
            const v = v1 != null ? v1 : v2 != null ? v2 : v3;
            const c = parseColor(v);
            if (!c) return a0;
            const kind = name.toLowerCase() === 'bgcolor' ? 'bg' : 'text';
            const n = mode === 'guard' ? null : mode === 'dark' ? darkToLightColor(c) : brandColor(c, kind, ctx);
            if (kind === 'bg') { ownBg = n || c; if (n) bgChanged = true; }
            if (!n) return a0;
            changed = true;
            const nv = fmt(n, v).replace(/^rgba\(.*\)$/, x => '#' + x.match(/\d+/g).slice(0, 3).map(hex2).join(''));
            return sp + name + eq + (v1 != null ? `"${nv}"` : v2 != null ? `'${nv}'` : nv);
        });
        let hadStyle = false;
        attrs = attrs.replace(/(\s)(style)(\s*=\s*)("([^"]*)"|'([^']*)')/i, (a0, sp, name, eq, q, v1, v2) => {
            hadStyle = true;
            const v = v1 != null ? v1 : v2;
            const r = restyleDecls(v, mode, ctx);
            if (r.bg) { ownBg = r.bg; bgChanged = bgChanged || r.bgChanged; }
            if (r.image) image = true;
            let st = r.style;
            if (mode === 'legacy' && /^h[1-4]$/.test(tag)) st = headStyle(st, ctx.darkGround);
            if (mode === 'legacy' && tag === 'a' && !/(^|;)\s*color\s*:/i.test(st)) st = `color:${ctx.darkGround ? T.gold : T.crimson};` + st;
            if (mode === 'legacy' && tag === 'a') { const b = houseButton(v); if (b) { st = b.style; ownBg = parseColor(b.filled ? T.crimson : T.cream); } }
            // readability: judge text against its own ground, else the nearest ground above it
            const gr = ownBg ? over(ownBg, groundColor || baseGround) : (g && g.image ? null : (groundColor ? over(groundColor, baseGround) : baseGround));
            const touched = st !== v || bgChanged || (g && g.changed) || mode === 'dark';
            if (gr && !(g && g.image) && !image) st = guardText(st, gr, textMin(st));
            if (st === v) return a0;
            changed = true;
            const quote = v1 != null ? '"' : "'";
            return sp + name + eq + quote + (quote === '"' ? st.replace(/"/g, '&quot;') : st.replace(/'/g, '&#39;')) + quote;
        });
        if (!hadStyle && mode === 'legacy') {
            let add = '';
            if (/^h[1-4]$/.test(tag)) add = headStyle('', ctx.darkGround);
            else if (tag === 'a' && !/\scolor\s*=/i.test(attrs)) add = `color:${ctx.darkGround ? T.gold : T.crimson};`;
            else if (tag === 'hr') add = `border:0;border-top:1px solid ${T.hairline};margin:20px 0;`;
            if (add) { attrs += ` style="${add}"`; changed = true; }
        }
        if (!VOID.test(tag) && !m[4]) stack.push({ tag, bg: ownBg, changed: bgChanged, image });
        out += changed ? `<${m[2]}${attrs}${m[4] ? ' /' : ''}>` : m[0];
    }
    out += src.slice(last);
    return out;
}

// =============================================================== the send boundary
const MARK_RE = /data-mx-layout="/;
function isBranded(html) { return MARK_RE.test(String(html || '')); }

function langOf(html) { const m = /<html[^>]*\blang="(hr|en)"/i.exec(html); return m ? m[1].toLowerCase() : 'en'; }
function titleOf(html) { const m = /<title>([\s\S]*?)<\/title>/i.exec(html); return m ? m[1].trim() : ''; }
function decodeBasic(s) { return String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }

// Balanced element range: given the index of "<div" / "<table" …, the index just past its close.
function elementEnd(html, start) {
    const tm = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(start, start + 20));
    if (!tm) return -1;
    const re = new RegExp(`<(/?)${tm[1]}\\b[^>]*>`, 'gi');
    re.lastIndex = start;
    let depth = 0, m;
    while ((m = re.exec(html))) {
        if (m[1]) { depth--; if (depth === 0) return re.lastIndex; }
        else if (!/\/>$/.test(m[0])) depth++;
    }
    return -1;
}
// The top-level nodes of a fragment: elements { tag, open, inner, src }, { text }, { comment }.
function topNodes(html) {
    const out = [];
    const s = String(html);
    let i = 0;
    while (i < s.length) {
        const lt = s.indexOf('<', i);
        if (lt < 0) { out.push({ text: s.slice(i) }); break; }
        if (lt > i) out.push({ text: s.slice(i, lt) });
        if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); const end = e < 0 ? s.length : e + 3; out.push({ comment: s.slice(lt, end) }); i = end; continue; }
        const tm = /^<([a-zA-Z][a-zA-Z0-9]*)(?:\s(?:"[^"]*"|'[^']*'|[^'">])*)?>/.exec(s.slice(lt));
        if (!tm) { out.push({ text: '<' }); i = lt + 1; continue; }
        const tag = tm[1].toLowerCase();
        if (VOID.test(tag) || /\/>$/.test(tm[0])) { out.push({ tag, open: tm[0], inner: '', src: tm[0] }); i = lt + tm[0].length; continue; }
        const end = elementEnd(s, lt);
        if (end < 0) { out.push({ text: s.slice(lt) }); break; }
        const whole = s.slice(lt, end);
        const closeAt = whole.toLowerCase().lastIndexOf('</' + tag);
        out.push({ tag, open: tm[0], inner: whole.slice(tm[0].length, closeAt), close: whole.slice(closeAt), src: whole });
        i = end;
    }
    return out;
}
const elems = nodes => nodes.filter(n => n.tag);
const onlyElems = nodes => nodes.every(n => n.tag || n.comment || (n.text != null && !n.text.trim()));
const styleOf = open => { const m = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(open || ''); return m ? (m[2] != null ? m[2] : m[3]) : ''; };
const setStyle = (open, st) => /\sstyle\s*=/i.test(open)
    ? open.replace(/(\sstyle\s*=\s*)("[^"]*"|'[^']*')/i, (x, p) => `${p}"${st.replace(/"/g, '&quot;')}"`)
    : open.replace(/^<([a-zA-Z0-9]+)/, (x, t) => `<${t} style="${st.replace(/"/g, '&quot;')}"`);
const bgOfStyle = st => { const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(st || ''); if (!m) return null; const t = (m[1].match(COLOR_RE) || [])[0]; return t ? parseColor(t) : null; };
const keepDecls = (st, props) => (String(st || '').match(new RegExp(`(?:^|;)\\s*(?:${props})\\s*:[^;]+`, 'gi')) || []).map(x => x.replace(/^;/, '').trim()).join(';');

// A mini-shell (the older Accelerator / sequence / speaker / reviewer mails): a coloured title band,
// boxed panels, sometimes a dark footer band. The band becomes the block's eyebrow + headline, the
// panels lose their boxes, a footer band becomes a quiet closing line — same elements, same text,
// same links, calmer styles.
const HEADLINE_CSS = `margin:0;font-family:${T.serif};font-weight:400;font-size:28px;line-height:1.18;letter-spacing:-.005em;color:${T.ink};`;
const EYEBROW_CSS = `margin:0 0 10px;font-family:${T.sans};font-weight:600;font-size:10px;line-height:1.5;letter-spacing:.18em;text-transform:uppercase;color:${T.goldDark};`;
const SUBLINE_CSS = `margin:10px 0 0;font-family:${T.sans};font-size:15px;line-height:1.6;color:${T.soft};`;
const visibleText = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, ' ').trim();
const isBrandWord = t => /^med\s*&\s*x$/i.test(visibleText(t).replace(/&amp;/g, '&'));
function bandToHeadline(band) {
    const parts = elems(topNodes(band.inner));
    const restyleOpen = (open, css) => setStyle(open.replace(/\sclass\s*=\s*("[^"]*"|'[^']*')/i, ''), css);
    let inner;
    if (parts.length && parts.every(e => /^(h[1-6]|p|div|span)$/.test(e.tag))) {
        // the headline is the first heading that is not just the brand word, else the largest line
        let hi = parts.findIndex(e => /^h[1-3]$/.test(e.tag) && !isBrandWord(e.inner));
        if (hi < 0) hi = parts.length > 1 ? parts.findIndex((e, i) => i > 0 && !isBrandWord(e.inner)) : 0;
        if (hi < 0) hi = 0;
        inner = parts.map((e, i) => {
            const css = i === hi ? HEADLINE_CSS : i < hi ? EYEBROW_CSS : SUBLINE_CSS;
            const open = restyleOpen(e.open, css);
            return (i === hi ? open.replace(/^<([a-z0-9]+)/i, '<$1 class="mx-h1"') : open) + e.inner + e.close;
        }).join('');
    } else {
        inner = `<div class="mx-h1" style="${HEADLINE_CSS}">${band.inner}</div>`;
    }
    return setStyle(band.open, 'padding:0 0 6px;text-align:left;') + inner + band.close;
}
function calmSections(html) {
    const kids = topNodes(String(html).trim());
    const ek = elems(kids);
    if (!ek.length) return null;
    const short = e => visibleText(e.inner).length <= 140 && !/<(table|img|a|ul|ol)\b/i.test(e.inner);
    const first = ek[0];
    // the title band: a short first block with its own fill, or one that opens with a heading
    const band = first.tag === 'div' && short(first) && (!!bgOfStyle(styleOf(first.open)) || /^\s*<h[1-3][\s>]/i.test(first.inner)) ? first : null;
    const last = ek[ek.length - 1];
    const footBand = ek.length > 2 && last.tag === 'div' && last !== band && short(last) && (!!bgOfStyle(styleOf(last.open)) || /border-top/i.test(styleOf(last.open))) ? last : null;
    // two headings in a row at the top (programme name, then the message title) read as
    // eyebrow + headline
    const pair = !band && ek.length > 2 && /^h[1-3]$/.test(ek[0].tag) && /^h[1-4]$/.test(ek[1].tag) && short(ek[0]) && short(ek[1]) ? [ek[0], ek[1]] : null;
    let changed = false, out = '';
    for (const k of kids) {
        if (!k.tag) { out += k.text != null ? k.text : k.comment; continue; }
        const st = styleOf(k.open);
        if (k === band) { out += bandToHeadline(k); changed = true; continue; }
        if (pair && k === pair[0]) { out += setStyle(k.open, EYEBROW_CSS) + k.inner + k.close; changed = true; continue; }
        if (pair && k === pair[1]) { out += setStyle(k.open, HEADLINE_CSS + 'margin-bottom:6px;').replace(/^<([a-z0-9]+)/i, '<$1 class="mx-h1"') + k.inner + k.close; changed = true; continue; }
        if (k === footBand) {
            out += setStyle(k.open, `margin-top:24px;padding:16px 0 0;border-top:1px solid ${T.hairline};text-align:left;font-size:12px;color:${T.muted};`) + k.inner.replace(/(\sstyle\s*=\s*")([^"]*)"/gi, (m0, p1, v) => p1 + v.replace(/(^|;)\s*(background|background-color)\s*:[^;]*/gi, '') + '"') + k.close;
            changed = true; continue;
        }
        if (k.tag === 'div' && (bgOfStyle(st) || /border\s*:|border-radius|padding\s*:/i.test(st))) {
            // a panel: keep type and alignment, drop the box (a quoted box keeps a soft paper ground)
            const inset = /border-left/i.test(st);
            out += setStyle(k.open, (inset ? `margin:16px 0;padding:14px 18px;background:${T.cardCream};border-left:2px solid ${T.gold};` : 'padding:14px 0 0;') + keepDecls(st, 'text-align|color|font-size|line-height|font-family')) + k.inner + k.close;
            changed = true; continue;
        }
        out += k.src;
    }
    return changed ? out : null;
}
function unboxMiniShell(fragment) {
    const tops = topNodes(String(fragment).trim());
    if (!onlyElems(tops) || elems(tops).length !== 1) return null;
    const wrap = elems(tops)[0];
    if (wrap.tag !== 'div' || !/max-width\s*:\s*[4-7]\d\dpx/i.test(styleOf(wrap.open))) return null;
    const inner = calmSections(wrap.inner);
    return inner == null ? null : setStyle(wrap.open, keepDecls(styleOf(wrap.open), 'font-size|line-height|color|text-align')) + inner + wrap.close;
}

// The pre-2026-09-25 member-portal buildEmailTemplate() (navy header, title bar, white body).
function unwrapLetterheadMember(html) {
    if (!/<!-- Title bar -->/.test(html) || !/<!-- Body -->/.test(html) || !/Building Bridges in Biomedicine/.test(html) || /<!-- Header: the REAL/.test(html)) return null;
    const t = /<!-- Title bar -->[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    const b = /<!-- Body -->\s*<tr><td[^>]*>\s*<div[^>]*>([\s\S]*)<\/div>\s*<\/td><\/tr>\s*<!-- Footer -->/.exec(html);
    if (!b) return null;
    return { family: 'member', title: t ? t[1].trim() : '', body: b[1], lang: langOf(html) };
}
// The pre-2026-09-25 admin-portal buildEmailTemplate() (white logo band, optional title bar).
function unwrapLetterheadAdmin(html) {
    if (!/<!-- Header: the REAL Med&X logo on a clean white band -->/.test(html) || !/<!-- Body -->/.test(html)) return null;
    const t = /<!-- Title bar -->[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    const b = /<!-- Body -->\s*<tr><td[^>]*>\s*<div[^>]*>([\s\S]*)<\/div>\s*<\/td><\/tr>\s*<!-- Footer -->/.exec(html);
    if (!b) return null;
    const acc = /border-bottom: 3px solid (#[0-9a-fA-F]{6})/.exec(html);
    const nl = /<a href="([^"]+)"[^>]*>Sign up for our newsletter<\/a>/.exec(html);
    return { family: 'admin', title: t ? t[1].trim() : '', body: b[1], lang: langOf(html), newsletterUrl: nl ? nl[1] : '',
        accent: acc && /9b1b22/i.test(acc[1]) ? 'crimson' : acc && /c9a962/i.test(acc[1]) ? 'gold' : 'ink' };
}
// The pre-2026-09-25 v2 shell (email-templates.js), light or espresso — an older queued row.
function unwrapV2Shell(html) {
    if (!/class="em-canvas"/.test(html) || !/class="em-cardbg"/.test(html) || isBranded(html)) return null;
    const x = /<tr><td style="background:#191512;padding:[^"]*">([\s\S]*?)<\/td><\/tr>\s*<tr><td style="height:2px;font-size:0;line-height:0;([^"]*)">&nbsp;<\/td><\/tr>\s*<tr><td>([\s\S]*)<\/td><\/tr>\s*<tr><td align="center" class="em-hair"[^>]*>([\s\S]*?)<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin-top:12px;">/.exec(html);
    if (!x) return null;
    const lab = /<td align="right" style="vertical-align:middle;[^"]*">([\s\S]*?)<\/td>/.exec(x[1]);
    const extra = /<\/tr><\/table>([\s\S]*)$/.exec(x[1]);
    const footer = [];
    x[4].replace(/<div class="em-soft"[^>]*>([\s\S]*?)<\/div>/g, (m0, t) => { footer.push(t); return m0; });
    const pre = /<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">([\s\S]*?)<\/div>/.exec(html);
    const dark = /<body[^>]*background:#120e0a/.test(html);
    return { title: decodeBasic(titleOf(html)), preheader: pre ? decodeBasic(pre[1]) : '', label: lab ? lab[1] : '',
        headerExtraHtml: extra && extra[1].trim() ? extra[1] : '', rule: /linear-gradient/.test(x[2]) ? 'split' : /#c9a962/i.test(x[2]) ? 'gold' : 'crimson',
        body: x[3], footer, lang: langOf(html), darkReady: /prefers-color-scheme: dark/.test(html) && !dark, tone: dark ? 'dark' : '' };
}
// A hand-built "brand-lite" document: an ink band holding a text "Med&X" (+ caps label), an
// optional 2px rule, content panel(s), an optional hairline footer (Gala desk, money, forum …).
function unwrapBrandLite(html) {
    const bm = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html);
    if (!bm) return null;
    let nodes = topNodes(bm[1].trim());
    for (let guard = 0; guard < 4; guard++) {
        if (!onlyElems(nodes)) return null;
        const el = elems(nodes);
        if (el.length >= 2 && el[0].tag === 'div' && /background\s*:\s*#191512/i.test(styleOf(el[0].open))) break;
        if (el.length !== 1 || el[0].tag !== 'div') return null;
        nodes = topNodes(el[0].inner);
    }
    const el = elems(nodes);
    if (el.length < 2 || !/background\s*:\s*#191512/i.test(styleOf(el[0].open))) return null;
    const head = el[0];
    const headText = head.inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const mm = /^med\s*&(?:amp;)?\s*x\b\s*/i.exec(headText);
    if (!mm) return null;
    const label = headText.slice(mm[0].length).trim();
    let rest = el.slice(1);
    let rule = /border-bottom\s*:\s*2px solid #c9a962/i.test(styleOf(head.open)) ? 'gold' : 'crimson';
    if (rest[0] && /height\s*:\s*2px/i.test(styleOf(rest[0].open)) && !rest[0].inner.replace(/&nbsp;/g, '').trim()) {
        rule = /#c9a962/i.test(styleOf(rest[0].open)) ? 'gold' : 'crimson';
        rest = rest.slice(1);
    }
    let footer = [];
    const tail = rest[rest.length - 1];
    if (rest.length > 1 && /border-top/i.test(styleOf(tail.open)) && !/<a\s/i.test(tail.inner) && tail.inner.length < 700) {
        footer = [tail.inner.trim()];
        rest = rest.slice(0, -1);
    }
    return { label, rule, body: rest.map(e => e.src).join('\n'), footer, lang: langOf(html), title: decodeBasic(titleOf(html)) };
}
// A single boxed panel in <body> with no brand band of its own (the Gala audit alert, tests).
function unwrapSinglePanel(html) {
    const bm = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html);
    if (!bm) return null;
    const nodes = topNodes(bm[1].trim());
    if (!onlyElems(nodes) || elems(nodes).length !== 1 || !/^(div|table)$/.test(elems(nodes)[0].tag)) return null;
    const p = elems(nodes)[0];
    if (/background\s*:\s*#191512|<img[^>]+(logo|wordmark)/i.test(p.inner.slice(0, 2000))) return null;
    return { body: p.tag === 'div' ? p.inner : p.src, lang: langOf(html), title: decodeBasic(titleOf(html)) };
}
// Content panels lose their own box (the card is the box now); the words stay put. A wrapper that
// is only padding loses it too (the block already sets the column, so it would indent twice), and
// a short serif title opening the content becomes the block's headline.
function unboxPanels(body) {
    let first = true;
    return topNodes(String(body).trim()).map(n => {
        if (!n.tag) return n.text != null ? n.text : n.comment;
        const lead = first; first = false;
        if (n.tag === 'div') {
            const st = styleOf(n.open);
            const boxed = /background\s*:\s*#(fdfaf3|fff|ffffff)\b/i.test(st) || /border\s*:\s*1px solid/i.test(st);
            const padOnly = !boxed && /(^|;)\s*padding\s*:/i.test(st) && !bgOfStyle(st) && !/border/i.test(st)
                && !String(st).split(';').some(d => d.trim() && !/^(padding(-[a-z]+)?|font-size|line-height|color|text-align|font-family)\s*:/i.test(d.trim()));
            if (boxed || padOnly) return setStyle(n.open, keepDecls(st, 'font-size|line-height|color|text-align')) + (lead ? titleToHeadline(n.inner) : n.inner) + n.close;
            if (lead && isSerifTitle(n)) return titleToHeadline(n.src);
        }
        return n.src;
    }).join('');
}
// a short serif title (a Georgia 20px+ div or p, no links or tables) at the head of the content
function isSerifTitle(e) {
    const st = styleOf(e.open);
    const fam = (/(?:^|;)\s*font-family\s*:\s*([^;]+)/i.exec(st) || /(?:^|;)\s*font\s*:\s*([^;]+)/i.exec(st) || [])[1] || '';
    const serif = /georgia|fraunces|times|serif/i.test(fam) && !/sans-serif/i.test(fam);
    const size = /font-size\s*:\s*([\d.]+)px/i.exec(st) || /font\s*:[^;]*?([\d.]+)px/i.exec(st);
    return /^(div|p)$/.test(e.tag) && serif && size && +size[1] >= 20 && visibleText(e.inner).length <= 140 && !/<(table|a|img|ul|ol|div|p)\b/i.test(e.inner);
}
function titleToHeadline(html) {
    const nodes = topNodes(String(html));
    const i = nodes.findIndex(x => x.tag || (x.text != null && x.text.trim()));
    if (i < 0 || !nodes[i].tag || !isSerifTitle(nodes[i])) return html;
    const e = nodes[i];
    const open = setStyle(e.open, HEADLINE_CSS + 'margin-bottom:16px;');
    nodes[i] = { src: (/\sclass\s*=\s*"/i.test(open) ? open.replace(/(\sclass\s*=\s*")/i, '$1mx-h1 ') : open.replace(/^<([a-z0-9]+)/i, '<$1 class="mx-h1"')) + e.inner + e.close };
    return nodes.map(x => x.src != null ? x.src : x.text != null ? x.text : x.comment).join('');
}

// A fragment wrapped in one max-width panel of its own (padding, a fill) — the card is the panel
// now, so the wrapper keeps only its type settings.
function unboxWrapper(fragment) {
    const tops = topNodes(String(fragment).trim());
    if (!onlyElems(tops) || elems(tops).length !== 1) return null;
    const w = elems(tops)[0];
    if (w.tag !== 'div' || !/max-width\s*:\s*[4-7]\d\dpx/i.test(styleOf(w.open))) return null;
    return setStyle(w.open, keepDecls(styleOf(w.open), 'font-size|line-height|color|text-align|font-family')) + w.inner + w.close;
}

function textToHtml(text) {
    return String(text).trim().split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * ensureBranded(html, { subject }) — the send boundary: returns the message in the layout.
 * Idempotent (branded HTML comes back as the same string) and never throws.
 */
function ensureBranded(html, meta) {
    const src = String(html == null ? '' : html);
    if (!src.trim() || isBranded(src)) return html;
    const subject = (meta && meta.subject) || '';
    try {
        if (/<html[\s>]|<body[\s>]|<!doctype/i.test(src)) {
            const lh = unwrapLetterheadMember(src) || unwrapLetterheadAdmin(src);
            if (lh) return letterhead({ family: lh.family, title: lh.title, bodyHtml: lh.body, locale: lh.lang, accent: lh.accent, newsletterUrl: lh.newsletterUrl, subjectTitle: subject });
            const v = unwrapV2Shell(src);
            if (v) return layout({ title: v.title || subject, preheader: v.preheader, lang: v.lang, label: v.label, headerExtraHtml: v.headerExtraHtml,
                rule: v.rule, darkReady: v.darkReady, footer: v.tone === 'dark' ? v.footer.map(f => restyle(f, { mode: 'dark' })) : v.footer,
                body: v.tone === 'dark' ? restyle(v.body, { mode: 'dark' }) : v.body });
            const b = unwrapBrandLite(src);
            if (b) return layout({ title: b.title || subject, lang: b.lang, label: b.label, rule: b.rule, footer: b.footer.length ? b.footer : undefined,
                body: block({ bodyHtml: restyle(unboxPanels(b.body)) }) });
            const p = unwrapSinglePanel(src);
            if (p) return layout({ title: p.title || subject, lang: p.lang, body: block({ bodyHtml: restyle(unboxMiniShell(p.body) || calmSections(p.body) || unboxWrapper(p.body) || p.body) }) });
            // an unknown full document keeps its structure and gets the palette
            return restyle(src).replace(/<body(?=[\s>])/i, '<body data-mx-layout="restyled"');
        }
        const hasTags = /<[a-zA-Z!\/][^>]*>/.test(src);
        const bodyHtml = hasTags ? restyle(unboxMiniShell(src) || unboxWrapper(src) || src) : textToHtml(src);
        return layout({ title: subject, body: block({ bodyHtml }) });
    } catch (e) {
        try { console.error('[email-layout] ensureBranded kept the original:', e && e.message); } catch (x) { /* ignore */ }
        return html;
    }
}

/**
 * toText(html) — the text/plain alternative. Chrome marked <!--mx:skip--> (preheader, the
 * wordmark row, the social icons) is left out, and so is any hidden preheader a body carries of
 * its own, with its invisible filler (&zwnj;, &#847;, zero-width spaces); links read
 * "label (url)"; blocks become lines.
 */
const HIDDEN_FILLER = /&zwnj;|&#8204;|&#x200c;|&#847;|&#x34f;|&#8203;|&#x200b;|&#65279;|&#xfeff;|[\u200b\u200c\u034f\ufeff]/gi;
// every display:none <div>/<span>, balanced (a hidden element keeps its nested tags to itself)
function dropHidden(s) {
    const re = /<(div|span)\b[^>]*display\s*:\s*none[^>]*>/gi;
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
        const end = elementEnd(s, m.index);
        if (end < 0) break;
        out += s.slice(last, m.index) + ' ';
        last = re.lastIndex = end;
    }
    return out + s.slice(last);
}
function toText(html) {
    return dropHidden(String(html || '')
        .replace(/<head[\s\S]*?<\/head>/i, ' ')
        .replace(/<!--mx:skip-->[\s\S]*?<!--\/mx:skip-->/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' '))
        .replace(HIDDEN_FILLER, '')
        .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
            const l = label.replace(/<img[^>]*\salt="([^"]*)"[^>]*>/gi, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            const h = href.replace(/&amp;/g, '&');
            return l && decodeBasic(l) !== h ? `${l} (${h})` : h;
        })
        .replace(/<img[^>]*\salt="([^"]+)"[^>]*>/gi, ' $1 ')
        .replace(/<span\b[^>]*display\s*:\s*block[^>]*>/gi, '\n')
        .replace(/<\/?(b|i|em|strong|span|u|small|sup|sub|font|code|mark|abbr|s)\b[^>]*>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|td|h\d|li|table)>/gi, '\n').replace(/<(p|h\d|li)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
        .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“').replace(/&euro;/g, '€').replace(/&hellip;/g, '…')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&deg;/g, '°').replace(/&rarr;/g, '→').replace(/&larr;/g, '←').replace(/&bull;/g, '•').replace(/&times;/g, '×').replace(/&copy;/g, '©')
        .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch (e) { return m; } })
        .replace(/&#x([0-9a-f]+);/gi, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (e) { return m; } })
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
    LAYOUT_VERSION, T, DEFAULT_LINKS, ICON, DARK_CSS,
    esc, escUrl, microStyle, logoUrl, btn,
    layout, block, facts, letterhead, letterheadFooter, restyle, ensureBranded, isBranded, toText,
    _internals: { parseColor, brandColor, darkToLightColor, contrast, unwrapLetterheadMember, unwrapLetterheadAdmin, unwrapV2Shell,
        unwrapBrandLite, unwrapSinglePanel, unboxMiniShell, calmSections, unboxWrapper, unboxPanels, topNodes, elementEnd }
};
