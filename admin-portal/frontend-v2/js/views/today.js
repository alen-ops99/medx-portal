// Source: Admin Home.dc.html (Today)
// Blocks (artboard order): "Greeting row" (greeting · todayLabel · ✎ CUSTOMISE · status pill) ›
// "Customise panel" › "Hero numbers" (open stat row + "REGISTRATIONS — LAST 30 DAYS" sparkline) ›
// "YOUR PROJECTS" › "NEEDS YOUR ATTENTION" + "DO IT NOW" › "COMING UP" + "TEAM TASKS" ›
// "THE WEEKLY READ" › "ADMIN:" footer row. The header is NOT in this file — js/chrome.js.
// Data: every number/label is a live read (see load()); FACTS only fills gaps and wording.
import cfg from '../config.js';
import { api } from '../api.js';
import { session, state } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, galaPriceNow, routeForSection } from '../facts.js';
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
    kGala: { k: 'GALA SEATS PAID', label: 'Gala seats paid', chase: (n, eb) => `${n} payment${n === 1 ? '' : 's'} to chase · early bird ends ${eb}`, clear: eb => `all seats paid · early bird ends ${eb}`, after: 'regular price now' },
    kMoney: { k: 'COLLECTED THIS YEAR', label: 'Collected this year', sub: n => `${n} Gala payment${n === 1 ? '' : 's'} · all of Money →` },
    locked: 'locked for you · ask Alen'
  },
  trends: { title: 'REGISTRATIONS — LAST 30 DAYS', scope: 'ALL EVENTS · CONFERENCE + GALA + BRIDGES + FORUM' },
  projects: {
    title: 'YOUR PROJECTS', sub: 'each one is a hub — everything for that project lives inside',
    plexus: { live: 'LIVE', closed: 'REGISTRATION CLOSED', title: FACTS.plexus.week, line: (r, cap, g) => `${r} registered of ${cap} · ${g} gala paid`, parts: FACTS.plexus.parts },
    accelerator: { title: FACTS.accelerator.short, opens: `OPENS ${FACTS.accelerator.opensShort.toUpperCase()}`, apps: n => n === 0 ? '0 applications yet' : `${n} application${n === 1 ? '' : 's'}`, hosts: n => `${n} host institution${n === 1 ? '' : 's'} ready` },
    forum: { title: FACTS.forum.name, eyebrow: 'BY INVITATION', line: (m, c) => `${m} member${m === 1 ? '' : 's'} · ${c} candidate${c === 1 ? '' : 's'}`, gathering: `gathering ${FACTS.forum.gathering.label}` },
    bridges: { title: FACTS.bridges.name, next: (city, when) => `NEXT · ${city.toUpperCase()} · ${when}`, none: 'NO DATE SET', line: (past, n, city) => `${past} past edition${past === 1 ? '' : 's'} · ${n} ${city} sign-up${n === 1 ? '' : 's'}`, venueSoon: 'venue announced soon' },
    more: { eyebrow: 'EVERYTHING ELSE', title: 'More tools', line: 'Website &amp; portal text, team access, health, audit, team library…' }
  },
  attention: {
    title: 'NEEDS YOUR ATTENTION', sub: 'everything urgent, in one list', empty: 'Nothing urgent. Enjoy the quiet.',
    foot: 'Snoozed rows return tomorrow — a row only disappears for good when the thing itself is resolved.',
    snooze: 'SNOOZE 1D', snoozeTitle: 'Hides for you until tomorrow — the row returns until the thing itself is resolved', snoozed: 'SNOOZED FOR 1 DAY', showAll: n => `SHOW ALL ${n} →`, showLess: 'SHOW FEWER',
    outbox: { title: (e, b) => `${e} email${e === 1 ? '' : 's'} in ${b} batch${b === 1 ? '' : 'es'} ${e === 1 ? 'is' : 'are'} waiting for your OK`, sub: s => `${s} — nothing sends without you`, cta: 'REVIEW & SEND' },
    messages: { title: n => `${n} member message${n === 1 ? ' is' : 's are'} waiting`, sub: 'Your reply lands in their portal inbox', cta: 'REPLY' },
    tasks: { title: n => `${n} overdue task${n === 1 ? '' : 's'}`, sub: d => `Oldest is ${d} day${d === 1 ? '' : 's'} — one shared list with Calendar`, cta: 'OPEN TASKS' },
    nag: {
      galaSub: (date, days) => `Reserved ${date} · ${days} day${days === 1 ? '' : 's'} waiting · reminder queues to the Outbox for your OK`,
      actioned: 'Reminder is in the Outbox — approve it there to send', inOutbox: 'IN OUTBOX →',
      subs: { content_plan_missing: 'Plan next month with the content planner — one click opens it', monthly_digest: 'Review the digest, then approve it in the Outbox', forum_consideration: who => `${who} asked to be considered — review in the Forum hub`, forum_candidate_escalated: who => `${who} needs a decision — Forum hub`, task_overdue: 'One shared list with Calendar', task_due_soon: 'Due soon — one shared list with Calendar' },
      ctas: { payment_reminder: 'CHASE PAYMENT', dietary_reminder: 'SEND REMINDER', nudge_assignee: 'NUDGE', digest_review: 'REVIEW DIGEST', open_link: 'OPEN', default: 'OPEN' },
      queued: 'REMINDER QUEUED — APPROVE IT IN THE OUTBOX', nudged: 'NUDGE QUEUED'
    }
  },
  doItNow: { title: 'DO IT NOW', hint: 'edit via ✎ CUSTOMISE', empty: 'No shortcuts picked — add some via ✎ CUSTOMISE.' },
  shortcuts: {
    sScan: { label: 'REHEARSE THE SCANNER', href: '/event-day', gold: true, pick: 'Rehearse the scanner' },
    sEmail: { label: 'EMAIL PLEXUS REGISTRANTS', href: '/inbox/email', pick: 'Email Plexus registrants' },
    sNews: { label: 'POST NEWS TO MEMBERS', href: '/inbox/announcements', pick: 'Post news to members' },
    sFind: { label: 'FIND A PERSON', href: '/people', pick: 'Find a person' }
  },
  comingUp: { title: 'COMING UP', full: 'FULL CALENDAR →', empty: 'Nothing on the year board yet — add dates in Calendar.', earlyBird: (price, days) => `Gala early-bird ends — price moves to ${price} · ${days} day${days === 1 ? '' : 's'} away` },
  tasks: { title: 'TEAM TASKS', add: '+ ADD TASK', placeholder: 'What needs doing?', addBtn: 'ADD', empty: 'All clear — nothing open.', all: 'ALL TASKS →', tickTitle: 'Tick = done for the whole team — undo appears for a few seconds', done: 'DONE — REMOVED FOR THE WHOLE TEAM', added: 'TASK ADDED — VISIBLE TO THE WHOLE TEAM', typeFirst: 'TYPE THE TASK FIRST', team: 'TEAM', overdue: d => `${d}D OVERDUE`, today: 'DUE TODAY', due: d => `DUE ${d}` },
  weekly: {
    title: 'THE WEEKLY READ', read: 'READ THIS WEEK →', hide: 'HIDE', open: 'OPEN →', all: n => `ALL ${n} LINES →`, fewer: 'TOP LINE PER ADVISOR',
    seats: { CMO: { tag: 'GROW', color: '#9b1b22' }, CFO: { tag: 'MONEY', color: '#b7791f' }, COO: { tag: 'OPS', color: '#2f7d4f' }, CLO: { tag: 'LEGAL', color: '#6d6459' } },
    order: ['CFO', 'CMO', 'COO', 'CLO'],
    foot: week => `Compiled every week by four AI advisors — Growth, Money, Ops, Legal — from your live numbers. Advice only; they never change anything.${week ? ' · ' + week : ''}`,
    sample: 'SAMPLE LINES — the advisors have not run on real data yet',
    gate: 'No read yet — the four advisors compile it every Friday once ANTHROPIC_API_KEY is set on the admin service.', gateCta: 'HEALTH CHECKS →',
    locked: 'The Weekly Read needs Executive Suite access — ask Alen.'
  },
  footer: { admin: 'ADMIN:', health: 'SYSTEM HEALTH', audit: 'AUDIT LOG', member: 'VIEW MEMBER PORTAL ↗' }
};
const KPI_KEYS = ['kDays', 'kConf', 'kGala', 'kMoney'];
const SC_KEYS = ['sScan', 'sEmail', 'sNews', 'sFind'];
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
async function load() {
  const r = await api.settle({
    me: api.get('/api/auth/me'),
    conf: api.get('/api/conferences/active', { noAuth: true }),
    summary: api.get('/api/dashboard/summary'),
    trends: api.get('/api/dashboard/trends'),
    pstats: api.get('/api/dashboard/portal-stats'),
    gala: api.get('/api/admin/gala/registrations'),
    galaSettings: api.get('/api/admin/gala/settings'),
    finance: api.get('/api/finance/dashboard'),
    nag: api.get('/api/admin/nag/items'),
    tasks: api.get('/api/admin/tasks'),
    outbox: api.get('/api/admin/outbox?status=pending_approval'),
    advisors: api.get('/api/admin/advisors/latest'),
    prefs: api.get('/api/dashboard-preferences/' + PREFS_SECTION),
    calendar: api.get('/api/admin/year-calendar'),
    status: api.get('/api/public/status', { noAuth: true }),
    bridges: api.get('/api/bridges/events'),
    forumCand: api.get('/api/admin/forum/candidates?status=all'),
    institutions: api.get('/api/accelerator/institutions', { noAuth: true }),
    team: api.get('/api/team')
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
  const prefs = {}; KPI_KEYS.concat(SC_KEYS).forEach(k => { prefs[k] = true; });
  (Array.isArray(r.prefs) ? r.prefs : []).forEach(row => { if (row && row.card_id in prefs) prefs[row.card_id] = !!Number(row.is_visible); });
  const status = {}; (((r.status || {}).projects) || []).forEach(p => { status[p.project_key] = p; });
  const bridges = Array.isArray(r.bridges) ? r.bridges : [];
  const dated = bridges.filter(b => b.event_date && /^\d{4}-\d{2}-\d{2}/.test(b.event_date)).map(b => Object.assign({}, b, { d: String(b.event_date).slice(0, 10) }));
  const nextBridges = dated.filter(b => b.d >= today).sort((a, b) => a.d.localeCompare(b.d))[0] || null;
  const tasks = (Array.isArray(r.tasks) ? r.tasks : []).filter(t => t.status !== 'done');
  return {
    errors: r.$errors, me: session.user || r.me || {}, conf, summary: r.summary, trends: r.trends, pstats: r.pstats, finance: r.finance, galaSettings: gs,
    gala: { rows: galaRows, paid, toChase, price, ebDeadline, ebDays: fmt.daysUntil(ebDeadline), collected: paid.reduce((n, g) => n + (Number(g.amount_paid) || 0), 0), owed: toChase.length * price },
    nag: (r.nag && Array.isArray(r.nag.items)) ? r.nag.items : [],
    tasks, team: Array.isArray(r.team) ? r.team : [],
    outbox: (r.outbox && Array.isArray(r.outbox.batches)) ? r.outbox.batches : [],
    advisors: r.advisors, prefs, status, bridges: { all: bridges, dated, next: nextBridges, past: dated.filter(b => b.d < today).length },
    calendar: Array.isArray(r.calendar) ? r.calendar : [],
    forumCandidates: r.forumCand && r.forumCand.counts ? Number(r.forumCand.counts.all || 0) : 0,
    institutions: Array.isArray(r.institutions) ? r.institutions.filter(i => Number(i.is_active == null ? 1 : i.is_active)).length : null,
    plexusDays: Math.max(0, fmt.daysUntil(conf.start_date || FACTS.plexus.start) || 0),
    cap: Number(conf.max_capacity) || FACTS.plexus.cap
  };
}

// ---------------------------------------------------------------- derived lists
function kpiDefs() {
  const c = COPY.kpi, p = D.prefs, g = D.gala, conf = D.conf;
  const regs = D.summary ? Number(D.summary.plexus.registrations || 0) : (D.pstats ? Number(D.pstats.plexus.registrations || 0) : null);
  const eb = fmt.dayShort(g.ebDeadline);
  const galaLocked = isLocked('gala');
  const galaSub = galaLocked ? c.locked : g.ebDays > 0 ? (g.toChase.length ? c.kGala.chase(g.toChase.length, eb) : c.kGala.clear(eb)) : (g.toChase.length ? `${g.toChase.length} payment${g.toChase.length === 1 ? '' : 's'} to chase · ${c.kGala.after}` : c.kGala.after);
  const collected = isLocked('finance') && isLocked('gala') ? null : g.collected + (D.pstats && D.pstats.plexus ? Number(D.pstats.plexus.revenue || 0) : 0);
  return [
    { on: p.kDays, k: c.kDays.k, v: String(D.plexusDays), sub: `${fmt.longRange(conf.start_date || FACTS.plexus.start, conf.end_date || FACTS.plexus.end)} · ${FACTS.plexus.venue}, ${conf.venue_city || FACTS.plexus.city}`, subColor: '#6d6459', href: '/projects/plexus' },
    { on: p.kConf, k: c.kConf.k, v: regs == null ? '—' : String(regs), sub: c.kConf.sub(D.cap), subColor: '#6d6459', href: '/registrations' },
    { on: p.kGala, k: c.kGala.k, v: galaLocked ? '—' : String(g.paid.length), sub: galaSub, subColor: !galaLocked && g.toChase.length ? '#9b1b22' : '#6d6459', href: '/gala' },
    { on: p.kMoney, k: c.kMoney.k, v: collected == null ? '—' : fmt.eur(collected), sub: collected == null ? c.locked : c.kMoney.sub(g.paid.length), subColor: '#6d6459', href: '/money' }
  ].filter(k => k.on);
}
function shortcutDefs() {
  return SC_KEYS.filter(k => D.prefs[k]).map(k => { const s = COPY.shortcuts[k]; return s.gold
    ? { label: s.label, href: s.href, gold: true, bg: '#201b16', bd: '#201b16', fg: '#f6f2ea' }
    : { label: s.label, href: s.href, gold: false, bg: 'transparent', bd: 'rgba(32,27,22,.2)', fg: '#201b16' }; });
}
function trendSeries() {
  const t = D.trends || {}; const map = {};
  ['plexus', 'accelerator', 'events'].forEach(k => (t[k] || []).forEach(r => { if (r && r.date) map[String(r.date).slice(0, 10)] = (map[String(r.date).slice(0, 10)] || 0) + Number(r.count || 0); }));
  const pts = []; const now = new Date();
  for (let i = 29; i >= 0; i--) { const d = new Date(now.getTime() - i * 86400000); pts.push(map[fmt.ymd(d)] || 0); }
  const total = pts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...pts);
  const top = [2, 4, 6, 8, 10, 20, 30, 40, 50, 100, 200, 500, 1000, 2000, 5000].find(n => n >= max) || Math.ceil(max / 1000) * 1000;
  const coords = pts.map((v, i) => [(i / 29 * 300).toFixed(1), (45 - v / top * 38).toFixed(1)]);
  return { pts, total, top, coords, line: coords.map(c => c.join(',')).join(' '), area: 'M' + coords.map(c => c.join(',')).join(' L') + ' L300,45 L0,45 Z' };
}
function overdueTasks() { const today = fmt.ymd(new Date()); return D.tasks.filter(t => t.due_date && String(t.due_date).trim() && fmt.ymd(t.due_date) < today); }
function attentionItems() {
  const a = COPY.attention, items = [];
  if (D.outbox.length) { const emails = D.outbox.reduce((n, b) => n + Number(b.count || 0), 0); const subjects = D.outbox.map(b => b.sample && b.sample.subject).filter(Boolean).slice(0, 2).join(' · '); items.push({ id: 'outbox', dot: '#c9a962', title: a.outbox.title(emails, D.outbox.length), sub: a.outbox.sub(subjects || fmt.plural(D.outbox.length, 'batch', 'batches')), cta: a.outbox.cta, href: '/inbox/outbox' }); }
  const unread = D.pstats && D.pstats.pending ? Number(D.pstats.pending.unreadMessages || 0) : 0;
  if (unread > 0) items.push({ id: 'messages', dot: '#c9a962', title: a.messages.title(unread), sub: a.messages.sub, cta: a.messages.cta, href: '/inbox/messages' });
  D.nag.forEach(n => {
    const p = n.action_payload || {}; const who = p.who || p.name || '';
    let sub = '';
    if (n.kind === 'gala_unpaid') { const g = D.gala.rows.find(x => x.id === (p.gala_id || n.subject_id)); const when = g ? fmt.longRange(g.created_at) : ''; const days = g ? Math.max(0, fmt.daysSince(g.created_at) || 0) : null; sub = g ? a.nag.galaSub(when, days) : 'Reserved · reminder queues to the Outbox for your OK'; }
    else { const s = a.nag.subs[n.kind]; sub = typeof s === 'function' ? s(who || 'A member') : (s || (who ? who + ' · ' : '') + String(n.kind || '').replace(/_/g, ' ')); }
    const actioned = n.status === 'actioned';
    const act = ['payment_reminder', 'dietary_reminder', 'nudge_assignee'].includes(n.action_kind);
    const href = n.action_kind === 'digest_review' ? routeForSection(p.open_section || 'newsletter', '/inbox/newsletter') : /^task_/.test(n.kind) ? '/calendar/tasks' : n.kind === 'gala_unpaid' ? '/gala' : routeForSection(p.open_section || n.kind, '/today');
    items.push({ id: n.id, dot: actioned ? '#c9a962' : (NAG_DOT[n.kind] || '#c9a962'), title: String(n.title || '').replace(/:\s+/, ' — '), sub: actioned ? a.nag.actioned : sub,
      cta: actioned ? a.nag.inOutbox : (a.nag.ctas[n.action_kind] || a.nag.ctas.default), href: actioned ? '/inbox/outbox' : href, act: !actioned && act, nagId: n.id });
  });
  const od = overdueTasks();
  if (od.length) { const oldest = Math.max(...od.map(t => fmt.daysSince(t.due_date) || 0)); items.push({ id: 'tasks', dot: '#9b1b22', title: a.tasks.title(od.length), sub: a.tasks.sub(oldest), cta: a.tasks.cta, href: '/calendar/tasks' }); }
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
function taskMeta(t) {
  const who = t.assignee_name ? String(t.assignee_name).split(/\s+/)[0].toUpperCase() : COPY.tasks.team;
  if (!t.due_date || !String(t.due_date).trim()) return { meta: who, dueColor: '#6d6459' };
  const diff = fmt.daysUntil(t.due_date);
  if (diff < 0) return { meta: who + ' · ' + COPY.tasks.overdue(Math.abs(diff)), dueColor: '#9b1b22' };
  if (diff === 0) return { meta: who + ' · ' + COPY.tasks.today, dueColor: '#b7791f' };
  return { meta: who + ' · ' + COPY.tasks.due(fmt.dayLabel(t.due_date)), dueColor: '#6d6459' };
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
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
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
  const kpis = kpiDefs(); const t = trendSeries();
  return `
    <!-- dc: Admin Home.dc.html › "Hero numbers" -->
    <div data-block="hero" style="border:1px solid rgba(32,27,22,.14);background:#fff">
    <div class="mx-kpi" style="display:grid;grid-template-columns:repeat(${Math.max(1, kpis.length)},1fr)">
      ${kpis.map(k => `
        <a href="${k.href}" style="padding:18px 22px;border-right:1px solid rgba(32,27,22,.12);display:block;color:#201b16" data-hover="background:#fdfbf6;color:#201b16">
          <div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${k.k}</div>
          <div class="mx-display-34" style="font-family:Fraunces,serif;font-size:34px;margin-top:4px">${esc(k.v)}</div>
          <div style="font-size:11.5px;color:${k.subColor}">${esc(k.sub)}</div>
        </a>`).join('')}
      ${!kpis.length ? `<div style="padding:18px 22px;font-size:12.5px;color:#6d6459">${COPY.doItNow.empty.replace('shortcuts', 'numbers')}</div>` : ''}
    </div>
    <div style="border-top:1px solid rgba(32,27,22,.12);padding:14px 22px 16px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${COPY.trends.title}</span>
        <span style="font-family:Fraunces,serif;font-size:18px">${D.trends ? t.total : '—'}</span>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#6d6459">${COPY.trends.scope}</span>
        <div style="flex:1"></div>
        <span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459">${fmt.sparkRange(30)}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:stretch">
        <div style="display:flex;flex-direction:column;justify-content:space-between;width:20px;flex:none;font:600 8.5px Inter,sans-serif;color:#6d6459;text-align:right;padding:1px 0 3px"><span>${t.top}</span><span>${t.top / 2}</span><span>0</span></div>
        <svg viewBox="0 0 300 46" style="flex:1;min-width:0;height:54px;display:block" preserveAspectRatio="none" aria-label="Registrations per day, last 30 days">
          <defs><linearGradient id="regfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(155,27,34,.16)"></stop><stop offset="1" stop-color="rgba(155,27,34,0)"></stop></linearGradient></defs>
          <line x1="0" y1="5" x2="300" y2="5" stroke="rgba(32,27,22,.06)" stroke-width="1"></line>
          <line x1="0" y1="25" x2="300" y2="25" stroke="rgba(32,27,22,.08)" stroke-width="1"></line>
          <path d="${t.area}" fill="url(#regfill)" stroke="none"></path>
          <polyline points="${t.line}" fill="none" stroke="#9b1b22" stroke-width="1.8"></polyline>
          <line x1="0" y1="45" x2="300" y2="45" stroke="rgba(32,27,22,.18)" stroke-width="1"></line>
        </svg>
      </div>
    </div>
    </div>
    <!-- /dc -->`;
}
function blockProjects() {
  const c = COPY.projects, s = D.status, g = D.gala, conf = D.conf;
  const regs = D.summary ? Number(D.summary.plexus.registrations || 0) : (D.pstats ? Number(D.pstats.plexus.registrations || 0) : 0);
  const apps = D.summary ? Number(D.summary.accelerator.applications || 0) : (D.pstats ? Number(D.pstats.accelerator.applications || 0) : 0);
  const members = D.summary ? Number(D.summary.forum.members || 0) : 0;
  const accEl = s.accelerator; const accLabel = accEl ? fmt.upper(fmt.detail(accEl.status_label)) : c.accelerator.opens;
  const accColor = accEl && accEl.status_kind === 'open' ? '#9b1b22' : accEl && accEl.status_kind === 'soon' ? '#b7791f' : '#b7791f';
  const nb = D.bridges.next; const nbCity = nb ? nb.city : FACTS.bridges.next.city;
  const nbWhen = nb ? fmt.dayLabel(nb.d).split(' ')[0] + ' ' + nb.d.slice(0, 4) : FACTS.bridges.next.short.toUpperCase();
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
        ${card('/projects/plexus', true, Number(conf.registration_open) ? '#9b1b22' : '#6d6459', (Number(conf.registration_open) || !conf.id ? c.plexus.live : c.plexus.closed) + ' · ' + esc(fmt.rangeLabel(conf.start_date || FACTS.plexus.start, conf.end_date || FACTS.plexus.end)), esc(c.plexus.title), esc(c.plexus.line(regs, D.cap, isLocked('gala') ? '—' : g.paid.length)), esc(c.plexus.parts))}
        ${card('/projects/accelerator', false, accColor, esc(accLabel), esc(c.accelerator.title), esc(c.accelerator.apps(apps)), D.institutions == null ? esc(FACTS.accelerator.hosts.length + ' host institutions (canonical)') : esc(c.accelerator.hosts(D.institutions)))}
        ${card('/projects/forum', false, '#6d6459', esc(s.forum ? fmt.upper(s.forum.status_label) : c.forum.eyebrow), esc(c.forum.title), esc(c.forum.line(members, D.forumCandidates)), esc(c.forum.gathering))}
        ${card('/projects/bridges', false, nb ? '#2f7d4f' : '#b7791f', nb ? esc(c.bridges.next(nbCity, nbWhen)) : c.bridges.none, esc(c.bridges.title), esc(c.bridges.line(D.bridges.past, nb ? Number(nb.registration_count || 0) : 0, nbCity)), esc((nb ? fmt.rangeLabel(nb.d) : FACTS.bridges.next.label) + ' · ' + nbVenue))}
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
        <div style="display:flex;gap:18px;padding:12px 20px;align-items:baseline">
          <span style="font-size:11.5px;color:#6d6459">${a.foot}</span>
          <div style="flex:1"></div>
          ${items.length > TOP_ROWS ? `<span data-act="showAll" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#9b1b22;cursor:pointer;white-space:nowrap">${st.showAll ? a.showLess : a.showAll(items.length)}</span>` : ''}
        </div>
      </div>`;
}
function blockAttention() {
  const shortcuts = shortcutDefs();
  return `
    <!-- dc: Admin Home.dc.html › "NEEDS YOUR ATTENTION" + "DO IT NOW" -->
    <div class="mx-two" style="display:grid;grid-template-columns:1.6fr 1fr;gap:22px;align-items:start">
      <div style="border:1px solid rgba(32,27,22,.14);background:#fff">${attentionRows()}</div>
      <div style="display:flex;flex-direction:column;gap:22px">
        <div data-block="doit" style="border:1px solid rgba(32,27,22,.14);background:#fff">
          <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.doItNow.title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${COPY.doItNow.hint}</span></div>
          <div style="padding:14px 20px 16px;display:flex;flex-direction:column;gap:10px">
            ${shortcuts.map(s => `<a href="${s.href}" style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:${s.bg};border:1px solid ${s.bd};color:${s.fg};font:600 10.5px Inter,sans-serif;letter-spacing:.14em" data-hover="border-color:#201b16">${s.gold ? '<span style="width:6px;height:6px;background:#c9a962"></span>' : ''}${s.label}</a>`).join('\n            ')}
            ${!shortcuts.length ? `<span style="font-size:12.5px;color:#6d6459;font-style:italic">${COPY.doItNow.empty}</span>` : ''}
          </div>
        </div>
      </div>
    </div>
    <!-- /dc -->`;
}
function tasksCard() {
  const c = COPY.tasks; const open = D.tasks; const shown = open.slice(0, TOP_ROWS);
  const who = D.team.length ? D.team : [];
  return `<div data-block="tasks" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:10px"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${c.title}</span><span style="min-width:18px;height:18px;padding:0 5px;background:#201b16;color:#fff;font:600 11px Inter,sans-serif;display:inline-flex;align-items:center;justify-content:center">${open.length}</span><div style="flex:1"></div><span data-act="addToggle" style="font:600 9px Inter,sans-serif;letter-spacing:.13em;color:#9b1b22;cursor:pointer">${c.add}</span></div>
        ${st.adding ? `
        <div style="display:flex;gap:8px;align-items:center;padding:6px 0;flex-wrap:wrap">
          <input data-role="taskDraft" value="${esc(st.taskDraft)}" placeholder="${esc(c.placeholder)}" aria-label="New task" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font-size:12.5px;color:#201b16;flex:1;min-width:140px">
          <select data-role="taskWho" aria-label="Assignee" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px;font-size:12px;color:#201b16">
            <option value="">${c.team}</option>${who.map(m => `<option value="${esc(m.id)}"${st.taskWho === m.id ? ' selected' : ''}>${esc(String(m.name || '').split(/\s+/)[0].toUpperCase())}</option>`).join('')}
          </select>
          <span data-act="addTask" style="padding:8px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${c.addBtn}</span>
        </div>` : ''}
        ${shown.map(t => { const m = taskMeta(t); return `
        <div data-task="${esc(t.id)}" style="display:flex;gap:11px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(32,27,22,.08)">
          <span data-act="taskDone" data-id="${esc(t.id)}" role="checkbox" aria-checked="false" aria-label="Done" title="${esc(c.tickTitle)}" style="width:13px;height:13px;border:1px solid rgba(32,27,22,.35);flex:none;cursor:pointer" data-hover="border-color:#9b1b22"></span>
          <span style="font-size:12.5px;flex:1;min-width:0">${esc(t.title)}</span>
          <span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:${m.dueColor};white-space:nowrap">${esc(m.meta)}</span>
        </div>`; }).join('')}
        ${!open.length ? `<div style="padding:8px 0;font-size:12.5px;color:#6d6459;font-style:italic">${c.empty}</div>` : ''}
        <a href="/calendar/tasks" style="font:600 10px Inter,sans-serif;letter-spacing:.14em">${c.all}${open.length > TOP_ROWS ? ' · ' + open.length : ''}</a>
      </div>`;
}
function blockComingTasks() {
  const rows = comingUp();
  return `
    <!-- dc: Admin Home.dc.html › "COMING UP" + "TEAM TASKS" -->
    <div class="mx-two" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
      <div data-block="coming" style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:8px">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.comingUp.title}</span>
        ${rows.map((r, i) => `<div style="display:flex;gap:12px;align-items:baseline;padding:8px 0;${i < rows.length - 1 ? 'border-bottom:1px solid rgba(32,27,22,.08)' : ''}"><span style="font:600 10px Inter,sans-serif;letter-spacing:.12em;color:${r.color};white-space:nowrap">${esc(r.label)}</span><span style="font-size:12.5px;flex:1">${esc(r.text)}</span></div>`).join('')}
        ${!rows.length ? `<div style="padding:8px 0;font-size:12.5px;color:#6d6459;font-style:italic">${isLocked('calendar') ? COPY.kpi.locked : COPY.comingUp.empty}</div>` : ''}
        <a href="/calendar" style="font:600 10px Inter,sans-serif;letter-spacing:.14em">${COPY.comingUp.full}</a>
      </div>
      ${tasksCard()}
    </div>
    <!-- /dc -->`;
}
function blockWeekly() {
  const w = COPY.weekly; const r = weeklyRead();
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
  const h = state.get().health || { label: 'CHECKING…', color: '#6d6459' };
  return `
    <!-- dc: Admin Home.dc.html › "ADMIN:" footer row -->
    <div data-block="footer" style="display:flex;gap:20px;align-items:center;padding-top:2px;flex-wrap:wrap">
      <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.15em;color:#6d6459">${COPY.footer.admin}</span>
      <a href="/settings/health" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:${h.color}" data-hover="color:#201b16">${COPY.footer.health} · ${esc(h.label)}</a>
      <a href="/settings/audit" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459" data-hover="color:#201b16">${COPY.footer.audit}</a>
      <a href="${esc(cfg.memberPortalUrl || '/')}" target="_blank" rel="noopener" style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459" data-hover="color:#201b16">${COPY.footer.member}</a>
    </div>
    <!-- /dc -->`;
}
function template() {
  return `
<div data-screen-label="Admin Home" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:26px">
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
  const cards = KPI_KEYS.concat(SC_KEYS).map((k, i) => ({ card_id: k, is_visible: !!D.prefs[k], sort_order: i }));
  try { await api.put('/api/dashboard-preferences/' + PREFS_SECTION, { cards }); ui.toast(COPY.customise.saved); }
  catch (e) { ui.toast(COPY.customise.failed, { kind: 'error' }); }
}
async function reloadTasks() {
  try { const rows = await api.get('/api/admin/tasks'); D.tasks = (Array.isArray(rows) ? rows : []).filter(t => t.status !== 'done'); } catch (e) {}
  rerender('[data-block="tasks"]', tasksCard());
  const attn = rootEl.querySelector('[data-block="attn"]'); if (attn) attn.outerHTML = attentionRows();
}

const handlers = {
  custToggle: () => { st.custOpen = !st.custOpen; rerenderCustomise(); },
  custTg: (el) => { const k = el.dataset.key; D.prefs[k] = !D.prefs[k]; rerenderCustomise(); rerender('[data-block="hero"]', blockHero()); rerender('[data-block="doit"]', blockDoIt()); savePrefs(); },
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
  addToggle: () => { st.adding = !st.adding; rerender('[data-block="tasks"]', tasksCard()); if (st.adding) { const i = rootEl.querySelector('[data-role="taskDraft"]'); if (i) i.focus(); } },
  addTask: async (el) => {
    const input = rootEl.querySelector('[data-role="taskDraft"]'); const sel = rootEl.querySelector('[data-role="taskWho"]');
    const title = input ? input.value.trim() : '';
    if (!title) { ui.toast(COPY.tasks.typeFirst); return; }
    st.taskWho = sel ? sel.value : '';
    const d7 = new Date(); d7.setDate(d7.getDate() + 7);
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/admin/tasks', { title, assigned_to: st.taskWho || null, due_date: fmt.ymd(d7), project: 'general' });
      st.adding = false; st.taskDraft = '';
      await reloadTasks(); ui.toast(COPY.tasks.added);
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  taskDone: async (el) => {
    const id = el.dataset.id; const t = D.tasks.find(x => x.id === id); if (!t) return;
    el.setAttribute('aria-disabled', 'true');
    try {
      await api.put('/api/admin/tasks/' + encodeURIComponent(id), { done: true });
      D.tasks = D.tasks.filter(x => x.id !== id);
      rerender('[data-block="tasks"]', tasksCard()); const attn = rootEl.querySelector('[data-block="attn"]'); if (attn) attn.outerHTML = attentionRows();
      ui.toast(COPY.tasks.done, { undo: async () => { try { await api.put('/api/admin/tasks/' + encodeURIComponent(id), { done: false }); } catch (e) {} if (rootEl) reloadTasks(); } });
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
  // health pill: refresh every 5 minutes while Today is mounted (state subscription redraws the pill + footer)
  const off = state.subscribe((s, keys) => { if (keys.includes('health') && rootEl) { rerender('[data-block="pill"]', `<span data-block="pill">${pill()}</span>`); rerender('[data-block="footer"]', blockFooter()); } });
  timers.push(off);
  const id = setInterval(() => health.refresh(), 5 * 60 * 1000);
  timers.push(() => clearInterval(id));
}

export default {
  title: 'Today',
  async render(root, ctx) {
    rootEl = root;
    st = { custOpen: ctx.query.qa === 'customise', wrOpen: false, wrAll: false, showAll: false, adding: false, taskDraft: '', taskWho: '' };
    D = await load();
    if (rootEl !== root) return; // navigated away while loading
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    startTimers();
    health.refresh();
    chrome.refresh();
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null;
  }
};
