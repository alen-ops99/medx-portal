/**
 * tests/boston-onepager.test.js — the participant ONE-SLIDE SUMMARIES (every guest, PDF or
 * PowerPoint, with the share-with-participants consent) and the program PDF that rides along on
 * the one Boston email (user-portal/backend/boston.js). The route, the table and this file's name
 * keep the older "onepager" spelling; everything a guest reads says one-slide summary.
 *
 * Hermetic, and shaped exactly like tests/boston.test.js: a stub express app collects the routes
 * (only the FINAL handler, so multer never runs — the test injects req.file itself), a scratch
 * in-memory sqlite (node:sqlite) carries the real bridges_events / bridges_registrations schema,
 * every S3 write and read is a stub, and global.fetch throws. A REAL EMAIL SEND OR ANY NETWORK
 * CALL IS IMPOSSIBLE HERE.
 *
 * Run:  node tests/boston-onepager.test.js      (exit code = 1 when anything failed)
 */
'use strict';

const assert = require('node:assert');
process.env.BOSTON_PRESENTATION_SLOTS = 'open';   // slots closed in prod on 2026-09-16; the suite exercises the presenter paths
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
// FAKE S3 credentials — putObject/getObject are stubbed below and presignGet is pure computation,
// so nothing here can reach AWS.
process.env.BB_S3_BUCKET = 'medx-bb-test';
process.env.BB_S3_REGION = 'us-east-1';
process.env.BB_S3_KEY = 'AKIATESTTESTTESTTEST';
process.env.BB_S3_SECRET = 'test-secret-not-real';

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const wallet = require('../shared/wallet.js');
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const mountBoston = require('../user-portal/backend/boston.js');

// Every S3 operation the wing can reach, captured instead of the wire.
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
    ? { size: s3Store.get(key).length, lastModified: '2026-09-13T09:00:00.000Z' } : null;

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
// bridges_onepagers is NOT pre-created — the wing must create it lazily itself.

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

const JWT_SECRET = 'test-secret-boston-onepager';
const app = makeApp();
mountBoston(app, { query, saveDb: () => {}, sendEmail: sendEmailStub, flushDb: () => {}, JWT_SECRET });

const EVENT_ID = 'bb-boston-2026-09-21';
const BASE = 'https://medx-user-portal.onrender.com';
const ADMIN_KEY = crypto.createHmac('sha256', JWT_SECRET).update('boston-admin').digest('hex').slice(0, 40);
const sigOf = (ctx, id) => crypto.createHmac('sha256', JWT_SECRET).update(ctx + id).digest('hex').slice(0, 32) + '.' + id;
const onepagerToken = id => sigOf('boston:onepager:', id);
const uploadToken = id => sigOf('bostonup:', id);
const passToken = id => sigOf('boston:', id);
const dietToken = id => sigOf('boston:diet:', id);

const pdfBuf = (extra = 64) => Buffer.concat([Buffer.from('%PDF-1.7\n% Building Bridges Boston one-slide summary\n'), Buffer.alloc(extra, 0x20)]);
const zipBuf = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(96, 0)]);   // .pptx / .key
const oleBuf = () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(96, 0)]);   // legacy .ppt
const jpgBuf = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), Buffer.alloc(96, 0)]);

// The two facts the owner's program PDF fixes — asserted as literals here on purpose, so a change
// of date or format has to be a deliberate edit in the test as well as in the wing.
const DEADLINE = 'Sunday, 20 September 2026';
const FORMAT_LINE = '5 minutes · 5 to 8 slides · PowerPoint 16:9, in English (PDF also accepted) · up to 25 MB · all talks run from one laptop';

// ---------------------------------------------------------------- seed
const ANA = '11111111-1111-4111-8111-111111111111';
const LUKA = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
query.run(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, capacity, registration_open)
    VALUES (?, 'boston-2026', 'Building Bridges in Biomedicine — Boston', 'Boston', 'Waterhouse Room, Gordon Hall', '2026-09-21', 'upcoming', 60, 1)`, [EVENT_ID]);
function seed(id, first, last, email, notes, status) {
    query.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, notes, status, payment_status, confirmation_sent)
        VALUES (?,?,?,?,?,?,?,?,'n/a',1)`, [id, EVENT_ID, first, last, email, first + ' Institute', notes, status || 'registered']);
}
seed(ANA, 'Ana', 'Horvat', 'ana@example.com', null);
seed(LUKA, 'Luka', 'Babic', 'luka@example.com', '5-minute presentation requested');
seed(GONE, 'Old', 'Cancel', 'gone@example.com', null, 'cancelled');

// Tolerates the table not existing yet — the wing creates it lazily on the first real upload,
// and "there is no table" is the same fact as "nothing was stored".
const opRows = id => {
    try { return query.all('SELECT * FROM bridges_onepagers WHERE registration_id = ? ORDER BY uploaded_at, rowid', [id]); }
    catch (e) { return []; }
};
const upload = (token, file, body) => call(app, 'POST', '/api/boston/onepager/:token', { params: { token }, file, body });

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

(async () => {
    console.log('boston-onepager.test.js — hermetic (stub express, node:sqlite scratch DB, stubbed S3)\n');

    // ================================================================ routes
    await t('every one-pager and program route is mounted', () => {
        for (const k of ['GET /boston/onepager/:token', 'POST /api/boston/onepager/:token',
            'GET /api/boston/onepagers', 'GET /api/boston/onepagers.zip', 'GET /api/boston/onepagers/:id/download',
            'GET /api/boston/program', 'POST /api/boston/program']) {
            assert.ok(app.routes[k], 'missing ' + k);
        }
    });

    // ================================================================ token contexts
    await t('the one-pager context is its own — a pass, slides or diet token is a 404 here', async () => {
        for (const tok of [passToken(ANA), uploadToken(ANA), dietToken(ANA)]) {
            const page = await call(app, 'GET', '/boston/onepager/:token', { params: { token: tok } });
            assert.strictEqual(page.statusCode, 404, 'page must reject ' + tok.slice(0, 8));
            const api = await upload(tok, { originalname: 'x.pdf', buffer: pdfBuf() });
            assert.strictEqual(api.statusCode, 404, 'API must reject ' + tok.slice(0, 8));
        }
        assert.strictEqual(opRows(ANA).length, 0, 'and nothing was stored');
    });

    await t('a one-pager token is not a slides token, a diet token or a pass token', async () => {
        const tok = onepagerToken(ANA);
        assert.strictEqual((await call(app, 'GET', '/boston/upload/:token', { params: { token: tok } })).statusCode, 404);
        assert.strictEqual((await call(app, 'GET', '/boston/rsvp/:token/:answer', { params: { token: tok, answer: 'vegan' } })).statusCode, 404);
        assert.strictEqual((await call(app, 'GET', '/api/boston/pass/:token.pkpass', { params: { token: tok } })).statusCode, 404);
    });

    await t('a forged, garbled or unknown one-pager token is a 404 — page and API alike', async () => {
        for (const tok of ['', 'nope', 'f'.repeat(32) + '.' + ANA, 'abc.' + ANA, onepagerToken(ANA).toUpperCase(), onepagerToken(UNKNOWN)]) {
            const page = await call(app, 'GET', '/boston/onepager/:token', { params: { token: tok } });
            assert.strictEqual(page.statusCode, 404, 'page: ' + JSON.stringify(tok.slice(0, 16)));
            const api = await upload(tok, { originalname: 'x.pdf', buffer: pdfBuf() });
            assert.strictEqual(api.statusCode, 404, 'API: ' + JSON.stringify(tok.slice(0, 16)));
        }
        assert.strictEqual(s3Puts.length, 0, 'not one byte was written for a bad token');
    });

    // ================================================================ the page
    await t('the page is personal, branded, never indexed, and carries the owner\'s copy', async () => {
        const r = await call(app, 'GET', '/boston/onepager/:token', { params: { token: onepagerToken(ANA) } });
        assert.strictEqual(r.statusCode, 200);
        const html = String(r.body);
        assert.ok(html.includes('Hi Ana — your one-slide summary'), 'personal greeting');
        assert.ok(html.includes('Ana Horvat'), 'attributed to the registration');
        assert.ok(/One slide that introduces you to the room/.test(html), 'the brief');
        assert.ok(/who you are, what you do, and what you are looking for in a collaborator &mdash; with your contact details/.test(html), "the PDF's own words for what goes on the slide");
        assert.ok(/PDF or PowerPoint \(\.ppt\/\.pptx\), up to 10 MB\./.test(html), 'the format and the limit, verbatim');
        assert.ok(html.includes(DEADLINE), 'the deadline the program PDF fixes');
        assert.ok(!/18 September/.test(html), 'and never the superseded deadline');
        assert.ok(/If you are happy to share it, we send the summaries to all participants after the event\./.test(html), 'the promise, in the owner\'s conditional');
        assert.ok(html.includes('noindex'), 'never indexed');
        assert.ok(html.includes('width=device-width'), 'phone viewport');
        assert.ok(html.includes(`/api/boston/onepager/${onepagerToken(ANA)}`), 'the page posts to its own token API');
        assert.ok(!html.includes('id="hl_text"') && !/One line about you/.test(html), 'no headline text field — file upload only (Alen 2026-09-15)');
        assert.ok(/Please keep it to one slide/.test(html), 'and the one-slide note');
        assert.ok(html.includes('accept=".pdf,.ppt,.pptx"'), 'PDF or PowerPoint in the picker');
        assert.ok(html.includes('Upload my one-slide summary'), 'the button says what it sends');
        assert.ok(!/one-pager/i.test(html), 'the guest never reads the internal name');
        assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no leaked placeholders');
    });

    await t('the sharing consent is a real checkbox, ticked by default, in the guest\'s own words', async () => {
        const html = String((await call(app, 'GET', '/boston/onepager/:token', { params: { token: onepagerToken(ANA) } })).body);
        assert.ok(/<input type="checkbox" id="share_ok" checked>/.test(html), 'ticked by default');
        assert.ok(html.includes('Yes, share my summary with all participants after the event'), 'the label, verbatim');
        assert.ok(/fd\.append\('share_ok'/.test(html), 'and the page always states the answer it posts');
    });

    // ================================================================ the upload itself
    await t('happy path: PDF stored under boston/onepagers/<reg id>/, one history row', async () => {
        const buf = pdfBuf(200);
        const r = await upload(onepagerToken(ANA), { originalname: 'Ana Horvat — one pager.pdf', buffer: buf, size: buf.length }, { headline: 'Sleep neuroscientist · looking for clinical collaborators' });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(r.body.size, buf.length);
        assert.strictEqual(r.body.headline, 'Sleep neuroscientist · looking for clinical collaborators');
        const put = s3Puts[s3Puts.length - 1];
        assert.ok(put.key.startsWith('boston/onepagers/' + ANA + '/'), 'stored under the registrant: ' + put.key);
        assert.ok(put.key.endsWith('.pdf'), 'always .pdf');
        assert.strictEqual(put.contentType, 'application/pdf');
        const rows = opRows(ANA);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].original_name, 'Ana Horvat — one pager.pdf');
        assert.strictEqual(rows[0].headline, 'Sleep neuroscientist · looking for clinical collaborators');
        assert.strictEqual(Number(rows[0].size), buf.length);
        assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(rows[0].uploaded_at), 'uploaded_at is ISO');
    });

    await t('a slide, not a photo: an image, a Keynote or a text file is refused, nothing is stored', async () => {
        const puts = s3Puts.length, rows = opRows(ANA).length;
        const bad = [
            { originalname: 'notes.txt', buffer: Buffer.from('hello world padding........') },
            { originalname: 'photo.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]) },
            { originalname: 'deck.key', buffer: zipBuf() },
            { originalname: 'scan.doc', buffer: oleBuf() }
        ];
        for (const f of bad) {
            const r = await upload(onepagerToken(ANA), f);
            assert.strictEqual(r.statusCode, 400, f.originalname + ' must be refused');
        }
        // a .pdf name over something that is not a PDF inside is refused by the magic bytes
        const liar = await upload(onepagerToken(ANA), { originalname: 'liar.pdf', buffer: zipBuf() });
        assert.strictEqual(liar.statusCode, 400);
        assert.ok(/does not look like a real \.pdf file inside/.test(liar.body.error));
        const empty = await upload(onepagerToken(ANA), undefined);
        assert.strictEqual(empty.statusCode, 400);
        assert.strictEqual(s3Puts.length, puts, 'no S3 write');
        assert.strictEqual(opRows(ANA).length, rows, 'no row');
    });

    await t('a JPEG is refused by its name AND by its bytes — a photo is never a summary', async () => {
        const puts = s3Puts.length, rows = opRows(ANA).length;
        const byName = await upload(onepagerToken(ANA), { originalname: 'poster.jpg', buffer: jpgBuf() });
        assert.strictEqual(byName.statusCode, 400, '.jpg is not an accepted extension');
        assert.ok(/PDF or PowerPoint/.test(byName.body.error), 'and the message says what is: ' + byName.body.error);
        const alsoByName = await upload(onepagerToken(ANA), { originalname: 'poster.jpeg', buffer: jpgBuf() });
        assert.strictEqual(alsoByName.statusCode, 400, '.jpeg either');
        // renamed to get past the extension gate — the magic bytes still say JPEG
        for (const name of ['poster.pdf', 'poster.pptx', 'poster.ppt']) {
            const r = await upload(onepagerToken(ANA), { originalname: name, buffer: jpgBuf() });
            assert.strictEqual(r.statusCode, 400, 'a JPEG renamed to ' + name + ' must still be refused');
            assert.ok(/does not look like a real/.test(r.body.error));
        }
        assert.strictEqual(s3Puts.length, puts, 'no S3 write');
        assert.strictEqual(opRows(ANA).length, rows, 'no row');
    });

    await t('over 10 MB is a 413 — no S3 write, no row', async () => {
        const puts = s3Puts.length, rows = opRows(ANA).length;
        const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024 + 1, 0x20)]);
        const r = await upload(onepagerToken(ANA), { originalname: 'huge.pdf', buffer: big, size: big.length });
        assert.strictEqual(r.statusCode, 413);
        assert.ok(/10 MB/.test(r.body.error), 'the message names the limit');
        assert.strictEqual(s3Puts.length, puts);
        assert.strictEqual(opRows(ANA).length, rows);
    });

    await t('replace: the second upload keeps history, the newest row wins, keys never collide', async () => {
        const r = await upload(onepagerToken(ANA), { originalname: 'Ana v2.pdf', buffer: pdfBuf(300) }, { headline: 'Sleep neuroscientist · hiring a postdoc' });
        assert.strictEqual(r.statusCode, 200);
        const rows = opRows(ANA);
        assert.strictEqual(rows.length, 2, 'both uploads are history');
        assert.notStrictEqual(rows[0].stored_key, rows[1].stored_key, 'each upload gets its own key');
        const list = (await call(app, 'GET', '/api/boston/onepagers', { query: { key: ADMIN_KEY } })).body;
        const ana = list.rows.find(x => x.registration_id === ANA);
        assert.strictEqual(ana.onepager.filename, 'Ana v2.pdf', 'the newest file is the authoritative one');
        assert.strictEqual(ana.onepager.versions, 2, 'and the team sees there were two');
        assert.strictEqual(ana.headline, 'Sleep neuroscientist · hiring a postdoc', 'the headline moves with it');
    });

    await t('the page shows the file on record and offers to replace it', async () => {
        const html = String((await call(app, 'GET', '/boston/onepager/:token', { params: { token: onepagerToken(ANA) } })).body);
        assert.ok(html.includes('On file with us'), 'the on-file card');
        assert.ok(html.includes('Ana v2.pdf'), 'named');
        assert.ok(/Replace it/.test(html), 'and a replace control');
        assert.ok(html.includes('Sleep neuroscientist · hiring a postdoc'), 'the headline reads back into the field');
    });

    // ================================================================ the headline
    await t('the headline is trimmed, capped at 120 characters, and never breaks the page', async () => {
        const long = 'x'.repeat(400);
        await upload(onepagerToken(LUKA), { originalname: 'luka.pdf', buffer: pdfBuf() }, { headline: '  ' + long + '  ' });
        const row = opRows(LUKA)[0];
        assert.strictEqual(row.headline.length, 120, 'capped');
        await upload(onepagerToken(LUKA), { originalname: 'luka2.pdf', buffer: pdfBuf() }, { headline: 'line one\nline two\t\tspaced' });
        assert.strictEqual(opRows(LUKA)[1].headline, 'line one line two spaced', 'newlines and runs of space collapse');
    });

    await t('a headline is stored raw but ESCAPED on the page — no HTML can be injected', async () => {
        const nasty = '<script>alert(1)</script> & "hi"';
        await upload(onepagerToken(LUKA), { originalname: 'luka3.pdf', buffer: pdfBuf() }, { headline: nasty });
        assert.strictEqual(opRows(LUKA)[2].headline, nasty, 'stored verbatim');
        const html = String((await call(app, 'GET', '/boston/onepager/:token', { params: { token: onepagerToken(LUKA) } })).body);
        assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag leaked into the page');
        assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped instead');
        assert.ok(html.includes('&quot;hi&quot;'), 'quotes escaped inside the input value');
    });

    await t('no headline at all is fine — the file stands on its own', async () => {
        const before = opRows(LUKA).length;
        const r = await upload(onepagerToken(LUKA), { originalname: 'luka4.pdf', buffer: pdfBuf() });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.headline, null);
        assert.strictEqual(opRows(LUKA)[before].headline, null);
    });

    // ================================================================ the team's door
    await t('every team route is keyed — a wrong key is a 404', async () => {
        for (const path of ['/api/boston/onepagers', '/api/boston/onepagers.zip']) {
            for (const key of [undefined, '', 'nope', ADMIN_KEY.slice(0, 39)]) {
                const r = await call(app, 'GET', path, { query: key === undefined ? {} : { key } });
                assert.strictEqual(r.statusCode, 404, path + ' with ' + JSON.stringify(key));
            }
        }
        const dl = await call(app, 'GET', '/api/boston/onepagers/:id/download', { params: { id: opRows(ANA)[1].id }, query: { key: 'nope' } });
        assert.strictEqual(dl.statusCode, 404);
    });

    await t('the list is EVERY guest holding a seat — one-pager or not, presenter or not', async () => {
        const d = (await call(app, 'GET', '/api/boston/onepagers', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(d.total, 2, 'Ana and Luka — the cancelled row is out');
        assert.ok(!d.rows.some(r => r.registration_id === GONE), 'a cancelled registration is never listed');
        assert.strictEqual(d.received, 2);
        const ana = d.rows.find(r => r.registration_id === ANA);
        assert.strictEqual(ana.presenter, false);
        assert.ok(ana.upload_url.includes('/boston/onepager/' + onepagerToken(ANA)), 'her personal link, for a re-send by hand');
        assert.ok(ana.onepager.download_url.includes('key=' + ADMIN_KEY), 'the download link carries the team key');
        assert.strictEqual(d.rows.find(r => r.registration_id === LUKA).presenter, true);
    });

    await t('a guest without a one-pager is listed with a null, never dropped', async () => {
        const NEW = '44444444-4444-4444-8444-444444444444';
        seed(NEW, 'Quiet', 'Guest', 'quiet@example.com', null);
        const d = (await call(app, 'GET', '/api/boston/onepagers', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(d.total, 3);
        assert.strictEqual(d.received, 2);
        const quiet = d.rows.find(r => r.registration_id === NEW);
        assert.strictEqual(quiet.onepager, null);
        assert.strictEqual(quiet.headline, null);
    });

    await t('the download is a 15-minute presigned S3 GET, never the key itself', async () => {
        const id = opRows(ANA)[1].id;
        const r = await call(app, 'GET', '/api/boston/onepagers/:id/download', { params: { id }, query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 302);
        const url = String(r.headers.location);
        assert.ok(url.includes('X-Amz-Signature='), 'signed');
        assert.ok(url.includes('X-Amz-Expires=900'), '15 minutes');
        assert.ok(!url.includes(ADMIN_KEY), 'the team key never travels to S3');
        const missing = await call(app, 'GET', '/api/boston/onepagers/:id/download', { params: { id: 'no-such-row' }, query: { key: ADMIN_KEY } });
        assert.strictEqual(missing.statusCode, 404);
    });

    await t('the ZIP names every entry Last_First_summary.ext (after the PERSON, never the guest\'s file name) and holds one file per guest', async () => {
        const r = await call(app, 'GET', '/api/boston/onepagers.zip', { query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.headers['content-type'], 'application/zip');
        assert.ok(/BB-Boston-one-slide-summaries-\d{4}-\d{2}-\d{2}\.zip/.test(String(r.headers['content-disposition'])), 'a dated filename');
        const zip = r.body;
        assert.ok(Buffer.isBuffer(zip) && zip.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'a real zip');
        const text = zip.toString('latin1');
        assert.ok(text.includes('Horvat_Ana_summary.pdf'), 'Ana, named after her: ' + text.slice(0, 120));
        assert.ok(text.includes('Babic_Luka_summary.pdf'), 'Luka, named after him');
        assert.ok(!text.includes('Horvat_Ana__') && !text.includes('Babic_Luka__'), 'the guests\' own file names are not the entry names');
        assert.ok(text.includes('_index.csv') && /Horvat_Ana_summary\.pdf","Ana Horvat","[^"]*","yes","Ana v2\.pdf"/.test(text.replace(/\r/g, '')), 'but they survive in the index: ' + text.slice(text.indexOf('file,name'), text.indexOf('file,name') + 260).replace(/[^\x20-\x7e\n]/g, '.'));
        assert.ok(!text.includes('luka.pdf"'), 'older versions stay out of the archive');
        // one local header per guest with a file — two guests, two entries
        let entries = 0, at = 0;
        while ((at = text.indexOf('PK', at)) !== -1) { entries++; at += 4; }
        assert.strictEqual(entries, 3, 'one entry per guest + _index.csv');
    });

    // ================================================================ PowerPoint + the consent
    await t('a PowerPoint is accepted for the summary and keeps its own extension and type', async () => {
        const QUIET = '44444444-4444-4444-8444-444444444444';           // seeded two tests up
        const r = await upload(onepagerToken(QUIET), { originalname: 'Quiet Guest summary.pptx', buffer: zipBuf() });
        assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
        const put = s3Puts[s3Puts.length - 1];
        assert.ok(put.key.endsWith('.pptx'), 'stored as .pptx, not forced to .pdf: ' + put.key);
        assert.strictEqual(put.contentType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        assert.strictEqual(opRows(QUIET)[0].mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        // and the legacy OLE .ppt travels the same lane
        const legacy = await upload(onepagerToken(QUIET), { originalname: 'old.ppt', buffer: oleBuf() });
        assert.strictEqual(legacy.statusCode, 200, JSON.stringify(legacy.body));
        assert.ok(s3Puts[s3Puts.length - 1].key.endsWith('.ppt'));
    });

    await t('consent defaults to shared — an upload that says nothing is share_ok = 1', async () => {
        const QUIET = '44444444-4444-4444-8444-444444444444';
        assert.strictEqual(Number(opRows(QUIET)[0].share_ok), 1, 'stored as shared');
        const d = (await call(app, 'GET', '/api/boston/onepagers', { query: { key: ADMIN_KEY } })).body;
        const quiet = d.rows.find(r => r.registration_id === QUIET);
        assert.strictEqual(quiet.onepager.share_ok, true, 'and the team JSON reads it back as shared');
        assert.strictEqual(quiet.share_ok, true);
        assert.strictEqual(d.received, 3);
        assert.strictEqual(d.shared, 3, 'everyone so far said yes');
        assert.strictEqual(d.private, 0);
        assert.strictEqual(d.zip_excluded, 0, 'so nothing is held back from the archive');
    });

    await t('unticking the box stores a private summary — kept for the team, out of the archive', async () => {
        const r = await upload(onepagerToken(LUKA), { originalname: 'luka-private.pdf', buffer: pdfBuf(120) }, { share_ok: '0' });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.share_ok, false, 'the answer comes straight back');
        const rows = opRows(LUKA);
        assert.strictEqual(Number(rows[rows.length - 1].share_ok), 0, 'stored as private');

        const d = (await call(app, 'GET', '/api/boston/onepagers', { query: { key: ADMIN_KEY } })).body;
        const luka = d.rows.find(x => x.registration_id === LUKA);
        assert.strictEqual(luka.onepager.share_ok, false, 'the newest answer wins over the older shared ones');
        assert.strictEqual(luka.onepager.filename, 'luka-private.pdf');
        assert.strictEqual(d.received, 3);
        assert.strictEqual(d.shared, 2);
        assert.strictEqual(d.private, 1);
        assert.strictEqual(d.zip_excluded, 1, 'the JSON says how many the archive leaves out');

        // the team can still open it one at a time — private means "not distributed", not "hidden"
        const dl = await call(app, 'GET', '/api/boston/onepagers/:id/download', { params: { id: luka.onepager.id }, query: { key: ADMIN_KEY } });
        assert.strictEqual(dl.statusCode, 302);

        const zip = await call(app, 'GET', '/api/boston/onepagers.zip', { query: { key: ADMIN_KEY } });
        assert.strictEqual(zip.statusCode, 200);
        assert.strictEqual(String(zip.headers['x-summaries-excluded-private']), '1', 'the archive says what it left out');
        const text = zip.body.toString('latin1');
        assert.ok(!text.includes('Babic_Luka'), 'not one byte of the private summary is in the archive');
        assert.ok(text.includes('Horvat_Ana_summary.pdf') && text.includes('Guest_Quiet_summary.ppt'), 'the shared ones are all there (Quiet\'s newest is old.ppt): ' + (text.match(/[A-Za-z_]+_summary\.[a-z]+/g) || []).join(','));
        // the TEAM archive (?all=1) has the private one too, flagged in the index
        const all = await call(app, 'GET', '/api/boston/onepagers.zip', { query: { key: ADMIN_KEY, all: '1' } });
        const allText = all.body.toString('latin1');
        assert.ok(allText.includes('Babic_Luka_summary.pdf'), 'the team archive carries the private summary');
        assert.ok(/Babic_Luka_summary\.pdf","Luka Babic","[^"]*","no"/.test(allText.replace(/\r/g, '')), 'and the index says it is not shared');
        let entries = 0, at = 0;
        while ((at = text.indexOf('PK', at)) !== -1) { entries++; at += 4; }
        assert.strictEqual(entries, 3, 'two shared summaries + _index.csv, three entries');
    });

    await t('the page reads a private answer back — the box comes up unticked, and says so', async () => {
        const html = String((await call(app, 'GET', '/boston/onepager/:token', { params: { token: onepagerToken(LUKA) } })).body);
        assert.ok(/<input type="checkbox" id="share_ok">/.test(html), 'unticked, because that is what they chose');
        assert.ok(html.includes('Kept private'), 'and the on-file card says which way it stands');
    });

    await t('a re-upload with the box ticked again puts the summary back into the archive', async () => {
        const r = await upload(onepagerToken(LUKA), { originalname: 'luka-shared-again.pdf', buffer: pdfBuf(140) }, { share_ok: '1' });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.body.share_ok, true);
        const d = (await call(app, 'GET', '/api/boston/onepagers', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(d.private, 0);
        assert.strictEqual(d.zip_excluded, 0);
        const zip = await call(app, 'GET', '/api/boston/onepagers.zip', { query: { key: ADMIN_KEY } });
        assert.ok(zip.body.toString('latin1').includes('Babic_Luka_summary.pdf'), 'back in');
        assert.strictEqual(String(zip.headers['x-summaries-excluded-private']), '0');
    });

    // ================================================================ the program PDF
    await t('the program routes are keyed, and the status starts empty', async () => {
        for (const key of [undefined, 'nope']) {
            assert.strictEqual((await call(app, 'GET', '/api/boston/program', { query: key ? { key } : {} })).statusCode, 404);
            assert.strictEqual((await call(app, 'POST', '/api/boston/program', { query: key ? { key } : {}, file: { originalname: 'p.pdf', buffer: pdfBuf() } })).statusCode, 404);
        }
        const st = (await call(app, 'GET', '/api/boston/program', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(st.present, false, 'nothing uploaded yet');
        assert.strictEqual(st.key, 'boston/program/program.pdf');
        assert.strictEqual(st.source, 'upload');
    });

    await t('the program upload takes a PDF only, caps at 10 MB, and replaces in place', async () => {
        const bad = await call(app, 'POST', '/api/boston/program', { query: { key: ADMIN_KEY }, file: { originalname: 'program.docx', buffer: pdfBuf() } });
        assert.strictEqual(bad.statusCode, 400);
        const liar = await call(app, 'POST', '/api/boston/program', { query: { key: ADMIN_KEY }, file: { originalname: 'program.pdf', buffer: zipBuf() } });
        assert.strictEqual(liar.statusCode, 400);
        const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024 + 1, 0x20)]);
        const huge = await call(app, 'POST', '/api/boston/program', { query: { key: ADMIN_KEY }, file: { originalname: 'program.pdf', buffer: big } });
        assert.strictEqual(huge.statusCode, 413);

        const one = await call(app, 'POST', '/api/boston/program', { query: { key: ADMIN_KEY }, file: { originalname: 'program.pdf', buffer: pdfBuf(500) } });
        assert.strictEqual(one.statusCode, 200);
        assert.strictEqual(one.body.key, 'boston/program/program.pdf');
        const two = await call(app, 'POST', '/api/boston/program', { query: { key: ADMIN_KEY }, file: { originalname: 'program-v2.pdf', buffer: pdfBuf(900) } });
        assert.strictEqual(two.statusCode, 200);
        assert.strictEqual(s3Puts.filter(p => p.key === 'boston/program/program.pdf').length, 2, 'both writes hit the SAME key');
        const st = (await call(app, 'GET', '/api/boston/program', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(st.present, true);
        assert.strictEqual(st.size, pdfBuf(900).length, 'the status reports the newest file');
    });

    await t('BB_PROGRAM_PDF_KEY wins over the uploaded file when it is set', async () => {
        process.env.BB_PROGRAM_PDF_KEY = 'boston/program/from-env.pdf';
        s3Store.set('boston/program/from-env.pdf', pdfBuf(11));
        const st = (await call(app, 'GET', '/api/boston/program', { query: { key: ADMIN_KEY } })).body;
        assert.strictEqual(st.key, 'boston/program/from-env.pdf');
        assert.strictEqual(st.source, 'env');
        assert.strictEqual(st.present, true);
        delete process.env.BB_PROGRAM_PDF_KEY;
    });

    // ================================================================ nothing leaked
    await t('uploads email nobody (the Finish recap is the one email), and the Google sheet was never touched', () => {
        // Since 2026-09-15 the FIRST summary a guest sends earns one short receipt; replacements
        // stay silent. So every email out of this suite must be that receipt — nothing else.
        assert.strictEqual(sentEmails.length, 0, 'unexpected email(s): ' + sentEmails.map(m => m.subject + ' -> ' + m.to).join('; '));
        const src = require('node:fs').readFileSync(require.resolve('../user-portal/backend/boston.js'), 'utf8');
        const feature = src.slice(src.indexOf('ONE-SLIDE SUMMARIES (every guest)'), src.indexOf('team data (page + JSON share it)'));
        assert.ok(feature.length > 2000, 'found the feature block');
        assert.ok(!/pushToBostonSheet|updateBostonSheetStatus|sheetsToken/.test(feature), 'the summaries leave the owner\'s sheet alone');
    });

    // ================================================================ the deadline and the format
    // Both come from the owner's program PDF. The presenter page states them, and the superseded
    // "Friday, 18 September" must not survive anywhere in the wing's source.
    await t('the presenter upload page states the format and the 20 September deadline', async () => {
        const html = String((await call(app, 'GET', '/boston/upload/:token', { params: { token: uploadToken(LUKA) } })).body);
        assert.ok(html.includes(FORMAT_LINE), 'the format line, verbatim');
        assert.ok(html.includes('Deadline ' + DEADLINE), 'the deadline, verbatim');
        assert.ok(!/18 September|Friday, 18/.test(html), 'the old deadline is gone');
    });

    await t('no page or email in the wing still says Friday, 18 September', () => {
        const src = require('node:fs').readFileSync(require.resolve('../user-portal/backend/boston.js'), 'utf8');
        assert.ok(!/18 September|Friday, 18/.test(src), 'the superseded deadline is nowhere in boston.js');
        assert.ok(src.includes(DEADLINE), 'and the one from the program PDF is');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
