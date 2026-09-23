// js/views/big-ideas.js — BIG IDEAS: the long-game book (backend admin-portal/backend/v2/big-ideas.js).
//
// No artboard — built in the vocabulary of Admin Home / Admin People: paper ground, white cards,
// hairlines, Fraunces headings, one crimson action per block. Two screens behind one route:
//   /big-ideas        the list — cards grouped by status, filters and a search that reaches into
//                     the log, the people and the institutions, and the two printables
//   /big-ideas/<id>   the idea itself — next step pinned at the top, then the words, the people,
//                     the institutions, the log and the files
//
// The owner's rule for this section: it cannot be buried. So it is a primary top-nav destination
// (chrome.js NAV, between PROJECTS and INBOX), it is in the command palette, and its due next
// steps surface on Today.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { session } from '../state.js';
import { perms } from '../perms.js';
import router from '../router.js';

export const SOURCE = 'Big Ideas (2026-09-15) — Admin Home / Admin People vocabulary, no artboard';

// ---- COPY: every string that may change in a revision -------------------------------------------
export const COPY = {
  title: 'Big Ideas',
  lead: 'The long game: what we are trying to build that will not happen overnight.',
  sub: 'Who we talked to, where they are, what the idea is, and what happens next.',
  add: '+ NEW BIG IDEA',
  portfolio: 'PORTFOLIO BRIEFING (PRINT)',
  csv: 'EXPORT CSV',
  search: 'Search a title, a person, an institution, a meeting…',
  searchHint: 'The search reads the log and the people too, not only the title.',
  filters: { all: 'ALL', area: 'AREA', country: 'COUNTRY', anyArea: 'Any area', anyCountry: 'Any country', clear: 'CLEAR', archived: 'SHOW ARCHIVED' },
  empty: { line: 'No big ideas yet.', why: 'No big ideas yet — the first one is a sentence long.', cta: '+ NEW BIG IDEA' },
  emptyFiltered: { line: 'Nothing matches that.', why: 'Try fewer words, or clear the filters — the search also reads the log and the people.' },
  err: 'Could not load the big ideas.',
  counts: (p, i, l, f) => [
    p === 1 ? '1 person' : p + ' people',
    i === 1 ? '1 institution' : i + ' institutions',
    l === 1 ? '1 log entry' : l + ' log entries',
    f === 1 ? '1 file' : f + ' files'
  ].join(' · '),
  due: {
    none: 'No next step named yet.',
    overdue: n => n === 1 ? '1 day overdue' : n + ' days overdue',
    today: 'due today',
    soon: n => n === 1 ? 'in 1 day' : 'in ' + n + ' days'
  },
  priority: { 1: 'FIRST', 2: 'SOON', 3: 'WHEN IT COMES', label: 'PRIORITY' },
  form: {
    newTitle: 'A NEW BIG IDEA', newSub: 'A title and one line are enough — everything else can come later.',
    title: 'TITLE', thesis: 'THE IDEA IN ONE LINE', area: 'AREA', status: 'STATUS',
    croatian: 'CROATIAN SIDE', international: 'INTERNATIONAL SIDE', countries: 'COUNTRIES', tags: 'TAGS',
    owner: 'OURS', priority: 'PRIORITY', description: 'IN DETAIL',
    nextStep: 'NEXT STEP', due: 'BY WHEN',
    save: 'SAVE', create: 'CREATE', cancel: 'CANCEL', saved: 'SAVED',
    titleFirst: 'A TITLE FIRST — ONE LINE IS ENOUGH',
    placeholderTitle: 'Joint PhD programme — Yale × a Croatian university',
    placeholderThesis: 'One sentence a minister would understand.',
    placeholderCountries: 'Croatia, United States', placeholderTags: 'phd, yale, education',
    placeholderNext: 'Identify the Croatian faculty and a Yale champion',
    unassigned: 'Nobody yet'
  },
  detail: {
    back: '← ALL BIG IDEAS',
    onePager: 'ONE-PAGER (PRINT)',
    overview: 'THE IDEA', people: 'PEOPLE', institutions: 'INSTITUTIONS', log: 'THE LOG', files: 'FILES',
    nextStep: 'NEXT STEP',
    saveOverview: 'SAVE THE IDEA', saveNext: 'SAVE THE NEXT STEP',
    archive: 'ARCHIVE', restore: 'BRING IT BACK', archived: 'ARCHIVED',
    archiveAsk: t => `Archive “${t}”?`,
    archiveBody: 'It leaves the list and keeps everything — people, log, files. You can bring it back any time.',
    archiveOk: 'ARCHIVE', archiveKeep: 'KEEP IT'
  },
  people: {
    add: '+ ADD PERSON', searchPh: 'Search the directory by name or email…',
    free: 'Or write them in by hand',
    name: 'NAME', institution: 'INSTITUTION', role: 'ROLE', email: 'EMAIL', relationship: 'RELATIONSHIP', ours: 'OURS', notes: 'NOTES',
    attach: 'ATTACH', addFree: 'ADD',
    head: { name: 'PERSON', institution: 'INSTITUTION', role: 'ROLE', relationship: 'RELATIONSHIP', ours: 'OURS' },
    profile: 'PROFILE →', remove: 'REMOVE',
    empty: 'Nobody attached yet.', emptyWhy: 'Every big idea starts with one person who cares about it. Add the first.',
    nameFirst: 'A NAME FIRST', added: 'PERSON ADDED', removed: 'PERSON REMOVED',
    noMatches: 'Nobody in the directory matches that — write them in by hand below.'
  },
  inst: {
    add: '+ ADD INSTITUTION', name: 'NAME', country: 'COUNTRY', kind: 'KIND', website: 'WEBSITE', notes: 'NOTES',
    head: { name: 'INSTITUTION', country: 'COUNTRY', kind: 'KIND' }, remove: 'REMOVE',
    empty: 'No institutions named yet.', emptyWhy: 'The university, the hospital, the ministry — whoever has to sign.',
    nameFirst: 'A NAME FIRST', added: 'INSTITUTION ADDED', removed: 'INSTITUTION REMOVED'
  },
  logs: {
    add: '+ LOG SOMETHING', date: 'WHEN', kind: 'WHAT', summary: 'ONE LINE', detail: 'IN DETAIL', save: 'SAVE THE ENTRY',
    empty: 'Nothing logged yet.', emptyWhy: 'The first meeting writes the first line. A year from now this is the only record.',
    summaryFirst: 'ONE LINE ABOUT WHAT HAPPENED', added: 'LOGGED', removed: 'ENTRY REMOVED', remove: 'REMOVE'
  },
  files: {
    add: 'UPLOAD A FILE', hint: 'pdf, docx, pptx, xlsx, png or jpg · up to 20 MB',
    off: 'File storage is not configured on this server yet — everything else on this page works.',
    empty: 'No files yet.', emptyWhy: 'The draft agreement, the slide deck, the letter of intent.',
    download: 'DOWNLOAD', remove: 'REMOVE', uploading: 'UPLOADING…', uploaded: 'FILE UPLOADED', removed: 'FILE REMOVED',
    removeAsk: n => `Remove “${n}” from this idea?`, removeOk: 'REMOVE', removeKeep: 'KEEP IT'
  },
  toast: { created: 'BIG IDEA CREATED', saved: 'SAVED', archived: 'ARCHIVED', restored: 'BACK ON THE LIST', exported: n => `${n} BIG IDEA${n === 1 ? '' : 'S'} EXPORTED` }
};

const SECTION = 'big-ideas';

// ---- the shared inline vocabulary (Admin People / Plexus hub) -----------------------------------
const HAIR = 'rgba(32,27,22,.14)', HAIR12 = 'rgba(32,27,22,.12)', HAIR08 = 'rgba(32,27,22,.08)';
const MICRO = 'font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459';
const MICRO_HEAD = 'font:600 11px Inter,sans-serif;letter-spacing:.15em';
const BTN_GHOST = 'padding:7px 11px;border:1px solid rgba(32,27,22,.2);font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;color:#201b16;white-space:nowrap';
const BTN_CRIMSON = 'padding:9px 14px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap;display:inline-block';
const INPUT2 = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16';
const CRIMSON = '#9b1b22', GOLD = '#c9a962', SOFT = '#6d6459', MUTED = '#9a9086', INK = '#201b16';

// status → the colour of its marker. The book moves left to right; crimson is "live and moving".
const STATUS_TONE = {
  'idea': [GOLD, '#7a6432'], 'exploring': ['#b7791f', '#7a5312'], 'in-talks': [CRIMSON, '#7e151b'],
  'agreed': ['#2f7d4f', '#1e6e42'], 'running': ['#1e6e42', '#14523090'], 'parked': [MUTED, '#6d6459'], 'dropped': ['#c3bcb1', '#9a9086']
};
const PRIORITY_TONE = { 1: CRIMSON, 2: '#b7791f', 3: MUTED };

let D = null, st = null, unbind = null, rootEl = null, onInput = null, onChange = null, searchTimer = null, peopleTimer = null;

function ensureCss() {
  if (document.querySelector('link[data-view-css="big-ideas"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/views/big-ideas.css'; l.setAttribute('data-view-css', 'big-ideas');
  document.head.appendChild(l);
}

// ---------------------------------------------------------------- small builders
const fLab = t => `<span style="${MICRO}">${esc(t)}</span>`;
const fText = (role, label, value, ph, span) =>
  `<label style="display:flex;flex-direction:column;gap:5px;min-width:0${span ? ';grid-column:1 / -1' : ''}">${fLab(label)}<input data-role="${role}" type="text" value="${esc(value == null ? '' : value)}" placeholder="${esc(ph || '')}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;${INPUT2}"></label>`;
const fDate = (role, label, value) =>
  `<label style="display:flex;flex-direction:column;gap:5px;min-width:0">${fLab(label)}<input data-role="${role}" type="date" value="${esc(value || '')}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;${INPUT2}"></label>`;
const fArea = (role, label, value, rows, ph) =>
  `<label style="display:flex;flex-direction:column;gap:5px;min-width:0;grid-column:1 / -1">${fLab(label)}<textarea data-role="${role}" rows="${rows || 4}" placeholder="${esc(ph || '')}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;resize:vertical;${INPUT2}">${esc(value == null ? '' : value)}</textarea></label>`;
const fSelect = (role, label, value, options, span) =>
  `<label style="display:flex;flex-direction:column;gap:5px;min-width:0${span ? ';grid-column:1 / -1' : ''}">${fLab(label)}<select data-role="${role}" aria-label="${esc(label)}" style="width:100%;box-sizing:border-box;${INPUT2}">${options.map(o =>
    `<option value="${esc(o.v)}"${String(o.v) === String(value == null ? '' : value) ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`;
const chip = (text, bg, fg) => `<span style="background:${bg};color:${fg};font:600 8.5px Inter,sans-serif;letter-spacing:.12em;padding:3px 7px;white-space:nowrap">${esc(text)}</span>`;
const act = (a, id, label, extra) => `<span data-act="${a}" data-id="${esc(id)}"${extra || ''} style="${BTN_GHOST}" data-hover="border-color:#201b16">${esc(label)}</span>`;
const emptyState = (line, why, cta) => `<div class="empty" style="padding:30px 20px"><span style="width:28px;height:1px;background:${GOLD}"></span><span class="empty-line">${esc(line)}</span><span class="empty-why">${esc(why)}</span>${cta || ''}</div>`;
const cardHead = (title, right) => `<div class="mxb-cardhead" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid ${HAIR12}"><span style="${MICRO_HEAD}">${esc(title)}</span><div style="flex:1"></div>${right || ''}</div>`;
const avatar = (name) => `<span title="${esc(name || '')}" style="width:24px;height:24px;flex:none;background:${INK};color:#f6f2ea;display:inline-flex;align-items:center;justify-content:center;font:600 10px Fraunces,serif">${esc(fmt.initials(name || '?') || '?')}</span>`;

const statusLabel = (s) => (D && D.status_labels && D.status_labels[s]) || s;
function dueLine(i) {
  if (!i.next_step_due) return '';
  const d = i.days_until;
  if (d == null) return i.next_step_due;
  if (d < 0) return i.next_step_due + ' · ' + COPY.due.overdue(Math.abs(d));
  if (d === 0) return i.next_step_due + ' · ' + COPY.due.today;
  return i.next_step_due + ' · ' + COPY.due.soon(d);
}

// authed download / print — window.open cannot carry the Bearer header (plexus-awards.js note)
async function fetchText(path) {
  const res = await fetch(api.url(path), { headers: { Authorization: 'Bearer ' + session.token } });
  if (!res.ok) { let j = null; try { j = JSON.parse(await res.text()); } catch (e) {} throw new Error((j && (j.message || j.error)) || ('That sheet did not build (HTTP ' + res.status + ').')); }
  return res.text();
}
const dl = (text, mime, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
// The window is opened SYNCHRONOUSLY, inside the click, then filled once the bytes arrive — a
// popup blocker only stops a window opened after an await. Blocked anyway: save the page, it
// prints the same from disk.
async function openPrintable(path, filename) {
  const w = window.open('', '_blank');
  try {
    const html = await fetchText(path);
    if (w && !w.closed) { w.document.open(); w.document.write(html); w.document.close(); return; }
    dl(html, 'text/html', filename);
  } catch (e) { try { if (w && !w.closed) w.close(); } catch (err) {} ui.toast(e.message, { kind: 'error' }); }
}

// ---------------------------------------------------------------- data
const listQuery = () => {
  const p = new URLSearchParams();
  if (st.status) p.set('status', st.status);
  if (st.area) p.set('area', st.area);
  if (st.country.trim()) p.set('country', st.country.trim());
  if (st.q.trim()) p.set('q', st.q.trim());
  if (st.archived) p.set('archived', '1');
  const s = p.toString();
  return s ? '?' + s : '';
};
async function load() {
  if (st.id) {
    const r = await api.settle({ one: api.get('/api/v2/big-ideas/' + encodeURIComponent(st.id)) });
    const d = r.one || {};
    return { mode: 'detail', error: r.$errors.one || null, ...d, ideas: [] };
  }
  const r = await api.settle({ list: api.get('/api/v2/big-ideas' + listQuery()) });
  const d = r.list || {};
  return { mode: 'list', error: r.$errors.list || null, ideas: Array.isArray(d.ideas) ? d.ideas : [], ...d };
}
async function reload() {
  const fresh = await load();
  if (!rootEl) return;
  D = fresh;
  paint();
}

// ---------------------------------------------------------------- LIST
function ideaCard(i) {
  const tone = STATUS_TONE[i.status] || STATUS_TONE.idea;
  const sides = [i.croatian_side, i.international_side].filter(Boolean).join('  ×  ');
  const overdue = i.overdue;
  return `
      <a href="/big-ideas/${esc(i.id)}" class="mxb-card mx-lift" style="display:flex;flex-direction:column;gap:10px;padding:18px 20px;border:1px solid ${HAIR};background:#fff;color:${INK}" data-hover="border-color:#201b16">
        <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="width:8px;height:8px;flex:none;background:${tone[0]}"></span>
          <span style="${MICRO};color:${PRIORITY_TONE[i.priority]}">${COPY.priority[i.priority]}</span>
          ${i.area ? chip(i.area, '#f8f1e2', '#7a6432') : ''}
          <span style="flex:1"></span>
          ${i.owner ? avatar(i.owner.name) : ''}
        </span>
        <span style="font-family:Fraunces,serif;font-size:19px;line-height:1.2">${esc(i.title)}</span>
        ${i.thesis ? `<span style="font-size:12.5px;color:${SOFT};line-height:1.55">${esc(i.thesis)}</span>` : ''}
        ${sides ? `<span style="font-size:11.5px;color:${MUTED}">${esc(sides)}</span>` : ''}
        ${i.next_step ? `<span style="display:flex;gap:8px;align-items:baseline;border-top:1px solid ${HAIR08};padding-top:9px;margin-top:2px">
          <span style="${MICRO};color:${overdue ? CRIMSON : SOFT};white-space:nowrap">NEXT</span>
          <span style="font-size:12.5px;flex:1;min-width:0">${esc(i.next_step)}</span>
        </span>` : ''}
        ${i.next_step_due ? `<span style="${MICRO};color:${overdue ? CRIMSON : MUTED}">${esc(dueLine(i))}</span>` : ''}
        <span style="font-size:11px;color:${MUTED}">${esc(COPY.counts(i.people_count || 0, i.institution_count || 0, i.log_count || 0, i.file_count || 0))}${i.last_activity ? ' · last ' + esc(i.last_activity) : ''}</span>
      </a>`;
}
function statusGroups() {
  const order = (D.statuses || []).filter(s => D.ideas.some(i => i.status === s));
  return order.map(s => {
    const rows = D.ideas.filter(i => i.status === s);
    const tone = STATUS_TONE[s] || STATUS_TONE.idea;
    return `
      <div data-block="group-${esc(s)}" style="display:flex;flex-direction:column;gap:12px">
        <span style="display:flex;align-items:center;gap:9px">
          <span style="width:10px;height:10px;flex:none;background:${tone[0]}"></span>
          <span style="${MICRO_HEAD}">${esc(String(statusLabel(s)).toUpperCase())}</span>
          <span style="${MICRO};color:${MUTED}">${rows.length}</span>
        </span>
        <div class="mxb-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px">${rows.map(ideaCard).join('')}</div>
      </div>`;
  }).join('');
}
function blockFilters() {
  const f = COPY.filters;
  const pill = (label, on, a, id) => `<span data-act="${a}" data-id="${esc(id)}" style="padding:7px 11px;border:1px solid ${on ? INK : 'rgba(32,27,22,.2)'};background:${on ? INK : 'transparent'};color:${on ? '#f6f2ea' : INK};font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${esc(label)}</span>`;
  return `
    <div data-block="filters" style="border:1px solid ${HAIR};background:#fff;padding:14px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="mx-field mxb-search" style="flex:1 1 260px;min-width:0;display:flex;align-items:center;gap:8px;border:1px solid rgba(32,27,22,.18);background:#f6f2ea;padding:8px 12px;box-sizing:border-box">
          <span aria-hidden="true" style="color:${SOFT}">⌕</span>
          <input data-role="search" type="search" value="${esc(st.q)}" placeholder="${esc(COPY.search)}" aria-label="${esc(COPY.search)}" style="border:none;background:transparent;font-size:12.5px;color:${INK};width:100%;padding:0">
        </span>
        <select data-role="area" aria-label="${esc(f.area)}" style="${INPUT2}"><option value="">${esc(f.anyArea)}</option>${(D.areas || []).map(a => `<option value="${esc(a)}"${a === st.area ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <input data-role="country" type="text" value="${esc(st.country)}" placeholder="${esc(f.anyCountry)}" aria-label="${esc(f.country)}" style="${INPUT2};width:150px">
        ${st.status || st.area || st.country || st.q || st.archived ? `<span data-act="clearFilters" style="${BTN_GHOST}" data-hover="border-color:#201b16">${f.clear}</span>` : ''}
      </div>
      <div class="mxb-chips" style="display:flex;gap:7px;flex-wrap:wrap;align-items:center">
        ${pill(f.all, !st.status, 'setStatusFilter', '')}
        ${(D.statuses || []).map(s => pill(String(statusLabel(s)).toUpperCase() + (D.counts && D.counts[s] ? ' ' + D.counts[s] : ''), st.status === s, 'setStatusFilter', s)).join('')}
        <span style="flex:1"></span>
        ${pill(f.archived, st.archived, 'toggleArchived', '')}
      </div>
      <span style="font-size:11px;color:${MUTED}">${esc(COPY.searchHint)}</span>
    </div>`;
}
function blockNewDrawer() {
  if (!st.newOpen) return '<div data-block="newDrawer"></div>';
  const c = COPY.form;
  return `
    <div data-block="newDrawer" id="mxbNew" style="border:1px solid ${HAIR};background:#fff">
      ${cardHead(c.newTitle, `<span style="font-size:11.5px;color:${MUTED}">${esc(c.newSub)}</span><span data-act="newClose" style="${BTN_GHOST};margin-left:10px" data-hover="border-color:#201b16">${c.cancel}</span>`)}
      <div class="mxb-form" style="padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${fText('nTitle', c.title, '', c.placeholderTitle, true)}
        ${fText('nThesis', c.thesis, '', c.placeholderThesis, true)}
        ${fSelect('nArea', c.area, 'Education & training', (D.areas || []).map(a => ({ v: a, t: a })))}
        ${fSelect('nStatus', c.status, 'idea', (D.statuses || []).map(s => ({ v: s, t: statusLabel(s) })))}
        ${fText('nCro', c.croatian, '', '')}
        ${fText('nInt', c.international, '', '')}
        ${fText('nCountries', c.countries, '', c.placeholderCountries)}
        ${fText('nTags', c.tags, '', c.placeholderTags)}
        ${fSelect('nOwner', c.owner, '', [{ v: '', t: c.unassigned }].concat((D.team || []).map(t => ({ v: t.id, t: t.name }))))}
        ${fSelect('nPriority', c.priority, '2', [{ v: '1', t: '1 · ' + COPY.priority[1] }, { v: '2', t: '2 · ' + COPY.priority[2] }, { v: '3', t: '3 · ' + COPY.priority[3] }])}
        ${fText('nNext', c.nextStep, '', c.placeholderNext)}
        ${fDate('nDue', c.due, '')}
        ${fArea('nDesc', c.description, '', 5, '')}
        <span style="grid-column:1 / -1"><span data-act="newSave" style="${BTN_CRIMSON}" data-hover="background:#7e151b">${c.create}</span></span>
      </div>
    </div>`;
}
function listTemplate() {
  const filtered = !!(st.q.trim() || st.status || st.area || st.country.trim());
  const body = D.error
    ? `<div style="border:1px solid ${HAIR};background:#fff;padding:10px 0">${D.error.isLocked ? ui.lockedBlock(perms.label(D.error.section || SECTION)) : `<div style="padding:16px 20px;font-size:12.5px;color:${CRIMSON}">${esc(D.error.message || COPY.err)}</div>`}</div>`
    : D.ideas.length ? `<div style="display:flex;flex-direction:column;gap:28px">${statusGroups()}</div>`
      : `<div style="border:1px solid ${HAIR};background:#fff">${filtered
          ? emptyState(COPY.emptyFiltered.line, COPY.emptyFiltered.why, `<span data-act="clearFilters" style="${BTN_GHOST};margin-top:6px" data-hover="border-color:#201b16">${COPY.filters.clear}</span>`)
          : emptyState(COPY.empty.line, COPY.empty.why, `<span data-act="newOpen" style="${BTN_CRIMSON};margin-top:8px" data-hover="background:#7e151b">${COPY.empty.cta}</span>`)}</div>`;
  return `
<div class="mxpj" data-screen-label="Big Ideas" style="min-height:100vh;background:#f6f2ea;color:${INK};font-family:Inter,sans-serif">
  <div class="mx-gutter mx-stagger" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:20px">
    <div data-block="title" style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
      <span style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0">
        <span style="width:28px;height:1px;background:${GOLD}"></span>
        <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;line-height:1.12">${esc(COPY.title)}</span>
        <span style="font-size:13px;color:${SOFT};line-height:1.55;max-width:600px">${esc(COPY.lead)} ${esc(COPY.sub)}</span>
      </span>
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        <span data-act="portfolio" style="${BTN_GHOST}" data-hover="border-color:#201b16">${COPY.portfolio}</span>
        <span data-act="exportCsv" style="${BTN_GHOST}" data-hover="border-color:#201b16">${COPY.csv}</span>
        <span data-act="newOpen" style="${BTN_CRIMSON}" data-hover="background:#7e151b">${COPY.add}</span>
      </span>
    </div>
    ${blockNewDrawer()}
    ${blockFilters()}
    ${body}
  </div>
</div>`;
}

// ---------------------------------------------------------------- DETAIL
function blockNext(i) {
  const overdue = i.overdue;
  return `
    <div data-block="next" style="border:1px solid ${HAIR};border-left:2px solid ${overdue ? CRIMSON : GOLD};background:#fff">
      ${cardHead(COPY.detail.nextStep, i.next_step_due ? `<span style="${MICRO};color:${overdue ? CRIMSON : MUTED}">${esc(dueLine(i))}</span>` : '')}
      <div class="mxb-form" style="padding:16px 20px;display:grid;grid-template-columns:2.4fr 1fr auto;gap:12px;align-items:end">
        ${fText('dNext', COPY.form.nextStep, i.next_step, COPY.form.placeholderNext)}
        ${fDate('dDue', COPY.form.due, i.next_step_due)}
        <span data-act="saveNext" style="${BTN_CRIMSON}" data-hover="background:#7e151b">${COPY.detail.saveNext}</span>
      </div>
    </div>`;
}
function blockOverview(i) {
  const c = COPY.form;
  return `
    <div data-block="overview" style="border:1px solid ${HAIR};background:#fff">
      ${cardHead(COPY.detail.overview)}
      <div class="mxb-form" style="padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${fText('dTitle', c.title, i.title, c.placeholderTitle, true)}
        ${fText('dThesis', c.thesis, i.thesis, c.placeholderThesis, true)}
        ${fArea('dDesc', c.description, i.description, 8, '')}
        ${fText('dCro', c.croatian, i.croatian_side, '')}
        ${fText('dInt', c.international, i.international_side, '')}
        ${fText('dCountries', c.countries, (i.countries || []).join(', '), c.placeholderCountries)}
        ${fText('dTags', c.tags, (i.tags || []).join(', '), c.placeholderTags)}
        <span style="grid-column:1 / -1"><span data-act="saveOverview" style="${BTN_CRIMSON}" data-hover="background:#7e151b">${COPY.detail.saveOverview}</span></span>
      </div>
    </div>`;
}
function peopleRows() {
  const c = COPY.people;
  if (!D.people.length) return emptyState(c.empty, c.emptyWhy);
  return `
      <div class="mxb-scroll" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:820px">
          <thead><tr>${[c.head.name, c.head.institution, c.head.role, c.head.relationship, c.head.ours, ''].map(h =>
            `<th style="text-align:left;padding:9px 10px;${MICRO};border-bottom:1px solid ${HAIR12};white-space:nowrap">${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${D.people.map(p => `
            <tr data-row="p-${esc(p.id)}">
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top;min-width:180px">
                <span style="display:flex;flex-direction:column;gap:2px;min-width:0">
                  <span style="font-size:13px;font-weight:600">${esc(p.name)}</span>
                  ${p.email ? `<span style="font-size:11px;color:${MUTED}">${esc(p.email)}</span>` : ''}
                </span>
              </td>
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top">${esc(p.institution)}</td>
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top">${esc(p.role)}</td>
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top">${p.relationship ? chip(p.relationship, '#eee9df', '#4a4239') : ''}</td>
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top">${p.our_owner ? esc(p.our_owner.name) : ''}</td>
              <td style="padding:9px 10px;border-bottom:1px solid ${HAIR08};text-align:right;white-space:nowrap">
                ${p.person_ref || p.email ? act('personProfile', p.id, c.profile, ` data-email="${esc(p.email || '')}"`) : ''}
                ${act('personRemove', p.id, c.remove, ` data-name="${esc(p.name)}"`)}
              </td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
}
function peopleAdder() {
  if (!st.personOpen) return '';
  const c = COPY.people;
  const hits = st.personHits;
  return `
      <div style="border-top:1px solid ${HAIR12};padding:16px 20px;display:flex;flex-direction:column;gap:12px;background:#fdfbf6">
        <label style="display:flex;flex-direction:column;gap:5px">${fLab('SEARCH THE DIRECTORY')}
          <input data-role="personSearch" type="search" value="${esc(st.personTerm)}" placeholder="${esc(c.searchPh)}" aria-label="${esc(c.searchPh)}" style="${INPUT2};width:100%;box-sizing:border-box">
        </label>
        ${st.personTerm.trim().length >= 2 ? (hits.length
          ? `<div style="display:flex;flex-direction:column;border:1px solid ${HAIR12};background:#fff;max-height:220px;overflow:auto">${hits.map(h => `
              <span data-act="personPick" data-ref="${esc(h.ref)}" style="display:flex;align-items:baseline;gap:10px;padding:9px 12px;border-bottom:1px solid ${HAIR08};cursor:pointer;font-size:12.5px" data-hover="background:var(--row-hover)">
                <span style="${MICRO};color:${CRIMSON};width:60px;flex:none">${esc(h.kind)}</span>
                <span style="flex:1;min-width:0">${esc(h.name)}${h.institution ? ` <span style="color:${MUTED}">· ${esc(h.institution)}</span>` : ''}</span>
                <span style="${MICRO}">${esc(COPY.people.attach)}</span>
              </span>`).join('')}</div>`
          : `<span style="font-size:12px;color:${SOFT}">${esc(c.noMatches)}</span>`) : ''}
        <span style="${MICRO};border-top:1px solid ${HAIR08};padding-top:12px">${esc(c.free).toUpperCase()}</span>
        <div class="mxb-form" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          ${fText('pName', c.name, st.personDraft.name, '')}
          ${fText('pInst', c.institution, st.personDraft.institution, '')}
          ${fText('pRole', c.role, st.personDraft.role, '')}
          ${fText('pEmail', c.email, st.personDraft.email, '')}
          ${fSelect('pRel', c.relationship, st.personDraft.relationship || 'contact', (D.relationships || []).map(r => ({ v: r, t: r })))}
          ${fSelect('pOwner', c.ours, '', [{ v: '', t: COPY.form.unassigned }].concat((D.team || []).map(t => ({ v: t.id, t: t.name }))))}
          ${fArea('pNotes', c.notes, '', 2, '')}
          <span style="grid-column:1 / -1"><span data-act="personAdd" style="${BTN_CRIMSON}" data-hover="background:#7e151b">${c.addFree}</span></span>
        </div>
      </div>`;
}
function blockPeople() {
  return `
    <div data-block="people" style="border:1px solid ${HAIR};background:#fff">
      ${cardHead(COPY.detail.people + '  ' + D.people.length, `<span data-act="personToggle" style="${BTN_GHOST}" data-hover="border-color:#201b16">${st.personOpen ? COPY.form.cancel : COPY.people.add}</span>`)}
      ${peopleRows()}
      ${peopleAdder()}
    </div>`;
}
function blockInstitutions() {
  const c = COPY.inst;
  const rows = !D.institutions.length ? emptyState(c.empty, c.emptyWhy) : `
      <div class="mxb-scroll" style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:640px">
          <thead><tr>${[c.head.name, c.head.country, c.head.kind, ''].map(h =>
            `<th style="text-align:left;padding:9px 10px;${MICRO};border-bottom:1px solid ${HAIR12};white-space:nowrap">${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${D.institutions.map(n => `
            <tr data-row="i-${esc(n.id)}">
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top">
                <span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:600">${esc(n.name)}</span>
                ${n.website ? `<a href="${esc(n.website)}" target="_blank" rel="noopener" style="font-size:11px;color:${MUTED}">${esc(n.website)}</a>` : ''}</span>
              </td>
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top">${esc(n.country)}</td>
              <td style="font-size:12.5px;padding:9px 10px;border-bottom:1px solid ${HAIR08};vertical-align:top">${n.kind ? chip(n.kind, '#eee9df', '#4a4239') : ''}</td>
              <td style="padding:9px 10px;border-bottom:1px solid ${HAIR08};text-align:right">${act('instRemove', n.id, c.remove, ` data-name="${esc(n.name)}"`)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  const adder = !st.instOpen ? '' : `
      <div class="mxb-form" style="border-top:1px solid ${HAIR12};padding:16px 20px;background:#fdfbf6;display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:12px">
        ${fText('iName', c.name, '', '')}
        ${fText('iCountry', c.country, '', '')}
        ${fSelect('iKind', c.kind, 'university', (D.institution_kinds || []).map(k => ({ v: k, t: k })))}
        ${fText('iWebsite', c.website, '', 'https://')}
        ${fArea('iNotes', c.notes, '', 2, '')}
        <span style="grid-column:1 / -1"><span data-act="instAdd" style="${BTN_CRIMSON}" data-hover="background:#7e151b">${c.add.replace('+ ', '')}</span></span>
      </div>`;
  return `
    <div data-block="institutions" style="border:1px solid ${HAIR};background:#fff">
      ${cardHead(COPY.detail.institutions + '  ' + D.institutions.length, `<span data-act="instToggle" style="${BTN_GHOST}" data-hover="border-color:#201b16">${st.instOpen ? COPY.form.cancel : c.add}</span>`)}
      ${rows}
      ${adder}
    </div>`;
}
function blockLog() {
  const c = COPY.logs;
  const adder = !st.logOpen ? '' : `
      <div class="mxb-form" style="border-bottom:1px solid ${HAIR12};padding:16px 20px;background:#fdfbf6;display:grid;grid-template-columns:150px 170px 1fr;gap:12px">
        ${fDate('lAt', c.date, fmt.ymd(new Date()))}
        ${fSelect('lKind', c.kind, 'meeting', (D.log_kinds || []).map(k => ({ v: k, t: k })))}
        ${fText('lSummary', c.summary, '', '')}
        ${fArea('lDetail', c.detail, '', 3, '')}
        <span style="grid-column:1 / -1"><span data-act="logAdd" style="${BTN_CRIMSON}" data-hover="background:#7e151b">${c.save}</span></span>
      </div>`;
  const rows = !D.log.length ? emptyState(c.empty, c.emptyWhy) : D.log.map(l => `
      <div class="mx-row" data-row="l-${esc(l.id)}" style="display:flex;gap:14px;align-items:baseline;padding:13px 20px;border-bottom:1px solid ${HAIR08}">
        <span style="width:96px;flex:none;display:flex;flex-direction:column;gap:2px">
          <span style="${MICRO};color:${CRIMSON}">${esc(l.at)}</span>
          <span style="font-size:10.5px;color:${MUTED};text-transform:uppercase;letter-spacing:.1em">${esc(l.kind)}</span>
        </span>
        <span class="mx-row-text" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
          <span style="font-size:13px">${esc(l.summary)}</span>
          ${l.detail ? `<span style="font-size:12px;color:${SOFT};line-height:1.55;white-space:pre-wrap">${esc(l.detail)}</span>` : ''}
          ${l.by ? `<span style="font-size:10.5px;color:${MUTED}">${esc(l.by.name)}</span>` : ''}
        </span>
        ${act('logRemove', l.id, c.remove)}
      </div>`).join('');
  return `
    <div data-block="log" style="border:1px solid ${HAIR};background:#fff">
      ${cardHead(COPY.detail.log + '  ' + D.log.length, `<span data-act="logToggle" style="${BTN_GHOST}" data-hover="border-color:#201b16">${st.logOpen ? COPY.form.cancel : c.add}</span>`)}
      ${adder}
      ${rows}
    </div>`;
}
function blockFiles() {
  const c = COPY.files;
  const rows = !D.files.length ? emptyState(c.empty, c.emptyWhy) : D.files.map(f => `
      <div class="mx-row" data-row="f-${esc(f.id)}" style="display:flex;gap:14px;align-items:center;padding:12px 20px;border-bottom:1px solid ${HAIR08}">
        <span class="mx-row-text" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <span style="font-size:13px;overflow-wrap:anywhere">${esc(f.original_name)}</span>
          <span style="font-size:11px;color:${MUTED}">${Math.max(1, Math.round(Number(f.size || 0) / 1024))} KB${f.uploaded_by ? ' · ' + esc(f.uploaded_by) : ''}${f.created_at ? ' · ' + esc(String(f.created_at).slice(0, 10)) : ''}</span>
        </span>
        ${act('fileDownload', f.id, c.download, ` data-name="${esc(f.original_name)}"`)}
        ${act('fileRemove', f.id, c.remove, ` data-name="${esc(f.original_name)}"`)}
      </div>`).join('');
  const head = D.uploads_configured
    ? `<span data-act="filePick" style="${BTN_GHOST}" data-hover="border-color:#201b16">${st.uploading ? c.uploading : c.add}</span>`
    : `<span style="font-size:11.5px;color:${MUTED}">${esc(c.off)}</span>`;
  return `
    <div data-block="files" style="border:1px solid ${HAIR};background:#fff">
      ${cardHead(COPY.detail.files + '  ' + D.files.length, `<span style="font-size:11px;color:${MUTED};margin-right:10px">${esc(c.hint)}</span>${head}`)}
      <input data-role="fileInput" type="file" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" style="display:none" aria-hidden="true" tabindex="-1">
      ${rows}
    </div>`;
}
function detailTemplate() {
  if (D.error) {
    return `
<div class="mxpj" data-screen-label="Big Ideas" style="min-height:100vh;background:#f6f2ea;color:${INK};font-family:Inter,sans-serif">
  <div class="mx-gutter mx-stagger" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px">
    <a href="/big-ideas" style="${MICRO};color:${CRIMSON}">${COPY.detail.back}</a>
    <div style="border:1px solid ${HAIR};background:#fff;margin-top:16px;padding:10px 0">${D.error.isLocked ? ui.lockedBlock(perms.label(D.error.section || SECTION)) : `<div style="padding:16px 20px;font-size:12.5px;color:${CRIMSON}">${esc(D.error.message || COPY.err)}</div>`}</div>
  </div>
</div>`;
  }
  const i = D.idea;
  const tone = STATUS_TONE[i.status] || STATUS_TONE.idea;
  return `
<div class="mxpj" data-screen-label="Big Ideas" style="min-height:100vh;background:#f6f2ea;color:${INK};font-family:Inter,sans-serif">
  <div class="mx-gutter mx-stagger" style="max-width:1180px;margin:0 auto;padding:26px 28px 48px;display:flex;flex-direction:column;gap:18px">
    <a href="/big-ideas" style="${MICRO};color:${CRIMSON}">${COPY.detail.back}</a>
    <div data-block="head" style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      <span style="display:flex;flex-direction:column;gap:8px;flex:1;min-width:0">
        <span style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <span style="width:10px;height:10px;flex:none;background:${tone[0]}"></span>
          ${i.area ? chip(i.area, '#f8f1e2', '#7a6432') : ''}
          ${(i.tags || []).map(t => chip(t, '#eee9df', '#4a4239')).join('')}
          ${i.archived_at ? chip(COPY.detail.archived, '#eee9df', '#9a9086') : ''}
        </span>
        <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;line-height:1.12">${esc(i.title)}</span>
        ${i.thesis ? `<span style="font-family:Fraunces,serif;font-style:italic;font-size:16px;line-height:1.45;color:${SOFT};max-width:660px">${esc(i.thesis)}</span>` : ''}
      </span>
      <span class="mxb-controls" style="display:grid;grid-template-columns:repeat(3,minmax(0,150px));gap:10px;align-items:end">
        ${fSelect('hStatus', COPY.form.status, i.status, (D.statuses || []).map(s => ({ v: s, t: statusLabel(s) })))}
        ${fSelect('hPriority', COPY.priority.label, String(i.priority), [{ v: '1', t: '1 · ' + COPY.priority[1] }, { v: '2', t: '2 · ' + COPY.priority[2] }, { v: '3', t: '3 · ' + COPY.priority[3] }])}
        ${fSelect('hOwner', COPY.form.owner, i.owner_user_id || '', [{ v: '', t: COPY.form.unassigned }].concat((D.team || []).map(t => ({ v: t.id, t: t.name }))))}
      </span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span data-act="onePager" style="${BTN_GHOST}" data-hover="border-color:#201b16">${COPY.detail.onePager}</span>
      <span data-act="${i.archived_at ? 'restore' : 'archive'}" style="${BTN_GHOST}" data-hover="border-color:#201b16">${i.archived_at ? COPY.detail.restore : COPY.detail.archive}</span>
    </div>
    ${blockNext(i)}
    ${blockOverview(i)}
    ${blockPeople()}
    ${blockInstitutions()}
    ${blockLog()}
    ${blockFiles()}
  </div>
</div>`;
}

function template() { return D.mode === 'detail' ? detailTemplate() : listTemplate(); }
function paint() {
  if (!rootEl) return;
  const active = document.activeElement;
  const role = active && active.dataset ? active.dataset.role : null;
  const caret = role && active.selectionStart != null ? active.selectionStart : null;
  rootEl.innerHTML = template();
  if (role) {
    const again = rootEl.querySelector(`[data-role="${role}"]`);
    if (again) { again.focus(); if (caret != null) { try { again.setSelectionRange(caret, caret); } catch (e) {} } }
  }
}

// ---------------------------------------------------------------- field readers
const el = (role) => rootEl && rootEl.querySelector(`[data-role="${role}"]`);
const val = (role) => { const e = el(role); return e ? String(e.value || '').trim() : ''; };
const raw = (role) => { const e = el(role); return e ? String(e.value || '') : ''; };

// ---------------------------------------------------------------- handlers
const handlers = {
  // ---- list
  newOpen: () => { st.newOpen = true; paint(); const n = rootEl.querySelector('#mxbNew'); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
  newClose: () => { st.newOpen = false; paint(); },
  newSave: async (e) => {
    const title = val('nTitle');
    if (!title) { ui.toast(COPY.form.titleFirst); return; }
    e.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/big-ideas', {
        title, thesis: val('nThesis'), description: raw('nDesc'), area: val('nArea'), status: val('nStatus'),
        croatian_side: val('nCro'), international_side: val('nInt'), countries: val('nCountries'), tags: val('nTags'),
        owner_user_id: val('nOwner'), priority: val('nPriority'), next_step: val('nNext'), next_step_due: val('nDue')
      });
      ui.toast(COPY.toast.created);
      st.newOpen = false;
      if (r && r.idea && r.idea.id) { router.navigate('/big-ideas/' + r.idea.id); return; }
      await reload();
    } catch (err) { e.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
  },
  setStatusFilter: async (e) => { st.status = e.dataset.id || ''; await reload(); },
  toggleArchived: async () => { st.archived = !st.archived; await reload(); },
  clearFilters: async () => { st.status = ''; st.area = ''; st.country = ''; st.q = ''; st.archived = false; await reload(); },
  portfolio: () => openPrintable('/api/v2/big-ideas/portfolio', 'medx-big-ideas-portfolio.html'),
  exportCsv: async () => {
    try { const text = await fetchText('/api/v2/big-ideas/export.csv' + listQuery()); dl(text, 'text/csv;charset=utf-8', 'medx-big-ideas.csv'); ui.toast(COPY.toast.exported(D.ideas.length)); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },

  // ---- detail · header + overview + next step
  onePager: () => openPrintable('/api/v2/big-ideas/' + encodeURIComponent(st.id) + '/one-pager', 'medx-big-idea.html'),
  saveOverview: async (e) => {
    const title = val('dTitle');
    if (!title) { ui.toast(COPY.form.titleFirst); return; }
    e.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/v2/big-ideas/' + encodeURIComponent(st.id), {
        title, thesis: val('dThesis'), description: raw('dDesc'),
        croatian_side: val('dCro'), international_side: val('dInt'),
        countries: val('dCountries'), tags: val('dTags')
      });
      ui.toast(COPY.toast.saved); await reload();
    } catch (err) { e.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
  },
  saveNext: async (e) => {
    e.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/v2/big-ideas/' + encodeURIComponent(st.id), { next_step: val('dNext'), next_step_due: val('dDue') }); ui.toast(COPY.toast.saved); await reload(); }
    catch (err) { e.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
  },
  archive: async () => {
    const ok = await ui.confirm({ title: COPY.detail.archiveAsk(D.idea.title), body: `<div style="font-size:13px;line-height:1.6">${esc(COPY.detail.archiveBody)}</div>`, ok: COPY.detail.archiveOk, cancel: COPY.detail.archiveKeep });
    if (!ok) return;
    try { await api.put('/api/v2/big-ideas/' + encodeURIComponent(st.id), { archived: true }); ui.toast(COPY.toast.archived); await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },
  restore: async () => {
    try { await api.put('/api/v2/big-ideas/' + encodeURIComponent(st.id), { archived: false }); ui.toast(COPY.toast.restored); await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },

  // ---- detail · people
  personToggle: () => { st.personOpen = !st.personOpen; st.personTerm = ''; st.personHits = []; paint(); },
  personPick: async (e) => {
    try { await api.post('/api/v2/big-ideas/' + encodeURIComponent(st.id) + '/people', { person_ref: e.dataset.ref, relationship: 'contact' }); ui.toast(COPY.people.added); st.personOpen = false; st.personTerm = ''; st.personHits = []; await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },
  personAdd: async (e) => {
    const name = val('pName');
    if (!name) { ui.toast(COPY.people.nameFirst); return; }
    e.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/big-ideas/' + encodeURIComponent(st.id) + '/people', {
        name, institution: val('pInst'), role: val('pRole'), email: val('pEmail'),
        relationship: val('pRel'), our_owner_user_id: val('pOwner'), notes: raw('pNotes')
      });
      ui.toast(COPY.people.added);
      st.personOpen = false; st.personDraft = { name: '', institution: '', role: '', email: '', relationship: 'contact' };
      await reload();
    } catch (err) { e.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
  },
  personRemove: async (e) => {
    try { await api.del('/api/v2/big-ideas/people/' + encodeURIComponent(e.dataset.id)); ui.toast(COPY.people.removed); await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },
  // the People destination searches by name/email — hand it the person and let it select them
  personProfile: (e) => router.navigate('/people' + (e.dataset.email ? '?q=' + encodeURIComponent(e.dataset.email) : '')),

  // ---- detail · institutions
  instToggle: () => { st.instOpen = !st.instOpen; paint(); },
  instAdd: async (e) => {
    const name = val('iName');
    if (!name) { ui.toast(COPY.inst.nameFirst); return; }
    e.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/big-ideas/' + encodeURIComponent(st.id) + '/institutions', { name, country: val('iCountry'), kind: val('iKind'), website: val('iWebsite'), notes: raw('iNotes') });
      ui.toast(COPY.inst.added); st.instOpen = false; await reload();
    } catch (err) { e.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
  },
  instRemove: async (e) => {
    try { await api.del('/api/v2/big-ideas/institutions/' + encodeURIComponent(e.dataset.id)); ui.toast(COPY.inst.removed); await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },

  // ---- detail · log
  logToggle: () => { st.logOpen = !st.logOpen; paint(); },
  logAdd: async (e) => {
    const summary = val('lSummary');
    if (!summary) { ui.toast(COPY.logs.summaryFirst); return; }
    e.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/v2/big-ideas/' + encodeURIComponent(st.id) + '/log', { at: val('lAt'), kind: val('lKind'), summary, detail: raw('lDetail') });
      ui.toast(COPY.logs.added); st.logOpen = false; await reload();
    } catch (err) { e.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
  },
  logRemove: async (e) => {
    try { await api.del('/api/v2/big-ideas/log/' + encodeURIComponent(e.dataset.id)); ui.toast(COPY.logs.removed); await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },

  // ---- detail · files
  filePick: () => { const f = el('fileInput'); if (f) f.click(); },
  fileDownload: async (e) => {
    try {
      const r = await api.get('/api/v2/big-ideas/files/' + encodeURIComponent(e.dataset.id) + '?json=1');
      if (!r || !r.url) throw new Error('That file has no link.');
      const a = document.createElement('a'); a.href = r.url; a.download = r.name || e.dataset.name || 'file'; a.rel = 'noopener'; a.click();
    } catch (err) { ui.toast(err.message, { kind: 'error' }); }
  },
  fileRemove: async (e) => {
    const ok = await ui.confirm({ title: COPY.files.removeAsk(e.dataset.name || 'this file'), ok: COPY.files.removeOk, cancel: COPY.files.removeKeep });
    if (!ok) return;
    try { await api.del('/api/v2/big-ideas/files/' + encodeURIComponent(e.dataset.id)); ui.toast(COPY.files.removed); await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); }
  }
};

// live typing: the search reaches the server (it reads the log and the people), the directory
// search is its own debounce, and the plain fields keep their value across a repaint.
function onInputEvent(e) {
  const t = e.target;
  if (!t || !t.dataset) return;
  if (t.dataset.role === 'search') {
    st.q = t.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { reload(); }, 300);
    return;
  }
  if (t.dataset.role === 'country') {
    st.country = t.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { reload(); }, 400);
    return;
  }
  if (t.dataset.role === 'personSearch') {
    st.personTerm = t.value;
    clearTimeout(peopleTimer);
    const term = t.value.trim();
    if (term.length < 2) { st.personHits = []; paint(); return; }
    peopleTimer = setTimeout(async () => {
      try { const r = await api.get('/api/v2/big-ideas/people/search?q=' + encodeURIComponent(term)); st.personHits = (r && r.results) || []; }
      catch (err) { st.personHits = []; }
      if (st.personTerm.trim() === term) paint();
    }, 250);
    return;
  }
  if (t.dataset.role === 'pName') st.personDraft.name = t.value;
}
async function onChangeEvent(e) {
  const t = e.target;
  if (!t || !t.dataset) return;
  const role = t.dataset.role;
  if (role === 'area') { st.area = t.value; await reload(); return; }
  if (role === 'fileInput') {
    const file = t.files && t.files[0];
    if (!file) return;
    st.uploading = true; paint();
    try {
      const fd = new FormData(); fd.append('file', file);
      await api.post('/api/v2/big-ideas/' + encodeURIComponent(st.id) + '/files', fd);
      ui.toast(COPY.files.uploaded);
    } catch (err) { ui.toast(err.message, { kind: 'error' }); }
    st.uploading = false;
    await reload();
    return;
  }
  // the three header controls save the moment they change — no SAVE button for a single choice
  const map = { hStatus: 'status', hPriority: 'priority', hOwner: 'owner_user_id' };
  if (map[role]) {
    try { await api.put('/api/v2/big-ideas/' + encodeURIComponent(st.id), { [map[role]]: t.value }); ui.toast(COPY.toast.saved); await reload(); }
    catch (err) { ui.toast(err.message, { kind: 'error' }); await reload(); }
  }
}

export default {
  title: (ctx) => (ctx && ctx.params && ctx.params.id) ? 'Big Ideas' : 'Big Ideas',
  async render(root, ctx) {
    ensureCss();
    rootEl = root;
    const id = (ctx && ctx.params && ctx.params.id) ? String(ctx.params.id) : null;
    st = {
      id, q: '', status: '', area: '', country: '', archived: false,
      newOpen: !!(ctx && ctx.query && ctx.query.new === '1'),
      personOpen: false, personTerm: '', personHits: [], personDraft: { name: '', institution: '', role: '', email: '', relationship: 'contact' },
      instOpen: false, logOpen: false, uploading: false
    };
    D = await load();
    if (rootEl !== root) return;                        // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    onInput = onInputEvent; onChange = onChangeEvent;
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
  },
  destroy() {
    clearTimeout(searchTimer); clearTimeout(peopleTimer);
    if (unbind) unbind();
    if (rootEl && onInput) rootEl.removeEventListener('input', onInput);
    if (rootEl && onChange) rootEl.removeEventListener('change', onChange);
    unbind = null; onInput = null; onChange = null; rootEl = null; D = null; st = null;
  }
};
