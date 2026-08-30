// Source: Admin Studio.dc.html — make and store things (README note 23: badges from live guest
// lists, per-person certificates, print suite, social cards, brand kit downloads, stored files).
// Blocks (artboard order): "Tool cards" (Name badges · Certificates · Print suite · Social cards ·
// Sign-up form pages · 3D ballroom planner) › "Tool drawer" (per-tool real content) ›
// "BRAND ASSETS" › "STORED FILES".
// Real wiring: print suite = the existing /api/admin/print/* engine (context + HTML preview always
// work; the print-ready PDF needs headless Chrome on the service and says so when it is missing);
// certificates = the existing certificates table + a brand-true preview (v2 studio module);
// social cards = the artboard's 1080×1080 canvas download + the member portal's live attendance
// cards (v2_attendance_cards, images served member-side); stored files = the existing team_files.
import cfg from '../config.js';
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { perms } from '../perms.js';

export const SOURCE = 'Admin Studio.dc.html';
export const COPY = {
  title: 'The <i>Studio</i>', sub: 'make and store things — everything comes out already in the Med&amp;X look',
  tools: {
    badges: { tag: 'PRINT', tagColor: '#9b1b22', name: 'Name badges', why: 'Pick an event, get a print-ready sheet of badges for everyone registered — updated to the minute.', cta: 'MAKE BADGES →' },
    certs: { tag: 'PRINT', tagColor: '#9b1b22', name: 'Certificates', why: 'CME attendance and speaker thank-yous — generated per person, auto-sent after the week or printed here.', cta: 'MAKE CERTIFICATES →' },
    print: { tag: 'PRINT', tagColor: '#9b1b22', name: 'Print suite', why: 'Signs, roll-up banners and stage backdrops for any event — content flows in, you print the PDF.', cta: 'OPEN PRINT SUITE →' },
    social: { tag: 'SHARE', tagColor: '#b7791f', name: 'Social cards', why: 'Turn any announcement into a square image for Instagram or LinkedIn — headline, date, done.', cta: 'MAKE A CARD →' },
    signup: { tag: 'SHARE', tagColor: '#b7791f', name: 'Sign-up form pages', why: 'Public one-page forms for short events — a link you can put anywhere, replies land in People.', cta: 'NEW FORM PAGE →' },
    planner: { tag: 'EVENT', tagColor: '#2f7d4f', name: '3D ballroom planner', why: 'Arrange Gala tables in the Esplanade ballroom and walk the room before the night.', cta: 'OPEN THE 3D PLANNER ↗', cta2: 'GALA SEATING →' }
  },
  titles: { badges: 'NAME BADGES — LIVE LIST, PRINT-READY', certs: 'CERTIFICATES — PER PERSON', print: 'PRINT SUITE — PICK A TEMPLATE', social: 'SOCIAL CARD — TYPE, PREVIEW, DOWNLOAD' },
  close: '✕ CLOSE',
  badges: {
    gen: 'PREVIEW THE SHEET', pdf: 'DOWNLOAD PRINT PDF',
    note: 'A6 badges, 8 per A4 — name, institution, QR · always the live list, never stale.',
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
    recent: 'FRESH FROM THE MEMBER PORTAL', recentWhy: 'attendance cards the system generated from real registrations — auto-emailed to each guest',
    recentNone: 'No member cards yet — they generate themselves on registration.'
  },
  brand: {
    title: 'BRAND ASSETS', sub: 'the official kit — always grab it from here so nothing drifts',
    logos: 'LOGOS', dl: 'DOWNLOAD THE LOGO · PNG →', dlWhite: 'WHITE · PNG →', dlMark: 'THE MARK · PNG →',
    colours: 'COLOURS', type: 'TYPE',
    copied: h => h + ' COPIED'
  },
  stored: { title: 'STORED FILES', upload: '+ UPLOAD', open: 'OPEN', uploaded: 'STORED — THE WHOLE TEAM SEES IT', tooBig: 'FILES UP TO 5MB ONLY — LARGER ONES BELONG ON SHAREPOINT', empty: 'Nothing stored yet.', emptyWhy: 'Sponsor decks, floor plans, photo archives — drop them here once, find them forever.' },
  merch: { note: 'Merch studio — its own tool, one link deep, unchanged', open: 'MERCH →' },
  engineDown: 'The print engine (headless Chrome) is off on this machine — the on-screen preview is exact; the print-ready PDF renders on the staging service.'
};

const PLANNER_URL = 'https://plexus-tables.netlify.app/planner.html';
const COLOURS = [['#9B1B22', 'Med&X red'], ['#C9A962', 'gold'], ['#191512', 'ink'], ['#F7F1E6', 'cream']];

let D = null, st = null, rootEl = null, unbind = null;

async function load() {
  const r = await api.settle({
    printCtx: api.get('/api/admin/print/context?event=conference'),
    certSummary: api.get('/api/v2/studio/certificates/summary'),
    cards: api.get('/api/v2/studio/attendance-cards'),
    files: api.get('/api/admin/files')
  });
  return {
    errors: r.$errors,
    printCtx: r.printCtx || null,
    certSummary: r.certSummary || { total: 0, by_type: [], recent: [] },
    cards: (r.cards && r.cards.cards) || [],
    files: (r.files && r.files.files) || []
  };
}
const events = () => (D.printCtx && D.printCtx.events) || [{ key: 'conference', name: 'Plexus Conference' }, { key: 'gala', name: 'Gala Evening' }];

// ---------------------------------------------------------------- blocks
function toolCard(key, extraCta = '') {
  const t = COPY.tools[key];
  const cta = key === 'signup'
    ? `<a href="/links" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22">${t.cta}</a>`
    : key === 'planner'
      ? `<span style="display:flex;gap:12px;flex-wrap:wrap"><a href="${PLANNER_URL}" target="_blank" rel="noopener" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22">${t.cta}</a><a href="/gala" style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459" data-hover="color:#9b1b22">${t.cta2}</a></span>`
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
function drawerBody() {
  const c = (D.printCtx && D.printCtx.counts) || { total: 0, withQr: 0 };
  if (st.tool === 'badges') return `
        <div style="padding:14px 20px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          ${eventSelect('badgeEvent')}
          <span data-act="genBadges" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${COPY.badges.gen}</span>
          <span data-act="pdfRender" data-kind="badges-sheet" style="padding:9px 15px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="border-color:#201b16">${COPY.badges.pdf}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.badges.note} · ${esc(COPY.badges.counts(c))}</span>
        </div>${previewFrame()}`;
  if (st.tool === 'certs') {
    const total = Number(D.certSummary.total) || 0;
    return `
        <div style="padding:14px 20px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select data-role="certType" aria-label="Certificate type" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">${COPY.certs.types.map(([k, l]) => `<option value="${k}"${st.certType === k ? ' selected' : ''}>${esc(l)} — Plexus 2026</option>`).join('')}</select>
          <span data-act="genCert" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${COPY.certs.gen}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.certs.note} · ${esc(COPY.certs.issued(total))}</span>
        </div>${previewFrame()}`;
  }
  if (st.tool === 'print') return `
        <div style="padding:14px 20px 18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${COPY.print.kinds.map(([k, l]) => `<span data-act="printKind" data-key="${k}" style="padding:8px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;background:${st.printKind === k ? '#201b16' : 'transparent'};color:${st.printKind === k ? '#f6f2ea' : '#6d6459'};border:1px solid ${st.printKind === k ? '#201b16' : 'rgba(32,27,22,.25)'}">${l}</span>`).join('')}
          ${eventSelect('printEvent')}
          <span data-act="genPrint" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${COPY.print.gen}</span>
          <span data-act="pdfRender" data-kind="${esc(st.printKind)}" style="padding:9px 15px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="border-color:#201b16">${COPY.print.pdf}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.print.note}</span>
        </div>${previewFrame()}`;
  // social
  const cards = D.cards;
  const cardImg = p => (cfg.memberBase ? cfg.memberBase : cfg.memberPortalUrl) + p;
  return `
        <div style="padding:16px 20px 20px;display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:9px;flex:1;min-width:240px">
            <input data-role="scHead" value="${esc(st.scHead)}" placeholder="${esc(COPY.social.headPh)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
            <input data-role="scSub" value="${esc(st.scSub)}" placeholder="${esc(COPY.social.subPh)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
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
          <div data-role="scPrev" style="width:220px;height:220px;background:#191512;flex:none;display:flex;flex-direction:column;justify-content:flex-end;padding:18px;box-sizing:border-box;gap:6px">
            <span style="width:26px;height:2px;background:#c9a962"></span>
            <span data-role="scHeadPrev" style="font-family:Fraunces,serif;font-size:17px;line-height:1.2;color:#f7f1e6">${esc(st.scHead.trim() || COPY.social.headPrev)}</span>
            <span data-role="scSubPrev" style="font-size:10px;color:rgba(247,241,230,.65)">${esc(st.scSub.trim() || COPY.social.subPrev)}</span>
            <span style="font:600 7px Inter,sans-serif;letter-spacing:.28em;color:#c9a962;margin-top:4px">MED&amp;X</span>
          </div>
        </div>`;
}
function blockDrawer() {
  if (!st.tool) return `<!-- dc: Admin Studio.dc.html › "Tool drawer" --><div data-block="drawer"></div><!-- /dc -->`;
  return `
    <!-- dc: Admin Studio.dc.html › "Tool drawer" -->
    <div data-block="drawer" id="drawer" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.titles[st.tool] || ''}</span>
        <div style="flex:1"></div>
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
const KIND = m => {
  const s = String(m || '');
  if (/pdf/.test(s)) return 'PDF';
  if (/word|docx?/.test(s)) return 'DOCX';
  if (/sheet|excel|xlsx?|csv/.test(s)) return 'SHEET';
  if (/presentation|pptx?/.test(s)) return 'DECK';
  if (/zip|compressed/.test(s)) return 'ZIP';
  if (/image\//.test(s)) return 'IMAGE';
  return (s.split('/')[1] || 'FILE').toUpperCase().slice(0, 6);
};
function storedRows() {
  return `<div data-block="storedRows">
      ${D.files.map(f => `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.07)">
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#eee9df;color:#4a4239;padding:3px 7px;flex:none">${esc(KIND(f.mime))}</span>
        <span style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
        <span style="font-size:11px;color:#9a9086;white-space:nowrap">${esc(fmt.when(String(f.created_at || '').replace(' ', 'T') + 'Z').toLowerCase())}</span>
        <span data-act="storedOpen" data-id="${esc(f.id)}" data-name="${esc(f.name)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer">${COPY.stored.open}</span>
      </div>`).join('')}
      ${!D.files.length ? `<div class="empty"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.stored.empty}</span><span class="empty-why">${COPY.stored.emptyWhy}</span></div>` : ''}
    </div>`;
}
function blockStored() {
  const err = D.errors.files;
  return `
    <!-- dc: Admin Studio.dc.html › "STORED FILES" -->
    <div data-block="stored" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.stored.title}</span><div style="flex:1"></div><label style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${COPY.stored.upload}<input data-role="storedFile" type="file" style="display:none"></label></div>
      ${err ? (err.isLocked ? ui.lockedBlock(perms.label(err.section)) : `<div class="empty"><span class="empty-why">${esc(err.message)}</span></div>`) : storedRows()}
    </div>
    <!-- /dc -->`;
}
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
    ${blockStored()}
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
  paint('[data-block="tools"]', blockTools());
  paint('[data-block="drawer"]', blockDrawer());
  const d = rootEl.querySelector('#drawer');
  if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
  const sf = rootEl.querySelector('[data-role="storedFile"]');
  if (sf && !sf._wired) {
    sf._wired = true;
    sf.addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { ui.toast(COPY.stored.tooBig, { kind: 'error' }); e.target.value = ''; return; }
      try {
        const buf = await f.arrayBuffer();
        const url = api.url('/api/admin/files?scope=pr&name=' + encodeURIComponent(f.name) + '&mime=' + encodeURIComponent(f.type || 'application/octet-stream'));
        const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + session.token }, body: buf });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
        const list = await api.get('/api/admin/files'); D.files = (list && list.files) || [];
        paint('[data-block="stored"]', blockStored());
        ui.toast(COPY.stored.uploaded);
      } catch (err) { ui.toast(err.message, { kind: 'error' }); }
      e.target.value = '';
    });
  }
}

const handlers = {
  tool: (el) => openDrawer(el.dataset.key),
  toolClose: () => { st.tool = null; st.previewHtml = null; paint('[data-block="tools"]', blockTools()); paint('[data-block="drawer"]', blockDrawer()); },
  printKind: (el) => { st.printKind = el.dataset.key; paint('[data-block="drawer"]', blockDrawer()); },
  genBadges: () => buildPreview(() => api.post('/api/admin/print/preview', { kind: 'badges-sheet', event: st.event })),
  genPrint: () => buildPreview(() => api.post('/api/admin/print/preview', { kind: st.printKind, event: st.event, fields: {} })),
  genCert: () => buildPreview(() => api.post('/api/v2/studio/certificates/preview', { type: st.certType })),
  pdfRender: async (el) => {
    const kind = el.dataset.kind;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/admin/print/render', { kind, event: st.event, fields: {} });
      if (r && r.url) { window.open(r.url, '_blank', 'noopener'); ui.toast('PRINT-READY PDF SAVED TO THE STUDIO ASSETS'); }
      el.removeAttribute('aria-disabled');
    } catch (e) {
      el.removeAttribute('aria-disabled');
      ui.toast(e.status === 503 ? COPY.engineDown : e.message, { kind: 'error', ms: 5200 });
    }
  },
  dlSocial: () => {
    // the artboard's 1080×1080 renderer, verbatim behaviour: ink ground, gold rule, wrapped headline
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
    const x = c.getContext('2d');
    x.fillStyle = '#191512'; x.fillRect(0, 0, 1080, 1080);
    x.fillStyle = '#c9a962'; x.fillRect(90, 760, 120, 8);
    x.fillStyle = '#f7f1e6'; x.font = '600 74px Georgia, serif';
    const head = (st.scHead.trim() || COPY.social.headPrev);
    const words = head.split(' '); let line = ''; const y = 860; const lines = [];
    words.forEach(w => { if (x.measureText(line + ' ' + w).width > 880 && line) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w; });
    lines.push(line); lines.slice(0, 3).forEach((l, i) => x.fillText(l, 90, y + i * 84 - (lines.length - 1) * 84));
    x.fillStyle = 'rgba(247,241,230,.65)'; x.font = '400 34px Inter, sans-serif';
    x.fillText(st.scSub.trim() || COPY.social.subPrev, 90, y + 70);
    x.fillStyle = '#c9a962'; x.font = '600 26px Inter, sans-serif';
    x.fillText('M E D & X', 90, 1000);
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'medx-card.png'; a.click();
    ui.toast(COPY.social.done);
  },
  copyHex: (el) => {
    try { navigator.clipboard.writeText(el.dataset.hex).catch(() => {}); } catch (e) {}
    ui.toast(COPY.brand.copied(el.dataset.hex));
  },
  storedOpen: async (el) => {
    try {
      const res = await fetch(api.url('/api/admin/files/' + encodeURIComponent(el.dataset.id) + '/download'), { headers: { Authorization: 'Bearer ' + session.token } });
      if (!res.ok) throw new Error('Could not open the file (' + res.status + ')');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = el.dataset.name || 'file'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

export default {
  title: 'Studio',
  async render(root, ctx) {
    rootEl = root;
    if (!document.getElementById('mx-css-studio')) {
      const l = document.createElement('link'); l.id = 'mx-css-studio'; l.rel = 'stylesheet'; l.href = '/css/views/studio.css'; document.head.appendChild(l);
    }
    st = { tool: null, event: 'conference', certType: 'attendance', printKind: 'sign', scHead: '', scSub: '', previewHtml: null, previewBusy: false };
    D = await load();
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
    const tab = ctx.params.tab;
    if (tab && ['badges', 'certs', 'print', 'social'].includes(tab)) openDrawer(tab);
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; }
};
