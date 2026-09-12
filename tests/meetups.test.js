/**
 * tests/meetups.test.js — PLEXUS WEEK EDITIONS + MEETUPS (design/MEETUPS-SPEC.md §4).
 *
 * Hermetic: a stub express app collects routes, ONE in-memory libsql database (the same
 * shared/db.js wrapper both portals use) carries the real schema, and BOTH v2 modules — the
 * member `user-portal/backend/v2/meetups.js` and the admin `admin-portal/backend/v2/meetups-ops.js`
 * — are mounted on it, exactly as production has them sharing one Turso DB. sendEmail is a
 * capturing stub, global.fetch is disabled, and the Google Wallet provisioners are replaced, so
 * A REAL EMAIL SEND OR ANY NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Covers every case the spec's §4 names:
 *   capacity boundary · waitlist ordering · cancel→promote atomicity (two cancels in a row
 *   promote two DISTINCT people) · re-join after cancel goes to the back · invite accept /
 *   decline · host scoping (host A cannot read meetup B → 404) · manage-token forgery → 404 ·
 *   edition rollover on a fake clock · reminder idempotency.
 * Plus the surrounding surface: the board, invite-only visibility, the emails, the branded QR,
 * the Apple/Google/calendar assets, the admin CRUD + CSV + stats, and the Event Day meetup door.
 *
 * Run:  node tests/meetups.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.MEETUPS_NO_TIMERS = '1';                 // no reminder/rollover intervals in tests
process.env.NODE_ENV = 'test';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.MEMBER_PORTAL_URL;
delete process.env.USER_PORTAL_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('APPLE_WALLET_')) delete process.env[k];
process.env.PUBLIC_BASE_URL = 'https://portal.test';
process.env.PORT = '3000';

// Google Wallet configured with a throwaway key so buildSaveUrl actually signs something.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000099999999';
process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify({
    client_email: 'test-sa@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
});

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };
const wallet = require(path.join(ROOT, 'shared/wallet.js'));
wallet.ensureEventClass = async () => ({ created: false });
wallet.ensureEventObject = async () => ({ created: false });

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));
const editionsLib = require(path.join(ROOT, 'shared/editions'));
const core = require(path.join(ROOT, 'shared/meetups-core'));

const JWT_SECRET = 'test-secret-meetups';

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
                headers: {}, protocol: 'https', get: () => 'portal.test'
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
    `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, first_name TEXT, last_name TEXT,
        institution TEXT, country TEXT, bio TEXT, title TEXT, is_admin INTEGER DEFAULT 0, deleted_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE scheduled_emails (id TEXT PRIMARY KEY, status TEXT, batch_id TEXT, source_engine TEXT, template TEXT,
        payload_json TEXT, recipient_email TEXT, subject TEXT, created_by TEXT, created_at TEXT)`,
    `CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT)`,
    `CREATE TABLE gala_settings (id TEXT PRIMARY KEY, date TEXT, venue TEXT, city TEXT, is_registration_open INTEGER DEFAULT 1,
        price_gala_only REAL, price_gala_early_bird REAL, price_gala_regular REAL, early_bird_deadline TEXT)`,
    `CREATE TABLE event_components (id TEXT PRIMARY KEY, event_type TEXT, component_key TEXT, price REAL, is_active INTEGER DEFAULT 1)`,
    `CREATE TABLE conferences (id TEXT PRIMARY KEY, name TEXT, slug TEXT, year INTEGER, start_date TEXT, end_date TEXT,
        venue_name TEXT, venue_city TEXT, is_active INTEGER DEFAULT 1, registration_open INTEGER DEFAULT 1)`,
    `CREATE TABLE bridges_events (id TEXT PRIMARY KEY, slug TEXT, name TEXT, city TEXT, venue_name TEXT, event_date TEXT,
        registration_open INTEGER DEFAULT 1, status TEXT DEFAULT 'upcoming')`,
    `CREATE TABLE checkin_events (id TEXT PRIMARY KEY, event_key TEXT UNIQUE, label TEXT, starts_at TEXT, ends_at TEXT,
        is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`,
    `CREATE TABLE registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT,
        country TEXT, status TEXT, payment_status TEXT, guest_count INTEGER DEFAULT 0, checked_in INTEGER DEFAULT 0,
        checked_in_at TEXT, checkin_token TEXT, revoked INTEGER DEFAULT 0, includes_gala INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT,
        status TEXT, payment_status TEXT, guest_count INTEGER DEFAULT 0, checked_in INTEGER DEFAULT 0, checked_in_at TEXT,
        pricing TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE croatians_abroad_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0,
        gala_registration_id TEXT, gala_payment_status TEXT, guest_count INTEGER DEFAULT 0, notes TEXT,
        conference_checked_in INTEGER DEFAULT 0, bridges_checked_in INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE bridges_registrations (id TEXT PRIMARY KEY, event_id TEXT, first_name TEXT, last_name TEXT, email TEXT,
        institution TEXT, status TEXT, guest_count INTEGER DEFAULT 0, checked_in INTEGER DEFAULT 0, checked_in_at TEXT,
        notes TEXT, registered_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE event_checkins (id TEXT PRIMARY KEY, registration_id TEXT, event_key TEXT)`
].forEach(s => db.run(s));

const q = {
    run: (s, p) => db.run(s, p || []),
    get: (s, p) => { const st = db.prepare(s); st.bind(p || []); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
    all: (s, p) => { const st = db.prepare(s); st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; }
};

// members (the meetup profile snapshot reads users.title as the position)
const MEMBERS = [
    ['u-ana', 'ana@example.hr', 'Ana', 'Horvat', 'KBC Split', 'Resident in neurology', 'Interested in sleep and memory.'],
    ['u-ivo', 'ivo@example.hr', 'Ivo', 'Perić', 'Sveučilište u Zagrebu', 'PhD student', 'Works on hippocampal replay.'],
    ['u-mia', 'mia@example.com', 'Mia', 'Novak', 'Harvard Medical School', 'Postdoctoral fellow', 'Sleep researcher at Harvard.'],
    ['u-luka', 'luka@example.hr', 'Luka', 'Marić', 'KBC Zagreb', 'Medical student', null],
    ['u-eva', 'eva@example.hr', 'Eva', 'Babić', 'MEF Rijeka', 'Resident', null],
    ['u-hostA', 'hosta@example.hr', 'Petra', 'Kovač', 'MEF Zagreb', 'Professor of physiology', null],
    ['u-hostB', 'hostb@example.hr', 'Marko', 'Jurić', 'KBC Osijek', 'Consultant cardiologist', null],
    ['u-admin', 'admin@medx.hr', 'Laura', 'Rodman', 'Med&X', 'Operations', null]
];
MEMBERS.forEach(([id, email, fn, ln, inst, title, bio]) =>
    q.run('INSERT INTO users (id, email, first_name, last_name, institution, title, bio, is_admin) VALUES (?,?,?,?,?,?,?,?)',
        [id, email, fn, ln, inst, title, bio, id === 'u-admin' ? 1 : 0]));

q.run("INSERT INTO gala_settings (id, date, venue, city, is_registration_open, price_gala_early_bird, price_gala_regular, early_bird_deadline) VALUES ('default','2026-12-05','Hotel Esplanade','Zagreb',1,150,175,'2026-09-15')");
q.run("INSERT INTO conferences (id, name, slug, year, start_date, end_date, venue_name, venue_city, is_active, registration_open) VALUES ('c1','Plexus Conference 2026','plexus-2026',2026,'2026-12-04','2026-12-05','Novinarski dom','Zagreb',1,1)");
q.run("INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, registration_open) VALUES ('bb-zg','building-bridges','Building Bridges Zagreb','Zagreb','Novinarski dom','2026-12-03',1)");
q.run("INSERT INTO checkin_events (id, event_key, label, starts_at, ends_at) VALUES ('ce1','conference','Conference','2026-12-04T08:00:00','2026-12-05T20:00:00')");
q.run("INSERT INTO checkin_events (id, event_key, label, starts_at, ends_at) VALUES ('ce2','gala','Gala','2026-12-05T19:00:00','2026-12-05T23:59:00')");

// ---------------------------------------------------------------- email sink + auth stubs
const sent = [];
const sendEmail = async (to, subject, html) => { sent.push({ to, subject, html }); return { success: true }; };
const sentTo = (email) => sent.filter(e => String(e.to).toLowerCase() === String(email).toLowerCase());
const clearMail = () => { sent.length = 0; };

const auth = (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'Unauthorized' }); next(); };
const adminOnly = (req, res, next) => { if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Admin only' }); next(); };
const asUser = (id) => { const m = MEMBERS.find(x => x[0] === id); return { id: m[0], email: m[1], is_admin: m[0] === 'u-admin' }; };
const ADMIN = asUser('u-admin');

// ---------------------------------------------------------------- mount both modules
const app = stubApp();
const mountMeetups = require(path.join(ROOT, 'user-portal/backend/v2/meetups.js'));
const mountEditions = require(path.join(ROOT, 'user-portal/backend/v2/editions.js'));
const mountMeetupsOps = require(path.join(ROOT, 'admin-portal/backend/v2/meetups-ops.js'));
const mountEventDay = require(path.join(ROOT, 'admin-portal/backend/v2/event-day.js'));
const mountPlexusHub = require(path.join(ROOT, 'admin-portal/backend/v2/plexus-hub.js'));

mountEditions(app, { db: () => db, auth, adminOnly, optionalAuth: (q1, r, n) => n(), sendEmail, JWT_SECRET, ROOT, log: () => {} });
mountMeetups(app, { db: () => db, auth, adminOnly, optionalAuth: (q1, r, n) => n(), sendEmail, JWT_SECRET, ROOT, log: () => {} });
mountMeetupsOps(app, { db: () => db, auth, adminOnly, sendEmail, saveDb: () => {}, JWT_SECRET, ROOT, log: () => {} });
mountEventDay(app, { db: () => db, auth, adminOnly, saveDb: () => {}, JWT_SECRET, ROOT, log: () => {} });
mountPlexusHub(app, { db: () => db, auth, adminOnly, sendEmail, saveDb: () => {}, JWT_SECRET, ROOT, log: () => {} });

const M = mountMeetups._internals;
const sign = M.sign;

// ---------------------------------------------------------------- helpers
const ed = () => editionsLib.activeEdition(q);
async function createMeetup(over = {}) {
    const body = Object.assign({
        title: 'Coffee with the sleep group', kind: 'coffee',
        description: 'A small table for students and residents.',
        audience: 'Students & residents in neuroscience', tags: ['neuroscience', 'sleep'],
        venue_name: 'Café Dolac', venue_address: 'Dolac 1, Zagreb',
        starts_at: '2026-12-04T10:30',
        capacity: 3, waitlist_enabled: true, visibility: 'open',
        host_user_id: 'u-hostA'
    }, over);
    // an override that moves starts_at without an ends_at gets a matching +1 h end
    if (body.ends_at === undefined) {
        const m = String(body.starts_at).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
        body.ends_at = m ? `${m[1]}T${String(Math.min(23, Number(m[2]) + 1)).padStart(2, '0')}:${m[3]}` : null;
    }
    const r = await app.call('POST', '/api/v2/meetups-ops/meetups', { user: ADMIN, body });
    assert.strictEqual(r.status, 200, 'create returned ' + r.status + ' ' + JSON.stringify(r.body));
    return r.body.meetup;
}
const publish = (id) => app.call('POST', '/api/v2/meetups-ops/meetups/:id/publish', { user: ADMIN, params: { id } });
const join = (uid, id) => app.call('POST', '/api/v2/meetups/:id/join', { user: asUser(uid), params: { id } });
const cancel = (uid, id) => app.call('POST', '/api/v2/meetups/:id/cancel', { user: asUser(uid), params: { id } });
const rowFor = (mid, email) => q.get('SELECT * FROM plexus_meetup_attendees WHERE meetup_id = ? AND lower(email) = lower(?)', [mid, email]);

(async () => {
    console.log('meetups.test.js — hermetic (stub express, in-memory libsql, captured emails, no network)\n');

    // ============================================================ routes are mounted
    await t('every member + public route is mounted', () => {
        for (const k of [
            'GET /api/v2/meetups', 'GET /api/v2/meetups/mine', 'GET /api/v2/meetups/:id',
            'POST /api/v2/meetups/:id/join', 'POST /api/v2/meetups/:id/cancel',
            'GET /api/v2/meetups/:id/host', 'POST /api/v2/meetups/:id/host/scan', 'POST /api/v2/meetups/:id/host/message',
            'GET /meetups/manage/:token', 'POST /meetups/manage/:token',
            'GET /meetups/invite/:token/accept', 'GET /meetups/invite/:token/decline',
            'GET /meetups/host/:token', 'GET /api/v2/meetups/host/:token/data', 'POST /api/v2/meetups/host/:token/scan',
            'GET /api/v2/meetups/qr/:attendeeId.png', 'GET /api/v2/meetups/pass/:token.pkpass',
            'GET /api/v2/meetups/wallet/:token', 'GET /api/v2/meetups/calendar/:token.ics',
            'GET /api/v2/editions', 'GET /api/v2/plexus-week/overview'
        ]) assert.ok(app.routes[k], 'missing ' + k);
    });
    await t('every admin meetups-ops route is mounted', () => {
        for (const k of [
            'GET /api/v2/meetups-ops/overview', 'POST /api/v2/meetups-ops/meetups',
            'PUT /api/v2/meetups-ops/meetups/:id', 'POST /api/v2/meetups-ops/meetups/:id/publish',
            'POST /api/v2/meetups-ops/meetups/:id/cancel', 'DELETE /api/v2/meetups-ops/meetups/:id',
            'GET /api/v2/meetups-ops/meetups/:id/attendees', 'POST /api/v2/meetups-ops/meetups/:id/attendees',
            'GET /api/v2/meetups-ops/meetups/:id/attendees.csv',
            'POST /api/v2/meetups-ops/attendees/:aid/promote', 'POST /api/v2/meetups-ops/attendees/:aid/cancel',
            'POST /api/v2/meetups-ops/attendees/:aid/checkin', 'DELETE /api/v2/meetups-ops/attendees/:aid',
            'GET /api/v2/meetups-ops/meetups/:id/invites', 'POST /api/v2/meetups-ops/meetups/:id/invites',
            'GET /api/v2/meetups-ops/meetups/:id/host-link', 'GET /api/v2/meetups-ops/members'
        ]) assert.ok(app.routes[k], 'missing ' + k);
    });

    // ============================================================ EDITIONS
    await t('plexus-2026 is seeded active, 3–6 December, Zagreb', () => {
        const e = ed();
        assert.ok(e, 'no active edition');
        assert.strictEqual(e.id, 'plexus-2026');
        assert.strictEqual(Number(e.year), 2026);
        assert.strictEqual(e.status, 'active');
        assert.strictEqual(e.starts_on, '2026-12-03');
        assert.strictEqual(e.ends_on, '2026-12-06');
        assert.strictEqual(e.city, 'Zagreb');
    });

    await t('rollover is a no-op while the edition is still ahead (fake clock)', () => {
        const out = editionsLib.rollover(q, { now: '2026-11-01' });
        assert.deepStrictEqual(out.archived, []);
        assert.deepStrictEqual(out.created, []);
        assert.strictEqual(ed().id, 'plexus-2026');
    });
    await t('rollover is a no-op on the last day + 1 (boundary: ends_on + 1 day is not yet past)', () => {
        const out = editionsLib.rollover(q, { now: '2026-12-07' });
        assert.deepStrictEqual(out.archived, [], 'archived on the boundary day');
        assert.strictEqual(ed().id, 'plexus-2026');
    });
    await t('AUTO-ROLLOVER: once 2026 has passed, it archives and 2027 becomes active', () => {
        const out = editionsLib.rollover(q, { now: '2027-01-15' });
        assert.deepStrictEqual(out.archived, ['plexus-2026']);
        assert.deepStrictEqual(out.created, ['plexus-2027']);
        const e = ed();
        assert.strictEqual(e.id, 'plexus-2027');
        assert.strictEqual(e.label, 'Plexus Week 2027');
        assert.strictEqual(e.starts_on, '2027-12-03', 'same month/days, +1 year');
        assert.strictEqual(e.ends_on, '2027-12-06');
        assert.strictEqual(e.city, 'Zagreb');
        assert.strictEqual(editionsLib.getEdition(q, 'plexus-2026').status, 'archived');
        assert.ok(editionsLib.getEdition(q, 'plexus-2026').archived_at, 'archived_at stamped');
    });
    await t('rollover is IDEMPOTENT — running it again (or from the other backend) changes nothing', () => {
        const before = editionsLib.listEditions(q).length;
        editionsLib.rollover(q, { now: '2027-01-15' });
        editionsLib.bootstrap(q, { now: '2027-01-15' });        // what the second backend does at boot
        assert.strictEqual(editionsLib.listEditions(q).length, before, 'a duplicate edition was created');
        assert.strictEqual(ed().id, 'plexus-2027');
        assert.strictEqual(q.get("SELECT COUNT(*) c FROM plexus_editions WHERE status = 'active'").c, 1, 'more than one active edition');
    });
    await t('a two-year jump rolls through every edition in between', () => {
        editionsLib.rollover(q, { now: '2029-06-01' });
        assert.strictEqual(ed().id, 'plexus-2029');
        assert.strictEqual(editionsLib.getEdition(q, 'plexus-2027').status, 'archived');
        assert.strictEqual(editionsLib.getEdition(q, 'plexus-2028').status, 'archived');
        assert.strictEqual(q.get("SELECT COUNT(*) c FROM plexus_editions WHERE status = 'active'").c, 1);
    });
    await t('ADMIN SWITCHER: activate puts 2026 back, and exactly one edition stays active', async () => {
        const r = await app.call('POST', '/api/v2/plexus-hub/editions/:id/activate', { user: ADMIN, params: { id: 'plexus-2026' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.edition.id, 'plexus-2026');
        assert.strictEqual(r.body.active.id, 'plexus-2026');
        assert.strictEqual(ed().id, 'plexus-2026');
        assert.strictEqual(q.get("SELECT COUNT(*) c FROM plexus_editions WHERE status = 'active'").c, 1);
        assert.strictEqual(editionsLib.getEdition(q, 'plexus-2029').status, 'archived', 'the previous active edition is archived');
    });
    await t('ADMIN SWITCHER: the editions list, a manual create, a rename and a manual archive', async () => {
        const list = await app.call('GET', '/api/v2/plexus-hub/editions', { user: ADMIN });
        assert.strictEqual(list.status, 200);
        assert.ok(list.body.editions.length >= 4);

        const made = await app.call('POST', '/api/v2/plexus-hub/editions', { user: ADMIN, body: { year: 2031, starts_on: '2031-12-02', ends_on: '2031-12-05' } });
        assert.strictEqual(made.status, 200);
        assert.strictEqual(editionsLib.getEdition(q, 'plexus-2031').label, 'Plexus Week 2031');
        assert.strictEqual(editionsLib.getEdition(q, 'plexus-2031').status, 'upcoming');

        const dupe = await app.call('POST', '/api/v2/plexus-hub/editions', { user: ADMIN, body: { year: 2031 } });
        assert.strictEqual(dupe.status, 409);

        const bad = await app.call('POST', '/api/v2/plexus-hub/editions', { user: ADMIN, body: { year: 2032, starts_on: 'soon' } });
        assert.strictEqual(bad.status, 400);

        const renamed = await app.call('PATCH', '/api/v2/plexus-hub/editions/:id', { user: ADMIN, params: { id: 'plexus-2031' }, body: { label: 'Plexus Week 2031 — Split', city: 'Split' } });
        assert.strictEqual(renamed.status, 200);
        assert.strictEqual(renamed.body.edition.label, 'Plexus Week 2031 — Split');
        assert.strictEqual(renamed.body.edition.city, 'Split');

        const archived = await app.call('PATCH', '/api/v2/plexus-hub/editions/:id', { user: ADMIN, params: { id: 'plexus-2031' }, body: { status: 'archived' } });
        assert.strictEqual(archived.body.edition.status, 'archived');
        assert.ok(archived.body.edition.archived_at);
        assert.strictEqual(ed().id, 'plexus-2026', 'archiving another edition must not move the active one');

        const guest = await app.call('GET', '/api/v2/plexus-hub/editions', { user: asUser('u-ana') });
        assert.strictEqual(guest.status, 403, 'the editions API is admin-only');
    });

    await t('member /api/v2/editions lists every edition with the active one flagged', async () => {
        const r = await app.call('GET', '/api/v2/editions', { user: asUser('u-ana') });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.active.id, 'plexus-2026');
        assert.ok(r.body.editions.length >= 4);
        assert.ok(r.body.editions.some(e => e.status === 'archived'));
    });
    await t('/api/v2/editions needs a signed-in member (401 for a guest)', async () => {
        const r = await app.call('GET', '/api/v2/editions', {});
        assert.strictEqual(r.status, 401);
    });

    // ============================================================ PLEXUS WEEK OVERVIEW
    await t('Plexus Week overview returns the FOUR blocks in order', async () => {
        const r = await app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-ana') });
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.blocks.map(b => b.key), ['conference', 'gala', 'bridges', 'meetups']);
        assert.strictEqual(r.body.title, 'Plexus Week 2026');
        assert.strictEqual(r.body.blocks[2].title, 'Building Bridges Zagreb', 'Boston must never be a Plexus Week block');
    });
    await t('the STALE early-bird copy is gone: the gala block reads gala_settings, not "1 Sep"', async () => {
        const r = await app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-ana') });
        const gala = r.body.blocks.find(b => b.key === 'gala');
        assert.strictEqual(r.body.gala_price.flip_date, '2026-09-15');
        assert.strictEqual(r.body.gala_price.flip_label, '15 Sep');
        assert.ok(!/1 Sep\b/.test(gala.status + gala.price_label), 'stale 1 Sep copy: ' + gala.status);
        assert.ok(/15 Sep/.test(gala.status), 'gala status should quote the real flip date: ' + gala.status);
    });
    await t('moving the early-bird deadline in gala_settings moves the copy with it', async () => {
        q.run("UPDATE gala_settings SET early_bird_deadline = '2026-10-01' WHERE id = 'default'");
        const r = await app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-ana') });
        assert.strictEqual(r.body.gala_price.flip_label, '1 Oct');
        assert.ok(/1 Oct/.test(r.body.blocks.find(b => b.key === 'gala').status));
        q.run("UPDATE gala_settings SET early_bird_deadline = '2026-09-15' WHERE id = 'default'");
    });
    await t('an archived edition is served read-only', async () => {
        const r = await app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-ana'), query: { edition: 'plexus-2027' } });
        assert.strictEqual(r.body.edition.id, 'plexus-2027');
        assert.strictEqual(r.body.archived, true);
    });
    await t('a PAST edition never borrows this year\'s dates, venue or price', () => {
        // conferences / gala_settings / bridges_events each hold ONE live row with no per-year
        // history. Reading them under a 2027 label would print 2026's gala price as that year's.
        const past = q.get("SELECT * FROM plexus_editions WHERE id = 'plexus-2027'");
        const live = editionsLib.activeEdition(q);
        assert.notStrictEqual(past.status, 'active');
        return app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-ana'), query: { edition: 'plexus-2027' } }).then(r => {
            for (const key of ['conference', 'gala', 'bridges']) {
                const b = r.body.blocks.find(x => x.key === key);
                assert.strictEqual(b.historical, false, key + ' claimed to be historical data');
                assert.strictEqual(b.status, 'Not recorded');
                assert.strictEqual(b.price_label, null, key + ' quoted a price for a year we have no price for');
                assert.strictEqual(b.cta_label, null, key + ' offered an action on a closed edition');
                assert.ok(!/2026/.test(String(b.date_label || '')), key + ' printed 2026 dates under 2027: ' + b.date_label);
                assert.ok(String(b.date_label || '').includes('2027'), key + ' should quote the edition\'s own dates');
            }
            // the meetups block IS edition-scoped — it keeps answering for real
            const meet = r.body.blocks.find(x => x.key === 'meetups');
            assert.strictEqual(meet.meetups, 0, 'no meetups exist in 2027');
            // and the active edition still reads live
            return app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-ana'), query: { edition: live.id } });
        }).then(r2 => {
            assert.strictEqual(r2.body.blocks.find(x => x.key === 'gala').historical, true);
            assert.ok(r2.body.blocks.find(x => x.key === 'gala').price_label, 'the live edition still quotes the price');
        });
    });
    await t('editionForDate maps a legacy row to the edition of its created_at YEAR', () => {
        // Nothing is migrated (spec §1): croatians_abroad / gala rows carry no edition_id, so they
        // resolve through the year they were created in, falling back to the active edition.
        assert.strictEqual(editionsLib.editionForDate(q, '2027-04-02T09:00:00Z').id, 'plexus-2027');
        assert.strictEqual(editionsLib.editionForDate(q, '2026-11-30').id, 'plexus-2026');
        assert.strictEqual(editionsLib.editionForDate(q, '1999-01-01').id, ed().id, 'an unknown year falls back to the active edition');
        assert.strictEqual(editionsLib.editionForDate(q, null).id, ed().id);
    });

    // ============================================================ CREATE + PUBLISH
    let A = null;                       // the main 3-seat coffee table
    await t('admin creates a meetup as a draft, with a host from the member picker', async () => {
        A = await createMeetup();
        assert.strictEqual(A.status, 'draft');
        assert.strictEqual(A.capacity, 3);
        assert.strictEqual(A.host_name, 'Petra Kovač');
        assert.ok(/Professor of physiology/.test(A.host_title || ''), 'host title from the profile');
        assert.strictEqual(A.host_email, 'hosta@example.hr');
        assert.strictEqual(A.edition_id, 'plexus-2026');
        assert.deepStrictEqual(A.tags, ['neuroscience', 'sleep']);
    });
    await t('a draft is invisible on the member board', async () => {
        const r = await app.call('GET', '/api/v2/meetups', { user: asUser('u-ana') });
        assert.strictEqual(r.body.meetups.length, 0);
    });
    await t('publishing mints the host token and puts it on the board', async () => {
        const r = await publish(A.id);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.meetup.status, 'published');
        assert.ok(r.body.meetup.host_link, 'host link');
        const row = q.get('SELECT host_token FROM plexus_meetups WHERE id = ?', [A.id]);
        assert.match(row.host_token, /^[0-9a-f]{32}$/, 'host token is 32 hex');
        assert.strictEqual(row.host_token, sign('host', A.id), 'host token is HMAC(medxmeet:host:<id>)');
        const b = await app.call('GET', '/api/v2/meetups', { user: asUser('u-ana') });
        assert.strictEqual(b.body.meetups.length, 1);
        assert.strictEqual(b.body.meetups[0].spots_left, 3);
    });
    await t('publishing without a host is refused', async () => {
        const d = await createMeetup({ title: 'Hostless', host_user_id: null, host_name: '', host_email: '' });
        const r = await publish(d.id);
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /host/i);
        await app.call('DELETE', '/api/v2/meetups-ops/meetups/:id', { user: ADMIN, params: { id: d.id } });
    });
    await t('validation: bad capacity, bad date, ends before starts', async () => {
        for (const [body, why] of [
            [{ capacity: 0 }, 'capacity 0'], [{ capacity: 999 }, 'capacity 999'],
            [{ starts_at: 'next tuesday' }, 'free-text date'],
            [{ starts_at: '2026-12-04T10:30', ends_at: '2026-12-04T09:00' }, 'ends before starts']
        ]) {
            const r = await app.call('POST', '/api/v2/meetups-ops/meetups', { user: ADMIN, body: Object.assign({ title: 'X', starts_at: '2026-12-04T10:30', capacity: 4 }, body) });
            assert.strictEqual(r.status, 400, why + ' was accepted');
        }
    });

    // ============================================================ CAPACITY BOUNDARY
    await t('CAPACITY BOUNDARY: the first 3 are confirmed, the 4th is waitlisted', async () => {
        clearMail();
        for (const u of ['u-ana', 'u-ivo', 'u-mia']) {
            const r = await join(u, A.id);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.body.status, 'confirmed', u + ' should be confirmed');
        }
        const full = await join('u-luka', A.id);
        assert.strictEqual(full.body.status, 'waitlisted');
        assert.strictEqual(full.body.meetup.confirmed, 3);
        assert.strictEqual(full.body.meetup.spots_left, 0);
        assert.strictEqual(full.body.meetup.full, true);
    });
    await t('the confirmation email carries the QR, the wallet links AND the cancel link', () => {
        const e = sentTo('ana@example.hr')[0];
        assert.ok(e, 'no confirmation email');
        assert.match(e.subject, /You are in/);
        const row = rowFor(A.id, 'ana@example.hr');
        assert.ok(e.html.includes('/api/v2/meetups/qr/' + row.id + '.png'), 'hosted QR image');
        assert.ok(e.html.includes('/meetups/manage/' + row.manage_token), 'cancel link');
        assert.ok(e.html.includes('pay.google.com/gp/v/save/'), 'Google Wallet save link');
        assert.ok(e.html.includes('/api/v2/meetups/calendar/' + row.manage_token + '.ics'), 'calendar link');
        assert.ok(/background:#291e14|background:#120e0a/.test(e.html), 'house DARK shell (tone:dark)');
    });
    await t('the waitlist email says the position and carries the cancel link', () => {
        const e = sentTo('luka@example.hr')[0];
        assert.match(e.subject, /Waitlisted/);
        assert.match(e.html, /first in line/i);
        assert.ok(e.html.includes('/meetups/manage/' + rowFor(A.id, 'luka@example.hr').manage_token));
    });
    await t('the host gets a one-line FYI for each new confirmed guest', () => {
        const h = sentTo('hosta@example.hr');
        assert.strictEqual(h.length, 3, 'one FYI per confirmed join, none for the waitlisted one');
        assert.match(h[0].subject, /list update/);
    });
    await t('a member with an account gets NO signup nudge; a non-member does', async () => {
        assert.ok(!/Create your Med&amp;X account/.test(sentTo('ana@example.hr')[0].html), 'member got the nudge');
        const r = await app.call('POST', '/api/v2/meetups-ops/meetups/:id/attendees', {
            user: ADMIN, params: { id: A.id }, body: { email: 'outsider@example.org', name: 'Outside Person' }
        });
        assert.strictEqual(r.body.status, 'waitlisted');
        assert.ok(/Create your Med&amp;X account/.test(sentTo('outsider@example.org')[0].html), 'non-member missed the nudge');
    });
    await t('joining twice is idempotent — no second row, no second email', async () => {
        const before = sentTo('ana@example.hr').length;
        const r = await join('u-ana', A.id);
        assert.strictEqual(r.body.already, true);
        assert.strictEqual(r.body.status, 'confirmed');
        assert.strictEqual(q.get('SELECT COUNT(*) c FROM plexus_meetup_attendees WHERE meetup_id = ? AND lower(email) = ?', [A.id, 'ana@example.hr']).c, 1);
        assert.strictEqual(sentTo('ana@example.hr').length, before, 'a duplicate email was sent');
    });

    // ============================================================ WAITLIST ORDERING
    await t('WAITLIST ORDERING: positions are 1, 2, 3 in arrival order', async () => {
        await join('u-eva', A.id);
        const w = core.waitingOf(q, A.id);
        assert.deepStrictEqual(w.map(a => a.email), ['luka@example.hr', 'outsider@example.org', 'eva@example.hr']);
        assert.deepStrictEqual(w.map(a => Number(a.waitlist_pos)), [1, 2, 3]);
    });

    // ============================================================ CANCEL → PROMOTE
    await t('CANCEL → PROMOTE: one cancel promotes exactly the first person waiting', async () => {
        clearMail();
        const r = await cancel('u-ana', A.id);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.promoted, true);
        const receipt = sentTo('ana@example.hr')[0];
        assert.ok(receipt, 'the portal button should leave a receipt — its toast is gone in a second');
        assert.match(receipt.html, /Thank you for telling us/, 'a self-cancel is thanked');
        const luka = rowFor(A.id, 'luka@example.hr');
        assert.strictEqual(luka.status, 'confirmed');
        assert.ok(luka.promoted_at, 'promoted_at stamped');
        assert.strictEqual(luka.waitlist_pos, null, 'promoted rows leave the queue');
        assert.strictEqual(core.confirmedCount(q, A.id), 3, 'never over-fills, never under-fills');
    });
    await t('the promoted person is told, with ticket assets and the cancel link', () => {
        const e = sentTo('luka@example.hr').find(x => /A place opened/.test(x.subject));
        assert.ok(e, 'no promotion email');
        assert.match(e.html, /You are in/i);
        assert.ok(e.html.includes('/meetups/manage/' + rowFor(A.id, 'luka@example.hr').manage_token));
        assert.ok(e.html.includes('/api/v2/meetups/qr/'), 'ticket QR');
    });
    await t('the host is told about the promotion (one line, only when host_email exists)', () => {
        const h = sentTo('hosta@example.hr').find(x => /list update/.test(x.subject));
        assert.ok(h, 'host FYI missing');
        assert.match(h.html, /moved up from the waitlist/);
    });
    await t('the rest of the queue is RENUMBERED with no gap', () => {
        const w = core.waitingOf(q, A.id);
        assert.deepStrictEqual(w.map(a => a.email), ['outsider@example.org', 'eva@example.hr']);
        assert.deepStrictEqual(w.map(a => Number(a.waitlist_pos)), [1, 2]);
    });
    await t('ATOMICITY: two cancels in a row promote two DISTINCT people', async () => {
        const first = core.waitingOf(q, A.id)[0].email;
        await cancel('u-ivo', A.id);
        const secondNext = core.waitingOf(q, A.id)[0].email;
        await cancel('u-mia', A.id);
        assert.notStrictEqual(first, secondNext, 'the same person would have been promoted twice');
        assert.strictEqual(rowFor(A.id, first).status, 'confirmed');
        assert.strictEqual(rowFor(A.id, secondNext).status, 'confirmed');
        assert.strictEqual(core.waitingOf(q, A.id).length, 0, 'queue should be empty now');
        assert.strictEqual(core.confirmedCount(q, A.id), 3, 'still exactly capacity');
        const promoted = q.all("SELECT email FROM plexus_meetup_attendees WHERE meetup_id = ? AND promoted_at IS NOT NULL", [A.id]).map(r => r.email);
        assert.strictEqual(new Set(promoted).size, promoted.length, 'a person was promoted twice');
    });
    await t('cancelling when nobody is waiting simply frees the place', async () => {
        const before = core.confirmedCount(q, A.id);
        const r = await cancel('u-luka', A.id);
        assert.strictEqual(r.body.promoted, false);
        assert.strictEqual(core.confirmedCount(q, A.id), before - 1);
    });

    // ============================================================ RE-JOIN AFTER CANCEL
    await t('RE-JOIN after cancel: a free place is taken again, cleanly', async () => {
        const r = await join('u-luka', A.id);
        assert.strictEqual(r.body.status, 'confirmed');
        const row = rowFor(A.id, 'luka@example.hr');
        assert.strictEqual(row.cancelled_at, null, 'the cancel stamp is cleared on re-join');
        assert.strictEqual(q.get('SELECT COUNT(*) c FROM plexus_meetup_attendees WHERE meetup_id = ? AND lower(email) = ?', [A.id, 'luka@example.hr']).c, 1, 'no duplicate row');
    });
    await t('RE-JOIN after cancel when the table is full: goes to the BACK of the queue', async () => {
        // fill the table, then queue two people, cancel the first of them, re-join → last
        const B = await createMeetup({ title: 'Lunch with the cardiology group', kind: 'lunch', capacity: 1, host_user_id: 'u-hostB', starts_at: '2026-12-05T12:30' });
        await publish(B.id);
        await join('u-ana', B.id);                       // confirmed
        await join('u-ivo', B.id);                       // waitlist 1
        await join('u-mia', B.id);                       // waitlist 2
        await cancel('u-ivo', B.id);
        assert.strictEqual(Number(rowFor(B.id, 'mia@example.com').waitlist_pos), 1, 'the queue closed up');
        await join('u-luka', B.id);                      // waitlist 2
        const again = await join('u-ivo', B.id);         // re-join → must be LAST, not 1
        assert.strictEqual(again.body.status, 'waitlisted');
        const w = core.waitingOf(q, B.id);
        assert.deepStrictEqual(w.map(a => a.email), ['mia@example.com', 'luka@example.hr', 'ivo@example.hr'], 'a re-join must go to the back');
        assert.deepStrictEqual(w.map(a => Number(a.waitlist_pos)), [1, 2, 3]);
    });

    // ============================================================ MANAGE TOKEN PAGES
    let anaRow = null, C = null;
    await t('the public manage page renders the place and a cancel button', async () => {
        C = await createMeetup({ title: 'Walk up to Grič', kind: 'walk', capacity: 2, starts_at: '2026-12-05T16:00' });
        await publish(C.id);
        await join('u-ana', C.id);
        anaRow = rowFor(C.id, 'ana@example.hr');
        const r = await app.call('GET', '/meetups/manage/:token', { params: { token: anaRow.manage_token } });
        assert.strictEqual(r.status, 200);
        assert.match(r.body, /Walk up to Gri/);
        assert.match(r.body, /Cancel my place/);
        assert.ok(r.body.includes(`action="/meetups/manage/${anaRow.manage_token}"`), 'the form posts to the same path');
    });
    await t('MANAGE-TOKEN FORGERY → 404 (random token)', async () => {
        const r = await app.call('GET', '/meetups/manage/:token', { params: { token: crypto.randomBytes(16).toString('hex') } });
        assert.strictEqual(r.status, 404);
        assert.match(r.body, /not available/i);
    });
    await t('MANAGE-TOKEN FORGERY → 404 (one character flipped)', async () => {
        const bad = anaRow.manage_token.slice(0, -1) + (anaRow.manage_token.slice(-1) === 'a' ? 'b' : 'a');
        const r = await app.call('GET', '/meetups/manage/:token', { params: { token: bad } });
        assert.strictEqual(r.status, 404);
    });
    await t('MANAGE-TOKEN FORGERY → 404 (a token planted in the DB fails the HMAC check)', async () => {
        // The lookup would find this row; only the timingSafeEqual against the recomputed HMAC
        // rejects it. This is the test that proves the signature check is real.
        const planted = 'deadbeef'.repeat(4);
        const victim = rowFor(C.id, 'ana@example.hr');
        const keep = victim.manage_token;
        q.run('UPDATE plexus_meetup_attendees SET manage_token = ? WHERE id = ?', [planted, victim.id]);
        const r = await app.call('GET', '/meetups/manage/:token', { params: { token: planted } });
        assert.strictEqual(r.status, 404, 'a planted token was accepted');
        q.run('UPDATE plexus_meetup_attendees SET manage_token = ? WHERE id = ?', [keep, victim.id]);
    });
    await t('a wrongly-shaped token never reaches the database', async () => {
        for (const bad of ['', 'x', '../../etc/passwd', 'A'.repeat(32), '0123456789abcdef']) {
            const r = await app.call('GET', '/meetups/manage/:token', { params: { token: bad } });
            assert.strictEqual(r.status, 404, 'accepted ' + JSON.stringify(bad));
        }
    });
    await t('CANCEL BY EMAIL: POST on the manage token releases the place and promotes', async () => {
        await join('u-ivo', C.id);                       // C is now full (capacity 2)
        await join('u-mia', C.id);                       // waitlisted
        clearMail();
        const r = await app.call('POST', '/meetups/manage/:token', { params: { token: rowFor(C.id, 'ana@example.hr').manage_token } });
        assert.strictEqual(r.status, 200);
        assert.match(r.body, /Your place is released/);
        assert.strictEqual(rowFor(C.id, 'ana@example.hr').status, 'cancelled');
        assert.strictEqual(rowFor(C.id, 'mia@example.com').status, 'confirmed');
        assert.ok(sentTo('mia@example.com').some(e => /A place opened/.test(e.subject)), 'promotion email');
        assert.strictEqual(sentTo('ana@example.hr').length, 0, 'no redundant "you cancelled" mail — she is looking at the page');
    });
    await t('cancelling twice from the page is harmless', async () => {
        const tok = rowFor(C.id, 'ana@example.hr').manage_token;
        const r = await app.call('POST', '/meetups/manage/:token', { params: { token: tok } });
        assert.strictEqual(r.status, 200);
        assert.match(r.body, /Cancelled|no longer on the list/i);
    });

    // ============================================================ INVITE-ONLY
    let INV = null;
    await t('invite-only meetups are invisible on the board until you are invited', async () => {
        INV = await createMeetup({ title: 'Dinner with the visiting keynote', kind: 'dinner', capacity: 2, visibility: 'invite', starts_at: '2026-12-05T20:00' });
        await publish(INV.id);
        const r = await app.call('GET', '/api/v2/meetups', { user: asUser('u-eva') });
        assert.ok(!r.body.meetups.some(m => m.id === INV.id), 'an invite-only meetup leaked onto the board');
        const j = await join('u-eva', INV.id);
        assert.strictEqual(j.status, 403, 'an uninvited member could join');
    });
    await t('sending invitations creates invited rows and one email each', async () => {
        clearMail();
        const r = await app.call('POST', '/api/v2/meetups-ops/meetups/:id/invites', {
            user: ADMIN, params: { id: INV.id },
            body: { people: [{ email: 'eva@example.hr' }, { email: 'mia@example.com' }, { email: 'not-an-email' }] }
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.invited, 2);
        assert.strictEqual(r.body.mailed, 2);
        assert.deepStrictEqual(r.body.invalid, ['not-an-email']);
        assert.strictEqual(rowFor(INV.id, 'eva@example.hr').status, 'invited');
        const e = sentTo('eva@example.hr')[0];
        assert.match(e.subject, /An invitation/);
        assert.match(e.html, /Would you join .* for dinner\?/);
        assert.ok(e.html.includes('/meetups/invite/' + rowFor(INV.id, 'eva@example.hr').manage_token + '/accept'), 'Accept button');
        assert.ok(e.html.includes('/meetups/invite/' + rowFor(INV.id, 'eva@example.hr').manage_token + '/decline'), 'Decline button');
    });
    await t('the invites drawer can PREVIEW the email without sending anything', async () => {
        clearMail();
        const r = await app.call('POST', '/api/v2/meetups-ops/meetups/:id/invites', {
            user: ADMIN, params: { id: INV.id }, body: { people: ['someone@example.org'], preview: true }
        });
        assert.strictEqual(r.body.preview, true);
        assert.match(r.body.subject, /An invitation/);
        assert.strictEqual(sent.length, 0, 'a preview sent mail');
        assert.strictEqual(rowFor(INV.id, 'someone@example.org'), null, 'a preview created a row');
    });
    await t('an invited member sees the meetup on their board', async () => {
        const r = await app.call('GET', '/api/v2/meetups', { user: asUser('u-eva') });
        assert.ok(r.body.meetups.some(m => m.id === INV.id));
        assert.strictEqual(r.body.meetups.find(m => m.id === INV.id).my_status, 'invited');
    });
    await t('INVITE ACCEPT (public GET on the manage token) confirms the place', async () => {
        clearMail();
        const tok = rowFor(INV.id, 'eva@example.hr').manage_token;
        const r = await app.call('GET', '/meetups/invite/:token/accept', { params: { token: tok } });
        assert.strictEqual(r.status, 200);
        assert.match(r.body, /you are in/i);
        assert.strictEqual(rowFor(INV.id, 'eva@example.hr').status, 'confirmed');
        assert.ok(sentTo('eva@example.hr').some(e => /You are in/.test(e.subject)), 'confirmation email after accept');
    });
    await t('INVITE DECLINE marks the row declined and sends nothing to the guest', async () => {
        clearMail();
        const tok = rowFor(INV.id, 'mia@example.com').manage_token;
        const r = await app.call('GET', '/meetups/invite/:token/decline', { params: { token: tok } });
        assert.strictEqual(r.status, 200);
        assert.match(r.body, /Thank you for telling us/);
        assert.strictEqual(rowFor(INV.id, 'mia@example.com').status, 'declined');
        assert.strictEqual(sentTo('mia@example.com').length, 0);
    });
    await t('a declined invitation drops the meetup off that member\'s board again', async () => {
        const r = await app.call('GET', '/api/v2/meetups', { user: asUser('u-mia') });
        assert.ok(!r.body.meetups.some(m => m.id === INV.id));
    });
    await t('accepting an invitation to a FULL table waitlists instead', async () => {
        await app.call('PUT', '/api/v2/meetups-ops/meetups/:id', { user: ADMIN, params: { id: INV.id }, body: { capacity: 1 } });
        const r = await app.call('POST', '/api/v2/meetups-ops/meetups/:id/invites', { user: ADMIN, params: { id: INV.id }, body: { people: ['luka@example.hr'] } });
        assert.strictEqual(r.body.invited, 1);
        const out = await app.call('GET', '/meetups/invite/:token/accept', { params: { token: rowFor(INV.id, 'luka@example.hr').manage_token } });
        assert.match(out.body, /waitlist/i);
        assert.strictEqual(rowFor(INV.id, 'luka@example.hr').status, 'waitlisted');
    });
    await t('an invite forged token 404s just like a manage token', async () => {
        const r = await app.call('GET', '/meetups/invite/:token/accept', { params: { token: crypto.randomBytes(16).toString('hex') } });
        assert.strictEqual(r.status, 404);
    });

    // ============================================================ HOST SCOPING
    let HOSTB = null;
    await t('HOST SCOPING: host A cannot read meetup B — 404, never 403', async () => {
        HOSTB = q.get("SELECT * FROM plexus_meetups WHERE host_user_id = 'u-hostB' LIMIT 1");
        assert.ok(HOSTB, 'fixture: a meetup hosted by B');
        const own = await app.call('GET', '/api/v2/meetups/:id/host', { user: asUser('u-hostA'), params: { id: A.id } });
        assert.strictEqual(own.status, 200, 'host A must see her own meetup');
        const other = await app.call('GET', '/api/v2/meetups/:id/host', { user: asUser('u-hostA'), params: { id: HOSTB.id } });
        assert.strictEqual(other.status, 404, 'host A read host B\'s meetup (' + other.status + ')');
        assert.ok(!/forbidden|not allowed/i.test(JSON.stringify(other.body)), 'a 403-flavoured answer leaks that B exists');
    });
    await t('a plain member is not a host of anything', async () => {
        const r = await app.call('GET', '/api/v2/meetups/:id/host', { user: asUser('u-ana'), params: { id: A.id } });
        assert.strictEqual(r.status, 404);
    });
    await t('the host token page shows ONLY its own meetup, with profile snippets', async () => {
        const tok = q.get('SELECT host_token FROM plexus_meetups WHERE id = ?', [A.id]).host_token;
        const r = await app.call('GET', '/meetups/host/:token', { params: { token: tok } });
        assert.strictEqual(r.status, 200);
        assert.match(r.body, /Coffee with the sleep group/);
        assert.ok(!r.body.includes('Lunch with the cardiology group'), 'another meetup leaked onto the host page');
        assert.match(r.body, /COMING/);
        assert.match(r.body, /YOUR TABLE/);
        // the camera scanner, gated by the host token, with a manual box that always works
        assert.ok(r.body.includes('/vendor/jsqr/jsQR.min.js'), 'the host page needs the vendored decoder');
        assert.ok(r.body.includes("'/api/v2/meetups/host/'"), 'the scanner posts to the host-scan route');
        assert.ok(r.body.includes(JSON.stringify(tok)), 'the scanner is bound to THIS page\'s token');
        assert.match(r.body, /type the code/, 'a manual fallback must always be there');
        assert.match(r.body, /entirely optional/, 'check-in is optional in practice — say so');
    });
    await t('a forged host token 404s', async () => {
        const r = await app.call('GET', '/meetups/host/:token', { params: { token: crypto.randomBytes(16).toString('hex') } });
        assert.strictEqual(r.status, 404);
    });
    await t('the host JSON carries name · institution · position · bio for each attendee', async () => {
        const tok = q.get('SELECT host_token FROM plexus_meetups WHERE id = ?', [A.id]).host_token;
        const r = await app.call('GET', '/api/v2/meetups/host/:token/data', { params: { token: tok } });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.attendees.length >= 1);
        const mia = r.body.attendees.concat(r.body.waitlist).find(a => a.email === 'mia@example.com')
            || r.body.attendees[0];
        assert.ok('institution' in mia && 'position' in mia && 'bio' in mia, 'profile fields missing');
        assert.strictEqual(typeof r.body.headcount.confirmed, 'number');
        assert.strictEqual(typeof r.body.headcount.capacity, 'number');
    });
    await t('the host scanner checks a guest in and answers with the profile snippet', async () => {
        const tok = q.get('SELECT host_token FROM plexus_meetups WHERE id = ?', [A.id]).host_token;
        const someone = core.liveOf(q, A.id)[0];
        const r = await app.call('POST', '/api/v2/meetups/host/:token/scan', { params: { token: tok }, body: { code: 'm-' + someone.id } });
        assert.strictEqual(r.body.ok, true);
        assert.strictEqual(r.body.result, 'checked_in');
        assert.ok(r.body.person.name);
        assert.ok('institution' in r.body.person && 'position' in r.body.person && 'bio' in r.body.person);
        assert.strictEqual(Number(q.get('SELECT checked_in c FROM plexus_meetup_attendees WHERE id = ?', [someone.id]).c), 1);
        const again = await app.call('POST', '/api/v2/meetups/host/:token/scan', { params: { token: tok }, body: { code: 'm-' + someone.id } });
        assert.strictEqual(again.body.result, 'already');
    });
    await t('a host scanner refuses a code from ANOTHER meetup', async () => {
        const tok = q.get('SELECT host_token FROM plexus_meetups WHERE id = ?', [A.id]).host_token;
        const foreign = core.liveOf(q, HOSTB.id)[0] || core.attendeesOf(q, HOSTB.id)[0];
        const r = await app.call('POST', '/api/v2/meetups/host/:token/scan', { params: { token: tok }, body: { code: 'm-' + foreign.id } });
        assert.strictEqual(r.body.ok, false);
        assert.strictEqual(r.body.result, 'wrong_meetup');
    });
    await t('"message my attendees" stages DRAFTS for approval and sends nothing', async () => {
        clearMail();
        const r = await app.call('POST', '/api/v2/meetups/:id/host/message', {
            user: asUser('u-hostA'), params: { id: A.id }, body: { subject: 'Running five minutes late', body: 'Order a coffee, I am on my way.' }
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.approval_required, true);
        assert.ok(r.body.staged >= 1);
        assert.strictEqual(sent.length, 0, 'a host message went out without approval');
        const rows = q.all("SELECT * FROM scheduled_emails WHERE source_engine = 'v2-meetups' AND status = 'pending_approval'");
        assert.strictEqual(rows.length, r.body.staged);
        assert.ok(JSON.parse(rows[0].payload_json).html.includes('Running five minutes late'));
    });
    await t('a non-host cannot message someone else\'s attendees', async () => {
        const r = await app.call('POST', '/api/v2/meetups/:id/host/message', { user: asUser('u-ana'), params: { id: A.id }, body: { subject: 'x', body: 'y' } });
        assert.strictEqual(r.status, 404);
    });

    // ============================================================ WALLET + QR + CALENDAR
    await t('the branded QR renders a PNG for a real attendee and 404s for anything else', async () => {
        const a = core.liveOf(q, A.id)[0];
        const r = await app.call('GET', '/api/v2/meetups/qr/:attendeeId.png', { params: { attendeeId: a.id } });
        if (r.status === 503) { console.log('        (qrcode/pngjs not installed — QR render skipped)'); }
        else {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.headers['content-type'], 'image/png');
            assert.ok(Buffer.isBuffer(r.body) && r.body.length > 500, 'PNG body');
            assert.strictEqual(r.body.slice(1, 4).toString(), 'PNG');
        }
        const bad = await app.call('GET', '/api/v2/meetups/qr/:attendeeId.png', { params: { attendeeId: crypto.randomUUID() } });
        assert.strictEqual(bad.status, 404);
    });
    await t('Google Wallet gives a signed save link on the manage token', async () => {
        const a = core.liveOf(q, A.id)[0];
        const r = await app.call('GET', '/api/v2/meetups/wallet/:token', { params: { token: a.manage_token }, query: { format: 'json' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.configured, true);
        assert.ok(r.body.save_url.startsWith('https://pay.google.com/gp/v/save/'));
        const jwt = r.body.save_url.split('/save/')[1];
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        assert.strictEqual(payload.payload.eventTicketObjects[0].barcode.value, 'm-' + a.id, 'the QR payload IS the barcode');
        assert.ok(payload.payload.eventTicketClasses[0].id.endsWith('plexus-meetup-' + A.id), 'class per meetup');
    });
    await t('Apple Wallet answers 503 (unconfigured) rather than erroring', async () => {
        const a = core.liveOf(q, A.id)[0];
        const r = await app.call('GET', '/api/v2/meetups/pass/:token.pkpass', { params: { token: a.manage_token } });
        assert.strictEqual(r.status, 503);
        assert.match(r.body.error, /QR in your email/);
    });
    await t('the calendar file is a valid single-event ICS in Europe/Zagreb', async () => {
        const a = core.liveOf(q, A.id)[0];
        const r = await app.call('GET', '/api/v2/meetups/calendar/:token.ics', { params: { token: a.manage_token } });
        assert.strictEqual(r.status, 200);
        assert.match(r.body, /^BEGIN:VCALENDAR/);
        assert.match(r.body, /TZID:Europe\/Zagreb/);
        assert.match(r.body, /DTSTART;TZID=Europe\/Zagreb:20261204T103000/);
        assert.match(r.body, /DTEND;TZID=Europe\/Zagreb:20261204T113000/);
        assert.match(r.body, /END:VCALENDAR$/);
    });
    await t('every asset route 404s on a forged token', async () => {
        const bad = crypto.randomBytes(16).toString('hex');
        for (const p of ['GET /api/v2/meetups/pass/:token.pkpass', 'GET /api/v2/meetups/wallet/:token', 'GET /api/v2/meetups/calendar/:token.ics']) {
            const [m, route] = p.split(' ');
            const r = await app.call(m, route, { params: { token: bad } });
            assert.strictEqual(r.status, 404, p + ' answered ' + r.status);
        }
    });

    // ============================================================ REMINDERS
    await t('REMINDER: confirmed attendees get one, 24 h before', async () => {
        clearMail();
        const out = await M.runReminders({ now: '2026-12-03T10:30:00Z' });
        assert.ok(out.sent >= 1, 'no reminders went out');
        const e = sent.find(x => /^Tomorrow — Coffee with the sleep group$/.test(x.subject));
        assert.ok(e, 'no reminder for the coffee table');
        assert.match(e.html, /See you tomorrow/);
        assert.ok(e.html.includes('/meetups/manage/'), 'the reminder carries the cancel link');
    });
    await t('REMINDER IDEMPOTENCY: a second run sends nothing', async () => {
        clearMail();
        const out = await M.runReminders({ now: '2026-12-03T10:30:00Z' });
        assert.strictEqual(out.sent, 0, out.sent + ' duplicate reminders');
        assert.ok(out.skipped >= 1, 'the audit trail should have blocked them');
        assert.strictEqual(sent.length, 0);
    });
    await t('starts_at is read as Europe/Zagreb wall time, never the server clock', () => {
        // Render runs UTC, a laptop runs anything — Date.parse('2026-12-04T10:30') would slide the
        // 24 h window by the host's offset. zagrebMs pins it to CET/CEST.
        assert.strictEqual(new Date(core.zagrebMs('2026-12-04T10:30')).toISOString(), '2026-12-04T09:30:00.000Z', 'CET (+1) in December');
        assert.strictEqual(new Date(core.zagrebMs('2026-07-04T10:30')).toISOString(), '2026-07-04T08:30:00.000Z', 'CEST (+2) in July');
        assert.strictEqual(new Date(core.lastSundayUtc(2026, 2)).toISOString().slice(0, 10), '2026-03-29', 'EU DST starts the last Sunday in March');
        assert.strictEqual(new Date(core.lastSundayUtc(2026, 9)).toISOString().slice(0, 10), '2026-10-25', 'EU DST ends the last Sunday in October');
        assert.ok(Number.isNaN(core.zagrebMs('next tuesday')));
    });
    await t('REMINDER: nothing goes out outside the 24 h window', async () => {
        clearMail();
        const out = await M.runReminders({ now: '2026-11-01T09:00:00Z' });
        assert.strictEqual(out.sent, 0);
        assert.strictEqual(sent.length, 0);
    });
    await t('REMINDER: waitlisted people are not reminded', () => {
        const waitlisted = core.waitingOf(q, INV.id)[0];
        if (!waitlisted) return;
        assert.strictEqual(q.get('SELECT COUNT(*) c FROM plexus_meetup_audit WHERE attendee_id = ? AND action = ?', [waitlisted.id, 'reminder-sent']).c, 0);
    });

    // ============================================================ ADMIN DRAWERS
    await t('the attendees drawer buckets confirmed · waitlist · invited · declined · cancelled', async () => {
        const r = await app.call('GET', '/api/v2/meetups-ops/meetups/:id/attendees', { user: ADMIN, params: { id: A.id } });
        assert.strictEqual(r.status, 200);
        for (const k of ['confirmed', 'waitlist', 'invited', 'declined', 'cancelled']) assert.ok(Array.isArray(r.body[k]), 'missing ' + k);
        assert.ok(r.body.confirmed.length >= 1);
        assert.ok(r.body.confirmed[0].manage_url.includes('/meetups/manage/'));
    });
    await t('admin check-in and undo both work from the list', async () => {
        const a = core.liveOf(q, A.id).find(x => !Number(x.checked_in)) || core.liveOf(q, A.id)[0];
        const on = await app.call('POST', '/api/v2/meetups-ops/attendees/:aid/checkin', { user: ADMIN, params: { aid: a.id }, body: { checked_in: true } });
        assert.strictEqual(on.body.attendee.checked_in, true);
        const off = await app.call('POST', '/api/v2/meetups-ops/attendees/:aid/checkin', { user: ADMIN, params: { aid: a.id }, body: { checked_in: false } });
        assert.strictEqual(off.body.attendee.checked_in, false);
    });
    await t('an ORGANIZER releasing a place never thanks the guest for doing it', async () => {
        const F = await createMeetup({ title: 'Coffee before the keynote', capacity: 2, starts_at: '2026-12-04T08:30' });
        await publish(F.id);
        await join('u-ana', F.id);
        clearMail();
        const r = await app.call('POST', '/api/v2/meetups-ops/attendees/:aid/cancel', {
            user: ADMIN, params: { aid: rowFor(F.id, 'ana@example.hr').id }, body: { reason: 'the table moved to Friday' }
        });
        assert.strictEqual(r.status, 200);
        const e = sentTo('ana@example.hr')[0];
        assert.ok(e, 'the guest must be told');
        assert.match(e.subject, /Your place is released/);
        assert.match(e.html, /One of the organizers has released your place/);
        assert.match(e.html, /the table moved to Friday/);
        assert.ok(!/Thank you for telling us/.test(e.html), 'the guest did not do this — do not thank them for it');
    });
    await t('an admin can force-promote, and cannot promote into a full table', async () => {
        const D = await createMeetup({ title: 'Visit to the sleep lab', kind: 'visit', capacity: 1, starts_at: '2026-12-04T15:00' });
        await publish(D.id);
        await join('u-ana', D.id);
        await join('u-ivo', D.id);                       // waitlisted
        const nope = await app.call('POST', '/api/v2/meetups-ops/attendees/:aid/promote', { user: ADMIN, params: { aid: rowFor(D.id, 'ivo@example.hr').id } });
        assert.strictEqual(nope.status, 400);
        assert.match(nope.body.error, /full/i);
        await app.call('PUT', '/api/v2/meetups-ops/meetups/:id', { user: ADMIN, params: { id: D.id }, body: { capacity: 2 } });
        const ok = await app.call('POST', '/api/v2/meetups-ops/attendees/:aid/promote', { user: ADMIN, params: { aid: rowFor(D.id, 'ivo@example.hr').id } });
        assert.strictEqual(ok.status, 200);
        assert.strictEqual(rowFor(D.id, 'ivo@example.hr').status, 'confirmed');
    });
    await t('capacity can never be cut below the people already holding a place', async () => {
        const r = await app.call('PUT', '/api/v2/meetups-ops/meetups/:id', { user: ADMIN, params: { id: A.id }, body: { capacity: 1 } });
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /already hold a place/);
    });
    await t('cancelling a meetup tells everyone who held or awaited a place', async () => {
        const E = await createMeetup({ title: 'Coffee that will not happen', capacity: 1, starts_at: '2026-12-06T09:00' });
        await publish(E.id);
        await join('u-ana', E.id);
        await join('u-ivo', E.id);
        clearMail();
        const r = await app.call('POST', '/api/v2/meetups-ops/meetups/:id/cancel', { user: ADMIN, params: { id: E.id }, body: { reason: 'the host is unwell' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.notified, 2, 'both the confirmed and the waitlisted person must be told');
        assert.strictEqual(r.body.meetup.status, 'cancelled');
        const e = sentTo('ana@example.hr')[0];
        assert.match(e.subject, /Cancelled/);
        assert.match(e.html, /will not go ahead/);
        assert.match(e.html, /the host is unwell/);
        const board = await app.call('GET', '/api/v2/meetups', { user: asUser('u-ana') });
        assert.ok(!board.body.meetups.some(m => m.id === E.id), 'a cancelled meetup stayed on the board');
    });
    await t('a live meetup cannot be deleted — only a clean draft can', async () => {
        const live = await app.call('DELETE', '/api/v2/meetups-ops/meetups/:id', { user: ADMIN, params: { id: A.id } });
        assert.strictEqual(live.status, 400);
        const d = await createMeetup({ title: 'Scratch draft', starts_at: '2026-12-04T18:00' });
        const gone = await app.call('DELETE', '/api/v2/meetups-ops/meetups/:id', { user: ADMIN, params: { id: d.id } });
        assert.strictEqual(gone.status, 200);
        assert.strictEqual(core.meetupById(q, d.id), null);
    });
    // Cancel stays the guest-facing action, but a CANCELLED meetup used to be undeletable forever:
    // it was not a draft, so DELETE refused, and the list carried a dead row nobody could clear.
    await t('a CANCELLED meetup can be deleted, and takes its attendees and audit trail with it', async () => {
        const X = await createMeetup({ title: 'Table that got called off', capacity: 2, starts_at: '2026-12-06T20:00' });
        await publish(X.id);
        await join('u-ana', X.id);
        clearMail();
        const cancelled = await app.call('POST', '/api/v2/meetups-ops/meetups/:id/cancel', { user: ADMIN, params: { id: X.id }, body: { notify: false } });
        assert.strictEqual(cancelled.status, 200);
        assert.strictEqual(cancelled.body.meetup.status, 'cancelled');
        assert.ok(core.attendeesOf(q, X.id).length, 'the attendee row is still there before the delete');

        const gone = await app.call('DELETE', '/api/v2/meetups-ops/meetups/:id', { user: ADMIN, params: { id: X.id } });
        assert.strictEqual(gone.status, 200);
        assert.strictEqual(gone.body.deleted, 'cancelled');
        assert.strictEqual(core.meetupById(q, X.id), null, 'the meetup row survived');
        assert.strictEqual(core.attendeesOf(q, X.id).length, 0, 'attendee rows were left behind');
        assert.strictEqual((q.all('SELECT id FROM plexus_meetup_audit WHERE meetup_id = ?', [X.id]) || []).length, 0, 'audit rows were left behind');
        assert.strictEqual(sent.length, 0, 'deleting a cancelled meetup must email nobody — they were told at cancel time');

        const board = await app.call('GET', '/api/v2/meetups', { user: asUser('u-ana') });
        assert.ok(!board.body.meetups.some(m => m.id === X.id), 'the deleted meetup is still on the member board');
    });
    await t('CSV export carries a BOM, quotes every field and defuses formulas', async () => {
        q.run("UPDATE plexus_meetup_attendees SET first_name = ? WHERE meetup_id = ? AND lower(email) = ?", ['=CMD()', A.id, 'luka@example.hr']);
        const r = await app.call('GET', '/api/v2/meetups-ops/meetups/:id/attendees.csv', { user: ADMIN, params: { id: A.id } });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.startsWith('﻿'), 'no UTF-8 BOM — Excel will mangle Croatian names');
        assert.match(r.headers['content-type'], /text\/csv/);
        assert.match(r.headers['content-disposition'], /attachment; filename="medx-meetup-/);
        assert.ok(r.body.includes('"Name","Email","Institution","Position","Status"'), 'header row');
        assert.ok(r.body.includes(`"'=CMD()`), 'a formula was not defused');
        q.run("UPDATE plexus_meetup_attendees SET first_name = 'Luka' WHERE meetup_id = ? AND lower(email) = ?", [A.id, 'luka@example.hr']);
    });
    await t('the stats strip counts meetups, seats, fill % and waitlisted', async () => {
        const r = await app.call('GET', '/api/v2/meetups-ops/overview', { user: ADMIN });
        assert.strictEqual(r.status, 200);
        const s = r.body.stats;
        for (const k of ['meetups', 'published', 'seats', 'taken', 'seats_left', 'fill_percent', 'waitlisted', 'hosts']) assert.ok(k in s, 'missing stat ' + k);
        assert.ok(s.meetups >= 5);
        assert.ok(s.fill_percent >= 0 && s.fill_percent <= 100);
        assert.strictEqual(r.body.edition.id, 'plexus-2026');
    });
    await t('the overview is edition-scoped and flags an archived edition read-only', async () => {
        const r = await app.call('GET', '/api/v2/meetups-ops/overview', { user: ADMIN, query: { edition: 'plexus-2027' } });
        assert.strictEqual(r.body.edition.id, 'plexus-2027');
        assert.strictEqual(r.body.read_only, true);
        assert.strictEqual(r.body.meetups.length, 0);
    });
    await t('the host link is copy-able and is the SAME token the host page accepts', async () => {
        const r = await app.call('GET', '/api/v2/meetups-ops/meetups/:id/host-link', { user: ADMIN, params: { id: A.id } });
        assert.strictEqual(r.status, 200);
        const tok = r.body.host_link.split('/meetups/host/')[1];
        const page = await app.call('GET', '/meetups/host/:token', { params: { token: tok } });
        assert.strictEqual(page.status, 200);
    });
    await t('the member picker finds hosts by name, email or institution', async () => {
        const r = await app.call('GET', '/api/v2/meetups-ops/members', { user: ADMIN, query: { q: 'harvard' } });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.members.some(m => m.email === 'mia@example.com'));
        assert.match(r.body.members.find(m => m.email === 'mia@example.com').line, /Postdoctoral fellow/);
        const short = await app.call('GET', '/api/v2/meetups-ops/members', { user: ADMIN, query: { q: 'a' } });
        assert.deepStrictEqual(short.body.members, [], 'a one-letter search should not scan the member table');
    });
    await t('every admin route refuses a non-admin member', async () => {
        for (const [m, p, o] of [
            ['GET', '/api/v2/meetups-ops/overview', {}],
            ['POST', '/api/v2/meetups-ops/meetups', { body: { title: 'x', starts_at: '2026-12-04T10:00', capacity: 3 } }],
            ['GET', '/api/v2/meetups-ops/meetups/:id/attendees', { params: { id: A.id } }],
            ['GET', '/api/v2/meetups-ops/meetups/:id/attendees.csv', { params: { id: A.id } }]
        ]) {
            const r = await app.call(m, p, Object.assign({ user: asUser('u-ana') }, o));
            assert.strictEqual(r.status, 403, m + ' ' + p + ' answered ' + r.status);
        }
    });

    // ============================================================ MY MEETUPS
    await t('"My meetups" lists my places with passes, and what I host', async () => {
        const r = await app.call('GET', '/api/v2/meetups/mine', { user: asUser('u-ana') });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.meetups.length >= 1);
        const one = r.body.meetups[0];
        assert.ok(one.manage_url && one.calendar_url, 'passes missing');
        const host = await app.call('GET', '/api/v2/meetups/mine', { user: asUser('u-hostA') });
        assert.ok(host.body.hosting.length >= 1, 'hosting list empty');
        assert.ok(host.body.hosting[0].host_url.includes('/app/plexus/meetups/'));
    });
    await t('"Past editions" answers what I attended in that edition, read-only', async () => {
        const now = await app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-luka') });
        assert.ok(now.body.mine && Array.isArray(now.body.mine.meetups) && Array.isArray(now.body.mine.registrations));
        assert.ok(now.body.mine.meetups.length >= 1, 'a member with places saw an empty summary');
        assert.ok('attended' in now.body.mine.meetups[0], 'the summary should say whether I actually turned up');
        assert.ok(now.body.certificates_url, 'certificates live in the member wallet');
        const past = await app.call('GET', '/api/v2/plexus-week/overview', { user: asUser('u-luka'), query: { edition: 'plexus-2027' } });
        assert.strictEqual(past.body.archived, true);
        assert.deepStrictEqual(past.body.mine.meetups, [], 'a different edition must not borrow this one\'s places');
    });

    // ============================================================ EVENT DAY · meetup door
    await t('EVENT DAY: the meetup door exists and offers a picker', async () => {
        const r = await app.call('GET', '/api/v2/eventday/door', { user: ADMIN, query: { event: 'meetup' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.event, 'meetup');
        assert.ok(Array.isArray(r.body.meetups) && r.body.meetups.length >= 1, 'the picker is empty');
        assert.deepStrictEqual(r.body.rows, [], 'no meetup picked yet → no door list');
        const picked = await app.call('GET', '/api/v2/eventday/door', { user: ADMIN, query: { event: 'meetup', meetup_id: A.id } });
        assert.ok(picked.body.rows.length >= 1);
        assert.ok('position' in picked.body.rows[0] && 'institution' in picked.body.rows[0]);
    });
    await t('EVENT DAY: scanning m-<id> at the meetup door checks in and returns the profile', async () => {
        const a = core.liveOf(q, A.id).find(x => !Number(x.checked_in));
        assert.ok(a, 'fixture: someone not yet checked in');
        const r = await app.call('POST', '/api/v2/eventday/scan', { user: ADMIN, body: { event: 'meetup', meetup_id: A.id, code: 'm-' + a.id } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.ok, true);
        assert.strictEqual(r.body.result, 'admitted');
        assert.ok(r.body.person && r.body.person.name);
        assert.ok('institution' in r.body.person && 'position' in r.body.person && 'bio' in r.body.person, 'the "sleep researcher at Harvard" snippet is missing');
        assert.strictEqual(r.body.meetup.id, A.id);
    });
    await t('EVENT DAY: the meetup door refuses to scan without a meetup picked', async () => {
        const r = await app.call('POST', '/api/v2/eventday/scan', { user: ADMIN, body: { event: 'meetup', code: 'm-whatever' } });
        assert.strictEqual(r.status, 400);
        assert.strictEqual(r.body.result, 'bad_event');
    });
    await t('EVENT DAY: a code from another meetup is refused at this door', async () => {
        const foreign = core.attendeesOf(q, HOSTB.id)[0];
        const r = await app.call('POST', '/api/v2/eventday/scan', { user: ADMIN, body: { event: 'meetup', meetup_id: A.id, code: 'm-' + foreign.id } });
        assert.strictEqual(r.body.ok, false);
        assert.strictEqual(r.body.result, 'wrong_meetup');
    });
    await t('EVENT DAY: lookup resolves a meetup code without writing anything', async () => {
        const a = core.liveOf(q, HOSTB.id)[0] || core.attendeesOf(q, HOSTB.id)[0];
        const before = Number(q.get('SELECT checked_in c FROM plexus_meetup_attendees WHERE id = ?', [a.id]).c);
        const r = await app.call('POST', '/api/v2/eventday/lookup', { user: ADMIN, body: { code: 'm-' + a.id } });
        assert.strictEqual(r.body.ok, true);
        assert.ok(r.body.person.name);
        assert.strictEqual(r.body.doors[0].event, 'meetup');
        assert.strictEqual(Number(q.get('SELECT checked_in c FROM plexus_meetup_attendees WHERE id = ?', [a.id]).c), before, 'a lookup checked someone in');
    });
    await t('EVENT DAY: a door-staff token is refused for the meetup door', async () => {
        // A tokenized door page has no meetup picker, so a generic meetup token would land on a
        // page that cannot scan. Each meetup's own host link is the door-staff link for a table.
        const r = await app.call('POST', '/api/v2/eventday/door-tokens', { user: ADMIN, body: { event: 'meetup' } });
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /host link/i);
        const ok = await app.call('POST', '/api/v2/eventday/door-tokens', { user: ADMIN, body: { event: 'conference' } });
        assert.strictEqual(ok.status, 200, 'the real doors must still mint tokens');
    });
    await t('EVENT DAY: the four original doors are untouched', async () => {
        const r = await app.call('GET', '/api/v2/eventday/overview', { user: ADMIN });
        assert.strictEqual(r.status, 200);
        const keys = r.body.gates.map(g => g.event_key);
        assert.ok(keys.includes('conference') && keys.includes('gala'), 'the existing gates disappeared');
        assert.ok(keys.includes('meetup'), 'the meetup door is missing from the overview');
        assert.ok(Array.isArray(r.body.meetups));
    });

    // ============================================================ guard rails
    await t('joining a meetup that has already happened is refused', async () => {
        const past = await createMeetup({ title: 'Last year\'s coffee', starts_at: '2020-01-01T10:00', ends_at: '2020-01-01T11:00' });
        await publish(past.id);
        const r = await join('u-ana', past.id);
        assert.strictEqual(r.status, 400);
        assert.match(r.body.error, /already happened/);
    });
    await t('a member cannot cancel a place they never had', async () => {
        const fresh = await createMeetup({ title: 'A table nobody has joined', starts_at: '2026-12-06T11:00' });
        await publish(fresh.id);
        const r = await cancel('u-eva', fresh.id);
        assert.strictEqual(r.status, 404);
    });
    await t('every member route refuses a guest (401)', async () => {
        for (const [m, p, o] of [
            ['GET', '/api/v2/meetups', {}], ['GET', '/api/v2/meetups/mine', {}],
            ['POST', '/api/v2/meetups/:id/join', { params: { id: A.id } }],
            ['POST', '/api/v2/meetups/:id/cancel', { params: { id: A.id } }],
            ['GET', '/api/v2/meetups/:id/host', { params: { id: A.id } }]
        ]) {
            const r = await app.call(m, p, o);
            assert.strictEqual(r.status, 401, m + ' ' + p);
        }
    });
    await t('NOTHING left the email stub: every send is captured, no network was touched', () => {
        assert.ok(sent.every(e => typeof e.to === 'string' && typeof e.html === 'string'));
        assert.ok(sent.every(e => /example\.(hr|com|org)|medx\.hr/.test(e.to)), 'an unexpected recipient: ' + sent.map(e => e.to).join(', '));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})();
