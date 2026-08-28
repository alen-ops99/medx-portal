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

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Med&X in copy: keep the ampersand readable in templates → esc() then this for brand strings
export const AMP = 'Med&amp;X';

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
  toDate
};

// ---------------------------------------------------------------- toast
let toastEl = null, toastTimer = null;
function toast(text, opts = {}) {
  const msg = String(text || '').trim() || (opts.kind === 'error' ? 'Something went wrong — please try again.' : 'Done.');
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mx-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', opts.kind === 'error');
  clearTimeout(toastTimer);
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), opts.ms || (opts.kind === 'error' ? 4200 : 2800));
}

// ---------------------------------------------------------------- modal / confirm
function modal({ eyebrow = 'MED&X', title = '', body = '', actions = [], closeOnScrim = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'mx-modal';
  wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <div class="mx-modal-sheet">
      <div class="mx-modal-head"><span>${esc(eyebrow)}</span><div style="flex:1"></div><span data-act="close" role="button" tabindex="0" aria-label="Close" style="color:#4a4239;cursor:pointer;font:400 18px Inter,sans-serif;letter-spacing:0">×</span></div>
      <div class="mx-modal-body">${title ? `<div class="mx-modal-title">${title}</div>` : ''}${body}</div>
      ${actions.length ? `<div class="mx-modal-foot">${actions.map((a, i) => `<span data-act="a${i}" role="button" tabindex="0" class="${a.kind === 'primary' ? 'btn-primary' : a.kind === 'gold' ? 'btn-gold' : 'btn-ghost'}">${esc(a.label)}</span>`).join('')}</div>` : ''}
    </div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') { close(); if (typeof opts_onclose === 'function') opts_onclose(); } };
  let opts_onclose = null;
  const handlers = { close: () => { close(); if (opts_onclose) opts_onclose(); } };
  actions.forEach((a, i) => { handlers['a' + i] = () => { const r = a.onClick ? a.onClick() : undefined; if (r !== false) close(); }; });
  bind(wrap, handlers);
  wrap.addEventListener('click', e => { if (closeOnScrim && e.target === wrap) handlers.close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  const first = wrap.querySelector('.mx-modal-foot [data-act]') || wrap.querySelector('[data-act="close"]');
  if (first) first.focus();
  return { close, onClose(fn) { opts_onclose = fn; return this; }, el: wrap };
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

// ---------------------------------------------------------------- .ics
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
function buildIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MedX//Portal v2//EN', 'CALSCALE:GREGORIAN'];
  events.forEach(ev => {
    const start = typeof ev.start === 'string' && /^\d{8}$/.test(ev.start) ? ev.start : fmt.ymd(ev.start);
    let end = typeof ev.end === 'string' && /^\d{8}$/.test(ev.end) ? ev.end : (ev.end ? fmt.ymd(ev.end) : '');
    if (!start) return;
    if (!end) { const d = toDate(start.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')); d.setDate(d.getDate() + 1); end = fmt.ymd(d); }
    lines.push('BEGIN:VEVENT', 'UID:' + (ev.uid || start + '-' + Math.random().toString(36).slice(2, 8)) + '@medx.hr', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + start, 'DTEND;VALUE=DATE:' + end, 'SUMMARY:' + icsEscape(ev.summary || 'Med&X'));
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
    e.preventDefault();
    h(el, e);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
// data-hover="border-color:#191512;color:#191512" ← the artboards' style-hover attribute, verbatim
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
    document.querySelectorAll('[data-act]:not([tabindex]):not(a):not(button):not(input), [data-nav]:not([tabindex]):not(a):not(button)').forEach(el => { el.setAttribute('tabindex', '0'); if (!el.getAttribute('role')) el.setAttribute('role', 'button'); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export const ui = { toast, modal, confirm, countdown, buildIcs, downloadIcs, bind, installDelegates, esc, fmt,
  lockScroll(on) { document.body.style.overflow = on ? 'hidden' : ''; },
  // quick DOM helper
  h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
};
export default ui;
