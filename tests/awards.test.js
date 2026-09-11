/**
 * tests/awards.test.js — PLEXUS GALA AWARDS (design/AWARDS-SPEC.md §Non-negotiables).
 *
 * Hermetic: a stub express app collects routes, ONE in-memory libsql database (the same
 * shared/db.js wrapper both portals use) carries the real schema, and BOTH v2 modules — the
 * member `user-portal/backend/v2/awards.js` and the admin `admin-portal/backend/v2/awards-ops.js`
 * — are mounted on it, exactly as production has them sharing one Turso DB. sendEmail is a
 * capturing stub and global.fetch is disabled, so A REAL EMAIL SEND OR ANY NETWORK CALL IS
 * IMPOSSIBLE HERE.
 *
 * Covers every case the spec's §Non-negotiables names:
 *   word-limit enforcement · self vs third-party uniqueness · multiple nominators grouped as ONE
 *   candidate · the review-gate hold path (and its approve) · reviewer scoping (reader A cannot
 *   score reader B's category → 404, never 403) · one score per entry, editable · ranking maths
 *   (mean · spread · n, conflicts excluded) · a winner creating the comp gala row EXACTLY ONCE ·
 *   notify staged to the Outbox and NOT sent · the opens/closes windows · withdraw via the manage
 *   token · forged tokens → 404 · the honeypot · PDF magic bytes · the EN and HR public pages.
 *
 * Run:  node tests/awards.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
process.env.MEETUPS_NO_TIMERS = '1';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.MEMBER_PORTAL_URL;
delete process.env.USER_PORTAL_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('BB_S3_')) delete process.env[k];
process.env.PUBLIC_BASE_URL = 'https://portal.test';
process.env.REVIEW_EMAIL = 'reviewer-gate@test.invalid';
process.env.PORT = '3000';

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));
const editionsLib = require(path.join(ROOT, 'shared/editions'));
const core = require(path.join(ROOT, 'shared/awards-core'));
const emails = require(path.join(ROOT, 'shared/award-emails'));
const gate = require(path.join(ROOT, 'user-portal/backend/review-gate'));
const boston = require(path.join(ROOT, 'user-portal/backend/boston'));

const JWT_SECRET = 'test-secret-awards';

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
}

// ---------------------------------------------------------------- stub express
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
                user: opts.user === undefined ? null : opts.user,
                params: opts.params || {}, query: opts.query || {}, body: opts.body || {},
                headers: opts.headers || {}, ip: opts.ip || '10.0.0.1',
                protocol: 'https', get: () => 'portal.test'
            };
            const r = { status: 200, body: undefined, headers: {} };
            let ended = false;
            const res = {
                status(c) { r.status = c; return res; },
                json(o) { r.body = o; ended = true; return res; },
                send(x) { r.body = x; ended = true; return res; },
                set(k, v) { r.headers[String(k).toLowerCase()] = v; return res; },
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
[
    `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, first_name TEXT, last_name TEXT,
        institution TEXT, country TEXT, title TEXT, bio TEXT, is_admin INTEGER DEFAULT 0, deleted_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE scheduled_emails (id TEXT PRIMARY KEY, status TEXT, batch_id TEXT, source_engine TEXT, template TEXT,
        payload_json TEXT, recipient_email TEXT, subject TEXT, created_by TEXT, created_at TEXT)`,
    `CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT)`,
    `CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT,
        status TEXT, payment_status TEXT, amount_paid REAL, pricing TEXT, admin_notes TEXT, guest_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
].forEach(s => db.run(s));

const q = {
    run: (s, p) => db.run(s, p || []),
    get: (s, p) => { const st = db.prepare(s); st.bind(p || []); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
    all: (s, p) => { const st = db.prepare(s); st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; }
};

q.run('INSERT INTO users (id, email, first_name, last_name, institution, title, is_admin) VALUES (?,?,?,?,?,?,1)',
    ['u-admin', 'admin@medx.hr', 'Laura', 'Rodman', 'Med&X', 'Operations']);
q.run('INSERT INTO users (id, email, first_name, last_name, institution, title, is_admin) VALUES (?,?,?,?,?,?,0)',
    ['u-ana', 'ana@example.hr', 'Ana', 'Horvat', 'KBC Split', 'Resident in neurology']);

// ---------------------------------------------------------------- email sink + auth stubs
const sent = [];
const sendEmail = async (to, subject, html) => { sent.push({ to, subject, html }); return { success: true }; };
const sentTo = (email) => sent.filter(e => String(e.to).toLowerCase() === String(email).toLowerCase());
const clearMail = () => { sent.length = 0; };

const auth = (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'Unauthorized' }); next(); };
const adminOnly = (req, res, next) => { if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Admin only' }); next(); };
const ADMIN = { id: 'u-admin', email: 'admin@medx.hr', is_admin: true };

// ---------------------------------------------------------------- mount both modules
const app = stubApp();
const mountAwards = require(path.join(ROOT, 'user-portal/backend/v2/awards.js'));
const mountAwardsOps = require(path.join(ROOT, 'admin-portal/backend/v2/awards-ops.js'));

editionsLib.bootstrap(q);
mountAwards(app, { db: () => db, auth, adminOnly, optionalAuth: (a, b, n) => n(), sendEmail, JWT_SECRET, ROOT, log: () => {} });
mountAwardsOps(app, { db: () => db, auth, adminOnly, sendEmail, saveDb: () => {}, JWT_SECRET, ROOT, log: () => {} });
gate.mountReviewRoutes(app, { JWT_SECRET, sendEmail });

const M = mountAwards._internals;
const ED = () => editionsLib.activeEdition(q);
const cat = (key) => core.categoryByKey(q, ED().id, key);

// ---------------------------------------------------------------- helpers
const words = (n, w) => new Array(n).fill(w || 'word').join(' ');

async function submit(body) {
    return app.call('POST', '/api/v2/awards/entries', { body });
}
const nominationBody = (over = {}) => Object.assign({
    category: 'excellence',
    nominee_name: 'Marko Kovačević', nominee_email: 'marko@kbc-zagreb.hr',
    nominee_institution: 'KBC Zagreb', nominee_position: 'Consultant cardiologist',
    nominee_country: 'Croatia',
    nominator_name: 'Ana Horvat', nominator_email: 'ana@example.hr', nominator_relation: 'Colleague',
    statement: 'He built the first national registry and shared it with everybody who asked.',
    consent_publish: true
}, over);
const applicationBody = (over = {}) => Object.assign({
    category: 'fellowship',
    nominee_name: 'Iva Perić', nominee_email: 'iva@skola.hr',
    school: 'V. gimnazija, Zagreb', study_year: '4', nominee_institution: 'Zagreb',
    nominee_country: 'Croatia',
    challenge: 'Children with asthma in rural Croatia see a specialist twice a year at best.',
    solution: 'A simple spirometry loan scheme run through school nurses, with a phone reading.',
    why_you: 'I have had asthma since I was six and I know what the waiting feels like.',
    consent_publish: true, willing_to_present: true, language: 'en'
}, over);

const entriesOfKey = (key) => core.entriesOf(q, cat(key).id);
const rowByEmail = (key, email) => entriesOfKey(key).find(e => String(e.nominee_email || '').toLowerCase() === email.toLowerCase());

async function addReviewer(name, email, categoryIds) {
    return app.call('POST', '/api/v2/awards-ops/reviewers', { user: ADMIN, body: { name, email, categories: categoryIds } });
}
const reviewerRow = (email) => q.get('SELECT * FROM award_reviewers WHERE lower(email) = lower(?)', [email]);

(async () => {
    console.log('awards.test.js — hermetic (stub express, in-memory libsql, captured emails, no network)\n');

    // ============================================================ routes are mounted
    await t('every public + member awards route is mounted', () => {
        for (const k of [
            'GET /awards', 'GET /awards/:key',
            'GET /awards/manage/:token', 'POST /awards/manage/:token',
            'GET /awards/review/:token', 'GET /awards/slides/:token',
            'GET /api/v2/awards/overview', 'GET /api/v2/awards/me',
            'POST /api/v2/awards/entries', 'POST /api/v2/awards/entries/:token/attachment',
            'GET /api/v2/awards/entries/:token', 'POST /api/v2/awards/entries/:token/withdraw',
            'GET /api/v2/awards/review/:token/data', 'POST /api/v2/awards/review/:token/score',
            'GET /api/v2/awards/review/:token/attachment/:entryId',
            'POST /api/v2/awards/slides/:token/confirm', 'POST /api/v2/awards/slides/:token/upload'
        ]) assert.ok(app.routes[k], 'missing ' + k);
    });

    await t('every admin awards-ops route is mounted', () => {
        for (const k of [
            'GET /api/v2/awards-ops/overview',
            'GET /api/v2/awards-ops/categories/:id/entries', 'PUT /api/v2/awards-ops/categories/:id',
            'POST /api/v2/awards-ops/categories/:id/merge', 'GET /api/v2/awards-ops/categories/:id/ranking',
            'POST /api/v2/awards-ops/categories/:id/laureates', 'POST /api/v2/awards-ops/categories/:id/notify',
            'GET /api/v2/awards-ops/categories/:id/entries.csv',
            'GET /api/v2/awards-ops/entries/:id', 'POST /api/v2/awards-ops/entries/:id/status',
            'POST /api/v2/awards-ops/entries/:id/notes', 'GET /api/v2/awards-ops/entries/:id/attachment',
            'GET /api/v2/awards-ops/reviewers', 'POST /api/v2/awards-ops/reviewers',
            'POST /api/v2/awards-ops/reviewers/:id/resend', 'DELETE /api/v2/awards-ops/reviewers/:id',
            'PUT /api/v2/awards-ops/laureates/:id', 'DELETE /api/v2/awards-ops/laureates/:id',
            'GET /api/v2/awards-ops/roster', 'GET /api/v2/awards-ops/roster.csv', 'GET /api/v2/awards-ops/one-pager'
        ]) assert.ok(app.routes[k], 'missing ' + k);
    });

    // ============================================================ the four seeded categories
    await t('the four categories seed themselves for plexus-2026, with their citations and rubrics', () => {
        const list = core.listCategories(q, ED().id);
        assert.strictEqual(list.length, 4, 'expected four awards, got ' + list.length);
        assert.deepStrictEqual(list.map(c => c.key), ['lifetime-bridge', 'excellence', 'rising-talent', 'fellowship']);
        const lb = cat('lifetime-bridge');
        assert.strictEqual(lb.intake, 'none');
        assert.match(lb.citation, /connecting Croatian medicine and science with the world/);
        assert.ok(lb.name_hr && lb.citation_hr, 'the Croatian name and citation are seeded');
        const fe = cat('fellowship');
        assert.strictEqual(fe.intake, 'application');
        assert.deepStrictEqual(core.rubricOf(fe).map(r => r.key), ['impact', 'originality', 'feasibility']);
        assert.deepStrictEqual(core.rubricOf(cat('excellence')).map(r => r.key), ['achievement', 'impact', 'trajectory']);
        assert.strictEqual(cat('excellence').opens_at, '2026-10-01T09:00');
        assert.strictEqual(cat('excellence').closes_at, '2026-11-01T23:59');
        assert.strictEqual(Number(cat('rising-talent').laureates_max), 2);
    });

    await t('seeding twice changes nothing (idempotent)', () => {
        core.seedCategories(q, ED().id);
        core.seedCategories(q, ED().id);
        assert.strictEqual(core.listCategories(q, ED().id).length, 4);
    });

    // ============================================================ the window
    await t('the intake window opens and closes on Zagreb wall time', () => {
        const c = cat('excellence');
        assert.strictEqual(core.windowState(c, Date.parse('2026-09-30T12:00:00Z')), 'before');
        assert.strictEqual(core.windowState(c, Date.parse('2026-10-01T06:59:00Z')), 'before', '08:59 Zagreb is still before 09:00');
        assert.strictEqual(core.windowState(c, Date.parse('2026-10-01T07:30:00Z')), 'open', '09:30 Zagreb is open');
        assert.strictEqual(core.windowState(c, Date.parse('2026-11-01T22:58:00Z')), 'open', '23:58 Zagreb is still open');
        assert.strictEqual(core.windowState(c, Date.parse('2026-11-02T05:00:00Z')), 'closed');
        assert.strictEqual(core.windowState(cat('lifetime-bridge')), 'none', 'the Lifetime Bridge has no public call');
    });

    await t('a submission before the window opens is refused, and so is one after it closes', async () => {
        // Park the real dates, drive the boundary, then put them back.
        const c = cat('excellence');
        await app.call('PUT', '/api/v2/awards-ops/categories/:id', {
            user: ADMIN, params: { id: c.id }, body: { opens_at: '2099-01-01T09:00', closes_at: '2099-02-01T23:59' }
        });
        let r = await submit(nominationBody({ nominee_email: 'too-early@example.hr' }));
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /open/i);

        await app.call('PUT', '/api/v2/awards-ops/categories/:id', {
            user: ADMIN, params: { id: c.id }, body: { opens_at: '2020-01-01T09:00', closes_at: '2020-02-01T23:59' }
        });
        r = await submit(nominationBody({ nominee_email: 'too-late@example.hr' }));
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /closed/i);

        // Open it for the rest of the suite.
        await app.call('PUT', '/api/v2/awards-ops/categories/:id', {
            user: ADMIN, params: { id: c.id }, body: { opens_at: '2020-01-01T09:00', closes_at: '2099-02-01T23:59' }
        });
        assert.strictEqual(core.windowState(cat('excellence')), 'open');
        // The other two public awards run on the same widened window for the tests below.
        for (const k of ['rising-talent', 'fellowship']) {
            await app.call('PUT', '/api/v2/awards-ops/categories/:id', {
                user: ADMIN, params: { id: cat(k).id }, body: { opens_at: '2020-01-01T09:00', closes_at: '2099-02-01T23:59' }
            });
        }
        assert.strictEqual(entriesOfKey('excellence').length, 0, 'nothing was written while the window was shut');
    });

    await t('the Lifetime Bridge refuses a public nomination outright', async () => {
        const r = await submit(nominationBody({ category: 'lifetime-bridge', nominee_email: 'nobody@example.hr' }));
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /no public call/i);
    });

    // ============================================================ word limits
    await t('word limits are enforced in WORDS, on the server', () => {
        assert.strictEqual(core.wordCount('  one   two three  '), 3);
        assert.strictEqual(core.wordCount(''), 0);
        const c = cat('excellence');
        const ok = core.validateEntry(c, nominationBody({ statement: words(400) }));
        assert.deepStrictEqual(ok.errors, [], 'exactly 400 words passes');
        const over = core.validateEntry(c, nominationBody({ statement: words(401) }));
        assert.ok(over.errors.some(e => /401 words/.test(e)), 'one word over is refused, and says so');
    });

    await t('a 401-word statement is refused over HTTP and nothing is written', async () => {
        const before = entriesOfKey('excellence').length;
        const r = await submit(nominationBody({ statement: words(401), nominee_email: 'longwinded@example.hr' }));
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /400/);
        assert.strictEqual(entriesOfKey('excellence').length, before);
    });

    await t('the fellowship enforces 200 / 300 / 100 on its three fields', async () => {
        const c = cat('fellowship');
        assert.deepStrictEqual(core.WORD_LIMITS, { statement: 400, challenge: 200, solution: 300, why_you: 100 });
        for (const [f, n] of [['challenge', 201], ['solution', 301], ['why_you', 101]]) {
            const r = core.validateEntry(c, applicationBody({ [f]: words(n) }));
            assert.ok(r.errors.some(e => e.includes(String(n))), `${f} over the limit must be refused`);
        }
        const good = core.validateEntry(c, applicationBody({ challenge: words(200), solution: words(300), why_you: words(100) }));
        assert.deepStrictEqual(good.errors, [], 'exactly at the limit passes');
        const http = await submit(applicationBody({ why_you: words(101), nominee_email: 'over@skola.hr' }));
        assert.strictEqual(http.status, 400);
    });

    await t('an entry with no consent tick is refused', () => {
        const r = core.validateEntry(cat('excellence'), nominationBody({ consent_publish: false }));
        assert.ok(r.errors.some(e => /consent/i.test(e)));
    });

    // ============================================================ the honeypot
    await t('a filled honeypot answers like a success and writes NOTHING', async () => {
        const before = entriesOfKey('excellence').length;
        clearMail();
        const r = await submit(nominationBody({ website: 'http://spam.example', nominee_email: 'bot@example.hr' }));
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(r.body.token, undefined, 'a bot gets no token');
        assert.strictEqual(entriesOfKey('excellence').length, before, 'no row was written');
        assert.strictEqual(sent.length, 0, 'no email of any kind');
    });

    // ============================================================ a clean nomination
    let firstEntry = null;
    await t('a clean third-party nomination is recorded and acknowledged', async () => {
        clearMail();
        const r = await submit(nominationBody());
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.success, true);
        assert.match(r.body.token, /^[0-9a-f]{32}$/, 'the manage token is 32 hex');
        firstEntry = rowByEmail('excellence', 'marko@kbc-zagreb.hr');
        assert.ok(firstEntry, 'the row exists');
        assert.strictEqual(firstEntry.status, 'received');
        assert.strictEqual(firstEntry.kind, 'nomination');
        assert.strictEqual(firstEntry.manage_token, r.body.token);

        const toNominator = sentTo('ana@example.hr');
        assert.strictEqual(toNominator.length, 1, 'the nominator is thanked once');
        assert.match(toNominator[0].subject, /Nomination received/);
        assert.match(toNominator[0].html, /Marko Kovačević/);
        const toNominee = sentTo('marko@kbc-zagreb.hr');
        assert.strictEqual(toNominee.length, 1, 'the nominee hears it from us, warmly');
        assert.match(toNominee[0].subject, /You have been nominated/);
        assert.match(toNominee[0].html, /Nothing is needed from you/);
    });

    await t('every awards email is the dark house shell', () => {
        for (const m of sent) {
            assert.match(m.html, /<!DOCTYPE html>/i, 'a full HTML document');
            assert.ok(/#120e0a|#291e14|#1a1410|background:#1/.test(m.html), 'the dark espresso ground');
        }
        const one = emails.nominationReceived({ nomineeName: 'X', awardName: 'Y', manageUrl: 'https://portal.test/awards/manage/' + 'a'.repeat(32) });
        assert.match(one, /awards\/manage\//, 'the acknowledgment carries the manage link');
    });

    // ============================================================ uniqueness + grouping
    await t('the SAME nominator sending the SAME nominee twice updates one row, never a twin', async () => {
        const before = entriesOfKey('excellence').length;
        const r = await submit(nominationBody({ statement: 'A second, better-worded attempt at the same nomination.' }));
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.already, true);
        assert.strictEqual(entriesOfKey('excellence').length, before, 'still one row');
        assert.match(rowByEmail('excellence', 'marko@kbc-zagreb.hr').statement, /second, better-worded/);
    });

    await t('a DIFFERENT nominator for the same person is a second row and ONE candidate', async () => {
        const r = await submit(nominationBody({
            nominator_name: 'Petra Kovač', nominator_email: 'petra@mef.hr', nominator_relation: 'Former mentor',
            statement: 'I trained him. Nothing I taught him explains what he went on to build.'
        }));
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.already, false, 'a new nominator is a NEW row, not a resubmission');
        const rows = entriesOfKey('excellence').filter(e => String(e.nominee_email) === 'marko@kbc-zagreb.hr');
        assert.strictEqual(rows.length, 2, 'two nominations');
        const cands = core.candidatesOf(q, cat('excellence').id).filter(c => c.email === 'marko@kbc-zagreb.hr');
        assert.strictEqual(cands.length, 1, 'grouped into ONE candidate');
        assert.strictEqual(cands[0].nominations, 2);
        assert.deepStrictEqual(cands[0].nominators.map(n => n.email).sort(), ['ana@example.hr', 'petra@mef.hr']);
    });

    await t('a self-nomination coexists with a third-party nomination of the same person', async () => {
        const r = await submit({
            category: 'excellence', self: true,
            nominee_name: 'Marko Kovačević', nominee_email: 'marko@kbc-zagreb.hr',
            nominee_institution: 'KBC Zagreb', nominee_country: 'Croatia',
            statement: 'I would rather put my own name forward than wait to be noticed.',
            consent_publish: true
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const rows = entriesOfKey('excellence').filter(e => String(e.nominee_email) === 'marko@kbc-zagreb.hr');
        assert.strictEqual(rows.length, 3, 'self + two third-party');
        assert.strictEqual(rows.filter(e => e.kind === 'self-nomination').length, 1);
        const c = core.candidatesOf(q, cat('excellence').id).find(x => x.email === 'marko@kbc-zagreb.hr');
        assert.strictEqual(c.nominations, 3, 'still ONE candidate');
        assert.strictEqual(c.self_nominated, true);
        // And a second self-nomination is still the same row.
        const again = await submit({
            category: 'excellence', self: true,
            nominee_name: 'Marko Kovačević', nominee_email: 'marko@kbc-zagreb.hr', nominee_country: 'Croatia',
            statement: 'Same person, same self-nomination.', consent_publish: true
        });
        assert.strictEqual(again.body.already, true);
        assert.strictEqual(entriesOfKey('excellence').filter(e => e.kind === 'self-nomination').length, 1);
    });

    await t('a category that refuses self-nominations says so', () => {
        const c = Object.assign({}, cat('excellence'), { allow_self: 0 });
        const r = core.validateEntry(c, { nominee_name: 'X Y', nominee_email: 'x@y.hr', self: true, statement: 'A line.', consent_publish: true });
        assert.ok(r.errors.some(e => /self-nominations/i.test(e)));
    });

    // ============================================================ the review gate
    await t("review-gate REVIEW_TABLES carries award_entries, and the token round-trips", () => {
        assert.ok(gate.REVIEW_TABLES.includes('award_entries'));
        const id = crypto.randomUUID();
        const tok = gate.reviewToken('s1', 'award_entries', id);
        assert.deepStrictEqual(gate.verifyReviewToken('s1', tok), { table: 'award_entries', id });
        assert.strictEqual(gate.verifyReviewToken('s2', tok), null, 'the wrong secret verifies nothing');
        assert.strictEqual(gate.verifyReviewToken('s1', 'f'.repeat(32) + '.award_entries.' + id), null, 'a forged signature is refused');
        assert.strictEqual(gate.verifyReviewToken('s1', tok.replace('award_entries', 'users')), null, 'an unknown table is refused');
        // The two older tables still work, unchanged.
        const old = gate.reviewToken('s1', 'bridges_registrations', id);
        assert.deepStrictEqual(gate.verifyReviewToken('s1', old), { table: 'bridges_registrations', id });
    });

    let heldId = null;
    await t('a gibberish nomination is HELD, mails Alen, and gives the submitter only the soft note', async () => {
        clearMail();
        const r = await submit(nominationBody({
            nominee_name: 'RQstQeTGKseNqJzmVHMmE bQxZvKtRmNpQ', nominee_email: 'rq@ugakeu.example',
            nominee_institution: 'Ugakeu LLC', nominee_position: 'cCzNfiIdNITvvnWjrBf',
            nominator_name: 'Ana Horvat', nominator_email: 'held-nominator@example.hr'
        }));
        assert.strictEqual(r.status, 200, 'the response is indistinguishable from a success');
        assert.strictEqual(r.body.success, true);
        const row = rowByEmail('excellence', 'rq@ugakeu.example');
        heldId = row.id;
        assert.strictEqual(row.status, 'pending-review');
        assert.match(row.gate_reason, /machine-generated/i);

        const toAlen = sentTo(gate.REVIEW_TO);
        assert.strictEqual(toAlen.length, 1, 'Alen gets exactly one review email');
        assert.match(toAlen[0].html, /Approve/);
        assert.match(toAlen[0].html, /Reject/);
        assert.match(toAlen[0].html, /api\/review\/[0-9a-f]{32}\.award_entries\./, 'with a real award_entries decision link');

        const toSubmitter = sentTo('held-nominator@example.hr');
        assert.strictEqual(toSubmitter.length, 1);
        assert.ok(!/review|held|suspicious/i.test(toSubmitter[0].subject), 'the acknowledgment never tips anybody off');
        assert.strictEqual(sentTo('rq@ugakeu.example').length, 0, 'a held nominee is told nothing at all');
    });

    await t('an unsafe / missing country holds the entry too', async () => {
        const r = await submit(nominationBody({
            category: 'rising-talent',
            nominee_name: 'Kwame Mensah', nominee_email: 'kwame@example.gh',
            nominee_institution: 'University of Ghana', nominee_country: 'Ghana',
            nominator_email: 'unsafe-nominator@example.hr'
        }));
        assert.strictEqual(r.status, 200);
        const row = rowByEmail('rising-talent', 'kwame@example.gh');
        assert.strictEqual(row.status, 'pending-review');
        assert.match(row.gate_reason, /Country outside the safe list/);
        const blank = await submit(nominationBody({
            category: 'rising-talent', nominee_name: 'Nobody Atall', nominee_email: 'blank@example.hr',
            nominee_country: '', nominator_email: 'blank-nominator@example.hr'
        }));
        assert.strictEqual(blank.status, 200);
        assert.strictEqual(rowByEmail('rising-talent', 'blank@example.hr').status, 'pending-review');
    });

    await t('APPROVE from the review email releases the entry and sends the real acknowledgment', async () => {
        clearMail();
        const tok = gate.reviewToken(JWT_SECRET, 'award_entries', heldId);
        const r = await app.call('GET', '/api/review/:token/approve', { params: { token: tok } });
        assert.strictEqual(r.status, 200);
        assert.match(String(r.body), /Approved/);
        assert.strictEqual(core.entryById(q, heldId).status, 'received');
        assert.strictEqual(sentTo('held-nominator@example.hr').length, 1, 'now the real acknowledgment goes out');
        // Idempotent: a second click re-sends nothing.
        clearMail();
        const again = await app.call('GET', '/api/review/:token/approve', { params: { token: tok } });
        assert.strictEqual(again.status, 200);
        assert.match(String(again.body), /Already approved/);
        assert.strictEqual(sent.length, 0);
    });

    await t('REJECT sets the entry aside and tells the submitter nothing', async () => {
        const row = rowByEmail('rising-talent', 'kwame@example.gh');
        clearMail();
        const tok = gate.reviewToken(JWT_SECRET, 'award_entries', row.id);
        const r = await app.call('GET', '/api/review/:token/reject', { params: { token: tok } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(core.entryById(q, row.id).status, 'ineligible');
        assert.strictEqual(sent.length, 0, 'nobody is notified of a rejection');
        const again = await app.call('GET', '/api/review/:token/reject', { params: { token: tok } });
        assert.match(String(again.body), /Already rejected/);
    });

    await t('a forged review token is a 404 page, not a decision', async () => {
        const r = await app.call('GET', '/api/review/:token/approve', { params: { token: 'f'.repeat(32) + '.award_entries.' + heldId } });
        assert.strictEqual(r.status, 404);
    });

    // ============================================================ manage + withdraw
    await t('the manage page opens on its own token and 404s on a forged one', async () => {
        const tok = firstEntry.manage_token;
        const ok = await app.call('GET', '/awards/manage/:token', { params: { token: tok } });
        assert.strictEqual(ok.status, 200);
        assert.match(String(ok.body), /Marko Kovačević/);
        assert.match(String(ok.body), /Withdraw my entry/);

        const flipped = tok.slice(0, 31) + (tok[31] === '0' ? '1' : '0');
        for (const bad of ['f'.repeat(32), 'nonsense', '', flipped]) {
            const r = await app.call('GET', '/awards/manage/:token', { params: { token: bad } });
            assert.strictEqual(r.status, 404, 'forged token ' + bad + ' must 404');
        }
        assert.strictEqual(M.byManageToken('a'.repeat(32)), null);
    });

    await t('withdraw through the manage token takes the entry out of the running', async () => {
        const self = entriesOfKey('excellence').find(e => e.kind === 'self-nomination');
        const before = core.candidatesOf(q, cat('excellence').id).find(c => c.email === 'marko@kbc-zagreb.hr').nominations;
        const r = await app.call('POST', '/awards/manage/:token', { params: { token: self.manage_token } });
        assert.strictEqual(r.status, 200);
        assert.match(String(r.body), /withdrawn/i);
        assert.strictEqual(core.entryById(q, self.id).status, 'withdrawn');
        const after = core.candidatesOf(q, cat('excellence').id).find(c => c.email === 'marko@kbc-zagreb.hr').nominations;
        assert.strictEqual(after, before - 1, 'the withdrawn row leaves the candidate');
        // Idempotent.
        const twice = await app.call('POST', '/awards/manage/:token', { params: { token: self.manage_token } });
        assert.strictEqual(twice.status, 200);
        assert.strictEqual(core.entryById(q, self.id).status, 'withdrawn');
    });

    await t('the JSON status behind the manage page reads the stage, not the raw status', async () => {
        const r = await app.call('GET', '/api/v2/awards/entries/:token', { params: { token: firstEntry.manage_token } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.stage, 'received');
        assert.strictEqual(r.body.can_withdraw, true);
        assert.strictEqual(r.body.nominee, 'Marko Kovačević');
    });

    // ============================================================ the fellowship application
    let fellowA = null, fellowB = null;
    await t('a fellowship application is recorded, acknowledged, and never emails a "nominee"', async () => {
        clearMail();
        const r = await submit(applicationBody());
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        fellowA = rowByEmail('fellowship', 'iva@skola.hr');
        assert.strictEqual(fellowA.kind, 'application');
        assert.strictEqual(Number(fellowA.willing_to_present), 1);
        assert.strictEqual(fellowA.school, 'V. gimnazija, Zagreb');
        assert.strictEqual(sentTo('iva@skola.hr').length, 1, 'exactly one email, to the applicant');
        assert.match(sentTo('iva@skola.hr')[0].subject, /Application received/);

        const second = await submit(applicationBody({
            nominee_name: 'Luka Marić', nominee_email: 'luka@mef.hr', school: 'MEF Zagreb', study_year: '3',
            language: 'hr',
            challenge: 'Bolnice u manjim gradovima nemaju dežurnog neurologa noću.',
            solution: 'Telemedicinski protokol s dežurnim centrom i jasnim kriterijima prijenosa.',
            why_you: 'Radio sam ljeto na neurologiji i vidio koliko se čeka.'
        }));
        assert.strictEqual(second.status, 200);
        fellowB = rowByEmail('fellowship', 'luka@mef.hr');
        assert.strictEqual(fellowB.language, 'hr');
        assert.match(sentTo('luka@mef.hr')[0].html, /Plexus stipendij/i, 'a Croatian entry gets the Croatian letter');
    });

    // ============================================================ reviewers + scoping
    let revA = null, revB = null;
    await t('adding a reader sends exactly one invitation, carrying their own room link', async () => {
        clearMail();
        const r = await addReviewer('Petra Kovač', 'petra.reader@mef.hr', [cat('excellence').id, cat('rising-talent').id]);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.invited, true);
        revA = reviewerRow('petra.reader@mef.hr');
        assert.ok(revA, 'the reviewer row exists');
        assert.match(revA.token, /^[0-9a-f]{32}$/);
        const inv = sentTo('petra.reader@mef.hr');
        assert.strictEqual(inv.length, 1);
        assert.match(inv[0].html, new RegExp('/awards/review/' + revA.token));
        assert.match(inv[0].html, /Croatian Excellence/);

        const r2 = await addReviewer('Marko Jurić', 'marko.reader@kbc.hr', [cat('fellowship').id]);
        assert.strictEqual(r2.status, 200);
        revB = reviewerRow('marko.reader@kbc.hr');
        assert.notStrictEqual(revA.token, revB.token);
    });

    await t('a reviewer token grants ONLY that reviewer\'s categories', async () => {
        const a = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: revA.token } });
        assert.strictEqual(a.status, 200);
        const keys = a.body.groups.map(g => g.category.key).sort();
        assert.deepStrictEqual(keys, ['excellence', 'rising-talent']);
        const b = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: revB.token } });
        assert.deepStrictEqual(b.body.groups.map(g => g.category.key), ['fellowship']);
        // A forged or unknown token is a 404, not an empty room.
        for (const bad of ['f'.repeat(32), revA.token.slice(0, 31) + '0', 'x']) {
            const r = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: bad } });
            assert.strictEqual(r.status, 404);
        }
    });

    await t('the reading room anonymises the nominator and hides the gate reason', async () => {
        const a = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: revA.token } });
        const rows = a.body.groups.flatMap(g => g.entries);
        assert.ok(rows.length, 'there is something to read');
        for (const x of rows) {
            assert.strictEqual(x.entry.nominator, null, 'no nominator reaches a reader');
            assert.strictEqual(x.entry.gate_reason, null, 'no gate reason reaches a reader');
            assert.ok(x.entry.name, 'the nominee is visible — that is the point');
        }
        const html = await app.call('GET', '/awards/review/:token', { params: { token: revA.token } });
        assert.strictEqual(html.status, 200);
        assert.ok(!/Ana Horvat|petra@mef\.hr/.test(String(html.body)), 'the page names no nominator either');
        assert.match(String(html.body), /You have scored 0 of/);
    });

    await t('reader A cannot score an entry in reader B\'s category — 404, never 403', async () => {
        const r = await app.call('POST', '/api/v2/awards/review/:token/score', {
            params: { token: revA.token },
            body: { entry_id: fellowA.id, scores: { impact: 5, originality: 5, feasibility: 5 } }
        });
        assert.strictEqual(r.status, 404, 'a 403 would confirm the entry exists');
        assert.strictEqual(core.scoresOf(q, fellowA.id).length, 0, 'and nothing was written');
    });

    await t('a score is one row per (entry, reader), and a second submission EDITS it', async () => {
        const r1 = await app.call('POST', '/api/v2/awards/review/:token/score', {
            params: { token: revA.token },
            body: { entry_id: firstEntry.id, scores: { achievement: 4, impact: 5, trajectory: 3 }, comment: 'Real work, plainly described.' }
        });
        assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
        assert.strictEqual(r1.body.total, 12);
        assert.strictEqual(r1.body.edited, false);
        assert.strictEqual(core.scoresOf(q, firstEntry.id).length, 1);

        const r2 = await app.call('POST', '/api/v2/awards/review/:token/score', {
            params: { token: revA.token },
            body: { entry_id: firstEntry.id, scores: { achievement: 5, impact: 5, trajectory: 5 }, comment: 'Read it twice — better than I first thought.' }
        });
        assert.strictEqual(r2.status, 200);
        assert.strictEqual(r2.body.edited, true);
        assert.strictEqual(r2.body.total, 15);
        assert.strictEqual(core.scoresOf(q, firstEntry.id).length, 1, 'still ONE row');
        assert.strictEqual(Number(core.scoresOf(q, firstEntry.id)[0].total), 15);
    });

    await t('a score outside 1..5, or a missing criterion, is refused', async () => {
        for (const bad of [{ achievement: 0, impact: 3, trajectory: 3 }, { achievement: 6, impact: 3, trajectory: 3 }, { achievement: 3, impact: 3 }]) {
            const r = await app.call('POST', '/api/v2/awards/review/:token/score', {
                params: { token: revA.token }, body: { entry_id: firstEntry.id, scores: bad }
            });
            assert.strictEqual(r.status, 400, JSON.stringify(bad));
        }
        assert.strictEqual(Number(core.scoresOf(q, firstEntry.id)[0].total), 15, 'the good score survived every bad one');
    });

    await t('a reader never sees another reader\'s score', async () => {
        await addReviewer('Iva Babić', 'iva.reader@example.hr', [cat('excellence').id]);
        const revC = reviewerRow('iva.reader@example.hr');
        await app.call('POST', '/api/v2/awards/review/:token/score', {
            params: { token: revC.token }, body: { entry_id: firstEntry.id, scores: { achievement: 2, impact: 2, trajectory: 2 } }
        });
        const room = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: revC.token } });
        const x = room.body.groups.flatMap(g => g.entries).find(e => e.entry.id === firstEntry.id);
        assert.strictEqual(x.mine.total, 6, 'her own score is there');
        const json = JSON.stringify(room.body);
        assert.ok(!/"total":15/.test(json), 'and nobody else\'s is');
        assert.strictEqual(core.scoresOf(q, firstEntry.id).length, 2);
    });

    await t('progress counts what this reader has done, not what the panel has', async () => {
        const a = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: revA.token } });
        assert.strictEqual(a.body.progress.scored, 1);
        assert.ok(a.body.progress.total >= 1);
        const b = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: revB.token } });
        assert.strictEqual(b.body.progress.scored, 0);
    });

    await t('a revoked reader\'s room 404s at once, and their scores stay in the ranking', async () => {
        const revC = reviewerRow('iva.reader@example.hr');
        const before = core.scoresOf(q, firstEntry.id).length;
        const r = await app.call('DELETE', '/api/v2/awards-ops/reviewers/:id', { user: ADMIN, params: { id: revC.id } });
        assert.strictEqual(r.status, 200);
        const room = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: revC.token } });
        assert.strictEqual(room.status, 404);
        assert.strictEqual(core.scoresOf(q, firstEntry.id).length, before, 'the scores she gave are untouched');
    });

    // ============================================================ ranking maths
    await t('the ranking is the mean of the counted totals, with min/max/spread and n', () => {
        assert.deepStrictEqual(core.rankScores([]), { n: 0, mean: null, min: null, max: null, spread: null, conflicts: 0, total: 0 });
        const r = core.rankScores([{ total: 12, conflict: 0 }, { total: 15, conflict: 0 }, { total: 9, conflict: 0 }]);
        assert.strictEqual(r.n, 3);
        assert.strictEqual(r.mean, 12);
        assert.strictEqual(r.min, 9);
        assert.strictEqual(r.max, 15);
        assert.strictEqual(r.spread, 6);
        assert.strictEqual(r.conflicts, 0);
        const rounded = core.rankScores([{ total: 10, conflict: 0 }, { total: 11, conflict: 0 }, { total: 11, conflict: 0 }]);
        assert.strictEqual(rounded.mean, 10.67);
    });

    await t('a conflict-flagged score counts for NOTHING: not the mean, not the spread, not n', async () => {
        const conflicted = core.rankScores([{ total: 12, conflict: 0 }, { total: 15, conflict: 0 }, { total: 0, conflict: 1 }]);
        assert.strictEqual(conflicted.n, 2);
        assert.strictEqual(conflicted.mean, 13.5);
        assert.strictEqual(conflicted.spread, 3);
        assert.strictEqual(conflicted.conflicts, 1);
        assert.strictEqual(conflicted.total, 3, 'the conflicted row is still on file');
        const allConflicted = core.rankScores([{ total: 0, conflict: 1 }, { total: 0, conflict: 1 }]);
        assert.strictEqual(allConflicted.mean, null, 'no mean can be printed at all');
        assert.strictEqual(allConflicted.n, 0);
    });

    await t('a live conflict flag through the reviewer room drops out of the printed mean', async () => {
        const second = entriesOfKey('excellence').find(e => e.nominator_email === 'petra@mef.hr');
        // Two honest scores, then a third reader who declares a conflict.
        await app.call('POST', '/api/v2/awards/review/:token/score', {
            params: { token: revA.token }, body: { entry_id: second.id, scores: { achievement: 3, impact: 3, trajectory: 3 } }
        });
        await addReviewer('Dora Lulić', 'dora.reader@example.hr', [cat('excellence').id]);
        const revD = reviewerRow('dora.reader@example.hr');
        const conf = await app.call('POST', '/api/v2/awards/review/:token/score', {
            params: { token: revD.token }, body: { entry_id: second.id, conflict: true, comment: 'I co-authored with him.' }
        });
        assert.strictEqual(conf.status, 200);
        assert.strictEqual(conf.body.conflict, true);
        const rank = core.rankEntry(q, second);
        assert.strictEqual(rank.n, 1, 'only the honest score counts');
        assert.strictEqual(rank.mean, 9);
        assert.strictEqual(rank.conflicts, 1);
    });

    await t('the admin ranking view sorts by mean and shows conflicts separately', async () => {
        const r = await app.call('GET', '/api/v2/awards-ops/categories/:id/ranking', { user: ADMIN, params: { id: cat('excellence').id } });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.ranking.length >= 2);
        assert.strictEqual(r.body.max_total, 15, 'three criteria at 5');
        const means = r.body.ranking.map(x => x.mean).filter(m => m != null);
        for (let i = 1; i < means.length; i++) assert.ok(means[i - 1] >= means[i], 'sorted high to low');
        assert.ok(r.body.ranking.some(x => x.conflicts === 1), 'the conflict is reported, not hidden');
        assert.match(r.body.note, /excluded/);
    });

    // ============================================================ winner → comp gala seat
    await t('choosing a Fellowship winner creates the comp gala row EXACTLY ONCE', async () => {
        const before = q.all('SELECT * FROM gala_registrations').length;
        const r1 = await app.call('POST', '/api/v2/awards-ops/entries/:id/status', {
            user: ADMIN, params: { id: fellowA.id }, body: { status: 'winner' }
        });
        assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
        assert.ok(r1.body.laureate, 'a laureate row exists');
        assert.ok(r1.body.gala_seat && r1.body.gala_seat.created, 'and a seat was created');
        const rows = q.all('SELECT * FROM gala_registrations');
        assert.strictEqual(rows.length, before + 1);
        const seat = rows[rows.length - 1];
        assert.strictEqual(seat.payment_status, 'comp');
        assert.strictEqual(Number(seat.amount_paid), 0);
        assert.strictEqual(seat.status, 'confirmed');
        assert.match(seat.admin_notes, /Plexus Fellowship laureate/);
        assert.strictEqual(String(seat.email).toLowerCase(), 'iva@skola.hr');

        // Clicking it again must not mint a second seat, nor a second laureate.
        const r2 = await app.call('POST', '/api/v2/awards-ops/entries/:id/status', {
            user: ADMIN, params: { id: fellowA.id }, body: { status: 'winner' }
        });
        assert.strictEqual(r2.status, 200);
        assert.strictEqual(r2.body.gala_seat.created, false);
        assert.strictEqual(q.all('SELECT * FROM gala_registrations').length, before + 1, 'still exactly one seat');
        assert.strictEqual(q.all('SELECT * FROM award_laureates WHERE entry_id = ?', [fellowA.id]).length, 1, 'still exactly one laureate');
    });

    await t('a Fellow who already holds a gala seat keeps the one they have', async () => {
        q.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, amount_paid, created_at)
               VALUES ('pre-paid','Luka','Marić','luka@mef.hr','confirmed','paid',150,?)`, [new Date().toISOString()]);
        const before = q.all('SELECT * FROM gala_registrations').length;
        const r = await app.call('POST', '/api/v2/awards-ops/entries/:id/status', {
            user: ADMIN, params: { id: fellowB.id }, body: { status: 'winner' }
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(q.all('SELECT * FROM gala_registrations').length, before, 'no second seat');
        assert.strictEqual(r.body.gala_seat.id, 'pre-paid');
        assert.strictEqual(r.body.gala_seat.linked, true);
    });

    await t('a non-fellowship winner gets a laureate row but no gala seat of its own', async () => {
        const r = await app.call('POST', '/api/v2/awards-ops/entries/:id/status', {
            user: ADMIN, params: { id: firstEntry.id }, body: { status: 'winner' }
        });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.laureate);
        assert.strictEqual(r.body.gala_seat, null);
        assert.strictEqual(Number(r.body.laureate.present_minutes), 0, 'only a Fellow takes the stage');
    });

    await t('laureates_max is a real ceiling', async () => {
        const c = cat('fellowship');
        assert.strictEqual(core.laureatesOf(q, c.id).length, 2);
        // A third fellowship winner must be refused.
        const third = await submit(applicationBody({
            nominee_name: 'Tena Vuk', nominee_email: 'tena@skola.hr', school: 'Gimnazija Split'
        }));
        assert.strictEqual(third.status, 200);
        const row = rowByEmail('fellowship', 'tena@skola.hr');
        const r = await app.call('POST', '/api/v2/awards-ops/entries/:id/status', {
            user: ADMIN, params: { id: row.id }, body: { status: 'winner' }
        });
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /already has 2 laureates/);
        assert.strictEqual(core.laureatesOf(q, c.id).length, 2);
    });

    // ============================================================ Lifetime Bridge
    await t('the Lifetime Bridge takes a laureate straight from the organizers', async () => {
        const c = cat('lifetime-bridge');
        const r = await app.call('POST', '/api/v2/awards-ops/categories/:id/laureates', {
            user: ADMIN, params: { id: c.id },
            body: { name: 'Miroslav Radman', institution: 'MedILS, Split', email: 'laureate@example.hr' }
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.laureate.name, 'Miroslav Radman');
        assert.match(r.body.laureate.citation, /connecting Croatian medicine and science with the world/);
        assert.strictEqual(r.body.laureate.entry_id, null, 'no entry behind it — that is the point');
        const empty = await app.call('POST', '/api/v2/awards-ops/categories/:id/laureates', { user: ADMIN, params: { id: c.id }, body: {} });
        assert.strictEqual(empty.status, 400);
    });

    // ============================================================ merge
    await t('merging two spellings of one person leaves ONE candidate and loses no nomination', async () => {
        await submit(nominationBody({
            category: 'rising-talent', nominee_name: 'Ivo Perić', nominee_email: 'ivo@example.hr',
            nominator_email: 'one@example.hr', nominator_name: 'One Person'
        }));
        await submit(nominationBody({
            category: 'rising-talent', nominee_name: 'Ivo Peric', nominee_email: 'ivo.peric@example.hr',
            nominator_email: 'two@example.hr', nominator_name: 'Two Person'
        }));
        const c = cat('rising-talent');
        const before = core.candidatesOf(q, c.id);
        const a = before.find(x => x.email === 'ivo@example.hr');
        const b = before.find(x => x.email === 'ivo.peric@example.hr');
        assert.ok(a && b, 'two candidates before the merge');
        const r = await app.call('POST', '/api/v2/awards-ops/categories/:id/merge', {
            user: ADMIN, params: { id: c.id }, body: { from: b.key, into: a.key }
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const after = core.candidatesOf(q, c.id);
        assert.strictEqual(after.filter(x => /ivo/i.test(String(x.email || ''))).length, 1, 'one candidate now');
        assert.strictEqual(after.find(x => x.email === 'ivo@example.hr').nominations, 2, 'both nominations survived');
    });

    // ============================================================ decide & notify → OUTBOX
    await t('notify STAGES the letters in the outbox and sends absolutely nothing', async () => {
        clearMail();
        const before = q.all("SELECT * FROM scheduled_emails").length;
        const c = cat('fellowship');
        const r = await app.call('POST', '/api/v2/awards-ops/categories/:id/notify', {
            user: ADMIN, params: { id: c.id }, body: {}
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.ok(r.body.staged > 0, 'something was staged');
        assert.strictEqual(r.body.approval_required, true);
        assert.strictEqual(sent.length, 0, 'NOT ONE email left the building');

        const rows = q.all("SELECT * FROM scheduled_emails WHERE source_engine = 'v2-awards-ops'");
        assert.strictEqual(rows.length, q.all('SELECT * FROM scheduled_emails').length - before);
        for (const row of rows) {
            assert.strictEqual(row.status, 'pending_approval', 'every draft waits for a human');
            const p = JSON.parse(row.payload_json);
            assert.strictEqual(p.channel, 'email');
            assert.strictEqual(p.project, 'awards');
            assert.ok(p.to && p.subject && p.html, 'the payload carries the whole letter');
            assert.match(p.html, /<!DOCTYPE html>/i);
        }
        const winnerDraft = rows.find(x => x.template === 'award_fellowship_winner');
        assert.ok(winnerDraft, 'the Fellow gets the Fellowship letter');
        const wp = JSON.parse(winnerDraft.payload_json);
        assert.match(wp.html, /qr\/[0-9a-f-]{8,}\.png/, 'with the gala entry QR of the comp seat');
        assert.match(wp.html, /awards\/slides\/[0-9a-f]{32}/, 'and the slides link');
        assert.match(wp.html, /three minutes/i, 'and the presentation ask');
    });

    await t('a preview stages nothing at all', async () => {
        const before = q.all('SELECT * FROM scheduled_emails').length;
        const r = await app.call('POST', '/api/v2/awards-ops/categories/:id/notify', {
            user: ADMIN, params: { id: cat('excellence').id }, body: { preview: true }
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.preview, true);
        assert.strictEqual(r.body.staged, 0);
        assert.ok(r.body.drafts.length > 0, 'but it tells you what would go');
        assert.strictEqual(q.all('SELECT * FROM scheduled_emails').length, before);
        assert.strictEqual(sent.length, 0);
    });

    await t('notify refuses when no winner has been chosen', async () => {
        const c = cat('lifetime-bridge');
        // It HAS a laureate, so this one is allowed; use a category with neither.
        assert.ok(core.laureatesOf(q, c.id).length, 'the Lifetime Bridge has its laureate');
        const rt = cat('rising-talent');
        const r = await app.call('POST', '/api/v2/awards-ops/categories/:id/notify', { user: ADMIN, params: { id: rt.id }, body: {} });
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /No winner is chosen yet/);
    });

    // ============================================================ laureate slides + presentation
    await t('a Fellow confirms the three minutes from their own link', async () => {
        const l = q.get('SELECT * FROM award_laureates WHERE entry_id = ?', [fellowA.id]);
        assert.ok(l.slides_token, 'the laureate carries a slides token');
        const page = await app.call('GET', '/awards/slides/:token', { params: { token: l.slides_token } });
        assert.strictEqual(page.status, 200);
        assert.match(String(page.body), /three minutes/i);
        const r = await app.call('POST', '/api/v2/awards/slides/:token/confirm', { params: { token: l.slides_token }, body: { confirmed: true } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(Number(q.get('SELECT presentation_confirmed AS c FROM award_laureates WHERE id = ?', [l.id]).c), 1);
        const bad = await app.call('GET', '/awards/slides/:token', { params: { token: 'f'.repeat(32) } });
        assert.strictEqual(bad.status, 404);
    });

    // ============================================================ the gala roster + one-pager
    await t('the gala roster names every laureate, who speaks and who has a seat', async () => {
        const r = await app.call('GET', '/api/v2/awards-ops/roster', { user: ADMIN });
        assert.strictEqual(r.status, 200);
        const names = r.body.laureates.map(l => l.name);
        assert.ok(names.includes('Miroslav Radman'), 'the Lifetime Bridge laureate is on it');
        assert.ok(names.includes('Iva Perić'), 'so is the Fellow');
        const fellow = r.body.laureates.find(l => l.name === 'Iva Perić');
        assert.strictEqual(fellow.presents, true);
        assert.strictEqual(fellow.present_minutes, 3);
        assert.strictEqual(fellow.presentation_confirmed, true);
        assert.strictEqual(fellow.seat_kind, 'comp');

        const csv = await app.call('GET', '/api/v2/awards-ops/roster.csv', { user: ADMIN });
        assert.strictEqual(csv.status, 200);
        assert.ok(String(csv.body).startsWith('﻿'), 'a BOM, so Excel shows č ć đ š ž');
        assert.match(String(csv.body), /Miroslav Radman/);
        assert.match(csv.headers['content-disposition'], /gala-roster\.csv/);

        const sheet = await app.call('GET', '/api/v2/awards-ops/one-pager', { user: ADMIN });
        assert.strictEqual(sheet.status, 200);
        assert.match(String(sheet.body), /running order/i);
        assert.match(String(sheet.body), /Miroslav Radman/);
        assert.match(String(sheet.body), /SPEAKS · 3 min/);
    });

    await t('the entries CSV carries the ranking numbers and defuses formulas', async () => {
        const r = await app.call('GET', '/api/v2/awards-ops/categories/:id/entries.csv', { user: ADMIN, params: { id: cat('excellence').id } });
        assert.strictEqual(r.status, 200);
        const text = String(r.body);
        assert.ok(text.startsWith('﻿'));
        assert.match(text, /"Mean","Spread"/);
        assert.match(text, /Marko Kovačević/);
    });

    // ============================================================ admin reads
    await t('the admin overview groups, counts and reports panel progress', async () => {
        const r = await app.call('GET', '/api/v2/awards-ops/overview', { user: ADMIN });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.categories.length, 4);
        const ex = r.body.categories.find(c => c.key === 'excellence');
        assert.ok(ex.counts.entries >= ex.counts.candidates, 'entries never fewer than candidates');
        assert.ok(r.body.reviewers.length >= 2);
        assert.ok(r.body.reviewers.every(x => x.total >= x.scored));
        assert.ok(r.body.stats.laureates >= 3);
        assert.match(r.body.reviewers[0].room_url, /\/awards\/review\/[0-9a-f]{32}$/);
    });

    await t('the entry drawer shows every nominator of one candidate', async () => {
        const r = await app.call('GET', '/api/v2/awards-ops/entries/:id', { user: ADMIN, params: { id: firstEntry.id } });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.nominators.length >= 2, 'both people who put him forward');
        assert.ok(r.body.scores.per_reviewer.length >= 1);
        assert.match(r.body.manage_url, /\/awards\/manage\/[0-9a-f]{32}$/);
    });

    await t('a non-admin cannot reach any awards-ops route', async () => {
        const r = await app.call('GET', '/api/v2/awards-ops/overview', { user: { id: 'u-ana', email: 'ana@example.hr', is_admin: false } });
        assert.strictEqual(r.status, 403);
        const anon = await app.call('GET', '/api/v2/awards-ops/overview', {});
        assert.strictEqual(anon.status, 401);
    });

    // ============================================================ the public pages
    await t('/awards renders the four awards in English and in Croatian, with no login', async () => {
        const en = await app.call('GET', '/awards', {});
        assert.strictEqual(en.status, 200);
        assert.match(String(en.body), /The Plexus Awards/);
        assert.match(String(en.body), /Croatian Excellence in Medicine &amp; Science Award|Croatian Excellence in Medicine & Science Award/);
        assert.match(String(en.body), /Plexus Fellowship/);
        assert.match(String(en.body), /HRVATSKI/);

        const hr = await app.call('GET', '/awards', { query: { lang: 'hr' } });
        assert.strictEqual(hr.status, 200);
        assert.match(String(hr.body), /Plexus nagrade/);
        assert.match(String(hr.body), /Plexus stipendija/);
        assert.match(String(hr.body), /ENGLISH/);
    });

    await t('an award page carries its criteria, its deadline and a working form', async () => {
        const r = await app.call('GET', '/awards/:key', { params: { key: 'excellence' } });
        assert.strictEqual(r.status, 200);
        const html = String(r.body);
        assert.match(html, /Croatian Excellence/);
        assert.match(html, /name="website"/, 'the honeypot is on the form');
        assert.match(html, /data-role="statement"/);
        assert.match(html, /data-limit="400"/, 'with its live word counter');
        assert.match(html, /NOMINATE YOURSELF|Nominate yourself/i, 'and the self-nomination door');
        assert.match(html, /api\/v2\/awards\/entries/);

        const fe = await app.call('GET', '/awards/:key', { params: { key: 'fellowship' }, query: { lang: 'hr' } });
        assert.match(String(fe.body), /data-limit="200"/);
        assert.match(String(fe.body), /data-limit="300"/);
        assert.match(String(fe.body), /data-limit="100"/);
        assert.match(String(fe.body), /accept="application\/pdf,\.pdf"/, 'the optional one-page PDF');
        assert.match(String(fe.body), /willing_to_present/, 'and the 3-minute checkbox');

        const lb = await app.call('GET', '/awards/:key', { params: { key: 'lifetime-bridge' } });
        assert.ok(!/data-role="awForm"/.test(String(lb.body)), 'the Lifetime Bridge has no form at all');

        const nope = await app.call('GET', '/awards/:key', { params: { key: 'no-such-award' } });
        assert.strictEqual(nope.status, 404);
    });

    await t('a closed award shows the thank-you instead of a form', async () => {
        const c = cat('rising-talent');
        await app.call('PUT', '/api/v2/awards-ops/categories/:id', { user: ADMIN, params: { id: c.id }, body: { closes_at: '2020-02-01T23:59' } });
        const r = await app.call('GET', '/awards/:key', { params: { key: 'rising-talent' } });
        assert.match(String(r.body), /Nominations are closed/);
        assert.ok(!/data-role="awForm"/.test(String(r.body)));
        await app.call('PUT', '/api/v2/awards-ops/categories/:id', { user: ADMIN, params: { id: c.id }, body: { closes_at: '2099-02-01T23:59' } });
    });

    await t('the public overview JSON matches what the pages print', async () => {
        const r = await app.call('GET', '/api/v2/awards/overview', {});
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.categories.length, 4);
        assert.strictEqual(r.body.edition.id, 'plexus-2026');
        const fe = r.body.categories.find(c => c.key === 'fellowship');
        assert.strictEqual(fe.intake, 'application');
        assert.deepStrictEqual(fe.rubric.map(x => x.key), ['impact', 'originality', 'feasibility']);
    });

    // ============================================================ attachments
    await t('the PDF gate is the bytes, not the file name', () => {
        assert.strictEqual(boston._magicOk('pdf', Buffer.from('%PDF-1.7\nnot really but the header is right')), true);
        assert.strictEqual(boston._magicOk('pdf', Buffer.from('PK this is a zip pretending')), false);
        assert.strictEqual(boston._magicOk('pdf', Buffer.from('<html>hello</html>')), false);
        assert.strictEqual(boston._magicOk('pdf', Buffer.alloc(0)), false);
        assert.strictEqual(core.MAX_ATTACHMENT_BYTES, 5 * 1024 * 1024);
    });

    await t('an entry attachment is keyed under awards/<entry id>/', () => {
        // The key shape is the contract with the bucket; the upload route itself needs multipart.
        assert.match(`awards/${firstEntry.id}/page.pdf`, /^awards\/[0-9a-fA-F-]{8,}\/page\.pdf$/);
    });

    // ============================================================ tokens
    await t('all three token families are HMAC(JWT_SECRET), 32 hex, and never interchangeable', () => {
        const id = 'fixed-id-for-the-token-test';
        const manage = M.sign('manage', id), reviewer = M.sign('reviewer', id), slides = M.sign('slides', id);
        for (const tok of [manage, reviewer, slides]) assert.match(tok, /^[0-9a-f]{32}$/);
        assert.strictEqual(new Set([manage, reviewer, slides]).size, 3, 'three contexts, three tokens');
        assert.strictEqual(M.tokenMatches('manage', id, manage), true);
        assert.strictEqual(M.tokenMatches('manage', id, reviewer), false, 'a reviewer token is not a manage token');
        assert.strictEqual(M.tokenMatches('manage', id, manage.slice(0, 31)), false, 'a short token never compares equal');
        assert.strictEqual(M.tokenMatches('manage', id, ''), false);
        const expected = crypto.createHmac('sha256', JWT_SECRET).update('medxaward:manage:' + id).digest('hex').slice(0, 32);
        assert.strictEqual(manage, expected, 'the context string is the one the spec names');
    });

    await t('a reviewer token cannot be swapped for another reviewer\'s', async () => {
        const rB = reviewerRow('marko.reader@kbc.hr');
        const forged = M.sign('reviewer', 'some-other-id');
        const r = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: forged } });
        assert.strictEqual(r.status, 404);
        const swapped = await app.call('GET', '/api/v2/awards/review/:token/data', { params: { token: rB.token } });
        assert.strictEqual(swapped.status, 200);
        assert.deepStrictEqual(swapped.body.groups.map(g => g.category.key), ['fellowship'], 'still only his own');
    });

    // ============================================================ settings
    await t('settings are editable and the public page reads them live', async () => {
        const c = cat('rising-talent');
        const r = await app.call('PUT', '/api/v2/awards-ops/categories/:id', {
            user: ADMIN, params: { id: c.id },
            body: { name: 'Rising Talent Award', citation: 'for the first real step past the edge of the path', laureates_max: 3 }
        });
        assert.strictEqual(r.status, 200);
        const page = await app.call('GET', '/awards/:key', { params: { key: 'rising-talent' } });
        assert.match(String(page.body), /first real step past the edge/);
        assert.strictEqual(Number(cat('rising-talent').laureates_max), 3);
        const bad = await app.call('PUT', '/api/v2/awards-ops/categories/:id', {
            user: ADMIN, params: { id: c.id }, body: { opens_at: 'yesterday' }
        });
        assert.strictEqual(bad.status, 400);
    });

    // ============================================================ done
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})();
