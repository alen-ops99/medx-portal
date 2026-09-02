// Source: Admin Studio.dc.html — make and store things (README note 23: badges from live guest
// lists, per-person certificates, print suite, social cards, brand kit downloads).
// Blocks (artboard order): "Tool cards" (Name badges · Certificates · Print suite · Social cards ·
// Sign-up form pages · 3D ballroom planner) › "Tool drawer" (per-tool real content) ›
// "BRAND ASSETS" › "PHOTO LIBRARY" (team review C — Laura).
// UX audit 2026-09-02 #15: the artboard's "STORED FILES" card is deleted — it was an empty box
// pointing at Settings → TEAM LIBRARY, where those files already live (see the note further down).
// Real wiring: print suite = the existing /api/admin/print/* engine (context + HTML preview always
// work; the print-ready PDF needs headless Chrome on the service and says so when it is missing);
// certificates = the existing certificates table + a brand-true preview (v2 studio module);
// social cards = the artboard's 1080×1080 canvas download + the member portal's live attendance
// cards (v2_attendance_cards, images served member-side).
// Studio extras (team review Aug 2026 §C "Studio"):
//   photo library (v2_studio_assets — upload ≤8MB jpg/png/webp, tags, copy-URL, soft delete);
//   per-tool SETTINGS drawers (v2_studio_settings) that the generate buttons genuinely read —
//   badges build at the configured trim via /api/v2/studio/badges/* (the legacy engine is fixed
//   at 90×55), certificates read signer settings server-side, the roll-up banner size rides the
//   engine's own `size` field; social-card backgrounds (ink/crimson/gold/cream/library photo under
//   a dark scrim); the sign-up tile opens a FORM LINKS panel (Miro: no more blind /links routing)
//   with a ?new=1 deep link; the 3D-planner tile points at the external planner; the Studio's
//   "+ UPLOAD" is the photo-library upload (team files upload lives in Settings → TEAM LIBRARY).
import cfg from '../config.js';
import { api } from '../api.js';
import { ui, esc } from '../ui.js';

export const SOURCE = 'Admin Studio.dc.html';
export const COPY = {
  title: 'The <i>Studio</i>', sub: 'make and store things — everything comes out already in the Med&amp;X look',
  tools: {
    badges: { tag: 'PRINT', tagColor: '#9b1b22', name: 'Name badges', why: 'Pick an event, get a print-ready sheet of badges for everyone registered — updated to the minute.', cta: 'MAKE BADGES →' },
    certs: { tag: 'PRINT', tagColor: '#9b1b22', name: 'Certificates', why: 'CME attendance and speaker thank-yous — generated per person, auto-sent after the week or printed here.', cta: 'MAKE CERTIFICATES →' },
    print: { tag: 'PRINT', tagColor: '#9b1b22', name: 'Print suite', why: 'Signs, roll-up banners and stage backdrops for any event — content flows in, you print the PDF.', cta: 'OPEN PRINT SUITE →' },
    social: { tag: 'SHARE', tagColor: '#b7791f', name: 'Social cards', why: 'Turn any announcement into a square image for Instagram or LinkedIn — headline, date, done.', cta: 'MAKE A CARD →' },
    signup: { tag: 'SHARE', tagColor: '#b7791f', name: 'Sign-up form pages', why: 'Public one-page forms for short events — a link you can put anywhere, replies land in People.', cta: 'FORM LINKS →' },
    planner: { tag: 'EVENT', tagColor: '#2f7d4f', name: '3D ballroom planner', why: 'Arrange Gala tables in the Esplanade ballroom and walk the room before the night.', cta: 'OPEN THE 3D PLANNER ↗', cta2: 'GALA SEATING →', note: 'external tool — seating imports back via Gala → table assignments' }
  },
  titles: { badges: 'NAME BADGES — LIVE LIST, PRINT-READY', certs: 'CERTIFICATES — PER PERSON', print: 'PRINT SUITE — PICK A TEMPLATE', social: 'SOCIAL CARD — TYPE, PREVIEW, DOWNLOAD', signup: 'SIGN-UP FORM PAGES — LIVE FORM LINKS' },
  close: '✕ CLOSE',
  settings: {
    open: '⚙ SETTINGS', close: '⚙ HIDE SETTINGS', save: 'SAVE SETTINGS', saved: 'SETTINGS SAVED — THE GENERATE BUTTONS USE THEM NOW',
    badgeSize: 'BADGE SIZE', badgeSizes: [['std', 'STANDARD · 90×55 mm'], ['a6', 'A6 · 148×105 mm'], ['a7', 'A7 · 105×74 mm'], ['custom', 'CUSTOM · mm']],
    sponsorStrip: 'SPONSOR LOGO STRIP', sponsorWhy: n => n ? `${n} logo${n === 1 ? '' : 's'} tagged “sponsor” in the photo library` : 'no photos tagged “sponsor” yet — tag them in the photo library below',
    sigLine: 'SIGNATURE LINE', signer: 'SIGNER NAME', signerTitle: 'SIGNER TITLE',
    bannerSize: 'ROLL-UP BANNER SIZE', bannerSizes: [['100x200', '100 × 200 cm'], ['85x200', '85 × 200 cm']],
    printFixed: 'the A4 sign and the 240×240 cm backdrop are fixed formats — the size applies to the roll-up banner'
  },
  badges: {
    gen: 'PREVIEW THE SHEET', pdf: 'DOWNLOAD PRINT PDF',
    note: (t, sponsors) => `${t.w_mm}×${t.h_mm} mm badges on A4 — name, institution, QR · always the live list, never stale${sponsors ? ' · sponsor strip on' : ''}`,
    counts: c => `${c.total} on the live list · ${c.withQr} with a QR · ${c.speaker || 0} speaker${(c.speaker || 0) === 1 ? '' : 's'}`
  },
  certs: {
    types: [['attendance', 'CME attendance'], ['speaker', 'Speaker thank-you'], ['cme', 'Attendance · CME points']],
    gen: 'PREVIEW ONE',
    note: 'Per-person PDFs · issued automatically after the event, and each lands in the member’s wallet under “My record”.',
    issued: (n) => n ? `${n} certificate${n === 1 ? '' : 's'} issued so far` : 'none issued yet — they mint after check-in'
  },
  print: {
    kinds: [['sign', 'A4 SIGN'], ['banner', 'ROLL-UP BANNER'], ['backdrop', 'STAGE BACKDROP']],
    gen: 'OPEN TEMPLATE', pdf: 'DOWNLOAD PRINT PDF',
    note: 'Content flows in from the event — you only adjust wording.'
  },
  social: {
    headPh: 'Headline — e.g. Plexus 2026: registration open',
    subPh: 'One line under it — e.g. December 4–5 · Novinarski dom, Zagreb',
    dl: 'DOWNLOAD PNG · 1080×1080', done: 'PNG DOWNLOADED — READY FOR INSTAGRAM OR LINKEDIN',
    headPrev: 'Your headline here', subPrev: 'date · place',
    bg: 'BACKGROUND', bgNames: { ink: 'INK', crimson: 'CRIMSON', gold: 'GOLD', cream: 'CREAM + INK' },
    bgPhotos: 'OR A LIBRARY PHOTO — drawn under a dark scrim so the text stays legible',
    bgNoPhotos: 'upload photos to the library below to use one as a card background',
    taint: 'THAT PHOTO BLOCKS CANVAS EXPORT — PICK ANOTHER OR RE-UPLOAD IT TO THE LIBRARY',
    imgFail: 'COULD NOT LOAD THAT PHOTO — PICK ANOTHER',
    recent: 'FRESH FROM THE MEMBER PORTAL', recentWhy: 'attendance cards the system generated from real registrations — auto-emailed to each guest',
    recentNone: 'No member cards yet — they generate themselves on registration.'
  },
  forms: {
    sub: 'every live registration link, with its sign-up count — replies land in People / Registrations',
    uses: n => `${n} sign-up${n === 1 ? '' : 's'}`, paused: 'paused', expired: 'expired',
    copy: 'COPY', copied: 'LINK COPIED — PASTE IT ANYWHERE',
    newLink: 'NEW FORM LINK →', newWhy: 'opens the links tool with the creator ready — pause, QR and limits live there too',
    empty: 'No form links yet.', emptyWhy: 'Create the first one — it is live the moment it exists.',
    busy: 'Fetching the live links…'
  },
  brand: {
    title: 'BRAND ASSETS', sub: 'the official kit — always grab it from here so nothing drifts',
    logos: 'LOGOS', dl: 'DOWNLOAD THE LOGO · PNG →', dlWhite: 'WHITE · PNG →', dlMark: 'THE MARK · PNG →',
    colours: 'COLOURS', type: 'TYPE',
    copied: h => h + ' COPIED'
  },
  library: {
    title: 'PHOTO LIBRARY', sub: 'shared images for cards, badges and pages — copy a URL anywhere',
    upload: '+ UPLOAD', uploading: 'STORING…',
    uploaded: 'PHOTO STORED — TAG IT AND COPY THE URL ANYWHERE',
    searchPh: 'Search by name…', all: 'ALL',
    copyUrl: 'COPY URL', urlCopied: 'PHOTO URL COPIED', del: 'REMOVE', removed: 'PHOTO REMOVED — THE FILE IS KEPT, ASK IF YOU NEED IT BACK',
    delTitle: 'Remove this photo?', delBody: n => `“${n}” disappears from the library (soft delete — nothing on disk is destroyed).`, delOk: 'REMOVE', delCancel: 'KEEP',
    tooBig: 'IMAGES UP TO 8MB ONLY — EXPORT A SMALLER ONE', badType: 'JPG, PNG OR WEBP ONLY',
    by: n => n ? `by ${n}` : '',
    empty: 'No photos yet.', emptyWhy: 'Speakers, venues, sponsor logos, past editions — upload them once, reuse them everywhere. Tag sponsor logos “sponsor” and the badge strip picks them up.'
  },
  merch: { note: 'Merch studio — its own tool, one link deep, unchanged', open: 'MERCH →' },
  engineDown: 'The print engine (headless Chrome) is off on this machine — the on-screen preview is exact; the print-ready PDF renders on the staging service.'
};

const PLANNER_URL = 'https://plexus-tables.netlify.app';   // external tool (team review: replace the broken tile link)
const COLOURS = [['#9B1B22', 'Med&X red'], ['#C9A962', 'gold'], ['#15110f', 'ink'], ['#fbf9f6', 'paper'], ['#f3efe9', 'paper-2']]; // values from medx.hr/styles.css (team review Aug 2026 — the kit had drifted)
// social-card background system — solid grounds + their legible text/rule colours; photos ride under a dark scrim
const SOCIAL_BGS = {
  ink: { fill: '#191512', head: '#f7f1e6', sub: 'rgba(247,241,230,.65)', rule: '#c9a962', brand: '#c9a962' },
  crimson: { fill: '#9b1b22', head: '#f7f1e6', sub: 'rgba(247,241,230,.72)', rule: '#c9a962', brand: '#e8c97a' },
  gold: { fill: '#c9a962', head: '#15110f', sub: 'rgba(21,17,15,.72)', rule: '#15110f', brand: '#15110f' },
  cream: { fill: '#f7f1e6', head: '#15110f', sub: 'rgba(21,17,15,.66)', rule: '#9b1b22', brand: '#9b1b22' }
};
const LIB_TAGS = ['gala', 'plexus', 'bridges', 'team', 'sponsor', 'misc'];
const SETTINGS_FALLBACK = {
  badges: { size: 'std', w_mm: 90, h_mm: 55, sponsor_strip: false },
  certs: { signature_line: true, signer_name: 'Alen Juginović, MD', signer_title: 'President' },
  print: { banner_size: '100x200' }
};

let D = null, st = null, rootEl = null, unbind = null;

async function load() {
  const r = await api.settle({
    printCtx: api.get('/api/admin/print/context?event=conference'),
    certSummary: api.get('/api/v2/studio/certificates/summary'),
    cards: api.get('/api/v2/studio/attendance-cards'),
    library: api.get('/api/v2/studio/library'),
    settings: api.get('/api/v2/studio/settings')
  });
  return {
    errors: r.$errors,
    printCtx: r.printCtx || null,
    certSummary: r.certSummary || { total: 0, by_type: [], recent: [] },
    cards: (r.cards && r.cards.cards) || [],
    photos: (r.library && r.library.photos) || [],
    settings: Object.assign(JSON.parse(JSON.stringify(SETTINGS_FALLBACK)), (r.settings && r.settings.settings) || {})
  };
}
const events = () => (D.printCtx && D.printCtx.events) || [{ key: 'conference', name: 'Plexus Conference' }, { key: 'gala', name: 'Gala Evening' }];
const setFor = tool => D.settings[tool === 'badges' ? 'badges' : tool === 'certs' ? 'certs' : 'print'] || SETTINGS_FALLBACK[tool];
const sponsorCount = () => D.photos.filter(p => p.tag === 'sponsor').length;
const photoAbsUrl = p => /^https?:\/\//i.test(p.url) ? p.url : (window.location.origin + p.url);
const photoSrc = p => /^https?:\/\//i.test(p.url) ? p.url : api.url(p.url);
const fmtBytes = b => { const n = Number(b) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };

// ---------------------------------------------------------------- blocks
function toolCard(key, extraCta = '') {
  const t = COPY.tools[key];
  const cta = key === 'planner'
    ? `<span style="display:flex;flex-direction:column;gap:6px"><span style="display:flex;gap:12px;flex-wrap:wrap"><a href="${PLANNER_URL}" target="_blank" rel="noopener" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22">${t.cta}</a><a href="/gala" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459" data-hover="color:#9b1b22">${t.cta2}</a></span><span style="font-size:10.5px;color:#9a9086;font-style:italic">${t.note}</span></span>`
    : `<span data-act="tool" data-key="${key}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer">${t.cta}</span>`;
  return `
      <div style="border:1px solid rgba(32,27,22,.14);${st.tool === key ? 'border-top:2px solid #9b1b22;' : ''}background:#fff;padding:18px;display:flex;flex-direction:column;gap:7px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:${t.tagColor}">${t.tag}</span>
        <span style="font-family:Fraunces,serif;font-size:18px">${t.name}</span>
        <span style="font-size:12px;color:#6d6459;line-height:1.55;flex:1">${t.why}</span>
        ${cta}${extraCta}
      </div>`;
}
function blockTools() {
  return `
    <!-- dc: Admin Studio.dc.html › "Tool cards" -->
    <div data-block="tools" class="mx-grid-3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
      ${toolCard('badges')}${toolCard('certs')}${toolCard('print')}${toolCard('social')}${toolCard('signup')}${toolCard('planner')}
    </div>
    <!-- /dc -->`;
}
function eventSelect(role) {
  return `<select data-role="${role}" aria-label="Event" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">${events().map(e => `<option value="${esc(e.key)}"${st.event === e.key ? ' selected' : ''}>${esc(e.name || e.key)}</option>`).join('')}</select>`;
}
function previewFrame() {
  if (st.previewBusy) return `<div data-role="preview" style="padding:26px;text-align:center;font-size:12.5px;color:#6d6459;font-style:italic">Building the preview from the live list…</div>`;
  if (!st.previewHtml) return `<div data-role="preview"></div>`;
  return `<div data-role="preview" style="border-top:1px solid rgba(32,27,22,.1);background:#efe9dc;padding:14px"><iframe data-role="previewFrame" title="Print preview" sandbox="" style="width:100%;height:520px;border:1px solid rgba(32,27,22,.2);background:#fff;display:block"></iframe></div>`;
}
const settingsToggleBtn = tool => `<span data-act="settingsToggle" data-tool="${tool}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:${st.setOpen[tool] ? '#201b16' : '#6d6459'};cursor:pointer" data-hover="color:#201b16">${st.setOpen[tool] ? COPY.settings.close : COPY.settings.open}</span>`;
const setLabel = t => `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${t}</span>`;
const setInput = (role, val, w, ph) => `<input data-role="${role}" value="${esc(val)}"${ph ? ` placeholder="${esc(ph)}"` : ''} style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;width:${w}px">`;
const saveBtn = tool => `<span data-act="saveSettings" data-tool="${tool}" style="padding:8px 13px;background:#201b16;color:#f6f2ea;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;align-self:flex-end" data-hover="background:#000">${COPY.settings.save}</span>`;

// the persisted SETTINGS strip inside a tool drawer — the generate buttons READ what is saved here
function settingsStrip(tool) {
  if (!st.setOpen[tool]) return '';
  const s = setFor(tool);
  if (tool === 'badges') {
    const n = sponsorCount();
    return `
        <div data-block="settings" data-v2="v2_studio_settings › badges (read by /api/v2/studio/badges/*)" style="display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;padding:12px 20px;background:#f6f2ea;border-top:1px solid rgba(32,27,22,.1);border-bottom:1px solid rgba(32,27,22,.1)">
          <label style="display:flex;flex-direction:column;gap:4px">${setLabel(COPY.settings.badgeSize)}
            <select data-role="bSize" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">${COPY.settings.badgeSizes.map(([k, l]) => `<option value="${k}"${s.size === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <span data-role="bCustom" style="display:${s.size === 'custom' ? 'flex' : 'none'};gap:8px;align-items:flex-end">
            <label style="display:flex;flex-direction:column;gap:4px">${setLabel('W · MM')}${setInput('bW', s.w_mm, 64)}</label>
            <label style="display:flex;flex-direction:column;gap:4px">${setLabel('H · MM')}${setInput('bH', s.h_mm, 64)}</label>
          </span>
          <label style="display:flex;flex-direction:column;gap:4px">${setLabel(COPY.settings.sponsorStrip)}
            <span style="display:flex;gap:8px;align-items:center;padding:8px 0"><input data-role="bSponsor" type="checkbox"${s.sponsor_strip ? ' checked' : ''}><span style="font-size:11.5px;color:#6d6459">${esc(COPY.settings.sponsorWhy(n))}</span></span></label>
          ${saveBtn('badges')}
        </div>`;
  }
  if (tool === 'certs') {
    return `
        <div data-block="settings" data-v2="v2_studio_settings › certs (read server-side by certificates/preview)" style="display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;padding:12px 20px;background:#f6f2ea;border-top:1px solid rgba(32,27,22,.1);border-bottom:1px solid rgba(32,27,22,.1)">
          <label style="display:flex;flex-direction:column;gap:4px">${setLabel(COPY.settings.sigLine)}
            <span style="display:flex;gap:8px;align-items:center;padding:8px 0"><input data-role="cSig" type="checkbox"${s.signature_line ? ' checked' : ''}><span style="font-size:11.5px;color:#6d6459">signer + organising team under the award line</span></span></label>
          <label style="display:flex;flex-direction:column;gap:4px">${setLabel(COPY.settings.signer)}${setInput('cName', s.signer_name, 190)}</label>
          <label style="display:flex;flex-direction:column;gap:4px">${setLabel(COPY.settings.signerTitle)}${setInput('cTitle', s.signer_title, 150)}</label>
          ${saveBtn('certs')}
        </div>`;
  }
  return `
        <div data-block="settings" data-v2="v2_studio_settings › print (rides the engine's own size field)" style="display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;padding:12px 20px;background:#f6f2ea;border-top:1px solid rgba(32,27,22,.1);border-bottom:1px solid rgba(32,27,22,.1)">
          <label style="display:flex;flex-direction:column;gap:4px">${setLabel(COPY.settings.bannerSize)}
            <select data-role="pBanner" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">${COPY.settings.bannerSizes.map(([k, l]) => `<option value="${k}"${s.banner_size === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <span style="font-size:11.5px;color:#6d6459;max-width:340px;line-height:1.5;padding-bottom:6px">${COPY.settings.printFixed}</span>
          ${saveBtn('print')}
        </div>`;
}
function socialBgRow() {
  const photos = D.photos.slice(0, 8);
  const sel = k => st.scBg === k;
  return `
          <div style="display:flex;flex-direction:column;gap:7px">
            <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${COPY.social.bg}</span>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${Object.keys(SOCIAL_BGS).map(k => `<span data-act="scBg" data-bg="${k}" title="${COPY.social.bgNames[k]}" style="width:34px;height:34px;background:${SOCIAL_BGS[k].fill};border:2px solid ${sel(k) ? '#9b1b22' : 'rgba(32,27,22,.18)'};cursor:pointer;display:flex;align-items:center;justify-content:center"><span style="width:12px;height:2px;background:${SOCIAL_BGS[k].rule}"></span></span>`).join('')}
              ${photos.map(p => `<span data-act="scBgPhoto" data-url="${esc(p.url)}" title="${esc(p.name)}" style="width:34px;height:34px;border:2px solid ${st.scBg === 'photo:' + p.url ? '#9b1b22' : 'rgba(32,27,22,.18)'};cursor:pointer;overflow:hidden;flex:none"><img src="${esc(photoSrc(p))}" alt="${esc(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.parentNode.style.display='none'"></span>`).join('')}
            </div>
            <span style="font-size:10.5px;color:#9a9086">${photos.length ? COPY.social.bgPhotos : COPY.social.bgNoPhotos}</span>
          </div>`;
}
function socialPreviewTile() {
  const isPhoto = st.scBg.startsWith('photo:');
  const c = isPhoto ? { head: '#f7f1e6', sub: 'rgba(247,241,230,.72)', rule: '#c9a962', brand: '#c9a962' } : SOCIAL_BGS[st.scBg] || SOCIAL_BGS.ink;
  const bgCss = isPhoto
    ? `background:linear-gradient(rgba(21,17,15,.30),rgba(21,17,15,.82)),url('${esc(st.scBg.slice(6).startsWith('/') ? api.url(st.scBg.slice(6)) : st.scBg.slice(6))}') center/cover no-repeat #191512;`
    : `background:${c.fill};`;
  return `
          <div data-role="scPrev" style="width:220px;height:220px;${bgCss}flex:none;display:flex;flex-direction:column;justify-content:flex-end;padding:18px;box-sizing:border-box;gap:6px">
            <span style="width:26px;height:2px;background:${c.rule}"></span>
            <span data-role="scHeadPrev" style="font-family:Fraunces,serif;font-size:17px;line-height:1.2;color:${c.head}">${esc(st.scHead.trim() || COPY.social.headPrev)}</span>
            <span data-role="scSubPrev" style="font-size:10px;color:${c.sub}">${esc(st.scSub.trim() || COPY.social.subPrev)}</span>
            <span style="font:600 7px Inter,sans-serif;letter-spacing:.28em;color:${c.brand};margin-top:4px">MED&amp;X</span>
          </div>`;
}
const FORM_KIND_STYLE = { PUBLIC: ['#eee9df', '#4a4239'], VIP: ['#f1e7d4', '#7a6432'], DIASPORA: ['#e8eef7', '#2c4a73'] };
function formLinksBody() {
  if (st.formLinksBusy) return `<div style="padding:24px 20px;font-size:12.5px;color:#6d6459;font-style:italic">${COPY.forms.busy}</div>`;
  const list = st.formLinks || [];
  return `
        <div data-v2="FORM LINKS panel (team review — Miro: the tile routed blind to /links); lists via the /links GET routes" style="display:flex;flex-direction:column">
          <div style="padding:10px 20px;font-size:11.5px;color:#6d6459;border-bottom:1px solid rgba(32,27,22,.08)">${COPY.forms.sub}</div>
          ${list.map(l => `
          <div style="display:flex;align-items:center;gap:10px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.07);flex-wrap:wrap">
            <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;background:${(FORM_KIND_STYLE[l.kind] || FORM_KIND_STYLE.PUBLIC)[0]};color:${(FORM_KIND_STYLE[l.kind] || FORM_KIND_STYLE.PUBLIC)[1]};white-space:nowrap">${esc(l.kind)}</span>
            <span style="font-size:12.5px;font-weight:600;min-width:140px;flex:1">${esc(l.name)}</span>
            <span style="font-size:11px;color:#6d6459;white-space:nowrap">${esc(COPY.forms.uses(l.uses))}${l.paused ? ` · ${COPY.forms.paused}` : ''}${l.expired && !l.paused ? ` · ${COPY.forms.expired}` : ''}</span>
            <span style="font:600 11px ui-monospace,monospace;background:#f6f2ea;border:1px solid rgba(32,27,22,.14);padding:6px 9px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${l.paused ? '#9a9086' : '#201b16'}" title="${esc(l.url)}">${esc(l.url.replace(/^https?:\/\//, ''))}</span>
            <span data-act="formCopy" data-url="${esc(l.url)}" style="padding:6px 11px;background:#9b1b22;color:#fff;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.forms.copy}</span>
          </div>`).join('')}
          ${!list.length ? `<div class="empty" style="padding:26px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.forms.empty}</span><span class="empty-why">${COPY.forms.emptyWhy}</span></div>` : ''}
          <div style="display:flex;align-items:center;gap:12px;padding:13px 20px">
            <a href="/links?new=1" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em" data-hover="background:#7e151b">${COPY.forms.newLink}</a>
            <span style="font-size:11px;color:#6d6459">${COPY.forms.newWhy}</span>
          </div>
        </div>`;
}
function drawerBody() {
  const c = (D.printCtx && D.printCtx.counts) || { total: 0, withQr: 0 };
  if (st.tool === 'badges') {
    const bs = setFor('badges');
    return `${settingsStrip('badges')}
        <div style="padding:14px 20px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          ${eventSelect('badgeEvent')}
          <span data-act="genBadges" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${COPY.badges.gen}</span>
          <span data-act="pdfRender" data-kind="badges-sheet" style="padding:9px 15px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="border-color:#201b16">${COPY.badges.pdf}</span>
          <span style="font-size:11.5px;color:#6d6459">${esc(COPY.badges.note(bs, bs.sponsor_strip))} · ${esc(COPY.badges.counts(c))}</span>
        </div>${previewFrame()}`;
  }
  if (st.tool === 'certs') {
    const total = Number(D.certSummary.total) || 0;
    const cs = setFor('certs');
    return `${settingsStrip('certs')}
        <div style="padding:14px 20px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select data-role="certType" aria-label="Certificate type" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">${COPY.certs.types.map(([k, l]) => `<option value="${k}"${st.certType === k ? ' selected' : ''}>${esc(l)} — Plexus 2026</option>`).join('')}</select>
          <span data-act="genCert" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${COPY.certs.gen}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.certs.note} · ${esc(COPY.certs.issued(total))}${cs.signature_line ? ` · signed ${esc(cs.signer_name)}` : ' · no signature line'}</span>
        </div>${previewFrame()}`;
  }
  if (st.tool === 'print') {
    const ps = setFor('print');
    return `${settingsStrip('print')}
        <div style="padding:14px 20px 18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${COPY.print.kinds.map(([k, l]) => `<span data-act="printKind" data-key="${k}" style="padding:8px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;background:${st.printKind === k ? '#201b16' : 'transparent'};color:${st.printKind === k ? '#f6f2ea' : '#6d6459'};border:1px solid ${st.printKind === k ? '#201b16' : 'rgba(32,27,22,.25)'}">${l}</span>`).join('')}
          ${eventSelect('printEvent')}
          <span data-act="genPrint" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${COPY.print.gen}</span>
          <span data-act="pdfRender" data-kind="${esc(st.printKind)}" style="padding:9px 15px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="border-color:#201b16">${COPY.print.pdf}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.print.note}${st.printKind === 'banner' ? ` · ${esc((COPY.settings.bannerSizes.find(([k]) => k === ps.banner_size) || [])[1] || ps.banner_size)}` : ''}</span>
        </div>${previewFrame()}`;
  }
  if (st.tool === 'signup') return formLinksBody();
  // social
  const cards = D.cards;
  const cardImg = p => (cfg.memberBase ? cfg.memberBase : cfg.memberPortalUrl) + p;
  return `
        <div style="padding:16px 20px 20px;display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:9px;flex:1;min-width:240px">
            <input data-role="scHead" value="${esc(st.scHead)}" placeholder="${esc(COPY.social.headPh)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
            <input data-role="scSub" value="${esc(st.scSub)}" placeholder="${esc(COPY.social.subPh)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
            ${socialBgRow()}
            <span data-act="dlSocial" style="padding:10px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;align-self:flex-start" data-hover="background:#7e151b">${COPY.social.dl}</span>
            <div data-v2="live member share cards (v2_attendance_cards)" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
              <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.social.recent}</span>
              ${cards.length ? `
              <div class="mx-st-cards" style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">
                ${cards.slice(0, 6).map(cd => `<a href="${esc(cardImg(cd.image_path))}" target="_blank" rel="noopener" title="${esc(cd.event_name || cd.kind)} · ${esc(cd.email_to || '')}" style="flex:none"><img src="${esc(cardImg(cd.image_path))}" alt="${esc(cd.event_name || 'attendance card')}" loading="lazy" style="width:150px;height:79px;object-fit:cover;border:1px solid rgba(32,27,22,.18);display:block" onerror="this.parentNode.style.display='none'"></a>`).join('')}
              </div>
              <span style="font-size:11px;color:#6d6459">${COPY.social.recentWhy}</span>` : `<span style="font-size:11.5px;color:#6d6459;font-style:italic">${COPY.social.recentNone}</span>`}
            </div>
          </div>
          ${socialPreviewTile()}
        </div>`;
}
function blockDrawer() {
  if (!st.tool) return `<!-- dc: Admin Studio.dc.html › "Tool drawer" --><div data-block="drawer"></div><!-- /dc -->`;
  const hasSettings = ['badges', 'certs', 'print'].includes(st.tool);
  return `
    <!-- dc: Admin Studio.dc.html › "Tool drawer" -->
    <div data-block="drawer" id="drawer" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff">
      <div style="display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.titles[st.tool] || ''}</span>
        <div style="flex:1"></div>
        ${hasSettings ? settingsToggleBtn(st.tool) : ''}
        <span data-act="toolClose" style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${COPY.close}</span>
      </div>
      ${drawerBody()}
    </div>
    <!-- /dc -->`;
}
function blockBrand() {
  return `
    <!-- dc: Admin Studio.dc.html › "BRAND ASSETS" -->
    <div id="brand" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.brand.title}</span><span style="font-size:11.5px;color:#6d6459">${COPY.brand.sub}</span></div>
      <div class="mx-grid-3" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0">
        <div style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.08)">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459;margin-bottom:10px">${COPY.brand.logos}</div>
          <div style="display:flex;gap:10px;align-items:stretch">
            <span style="flex:1;border:1px solid rgba(32,27,22,.12);background:#fff;display:flex;align-items:center;justify-content:center;padding:14px"><img src="/assets/logo.png" alt="Med&amp;X logo" style="height:22px"></span>
            <span style="flex:1;background:#191512;display:flex;align-items:center;justify-content:center;padding:14px"><img src="/assets/logo-white.png" alt="Med&amp;X logo, white" style="height:22px"></span>
          </div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px">
            <a href="/assets/logo.png" download="medx-logo.png" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22">${COPY.brand.dl}</a>
            <a href="/assets/logo-white.png" download="medx-logo-white.png" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22">${COPY.brand.dlWhite}</a>
            <a href="/assets/mark-x.png" download="medx-mark.png" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22">${COPY.brand.dlMark}</a>
          </div>
        </div>
        <div style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.08)">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459;margin-bottom:10px">${COPY.brand.colours}</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${COLOURS.map(([hex, name]) => `<span data-act="copyHex" data-hex="${hex}" title="Click to copy" style="display:flex;align-items:center;gap:10px;cursor:pointer"><span style="width:22px;height:22px;background:${hex};${hex === '#F7F1E6' ? 'border:1px solid rgba(32,27,22,.15);' : ''}flex:none"></span><span style="font:600 11px ui-monospace,monospace">${hex}</span><span style="font-size:11px;color:#6d6459">${esc(name)}</span></span>`).join('')}
          </div>
        </div>
        <div style="padding:16px 20px">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459;margin-bottom:10px">${COPY.brand.type}</div>
          <div style="font-family:Fraunces,serif;font-size:21px;line-height:1.2">Fraunces</div>
          <div style="font-size:11px;color:#6d6459;margin-bottom:8px">headlines &amp; numbers</div>
          <div style="font:600 15px Inter,sans-serif">Inter</div>
          <div style="font-size:11px;color:#6d6459">everything else</div>
        </div>
      </div>
    </div>
    <!-- /dc -->`;
}
// -------- PHOTO LIBRARY (team review C — Laura's "build before December" pick) --------
function libFiltered() {
  const needle = st.libQ.trim().toLowerCase();
  return D.photos.filter(p => (st.libTag === 'all' || p.tag === st.libTag) && (!needle || String(p.name).toLowerCase().includes(needle)));
}
function libGrid() {
  const list = libFiltered();
  return `<div data-block="libGrid">
      ${list.length ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:12px;padding:14px 20px 18px">
        ${list.map(p => `
        <div style="border:1px solid rgba(32,27,22,.12);background:#fff;display:flex;flex-direction:column">
          <span style="height:92px;background:#efe9dc;overflow:hidden;display:block"><img src="${esc(photoSrc(p))}" alt="${esc(p.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none'"></span>
          <div style="padding:8px 10px;display:flex;flex-direction:column;gap:5px">
            <span style="font-size:11.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.name)}">${esc(p.name)}</span>
            <span style="font-size:10px;color:#9a9086;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(fmtBytes(p.bytes))}${p.px_w ? ` · ${p.px_w}×${p.px_h}` : ''} ${esc(COPY.library.by(p.uploaded_by_name))}</span>
            <select data-role="libTagSel" data-id="${esc(p.id)}" aria-label="Tag" style="border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:4px 6px;font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#4a4239">${LIB_TAGS.map(t => `<option value="${t}"${p.tag === t ? ' selected' : ''}>${t.toUpperCase()}</option>`).join('')}</select>
            <span style="display:flex;gap:10px;align-items:center">
              <span data-act="libCopy" data-url="${esc(photoAbsUrl(p))}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9b1b22;cursor:pointer">${COPY.library.copyUrl}</span>
              <span data-act="libDel" data-id="${esc(p.id)}" data-name="${esc(p.name)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;cursor:pointer" data-hover="color:#9b1b22">${COPY.library.del}</span>
            </span>
          </div>
        </div>`).join('')}
      </div>` : `<div class="empty" style="padding:28px 20px 30px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.library.empty}</span><span class="empty-why">${COPY.library.emptyWhy}</span></div>`}
    </div>`;
}
function blockLibrary() {
  const counts = { all: D.photos.length };
  LIB_TAGS.forEach(t => { counts[t] = D.photos.filter(p => p.tag === t).length; });
  const chip = (key, label) => `<span data-act="libTag" data-tag="${key}" style="padding:5px 10px;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;background:${st.libTag === key ? '#201b16' : 'transparent'};color:${st.libTag === key ? '#f6f2ea' : '#6d6459'};border:1px solid ${st.libTag === key ? '#201b16' : 'rgba(32,27,22,.2)'};white-space:nowrap">${label}${counts[key] ? ` · ${counts[key]}` : ''}</span>`;
  return `
    <!-- v2: PHOTO LIBRARY (team review Aug 2026 §C — Laura; table v2_studio_assets) -->
    <div data-block="library" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.library.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${COPY.library.sub}</span>
        <div style="flex:1"></div>
        <input data-role="libQ" value="${esc(st.libQ)}" placeholder="${esc(COPY.library.searchPh)}" aria-label="Search photos" style="border:1px solid rgba(32,27,22,.22);background:#f6f2ea;padding:7px 10px;font:400 12px Inter,sans-serif;color:#201b16;width:170px">
        <label style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${st.libBusy ? COPY.library.uploading : COPY.library.upload}<input data-role="libFile" type="file" accept="image/jpeg,image/png,image/webp" style="display:none"></label>
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;padding:11px 20px 0">${chip('all', COPY.library.all)}${LIB_TAGS.map(t => chip(t, t.toUpperCase())).join('')}</div>
      ${libGrid()}
    </div>
    <!-- /v2 -->`;
}
// UX AUDIT 2026-09-02 #15 — "STORED FILES" is DELETED. It was an empty box whose own body text
// sent the reader to Settings → Team library, so it occupied the bottom of the Studio without
// doing work. The team library keeps the files; the Studio keeps what it makes. The PHOTO LIBRARY
// above is the Studio's own store and is untouched.
function template() {
  return `
<div data-screen-label="Admin Studio" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:24px">
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
      <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
      <div style="flex:1"></div>
      <a id="merch" href="${esc(cfg.memberPortalUrl || 'https://medx.hr')}/shop" target="_blank" rel="noopener" data-v2="merch — one link deep (README R.8)" title="${esc(COPY.merch.note)}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459" data-hover="color:#9b1b22">${COPY.merch.open}</a>
    </div>
    ${blockTools()}
    ${blockDrawer()}
    ${blockBrand()}
    ${blockLibrary()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function paint(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; wireInputs(); fillFrame(); }
function fillFrame() {
  const f = rootEl && rootEl.querySelector('[data-role="previewFrame"]');
  if (f && st.previewHtml) f.setAttribute('srcdoc', st.previewHtml);
}
function openDrawer(tool) {
  st.tool = tool; st.previewHtml = null; st.previewBusy = false;
  const needLinks = tool === 'signup' && !st.formLinks && !st.formLinksBusy;
  if (needLinks) st.formLinksBusy = true;
  paint('[data-block="tools"]', blockTools());
  paint('[data-block="drawer"]', blockDrawer());
  const d = rootEl.querySelector('#drawer');
  if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (needLinks) loadFormLinks();
}
// the FORM LINKS panel reuses the SAME list routes the /links view reads (js/views/links.js)
async function loadFormLinks() {
  const r = await api.settle({
    reg: api.get('/api/admin/registration-links'),
    gala: api.get('/api/admin/gala/invite-links'),
    ca: api.get('/api/admin/croatians-abroad/invite-links')
  });
  if (!st) return;   // the view was destroyed while the lists were in flight
  const links = [];
  (Array.isArray(r.reg) ? r.reg : []).forEach(l => links.push({
    kind: l.link_type === 'vip' ? 'VIP' : 'PUBLIC', name: l.label || (l.event_name ? l.event_name + ' — link' : 'Invitation link'),
    url: l.url || '', uses: Number(l.uses) || 0, paused: Number(l.is_active) === 0,
    expired: !!(l.expires_at && new Date(l.expires_at) < new Date()), created: l.created_at
  }));
  (Array.isArray(r.gala) ? r.gala : []).forEach(l => links.push({
    kind: l.link_type === 'vip' ? 'VIP' : 'PUBLIC', name: l.label || 'Gala Evening — invite link',
    url: l.url || '', uses: Number(l.used_count) || 0, paused: Number(l.revoked) === 1,
    expired: !!(l.expires_at && new Date(l.expires_at) < new Date()), created: l.created_at
  }));
  (Array.isArray(r.ca) ? r.ca : []).forEach(l => links.push({
    kind: 'DIASPORA', name: l.label || 'Diaspora — invite link',
    url: l.url || '', uses: Number(l.used_count) || 0, paused: Number(l.revoked) === 1,
    expired: !!(l.expires_at && new Date(l.expires_at) < new Date()), created: l.created_at
  }));
  links.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  st.formLinks = links;
  st.formLinksBusy = false;
  if (st.tool === 'signup') paint('[data-block="drawer"]', blockDrawer());
}
async function buildPreview(makeCall) {
  st.previewBusy = true; st.previewHtml = null;
  paint('[data-block="drawer"]', blockDrawer());
  try {
    const r = await makeCall();
    st.previewHtml = (r && r.html) || null;
    st.previewBusy = false;
    paint('[data-block="drawer"]', blockDrawer());
  } catch (e) {
    st.previewBusy = false;
    paint('[data-block="drawer"]', blockDrawer());
    ui.toast(e.message, { kind: 'error' });
  }
}
const bannerSize = () => (D.settings.print && D.settings.print.banner_size) || '100x200';
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';                     // same-origin unaffected; Cloudinary sends ACAO:*
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(COPY.social.imgFail));
    img.src = src;
  });
}
async function uploadLibraryPhoto(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { ui.toast(COPY.library.badType, { kind: 'error' }); return; }
  if (file.size > 8 * 1024 * 1024) { ui.toast(COPY.library.tooBig, { kind: 'error' }); return; }
  st.libBusy = true;
  paint('[data-block="library"]', blockLibrary());
  try {
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('tag', st.libTag !== 'all' ? st.libTag : 'misc');   // uploading inside a tag filter files it there
    const r = await api.post('/api/v2/studio/library', fd);
    if (!st) return;   // destroyed mid-upload
    if (r && r.photo) D.photos.unshift(r.photo);
    ui.toast(COPY.library.uploaded);
  } catch (e) { if (!st) return; ui.toast(e.message, { kind: 'error' }); }
  st.libBusy = false;
  paint('[data-block="library"]', blockLibrary());
  if (st.tool === 'social') paint('[data-block="drawer"]', blockDrawer());   // the bg picker shows library photos
}
function wireInputs() {
  const head = rootEl.querySelector('[data-role="scHead"]');
  const sub = rootEl.querySelector('[data-role="scSub"]');
  const wire = (el, key, prevRole, fb) => {
    if (!el || el._wired) return;
    el._wired = true;
    el.addEventListener('input', e => {
      st[key] = e.target.value;
      const p = rootEl.querySelector(`[data-role="${prevRole}"]`);
      if (p) p.textContent = e.target.value.trim() || fb;
    });
  };
  wire(head, 'scHead', 'scHeadPrev', COPY.social.headPrev);
  wire(sub, 'scSub', 'scSubPrev', COPY.social.subPrev);
  ['badgeEvent', 'printEvent'].forEach(role => {
    const s = rootEl.querySelector(`[data-role="${role}"]`);
    if (s && !s._wired) { s._wired = true; s.addEventListener('change', e => { st.event = e.target.value; }); }
  });
  const ct = rootEl.querySelector('[data-role="certType"]');
  if (ct && !ct._wired) { ct._wired = true; ct.addEventListener('change', e => { st.certType = e.target.value; }); }
  // settings strip: the custom-mm inputs show only while BADGE SIZE = CUSTOM
  const bs = rootEl.querySelector('[data-role="bSize"]');
  if (bs && !bs._wired) {
    bs._wired = true;
    bs.addEventListener('change', e => { const c = rootEl.querySelector('[data-role="bCustom"]'); if (c) c.style.display = e.target.value === 'custom' ? 'flex' : 'none'; });
  }
  // photo library: search + upload + per-photo retag
  const lq = rootEl.querySelector('[data-role="libQ"]');
  if (lq && !lq._wired) {
    lq._wired = true;
    lq.addEventListener('input', e => { st.libQ = e.target.value; paint('[data-block="libGrid"]', libGrid()); });
  }
  const lf = rootEl.querySelector('[data-role="libFile"]');
  if (lf && !lf._wired) {
    lf._wired = true;
    lf.addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) await uploadLibraryPhoto(f);
    });
  }
  rootEl.querySelectorAll('[data-role="libTagSel"]').forEach(sel => {
    if (sel._wired) return;
    sel._wired = true;
    sel.addEventListener('change', async e => {
      const id = sel.dataset.id;
      try {
        const r = await api.patch('/api/v2/studio/library/' + encodeURIComponent(id), { tag: e.target.value });
        const i = D.photos.findIndex(p => p.id === id);
        if (i >= 0 && r && r.photo) D.photos[i] = r.photo;
        paint('[data-block="library"]', blockLibrary());
      } catch (err) { ui.toast(err.message, { kind: 'error' }); }
    });
  });
}

async function copyText(text, doneMsg) {
  try { await navigator.clipboard.writeText(text); } catch (e) {
    try { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    catch (e2) { ui.toast('COPY BLOCKED BY THE BROWSER — SELECT AND COPY IT BY HAND', { kind: 'error' }); return; }
  }
  ui.toast(doneMsg);
}

const handlers = {
  tool: (el) => openDrawer(el.dataset.key),
  toolClose: () => { st.tool = null; st.previewHtml = null; paint('[data-block="tools"]', blockTools()); paint('[data-block="drawer"]', blockDrawer()); },
  printKind: (el) => { st.printKind = el.dataset.key; paint('[data-block="drawer"]', blockDrawer()); },
  settingsToggle: (el) => { const t = el.dataset.tool; st.setOpen[t] = !st.setOpen[t]; paint('[data-block="drawer"]', blockDrawer()); },
  saveSettings: async (el) => {
    const tool = el.dataset.tool;
    const v = role => { const n = rootEl.querySelector(`[data-role="${role}"]`); return n ? n.value : ''; };
    const chk = role => { const n = rootEl.querySelector(`[data-role="${role}"]`); return n ? !!n.checked : false; };
    const body = tool === 'badges'
      ? { badges: { size: v('bSize'), w_mm: v('bW'), h_mm: v('bH'), sponsor_strip: chk('bSponsor') } }
      : tool === 'certs'
        ? { certs: { signature_line: chk('cSig'), signer_name: v('cName'), signer_title: v('cTitle') } }
        : { print: { banner_size: v('pBanner') } };
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.put('/api/v2/studio/settings', body);
      if (r && r.settings) D.settings = r.settings;
      ui.toast(COPY.settings.saved);
      paint('[data-block="drawer"]', blockDrawer());
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // badges build server-side at the CONFIGURED trim — /api/v2/studio/badges/* reads v2_studio_settings
  genBadges: () => buildPreview(() => api.post('/api/v2/studio/badges/preview', { event: st.event })),
  genPrint: () => buildPreview(() => api.post('/api/admin/print/preview', Object.assign({ kind: st.printKind, event: st.event, fields: {} }, st.printKind === 'banner' ? { size: bannerSize() } : {}))),
  genCert: () => buildPreview(() => api.post('/api/v2/studio/certificates/preview', { type: st.certType })),
  pdfRender: async (el) => {
    const kind = el.dataset.kind;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = kind === 'badges-sheet'
        ? await api.post('/api/v2/studio/badges/render', { event: st.event })
        : await api.post('/api/admin/print/render', Object.assign({ kind, event: st.event, fields: {} }, kind === 'banner' ? { size: bannerSize() } : {}));
      if (r && r.url) { window.open(r.url, '_blank', 'noopener'); ui.toast('PRINT-READY PDF SAVED TO THE STUDIO ASSETS'); }
      el.removeAttribute('aria-disabled');
    } catch (e) {
      el.removeAttribute('aria-disabled');
      ui.toast(e.status === 503 ? COPY.engineDown : e.message, { kind: 'error', ms: 5200 });
    }
  },
  scBg: (el) => { st.scBg = el.dataset.bg; paint('[data-block="drawer"]', blockDrawer()); },
  scBgPhoto: (el) => { st.scBg = 'photo:' + el.dataset.url; paint('[data-block="drawer"]', blockDrawer()); },
  dlSocial: async () => {
    // the artboard's 1080×1080 renderer — ground per the picked background, gold rule, wrapped headline
    const isPhoto = st.scBg.startsWith('photo:');
    const pal = isPhoto ? { head: '#f7f1e6', sub: 'rgba(247,241,230,.72)', rule: '#c9a962', brand: '#c9a962' } : SOCIAL_BGS[st.scBg] || SOCIAL_BGS.ink;
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
    const x = c.getContext('2d');
    if (isPhoto) {
      x.fillStyle = '#191512'; x.fillRect(0, 0, 1080, 1080);
      try {
        const u = st.scBg.slice(6);
        const img = await loadImage(u.startsWith('/') ? api.url(u) : u);
        const s = Math.max(1080 / img.naturalWidth, 1080 / img.naturalHeight);
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        x.drawImage(img, (1080 - w) / 2, (1080 - h) / 2, w, h);
        const grad = x.createLinearGradient(0, 0, 0, 1080);      // dark scrim keeps the type legible
        grad.addColorStop(0, 'rgba(21,17,15,.30)'); grad.addColorStop(1, 'rgba(21,17,15,.82)');
        x.fillStyle = grad; x.fillRect(0, 0, 1080, 1080);
      } catch (e) { ui.toast(e.message, { kind: 'error' }); return; }
    } else {
      x.fillStyle = pal.fill; x.fillRect(0, 0, 1080, 1080);
    }
    x.fillStyle = pal.rule; x.fillRect(90, 760, 120, 8);
    x.fillStyle = pal.head; x.font = '600 74px Georgia, serif';
    const head = (st.scHead.trim() || COPY.social.headPrev);
    const words = head.split(' '); let line = ''; const y = 860; const lines = [];
    words.forEach(w => { if (x.measureText(line + ' ' + w).width > 880 && line) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w; });
    lines.push(line); lines.slice(0, 3).forEach((l, i) => x.fillText(l, 90, y + i * 84 - (lines.length - 1) * 84));
    x.fillStyle = pal.sub; x.font = '400 34px Inter, sans-serif';
    x.fillText(st.scSub.trim() || COPY.social.subPrev, 90, y + 70);
    x.fillStyle = pal.brand; x.font = '600 26px Inter, sans-serif';
    x.fillText('M E D & X', 90, 1000);
    let dataUrl;
    try { dataUrl = c.toDataURL('image/png'); }
    catch (e) { ui.toast(COPY.social.taint, { kind: 'error', ms: 5200 }); return; }
    const a = document.createElement('a'); a.href = dataUrl; a.download = 'medx-card.png'; a.click();
    ui.toast(COPY.social.done);
  },
  formCopy: (el) => copyText(el.dataset.url, COPY.forms.copied),
  libTag: (el) => { st.libTag = el.dataset.tag; paint('[data-block="library"]', blockLibrary()); },
  libCopy: (el) => copyText(el.dataset.url, COPY.library.urlCopied),
  libDel: async (el) => {
    const ok = await ui.confirm({ title: COPY.library.delTitle, body: esc(COPY.library.delBody(el.dataset.name || 'photo')), ok: COPY.library.delOk, cancel: COPY.library.delCancel });
    if (!ok) return;
    try {
      await api.del('/api/v2/studio/library/' + encodeURIComponent(el.dataset.id));
      D.photos = D.photos.filter(p => p.id !== el.dataset.id);
      if (st.scBg.startsWith('photo:')) st.scBg = 'ink';
      paint('[data-block="library"]', blockLibrary());
      if (st.tool === 'social') paint('[data-block="drawer"]', blockDrawer());
      ui.toast(COPY.library.removed);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  copyHex: (el) => {
    try { navigator.clipboard.writeText(el.dataset.hex).catch(() => {}); } catch (e) {}
    ui.toast(COPY.brand.copied(el.dataset.hex));
  }
};

export default {
  title: 'Studio',
  async render(root, ctx) {
    rootEl = root;
    if (!document.getElementById('mx-css-studio')) {
      const l = document.createElement('link'); l.id = 'mx-css-studio'; l.rel = 'stylesheet'; l.href = '/css/views/studio.css'; document.head.appendChild(l);
    }
    st = {
      tool: null, event: 'conference', certType: 'attendance', printKind: 'sign',
      scHead: '', scSub: '', scBg: 'ink', previewHtml: null, previewBusy: false,
      setOpen: { badges: false, certs: false, print: false },
      libQ: '', libTag: 'all', libBusy: false,
      formLinks: null, formLinksBusy: false
    };
    D = await load();
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
    const tab = ctx.params.tab;
    if (tab && ['badges', 'certs', 'print', 'social', 'signup'].includes(tab)) openDrawer(tab);
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; }
};
