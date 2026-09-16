/**
 * tests/boston-me.test.js — THE ONE PERSONAL PAGE (the "hub") for Building Bridges Boston.
 *
 * Alen 2026-09-14: "Can it all be one link? People open one link and everything is there: first
 * choose dietary/allergies, then upload the one-slide summary, then (presenters) upload the
 * presentation." This file is that sentence turned into assertions: one address, three numbered
 * steps, each saved in place, the required ones marked, the optional one left alone — and every
 * link already in somebody's inbox still working.
 *
 * Hermetic, shaped exactly like tests/boston-onepager.test.js: a stub express app keeps only the
 * FINAL handler (so multer never runs — the test injects req.file itself), a scratch in-memory
 * sqlite carries the real schema, every S3 call is a stub and global.fetch throws. A REAL EMAIL
 * SEND OR ANY NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Run:  node tests/boston-me.test.js       (exit code = 1 when anything failed)
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- hermetic env
delete process.env.BREVO_API_KEY;
delete process.env.GOOGLE_SHEETS_WEBHOOK;
delete process.env.BB_SHEET_ID;
delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.BB_PROGRAM_PDF_KEY;
delete process.env.GOOGLE_WALLET_ISSUER_ID;
delete process.env.GOOGLE_WALLET_SA_KEY;
for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_')) delete process.env[k];
process.env.BB_S3_BUCKET = 'medx-bb-test';
process.env.BB_S3_REGION = 'us-east-1';
process.env.BB_S3_KEY = 'AKIATESTTESTTESTTEST';
process.env.BB_S3_SECRET = 'test-secret-not-real';

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const wallet = require('../shared/wallet.js');
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const mountBoston = require('../user-portal/backend/boston.js');

const s3Puts = [];
const s3Store = new Map();
mountBoston._s3.putObject = async (key, body, contentType) => {
    s3Puts.push({ key, size: body.length, contentType });
    s3Store.set(key, Buffer.from(body));
    return { etag: '"stub-etag"' };
};
mountBoston._s3.getObject = async (key) => {
    if (!s3Store.has(key)) throw new Error('S3 GET 404 for ' + key);
    return s3Store.get(key);
};
mountBoston._s3.headObject = async (key) => s3Store.has(key)
    ? { size: s3Store.get(key).length, lastModified: '2026-09-14T09:00:00.000Z' } : null;

// ---------------------------------------------------------------- scratch sqlite (real schema)
const raw = new DatabaseSync(':memory:');
raw.exec(`CREATE TABLE bridges_events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, venue_name TEXT, venue_address TEXT,
    event_date TEXT NOT NULL, event_time TEXT, end_time TEXT, description TEXT, capacity INTEGER DEFAULT 50,
    registration_open INTEGER DEFAULT 1, registration_deadline TEXT, status TEXT DEFAULT 'upcoming',
    contact_email TEXT, contact_phone TEXT, notes TEXT, price REAL DEFAULT 0, created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, is_published INTEGER DEFAULT 0, slug TEXT)`);
raw.exec(`CREATE TABLE bridges_registrations (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    email TEXT NOT NULL, phone TEXT, institution TEXT, position TEXT,
    dietary_requirements TEXT, special_requests TEXT,
    status TEXT DEFAULT 'registered', payment_status TEXT DEFAULT 'n/a', amount_paid REAL,
    confirmation_sent INTEGER DEFAULT 0, reminder_sent INTEGER DEFAULT 0, checked_in INTEGER DEFAULT 0,
    checked_in_at TEXT, notes TEXT, registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT, qr_code TEXT, custom_answers TEXT)`);
// Neither upload table is pre-created — the wing must create both lazily, from the hub too.

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
    const r = { statusCode: 200, headers: {}, body: undefined };
    const res = {
        status(c) { r.statusCode = c; return res; },
        json(o) { r.body = o; return res; },
        send(x) { r.body = x; return res; },
        set(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) r.headers[a.toLowerCase()] = b; } else r.headers[String(k).toLowerCase()] = v; return res; },
        setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; },
        redirect(code, url) { r.statusCode = code; r.headers.location = url; },
        sendFile(p) { r.body = '[sendFile] ' + p; },
        get headersSent() { return false; },
        _r: r
    };
    return res;
}
async function call(app, method, path, { body, params, query: qs, file } = {}) {
    const h = app.routes[method + ' ' + path];
    if (!h) throw new Error('route not mounted: ' + method + ' ' + path);
    const res = makeRes();
    await h({ body: body || {}, params: params || {}, query: qs || {}, file, get: () => '' }, res);
    return res._r;
}

const sentEmails = [];
const sendEmailStub = async (to, subject, html, attachments) => { sentEmails.push({ to, subject, html, attachments: attachments || null }); return { success: true }; };

const JWT_SECRET = 'test-secret-boston-me';
const app = makeApp();
mountBoston(app, { query, saveDb: () => {}, sendEmail: sendEmailStub, flushDb: () => {}, JWT_SECRET });

const EVENT_ID = 'bb-boston-2026-09-21';
const BASE = 'https://medx-user-portal.onrender.com';
const ADMIN_KEY = crypto.createHmac('sha256', JWT_SECRET).update('boston-admin').digest('hex').slice(0, 40);
const sigOf = (ctx, id) => crypto.createHmac('sha256', JWT_SECRET).update(ctx + id).digest('hex').slice(0, 32) + '.' + id;
const meToken = id => sigOf('boston:me:', id);
const dietToken = id => sigOf('boston:diet:', id);
const uploadToken = id => sigOf('bostonup:', id);
const onepagerToken = id => sigOf('boston:onepager:', id);
const passToken = id => sigOf('boston:', id);
const hub = id => BASE + '/boston/me/' + meToken(id);

const pdfBuf = (extra = 64) => Buffer.concat([Buffer.from('%PDF-1.7\n% Building Bridges Boston\n'), Buffer.alloc(extra, 0x20)]);
const zipBuf = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(96, 0)]);   // .pptx / .key
const jpgBuf = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), Buffer.alloc(96, 0)]);

const DEADLINE = 'Sunday, 20 September 2026';

// ---------------------------------------------------------------- seed
const ANA = '11111111-1111-4111-8111-111111111111';     // attendee — two steps
const LUKA = '22222222-2222-4222-8222-222222222222';    // presenter — three steps
const MIA = '44444444-4444-4444-8444-444444444444';     // presenter, finishes everything
const GONE = '33333333-3333-4333-8333-333333333333';    // released seat
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
query.run(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, capacity, registration_open)
    VALUES (?, 'boston-2026', 'Building Bridges in Biomedicine — Boston', 'Boston', 'Waterhouse Room, Gordon Hall', '2026-09-21', 'upcoming', 60, 1)`, [EVENT_ID]);
function seed(id, first, last, email, notes, status) {
    query.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, notes, status, payment_status, confirmation_sent)
        VALUES (?,?,?,?,?,?,?,?,'n/a',1)`, [id, EVENT_ID, first, last, email, first + ' Institute', notes, status || 'registered']);
}
seed(ANA, 'Ana', 'Horvat', 'ana@example.com', null);
seed(LUKA, 'Luka', 'Babic', 'luka@example.com', '5-minute presentation requested');
seed(MIA, 'Mia', 'Novak', 'mia@example.com', '5-minute presentation requested');
seed(GONE, 'Old', 'Cancel', 'gone@example.com', null, 'cancelled');

const rowOf = id => query.get('SELECT * FROM bridges_registrations WHERE id = ?', [id]);
const page = id => call(app, 'GET', '/boston/me/:token', { params: { token: meToken(id) } });
const setDiet = (token, body) => call(app, 'POST', '/api/boston/me/:token/diet', { params: { token }, body });
const putSummary = (token, file, body) => call(app, 'POST', '/api/boston/me/:token/summary', { params: { token }, file, body });
const putSlides = (token, file) => call(app, 'POST', '/api/boston/me/:token/slides', { params: { token }, file });
const saveAllergies = (id, text) => call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(id) }, body: { text } });
const rows = (table, id) => {
    try { return query.all(`SELECT * FROM ${table} WHERE registration_id = ? ORDER BY uploaded_at, rowid`, [id]); }
    catch (e) { return []; }
};

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

(async () => {
    console.log('boston-me.test.js — hermetic (stub express, node:sqlite scratch DB, stubbed S3)\n');

    // ================================================================ routes
    await t('the hub page and its three APIs are mounted', () => {
        for (const k of ['GET /boston/me/:token', 'POST /api/boston/me/:token/diet',
            'POST /api/boston/me/:token/summary', 'POST /api/boston/me/:token/slides']) {
            assert.ok(app.routes[k], 'missing ' + k);
        }
    });

    // ================================================================ the token is its own context
    await t('a pass, slides, diet or summary token is a 404 at every hub address', async () => {
        for (const tok of [passToken(ANA), uploadToken(ANA), dietToken(ANA), onepagerToken(ANA)]) {
            assert.strictEqual((await call(app, 'GET', '/boston/me/:token', { params: { token: tok } })).statusCode, 404, 'page must reject ' + tok.slice(0, 8));
            assert.strictEqual((await setDiet(tok, { pref: 'vegan' })).statusCode, 404, 'diet must reject ' + tok.slice(0, 8));
            assert.strictEqual((await putSummary(tok, { originalname: 'x.pdf', buffer: pdfBuf() })).statusCode, 404, 'summary must reject');
            assert.strictEqual((await putSlides(tok, { originalname: 'x.pdf', buffer: pdfBuf() })).statusCode, 404, 'slides must reject');
        }
        assert.strictEqual(s3Puts.length, 0, 'not one byte was written for a wrong-context token');
        assert.strictEqual(rowOf(ANA).dietary_requirements, null, 'and nothing was recorded');
    });

    await t('a hub token is not a slides, diet, summary or pass token', async () => {
        const tok = meToken(ANA);
        assert.strictEqual((await call(app, 'GET', '/boston/upload/:token', { params: { token: tok } })).statusCode, 404);
        assert.strictEqual((await call(app, 'GET', '/boston/onepager/:token', { params: { token: tok } })).statusCode, 404);
        assert.strictEqual((await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: tok, answer: 'vegan' } })).statusCode, 404);
        assert.strictEqual((await call(app, 'GET', '/api/boston/pass/:token.pkpass', { params: { token: tok } })).statusCode, 404);
    });

    await t('a forged, garbled, re-cased or unknown hub token is a 404 — page and all three APIs', async () => {
        for (const tok of ['', 'nope', 'f'.repeat(32) + '.' + ANA, 'abc.' + ANA, meToken(ANA).toUpperCase(), meToken(UNKNOWN)]) {
            assert.strictEqual((await call(app, 'GET', '/boston/me/:token', { params: { token: tok } })).statusCode, 404, 'page: ' + JSON.stringify(tok.slice(0, 16)));
            assert.strictEqual((await setDiet(tok, { pref: 'vegan' })).statusCode, 404, 'diet: ' + JSON.stringify(tok.slice(0, 16)));
            assert.strictEqual((await putSummary(tok, { originalname: 'x.pdf', buffer: pdfBuf() })).statusCode, 404, 'summary: ' + JSON.stringify(tok.slice(0, 16)));
            assert.strictEqual((await putSlides(tok, { originalname: 'x.pdf', buffer: pdfBuf() })).statusCode, 404, 'slides: ' + JSON.stringify(tok.slice(0, 16)));
        }
        assert.strictEqual(s3Puts.length, 0, 'still not one byte written');
    });

    await t('a forged token is refused without leaking whether the guest exists', async () => {
        const real = await call(app, 'GET', '/boston/me/:token', { params: { token: 'f'.repeat(32) + '.' + ANA } });
        const ghost = await call(app, 'GET', '/boston/me/:token', { params: { token: meToken(UNKNOWN) } });
        assert.strictEqual(real.statusCode, ghost.statusCode, 'same status');
        assert.strictEqual(String(real.body), String(ghost.body), 'and the same page, byte for byte');
    });

    // ================================================================ the page
    await t('the page is personal, branded, mobile-first and never indexed', async () => {
        const r = await page(ANA);
        assert.strictEqual(r.statusCode, 200);
        const html = String(r.body);
        assert.ok(html.includes('<h1>Hi Ana!</h1>'), 'her first name in the header, with the exclamation mark (Alen 2026-09-15)');
        assert.ok(html.includes('miniband skyline') && html.includes("url('/boston/hero.jpg')"), 'the Boston skyline behind the greeting');
        assert.ok(html.includes('Ana Horvat'), 'attributed to the registration');
        assert.ok(html.includes('width=device-width'), 'phone viewport');
        assert.ok(html.includes('noindex'), 'never indexed in the meta');
        assert.ok(String(r.headers['x-robots-tag']).includes('noindex'), 'and in the header');
        assert.ok(String(r.headers['cache-control']).includes('no-store'), 'never cached');
        assert.ok(html.includes('/boston/hmpa.png') && html.includes('Fraunces'), 'the Med&X × HMPA chrome');
        assert.ok(html.includes(`/api/boston/me/${meToken(ANA)}`), 'the page posts to its own token');
        assert.ok(!html.includes(meToken(LUKA)), "and never somebody else's token");
        assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no leaked placeholders');
        assert.ok(!/one-pager/i.test(html), 'a guest never reads the internal name');
    });

    await t('an attendee gets TWO steps; a presenter gets THREE', async () => {
        const ana = String((await page(ANA)).body);
        assert.ok(ana.includes('id="step1"') && ana.includes('id="step2"'), 'attendee: steps 1 and 2');
        assert.ok(!ana.includes('id="step3"'), 'attendee: never a slides step');
        assert.ok(!/presentation slides/i.test(ana), 'and never told to upload slides');

        const luka = String((await page(LUKA)).body);
        for (const s of ['id="step1"', 'id="step2"', 'id="step3"']) assert.ok(luka.includes(s), 'presenter: ' + s);
        assert.ok(luka.includes('Your presentation slides'), 'presenter: the slides card');
    });

    await t('the three asks are marked optional / optional / required, in that order', async () => {
        const html = String((await page(LUKA)).body);
        const at = s => { const i = html.indexOf(s); assert.ok(i > -1, 'missing: ' + s); return i; };
        const s1 = at('id="step1"'), s2 = at('id="step2"'), s3 = at('id="step3"'), tick = at('Your ticket for the door');
        assert.ok(s1 < s2 && s2 < s3, 'dietary, then summary, then slides');
        assert.ok(s3 < tick, 'and the ticket last');
        const card = (from, to) => html.slice(from, to);
        assert.ok(/tag opt">Optional</.test(card(s1, s2)), 'step 1 is optional (Alen 2026-09-15: dietary is not required)');
        assert.ok(!/id="s2_headline"|One line about you/.test(card(s2, s3)), 'no headline text field — file upload only');
        assert.ok(/Please keep it to one slide/.test(card(s2, s3)), 'and the one-slide note');
        assert.ok(/Larger than 25 MB\?/.test(card(s3, tick)) && /id="s3_link"/.test(card(s3, tick)), 'the share-link lane under the uploader');
        assert.ok(/tag opt">Optional</.test(card(s2, s3)), 'step 2 is optional');
        assert.ok(/tag req">Required</.test(card(s3, tick)), 'step 3 is required');
    });

    await t('the page carries the ticket, the wallet/calendar buttons and the quiet way out', async () => {
        const html = String((await page(ANA)).body);
        assert.ok(html.includes(`/api/boston/qr/${ANA}.png`), 'the entry QR');
        assert.ok(html.includes('BB-BOS-' + ANA.slice(0, 8).toUpperCase()), 'the ticket number');
        assert.ok(html.includes(BASE + '/boston.ics'), 'the calendar link');
        assert.ok(html.includes(`/boston/rsvp/${dietToken(ANA)}/cannot-attend`), 'the cancel link, on her diet token');
        assert.ok(/Unable to attend\?/.test(html) && /Cancel your participation/.test(html), "the owner's wording");
        assert.ok(html.indexOf('Your ticket for the door') < html.indexOf('Unable to attend?'), 'the way out is last of all');
    });

    await t('a released seat meets the notice, never the form', async () => {
        const r = await page(GONE);
        assert.strictEqual(r.statusCode, 200, 'the link still resolves');
        assert.ok(/seat was released/i.test(String(r.body)), 'the notice');
        assert.ok(!String(r.body).includes('id="step1"'), 'and no steps to fill in');
        assert.strictEqual((await setDiet(meToken(GONE), { pref: 'vegan' })).statusCode, 409, 'and the API refuses too');
        assert.strictEqual((await putSummary(meToken(GONE), { originalname: 'x.pdf', buffer: pdfBuf() })).statusCode, 409);
    });

    // ================================================================ step 1 · dietary
    await t('the preference saves in place, and is idempotent', async () => {
        const r = await setDiet(meToken(ANA), { pref: 'vegan' });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(r.body.label, 'Vegan');
        assert.strictEqual(rowOf(ANA).dietary_requirements, 'Vegan', 'written as the CSV reads it');

        const again = await setDiet(meToken(ANA), { pref: 'vegan' });
        assert.strictEqual(again.statusCode, 200);
        assert.strictEqual(rowOf(ANA).dietary_requirements, 'Vegan', 'the same answer twice is one answer');

        await setDiet(meToken(ANA), { pref: 'vegetarian' });
        assert.strictEqual(rowOf(ANA).dietary_requirements, 'Vegetarian', 'and a change overwrites, never appends');
    });

    await t('the hub writes exactly what the one-tap email link writes', async () => {
        await setDiet(meToken(LUKA), { pref: 'halal' });
        const viaHub = rowOf(LUKA).dietary_requirements;
        await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: dietToken(MIA), answer: 'halal' } });
        assert.strictEqual(viaHub, rowOf(MIA).dietary_requirements, 'one record, whichever door was used');
        const ca = JSON.parse(rowOf(LUKA).custom_answers || '{}');
        assert.strictEqual(ca.diet_pref, 'halal', 'and the same custom_answers stamp');
        assert.ok(ca.answered_at, 'with answered_at touched');
    });

    await t('a preference outside the list is refused, and writes nothing', async () => {
        const before = rowOf(ANA).dietary_requirements;
        for (const bad of ['', 'pescatarian', 'DROP TABLE', null, 'cannot-attend', 'no-allergies']) {
            const r = await setDiet(meToken(ANA), { pref: bad });
            assert.strictEqual(r.statusCode, 400, 'must refuse ' + JSON.stringify(bad));
        }
        assert.strictEqual(rowOf(ANA).dietary_requirements, before, 'and her answer is untouched');
    });

    await t('the allergy text saves through the existing route, and reads back on the page', async () => {
        const r = await saveAllergies(ANA, '  peanuts and\n shellfish  ');
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.allergies, 'peanuts and shellfish', 'whitespace tidied');
        assert.ok(String(rowOf(ANA).special_requests).includes('Allergies: peanuts and shellfish'), 'stored in special_requests');
        const html = String((await page(ANA)).body);
        assert.ok(html.includes('value="peanuts and shellfish"'), 'the box is pre-filled on reload');
        assert.ok(/id="abox"(?!.{0,40}hidden)/.test(html), 'and open, because she has allergies');
    });

    await t('"no allergies" through the hub is the same stored answer as the email chip', async () => {
        await saveAllergies(LUKA, 'none');
        assert.ok(String(rowOf(LUKA).special_requests).includes('Allergies: none'), 'the hub wrote it');
        await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: dietToken(MIA), answer: 'no-allergies' } });
        assert.strictEqual(rowOf(LUKA).special_requests, rowOf(MIA).special_requests, 'identical, whichever door');
    });

    // ================================================================ step 2 · the summary
    await t('a PDF summary stores under boston/onepagers/<reg id>/ and reads back on the page', async () => {
        const buf = pdfBuf(200);
        const r = await putSummary(meToken(ANA), { originalname: 'Ana Horvat — one slide.pdf', buffer: buf, size: buf.length },
            { headline: 'Sleep neuroscientist · looking for clinical collaborators', share_ok: '1' });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(r.body.share_ok, true);
        assert.strictEqual(r.body.headline, 'Sleep neuroscientist · looking for clinical collaborators');
        const put = s3Puts[s3Puts.length - 1];
        assert.ok(put.key.startsWith('boston/onepagers/' + ANA + '/'), 'the SAME prefix as the old page: ' + put.key);
        assert.strictEqual(rows('bridges_onepagers', ANA).length, 1, 'one history row');

        const html = String((await page(ANA)).body);
        assert.ok(html.includes('Ana Horvat — one slide.pdf'), 'the file on record, by name');
        assert.ok(html.includes('Replace my one-slide summary'), 'and the button now says replace');
        assert.ok(html.includes('Shared with all participants after the event.'), 'her sharing answer, read back');
    });

    await t('a .jpg (and a PDF wearing a .pdf name) is refused — nothing is stored', async () => {
        const puts = s3Puts.length, before = rows('bridges_onepagers', ANA).length;
        const jpg = await putSummary(meToken(ANA), { originalname: 'poster.jpg', buffer: jpgBuf() });
        assert.strictEqual(jpg.statusCode, 400, 'a jpg is not a slide');
        const liar = await putSummary(meToken(ANA), { originalname: 'poster.pdf', buffer: jpgBuf() });
        assert.strictEqual(liar.statusCode, 400, 'and the magic bytes are checked, not the name');
        const none = await putSummary(meToken(ANA), null);
        assert.strictEqual(none.statusCode, 400, 'and an empty post is refused');
        assert.strictEqual(s3Puts.length, puts, 'not one byte written');
        assert.strictEqual(rows('bridges_onepagers', ANA).length, before, 'and no row added');
    });

    await t('unticking the share box is respected, and newest wins', async () => {
        const r = await putSummary(meToken(ANA), { originalname: 'private.pptx', buffer: zipBuf() }, { share_ok: '0' });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.share_ok, false, 'the answer she gave');
        const all = rows('bridges_onepagers', ANA);
        assert.strictEqual(all.length, 2, 'a second version, not an overwrite');
        assert.strictEqual(Number(all[all.length - 1].share_ok), 0, 'and the newest carries the consent');
        const html = String((await page(ANA)).body);
        assert.ok(html.includes('private.pptx'), 'the newest file is what the page shows');
        assert.ok(/Kept private/.test(html), 'and it says so');
        assert.ok(!/<input type="checkbox" id="s2_share" checked>/.test(html), 'the box reads back unticked');
    });

    // ================================================================ step 3 · the slides
    await t('a presenter can upload slides; the file lands in the presentations table', async () => {
        const r = await putSlides(meToken(LUKA), { originalname: 'Luka talk.pptx', buffer: zipBuf() });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.success, true);
        const put = s3Puts[s3Puts.length - 1];
        assert.ok(put.key.startsWith('boston-2026/' + LUKA + '/'), 'the SAME prefix as the old page: ' + put.key);
        assert.strictEqual(rows('bridges_presentations', LUKA).length, 1, 'one history row');
        const html = String((await page(LUKA)).body);
        assert.ok(html.includes('Luka talk.pptx'), 'the deck on record, by name');
        assert.ok(html.includes('Replace my slides'), 'and the button says replace');
    });

    await t('an attendee is refused the slides step — 403, and nothing is stored', async () => {
        const puts = s3Puts.length;
        const r = await putSlides(meToken(ANA), { originalname: 'sneaky.pdf', buffer: pdfBuf() });
        assert.strictEqual(r.statusCode, 403, 'only presenters have a slot');
        assert.ok(/presenters/i.test(String(r.body.error)), 'and the refusal says why: ' + r.body.error);
        assert.strictEqual(s3Puts.length, puts, 'not one byte written');
        assert.strictEqual(rows('bridges_presentations', ANA).length, 0, 'and no row added');
    });

    await t('the slides step keeps the 25 MB lane and its own type list', async () => {
        const jpg = await putSlides(meToken(LUKA), { originalname: 'slide.jpg', buffer: jpgBuf() });
        assert.strictEqual(jpg.statusCode, 400, 'a jpg is not a deck');
        const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(26 * 1024 * 1024, 0x20)]);
        const over = await putSlides(meToken(LUKA), { originalname: 'huge.pdf', buffer: big });
        assert.strictEqual(over.statusCode, 413, 'over the cap');
        const key = await putSlides(meToken(LUKA), { originalname: 'keynote.key', buffer: zipBuf() });
        assert.strictEqual(key.statusCode, 200, '.key is accepted here (and only here)');
        const keyAsSummary = await putSummary(meToken(LUKA), { originalname: 'keynote.key', buffer: zipBuf() });
        assert.strictEqual(keyAsSummary.statusCode, 400, 'but never as a one-slide summary');
    });

    // ================================================================ step 3 · the over-25 MB lane (a share link)
    const putLink = (token, url) => call(app, 'POST', '/api/boston/me/:token/slides-link', { params: { token }, body: { url } });
    const BIGLINK = 'https://drive.google.com/file/d/1AbCdEfGh/view?usp=sharing';
    await t('a presenter can save a Drive / Dropbox link instead of a file — and it counts as the deck', async () => {
        seed('abababab-abab-4bab-8bab-abababababab', 'Ivo', 'Kos', 'ivo.kos@example.com', '5-minute presentation requested');
        const IVO = 'abababab-abab-4bab-8bab-abababababab';
        const puts = s3Puts.length;
        const r = await putLink(meToken(IVO), '  ' + BIGLINK + '  ');
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(r.body.external_url, BIGLINK, 'the link, trimmed');
        assert.strictEqual(r.body.filename, 'Link · drive.google.com', 'labelled by host');
        assert.strictEqual(s3Puts.length, puts, 'nothing goes to S3 — the deck lives on Drive');
        const all = rows('bridges_presentations', IVO);
        assert.strictEqual(all.length, 1, 'one history row, in the SAME table as uploaded decks');
        assert.strictEqual(all[0].external_url, BIGLINK);
        assert.strictEqual(all[0].stored_key, '');
        const html = String((await page(IVO)).body);
        assert.ok(html.includes('Link · drive.google.com'), 'on file, by label');
        assert.ok(html.includes(`href="${BIGLINK.replace(/&/g, '&amp;')}"`), 'and the link itself, clickable');
        assert.ok(html.includes('Replace my slides'), 'the upload button reads as a replacement now');
        const m = /<p class="prog[^"]*" id="prog"[\s\S]*?>([\s\S]*?)<\/p>/.exec(html);
        assert.ok(m && /1<\/b> of 4 done/.test(m[1]), 'a saved link satisfies the required step (1 of 4 — Finish is the fourth): ' + (m && m[1]));
        assert.ok(html.includes('data-s3="1"'), 'and the slides step reads as done');
        assert.ok(html.includes(`value="${BIGLINK.replace(/&/g, '&amp;')}"`), 'the link box is pre-filled on reload');
    });

    await t('a bad link is refused and nothing is stored; an attendee is refused the lane entirely', async () => {
        const IVO = 'abababab-abab-4bab-8bab-abababababab';
        const before = rows('bridges_presentations', IVO).length;
        for (const bad of ['', 'drive.google.com/x', 'ftp://files.example.org/deck.pptx', 'javascript:alert(1)', 'https://', 'not a link', 'https://' + 'a'.repeat(700) + '.com/x']) {
            const r = await putLink(meToken(IVO), bad);
            assert.strictEqual(r.statusCode, 400, 'must refuse ' + JSON.stringify(bad).slice(0, 40));
        }
        assert.strictEqual(rows('bridges_presentations', IVO).length, before, 'and no row added');
        const att = await putLink(meToken(ANA), BIGLINK);
        assert.strictEqual(att.statusCode, 403, 'only presenters have a slides slot');
        assert.strictEqual(rows('bridges_presentations', ANA).length, 0);
        const DEA = '88888888-8888-4888-8888-888888888888';
        seed(DEA, 'Dea', 'Nik', 'dea@example.com', '5-minute presentation requested');
        await call(app, 'POST', '/api/boston/presenters/:id/status', { params: { id: DEA }, query: { key: ADMIN_KEY }, body: { status: 'declined' } });
        const dec = await putLink(meToken(DEA), BIGLINK);
        assert.strictEqual(dec.statusCode, 403, 'a declined presenter neither');
        assert.ok(/seat on Monday is confirmed/.test(String(dec.body.error)), 'and is told their seat stands');
        // back to undecided, so the later "who presents" section meets the fixtures it expects
        await call(app, 'POST', '/api/boston/presenters/:id/status', { params: { id: DEA }, query: { key: ADMIN_KEY }, body: { status: null } });
    });

    await t('the team sees the link: admin JSON, the download redirect, and links.txt in the ZIP', async () => {
        const IVO = 'abababab-abab-4bab-8bab-abababababab';
        const list = await call(app, 'GET', '/api/boston/presentations', { query: { key: ADMIN_KEY } });
        assert.strictEqual(list.statusCode, 200);
        const ivo = list.body.rows.find(r => r.registration_id === IVO);
        assert.ok(ivo && ivo.upload, 'listed with an upload');
        assert.strictEqual(ivo.upload.external_url, BIGLINK, 'the URL is exposed to the admin');
        assert.strictEqual(ivo.upload.filename, 'Link · drive.google.com');
        assert.ok(list.body.uploaded >= 1, 'counted as uploaded');
        const dl = await call(app, 'GET', '/api/boston/presentations/:id/download', { params: { id: ivo.upload.id }, query: { key: ADMIN_KEY } });
        assert.strictEqual(dl.statusCode, 302, 'download redirects');
        assert.strictEqual(dl.headers.location, BIGLINK, 'straight to the share link, no S3 involved');

        const zip = await call(app, 'GET', '/api/boston/presentations.zip', { query: { key: ADMIN_KEY } });
        assert.strictEqual(zip.statusCode, 200, JSON.stringify(zip.body).slice(0, 200));
        const bytes = Buffer.isBuffer(zip.body) ? zip.body : Buffer.from(zip.body);
        assert.ok(bytes.includes(Buffer.from('links.txt')), 'the archive carries links.txt');
        assert.ok(bytes.includes(Buffer.from('Ivo Kos')) && bytes.includes(Buffer.from(BIGLINK)), 'listing name + URL');
        assert.ok(bytes.includes(Buffer.from('Babic_Luka__')), 'alongside the stored decks');
    });

    // ================================================================ progress
    await t('the progress line counts what is done, out of the steps this guest has', async () => {
        seed('55555555-5555-4555-8555-555555555555', 'Petra', 'Maric', 'petra@example.com', null);
        const PETRA = '55555555-5555-4555-8555-555555555555';
        const read = async id => {
            const m = /<p class="prog[^"]*" id="prog"[\s\S]*?>([\s\S]*?)<\/p>/.exec(String((await page(id)).body));
            return m ? m[1].replace(/<[^>]+>/g, '').replace(/&mdash;/g, '\u2014').trim() : null;
        };
        // "All set" is the Finish click and nothing else (Alen 2026-09-16 — his attendee page opened
        // already finished before he had touched anything). The Finish button is the last numbered
        // step, so an attendee counts out of 3 and a presenter out of 4.
        assert.strictEqual(await read(PETRA), '0 of 3 done', 'a fresh attendee starts at zero — never pre-finished');
        await setDiet(meToken(PETRA), { pref: 'kosher' });
        await saveAllergies(PETRA, 'none');
        assert.strictEqual(await read(PETRA), '1 of 3 done', 'answering counts, but does not finish her');

        // Ana: dietary answered + a summary on file = 2 of 3, Finish still open
        assert.strictEqual(await read(ANA), '2 of 3 done', 'Ana is not finished until she says so');
        // Luka: dietary + slides, no summary = 2 of 4
        assert.strictEqual(await read(LUKA), '2 of 4 done', 'Luka: dietary + slides, summary skipped, Finish open');
    });

    await t('a presenter is NOT finished until the slides are in', async () => {
        const read = async id => {
            const m = /<p class="prog[^"]*" id="prog"[\s\S]*?>([\s\S]*?)<\/p>/.exec(String((await page(id)).body));
            return m ? m[1].replace(/<[^>]+>/g, '').replace(/&mdash;/g, '\u2014').trim() : null;
        };
        // Mia is a presenter with dietary answered (above) and nothing uploaded.
        assert.strictEqual(await read(MIA), '1 of 4 done', 'dietary only');
        await putSummary(meToken(MIA), { originalname: 'mia.pdf', buffer: pdfBuf() });
        assert.strictEqual(await read(MIA), '2 of 4 done', 'the optional summary counts, but does not finish her');
        const finishTry = await call(app, 'POST', '/api/boston/me/:token/finish', { params: { token: meToken(MIA) }, body: {} });
        assert.strictEqual(finishTry.statusCode, 409, 'Finish is refused while the deck is missing');
        assert.strictEqual(finishTry.body.incomplete, 'slides');
        await putSlides(meToken(MIA), { originalname: 'mia-talk.pptx', buffer: zipBuf() });
        assert.strictEqual(await read(MIA), '3 of 4 done', 'the deck unlocks Finish but does not finish her by itself');
        const fin = await call(app, 'POST', '/api/boston/me/:token/finish', { params: { token: meToken(MIA) }, body: {} });
        assert.strictEqual(fin.statusCode, 200, JSON.stringify(fin.body));
        assert.strictEqual(await read(MIA), 'All set — see you on Monday.', 'her own click is what finishes her');
        const html = String((await page(MIA)).body);
        assert.ok(html.includes('class="prog allset"'), 'the line is styled as the all-set state');
        // page order: steps 1–3, then Finish (step 4), then the ticket LAST — nobody scrolls past the button
        const iFinish = html.indexOf('id="finishcard"'), iTicket = html.indexOf('Your ticket for the door'), iStep3 = html.indexOf('id="step3"');
        assert.ok(iStep3 < iFinish && iFinish < iTicket, 'step 3 → Finish → ticket, in that order');
        assert.ok(/aria-label="Step 4 — finish"/.test(html), 'Finish is numbered step 4 for a presenter');
        assert.ok(html.includes('Your ticket below gets you in the door'), 'the finished copy points DOWN to the ticket');
    });

    await t('the ticket block is on the page whether the guest is finished or not', async () => {
        for (const id of [ANA, MIA, LUKA]) {
            const html = String((await page(id)).body);
            assert.ok(html.includes('Your ticket for the door'), 'ticket missing for ' + id.slice(0, 4));
            assert.ok(html.includes(`/api/boston/qr/${id}.png`), 'QR missing for ' + id.slice(0, 4));
        }
    });

    // ================================================================ the admin lists see it all
    await t('a hub upload shows up in the catering JSON, the CSV, and both file lists', async () => {
        const cat = await call(app, 'GET', '/api/boston/catering', { query: { key: ADMIN_KEY } });
        const ana = cat.body.rows.find(r => r.registration_id === ANA);
        assert.strictEqual(ana.preference, 'Vegetarian', 'her preference, from the hub');
        assert.strictEqual(ana.allergies, 'peanuts and shellfish', 'her allergies, from the hub');
        assert.strictEqual(ana.onepager, true, 'her summary is counted');
        assert.strictEqual(ana.onepager_share_ok, false, 'with the consent she actually gave');

        const csv = await call(app, 'GET', '/api/boston/catering.csv', { query: { key: ADMIN_KEY } });
        assert.ok(String(csv.body).includes('peanuts and shellfish'), 'the caterer reads it in the CSV');
        assert.ok(String(csv.body).includes('Private'), 'and so does the sharing answer');

        const op = await call(app, 'GET', '/api/boston/onepagers', { query: { key: ADMIN_KEY } });
        assert.ok(op.body.rows.find(r => r.registration_id === ANA).onepager, 'the one-pager list has it');
        const pres = await call(app, 'GET', '/api/boston/presentations', { query: { key: ADMIN_KEY } });
        const luka = pres.body.rows.find(r => r.registration_id === LUKA);
        assert.ok(luka.upload, 'the presentations list has the hub-uploaded deck');
        assert.strictEqual(luka.me_url, hub(LUKA), 'and the row carries the hub link for the copy button');
    });

    await t('the team page copies the hub link, not the old slides-only one', async () => {
        const r = await call(app, 'GET', '/boston/presentations', { query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 200);
        assert.ok(String(r.body).includes(`data-link="${hub(LUKA)}"`), 'the copy button hands out the hub link');
    });

    // ================================================================ nothing already sent is broken
    await t('every older personal link still resolves exactly as before', async () => {
        for (const [what, r] of [
            ['catering', await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: dietToken(ANA), answer: 'open' } })],
            ['catering write', await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: dietToken(ANA), answer: 'vegetarian' } })],
            ['summary page', await call(app, 'GET', '/boston/onepager/:token', { params: { token: onepagerToken(ANA) } })],
            ['slides page', await call(app, 'GET', '/boston/upload/:token', { params: { token: uploadToken(LUKA) } })],
            ['cannot-attend', await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: dietToken(ANA), answer: 'cannot-attend' } })]
        ]) {
            assert.strictEqual(r.statusCode, 200, what + ' must keep working');
        }
        const up = await call(app, 'POST', '/api/boston/onepager/:token', { params: { token: onepagerToken(ANA) }, file: { originalname: 'still-works.pdf', buffer: pdfBuf() } });
        assert.strictEqual(up.statusCode, 200, 'and the old summary API still stores');
        const sl = await call(app, 'POST', '/api/boston/upload/:token', { params: { token: uploadToken(LUKA) }, file: { originalname: 'still-works.pptx', buffer: zipBuf() } });
        assert.strictEqual(sl.statusCode, 200, 'and so does the old slides API');
    });

    await t('the two doors write ONE record — the hub and the old page share table and prefix', () => {
        const summaries = rows('bridges_onepagers', ANA);
        assert.ok(summaries.length >= 3, 'every version is in the one table: ' + summaries.length);
        for (const s of summaries) assert.ok(String(s.stored_key).startsWith('boston/onepagers/' + ANA + '/'), 'one prefix: ' + s.stored_key);
        const decks = rows('bridges_presentations', LUKA);
        for (const d of decks) assert.ok(String(d.stored_key).startsWith('boston-2026/' + LUKA + '/'), 'one prefix: ' + d.stored_key);
    });

    // ================================================================ the email
    await t('every button in the Boston email carries the boston:me: token, with its anchor', async () => {
        query.run(`UPDATE bridges_registrations SET notes = NULL WHERE id = ?`, [GONE]);   // keep the send list honest
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview' } });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        const [pres, att] = sentEmails.slice(-4);

        // the attendee shape — two asks, both on the hub
        assert.ok(/Open my personal page/.test(att.html), 'the one button under the asks');
        assert.ok(att.html.includes(hub(ANA)), 'and it is her hub link');
        assert.ok(att.html.includes(hub(ANA)), 'the button opens her page');
        assert.ok(!/Send us your presentation slides/.test(att.html), 'an attendee is never sent to the slides step');

        // the presenter shape — all three
        assert.ok(pres.html.includes(hub(LUKA)), 'the button opens his page');
        assert.ok(/Send us your presentation slides/.test(pres.html), 'and names the slides step');

        // required / optional, said in the section headers
        for (const mail of [pres, att]) {
            assert.ok(/>optional<\/span>/.test(mail.html), 'an optional tag on every shape');
            assert.ok(/>optional<\/span>/.test(mail.html), 'and an optional one');
            assert.ok(!/\/boston\/me\/[0-9a-f-]{36}\b/.test(mail.html), 'a bare id must never appear in a hub link');
        }
        assert.ok(att.html.includes('Your ticket for the door'), 'the ticket is still at the bottom');
        assert.ok(/Have a look at the attached program/.test(att.html), 'and the program section is still there');
    });

    await t('each anchor points at a step that actually exists on the page it opens', async () => {
        const html = String((await page(LUKA)).body);
        for (const a of ['step1', 'step2', 'step3']) assert.ok(html.includes(`id="${a}"`), 'the email links to #' + a + ', so it must exist');
    });

    // ================================================================ receipts + the Finish button
    const finish = token => call(app, 'POST', '/api/boston/me/:token/finish', { params: { token }, body: {} });
    const mailsTo = to => sentEmails.filter(m => m.to === to);
    const SLIDES_RECEIPT = 'Your slides are in — Building Bridges Boston';
    const SUMMARY_RECEIPT = 'Your one-slide summary is in — Building Bridges Boston';
    const RECAP = "You're all set — Building Bridges Boston";

    await t('the FIRST summary and the FIRST deck each earn one receipt; replacements are silent', async () => {
        seed('12121212-1212-4121-8121-121212121212', 'Rita', 'Prva', 'rita@example.com', '5-minute presentation requested');
        const RITA = '12121212-1212-4121-8121-121212121212';
        await putSummary(meToken(RITA), { originalname: 'rita-slide.pdf', buffer: pdfBuf() });
        let mine = mailsTo('rita@example.com');
        assert.strictEqual(mine.length, 1, 'one receipt for the first summary');
        assert.strictEqual(mine[0].subject, SUMMARY_RECEIPT);
        assert.ok(mine[0].html.includes('rita-slide.pdf'), 'names the file');
        assert.ok(mine[0].html.includes(`/boston/me/${meToken(RITA)}`), 'carries her personal-page link');
        assert.ok(!/tone.*dark|#342718/.test(mine[0].html), 'light Boston shell, not the Zagreb dark one');
        assert.ok(/RECEIPT-SUMMARY-SENT \d{4}-\d{2}-\d{2}/.test(String(rowOf(RITA).notes)), 'marker stamped');

        await putSummary(meToken(RITA), { originalname: 'rita-v2.pdf', buffer: pdfBuf() });
        assert.strictEqual(mailsTo('rita@example.com').length, 1, 'a replacement re-emails nothing');

        await putSlides(meToken(RITA), { originalname: 'rita-talk.pptx', buffer: zipBuf() });
        mine = mailsTo('rita@example.com');
        assert.strictEqual(mine.length, 2, 'and one receipt for the first deck');
        assert.strictEqual(mine[1].subject, SLIDES_RECEIPT);
        assert.ok(mine[1].html.includes('rita-talk.pptx'));
        assert.ok(/nothing to bring/.test(mine[1].html), 'says we preload it');
        await putSlides(meToken(RITA), { originalname: 'rita-talk-final.pptx', buffer: zipBuf() });
        assert.strictEqual(mailsTo('rita@example.com').length, 2, 'deck replacement re-emails nothing');
    });

    await t('a pasted share link counts as the deck — receipt carries the link, replacement silent', async () => {
        seed('13131313-1313-4131-8131-131313131313', 'Marko', 'Link', 'marko@example.com', '5-minute presentation requested');
        const MARKO = '13131313-1313-4131-8131-131313131313';
        const url = 'https://www.dropbox.com/s/abc123/deck.pptx?dl=0';
        await call(app, 'POST', '/api/boston/me/:token/slides-link', { params: { token: meToken(MARKO) }, body: { url } });
        const mine = mailsTo('marko@example.com');
        assert.strictEqual(mine.length, 1);
        assert.strictEqual(mine[0].subject, SLIDES_RECEIPT);
        assert.ok(mine[0].html.includes(url.replace(/&/g, '&amp;')), 'the receipt shows the link');
        await putSlides(meToken(MARKO), { originalname: 'marko.pdf', buffer: pdfBuf() });
        assert.strictEqual(mailsTo('marko@example.com').length, 1, 'the file after the link is a replacement — silent');
    });

    await t('diet answers alone never email anyone', async () => {
        seed('14141414-1414-4141-8141-141414141414', 'Tiha', 'Dijeta', 'tiha@example.com', null);
        const TIHA = '14141414-1414-4141-8141-141414141414';
        await setDiet(meToken(TIHA), { pref: 'vegan' });
        await saveAllergies(TIHA, 'none');
        assert.strictEqual(mailsTo('tiha@example.com').length, 0);
    });

    await t('Finish: an attendee finishes at once — marker, ONE recap email, idempotent', async () => {
        const TIHA = '14141414-1414-4141-8141-141414141414';
        const r = await finish(meToken(TIHA));
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.deepStrictEqual([r.body.success, r.body.finished, r.body.already], [true, true, false]);
        assert.ok(/ME-FINISHED \d{4}-\d{2}-\d{2}/.test(String(rowOf(TIHA).notes)), 'the marker with its date');
        const mine = mailsTo('tiha@example.com');
        assert.strictEqual(mine.length, 1, 'exactly one recap');
        assert.strictEqual(mine[0].subject, RECAP);
        assert.ok(mine[0].html.includes('Vegan'), 'recaps her dietary answer');
        assert.ok(mine[0].html.includes('not sent (optional)'), 'says the summary is optional and absent');
        assert.ok(mine[0].html.includes(`/api/boston/qr/${TIHA}.png`), 'the ticket QR');
        assert.ok(mine[0].html.includes('BB-BOS-' + TIHA.slice(0, 8).toUpperCase()), 'and the ticket number');
        assert.ok(mine[0].html.includes('come back to your personal page any time'), 'the way back');
        const again = await finish(meToken(TIHA));
        assert.strictEqual(again.body.already, true, 'a second click is acknowledged');
        assert.strictEqual(mailsTo('tiha@example.com').length, 1, 'and re-emails nothing');
    });

    await t('Finish: a presenter without a deck is turned back to step 3, unstamped', async () => {
        seed('15151515-1515-4151-8151-151515151515', 'Petar', 'Bez', 'petar@example.com', '5-minute presentation requested');
        const PETAR = '15151515-1515-4151-8151-151515151515';
        const r = await finish(meToken(PETAR));
        assert.strictEqual(r.statusCode, 409);
        assert.strictEqual(r.body.incomplete, 'slides');
        assert.ok(/One thing left/.test(String(r.body.error)));
        assert.ok(!/ME-FINISHED/.test(String(rowOf(PETAR).notes)), 'not stamped');
        assert.strictEqual(mailsTo('petar@example.com').length, 0, 'and no recap');
        // a share link satisfies the requirement, exactly like an upload
        await call(app, 'POST', '/api/boston/me/:token/slides-link', { params: { token: meToken(PETAR) }, body: { url: 'https://drive.google.com/file/d/xyz/view' } });
        const ok = await finish(meToken(PETAR));
        assert.strictEqual(ok.statusCode, 200);
        const recaps = mailsTo('petar@example.com').filter(m => m.subject === RECAP);
        assert.strictEqual(recaps.length, 1);
        assert.ok(/Presentation slides/.test(recaps[0].html), 'the recap lists the slides row for a presenter');
    });

    await t('the page carries the Finish card, the completion state, and the help line', async () => {
        const PETAR = '15151515-1515-4151-8151-151515151515';
        const fresh = String((await page(ANA)).body);
        assert.ok(fresh.includes('id="finish_go"') && /Finish (—|&mdash;) I(’|&rsquo;)m all set/.test(fresh), 'the button');
        assert.ok(/Having issues\? Please contact us/.test(fresh) && fresh.includes('mailto:laura.rodman@medx.hr'), 'the help line');
        const done = String((await page(PETAR)).body);
        assert.ok(/<div id="finish_pending" hidden>/.test(done), 'a finished guest sees no button');
        assert.ok(/All set (—|&mdash;) see you on Monday, 21 September\./.test(done), 'the completion state');
        assert.ok(done.includes('come back to this page any time'), 'and the way back');
    });

    await t('cateringData counts the strip: slides in X/Y presenters (links count), finished, released', async () => {
        const d = (await call(app, 'GET', '/api/boston/catering', { query: { key: ADMIN_KEY } })).body;
        assert.ok(d.slides_expected >= 2, 'presenters expected');
        assert.ok(d.slides_in >= 2, 'decks + links counted');
        assert.ok(d.finished_count >= 2, 'Tiha and Petar finished');
        assert.strictEqual(typeof d.released_count, 'number');
        const marko = d.rows.find(r => r.registration_id === '13131313-1313-4131-8131-131313131313');
        assert.strictEqual(marko.slides, true, 'slides-in');
        assert.strictEqual(marko.slides_link, false, 'his FILE replaced the link — newest wins');
        const petar = d.rows.find(r => r.registration_id === '15151515-1515-4151-8151-151515151515');
        assert.strictEqual(petar.slides, true, 'a link row reads as slides-in');
        assert.strictEqual(petar.slides_link, true, 'and is marked as a link');
        const tiha = d.rows.find(r => r.registration_id === '14141414-1414-4141-8141-141414141414');
        assert.strictEqual(tiha.finished, true);
        const ana = d.rows.find(r => r.registration_id === ANA);
        assert.strictEqual(ana.finished, false);
    });

    // ================================================================ who actually presents
    // ~30 people ticked "5-minute presentation" and the evening holds far fewer, so the owner picks.
    // Three states, and the one that matters most is NULL: until he decides, nothing may change.
    const DEC = '66666666-6666-4666-8666-666666666666';    // offered, will be declined
    const UND = '77777777-7777-4777-8777-777777777777';    // offered, left undecided on purpose
    seed(DEC, 'Dora', 'Kovac', 'dora@example.test', '5-minute presentation requested');
    seed(UND, 'Ivo', 'Peric', 'ivo@example.test', '5-minute presentation requested');
    const setStatus = (id, status, key) => call(app, 'POST', '/api/boston/presenters/:id/status',
        { params: { id }, query: { key: key === undefined ? ADMIN_KEY : key }, body: { status } });
    const presRows = async () => (await call(app, 'GET', '/api/boston/presentations', { query: { key: ADMIN_KEY } })).body;

    await t('the status route is keyed, validated, and refuses a stranger', async () => {
        assert.strictEqual((await setStatus(DEC, 'declined', 'wrong-key')).statusCode, 404, 'a bad key is a 404');
        assert.strictEqual((await setStatus(DEC, 'declined', '')).statusCode, 404, 'and so is no key');
        assert.strictEqual((await setStatus(UNKNOWN, 'declined')).statusCode, 404, 'an unknown id is a 404');
        for (const bad of ['maybe', 'yes', 0, 'cancelled', 'presenter']) {
            assert.strictEqual((await setStatus(DEC, bad)).statusCode, 400, 'must refuse ' + JSON.stringify(bad));
        }
        // Case and stray whitespace are forgiven on purpose — a hand-typed curl must not be able to
        // write a value that then reads as "undecided" everywhere.
        assert.strictEqual((await setStatus(DEC, '  CONFIRMED ')).body.presenter_status, 'confirmed');
        await setStatus(DEC, null);   // back to undecided for the tests below
        assert.strictEqual(rowOf(DEC).presenter_status, null, 'and null means null, not the string');
    });

    await t('NULL is the fallback: an undecided offer still reads as a presenter, everywhere', async () => {
        assert.strictEqual(rowOf(UND).presenter_status, null, 'nothing was written for him');
        const html = String((await page(UND)).body);
        assert.ok(html.includes('id="step3"'), 'the hub still shows his slides step');
        assert.ok(!html.includes('id="step3note"'), 'and never the declined note');
        assert.strictEqual((await putSlides(meToken(UND), { originalname: 'ivo.pptx', buffer: zipBuf() })).statusCode, 200,
            'and he can still upload — nothing changes until the owner decides');
        const row = (await presRows()).rows.find(r => r.registration_id === UND);
        assert.strictEqual(row.presenter_status, null, 'the admin row says undecided');
        assert.strictEqual(row.presentation_requested, true, 'and that he asked');
        assert.strictEqual(row.presenter, true, 'and that, for now, he is on the running order');
    });

    await t('"confirmed" keeps them on the running order, and is idempotent', async () => {
        const r = await setStatus(UND, 'confirmed');
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.presenter, true);
        assert.strictEqual(r.body.presenter_status, 'confirmed');
        assert.strictEqual((await setStatus(UND, 'confirmed')).body.presenter_status, 'confirmed', 'twice is once');
        assert.ok(String((await page(UND)).body).includes('id="step3"'), 'the slides step stays');
        await setStatus(UND, null);
        assert.strictEqual(rowOf(UND).presenter_status, null, 'and it can be taken back to undecided');
    });

    await t('"declined" takes the slides step away but keeps the offer on the record', async () => {
        const r = await setStatus(DEC, 'declined');
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.presenter, false, 'no longer on the running order');
        assert.strictEqual(r.body.presentation_requested, true, 'but the offer is a fact and stays');
        assert.strictEqual(r.body.declined_presenter, true);
        assert.ok(/5-minute presentation/.test(String(rowOf(DEC).notes)), 'the notes were not rewritten');
    });

    await t('the declined hub hides step 3 and opens on the seat, not the decline', async () => {
        const html = String((await page(DEC)).body);
        assert.ok(!html.includes('id="step3"'), 'no slides step');
        // The email already told her; the page says NOTHING about the decision (Alen 2026-09-16).
        assert.ok(!html.includes('id="step3note"') && !/could not accommodate|About your presentation|next editions/.test(html), 'no decline note on the page');
        assert.ok(/aria-label="Step 3 — finish"/.test(html), 'she gets the plain attendee steps: Finish is step 3');
        assert.ok(!/\bhonest\b/i.test(html), 'never that word');
        assert.ok(/<b>[012]<\/b> of 3 done/.test(html) && !html.includes('class="prog allset"'), 'not pre-finished — the count is open until she clicks Finish');
        assert.ok(html.includes('Your ticket for the door'), 'and she still holds a ticket');
    });

    await t('the slides API refuses a declined guest kindly, and still says "your seat is confirmed"', async () => {
        const puts = s3Puts.length;
        const r = await putSlides(meToken(DEC), { originalname: 'dora.pptx', buffer: zipBuf() });
        assert.strictEqual(r.statusCode, 403);
        assert.ok(/seat on Monday is confirmed/.test(String(r.body.error)), 'the refusal carries the seat: ' + r.body.error);
        assert.ok(/one-slide summary is very welcome/.test(String(r.body.error)), 'and points at what she CAN send');
        assert.strictEqual(s3Puts.length, puts, 'nothing stored');
    });

    await t('the admin list partitions the people who offered: confirmed · declined · undecided', async () => {
        await setStatus(UND, null);
        const d = await presRows();
        assert.strictEqual(d.confirmed + d.declined + d.undecided, d.requested,
            'the three counts must always add up to the number of offers');
        assert.ok(d.declined >= 1, 'Dora is counted declined');
        assert.ok(d.undecided >= 1, 'Ivo is counted undecided');
        const dora = d.rows.find(r => r.registration_id === DEC);
        assert.strictEqual(dora.presenter_status, 'declined');
        assert.strictEqual(dora.presentation_requested, true, 'she stays in the list — she asked');
        assert.strictEqual(dora.presenter, false);
        assert.ok(dora.me_url, 'with her hub link for the copy button');
    });

    await t('the catering JSON carries the offer and the decision beside the derived flag', async () => {
        const cat = await call(app, 'GET', '/api/boston/catering', { query: { key: ADMIN_KEY } });
        const dora = cat.body.rows.find(r => r.registration_id === DEC);
        assert.strictEqual(dora.presenter, false, 'not on the running order');
        assert.strictEqual(dora.presentation_requested, true, 'but she offered');
        assert.strictEqual(dora.presenter_status, 'declined');
        assert.strictEqual(dora.declined_presenter, true);
        const ivo = cat.body.rows.find(r => r.registration_id === UND);
        assert.strictEqual(ivo.presenter_status, null, 'undecided reads as null');
        assert.strictEqual(ivo.presenter, true, 'and still counts as a presenter for now');
    });

    await t('a declined guest is never sent an "upload your slides" invite', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/presenters/send-links', { query: { key: ADMIN_KEY }, body: { to: DEC } });
        assert.strictEqual(r.statusCode, 200);
        assert.deepStrictEqual(r.body.sent, [], 'nobody was written to');
        assert.strictEqual(sentEmails.length, before, 'and not one email left');
    });

    await t('the declined EMAIL opens on the seat, hoists the ticket, and drops step 3', async () => {
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview' } });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.deepStrictEqual(r.body.variants, ['presenter', 'attendee', 'declined', 'panel']);
        assert.strictEqual(r.body.declined_sample, false, 'a real declined row exists now, so it is not a sample');
        const [pres, att, dec] = sentEmails.slice(-4);
        assert.ok(dec.subject.includes('declined-presenter · still expected'), 'the subject says it: ' + dec.subject);
        assert.ok(!dec.subject.includes('(sample)'), 'and not flagged a sample');

        assert.ok(/Your seat on Monday is confirmed/.test(dec.html), 'the note is there');
        assert.ok(/Your seat on Monday is confirmed and we very much look forward to seeing you\./.test(dec.html), 'opening on the seat');
        assert.ok(/many more requests than the evening can hold/.test(dec.html) && /sadly we could not accommodate your presentation this time/.test(dec.html), 'the reason, said once and plainly');
        assert.ok(/We are sorry about that/.test(dec.html), 'with an apology');
        assert.ok(/warmly encourage you to send us your <b>one-slide summary<\/b>/.test(dec.html) && /shared with all participants/.test(dec.html), 'and the summary is encouraged — their work still reaches the room');
        assert.ok(!/\bhonest\b/i.test(dec.html), 'never that word');
        assert.ok(/hope to have you present at one of the next editions/.test(dec.html), 'the door left open');

        // the seat is the point: the note comes before the word "presentation slides" ever could,
        // and the ticket sits directly under it instead of at the very bottom.
        const note = dec.html.indexOf('Your seat on Monday is confirmed');
        const asks = dec.html.indexOf('we would ask you to do the following');
        assert.ok(note < asks, 'the seat note comes before the asks');
        assert.ok(!dec.html.includes('Send us your presentation slides'), 'no slides ask');
        assert.ok(!/Send us your presentation slides/.test(dec.html), 'and the button does not mention slides');
        assert.ok(dec.html.includes(hub(DEC)), 'the button opens her page');

        // and the other two shapes are untouched by any of this
        assert.ok(pres.html.includes('Send us your presentation slides'), 'the presenter still presents');
        assert.ok(!pres.html.includes('About your presentation'), 'and is never shown the note');
        assert.ok(!att.html.includes('About your presentation'), 'nor is a plain attendee');
        assert.ok(att.html.indexOf('Your ticket for the door') > att.html.indexOf('Please read the attached program'),
            'whose ticket stays at the bottom where it was');
    });

    await t('one shape can still be previewed alone, and an invented one is refused', async () => {
        const one = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'declined' } });
        assert.deepStrictEqual(one.body.variants, ['declined']);
        assert.ok(/Your seat on Monday is confirmed/.test(sentEmails[sentEmails.length - 1].html));
        const bad = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'everyone' } });
        assert.strictEqual(bad.statusCode, 400, 'an invented variant is refused');
    });

    // ================================================================ the PANEL shape (Alen 2026-09-16)
    const PAN = 'ca1ca1ca-ca1c-4a1c-8a1c-ca1ca1ca1ca1';
    seed(PAN, 'Guido', 'Panel', 'guido@example.com', '5-minute presentation requested');
    const panelReply = (token, reply) => call(app, 'POST', '/api/boston/me/:token/panel', { params: { token }, body: { reply } });

    await t('panel: the status is accepted by the presenter route and flips every reader', async () => {
        const r = await call(app, 'POST', '/api/boston/presenters/:id/status', { params: { id: PAN }, query: { key: ADMIN_KEY }, body: { status: 'panel' } });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.presenter_status, 'panel');
        assert.strictEqual(r.body.presenter, false, 'a panelist is not on the running order');
        assert.strictEqual(r.body.declined_presenter, false, 'and is not a declined presenter');
        assert.strictEqual(r.body.panel, true);
        const pres = await call(app, 'GET', '/api/boston/presentations', { query: { key: ADMIN_KEY } });
        const row = pres.body.rows.find(x => x.registration_id === PAN);
        assert.ok(row && row.panel === true && row.panel_reply === null, 'the admin list carries the panel flag and the (unanswered) reply');
        assert.strictEqual(pres.body.panel, 1, 'the panel count is one of the partition of offers');
        assert.strictEqual(pres.body.confirmed + pres.body.panel + pres.body.declined + pres.body.undecided, pres.body.requested, 'and the partition still adds up');
    });

    await t('panel: the email is its own shape — invitation, the answer as ask 1, no slides step', async () => {
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'panel' } });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.deepStrictEqual(r.body.variants, ['panel']);
        const m = sentEmails[sentEmails.length - 1];
        assert.ok(m.subject.startsWith('[PREVIEW · panel]'), m.subject);
        assert.ok(/join the <b>panel discussion<\/b> instead/.test(m.html), 'the invitation');
        assert.ok(/7:05&nbsp;PM, about 25 minutes, moderated by Alen Juginovic together with a few other senior guests/.test(m.html), 'time, length, moderator');
        assert.ok(/challenges and opportunities in biomedical collaboration/.test(m.html), 'what they will be asked about');
        assert.ok(/No slides are needed/.test(m.html) && /whether you can join the panel/.test(m.html), 'no slides; answer on the page');
        assert.ok(/Tell us whether you can join the panel/.test(m.html), 'the answer is a numbered ask');
        assert.ok(m.html.indexOf('Tell us whether you can join the panel') < m.html.indexOf('dietary preference'), 'and it comes first');
        assert.ok(!/Send us your presentation slides/.test(m.html), 'no slides ask');
        assert.ok(!/could not accommodate your presentation/.test(m.html), 'never the declined wording');
        assert.ok(!/happy to offer you a <b>5-minute slot<\/b>/.test(m.html), 'never the presenter wording');
        assert.ok(!/\bhonest\b/i.test(m.html));
    });

    await t('panel: the page opens on the question, Finish waits for the answer, the team hears both ways', async () => {
        const html = (await page(PAN)).body;
        assert.ok(/You are on the panel at 7:05 PM/.test(html), 'the calm line under the name');
        assert.ok(/id="stepP"/.test(html) && /The panel: will you join us\?/.test(html), 'step 1 is the panel question');
        assert.ok(/Yes, I&rsquo;ll join the panel/.test(html) && /I&rsquo;d rather not/.test(html), 'two buttons');
        assert.ok(html.indexOf('id="stepP"') < html.indexOf('id="step1"'), 'and it sits above dietary');
        assert.ok(/data-total="4"/.test(html), 'four numbered steps for a panelist');
        assert.ok(!/id="step3"/.test(html), 'no slides step');

        const tooSoon = await call(app, 'POST', '/api/boston/me/:token/finish', { params: { token: meToken(PAN) }, body: {} });
        assert.strictEqual(tooSoon.statusCode, 409); assert.strictEqual(tooSoon.body.incomplete, 'panel');

        const before = sentEmails.length;
        const yes = await panelReply(meToken(PAN), 'yes');
        assert.strictEqual(yes.statusCode, 200, JSON.stringify(yes.body));
        assert.strictEqual(rowOf(PAN).panel_reply, 'yes'); assert.ok(rowOf(PAN).panel_replied_at);
        const fyi = sentEmails.slice(before);
        assert.strictEqual(fyi.length, 2, 'one FYI to Laura, one to Alen');
        assert.ok(fyi.every(x => /accepted the panel seat/.test(x.subject)), fyi.map(x => x.subject).join(' | '));
        assert.deepStrictEqual(fyi.map(x => x.to).sort(), ['juginovic.alen@gmail.com', 'laura.rodman@medx.hr']);

        const again = await panelReply(meToken(PAN), 'yes');
        assert.strictEqual(sentEmails.length, before + 2, 'saying yes twice re-emails nobody');
        assert.strictEqual(again.body.changed, false);

        const no = await panelReply(meToken(PAN), 'no');
        assert.strictEqual(no.statusCode, 200); assert.strictEqual(rowOf(PAN).panel_reply, 'no');
        assert.strictEqual(sentEmails.length, before + 4, 'a change of mind is reported');
        assert.ok(/declined the panel seat/.test(sentEmails[sentEmails.length - 1].subject));
        assert.ok(/keep their seat as a guest/.test(sentEmails[sentEmails.length - 1].html), 'the FYI says the seat stays');
        assert.strictEqual((await panelReply(meToken(PAN), 'maybe')).statusCode, 400, 'only yes or no');
        assert.strictEqual((await panelReply(meToken(ANA), 'yes')).statusCode, 403, 'a non-panelist has no panel question');

        const fin = await call(app, 'POST', '/api/boston/me/:token/finish', { params: { token: meToken(PAN) }, body: {} });
        assert.strictEqual(fin.statusCode, 200, 'answered (either way) → Finish works');
        const cat = await call(app, 'GET', '/api/boston/catering', { query: { key: ADMIN_KEY } });
        assert.strictEqual(cat.body.panel_count, 1); assert.strictEqual(cat.body.panel_declined, 1); assert.strictEqual(cat.body.panel_accepted, 0);
    });

    // ================================================================ the guard rails
    await t('guests hear only receipts and the finish recap, and no network was touched', () => {
        const GUEST_OK = [
            'Your slides are in — Building Bridges Boston',
            'Your one-slide summary is in — Building Bridges Boston',
            "You're all set — Building Bridges Boston"
        ];
        for (const m of sentEmails) {
            if (/juginovic\.alen@gmail\.com|laura\.rodman@medx\.hr/.test(String(m.to))) continue;
            assert.ok(GUEST_OK.includes(m.subject), 'an unexpected email escaped to a guest: ' + m.to + ' — ' + m.subject);
        }
        assert.ok(s3Puts.length > 0, 'the S3 stub did the storing');
        assert.throws(() => global.fetch(), /NETWORK DISABLED/, 'the network is still off');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
