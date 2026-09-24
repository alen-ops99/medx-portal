// js/views/live.js — PLEXUS WEEK LIVE, the guest-facing event app (docs/EVENT-APP-BRIEF.md).
// The thing a guest holds in their hand all evening: the program of the event they are at,
// one big ATTENDING toggle per session, their own schedule, the speakers, the practical facts.
//
// Routes:  /live/:token?   public — no login wall (layout 'bare'). The token is the live token minted
//                          by the ticket pages / Boston me page / ticket emails (shared/live-program.js:
//                          HMAC(JWT_SECRET,'live:<kind>:<id>')[:32].<kind>.<id>). No token → the event
//                          catalogue read-only (a signed-in member is resolved through the 'user' token).
//          /app/live       a signed-in member (route auth:true) → the literal token 'user' + Bearer.
// API (user-portal/backend/v2/live.js): GET /api/live/events · GET /api/live/:key/program?since= ·
//   GET /api/live/me/:token · POST /api/live/me/:token/attend · GET /api/live/me/:token/schedule.ics ·
//   GET /api/live/:key/sessions/:id.ics
// No artboard exists for this screen — it is built from the tokens (css/views/live.css, `lv-` classes),
// dark-on-cream like the ticket pages, base 16 px, 44 px targets, one 720 px column on desktop.
//
// Offline-ish: the last program per event is cached in localStorage ('live:program:<key>') and painted
// before the network answers; attendance is cached per token and reconciled with the server's map.
// Live: the current event's program is polled every 60 s (and when the tab regains focus) with ?since=;
// a change re-renders in place and toasts "Program updated".
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc } from '../ui.js';
import { FACTS } from '../facts.js';
import router from '../router.js';

export const SOURCE = 'no artboard — Plexus Week Live, built from tokens (2026-09-22)';

export const COPY = {
  eyebrow: 'PLEXUS WEEK LIVE',
  loading: 'Loading the program…',
  tabs: { program: 'PROGRAM', schedule: 'MY SCHEDULE', speakers: 'SPEAKERS', info: 'INFO' },
  portal: '← PORTAL',
  party: n => `party of ${n}`,
  switcher: { all: 'ALL EVENTS', mine: 'MY EVENTS', readOnly: 'READ-ONLY' },
  now: {
    now: 'NOW', next: 'NEXT', endsIn: m => `ends in ${m}`, late: 'until late', inMin: m => `in ${m}`,
    day: (n, d) => `Day ${n} · ${d}`,
    startsAt: (t, doors) => `Starts at ${t}${doors ? ` · doors ${doors}` : ''}`,
    startsOn: (d, t) => `${d}${t ? ` · ${t}` : ''}`, ended: d => `This event has ended · ${d}`,
    over: 'That was the last session — thank you for coming.', tbd: 'Times to be confirmed'
  },
  slots: { title: 'YOUR SLOTS', sub: 'Where you speak', speaking: 'SPEAKING' },
  att: { on: 'IN MY SCHEDULE', off: 'ADD TO MY SCHEDULE', speaking: 'YOU SPEAK HERE', meetup: 'YOUR PLACE IS HELD', tbd: 'TBD', over: 'OVERLAPS', going: n => `${n} going`, seats: n => `${n} seats`,
    ticket: 'Open this from your ticket link to build your schedule.',
    notHeld: 'This event is not on your ticket — the program is shown read-only.',
    failed: 'That did not save — check the connection and tap again.' },
  program: { empty: 'The program is being written — check back soon.', dayEmpty: 'The program for this day is being written — check back soon.', tbdDay: 'Date to be confirmed' },
  schedule: {
    emptyLine: 'Nothing here yet.', emptyWhy: 'Everything you registered for appears here on its own — and anything you add from the program.',
    auto: 'Built from your registration — tap a session off if you will skip it.',
    ics: 'ADD TO CALENDAR', icsDay: 'ADD DAY TO CALENDAR', conflict: 'Two of your sessions overlap.',
    icsNone: 'Times are still to be confirmed — nothing to add to a calendar yet.', icsDone: 'Calendar file downloaded — open it to add the sessions.'
  },
  speakers: { empty: 'Speakers are announced closer to the event.', sessions: 'SESSIONS', tbdSpeaker: 'To be announced' },
  info: {
    venue: 'VENUE', when: 'WHEN', dress: 'DRESS CODE', contact: 'CONTACT', wifi: 'WI-FI', apple: 'Apple Maps →', google: 'Google Maps →',
    tentative: 'Date and venue tentative — confirmed by email.', timesTbd: 'Exact times to be confirmed.',
    tz: tz => tz === 'America/New_York' ? 'Boston time' : 'Zagreb time'
  },
  updated: 'Program updated', offline: 'Offline — showing the last program you loaded.',
  offlineFoot: t => `Offline · showing the program${t ? ` from ${t}` : ' you loaded last'}`,
  badLink: 'That link is not one of ours — open the app from your ticket.',
  noEvents: 'No tickets are linked to this account yet — register for Plexus Week and your events appear here.',
  noTickets: { line: 'No tickets on this account yet.', why: 'Register for Plexus Week and your events, and their sessions, appear here on their own.', cta: 'REGISTER FOR PLEXUS WEEK →' },
  sheet: { close: 'CLOSE', ics: 'ADD TO CALENDAR →', where: 'WHERE', about: 'ABOUT', with: 'WITH' },
  foot: (t) => `Med&X · Plexus Week Live${t ? ` · updated ${t}` : ''}`, refresh: 'REFRESH'
};

// ---- constants ---------------------------------------------------------------------------------
const TABS = ['program', 'schedule', 'speakers', 'info'];
const POLL_MS = 60 * 1000;
const TICK_MS = 30 * 1000;
const LIGHT = new Set(['break', 'lunch', 'networking']);          // visually lighter cards, still toggleable
const KIND_LABEL = { keynote: 'KEYNOTE', talk: 'TALK', panel: 'PANEL', presentations: 'PRESENTATIONS', break: 'BREAK', lunch: 'LUNCH', dinner: 'DINNER', networking: 'NETWORKING', reception: 'RECEPTION', ceremony: 'CEREMONY', other: 'SESSION' };
// dress code per event — from the FACTS (the Gala's from gala_settings when the event row carries one)
const DRESS = { gala: FACTS.gala.dress, conference: 'Business casual', bridges: 'Business casual', boston: 'Business attire' };
const CONTACT = { name: 'Laura Rodman', email: 'laura.rodman@medx.hr' };
const LS = { program: k => 'live:program:' + k, att: t => 'live:attendance:' + t, event: t => 'live:event:' + t, tab: 'live:tab',
  me: k => 'live:me:' + k, events: 'live:events' };
// the person behind a token, cached so a returning guest's first paint is already theirs (name, chips, ON
// toggles) instead of the anonymous state for a second. A signed-in member's cache is keyed by the account,
// so a shared browser never shows the previous member; the email and the record ids are never stored.
const meKey = tok => tok === 'user' ? (session.user && session.user.id ? 'user:' + session.user.id : null) : tok;
const slimPerson = p => ({ first_name: p.first_name, is_speaker: !!p.is_speaker, speaker_session_ids: p.speaker_session_ids || [], events: p.events || [], party: p.party || {} });
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

const ICON_X = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 1.5l11 11M12.5 1.5l-11 11" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const ICON_BACK = '<svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true"><path d="M15 7H2M7.5 1.5 2 7l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const INK = '<i class="lv-tab-ink" aria-hidden="true"></i>';                 // the sliding tab underline

// ---- state -------------------------------------------------------------------------------------
let S = null, rootEl = null, unbind = null, timers = [], sheet = null, sheetFrom = null, sheetStack = [], onVis = null, onKey = null, inkRO = null;

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};
function ensureCss() {
  const href = '/css/views/live.css';
  const existing = document.querySelector(`link[href="${href}"]`);
  if (existing) return Promise.resolve();
  return new Promise(resolve => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    const done = () => resolve(); l.onload = done; l.onerror = done; document.head.appendChild(l);
    setTimeout(done, 1500);                                        // never block the first paint for long
  });
}
function setThemeColor(c) {
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
  if (S && S.prevTheme === undefined) S.prevTheme = m.getAttribute('content');
  m.setAttribute('content', c);
}

// ---- small helpers -----------------------------------------------------------------------------
// reduced motion: the css switches every animation off; the js then skips its waits (sheet exit, card exit)
const calm = () => ui.reducedMotion();
// write a region only when its markup changed — a 60 s poll that brings nothing new leaves the DOM (hover,
// focus, lazy images, running entrances) alone. Returns true when it wrote.
const setHtml = (el, html) => { if (!el || el._html === html) return false; el.innerHTML = html; el._html = html; return true; };
// (re)start a one-shot css entrance class and take it off again once it has run
function replay(el, cls, ms = 700) {
  if (!el || calm()) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  clearTimeout(el['_t' + cls]); el['_t' + cls] = setTimeout(() => el.classList.remove(cls), ms);
}
// every match in the app AND in the open sheet (a sheet lives on <body>, outside the view root)
const each = (sel, fn) => { if (rootEl) rootEl.querySelectorAll(sel).forEach(fn); if (sheet) sheet.querySelectorAll(sel).forEach(fn); };
const pad = n => String(n).padStart(2, '0');
const localYmd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = iso => (iso ? new Date(iso).getTime() : NaN);
// counted down the way the portal's countdowns (ui.countdown) count: whole minutes, hours and days left, so
// "in 1 h 59 min" here reads the same as 0 DAYS 01 HOURS 59 MINUTES on Home and Plexus
const rel = ms => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'a moment';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24); return `${d} day${d === 1 ? '' : 's'}`;
};
// a 23:59 end is the "until late" placeholder (below): no length is printed for it — "22:30–late · 1 h 29 min"
// contradicted itself
const duration = s => { if (s.end_time === '23:59') return ''; const m = Math.round((at(s.ends_at) - at(s.starts_at)) / 60000); if (!isFinite(m) || m <= 0) return ''; return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`) : `${m} min`; };
const timeRange = s => s.start_time ? `${s.start_time}${s.end_time ? '–' + (s.end_time === '23:59' ? 'late' : s.end_time) : ''}` : COPY.now.tbd;
const clock = ts => { const d = new Date(ts || Date.now()); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayParts = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3]); return { n: Number(m[3]), dow: DOW[d.getDay()], mon: MON[Number(m[2]) - 1].toUpperCase(), year: m[1] }; };
// "Dr. Yi-Hsiang (Sean) Hsu" → "YH", "prim. dr. Gzim Redžepi" → "GR": titles and nicknames dropped, letters only
const initials = name => String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\b(prof|dr|prim|mr|mrs|ms|md|phd)\.?\s+/gi, ' ').split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
const kindLabel = k => KIND_LABEL[k] || KIND_LABEL.other;
// an event over two days (the conference runs 4–5 December) says so: "Fri 4 – Sat 5 Dec"; one day keeps the
// server's "Friday 4 Dec". A 23:59 end is a placeholder for "until late", never a time anyone should read.
const cap3 = w => w.slice(0, 1) + w.slice(1, 3).toLowerCase();
const multiDay = ev => !!(ev && ev.end_date && ev.date && ev.end_date !== ev.date);
function dateLabel(ev) {
  if (!ev) return '';
  const a = dayParts(ev.date), b = multiDay(ev) ? dayParts(ev.end_date) : null;
  if (!a || !b) return ev.date_label || '';
  return a.mon === b.mon ? `${cap3(a.dow)} ${a.n} – ${cap3(b.dow)} ${b.n} ${cap3(a.mon)}` : `${cap3(a.dow)} ${a.n} ${cap3(a.mon)} – ${cap3(b.dow)} ${b.n} ${cap3(b.mon)}`;
}
const endLabel = t => (t === '23:59' ? 'late' : t);
// every date an event spans ('2026-12-04', '2026-12-05'), in order; one day for a one-day event
function spanDays(ev) {
  const a = dayParts(ev && ev.date) ? ev.date : null; if (!a) return [];
  const out = [a]; if (!multiDay(ev)) return out;
  const d = new Date(`${a}T12:00:00`);
  while (out.length < 14) { d.setDate(d.getDate() + 1); const y = localYmd(d); if (y > ev.end_date) break; out.push(y); }
  return out;
}
const shortDay = ymd => { const d = dayParts(ymd); return d ? `${cap3(d.dow)} ${d.n} ${cap3(d.mon)}` : ''; };
function hoursLabel(ev) {
  if (!ev || !ev.start) return '';
  if (ev.times_tbd) return `${ev.start} (tbc)`;
  if (multiDay(ev)) return `from ${ev.start}`;
  return ev.end ? `${ev.start}–${endLabel(ev.end)}` : ev.start;
}
const venueOf = ev => String((ev && ev.venue) || '').replace(/\s*;\s*/g, ' · ');
// the address line, minus a repeat of the venue's own name ("Esplanade Zagreb" · "Esplanade Zagreb, private salon")
function addressOf(ev) {
  const a = String((ev && ev.address) || '').trim(), v = String((ev && ev.venue) || '').trim();
  if (!a || !v || !a.toLowerCase().startsWith(v.toLowerCase())) return a;
  const rest = a.slice(v.length).replace(/^[\s,·;–-]+/, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
}
const isLight = s => LIGHT.has(s.kind);
const eventOf = key => (S.events || []).find(e => e.key === key) || null;
// IN the schedule: tapped on, or — the default — part of an event the person registered for (their
// registration picks conference · Gala · Bridges · Donor Night · meetups); a tap OFF ('declined') removes it
const attending = id => {
  const st = S.attendance[id];
  if (st === 'attending') return true;
  if (st === 'declined') return false;
  const s = sessionById(id);
  return !!(s && held(s.event_key));
};
const isMeetupSlot = s => !!(s && s.synthetic === 'meetup');
const speaking = id => (S.speakerIds || []).includes(id);
const held = key => !!(S.person && S.person.events.includes(key));
const canToggle = key => !!S.token && held(key);
const sessionsOf = key => ((S.programs[key] || {}).sessions || []);
const sessionById = id => { for (const k of Object.keys(S.programs)) { const s = sessionsOf(k).find(x => x.id === id); if (s) return s; } return null; };
const heldEvents = () => (S.events || []).filter(e => held(e.key));
const icsUrl = (path) => api.url(path);

// ADD TO CALENDAR for a person's own schedule. A ticket link's token rides in the URL, so a plain download link
// works; a signed-in member's token is the literal 'user' + a Bearer header a link cannot send — the server's
// /api/live/me/user/schedule.ics answered 404 — so the member's file is built here from the loaded program.
function icsLink(label, cls, { session: sid, date } = {}) {
  if (S.token === 'user') return `<span data-act="icsMine" class="${cls}" role="button" tabindex="0"${sid ? ` data-session="${esc(sid)}"` : ''}${date ? ` data-date="${esc(date)}"` : ''}>${label}</span>`;
  const q = sid ? `session=${encodeURIComponent(sid)}` : `date=${date}`;
  return `<a class="${cls}" href="${esc(icsUrl(`/api/live/me/${encodeURIComponent(S.token)}/schedule.ics?${q}`))}" download>${label}</a>`;
}
// the sessions in a person's schedule: attending + speaking, chronological across every loaded program
function mySchedule() {
  const list = [];
  for (const key of Object.keys(S.programs)) for (const s of sessionsOf(key)) if (attending(s.id) || speaking(s.id)) list.push(s);
  list.sort((a, b) => String(a.event_date || '9').localeCompare(String(b.event_date || '9')) || String(a.start_time || '99').localeCompare(String(b.start_time || '99')) || (a.sort_order || 0) - (b.sort_order || 0));
  const conflicts = new Set();
  const timed = list.filter(s => s.starts_at && s.ends_at);
  for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
    const a = timed[i], b = timed[j];
    if (at(a.starts_at) < at(b.ends_at) && at(b.starts_at) < at(a.ends_at)) { conflicts.add(a.id); conflicts.add(b.id); }
  }
  return { list, conflicts };
}
function groupDays(list) {
  const days = new Map();
  for (const s of list) { const k = s.event_date || 'tbd'; if (!days.has(k)) days.set(k, { date: s.event_date || null, sessions: [] }); days.get(k).sessions.push(s); }
  return Array.from(days.values());
}
// the event the app should open: live now → today → next upcoming → first (the person's events first)
function guessEvent(events, mine) {
  const pool = (mine && mine.length) ? events.filter(e => mine.includes(e.key)) : events;
  const list = pool.length ? pool : events;
  const hit = list.find(e => e.is_live) || list.find(e => e.is_today) || list.find(e => e.is_upcoming) || list[0];
  return hit ? hit.key : null;
}

// ---- data --------------------------------------------------------------------------------------
// every fetch writes into the state it started from — a guest who left (or opened another ticket) while the
// backend woke never gets a late answer painted into the new screen
async function fetchMe() {
  const st = S, tok = S.token;
  const r = await api.get(`/api/live/me/${encodeURIComponent(tok)}?today=${localYmd()}`, { noAuth: tok !== 'user', keepSession: true });
  if (S !== st) return;
  S.person = r.person; S.events = r.events; S.speakerIds = r.person.speaker_session_ids || [];
  S.attendance = Object.assign({}, r.attendance || {});               // the server is the truth
  store.set(LS.att(tok), S.attendance);
  const k = meKey(tok); if (k) store.set(LS.me(k), { person: slimPerson(r.person), events: r.events || [], current: r.current_event || null });
  S.current = r.current_event;
  S.meError = null; S.mePending = false; S.eventsPending = false;
}
async function fetchEvents() {
  const st = S;
  const r = await api.get(`/api/live/events?today=${localYmd()}`, { noAuth: true });
  if (S !== st) return;
  S.events = r.events || []; S.eventsPending = false;
  store.set(LS.events, S.events);
}
async function fetchProgram(key, { since } = {}) {
  const st = S;
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  const r = await api.get(`/api/live/${encodeURIComponent(key)}/program${q}`, { noAuth: true });
  if (S !== st) return { changed: false };
  if (r && r.changed === false) return { changed: false };
  S.programs[key] = r;
  store.set(LS.program(key), r);
  // the catalogue row may be fresher than the one in `events`
  if (r.event && S.events) { const i = S.events.findIndex(e => e.key === key); if (i >= 0) S.events[i] = Object.assign({}, S.events[i], r.event, { held: S.events[i].held, party: S.events[i].party }); }
  return { changed: true };
}
function loadCached(key) { const p = store.get(LS.program(key)); if (p && p.sessions) S.programs[key] = p; return !!p; }

async function attend(id, state) {
  const s = sessionById(id); if (!s) return;
  const r = await api.post(`/api/live/me/${encodeURIComponent(S.token)}/attend`, { session_id: id, state }, { noAuth: S.token !== 'user', keepSession: true });
  S.attendance[id] = r.state;
  store.set(LS.att(S.token), S.attendance);
  if (r.count !== undefined && r.count !== null) { s.count = r.count; }
  return r;
}

// ---- NOW / NEXT --------------------------------------------------------------------------------
function nowNext(key) {
  const ev = eventOf(key) || {}; const now = Date.now();
  const list = sessionsOf(key).filter(s => s.starts_at && s.ends_at).slice().sort((a, b) => at(a.starts_at) - at(b.starts_at));
  const live = list.filter(s => at(s.starts_at) <= now && now < at(s.ends_at));
  const upcoming = list.filter(s => at(s.starts_at) > now);
  const next = upcoming[0] || null;
  if (live.length) return { mode: 'live', now: live.sort((a, b) => (isLight(a) ? 1 : 0) - (isLight(b) ? 1 : 0))[0], next };
  if (list.length && !next) {
    // the conference runs 4–5 December but its program so far fills only the 4th: once that day's sessions are
    // over, a day of it is still ahead, so NOW never says "This event has ended" before the 5th is out
    const lastDay = list[list.length - 1].event_date || ev.date, today = localYmd();
    const ahead = spanDays(ev).find(d => d > lastDay && d >= today);
    if (ahead) return { mode: 'dayAhead', ev, day: ahead, n: spanDays(ev).indexOf(ahead) + 1 };
    return { mode: 'ended', ev, last: list[list.length - 1] };
  }
  if (next && ev.is_today) {
    const first = list[0];
    if (next === first) {                                             // before the doors: "Starts at 18:00 · doors 17:30"
      const doors = /doors|arrival|registration|welcome drinks/i.test(first.title || '') || (first.kind === 'reception' && list[1]) ? first : null;
      const start = doors && list[1] ? list[1] : first;
      return { mode: 'today', ev, start, doors, next: first };
    }
    return { mode: 'gap', next };
  }
  if (!list.length) return { mode: 'tbd', ev };
  return { mode: 'upcoming', ev, next };
}

// ---- templates ---------------------------------------------------------------------------------
// the ink band: its three lines are fixed elements in the shell (tplShell) and only their text is written, so
// a name arriving or a poll never restarts the band's entrance — it rises on the first paint and when the
// event itself changes (paintHead)
function headParts() {
  const ev = eventOf(S.current) || {};
  const p = S.person;
  const party = p && ev.key ? Number(p.party && p.party[ev.key]) : 0;
  const who = p ? `${esc(p.first_name)}${party > 1 ? ` · ${esc(COPY.party(party))}` : ''}` : '';
  const meta = [dateLabel(ev), hoursLabel(ev), venueOf(ev)].filter(Boolean).map(esc).join(' · ');
  return { who, title: esc(ev.label || 'Plexus Week'), meta: meta || COPY.loading, loading: !meta, label: ev.label || '' };
}
// the chips only (the .lv-switch row lives in the shell). `cur` = the selected event; tplSwitcher('') is the
// row's signature without a selection — same signature, only the selection moved → paintSwitch flips classes
function tplSwitcher(cur = S.current) {
  // the catalogue is still on its way: quiet chip-shaped placeholders hold the row, so the band keeps its height
  if (S.eventsPending) return '<span class="lv-chip sk" aria-hidden="true"></span><span class="lv-chip sk w2" aria-hidden="true"></span><span class="lv-chip sk w3" aria-hidden="true"></span>';
  // a past event stays only for the people who held it (Boston attendees can look back; everyone else sees what is ahead)
  const events = (S.events || []).filter(e => !e.is_past || held(e.key) || e.key === cur);
  if (!events.length) return '';
  const mine = heldEvents();
  const showAll = S.showAll || !S.token || !mine.length;
  const list = showAll ? events : mine;
  if (list.length <= 1 && !(mine.length && events.length > mine.length)) return '';
  const chip = e => `<span data-act="ev" data-key="${esc(e.key)}" class="lv-chip${e.key === cur ? ' on' : ''}${held(e.key) || !S.token ? '' : ' ro'}" role="tab" aria-selected="${e.key === cur}">${esc(e.short || e.label)}${e.is_live ? '<i class="lv-dot" aria-label="live now"></i>' : ''}</span>`;
  const more = (S.token && mine.length && events.length > mine.length)
    ? `<span data-act="allEvents" class="lv-chip ghost" role="button">${showAll ? COPY.switcher.mine : COPY.switcher.all} ${showAll ? '▴' : '▾'}</span>` : '';
  return list.map(chip).join('') + more;
}
function tplNow() {
  const key = S.current;
  // the catalogue is still on its way: a quiet strip of the same lines holds the place, so the tabs and the program
  // do not drop by its height when it arrives (the line classes give it the exact height)
  if (!key) return S.eventsPending ? '<div class="lv-now-line lv-now-sk" aria-hidden="true"><span class="lv-now-label">&nbsp;</span><span class="lv-now-title">&nbsp;</span><span class="lv-now-sub">&nbsp;</span></div>' : '';
  const nn = nowNext(key); const now = Date.now();
  const card = (label, s, sub, live) => `
    <div class="lv-now-item${live ? ' live' : ''}" data-act="open" data-id="${esc(s.id)}">
      <span class="lv-now-label">${live ? '<i class="lv-pulse" aria-hidden="true"></i>' : ''}${label}</span>
      <span class="lv-now-title">${esc(s.title || 'Session')}${s.is_tbd ? ' <em>TBD</em>' : ''}</span>
      <span class="lv-now-sub">${[s.room, sub].filter(Boolean).map(esc).join(' · ')}</span>
    </div>`;
  if (nn.mode === 'live') return card(COPY.now.now, nn.now, nn.now.end_time === '23:59' ? COPY.now.late : COPY.now.endsIn(rel(at(nn.now.ends_at) - now)), true) + (nn.next ? card(COPY.now.next, nn.next, COPY.now.inMin(rel(at(nn.next.starts_at) - now)), false) : '');
  if (nn.mode === 'gap') return card(COPY.now.next, nn.next, COPY.now.inMin(rel(at(nn.next.starts_at) - now)), false);
  const ev = nn.ev || {};
  if (nn.mode === 'today') return `<div class="lv-now-line"><span class="lv-now-label">${COPY.now.next}</span><span class="lv-now-title">${esc(COPY.now.startsAt(nn.start.start_time, nn.doors ? nn.doors.start_time : null))}</span><span class="lv-now-sub">${esc(COPY.now.inMin(rel(at(nn.next.starts_at) - now)))}${ev.venue ? ' · ' + esc(venueOf(ev)) : ''}</span></div>`;
  if (nn.mode === 'dayAhead') return `<div class="lv-now-line"><span class="lv-now-label">${COPY.now.next}</span><span class="lv-now-title">${esc(COPY.now.day(nn.n, shortDay(nn.day)))}</span><span class="lv-now-sub">${esc(COPY.program.dayEmpty)}</span></div>`;
  if (nn.mode === 'ended') return `<div class="lv-now-line ended"><span class="lv-now-label">${COPY.now.now}</span><span class="lv-now-title">${esc(COPY.now.ended(dateLabel(ev)))}</span><span class="lv-now-sub">${COPY.now.over}</span></div>`;
  if (nn.mode === 'tbd') return `<div class="lv-now-line"><span class="lv-now-label">${COPY.now.next}</span><span class="lv-now-title">${esc(dateLabel(ev) || COPY.now.tbd)}</span><span class="lv-now-sub">${esc(ev.times_tbd || ev.tentative ? COPY.info.tentative : COPY.now.tbd)}</span></div>`;
  const first = nn.next;
  return `<div class="lv-now-line"><span class="lv-now-label">${COPY.now.next}</span><span class="lv-now-title">${esc(COPY.now.startsOn(first.day_label || ev.date_label, first.start_time))}</span><span class="lv-now-sub">${esc(COPY.now.inMin(rel(at(first.starts_at) - now)))}${ev.venue ? ' · ' + esc(venueOf(ev)) : ''}</span></div>`;
}
function tplSlots() {
  if (!S.person || !S.person.is_speaker) return '';
  const slots = [];
  for (const key of Object.keys(S.programs)) for (const s of sessionsOf(key)) if (speaking(s.id)) slots.push(s);
  if (!slots.length) return '';
  slots.sort((a, b) => at(a.starts_at) - at(b.starts_at));
  return `
    <div class="lv-slots-head"><span class="lv-eyebrow ink">${COPY.slots.title}</span><span class="lv-slots-sub">${COPY.slots.sub}</span></div>
    ${slots.map(s => { const ev = eventOf(s.event_key) || {}; return `
    <div class="lv-slot" data-act="open" data-id="${esc(s.id)}">
      <span class="lv-slot-time">${esc(s.start_time || '—')}</span>
      <span class="lv-slot-body">
        <span class="lv-slot-title">${esc(s.title || 'Session')}</span>
        <span class="lv-slot-sub">${[ev.short && heldEvents().length > 1 ? ev.short : null, s.event_date && s.event_date !== (eventOf(S.current) || {}).date ? s.day_label : null, s.room, duration(s)].filter(Boolean).map(esc).join(' · ')}</span>
      </span>
      <span class="lv-tag red">${COPY.slots.speaking}</span>
    </div>`; }).join('')}`;
}
const scheduleCount = () => (S.token && !S.mePending ? mySchedule().list.length : 0);
function tplTabs({ n = scheduleCount(), bump = false } = {}) {
  return TABS.map(t => `<span data-act="tab" data-tab="${t}" role="tab" aria-selected="${S.tab === t}" class="lv-tab${S.tab === t ? ' on' : ''}">${COPY.tabs[t]}${t === 'schedule' && n ? `<b class="lv-count${bump ? ' bump' : ''}">${n}</b>` : ''}</span>`).join('');
}
function tplSpeakersRow(s) {
  const people = (s.speakers || []).filter(x => x && x.name);
  const names = (s.speaker_names || []).filter(x => x && x.name);
  if (!people.length && !names.length) return '';
  const av = p => p.photo_url ? `<img class="lv-av" src="${esc(p.photo_url)}" alt="" loading="lazy">` : `<span class="lv-av txt">${esc(initials(p.name))}</span>`;
  const all = people.map(p => ({ name: p.name, av: av(p) })).concat(names.map(p => ({ name: p.name, av: null })));
  const shown = all.slice(0, 3), rest = all.length - shown.length;
  // "+N more" is a sibling of the two-line clamp — inside it, it was the first thing the clamp cut off
  return `<div class="lv-spk"><span class="lv-avs">${shown.filter(x => x.av).map(x => x.av).join('')}</span><span class="lv-spk-names">${shown.map(x => esc(x.name)).join(', ')}</span>${rest > 0 ? `<b class="lv-spk-more">+${rest} more</b>` : ''}</div>`;
}
function tplToggle(s, { compact } = {}) {
  const on = attending(s.id), spk = speaking(s.id), ok = canToggle(s.event_key) || spk;
  if (spk) return `<span class="lv-att speak" aria-disabled="true">${COPY.att.speaking}</span>`;
  if (isMeetupSlot(s)) return `<span class="lv-att speak" aria-disabled="true">${COPY.att.meetup}</span>`;
  // the ticket is still being read (a first visit on this device): a quiet placeholder the size of the toggle
  // (its label hidden) — never a guessed state, never the read-only "not on your ticket" look
  if (S.token && S.mePending) return `<span class="lv-att wait${compact ? ' compact' : ''}" aria-hidden="true">${COPY.att.on}</span>`;
  // not on the ticket (or no ticket link): the note above the program already says so once — no dead toggle on every card
  if (!ok) return '';
  return `<span data-act="att" data-id="${esc(s.id)}" data-sid="${esc(s.id)}" role="switch" tabindex="0" aria-checked="${on}" aria-label="${esc((on ? 'Attending: ' : 'Attend: ') + (s.title || 'session'))}" class="lv-att${on ? ' on' : ''}${compact ? ' compact' : ''}">${on ? COPY.att.on : COPY.att.off}</span>`;
}
function tplCard(s, { schedule, conflict } = {}) {
  const ev = eventOf(s.event_key) || {};
  const light = isLight(s);
  const cls = ['lv-card', light ? 'light' : '', s.is_tbd ? 'tbd' : '', attending(s.id) ? 'going' : '', speaking(s.id) ? 'mine' : ''].filter(Boolean).join(' ');
  const tags = [
    `<span class="lv-tag${s.kind === 'keynote' ? ' gold' : ''}">${kindLabel(s.kind)}</span>`,
    s.is_tbd ? `<span class="lv-tag gold">${COPY.att.tbd}</span>` : '',
    speaking(s.id) ? `<span class="lv-tag red">${COPY.slots.speaking}</span>` : '',
    conflict ? `<span class="lv-tag red">${COPY.att.over}</span>` : '',
    s.show_counts && (s.count || s.capacity) ? `<span class="lv-tag soft">${[s.count ? COPY.att.going(s.count) : null, s.capacity ? COPY.att.seats(s.capacity) : null].filter(Boolean).join(' · ')}</span>` : ''
  ].join('');
  const where = [s.room, s.location_note].filter(Boolean).map(esc).join(' · ');
  const when = schedule ? `${esc(timeRange(s))}${duration(s) ? ` · ${esc(duration(s))}` : ''}` : `${s.end_time ? `→ ${esc(endLabel(s.end_time))}` : ''}${duration(s) ? ` · ${esc(duration(s))}` : ''}`;
  const evLine = schedule && heldEvents().length > 1 ? `<span class="lv-card-ev">${esc(ev.short || ev.label || '')}</span>` : '';
  const foot = tplToggle(s) + (schedule && S.token ? icsLink(COPY.schedule.ics, 'lv-ics', { session: s.id }) : '');
  return `
    <article class="${cls}" data-sid-card="${esc(s.id)}">
      <div class="lv-card-body" data-act="open" data-id="${esc(s.id)}">
        <div class="lv-card-top"><span class="lv-when">${when}</span><span class="lv-tags">${tags}</span></div>
        ${evLine}
        <h3 class="lv-card-title">${esc(s.title || 'Session')}</h3>
        ${tplSpeakersRow(s)}
        ${where ? `<div class="lv-where"><svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><path d="M6 13.3S1 8.4 1 5.2a5 5 0 0 1 10 0c0 3.2-5 8.1-5 8.1Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="5.2" r="1.7" fill="currentColor"/></svg>${where}</div>` : ''}
      </div>
      ${foot ? `<div class="lv-card-foot">${foot}</div>` : ''}
    </article>`;
}
function tplDayHead(date, extra) {
  const d = dayParts(date);
  return `<div class="lv-day" data-day="${esc(date || 'tbd')}">${d ? `<span class="lv-day-n">${d.n}</span><span class="lv-day-t">${d.dow} · ${d.mon}</span>` : `<span class="lv-day-t">${COPY.program.tbdDay}</span>`}${extra || ''}</div>`;
}
function tplProgram() {
  const key = S.current; const prog = S.programs[key];
  if (!prog) return tplSkeleton();
  const sessions = prog.sessions || [];
  if (!sessions.length) return `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.program.empty}</span></div>`;
  const noTicket = S.person && !S.person.events.length && session.isAuthed;
  const notice = S.token && S.mePending ? '' : noTicket ? `<div class="lv-note">${COPY.noEvents} <a href="/app/plexus/mine">${COPY.noTickets.cta}</a></div>`
    : S.token && !held(key) && !sessions.some(s => speaking(s.id)) ?`<div class="lv-note">${COPY.att.notHeld}</div>` : (!S.token ? `<div class="lv-note">${COPY.att.ticket}</div>` : '');
  // every day the event spans gets its head, a day whose sessions are not written yet included (the
  // conference's 5 December), so the program reads as the two days the header says
  const days = groupDays(sessions);
  const ev = eventOf(key);
  for (const d of spanDays(ev)) if (!days.some(x => x.date === d)) days.push({ date: d, sessions: [] });
  days.sort((a, b) => String(a.date || '9').localeCompare(String(b.date || '9')));
  return notice + days.map(day => {
    if (!day.sessions.length) return tplDayHead(day.date) + `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.program.dayEmpty}</span></div>`;
    const blocks = [];
    for (const s of day.sessions) { const last = blocks[blocks.length - 1]; if (last && last.time === (s.start_time || '')) last.items.push(s); else blocks.push({ time: s.start_time || '', items: [s] }); }
    return tplDayHead(day.date) + blocks.map(b => `
      <div class="lv-block">
        <div class="lv-block-time">${esc(b.time || '—')}</div>
        <div class="lv-block-cards">${b.items.map(s => tplCard(s)).join('')}</div>
      </div>`).join('');
  }).join('');
}
function tplSchedule() {
  if (!S.token) return `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.att.ticket}</span></div>`;
  if (S.mePending) return tplSkeleton({ list: true });                  // not "Nothing here yet" while the ticket is read
  // a signed-in member who holds no ticket has nothing to add from the program (it is read-only for them): the
  // empty state says what to do instead, with the door to the registration
  if (S.person && !S.person.events.length) return `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.noTickets.line}</span><span class="lv-empty-why">${COPY.noTickets.why}</span>${session.isAuthed ? `<a class="lv-att lv-retry" href="/app/plexus/mine">${COPY.noTickets.cta}</a>` : ''}</div>`;
  const { list, conflicts } = mySchedule();
  if (!list.length) return `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.schedule.emptyLine}</span><span class="lv-empty-why">${COPY.schedule.emptyWhy}</span></div>`;
  const auto = S.person && S.person.events.length ? `<div class="lv-note soft">${COPY.schedule.auto}</div>` : '';
  return auto + (conflicts.size ? `<div class="lv-note warn">${COPY.schedule.conflict}</div>` : '') + groupDays(list).map(day => {
    const dayIcs = day.date ? icsLink(COPY.schedule.icsDay, 'lv-ics day', { date: day.date }) : '';
    return tplDayHead(day.date, dayIcs) + `<div class="lv-list">${day.sessions.map(s => tplCard(s, { schedule: true, conflict: conflicts.has(s.id) })).join('')}</div>`;
  }).join('');
}
// speakers of the current event: the program's `speakers` map first, then names-only people
function speakerList(key) {
  const prog = S.programs[key] || {}; const out = [], seen = new Set();
  for (const sp of Object.values(prog.speakers || {})) if (sp && sp.name && !seen.has(sp.name.toLowerCase())) { seen.add(sp.name.toLowerCase()); out.push(Object.assign({ named: false }, sp)); }
  for (const s of (prog.sessions || [])) for (const n of (s.speaker_names || [])) if (n && n.name && !seen.has(n.name.toLowerCase())) { seen.add(n.name.toLowerCase()); out.push({ id: null, name: n.name, title: n.topic || '', institution: n.institution || '', photo_url: null, named: true }); }
  return out;
}
function sessionsWith(key, sp) {
  return sessionsOf(key).filter(s => (sp.id && (s.speaker_ids || []).includes(sp.id)) || (s.speaker_names || []).some(n => n && n.name && n.name.toLowerCase() === sp.name.toLowerCase()));
}
// The program's sessions name no speakers yet (the conference today) while the portal already lists the
// confirmed roster on Program & speakers / the Gala page: the tab shows that roster instead of "announced
// closer to the event". Read once per event from the same public reads those pages use.
async function loadRoster(key) {
  if (!S || S.roster[key] !== undefined) return;
  S.roster[key] = null;                                                  // asked — one read per event
  const st = S;
  let list = [];
  try {
    if (key === 'conference') {
      const r = await api.get('/api/plexus/speakers', { noAuth: true });
      list = (Array.isArray(r) ? r : []).filter(x => x && x.name).map(x => ({ id: null, name: ui.fmt.person(x.name), title: x.title || '', institution: x.institution || '', photo_url: x.photo_url || null, bio: x.bio || '', named: false }));
    } else if (key === 'gala') {
      const r = await api.get('/api/gala/settings', { noAuth: true });
      list = ((r && Array.isArray(r.speakers)) ? r.speakers : []).filter(x => x && x.name).map(x => ({ id: null, name: ui.fmt.person(x.name), title: x.title || x.role || '', institution: '', photo_url: x.image ? api.url(x.image) : null, bio: x.bio || '', named: false }));
    }
  } catch (e) { list = []; }
  if (S !== st || !rootEl) return;
  S.roster[key] = list;
  if (list.length && S.current === key) paintPanel('speakers', { force: true });
}
function currentSpeakers() {
  const list = speakerList(S.current);
  if (list.length) return list;
  const r = S.roster[S.current];
  if (r === undefined) loadRoster(S.current);
  return r || [];
}
function tplSpeakers() {
  const list = currentSpeakers();
  if (!list.length) return `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.speakers.empty}</span></div>`;
  return `<div class="lv-grid">${list.map((sp, i) => `
    <div class="lv-person" data-act="spk" data-i="${i}" role="button">
      ${sp.photo_url ? `<img class="lv-portrait" src="${esc(sp.photo_url)}" alt="" loading="lazy">` : `<span class="lv-portrait txt">${esc(initials(sp.name))}</span>`}
      <span class="lv-person-name">${esc(sp.name)}</span>
      <span class="lv-person-sub">${esc(sp.institution || sp.title || '')}</span>
    </div>`).join('')}</div>`;
}
function tplInfo() {
  const ev = eventOf(S.current) || {};
  const q = encodeURIComponent([venueOf(ev), ev.address].filter(Boolean).join(', '));
  const dress = ev.dress_code || DRESS[ev.key] || null;
  const when = [dateLabel(ev), hoursLabel(ev)].filter(Boolean).join(' · ');
  const addr = addressOf(ev);
  const row = (label, body) => body ? `<div class="lv-info-row"><span class="lv-info-label">${label}</span><div class="lv-info-body">${body}</div></div>` : '';
  return `
    ${row(COPY.info.venue, `<b>${esc(venueOf(ev) || '—')}</b>${addr ? `<br>${esc(addr)}` : ''}${ev.tentative ? `<br><i>${COPY.info.tentative}</i>` : ''}${q && !/to be announced/i.test(ev.venue || '') ? `<div class="lv-links"><a href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">${COPY.info.apple}</a><a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${COPY.info.google}</a></div>` : ''}`)}
    ${row(COPY.info.when, `<b>${esc(when || '—')}</b>${ev.tz ? `<br>${esc(COPY.info.tz(ev.tz))}` : ''}${ev.times_tbd ? `<br><i>${COPY.info.timesTbd}</i>` : ''}`)}
    ${row(COPY.info.dress, dress ? `<b>${esc(dress)}</b>` : '')}
    ${ev.wifi ? row(COPY.info.wifi, `<b>${esc(ev.wifi)}</b>`) : ''}
    ${row(COPY.info.contact, `<b>${esc(CONTACT.name)}</b><br><a href="mailto:${CONTACT.email}">${CONTACT.email}</a>`)}`;
}
// wide screens only (css): the event at a glance beside the program — where, when, what to wear, who to call
function tplGlance() {
  const ev = eventOf(S && S.current) || {};
  if (!ev.key) return '';
  const q = encodeURIComponent([venueOf(ev), ev.address].filter(Boolean).join(', '));
  const dress = ev.dress_code || DRESS[ev.key] || null;
  const when = [dateLabel(ev), hoursLabel(ev)].filter(Boolean).join(' · ');
  const addr = addressOf(ev);
  return `
    <span class="lv-eyebrow ink">AT A GLANCE</span>
    <dl class="lv-glance-list">
      <dt>${COPY.info.venue}</dt><dd><b>${esc(venueOf(ev) || '—')}</b>${addr ? `<br>${esc(addr)}` : ''}${q && !/to be announced/i.test(ev.venue || '') ? `<br><a class="lv-glance-map" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${COPY.info.google}</a>` : ''}</dd>
      <dt>${COPY.info.when}</dt><dd>${esc(when || '—')}${ev.tz ? `<br><span class="lv-soft">${esc(COPY.info.tz(ev.tz))}</span>` : ''}</dd>
      ${dress ? `<dt>${COPY.info.dress}</dt><dd>${esc(dress)}</dd>` : ''}
      <dt>${COPY.info.contact}</dt><dd>${esc(CONTACT.name)}<br><a href="mailto:${CONTACT.email}">${CONTACT.email}</a></dd>
    </dl>`;
}
// card-shaped placeholders under one slow sheen (the css) while the first program is on its way
function tplSkeleton({ list } = {}) {
  const card = '<div class="lv-sk card" aria-hidden="true"><span class="lv-sk w30"></span><span class="lv-sk w70"></span><span class="lv-sk w50"></span><span class="lv-sk btn"></span></div>';
  const day = '<div class="lv-day"><span class="lv-sk short"></span></div>';
  if (list) return `${day}<div class="lv-list">${card}${card}</div>`;
  const block = `<div class="lv-block"><div class="lv-block-time"><span class="lv-sk tiny"></span></div><div class="lv-block-cards">${card}</div></div>`;
  return `${day}${block}${block}`;
}
function tplShell() {
  const back = session.isAuthed ? `<a href="/app/home" class="lv-back">${COPY.portal}</a>` : '';
  return `
  <div class="lv" data-screen-label="Plexus Week Live">
    <header class="lv-head" data-role="head">
      <div class="lv-head-top" data-role="headtop">
        <div class="lv-head-row"><span class="lv-eyebrow">${COPY.eyebrow}</span><span class="lv-who" data-role="who"></span>${back}</div>
        <h1 class="lv-title" data-role="title"></h1>
        <div class="lv-meta" data-role="meta"></div>
      </div>
      <div class="lv-switch" data-role="switch" role="tablist" aria-label="Events"></div>
    </header>
    <aside class="lv-side">
      <section class="lv-now" data-role="now" aria-live="polite">${tplNow()}</section>
      <section class="lv-slots" data-role="slots">${tplSlots()}</section>
      <section class="lv-glance" data-role="glance">${tplGlance()}</section>
    </aside>
    <nav class="lv-tabs" data-role="tabs" role="tablist"></nav>
    <main class="lv-panels">
      ${TABS.map(t => `<section class="lv-panel" data-panel="${t}" role="tabpanel"${S.tab === t ? '' : ' hidden'}></section>`).join('')}
    </main>
    <footer class="lv-foot"><span data-role="foot">${esc(COPY.foot(''))}</span><span data-act="refresh" class="lv-refresh">${COPY.refresh}</span></footer>
  </div>`;
}

// ---- rendering ---------------------------------------------------------------------------------
const q = sel => rootEl && rootEl.querySelector(sel);
// staggered entrance for a panel's rows (day lines, time blocks, cards, speaker tiles, info rows): the first
// six step in 28 ms apart, the rest arrive with the sixth — done inside ~0.5 s. Runs on a tab switch and when a
// panel's CONTENT IDENTITY changes (panelKey: another event, a skeleton replaced) — never on the first paint
// (the router's screen fade frames that), a data repaint or a background poll.
function enter(el) {
  if (!el || calm()) return;
  const items = el.querySelectorAll(':scope > :not(.lv-list):not(.lv-grid), :scope > .lv-list > *, :scope > .lv-grid > *');
  items.forEach((x, i) => { x.classList.remove('lv-enter'); x.style.setProperty('--lv-d', Math.min(i, 6) * 28 + 'ms'); });
  void el.offsetWidth;                                                  // restart when the same rows enter again
  items.forEach(x => x.classList.add('lv-enter'));
}
// what a panel is showing, independent of its data state: the same key = the same content, repainted in place
function panelKey(tab) {
  if (tab === 'schedule') return !S.token ? 'anon' : S.mePending ? 'wait' : 'me';
  if (tab === 'info') return S.current || '';
  return (S.current || '') + (S.programs[S.current] ? '' : ':sk');
}
function paintPanel(tab, { force } = {}) {
  const el = q(`[data-panel="${tab}"]`); if (!el) return false;
  const html = tab === 'program' ? tplProgram() : tab === 'schedule' ? tplSchedule() : tab === 'speakers' ? tplSpeakers() : tplInfo();
  if (force) el._html = null;
  return setHtml(el, html);
}
function paintHead() {
  const top = q('[data-role="headtop"]');
  if (top) {
    const h = headParts();
    const who = q('[data-role="who"]'), title = q('[data-role="title"]'), meta = q('[data-role="meta"]');
    // the band rises with the first paint and again only when the event itself changes; a name arriving on
    // its own (the band staying put) just fades in
    const rise = top._label !== h.label, hadWho = !!(who && who._html);
    if (setHtml(who, h.who) && h.who && !hadWho && !rise) replay(who, 'lv-in', 400);
    setHtml(title, h.title);
    if (setHtml(meta, h.meta)) meta.classList.toggle('loading', h.loading);
    if (rise) { top._label = h.label; replay(top, 'rise', 700); }
  }
  paintSwitch();
}
// same chips, new selection → flip the classes in place so the chip colours cross-fade; otherwise redraw
function paintSwitch() {
  const sw = q('[data-role="switch"]'); if (!sw) return;
  const html = tplSwitcher(), sig = tplSwitcher('');
  if (sw._html === html) return;
  if (sw._sig === sig && sw._html) {
    sw.querySelectorAll('.lv-chip[data-key]').forEach(c => { const on = c.dataset.key === S.current; c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on)); });
    sw._html = html;
  } else { sw.innerHTML = html; sw._html = html; }
  sw._sig = sig;
  revealChip(sw, sw.querySelector('.lv-chip.on'), !!sw._shown); sw._shown = true;
}
// scroll the switcher (never the page — so no scrollIntoView) until `chip` sits inside the faded edges; a
// selected chip past the right edge left a guest holding four events with nothing lit
function revealChip(sw, chip, smooth) {
  if (!sw || !chip || sw.scrollWidth <= sw.clientWidth + 1) return;
  const r = chip.getBoundingClientRect(), b = sw.getBoundingClientRect(), edge = 28;
  const dx = r.left < b.left + edge ? r.left - b.left - edge : r.right > b.right - edge ? r.right - b.right + edge : 0;
  if (Math.abs(dx) < 1) return;
  try { sw.scrollTo({ left: sw.scrollLeft + dx, behavior: smooth && !calm() ? 'smooth' : 'auto' }); } catch (e) { sw.scrollLeft += dx; }
}
// the crimson underline: one element that slides (transform only) to the selected tab
function placeInk(animate) {
  const tabs = q('[data-role="tabs"]'); if (!tabs) return;
  const ink = tabs.querySelector('.lv-tab-ink'), on = tabs.querySelector('.lv-tab.on');
  if (!ink || !on || !on.offsetWidth) return;
  if (!animate) ink.style.transition = 'none';
  ink.style.transform = `translateX(${on.offsetLeft}px) scaleX(${on.offsetWidth})`;
  if (!animate) { void ink.offsetWidth; ink.style.transition = ''; }
  tabs.classList.add('inked');
}
// `bump`: the MY SCHEDULE count pops — only when the guest's own tap changed it, never when data lands
function paintTabs({ bump } = {}) {
  const tabs = q('[data-role="tabs"]'); if (!tabs) return;
  const n = scheduleCount();
  const pop = !!bump && S.lastCount != null && n !== S.lastCount && n > 0;
  S.lastCount = n;
  if (!setHtml(tabs, tplTabs({ n, bump: pop }) + INK)) return;
  placeInk(false);
  // fonts landing, the count appearing, a rotated phone: the tab widths move, the ink follows
  if (window.ResizeObserver) {
    if (!inkRO) inkRO = new ResizeObserver(() => placeInk(false));
    inkRO.disconnect(); tabs.querySelectorAll('.lv-tab').forEach(t => inkRO.observe(t));
  }
}
function paintAll() {
  if (!rootEl) return;
  const y = window.scrollY;
  // another event: NOW / NEXT, YOUR SLOTS and AT A GLANCE fade over with the program instead of swapping in
  // one frame beside it (never on a data repaint or a poll — only when the event itself changed)
  const evChanged = S._sideEv !== undefined && S._sideEv !== S.current; S._sideEv = S.current;
  paintHead();
  const side = [];
  if (setHtml(q('[data-role="now"]'), tplNow())) side.push('now');
  const slots = q('[data-role="slots"]'); if (slots) { if (setHtml(slots, tplSlots())) side.push('slots'); slots.hidden = !slots.innerHTML.trim(); }
  if (setHtml(q('[data-role="glance"]'), tplGlance())) side.push('glance');
  if (evChanged) side.forEach(r => replay(q(`[data-role="${r}"]`), 'lv-swap', 420));
  paintTabs();
  TABS.forEach(t => {
    const el = q(`[data-panel="${t}"]`); if (!el) return;
    const wrote = paintPanel(t), key = panelKey(t), was = el._enterKey;
    el._enterKey = key;
    if (wrote && was !== undefined && was !== key && t === S.tab) enter(el);
  });
  const ev = eventOf(S.current) || {};
  const upd = S.programs[S.current] && S.programs[S.current].updated_at ? clock(S.programs[S.current].updated_at) : '';
  const foot = q('[data-role="foot"]'); if (foot) { foot.textContent = S.offline ? COPY.offlineFoot(upd) : COPY.foot(upd); foot.classList.toggle('off', !!S.offline); }
  document.title = `${ev.label ? ev.label + ' · ' : ''}Plexus Week Live · Med&X`;
  window.scrollTo(0, y);
}
// MY SCHEDULE repainted while it is on screen: rows that stay glide to their new place (FLIP — transform
// only, 280 ms) instead of jumping a card height in one frame; a row that is new rises in
function reflowSchedule() {
  const sched = q('[data-panel="schedule"]');
  if (!sched || sched.hidden || calm()) { paintPanel('schedule', { force: true }); return; }
  const rows = () => Array.from(sched.querySelectorAll('.lv-card[data-sid-card], .lv-day[data-day], .lv-note, .lv-empty'));
  const keyOf = x => x.dataset.sidCard ? 'c:' + x.dataset.sidCard : x.dataset.day ? 'd:' + x.dataset.day : 'n:' + x.className;
  const before = new Map(rows().map(x => [keyOf(x), x.getBoundingClientRect().top]));
  paintPanel('schedule', { force: true });
  const moved = [];
  rows().forEach(x => {
    const t0 = before.get(keyOf(x));
    if (t0 === undefined) { x.style.setProperty('--lv-d', '0ms'); x.classList.add('lv-enter'); return; }
    const dy = t0 - x.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    x.style.transition = 'none'; x.style.transform = `translateY(${dy}px)`; moved.push(x);
  });
  if (!moved.length) return;
  void sched.offsetWidth;
  moved.forEach(x => { x.style.transition = 'transform .28s var(--lv-ease)'; x.style.transform = ''; });
  setTimeout(() => moved.forEach(x => { x.style.transition = ''; }), 320);
}
// A repaint that rewrote the focused toggle (MY SCHEDULE losing a row, the counts shown) used to drop keyboard
// focus to <body>. It goes back to the same session's toggle, or — when that row has left the list — to the
// toggle of the row that took its place.
function focusedToggle() {
  const a = document.activeElement;
  if (!a || !a.matches || !a.matches('.lv-att[data-sid]') || !rootEl || !rootEl.contains(a)) return null;
  const list = [...rootEl.querySelectorAll('.lv-panel:not([hidden]) .lv-att[data-sid]')];
  return { id: a.dataset.sid, i: list.indexOf(a) };
}
function refocusToggle(f) {
  if (!f || !rootEl) return;
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected) return;
  let el = rootEl.querySelector(`.lv-panel:not([hidden]) [data-sid="${CSS.escape(f.id)}"]`);
  if (!el && f.i >= 0) { const list = [...rootEl.querySelectorAll('.lv-panel:not([hidden]) .lv-att[data-sid]')]; el = list[Math.min(f.i, list.length - 1)]; }
  if (el) try { el.focus({ preventScroll: true }); } catch (e) { /* fine */ }
}
function paintToggle(id) {
  const s = sessionById(id); if (!s) return;
  const kf = focusedToggle();
  const on = attending(id);
  each(`[data-sid="${CSS.escape(id)}"]`, el => { el.classList.toggle('on', on); el.classList.toggle('just', on); el.setAttribute('aria-checked', String(on)); el.textContent = on ? COPY.att.on : COPY.att.off; if (on) setTimeout(() => el.classList.remove('just'), 450); });
  each(`[data-sid-card="${CSS.escape(id)}"]`, el => el.classList.toggle('going', on));
  paintTabs({ bump: true });
  // tapped OFF inside MY SCHEDULE: the card fades out, then the rows below glide up into the gap. Until they
  // have settled, a second tap in the list is ignored — the next card is sliding under the finger (with reduced
  // motion it snaps there at once, so a quick double tap is held off just as long)
  const sched = q('[data-panel="schedule"]');
  const off = S.tab === 'schedule' && sched && !on && !speaking(id);
  const leaving = off && !calm() ? sched.querySelectorAll(`[data-sid-card="${CSS.escape(id)}"]`) : [];
  if (off) S.settleUntil = Date.now() + (leaving.length ? 520 : 400);
  if (leaving.length) {
    leaving.forEach(el => el.classList.add('lv-leaving'));
    const st = S; setTimeout(() => { if (S === st && rootEl) { reflowSchedule(); refocusToggle(kf); } }, 200);
  } else if (S.tab === 'schedule') { reflowSchedule(); refocusToggle(kf); }
  else paintPanel('schedule', { force: true });
}
// `scroll`: a tab the guest picked starts at its top; the programmatic calls (first paint, the network
// landing) never move a reader who has already started scrolling
function showTab(tab, { push, animate, scroll = true, glide } = {}) {
  if (!TABS.includes(tab)) tab = 'program';
  S.tab = tab; store.set(LS.tab, tab);
  const lv = rootEl.querySelector('.lv'); if (lv) lv.dataset.tab = tab;
  rootEl.querySelectorAll('.lv-tab').forEach(el => { const on = el.dataset.tab === tab; el.classList.toggle('on', on); el.setAttribute('aria-selected', String(on)); });
  rootEl.querySelectorAll('.lv-panel').forEach(el => { const on = el.dataset.panel === tab; el.hidden = !on; if (on && animate) enter(el); });
  placeInk(!!animate);
  // deep in a long program, a tab switch starts the new panel at its top (the tab bar is sticky, so
  // the reader never loses it) instead of landing mid-way through a shorter panel
  const tabs = q('[data-role="tabs"]'), panels = q('.lv-panels');
  if (scroll && tabs && panels) { const top = panels.getBoundingClientRect().top + window.scrollY - tabs.offsetHeight; if (window.scrollY > top + 4) window.scrollTo({ top: Math.max(0, top), behavior: glide && !calm() ? 'smooth' : 'auto' }); }
  if (push !== false) { try { const u = new URL(location.href); u.searchParams.set('tab', tab); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* fine */ } }
}

// ---- sheets (session · speaker) -----------------------------------------------------------------
// open: the scrim fades in and the sheet slides up (css). A sheet opened from a sheet (a speaker's session) is
// the same sheet turning a page: scrim and sheet hold still, the old page slides out to the left, the new one
// in from the right, and a quiet ← in the head turns back. Close: it slides away, then leaves the DOM, and
// focus goes back to what opened it. A sheet is made by a function, so a page turned back to is redrawn fresh.
function sheetHead(eyebrow) {
  const back = sheetStack.length ? `<span data-act="back" class="lv-sback" role="button" tabindex="0" aria-label="Back">${ICON_BACK}</span>` : '';
  return `<div class="lv-sheet-head">${back}<span class="lv-eyebrow ink">${eyebrow}</span><span data-act="close" class="lv-x" role="button" tabindex="0" aria-label="Close">${ICON_X}</span></div>`;
}
function openSheet(make) {
  if (sheet) { sheetStack.push(sheet._make); swapSheet(make, 1); return; }
  const from = document.activeElement;
  sheetStack = []; sheetFrom = from;
  const wrap = sheet = document.createElement('div');
  wrap.className = 'lv-sheet-wrap'; wrap._make = make;
  wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `<div class="lv-scrim" data-act="close"></div><div class="lv-sheet">${make()}</div>`;
  document.body.appendChild(wrap);
  ui.lockScroll(true);
  const behind = rootEl && rootEl.firstElementChild;
  if (behind) { behind.inert = true; wrap._inert = behind; }
  wrap._off = ui.bind(wrap, Object.assign({}, handlers, { close: () => closeSheet(), back: () => sheetBack() }));
  wrap._release = ui.trapFocus(() => wrap.querySelector('.lv-sheet'));   // Tab stays in the sheet (aria-modal alone let it walk out)
  grip(wrap);
  void wrap.offsetWidth;                                                // commit the closed pose so the slide runs
  wrap.classList.add('open');
  const x = wrap.querySelector('.lv-x'); if (x) try { x.focus({ preventScroll: true }); } catch (e) { /* fine */ }
}
// turn the open sheet's page: dir 1 = forward (out left, in from the right), -1 = back
function swapSheet(make, dir) {
  const wrap = sheet, el = wrap && wrap.querySelector('.lv-sheet'); if (!el) return;
  if (wrap._swap) wrap._swap();                                         // a turn already under way lands at once
  wrap._make = make;
  const put = () => {
    wrap._swap = null; clearTimeout(wrap._swapT);
    if (sheet !== wrap) return;
    const top0 = el.getBoundingClientRect().top;
    el.classList.remove('out-l', 'out-r');
    el.innerHTML = make(); el.scrollTop = 0;
    try { wrap._ungrip && wrap._ungrip(); } catch (e) { /* fine */ }
    grip(wrap);
    if (!calm()) {
      replay(el, dir > 0 ? 'in-r' : 'in-l', 420);
      // a taller page: the top edge glides up to its new place instead of jumping (the bottom stays put)
      const dy = top0 - el.getBoundingClientRect().top;
      if (dy > 1) {
        el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`; void el.offsetWidth;
        el.style.transition = 'transform .28s var(--lv-ease)'; el.style.transform = '';
        clearTimeout(el._ft); el._ft = setTimeout(() => { el.style.transition = ''; }, 320);
      }
    }
    const f = wrap.querySelector('.lv-sback') || wrap.querySelector('.lv-x'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* fine */ }
  };
  if (calm()) { put(); return; }
  el.style.minHeight = el.offsetHeight + 'px';                           // the sheet keeps its height: it never drops and re-rises
  el.classList.add(dir > 0 ? 'out-l' : 'out-r');
  wrap._swap = put; wrap._swapT = setTimeout(put, 160);             // the old page leaves on the exit timing
}
function sheetBack() { if (sheet && sheetStack.length) swapSheet(sheetStack.pop(), -1); }
function closeSheet({ instant } = {}) {
  if (!sheet) return;
  const wrap = sheet, from = sheetFrom; sheet = null; sheetFrom = null; sheetStack = [];
  clearTimeout(wrap._swapT); wrap._swap = null;
  try { wrap._off && wrap._off(); } catch (e) { /* fine */ }
  try { wrap._ungrip && wrap._ungrip(); } catch (e) { /* fine */ }
  try { wrap._release && wrap._release(); } catch (e) { /* fine */ }
  ui.lockScroll(false);
  if (wrap._inert) { wrap._inert.inert = false; wrap._inert = null; }
  if (instant || calm()) wrap.remove();
  else {
    const el = wrap.querySelector('.lv-sheet');
    if (el) { el.classList.remove('drag'); el.style.transform = ''; el.style.transition = ''; }  // a dragged sheet leaves from where the finger let go
    wrap.classList.remove('open'); wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 300);                              // the exit timing (--lv-sheet-exit) and a frame
  }
  if (!instant && from && from.isConnected && typeof from.focus === 'function') try { from.focus({ preventScroll: true }); } catch (e) { /* fine */ }
}
// phones: drag the sheet's head down to dismiss it (past 110 px, or a quick flick); short of that it springs back
function grip(wrap) {
  const el = wrap.querySelector('.lv-sheet'), head = wrap.querySelector('.lv-sheet-head');
  if (!el || !head || !window.PointerEvent) return;
  let id = null, y0 = 0, t0 = 0, dy = 0;
  const down = e => {
    if (e.pointerType === 'mouse' || e.target.closest('.lv-x')) return;
    id = e.pointerId; y0 = e.clientY; t0 = e.timeStamp; dy = 0;
    el.classList.add('drag'); try { head.setPointerCapture(id); } catch (err) { /* fine */ }
  };
  const move = e => { if (e.pointerId !== id) return; dy = Math.max(0, e.clientY - y0); el.style.transform = dy ? `translateY(${dy}px)` : ''; };
  const up = e => {
    if (e.pointerId !== id) return;
    id = null; el.classList.remove('drag');
    const flick = dy > 36 && dy / Math.max(16, e.timeStamp - t0) > 0.6;   // px per ms, timed by the events themselves
    if ((dy > 110 || flick) && sheet === wrap) closeSheet(); else el.style.transform = '';
    dy = 0;
  };
  head.addEventListener('pointerdown', down); head.addEventListener('pointermove', move);
  head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  wrap._ungrip = () => { head.removeEventListener('pointerdown', down); head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up); };
}
function sessionSheet(s) {
  const ev = eventOf(s.event_key) || {};
  const people = (s.speakers || []).filter(x => x && x.name).map(p => ({ name: p.name, sub: [p.title, p.institution].filter(Boolean).join(' · '), photo: p.photo_url }))
    .concat((s.speaker_names || []).filter(x => x && x.name).map(p => ({ name: p.name, sub: [p.institution, p.topic].filter(Boolean).join(' · '), photo: null })));
  const named = (s.room || '') + ' ' + (s.location_note || '');
  const v = venueOf(ev);
  const venue = v && !named.toLowerCase().includes(String(ev.venue).toLowerCase()) && !v.toLowerCase().includes(String(s.room || '—').toLowerCase()) ? v : null;
  const where = [s.room, s.location_note, venue].filter(Boolean).map(esc).join(' · ');
  return `
    ${sheetHead(`${esc(ev.short || ev.label || 'Plexus Week')} · ${esc(s.day_label || '')}`)}
    <div class="lv-sheet-body">
      <div class="lv-tags">${`<span class="lv-tag${s.kind === 'keynote' ? ' gold' : ''}">${kindLabel(s.kind)}</span>`}${s.is_tbd ? `<span class="lv-tag gold">${COPY.att.tbd}</span>` : ''}${speaking(s.id) ? `<span class="lv-tag red">${COPY.slots.speaking}</span>` : ''}</div>
      <h2 class="lv-sheet-title">${esc(s.title || 'Session')}</h2>
      <div class="lv-sheet-when">${esc(timeRange(s))}${duration(s) ? ` · ${esc(duration(s))}` : ''}</div>
      ${where ? `<div class="lv-sheet-sec"><span class="lv-info-label">${COPY.sheet.where}</span><div>${where}</div></div>` : ''}
      ${s.description ? `<div class="lv-sheet-sec"><span class="lv-info-label">${COPY.sheet.about}</span><div class="lv-prose">${esc(s.description).replace(/\n+/g, '<br>')}</div></div>` : ''}
      ${people.length ? `<div class="lv-sheet-sec"><span class="lv-info-label">${COPY.sheet.with}</span><div class="lv-people">${people.map(p => `<div class="lv-pp">${p.photo ? `<img class="lv-av lg" src="${esc(p.photo)}" alt="">` : `<span class="lv-av lg txt">${esc(initials(p.name))}</span>`}<span><b>${esc(p.name)}</b>${p.sub ? `<br><span class="lv-soft">${esc(p.sub)}</span>` : ''}</span></div>`).join('')}</div></div>` : ''}
      ${s.show_counts && (s.count || s.capacity) ? `<div class="lv-sheet-sec"><span class="lv-soft">${[s.count ? COPY.att.going(s.count) : null, s.capacity ? COPY.att.seats(s.capacity) : null].filter(Boolean).join(' · ')}</span></div>` : ''}
    </div>
    <div class="lv-sheet-foot">
      ${tplToggle(s)}
      <a class="lv-ics" href="${esc(icsUrl(`/api/live/${encodeURIComponent(s.event_key)}/sessions/${encodeURIComponent(s.id)}.ics`))}" download>${COPY.sheet.ics}</a>
    </div>`;
}
function speakerSheet(sp) {
  const mine = sessionsWith(S.current, sp);
  const sub = [sp.title, sp.institution].filter(Boolean).join(' · ');
  return `
    ${sheetHead(esc((eventOf(S.current) || {}).short || 'Speaker'))}
    <div class="lv-sheet-body">
      <div class="lv-pp big">${sp.photo_url ? `<img class="lv-av xl" src="${esc(sp.photo_url)}" alt="">` : `<span class="lv-av xl txt">${esc(initials(sp.name))}</span>`}<span><h2 class="lv-sheet-title">${esc(sp.name)}</h2>${sub ? `<div class="lv-soft">${esc(sub)}</div>` : ''}</span></div>
      ${sp.bio ? `<div class="lv-sheet-sec"><div class="lv-prose">${esc(sp.bio).replace(/\n+/g, '<br>')}</div></div>` : ''}
      ${mine.length ? `<div class="lv-sheet-sec"><span class="lv-info-label">${COPY.speakers.sessions}</span>${mine.map(s => `<div class="lv-mini" data-act="open" data-id="${esc(s.id)}"><span class="lv-mini-time">${esc(s.start_time || '—')}</span><span class="lv-mini-body"><b>${esc(s.title || 'Session')}</b><br><span class="lv-soft">${[s.day_label, s.room, duration(s)].filter(Boolean).map(esc).join(' · ')}</span></span>${tplToggle(s, { compact: true })}</div>`).join('')}</div>` : ''}
    </div>`;
}

// ---- handlers ----------------------------------------------------------------------------------
// MY SCHEDULE is closing a gap under the finger (paintToggle): a tap in the list waits until the rows have settled
const settling = el => S.settleUntil > Date.now() && !!el.closest('[data-panel="schedule"]');
const handlers = {
  // a new tab slides the ink and steps its rows in; the tab already open just returns to its top
  tab: el => showTab(el.dataset.tab, { animate: el.dataset.tab !== S.tab, glide: el.dataset.tab === S.tab }),
  ev: async el => { closeSheet(); await switchEvent(el.dataset.key); },
  allEvents: () => { S.showAll = !S.showAll; paintSwitch(); const sw = q('[data-role="switch"]'); revealChip(sw, sw && sw.querySelector('.lv-chip.ghost'), true); },
  open: el => { if (settling(el)) return; const id = el.dataset.id, s = sessionById(id); if (s) openSheet(() => sessionSheet(sessionById(id) || s)); },
  spk: el => { const sp = currentSpeakers()[Number(el.dataset.i)]; if (sp) openSheet(() => speakerSheet(sp)); },
  icsMine: el => {
    const list = el.dataset.session ? [sessionById(el.dataset.session)].filter(Boolean) : mySchedule().list.filter(s => s.event_date === el.dataset.date);
    const evs = list.filter(s => s.starts_at).map(s => {
      const ev = eventOf(s.event_key) || {};
      const v = venueOf(ev), room = String(s.room || '');
      const location = !room ? v : v && v.toLowerCase().includes(room.toLowerCase()) ? v : [room, v].filter(Boolean).join(', ');   // never "Room, Room, Hall"
      return { uid: 'live-' + s.id, startAt: s.starts_at, endAt: s.ends_at || s.starts_at, summary: s.title || 'Session', location, description: ev.label || '' };
    });
    if (!evs.length) return ui.toast(COPY.schedule.icsNone);
    ui.downloadIcs(el.dataset.session ? 'plexus-week-session.ics' : `plexus-week-${el.dataset.date}.ics`, evs);
    ui.toast(COPY.schedule.icsDone);
  },
  close: () => closeSheet(),
  back: () => sheetBack(),
  refresh: async el => { el.classList.add('busy'); try { await refreshAll({ toastOnSame: true }); } finally { el.classList.remove('busy'); } },
  reload: () => location.reload(),
  att: async el => {
    const id = el.dataset.id; const s = sessionById(id); if (!s) return;
    if (!S.token) return ui.toast(COPY.att.ticket);
    if (S.mePending) return;
    if (settling(el)) return;
    if (!canToggle(s.event_key) && !speaking(id)) return ui.toast(COPY.att.notHeld);
    if (el.getAttribute('aria-busy') === 'true') return;
    const was = S.attendance[id], next = attending(id) ? 'declined' : 'attending';
    S.attendance[id] = next; paintToggle(id);                          // optimistic
    el.setAttribute('aria-busy', 'true');
    try { await attend(id, next); if (s.show_counts) { const kf = focusedToggle(); paintAll(); refocusToggle(kf); } }
    catch (e) { S.attendance[id] = was; paintToggle(id); ui.toast(e.status === 403 ? COPY.att.notHeld : (e.message || COPY.att.failed), { kind: 'error' }); }
    finally { each(`[data-sid="${CSS.escape(id)}"]`, x => x.removeAttribute('aria-busy')); }
  }
};

// ---- flows -------------------------------------------------------------------------------------
async function switchEvent(key) {
  if (!key || key === S.current) return;
  S.current = key; store.set(LS.event(S.token || 'anon'), key);
  try { const u = new URL(location.href); u.searchParams.set('event', key); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* fine */ }
  if (!S.programs[key]) loadCached(key);
  const st = S;
  paintAll();                                                           // another event: the open panel steps in
  if (!S.programs[key] || navigator.onLine !== false) { try { await fetchProgram(key); } catch (e) { if (S === st && !S.programs[key]) ui.toast(e.message, { kind: 'error' }); } if (S === st) paintAll(); }
}
async function refreshAll({ toastOnSame } = {}) {
  const key = S.current; if (!key) return;
  const since = S.programs[key] && S.programs[key].updated_at;
  try {
    const r = await fetchProgram(key, { since });
    S.lastPoll = Date.now();
    const was = S.offline; S.offline = false;
    if (r.changed) { paintAll(); ui.toast(COPY.updated); }
    else { if (was) paintAll(); if (toastOnSame) ui.toast('Up to date.'); }
  } catch (e) {
    // a failed poll (status 0: no network) marks the program as the last one loaded — the footer says so
    if (e && e.status === 0 && S && !S.offline) { S.offline = true; paintAll(); }
    if (toastOnSame) ui.toast(e && e.status === 0 ? COPY.offline : e.message, { kind: 'error' });
  }
}
function startTimers() {
  timers.push((() => { const id = setInterval(() => { if (document.visibilityState === 'visible') refreshAll(); }, POLL_MS); return () => clearInterval(id); })());
  timers.push((() => { const id = setInterval(() => setHtml(q('[data-role="now"]'), tplNow()), TICK_MS); return () => clearInterval(id); })());
  onVis = () => { if (document.visibilityState === 'visible' && Date.now() - (S.lastPoll || 0) > 20000) refreshAll(); };
  document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis);
  onKey = e => { if (e.key === 'Escape' && sheet) closeSheet(); };
  document.addEventListener('keydown', onKey);
}

// 1) the first paint, synchronous, from what this device already knows: the program, the attendance, the
// person and the event catalogue as they were last loaded (or skeletons). The router's screen fade frames it.
function open(ctx) {
  const token = (ctx.params && ctx.params.token) || (ctx.path.startsWith('/app/live') || session.isAuthed ? 'user' : null);
  S = { token, tab: 'program', events: [], programs: {}, attendance: {}, person: null, speakerIds: [], current: null, showAll: false, lastPoll: 0, roster: {}, offline: false };
  const qTab = ctx.query && ctx.query.tab; const savedTab = store.get(LS.tab);
  S.tab = TABS.includes(qTab) ? qTab : (TABS.includes(savedTab) ? savedTab : 'program');
  let meCurrent = null;
  if (token) {
    S.attendance = store.get(LS.att(token)) || {};
    const k = meKey(token), me = k ? store.get(LS.me(k)) : null;
    if (me && me.person && Array.isArray(me.person.events)) {
      S.person = me.person; S.speakerIds = me.person.speaker_session_ids || []; meCurrent = me.current || null;
      if (Array.isArray(me.events) && me.events.length) S.events = me.events;
      // every held event's last program, not only the current one: offline (fetchMe fails, so the loop in
      // hydrate never runs) MY SCHEDULE used to drop the Gala and every other held event
      me.person.events.forEach(k => { if (!S.programs[k]) loadCached(k); });
    }
  }
  if (!S.events.length && !S.person) { const evs = store.get(LS.events); if (Array.isArray(evs) && evs.length) S.events = evs; }
  S.mePending = !!token && !S.person;                                   // a first visit: the ticket is still being read
  S.eventsPending = !S.events.length;
  const wantEvent = (ctx.query && ctx.query.event) || store.get(LS.event(token || 'anon'));
  const known = k => !!k && S.events.some(e => e.key === k);
  let cur = null;
  if (wantEvent && (loadCached(wantEvent) || known(wantEvent))) cur = wantEvent;
  if (!cur && S.events.length) { cur = known(meCurrent) ? meCurrent : guessEvent(S.events, S.person ? S.person.events : []); if (cur) loadCached(cur); }
  S.current = cur;
  if (cur && !known(cur) && S.programs[cur]) S.events = S.events.concat([Object.assign({ key: cur }, S.programs[cur].event || {})]);
  rootEl.innerHTML = tplShell();
  unbind = ui.bind(rootEl, handlers);
  paintAll(); showTab(S.tab, { push: false, scroll: false });
  hydrate(token, wantEvent).catch(e => { if (S && rootEl) console.warn('[live]', e && e.message); });
}
// 2) the network: who + which events (+ every held program in parallel), then repaint in place.
// `live()` — the guest may leave the app while the backend wakes; a late answer then paints nothing.
async function hydrate(token, wantEvent) {
  const st = S, live = () => S === st && !!rootEl;
  try {
    if (token) {
      try { await fetchMe(); }
      catch (e) {
        if (!live()) return;
        if (e.status === 404 || e.status === 401) {                     // not (or no longer) a ticket: the anonymous app
          const k = meKey(token); if (k) store.set(LS.me(k), null);
          S.token = null; S.person = null; S.speakerIds = []; S.meError = e;
          if (token !== 'user') ui.toast(COPY.badLink, { kind: 'error', ms: 5000 });
        } else throw e;
      } finally { if (live()) S.mePending = false; }
    }
    if (!live()) return;
    if (!S.person || S.eventsPending) await fetchEvents();
    if (!live()) return;
    const mine = S.person ? S.person.events : [];
    const chosen = (wantEvent && S.events.some(e => e.key === wantEvent) && (!S.person || mine.includes(wantEvent) || !mine.length || S.showAll)) ? wantEvent : null;
    S.current = chosen || (S.person && S.current && S.events.some(e => e.key === S.current) ? S.current : guessEvent(S.events, mine));
    if (S.current) store.set(LS.event(token || 'anon'), S.current);
    const keys = Array.from(new Set([S.current].concat(mine).filter(Boolean)));
    keys.forEach(k => { if (!S.programs[k]) loadCached(k); });
    paintAll();
    await Promise.all(keys.map(k => fetchProgram(k).catch(e => { if (e && e.status === 0 && S === st) S.offline = true; if (S && !S.programs[k]) console.warn('[live] program failed', k, e.message); })));
    if (!live()) return;
    S.lastPoll = Date.now();
    // (a member with no ticket: the program and MY SCHEDULE say so in place, with the way to register —
    //  it used to be a 6-second toast that also floated over the next screen)
  } catch (e) {
    if (!live()) return;
    S.mePending = false; S.eventsPending = false;
    if (e && e.status === 0) S.offline = true;
    if (e && e.status === 0 && S.current && S.programs[S.current]) ui.toast(COPY.offline, { ms: 5000 });
    else if (!S.current) rootEl.innerHTML = `<div class="lv"><div class="lv-empty tall"><span class="lv-rule"></span><span class="lv-empty-line">${esc(e && e.message || 'Something went wrong.')}</span><span data-act="reload" class="lv-att lv-retry">${COPY.refresh}</span></div></div>`;
  }
  paintAll(); showTab(S.tab, { push: false, scroll: false });
  startTimers();
}

export default {
  title: () => 'Plexus Week Live',
  layout: 'bare',
  async render(root, ctx) {
    rootEl = root;
    await ensureCss();
    if (rootEl !== root || (ctx.ready && !(await ctx.ready()))) return;
    setThemeColor('#191512');
    // the sheet locks the page scroll; a reserved gutter keeps a desktop scrollbar from shifting the layout
    try { document.documentElement.style.scrollbarGutter = 'stable'; } catch (e) { /* fine */ }
    // resolve on the first paint — the router's fade then frames the screen the guest is already reading, and
    // never blanks it again when the network (or a waking backend, up to a minute) answers
    open(ctx);
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) { /* fine */ } }); timers = [];
    if (onVis) { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); onVis = null; }
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
    if (inkRO) { inkRO.disconnect(); inkRO = null; }
    try { document.documentElement.style.scrollbarGutter = ''; } catch (e) { /* fine */ }
    closeSheet({ instant: true });
    ui.hideToast();                                                     // a toast about this app never floats over the next screen
    if (unbind) unbind(); unbind = null;
    rootEl = null; S = null;
  }
};
