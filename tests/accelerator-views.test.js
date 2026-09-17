/**
 * accelerator-views.test.js — the redesigned Accelerator Hub + Review Room views
 * (admin-portal/frontend-v2/js/views/accelerator.js, accelerator-review.js, _accel-criteria.js).
 *
 * Hermetic: the ES modules are imported into Node behind a minimal browser shim and a RECORDING
 * fetch that serves prod-shaped rows (the 2026 rubric: 4 criteria, max_points 10, weights
 * .30/.25/.25/.20; one accelerator_sites row + one accelerator_institutions row in the sites union).
 * Handlers are driven through the same delegated click/change listeners the browser uses. Asserts:
 *
 *   HUB   - institution-list rows render EDIT (no "FROM THE INSTITUTION LIST" read-only label)
 *         - SAVE on an institution row → PUT /api/accelerator/institutions/:id { name, city, available_spots }
 *         - REMOVE (two-click confirm) → PUT { is_active: 0 }; a site row still hits the sites CRUD
 *         - the criteria card shows MAX PTS + WEIGHT inputs, "Scale is 0–10" (derived), Σweight hint
 *         - ADD → POST with the prevailing max_points (10) and weight 1/(n+1); Σw 1.20 → "rebalance"
 *         - weight / max_points edits PUT the right field; junk input is rejected and reverted
 *   ROOM  - TOTAL is the weighted 0–100 share (8/7/9/6 → 76.0 "/ 100"); half-scored → 42.5
 *         - the ranking orders by that total; the CSV total header says so
 *         - a score above THAT criterion's max_points is rejected client-side; within → PUT
 *
 * Run: node tests/accelerator-views.test.js   (exit 0 = all passed)
 */
'use strict';
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const V2 = path.join(__dirname, '..', 'admin-portal/frontend-v2/js/views');
const results = [];
const check = (name, fn) => {
    try { fn(); results.push([name, true]); console.log('PASS | ' + name); }
    catch (e) { results.push([name, false]); console.log('FAIL | ' + name + ' | ' + String(e.message).slice(0, 400)); }
};

// ---------------------------------------------------------------- browser shim
const elStub = () => ({ style: {}, className: '', textContent: '', setAttribute() {}, appendChild() {}, remove() {}, focus() {}, click() {}, addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, classList: { add() {}, remove() {}, toggle() {} } });
globalThis.window = globalThis;
globalThis.document = { getElementById() { return null; }, createElement: elStub, head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, querySelector() { return null; } };
// a signed-in admin (legacy key names) so "my" score row and the Bearer header resolve like in the browser
const LS = { medx_token: 'test-token', medx_user: JSON.stringify({ id: 'u1', email: 'me@medx.hr', name: 'QA Admin', role: 'admin' }) };
globalThis.localStorage = { getItem(k) { return k in LS ? LS[k] : null; }, setItem(k, v) { LS[k] = String(v); }, removeItem(k) { delete LS[k]; } };
globalThis.location = { origin: 'http://localhost', hostname: 'localhost', pathname: '/', search: '', hash: '' };
globalThis.history = { pushState() {}, replaceState() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };

// ---------------------------------------------------------------- data (prod-shaped)
const crit = (id, name, weight, category, sort_order) => ({ id, year: 2026, name, name_hr: name, max_points: 10, weight, category, sort_order, is_active: 1 });
let CRITERIA = [
    crit('c1', 'Academic Excellence', 0.30, 'objective', 1), crit('c2', 'Research Potential', 0.25, 'objective', 2),
    crit('c3', 'Motivation & Fit', 0.25, 'subjective', 3), crit('c4', 'Leadership & Impact', 0.20, 'subjective', 4)
];
let SITES = [
    { id: 's1', institution: 'Mayo Clinic', city: 'Rochester', country: 'USA', lab_or_clinic: 'Sleep Lab', mentor_line: null, spots: 2, year: 2026, active: 1, source: 'site' },
    { id: 'i1', institution: 'Harvard Medical School', city: 'Boston', country: null, lab_or_clinic: null, mentor_line: null, spots: 5, year: null, active: 1, source: 'institution' }
];
const APPS = [
    { id: 'a1', first_name: 'Iva', last_name: 'Kovačić', email: 'iva@example.com', current_institution: 'University of Zagreb', status: 'submitted', selected_institution: 'i1' },
    { id: 'a2', first_name: 'Marko', last_name: 'Barić', email: 'marko@example.com', current_institution: 'University of Split', status: 'under_review', selected_institution: 'i1' }
];
const SCORES = [
    { application_id: 'a1', criterion_id: 'c1', reviewer_email: 'me@medx.hr', score: 8 }, { application_id: 'a1', criterion_id: 'c2', reviewer_email: 'me@medx.hr', score: 7 },
    { application_id: 'a1', criterion_id: 'c3', reviewer_email: 'me@medx.hr', score: 9 }, { application_id: 'a1', criterion_id: 'c4', reviewer_email: 'me@medx.hr', score: 6 },
    { application_id: 'a2', criterion_id: 'c1', reviewer_email: 'me@medx.hr', score: 10 }, { application_id: 'a2', criterion_id: 'c2', reviewer_email: 'me@medx.hr', score: 5 }
];
const ROUTES = () => ({
    'GET /api/accelerator/program': { id: 'p1', year: 2026 },
    'GET /api/v2/accelerator-review/intake': { opens_at: '2026-11-01T00:00:00.000Z', closes_at: null, state: 'before', cycle: '2026' },
    'GET /api/admin/accelerator-sites': SITES,
    'GET /api/v2/accelerator-review/alumni': { alumni: [], count: 0, years: null },
    'GET /api/v2/accelerator-review/notify-count': { count: 3 },
    'GET /api/accelerator/years/2026/applications': APPS,
    'GET /api/accelerator/years/2026/criteria': CRITERIA,
    'GET /api/accelerator/years/2026/interviewers': [],
    'GET /api/v2/accelerator-review/scores?year=2026': { scores: SCORES, reviewer: 'me@medx.hr' },
    'GET /api/v2/accelerator-review/interview-invites?year=2026': { invites: [] },
    'GET /api/accelerator/institutions': [{ id: 'i1', name: 'Harvard Medical School' }]
});

// ---------------------------------------------------------------- recording fetch
const calls = [];
globalThis.fetch = async (url, init) => {
    const p = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: p, body });
    const key = method + ' ' + p;
    const canned = ROUTES()[key];
    const reply = (status, data) => ({ ok: status < 400, status, statusText: '', text: async () => JSON.stringify(data), headers: { get() { return null; } } });
    if (canned !== undefined) return reply(200, canned);
    if (method !== 'GET') return reply(200, { success: true, id: 'new-' + calls.length });
    return reply(404, { error: 'no canned route ' + key });
};
const writes = () => calls.filter(c => c.method !== 'GET');
const tick = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// ---------------------------------------------------------------- fake root: delegated listeners + data-role fields
function makeRoot() {
    const listeners = {};
    const fields = {};
    const root = {
        innerHTML: '', fields,
        addEventListener(t, fn) { listeners[t] = fn; },
        removeEventListener(t) { delete listeners[t]; },
        contains() { return true; },
        querySelector(sel) { const m = /\[data-role="([^"]+)"\]/.exec(sel); return m ? (fields[m[1]] || (fields[m[1]] = { value: '', focus() {} })) : null; },
        set(role, value) { fields[role] = { value, focus() {} }; },
        async click(act, dataset = {}) {
            const el = { dataset: { act, ...dataset }, getAttribute() { return null; } };
            listeners.click({ target: { closest: (s) => (s === '[data-act]' ? el : null), type: undefined }, preventDefault() {} });
            await tick();
        },
        async change(kind, dataset, value) {
            const el = { dataset: { change: kind, ...dataset }, value };
            el.closest = (s) => (s === '[data-change]' ? el : null);
            await listeners.change({ target: el });
            await tick();
            return el;
        }
    };
    return root;
}

(async () => {
    // app.js restores the session at boot — do the same so session.user.email is the reviewer
    const { session } = await import(pathToFileURL(path.join(V2, '..', 'state.js')).href);
    session.restore();
    assert.strictEqual(session.user && session.user.email, 'me@medx.hr', 'shim session restored');

    // ============================== HUB ==============================
    const hub = (await import(pathToFileURL(path.join(V2, 'accelerator.js')).href)).default;
    const H = makeRoot();
    await hub.render(H, { params: {}, query: {} });
    let html = H.innerHTML;

    check('hub renders with the institution row editable (EDIT, no read-only label)', () => {
        assert.ok(!html.includes('FROM THE INSTITUTION LIST'));
        assert.match(html, /data-row="i1" data-source="institution"[\s\S]*?data-act="instEdit" data-id="i1"/);
        assert.match(html, /data-row="s1" data-source="site"[\s\S]*?data-act="instEdit" data-id="s1"/);
    });
    check('hub criteria card: MAX PTS + WEIGHT inputs, derived scale, balanced weights', () => {
        assert.ok(html.includes('data-change="critMax"') && html.includes('data-change="critWeight"'));
        assert.ok(html.includes('Scale is 0–10'), 'scale text from max_points');
        assert.ok(!html.includes('0–5'), 'no hard-coded 0–5 anywhere');
        assert.ok(html.includes('WEIGHTS SUM TO 1.00'), 'Σweight hint');
        assert.match(html, /data-change="critWeight" data-id="c1"[\s\S]*?/);
        assert.match(html, /value="0\.3" data-change="critWeight" data-id="c1"/);
    });

    // --- institution row: EDIT → SAVE ---
    await H.click('instEdit', { id: 'i1' });
    html = H.innerHTML;
    check('hub: EDIT on the institution row opens the inline editor with a City placeholder', () => {
        assert.ok(html.includes('data-role="eName"') && html.includes('placeholder="City"'), 'editor + City placeholder');
        assert.match(html, /data-act="instSave" data-id="i1"/);
    });
    H.set('eName', 'Harvard Medical School'); H.set('ePlace', 'Boston, MA'); H.set('eSpots', '3');
    calls.length = 0;
    await H.click('instSave', { id: 'i1' });
    check('hub: SAVE on the institution row → PUT /api/accelerator/institutions/i1 { name, city, available_spots } + refetch', () => {
        const w = writes();
        assert.strictEqual(w.length, 1, JSON.stringify(w));
        assert.strictEqual(w[0].method, 'PUT'); assert.strictEqual(w[0].path, '/api/accelerator/institutions/i1');
        assert.deepStrictEqual(w[0].body, { name: 'Harvard Medical School', city: 'Boston, MA', available_spots: 3 });
        assert.ok(calls.some(c => c.method === 'GET' && c.path === '/api/admin/accelerator-sites'), 'sites refetched');
        assert.ok(!H.innerHTML.includes('data-role="eName"'), 'editor closed');
    });

    // --- site row still uses the sites CRUD ---
    await H.click('instEdit', { id: 's1' });
    H.set('eName', 'Mayo Clinic'); H.set('ePlace', 'Rochester · Sleep Lab'); H.set('eSpots', '');
    calls.length = 0;
    await H.click('instSave', { id: 's1' });
    check('hub: SAVE on a curated site row still → PUT /api/admin/accelerator-sites/s1', () => {
        const w = writes();
        assert.strictEqual(w.length, 1); assert.strictEqual(w[0].path, '/api/admin/accelerator-sites/s1');
        assert.deepStrictEqual(w[0].body, { institution: 'Mayo Clinic', city: 'Rochester', lab_or_clinic: 'Sleep Lab', spots: null });
    });

    // --- institution row: REMOVE (two-click) → is_active 0 ---
    await H.click('instEdit', { id: 'i1' });
    calls.length = 0;
    await H.click('instRemove', { id: 'i1' });
    check('hub: first REMOVE click only arms the confirm (SURE? REMOVE), no write', () => {
        assert.strictEqual(writes().length, 0);
        assert.ok(H.innerHTML.includes('SURE? REMOVE'));
    });
    await H.click('instRemove', { id: 'i1' });
    check('hub: confirmed REMOVE on the institution row → PUT { is_active: 0 } (soft) + refetch', () => {
        const w = writes();
        assert.strictEqual(w.length, 1, JSON.stringify(w));
        assert.strictEqual(w[0].method, 'PUT'); assert.strictEqual(w[0].path, '/api/accelerator/institutions/i1');
        assert.deepStrictEqual(w[0].body, { is_active: 0 });
        assert.ok(calls.some(c => c.method === 'GET' && c.path === '/api/admin/accelerator-sites'), 'sites refetched (the GET filters is_active)');
    });

    // --- criteria: ADD with the prevailing defaults ---
    H.set('critDraft', 'English fluency');
    calls.length = 0;
    const fiveCriteria = CRITERIA.concat([crit('c5', 'English fluency', 0.2, 'objective', 5)]);
    const origCriteria = CRITERIA; CRITERIA = fiveCriteria;     // the refetch after POST returns 5 rows
    await H.click('addCrit');
    html = H.innerHTML;
    check('hub: ADD criterion → POST with max_points = prevailing 10 and weight = 1/(n+1) = 0.2', () => {
        const w = writes();
        assert.strictEqual(w.length, 1, JSON.stringify(w));
        assert.strictEqual(w[0].method, 'POST'); assert.strictEqual(w[0].path, '/api/accelerator/years/2026/criteria');
        assert.deepStrictEqual(w[0].body, { name: 'English fluency', max_points: 10, weight: 0.2, category: 'objective' });
    });
    check('hub: with five weights summing to 1.20 the card says "rebalance"', () => {
        assert.ok(html.includes('WEIGHTS NOW SUM TO 1.20 — REBALANCE'), html.match(/WEIGHTS[^<]*/) && html.match(/WEIGHTS[^<]*/)[0]);
        assert.match(html, /data-change="critWeight" data-id="c5"/);
    });

    // --- criteria: weight + max edits ---
    calls.length = 0;
    await H.change('critWeight', { id: 'c1' }, '0,1');
    check('hub: weight edit (comma decimal) → PUT /api/accelerator/criteria/c1 { weight: 0.1 }', () => {
        const w = writes();
        assert.strictEqual(w.length, 1, JSON.stringify(w));
        assert.strictEqual(w[0].path, '/api/accelerator/criteria/c1'); assert.deepStrictEqual(w[0].body, { weight: 0.1 });
    });
    calls.length = 0;
    const bad = await H.change('critWeight', { id: 'c1' }, '-1');
    check('hub: a non-positive weight is rejected (no PUT) and the field reverts', () => {
        assert.strictEqual(writes().length, 0);
        assert.strictEqual(bad.value, '0.1');
    });
    calls.length = 0;
    await H.change('critMax', { id: 'c1' }, '5');
    html = H.innerHTML;
    check('hub: max edit → PUT { max_points: 5 } and the scale line becomes mixed', () => {
        const w = writes();
        assert.strictEqual(w.length, 1, JSON.stringify(w));
        assert.deepStrictEqual(w[0].body, { max_points: 5 });
        assert.ok(html.includes('Scale is 0–5 to 0–10 by criterion'), html.match(/Scale is[^<]*/)[0]);
    });
    calls.length = 0;
    const badMax = await H.change('critMax', { id: 'c1' }, '0');
    check('hub: max_points 0 is rejected (no PUT) and the field reverts to 5', () => {
        assert.strictEqual(writes().length, 0);
        assert.strictEqual(String(badMax.value), '5');
    });
    calls.length = 0;
    await H.change('critRename', { id: 'c1' }, 'Academic record');
    check('hub: rename still → PUT { name }', () => {
        const w = writes(); assert.strictEqual(w.length, 1); assert.deepStrictEqual(w[0].body, { name: 'Academic record' });
    });
    hub.destroy();
    CRITERIA = origCriteria;

    // ============================== REVIEW ROOM ==============================
    const room = (await import(pathToFileURL(path.join(V2, 'accelerator-review.js')).href)).default;
    const R = makeRoot();
    await room.render(R, { params: {}, query: {} });
    html = R.innerHTML;
    check('room: TOTAL is the weighted 0–100 share — 8/7/9/6 → 76.0 "/ 100"', () => {
        assert.match(html, /data-role="total-a1"[^>]*>76\.0</);
        assert.ok(html.includes('>/ 100<'));
    });
    check('room: half-scored a2 → (10/10×.30 + 5/10×.25)/1.00 × 100 = 42.5 (unscored count 0)', () => {
        assert.match(html, /data-role="total-a2"[^>]*>42\.5</);
    });
    check('room: ranking orders by the weighted total (a1 above a2), column labelled TOTAL /100', () => {
        const rk = html.slice(html.indexOf('data-block="ranking"'));
        assert.ok(rk.indexOf('Iva Kovačić') < rk.indexOf('Marko Barić'));
        assert.ok(rk.includes('TOTAL /100'));
    });
    check('room: score cells carry the criterion cap (0–10) and no 0–5 remains', () => {
        assert.ok(html.includes('title="0–10 · team avg 8 ·'), 'cell title');
        assert.ok(html.includes('data-max="10"'));
        assert.ok(!html.includes('0–5'));
    });
    check('room: SCORING CRITERIA card is the shared body (MAX PTS + WEIGHT)', () => {
        assert.ok(html.includes('SCORING CRITERIA') && html.includes('data-change="critMax"') && html.includes('MAX PTS'));
    });

    calls.length = 0;
    const over = await R.change('score', { app: 'a1', crit: 'c1', max: '10' }, '11');
    check('room: a score above the criterion max_points is rejected client-side and reverts to mine (8)', () => {
        assert.strictEqual(writes().length, 0);
        assert.strictEqual(String(over.value), '8');
    });
    calls.length = 0;
    await R.change('score', { app: 'a1', crit: 'c1', max: '10' }, '9.5');
    check('room: a score within the cap → PUT /api/v2/accelerator-review/scores + legacy mirror, total re-rendered', () => {
        const w = writes();
        assert.ok(w.some(c => c.method === 'PUT' && c.path === '/api/v2/accelerator-review/scores' && c.body.score === 9.5 && c.body.criterion_id === 'c1'), JSON.stringify(w));
        assert.ok(w.some(c => c.method === 'POST' && c.path === '/api/accelerator/applications/a1/evaluate-batch'), 'legacy mirror');
        // 9.5/10×.3 + .7×.25 + .9×.25 + .6×.2 = .285+.175+.225+.12 = .805 → 80.5
        assert.match(R.innerHTML, /data-role="total-a1"[^>]*>80\.5</);
    });
    // shrink c1's max_points to 5 → 7 is now over the cap
    CRITERIA[0].max_points = 5;
    room.destroy();
    const R2 = makeRoot();
    await room.render(R2, { params: {}, query: {} });
    calls.length = 0;
    const over5 = await R2.change('score', { app: 'a2', crit: 'c1', max: '5' }, '7');
    check('room: after max_points drops to 5, a 7 is rejected for that criterion only', () => {
        assert.strictEqual(writes().length, 0);
        assert.ok(R2.innerHTML.includes('title="0–5 · team avg 10 ·'), 'c1 cell now says 0–5');
        assert.ok(R2.innerHTML.includes('title="0–10 · team avg 5 ·'), 'c2 cell still 0–10');
        assert.strictEqual(String(over5.value), '10');
    });
    // CSV export: capture the Blob the handler builds (the <a>.click() is a no-op in the shim)
    let csv = null;
    const RealBlob = globalThis.Blob;
    globalThis.Blob = class extends RealBlob { constructor(parts, o) { super(parts, o); csv = parts.join(''); } };
    await R2.click('export');
    globalThis.Blob = RealBlob;
    check('room: CSV export — per-criterion headers carry scale + weight, the total column is the weighted 0–100', () => {
        assert.ok(csv, 'a Blob was built');
        const [header, first] = csv.split('\n');
        assert.ok(header.includes('"Academic Excellence (0–5, w 0.3)"'), header);
        assert.ok(header.includes('"Research Potential (0–10, w 0.25)"'), header);
        assert.ok(header.includes('"Weighted total (0–100)"'), header);
        // with c1 on 0–5: a1 = (8/5×.3 + .7×.25 + .9×.25 + .6×.2) = 1.00 → 100.00 ranks first; a2 = (10/5×.3 + .5×.25) = 72.50
        assert.ok(first.startsWith('"1","Iva Kovačić"'), first);
        assert.ok(first.includes('"100.00"'), first);
        assert.ok(csv.split('\n')[2].includes('"72.50"'), csv.split('\n')[2]);
    });
    room.destroy();
    CRITERIA[0].max_points = 10;

    const fails = results.filter(r => !r[1]).length;
    console.log(`\n${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
