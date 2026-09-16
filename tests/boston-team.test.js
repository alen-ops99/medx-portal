/**
 * tests/boston-team.test.js — the TEAM CONTROLS on the Boston card (Alen 2026-09-16): a message
 * from the team (three templates, per row and in bulk, "nudged today" skipped), a seat released
 * BY the team (the guest's own "I can't make it", done for them), a guest added by hand, and the
 * "they already received the <shape> email" fact after a decision is flipped.
 *
 * Same shape as tests/boston-ops.test.js: ONE in-memory libsql database, BOTH portals mounted on
 * it, the admin module's fetch dispatched straight into the member wing's handlers, sendEmail a
 * capturing stub and every other network call throwing. A REAL EMAIL SEND OR ANY NETWORK CALL IS
 * IMPOSSIBLE HERE.
 *
 * Run:  node tests/boston-team.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
process.env.BOSTON_PRESENTATION_SLOTS = 'open';
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.GOOGLE_SHEETS_WEBHOOK;
delete process.env.BB_SHEET_ID;
delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
delete process.env.CONFIRMATION_CC;                      // so the FYI proves its DEFAULT recipient
for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_') || k.startsWith('BB_S3_')) delete process.env[k];
process.env.PUBLIC_BASE_URL = 'https://portal.test';
process.env.USER_PORTAL_URL = 'http://member.test';
delete process.env.GOOGLE_WALLET_ISSUER_ID;
delete process.env.GOOGLE_WALLET_SA_KEY;

const wallet = require(path.join(ROOT, 'shared/wallet.js'));
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));

const JWT_SECRET = 'test-secret-boston-team';
const EVENT_ID = 'bb-boston-2026-09-21';
const MEMBER = 'http://member.test';
const SUPPORT_EMAIL = 'laura.rodman@medx.hr';
const ADMIN_KEY = crypto.createHmac('sha256', JWT_SECRET).update('boston-admin').digest('hex').slice(0, 40);
const TODAY = new Date().toISOString().slice(0, 10);
// UUID-shaped ids: the personal-page token grammar ([0-9a-f-]{16,64}) is what production rows have
const ID = {"kellis": "11111111-1111-4111-8111-111111111111", "babic": "22222222-2222-4222-8222-222222222222", "novak": "33333333-3333-4333-8333-333333333333", "ruscic": "44444444-4444-4444-8444-444444444444", "daly": "55555555-5555-4555-8555-555555555555", "casteel": "66666666-6666-4666-8666-666666666666", "old": "77777777-7777-4777-8777-777777777777", "held": "88888888-8888-4888-8888-888888888888"};

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

// ---------------------------------------------------------------- stub express (middleware chains)
function stubApp() {
    const routes = {};
    const reg = m => (p, ...h) => { routes[m + ' ' + p] = h; };
    return {
        get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), delete: reg('DELETE'),
        routes,
        async call(method, p, opts = {}) {
            const chain = routes[method + ' ' + p];
            if (!chain) throw new Error('route not mounted: ' + method + ' ' + p);
            const req = {
                user: opts.user === undefined ? { id: 'admin-1', email: 'alen@medx.hr', is_admin: 1 } : opts.user,
                params: opts.params || {}, query: opts.query || {}, body: opts.body || {},
                headers: {}, protocol: 'https', get: () => 'portal.test'
            };
            const r = { status: 200, body: undefined, headers: {} };
            let ended = false;
            const res = {
                status(c) { r.status = c; return res; },
                json(o) { r.body = o; ended = true; return res; },
                send(x) { r.body = x; ended = true; return res; },
                sendFile(f) { r.body = '[sendFile] ' + f; ended = true; },
                set(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) r.headers[a.toLowerCase()] = b; } else r.headers[String(k).toLowerCase()] = v; return res; },
                setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; },
                redirect(c, u) { r.status = c; r.headers.location = u; ended = true; },
                get headersSent() { return ended; }
            };
            for (let i = 0; i < chain.length; i++) {
                if (ended) break;
                let advanced = false;
                await chain[i](req, res, () => { advanced = true; });
                if (!advanced && i < chain.length - 1) break;
            }
            return r;
        }
    };
}

// ---------------------------------------------------------------- one shared DB (both portals)
const db = createDatabase(Database, { localPath: ':memory:' });
db.run(`CREATE TABLE bridges_events (
    id TEXT PRIMARY KEY, slug TEXT, name TEXT NOT NULL, city TEXT NOT NULL, venue_name TEXT, venue_address TEXT,
    event_date TEXT NOT NULL, event_time TEXT, end_time TEXT, description TEXT, capacity INTEGER DEFAULT 50,
    registration_open INTEGER DEFAULT 1, status TEXT DEFAULT 'upcoming', price REAL DEFAULT 0,
    is_published INTEGER DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE bridges_registrations (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT, institution TEXT, position TEXT, dietary_requirements TEXT, special_requests TEXT,
    status TEXT DEFAULT 'registered', payment_status TEXT DEFAULT 'n/a', amount_paid REAL,
    confirmation_sent INTEGER DEFAULT 0, reminder_sent INTEGER DEFAULT 0, checked_in INTEGER DEFAULT 0,
    checked_in_at TEXT, notes TEXT, registered_at TEXT DEFAULT CURRENT_TIMESTAMP, custom_answers TEXT)`);
db.run(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT)`);

function step(sql, params, all) {
    const st = db.prepare(sql);
    st.bind(params || []);
    const out = [];
    while (st.step()) { out.push(st.getAsObject()); if (!all) break; }
    st.free();
    return all ? out : (out[0] || null);
}
const query = {
    run: (sql, params) => (params && params.length ? db.run(sql, params) : db.run(sql)),
    get: (sql, params) => step(sql, params, false),
    all: (sql, params) => step(sql, params, true)
};

// ---------------------------------------------------------------- mount both sides
const app = stubApp();
const sentEmails = [];
const adminEmails = [];

const mountBoston = require(path.join(ROOT, 'user-portal/backend/boston.js'));
mountBoston(app, { query, saveDb: () => {}, flushDb: () => {}, JWT_SECRET,
    sendEmail: async (to, subject, html, attachments) => { sentEmails.push({ to, subject, html, attachments: attachments || null }); return { success: true }; } });
const reviewGate = require(path.join(ROOT, 'user-portal/backend/review-gate.js'));
const REVIEW_TO = reviewGate.REVIEW_TO;

// the program PDF gates the Boston email — fake credentials, stubbed reads
process.env.BB_S3_BUCKET = 'medx-bb-team-test';
process.env.BB_S3_REGION = 'us-east-1';
process.env.BB_S3_KEY = 'AKIATESTTESTTESTTEST';
process.env.BB_S3_SECRET = 'test-secret-not-real';
const PROGRAM_BYTES = Buffer.from('%PDF-1.7\nBuilding Bridges Boston — program\n%%EOF');
mountBoston._s3.putObject = async () => ({ etag: '"stub-etag"' });
mountBoston._s3.getObject = async () => PROGRAM_BYTES;
mountBoston._s3.headObject = async () => ({ size: PROGRAM_BYTES.length, lastModified: '2026-09-13T09:00:00.000Z' });

function resolveRoute(method, pathname) {
    if (app.routes[method + ' ' + pathname]) return { path: pathname, params: {} };
    const want = pathname.split('/');
    for (const key of Object.keys(app.routes)) {
        const [m, p] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];
        if (m !== method || !p.includes(':')) continue;
        const got = p.split('/');
        if (got.length !== want.length) continue;
        const params = {};
        if (got.every((seg, i) => seg.startsWith(':') ? (params[seg.slice(1)] = decodeURIComponent(want[i]), true) : seg === want[i])) {
            return { path: p, params };
        }
    }
    return null;
}
const fetchLog = [];
global.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin !== MEMBER) throw new Error('NETWORK DISABLED IN TESTS: ' + u.origin);
    const qs = Object.fromEntries(u.searchParams.entries());
    fetchLog.push({ method: init.method || 'GET', path: u.pathname, key: qs.key, body: init.body ? JSON.parse(init.body) : undefined });
    const hit = resolveRoute(init.method || 'GET', u.pathname);
    if (!hit) return { ok: false, status: 404, text: async () => JSON.stringify({ error: 'Not found' }) };
    const r = await app.call(init.method || 'GET', hit.path, { query: qs, params: hit.params, body: init.body ? JSON.parse(init.body) : {}, user: null });
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body === undefined ? {} : r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
};

const mountBostonOps = require(path.join(ROOT, 'admin-portal/backend/v2/boston-ops.js'));
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'no' }));
const adminOnly = (req, res, next) => next();
mountBostonOps(app, {
    db: () => db, auth, adminOnly,
    sendEmail: async (to, subject, html) => { adminEmails.push({ to, subject, html }); return { success: true }; },
    saveDb: () => {}, JWT_SECRET, ROOT, log: () => {}
});

// ---------------------------------------------------------------- seed
query.run(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, capacity, registration_open)
    VALUES (?, 'boston-2026', 'Building Bridges in Biomedicine — Boston', 'Boston', 'Waterhouse Room, Gordon Hall', '2026-09-21', 'upcoming', 60, 1)`, [EVENT_ID]);
function seedReg(id, first, last, email, position, notes, status) {
    query.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, position, notes, status, payment_status, confirmation_sent)
               VALUES (?,?,?,?,?,?,?,?,?, 'n/a', 1)`,
        [id, EVENT_ID, first, last, email, first + ' Institute', position, notes, status || 'registered']);
}
// Two presenters without a deck, one presenter WITH a deck, one panelist awaiting, one panelist who
// answered, one plain guest, one cancelled row, one held row.
seedReg(ID.kellis, 'Manolis', 'Kellis', 'kellis@example.com', 'Professor', '5-minute presentation requested');
seedReg(ID.babic, 'Luka', 'Babic', 'babic@example.com', 'Postdoctoral Fellow', '5-minute presentation requested');
seedReg(ID.novak, 'Mia', 'Novak', 'novak@example.com', 'Assistant Professor', '5-minute presentation requested');
seedReg(ID.ruscic, 'Katarina', 'Ruscic', 'ruscic@example.com', 'Assistant Professor', null);
seedReg(ID.daly, 'Mark', 'Daly', 'daly@example.com', 'Chief', null);
seedReg(ID.casteel, 'Katrina', 'Casteel', 'casteel@example.com', 'Undergraduate student', null);
seedReg(ID.old, 'Old', 'Cancel', 'old@example.com', null, '5-minute presentation requested', 'cancelled');
seedReg(ID.held, 'Bot', 'Held', 'held@example.com', null, 'HELD — review', 'pending-review');

const rowOf = id => query.get('SELECT * FROM bridges_registrations WHERE id = ?', [id]);
const notesOf = id => String((rowOf(id) || {}).notes || '');
const presenters = () => app.call('GET', '/api/v2/boston/presenters');
const catering = () => app.call('GET', '/api/v2/boston/catering');
const prow = (body, id) => (body.rows || []).find(r => r.registration_id === id);
const mailsTo = to => sentEmails.filter(m => m.to === to);
const lastMail = () => sentEmails[sentEmails.length - 1];
const meToken = id => crypto.createHmac('sha256', JWT_SECRET).update('boston:me:' + id).digest('hex').slice(0, 32) + '.' + id;

(async () => {
    console.log('boston-team.test.js — hermetic (stub express, one in-memory libsql DB, both portals mounted, captured emails)\n');

    // the member wing creates presenter_status / panel_reply on first use — trigger it, then set decisions
    await presenters();
    query.run(`UPDATE bridges_registrations SET presenter_status = 'confirmed' WHERE id IN (?,?,?)`, [ID.kellis, ID.babic, ID.novak]);
    query.run(`UPDATE bridges_registrations SET presenter_status = 'panel' WHERE id IN (?,?)`, [ID.ruscic, ID.daly]);
    query.run(`UPDATE bridges_registrations SET panel_reply = 'yes', panel_replied_at = '2026-09-15T10:00:00Z' WHERE id = ?`, [ID.daly]);
    // Novak has a deck (a share link — the over-25 MB lane counts as a deck)
    await app.call('POST', '/api/boston/me/:token/slides-link', { params: { token: meToken(ID.novak) }, body: { url: 'https://drive.google.com/file/d/abc/view' }, user: null });

    // ================================================================ routes + gates
    await t('the four team routes are mounted on the admin side, behind auth + adminOnly', () => {
        for (const k of ['GET /api/v2/boston/message/draft', 'POST /api/v2/boston/message',
            'POST /api/v2/boston/registrations/:id/release', 'POST /api/v2/boston/guests/add']) {
            assert.ok(app.routes[k], 'missing route: ' + k);
            assert.strictEqual(app.routes[k][0], auth, k + ' must start with auth');
            assert.strictEqual(app.routes[k][1], adminOnly, k + ' must be adminOnly');
        }
        for (const k of ['GET /api/boston/team/message/draft', 'POST /api/boston/team/message',
            'POST /api/boston/registrations/:id/release', 'POST /api/boston/guests/add']) {
            assert.ok(app.routes[k], 'missing member route: ' + k);
        }
    });
    await t('the member routes refuse a missing or wrong key with 404 and write nothing', async () => {
        const before = sentEmails.length;
        for (const [m, p, o] of [
            ['GET', '/api/boston/team/message/draft', { query: { id: ID.kellis } }],
            ['POST', '/api/boston/team/message', { body: { to: ID.kellis, template: 'slides' } }],
            ['POST', '/api/boston/registrations/:id/release', { params: { id: ID.kellis } }],
            ['POST', '/api/boston/guests/add', { body: { first_name: 'X', last_name: 'Y', email: 'xy@example.com' } }]]) {
            for (const key of [undefined, 'wrong']) {
                const r = await app.call(m, p, Object.assign({ user: null }, o, { query: Object.assign({}, o.query || {}, key ? { key } : {}) }));
                assert.equal(r.status, 404, m + ' ' + p + ' with key=' + key);
            }
        }
        assert.equal(sentEmails.length, before);
        assert.equal(rowOf(ID.kellis).status, 'registered');
        assert.ok(!rowOf('xy'), 'nothing inserted');
    });
    await t('a signed-out admin request is refused', async () => {
        const r = await app.call('POST', '/api/v2/boston/message', { user: null, body: { to: ID.kellis, template: 'slides' } });
        assert.equal(r.status, 401);
    });

    // ================================================================ the drafts
    await t('the draft carries the three templates, the formal greeting and the suggested one', async () => {
        const r = await app.call('GET', '/api/v2/boston/message/draft', { query: { id: ID.kellis } });
        assert.equal(r.status, 200);
        assert.equal(r.body.greeting, 'Dear Prof. Kellis,');
        assert.equal(r.body.suggested, 'slides', 'a presenter without a deck opens on the slides template');
        assert.deepEqual(Object.keys(r.body.drafts).sort(), ['general', 'panel', 'slides']);
        assert.match(r.body.drafts.slides.subject, /slides/i);
        assert.match(r.body.drafts.slides.body, /Sunday, 20 September/);
        assert.match(r.body.drafts.slides.body, /5 to 8 slides/);
        assert.match(r.body.drafts.panel.body, /panel discussion/);
        assert.equal(r.body.drafts.general.body, '', 'the general template is the team\'s own words');
        assert.ok(!/Hi |Dear/.test(r.body.drafts.slides.body), 'the greeting is never inside the body — the send adds it');
        assert.equal(r.body.counts['slides-missing'], 2, 'Kellis + Babic owe a deck; Novak has a link');
        assert.equal(r.body.counts['panel-awaiting'], 1, 'Ruscic owes an answer; Daly said yes');
    });
    await t('a panelist without an answer is suggested the panel template; a plain guest the general one', async () => {
        const a = await app.call('GET', '/api/v2/boston/message/draft', { query: { id: ID.ruscic } });
        assert.equal(a.body.suggested, 'panel');
        assert.equal(a.body.greeting, 'Dear Prof. Ruscic,');
        const b = await app.call('GET', '/api/v2/boston/message/draft', { query: { id: ID.casteel } });
        assert.equal(b.body.suggested, 'general');
        assert.equal(b.body.greeting, 'Dear Katrina Casteel,');
    });
    await t('an unknown guest is a 404', async () => {
        const r = await app.call('GET', '/api/v2/boston/message/draft', { query: { id: 'nobody' } });
        assert.equal(r.status, 404);
    });

    // ================================================================ one message
    await t('a slides nudge to one presenter: one email, Dear Prof., personal page, marker NUDGE-SLIDES <today>', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: ID.kellis, template: 'slides' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body.sent, ['kellis@example.com']);
        assert.equal(sentEmails.length, before + 1);
        const m = lastMail();
        assert.equal(m.to, 'kellis@example.com');
        assert.match(m.subject, /Your presentation slides — Building Bridges Boston/);
        assert.ok(m.html.includes('Dear Prof. Kellis,'), 'formal greeting');
        assert.ok(m.html.includes('/boston/me/' + meToken(ID.kellis)), 'their own personal page');
        assert.ok(m.html.includes('Sunday, 20 September'), 'the deadline');
        assert.ok(!m.html.includes('Hi Manolis'), 'never Hi first-name');
        assert.match(notesOf(ID.kellis), new RegExp('NUDGE-SLIDES ' + TODAY));
        assert.equal(adminEmails.length, 0, 'the admin never sends');
        // BOSTON_TEAM_DUMP=<dir> writes the rendered email out for a visual check — never in CI
        if (process.env.BOSTON_TEAM_DUMP) require('node:fs').writeFileSync(path.join(process.env.BOSTON_TEAM_DUMP, 'nudge-slides.html'), m.html);
    });
    await t('an edited subject and body are what goes out — the greeting is still added by the wing', async () => {
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: ID.babic, template: 'general',
            subject: 'Your talk on Monday', body: 'Quick one: could you confirm your talk title?\n\nMany thanks.' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const m = lastMail();
        assert.equal(m.subject, 'Your talk on Monday');
        assert.ok(m.html.includes('Dear Dr. Babic,'), 'postdoc → Dr.');
        assert.ok(m.html.includes('could you confirm your talk title?'));
        assert.ok(m.html.includes('<p style="margin:0 0 10px;">Many thanks.</p>'), 'blank line → paragraph');
        assert.match(notesOf(ID.babic), new RegExp('NUDGE-GENERAL ' + TODAY));
        assert.ok(!/NUDGE-SLIDES/.test(notesOf(ID.babic)), 'the general marker is its own');
    });
    await t('a general message with an empty body is refused before anything is sent', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: ID.casteel, template: 'general', body: '   ' } });
        assert.equal(r.status, 400);
        assert.equal(sentEmails.length, before);
    });
    await t('a bad template, a missing target and an unknown guest are refused', async () => {
        const before = sentEmails.length;
        assert.equal((await app.call('POST', '/api/v2/boston/message', { body: { to: ID.kellis, template: 'shout' } })).status, 400);
        assert.equal((await app.call('POST', '/api/v2/boston/message', { body: { template: 'slides' } })).status, 400);
        assert.equal((await app.call('POST', '/api/v2/boston/message', { body: { to: 'nobody', template: 'slides' } })).status, 404);
        assert.equal(sentEmails.length, before);
    });
    await t('a released seat cannot be nudged', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: ID.old, template: 'slides' } });
        assert.equal(r.status, 409);
        assert.equal(sentEmails.length, before);
    });
    await t('the card rows carry the nudge dates', async () => {
        const r = await presenters();
        assert.equal(prow(r.body, ID.kellis).nudged.slides, TODAY);
        assert.strictEqual(prow(r.body, ID.kellis).nudged.panel, null);
        assert.equal(prow(r.body, ID.babic).nudged.general, TODAY);
        const c = await catering();
        assert.equal(prow(c.body, ID.kellis).nudged.slides, TODAY);
    });

    // ================================================================ bulk
    await t('bulk slides-missing: Babic gets it, Kellis (nudged today) is skipped, Novak (has a link) is not a target', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: 'slides-missing', template: 'slides' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body.sent, ['babic@example.com']);
        assert.deepEqual(r.body.skipped.map(s => s.email), ['kellis@example.com']);
        assert.equal(sentEmails.length, before + 1);
        assert.ok(lastMail().html.includes('Dear Dr. Babic,'));
        assert.match(notesOf(ID.babic), new RegExp('NUDGE-SLIDES ' + TODAY));
    });
    await t('bulk slides-missing again: nobody, both are nudged today', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: 'slides-missing', template: 'slides' } });
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.sent, []);
        assert.equal(r.body.skipped.length, 2);
        assert.equal(sentEmails.length, before);
    });
    await t('bulk panel-awaiting: Ruscic only — Daly answered, and nobody outside the panel', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: 'panel-awaiting', template: 'panel' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body.sent, ['ruscic@example.com']);
        assert.equal(sentEmails.length, before + 1);
        assert.match(lastMail().subject, /Can you join the panel/);
        assert.ok(lastMail().html.includes('Dear Prof. Ruscic,'));
        assert.match(notesOf(ID.ruscic), new RegExp('NUDGE-PANEL ' + TODAY));
    });
    await t('a nudge re-stamps the same marker with the latest date instead of piling up', async () => {
        query.run(`UPDATE bridges_registrations SET notes = REPLACE(notes, 'NUDGE-PANEL ' || ?, 'NUDGE-PANEL 2026-09-10') WHERE id = ?`, [TODAY, ID.ruscic]);
        assert.match(notesOf(ID.ruscic), /NUDGE-PANEL 2026-09-10/);
        const r = await app.call('POST', '/api/v2/boston/message', { body: { to: 'panel-awaiting', template: 'panel' } });
        assert.deepEqual(r.body.sent, ['ruscic@example.com'], 'yesterday\'s nudge does not block today\'s');
        const n = notesOf(ID.ruscic);
        assert.equal((n.match(/NUDGE-PANEL/g) || []).length, 1, 'one marker: ' + n);
        assert.match(n, new RegExp('NUDGE-PANEL ' + TODAY));
    });

    // ================================================================ release by the team
    await t('release: cancelled, CANCELLED-BY-TEAM <today> was:panel, decision reset, FYI to Laura + Alen', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/registrations/:id/release', { params: { id: ID.ruscic } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.already, false);
        assert.equal(r.body.email, 'ruscic@example.com');
        assert.equal(r.body.was_presenter_status, 'panel');
        assert.equal(r.body.released_on, TODAY);
        const row = rowOf(ID.ruscic);
        assert.equal(row.status, 'cancelled');
        assert.strictEqual(row.presenter_status, null, 'the panel seat is freed');
        assert.match(row.notes, new RegExp('CANCELLED-BY-TEAM ' + TODAY + ' was:panel'));
        assert.ok(!/CANCELLED-BY-GUEST/.test(row.notes), 'never the guest\'s own marker');
        const fyi = sentEmails.slice(before);
        assert.deepEqual(fyi.map(m => m.to).sort(), [SUPPORT_EMAIL, REVIEW_TO].sort());
        assert.ok(fyi.every(m => /Seat released by the team — Katarina Ruscic/.test(m.subject)), fyi.map(m => m.subject).join(' | '));
        assert.ok(fyi[0].html.includes('by the team'));
        assert.ok(fyi[0].html.includes('on the panel'), 'the freed panel seat is said');
        assert.ok(!fyi.some(m => m.to === 'ruscic@example.com'), 'the guest gets nothing');
        assert.equal(r.body.registered_now, 5, 'Kellis, Babic, Novak, Daly, Casteel');
    });
    await t('the released seat is out of every count and in the released list, marked by the team', async () => {
        const c = await catering();
        assert.equal(c.body.total, 5);
        assert.equal(c.body.panel_count, 1, 'Daly only');
        assert.ok(!prow(c.body, ID.ruscic), 'not in the seats table');
        const rel = (c.body.released || []).find(x => x.registration_id === ID.ruscic);
        assert.ok(rel, 'in the released list');
        assert.equal(rel.released_by, 'team');
        assert.equal(rel.released_on, TODAY);
        // she never offered a talk and her decision was reset, so the presenters table (decisions
        // only) lets her go — the released list above is where a freed seat lives
        const p = await presenters();
        assert.ok(!prow(p.body, ID.ruscic), 'a released panelist who never offered a talk leaves the decisions table');
        assert.equal(p.body.panel_total, 1, 'Daly is the only panelist left');
    });
    await t('a seat the team released is refused everywhere the guest\'s own release is: personal page writes, the Boston email, a nudge', async () => {
        const before = sentEmails.length;
        const w = await app.call('POST', '/api/boston/me/:token/panel', { params: { token: meToken(ID.ruscic) }, body: { reply: 'yes' }, user: null });
        assert.equal(w.status, 409, JSON.stringify(w.body));
        assert.match(String(w.body.error), /Your seat was released on \d{4}-\d{2}-\d{2}/);
        const s = await app.call('POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: ID.ruscic }, user: null });
        assert.deepEqual(s.body.sent, [], 'the Boston email never goes to a released seat');
        const n = await app.call('POST', '/api/v2/boston/message', { body: { to: ID.ruscic, template: 'panel' } });
        assert.equal(n.status, 409);
        assert.equal(sentEmails.length, before);
    });
    await t('releasing again is idempotent — no second FYI', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/registrations/:id/release', { params: { id: ID.ruscic } });
        assert.equal(r.status, 200);
        assert.equal(r.body.already, true);
        assert.equal(sentEmails.length, before);
    });
    await t('restore brings the seat AND the panel decision back', async () => {
        const r = await app.call('POST', '/api/v2/boston/registrations/:id/restore', { params: { id: ID.ruscic } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const row = rowOf(ID.ruscic);
        assert.equal(row.status, 'registered');
        assert.equal(row.presenter_status, 'panel');
        assert.match(row.notes, new RegExp('RESTORED-BY-TEAM ' + TODAY));
        const c = await catering();
        assert.equal(c.body.total, 6);
        assert.ok(!(c.body.released || []).some(x => x.registration_id === ID.ruscic));
    });
    await t('release → restore → release again carries the latest marker, not the first', async () => {
        query.run(`UPDATE bridges_registrations SET notes = REPLACE(notes, 'CANCELLED-BY-TEAM ' || ? || ' was:panel', 'CANCELLED-BY-TEAM 2026-09-01 was:panel') WHERE id = ?`, [TODAY, ID.ruscic]);
        await app.call('POST', '/api/v2/boston/registrations/:id/release', { params: { id: ID.ruscic } });
        const n = notesOf(ID.ruscic);
        assert.equal((n.match(/CANCELLED-BY-TEAM/g) || []).length, 1, 'one marker: ' + n);
        assert.match(n, new RegExp('CANCELLED-BY-TEAM ' + TODAY + ' was:panel'));
        assert.equal(rowOf(ID.ruscic).status, 'cancelled');
        await app.call('POST', '/api/v2/boston/registrations/:id/restore', { params: { id: ID.ruscic } });
        assert.equal(rowOf(ID.ruscic).presenter_status, 'panel');
    });
    await t('a plain guest released by the team: no decision to reset, FYI says nothing about a panel', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/registrations/:id/release', { params: { id: ID.casteel } });
        assert.equal(r.status, 200);
        assert.strictEqual(r.body.was_presenter_status, null);
        assert.match(notesOf(ID.casteel), new RegExp('CANCELLED-BY-TEAM ' + TODAY + '(\\s*\\||$)'));
        assert.ok(!sentEmails.slice(before)[0].html.includes('decision is open again'));
        await app.call('POST', '/api/v2/boston/registrations/:id/restore', { params: { id: ID.casteel } });
        assert.equal(rowOf(ID.casteel).status, 'registered');
    });
    await t('an unknown id is a 404', async () => {
        const r = await app.call('POST', '/api/v2/boston/registrations/:id/release', { params: { id: 'nobody' } });
        assert.equal(r.status, 404);
    });

    // ================================================================ add a guest
    let addedId = null;
    await t('add a guest: registered row, Added by team <today>, no email, sheet-ready', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/guests/add', { body: { first_name: 'Ivana', last_name: 'Kovač', email: 'Ivana.Kovac@Example.com', institution: 'Brigham and Women\'s Hospital', position: 'Attending Physician' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.ok(r.body.registration_id);
        addedId = r.body.registration_id;
        assert.equal(r.body.email, 'ivana.kovac@example.com');
        assert.equal(r.body.shape, 'attendee');
        assert.equal(r.body.salutation, 'Dr. Kovač');
        const row = rowOf(addedId);
        assert.equal(row.status, 'registered');
        assert.equal(row.first_name, 'Ivana');
        assert.equal(row.institution, 'Brigham and Women\'s Hospital');
        assert.equal(row.position, 'Attending Physician');
        assert.match(row.notes, new RegExp('^Added by team ' + TODAY + '$'));
        assert.strictEqual(row.presenter_status, null);
        assert.equal(sentEmails.length, before, 'adding sends nothing — the Boston email is the next click');
        const c = await catering();
        assert.ok(prow(c.body, addedId), 'in the seats table');
        assert.equal(prow(c.body, addedId).added_by_team, true);
        const p = await presenters();
        assert.ok(!prow(p.body, addedId), 'a plain guest is not on the presenters table');
    });
    await t('the same email again (any case) is a 409 that points at the existing row', async () => {
        const r = await app.call('POST', '/api/v2/boston/guests/add', { body: { first_name: 'Ivana', last_name: 'Kovač', email: 'IVANA.KOVAC@example.com' } });
        assert.equal(r.status, 409);
        assert.equal(r.body.exists, true);
        assert.equal(r.body.registration_id, addedId);
        assert.equal(query.all('SELECT id FROM bridges_registrations WHERE email = ?', ['ivana.kovac@example.com']).length, 1);
    });
    await t('a released seat\'s email is a 409 that says restore instead', async () => {
        const r = await app.call('POST', '/api/v2/boston/guests/add', { body: { first_name: 'Old', last_name: 'Cancel', email: 'old@example.com' } });
        assert.equal(r.status, 409);
        assert.equal(r.body.released, true);
        assert.match(r.body.error, /restore/);
    });
    await t('missing name or bad email is a 400 and nothing is inserted', async () => {
        const n = query.all('SELECT id FROM bridges_registrations').length;
        assert.equal((await app.call('POST', '/api/v2/boston/guests/add', { body: { first_name: 'X', email: 'x@example.com' } })).status, 400);
        assert.equal((await app.call('POST', '/api/v2/boston/guests/add', { body: { first_name: 'X', last_name: 'Y', email: 'not-an-email' } })).status, 400);
        assert.equal(query.all('SELECT id FROM bridges_registrations').length, n);
    });
    await t('"send their Boston email now": the added guest gets the attendee email, ticket inside', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/reminders/:id/send', { params: { id: addedId } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body.sent, ['ivana.kovac@example.com']);
        assert.equal(sentEmails.length, before + 1);
        const m = lastMail();
        assert.ok(m.html.includes('/api/boston/qr/' + addedId + '.png'), 'her own ticket');
        assert.ok(m.attachments && m.attachments.length === 1, 'the program PDF attached');
        assert.match(m.subject, /^Dr\. Kovač, your Building Bridges Boston details/);
        assert.match(notesOf(addedId), new RegExp('EMAIL-SHAPE attendee ' + TODAY));
    });
    await t('add a presenter by hand: decision confirmed at once, on the presenters table, 5-minute note present', async () => {
        const r = await app.call('POST', '/api/v2/boston/guests/add', { body: { first_name: 'Pero', last_name: 'Perić', email: 'pero@example.com', institution: 'MGH', position: 'Instructor', presenter: true } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.shape, 'presenter');
        const row = rowOf(r.body.registration_id);
        assert.equal(row.presenter_status, 'confirmed');
        assert.match(row.notes, /5-minute presentation requested \| Added by team/);
        const p = await presenters();
        const pr = prow(p.body, r.body.registration_id);
        assert.ok(pr, 'on the presenters table');
        assert.equal(pr.presenter, true);
        assert.equal(pr.added_by_team, true);
        assert.equal(pr.current_shape, 'presenter');
    });
    await t('add a panelist by hand: panel decision, awaiting reply, counted in panel-awaiting', async () => {
        const r = await app.call('POST', '/api/v2/boston/guests/add', { body: { first_name: 'Ana', last_name: 'Anić', email: 'ana.anic@example.com', panel: true } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.shape, 'panel');
        assert.equal(rowOf(r.body.registration_id).presenter_status, 'panel');
        const d = await app.call('GET', '/api/v2/boston/message/draft', { query: { id: r.body.registration_id } });
        assert.equal(d.body.suggested, 'panel');
        assert.equal(d.body.counts['panel-awaiting'], 2, 'Ruscic (restored) + Anić');
    });

    // ================================================================ the resend hint
    await t('after the Boston email went out as PRESENTER, flipping to PANEL marks shape_changed', async () => {
        const r0 = await app.call('POST', '/api/v2/boston/reminders/:id/send', { params: { id: ID.kellis } });
        assert.equal(r0.status, 200, JSON.stringify(r0.body));
        assert.match(notesOf(ID.kellis), new RegExp('EMAIL-SHAPE presenter ' + TODAY));
        let p = await presenters();
        assert.equal(prow(p.body, ID.kellis).sent_shape, 'presenter');
        assert.equal(prow(p.body, ID.kellis).current_shape, 'presenter');
        assert.equal(prow(p.body, ID.kellis).shape_changed, false);

        const r1 = await app.call('POST', '/api/v2/boston/presenters/:id/status', { params: { id: ID.kellis }, body: { status: 'panel' } });
        assert.equal(r1.status, 200, JSON.stringify(r1.body));
        p = await presenters();
        assert.equal(prow(p.body, ID.kellis).sent_shape, 'presenter');
        assert.equal(prow(p.body, ID.kellis).current_shape, 'panel');
        assert.equal(prow(p.body, ID.kellis).shape_changed, true, 'the card can now say "they already received the presenter email"');
    });
    await t('the resend re-stamps the shape and clears the hint — one marker, latest shape', async () => {
        const r = await app.call('POST', '/api/v2/boston/reminders/:id/send', { params: { id: ID.kellis } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.resent, true);
        const n = notesOf(ID.kellis);
        assert.equal((n.match(/EMAIL-SHAPE/g) || []).length, 1, 'one marker: ' + n);
        assert.match(n, new RegExp('EMAIL-SHAPE panel ' + TODAY));
        assert.equal((n.match(/REMINDER-SENT/g) || []).length, 1);
        const p = await presenters();
        assert.equal(prow(p.body, ID.kellis).shape_changed, false);
        assert.ok(lastMail().html.includes('panel discussion'), 'the panel shape went out');
    });
    await t('a guest never emailed never shows the hint, whatever the decision does', async () => {
        await app.call('POST', '/api/v2/boston/presenters/:id/status', { params: { id: ID.novak }, body: { status: 'declined' } });
        const p = await presenters();
        assert.strictEqual(prow(p.body, ID.novak).sent_shape, null);
        assert.equal(prow(p.body, ID.novak).shape_changed, false);
        await app.call('POST', '/api/v2/boston/presenters/:id/status', { params: { id: ID.novak }, body: { status: 'confirmed' } });
    });

    // ================================================================ nothing leaked
    await t('no email went anywhere except the guests addressed, Laura and the reviewer — never the held or cancelled rows', () => {
        const allowed = new Set(['kellis@example.com', 'babic@example.com', 'ruscic@example.com', 'ivana.kovac@example.com', SUPPORT_EMAIL, REVIEW_TO]);
        for (const m of sentEmails) assert.ok(allowed.has(m.to), 'unexpected recipient: ' + m.to + ' (' + m.subject + ')');
        assert.equal(adminEmails.length, 0, 'the admin side must never send');
    });
    await t('every deed left an audit line', () => {
        const actions = query.all('SELECT action FROM audit_log').map(r => r.action);
        for (const a of ['boston.team_message', 'boston.team_message_bulk', 'boston.seat_released_by_team', 'boston.guest_added', 'boston.seat_restored']) {
            assert.ok(actions.includes(a), 'no audit line for ' + a);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
