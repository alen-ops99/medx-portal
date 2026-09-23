// Source: Admin Home.dc.html (Today)
// Blocks (artboard order): "Greeting row" (greeting · todayLabel · ✎ CUSTOMISE · status pill) ›
// "Customise panel" › "Hero numbers" (open stat row + "REGISTRATIONS — LAST 30 DAYS" sparkline) ›
// "YOUR PROJECTS" › "NEEDS YOUR ATTENTION" + "DO IT NOW" › "COMING UP" + "TASKS" (the board's compact read, 2026-09-20) ›
// "THE WEEKLY READ" › "ADMIN:" footer row. The header is NOT in this file — js/chrome.js.
// Data: every number/label is a live read (see load()); FACTS only fills gaps and wording.
import cfg from '../config.js';
import { api } from '../api.js';
import { session, state } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow, routeForSection } from '../facts.js';
import { buildTrend, dayTick, dayFull, normDays, RANGES, DEFAULT_DAYS } from '../trends.js';
import { perms } from '../perms.js';
import { chrome } from '../chrome.js';
import { health } from '../health.js';
import router from '../router.js';

export const SOURCE = 'Admin Home.dc.html';

// ---- COPY: every string that may change in a revision lives here (dates/prices via FACTS) ----
export const COPY = {
  greetings: ['Good morning', 'Good afternoon', 'Good evening'],   // time of day; the Croatian text toggle was removed by decision
  customise: { btn: '✎ CUSTOMISE', title: 'Choose which numbers and shortcuts show on your Today page — each admin keeps their own setup', numbers: 'YOUR NUMBERS', shortcuts: 'YOUR SHORTCUTS', note: 'Saved to your admin account — Laura and Miro keep their own Today.', saved: 'TODAY LAYOUT SAVED', failed: 'Could not save the layout — it stays for this visit.' },
  pill: { title: s => s === 'ok' ? 'Opens the health checks — everything answered' : s === 'fail' ? 'Opens the health checks — something is failing' : 'Opens the health checks — a few items want a look before the events' },
  kpi: {
    kDays: { k: 'DAYS TO PLEXUS', label: 'Days to Plexus' },
    kConf: { k: 'CONFERENCE REGISTERED', label: 'Conference registered', sub: cap => `free entry · cap ${cap}` },
    // UXFIX closing (2026-09-02, audit #1): the card counted registration ROWS and called them
    // seats. It now reads the canonical /api/v2/gala-ops/summary (seats incl. plus-ones); on an
    // older backend it falls back to the local row walk and says BOOKINGS, which is what rows are.
    // Audit W11: every gala figure names its unit. SEATS include plus-ones; a "registration" is one
    // booking row, which is a different number, and People counts distinct guests — three units,
    // never interchangeable.
    kGala: {
      k: 'GALA SEATS PAID (INCL. GUESTS)', kFallback: 'GALA BOOKINGS PAID', label: 'Gala seats paid',
      // Audit 2026-09-17 A: "unpaid" hid four states and counted abandoned twins of paid guests.
      // seats.chase = seats still expected to pay; eur.outstanding = link sent + checkout not
      // completed × price; the split (server bucket words) rides the card's title.
      chase: (n, eur, tail) => `${n} seat${n === 1 ? '' : 's'} payment open · ${eur} outstanding · ${tail}`,
      chaseSplit: b => b ? ['link_sent', 'checkout_abandoned', 'no_link_yet', 'held', 'paid_twins'].filter(k => b[k] && Number(b[k].seats)).map(k => `${b[k].seats} ${String(b[k].tag || k).toLowerCase()}`).join(' · ') : '',
      chaseBookings: (n, tail) => `${n} payment${n === 1 ? '' : 's'} still open · ${tail}`,
      clear: tail => `all seats paid · ${tail}`,
      ebEnds: eb => `early bird ends ${eb}`, after: 'regular price now'
    },
    // Audit W9: this total is gala money PLUS paid conference registrations, so the sub-line names
    // both halves — Money's own "collected" has no conference source, and the gap used to look like
    // one of the two screens being wrong.
    kMoney: {
      k: 'COLLECTED THIS YEAR', label: 'Collected this year',
      sub: n => `${n} paid Gala registration${n === 1 ? '' : 's'} · all of Money →`,
      subWithConf: (n, confEur) => `${n} paid Gala registration${n === 1 ? '' : 's'} + ${confEur} conference · all of Money →`
    },
    kTrend: { label: 'Registrations chart' },
    locked: 'locked for you · ask Alen'
  },
  // The registrations chart. The owner reads it to answer one question — "who signed up for what,
  // and when" — so every event is its own series behind its own chip, and the headline stays the
  // total for whatever window is on screen.
  trends: {
    title: d => `REGISTRATIONS — LAST ${d} DAYS`,
    regs: n => `${n} registration${n === 1 ? '' : 's'}`,
    daily: 'DAILY', cumulative: 'RUNNING TOTAL',
    modeTitle: 'Daily counts, or the running total across the window',
    rangeTitle: d => `Last ${d} days`,
    chipTitle: (label, on) => `${on ? 'Hide' : 'Show'} ${label.toLowerCase()} — your choice is remembered on this computer`,
    empty: 'Nothing registered in this window.',
    none: 'Every series is hidden — click a chip to bring one back.',
    stale: 'Per-event breakdown needs the newer admin backend — showing the combined series meanwhile.',
    today: 'TODAY'
  },
  projects: {
    title: 'YOUR PROJECTS', sub: 'each one is a hub — everything for that project lives inside',
    plexus: { live: 'LIVE', closed: 'REGISTRATION CLOSED', title: FACTS.plexus.week, line: (r, cap, galaBit) => `${r} registered of ${cap} · ${galaBit}`, parts: FACTS.plexus.parts },
    accelerator: { title: FACTS.accelerator.short, opens: `OPENS ${FACTS.accelerator.opensShort.toUpperCase()}`, apps: n => n === 0 ? '0 applications yet' : `${n} application${n === 1 ? '' : 's'}`, hosts: n => `${n} host institution${n === 1 ? '' : 's'} ready` },
    forum: { title: FACTS.forum.name, eyebrow: 'BY INVITATION', line: (m, c) => `${m} member${m === 1 ? '' : 's'} · ${c} candidate${c === 1 ? '' : 's'}`, gathering: `gathering ${FACTS.forum.gathering.label}` },
    bridges: { title: FACTS.bridges.name, next: (city, when) => `NEXT · ${city.toUpperCase()} · ${when}`, none: 'NO DATE SET', dateTbc: 'DATE TBC', dateLine: 'date to be confirmed', line: (past, n, city) => `${past} past edition${past === 1 ? '' : 's'} · ${n} ${city} sign-up${n === 1 ? '' : 's'}`, venueSoon: 'venue announced soon' },
    more: { eyebrow: 'EVERYTHING ELSE', title: 'More tools', line: 'Website &amp; portal text, team access, health, audit, team library…' }
  },
  attention: {
    title: 'NEEDS YOUR ATTENTION', sub: 'everything urgent, in one list', empty: 'Nothing urgent. Enjoy the quiet.',
    foot: 'Snoozed rows return tomorrow — a row only disappears for good when the thing itself is resolved.',
    snooze: 'SNOOZE 1D', snoozeTitle: 'Hides for you until tomorrow — the row returns until the thing itself is resolved', snoozed: 'SNOOZED FOR 1 DAY', showAll: n => `SHOW ALL ${n} →`, showLess: 'SHOW FEWER',
    outbox: { title: (e, b) => `${e} email${e === 1 ? '' : 's'} in ${b} batch${b === 1 ? '' : 'es'} ${e === 1 ? 'is' : 'are'} waiting for your OK`, sub: s => `${s} — nothing sends without you`, cta: 'REVIEW & SEND' },
    // UXFIX-A1 #4 (2026-09-02): counts threads that NEED A REPLY (same rule as the Inbox tab), not just unread
    messages: { title: n => `${n} member message${n === 1 ? ' is' : 's are'} waiting for a reply`, sub: (who, d) => who ? `${who} has waited ${d} day${d === 1 ? '' : 's'} — your reply lands in their portal inbox` : 'Your reply lands in their portal inbox', cta: 'REPLY' },
    // UXFIX-A1 #5 (2026-09-02): the six "IN OUTBOX →" echo rows collapse into this ONE row
    drafts: { title: n => `${n} draft${n === 1 ? '' : 's'} waiting in the Outbox`, sub: 'Reminders and digests you already actioned — approve or discard them there, nothing sends without you', cta: 'REVIEW →' },
    plan: 'PLAN THE MONTH WITH AI →',   // UXFIX-A1 #5: the AI-planner promo, demoted to the quiet footer
    tasks: { title: n => `${n} overdue task${n === 1 ? '' : 's'}`, sub: d => `Oldest is ${d} day${d === 1 ? '' : 's'} — on the board`, cta: 'OPEN THE BOARD' },
    nag: {
      galaSub: (date, days) => `Reserved ${date} · ${days} day${days === 1 ? '' : 's'} waiting · reminder queues to the Outbox for your OK`,
      // (the per-row "IN OUTBOX →" echo state is gone — actioned nags collapse into the drafts row, UXFIX-A1 #5)
      subs: { monthly_digest: 'Review the digest, then approve it in the Outbox', forum_consideration: who => `${who} asked to be considered — review in the Forum hub`, forum_candidate_escalated: who => `${who} needs a decision — Forum hub`, task_overdue: 'On the board', task_due_soon: 'Due soon — on the board' },
      ctas: { payment_reminder: 'CHASE PAYMENT', dietary_reminder: 'SEND REMINDER', nudge_assignee: 'NUDGE', digest_review: 'REVIEW DIGEST', open_link: 'OPEN', default: 'OPEN' },
      queued: 'REMINDER QUEUED — APPROVE IT IN THE OUTBOX', nudged: 'NUDGE QUEUED'
    }
  },
  doItNow: { title: 'DO IT NOW', hint: 'edit via ✎ CUSTOMISE', empty: 'No shortcuts picked — add some via ✎ CUSTOMISE.' },
  // Big Ideas — the long game. The card appears only when a next step is due or already late;
  // with nothing owing it stays away entirely (the section is one click up in the top nav).
  bigIdeas: {
    title: 'BIG IDEAS — NEXT STEPS', hint: 'the long game', all: n => `ALL ${n} →`, open: '/big-ideas',
    overdue: d => `${d}D OVERDUE`, today: 'DUE TODAY', due: d => `DUE ${d}`,
    locked: 'Big Ideas needs access — ask Alen.'
  },
  shortcuts: {
    sScan: { label: 'REHEARSE THE SCANNER', href: '/event-day', gold: true, pick: 'Rehearse the scanner' },
    sEmail: { label: 'EMAIL PLEXUS REGISTRANTS', href: '/inbox/email', pick: 'Email Plexus registrants' },
    sNews: { label: 'POST NEWS TO MEMBERS', href: '/inbox/announcements', pick: 'Post news to members' },
    sFind: { label: 'FIND A PERSON', href: '/people', pick: 'Find a person' }
  },
  comingUp: { title: 'COMING UP', full: 'FULL CALENDAR →', empty: 'Nothing on the year board yet — add dates in Calendar.', earlyBird: (price, days) => `Gala early-bird ends — price moves to ${price} · ${days} day${days === 1 ? '' : 's'} away` },
  // TASKS (2026-09-20): the tick-list became the shared board (/tasks). This card is the compact
  // read — what is waiting for ME to see (done, unseen — red) and my own open tasks, each a door.
  tasks: { title: 'TASKS', waiting: n => `${n} waiting for you to see`, waitingWhy: 'finished — the result is on the card', mine: 'YOURS', empty: 'Nothing on your plate.', emptyWhy: 'Add the next thing on the board — the person you pick gets one short email.', all: 'OPEN THE BOARD →', more: n => `+ ${n} more`, overdue: d => `${d}D OVERDUE`, today: 'DUE TODAY', due: d => `DUE ${d}`, doing: 'IN PROGRESS' },
  // NOTES (2026-09-22): the shared event & day notes (/notes). A small tile — today's count, the
  // last note's first line, ADD A NOTE (the composer focused). On an event day it names the event.
  notes: { title: 'NOTES', add: 'ADD A NOTE →', forEvent: (ev, n) => `Notes for ${ev} — ${n} so far`, today: n => n === 0 ? 'No notes today yet.' : `${n} note${n === 1 ? '' : 's'} today`, why: 'Who you met, what was agreed — written in a tap, found later.', last: who => who ? `${who} wrote last:` : 'Last note:' },
  weekly: {
    title: 'THE WEEKLY READ', read: 'READ THIS WEEK →', hide: 'HIDE', open: 'OPEN →', all: n => `ALL ${n} LINES →`, fewer: 'TOP LINE PER ADVISOR',
    seats: { CMO: { tag: 'GROW', color: '#9b1b22' }, CFO: { tag: 'MONEY', color: '#b7791f' }, COO: { tag: 'OPS', color: '#2f7d4f' }, CLO: { tag: 'LEGAL', color: '#6d6459' } },
    order: ['CFO', 'CMO', 'COO', 'CLO'],
    foot: week => `Compiled every week by four AI advisors — Growth, Money, Ops, Legal — from your live numbers. Advice only; they never change anything.${week ? ' · ' + week : ''}`,
    sample: 'SAMPLE LINES — the advisors have not run on real data yet',
    gate: 'No read yet — the four advisors compile it every Friday once ANTHROPIC_API_KEY is set on the admin service.', gateCta: 'HEALTH CHECKS →',
    locked: 'The Weekly Read needs Executive Suite access — ask Alen.'
  },
  // UXFIX-A1 #15 (2026-09-02): the footer's SYSTEM HEALTH link duplicated the header pill — removed, header pill kept
  footer: { admin: 'ADMIN:', audit: 'AUDIT LOG', member: 'VIEW MEMBER PORTAL ↗' },
  // Event day (2026-09-21): a bridges_events row dated today puts the door scanner above everything.
  tonight: { line: city => `${FACTS.bridges.name} ${city} is tonight —`, cta: 'OPEN THE DOOR SCANNER →' }
};
const KPI_KEYS = ['kDays', 'kConf', 'kGala', 'kMoney'];
const TREND_KEY = 'kTrend';                          // the chart is its own Customise tick, not a KPI card
const SC_KEYS = ['sScan', 'sEmail', 'sNews', 'sFind'];
const PREF_KEYS = KPI_KEYS.concat([TREND_KEY], SC_KEYS);
const PREFS_SECTION = 'today-v2';
const NAG_DOT = { gala_unpaid: '#9b1b22', task_overdue: '#9b1b22', payment_reminder: '#9b1b22' };
const TOP_ROWS = 6;

// ---- view state ----
let D = null, st = null, timers = [], unbind = null, rootEl = null;

function snoozeKey() { return 'medx_admin_snooze:' + ((session.user || {}).id || 'anon'); }
function readSnoozes() { try { const m = JSON.parse(localStorage.getItem(snoozeKey()) || '{}'); const now = Date.now(); Object.keys(m).forEach(k => { if (new Date(m[k]).getTime() <= now) delete m[k]; }); return m; } catch (e) { return {}; } }
function writeSnoozes(m) { try { localStorage.setItem(snoozeKey(), JSON.stringify(m)); } catch (e) {} }
function nextMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.toISOString(); }
const isLocked = key => !!(D && D.errors[key] && D.errors[key].isLocked);

// ---------------------------------------------------------------- data
async function load(days) {
  const r = await api.settle({
    me: api.get('/api/auth/me'),
    conf: api.get('/api/conferences/active', { noAuth: true }),
    summary: api.get('/api/dashboard/summary'),
    trends: api.get('/api/dashboard/trends?days=' + normDays(days)),
    pstats: api.get('/api/dashboard/portal-stats'),
    gala: api.get('/api/admin/gala/registrations'),
    galaSettings: api.get('/api/admin/gala/settings'),
    galaOps: api.get('/api/v2/gala-ops/summary'),   // UXFIX closing: ONE truth for the gala tallies (seats incl. plus-ones)
    finance: api.get('/api/finance/dashboard'),
    nag: api.get('/api/admin/nag/items'),
    tasks: api.get('/api/v2/tasks'),                  // the board: every live card + who I am on it
    tasksBadge: api.get('/api/v2/tasks/badge'),      // done-unseen for me · my open count
    notes: api.get('/api/v2/notes/summary?today=' + fmt.ymd(new Date())),   // the NOTES tile: today's count, the last line, the event of the day
    outbox: api.get('/api/admin/outbox?status=pending_approval'),
    threads: api.get('/api/v2/inbox/threads'),   // UXFIX-A1 #4: member threads needing a reply
    advisors: api.get('/api/admin/advisors/latest'),
    prefs: api.get('/api/dashboard-preferences/' + PREFS_SECTION),
    calendar: api.get('/api/admin/year-calendar'),
    status: api.get('/api/public/status', { noAuth: true }),
    bridges: api.get('/api/bridges/events'),
    bridgesHub: api.get('/api/v2/bridges/hub'),     // the Zagreb head count (diaspora form rows included) + the published editions
    forumCand: api.get('/api/admin/forum/candidates?status=all'),
    institutions: api.get('/api/accelerator/institutions', { noAuth: true }),
    bigIdeas: api.get('/api/v2/big-ideas/due?days=14')   // Big Ideas — next steps due or overdue
  });
  if (r.me) session.update(r.me);
  const today = fmt.ymd(new Date());
  const conf = r.conf || {};
  const galaRows = Array.isArray(r.gala) ? r.gala : [];
  const paid = galaRows.filter(g => g.payment_status === 'paid');
  const toChase = galaRows.filter(g => g.payment_status !== 'paid' && !['rejected', 'cancelled'].includes(String(g.status || '')));
  const gs = r.galaSettings || {};
  const price = galaPriceNow(gs);
  const ebDeadline = (gs.early_bird_deadline || FACTS.gala.priceFlip).slice(0, 10);
  const prefs = {}; PREF_KEYS.forEach(k => { prefs[k] = true; });
  (Array.isArray(r.prefs) ? r.prefs : []).forEach(row => { if (row && row.card_id in prefs) prefs[row.card_id] = !!Number(row.is_visible); });
  const status = {}; (((r.status || {}).projects) || []).forEach(p => { status[p.project_key] = p; });
  // Building Bridges evenings only: Donor Night borrows a bridges_events row (slug 'donor-night') for its
  // guest list, and cancelled / "[superseded]" rows are history — none of them is a Bridges city. Donor
  // Night used to surface here as "NEXT · ZAGREB · DEC 4 · 0 sign-ups" (and as "Building Bridges Zagreb is
  // tonight" on 4 Dec).
  const hub = r.bridgesHub && Array.isArray(r.bridgesHub.events) ? r.bridgesHub : null;
  const hubCount = id => { const e = hub && hub.events.find(x => String(x.id) === String(id)); return e ? Number(e.registration_count || 0) : null; };
  const bridges = (Array.isArray(r.bridges) ? r.bridges : [])
    .filter(b => b.slug !== 'donor-night' && String(b.status || '') !== 'cancelled' && !/^\[superseded\]/i.test(String(b.name || '')))
    .map(b => { const n = hubCount(b.id); return n == null ? b : Object.assign({}, b, { registration_count: n }); });
  const dated = bridges.filter(b => b.event_date && /^\d{4}-\d{2}-\d{2}/.test(b.event_date)).map(b => Object.assign({}, b, { d: String(b.event_date).slice(0, 10) }));
  // next = the next dated evening; else the undated home edition (Zagreb, during Plexus Week)
  const nextBridges = dated.filter(b => b.d >= today).sort((a, b) => a.d.localeCompare(b.d))[0]
    || bridges.find(b => b.slug === 'building-bridges' && !(b.event_date && /^\d{4}-\d{2}-\d{2}/.test(b.event_date))) || null;
  // past editions = the published recaps + any dated evening already held whose city has no recap yet
  const edCities = new Set(((hub && hub.editions) || []).filter(e => e.is_published).map(e => String(e.city || '').toLowerCase().replace(/ü/g, 'u')));
  const pastCount = hub ? edCities.size + dated.filter(b => b.d < today && !edCities.has(String(b.city || '').toLowerCase().replace(/ü/g, 'u'))).length
    : dated.filter(b => b.d < today).length;
  // the board's cards: open = todo/doing (the overdue attention row counts everyone's); mine = assigned to me
  const boardRows = r.tasks && Array.isArray(r.tasks.tasks) ? r.tasks.tasks : [];
  const myMember = r.tasks && r.tasks.me ? r.tasks.me.member_id : null;
  const tasks = boardRows.filter(t => t.status === 'todo' || t.status === 'doing');
  const myTasks = myMember ? tasks.filter(t => t.assigned_to === myMember) : [];
  const tasksBadge = { done_unseen: r.tasksBadge ? Number(r.tasksBadge.done_unseen || 0) : 0, assigned_open: r.tasksBadge ? Number(r.tasksBadge.assigned_open || 0) : myTasks.length };
  // Canonical gala numbers (audit #1): /api/v2/gala-ops/summary counts SEATS (1 + guest_count,
  // plus-ones included) over non-cancelled rows — the same block the Gala and Money screens read.
  // The local row walk below survives only as the degraded path for an older backend.
  const ops = r.galaOps && r.galaOps.seats && r.galaOps.eur ? r.galaOps : null;
  return {
    errors: r.$errors, me: session.user || r.me || {}, conf, summary: r.summary, trends: r.trends, pstats: r.pstats, finance: r.finance, galaSettings: gs,
    gala: { rows: galaRows, paid, toChase, price, ebDeadline, ebDays: fmt.daysUntil(ebDeadline), collected: paid.reduce((n, g) => n + (Number(g.amount_paid) || 0), 0), owed: toChase.length * price, ops },
    nag: (r.nag && Array.isArray(r.nag.items)) ? r.nag.items : [],
    tasks, myTasks, tasksBadge,
    notes: r.notes && typeof r.notes === 'object' ? r.notes : null,   // null → an older backend; the tile still offers the door
    outbox: (r.outbox && Array.isArray(r.outbox.batches)) ? r.outbox.batches : [],
    // UXFIX-A1 #4: threads needing a reply — the Inbox tab's exact rule; null = endpoint unavailable (fall back to unread)
    msgNeedsReply: (r.threads && Array.isArray(r.threads.threads))
      ? r.threads.threads.filter(t => !t.archived && (Number(t.unread) > 0 || !(t.last && t.last.mine)))
      : null,
    advisors: r.advisors, prefs, status, bridges: { all: bridges, dated, next: nextBridges, past: pastCount },
    calendar: Array.isArray(r.calendar) ? r.calendar : [],
    forumCandidates: r.forumCand && r.forumCand.counts ? Number(r.forumCand.counts.all || 0) : 0,
    institutions: Array.isArray(r.institutions) ? r.institutions.filter(i => Number(i.is_active == null ? 1 : i.is_active)).length : null,
    plexusDays: Math.max(0, fmt.daysUntil(conf.start_date || FACTS.plexus.start) || 0),
    cap: Number(conf.max_capacity) || FACTS.plexus.cap,
    // Big Ideas: the next steps already due or falling inside a fortnight, overdue first. An older
    // backend answers 404 — the card then simply has nothing to show and stays away.
    bigIdeas: (r.bigIdeas && Array.isArray(r.bigIdeas.items)) ? r.bigIdeas.items : []
  };
}

// ---------------------------------------------------------------- derived lists
function kpiDefs() {
  const c = COPY.kpi, p = D.prefs, g = D.gala, conf = D.conf;
  const ops = g.ops;
  const regs = D.summary ? Number(D.summary.plexus.registrations || 0) : (D.pstats ? Number(D.pstats.plexus.registrations || 0) : null);
  const galaLocked = isLocked('gala');
  const tail = g.ebDays > 0 ? c.kGala.ebEnds(fmt.dayShort(g.ebDeadline)) : c.kGala.after;
  const chasing = ops ? ops.seats.chase : g.toChase.length;
  const galaSub = galaLocked ? c.locked
    : ops
      ? (ops.seats.chase ? c.kGala.chase(ops.seats.chase, fmt.eur(ops.eur.outstanding), tail) : c.kGala.clear(tail))
      : (g.toChase.length ? c.kGala.chaseBookings(g.toChase.length, tail) : c.kGala.clear(tail));
  const galaPaid = ops ? ops.seats.paid : g.paid.length;               // seats when canonical, bookings on the fallback
  const galaPayments = ops ? ops.bookings.paid : g.paid.length;        // payments = registration rows, both paths
  const galaCollected = ops ? ops.eur.collected : g.collected;
  const confRevenue = D.pstats && D.pstats.plexus ? Number(D.pstats.plexus.revenue || 0) : 0;
  const collected = isLocked('finance') && isLocked('gala') ? null : galaCollected + confRevenue;
  return [
    // Venue comes from the live conference row like the dates and the city beside it; FACTS is only
    // the fallback for a backend that has no conference yet (audit W7).
    { on: p.kDays, k: c.kDays.k, v: String(D.plexusDays), sub: `${fmt.longRange(conf.start_date || FACTS.plexus.start, conf.end_date || FACTS.plexus.end)} · ${conf.venue_name || FACTS.plexus.venue}, ${conf.venue_city || FACTS.plexus.city}`, subColor: '#6d6459', href: '/projects/plexus' },
    { on: p.kConf, k: c.kConf.k, v: regs == null ? '—' : String(regs), sub: c.kConf.sub(D.cap), subColor: '#6d6459', href: '/registrations' },
    { on: p.kGala, k: ops ? c.kGala.k : c.kGala.kFallback, v: galaLocked ? '—' : String(galaPaid), sub: galaSub, subColor: !galaLocked && chasing ? '#9b1b22' : '#6d6459', href: '/gala',
      title: !galaLocked && ops && ops.buckets ? c.kGala.chaseSplit(ops.buckets) : '' },   // the open-payment split behind the seat count
    { on: p.kMoney, k: c.kMoney.k, v: collected == null ? '—' : fmt.eur(collected), sub: collected == null ? c.locked : (confRevenue ? c.kMoney.subWithConf(galaPayments, fmt.eur(confRevenue)) : c.kMoney.sub(galaPayments)), subColor: '#6d6459', href: '/money' }
  ].filter(k => k.on);
}
function shortcutDefs() {
  return SC_KEYS.filter(k => D.prefs[k]).map(k => { const s = COPY.shortcuts[k]; return s.gold
    ? { label: s.label, href: s.href, gold: true, bg: '#201b16', bd: '#201b16', fg: '#f6f2ea' }
    : { label: s.label, href: s.href, gold: false, bg: 'transparent', bd: 'rgba(32,27,22,.2)', fg: '#201b16' }; });
}
// ---------------------------------------------------------------- registrations chart
// The chart's own settings live per admin on this computer — which series are on, the window and
// daily-vs-running-total. They are deliberately NOT part of the server-side Customise prefs: those
// decide whether the block exists at all, these are a reading position inside it.
function trendKey() { return 'medx_admin_trend:' + ((session.user || {}).id || 'anon'); }
function readTrendPrefs() {
  const d = { days: DEFAULT_DAYS, mode: 'daily', hidden: {} };
  try {
    const o = JSON.parse(localStorage.getItem(trendKey()) || '{}');
    return { days: normDays(o.days), mode: o.mode === 'cumulative' ? 'cumulative' : 'daily', hidden: (o.hidden && typeof o.hidden === 'object') ? o.hidden : {} };
  } catch (e) { return d; }
}
function writeTrendPrefs() { try { localStorage.setItem(trendKey(), JSON.stringify({ days: st.trDays, mode: st.trMode, hidden: st.trHidden })); } catch (e) {} }
function trendModel() { return buildTrend(D.trends, { days: st.trDays, mode: st.trMode, hidden: st.trHidden }); }

const CH_PAD = { l: 34, r: 10, t: 10, b: 22 };
const CH_PLOT_H = 130;
const CH_H = CH_PAD.t + CH_PLOT_H + CH_PAD.b;

// The whole plot as one SVG string, laid out in real pixels for the measured width — no
// preserveAspectRatio stretching, so the labels stay at their true size at every viewport.
function trendSvg(m, W) {
  const { l, r, t } = CH_PAD;
  const plotW = Math.max(60, W - l - r), n = m.dates.length, slot = plotW / n;
  const x = i => l + (i + 0.5) * slot;
  const y = v => t + CH_PLOT_H - (m.top ? (v / m.top) * CH_PLOT_H : 0);
  const base = y(0), right = l + plotW;
  const totalRow = m.series.find(s => s.total);
  const bars = m.mode === 'daily' && !totalRow.hidden;
  const bw = Math.max(1, Math.min(16, slot - (n > 45 ? 1 : 2.5)));

  const grid = m.ticks.map(v => `<line x1="${l}" y1="${y(v).toFixed(1)}" x2="${right}" y2="${y(v).toFixed(1)}" stroke="rgba(32,27,22,${v === 0 ? '.28' : '.07'})" stroke-width="1"></line>
      <text x="${l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-family="Inter,sans-serif" font-size="8.5" font-weight="600" fill="#6d6459">${v}</text>`).join('');

  const xlab = m.tickIdx.map(i => {
    const last = i === n - 1, first = i === 0;
    const px = last ? right : first ? l : x(i);
    return `<text x="${px.toFixed(1)}" y="${(t + CH_PLOT_H + 14).toFixed(1)}" text-anchor="${last ? 'end' : first ? 'start' : 'middle'}" font-family="Inter,sans-serif" font-size="8.5" font-weight="600" letter-spacing=".06em" fill="${last ? '#9b1b22' : '#6d6459'}">${last ? COPY.trends.today : esc(dayTick(m.dates[i]))}</text>`;
  }).join('');
  const todayMark = `<line x1="${x(n - 1).toFixed(1)}" y1="${t}" x2="${x(n - 1).toFixed(1)}" y2="${base.toFixed(1)}" stroke="#9b1b22" stroke-width="1" stroke-dasharray="2 3" opacity=".35"></line>`;

  const barRects = bars ? totalRow.plot.map((v, i) => v <= 0 ? '' :
    `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, base - y(v)).toFixed(1)}" fill="#9b1b22" opacity=".85"></rect>`).join('') : '';

  const lines = m.visible.filter(s => !s.total || !bars).map(s => {
    const pts = s.plot.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    const area = s.total ? `<path d="M${pts.split(' ').join(' L')} L${right.toFixed(1)},${base.toFixed(1)} L${l},${base.toFixed(1)} Z" fill="${s.color}" opacity=".08"></path>` : '';
    return area + `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.total ? 2 : 1.4}" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
  }).join('');

  return `<svg width="${W}" height="${CH_H}" viewBox="0 0 ${W} ${CH_H}" role="img" aria-label="${esc(COPY.trends.title(m.days))} — ${esc(m.scopeLabel)}" style="display:block;overflow:visible">
      ${grid}${todayMark}${barRects}${lines}${xlab}
      <line data-role="trGuide" x1="0" y1="${t}" x2="0" y2="${base.toFixed(1)}" stroke="#201b16" stroke-width="1" opacity="0" pointer-events="none"></line>
      <g data-role="trDots" pointer-events="none"></g>
      <rect data-role="trHit" x="${l}" y="${t}" width="${plotW.toFixed(1)}" height="${CH_PLOT_H}" fill="transparent" style="touch-action:pan-y;cursor:crosshair"></rect>
    </svg>`;
}
function overdueTasks() { const today = fmt.ymd(new Date()); return D.tasks.filter(t => t.due_date && String(t.due_date).trim() && fmt.ymd(t.due_date) < today); }
function attentionItems() {
  const a = COPY.attention, items = [];
  if (D.outbox.length) { const emails = D.outbox.reduce((n, b) => n + Number(b.count || 0), 0); const subjects = D.outbox.map(b => b.sample && b.sample.subject).filter(Boolean).slice(0, 2).join(' · '); items.push({ id: 'outbox', dot: '#c9a962', title: a.outbox.title(emails, D.outbox.length), sub: a.outbox.sub(subjects || fmt.plural(D.outbox.length, 'batch', 'batches')), cta: a.outbox.cta, href: '/inbox/outbox' }); }
  // UXFIX-A1 #4: member threads NEEDING A REPLY (the Inbox tab's own rule) — a guest must never wait invisibly.
  // Falls back to the old unread count when the threads endpoint is unavailable.
  const need = D.msgNeedsReply;
  if (need && need.length) {
    const oldest = need.reduce((x, t) => (!x || String((t.last || {}).at || '') < String((x.last || {}).at || '')) ? t : x, null);
    const days = oldest && oldest.last && oldest.last.at ? Math.max(0, fmt.daysSince(oldest.last.at) || 0) : 0;
    items.push({ id: 'messages', dot: days >= 2 ? '#9b1b22' : '#c9a962', title: a.messages.title(need.length), sub: a.messages.sub(oldest ? oldest.name : '', days), cta: a.messages.cta, href: '/inbox/messages' });
  } else if (!need) {
    const unread = D.pstats && D.pstats.pending ? Number(D.pstats.pending.unreadMessages || 0) : 0;
    if (unread > 0) items.push({ id: 'messages', dot: '#c9a962', title: a.messages.title(unread), sub: a.messages.sub('', 0), cta: a.messages.cta, href: '/inbox/messages' });
  }
  // UXFIX-A1 #5: actioned nags all point at the same single action (approve in the Outbox) —
  // collapse them into ONE row below; the AI-planner promo is not urgent and moves to the quiet footer.
  let actionedCount = 0;
  D.nag.forEach(n => {
    if (n.kind === 'content_plan_missing') return;                    // #5: feature ad, not urgent — quiet corner
    if (n.kind === 'message_unanswered' && need) return;              // the MEMBER MESSAGES row above already carries these (it showed twice, once as "Reply to A member")
    if (n.status === 'actioned') { actionedCount++; return; }         // #5: collapsed into one row after the loop
    const p = n.action_payload || {}; const who = p.who || p.name || '';
    let sub = '';
    if (n.kind === 'gala_unpaid') { const g = D.gala.rows.find(x => x.id === (p.gala_id || n.subject_id)); const when = g ? fmt.longRange(g.created_at) : ''; const days = g ? Math.max(0, fmt.daysSince(g.created_at) || 0) : null; sub = g ? a.nag.galaSub(when, days) : 'Reserved · reminder queues to the Outbox for your OK'; }
    else { const s = a.nag.subs[n.kind]; sub = typeof s === 'function' ? s(who || 'A member') : (s || (who ? who + ' · ' : '') + String(n.kind || '').replace(/_/g, ' ')); }
    const act = ['payment_reminder', 'dietary_reminder', 'nudge_assignee'].includes(n.action_kind);
    const href = n.action_kind === 'digest_review' ? routeForSection(p.open_section || 'newsletter', '/inbox/newsletter') : /^task_/.test(n.kind) ? '/tasks' : n.kind === 'gala_unpaid' ? '/gala' : routeForSection(p.open_section || n.kind, '/today');
    items.push({ id: n.id, dot: NAG_DOT[n.kind] || '#c9a962', title: String(n.title || '').replace(/:\s+/, ' — '), sub,
      cta: a.nag.ctas[n.action_kind] || a.nag.ctas.default, href, act, nagId: n.id });
  });
  if (actionedCount) items.push({ id: 'nagOutbox', dot: '#c9a962', title: a.drafts.title(actionedCount), sub: a.drafts.sub, cta: a.drafts.cta, href: '/inbox/outbox' });
  const od = overdueTasks();
  if (od.length) { const oldest = Math.max(...od.map(t => fmt.daysSince(t.due_date) || 0)); items.push({ id: 'tasks', dot: '#9b1b22', title: a.tasks.title(od.length), sub: a.tasks.sub(oldest), cta: a.tasks.cta, href: '/tasks' }); }
  const snoozed = readSnoozes();
  return items.filter(i => !snoozed[i.id]);
}
function comingUp() {
  const today = fmt.ymd(new Date()); const rows = [];
  D.calendar.forEach(e => { const end = (e.ends_on || e.starts_on || '').slice(0, 10); if (!e.starts_on || end < today) return; rows.push({ d: String(e.starts_on).slice(0, 10), label: fmt.rangeLabel(e.starts_on, e.ends_on), text: e.title + (e.notes ? ' · ' + e.notes : '') }); });
  const g = D.gala;
  if (g.ebDays != null && g.ebDays >= 0 && !D.calendar.some(e => /early[- ]bird/i.test(e.title || '') && String(e.starts_on || '').slice(0, 10) === g.ebDeadline)) rows.push({ d: g.ebDeadline, label: fmt.dayLabel(g.ebDeadline), text: COPY.comingUp.earlyBird(fmt.eur(Number(D.galaSettings.price_gala_regular) || FACTS.gala.priceRegular), g.ebDays) });
  return rows.sort((a, b) => a.d.localeCompare(b.d)).slice(0, 3).map(r => Object.assign(r, { color: (fmt.daysUntil(r.d) || 0) <= 7 ? '#9b1b22' : '#6d6459' }));
}
// the card lists MY open tasks, so the meta is the state, not the name: IN PROGRESS · due/overdue
function taskMeta(t) {
  const lead = t.status === 'doing' ? COPY.tasks.doing : '';
  const join = due => [lead, due].filter(Boolean).join(' · ');
  if (!t.due_date || !String(t.due_date).trim()) return { meta: lead, dueColor: '#6d6459' };
  const diff = fmt.daysUntil(t.due_date);
  if (diff < 0) return { meta: join(COPY.tasks.overdue(Math.abs(diff))), dueColor: '#9b1b22' };
  if (diff === 0) return { meta: join(COPY.tasks.today), dueColor: '#b7791f' };
  return { meta: join(COPY.tasks.due(fmt.dayLabel(t.due_date))), dueColor: '#6d6459' };
}
function weeklyRead() {
  const w = COPY.weekly; const adv = D.advisors; const seats = adv && adv.seats ? adv.seats : {};
  const rows = [], heads = [];
  let anyMock = false;
  const firstSentence = t => { const m = String(t || '').match(/^.*?[.!?](\s|$)/); return (m ? m[0] : String(t || '')).trim(); };
  w.order.forEach(seat => { const r = seats[seat]; if (!r || !Array.isArray(r.observations) || !r.observations.length) return; if (r.is_mock) anyMock = true; r.observations.forEach((o, i) => { rows.push({ seat, top: i === 0, tag: w.seats[seat].tag, color: w.seats[seat].color, text: String(o.headline || '').replace(/[.!]+$/, '') + (o.detail ? ' — ' + firstSentence(o.detail) : ''), href: routeForSection(o.link_section, '/today'), link: o.link_label }); if (i === 0) heads.push(String(o.headline || '').replace(/[.!]+$/, '')); }); });
  const shown = st.wrAll ? rows : rows.filter(r => r.top);
  return { rows, shown, headline: heads.slice(0, 3).join('. ') + (heads.length ? '.' : ''), week: adv && adv.week ? adv.week.replace(/^(\d{4})-W(\d+)$/, 'week $2 · $1') : '', mock: anyMock, locked: isLocked('advisors'), empty: !rows.length };
}

// ---------------------------------------------------------------- blocks
function blockGreeting() {
  const hour = new Date().getHours();
  const greeting = COPY.greetings[hour < 12 ? 0 : hour < 18 ? 1 : 2];
  return `
    <!-- dc: Admin Home.dc.html › "Greeting row" -->
    <div class="mx-t-greet" style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px;white-space:nowrap">${esc(greeting)}, <i>${esc(session.firstName())}</i>.</span>
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${fmt.todayLabel()}</span>
      <div style="flex:1"></div>
      <span data-act="custToggle" title="${esc(COPY.customise.title)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;cursor:pointer;border:1px solid rgba(32,27,22,.18);padding:5px 10px;background:${st.custOpen ? '#f6f2ea' : '#fff'}" data-hover="color:#201b16;border-color:#201b16">${COPY.customise.btn}</span>
      <span data-block="pill">${pill()}</span>
    </div>
    <!-- /dc -->`;
}
function pill() {
  const h = state.get().health || { state: 'unknown', label: 'CHECKING…', color: '#6d6459' };
  return `<a href="/settings/health" title="${esc(COPY.pill.title(h.state))}" data-role="pill" data-state="${esc(h.state)}" style="display:flex;align-items:center;gap:7px;font:600 10px Inter,sans-serif;letter-spacing:.14em;color:${h.color}" data-hover="color:#201b16"><span style="width:7px;height:7px;background:${h.color};border-radius:50%"></span>${esc(h.label)} →</a>`;
}
function blockCustomise() {
  if (!st.custOpen) return `<!-- dc: Admin Home.dc.html › "Customise panel" --><!-- closed --><!-- /dc -->`;
  const box = (key, label) => `<span data-act="custTg" data-key="${key}" role="checkbox" aria-checked="${!!D.prefs[key]}" style="display:flex;gap:9px;align-items:center;font-size:12.5px;cursor:pointer"><span style="width:12px;height:12px;border:1px solid rgba(32,27,22,.4);background:${D.prefs[key] ? '#9b1b22' : 'transparent'};flex:none"></span>${esc(label)}</span>`;
  return `
    <!-- dc: Admin Home.dc.html › "Customise panel" -->
    <div data-block="customise" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:14px 20px;display:flex;gap:34px;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;gap:8px">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.customise.numbers}</span>
        ${KPI_KEYS.map(k => box(k, COPY.kpi[k].label)).join('\n        ')}
        ${box(TREND_KEY, COPY.kpi.kTrend.label)}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.customise.shortcuts}</span>
        ${SC_KEYS.map(k => box(k, COPY.shortcuts[k].pick)).join('\n        ')}
      </div>
      <span style="font-size:11.5px;color:#6d6459;max-width:280px;line-height:1.55;margin-left:auto">${COPY.customise.note}</span>
    </div>
    <!-- /dc -->`;
}
function blockHero() {
  const kpis = kpiDefs();
  return `
    <!-- dc: Admin Home.dc.html › "Hero numbers" -->
    <div data-block="hero" style="border:1px solid rgba(32,27,22,.14);background:#fff">
    <div class="mx-kpi" style="display:grid;grid-template-columns:repeat(${Math.max(1, kpis.length)},1fr)">
      ${kpis.map(k => `
        <a href="${k.href}"${k.title ? ` title="${esc(k.title)}"` : ''} style="padding:18px 22px;border-right:1px solid rgba(32,27,22,.12);display:block;color:#201b16" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${k.k}</div>
          <div class="mx-display-34" style="font-family:Fraunces,serif;font-size:34px;margin-top:4px">${esc(k.v)}</div>
          <div style="font-size:11.5px;color:${k.subColor}">${esc(k.sub)}</div>
        </a>`).join('')}
      ${!kpis.length ? `<div style="padding:18px 22px;font-size:12.5px;color:#6d6459">${COPY.doItNow.empty.replace('shortcuts', 'numbers')}</div>` : ''}
    </div>
    ${blockTrend()}
    </div>
    <!-- /dc -->`;
}
// The registrations chart. Re-rendered on its own for a chip/range/mode click; the SVG inside is
// drawn by drawTrend() after the markup lands, because it is laid out in measured pixels.
function blockTrend() {
  if (!D.prefs[TREND_KEY]) return '<!-- trend chart hidden via ✎ CUSTOMISE -->';
  const c = COPY.trends;
  const m = D.trends ? trendModel() : null;
  const pill = (on, label, act, data, title) => `<span data-act="${act}" ${data} role="button" aria-pressed="${on}" title="${esc(title)}" style="padding:4px 9px;font:600 8.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.18)'};background:${on ? '#201b16' : '#fff'};color:${on ? '#f6f2ea' : '#6d6459'}">${label}</span>`;
  const chip = s => `<span data-act="trChip" data-key="${s.key}" role="checkbox" aria-checked="${!s.hidden}" title="${esc(c.chipTitle(s.label, !s.hidden))}" style="display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid ${s.hidden ? 'rgba(32,27,22,.14)' : 'rgba(32,27,22,.3)'};background:${s.hidden ? 'transparent' : '#fff'};font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:${s.hidden ? '#a49a8d' : '#201b16'};cursor:pointer" data-hover="border-color:#201b16">
      <span style="width:9px;height:9px;flex:none;background:${s.hidden ? 'transparent' : s.color};border:1px solid ${s.color};opacity:${s.hidden ? '.45' : '1'}"></span>${s.label}<span style="color:${s.hidden ? '#bdb4a7' : '#6d6459'};letter-spacing:.06em">${s.sum}</span></span>`;
  return `
    <div data-block="trend" style="border-top:1px solid rgba(32,27,22,.12);padding:14px 22px 16px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${c.title(st.trDays)}</span>
        <span style="font-family:Fraunces,serif;font-size:18px">${m ? esc(c.regs(m.total)) : '—'}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459">${m ? esc(m.scopeLabel) : ''}</span>
        <div style="flex:1;min-width:10px"></div>
        <span style="display:inline-flex;gap:4px">${[['daily', c.daily], ['cumulative', c.cumulative]].map(([k, l]) => pill(st.trMode === k, l, 'trMode', `data-mode="${k}"`, c.modeTitle)).join('')}</span>
        <span style="display:inline-flex;gap:4px">${RANGES.map(d => pill(st.trDays === d, d + 'D', 'trRange', `data-days="${d}"`, c.rangeTitle(d))).join('')}</span>
      </div>
      ${m ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${m.series.map(chip).join('')}</div>` : ''}
      ${m && m.stale ? `<div style="font-size:11px;color:#b7791f;margin-top:8px">${c.stale}</div>` : ''}
      <div data-role="trHost" style="position:relative;margin-top:10px;min-height:${CH_H}px"></div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-top:2px">
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${m ? esc(m.rangeLabel) : ''}</span>
        <div style="flex:1"></div>
        ${m && !m.visible.length ? `<span style="font-size:11.5px;color:#9b1b22">${c.none}</span>` : m && !m.total ? `<span style="font-size:11.5px;color:#6d6459;font-style:italic">${c.empty}</span>` : ''}
      </div>
    </div>`;
}
function blockProjects() {
  const c = COPY.projects, s = D.status, g = D.gala, conf = D.conf;
  const regs = D.summary ? Number(D.summary.plexus.registrations || 0) : (D.pstats ? Number(D.pstats.plexus.registrations || 0) : 0);
  const apps = D.summary ? Number(D.summary.accelerator.applications || 0) : (D.pstats ? Number(D.pstats.accelerator.applications || 0) : 0);
  const members = D.summary ? Number(D.summary.forum.members || 0) : 0;
  const accEl = s.accelerator; const accLabel = accEl ? fmt.upper(fmt.detail(accEl.status_label)) : c.accelerator.opens;
  const accColor = accEl && accEl.status_kind === 'open' ? '#9b1b22' : accEl && accEl.status_kind === 'soon' ? '#b7791f' : '#b7791f';
  const nb = D.bridges.next; const nbCity = nb ? nb.city : FACTS.bridges.next.city;
  const nbWhen = nb && nb.d ? fmt.dayLabel(nb.d).split(' ')[0] + ' ' + nb.d.slice(0, 4) : nb ? c.bridges.dateTbc : FACTS.bridges.next.short.toUpperCase();
  const nbVenue = nb && nb.venue_name && !/announce|tba/i.test(nb.venue_name) ? nb.venue_name : c.bridges.venueSoon;
  const card = (href, top, eyebrowColor, eyebrow, title, line1, line2, dashed) => `
        <a href="${href}" style="border:1px ${dashed ? 'dashed rgba(32,27,22,.25)' : 'solid rgba(32,27,22,.14)'};${top ? 'border-top:2px solid #9b1b22;' : ''}background:${dashed ? 'transparent' : '#fff'};padding:16px;display:flex;flex-direction:column;gap:6px;color:#201b16" data-hover="border-color:rgba(32,27,22,${dashed ? '.5' : '.35'});color:#201b16">
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.15em;color:${eyebrowColor}">${eyebrow}</span>
          <span style="font-family:Fraunces,serif;font-size:17px;line-height:1.2">${title}</span>
          <span style="font-size:11.5px;color:#6d6459;line-height:1.5">${line1}<br>${line2}</span>
        </a>`;
  return `
    <!-- dc: Admin Home.dc.html › "YOUR PROJECTS" -->
    <div data-block="projects">
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${c.sub}</span>
      </div>
      <div class="mx-grid-5" style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px">
        ${card('/projects/plexus', true, Number(conf.registration_open) ? '#9b1b22' : '#6d6459', (Number(conf.registration_open) || !conf.id ? c.plexus.live : c.plexus.closed) + ' · ' + esc(fmt.rangeLabel(conf.start_date || FACTS.plexus.start, conf.end_date || FACTS.plexus.end)), esc(c.plexus.title), esc(c.plexus.line(regs, D.cap, isLocked('gala') ? '— gala paid' : (g.ops ? `${g.ops.seats.paid} gala seat${g.ops.seats.paid === 1 ? '' : 's'} paid` : `${g.paid.length} gala booking${g.paid.length === 1 ? '' : 's'} paid`))), esc(c.plexus.parts))}
        ${card('/projects/accelerator', false, accColor, esc(accLabel), esc(c.accelerator.title), esc(c.accelerator.apps(apps)), D.institutions == null ? esc(FACTS.accelerator.hosts.length + ' host institutions (canonical)') : esc(c.accelerator.hosts(D.institutions)))}
        ${card('/projects/forum', false, '#6d6459', esc(s.forum ? fmt.upper(s.forum.status_label) : c.forum.eyebrow), esc(c.forum.title), esc(c.forum.line(members, D.forumCandidates)), esc(c.forum.gathering))}
        ${card('/projects/bridges', false, nb ? '#2f7d4f' : '#b7791f', nb ? esc(c.bridges.next(nbCity, nbWhen)) : c.bridges.none, esc(c.bridges.title), esc(c.bridges.line(D.bridges.past, nb ? Number(nb.registration_count || 0) : 0, nbCity)), esc((nb ? (nb.d ? fmt.rangeLabel(nb.d) : c.bridges.dateLine) : FACTS.bridges.next.label) + ' · ' + nbVenue))}
        ${card('/settings', false, '#6d6459', c.more.eyebrow, c.more.title, c.more.line, '', true)}
      </div>
    </div>
    <!-- /dc -->`;
}
function attentionRows() {
  const a = COPY.attention; const items = attentionItems();
  const shown = st.showAll ? items : items.slice(0, TOP_ROWS);
  const row = i => `
        <div data-row="${esc(i.id)}" class="mx-row" style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.08)">
          <span style="width:8px;height:8px;background:${i.dot};flex:none"></span>
          <span class="mx-row-text" style="flex:1;min-width:0">
            <span style="display:block;font-size:14px;font-weight:600">${esc(i.title)}</span>
            <span style="display:block;font-size:12px;color:#6d6459;margin-top:2px">${esc(i.sub)}</span>
          </span>
          ${i.act ? `<span data-act="nagAct" data-id="${esc(i.nagId)}" style="padding:8px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap;cursor:pointer" data-hover="background:#7e151b;color:#fff">${esc(i.cta)}</span>`
                  : `<a href="${esc(i.href)}" style="padding:8px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#7e151b;color:#fff">${esc(i.cta)}</a>`}
          <span data-act="snooze" data-id="${esc(i.id)}" title="${esc(a.snoozeTitle)}" style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#201b16">${a.snooze}</span>
        </div>`;
  return `<div data-block="attn">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(32,27,22,.12)">
          <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${a.title}</span>
          <span style="min-width:18px;height:18px;padding:0 5px;background:#9b1b22;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center">${items.length}</span>
          <div style="flex:1"></div>
          <span style="font-size:11.5px;color:#6d6459">${a.sub}</span>
        </div>
        ${shown.map(row).join('')}
        ${!items.length ? `<div style="padding:26px 20px;text-align:center;font-size:13px;color:#6d6459">${a.empty}</div>` : ''}
        <div style="display:flex;gap:18px;padding:12px 20px;align-items:baseline;flex-wrap:wrap">
          <span style="font-size:11.5px;color:#6d6459">${a.foot}</span>
          <div style="flex:1"></div>
          ${(() => { const plan = D.nag.find(n => n.kind === 'content_plan_missing'); return plan ? `<a href="${esc(routeForSection(((plan.action_payload || {}).open_section) || 'pr-media', '/studio'))}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;white-space:nowrap" data-hover="color:#201b16">${a.plan}</a>` : ''; })()}
          ${items.length > TOP_ROWS ? `<span data-act="showAll" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.showAll ? a.showLess : a.showAll(items.length)}</span>` : ''}
        </div>
      </div>`;
}
function blockAttention() {
  const shortcuts = shortcutDefs();
  return `
    <!-- dc: Admin Home.dc.html › "NEEDS YOUR ATTENTION" + "DO IT NOW" -->
    <div class="mx-two mx-t-attn" style="display:grid;grid-template-columns:1.6fr 1fr;gap:22px;align-items:start">
      <div style="border:1px solid rgba(32,27,22,.14);background:#fff">${attentionRows()}</div>
      <div style="display:flex;flex-direction:column;gap:22px">
        <div data-block="doit" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.doItNow.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${COPY.doItNow.hint}</span></div>
          <div style="padding:14px 20px 16px;display:flex;flex-direction:column;gap:10px">
            ${shortcuts.map(s => `<a href="${s.href}" style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:${s.bg};border:1px solid ${s.bd};color:${s.fg};font:600 10.5px Inter,sans-serif;letter-spacing:.14em" data-hover="border-color:#201b16">${s.gold ? '<span style="width:6px;height:6px;background:#c9a962"></span>' : ''}${s.label}</a>`).join('\n            ')}
            ${!shortcuts.length ? `<span style="font-size:12.5px;color:#6d6459;font-style:italic">${COPY.doItNow.empty}</span>` : ''}
          </div>
        </div>
        ${bigIdeasCard()}
      </div>
    </div>
    <!-- /dc -->`;
}
// Big Ideas — next steps. A compact card in the right-hand column (so it inherits the ≤480px
// order of .mx-t-attn), showing the five most pressing next steps, overdue first. With nothing
// due it renders NOTHING: the flex gap collapses and Today looks exactly as it did.
function bigIdeasCard() {
  const c = COPY.bigIdeas;
  const items = Array.isArray(D.bigIdeas) ? D.bigIdeas : [];
  if (!items.length) return `
        <!-- Big Ideas — next steps: nothing due, so no card -->`;
  const shown = items.slice(0, 5);
  const label = i => (i.days_until < 0 ? c.overdue(Math.abs(i.days_until)) : i.days_until === 0 ? c.today : c.due(i.next_step_due || ''));
  const colour = i => (i.days_until < 0 ? '#9b1b22' : i.days_until <= 3 ? '#b7791f' : '#6d6459');
  return `
        <div data-block="bigideas" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${c.hint}</span></div>
          ${shown.map((i, n) => `
          <a class="mx-row" href="/big-ideas/${esc(i.id)}" style="display:flex;gap:12px;align-items:baseline;padding:12px 20px;color:#201b16;${n < shown.length - 1 ? 'border-bottom:1px solid rgba(32,27,22,.08)' : ''}" data-hover="background:#fdfbf6">
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
              <span style="font-size:12.5px;font-weight:600;overflow-wrap:anywhere">${esc(i.title)}</span>
              <span style="font-size:11.5px;color:#6d6459;line-height:1.45;overflow-wrap:anywhere">${esc(i.next_step)}</span>
            </span>
            <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${colour(i)};white-space:nowrap">${esc(label(i))}</span>
          </a>`).join('')}
          ${items.length > shown.length ? `<div style="padding:10px 20px;border-top:1px solid rgba(32,27,22,.08);display:flex"><div style="flex:1"></div><a href="${c.open}" style="font:600 10px Inter,sans-serif;letter-spacing:.14em">${c.all(items.length)}</a></div>` : ''}
        </div>`;
}
function tasksCard() {
  const c = COPY.tasks; const b = D.tasksBadge || { done_unseen: 0 }; const mine = D.myTasks || []; const shown = mine.slice(0, 5);
  return `<div data-block="tasks" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>${mine.length ? `<span style="min-width:18px;height:18px;padding:0 5px;background:#201b16;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center" title="${esc(c.mine)}">${mine.length}</span>` : ''}<div style="flex:1"></div><a href="/tasks" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22">${c.all}</a></div>
        ${b.done_unseen > 0 ? `
        <a href="/tasks" data-v2="done-unseen — the red line: what the other person finished, waiting for my eyes" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f7e3e4;border-left:3px solid #9b1b22;color:#201b16" data-hover="background:#f1d6d8">
          <span style="min-width:18px;height:18px;padding:0 5px;background:#9b1b22;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center">${b.done_unseen}</span>
          <span style="font-size:12.5px;font-weight:600;flex:1;min-width:0">${esc(c.waiting(b.done_unseen))}</span>
          <span style="font-size:11px;color:#7e151b;white-space:nowrap">${c.waitingWhy}</span>
        </a>` : ''}
        ${shown.map(t => { const m = taskMeta(t); return `
        <a href="/tasks/${encodeURIComponent(t.id)}" data-task="${esc(t.id)}" style="display:flex;gap:11px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.08);color:#201b16" data-hover="color:#9b1b22">
          <span style="width:6px;height:6px;background:${t.status === 'doing' ? '#2c4a73' : (m.dueColor === '#9b1b22' ? '#9b1b22' : '#c9a962')};flex:none"></span>
          <span style="font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:${m.dueColor};white-space:nowrap">${esc(m.meta)}</span>
        </a>`; }).join('')}
        ${mine.length > shown.length ? `<a href="/tasks" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#6d6459;padding-top:2px">${esc(c.more(mine.length - shown.length))}</a>` : ''}
        ${!mine.length && !(b.done_unseen > 0) ? `<div style="padding:8px 0 2px"><div style="font-family:Fraunces,serif;font-style:italic;font-size:15px">${c.empty}</div><div style="font-size:11.5px;color:#6d6459;margin-top:3px">${c.emptyWhy}</div></div>` : ''}
      </div>`;
}
function notesCard() {
  const c = COPY.notes; const n = D.notes || {}; const count = Number(n.count || 0); const ev = n.event || null; const last = n.last || null;
  const line = ev ? c.forEvent(ev.label, Number(n.event_count || 0)) : c.today(count);
  return `<div data-block="notes" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span>${count ? `<span style="min-width:18px;height:18px;padding:0 5px;background:#201b16;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center">${count}</span>` : ''}<div style="flex:1"></div><a href="/notes?new=1" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22">${c.add}</a></div>
        <a href="${ev ? '/notes?event=' + encodeURIComponent(ev.key) : '/notes'}" style="display:flex;flex-direction:column;gap:3px;color:#201b16;padding:6px 0 2px" data-hover="color:#9b1b22">
          <span style="font-family:Fraunces,serif;font-style:italic;font-size:15px;line-height:1.35">${esc(line)}</span>
          ${last ? `<span style="font-size:12px;color:#6d6459;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden"><span style="font:600 8.5px Inter,sans-serif;letter-spacing:.12em;color:#9a9086">${esc(c.last(last.author_first).toUpperCase())}</span> ${esc(last.first_line)}</span>` : `<span style="font-size:11.5px;color:#6d6459">${c.why}</span>`}
        </a>
      </div>`;
}
function blockComingTasks() {
  const rows = comingUp();
  return `
    <!-- dc: Admin Home.dc.html › "COMING UP" + "TEAM TASKS" -->
    <div class="mx-two mx-t-coming" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
      <div data-block="coming" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.comingUp.title}</span>
        ${rows.map((r, i) => `<div style="display:flex;gap:12px;align-items:baseline;padding:8px 0;${i < rows.length - 1 ? 'border-bottom:1px solid rgba(32,27,22,.08)' : ''}"><span style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:${r.color};white-space:nowrap">${esc(r.label)}</span><span style="font-size:12.5px;flex:1">${esc(r.text)}</span></div>`).join('')}
        ${!rows.length ? `<div style="padding:8px 0;font-size:12.5px;color:#6d6459;font-style:italic">${isLocked('calendar') ? COPY.kpi.locked : COPY.comingUp.empty}</div>` : ''}
        <a href="/calendar" style="font:600 10px Inter,sans-serif;letter-spacing:.14em">${COPY.comingUp.full}</a>
      </div>
      <div style="display:flex;flex-direction:column;gap:22px;min-width:0">${tasksCard()}${notesCard()}</div>
    </div>
    <!-- /dc -->`;
}
function blockWeekly() {
  const w = COPY.weekly; const r = weeklyRead();
  // UXFIX-A1 #15 (2026-09-02): no card until a REAL weekly read exists — the SAMPLE placeholder
  // and the not-yet-compiled gate line were occupying prime space without doing work. The locked
  // state stays (a real read may exist that this admin cannot see).
  if (!r.locked && (r.mock || r.empty)) return `
    <!-- dc: Admin Home.dc.html › "THE WEEKLY READ" -->
    <!-- hidden: no real weekly read yet (UXFIX-A1 #15) -->
    <!-- /dc -->`;
  const headline = r.locked ? w.locked : r.empty ? w.gate : r.headline;
  const label = r.locked || r.empty ? w.gateCta : (st.wrOpen ? w.hide : w.read);
  const head = r.locked || r.empty
    ? `<a href="/settings/health" style="display:flex;align-items:center;gap:12px;padding:14px 20px;color:#201b16"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${w.title}</span><span style="font-size:12.5px;flex:1;min-width:0;line-height:1.5;color:#6d6459">${esc(headline)}</span><span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${label}</span></a>`
    : `<div data-act="wrToggle" style="display:flex;align-items:center;gap:12px;padding:14px 20px;cursor:pointer"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;white-space:nowrap">${w.title}</span><span style="font-size:12.5px;flex:1;min-width:0;line-height:1.5">${esc(headline)}</span>${r.mock ? `<span style="font:600 8.5px Inter,sans-serif;letter-spacing:.1em;background:#f8f1e2;color:#7a6432;padding:3px 7px;white-space:nowrap">SAMPLE</span>` : ''}<span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;white-space:nowrap">${label}</span></div>`;
  return `
    <!-- dc: Admin Home.dc.html › "THE WEEKLY READ" -->
    <div data-block="weekly" style="border:1px solid rgba(32,27,22,.14);background:#fff">
      ${head}
      ${st.wrOpen && !r.empty && !r.locked ? `
      <div style="border-top:1px solid rgba(32,27,22,.12)">
        ${r.shown.map((o, i) => `<div class="mx-row" style="display:flex;gap:14px;align-items:baseline;padding:12px 20px;${i < r.shown.length - 1 ? 'border-bottom:1px solid rgba(32,27,22,.08)' : ''}"><span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:${o.color};width:44px;flex:none">${o.tag}</span><span class="mx-row-text" style="font-size:13px;flex:1">${esc(o.text)}</span><a href="${esc(o.href)}" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" title="${esc(o.link || '')}">${w.open}</a></div>`).join('')}
        <div style="display:flex;gap:16px;align-items:baseline;padding:10px 20px;border-top:1px solid rgba(32,27,22,.08);font-size:11px;color:#6d6459"><span style="flex:1">${esc(w.foot(r.week))}${r.mock ? ' ' + esc(w.sample) : ''}</span>${r.rows.length > r.shown.length || st.wrAll ? `<span data-act="wrAll" style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.wrAll ? w.fewer : w.all(r.rows.length)}</span>` : ''}</div>
      </div>` : ''}
    </div>
    <!-- /dc -->`;
}
function blockFooter() {
  // UXFIX-A1 #15 (2026-09-02): the SYSTEM HEALTH link repeated the header pill on the same screen — dropped, pill kept
  return `
    <!-- dc: Admin Home.dc.html › "ADMIN:" footer row -->
    <div data-block="footer" style="display:flex;gap:20px;align-items:center;padding-top:2px;flex-wrap:wrap">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.footer.admin}</span>
      <a href="/settings/audit" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459" data-hover="color:#201b16">${COPY.footer.audit}</a>
      <a href="${esc(cfg.memberPortalUrl || '/')}" target="_blank" rel="noopener" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459" data-hover="color:#201b16">${COPY.footer.member}</a>
    </div>
    <!-- /dc -->`;
}
// Event day: the bridges_events row dated today (the legacy /api/bridges/events read this view
// already makes) → one crimson bar above everything, straight to /event-day where the Bridges
// door pre-selects. Absent on every other day.
function blockTonight() {
  const today = fmt.ymd(new Date());
  const ev = ((D.bridges && D.bridges.dated) || []).find(b => b.d === today && String(b.status || '') !== 'cancelled');
  if (!ev) return '';
  return `
    <!-- v2: event day — the door scanner shortcut -->
    <a href="/event-day" data-block="tonight" data-v2="door-scanner" class="mx-t-tonight" style="display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;padding:16px 20px;background:#9b1b22;color:#fff;text-decoration:none;min-height:56px;box-sizing:border-box" data-hover="background:#7e151b">
      <span style="font-family:Fraunces,serif;font-size:18px;line-height:1.3">${esc(COPY.tonight.line(ev.city || FACTS.bridges.next.city))}</span>
      <span style="font:600 12px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap">${COPY.tonight.cta}</span>
    </a>`;
}
function template() {
  return `
<div data-screen-label="Admin Home" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:26px">
    ${blockTonight()}
    ${blockGreeting()}
    ${blockCustomise()}
    ${blockHero()}
    ${blockProjects()}
    ${blockAttention()}
    ${blockComingTasks()}
    ${blockWeekly()}
    ${blockFooter()}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function rerender(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function rerenderCustomise() { const el = rootEl.querySelector('[data-block="customise"]'); const html = blockCustomise(); if (el) { el.outerHTML = html; } else { const g = rootEl.querySelector('[data-block="pill"]'); const row = g && g.closest('div'); if (row) row.insertAdjacentHTML('afterend', html); } const b = rootEl.querySelector('[data-act="custToggle"]'); if (b) b.style.background = st.custOpen ? '#f6f2ea' : '#fff'; }
async function savePrefs() {
  const cards = PREF_KEYS.map((k, i) => ({ card_id: k, is_visible: !!D.prefs[k], sort_order: i }));
  try { await api.put('/api/dashboard-preferences/' + PREFS_SECTION, { cards }); ui.toast(COPY.customise.saved); }
  catch (e) { ui.toast(COPY.customise.failed, { kind: 'error' }); }
}
// Draw (or redraw) the chart into the block that is currently in the DOM, sized to the space it
// actually has. Re-run after every re-render of the block and on any resize — that is what keeps
// it from overflowing a phone and what keeps the tick labels unstretched.
let trRO = null, trOff = null;
function drawTrend() {
  if (trOff) { trOff(); trOff = null; }
  if (trRO) { trRO.disconnect(); trRO = null; }
  const host = rootEl && rootEl.querySelector('[data-role="trHost"]');
  if (!host || !D.trends) return;
  const m = trendModel();
  const paint = () => {
    const W = Math.max(240, Math.round(host.clientWidth || 0));
    if (!W) return;
    host.innerHTML = trendSvg(m, W) + `<div data-role="trTip" style="position:absolute;left:0;top:0;display:none;pointer-events:none;background:#201b16;color:#f6f2ea;padding:8px 10px;max-width:min(240px,calc(100% - 8px));box-shadow:0 8px 22px rgba(32,27,22,.28);z-index:5"></div>`;
    bindTrendHover(host, m, W);
  };
  paint();
  if (typeof ResizeObserver === 'function') {
    let last = host.clientWidth;
    trRO = new ResizeObserver(() => { const w = host.clientWidth; if (Math.abs(w - last) > 1) { last = w; paint(); } });
    trRO.observe(host);
  }
}
// Pointer tracking: one hit rect over the plot, a guide line, a dot per visible series and a
// tooltip that follows the pointer and is clamped inside the host so it can never clip off a
// phone. Touch works through Pointer Events; `touch-action:pan-y` on the rect keeps the page
// scrollable while a horizontal drag reads the chart.
function bindTrendHover(host, m, W) {
  const svg = host.querySelector('svg'), hit = host.querySelector('[data-role="trHit"]');
  const guide = host.querySelector('[data-role="trGuide"]'), dots = host.querySelector('[data-role="trDots"]');
  const tip = host.querySelector('[data-role="trTip"]');
  if (!svg || !hit || !tip) return;
  const { l, r, t } = CH_PAD;
  const plotW = Math.max(60, W - l - r), n = m.dates.length, slot = plotW / n;
  const x = i => l + (i + 0.5) * slot;
  const y = v => t + CH_PLOT_H - (m.top ? (v / m.top) * CH_PLOT_H : 0);
  let idx = -1;
  const hide = () => { idx = -1; guide.setAttribute('opacity', '0'); dots.innerHTML = ''; tip.style.display = 'none'; };
  const move = (e) => {
    const box = svg.getBoundingClientRect();
    const i = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - box.left - l) / slot)));
    if (i !== idx) {
      idx = i;
      guide.setAttribute('x1', x(i).toFixed(1)); guide.setAttribute('x2', x(i).toFixed(1));
      guide.setAttribute('opacity', '.2');
      dots.innerHTML = m.visible.map(s => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.plot[i]).toFixed(1)}" r="3" fill="#fff" stroke="${s.color}" stroke-width="1.6"></circle>`).join('');
      // Past five rows the single column grows taller than the plot itself, so it goes two-up —
      // that is what keeps the whole tooltip inside the card on a phone as well as on a desktop.
      const cols = m.visible.length > 5 ? 2 : 1;
      tip.style.maxWidth = cols === 2 ? 'min(330px,calc(100% - 8px))' : 'min(240px,calc(100% - 8px))';
      tip.innerHTML = `<div style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#c9a962">${esc(dayFull(m.dates[i]).toUpperCase())}</div>`
        + (m.visible.length ? `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));column-gap:14px;margin-top:3px">`
            + m.visible.map(s => `<div style="display:flex;align-items:center;gap:6px;margin-top:3px;font:400 11px Inter,sans-serif;line-height:1.35;white-space:nowrap"><span style="width:8px;height:8px;flex:none;background:${s.color}"></span><span style="flex:1;min-width:0">${s.label}</span><span style="font-weight:600">${s.plot[i]}</span></div>`).join('')
            + `</div>`
          : `<div style="margin-top:4px;font:400 11.5px Inter,sans-serif;white-space:normal">${COPY.trends.none}</div>`);
      tip.style.display = 'block';
    }
    // Follow the pointer, then clamp hard to the host box on both axes — the tooltip is a child of
    // the host, so staying inside it is what guarantees nothing clips off the card or the screen.
    const hb = host.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const maxX = Math.max(0, hb.width - tw), maxY = Math.max(0, hb.height - th);
    let px = e.clientX - hb.left + 14, py = e.clientY - hb.top + 12;
    if (px > maxX) px = e.clientX - hb.left - 14 - tw;
    if (py > maxY) py = e.clientY - hb.top - 12 - th;
    tip.style.left = Math.round(Math.min(Math.max(0, px), maxX)) + 'px';
    tip.style.top = Math.round(Math.min(Math.max(0, py), maxY)) + 'px';
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('pointercancel', hide);
  trOff = () => { hit.removeEventListener('pointermove', move); hit.removeEventListener('pointerdown', move); hit.removeEventListener('pointerleave', hide); hit.removeEventListener('pointercancel', hide); };
}
function rerenderTrend() { rerender('[data-block="trend"]', blockTrend()); drawTrend(); }

const handlers = {
  custToggle: () => { st.custOpen = !st.custOpen; rerenderCustomise(); },
  trChip: (el) => { const k = el.dataset.key; const m = trendModel(); const cur = m.series.find(s => s.key === k); if (!cur) return; st.trHidden[k] = !cur.hidden; writeTrendPrefs(); rerenderTrend(); },
  trMode: (el) => { const mode = el.dataset.mode === 'cumulative' ? 'cumulative' : 'daily'; if (mode === st.trMode) return; st.trMode = mode; writeTrendPrefs(); rerenderTrend(); },
  trRange: async (el) => {
    const d = normDays(el.dataset.days); if (d === st.trDays) return;
    st.trDays = d; writeTrendPrefs(); rerenderTrend();                        // redraw at once on the data we have
    try { const t = await api.get('/api/dashboard/trends?days=' + d); if (st && st.trDays === d) { D.trends = t; rerenderTrend(); } }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  custTg: (el) => { const k = el.dataset.key; D.prefs[k] = !D.prefs[k]; rerenderCustomise(); rerender('[data-block="hero"]', blockHero()); drawTrend(); rerender('[data-block="doit"]', blockDoIt()); savePrefs(); },
  snooze: (el) => {
    const id = el.dataset.id; const m = readSnoozes(); m[id] = nextMidnight(); writeSnoozes(m);
    const attn = rootEl.querySelector('[data-block="attn"]'); if (attn) attn.outerHTML = attentionRows();
    ui.toast(COPY.attention.snoozed, { undo: () => { const m2 = readSnoozes(); delete m2[id]; writeSnoozes(m2); const a2 = rootEl && rootEl.querySelector('[data-block="attn"]'); if (a2) a2.outerHTML = attentionRows(); } });
  },
  showAll: () => { st.showAll = !st.showAll; const attn = rootEl.querySelector('[data-block="attn"]'); if (attn) attn.outerHTML = attentionRows(); },
  nagAct: async (el) => {
    const id = el.dataset.id; el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/admin/nag/items/' + encodeURIComponent(id) + '/act');
      const item = D.nag.find(n => n.id === id); if (item) item.status = 'actioned';
      const attn = rootEl.querySelector('[data-block="attn"]'); if (attn) attn.outerHTML = attentionRows();
      ui.toast((r && r.message) || (item && item.action_kind === 'nudge_assignee' ? COPY.attention.nag.nudged : COPY.attention.nag.queued));
      chrome.refresh();
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  wrToggle: () => { st.wrOpen = !st.wrOpen; rerender('[data-block="weekly"]', blockWeekly()); },
  wrAll: () => { st.wrAll = !st.wrAll; rerender('[data-block="weekly"]', blockWeekly()); }
};
// DO IT NOW card alone (re-rendered after a CUSTOMISE tick)
function blockDoIt() {
  const shortcuts = shortcutDefs();
  return `<div data-block="doit" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.doItNow.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${COPY.doItNow.hint}</span></div>
          <div style="padding:14px 20px 16px;display:flex;flex-direction:column;gap:10px">
            ${shortcuts.map(s => `<a href="${s.href}" style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:${s.bg};border:1px solid ${s.bd};color:${s.fg};font:600 10.5px Inter,sans-serif;letter-spacing:.14em" data-hover="border-color:#201b16">${s.gold ? '<span style="width:6px;height:6px;background:#c9a962"></span>' : ''}${s.label}</a>`).join('\n            ')}
            ${!shortcuts.length ? `<span style="font-size:12.5px;color:#6d6459;font-style:italic">${COPY.doItNow.empty}</span>` : ''}
          </div>
        </div>`;
}

function startTimers() {
  // health pill: refresh every 5 minutes while Today is mounted (state subscription redraws the pill;
  // the footer no longer shows health — UXFIX-A1 #15)
  const off = state.subscribe((s, keys) => { if (keys.includes('health') && rootEl) { rerender('[data-block="pill"]', `<span data-block="pill">${pill()}</span>`); } });
  timers.push(off);
  const id = setInterval(() => health.refresh(), 5 * 60 * 1000);
  timers.push(() => clearInterval(id));
}

export default {
  title: 'Today',
  async render(root, ctx) {
    rootEl = root;
    // UXFIX-A1 #12 (2026-09-02): phone-order stylesheet (≤480px: attention + live counts first,
    // brochure content after) — same id-guarded injection as the other views' css links.
    if (!document.getElementById('mx-css-today')) {
      const l = document.createElement('link'); l.id = 'mx-css-today'; l.rel = 'stylesheet'; l.href = '/css/views/today.css'; document.head.appendChild(l);
    }
    const tp = readTrendPrefs();
    st = { custOpen: ctx.query.qa === 'customise', wrOpen: false, wrAll: false, showAll: false,
           trDays: tp.days, trMode: tp.mode, trHidden: tp.hidden };
    D = await load(st.trDays);
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    drawTrend();
    startTimers();
    health.refresh();
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (trOff) { trOff(); trOff = null; }
    if (trRO) { trRO.disconnect(); trRO = null; }
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
  }
};
