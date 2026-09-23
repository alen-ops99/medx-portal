// js/views/notes.js — NOTES, shared event & day notes (no artboard; v2 addition 2026-09-22).
// Why: at an event Alen meets people and dictates to Laura over WhatsApp — who he met, what was
// agreed, what to follow up — and it gets lost in the chat. Here a note is written in ONE tap on a
// phone (the composer at the top: what happened, which event, who was met, a photo), and read
// afterwards on a desktop: the stream by day, one event as one page (with EXPORT → a printable
// document), one person across events. Route: /notes (stream + composer) · /notes/<id> (that note
// highlighted) · /notes?event=<key> (the event page) · /notes?person=<name> · ?pinned=1 · ?day=1 · ?archived=1.
// Data: backend/v2/notes.js — GET/POST /api/v2/notes, PUT /:id, POST /:id/pin|unpin|archive|unarchive,
// /:id/people, /:id/files, GET /events (the picker), /people, /summary, /export (signed link).
// Visual language: the admin workspace (Inter micro-labels, Fraunces titles, ink/crimson, white cards
// on paper, hairlines) — the same vocabulary as tasks.js; css/views/notes.css carries the layout,
// the phone stack (rail → chip strip, 44px targets, 16px inputs so iOS never zooms) and print-free bits.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';

export const SOURCE = 'v2 addition — no artboard (2026-09-22)';

export const COPY = {
  title: 'Notes', titleHtml: 'What <i>happened</i>',
  sub: 'Who you met, what was agreed, what to follow up — per event or per day. Written in a tap, read afterwards.',
  composer: {
    placeholder: 'What happened? Who did you meet?', title: 'Title (optional)', date: 'Date',
    dayNote: 'NO EVENT · DAY NOTE', other: 'OTHER EVENT…', customPh: 'Name the event — “Coffee with Dean X” is fine', todayTag: 'TODAY',
    person: 'Who did you meet? Name, Enter', personHint: 'name · institution', attach: 'ATTACH', attachHint: 'photo · PDF · any file · 25 MB',
    save: 'SAVE NOTE', saving: 'SAVING…', typeFirst: 'WRITE THE NOTE FIRST', nameEvent: 'NAME THE EVENT — OR PICK “NO EVENT”',
    saved: 'SAVED', savedWithFiles: n => `SAVED · ${n} FILE${n === 1 ? '' : 'S'} ATTACHED`
  },
  rail: {
    search: 'Search notes or people', all: 'ALL NOTES', pinned: 'PINNED', day: 'DAY NOTES', archived: 'ARCHIVED',
    events: 'EVENTS', people: 'PEOPLE', morePeople: n => `ALL ${n} PEOPLE`, fewerPeople: 'FEWER', noEvents: 'No event has notes yet.', noPeople: 'No one tagged yet.'
  },
  stream: {
    today: 'TODAY', yesterday: 'YESTERDAY', dayNote: 'DAY NOTE', pinned: 'PINNED', more: 'MORE', less: 'LESS',
    pin: 'PIN', unpin: 'UNPIN', edit: 'EDIT', done: 'DONE', archive: 'ARCHIVE', unarchive: 'BRING BACK', remove: 'DELETE', addPerson: 'Add a person — name, Enter', attach: 'ATTACH A FILE',
    byAt: (who, when) => `${who ? who + ' · ' : ''}${when}`, files: n => `${n} file${n === 1 ? '' : 's'}`
  },
  event: { eyebrow: 'EVENT', back: '← ALL NOTES', export: 'EXPORT', exportTitle: 'A clean page of these notes — print it or save as PDF', people: n => `PEOPLE MET · ${n}`, notes: n => `${n} note${n === 1 ? '' : 's'}`, none: 'No notes for this event yet — write the first one above.' },
  person: { eyebrow: 'PERSON', back: '← ALL NOTES', notes: n => `${n} note${n === 1 ? '' : 's'}` },
  empty: {
    stream: { line: 'Nothing written yet.', why: 'Type what happened in the box above — one tap and it is here for both of you, forever findable.' },
    filter: { line: 'Nothing here.', why: 'No note matches this view — try ALL NOTES or clear the search.' },
    archived: { line: 'Nothing archived.', why: 'Archived notes wait here; BRING BACK puts one on the stream again.' }
  },
  toast: {
    saved: 'SAVED', pinned: 'PINNED — IT STAYS ON TOP', unpinned: 'UNPINNED', archived: 'ARCHIVED', unarchived: 'BACK ON THE STREAM', deleted: 'DELETED',
    personAdded: who => `${who.toUpperCase()} TAGGED`, personRemoved: 'UNTAGGED', personEmpty: 'TYPE THE NAME FIRST',
    uploading: 'UPLOADING…', uploaded: n => `${n.toUpperCase()} ATTACHED`, fileRemoved: 'FILE REMOVED', tooBig: 'THAT FILE IS OVER 25 MB — SHARE A LINK TO IT INSTEAD',
    missing: 'That note is not here any more.'
  },
  confirm: { del: { title: 'Delete this note?', body: 'The note, its people and its files go with it. Archiving keeps everything and just tucks it away — that is usually the better door.', ok: 'DELETE', cancel: 'KEEP' } }
};

const POLL_MS = 60000;
const COLLAPSE_CHARS = 420, COLLAPSE_LINES = 7;
const MAX_CHIPS = 6;
const ACCEPT = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.vcf,.md';
const KIND_TINT = { bridges: ['#e8eef7', '#2c4a73'], conference: ['#f7e3e4', '#7e151b'], gala: ['#f8f1e2', '#7a6432'], meetup: ['#e4efe7', '#22563a'], custom: ['#eee9df', '#4a4239'], day: ['#f1ede4', '#6d6459'] };

let D = null, st = null, unbind = null, unlisten = null, rootEl = null, reqId = 0, poll = null;

function loadCss() {
  if (!document.getElementById('mx-css-notes')) {
    const l = document.createElement('link'); l.id = 'mx-css-notes'; l.rel = 'stylesheet'; l.href = '/css/views/notes.css'; document.head.appendChild(l);
  }
}
const todayYmd = () => fmt.ymd(new Date());

// ---------------------------------------------------------------- data
function listQuery() {
  const p = new URLSearchParams(); p.set('today', todayYmd());
  const f = st.filter;
  if (f.kind === 'pinned') p.set('pinned', '1');
  else if (f.kind === 'day') p.set('scope', 'day');
  else if (f.kind === 'archived') p.set('archived', '1');
  else if (f.kind === 'event' && f.event) { p.set('event', f.event); p.set('order', 'asc'); }
  else if (f.kind === 'person' && f.person) p.set('person', f.person);
  if (st.q.trim()) p.set('q', st.q.trim());
  return '/api/v2/notes?' + p.toString();
}
async function load(full) {
  const my = ++reqId;
  const calls = { notes: api.get(listQuery()) };
  if (full || !D) { calls.events = api.get('/api/v2/notes/events?today=' + todayYmd()); calls.people = api.get('/api/v2/notes/people'); }
  const r = await api.settle(calls);
  if (my !== reqId) return false;
  if (r.$errors.notes) throw r.$errors.notes;
  D = D || { events: [], people: [] };
  D.notes = Array.isArray(r.notes.notes) ? r.notes.notes : []; D.me = r.notes.me || {}; D.today = r.notes.today || todayYmd();
  if (r.events && Array.isArray(r.events.events)) D.events = r.events.events;
  if (r.people && Array.isArray(r.people.people)) D.people = r.people.people;
  return true;
}
const eventOf = key => (D.events || []).find(e => e.key === key) || null;
const todaysEvents = () => (D.events || []).filter(e => e.today);
const tint = kind => KIND_TINT[kind] || KIND_TINT.custom;
const kindOfKey = key => String(key || '').split(':')[0];

// ---------------------------------------------------------------- blocks
function blockTitle() {
  return `
  <div data-block="title" style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
    <div>
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.titleHtml}</span>
      <div style="font-size:13px;color:#6d6459;margin-top:4px;max-width:640px;line-height:1.5">${COPY.sub}</div>
    </div>
  </div>`;
}
function composerChips() {
  const c = st.composer;
  const today = todaysEvents();
  // after today's: the events nearest in time either way (yesterday's Boston before December's
  // Gala) — dated ones by distance from today, undated ones last, the picker order as tie-break
  const dist = e => { if (!e.date) return 1e9; const a = fmt.daysUntil(e.date), b = fmt.daysUntil(e.end_date || e.date); return a != null && b != null && a <= 0 && b >= 0 ? 0 : Math.min(Math.abs(a == null ? 1e9 : a), Math.abs(b == null ? 1e9 : b)); };
  const rest = (D.events || []).map((e, i) => ({ e, i })).filter(x => !x.e.today).sort((x, y) => dist(x.e) - dist(y.e) || x.i - y.i).map(x => x.e);
  const shown = today.concat(rest.slice(0, Math.max(0, MAX_CHIPS - today.length)));
  if (c.eventKey && c.eventKey !== '__custom' && !shown.some(e => e.key === c.eventKey)) { const sel = eventOf(c.eventKey); if (sel) shown.push(sel); }
  const chip = (k, label, on, extra) => `<span data-act="cEvent" data-k="${esc(k)}" role="button" aria-pressed="${on}" class="mx-chip${on ? ' on' : ''}${extra || ''}">${label}</span>`;
  return `<div class="mx-nc-events" data-role="cEvents">
      ${shown.map(e => chip(e.key, `${e.today ? `<b class="mx-chip-today">${COPY.composer.todayTag}</b>` : ''}${esc(e.label)}`, c.eventKey === e.key, e.today ? ' today' : '')).join('')}
      ${chip('', COPY.composer.dayNote, c.eventKey === '')}
      ${chip('__custom', COPY.composer.other, c.eventKey === '__custom')}
    </div>
    ${c.eventKey === '__custom' ? `<input data-role="cCustom" class="mx-in" value="${esc(c.customLabel)}" placeholder="${esc(COPY.composer.customPh)}" aria-label="Event name" maxlength="160" autocomplete="off">` : ''}`;
}
function personChip(p, act, extra) {
  return `<span class="mx-person">${esc(p.name)}${p.institution ? `<i> · ${esc(p.institution)}</i>` : ''}${act ? `<span data-act="${act}" ${extra || ''} role="button" aria-label="Remove ${esc(p.name)}" class="mx-x">×</span>` : ''}</span>`;
}
function blockComposer() {
  const c = st.composer; const k = COPY.composer;
  return `
  <div data-block="composer" class="mx-nc">
    <textarea data-role="cBody" rows="3" placeholder="${esc(k.placeholder)}" aria-label="${esc(k.placeholder)}" class="mx-nc-body">${esc(c.body)}</textarea>
    ${composerChips()}
    <div class="mx-nc-row">
      <label class="mx-nc-date"><span>${k.date.toUpperCase()}</span><input data-role="cDate" type="date" value="${esc(c.date)}" aria-label="${k.date}" class="mx-in"></label>
      <input data-role="cTitle" class="mx-in" value="${esc(c.title)}" placeholder="${esc(k.title)}" aria-label="${k.title}" maxlength="200">
    </div>
    <div class="mx-nc-people" data-role="cPeople">
      ${c.people.map((p, i) => personChip(p, 'cRmPerson', `data-i="${i}"`)).join('')}
      <input data-role="cPerson" class="mx-in mx-nc-person" value="${esc(c.personDraft)}" placeholder="${esc(c.people.length ? k.personHint : k.person)}" aria-label="${esc(k.person)}" maxlength="200" autocomplete="off" enterkeyhint="done">
    </div>
    <div class="mx-nc-foot">
      <label class="mx-nc-attach" data-hover="border-color:#201b16"><span class="mx-btn-ink">${k.attach}</span><span class="mx-hint">${c.files.length ? '' : k.attachHint}</span><input data-role="cFile" type="file" multiple accept="${ACCEPT}" aria-label="${k.attach}"></label>
      ${c.files.map((f, i) => `<span class="mx-file-chip">${esc(f.name.length > 28 ? f.name.slice(0, 26) + '…' : f.name)}<span data-act="cRmFile" data-i="${i}" role="button" aria-label="Remove ${esc(f.name)}" class="mx-x">×</span></span>`).join('')}
      <div style="flex:1"></div>
      <span data-act="save" role="button" class="mx-nc-save"${c.saving ? ' aria-disabled="true"' : ''} data-hover="background:#7e151b">${c.saving ? k.saving : k.save}</span>
    </div>
  </div>`;
}
function blockRail() {
  const r = COPY.rail; const f = st.filter;
  const item = (act, attrs, label, count, on) => `<span data-act="${act}" ${attrs} role="button" aria-pressed="${!!on}" class="mx-nr-item${on ? ' on' : ''}"><span class="mx-nr-label">${label}</span>${count != null ? `<b>${count}</b>` : ''}</span>`;
  const events = (D.events || []).filter(e => e.count > 0 || e.today || (f.kind === 'event' && f.event === e.key));
  const people = D.people || [];
  const shownPeople = st.allPeople ? people : people.slice(0, 8);
  return `
  <aside data-block="rail" class="mx-nr">
    <div class="mx-nr-search"><span class="mx-nr-glass">⌕</span><input data-role="search" value="${esc(st.q)}" placeholder="${esc(r.search)}" aria-label="Search notes" autocomplete="off" class="mx-in"></div>
    <div class="mx-nr-group">
      ${item('filter', 'data-k="all"', r.all, null, f.kind === 'all')}
      ${item('filter', 'data-k="pinned"', r.pinned, null, f.kind === 'pinned')}
      ${item('filter', 'data-k="day"', r.day, null, f.kind === 'day')}
    </div>
    <div class="mx-nr-group">
      <span class="mx-nr-h">${r.events}</span>
      ${events.map(e => item('filterEvent', `data-k="${esc(e.key)}"`, `${e.today ? '<b class="mx-chip-today">' + COPY.composer.todayTag + '</b>' : ''}${esc(e.label)}`, e.count, f.kind === 'event' && f.event === e.key)).join('')}
      ${!events.length ? `<span class="mx-nr-none">${r.noEvents}</span>` : ''}
    </div>
    <div class="mx-nr-group">
      <span class="mx-nr-h">${r.people}</span>
      ${shownPeople.map(p => item('filterPerson', `data-name="${esc(p.name)}"`, esc(p.name), p.count, f.kind === 'person' && f.person === p.name)).join('')}
      ${!people.length ? `<span class="mx-nr-none">${r.noPeople}</span>` : ''}
      ${people.length > 8 ? `<span data-act="allPeople" role="button" class="mx-nr-more">${st.allPeople ? r.fewerPeople : r.morePeople(people.length)}</span>` : ''}
    </div>
    <div class="mx-nr-group">
      ${item('filter', 'data-k="archived"', r.archived, null, f.kind === 'archived')}
    </div>
  </aside>`;
}
function whenHm(v) { const d = fmt.toDate(v); return d ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : ''; }
function dayHeading(ymd) {
  const d = fmt.toDate(ymd); if (!d) return ymd;
  const diff = fmt.daysUntil(ymd);
  const long = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  if (diff === 0) return `<b>${COPY.stream.today}</b><span>${esc(long)}</span>`;
  if (diff === -1) return `<b>${COPY.stream.yesterday}</b><span>${esc(long)}</span>`;
  return `<span>${esc(long)}</span>`;
}
function isLong(body) { const s = String(body || ''); return s.length > COLLAPSE_CHARS || s.split('\n').length > COLLAPSE_LINES; }
function fileBlock(n, editing) {
  const files = n.files || []; if (!files.length && !editing) return '';
  const imgs = files.filter(f => f.is_image), docs = files.filter(f => !f.is_image);
  return `<div class="mx-note-files">
      ${imgs.length ? `<div class="mx-note-thumbs">${imgs.map(f => `<a href="${esc(api.url(f.url))}" target="_blank" rel="noopener" class="mx-thumb" title="${esc(f.name)}"><img src="${esc(api.url(f.view_url))}" alt="${esc(f.name)}" loading="lazy">${editing ? `<span data-act="rmFile" data-id="${esc(f.id)}" role="button" aria-label="Remove ${esc(f.name)}" class="mx-x">×</span>` : ''}</a>`).join('')}</div>` : ''}
      ${docs.map(f => `<div class="mx-note-doc"><span style="display:inline-flex;color:#6d6459"><svg class="mx-ico" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;vertical-align:-1px"><path d="M13.5 7.5 8.2 12.8a3.5 3.5 0 0 1-5-5l5.6-5.6a2.3 2.3 0 0 1 3.3 3.3L6.5 11.1a1.2 1.2 0 0 1-1.7-1.7L10 4.2"/></svg></span><a href="${esc(api.url(f.url))}" target="_blank" rel="noopener" title="${esc(f.name)}">${esc(f.name)}</a><span class="mx-hint">${sizeLabel(f.size)}</span>${editing ? `<span data-act="rmFile" data-id="${esc(f.id)}" role="button" class="mx-x" aria-label="Remove ${esc(f.name)}">×</span>` : ''}</div>`).join('')}
      ${editing ? `<label class="mx-nc-attach small" data-hover="border-color:#201b16"><span class="mx-btn-ink">${COPY.stream.attach}</span><input data-role="eFile" data-id="${esc(n.id)}" type="file" multiple accept="${ACCEPT}" aria-label="${COPY.stream.attach}"></label>` : ''}
    </div>`;
}
function sizeLabel(n) { n = Number(n || 0); return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
function noteCard(n) {
  const s = COPY.stream; const editing = st.editing === n.id; const open = st.expanded.has(n.id);
  const kind = n.event_key ? kindOfKey(n.event_key) : 'day'; const [bg, fg] = tint(kind);
  const long = isLong(n.body) && !editing;
  const evChip = n.event_key
    ? `<a href="/notes?event=${encodeURIComponent(n.event_key)}" class="mx-note-ev" style="background:${bg};color:${fg}" title="${esc(n.event_label || '')}">${esc(n.event_label || n.event_key)}</a>`
    : `<span class="mx-note-ev" style="background:${bg};color:${fg}">${s.dayNote}</span>`;
  const btn = (act, label, cls) => `<span data-act="${act}" data-id="${esc(n.id)}" role="button" class="mx-note-btn${cls ? ' ' + cls : ''}">${label}</span>`;
  return `
      <article class="mx-note${n.pinned ? ' pinned' : ''}${editing ? ' editing' : ''}${st.highlight === n.id ? ' hi' : ''}${n.archived_at ? ' archived' : ''}" id="note-${esc(n.id)}" data-note="${esc(n.id)}">
        <div class="mx-note-head">
          ${evChip}
          <span class="mx-note-meta">${esc(s.byAt(n.author_first, whenHm(n.created_at)))}</span>
          ${n.pinned ? `<span class="mx-note-pinflag">${s.pinned}</span>` : ''}
          <div style="flex:1"></div>
          ${editing ? btn('doneEdit', s.done, 'primary') : btn('edit', s.edit)}
        </div>
        ${editing ? `
        <input data-role="eTitle" data-id="${esc(n.id)}" class="mx-in mx-note-title-in" value="${esc(n.title || '')}" placeholder="${esc(COPY.composer.title)}" aria-label="Title" maxlength="200">
        <textarea data-role="eBody" data-id="${esc(n.id)}" class="mx-note-body-in" aria-label="Note" rows="4">${esc(n.body || '')}</textarea>
        <div class="mx-note-people">
          ${(n.people || []).map(p => personChip(p, 'rmPerson', `data-id="${esc(n.id)}" data-pid="${esc(p.id)}"`)).join('')}
          <input data-role="ePerson" data-id="${esc(n.id)}" class="mx-in mx-nc-person" placeholder="${esc(s.addPerson)}" aria-label="${esc(s.addPerson)}" maxlength="200" autocomplete="off" enterkeyhint="done">
        </div>
        ${fileBlock(n, true)}` : `
        ${n.title ? `<h3 class="mx-note-title">${esc(n.title)}</h3>` : ''}
        <div class="mx-note-body${long && !open ? ' clamp' : ''}">${esc(n.body)}</div>
        ${long ? `<span data-act="toggle" data-id="${esc(n.id)}" role="button" class="mx-note-more">${open ? s.less : s.more}</span>` : ''}
        ${(n.people || []).length ? `<div class="mx-note-people">${n.people.map(p => `<span data-act="filterPerson" data-name="${esc(p.name)}" role="button" class="mx-person link">${esc(p.name)}${p.institution ? `<i> · ${esc(p.institution)}</i>` : ''}</span>`).join('')}</div>` : ''}
        ${fileBlock(n, false)}`}
        <div class="mx-note-foot">
          ${btn(n.pinned ? 'unpin' : 'pin', n.pinned ? s.unpin : s.pin)}
          ${n.archived_at ? btn('unarchive', s.unarchive) : btn('archive', s.archive)}
          ${editing || n.archived_at ? btn('del', s.remove, 'danger') : ''}
        </div>
      </article>`;
}
function groupByDay(notes, asc) {
  const by = new Map();
  notes.forEach(n => { if (!by.has(n.note_date)) by.set(n.note_date, []); by.get(n.note_date).push(n); });
  const days = Array.from(by.keys()).sort((a, b) => asc ? a.localeCompare(b) : b.localeCompare(a));
  return days.map(d => ({ day: d, notes: by.get(d) }));
}
function emptyBlock(e) { return `<div class="empty" style="padding:30px 20px 34px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${e.line}</span><span class="empty-why">${e.why}</span></div>`; }
function eventHeader() {
  const f = st.filter; const ev = eventOf(f.event) || { key: f.event, label: (D.notes[0] && D.notes[0].event_label) || f.event, kind: kindOfKey(f.event), count: D.notes.length };
  const people = []; const seen = new Set();
  D.notes.forEach(n => (n.people || []).forEach(p => { const k = p.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); people.push(p); } }));
  const [bg, fg] = tint(ev.kind || kindOfKey(ev.key));
  const c = COPY.event;
  const dateLine = ev.date ? (ev.end_date && ev.end_date !== ev.date ? fmt.rangeLabel(ev.date, ev.end_date) : fmt.dayLabel(ev.date)) + (ev.date.slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + ev.date.slice(0, 4) : '') : '';
  return `
    <div class="mx-ev" data-block="evhead">
      <div class="mx-ev-top">
        <a href="/notes" data-act="filter" data-k="all" class="mx-ev-back">${c.back}</a>
        <div style="flex:1"></div>
        ${ev.export_url ? `<a href="${esc(api.url(ev.export_url))}" target="_blank" rel="noopener" class="mx-ev-export" title="${esc(c.exportTitle)}" data-hover="background:#7e151b">${c.export} ↗</a>` : ''}
      </div>
      <span class="mx-ev-eyebrow" style="color:${fg}">${c.eyebrow}${ev.today ? ' · ' + COPY.composer.todayTag : ''}</span>
      <h2 class="mx-ev-title">${esc(ev.label)}</h2>
      <div class="mx-ev-sub">${[dateLine, c.notes(D.notes.length)].filter(Boolean).map(esc).join(' · ')}</div>
      ${people.length ? `<div class="mx-ev-people"><span class="mx-ev-h" style="background:${bg};color:${fg}">${c.people(people.length)}</span>${people.map(p => `<span data-act="filterPerson" data-name="${esc(p.name)}" role="button" class="mx-person link">${esc(p.name)}${p.institution ? `<i> · ${esc(p.institution)}</i>` : ''}</span>`).join('')}</div>` : ''}
    </div>`;
}
function personHeader() {
  const p = (D.people || []).find(x => x.name === st.filter.person) || { name: st.filter.person };
  const c = COPY.person;
  return `
    <div class="mx-ev" data-block="evhead">
      <div class="mx-ev-top"><a href="/notes" data-act="filter" data-k="all" class="mx-ev-back">${c.back}</a></div>
      <span class="mx-ev-eyebrow">${c.eyebrow}</span>
      <h2 class="mx-ev-title">${esc(p.name)}</h2>
      <div class="mx-ev-sub">${[p.institution, p.email, c.notes(D.notes.length)].filter(Boolean).map(esc).join(' · ')}</div>
    </div>`;
}
function blockMain() {
  const f = st.filter; const asc = f.kind === 'event';
  const groups = groupByDay(D.notes, asc);
  let empty = '';
  if (!D.notes.length) empty = f.kind === 'event' ? emptyBlock({ line: COPY.empty.filter.line, why: COPY.event.none }) : f.kind === 'archived' ? emptyBlock(COPY.empty.archived) : (f.kind === 'all' && !st.q.trim()) ? emptyBlock(COPY.empty.stream) : emptyBlock(COPY.empty.filter);
  return `
  <div data-block="main" class="mx-ns">
    ${f.kind === 'event' ? eventHeader() : f.kind === 'person' ? personHeader() : ''}
    ${groups.map(g => `
    <section class="mx-day">
      <div class="mx-day-head">${dayHeading(g.day)}<span class="mx-day-n">${g.notes.length}</span></div>
      ${g.notes.map(noteCard).join('')}
    </section>`).join('')}
    ${empty}
  </div>`;
}
function template() {
  return `
<div data-screen-label="Admin Notes" class="mx-notes">
  <div class="mx-gutter">
    ${blockTitle()}
    ${blockComposer()}
    <div class="mx-notes-body">
      ${blockRail()}
      ${blockMain()}
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
const rerenderMain = () => rerender('[data-block="main"]', blockMain());
const rerenderRail = () => rerender('[data-block="rail"]', blockRail());
function rerenderComposer(keepFocus) {
  const active = document.activeElement; const role = active && active.dataset ? active.dataset.role : null; const pos = active && active.selectionStart;
  rerender('[data-block="composer"]', blockComposer());
  const ta = rootEl.querySelector('[data-role="cBody"]'); if (ta) autosize(ta);
  revealChip();
  if (keepFocus && role) { const el = rootEl.querySelector(`[data-role="${role}"]`); if (el) { el.focus(); try { if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } catch (e) {} } }
}
// the phone strip scrolls sideways — keep the selected event chip in view, a WHOLE chip at the strip's
// left padding (offsetLeft is measured from #view, not the strip, and left half of the chip before it
// showing at the edge — "· 15 MAR"); notes.css fades both edges of the strip
function revealChip() {
  const strip = rootEl && rootEl.querySelector('[data-role="cEvents"]'); const on = strip && strip.querySelector('.mx-chip.on');
  if (!strip) return;
  const old = strip.querySelector('.mx-nc-tail'); if (old) old.remove();
  if (!on || strip.scrollWidth <= strip.clientWidth) { stripEdges(strip); return; }
  const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
  const origin = strip.getBoundingClientRect().left - strip.scrollLeft + pad;          // scrollLeft that puts x at the padding edge = x - origin
  const starts = Array.from(strip.querySelectorAll('.mx-chip')).map(c => c.getBoundingClientRect().left - origin);
  const onStart = on.getBoundingClientRect().left - origin, onEnd = onStart + on.offsetWidth;
  const max = strip.scrollWidth - strip.clientWidth;
  // near the end the strip cannot scroll the pick to the left edge: step back to the chip boundary before
  // it, so the edge always starts on a whole chip, as long as the pick still fits in view
  let x = Math.min(onStart, max);
  const snap = starts.filter(s => s <= x + 0.5).pop();
  if (snap != null && snap < x - 0.5 && onEnd - snap <= strip.clientWidth - 2 * pad) x = snap;
  else if (onStart > max + 0.5) {
    // no whole chip before the pick fits with it (the default pick NO EVENT · DAY NOTE sits near the end,
    // after a 250 px event chip): an empty tail after the last chip lets the strip scroll the pick itself
    // to the left edge, instead of stopping with half of the chip before it showing ("· 15 MAR")
    const tail = document.createElement('span');
    tail.className = 'mx-nc-tail'; tail.setAttribute('aria-hidden', 'true');
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;                   // the tail brings its own gap
    tail.style.cssText = 'flex:0 0 ' + Math.max(0, Math.ceil(onStart - max - gap)) + 'px;height:1px';
    strip.appendChild(tail);
    x = Math.min(onStart, strip.scrollWidth - strip.clientWidth);
  }
  strip.scrollLeft = Math.max(0, x);
  stripEdges(strip);
}
// a strip scrolled away from its start fades its left edge, one with more to come fades its right — a chip
// cut at an edge then reads as "more this way", never as a clipped glitch (notes.css .mx-edge-l / -r)
function stripEdges(strip) {
  const max = strip.scrollWidth - strip.clientWidth;
  strip.classList.toggle('mx-edge-l', max > 1 && strip.scrollLeft > 1);
  strip.classList.toggle('mx-edge-r', max > 1 && strip.scrollLeft < max - 1);
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 44) + 'px'; }
function autosizeAll() { rootEl.querySelectorAll('textarea[data-role="cBody"], textarea[data-role="eBody"]').forEach(autosize); }
function syncUrl(replace) {
  const p = new URLSearchParams(); const f = st.filter;
  if (f.kind === 'event' && f.event) p.set('event', f.event);
  else if (f.kind === 'person' && f.person) p.set('person', f.person);
  else if (f.kind !== 'all') p.set(f.kind, '1');
  if (st.q.trim()) p.set('q', st.q.trim());
  const s = p.toString();
  try { history[replace ? 'replaceState' : 'pushState'](history.state, '', '/notes' + (s ? '?' + s : '')); } catch (e) {}
}
async function refetch(full) {
  try { if (!(await load(full)) || !rootEl) return; }
  catch (e) { ui.toast(e.message, { kind: 'error' }); return; }
  rerenderMain(); if (full) rerenderRail();
  autosizeAll();
}
async function setFilter(next, opts = {}) {
  st.filter = Object.assign({ kind: 'all', event: null, person: null }, next);
  st.editing = null; st.highlight = null;
  syncUrl(opts.replace);
  rerenderRail();
  await refetch(false);
  if (!opts.stay) { const m = rootEl.querySelector('[data-block="main"]'); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView({ block: 'start' }); }
}
function noteById(id) { return D.notes.find(n => n.id === id) || null; }
function patchLocal(note) { const i = D.notes.findIndex(n => n.id === note.id); if (i >= 0) D.notes[i] = Object.assign({}, D.notes[i], note); }
// the current view would hide a note — say where it went / jump to ALL so the person sees it land
function visibleUnderFilter(n) {
  const f = st.filter;
  if (f.kind === 'all') return !st.q.trim();
  if (f.kind === 'event') return n.event_key === f.event;
  if (f.kind === 'day') return !n.event_key;
  if (f.kind === 'pinned') return n.pinned;
  if (f.kind === 'person') return (n.people || []).some(p => p.name === f.person);
  return false;
}
function readComposer() {
  const v = role => { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value : ''; };
  const c = st.composer;
  c.body = v('cBody'); c.title = v('cTitle'); c.date = v('cDate') || todayYmd(); c.personDraft = v('cPerson');
  if (c.eventKey === '__custom') c.customLabel = v('cCustom');
}
function parsePerson(raw) {
  const s = String(raw || '').trim(); if (!s) return null;
  const m = /^(.*?)\s*(?:[,·—–-]\s*|\(\s*)([^()]+?)\)?\s*$/.exec(s);   // "Ana Kovač, MGH" · "Ana Kovač (MGH)" · "Ana Kovač — MGH"
  if (m && m[1].trim() && m[2].trim()) return { name: m[1].trim(), institution: m[2].trim() };
  return { name: s, institution: null };
}
async function uploadTo(id, files) {
  let n = 0;
  for (const f of Array.from(files || [])) {
    if (f.size > 25 * 1024 * 1024) { ui.toast(COPY.toast.tooBig, { kind: 'error' }); continue; }
    try { const fd = new FormData(); fd.append('file', f, f.name); await api.post('/api/v2/notes/' + encodeURIComponent(id) + '/files', fd); n++; }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
  return n;
}
async function saveField(id, field, value) {
  const n = noteById(id); if (!n) return;
  if (String(value) === String(n[field] == null ? '' : n[field])) return;
  try {
    const r = await api.put('/api/v2/notes/' + encodeURIComponent(id), { [field]: value });
    if (r && r.note) patchLocal(r.note);
    ui.toast(COPY.toast.saved);
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function flag(id, act, toastText, undoAct) {
  try {
    const r = await api.post('/api/v2/notes/' + encodeURIComponent(id) + '/' + act);
    if (r && r.note) patchLocal(r.note);
    if (act === 'archive' || act === 'unarchive') {
      const keep = (act === 'archive' && st.filter.kind === 'archived') || (act === 'unarchive' && st.filter.kind !== 'archived');
      if (!keep) D.notes = D.notes.filter(n => n.id !== id);
    }
    rerenderMain(); autosizeAll();
    ui.toast(toastText, undoAct ? { undo: () => flag(id, undoAct, undoAct === 'unarchive' ? COPY.toast.unarchived : COPY.toast.archived).then(() => refetch(true)) } : undefined);
    refetch(true);
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

const handlers = {
  // ---- composer ----
  cEvent: (el) => { readComposer(); st.composer.eventKey = el.dataset.k; rerenderComposer(false); if (el.dataset.k === '__custom') { const i = rootEl.querySelector('[data-role="cCustom"]'); if (i) i.focus(); } },
  cRmPerson: (el) => { readComposer(); st.composer.people.splice(Number(el.dataset.i), 1); rerenderComposer(false); const i = rootEl.querySelector('[data-role="cPerson"]'); if (i) i.focus(); },
  cRmFile: (el) => { readComposer(); st.composer.files.splice(Number(el.dataset.i), 1); rerenderComposer(false); },
  save: async (el) => {
    readComposer();
    const c = st.composer;
    if (c.personDraft.trim()) { const p = parsePerson(c.personDraft); if (p) c.people.push(p); c.personDraft = ''; }
    const body = c.body.trim(), title = c.title.trim();
    if (!body && !title) { ui.toast(COPY.composer.typeFirst); const ta = rootEl.querySelector('[data-role="cBody"]'); if (ta) ta.focus(); return; }
    const payload = { body, title, note_date: c.date, people: c.people };
    if (c.eventKey === '__custom') { if (!c.customLabel.trim()) { ui.toast(COPY.composer.nameEvent); const i = rootEl.querySelector('[data-role="cCustom"]'); if (i) i.focus(); return; } payload.event_label = c.customLabel.trim(); }
    else if (c.eventKey) payload.event_key = c.eventKey;
    else payload.event_key = '';
    c.saving = true; rerenderComposer(false);
    try {
      const r = await api.post('/api/v2/notes', payload);
      const files = c.files.slice();
      let up = 0; if (files.length) { ui.toast(COPY.toast.uploading); up = await uploadTo(r.id, files); }
      const keptKey = c.eventKey === '__custom' && r.note ? r.note.event_key : c.eventKey;
      st.composer = Object.assign(freshComposer(), { eventKey: keptKey, date: c.date });
      ui.toast(up ? COPY.composer.savedWithFiles(up) : COPY.composer.saved);
      st.highlight = r.id;
      if (r.note && !visibleUnderFilter(r.note)) { st.q = ''; st.filter = { kind: 'all', event: null, person: null }; syncUrl(true); }
      await load(true);
      rerenderComposer(false); rerenderRail(); rerenderMain(); autosizeAll();
    } catch (e) { c.saving = false; rerenderComposer(false); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- rail ----
  filter: (el) => setFilter({ kind: el.dataset.k }),
  filterEvent: (el) => setFilter({ kind: 'event', event: el.dataset.k }),
  filterPerson: (el) => setFilter({ kind: 'person', person: el.dataset.name }),
  allPeople: () => { st.allPeople = !st.allPeople; rerenderRail(); },
  // ---- cards ----
  toggle: (el) => { const id = el.dataset.id; if (st.expanded.has(id)) st.expanded.delete(id); else st.expanded.add(id); rerenderMain(); autosizeAll(); },
  edit: (el) => { st.editing = el.dataset.id; st.highlight = null; rerenderMain(); autosizeAll(); const ta = rootEl.querySelector('[data-role="eBody"]'); if (ta) { ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} } },
  doneEdit: async (el) => {
    const id = el.dataset.id; const ta = rootEl.querySelector(`[data-role="eBody"][data-id="${CSS.escape(id)}"]`); const ti = rootEl.querySelector(`[data-role="eTitle"][data-id="${CSS.escape(id)}"]`);
    const n = noteById(id);
    if (n && ((ta && ta.value !== n.body) || (ti && ti.value !== (n.title || '')))) {
      try { const r = await api.put('/api/v2/notes/' + encodeURIComponent(id), { body: ta ? ta.value : n.body, title: ti ? ti.value : n.title }); if (r && r.note) patchLocal(r.note); ui.toast(COPY.toast.saved); }
      catch (e) { ui.toast(e.message, { kind: 'error' }); return; }
    }
    st.editing = null; rerenderMain(); autosizeAll(); refetch(true);
  },
  pin: (el) => flag(el.dataset.id, 'pin', COPY.toast.pinned),
  unpin: (el) => flag(el.dataset.id, 'unpin', COPY.toast.unpinned),
  archive: (el) => { st.editing = null; return flag(el.dataset.id, 'archive', COPY.toast.archived, 'unarchive'); },
  unarchive: (el) => flag(el.dataset.id, 'unarchive', COPY.toast.unarchived, 'archive'),
  del: async (el) => {
    const id = el.dataset.id;
    if (!await ui.confirm(Object.assign({ eyebrow: 'PLEASE CONFIRM' }, COPY.confirm.del))) return;
    try { await api.del('/api/v2/notes/' + encodeURIComponent(id)); D.notes = D.notes.filter(n => n.id !== id); st.editing = null; rerenderMain(); ui.toast(COPY.toast.deleted); refetch(true); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  rmPerson: async (el) => {
    try { const r = await api.del('/api/v2/notes/' + encodeURIComponent(el.dataset.id) + '/people/' + encodeURIComponent(el.dataset.pid)); if (r && r.note) patchLocal(r.note); rerenderMain(); autosizeAll(); ui.toast(COPY.toast.personRemoved); refetch(true); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  rmFile: async (el) => {
    try { await api.del('/api/v2/notes/files/' + encodeURIComponent(el.dataset.id)); ui.toast(COPY.toast.fileRemoved); await refetch(false); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};
async function addPersonTo(id, input) {
  const p = parsePerson(input.value); if (!p) { ui.toast(COPY.toast.personEmpty); return; }
  try {
    const r = await api.post('/api/v2/notes/' + encodeURIComponent(id) + '/people', p);
    if (r && r.note) patchLocal(r.note);
    input.value = '';
    rerenderMain(); autosizeAll();
    const again = rootEl.querySelector(`[data-role="ePerson"][data-id="${CSS.escape(id)}"]`); if (again) again.focus();
    ui.toast(COPY.toast.personAdded(p.name));
    refetch(true);
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}

// input / change / blur / key listeners on the view root (they survive every innerHTML swap)
function bindRootListeners(root) {
  let qTimer = null;
  const onInput = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="search"]')) { st.q = t.value; clearTimeout(qTimer); qTimer = setTimeout(() => { syncUrl(true); refetch(false); }, 240); return; }
    if (t.matches('textarea[data-role="cBody"], textarea[data-role="eBody"]')) autosize(t);
  };
  const onChange = async e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="cFile"]')) { readComposer(); Array.from(t.files || []).forEach(f => st.composer.files.push(f)); rerenderComposer(false); return; }
    if (t.matches('[data-role="eFile"]')) { const id = t.dataset.id; const files = t.files; if (files && files.length) { ui.toast(COPY.toast.uploading); const n = await uploadTo(id, files); if (n) ui.toast(COPY.toast.uploaded(n === 1 ? files[0].name.slice(0, 40) : n + ' files')); await refetch(false); } return; }
    if (t.matches('[data-role="cDate"]')) { readComposer(); }
  };
  const onBlur = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="eBody"]')) saveField(t.dataset.id, 'body', t.value);
    else if (t.matches('[data-role="eTitle"]')) saveField(t.dataset.id, 'title', t.value);
  };
  const onKey = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (e.key === 'Enter' && t.matches('[data-role="cPerson"]')) { e.preventDefault(); readComposer(); const p = parsePerson(t.value); if (!p) return; st.composer.people.push(p); st.composer.personDraft = ''; rerenderComposer(false); const i = root.querySelector('[data-role="cPerson"]'); if (i) i.focus(); return; }
    if (e.key === 'Enter' && t.matches('[data-role="ePerson"]')) { e.preventDefault(); addPersonTo(t.dataset.id, t); return; }
    if (e.key === 'Enter' && t.matches('[data-role="cCustom"], [data-role="cTitle"]')) { e.preventDefault(); const ta = root.querySelector('[data-role="cBody"]'); if (ta && !ta.value.trim()) ta.focus(); else { const b = root.querySelector('[data-act="save"]'); if (b) handlers.save(b); } return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && t.matches('[data-role="cBody"]')) { e.preventDefault(); const b = root.querySelector('[data-act="save"]'); if (b) handlers.save(b); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && t.matches('[data-role="eBody"]')) { e.preventDefault(); t.blur(); const b = root.querySelector(`[data-act="doneEdit"][data-id="${CSS.escape(t.dataset.id)}"]`); if (b) handlers.doneEdit(b); return; }
    if (e.key === 'Escape' && st.editing) { st.editing = null; rerenderMain(); autosizeAll(); }
  };
  // the event strip's edge fades follow its scroll (scroll does not bubble — caught on the way down)
  const onScroll = e => { const t = e.target; if (t && t.matches && t.matches('[data-role="cEvents"]')) stripEdges(t); };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('keydown', onKey);
  root.addEventListener('scroll', onScroll, true);
  return () => { clearTimeout(qTimer); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('focusout', onBlur); root.removeEventListener('keydown', onKey); root.removeEventListener('scroll', onScroll, true); };
}
function freshComposer() { return { body: '', title: '', date: todayYmd(), eventKey: null, customLabel: '', people: [], personDraft: '', files: [], saving: false }; }
function filterFromQuery(qs) {
  if (qs.event) return { kind: 'event', event: qs.event, person: null };
  if (qs.person) return { kind: 'person', event: null, person: qs.person };
  for (const k of ['pinned', 'day', 'archived']) if (qs[k] === '1') return { kind: k, event: null, person: null };
  return { kind: 'all', event: null, person: null };
}

export default {
  title: 'Notes',
  async render(root, ctx) {
    rootEl = root; loadCss();
    const qs = ctx.query || {};
    st = { filter: filterFromQuery(qs), q: qs.q || '', composer: freshComposer(), editing: null, expanded: new Set(), highlight: ctx.params && ctx.params.id ? ctx.params.id : null, allPeople: false };
    D = null;
    try { await load(true); } catch (e) { root.innerHTML = `<div class="empty" style="padding:60px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">The notes did not load.</span><span class="empty-why">${esc(e.message)}</span></div>`; return; }
    if (rootEl !== root) return;
    // today's event is pre-selected; when the page IS an event page, that event is
    if (st.filter.kind === 'event' && st.filter.event) st.composer.eventKey = st.filter.event;
    else { const te = todaysEvents()[0]; st.composer.eventKey = te ? te.key : ''; }
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    unlisten = bindRootListeners(root);
    autosizeAll(); revealChip();
    if (st.highlight) { const el = root.querySelector('#note-' + CSS.escape(st.highlight)); if (el) el.scrollIntoView({ block: 'center' }); else ui.toast(COPY.toast.missing); }
    if (qs.new === '1') { const ta = root.querySelector('[data-role="cBody"]'); if (ta) ta.focus(); }
    // the other person's notes arrive on their own — a quiet refresh while nothing is being typed
    poll = setInterval(() => {
      if (document.hidden || st.editing || st.composer.saving) return;
      const a = document.activeElement; if (a && a.matches && a.matches('input, textarea, select') && rootEl && rootEl.contains(a)) return;
      refetch(true);
    }, POLL_MS);
  },
  destroy() {
    reqId++; if (poll) clearInterval(poll); poll = null;
    if (unbind) unbind(); if (unlisten) unlisten(); unbind = null; unlisten = null;
    rootEl = null; D = null; st = null;
  }
};
