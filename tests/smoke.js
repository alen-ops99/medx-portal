#!/usr/bin/env node
/**
 * MedX Production Smoke Test
 *
 * Hits the live Render endpoints and verifies critical paths still work.
 * Run before any invitation blast or major announcement:
 *
 *   node tests/smoke.js
 *
 * Override the target with env vars to test local or staging:
 *
 *   MEDX_BASE_URL=http://localhost:2011 MEDX_ADMIN_URL=http://localhost:2012 node tests/smoke.js
 *
 * Exits 1 if anything regresses. Hooks straight into CI later.
 *
 * The checks here are NON-MUTATING by design — they GET endpoints and POST
 * to validate-coupon, but never POST to register-invite (which would
 * leave audit rows in the production DB). To test the full register flow,
 * use a Playwright drive instead of this smoke test.
 */

const PROD = process.env.MEDX_BASE_URL || 'https://medx-user-portal.onrender.com';
const ADMIN = process.env.MEDX_ADMIN_URL || 'https://medx-admin-portal.onrender.com';

const tests = [];
let passed = 0, failed = 0;

const check = (name, fn) => tests.push({ name, fn });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const get = async (path, base = PROD) => fetch(base + path);
const post = async (path, body, base = PROD) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
});

// ───────────────────────── User portal — basic ─────────────────────────
check('user portal HTTP 200', async () => {
    const r = await get('/');
    assert(r.status === 200, `got ${r.status}`);
});

check('user portal HTML contains MEDX_DATES global (PR #1)', async () => {
    const t = await (await get('/')).text();
    assert(t.includes('window.MEDX_DATES'), 'MEDX_DATES global missing — pre-PR-#1 build?');
});

check('user portal supports path-style direct links (PR #4)', async () => {
    const t = await (await get('/')).text();
    assert(t.includes("window.location.pathname.match"), 'path-style direct-link handler missing — pre-PR-#4 build?');
});

// ───────────────────────── Security headers — PR #6 ─────────────────────────
check('HSTS header present (PR #6)', async () => {
    const v = (await get('/')).headers.get('strict-transport-security');
    assert(v && v.includes('max-age='), `HSTS missing/malformed: ${v}`);
});

check('CSP header sets frame-ancestors none', async () => {
    const v = (await get('/')).headers.get('content-security-policy');
    assert(v && v.includes("frame-ancestors 'none'"), 'CSP missing or weak');
});

check('CSP allows Stripe + jsdelivr + cdnjs', async () => {
    const v = (await get('/')).headers.get('content-security-policy');
    assert(v.includes('js.stripe.com'), 'Stripe not in CSP allowlist');
    assert(v.includes('cdn.jsdelivr.net'), 'jsdelivr not in CSP allowlist');
    assert(v.includes('cdnjs.cloudflare.com'), 'cdnjs not in CSP allowlist');
});

check('X-Frame-Options + X-Content-Type-Options present', async () => {
    const r = await get('/');
    assert(r.headers.get('x-frame-options'), 'X-Frame-Options missing');
    assert(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options missing/wrong');
});

// ───────────────────────── Service worker — PR #1 ─────────────────────────
check('SW v5 + bypasses /api/* (PR #1)', async () => {
    const t = await (await get('/sw.js')).text();
    assert(t.includes("medx-portal-v5"), 'SW cache version not v5 — pre-PR-#1?');
    assert(t.includes("url.pathname.startsWith('/api/')"), 'SW does not bypass /api/*');
});

// ───────────────────────── Plexus settings — PR #1 + #5 ─────────────────────────
check('Plexus settings returns expected schema (PRs #1, #5)', async () => {
    const d = await (await get('/api/plexus/settings')).json();
    assert(d.early_bird_deadline === '2026-09-30', `early_bird drift: ${d.early_bird_deadline}`);
    assert(d.abstract_deadline === '2026-10-15', `abstract drift: ${d.abstract_deadline}`);
    assert(d.conference_start_date === '2026-12-04', `start drift: ${d.conference_start_date}`);
    assert(d.conference_end_date === '2026-12-05', `end drift: ${d.conference_end_date}`);
    assert(d.price_student_early === 39, `student early drift: ${d.price_student_early}`);
    assert(d.price_professional_early === 99, `prof early drift: ${d.price_professional_early}`);
});

check('Plexus schedule returns dict shape', async () => {
    const d = await (await get('/api/plexus/schedule')).json();
    assert(d.conference?.id, 'conference missing');
    assert(Array.isArray(d.sessions), 'sessions not an array');
});

check('Plexus speakers endpoint returns array', async () => {
    const d = await (await get('/api/plexus/speakers')).json();
    assert(Array.isArray(d), 'speakers not an array');
});

// ───────────────────────── Promo codes — PR #10 + #2 ─────────────────────────
check('FORUM26 promo validates → 20 EUR fixed (PR #2 seed + PR #10 polyfill)', async () => {
    const d = await (await post('/api/invite/validate-coupon', { code: 'FORUM26', event_type: 'forum' })).json();
    assert(d.valid === true, `FORUM26 invalid: ${JSON.stringify(d)}`);
    assert(d.discount_type === 'fixed' && d.discount_value === 20, `discount drift: ${JSON.stringify(d)}`);
});

check('EARLYBIRD25 promo validates (Plexus)', async () => {
    const d = await (await post('/api/plexus/promo/validate', { code: 'EARLYBIRD25' })).json();
    assert(d.valid === true, `EARLYBIRD25 invalid: ${JSON.stringify(d)}`);
    assert(d.discount_value === 25, `EARLYBIRD25 drift: ${JSON.stringify(d)}`);
});

// ───────────────────────── Forum direct links — PR #4 ─────────────────────────
check('Forum direct-link path-style returns 200 (PR #4)', async () => {
    for (const slug of ['forum-2026-day1', 'forum-2026-day2', 'annual-forum-2026']) {
        const r = await get('/forum/events/' + slug);
        assert(r.status === 200, `${slug} returned ${r.status}`);
    }
});

// ───────────────────────── Admin portal ─────────────────────────
check('admin portal HSTS (PR #6)', async () => {
    const v = (await get('/', ADMIN)).headers.get('strict-transport-security');
    assert(v && v.includes('max-age='), `admin HSTS missing: ${v}`);
});

check('admin portal serves theme-fresh CSS (PR #3)', async () => {
    const t = await (await get('/', ADMIN)).text();
    assert(t.includes('theme-fresh'), 'admin theme-fresh missing — pre-PR-#3 build?');
});

// ───────────────────────── Debug-endpoint leak detector ─────────────────────────
// If anyone re-introduces a public /api/test-* or /api/debug-* endpoint, this fails.
check('no public /api/test-email leak', async () => {
    const r = await get('/api/test-email');
    assert(r.status === 404, `/api/test-email is still exposed (status ${r.status}) — debug endpoint left in production!`);
});

check('no public /api/debug-* endpoint exposing env vars', async () => {
    for (const p of ['/api/debug', '/api/debug/email', '/api/debug/env', '/api/test', '/api/test-stripe']) {
        const r = await get(p);
        assert(r.status === 404, `${p} returned ${r.status} — possible debug endpoint leak`);
    }
});

// ───────────────────────── Run ─────────────────────────
(async () => {
    const start = Date.now();
    console.log(`\n  MedX Production Smoke Test`);
    console.log(`  Target: ${PROD}`);
    console.log(`  Admin:  ${ADMIN}\n`);
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`  ✅  ${name}`);
            passed++;
        } catch (e) {
            console.log(`  ❌  ${name}`);
            console.log(`      → ${e.message}`);
            failed++;
        }
    }
    const ms = Date.now() - start;
    console.log(`\n  ${passed} passed, ${failed} failed (${ms}ms)\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
