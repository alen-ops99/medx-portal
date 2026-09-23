// js/views/program.js — the PROGRAM EDITOR of the event app ("Plexus Week Live", docs/EVENT-APP-BRIEF.md;
// v2 addition 2026-09-22, no artboard).
// Why: the guests' phones show whatever is in `sessions` for an event, and "that stuff changes a lot" —
// times, rooms, speakers, the order of the evening. Here Alen and Laura edit the program in place: one
// event at a time (the chips), one day at a time (the tabs), every row editable where it stands, dragged
// into order, shifted in bulk when a keynote runs long, published per row or all at once. TBD rows keep
// the skeleton visible to guests before the content exists. The INSIGHT strip says how many people opened
// the app and built a schedule; the attendance column says who is coming to what (and when a room is over).
// Route: /program/:eventKey? (?day=YYYY-MM-DD). Data: admin-portal/backend/v2/program-ops.js —
// GET /api/v2/program/events · /speakers?q= · /:event/sessions · POST/PUT/DELETE …/sessions[/:id] ·
// PUT …/sessions/reorder · POST …/sessions/shift · PUT …/sessions/:id/publish|tbd · POST …/:id/duplicate ·
// PUT /:event/publish · GET /:event/attendance(.csv) · GET /:event/insight.
// Visual language: the admin workspace (Inter micro-labels, Fraunces titles, ink/crimson, white cards on
// paper, hairlines) — the same vocabulary as tasks.js and notes.js; css/views/program.css carries the row
// grid, drag states, the phone stack (compact cards → a full-screen edit sheet, 16px inputs, 44px targets).
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { session } from '../state.js';

export const SOURCE = 'v2 addition — no artboard (2026-09-22)';

export const COPY = {
  title: 'Program', titleHtml: 'The <i style="color:#9b1b22">program</i>',
  sub: 'What guests see in the event app, event by event. Edit a row where it stands — every change is live on their phones within a minute.',
  updated: when => `PROGRAM UPDATED · ${when}`, never: 'NOTHING PUBLISHED YET',
  events: { eyebrow: 'EVENT', today: 'TODAY', live: 'LIVE', tbd: 'TBD ROWS', counts: (p, n) => `${p}/${n} LIVE` },
  insight: {
    eyebrow: 'INSIGHT', registered: 'REGISTERED', opened: 'OPENED THE APP', scheduled: 'TAPPED A SESSION', taps: 'ADDED BY HAND',
    top: 'MOST WANTED', topNone: 'No taps yet.', speakers: 'SPEAKERS NOT OPENED', speakersAll: 'Every linked speaker has opened their slots.', speakersNone: 'No speakers from the roster are linked yet.',
    seats: n => `${n} SEATS`
  },
  bar: {
    day: 'DAY', publishAll: 'PUBLISH ALL', unpublishAll: 'UNPUBLISH ALL', shift: 'SHIFT', after: 'EVERYTHING AFTER', by: 'BY', min: 'MIN', apply: 'APPLY',
    counts: (live, n) => `${live} OF ${n} LIVE`
  },
  row: {
    drag: 'Drag to reorder', up: 'Move up', down: 'Move down', title: 'Session title', room: 'Room', note: 'How to find it — floor, entrance, "left of the bar"',
    track: 'Track', capacity: 'Capacity', description: 'What this is — one or two sentences guests read under the title',
    speakers: 'SPEAKERS', speakerPh: 'Find a speaker from the roster…', namesPh: 'Other names, comma-separated (people not on the roster)',
    details: 'DETAILS', less: 'LESS', duplicate: 'DUPLICATE', remove: 'DELETE', tbd: 'TBD', counts: 'COUNTS', live: 'LIVE', draft: 'DRAFT',
    overlaps: t => `OVERLAPS ${t}`, att: 'Added by hand — registrants of the event have every session in their schedule by default', noCap: 'no cap', kindLabel: 'Kind', start: 'From', end: 'To',
    noSpeakers: 'No speakers yet', done: 'DONE', sheetEyebrow: (t, k) => `${t || '—'} · ${k}`
  },
  add: { session: '+ ADD SESSION', break: '+ ADD BREAK', newTitle: 'New session', breakTitle: 'Break' },
  empty: {
    day: { line: 'Nothing on this day yet.', why: 'Add the first session below — it appears to guests once you publish it.' },
    events: { line: 'No events to program.', why: 'The catalogue is empty — the conference, the Gala and Building Bridges rows are missing from the database.' }
  },
  attendance: { eyebrow: 'ATTENDANCE', none: 'Nobody has tapped ATTENDING for this session yet.', party: n => n > 1 ? `party of ${n}` : '', declined: 'declined', csv: 'CSV · WHOLE EVENT', close: 'CLOSE', cap: (c, cap) => cap == null ? `${c} attending` : `${c} of ${cap} · ${c > cap ? 'OVER CAPACITY' : 'within capacity'}` },
  toast: {
    saved: 'SAVED', added: 'SESSION ADDED — DRAFT UNTIL YOU PUBLISH IT', breakAdded: 'BREAK ADDED', duplicated: 'DUPLICATED — DRAFT', deleted: 'DELETED', restored: 'RESTORED',
    published: 'LIVE FOR GUESTS', unpublished: 'HIDDEN FROM GUESTS — DRAFT', tbdOn: 'MARKED TBD', tbdOff: 'TBD CLEARED', countsOn: 'GUESTS SEE THE COUNT', countsOff: 'COUNT HIDDEN FROM GUESTS',
    publishedAll: n => `${n} SESSION${n === 1 ? '' : 'S'} PUBLISHED`, unpublishedAll: n => `${n} SESSION${n === 1 ? '' : 'S'} HIDDEN`, nothingToChange: 'NOTHING TO CHANGE',
    shifted: (n, m) => `${n} SESSION${n === 1 ? '' : 'S'} MOVED ${m > 0 ? '+' : ''}${m} MIN`, shiftBad: 'GIVE A TIME AND A NUMBER OF MINUTES', reordered: 'ORDER SAVED',
    clock: 'ROWS FOLLOW THE CLOCK — CHANGE THE TIME TO MOVE IT THERE',
    speakerAdded: n => `${n.toUpperCase()} ADDED`, speakerRemoved: 'SPEAKER REMOVED', csv: 'CSV DOWNLOADED', csvFail: 'THE CSV COULD NOT BE DOWNLOADED'
  },
  confirm: { unpublishAll: { title: 'Hide the whole program?', body: 'Every session of this event disappears from the guests’ phones until you publish again. Their schedules are kept.', ok: 'HIDE ALL', cancel: 'KEEP LIVE' } }
};

const KINDS = [['keynote', 'Keynote'], ['talk', 'Talk'], ['panel', 'Panel'], ['presentations', 'Presentations'], ['break', 'Break'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['networking', 'Networking'], ['reception', 'Reception'], ['ceremony', 'Ceremony'], ['other', 'Other']];
const KIND_LABEL = Object.fromEntries(KINDS);
const KIND_TINT = { keynote: ['#f7e3e4', '#7e151b'], talk: ['#eee9df', '#4a4239'], panel: ['#e8eef7', '#2c4a73'], presentations: ['#e8eef7', '#2c4a73'], break: ['#f1ede4', '#6d6459'], lunch: ['#e4efe7', '#22563a'], dinner: ['#e4efe7', '#22563a'], networking: ['#f8f1e2', '#7a6432'], reception: ['#f8f1e2', '#7a6432'], ceremony: ['#f7e3e4', '#7e151b'], other: ['#eee9df', '#4a4239'] };
const POLL_MS = 60000;
const SESSION_MIN = 45, BREAK_MIN = 15;
const TEXT_FIELDS = ['title', 'room', 'location_note', 'track', 'description', 'capacity', 'speaker_names'];

let D = null, P = null, I = null, st = null, rootEl = null, unbind = null, unlisten = null, poll = null, reqId = 0, lastToast = 0, listDirty = false;

function loadCss() {
  if (!document.getElementById('mx-css-program')) {
    const l = document.createElement('link'); l.id = 'mx-css-program'; l.rel = 'stylesheet'; l.href = '/css/views/program.css'; document.head.appendChild(l);
  }
}
const todayYmd = () => fmt.ymd(new Date());
const toMin = t => { const m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = n => { const m = ((Math.round(n) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const base = () => '/api/v2/program/' + encodeURIComponent(st.event);
const sPath = id => base() + '/sessions/' + encodeURIComponent(id);
const dayKey = s => s.event_date || 'tbd';
const isPhone = () => window.matchMedia && window.matchMedia('(max-width: 760px)').matches;

// ---------------------------------------------------------------- data
async function loadEvents() { const r = await api.get('/api/v2/program/events?today=' + todayYmd()); D = r; return r; }
async function loadProgram() {
  const id = ++reqId;
  const [p, i] = await Promise.all([api.get(base() + '/sessions?today=' + todayYmd()), api.get(base() + '/insight').catch(() => null)]);
  if (id !== reqId) return false;
  P = p; I = i;
  return true;
}
const events = () => (D && D.events) || [];
const currentEvent = () => events().find(e => e.key === st.event) || (P && P.event) || null;
const sessions = () => (P && P.sessions) || [];
const byId = id => sessions().find(s => s.id === id) || null;
// the days of the current event: the server's grouping, else the event's own date so an empty program still has a day to add to
function days() {
  const list = (P && P.days && P.days.length) ? P.days.map(d => ({ key: d.date || 'tbd', date: d.date, label: d.label, short: d.short })) : [];
  const ev = currentEvent();
  if (!list.length && ev && ev.date) list.push({ key: ev.date, date: ev.date, label: ev.date_label || ev.date, short: ev.short_date || ev.date });
  if (!list.length) list.push({ key: 'tbd', date: null, label: 'Date to be confirmed', short: 'TBD' });
  return list;
}
const dayRows = key => sessions().filter(s => dayKey(s) === key);
function conflictMap() {
  const by = {};
  ((P && P.conflicts) || []).forEach(({ a, b }) => { (by[a] = by[a] || []).push(b); (by[b] = by[b] || []).push(a); });
  return by;
}
function patchLocal(sess) {
  if (!sess || !P) return;
  const i = P.sessions.findIndex(s => s.id === sess.id);
  if (i >= 0) P.sessions[i] = Object.assign({}, P.sessions[i], sess); else P.sessions.push(sess);
  P.updated_at = sess.updated_at || P.updated_at;
}
function takeListing(r) { if (!r || !P) return; if (r.sessions) P.sessions = r.sessions; if (r.days) P.days = r.days; if (r.conflicts) P.conflicts = r.conflicts; if (r.updated_at) P.updated_at = r.updated_at; }
function ensureDay() {
  const list = days();
  if (st.day && list.some(d => d.key === st.day)) return;
  const ev = currentEvent();
  const today = list.find(d => d.date === todayYmd());
  st.day = (today && today.key) || (ev && ev.date && list.some(d => d.key === ev.date) ? ev.date : list[0].key);
}
function setUrl() {
  try { history.replaceState(history.state, '', '/program/' + encodeURIComponent(st.event) + (st.day && st.day !== 'tbd' ? '?day=' + encodeURIComponent(st.day) : '')); } catch (e) {}
}

// ---------------------------------------------------------------- render: blocks
const micro = 'font:600 9px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase';
function blockTitle() {
  const u = P && P.updated_at;
  return `
  <div data-block="title" style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
    <div style="min-width:0">
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.titleHtml}</span>
      <div style="font-size:12.5px;color:#6d6459;margin-top:4px;max-width:640px;line-height:1.5">${COPY.sub}</div>
    </div>
    <div style="flex:1"></div>
    <span data-role="updated" style="${micro};color:${u ? '#1e6e42' : '#9a9086'}">${u ? COPY.updated(fmt.when(u)) : COPY.never}</span>
  </div>`;
}
function blockEvents() {
  const list = events();
  if (!list.length) return `<div data-block="events" class="empty card" style="padding:40px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.empty.events.line}</span><span class="empty-why">${COPY.empty.events.why}</span></div>`;
  return `
  <div data-block="events" class="mx-pg-events" role="tablist" aria-label="${COPY.events.eyebrow}">
    ${list.map(e => `<span class="mx-pg-chip${e.key === st.event ? ' on' : ''}${e.is_today ? ' today' : ''}" data-act="pick" data-key="${esc(e.key)}" role="tab" aria-selected="${e.key === st.event}">
      ${e.is_live ? `<span class="mx-pg-chip-live">${COPY.events.live}</span>` : e.is_today ? `<span class="mx-pg-chip-today">${COPY.events.today}</span>` : ''}
      <span class="mx-pg-chip-name">${esc(e.label)}</span>
      <span class="mx-pg-chip-meta">${esc(e.short_date || '')}${e.session_count ? ' · ' + COPY.events.counts(e.published_count, e.session_count) : ''}</span>
      ${Number(e.tbd_count) > 0 ? `<span class="mx-pg-chip-dot" title="${e.tbd_count} ${COPY.events.tbd}"></span>` : ''}
    </span>`).join('')}
  </div>`;
}
function blockInsight() {
  if (!I) return `<div data-block="insight"></div>`;
  const cell = (n, l, sub) => `<div class="mx-pg-stat"><span class="mx-pg-stat-n">${fmt.num(n)}</span><span class="mx-pg-stat-l">${l}</span>${sub ? `<span class="mx-pg-stat-s">${esc(sub)}</span>` : ''}</div>`;
  const top = (I.top || []).slice(0, 3);
  const un = I.speakers_unopened || [];
  return `
  <div data-block="insight" class="card mx-pg-insight">
    <div class="mx-pg-stats">
      ${cell(I.registered, COPY.insight.registered, I.registered_seats && I.registered_seats !== I.registered ? COPY.insight.seats(I.registered_seats) : '')}
      ${cell(I.opened, COPY.insight.opened)}
      ${cell(I.scheduled, COPY.insight.scheduled)}
      ${cell(I.attending_total, COPY.insight.taps)}
    </div>
    <div class="mx-pg-insight-side">
      <div style="min-width:0"><span class="label">${COPY.insight.top}</span>
        ${top.length ? `<ol class="mx-pg-top">${top.map(t => `<li><span class="mx-pg-top-n">${fmt.num(t.count)}</span><span class="mx-pg-top-t">${esc(t.title)}</span><span class="mx-pg-top-w">${esc(t.start_time || '')}</span></li>`).join('')}</ol>` : `<div class="mx-pg-side-empty">${COPY.insight.topNone}</div>`}
      </div>
      <div style="min-width:0"><span class="label">${COPY.insight.speakers}${I.speakers_total ? ` · ${un.length}/${I.speakers_total}` : ''}</span>
        ${!I.speakers_total ? `<div class="mx-pg-side-empty">${COPY.insight.speakersNone}</div>` : !un.length ? `<div class="mx-pg-side-empty">${COPY.insight.speakersAll}</div>` : `<div class="mx-pg-unopened">${un.slice(0, 8).map(s => `<span class="tag tag-gold">${esc(s.name)}</span>`).join('')}${un.length > 8 ? `<span class="tag">+${un.length - 8}</span>` : ''}</div>`}
      </div>
    </div>
  </div>`;
}
function blockBar() {
  const list = days();
  const all = sessions(); const live = all.filter(s => s.is_published).length;
  return `
  <div data-block="bar" class="mx-pg-bar">
    <div class="mx-pg-tabs" role="tablist" aria-label="${COPY.bar.day}">
      ${list.map(d => `<span class="mx-pg-tab${d.key === st.day ? ' on' : ''}" data-act="day" data-day="${esc(d.key)}" role="tab" aria-selected="${d.key === st.day}"><b>${esc(d.short)}</b><i>${esc(d.label)}</i>${dayRows(d.key).length ? `<em>${dayRows(d.key).length}</em>` : ''}</span>`).join('')}
    </div>
    <div class="mx-pg-bar-right">
      <span class="mx-pg-live-count">${COPY.bar.counts(live, all.length)}</span>
      <span data-act="publishAll" role="button" class="btn-ink"${live === all.length || !all.length ? ' aria-disabled="true"' : ''}>${COPY.bar.publishAll}</span>
      <span data-act="unpublishAll" role="button" class="btn-ghost"${!live ? ' aria-disabled="true"' : ''}>${COPY.bar.unpublishAll}</span>
    </div>
    <div class="mx-pg-shift" data-role="shift">
      <span class="mx-pg-shift-l">${COPY.bar.shift}</span>
      <span class="mx-pg-shift-t">${COPY.bar.after}</span>
      <input type="time" class="mx-pin" data-role="shiftAfter" value="${esc(st.shiftAfter || '')}" aria-label="${COPY.bar.after}">
      <span class="mx-pg-shift-t">${COPY.bar.by}</span>
      <input type="number" class="mx-pin mx-pg-shift-n" data-role="shiftMin" value="${esc(st.shiftMin || '')}" step="5" min="-720" max="720" placeholder="+10" aria-label="${COPY.bar.min}">
      <span class="mx-pg-shift-t">${COPY.bar.min}</span>
      <span data-act="shift" role="button" class="btn-primary">${COPY.bar.apply}</span>
    </div>
  </div>`;
}
function blockList() {
  const rows = dayRows(st.day);
  const cm = conflictMap();
  const d = days().find(x => x.key === st.day) || {};
  return `
  <div data-block="list" class="mx-pg-list" data-day="${esc(st.day)}">
    ${rows.length ? rows.map((s, i) => row(s, cm, i, rows.length)).join('') : `<div class="empty card" style="padding:36px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">${COPY.empty.day.line}</span><span class="empty-why">${COPY.empty.day.why}</span></div>`}
    <div class="mx-pg-add">
      <span data-act="add" data-day="${esc(d.date || '')}" role="button" class="btn-primary">${COPY.add.session}</span>
      <span data-act="addBreak" data-day="${esc(d.date || '')}" role="button" class="btn-ghost">${COPY.add.break}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- render: a row
const inp = (s, field, extra = '') => `data-field="${field}" data-id="${esc(s.id)}" ${extra}`;
const kindSelect = (s, cls) => `<select class="mx-pin ${cls}" ${inp(s, 'kind')} aria-label="${COPY.row.kindLabel}">${KINDS.map(([k, l]) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
const timeInputs = s => `<div class="mx-pr-time"><input type="time" class="mx-pin" ${inp(s, 'start_time')} value="${esc(s.start_time || '')}" aria-label="${COPY.row.start}"><i>–</i><input type="time" class="mx-pin" ${inp(s, 'end_time')} value="${esc(s.end_time || '')}" aria-label="${COPY.row.end}"></div>`;
const toggles = s => `
  <div class="mx-pr-toggles">
    <span class="mx-tg${s.is_tbd ? ' on' : ''}" data-act="toggle" data-k="is_tbd" data-id="${esc(s.id)}" role="switch" aria-checked="${!!s.is_tbd}">${COPY.row.tbd}</span>
    <span class="mx-tg${s.show_counts ? ' on' : ''}" data-act="toggle" data-k="show_counts" data-id="${esc(s.id)}" role="switch" aria-checked="${!!s.show_counts}">${COPY.row.counts}</span>
    <span class="mx-tg pub${s.is_published ? ' on' : ''}" data-act="toggle" data-k="is_published" data-id="${esc(s.id)}" role="switch" aria-checked="${!!s.is_published}">${s.is_published ? COPY.row.live : COPY.row.draft}</span>
  </div>`;
const attCell = s => { const over = s.capacity != null && s.count > s.capacity; return `<span class="mx-pr-att${over ? ' over' : ''}" data-act="attendance" data-id="${esc(s.id)}" role="button" title="${COPY.row.att}"><b>${fmt.num(s.count || 0)}</b><i>/ ${s.capacity == null ? '—' : fmt.num(s.capacity)}</i></span>`; };
const orderBtns = (i, n, s) => `<div class="mx-pr-order"><span data-act="moveUp" data-id="${esc(s.id)}" role="button" aria-label="${COPY.row.up}"${i === 0 || !canMove(s.id, -1) ? ' aria-disabled="true"' : ''}>↑</span><span data-act="moveDown" data-id="${esc(s.id)}" role="button" aria-label="${COPY.row.down}"${i === n - 1 || !canMove(s.id, 1) ? ' aria-disabled="true"' : ''}>↓</span></div>`;
const speakerChip = (s, sp) => `<span class="mx-sp-chip">${sp.photo_url ? `<img src="${esc(sp.photo_url)}" alt="">` : `<b>${esc(fmt.initials(sp.name))}</b>`}<span>${esc(sp.name || sp.id)}</span><span class="mx-x" data-act="dropSpeaker" data-id="${esc(s.id)}" data-sid="${esc(sp.id)}" role="button" aria-label="Remove ${esc(sp.name)}">×</span></span>`;
function speakersBlock(s) {
  const open = st.sp && st.sp.id === s.id;
  return `
  <div class="mx-pr-speakers" data-role="speakers" data-id="${esc(s.id)}">
    <span class="label">${COPY.row.speakers}</span>
    <div class="mx-sp-chips">${(s.speakers || []).map(sp => speakerChip(s, sp)).join('')}</div>
    <div class="mx-sp-find">
      <input class="mx-pin" data-role="speakerQ" data-id="${esc(s.id)}" value="${esc(open ? st.sp.q : '')}" placeholder="${esc(COPY.row.speakerPh)}" autocomplete="off" aria-label="${COPY.row.speakerPh}">
      <div class="mx-sp-hits" data-role="spHits" data-id="${esc(s.id)}">${open ? speakerHits(s) : ''}</div>
    </div>
    <input class="mx-pin" ${inp(s, 'speaker_names')} value="${esc((s.speaker_names || []).map(n => n.name).join(', '))}" placeholder="${esc(COPY.row.namesPh)}" aria-label="${esc(COPY.row.namesPh)}">
  </div>`;
}
function speakerHits(s) {
  if (!st.sp || st.sp.id !== s.id || !st.sp.q.trim()) return '';
  const have = new Set(s.speaker_ids || []);
  const hits = (st.sp.hits || []).filter(h => !have.has(h.id));
  if (!hits.length) return `<div class="mx-sp-hit none">${st.sp.loading ? 'Searching…' : 'Nobody on the roster matches — type the name in the box below instead.'}</div>`;
  return hits.map(h => `<div class="mx-sp-hit" data-act="pickSpeaker" data-id="${esc(s.id)}" data-sid="${esc(h.id)}" role="option">${h.photo_url ? `<img src="${esc(h.photo_url)}" alt="">` : `<b>${esc(fmt.initials(h.name))}</b>`}<span><span class="n">${esc(h.name)}</span><span class="i">${esc([h.title, h.institution].filter(Boolean).join(' · '))}</span></span></div>`).join('');
}
function detailFields(s) {
  return `
  ${speakersBlock(s)}
  <div class="mx-pr-grid">
    <label><span class="label">${COPY.row.capacity}</span><input type="number" class="mx-pin" ${inp(s, 'capacity')} value="${s.capacity == null ? '' : esc(s.capacity)}" min="0" step="1" placeholder="${COPY.row.noCap}"></label>
    <label><span class="label">${COPY.row.track}</span><input class="mx-pin" ${inp(s, 'track')} value="${esc(s.track || '')}" placeholder="${COPY.row.track}"></label>
    <label class="wide"><span class="label">Location note</span><input class="mx-pin" ${inp(s, 'location_note')} value="${esc(s.location_note || '')}" placeholder="${esc(COPY.row.note)}"></label>
  </div>
  <label><span class="label">Description</span><textarea class="mx-pin mx-pr-desc" rows="2" ${inp(s, 'description')} placeholder="${esc(COPY.row.description)}">${esc(s.description || '')}</textarea></label>`;
}
function metaLine(s, cm) {
  const others = (cm[s.id] || []).map(id => byId(id)).filter(Boolean);
  const names = (s.speakers || []).map(x => x.name).concat((s.speaker_names || []).map(x => x.name)).filter(Boolean);
  return `
  <div class="mx-pr-meta">
    <span class="tag" style="background:${KIND_TINT[s.kind] ? KIND_TINT[s.kind][0] : '#eee9df'};color:${KIND_TINT[s.kind] ? KIND_TINT[s.kind][1] : '#4a4239'}">${esc(KIND_LABEL[s.kind] || s.kind)}</span>
    ${s.is_tbd ? `<span class="tag mx-tag-tbd">${COPY.row.tbd}</span>` : ''}
    ${!s.is_published ? `<span class="tag">${COPY.row.draft}</span>` : ''}
    ${others.map(o => `<span class="mx-pr-warn" title="Same room, overlapping times">${esc(COPY.row.overlaps(o.title || 'another session'))}</span>`).join('')}
    <span class="mx-pr-names">${names.length ? esc(names.slice(0, 4).join(', ')) + (names.length > 4 ? ` +${names.length - 4}` : '') : `<i>${COPY.row.noSpeakers}</i>`}</span>
    <div style="flex:1"></div>
    <span data-act="details" data-id="${esc(s.id)}" role="button" class="mx-pr-link" aria-expanded="${st.expanded.has(s.id)}">${st.expanded.has(s.id) ? COPY.row.less : COPY.row.details}</span>
    <span data-act="dup" data-id="${esc(s.id)}" role="button" class="mx-pr-link">${COPY.row.duplicate}</span>
    <span data-act="del" data-id="${esc(s.id)}" role="button" class="mx-pr-link danger">${COPY.row.remove}</span>
  </div>`;
}
function row(s, cm, i, n) {
  const over = s.capacity != null && s.count > s.capacity;
  const others = (cm[s.id] || []).map(id => byId(id)).filter(Boolean);
  return `
  <div class="mx-pr card${s.is_tbd ? ' tbd' : ''}${!s.is_published ? ' draft' : ''}${st.expanded.has(s.id) ? ' open' : ''}" data-row="${esc(s.id)}" data-id="${esc(s.id)}">
    <div class="mx-pr-main">
      <span class="mx-pr-handle" draggable="true" title="${COPY.row.drag}" aria-label="${COPY.row.drag}">⋮⋮</span>
      ${orderBtns(i, n, s)}
      ${timeInputs(s)}
      <input class="mx-pin mx-pr-title" ${inp(s, 'title')} value="${esc(s.title || '')}" placeholder="${COPY.row.title}" aria-label="${COPY.row.title}">
      ${kindSelect(s, 'mx-pr-kind')}
      <input class="mx-pin mx-pr-room" ${inp(s, 'room')} value="${esc(s.room || '')}" placeholder="${COPY.row.room}" aria-label="${COPY.row.room}">
      ${attCell(s)}
      ${toggles(s)}
    </div>
    ${metaLine(s, cm)}
    <div class="mx-pr-more">${detailFields(s)}</div>
    <div class="mx-pr-compact" data-act="openSheet" data-id="${esc(s.id)}" role="button">
      <div class="mx-pr-c-time">${esc(s.start_time || '—')}<i>${esc(s.end_time || '')}</i></div>
      <div class="mx-pr-c-body">
        <div class="mx-pr-c-title">${esc(s.title || COPY.add.newTitle)}</div>
        <div class="mx-pr-c-meta">
          <span class="tag" style="background:${KIND_TINT[s.kind] ? KIND_TINT[s.kind][0] : '#eee9df'};color:${KIND_TINT[s.kind] ? KIND_TINT[s.kind][1] : '#4a4239'}">${esc(KIND_LABEL[s.kind] || s.kind)}</span>
          ${s.room ? `<span>${esc(s.room)}</span>` : ''}
          ${s.is_tbd ? `<span class="tag mx-tag-tbd">${COPY.row.tbd}</span>` : ''}${!s.is_published ? `<span class="tag">${COPY.row.draft}</span>` : ''}
          ${others.length ? `<span class="mx-pr-warn">${esc(COPY.row.overlaps(others[0].title || ''))}</span>` : ''}
        </div>
      </div>
      <span class="mx-pr-c-att${over ? ' over' : ''}"><b>${fmt.num(s.count || 0)}</b>${s.capacity != null ? `<i>/ ${fmt.num(s.capacity)}</i>` : ''}</span>
      ${orderBtns(i, n, s)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- render: the phone sheet
function sheet() {
  if (!st.open) return '';
  const s = byId(st.open); if (!s) return '';
  const cm = conflictMap();
  const others = (cm[s.id] || []).map(id => byId(id)).filter(Boolean);
  return `
  <div class="mx-pg-sheet" data-block="sheet" role="dialog" aria-label="${esc(s.title || COPY.add.newTitle)}">
    <div class="mx-pg-sheet-in">
      <div class="mx-pg-sheet-head">
        <span style="${micro};color:#6d6459">${esc(COPY.row.sheetEyebrow(s.start_time, KIND_LABEL[s.kind] || s.kind))}</span>
        <div style="flex:1"></div>
        <span data-act="closeSheet" role="button" aria-label="Close" style="color:#6d6459;cursor:pointer;font:400 22px Inter,sans-serif;line-height:1;padding:8px">×</span>
      </div>
      <div class="mx-pg-sheet-body">
        <label><span class="label">${COPY.row.title}</span><input class="mx-pin mx-pg-sheet-title" ${inp(s, 'title')} value="${esc(s.title || '')}" placeholder="${COPY.row.title}"></label>
        <div class="mx-pr-grid two">
          <label><span class="label">${COPY.row.start}</span><input type="time" class="mx-pin" ${inp(s, 'start_time')} value="${esc(s.start_time || '')}"></label>
          <label><span class="label">${COPY.row.end}</span><input type="time" class="mx-pin" ${inp(s, 'end_time')} value="${esc(s.end_time || '')}"></label>
          <label><span class="label">${COPY.row.kindLabel}</span>${kindSelect(s, '')}</label>
          <label><span class="label">${COPY.row.room}</span><input class="mx-pin" ${inp(s, 'room')} value="${esc(s.room || '')}" placeholder="${COPY.row.room}"></label>
        </div>
        ${toggles(s)}
        ${others.map(o => `<span class="mx-pr-warn">${esc(COPY.row.overlaps(o.title || ''))}</span>`).join('')}
        ${detailFields(s)}
        <div class="mx-pg-sheet-row">
          <span class="label">Attendance</span>
          ${attCell(s)}
          <div style="flex:1"></div>
          ${orderBtns(dayRows(dayKey(s)).findIndex(x => x.id === s.id), dayRows(dayKey(s)).length, s)}
        </div>
        <div class="mx-pg-sheet-foot">
          <span data-act="dup" data-id="${esc(s.id)}" role="button" class="mx-pr-link">${COPY.row.duplicate}</span>
          <span data-act="del" data-id="${esc(s.id)}" role="button" class="mx-pr-link danger">${COPY.row.remove}</span>
          <div style="flex:1"></div>
          <span data-act="closeSheet" role="button" class="btn-primary" style="padding:12px 22px">${COPY.row.done}</span>
        </div>
      </div>
    </div>
  </div>`;
}
function template() {
  return `
<div data-screen-label="Admin Program" class="mx-program" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 56px;display:flex;flex-direction:column;gap:18px">
    ${blockTitle()}
    ${blockEvents()}
    ${blockInsight()}
    ${blockBar()}
    ${blockList()}
  </div>
  ${sheet()}
</div>`;
}

// ---------------------------------------------------------------- behaviour: rendering helpers
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
// only a field being typed in defers a re-render — a focused toggle/link (spans get tabindex from ui.installDelegates) must not
const focusInside = el => { const a = document.activeElement; return !!(el && a && el.contains(a) && a.matches && a.matches('input, textarea, select')); };
function rerenderList() {
  const cur = rootEl && rootEl.querySelector('[data-block="list"]');
  if (!cur) return;
  if (focusInside(cur)) { listDirty = true; return; }
  listDirty = false;
  cur.outerHTML = blockList();
  rootEl.querySelectorAll('textarea.mx-pr-desc').forEach(autosize);
}
function rerenderRow(id) {
  const cur = rootEl && rootEl.querySelector(`[data-row="${CSS.escape(id)}"]`);
  const s = byId(id);
  if (!cur || !s) { rerenderList(); return; }
  if (focusInside(cur)) { listDirty = true; return; }
  const rows = dayRows(dayKey(s)); const i = rows.findIndex(x => x.id === id);
  cur.outerHTML = row(s, conflictMap(), i, rows.length);
  const ta = rootEl.querySelector(`[data-row="${CSS.escape(id)}"] textarea.mx-pr-desc`); if (ta) autosize(ta);
}
function rerenderSheet() {
  const host = rootEl && rootEl.querySelector('.mx-program'); if (!host) return;
  const cur = host.querySelector('[data-block="sheet"]');
  if (cur && focusInside(cur)) { listDirty = true; return; }
  const html = sheet();
  if (cur) { if (html) cur.outerHTML = html; else cur.remove(); }
  else if (html) host.insertAdjacentHTML('beforeend', html);
  document.body.classList.toggle('mx-pg-sheet-open', !!st.open);
  host.querySelectorAll('[data-block="sheet"] textarea.mx-pr-desc').forEach(autosize);
}
function rerenderAll() { rerender('[data-block="title"]', blockTitle()); rerender('[data-block="events"]', blockEvents()); rerender('[data-block="insight"]', blockInsight()); rerender('[data-block="bar"]', blockBar()); rerenderList(); rerenderSheet(); }
function afterWrite() { rerender('[data-block="title"]', blockTitle()); rerender('[data-block="bar"]', blockBar()); rerenderList(); if (st.open) rerenderSheet(); refreshEventsQuiet(); }
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(44, ta.scrollHeight) + 'px'; }
function savedToast(text) { const now = Date.now(); if (now - lastToast < 1200 && !text) return; lastToast = now; ui.toast(text || COPY.toast.saved); }
// the picker chips carry counts and the insight strip carries taps — refreshed quietly after a write
let quietTimer = null;
function refreshEventsQuiet() {
  clearTimeout(quietTimer);
  quietTimer = setTimeout(async () => {
    try { await loadEvents(); const i = await api.get(base() + '/insight').catch(() => null); if (i) I = i; if (rootEl) { rerender('[data-block="events"]', blockEvents()); rerender('[data-block="insight"]', blockInsight()); } } catch (e) { /* next poll */ }
  }, 800);
}
async function refetch(full) {
  try {
    if (full) await loadEvents();
    if (!(await loadProgram()) || !rootEl) return;
    ensureDay();
    rerenderAll();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function switchEvent(key) {
  st.event = key; st.day = null; st.expanded = new Set(); st.sp = null; st.open = null;
  rerender('[data-block="events"]', blockEvents());
  const list = rootEl.querySelector('[data-block="list"]'); if (list) list.style.opacity = '.5';
  try { if (!(await loadProgram())) return; ensureDay(); setUrl(); rerenderAll(); }
  catch (e) { ui.toast(e.message, { kind: 'error' }); if (list) list.style.opacity = ''; }
}

// ---------------------------------------------------------------- behaviour: saving a field
function currentValue(s, field) {
  if (field === 'capacity') return s.capacity == null ? '' : String(s.capacity);
  if (field === 'speaker_names') return (s.speaker_names || []).map(n => n.name).join(', ');
  return String(s[field] == null ? '' : s[field]);
}
function bodyFor(s, field, raw) {
  const v = String(raw == null ? '' : raw);
  if (field === 'capacity') return { capacity: v.trim() === '' ? null : Number(v) };
  if (field === 'speaker_names') {
    // keep institution/topic for names that were already there (the Boston run of show carries both)
    const prev = s.speaker_names || [];
    const names = v.split(',').map(x => x.trim()).filter(Boolean);
    return { speaker_names: names.map(n => prev.find(p => p.name.toLowerCase() === n.toLowerCase()) || { name: n }) };
  }
  if (field === 'start_time') {
    // moving the start keeps the length of the session (and never trips "ends before it starts")
    const dur = toMin(s.start_time) != null && toMin(s.end_time) != null ? toMin(s.end_time) - toMin(s.start_time) : null;
    const out = { start_time: v || null };
    if (v && dur != null) out.end_time = fromMin(Math.min(toMin(v) + dur, 23 * 60 + 59));
    return out;
  }
  if (field === 'end_time') return { end_time: v || null };
  return { [field]: v };
}
const saving = new Map();   // id → chain, so two quick saves on one row land in order
async function saveField(id, field, raw) {
  const s = byId(id); if (!s) return;
  const before = currentValue(s, field);
  const after = field === 'capacity' ? String(raw == null ? '' : raw).trim() : String(raw == null ? '' : raw);
  if (before === after) return;
  const body = bodyFor(s, field, raw);
  const prev = Object.assign({}, s);
  patchLocal(Object.assign({}, s, body, field === 'speaker_names' ? { speaker_names: body.speaker_names } : {}));
  // the row keeps focus while a time is being typed (its re-render is deferred) — the moved end time must still show at once
  if (field === 'start_time' && body.end_time) rootEl.querySelectorAll(`input[data-field="end_time"][data-id="${CSS.escape(id)}"]`).forEach(el => { el.value = body.end_time; });
  const run = async () => {
    const wasInConflict = Object.keys(conflictMap());   // rows whose OVERLAPS chip may now vanish
    try {
      const r = await api.put(sPath(id), body);
      if (r && r.session) patchLocal(r.session);
      if (r && r.conflicts) P.conflicts = r.conflicts;
      savedToast();
      rerenderRow(id); if (st.open === id) rerenderSheet();
      rerender('[data-block="title"]', blockTitle());
      if (field === 'start_time' || field === 'end_time' || field === 'room') new Set(wasInConflict.concat(Object.keys(conflictMap()))).forEach(k => { if (k !== id) rerenderRow(k); });
      refreshEventsQuiet();
    } catch (e) {
      patchLocal(prev); listDirty = false; rerenderRow(id); if (st.open === id) rerenderSheet();
      ui.toast(e.message, { kind: 'error' });
    }
  };
  const chain = (saving.get(id) || Promise.resolve()).then(run, run);
  saving.set(id, chain);
  await chain;
}
async function toggleFlag(id, k) {
  const s = byId(id); if (!s) return;
  const next = s[k] ? 0 : 1;
  const prev = Object.assign({}, s);
  patchLocal(Object.assign({}, s, { [k]: !!next }));
  rerenderRow(id); if (st.open === id) rerenderSheet();
  try {
    const r = k === 'is_published' ? await api.put(sPath(id) + '/publish', { is_published: next })
      : k === 'is_tbd' ? await api.put(sPath(id) + '/tbd', { is_tbd: next })
      : await api.put(sPath(id), { show_counts: next });
    if (r && r.session) patchLocal(r.session);
    const t = COPY.toast;
    ui.toast(k === 'is_published' ? (next ? t.published : t.unpublished) : k === 'is_tbd' ? (next ? t.tbdOn : t.tbdOff) : (next ? t.countsOn : t.countsOff));
    afterWrite();
  } catch (e) { patchLocal(prev); listDirty = false; rerenderRow(id); if (st.open === id) rerenderSheet(); ui.toast(e.message, { kind: 'error' }); }
}
async function reorder(order, quiet) {
  try {
    const r = await api.put(base() + '/sessions/reorder', { order });
    takeListing(r);
    if (!quiet) ui.toast(COPY.toast.reordered);
    listDirty = false; rerenderList(); if (st.open) rerenderSheet(); rerender('[data-block="title"]', blockTitle());
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
// The program is a timeline: the server lists rows by start time, then by sort_order. A drag or an
// arrow therefore only holds between rows that share a start time (or have none — TBD rows without a
// clock yet); moving a 19:00 row above an 18:00 one is a time change, and the toast says so.
function chronoOk(order, id) {
  const at = order.indexOf(id); const t = toMin((byId(id) || {}).start_time);
  if (at < 0 || t == null) return true;
  const prev = at > 0 ? toMin((byId(order[at - 1]) || {}).start_time) : null;
  const next = at < order.length - 1 ? toMin((byId(order[at + 1]) || {}).start_time) : null;
  return (prev == null || prev <= t) && (next == null || t <= next);
}
// would ↑/↓ keep the day in clock order? (timed rows follow their start time — the arrows used to
// look enabled and only answer "rows follow the clock")
function canMove(id, dir) {
  const s = byId(id); if (!s) return false;
  const rows = dayRows(dayKey(s)); const i = rows.findIndex(x => x.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return false;
  const order = rows.map(x => x.id); order.splice(i, 1); order.splice(j, 0, id);
  return chronoOk(order, id);
}
function move(id, dir) {
  const s = byId(id); if (!s) return;
  const rows = dayRows(dayKey(s)); const i = rows.findIndex(x => x.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  const order = rows.map(x => x.id); order.splice(i, 1); order.splice(j, 0, id);
  if (!chronoOk(order, id)) { ui.toast(COPY.toast.clock); return; }
  reorder(order, true);
}
function restoreBody(s) {
  return { id: s.id, title: s.title, kind: s.kind, event_date: s.event_date, start_time: s.start_time, end_time: s.end_time, room: s.room, location_note: s.location_note, track: s.track, capacity: s.capacity, description: s.description,
    speaker_ids: s.speaker_ids || [], speaker_names: s.speaker_names || [], is_tbd: s.is_tbd ? 1 : 0, show_counts: s.show_counts ? 1 : 0, is_published: s.is_published ? 1 : 0, sort_order: s.sort_order };
}
async function addRow(kind, day) {
  const rows = dayRows(st.day);
  const last = rows.length ? rows[rows.length - 1] : null;
  const ev = currentEvent();
  const startMin = toMin(last && last.end_time) != null ? toMin(last.end_time) : toMin(ev && ev.start) != null ? toMin(ev.start) : 9 * 60;
  const isBreak = kind === 'break';
  const body = { title: isBreak ? COPY.add.breakTitle : COPY.add.newTitle, kind: isBreak ? 'break' : 'talk', event_date: day || null, start_time: fromMin(startMin), end_time: fromMin(Math.min(startMin + (isBreak ? BREAK_MIN : SESSION_MIN), 23 * 60 + 59)),
    room: last ? last.room : '', is_published: isBreak ? 1 : 0, is_tbd: 0, after_id: last ? last.id : undefined };
  try {
    const r = await api.post(base() + '/sessions', body);
    if (r && r.session) { patchLocal(r.session); if (r.conflicts) P.conflicts = r.conflicts; if (!isBreak) st.expanded.add(r.session.id); }
    // the server keeps the day list — refetch keeps the grouping honest (a new day may have appeared)
    await loadProgram(); ensureDay();
    listDirty = false; rerender('[data-block="bar"]', blockBar()); rerenderList(); rerender('[data-block="title"]', blockTitle());
    ui.toast(isBreak ? COPY.toast.breakAdded : COPY.toast.added);
    const made = r && r.session ? r.session.id : null;
    if (made) {
      if (isPhone()) { st.open = made; rerenderSheet(); const i = rootEl.querySelector('[data-block="sheet"] input[data-field="title"]'); if (i) { i.focus(); i.select(); } }
      else { const i = rootEl.querySelector(`[data-row="${CSS.escape(made)}"] input[data-field="title"]`); if (i) { i.focus(); i.select(); i.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
    }
    refreshEventsQuiet();
  } catch (e) { ui.toast(e.message, { kind: 'error' }); }
}
async function downloadCsv() {
  try {
    const res = await fetch(api.url(base() + '/attendance.csv'), { headers: { Authorization: 'Bearer ' + session.token, Accept: 'text/csv' } });
    if (!res.ok) throw new Error(COPY.toast.csvFail);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `plexus-live-attendance-${String(st.event).replace(/[^a-z0-9]+/gi, '-')}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ui.toast(COPY.toast.csv);
  } catch (e) { ui.toast(e.message || COPY.toast.csvFail, { kind: 'error' }); }
}
async function openAttendance(id) {
  const s = byId(id); if (!s) return;
  let people = [], count = s.count || 0;
  try { const r = await api.get(base() + '/attendance'); const row = (r.sessions || []).find(x => x.id === id); if (row) { people = row.people || []; count = row.count; } }
  catch (e) { ui.toast(e.message, { kind: 'error' }); return; }
  const att = people.filter(p => p.state === 'attending'), dec = people.filter(p => p.state !== 'attending');
  const over = s.capacity != null && count > s.capacity;
  const line = p => `<div class="mx-att-row${p.state !== 'attending' ? ' off' : ''}"><span class="mx-att-av">${esc(fmt.initials(p.name))}</span><span class="mx-att-n">${esc(p.name)}</span><span class="mx-att-p">${p.state !== 'attending' ? COPY.attendance.declined : esc(COPY.attendance.party(p.party))}</span><span class="mx-att-w">${esc(fmt.when(p.updated_at))}</span></div>`;
  ui.modal({
    eyebrow: COPY.attendance.eyebrow,
    title: `${esc(s.title || COPY.add.newTitle)}<span style="display:block;font:600 9px Inter,sans-serif;letter-spacing:.14em;color:${over ? '#9b1b22' : '#6d6459'};margin-top:6px">${esc(COPY.attendance.cap(count, s.capacity).toUpperCase())}${s.start_time ? ' · ' + esc(s.start_time) : ''}${s.room ? ' · ' + esc(s.room.toUpperCase()) : ''}</span>`,
    body: att.length || dec.length ? `<div class="mx-att-list">${att.map(line).join('')}${dec.length ? `<div class="mx-att-sep">${COPY.attendance.declined.toUpperCase()}</div>${dec.map(line).join('')}` : ''}</div>` : `<div style="font-family:Fraunces,serif;font-style:italic;font-size:16px;color:#201b16">${COPY.attendance.none}</div>`,
    actions: [{ label: COPY.attendance.csv, onClick: () => { downloadCsv(); return false; } }, { label: COPY.attendance.close, kind: 'ink' }]
  });
}
let spTimer = null;
function speakerSearch(id, qv) {
  st.sp = { id, q: qv, hits: st.sp && st.sp.id === id ? st.sp.hits : [], loading: true };
  clearTimeout(spTimer);
  const paint = () => { rootEl.querySelectorAll(`[data-role="spHits"][data-id="${CSS.escape(id)}"]`).forEach(el => { el.innerHTML = speakerHits(byId(id) || { id, speaker_ids: [] }); }); };
  if (!qv.trim()) { st.sp.loading = false; paint(); return; }
  paint();
  spTimer = setTimeout(async () => {
    try { const r = await api.get('/api/v2/program/speakers?q=' + encodeURIComponent(qv.trim())); if (st.sp && st.sp.id === id && st.sp.q === qv) { st.sp.hits = r.speakers || []; st.sp.loading = false; paint(); } }
    catch (e) { if (st.sp) { st.sp.loading = false; st.sp.hits = []; paint(); } }
  }, 220);
}
async function setSpeakers(id, ids, toast) {
  const s = byId(id); if (!s) return;
  const prev = Object.assign({}, s);
  try {
    const r = await api.put(sPath(id), { speaker_ids: ids });
    if (r && r.session) patchLocal(r.session);
    st.sp = null; listDirty = false;
    rerenderRow(id); if (st.open === id) rerenderSheet(); rerender('[data-block="title"]', blockTitle());
    ui.toast(toast);
    refreshEventsQuiet();
  } catch (e) { patchLocal(prev); ui.toast(e.message, { kind: 'error' }); }
}

// ---------------------------------------------------------------- behaviour: handlers
const handlers = {
  pick: el => { const key = el.dataset.key; if (key && key !== st.event) switchEvent(key); },
  day: el => { st.day = el.dataset.day; st.sp = null; setUrl(); rerender('[data-block="bar"]', blockBar()); listDirty = false; rerenderList(); },
  details: el => { const id = el.dataset.id; if (st.expanded.has(id)) st.expanded.delete(id); else st.expanded.add(id); listDirty = false; rerenderRow(id); if (st.expanded.has(id)) { const ta = rootEl.querySelector(`[data-row="${CSS.escape(id)}"] textarea.mx-pr-desc`); if (ta) autosize(ta); } },
  toggle: el => toggleFlag(el.dataset.id, el.dataset.k),
  attendance: el => openAttendance(el.dataset.id),
  moveUp: el => move(el.dataset.id, -1),
  moveDown: el => move(el.dataset.id, +1),
  add: el => addRow('talk', el.dataset.day || null),
  addBreak: el => addRow('break', el.dataset.day || null),
  dup: async el => {
    const id = el.dataset.id;
    try {
      const r = await api.post(sPath(id) + '/duplicate');
      if (r && r.session) { await loadProgram(); ensureDay(); st.expanded.add(r.session.id); listDirty = false; rerender('[data-block="bar"]', blockBar()); rerenderList(); rerender('[data-block="title"]', blockTitle()); if (st.open) { st.open = r.session.id; rerenderSheet(); } ui.toast(COPY.toast.duplicated); refreshEventsQuiet(); }
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  del: async el => {
    const id = el.dataset.id; const s = byId(id); if (!s) return;
    const snapshot = Object.assign({}, s);
    P.sessions = P.sessions.filter(x => x.id !== id); st.expanded.delete(id);
    if (st.open === id) { st.open = null; rerenderSheet(); }
    listDirty = false; rerenderList(); rerender('[data-block="bar"]', blockBar());
    try {
      const r = await api.del(sPath(id));
      const gone = (r && r.session) || snapshot;
      takeListing({ updated_at: new Date().toISOString() }); rerender('[data-block="title"]', blockTitle()); refreshEventsQuiet();
      ui.toast(COPY.toast.deleted, { undo: async () => {
        try { const back = await api.post(base() + '/sessions', restoreBody(gone)); if (back && back.session) { patchLocal(back.session); if (back.conflicts) P.conflicts = back.conflicts; } await loadProgram(); ensureDay(); listDirty = false; rerender('[data-block="bar"]', blockBar()); rerenderList(); ui.toast(COPY.toast.restored); refreshEventsQuiet(); }
        catch (e) { ui.toast(e.message, { kind: 'error' }); }
      } });
    } catch (e) { P.sessions.push(snapshot); await loadProgram().catch(() => {}); listDirty = false; rerenderList(); rerender('[data-block="bar"]', blockBar()); ui.toast(e.message, { kind: 'error' }); }
  },
  publishAll: async el => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    try { const r = await api.put(base() + '/publish', { is_published: 1 }); takeListing(r); afterWrite(); ui.toast(r.changed ? COPY.toast.publishedAll(r.changed) : COPY.toast.nothingToChange); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  unpublishAll: async el => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    if (!await ui.confirm(Object.assign({ eyebrow: 'PLEASE CONFIRM' }, COPY.confirm.unpublishAll))) return;
    try { const r = await api.put(base() + '/publish', { is_published: 0 }); takeListing(r); afterWrite(); ui.toast(r.changed ? COPY.toast.unpublishedAll(r.changed) : COPY.toast.nothingToChange); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  shift: async () => {
    const a = rootEl.querySelector('[data-role="shiftAfter"]'), m = rootEl.querySelector('[data-role="shiftMin"]');
    const after = a ? a.value : '', mins = m ? Number(m.value) : NaN;
    st.shiftAfter = after; st.shiftMin = m ? m.value : '';
    if (!/^\d{2}:\d{2}$/.test(after) || !Number.isInteger(mins) || !mins) { ui.toast(COPY.toast.shiftBad, { kind: 'error' }); (after ? m : a).focus(); return; }
    const d = days().find(x => x.key === st.day); const date = d && d.date ? d.date : undefined;
    const doShift = async (aft, mn, quiet) => {
      const r = await api.post(base() + '/sessions/shift', { after: aft, minutes: mn, date });
      takeListing(r); afterWrite();
      return r;
    };
    try {
      const r = await doShift(after, mins);
      st.shiftMin = ''; rerender('[data-block="bar"]', blockBar());
      ui.toast(COPY.toast.shifted(r.moved || 0, mins), r.moved ? { undo: async () => { try { const back = await doShift(fromMin(toMin(after) + mins), -mins, true); ui.toast(COPY.toast.shifted(back.moved || 0, -mins)); } catch (e) { ui.toast(e.message, { kind: 'error' }); } } } : undefined);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  pickSpeaker: el => { const s = byId(el.dataset.id); if (!s) return; const hit = (st.sp && st.sp.hits || []).find(h => h.id === el.dataset.sid); setSpeakers(s.id, (s.speaker_ids || []).concat([el.dataset.sid]), COPY.toast.speakerAdded(hit ? hit.name : 'speaker')); },
  dropSpeaker: el => { const s = byId(el.dataset.id); if (!s) return; setSpeakers(s.id, (s.speaker_ids || []).filter(x => x !== el.dataset.sid), COPY.toast.speakerRemoved); },
  openSheet: el => { st.open = el.dataset.id; rerenderSheet(); },
  closeSheet: () => { const a = document.activeElement; if (a && a.matches && a.matches('[data-field]')) a.blur(); st.open = null; st.sp = null; rerenderSheet(); listDirty = false; rerenderList(); }
};

// input / change / focusout / keydown / drag listeners on the view root (they survive every innerHTML swap)
function bindRootListeners(root) {
  const onInput = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('[data-role="speakerQ"]')) { speakerSearch(t.dataset.id, t.value); return; }
    if (t.matches('textarea.mx-pr-desc')) autosize(t);
    if (t.matches('[data-role="shiftAfter"]')) st.shiftAfter = t.value;
    if (t.matches('[data-role="shiftMin"]')) st.shiftMin = t.value;
  };
  const onChange = e => {
    const t = e.target; if (!t || !t.matches) return;
    if (t.matches('select[data-field], input[type="time"][data-field]')) saveField(t.dataset.id, t.dataset.field, t.value);
  };
  const onBlur = e => {
    const t = e.target;
    if (t && t.matches && t.matches('input[data-field], textarea[data-field]') && TEXT_FIELDS.includes(t.dataset.field)) saveField(t.dataset.id, t.dataset.field, t.value);
    if (t && t.matches && t.matches('[data-role="speakerQ"]')) { setTimeout(() => { const a = document.activeElement; if (!(a && a.closest && a.closest('.mx-sp-find'))) { if (st.sp && st.sp.id === t.dataset.id) { st.sp = null; root.querySelectorAll(`[data-role="spHits"][data-id="${CSS.escape(t.dataset.id)}"]`).forEach(el => { el.innerHTML = ''; }); } } }, 120); }
    // a deferred re-render (a save landed while this row had focus) runs once focus has left the list
    setTimeout(() => { if (!listDirty || !rootEl) return; const list = rootEl.querySelector('[data-block="list"]'); const sh = rootEl.querySelector('[data-block="sheet"]'); if (!focusInside(list) && !focusInside(sh)) { rerenderList(); if (st.open) rerenderSheet(); } }, 0);
  };
  const onKey = e => {
    const t = e.target;
    if (e.key === 'Escape') { if (st.sp) { st.sp = null; root.querySelectorAll('[data-role="spHits"]').forEach(el => { el.innerHTML = ''; }); if (t && t.blur) t.blur(); return; } if (st.open) { handlers.closeSheet(); return; } }
    if (e.key === 'Enter' && t && t.matches) {
      if (t.matches('input[data-field]') && !t.matches('[type="time"]')) { e.preventDefault(); t.blur(); }
      else if (t.matches('[data-role="speakerQ"]')) { e.preventDefault(); const first = root.querySelector(`[data-role="spHits"][data-id="${CSS.escape(t.dataset.id)}"] [data-act="pickSpeaker"]`); if (first) handlers.pickSpeaker(first); }
      else if (t.matches('[data-role="shiftAfter"], [data-role="shiftMin"]')) { e.preventDefault(); handlers.shift(); }
      else if ((e.metaKey || e.ctrlKey) && t.matches('textarea[data-field]')) { e.preventDefault(); t.blur(); }
    }
  };
  // clicking a typeahead hit must not blur the input first (the dropdown would vanish under the pointer)
  const onDown = e => { const hit = e.target.closest && e.target.closest('.mx-sp-hits'); if (hit) e.preventDefault(); };
  // HTML5 drag-and-drop within the day (the handle is the only draggable — inputs keep their text selection)
  const onDragStart = e => {
    const h = e.target.closest && e.target.closest('.mx-pr-handle'); const card = h && h.closest('.mx-pr'); if (!card) { e.preventDefault(); return; }
    st.dragging = card.dataset.id; card.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', st.dragging); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(card, 24, 24); } catch (err) {}
  };
  const clearOver = () => root.querySelectorAll('.mx-pr.over-top, .mx-pr.over-bottom').forEach(c => c.classList.remove('over-top', 'over-bottom'));
  const onDragEnd = () => { st.dragging = null; root.querySelectorAll('.mx-pr.dragging').forEach(c => c.classList.remove('dragging')); clearOver(); };
  const onDragOver = e => {
    if (!st.dragging) return;
    const card = e.target.closest && e.target.closest('.mx-pr'); if (!card || card.dataset.id === st.dragging) { if (card) e.preventDefault(); return; }
    e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
    const r = card.getBoundingClientRect(); const top = e.clientY < r.top + r.height / 2;
    clearOver(); card.classList.add(top ? 'over-top' : 'over-bottom');
  };
  const onDragLeave = e => { const card = e.target.closest && e.target.closest('.mx-pr'); if (card && !card.contains(e.relatedTarget)) card.classList.remove('over-top', 'over-bottom'); };
  const onDrop = e => {
    if (!st.dragging) return;
    const card = e.target.closest && e.target.closest('.mx-pr'); const id = st.dragging;
    e.preventDefault();
    if (!card || card.dataset.id === id) { onDragEnd(); return; }
    const top = card.classList.contains('over-top');
    onDragEnd();
    const rows = dayRows(st.day).map(x => x.id).filter(x => x !== id);
    const at = rows.indexOf(card.dataset.id); if (at < 0) return;
    rows.splice(top ? at : at + 1, 0, id);
    if (!chronoOk(rows, id)) { ui.toast(COPY.toast.clock); return; }
    // paint the new order at once; the server confirms it
    const list = root.querySelector('[data-block="list"]'); const el = root.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (list && el) { const ref = root.querySelector(`[data-row="${CSS.escape(card.dataset.id)}"]`); if (ref) list.insertBefore(el, top ? ref : ref.nextSibling); }
    reorder(rows);
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('keydown', onKey);
  root.addEventListener('mousedown', onDown);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragend', onDragEnd);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
  return () => {
    clearTimeout(spTimer); clearTimeout(quietTimer);
    root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('focusout', onBlur); root.removeEventListener('keydown', onKey); root.removeEventListener('mousedown', onDown);
    root.removeEventListener('dragstart', onDragStart); root.removeEventListener('dragend', onDragEnd); root.removeEventListener('dragover', onDragOver); root.removeEventListener('dragleave', onDragLeave); root.removeEventListener('drop', onDrop);
  };
}

export default {
  title: 'Program',
  async render(root, ctx) {
    rootEl = root; loadCss();
    st = { event: null, day: null, expanded: new Set(), sp: null, open: null, dragging: null, shiftAfter: '', shiftMin: '' };
    D = null; P = null; I = null; listDirty = false;
    try {
      await loadEvents();
      const want = ctx.params && ctx.params.eventKey;
      const list = events();
      st.event = (want && list.some(e => e.key === want) && want) || (list.some(e => e.key === 'conference') ? 'conference' : (list[0] && list[0].key)) || want || 'conference';
      if (list.length || want) await loadProgram();
    } catch (e) { root.innerHTML = `<div class="empty" style="padding:60px 20px"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">The program did not load.</span><span class="empty-why">${esc(e.message)}</span></div>`; return; }
    if (rootEl !== root) return;
    if (ctx.query && ctx.query.day) st.day = ctx.query.day;
    ensureDay(); setUrl();
    root.innerHTML = template();
    root.querySelectorAll('textarea.mx-pr-desc').forEach(autosize);
    unbind = ui.bind(root, handlers);
    unlisten = bindRootListeners(root);
    // the other editor's changes (and the guests' taps) arrive on their own — a quiet refresh while nothing is being typed or dragged
    poll = setInterval(() => {
      if (document.hidden || st.dragging || st.open || st.sp) return;
      const a = document.activeElement; if (a && a.matches && a.matches('input, textarea, select') && rootEl && rootEl.contains(a)) return;
      refetch(true);
    }, POLL_MS);
  },
  destroy() {
    reqId++; if (poll) clearInterval(poll); poll = null;
    if (unbind) unbind(); if (unlisten) unlisten(); unbind = null; unlisten = null;
    document.body.classList.remove('mx-pg-sheet-open');
    rootEl = null; D = null; P = null; I = null; st = null; listDirty = false; saving.clear();
  }
};
