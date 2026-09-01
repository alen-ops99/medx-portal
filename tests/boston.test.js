/**
 * tests/boston.test.js — Building Bridges Boston wing (user-portal/backend/boston.js).
 *
 * Hermetic on purpose: a stub express app collects routes, a scratch in-memory sqlite
 * (node:sqlite — no npm install needed) carries the REAL bridges_events /
 * bridges_registrations schema (CREATE TABLEs + ALTERs copied verbatim from
 * user-portal/backend/server.js), sendEmail is a capturing stub, global.fetch is
 * disabled, and the shared wallet's network provisioners are stubbed out.
 * A REAL EMAIL SEND OR ANY NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Run:  node tests/boston.test.js
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- hermetic env
delete process.env.BREVO_API_KEY;                       // belt: the module never touches Brevo anyway
delete process.env.GOOGLE_SHEETS_WEBHOOK;               // no sheets POST in tests
delete process.env.RENDER_EXTERNAL_URL;                 // deterministic base URL
delete process.env.PUBLIC_BASE_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_')) delete process.env[k];
// Google Wallet configured with a throwaway key so the save-URL appears in the email HTML.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000099999999';
process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify({
    client_email: 'test-sa@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
});
process.env.GOOGLE_WALLET_EVENT_CLASS_ID = '3388000000099999999.plexus_week_2026';

// Kill the network entirely — the sheets webhook is env-gated off above, and the wallet
// provisioners are stubbed below; anything else that tries the wire fails loudly.
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

// Wallet provisioning (ensureEventClass/ensureEventObject) would call Google — stub the
// shared module BEFORE the wing is required (same require-cache instance).
const wallet = require('../shared/wallet.js');
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const mountBoston = require('../user-portal/backend/boston.js');

// ---------------------------------------------------------------- scratch sqlite (real schema)
const raw = new DatabaseSync(':memory:');
// CREATE TABLEs — verbatim from user-portal/backend/server.js (initializeApp)
raw.exec(`CREATE TABLE IF NOT EXISTS bridges_events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    venue_name TEXT,
    venue_address TEXT,
    event_date TEXT NOT NULL,
    event_time TEXT,
    end_time TEXT,
    description TEXT,
    capacity INTEGER DEFAULT 50,
    registration_open INTEGER DEFAULT 1,
    registration_deadline TEXT,
    status TEXT DEFAULT 'upcoming',
    contact_email TEXT,
    contact_phone TEXT,
    notes TEXT,
    price REAL DEFAULT 0,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
raw.exec(`CREATE TABLE IF NOT EXISTS bridges_registrations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    institution TEXT,
    position TEXT,
    dietary_requirements TEXT,
    special_requests TEXT,
    status TEXT DEFAULT 'registered',
    payment_status TEXT DEFAULT 'n/a',
    amount_paid REAL,
    confirmation_sent INTEGER DEFAULT 0,
    reminder_sent INTEGER DEFAULT 0,
    checked_in INTEGER DEFAULT 0,
    checked_in_at TEXT,
    notes TEXT,
    registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES bridges_events(id) ON DELETE CASCADE
)`);
// ALTERs server.js applies on boot (the ones this schema gains in prod)
raw.exec(`ALTER TABLE bridges_events ADD COLUMN is_published INTEGER DEFAULT 0`);
raw.exec(`ALTER TABLE bridges_events ADD COLUMN slug TEXT`);
raw.exec(`ALTER TABLE bridges_registrations ADD COLUMN user_id TEXT`);
raw.exec(`ALTER TABLE bridges_registrations ADD COLUMN qr_code TEXT`);

// server.js-shaped query helper over node:sqlite
const query = {
    run: (sql, params = []) => { params.length ? raw.prepare(sql).run(...params) : raw.exec(sql); },
    get: (sql, params = []) => { const r = raw.prepare(sql).get(...params); return r === undefined ? null : r; },
    all: (sql, params = []) => raw.prepare(sql).all(...params)
};

// ---------------------------------------------------------------- stub express + email
function makeApp() {
    const routes = {};
    const reg = m => (p, ...handlers) => { routes[m + ' ' + p] = handlers[handlers.length - 1]; };
    return { get: reg('GET'), post: reg('POST'), routes };
}
function makeRes() {
    const r = { statusCode: 200, headers: {}, body: undefined, file: undefined };
    const res = {
        status(c) { r.statusCode = c; return res; },
        json(o) { r.body = o; return res; },
        send(x) { r.body = x; return res; },
        set(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) r.headers[a.toLowerCase()] = b; } else r.headers[String(k).toLowerCase()] = v; return res; },
        setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; },
        sendFile(p) { r.file = p; r.body = '[sendFile] ' + p; },
        _r: r
    };
    return res;
}
async function call(app, method, path, { body, params } = {}) {
    const h = app.routes[method + ' ' + path];
    if (!h) throw new Error('route not mounted: ' + method + ' ' + path);
    const req = { body: body || {}, params: params || {}, query: {}, get: () => '' };
    const res = makeRes();
    await h(req, res);
    return res._r;
}

const sentEmails = [];                                  // { to, subject, html } — the ONLY email sink
const sendEmailStub = async (to, subject, html) => { sentEmails.push({ to, subject, html }); return { success: true }; };

const JWT_SECRET = 'test-secret-boston';
const app = makeApp();
mountBoston(app, { query, saveDb: () => {}, sendEmail: sendEmailStub, flushDb: () => {}, JWT_SECRET });

const EVENT_ID = 'bb-boston-2026-09-21';
const BASE = 'https://medx-user-portal.onrender.com';

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

(async () => {
    console.log('boston.test.js — hermetic (stub express, node:sqlite scratch DB, captured emails)\n');

    // -------- routes exist
    await t('all six routes are mounted', () => {
        for (const k of ['GET /boston', 'GET /boston/hero.jpg', 'GET /boston/hmpa.png',
            'POST /api/boston/register', 'GET /boston.ics', 'GET /api/boston/pass/:token.pkpass']) {
            assert.ok(app.routes[k], 'missing ' + k);
        }
    });

    // -------- validation 400s (also proves no event row is created for garbage)
    await t('missing everything -> 400', async () => {
        const r = await call(app, 'POST', '/api/boston/register', { body: {} });
        assert.strictEqual(r.statusCode, 400);
    });
    await t('bad email -> 400', async () => {
        const r = await call(app, 'POST', '/api/boston/register', { body: { name: 'Ana Horvat', email: 'not-an-email', institution: 'MGH' } });
        assert.strictEqual(r.statusCode, 400);
    });
    await t('missing institution -> 400', async () => {
        const r = await call(app, 'POST', '/api/boston/register', { body: { name: 'Ana Horvat', email: 'ana@example.org' } });
        assert.strictEqual(r.statusCode, 400);
    });
    await t('missing name -> 400', async () => {
        const r = await call(app, 'POST', '/api/boston/register', { body: { email: 'ana@example.org', institution: 'MGH' } });
        assert.strictEqual(r.statusCode, 400);
    });

    // -------- happy path
    let anaId = null;
    await t('happy path: 200 {success:true}, row inserted, email sent once', async () => {
        const r = await call(app, 'POST', '/api/boston/register', {
            body: { name: 'Ana Horvat', email: 'Ana@Example.org', institution: 'Massachusetts General Hospital', position: 'Postdoctoral fellow', presentation: false }
        });
        assert.strictEqual(r.statusCode, 200);
        assert.deepStrictEqual(r.body, { success: true });
        const rows = query.all('SELECT * FROM bridges_registrations WHERE event_id = ?', [EVENT_ID]);
        assert.strictEqual(rows.length, 1);
        const row = rows[0];
        anaId = row.id;
        assert.strictEqual(row.first_name, 'Ana');
        assert.strictEqual(row.last_name, 'Horvat');
        assert.strictEqual(row.email, 'Ana@Example.org');
        assert.strictEqual(row.institution, 'Massachusetts General Hospital');
        assert.strictEqual(row.position, 'Postdoctoral fellow');
        assert.strictEqual(row.notes, null);                       // no presentation ticked
        assert.strictEqual(row.status, 'registered');
        assert.strictEqual(Number(row.confirmation_sent), 1);      // flipped after the stub "send"
        assert.strictEqual(sentEmails.length, 1);
        assert.strictEqual(sentEmails[0].to, 'Ana@Example.org');
    });

    await t('confirmation email HTML: QR url + Google save url + dress + date, no undefined', () => {
        const html = sentEmails[0].html;
        assert.ok(html.includes(`${BASE}/qr/${anaId}.png`), 'hosted QR url missing');
        assert.ok(html.includes('https://pay.google.com/gp/v/save/'), 'Google Wallet save url missing');
        assert.ok(html.includes('Business attire'), 'dress code missing');
        assert.ok(html.includes('21 September 2026'), 'date missing');
        assert.ok(html.includes('Monday'), 'weekday missing');
        assert.ok(html.includes('Free'), 'price missing');
        assert.ok(html.includes('25 Shattuck Street'), 'venue address missing');
        assert.ok(html.includes('BB-BOS-' + String(anaId).slice(0, 8).toUpperCase()), 'ticket number missing');
        assert.ok(html.includes(`${BASE}/boston.ics`), 'calendar url missing');
        assert.ok(!html.includes('undefined'), 'literal "undefined" leaked into the email');
        assert.ok(!html.includes('NaN'), 'literal "NaN" leaked into the email');
    });

    await t('Apple button omitted while APPLE_WALLET_* env is absent', () => {
        assert.ok(!sentEmails[0].html.includes('/api/boston/pass/'), 'Apple pass link should be omitted when unconfigured');
    });

    // -------- event row auto-creation (exactly once, with the fixed id + confirmed facts)
    await t('event row auto-created once with fixed id', async () => {
        await call(app, 'POST', '/api/boston/register', {
            body: { name: 'Ivan Kovac', email: 'ivan@example.org', institution: 'Harvard Medical School', presentation: true }
        });
        const evts = query.all('SELECT * FROM bridges_events WHERE id = ?', [EVENT_ID]);
        assert.strictEqual(evts.length, 1);
        const all = query.all("SELECT COUNT(*) AS n FROM bridges_events");
        assert.strictEqual(Number(all[0].n), 1, 'no stray second event row');
        const e = evts[0];
        assert.strictEqual(e.slug, 'boston-2026');
        assert.strictEqual(e.city, 'Boston');
        assert.strictEqual(e.event_date, '2026-09-21');
        assert.strictEqual(e.event_time, '18:00');
        assert.strictEqual(e.end_time, '21:00');
        assert.strictEqual(Number(e.capacity), 60);
        assert.strictEqual(Number(e.registration_open), 1);
        assert.strictEqual(Number(e.is_published), 0);
        assert.strictEqual(e.venue_name, 'Waterhouse Room, Gordon Hall');
    });

    // -------- presentation flag
    await t('presentation flag lands in notes + intro line + ticket label', () => {
        const row = query.get('SELECT * FROM bridges_registrations WHERE LOWER(email) = ?', ['ivan@example.org']);
        assert.ok(row, 'ivan row missing');
        assert.strictEqual(row.notes, '5-minute presentation requested');
        const html = sentEmails[sentEmails.length - 1].html;
        assert.ok(html.includes('total number of requests'), 'presentation intro line missing');
        assert.ok(html.includes('5-minute presentation request'), 'ticket label suffix missing');
    });

    // -------- dedupe / re-send
    await t('duplicate email -> {already:true}, no second row, email re-sent', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/register', {
            body: { name: 'Ana Again', email: 'ANA@example.org', institution: 'Somewhere Else' }
        });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.already, true);
        const rows = query.all('SELECT * FROM bridges_registrations WHERE LOWER(email) = ?', ['ana@example.org']);
        assert.strictEqual(rows.length, 1, 'a duplicate row was created');
        assert.strictEqual(rows[0].first_name, 'Ana', 'original row must be untouched');
        assert.strictEqual(sentEmails.length, before + 1, 'confirmation was not re-sent');
        // Re-send goes to the ON-FILE address (same posture as /api/public-events/register)
        assert.strictEqual(sentEmails[sentEmails.length - 1].to, 'Ana@Example.org');
    });

    // -------- .ics
    await t('GET /boston.ics returns a single VEVENT with the UTC window', async () => {
        const r = await call(app, 'GET', '/boston.ics');
        assert.strictEqual(r.statusCode, 200);
        assert.ok(String(r.headers['content-type']).startsWith('text/calendar'), 'content-type');
        const body = String(r.body);
        assert.ok(body.includes('BEGIN:VEVENT') && body.includes('END:VEVENT'), 'VEVENT missing');
        assert.strictEqual(body.split('BEGIN:VEVENT').length, 2, 'exactly one VEVENT');
        assert.ok(body.includes('DTSTART:20260921T220000Z'), 'DTSTART wrong');
        assert.ok(body.includes('DTEND:20260922T010000Z'), 'DTEND wrong');
        assert.ok(body.includes('SUMMARY:Building Bridges in Biomedicine — Boston'), 'SUMMARY wrong');
        assert.ok(/LOCATION:Waterhouse Room\\,/.test(body), 'LOCATION missing/unescaped');
        assert.ok(body.includes('17:30'), 'doors note missing');
    });

    // -------- Apple pass route
    await t('pass route: bad tokens -> 404', async () => {
        for (const token of ['garbage', 'deadbeef.someid', 'f'.repeat(32) + '.' + anaId]) {
            const r = await call(app, 'GET', '/api/boston/pass/:token.pkpass', { params: { token } });
            assert.strictEqual(r.statusCode, 404, 'expected 404 for token ' + token);
        }
    });
    const mintToken = id => crypto.createHmac('sha256', JWT_SECRET).update('boston:' + id).digest('hex').slice(0, 32) + '.' + id;
    await t('pass route: valid token for unknown registration -> 404', async () => {
        const ghost = crypto.randomUUID();
        const r = await call(app, 'GET', '/api/boston/pass/:token.pkpass', { params: { token: mintToken(ghost) } });
        assert.strictEqual(r.statusCode, 404);
    });
    await t('pass route: valid token, Apple env absent -> graceful 503 JSON', async () => {
        const r = await call(app, 'GET', '/api/boston/pass/:token.pkpass', { params: { token: mintToken(anaId) } });
        assert.strictEqual(r.statusCode, 503);
        assert.ok(r.body && /Apple Wallet/.test(r.body.error), 'graceful JSON error expected');
    });

    // -------- page + assets
    await t('GET /boston renders the page (form, program, venue, HMPA, no undefined)', async () => {
        const r = await call(app, 'GET', '/boston');
        const html = String(r.body);
        assert.ok(html.includes('Building Bridges in Biomedicine'), 'headline');
        assert.ok(html.includes('Monday, 21 September 2026'), 'date');
        assert.ok(html.includes('Waterhouse Room, Gordon Hall'), 'venue');
        assert.ok(html.includes('Harvard Medical Postdoc Association'), 'HMPA line');
        assert.ok(html.includes('5-minute presentation of my lab, clinic, department, or institution'), 'checkbox wording');
        assert.ok(html.includes('Presentation slots are confirmed by email'), 'slots note');
        assert.ok(html.includes('/api/boston/register'), 'form posts to the API');
        assert.ok(html.includes('/boston/hero.jpg') && html.includes('/boston/hmpa.png'), 'hero + HMPA assets referenced');
        assert.ok(html.includes('laura.rodman@medx.hr'), 'support line');
        assert.ok(html.includes('Business attire'), 'dress code');
        assert.ok(!html.includes('undefined'), 'literal "undefined" leaked into the page');
    });
    await t('hero + HMPA assets are served from backend files', async () => {
        const a = await call(app, 'GET', '/boston/hero.jpg');
        assert.ok(/boston-hero\.jpg$/.test(a.file), 'hero sendFile path');
        const b = await call(app, 'GET', '/boston/hmpa.png');
        assert.ok(/hmpa-logo\.png$/.test(b.file), 'hmpa sendFile path');
    });

    // -------- absolute safety: every "send" went to the stub
    await t('no email escaped the stub; no network was touched', () => {
        assert.ok(sentEmails.length >= 3);
        for (const m of sentEmails) assert.ok(m.html && m.to);
        assert.ok(!process.env.BREVO_API_KEY, 'BREVO_API_KEY must stay unset in tests');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
