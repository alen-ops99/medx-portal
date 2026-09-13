/**
 * tests/boston-onepager.test.js — the participant one-pagers (every guest) and the program PDF
 * that rides along on the one Boston email (user-portal/backend/boston.js).
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

const pdfBuf = (extra = 64) => Buffer.concat([Buffer.from('%PDF-1.7\n% Building Bridges Boston one-pager\n'), Buffer.alloc(extra, 0x20)]);
const zipBuf = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(96, 0)]);

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
        assert.ok(html.includes('Hi Ana — introduce yourself to the room'), 'personal greeting');
        assert.ok(html.includes('Ana Horvat'), 'attributed to the registration');
        assert.ok(/Introduce yourself to the room &mdash; one page: who you are, what you work on, what collaborators or opportunities you are looking for\./.test(html), 'the brief, verbatim');
        assert.ok(/PDF, up to 5 MB\./.test(html), 'the limit, verbatim');
        assert.ok(/We compile every one-pager into a participant booklet shared with all attendees after the evening\./.test(html), 'the promise, verbatim');
        assert.ok(html.includes('noindex'), 'never indexed');
        assert.ok(html.includes('width=device-width'), 'phone viewport');
        assert.ok(html.includes(`/api/boston/onepager/${onepagerToken(ANA)}`), 'the page posts to its own token API');
        assert.ok(html.includes('id="hl_text"'), 'the optional headline field');
        assert.ok(html.includes('accept=".pdf"'), 'PDF only in the picker');
        assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no leaked placeholders');
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

    await t('PDF only — a deck, a zip, an image or a text file is refused, and nothing is stored', async () => {
        const puts = s3Puts.length, rows = opRows(ANA).length;
        const bad = [
            { originalname: 'slides.pptx', buffer: zipBuf() },
            { originalname: 'notes.txt', buffer: Buffer.from('hello world padding........') },
            { originalname: 'photo.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]) },
            { originalname: 'deck.key', buffer: zipBuf() }
        ];
        for (const f of bad) {
            const r = await upload(onepagerToken(ANA), f);
            assert.strictEqual(r.statusCode, 400, f.originalname + ' must be refused');
        }
        // a .pdf name over something that is not a PDF inside is refused by the magic bytes
        const liar = await upload(onepagerToken(ANA), { originalname: 'liar.pdf', buffer: zipBuf() });
        assert.strictEqual(liar.statusCode, 400);
        assert.ok(/does not look like a real PDF/.test(liar.body.error));
        const empty = await upload(onepagerToken(ANA), undefined);
        assert.strictEqual(empty.statusCode, 400);
        assert.strictEqual(s3Puts.length, puts, 'no S3 write');
        assert.strictEqual(opRows(ANA).length, rows, 'no row');
    });

    await t('over 5 MB is a 413 — no S3 write, no row', async () => {
        const puts = s3Puts.length, rows = opRows(ANA).length;
        const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)]);
        const r = await upload(onepagerToken(ANA), { originalname: 'huge.pdf', buffer: big, size: big.length });
        assert.strictEqual(r.statusCode, 413);
        assert.ok(/5 MB/.test(r.body.error), 'the message names the limit');
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

    await t('the ZIP names every entry Last_First__file.pdf and holds one file per guest', async () => {
        const r = await call(app, 'GET', '/api/boston/onepagers.zip', { query: { key: ADMIN_KEY } });
        assert.strictEqual(r.statusCode, 200);
        assert.strictEqual(r.headers['content-type'], 'application/zip');
        assert.ok(/BB-Boston-one-pagers-\d{4}-\d{2}-\d{2}\.zip/.test(String(r.headers['content-disposition'])), 'a dated filename');
        const zip = r.body;
        assert.ok(Buffer.isBuffer(zip) && zip.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'a real zip');
        const text = zip.toString('latin1');
        assert.ok(text.includes('Horvat_Ana__Ana_v2.pdf'), 'Ana, newest file: ' + text.slice(0, 120));
        assert.ok(text.includes('Babic_Luka__luka4.pdf'), 'Luka, newest file');
        assert.ok(!text.includes('luka.pdf"'), 'older versions stay out of the booklet archive');
        // one local header per guest with a file — two guests, two entries
        let entries = 0, at = 0;
        while ((at = text.indexOf('PK', at)) !== -1) { entries++; at += 4; }
        assert.strictEqual(entries, 2, 'exactly one entry per guest');
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
    await t('no email was sent by any of this, and the Google sheet was never touched', () => {
        assert.strictEqual(sentEmails.length, 0, 'the one-pager lane sends nothing by itself');
        const src = require('node:fs').readFileSync(require.resolve('../user-portal/backend/boston.js'), 'utf8');
        const feature = src.slice(src.indexOf('ONE-PAGERS (every guest)'), src.indexOf('team data (page + JSON share it)'));
        assert.ok(feature.length > 2000, 'found the feature block');
        assert.ok(!/pushToBostonSheet|updateBostonSheetStatus|sheetsToken/.test(feature), 'the one-pagers leave the owner\'s sheet alone');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
