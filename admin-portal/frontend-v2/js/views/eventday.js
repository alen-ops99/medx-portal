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
  sub: 'the live control room — wakes up by itself on December 4',
  toggle: 'REHEARSAL MODE',
  banner: 'REHEARSAL — TEST GUESTS ONLY, NOTHING IS REAL',
  bannerSide: 'On December 4 this banner disappears and the scanner goes live.',
  bannerReset: 'RESET THE REHEARSAL',
  quiet: {
    line: 'Quiet until the big day.',
    why: 'This room activates automatically on December 4 — scanner, live headcount and the venue map all come alive. Flip <b>Rehearsal mode</b> above to practice today with test guests; nothing you do in rehearsal touches real data.',
    try: 'TRY THE REHEARSAL', back: 'BACK TO PLEXUS'
  },
  doors: { label: 'DOOR', names: { conference: 'CONFERENCE', gala: 'GALA', donor: 'DONOR NIGHT', bridges: 'BRIDGES' } },
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
    title: 'VENUE MAP', placeholder: 'Esplanade floor plan — staff positions live here on the day',
    sub: 'Each teammate’s dot updates as they scan; tap a dot to call them.',
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
    not_registered_for_event: 'NOT ON THIS LIST', queued: 'QUEUED OFFLINE', error: 'TRY AGAIN'
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

const GATE_ORDER = ['conference', 'gala', 'donor', 'bridges'];
const REH_KEY = 'medx_v2_rehearsal';
const Q_KEY = () => 'medx_v2_scanq:' + ((session.user || {}).id || 'anon');

let D = null, st = null, rootEl = null, unbind = null, timers = [];
let camStream = null, camVideo = null, camRaf = 0;

// ---------------------------------------------------------------- offline queue
function readQ() { try { return JSON.parse(localStorage.getItem(Q_KEY()) || '[]'); } catch (e) { return []; } }
function writeQ(a) { try { localStorage.setItem(Q_KEY(), JSON.stringify(a)); } catch (e) {} paintQueue(); }
function paintQueue() {
  const el = rootEl && rootEl.querySelector('[data-role="queueBadge"]');
  if (!el) return;
  const n = readQ().length;
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
function isLive() { return !!(D && D.over.is_event_day) || st.rehearsal || st.forced; }

async function refreshCounts() {
  try { const o = await api.get('/api/v2/eventday/overview'); if (D && rootEl) { D.over = o; paint('[data-block="counters"]', blockCounters()); } } catch (e) {}
}
async function refreshDoor() {
  if (!rootEl) return;
  try {
    const p = st.rehearsal ? 'rehearsal=1' : 'event=' + encodeURIComponent(st.gate) + (st.doorQ ? '&q=' + encodeURIComponent(st.doorQ) : '');
    const d = await api.get('/api/v2/eventday/door?' + p);
    st.door = d.rows || [];
    paint('[data-block="doorRows"]', doorRowsHtml());
  } catch (e) { /* keep the last list */ }
}
// v2 addition (2026-08-31): HOST BRIEF — reads /api/v2/host-brief for the selected door.
async function refreshBrief() {
  if (!rootEl || !st) return;
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
    admit: opts.admit || 1, method: opts.method || 'manual',
    override: !!opts.override, override_reason: opts.override_reason || undefined,
    device: 'admin-v2 ' + (navigator.platform || '')
  };
  try {
    const out = await api.post('/api/v2/eventday/scan', body);
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
  paint('[data-role="scanResult"]', resultHtml());
}

// ---------------------------------------------------------------- ID check (identify first, admit on tap)
// Default scan mode (Alen 2026-08-30): a scan RESOLVES the person — full name, what they booked at
// every door, paid state, party progress — and admits nobody. Each door row carries its own ADMIT
// button (→ the normal /scan write). INSTANT ADMIT restores the old one-tap flow for the rush.
async function identify(code, opts = {}) {
  // rehearsal TEST-1…6 are built-in practice guests known only to /scan — ID-check would say
  // NOT FOUND (E2E S13), so practice codes keep the classic admit flow
  if (st.rehearsal && /^TEST-\d+$/i.test(String(code).trim())) return scan(code, opts);
  try {
    const out = await api.post('/api/v2/eventday/lookup', { code, rehearsal: st.rehearsal });
    if (!out.ok) { showResult(Object.assign({ ticket: {} }, out, { _code: code })); return out; }
    st.last = null;
    st.idcard = Object.assign({ _code: code }, out);
    paint('[data-role="scanResult"]', resultHtml());
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
      ? `<span data-act="idAdmit" data-key="${esc(d.event)}" data-code="${esc(c._code)}" style="padding:8px 13px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${COPY.scanner.admitAt(COPY.doors.names[d.event] || d.event.toUpperCase())}</span>`
      : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(32,27,22,.1);width:100%">
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;min-width:96px;text-align:left">${esc(COPY.doors.names[d.event] || d.event.toUpperCase())}</span>
        <span style="flex:1;text-align:left">${state}${!d.ok && d.message ? `<div style="font-size:10.5px;color:#9b1b22;margin-top:2px">${esc(d.message)}</div>` : ''}</span>
        ${btn}
      </div>`;
  };
  return `
    <span data-role="scanResult" data-state="idcard" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;border:1px solid rgba(32,27,22,.14);padding:12px 14px;box-sizing:border-box">
      <span style="display:flex;width:100%;align-items:center"><span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:#6d6459">${COPY.scanner.idTitle}</span><span style="flex:1"></span><span data-act="idClear" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;text-decoration:underline">${COPY.scanner.idClear}</span></span>
      <span style="font-family:Fraunces,serif;font-size:21px;line-height:1.15;text-align:center">${esc(p.name || '')}</span>
      ${p.institution ? `<span style="font-size:11.5px;color:#6d6459">${esc(p.institution)}${p.country ? ' · ' + esc(p.country) : ''}</span>` : (p.country ? `<span style="font-size:11.5px;color:#6d6459">${esc(p.country)}</span>` : '')}
      ${p.email ? `<span style="font-size:11px;color:#6d6459">${esc(p.email)}</span>` : ''}
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
function stopCam() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  if (camVideo) { camVideo.remove(); camVideo = null; }
  cancelAnimationFrame(camRaf);
  st.camOn = false;
  const b = rootEl && rootEl.querySelector('[data-act="cam"]');
  if (b) b.textContent = COPY.scanner.start;
  const hint = rootEl && rootEl.querySelector('[data-role="camHint"]');
  if (hint) hint.style.display = '';
}
async function startCam() {
  const box = rootEl.querySelector('[data-role="camBox"]');
  const hint = rootEl.querySelector('[data-role="camHint"]');
  const okLib = await loadJsQR();
  if (!okLib || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { if (hint) hint.textContent = COPY.scanner.camBusy; return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) { if (hint) hint.textContent = COPY.scanner.camBusy; return; }
  st.camOn = true;
  camVideo = document.createElement('video');
  camVideo.setAttribute('playsinline', '');
  camVideo.muted = true;
  camVideo.srcObject = camStream;
  camVideo.className = 'mx-ed-video';
  camVideo.play();
  box.appendChild(camVideo);
  if (hint) hint.style.display = 'none';
  const b = rootEl.querySelector('[data-act="cam"]'); if (b) b.textContent = COPY.scanner.stop;
  let lastCode = '', lastAt = 0;
  const canvas = document.createElement('canvas');
  const tick = () => {
    if (!camVideo) return;
    camRaf = requestAnimationFrame(tick);
    if (camVideo.readyState !== camVideo.HAVE_ENOUGH_DATA) return;
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
      <span data-act="reh" role="switch" aria-checked="${on}" style="display:flex;align-items:center;gap:9px;padding:9px 14px;border:1px solid rgba(32,27,22,.2);cursor:pointer;background:${on ? '#f8f1e2' : '#fff'}" data-hover="border-color:#201b16">
        <span style="width:30px;height:16px;background:${on ? '#b7791f' : 'rgba(32,27,22,.25)'};position:relative;flex:none"><span style="position:absolute;top:2px;left:${on ? '16px' : '2px'};width:12px;height:12px;background:#fff;transition:left .15s"></span></span>
        <span style="font:600 10px Inter,sans-serif;letter-spacing:.14em;color:${on ? '#7a6432' : '#6d6459'}">${COPY.toggle}</span>
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
      <span data-act="instant" role="switch" aria-checked="${!!st.instant}" title="ON: every scan admits straight at the selected door. OFF: a scan identifies the guest first — admit with a tap." style="display:flex;align-items:center;gap:7px;padding:6px 11px;border:1px solid ${st.instant ? '#9b1b22' : 'rgba(32,27,22,.25)'};background:${st.instant ? '#9b1b22' : 'transparent'};color:${st.instant ? '#fff' : '#6d6459'};font:600 9px Inter,sans-serif;letter-spacing:.12em;cursor:pointer;white-space:nowrap">⚡ ${COPY.scanner.instant}${st.instant ? ' · ON' : ''}</span>
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
function blockCounters() {
  const g = st.rehearsal ? rehearsalTotals() : gateInfo(st.gate);
  const checked = Number(g.admitted) || 0;
  const expected = Number(g.expected) || 0;
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
function resultHtml() {
  if (st.idcard) return idCardHtml();
  const r = st.last;
  if (!r) return `<span data-role="scanResult"></span>`;
  const label = COPY.results[r.result] || String(r.result || '').replace(/_/g, ' ').toUpperCase();
  const bad = ['over_capacity', 'not_paid', 'revoked', 'cancelled', 'not_found', 'wrong_event', 'not_registered_for_event', 'error'].includes(r.result);
  const partial = r.ok && r.remaining > 0;
  const color = r.result === 'over_capacity' ? '#9b1b22' : bad ? '#9b1b22' : partial ? '#7a6432' : '#2f7d4f';
  const counts = r.party_size ? `<span style="font-family:Fraunces,serif;font-size:20px">${COPY.door.of(r.admitted_count, r.party_size)}<span style="font-size:13px;color:#6d6459"> admitted</span></span>` : '';
  const overrideUi = r.result === 'over_capacity' ? `
      <div data-v2="over-capacity override" style="display:flex;flex-direction:column;gap:7px;margin-top:4px;width:100%">
        <input data-role="overrideReason" class="input" placeholder="${esc(COPY.scanner.overrideWhy)}" style="background:#fff">
        <span data-act="overrideAdmit" data-code="${esc(r._code || '')}" style="padding:9px 13px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;text-align:center">${COPY.scanner.overrideBtn}</span>
      </div>` : '';
  const moreUi = partial ? `
      <div style="display:flex;gap:8px;margin-top:4px">
        <span data-act="admitMore" data-code="${esc(r._code || '')}" data-n="1" style="padding:8px 13px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${COPY.scanner.admitMore}</span>
        ${r.remaining > 1 ? `<span data-act="admitMore" data-code="${esc(r._code || '')}" data-n="2" style="padding:8px 13px;border:1px solid rgba(32,27,22,.25);color:#201b16;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer">${COPY.scanner.admitTwo}</span>` : ''}
      </div>` : '';
  return `
    <span data-role="scanResult" data-state="${esc(r.result || '')}" style="display:flex;flex-direction:column;align-items:center;gap:5px;width:100%;border:1px solid ${r.result === 'over_capacity' ? '#9b1b22' : 'rgba(32,27,22,.14)'};${r.result === 'over_capacity' ? 'background:#f8e9ea;' : ''}padding:12px 14px;box-sizing:border-box">
      <span style="font:600 10px Inter,sans-serif;letter-spacing:.13em;color:${color}">${r.ok && !partial ? '✓ ' : ''}${label}</span>
      ${r.ticket && r.ticket.name ? `<span style="font-family:Fraunces,serif;font-size:19px;line-height:1.1;text-align:center">${esc(r.ticket.name)}</span>` : ''}
      ${r.ticket && r.ticket.meta ? `<span style="font-size:11px;color:#6d6459">${esc(r.ticket.meta)}</span>` : ''}
      ${counts}
      <span style="font-size:12px;color:${bad ? '#9b1b22' : '#6d6459'};text-align:center;line-height:1.5">${esc(r.message || '')}</span>
      ${moreUi}${overrideUi}
    </span>`;
}
function blockScanner() {
  return `
    <!-- dc: Admin Event Day.dc.html › "SCANNER" -->
    <div style="border:1px solid rgba(32,27,22,.14);background:#fff;padding:20px;display:flex;flex-direction:column;gap:12px;align-items:center;text-align:center">
      <span style="font:600 11px Inter,sans-serif;letter-spacing:.15em;align-self:flex-start">${COPY.scanner.title}</span>
      <div data-role="camBox" class="mx-ed-cam" style="width:180px;height:180px;background:repeating-linear-gradient(45deg,#f6f2ea,#f6f2ea 8px,#efe9dc 8px,#efe9dc 16px);border:1px solid rgba(32,27,22,.15);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
        <span data-role="camHint" style="font:500 10px ui-monospace,monospace;color:#6d6459;max-width:120px">${COPY.scanner.camIdle}</span>
        <span style="position:absolute;left:14px;right:14px;top:50%;height:2px;background:rgba(155,27,34,.55);z-index:2"></span>
      </div>
      <span style="font-size:12px;color:#6d6459;line-height:1.55;max-width:260px">${COPY.scanner.hint}</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <span data-act="cam" style="padding:10px 16px;background:#201b16;color:#f6f2ea;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer" data-hover="background:#000">${st.camOn ? COPY.scanner.stop : COPY.scanner.start}</span>
        ${st.rehearsal ? `<span data-act="rehSim" style="padding:10px 16px;border:1px solid #c9a962;background:#f8f1e2;color:#7a6432;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer">${COPY.scanner.simulate}</span>` : ''}
      </div>
      <form data-role="manualForm" data-v2="manual code entry — part of the scanner" style="display:flex;gap:8px;width:100%;max-width:280px">
        <input data-role="scanCode" class="input" placeholder="${esc(COPY.scanner.manual)}" autocomplete="off" style="flex:1;min-width:0">
        <button data-act="scanSubmit" type="submit" class="btn-primary" style="border:0">${st.instant ? COPY.scanner.admit : COPY.scanner.check}</button>
      </form>
      ${resultHtml()}
    </div>
    <!-- /dc -->`;
}
function doorRowsHtml() {
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
           <span data-act="doorIn" data-ref="${esc(d.ref)}" style="padding:7px 12px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap">${COPY.door.plusOne}</span>`
        : (d.legacy_in
          ? `<span style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#2f7d4f;white-space:nowrap">${COPY.door.in}</span>`
          : `<span data-act="doorIn" data-ref="${esc(d.ref)}" style="padding:7px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.door.checkIn}${partySize > 1 ? ' · ' + partySize : ''}</span>`);
    return `
          <div data-door-ref="${esc(d.ref)}" class="mx-row" style="display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid rgba(32,27,22,.07)">
            <span class="mx-row-text" style="flex:1;min-width:0"><span style="display:block;font-size:13.5px;font-weight:600">${esc(d.name)}</span><span style="display:block;font-size:11px;color:#6d6459">${esc(d.meta)}${partySize > 1 ? ' · party of ' + partySize : ''}</span></span>
            ${stateHtml}
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
  if (D.errors.tokens && D.errors.tokens.isLocked) return ui.lockedBlock(perms.label(D.errors.tokens.section));
  const alive = (D.tokens || []).filter(t => t.alive && t.event_key === st.gate);
  const t = alive[0];
  if (!t) return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span data-act="mintDoor" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${COPY.staff.make}</span>
        <span style="font-size:11.5px;color:#6d6459">one link per door — this one will open the ${esc((COPY.doors.names[st.gate] || st.gate).toLowerCase())} scanner</span>
      </div>`;
  return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span data-role="doorUrl" style="font:600 12px ui-monospace,monospace;letter-spacing:.02em;background:#f6f2ea;border:1px solid rgba(32,27,22,.15);padding:9px 12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.url)}</span>
        <span data-act="copyDoor" data-url="${esc(t.url)}" style="padding:9px 14px;background:#9b1b22;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="background:#7e151b">${st.copiedDoor ? COPY.staff.copied : COPY.staff.copy}</span>
        <span data-act="qrDoor" data-id="${esc(t.id)}" style="padding:9px 14px;border:1px solid rgba(32,27,22,.2);color:#201b16;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;white-space:nowrap" data-hover="border-color:#201b16">${st.qrUrl ? COPY.staff.hideQr : COPY.staff.qr}</span>
        <span data-act="revokeDoor" data-id="${esc(t.id)}" style="font:600 9.5px Inter,sans-serif;letter-spacing:.12em;color:#6d6459;cursor:pointer;white-space:nowrap" data-hover="color:#9b1b22">${COPY.staff.revoke}</span>
        <span style="font-size:11.5px;color:#6d6459">${esc(COPY.staff.expires(t.expires_at ? fmt.dayLabel(t.expires_at) + ' ' + String(t.expires_at).slice(11, 16) : 'when the event ends'))}</span>
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
      <div style="height:150px;background:repeating-linear-gradient(45deg,#f6f2ea,#f6f2ea 8px,#efe9dc 8px,#efe9dc 16px);border:1px solid rgba(32,27,22,.12);display:flex;align-items:center;justify-content:center"><span style="font:500 10px ui-monospace,monospace;color:#6d6459;text-align:center;padding:0 12px">${COPY.map.placeholder}</span></div>
      <span style="font-size:11.5px;color:#6d6459">${COPY.map.sub}</span>
      <div data-v2="ops notes — shared, saved server-side" style="display:flex;flex-direction:column;gap:6px">
        <span style="font:600 8.5px Inter,sans-serif;letter-spacing:.14em;color:#6d6459">${COPY.map.notes}</span>
        <textarea data-role="notes" rows="3" ${canEdit ? '' : 'readonly'} placeholder="${esc(COPY.map.notesPh)}" style="border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;resize:vertical">${esc(D.notes.notes || '')}</textarea>
        ${canEdit ? `<span data-act="notesSave" style="padding:8px 13px;background:#201b16;color:#f6f2ea;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;align-self:flex-start">${COPY.map.save}</span>` : ''}
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
function template() {
  const live = isLive();
  return `
<div data-screen-label="Admin Event Day" style="min-height:100vh;background:#f6f2ea;color:#201b16;font-family:Inter,sans-serif">
  <div class="mx-gutter" style="max-width:1180px;margin:0 auto;padding:30px 28px 48px;display:flex;flex-direction:column;gap:22px">
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
    ${blockHostBrief()}`}
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
}

const handlers = {
  reh: async () => {
    st.rehearsal = !st.rehearsal;
    try { localStorage.setItem(REH_KEY, st.rehearsal ? '1' : ''); } catch (e) {}
    st.last = null;
    rerenderAll();
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
  gate: async (el) => {
    st.gate = el.dataset.key; st.last = null; st.qrUrl = null; st.copiedDoor = false;
    st.brief = null; st.briefErr = null; st.briefCopied = false;   // v2 host brief follows the door
    rerenderAll();
    refreshDoor();
    refreshBrief();
    try { D.notes = await api.get('/api/v2/eventday/notes?event=' + encodeURIComponent(st.gate)); const n = rootEl.querySelector('[data-role="notes"]'); if (n) n.value = D.notes.notes || ''; } catch (e) {}
  },
  cam: () => { if (st.camOn) stopCam(); else startCam(); },
  rehSim: () => {
    // practice: admit the next test guest that still has room (TEST-5 demos the crimson unpaid state last)
    const rows = (st.door || []).filter(r => /^TEST-/.test(r.ref));
    const next = rows.find(r => r.admitted_count < r.party_size && r.ref !== 'TEST-5') || rows.find(r => r.admitted_count < r.party_size);
    if (!next) { ui.toast('EVERY TEST GUEST IS IN — RESET THE REHEARSAL TO GO AGAIN'); return; }
    // practice at the test guest's own door WITHOUT moving the room's door picker
    scan(next.ref, { method: 'manual', event: (next.event && GATE_ORDER.includes(next.event)) ? next.event : st.gate });
  },
  scanSubmit: () => {
    const i = rootEl.querySelector('[data-role="scanCode"]');
    const v = i ? i.value.trim() : '';
    if (!v) { ui.toast('SCAN OR TYPE A CODE FIRST'); return; }
    if (st.instant) scan(v, { method: 'manual' }).then(out => { if (out) { out._code = v; showResult(out); } });
    else identify(v, { method: 'manual' });
    if (i) i.value = '';
  },
  instant: () => {
    st.instant = !st.instant;
    try { localStorage.setItem('medx_v2_instant', st.instant ? '1' : ''); } catch (e) {}
    paint('[data-block="gateChips"]', gateChips());
    const btn = rootEl.querySelector('[data-act="scanSubmit"]');
    if (btn) btn.textContent = st.instant ? COPY.scanner.admit : COPY.scanner.check;
  },
  idAdmit: (el) => {
    const code = el.dataset.code, key = el.dataset.key;
    if (!code || !key) return;
    scan(code, { method: 'manual', event: key }).then(out => {
      if (out && out.message) ui.toast(out.message.toUpperCase().slice(0, 80));
      // stay on the ID card — refresh its counts so the operator sees "2 of 3" live
      identify(code, { method: 'manual' });
    });
  },
  idClear: () => { st.idcard = null; st.last = null; paint('[data-role="scanResult"]', resultHtml()); },
  admitMore: (el) => {
    const code = el.dataset.code; const n = parseInt(el.dataset.n, 10) || 1;
    if (!code) return;
    scan(code, { method: 'manual', admit: n }).then(out => { if (out) { out._code = code; showResult(out); } });
  },
  overrideAdmit: (el) => {
    const code = el.dataset.code;
    const reason = (rootEl.querySelector('[data-role="overrideReason"]') || {}).value || '';
    scan(code, { method: 'manual', override: true, override_reason: reason.trim() || 'door override' }).then(out => { if (out) { out._code = code; showResult(out); } });
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
    ui.toast('LINK COPIED — SEND IT TO THE DOOR STAFF');
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
    ui.toast(ok ? COPY.brief.copyToast : COPY.brief.copyFail, ok ? {} : { kind: 'error' });
    if (ok) setTimeout(() => { if (st && st.briefCopied) { st.briefCopied = false; if (rootEl) paint('[data-block="hostBrief"]', blockHostBrief()); } }, 2600);
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
    st = { rehearsal: reh, forced: ctx.query.eventday === '1', gate: null, doorQ: '', door: [], last: null, idcard: null, instant: inst, camOn: false, qrUrl: null, copiedDoor: false, flushing: false,
           brief: null, briefErr: null, briefCopied: false /* v2 host brief (2026-08-31) */ };
    D = await load();
    if (rootEl !== root) return;
    st.gate = GATE_ORDER.includes(ctx.query.door) ? ctx.query.door : (D.over.default_event || 'conference');
    root.innerHTML = template();
    unbind = ui.bind(root, handlers);
    wireInputs();
    paintQueue();
    if (isLive()) refreshDoor();
    if (isLive()) refreshBrief();   // v2 host brief (2026-08-31)
    flushQueue();
    const onOnline = () => flushQueue();
    window.addEventListener('online', onOnline);
    timers.push(() => window.removeEventListener('online', onOnline));
    const t1 = setInterval(() => { if (isLive() && !st.rehearsal) refreshCounts(); }, 30000);
    const t2 = setInterval(flushQueue, 25000);
    timers.push(() => clearInterval(t1), () => clearInterval(t2));
  },
  destroy() {
    stopCam();
    timers.forEach(f => { try { f(); } catch (e) {} }); timers = [];
    if (unbind) unbind(); unbind = null;
    rootEl = null; D = null; st = null;
  }
};
