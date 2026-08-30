// Source: Admin Plexus Hub.dc.html
// Blocks (artboard order): "Hub sub-nav" › "Title row" (name · LIVE FOR MEMBERS · facts line · ✎ EDIT ·
// MANAGE / EVENT DAY buttons) › "Stat strip + key dates" › "BEFORE THE WEEK" (row-list; Speakers /
// Schedule / Live Q&A rows open inline manage panels) › "THE GALA EVENING" + "AFTER THE WEEK" (left
// column) › "WHAT MEMBERS SEE" + "CME note" + v2 "STATS FOR MEDIA & SPONSORS" (right column, note 21) ›
// "Edition footer". The main header is NOT here — js/chrome.js renders it.
// Every number is a live database read (note 6); FACTS fills gaps and wording only.
// Deviations from the artboard (marked data-v2 where visible):
//   · the DAYS TO GO Croatian tooltip was dropped (review-round decision: text easter eggs removed);
//   · THE GALA EVENING "FULL VIEW →" goes to /gala (the seating board — the artboard pointed at
//     Event Day, but the guest list + seating live at /gala; the ON THE DAY row still goes there);
//   · sign-up forms render one row per form with a real OPEN/CLOSE control (screen spec).
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow } from '../facts.js';
import { perms } from '../perms.js';
import router from '../router.js';

export const SOURCE = 'Admin Plexus Hub.dc.html';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PLANNER_URL = 'https://plexus-tables.netlify.app/planner.html';
const SESSION_TYPES = ['talk', 'keynote', 'panel', 'workshop', 'networking', 'gala', 'break'];
const STATS_SCOPE = 'plexus';

// ---- COPY: every string that may change in a revision (dates/prices/venues via FACTS or the API) ----
export const COPY = {
  title: 'Plexus Week 2026',
  subnav: { projects: 'PROJECTS', self: 'PLEXUS WEEK 2026', accelerator: 'ACCELERATOR', forum: 'BIOMEDICAL FORUM', bridges: 'BUILDING BRIDGES' },
  head: {
    live: 'LIVE FOR MEMBERS', hidden: 'NOT ON THE MEMBER PORTAL', liveTitle: 'What members see right now — edit it in the card on the right',
    facts: (cap, range, venue, city) => `Conference (free, cap ${cap}) + Gala Evening + Donor Night · ${range} · ${venue}, ${city}`,
    edit: '✎ EDIT', editTitle: 'Dates, venue, capacity and registration — saved straight to the live conference',
    manage: 'WHAT MEMBERS SEE — MANAGE ↗', eventday: 'EVENT DAY ROOM →'
  },
  confModal: { eyebrow: 'CONFERENCE SETTINGS', title: 'Plexus Week — dates, venue & capacity', start: 'FIRST DAY', end: 'LAST DAY', venue: 'VENUE', vcity: 'CITY', cap: 'CAPACITY (SEATS)', open: 'Registration open', save: 'SAVE', cancel: 'CANCEL', saved: 'CONFERENCE SAVED — EVERY SCREEN READS IT LIVE', capBad: 'CAPACITY MUST BE A WHOLE NUMBER OF SEATS' },
  stats: {
    days: 'DAYS TO GO', reg: 'CONFERENCE REGISTERED', regSub: cap => `CAP ${cap} · OPEN LIST →`,
    gala: 'GALA SEATS', galaSub: (p, c) => `${p} PAID · ${c} TO CHASE →`,
    speakers: 'SPEAKERS', speakersLive: n => `${n} live for members · manage →`, speakersDraft: 'program in draft · manage →',
    money: 'COLLECTED', moneySub: 'OPEN MONEY →', calendar: 'CALENDAR →'
  },
  dates: { earlyBird: p => `Early-bird ends → ${p}`, dayOne: 'Donor Night · Event Day wakes up', dayTwo: 'Conference day two + Gala' },
  before: {
    title: 'BEFORE THE WEEK', sub: 'in priority order — what is not done yet',
    editList: '✎ EDIT LIST', editListTitle: 'Reorder, rename or add rows — this list is shared by the whole team', editListToast: 'THE LIST FOLLOWS THE LIVE DATA — EDIT THE THING ITSELF VIA ITS ROW',
    regs: { name: 'Registrations', open: 'OPEN NOW', closed: 'CLOSED', status: (n, cap) => `${n} of ${cap} signed up · form live`, action: 'OPEN LIST' },
    forms: { none: 'Sign-up Forms', noneStatus: 'No sign-up form pages yet — create one from Links', noneAction: 'CREATE', status: (r, w, d) => `${r} response${r === 1 ? '' : 's'}${w ? ` · ${w} waitlisted` : ''}${d ? ` · ${d}` : ''}`, open: 'OPEN', close: 'CLOSE', responses: 'RESPONSES', toggled: s => s === 'open' ? 'FORM IS LIVE — SIGN-UPS FLOW IN AGAIN' : 'FORM CLOSED — THE PAGE STOPS TAKING SIGN-UPS' },
    speakers: { name: 'Speakers', tag: n => `${n} CONFIRMED`, none: '0 CONFIRMED', status: (t, l) => `${t} on file · ${l} live on the member page`, action: 'MANAGE' },
    schedule: { name: 'Schedule & program', tag: n => `${n} PUBLISHED`, draft: 'IN DRAFT', status: t => `${t} session${t === 1 ? '' : 's'} · the member Program page renders the published rows`, none: 'No sessions yet — members see “Program in preparation”', action: 'BUILD' },
    travel: { tag: 'TRAVEL', name: 'Speaker itineraries', status: n => n ? `${n} itinerar${n === 1 ? 'y' : 'ies'} filed · flights, hotel nights & pickups per speaker` : 'Flights, hotel nights & airport pickups per speaker — nothing filed yet', action: 'MANAGE' },
    prices: { tag: 'SET', name: 'Tickets & prices', status: (a, b, d) => `Gala ${a} → ${b} on ${d}`, after: b => `Gala at the regular price ${b} — early bird is over`, action: 'EDIT' },
    outbox: { tag: 'QUEUED', clear: 'CLEAR', name: 'Emails to registrants', status: n => n ? `${n} batch${n === 1 ? '' : 'es'} queued in the Outbox — nothing sends without your OK` : 'Nothing queued — the Outbox is clear', action: 'REVIEW' },
    links: { tag: 'AUTO', name: 'Invitations & short links', status: n => `${n} live link${n === 1 ? '' : 's'} · Paid, VIP, diaspora — every sign-up lands tagged with its source`, action: 'GET LINK' },
    cme: { name: 'CME / HLK accreditation', on: 'ACCREDITED', off: 'NOT FILED', status: (p, s) => `${p != null ? p + ' HLK point' + (p === 1 ? '' : 's') : 'points not set'} · ${s} consented submission${s === 1 ? '' : 's'} for the chamber report`, offStatus: 'File the accreditation before the week — certificates need it', action: 'EXPORT CSV', door: 'SETTINGS', exported: 'CHAMBER CSV DOWNLOADED', exportFail: 'EXPORT FAILED — TRY AGAIN' },
    qa: { name: 'Live stage Q&A', open: n => `${n} OPEN`, quiet: 'QUIET', status: t => t ? `${t} question${t === 1 ? '' : 's'} from the floor · answer or hide them here` : 'No questions yet — the floor is quiet until the event', action: 'MODERATE' }
  },
  sp: {
    add: '+ ADD SPEAKER', addTitle: 'ADD', saveTitle: 'SAVE', cancel: 'CANCEL',
    name: 'Full name', role: 'Role (e.g. President)', inst: 'Institution', email: 'Email', talk: 'Talk title', keynote: 'Keynote',
    logo: 'Institution logo URL', tag: 'Shows on', tagOpts: [['', '—'], ['plexus', 'Plexus'], ['gala', 'Gala'], ['both', 'Both']],
    confirmedTitle: 'Confirmed = the speaker said yes; Live = members see the card',
    confirmed: 'CONFIRMED', pending: 'PENDING', live: 'LIVE', hiddenTag: 'HIDDEN',
    edit: 'EDIT', del: 'DELETE', photo: 'PHOTO', photoTitle: 'Upload a portrait — lands on the member page card',
    nameFirst: 'TYPE THE NAME FIRST', added: 'SPEAKER ADDED — CONFIRM & PUBLISH WHEN READY', saved: 'SPEAKER SAVED',
    confirmedOn: 'MARKED CONFIRMED', confirmedOff: 'BACK TO PENDING', liveOn: n => `${n.toUpperCase()} IS LIVE — MEMBERS SEE THE CARD NOW`, liveOff: 'HIDDEN FROM THE MEMBER PAGE',
    delAsk: n => `Remove ${n}? The member page stops showing the card at once.`, delOk: 'REMOVE', delKeep: 'KEEP', deleted: 'SPEAKER REMOVED',
    photoUp: 'PHOTO UPLOADED — ON THE CARD NOW', metaSaved: 'LOGO & EVENT TAG SAVED', empty: 'No speakers yet — add the first one above.'
  },
  ss: {
    add: '+ ADD SESSION', addTitle: 'ADD', saveTitle: 'SAVE', cancel: 'CANCEL',
    title: 'Session title', day: n => `Day ${n}`, start: 'Start', end: 'End', room: 'Room', type: 'Type',
    publishNow: 'Publish now', pub: 'PUBLISH', unpub: 'UNPUBLISH', pubAll: 'PUBLISH ALL', edit: 'EDIT', del: 'DELETE',
    liveTag: 'LIVE', draftTag: 'DRAFT',
    titleFirst: 'TYPE THE SESSION TITLE FIRST', added: 'SESSION ADDED', saved: 'SESSION SAVED',
    published: 'PUBLISHED — ON THE MEMBER PROGRAM PAGE NOW', unpublished: 'UNPUBLISHED — OFF THE MEMBER PAGE',
    pubAllAsk: n => `Publish all ${n} draft session${n === 1 ? '' : 's'}? Members get a schedule-update notification.`, pubAllOk: 'PUBLISH ALL', pubAllDone: n => `${n} SESSION${n === 1 ? '' : 'S'} PUBLISHED TO THE MEMBER PAGE`, pubAllNone: 'EVERYTHING IS ALREADY PUBLISHED',
    delAsk: t => `Delete “${t}”? It leaves the program and every personal schedule.`, delOk: 'DELETE', delKeep: 'KEEP', deleted: 'SESSION DELETED',
    empty: 'No sessions yet — members see “Program in preparation” until the first publish.'
  },
  qa: {
    answer: 'ANSWER', answered: 'ANSWERED', hide: 'HIDE', unhide: 'UNHIDE', from: 'from the floor', admin: 'organizer question',
    modal: { eyebrow: 'LIVE Q&A', title: 'Answer this question', send: 'SEND ANSWER', cancel: 'CANCEL', empty: 'TYPE THE ANSWER FIRST' },
    answeredToast: 'ANSWER SAVED — VISIBLE ON THE LIVE BOARD', hidden: 'QUESTION HIDDEN FROM THE BOARD', shown: 'QUESTION BACK ON THE BOARD', empty: 'No questions yet.'
  },
  gala: {
    title: 'THE GALA EVENING', when: (d, v) => [d, v].filter(Boolean).join(' · '), full: 'FULL VIEW →',
    seats: { name: 'Guest list & seating', tag: n => `${n} PAID`, status: (r, c) => `${r} reserved · ${c} to chase · seating chart open`, action: 'SEAT' },
    waitlist: { tag: 'AUTO', name: 'Waitlist', status: n => `${n} waiting · auto-offers a freed seat · 24 h to accept`, action: 'VIEW' },
    donor: { name: 'Donor Night — Croatians Abroad', none: '0 INVITED', tag: n => `${n} SIGNED UP`, status: d => `${d} · the diaspora list from the Croatians Abroad flow`, emptyStatus: d => `${d} · guest list empty`, action: 'INVITE' },
    onday: { tag: 'ON THE DAY', name: 'Check-in, ops map & stage Q&A', status: 'Live tools in the Event Day room', action: 'REHEARSE' },
    more: 'More tools:', planner: '3D ballroom planner', auctions: 'charity auctions', moreTail: '— auction pledges land in Money → Sponsors & donors'
  },
  after: {
    title: 'AFTER THE WEEK', line: d => `Certificates, thank-yous & photo recap unlock ${d}.`,
    certs: { name: 'Certificates & thank-yous', tag: 'QUEUED', done: n => `${n} SENT`, status: s => s || 'Runs after the week — every email stages to the Outbox for your OK', action: 'DETAILS' },
    editions: { name: 'Editions', tag: '2026 EDITION', status: n => `${n} edition${n === 1 ? '' : 's'} on file · nothing is ever deleted`, action: 'VIEW' },
    start2027: d => `START PLEXUS 2027 · AFTER ${d.toUpperCase()}`, start2027Title: 'Duplicates this hub with dates cleared — available after the 2026 edition closes',
    notYet: d => `AVAILABLE AFTER ${d.toUpperCase()} — THE 2026 EDITION CLOSES FIRST`,
    peModal: { eyebrow: 'POST-EVENT', title: 'Certificates, thank-yous & recap', close: 'CLOSE' }
  },
  edModal: { eyebrow: 'EDITIONS', title: 'Plexus — every edition on file', close: 'CLOSE', note: 'Archiving locks an edition read-only; carry-over starts the next year from it. Both open after the week.' },
  members: {
    title: 'WHAT MEMBERS SEE', sub: 'their home card', label: 'STATUS LABEL', detail: 'DETAIL LINE',
    save: 'SAVE TO MEMBER PORTAL', saved: '✓ SAVED — MEMBERS SEE IT NOW', failed: 'COULD NOT SAVE — TRY AGAIN',
    manage: 'MANAGE THE FULL MEMBER PAGE →'
  },
  cme: { on: '✓ CME accredited', onTail: ' — certificates auto-send after the week. ', off: '○ CME not filed yet', offTail: ' — set it up before the week so certificates can carry points. ', link: 'Settings → documents' },
  widget: {
    title: 'STATS FOR MEDIA & SPONSORS', sub: 'live numbers · ✎ overrides one figure',
    copy: 'COPY LINE', copied: 'LINE COPIED — PASTE IT ANYWHERE', copyFail: 'COPY FAILED — SELECT THE LINE BY HAND',
    manual: 'MANUAL', save: 'SET', clear: '✕', cleared: 'BACK TO THE LIVE NUMBER', overridden: 'FIGURE OVERRIDDEN — THE COPY LINE USES IT',
    figures: { registered: 'Registered', gala_paid: 'Gala seats paid', speakers_confirmed: 'Speakers confirmed', days_to_go: 'Days to go' },
    line: f => `Plexus Week 2026 — ${f.registered} registered (cap ${f.cap}) · ${f.gala_paid} Gala seats paid · ${f.speakers_confirmed} speakers confirmed · ${f.days_to_go} days to go · ${f.range} · ${f.venue}, ${f.city}`
  },
  footer: { line: 'nothing is ever deleted — tickets &amp; receipts stay valid forever.', edition: '2026 edition', archive: d => `ARCHIVE · AFTER ${d.toUpperCase()}`, archiveTitle: 'Locks this edition read-only once the week is over' },
  locked: sec => `${perms.label(sec) || 'That section'} is locked for you — ask Alen.`
};
const FIG_KEYS = ['registered', 'gala_paid', 'speakers_confirmed', 'days_to_go'];

// ---- view state ----
let D = null, st = null, unbind = null, rootEl = null, onChangeBound = null, onInputBound = null;

function injectCss() {
  if (!document.querySelector('link[data-mxp-css]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/css/views/plexus-hub.css'; l.setAttribute('data-mxp-css', '1');
    document.head.appendChild(l);
  }
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    conf: api.get('/api/conferences/active', { noAuth: true }),
    summary: api.get('/api/dashboard/summary'),
    pstats: api.get('/api/dashboard/portal-stats'),
    gala: api.get('/api/admin/gala/registrations'),
    gs: api.get('/api/admin/gala/settings'),
    sessions: api.get('/api/admin/plexus/sessions'),
    speakers: api.get('/api/admin/plexus/speakers'),
    meta: api.get('/api/v2/plexus-hub/speaker-meta'),
    forms: api.get('/api/admin/signup-forms'),
    cme: api.get('/api/admin/cme/events'),
    qa: api.get('/api/admin/plexus/qa'),
    editions: api.get('/api/admin/editions'),
    pe: api.get('/api/admin/post-event/summary?event_key=plexus'),
    pstatus: api.get('/api/admin/project-status'),
    cal: api.get('/api/admin/year-calendar'),
    outbox: api.get('/api/admin/outbox?status=pending_approval'),
    itins: api.get('/api/admin/speaker-itineraries'),
    links: api.get('/api/admin/registration-links'),
    waitlist: api.get('/api/admin/waitlist'),
    croat: api.get('/api/admin/croatians-abroad/registrations'),
    ov: api.get('/api/v2/plexus-hub/stats-overrides?scope=' + STATS_SCOPE)
  });
  const conf = r.conf || {};
  const galaRows = (Array.isArray(r.gala) ? r.gala : []).filter(g => !['rejected', 'cancelled'].includes(String(g.status || '')));
  const paid = galaRows.filter(g => g.payment_status === 'paid');
  const gs = r.gs || {};
  const ebDeadline = (gs.early_bird_deadline || FACTS.gala.priceFlip).slice(0, 10);
  const cmeList = Array.isArray(r.cme) ? r.cme : [];
  return {
    errors: r.$errors, conf,
    cap: Number(conf.max_capacity) || FACTS.plexus.cap,
    regs: r.summary ? Number(r.summary.plexus.registrations || 0) : (r.pstats ? Number(r.pstats.plexus.registrations || 0) : null),
    revenue: r.pstats && r.pstats.plexus ? Number(r.pstats.plexus.revenue || 0) : 0,
    gala: {
      rows: galaRows, paid, toChase: galaRows.filter(g => g.payment_status !== 'paid'),
      settings: gs, price: galaPriceNow(gs), early: Number(gs.price_gala_early_bird) || FACTS.gala.priceEarly,
      regular: Number(gs.price_gala_regular) || FACTS.gala.priceRegular,
      ebDeadline, ebDays: fmt.daysUntil(ebDeadline),
      collected: paid.reduce((n, g) => n + (Number(g.amount_paid) || 0), 0)
    },
    sessions: Array.isArray(r.sessions) ? r.sessions : [],
    speakers: Array.isArray(r.speakers) ? r.speakers : [],
    meta: (r.meta && r.meta.meta) || {},
    forms: Array.isArray(r.forms) ? r.forms : [],
    cme: cmeList.find(c => c.conference_id === conf.id) || cmeList.find(c => c.is_active) || null,
    qa: Array.isArray(r.qa) ? r.qa : [],
    editions: ((r.editions && r.editions.projects) || []).find(p => p.project === 'plexus') || { editions: [] },
    pe: r.pe || null,
    pstatus: (Array.isArray(r.pstatus) ? r.pstatus : []).find(p => p.project_key === 'plexus') || null,
    cal: Array.isArray(r.cal) ? r.cal : [],
    outbox: (r.outbox && Array.isArray(r.outbox.batches)) ? r.outbox.batches : [],
    itins: Array.isArray(r.itins) ? r.itins.length : ((r.itins && Array.isArray(r.itins.itineraries)) ? r.itins.itineraries.length : 0),
    links: (Array.isArray(r.links) ? r.links : ((r.links && r.links.links) || [])).filter(l => Number(l.is_active == null ? 1 : l.is_active)).length,
    waitn: (Array.isArray(r.waitlist) ? r.waitlist : []).filter(w => (w.status || 'waiting') === 'waiting').length,
    croat: Array.isArray(r.croat) ? r.croat.length : 0,
    overrides: (r.ov && r.ov.overrides) || {},
    days: Math.max(0, fmt.daysUntil(conf.start_date || FACTS.plexus.start) || 0)
  };
}

// ---------------------------------------------------------------- derived
const spConfirmed = () => D.speakers.filter(s => String(s.confirmation_status || '') === 'confirmed');
const spLive = () => D.speakers.filter(s => Number(s.is_confirmed) && Number(s.is_published));
const ssPublished = () => D.sessions.filter(s => Number(s.is_published));
const qaOpen = () => D.qa.filter(x => !x.is_answered && !x.is_hidden);
const isLocked = key => !!(D.errors[key] && D.errors[key].isLocked);
function euRange(a, b) {
  const da = fmt.toDate(a), db = fmt.toDate(b);
  if (!da) return FACTS.plexus.dateRange;
  if (!db || da.getTime() === db.getTime()) return `${da.getDate()} ${MONTHS_EN[da.getMonth()]}`;
  if (da.getMonth() === db.getMonth()) return `${da.getDate()}–${db.getDate()} ${MONTHS_EN[da.getMonth()]}`;
  return `${da.getDate()} ${MONTHS_EN[da.getMonth()]} – ${db.getDate()} ${MONTHS_EN[db.getMonth()]}`;
}
function afterLabel() { // 'Dec 6' — the day after the last conference day
  const end = fmt.toDate(D.conf.end_date || FACTS.plexus.end);
  if (!end) return 'the week';
  return fmt.dayShort(new Date(end.getTime() + 86400000));
}
const weekOver = () => (fmt.daysUntil(D.conf.end_date || FACTS.plexus.end) || 0) < 0;
function figLive() {
  return { registered: D.regs == null ? '—' : String(D.regs), gala_paid: String(D.gala.paid.length), speakers_confirmed: String(spConfirmed().length), days_to_go: String(D.days) };
}
function figEffective() {
  const live = figLive(); const out = {};
  FIG_KEYS.forEach(k => { out[k] = D.overrides[k] ? String(D.overrides[k].value) : live[k]; });
  return out;
}
function statsLine() {
  const f = figEffective();
  return COPY.widget.line({ ...f, cap: D.cap, range: fmt.longRange(D.conf.start_date || FACTS.plexus.start, D.conf.end_date || FACTS.plexus.end), venue: D.conf.venue_name || FACTS.plexus.venue, city: D.conf.venue_city || FACTS.plexus.city });
}
function keyDates() {
  const out = [];
  const add = (d, label, text, color) => { const dd = String(d || '').slice(0, 10); if (!dd) return; const n = fmt.daysUntil(dd); if (n == null || n < 0) return; out.push({ d: dd, label, text, color: color || (n <= 7 ? '#9b1b22' : '#c9a962') }); };
  if (D.gala.ebDays != null && D.gala.ebDays >= 0) add(D.gala.ebDeadline, fmt.dayLabel(D.gala.ebDeadline), COPY.dates.earlyBird(fmt.eur(D.gala.regular)));
  D.cal.forEach(e => { if (!e.starts_on || /early[- ]bird/i.test(e.title || '')) return; add(e.starts_on, fmt.rangeLabel(e.starts_on, e.ends_on), e.title); });
  add(D.conf.start_date || FACTS.plexus.start, fmt.dayLabel(D.conf.start_date || FACTS.plexus.start), COPY.dates.dayOne, '#9b1b22');
  add(D.conf.end_date || FACTS.plexus.end, fmt.dayLabel(D.conf.end_date || FACTS.plexus.end), COPY.dates.dayTwo, '#9b1b22');
  return out.sort((a, b) => a.d.localeCompare(b.d)).slice(0, 4);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; }
    catch (e2) { return false; }
  }
}

// ---------------------------------------------------------------- blocks
function blockSubnav() {
  const t = COPY.subnav;
  return `
  <!-- dc: Admin Plexus Hub.dc.html › "Hub sub-nav" -->
  <div style="background:#fff;border-bottom:1px solid rgba(32,27,22,.14)">
    <div class="mx-subnav mx-gutter" style="max-width:1180px;margin:0 auto;padding:0 28px;display:flex;gap:24px;align-items:center;height:44px">
      <a href="/today" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.projects}</a>
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#201b16;border-bottom:2px solid #9b1b22;padding:15px 0 13px">${t.self}</span>
      <a href="/projects/accelerator" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.accelerator}</a>
      <a href="/projects/forum" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.forum}</a>
      <a href="/projects/bridges" style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9a9086" data-hover="color:#201b16">${t.bridges}</a>
    </div>
  </div>
  <!-- /dc -->`;
}
function blockTitle() {
  const h = COPY.head;
  const live = D.pstatus && D.pstatus.status_label;
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "Title row" -->
    <div data-block="title" style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap">
      <div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class="mx-display-34" style="font-family:Fraunces,serif;font-size:34px;white-space:nowrap">Plexus Week <i>2026</i></span>
          <span data-act="msFocus" title="${esc(h.liveTitle)}" style="background:${live ? '#1e6e42' : '#b07d10'};color:#fff;font:600 9px Inter,sans-serif;letter-spacing:.14em;padding:4px 8px;cursor:pointer">${live ? h.live : h.hidden}</span>
        </div>
        <div style="font-size:13px;color:#6d6459;margin-top:6px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <span>${esc(h.facts(D.cap, euRange(D.conf.start_date || FACTS.plexus.start, D.conf.end_date || FACTS.plexus.end), D.conf.venue_name || FACTS.plexus.venue, D.conf.venue_city || FACTS.plexus.city))}</span>
          <span data-act="editConf" title="${esc(h.editTitle)}" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${h.edit}</span>
        </div>
      </div>
      <div class="mxp-title-actions" style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/member-pages" style="border:2px solid #9b1b22;background:#fff;color:#9b1b22;font:600 10px Inter,sans-serif;letter-spacing:.14em;padding:10px 16px;white-space:nowrap" data-hover="background:#9b1b22;color:#fff">${h.manage}</a>
        <a href="/event-day" style="background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;padding:11px 16px;white-space:nowrap" data-hover="background:#9b1b22">${h.eventday}</a>
      </div>
    </div>
    <!-- /dc -->`;
}
function blockStats() {
  const s = COPY.stats;
  const galaLocked = isLocked('gala');
  const collected = galaLocked ? null : D.gala.collected + D.revenue;
  const live = spLive().length;
  const cell = (inner, href, act) => href
    ? `<a href="${href}" style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1);color:#201b16;display:block" data-hover="background:#fdfbf6;color:#201b16">${inner}</a>`
    : act
      ? `<span data-act="${act}" style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1);color:#201b16;display:block;cursor:pointer" data-hover="background:#fdfbf6;color:#201b16">${inner}</span>`
      : `<div style="padding:16px 20px;border-right:1px solid rgba(32,27,22,.1)">${inner}</div>`;
  const kd = keyDates();
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "Stat strip + key dates" -->
    <div data-block="stats" style="border:1px solid rgba(32,27,22,.14);background:#fff;margin-top:22px">
      <div class="mx-kpi" style="display:grid;grid-template-columns:repeat(5,1fr)">
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.days}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.days}</div>
          <div style="font-size:11px;color:#6d6459">${esc(fmt.rangeLabel(D.conf.start_date || FACTS.plexus.start, D.conf.end_date || FACTS.plexus.end))} · ${esc(D.conf.venue_city || FACTS.plexus.city)}</div>`)}
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.reg}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.regs == null ? '—' : esc(fmt.num(D.regs))}</div>
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${esc(s.regSub(D.cap))}</div>`, '/registrations')}
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.gala}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${galaLocked ? '—' : D.gala.rows.length}</div>
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${galaLocked ? esc(COPY.locked('plexus')) : esc(s.galaSub(D.gala.paid.length, D.gala.toChase.length))}</div>`, '/gala')}
        ${cell(`
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.speakers}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${D.speakers.length}</div>
          <div style="font-size:11px;color:${spLive().length ? '#6d6459' : '#9b1b22'}">${live ? esc(s.speakersLive(live)) : s.speakersDraft}</div>`, null, 'openSpeakers')}
        <a href="/money" style="padding:16px 20px;color:#201b16;display:block" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${s.money}</div>
          <div class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;margin-top:3px">${collected == null ? '—' : esc(fmt.eur(collected))}</div>
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${s.moneySub}</div>
        </a>
      </div>
      <div class="mxp-dates" style="display:grid;grid-template-columns:repeat(4,1fr) auto;border-top:1px solid rgba(32,27,22,.1)">
        ${kd.map(r => `
        <div style="padding:10px 20px;display:flex;flex-direction:column;gap:2px;border-right:1px solid rgba(32,27,22,.08)">
          <span style="display:flex;align-items:center;gap:7px"><span style="width:7px;height:7px;background:${r.color};flex:none"></span><span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em">${esc(r.label)}</span></span>
          <span style="font-size:12px;color:#4a4239;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(fmt.detail(r.text))}</span>
        </div>`).join('')}
        <a href="/calendar" style="display:flex;align-items:center;padding:0 20px;border-left:1px solid rgba(32,27,22,.08);font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.stats.calendar}</a>
      </div>
    </div>
    <!-- /dc -->`;
}

// ---- BEFORE THE WEEK rows + inline manage panels -------------------------------------------------
function rowNav(r) { // the artboard's row: whole row is the door
  return `
          <a href="${esc(r.href)}" class="mx-row" data-row="${esc(r.id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08);color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${r.tagColor}">${esc(r.tag)}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600;white-space:nowrap">${esc(r.name)}</span><span style="font-size:12px;color:#6d6459;min-width:0">${esc(r.status)}</span></span>
            ${r.extra || ''}
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${esc(r.action)} →</span>
          </a>`;
}
function rowAct(r) { // same look, opens an inline panel instead of navigating
  return `
          <span data-act="${esc(r.act)}" class="mx-row" data-row="${esc(r.id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08);color:#201b16;cursor:pointer;text-align:left" data-hover="background:#fdfbf6">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${r.tagColor}">${esc(r.tag)}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600;white-space:nowrap">${esc(r.name)}</span><span style="font-size:12px;color:#6d6459;min-width:0">${esc(r.status)}</span></span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${esc(r.action)} ${st.openPanel === r.panel ? '↑' : '→'}</span>
          </span>`;
}
function lockedRow(id, name, sec) {
  return `<div class="mx-row" data-row="${esc(id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08)"><span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9a9086">LOCKED</span><span style="flex:1;font-size:12.5px;color:#6d6459"><b style="font-size:13.5px;color:#201b16">${esc(name)}</b> · ${esc(COPY.locked(sec))}</span></div>`;
}

function panelSpeakers() {
  const c = COPY.sp;
  const d = st.spDraft;
  const editing = !!st.spEdit;
  const opt = (v, l) => `<option value="${esc(v)}"${d.event_tag === v ? ' selected' : ''}>${esc(l)}</option>`;
  return `
        <div class="mxp-panel" data-block="spPanel">
          <div class="mxp-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:14px 20px 4px">
            <input data-role="spName" value="${esc(d.name)}" placeholder="${esc(c.name)}" aria-label="${esc(c.name)}" style="flex:1;min-width:150px">
            <input data-role="spTitle" value="${esc(d.title)}" placeholder="${esc(c.role)}" aria-label="${esc(c.role)}" style="width:150px">
            <input data-role="spInst" value="${esc(d.institution)}" placeholder="${esc(c.inst)}" aria-label="${esc(c.inst)}" style="width:170px">
            <input data-role="spEmail" value="${esc(d.email)}" placeholder="${esc(c.email)}" aria-label="${esc(c.email)}" style="width:150px">
          </div>
          <div class="mxp-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 20px 14px">
            <input data-role="spTalk" value="${esc(d.talk_title)}" placeholder="${esc(c.talk)}" aria-label="${esc(c.talk)}" style="flex:1;min-width:160px">
            <input data-role="spLogo" value="${esc(d.logo)}" placeholder="${esc(c.logo)}" aria-label="${esc(c.logo)}" style="width:190px">
            <select data-role="spTag" aria-label="${esc(c.tag)}">${c.tagOpts.map(([v, l]) => opt(v, l)).join('')}</select>
            <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="spKeynote"${d.is_keynote ? ' checked' : ''}> ${c.keynote}</label>
            ${editing ? `<span data-act="spUpload" title="${esc(c.photoTitle)}" class="btn-ghost" style="padding:8px 12px;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${c.photo}</span><input type="file" accept="image/*" data-role="spPhotoFile" style="display:none">` : ''}
            <span data-act="spSave" class="btn-primary" style="padding:9px 14px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${editing ? c.saveTitle : c.addTitle}</span>
            ${editing ? `<span data-act="spCancel" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.cancel}</span>` : ''}
          </div>
          ${D.speakers.map(sp => {
            const confirmed = String(sp.confirmation_status || '') === 'confirmed';
            const live = Number(sp.is_confirmed) && Number(sp.is_published);
            const meta = D.meta[sp.id] || {};
            return `
          <div data-row="sp-${esc(sp.id)}" style="display:flex;align-items:center;gap:12px;padding:9px 20px;border-top:1px solid rgba(32,27,22,.07)">
            ${sp.photo_url ? `<img src="${esc(sp.photo_url)}" alt="" style="width:26px;height:26px;object-fit:cover;flex:none">` : `<span style="width:26px;height:26px;background:#f6f2ea;border:1px solid rgba(32,27,22,.14);flex:none;display:inline-flex;align-items:center;justify-content:center;font:600 10px Inter,sans-serif;color:#9a9086">${esc(fmt.initials(sp.name))}</span>`}
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(sp.name)}${Number(sp.is_keynote) ? ` <span class="tag tag-gold">KEYNOTE</span>` : ''}${meta.event_tag ? ` <span class="tag">${esc(String(meta.event_tag).toUpperCase())}</span>` : ''}</span><span style="display:block;font-size:11.5px;color:#6d6459;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc([sp.title, sp.institution].filter(Boolean).join(' · ') || '—')}</span></span>
            <span data-act="spConfirm" data-id="${esc(sp.id)}" title="${esc(c.confirmedTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;cursor:pointer;background:${confirmed ? '#1e6e42' : '#f8f1e2'};color:${confirmed ? '#fff' : '#7a6432'};white-space:nowrap">${confirmed ? c.confirmed : c.pending}</span>
            <span data-act="spLive" data-id="${esc(sp.id)}" title="${esc(c.confirmedTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.11em;padding:3px 7px;cursor:pointer;background:${live ? '#201b16' : '#f6f2ea'};color:${live ? '#f6f2ea' : '#9a9086'};border:1px solid rgba(32,27,22,.14);white-space:nowrap">${live ? c.live : c.hiddenTag}</span>
            <span data-act="spEditBtn" data-id="${esc(sp.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.edit}</span>
            <span data-act="spDel" data-id="${esc(sp.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${c.del}</span>
          </div>`; }).join('')}
          ${!D.speakers.length ? `<div style="padding:6px 20px 16px;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : '<div style="height:8px"></div>'}
        </div>`;
}
function panelSchedule() {
  const c = COPY.ss;
  const d = st.ssDraft;
  const editing = !!st.ssEdit;
  const drafts = D.sessions.length - ssPublished().length;
  return `
        <div class="mxp-panel" data-block="ssPanel">
          <div class="mxp-form" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:14px 20px">
            <input data-role="ssTitle" value="${esc(d.title)}" placeholder="${esc(c.title)}" aria-label="${esc(c.title)}" style="flex:1;min-width:170px">
            <select data-role="ssDay" aria-label="Day">${[1, 2].map(n => `<option value="${n}"${Number(d.day) === n ? ' selected' : ''}>${esc(c.day(n))} · ${esc(fmt.dayShort(new Date((fmt.toDate(D.conf.start_date || FACTS.plexus.start) || new Date()).getTime() + (n - 1) * 86400000)))}</option>`).join('')}</select>
            <input data-role="ssStart" value="${esc(d.start_time)}" placeholder="09:00" aria-label="${esc(c.start)}" style="width:64px">
            <input data-role="ssEnd" value="${esc(d.end_time)}" placeholder="09:45" aria-label="${esc(c.end)}" style="width:64px">
            <input data-role="ssRoom" value="${esc(d.room)}" placeholder="${esc(c.room)}" aria-label="${esc(c.room)}" style="width:110px">
            <select data-role="ssType" aria-label="${esc(c.type)}">${SESSION_TYPES.map(t => `<option value="${t}"${d.session_type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
            <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#4a4239;cursor:pointer"><input type="checkbox" data-role="ssPub"${d.is_published ? ' checked' : ''}> ${c.publishNow}</label>
            <span data-act="ssSave" class="btn-primary" style="padding:9px 14px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${editing ? c.saveTitle : c.addTitle}</span>
            ${editing ? `<span data-act="ssCancel" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.cancel}</span>` : ''}
            ${drafts > 0 ? `<span data-act="ssPubAll" class="btn-ghost" style="padding:8px 12px;font:600 9px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${c.pubAll} · ${drafts}</span>` : ''}
          </div>
          ${D.sessions.map(s => `
          <div data-row="ss-${esc(s.id)}" style="display:flex;align-items:center;gap:12px;padding:9px 20px;border-top:1px solid rgba(32,27,22,.07)">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459">DAY ${esc(String(s.day || 1))} · ${esc([s.start_time, s.end_time].filter(Boolean).join('–') || '—')}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px;font-weight:600">${esc(s.title)}</span><span style="display:block;font-size:11.5px;color:#6d6459">${esc([s.room, s.track, s.session_type !== 'talk' ? s.session_type : ''].filter(Boolean).join(' · ') || '—')}${s.speaker_names ? ' · ' + esc(s.speaker_names) : ''}</span></span>
            <span class="tag${Number(s.is_published) ? ' tag-live' : ''}">${Number(s.is_published) ? c.liveTag : c.draftTag}</span>
            <span data-act="ssPubOne" data-id="${esc(s.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${Number(s.is_published) ? c.unpub : c.pub}</span>
            <span data-act="ssEditBtn" data-id="${esc(s.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.edit}</span>
            <span data-act="ssDel" data-id="${esc(s.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${c.del}</span>
          </div>`).join('')}
          ${!D.sessions.length ? `<div style="padding:2px 20px 16px;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : '<div style="height:8px"></div>'}
        </div>`;
}
function panelQa() {
  const c = COPY.qa;
  return `
        <div class="mxp-panel" data-block="qaPanel">
          ${D.qa.map(q => `
          <div data-row="qa-${esc(q.id)}" style="display:flex;align-items:flex-start;gap:12px;padding:11px 20px;border-top:1px solid rgba(32,27,22,.07);${q.is_hidden ? 'opacity:.55' : ''}">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.1em;color:${q.is_answered ? '#1e6e42' : '#9b1b22'};padding-top:2px">${q.is_answered ? c.answered : `▲ ${Number(q.upvotes) || 0}`}</span>
            <span style="flex:1;min-width:0"><span style="display:block;font-size:13px">${esc(q.text)}</span><span style="display:block;font-size:11.5px;color:#6d6459;margin-top:2px">${esc(q.is_from_admin ? c.admin : (q.author_name || '—') + ' · ' + c.from)}${q.answer_text ? ` — <i>${esc(q.answer_text)}</i>` : ''}</span></span>
            ${q.is_answered ? '' : `<span data-act="qaAnswer" data-id="${esc(q.id)}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${c.answer}</span>`}
            <span data-act="qaHide" data-id="${esc(q.id)}" data-hidden="${q.is_hidden ? 1 : 0}" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${q.is_hidden ? c.unhide : c.hide}</span>
          </div>`).join('')}
          ${!D.qa.length ? `<div style="padding:14px 20px;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : '<div style="height:8px"></div>'}
        </div>`;
}

function blockBefore() {
  const c = COPY.before;
  const formsLocked = isLocked('forms');
  const cmeLocked = isLocked('cme');
  const regOpen = Number(D.conf.registration_open == null ? 1 : D.conf.registration_open);
  const confirmedN = spConfirmed().length;
  const pubN = ssPublished().length;
  const openQ = qaOpen().length;
  const formRow = f => `
          <div class="mx-row" data-row="form-${esc(f.id)}" style="display:flex;align-items:center;gap:14px;padding:10px 20px;border-bottom:1px solid rgba(32,27,22,.08)">
            <span style="width:92px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${f.status === 'open' ? '#1e6e42' : f.status === 'draft' ? '#b07d10' : '#6d6459'}">${esc(String(f.status || 'draft').toUpperCase())}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px">${esc(f.title)}</span><span style="font-size:12px;color:#6d6459;min-width:0">${esc(c.forms.status(Number(f.response_count) || 0, Number(f.waitlist_count) || 0, f.event_date ? fmt.dayShort(f.event_date) : ''))}</span></span>
            <span data-act="formToggle" data-id="${esc(f.id)}" data-status="${esc(f.status || 'draft')}" data-v2="open-close" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;border:1px solid rgba(32,27,22,.2);padding:5px 9px;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16;color:#201b16">${f.status === 'open' ? c.forms.close : c.forms.open}</span>
            <a href="/links" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${c.forms.responses} →</a>
          </div>`;
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "BEFORE THE WEEK" -->
    <div data-block="before" style="background:#fff;border:1px solid rgba(32,27,22,.14);margin-top:22px">
      <div style="padding:12px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:center;gap:10px"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em">${c.title}</span><span style="font-size:12px;color:#9a9086">${c.sub}</span><div style="flex:1"></div><span data-act="editList" title="${esc(c.editListTitle)}" style="font:600 8.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer" data-hover="color:#201b16">${c.editList}</span></div>
      ${rowNav({ id: 'regs', tag: regOpen ? c.regs.open : c.regs.closed, tagColor: regOpen ? '#1e6e42' : '#9b1b22', name: c.regs.name, status: c.regs.status(D.regs == null ? '—' : D.regs, D.cap), action: c.regs.action, href: '/registrations' })}
      ${formsLocked ? lockedRow('forms', c.forms.none, 'signup-forms')
        : D.forms.length ? D.forms.map(formRow).join('')
        : rowNav({ id: 'forms', tag: 'NONE YET', tagColor: '#b07d10', name: c.forms.none, status: c.forms.noneStatus, action: c.forms.noneAction, href: '/links' })}
      ${rowAct({ id: 'speakers', act: 'openSpeakers', panel: 'speakers', tag: confirmedN ? c.speakers.tag(confirmedN) : c.speakers.none, tagColor: confirmedN ? '#1e6e42' : '#9b1b22', name: c.speakers.name, status: c.speakers.status(D.speakers.length, spLive().length), action: c.speakers.action })}
      ${st.openPanel === 'speakers' ? panelSpeakers() : ''}
      ${rowAct({ id: 'schedule', act: 'openSchedule', panel: 'schedule', tag: pubN ? c.schedule.tag(pubN) : c.schedule.draft, tagColor: pubN ? '#1e6e42' : '#9b1b22', name: c.schedule.name, status: D.sessions.length ? c.schedule.status(D.sessions.length) : c.schedule.none, action: c.schedule.action })}
      ${st.openPanel === 'schedule' ? panelSchedule() : ''}
      ${rowNav({ id: 'travel', tag: c.travel.tag, tagColor: '#b07d10', name: c.travel.name, status: c.travel.status(D.itins), action: c.travel.action, href: '/calendar' })}
      ${rowNav({ id: 'prices', tag: c.prices.tag, tagColor: '#6d6459', name: c.prices.name, status: D.gala.ebDays >= 0 ? c.prices.status(fmt.eur(D.gala.early), fmt.eur(D.gala.regular), fmt.dayShort(D.gala.ebDeadline)) : c.prices.after(fmt.eur(D.gala.regular)), action: c.prices.action, href: '/money' })}
      ${rowNav({ id: 'outbox', tag: D.outbox.length ? c.outbox.tag : c.outbox.clear, tagColor: D.outbox.length ? '#b07d10' : '#6d6459', name: c.outbox.name, status: c.outbox.status(D.outbox.length), action: c.outbox.action, href: '/inbox/outbox' })}
      ${rowNav({ id: 'links', tag: c.links.tag, tagColor: '#6d6459', name: c.links.name, status: c.links.status(D.links), action: c.links.action, href: '/links' })}
      ${cmeLocked ? lockedRow('cme', c.cme.name, 'cme')
        : rowNav({ id: 'cme', tag: D.cme && D.cme.is_accredited ? c.cme.on : c.cme.off, tagColor: D.cme && D.cme.is_accredited ? '#1e6e42' : '#b07d10', name: c.cme.name, status: D.cme && D.cme.is_accredited ? c.cme.status(D.cme.points_value, Number(D.cme.consented) || 0) : c.cme.offStatus, action: c.cme.door, href: '/settings', extra: `<span data-act="cmeExport" data-v2="cme-export" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;border:1px solid rgba(32,27,22,.2);padding:5px 9px;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16;color:#201b16">${c.cme.action}</span>` })}
      ${rowAct({ id: 'qa', act: 'openQa', panel: 'qa', tag: openQ ? c.qa.open(openQ) : c.qa.quiet, tagColor: openQ ? '#9b1b22' : '#6d6459', name: c.qa.name, status: c.qa.status(D.qa.length), action: c.qa.action })}
      ${st.openPanel === 'qa' ? panelQa() : ''}
    </div>
    <!-- /dc -->`;
}

function blockGala() {
  const c = COPY.gala;
  const g = D.gala;
  const galaLocked = isLocked('gala');
  const when = [g.settings.date ? fmt.dayShort(g.settings.date) : FACTS.gala.dateLabel, g.settings.venue || FACTS.gala.venue].filter(Boolean);
  const row = r => `
          <a href="${esc(r.href)}" class="mx-row" data-row="${esc(r.id)}" style="display:flex;align-items:center;gap:14px;padding:15px 20px;border-bottom:1px solid rgba(32,27,22,.08);color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:110px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.13em;color:${r.tagColor}">${esc(r.tag)}</span>
            <span class="mx-row-text" style="flex:1;min-width:0"><span style="display:block;font-size:14px;font-weight:600">${esc(r.name)}</span><span style="display:block;font-size:12px;color:#6d6459;margin-top:2px">${esc(r.status)}</span></span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${esc(r.action)} →</span>
          </a>`;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "THE GALA EVENING" -->
        <div data-block="gala" style="background:#fff;border:1px solid rgba(32,27,22,.14)">
          <div style="padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em">${c.title}</span><span style="font-size:12px;color:#9a9086">${esc(c.when(when[0], when[1] || ''))}</span><div style="flex:1"></div><a href="/gala" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${c.full}</a></div>
          ${galaLocked ? `<div style="padding:8px 0">${ui.lockedBlock(perms.label('plexus'))}</div>` : `
          ${row({ id: 'gala-seats', tag: c.seats.tag(g.paid.length), tagColor: '#1e6e42', name: c.seats.name, status: c.seats.status(g.rows.length, g.toChase.length), action: c.seats.action, href: '/gala' })}
          ${row({ id: 'gala-waitlist', tag: c.waitlist.tag, tagColor: '#6d6459', name: c.waitlist.name, status: c.waitlist.status(D.waitn), action: c.waitlist.action, href: '/gala' })}
          ${row({ id: 'gala-donor', tag: D.croat ? c.donor.tag(D.croat) : c.donor.none, tagColor: D.croat ? '#1e6e42' : '#9b1b22', name: c.donor.name, status: D.croat ? c.donor.status(fmt.dayShort(D.conf.start_date || FACTS.plexus.start)) : c.donor.emptyStatus(fmt.dayShort(D.conf.start_date || FACTS.plexus.start)), action: c.donor.action, href: '/links' })}
          ${row({ id: 'gala-onday', tag: c.onday.tag, tagColor: '#6d6459', name: c.onday.name, status: c.onday.status, action: c.onday.action, href: '/event-day' })}`}
          <div style="padding:12px 20px;font-size:12px;color:#6d6459">${c.more} <a href="${esc(PLANNER_URL)}" target="_blank" rel="noopener" data-row="gala-planner">${c.planner} ↗</a> · <a href="/money" data-row="gala-auctions">${c.auctions}</a> ${c.moreTail}</div>
        </div>
        <!-- /dc -->`;
}

function blockAfter() {
  const c = COPY.after;
  const after = afterLabel();
  const pe = D.pe || {};
  const certs = Number(pe.certificates_issued != null ? pe.certificates_issued : (pe.certs && pe.certs.issued)) || 0;
  const peLine = pe && (pe.checked_in != null || pe.certificates_issued != null || pe.rounds != null)
    ? `${certs} certificate${certs === 1 ? '' : 's'} issued${pe.checked_in != null ? ` · ${pe.checked_in} checked in` : ''} — everything stages to the Outbox for your OK`
    : null;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "AFTER THE WEEK" -->
        <div data-block="after" style="background:#fff;border:1px solid rgba(32,27,22,.14)">
          <div style="padding:16px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em">${c.title}</span>
            <span style="font-size:13px;color:#6d6459;flex:1;min-width:200px">${esc(c.line(after))}</span>
            <span data-act="start2027" title="${esc(c.start2027Title)}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap;color:#9a9086;border:1px dashed rgba(32,27,22,.3);padding:6px 10px;cursor:pointer">${esc(c.start2027(after))}</span>
          </div>
          <div data-v2="post-event-rows" style="border-top:1px solid rgba(32,27,22,.08)">
          <span data-act="peOpen" class="mx-row" data-row="pe-certs" style="display:flex;align-items:center;gap:14px;padding:11px 20px;border-bottom:1px solid rgba(32,27,22,.08);cursor:pointer;color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:110px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.13em;color:${certs ? '#1e6e42' : '#6d6459'}">${certs ? esc(c.certs.done(certs)) : c.certs.tag}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;font-size:12.5px;color:#6d6459"><b style="font-size:13.5px;color:#201b16">${c.certs.name}</b> · ${esc(c.certs.status(peLine))}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${c.certs.action} →</span>
          </span>
          <span data-act="editionsOpen" class="mx-row" data-row="editions" style="display:flex;align-items:center;gap:14px;padding:11px 20px;cursor:pointer;color:#201b16" data-hover="background:#fdfbf6">
            <span style="width:110px;flex:none;font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${c.editions.tag}</span>
            <span class="mx-row-text" style="flex:1;min-width:0;font-size:12.5px;color:#6d6459"><b style="font-size:13.5px;color:#201b16">${c.editions.name}</b> · ${esc(c.editions.status(D.editions.editions.length))}</span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${c.editions.action} →</span>
          </span>
          </div>
        </div>
        <!-- /dc -->`;
}

function blockMembers() {
  const c = COPY.members;
  const p = D.pstatus || {};
  const saved = st.msSaved;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "WHAT MEMBERS SEE" -->
        <div id="members-card" data-block="members" style="background:#fff;border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962">
          <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:baseline;gap:10px"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap">${c.title}</span><span style="font-size:12px;color:#9a9086;white-space:nowrap">${c.sub}</span></div>
          <div style="padding:4px 20px 20px">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;margin-top:16px">${c.label}</div>
          <input data-role="msLabel" value="${esc(p.status_label || '')}" aria-label="${esc(c.label)}" style="width:100%;box-sizing:border-box;margin-top:6px;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:10px 12px;font:400 13px Inter,sans-serif;color:#201b16">
          <div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459;margin-top:12px">${c.detail}</div>
          <input data-role="msDetail" value="${esc(p.detail_line || '')}" aria-label="${esc(c.detail)}" style="width:100%;box-sizing:border-box;margin-top:6px;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:10px 12px;font:400 13px Inter,sans-serif;color:#201b16">
          <button data-act="msSave" data-role="msSaveBtn" style="margin-top:14px;background:${saved ? '#1e6e42' : '#9b1b22'};color:#fff;border:none;font:600 10px Inter,sans-serif;letter-spacing:.14em;padding:11px 18px;cursor:pointer;white-space:nowrap">${saved ? c.saved : c.save}</button>
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(32,27,22,.1)"><a href="/member-pages" style="font:600 9px Inter,sans-serif;letter-spacing:.14em">${c.manage}</a></div>
          </div>
        </div>
        <!-- /dc -->`;
}
function blockCme() {
  const c = COPY.cme;
  const on = D.cme && D.cme.is_accredited;
  return `
        <!-- dc: Admin Plexus Hub.dc.html › "CME note" -->
        <div data-block="cmeNote" style="border:1px solid rgba(32,27,22,.14);background:#fdfbf6;padding:16px 20px;font-size:12.5px;color:#6d6459;line-height:1.6">
          <span style="color:${on ? '#1e6e42' : '#b07d10'};font-weight:600">${on ? c.on : c.off}</span>${on ? c.onTail : c.offTail}<a href="/settings">${c.link}</a>
        </div>
        <!-- /dc -->`;
}
function blockStatsWidget() {
  const c = COPY.widget;
  const live = figLive();
  const fig = k => {
    const ov = D.overrides[k];
    const editing = st.ovEdit === k;
    return `
          <div data-row="fig-${k}" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(32,27,22,.07)">
            <span style="flex:1;font-size:12.5px;color:#4a4239">${esc(c.figures[k])}</span>
            ${editing
              ? `<input class="mxp-fig-input" data-role="ovInput" value="${esc(ov ? ov.value : live[k])}" aria-label="${esc(c.figures[k])} override">
                 <span data-act="ovSave" data-key="${k}" class="btn-primary" style="padding:6px 10px;font:600 8.5px Inter,sans-serif;letter-spacing:.12em;cursor:pointer">${c.save}</span>`
              : `<span style="font-family:Fraunces,serif;font-size:19px">${esc(ov ? ov.value : live[k])}</span>
                 ${ov ? `<span class="tag tag-gold" title="Live value: ${esc(live[k])}">${c.manual}</span><span data-act="ovClear" data-key="${k}" title="Back to the live number" style="font:600 10px Inter,sans-serif;color:#6d6459;cursor:pointer" data-hover="color:#9b1b22">${c.clear}</span>` : ''}
                 <span data-act="ovEdit" data-key="${k}" title="Override this figure for the copy line" style="font:600 10px Inter,sans-serif;color:#6d6459;cursor:pointer" data-hover="color:#201b16">✎</span>`}
          </div>`;
  };
  return `
        <!-- v2: "STATS FOR MEDIA & SPONSORS" — the reusable per-hub stats widget (README admin note 21):
             scoped live numbers · per-figure manual override (v2_stats_overrides) · one-click copy line -->
        <div data-block="widget" data-v2="stats-widget" style="background:#fff;border:1px solid rgba(32,27,22,.14)">
          <div style="padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;white-space:nowrap">${c.title}</span><span style="font-size:11.5px;color:#9a9086">${c.sub}</span></div>
          <div style="padding:6px 20px 4px">${FIG_KEYS.map(fig).join('')}</div>
          <div style="padding:10px 20px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span data-act="copyStats" class="btn-ghost" style="padding:8px 13px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${c.copy}</span>
            <span data-role="statsLine" style="font-size:11px;color:#9a9086;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(statsLine())}</span>
          </div>
        </div>
        <!-- /v2 -->`;
}
function blockFooterEdition() {
  const c = COPY.footer;
  return `
    <!-- dc: Admin Plexus Hub.dc.html › "Edition footer" -->
    <div data-block="edfoot" style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-top:30px;flex-wrap:wrap">
      <span style="font-size:12px;color:#9a9086"><b style="color:#6d6459">${c.edition}</b> · ${c.line}</span>
      <span data-act="archiveNote" title="${esc(c.archiveTitle)}" style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#c9beb2;border:1px dashed rgba(32,27,22,.25);padding:5px 9px;cursor:pointer">${esc(c.archive(afterLabel()))}</span>
    </div>
    <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin Plexus Hub" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  ${blockSubnav()}
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:34px 28px 60px">
    ${blockTitle()}
    ${blockStats()}
    ${blockBefore()}
    <div class="mx-two" style="display:grid;grid-template-columns:1.55fr 1fr;gap:22px;margin-top:22px;align-items:start">
      <div class="mxp-col" style="display:grid;gap:22px">
        ${blockGala()}
        ${blockAfter()}
      </div>
      <div class="mxp-col" style="display:grid;gap:22px">
        ${blockMembers()}
        ${blockCme()}
        ${blockStatsWidget()}
      </div>
    </div>
    ${blockFooterEdition()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function paint() { if (rootEl) { rootEl.innerHTML = template(); } }
function val(role) { const el = rootEl.querySelector(`[data-role="${role}"]`); return el ? el.value.trim() : ''; }
function checked(role) { const el = rootEl.querySelector(`[data-role="${role}"]`); return !!(el && el.checked); }
const blankSp = () => ({ name: '', title: '', institution: '', email: '', talk_title: '', is_keynote: false, logo: '', event_tag: '' });
const blankSs = () => ({ title: '', day: 1, start_time: '', end_time: '', room: '', session_type: 'talk', is_published: false });

async function reload(keys) {
  // partial refresh: re-run only the touched reads, then repaint
  const calls = {
    speakers: () => api.get('/api/admin/plexus/speakers'),
    meta: () => api.get('/api/v2/plexus-hub/speaker-meta'),
    sessions: () => api.get('/api/admin/plexus/sessions'),
    forms: () => api.get('/api/admin/signup-forms'),
    qa: () => api.get('/api/admin/plexus/qa'),
    conf: () => api.get('/api/conferences/active', { noAuth: true }),
    pstatus: () => api.get('/api/admin/project-status')
  };
  for (const k of keys) {
    try {
      const v = await calls[k]();
      if (k === 'speakers') D.speakers = Array.isArray(v) ? v : [];
      else if (k === 'meta') D.meta = (v && v.meta) || {};
      else if (k === 'sessions') D.sessions = Array.isArray(v) ? v : [];
      else if (k === 'forms') D.forms = Array.isArray(v) ? v : [];
      else if (k === 'qa') D.qa = Array.isArray(v) ? v : [];
      else if (k === 'conf') { D.conf = v || {}; D.cap = Number(D.conf.max_capacity) || FACTS.plexus.cap; D.days = Math.max(0, fmt.daysUntil(D.conf.start_date || FACTS.plexus.start) || 0); }
      else if (k === 'pstatus') D.pstatus = (Array.isArray(v) ? v : []).find(p => p.project_key === 'plexus') || D.pstatus;
    } catch (e) { /* keep the stale slice — the toast already reported the write result */ }
  }
  paint();
}

function readSpDraft() {
  return { name: val('spName'), title: val('spTitle'), institution: val('spInst'), email: val('spEmail'), talk_title: val('spTalk'), is_keynote: checked('spKeynote'), logo: val('spLogo'), event_tag: val('spTag') };
}
function readSsDraft() {
  return { title: val('ssTitle'), day: Number(val('ssDay')) || 1, start_time: val('ssStart'), end_time: val('ssEnd'), room: val('ssRoom'), session_type: val('ssType') || 'talk', is_published: checked('ssPub') };
}

const handlers = {
  // ---- title row
  msFocus: () => { const el = rootEl.querySelector('#members-card'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = rootEl.querySelector('[data-role="msLabel"]'); if (i) i.focus(); } },
  editConf: () => {
    const c = COPY.confModal, conf = D.conf;
    const inp = (role, label, valv, type = 'text', extra = '') => `<div style="margin-top:10px"><div style="font:600 9px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${label}</div><input data-role="${role}" type="${type}" value="${esc(valv == null ? '' : valv)}" ${extra} style="width:100%;box-sizing:border-box;margin-top:5px;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:9px 11px;font:400 13px Inter,sans-serif;color:#201b16"></div>`;
    const m = ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">${inp('cfStart', c.start, String(conf.start_date || '').slice(0, 10), 'date')}${inp('cfEnd', c.end, String(conf.end_date || '').slice(0, 10), 'date')}${inp('cfVenue', c.venue, conf.venue_name)}${inp('cfCity', c.vcity, conf.venue_city)}${inp('cfCap', c.cap, conf.max_capacity, 'number', 'min="1" step="1"')}<label style="display:flex;gap:8px;align-items:center;font-size:12.5px;color:#4a4239;margin-top:26px;cursor:pointer"><input type="checkbox" data-role="cfOpen"${Number(conf.registration_open) ? ' checked' : ''}> ${c.open}</label></div>`,
      actions: [
        { label: c.cancel },
        { label: c.save, kind: 'primary', onClick: () => {
          const g = r => { const el = m.el.querySelector(`[data-role="${r}"]`); return el ? el.value.trim() : ''; };
          const cap = Number(g('cfCap'));
          if (!Number.isInteger(cap) || cap < 1) { ui.toast(c.capBad, { kind: 'error' }); return false; }
          const body = { start_date: g('cfStart') || conf.start_date, end_date: g('cfEnd') || conf.end_date, venue_name: g('cfVenue'), venue_city: g('cfCity'), max_capacity: cap, registration_open: m.el.querySelector('[data-role="cfOpen"]').checked ? 1 : 0 };
          api.put('/api/admin/conferences/' + encodeURIComponent(conf.id), body)
            .then(() => { ui.toast(c.saved); reload(['conf']); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
      ]
    });
  },
  // ---- BEFORE list
  editList: () => ui.toast(COPY.before.editListToast),
  openSpeakers: () => { st.openPanel = st.openPanel === 'speakers' ? null : 'speakers'; st.spEdit = null; st.spDraft = blankSp(); paint(); if (st.openPanel) { const r = rootEl.querySelector('[data-block="spPanel"]'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
  openSchedule: () => { st.openPanel = st.openPanel === 'schedule' ? null : 'schedule'; st.ssEdit = null; st.ssDraft = blankSs(); paint(); },
  openQa: () => { st.openPanel = st.openPanel === 'qa' ? null : 'qa'; paint(); },
  formToggle: async (el) => {
    const id = el.dataset.id, cur = el.dataset.status;
    const next = cur === 'open' ? 'closed' : 'open';
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/signup-forms/' + encodeURIComponent(id), { status: next }); ui.toast(COPY.before.forms.toggled(next)); await reload(['forms']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  cmeExport: async (el) => {
    if (!D.cme) { ui.toast(COPY.before.cme.offStatus.toUpperCase()); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      const res = await fetch('/api/admin/cme/events/' + encodeURIComponent(D.cme.conference_id) + '/export.csv', { headers: { Authorization: 'Bearer ' + session.token } });
      if (!res.ok) throw new Error(COPY.before.cme.exportFail);
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'plexus-cme-hlk.csv'; a.click(); URL.revokeObjectURL(a.href);
      ui.toast(COPY.before.cme.exported);
    } catch (e) { ui.toast(e.message || COPY.before.cme.exportFail, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  // ---- speakers panel
  spSave: async (el) => {
    const d = readSpDraft();
    if (!d.name) { ui.toast(COPY.sp.nameFirst); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      let id = st.spEdit;
      if (id) {
        await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(id), { name: d.name, title: d.title, institution: d.institution, email: d.email, talk_title: d.talk_title, is_keynote: d.is_keynote });
      } else {
        const r = await api.post('/api/admin/plexus/speakers', { name: d.name, title: d.title, institution: d.institution, email: d.email, talk_title: d.talk_title, is_keynote: d.is_keynote, year: FACTS.year });
        id = r && (r.speaker_id || r.id);
      }
      if (id && (d.logo || d.event_tag || (D.meta[id] && (D.meta[id].institution_logo_url || D.meta[id].event_tag)))) {
        await api.put('/api/v2/plexus-hub/speakers/' + encodeURIComponent(id) + '/meta', { institution_logo_url: d.logo || null, event_tag: d.event_tag || null });
      }
      ui.toast(st.spEdit ? COPY.sp.saved : COPY.sp.added);
      st.spEdit = null; st.spDraft = blankSp();
      await reload(['speakers', 'meta']);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  spCancel: () => { st.spEdit = null; st.spDraft = blankSp(); paint(); },
  spEditBtn: (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const meta = D.meta[sp.id] || {};
    st.spEdit = sp.id;
    st.spDraft = { name: sp.name || '', title: sp.title || '', institution: sp.institution || '', email: sp.email || '', talk_title: sp.talk_title || '', is_keynote: !!Number(sp.is_keynote), logo: meta.institution_logo_url || '', event_tag: meta.event_tag || '' };
    paint();
    const i = rootEl.querySelector('[data-role="spName"]'); if (i) { i.focus(); i.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  },
  spDel: async (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const ok = await ui.confirm({ title: COPY.sp.delAsk(sp.name), ok: COPY.sp.delOk, cancel: COPY.sp.delKeep });
    if (!ok) return;
    try { await api.del('/api/admin/plexus/speakers/' + encodeURIComponent(sp.id)); ui.toast(COPY.sp.deleted); if (st.spEdit === sp.id) { st.spEdit = null; st.spDraft = blankSp(); } await reload(['speakers', 'meta']); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  spConfirm: async (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const next = String(sp.confirmation_status || '') === 'confirmed' ? 'pending' : 'confirmed';
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(sp.id), { confirmation_status: next }); ui.toast(next === 'confirmed' ? COPY.sp.confirmedOn : COPY.sp.confirmedOff); await reload(['speakers']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  spLive: async (el) => {
    const sp = D.speakers.find(s => s.id === el.dataset.id); if (!sp) return;
    const next = !(Number(sp.is_confirmed) && Number(sp.is_published));
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(sp.id) + '/publish', { is_published: next }); ui.toast(next ? COPY.sp.liveOn(sp.name) : COPY.sp.liveOff); await reload(['speakers']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  spUpload: () => { const f = rootEl.querySelector('[data-role="spPhotoFile"]'); if (f) f.click(); },
  // ---- schedule panel
  ssSave: async (el) => {
    const d = readSsDraft();
    if (!d.title) { ui.toast(COPY.ss.titleFirst); return; }
    el.setAttribute('aria-disabled', 'true');
    try {
      if (st.ssEdit) await api.put('/api/admin/plexus/sessions/' + encodeURIComponent(st.ssEdit), d);
      else await api.post('/api/admin/plexus/sessions', d);
      ui.toast(st.ssEdit ? COPY.ss.saved : COPY.ss.added);
      st.ssEdit = null; st.ssDraft = blankSs();
      await reload(['sessions']);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  ssCancel: () => { st.ssEdit = null; st.ssDraft = blankSs(); paint(); },
  ssEditBtn: (el) => {
    const s = D.sessions.find(x => x.id === el.dataset.id); if (!s) return;
    st.ssEdit = s.id;
    st.ssDraft = { title: s.title || '', day: Number(s.day) || 1, start_time: s.start_time || '', end_time: s.end_time || '', room: s.room || '', session_type: s.session_type || 'talk', is_published: !!Number(s.is_published) };
    paint();
    const i = rootEl.querySelector('[data-role="ssTitle"]'); if (i) { i.focus(); i.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  },
  ssDel: async (el) => {
    const s = D.sessions.find(x => x.id === el.dataset.id); if (!s) return;
    const ok = await ui.confirm({ title: COPY.ss.delAsk(s.title), ok: COPY.ss.delOk, cancel: COPY.ss.delKeep });
    if (!ok) return;
    try { await api.del('/api/admin/plexus/sessions/' + encodeURIComponent(s.id)); ui.toast(COPY.ss.deleted); if (st.ssEdit === s.id) { st.ssEdit = null; st.ssDraft = blankSs(); } await reload(['sessions']); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  ssPubOne: async (el) => {
    const s = D.sessions.find(x => x.id === el.dataset.id); if (!s) return;
    const next = !Number(s.is_published);
    el.setAttribute('aria-disabled', 'true');
    try { await api.put('/api/admin/plexus/sessions/' + encodeURIComponent(s.id) + '/publish', { is_published: next }); ui.toast(next ? COPY.ss.published : COPY.ss.unpublished); await reload(['sessions']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  ssPubAll: async () => {
    const drafts = D.sessions.filter(s => !Number(s.is_published));
    if (!drafts.length) { ui.toast(COPY.ss.pubAllNone); return; }
    const ok = await ui.confirm({ title: COPY.ss.pubAllAsk(drafts.length), ok: COPY.ss.pubAllOk, cancel: COPY.ss.delKeep });
    if (!ok) return;
    try { const r = await api.post('/api/admin/plexus/sessions/bulk-publish', { session_ids: drafts.map(s => s.id) }); ui.toast(COPY.ss.pubAllDone((r && r.published) || drafts.length)); await reload(['sessions']); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- Q&A panel
  qaAnswer: (el) => {
    const qrow = D.qa.find(x => x.id === el.dataset.id); if (!qrow) return;
    const c = COPY.qa.modal;
    const m = ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `<div style="font-size:12.5px;color:#4a4239;margin-bottom:10px">“${esc(qrow.text)}”</div><textarea data-role="qaText" rows="3" style="width:100%;box-sizing:border-box;background:#f6f2ea;border:1px solid rgba(32,27,22,.25);padding:10px 12px;font:400 13px Inter,sans-serif;color:#201b16;resize:vertical"></textarea>`,
      actions: [
        { label: c.cancel },
        { label: c.send, kind: 'primary', onClick: () => {
          const t = m.el.querySelector('[data-role="qaText"]').value.trim();
          if (!t) { ui.toast(c.empty); return false; }
          api.post('/api/admin/plexus/qa/' + encodeURIComponent(qrow.id) + '/answer', { answer_text: t })
            .then(() => { ui.toast(COPY.qa.answeredToast); reload(['qa']); })
            .catch(e => ui.toast(e.message, { kind: 'error' }));
        } }
      ]
    });
    const ta = m.el.querySelector('[data-role="qaText"]'); if (ta) ta.focus();
  },
  qaHide: async (el) => {
    const hidden = el.dataset.hidden === '1';
    el.setAttribute('aria-disabled', 'true');
    try { await api.post('/api/admin/plexus/qa/' + encodeURIComponent(el.dataset.id) + '/hide', { hidden: !hidden }); ui.toast(hidden ? COPY.qa.shown : COPY.qa.hidden); await reload(['qa']); }
    catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- after the week
  start2027: () => {
    if (!weekOver()) { ui.toast(COPY.after.notYet(afterLabel())); return; }
    ui.toast(COPY.after.notYet(afterLabel())); // carry-over ships with the editions tool — same message until then
  },
  archiveNote: () => ui.toast(COPY.after.notYet(afterLabel())),
  peOpen: async () => {
    const c = COPY.after.peModal;
    let facts = null;
    try { facts = await api.get('/api/admin/post-event/assemble/facts?event_key=plexus'); } catch (e) {}
    const pe = D.pe || {};
    const line = (k, v) => v == null || v === '' ? '' : `<div style="display:flex;gap:10px;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(32,27,22,.07);font-size:12.5px"><span style="color:#6d6459">${esc(k)}</span><b>${esc(String(v))}</b></div>`;
    ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `
        ${line('Certificates issued', pe.certificates_issued != null ? pe.certificates_issued : (pe.certs && pe.certs.issued))}
        ${line('Checked in', pe.checked_in != null ? pe.checked_in : (facts && facts.checked_in))}
        ${line('Speakers on file', facts && facts.speakers_count)}
        ${line('Published sessions', facts && facts.sessions_count)}
        ${line('Event ends', fmt.longRange(D.conf.end_date || FACTS.plexus.end))}
        <div style="font-size:12px;color:#6d6459;margin-top:12px;line-height:1.6">${esc(COPY.after.line(afterLabel()))} Every certificate and thank-you stages to the Outbox — nothing emails a member without your OK there.</div>`,
      actions: [{ label: c.close, kind: 'primary' }]
    });
  },
  editionsOpen: () => {
    const c = COPY.edModal;
    const rows = D.editions.editions || [];
    ui.modal({
      eyebrow: c.eyebrow, title: c.title,
      body: `${rows.map(e => `<div style="display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.07)"><span class="tag${e.status === 'active' ? ' tag-live' : ''}">${esc(String(e.status || '').toUpperCase())}</span><b style="font-size:13px">${esc(e.label || '')}</b><span style="font-size:12px;color:#6d6459">${esc(e.year != null ? String(e.year) : '')}${e.start_date ? ' · ' + esc(fmt.rangeLabel(e.start_date, e.end_date)) : ''}</span></div>`).join('') || `<div style="font-size:12.5px;color:#6d6459">No editions on file yet.</div>`}
      <div style="font-size:12px;color:#6d6459;margin-top:12px;line-height:1.6">${c.note}</div>`,
      actions: [{ label: c.close, kind: 'primary' }]
    });
  },
  // ---- what members see
  msSave: async (el) => {
    const body = { status_label: val('msLabel'), detail_line: val('msDetail') };
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/admin/project-status/plexus', body);
      st.msSaved = true;
      await reload(['pstatus']);
    } catch (e) { ui.toast(COPY.members.failed, { kind: 'error' }); }
    el.removeAttribute('aria-disabled');
  },
  // ---- stats widget
  ovEdit: (el) => { st.ovEdit = el.dataset.key; paint(); const i = rootEl.querySelector('[data-role="ovInput"]'); if (i) { i.focus(); i.select(); } },
  ovSave: async (el) => {
    const key = el.dataset.key;
    const v = val('ovInput');
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.put('/api/v2/plexus-hub/stats-overrides/' + STATS_SCOPE, { figure_key: key, value: v });
      D.overrides = (r && r.overrides) || {};
      st.ovEdit = null;
      ui.toast(v ? COPY.widget.overridden : COPY.widget.cleared);
      paint();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  ovClear: async (el) => {
    try {
      const r = await api.put('/api/v2/plexus-hub/stats-overrides/' + STATS_SCOPE, { figure_key: el.dataset.key, value: null });
      D.overrides = (r && r.overrides) || {};
      ui.toast(COPY.widget.cleared);
      paint();
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  copyStats: async () => { ui.toast((await copyText(statsLine())) ? COPY.widget.copied : COPY.widget.copyFail); }
};

// photo upload (delegated change event — survives repaints)
async function onChange(e) {
  const input = e.target.closest && e.target.closest('[data-role="spPhotoFile"]');
  if (!input || !input.files || !input.files[0] || !st.spEdit) return;
  st.spDraft = readSpDraft(); // keep unsaved edit-form fields across the repaint below
  const fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    const up = await api.post('/api/upload/speakers', fd);
    if (!up || !up.file_url) throw new Error('Upload failed');
    await api.put('/api/admin/plexus/speakers/' + encodeURIComponent(st.spEdit), { photo_url: up.file_url });
    ui.toast(COPY.sp.photoUp);
    await reload(['speakers']);
  } catch (err) { ui.toast(err.message, { kind: 'error' }); }
}
// typing into the member card resets the ✓ SAVED state (artboard behaviour) without a repaint
function onInput(e) {
  const t = e.target;
  if (!t || !t.matches || !(t.matches('[data-role="msLabel"]') || t.matches('[data-role="msDetail"]'))) return;
  if (!st.msSaved) return;
  st.msSaved = false;
  const b = rootEl.querySelector('[data-role="msSaveBtn"]');
  if (b) { b.style.background = '#9b1b22'; b.textContent = COPY.members.save; }
}

export default {
  title: 'Plexus Week 2026',
  async render(root, ctx) {
    rootEl = root;
    injectCss();
    const tab = ctx.params && ctx.params.tab;
    st = {
      openPanel: ['speakers', 'schedule', 'qa'].includes(tab) ? tab : null,
      spEdit: null, spDraft: blankSp(), ssEdit: null, ssDraft: blankSs(),
      msSaved: false, ovEdit: null
    };
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    onChangeBound = onChange; root.addEventListener('change', onChangeBound);
    onInputBound = onInput; root.addEventListener('input', onInputBound);
  },
  destroy() {
    if (unbind) unbind(); unbind = null;
    if (rootEl && onChangeBound) rootEl.removeEventListener('change', onChangeBound);
    if (rootEl && onInputBound) rootEl.removeEventListener('input', onInputBound);
    onChangeBound = null; onInputBound = null; rootEl = null; D = null; st = null;
  }
};
