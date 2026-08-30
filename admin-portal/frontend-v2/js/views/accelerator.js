// Source: Admin Accelerator Hub.dc.html — the ACCELERATOR HUB destination (/projects/accelerator).
// Blocks (artboard order): "Sub-nav" › "Title row" › "Stats + key dates" › "HOST INSTITUTIONS" ›
// "THE REVIEW ROOM" › "Wizard note". v2 additions per README note 0c rows (marked data-v2):
// EVALUATION CRITERIA (markup vocabulary from Admin Accelerator Review.dc.html › "SCORING CRITERIA"),
// ALUMNI (v2_accelerator_alumni list + edit), GET-NOTIFIED count line, intake-window editor on the
// key-dates strip (PUT /api/v2/accelerator-review/intake-window — member-route semantics).
// Every number is a live read; every status is a door (note 0b). No public close/interview/result
// dates anywhere — only the opening date (canonical facts, README).
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import cfg from '../config.js';

export const SOURCE = 'Admin Accelerator Hub.dc.html';

export const COPY = {
  title: 'Med&amp;X <i>Accelerator</i>',
  sub: opens => `The research internship program — from application to placement · applications open ${opens}`,
  state: { before: opens => `OPENS ${opens.toUpperCase()}`, open: 'APPLICATIONS OPEN', closed: 'APPLICATIONS CLOSED' },
  manage: 'WHAT MEMBERS SEE — MANAGE ↗', review: 'REVIEW ROOM →',
  stats: {
    apps: 'APPLICATIONS', appsZero: 'LIVE COUNT ONCE OPEN · REVIEW ROOM →', appsSome: line => `${line} · REVIEW ROOM →`,
    hosts: 'HOST INSTITUTIONS', hostsSub: 'managed below',
    fellows: 'PAST FELLOWS', fellowsSub: (from, to) => `cohorts placed · ${from}–${to}`, fellowsFallbackSub: 'three cohorts placed · 2024–2026'
  },
  dates: {
    label: 'KEY DATES', open: 'applications open', edit: 'EDIT',
    phase1: 'two-phase document review', phase1When: 'WINTER',
    phase2: 'interviews &amp; ranking', phase2When: 'AFTER REVIEW',
    phase3: 'placements begin', phase3When: 'SUMMER 2027',
    note: 'these drive the member page &amp; countdowns · ', noteLink: 'edit on the Calendar →',
    editorNote: 'Opening date only — close, interview and result dates are never published; the window is announced at opening.',
    save: 'SAVE', cancel: 'CANCEL', saved: 'OPENING DATE SAVED — MEMBER PAGE & COUNTDOWNS FOLLOW IT', needDate: 'PICK THE OPENING DATE FIRST'
  },
  inst: {
    title: 'HOST INSTITUTIONS', sub: 'add one here — it appears on the member portal instantly',
    placeholder: 'Institution name — e.g. “Mayo Clinic, Rochester”', add: 'ADD',
    edit: 'EDIT', save: 'SAVE', cancel: 'CANCEL', remove: 'REMOVE', removeSure: 'SURE? REMOVE',
    namePh: 'Institution', placePh: 'City · lab or clinic', spotsPh: 'e.g. 2',
    spots: n => n == null || n === '' ? 'SPOTS TBC' : `${n} ${Number(n) === 1 ? 'SPOT' : 'SPOTS'}`,
    footer: "The current cycle's four hosts sync to the member page — adding or editing here updates it instantly.",
    emptyLine: 'No host sites entered yet.',
    emptyWhy: hosts => `The 2026 cycle hosts are ${hosts.slice(0, -1).join(', ')} and the ${hosts[hosts.length - 1]} — add them here and the member page follows.`,
    added: 'ADDED — FILL CITY & FIELD, IT SYNCS TO THE MEMBER PAGE',
    saved: 'SAVED — LIVE ON THE MEMBER PAGE', removed: 'REMOVED FROM THE CYCLE', needName: 'TYPE THE INSTITUTION NAME FIRST'
  },
  room: {
    title: 'THE REVIEW ROOM',
    body: 'Every application lands there: your team scores it against criteria you define, sends the interview link, and ranks the cohort. Scoring metrics are fully editable inside.',
    chips: [['REVIEW', '/accelerator-review'], ['SCORE', '/accelerator-review'], ['INTERVIEW', '/accelerator-review#interviews'], ['RANK', '/accelerator-review#ranking']],
    chipGold: ['PLACE', '/accelerator-review#ranking'], open: 'OPEN THE REVIEW ROOM →'
  },
  crit: {
    title: 'EVALUATION CRITERIA', tag: 'yours to define', add: 'ADD',
    placeholder: 'Add a criterion — e.g. English fluency',
    note: 'Scale is 0–5 · every applicant is scored on every criterion.',
    added: 'CRITERION ADDED — EVERY APPLICANT GETS A CELL FOR IT', renamed: 'CRITERION RENAMED — SCORES STAY ATTACHED',
    removed: 'CRITERION REMOVED FROM THE RUBRIC', needName: 'TYPE THE CRITERION FIRST'
  },
  alumni: {
    title: 'ALUMNI', sub: 'the fellows record — drives the member page rotator',
    placeholder: 'Fellow’s name — e.g. “Dr. Iva Kovačić”', add: 'ADD',
    namePh: 'Name', placePh: 'Placement — e.g. Mayo Clinic', yearPh: 'Year',
    pub: 'PUBLISHED', hidden: 'HIDDEN',
    emptyLine: 'No fellows entered yet.',
    emptyWhy: n => `The published record shows ${n} fellows across three cohorts (2024–2026) — enter them here and the member page rotator goes live.`,
    added: 'ADDED — SET PLACEMENT & YEAR, THEN IT ROTATES ON THE MEMBER PAGE', saved: 'SAVED — THE MEMBER ROTATOR FOLLOWS',
    removed: 'REMOVED FROM THE RECORD', puback: on => on ? 'PUBLISHED — VISIBLE TO MEMBERS' : 'HIDDEN FROM MEMBERS — THE ROW STAYS',
    needName: 'TYPE THE FELLOW’S NAME FIRST'
  },
  note: {
    text: 'Applicants fill the 7-step wizard on the member portal — ', link: 'see their side ↗',
    notified: n => `GET-NOTIFIED LIST — ${n} waiting for the opening email`, notifiedZero: 'GET-NOTIFIED LIST — empty so far', announce: 'announce the opening →'
  },
  loadFail: 'Some numbers did not load — the controls still work.'
};

let D = null, st = null, rootEl = null, unbind = null, onChange = null, onKey = null;

const YEAR = () => (D && D.program && D.program.year) || FACTS.year;

async function load() {
  const base = await api.settle({
    program: api.get('/api/accelerator/program'),
    intake: api.get('/api/v2/accelerator-review/intake'),
    sites: api.get('/api/admin/accelerator-sites'),
    alumni: api.get('/api/v2/accelerator-review/alumni'),
    notify: api.get('/api/v2/accelerator-review/notify-count')
  });
  const year = (base.program && base.program.year) || FACTS.year;
  const more = await api.settle({
    apps: api.get(`/api/accelerator/years/${year}/applications`),
    criteria: api.get(`/api/accelerator/years/${year}/criteria`)
  });
  return Object.assign(base, more);
}

// ---- derived ----
const sites = () => ((D && D.sites) || []).filter(s => s.active !== 0);
const apps = () => ((D && D.apps) || []).filter(a => a.status !== 'draft');
const alumniRows = () => (D && D.alumni && D.alumni.alumni) || [];
function opensInfo() {
  const w = D && D.intake;
  const iso = w && w.opens_at ? String(w.opens_at) : FACTS.accelerator.opens;
  const d = fmt.toDate(iso.slice(0, 10));
  const label = d ? `${fmt.dayLabel(d)}, ${d.getFullYear()}` : FACTS.accelerator.opensShort.toUpperCase();
  const long = d ? fmt.longRange(iso.slice(0, 10)) : FACTS.accelerator.opensLabel;
  return { iso, ymd: iso.slice(0, 10), label, long, state: (w && w.state) || 'before' };
}
function statusLine() {
  const by = {};
  apps().forEach(a => { by[a.status] = (by[a.status] || 0) + 1; });
  const order = [['submitted', 'NEW'], ['under_review', 'IN REVIEW'], ['accepted', 'ACCEPTED'], ['rejected', 'DECLINED']];
  return order.filter(([k]) => by[k]).map(([k, l]) => `${by[k]} ${l}`).join(' · ');
}

// ---------------------------------------------------------------- blocks
function blockSubnav() {
  return `
  <!-- dc: Admin Accelerator Hub.dc.html › "Sub-nav" -->
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)">
    <div class="mx-subnav mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;height:44px;display:flex;align-items:center;gap:20px">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">PROJECTS</span>
      <a href="/projects/plexus" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">PLEXUS WEEK 2026</a>
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#201b16;border-bottom:2px solid #9b1b22;height:100%;display:flex;align-items:center;box-sizing:border-box">ACCELERATOR</span>
      <a href="/projects/forum" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">BIOMEDICAL FORUM</a>
      <a href="/projects/bridges" style="font:600 11px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;height:100%;display:flex;align-items:center" data-hover="color:#201b16">BUILDING BRIDGES</a>
    </div>
  </div>
  <!-- /dc -->`;
}

function blockTitle() {
  const o = opensInfo();
  const tag = o.state === 'open' ? { t: COPY.state.open, bg: '#e4efe7', fg: '#22563a' }
    : o.state === 'closed' ? { t: COPY.state.closed, bg: '#eee9df', fg: '#4a4239' }
    : { t: COPY.state.before(o.long), bg: '#f8f1e2', fg: '#7a6432' };
  return `
    <!-- dc: Admin Accelerator Hub.dc.html › "Title row" -->
    <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;background:${tag.bg};color:${tag.fg};padding:4px 8px">${esc(tag.t)}</span>
        </div>
        <div style="font-size:12.5px;color:#6d6459;margin-top:4px">${COPY.sub(esc(o.long))}</div>
      </div>
      <div style="flex:1"></div>
      <a href="/member-pages" style="padding:10px 16px;border:2px solid #9b1b22;background:#fff;color:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#9b1b22;color:#fff">${COPY.manage}</a>
      <a href="/accelerator-review" style="padding:10px 16px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#9b1b22;color:#f6f2ea">${COPY.review}</a>
    </div>
    <!-- /dc -->`;
}

function blockStats() {
  const o = opensInfo();
  const n = apps().length;
  const line = statusLine();
  const alu = alumniRows();
  const fellows = alu.length || FACTS.accelerator.fellows;
  const fellowsSub = alu.length && D.alumni.years ? COPY.stats.fellowsSub(D.alumni.years.from, D.alumni.years.to) : COPY.stats.fellowsFallbackSub;
  return `
    <!-- dc: Admin Accelerator Hub.dc.html › "Stats + key dates" -->
    <div data-block="stats" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div class="mx-grid-3" style="display:grid;grid-template-columns:1.2fr 1fr 1fr">
        <a href="/accelerator-review" style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1);color:#201b16;display:block" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.stats.apps}</div>
          <div style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.apps ? n : '—'}</div>
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${n ? COPY.stats.appsSome(esc(line)) : COPY.stats.appsZero}</div>
        </a>
        <div style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1)">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.stats.hosts}</div>
          <div style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.sites ? sites().length : '—'}</div>
          <div style="font-size:11px;color:#6d6459">${COPY.stats.hostsSub}</div>
        </div>
        <a href="#alumni" style="padding:16px 20px;color:#201b16;display:block" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.stats.fellows}</div>
          <div style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${fellows}</div>
          <div style="font-size:11px;color:#6d6459">${esc(fellowsSub)}</div>
        </a>
      </div>
      <div style="display:flex;align-items:center;gap:8px 22px;border-top:1px solid rgba(32,27,22,.1);padding:11px 20px;flex-wrap:wrap">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459;white-space:nowrap">${COPY.dates.label}</span>
        <span style="display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap"><span style="width:7px;height:7px;background:#b7791f;flex:none"></span><b>${esc(o.label)}</b>&nbsp;${COPY.dates.open}&nbsp;<span data-act="intakeEdit" data-v2="intake-editor" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer" data-hover="color:#201b16">${COPY.dates.edit}</span></span>
        <span style="display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap"><span style="width:7px;height:7px;background:#9b1b22;flex:none"></span><b>${COPY.dates.phase1When}</b>&nbsp;${COPY.dates.phase1}</span>
        <span style="display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap"><span style="width:7px;height:7px;background:#201b16;flex:none"></span><b>${COPY.dates.phase2When}</b>&nbsp;${COPY.dates.phase2}</span>
        <span style="display:flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap"><span style="width:7px;height:7px;background:#1e6e42;flex:none"></span><b>${COPY.dates.phase3When}</b>&nbsp;${COPY.dates.phase3}</span>
        <div style="flex:1"></div>
        <span style="font-size:11px;color:#6d6459;white-space:nowrap">${COPY.dates.note}<a href="/calendar">${COPY.dates.noteLink}</a></span>
      </div>
      ${st.intakeEdit ? `
      <div data-v2="intake-editor" style="display:flex;gap:8px;align-items:center;padding:10px 20px;background:#fdfbf6;border-top:1px solid rgba(32,27,22,.07);flex-wrap:wrap">
        <input type="date" data-role="intakeDate" value="${esc(o.ymd)}" style="border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16">
        <span data-act="intakeSave" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer" data-hover="background:#7e151b">${COPY.dates.save}</span>
        <span data-act="intakeCancel" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#201b16">${COPY.dates.cancel}</span>
        <span style="font-size:11px;color:#6d6459">${COPY.dates.editorNote}</span>
      </div>` : ''}
    </div>
    <!-- /dc -->`;
}

function blockInstitutions() {
  const rows = sites();
  return `
      <div data-block="inst" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <!-- dc: Admin Accelerator Hub.dc.html › "HOST INSTITUTIONS" -->
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.inst.title}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.inst.sub}</span>
        </div>
        ${rows.length ? rows.map(s => {
          const place = [s.city, s.lab_or_clinic].filter(Boolean).join(' · ');
          const editing = st.instEdit === s.id;
          return `
          <div data-row="${esc(s.id)}" style="display:flex;align-items:center;gap:12px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.07)">
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(s.institution)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(place) || '—'}</span></span>
            <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#e4efe7;color:#22563a;padding:3px 7px;white-space:nowrap">${esc(COPY.inst.spots(s.spots))}</span>
            <span data-act="instEdit" data-id="${esc(s.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.inst.edit}</span>
          </div>
          ${editing ? `
            <div style="display:flex;gap:8px;align-items:center;padding:10px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.07);flex-wrap:wrap">
              <input data-role="eName" value="${esc(st.eName)}" placeholder="${COPY.inst.namePh}" style="flex:2;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
              <input data-role="ePlace" value="${esc(st.ePlace)}" placeholder="${COPY.inst.placePh}" style="flex:2;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
              <input data-role="eSpots" value="${esc(st.eSpots)}" placeholder="${COPY.inst.spotsPh}" style="width:90px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
              <span data-act="instSave" data-id="${esc(s.id)}" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer">${COPY.inst.save}</span>
              <span data-act="instCancel" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#201b16">${COPY.inst.cancel}</span>
              <span data-act="instRemove" data-id="${esc(s.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:${st.instRemoveConfirm ? '#9b1b22' : '#6d6459'};cursor:pointer" data-hover="color:#9b1b22">${st.instRemoveConfirm ? COPY.inst.removeSure : COPY.inst.remove}</span>
            </div>` : ''}`;
        }).join('') : `
          <div class="empty" style="padding:26px 20px">
            <span style="width:28px;height:1px;background:#c9a962"></span>
            <span class="empty-line">${COPY.inst.emptyLine}</span>
            <span class="empty-why">${esc(COPY.inst.emptyWhy(FACTS.accelerator.hosts))}</span>
          </div>`}
        <div style="display:flex;gap:10px;padding:14px 20px">
          <input data-role="instDraft" placeholder="${COPY.inst.placeholder}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16;min-width:0">
          <span data-act="addInst" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${COPY.inst.add}</span>
        </div>
        <div style="padding:0 20px 14px;font-size:11px;color:#6d6459">${COPY.inst.footer}</div>
        <!-- /dc -->
      </div>`;
}

function blockAlumni() {
  const rows = alumniRows();
  return `
      <div id="alumni" data-block="alumni" data-v2="alumni-card" style="border:1px solid rgba(32,27,22,.14);background:#fff">
        <!-- v2: ALUMNI — note 0c row (v2_accelerator_alumni), institutions-card vocabulary -->
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.alumni.title}</span>
          <span style="font-size:11.5px;color:#6d6459">${COPY.alumni.sub}</span>
        </div>
        ${rows.length ? rows.map(r => {
          const meta = [r.placement_institution, r.year].filter(Boolean).join(' · ');
          const editing = st.aluEdit === r.id;
          const pub = r.is_published ? 1 : 0;
          return `
          <div data-row="${esc(r.id)}" style="display:flex;align-items:center;gap:12px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.07)">
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(r.name)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(meta) || '—'}</span></span>
            <span data-act="aluPub" data-id="${esc(r.id)}" title="Click to ${pub ? 'hide from' : 'publish to'} the member page" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:${pub ? '#e4efe7' : '#eee9df'};color:${pub ? '#22563a' : '#4a4239'};padding:3px 7px;white-space:nowrap;cursor:pointer">${pub ? COPY.alumni.pub : COPY.alumni.hidden}</span>
            <span data-act="aluEdit" data-id="${esc(r.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${COPY.inst.edit}</span>
          </div>
          ${editing ? `
            <div style="display:flex;gap:8px;align-items:center;padding:10px 20px;background:#fdfbf6;border-bottom:1px solid rgba(32,27,22,.07);flex-wrap:wrap">
              <input data-role="aName" value="${esc(st.aName)}" placeholder="${COPY.alumni.namePh}" style="flex:2;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
              <input data-role="aPlace" value="${esc(st.aPlace)}" placeholder="${COPY.alumni.placePh}" style="flex:2;min-width:150px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
              <input data-role="aYear" value="${esc(st.aYear)}" placeholder="${COPY.alumni.yearPh}" style="width:74px;border:1px solid rgba(32,27,22,.25);background:#fff;padding:8px 10px;font-size:12.5px;color:#201b16">
              <span data-act="aluSave" data-id="${esc(r.id)}" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer">${COPY.inst.save}</span>
              <span data-act="aluCancel" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer" data-hover="color:#201b16">${COPY.inst.cancel}</span>
              <span data-act="aluRemove" data-id="${esc(r.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:${st.aluRemoveConfirm ? '#9b1b22' : '#6d6459'};cursor:pointer" data-hover="color:#9b1b22">${st.aluRemoveConfirm ? COPY.inst.removeSure : COPY.inst.remove}</span>
            </div>` : ''}`;
        }).join('') : `
          <div class="empty" style="padding:26px 20px">
            <span style="width:28px;height:1px;background:#c9a962"></span>
            <span class="empty-line">${COPY.alumni.emptyLine}</span>
            <span class="empty-why">${esc(COPY.alumni.emptyWhy(FACTS.accelerator.fellows))}</span>
          </div>`}
        <div style="display:flex;gap:10px;padding:14px 20px">
          <input data-role="aluDraft" placeholder="${COPY.alumni.placeholder}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16;min-width:0">
          <span data-act="addAlu" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${COPY.alumni.add}</span>
        </div>
      </div>`;
}

function blockReviewCard() {
  return `
        <div style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:9px">
          <!-- dc: Admin Accelerator Hub.dc.html › "THE REVIEW ROOM" -->
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.room.title}</span>
          <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${COPY.room.body}</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${COPY.room.chips.map(([t, to]) => `<a href="${to}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#eee9df;color:#4a4239;padding:4px 8px" data-hover="color:#201b16">${t}</a>`).join('')}
            <a href="${COPY.room.chipGold[1]}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#f1e7d4;color:#7a6432;padding:4px 8px" data-hover="color:#201b16">${COPY.room.chipGold[0]}</a>
          </div>
          <a href="/accelerator-review" style="margin-top:4px;padding:11px 14px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;text-align:center" data-hover="background:#9b1b22;color:#f6f2ea">${COPY.room.open}</a>
          <!-- /dc -->
        </div>`;
}

function blockCriteria() {
  const crits = (D && D.criteria) || [];
  return `
        <div data-block="crit" data-v2="criteria-card" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <!-- v2: EVALUATION CRITERIA — note 0c row; vocabulary from Admin Accelerator Review.dc.html › "SCORING CRITERIA" -->
          <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.crit.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${COPY.crit.tag}</span></div>
          <div style="padding:10px 18px 14px;display:flex;flex-direction:column;gap:8px">
            ${crits.map(c => `
            <div style="display:flex;align-items:center;gap:8px" data-row="${esc(c.id)}">
              <input value="${esc(c.name)}" data-change="critRename" data-id="${esc(c.id)}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;min-width:0">
              <span data-act="critRemove" data-id="${esc(c.id)}" title="Remove criterion" style="font:600 12px Inter,sans-serif;color:#9a9086;cursor:pointer;padding:4px" data-hover="color:#9b1b22">✕</span>
            </div>`).join('')}
            <div style="display:flex;gap:8px">
              <input data-role="critDraft" placeholder="${COPY.crit.placeholder}" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;min-width:0">
              <span data-act="addCrit" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${COPY.crit.add}</span>
            </div>
            <span style="font-size:11px;color:#6d6459">${COPY.crit.note}</span>
          </div>
        </div>`;
}

function blockNote() {
  const n = D && D.notify ? (D.notify.count || 0) : 0;
  return `
        <div style="border:1px solid rgba(32,27,22,.14);background:#fdfbf6;padding:14px 20px;font-size:12px;color:#6d6459;line-height:1.6">
          <!-- dc: Admin Accelerator Hub.dc.html › "Wizard note" -->
          ${COPY.note.text}<a href="${esc(cfg.memberPortalUrl)}/app/accelerator" target="_blank" rel="noopener">${COPY.note.link}</a>
          <div data-v2="notify-count" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(32,27,22,.08)">
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#4a4239">${esc(n ? COPY.note.notified(n) : COPY.note.notifiedZero)}</span>
            · <a href="/inbox/announcements">${COPY.note.announce}</a>
          </div>
          <!-- /dc -->
        </div>`;
}

function template() {
  return `
<div data-screen-label="Admin Accelerator Hub" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:24px">
    ${blockTitle()}
    ${blockStats()}
    <div class="mx-side" style="display:grid;grid-template-columns:1.5fr 1fr;gap:22px;align-items:start">
      <div style="display:flex;flex-direction:column;gap:22px;min-width:0">
        ${blockInstitutions()}
        ${blockAlumni()}
      </div>
      <div style="display:flex;flex-direction:column;gap:22px;min-width:0">
        ${blockReviewCard()}
        ${blockCriteria()}
        ${blockNote()}
      </div>
    </div>
  </div>
</div>`;
}

function rerender() { if (rootEl) { rootEl.innerHTML = template(); } }
const val = role => { const el = rootEl && rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value.trim() : ''; };
function splitPlace(place) {
  const parts = String(place || '').split('·').map(s => s.trim()).filter(Boolean);
  return { city: parts[0] || null, lab: parts.slice(1).join(' · ') || null };
}

// ---------------------------------------------------------------- handlers
const handlers = {
  // — intake window —
  intakeEdit: () => { st.intakeEdit = !st.intakeEdit; rerender(); },
  intakeCancel: () => { st.intakeEdit = false; rerender(); },
  intakeSave: async () => {
    const d = val('intakeDate');
    if (!d) { ui.toast(COPY.dates.needDate, { kind: 'error' }); return; }
    try {
      const w = D.intake || {};
      const r = await api.put('/api/v2/accelerator-review/intake-window', { opens_at: d + 'T00:00:00.000Z', closes_at: w.closes_at || null });
      D.intake = { opens_at: r.window.opens_at, closes_at: r.window.closes_at, state: r.state, cycle: r.window.cycle };
      st.intakeEdit = false; rerender();
      ui.toast(COPY.dates.saved);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  // — host institutions (accelerator_sites CRUD) —
  instEdit: (el) => {
    const id = el.dataset.id;
    if (st.instEdit === id) { st.instEdit = null; rerender(); return; }
    const s = sites().find(x => x.id === id); if (!s) return;
    st.instEdit = id; st.instRemoveConfirm = false;
    st.eName = s.institution; st.ePlace = [s.city, s.lab_or_clinic].filter(Boolean).join(' · '); st.eSpots = s.spots == null ? '' : String(s.spots);
    rerender();
  },
  instCancel: () => { st.instEdit = null; st.instRemoveConfirm = false; rerender(); },
  instSave: async (el) => {
    const id = el.dataset.id;
    const name = val('eName'), place = splitPlace(val('ePlace')), spots = val('eSpots').replace(/[^\d]/g, '');
    try {
      await api.put('/api/admin/accelerator-sites/' + id, { institution: name || undefined, city: place.city, lab_or_clinic: place.lab, spots: spots === '' ? null : parseInt(spots, 10) });
      D.sites = await api.get('/api/admin/accelerator-sites');
      st.instEdit = null; st.instRemoveConfirm = false; rerender();
      ui.toast(COPY.inst.saved);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  instRemove: async (el) => {
    if (!st.instRemoveConfirm) { st.instRemoveConfirm = true; rerender(); return; }
    const id = el.dataset.id;
    const snap = sites().find(x => x.id === id);
    try {
      await api.del('/api/admin/accelerator-sites/' + id);
      D.sites = await api.get('/api/admin/accelerator-sites');
      st.instEdit = null; st.instRemoveConfirm = false; rerender();
      ui.toast(COPY.inst.removed, { undo: async () => {
        try { await api.post('/api/admin/accelerator-sites', { institution: snap.institution, city: snap.city, country: snap.country, lab_or_clinic: snap.lab_or_clinic, mentor_line: snap.mentor_line, spots: snap.spots, year: snap.year, active: 1 });
          D.sites = await api.get('/api/admin/accelerator-sites'); rerender(); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
      } });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  addInst: async () => {
    const name = val('instDraft');
    if (!name) { ui.toast(COPY.inst.needName, { kind: 'error' }); return; }
    try {
      const r = await api.post('/api/admin/accelerator-sites', { institution: name, year: YEAR(), spots: 1 });
      D.sites = await api.get('/api/admin/accelerator-sites');
      st.instEdit = r.id; st.instRemoveConfirm = false; st.eName = name; st.ePlace = ''; st.eSpots = '1';
      rerender();
      ui.toast(COPY.inst.added);
      const focus = rootEl.querySelector('[data-role="ePlace"]'); if (focus) focus.focus();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  // — alumni (v2_accelerator_alumni) —
  aluEdit: (el) => {
    const id = el.dataset.id;
    if (st.aluEdit === id) { st.aluEdit = null; rerender(); return; }
    const r = alumniRows().find(x => x.id === id); if (!r) return;
    st.aluEdit = id; st.aluRemoveConfirm = false;
    st.aName = r.name; st.aPlace = r.placement_institution || ''; st.aYear = r.year == null ? '' : String(r.year);
    rerender();
  },
  aluCancel: () => { st.aluEdit = null; st.aluRemoveConfirm = false; rerender(); },
  aluSave: async (el) => {
    const id = el.dataset.id;
    const year = val('aYear').replace(/[^\d]/g, '');
    try {
      await api.put('/api/v2/accelerator-review/alumni/' + id, { name: val('aName') || undefined, placement_institution: val('aPlace'), year: year === '' ? null : parseInt(year, 10) });
      D.alumni = await api.get('/api/v2/accelerator-review/alumni');
      st.aluEdit = null; rerender();
      ui.toast(COPY.alumni.saved);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  aluRemove: async (el) => {
    if (!st.aluRemoveConfirm) { st.aluRemoveConfirm = true; rerender(); return; }
    const id = el.dataset.id;
    const snap = alumniRows().find(x => x.id === id);
    try {
      await api.del('/api/v2/accelerator-review/alumni/' + id);
      D.alumni = await api.get('/api/v2/accelerator-review/alumni');
      st.aluEdit = null; st.aluRemoveConfirm = false; rerender();
      ui.toast(COPY.alumni.removed, { undo: async () => {
        try { await api.post('/api/v2/accelerator-review/alumni', { name: snap.name, year: snap.year, placement_institution: snap.placement_institution, city: snap.city, photo_url: snap.photo_url, sort_order: snap.sort_order, is_published: snap.is_published });
          D.alumni = await api.get('/api/v2/accelerator-review/alumni'); rerender(); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
      } });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  aluPub: async (el) => {
    const id = el.dataset.id;
    const r = alumniRows().find(x => x.id === id); if (!r) return;
    try {
      await api.put('/api/v2/accelerator-review/alumni/' + id, { is_published: r.is_published ? 0 : 1 });
      D.alumni = await api.get('/api/v2/accelerator-review/alumni');
      rerender();
      ui.toast(COPY.alumni.puback(!r.is_published));
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  addAlu: async () => {
    const name = val('aluDraft');
    if (!name) { ui.toast(COPY.alumni.needName, { kind: 'error' }); return; }
    try {
      const r = await api.post('/api/v2/accelerator-review/alumni', { name, year: YEAR() });
      D.alumni = await api.get('/api/v2/accelerator-review/alumni');
      st.aluEdit = r.alumnus ? r.alumnus.id : null; st.aName = name; st.aPlace = ''; st.aYear = String(YEAR());
      rerender();
      ui.toast(COPY.alumni.added);
      const focus = rootEl.querySelector('[data-role="aPlace"]'); if (focus) focus.focus();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },

  // — evaluation criteria (existing per-year routes, 0–5 scale) —
  addCrit: async () => {
    const name = val('critDraft');
    if (!name) { ui.toast(COPY.crit.needName, { kind: 'error' }); return; }
    try {
      await api.post(`/api/accelerator/years/${YEAR()}/criteria`, { name, max_points: 5, weight: 1, category: 'objective' });
      D.criteria = await api.get(`/api/accelerator/years/${YEAR()}/criteria`);
      rerender();
      ui.toast(COPY.crit.added);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  critRemove: async (el) => {
    const id = el.dataset.id;
    try {
      await api.del('/api/accelerator/criteria/' + id);
      D.criteria = await api.get(`/api/accelerator/years/${YEAR()}/criteria`);
      rerender();
      ui.toast(COPY.crit.removed, { undo: async () => {
        try { await api.put('/api/accelerator/criteria/' + id, { is_active: 1 });
          D.criteria = await api.get(`/api/accelerator/years/${YEAR()}/criteria`); rerender(); } catch (e) { ui.toast(e.message, { kind: 'error' }); }
      } });
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  }
};

async function onFieldChange(e) {
  const el = e.target.closest && e.target.closest('[data-change]');
  if (!el || !rootEl || !rootEl.contains(el)) return;
  if (el.dataset.change === 'critRename') {
    const name = el.value.trim();
    if (!name) return;
    try {
      await api.put('/api/accelerator/criteria/' + el.dataset.id, { name });
      const c = (D.criteria || []).find(x => x.id === el.dataset.id); if (c) c.name = name;
      ui.toast(COPY.crit.renamed);
    } catch (err) { ui.toast(err.message, { kind: 'error' }); }
  }
}
function onKeydown(e) {
  if (e.key !== 'Enter' || !rootEl) return;
  const role = e.target && e.target.dataset ? e.target.dataset.role : '';
  const map = { instDraft: 'addInst', aluDraft: 'addAlu', critDraft: 'addCrit' };
  if (map[role]) { e.preventDefault(); handlers[map[role]](); }
}

export default {
  title: 'Accelerator',
  async render(root) {
    rootEl = root;
    st = { intakeEdit: false, instEdit: null, instRemoveConfirm: false, eName: '', ePlace: '', eSpots: '', aluEdit: null, aluRemoveConfirm: false, aName: '', aPlace: '', aYear: '' };
    if (!document.getElementById('mx-css-accelerator-hub')) {
      const l = document.createElement('link'); l.id = 'mx-css-accelerator-hub'; l.rel = 'stylesheet'; l.href = '/css/views/accelerator-hub.css'; document.head.appendChild(l);
    }
    D = await load();
    if (rootEl !== root) return;
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    onChange = onFieldChange; root.addEventListener('change', onChange);
    onKey = onKeydown; root.addEventListener('keydown', onKey);
    if (D.$errors && (D.$errors.sites || D.$errors.apps)) ui.toast(COPY.loadFail, { kind: 'error' });
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    if (rootEl && onChange) rootEl.removeEventListener('change', onChange);
    if (rootEl && onKey) rootEl.removeEventListener('keydown', onKey);
    onChange = null; onKey = null; rootEl = null; D = null; st = null;
  }
};
