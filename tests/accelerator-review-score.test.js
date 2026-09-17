/**
 * accelerator-review-score.test.js — the Review Room's weighted total
 * (admin-portal/backend/v2/accelerator-review.js › module.exports.computeWeightedTotal).
 *
 * Hermetic: node:assert only — requires the module file (the mount function is not called, so no
 * express, no database, no network). Asserts, on the seeded 2026 rubric (4 criteria, max_points 10,
 * weights .30/.25/.25/.20 — verified against prod on 2026-09-17):
 *
 *   - the total is Σ(score/max_points × weight)/Σweight × 100 (0–100 scale) — 8/7/9/6 → 76.0
 *   - it RANKS identically to the legacy Σ(score × weight) (server recalculateApplicationScores)
 *     across 500 random score sets, ties included, and is exactly legacy × 10 while max is uniform
 *   - unscored criteria count 0 (denominator = the whole rubric), a map or a function both work
 *   - a full-marks file is 100, an empty rubric / zero weights → 0, mixed max_points normalise
 *   - weights that do not sum to 1 (a fifth criterion at 1/5) still land on 0–100
 *
 * Run: node tests/accelerator-review-score.test.js   (exit 0 = all passed)
 */
'use strict';
const assert = require('node:assert');
const path = require('path');

const mod = require(path.join(__dirname, '..', 'admin-portal/backend/v2/accelerator-review.js'));
const { computeWeightedTotal, TOTAL_SCALE } = mod;

const results = [];
const check = (name, fn) => {
    try { fn(); results.push([name, true]); console.log('PASS | ' + name); }
    catch (e) { results.push([name, false]); console.log('FAIL | ' + name + ' | ' + String(e.message).slice(0, 300)); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// the prod rubric
const RUBRIC = [
    { id: 'c1', name: 'Academic Excellence', max_points: 10, weight: 0.30 },
    { id: 'c2', name: 'Research Potential', max_points: 10, weight: 0.25 },
    { id: 'c3', name: 'Motivation & Fit', max_points: 10, weight: 0.25 },
    { id: 'c4', name: 'Leadership & Impact', max_points: 10, weight: 0.20 }
];
const legacy = (rubric, scores) => rubric.reduce((s, c) => s + (Number(scores[c.id] || 0) * Number(c.weight)), 0); // Σ(score × weight)

check('exports: computeWeightedTotal is a function and the scale is 100', () => {
    assert.strictEqual(typeof computeWeightedTotal, 'function');
    assert.strictEqual(TOTAL_SCALE, 100);
    assert.strictEqual(typeof mod, 'function', 'the mount function stays the default export');
});

check('formula: 8/7/9/6 on the prod rubric → 76.0 (= legacy 7.6 × 10)', () => {
    const scores = { c1: 8, c2: 7, c3: 9, c4: 6 };
    const t = computeWeightedTotal(RUBRIC, scores);
    assert.ok(near(t, 76), 'got ' + t);
    assert.ok(near(t, legacy(RUBRIC, scores) * 10), 'legacy × 10 mismatch');
});

check('formula: full marks → 100, zeros → 0', () => {
    assert.ok(near(computeWeightedTotal(RUBRIC, { c1: 10, c2: 10, c3: 10, c4: 10 }), 100));
    assert.ok(near(computeWeightedTotal(RUBRIC, { c1: 0, c2: 0, c3: 0, c4: 0 }), 0));
});

check('inputs: a scoreFor(criterion) function and a { id: score } map agree', () => {
    const map = { c1: 6.5, c2: 4, c3: 9, c4: 10 };
    const a = computeWeightedTotal(RUBRIC, map);
    const b = computeWeightedTotal(RUBRIC, (c) => map[c.id]);
    assert.ok(near(a, b), a + ' vs ' + b);
    assert.ok(near(a, (6.5 * .3 + 4 * .25 + 9 * .25 + 10 * .2) * 10));
});

check('unscored criteria count 0 and the denominator is the whole rubric', () => {
    // only c1 = 10 → 10/10 × .30 / 1.00 × 100 = 30, not 100
    assert.ok(near(computeWeightedTotal(RUBRIC, { c1: 10 }), 30));
    assert.ok(near(computeWeightedTotal(RUBRIC, { c1: 10, c2: null, c3: '', c4: undefined }), 30));
    // a half-scored file ranks below a fully scored mediocre one
    assert.ok(computeWeightedTotal(RUBRIC, { c1: 10, c2: 10 }) < computeWeightedTotal(RUBRIC, { c1: 6, c2: 6, c3: 6, c4: 6 }));
});

check('ranking: identical order to legacy Σ(score × weight) over 500 random score sets (ties included)', () => {
    let seed = 20260917;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const files = [];
    for (let i = 0; i < 500; i++) {
        const s = {}; RUBRIC.forEach(c => { s[c.id] = Math.round(rnd() * 100) / 10; }); // 0–10 in tenths, duplicates happen
        files.push({ i, s, v2: computeWeightedTotal(RUBRIC, s), old: legacy(RUBRIC, s) });
    }
    for (const f of files) assert.ok(near(f.v2, f.old * 10, 1e-9), 'file ' + f.i + ': ' + f.v2 + ' vs ' + f.old * 10);
    // Compare on values rounded to 1e-6: the two formulas sum the same products in different
    // scalings, so mathematically tied files can differ by ~1e-15 and would tie-break apart.
    const r6 = (x) => Math.round(x * 1e6);
    const byV2 = files.slice().sort((a, b) => r6(b.v2) - r6(a.v2) || a.i - b.i).map(f => f.i);
    const byOld = files.slice().sort((a, b) => r6(b.old * 10) - r6(a.old * 10) || a.i - b.i).map(f => f.i);
    assert.deepStrictEqual(byV2, byOld);
    // and every pairwise comparison agrees in sign (ties stay ties)
    for (let a = 0; a < 60; a++) for (let b = a + 1; b < 60; b++) {
        assert.strictEqual(Math.sign(r6(files[a].v2) - r6(files[b].v2)), Math.sign(r6(files[a].old * 10) - r6(files[b].old * 10)), `pair ${a},${b}`);
    }
});

check('weights: the new-criterion default (a fifth row at 1/5) keeps the total on 0–100', () => {
    const five = RUBRIC.concat([{ id: 'c5', name: 'English fluency', max_points: 10, weight: 0.2 }]); // Σw = 1.2 → "rebalance"
    const t = computeWeightedTotal(five, { c1: 10, c2: 10, c3: 10, c4: 10, c5: 10 });
    assert.ok(near(t, 100), 'full marks must still be 100, got ' + t);
    const half = computeWeightedTotal(five, { c1: 8, c2: 7, c3: 9, c4: 6 }); // c5 unscored → 0
    assert.ok(near(half, 76 / 1.2), 'got ' + half);
});

check('max_points: mixed scales normalise per criterion (5/5 counts like 10/10)', () => {
    const mixed = [{ id: 'a', max_points: 5, weight: .5 }, { id: 'b', max_points: 10, weight: .5 }];
    assert.ok(near(computeWeightedTotal(mixed, { a: 5, b: 10 }), 100));
    assert.ok(near(computeWeightedTotal(mixed, { a: 5, b: 0 }), 50));
    assert.ok(near(computeWeightedTotal(mixed, { a: 2.5, b: 5 }), 50));
});

check('edges: empty rubric → 0, all-zero weights → 0, missing max/weight fall back to 10 / 1', () => {
    assert.strictEqual(computeWeightedTotal([], { a: 10 }), 0);
    assert.strictEqual(computeWeightedTotal([{ id: 'a', max_points: 10, weight: 0 }], { a: 10 }), 0);
    assert.ok(near(computeWeightedTotal([{ id: 'a' }, { id: 'b' }], { a: 10, b: 5 }), 75));
    assert.ok(near(computeWeightedTotal([{ id: 'a', max_points: 'x', weight: 'y' }], { a: 5 }), 50));
});

const fails = results.filter(r => !r[1]).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
