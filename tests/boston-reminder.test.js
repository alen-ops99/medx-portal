/**
 * tests/boston-reminder.test.js — THE one Boston email (program PDF attachment, ticket, catering,
 * one-pager, slides) and the one-tap catering answers it collects back (user-portal/backend/boston.js).
 *
 * Hermetic, and shaped exactly like tests/boston.test.js: a stub express app collects the routes,
 * a scratch in-memory sqlite (node:sqlite — no npm install needed) carries the REAL
 * bridges_events / bridges_registrations schema INCLUDING the columns this feature writes
 * (dietary_requirements, special_requests, reminder_sent, notes, custom_answers), sendEmail is a
 * capturing stub and global.fetch throws. A REAL EMAIL SEND OR ANY NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Run:  node tests/boston-reminder.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- hermetic env
delete process.env.BREVO_API_KEY;
delete process.env.GOOGLE_SHEETS_WEBHOOK;
delete process.env.BB_SHEET_ID;                          // belt: no sheet write can even be attempted
delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.PUBLIC_BASE_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_') || k.startsWith('BB_S3_')) delete process.env[k];
delete process.env.GOOGLE_WALLET_ISSUER_ID;              // wallet off — the email degrades to QR + calendar
delete process.env.GOOGLE_WALLET_SA_KEY;

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const wallet = require('../shared/wallet.js');
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const mountBoston = require('../user-portal/backend/boston.js');
mountBoston._s3.putObject = async () => ({ etag: '"stub-etag"' });   // never the wire

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
async function call(app, method, path, { body, params, query: qs } = {}) {
    const h = app.routes[method + ' ' + path];
    if (!h) throw new Error('route not mounted: ' + method + ' ' + path);
    const res = makeRes();
    await h({ body: body || {}, params: params || {}, query: qs || {}, get: () => '' }, res);
    return res._r;
}

const sentEmails = [];
const sendEmailStub = async (to, subject, html, attachments) => {
    sentEmails.push({ to, subject, html, attachments: attachments || null });
    return { success: true };
};

// ---------------------------------------------------------------- the program PDF (the attachment)
// BB_S3_* is deleted above, so the wing starts with NO program PDF — exactly the state the owner
// previews from. programOn() flips the env on and stubs the two read paths; the bytes never leave
// this process (putObject is stubbed too, above).
const PROGRAM_BYTES = Buffer.from('%PDF-1.7\nBuilding Bridges Boston — program\n%%EOF');
const s3Reads = [];
mountBoston._s3.getObject = async (key) => { s3Reads.push(String(key)); return PROGRAM_BYTES; };
mountBoston._s3.headObject = async () => ({ size: PROGRAM_BYTES.length, lastModified: '2026-09-13T09:00:00.000Z' });
function programOn() { process.env.BB_S3_BUCKET = 'bb-test'; process.env.BB_S3_KEY = 'AKIATEST'; process.env.BB_S3_SECRET = 'shh'; }
function programOff() { delete process.env.BB_S3_BUCKET; delete process.env.BB_S3_KEY; delete process.env.BB_S3_SECRET; }

const JWT_SECRET = 'test-secret-boston-reminder';
const app = makeApp();
mountBoston(app, { query, saveDb: () => {}, sendEmail: sendEmailStub, flushDb: () => {}, JWT_SECRET });

const reviewGate = require('../user-portal/backend/review-gate.js');
const REVIEW_TO = reviewGate.REVIEW_TO;

const EVENT_ID = 'bb-boston-2026-09-21';
const BASE = 'https://medx-user-portal.onrender.com';
const ADMIN_KEY = crypto.createHmac('sha256', JWT_SECRET).update('boston-admin').digest('hex').slice(0, 40);
const dietToken = id => crypto.createHmac('sha256', JWT_SECRET).update('boston:diet:' + id).digest('hex').slice(0, 32) + '.' + id;
const uploadToken = id => crypto.createHmac('sha256', JWT_SECRET).update('bostonup:' + id).digest('hex').slice(0, 32) + '.' + id;
const onepagerToken = id => crypto.createHmac('sha256', JWT_SECRET).update('boston:onepager:' + id).digest('hex').slice(0, 32) + '.' + id;

// The two facts the owner's program PDF fixes (2026-09-13). Literals on purpose: moving the date
// or the format has to be a deliberate edit here as well as in the wing.
const DEADLINE = 'Saturday, 19 September 2026';
const FORMAT_LINE = '5 minutes · 5 to 8 slides · PowerPoint 16:9, in English (PDF also accepted) · up to 25 MB · all talks run from one laptop';

// ---------------------------------------------------------------- seed
// Registration ids are UUIDs in production (crypto.randomUUID) and the token grammar says so —
// fixed UUIDs here keep every assertion readable.
const ANA = '11111111-1111-4111-8111-111111111111';
const LUKA = '22222222-2222-4222-8222-222222222222';
const MIA = '33333333-3333-4333-8333-333333333333';
const HELD = '44444444-4444-4444-8444-444444444444';
const GONE = '55555555-5555-4555-8555-555555555555';
const QUIET = '66666666-6666-4666-8666-666666666666';
const OTHER = '77777777-7777-4777-8777-777777777777';
const NOBODY = '88888888-8888-4888-8888-888888888888';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
query.run(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, capacity, registration_open)
    VALUES (?, 'boston-2026', 'Building Bridges in Biomedicine — Boston', 'Boston', 'Waterhouse Room, Gordon Hall', '2026-09-21', 'upcoming', 60, 1)`, [EVENT_ID]);
function seed(id, first, last, email, notes, status) {
    query.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, notes, status, payment_status, confirmation_sent)
        VALUES (?,?,?,?,?,?,?,?,'n/a',1)`, [id, EVENT_ID, first, last, email, first + ' Institute', notes, status || 'registered']);
}
seed(ANA, 'Ana', 'Horvat', 'ana@example.com', null);
seed(LUKA, 'Luka', 'Babic', 'luka@example.com', '5-minute presentation requested');       // presenter, no deck
seed(MIA, 'Mia', 'Novak', 'mia@example.com', '5-minute presentation requested');          // presenter, deck below
seed(HELD, 'Bot', 'Held', 'bot@example.com', 'HELD — review', 'pending-review');          // never reminded
seed(GONE, 'Old', 'Cancel', 'gone@example.com', null, 'cancelled');                       // never reminded

const rowOf = id => query.get('SELECT * FROM bridges_registrations WHERE id = ?', [id]);
const caOf = id => { try { return JSON.parse(rowOf(id).custom_answers || 'null'); } catch (e) { return null; } };
const rsvp = (id, answer) => call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: dietToken(id), answer } });

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

(async () => {
    console.log('boston-reminder.test.js — hermetic (stub express, node:sqlite scratch DB, captured emails)\n');

    // ================================================================ routes
    await t('every route this feature needs is mounted', () => {
        for (const k of ['GET /boston/rsvp/:token/:answer', 'POST /api/boston/rsvp/:token/allergies',
            'POST /api/boston/reminders/send', 'GET /api/boston/catering', 'GET /api/boston/catering.csv',
            'GET /api/boston/program', 'POST /api/boston/program']) {
            assert.ok(app.routes[k], 'missing ' + k);
        }
    });

    // ================================================================ token forgery
    await t('a forged diet token is a 404 — and writes nothing', async () => {
        const forged = 'f'.repeat(32) + '.reg-ana';
        const r = await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: forged, answer: 'vegan' } });
        assert.strictEqual(r.statusCode, 404);
        assert.strictEqual(rowOf(ANA).dietary_requirements, null, 'a forged link must not record an answer');
    });
    await t('a pass token and an upload token are not diet tokens', async () => {
        const passTok = crypto.createHmac('sha256', JWT_SECRET).update('boston:reg-ana').digest('hex').slice(0, 32) + '.reg-ana';
        for (const tok of [passTok, uploadToken(ANA)]) {
            const r = await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: tok, answer: 'vegan' } });
            assert.strictEqual(r.statusCode, 404, 'context-separated HMAC must reject ' + tok.slice(0, 8));
        }
        assert.strictEqual(rowOf(ANA).dietary_requirements, null);
    });
    await t('a malformed token, an unknown id and an uppercase signature are all 404', async () => {
        for (const tok of ['', 'nope', 'abc.reg-ana', dietToken(ANA).toUpperCase(), dietToken(UNKNOWN)]) {
            const r = await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: tok, answer: 'vegan' } });
            assert.strictEqual(r.statusCode, 404, 'expected 404 for ' + JSON.stringify(tok.slice(0, 20)));
        }
    });
    await t('a valid token for a row belonging to another event is a 404', async () => {
        query.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status, payment_status)
            VALUES (?,'other-event','Ivan','Ivic','ivan@example.com','registered','n/a')`, [OTHER]);
        const r = await rsvp(OTHER, 'vegan');
        assert.strictEqual(r.statusCode, 404);
    });

    // ================================================================ the answer whitelist
    await t('every whitelisted preference records its own label, and nothing else is accepted', async () => {
        const expect = { none: 'No restrictions', vegetarian: 'Vegetarian', vegan: 'Vegan',
                         halal: 'Halal', kosher: 'Kosher', 'gluten-free': 'Gluten-free' };
        for (const [key, label] of Object.entries(expect)) {
            const r = await rsvp(ANA, key);
            assert.strictEqual(r.statusCode, 200, key + ' should be accepted');
            assert.strictEqual(rowOf(ANA).dietary_requirements, label, key + ' -> ' + label);
            assert.strictEqual(caOf(ANA).diet_pref, key, 'custom_answers.diet_pref');
        }
        for (const bad of ['pescatarian', 'VEGAN;DROP', 'no-restrictions', 'paleo', '../../etc', 'diet_pref', '']) {
            const r = await rsvp(ANA, bad);
            assert.strictEqual(r.statusCode, 404, JSON.stringify(bad) + ' must be refused');
        }
        assert.strictEqual(rowOf(ANA).dietary_requirements, 'Gluten-free', 'a refused answer must not overwrite the last good one');
    });
    await t('"open" shows the page and records nothing', async () => {
        const before = rowOf(ANA);
        const r = await rsvp(ANA, 'open');
        assert.strictEqual(r.statusCode, 200);
        const after = rowOf(ANA);
        assert.strictEqual(after.dietary_requirements, before.dietary_requirements);
        assert.strictEqual(after.special_requests, before.special_requests);
        assert.strictEqual(after.custom_answers, before.custom_answers);
    });

    // ================================================================ idempotency
    await t('re-clicking the same answer is idempotent; a different one simply replaces it', async () => {
        await rsvp(LUKA, 'vegetarian');
        await rsvp(LUKA, 'vegetarian');
        assert.strictEqual(rowOf(LUKA).dietary_requirements, 'Vegetarian');
        assert.strictEqual(query.all('SELECT id FROM bridges_registrations WHERE id = ?', [LUKA]).length, 1, 'no second row');
        await rsvp(LUKA, 'vegan');
        assert.strictEqual(rowOf(LUKA).dietary_requirements, 'Vegan');
        assert.strictEqual(caOf(LUKA).diet_pref, 'vegan');
        assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(caOf(LUKA).answered_at), 'answered_at moves with the latest tap');
    });
    await t('the two answers are independent — recording one never clears the other', async () => {
        await rsvp(LUKA, 'no-allergies');
        assert.strictEqual(rowOf(LUKA).dietary_requirements, 'Vegan', 'the preference survives the allergy answer');
        assert.strictEqual(rowOf(LUKA).special_requests, 'Allergies: none');
        await rsvp(LUKA, 'halal');
        assert.strictEqual(rowOf(LUKA).special_requests, 'Allergies: none', 'the allergy answer survives the preference answer');
        const ca = caOf(LUKA);
        assert.strictEqual(ca.diet_pref, 'halal');
        assert.strictEqual(ca.allergies, 'none');
        assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(ca.answered_at), 'answered_at is an ISO timestamp');
    });
    await t('custom_answers is merged, never replaced — a pre-existing key survives', async () => {
        query.run(`UPDATE bridges_registrations SET custom_answers = ? WHERE id = ?`,
            [JSON.stringify({ how_did_you_hear: 'A colleague' }), MIA]);
        await rsvp(MIA, 'kosher');
        const ca = caOf(MIA);
        assert.strictEqual(ca.how_did_you_hear, 'A colleague', 'the existing answer must survive');
        assert.strictEqual(ca.diet_pref, 'kosher');
    });
    await t('a corrupt custom_answers blob is replaced, not crashed on', async () => {
        query.run(`UPDATE bridges_registrations SET custom_answers = 'not json at all' WHERE id = ?`, [MIA]);
        const r = await rsvp(MIA, 'vegan');
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(caOf(MIA).diet_pref, 'vegan');
    });

    // ================================================================ the allergy text box
    await t('"I have allergies" opens the box without recording anything yet', async () => {
        const before = rowOf(ANA).special_requests;
        const r = await rsvp(ANA, 'allergies');
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(rowOf(ANA).special_requests, before, 'opening the box writes nothing');
        assert.ok(/id="a_text"/.test(r.body), 'the page must carry the single text box');
        assert.ok(/e\.g\. nuts, shellfish/.test(r.body), 'the placeholder the owner asked for');
        assert.ok(/id="a_save"/.test(r.body), 'and a Save button');
    });
    await t('the allergy text is stored into special_requests, prefixed "Allergies: "', async () => {
        const r = await call(app, 'POST', '/api/boston/rsvp/:token/allergies',
            { params: { token: dietToken(ANA) }, body: { text: '  peanuts and\n shellfish  ' } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(rowOf(ANA).special_requests, 'Allergies: peanuts and shellfish', 'whitespace collapsed, prefix applied');
        assert.strictEqual(caOf(ANA).allergies, 'peanuts and shellfish');
    });
    await t('saving the allergy text again replaces it — one Allergies: segment, ever', async () => {
        await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(ANA) }, body: { text: 'sesame' } });
        const sr = rowOf(ANA).special_requests;
        assert.strictEqual(sr, 'Allergies: sesame');
        assert.strictEqual(sr.split('Allergies:').length - 1, 1, 'exactly one Allergies: segment');
    });
    await t('a pre-existing special_requests note is preserved beside the allergy answer', async () => {
        query.run(`UPDATE bridges_registrations SET special_requests = 'Wheelchair access' WHERE id = ?`, [MIA]);
        await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(MIA) }, body: { text: 'lactose' } });
        const sr = rowOf(MIA).special_requests;
        assert.ok(sr.includes('Allergies: lactose'), 'the answer is there');
        assert.ok(sr.includes('Wheelchair access'), 'and the older note was not eaten');
    });
    await t('an empty allergy text is refused, a forged token is a 404, and the text is capped', async () => {
        const empty = await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(ANA) }, body: { text: '   ' } });
        assert.strictEqual(empty.statusCode, 400);
        const forged = await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: 'a'.repeat(32) + '.reg-ana' }, body: { text: 'nuts' } });
        assert.strictEqual(forged.statusCode, 404);
        await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(ANA) }, body: { text: 'x'.repeat(900) } });
        assert.strictEqual(rowOf(ANA).special_requests.length, 'Allergies: '.length + 300, 'capped at 300 characters');
        await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(ANA) }, body: { text: 'sesame' } });   // restore
    });
    await t('allergy text is stored raw but ESCAPED on the page — no HTML can be injected', async () => {
        const nasty = '<script>alert(1)</script> & "nuts"';
        await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(ANA) }, body: { text: nasty } });
        assert.strictEqual(rowOf(ANA).special_requests, 'Allergies: ' + nasty, 'stored verbatim');
        const page = (await rsvp(ANA, 'open')).body;
        assert.ok(!page.includes('<script>alert(1)</script>'), 'raw script tag leaked into the page');
        assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the text should appear escaped');
        assert.ok(page.includes('&quot;nuts&quot;'), 'quotes escaped inside the input value');
        await call(app, 'POST', '/api/boston/rsvp/:token/allergies', { params: { token: dietToken(ANA) }, body: { text: 'sesame' } });   // restore
    });

    // ================================================================ the page itself
    await t('the page is personal, mobile-ready, and offers the other question inline', async () => {
        const page = (await rsvp(ANA, 'vegetarian')).body;
        assert.ok(page.includes('Hi Ana'), "the guest's first name");
        assert.ok(/Noted &mdash; vegetarian\./.test(page), 'the "Noted — vegetarian." confirmation');
        assert.ok(page.includes('width=device-width'), 'phone viewport');
        assert.ok(page.includes('noindex'), 'never indexed');
        assert.ok(page.includes('/boston/rsvp/' + dietToken(ANA) + '/no-allergies'), 'the allergy row stays answerable inline');
        assert.ok(page.includes('/boston/rsvp/' + dietToken(ANA) + '/open'), 'a "change" link');
        assert.ok(page.includes('>change</a>'), 'labelled "change"');
        assert.ok(!page.includes('undefined') && !page.includes('NaN'), 'no leaked placeholders');
        assert.ok(!/Building Bridges evening/.test(page), 'never the "Building Bridges evening" phrasing');
    });
    await t('the page shows both answers back once they are in', async () => {
        const page = (await rsvp(LUKA, 'open')).body;
        assert.ok(page.includes('Halal'), 'the preference reads back');
        assert.ok(page.includes('no allergies'), 'the allergy answer reads back');
        assert.ok(page.includes('chip on'), 'the chosen chips render as chosen');
    });

    // ================================================================ the ONE Boston email
    await t('the send route is keyed — a wrong key is a 404 and sends nothing', async () => {
        const before = sentEmails.length;
        for (const key of [undefined, '', 'nope', ADMIN_KEY.slice(0, 39), ADMIN_KEY + 'x']) {
            const r = await call(app, 'POST', '/api/boston/reminders/send', { query: key === undefined ? {} : { key }, body: { to: 'all' } });
            assert.strictEqual(r.statusCode, 404);
        }
        assert.strictEqual(sentEmails.length, before, 'no email escaped an unauthorized call');
    });

    // ---------------------------------------------------------------- the program PDF gate
    await t('with no program PDF, a real send refuses — and emails nobody', async () => {
        programOff();
        const before = sentEmails.length;
        for (const to of ['all', LUKA]) {
            const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to } });
            assert.strictEqual(r.statusCode, 400, 'to:' + to + ' must be refused');
            assert.strictEqual(r.body.error, 'Upload the program PDF first');
        }
        assert.strictEqual(sentEmails.length, before, 'not one email left the building');
        assert.strictEqual(Number(rowOf(LUKA).reminder_sent), 0, 'and nothing was stamped');
    });

    await t('preview still works without the program PDF, and says so on the page', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview' } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.program_attached, false);
        assert.strictEqual(sentEmails.length, before + 2, 'both shapes');
        for (const m of sentEmails.slice(-2)) {
            assert.strictEqual(m.attachments, null, 'nothing to attach yet');
            assert.ok(m.html.includes('(program PDF not uploaded yet)'), 'the preview says the PDF is missing');
        }
    });

    await t('preview goes ONLY to the reviewer, in both shapes, and stamps nothing', async () => {
        programOn();
        const before = sentEmails.length;
        const beforeRows = query.all(`SELECT id, reminder_sent, notes FROM bridges_registrations WHERE event_id = ?`, [EVENT_ID]);
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview' } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.preview_to, REVIEW_TO);
        assert.deepStrictEqual(r.body.variants, ['presenter', 'attendee'], 'both variants, presenter first');
        assert.strictEqual(sentEmails.length, before + 2, 'exactly two emails — one per shape');
        const [pres, att] = sentEmails.slice(-2);
        for (const mail of [pres, att]) {
            assert.strictEqual(mail.to, REVIEW_TO, 'the preview must go to the reviewer and nobody else');
            assert.strictEqual(mail.to, 'juginovic.alen@gmail.com');
            assert.ok(!mail.html.includes('(program PDF not uploaded yet)'), 'the PDF is there now');
        }
        assert.ok(pres.subject.startsWith('[PREVIEW · presenter] '), 'presenter subject: ' + pres.subject);
        assert.ok(att.subject.startsWith('[PREVIEW · attendee] '), 'attendee subject: ' + att.subject);
        for (const row of beforeRows) {
            const now = rowOf(row.id);
            assert.strictEqual(Number(now.reminder_sent), Number(row.reminder_sent), row.id + ' reminder_sent untouched');
            assert.strictEqual(String(now.notes || ''), String(row.notes || ''), row.id + ' notes untouched');
        }
    });

    await t('the presenter preview carries the slides block, the attendee preview does not', () => {
        const [pres, att] = sentEmails.slice(-2);
        assert.ok(pres.html.includes("You're presenting"), 'presenter shape has the slides block');
        assert.ok(pres.html.includes(BASE + '/boston/upload/' + uploadToken(LUKA)), "and Luka's own slides link");
        assert.ok(!att.html.includes("You're presenting"), 'attendee shape must not be told to upload slides');
        assert.ok(!/\/boston\/upload\//.test(att.html), 'no slides link at all in the attendee shape');
        assert.ok(pres.html.includes('Dear Luka'), 'presenter preview is built from the first presenter');
        assert.ok(att.html.includes('Dear Ana'), 'attendee preview is built from the first non-presenter');
    });

    await t('one variant can be previewed on its own', async () => {
        const before = sentEmails.length;
        const a = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'attendee' } });
        assert.deepStrictEqual(a.body.variants, ['attendee']);
        assert.strictEqual(sentEmails.length, before + 1, 'one email');
        assert.strictEqual(sentEmails[sentEmails.length - 1].to, REVIEW_TO);
        assert.ok(!sentEmails[sentEmails.length - 1].html.includes("You're presenting"));
        const p = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'presenter' } });
        assert.deepStrictEqual(p.body.variants, ['presenter']);
        assert.ok(sentEmails[sentEmails.length - 1].html.includes("You're presenting"));
        const bad = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'everyone' } });
        assert.strictEqual(bad.statusCode, 400, 'an invented variant is refused, not guessed');
    });

    await t('the program PDF rides along as an attachment, fetched once per batch', async () => {
        const readsBefore = s3Reads.length;
        await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'attendee' } });
        const mail = sentEmails[sentEmails.length - 1];
        assert.ok(Array.isArray(mail.attachments) && mail.attachments.length === 1, 'exactly one attachment');
        assert.strictEqual(mail.attachments[0].filename, 'Building-Bridges-Boston-Program.pdf');
        assert.strictEqual(mail.attachments[0].type, 'application/pdf');
        assert.ok(Buffer.from(mail.attachments[0].content).equals(PROGRAM_BYTES), 'the program bytes themselves');
        assert.strictEqual(s3Reads.length, readsBefore + 1, 'the PDF is read from S3 once for the whole batch');
        assert.strictEqual(s3Reads[s3Reads.length - 1], 'boston/program/program.pdf', 'the fixed program key');
    });

    await t('the Boston email says the date, venue, doors, time and dress — and never "evening" phrasing', () => {
        const html = sentEmails[sentEmails.length - 1].html;
        assert.ok(html.includes('Monday, 21 September 2026'), 'the date');
        assert.ok(html.includes('Waterhouse Room, Gordon Hall'), 'the room');
        assert.ok(html.includes('Harvard Medical School'), 'the school');
        assert.ok(html.includes('5:30'), 'doors');
        assert.ok(html.includes('6:00') && html.includes('9:00'), 'the program window');
        assert.ok(/[Bb]usiness attire/.test(html), 'the dress code');
        assert.ok(html.includes('laura.rodman@medx.hr'), 'the reply-to / Laura footer');
        assert.ok(!/Building Bridges evening/.test(html), 'never the "Building Bridges evening" phrasing');
        assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no leaked placeholders');
    });

    await t('the seven modules appear in the order the owner asked for', () => {
        const html = sentEmails[sentEmails.length - 1].html;
        const at = s => { const i = html.indexOf(s); assert.ok(i > -1, 'missing module: ' + s); return i; };
        const seeYou = at('See you on');
        const program = at('Your program');
        const ticket = at('Your ticket');
        const catering = at('Two quick questions for the catering');
        const intro = at('Your one-slide summary');
        const laura = html.lastIndexOf('laura.rodman@medx.hr');
        assert.ok(seeYou < program, '(a) header before (b) program');
        assert.ok(program < ticket, '(b) program before (c) ticket');
        assert.ok(ticket < catering, '(c) ticket before (d) catering');
        assert.ok(catering < intro, '(d) catering before (e) introduce yourself');
        assert.ok(intro < laura, '(e) introduce yourself before (g) the footer');
    });

    await t('the program line names what is attached, in the owner\'s words', () => {
        const html = sentEmails[sentEmails.length - 1].html;
        assert.ok(html.includes('Attached: program, presentation instructions and good-to-know'),
            'the line the owner asked for, verbatim');
        assert.ok(!html.includes('(program PDF not uploaded yet)'), 'and not marked as missing');
    });

    await t('EVERY guest is asked for a one-slide summary, on their own personal link', () => {
        const html = sentEmails[sentEmails.length - 1].html;   // Ana — not a presenter
        assert.ok(html.includes('Your one-slide summary'), 'the summary block');
        assert.ok(html.includes('Upload my one-slide summary'), 'and the button says what it sends');
        assert.ok(html.includes('who you are, what you do, and what you are looking for in a collaborator'),
            "the PDF's own words for what goes on the slide");
        assert.ok(html.includes('PDF or PowerPoint (.ppt/.pptx), up to 10&nbsp;MB'), 'the format it accepts');
        assert.ok(html.includes(DEADLINE), 'the same deadline as the slides');
        assert.ok(/If you are happy to share it, we send the summaries to all participants after the event/.test(html),
            "the sharing promise, in the owner's conditional");
        assert.ok(html.includes(BASE + '/boston/onepager/' + onepagerToken(ANA)), 'her own summary link');
        assert.ok(!html.includes('/boston/onepager/' + ANA), 'a bare id must never appear in a link');
        assert.ok(!html.includes(onepagerToken(LUKA)), "and never somebody else's token");
        assert.ok(!/one-pager/i.test(html), 'a guest never reads the internal name');
    });

    await t('the reminder carries the ticket it already has — QR, calendar, no new mint', () => {
        const html = sentEmails[sentEmails.length - 1].html;
        assert.ok(html.includes(BASE + `/api/boston/qr/${ANA}.png`), 'the branded entry QR');
        assert.ok(html.includes(BASE + '/boston.ics'), 'the calendar link');
        assert.ok(html.includes('BB-BOS-' + ANA.slice(0, 8).toUpperCase()), 'the same ticket number');
    });

    await t('the reminder carries all eight one-tap answer links, all HMAC-tokened', () => {
        const html = sentEmails[sentEmails.length - 1].html;
        const tok = dietToken(ANA);
        for (const a of ['none', 'vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free', 'no-allergies', 'allergies']) {
            assert.ok(html.includes(`${BASE}/boston/rsvp/${tok}/${a}`), 'missing one-tap link: ' + a);
        }
        assert.ok(/Two quick questions for the catering/.test(html), 'the catering block heading');
        assert.ok(!html.includes(`/boston/rsvp/${ANA}/`), 'a bare id must never appear in a link');
    });

    await t('the slides block is for presenters only, and reads back a deck already on file', async () => {
        // Ana is not a presenter — the attendee preview above must not carry the slides block.
        assert.ok(!sentEmails[sentEmails.length - 1].html.includes("You're presenting"),
            'a non-presenter must not be told to upload slides');

        // Luka is a presenter and has uploaded nothing.
        await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: LUKA } });
        const luka = sentEmails[sentEmails.length - 1];
        assert.strictEqual(luka.to, 'luka@example.com');
        assert.ok(luka.html.includes("You're presenting"), 'the slides block');
        assert.ok(luka.html.includes('Upload my slides'), 'and the upload button');
        assert.ok(!luka.html.includes('Already received'), 'nothing on file yet');
        assert.ok(luka.html.includes(BASE + '/boston/upload/' + uploadToken(LUKA)), 'their personal upload link');
        assert.ok(luka.html.includes(BASE + '/boston/onepager/' + onepagerToken(LUKA)), 'a presenter is asked for a summary too');

        // Mia is a presenter WITH a deck on file — the block turns into "already received, replace".
        query.run(`CREATE TABLE IF NOT EXISTS bridges_presentations (id TEXT PRIMARY KEY, registration_id TEXT NOT NULL,
            original_name TEXT NOT NULL, stored_key TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        query.run(`INSERT INTO bridges_presentations (id, registration_id, original_name, stored_key, mime, size, uploaded_at)
            VALUES ('pres-1','${MIA}','mia.pdf','boston-2026/${MIA}/pres-1.pdf','application/pdf',4096,'2026-09-12T10:00:00.000Z')`);
        await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: MIA } });
        const mia = sentEmails[sentEmails.length - 1];
        assert.strictEqual(mia.to, 'mia@example.com');
        assert.ok(mia.html.includes("You're presenting"), 'a presenter always sees the block');
        assert.ok(mia.html.includes('Already received'), 'her deck is acknowledged');
        assert.ok(mia.html.includes('mia.pdf'), 'by name');
        assert.ok(mia.html.includes('Replace my slides'), 'and the button says replace');
        assert.ok(!mia.html.includes('Upload my slides'), 'never "upload" once a deck is in');
    });

    await t('a one-slide summary already on file reads back the same way', async () => {
        query.run(`CREATE TABLE IF NOT EXISTS bridges_onepagers (id TEXT PRIMARY KEY, registration_id TEXT NOT NULL,
            original_name TEXT NOT NULL, stored_key TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL, headline TEXT, uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        query.run(`INSERT INTO bridges_onepagers (id, registration_id, original_name, stored_key, mime, size, headline, uploaded_at)
            VALUES ('op-1','${MIA}','mia-novak.pdf','boston/onepagers/${MIA}/op-1.pdf','application/pdf',2048,'Cardiologist','2026-09-12T11:00:00.000Z')`);
        await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: MIA } });
        const mia = sentEmails[sentEmails.length - 1];
        assert.strictEqual(mia.to, 'mia@example.com');
        assert.ok(mia.html.includes('Replace my one-slide summary'), 'the button says replace');
        assert.ok(mia.html.includes('mia-novak.pdf'), 'her page is acknowledged by name');
        assert.ok(!mia.html.includes('Upload my one-slide summary'), 'never "upload" once a slide is in');
    });

    // ================================================================ the format and the deadline
    // Straight from the owner's program PDF — the email is where most people will read them.
    await t('the presenter block states the format and the 19 September deadline, verbatim', async () => {
        await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant: 'presenter' } });
        const html = sentEmails[sentEmails.length - 1].html;
        assert.ok(html.includes("You're presenting"), 'the presenter block is there to carry them');
        assert.ok(html.includes(FORMAT_LINE), 'the format line, verbatim');
        assert.ok(html.includes(DEADLINE), 'the deadline, verbatim');
        assert.ok(!/5&ndash;7 slides|5–7 slides|Keynote/.test(html), 'and none of the superseded format copy');
    });

    await t('no shape of the Boston email says Friday, 18 September any more', async () => {
        for (const variant of ['presenter', 'attendee']) {
            await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'preview', variant } });
            const html = sentEmails[sentEmails.length - 1].html;
            assert.ok(!/18 September|Friday, 18/.test(html), variant + ' still carries the old deadline');
            assert.ok(html.includes(DEADLINE), variant + ' must carry the new one');
        }
    });

    await t('the presenter upload-link email carries the same format and deadline', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/presenters/send-links', { query: { key: ADMIN_KEY }, body: { to: 'preview' } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(sentEmails.length, before + 1, 'one preview, to the reviewer only');
        const mail = sentEmails[sentEmails.length - 1];
        assert.strictEqual(mail.to, REVIEW_TO);
        assert.ok(mail.html.includes(FORMAT_LINE), 'the format line, verbatim');
        assert.ok(mail.html.includes('please upload by ' + DEADLINE), 'the deadline, verbatim');
        assert.ok(!/18 September|Friday, 18/.test(mail.html), 'and never the superseded one');
    });

    // ================================================================ send bookkeeping
    await t('a send stamps reminder_sent = 1 and a dated REMINDER-SENT marker in notes', () => {
        const luka = rowOf(LUKA);
        assert.strictEqual(Number(luka.reminder_sent), 1);
        assert.ok(/REMINDER-SENT \d{4}-\d{2}-\d{2}/.test(String(luka.notes)), 'dated marker: ' + luka.notes);
        assert.ok(String(luka.notes).includes('5-minute presentation requested'), 'the existing notes survive');
    });

    await t('"all" skips everyone already reminded, and never touches held or cancelled rows', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'all' } });
        assert.strictEqual(r.statusCode, 200);
        assert.deepStrictEqual(r.body.sent.sort(), ['ana@example.com'], 'only the one who had not been reminded');
        assert.strictEqual(r.body.skipped_already_sent, 2, 'Luka and Mia were skipped');
        assert.strictEqual(sentEmails.length, before + 1, 'exactly one email left the building');
        assert.strictEqual(Number(rowOf(HELD).reminder_sent), 0, 'a held registration is never reminded');
        assert.strictEqual(Number(rowOf(GONE).reminder_sent), 0, 'a cancelled registration is never reminded');
        for (const bad of [HELD, GONE]) {
            assert.ok(!/REMINDER-SENT/.test(String(rowOf(bad).notes || '')), bad + ' must carry no marker');
        }
    });

    await t('a second "all" sends nothing at all', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: 'all' } });
        assert.deepStrictEqual(r.body.sent, []);
        assert.strictEqual(r.body.skipped_already_sent, 3);
        assert.strictEqual(sentEmails.length, before, 'no email');
    });

    await t('a resend to one id always sends, and the marker is not duplicated', async () => {
        const before = sentEmails.length;
        const notesBefore = String(rowOf(LUKA).notes);
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: LUKA } });
        assert.deepStrictEqual(r.body.sent, ['luka@example.com']);
        assert.strictEqual(sentEmails.length, before + 1);
        const notesAfter = String(rowOf(LUKA).notes);
        assert.strictEqual(notesAfter, notesBefore, 'the marker is stamped once, not appended again');
        assert.strictEqual(notesAfter.split('REMINDER-SENT').length - 1, 1, 'exactly one marker');
    });

    await t('an unknown id sends nothing and says so', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: { to: NOBODY } });
        assert.strictEqual(r.statusCode, 200);
        assert.deepStrictEqual(r.body.sent, []);
        assert.strictEqual(r.body.not_found, true);
        assert.strictEqual(sentEmails.length, before);
    });
    await t('an empty {to} is refused rather than guessed', async () => {
        const before = sentEmails.length;
        const r = await call(app, 'POST', '/api/boston/reminders/send', { query: { key: ADMIN_KEY }, body: {} });
        assert.strictEqual(r.statusCode, 400);
        assert.strictEqual(sentEmails.length, before);
    });

    // ================================================================ catering summary + CSV
    await t('the catering routes are keyed', async () => {
        assert.strictEqual((await call(app, 'GET', '/api/boston/catering', { query: { key: 'nope' } })).statusCode, 404);
        assert.strictEqual((await call(app, 'GET', '/api/boston/catering.csv', { query: {} })).statusCode, 403);
    });

    await t('the summary math adds up', async () => {
        const d = (await call(app, 'GET', '/api/boston/catering', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(d.total, 3, 'only the three active seats — held and cancelled are out');
        assert.strictEqual(d.rows.length, 3);
        const prefTotal = d.preferences.reduce((n, p) => n + p.count, 0);
        assert.strictEqual(prefTotal + d.preference_unanswered, d.total, 'preference buckets + unanswered = total');
        assert.strictEqual(d.answered + d.not_answered, d.total, 'answered + not answered = total');
        assert.strictEqual(d.with_allergies + d.no_allergies + d.allergies_unanswered, d.total, 'allergy buckets = total');
        assert.strictEqual(d.reminders_sent + d.reminders_pending, d.total, 'reminder buckets = total');
        assert.strictEqual(d.reminders_sent, 3, 'everyone active has been reminded by now');
        assert.strictEqual(d.presenters, 2);
        assert.deepStrictEqual(d.preferences.map(p => p.key),
            ['none', 'vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free'], 'the six buckets, in order');
        const byKey = Object.fromEntries(d.preferences.map(p => [p.key, p.count]));
        assert.strictEqual(byKey.vegetarian, 1, 'Ana');          // last answer above was 'vegetarian'
        assert.strictEqual(byKey.halal, 1, 'Luka');
        assert.strictEqual(byKey.vegan, 1, 'Mia');
        assert.strictEqual(d.with_allergies, 2, 'Ana (sesame) and Mia (lactose)');
        assert.strictEqual(d.no_allergies, 1, 'Luka');
        assert.strictEqual(d.not_answered, 0);
    });

    await t('an unanswered guest counts as unanswered in every bucket', async () => {
        seed(QUIET, 'Quiet', 'Guest', 'quiet@example.com', null);
        const d = (await call(app, 'GET', '/api/boston/catering', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(d.total, 4);
        assert.strictEqual(d.not_answered, 1);
        assert.strictEqual(d.preference_unanswered, 1);
        assert.strictEqual(d.allergies_unanswered, 1);
        assert.strictEqual(d.reminders_pending, 1);
        const quiet = d.rows.find(r => r.registration_id === QUIET);
        assert.strictEqual(quiet.preference, null);
        assert.strictEqual(quiet.allergy_state, null);
        assert.strictEqual(quiet.answered, false);
        assert.strictEqual(quiet.reminder_sent, false);
    });

    await t('the CSV has the caterer\'s columns plus the sharing answer, quoted, BOM, CRLF', async () => {
        const r = await call(app, 'GET', '/api/boston/catering.csv', { query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 200);
        assert.ok(String(r.headers['content-type']).includes('text/csv'));
        assert.ok(r.body.startsWith('﻿'), 'UTF-8 BOM so Excel reads the encoding');
        const lines = r.body.slice(1).trim().split('\r\n');
        assert.strictEqual(lines[0], '"Name","Institution","Preference","Allergies","Answered at","Presenter","One-slide summary"');
        assert.strictEqual(lines.length, 5, 'header + four active guests');
        const ana = lines.find(l => l.startsWith('"Ana Horvat"'));
        assert.ok(ana, 'Ana is in the export');
        assert.ok(ana.includes('"Vegetarian"'), 'her preference');
        assert.ok(ana.includes('"sesame"'), 'her allergies');
        assert.ok(ana.includes('"No","'), 'presenter column: No');
        assert.ok(ana.endsWith('""'), 'and no summary from her yet, so the last cell is empty');
        const mia = lines.find(l => l.startsWith('"Mia Novak"'));
        assert.ok(mia.includes('"Yes","'), 'Mia is presenting');
        assert.ok(mia.endsWith('"Shared"'), 'and her summary may go to all participants');
        const luka = lines.find(l => l.startsWith('"Luka Babic"'));
        assert.ok(luka.includes('"None"'), 'a "no allergies" answer reads as None, not blank');
        const quiet = lines.find(l => l.startsWith('"Quiet Guest"'));
        assert.ok(quiet.includes('"","",""'), 'an unanswered guest exports empty cells, never "null"');
        assert.ok(!r.body.includes('undefined') && !r.body.includes('null'), 'no leaked placeholders');
    });

    await t('a quote in an answer is escaped CSV-style, never breaks a row', async () => {
        await call(app, 'POST', '/api/boston/rsvp/:token/allergies',
            { params: { token: dietToken(QUIET) }, body: { text: 'anything with "quotes", really' } });
        const r = await call(app, 'GET', '/api/boston/catering.csv', { query: { key: ADMIN_KEY } });
        const lines = r.body.slice(1).trim().split('\r\n');
        assert.strictEqual(lines.length, 5, 'still one line per guest');
        assert.ok(lines.some(l => l.includes('""quotes""')), 'the quote is doubled, RFC 4180 style');
    });

    // ================================================================ the sheet is not ours
    await t('nothing in this feature touches the Google sheet', () => {
        const src = require('node:fs').readFileSync(require.resolve('../user-portal/backend/boston.js'), 'utf8');
        const feature = src.slice(src.indexOf('THE ONE BOSTON EMAIL'), src.indexOf('GET /api/boston/presentations/:id/download'));
        assert.ok(feature.length > 2000, 'found the feature block');
        assert.ok(!/pushToBostonSheet|updateBostonSheetStatus|sheetsToken/.test(feature),
            'the reminder and the catering answers must leave the owner\'s sheet alone');
    });

    await t('no email went anywhere except the four seats and the reviewer', () => {
        const allowed = new Set(['ana@example.com', 'luka@example.com', 'mia@example.com', 'quiet@example.com', REVIEW_TO]);
        for (const m of sentEmails) assert.ok(allowed.has(m.to), 'unexpected recipient: ' + m.to);
        assert.ok(!sentEmails.some(m => m.to === 'bot@example.com' || m.to === 'gone@example.com'),
            'a held or cancelled registration must never be emailed');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
