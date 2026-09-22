/**
 * tests/live-app.test.js — PLEXUS WEEK LIVE, phase 2: the guest event app in the member SPA
 * (user-portal/frontend-v2/js/views/live.js) and its entry points (ticket pages · Boston me page ·
 * ticket emails · the admin speaker link).
 *
 * Hermetic part (always runs, no network): the ticket page and every email of the family carry the
 * live link when given one · liveAppBase resolves MEMBER_PORTAL_URL → PUBLIC_BASE_URL → RENDER_EXTERNAL_URL
 * → fallback · the Boston personal page (boston.js mounted on a scratch sqlite, S3/email stubbed) shows
 * OPEN THE EVENT APP with the row's bridges token · server.js / gala-paylink.js pass liveUrl at every
 * call site · the admin GET /api/live/speaker-link/:speakerId (program-ops on an in-memory libsql DB)
 * guards + mints a verifiable 'speaker' token · the SPA: routes (public /live/:token?, auth /app/live),
 * the router regex admits a dotted token, sw.js precaches the view and never lists /live as a server
 * path, config/_redirects/dev-server let /live reach the shell, the view's contracts (literal /api/live
 * paths, 60 s poll, localStorage keys, the copy the brief asked for), the PLEXUS WEEK LIVE / EVENT APP
 * links on the Plexus and Bridges pages.
 *
 * Playwright smoke (opt-in):
 *   node tests/live-app.test.js --smoke=local     boots user-portal/backend on a COPY of deploy/staging/seed.db
 *                                                (+ one Boston registration) and frontend-v2/dev-server.js, then
 *                                                runs tests/live-app-smoke.py against them. Hermetic (localhost only).
 *   LIVE_SMOKE_BASE=https://medx-member-portal-v2.netlify.app LIVE_SMOKE_API=https://medx-staging.onrender.com \
 *   LIVE_SMOKE_TOKEN=<sig>.bridges.<id> node tests/live-app.test.js --smoke=staging
 *                                                the same script against the deployed app (toggles one session and
 *                                                toggles it back — the row is left as found).
 * Run:  node tests/live-app.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FE = path.join(ROOT, 'user-portal/frontend-v2');
process.env.NODE_ENV = 'test';
for (const k of ['TURSO_DATABASE_URL', 'RENDER_EXTERNAL_URL', 'PUBLIC_BASE_URL', 'MEMBER_PORTAL_URL', 'USER_PORTAL_URL', 'BREVO_API_KEY', 'GOOGLE_SHEETS_WEBHOOK', 'BB_SHEET_ID', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'BB_PROGRAM_PDF_KEY', 'GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SA_KEY']) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_')) delete process.env[k];
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const smokeArg = (process.argv.find(a => a.startsWith('--smoke')) || '').split('=')[1] || (process.argv.includes('--smoke') ? 'local' : null);

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}
const read = p => fs.readFileSync(p, 'utf8');

const core = require(path.join(ROOT, 'shared/live-program'));
const pt = require(path.join(ROOT, 'user-portal/backend/plexus-ticket.js'));
const SECRET = 'live-app-test-secret';
const W = { apple: 'https://x/api/plexus/pass/tok.pkpass', google: 'https://x/api/plexus/wallet/tok' };
const QR = 'https://x/qr/88ee6223-f4c6-4296-88c0-05933eb5d4d5.png';

// stub express in the house shape (tests/live-program.test.js)
function stubApp() {
    const routes = {};
    const reg = m => (p, ...h) => { routes[m + ' ' + p] = h; };
    return {
        get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), delete: reg('DELETE'), routes,
        async call(method, p, opts = {}) {
            const chain = routes[method + ' ' + p];
            if (!chain) throw new Error('route not mounted: ' + method + ' ' + p);
            const req = { user: opts.user === undefined ? null : opts.user, params: opts.params || {}, query: opts.query || {}, body: opts.body || {}, headers: {}, ip: '10.0.0.1', path: p, protocol: 'https', get: () => 'member.test' };
            const r = { status: 200, body: undefined, headers: {} };
            let ended = false;
            const res = {
                status(c) { r.status = c; return res; }, json(o) { r.body = o; ended = true; return res; }, send(x) { r.body = x; ended = true; return res; },
                set(k, v) { r.headers[String(k).toLowerCase()] = v; return res; }, setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; },
                redirect(c, u) { r.status = c; r.headers.location = u; ended = true; }, get headersSent() { return ended; }
            };
            for (let i = 0; i < chain.length; i++) { if (ended) break; let adv = false; await chain[i](req, res, () => { adv = true; }); if (!adv && i < chain.length - 1) break; }
            return r;
        }
    };
}

(async () => {
    console.log('live-app.test.js — Plexus Week Live, phase 2 (hermetic' + (smokeArg ? ' + Playwright smoke: ' + smokeArg : '') + ')\n');

    // ------------------------------------------------------------ ticket page + email family
    await t('the ticket page carries the one primary OPEN THE EVENT APP button when given a live URL, and nothing of it otherwise', () => {
        const live = 'https://member.test/live/' + core.liveToken(SECRET, 'ca', 'ca-1');
        const base = { state: 'ticket', headline: 'Plexus Week 2026 — you are <i>in</i>.', sub: 'x', fullName: 'Ana Franceschi', legs: ['conference', 'gala'], party: { conference: 1, gala: 2 }, seats: 2, invoice: 'GALA26-0041', ticketCode: '88EE6223', qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics?legs=conference%2Cgala' };
        const html = pt.ticketPageHtml(Object.assign({}, base, { liveUrl: live }));
        assert.ok(html.includes(`href="${live}"`), 'the link is the live URL');
        assert.ok(/class="live"[^>]*>Open the event app/.test(html), 'the button says Open the event app');
        assert.ok(html.indexOf('Open the event app') < html.indexOf('Your ticket for the door'), 'it sits above the QR card (seen without scrolling)');
        assert.ok(html.includes('no login, this link is yours'), 'the one-line explanation');
        const without = pt.ticketPageHtml(base);
        assert.ok(!without.includes('Open the event app') && !without.includes('/live/'), 'no link → no button, no dangling href');
    });

    await t('every email of the family prints "Your event app: <url>" under the wallet buttons — and only when a URL is given', () => {
        const live = 'https://member.test/live/' + core.liveToken(SECRET, 'ca', 'ca-1');
        const kinds = {
            combined: pt.ticketEmail('combined', { firstName: 'Ana', fullName: 'Ana Franceschi', legs: ['conference', 'gala'], seats: 2, amount: 300, invoice: 'GALA26-0041', qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics', liveUrl: live }),
            'gala-guest': pt.ticketEmail('gala-guest', { firstName: 'Emeric', fullName: 'Emeric du Mas', legs: ['gala'], guestOf: 'Ana Franceschi', qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics', ticketCode: '88EE6223', liveUrl: live }),
            gala: pt.ticketEmail('gala', { firstName: 'Lord', fullName: 'Lord Smith', legs: ['gala'], seats: 1, amount: 0, qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics', ticketCode: 'ABCDEF12', liveUrl: live }),
            free: pt.ticketEmail('free', { firstName: 'Iva', fullName: 'Iva Free', legs: ['conference', 'bridges'], qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics', ticketCode: '44444444', liveUrl: live })
        };
        for (const [k, html] of Object.entries(kinds)) {
            assert.ok(html.includes('Your event app:'), k + ': the line');
            assert.ok(html.includes(`href="${live}"`), k + ': the link');
            assert.ok(html.indexOf('ADD TO CALENDAR') < html.indexOf('Your event app:'), k + ': under the wallet buttons');
        }
        const none = pt.ticketEmail('free', { firstName: 'Iva', fullName: 'Iva Free', legs: ['conference'], qrPngUrl: QR, wallet: W, calendarUrl: 'https://x/plexus.ics' });
        assert.ok(!none.includes('Your event app'), 'no URL → no line');
    });

    await t('liveAppBase: MEMBER_PORTAL_URL → PUBLIC_BASE_URL → RENDER_EXTERNAL_URL → the fallback; liveAppUrl mints a verifiable token on that host', () => {
        const env = process.env;
        delete env.MEMBER_PORTAL_URL; delete env.PUBLIC_BASE_URL; delete env.RENDER_EXTERNAL_URL;
        assert.strictEqual(pt.liveAppBase('https://fallback.test/'), 'https://fallback.test');
        env.RENDER_EXTERNAL_URL = 'https://member-render.test/'; assert.strictEqual(pt.liveAppBase('https://fallback.test'), 'https://member-render.test');
        env.PUBLIC_BASE_URL = 'https://medx-member-portal-v2.netlify.app'; assert.strictEqual(pt.liveAppBase(), 'https://medx-member-portal-v2.netlify.app', 'staging: the launcher hands the member backend the Netlify site as PUBLIC_BASE_URL');
        env.MEMBER_PORTAL_URL = 'https://portal.medx.hr'; assert.strictEqual(pt.liveAppBase(), 'https://portal.medx.hr');
        const url = pt.liveAppUrl(SECRET, 'gala', 'gala-77');
        assert.ok(url.startsWith('https://portal.medx.hr/live/'), url);
        const tok = url.split('/live/')[1];
        assert.deepStrictEqual(core.verifyLiveToken(SECRET, tok), { kind: 'gala', id: 'gala-77' });
        assert.strictEqual(core.verifyLiveToken('other-secret', tok), null, 'another secret never verifies');
        delete env.MEMBER_PORTAL_URL; delete env.PUBLIC_BASE_URL; delete env.RENDER_EXTERNAL_URL;
    });

    // ------------------------------------------------------------ Boston me page
    await t('the Boston personal page shows OPEN THE EVENT APP → the row\'s bridges live link, under the finish step and above the ticket', async () => {
        const { DatabaseSync } = require('node:sqlite');
        const raw = new DatabaseSync(':memory:');
        raw.exec(`CREATE TABLE bridges_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, venue_name TEXT, venue_address TEXT, event_date TEXT NOT NULL, event_time TEXT, end_time TEXT, description TEXT, capacity INTEGER DEFAULT 50, registration_open INTEGER DEFAULT 1, registration_deadline TEXT, status TEXT DEFAULT 'upcoming', contact_email TEXT, contact_phone TEXT, notes TEXT, price REAL DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, is_published INTEGER DEFAULT 0, slug TEXT)`);
        raw.exec(`CREATE TABLE bridges_registrations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, institution TEXT, position TEXT, dietary_requirements TEXT, special_requests TEXT, status TEXT DEFAULT 'registered', payment_status TEXT DEFAULT 'n/a', amount_paid REAL, confirmation_sent INTEGER DEFAULT 0, reminder_sent INTEGER DEFAULT 0, checked_in INTEGER DEFAULT 0, checked_in_at TEXT, notes TEXT, registered_at TEXT DEFAULT CURRENT_TIMESTAMP, user_id TEXT, qr_code TEXT, custom_answers TEXT)`);
        const query = {
            run: (sql, params = []) => { params.length ? raw.prepare(sql).run(...params) : raw.exec(sql); },
            get: (sql, params = []) => { const r = raw.prepare(sql).get(...params); return r === undefined ? null : r; },
            all: (sql, params = []) => raw.prepare(sql).all(...params)
        };
        process.env.BB_S3_BUCKET = 'medx-bb-test'; process.env.BB_S3_REGION = 'us-east-1'; process.env.BB_S3_KEY = 'AKIATESTTESTTESTTEST'; process.env.BB_S3_SECRET = 'test-secret-not-real';
        const wallet = require(path.join(ROOT, 'shared/wallet.js'));
        wallet.ensureEventClass = async () => ({ created: false }); wallet.ensureEventObject = async () => ({ created: false });
        const mountBoston = require(path.join(ROOT, 'user-portal/backend/boston.js'));
        const routes = {};
        const app = { get: (p, ...h) => { routes['GET ' + p] = h[h.length - 1]; }, post: (p, ...h) => { routes['POST ' + p] = h[h.length - 1]; } };
        process.env.PUBLIC_BASE_URL = 'https://medx-member-portal-v2.netlify.app';   // what the staging launcher sets
        mountBoston(app, { query, saveDb: () => {}, sendEmail: async () => ({ success: true }), flushDb: () => {}, JWT_SECRET: SECRET });
        const ID = 'f485dc4d-cbc1-4caa-a816-2bb26c8234a4';
        query.run(`INSERT INTO bridges_events (id, name, city, venue_name, event_date, event_time, end_time, status, slug) VALUES ('bb-boston-2026-09-21', 'Building Bridges in Biomedicine — Boston', 'Boston', 'Waterhouse Room, Gordon Hall', '2026-09-21', '18:00', '21:00', 'upcoming', 'boston')`);
        query.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, position, status) VALUES (?, 'bb-boston-2026-09-21', 'Alen', 'Juginović', 'juginovic.alen@gmail.com', 'Harvard Medical School', 'Postdoctoral fellow', 'registered')`, [ID]);
        const meToken = crypto.createHmac('sha256', SECRET).update('boston:me:' + ID).digest('hex').slice(0, 32) + '.' + ID;
        const r = { status: 200, body: '', headers: {} };
        const res = { status(c) { r.status = c; return res; }, send(x) { r.body = x; return res; }, json(o) { r.body = JSON.stringify(o); return res; }, set() { return res; }, setHeader() {}, redirect() {} };
        await routes['GET /boston/me/:token']({ params: { token: meToken }, query: {}, body: {}, get: () => '' }, res);
        delete process.env.PUBLIC_BASE_URL;
        assert.strictEqual(r.status, 200);
        const expected = 'https://medx-member-portal-v2.netlify.app/live/' + core.liveToken(SECRET, 'bridges', ID);
        assert.ok(r.body.includes(`href="${expected}"`), 'the bridges live link on the member SPA host');
        assert.ok(/id="live_go"[^>]*>Open the event app/.test(r.body), 'the button');
        const i = s => r.body.indexOf(s);
        assert.ok(i('Finish') > 0 && i('Open the event app') > i('id="finishcard"') && i('Open the event app') < i('Your ticket for the door'), 'placed under the finish step, above the ticket');
        assert.deepStrictEqual(core.verifyLiveToken(SECRET, expected.split('/live/')[1]), { kind: 'bridges', id: ID });
    });

    // ------------------------------------------------------------ server.js / gala-paylink.js wiring
    await t('server.js: both ticket pages and every ticket email call site pass the live link; gala-paylink threads it through both builders', () => {
        const srv = read(path.join(ROOT, 'user-portal/backend/server.js'));
        const gp = read(path.join(ROOT, 'user-portal/backend/gala-paylink.js'));
        const galaPage = srv.slice(srv.indexOf("app.get('/gala/ticket/:sig/:id'"), srv.indexOf("app.get('/plexus/ticket/:sig/:id'"));
        const plexusPage = srv.slice(srv.indexOf("app.get('/plexus/ticket/:sig/:id'"), srv.indexOf("app.get('/plexus.ics'"));
        assert.ok(/liveUrl: v\.paid \? plexusTicket\.liveAppUrl\(JWT_SECRET, 'gala', reg\.id/.test(galaPage), '/gala/ticket → kind gala (only once paid)');
        assert.ok(/liveUrl: plexusTicket\.liveAppUrl\(JWT_SECRET, 'ca', ca\.id/.test(plexusPage), '/plexus/ticket → kind ca');
        assert.ok((srv.match(/liveUrl: plexusTicket\.liveAppUrl\(JWT_SECRET, 'ca', /g) || []).length >= 6, 'CA rows: pre-registration ticket, guest copies, both combined-ticket branches and their guest copies');
        assert.ok(/liveUrl: plexusTicket\.liveAppUrl\(JWT_SECRET, 'gala', galaRegId/.test(srv), 'the standalone Gala receipt (Path B)');
        assert.ok(/liveAppUrl: \(kind, id\) => plexusTicket\.liveAppUrl\(JWT_SECRET, kind, id\)/.test(srv), 'caPayLinkDeps hands the minter to gala-paylink');
        assert.ok(/function buildCombinedTicketEmail\(\{[^}]*liveUrl[^}]*\}\)/.test(gp) && /function buildGuestEntryEmail\(\{[^}]*liveUrl[^}]*\}\)/.test(gp), 'both builders accept liveUrl');
        assert.ok(/liveUrl: liveOf\(ca\.id\)/.test(gp) && (gp.match(/liveOf\(ca\.id\)/g) || []).length >= 2, 'fulfilLinkedCaGala passes the CA row\'s link to the ticket and to every guest copy');
        assert.ok(!/sendEmail\([^)]*live/i.test(gp.slice(gp.indexOf('const liveOf'))), 'no new send anywhere — templates only');
    });

    // ------------------------------------------------------------ admin: the speaker link
    await t('admin GET /api/live/speaker-link/:speakerId — 401 without auth, 403 for a non-admin, 404 unknown, 200 with a verifiable speaker token on the member SPA host', async () => {
        const Database = require(path.join(ROOT, 'user-portal/backend/node_modules/libsql'));
        const { createDatabase } = require(path.join(ROOT, 'shared/db'));
        const db = createDatabase(Database, { localPath: ':memory:' });
        db.run(`CREATE TABLE sessions (id TEXT PRIMARY KEY, conference_id TEXT, title TEXT, description TEXT, session_type TEXT DEFAULT 'talk', day INTEGER DEFAULT 1, start_time TEXT, end_time TEXT, room TEXT, track TEXT, speaker_ids TEXT, is_published INTEGER DEFAULT 0, capacity INTEGER)`);
        db.run(`CREATE TABLE speakers (id TEXT PRIMARY KEY, conference_id TEXT, name TEXT, title TEXT, institution TEXT, bio TEXT, photo_url TEXT, is_keynote INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, email TEXT)`);
        db.run(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT)`);
        db.run(`CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        const app = stubApp();
        const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentication required' }));
        const adminOnly = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admin only' }));
        process.env.USER_PORTAL_URL = 'https://medx-member-portal-v2.netlify.app/';
        require(path.join(ROOT, 'admin-portal/backend/v2/program-ops.js'))(app, { db: () => db, auth, adminOnly, saveDb: () => {}, JWT_SECRET: SECRET, ROOT, log: () => {} });   // ensureSchema adds event_key…
        db.run(`INSERT INTO speakers (id, name, email) VALUES ('spk-hrvatin', 'Prof. Siniša Hrvatin', 'hrvatin@example.com')`);
        db.run(`INSERT INTO sessions (id, title, start_time, end_time, room, speaker_ids, is_published, event_key, event_date) VALUES ('s-k1', 'Keynote 1', '17:15', '18:00', 'Main Hall', 'spk-hrvatin', 1, 'conference', '2026-12-04')`);
        const P = '/api/live/speaker-link/:speakerId';
        assert.strictEqual((await app.call('GET', P, { params: { speakerId: 'spk-hrvatin' } })).status, 401);
        assert.strictEqual((await app.call('GET', P, { user: { id: 'u', is_admin: 0 }, params: { speakerId: 'spk-hrvatin' } })).status, 403);
        assert.strictEqual((await app.call('GET', P, { user: { id: 'u', is_admin: 1 }, params: { speakerId: 'nobody' } })).status, 404);
        assert.strictEqual((await app.call('GET', P, { user: { id: 'u', is_admin: 1 }, params: { speakerId: '../x' } })).status, 404);
        const ok = await app.call('GET', P, { user: { id: 'u', is_admin: 1 }, params: { speakerId: 'spk-hrvatin' } });
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(ok.body.url, 'https://medx-member-portal-v2.netlify.app/live/' + ok.body.token, 'url = member host + /live/ + token');
        assert.deepStrictEqual(core.verifyLiveToken(SECRET, ok.body.token), { kind: 'speaker', id: 'spk-hrvatin' });
        assert.strictEqual(ok.body.name, 'Prof. Siniša Hrvatin');
        assert.deepStrictEqual(ok.body.sessions.map(s => s.id), ['s-k1'], 'their slots ride along for the email');
        assert.strictEqual(ok.headers['cache-control'], 'private, no-store');
        delete process.env.USER_PORTAL_URL;
    });

    // ------------------------------------------------------------ the SPA
    await t('routes: /live/:token? is public (no auth, bare) and /app/live needs a session; the router regex admits the dotted live token', () => {
        const src = read(path.join(FE, 'js/routes.js'));
        assert.ok(/\{ path: '\/live\/:token\?', view: \(\) => import\('\.\/views\/live\.js'\), layout: 'bare'/.test(src), 'the public row');
        const pub = src.match(/\{ path: '\/live\/:token\?'[^\n]*/)[0];
        assert.ok(!/auth: true/.test(pub), 'no auth wall on /live');
        assert.ok(/\{ path: '\/app\/live', view: \(\) => import\('\.\/views\/live\.js'\), auth: true, layout: 'bare'/.test(src), 'the member row');
        // the router's own compile() — copied verbatim from js/router.js so a regex change there shows up here
        const compile = p => { const keys = []; const re = '^' + p.replace(/\/:([a-zA-Z_]+)\?/g, (_, k) => { keys.push(k); return '(?:/([^/]+))?'; }).replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*/g, '.*') + '/?$'; return { regex: new RegExp(re), keys }; };
        const router = read(path.join(FE, 'js/router.js'));
        assert.ok(router.includes("replace(/\\/:([a-zA-Z_]+)\\?/g, (_, k) => { keys.push(k); return '(?:/([^/]+))?'; })"), 'router.js still compiles optional params the way this test assumes');
        const c = compile('/live/:token?');
        const tok = core.liveToken(SECRET, 'bridges', 'f485dc4d-cbc1-4caa-a816-2bb26c8234a4');
        const m = c.regex.exec('/live/' + tok);
        assert.ok(m && m[1] === tok, 'the dotted token is one segment');
        assert.ok(c.regex.exec('/live') && c.regex.exec('/live/'), 'no token → the catalogue');
        assert.ok(!c.regex.exec('/live/a/b'), 'nothing deeper');
    });

    await t('service worker: cache name bumped, live view + css precached, /live never a server path, /api still bypassed; config, _redirects and the dev server let /live/<dotted> reach the shell', () => {
        const sw = read(path.join(FE, 'sw.js'));
        const m = sw.match(/const CACHE_NAME = 'medx-portal-v2-(\d+)'/);
        assert.ok(m && Number(m[1]) >= 4, 'CACHE_NAME ≥ v2-4 so cache-first JS rolls');
        assert.ok(sw.includes("'/js/views/live.js'") && sw.includes("'/css/views/live.css'"), 'precached');
        const prefixes = sw.match(/const SERVER_PREFIXES = \[([\s\S]*?)\];/)[1];
        assert.ok(!/'\/live'/.test(prefixes), '/live is a client route');
        assert.ok(/'\/api'/.test(prefixes), '/api bypassed');
        assert.ok(/req\.mode === 'navigate'[\s\S]*fetch\(req\)[\s\S]*caches\.match\('\/index\.html'\)/.test(sw), 'navigations network-first, shell only as the offline fallback');
        const cfg = read(path.join(FE, 'js/config.js'));
        assert.ok(!/'\/live'/.test(cfg.match(/serverPaths: \[([\s\S]*?)\]/)[1]), 'config.serverPaths has no /live');
        const redirects = read(path.join(FE, '_redirects'));
        assert.ok(!/^\/live/m.test(redirects) && /^\/\*\s+\/index\.html\s+200/m.test(redirects), '_redirects: no /live row, the SPA fallback catches it');
        const dev = read(path.join(FE, 'dev-server.js'));
        assert.ok(/if \(ext && MIME\[ext\]\)/.test(dev), 'dev-server 404s only known asset extensions — the dotted token reaches index.html');
        assert.ok(read(path.join(FE, 'index.html')).includes('<meta name="theme-color"'), 'theme-color meta on the shell');
    });

    await t('the view: literal /api/live paths, the brief\'s copy, 60 s polling, the localStorage cache keys, the four tabs, the sheet, no chrome dependency', () => {
        const v = read(path.join(FE, 'js/views/live.js'));
        for (const p of ['/api/live/me/', '/api/live/events', '/program', '/attend', '/schedule.ics', '/sessions/']) assert.ok(v.includes(p), 'path ' + p);
        assert.ok(/const POLL_MS = 60 \* 1000/.test(v), 'poll every 60 s');
        assert.ok(v.includes("'live:program:' + k") && v.includes("'live:attendance:' + t"), 'cache keys');
        assert.ok(v.includes('Program updated'), 'the toast');
        assert.ok(v.includes('Open this from your ticket link to build your schedule.'), 'the no-token line');
        assert.ok(v.includes('Tap ATTENDING on anything in the program — it lands here.'), 'the empty schedule');
        assert.ok(v.includes("['program', 'schedule', 'speakers', 'info']"), 'four tabs');
        assert.ok(/KEYNOTE.*TALK.*PANEL.*PRESENTATIONS.*BREAK.*LUNCH.*NETWORKING.*RECEPTION.*CEREMONY/.test(v), 'kind chips');
        assert.ok(v.includes('maps.apple.com/?q=') && v.includes('google.com/maps/search/?api=1&query='), 'map links');
        assert.ok(!/ev\.wifi \|\| '/.test(v) && /ev\.wifi \? row\(/.test(v), 'Wi-Fi only when a fact exists');
        assert.ok(v.includes('visibilitychange'), 'refreshes on focus');
        assert.ok(!v.includes("from '../chrome.js'"), 'the app never draws the portal chrome');
        assert.ok(/layout: 'bare'/.test(v), 'bare layout declared on the view too');
        const css = read(path.join(FE, 'css/views/live.css'));
        assert.ok(/\.lv \{[^}]*font: 16px/.test(css), 'base 16 px');
        assert.ok(/\.lv-att \{[^}]*min-height: 46px/.test(css) && /\.lv-tab \{[^}]*min-height: 48px/.test(css), '44 px+ targets');
        assert.ok(/--lv-w: 720px/.test(css), 'the 720 px column');
        assert.ok(/\.lv-tabs \{ position: sticky; top: 0/.test(css) && /\.lv-day \{ position: sticky; top: 48px/.test(css), 'sticky tabs + day headers');
        assert.ok(/\.lv-card\.tbd \{ border-style: dashed/.test(css), 'TBD placeholders dashed');
        assert.ok(/\.lv-att\.on \{ background: var\(--crimson\)/.test(css), 'ATTENDING fills red');
    });

    await t('the member pages link to the app: PLEXUS WEEK LIVE → on every Plexus tab strip, EVENT APP → on Building Bridges', () => {
        const plexus = read(path.join(FE, 'js/views/plexus.js')), bridges = read(path.join(FE, 'js/views/bridges.js'));
        assert.ok(/live: 'PLEXUS WEEK LIVE →'/.test(plexus) && plexus.includes('href="/app/live"'), 'Plexus');
        assert.ok(plexus.indexOf('href="/app/live"') > plexus.indexOf('function tabStrip()') && plexus.indexOf('href="/app/live"') < plexus.indexOf('function blockHelp('), 'inside the tab strip (every tab)');
        assert.ok(/live: 'EVENT APP →'/.test(bridges) && bridges.includes('href="/app/live"'), 'Bridges');
        assert.ok(bridges.indexOf('href="/app/live"') > bridges.indexOf('function blockCrumb()') && bridges.indexOf('href="/app/live"') < bridges.indexOf('function followToggle()'), 'in the breadcrumb row');
    });

    // ------------------------------------------------------------ Playwright smoke (opt-in)
    if (smokeArg) {
        const outDir = process.env.LIVE_SMOKE_OUT || path.join(os.tmpdir(), 'live-app-smoke');
        const runSmoke = (base, api, token, extra = []) => {
            const r = spawnSync('python3', [path.join(__dirname, 'live-app-smoke.py'), '--base', base, '--api', api, '--token', token, '--out', outDir, ...extra], { stdio: 'inherit', timeout: 6 * 60 * 1000 });
            assert.strictEqual(r.status, 0, 'live-app-smoke.py exit ' + r.status);
        };
        if (smokeArg === 'staging') {
            await t('Playwright smoke against the deployed app (LIVE_SMOKE_BASE / _API / _TOKEN)', () => {
                const { LIVE_SMOKE_BASE, LIVE_SMOKE_API, LIVE_SMOKE_TOKEN } = process.env;
                assert.ok(LIVE_SMOKE_BASE && LIVE_SMOKE_API && LIVE_SMOKE_TOKEN, 'set LIVE_SMOKE_BASE, LIVE_SMOKE_API and LIVE_SMOKE_TOKEN');
                runSmoke(LIVE_SMOKE_BASE, LIVE_SMOKE_API, LIVE_SMOKE_TOKEN);
            });
        } else {
            await t('Playwright smoke against a scratch member backend (copy of deploy/staging/seed.db) + frontend-v2 dev server', async () => {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-app-'));
                const dbFile = path.join(dir, 'scratch.db');
                fs.copyFileSync(path.join(ROOT, 'deploy/staging/seed.db'), dbFile);
                const REG = 'bb-smoke-' + crypto.randomBytes(4).toString('hex');
                const sql = `INSERT OR IGNORE INTO bridges_events (id, name, city, venue_name, venue_address, event_date, event_time, end_time, status, slug, is_published) VALUES ('bb-boston-2026-09-21','Building Bridges in Biomedicine — Boston','Boston','Waterhouse Room, Gordon Hall','25 Shattuck Street, Harvard Medical School, Boston, MA','2026-09-21','18:00','21:00','upcoming','boston',1); INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, status) VALUES ('${REG}','bb-boston-2026-09-21','Smoke','Guest','smoke@example.com','Test','registered');`;
                const s3 = spawnSync('sqlite3', [dbFile, sql]); assert.strictEqual(s3.status, 0, 'sqlite3 seed: ' + String(s3.stderr));
                const API_PORT = 3900 + Math.floor(Math.random() * 60), FE_PORT = API_PORT + 100, JWT = 'live-smoke-' + crypto.randomBytes(6).toString('hex');
                const be = spawn(process.execPath, ['server.js'], { cwd: path.join(ROOT, 'user-portal/backend'), env: Object.assign({}, process.env, { NODE_ENV: 'staging', DATABASE_PATH: dbFile, PORT: String(API_PORT), JWT_SECRET: JWT, PUBLIC_BASE_URL: 'http://localhost:' + FE_PORT }), stdio: ['ignore', fs.openSync(path.join(dir, 'backend.log'), 'w'), fs.openSync(path.join(dir, 'backend.err'), 'w')] });
                const fe = spawn(process.execPath, ['dev-server.js'], { cwd: FE, env: Object.assign({}, process.env, { BACKEND: 'http://localhost:' + API_PORT, PORT: String(FE_PORT) }), stdio: 'ignore' });
                const realFetch = require('node:https').request ? require('node:http') : null;
                const up = (port, p) => new Promise(resolve => { const req = realFetch.get({ host: '127.0.0.1', port, path: p, timeout: 3000 }, r => { r.resume(); resolve(r.statusCode === 200); }); req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); }); });
                try {
                    let ready = false;
                    for (let i = 0; i < 60 && !ready; i++) { ready = await up(API_PORT, '/api/live/events'); if (!ready) await new Promise(r => setTimeout(r, 2000)); }
                    assert.ok(ready, 'member backend up on :' + API_PORT + ' (see ' + path.join(dir, 'backend.log') + ')');
                    assert.ok(await up(FE_PORT, '/live'), 'dev server up on :' + FE_PORT);
                    runSmoke('http://localhost:' + FE_PORT, 'http://localhost:' + API_PORT, core.liveToken(JWT, 'bridges', REG));
                } finally { try { be.kill(); } catch (e) {} try { fe.kill(); } catch (e) {} }
            });
        }
    }

    console.log(`\n${passed} passed, ${failed} failed` + (smokeArg ? '' : '   (add --smoke=local for the Playwright pass)'));
    process.exit(failed ? 1 : 0);
})();
