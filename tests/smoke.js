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

// CSP must permit inline event handlers — the codebase has 1,400+ live `onclick=` attrs.
// `script-src-attr 'none'` (helmet's default) silently blocks every one of them.
// This is a regression catcher: if helmet upgrades or someone tightens the policy,
// the smoke test fails before users hit dead buttons.
check('CSP script-src-attr permits inline event handlers (PR #6 fix)', async () => {
    for (const target of [PROD, ADMIN]) {
        const v = (await get('/', target)).headers.get('content-security-policy') || '';
        const m = v.match(/script-src-attr\s+([^;]+)/);
        if (!m) continue; // unset → falls back to script-src which already allows 'unsafe-inline'
        assert(!/'none'/.test(m[1]), `${target}: script-src-attr is 'none' — every inline onclick= is blocked. Add "script-src-attr": ["'unsafe-inline'"] to helmet config.`);
    }
});

check('X-Frame-Options + X-Content-Type-Options present', async () => {
    const r = await get('/');
    assert(r.headers.get('x-frame-options'), 'X-Frame-Options missing');
    assert(r.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options missing/wrong');
});

// ───────────────────────── Service worker — PR #1 ─────────────────────────
check('SW is versioned + bypasses /api/* (PR #1)', async () => {
    const t = await (await get('/sw.js')).text();
    // Match any versioned cache name (medx-portal-vN) rather than pinning a specific
    // number — the SW version legitimately bumps when the app shell changes.
    assert(/medx-portal-v\d+/.test(t), 'SW cache version name missing — pre-PR-#1?');
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

// ───────────────────────── Admin observability ─────────────────────────
check('GET /api/admin/errors/recent is registered (auth-gated in prod)', async () => {
    // Production (no NODE_ENV=development): returns 401 without a token.
    // Local dev: dev fallback auto-authenticates as admin → returns 200 with errors array.
    // Either way means the endpoint EXISTS. 404 would mean we forgot to register it.
    const r = await get('/api/admin/errors/recent');
    assert(r.status !== 404, `endpoint missing — got 404 (route not registered?)`);
    assert([200, 401, 403].includes(r.status), `unexpected status ${r.status}`);
});

// ───────────────────────── Forgot-password flow ─────────────────────────
check('POST /api/auth/forgot-password accepts email + returns generic success', async () => {
    // Generic success for non-existent email (no info leak)
    const r = await post('/api/auth/forgot-password', { email: 'definitely-not-a-real-user-2026@example.com' });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const d = await r.json();
    assert(d.success === true, 'expected success:true');
    // Should not reveal whether email exists
    assert(!d.message?.toLowerCase().includes('not found'), 'leaked: server confirmed email does not exist');
});

check('GET /reset-password/<bad-token> shows expired-link page', async () => {
    const r = await get('/reset-password/zzzz-this-token-does-not-exist');
    assert(r.status === 200, `expected 200 (server-rendered error page), got ${r.status}`);
    const t = await r.text();
    assert(/Link Invalid|expired/i.test(t), 'expected "Link Invalid" or "expired" in error page');
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
    // Render Free-tier cold-starts can yield half-buffered responses on the first hit
    // (manifests as "Unexpected end of JSON input"). One retry after a short wait
    // separates real regressions from cold-start flakes.
    const runOnce = async (fn) => {
        try { await fn(); return null; } catch (e) { return e; }
    };
    for (const { name, fn } of tests) {
        let err = await runOnce(fn);
        if (err) {
            await new Promise(r => setTimeout(r, 1500));
            err = await runOnce(fn);
        }
        if (!err) {
            console.log(`  ✅  ${name}`);
            passed++;
        } else {
            console.log(`  ❌  ${name}`);
            console.log(`      → ${err.message}`);
            failed++;
        }
    }
    const ms = Date.now() - start;
    console.log(`\n  ${passed} passed, ${failed} failed (${ms}ms)\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
