// js/ui.js — shared UI helpers: toast, modal/confirm, countdown ticker, .ics download,
// formatters (dates, € with the design's rules), template escaping, event binding,
// hover-style + keyboard delegates for the artboards' `style-hover` / `onClick` spans.
//
//   import { ui, esc, fmt } from './ui.js';
//   ui.toast('Link sent — check your inbox.');            // never empty text
//   ui.toast('Invalid code', { kind: 'error' });
//   const ok = await ui.confirm({ title: 'Cancel seat?', body: '…', ok: 'CANCEL SEAT', cancel: 'KEEP IT' });
//   const stop = ui.countdown('2026-12-04T09:00:00+01:00', ({ days, hrs, min }) => …, 30000);
//   ui.downloadIcs('medx-key-dates.ics', [{ uid:'plexus2026', start:'20261204', end:'20261206', summary:'Plexus 2026', location:'Novinarski dom, Zagreb' }]);
//   ui.bind(root, { tg: () => …, cl: (el, ev) => … });   // <span data-act="tg">
//   fmt.eur(150) → '€150' · fmt.shortDate('2026-07-02') → 'JUL 2' · fmt.todayLabel() → 'FRIDAY, 28 AUGUST 2026 · ZAGREB'
//   ui.tick(el, '05');                                   // countdown digit: set it, and fade it up only if it changed
//   ui.toggleSwitch(el, async on => api.post(…), on => label.textContent = …);  // a .mx-switch flips at once, reverts if the save fails
//   ui.revealOnScroll(root);                              // sections below the fold rise in on scroll (router, views with reveal: true)
//   const release = ui.trapFocus(sheetEl);                // Tab / Shift+Tab stay inside a dialog until release()
//   ui.hideToast();                                       // take a toast down early (a screen that owned it is leaving)

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Med&X in copy: keep the ampersand readable in templates → esc() then this for brand strings
export const AMP = 'Med&amp;X';

// A person without a photo: gold Fraunces initials on the ink ground (css/app.css .mx-mono), filling
// its positioned parent. Replaces the artboard's striped "PORTRAIT · X. NAME" wireframe placeholder.
export function initials(name) {
  return String(name || '').replace(/\b(dr|prof|mr|mrs|ms|sir|lord|dame)\.?\s+/gi, '').split(/\s+/).filter(Boolean)
    .map(w => w[0]).join('').replace(/[^A-Za-zŠĐČĆŽšđčćžÀ-ÿ]/g, '').toUpperCase().slice(0, 2) || 'M';
}
export function monogram(name, size = 40) {
  return `<span class="mx-mono" aria-hidden="true" style="font-size:${Number(size) || 40}px">${esc(initials(name))}</span>`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function toDate(v) {
  if (v instanceof Date) return v;
  if (v == null || v === '') return null;
  const s = String(v).trim();
  // 'YYYY-MM-DD' → local midnight (avoid the UTC shift of Date.parse on date-only strings)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

export const fmt = {
  // "€150" — the € sign, never "EUR"; no decimals unless the amount has them
  eur(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '';
    const v = Number(n);
    const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
    return '€' + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },
  num(n) { if (n == null || isNaN(Number(n))) return '—'; return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); },
  // en dash between digits ("4-5" → "4–5"), "EUR 150" → "€150", " - " → " · " (server strings arrive plain)
  dash: s => String(s == null ? '' : s).replace(/(\d)\s?-\s?(\d)/g, '$1–$2'),
  detail(s) {
    return fmt.dash(String(s == null ? '' : s))
      .replace(/\bEUR\s?(\d[\d.,]*)/g, '€$1').replace(/(\d[\d.,]*)\s?EUR\b/g, '€$1')
      .replace(/\s+-\s+/g, ' · ').replace(/\s+·\s+/g, ' · ');
  },
  // 'EUR 150' → '€150' only (titles keep their own punctuation)
  euro: s => String(s == null ? '' : s).replace(/\bEUR\s?(\d[\d.,]*)/g, '€$1').replace(/(\d[\d.,]*)\s?EUR\b/g, '€$1'),
  upper: s => String(s == null ? '' : s).toUpperCase(),
  // 'JUL 2' for news rows
  shortDate(v) { const d = toDate(v); return d ? MON3[d.getMonth()] + ' ' + d.getDate() : ''; },
  // 'December 4–5, 2026' / 'December 4, 2026'
  longRange(start, end) {
    const a = toDate(start), b = toDate(end);
    if (!a) return '';
    if (!b || a.getTime() === b.getTime()) return MONTHS[a.getMonth()] + ' ' + a.getDate() + ', ' + a.getFullYear();
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return MONTHS[a.getMonth()] + ' ' + a.getDate() + '–' + b.getDate() + ', ' + a.getFullYear();
    return MONTHS[a.getMonth()] + ' ' + a.getDate() + ' – ' + MONTHS[b.getMonth()] + ' ' + b.getDate() + ', ' + b.getFullYear();
  },
  // 'FRIDAY, 28 AUGUST 2026 · ZAGREB' (Portal Chrome todayLabel, verbatim)
  todayLabel(now = new Date(), city = 'ZAGREB') { return DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()].toUpperCase() + ' ' + now.getFullYear() + ' · ' + city; },
  // Key-dates right label: 'Until September 30, 2026' → 'UNTIL SEP 30'; 'December 4-5, 2026' → 'DEC 4–5'
  keyDateLabel(text) {
    let s = String(text || '').trim();
    s = s.replace(/,?\s*\d{4}\b/g, '');
    MONTHS.forEach((m, i) => { s = s.replace(new RegExp('\\b' + m + '\\b', 'gi'), MON3[i]); });
    return fmt.dash(s).replace(/\s+/g, ' ').trim().toUpperCase();
  },
  // Parse free-text admin dates into a Date (first day of a range). Returns null when unparseable.
  parseLooseDate(text, fallbackYear) {
    const s = String(text || '');
    const year = (s.match(/\b(20\d{2})\b/) || [])[1] || fallbackYear || new Date().getFullYear();
    const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
    for (let i = 0; i < MONTHS.length; i++) {
      const re = new RegExp('\\b' + MONTHS[i] + '\\.?\\s+(\\d{1,2})', 'i');
      const m = s.match(re) || s.match(new RegExp('\\b' + MON3[i] + '\\.?\\s+(\\d{1,2})', 'i'));
      if (m) return new Date(+year, i, +m[1]);
      const m2 = s.match(new RegExp('\\b(\\d{1,2})\\.?\\s+' + MONTHS[i] + '\\b', 'i'));
      if (m2) return new Date(+year, i, +m2[1]);
    }
    return null;
  },
  ymd(d) { const x = toDate(d); if (!x) return ''; return x.getFullYear() + String(x.getMonth() + 1).padStart(2, '0') + String(x.getDate()).padStart(2, '0'); },
  initials(first, last) { return (((first || '').trim()[0] || '') + ((last || '').trim()[0] || '')).toUpperCase(); },
  // one way to write a title before a name on every screen: 'Dr Kevin Smith' (Program) and 'Dr. Kevin Smith'
  // (the Gala) → 'Dr. Kevin Smith'; 'Prof' likewise. Lower-case Croatian titles (prim. dr.) are left alone.
  person: s => String(s == null ? '' : s).replace(/\b(Dr|Prof)\.?(?=\s)/g, '$1.'),
  toDate
};

// ---------------------------------------------------------------- toast
let toastEl = null, toastTimer = null;
function toast(text, opts = {}) {
  const msg = String(text || '').trim() || (opts.kind === 'error' ? 'Something went wrong — please try again.' : 'Done.');
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mx-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
  // a toast already showing takes the new message in place: the words cross-fade instead of jumping
  const swap = toastEl.classList.contains('show') && toastEl.textContent !== msg && !reducedMotion() && typeof toastEl.animate === 'function';
  toastEl.textContent = msg;
  if (swap) { try { toastEl.animate([{ color: 'rgba(247,241,230,0)' }, { color: '#f7f1e6' }], { duration: 260, easing: EASE }); } catch (e) {} }
  toastEl.classList.toggle('error', opts.kind === 'error');
  clearTimeout(toastTimer);
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), opts.ms || (opts.kind === 'error' ? 4200 : 2800));
}
function hideToast() { clearTimeout(toastTimer); if (toastEl) toastEl.classList.remove('show'); }

// ---------------------------------------------------------------- focus trap
// A dialog keeps keyboard focus inside itself (aria-modal alone does not): Tab past the last control comes
// back to the first, Shift+Tab before the first goes to the last, and a Tab pressed while focus sits outside
// (on <body> after a click on the scrim) lands inside. The newest trap wins — a confirm opened over a sheet.
// `box` is the element, or a function returning it (a sheet that re-draws itself). Returns release().
const traps = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex], [data-act], [data-nav]';
function focusables(box) {
  return [...box.querySelectorAll(FOCUSABLE)].filter(el => el.getAttribute('tabindex') !== '-1' && !el.closest('[inert], [aria-hidden="true"]') &&
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}
function onTrapKey(e) {
  if (e.key !== 'Tab' || !traps.length) return;
  const t = traps[traps.length - 1];
  const box = typeof t.box === 'function' ? t.box() : t.box;
  if (!box || !box.isConnected) return;
  const list = focusables(box);
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0], last = list[list.length - 1], a = document.activeElement;
  // the dialog box itself holds focus on open (ui.modal): Tab from it goes in, Shift+Tab wraps to the last control
  if (!box.contains(a) || a === box || (e.shiftKey && a === first) || (!e.shiftKey && a === last)) {
    e.preventDefault();
    try { (e.shiftKey ? last : first).focus(); } catch (err) { /* fine */ }
  }
}
function trapFocus(box) {
  if (!traps.length) document.addEventListener('keydown', onTrapKey, true);
  const t = { box }; traps.push(t);
  return () => {
    const i = traps.indexOf(t); if (i < 0) return;
    traps.splice(i, 1);
    if (!traps.length) document.removeEventListener('keydown', onTrapKey, true);
  };
}
// Focus goes back to the control that opened a dialog — only when it would otherwise be lost (on <body>, or
// still inside the dialog that is leaving); a dialog opened from this one keeps its own focus.
function returnFocus(to, leaving) {
  const a = document.activeElement;
  if (!to || !to.isConnected || typeof to.focus !== 'function') return;
  if (a && a !== document.body && !(leaving && leaving.contains(a))) return;
  try { to.focus({ preventScroll: true }); } catch (e) { /* fine */ }
}

// ---------------------------------------------------------------- modal / confirm
let modalSeq = 0;
// the sheets on screen now: a screen change closes them (closeModals, called by the router as a screen is left),
// each on its own exit, so a sheet never floats over the next screen (a link inside it, a deep link, a push tap)
const openModals = new Set();
function closeModals() { [...openModals].forEach(fn => { try { fn(); } catch (e) { /* fine */ } }); }
function modal({ eyebrow = 'MED&X', title = '', body = '', actions = [], closeOnScrim = true, wide = false } = {}) {
  const wrap = document.createElement('div');
  const opener = document.activeElement;
  wrap.className = 'mx-modal';
  // a sheet opened as another one leaves (REPORT from a profile, a confirm after a menu): the scrim is already
  // there, so it stays at full strength instead of dipping and fading in again; only the new sheet rises
  if (document.querySelector('body > .mx-modal.is-leaving')) wrap.classList.add('is-chained');
  const lid = 'mx-modal-l' + (++modalSeq);
  wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-labelledby', lid);
  wrap.innerHTML = `
    <div class="mx-modal-sheet${wide ? ' is-wide' : ''}" tabindex="-1">
      <div class="mx-modal-head"><span${title ? '' : ` id="${lid}"`}>${esc(eyebrow)}</span><div style="flex:1"></div><span data-act="close" role="button" tabindex="0" aria-label="Close" style="color:#4a4239;cursor:pointer;font:400 18px Inter,sans-serif;letter-spacing:0">×</span></div>
      <div class="mx-modal-body">${title ? `<div class="mx-modal-title" id="${lid}">${title}</div>` : ''}${body}</div>
      ${actions.length ? `<div class="mx-modal-foot">${actions.map((a, i) => `<span data-act="a${i}" role="button" tabindex="0" class="${a.kind === 'primary' ? 'btn-primary' : a.kind === 'gold' ? 'btn-gold' : 'btn-ghost'}">${esc(a.label)}</span>`).join('')}</div>` : ''}
    </div>`;
  // the sheet fades out (160 ms, css .mx-modal.is-leaving) — callers already resolved; nothing waits on it
  let release = null;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    openModals.delete(dismiss);
    if (!wrap.isConnected || wrap.classList.contains('is-leaving')) return;
    if (release) { release(); release = null; }
    returnFocus(opener, wrap);
    if (reducedMotion()) { wrap.remove(); return; }
    wrap.classList.add('is-leaving');
    setTimeout(() => wrap.remove(), 250);   // the sheet's exit (--t-exit + its sink) and a frame
  };
  const onKey = e => { if (e.key === 'Escape') { close(); if (typeof opts_onclose === 'function') opts_onclose(); } };
  let opts_onclose = null;
  const handlers = { close: () => { close(); if (opts_onclose) opts_onclose(); } };
  const dismiss = () => handlers.close();
  openModals.add(dismiss);
  actions.forEach((a, i) => { handlers['a' + i] = () => { const r = a.onClick ? a.onClick() : undefined; if (r !== false) close(); }; });
  bind(wrap, handlers);
  wrap.addEventListener('click', e => { if (closeOnScrim && e.target === wrap) handlers.close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const sheet = wrap.querySelector('.mx-modal-sheet');
  release = trapFocus(sheet);
  // focus lands on the sheet itself, read from its top (eyebrow, title, ×): focusing the first footer action
  // scrolled a tall sheet to its foot on a short phone, with the × out of view. The first Tab goes to the ×.
  try { sheet.focus({ preventScroll: true }); } catch (e) { /* fine */ }
  sheet.scrollTop = 0; wrap.scrollTop = 0;
  return { close, onClose(fn) { opts_onclose = fn; return this; }, el: wrap };
}
// A photo viewer on the modal: one photo at a time at full size, ← / → (buttons and arrow keys), Esc closes.
// photos = [{ src, alt?, caption? }]; `start` = the index the member clicked.
function lightbox(photos, { start = 0, eyebrow = 'PHOTOS', title = '', note = '' } = {}) {
  const list = (photos || []).filter(p => p && p.src);
  if (!list.length) return null;
  let i = Math.max(0, Math.min(list.length - 1, Number(start) || 0));
  const m = modal({ eyebrow, title, wide: true, body: `<div data-role="lb"></div>${note ? `<p style="margin:12px 0 0;font-size:12px;color:#4a4239">${note}</p>` : ''}` });
  const box = m.el.querySelector('[data-role="lb"]');
  const ctl = 'font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#9b1b22;cursor:pointer;white-space:nowrap;padding:12px 0';
  const paint = () => {
    const p = list[i];
    box.innerHTML = `<figure style="margin:0;background:#191512"><img src="${esc(p.src)}" alt="${esc(p.alt || '')}" style="display:block;width:100%;height:min(62vh,560px);object-fit:contain"></figure>
      ${p.caption ? `<div style="font-size:11.5px;color:#4a4239;margin-top:6px">${esc(p.caption)}</div>` : ''}
      ${list.length > 1 ? `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
        <span data-act="lbPrev" role="button" tabindex="0" aria-label="Previous photo" style="${ctl}">← PREV</span>
        <span style="font:600 9.5px Inter,sans-serif;letter-spacing:.14em;color:#4a4239;font-variant-numeric:tabular-nums">${i + 1} / ${list.length}</span>
        <span data-act="lbNext" role="button" tabindex="0" aria-label="Next photo" style="${ctl}">NEXT →</span></div>` : ''}`;
  };
  const go = d => { i = (i + d + list.length) % list.length; paint(); };
  const onKey = e => {
    if (!m.el.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };
  document.addEventListener('keydown', onKey);
  bind(m.el, { lbPrev: () => go(-1), lbNext: () => go(1) });
  m.onClose(() => document.removeEventListener('keydown', onKey));
  paint();
  return m;
}
function confirm({ eyebrow = 'PLEASE CONFIRM', title = 'Are you sure?', body = '', ok = 'CONFIRM', cancel = 'CANCEL', danger = false } = {}) {
  return new Promise(resolve => {
    const m = modal({ eyebrow, title, body, actions: [
      { label: cancel, onClick: () => resolve(false) },
      { label: ok, kind: danger ? 'primary' : 'primary', onClick: () => resolve(true) }
    ] });
    m.onClose(() => resolve(false));
  });
}

// ---------------------------------------------------------------- countdown
function countdown(target, cb, everyMs = 1000) {
  const t = toDate(target);
  const tick = () => {
    const ms = Math.max(0, (t ? t.getTime() : 0) - Date.now());
    const pad = n => String(n).padStart(2, '0');
    cb({ ms, days: String(Math.floor(ms / 86400000)), hrs: pad(Math.floor(ms / 3600000) % 24), min: pad(Math.floor(ms / 60000) % 60), sec: pad(Math.floor(ms / 1000) % 60), done: ms === 0 });
  };
  tick();
  const id = setInterval(tick, everyMs);
  return () => clearInterval(id);
}

// ---------------------------------------------------------------- motion helpers
// One motion language (css/tokens.css › --ease, --t-*). Every helper is a no-op for reduced motion.
const EASE = 'cubic-bezier(.22,1,.36,1)';
function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}
// A countdown digit: write the value, and when it actually changed let the new number fade up into place.
function tick(el, value) {
  if (!el) return;
  const v = String(value);
  if (el.textContent === v) return;
  el.textContent = v;
  if (reducedMotion() || typeof el.animate !== 'function') return;
  try { el.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE }); } catch (e) {}   // --t-reveal
}
// A follow switch (.mx-switch, role=switch — css app.css): its state IS aria-checked, so it flips in
// place the moment it is pressed and the track and knob ease across together; `save(on)` runs behind it
// and a failed save flips it back with the error as a toast. `paint(on)` updates whatever else shows the
// state (the ON / OFF label). A second press while a save is running is ignored. Resolves to the new
// state, or null when nothing changed.
async function toggleSwitch(el, save, paint) {
  if (!el || el.getAttribute('aria-busy') === 'true') return null;
  const on = el.getAttribute('aria-checked') !== 'true';
  const set = v => { el.setAttribute('aria-checked', String(v)); if (paint) { try { paint(v); } catch (e) {} } };
  set(on); el.setAttribute('aria-busy', 'true');
  try { await save(on); return on; }
  catch (e) { set(!on); toast(e && e.message, { kind: 'error' }); return null; }
  finally { el.removeAttribute('aria-busy'); }
}
// Sections below the first screen rise in as they scroll into view (css app.css › .mx-rv). The router
// calls this after a view that opts in (`reveal: true` on the view module) has drawn and scrolled. Only
// blocks that START below the visible window at that moment are marked, so nothing already on screen
// ever disappears; the mark is added by script, so without it nothing is hidden; print shows it all.
// Blocks = the children of the screen wrapper ([data-screen-label]) and of its gutter containers.
let revealObs = null;
function revealOnScroll(root) {
  if (revealObs) { revealObs.disconnect(); revealObs = null; }
  if (!root || reducedMotion() || typeof IntersectionObserver !== 'function') return;
  const screen = root.querySelector('[data-screen-label]');
  if (!screen) return;
  const vh = window.innerHeight || document.documentElement.clientHeight || 800;
  const blocks = [];
  for (const el of screen.children) {
    if (el.classList.contains('mx-gutter') && el.childElementCount > 1 && !el.matches('.mx-crumbs, [data-tabs]')) blocks.push(...el.children);
    else blocks.push(el);
  }
  const hide = blocks.filter(el => {
    if (el.matches('style, script, link, template, .mx-crumbs, [data-tabs], [data-role="bio-scrim"]') || (!el.firstElementChild && !el.textContent.trim())) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top > vh - 24;
  });
  if (!hide.length) return;
  hide.forEach(el => el.classList.add('mx-rv'));
  const obs = revealObs = new IntersectionObserver(entries => {
    let i = 0;
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target; obs.unobserve(el);
      // blocks arriving together follow each other in. The delay rides a class (.mx-rv-d1…3), never the
      // block's own style: writing a custom property re-serialised the artboard's inline style
      // ('background:#191512' → 'background: rgb(25, 21, 18)'), and the ink bands lost their gold focus ring
      const d = Math.min(i++, 3), dc = d ? 'mx-rv-d' + d : null;
      el.classList.add('mx-rv-in'); if (dc) el.classList.add(dc); el.classList.remove('mx-rv');
      setTimeout(() => { el.classList.remove('mx-rv-in'); if (dc) el.classList.remove(dc); }, 700);
    }
  }, { threshold: 0 });   // the first visible pixel: a block at the very foot of the page must still arrive
  hide.forEach(el => obs.observe(el));
}
// Legacy: a switch that was re-drawn in its new state slides its knob over from the old side
// (css app.css › [role=switch].mx-sw-flip). Kept for any caller outside the member-core views.
function flipSwitch(el) {
  if (!el || reducedMotion()) return;
  el.classList.remove('mx-sw-flip'); void el.offsetWidth; el.classList.add('mx-sw-flip');
}

// ---------------------------------------------------------------- .ics
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function buildIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MedX//Portal v2//EN', 'CALSCALE:GREGORIAN'];
  events.forEach(ev => {
    // a timed event ({ startAt, endAt } — ISO with an offset, e.g. a session's starts_at) is written in UTC;
    // everything else stays an all-day event
    const utc = v => { const d = new Date(v); return isNaN(d) ? '' : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
    if (ev.startAt && utc(ev.startAt)) {
      lines.push('BEGIN:VEVENT', 'UID:' + (ev.uid || utc(ev.startAt) + '-' + Math.random().toString(36).slice(2, 8)) + '@medx.hr', 'DTSTAMP:' + stamp,
        'DTSTART:' + utc(ev.startAt), 'DTEND:' + (utc(ev.endAt) || utc(ev.startAt)), 'SUMMARY:' + icsEscape(ev.summary || 'Med&X'));
    } else {
    const start = typeof ev.start === 'string' && /^\d{8}$/.test(ev.start) ? ev.start : fmt.ymd(ev.start);
    let end = typeof ev.end === 'string' && /^\d{8}$/.test(ev.end) ? ev.end : (ev.end ? fmt.ymd(ev.end) : '');
    if (!start) return;
    if (!end) { const d = toDate(start.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')); d.setDate(d.getDate() + 1); end = fmt.ymd(d); }
    lines.push('BEGIN:VEVENT', 'UID:' + (ev.uid || start + '-' + Math.random().toString(36).slice(2, 8)) + '@medx.hr', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + start, 'DTEND;VALUE=DATE:' + end, 'SUMMARY:' + icsEscape(ev.summary || 'Med&X'));
    }
    if (ev.location) lines.push('LOCATION:' + icsEscape(ev.location));
    if (ev.description) lines.push('DESCRIPTION:' + icsEscape(ev.description));
    if (ev.url) lines.push('URL:' + ev.url);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function downloadIcs(filename, events) {
  const ics = buildIcs(events);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename || 'medx.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return ics;
}

// ---------------------------------------------------------------- binding helpers
// <span data-act="name"> → handlers.name(el, event). Delegated once per root; survives re-renders of children.
function bind(root, handlers) {
  const onClick = e => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.getAttribute('aria-disabled') === 'true') return;
    const h = handlers[el.dataset.act];
    if (!h) return;
    // A real link INSIDE an actionable row (the signup consent row's "Terms and Privacy Policy") is the
    // user's target — let it open natively instead of running the row's handler (it used to just tick the box).
    const link = e.target.closest('a[href]');
    if (link && link !== el && el.contains(link)) return;
    // Never cancel a native control's OWN activation behaviour. On a file input preventDefault
    // closed the OS file picker; on a checkbox/radio it runs the "canceled activation steps",
    // which restore the pre-click checkedness AFTER dispatch — so the box silently un-ticks
    // itself again however hard the handler set el.checked. Mirrors the admin bind().
    const nativeType = e.target && e.target.type;
    if (nativeType !== 'file' && nativeType !== 'checkbox' && nativeType !== 'radio') e.preventDefault();
    h(el, e);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
// data-hover="border-color:#191512;color:#191512" ← the artboards' style-hover attribute, verbatim
function installDelegates() {
  if (installDelegates.done) return; installDelegates.done = true;
  const saved = new WeakMap();
  // Hover styles only for a real pointer: on touch, a tap fires mouseover and the hover colour used to
  // stay stuck on the tapped control until the next tap somewhere else.
  const canHover = (() => { try { return window.matchMedia('(hover: hover)'); } catch (e) { return { matches: true }; } })();
  document.addEventListener('mouseover', e => {
    if (!canHover.matches) return;
    const el = e.target.closest && e.target.closest('[data-hover]');
    if (!el || saved.has(el) || el.getAttribute('aria-disabled') === 'true') return;   // a disabled control (SEND while sending) takes no hover
    const decls = el.getAttribute('data-hover').split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; });
    saved.set(el, decls.map(([p]) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]));
    decls.forEach(([p, v]) => el.style.setProperty(p, v));
    const leave = () => { const prev = saved.get(el); if (prev) prev.forEach(([p, v, pr]) => el.style.setProperty(p, v, pr)); saved.delete(el); el.removeEventListener('mouseleave', leave); };
    el.addEventListener('mouseleave', leave);
  });
  // keyboard: Enter/Space on data-act / data-nav spans behave like buttons
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target;
    if (!el || !(el.matches && (el.matches('[data-act]') || el.matches('[data-nav]')))) return;
    if (el.matches('a, button, input, textarea, select')) return;
    e.preventDefault(); el.click();
  });
  // iOS only applies :active (the press feedback in app.css) when a touchstart listener exists
  document.addEventListener('touchstart', () => {}, { passive: true });
  installPress();
  // make every actionable span reachable by keyboard without touching the copied markup; and, on
  // whatever was just added, dress the trailing arrows and let still-loading images fade in
  const observer = new MutationObserver(records => {
    document.querySelectorAll('[data-act]:not([tabindex]):not(a):not(button):not(input), [data-nav]:not([tabindex]):not(a):not(button)').forEach(el => { el.setAttribute('tabindex', '0'); if (!el.getAttribute('role')) el.setAttribute('role', 'button'); });
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType === 3) { if (n.parentNode) dressArrows(n.parentNode); }
      else if (n.nodeType === 1) { dressArrows(n); fadeImages(n); }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  dressArrows(document.body); fadeImages(document.body);
}
// ---------------------------------------------------------------- touch press
// A finger on anything tappable answers at once: the control dims (a small control more than a row or a card) and
// eases back as the finger lifts, the way a native control highlights. The dim waits 45 ms, so a list scrolled
// under the finger never flickers (the browser cancels the pointer as soon as it scrolls); a tap quicker than that
// still shows a short blink. Web Animations only (never the element's own style or transition list, which the
// artboards' hover and colour transitions own); mouse and pen never; reduced motion keeps the dim, without easing.
// Controls that already answer the press in css (cards, the tab bar, the phone bar, the event app's rows and
// links) keep their own look.
const PRESSABLE = 'a[href], button, [data-act], [data-nav], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="radio"], summary, .mx-pop-row';
const PRESS_OWN = '#mx-scrim, .mx-search, .mx-modal, .lv-scrim, [data-role="bio-scrim"], #mx-tabbar a, #mx-mobile-top a, #mx-mobile-top [data-act], ' +
  '.mx-card-link, .mx-proj-card, .lv-card-body, .lv-person, .lv-now-item, .lv-slot, .lv-mini, .lv-tab, .lv-x, .lv-sback, .lv-ics, .lv-links a, ' +
  '.lv-glance-map, .lv-refresh, .lv-back, .lv-info-body a, .lv-glance-list a, input, textarea, select, [contenteditable]';
function installPress() {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return;
  let cur = null;              // { el, id, x, y, timer, anim, base, to }
  const pick = e => {
    const el = e.target && e.target.closest ? e.target.closest(PRESSABLE) : null;
    if (!el || el.matches(PRESS_OWN) || el.closest('[inert], .mx-leaving') || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-busy') === 'true') return null;
    const r = el.getBoundingClientRect();
    if (!r.width || r.width * r.height > window.innerWidth * window.innerHeight * 0.4) return null;   // a whole-screen hit area is not a button
    return { el, r };
  };
  const on = c => {
    if (!c || c.anim || !c.el.isConnected) return;
    const base = parseFloat(getComputedStyle(c.el).opacity) || 1;
    c.base = base; c.to = base * (c.r.height <= 64 && c.r.width <= 360 ? 0.5 : 0.72);
    try { c.anim = c.el.animate([{ opacity: base }, { opacity: c.to }], { duration: reducedMotion() ? 0 : 70, easing: 'ease-out', fill: 'forwards' }); } catch (e) {}
  };
  const off = (c, blink) => {
    if (!c) return;
    clearTimeout(c.timer);
    if (blink && !c.anim) on(c);
    if (!c.anim) return;
    const a = c.anim; c.anim = null;
    // a quick tap holds the dim one beat before easing back, so the answer is seen
    try { c.el.animate([{ opacity: c.to }, { opacity: c.base }], { duration: reducedMotion() ? 0 : 260, delay: blink && !reducedMotion() ? 60 : 0, easing: EASE, fill: 'backwards' }); } catch (e) {}
    a.cancel();
  };
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    off(cur); cur = null;
    const hit = pick(e); if (!hit) return;
    const c = cur = { el: hit.el, r: hit.r, id: e.pointerId, x: e.clientX, y: e.clientY, anim: null };
    c.timer = setTimeout(() => on(c), 45);
  }, { passive: true, capture: true });
  document.addEventListener('pointermove', e => {
    if (!cur || e.pointerId !== cur.id) return;
    if (Math.abs(e.clientX - cur.x) > 10 || Math.abs(e.clientY - cur.y) > 10) { off(cur); cur = null; }
  }, { passive: true, capture: true });
  document.addEventListener('pointerup', e => { if (cur && e.pointerId === cur.id) { off(cur, true); cur = null; } }, { passive: true, capture: true });
  document.addEventListener('pointercancel', e => { if (cur && e.pointerId === cur.id) { off(cur); cur = null; } }, { passive: true, capture: true });
}

// A control whose label ends in → (or ↗) gets that arrow in its own span, so css can lean it forward
// on hover (app.css › .mx-arr). The label text keeps its own node; screen readers skip the glyph.
const ARROWS = /\s*([→↗])\uFE0E?\s*$/;
const CONTROL = 'a[href], [data-act], [data-nav], button';
function dressArrows(root) {
  if (!root || typeof document.createTreeWalker !== 'function') return;
  const hits = [];
  const walk = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  if (root.nodeType === 3) hits.push(root);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) if (t.nodeValue.indexOf('→') >= 0 || t.nodeValue.indexOf('↗') >= 0) hits.push(t);
  for (const t of hits) {
    const m = ARROWS.exec(t.nodeValue); const p = t.parentElement;
    if (!m || !p || p.classList.contains('mx-arr') || p.closest('input, textarea, select, script, style, [contenteditable], .mx-arr')) continue;
    const ctl = p.closest(CONTROL);
    if (!ctl || !ctl.textContent.replace(/[→↗\s]/g, '')) continue;     // an arrow-only control keeps its glyph as its name
    const at = m.index + m[0].indexOf(m[1]);
    const wrap = document.createElement('span');
    const arr = document.createElement('span');
    // ↗ carries the text-presentation selector: the bundled Inter / Fraunces subsets lack U+2197, and WebKit's
    // fallback drew it as a blue Apple Color Emoji tile
    arr.className = 'mx-arr' + (m[1] === '↗' ? ' ne' : ''); arr.setAttribute('aria-hidden', 'true'); arr.textContent = m[1] === '↗' ? '↗\uFE0E' : m[1];
    wrap.append(t.nodeValue.slice(0, at), arr, t.nodeValue.slice(at + 1).replace(/^\uFE0E/, ''));
    t.replaceWith(wrap);
    ctl.classList.add('mx-has-arr');      // the NEAREST control owns the lean (a whole-overlay [data-act] never does)
  }
}
// Photos that are genuinely still loading fade in instead of painting in rows. Only inside the view and
// its sheets: the chrome (logo, drawer) is re-drawn on every route and its cached images must never blink,
// and a photo hero already has its own settle (and sits on ink). An image is judged a frame after it was
// drawn — a cached one has decoded by then and simply appears; only a real network wait is hidden.
const FADE_SCOPE = '#view, .mx-modal';
const FADE_SKIP = '.mx-rotator, .mx-hero-photo, .mx-brand, #mx-drawer, #mx-mobile-top, #mx-desktop-chrome';
function fadeImages(root) {
  if (!root || !root.nodeType || root.nodeType !== 1) return;
  const list = root.tagName === 'IMG' ? [root] : [...root.querySelectorAll('img')];
  // a photo still arriving decodes off the main thread: a screen change never waits (or stalls) on a large JPEG
  list.forEach(img => { if (!img.complete && !img.hasAttribute('decoding')) img.decoding = 'async'; });
  const wait = list.filter(img => !img.complete && !img.classList.contains('mx-img-in') && img.closest(FADE_SCOPE) && !img.closest(FADE_SKIP));
  if (!wait.length) return;
  requestAnimationFrame(() => {
    for (const img of wait) {
      if (img.complete || !img.isConnected || img.classList.contains('mx-img-in')) continue;
      img.classList.add('mx-img-in', 'mx-img-wait');
      const done = () => img.classList.remove('mx-img-wait');
      img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true });
    }
  });
}

export const ui = { toast, hideToast, trapFocus, returnFocus, modal, closeModals, lightbox, confirm, countdown, tick, toggleSwitch, flipSwitch, revealOnScroll, reducedMotion, buildIcs, downloadIcs, bind, installDelegates, esc, fmt, monogram, initials,
  lockScroll(on) { document.body.style.overflow = on ? 'hidden' : ''; },
  // quick DOM helper
  h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
};
export default ui;
