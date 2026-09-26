// Source: Admin Event Day.dc.html — the live control room (note 4: wakes up by itself on event
// dates; Rehearsal mode is a visible amber state with TEST data only; the scanner works offline
// and syncs later; note 12: door-staff tokenized link, scanner only, no account).
//
// Blocks (artboard order): "Title row + rehearsal toggle" › "Quiet until the big day" (off state) ›
// "Rehearsal banner" › "Counters" › "SCANNER" + "DOOR LIST" › "DOOR-STAFF LINK" › "VENUE MAP" ›
// "STAGE Q&A". v2 additions (marked data-v2): the door picker (one scanner, four doors), the
// party-size result card (Alen's rule: one QR = a party of N; "2 of 3 admitted", never "already
// scanned" while capacity remains), the offline queue badge and the ops-notes editor.
//
// Backend: /api/v2/eventday/* (admin-portal/backend/v2/event-day.js) — the party ledger
// v2_checkin_admits; rehearsal scans land in v2_checkin_rehearsal and never touch real rows.
import cfg from '../config.js';
import { api } from '../api.js';
import { session, state } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { perms } from '../perms.js';


export const SOURCE = 'Admin Event Day.dc.html';

export const COPY = {
  title: 'Event Day',
  sub: 'the live control room — wakes up by itself on every event date',
  // DOOR MODE (2026-09-21) — the phone-first layout at ≤ 700px (see css/views/event-day.css)
  phone: {
    inOf: (a, b) => `${a} / ${b}`, inWord: 'IN',
    more: 'settings', tabScan: 'SCAN', tabList: 'LIST',
    scan: 'SCAN', stop: 'STOP', check: 'CHECK', admit: 'ADMIT',
    manual: 'Type the code or the guest’s email',
    camIdle: 'tap SCAN — the camera opens here',
    counts: { in: 'IN', expected: 'EXPECTED', pres: 'PRESENTERS IN' },
    filters: { out: 'NOT YET IN', in: 'IN', all: 'ALL' },
    search: 'Search a name',
    presentersFirst: 'PRESENTERS & PANEL', others: 'GUESTS',
    role: { presenter: 'PRESENTER', panel: 'PANEL', guest: 'GUEST' },
    partyOf: n => `PARTY OF ${n}`,
    notYetIn: 'not yet in', alreadyIn: t => `ALREADY IN${t ? ' · ' + t : ''}`,
    admitOne: (n) => n > 1 ? `ADMIT 1 OF ${n}` : 'ADMIT', admitAll: n => `ADMIT ALL ${n}`,
    admitAt: label => `ADMIT · ${label}`,
    notThisDoor: 'NOT ON THIS DOOR’S LIST', notThisDoorWhy: 'Registered for another door — admit there if that is where they belong.',
    nothing: 'REGISTERED — BUT FOR NOTHING AT THESE DOORS',
    admitted: 'ADMITTED', allIn: 'ALL IN', next: 'NEXT SCAN', done: 'DONE', close: 'CLOSE',
    inNow: (a, b) => `${a} of ${b} in`,
    brief: 'HOST BRIEF', hideBrief: 'HIDE THE BRIEF', desktop: 'STAFF LINK · MAP · NOTES ARE ON THE DESKTOP VIEW'
  },
  toggle: 'REHEARSAL MODE',
  banner: 'REHEARSAL — TEST GUESTS ONLY, NOTHING IS REAL',
  bannerSide: 'On December 4 this banner disappears and the scanner goes live.',
  bannerReset: 'RESET THE REHEARSAL',
  quiet: {
    line: 'Quiet until the big day.',
    why: 'This room activates automatically on December 4 — scanner, live headcount and the venue map all come alive. Flip <b>Rehearsal mode</b> above to practice today with test guests; nothing you do in rehearsal touches real data.',
    try: 'TRY THE REHEARSAL', back: 'BACK TO PLEXUS'
  },
  doors: { label: 'DOOR', names: { conference: 'CONFERENCE', gala: 'GALA', donor: 'DONOR NIGHT', bridges: 'BRIDGES', meetup: 'MEETUPS' } },
  // v2 addition (2026-09-11, design/MEETUPS-SPEC.md §3 "Check-in"): the meetup door is one picked
  // table at a time — the server answers 400 bad_event without a meetup_id, so the UI asks first.
  meetup: {
    label: 'MEETUP', pick: 'Pick the meetup first — this door checks one table in at a time.',
    pickNone: 'No meetup is published yet for this edition — publish one in the Plexus hub and it appears here.',
    pickHint: 'The host sees the same faces: name, what they do, where they work.',
    seats: (taken, cap) => `${taken}/${cap}`,
    hostLine: (host, venue) => [host, venue].filter(Boolean).join(' · '),
    staffWhy: 'Meetup hosts get their own link from the Plexus hub — MEETUPS tab, COPY HOST LINK on the row. It opens that one table, scanner included.',
    staffOpen: 'OPEN THE MEETUPS TAB →'
  },
  counters: {
    checked: 'CHECKED IN', checkedSub: n => `of ${n} expected today`,
    room: 'IN THE ROOM NOW', roomSub: 'no one has left yet',
    expected: 'STILL EXPECTED', expectedSub: 'names below, tap to check in'
  },
  scanner: {
    title: 'SCANNER',
    hint: 'Point at the guest’s QR — you see who they are and everything they booked, then admit with one tap. Flip INSTANT ADMIT for the fast lane at a busy door (works offline; syncs by itself).',
    camIdle: 'camera opens here on a phone or laptop',
    camBusy: 'camera unavailable here — type the code below',
    start: 'START CAMERA', stop: 'STOP CAMERA', simulate: 'SIMULATE A SCAN',
    manual: 'Code under the QR, or the guest’s email',
    admit: 'ADMIT', admitMore: 'ADMIT ONE MORE', admitTwo: 'ADMIT 2 NOW',
    check: 'CHECK', instant: 'INSTANT ADMIT', idClear: 'CLEAR',
    idTitle: 'ID CHECK', idNone: 'Registered — but for nothing at these doors.',
    admitAt: label => `ADMIT 1 · ${label}`,
    overrideWhy: 'Why let more in? (logged)', overrideBtn: 'ADMIT ANYWAY — LOGGED',
    queued: n => `${n} PENDING — SYNCS WHEN BACK ONLINE`, sync: 'SYNC NOW',
    offlineToast: 'NO CONNECTION — SAVED, SYNCS BY ITSELF', syncedToast: n => `${n} QUEUED SCAN${n === 1 ? '' : 'S'} SYNCED`
  },
  door: {
    title: 'DOOR LIST', search: 'Type a name — fastest at a busy door',
    checkIn: 'CHECK IN', plusOne: '+1', in: 'IN', of: (a, b) => `${a} of ${b}`,
    due: a => `€${a} DUE`,   // UXFIX-A1 #2: loud state for an unpaid gala guest
    empty: 'No one on this door’s list yet.'
  },
  staff: {
    title: 'DOOR-STAFF LINK',
    why: 'Working the door tonight but not on the team? Text them this link — it opens the scanner only, needs no account, and stops working when the event ends.',
    make: 'MAKE THE LINK', copy: 'COPY LINK', copied: '✓ COPIED', qr: 'SHOW QR', hideQr: 'HIDE QR', revoke: 'REVOKE',
    expires: exp => `expires ${exp} · revoke it here any time`, revoked: 'LINK REVOKED — IT STOPS WORKING EVERYWHERE',
    handQr: 'let door staff scan this QR with their phone camera'
  },
  map: {
    title: 'VENUE & SEATING', planner: 'OPEN THE 3D BALLROOM PLANNER ↗', seating: 'GALA SEATING BOARD →',
    sub: 'The Esplanade plan and every table — the same seating the door scanner reads.',
    notes: 'OPS NOTES — SHARED WITH THE TEAM', notesPh: 'Door assignments, parking, kitchen timing…',
    save: 'SAVE NOTES', saved: 'NOTES SAVED — THE WHOLE TEAM SEES THEM'
  },
  qa: {
    title: 'STAGE Q&A',
    why: 'Member questions land in the Plexus hub — moderate them there and the answers appear on every phone in the room.',
    open: 'OPEN LIVE Q&A →'
  },
  results: {
    admitted: 'ADMITTED', party_complete: 'ALL IN', over_capacity: 'OVER CAPACITY', over_admitted: 'OVER CAPACITY — LOGGED',
    not_found: 'NOT FOUND', not_paid: 'NOT PAID', wrong_event: 'WRONG DOOR', revoked: 'REVOKED', cancelled: 'CANCELLED',
    not_registered_for_event: 'NOT ON THIS LIST', queued: 'QUEUED OFFLINE', error: 'TRY AGAIN',
    // meetup door (2026-09-11)
    wrong_meetup: 'ANOTHER TABLE', not_confirmed: 'NOT CONFIRMED', bad_code: 'NOT A MEETUP CODE', bad_event: 'PICK A MEETUP'
  },
  // v2 addition (2026-08-31): HOST BRIEF — the old portal's "who is coming tonight" one-pager
  brief: {
    title: 'HOST BRIEF',
    sub: 'who is coming tonight — composed live from the guest list',
    print: 'PRINT', copy: 'COPY AS TEXT', copied: '✓ COPIED', refresh: 'REFRESH',
    loading: 'Composing the brief from the guest list…',
    error: 'The brief could not load — REFRESH to try again.',
    rehearsalNote: 'Rehearsal is ON — the brief still reads the real guest list; rehearsal never touches it.',
    room: 'THE ROOM', points: 'TALKING POINTS', notable: 'NOTABLE GUESTS', kitchen: 'KITCHEN',
    expected: 'EXPECTED', expectedSub: (b, p) => `${b} bookings${p ? ` · ${p} plus-one${p === 1 ? '' : 's'}` : ''}`,
    paid: 'PAID', pending: 'PENDING', institutions: 'INSTITUTIONS', countries: 'COUNTRIES',
    alreadyIn: n => `${n} already in`,
    noDietary: 'No dietary requests on file.',
    plusOnesDiet: n => `${n} plus-one guest${n === 1 ? ' carries' : 's carry'} no dietary info`,
    copyToast: 'BRIEF COPIED — PASTE IT INTO A MESSAGE TO ALEN',
    copyFail: 'COPY FAILED — USE PRINT INSTEAD',
    notReady: 'THE BRIEF IS STILL COMPOSING — TRY AGAIN IN A SECOND'
  }
};

const GATE_ORDER = ['conference', 'gala', 'donor', 'bridges', 'meetup'];
const MEETUP_GATE = 'meetup';
const REH_KEY = 'medx_v2_rehearsal';
const Q_KEY = () => 'medx_v2_scanq:' + ((session.user || {}).id || 'anon');

let D = null, st = null, rootEl = null, unbind = null, timers = [];
let camStream = null, camVideo = null, camRaf = 0;

// ---------------------------------------------------------------- DOOR MODE (2026-09-21)
// At ≤ 700px the view renders phoneTemplate() — scanner first, a result SHEET instead of the inline
// card, a door list with big targets. Same data, same handlers, same scan/lookup calls; only the
// presentation differs. isPhone() is read at render time and on a breakpoint crossing (resize).
const PHONE_MQ = '(max-width: 700px)';
const isPhone = () => { try { return window.matchMedia(PHONE_MQ).matches; } catch (e) { return false; } };
const hhmm = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : ''; };
// Per-guest enrichment for a Bridges edition (institution · position · presenter/panel) — read from
// the existing GET /api/bridges/events/:id (auth only, so door staff can read it too). Keyed by
// registration id AND lower(email) so a merged door row and a lookup card both resolve.
const regOf = (ref, email) => {
  if (!st || !st.regs) return null;
  return (ref && st.regs['id:' + String(ref)]) || (email && st.regs['em:' + String(email).trim().toLowerCase()]) || null;
};
const roleOf = r => {
  if (!r) return null;
  const ps = String(r.presenter_status || '').toLowerCase();
  if (ps === 'confirmed') return 'presenter';
  if (ps === 'panel' || String(r.panel_reply || '').toLowerCase() === 'yes') return 'panel';
  return null;
};
const isPresRow = d => !!roleOf(regOf(d.ref, d.email));
async function loadBridgesEdition() {
  st.regs = {}; st.venue = '';
  if (st.gate !== 'bridges' || !st.bridgesEvent) return;
  const id = st.bridgesEvent;
  try {
    const ev = await api.get('/api/bridges/events/' + encodeURIComponent(id));
    if (!st || st.bridgesEvent !== id) return;
    const venue = String((ev && ev.venue_name) || '');
    // "Waterhouse Room, Gordon Hall" → the building is the part the guests know
    st.venue = venue.includes(',') ? venue.split(',').pop().trim() : venue;
    const regs = {};
    ((ev && ev.registrations) || []).forEach(r => {
      const slim = { institution: r.institution || '', position: r.position || '', presenter_status: r.presenter_status || null, panel_reply: r.panel_reply || null, checked_in_at: r.checked_in_at || null };
      regs['id:' + String(r.id)] = slim;
      if (r.email) { const k = 'em:' + String(r.email).trim().toLowerCase(); if (!regs[k]) regs[k] = slim; }
    });
    st.regs = regs;
  } catch (e) { /* enrichment only — the door works without it */ }
}

// ---------------------------------------------------------------- offline queue
function readQ() { try { return JSON.parse(localStorage.getItem(Q_KEY()) || '[]'); } catch (e) { return []; } }
function writeQ(a) { try { localStorage.setItem(Q_KEY(), JSON.stringify(a)); } catch (e) {} paintQueue(); }
function paintQueue() {
  if (!rootEl) return;
  const n = readQ().length;
  // door mode: a pill in the header shows queued scans even while the ⋯ row is closed
  const pill = rootEl.querySelector('[data-role="queuePill"]');
  if (pill) { pill.style.display = n ? 'inline-flex' : 'none'; pill.textContent = n ? COPY.scanner.queued(n) : ''; }
  const el = rootEl.querySelector('[data-role="queueBadge"]');
  if (!el) return;
  el.style.display = n ? 'inline-flex' : 'none';
  el.textContent = n ? COPY.scanner.queued(n) : '';
  const s = rootEl.querySelector('[data-act="syncNow"]');
  if (s) s.style.display = n ? 'inline-block' : 'none';
}
async function flushQueue() {
  let a = readQ();
  if (!a.length || st.flushing) return;
  st.flushing = true;
  let done = 0;
  while (a.length) {
    const item = a[0];
    try {
      const out = await api.post('/api/v2/eventday/scan', item.body);
      a.shift(); writeQ(a); done++;
      showResult(out);
    } catch (e) {
      // a definitive 4xx means the server judged this scan — drop it; 0/5xx = still unreachable
      if (e instanceof api.ApiError && e.status >= 400 && e.status < 500) { a.shift(); writeQ(a); done++; continue; }
      break; // still offline
    }
  }
  st.flushing = false;
  if (done) { ui.toast(COPY.scanner.syncedToast(done)); refreshCounts(); refreshDoor(); }
}

// ---------------------------------------------------------------- data
async function load() {
  const r = await api.settle({
    over: api.get('/api/v2/eventday/overview'),
    tokens: api.get('/api/v2/eventday/door-tokens'),
    notes: api.get('/api/v2/eventday/notes?event=' + encodeURIComponent(st.gate || 'conference'))
  });
  return {
    errors: r.$errors,
    over: r.over || { gates: [], default_event: 'conference', is_event_day: false },
    tokens: (r.tokens && r.tokens.tokens) || [],
    notes: r.notes || { notes: '' }
  };
}
function gateInfo(key) { return (D.over.gates || []).find(g => g.event_key === key) || { event_key: key, label: key, expected: 0, admitted: 0 }; }
// The server judges "event day" on UTC; a Boston door at 20:00 ET is already tomorrow in UTC, so
// a Bridges edition dated LOCAL today keeps the room live on its own (chrome.isEventDay does the same).
const bridgesToday = () => { const t = fmt.ymd(new Date()); return (D && (D.over.bridges_events || []).find(e => e.date && String(e.date).slice(0, 10) === t)) || null; };
function isLive() { return !!(D && D.over.is_event_day) || st.rehearsal || st.forced || !!bridgesToday(); }
// ---- meetup door (2026-09-11) — the picker list rides on the overview payload
const meetupList = () => (D && Array.isArray(D.over.meetups)) ? D.over.meetups : [];
const meetupOn = () => st.gate === MEETUP_GATE && !st.rehearsal;
const pickedMeetup = () => meetupList().find(m => String(m.id) === String(st.meetupId)) || null;
// the server answers 400 bad_event without a meetup_id — never scan into that
const meetupBlocked = () => meetupOn() && !st.meetupId;

async function refreshCounts() {
  try {
    const o = await api.get('/api/v2/eventday/overview');
    if (!D || !rootEl) return;
    D.over = o;
    paintCounts();
    // the meetup chips print live seats — repaint them with the fresh overview
    if (meetupOn()) { paint('[data-block="gateChips"]', gateChips()); paintQueue(); }
  } catch (e) {}
}
function paintCounts() {
  paint('[data-block="counters"]', isPhone() ? phoneCounts() : blockCounters());
  const h = rootEl && rootEl.querySelector('[data-role="hdrCount"]');
  if (h) h.innerHTML = hdrCountHtml();
}
async function refreshDoor() {
  if (!rootEl) return;
  try {
    const p = st.rehearsal ? 'rehearsal=1' : 'event=' + encodeURIComponent(st.gate) + (st.doorQ ? '&q=' + encodeURIComponent(st.doorQ) : '')
      + (st.gate === 'bridges' && st.bridgesEvent ? '&bridges_event=' + encodeURIComponent(st.bridgesEvent) : '')
      + (st.gate === MEETUP_GATE && st.meetupId ? '&meetup_id=' + encodeURIComponent(st.meetupId) : '');
    const d = await api.get('/api/v2/eventday/door?' + p);
    if (!rootEl || !st) return;
    st.door = d.rows || [];
    if (!st.doorQ) st.doorAll = st.door;   // the unfiltered list feeds the phone's filter counts + presenters-in
    paint('[data-block="doorRows"]', doorRowsHtml());
    // every width: in rehearsal the counters are the test list's own totals (rehearsalTotals reads
    // st.door), so they must repaint once it lands — the desktop room read 0 of 0 beside 6 test guests
    paintCounts();
    if (isPhone()) {
      paint('[data-block="listFilter"]', phoneFilter());
      const n = rootEl.querySelector('[data-role="tabOut"]'); if (n) n.textContent = String(st.door.filter(d => !rowIn(d)).length);
    }
  } catch (e) { /* keep the last list */ }
}
// v2 addition (2026-08-31): HOST BRIEF — reads /api/v2/host-brief for the selected door.
async function refreshBrief() {
  if (!rootEl || !st) return;
  if (st.gate === MEETUP_GATE) return;   // the brief has no meetup shape — the host page is that view
  const gate = st.gate;
  try {
    const b = await api.get('/api/v2/host-brief?event=' + encodeURIComponent(gate));
    if (!rootEl || !st || st.gate !== gate) return;   // door changed mid-flight — a fresh call is coming
    st.brief = b; st.briefErr = null;
  } catch (e) {
    if (!rootEl || !st || st.gate !== gate) return;
    st.brief = null; st.briefErr = e;
  }
  paint('[data-block="hostBrief"]', blockHostBrief());
}

// ---------------------------------------------------------------- scan
async function scan(code, opts = {}) {
  const body = {
    code, event: opts.event || st.gate, rehearsal: st.rehearsal,
    bridges_event: (opts.event || st.gate) === 'bridges' ? (st.bridgesEvent || undefined) : undefined,
    // the meetup door checks ONE table in at a time — without it the server answers 400 bad_event
    meetup_id: (opts.event || st.gate) === MEETUP_GATE ? (opts.meetup_id || st.meetupId || undefined) : undefined,
    admit: opts.admit || 1, method: opts.method || 'manual',
    override: !!opts.override, override_reason: opts.override_reason || undefined,
    device: 'admin-v2 ' + (navigator.platform || '')
  };
  try {
    const out = await api.post('/api/v2/eventday/scan', body);
    out._code = code;   // the sheet's ADMIT ONE MORE / override buttons re-scan this code
    out._method = body.method;   // ...with the method it arrived by (a scanned e-mail stays a scan)
    showResult(out);
    refreshCounts(); refreshDoor();
    return out;
  } catch (e) {
    if (e instanceof api.ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504)) {
      const a = readQ(); a.push({ body, ts: Date.now() }); writeQ(a);
      showResult({ ok: false, result: 'queued', message: 'No connection — saved on this device, syncs by itself when the network is back.', ticket: { name: String(code).slice(0, 34) }, admitted_count: null });
      ui.toast(COPY.scanner.offlineToast);
      return null;
    }
    showResult({ ok: false, result: 'error', message: e.message, ticket: {} });
    return null;
  }
}
function showResult(out) {
  st.last = out;
  st.idcard = null;
  presentResult();
}
// One place decides WHERE a result shows: the inline card (desktop) or the bottom sheet (phone).
function presentResult() {
  if (!rootEl) return;
  if (isPhone()) { const host = rootEl.querySelector('[data-role="sheetHost"]'); if (host) host.innerHTML = sheetHtml(); }
  else paint('[data-role="scanResult"]', resultHtml());
}
const sheetOpen = () => !!(st && (st.idcard || st.last));

// ---------------------------------------------------------------- ID check (identify first, admit on tap)
// Default scan mode (Alen 2026-08-30): a scan RESOLVES the person — full name, what they booked at
// every door, paid state, party progress — and admits nobody. Each door row carries its own ADMIT
// button (→ the normal /scan write). INSTANT ADMIT restores the old one-tap flow for the rush.
async function identify(code, opts = {}) {
  // rehearsal TEST-1…6 are built-in practice guests known only to /scan — ID-check would say
  // NOT FOUND (E2E S13), so practice codes keep the classic admit flow
  if (st.rehearsal && /^TEST-\d+$/i.test(String(code).trim())) return scan(code, opts);
  // door hardening (round 3 Phase 0a): the server resolves an e-mail or a short code only when it
  // was TYPED (method 'manual'), so the lookup and the ADMIT that follows carry the real method
  const method = opts.method === 'manual' ? 'manual' : 'qr';
  try {
    const out = await api.post('/api/v2/eventday/lookup', { code, rehearsal: st.rehearsal, method });
    if (!out.ok) { showResult(Object.assign({ ticket: {} }, out, { _code: code, _method: method })); return out; }
    st.last = null;
    st.idcard = Object.assign({ _code: code, _method: method }, out);
    presentResult();
    return out;
  } catch (e) {
    // offline or server unreachable — fall back to the queueing admit flow so the door keeps moving
    if (e instanceof api.ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504)) {
      return scan(code, opts);
    }
    showResult({ ok: false, result: 'error', message: e.message, ticket: {} });
    return null;
  }
}
function idCardHtml() {
  const c = st.idcard;
  const p = c.person || {};
  const doorRow = d => {
    const full = d.ok && d.remaining === 0 && d.admitted > 0;
    const state = !d.ok
      ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22">${esc((COPY.results[d.block] || d.block || '').toUpperCase())}</span>`
      : full
        ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#2f7d4f">ALL IN · ${COPY.door.of(d.admitted, d.party_size)}</span>`
        : d.admitted > 0
          ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#7a6432">${COPY.door.of(d.admitted, d.party_size)} IN</span>`
          : `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#2f7d4f">REGISTERED ✓${d.party_size > 1 ? ' · PARTY OF ' + d.party_size : ''}</span>`;
    const btn = d.ok && d.remaining > 0
      ? `<span data-act="idAdmit" data-key="${esc(d.event)}"${d.meetup_id ? ` data-meetup="${esc(d.meetup_id)}"` : ''} data-code="${esc(c._code)}" style="padding:8px 13px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#9b1b22">${COPY.scanner.admitAt(COPY.doors.names[d.event] || d.event.toUpperCase())}</span>`
      : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(32,27,22,.1);width:100%">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;min-width:96px;text-align:left">${esc(d.event === MEETUP_GATE && d.label ? String(d.label).toUpperCase() : (COPY.doors.names[d.event] || d.event.toUpperCase()))}</span>
        <span style="flex:1;text-align:left">${state}${!d.ok && d.message ? `<div style="font-size:10.5px;color:#9b1b22;margin-top:2px">${esc(d.message)}</div>` : ''}</span>
        ${btn}
      </div>`;
  };
  return `
    <span data-role="scanResult" data-state="idcard" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;border:1px solid rgba(32,27,22,.14);padding:12px 14px;box-sizing:border-box">
      <span style="display:flex;width:100%;align-items:center"><span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${COPY.scanner.idTitle}</span><span style="flex:1"></span><span data-act="idClear" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;text-decoration:underline">${COPY.scanner.idClear}</span></span>
      <span style="font-family:Fraunces,serif;font-size:21px;line-height:1.15;text-align:center">${esc(p.name || '')}</span>
      ${(p.position || p.institution || p.country) ? `<span style="font-size:11.5px;color:#6d6459;text-align:center">${esc([p.position, p.institution, p.country].filter(Boolean).join(' · '))}</span>` : ''}
      ${p.email ? `<span style="font-size:11px;color:#6d6459">${esc(p.email)}</span>` : ''}
      ${p.bio ? `<span data-v2="meetup bio snippet" style="font-size:11.5px;color:#6d6459;text-align:center;line-height:1.5;max-width:280px">${esc(String(p.bio).slice(0, 260))}</span>` : ''}
      <div style="width:100%;margin-top:8px">
        ${(c.doors && c.doors.length) ? c.doors.map(doorRow).join('') : `<div style="font-size:12px;color:#6d6459;padding:8px 0;border-top:1px solid rgba(32,27,22,.1)">${COPY.scanner.idNone}</div>`}
      </div>
    </span>`;
}

// ---------------------------------------------------------------- camera (jsQR — vendored lib)
function loadJsQR() {
  return new Promise((resolve) => {
    if (window.jsQR) return resolve(true);
    const s = document.createElement('script');
    s.src = '/vendor/jsqr.min.js';
    s.onload = () => resolve(!!window.jsQR);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
const camLabel = on => isPhone() ? (on ? COPY.phone.stop : COPY.phone.scan) : (on ? COPY.scanner.stop : COPY.scanner.start);
function stopCam() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  if (camVideo) { camVideo.remove(); camVideo = null; }
  cancelAnimationFrame(camRaf);
  if (st) st.camOn = false;
  const b = rootEl && rootEl.querySelector('[data-act="cam"]');
  if (b) b.textContent = camLabel(false);
  const hint = rootEl && rootEl.querySelector('[data-role="camHint"]');
  if (hint) hint.style.display = '';
  const box = rootEl && rootEl.querySelector('[data-role="camBox"]');
  if (box) box.classList.remove('is-live');
}
async function startCam() {
  const box = rootEl.querySelector('[data-role="camBox"]');
  const hint = rootEl.querySelector('[data-role="camHint"]');
  if (!box) return;
  const okLib = await loadJsQR();
  if (!okLib || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { if (hint) hint.textContent = COPY.scanner.camBusy; return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) { if (hint) hint.textContent = COPY.scanner.camBusy; return; }
  if (!rootEl || !st) { camStream.getTracks().forEach(t => t.stop()); camStream = null; return; }
  st.camOn = true;
  camVideo = document.createElement('video');
  camVideo.setAttribute('playsinline', '');
  camVideo.muted = true;
  camVideo.srcObject = camStream;
  camVideo.className = 'mx-ed-video';
  camVideo.play();
  box.appendChild(camVideo);
  box.classList.add('is-live');
  if (hint) hint.style.display = 'none';
  const b = rootEl.querySelector('[data-act="cam"]'); if (b) b.textContent = camLabel(true);
  let lastCode = '', lastAt = 0;
  const canvas = document.createElement('canvas');
  const tick = () => {
    if (!camVideo) return;
    camRaf = requestAnimationFrame(tick);
    if (camVideo.readyState !== camVideo.HAVE_ENOUGH_DATA) return;
    // door mode: while a result sheet is up the feed keeps running but nothing new is decoded —
    // the next guest is read only after NEXT SCAN / CLOSE (the decoding itself is unchanged)
    if (isPhone() && sheetOpen()) return;
    canvas.width = camVideo.videoWidth; canvas.height = camVideo.videoHeight;
    const x = canvas.getContext('2d', { willReadFrequently: true });
    x.drawImage(camVideo, 0, 0, canvas.width, canvas.height);
    try {
      const img = x.getImageData(0, 0, canvas.width, canvas.height);
      const hit = window.jsQR && window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (hit && hit.data) {
        const now = Date.now();
        if (hit.data !== lastCode || now - lastAt > 4000) { lastCode = hit.data; lastAt = now; (st.instant ? scan : identify)(hit.data, { method: 'qr' }); }
      }
    } catch (e) { /* keep scanning */ }
  };
  tick();
}

// ---------------------------------------------------------------- blocks
function blockTitle() {
  const on = st.rehearsal;
  return `
    <!-- dc: Admin Event Day.dc.html › "Title row + rehearsal toggle" -->
    <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">
      <span class="mx-display-30" style="font-family:Fraunces,serif;font-size:30px">${COPY.title}</span>
      <span style="font-size:12.5px;color:#6d6459">${COPY.sub}</span>
      <div style="flex:1"></div>
      <span data-act="reh" role="switch" aria-checked="${on}" class="mx-ed-switch" style="display:flex;align-items:center;gap:9px;padding:9px 14px;border:1px solid rgba(32,27,22,.2);cursor:pointer;background:${on ? '#f8f1e2' : '#fff'}" data-hover="border-color:#201b16">
        <span class="mx-ed-track" style="width:30px;height:16px;background:${on ? '#b7791f' : 'rgba(32,27,22,.25)'};position:relative;flex:none"><span class="mx-ed-knob" style="position:absolute;top:2px;left:2px;width:12px;height:12px;background:#fff;transform:translateX(${on ? '14px' : '0'})"></span></span>
        <span class="mx-ed-switch-l" style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:${on ? '#7a6432' : '#6d6459'}">${COPY.toggle}</span>
      </span>
    </div>
    <!-- /dc -->`;
}
function blockQuiet() {
  const g = gateInfo('conference');
  const start = (g.starts_at || FACTS.plexus.startAt);
  const days = Math.max(0, fmt.daysUntil(String(start).slice(0, 10)) || 0);
  return `
    <!-- dc: Admin Event Day.dc.html › "Quiet until the big day" -->
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:56px 28px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">
      <span style="width:52px;height:52px;border:1px solid rgba(32,27,22,.2);display:flex;align-items:center;justify-content:center;font-family:Fraunces,serif;font-size:22px;color:#6d6459">${days}</span>
      <span style="font-family:Fraunces,serif;font-size:22px">${COPY.quiet.line}</span>
      <span style="font-size:13px;color:#6d6459;max-width:460px;line-height:1.6">${COPY.quiet.why}</span>
      <div style="display:flex;gap:10px;margin-top:6px;flex-wrap:wrap;justify-content:center">
        <span data-act="reh" style="padding:10px 16px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#7e151b">${COPY.quiet.try}</span>
        <a href="/projects/plexus" style="padding:10px 16px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em" data-hover="border-color:#201b16;color:#201b16">${COPY.quiet.back}</a>
      </div>
    </div>
    <!-- /dc -->`;
}
function blockBanner() {
  if (!st.rehearsal) return '<!-- dc: Admin Event Day.dc.html › "Rehearsal banner" --><!-- off --><!-- /dc -->';
  return `
    <!-- dc: Admin Event Day.dc.html › "Rehearsal banner" -->
    <div data-role="rehBanner" style="border:1px solid #c9a962;background:#f8f1e2;padding:10px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="width:8px;height:8px;background:#b7791f;border-radius:50%"></span>
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:#7a6432">${COPY.banner}</span>
      <span data-act="rehReset" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#7a6432;cursor:pointer;text-decoration:underline">${COPY.bannerReset}</span>
      <div style="flex:1"></div>
      <span style="font-size:11.5px;color:#7a6432">${COPY.bannerSide}</span>
    </div>
    <!-- /dc -->`;
}
function gateChips() {
  return `
    <div data-block="gateChips" data-v2="door picker — one scanner, four doors" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${COPY.doors.label}</span>
      ${GATE_ORDER.map(k => {
        const g = gateInfo(k); const on = st.gate === k;
        return `<span data-act="gate" data-key="${k}" role="tab" aria-selected="${on}" style="padding:6px 11px;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;border:1px solid ${on ? '#201b16' : 'rgba(32,27,22,.25)'};background:${on ? '#201b16' : 'transparent'};color:${on ? '#f6f2ea' : '#6d6459'};white-space:nowrap">${COPY.doors.names[k] || k.toUpperCase()}${g.starts_at ? ' · ' + esc(fmt.dayLabel(g.starts_at)) : ''}</span>`;
      }).join('')}
      ${meetupOn() ? `
      <span style="flex-basis:100%;height:0"></span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${COPY.meetup.label}</span>
      ${meetupList().length ? meetupList().map(m => {
        const on = String(st.meetupId) === String(m.id);
        return `<span data-act="meetupPick" data-id="${esc(m.id)}" role="tab" aria-selected="${on}" title="${esc(COPY.meetup.hostLine(m.host, m.venue))}" style="padding:6px 11px;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;border:1px solid ${on ? '#7a6432' : 'rgba(32,27,22,.25)'};background:${on ? '#f8f1e2' : 'transparent'};color:${on ? '#7a6432' : '#6d6459'};white-space:nowrap">${esc(String(m.label || '').toUpperCase())}${m.starts_at ? ' · ' + esc(fmt.dayLabel(m.starts_at)) : ''} · ${esc(COPY.meetup.seats(m.expected, m.capacity))}</span>`;
      }).join('') : `<span style="font-size:11.5px;color:#6d6459">${esc(COPY.meetup.pickNone)}</span>`}
      ${meetupList().length && !st.meetupId ? `<span style="font-size:11.5px;color:#9b1b22">${esc(COPY.meetup.pick)}</span>` : ''}` : ''}
      ${st.gate === 'bridges' && D && (D.over.bridges_events || []).length > 1 ? `
      <span style="flex-basis:100%;height:0"></span>
      <span style="font:600 9px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">EDITION</span>
      ${(D.over.bridges_events || []).map(ev => {
        const on = String(st.bridgesEvent) === String(ev.id);
        const dl = ev.date ? ' · ' + esc(fmt.dayLabel ? fmt.dayLabel(ev.date) : ev.date) : '';
        return `<span data-act="bridgesEv" data-id="${esc(ev.id)}" role="tab" aria-selected="${on}" style="padding:6px 11px;font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;border:1px solid ${on ? '#7a6432' : 'rgba(32,27,22,.25)'};background:${on ? '#f8f1e2' : 'transparent'};color:${on ? '#7a6432' : '#6d6459'};white-space:nowrap">${esc(String(ev.label || '').toUpperCase())}${dl}</span>`;
      }).join('')}` : ''}
      <span data-act="instant" role="switch" aria-checked="${!!st.instant}" title="ON: every scan admits straight at the selected door. OFF: a scan identifies the guest first — admit with a tap." style="display:flex;align-items:center;gap:7px;padding:6px 11px;border:1px solid ${st.instant ? '#9b1b22' : 'rgba(32,27,22,.25)'};background:${st.instant ? '#9b1b22' : 'transparent'};color:${st.instant ? '#fff' : '#6d6459'};font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap">${COPY.scanner.instant}${st.instant ? ' · ON' : ''}</span>
      <div style="flex:1"></div>
      <span data-role="queueBadge" style="display:none;background:#c9a962;color:#201b16;padding:4px 9px;font:600 9px Inter,sans-serif;letter-spacing:.12em;align-items:center"></span>
      <span data-act="syncNow" style="display:none;font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#9b1b22;cursor:pointer">${COPY.scanner.sync}</span>
    </div>`;
}
function rehearsalTotals() {
  const rows = st.door || [];
  const expected = rows.reduce((n, r) => n + (Number(r.party_size) || 1), 0);
  const admitted = rows.reduce((n, r) => n + (Number(r.admitted_count) || 0), 0);
  return { expected, admitted };
}
// checked-in / expected for the door on screen (a Bridges edition or a picked meetup table narrows it)
function gateStats() {
  let g = st.rehearsal ? rehearsalTotals() : gateInfo(st.gate);
  if (!st.rehearsal && st.gate === 'bridges' && st.bridgesEvent && D) {
    const ev = (D.over.bridges_events || []).find(e => String(e.id) === String(st.bridgesEvent));
    if (ev) g = { expected: ev.expected, admitted: ev.admitted };
  }
  // one picked table, not the whole meetup programme (2026-09-11)
  if (meetupOn() && st.meetupId) { const m = pickedMeetup(); if (m) g = { expected: m.expected, admitted: m.admitted }; }
  return { checked: Number(g.admitted) || 0, expected: Number(g.expected) || 0 };
}
function blockCounters() {
  const { checked, expected } = gateStats();
  const still = Math.max(0, expected - checked);
  const cell = (k, v, sub) => `
        <div style="background:#fff;padding:16px 20px"><div style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${k}</div><div class="mx-display-34" style="font-family:Fraunces,serif;font-size:34px;margin-top:3px">${v}</div><div style="font-size:11px;color:#6d6459">${sub}</div></div>`;
  return `
    <!-- dc: Admin Event Day.dc.html › "Counters" -->
    <div data-block="counters" class="mx-grid-3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;background:rgba(32,27,22,.12);border:1px solid rgba(32,27,22,.14)">
      ${cell(COPY.counters.checked, checked, esc(COPY.counters.checkedSub(expected)))}
      ${cell(COPY.counters.room, checked, COPY.counters.roomSub)}
      ${cell(COPY.counters.expected, still, COPY.counters.expectedSub)}
    </div>
    <!-- /dc -->`;
}
// The meetup door's whole point (spec §3): the scan prints WHO this is — position · institution and
// a short bio — so the host can say "oh, you're a sleep researcher at Harvard".
function personSnippetHtml(p) {
  if (!p || !(p.position || p.institution || p.bio)) return '';
  const line = [p.position, p.institution].filter(Boolean).join(' · ');
  return `
      <span data-v2="meetup profile snippet" style="display:flex;flex-direction:column;gap:3px;align-items:center;width:100%;margin-top:2px;padding-top:8px;border-top:1px solid rgba(32,27,22,.1)">
        ${line ? `<span style="font-size:12px;color:#201b16;text-align:center;line-height:1.45">${esc(line)}</span>` : ''}
        ${p.bio ? `<span style="font-size:11.5px;color:#6d6459;text-align:center;line-height:1.5">${esc(String(p.bio).slice(0, 260))}</span>` : ''}
      </span>`;
}
function resultHtml() {
  if (st.idcard) return idCardHtml();
  const r = st.last;
  if (!r) return `<span data-role="scanResult"></span>`;
  const label = COPY.results[r.result] || String(r.result || '').replace(/_/g, ' ').toUpperCase();
  const bad = ['over_capacity', 'not_paid', 'revoked', 'cancelled', 'not_found', 'wrong_event', 'not_registered_for_event', 'error', 'wrong_meetup', 'not_confirmed', 'bad_code', 'bad_event'].includes(r.result);
  const partial = r.ok && r.remaining > 0;
  const color = r.result === 'over_capacity' ? '#9b1b22' : bad ? '#9b1b22' : partial ? '#7a6432' : '#2f7d4f';
  const counts = r.party_size ? `<span style="font-family:Fraunces,serif;font-size:20px">${COPY.door.of(r.admitted_count, r.party_size)}<span style="font-size:13px;color:#6d6459"> admitted</span></span>` : '';
  const overrideUi = r.result === 'over_capacity' ? `
      <div data-v2="over-capacity override" style="display:flex;flex-direction:column;gap:7px;margin-top:4px;width:100%">
        <input data-role="overrideReason" class="input" placeholder="${esc(COPY.scanner.overrideWhy)}" style="background:#fff">
        <span data-act="overrideAdmit" data-code="${esc(r._code || '')}" style="padding:9px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;text-align:center" data-hover="background:#7e151b">${COPY.scanner.overrideBtn}</span>
      </div>` : '';
  const moreUi = partial ? `
      <div style="display:flex;gap:8px;margin-top:4px">
        <span data-act="admitMore" data-code="${esc(r._code || '')}" data-n="1" style="padding:8px 13px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer" data-hover="background:#9b1b22">${COPY.scanner.admitMore}</span>
        ${r.remaining > 1 ? `<span data-act="admitMore" data-code="${esc(r._code || '')}" data-n="2" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${COPY.scanner.admitTwo}</span>` : ''}
      </div>` : '';
  return `
    <span data-role="scanResult" data-state="${esc(r.result || '')}" style="display:flex;flex-direction:column;align-items:center;gap:5px;width:100%;border:1px solid ${r.result === 'over_capacity' ? '#9b1b22' : 'rgba(32,27,22,.14)'};${r.result === 'over_capacity' ? 'background:#f8e9ea;' : ''}padding:12px 14px;box-sizing:border-box">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:${color}">${r.ok && !partial ? '✓ ' : ''}${label}</span>
      ${r.ticket && r.ticket.name ? `<span style="font-family:Fraunces,serif;font-size:19px;line-height:1.1;text-align:center">${esc(r.ticket.name)}</span>` : ''}
      ${r.ticket && r.ticket.meta ? `<span style="font-size:11px;color:#6d6459">${esc(r.ticket.meta)}</span>` : ''}
      ${counts}
      ${r.meetup && r.meetup.title ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#7a6432;text-align:center">${esc(String(r.meetup.title).toUpperCase())}${r.meetup.expected != null ? ' · ' + esc(COPY.meetup.seats(r.meetup.checked_in || 0, r.meetup.expected)) + ' IN' : ''}</span>` : ''}
      <span style="font-size:12px;color:${bad ? '#9b1b22' : '#6d6459'};text-align:center;line-height:1.5">${esc(r.message || '')}</span>
      ${personSnippetHtml(r.person)}
      ${moreUi}${overrideUi}
    </span>`;
}
function blockScanner() {
  // the meetup door refuses to scan until a table is picked — the server answers 400 bad_event
  const blocked = meetupBlocked();
  return `
    <!-- dc: Admin Event Day.dc.html › "SCANNER" -->
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:20px;display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;align-self:flex-start">${COPY.scanner.title}</span>
      ${blocked ? `<span data-v2="meetup door needs a pick" style="width:100%;box-sizing:border-box;border:1px solid #c9a962;background:#f8f1e2;padding:10px 12px;font-size:12px;color:#7a6432;line-height:1.5">${esc(meetupList().length ? COPY.meetup.pick : COPY.meetup.pickNone)}</span>` : ''}
      ${meetupOn() && st.meetupId ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.13em;color:#7a6432">${esc(String((pickedMeetup() || {}).label || '').toUpperCase())}</span><span style="font-size:11.5px;color:#6d6459;margin-top:-8px">${esc(COPY.meetup.pickHint)}</span>` : ''}
      <div data-role="camBox" class="mx-ed-cam${st.camOn ? ' is-live' : ''}" style="width:180px;height:180px;background:repeating-linear-gradient(45deg,#f6f2ea,#f6f2ea 8px,#efe9dc 8px,#efe9dc 16px);border:1px solid rgba(32,27,22,.15);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
        <span data-role="camHint" style="font:500 10px Inter,sans-serif;font-variant-numeric:tabular-nums;color:#6d6459;max-width:120px">${COPY.scanner.camIdle}</span>
        <span class="mx-ed-laser" style="position:absolute;left:14px;right:14px;top:50%;height:2px;background:rgba(155,27,34,.55);z-index:2"></span>
      </div>
      <span style="font-size:12px;color:#6d6459;line-height:1.55;max-width:260px">${COPY.scanner.hint}</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <span data-act="cam"${blocked ? ' aria-disabled="true"' : ''} style="padding:10px 16px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;${blocked ? 'opacity:.45;' : ''}" data-hover="background:#000">${st.camOn ? COPY.scanner.stop : COPY.scanner.start}</span>
        ${st.rehearsal ? `<span data-act="rehSim" style="padding:10px 16px;border:1px solid #c9a962;background:#f8f1e2;color:#7a6432;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer">${COPY.scanner.simulate}</span>` : ''}
      </div>
      <form data-role="manualForm" data-v2="manual code entry — part of the scanner" style="display:flex;gap:8px;width:100%;max-width:280px">
        <input data-role="scanCode" class="input" placeholder="${esc(COPY.scanner.manual)}" autocomplete="off"${blocked ? ' disabled' : ''} style="flex:1;min-width:0">
        <button data-act="scanSubmit" type="submit" class="btn-primary"${blocked ? ' aria-disabled="true" disabled' : ''} style="border:0">${st.instant ? COPY.scanner.admit : COPY.scanner.check}</button>
      </form>
      ${resultHtml()}
    </div>
    <!-- /dc -->`;
}
// UXFIX-A1 #2 (2026-09-02): one-line dense rows (~44px) — name + dimmed meta inline with ellipsis,
// state/button on the same line (never wrapped below), crimson €DUE chip for unpaid gala guests.
// The backend already merged multi-registration people into one row per lower(email).
function doorRowsHtml() {
  if (isPhone()) return phoneRows();
  const rows = st.door || [];
  const row = d => {
    const admitted = Number(d.admitted_count) || 0;
    const partySize = Number(d.party_size) || 1;
    const full = admitted >= partySize && (admitted > 0 || d.legacy_in);
    const partIn = admitted > 0 && admitted < partySize;
    const stateHtml = full
      ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#2f7d4f;white-space:nowrap">${COPY.door.in}${partySize > 1 ? ' · ' + COPY.door.of(admitted, partySize) : (d.last_scan_at ? ' · ' + esc(fmt.when(d.last_scan_at)) : '')}</span>`
      : partIn
        ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#7a6432;white-space:nowrap">${COPY.door.of(admitted, partySize)} ${COPY.door.in}</span>
           <span data-act="doorIn" data-ref="${esc(d.ref)}" style="padding:7px 12px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#9b1b22">${COPY.door.plusOne}</span>`
        : (d.legacy_in
          ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#2f7d4f;white-space:nowrap">${COPY.door.in}</span>`
          : `<span data-act="doorIn" data-ref="${esc(d.ref)}" style="padding:7px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.door.checkIn}${partySize > 1 ? ' · ' + partySize : ''}</span>`);
    const dueChip = d.unpaid && !full
      ? `<span class="mx-ed-due" style="padding:4px 8px;background:#9b1b22;color:#fff;font:700 9.5px Inter,sans-serif;letter-spacing:.12em;white-space:nowrap">${esc(COPY.door.due(Number(d.amount_due) || 150))}</span>`
      : '';
    return `
          <div data-door-ref="${esc(d.ref)}" class="mx-row mx-ed-row" style="display:flex;align-items:center;gap:10px;padding:6px 18px;min-height:44px;box-sizing:border-box;border-bottom:1px solid rgba(32,27,22,.07)">
            <span class="mx-row-text" style="flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;overflow:hidden">
              <span style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;max-width:62%">${esc(d.name)}</span>
              <span style="font-size:11px;color:#6d6459;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${esc(d.meta)}${partySize > 1 ? ' · party of ' + partySize : ''}</span>
            </span>
            ${dueChip}${stateHtml}
          </div>`;
  };
  return `<div data-block="doorRows">${rows.map(row).join('') || `<div style="padding:22px 18px;font-size:12.5px;color:#6d6459;font-style:italic">${COPY.door.empty}</div>`}</div>`;
}
function blockDoorList() {
  return `
    <!-- dc: Admin Event Day.dc.html › "DOOR LIST" -->
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff">
      <div style="padding:12px 18px;border-bottom:1px solid rgba(32,27,22,.12);display:flex;gap:10px;align-items:center">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.door.title}</span>
        <input data-role="doorQ" value="${esc(st.doorQ)}" placeholder="${esc(COPY.door.search)}" aria-label="Search the door list" style="flex:1;border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;min-width:0">
      </div>
      <div class="mx-ed-doorlist" style="max-height:430px;overflow:auto">${doorRowsHtml()}</div>
    </div>
    <!-- /dc -->`;
}
function staffCardBody() {
  // A tokenized door page carries no meetup picker, so the meetup door hands the host their OWN
  // link instead (minted per meetup in the Plexus hub's MEETUPS tab).
  if (st.gate === MEETUP_GATE) return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <a href="/projects/plexus/meetups" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;white-space:nowrap" data-hover="background:#7e151b">${COPY.meetup.staffOpen}</a>
        <span style="font-size:11.5px;color:#6d6459;flex:1;min-width:180px;line-height:1.6">${esc(COPY.meetup.staffWhy)}</span>
      </div>`;
  if (D.errors.tokens && D.errors.tokens.isLocked) return ui.lockedBlock(perms.label(D.errors.tokens.section));
  const alive = (D.tokens || []).filter(t => t.alive && t.event_key === st.gate);
  const t = alive[0];
  if (!t) return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span data-act="mintDoor" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.staff.make}</span>
        <span style="font-size:11.5px;color:#6d6459">one link per door — this one will open the ${esc((COPY.doors.names[st.gate] || st.gate).toLowerCase())} scanner</span>
      </div>`;
  // UXFIX-A1 #3 (2026-09-02): the raw token URL sat in a nowrap flex item without min-width:0, so
  // the whole page stretched to ~756px on a 390px phone. min-width:0 + overflow-wrap:anywhere lets
  // it wrap inside the card; at ≤480px it takes its own line (css/views/event-day.css).
  return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span data-role="doorUrl" style="font:600 12px Inter,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.02em;background:#f6f2ea;border:1px solid rgba(32,27,22,.15);padding:9px 12px;min-width:0;flex:1 1 auto;overflow-wrap:anywhere;box-sizing:border-box">${esc(t.url)}</span>
        <span data-act="copyDoor" data-url="${esc(t.url)}" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${st.copiedDoor ? COPY.staff.copied : COPY.staff.copy}</span>
        <span data-act="qrDoor" data-id="${esc(t.id)}" style="padding:9px 14px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${st.qrUrl ? COPY.staff.hideQr : COPY.staff.qr}</span>
        <span data-act="revokeDoor" data-id="${esc(t.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${COPY.staff.revoke}</span>
        <span style="font-size:11.5px;color:#6d6459">${esc(COPY.staff.expires(t.expires_at ? fmt.dayLabel(t.expires_at) + ' ' + fmt.hm(t.expires_at) : 'when the event ends'))}</span>
      </div>
      ${st.qrUrl ? `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><img src="${st.qrUrl}" alt="Door link QR" style="width:150px;height:150px;border:1px solid rgba(32,27,22,.15)"><span style="font-size:11.5px;color:#6d6459;max-width:220px">${COPY.staff.handQr}</span></div>` : ''}`;
}
function blockStaff() {
  return `
    <!-- dc: Admin Event Day.dc.html › "DOOR-STAFF LINK" -->
    <div data-block="staff" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #c9a962;background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:10px;grid-column:1 / -1">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.staff.title}</span>
      <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${COPY.staff.why}</span>
      ${staffCardBody()}
    </div>
    <!-- /dc -->`;
}
function blockMap() {
  const canEdit = !!(session.user && session.user.is_admin);
  return `
    <!-- dc: Admin Event Day.dc.html › "VENUE MAP" -->
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:10px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.map.title}</span>
      <!-- the striped "staff dots" map it replaces was never built — link the real floor plan + seating instead -->
      <span style="font-size:11.5px;color:#6d6459">${COPY.map.sub}</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="https://plexus-tables.netlify.app/planner.html" target="_blank" rel="noopener" style="padding:9px 13px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="background:#000;color:#fff">${COPY.map.planner}</a>
        <a href="/gala#mx-gala-board" style="padding:8px 12px;border:1px solid rgba(32,27,22,.25);color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;white-space:nowrap" data-hover="border-color:#201b16">${COPY.map.seating}</a>
      </div>
      <div data-v2="ops notes — shared, saved server-side" style="display:flex;flex-direction:column;gap:6px">
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${COPY.map.notes}</span>
        <textarea data-role="notes" rows="3" ${canEdit ? '' : 'readonly'} placeholder="${esc(COPY.map.notesPh)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;resize:vertical">${esc(D.notes.notes || '')}</textarea>
        ${canEdit ? `<span data-act="notesSave" style="padding:8px 13px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;align-self:flex-start" data-hover="background:#9b1b22">${COPY.map.save}</span>` : ''}
      </div>
    </div>
    <!-- /dc -->`;
}
function blockQa() {
  return `
    <!-- dc: Admin Event Day.dc.html › "STAGE Q&A" -->
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:10px">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.qa.title}</span>
      <span style="font-size:12.5px;color:#6d6459;line-height:1.6">${COPY.qa.why}</span>
      <a href="/projects/plexus" style="padding:10px 16px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;align-self:flex-start" data-hover="border-color:#201b16;color:#201b16">${COPY.qa.open}</a>
    </div>
    <!-- /dc -->`;
}
// ---------------------------------------------------------------- HOST BRIEF (v2 addition 2026-08-31)
// The old portal's "who is coming tonight" one-pager, per selected door. No artboard source —
// additive block, dc-marked below. Data: GET /api/v2/host-brief (backend/v2/host-brief.js),
// composed deterministically server-side; `text` is the plain-text twin for COPY AS TEXT.
function briefMicro(t) { return `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459">${t}</span>`; }
function briefBodyHtml() {
  if (st.briefErr) {
    if (st.briefErr.isLocked) return ui.lockedBlock(perms.label(st.briefErr.section));
    return `<span style="font-size:12.5px;color:#9b1b22">${esc(COPY.brief.error)}</span>`;
  }
  const b = st.brief;
  if (!b) return `<span style="font-size:12.5px;color:#6d6459;font-style:italic">${esc(COPY.brief.loading)}</span>`;
  if (b.empty) return `<span style="font-size:13px;color:#6d6459;line-height:1.6">${esc((b.talking_points && b.talking_points[0]) || 'No registrations yet for this door.')}</span>`;
  const h = b.headline || {};
  const cell = (k, v, sub) => `
        <div style="background:#f6f2ea;padding:10px 14px;min-width:96px">${briefMicro(esc(k))}<div style="font-family:Fraunces,serif;font-size:24px;margin-top:2px">${esc(v)}</div>${sub ? `<div style="font-size:10.5px;color:#6d6459">${esc(sub)}</div>` : ''}</div>`;
  const notableRow = n => `
        <div style="display:flex;align-items:baseline;gap:10px;padding:7px 0;border-top:1px solid rgba(32,27,22,.08)">
          <span style="font-size:13px;font-weight:600;white-space:nowrap">${esc(n.name)}</span>
          <span style="flex:1;font-size:11px;color:#6d6459;line-height:1.5">${n.tags.map(t => esc(t)).join(' · ')}${n.institution ? (n.tags.length ? ' · ' : '') + esc(n.institution) : ''}</span>
          ${n.party_size > 1 ? `<span style="font:600 9px Inter,sans-serif;letter-spacing:.1em;color:#7a6432;white-space:nowrap">×${n.party_size}</span>` : ''}
        </div>`;
  const diet = b.dietary || { buckets: [], lines: [], unknown_plus_ones: 0 };
  return `
      ${st.rehearsal ? `<span style="font-size:11px;color:#7a6432;background:#f8f1e2;border:1px solid #c9a962;padding:6px 10px">${esc(COPY.brief.rehearsalNote)}</span>` : ''}
      <div style="display:flex;gap:2px;flex-wrap:wrap">
        ${cell(COPY.brief.expected, h.people || 0, COPY.brief.expectedSub(h.bookings || 0, h.plus_ones || 0))}
        ${cell(COPY.brief.paid, h.paid_people || 0, '')}
        ${cell(COPY.brief.pending, h.pending_people || 0, h.pending_bookings ? h.pending_bookings + ' booking' + (h.pending_bookings === 1 ? '' : 's') : '')}
        ${h.institutions ? cell(COPY.brief.institutions, h.institutions, '') : ''}
        ${h.countries ? cell(COPY.brief.countries, h.countries, '') : ''}
        ${b.arrivals ? cell('IN', b.arrivals.admitted_people, 'of ' + (b.arrivals.expected_people || h.people)) : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${briefMicro(COPY.brief.points)}
        ${(b.talking_points || []).map(p => `<span style="font-size:13px;line-height:1.55">· ${esc(p)}</span>`).join('')}
      </div>
      ${(b.notable && b.notable.length) ? `
      <div style="display:flex;flex-direction:column;gap:2px">
        ${briefMicro(COPY.brief.notable + ' (' + b.notable.length + ')')}
        ${b.notable.map(notableRow).join('')}
      </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:3px">
        ${briefMicro(COPY.brief.kitchen)}
        ${diet.buckets.length
          ? `<span style="font-size:12.5px">${diet.buckets.map(x => esc(x.count + ' ' + x.label)).join(' · ')}</span>
             ${diet.lines.map(x => `<span style="font-size:11.5px;color:#6d6459">· ${esc(x.name)} — ${esc(x.text)}</span>`).join('')}`
          : `<span style="font-size:12px;color:#6d6459;font-style:italic">${esc(COPY.brief.noDietary)}</span>`}
        ${diet.unknown_plus_ones ? `<span style="font-size:11px;color:#6d6459">${esc(COPY.brief.plusOnesDiet(diet.unknown_plus_ones))}</span>` : ''}
      </div>`;
}
function blockHostBrief() {
  const ready = !!(st.brief && st.brief.ok);
  const btn = (act, label, primary) => `<span data-act="${act}" ${ready ? '' : 'aria-disabled="true"'} style="padding:8px 13px;${primary ? 'background:#201b16;color:#f6f2ea;' : 'border:1px solid rgba(32,27,22,.25);color:#201b16;'}font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap;${ready ? '' : 'opacity:.45;'}" ${primary ? 'data-hover="background:#000"' : 'data-hover="border-color:#201b16"'}>${label}</span>`;
  return `
    <!-- dc: v2 addition › "HOST BRIEF" (no artboard source — additive 2026-08-31) -->
    <div data-block="hostBrief" data-v2="host brief — who is coming tonight one-pager (additive 2026-08-31)" style="border:1px solid rgba(32,27,22,.14);border-top:2px solid #9b1b22;background:#fff;padding:16px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${COPY.brief.title}</span>
        <span style="font-size:11.5px;color:#6d6459">${esc((st.brief && st.brief.event_label) || COPY.doors.names[st.gate] || st.gate)}${st.brief && st.brief.date_label ? ' · ' + esc(st.brief.date_label) : ''}</span>
        <div style="flex:1"></div>
        <span data-act="hbRefresh" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;text-decoration:underline">${COPY.brief.refresh}</span>
        ${btn('hbCopy', st.briefCopied ? COPY.brief.copied : COPY.brief.copy, false)}
        ${btn('hbPrint', COPY.brief.print, true)}
      </div>
      <span style="font-size:11.5px;color:#6d6459;margin-top:-6px">${COPY.brief.sub}</span>
      ${briefBodyHtml()}
    </div>
    <!-- /dc -->`;
}
// Print twin — clean black-on-white sheet, pt-sized for paper. Injected into .mx-hb-printbox;
// the print-only stylesheet (id mx-css-hostbrief-print, added in render) shows ONLY this box.
function briefPrintHtml(b) {
  const h = b.headline || {};
  const diet = b.dietary || { buckets: [], lines: [], unknown_plus_ones: 0 };
  const sec = t => `<div style="font:700 9pt Inter,Arial,sans-serif;letter-spacing:.16em;margin:14pt 0 4pt;border-bottom:1pt solid #000;padding-bottom:2pt">${esc(t)}</div>`;
  const li = t => `<div style="font-size:11pt;line-height:1.5;margin:2pt 0">· ${t}</div>`;
  return `
    <div style="max-width:180mm;margin:0 auto;padding:10mm 0;color:#000">
      <div style="font:700 9pt Inter,Arial,sans-serif;letter-spacing:.22em">MED&amp;X — HOST BRIEF</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:20pt;margin-top:4pt">${esc(b.event_label || '')}</div>
      <div style="font-size:10pt;color:#333;margin-top:2pt">${esc(b.date_label || '')}${b.date_label ? ' · ' : ''}composed ${esc(fmt.todayLabel())}</div>
      ${b.empty ? li(esc((b.talking_points && b.talking_points[0]) || 'No registrations yet for this door.')) : `
      ${sec(COPY.brief.room)}
      ${li(`<b>${h.people || 0}</b> people expected across ${h.bookings || 0} bookings${h.plus_ones ? ` (${h.plus_ones} plus-one${h.plus_ones === 1 ? '' : 's'})` : ''}`)}
      ${li(`${h.paid_people || 0} paid · ${h.pending_people || 0} pending${h.free_people ? ` · ${h.free_people} free / no payment needed` : ''}`)}
      ${(h.institutions || h.countries) ? li([h.institutions ? h.institutions + ' institution' + (h.institutions === 1 ? '' : 's') : '', h.countries ? h.countries + ' countr' + (h.countries === 1 ? 'y' : 'ies') : ''].filter(Boolean).join(' · ')) : ''}
      ${b.arrivals ? li(`<b>${b.arrivals.admitted_people}</b> already in`) : ''}
      ${sec(COPY.brief.points)}
      ${(b.talking_points || []).map(p => li(esc(p))).join('')}
      ${(b.notable && b.notable.length) ? sec(COPY.brief.notable) + b.notable.map(n => li(`<b>${esc(n.name)}</b> — ${n.tags.map(t => esc(t)).join(' · ')}${n.institution ? ' · ' + esc(n.institution) : ''}${n.party_size > 1 ? ' · party of ' + n.party_size : ''}`)).join('') : ''}
      ${sec(COPY.brief.kitchen)}
      ${diet.buckets.length
        ? li(diet.buckets.map(x => esc(x.count + ' ' + x.label)).join(' · ')) + diet.lines.map(x => li(`${esc(x.name)} — ${esc(x.text)}`)).join('')
        : li(esc(COPY.brief.noDietary))}
      ${diet.unknown_plus_ones ? li(esc(COPY.brief.plusOnesDiet(diet.unknown_plus_ones))) : ''}`}
    </div>`;
}
// ================================================================ DOOR MODE blocks (phone, 2026-09-21)
const doorName = k => COPY.doors.names[k] || String(k || '').toUpperCase();
const currentBridgesEvent = () => (D && (D.over.bridges_events || []).find(e => String(e.id) === String(st.bridgesEvent))) || null;
const rowIn = d => { const a = Number(d.admitted_count) || 0, p = Number(d.party_size) || 1; return a >= p && (a > 0 || d.legacy_in); };
const rowPartial = d => { const a = Number(d.admitted_count) || 0, p = Number(d.party_size) || 1; return a > 0 && a < p; };
const rowStarted = d => rowIn(d) || rowPartial(d) || !!d.legacy_in;
function roleChip(role, extraClass) {
  if (!role) return '';
  return `<span class="mx-ed-chip ${role}${extraClass ? ' ' + extraClass : ''}">${COPY.phone.role[role]}</span>`;
}
function hdrCountHtml() {
  const { checked, expected } = gateStats();
  return `${COPY.phone.inOf(checked, expected)}<small>${COPY.phone.inWord}</small>`;
}
// in rehearsal the amber banner right under the title says REHEARSAL — TEST GUESTS ONLY (the title used
// to repeat it word for word); the title names the door the rehearsal runs at, as it does live
function doorTitleHtml() {
  if (st.gate === 'bridges') {
    const ev = currentBridgesEvent();
    const g = gateInfo('bridges');
    const main = ev ? `${esc(g.label || 'Building Bridges')} — ${esc(ev.label)}` : esc(g.label || 'Building Bridges');
    // "Building Bridges — Boston" on the serif line, "GORDON HALL · SEP 21 · 18:00" beneath it
    const sub = [st.venue, ev && ev.date ? fmt.dayLabel(ev.date) : '', ev && ev.time ? ev.time : ''].filter(Boolean).join(' · ');
    return `${main}${sub ? `<small>${esc(sub.toUpperCase())}</small>` : ''}`;
  }
  if (st.gate === MEETUP_GATE) {
    const m = pickedMeetup();
    return m ? `${esc(m.label || 'Meetup')}<small>${esc(COPY.meetup.hostLine(m.host, m.venue).toUpperCase())}</small>` : `Meetups<small>${esc(meetupList().length ? COPY.meetup.pick.toUpperCase() : COPY.meetup.pickNone.toUpperCase())}</small>`;
  }
  const g = gateInfo(st.gate);
  const when = g.starts_at ? fmt.dayLabel(g.starts_at) + ' · ' + String(g.starts_at).slice(11, 16) : '';
  return `${esc(g.label || doorName(st.gate))}${when ? `<small>${esc(when.toUpperCase())}</small>` : ''}`;
}
function doorOptions() {
  const opts = [];
  GATE_ORDER.forEach(k => {
    if (k === 'bridges') {
      const bevs = (D.over.bridges_events || []);
      if (!bevs.length) { opts.push({ v: 'bridges', l: doorName(k), on: st.gate === 'bridges' }); return; }
      bevs.forEach(ev => opts.push({ v: 'bridges:' + ev.id, l: `${doorName(k)} · ${String(ev.label || '').toUpperCase()}`, on: st.gate === 'bridges' && String(st.bridgesEvent) === String(ev.id) }));
      return;
    }
    const g = gateInfo(k);
    opts.push({ v: k, l: `${doorName(k)}${g.starts_at ? ' · ' + fmt.dayLabel(g.starts_at) : ''}`, on: st.gate === k });
  });
  return opts;
}
function phoneHeader() {
  return `
    <div class="mx-ed-hdr" data-block="phoneHeader">
      <div class="mx-ed-hdr-row">
        <label class="mx-ed-doorsel" aria-label="${COPY.doors.label}">
          <select data-role="doorSel">${doorOptions().map(o => `<option value="${esc(o.v)}"${o.on ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>
        </label>
        <span class="mx-ed-hdr-count" data-role="hdrCount">${hdrCountHtml()}</span>
        <span class="mx-ed-more" data-act="more" aria-expanded="${!!st.more}" aria-label="${COPY.phone.more}" title="${COPY.phone.more}">…</span>
      </div>
      <div class="mx-ed-title" data-role="hdrTitle">${doorTitleHtml()}</div>
      <span data-role="queuePill" data-act="more" style="display:none;align-self:flex-start;background:#c9a962;color:#201b16;padding:8px 12px;font:600 10px Inter,sans-serif;letter-spacing:.12em;cursor:pointer"></span>
    </div>`;
}
function phoneSettings() {
  if (!st.more) return `<div data-block="settings"></div>`;
  return `
    <div data-block="settings" class="mx-ed-settings">
      <span data-act="reh" role="switch" aria-checked="${!!st.rehearsal}" class="mx-ed-set reh"><span class="sw"></span>${COPY.toggle}</span>
      <span data-act="instant" role="switch" aria-checked="${!!st.instant}" class="mx-ed-set inst"><span class="sw"></span>${COPY.scanner.instant}</span>
      <span data-role="queueBadge" style="display:none;background:#c9a962;color:#201b16;padding:0 12px;min-height:44px;font:600 10px Inter,sans-serif;letter-spacing:.12em;align-items:center"></span>
      <span data-act="syncNow" class="mx-ed-set link" style="display:none">${COPY.scanner.sync}</span>
      ${st.gate === MEETUP_GATE ? '' : `<span data-act="briefToggle" class="mx-ed-set">${st.showBrief ? COPY.phone.hideBrief : COPY.phone.brief}</span>`}
      ${st.gate === MEETUP_GATE ? gateChips() : ''}
      <span class="mx-ed-note" style="width:100%;text-align:left;font-size:11px;letter-spacing:.08em">${COPY.phone.desktop}</span>
    </div>`;
}
function phoneBanner() {
  if (!st.rehearsal) return '';
  return `<div class="mx-ed-reh" data-role="rehBanner"><span class="dot"></span><span>${COPY.banner}</span><span data-act="rehReset">${COPY.bannerReset}</span></div>`;
}
function phoneCounts() {
  const { checked, expected } = gateStats();
  const base = st.doorAll || st.door || [];
  const pres = base.filter(isPresRow);
  const third = pres.length
    ? `<div><div class="k">${COPY.phone.counts.pres}</div><div class="v">${pres.filter(rowStarted).length}<small> / ${pres.length}</small></div></div>`
    : `<div><div class="k">${COPY.counters.expected}</div><div class="v">${Math.max(0, expected - checked)}</div></div>`;
  return `
    <div data-block="counters" class="mx-ed-counts">
      <div><div class="k">${COPY.phone.counts.in}</div><div class="v">${checked}</div></div>
      <div><div class="k">${COPY.phone.counts.expected}</div><div class="v">${expected}</div></div>
      ${third}
    </div>`;
}
function phoneTabs() {
  const out = (st.door || []).filter(d => !rowIn(d)).length;
  return `
    <div class="mx-ed-tabs" role="tablist">
      <span data-act="tab" data-key="scan" role="tab" aria-selected="${st.tab !== 'list'}" class="mx-ed-tab">${COPY.phone.tabScan}</span>
      <span data-act="tab" data-key="list" role="tab" aria-selected="${st.tab === 'list'}" class="mx-ed-tab">${COPY.phone.tabList}<span class="n" data-role="tabOut">${out}</span></span>
    </div>`;
}
function phoneScanner() {
  const blocked = meetupBlocked();
  return `
    <div class="mx-ed-panel mx-ed-scan" data-panel="scan"${st.tab === 'list' ? ' hidden' : ''}>
      ${blocked ? `<div class="mx-ed-block">${esc(meetupList().length ? COPY.meetup.pick : COPY.meetup.pickNone)}</div>` : ''}
      <div data-role="camBox" class="mx-ed-cam${st.camOn ? ' is-live' : ''}">
        <span data-role="camHint">${COPY.phone.camIdle}</span>
        <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
        <span class="laser"></span>
      </div>
      <span data-act="cam" class="mx-ed-big ink"${blocked ? ' aria-disabled="true"' : ''}>${camLabel(st.camOn)}</span>
      ${st.rehearsal ? `<span data-act="rehSim" class="mx-ed-big amber sm">${COPY.scanner.simulate}</span>` : ''}
      <form data-role="manualForm" class="mx-ed-manual">
        <input data-role="scanCode" placeholder="${esc(COPY.phone.manual)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="${esc(COPY.phone.manual)}"${blocked ? ' disabled' : ''}>
        <button data-act="scanSubmit" type="submit" class="mx-ed-big red"${blocked ? ' aria-disabled="true" disabled' : ''}>${st.instant ? COPY.phone.admit : COPY.phone.check}</button>
      </form>
    </div>`;
}
function phoneFilter() {
  const rows = st.door || [];
  const n = { out: rows.filter(d => !rowIn(d)).length, in: rows.filter(rowIn).length, all: rows.length };
  return `
    <div data-block="listFilter" class="mx-ed-filter" role="tablist">
      ${['out', 'in', 'all'].map(k => `<span data-act="filter" data-key="${k}" role="tab" aria-selected="${(st.listFilter || 'out') === k}">${COPY.phone.filters[k]} <b>${n[k]}</b></span>`).join('')}
    </div>`;
}
function phoneRows() {
  const f = st.listFilter || 'out';
  let rows = (st.door || []).filter(d => f === 'all' ? true : f === 'in' ? rowIn(d) : !rowIn(d));
  const rank = d => (roleOf(regOf(d.ref, d.email)) ? 0 : 1);
  rows = rows.slice().sort((a, b) => rank(a) - rank(b) || (rowIn(a) === rowIn(b) ? 0 : rowIn(a) ? 1 : -1) || String(a.name).localeCompare(String(b.name)));
  const row = d => {
    const reg = regOf(d.ref, d.email);
    const role = roleOf(reg);
    const partySize = Number(d.party_size) || 1, admitted = Number(d.admitted_count) || 0;
    const full = rowIn(d), part = rowPartial(d);
    const inst = (reg && reg.institution) || (st.gate === 'bridges' && !st.rehearsal ? '' : d.meta) || '';
    const at = hhmm(d.last_scan_at || (reg && reg.checked_in_at));
    const chips = [
      roleChip(role),
      partySize > 1 ? `<span class="mx-ed-chip party">${COPY.phone.partyOf(partySize)}</span>` : '',
      d.unpaid && !full ? `<span class="mx-ed-chip due">${esc(COPY.door.due(Number(d.amount_due) || 150))}</span>` : ''
    ].filter(Boolean).join('');
    const state = full
      ? `<span class="tick"><i>✓</i>${at || COPY.door.in}</span>`
      : part
        ? `<span class="part">${COPY.door.of(admitted, partySize)}</span><span data-act="doorIn" data-ref="${esc(d.ref)}" class="mx-ed-cta ink">${COPY.door.plusOne}</span>`
        : d.legacy_in
          ? `<span class="tick"><i>✓</i>${at || COPY.door.in}</span>`
          : `<span data-act="doorIn" data-ref="${esc(d.ref)}" class="mx-ed-cta">${COPY.door.checkIn}${partySize > 1 ? ' · ' + partySize : ''}</span>`;
    return `
      <div data-act="rowOpen" data-ref="${esc(d.ref)}" data-email="${esc(d.email || '')}" data-door-ref="${esc(d.ref)}" class="mx-ed-prow${full ? ' in' : ''}">
        <div class="txt">
          <div class="nm">${esc(d.name)}</div>
          ${inst ? `<div class="inst">${esc(inst)}</div>` : ''}
          ${chips ? `<div class="chips">${chips}</div>` : ''}
        </div>
        <div class="st">${state}</div>
      </div>`;
  };
  const pres = rows.filter(d => rank(d) === 0), rest = rows.filter(d => rank(d) === 1);
  const body = !rows.length
    ? `<div class="mx-ed-empty">${st.doorQ ? esc('No one matches “' + st.doorQ + '”.') : COPY.door.empty}</div>`
    : pres.length
      ? `<div class="mx-ed-secthead">${COPY.phone.presentersFirst} · ${pres.length}</div>${pres.map(row).join('')}${rest.length ? `<div class="mx-ed-secthead">${COPY.phone.others} · ${rest.length}</div>${rest.map(row).join('')}` : ''}`
      : rows.map(row).join('');
  return `<div data-block="doorRows">${body}</div>`;
}
function phoneList() {
  return `
    <div class="mx-ed-panel mx-ed-list" data-panel="list"${st.tab === 'list' ? '' : ' hidden'}>
      <div class="mx-ed-listhead">
        <input data-role="doorQ" class="mx-ed-search" value="${esc(st.doorQ)}" placeholder="${esc(COPY.phone.search)}" aria-label="Search the door list" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        ${phoneFilter()}
      </div>
      ${doorRowsHtml()}
    </div>`;
}
function phoneBriefHost() {
  return `<div data-block="briefHost">${st.showBrief && st.gate !== MEETUP_GATE ? blockHostBrief() : ''}</div>`;
}
// ---- the result SHEET: a lookup card (ADMIT) or a scan outcome (green confirmation / red refusal)
function legStatus(d, at) {
  if (!d.ok) return `<span class="s no">${esc((COPY.results[d.block] || d.block || '').toUpperCase())}${d.message ? `<small>${esc(d.message)}</small>` : ''}</span>`;
  const ps = Number(d.party_size) || 1, a = Number(d.admitted) || 0;
  if (d.remaining === 0 && a > 0) return `<span class="s ok">${ps > 1 ? `${COPY.results.party_complete} · ${COPY.door.of(a, ps)}` : COPY.phone.alreadyIn(at)}</span>`;
  if (a > 0) return `<span class="s part">${COPY.door.of(a, ps)} ${COPY.door.in}</span>`;
  return `<span class="s wait">${COPY.phone.notYetIn.toUpperCase()}${ps > 1 ? ' · ' + COPY.phone.partyOf(ps) : ''}</span>`;
}
function sheetIdHtml() {
  const c = st.idcard, p = c.person || {}, code = c._code || '';
  const reg = regOf(code, p.email);
  const role = roleOf(reg) || 'guest';
  const doors = c.doors || [];
  const cur = doors.find(d => d.event === st.gate) || null;
  const others = doors.filter(d => d !== cur);
  const inst = p.institution || (reg && reg.institution) || '';
  const pos = p.position || (reg && reg.position) || '';
  const email = String(p.email || '').toLowerCase();
  const row = (st.door || []).find(r => String(r.ref) === String(code) || (email && String(r.email || '').toLowerCase() === email)) || null;
  const at = hhmm((row && row.last_scan_at) || (reg && reg.checked_in_at));
  const party = Number((cur || doors[0] || {}).party_size) || 1;
  let tone = '', banner = '', actions = '';
  if (cur && cur.ok && cur.remaining > 0) {
    actions = `<span data-act="idAdmit" data-key="${esc(cur.event)}"${cur.meetup_id ? ` data-meetup="${esc(cur.meetup_id)}"` : ''} data-code="${esc(code)}" data-n="1" class="mx-ed-big red">${COPY.phone.admitOne(cur.remaining)}</span>`
      + (cur.remaining > 1 ? `<span data-act="idAdmit" data-key="${esc(cur.event)}"${cur.meetup_id ? ` data-meetup="${esc(cur.meetup_id)}"` : ''} data-code="${esc(code)}" data-n="${cur.remaining}" class="mx-ed-big ink sm">${COPY.phone.admitAll(cur.remaining)}</span>` : '');
    if (cur.admitted > 0) tone = 'warn';
  } else if (cur && cur.ok) {
    tone = 'good';
    banner = `<div class="banner grey">${party > 1 ? `${COPY.results.party_complete} · ${COPY.door.of(cur.admitted, cur.party_size)}` : COPY.phone.alreadyIn(at)}</div>`;
  } else if (cur && !cur.ok) {
    tone = 'bad';
    banner = `<div class="banner bad">${esc((COPY.results[cur.block] || cur.block || '').toUpperCase())}${cur.message ? `<small>${esc(cur.message)}</small>` : ''}</div>`;
  } else {
    tone = doors.length ? 'warn' : 'bad';
    banner = doors.length
      ? `<div class="banner warn">${COPY.phone.notThisDoor}<small>${COPY.phone.notThisDoorWhy}</small></div>`
      : `<div class="banner bad">${COPY.phone.nothing}</div>`;
  }
  const leg = (d, isCur) => `
      <div class="mx-ed-leg">
        <span class="d">${esc(d.event === MEETUP_GATE && d.label ? String(d.label).toUpperCase() : doorName(d.event))}</span>
        ${legStatus(d, isCur ? at : '')}
        ${!isCur && d.ok && d.remaining > 0 ? `<span data-act="idAdmit" data-key="${esc(d.event)}"${d.meetup_id ? ` data-meetup="${esc(d.meetup_id)}"` : ''} data-code="${esc(code)}" data-n="1" class="mx-ed-cta ink">${COPY.phone.admitAt(d.event === MEETUP_GATE && d.label ? String(d.label).toUpperCase() : doorName(d.event))}</span>` : ''}
      </div>`;
  const html = `
      <div class="head"><span class="eyebrow">${COPY.scanner.idTitle}</span><span class="x" data-act="sheetClose" aria-label="${COPY.phone.close}">×</span></div>
      <div class="name">${esc(p.name || '')}</div>
      ${inst ? `<div class="inst">${esc(inst)}</div>` : ''}
      ${pos ? `<div class="pos">${esc(pos)}</div>` : ''}
      <div class="chips">${roleChip(role)}${party > 1 ? `<span class="mx-ed-chip party">${COPY.phone.partyOf(party)}</span>` : ''}</div>
      ${banner}
      ${doors.length ? `<div class="mx-ed-legs">${cur ? leg(cur, true) : ''}${others.map(d => leg(d, false)).join('')}</div>` : ''}
      ${p.bio ? `<div class="msg">${esc(String(p.bio).slice(0, 260))}</div>` : ''}
      <div class="actions">${actions}<span data-act="sheetClose" class="mx-ed-big ghost sm">${COPY.phone.close}</span></div>`;
  return { tone, html };
}
function sheetResultHtml() {
  const r = st.last;
  const label = COPY.results[r.result] || String(r.result || '').replace(/_/g, ' ').toUpperCase();
  const bad = ['over_capacity', 'not_paid', 'revoked', 'cancelled', 'not_found', 'wrong_event', 'not_registered_for_event', 'error', 'wrong_meetup', 'not_confirmed', 'bad_code', 'bad_event'].includes(r.result);
  const partial = r.ok && r.remaining > 0;
  const queued = r.result === 'queued';
  const tone = bad ? 'bad' : (queued || partial) ? 'warn' : 'good';
  const t = r.ticket || {};
  const reg = regOf(r._code, t.email);
  const role = roleOf(reg);
  const inst = (reg && reg.institution) || (r.person && r.person.institution) || '';
  const at = hhmm(new Date().toISOString());
  const banner = bad
    ? `<div class="banner bad">${esc(label)}${r.message ? `<small>${esc(r.message)}</small>` : ''}</div>`
    : queued
      ? `<div class="banner warn">${esc(label)}${r.message ? `<small>${esc(r.message)}</small>` : ''}</div>`
      : `<div class="banner good">✓ ${esc(partial ? COPY.phone.admitted : label)}<small>${r.party_size ? COPY.phone.inNow(r.admitted_count, r.party_size) + ' · ' : ''}${at}</small></div>`;
  const overrideUi = r.result === 'over_capacity' ? `
      <input data-role="overrideReason" class="input" placeholder="${esc(COPY.scanner.overrideWhy)}">
      <span data-act="overrideAdmit" data-code="${esc(r._code || '')}" class="mx-ed-big red sm">${COPY.scanner.overrideBtn}</span>` : '';
  const moreUi = partial ? `
      <span data-act="admitMore" data-code="${esc(r._code || '')}" data-n="1" class="mx-ed-big red">${COPY.scanner.admitMore}</span>
      ${r.remaining > 1 ? `<span data-act="admitMore" data-code="${esc(r._code || '')}" data-n="${r.remaining}" class="mx-ed-big ink sm">${COPY.phone.admitAll(r.remaining)}</span>` : ''}` : '';
  const nextLabel = st.tab === 'list' ? COPY.phone.done : COPY.phone.next;
  const html = `
      <div class="head"><span class="eyebrow">${esc(st.rehearsal ? COPY.toggle : (r.event_label || doorName(st.gate)))}</span><span class="x" data-act="sheetClose" aria-label="${COPY.phone.close}">×</span></div>
      ${banner}
      ${t.name ? `<div class="name">${esc(t.name)}</div>` : ''}
      ${inst ? `<div class="inst">${esc(inst)}</div>` : (t.meta && !(st.gate === 'bridges' && !st.rehearsal) ? `<div class="inst">${esc(t.meta)}</div>` : '')}
      ${(role || (r.party_size > 1)) ? `<div class="chips">${roleChip(role)}${r.party_size > 1 ? `<span class="mx-ed-chip party">${COPY.phone.partyOf(r.party_size)}</span>` : ''}</div>` : ''}
      ${r.meetup && r.meetup.title ? `<div class="msg">${esc(String(r.meetup.title).toUpperCase())}${r.meetup.expected != null ? ' · ' + esc(COPY.meetup.seats(r.meetup.checked_in || 0, r.meetup.expected)) + ' IN' : ''}</div>` : ''}
      ${!bad && !queued && r.message ? `<div class="msg">${esc(r.message)}</div>` : ''}
      ${personSnippetHtml(r.person)}
      <div class="actions">
        ${overrideUi}${moreUi}
        ${bad ? `<span data-act="sheetClose" class="mx-ed-big ink">${COPY.phone.close}</span>` : `<span data-act="nextScan" class="mx-ed-big ${partial ? 'ghost' : 'green'}">${nextLabel}</span>`}
      </div>`;
  return { tone, html };
}
function sheetHtml() {
  if (!sheetOpen()) return '';
  const inner = st.idcard ? sheetIdHtml() : sheetResultHtml();
  return `
    <div class="mx-ed-sheetwrap" data-act="sheetClose" role="dialog" aria-modal="true">
      <div class="mx-ed-sheet${inner.tone ? ' ' + inner.tone : ''}" data-act="noop">${inner.html}</div>
    </div>`;
}
function phoneTemplate() {
  const live = isLive();
  return `
<div data-screen-label="Admin Event Day" class="mxpj mx-ed-phone" data-v2="door mode — phone-first layout (2026-09-21)">
  ${!live ? `<div class="mx-ed-title" style="padding-top:8px">${COPY.title}</div>${blockQuiet()}` : `
  ${phoneHeader()}
  ${phoneSettings()}
  ${phoneBanner()}
  ${phoneCounts()}
  ${phoneTabs()}
  ${phoneScanner()}
  ${phoneList()}
  ${phoneBriefHost()}
  <div data-role="sheetHost">${sheetHtml()}</div>`}
</div>`;
}

function template() {
  if (isPhone()) return phoneTemplate();
  const live = isLive();
  return `
<div class="mxpj" data-screen-label="Admin Event Day" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter mx-stagger" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
    ${blockTitle()}
    ${!live ? blockQuiet() : `
    ${blockBanner()}
    ${gateChips()}
    ${blockCounters()}
    <div class="mx-two" style="display:grid;grid-template-columns:1fr 1.4fr;gap:22px;align-items:start">
      ${blockScanner()}
      ${blockDoorList()}
    </div>
    <div class="mx-two" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
      ${blockStaff()}
      ${blockMap()}
      ${blockQa()}
    </div>
    ${st.gate === MEETUP_GATE ? '' : blockHostBrief()}`}
  </div>
</div>`;
}

// ---------------------------------------------------------------- behaviour
function paint(sel, html) { const el = rootEl && rootEl.querySelector(sel); if (el) el.outerHTML = html; }
function rerenderAll() {
  stopCam();
  rootEl.innerHTML = template();
  wireInputs();
  paintQueue();
}
function wireInputs() {
  const dq = rootEl.querySelector('[data-role="doorQ"]');
  if (dq) {
    let t = null;
    dq.addEventListener('input', e => { st.doorQ = e.target.value; clearTimeout(t); t = setTimeout(refreshDoor, 250); });
  }
  const mf = rootEl.querySelector('[data-role="manualForm"]');
  if (mf) mf.addEventListener('submit', e => { e.preventDefault(); handlers.scanSubmit(); });
  // door mode: the compact door dropdown ("bridges:<edition id>" or a gate key)
  const ds = rootEl.querySelector('[data-role="doorSel"]');
  if (ds) ds.addEventListener('change', e => {
    const v = String(e.target.value || '');
    const m = v.match(/^bridges:(.+)$/);
    switchDoor(m ? 'bridges' : v, m ? m[1] : null);
  });
}
// One path for every door change (desktop chips, the phone dropdown, a Bridges edition pick).
async function switchDoor(key, bridgesEventId) {
  st.gate = key; st.last = null; st.idcard = null; st.qrUrl = null; st.copiedDoor = false;
  st.brief = null; st.briefErr = null; st.briefCopied = false;   // v2 host brief follows the door
  st.door = []; st.doorAll = []; st.doorQ = '';
  if (bridgesEventId) st.bridgesEvent = bridgesEventId;
  if (st.gate === MEETUP_GATE) { st.door = []; if (!pickedMeetup()) st.meetupId = meetupList().length === 1 ? meetupList()[0].id : null; }
  rerenderAll();
  refreshDoor();
  loadBridgesEdition().then(afterEdition);
  if (!isPhone() || st.showBrief) refreshBrief();
  try { D.notes = await api.get('/api/v2/eventday/notes?event=' + encodeURIComponent(st.gate)); const n = rootEl && rootEl.querySelector('[data-role="notes"]'); if (n) n.value = D.notes.notes || ''; } catch (e) {}
}
// the edition enrichment (venue · institutions · presenter roles) lands after the first paint
function afterEdition() {
  if (!rootEl || !st) return;
  const t = rootEl.querySelector('[data-role="hdrTitle"]'); if (t) t.innerHTML = doorTitleHtml();
  paint('[data-block="doorRows"]', doorRowsHtml());
  if (isPhone()) paintCounts();
  if (sheetOpen()) presentResult();
}
function setTab(key) {
  st.tab = key === 'list' ? 'list' : 'scan';
  rootEl.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== st.tab; });
  rootEl.querySelectorAll('[data-act="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.key === st.tab)));
  if (st.tab === 'list') { const q = rootEl.querySelector('[data-role="doorQ"]'); if (q && !st.door.length) refreshDoor(); }
}

// A switch flips in place and gets 200 ms to slide (css: .mx-ed-switch · .mx-ed-set) before the redraw
// replaces it — the redraw is what used to make the knob jump. Resolves true when it waited; no wait for
// reduced motion or when no switch for `act` is on screen.
function slideFirst(act, on) {
  const els = rootEl ? rootEl.querySelectorAll(`[data-act="${act}"][role="switch"]`) : [];
  if (!els.length || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return Promise.resolve(false);
  els.forEach(el => el.setAttribute('aria-checked', String(!!on)));
  return new Promise(r => setTimeout(() => r(true), 200));
}

// The desktop switch survives the redraw it triggers: the new copy is swapped back for the element the
// pointer (or the keyboard focus) is on, so its hover look and focus carry over instead of flickering off
// and on. Its colours follow aria-checked in css (.mx-ed-switch), so the kept element is never stale.
function keepSwitch(act, redraw) {
  const old = rootEl && rootEl.querySelector(`.mx-ed-switch[data-act="${act}"]`);
  const hadFocus = !!old && document.activeElement === old;
  redraw();
  const fresh = rootEl && rootEl.querySelector(`.mx-ed-switch[data-act="${act}"]`);
  if (!old || !fresh || old === fresh) return;
  old.setAttribute('aria-checked', fresh.getAttribute('aria-checked'));
  fresh.replaceWith(old);
  if (hadFocus) old.focus({ preventScroll: true });
}

const handlers = {
  // ---- door mode (phone) ----
  noop: () => {},
  more: (el) => { st.more = !st.more; paint('[data-block="settings"]', phoneSettings()); paintQueue(); el.setAttribute('aria-expanded', String(!!st.more)); },
  tab: (el) => setTab(el.dataset.key),
  filter: (el) => { st.listFilter = el.dataset.key || 'out'; paint('[data-block="listFilter"]', phoneFilter()); paint('[data-block="doorRows"]', doorRowsHtml()); },
  rowOpen: (el) => {
    const ref = el.dataset.ref;
    if (!ref) return;
    // rehearsal practice guests are known only to /scan (see identify) — a tap on the row admits like CHECK IN
    if (st.rehearsal && /^TEST-\d+$/i.test(ref)) return handlers.doorIn(el);
    identify(ref, { method: 'manual' });
  },
  sheetClose: () => { st.idcard = null; st.last = null; presentResult(); },
  nextScan: () => {
    st.idcard = null; st.last = null; presentResult();
    if (st.tab !== 'list' && st.camWanted && !st.camOn) startCam();   // re-arm the camera if the phone dropped it
    const i = rootEl.querySelector('[data-role="scanCode"]'); if (i && st.tab !== 'list' && !st.camOn) i.focus();
  },
  briefToggle: () => {
    st.showBrief = !st.showBrief;
    paint('[data-block="settings"]', phoneSettings()); paintQueue();
    paint('[data-block="briefHost"]', phoneBriefHost());
    if (st.showBrief && !st.brief) refreshBrief();
    if (st.showBrief) { const b = rootEl.querySelector('[data-block="briefHost"]'); if (b && b.scrollIntoView) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  },
  reh: async () => {
    st.rehearsal = !st.rehearsal;
    try { localStorage.setItem(REH_KEY, st.rehearsal ? '1' : ''); } catch (e) {}
    st.last = null;
    if (await slideFirst('reh', st.rehearsal) && (!rootEl || !st)) return;
    keepSwitch('reh', rerenderAll);
    refreshDoor();
    if (isLive() && !st.brief) refreshBrief();   // v2: first flip into rehearsal wakes the brief too
    if (!st.rehearsal) refreshCounts();
  },
  rehReset: async () => {
    const ok = await ui.confirm({ title: 'Reset the rehearsal?', body: 'Clears every practice check-in. Real data is never touched by rehearsal either way.', ok: 'RESET', cancel: 'KEEP' });
    if (!ok) return;
    try { await api.post('/api/v2/eventday/rehearsal/reset'); ui.toast('REHEARSAL CLEARED — FRESH PRACTICE RUN'); st.last = null; await refreshDoor(); paint('[data-block="counters"]', blockCounters()); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  bridgesEv: (el) => {
    st.bridgesEvent = el.dataset.id; st.last = null; st.idcard = null;
    paint('[data-block="gateChips"]', gateChips());
    paintCounts();
    refreshDoor();
    loadBridgesEdition().then(afterEdition);
  },
  // one picked table at a time (2026-09-11) — the door list and the counters follow it
  meetupPick: (el) => {
    st.meetupId = el.dataset.id; st.last = null; st.idcard = null; st.door = [];
    rerenderAll();
    refreshDoor();
  },
  gate: (el) => switchDoor(el.dataset.key, null),
  cam: () => {
    if (meetupBlocked()) { ui.toast(COPY.meetup.pick.toUpperCase()); return; }
    if (st.camOn) { st.camWanted = false; stopCam(); } else { st.camWanted = true; startCam(); }
  },
  rehSim: () => {
    // practice: admit the next test guest that still has room (TEST-5 demos the crimson unpaid state last)
    const rows = (st.door || []).filter(r => /^TEST-/.test(r.ref));
    const next = rows.find(r => r.admitted_count < r.party_size && r.ref !== 'TEST-5') || rows.find(r => r.admitted_count < r.party_size);
    if (!next) { ui.toast('EVERY TEST GUEST IS IN — RESET THE REHEARSAL TO GO AGAIN'); return; }
    // practice at the test guest's own door WITHOUT moving the room's door picker
    scan(next.ref, { method: 'manual', event: (next.event && GATE_ORDER.includes(next.event)) ? next.event : st.gate });
  },
  scanSubmit: () => {
    if (meetupBlocked()) { ui.toast(COPY.meetup.pick.toUpperCase()); return; }
    const i = rootEl.querySelector('[data-role="scanCode"]');
    const v = i ? i.value.trim() : '';
    if (!v) { ui.toast('SCAN OR TYPE A CODE FIRST'); return; }
    if (st.instant) scan(v, { method: 'manual' }).then(out => { if (out) { out._code = v; showResult(out); } });
    else identify(v, { method: 'manual' });
    if (i) i.value = '';
  },
  instant: async () => {
    st.instant = !st.instant;
    try { localStorage.setItem('medx_v2_instant', st.instant ? '1' : ''); } catch (e) {}
    if (isPhone() && await slideFirst('instant', st.instant) && (!rootEl || !st)) return;
    if (isPhone()) { paint('[data-block="settings"]', phoneSettings()); paintQueue(); }
    else paint('[data-block="gateChips"]', gateChips());
    const btn = rootEl.querySelector('[data-act="scanSubmit"]');
    if (btn) btn.textContent = st.instant ? (isPhone() ? COPY.phone.admit : COPY.scanner.admit) : (isPhone() ? COPY.phone.check : COPY.scanner.check);
  },
  idAdmit: (el) => {
    const code = el.dataset.code, key = el.dataset.key;
    if (!code || !key) return;
    const n = parseInt(el.dataset.n, 10) || 1;
    const how = (st.idcard && st.idcard._method) || 'manual';
    // a meetup place belongs to ITS table, not to whatever the picker currently shows
    scan(code, { method: how, event: key, admit: n, meetup_id: el.dataset.meetup || undefined }).then(out => {
      if (!out) return;
      // door mode: the sheet now shows the green confirmation + NEXT SCAN (scan() already painted it)
      if (isPhone()) return;
      if (out.message) ui.toast(out.message.toUpperCase().slice(0, 80));
      // stay on the ID card — refresh its counts so the operator sees "2 of 3" live
      identify(code, { method: how });
    });
  },
  idClear: () => { st.idcard = null; st.last = null; presentResult(); },
  admitMore: (el) => {
    const code = el.dataset.code; const n = parseInt(el.dataset.n, 10) || 1;
    if (!code) return;
    scan(code, { method: (st.last && st.last._method) || 'manual', admit: n }).then(out => { if (out) { out._code = code; showResult(out); } });
  },
  overrideAdmit: (el) => {
    const code = el.dataset.code;
    const reason = (rootEl.querySelector('[data-role="overrideReason"]') || {}).value || '';
    scan(code, { method: (st.last && st.last._method) || 'manual', override: true, override_reason: reason.trim() || 'door override' }).then(out => { if (out) { out._code = code; showResult(out); } });
  },
  doorIn: (el) => {
    const ref = el.dataset.ref;
    scan(ref, { method: 'manual' }).then(out => { if (out) { out._code = ref; showResult(out); } });
  },
  syncNow: () => flushQueue(),
  mintDoor: async (el) => {
    el.setAttribute('aria-disabled', 'true');
    try {
      const r = await api.post('/api/v2/eventday/door-tokens', { event: st.gate });
      st.qrUrl = r.qr_data_url || null;
      const list = await api.get('/api/v2/eventday/door-tokens'); D.tokens = list.tokens || [];
      paint('[data-block="staff"]', blockStaff());
      ui.toast('DOOR LINK READY — TEXT IT OR SHOW THE QR');
    } catch (e) { el.removeAttribute('aria-disabled'); ui.toast(e.message, { kind: 'error' }); }
  },
  copyDoor: (el) => {
    try { navigator.clipboard.writeText(el.dataset.url).catch(() => {}); } catch (e) {}
    st.copiedDoor = true;
    paint('[data-block="staff"]', blockStaff());
    // the one copy confirmation (ui.copied): ✓ COPIED in place with one gold ring, then it lets go
    ui.copied(rootEl && rootEl.querySelector('[data-act="copyDoor"]'), () => {
      if (!rootEl || !st || !st.copiedDoor) return;
      st.copiedDoor = false;
      const b = rootEl.querySelector('[data-act="copyDoor"]'); if (b) { b.classList.remove('mx-copied'); b.textContent = COPY.staff.copy; }
    }, { say: 'Link copied — send it to the door staff' });
  },
  qrDoor: async (el) => {
    if (st.qrUrl) { st.qrUrl = null; paint('[data-block="staff"]', blockStaff()); return; }
    try { const r = await api.get('/api/v2/eventday/door-tokens/' + encodeURIComponent(el.dataset.id) + '/qr'); st.qrUrl = r.qr_data_url; paint('[data-block="staff"]', blockStaff()); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  revokeDoor: async (el) => {
    const ok = await ui.confirm({ title: 'Revoke the door link?', body: 'It stops working on every phone immediately. You can make a fresh one any time.', ok: 'REVOKE', cancel: 'KEEP' });
    if (!ok) return;
    try {
      await api.post('/api/v2/eventday/door-tokens/' + encodeURIComponent(el.dataset.id) + '/revoke');
      const list = await api.get('/api/v2/eventday/door-tokens'); D.tokens = list.tokens || []; st.qrUrl = null;
      paint('[data-block="staff"]', blockStaff());
      ui.toast(COPY.staff.revoked);
    } catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  notesSave: async () => {
    const v = (rootEl.querySelector('[data-role="notes"]') || {}).value || '';
    try { await api.put('/api/v2/eventday/notes', { event: st.gate, notes: v }); ui.toast(COPY.map.saved); }
    catch (e) { ui.toast(e.message, { kind: 'error' }); }
  },
  // ---- v2 addition (2026-08-31): HOST BRIEF actions
  hbRefresh: () => {
    st.brief = null; st.briefErr = null; st.briefCopied = false;
    paint('[data-block="hostBrief"]', blockHostBrief());
    refreshBrief();
  },
  hbCopy: async () => {
    const b = st.brief;
    if (!b || !b.ok || !b.text) { ui.toast(COPY.brief.notReady); return; }
    let ok = false;
    try { await navigator.clipboard.writeText(b.text); ok = true; } catch (e) {
      // clipboard API blocked (http / permissions) — the hidden-textarea fallback
      try {
        const t = document.createElement('textarea');
        t.value = b.text; t.setAttribute('readonly', '');
        t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        ok = document.execCommand('copy');
        t.remove();
      } catch (e2) { ok = false; }
    }
    st.briefCopied = ok;
    paint('[data-block="hostBrief"]', blockHostBrief());
    if (!ok) { ui.toast(COPY.brief.copyFail, { kind: 'error' }); return; }
    // the one copy confirmation (ui.copied): ✓ COPIED in place with one gold ring, then it lets go
    ui.copied(rootEl && rootEl.querySelector('[data-act="hbCopy"]'), () => { if (st && st.briefCopied) { st.briefCopied = false; if (rootEl) paint('[data-block="hostBrief"]', blockHostBrief()); } }, { say: COPY.brief.copyToast });
  },
  hbPrint: () => {
    const b = st.brief;
    if (!b || !b.ok) { ui.toast(COPY.brief.notReady); return; }
    // Print ONLY the brief: a print twin is appended to <body>, the print-only stylesheet
    // (mx-css-hostbrief-print, injected in render) hides everything else while body carries
    // .mx-hb-print — normal ⌘P without the class prints the page exactly as before.
    const box = document.createElement('div');
    box.className = 'mx-hb-printbox';
    box.innerHTML = briefPrintHtml(b);
    document.body.appendChild(box);
    document.body.classList.add('mx-hb-print');
    let done = false;
    const cleanup = () => {
      if (done) return; done = true;
      try { box.remove(); } catch (e) {}
      document.body.classList.remove('mx-hb-print');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    try { window.print(); } catch (e) {}
    setTimeout(cleanup, 1500);   // Safari fires afterprint unreliably — belt and braces
  }
};

export default {
  title: 'Event Day',
  async render(root, ctx) {
    rootEl = root;
    if (!document.getElementById('mx-css-event-day')) {
      const l = document.createElement('link'); l.id = 'mx-css-event-day'; l.rel = 'stylesheet'; l.href = '/css/views/event-day.css'; document.head.appendChild(l);
    }
    // v2 addition (2026-08-31): print-only stylesheet for the HOST BRIEF — same id-guarded head
    // injection as the css link above, inline because css/views/ is outside this build's owned set.
    // Scoped to body.mx-hb-print (set only by the PRINT button) so a normal ⌘P is untouched.
    if (!document.getElementById('mx-css-hostbrief-print')) {
      const s = document.createElement('style'); s.id = 'mx-css-hostbrief-print';
      s.textContent = [
        '.mx-hb-printbox{display:none}',
        '@media print{',
        '  body.mx-hb-print > *:not(.mx-hb-printbox){display:none !important}',
        '  body.mx-hb-print .mx-hb-printbox{display:block !important;background:#fff;color:#000;margin:0;padding:0}',
        '  body.mx-hb-print{background:#fff !important}',
        '}'
      ].join('\n');
      document.head.appendChild(s);
    }
    let reh = false; try { reh = localStorage.getItem(REH_KEY) === '1'; } catch (e) {}
    let inst = false; try { inst = localStorage.getItem('medx_v2_instant') === '1'; } catch (e) {}
    st = { rehearsal: reh, forced: ctx.query.eventday === '1', gate: null, bridgesEvent: null, meetupId: null, doorQ: '', door: [], doorAll: [], last: null, idcard: null, instant: inst, camOn: false, camWanted: false, qrUrl: null, copiedDoor: false, flushing: false,
           brief: null, briefErr: null, briefCopied: false, /* v2 host brief (2026-08-31) */
           tab: 'scan', listFilter: 'out', more: false, showBrief: false, regs: {}, venue: '' /* door mode (2026-09-21) */ };
    D = await load();
    if (rootEl !== root) return;
    st.gate = GATE_ORDER.includes(ctx.query.door) ? ctx.query.door : (D.over.default_event || 'conference');
    // The meetup door is ALWAYS offered, published meetups or not — hiding it hid the whole
    // feature from anyone who had not already used it. With none published the door opens on its
    // empty state (COPY.meetup.pickNone) instead of vanishing.
    if (st.gate === MEETUP_GATE) {
      const wanted = meetupList().find(m => String(m.id) === String(ctx.query.meetup || ''));
      st.meetupId = wanted ? wanted.id : (meetupList().length === 1 ? meetupList()[0].id : null);
    }
    const bevs = (D.over.bridges_events || []);
    if (bevs.length) {
      const today = fmt.ymd(new Date());
      const up = bevs.filter(e => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      st.bridgesEvent = (up[0] || bevs[0]).id;
    }
    // Default door = the event happening TODAY (local date). A Bridges edition dated today wins over
    // the server's schedule pick (which knows only the Plexus-week gates) unless ?door= says otherwise.
    const todayEv = bridgesToday();
    if (todayEv && !GATE_ORDER.includes(ctx.query.door)) { st.gate = 'bridges'; st.bridgesEvent = todayEv.id; }
    await loadBridgesEdition();
    if (rootEl !== root) return;
    let phoneNow = isPhone();
    document.body.classList.toggle('mx-doormode', phoneNow);
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
    paintQueue();
    if (isLive()) refreshDoor();
    if (isLive() && (!phoneNow || st.showBrief)) refreshBrief();   // v2 host brief (2026-08-31); on a phone it sits behind ⋯
    flushQueue();
    const onOnline = () => flushQueue();
    window.addEventListener('online', onOnline);
    timers.push(() => window.removeEventListener('online', onOnline));
    // a breakpoint crossing (rotation, window resize) swaps the layout — the camera restarts on tap
    let rz = null;
    const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { if (!rootEl || !st) return; const p = isPhone(); if (p === phoneNow) return; phoneNow = p; document.body.classList.toggle('mx-doormode', p); rerenderAll(); refreshDoor(); if (!p && !st.brief) refreshBrief(); }, 150); };
    window.addEventListener('resize', onResize);
    timers.push(() => { clearTimeout(rz); window.removeEventListener('resize', onResize); });
    const t1 = setInterval(() => { if (isLive() && !st.rehearsal) refreshCounts(); }, 30000);
    const t2 = setInterval(flushQueue, 25000);
    timers.push(() => clearInterval(t1), () => clearInterval(t2));
  },
  destroy() {
    stopCam();
    document.body.classList.remove('mx-doormode');
    timers.forEach(f => { try { f(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null;
    rootEl = null; D = null; st = null;
  }
};
