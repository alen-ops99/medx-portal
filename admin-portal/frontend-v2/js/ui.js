// js/ui.js — shared UI helpers: toast (with UNDO), modal/confirm, formatters (dates, € with the
// design's rules), template escaping, event binding, hover-style + keyboard delegates for the
// artboards' `style-hover` / `onClick` spans.
//
//   import { ui, esc, fmt } from './ui.js';
//   ui.toast('TASK ADDED — VISIBLE TO THE WHOLE TEAM');                    // never empty text
//   ui.toast('SNOOZED FOR 1 DAY', { undo: () => … });                        // gold UNDO (artboard toast)
//   ui.toast(e.message, { kind: 'error' });
//   const ok = await ui.confirm({ title: 'Remove access?', body: '…', ok: 'REMOVE', cancel: 'KEEP' });
//   ui.bind(root, { tg: () => …, cl: (el, ev) => … });                       // <span data-act="tg">
//   fmt.eur(3150) → '€3,150' · fmt.dayLabel('2026-09-01') → 'SEP 1' · fmt.rangeLabel('2026-09-18','2026-09-21') → 'SEP 18–21'
//   fmt.todayLabel() → 'SUNDAY, 30 AUGUST 2026' (Admin Home todayLabel, verbatim — no city suffix)

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const AMP = 'Med&amp;X';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_MS = 86400000;

function toDate(v) {
  if (v instanceof Date) return v;
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);           // date or datetime → local midnight of that day
  if (m && s.length === 10) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}
function midnight(v) { const d = toDate(v); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null; }

export const fmt = {
  // "€150" — the € sign, never "EUR"; no decimals unless the amount has them; thousands separator
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
  euro: s => String(s == null ? '' : s).replace(/\bEUR\s?(\d[\d.,]*)/g, '€$1').replace(/(\d[\d.,]*)\s?EUR\b/g, '€$1'),
  upper: s => String(s == null ? '' : s).toUpperCase(),
  plural: (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's')),
  // 'SEP 1' — Coming-up / task due labels
  dayLabel(v) { const d = toDate(v); return d ? MON3[d.getMonth()] + ' ' + d.getDate() : ''; },
  // 'Sep 1' — title-case day (artboard copy: "early bird ends Sep 1")
  dayShort(v) { const d = toDate(v); return d ? MON3[d.getMonth()][0] + MON3[d.getMonth()].slice(1).toLowerCase() + ' ' + d.getDate() : ''; },
  // 'SEP 18–21' / 'DEC 4–5' / 'SEP 28 – OCT 2' / 'SEP 1'
  rangeLabel(start, end) {
    const a = toDate(start), b = toDate(end);
    if (!a) return '';
    if (!b || a.getTime() === b.getTime()) return fmt.dayLabel(a);
    if (a.getMonth() === b.getMonth()) return MON3[a.getMonth()] + ' ' + a.getDate() + '–' + b.getDate();
    return fmt.dayLabel(a) + ' – ' + fmt.dayLabel(b);
  },
  // 'December 4–5, 2026' / 'December 4, 2026'
  longRange(start, end) {
    const a = toDate(start), b = toDate(end);
    if (!a) return '';
    if (!b || a.getTime() === b.getTime()) return MONTHS[a.getMonth()] + ' ' + a.getDate() + ', ' + a.getFullYear();
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return MONTHS[a.getMonth()] + ' ' + a.getDate() + '–' + b.getDate() + ', ' + a.getFullYear();
    return MONTHS[a.getMonth()] + ' ' + a.getDate() + ' – ' + MONTHS[b.getMonth()] + ' ' + b.getDate() + ', ' + b.getFullYear();
  },
  // 'SUNDAY, 30 AUGUST 2026' (Admin Home.dc.html todayLabel, verbatim)
  todayLabel(now = new Date()) { return DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()].toUpperCase() + ' ' + now.getFullYear(); },
  dow3(v) { const d = toDate(v); return d ? DAY3[d.getDay()] : ''; },
  // whole days from today to a date (negative = past); null when unparseable
  daysUntil(v, now = new Date()) { const d = midnight(v); if (!d) return null; const t = midnight(now); return Math.round((d - t) / DAY_MS); },
  daysSince(v, now = new Date()) { const n = fmt.daysUntil(v, now); return n == null ? null : -n; },
  // 'AUG 1 — AUG 30' (sparkline range label)
  sparkRange(days = 30, now = new Date()) { const start = new Date(now.getTime() - (days - 1) * DAY_MS); return fmt.dayLabel(start) + ' — ' + fmt.dayLabel(now); },
  ymd(d) { const x = toDate(d); if (!x) return ''; return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); },
  // 'TODAY 15:43' / 'AUG 8' (audit-log style)
  when(v, now = new Date()) { const d = toDate(v); if (!d) return ''; const same = fmt.ymd(d) === fmt.ymd(now); return same ? 'TODAY ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : fmt.dayLabel(d); },
  initials(name) { return String(name || '').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase(); },
  toDate, midnight
};

// ---------------------------------------------------------------- toast (Admin Home.dc.html)
let toastEl = null, toastTimer = null, toastUndo = null;
function toast(text, opts = {}) {
  const msg = String(text || '').trim() || (opts.kind === 'error' ? 'Something went wrong — please try again.' : 'Done.');
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mx-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); toastEl.addEventListener('click', e => { if (e.target.closest('.undo')) { const u = toastUndo; hide(); if (u) u(); } }); }
  const hide = () => { toastEl.classList.remove('show'); toastUndo = null; };
  toastEl.textContent = msg;
  toastUndo = typeof opts.undo === 'function' ? opts.undo : null;
  if (toastUndo) { const u = document.createElement('span'); u.className = 'undo'; u.setAttribute('role', 'button'); u.setAttribute('tabindex', '0'); u.textContent = opts.undoLabel || 'UNDO'; toastEl.appendChild(u); }
  toastEl.classList.toggle('error', opts.kind === 'error');
  clearTimeout(toastTimer);
  const ms = opts.ms || (toastUndo ? 5000 : opts.kind === 'error' ? 4200 : 3000);
  // an UNDO toast carries a gold hairline that runs out with the undo window (css .mx-toast.timed)
  toastEl.classList.remove('timed');
  if (toastUndo) { toastEl.style.setProperty('--toast-ms', ms + 'ms'); void toastEl.offsetWidth; toastEl.classList.add('timed'); }
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(hide, ms);
}

// ---------------------------------------------------------------- modal / confirm
function modal({ eyebrow = 'MED&X ADMIN', title = '', body = '', actions = [], closeOnScrim = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'mx-modal';
  wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <div class="mx-modal-sheet">
      <div class="mx-modal-head"><span>${esc(eyebrow)}</span><div style="flex:1"></div><span data-act="close" role="button" tabindex="0" aria-label="Close" style="color:#6d6459;cursor:pointer;font:400 18px Inter,sans-serif;letter-spacing:0">×</span></div>
      <div class="mx-modal-body">${title ? `<div class="mx-modal-title">${title}</div>` : ''}${body}</div>
      ${actions.length ? `<div class="mx-modal-foot">${actions.map((a, i) => `<span data-act="a${i}" role="button" tabindex="0" class="${a.kind === 'primary' ? 'btn-primary' : a.kind === 'ink' ? 'btn-ink' : 'btn-ghost'}">${esc(a.label)}</span>`).join('')}</div>` : ''}
    </div>`;
  let onclose = null;
  // the modal fades out (160 ms, css .mx-modal.is-leaving — the member portal's close) — callers have
  // already resolved; nothing waits on it. Reduced motion: gone at once.
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (!wrap.isConnected || wrap.classList.contains('is-leaving')) return;
    if (reducedMotion()) { wrap.remove(); return; }
    wrap.classList.add('is-leaving');
    setTimeout(() => wrap.remove(), 170);
  };
  const onKey = e => { if (e.key === 'Escape' && !wrap.classList.contains('is-leaving')) { close(); if (onclose) onclose(); } };
  const handlers = { close: () => { close(); if (onclose) onclose(); } };
  actions.forEach((a, i) => { handlers['a' + i] = () => { const r = a.onClick ? a.onClick() : undefined; if (r !== false) close(); }; });
  bind(wrap, handlers);
  wrap.addEventListener('click', e => { if (closeOnScrim && e.target === wrap) handlers.close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const first = wrap.querySelector('.mx-modal-foot [data-act]') || wrap.querySelector('[data-act="close"]');
  if (first) first.focus();
  return { close, onClose(fn) { onclose = fn; return this; }, el: wrap };
}
function confirm({ eyebrow = 'PLEASE CONFIRM', title = 'Are you sure?', body = '', ok = 'CONFIRM', cancel = 'CANCEL' } = {}) {
  return new Promise(resolve => {
    const m = modal({ eyebrow, title, body, actions: [{ label: cancel, onClick: () => resolve(false) }, { label: ok, kind: 'primary', onClick: () => resolve(true) }] });
    m.onClose(() => resolve(false));
  });
}

// ---------------------------------------------------------------- binding helpers
// <span data-act="name"> → handlers.name(el, event). Delegated once per root; survives re-renders of children.
function bind(root, handlers) {
  const onClick = e => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.getAttribute('aria-disabled') === 'true') return;
    const h = handlers[el.dataset.act];
    if (!h) return;
    // a real link INSIDE an actionable row is the user's target — let it open natively (member bind() twin)
    const link = e.target.closest('a[href]');
    if (link && link !== el && el.contains(link)) return;
    // Never cancel a native control's OWN activation behaviour. On a file input preventDefault
    // closed the OS file picker; on a checkbox/radio it runs the "canceled activation steps",
    // which restore the pre-click checkedness AFTER dispatch — so the box silently un-ticked
    // itself again however hard the handler set el.checked (admin Inbox "pick people by hand").
    const nativeType = e.target && e.target.type;
    if (nativeType !== 'file' && nativeType !== 'checkbox' && nativeType !== 'radio') e.preventDefault();
    h(el, e);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
// data-hover="color:#201b16;border-color:#201b16" ← the artboards' style-hover attribute, verbatim
function installDelegates() {
  if (installDelegates.done) return; installDelegates.done = true;
  const saved = new WeakMap();
  // hover looks are for pointers that hover: on a phone a tap fires mouseover too, and the look
  // then stuck until the next tap somewhere else
  let canHover = { matches: true };
  try { canHover = window.matchMedia('(hover: hover)'); } catch (e) {}
  document.addEventListener('mouseover', e => {
    if (!canHover.matches) return;
    const el = e.target.closest && e.target.closest('[data-hover]');
    if (!el || saved.has(el)) return;
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
  // make every actionable span reachable by keyboard without touching the copied markup; and, on
  // whatever was just added, dress the trailing arrows (the member portal's observer, same helper)
  const observer = new MutationObserver(records => {
    document.querySelectorAll('[data-act]:not([tabindex]):not(a):not(button):not(input):not(select):not(label), [data-nav]:not([tabindex]):not(a):not(button)').forEach(el => { el.setAttribute('tabindex', '0'); if (!el.getAttribute('role')) el.setAttribute('role', 'button'); });
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType === 3) { if (n.parentNode) dressArrows(n.parentNode); }
      else if (n.nodeType === 1) dressArrows(n);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  dressArrows(document.body);
}
// A control whose label ends in → (or ↗) gets that arrow in its own span, so css can lean it forward on
// hover and focus (app.css › .mx-arr) — the member portal's dressArrows, so both portals lean every
// trailing arrow the same way and no view hand-wraps one. The label text keeps its own node; screen
// readers skip the glyph. The space before the arrow becomes a no-break space: the arrow never wraps onto
// a line of its own on a phone ("manage / →"), and it survives the edge of a flex item.
const ARROWS = /\s*([→↗])\s*$/;
const CONTROL = 'a[href], [data-act], [data-nav], button';
function dressArrows(root) {
  if (!root || typeof document.createTreeWalker !== 'function') return;
  const hits = [];
  const walk = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  if (root.nodeType === 3) hits.push(root);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) if (t.nodeValue.indexOf('→') >= 0 || t.nodeValue.indexOf('↗') >= 0) hits.push(t);
  for (const t of hits) {
    const m = ARROWS.exec(t.nodeValue); const p = t.parentElement;
    if (!m || !p || p.classList.contains('mx-arr') || p.closest('input, textarea, select, option, script, style, svg, [contenteditable], .mx-arr')) continue;
    const ctl = p.closest(CONTROL);
    if (!ctl || !ctl.textContent.replace(/[→↗\s]/g, '')) continue;     // an arrow-only control keeps its glyph as its name
    const at = m.index + m[0].indexOf(m[1]);
    const gap = at > m.index ? ' ' : '';
    const wrap = document.createElement('span');
    const arr = document.createElement('span');
    arr.className = 'mx-arr' + (m[1] === '↗' ? ' ne' : ''); arr.setAttribute('aria-hidden', 'true'); arr.textContent = m[1];
    wrap.append(t.nodeValue.slice(0, m.index) + gap, arr, t.nodeValue.slice(at + 1));
    t.replaceWith(wrap);
    ctl.classList.add('mx-has-arr');      // the NEAREST control owns the lean (a whole-overlay [data-act] never does)
  }
}

// ---------------------------------------------------------------- motion helpers
// One motion language (css/tokens.css › --ease, --t-*); every helper is a no-op for reduced motion.
function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}
// A side panel whose file just opened settles in once, its blocks a few ms apart (app.css .mx-panel-in).
// settle(panel) starts it; a view that redraws the panel — or one block inside it — while it is still
// settling calls settle.carry(newNode): the entrance carries on from where it was (a negative delay,
// --settle-d) instead of replaying from nothing (the Registrations history used to blink on every note).
let settling = null;
function settle(el) {
  if (!el) return;
  if (settling) { clearTimeout(settling.timer); settling.el.classList.remove('mx-panel-in'); }
  el.style.removeProperty('--settle-d');
  el.classList.add('mx-panel-in');
  const s = settling = { el, at: Date.now() };
  s.timer = setTimeout(() => { if (settling !== s) return; s.el.classList.remove('mx-panel-in'); s.el.style.removeProperty('--settle-d'); settling = null; }, 480);
}
settle.carry = function (node) {
  const s = settling; if (!s || !node) return;
  if (node.matches && node.matches('[data-block="panel"]')) { s.el = node; node.classList.add('mx-panel-in'); }
  node.style.setProperty('--settle-d', -(Date.now() - s.at) + 'ms');
};
// One COPY confirmation for every copy control (Links, the Event Day door link, the Bridges press line,
// the Forum codes and public link). The view redraws the control in its ✓ COPIED look; this sends one
// gold ring from a button — or lets a text link's new word settle in (`word: true`) — on THAT element
// only, never written into a template from state, so no later repaint replays it; announces it to
// screen readers; and ~2.4 s later calls `revert` (the view clears its flag and puts the word back in
// place). No toast as well: the control already says so.
let copiedTimer = null, liveEl = null;
function copied(el, revert, { word = false, say = 'Copied', ms = 2400 } = {}) {
  if (el && el.isConnected) {
    const cls = word ? 'mx-copied-word' : 'mx-copied';
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  }
  if (!liveEl) { liveEl = document.createElement('span'); liveEl.className = 'mx-sr'; liveEl.setAttribute('role', 'status'); liveEl.setAttribute('aria-live', 'polite'); document.body.appendChild(liveEl); }
  liveEl.textContent = ''; setTimeout(() => { if (liveEl) liveEl.textContent = say; }, 30);
  clearTimeout(copiedTimer);
  if (typeof revert === 'function') copiedTimer = setTimeout(() => { try { revert(); } catch (e) {} }, ms);
}

// Inline locked mini-state for a card whose data call answered 403 { section } (contract §3.4).
function lockedBlock(sectionLabel, note) {
  return `<div class="empty" data-v2="locked-block"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">Locked for you.</span><span class="empty-why">${esc(sectionLabel || 'This section')} needs access${note ? ' — ' + esc(note) : ' — ask Alen, he grants it per section.'}</span></div>`;
}

export const ui = { toast, modal, confirm, bind, installDelegates, lockedBlock, esc, fmt, reducedMotion, settle, copied, dressArrows,
  lockScroll(on) { document.body.style.overflow = on ? 'hidden' : ''; },
  h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
};
export default ui;
