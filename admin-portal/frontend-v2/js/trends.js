// js/trends.js — the registrations chart's PURE layer: it turns the /api/dashboard/trends payload
// into an axis, a set of named series and the tick values a chart needs, and knows nothing about
// the DOM. Kept import-free on purpose so tests/today-trends.test.js can import it under plain
// node and assert the mapping without a browser. The drawing lives in js/views/today.js.
//
//   import { SERIES_DEFS, buildTrend } from '../trends.js';
//   const model = buildTrend(payload, { days: 30, hidden: { forum: true }, mode: 'daily' });
//
// The backend returns one zero-filled [{ date, count }] array per source plus `total`. An OLDER
// backend (Render deploys independently of Netlify, so this happens for real during a rollout)
// only knows the three legacy keys `plexus` / `accelerator` / `events` — buildTrend falls back to
// those so Today never shows an empty chart while the two halves of a deploy are out of step.

// Legend order is the reading order the owner asked for: the total first, then each thing that
// can be registered for. Colours are the house set — crimson for the total, gold for the Gala,
// ink/greys/muted blues for the rest — picked to stay apart from each other on a white card.
export const SERIES_DEFS = [
  { key: 'total',          label: 'TOTAL',          color: '#9b1b22', total: true },
  { key: 'conference',     label: 'CONFERENCE',     color: '#201b16' },
  { key: 'gala',           label: 'GALA',           color: '#c9a962' },
  { key: 'bridges_zagreb', label: 'BRIDGES ZAGREB', color: '#2f5d7c' },
  { key: 'bridges_boston', label: 'BRIDGES BOSTON', color: '#6f9bb8' },
  { key: 'accelerator',    label: 'ACCELERATOR',    color: '#2f7d4f' },
  { key: 'forum',          label: 'FORUM',          color: '#8a7f70' },
  { key: 'meetups',        label: 'MEETUPS',        color: '#b7791f' }
];
export const SOURCE_KEYS = SERIES_DEFS.filter(s => !s.total).map(s => s.key);
// Keys ONLY the per-source endpoint sends. `accelerator` is deliberately absent: the legacy payload
// has it too, so its presence says nothing about which backend answered.
export const NEW_ONLY_KEYS = ['total', 'conference', 'gala', 'bridges_zagreb', 'bridges_boston', 'forum', 'meetups'];
export const RANGES = [7, 30, 90];
export const DEFAULT_DAYS = 30;

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

export function normDays(v) { const n = Number(v); return RANGES.includes(n) ? n : DEFAULT_DAYS; }

// 'YYYY-MM-DD' for a Date, in LOCAL time (never toISOString — that silently shifts the day for
// anyone west of UTC, which is where the owner actually reads this screen from).
export function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x)) return '';
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
// '1 Sep' — the x-axis tick label.
export function dayTick(date) {
  const p = String(date).slice(0, 10).split('-');
  if (p.length !== 3) return String(date);
  return String(Number(p[2])) + ' ' + (MON3[Number(p[1]) - 1] || '');
}
// '1 Sep 2026' — the tooltip heading.
export function dayFull(date) {
  const p = String(date).slice(0, 10).split('-');
  if (p.length !== 3) return String(date);
  return String(Number(p[2])) + ' ' + (MON3[Number(p[1]) - 1] || '') + ' ' + p[0];
}

// The window's calendar days, oldest first. The backend's own `to`/`days` win when it sends them
// (its zero-fill is the truth the counts are bucketed against); otherwise we derive from the
// browser's clock, which is the compat path.
export function axisDates(payload, days, now) {
  const p = payload || {};
  const n = normDays(days || p.days);
  const end = /^\d{4}-\d{2}-\d{2}/.test(String(p.to || '')) ? String(p.to).slice(0, 10) : ymd(now || new Date());
  const endT = new Date(end + 'T12:00:00').getTime();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(ymd(new Date(endT - i * DAY_MS)));
  return out;
}

// [{date,count}] (sparse or zero-filled, any order) -> counts aligned to `dates`.
function align(rows, dates) {
  const map = Object.create(null);
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (!r || !r.date) return;
    const d = String(r.date).slice(0, 10);
    map[d] = (map[d] || 0) + (Number(r.count) || 0);
  });
  return dates.map(d => map[d] || 0);
}

// 3–4 gridlines with whole-number labels. Returns { top, ticks } where ticks[0] === 0.
export function niceTicks(max) {
  const m = Math.max(0, Number(max) || 0);
  if (m <= 0) return { top: 4, ticks: [0, 2, 4] };
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  let step = steps.find(s => Math.ceil(m / s) <= 4);
  if (!step) step = Math.ceil(m / 4 / 10000) * 10000;
  let n = Math.max(2, Math.ceil(m / step));          // at least two intervals => three labels
  const top = step * n;
  const ticks = []; for (let i = 0; i <= n; i++) ticks.push(step * i);
  return { top, ticks };
}

// Which x positions get a dated label. Anchored on TODAY (the last index) and counted backwards,
// so the right-hand tick is always the day the reader is standing on.
export function tickIndexes(n, days) {
  const step = days <= 7 ? 1 : days <= 30 ? 5 : 15;
  const out = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

/**
 * buildTrend(payload, opts) -> {
 *   days, dates, mode, series[], visible[], total, top, ticks, tickIdx, rangeLabel, scopeLabel, stale
 * }
 * `series[i].values` is daily counts; `series[i].plot` is what the chart draws (daily, or the
 * running sum in cumulative mode). `hidden` is the caller's per-chip state; a series whose whole
 * window is zero starts hidden unless the caller has explicitly turned it on.
 */
export function buildTrend(payload, opts = {}) {
  const p = payload || {};
  const days = normDays(opts.days != null ? opts.days : p.days);
  const dates = axisDates(p, days, opts.now);
  const mode = opts.mode === 'cumulative' ? 'cumulative' : 'daily';
  const hidden = opts.hidden || {};
  // Legacy payload: only plexus/accelerator/events. `accelerator` is NOT evidence of the new shape
  // — it is a key both shapes carry — so the test is the keys only the new endpoint knows.
  const stale = !NEW_ONLY_KEYS.some(k => Array.isArray(p[k])) && (Array.isArray(p.plexus) || Array.isArray(p.events));

  const series = SERIES_DEFS.map(def => {
    let values;
    if (def.total) {
      values = Array.isArray(p.total) ? align(p.total, dates) : null;
    } else if (Array.isArray(p[def.key])) {
      values = align(p[def.key], dates);
    } else if (stale && def.key === 'conference') {
      values = align(p.plexus, dates);          // the legacy name for the same series
    } else {
      values = dates.map(() => 0);
    }
    return Object.assign({}, def, { values });
  });

  // No `total` from the backend (old payload, or a partial one) — sum what we do have. On the
  // legacy path `events` already IS the combined event series, so it stands in for the total.
  const totalRow = series.find(s => s.total);
  if (!totalRow.values) {
    if (stale) {
      const ev = align(p.events, dates), ac = align(p.accelerator, dates);
      totalRow.values = dates.map((_, i) => ev[i] + ac[i]);
    } else {
      totalRow.values = dates.map((_, i) => series.reduce((n, s) => n + (s.total ? 0 : s.values[i]), 0));
    }
  }

  series.forEach(s => {
    s.sum = s.values.reduce((a, b) => a + b, 0);
    s.allZero = s.sum === 0;
    // A series with nothing in the window keeps its chip (so the reader can see it exists and is
    // empty) but does not add a flat line to the plot unless it is ticked on deliberately. The
    // TOTAL is the exception — an empty window is itself the answer, and a chart with no series
    // at all reads as broken rather than as quiet.
    s.hidden = Object.prototype.hasOwnProperty.call(hidden, s.key) ? !!hidden[s.key] : (s.allZero && !s.total);
    let run = 0;
    s.plot = mode === 'cumulative' ? s.values.map(v => (run += v)) : s.values.slice();
  });

  const visible = series.filter(s => !s.hidden);
  const top = niceTicks(Math.max(0, ...visible.map(s => Math.max(0, ...s.plot)))) ;
  const shown = visible.filter(s => !s.total).map(s => s.label);
  const scopeLabel = !visible.length ? 'NOTHING SHOWN — PICK A SERIES'
    : shown.length === SOURCE_KEYS.length ? 'ALL EVENTS'
    : shown.length ? shown.join(' + ')
    : 'TOTAL ONLY';

  return {
    days, dates, mode, series, visible, stale,
    total: totalRow.sum,
    top: top.top, ticks: top.ticks,
    tickIdx: tickIndexes(dates.length, days),
    rangeLabel: dayTick(dates[0]).toUpperCase() + ' — ' + dayTick(dates[dates.length - 1]).toUpperCase(),
    scopeLabel
  };
}

export default { SERIES_DEFS, SOURCE_KEYS, RANGES, DEFAULT_DAYS, buildTrend, niceTicks, tickIndexes, axisDates, normDays, ymd, dayTick, dayFull };
