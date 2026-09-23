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
    now: 'NOW', next: 'NEXT', endsIn: m => `ends in ${m}`, inMin: m => `in ${m}`,
    startsAt: (t, doors) => `Starts at ${t}${doors ? ` · doors ${doors}` : ''}`,
    startsOn: (d, t) => `${d}${t ? ` · ${t}` : ''}`, ended: d => `This event has ended · ${d}`,
    over: 'That was the last session — thank you for coming.', tbd: 'Times to be confirmed'
  },
  slots: { title: 'YOUR SLOTS', sub: 'Where you speak', speaking: 'SPEAKING' },
  att: { on: 'IN MY SCHEDULE', off: 'ADD TO MY SCHEDULE', speaking: 'YOU SPEAK HERE', meetup: 'YOUR PLACE IS HELD', tbd: 'TBD', over: 'OVERLAPS', going: n => `${n} going`, seats: n => `${n} seats`,
    ticket: 'Open this from your ticket link to build your schedule.',
    notHeld: 'This event is not on your ticket — the program is shown read-only.',
    failed: 'That did not save — check the connection and tap again.' },
  program: { empty: 'The program is being written — check back soon.', tbdDay: 'Date to be confirmed' },
  schedule: {
    emptyLine: 'Nothing here yet.', emptyWhy: 'Everything you registered for appears here on its own — and anything you add from the program.',
    auto: 'Built from your registration — tap a session off if you will skip it.',
    ics: 'ADD TO CALENDAR', icsDay: 'ADD DAY TO CALENDAR', conflict: 'Two of your sessions overlap.'
  },
  speakers: { empty: 'Speakers are announced closer to the event.', sessions: 'SESSIONS', tbdSpeaker: 'To be announced' },
  info: {
    venue: 'VENUE', when: 'WHEN', dress: 'DRESS CODE', contact: 'CONTACT', wifi: 'WI-FI', apple: 'Apple Maps →', google: 'Google Maps →',
    tentative: 'Date and venue tentative — confirmed by email.', timesTbd: 'Exact times to be confirmed.',
    tz: tz => tz === 'America/New_York' ? 'Boston time' : 'Zagreb time'
  },
  updated: 'Program updated', offline: 'Offline — showing the last program you loaded.',
  badLink: 'That link is not one of ours — open the app from your ticket.',
  noEvents: 'No tickets are linked to this account yet — register for Plexus Week and your events appear here.',
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
const LS = { program: k => 'live:program:' + k, att: t => 'live:attendance:' + t, event: t => 'live:event:' + t, tab: 'live:tab' };
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

// ---- state -------------------------------------------------------------------------------------
let S = null, rootEl = null, unbind = null, timers = [], sheet = null, onVis = null, onKey = null;

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
const pad = n => String(n).padStart(2, '0');
const localYmd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = iso => (iso ? new Date(iso).getTime() : NaN);
const rel = ms => {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'a moment';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'}`;
};
const duration = s => { const m = Math.round((at(s.ends_at) - at(s.starts_at)) / 60000); if (!isFinite(m) || m <= 0) return ''; return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`) : `${m} min`; };
const timeRange = s => s.start_time ? `${s.start_time}${s.end_time ? '–' + s.end_time : ''}` : COPY.now.tbd;
const clock = ts => { const d = new Date(ts || Date.now()); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayParts = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3]); return { n: Number(m[3]), dow: DOW[d.getDay()], mon: MON[Number(m[2]) - 1].toUpperCase(), year: m[1] }; };
// "Dr. Yi-Hsiang (Sean) Hsu" → "YH", "prim. dr. Gzim Redžepi" → "GR": titles and nicknames dropped, letters only
const initials = name => String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\b(prof|dr|prim|mr|mrs|ms|md|phd)\.?\s+/gi, ' ').split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
const kindLabel = k => KIND_LABEL[k] || KIND_LABEL.other;
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
async function fetchMe() {
  const tok = S.token;
  const r = await api.get(`/api/live/me/${encodeURIComponent(tok)}?today=${localYmd()}`, { noAuth: tok !== 'user', keepSession: true });
  S.person = r.person; S.events = r.events; S.speakerIds = r.person.speaker_session_ids || [];
  S.attendance = Object.assign({}, r.attendance || {});               // the server is the truth
  store.set(LS.att(tok), S.attendance);
  S.current = r.current_event;
  S.meError = null;
}
async function fetchEvents() {
  const r = await api.get(`/api/live/events?today=${localYmd()}`, { noAuth: true });
  S.events = r.events || [];
}
async function fetchProgram(key, { since } = {}) {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  const r = await api.get(`/api/live/${encodeURIComponent(key)}/program${q}`, { noAuth: true });
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
  if (list.length && !next) return { mode: 'ended', ev, last: list[list.length - 1] };
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
function tplHeader() {
  const ev = eventOf(S.current) || {};
  const p = S.person;
  const party = p && ev.key ? Number(p.party && p.party[ev.key]) : 0;
  const who = p ? `${esc(p.first_name)}${party > 1 ? ` · ${esc(COPY.party(party))}` : ''}` : '';
  const back = session.isAuthed ? `<a href="/app/home" class="lv-back">${COPY.portal}</a>` : '';
  const meta = [ev.date_label, ev.start ? (ev.times_tbd ? `${ev.start} (tbc)` : `${ev.start}${ev.end ? '–' + ev.end : ''}`) : null, ev.venue].filter(Boolean).map(esc).join(' · ');
  return `
    <div class="lv-head-row">
      <span class="lv-eyebrow">${COPY.eyebrow}</span>
      <span class="lv-who">${who}</span>${back}
    </div>
    <h1 class="lv-title">${esc(ev.label || 'Plexus Week')}</h1>
    <div class="lv-meta">${meta || COPY.loading}</div>
    ${tplSwitcher()}`;
}
function tplSwitcher() {
  const events = S.events || [];
  if (!events.length) return '';
  const mine = heldEvents();
  const showAll = S.showAll || !S.token || !mine.length;
  const list = showAll ? events : mine;
  if (list.length <= 1 && !(mine.length && events.length > mine.length)) return '';
  const chip = e => `<span data-act="ev" data-key="${esc(e.key)}" class="lv-chip${e.key === S.current ? ' on' : ''}${held(e.key) || !S.token ? '' : ' ro'}" role="tab" aria-selected="${e.key === S.current}">${esc(e.short || e.label)}${e.is_live ? '<i class="lv-dot" aria-label="live now"></i>' : ''}</span>`;
  const more = (S.token && mine.length && events.length > mine.length)
    ? `<span data-act="allEvents" class="lv-chip ghost" role="button">${showAll ? COPY.switcher.mine : COPY.switcher.all} ${showAll ? '▴' : '▾'}</span>` : '';
  return `<div class="lv-switch" role="tablist" aria-label="Events">${list.map(chip).join('')}${more}</div>`;
}
function tplNow() {
  const key = S.current; if (!key) return '';
  const nn = nowNext(key); const now = Date.now();
  const card = (label, s, sub, live) => `
    <div class="lv-now-item${live ? ' live' : ''}" data-act="open" data-id="${esc(s.id)}">
      <span class="lv-now-label">${live ? '<i class="lv-pulse" aria-hidden="true"></i>' : ''}${label}</span>
      <span class="lv-now-title">${esc(s.title || 'Session')}${s.is_tbd ? ' <em>TBD</em>' : ''}</span>
      <span class="lv-now-sub">${[s.room, sub].filter(Boolean).map(esc).join(' · ')}</span>
    </div>`;
  if (nn.mode === 'live') return card(COPY.now.now, nn.now, COPY.now.endsIn(rel(at(nn.now.ends_at) - now)), true) + (nn.next ? card(COPY.now.next, nn.next, COPY.now.inMin(rel(at(nn.next.starts_at) - now)), false) : '');
  if (nn.mode === 'gap') return card(COPY.now.next, nn.next, COPY.now.inMin(rel(at(nn.next.starts_at) - now)), false);
  const ev = nn.ev || {};
  if (nn.mode === 'today') return `<div class="lv-now-line"><span class="lv-now-label">${COPY.now.next}</span><span class="lv-now-title">${esc(COPY.now.startsAt(nn.start.start_time, nn.doors ? nn.doors.start_time : null))}</span><span class="lv-now-sub">${esc(COPY.now.inMin(rel(at(nn.next.starts_at) - now)))}${ev.venue ? ' · ' + esc(ev.venue) : ''}</span></div>`;
  if (nn.mode === 'ended') return `<div class="lv-now-line ended"><span class="lv-now-label">${COPY.now.now}</span><span class="lv-now-title">${esc(COPY.now.ended(ev.date_label || ''))}</span><span class="lv-now-sub">${COPY.now.over}</span></div>`;
  if (nn.mode === 'tbd') return `<div class="lv-now-line"><span class="lv-now-label">${COPY.now.next}</span><span class="lv-now-title">${esc(ev.date_label || COPY.now.tbd)}</span><span class="lv-now-sub">${esc(ev.times_tbd || ev.tentative ? COPY.info.tentative : COPY.now.tbd)}</span></div>`;
  const first = nn.next;
  return `<div class="lv-now-line"><span class="lv-now-label">${COPY.now.next}</span><span class="lv-now-title">${esc(COPY.now.startsOn(ev.date_label || first.day_label, first.start_time))}</span><span class="lv-now-sub">${esc(COPY.now.inMin(rel(at(first.starts_at) - now)))}${ev.venue ? ' · ' + esc(ev.venue) : ''}</span></div>`;
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
function tplTabs() {
  const n = S.token ? mySchedule().list.length : 0;
  return TABS.map(t => `<span data-act="tab" data-tab="${t}" role="tab" aria-selected="${S.tab === t}" class="lv-tab${S.tab === t ? ' on' : ''}">${COPY.tabs[t]}${t === 'schedule' && n ? `<b class="lv-count">${n}</b>` : ''}</span>`).join('');
}
function tplSpeakersRow(s) {
  const people = (s.speakers || []).filter(x => x && x.name);
  const names = (s.speaker_names || []).filter(x => x && x.name);
  if (!people.length && !names.length) return '';
  const av = p => p.photo_url ? `<img class="lv-av" src="${esc(p.photo_url)}" alt="" loading="lazy">` : `<span class="lv-av txt">${esc(initials(p.name))}</span>`;
  const all = people.map(p => ({ name: p.name, av: av(p) })).concat(names.map(p => ({ name: p.name, av: null })));
  const shown = all.slice(0, 3), rest = all.length - shown.length;
  return `<div class="lv-spk"><span class="lv-avs">${shown.filter(x => x.av).map(x => x.av).join('')}</span><span class="lv-spk-names">${shown.map(x => esc(x.name)).join(', ')}${rest > 0 ? ` <b>+${rest} more</b>` : ''}</span></div>`;
}
function tplToggle(s, { compact } = {}) {
  const on = attending(s.id), spk = speaking(s.id), ok = canToggle(s.event_key) || spk;
  if (spk) return `<span class="lv-att speak" aria-disabled="true">${COPY.att.speaking}</span>`;
  if (isMeetupSlot(s)) return `<span class="lv-att speak" aria-disabled="true">${COPY.att.meetup}</span>`;
  // a read-only toggle stays tappable on purpose: the tap answers with the one-line reason (ticket link /
  // not on your ticket) — ui.bind() would swallow the click on an aria-disabled element
  return `<span data-act="att" data-id="${esc(s.id)}" data-sid="${esc(s.id)}" role="switch" aria-checked="${on}" aria-label="${esc((on ? 'Attending: ' : 'Attend: ') + (s.title || 'session'))}" class="lv-att${on ? ' on' : ''}${ok ? '' : ' ro'}${compact ? ' compact' : ''}"${ok ? '' : ` title="${esc(S.token ? COPY.att.notHeld : COPY.att.ticket)}"`}>${on ? COPY.att.on : COPY.att.off}</span>`;
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
  const when = schedule ? `${esc(timeRange(s))}${duration(s) ? ` · ${esc(duration(s))}` : ''}` : `${s.end_time ? `→ ${esc(s.end_time)}` : ''}${duration(s) ? ` · ${esc(duration(s))}` : ''}`;
  const evLine = schedule && heldEvents().length > 1 ? `<span class="lv-card-ev">${esc(ev.short || ev.label || '')}</span>` : '';
  return `
    <article class="${cls}" data-sid-card="${esc(s.id)}">
      <div class="lv-card-body" data-act="open" data-id="${esc(s.id)}">
        <div class="lv-card-top"><span class="lv-when">${when}</span><span class="lv-tags">${tags}</span></div>
        ${evLine}
        <h3 class="lv-card-title">${esc(s.title || 'Session')}</h3>
        ${tplSpeakersRow(s)}
        ${where ? `<div class="lv-where"><svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><path d="M6 13.3S1 8.4 1 5.2a5 5 0 0 1 10 0c0 3.2-5 8.1-5 8.1Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="5.2" r="1.7" fill="currentColor"/></svg>${where}</div>` : ''}
      </div>
      <div class="lv-card-foot">
        ${tplToggle(s)}
        ${schedule && S.token ? `<a class="lv-ics" href="${esc(icsUrl(`/api/live/me/${encodeURIComponent(S.token)}/schedule.ics?session=${encodeURIComponent(s.id)}`))}" download>${COPY.schedule.ics}</a>` : ''}
      </div>
    </article>`;
}
function tplDayHead(date, extra) {
  const d = dayParts(date);
  return `<div class="lv-day">${d ? `<span class="lv-day-n">${d.n}</span><span class="lv-day-t">${d.dow} · ${d.mon}</span>` : `<span class="lv-day-t">${COPY.program.tbdDay}</span>`}${extra || ''}</div>`;
}
function tplProgram() {
  const key = S.current; const prog = S.programs[key];
  if (!prog) return tplSkeleton();
  const sessions = prog.sessions || [];
  if (!sessions.length) return `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.program.empty}</span></div>`;
  const notice = S.token && !held(key) && !sessions.some(s => speaking(s.id)) ? `<div class="lv-note">${COPY.att.notHeld}</div>` : (!S.token ? `<div class="lv-note">${COPY.att.ticket}</div>` : '');
  return notice + groupDays(sessions).map(day => {
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
  const { list, conflicts } = mySchedule();
  if (!list.length) return `<div class="lv-empty"><span class="lv-rule"></span><span class="lv-empty-line">${COPY.schedule.emptyLine}</span><span class="lv-empty-why">${COPY.schedule.emptyWhy}</span></div>`;
  const tok = encodeURIComponent(S.token);
  const auto = S.person && S.person.events.length ? `<div class="lv-note soft">${COPY.schedule.auto}</div>` : '';
  return auto + (conflicts.size ? `<div class="lv-note warn">${COPY.schedule.conflict}</div>` : '') + groupDays(list).map(day => {
    const dayIcs = day.date ? `<a class="lv-ics day" href="${esc(icsUrl(`/api/live/me/${tok}/schedule.ics?date=${day.date}`))}" download>${COPY.schedule.icsDay}</a>` : '';
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
function tplSpeakers() {
  const list = speakerList(S.current);
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
  const q = encodeURIComponent([ev.venue, ev.address].filter(Boolean).join(', '));
  const dress = ev.dress_code || DRESS[ev.key] || null;
  const when = [ev.date_label, ev.start ? `${ev.start}${ev.end ? '–' + ev.end : ''}` : null].filter(Boolean).join(' · ');
  const row = (label, body) => body ? `<div class="lv-info-row"><span class="lv-info-label">${label}</span><div class="lv-info-body">${body}</div></div>` : '';
  return `
    ${row(COPY.info.venue, `<b>${esc(ev.venue || '—')}</b>${ev.address ? `<br>${esc(ev.address)}` : ''}${ev.tentative ? `<br><i>${COPY.info.tentative}</i>` : ''}${q && !/to be announced/i.test(ev.venue || '') ? `<div class="lv-links"><a href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">${COPY.info.apple}</a><a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${COPY.info.google}</a></div>` : ''}`)}
    ${row(COPY.info.when, `<b>${esc(when || '—')}</b>${ev.tz ? `<br>${esc(COPY.info.tz(ev.tz))}` : ''}${ev.times_tbd ? `<br><i>${COPY.info.timesTbd}</i>` : ''}`)}
    ${row(COPY.info.dress, dress ? `<b>${esc(dress)}</b>` : '')}
    ${ev.wifi ? row(COPY.info.wifi, `<b>${esc(ev.wifi)}</b>`) : ''}
    ${row(COPY.info.contact, `<b>${esc(CONTACT.name)}</b><br><a href="mailto:${CONTACT.email}">${CONTACT.email}</a>`)}`;
}
// wide screens only (css): the event at a glance beside the program — where, when, what to wear, who to call
function tplGlance() {
  const ev = eventOf(S && S.current) || {};
  if (!ev.key) return '';
  const q = encodeURIComponent([ev.venue, ev.address].filter(Boolean).join(', '));
  const dress = ev.dress_code || DRESS[ev.key] || null;
  const when = [ev.date_label, ev.start ? `${ev.start}${ev.end ? '–' + ev.end : ''}` : null].filter(Boolean).join(' · ');
  return `
    <span class="lv-eyebrow ink">AT A GLANCE</span>
    <dl class="lv-glance-list">
      <dt>${COPY.info.venue}</dt><dd><b>${esc(ev.venue || '—')}</b>${ev.address ? `<br>${esc(ev.address)}` : ''}${q && !/to be announced/i.test(ev.venue || '') ? `<br><a class="lv-glance-map" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${COPY.info.google}</a>` : ''}</dd>
      <dt>${COPY.info.when}</dt><dd>${esc(when || '—')}${ev.tz ? `<br><span class="lv-soft">${esc(COPY.info.tz(ev.tz))}</span>` : ''}</dd>
      ${dress ? `<dt>${COPY.info.dress}</dt><dd>${esc(dress)}</dd>` : ''}
      <dt>${COPY.info.contact}</dt><dd>${esc(CONTACT.name)}<br><a href="mailto:${CONTACT.email}">${CONTACT.email}</a></dd>
    </dl>`;
}
function tplSkeleton() {
  const sk = '<div class="lv-sk"></div>';
  return `<div class="lv-day"><span class="lv-sk short"></span></div><div class="lv-block"><div class="lv-block-time"><span class="lv-sk tiny"></span></div><div class="lv-block-cards">${sk}${sk}</div></div>`;
}
function tplShell() {
  return `
  <div class="lv" data-screen-label="Plexus Week Live">
    <header class="lv-head" data-role="head">${tplHeader()}</header>
    <aside class="lv-side">
      <section class="lv-now" data-role="now" aria-live="polite">${tplNow()}</section>
      <section class="lv-slots" data-role="slots">${tplSlots()}</section>
      <section class="lv-glance" data-role="glance">${tplGlance()}</section>
    </aside>
    <nav class="lv-tabs" data-role="tabs" role="tablist">${tplTabs()}</nav>
    <main class="lv-panels">
      ${TABS.map(t => `<section class="lv-panel" data-panel="${t}" role="tabpanel"${S.tab === t ? '' : ' hidden'}></section>`).join('')}
    </main>
    <footer class="lv-foot"><span data-role="foot">${esc(COPY.foot(''))}</span><span data-act="refresh" class="lv-refresh">${COPY.refresh}</span></footer>
  </div>`;
}

// ---- rendering ---------------------------------------------------------------------------------
const q = sel => rootEl && rootEl.querySelector(sel);
function paintPanel(tab) {
  const el = q(`[data-panel="${tab}"]`); if (!el) return;
  el.innerHTML = tab === 'program' ? tplProgram() : tab === 'schedule' ? tplSchedule() : tab === 'speakers' ? tplSpeakers() : tplInfo();
}
function paintAll() {
  if (!rootEl) return;
  const y = window.scrollY;
  const head = q('[data-role="head"]'); if (head) head.innerHTML = tplHeader();
  const now = q('[data-role="now"]'); if (now) now.innerHTML = tplNow();
  const slots = q('[data-role="slots"]'); if (slots) { slots.innerHTML = tplSlots(); slots.hidden = !slots.innerHTML.trim(); }
  const glance = q('[data-role="glance"]'); if (glance) glance.innerHTML = tplGlance();
  const tabs = q('[data-role="tabs"]'); if (tabs) tabs.innerHTML = tplTabs();
  TABS.forEach(paintPanel);
  const ev = eventOf(S.current) || {};
  const foot = q('[data-role="foot"]'); if (foot) foot.textContent = COPY.foot(S.programs[S.current] && S.programs[S.current].updated_at ? clock(S.programs[S.current].updated_at) : '');
  document.title = `${ev.label ? ev.label + ' · ' : ''}Plexus Week Live · Med&X`;
  window.scrollTo(0, y);
}
function paintToggle(id) {
  const s = sessionById(id); if (!s) return;
  rootEl.querySelectorAll(`[data-sid="${CSS.escape(id)}"]`).forEach(el => { const on = attending(id); el.classList.toggle('on', on); el.classList.toggle('just', on); el.setAttribute('aria-checked', String(on)); el.textContent = on ? COPY.att.on : COPY.att.off; if (on) setTimeout(() => el.classList.remove('just'), 450); });
  rootEl.querySelectorAll(`[data-sid-card="${CSS.escape(id)}"]`).forEach(el => el.classList.toggle('going', attending(id)));
  const tabs = q('[data-role="tabs"]'); if (tabs) tabs.innerHTML = tplTabs();
  paintPanel('schedule');
}
function showTab(tab, { push } = {}) {
  if (!TABS.includes(tab)) tab = 'program';
  S.tab = tab; store.set(LS.tab, tab);
  rootEl.querySelectorAll('.lv-tab').forEach(el => { const on = el.dataset.tab === tab; el.classList.toggle('on', on); el.setAttribute('aria-selected', String(on)); });
  rootEl.querySelectorAll('.lv-panel').forEach(el => { const on = el.dataset.panel === tab; if (on) { el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); } else el.hidden = true; });
  // deep in a long program, a tab switch starts the new panel at its top (the tab bar is sticky, so
  // the reader never loses it) instead of landing mid-way through a shorter panel
  const tabs = q('[data-role="tabs"]'), panels = q('.lv-panels');
  if (tabs && panels) { const top = panels.getBoundingClientRect().top + window.scrollY - tabs.offsetHeight; if (window.scrollY > top + 4) window.scrollTo(0, Math.max(0, top)); }
  if (push !== false) { try { const u = new URL(location.href); u.searchParams.set('tab', tab); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* fine */ } }
}

// ---- sheets (session · speaker) -----------------------------------------------------------------
function openSheet(html) {
  closeSheet();
  sheet = document.createElement('div');
  sheet.className = 'lv-sheet-wrap';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<div class="lv-scrim" data-act="close"></div><div class="lv-sheet">${html}</div>`;
  document.body.appendChild(sheet);
  ui.lockScroll(true);
  const off = ui.bind(sheet, Object.assign({}, handlers, { close: closeSheet }));
  sheet._off = off;
  requestAnimationFrame(() => sheet && sheet.classList.add('open'));
  const first = sheet.querySelector('[data-act="close"].lv-x'); if (first) first.focus();
}
function closeSheet() {
  if (!sheet) return;
  try { sheet._off && sheet._off(); } catch (e) { /* fine */ }
  sheet.remove(); sheet = null; ui.lockScroll(false);
}
function sessionSheet(s) {
  const ev = eventOf(s.event_key) || {};
  const people = (s.speakers || []).filter(x => x && x.name).map(p => ({ name: p.name, sub: [p.title, p.institution].filter(Boolean).join(' · '), photo: p.photo_url }))
    .concat((s.speaker_names || []).filter(x => x && x.name).map(p => ({ name: p.name, sub: [p.institution, p.topic].filter(Boolean).join(' · '), photo: null })));
  const named = (s.room || '') + ' ' + (s.location_note || '');
  const venue = ev.venue && !named.toLowerCase().includes(String(ev.venue).toLowerCase()) && !String(ev.venue).toLowerCase().includes(String(s.room || '—').toLowerCase()) ? ev.venue : null;
  const where = [s.room, s.location_note, venue].filter(Boolean).map(esc).join(' · ');
  return `
    <div class="lv-sheet-head"><span class="lv-eyebrow ink">${esc(ev.short || ev.label || 'Plexus Week')} · ${esc(s.day_label || '')}</span><span data-act="close" class="lv-x" role="button" aria-label="Close">×</span></div>
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
    <div class="lv-sheet-head"><span class="lv-eyebrow ink">${esc((eventOf(S.current) || {}).short || 'Speaker')}</span><span data-act="close" class="lv-x" role="button" aria-label="Close">×</span></div>
    <div class="lv-sheet-body">
      <div class="lv-pp big">${sp.photo_url ? `<img class="lv-av xl" src="${esc(sp.photo_url)}" alt="">` : `<span class="lv-av xl txt">${esc(initials(sp.name))}</span>`}<span><h2 class="lv-sheet-title">${esc(sp.name)}</h2>${sub ? `<div class="lv-soft">${esc(sub)}</div>` : ''}</span></div>
      ${sp.bio ? `<div class="lv-sheet-sec"><div class="lv-prose">${esc(sp.bio).replace(/\n+/g, '<br>')}</div></div>` : ''}
      ${mine.length ? `<div class="lv-sheet-sec"><span class="lv-info-label">${COPY.speakers.sessions}</span>${mine.map(s => `<div class="lv-mini" data-act="open" data-id="${esc(s.id)}"><span class="lv-mini-time">${esc(s.start_time || '—')}</span><span class="lv-mini-body"><b>${esc(s.title || 'Session')}</b><br><span class="lv-soft">${[s.day_label, s.room, duration(s)].filter(Boolean).map(esc).join(' · ')}</span></span>${tplToggle(s, { compact: true })}</div>`).join('')}</div>` : ''}
    </div>`;
}

// ---- handlers ----------------------------------------------------------------------------------
const handlers = {
  tab: el => showTab(el.dataset.tab),
  ev: async el => { closeSheet(); await switchEvent(el.dataset.key); },
  allEvents: () => { S.showAll = !S.showAll; const head = q('[data-role="head"]'); if (head) head.innerHTML = tplHeader(); },
  open: el => { const s = sessionById(el.dataset.id); if (s) openSheet(sessionSheet(s)); },
  spk: el => { const sp = speakerList(S.current)[Number(el.dataset.i)]; if (sp) openSheet(speakerSheet(sp)); },
  close: closeSheet,
  refresh: async () => { await refreshAll({ toastOnSame: true }); },
  att: async el => {
    const id = el.dataset.id; const s = sessionById(id); if (!s) return;
    if (!S.token) return ui.toast(COPY.att.ticket);
    if (!canToggle(s.event_key) && !speaking(id)) return ui.toast(COPY.att.notHeld);
    if (el.getAttribute('aria-busy') === 'true') return;
    const was = S.attendance[id], next = attending(id) ? 'declined' : 'attending';
    S.attendance[id] = next; paintToggle(id);                          // optimistic
    el.setAttribute('aria-busy', 'true');
    try { await attend(id, next); if (s.show_counts) paintAll(); }
    catch (e) { S.attendance[id] = was; paintToggle(id); ui.toast(e.status === 403 ? COPY.att.notHeld : (e.message || COPY.att.failed), { kind: 'error' }); }
    finally { rootEl && rootEl.querySelectorAll(`[data-sid="${CSS.escape(id)}"]`).forEach(x => x.removeAttribute('aria-busy')); }
  }
};

// ---- flows -------------------------------------------------------------------------------------
async function switchEvent(key) {
  if (!key || key === S.current) return;
  S.current = key; store.set(LS.event(S.token || 'anon'), key);
  try { const u = new URL(location.href); u.searchParams.set('event', key); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* fine */ }
  if (!S.programs[key]) loadCached(key);
  paintAll();
  if (!S.programs[key] || navigator.onLine !== false) { try { await fetchProgram(key); } catch (e) { if (!S.programs[key]) ui.toast(e.message, { kind: 'error' }); } paintAll(); }
}
async function refreshAll({ toastOnSame } = {}) {
  const key = S.current; if (!key) return;
  const since = S.programs[key] && S.programs[key].updated_at;
  try {
    const r = await fetchProgram(key, { since });
    S.lastPoll = Date.now();
    if (r.changed) { paintAll(); ui.toast(COPY.updated); }
    else if (toastOnSame) ui.toast('Up to date.');
  } catch (e) { if (toastOnSame) ui.toast(e.message, { kind: 'error' }); }
}
function startTimers() {
  timers.push((() => { const id = setInterval(() => { if (document.visibilityState === 'visible') refreshAll(); }, POLL_MS); return () => clearInterval(id); })());
  timers.push((() => { const id = setInterval(() => { const now = q('[data-role="now"]'); if (now) now.innerHTML = tplNow(); }, TICK_MS); return () => clearInterval(id); })());
  onVis = () => { if (document.visibilityState === 'visible' && Date.now() - (S.lastPoll || 0) > 20000) refreshAll(); };
  document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis);
  onKey = e => { if (e.key === 'Escape' && sheet) closeSheet(); };
  document.addEventListener('keydown', onKey);
}

async function open(ctx) {
  const token = (ctx.params && ctx.params.token) || (ctx.path.startsWith('/app/live') || session.isAuthed ? 'user' : null);
  S = { token, tab: 'program', events: [], programs: {}, attendance: {}, person: null, speakerIds: [], current: null, showAll: false, lastPoll: 0 };
  const qTab = ctx.query && ctx.query.tab; const savedTab = store.get(LS.tab);
  S.tab = TABS.includes(qTab) ? qTab : (TABS.includes(savedTab) ? savedTab : 'program');
  // 1) paint instantly from the cache
  if (token) S.attendance = store.get(LS.att(token)) || {};
  const wantEvent = (ctx.query && ctx.query.event) || store.get(LS.event(token || 'anon'));
  if (wantEvent && loadCached(wantEvent)) { S.current = wantEvent; S.events = [Object.assign({ key: wantEvent }, S.programs[wantEvent].event || {})]; }
  rootEl.innerHTML = tplShell();
  unbind = ui.bind(rootEl, handlers);
  paintAll(); showTab(S.tab, { push: false });
  // 2) the network: who + which events (+ every held program in parallel), then repaint
  try {
    if (token) { try { await fetchMe(); } catch (e) { if (e.status === 404 || e.status === 401) { S.token = null; S.meError = e; if (token !== 'user') ui.toast(COPY.badLink, { kind: 'error', ms: 5000 }); } else throw e; } }
    if (!S.person) await fetchEvents();
    const mine = S.person ? S.person.events : [];
    const chosen = (wantEvent && S.events.some(e => e.key === wantEvent) && (!S.person || mine.includes(wantEvent) || !mine.length || S.showAll)) ? wantEvent : null;
    S.current = chosen || (S.person && S.current && S.events.some(e => e.key === S.current) ? S.current : guessEvent(S.events, mine));
    if (S.current) store.set(LS.event(token || 'anon'), S.current);
    const keys = Array.from(new Set([S.current].concat(mine).filter(Boolean)));
    keys.forEach(k => { if (!S.programs[k]) loadCached(k); });
    paintAll();
    await Promise.all(keys.map(k => fetchProgram(k).catch(e => { if (!S.programs[k]) console.warn('[live] program failed', k, e.message); })));
    S.lastPoll = Date.now();
    if (S.person && !S.person.events.length && token === 'user') ui.toast(COPY.noEvents, { ms: 6000 });
  } catch (e) {
    if (e && e.status === 0 && S.current && S.programs[S.current]) ui.toast(COPY.offline, { ms: 5000 });
    else if (!S.current) rootEl.innerHTML = `<div class="lv"><div class="lv-empty tall"><span class="lv-rule"></span><span class="lv-empty-line">${esc(e && e.message || 'Something went wrong.')}</span><span data-act="refresh" class="lv-att" style="margin-top:10px">${COPY.refresh}</span></div></div>`;
  }
  paintAll(); showTab(S.tab, { push: false });
  startTimers();
}

export default {
  title: () => 'Plexus Week Live',
  layout: 'bare',
  async render(root, ctx) {
    rootEl = root;
    await ensureCss();
    if (rootEl !== root) return;
    setThemeColor('#191512');
    await open(ctx);
  },
  destroy() {
    timers.forEach(stop => { try { stop(); } catch (e) { /* fine */ } }); timers = [];
    if (onVis) { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); onVis = null; }
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
    closeSheet();
    if (unbind) unbind(); unbind = null;
    rootEl = null; S = null;
  }
};
