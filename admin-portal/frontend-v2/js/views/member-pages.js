// Source: Admin Member Pages.dc.html — "What members see", the SINGLE write-path to
// member-facing content (handoff note 22; hubs' MANAGE buttons land here).
// Blocks (artboard order): "Title row" › "Project tabs" › "Member-facing content card"
// (per-project rows + SAVE TO MEMBER PORTAL) › side: "HOW IT LOOKS ON THEIR HOME" live
// preview › "REGISTRATION FORM" (+ the custom-question field editor) › "Versioned" note.
// Writes: PUT /api/admin/project-status/:key (status label · detail line · CTA — the member
// Home cards AND medx.hr read these rows) · PUT /api/admin/content-blocks/:key.announcement
// (REAL published/draft) · PUT /api/admin/plexus/settings (key dates) · PUT /api/admin/gala/settings
// (prices · dress code) · /api/accelerator/years/:year/dates CRUD · /api/admin/custom-fields CRUD.
// After every save the member backend is polled (GET <memberBase>/api/public/status) and the
// preview card reports MEMBER PORTAL CONFIRMED ✓ — a live proof, not an assumption.
import cfg from '../config.js';
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import router from '../router.js';

export const SOURCE = 'Admin Member Pages.dc.html';

const KEYS = ['plexus', 'gala', 'accelerator', 'forum', 'bridges'];
const KINDS = ['open', 'soon', 'closed', 'info'];

export const COPY = {
  title: 'What members <i>see</i>',
  sub: 'everything member-facing, per project — edit here, it changes on the portal the moment you save',
  names: { plexus: 'PLEXUS WEEK', gala: 'GALA EVENING', accelerator: 'ACCELERATOR', forum: 'BIOMEDICAL FORUM', bridges: 'BUILDING BRIDGES' },
  cardTitle: n => `${n} — MEMBER-FACING CONTENT`, openLive: 'OPEN THE LIVE PAGE ↗',
  rows: { status: 'STATUS LABEL', detail: 'DETAIL LINE', cta: 'CTA BUTTON', announcement: 'ANNOUNCEMENT', keyDates: 'KEY DATES', prices: 'PRICES', dress: 'DRESS CODE NOTE', hosts: 'HOST INSTITUTIONS', program: 'PROGRAM & SPEAKERS', feed: 'FORUM FEED', memberList: 'MEMBER LIST', recaps: 'CITY RECAPS', speakers: 'SPEAKER LIST' },
  chips: { live: 'LIVE', pub: 'PUBLISHED', draft: 'DRAFT', hub: 'IN THE HUB →' },
  liveTitle: 'No draft state on this row — it is live for members the moment you save',
  pubTitle: 'Click to publish or unpublish',
  save: 'SAVE TO MEMBER PORTAL', saved: '✓ SAVED — LIVE FOR MEMBERS', saving: 'SAVING…',
  saveNote: 'Draft rows stay hidden from members until you publish them.',
  liveNote: 'Status, detail and button rows carry no draft state — they go live for members the moment you save.',
  savedToast: 'SAVED — LIVE ON THE MEMBER PORTAL', saveFailed: 'Could not save — nothing changed for members.',
  preview: {
    title: 'HOW IT LOOKS ON THEIR HOME', open: 'OPEN →',
    note: 'This card updates live as you type on the left — what you see is what they get.',
    now: (label, when) => `Members see now · “${label}”${when ? ' · updated ' + when : ''}`,
    checking: 'Saved — checking the member portal…',
    confirmed: 'MEMBER PORTAL CONFIRMED ✓ — serving the new copy',
    slow: 'Saved here — the member portal refreshes its public cache within a minute.'
  },
  form: {
    title: 'REGISTRATION FORM', edit: '✎ EDIT THE FORM FIELDS', close: 'CLOSE THE FIELD EDITOR',
    add: 'ADD', addPh: 'New question…', optionsPh: 'Options, comma-separated', required: 'required',
    empty: 'No custom questions yet — the form runs with its standard fields.',
    added: 'QUESTION ADDED — LIVE ON THE PUBLIC FORM', removed: 'QUESTION REMOVED', savedField: 'QUESTION UPDATED', moved: 'ORDER UPDATED',
    removeTitle: 'Remove this question?', removeBody: 'Answers already given stay stored — the question just leaves the form.',
    types: { text: 'Short answer', textarea: 'Long answer', select: 'Dropdown', checkbox: 'Checkbox' },
    notes: {
      plexus: 'Free conference registration — name, email, institution. Gala seats are a paid add-on with the early-bird price switch on Sep 15.',
      gala: 'Seat reservation with payment — the price switch runs on the early-bird date. The waitlist opens itself when seats run out.',
      accelerator: 'The 7-step application wizard — personal, education, motivation, documents. Submissions land in the Review Room.',
      forum: 'Two doors: the invitation-code unlock for invitees, and the public interest form that feeds your candidate pipeline.',
      bridges: 'Open registration per city. Closing it here closes the form on the member page instantly.'
    },
    where: {
      plexus: 'Custom questions save to the shared form engine and appear on invite-link registration pages; the fixed /plexus page keeps its standard field set.',
      gala: 'Custom questions appear on this project’s invite-link registration pages the moment you add them.',
      bridges: 'Custom questions appear on this project’s invite-link registration pages the moment you add them.'
    },
    fixed: {
      accelerator: { note: 'The application wizard has a fixed field set — manage applications in the Review Room.', cta: 'REVIEW ROOM →', href: '/accelerator-review' },
      forum: { note: 'The public interest form has a fixed field set — candidates land in the Forum hub pipeline.', cta: 'FORUM HUB →', href: '/projects/forum' }
    }
  },
  kd: { edit: '✎ EDIT THE LIST', close: 'CLOSE', add: '+ ADD DATE', namePh: 'What happens', datePh: 'When (e.g. Until September 30, 2026)', dateIsoPh: 'YYYY-MM-DD', empty: 'No key dates yet.' },
  audit: 'Anything saved here is versioned — <a href="/settings/audit">the audit log</a> remembers who changed what, and nothing is ever lost.',
  hub: { program: 'published from the hub', feed: 'Spotlights & news — published from the hub', memberList: 'Visible to Forum members only', recaps: 'Photos & numbers per past city', speakers: 'Announced closer to the date', hosts: n => `${n == null ? '—' : n} institution${n === 1 ? '' : 's'} listed — synced from the hub` }
};

let D = null, st = null, unbind = null, rootEl = null, proofTimer = null;

function ensureCss() {
  if (document.querySelector('link[data-view-css="member-pages"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/member-pages.css'; l.setAttribute('data-view-css', 'member-pages');
  document.head.appendChild(l);
}
const memberUrl = path => (cfg.memberBase || '') + path;
const parseOpts = j => { try { const a = JSON.parse(j || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    status: api.get('/api/admin/project-status'),
    blocks: api.get('/api/admin/content-blocks'),
    fields: api.get('/api/admin/custom-fields'),
    plexusSettings: api.get('/api/admin/plexus/settings'),
    galaSettings: api.get('/api/admin/gala/settings'),
    accKd: api.get('/api/accelerator/years/' + FACTS.year + '/dates'),
    conf: api.get('/api/conferences/active', { noAuth: true }),
    inst: api.get('/api/accelerator/institutions', { noAuth: true }),
    memberStatus: api.get(memberUrl('/api/public/status?t=' + Date.now()), { noAuth: true })
  });
  const status = {}; (Array.isArray(r.status) ? r.status : []).forEach(p => { status[p.project_key] = p; });
  const blocks = {}; ((r.blocks && r.blocks.blocks) || []).forEach(b => { blocks[b.block_key] = b; });
  const memberNow = {}; (((r.memberStatus || {}).projects) || []).forEach(p => { memberNow[p.project_key] = p; });
  return {
    errors: r.$errors, status, blocks,
    fields: Array.isArray(r.fields) ? r.fields : [],
    plexusSettings: r.plexusSettings || {}, galaSettings: r.galaSettings || {},
    accKd: Array.isArray(r.accKd) ? r.accKd : [], conf: r.conf || {},
    instCount: Array.isArray(r.inst) ? r.inst.filter(i => Number(i.is_active == null ? 1 : i.is_active)).length : null,
    memberNow
  };
}
function resetTab() {
  const k = st.proj;
  const ps = D.status[k] || {};
  const block = D.blocks[k + '.announcement'] || null;
  st.saved = false; st.dirty = false; st.proof = 'idle';
  st.blockOn = block ? !!Number(block.is_published) : true;
  st.kdOpen = false; st.accOpen = false; st.fieldsOpen = false;
  let kd = []; try { kd = JSON.parse(D.plexusSettings.key_dates_json || '[]'); } catch (e) { kd = Array.isArray(D.plexusSettings.key_dates) ? D.plexusSettings.key_dates : []; }
  st.kd = kd.map(x => ({ label: x.label || '', date: x.date || '', color: x.color || '#0f172a' }));
  st.accKd = D.accKd.map(x => ({ id: x.id, name: x.name || '', date_start: x.date_start || '', date_end: x.date_end || '' }));
  st.accDeleted = [];
  st.ps = { status_label: ps.status_label || '', status_kind: ps.status_kind || 'info', detail_line: ps.detail_line || '', cta_label: ps.cta_label || '', cta_target: ps.cta_target || k };
  st.blockBody = block ? (block.body || '') : '';
}

// ---------------------------------------------------------------- pieces
function previewTag(k) {
  const c = D.conf, gs = D.galaSettings;
  if (k === 'plexus') return `${fmt.rangeLabel(c.start_date || FACTS.plexus.start, c.end_date || FACTS.plexus.end)} · ${(c.venue_city || FACTS.plexus.city).toUpperCase()}`;
  if (k === 'gala') return `${fmt.dayLabel(gs.date || FACTS.gala.date)} · ${(gs.venue || FACTS.gala.venue).toUpperCase()}`;
  if (k === 'accelerator') return `OPENS ${FACTS.accelerator.opensShort.toUpperCase()}`;
  if (k === 'forum') return 'BY INVITATION';
  return `NEXT · ${FACTS.bridges.next.city.toUpperCase()}, ${fmt.rangeLabel(FACTS.bridges.next.start, FACTS.bridges.next.end)}`;
}
const chipLive = `<span class="mx-chip" title="${esc(COPY.liveTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:4px 9px;background:#e4efe7;color:#22563a;white-space:nowrap;cursor:default">${COPY.chips.live}</span>`;
const chipHub = href => `<span data-nav="${href}" class="mx-chip" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:4px 9px;cursor:pointer;background:#f8f1e2;color:#7a6432;white-space:nowrap">${COPY.chips.hub}</span>`;
function chipBlock() {
  const on = st.blockOn;
  return `<span data-act="blockToggle" title="${esc(COPY.pubTitle)}" class="mx-chip" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:4px 9px;cursor:pointer;background:${on ? '#e4efe7' : '#eee9df'};color:${on ? '#22563a' : '#6d6459'};white-space:nowrap">${on ? COPY.chips.pub : COPY.chips.draft}</span>`;
}
const rowShell = (label, inner, chip) => `
        <div class="mx-mp-row" style="display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.08);flex-wrap:wrap">
          <span style="width:150px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${label}</span>
          ${inner}
          ${chip}
        </div>`;
const textInput = (role, value, extra) => `<input data-role="${role}" value="${esc(value)}" ${extra || ''} style="flex:1;min-width:180px;border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:8px 11px;font:400 13px Inter,sans-serif;color:#201b16">`;
const miniInput = (role, value, w, ph) => `<input data-role="${role}" value="${esc(value)}" placeholder="${esc(ph || '')}" style="width:${w}px;border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">`;

function psRows(k) {
  const kindSel = `<select data-role="ps-kind" data-v2="status-kind" title="How the member card colors this status" style="border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:8px 6px;font:400 12px Inter,sans-serif;color:#201b16">${KINDS.map(x => `<option${st.ps.status_kind === x ? ' selected' : ''}>${x}</option>`).join('')}</select>`;
  const target = `<input data-role="ps-target" data-v2="cta-target" value="${esc(st.ps.cta_target)}" title="Where the button lands — a project key or a link" style="width:120px;border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:8px 10px;font:400 12px Inter,sans-serif;color:#6d6459">`;
  return rowShell(COPY.rows.status, textInput('ps-status', st.ps.status_label) + kindSel, chipLive)
       + rowShell(COPY.rows.detail, textInput('ps-detail', st.ps.detail_line), chipLive)
       + rowShell(COPY.rows.cta, textInput('ps-cta', st.ps.cta_label) + target, chipLive);
}
function blockRow() {
  if (!D.blocks[st.proj + '.announcement']) return '';
  return rowShell(COPY.rows.announcement, textInput('block-body', st.blockBody, 'placeholder="Announcement strip on the member page — blank hides it"'), chipBlock());
}
function kdSummary(list) { return list.length ? list.map(x => x.label).filter(Boolean).slice(0, 3).join(' · ') : COPY.kd.empty; }
function kdRow() {
  const summary = kdSummary(st.kd);
  const editor = !st.kdOpen ? '' : `
        <div data-block="kd-editor" class="mx-mp-sub" style="flex-basis:100%;display:flex;flex-direction:column;gap:8px;padding:4px 0 2px 164px">
          ${st.kd.map((x, i) => `
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${miniInput('kd-label-' + i, x.label, 220, COPY.kd.namePh)}
            ${miniInput('kd-date-' + i, x.date, 240, COPY.kd.datePh)}
            <span data-act="kdRemove" data-i="${i}" title="Remove" style="font:600 11px Inter,sans-serif;color:#9b1b22;cursor:pointer">✕</span>
          </div>`).join('')}
          <span data-act="kdAdd" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;align-self:flex-start">${COPY.kd.add}</span>
        </div>`;
  return rowShell(COPY.rows.keyDates,
    `<span data-role="kd-summary" style="flex:1;min-width:180px;font-size:13px;color:#201b16">${esc(summary)}</span>
          <span data-act="kdToggle" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.kdOpen ? COPY.kd.close : COPY.kd.edit}</span>`,
    chipLive) .replace('</div>', editor + '</div>');
}
function accKdRow() {
  const summary = st.accKd.length ? st.accKd.map(x => x.name).filter(Boolean).slice(0, 3).join(' · ') : COPY.kd.empty;
  const editor = !st.accOpen ? '' : `
        <div data-block="acc-editor" class="mx-mp-sub" style="flex-basis:100%;display:flex;flex-direction:column;gap:8px;padding:4px 0 2px 164px">
          ${st.accKd.map((x, i) => `
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${miniInput('acc-name-' + i, x.name, 220, COPY.kd.namePh)}
            ${miniInput('acc-start-' + i, x.date_start, 120, COPY.kd.dateIsoPh)}
            ${miniInput('acc-end-' + i, x.date_end, 120, COPY.kd.dateIsoPh)}
            <span data-act="accRemove" data-i="${i}" title="Remove" style="font:600 11px Inter,sans-serif;color:#9b1b22;cursor:pointer">✕</span>
          </div>`).join('')}
          <span data-act="accAdd" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;align-self:flex-start">${COPY.kd.add}</span>
        </div>`;
  return rowShell(COPY.rows.keyDates,
    `<span data-role="acc-summary" style="flex:1;min-width:180px;font-size:13px;color:#201b16">${esc(summary)}</span>
          <span data-act="accToggle" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.accOpen ? COPY.kd.close : COPY.kd.edit}</span>`,
    chipLive).replace('</div>', editor + '</div>');
}
function galaRows() {
  const gs = D.galaSettings;
  const prices = `
          <span style="display:flex;gap:8px;align-items:center;flex:1;min-width:280px;flex-wrap:wrap">
            <span style="font-size:12px;color:#6d6459">€</span>${miniInput('gala-early', gs.price_gala_early_bird != null ? gs.price_gala_early_bird : FACTS.gala.priceEarly, 64)}
            <span style="font-size:12px;color:#6d6459">until</span>${miniInput('gala-flip', (gs.early_bird_deadline || FACTS.gala.priceFlip).slice(0, 10), 110, COPY.kd.dateIsoPh)}
            <span style="font-size:12px;color:#6d6459">· €</span>${miniInput('gala-regular', gs.price_gala_regular != null ? gs.price_gala_regular : FACTS.gala.priceRegular, 64)}
            <span style="font-size:12px;color:#6d6459">after</span>
          </span>`;
  return rowShell(COPY.rows.prices, prices, chipLive)
       + rowShell(COPY.rows.dress, textInput('gala-dress', gs.dress_code || ''), chipLive);
}
const hubRow = (label, value, href) => rowShell(label, `<span style="flex:1;min-width:180px;font-size:13px;color:#4a4239">${esc(value)}</span>`, chipHub(href));

function contentRows(k) {
  let rows = psRows(k) + blockRow();
  if (k === 'plexus') rows += kdRow() + hubRow(COPY.rows.program, 'Sessions & speakers — ' + COPY.hub.program, '/projects/plexus');
  if (k === 'gala') rows += galaRows();
  if (k === 'accelerator') rows += accKdRow() + hubRow(COPY.rows.hosts, COPY.hub.hosts(D.instCount), '/projects/accelerator');
  if (k === 'forum') rows += hubRow(COPY.rows.feed, COPY.hub.feed, '/projects/forum') + hubRow(COPY.rows.memberList, COPY.hub.memberList, '/projects/forum');
  if (k === 'bridges') rows += hubRow(COPY.rows.recaps, COPY.hub.recaps, '/projects/bridges') + hubRow(COPY.rows.speakers, COPY.hub.speakers, '/projects/bridges');
  return rows;
}

// ---------------------------------------------------------------- blocks
function blockTitle() {
  return `
  <!-- dc: Admin Member Pages.dc.html › "Title row" -->
  <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
    <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
    <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
  </div>
  <!-- /dc -->`;
}
function blockTabs() {
  return `
  <!-- dc: Admin Member Pages.dc.html › "Project tabs" -->
  <div data-block="tabs" style="display:flex;gap:8px;flex-wrap:wrap">
    ${KEYS.map(k => {
      const on = k === st.proj;
      return `<span data-act="tab" data-proj="${k}" style="padding:8px 14px;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;background:${on ? '#201b16' : '#fff'};color:${on ? '#fff' : '#6d6459'};border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.25)'}">${COPY.names[k]}</span>`;
    }).join('\n    ')}
  </div>
  <!-- /dc -->`;
}
function contentCard() {
  const k = st.proj;
  const locked = D.errors && D.errors.status && D.errors.status.isLocked;
  return `
      <div data-block="content" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);flex-wrap:wrap">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.cardTitle(COPY.names[k])}</span>
          <div style="flex:1"></div>
          <a href="${esc(cfg.memberPortalUrl || '/')}/#${k}" target="_blank" rel="noopener" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.openLive}</a>
        </div>
        ${locked ? `<div style="padding:10px 0">${ui.lockedBlock('Member-facing content')}</div>` : contentRows(k)}
        <div style="display:flex;align-items:center;gap:12px;padding:13px 20px;flex-wrap:wrap">
          <span data-act="save" data-role="saveBtn" style="padding:10px 18px;background:${st.saved ? '#1e6e42' : '#9b1b22'};color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${st.saved ? COPY.saved : COPY.save}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.saveNote}</span>
          <span style="font-size:11px;color:#9a9086;flex-basis:100%">${COPY.liveNote}</span>
        </div>
      </div>`;
}
function proofLine() {
  const k = st.proj;
  if (st.proof === 'checking') return COPY.preview.checking;
  if (st.proof === 'ok') return COPY.preview.confirmed;
  if (st.proof === 'slow') return COPY.preview.slow;
  const now = D.memberNow[k];
  if (!now) return '';
  return COPY.preview.now(fmt.detail(now.status_label || ''), now.updated_at ? fmt.when(now.updated_at).toLowerCase() : '');
}
function previewCard() {
  const k = st.proj;
  return `
        <div data-block="preview" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:10px">
          <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.preview.title}</span>
          <div style="border:1px solid rgba(25,21,18,.16);background:#f7f1e6;padding:16px 18px;display:flex;flex-direction:column;gap:6px">
            <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22">${esc(previewTag(k))}</span>
            <span data-role="prevTitle" style="font-family:Fraunces,serif;font-size:19px;line-height:1.2">${esc(fmt.detail(st.ps.status_label))}</span>
            <span data-role="prevDetail" style="font-size:12px;color:#4a4239">${esc(fmt.detail(st.ps.detail_line))}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;margin-top:4px"><span data-role="prevCta">${esc((st.ps.cta_label || 'Open').toUpperCase())}</span> →</span>
          </div>
          <span data-role="proof" style="font-size:11px;color:${st.proof === 'ok' ? '#1e6e42' : '#6d6459'};font-weight:${st.proof === 'ok' ? '600' : '400'}">${esc(proofLine())}</span>
          <span style="font-size:11.5px;color:#6d6459;line-height:1.5">${COPY.preview.note}</span>
        </div>`;
}
function fieldEditor() {
  const k = st.proj;
  const fields = D.fields.filter(f => f.scope === 'event' && f.event_type === k && Number(f.is_active)).sort((a, b) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at)));
  if (!st.fieldsOpen) return '';
  return `
          <div data-block="fields" class="mx-mp-sub" style="display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(32,27,22,.1);padding-top:12px">
            ${fields.length ? fields.map((f, i) => `
            <div data-field="${esc(f.id)}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input data-role="f-label-${esc(f.id)}" value="${esc(f.label)}" style="flex:1;min-width:140px;border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:7px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
              <select data-role="f-type-${esc(f.id)}" style="border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:7px 6px;font:400 12px Inter,sans-serif;color:#201b16">
                ${Object.entries(COPY.form.types).map(([v, l]) => `<option value="${v}"${f.field_type === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
              <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#6d6459;white-space:nowrap"><input type="checkbox" data-role="f-req-${esc(f.id)}"${Number(f.required) ? ' checked' : ''} style="margin:0">${COPY.form.required}</label>
              ${f.field_type === 'select' ? `<input data-role="f-opts-${esc(f.id)}" value="${esc(parseOpts(f.options_json).join(', '))}" placeholder="${COPY.form.optionsPh}" style="flex-basis:100%;border:1px solid rgba(32,27,22,.2);background:#f6f2ea;padding:7px 10px;font:400 12px Inter,sans-serif;color:#201b16">` : ''}
              <span data-act="fieldSave" data-id="${esc(f.id)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap">SAVE</span>
              <span data-act="fieldUp" data-id="${esc(f.id)}" title="Move up" style="font:600 11px Inter,sans-serif;color:${i === 0 ? 'rgba(32,27,22,.25)' : '#201b16'};cursor:pointer">↑</span>
              <span data-act="fieldDown" data-id="${esc(f.id)}" title="Move down" style="font:600 11px Inter,sans-serif;color:${i === fields.length - 1 ? 'rgba(32,27,22,.25)' : '#201b16'};cursor:pointer">↓</span>
              <span data-act="fieldRemove" data-id="${esc(f.id)}" title="Remove" style="font:600 11px Inter,sans-serif;color:#9b1b22;cursor:pointer">✕</span>
            </div>`).join('') : `<span style="font-size:12px;color:#6d6459;font-style:italic">${COPY.form.empty}</span>`}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input data-role="newFieldLabel" placeholder="${COPY.form.addPh}" style="flex:1;min-width:140px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:7px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
              <select data-role="newFieldType" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:7px 6px;font:400 12px Inter,sans-serif;color:#201b16">
                ${Object.entries(COPY.form.types).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select>
              <span data-act="fieldAdd" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${COPY.form.add}</span>
            </div>
            <span style="font-size:10.5px;color:#9a9086;line-height:1.5">${esc(COPY.form.where[k] || '')}</span>
          </div>`;
}
function formCard() {
  const k = st.proj;
  const fixed = COPY.form.fixed[k];
  return `
        <div data-block="form" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.form.title}</span>
          <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${esc(COPY.form.notes[k])}</span>
          ${fixed
            ? `<span data-nav="${fixed.href}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${fixed.cta}</span>
          <span style="font-size:10.5px;color:#9a9086;line-height:1.5">${esc(fixed.note)}</span>`
            : `<span data-act="fieldsToggle" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${st.fieldsOpen ? COPY.form.close : COPY.form.edit}</span>
          ${fieldEditor()}`}
        </div>`;
}
function auditCard() {
  return `
        <div style="border:1px solid rgba(32,27,22,.14);background:#fdfbf6;padding:14px 20px;font-size:12px;color:#6d6459;line-height:1.6">
          ${COPY.audit}
        </div>`;
}
function blockMain() {
  return `
  <!-- dc: Admin Member Pages.dc.html › "Member-facing content card" + side column -->
  <div class="mx-two mx-mp-grid" data-block="main" style="display:grid;grid-template-columns:1.55fr 1fr;gap:22px;align-items:start">
    ${contentCard()}
    <div style="display:flex;flex-direction:column;gap:22px">
      ${previewCard()}
      ${formCard()}
      ${auditCard()}
    </div>
  </div>
  <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin Member Pages" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:20px">
    ${blockTitle()}
    ${blockTabs()}
    ${blockMain()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function redrawMain() { if (!rootEl) return; const el = rootEl.querySelector('[data-block="main"]'); if (el) { el.outerHTML = blockMain(); wireInputs(); } }
function markDirty() {
  st.dirty = true;
  if (st.saved) { st.saved = false; const b = rootEl.querySelector('[data-role="saveBtn"]'); if (b) { b.textContent = COPY.save; b.style.background = '#9b1b22'; } }
}
function wireInputs() {
  if (!rootEl) return;
  const on = (role, fn) => { const el = rootEl.querySelector(`[data-role="${role}"]`); if (el) el.addEventListener('input', () => { fn(el.value); markDirty(); }); };
  on('ps-status', v => { st.ps.status_label = v; const t = rootEl.querySelector('[data-role="prevTitle"]'); if (t) t.textContent = fmt.detail(v); });
  on('ps-detail', v => { st.ps.detail_line = v; const t = rootEl.querySelector('[data-role="prevDetail"]'); if (t) t.textContent = fmt.detail(v); });
  on('ps-cta', v => { st.ps.cta_label = v; const t = rootEl.querySelector('[data-role="prevCta"]'); if (t) t.textContent = (v || 'Open').toUpperCase(); });
  on('ps-target', v => { st.ps.cta_target = v; });
  on('block-body', v => { st.blockBody = v; });
  const kind = rootEl.querySelector('[data-role="ps-kind"]'); if (kind) kind.addEventListener('change', () => { st.ps.status_kind = kind.value; markDirty(); });
  st.kd.forEach((x, i) => { on('kd-label-' + i, v => { x.label = v; }); on('kd-date-' + i, v => { x.date = v; }); });
  st.accKd.forEach((x, i) => { on('acc-name-' + i, v => { x.name = v; }); on('acc-start-' + i, v => { x.date_start = v; }); on('acc-end-' + i, v => { x.date_end = v; }); });
  ['gala-early', 'gala-regular', 'gala-flip', 'gala-dress'].forEach(r => on(r, () => {}));
}
function setProof(state) {
  st.proof = state;
  const el = rootEl && rootEl.querySelector('[data-role="proof"]');
  if (el) { el.textContent = proofLine(); el.style.color = state === 'ok' ? '#1e6e42' : '#6d6459'; el.style.fontWeight = state === 'ok' ? '600' : '400'; }
}
function proveOnMember(k, expectLabel) {
  clearTimeout(proofTimer);
  let tries = 0;
  const tick = async () => {
    if (!rootEl || st.proj !== k) return;
    tries++;
    try {
      const r = await api.get(memberUrl('/api/public/status?t=' + Date.now()), { noAuth: true });
      const row = ((r && r.projects) || []).find(p => p.project_key === k);
      if (row) D.memberNow[k] = row;
      if (row && String(row.status_label || '') === expectLabel) { setProof('ok'); return; }
    } catch (e) { /* member portal unreachable — keep trying */ }
    if (tries >= 9) { setProof('slow'); return; }
    proofTimer = setTimeout(tick, 5000);
  };
  setProof('checking');
  proofTimer = setTimeout(tick, 1500);
}
async function saveAll(btn) {
  const k = st.proj;
  const v = role => { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value : undefined; };
  btn.textContent = COPY.saving; btn.setAttribute('aria-disabled', 'true');
  try {
    // 1) project_status — the row the member Home cards and medx.hr read
    st.ps.status_label = v('ps-status') ?? st.ps.status_label;
    st.ps.detail_line = v('ps-detail') ?? st.ps.detail_line;
    st.ps.cta_label = v('ps-cta') ?? st.ps.cta_label;
    st.ps.cta_target = v('ps-target') ?? st.ps.cta_target;
    await api.put('/api/admin/project-status/' + encodeURIComponent(k), {
      status_label: st.ps.status_label, status_kind: st.ps.status_kind,
      detail_line: st.ps.detail_line, cta_label: st.ps.cta_label, cta_target: st.ps.cta_target
    });
    D.status[k] = { ...(D.status[k] || {}), project_key: k, ...st.ps, updated_at: new Date().toISOString() };
    // 2) announcement content block — real published/draft
    if (D.blocks[k + '.announcement']) {
      const body = v('block-body'); if (body !== undefined) st.blockBody = body;
      await api.put('/api/admin/content-blocks/' + encodeURIComponent(k + '.announcement'), { body: st.blockBody, is_published: st.blockOn ? 1 : 0 });
      D.blocks[k + '.announcement'] = { ...D.blocks[k + '.announcement'], body: st.blockBody, is_published: st.blockOn ? 1 : 0 };
    }
    // 3) per-project extras
    if (k === 'plexus') {
      const clean = st.kd.filter(x => x.label.trim() || x.date.trim());
      await api.put('/api/admin/plexus/settings', { key_dates_json: JSON.stringify(clean) });
      D.plexusSettings.key_dates_json = JSON.stringify(clean);
    }
    if (k === 'gala') {
      await api.put('/api/admin/gala/settings', {
        price_gala_early_bird: Number(v('gala-early')) || FACTS.gala.priceEarly,
        price_gala_regular: Number(v('gala-regular')) || FACTS.gala.priceRegular,
        early_bird_deadline: (v('gala-flip') || '').trim() || FACTS.gala.priceFlip,
        dress_code: v('gala-dress') !== undefined ? v('gala-dress') : (D.galaSettings.dress_code || '')
      });
      D.galaSettings = { ...D.galaSettings, price_gala_early_bird: Number(v('gala-early')) || FACTS.gala.priceEarly, price_gala_regular: Number(v('gala-regular')) || FACTS.gala.priceRegular, early_bird_deadline: (v('gala-flip') || '').trim() || FACTS.gala.priceFlip, dress_code: v('gala-dress') };
    }
    if (k === 'accelerator') {
      for (const id of st.accDeleted) await api.del('/api/accelerator/dates/' + encodeURIComponent(id));
      for (const row of st.accKd) {
        if (!row.name.trim()) continue;
        if (row.id) {
          const base = D.accKd.find(x => x.id === row.id);
          if (base && (base.name !== row.name || base.date_start !== row.date_start || base.date_end !== row.date_end))
            await api.put('/api/accelerator/dates/' + encodeURIComponent(row.id), { name: row.name, date_start: row.date_start || null, date_end: row.date_end || row.date_start || null });
        } else {
          await api.post('/api/accelerator/years/' + FACTS.year + '/dates', { name: row.name, date_start: row.date_start || null, date_end: row.date_end || row.date_start || null });
        }
      }
      try { const fresh = await api.get('/api/accelerator/years/' + FACTS.year + '/dates'); D.accKd = Array.isArray(fresh) ? fresh : D.accKd; st.accKd = D.accKd.map(x => ({ id: x.id, name: x.name || '', date_start: x.date_start || '', date_end: x.date_end || '' })); st.accDeleted = []; } catch (e) {}
    }
    st.saved = true; st.dirty = false;
    btn.removeAttribute('aria-disabled'); btn.textContent = COPY.saved; btn.style.background = '#1e6e42';
    ui.toast(COPY.savedToast);
    proveOnMember(k, st.ps.status_label);            // the live member-backend proof
  } catch (e) {
    btn.removeAttribute('aria-disabled'); btn.textContent = COPY.save; btn.style.background = '#9b1b22';
    ui.toast(e.message || COPY.saveFailed, { kind: 'error' });
  }
}
async function reloadFields() {
  try { const f = await api.get('/api/admin/custom-fields'); if (D) D.fields = Array.isArray(f) ? f : D.fields; } catch (e) {}
  const el = rootEl && rootEl.querySelector('[data-block="form"]');
  if (el) el.outerHTML = formCard();
}
function eventFields() {
  return D.fields.filter(f => f.scope === 'event' && f.event_type === st.proj && Number(f.is_active)).sort((a, b) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at)));
}

const handlers = {
  tab: (el) => {
    const k = el.dataset.proj; if (!KEYS.includes(k) || k === st.proj) return;
    clearTimeout(proofTimer);
    st.proj = k; resetTab();
    try { history.replaceState(null, '', '/member-pages/' + k); } catch (e) {}
    const tabs = rootEl.querySelector('[data-block="tabs"]'); if (tabs) tabs.outerHTML = blockTabs();
    redrawMain();
  },
  blockToggle: (el) => { st.blockOn = !st.blockOn; markDirty(); el.outerHTML = chipBlock(); },
  save: (el) => saveAll(el),
  kdToggle: () => { st.kdOpen = !st.kdOpen; redrawMain(); },
  kdAdd: () => { st.kd.push({ label: '', date: '', color: '#0f172a' }); st.kdOpen = true; markDirty(); redrawMain(); },
  kdRemove: (el) => { st.kd.splice(Number(el.dataset.i), 1); markDirty(); redrawMain(); },
  accToggle: () => { st.accOpen = !st.accOpen; redrawMain(); },
  accAdd: () => { st.accKd.push({ id: null, name: '', date_start: '', date_end: '' }); st.accOpen = true; markDirty(); redrawMain(); },
  accRemove: (el) => { const i = Number(el.dataset.i); const row = st.accKd[i]; if (row && row.id) st.accDeleted.push(row.id); st.accKd.splice(i, 1); markDirty(); redrawMain(); },
  fieldsToggle: () => { st.fieldsOpen = !st.fieldsOpen; const el = rootEl.querySelector('[data-block="form"]'); if (el) el.outerHTML = formCard(); },
  fieldAdd: async (el) => {
    const label = (rootEl.querySelector('[data-role="newFieldLabel"]') || {}).value || '';
    const type = (rootEl.querySelector('[data-role="newFieldType"]') || {}).value || 'text';
    if (!label.trim()) { ui.toast('TYPE THE QUESTION FIRST'); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      const max = eventFields().reduce((n, f) => Math.max(n, Number(f.sort_order) || 0), 0);
      await api.post('/api/admin/custom-fields', { scope: 'event', event_type: st.proj, label: label.trim(), field_type: type, required: false, sort_order: max + 1, options: type === 'select' ? ['Yes', 'No'] : undefined });
      await reloadFields();
      ui.toast(COPY.form.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  fieldSave: async (el) => {
    const id = el.dataset.id;
    const val = r => { const i = rootEl.querySelector(`[data-role="${r}-${id}"]`); return i ? (i.type === 'checkbox' ? i.checked : i.value) : undefined; };
    el.setAttribute('aria-disabled', 'true');
    try {
      const type = val('f-type');
      const body = { label: val('f-label'), field_type: type, required: !!val('f-req') };
      if (type === 'select') body.options = String(val('f-opts') || '').split(',').map(s => s.trim()).filter(Boolean);
      await api.put('/api/admin/custom-fields/' + encodeURIComponent(id), body);
      await reloadFields();
      ui.toast(COPY.form.savedField);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  fieldUp: (el) => moveField(el.dataset.id, -1),
  fieldDown: (el) => moveField(el.dataset.id, +1),
  fieldRemove: async (el) => {
    const id = el.dataset.id;
    const ok = await ui.confirm({ title: COPY.form.removeTitle, body: COPY.form.removeBody, ok: 'REMOVE', cancel: 'KEEP' });
    if (!ok) return;
    try { await api.del('/api/admin/custom-fields/' + encodeURIComponent(id)); await reloadFields(); ui.toast(COPY.form.removed); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};
async function moveField(id, dir) {
  const fields = eventFields();
  const i = fields.findIndex(f => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= fields.length) return;
  const a = fields[i], b = fields[j];
  const sa = Number(a.sort_order) || 0, sb = Number(b.sort_order) || 0;
  const [na, nb] = sa === sb ? [sa + dir, sb] : [sb, sa];
  try {
    await api.put('/api/admin/custom-fields/' + encodeURIComponent(a.id), { sort_order: na });
    await api.put('/api/admin/custom-fields/' + encodeURIComponent(b.id), { sort_order: nb });
    await reloadFields();
    ui.toast(COPY.form.moved);
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

export default {
  title: 'What members see',
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    const tab = ctx.params && ctx.params.tab;
    st = { proj: KEYS.includes(tab) ? tab : 'plexus' };
    D = await load();
    if (rootEl !== root) return;                        // navigated away while loading
    resetTab();
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
  },
  destroy() { clearTimeout(proofTimer); proofTimer = null; if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; }
};
