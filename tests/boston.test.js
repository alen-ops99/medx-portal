/**
 * tests/boston.test.js — Building Bridges Boston wing (user-portal/backend/boston.js).
 *
 * Hermetic on purpose: a stub express app collects routes, a scratch in-memory sqlite
 * (node:sqlite — no npm install needed) carries the REAL bridges_events /
 * bridges_registrations schema (CREATE TABLEs + ALTERs copied verbatim from
 * user-portal/backend/server.js), sendEmail is a capturing stub, global.fetch is
 * disabled, the shared wallet's network provisioners are stubbed, and the wing's S3
 * client has putObject REPLACED with a capturing stub (presignGet is pure string math
 * and runs for real — proven against AWS's published SigV4 test vector below).
 * A REAL EMAIL SEND, S3 CALL, OR ANY NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Run:  node tests/boston.test.js
 * (One test — branded-QR decodability — additionally wants user-portal/backend's
 *  node_modules installed for qrcode/pngjs/jsqr; without them it self-skips loudly.)
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createRequire } = require('node:module');

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
// Dedicated Boston class (prod: '3388000000023175280.medx-bb-boston-2026') — must win over the shared class.
process.env.BB_GOOGLE_CLASS_ID = '3388000000099999999.medx-bb-boston-2026';
// Presentation-upload S3 env — FAKE credentials; putObject is stubbed below and presignGet never
// touches the network (pure computation), so these can never reach AWS.
process.env.BB_S3_BUCKET = 'medx-bb-presentations-test';
process.env.BB_S3_REGION = 'us-east-1';
process.env.BB_S3_KEY = 'AKIATESTTESTTESTTEST';
process.env.BB_S3_SECRET = 'test-secret-not-real';

// Kill the network entirely — the sheets webhook is env-gated off above, and the wallet
// provisioners are stubbed below; anything else that tries the wire fails loudly.
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

// Wallet provisioning (ensureEventClass/ensureEventObject) would call Google — stub the
// shared module BEFORE the wing is required (same require-cache instance).
const wallet = require('../shared/wallet.js');
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const mountBoston = require('../user-portal/backend/boston.js');

// S3 PUT — capture instead of the wire (the SAME object the routes call through).
const s3Puts = [];
mountBoston._s3.putObject = async (key, body, contentType) => {
    s3Puts.push({ key, size: body.length, contentType });
    return { etag: '"stub-etag"' };
};

// Backend-resolved optional libs for the QR decode test (self-skip when not installed).
const backendRequire = createRequire(require.resolve('../user-portal/backend/boston.js'));
const tryReq = n => { try { return backendRequire(n); } catch (e) { return null; } };
const pngjsT = tryReq('pngjs');
const jsQRT = tryReq('jsqr');
const QRCodeT = tryReq('qrcode');

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
// bridges_presentations is NOT pre-created here — the wing must create it lazily itself.

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
        redirect(code, url) { r.statusCode = code; r.headers.location = url; },
        sendFile(p) { r.file = p; r.body = '[sendFile] ' + p; },
        get headersSent() { return false; },
        _r: r
    };
    return res;
}
async function call(app, method, path, { body, params, query: qs, file } = {}) {
    const h = app.routes[method + ' ' + path];
    if (!h) throw new Error('route not mounted: ' + method + ' ' + path);
    const req = { body: body || {}, params: params || {}, query: qs || {}, file, get: () => '' };
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
const MAX = 25 * 1024 * 1024;
const mintPassToken = id => crypto.createHmac('sha256', JWT_SECRET).update('boston:' + id).digest('hex').slice(0, 32) + '.' + id;
const mintUploadToken = id => crypto.createHmac('sha256', JWT_SECRET).update('bostonup:' + id).digest('hex').slice(0, 32) + '.' + id;
const ADMIN_KEY = crypto.createHmac('sha256', JWT_SECRET).update('boston-admin').digest('hex').slice(0, 40);
const pdfBuf = (extra = 64) => Buffer.concat([Buffer.from('%PDF-1.7\n% Building Bridges Boston deck\n'), Buffer.alloc(extra, 0x20)]);
const zipBuf = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(96, 0)]);

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

(async () => {
    console.log('boston.test.js — hermetic (stub express, node:sqlite scratch DB, captured emails, stubbed S3)\n');

    // -------- routes exist
    await t('all thirteen routes are mounted', () => {
        for (const k of ['GET /boston', 'GET /boston/hero.jpg', 'GET /boston/hmpa.png',
            'POST /api/boston/register', 'GET /boston.ics', 'GET /api/boston/pass/:token.pkpass',
            'GET /api/boston/qr/:id.png', 'GET /boston/upload/:token', 'POST /api/boston/upload/:token',
            'GET /boston/presentations', 'GET /api/boston/presentations',
            'GET /api/boston/presentations/:id/download', 'GET /api/boston/registrations.csv']) {
            assert.ok(app.routes[k], 'missing ' + k);
        }
    });

    // -------- SigV4 core — AWS's published test vector (docs: "Authenticating Requests:
    // Using Query Parameters (AWS Signature Version 4)", examplebucket GET test.txt).
    await t('SigV4 presign reproduces the AWS documentation test vector exactly', () => {
        const saved = { b: process.env.BB_S3_BUCKET, k: process.env.BB_S3_KEY, s: process.env.BB_S3_SECRET, r: process.env.BB_S3_REGION };
        try {
            process.env.BB_S3_BUCKET = 'examplebucket';
            process.env.BB_S3_REGION = 'us-east-1';
            process.env.BB_S3_KEY = 'AKIAIOSFODNN7EXAMPLE';
            process.env.BB_S3_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
            const url = mountBoston._s3.presignGet('test.txt', { expires: 86400, now: new Date('2013-05-24T00:00:00Z') });
            assert.strictEqual(url,
                'https://examplebucket.s3.amazonaws.com/test.txt'
                + '?X-Amz-Algorithm=AWS4-HMAC-SHA256'
                + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
                + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host'
                + '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
        } finally {
            process.env.BB_S3_BUCKET = saved.b; process.env.BB_S3_KEY = saved.k;
            process.env.BB_S3_SECRET = saved.s; process.env.BB_S3_REGION = saved.r;
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

    await t('confirmation email HTML: branded QR url + Google save url + dress + date, no undefined', () => {
        const html = sentEmails[0].html;
        assert.ok(html.includes(`${BASE}/api/boston/qr/${anaId}.png`), 'branded QR url missing');
        assert.ok(!html.includes(`${BASE}/qr/${anaId}.png`), 'email must use the branded QR route, not the plain one');
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

    await t('Google object: BB_GOOGLE_CLASS_ID class, no duplicated venue/date text fields', () => {
        const m = /pay\.google\.com\/gp\/v\/save\/([A-Za-z0-9_.-]+)/.exec(sentEmails[0].html);
        assert.ok(m, 'save JWT not found in email');
        const claims = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8'));
        const obj = claims.payload.eventTicketObjects[0];
        assert.strictEqual(obj.classId, process.env.BB_GOOGLE_CLASS_ID, 'object must use the dedicated Boston class');
        const cls = claims.payload.eventTicketClasses[0];
        assert.strictEqual(cls.id, process.env.BB_GOOGLE_CLASS_ID, 'class body must carry the Boston class id');
        assert.ok(cls.venue && cls.dateTime, 'class must carry venue + date at class level');
        const ids = (obj.textModulesData || []).map(x => x.id).sort();
        assert.deepStrictEqual(ids, ['dress', 'reg_no', 'status'], 'object text fields must be exactly dress/status/reg_no (no events/category duplication)');
        assert.strictEqual(obj.ticketHolderName, 'Ana Horvat');
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
    let ivanId = null;
    await t('presentation flag lands in notes + intro line + ticket label', () => {
        const row = query.get('SELECT * FROM bridges_registrations WHERE LOWER(email) = ?', ['ivan@example.org']);
        assert.ok(row, 'ivan row missing');
        ivanId = row.id;
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
    await t('pass route: valid token for unknown registration -> 404', async () => {
        const ghost = crypto.randomUUID();
        const r = await call(app, 'GET', '/api/boston/pass/:token.pkpass', { params: { token: mintPassToken(ghost) } });
        assert.strictEqual(r.statusCode, 404);
    });
    await t('pass route: valid token, Apple env absent -> graceful 503 JSON', async () => {
        const r = await call(app, 'GET', '/api/boston/pass/:token.pkpass', { params: { token: mintPassToken(anaId) } });
        assert.strictEqual(r.statusCode, 503);
        assert.ok(r.body && /Apple Wallet/.test(r.body.error), 'graceful JSON error expected');
    });

    // -------- page + assets
    await t('GET /boston renders the edited page (title, single date, footer order, removals)', async () => {
        const r = await call(app, 'GET', '/boston');
        const html = String(r.body);
        // New title + subtitle
        assert.ok(html.includes('Building Bridges in Biomedicine: Croatia and the US'), 'new headline missing');
        assert.ok(html.includes('<span class="city">Boston</span>'), 'Boston beneath the title missing');
        // The one when&where line (fuller form) — in the hero, and ONLY there
        const mainStart = html.indexOf('<main');
        const headerPart = html.slice(0, mainStart), mainPart = html.slice(mainStart);
        assert.ok(headerPart.includes('Monday, 21 September 2026'), 'date missing from hero');
        assert.ok(headerPart.includes('6:00–9:00 PM') && headerPart.includes('doors from 5:30 PM'), 'new time wording missing');
        assert.ok(headerPart.includes('Waterhouse Room, Gordon Hall (25 Shattuck St), Harvard Medical School'), 'venue in the when-line missing');
        assert.ok(!mainPart.includes('Monday, 21 September 2026'), 'date must appear once (hero only)');
        assert.ok(!html.includes('<span>Date</span>') && !html.includes('<span>Time</span>') && !html.includes('<span>Venue</span>'),
            'facts card must no longer duplicate date/time/venue');
        // Removals
        assert.ok(!html.includes('Plexus Series'), 'kicker label must be gone (logos only at top)');
        assert.ok(!html.includes('after London'), 'fifth-edition cities line must be gone');
        assert.ok(!html.includes('Organized by Med&amp;X &middot;'), 'organized-by hero flavor line must be gone');
        assert.ok(!html.includes('Co-organized with the'), 'co-organized bottom line must be gone');
        // Footer: Laura, then organized-by, then www.medx.hr last
        const foot = html.slice(html.indexOf('<footer'));
        const iL = foot.indexOf('laura.rodman@medx.hr'), iO = foot.indexOf('Organized by Med&amp;X and the Harvard Medical Postdoc Association'), iW = foot.indexOf('www.medx.hr');
        assert.ok(iL > -1 && iO > iL && iW > iO, 'footer order must be Laura -> organized-by -> www.medx.hr');
        assert.ok(foot.includes('href="https://medx.hr"'), 'medx.hr link missing');
        // Unchanged essentials
        assert.ok(html.includes('5-minute presentation of my lab, clinic, department, or institution'), 'checkbox wording');
        assert.ok(html.includes('Presentation slots are confirmed by email'), 'slots note');
        assert.ok(html.includes('/api/boston/register'), 'form posts to the API');
        assert.ok(html.includes('/boston/hero.jpg') && html.includes('/boston/hmpa.png'), 'hero + HMPA assets referenced');
        assert.ok(html.includes('Business attire'), 'dress code');
        assert.ok(!html.includes('undefined'), 'literal "undefined" leaked into the page');
    });
    await t('hero + HMPA assets are served from backend files', async () => {
        const a = await call(app, 'GET', '/boston/hero.jpg');
        assert.ok(/boston-hero\.jpg$/.test(a.file), 'hero sendFile path');
        const b = await call(app, 'GET', '/boston/hmpa.png');
        assert.ok(/hmpa-logo\.png$/.test(b.file), 'hmpa sendFile path');
    });

    // -------- branded entry QR
    await t('branded QR: 300px PNG that still decodes to the exact bridges payload', async () => {
        if (!pngjsT || !jsQRT || !QRCodeT) { console.log('        (decode SKIPPED — run npm install in user-portal/backend)'); return; }
        const r = await call(app, 'GET', '/api/boston/qr/:id.png', { params: { id: anaId } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.headers['content-type'], 'image/png');
        const img = pngjsT.PNG.sync.read(r.body);
        assert.strictEqual(img.width, 300); assert.strictEqual(img.height, 300);
        const code = jsQRT(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height);
        assert.ok(code, 'jsQR could not decode the composited QR — the plate overlay broke it');
        assert.deepStrictEqual(JSON.parse(code.data), { type: 'MEDX_MEMBER', regId: anaId, evt: 'bridges' },
            'payload must replicate the prod /qr/:id.png bridges branch exactly');
        const plain = await QRCodeT.toBuffer(JSON.stringify({ type: 'MEDX_MEMBER', regId: anaId, evt: 'bridges' }),
            { errorCorrectionLevel: 'H', width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
        assert.ok(!plain.equals(r.body), 'plate does not appear to be composited (identical to a plain QR)');
    });
    await t('branded QR: unknown/malformed id -> 404', async () => {
        const a = await call(app, 'GET', '/api/boston/qr/:id.png', { params: { id: crypto.randomUUID() } });
        assert.strictEqual(a.statusCode, 404);
        const b = await call(app, 'GET', '/api/boston/qr/:id.png', { params: { id: '<script>' } });
        assert.strictEqual(b.statusCode, 404);
    });

    // ==================== presentation uploads ====================

    // -------- token + page
    await t('upload token: roundtrip valid, forged/garbled -> friendly 404 page and 404 JSON', async () => {
        for (const token of ['garbage', 'deadbeef.someid', 'f'.repeat(32) + '.' + anaId, mintPassToken(anaId)]) {
            const p = await call(app, 'GET', '/boston/upload/:token', { params: { token } });
            assert.strictEqual(p.statusCode, 404, 'page should 404 for token ' + token);
            assert.ok(String(p.body).includes('not quite right'), 'friendly 404 copy expected');
            assert.ok(String(p.body).includes('laura.rodman@medx.hr'), '404 page support line expected');
            const a = await call(app, 'POST', '/api/boston/upload/:token', { params: { token }, file: { originalname: 'x.pdf', mimetype: 'application/pdf', buffer: pdfBuf() } });
            assert.strictEqual(a.statusCode, 404, 'API should 404 for token ' + token);
        }
        const ghost = await call(app, 'GET', '/boston/upload/:token', { params: { token: mintUploadToken(crypto.randomUUID()) } });
        assert.strictEqual(ghost.statusCode, 404, 'valid-shape token for unknown registration must 404');
    });

    await t('upload page: personal, attributed, branded, noindex', async () => {
        const r = await call(app, 'GET', '/boston/upload/:token', { params: { token: mintUploadToken(anaId) } });
        assert.strictEqual(r.statusCode, 200);
        const html = String(r.body);
        assert.ok(html.includes('Hi Ana — upload your 5-minute presentation'), 'personal greeting missing');
        assert.ok(html.includes('Ana Horvat') && html.includes('Massachusetts General Hospital'), 'attribution (name + institution) missing');
        assert.ok(html.includes('accept=".pdf,.ppt,.pptx,.key"'), 'accept attr missing');
        assert.ok(html.includes('25 MB'), 'size limit note missing');
        assert.ok(html.includes(`/api/boston/upload/${mintUploadToken(anaId)}`), 'page must POST to its own token API');
        assert.ok(html.includes('is safely with us. You can replace it any time from this same link'), 'success copy missing');
        assert.ok(String(r.headers['x-robots-tag']).includes('noindex'), 'X-Robots-Tag noindex missing');
        assert.ok(html.includes('name="robots" content="noindex'), 'robots meta missing');
        assert.ok(!html.includes('undefined'), 'literal "undefined" leaked into the page');
    });

    // -------- graceful degradation without BB_S3_* env
    await t('BB_S3_* absent: page says "Uploads open soon", API 503s, admin list still renders', async () => {
        const saved = { b: process.env.BB_S3_BUCKET, k: process.env.BB_S3_KEY, s: process.env.BB_S3_SECRET };
        try {
            delete process.env.BB_S3_BUCKET; delete process.env.BB_S3_KEY; delete process.env.BB_S3_SECRET;
            const page = await call(app, 'GET', '/boston/upload/:token', { params: { token: mintUploadToken(anaId) } });
            assert.strictEqual(page.statusCode, 200);
            assert.ok(String(page.body).includes('Uploads open soon'), 'open-soon note missing');
            assert.ok(!String(page.body).includes('id="drop"'), 'uploader must be hidden while unconfigured');
            const api = await call(app, 'POST', '/api/boston/upload/:token', {
                params: { token: mintUploadToken(anaId) },
                file: { originalname: 'deck.pdf', mimetype: 'application/pdf', buffer: pdfBuf() }
            });
            assert.strictEqual(api.statusCode, 503, 'upload API must 503 while unconfigured');
            const admin = await call(app, 'GET', '/boston/presentations', { query: { key: ADMIN_KEY } });
            assert.strictEqual(admin.statusCode, 200, 'admin page must still render');
            assert.ok(String(admin.body).includes('Ivan Kovac'), 'admin page must still list requesters');
            assert.ok(String(admin.body).includes('S3 is not configured'), 'admin page should surface the unconfigured state');
        } finally {
            process.env.BB_S3_BUCKET = saved.b; process.env.BB_S3_KEY = saved.k; process.env.BB_S3_SECRET = saved.s;
        }
    });

    // -------- upload happy path
    let firstPresId = null;
    await t('upload happy path: S3 PUT recorded, history row inserted, success JSON', async () => {
        const buf = pdfBuf(2048);
        const r = await call(app, 'POST', '/api/boston/upload/:token', {
            params: { token: mintUploadToken(anaId) },
            file: { originalname: 'Rogulja Lab — Boston.pdf', mimetype: 'application/pdf', buffer: buf, size: buf.length }
        });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(r.body.filename, 'Rogulja Lab — Boston.pdf');
        assert.strictEqual(r.body.size, buf.length);
        assert.strictEqual(s3Puts.length, 1, 'exactly one S3 PUT');
        assert.ok(new RegExp(`^boston-2026/${anaId}/[0-9a-f-]{36}\\.pdf$`).test(s3Puts[0].key), 'stored key layout: ' + s3Puts[0].key);
        assert.strictEqual(s3Puts[0].contentType, 'application/pdf');
        assert.strictEqual(s3Puts[0].size, buf.length);
        const rows = query.all('SELECT * FROM bridges_presentations WHERE registration_id = ?', [anaId]);
        assert.strictEqual(rows.length, 1);
        firstPresId = rows[0].id;
        assert.strictEqual(rows[0].original_name, 'Rogulja Lab — Boston.pdf');
        assert.strictEqual(rows[0].stored_key, s3Puts[0].key);
        assert.strictEqual(rows[0].mime, 'application/pdf');
        assert.strictEqual(Number(rows[0].size), buf.length);
        assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(rows[0].uploaded_at), 'uploaded_at must be ISO');
    });

    await t('upload page now shows the on-file file + replace control', async () => {
        const r = await call(app, 'GET', '/boston/upload/:token', { params: { token: mintUploadToken(anaId) } });
        const html = String(r.body);
        assert.ok(html.includes('On file with us'), 'on-file card missing');
        assert.ok(html.includes('Rogulja Lab — Boston.pdf'), 'current file name missing');
        assert.ok(html.includes('uploaded 20'), 'uploaded time missing');
        assert.ok(/Replace it|Choose a replacement file/.test(html), 'replace control missing');
    });

    // -------- rejects
    await t('over-25MB upload -> 413, no S3 PUT, no row', async () => {
        const big = Buffer.alloc(MAX + 1, 0x20); big.write('%PDF-1.4');
        const before = s3Puts.length;
        const r = await call(app, 'POST', '/api/boston/upload/:token', {
            params: { token: mintUploadToken(anaId) },
            file: { originalname: 'huge.pdf', mimetype: 'application/pdf', buffer: big }
        });
        assert.strictEqual(r.statusCode, 413);
        assert.ok(/25 MB/.test(r.body.error), 'friendly size message expected');
        assert.strictEqual(s3Puts.length, before, 'no S3 PUT for oversize file');
        assert.strictEqual(query.all('SELECT * FROM bridges_presentations WHERE registration_id = ?', [anaId]).length, 1);
    });
    await t('wrong magic bytes -> 400 (pdf that is not a PDF, pptx that is not a zip)', async () => {
        const before = s3Puts.length;
        for (const f of [
            { originalname: 'deck.pdf', mimetype: 'application/pdf', buffer: Buffer.from('MZ this is not a pdf at all........') },
            { originalname: 'deck.pptx', mimetype: 'application/vnd.ms-powerpoint', buffer: Buffer.from('plain text pretending............') }
        ]) {
            const r = await call(app, 'POST', '/api/boston/upload/:token', { params: { token: mintUploadToken(anaId) }, file: f });
            assert.strictEqual(r.statusCode, 400, 'expected 400 for ' + f.originalname);
            assert.ok(/does not look like/.test(r.body.error), 'friendly magic message expected');
        }
        assert.strictEqual(s3Puts.length, before, 'no S3 PUT for wrong-magic files');
    });
    await t('disallowed extension / no file -> 400', async () => {
        const a = await call(app, 'POST', '/api/boston/upload/:token', {
            params: { token: mintUploadToken(anaId) },
            file: { originalname: 'notes.txt', mimetype: 'text/plain', buffer: Buffer.from('hello world padding........') }
        });
        assert.strictEqual(a.statusCode, 400);
        const b = await call(app, 'POST', '/api/boston/upload/:token', { params: { token: mintUploadToken(anaId) } });
        assert.strictEqual(b.statusCode, 400);
    });

    // -------- replace flow (history kept, newest authoritative)
    await t('replace flow: second upload keeps history, newest wins', async () => {
        const r = await call(app, 'POST', '/api/boston/upload/:token', {
            params: { token: mintUploadToken(anaId) },
            file: { originalname: 'Rogulja Lab v2.pptx', mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: zipBuf() }
        });
        assert.strictEqual(r.statusCode, 200);
        const rows = query.all('SELECT * FROM bridges_presentations WHERE registration_id = ? ORDER BY uploaded_at, rowid', [anaId]);
        assert.strictEqual(rows.length, 2, 'history rows must be kept');
        assert.strictEqual(rows[0].original_name, 'Rogulja Lab — Boston.pdf');
        assert.strictEqual(rows[1].original_name, 'Rogulja Lab v2.pptx');
        assert.ok(rows[1].stored_key.endsWith('.pptx') && rows[0].stored_key !== rows[1].stored_key, 'each upload gets its own key');
        assert.strictEqual(s3Puts.length, 2, 'both files PUT to S3');
    });

    // -------- admin surfaces
    await t('admin page + JSON + CSV require the exact key', async () => {
        for (const key of [undefined, '', 'wrong', ADMIN_KEY.slice(0, 39), ADMIN_KEY + '0']) {
            const p = await call(app, 'GET', '/boston/presentations', { query: { key } });
            assert.strictEqual(p.statusCode, 404, 'page must 404 for key ' + key);
            const j = await call(app, 'GET', '/api/boston/presentations', { query: { key } });
            assert.strictEqual(j.statusCode, 404, 'JSON must 404 for key ' + key);
            const c = await call(app, 'GET', '/api/boston/registrations.csv', { query: { key } });
            assert.strictEqual(c.statusCode, 403, 'CSV must 403 for key ' + key);
        }
    });

    await t('admin page: uploaded + not-yet states, copyable personal links, download link, noindex', async () => {
        const r = await call(app, 'GET', '/boston/presentations', { query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 200);
        const html = String(r.body);
        assert.ok(html.includes('Ana Horvat') && html.includes('Ivan Kovac'), 'both listed (uploader + requester)');
        assert.ok(html.includes('Massachusetts General Hospital') && html.includes('Harvard Medical School'), 'institutions shown');
        assert.ok(html.includes('Ana@Example.org') && html.includes('ivan@example.org'), 'emails shown');
        assert.ok(html.includes('Rogulja Lab v2.pptx'), 'NEWEST file name shown');
        assert.ok(html.includes('not yet'), 'not-yet state shown for ivan');
        assert.ok(html.includes(`/boston/upload/${mintUploadToken(anaId)}`), "ana's personal link shown");
        assert.ok(html.includes(`/boston/upload/${mintUploadToken(ivanId)}`), "ivan's personal link shown");
        assert.ok(html.includes('data-link='), 'click-to-copy control missing');
        assert.ok(html.includes('/download?key=' + ADMIN_KEY), 'download link missing');
        assert.ok(String(r.headers['x-robots-tag']).includes('noindex'), 'X-Robots-Tag noindex missing');
        assert.ok(html.includes('name="robots" content="noindex'), 'robots meta missing');
        assert.ok(!html.includes('undefined'), 'literal "undefined" leaked into the page');
    });

    let latestPresId = null;
    await t('admin JSON: rows, newest-authoritative upload, versions, counts', async () => {
        const r = await call(app, 'GET', '/api/boston/presentations', { query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 200);
        const d = r.body;
        assert.strictEqual(d.event, EVENT_ID);
        assert.strictEqual(d.s3_configured, true);
        assert.strictEqual(d.rows.length, 2, 'ana (uploaded) + ivan (requested)');
        const ana = d.rows.find(x => x.registration_id === anaId);
        const ivan = d.rows.find(x => x.registration_id === ivanId);
        assert.ok(ana && ivan, 'both rows present');
        assert.strictEqual(ana.requested, false);
        assert.strictEqual(ivan.requested, true);
        assert.strictEqual(ivan.upload, null);
        assert.strictEqual(ana.upload.filename, 'Rogulja Lab v2.pptx', 'newest upload must be authoritative');
        assert.strictEqual(ana.upload.versions, 2);
        assert.ok(ana.upload.download_url.includes(`/api/boston/presentations/${ana.upload.id}/download?key=${ADMIN_KEY}`));
        assert.strictEqual(ana.upload_url, `${BASE}/boston/upload/${mintUploadToken(anaId)}`);
        assert.strictEqual(ivan.upload_url, `${BASE}/boston/upload/${mintUploadToken(ivanId)}`);
        assert.strictEqual(d.uploaded, 1);
        assert.strictEqual(d.requested, 1);
        latestPresId = ana.upload.id;
    });

    // -------- download 302 → presigned URL (presign is real math against fake creds; no network)
    await t('download: 302 to a 15-minute presigned S3 GET with the original filename', async () => {
        const r = await call(app, 'GET', '/api/boston/presentations/:id/download', { params: { id: latestPresId }, query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 302);
        const loc = String(r.headers.location);
        assert.ok(loc.startsWith(`https://${process.env.BB_S3_BUCKET}.s3.amazonaws.com/boston-2026/${anaId}/`), 'presigned host/key wrong: ' + loc);
        assert.ok(loc.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'), 'algorithm param');
        assert.ok(loc.includes('X-Amz-Expires=900'), '15-minute expiry');
        assert.ok(/X-Amz-Signature=[0-9a-f]{64}/.test(loc), 'hex signature');
        assert.ok(loc.includes('response-content-disposition=') && loc.includes('Rogulja%20Lab%20v2.pptx'), 'friendly filename');
    });
    await t('download: unknown presentation id -> 404', async () => {
        const r = await call(app, 'GET', '/api/boston/presentations/:id/download', { params: { id: crypto.randomUUID() }, query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 404);
    });

    // -------- CSV export
    await t('registrations.csv: BOM, CRLF, all cells quoted, both rows oldest-first', async () => {
        const r = await call(app, 'GET', '/api/boston/registrations.csv', { query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 200);
        assert.ok(String(r.headers['content-type']).startsWith('text/csv'), 'content-type');
        const body = String(r.body);
        assert.strictEqual(body.charCodeAt(0), 0xFEFF, 'UTF-8 BOM missing');
        const text = body.slice(1);
        assert.ok(text.includes('\r\n'), 'CRLF line endings');
        const lines = text.split('\r\n').filter(l => l.length);
        assert.strictEqual(lines.length, 3, 'header + 2 registrants');
        assert.strictEqual(lines[0],
            '"Registered at","First name","Last name","Email","Institution","Position","5-min presentation","Status","Checked in"');
        for (const l of lines) {
            assert.ok(/^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/.test(l), 'every cell must be quoted: ' + l);
        }
        assert.ok(lines[1].includes('"Ana"') && lines[1].includes('"Horvat"') && lines[1].includes('"No"'), 'ana row (oldest first, presentation No)');
        assert.ok(lines[2].includes('"Ivan"') && lines[2].includes('"Yes"') && lines[2].includes('"Harvard Medical School"'), 'ivan row (presentation Yes)');
        assert.ok(lines[1].includes('"Postdoctoral fellow"'), 'position exported');
        assert.ok(lines[1].includes('"registered"') && lines[1].endsWith('"No"'), 'status + checked-in exported');
    });

    // -------- absolute safety: every "send" went to the stub
    await t('no email escaped the stub; no network was touched; S3 saw only the stub', () => {
        assert.ok(sentEmails.length >= 3);
        for (const m of sentEmails) assert.ok(m.html && m.to);
        assert.ok(!process.env.BREVO_API_KEY, 'BREVO_API_KEY must stay unset in tests');
        assert.strictEqual(s3Puts.length, 2, 'exactly the two accepted uploads reached the (stubbed) S3 client');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
