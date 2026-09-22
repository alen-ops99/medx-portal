// js/views/speaker-pipeline.js — SPEAKER PIPELINE, potential speakers for 2027 (no artboard; v2 addition 2026-09-22).
// Why (Alen): "potential speakers for 2027 so we don't forget them — name, institution, who they are, why
// relevant, potential event, contacted or not. I meet speakers at events, invite them, and forget."
// A prospect is typed in one line the moment he meets them (quick-add: "Name · Institution", the target
// event, a priority), then lives on a kanban by status — IDEA → TO CONTACT → CONTACTED → IN TALKS →
// CONFIRMED, with DECLINED / PARKED folded away — and a drawer carries everything: who they are, why they
// matter, the log of every call and email (CONTACTED / CALLED / EMAILED stamp the dates), the next step
// (red when due), where he met them (with a door to the NOTES about that person), and PROMOTE — which
// puts a confirmed speaker on the real speakers list of a chosen conference (a button, never automatic).
// Route: /people/speakers (the board) · /people/speakers/<id> (that drawer open) · /speakers alias · ?new=1.
// Data: backend/v2/speaker-pipeline.js — GET/POST /api/v2/speaker-pipeline, PUT /:id, POST /:id/log,
// /:id/archive, /:id/unarchive, /:id/promote, GET /events (picker + conferences), GET /export.csv.
// Visual language: the admin workspace (Inter micro-labels, Fraunces titles, ink/crimson, white cards on
// paper, hairlines) — the same vocabulary as tasks.js; css/views/speaker-pipeline.css carries the board,
// drag states, the drawer and the phone stack (columns become sections, the drawer goes full-screen).
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { session } from '../state.js';

export const SOURCE = 'v2 addition — no artboard (2026-09-22)';

export const COPY = {
  title: 'Speaker pipeline', titleHtml: 'Speakers for <i>2027</i>',
  sub: 'Everyone worth inviting — met at an event, heard on a stage, recommended — so nobody is forgotten between now and the invitations.',
  add: { placeholder: 'Name · Institution', btn: 'ADD', typeFirst: 'TYPE THE NAME FIRST', other: 'OTHER…', otherPh: 'Which event? “Plexus 2028”, “Bridges — Zagreb”…', metAt: 'Met at (optional)', added: n => `${n.toUpperCase()} IS IN THE PIPELINE` },
  filters: { years: 'ALL YEARS', event: 'ALL EVENTS', mine: 'MINE', archived: 'ARCHIVED', search: 'Search names, institutions, who, why, topics…', export: 'EXPORT CSV', exporting: 'EXPORTING…', clear: 'CLEAR' },
  cols: { idea: 'IDEA', to_contact: 'TO CONTACT', contacted: 'CONTACTED', in_talks: 'IN TALKS', confirmed: 'CONFIRMED', declined: 'DECLINED', parked: 'PARKED' },
  parked: { show: (d, p) => `DECLINED · ${d} &nbsp;·&nbsp; PARKED · ${p} — SHOW`, hide: 'HIDE DECLINED & PARKED' },
  card: { noContact: 'NOT CONTACTED', today: 'TODAY', yesterday: 'YESTERDAY', ago: d => `${d}D AGO`, due: d => d, overdue: 'OVERDUE', promoted: 'ON THE LIST' },
  empty: {
    board: { line: 'Nobody in the pipeline yet.', why: 'Type the first name above the moment you meet someone worth inviting — “Name · Institution” is enough, the rest can come later.' },
    idea: 'No ideas waiting.', to_contact: 'Nobody to write to.', contacted: 'No one contacted yet.', in_talks: 'No conversations open.', confirmed: 'No one confirmed yet.', declined: 'No one declined.', parked: 'Nothing parked.', search: 'No one matches that.', archived: 'Nothing archived.'
  },
  drawer: {
    eyebrow: s => `SPEAKER · ${s}`, close: 'Close', archived: 'ARCHIVED',
    status: 'STATUS', quick: { contacted: 'CONTACTED', called: 'CALLED', emailed: 'EMAILED' },
    contactedLine: (who, when) => `Contacted ${when}${who ? ' by ' + who : ''}`, notContacted: 'Not contacted yet', lastTouch: when => `last touch ${when}`,
    title: 'TITLE / ROLE', institution: 'INSTITUTION', country: 'COUNTRY', event: 'TARGET EVENT', year: 'YEAR', priority: 'PRIORITY', owner: 'OWNER',
    who: 'WHO THEY ARE', whoPh: 'Two or three lines — position, what they are known for, why people listen to them.',
    why: 'WHY RELEVANT TO US', whyPh: 'The link to Med&X — the topic, the audience, the door they open.',
    topics: 'TOPICS', topicsPh: 'e.g. sleep, AI in the clinic, health policy',
    next: 'NEXT STEP', nextPh: 'e.g. send the programme draft, follow up after the Gala', nextDue: 'BY',
    metAt: 'MET AT', metAtPh: 'the event or place — “Building Bridges Boston, Sep 2026”', notesLink: n => `NOTES ABOUT ${n.toUpperCase()} →`,
    source: 'SOURCE', sourcePh: 'who recommended them, where the name came from',
    email: 'EMAIL', linkedin: 'LINKEDIN', photo: 'PHOTO URL', notes: 'NOTES', notesPh: 'Anything else — fees, availability, a story to remember them by.',
    promote: 'PROMOTE TO THE SPEAKERS LIST', promoteHint: 'Confirmed — put them on the real speakers list of a conference. Nothing happens until you press it.', promoteBtn: 'PROMOTE', promotePick: 'Pick the conference',
    promoted: (conf, when) => `On the speakers list${conf ? ' of ' + conf : ''} · ${when}`,
    log: 'LOG', logPh: 'A note — what was said, what they asked for…', post: 'POST', kinds: { note: 'NOTE', email: 'EMAIL', call: 'CALL', status: 'STATUS' },
    archive: 'ARCHIVE', unarchive: 'BRING BACK', createdBy: (who, when) => `${who ? who + ' · ' : ''}${when}`, missing: 'That speaker is not in the pipeline any more.',
    priorities: [[1, '1 · Must have'], [2, '2 · Strong'], [3, '3 · Maybe']]
  },
  toast: {
    moved: s => ({ idea: 'BACK TO IDEAS', to_contact: 'ON THE TO-CONTACT LIST', contacted: 'MARKED CONTACTED', in_talks: 'IN TALKS', confirmed: 'CONFIRMED — PROMOTE THEM WHEN READY', declined: 'DECLINED — FOLDED AWAY', parked: 'PARKED — FOLDED AWAY' }[s] || 'MOVED'),
    saved: 'SAVED', logged: k => ({ email: 'EMAIL LOGGED', call: 'CALL LOGGED', note: 'NOTE POSTED' }[k] || 'LOGGED'), logEmpty: 'WRITE THE NOTE FIRST',
    archived: 'ARCHIVED — FIND THEM UNDER ARCHIVED', unarchived: 'BACK IN THE PIPELINE', promoted: conf => `ON THE SPEAKERS LIST OF ${String(conf || '').toUpperCase()}`, promotedAlready: 'ALREADY ON THAT LIST',
    exported: n => `${n} ROW${n === 1 ? '' : 'S'} EXPORTED`, exportFailed: 'THE EXPORT DID NOT COME THROUGH'
  }
};

const STATUSES = ['idea', 'to_contact', 'contacted', 'in_talks', 'confirmed', 'declined', 'parked'];
const OPEN_COLS = ['idea', 'to_contact', 'contacted', 'in_talks', 'confirmed'];
const FOLDED_COLS = ['declined', 'parked'];
const STATUS_LABEL = { idea: 'IDEA', to_contact: 'TO CONTACT', contacted: 'CONTACTED', in_talks: 'IN TALKS', confirmed: 'CONFIRMED', declined: 'DECLINED', parked: 'PARKED' };
const PRI = { 1: '#9b1b22', 2: '#c9a962', 3: '#cfc7b8' };
const EV_TINT = { plexus: ['#f7e3e4', '#7e151b'], gala: ['#f8f1e2', '#7a6432'], bridges: ['#e8eef7', '#2c4a73'], forum: ['#e4efe7', '#22563a'], accelerator: ['#efe9f5', '#4d3a6b'], custom: ['#eee9df', '#4a4239'] };
const POLL_MS = 60000;
const MAX_ADD_CHIPS = 6;

let D = null, st = null, unbind = null, unlisten = null, rootEl = null, reqId = 0, detailSeq = 0, poll = null;

function loadCss() {
  if (!document.getElementById('mx-css-speakers')) {
    const l = document.createElement('link'); l.id = 'mx-css-speakers'; l.rel = 'stylesheet'; l.href = '/css/views/speaker-pipeline.css'; document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
function listQuery() {
  const p = new URLSearchParams();
  if (st.filter.archived) p.set('archived', '1');
  if (st.filter.year) p.set('year', st.filter.year);
  if (st.filter.event) p.set('target_event', st.filter.event);
  if (st.filter.priority) p.set('priority', st.filter.priority);
  if (st.filter.mine) p.set('mine', '1');
  if (st.q.trim()) p.set('q', st.q.trim());
  const s = p.toString();
  return '/api/v2/speaker-pipeline' + (s ? '?' + s : '');
}
async function load(full) {
  const my = ++reqId;
  const calls = { list: api.get(listQuery()) };
  if (full || !D) calls.events = api.get('/api/v2/speaker-pipeline/events');
  const r = await api.settle(calls);
  if (my !== reqId) return false;
  if (r.$errors.list) throw r.$errors.list;
  D = D || { events: [], conferences: [] };
  D.prospects = Array.isArray(r.list.prospects) ? r.list.prospects : []; D.people = Array.isArray(r.list.people) ? r.list.people : []; D.me = r.list.me || {};
  if (Array.isArray(r.list.events)) D.events = r.list.events;
  if (r.events) { if (Array.isArray(r.events.events)) D.events = r.events.events; if (Array.isArray(r.events.conferences)) D.conferences = r.events.conferences; }
  return true;
}
async function loadDetail(id) {
  const my = ++detailSeq;
  try {
    const r = await api.get('/api/v2/speaker-pipeline/' + encodeURIComponent(id));
    if (!st || my !== detailSeq || st.open !== id) return false;
    st.detail = { prospect: r.prospect, log: Array.isArray(r.log) ? r.log : [] };
    const i = D.prospects.findIndex(p => p.id === id); if (i >= 0) D.prospects[i] = Object.assign({}, D.prospects[i], r.prospect);
    return true;
  } catch (e) {
    if (!st) return false;
    if (e && e.status === 404) { ui.toast(COPY.drawer.missing, { kind: 'error' }); closeDrawer(); }
    else ui.toast(e.message, { kind: 'error' });
    return false;
  }
}
const eventOf = key => (D.events || []).find(e => e.key === key) || null;
const kindOfEvent = key => { const e = eventOf(key); if (e) return e.kind; return /^bridges-/.test(String(key || '')) ? 'bridges' : 'custom'; };
const labelOfEvent = (key, fallback) => { const e = eventOf(key); if (e) return e.label; if (fallback) return fallback; const m = /^bridges-(.+)$/.exec(String(key || '')); return m ? 'Building Bridges — ' + m[1].split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : String(key || ''); };
const tint = key => EV_TINT[kindOfEvent(key)] || EV_TINT.custom;
const todayYmd = () => fmt.ymd(new Date());

// ---------------------------------------------------------------- labels
function agoLabel(v) {
  const d = fmt.toDate(v); if (!d) return '';
  const n = fmt.daysSince(d);
  if (n == null) return '';
  if (n <= 0) return COPY.card.today;
  if (n === 1) return COPY.card.yesterday;
  if (n < 30) return COPY.card.ago(n);
  return fmt.dayLabel(d) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}
function whenLabel(v) {
  const d = fmt.toDate(v); if (!d) return '';
  const same = fmt.ymd(d) === todayYmd();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return same ? 'Today ' + hm : fmt.dayShort(d) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '') + ' ' + hm;
}
function dueMeta(p) {
  if (!p.next_step_due) return null;
  const diff = fmt.daysUntil(p.next_step_due); if (diff == null) return null;
  const live = OPEN_COLS.includes(p.status);
  if (live && diff < 0) return { text: fmt.dayLabel(p.next_step_due) + ' · ' + COPY.card.overdue, red: true };
  if (live && diff === 0) return { text: COPY.card.today, red: true };
  return { text: fmt.dayLabel(p.next_step_due), red: false };
}
const priDot = (p, size) => `<span class="mx-spk-pri" title="Priority ${p}" style="width:${size || 7}px;height:${size || 7}px;background:${PRI[p] || PRI[2]}"></span>`;
const evChip = (key, label) => { const t = tint(key); return `<span class="mx-spk-ev" style="background:${t[0]};color:${t[1]}">${esc(labelOfEvent(key, label)).toUpperCase()}</span>`; };

// ---------------------------------------------------------------- blocks
function blockTitle() {
  const n = D.prospects.length;
  return `
  <div data-block="title" class="mx-spk-title">
    <div>
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.titleHtml}</span>
      <div style="font-size:12.5px;color:#6d6459;margin-top:4px;max-width:640px;line-height:1.5">${COPY.sub}</div>
    </div>
    <div style="flex:1"></div>
    <span data-act="export" role="button" class="mx-spk-export" aria-disabled="${st.exporting}" title="Every prospect in the current view, as a spreadsheet">${st.exporting ? COPY.filters.exporting : COPY.filters.export}${n ? ` · ${n}` : ''}</span>
  </div>`;
}
function addChips() {
  const evs = D.events || [];
  const pick = [];
  ['plexus-2027', 'gala-2027'].forEach(k => { const e = evs.find(x => x.key === k); if (e) pick.push(e); });
  evs.filter(e => e.kind === 'bridges').slice(0, 2).forEach(e => pick.push(e));
  ['forum', 'accelerator'].forEach(k => { const e = evs.find(x => x.key === k); if (e) pick.push(e); });
  const shown = pick.slice(0, MAX_ADD_CHIPS);
  if (st.addEvent && st.addEvent !== '__other' && !shown.some(e => e.key === st.addEvent)) { const e = eventOf(st.addEvent); shown.push(e || { key: st.addEvent, label: labelOfEvent(st.addEvent) }); }
  const chip = (k, label, on) => `<span data-act="addEvent" data-k="${esc(k)}" role="button" aria-pressed="${on}" class="mx-chip${on ? ' on' : ''}">${esc(label)}</span>`;
  return `<div class="mx-spk-add-events">
      ${shown.map(e => chip(e.key, e.label, st.addEvent === e.key)).join('')}
      ${chip('__other', COPY.add.other, st.addEvent === '__other')}
      ${st.addEvent === '__other' ? `<input data-role="addOther" class="mx-in mx-spk-add-other" value="${esc(st.addOther)}" placeholder="${esc(COPY.add.otherPh)}" aria-label="Target event" maxlength="120" autocomplete="off">` : ''}
    </div>`;
}
function blockAdd() {
  return `
  <div data-block="add" class="mx-spk-add">
    <div class="mx-spk-add-row">
      <input data-role="addName" class="mx-in mx-spk-add-name" value="${esc(st.addName)}" placeholder="${esc(COPY.add.placeholder)}" aria-label="New speaker — name and institution" maxlength="300" autocomplete="off">
      <span class="mx-spk-add-pri" role="radiogroup" aria-label="Priority">${[1, 2, 3].map(p => `<span data-act="addPri" data-p="${p}" role="radio" aria-checked="${st.addPri === p}" class="mx-spk-pribtn${st.addPri === p ? ' on' : ''}" title="Priority ${p}">${priDot(p, 8)}<span>${p}</span></span>`).join('')}</span>
      <span data-act="add" role="button" class="mx-spk-add-btn" data-hover="background:#7e151b">${COPY.add.btn}</span>
    </div>
    ${addChips()}
  </div>`;
}
function blockFilters() {
  const f = st.filter;
  const years = Array.from(new Set((D.prospects || []).map(p => p.target_year).concat([2027]))).filter(Boolean).sort();
  const chipBtn = (act, k, label, on, extra) => `<span data-act="${act}" data-k="${esc(k)}" role="button" aria-pressed="${on}" class="mx-chip${on ? ' on' : ''}"${extra || ''}>${label}</span>`;
  const evs = (D.events || []);
  return `
  <div data-block="filters" class="mx-spk-filters">
    ${chipBtn('year', '', COPY.filters.years, !f.year)}${years.map(y => chipBtn('year', String(y), String(y), String(f.year) === String(y))).join('')}
    <select data-role="fEvent" class="mx-in mx-spk-fsel" aria-label="Target event">
      <option value=""${!f.event ? ' selected' : ''}>${COPY.filters.event}</option>
      ${evs.map(e => `<option value="${esc(e.key)}"${f.event === e.key ? ' selected' : ''}>${esc(e.label)}</option>`).join('')}
    </select>
    <span class="mx-spk-fpri" aria-label="Priority">${[1, 2, 3].map(p => `<span data-act="pri" data-k="${p}" role="button" aria-pressed="${String(f.priority) === String(p)}" class="mx-spk-pribtn${String(f.priority) === String(p) ? ' on' : ''}" title="Priority ${p}">${priDot(p, 8)}<span>${p}</span></span>`).join('')}</span>
    ${chipBtn('mine', '', COPY.filters.mine, f.mine)}
    ${chipBtn('archived', '', COPY.filters.archived, f.archived)}
    <div style="flex:1"></div>
    <span class="mx-spk-search"><span style="color:#6d6459">⌕</span><input data-role="search" class="mx-in" value="${esc(st.q)}" placeholder="${esc(COPY.filters.search)}" aria-label="Search the pipeline" autocomplete="off"></span>
  </div>`;
}
function card(p) {
  const due = dueMeta(p);
  const touch = p.last_touch_at && p.contacted_at ? agoLabel(p.last_touch_at) : '';
  return `
      <div class="mx-spk-card${st.open === p.id ? ' open' : ''}" data-act="open" data-id="${esc(p.id)}" data-card="${esc(p.id)}" draggable="true" role="button" aria-label="${esc(p.name)}">
        <div class="mx-spk-card-head">${priDot(p.priority)}<span class="mx-spk-name">${esc(p.name)}</span>${p.promoted_speaker_id ? `<span class="mx-spk-tag" title="${esc(COPY.card.promoted)}">★</span>` : ''}</div>
        ${p.institution ? `<div class="mx-spk-inst">${esc(p.institution)}${p.country ? ` <i>· ${esc(p.country)}</i>` : ''}</div>` : ''}
        <div class="mx-spk-card-meta">
          ${p.target_event ? evChip(p.target_event, p.target_event_label) : ''}
          <span class="mx-spk-touch${p.contacted_at ? '' : ' none'}">${touch || (p.contacted_at ? '' : COPY.card.noContact)}</span>
          ${p.log_count ? `<span class="mx-spk-count" title="${p.log_count} log entr${p.log_count === 1 ? 'y' : 'ies'}">${p.log_count}</span>` : ''}
        </div>
        ${p.next_step ? `<div class="mx-spk-next${due && due.red ? ' due' : ''}"><span class="arrow">→</span><span class="txt">${esc(p.next_step)}</span>${due ? `<span class="when">${esc(due.text)}</span>` : ''}</div>` : ''}
      </div>`;
}
function column(status, rows) {
  const emptyLine = st.filter.archived ? COPY.empty.archived : (st.q.trim() ? COPY.empty.search : COPY.empty[status]);
  const hot = status === 'confirmed' && rows.length;
  return `
    <div class="mx-spk-col" data-col="${status}">
      <div class="mx-spk-col-head">
        <span class="lbl" style="color:${hot ? '#1e6e42' : status === 'to_contact' && rows.length ? '#9b1b22' : '#201b16'}">${COPY.cols[status]}</span>
        <span class="n" style="background:${hot ? '#1e6e42' : '#201b16'}">${rows.length}</span>
      </div>
      <div class="mx-spk-col-body" data-drop="${status}">
        ${rows.map(card).join('')}
        ${!rows.length ? `<div class="mx-spk-col-empty">${emptyLine}</div>` : ''}
      </div>
    </div>`;
}
function sortRows(rows) {
  const key = p => String(p.priority || 2) + '|' + (p.next_step_due || '9999') + '|' + String(99999999999999 - (fmt.toDate(p.last_touch_at || p.updated_at || p.created_at) || new Date(0)).getTime()).padStart(14, '0');
  return rows.slice().sort((a, b) => key(a).localeCompare(key(b)));
}
function blockBoard() {
  const by = {}; STATUSES.forEach(s => { by[s] = []; });
  for (const p of D.prospects) (by[p.status] || by.idea).push(p);
  const total = D.prospects.length;
  const folded = by.declined.length + by.parked.length;
  return `
  <div data-block="board" class="mx-spk-boardwrap">
    <div class="mx-spk-board">
      ${OPEN_COLS.map(s => column(s, sortRows(by[s]))).join('')}
    </div>
    <div class="mx-spk-folded${st.showFolded ? ' open' : ''}">
      <span data-act="toggleFolded" role="button" aria-expanded="${st.showFolded}" class="mx-spk-folded-btn">${st.showFolded ? COPY.parked.hide : COPY.parked.show(by.declined.length, by.parked.length)}</span>
      ${st.showFolded ? `<div class="mx-spk-board folded">${FOLDED_COLS.map(s => column(s, sortRows(by[s]))).join('')}</div>` : (folded ? '' : '')}
    </div>
    ${!total && !st.q.trim() && !st.filter.archived && !st.filter.event && !st.filter.year && !st.filter.priority && !st.filter.mine ? `<div class="empty" style="padding:26px 20px 30px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.empty.board.line}</span><span class="empty-why">${COPY.empty.board.why}</span></div>` : ''}
  </div>`;
}

// ---- the drawer ----
function statusChips(p) {
  return `<div class="mx-spk-statuses" role="radiogroup" aria-label="${COPY.drawer.status}">
    ${STATUSES.map(s => `<span data-act="status" data-s="${s}" role="radio" aria-checked="${p.status === s}" class="mx-spk-st${p.status === s ? ' on' : ''}${s === 'confirmed' ? ' good' : ''}${FOLDED_COLS.includes(s) ? ' dim' : ''}">${STATUS_LABEL[s]}</span>`).join('')}
  </div>`;
}
function logEntry(l) {
  const k = COPY.drawer.kinds[l.kind] || l.kind.toUpperCase();
  const isStatus = l.kind === 'status';
  return `<div class="mx-spk-log-row${isStatus ? ' sys' : ''}">
      <span class="k ${esc(l.kind)}">${k}</span>
      <div class="body">
        ${l.body ? `<div class="txt">${esc(l.body)}</div>` : ''}
        <div class="meta">${esc((l.author_name || '').split(/\s+/)[0])}${l.author_name ? ' · ' : ''}${esc(whenLabel(l.created_at))}</div>
      </div>
    </div>`;
}
function promoteBlock(p) {
  const b = COPY.drawer;
  if (p.promoted_speaker_id) {
    const conf = (D.conferences || []).find(c => c.id === st.promoteConf) || null;
    return `<div class="mx-spk-promote done"><span class="lbl">★ ${esc(b.promoted(conf ? conf.name : '', fmt.dayShort(p.promoted_at) || ''))}</span></div>`;
  }
  if (p.status !== 'confirmed') return '';
  const confs = D.conferences || [];
  return `<div class="mx-spk-promote">
      <div><span class="lbl">${b.promote}</span><span class="hint">${b.promoteHint}</span></div>
      <div class="row">
        <select data-role="promoteConf" class="mx-in" aria-label="${esc(b.promotePick)}">
          <option value=""${!st.promoteConf ? ' selected' : ''}>${esc(b.promotePick)}</option>
          ${confs.map(c => `<option value="${esc(c.id)}"${st.promoteConf === c.id ? ' selected' : ''}>${esc(c.name)}${c.year ? ' · ' + c.year : ''}</option>`).join('')}
        </select>
        <span data-act="promote" role="button" class="mx-spk-btn primary">${b.promoteBtn}</span>
      </div>
    </div>`;
}
function drawer() {
  if (!st.open) return '';
  const d = st.detail;
  const p = d ? d.prospect : (D.prospects.find(x => x.id === st.open) || null);
  if (!p) return `<div class="mx-drawer mx-spk-drawer" data-block="drawer"><div class="mx-drawer-sheet"><div style="padding:24px;font-size:12.5px;color:#6d6459">Loading…</div></div></div>`;
  const b = COPY.drawer;
  const logRows = d ? d.log.slice().reverse() : [];
  const people = D.people || [];
  const evs = D.events || [];
  const evKnown = !p.target_event || evs.some(e => e.key === p.target_event);
  const contacted = p.contacted_at ? b.contactedLine(p.contacted_by ? String(p.contacted_by).split(/\s+/)[0] : '', fmt.dayShort(p.contacted_at) + (fmt.toDate(p.contacted_at) && fmt.toDate(p.contacted_at).getFullYear() !== new Date().getFullYear() ? ' ' + fmt.toDate(p.contacted_at).getFullYear() : '')) : b.notContacted;
  const touch = p.last_touch_at ? b.lastTouch(agoLabel(p.last_touch_at).toLowerCase()) : '';
  const notesHref = '/notes?person=' + encodeURIComponent(p.name);
  return `
  <div class="mx-drawer mx-spk-drawer" data-block="drawer" role="dialog" aria-label="${esc(p.name)}">
    <div class="mx-drawer-sheet">
      <div class="mx-spk-dhead">
        <span class="eyebrow" style="color:${p.status === 'confirmed' ? '#1e6e42' : '#6d6459'}">${b.eyebrow(STATUS_LABEL[p.status] || p.status)}</span>
        ${p.archived_at ? `<span class="mx-spk-archived">${b.archived}</span>` : ''}
        <div style="flex:1"></div>
        <span data-act="close" role="button" aria-label="${b.close}" class="mx-spk-close" data-hover="color:#201b16">×</span>
      </div>
      <div class="mx-spk-dbody">
        <div class="mx-spk-dname">${priDot(p.priority, 9)}<textarea data-role="name" data-save="name" rows="1" aria-label="Name" class="mx-spk-namein">${esc(p.name)}</textarea></div>
        ${statusChips(p)}
        <div class="mx-spk-quick">
          <span data-act="quickContacted" role="button" class="mx-spk-btn${p.status === 'idea' || p.status === 'to_contact' ? ' primary' : ''}">${b.quick.contacted}</span>
          <span data-act="quickCall" role="button" class="mx-spk-btn">${b.quick.called}</span>
          <span data-act="quickEmail" role="button" class="mx-spk-btn">${b.quick.emailed}</span>
          <span class="mx-spk-contactline">${esc(contacted)}${touch ? ` <i>· ${esc(touch)}</i>` : ''}</span>
        </div>

        <div class="mx-spk-grid three">
          <label><span class="lbl">${b.title}</span><input data-role="title" data-save="title" class="mx-in" value="${esc(p.title)}" placeholder="Professor of…" aria-label="${b.title}"></label>
          <label><span class="lbl">${b.institution}</span><input data-role="institution" data-save="institution" class="mx-in" value="${esc(p.institution)}" aria-label="${b.institution}"></label>
          <label><span class="lbl">${b.country}</span><input data-role="country" data-save="country" class="mx-in" value="${esc(p.country)}" aria-label="${b.country}"></label>
        </div>
        <div class="mx-spk-grid four">
          <label><span class="lbl">${b.event}</span>
            <select data-role="event" data-save="target_event" class="mx-in" aria-label="${b.event}">
              <option value=""${!p.target_event ? ' selected' : ''}>—</option>
              ${evs.map(e => `<option value="${esc(e.key)}"${p.target_event === e.key ? ' selected' : ''}>${esc(e.label)}</option>`).join('')}
              ${!evKnown ? `<option value="${esc(p.target_event)}" selected>${esc(p.target_event)}</option>` : ''}
              <option value="__other">${COPY.add.other}</option>
            </select>
            ${st.eventOther ? `<input data-role="eventOther" class="mx-in" style="margin-top:6px" value="" placeholder="${esc(COPY.add.otherPh)}" aria-label="Other event" maxlength="120">` : ''}
          </label>
          <label><span class="lbl">${b.year}</span><input data-role="year" data-save="target_year" class="mx-in" type="number" min="2026" max="2100" value="${esc(p.target_year)}" aria-label="${b.year}"></label>
          <label><span class="lbl">${b.priority}</span>
            <select data-role="priority" data-save="priority" class="mx-in" aria-label="${b.priority}">${b.priorities.map(([k, l]) => `<option value="${k}"${p.priority === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label><span class="lbl">${b.owner}</span>
            <select data-role="owner" data-save="owner_id" class="mx-in" aria-label="${b.owner}">
              <option value=""${!p.owner_id ? ' selected' : ''}>—</option>
              ${people.map(u => `<option value="${esc(u.id)}"${p.owner_id === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
            </select></label>
        </div>

        <label class="mx-spk-field"><span class="lbl">${b.who}</span><textarea data-role="who" data-save="who" rows="3" class="mx-in" placeholder="${esc(b.whoPh)}" aria-label="${b.who}">${esc(p.who)}</textarea></label>
        <label class="mx-spk-field accent"><span class="lbl">${b.why}</span><textarea data-role="why" data-save="why" rows="3" class="mx-in" placeholder="${esc(b.whyPh)}" aria-label="${b.why}">${esc(p.why)}</textarea></label>
        <label class="mx-spk-field"><span class="lbl">${b.topics}</span><input data-role="topics" data-save="topics" class="mx-in" value="${esc(p.topics)}" placeholder="${esc(b.topicsPh)}" aria-label="${b.topics}"></label>

        <div class="mx-spk-next-box${dueMeta(p) && dueMeta(p).red ? ' due' : ''}">
          <label class="grow"><span class="lbl">${b.next}</span><input data-role="next" data-save="next_step" class="mx-in" value="${esc(p.next_step)}" placeholder="${esc(b.nextPh)}" aria-label="${b.next}"></label>
          <label><span class="lbl">${b.nextDue}</span><input data-role="nextDue" data-save="next_step_due" type="date" class="mx-in" value="${esc(p.next_step_due || '')}" aria-label="${b.nextDue}"></label>
        </div>

        <div class="mx-spk-grid two">
          <label><span class="lbl">${b.metAt}</span><input data-role="metAt" data-save="met_at" class="mx-in" value="${esc(p.met_at)}" placeholder="${esc(b.metAtPh)}" aria-label="${b.metAt}"><a href="${esc(notesHref)}" class="mx-spk-noteslink">${esc(b.notesLink(p.name))}</a></label>
          <label><span class="lbl">${b.source}</span><input data-role="source" data-save="source" class="mx-in" value="${esc(p.source)}" placeholder="${esc(b.sourcePh)}" aria-label="${b.source}"></label>
        </div>
        <div class="mx-spk-grid three">
          <label><span class="lbl">${b.email}</span><input data-role="email" data-save="email" type="email" class="mx-in" value="${esc(p.email)}" aria-label="${b.email}"></label>
          <label><span class="lbl">${b.linkedin}</span><input data-role="linkedin" data-save="linkedin_url" inputmode="url" class="mx-in" value="${esc(p.linkedin_url)}" placeholder="https://linkedin.com/in/…" aria-label="${b.linkedin}"></label>
          <label><span class="lbl">${b.photo}</span><input data-role="photo" data-save="photo_url" inputmode="url" class="mx-in" value="${esc(p.photo_url)}" placeholder="https://…" aria-label="${b.photo}"></label>
        </div>
        <label class="mx-spk-field"><span class="lbl">${b.notes}</span><textarea data-role="notes" data-save="notes" rows="3" class="mx-in" placeholder="${esc(b.notesPh)}" aria-label="${b.notes}">${esc(p.notes)}</textarea></label>

        ${promoteBlock(p)}

        <div class="mx-spk-log">
          <span class="lbl">${b.log}${logRows.length ? ' · ' + logRows.length : ''}</span>
          <div class="mx-spk-log-add">
            <textarea data-role="logBody" rows="2" class="mx-in" placeholder="${esc(b.logPh)}" aria-label="${b.log}">${esc(st.logDraft)}</textarea>
            <span data-act="logNote" role="button" class="mx-spk-btn ink">${b.post}</span>
          </div>
          <div class="mx-spk-log-list">${logRows.map(logEntry).join('')}</div>
        </div>

        <div class="mx-spk-dfoot">
          <span data-act="${p.archived_at ? 'unarchive' : 'archive'}" role="button" class="mx-spk-link">${p.archived_at ? b.unarchive : b.archive}</span>
          <div style="flex:1"></div>
          <span class="mx-spk-created">${esc(b.createdBy(p.owner_first || '', whenLabel(p.created_at)))}</span>
        </div>
      </div>
    </div>
  </div>`;
}
function template() {
  return `
<div data-screen-label="Admin Speaker pipeline" class="mx-spk">
  <div class="mx-gutter">
    ${blockTitle()}
    ${blockAdd()}
    ${blockFilters()}
    ${blockBoard()}
  </div>
  ${drawer()}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function rerenderBoard() { rerender('[data-block="board"]', blockBoard()); }
function rerenderTitle() { rerender('[data-block="title"]', blockTitle()); }
function rerenderDrawer() {
  const host = rootEl && rootEl.querySelector('.mx-spk'); if (!host) return;
  const cur = host.querySelector('[data-block="drawer"]');
  const html = drawer();
  if (cur) { if (html) cur.outerHTML = html; else cur.remove(); }
  else if (html) host.insertAdjacentHTML('beforeend', html);
  document.body.classList.toggle('mx-drawer-open', !!st.open);
  const ta = rootEl.querySelector('[data-role="name"]'); if (ta) autosize(ta);
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
async function refetch() {
  if (!(await load()) || !rootEl) return;
  rerenderBoard(); rerenderTitle();
}
const basePath = () => (location.pathname.indexOf('/speakers') === 0 ? '/speakers' : '/people/speakers');
function setUrl(id) { try { history.replaceState(history.state, '', id ? basePath() + '/' + encodeURIComponent(id) : basePath()); } catch (e) {} }
async function openDrawer(id) {
  st.open = id; st.detail = null; st.logDraft = ''; st.eventOther = false; st.promoteConf = st.promoteConf || ((D.conferences || [])[0] || {}).id || '';
  setUrl(id);
  rerenderBoard(); rerenderDrawer();
  if (await loadDetail(id)) { rerenderDrawer(); rerenderBoard(); }
}
function closeDrawer() { st.open = null; st.detail = null; setUrl(null); rerenderDrawer(); rerenderBoard(); }
function patchLocal(p) {
  const i = D.prospects.findIndex(x => x.id === p.id);
  if (i >= 0) D.prospects[i] = Object.assign({}, D.prospects[i], p); else D.prospects.unshift(p);
  if (st.detail && st.detail.prospect.id === p.id) st.detail.prospect = Object.assign({}, st.detail.prospect, p);
}
async function setStatus(id, status) {
  const p = D.prospects.find(x => x.id === id) || (st.detail && st.detail.prospect.id === id ? st.detail.prospect : null);
  if (!p || p.status === status) return;
  const prev = p.status;
  patchLocal(Object.assign({}, p, { status }));
  if (FOLDED_COLS.includes(status)) st.showFolded = true;
  rerenderBoard(); if (st.open === id) rerenderDrawer();
  try {
    const r = await api.put('/api/v2/speaker-pipeline/' + encodeURIComponent(id), { status });
    if (r && r.prospect) patchLocal(r.prospect);
    if (st.open === id) await loadDetail(id);
    rerenderBoard(); if (st.open === id) rerenderDrawer();
    ui.toast(COPY.toast.moved(status));
  } catch (e) { patchLocal(Object.assign({}, p, { status: prev })); rerenderBoard(); if (st.open === id) rerenderDrawer(); ui.toast(e.message, { kind: 'error' }); }
}
async function saveField(field, value) {
  if (!st.open || !st.detail) return;
  const p = st.detail.prospect;
  const cur = field === 'next_step_due' ? (p.next_step_due || '') : field === 'owner_id' ? (p.owner_id || '') : String(p[field] == null ? '' : p[field]);
  if (String(value) === cur) return;
  if (field === 'name' && !String(value).trim()) { ui.toast(COPY.add.typeFirst); return; }
  try {
    const r = await api.put('/api/v2/speaker-pipeline/' + encodeURIComponent(p.id), { [field]: value });
    if (r && r.prospect) patchLocal(r.prospect);
    ui.toast(COPY.toast.saved);
    await loadDetail(p.id);
    if (field === 'target_event') await load(true);   // a new free-text event joins the picker
    rerenderBoard(); rerenderTitle();
    const active = document.activeElement; const keep = active && active.matches && active.matches('[data-save]') ? active.dataset.role : null;
    rerenderDrawer();
    if (keep) { const el = rootEl.querySelector(`[data-role="${keep}"]`); if (el && el.focus) el.focus(); }
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function addLog(kind, body) {
  const id = st.open; if (!id) return;
  try {
    const r = await api.post('/api/v2/speaker-pipeline/' + encodeURIComponent(id) + '/log', { kind, body: body || undefined });
    if (r && r.prospect) patchLocal(r.prospect);
    if (r && st.detail && st.detail.prospect.id === id) st.detail.log = Array.isArray(r.log) ? r.log : st.detail.log;
    st.logDraft = '';
    ui.toast(COPY.toast.logged(kind));
    rerenderBoard(); rerenderDrawer();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
// "Name · Institution" (or "Name, Institution" / "Name - Institution") → the two fields
function splitAdd(s) {
  const raw = String(s || '').trim();
  const m = /^(.+?)\s*(?:·|—|–|\s-\s|,)\s*(.+)$/.exec(raw);
  return m ? { name: m[1].trim(), institution: m[2].trim() } : { name: raw, institution: '' };
}
function readAdd() {
  const v = role => { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value : ''; };
  st.addName = v('addName'); if (st.addEvent === '__other') st.addOther = v('addOther');
}
async function exportCsv() {
  if (st.exporting) return;
  st.exporting = true; rerenderTitle();
  try {
    const url = api.url(listQuery().replace('/api/v2/speaker-pipeline', '/api/v2/speaker-pipeline/export.csv'));
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + session.token, Accept: 'text/csv' }, credentials: 'omit' });
    if (!res.ok) throw new Error(COPY.toast.exportFailed);
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `speaker-pipeline-${todayYmd()}.csv`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    ui.toast(COPY.toast.exported(D.prospects.length));
  } catch (e) { ui.toast(e.message || COPY.toast.exportFailed, { kind: 'error' }); }
  st.exporting = false; rerenderTitle();
}

const handlers = {
  add: async (el) => {
    readAdd();
    const { name, institution } = splitAdd(st.addName);
    if (!name) { ui.toast(COPY.add.typeFirst); const i = rootEl.querySelector('[data-role="addName"]'); if (i) i.focus(); return; }
    const target_event = st.addEvent === '__other' ? (st.addOther.trim() || null) : st.addEvent;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/speaker-pipeline', { name, institution: institution || undefined, target_event: target_event === null ? '' : target_event, priority: st.addPri });
      st.addName = ''; if (st.addEvent === '__other') { st.addOther = ''; }
      ui.toast(COPY.add.added(name));
      // the new card must be visible: clear a filter that would hide it (MINE keeps it — the creator owns it)
      st.filter.archived = false;
      if (st.filter.event && r.prospect && r.prospect.target_event !== st.filter.event) st.filter.event = '';
      if (st.filter.priority && String(st.filter.priority) !== String(st.addPri)) st.filter.priority = '';
      if (st.filter.year && r.prospect && String(r.prospect.target_year) !== String(st.filter.year)) st.filter.year = '';
      st.q = '';
      await load(true);
      rerenderBoard(); rerenderTitle();
      rerender('[data-block="filters"]', blockFilters());
      rerender('[data-block="add"]', blockAdd());
      const i = rootEl.querySelector('[data-role="addName"]'); if (i) i.focus();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  addEvent: (el) => { readAdd(); st.addEvent = el.dataset.k; rerender('[data-block="add"]', blockAdd()); if (st.addEvent === '__other') { const i = rootEl.querySelector('[data-role="addOther"]'); if (i) i.focus(); } },
  addPri: (el) => { readAdd(); st.addPri = Number(el.dataset.p); rerender('[data-block="add"]', blockAdd()); },
  year: async (el) => { st.filter.year = el.dataset.k; rerender('[data-block="filters"]', blockFilters()); await refetch(); },
  pri: async (el) => { st.filter.priority = String(st.filter.priority) === el.dataset.k ? '' : el.dataset.k; rerender('[data-block="filters"]', blockFilters()); await refetch(); },
  mine: async () => { st.filter.mine = !st.filter.mine; rerender('[data-block="filters"]', blockFilters()); await refetch(); },
  archived: async () => { st.filter.archived = !st.filter.archived; rerender('[data-block="filters"]', blockFilters()); await refetch(); },
  export: () => exportCsv(),
  toggleFolded: () => { st.showFolded = !st.showFolded; rerenderBoard(); },
  open: (el) => { const id = el.dataset.id; if (st.open === id) return; openDrawer(id); },
  close: () => closeDrawer(),
  status: (el) => setStatus(st.open, el.dataset.s),
  quickContacted: () => setStatus(st.open, 'contacted'),
  quickCall: () => addLog('call'),
  quickEmail: () => addLog('email'),
  logNote: async (el) => {
    const ta = rootEl.querySelector('[data-role="logBody"]'); const body = String(ta ? ta.value : '').trim();
    if (!body) { ui.toast(COPY.toast.logEmpty); if (ta) ta.focus(); return; }
    el.setAttribute('aria-disabled', 'true');
    await addLog('note', body);
    el.removeAttribute('aria-disabled');
  },
  promote: async (el) => {
    const sel = rootEl.querySelector('[data-role="promoteConf"]'); const conference_id = sel ? sel.value : '';
    if (!conference_id) { ui.toast(COPY.drawer.promotePick.toUpperCase()); if (sel) sel.focus(); return; }
    const conf = (D.conferences || []).find(c => c.id === conference_id);
    const ok = await ui.confirm({ eyebrow: 'PROMOTE', title: `Put ${esc(st.detail.prospect.name)} on the speakers list?`, body: `They will appear among the speakers of <b>${esc(conf ? conf.name : '')}</b> with their name, title, institution, bio and email from this card. This is done once.`, ok: 'PROMOTE', cancel: 'NOT YET' });
    if (!ok) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/speaker-pipeline/' + encodeURIComponent(st.open) + '/promote', { conference_id });
      st.promoteConf = conference_id;
      if (r && r.prospect) patchLocal(r.prospect);
      ui.toast(r && r.already ? COPY.toast.promotedAlready : COPY.toast.promoted(conf ? conf.name : ''));
      await loadDetail(st.open); rerenderBoard(); rerenderDrawer();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  archive: async () => {
    const id = st.open;
    try { await api.post('/api/v2/speaker-pipeline/' + encodeURIComponent(id) + '/archive'); ui.toast(COPY.toast.archived); closeDrawer(); await refetch(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  unarchive: async () => {
    const id = st.open;
    try { await api.post('/api/v2/speaker-pipeline/' + encodeURIComponent(id) + '/unarchive'); ui.toast(COPY.toast.unarchived); closeDrawer(); await refetch(); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

// keyboard + change + drag listeners on the view root (they survive every innerHTML swap)
function bindRootListeners(root) {
  let qTimer = null;
  const onInput = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="search"]')) { st.q = t.value; clearTimeout(qTimer); qTimer = setTimeout(() => refetch(), 220); return; }
    if (t.matches('[data-role="name"]')) autosize(t);
    if (t.matches('[data-role="addName"]')) st.addName = t.value;
    if (t.matches('[data-role="addOther"]')) st.addOther = t.value;
    if (t.matches('[data-role="logBody"]')) st.logDraft = t.value;
  };
  const onChange = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="fEvent"]')) { st.filter.event = t.value; refetch(); return; }
    if (t.matches('[data-role="event"]')) {
      if (t.value === '__other') { st.eventOther = true; rerenderDrawer(); const i = root.querySelector('[data-role="eventOther"]'); if (i) i.focus(); return; }
      st.eventOther = false; saveField('target_event', t.value); return;
    }
    if (t.matches('[data-role="promoteConf"]')) { st.promoteConf = t.value; return; }
    if (t.matches('select[data-save], input[type="date"][data-save], input[type="number"][data-save]')) saveField(t.dataset.save, t.value);
  };
  const onBlur = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="eventOther"]')) { const v = t.value.trim(); st.eventOther = false; if (v) saveField('target_event', v); else rerenderDrawer(); return; }
    if (t.matches('textarea[data-save], input[data-save]:not([type="date"]):not([type="number"])')) saveField(t.dataset.save, t.value);
  };
  const onKey = e => {
    const t = e.target;
    if (e.key === 'Escape' && st.open) { if (t && t.matches && t.matches('[data-save]')) t.blur(); closeDrawer(); return; }
    if (e.key === 'Enter' && t && t.matches) {
      if (t.matches('[data-role="addName"], [data-role="addOther"]')) { e.preventDefault(); const b = root.querySelector('[data-act="add"]'); if (b) handlers.add(b); }
      else if (t.matches('[data-role="name"]')) { e.preventDefault(); t.blur(); }
      else if (t.matches('[data-role="eventOther"]')) { e.preventDefault(); t.blur(); }
      else if ((e.metaKey || e.ctrlKey) && t.matches('[data-role="logBody"]')) { e.preventDefault(); const b = root.querySelector('[data-act="logNote"]'); if (b) handlers.logNote(b); }
      else if ((e.metaKey || e.ctrlKey) && t.matches('textarea[data-save]')) { e.preventDefault(); t.blur(); }
      else if (t.matches('input[data-save]')) { e.preventDefault(); t.blur(); }
    }
  };
  // HTML5 drag-and-drop between columns (phones use the drawer's status chips)
  const onDragStart = e => {
    const c = e.target.closest && e.target.closest('.mx-spk-card'); if (!c) return;
    st.dragging = c.dataset.card; c.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', st.dragging); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
  };
  const onDragEnd = () => { st.dragging = null; root.querySelectorAll('.mx-spk-card.dragging').forEach(c => c.classList.remove('dragging')); root.querySelectorAll('.mx-spk-col.over').forEach(c => c.classList.remove('over')); };
  const onDragOver = e => {
    const col = e.target.closest && e.target.closest('.mx-spk-col');
    if (st.dragging && col) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) {} root.querySelectorAll('.mx-spk-col.over').forEach(c => { if (c !== col) c.classList.remove('over'); }); col.classList.add('over'); }
  };
  const onDragLeave = e => { const col = e.target.closest && e.target.closest('.mx-spk-col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); };
  const onDrop = e => {
    const col = e.target.closest && e.target.closest('.mx-spk-col');
    if (st.dragging && col) { e.preventDefault(); const id = st.dragging; const status = col.dataset.col; onDragEnd(); if (STATUSES.includes(status)) setStatus(id, status); }
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('keydown', onKey);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragend', onDragEnd);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
  return () => {
    clearTimeout(qTimer);
    root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('focusout', onBlur); root.removeEventListener('keydown', onKey);
    root.removeEventListener('dragstart', onDragStart); root.removeEventListener('dragend', onDragEnd); root.removeEventListener('dragover', onDragOver); root.removeEventListener('dragleave', onDragLeave); root.removeEventListener('drop', onDrop);
  };
}

export default {
  title: 'Speaker pipeline',
  async render(root, ctx) {
    rootEl = root; loadCss();
    st = { filter: { year: '', event: '', priority: '', mine: false, archived: false }, q: '', open: null, detail: null, addName: '', addEvent: 'plexus-2027', addOther: '', addPri: 2, logDraft: '', eventOther: false, promoteConf: '', showFolded: false, exporting: false, dragging: null };
    D = null;
    try { await load(true); } catch (e) { root.innerHTML = `<div class="empty" style="padding:60px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">The pipeline did not load.</span><span class="empty-why">${esc(e.message)}</span></div>`; return; }
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    unlisten = bindRootListeners(root);
    if (ctx.params && ctx.params.id) openDrawer(ctx.params.id);
    if (ctx.query && ctx.query.new === '1') { const i = root.querySelector('[data-role="addName"]'); if (i) i.focus(); }
    // the other person's moves arrive on their own — a quiet refresh while nothing is being dragged or typed
    poll = setInterval(() => {
      if (document.hidden || st.dragging) return;
      const a = document.activeElement; if (a && a.matches && a.matches('input, textarea, select') && rootEl && rootEl.contains(a)) return;
      refetch();
    }, POLL_MS);
  },
  destroy() {
    reqId++; detailSeq++; if (poll) clearInterval(poll); poll = null;
    if (unbind) unbind(); if (unlisten) unlisten(); unbind = null; unlisten = null;
    document.body.classList.remove('mx-drawer-open');
    rootEl = null; D = null; st = null;
  }
};
