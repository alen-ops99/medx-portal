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
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(hide, opts.ms || (toastUndo ? 5000 : opts.kind === 'error' ? 4200 : 3000));
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
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') { close(); if (onclose) onclose(); } };
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
    e.preventDefault();
    h(el, e);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
// data-hover="color:#201b16;border-color:#201b16" ← the artboards' style-hover attribute, verbatim
function installDelegates() {
  if (installDelegates.done) return; installDelegates.done = true;
  const saved = new WeakMap();
  document.addEventListener('mouseover', e => {
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
  // make every actionable span reachable by keyboard without touching the copied markup
  const observer = new MutationObserver(() => {
    document.querySelectorAll('[data-act]:not([tabindex]):not(a):not(button):not(input):not(select):not(label), [data-nav]:not([tabindex]):not(a):not(button)').forEach(el => { el.setAttribute('tabindex', '0'); if (!el.getAttribute('role')) el.setAttribute('role', 'button'); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Inline locked mini-state for a card whose data call answered 403 { section } (contract §3.4).
function lockedBlock(sectionLabel, note) {
  return `<div class="empty" data-v2="locked-block"><span style="width:28px;height:1px;background:#c9a962"></span><span class="empty-line">Locked for you.</span><span class="empty-why">${esc(sectionLabel || 'This section')} needs access${note ? ' — ' + esc(note) : ' — ask Alen, he grants it per section.'}</span></div>`;
}

export const ui = { toast, modal, confirm, bind, installDelegates, lockedBlock, esc, fmt,
  lockScroll(on) { document.body.style.overflow = on ? 'hidden' : ''; },
  h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
};
export default ui;
