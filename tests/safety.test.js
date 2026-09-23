/**
 * tests/safety.test.js — REPORT + BLOCK (App Store guideline 1.2): user-portal/backend/v2/safety.js,
 * the block gates in v2/network.js + v2/messages.js, the legacy send guards in user-portal/backend/server.js,
 * and the operator queue admin-portal/backend/v2/safety-ops.js. Shared vocabulary: shared/safety-core.js.
 *
 * PART 1 — hermetic, in the house pattern (tests/notes.test.js): stub express apps collect routes, ONE
 * in-memory libsql database carries the legacy tables the modules read, and each module is mounted exactly
 * as v2/index.js does. The sendEmail handed to every module throws and counts — the test asserts it is
 * never touched. global.fetch throws.
 * PART 2 — end-to-end on a SCRATCH file (tests/member-audit-fixes.test.js pattern): the member portal boots
 * alone on a throwaway SQLite with no Turso, no mail provider, no Stripe, no FIRA and no Cloudinary, under a
 * preload (written to the scratch dir) that refuses every outbound socket and fetch except localhost. The run
 * ABORTS if user-portal/backend/.env exists (its loader would fill the blanked keys). fetch in this process is
 * limited to that localhost server. Nothing here can reach production.
 *
 * Covers: report create · validation · 24 h dedupe · rate limit · message reports (received only, member↔member
 * only, legacy email-keyed rows, target_type alias, any received message) · the evidence copy (message or bio +
 * up to 10 earlier messages) and that it survives the reported member deleting the account · block / unblock ·
 * the connection ends with a block · directory, search and suggestions both directions · the blocker's inbox +
 * unread count (legacy email-keyed rows too) · peer card · the Med&X team can never be blocked · admin list /
 * counts / update / reopen / hide profile · moderation: a team hide sticks against the member's own PATCH / PUT,
 * suspend → 403 and out of every list, a removed message is gone from every member read · the content filter
 * (messages 422, profile 422) · every legacy request / list route across a block (badge scan, meetings, meeting
 * requests, mentorship, intros + intro dedupe, connections + pending, global member search, Plexus attendees)
 * · audit rows · auth guards. Round 3 (2026-09-23): the filter's must-pass list (everyday "shoot you an email",
 * "I know where you work", "gole brojke") and direct-abuse / look-alike spellings; every profile text other members
 * read (sign-up name and institution, v2 institution / city / country / specialties, networking research
 * interests, the Forum profile) with the field named; the legacy Forum v1 writes and feed; the suspended code;
 * the network summary counts; the Forum hits' account id; REMOVE one listed message / every message from the
 * member, CLEAR PROFILE (photo, bio, title, tags) and the evidence ids and profile snapshot.
 *
 * Run:  node tests/safety.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
if (fs.existsSync(path.join(ROOT, 'user-portal/backend/.env'))) {
    console.error('ABORT: user-portal/backend/.env exists — its loader would fill the blanked keys (Turso, mail). Move it away to run this test.');
    process.exit(2);
}
process.env.NODE_ENV = 'test';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.CLOUDINARY_URL;

const realFetch = global.fetch;
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'user-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));
const core = require(path.join(ROOT, 'shared/safety-core'));

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

function stubApp() {
    const routes = {};
    const reg = m => (p, ...h) => { routes[m + ' ' + p] = h; };
    return {
        get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), delete: reg('DELETE'), use() {},
        routes,
        async call(method, p, opts = {}) {
            const chain = routes[method + ' ' + p];
            if (!chain) throw new Error('route not mounted: ' + method + ' ' + p);
            const req = { user: opts.user === undefined ? null : opts.user, params: opts.params || {}, query: opts.query || {}, body: opts.body || {}, headers: {}, ip: '10.0.0.1', path: p, protocol: 'https', get: () => 'portal.test' };
            const r = { status: 200, body: undefined };
            let ended = false;
            const res = {
                status(c) { r.status = c; return res; },
                json(o) { r.body = o; ended = true; return res; },
                send(x) { r.body = x; ended = true; return res; },
                set() { return res; }, setHeader() {},
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

// ---------------------------------------------------------------- the legacy tables the modules read
const db = createDatabase(Database, { localPath: ':memory:' });
[
    `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, first_name TEXT, last_name TEXT, institution TEXT, country TEXT, bio TEXT,
        photo_url TEXT, is_admin INTEGER DEFAULT 0, is_public_profile INTEGER DEFAULT 1, email_verified INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT, locale TEXT)`,
    `CREATE TABLE user_profiles (user_id TEXT PRIMARY KEY, title TEXT, department TEXT, research_interests TEXT, career_stage TEXT, is_profile_public INTEGER DEFAULT 1)`,
    `CREATE TABLE networking_profiles (id TEXT PRIMARY KEY, user_id TEXT, research_interests TEXT, career_stage TEXT, looking_for TEXT, working_on TEXT)`,
    `CREATE TABLE forum_members (id TEXT PRIMARY KEY, user_id TEXT, membership_status TEXT, specialty TEXT, sub_specialties TEXT, institution TEXT, position TEXT, department TEXT,
        location_city TEXT, location_country TEXT, research_interests TEXT, profile_visibility TEXT)`,
    `CREATE TABLE conferences (id TEXT PRIMARY KEY, name TEXT, year INTEGER, is_active INTEGER DEFAULT 1, start_date TEXT)`,
    `CREATE TABLE registrations (id TEXT PRIMARY KEY, user_id TEXT, conference_id TEXT, email TEXT, status TEXT, revoked INTEGER DEFAULT 0)`,
    `CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, user_id TEXT, email TEXT, status TEXT)`,
    `CREATE TABLE bridges_registrations (id TEXT PRIMARY KEY, user_id TEXT, email TEXT, status TEXT)`,
    `CREATE TABLE accelerator_applications (id TEXT PRIMARY KEY, user_id TEXT, email TEXT, status TEXT, decision TEXT)`,
    `CREATE TABLE member_meta (user_id TEXT PRIMARY KEY, member_type TEXT)`,
    `CREATE TABLE networking_connections (id TEXT PRIMARY KEY, requester_id TEXT, receiver_id TEXT, status TEXT DEFAULT 'pending', message TEXT, accepted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE direct_messages (id TEXT PRIMARY KEY, sender_id TEXT, receiver_id TEXT, sender_type TEXT DEFAULT 'user', receiver_type TEXT DEFAULT 'user', title TEXT, content TEXT,
        attachment_url TEXT, is_read INTEGER DEFAULT 0, read_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
].forEach(sql => db.run(sql));

function step(sql, params, many) { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) { out.push(st.getAsObject()); if (!many) break; } st.free(); return many ? out : (out[0] || null); }
const q = { run: (sql, p) => (p && p.length ? db.run(sql, p) : db.run(sql)), get: (sql, p) => step(sql, p, false), all: (sql, p) => step(sql, p, true) };

const U = { ana: 'u-ana', bruno: 'u-bruno', cvita: 'u-cvita', dora: 'u-dora', team: 'u-team' };
const addUser = (id, first, last, extra = {}) => q.run(`INSERT INTO users (id, email, first_name, last_name, institution, is_admin, created_at) VALUES (?,?,?,?,?,?, datetime('now','-90 days'))`,
    [id, (extra.email || (first + '.' + last + '@example.com')).toLowerCase(), first, last, extra.institution || 'Test Institute', extra.admin ? 1 : 0]);
addUser(U.ana, 'Ana', 'Anić', { institution: 'KBC Zagreb' });
addUser(U.bruno, 'Bruno', 'Brnić', { institution: 'KBC Split' });
addUser(U.cvita, 'Cvita', 'Cvitić');
addUser(U.dora, 'Dora', 'Dorić');
addUser(U.team, 'Laura', 'Team', { admin: true, email: 'laura.team@medx.hr' });
for (let i = 1; i <= 11; i++) addUser('u-extra-' + i, 'Extra' + i, 'Member');
q.run(`INSERT INTO conferences (id, name, year, is_active, start_date) VALUES ('c26', 'Plexus Week 2026', 2026, 1, '2026-12-04')`);
// Ana ↔ Bruno connected, Bruno → Cvita pending, Ana ↔ Cvita connected
q.run(`INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES ('nc-ab', ?, ?, 'accepted')`, [U.ana, U.bruno]);
q.run(`INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES ('nc-ac', ?, ?, 'accepted')`, [U.ana, U.cvita]);
q.run(`INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES ('nc-bc', ?, ?, 'pending')`, [U.bruno, U.cvita]);
// messages: Bruno → Ana (unread), Ana → Bruno, Cvita → Ana, a team reply to Ana, and a LEGACY row keyed by Bruno's email
q.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, created_at) VALUES ('dm-ba-1', ?, ?, 'Hi Ana — buy followers cheap!!!', datetime('now','-2 hours'))`, [U.bruno, U.ana]);
q.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, created_at, read_at) VALUES ('dm-ab-1', ?, ?, 'Please stop.', datetime('now','-1 hours'), datetime('now'))`, [U.ana, U.bruno]);
q.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, created_at) VALUES ('dm-ca-1', ?, ?, 'Coffee at Plexus?', datetime('now','-30 minutes'))`, [U.cvita, U.ana]);
q.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, sender_type, receiver_type, content, created_at) VALUES ('dm-team-1', ?, ?, 'admin', 'user', 'Your ticket is ready.', datetime('now','-3 hours'))`, [U.team, U.ana]);
q.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, created_at) VALUES ('dm-legacy-1', ?, ?, 'old row keyed by email', datetime('now','-5 days'))`, ['bruno.brnić@example.com', U.ana]);

// ---------------------------------------------------------------- mount (member side + admin side, same database)
let emailCalls = 0;
const sendEmail = () => { emailCalls++; throw new Error('EMAIL IS NOT PART OF REPORT/BLOCK'); };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-safety-'));
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentication required' }));
const adminOnly = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admin only' }));
const member = stubApp(), admin = stubApp();
const mctx = { db: () => db, auth, adminOnly, optionalAuth: (req, res, next) => next(), sendEmail, JWT_SECRET: 'safety-test', ROOT: tmpRoot, log: () => {} };
for (const f of ['messages.js', 'network.js', 'profile.js', 'safety.js']) require(path.join(ROOT, 'user-portal/backend/v2', f))(member, mctx);
require(path.join(ROOT, 'admin-portal/backend/v2/safety-ops.js'))(admin, { db: () => db, auth, adminOnly, sendEmail, saveDb: () => {}, JWT_SECRET: 'safety-test', ROOT: tmpRoot, log: () => {} });

const as = {};
for (const [k, id] of Object.entries(U)) { const u = q.get('SELECT id, email, is_admin FROM users WHERE id = ?', [id]); as[k] = { id: u.id, email: u.email, is_admin: u.is_admin }; }
as.extra = i => ({ id: 'u-extra-' + i, email: ('extra' + i + '.member@example.com'), is_admin: 0 });
const M = (m, p, user, opts = {}) => member.call(m, p, Object.assign({ user }, opts));
const A = (m, p, user, opts = {}) => admin.call(m, p, Object.assign({ user }, opts));
const report = (user, body) => M('POST', '/api/v2/safety/report', user, { body });
const dirNames = async (user) => (await M('GET', '/api/v2/network/directory', user, { query: { size: '50' } })).body.results.map(r => r.id);
const searchIds = async (user, qs) => (await M('GET', '/api/v2/network/search', user, { query: { q: qs } })).body.results.map(r => r.id);
const suggIds = async (user) => (await M('GET', '/api/v2/network/suggestions', user, { query: { limit: '24' } })).body.results.map(r => r.id);
const threadKeys = async (user) => (await M('GET', '/api/v2/messages/threads', user)).body.threads.map(x => x.key);

async function part1() {
    console.log('safety.test.js PART 1 — hermetic (stub express, one in-memory libsql DB, sendEmail throws, fetch disabled)\n');
    let reportMember = null, reportMsg = null;

    await t('every route is mounted; both tables exist; the block pair is UNIQUE', () => {
        for (const k of ['POST /api/v2/safety/report', 'POST /api/v2/safety/block', 'DELETE /api/v2/safety/block/:userId', 'GET /api/v2/safety/blocks']) assert.ok(member.routes[k], 'member ' + k);
        for (const k of ['GET /api/v2/safety/reports', 'PUT /api/v2/safety/reports/:id', 'POST /api/v2/safety/members/:userId/hide-profile']) assert.ok(admin.routes[k], 'admin ' + k);
        for (const tbl of ['v2_reports', 'v2_blocks']) assert.ok(q.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tbl]), tbl);
        q.run("INSERT INTO v2_blocks (blocker_user_id, blocked_user_id) VALUES ('x1','x2')");
        assert.throws(() => q.run("INSERT INTO v2_blocks (blocker_user_id, blocked_user_id) VALUES ('x1','x2')"), /UNIQUE/);
        q.run("DELETE FROM v2_blocks WHERE blocker_user_id = 'x1'");
    });

    await t('schema creation is idempotent — mounting a second time changes nothing and throws nothing', () => {
        const before = q.all("SELECT name, sql FROM sqlite_master WHERE name LIKE 'v2_%' OR name LIKE 'idx_v2_%' ORDER BY name");
        require(path.join(ROOT, 'user-portal/backend/v2/safety.js'))(stubApp(), mctx);
        require(path.join(ROOT, 'admin-portal/backend/v2/safety-ops.js'))(stubApp(), { db: () => db, auth, adminOnly, saveDb: () => {}, log: () => {} });
        core.ensureSchema(db);
        assert.deepStrictEqual(q.all("SELECT name, sql FROM sqlite_master WHERE name LIKE 'v2_%' OR name LIKE 'idx_v2_%' ORDER BY name"), before);
    });

    await t('auth guards: member routes 401 without a session; admin routes 401 / 403 for a member', async () => {
        assert.strictEqual((await report(null, { target_kind: 'member', target_id: U.bruno, reason: 'spam' })).status, 401);
        assert.strictEqual((await M('POST', '/api/v2/safety/block', null, { body: { user_id: U.bruno } })).status, 401);
        assert.strictEqual((await M('DELETE', '/api/v2/safety/block/:userId', null, { params: { userId: U.bruno } })).status, 401);
        assert.strictEqual((await M('GET', '/api/v2/safety/blocks', null)).status, 401);
        assert.strictEqual((await A('GET', '/api/v2/safety/reports', null)).status, 401);
        assert.strictEqual((await A('GET', '/api/v2/safety/reports', as.ana)).status, 403);
        assert.strictEqual((await A('PUT', '/api/v2/safety/reports/:id', as.ana, { params: { id: 'x' }, body: { status: 'dismissed' } })).status, 403);
        assert.strictEqual((await A('POST', '/api/v2/safety/members/:userId/hide-profile', as.ana, { params: { userId: U.bruno } })).status, 403);
    });

    await t('report validation: kind, target, reason, note length, yourself, unknown member', async () => {
        const bad = async (body, code, re) => { const r = await report(as.ana, body); assert.strictEqual(r.status, code, JSON.stringify(r.body)); if (re) assert.match(r.body.error, re); };
        await bad({ target_kind: 'profile', target_id: U.bruno, reason: 'spam' }, 400, /member or a message/);
        await bad({ target_kind: 'member', target_id: '', reason: 'spam' }, 400, /missing/);
        await bad({ target_kind: 'member', target_id: U.bruno, reason: 'rude' }, 400, /Pick what is wrong/);
        await bad({ target_kind: 'member', target_id: U.bruno }, 400, /Pick what is wrong/);
        await bad({ target_kind: 'member', target_id: U.bruno, reason: 'spam', note: 'x'.repeat(501) }, 400, /500/);
        await bad({ target_kind: 'member', target_id: U.ana, reason: 'spam' }, 400, /yourself/);
        await bad({ target_kind: 'member', target_id: 'u-nobody', reason: 'spam' }, 404, /could not be found/);
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM v2_reports').n, 0, 'nothing stored on a refused report');
    });

    await t('report a MEMBER: stored open, trimmed note, target_user_id = the member; exactly 500 chars is fine', async () => {
        const r = await report(as.ana, { target_kind: 'member', target_id: U.bruno, reason: 'Harassment', note: '  Keeps messaging after I asked him to stop.  ' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.duplicate, false);
        reportMember = r.body.id;
        const row = q.get('SELECT * FROM v2_reports WHERE id = ?', [reportMember]);
        assert.strictEqual(row.reporter_user_id, U.ana);
        assert.strictEqual(row.target_kind, 'member');
        assert.strictEqual(row.target_user_id, U.bruno);
        assert.strictEqual(row.reason, 'harassment');
        assert.strictEqual(row.status, 'open');
        assert.strictEqual(row.note, 'Keeps messaging after I asked him to stop.');
        const long = await report(as.cvita, { target_kind: 'member', target_id: U.dora, reason: 'other', note: 'y'.repeat(500) });
        assert.strictEqual(long.status, 200, JSON.stringify(long.body));
    });

    await t('dedupe: the same reporter + target inside 24 h answers the existing report; after 24 h a new one is filed', async () => {
        const again = await report(as.ana, { target_kind: 'member', target_id: U.bruno, reason: 'spam' });
        assert.strictEqual(again.status, 200);
        assert.strictEqual(again.body.duplicate, true);
        assert.strictEqual(again.body.id, reportMember);
        assert.strictEqual(q.get("SELECT COUNT(*) AS n FROM v2_reports WHERE reporter_user_id = ? AND target_id = ?", [U.ana, U.bruno]).n, 1);
        // a different reporter about the same member is a separate report
        const other = await report(as.cvita, { target_kind: 'member', target_id: U.bruno, reason: 'spam' });
        assert.strictEqual(other.body.duplicate, false);
        // age Ana's report past the window → a fresh one lands
        q.run("UPDATE v2_reports SET created_at = datetime('now','-25 hours') WHERE id = ?", [reportMember]);
        const later = await report(as.ana, { target_kind: 'member', target_id: U.bruno, reason: 'spam' });
        assert.strictEqual(later.body.duplicate, false);
        assert.notStrictEqual(later.body.id, reportMember);
        q.run('DELETE FROM v2_reports WHERE id = ?', [later.body.id]);   // keep the admin counts below simple
        q.run("UPDATE v2_reports SET created_at = datetime('now','-1 hours') WHERE id = ?", [reportMember]);
    });

    await t('report a MESSAGE: only one you received, only member↔member; the sender (legacy email key too) is the target', async () => {
        const r = await report(as.ana, { target_kind: 'message', target_id: 'dm-ba-1', reason: 'spam', note: 'scam link' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        reportMsg = r.body.id;
        const row = q.get('SELECT target_user_id, evidence_text, evidence_meta FROM v2_reports WHERE id = ?', [reportMsg]);
        assert.strictEqual(row.target_user_id, U.bruno);
        // the evidence copy: the message itself + the earlier messages Bruno sent Ana (the legacy email-keyed one too)
        assert.strictEqual(row.evidence_text, 'Hi Ana — buy followers cheap!!!');
        const meta = JSON.parse(row.evidence_meta);
        assert.strictEqual(meta.sender_name, 'Bruno Brnić');
        assert.strictEqual(meta.sender_email, 'bruno.brnić@example.com');
        assert.ok(meta.created_at);
        assert.deepStrictEqual(meta.context.map(c => c.text), ['old row keyed by email']);
        assert.strictEqual((await report(as.ana, { target_kind: 'message', target_id: 'dm-ab-1', reason: 'spam' })).status, 404, 'your own message');
        assert.strictEqual((await report(as.cvita, { target_kind: 'message', target_id: 'dm-ba-1', reason: 'spam' })).status, 404, 'not a participant');
        assert.strictEqual((await report(as.ana, { target_kind: 'message', target_id: 'dm-team-1', reason: 'spam' })).status, 404, 'team messages are not member content');
        assert.strictEqual((await report(as.ana, { target_kind: 'message', target_id: 'dm-nope', reason: 'spam' })).status, 404);
        const legacy = await report(as.ana, { target_kind: 'message', target_id: 'dm-legacy-1', reason: 'inappropriate' });
        assert.strictEqual(legacy.status, 200, JSON.stringify(legacy.body));
        assert.strictEqual(q.get('SELECT target_user_id FROM v2_reports WHERE id = ?', [legacy.body.id]).target_user_id, U.bruno, 'email-keyed sender resolves to users.id');
    });

    await t('rate limit: 10 new reports in an hour, the 11th is 429 — a repeat of an existing one still answers 200', async () => {
        const d = as.dora;
        for (let i = 1; i <= 10; i++) {
            const r = await report(d, { target_kind: 'member', target_id: 'u-extra-' + i, reason: 'spam' });
            assert.strictEqual(r.status, 200, 'report ' + i + ' ' + JSON.stringify(r.body));
        }
        const eleventh = await report(d, { target_kind: 'member', target_id: 'u-extra-11', reason: 'spam' });
        assert.strictEqual(eleventh.status, 429);
        assert.match(eleventh.body.error, /try again/);
        const repeat = await report(d, { target_kind: 'member', target_id: 'u-extra-3', reason: 'spam' });
        assert.strictEqual(repeat.status, 200);
        assert.strictEqual(repeat.body.duplicate, true);
        // an hour later the window has moved
        q.run("UPDATE v2_reports SET created_at = datetime('now','-61 minutes') WHERE reporter_user_id = ?", [U.dora]);
        assert.strictEqual((await report(d, { target_kind: 'member', target_id: 'u-extra-11', reason: 'spam' })).status, 200);
        q.run("UPDATE v2_reports SET status = 'dismissed' WHERE reporter_user_id = ?", [U.dora]);   // out of the open queue below
    });

    await t('before any block: Ana and Bruno find each other (directory, search) and share a thread', async () => {
        assert.ok((await dirNames(as.ana)).includes(U.bruno));
        assert.ok((await dirNames(as.bruno)).includes(U.ana));
        assert.ok((await searchIds(as.ana, 'Bruno')).includes(U.bruno));
        assert.ok((await searchIds(as.bruno, 'Ana')).includes(U.ana));
        assert.ok((await threadKeys(as.ana)).includes(U.bruno));
        assert.strictEqual((await M('GET', '/api/v2/messages/unread-count', as.ana)).body.direct, 3, 'Bruno + Cvita + the legacy row');
    });

    await t('a legacy row keyed by the sender\'s EMAIL joins that member\'s thread (one thread per person, blockable by id)', async () => {
        const threads = (await M('GET', '/api/v2/messages/threads', as.ana)).body.threads;
        assert.ok(!threads.some(x => String(x.key).includes('@')), 'no email-keyed thread');
        const bruno = threads.find(x => x.key === U.bruno);
        assert.strictEqual(bruno.count, 3, 'dm-legacy-1 + dm-ba-1 + dm-ab-1');
        assert.strictEqual(bruno.gone, false);
        assert.strictEqual(bruno.first_name, 'Bruno');
    });

    await t('the Med&X team can never be blocked: the team thread key, an admin account; self and unknown refused', async () => {
        const r1 = await M('POST', '/api/v2/safety/block', as.ana, { body: { user_id: 'team' } });
        assert.strictEqual(r1.status, 400); assert.match(r1.body.error, /Med&X team/);
        const r2 = await M('POST', '/api/v2/safety/block', as.ana, { body: { user_id: 'TEAM' } });
        assert.strictEqual(r2.status, 400);
        const r3 = await M('POST', '/api/v2/safety/block', as.ana, { body: { user_id: U.team } });
        assert.strictEqual(r3.status, 400); assert.match(r3.body.error, /Med&X team/);
        assert.strictEqual((await M('POST', '/api/v2/safety/block', as.ana, { body: { user_id: U.ana } })).status, 400);
        assert.strictEqual((await M('POST', '/api/v2/safety/block', as.ana, { body: {} })).status, 400);
        assert.strictEqual((await M('POST', '/api/v2/safety/block', as.ana, { body: { user_id: 'u-nobody' } })).status, 404);
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM v2_blocks').n, 0);
        assert.strictEqual((await threadKeys(as.ana))[0], 'team', 'the team thread stays first');
    });

    await t('Ana blocks Bruno: stored once, the connection between them ends, a repeat is idempotent, GET blocks lists him', async () => {
        const r = await M('POST', '/api/v2/safety/block', as.ana, { body: { user_id: U.bruno } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.already, false);
        assert.strictEqual(r.body.disconnected, 1);
        assert.deepStrictEqual(r.body.member, { id: U.bruno, name: 'Bruno Brnić' });
        assert.strictEqual(q.get("SELECT COUNT(*) AS n FROM networking_connections WHERE id = 'nc-ab'").n, 0, 'Ana↔Bruno connection ended');
        assert.strictEqual(q.get("SELECT COUNT(*) AS n FROM networking_connections WHERE id = 'nc-bc'").n, 1, 'Bruno↔Cvita untouched');
        const again = await M('POST', '/api/v2/safety/block', as.ana, { body: { userId: U.bruno } });
        assert.strictEqual(again.body.already, true);
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM v2_blocks').n, 1);
        const list = await M('GET', '/api/v2/safety/blocks', as.ana);
        assert.strictEqual(list.body.blocks.length, 1);
        assert.strictEqual(list.body.blocks[0].user_id, U.bruno);
        assert.strictEqual(list.body.blocks[0].name, 'Bruno Brnić');
        assert.strictEqual(list.body.blocks[0].institution, 'KBC Split');
        assert.strictEqual((await M('GET', '/api/v2/safety/blocks', as.bruno)).body.blocks.length, 0, 'the blocked member has no list entry');
    });

    await t('shared core: isBlockedPair is true in BOTH directions and false for anyone else', () => {
        assert.strictEqual(core.isBlockedPair(db, U.ana, U.bruno), true);
        assert.strictEqual(core.isBlockedPair(db, U.bruno, U.ana), true);
        assert.strictEqual(core.isBlockedPair(db, U.ana, U.cvita), false);
        assert.strictEqual(core.isBlockedPair(db, U.ana, U.ana), false);
        assert.deepStrictEqual([...core.blockedByMe(db, U.ana)], [U.bruno]);
        assert.deepStrictEqual([...core.blockedByMe(db, U.bruno)], []);
        assert.deepStrictEqual([...core.blockedEitherWay(db, U.bruno)], [U.ana]);
    });

    await t('directory, search and suggestions hide the pair from EACH OTHER — everyone else still sees both', async () => {
        assert.ok(!(await dirNames(as.ana)).includes(U.bruno), 'blocker directory');
        assert.ok(!(await dirNames(as.bruno)).includes(U.ana), 'blocked directory');
        assert.deepStrictEqual(await searchIds(as.ana, 'Bruno'), []);
        assert.deepStrictEqual(await searchIds(as.bruno, 'Ana Anić'), []);
        assert.ok(!(await suggIds(as.ana)).includes(U.bruno), 'no longer connected, still never suggested');
        assert.ok(!(await suggIds(as.bruno)).includes(U.ana));
        const c = await dirNames(as.cvita);
        assert.ok(c.includes(U.ana) && c.includes(U.bruno), 'a third member is unaffected');
        const sumA = (await M('GET', '/api/v2/network/summary', as.ana)).body, sumC = (await M('GET', '/api/v2/network/summary', as.cvita)).body;
        assert.strictEqual(sumA.members, sumC.members - 1, 'the member count leaves out the blocked member');
    });

    await t('messages: the BLOCKER\'s inbox hides the thread and its unread; the blocked member still sees theirs', async () => {
        const ana = await threadKeys(as.ana);
        assert.ok(!ana.includes(U.bruno), 'hidden from the blocker');
        assert.ok(ana.includes('team') && ana.includes(U.cvita));
        assert.ok((await threadKeys(as.bruno)).includes(U.ana), 'the blocked member keeps their side (sending is refused server-side)');
        const unread = (await M('GET', '/api/v2/messages/unread-count', as.ana)).body;
        assert.strictEqual(unread.direct, 1, 'Bruno\'s unread no longer counts — by id AND on the legacy row keyed by his address (Cvita remains)');
        assert.strictEqual(unread.team, 1);
    });

    await t('peer card: the blocker gets blocked:true, the blocked member gets the unknown-member 404, a third member is normal', async () => {
        const mine = await M('GET', '/api/v2/messages/peer/:userId', as.ana, { params: { userId: U.bruno } });
        assert.strictEqual(mine.status, 200);
        assert.strictEqual(mine.body.blocked, true);
        assert.strictEqual(mine.body.connected, false);
        const theirs = await M('GET', '/api/v2/messages/peer/:userId', as.bruno, { params: { userId: U.ana } });
        assert.strictEqual(theirs.status, 404);
        assert.strictEqual(theirs.body.error, 'That member could not be found.');
        const other = await M('GET', '/api/v2/messages/peer/:userId', as.cvita, { params: { userId: U.ana } });
        assert.strictEqual(other.status, 200);
        assert.strictEqual(other.body.blocked, false);
        assert.strictEqual(other.body.connected, true);
    });

    await t('the legacy send routes carry the guard (source check — PART 2 proves it end-to-end)', () => {
        const src = fs.readFileSync(path.join(ROOT, 'user-portal/backend/server.js'), 'utf8');
        const handler = (route) => { const i = src.indexOf(route); assert.ok(i > 0, route); return src.slice(i, src.indexOf('\n    });', i)); };
        const send = handler("app.post('/api/messages', auth,");
        assert.match(send, /isBlockedPair\(db, senderId, receiver_id\)/);
        assert.match(send, /status\(403\)\.json\(\{ error: safetyCore\.BLOCKED_MESSAGE \}\)/);
        assert.ok(send.indexOf('isBlockedPair') < send.indexOf('INSERT INTO direct_messages'), 'checked before the insert');
        const conn = handler("app.post('/api/networking/connections', auth,");
        assert.match(conn, /isBlockedPair\(db, req\.user\.id, receiver_id\)/);
        assert.ok(conn.indexOf('isBlockedPair') < conn.indexOf('INSERT INTO networking_connections'));
        assert.doesNotMatch(core.BLOCKED_MESSAGE + core.BLOCKED_CONNECT, /block/i, 'the refusal never says who blocked whom');
    });

    await t('admin: the open queue — reporter, target, reason, note, the reported message, counts, open-on-target', async () => {
        const r = await A('GET', '/api/v2/safety/reports', as.team);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.status, 'open');
        const ids = r.body.reports.map(x => x.id);
        assert.ok(ids.includes(reportMember) && ids.includes(reportMsg));
        assert.ok(r.body.reports.every(x => x.status === 'open'));
        const m = r.body.reports.find(x => x.id === reportMember);
        assert.strictEqual(m.reporter.name, 'Ana Anić');
        assert.strictEqual(m.reporter.email, 'ana.anić@example.com');
        assert.strictEqual(m.target.id, U.bruno);
        assert.strictEqual(m.target.name, 'Bruno Brnić');
        assert.strictEqual(m.target.is_public_profile, true);
        assert.strictEqual(m.reason_label, 'Harassment');
        assert.strictEqual(m.note, 'Keeps messaging after I asked him to stop.');
        assert.strictEqual(m.message, null);
        assert.ok(m.target_open_reports >= 3, 'several open reports on Bruno');
        const msg = r.body.reports.find(x => x.id === reportMsg);
        assert.strictEqual(msg.target_kind, 'message');
        assert.strictEqual(msg.message.content, 'Hi Ana — buy followers cheap!!!');
        assert.strictEqual(r.body.counts.open, r.body.reports.length);
        assert.ok(r.body.counts.dismissed >= 11);
        assert.strictEqual(r.body.counts.all, q.get('SELECT COUNT(*) AS n FROM v2_reports').n);
        assert.strictEqual((await A('GET', '/api/v2/safety/reports', as.team, { query: { status: 'bogus' } })).status, 400);
    });

    await t('admin: REVIEWED with a note stamps who/when; bad status 400; unknown 404; REOPEN clears the stamp', async () => {
        const r = await A('PUT', '/api/v2/safety/reports/:id', as.team, { params: { id: reportMsg }, body: { status: 'reviewed', note: 'Spoke to Bruno.' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.report.status, 'reviewed');
        assert.strictEqual(r.body.report.reviewed_by.name, 'Laura Team');
        assert.ok(r.body.report.reviewed_at);
        assert.strictEqual(r.body.report.action_note, 'Spoke to Bruno.');
        assert.strictEqual((await A('PUT', '/api/v2/safety/reports/:id', as.team, { params: { id: reportMsg }, body: { status: 'closed' } })).status, 400);
        assert.strictEqual((await A('PUT', '/api/v2/safety/reports/:id', as.team, { params: { id: reportMsg }, body: { status: 'dismissed', note: 'z'.repeat(501) } })).status, 400);
        assert.strictEqual((await A('PUT', '/api/v2/safety/reports/:id', as.team, { params: { id: 'nope' }, body: { status: 'dismissed' } })).status, 404);
        const handled = await A('GET', '/api/v2/safety/reports', as.team, { query: { status: 'handled' } });
        assert.ok(handled.body.reports.some(x => x.id === reportMsg));
        assert.ok(!(await A('GET', '/api/v2/safety/reports', as.team)).body.reports.some(x => x.id === reportMsg), 'left the open queue');
        const re = await A('PUT', '/api/v2/safety/reports/:id', as.team, { params: { id: reportMsg }, body: { status: 'open' } });
        assert.strictEqual(re.body.report.status, 'open');
        assert.strictEqual(re.body.report.reviewed_by, null);
        assert.strictEqual(re.body.report.action_note, 'Spoke to Bruno.', 'a reopen without a note keeps the earlier note');
        const dis = await A('PUT', '/api/v2/safety/reports/:id', as.team, { params: { id: reportMsg }, body: { status: 'dismissed' } });
        assert.strictEqual(dis.body.report.status, 'dismissed');
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'safety.report.reviewed' AND actor_id = ?", [U.team]));
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'safety.report.dismissed'"));
    });

    await t('admin: HIDE PROFILE — out of every directory, report actioned, NOTHING deleted', async () => {
        assert.ok((await dirNames(as.cvita)).includes(U.bruno));
        q.run(`INSERT INTO user_profiles (user_id, title, is_profile_public) VALUES (?, 'MD', 1)`, [U.bruno]);
        const msgsBefore = q.get('SELECT COUNT(*) AS n FROM direct_messages').n;
        const wrong = await A('POST', '/api/v2/safety/members/:userId/hide-profile', as.team, { params: { userId: U.cvita }, body: { report_id: reportMember } });
        assert.strictEqual(wrong.status, 400, 'a report about someone else');
        assert.strictEqual((await A('POST', '/api/v2/safety/members/:userId/hide-profile', as.team, { params: { userId: 'u-nobody' } })).status, 404);
        assert.strictEqual((await A('POST', '/api/v2/safety/members/:userId/hide-profile', as.team, { params: { userId: U.bruno }, body: { report_id: 'nope' } })).status, 404);
        const r = await A('POST', '/api/v2/safety/members/:userId/hide-profile', as.team, { params: { userId: U.bruno }, body: { report_id: reportMember } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.deepStrictEqual(r.body.user, { id: U.bruno, is_public_profile: false });
        assert.strictEqual(r.body.report.status, 'actioned');
        assert.strictEqual(r.body.report.action_note, 'Profile hidden from the member directory.');
        assert.strictEqual(r.body.report.target.is_public_profile, false);
        assert.strictEqual(q.get('SELECT is_public_profile FROM users WHERE id = ?', [U.bruno]).is_public_profile, 0);
        assert.strictEqual(q.get('SELECT is_profile_public FROM user_profiles WHERE user_id = ?', [U.bruno]).is_profile_public, 0);
        assert.ok(q.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', [U.bruno]), 'the account stays');
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM direct_messages').n, msgsBefore, 'messages stay');
        assert.ok(!(await dirNames(as.cvita)).includes(U.bruno), 'gone from a third member\'s directory');
        assert.deepStrictEqual(await searchIds(as.cvita, 'Bruno'), []);
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'safety.hide_profile' AND detail LIKE ?", ['%' + U.bruno + '%']));
        // without a report id it only hides
        const plain = await A('POST', '/api/v2/safety/members/:userId/hide-profile', as.team, { params: { userId: U.dora }, body: { note: 'fake name' } });
        assert.strictEqual(plain.status, 200);
        assert.strictEqual(plain.body.report, null);
        q.run('UPDATE users SET is_public_profile = 1, moderation_hidden_at = NULL WHERE id IN (?, ?)', [U.bruno, U.dora]);
        q.run('UPDATE user_profiles SET is_profile_public = 1 WHERE user_id = ?', [U.bruno]);
    });

    await t('unblock: the pair can find each other again and the thread returns; the connection does NOT come back', async () => {
        const r = await M('DELETE', '/api/v2/safety/block/:userId', as.ana, { params: { userId: U.bruno } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.removed, true);
        assert.strictEqual((await M('DELETE', '/api/v2/safety/block/:userId', as.ana, { params: { userId: U.bruno } })).body.removed, false);
        assert.ok((await dirNames(as.ana)).includes(U.bruno));
        assert.ok((await dirNames(as.bruno)).includes(U.ana));
        assert.ok((await threadKeys(as.ana)).includes(U.bruno));
        assert.strictEqual(q.get("SELECT COUNT(*) AS n FROM networking_connections WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)", [U.ana, U.bruno, U.bruno, U.ana]).n, 0);
        assert.strictEqual(core.isBlockedPair(db, U.ana, U.bruno), false);
        // Bruno blocking Ana works the other way round too — and only Ana's side is hidden from Bruno's inbox
        await M('POST', '/api/v2/safety/block', as.bruno, { body: { user_id: U.ana } });
        assert.ok(!(await threadKeys(as.bruno)).includes(U.ana));
        assert.ok((await threadKeys(as.ana)).includes(U.bruno));
        assert.ok(!(await dirNames(as.ana)).includes(U.bruno));
        await M('DELETE', '/api/v2/safety/block/:userId', as.bruno, { params: { userId: U.ana } });
    });

    await t('a team HIDE sticks: the member\'s own PATCH cannot bring the profile back; GET says moderation_hidden', async () => {
        // the contract column the admin portal's HIDE PROFILE stamps (admin-portal/backend/v2/safety-ops.js)
        q.run("UPDATE users SET is_public_profile = 0, moderation_hidden_at = datetime('now') WHERE id = ?", [U.dora]);
        assert.ok(!(await dirNames(as.cvita)).includes(U.dora));
        const p = await M('PATCH', '/api/v2/profile', as.dora, { body: { is_public_profile: true, title: 'Resident' } });
        assert.strictEqual(p.status, 200, JSON.stringify(p.body));
        assert.strictEqual(p.body.profile.is_public_profile, false, 'the toggle does not undo the team\'s hide');
        assert.strictEqual(p.body.profile.title, 'Resident', 'the rest of the save goes through');
        assert.strictEqual(p.body.moderation_hidden, true);
        assert.strictEqual(q.get('SELECT is_public_profile FROM users WHERE id = ?', [U.dora]).is_public_profile, 0);
        assert.ok(!(await dirNames(as.cvita)).includes(U.dora), 'still out of the directory');
        // even a public flag set some other way does not list a hidden member
        q.run('UPDATE users SET is_public_profile = 1 WHERE id = ?', [U.dora]);
        assert.ok(!(await dirNames(as.cvita)).includes(U.dora), 'moderation_hidden_at alone keeps the member out');
        assert.deepStrictEqual(await searchIds(as.cvita, 'Dora'), []);
        const g = await M('GET', '/api/v2/profile', as.dora);
        assert.strictEqual(g.body.moderation_hidden, true);
        assert.strictEqual(g.body.profile.moderation_hidden, true);
        q.run('UPDATE users SET moderation_hidden_at = NULL WHERE id = ?', [U.dora]);
        assert.ok((await dirNames(as.cvita)).includes(U.dora), 'back once the team unhides');
        assert.strictEqual((await M('GET', '/api/v2/profile', as.dora)).body.moderation_hidden, false);
    });

    await t('SUSPENDED: out of the directory, search and suggestions; the peer card answers like an unknown member', async () => {
        q.run("UPDATE users SET suspended_at = datetime('now'), suspended_reason = 'threats' WHERE id = ?", [U.cvita]);
        assert.ok(!(await dirNames(as.dora)).includes(U.cvita));
        assert.deepStrictEqual(await searchIds(as.dora, 'Cvita'), []);
        assert.ok(!(await suggIds(as.dora)).includes(U.cvita));
        const peer = await M('GET', '/api/v2/messages/peer/:userId', as.ana, { params: { userId: U.cvita } });
        assert.strictEqual(peer.status, 404, 'even for a connected member');
        q.run('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?', [U.cvita]);
        assert.ok((await dirNames(as.dora)).includes(U.cvita));
        assert.strictEqual((await M('GET', '/api/v2/messages/peer/:userId', as.ana, { params: { userId: U.cvita } })).status, 200);
    });

    await t('REMOVED message: gone from the member\'s thread list, preview and unread count (the row stays for the admin)', async () => {
        const before = (await M('GET', '/api/v2/messages/unread-count', as.ana)).body.direct;
        assert.ok((await threadKeys(as.ana)).includes(U.cvita));
        q.run("UPDATE direct_messages SET removed_at = datetime('now'), removed_by = ? WHERE id = 'dm-ca-1'", [U.team]);
        assert.ok(!(await threadKeys(as.ana)).includes(U.cvita), 'Cvita\'s only message was removed — no thread left');
        assert.strictEqual((await M('GET', '/api/v2/messages/unread-count', as.ana)).body.direct, before - 1);
        assert.ok(q.get("SELECT id FROM direct_messages WHERE id = 'dm-ca-1'"), 'the row itself stays (moderation record)');
        // a removed TEAM message is gone from the team thread too
        q.run("UPDATE direct_messages SET removed_at = datetime('now') WHERE id = 'dm-team-1'");
        const team = (await M('GET', '/api/v2/messages/team', as.ana)).body.messages.map(m => m.id);
        assert.ok(!team.includes('dm-team-1'));
        assert.strictEqual((await M('GET', '/api/v2/messages/unread-count', as.ana)).body.team, 0);
        q.run("UPDATE direct_messages SET removed_at = NULL, removed_by = NULL WHERE id IN ('dm-ca-1', 'dm-team-1')");
        assert.ok((await threadKeys(as.ana)).includes(U.cvita));
    });

    await t('per-message REPORT: target_type alias, any message you received (not only the latest), ≤ 10 earlier messages as context', async () => {
        addUser('u-eva', 'Eva', 'Ević'); addUser('u-filip', 'Filip', 'Filipić');
        q.run(`UPDATE users SET bio = 'Cardiology fellow in Rijeka.' WHERE id = 'u-filip'`);
        for (let i = 1; i <= 12; i++) {
            q.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, created_at) VALUES (?, 'u-filip', 'u-eva', ?, datetime('now', ?))`, ['dm-fe-' + i, 'message ' + i, `-${60 - i} minutes`]);
        }
        q.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, created_at) VALUES ('dm-ef-1', 'u-eva', 'u-filip', 'from Eva', datetime('now', '-30 minutes'))`);
        const eva = { id: 'u-eva', email: 'eva.ević@example.com', is_admin: 0 };
        const early = await report(eva, { target_type: 'message', target_id: 'dm-fe-5', reason: 'harassment' });
        assert.strictEqual(early.status, 200, JSON.stringify(early.body));
        const e5 = q.get('SELECT target_kind, target_user_id, evidence_text, evidence_meta FROM v2_reports WHERE id = ?', [early.body.id]);
        assert.strictEqual(e5.target_kind, 'message');
        assert.strictEqual(e5.target_user_id, 'u-filip');
        assert.strictEqual(e5.evidence_text, 'message 5', 'the reported message itself, not the latest one');
        assert.deepStrictEqual(JSON.parse(e5.evidence_meta).context.map(c => c.text), ['message 1', 'message 2', 'message 3', 'message 4']);
        const late = await report(eva, { target_type: 'message', target_id: 'dm-fe-12', reason: 'harassment' });
        const ctx12 = JSON.parse(q.get('SELECT evidence_meta FROM v2_reports WHERE id = ?', [late.body.id]).evidence_meta).context.map(c => c.text);
        assert.strictEqual(ctx12.length, 10, 'at most 10');
        assert.deepStrictEqual([ctx12[0], ctx12[9]], ['message 2', 'message 11'], 'the 10 just before, oldest first — never Eva\'s own');
        // a message Eva SENT, or one between two other members, is refused
        assert.strictEqual((await report(eva, { target_type: 'message', target_id: 'dm-ef-1', reason: 'spam' })).status, 404);
        assert.strictEqual((await report(eva, { target_type: 'message', target_id: 'dm-ba-1', reason: 'spam' })).status, 404);
        // a MEMBER report copies the bio and the latest 10 messages from that member to the reporter
        const mem = await report(eva, { target_kind: 'member', target_id: 'u-filip', reason: 'harassment' });
        const m = q.get('SELECT evidence_text, evidence_meta FROM v2_reports WHERE id = ?', [mem.body.id]);
        assert.strictEqual(m.evidence_text, 'Cardiology fellow in Rijeka.');
        const mm = JSON.parse(m.evidence_meta);
        assert.strictEqual(mm.sender_name, 'Filip Filipić');
        assert.deepStrictEqual([mm.context.length, mm.context[9].text], [10, 'message 12']);
    });

    await t('admin: REMOVE one listed message, REMOVE ALL from the member, CLEAR PROFILE — evidence ids, removed flags, profile snapshot', async () => {
        const eva = { id: 'u-eva', email: 'eva.ević@example.com', is_admin: 0 };
        // the evidence lists each other message WITH its id, and a profile snapshot on a member report
        q.run(`UPDATE users SET title = 'Fellow', city = 'Rijeka', specialties = '["CARDIOLOGY"]', photo_url = 'https://res.cloudinary.com/x/image/upload/v1/medx/profile/u-filip.jpg' WHERE id = 'u-filip'`);
        const dora = { id: U.dora, email: 'dora.dorić@example.com', is_admin: 0 };
        const snap = await report(dora, { target_kind: 'member', target_id: 'u-filip', reason: 'inappropriate' });
        assert.strictEqual(snap.status, 200, JSON.stringify(snap.body));
        const list = (await A('GET', '/api/v2/safety/reports', as.team)).body.reports;
        const lateRow = list.find(x => x.target_kind === 'message' && x.target_id === 'dm-fe-12');
        assert.ok(lateRow && lateRow.evidence.context.every(c => /^dm-fe-/.test(c.id) && c.removed === false), JSON.stringify(lateRow && lateRow.evidence.context.slice(0, 2)));
        const snapRow = list.find(x => x.id === snap.body.id);
        assert.deepStrictEqual([snapRow.evidence.profile.title, snapRow.evidence.profile.city, /u-filip/.test(snapRow.evidence.profile.photo_url)], ['Fellow', 'Rijeka', true]);
        // REMOVE one of the listed messages (dm-fe-3), never one the reporter wrote
        const one = await A('POST', '/api/v2/safety/reports/:id/remove-message', as.team, { params: { id: lateRow.id }, body: { message_id: 'dm-fe-3' } });
        assert.strictEqual(one.status, 200, JSON.stringify(one.body));
        assert.deepStrictEqual([one.body.removed, one.body.report.status], [1, 'actioned']);
        assert.ok(q.get("SELECT removed_at FROM direct_messages WHERE id = 'dm-fe-3'").removed_at);
        assert.ok(!q.get("SELECT removed_at FROM direct_messages WHERE id = 'dm-fe-12'").removed_at, 'the reported one stays until the team removes it');
        assert.strictEqual(one.body.report.evidence.context.find(c => c.id === 'dm-fe-3').removed, true, 'the queue marks it REMOVED');
        const notTheirs = await A('POST', '/api/v2/safety/reports/:id/remove-message', as.team, { params: { id: lateRow.id }, body: { message_id: 'dm-ef-1' } });
        assert.strictEqual(notTheirs.status, 400, 'Eva\'s own message is not the reported member\'s');
        assert.ok(!q.get("SELECT removed_at FROM direct_messages WHERE id = 'dm-ef-1'").removed_at);
        // REMOVE ALL: every message from Filip to Eva, on a MEMBER report too; Eva's own message stays
        const allRes = await A('POST', '/api/v2/safety/reports/:id/remove-message', as.team, { params: { id: snap.body.id }, body: { scope: 'thread' } });
        assert.strictEqual(allRes.status, 200, JSON.stringify(allRes.body));
        const evaReport = list.find(x => x.target_kind === 'member' && x.target_id === 'u-filip' && x.reporter.id === 'u-eva');
        const allEva = await A('POST', '/api/v2/safety/reports/:id/remove-message', as.team, { params: { id: evaReport.id }, body: { scope: 'thread' } });
        assert.strictEqual(allEva.body.removed, 11, 'the 11 still in the conversation (dm-fe-3 was already out)');
        assert.strictEqual(q.get("SELECT COUNT(*) AS n FROM direct_messages WHERE sender_id = 'u-filip' AND receiver_id = 'u-eva' AND removed_at IS NULL").n, 0);
        assert.ok(!q.get("SELECT removed_at FROM direct_messages WHERE id = 'dm-ef-1'").removed_at, 'what Eva wrote stays');
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'safety.remove_messages'"));
        // CLEAR PROFILE: validation, then photo + text
        assert.strictEqual((await A('POST', '/api/v2/safety/reports/:id/clear-profile', as.team, { params: { id: snap.body.id }, body: { fields: [] } })).status, 400);
        assert.strictEqual((await A('POST', '/api/v2/safety/reports/:id/clear-profile', as.team, { params: { id: snap.body.id }, body: { fields: ['email'] } })).status, 400);
        assert.strictEqual((await A('POST', '/api/v2/safety/reports/:id/clear-profile', as.cvita, { params: { id: snap.body.id }, body: { fields: ['photo'] } })).status, 403, 'admins only');
        const cl = await A('POST', '/api/v2/safety/reports/:id/clear-profile', as.team, { params: { id: snap.body.id }, body: { fields: ['photo', 'bio', 'title', 'specialties'] } });
        assert.strictEqual(cl.status, 200, JSON.stringify(cl.body));
        assert.deepStrictEqual(cl.body.cleared, ['photo', 'bio', 'title', 'specialties']);
        assert.strictEqual(cl.body.report.status, 'actioned');
        const f = q.get("SELECT photo_url, bio, title, specialties, first_name, deleted_at, suspended_at FROM users WHERE id = 'u-filip'");
        assert.deepStrictEqual([f.photo_url, f.bio, f.title, f.specialties], [null, null, null, null]);
        assert.deepStrictEqual([f.first_name, f.deleted_at, f.suspended_at], ['Filip', null, null], 'the account itself stays open');
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'safety.clear_profile' AND detail LIKE '%u-filip%'"));
        // a team account is never cleared from the queue
        const onTeam = await report(eva, { target_kind: 'member', target_id: U.team, reason: 'other' });
        assert.strictEqual((await A('POST', '/api/v2/safety/reports/:id/clear-profile', as.team, { params: { id: onTeam.body.id }, body: { fields: ['bio'] } })).status, 400);
    });

    await t('CONTENT FILTER: slurs, sexual solicitation and threats are refused in the profile (422), ordinary text passes', async () => {
        const bad = await M('PATCH', '/api/v2/profile', as.cvita, { body: { bio: 'Answer me or I will kill you.' } });
        assert.strictEqual(bad.status, 422);
        assert.strictEqual(bad.body.error, core.CONTENT_PROFILE);
        assert.strictEqual(bad.body.field, 'bio', 'the field that needs rewording');
        assert.doesNotMatch(core.CONTENT_PROFILE + core.CONTENT_MESSAGE, /honest|plainly|nothing hidden/i);
        const badTitle = await M('PATCH', '/api/v2/profile', as.cvita, { body: { title: 'send nudes' } });
        assert.strictEqual(badTitle.status, 422);
        assert.strictEqual(q.get('SELECT bio, title FROM users WHERE id = ?', [U.cvita]).bio, null, 'nothing saved');
        // every other field the directory card shows: the institution, city, country and the specialty tags
        const tags = await M('PATCH', '/api/v2/profile', as.cvita, { body: { specialties: ['faggots', 'Neurology'] } });
        assert.deepStrictEqual([tags.status, tags.body.field], [422, 'specialties']);
        const inst = await M('PATCH', '/api/v2/profile', as.cvita, { body: { institution: 'I will kill you University' } });
        assert.deepStrictEqual([inst.status, inst.body.field], [422, 'institution']);
        const city = await M('PATCH', '/api/v2/profile', as.cvita, { body: { city: 'kill yourself' } });
        assert.deepStrictEqual([city.status, city.body.field], [422, 'city']);
        assert.strictEqual(q.get('SELECT specialties FROM users WHERE id = ?', [U.cvita]).specialties, null, 'nothing saved');
        const ok = await M('PATCH', '/api/v2/profile', as.cvita, { body: { bio: 'Pediatric oncology; the assay will kill tumour cells in vitro.', specialties: ['Oncology', 'Sex differences'], institution: 'KBC Split' } });
        assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
        // the shared check, English and Croatian, whole words only — refused …
        for (const t of ['Ubit ću te!', 'I\'ll kill you', 'i know where you live', 'Znam gdje živiš', 'Pošalji mi gole slike', 'puši kurac', 'you faggot', 'kill yourself',
                         'fuck you', 'you stupid cunt', 'jebem ti mater', 'jebi se', 'kys', 'go hang yourself', 'n1gger', 'n i g g e r', 'k1ll yourself', 'suck my d1ck',
                         'I\'ll shoot you.', 'I will hurt you!', 'im gonna shoot you if you come to the lab', 'i will find you and kill you']) assert.ok(core.contentProblem(t), 'refused: ' + t);
        // … and ordinary professional and scientific text goes through (the must-pass list)
        for (const t of ['Peder Hansen, cardiology', 'Kike from Madrid', 'retarded growth in rats', 'Scunthorpe', 'Nigeria collaboration', 'Skill yourself up',
                         'I\'ll shoot you an email with the slides tonight.', 'I\'m gonna shoot you a message after the talk.', 'I will shoot you at the gala',
                         'I\'ll hurt you with these reviewer comments, sorry :)', 'I know where you work - MGH, right? Lets grab coffee at Plexus.',
                         'Znam gdje radiš, svratit ću na kavu u KBC.', 'Pošalji mi gole brojke do petka, bez interpretacije.', 'Pošalji mi gole brojeve do petka',
                         'Our cancer cohort shows sex differences; Dick Swaab added a kill switch.', 'Nude mice (athymic) were used for xenografts.',
                         'We will kill two birds with one stone', 'Room 101, floor 3, desk 4', 'I u Splitu i u Zagrebu', 'Hoćeš li doći na kavu?']) assert.ok(!core.contentProblem(t), 'must pass: ' + t);
        assert.ok(core.contentProblem(['Neurology', 'faggots']) && !core.contentProblem(['Neurology', 'Oncology']), 'a list of tags is checked item by item');
    });

    await t('no email path was touched by any of it', () => { assert.strictEqual(emailCalls, 0); });
}

// ---------------------------------------------------------------- PART 2: the real server on a scratch file
// the spawned server may talk to localhost only (the same preload as tests/account-delete.test.js)
const NO_NET = `
const net = require('net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const o = args[0] && typeof args[0] === 'object' ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (o && o.path) return connect.apply(this, args);
    const h = String((o && (o.host || o.hostname)) || 'localhost');
    if (!/^(localhost|127\\.0\\.0\\.1|::1|::ffff:127\\.0\\.0\\.1)$/.test(h)) {
        const e = new Error('NETWORK DISABLED IN TESTS (' + h + ')');
        process.nextTick(() => this.destroy(e));
        return this;
    }
    return connect.apply(this, args);
};
global.fetch = async (u) => { throw new Error('NETWORK DISABLED IN TESTS ' + String(u).slice(0, 80)); };
`;
const PORT = 3153, BASE = 'http://127.0.0.1:' + PORT, E2E_SECRET = 'safety-e2e-secret';
async function part2() {
    console.log('\nsafety.test.js PART 2 — the member portal on a scratch SQLite file (legacy routes end-to-end, no network)\n');
    global.fetch = (url, opts) => { if (!String(url).startsWith(BASE)) throw new Error('NETWORK DISABLED IN TESTS: ' + url); return realFetch(url, opts); };
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-safety-e2e-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const preload = path.join(scratch, 'no-network.js');
    fs.writeFileSync(preload, NO_NET);
    const env = { ...process.env, DATABASE_PATH: dbPath, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', RESEND_API_KEY: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '',
                  STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', FIRA_API_KEY: '', CLOUDINARY_URL: '', GOOGLE_SHEETS_ID: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
                  JWT_SECRET: E2E_SECRET, NODE_ENV: 'test', PORT: String(PORT) };
    let proc = null, errbuf = '';
    const cleanup = () => { if (proc) { try { proc.kill('SIGKILL'); } catch (e) {} proc = null; } try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {} };
    process.on('exit', cleanup);
    const api = async (p, { method = 'GET', body, token } = {}) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        let d = null; try { d = await r.json(); } catch (e) {}
        return { status: r.status, d };
    };
    try {
        proc = spawn('node', ['-r', preload, 'server.js'], { cwd: path.join(ROOT, 'user-portal/backend'), env, stdio: ['ignore', 'ignore', 'pipe'] });
        proc.stderr.on('data', d => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        const t0 = Date.now();
        for (;;) {
            try { const r = await fetch(BASE + '/health'); if (r.ok) break; } catch (e) {}
            if (Date.now() - t0 > 120000) throw new Error('scratch server did not come up: ' + errbuf.slice(-800));
            await new Promise(r => setTimeout(r, 500));
        }
        const signup = async (tag, first, last) => {
            const email = `qa.safety+${tag}@example.com`;
            const r = await api('/api/auth/register', { method: 'POST', body: { email, password: 'test-password-9', first_name: first, last_name: last, institution: 'Safety Institute' } });
            return { token: r.d && r.d.token, id: r.d && r.d.user && r.d.user.id, email, status: r.status };
        };
        const ana = await signup('ana', 'Ana', 'Anić'), bruno = await signup('bruno', 'Bruno', 'Brnić');
        const cvita = await signup('cvita', 'Cvita', 'Cvitić'), tea = await signup('tea', 'Tea', 'Team');
        await t('scratch boot: four members signed up', () => { assert.ok([ana, bruno, cvita, tea].every(u => u.token && u.id), JSON.stringify({ ana, bruno })); });
        const tdb = new Database(dbPath);
        const x = (sql, params = []) => tdb.prepare(sql).run(...params);
        const g = (sql, params = []) => { const row = tdb.prepare(sql).get(...params); if (row) delete row._metadata; return row; };
        const all4 = [ana.id, bruno.id, cvita.id, tea.id];
        x('UPDATE users SET email_verified = 1, is_public_profile = 1 WHERE id IN (?, ?, ?, ?)', all4);
        x('UPDATE users SET is_admin = 1 WHERE id = ?', [tea.id]);
        // everyone is a confirmed Plexus attendee with a public attendee profile and an approved Forum member —
        // the two groups of the global member search and the Plexus "who attends" list
        let conf = g('SELECT id FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1');
        if (!conf) { x("INSERT INTO conferences (id, name, slug, year, is_active, start_date) VALUES ('conf-e2e', 'Plexus E2E', 'plexus-e2e', 2099, 1, '2099-12-04')"); conf = { id: 'conf-e2e' }; }
        for (const u of [ana, bruno, cvita]) {
            x("INSERT INTO registrations (id, user_id, conference_id, status, email, first_name, last_name) VALUES (?, ?, ?, 'confirmed', ?, 'n', 'n')", ['reg-' + u.id, u.id, conf.id, u.email]);
            x('INSERT OR REPLACE INTO user_profiles (user_id, is_profile_public) VALUES (?, 1)', [u.id]);
            x("INSERT INTO forum_members (id, user_id, email, membership_status, approved_at) VALUES (?, ?, ?, 'approved', '2026-01-01')", ['fm-' + u.id, u.id, u.email]);
        }
        const connect = (a = ana.id, b = bruno.id) => x("INSERT INTO networking_connections (id, requester_id, receiver_id, status, accepted_at) VALUES (?, ?, ?, 'accepted', datetime('now'))", ['e2e-conn-' + Date.now() + Math.random(), a, b]);
        const disconnect = (a = ana.id, b = bruno.id) => x('DELETE FROM networking_connections WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)', [a, b, b, a]);
        const nConn = () => g('SELECT COUNT(*) AS n FROM networking_connections WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)', [ana.id, bruno.id, bruno.id, ana.id]).n;
        const searchTitles = async (u, qs) => ((await api('/api/member/search?q=' + encodeURIComponent(qs), { token: u.token })).d.members || []).map(m => m.kind + ':' + m.title);
        const attendeeIds = async (u) => ((await api('/api/plexus/attendees', { token: u.token })).d || []).map(a => a.id);
        const badgeOf = (uid) => Buffer.from(uid, 'utf8').toString('base64url') + '.' + require('node:crypto').createHmac('sha256', E2E_SECRET).update('medx-verify-badge:' + uid).digest('hex').slice(0, 24);
        connect();
        connect(ana.id, tea.id);

        let helloId = null, reportedId = null, reportId = null;
        await t('baseline: connected members message each other (POST /api/messages → 200)', async () => {
            const r = await api('/api/messages', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id, content: 'hello' } });
            assert.strictEqual(r.status, 200, JSON.stringify(r.d));
            helloId = r.d.id;
        });
        await t('CONTENT FILTER: a threat between connected members → 422, nothing stored or pushed', async () => {
            const r = await api('/api/messages', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id, content: 'Answer me. I will kill you.' } });
            assert.strictEqual(r.status, 422, JSON.stringify(r.d));
            assert.strictEqual(r.d.error, core.CONTENT_MESSAGE);
            assert.strictEqual(g("SELECT COUNT(*) AS n FROM direct_messages WHERE content LIKE '%kill you%'").n, 0);
            const c = await api('/api/networking/connections', { method: 'POST', token: cvita.token, body: { receiver_id: bruno.id, message: 'send nudes' } });
            assert.strictEqual(c.status, 422, 'a connection note is member content too');
        });
        await t('CONTENT FILTER must-pass: ordinary professional messages are delivered (200) — the round-2 false positives', async () => {
            connect(cvita.id, ana.id);      // Cvita writes (Bruno's messages to Ana are the evidence the next tests read)
            for (const content of ["I'll shoot you an email with the slides tonight.", "I'm gonna shoot you a message after the talk.",
                                   'I know where you work - MGH, right? Lets grab coffee at Plexus.', 'Znam gdje radiš, svratit ću na kavu u KBC.',
                                   'Pošalji mi gole brojke do petka, bez interpretacije.']) {
                const r = await api('/api/messages', { method: 'POST', token: cvita.token, body: { receiver_id: ana.id, content } });
                assert.strictEqual(r.status, 200, content + ' → ' + r.status + ' ' + JSON.stringify(r.d));
            }
            for (const content of ['fuck you', 'you stupid cunt', 'jebem ti mater', 'n1gger']) {
                const r = await api('/api/messages', { method: 'POST', token: cvita.token, body: { receiver_id: ana.id, content } });
                assert.strictEqual(r.status, 422, content + ' → ' + r.status);
            }
            disconnect(cvita.id, ana.id);
        });
        await t('CONTENT FILTER on every profile text other members read: sign-up name / institution, networking interests, the Forum profile', async () => {
            const reg = await api('/api/auth/register', { method: 'POST', body: { email: 'qa.safety+slur@example.com', password: 'test-password-9', first_name: 'Faggots', last_name: 'Kill Yourself', institution: 'I know where you live' } });
            assert.deepStrictEqual([reg.status, reg.d.error, reg.d.field], [422, core.CONTENT_PROFILE, 'name']);
            assert.ok(!g("SELECT id FROM users WHERE email = 'qa.safety+slur@example.com'"), 'no account created');
            const np = await api('/api/networking/profile', { method: 'PUT', token: cvita.token, body: { research_interests: ['send me nudes'], looking_for: 'i know where you live', working_on: 'kill yourself', open_to_coffee_chats: 1 } });
            assert.strictEqual(np.status, 422, JSON.stringify(np.d));
            const npOk = await api('/api/networking/profile', { method: 'PUT', token: cvita.token, body: { research_interests: ['Sex differences in stroke'], looking_for: 'collaborators' } });
            assert.strictEqual(npOk.status, 200, JSON.stringify(npOk.d));
            const fp = await api('/api/forum/profile', { method: 'PUT', token: cvita.token, body: { specialty: 'faggots' } });
            assert.deepStrictEqual([fp.status, fp.d.field], [422, 'specialty']);
            const fpOk = await api('/api/forum/profile', { method: 'PUT', token: cvita.token, body: { specialty: 'Oncology', bio: 'Tumour immunology.' } });
            assert.strictEqual(fpOk.status, 200, JSON.stringify(fpOk.d));
        });
        await t('the global search gives each Forum hit its ACCOUNT id (user_id), so the app filters blocks by id only', async () => {
            const r = await api('/api/member/search?q=Ana', { token: bruno.token });
            const f = (r.d.members || []).find(m => m.kind === 'forum_member');
            assert.ok(f && f.user_id === ana.id && f.id === 'fm-' + ana.id, JSON.stringify(r.d.members));
        });
        await t('baseline lists: the pair finds each other in the global search and the Plexus attendees; MY NETWORK marks the team', async () => {
            const s = await searchTitles(bruno, 'Ana');
            assert.ok(s.includes('attendee:Ana Anić') && s.includes('forum_member:Ana Anić'), s.join(' | '));
            assert.ok((await attendeeIds(bruno)).includes(ana.id));
            const conns = (await api('/api/networking/connections', { token: ana.token })).d;
            const b = conns.find(c => c.requester_id === bruno.id || c.receiver_id === bruno.id), tm = conns.find(c => c.requester_id === tea.id || c.receiver_id === tea.id);
            assert.ok(b && tm, JSON.stringify(conns).slice(0, 300));
            assert.strictEqual(Number(b.is_team), 0);
            assert.strictEqual(Number(tm.is_team), 1, 'is_team — the client never offers BLOCK on the Med&X team');
        });
        await t('Ana reports one received message (target_type alias) — the evidence copy is taken at once', async () => {
            const m = await api('/api/messages', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id, content: 'Answer me now.' } });
            assert.strictEqual(m.status, 200);
            reportedId = m.d.id;
            const r = await api('/api/v2/safety/report', { method: 'POST', token: ana.token, body: { target_type: 'message', target_id: reportedId, reason: 'harassment' } });
            assert.strictEqual(r.status, 200, JSON.stringify(r.d));
            reportId = r.d.id;
            const row = g('SELECT evidence_text, evidence_meta FROM v2_reports WHERE id = ?', [reportId]);
            assert.strictEqual(row.evidence_text, 'Answer me now.');
            assert.deepStrictEqual(JSON.parse(row.evidence_meta).context.map(c => c.text), ['hello']);
            // a message Ana SENT is not hers to report
            const own = await api('/api/messages', { method: 'POST', token: ana.token, body: { receiver_id: bruno.id, content: 'ok' } });
            assert.strictEqual((await api('/api/v2/safety/report', { method: 'POST', token: ana.token, body: { target_type: 'message', target_id: own.d.id, reason: 'spam' } })).status, 404);
        });
        await t('Ana blocks Bruno through the real route; the connection ends', async () => {
            const r = await api('/api/v2/safety/block', { method: 'POST', token: ana.token, body: { user_id: bruno.id } });
            assert.strictEqual(r.status, 200, JSON.stringify(r.d));
            assert.strictEqual(r.d.disconnected, 1);
        });
        await t('a blocked pair cannot message in EITHER direction — even with a connection row back (403, neutral wording)', async () => {
            connect();   // e.g. a stale client or an old scan re-created one — the block still wins
            const b2a = await api('/api/messages', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id, content: 'let me explain' } });
            assert.strictEqual(b2a.status, 403); assert.strictEqual(b2a.d.error, core.BLOCKED_MESSAGE);
            const a2b = await api('/api/messages', { method: 'POST', token: ana.token, body: { receiver_id: bruno.id, content: 'x' } });
            assert.strictEqual(a2b.status, 403); assert.strictEqual(a2b.d.error, core.BLOCKED_MESSAGE);
            assert.strictEqual(g("SELECT COUNT(*) AS n FROM direct_messages WHERE content IN ('let me explain','x')").n, 0, 'nothing written');
        });
        await t('with a connection row back: MY NETWORK hides the pair, 1:1 meeting requests and meetings are refused (403)', async () => {
            const conns = (await api('/api/networking/connections', { token: ana.token })).d;
            assert.ok(!conns.some(c => c.requester_id === bruno.id || c.receiver_id === bruno.id), 'the blocker\'s list');
            assert.ok(!(await api('/api/networking/connections', { token: bruno.token })).d.some(c => c.requester_id === ana.id || c.receiver_id === ana.id), 'the blocked member\'s list');
            const mr = await api('/api/networking/meeting-requests', { method: 'POST', token: bruno.token, body: { recipient_id: ana.id, note: 'meet me' } });
            assert.strictEqual(mr.status, 403, JSON.stringify(mr.d)); assert.strictEqual(mr.d.error, core.BLOCKED_CONNECT);
            const nm = await api('/api/networking/meetings', { method: 'POST', token: bruno.token, body: { attendee_id: ana.id, date: '2099-10-01', time: '10:00' } });
            assert.strictEqual(nm.status, 403, JSON.stringify(nm.d));
            assert.strictEqual(g('SELECT COUNT(*) AS n FROM pending_meetings WHERE requester_id = ?', [bruno.id]).n + g('SELECT COUNT(*) AS n FROM networking_meetings WHERE organizer_id = ?', [bruno.id]).n, 0);
            disconnect();
            x("INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES ('e2e-pending', ?, ?, 'pending')", [bruno.id, ana.id]);
            assert.ok(!(await api('/api/networking/connections/pending', { token: ana.token })).d.some(c => c.requester_id === bruno.id), 'pending requests too');
            disconnect();
        });
        await t('a badge scan across the block answers like an unknown badge (404) and re-creates nothing', async () => {
            const r = await api('/api/networking/connect-by-badge', { method: 'POST', token: bruno.token, body: { token: badgeOf(ana.id) } });
            assert.strictEqual(r.status, 404, JSON.stringify(r.d));
            assert.strictEqual(r.d.error, 'Badge not recognized.');
            assert.strictEqual(nConn(), 0);
            // the same token works for a member outside the block (the guard is the block, not the badge)
            const ok = await api('/api/networking/connect-by-badge', { method: 'POST', token: cvita.token, body: { token: badgeOf(ana.id) } });
            assert.strictEqual(ok.status, 200, JSON.stringify(ok.d));
        });
        await t('mentorship and intro requests across the block are refused (403) — no row, no push', async () => {
            const m = await api('/api/mentorship/requests', { method: 'POST', token: bruno.token, body: { to_user_id: ana.id, message: 'be my mentor' } });
            assert.strictEqual(m.status, 403, JSON.stringify(m.d));
            const i1 = await api('/api/intro-requests', { method: 'POST', token: bruno.token, body: { to_user_id: ana.id } });
            assert.strictEqual(i1.status, 403, JSON.stringify(i1.d));
            const i2 = await api('/api/intro-requests', { method: 'POST', token: bruno.token, body: { to_user_id: cvita.id, via_user_id: ana.id } });
            assert.strictEqual(i2.status, 403, 'naming the blocker as the connector');
            assert.strictEqual(g('SELECT COUNT(*) AS n FROM mentorship_requests WHERE from_user_id = ?', [bruno.id]).n + g('SELECT COUNT(*) AS n FROM intro_requests WHERE from_user_id = ?', [bruno.id]).n, 0);
        });
        await t('legacy Forum v1 writes across a block (connection, mentorship) → 403; abusive notes, group messages and opportunities → 422', async () => {
            const fc = await api('/api/forum/connections', { method: 'POST', token: bruno.token, body: { receiver_id: 'fm-' + ana.id, message: 'hi' } });
            assert.strictEqual(fc.status, 403, JSON.stringify(fc.d));
            const fcBad = await api('/api/forum/connections', { method: 'POST', token: bruno.token, body: { receiver_id: 'fm-' + cvita.id, message: 'kill yourself' } });
            assert.strictEqual(fcBad.status, 422);
            assert.strictEqual(g('SELECT COUNT(*) AS n FROM forum_connections WHERE requester_id = ?', ['fm-' + bruno.id]).n, 0);
            const fm = await api('/api/forum/mentorship', { method: 'POST', token: bruno.token, body: { mentor_id: 'fm-' + ana.id, goals: 'learn' } });
            assert.strictEqual(fm.status, 403, JSON.stringify(fm.d));
            const op = await api('/api/forum/opportunities', { method: 'POST', token: bruno.token, body: { title: 'send nudes', description: 'x' } });
            assert.strictEqual(op.status, 422);
            // the old posts feed leaves out a blocked pair's posts
            x("INSERT INTO forum_posts (id, author_id, post_type, title, content, moderation_status) VALUES ('fp-ana', ?, 'discussion', 'Ana post', 'hello forum', 'approved')", ['fm-' + ana.id]);
            const feedB = (await api('/api/forum/posts', { token: bruno.token })).d.map(p2 => p2.id);
            const feedC = (await api('/api/forum/posts', { token: cvita.token })).d.map(p2 => p2.id);
            assert.ok(!feedB.includes('fp-ana') && feedC.includes('fp-ana'), JSON.stringify({ feedB, feedC }));
        });
        await t('network summary counts match the lists: a request across a block (or from a suspended member) is not counted', async () => {
            x("INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES ('sum-pend', ?, ?, 'pending')", [bruno.id, ana.id]);
            const s = (await api('/api/v2/network/summary', { token: ana.token })).d;
            const pend = (await api('/api/networking/connections/pending', { token: ana.token })).d;
            assert.strictEqual(s.pending_in, pend.length, JSON.stringify({ s, pend: pend.length }));
            assert.ok(!pend.some(c => c.requester_id === bruno.id));
            x("DELETE FROM networking_connections WHERE id = 'sum-pend'");
        });
        await t('the global member search and the Plexus attendees hide the pair from each other — a third member still sees both', async () => {
            assert.deepStrictEqual(await searchTitles(bruno, 'Ana'), []);
            assert.deepStrictEqual(await searchTitles(ana, 'Bruno'), []);
            assert.ok(!(await attendeeIds(bruno)).includes(ana.id));
            assert.ok(!(await attendeeIds(ana)).includes(bruno.id));
            assert.strictEqual((await api('/api/plexus/attendees/' + encodeURIComponent(ana.id), { token: bruno.token })).status, 404, 'the attendee profile too');
            const c = await attendeeIds(cvita);
            assert.ok(c.includes(ana.id) && c.includes(bruno.id));
            assert.ok((await searchTitles(cvita, 'Bruno')).includes('attendee:Bruno Brnić'));
        });
        await t('a blocked pair cannot start a connection in EITHER direction (403, neutral wording)', async () => {
            const b2a = await api('/api/networking/connections', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id } });
            assert.strictEqual(b2a.status, 403); assert.strictEqual(b2a.d.error, core.BLOCKED_CONNECT);
            const a2b = await api('/api/networking/connections', { method: 'POST', token: ana.token, body: { receiver_id: bruno.id } });
            assert.strictEqual(a2b.status, 403);
        });
        await t('the real directory hides the pair from each other', async () => {
            const a = await api('/api/v2/network/directory?size=50', { token: ana.token });
            const b = await api('/api/v2/network/directory?size=50', { token: bruno.token });
            assert.strictEqual(a.status, 200, JSON.stringify(a.d));
            assert.ok(!a.d.results.some(m => m.id === bruno.id));
            assert.ok(!b.d.results.some(m => m.id === ana.id));
        });
        await t('after UNBLOCK the connection request goes through again (200); intros are one open request per pair', async () => {
            const u = await api('/api/v2/safety/block/' + encodeURIComponent(bruno.id), { method: 'DELETE', token: ana.token });
            assert.strictEqual(u.status, 200); assert.strictEqual(u.d.removed, true);
            const r = await api('/api/networking/connections', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id } });
            assert.strictEqual(r.status, 200, JSON.stringify(r.d));
            const d = await api('/api/v2/network/directory?size=50', { token: ana.token });
            assert.ok(d.d.results.some(m => m.id === bruno.id));
            const i1 = await api('/api/intro-requests', { method: 'POST', token: bruno.token, body: { to_user_id: cvita.id, via_user_id: ana.id } });
            assert.strictEqual(i1.status, 200, JSON.stringify(i1.d));
            const i2 = await api('/api/intro-requests', { method: 'POST', token: bruno.token, body: { to_user_id: cvita.id, via_user_id: ana.id } });
            assert.strictEqual(i2.status, 409, 'the connector is asked once, not on every tap');
            disconnect(); connect();
        });
        await t('REMOVED message: gone from the legacy thread read, the conversation list and the unread count', async () => {
            const keep = await api('/api/messages', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id, content: 'visible one' } });
            const gone = await api('/api/messages', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id, content: 'to be removed' } });
            assert.strictEqual(gone.status, 200);
            const unreadBefore = (await api('/api/v2/messages/unread-count', { token: ana.token })).d.direct;
            x("UPDATE direct_messages SET removed_at = datetime('now'), removed_by = ? WHERE id = ?", [tea.id, gone.d.id]);
            assert.strictEqual((await api('/api/v2/messages/unread-count', { token: ana.token })).d.direct, unreadBefore - 1);
            const v2 = (await api('/api/v2/messages/threads', { token: ana.token })).d.threads.find(t2 => t2.key === bruno.id);
            assert.strictEqual(v2.last.content, 'visible one', 'the thread preview');
            // (the legacy read below marks the thread read — so it runs after the counts)
            const thread = (await api('/api/messages/' + encodeURIComponent(bruno.id), { token: ana.token })).d.map(m => m.content);
            assert.ok(thread.includes('visible one') && !thread.includes('to be removed'), thread.join(' | '));
            const list = (await api('/api/messages', { token: ana.token })).d;
            assert.ok(!list.some(c => c.content === 'to be removed'), 'the conversation preview');
            assert.ok(g('SELECT id FROM direct_messages WHERE id = ?', [gone.d.id]), 'the row stays for the admin');
            assert.ok(keep.d.id);
        });
        await t('a team HIDE sticks: neither PATCH /api/v2/profile nor the legacy PUT /api/auth/profile brings the profile back', async () => {
            x("UPDATE users SET is_public_profile = 0, moderation_hidden_at = datetime('now') WHERE id = ?", [bruno.id]);
            const p = await api('/api/v2/profile', { method: 'PATCH', token: bruno.token, body: { is_public_profile: true } });
            assert.strictEqual(p.status, 200, JSON.stringify(p.d));
            assert.strictEqual(p.d.profile.is_public_profile, false);
            assert.strictEqual(p.d.moderation_hidden, true);
            const put = await api('/api/auth/profile', { method: 'PUT', token: bruno.token, body: { first_name: 'Bruno', last_name: 'Brnić', is_public_profile: true } });
            assert.strictEqual(put.status, 200);
            assert.strictEqual(g('SELECT is_public_profile FROM users WHERE id = ?', [bruno.id]).is_public_profile, 0);
            assert.strictEqual((await api('/api/v2/profile', { token: bruno.token })).d.moderation_hidden, true);
            assert.ok(!(await api('/api/v2/network/directory?size=50', { token: cvita.token })).d.results.some(m => m.id === bruno.id), 'directory');
            assert.deepStrictEqual(await searchTitles(cvita, 'Bruno'), [], 'global search');
            assert.ok(!(await attendeeIds(cvita)).includes(bruno.id), 'Plexus attendees');
            // the team's UNHIDE clears the stamp and switches the profile back on (users + the user_profiles mirror)
            x('UPDATE users SET is_public_profile = 1, moderation_hidden_at = NULL WHERE id = ?', [bruno.id]);
            x('UPDATE user_profiles SET is_profile_public = 1 WHERE user_id = ?', [bruno.id]);
            assert.ok((await attendeeIds(cvita)).includes(bruno.id));
        });
        await t('SUSPENDED: every member route answers 403 with one wording; the member leaves every list; unsuspend restores', async () => {
            x("UPDATE users SET suspended_at = datetime('now'), suspended_reason = 'threats' WHERE id = ?", [bruno.id]);
            const me = await api('/api/auth/me', { token: bruno.token });
            assert.strictEqual(me.status, 403, JSON.stringify(me.d));
            assert.strictEqual(me.d.error, 'This account is suspended. Write to info@medx.hr.');
            assert.strictEqual(me.d.code, 'account_suspended', 'the machine code the apps act on (sign out, show the sentence)');
            const send = await api('/api/messages', { method: 'POST', token: bruno.token, body: { receiver_id: ana.id, content: 'still here' } });
            assert.strictEqual(send.status, 403);
            assert.strictEqual((await api('/api/networking/connections', { method: 'POST', token: bruno.token, body: { receiver_id: cvita.id } })).status, 403, 'requests too');
            const login = await api('/api/auth/login', { method: 'POST', body: { email: bruno.email, password: 'test-password-9' } });
            assert.strictEqual(login.status, 403, 'a fresh sign-in gets the same answer');
            assert.strictEqual(login.d.error, 'This account is suspended. Write to info@medx.hr.');
            assert.strictEqual(login.d.code, 'account_suspended');
            assert.strictEqual((await api('/api/auth/login', { method: 'POST', body: { email: bruno.email, password: 'wrong-password' } })).status, 401, 'never revealed without the password');
            const wingMe = await api('/api/forum/wing/me', { token: bruno.token });
            assert.strictEqual(wingMe.d.authenticated, false, 'the soft-auth wing treats the token as anonymous');
            assert.ok(!(await api('/api/v2/network/directory?size=50', { token: cvita.token })).d.results.some(m => m.id === bruno.id));
            assert.ok(!(await attendeeIds(cvita)).includes(bruno.id));
            assert.ok(!(await api('/api/networking/connections', { token: ana.token })).d.some(c => c.requester_id === bruno.id || c.receiver_id === bruno.id), 'MY NETWORK');
            x('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?', [bruno.id]);
            assert.strictEqual((await api('/api/auth/me', { token: bruno.token })).status, 200);
        });
        await t('the evidence survives the reported member deleting the account (the message itself is gone)', async () => {
            const del = await api('/api/auth/account', { method: 'DELETE', token: bruno.token });
            assert.strictEqual(del.status, 200, JSON.stringify(del.d));
            assert.ok(!g('SELECT id FROM direct_messages WHERE id = ?', [reportedId]), 'the live row is gone');
            const row = g('SELECT status, target_user_id, evidence_text, evidence_meta FROM v2_reports WHERE id = ?', [reportId]);
            assert.strictEqual(row.status, 'open');
            assert.strictEqual(row.target_user_id, bruno.id);
            assert.strictEqual(row.evidence_text, 'Answer me now.');
            const meta = JSON.parse(row.evidence_meta);
            assert.strictEqual(meta.sender_email, bruno.email, 'who wrote it, as it was at report time');
            assert.strictEqual(meta.sender_name, 'Bruno Brnić');
            assert.deepStrictEqual(meta.context.map(c => c.text), ['hello']);
        });
        tdb.close();
    } catch (e) {
        failed++; console.error('  FAIL  PART 2 could not run\n        ' + (e && e.stack || e) + (errbuf ? '\n        server stderr: ' + errbuf.slice(-800) : ''));
    } finally { cleanup(); }
}

(async () => {
    await part1();
    if (process.argv.includes('--no-e2e')) console.log('\n(PART 2 skipped: --no-e2e)');
    else await part2();
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    console.log(`\n${passed} passed · ${failed} failed`);
    process.exit(failed);
})();
