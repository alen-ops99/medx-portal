/**
 * tests/program-ops.test.js — the PROGRAM EDITOR's API (admin-portal/backend/v2/program-ops.js +
 * shared/live-program.js), the admin half of Plexus Week Live.
 *
 * Hermetic, in the house pattern (tests/notes.test.js): a stub express app, ONE in-memory libsql
 * database with the legacy tables both modules read, the member module mounted first (it runs the
 * seed at boot — exactly the production order on a shared database), then the admin module. No
 * network, no email path.
 *
 * Covers: routes + guards (401/403) · the seed is idempotent across the member and the admin mounts ·
 * the event picker with counts · speakers typeahead · CRUD with validation · after_id insertion ·
 * restore-by-id (delete → undo) · reorder (before /:id) · shift (+ per day, negative, clamping) ·
 * publish per row / TBD / per event · duplicate is a draft · attendance counts + names + CSV
 * (BOM, CRLF, over-capacity flag) · insight (registered vs opened vs scheduled, top sessions,
 * speakers who have not opened) · an audit row on every write · the version touch the phones poll.
 *
 * Run:  node tests/program-ops.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
delete process.env.TURSO_DATABASE_URL;
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));
const core = require(path.join(ROOT, 'shared/live-program'));

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
}

function stubApp() {
    const routes = {};
    const reg = m => (p, ...h) => { routes[m + ' ' + p] = h; };
    return {
        get: reg('GET'), post: reg('POST'), put: reg('PUT'), patch: reg('PATCH'), delete: reg('DELETE'),
        routes,
        async call(method, p, opts = {}) {
            const chain = routes[method + ' ' + p];
            if (!chain) throw new Error('route not mounted: ' + method + ' ' + p);
            const req = { user: opts.user === undefined ? null : opts.user, params: opts.params || {}, query: opts.query || {}, body: opts.body || {}, headers: opts.headers || {}, ip: '10.0.0.1', path: opts.path || p, protocol: 'https', get: () => 'admin.test' };
            const r = { status: 200, body: undefined, headers: {} };
            let ended = false;
            const res = {
                status(c) { r.status = c; return res; },
                json(o) { r.body = o; ended = true; return res; },
                send(x) { r.body = x; ended = true; return res; },
                set(k, v) { r.headers[String(k).toLowerCase()] = v; return res; },
                setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; },
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

// ---------------------------------------------------------------- the legacy tables both modules read
const db = createDatabase(Database, { localPath: ':memory:' });
db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, first_name TEXT, last_name TEXT, is_admin INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE sessions (id TEXT PRIMARY KEY, conference_id TEXT, title TEXT, description TEXT, session_type TEXT DEFAULT 'talk', day INTEGER DEFAULT 1, start_time TEXT, end_time TEXT, room TEXT, track TEXT, speaker_ids TEXT, is_published INTEGER DEFAULT 0, capacity INTEGER)`);
db.run(`CREATE TABLE speakers (id TEXT PRIMARY KEY, conference_id TEXT, name TEXT, title TEXT, institution TEXT, photo_url TEXT, is_keynote INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, email TEXT)`);
db.run(`CREATE TABLE v2_speaker_meta (speaker_id TEXT PRIMARY KEY, institution_logo_url TEXT, event_tag TEXT, updated_at TEXT)`);
db.run(`CREATE TABLE conferences (id TEXT PRIMARY KEY, name TEXT NOT NULL, year INTEGER, slug TEXT UNIQUE, start_date TEXT, end_date TEXT, is_active INTEGER DEFAULT 1)`);
db.run(`CREATE TABLE gala_settings (id TEXT PRIMARY KEY DEFAULT 'default', title TEXT, date TEXT, time TEXT, venue TEXT, schedule_json TEXT)`);
db.run(`CREATE TABLE bridges_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, venue_name TEXT, venue_address TEXT, event_date TEXT NOT NULL, event_time TEXT, end_time TEXT, status TEXT DEFAULT 'upcoming', slug TEXT)`);
db.run(`CREATE TABLE bridges_registrations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_name TEXT, last_name TEXT, email TEXT, status TEXT DEFAULT 'registered', user_id TEXT)`);
db.run(`CREATE TABLE croatians_abroad_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0, conference_status TEXT, bridges_status TEXT, gala_status TEXT, gala_payment_status TEXT, gala_registration_id TEXT, guest_count INTEGER DEFAULT 0, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, status TEXT DEFAULT 'pending', payment_status TEXT, guest_count INTEGER DEFAULT 0, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE ca_registration_guests (id TEXT PRIMARY KEY, registration_id TEXT NOT NULL, name TEXT, conference INTEGER DEFAULT 0, bridges INTEGER DEFAULT 0, gala INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

function step(sql, params, all) { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) { out.push(st.getAsObject()); if (!all) break; } st.free(); return all ? out : (out[0] || null); }
const q = { run: (sql, p) => (p && p.length ? db.run(sql, p) : db.run(sql)), get: (sql, p) => step(sql, p, false), all: (sql, p) => step(sql, p, true) };

const U = { alen: 'u-alen', laura: 'u-laura', guest: 'u-guest' };
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,1)`, [U.alen, 'juginovic.alen@gmail.com', 'Alen', 'Juginovic']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,1)`, [U.laura, 'laura.rodman@medx.hr', 'Laura', 'Rodman']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,0)`, [U.guest, 'guest@example.com', 'Guest', 'Member']);
q.run(`INSERT INTO conferences (id, name, year, slug, start_date, end_date, is_active) VALUES ('conf-26', 'Plexus Conference 2026', 2026, 'plexus-2026', '2026-12-04', '2026-12-05', 1)`);
q.run(`INSERT INTO gala_settings (id, title, date, time, venue, schedule_json) VALUES ('default', 'Gala Evening 2026', '2026-12-05', '18:00', 'Hotel Esplanade', NULL)`);
q.run(`INSERT INTO bridges_events (id, name, city, venue_name, event_date, event_time, end_time, status, slug) VALUES ('bb-boston-2026-09-21', 'Building Bridges — Boston', 'Boston', 'Waterhouse Room, Gordon Hall', '2026-09-21', '18:00', '21:00', 'upcoming', 'boston')`);
q.run(`INSERT INTO bridges_events (id, name, city, venue_name, event_date, event_time, end_time, status, slug) VALUES ('bb-zg', 'Building Bridges in Biomedicine Croatia', 'Zagreb', 'To be announced', '', '09:00', '12:30', 'upcoming', 'building-bridges')`);
q.run(`INSERT INTO bridges_events (id, name, city, venue_name, event_date, event_time, end_time, status, slug) VALUES ('donor', 'Plexus Donor Night', 'Zagreb', 'Esplanade Zagreb', '2026-12-04', '19:30', '22:30', 'upcoming', 'donor-night')`);
const SPK1 = 'spk-hrvatin', SPK2 = 'spk-kellis';
q.run(`INSERT INTO speakers (id, conference_id, name, title, institution, photo_url, email, sort_order) VALUES (?, 'conf-26', 'Prof. Siniša Hrvatin', 'Professor', 'Whitehead Institute · MIT', '/uploads/hrvatin.jpg', 'hrvatin@example.com', 1)`, [SPK1]);
q.run(`INSERT INTO speakers (id, conference_id, name, title, institution, email, sort_order) VALUES (?, 'conf-26', 'Prof. Manolis Kellis', 'Professor', 'MIT · Broad Institute', 'kellis@example.com', 2)`, [SPK2]);
q.run(`INSERT INTO v2_speaker_meta (speaker_id, institution_logo_url) VALUES (?, '/uploads/mit.png')`, [SPK1]);
// registrants for the insight: 3 conference (one with a guest), 2 boston, 1 gala with 1 guest
q.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, conference_status, guest_count) VALUES ('ca-1', 'Ana', 'Franceschi', 'ana@example.com', 1, 'pre-registered', 0)`);
q.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, conference_status) VALUES ('ca-2', 'Toi', 'Masakazu', 'toi@example.com', 1, 'pre-registered')`);
q.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, conference_status) VALUES ('ca-3', 'Ivo', 'Ivić', 'ivo@example.com', 1, 'cancelled')`);
q.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, conference_status) VALUES ('ca-4', 'Mia', 'Marić', 'mia@example.com', 1, 'pre-registered')`);
q.run(`INSERT INTO ca_registration_guests (id, registration_id, name, conference) VALUES ('g1', 'ca-1', 'Emeric', 1)`);
q.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status) VALUES ('bos-1', 'bb-boston-2026-09-21', 'Manolis', 'Kellis', 'kellis@example.com', 'registered')`);
q.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status) VALUES ('bos-2', 'bb-boston-2026-09-21', 'Ana', 'Jaklenec', 'jaklenec@example.com', 'registered')`);
q.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status) VALUES ('bos-3', 'bb-boston-2026-09-21', 'Gone', 'Guest', 'gone@example.com', 'cancelled')`);
q.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, guest_count) VALUES ('gala-1', 'Solo', 'Guest', 'solo@example.com', 'confirmed', 'paid', 1)`);

// ---------------------------------------------------------------- mount: member first (the seed), then admin
const SECRET = 'program-test-secret';
const member = stubApp();
require(path.join(ROOT, 'user-portal/backend/v2/live.js'))(member, { db: () => db, optionalAuth: (req, res, next) => next(), publicLimiter: (req, res, next) => next(), JWT_SECRET: SECRET, ROOT, log: () => {} });
const app = stubApp();
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentication required' }));
const adminOnly = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admin only' }));
let saves = 0;
require(path.join(ROOT, 'admin-portal/backend/v2/program-ops.js'))(app, { db: () => db, auth, adminOnly, saveDb: () => { saves++; }, JWT_SECRET: SECRET, ROOT, log: () => {} });
const as = { alen: { id: U.alen, email: 'juginovic.alen@gmail.com', is_admin: 1 }, laura: { id: U.laura, email: 'laura.rodman@medx.hr', is_admin: 1 }, guest: { id: U.guest, email: 'guest@example.com', is_admin: 0 } };
const call = (m, p, user, opts = {}) => app.call(m, p, Object.assign({ user }, opts));
const P = (key, rest) => ({ params: Object.assign({ eventKey: key }, rest || {}) });
const audits = action => q.all('SELECT * FROM audit_log WHERE action = ? ORDER BY created_at', [action]);
const tok = (kind, id) => core.liveToken(SECRET, kind, id);

(async () => {
    console.log('program-ops.test.js — hermetic (stub express, one in-memory libsql DB shared by the member seed and the admin editor, no network)\n');
    let conf, welcome, keynote1, panel, brk, added, breakRow, deleted;

    await t('every route is mounted; the schema exists once; the seed ran once (member mount) and the admin mount did not repeat it', () => {
        for (const k of ['GET /api/v2/program/events', 'GET /api/v2/program/speakers', 'GET /api/v2/program/:eventKey/sessions', 'POST /api/v2/program/:eventKey/sessions', 'PUT /api/v2/program/:eventKey/sessions/reorder', 'POST /api/v2/program/:eventKey/sessions/shift',
            'PUT /api/v2/program/:eventKey/sessions/:id', 'DELETE /api/v2/program/:eventKey/sessions/:id', 'POST /api/v2/program/:eventKey/sessions/:id/duplicate', 'PUT /api/v2/program/:eventKey/sessions/:id/publish', 'PUT /api/v2/program/:eventKey/sessions/:id/tbd',
            'PUT /api/v2/program/:eventKey/publish', 'GET /api/v2/program/:eventKey/attendance', 'GET /api/v2/program/:eventKey/attendance.csv', 'GET /api/v2/program/:eventKey/insight']) assert.ok(app.routes[k], 'missing ' + k);
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM sessions').n, 25);
        assert.strictEqual(q.get("SELECT COUNT(*) AS n FROM app_state WHERE key = 'live_program_seed_v1'").n, 1);
        assert.strictEqual(core.runSeed(q).seeded, false, 'idempotent');
        // the order of registration matters: reorder and shift are registered before /:id
        const keys = Object.keys(app.routes);
        assert.ok(keys.indexOf('PUT /api/v2/program/:eventKey/sessions/reorder') < keys.indexOf('PUT /api/v2/program/:eventKey/sessions/:id'));
    });

    await t('no session → 401; a non-admin → 403; any admin is in (no section gate)', async () => {
        assert.strictEqual((await call('GET', '/api/v2/program/events', null)).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/program/events', as.guest)).status, 403);
        assert.strictEqual((await call('GET', '/api/v2/program/events', as.laura)).status, 200);
        assert.strictEqual((await call('GET', '/api/v2/program/:eventKey/sessions', as.laura, P('conference'))).status, 200);
        assert.strictEqual((await call('GET', '/api/v2/program/:eventKey/sessions', as.laura, P('bogus'))).status, 404);
    });

    await t('GET events — the picker: five events with dates, venues, session/published/tbd counts and attending 0', async () => {
        const r = await call('GET', '/api/v2/program/events', as.alen, { query: { today: '2026-10-01' } });
        const by = {}; r.body.events.forEach(e => { by[e.key] = e; });
        assert.deepStrictEqual(Object.keys(by).sort(), ['boston', 'bridges', 'conference', 'donor', 'gala']);
        assert.strictEqual(by.conference.session_count, 6); assert.strictEqual(by.conference.tbd_count, 4); assert.strictEqual(by.conference.published_count, 6); assert.strictEqual(by.conference.attending, 0);
        assert.strictEqual(by.boston.venue, 'Waterhouse Room, Gordon Hall'); assert.strictEqual(by.boston.is_past, true);
        assert.strictEqual(by.gala.session_count, 5, 'gala seeded from the default schedule when schedule_json is empty');
    });

    await t('GET speakers?q= — typeahead over speakers + v2_speaker_meta (name, institution, e-mail), ≤ 12', async () => {
        const r = await call('GET', '/api/v2/program/speakers', as.alen, { query: { q: 'hrv' } });
        assert.strictEqual(r.body.speakers.length, 1); assert.strictEqual(r.body.speakers[0].id, SPK1); assert.strictEqual(r.body.speakers[0].logo_url, '/uploads/mit.png'); assert.strictEqual(r.body.speakers[0].photo_url, '/uploads/hrvatin.jpg');
        assert.strictEqual((await call('GET', '/api/v2/program/speakers', as.alen, { query: { q: 'mit' } })).body.speakers.length, 2);
        assert.strictEqual((await call('GET', '/api/v2/program/speakers', as.alen, { query: { q: 'kellis@' } })).body.speakers[0].id, SPK2);
        assert.strictEqual((await call('GET', '/api/v2/program/speakers', as.alen, {})).body.speakers.length, 2);
    });

    await t('GET :event/sessions — every row (published or not) with count, grouped days, room conflicts, updated_at', async () => {
        const r = await call('GET', '/api/v2/program/:eventKey/sessions', as.alen, P('conference'));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        conf = r.body.sessions; [welcome, keynote1, panel, brk] = [conf[0], conf[1], conf[2], conf[3]];
        assert.strictEqual(conf.length, 6); assert.strictEqual(r.body.days.length, 1); assert.strictEqual(r.body.days[0].label, 'Friday 4 Dec');
        assert.strictEqual(r.body.event.key, 'conference'); assert.strictEqual(r.body.event.venue, 'Novinarski dom');
        assert.strictEqual(keynote1.count, 0); assert.strictEqual(keynote1.is_tbd, true); assert.strictEqual(keynote1.kind, 'keynote'); assert.strictEqual(keynote1.is_published, true);
        assert.deepStrictEqual(r.body.conflicts, []); assert.ok(r.body.updated_at);
    });

    await t('POST sessions — validation (title, HH:MM, end before start, kind, capacity) and a proper insert with speakers + free names + audit', async () => {
        const bad = async (body, re) => { const r = await call('POST', '/api/v2/program/:eventKey/sessions', as.alen, Object.assign(P('conference'), { body })); assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.match(r.body.error, re); };
        await bad({ kind: 'talk' }, /title/i);
        await bad({ title: 'X', start_time: '25:00' }, /HH:MM/);
        await bad({ title: 'X', start_time: '18:00', end_time: '17:00' }, /ends before/);
        await bad({ title: 'X', kind: 'karaoke' }, /kind/);
        await bad({ title: 'X', capacity: 'lots' }, /whole number/);
        const r = await call('POST', '/api/v2/program/:eventKey/sessions', as.alen, Object.assign(P('conference'), { body: { title: 'Fireside chat', kind: 'panel', start_time: '20:05', end_time: '20:35', room: 'Main Hall', location_note: 'first floor, left', track: 'Main', capacity: 120, description: 'With Lord Smith.', speaker_ids: [SPK1, SPK2], speaker_names: 'Lord Smith of Finsbury, Alen Juginovic', show_counts: true } }));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        added = r.body.session;
        assert.strictEqual(added.event_key, 'conference'); assert.strictEqual(added.event_date, '2026-12-04', 'date defaults to the event day'); assert.strictEqual(added.is_published, true);
        assert.deepStrictEqual(added.speaker_ids, [SPK1, SPK2]); assert.strictEqual(added.speakers[0].name, 'Prof. Siniša Hrvatin'); assert.strictEqual(added.speakers[0].logo_url, '/uploads/mit.png');
        assert.deepStrictEqual(added.speaker_names.map(x => x.name), ['Lord Smith of Finsbury', 'Alen Juginovic']);
        assert.strictEqual(added.capacity, 120); assert.strictEqual(added.show_counts, true); assert.strictEqual(added.location_note, 'first floor, left');
        assert.strictEqual(added.starts_at, '2026-12-04T20:05:00+01:00');
        assert.strictEqual(q.get('SELECT conference_id, session_type FROM sessions WHERE id = ?', [added.id]).conference_id, 'conf-26', 'legacy conference_id kept in step');
        assert.strictEqual(q.get('SELECT session_type FROM sessions WHERE id = ?', [added.id]).session_type, 'panel');
        assert.strictEqual(audits('program.session_added').length, 1); assert.match(audits('program.session_added')[0].detail, /Fireside chat/); assert.strictEqual(audits('program.session_added')[0].actor_email, 'juginovic.alen@gmail.com');
        // the new row overlaps Networking (20:05–21:00) only if the room matches — Networking is in the Foyer → no conflict
        assert.deepStrictEqual(r.body.conflicts, []);
    });

    await t('+ ADD BREAK needs no title; after_id slots the row after another; the member program shows both immediately', async () => {
        const r = await call('POST', '/api/v2/program/:eventKey/sessions', as.laura, Object.assign(P('conference'), { body: { kind: 'break', start_time: '20:35', end_time: '20:45', after_id: added.id } }));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body)); breakRow = r.body.session;
        assert.strictEqual(breakRow.title, 'Break'); assert.strictEqual(breakRow.sort_order, added.sort_order + 5);
        const pub = await member.call('GET', '/api/live/:eventKey/program', P('conference'));
        assert.strictEqual(pub.body.sessions.length, 8);
    });

    await t('PUT sessions/:id — a partial edit (time, room) saves only those fields, stamps updated_at, audits, and reports a room conflict as a warning (never blocked)', async () => {
        const before = q.get('SELECT * FROM sessions WHERE id = ?', [added.id]);
        const r = await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('conference', { id: added.id }), { body: { start_time: '19:50', room: 'Foyer' } }));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.session.start_time, '19:50'); assert.strictEqual(r.body.session.room, 'Foyer'); assert.strictEqual(r.body.session.title, 'Fireside chat'); assert.strictEqual(r.body.session.capacity, 120);
        assert.ok(r.body.session.updated_at > before.updated_at);
        // Fireside (19:50–20:35, Foyer) now overlaps Networking (20:05–21:00, Foyer) → a conflict pair, still saved
        assert.ok(r.body.conflicts.some(c => [c.a, c.b].includes(added.id)), JSON.stringify(r.body.conflicts));
        assert.strictEqual((await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('conference', { id: added.id }), { body: { end_time: '19:00' } }))).status, 400, 'end before start');
        assert.strictEqual((await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('conference', { id: added.id }), { body: { title: '' } }))).status, 400, 'a session needs a title');
        assert.strictEqual((await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('boston', { id: added.id }), { body: { title: 'x' } }))).status, 404, 'wrong event → 404');
        assert.strictEqual(audits('program.session_edited').length, 1); assert.match(audits('program.session_edited')[0].detail, /start_time,room/);
        // an empty body is a no-op
        assert.strictEqual((await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('conference', { id: added.id }), { body: {} }))).body.session.start_time, '19:50');
        // speakers cleared with an empty list; free names replaced
        const r2 = await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('conference', { id: added.id }), { body: { speaker_ids: [], speaker_names: [{ name: 'Lord Smith of Finsbury', institution: 'University of Cambridge' }] } }));
        assert.deepStrictEqual(r2.body.speaker_ids, undefined); assert.deepStrictEqual(r2.body.session.speaker_ids, []); assert.strictEqual(r2.body.session.speaker_names[0].institution, 'University of Cambridge');
    });

    await t('PUT reorder — sort_order follows the list (10, 20, 30 …); unknown ids → 404; audit + version touch', async () => {
        const ids = conf.map(s => s.id).concat([added.id, breakRow.id]).reverse();
        const before = core.lastUpdated(q, 'conference').updated_at;
        await new Promise(r => setTimeout(r, 5));
        const r = await call('PUT', '/api/v2/program/:eventKey/sessions/reorder', as.laura, Object.assign(P('conference'), { body: { order: ids } }));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const so = {}; q.all('SELECT id, sort_order FROM sessions WHERE event_key = ?', ['conference']).forEach(x => { so[x.id] = x.sort_order; });
        ids.forEach((id, i) => assert.strictEqual(so[id], (i + 1) * 10));
        assert.strictEqual((await call('PUT', '/api/v2/program/:eventKey/sessions/reorder', as.laura, Object.assign(P('conference'), { body: { order: ['nope'] } }))).status, 404);
        assert.strictEqual((await call('PUT', '/api/v2/program/:eventKey/sessions/reorder', as.laura, Object.assign(P('conference'), { body: {} }))).status, 400);
        assert.strictEqual(audits('program.reordered').length, 1);
        assert.ok(core.lastUpdated(q, 'conference').updated_at > before, 'the phones see a new version');
        // put the natural order back (by time) for the rest of the run
        await call('PUT', '/api/v2/program/:eventKey/sessions/reorder', as.laura, Object.assign(P('conference'), { body: { order: ids.slice().reverse() } }));
    });

    await t('POST shift — everything at/after 18:00 moves +10 min (end times too), rows before stay; a negative shift; per-day filter; validation', async () => {
        const r = await call('POST', '/api/v2/program/:eventKey/sessions/shift', as.alen, Object.assign(P('conference'), { body: { after: '18:00', minutes: 10 } }));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const by = {}; r.body.sessions.forEach(s => { by[s.id] = s; });
        assert.strictEqual(by[welcome.id].start_time, '17:00', 'before the cut → untouched'); assert.strictEqual(by[keynote1.id].start_time, '17:15');
        assert.strictEqual(by[panel.id].start_time, '18:10'); assert.strictEqual(by[panel.id].end_time, '19:10');
        assert.strictEqual(by[brk.id].start_time, '19:10'); assert.strictEqual(by[brk.id].end_time, '19:30');
        assert.strictEqual(by[added.id].start_time, '20:00'); assert.strictEqual(by[breakRow.id].start_time, '20:45');
        assert.strictEqual(r.body.moved, 6);
        const back = await call('POST', '/api/v2/program/:eventKey/sessions/shift', as.alen, Object.assign(P('conference'), { body: { after: '18:10', minutes: -10, date: '2026-12-04' } }));
        assert.strictEqual(back.body.moved, 6);
        assert.strictEqual(back.body.sessions.find(s => s.id === panel.id).start_time, '18:00');
        assert.strictEqual((await call('POST', '/api/v2/program/:eventKey/sessions/shift', as.alen, Object.assign(P('conference'), { body: { after: '18:00', minutes: 10, date: '2026-12-25' } }))).body.moved, 0, 'another day → nothing');
        assert.strictEqual((await call('POST', '/api/v2/program/:eventKey/sessions/shift', as.alen, Object.assign(P('conference'), { body: { after: 'noon', minutes: 10 } }))).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/program/:eventKey/sessions/shift', as.alen, Object.assign(P('conference'), { body: { after: '18:00', minutes: 0 } }))).status, 400);
        assert.strictEqual(audits('program.shifted').length, 3);
        assert.match(audits('program.shifted')[0].detail, /after 18:00 by \+10 min · 6 rows/);
    });

    await t('publish per row, TBD toggle, publish/unpublish the whole event — the member program follows; every flip audited', async () => {
        const off = await call('PUT', '/api/v2/program/:eventKey/sessions/:id/publish', as.alen, Object.assign(P('conference', { id: added.id }), { body: { is_published: false } }));
        assert.strictEqual(off.body.session.is_published, false);
        assert.strictEqual((await member.call('GET', '/api/live/:eventKey/program', P('conference'))).body.sessions.length, 7);
        const on = await call('PUT', '/api/v2/program/:eventKey/sessions/:id/publish', as.alen, Object.assign(P('conference', { id: added.id }), { body: {} }));
        assert.strictEqual(on.body.session.is_published, true, 'no body = toggle');
        const tbd = await call('PUT', '/api/v2/program/:eventKey/sessions/:id/tbd', as.laura, Object.assign(P('conference', { id: keynote1.id }), { body: { is_tbd: false } }));
        assert.strictEqual(tbd.body.session.is_tbd, false);
        assert.strictEqual((await member.call('GET', '/api/live/:eventKey/program', P('conference'))).body.sessions.find(s => s.id === keynote1.id).is_tbd, false);
        await call('PUT', '/api/v2/program/:eventKey/sessions/:id/tbd', as.laura, Object.assign(P('conference', { id: keynote1.id }), { body: { is_tbd: true } }));
        const all = await call('PUT', '/api/v2/program/:eventKey/publish', as.alen, Object.assign(P('conference'), { body: { is_published: false } }));
        assert.strictEqual(all.body.changed, 8); assert.ok(all.body.sessions.every(s => !s.is_published));
        assert.strictEqual((await member.call('GET', '/api/live/:eventKey/program', P('conference'))).body.sessions.length, 0);
        const re = await call('PUT', '/api/v2/program/:eventKey/publish', as.alen, Object.assign(P('conference'), { body: { is_published: true } }));
        assert.strictEqual(re.body.changed, 8);
        assert.strictEqual((await member.call('GET', '/api/live/:eventKey/program', P('conference'))).body.sessions.length, 8);
        assert.strictEqual(audits('program.session_published').length, 1); assert.strictEqual(audits('program.session_published_off').length, 1);
        assert.strictEqual(audits('program.session_tbd').length, 1); assert.strictEqual(audits('program.session_tbd_off').length, 1);
        assert.strictEqual(audits('program.event_unpublished').length, 1); assert.strictEqual(audits('program.event_published').length, 1);
    });

    await t('duplicate → a DRAFT copy right after the original; delete → the row and its attendance go, the response carries the row; POST with the same id restores it (UNDO)', async () => {
        const d = await call('POST', '/api/v2/program/:eventKey/sessions/:id/duplicate', as.alen, P('conference', { id: added.id }));
        assert.strictEqual(d.status, 200, JSON.stringify(d.body));
        assert.strictEqual(d.body.session.title, 'Fireside chat (copy)'); assert.strictEqual(d.body.session.is_published, false); assert.strictEqual(d.body.session.sort_order, added.sort_order + 5 > 0 ? d.body.session.sort_order : 0);
        assert.strictEqual(d.body.session.speaker_names[0].name, 'Lord Smith of Finsbury');
        // somebody taps the copy? it is a draft — the member cannot. Attend the original, then delete it.
        q.run("INSERT INTO v2_session_attendance (id, session_id, event_key, person_kind, person_ref, person_name, party, state, created_at) VALUES ('att-x', ?, 'conference', 'ca', 'ca-1', 'Ana Franceschi', 2, 'attending', ?)", [d.body.session.id, new Date().toISOString()]);
        const del = await call('DELETE', '/api/v2/program/:eventKey/sessions/:id', as.laura, P('conference', { id: d.body.session.id }));
        assert.strictEqual(del.status, 200); assert.strictEqual(del.body.ok, true); deleted = del.body.session;
        assert.strictEqual(deleted.id, d.body.session.id); assert.strictEqual(deleted.title, 'Fireside chat (copy)');
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM sessions WHERE id = ?', [deleted.id]).n, 0);
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM v2_session_attendance WHERE session_id = ?', [deleted.id]).n, 0);
        assert.strictEqual((await call('DELETE', '/api/v2/program/:eventKey/sessions/:id', as.laura, P('conference', { id: deleted.id }))).status, 404);
        const undo = await call('POST', '/api/v2/program/:eventKey/sessions', as.laura, Object.assign(P('conference'), { body: Object.assign({}, deleted, { speaker_names: deleted.speaker_names }) }));
        assert.strictEqual(undo.status, 200, JSON.stringify(undo.body));
        assert.strictEqual(undo.body.session.id, deleted.id); assert.strictEqual(undo.body.session.title, 'Fireside chat (copy)'); assert.strictEqual(undo.body.session.is_published, false); assert.strictEqual(undo.body.session.sort_order, deleted.sort_order);
        assert.strictEqual((await call('POST', '/api/v2/program/:eventKey/sessions', as.laura, Object.assign(P('conference'), { body: { id: deleted.id, title: 'again' } }))).status, 409);
        assert.strictEqual(audits('program.session_duplicated').length, 1); assert.strictEqual(audits('program.session_deleted').length, 1); assert.strictEqual(audits('program.session_restored').length, 1);
        // tidy: remove the restored copy
        await call('DELETE', '/api/v2/program/:eventKey/sessions/:id', as.laura, P('conference', { id: deleted.id }));
    });

    await t('attendance — per session counts (party-weighted) and names, over-capacity flag, declined listed after attending; CSV with BOM + CRLF; audit on export', async () => {
        // three people through the member API: Ana (party 2) + Toi + Mia at Keynote 1 (capacity 2 → over)
        await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('conference', { id: keynote1.id }), { body: { capacity: 2, show_counts: true } }));
        for (const [kind, id] of [['ca', 'ca-1'], ['ca', 'ca-2'], ['ca', 'ca-4']]) assert.strictEqual((await member.call('POST', '/api/live/me/:token/attend', { params: { token: tok(kind, id) }, body: { session_id: keynote1.id } })).status, 200);
        await member.call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', 'ca-4') }, body: { session_id: keynote1.id, state: 'declined' } });
        await member.call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', 'ca-2') }, body: { session_id: panel.id } });
        const r = await call('GET', '/api/v2/program/:eventKey/attendance', as.laura, P('conference'));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const k = r.body.sessions.find(s => s.id === keynote1.id);
        assert.strictEqual(k.count, 3, 'Ana 2 + Toi 1 (Mia declined)'); assert.strictEqual(k.capacity, 2); assert.strictEqual(k.over, true);
        assert.strictEqual(k.people.length, 3);
        assert.deepStrictEqual(k.people.map(p => p.name + ':' + p.party + ':' + p.state).sort(), ['Ana Franceschi:2:attending', 'Mia Marić:1:declined', 'Toi Masakazu:1:attending']);
        assert.ok(k.people.slice(0, 2).every(p => p.state === 'attending') && k.people[2].state === 'declined', 'attending first, declined after');
        const p = r.body.sessions.find(s => s.id === panel.id); assert.strictEqual(p.count, 1); assert.strictEqual(p.over, false);
        const list = await call('GET', '/api/v2/program/:eventKey/sessions', as.laura, P('conference'));
        assert.strictEqual(list.body.sessions.find(s => s.id === keynote1.id).count, 3, 'the editor row shows the count');
        const csv = await call('GET', '/api/v2/program/:eventKey/attendance.csv', as.laura, P('conference'));
        assert.strictEqual(csv.status, 200); assert.match(csv.headers['content-type'], /text\/csv/); assert.match(csv.headers['content-disposition'], /plexus-live-attendance-conference\.csv/);
        const text = String(csv.body);
        assert.ok(text.charCodeAt(0) === 0xFEFF, 'UTF-8 BOM'); assert.ok(text.includes('\r\n'));
        const lines = text.slice(1).split('\r\n').filter(Boolean);
        assert.strictEqual(lines[0], 'Session,Date,Start,End,Room,Capacity,Attending,Name,Party,Kind,State,Updated');
        assert.ok(lines.some(l => l.startsWith('Keynote 1,2026-12-04,17:15,18:00,Main Hall,2,3,Ana Franceschi,2,ca,attending,')));
        assert.ok(lines.some(l => l.startsWith('Welcome,2026-12-04,17:00,17:15,Main Hall,,0,,,,,')), 'a session nobody tapped still has a line');
        assert.strictEqual(audits('program.attendance_exported').length, 1);
    });

    await t('insight — registered (rows) vs registered_seats (with guests) vs opened vs built-a-schedule, attending taps, top sessions, speakers who have not opened', async () => {
        await member.call('GET', '/api/live/me/:token', { params: { token: tok('ca', 'ca-1') } });   // Ana opened
        await member.call('GET', '/api/live/me/:token', { params: { token: tok('speaker', SPK1) } });  // Hrvatin opened
        await call('PUT', '/api/v2/program/:eventKey/sessions/:id', as.alen, Object.assign(P('conference', { id: panel.id }), { body: { speaker_ids: [SPK1, SPK2] } }));
        const r = await call('GET', '/api/v2/program/:eventKey/insight', as.alen, P('conference'));
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.registered, 3, 'ca-1, ca-2, ca-4 (ca-3 cancelled)'); assert.strictEqual(r.body.registered_seats, 4, '+ Ana\'s guest');
        assert.strictEqual(r.body.opened, 1); assert.strictEqual(r.body.scheduled, 2, 'Ana + Toi built a schedule (Mia only declined)'); assert.strictEqual(r.body.attending_total, 4);
        assert.strictEqual(r.body.sessions, 8); assert.strictEqual(r.body.published, 8); assert.strictEqual(r.body.tbd, 4);
        assert.strictEqual(r.body.top[0].id, keynote1.id); assert.strictEqual(r.body.top[0].count, 3); assert.strictEqual(r.body.top[1].id, panel.id);
        assert.deepStrictEqual(r.body.speakers_unopened.map(s => s.id), [SPK2]); assert.strictEqual(r.body.speakers_total, 2);
        const b = await call('GET', '/api/v2/program/:eventKey/insight', as.alen, P('boston'));
        assert.strictEqual(b.body.registered, 2, 'cancelled Boston guest not counted');
        const g = await call('GET', '/api/v2/program/:eventKey/insight', as.alen, P('gala'));
        assert.strictEqual(g.body.registered, 1); assert.strictEqual(g.body.registered_seats, 2);
    });

    await t('every write persisted (saveDb called) and audited by the acting admin; nothing was ever e-mailed', () => {
        assert.ok(saves >= 15, 'saveDb ran after writes (' + saves + ')');
        const rows = q.all("SELECT action, actor_email FROM audit_log WHERE action LIKE 'program.%'");
        assert.ok(rows.length >= 20, rows.length + ' audit rows');
        assert.ok(rows.every(r => ['juginovic.alen@gmail.com', 'laura.rodman@medx.hr'].includes(r.actor_email)));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})().catch(e => { console.error(e); process.exit(1); });
