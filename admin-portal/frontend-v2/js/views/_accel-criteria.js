// js/views/_accel-criteria.js — the EVALUATION / SCORING CRITERIA card shared by the Accelerator Hub
// (accelerator.js › "EVALUATION CRITERIA") and the Review Room (accelerator-review.js › "SCORING
// CRITERIA"), plus the weighted-total arithmetic the Review Room's TOTAL, ranking and CSV read.
// One source so the two cards never drift again (audit 2026-09-17: both hard-coded "Scale is 0–5"
// against rows carrying max_points 10 and weights .30/.25/.25/.20, and neither could edit either).
// Like _stub.js this is a helper, not a destination — no route, no SOURCE, the host view keeps its
// own wrapper + artboard markers and passes its state in.
//
// Routes (legacy per-year criteria surface, all COALESCE-partial on the server):
//   GET  /api/accelerator/years/:year/criteria          active rows only
//   POST /api/accelerator/years/:year/criteria          { name, max_points, weight, category }
//   PUT  /api/accelerator/criteria/:id                  { name | max_points | weight | is_active }
//   DEL  /api/accelerator/criteria/:id                  soft (is_active = 0)
//
// Weighted total — 0–100: Σ(score / max_points × weight) / Σ(weight) × 100. Unscored criteria count 0
// and the denominator is the whole active rubric, so a half-scored file ranks below a fully scored
// one. Same ordering as the legacy Σ(score × weight) (server recalculateApplicationScores) whenever
// max_points is uniform. Backend twin: admin-portal/backend/v2/accelerator-review.js › computeWeightedTotal.
import { api } from '../api.js';
import { ui, esc } from '../ui.js';

export const TOTAL_SCALE = 100;

export const CRIT_COPY = {
  tag: 'yours to define', add: 'ADD', placeholder: 'Add a criterion — e.g. English fluency',
  cols: { name: 'CRITERION', max: 'MAX PTS', weight: 'WEIGHT' },
  note: scale => `Scale is ${scale} · TOTAL = weighted share of max points, 0–${TOTAL_SCALE} · every applicant is scored on every criterion.`,
  balanced: sum => `weights sum to ${sum}`,
  rebalance: sum => `weights now sum to ${sum} — rebalance`,
  added: 'CRITERION ADDED — EVERY APPLICANT GETS A CELL FOR IT', renamed: 'CRITERION RENAMED — SCORES STAY ATTACHED',
  maxSaved: m => `MAX POINTS SET TO ${m} — NEW SCORES CAP THERE`, weightSaved: 'WEIGHT SAVED — TOTALS AND THE RANKING FOLLOW',
  removed: 'CRITERION REMOVED FROM THE RUBRIC', needName: 'TYPE THE CRITERION FIRST',
  badMax: 'MAX POINTS MUST BE A NUMBER FROM 1 TO 100', badWeight: 'WEIGHT MUST BE A POSITIVE NUMBER (E.G. 0.25)'
};

// ---- rubric arithmetic ----
// Unnamed rows would render as an empty field plus a bare ✕ (and an unlabelled box on every
// applicant row) — dropped here, the one chokepoint the card, the score grid and the CSV all read.
export const activeCriteria = rows => (rows || []).filter(c => c && String(c.name || '').trim());
export const maxOf = c => { const m = Number(c && c.max_points); return m > 0 ? m : 10; };
export const weightOf = c => { const w = Number(c && c.weight); return Number.isFinite(w) && w >= 0 ? w : 1; };
const round = (n, d) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
const fmtW = w => String(round(w, 3));

// scale text, prevailing max (mode, else 10), Σweight and the balance flag, the next criterion's default weight
export function rubric(crits) {
  const maxes = crits.map(maxOf);
  const uniq = [...new Set(maxes)].sort((a, b) => a - b);
  const count = {}; let mode = 10, best = 0;
  maxes.forEach(m => { count[m] = (count[m] || 0) + 1; if (count[m] > best) { best = count[m]; mode = m; } });
  const sumWeight = crits.reduce((s, c) => s + weightOf(c), 0);
  return {
    scale: !uniq.length ? '0–10' : uniq.length === 1 ? `0–${uniq[0]}` : `0–${uniq[0]} to 0–${uniq[uniq.length - 1]} by criterion`,
    maxMode: mode,
    sumWeight, sumLabel: round(sumWeight, 2).toFixed(2),
    balanced: !crits.length || Math.abs(sumWeight - 1) <= 0.01,
    nextWeight: round(1 / (crits.length + 1), 3)
  };
}

// weightedTotal(crits, scoreFor) → 0–100 · scoreFor(criterion) → score | null
export function weightedTotal(crits, scoreFor) {
  let num = 0, den = 0;
  crits.forEach(c => {
    const w = weightOf(c); den += w;
    const s = scoreFor(c); const n = s == null || s === '' ? NaN : Number(s);
    if (Number.isFinite(n)) num += (n / maxOf(c)) * w;
  });
  return den > 0 ? (num / den) * TOTAL_SCALE : 0;
}
export const fmtTotal = t => (Math.round(t * 10) / 10).toFixed(1);

// ---- markup: the card's header + body (the host wraps it in its own data-block="crit" frame) ----
const IN = 'border:1px solid rgba(32,27,22,.25);background:#f6f2ea;padding:8px 10px;font:400 12.5px Inter,sans-serif;color:#201b16;box-sizing:border-box';
const COL = 'font:600 8px Inter,sans-serif;letter-spacing:.11em;color:#9a9086;white-space:nowrap';
export function criteriaCardBody(rows, { title }) {
  const crits = activeCriteria(rows);
  const r = rubric(crits);
  return `
          <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(32,27,22,.1)"><span style="font:600 11px Inter,sans-serif;letter-spacing:.15em">${title}</span><div style="flex:1"></div><span style="font-size:11px;color:#6d6459">${CRIT_COPY.tag}</span></div>
          <div style="padding:10px 18px 14px;display:flex;flex-direction:column;gap:8px">
            ${crits.length ? `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="flex:1;min-width:0;${COL}">${CRIT_COPY.cols.name}</span>
              <span style="width:58px;text-align:center;${COL}">${CRIT_COPY.cols.max}</span>
              <span style="width:64px;text-align:center;${COL}">${CRIT_COPY.cols.weight}</span>
              <span style="width:20px"></span>
            </div>` : ''}
            ${crits.map(c => `
            <div style="display:flex;align-items:center;gap:8px" data-row="${esc(c.id)}">
              <input value="${esc(c.name)}" data-change="critRename" data-id="${esc(c.id)}" aria-label="${CRIT_COPY.cols.name}" style="flex:1;min-width:0;${IN}">
              <input value="${esc(maxOf(c))}" data-change="critMax" data-id="${esc(c.id)}" inputmode="decimal" aria-label="${CRIT_COPY.cols.max}" title="Scores for this criterion run 0–${esc(maxOf(c))}" style="width:58px;text-align:center;${IN}">
              <input value="${esc(fmtW(weightOf(c)))}" data-change="critWeight" data-id="${esc(c.id)}" inputmode="decimal" aria-label="${CRIT_COPY.cols.weight}" title="Share of the total — weights should sum to 1" style="width:64px;text-align:center;${IN}">
              <span data-act="critRemove" data-id="${esc(c.id)}" title="Remove criterion" style="width:20px;text-align:center;font:600 12px Inter,sans-serif;color:#9a9086;cursor:pointer;padding:4px 0" data-hover="color:#9b1b22">✕</span>
            </div>`).join('')}
            <div style="display:flex;gap:8px">
              <input data-role="critDraft" placeholder="${CRIT_COPY.placeholder}" style="flex:1;min-width:0;${IN}">
              <span data-act="addCrit" style="padding:8px 12px;background:#9b1b22;color:#fff;font:600 9.5px Inter,sans-serif;letter-spacing:.13em;cursor:pointer;display:flex;align-items:center" data-hover="background:#7e151b">${CRIT_COPY.add}</span>
            </div>
            <span style="font-size:11px;color:#6d6459">${esc(CRIT_COPY.note(r.scale))}</span>
            ${crits.length ? `<span data-role="critWeights" style="font:600 9px Inter,sans-serif;letter-spacing:.12em;color:${r.balanced ? '#22563a' : '#b7791f'}">${esc((r.balanced ? CRIT_COPY.balanced : CRIT_COPY.rebalance)(r.sumLabel).toUpperCase())}</span>` : ''}
          </div>`;
}

// ---- behaviour: the host passes { year, rows, setRows, rerender, val } ----
//   year()     → the cycle year the routes are scoped to
//   rows()     → the host's criteria array · setRows(rows) → replace it after a refetch
//   rerender() → the host's full re-render · val(role) → trimmed value of [data-role=…]
export function criteriaHandlers(host) {
  const refetch = async () => host.setRows(await api.get(`/api/accelerator/years/${host.year()}/criteria`));
  return {
    addCrit: async () => {
      const name = host.val('critDraft');
      if (!name) { ui.toast(CRIT_COPY.needName, { kind: 'error' }); return; }
      const r = rubric(activeCriteria(host.rows()));
      try {
        // new rows inherit the prevailing scale and an equal share of the weight — the card then
        // says "weights now sum to 1.20 — rebalance" until the admin trims the others.
        await api.post(`/api/accelerator/years/${host.year()}/criteria`, { name, max_points: r.maxMode, weight: r.nextWeight, category: 'objective' });
        await refetch();
        host.rerender();
        ui.toast(CRIT_COPY.added);
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    },
    critRemove: async (el) => {
      const id = el.dataset.id;
      try {
        await api.del('/api/accelerator/criteria/' + id);
        await refetch();
        host.rerender();
        ui.toast(CRIT_COPY.removed, { undo: async () => {
          try { await api.put('/api/accelerator/criteria/' + id, { is_active: 1 }); await refetch(); host.rerender(); }
          catch (e) { ui.toast(e.message, { kind: 'error' }); }
        } });
      } catch (e) { ui.toast(e.message, { kind: 'error' }); }
    }
  };
}

// change-driven fields (name / max_points / weight) — returns true when the element was one of ours
export async function onCriteriaChange(el, host) {
  const kind = el.dataset.change;
  if (kind !== 'critRename' && kind !== 'critMax' && kind !== 'critWeight') return false;
  const id = el.dataset.id;
  const row = (host.rows() || []).find(c => c.id === id);
  const revert = () => { if (!row) return; el.value = kind === 'critRename' ? row.name : kind === 'critMax' ? maxOf(row) : fmtW(weightOf(row)); };
  try {
    if (kind === 'critRename') {
      const name = el.value.trim();
      if (!name) { revert(); return true; }
      await api.put('/api/accelerator/criteria/' + id, { name });
      if (row) row.name = name;
      ui.toast(CRIT_COPY.renamed);
      return true;
    }
    const n = Number(String(el.value).trim().replace(',', '.'));
    if (kind === 'critMax') {
      if (!Number.isFinite(n) || n < 1 || n > 100) { ui.toast(CRIT_COPY.badMax, { kind: 'error' }); revert(); return true; }
      await api.put('/api/accelerator/criteria/' + id, { max_points: n });
      if (row) row.max_points = n;
      host.rerender();                      // the scale line, the score-cell caps and the totals all follow
      ui.toast(CRIT_COPY.maxSaved(n));
      return true;
    }
    if (!Number.isFinite(n) || n <= 0 || n > 100) { ui.toast(CRIT_COPY.badWeight, { kind: 'error' }); revert(); return true; }
    await api.put('/api/accelerator/criteria/' + id, { weight: n });
    if (row) row.weight = n;
    host.rerender();                        // the Σweight hint and the weighted totals follow
    ui.toast(CRIT_COPY.weightSaved);
  } catch (err) { ui.toast(err.message, { kind: 'error' }); revert(); }
  return true;
}
