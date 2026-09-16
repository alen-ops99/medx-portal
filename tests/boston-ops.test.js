/**
 * tests/boston-ops.test.js — the ADMIN portal's Boston presenters panel
 * (admin-portal/backend/v2/boston-ops.js, rendered by frontend-v2 › js/views/bridges.js).
 *
 * Hermetic, and shaped like production: a stub express app collects the routes, ONE in-memory
 * libsql database (the same shared/db.js wrapper both portals use) carries the real
 * bridges_events / bridges_registrations schema, and BOTH sides are mounted on it — the member
 * wing `user-portal/backend/boston.js` and the admin module under test — exactly as the live
 * services share one Turso DB.
 *
 * The admin module reaches the member portal over HTTP, so global.fetch is REPLACED with a
 * dispatcher that routes `http://member.test/api/boston/…` straight into the member wing's own
 * handlers. That makes the whole chain real: the admin mints the team key from JWT_SECRET, the
 * member wing verifies it, the member wing sends the email and stamps the notes, and the admin
 * list reads that stamp back. sendEmail is a capturing stub and every other network call throws,
 * so A REAL EMAIL SEND OR ANY NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Run:  node tests/boston-ops.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';                          // short retry budget in the module
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.GOOGLE_SHEETS_WEBHOOK;
for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_') || k.startsWith('BB_S3_')) delete process.env[k];
process.env.PUBLIC_BASE_URL = 'https://portal.test';
process.env.USER_PORTAL_URL = 'http://member.test';     // where the admin module looks for the member

// Google Wallet off — the wing degrades to "no pass" and the confirmation path is not exercised.
delete process.env.GOOGLE_WALLET_ISSUER_ID;
delete process.env.GOOGLE_WALLET_SA_KEY;

const wallet = require(path.join(ROOT, 'shared/wallet.js'));
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));

const JWT_SECRET = 'test-secret-boston-ops';
const EVENT_ID = 'bb-boston-2026-09-21';
const MEMBER = 'http://member.test';
const ADMIN_KEY = crypto.createHmac('sha256', JWT_SECRET).update('boston-admin').digest('hex').slice(0, 40);

// ---------------------------------------------------------------- tiny harness
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

// server.js-shaped { run, get, all } over the same wrapper — what the member wing expects.
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
const sentEmails = [];                                  // the ONLY email sink on the member side
const adminEmails = [];                                 // must stay EMPTY — the admin never sends

const mountBoston = require(path.join(ROOT, 'user-portal/backend/boston.js'));
mountBoston(app, { query, saveDb: () => {}, flushDb: () => {}, JWT_SECRET,
    sendEmail: async (to, subject, html, attachments) => { sentEmails.push({ to, subject, html, attachments: attachments || null }); return { success: true }; } });

// The program PDF gates every real send on the member side (a send without it would leave the
// room without the program), so give this test one — FAKE credentials, and every S3 read is a
// stub, so nothing can reach AWS.
process.env.BB_S3_BUCKET = 'medx-bb-ops-test';
process.env.BB_S3_REGION = 'us-east-1';
process.env.BB_S3_KEY = 'AKIATESTTESTTESTTEST';
process.env.BB_S3_SECRET = 'test-secret-not-real';
const PROGRAM_BYTES = Buffer.from('%PDF-1.7\nBuilding Bridges Boston — program\n%%EOF');
mountBoston._s3.putObject = async () => ({ etag: '"stub-etag"' });
mountBoston._s3.getObject = async () => PROGRAM_BYTES;
mountBoston._s3.headObject = async () => ({ size: PROGRAM_BYTES.length, lastModified: '2026-09-13T09:00:00.000Z' });

// The admin module talks to the member over HTTP — dispatch that back into these same handlers.
// A real URL carries values where the mounted route carries `:name`, so resolve the pattern and
// hand the handler its params: without this every member route with a path parameter is a 404 here
// and the test would be proving nothing.
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
    const q = Object.fromEntries(u.searchParams.entries());
    fetchLog.push({ method: init.method || 'GET', path: u.pathname, key: q.key, body: init.body ? JSON.parse(init.body) : undefined });
    const hit = resolveRoute(init.method || 'GET', u.pathname);
    if (!hit) return { ok: false, status: 404, text: async () => JSON.stringify({ error: 'Not found' }) };
    const r = await app.call(init.method || 'GET', hit.path, { query: q, params: hit.params, body: init.body ? JSON.parse(init.body) : {}, user: null });
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body === undefined ? {} : r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
};

const mountBostonOps = require(path.join(ROOT, 'admin-portal/backend/v2/boston-ops.js'));
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'no' }));
const adminOnly = (req, res, next) => next();
mountBostonOps(app, {
    db: () => db,
    auth,
    adminOnly,
    sendEmail: async (to, subject, html) => { adminEmails.push({ to, subject, html }); return { success: true }; },
    saveDb: () => {}, JWT_SECRET, ROOT, log: () => {}
});

// ---------------------------------------------------------------- seed
const TODAY = new Date().toISOString().slice(0, 10);
function seedReg(id, first, last, email, notes, status) {
    query.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, notes, status, payment_status, confirmation_sent)
               VALUES (?,?,?,?,?,?,?,?, 'n/a', 1)`,
        [id, EVENT_ID, first, last, email, first + ' Institute', notes, status || 'registered']);
}
seedReg('reg-ana', 'Ana', 'Horvat', 'ana@example.com', '5-minute presentation requested');
seedReg('reg-luka', 'Luka', 'Babic', 'luka@example.com', '5-minute presentation requested');
seedReg('reg-mia', 'Mia', 'Novak', 'mia@example.com', null);                       // guest, not presenting
seedReg('reg-old', 'Old', 'Cancel', 'old@example.com', '5-minute presentation requested', 'cancelled');

const presenters = () => app.call('GET', '/api/v2/boston/presenters');
const rowOf = (body, id) => (body.rows || []).find(r => r.registration_id === id);
const notesOf = id => String((query.get('SELECT notes FROM bridges_registrations WHERE id = ?', [id]) || {}).notes || '');

(async () => {
    console.log('boston-ops.test.js — hermetic (stub express, one in-memory libsql DB, both portals mounted, captured emails)\n');

    await t('the admin routes are mounted', () => {
        for (const k of ['GET /api/v2/boston/presenters', 'POST /api/v2/boston/presenters/:id/send-link',
            'POST /api/v2/boston/presenters/:id/status', 'POST /api/v2/boston/presenters/decline-undecided',
            'POST /api/v2/boston/presenters/send-all', 'POST /api/v2/boston/presenters/add',
            'GET /api/v2/boston/presentations.zip']) {
            assert.ok(app.routes[k], 'missing route: ' + k);
        }
    });

    await t('every route is behind auth + adminOnly', () => {
        // [auth, adminOnly, handler] — the program upload adds its multipart parser between
        // adminOnly and the handler, so the rule is "the first two are the gate", not "length 3".
        for (const k of Object.keys(app.routes).filter(k => k.includes('/api/v2/boston'))) {
            const chain = app.routes[k];
            assert.ok(chain.length >= 3, k + ' should be [auth, adminOnly, …, handler]');
            assert.strictEqual(chain[0], auth, k + ' must start with auth');
            assert.strictEqual(chain[1], adminOnly, k + ' must be adminOnly');
        }
    });

    await t('a signed-out request is refused', async () => {
        const r = await app.call('GET', '/api/v2/boston/presenters', { user: null });
        assert.equal(r.status, 401);
    });

    // -------- the list
    await t('the list proxies the member portal and mints the team key itself', async () => {
        const r = await presenters();
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        const call = fetchLog.find(f => f.path === '/api/boston/presentations');
        assert.ok(call, 'the member JSON was never fetched');
        assert.equal(call.key, ADMIN_KEY, 'the admin did not mint the member wing\'s own team key');
    });

    await t('the list carries the presenters and skips the plain guest', async () => {
        const r = await presenters();
        assert.ok(rowOf(r.body, 'reg-ana'), 'Ana is missing');
        assert.ok(rowOf(r.body, 'reg-luka'), 'Luka is missing');
        assert.ok(!rowOf(r.body, 'reg-mia'), 'a non-presenter leaked into the list');
        assert.equal(rowOf(r.body, 'reg-ana').institution, 'Ana Institute');
        assert.equal(rowOf(r.body, 'reg-ana').email, 'ana@example.com');
    });

    await t('nobody is invited yet — invited_at null, and the cancelled row is not counted as sendable', async () => {
        const r = await presenters();
        assert.strictEqual(rowOf(r.body, 'reg-ana').invited_at, null);
        assert.equal(r.body.invited, 0);
        assert.equal(r.body.not_invited, 2, 'the cancelled registration must not be offered a link');
        assert.equal(rowOf(r.body, 'reg-old').status, 'cancelled');
    });

    await t('the ZIP link is the member URL with the key', async () => {
        const r = await presenters();
        assert.equal(r.body.zip_url, MEMBER + '/api/boston/presentations.zip?key=' + ADMIN_KEY);
    });

    // -------- send one
    await t('send-link mails ONE presenter through the member wing and stamps the notes', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/presenters/:id/send-link', { params: { id: 'reg-ana' } });
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.sent, ['ana@example.com']);
        assert.equal(r.body.resent, false);
        assert.equal(sentEmails.length, before + 1, 'exactly one email');
        assert.equal(sentEmails[sentEmails.length - 1].to, 'ana@example.com');
        assert.match(sentEmails[sentEmails.length - 1].subject, /5-minute presentation/);
        assert.match(notesOf('reg-ana'), new RegExp('UPLOAD-LINK-SENT ' + TODAY));
    });

    await t('the email carries that presenter\'s own HMAC upload link', () => {
        const sig = crypto.createHmac('sha256', JWT_SECRET).update('bostonup:reg-ana').digest('hex').slice(0, 32);
        assert.ok(sentEmails[sentEmails.length - 1].html.includes('/boston/upload/' + sig + '.reg-ana'),
            'the personal upload link is missing from the email');
    });

    await t('the list now shows the invited date, and the send-all count drops', async () => {
        const r = await presenters();
        assert.equal(rowOf(r.body, 'reg-ana').invited_at, TODAY);
        assert.equal(r.body.invited, 1);
        assert.equal(r.body.not_invited, 1);
    });

    await t('a second send is reported as a re-send', async () => {
        const r = await app.call('POST', '/api/v2/boston/presenters/:id/send-link', { params: { id: 'reg-ana' } });
        assert.equal(r.status, 200);
        assert.equal(r.body.resent, true);
    });

    await t('an unknown id is a 404, and nothing is emailed', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/presenters/:id/send-link', { params: { id: 'no-such-row' } });
        assert.equal(r.status, 404);
        assert.equal(sentEmails.length, before);
    });

    // -------- send all
    await t('send-all skips whoever already has a link and never touches the cancelled row', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/presenters/send-all', {});
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.sent, ['luka@example.com'], 'only the uninvited, active presenter');
        assert.equal(sentEmails.length, before + 1);
        assert.match(notesOf('reg-luka'), /UPLOAD-LINK-SENT/);
        assert.ok(!/UPLOAD-LINK-SENT/.test(notesOf('reg-old')), 'the cancelled registration was invited');
    });

    await t('send-all a second time sends nothing at all', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/presenters/send-all', {});
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.sent, []);
        assert.equal(sentEmails.length, before);
    });

    // -------- add
    await t('add creates the registration exactly as specified, and sends the link', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/presenters/add', { body: { name: 'Petar Marić', email: 'Petar@Example.com' } });
        assert.equal(r.status, 200);
        assert.equal(r.body.created, true);
        assert.deepEqual(r.body.sent, ['petar@example.com']);
        const row = query.get('SELECT * FROM bridges_registrations WHERE email = ?', ['petar@example.com']);
        assert.ok(row, 'no row was created');
        assert.equal(row.event_id, EVENT_ID);
        assert.equal(row.first_name, 'Petar');
        assert.equal(row.last_name, 'Marić');
        assert.equal(row.status, 'registered');
        assert.equal(Number(row.confirmation_sent), 0, 'confirmation_sent must stay 0 — no ticket');
        assert.match(row.notes, /5-minute presentation requested/);
        assert.match(row.notes, /added by team/);
        assert.equal(sentEmails.length, before + 1, 'exactly one email — the upload link, no confirmation');
        assert.match(sentEmails[sentEmails.length - 1].subject, /Upload your 5-minute presentation/);
    });

    await t('the added presenter appears in the list, flagged and invited', async () => {
        const r = await presenters();
        const row = (r.body.rows || []).find(x => x.email === 'petar@example.com');
        assert.ok(row, 'the added presenter is not in the list');
        assert.equal(row.added_by_team, true);
        assert.equal(row.invited_at, TODAY);
    });

    await t('adding an email that is already registered marks that row instead of duplicating it', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/presenters/add', { body: { name: 'Mia Novak', email: 'mia@example.com' } });
        assert.equal(r.status, 200);
        assert.equal(r.body.created, false);
        assert.equal(r.body.promoted, true);
        assert.equal(r.body.registration_id, 'reg-mia');
        assert.equal(query.all('SELECT id FROM bridges_registrations WHERE email = ?', ['mia@example.com']).length, 1, 'a duplicate row was created');
        assert.match(notesOf('reg-mia'), /5-minute presentation requested/);
        assert.deepEqual(r.body.sent, ['mia@example.com']);
        assert.equal(sentEmails.length, before + 1);
    });

    await t('adding a presenter twice does not create a second row', async () => {
        const r = await app.call('POST', '/api/v2/boston/presenters/add', { body: { name: 'Petar Marić', email: 'petar@example.com' } });
        assert.equal(r.status, 200);
        assert.equal(r.body.created, false);
        assert.equal(r.body.promoted, false);
        assert.equal(query.all('SELECT id FROM bridges_registrations WHERE email = ?', ['petar@example.com']).length, 1);
    });

    await t('a bad email and a missing name are refused before anything is written', async () => {
        const rows = query.all('SELECT id FROM bridges_registrations', []).length;
        const bad = await app.call('POST', '/api/v2/boston/presenters/add', { body: { name: 'Nobody', email: 'not-an-email' } });
        assert.equal(bad.status, 400);
        const noName = await app.call('POST', '/api/v2/boston/presenters/add', { body: { name: '  ', email: 'someone@example.com' } });
        assert.equal(noName.status, 400);
        assert.equal(query.all('SELECT id FROM bridges_registrations', []).length, rows, 'a refused add still wrote a row');
    });

    await t('a cancelled registration cannot be handed a link by add', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/presenters/add', { body: { name: 'Old Cancel', email: 'old@example.com' } });
        assert.equal(r.status, 409);
        assert.equal(sentEmails.length, before);
    });

    // -------- uploads + zip
    await t('an uploaded deck shows up as a downloadable row and lifts the uploaded count', async () => {
        query.run(`INSERT INTO bridges_presentations (id, registration_id, original_name, stored_key, mime, size, uploaded_at)
                   VALUES (?,?,?,?,?,?,?)`,
            ['pres-1', 'reg-ana', 'ana-deck.pdf', 'boston-2026/reg-ana/pres-1.pdf', 'application/pdf', 4096, new Date().toISOString()]);
        const r = await presenters();
        assert.equal(r.body.uploaded, 1);
        const row = rowOf(r.body, 'reg-ana');
        assert.equal(row.upload.filename, 'ana-deck.pdf');
        assert.ok(String(row.upload.download_url).includes('key=' + ADMIN_KEY), 'the deck download link is not keyed');
    });

    await t('the ZIP route 302s to the member archive with the key', async () => {
        const r = await app.call('GET', '/api/v2/boston/presentations.zip', {});
        assert.equal(r.status, 302);
        assert.equal(r.headers.location, MEMBER + '/api/boston/presentations.zip?key=' + ADMIN_KEY);
    });

    // -------- the see-you-next-week reminder (the same doctrine: the member wing does the send)
    await t('the four reminder / catering routes are mounted behind auth + adminOnly', () => {
        for (const k of ['GET /api/v2/boston/catering', 'POST /api/v2/boston/reminders/:id/send',
            'POST /api/v2/boston/reminders/send-all', 'GET /api/v2/boston/catering.csv']) {
            assert.ok(app.routes[k], 'missing route: ' + k);
            assert.equal(app.routes[k].length, 3, k + ' should be [auth, adminOnly, handler]');
        }
    });

    await t('the catering list comes through with the summary and a keyed CSV url', async () => {
        const r = await app.call('GET', '/api/v2/boston/catering', {});
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        assert.equal(r.body.total, r.body.rows.length);
        assert.equal(r.body.answered + r.body.not_answered, r.body.total, 'summary math');
        assert.ok(String(r.body.csv_url).includes('key=' + ADMIN_KEY), 'the CSV link is not keyed');
        assert.ok(r.body.rows.some(x => x.registration_id === 'reg-mia'), 'a non-presenter guest is on the reminder list too');
    });

    await t('sending ONE reminder goes out from the member wing and stamps the row', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/reminders/:id/send', { params: { id: 'reg-mia' } });
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.sent, ['mia@example.com']);
        assert.equal(r.body.resent, false);
        assert.equal(sentEmails.length, before + 1, 'exactly one email');
        assert.match(sentEmails[sentEmails.length - 1].subject, /Building Bridges Boston details — action needed/i);
        assert.match(notesOf('reg-mia'), /REMINDER-SENT \d{4}-\d{2}-\d{2}/);
        assert.equal(adminEmails.length, 0, 'still nothing sent from the admin side');
    });

    await t('a resend is reported as a resend', async () => {
        const r = await app.call('POST', '/api/v2/boston/reminders/:id/send', { params: { id: 'reg-mia' } });
        assert.equal(r.status, 200);
        assert.equal(r.body.resent, true);
    });

    await t('a guest who is not on the Boston list is a 404, and sends nothing', async () => {
        const before = sentEmails.length;
        const r = await app.call('POST', '/api/v2/boston/reminders/:id/send', { params: { id: 'nobody-at-all' } });
        assert.equal(r.status, 404);
        assert.equal(sentEmails.length, before);
    });

    await t('send-all reminds everyone left and skips the ones already reminded', async () => {
        const r = await app.call('POST', '/api/v2/boston/reminders/send-all', {});
        assert.equal(r.status, 200);
        assert.ok(!r.body.sent.includes('mia@example.com'), 'Mia already had hers');
        assert.ok(r.body.skipped_already_sent >= 1, 'the skip is reported');
        const again = await app.call('POST', '/api/v2/boston/reminders/send-all', {});
        assert.deepEqual(again.body.sent, [], 'a second click sends nothing');
    });

    await t('the catering CSV route 302s to the member export with the key', async () => {
        const r = await app.call('GET', '/api/v2/boston/catering.csv', {});
        assert.equal(r.status, 302);
        assert.equal(r.headers.location, MEMBER + '/api/boston/catering.csv?key=' + ADMIN_KEY);
    });

    await t('the program sheet (one CSV for the whole evening) hops the same way, and the card is told its url', async () => {
        assert.ok(app.routes['GET /api/v2/boston/program.csv'], 'route mounted');
        assert.equal(app.routes['GET /api/v2/boston/program.csv'].length, 3, '[auth, adminOnly, handler]');
        const r = await app.call('GET', '/api/v2/boston/program.csv', {});
        assert.equal(r.status, 302);
        assert.equal(r.headers.location, MEMBER + '/api/boston/program.csv?key=' + ADMIN_KEY);
        const c = await app.call('GET', '/api/v2/boston/catering', {});
        assert.equal(c.body.program_csv_url, MEMBER + '/api/boston/program.csv?key=' + ADMIN_KEY);
    });

    // -------- one-pagers, the program PDF, and the owner's two previews
    await t('the one-pager list and archive come through the same keyed hop', async () => {
        const r = await app.call('GET', '/api/v2/boston/onepagers', {});
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        assert.equal(r.body.total, r.body.rows.length, 'every active guest is a row');
        assert.ok(r.body.rows.some(x => x.registration_id === 'reg-mia'), 'a non-presenter is on the booklet list too');
        assert.ok(String(r.body.zip_url).includes('key=' + ADMIN_KEY), 'the archive link is keyed');
        const zip = await app.call('GET', '/api/v2/boston/onepagers.zip', {});
        assert.equal(zip.status, 302);
        assert.equal(zip.headers.location, MEMBER + '/api/boston/onepagers.zip?key=' + ADMIN_KEY);
    });

    await t('the catering read carries the program status and the one-pager archive link', async () => {
        const r = await app.call('GET', '/api/v2/boston/catering', {});
        assert.equal(r.status, 200);
        assert.ok(r.body.program, 'the card needs to know whether the PDF is there');
        assert.equal(r.body.program.present, true, 'this test has one');
        assert.ok(String(r.body.onepagers_zip_url).includes('key=' + ADMIN_KEY));
        assert.equal(typeof r.body.onepagers_received, 'number', 'the counts strip needs the number');
    });

    await t('the program status is read through the member portal', async () => {
        const r = await app.call('GET', '/api/v2/boston/program', {});
        assert.equal(r.status, 200);
        assert.equal(r.body.present, true);
        assert.equal(r.body.key, 'boston/program/program.pdf');
    });

    await t('a preview goes to the reviewer only — all four shapes, or one on request', async () => {
        const before = sentEmails.length;
        const both = await app.call('POST', '/api/v2/boston/reminders/preview', { body: {} });
        assert.equal(both.status, 200);
        assert.deepEqual(both.body.variants, ['presenter', 'attendee', 'declined', 'panel']);
        assert.equal(sentEmails.length, before + 4);
        for (const m of sentEmails.slice(-4)) assert.equal(m.to, 'juginovic.alen@gmail.com', 'previews go to the reviewer and nobody else');
        const one = await app.call('POST', '/api/v2/boston/reminders/preview', { body: { variant: 'attendee' } });
        assert.deepEqual(one.body.variants, ['attendee']);
        assert.equal(sentEmails.length, before + 5, 'four shapes, then one more on request');
        const bad = await app.call('POST', '/api/v2/boston/reminders/preview', { body: { variant: 'everybody' } });
        assert.equal(bad.status, 400, 'an invented variant is refused here too');
    });

    // -------- who actually presents: the owner's pick, proxied to the member wing
    // About thirty people offered and the evening holds far fewer. The panel is only the door —
    // the member wing owns the column, the three email shapes and the counts, so these tests prove
    // the hop and the bookkeeping line up, exactly like every other write on this card.
    await t('the panel can put somebody on the running order, and take them off', async () => {
        const mailsBefore = sentEmails.length;
        const off = await app.call('POST', '/api/v2/boston/presenters/:id/status',
            { params: { id: 'reg-luka' }, body: { status: 'declined' } });
        assert.equal(off.status, 200, JSON.stringify(off.body));
        assert.equal(off.body.presenter, false, 'no longer on the running order');
        assert.equal(off.body.presentation_requested, true, 'but the offer stays a fact');
        assert.equal(off.body.presenter_status, 'declined');
        assert.match(notesOf('reg-luka'), /5-minute presentation/, 'the notes were not rewritten');

        const on = await app.call('POST', '/api/v2/boston/presenters/:id/status',
            { params: { id: 'reg-luka' }, body: { status: 'confirmed' } });
        assert.equal(on.body.presenter, true, 'and back on again');
        assert.equal(sentEmails.length, mailsBefore, 'a decision is never a send');
    });

    await t('null puts a row back to undecided, and undecided still reads as presenting', async () => {
        const r = await app.call('POST', '/api/v2/boston/presenters/:id/status',
            { params: { id: 'reg-luka' }, body: { status: null } });
        assert.equal(r.status, 200);
        assert.equal(r.body.presenter_status, null, 'undecided');
        assert.equal(r.body.presenter, true, 'and treated as presenting until he decides');
        const row = rowOf((await presenters()).body, 'reg-luka');
        assert.equal(row.presenter_status, null);
        assert.equal(row.presentation_requested, true);
    });

    await t('the list carries the three counts, and they add up to the offers', async () => {
        await app.call('POST', '/api/v2/boston/presenters/:id/status', { params: { id: 'reg-ana' }, body: { status: 'confirmed' } });
        const b = (await presenters()).body;
        assert.equal(b.confirmed + b.declined + b.undecided, b.requested,
            `counts must partition the offers: ${b.confirmed}+${b.declined}+${b.undecided} vs ${b.requested}`);
        assert.ok(b.confirmed >= 1, 'Ana is counted confirmed');
    });

    await t("the fourth answer — 'panel' — passes the door and reaches the member side", async () => {
        const r = await app.call('POST', '/api/v2/boston/presenters/:id/status', { params: { id: 'reg-ana' }, body: { status: 'panel' } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.presenter_status, 'panel');
        assert.ok(fetchLog.some(f => f.path.endsWith('/status') && f.body && f.body.status === 'panel'), 'forwarded as panel');
    });

    await t('an invented status is refused, and a stranger is a 404', async () => {
        const bad = await app.call('POST', '/api/v2/boston/presenters/:id/status',
            { params: { id: 'reg-ana' }, body: { status: 'maybe' } });
        assert.equal(bad.status, 400, 'an invented status is refused at the door');
        const ghost = await app.call('POST', '/api/v2/boston/presenters/:id/status',
            { params: { id: 'nobody-at-all' }, body: { status: 'declined' } });
        assert.equal(ghost.status, 404, 'a stranger is not on the Boston list');
        const out = await app.call('POST', '/api/v2/boston/presenters/:id/status',
            { params: { id: 'reg-ana' }, body: { status: 'declined' }, user: null });
        assert.equal(out.status, 401, 'and a signed-out caller decides nothing');
    });

    await t('the bulk close-out declines every undecided offer and leaves the decided alone', async () => {
        const mailsBefore = sentEmails.length;
        const before = (await presenters()).body;
        const wasConfirmed = (before.rows || []).filter(r => r.presenter_status === 'confirmed').map(r => r.registration_id);
        assert.ok(before.undecided > 0, 'something must be undecided for this to mean anything');
        const r = await app.call('POST', '/api/v2/boston/presenters/decline-undecided', { body: {} });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.declined.length, before.undecided, 'every undecided offer was set');
        assert.deepEqual(r.body.failed, [], 'and none failed');
        const after = (await presenters()).body;
        assert.equal(after.undecided, 0, 'nothing is left open');
        for (const id of wasConfirmed) {
            assert.equal(rowOf(after, id).presenter_status, 'confirmed', id + ' must not be swept up');
        }
        assert.equal(sentEmails.length, mailsBefore, 'and the bulk close-out is not a send either');
    });

    await t('a declined presenter is never sent the slides link, even by name', async () => {
        const mailsBefore = sentEmails.length;
        const declined = ((await presenters()).body.rows || []).find(r => r.presenter_status === 'declined');
        assert.ok(declined, 'the sweep above left one');
        await app.call('POST', '/api/v2/boston/presenters/:id/send-link', { params: { id: declined.registration_id } });
        assert.equal(sentEmails.length, mailsBefore, 'nothing left for somebody who is not presenting');
    });

    // put the room back the way the later tests expect it
    await app.call('POST', '/api/v2/boston/presenters/:id/status', { params: { id: 'reg-ana' }, body: { status: null } });
    await app.call('POST', '/api/v2/boston/presenters/:id/status', { params: { id: 'reg-luka' }, body: { status: null } });

    // -------- released seats, and the team's undo
    // A guest hands the seat back from the one email; the card offers Restore. Both writes belong
    // to the member wing, so the panel is only proving that the door and the bookkeeping line up.
    // Registration ids are UUIDs in production and the diet-token grammar says so — this guest is
    // seeded with one because she is the only row here that has to mint a real one-tap token.
    const REL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await t('a seat released from the one email shows up in the catering read, out of the count', async () => {
        seedReg(REL, 'Petra', 'Maric', 'petra@example.com', null);
        const before = await app.call('GET', '/api/v2/boston/catering', {});
        const heldBefore = Number(before.body.total) || 0;
        assert.ok(heldBefore > 0 && (before.body.released_count || 0) === 0, 'nobody has released a seat yet');

        const dietToken = id => crypto.createHmac('sha256', JWT_SECRET).update('boston:diet:' + id).digest('hex').slice(0, 32) + '.' + id;
        const out = await app.call('POST', '/api/boston/rsvp/:token/cannot-attend',
            { params: { token: dietToken(REL) }, user: null });
        assert.equal(out.status, 200);
        assert.equal(out.body.success, true);

        const after = await app.call('GET', '/api/v2/boston/catering', {});
        assert.equal(after.body.total, heldBefore - 1, 'the seat left the count');
        assert.equal(after.body.registered, heldBefore - 1, 'and "registered N" agrees');
        assert.equal(after.body.released_count, 1, 'the released list has her');
        assert.equal((after.body.released[0] || {}).name, 'Petra Maric');
        assert.match(String((after.body.released[0] || {}).released_on), /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(!(after.body.rows || []).some(r => r.registration_id === REL), 'and she is out of the guest rows');
    });

    await t('Restore puts the seat back, through the member wing, and is auditable', async () => {
        const r = await app.call('POST', '/api/v2/boston/registrations/:id/restore', { params: { id: REL } });
        assert.equal(r.status, 200);
        assert.equal(r.body.success, true);
        assert.equal(r.body.status, 'registered');
        assert.equal(String((query.get('SELECT status FROM bridges_registrations WHERE id = ?', [REL]) || {}).status), 'registered');
        assert.match(notesOf(REL), /RESTORED-BY-TEAM \d{4}-\d{2}-\d{2}/, 'the dated marker');
        assert.match(notesOf(REL), /CANCELLED-BY-GUEST/, 'the history is kept');
        const hop = fetchLog[fetchLog.length - 1];
        assert.equal(hop.path, '/api/boston/registrations/' + REL + '/restore', 'the member wing did the deed');
        assert.equal(hop.key, ADMIN_KEY, 'behind the same derived key');
        const after = await app.call('GET', '/api/v2/boston/catering', {});
        assert.equal(after.body.released_count, 0, 'nothing left in the released list');
    });

    await t('restore refuses a stranger and a signed-out caller', async () => {
        const nobody = await app.call('POST', '/api/v2/boston/registrations/:id/restore', { params: { id: 'reg-nobody' } });
        assert.equal(nobody.status, 404);
        const out = await app.call('POST', '/api/v2/boston/registrations/:id/restore', { params: { id: REL }, user: null });
        assert.equal(out.status, 401);
    });

    // -------- the two standing guarantees
    await t('the admin module never sends an email itself', () => {
        assert.equal(adminEmails.length, 0, 'boston-ops called sendEmail — every send belongs to the member wing');
    });

    await t('every member call carried the key, and none went anywhere else', () => {
        assert.ok(fetchLog.length > 0);
        for (const f of fetchLog) {
            assert.equal(f.key, ADMIN_KEY, f.method + ' ' + f.path + ' went out without the team key');
            assert.match(f.path, /^\/api\/boston\//);
        }
    });

    await t('the panel is auditable — every send left an audit_log row', () => {
        const rows = query.all("SELECT action FROM audit_log WHERE action LIKE 'boston.%'", []);
        assert.ok(rows.some(r => r.action === 'boston.upload_link_sent'));
        assert.ok(rows.some(r => r.action === 'boston.upload_links_sent_all'));
        assert.ok(rows.some(r => r.action === 'boston.presenter_added'));
        assert.ok(rows.some(r => r.action === 'boston.reminder_sent'));
        assert.ok(rows.some(r => r.action === 'boston.reminders_sent_all'));
        assert.ok(rows.some(r => r.action === 'boston.seat_restored'));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})();
