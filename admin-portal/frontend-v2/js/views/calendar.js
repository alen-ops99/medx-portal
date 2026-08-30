// Source: Admin Calendar.dc.html
// Blocks (artboard order): "Calendar header row" (title · EXPORT PDF · EXPORT CSV · + ADD ENTRY) ›
// "NEXT UP" › "New entry panel" › "Year board" (per-year 12-month grids, TODAY line, ✎ EDIT ENTRIES) ›
// "TEAM TASKS" + "KEY DATES" › v2: hidden print board (EXPORT PDF = print-ready one-page year board,
// README note 23 — client print stylesheet in css/views/calendar.css + window.print()).
// Data: the board IS /api/admin/year-calendar (add = POST, ✕ = DELETE with UNDO re-create);
// NEXT UP + KEY DATES compose the /api/v2/calendar/key-dates union (entries · conferences ·
// bridges · live gala early-bird prices); TEAM TASKS is the SAME /api/admin/tasks list Today shows
// (note 17 — ticking here completes for everyone). Header comes from js/chrome.js.
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, routeForSection } from '../facts.js';
import { chrome } from '../chrome.js';

export const SOURCE = 'Admin Calendar.dc.html';

export const COPY = {
  title: 'Calendar', sub: 'everything Med&amp;X is running, this year and next',
  exportPdf: 'EXPORT PDF', exportPdfTitle: 'A print-ready year board in the Med&X look — one page; your browser\'s print dialog opens, choose "Save as PDF"',
  exportPdfToast: 'PRINT-READY YEAR BOARD — CHOOSE “SAVE AS PDF” IN THE DIALOG',
  exportCsv: 'EXPORT CSV', exportedCsv: 'CALENDAR EXPORTED · CSV', addEntry: '+ ADD ENTRY',
  nextUp: { label: 'NEXT UP', inDays: n => n === 0 ? 'today' : `in ${fmt.plural(n, 'day')}`, open: p => `OPEN ${String(p || 'calendar').toUpperCase()} →`, none: 'Nothing dated ahead — add the next thing to the board.' },
  add: {
    label: 'NEW ENTRY', ph: 'What — e.g. Sponsor dinner, Split', confirmed: 'confirmed', btn: y => `ADD TO ${y}`,
    dayPh: 'day', added: y => `ADDED TO THE ${y} BOARD`, needName: 'NAME THE ENTRY FIRST',
    months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
    projects: [['Plexus', 'plexus'], ['Gala', 'gala'], ['Bridges', 'bridges'], ['Forum', 'forum'], ['Other', 'other']]
  },
  board: {
    legendNote: 'solid = confirmed · outlined = potential · the red line is today',
    edit: '✎ EDIT ENTRIES', doneEditing: '✓ DONE EDITING', today: 'TODAY',
    removed: 'ENTRY REMOVED', restored: 'ENTRY PUT BACK', deleteTitle: 'Delete this entry',
    legend: [['PLEXUS', '#9b1b22'], ['GALA', '#c9a962'], ['BRIDGES', '#3f5f8a'], ['FORUM', '#6a4a8c']],
    empty: 'The board is empty — + ADD ENTRY puts the first thing on it.'
  },
  tasks: {
    title: 'TEAM TASKS', note: 'tick it and it disappears for everyone', ph: 'Add a task — e.g. “Book the Esplanade tasting menu call”',
    add: 'ADD', team: 'TEAM', empty: 'All clear — nothing open.',
    done: 'DONE — REMOVED FOR THE WHOLE TEAM', added: 'TASK ADDED — IT SHOWS ON TODAY TOO', typeFirst: 'TYPE THE TASK FIRST',
    overdue: n => `Overdue — ${fmt.plural(n, 'day')}`, dueToday: 'Due today', due: d => `Due ${fmt.dayShort(d)}`,
    tickTitle: 'Tick = done for the whole team — undo appears for a few seconds'
  },
  keyDates: {
    title: 'KEY DATES', thisYear: y => `THIS YEAR — ${y}`, nextYear: y => `NEXT YEAR — ${y}`,
    earlyBird: (e, r) => `Gala early-bird ends — ${fmt.eur(e)} → ${fmt.eur(r)}`,
    foot: 'The board, NEXT UP and this list read the same live entries.'
  },
  print: {
    title: y => `The year at Med&X — ${y}`, subtitle: 'Plexus Week · Gala Evening · Building Bridges · Biomedical Forum · Accelerator',
    keyDates: 'KEY DATES', legendConfirmed: 'confirmed', legendPotential: 'potential',
    foot: () => `Generated ${fmt.todayLabel().toLowerCase()} · medx.hr`
  }
};

const MONTHS = COPY.add.months;
const PROJ_COLOR = { plexus: '#9b1b22', gala: '#c9a962', bridges: '#3f5f8a', forum: '#6a4a8c', accelerator: '#9b1b22', other: '#201b16' };
const HAIR = 'rgba(32,27,22,.14)', HAIR12 = 'rgba(32,27,22,.12)', HAIR06 = 'rgba(32,27,22,.06)', CELL_L = '1px solid rgba(32,27,22,.06)';

let D = null, st = null, unbind = null, rootEl = null, cssEl = null;

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    cal: api.get('/api/admin/year-calendar'),
    kd: api.get('/api/v2/calendar/key-dates'),
    tasks: api.get('/api/admin/tasks'),
    team: api.get('/api/team')
  });
  return {
    errors: r.$errors,
    cal: (Array.isArray(r.cal) ? r.cal : []).filter(e => /^\d{4}-\d{2}-\d{2}/.test(String(e.starts_on || ''))),
    kd: r.kd || { entries: [], conferences: [], bridges: [], gala: null },
    tasks: (Array.isArray(r.tasks) ? r.tasks : []).filter(t => t.status !== 'done'),
    team: Array.isArray(r.team) ? r.team : []
  };
}
const entryColor = e => e.color || PROJ_COLOR[String(e.project || 'other').toLowerCase()] || '#201b16';
const yearOf = d => Number(String(d).slice(0, 4));
function boardYears() {
  const now = new Date().getFullYear();
  const ys = new Set([now, now + 1]);
  D.cal.forEach(e => ys.add(yearOf(e.starts_on)));
  return [...ys].sort();
}
function entryCells(e, year) { // month indices the entry spans inside `year`
  const s = fmt.toDate(e.starts_on), x = fmt.toDate(e.ends_on) || s;
  const out = [];
  for (let m = 0; m < 12; m++) {
    const mStart = new Date(year, m, 1), mEnd = new Date(year, m + 1, 0);
    if (s <= mEnd && x >= mStart) out.push(m);
  }
  return out;
}
function dateLine(e) {
  const bits = [fmt.rangeLabel(e.starts_on, e.ends_on)];
  if (e.notes) bits.push(e.notes);
  else if (e.project) bits.push(String(e.project)[0].toUpperCase() + String(e.project).slice(1));
  return bits.join(' · ');
}

// One merged, deduped feed for NEXT UP + KEY DATES + the print board's key-dates column.
const kdWords = s => String(s || '').toLowerCase().match(/[a-zà-žšđčćž]{4,}/g) || [];
function kdClash(items, d, title) { // same month + a shared significant word = the same thing, said twice
  const w = kdWords(title);
  return items.some(i => i.d.slice(0, 7) === String(d).slice(0, 7) && kdWords(i.title).some(x => w.includes(x)));
}
function keyDateItems() {
  const items = D.cal.map(e => ({ d: String(e.starts_on).slice(0, 10), end: e.ends_on ? String(e.ends_on).slice(0, 10) : null, t: e.title + (e.notes ? ' · ' + e.notes : ''), title: e.title, project: String(e.project || 'other').toLowerCase(), c: entryColor(e), src: 'entry' }));
  const g = D.kd.gala;
  if (g && g.deadline && !items.some(i => i.d === g.deadline && /early[- ]?bird/i.test(i.title))) {
    items.push({ d: g.deadline, end: null, t: COPY.keyDates.earlyBird(g.early || FACTS.gala.priceEarly, g.regular || FACTS.gala.priceRegular), title: 'Gala early-bird', project: 'gala', c: PROJ_COLOR.gala, src: 'gala' });
  }
  (D.kd.bridges || []).forEach(b => {
    if (!kdClash(items, b.event_date, b.name)) {
      items.push({ d: b.event_date, end: null, t: b.name + (b.city && !b.name.toLowerCase().includes(String(b.city).toLowerCase()) ? ' · ' + b.city : ''), title: b.name, project: 'bridges', c: PROJ_COLOR.bridges, src: 'bridges' });
    }
  });
  (D.kd.conferences || []).forEach(cf => {
    if (!kdClash(items, cf.start_date, cf.name)) {
      items.push({ d: cf.start_date, end: cf.end_date, t: cf.name + (cf.venue ? ' · ' + cf.venue : ''), title: cf.name, project: 'plexus', c: PROJ_COLOR.plexus, src: 'conference' });
    }
  });
  // canonical wording gap-fill (FACTS) — only when nothing on the board says it already
  if (!items.some(i => /accelerator/i.test(i.title))) items.push({ d: FACTS.accelerator.opens, end: null, t: 'Accelerator applications open', title: 'Accelerator applications open', project: 'plexus', c: PROJ_COLOR.accelerator, src: 'facts' });
  if (!items.some(i => /forum/i.test(i.title))) items.push({ d: FACTS.forum.gathering.start, end: FACTS.forum.gathering.end, t: `Biomedical Forum gathering · ${FACTS.forum.gathering.where}`, title: 'Biomedical Forum gathering', project: 'forum', c: PROJ_COLOR.forum, src: 'facts' });
  return items.sort((a, b) => a.d.localeCompare(b.d));
}
const upcomingKeyDates = () => { const today = fmt.ymd(new Date()); return keyDateItems().filter(i => (i.end || i.d) >= today); };
function nextUp() {
  const up = upcomingKeyDates();
  if (!up.length) return null;
  const first = up.filter(i => i.d === up[0].d);
  return first.find(i => /early[- ]?bird/i.test(i.title)) || first.find(i => i.src === 'gala') || first[0];
}

// ---------------------------------------------------------------- blocks
function blockHead() {
  return `
  <!-- dc: Admin Calendar.dc.html › "Calendar header row" -->
  <div data-block="head" style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
    <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
    <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
    <div style="flex:1"></div>
    <span data-act="exportPdf" title="${esc(COPY.exportPdfTitle)}" style="padding:9px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.exportPdf}</span>
    <span data-act="exportCsv" style="padding:9px 14px;border:1px solid rgba(32,27,22,.2);font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${COPY.exportCsv}</span>
    <span data-act="addToggle" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.addEntry}</span>
  </div>
  <!-- /dc -->`;
}

function blockNextUp() {
  const n = nextUp();
  if (!n) return `
  <!-- dc: Admin Calendar.dc.html › "NEXT UP" -->
  <div data-block="nextup" style="border:1px solid ${HAIR};border-left:3px solid #c9a962;background:#fff;padding:14px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${COPY.nextUp.label}</span>
    <span style="font-size:13px;color:#6d6459">${COPY.nextUp.none}</span>
  </div>
  <!-- /dc -->`;
  const days = Math.max(0, fmt.daysUntil(n.d) || 0);
  const g = D.kd.gala;
  const priceLine = (n.src === 'gala' || /early[- ]?bird/i.test(n.title)) && g
    ? `price moves ${fmt.eur(g.early || FACTS.gala.priceEarly)} → ${fmt.eur(g.regular || FACTS.gala.priceRegular)}`
    : n.t !== n.title ? n.t.replace(n.title, '').replace(/^ ?· ?/, '') : '';
  return `
  <!-- dc: Admin Calendar.dc.html › "NEXT UP" -->
  <div data-block="nextup" style="border:1px solid ${HAIR};border-left:3px solid #c9a962;background:#fff;padding:14px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${COPY.nextUp.label}</span>
    <span style="font-size:13.5px;font-weight:600">${esc(n.title)} — ${esc(fmt.longRange(n.d, n.end).replace(', ' + yearOf(n.d), ''))}</span>
    <span style="font-size:12px;color:#6d6459">${esc(COPY.nextUp.inDays(days))}${priceLine ? ' · ' + esc(priceLine) : ''}</span>
    <div style="flex:1"></div>
    <a href="${esc(routeForSection(n.project, '/calendar'))}" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap">${esc(COPY.nextUp.open(n.project))}</a>
  </div>
  <!-- /dc -->`;
}

function blockAdd() {
  if (!st.adding) return `<!-- dc: Admin Calendar.dc.html › "New entry panel" --><div data-block="add"></div><!-- /dc -->`;
  const y = st.addYear;
  return `
  <!-- dc: Admin Calendar.dc.html › "New entry panel" -->
  <div data-block="add">
    <div class="mxc-form" style="border:1px solid ${HAIR};border-top:2px solid #9b1b22;background:#fff;padding:14px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${COPY.add.label}</span>
      <input data-role="evName" placeholder="${esc(COPY.add.ph)}" aria-label="Entry name" style="flex:2;min-width:180px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
      <select data-role="evMonth" aria-label="Month" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">${MONTHS.map((m, i) => `<option value="${i}"${i === new Date().getMonth() ? ' selected' : ''}>${m}</option>`).join('')}</select>
      <input data-role="evDay" data-v2="day-input" placeholder="${esc(COPY.add.dayPh)}" aria-label="Day of month" inputmode="numeric" style="width:52px;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 8px;font:400 12.5px Inter,sans-serif;color:#201b16">
      <select data-role="evYear" data-v2="year-select" aria-label="Year" data-change="addYear" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">${boardYears().map(by => `<option${by === y ? ' selected' : ''}>${by}</option>`).join('')}</select>
      <select data-role="evProj" aria-label="Project" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">${COPY.add.projects.map(p => `<option value="${p[1]}">${p[0]}</option>`).join('')}</select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#4a4239;cursor:pointer;white-space:nowrap"><input type="checkbox" data-role="evSolid" checked>${COPY.add.confirmed}</label>
      <span data-act="addEntry" style="padding:9px 15px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${esc(COPY.add.btn(y))}</span>
    </div>
  </div>
  <!-- /dc -->`;
}

function monthHeader() {
  return `<div style="display:grid;grid-template-columns:170px repeat(12,1fr);border-bottom:1px solid ${HAIR}">
        <span></span>
        ${MONTHS.map(m => `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;padding:4px 0;text-align:center;border-left:${CELL_L}">${m}</span>`).join('')}
      </div>`;
}
function boardRow(e, year) {
  const cells = entryCells(e, year);
  const color = entryColor(e);
  const dashed = e.status === 'potential';
  return `
      <div data-row="${esc(e.id)}" style="display:grid;grid-template-columns:170px repeat(12,1fr);align-items:center;border-bottom:1px solid ${HAIR06}">
        <span style="padding:9px 0;min-width:0;display:flex;align-items:center;gap:7px">${st.editMode ? `<span data-act="removeEntry" data-id="${esc(e.id)}" title="${esc(COPY.board.deleteTitle)}" style="font:600 11px Inter,sans-serif;color:#9b1b22;cursor:pointer;flex:none">✕</span>` : ''}<span style="min-width:0"><span style="display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.title)}</span><span style="display:block;font-size:10px;color:#6d6459">${esc(dateLine(e))}</span></span></span>
        ${Array.from({ length: 12 }, (_, m) => `<span style="height:34px;border-left:${CELL_L};display:flex;align-items:center;padding:0 3px;box-sizing:border-box"><span style="width:100%;height:12px;background:${cells.includes(m) ? (dashed ? 'transparent' : color) : 'transparent'};border:${cells.includes(m) && dashed ? '1.5px dashed ' + color : 'none'};box-sizing:border-box"></span></span>`).join('')}
      </div>`;
}
function blockBoard() {
  const years = boardYears();
  const now = new Date();
  const sections = years.map((y, yi) => {
    const rows = D.cal.filter(e => yearOf(e.starts_on) === y);
    if (!rows.length && yi > 1) return '';
    const isCurrent = y === now.getFullYear();
    const pct = ((now - new Date(y, 0, 1)) / (365 * 86400000)).toFixed(3);
    return `
      <div style="display:flex;align-items:baseline;gap:12px;margin:${yi === 0 ? '0' : '18px'} 0 12px;flex-wrap:wrap">
        <span style="font-family:Fraunces,serif;font-size:20px">${y}</span>
        ${yi === 0 ? `
        <span style="font-size:11.5px;color:#6d6459">${COPY.board.legendNote}</span>
        <span data-act="toggleEdit" style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:${st.editMode ? '#1e6e42' : '#6d6459'};cursor:pointer;border:1px solid rgba(32,27,22,.18);padding:4px 8px" data-hover="color:#201b16">${st.editMode ? COPY.board.doneEditing : COPY.board.edit}</span>
        <div style="flex:1"></div>
        <span style="display:flex;gap:12px;flex-wrap:wrap">
          ${COPY.board.legend.map(([l, c]) => `<span style="display:flex;align-items:center;gap:5px;font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459"><span style="width:9px;height:9px;background:${c}"></span>${l}</span>`).join('')}
        </span>` : ''}
      </div>
      <div class="mxc-scroll"><div class="mxc-grid" style="position:relative">
        ${monthHeader()}
        ${rows.map(e => boardRow(e, y)).join('')}
        ${!rows.length ? `<div style="padding:12px 0;font-size:12px;color:#6d6459;font-style:italic">${COPY.board.empty}</div>` : ''}
        ${isCurrent && rows.length ? `
        <div style="position:absolute;top:0;bottom:0;left:calc(170px + (100% - 170px) * ${pct});width:0;border-left:2px solid #9b1b22;pointer-events:none"></div>
        <span style="position:absolute;top:-4px;left:calc(170px + (100% - 170px) * ${pct} - 22px);font:600 8px Inter,sans-serif;letter-spacing:.1em;color:#9b1b22;background:#fff;padding:0 4px">${COPY.board.today}</span>` : ''}
      </div></div>`;
  }).join('');
  return `
    <!-- dc: Admin Calendar.dc.html › "Year board" -->
    <div data-block="board" style="border:1px solid ${HAIR};background:#fff;padding:18px 20px">
      ${sections}
    </div>
    <!-- /dc -->`;
}

function taskMeta(t) {
  const who = t.assignee_name ? String(t.assignee_name).split(/\s+/)[0].toUpperCase() : COPY.tasks.team;
  if (!t.due_date || !String(t.due_date).trim()) return { who, due: '', dueColor: '#6d6459' };
  const diff = fmt.daysUntil(t.due_date);
  if (diff < 0) return { who, due: COPY.tasks.overdue(Math.abs(diff)), dueColor: '#9b1b22' };
  if (diff === 0) return { who, due: COPY.tasks.dueToday, dueColor: '#b7791f' };
  return { who, due: COPY.tasks.due(t.due_date), dueColor: '#6d6459' };
}
function blockTasksKeyDates() {
  const c = COPY.tasks;
  const kd = upcomingKeyDates();
  const thisY = new Date().getFullYear();
  const groups = [[COPY.keyDates.thisYear(thisY), kd.filter(k => yearOf(k.d) === thisY)], [COPY.keyDates.nextYear(thisY + 1), kd.filter(k => yearOf(k.d) === thisY + 1)]];
  return `
    <!-- dc: Admin Calendar.dc.html › "TEAM TASKS" + "KEY DATES" -->
    <div id="tasks" class="mx-two" style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      <div data-block="tasks" style="border:1px solid ${HAIR};background:#fff">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid ${HAIR12}">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
          <span style="min-width:18px;height:18px;padding:0 5px;background:#9b1b22;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center">${D.tasks.length}</span>
          <div style="flex:1"></div>
          <span style="font-size:11.5px;color:#6d6459">${c.note}</span>
        </div>
        ${D.tasks.map(t => { const m = taskMeta(t); return `
        <div data-task="${esc(t.id)}" class="mx-row" style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.07)">
          <span data-act="taskDone" data-id="${esc(t.id)}" role="checkbox" aria-checked="false" aria-label="Done" title="${esc(c.tickTitle)}" style="width:18px;height:18px;border:1.5px solid rgba(32,27,22,.35);cursor:pointer;flex:none" data-hover="border-color:#9b1b22"></span>
          <span class="mx-row-text" style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(t.title)}</span>${m.due ? `<span style="display:block;font-size:11px;color:${m.dueColor};margin-top:1px">${esc(m.due)}</span>` : ''}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;padding:3px 7px;background:#eee9df;color:#4a4239;white-space:nowrap">${esc(m.who)}</span>
        </div>`; }).join('')}
        ${!D.tasks.length ? `<div style="padding:18px 20px;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : ''}
        <div style="display:flex;gap:10px;padding:14px 20px">
          <input data-role="taskDraft" placeholder="${esc(c.ph)}" aria-label="New task" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16">
          <span data-act="taskAdd" style="padding:9px 14px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center" data-hover="background:#000">${c.add}</span>
        </div>
      </div>
      <div data-block="keydates" style="border:1px solid ${HAIR};background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:2px">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;margin-bottom:8px">${COPY.keyDates.title}</span>
        ${groups.map(([label, rows]) => !rows.length ? '' : `
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#9a9086;padding:10px 0 4px">${esc(label)}</div>
          ${rows.map(k => `
          <div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid ${HAIR06}">
            <span style="width:8px;height:8px;background:${k.c};flex:none"></span>
            <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.11em;color:#201b16;width:66px;flex:none">${esc(fmt.rangeLabel(k.d, k.end))}</span>
            <span style="font-size:12.5px;flex:1;min-width:0">${esc(k.t)}</span>
          </div>`).join('')}`).join('')}
        <span style="font-size:11px;color:#6d6459;margin-top:10px">${COPY.keyDates.foot}</span>
      </div>
    </div>
    <!-- /dc -->`;
}

// v2: the print-ready one-page year board (README note 23). Hidden on screen; css/views/calendar.css
// reveals ONLY this while body.mxc-printing is set and the print dialog is open.
function blockPrint() {
  const years = boardYears().slice(0, 2);
  const kd = upcomingKeyDates();
  const yearGrid = y => {
    const rows = D.cal.filter(e => yearOf(e.starts_on) === y);
    return `
    <div style="margin-top:${y === years[0] ? 18 : 26}px">
      <div style="font-family:Fraunces,serif;font-size:17px;margin-bottom:6px">${y}</div>
      <div style="display:grid;grid-template-columns:150px repeat(12,1fr);border-bottom:1px solid rgba(32,27,22,.3)">
        <span></span>${MONTHS.map(m => `<span style="font:600 7.5px Inter,sans-serif;letter-spacing:.1em;color:#4a4239;padding:3px 0;text-align:center;border-left:${CELL_L}">${m}</span>`).join('')}
      </div>
      ${rows.map(e => { const cells = entryCells(e, y); const color = entryColor(e); const dashed = e.status === 'potential'; return `
      <div style="display:grid;grid-template-columns:150px repeat(12,1fr);align-items:center;border-bottom:1px solid ${HAIR06}">
        <span style="padding:6px 0;min-width:0"><span style="display:block;font-size:9.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.title)}</span><span style="display:block;font-size:8px;color:#6d6459">${esc(fmt.rangeLabel(e.starts_on, e.ends_on))}</span></span>
        ${Array.from({ length: 12 }, (_, m) => `<span style="height:22px;border-left:${CELL_L};display:flex;align-items:center;padding:0 2px;box-sizing:border-box"><span style="width:100%;height:9px;background:${cells.includes(m) ? (dashed ? 'transparent' : color) : 'transparent'};border:${cells.includes(m) && dashed ? '1.2px dashed ' + color : 'none'};box-sizing:border-box"></span></span>`).join('')}
      </div>`; }).join('')}
    </div>`;
  };
  return `
    <!-- v2: print-ready year board (EXPORT PDF, note 23 — no artboard counterpart) -->
    <div class="mxc-print" data-v2="print-board" aria-hidden="true" style="display:none;background:#fff;color:#201b16;font-family:Inter,sans-serif">
      <div style="display:flex;align-items:baseline;gap:14px;border-bottom:2px solid #9b1b22;padding-bottom:10px">
        <img src="/assets/logo.png" alt="Med&amp;X" style="height:20px;transform:translateY(3px)">
        <span style="font-family:Fraunces,serif;font-size:24px">${esc(COPY.print.title(years.join(' · ')))}</span>
        <div style="flex:1"></div>
        <span style="font-size:9px;color:#6d6459">${esc(COPY.print.subtitle)}</span>
      </div>
      ${years.map(yearGrid).join('')}
      <div style="margin-top:22px;display:flex;gap:30px;align-items:flex-start">
        <div style="flex:1.4">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#4a4239;margin-bottom:6px">${COPY.print.keyDates}</div>
          <div style="column-count:2;column-gap:26px">
            ${kd.map(k => `<div style="display:flex;gap:8px;align-items:baseline;padding:3px 0;break-inside:avoid"><span style="width:7px;height:7px;background:${k.c};flex:none;transform:translateY(0.5px)"></span><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.08em;width:64px;flex:none">${esc(fmt.rangeLabel(k.d, k.end))}</span><span style="font-size:9.5px">${esc(k.t)}</span></div>`).join('')}
          </div>
        </div>
        <div style="flex:none;font-size:8.5px;color:#6d6459;display:flex;flex-direction:column;gap:4px">
          <span style="display:flex;align-items:center;gap:6px"><span style="width:16px;height:8px;background:#9b1b22"></span>${COPY.print.legendConfirmed}</span>
          <span style="display:flex;align-items:center;gap:6px"><span style="width:16px;height:8px;border:1.2px dashed #9b1b22;box-sizing:border-box"></span>${COPY.print.legendPotential}</span>
        </div>
      </div>
      <div style="margin-top:18px;border-top:1px solid rgba(32,27,22,.25);padding-top:8px;font-size:8.5px;color:#6d6459">${esc(COPY.print.foot())}</div>
    </div>
    <!-- /v2 -->`;
}

function template() {
  return `
<div data-screen-label="Admin Calendar" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter mxc-screen" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
    ${blockHead()}
    ${blockNextUp()}
    ${blockAdd()}
    ${blockBoard()}
    ${blockTasksKeyDates()}
  </div>
  ${blockPrint()}
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function rerenderBoardBits() {
  rerender('[data-block="board"]', blockBoard());
  rerender('[data-block="nextup"]', blockNextUp());
  const kd = rootEl.querySelector('[data-block="keydates"]'); if (kd) { const wrap = rootEl.querySelector('#tasks'); if (wrap) wrap.outerHTML = blockTasksKeyDates(); }
  const pr = rootEl.querySelector('.mxc-print'); if (pr) pr.outerHTML = blockPrint();
}
async function reloadCal() {
  try { const r = await api.settle({ cal: api.get('/api/admin/year-calendar'), kd: api.get('/api/v2/calendar/key-dates') });
    if (Array.isArray(r.cal)) D.cal = r.cal.filter(e => /^\d{4}-\d{2}-\d{2}/.test(String(e.starts_on || '')));
    if (r.kd) D.kd = r.kd; } catch (e) {}
  rerenderBoardBits();
}
async function reloadTasks() {
  try { const rows = await api.get('/api/admin/tasks'); D.tasks = (Array.isArray(rows) ? rows : []).filter(t => t.status !== 'done'); } catch (e) {}
  const wrap = rootEl.querySelector('#tasks'); if (wrap) wrap.outerHTML = blockTasksKeyDates();
}
const roleVal = r => { const el = rootEl.querySelector(`[data-role="${r}"]`); return el ? el.value.trim() : ''; };

const handlers = {
  addToggle: () => { st.adding = !st.adding; rerender('[data-block="add"]', blockAdd()); if (st.adding) { const i = rootEl.querySelector('[data-role="evName"]'); if (i) i.focus(); } },
  addEntry: async el => {
    const title = roleVal('evName');
    if (!title) { ui.toast(COPY.add.needName); return; }
    const y = parseInt(roleVal('evYear'), 10) || st.addYear;
    const m = parseInt(roleVal('evMonth'), 10) || 0;
    const day = Math.min(28 + (m === 1 ? 0 : 3), Math.max(1, parseInt(roleVal('evDay'), 10) || 1));
    const solid = rootEl.querySelector('[data-role="evSolid"]');
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/year-calendar', { title, project: roleVal('evProj') || 'other', starts_on: `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, status: solid && solid.checked ? 'confirmed' : 'potential' });
      st.adding = false;
      rerender('[data-block="add"]', blockAdd());
      await reloadCal();
      ui.toast(COPY.add.added(y));
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  toggleEdit: () => { st.editMode = !st.editMode; rerender('[data-block="board"]', blockBoard()); },
  removeEntry: async el => {
    const e = D.cal.find(x => x.id === el.dataset.id); if (!e) return;
    const copy = { title: e.title, project: e.project, starts_on: e.starts_on, ends_on: e.ends_on, status: e.status, color: e.color, notes: e.notes };
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.del('/api/admin/year-calendar/' + encodeURIComponent(e.id));
      await reloadCal();
      ui.toast(COPY.board.removed, { undo: async () => {
        try { await api.post('/api/admin/year-calendar', copy); await reloadCal(); ui.toast(COPY.board.restored); }
        catch (err) { ui.toast(err.message, { kind: 'error' }); }
      } });
    } catch (err) { el.removeAttribute('aria-disabled'); ui.toast(err.message, { kind: 'error' }); }
  },
  exportCsv: () => {
    const csv = ['Entry,Start,End,Project,Status'].concat(D.cal.map(e =>
      `"${String(e.title).replace(/"/g, '""')}","${e.starts_on}","${e.ends_on || ''}","${e.project || ''}","${e.status || 'confirmed'}"`)).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `medx-calendar-${new Date().getFullYear()}.csv`;
    a.click();
    ui.toast(COPY.exportedCsv);
  },
  exportPdf: () => {
    document.body.classList.add('mxc-printing');
    ui.toast(COPY.exportPdfToast);
    const done = () => { document.body.classList.remove('mxc-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try { window.print(); } finally { setTimeout(done, 2000); } }, 150);
  },
  taskAdd: async el => {
    const title = roleVal('taskDraft');
    if (!title) { ui.toast(COPY.tasks.typeFirst); return; }
    const d7 = new Date(); d7.setDate(d7.getDate() + 7);
    el.setAttribute('aria-disabled', 'true');
    try { await api.post('/api/admin/tasks', { title, due_date: fmt.ymd(d7), project: 'general' }); await reloadTasks(); ui.toast(COPY.tasks.added); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  taskDone: async el => {
    const id = el.dataset.id;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/admin/tasks/' + encodeURIComponent(id), { done: true });
      D.tasks = D.tasks.filter(t => t.id !== id);
      const wrap = rootEl.querySelector('#tasks'); if (wrap) wrap.outerHTML = blockTasksKeyDates();
      ui.toast(COPY.tasks.done, { undo: async () => { try { await api.put('/api/admin/tasks/' + encodeURIComponent(id), { done: false }); } catch (e) {} if (rootEl) reloadTasks(); } });
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  }
};

function onchangeDelegate(e) {
  const el = e.target.closest && e.target.closest('[data-change]');
  if (!el || !rootEl || !rootEl.contains(el)) return;
  if (el.dataset.change === 'addYear') {
    st.addYear = parseInt(el.value, 10) || st.addYear;
    const btn = rootEl.querySelector('[data-act="addEntry"]'); if (btn) btn.textContent = COPY.add.btn(st.addYear);
  }
}

function ensureCss() {
  if (document.querySelector('link[data-view-css="calendar"]')) { cssEl = document.querySelector('link[data-view-css="calendar"]'); return; }
  cssEl = document.createElement('link'); cssEl.rel = 'stylesheet'; cssEl.href = '/css/views/calendar.css'; cssEl.setAttribute('data-view-css', 'calendar');
  document.head.appendChild(cssEl);
}

export default {
  title: 'Calendar',
  async render(root, ctx) {
    rootEl = root;
    ensureCss();
    st = { adding: false, editMode: false, addYear: new Date().getFullYear() };
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    root.addEventListener('change', onchangeDelegate);
    if (ctx.params && ctx.params.tab === 'tasks') { const t = root.querySelector('#tasks'); if (t) t.scrollIntoView({ block: 'start' }); }
    chrome.refresh();
  },
  destroy() {
    document.body.classList.remove('mxc-printing');
    if (rootEl) rootEl.removeEventListener('change', onchangeDelegate);
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
    if (cssEl) { cssEl.remove(); cssEl = null; }
  }
};
