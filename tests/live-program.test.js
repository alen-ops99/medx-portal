/**
 * tests/live-program.test.js — PLEXUS WEEK LIVE, the public program API (user-portal/backend/v2/live.js
 * + shared/live-program.js).
 *
 * Hermetic, in the house pattern (tests/notes.test.js): a stub express app collects routes, ONE
 * in-memory libsql database carries the legacy tables the module reads (sessions · speakers ·
 * conferences · gala_settings · bridges_events · bridges_registrations · croatians_abroad_registrations ·
 * gala_registrations · ca_registration_guests · users · app_state), and the module is mounted exactly
 * as production does — the seed runs at mount. No network, no email path, a pass-through limiter.
 *
 * Covers: schema + seed (25 rows, idempotent across two mounts) · the event catalogue (dates, zones,
 * is_today/is_past, session windows, sorting) · the program grouped by day with speakers resolved and
 * counts only when show_counts · TBD rows · ?since= polling · live tokens (mint/verify/tamper) · me for
 * ca / gala (canonical = the CA row) / bridges (Boston) / speaker / user (Bearer) · attend upsert + party
 * counts + decline · not-on-your-ticket 403 · schedule + conflicts · .ics validity (one session, a day,
 * public session ics) · opens recorded · liveUrl exported from plexus-ticket.
 *
 * Run:  node tests/live-program.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
delete process.env.PUBLIC_BASE_URL;
global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'user-portal/backend/node_modules/libsql'));
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
            const req = { user: opts.user === undefined ? null : opts.user, params: opts.params || {}, query: opts.query || {}, body: opts.body || {}, headers: opts.headers || {}, ip: '10.0.0.1', path: opts.path || p, protocol: 'https', get: () => 'member.test' };
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

// ---------------------------------------------------------------- the legacy tables the module reads
const db = createDatabase(Database, { localPath: ':memory:' });
db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, first_name TEXT, last_name TEXT, is_admin INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE sessions (id TEXT PRIMARY KEY, conference_id TEXT, title TEXT, description TEXT, session_type TEXT DEFAULT 'talk', day INTEGER DEFAULT 1, start_time TEXT, end_time TEXT, room TEXT, track TEXT, speaker_ids TEXT, is_published INTEGER DEFAULT 0, capacity INTEGER)`);
db.run(`CREATE TABLE speakers (id TEXT PRIMARY KEY, conference_id TEXT, name TEXT, title TEXT, institution TEXT, bio TEXT, photo_url TEXT, talk_title TEXT, is_keynote INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, email TEXT)`);
db.run(`CREATE TABLE v2_speaker_meta (speaker_id TEXT PRIMARY KEY, institution_logo_url TEXT, event_tag TEXT, updated_at TEXT)`);
db.run(`CREATE TABLE conferences (id TEXT PRIMARY KEY, name TEXT NOT NULL, year INTEGER, slug TEXT UNIQUE, start_date TEXT, end_date TEXT, venue_name TEXT, is_active INTEGER DEFAULT 1)`);
db.run(`CREATE TABLE gala_settings (id TEXT PRIMARY KEY DEFAULT 'default', title TEXT, date TEXT, time TEXT, venue TEXT, dress_code TEXT, schedule_json TEXT)`);
db.run(`CREATE TABLE bridges_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, venue_name TEXT, venue_address TEXT, event_date TEXT NOT NULL, event_time TEXT, end_time TEXT, status TEXT DEFAULT 'upcoming', slug TEXT)`);
db.run(`CREATE TABLE bridges_registrations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_name TEXT, last_name TEXT, email TEXT, institution TEXT, status TEXT DEFAULT 'registered', user_id TEXT)`);
db.run(`CREATE TABLE croatians_abroad_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT, selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0, conference_status TEXT, bridges_status TEXT, gala_status TEXT, gala_payment_status TEXT, gala_registration_id TEXT, guest_count INTEGER DEFAULT 0, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, institution TEXT, status TEXT DEFAULT 'pending', payment_status TEXT, guest_count INTEGER DEFAULT 0, user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE ca_registration_guests (id TEXT PRIMARY KEY, registration_id TEXT NOT NULL, name TEXT, institution TEXT, email TEXT, conference INTEGER DEFAULT 0, bridges INTEGER DEFAULT 0, gala INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

function step(sql, params, all) { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) { out.push(st.getAsObject()); if (!all) break; } st.free(); return all ? out : (out[0] || null); }
const q = { run: (sql, p) => (p && p.length ? db.run(sql, p) : db.run(sql)), get: (sql, p) => step(sql, p, false), all: (sql, p) => step(sql, p, true) };

q.run(`INSERT INTO conferences (id, name, year, slug, start_date, end_date, venue_name, is_active) VALUES ('conf-26', 'Plexus Conference 2026', 2026, 'plexus-2026', '2026-12-04', '2026-12-05', 'Hotel Esplanade', 1)`);
q.run(`INSERT INTO gala_settings (id, title, date, time, venue, dress_code, schedule_json) VALUES ('default', 'Gala Evening 2026', '2026-12-05', '18:00', 'Hotel Esplanade', 'Black tie', ?)`, [JSON.stringify([
    { time: '18:00', title: 'Welcome Reception', description: 'Champagne in the Grand Foyer' },
    { time: '19:00', title: 'Opening & Keynote Address', description: 'Lord Smith of Finsbury' },
    { time: '20:00', title: 'Gala Dinner', description: 'Five courses' },
    { time: '21:30', title: 'Biomedical Forum Annual Awards', description: 'Four categories' },
    { time: '22:30', title: 'Networking & Entertainment', description: 'Live music' }
])]);
q.run(`INSERT INTO bridges_events (id, name, city, venue_name, venue_address, event_date, event_time, end_time, status, slug) VALUES ('bb-boston-2026-09-21', 'Building Bridges in Biomedicine — Boston', 'Boston', 'Waterhouse Room, Gordon Hall', '25 Shattuck Street', '2026-09-21', '18:00', '21:00', 'upcoming', 'boston')`);
q.run(`INSERT INTO bridges_events (id, name, city, venue_name, event_date, event_time, end_time, status, slug) VALUES ('bb-zg', 'Building Bridges in Biomedicine Croatia', 'Zagreb', 'To be announced', '', '09:00', '12:30', 'upcoming', 'building-bridges')`);
q.run(`INSERT INTO bridges_events (id, name, city, venue_name, venue_address, event_date, event_time, end_time, status, slug) VALUES ('donor', 'Plexus Donor Night', 'Zagreb', 'Esplanade Zagreb', 'Esplanade Zagreb, private salon', '2026-12-04', '19:30', '22:30', 'upcoming', 'donor-night')`);
// people
const CA = 'ca-ana-0001', GALA = 'gala-ana-0001', CA2 = 'ca-toi-0002', BOS = 'bb-reg-kellis', SPK = 'spk-hrvatin', USER = 'u-member';
q.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, institution, selected_conference, selected_bridges, selected_gala, conference_status, bridges_status, gala_status, gala_payment_status, gala_registration_id, guest_count) VALUES (?, 'Ana', 'Franceschi', 'ana@example.com', 'Northwell', 1, 1, 1, 'pre-registered', 'pre-registered', 'confirmed', 'paid', ?, 1)`, [CA, GALA]);
q.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, guest_count) VALUES (?, 'Ana', 'Franceschi', 'ana@example.com', 'Northwell', 'confirmed', 'paid', 1)`, [GALA]);
q.run(`INSERT INTO ca_registration_guests (id, registration_id, name, institution, email, conference, bridges, gala) VALUES ('g1', ?, 'Emeric du Mas', 'Sorbonne', 'emeric@example.com', 1, 0, 1)`, [CA]);
q.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, selected_bridges, selected_gala, conference_status, bridges_status) VALUES (?, 'Toi', 'Masakazu', 'toi@example.com', 1, 0, 0, 'pre-registered', NULL)`, [CA2]);
q.run(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution, status) VALUES (?, 'bb-boston-2026-09-21', 'Manolis', 'Kellis', 'kellis@example.com', 'MIT', 'registered')`, [BOS]);
q.run(`INSERT INTO speakers (id, conference_id, name, title, institution, photo_url, email, is_keynote) VALUES (?, 'conf-26', 'Prof. Siniša Hrvatin', 'Professor', 'Whitehead Institute · MIT', '/uploads/hrvatin.jpg', 'hrvatin@example.com', 1)`, [SPK]);
q.run(`INSERT INTO v2_speaker_meta (speaker_id, institution_logo_url) VALUES (?, '/uploads/mit.png')`, [SPK]);
q.run(`INSERT INTO users (id, email, first_name, last_name) VALUES (?, 'toi@example.com', 'Toi', 'Masakazu')`, [USER]);
q.run(`INSERT INTO users (id, email, first_name, last_name) VALUES ('u-nobody', 'nobody@example.com', 'No', 'Body')`);

// ---------------------------------------------------------------- mount (twice — the seed must be idempotent)
const SECRET = 'live-test-secret';
const mount = () => {
    const app = stubApp();
    require(path.join(ROOT, 'user-portal/backend/v2/live.js'))(app, { db: () => db, optionalAuth: (req, res, next) => next(), publicLimiter: (req, res, next) => next(), JWT_SECRET: SECRET, ROOT, log: () => {} });
    return app;
};
mount();
const app = mount();
const tok = (kind, id) => core.liveToken(SECRET, kind, id);
const call = (m, p, opts = {}) => app.call(m, p, opts);

(async () => {
    console.log('live-program.test.js — hermetic (stub express, one in-memory libsql DB, pass-through limiter, no network)\n');
    let conf, boston, keynote1, panelId, breakId, block1;

    await t('every route is mounted; schema in place', () => {
        for (const k of ['GET /api/live/events', 'GET /api/live/:eventKey/program', 'GET /api/live/:eventKey/sessions/:id.ics', 'GET /api/live/me/:token', 'POST /api/live/me/:token/attend', 'GET /api/live/me/:token/schedule', 'GET /api/live/me/:token/schedule.ics']) assert.ok(app.routes[k], 'missing ' + k);
        for (const tbl of ['v2_session_attendance', 'v2_live_opens']) assert.ok(q.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tbl]), tbl + ' created');
        const cols = q.all('PRAGMA table_info(sessions)').map(c => c.name);
        for (const c of ['event_key', 'event_date', 'sort_order', 'location_note', 'kind', 'speaker_names_json', 'is_tbd', 'show_counts', 'updated_at']) assert.ok(cols.includes(c), 'sessions.' + c);
    });

    await t('the seed ran ONCE across two mounts: 25 rows (conference 6 · donor 3 · bridges 4 · gala 5 · boston 7), all published, marker set', () => {
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM sessions').n, 25);
        const per = {}; q.all('SELECT event_key, COUNT(*) AS n FROM sessions GROUP BY event_key').forEach(r => { per[r.event_key] = r.n; });
        assert.deepStrictEqual(per, { conference: 6, donor: 3, bridges: 4, gala: 5, boston: 7 });
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM sessions WHERE is_published = 1').n, 25);
        assert.ok(q.get("SELECT value FROM app_state WHERE key = 'live_program_seed_v1'"));
        assert.strictEqual(core.runSeed(q).seeded, false);
    });

    await t('the seed content: TBD flags, Boston run of show (8+4+8 names), the Gala rows imported from schedule_json with the Awards at 21:30', () => {
        const titles = k => q.all("SELECT title, start_time, end_time, kind, is_tbd FROM sessions WHERE event_key = ? ORDER BY start_time", [k]);
        const c = titles('conference');
        assert.deepStrictEqual(c.map(r => r.title), ['Welcome', 'Keynote 1', 'Panel', 'Break', 'Keynote 2', 'Networking']);
        assert.strictEqual(c[0].start_time, '17:00'); assert.strictEqual(c[5].end_time, '21:00');
        assert.deepStrictEqual(c.map(r => r.is_tbd), [1, 1, 1, 0, 1, 0]);
        assert.ok(titles('donor').every(r => r.is_tbd === 1), 'donor rows are all TBD');
        const b = titles('bridges'); assert.strictEqual(b[0].start_time, '11:00'); assert.ok(b.every(r => r.is_tbd === 1));
        const g = titles('gala'); assert.ok(g.some(r => r.title === 'Biomedical Forum Annual Awards' && r.start_time === '21:30' && r.kind === 'ceremony'));
        assert.strictEqual(g[0].title, 'Welcome Reception'); assert.strictEqual(g[0].end_time, '19:00');
        const bo = q.all("SELECT title, start_time, end_time, kind, speaker_names_json, room FROM sessions WHERE event_key = 'boston' ORDER BY start_time");
        assert.deepStrictEqual(bo.map(r => r.start_time), ['17:30', '18:00', '18:15', '19:05', '19:30', '19:35', '20:25']);
        assert.strictEqual(bo[6].end_time, '21:00');
        assert.strictEqual(JSON.parse(bo[2].speaker_names_json).length, 8);
        assert.strictEqual(JSON.parse(bo[3].speaker_names_json).length, 4);
        assert.strictEqual(JSON.parse(bo[5].speaker_names_json).length, 8);
        assert.strictEqual(bo[2].kind, 'presentations'); assert.strictEqual(bo[3].kind, 'panel');
        assert.ok(JSON.parse(bo[2].speaker_names_json).some(x => /Kellis/.test(x.name)));
        assert.ok(JSON.parse(bo[5].speaker_names_json).some(x => /Pezaris/.test(x.name)));
        assert.strictEqual(bo[0].room, 'Waterhouse Room');
    });

    await t('GET /api/live/events — the catalogue with dates, zones, venues, session windows; Boston past, Zagreb upcoming; sorted soonest-first', async () => {
        const r = await call('GET', '/api/live/events', { query: { today: '2026-10-01' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const ev = r.body.events; const by = {}; ev.forEach(e => { by[e.key] = e; });
        for (const k of ['conference', 'donor', 'bridges', 'gala', 'boston']) assert.ok(by[k], k);
        assert.strictEqual(by.conference.date, '2026-12-04'); assert.strictEqual(by.conference.starts_at, '2026-12-04T17:00:00+01:00'); assert.strictEqual(by.conference.ends_at, '2026-12-05T21:00:00+01:00');
        assert.strictEqual(by.conference.venue, 'Novinarski dom'); assert.strictEqual(by.conference.tz, 'Europe/Zagreb');
        assert.strictEqual(by.boston.starts_at, '2026-09-21T17:30:00-04:00'); assert.strictEqual(by.boston.tz, 'America/New_York'); assert.strictEqual(by.boston.venue, 'Waterhouse Room, Gordon Hall');
        assert.strictEqual(by.boston.is_past, true); assert.strictEqual(by.boston.is_today, false); assert.strictEqual(by.conference.is_upcoming, true);
        assert.strictEqual(by.gala.venue, 'Hotel Esplanade'); assert.strictEqual(by.gala.date, '2026-12-05'); assert.strictEqual(by.gala.start, '18:00');
        assert.strictEqual(by.donor.venue, 'Esplanade Zagreb'); assert.strictEqual(by.donor.times_tbd, true);
        assert.strictEqual(by.bridges.tentative, true); assert.strictEqual(by.bridges.start, '11:00');
        assert.strictEqual(by.boston.session_count, 7); assert.strictEqual(by.boston.published_count, 7); assert.strictEqual(by.conference.tbd_count, 4);
        assert.deepStrictEqual(ev.map(e => e.key), ['conference', 'donor', 'bridges', 'gala', 'boston'], 'upcoming soonest-first (conference 17:00 before donor 19:30), past last');
        // is_today follows the phone's date
        const r2 = await call('GET', '/api/live/events', { query: { today: '2026-12-05' } });
        const by2 = {}; r2.body.events.forEach(e => { by2[e.key] = e; });
        assert.strictEqual(by2.gala.is_today, true); assert.strictEqual(by2.bridges.is_today, true);
        assert.strictEqual(by2.conference.is_today, true, 'the conference runs 4–5 December, so day 2 is still today'); assert.strictEqual(by2.conference.is_past, false);
        assert.deepStrictEqual(r2.body.events.filter(e => e.is_today).map(e => e.key).sort(), ['bridges', 'conference', 'gala'], "today's events: day 2 of the conference, Bridges and the Gala");
        assert.ok(r2.body.events.slice(0, 3).every(e => e.is_today), "today's events first");
        const r3 = await call('GET', '/api/live/events', { query: { today: '2026-12-06' } });
        assert.strictEqual(r3.body.events.find(e => e.key === 'conference').is_past, true, 'past from 6 December');
    });

    await t('GET /api/live/:eventKey/program — published rows grouped by day, TBD rows flagged, kinds normalised, zoned times; 404 for an unknown event', async () => {
        const r = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'conference' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.changed, true);
        assert.strictEqual(r.body.event.key, 'conference');
        assert.strictEqual(r.body.days.length, 1); assert.strictEqual(r.body.days[0].date, '2026-12-04'); assert.strictEqual(r.body.days[0].label, 'Friday 4 Dec');
        conf = r.body.days[0].sessions;
        assert.strictEqual(conf.length, 6);
        keynote1 = conf[1]; breakId = conf[3].id; panelId = conf[2].id;
        assert.strictEqual(keynote1.title, 'Keynote 1'); assert.strictEqual(keynote1.is_tbd, true); assert.strictEqual(keynote1.kind, 'keynote');
        assert.strictEqual(keynote1.starts_at, '2026-12-04T17:15:00+01:00'); assert.strictEqual(keynote1.ends_at, '2026-12-04T18:00:00+01:00');
        assert.strictEqual(conf[3].kind, 'break'); assert.strictEqual(conf[3].is_tbd, false);
        assert.ok(!('count' in keynote1), 'count hidden until show_counts');
        const bo = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'boston' } });
        boston = bo.body.sessions; block1 = boston.find(s => /block 1/.test(s.title));
        assert.strictEqual(block1.speaker_names.length, 8); assert.strictEqual(block1.speaker_names[0].name, 'Prof. Manolis Kellis'); assert.strictEqual(block1.speaker_names[0].institution, 'MIT · Broad Institute');
        assert.strictEqual(block1.starts_at, '2026-09-21T18:15:00-04:00');
        assert.strictEqual((await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'nope' } })).status, 404);
        assert.strictEqual((await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'meetup:zzz' } })).status, 404, 'a meetup that is not in plexus_meetups is no event');
    });

    await t('legacy rows without event_key are never on the live program; speakers from `speakers` + v2_speaker_meta resolve with photo + logo', async () => {
        q.run(`INSERT INTO sessions (id, conference_id, title, session_type, day, start_time, end_time, room, is_published) VALUES ('legacy-1', 'conf-26', 'Opening Ceremony', 'keynote', 1, '09:00', '10:00', 'Main Hall', 1)`);
        q.run(`UPDATE sessions SET speaker_ids = ?, show_counts = 1, updated_at = ? WHERE id = ?`, [SPK, new Date().toISOString(), keynote1.id]);
        const r = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'conference' } });
        assert.ok(!r.body.sessions.some(s => s.id === 'legacy-1'));
        const k = r.body.sessions.find(s => s.id === keynote1.id);
        assert.strictEqual(k.speakers.length, 1); assert.strictEqual(k.speakers[0].name, 'Prof. Siniša Hrvatin'); assert.strictEqual(k.speakers[0].photo_url, '/uploads/hrvatin.jpg'); assert.strictEqual(k.speakers[0].logo_url, '/uploads/mit.png');
        assert.strictEqual(k.count, 0, 'show_counts=1 → count present');
        assert.ok(r.body.speakers[SPK]);
        // unpublished rows stay off
        q.run('UPDATE sessions SET is_published = 0 WHERE id = ?', [breakId]);
        assert.strictEqual((await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'conference' } })).body.sessions.length, 5);
        q.run('UPDATE sessions SET is_published = 1 WHERE id = ?', [breakId]);
    });

    await t('?since= — unchanged program answers { changed:false }; an edit after `since` answers the full program', async () => {
        const first = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'boston' } });
        const u = first.body.updated_at; assert.ok(u);
        const same = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'boston' }, query: { since: u } });
        assert.strictEqual(same.body.changed, false); assert.ok(!same.body.days);
        const later = new Date(new Date(u).getTime() + 5000).toISOString();
        q.run('UPDATE sessions SET room = ?, updated_at = ? WHERE id = ?', ['Waterhouse Room (upstairs)', later, block1.id]);
        const again = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'boston' }, query: { since: u } });
        assert.strictEqual(again.body.changed, true); assert.strictEqual(again.body.sessions.find(s => s.id === block1.id).room, 'Waterhouse Room (upstairs)');
        // a delete leaves no row to stamp — touchEvent bumps the version instead
        const touched = core.touchEvent(q, 'boston');
        const t3 = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'boston' }, query: { since: new Date(new Date(touched).getTime() - 1).toISOString() } });
        assert.strictEqual(t3.body.changed, true);
        assert.strictEqual(core.lastUpdated(q, 'boston').updated_at, touched > later ? touched : later);
    });

    await t('live tokens: HMAC(secret, live:<kind>:<id>)[:32].<kind>.<id>; a tampered or foreign-secret token is refused; liveUrl exported from plexus-ticket', () => {
        const x = tok('ca', CA);
        assert.match(x, /^[0-9a-f]{32}\.ca\.ca-ana-0001$/);
        assert.deepStrictEqual(core.verifyLiveToken(SECRET, x), { kind: 'ca', id: CA });
        assert.strictEqual(core.verifyLiveToken(SECRET, x.replace(/^./, c => c === 'a' ? 'b' : 'a')), null);
        assert.strictEqual(core.verifyLiveToken('other', x), null);
        assert.strictEqual(core.verifyLiveToken(SECRET, x.replace('.ca.', '.gala.')), null, 'a kind swap is a different context');
        const pt = require(path.join(ROOT, 'user-portal/backend/plexus-ticket'));
        assert.strictEqual(pt.liveUrl('https://medx.hr/', SECRET, 'ca', CA), 'https://medx.hr/live/' + x);
        assert.strictEqual(require(path.join(ROOT, 'user-portal/backend/v2/live.js')).liveUrl('https://x.y', SECRET, 'gala', GALA), 'https://x.y/live/' + tok('gala', GALA));
    });

    await t('GET /api/live/me/:token — ca: name, events held, party per leg (conference 2 · bridges 1 · gala 2), current_event guess; the open is recorded', async () => {
        const r = await call('GET', '/api/live/me/:token', { params: { token: tok('ca', CA) }, query: { today: '2026-12-04' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const p = r.body.person;
        assert.strictEqual(p.name, 'Ana Franceschi'); assert.strictEqual(p.first_name, 'Ana'); assert.strictEqual(p.kind, 'ca'); assert.strictEqual(p.ref, CA);
        assert.deepStrictEqual(p.party, { conference: 2, bridges: 1, gala: 2 });
        assert.deepStrictEqual(p.events.sort(), ['bridges', 'conference', 'gala']);
        assert.strictEqual(p.is_speaker, false);
        const held = r.body.events.filter(e => e.held).map(e => e.key).sort();
        assert.deepStrictEqual(held, ['bridges', 'conference', 'gala']);
        assert.strictEqual(r.body.events.find(e => e.key === 'boston').held, false);
        assert.strictEqual(r.body.current_event, 'conference', "today (Dec 4) → today's held event");
        assert.deepStrictEqual(r.body.attendance, {});
        const open = q.get("SELECT * FROM v2_live_opens WHERE person_kind = 'ca' AND person_ref = ?", [CA]);
        assert.ok(open); assert.strictEqual(open.opens, 1); assert.ok(open.events_json.includes('"gala"'));
        await call('GET', '/api/live/me/:token', { params: { token: tok('ca', CA) } });
        assert.strictEqual(q.get("SELECT opens FROM v2_live_opens WHERE person_kind = 'ca' AND person_ref = ?", [CA]).opens, 2);
    });

    await t('me — gala token of a Zagreb registrant resolves to the SAME canonical person (kind ca) so counts never double; a bare gala row counts its seats', async () => {
        const r = await call('GET', '/api/live/me/:token', { params: { token: tok('gala', GALA) } });
        assert.strictEqual(r.status, 200); assert.strictEqual(r.body.person.kind, 'ca'); assert.strictEqual(r.body.person.ref, CA); assert.strictEqual(r.body.person.token_kind, 'gala');
        assert.strictEqual(r.body.person.party.gala, 2);
        q.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, guest_count) VALUES ('gala-solo', 'Solo', 'Guest', 'solo@example.com', 'confirmed', 'paid', 2)`);
        const s = await call('GET', '/api/live/me/:token', { params: { token: tok('gala', 'gala-solo') } });
        assert.strictEqual(s.body.person.kind, 'gala'); assert.deepStrictEqual(s.body.person.party, { gala: 3 });
    });

    await t('me — bridges (Boston me-token) → boston held, party 1; speaker → is_speaker + slot ids; user (Bearer) → linked by e-mail; unknown → 404; user without session → 401', async () => {
        const b = await call('GET', '/api/live/me/:token', { params: { token: tok('bridges', BOS) } });
        assert.strictEqual(b.status, 200, JSON.stringify(b.body)); assert.deepStrictEqual(b.body.person.party, { boston: 1 }); assert.strictEqual(b.body.person.name, 'Manolis Kellis');
        assert.strictEqual(b.body.current_event, 'boston', 'the only held event, even when past');
        const s = await call('GET', '/api/live/me/:token', { params: { token: tok('speaker', SPK) } });
        assert.strictEqual(s.status, 200); assert.strictEqual(s.body.person.is_speaker, true); assert.deepStrictEqual(s.body.person.speaker_session_ids, [keynote1.id]); assert.deepStrictEqual(s.body.person.events, ['conference']);
        const u = await call('GET', '/api/live/me/:token', { params: { token: 'user' }, user: { id: USER, email: 'toi@example.com' } });
        assert.strictEqual(u.status, 200, JSON.stringify(u.body)); assert.strictEqual(u.body.person.kind, 'ca'); assert.strictEqual(u.body.person.ref, CA2); assert.deepStrictEqual(u.body.person.party, { conference: 1 });
        const n = await call('GET', '/api/live/me/:token', { params: { token: 'user' }, user: { id: 'u-nobody', email: 'nobody@example.com' } });
        assert.strictEqual(n.status, 200); assert.deepStrictEqual(n.body.person.events, []); assert.strictEqual(n.body.person.kind, 'user');
        assert.strictEqual((await call('GET', '/api/live/me/:token', { params: { token: 'user' } })).status, 401);
        assert.strictEqual((await call('GET', '/api/live/me/:token', { params: { token: tok('ca', 'ca-missing') } })).status, 404);
        assert.strictEqual((await call('GET', '/api/live/me/:token', { params: { token: 'garbage' } })).status, 404);
    });

    await t('POST attend — one tap counts the party (Ana = 2 at a conference session); a second tap is an upsert, not a second row; declined removes the count', async () => {
        const a = await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: keynote1.id, state: 'attending' } });
        assert.strictEqual(a.status, 200, JSON.stringify(a.body)); assert.strictEqual(a.body.party, 2); assert.strictEqual(a.body.counted, 2); assert.strictEqual(a.body.count, 2, 'show_counts=1 on this row → count returned');
        const again = await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: keynote1.id, state: 'attending' } });
        assert.strictEqual(again.body.counted, 2);
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM v2_session_attendance WHERE session_id = ?', [keynote1.id]).n, 1);
        // the gala token is the same person → still one row
        await call('POST', '/api/live/me/:token/attend', { params: { token: tok('gala', GALA) }, body: { session_id: keynote1.id } });
        assert.strictEqual(q.get('SELECT COUNT(*) AS n FROM v2_session_attendance WHERE session_id = ?', [keynote1.id]).n, 1);
        // Toi (party 1) joins → 3; the program shows 3 (show_counts); the me call reflects attendance
        const b = await call('POST', '/api/live/me/:token/attend', { params: { token: 'user' }, user: { id: USER, email: 'toi@example.com' }, body: { session_id: keynote1.id } });
        assert.strictEqual(b.body.counted, 3);
        const prog = await call('GET', '/api/live/:eventKey/program', { params: { eventKey: 'conference' } });
        assert.strictEqual(prog.body.sessions.find(s => s.id === keynote1.id).count, 3);
        const me = await call('GET', '/api/live/me/:token', { params: { token: tok('ca', CA) } });
        assert.deepStrictEqual(me.body.attendance, { [keynote1.id]: 'attending' });
        // decline
        const d = await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: keynote1.id, state: 'declined' } });
        assert.strictEqual(d.body.state, 'declined'); assert.strictEqual(d.body.counted, 1);
        assert.strictEqual(q.get('SELECT state FROM v2_session_attendance WHERE session_id = ? AND person_ref = ?', [keynote1.id, CA]).state, 'declined');
        // a count-hidden row answers counted but no count
        const p2 = await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: panelId } });
        assert.strictEqual(p2.body.counted, 2); assert.strictEqual(p2.body.count, undefined);
    });

    await t('attend guards — an event not on the ticket is 403 (Ana at Boston), an unpublished or unknown session is 404, a bad state is 400, a speaker may attend their own slot', async () => {
        assert.strictEqual((await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: block1.id } })).status, 403);
        assert.strictEqual((await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: 'legacy-1' } })).status, 404);
        assert.strictEqual((await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: keynote1.id, state: 'maybe' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: {} })).status, 400);
        const sp = await call('POST', '/api/live/me/:token/attend', { params: { token: tok('speaker', SPK) }, body: { session_id: keynote1.id } });
        assert.strictEqual(sp.status, 200); assert.strictEqual(sp.body.party, 1);
        const bos = await call('POST', '/api/live/me/:token/attend', { params: { token: tok('bridges', BOS) }, body: { session_id: block1.id } });
        assert.strictEqual(bos.status, 200); assert.strictEqual(bos.body.counted, 1);
    });

    await t('GET schedule — built from the registration (every published session of a held event, minus the ones tapped off), in order with event labels; overlaps flagged; a speaker sees their slot as speaking', async () => {
        // Ana holds the conference: everything published there is IN except keynote-1, which she declined above;
        // keynote-2 is shifted to overlap the panel
        const keynote2 = conf[4];
        q.run("UPDATE sessions SET start_time = '18:30', end_time = '19:15' WHERE id = ?", [keynote2.id]);
        await call('POST', '/api/live/me/:token/attend', { params: { token: tok('ca', CA) }, body: { session_id: keynote2.id } });
        const r = await call('GET', '/api/live/me/:token/schedule', { params: { token: tok('ca', CA) } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        const ids = r.body.sessions.map(s => s.id);
        const published = q.all("SELECT id FROM sessions WHERE event_key = 'conference' AND COALESCE(is_published, 0) = 1").map(x => x.id);
        const confIds = r.body.sessions.filter(s => s.event_key === 'conference').map(s => s.id);
        assert.deepStrictEqual(confIds.slice().sort(), published.filter(id => id !== keynote1.id).sort(), 'every published conference session except the declined keynote');
        const held = (await call('GET', '/api/live/me/:token', { params: { token: tok('ca', CA) } })).body.person.events;
        assert.ok(r.body.sessions.every(s => held.includes(s.event_key)), 'only events on her ticket');
        assert.ok(!ids.includes(keynote1.id), 'a session tapped off stays off');
        const starts = r.body.sessions.map(s => (s.event_date || '') + ' ' + (s.start_time || '99'));
        assert.deepStrictEqual(starts, starts.slice().sort(), 'chronological');
        const panel = r.body.sessions.find(s => s.id === panelId);
        assert.strictEqual(panel.event_label, 'Plexus Conference'); assert.strictEqual(panel.venue, 'Novinarski dom');
        assert.strictEqual(panel.state, 'attending'); assert.strictEqual(panel.auto, false);
        assert.ok(r.body.sessions.some(s => s.state === 'included' && s.auto === true), 'untapped sessions ride along from the registration');
        assert.ok(r.body.conflicts.includes(panelId) && r.body.conflicts.includes(keynote2.id));
        assert.strictEqual(panel.conflict, true);
        assert.strictEqual(r.body.days.length, new Set(r.body.sessions.map(x => x.event_date)).size);
        const s = await call('GET', '/api/live/me/:token/schedule', { params: { token: tok('speaker', SPK) } });
        const slot = s.body.sessions.find(x => x.id === keynote1.id);
        assert.ok(slot, 'the speaker\'s slot is on their schedule'); assert.strictEqual(slot.speaking, true); assert.strictEqual(slot.state, 'speaking');
        q.run("UPDATE sessions SET start_time = '19:20', end_time = '20:05' WHERE id = ?", [keynote2.id]);
    });

    await t('.ics — one session, a day, the whole schedule and the public session file are valid VCALENDARs with zoned DTSTART and a TENTATIVE flag on TBD rows', async () => {
        const one = await call('GET', '/api/live/me/:token/schedule.ics', { params: { token: tok('ca', CA) }, query: { session: panelId } });
        assert.strictEqual(one.status, 200, String(one.body).slice(0, 200));
        assert.match(one.headers['content-type'], /text\/calendar/);
        assert.match(one.headers['content-disposition'], /plexus-live-session\.ics/);
        const body = String(one.body);
        assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n')); assert.ok(body.trim().endsWith('END:VCALENDAR'));
        assert.strictEqual((body.match(/BEGIN:VEVENT/g) || []).length, 1);
        assert.ok(body.includes('DTSTART;TZID=Europe/Zagreb:20261204T180000')); assert.ok(body.includes('DTEND;TZID=Europe/Zagreb:20261204T190000'));
        assert.ok(body.includes('STATUS:TENTATIVE'), 'a TBD row is tentative');
        assert.ok(body.includes('SUMMARY:Plexus Conference — Panel (TBD)'));
        assert.ok(body.includes('BEGIN:VTIMEZONE') && body.includes('TZID:Europe/Zagreb'));
        assert.ok(body.includes('/live/' + tok('ca', CA)), 'the app link rides in the description');
        const mine = (await call('GET', '/api/live/me/:token/schedule', { params: { token: tok('ca', CA) } })).body.sessions;
        const day = await call('GET', '/api/live/me/:token/schedule.ics', { params: { token: tok('ca', CA) }, query: { date: '2026-12-04' } });
        assert.strictEqual((String(day.body).match(/BEGIN:VEVENT/g) || []).length, mine.filter(x => x.event_date === '2026-12-04').length);
        assert.match(day.headers['content-disposition'], /plexus-live-2026-12-04\.ics/);
        const all = await call('GET', '/api/live/me/:token/schedule.ics', { params: { token: tok('ca', CA) } });
        assert.strictEqual((String(all.body).match(/BEGIN:VEVENT/g) || []).length, mine.length);
        assert.strictEqual((await call('GET', '/api/live/me/:token/schedule.ics', { params: { token: tok('ca', CA) }, query: { date: '2026-12-25' } })).status, 404);
        const pub = await call('GET', '/api/live/:eventKey/sessions/:id.ics', { params: { eventKey: 'boston', id: block1.id } });
        assert.strictEqual(pub.status, 200); assert.ok(String(pub.body).includes('DTSTART;TZID=America/New_York:20260921T181500')); assert.ok(String(pub.body).includes('TZID:America/New_York'));
        assert.ok(String(pub.body).includes('LOCATION:Waterhouse Room (upstairs)\\, Waterhouse Room\\, Gordon Hall'));
        assert.strictEqual((await call('GET', '/api/live/:eventKey/sessions/:id.ics', { params: { eventKey: 'boston', id: 'legacy-1' } })).status, 404);
    });

    await t('a ca row with a guest who ticked only the Gala → conference party 1, gala party 2; cancelled legs drop out', async () => {
        q.run(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, selected_bridges, selected_gala, conference_status, bridges_status, gala_status, gala_payment_status, gala_registration_id, guest_count) VALUES ('ca-x', 'Ivo', 'Ivić', 'ivo@example.com', 1, 1, 1, 'pre-registered', 'cancelled', 'confirmed', 'paid', 'gala-x', 1)`);
        q.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, guest_count) VALUES ('gala-x', 'Ivo', 'Ivić', 'ivo@example.com', 'confirmed', 'paid', 1)`);
        q.run(`INSERT INTO ca_registration_guests (id, registration_id, name, conference, bridges, gala) VALUES ('g2', 'ca-x', 'Plus One', 0, 0, 1)`);
        const r = await call('GET', '/api/live/me/:token', { params: { token: tok('ca', 'ca-x') } });
        assert.deepStrictEqual(r.body.person.party, { conference: 1, gala: 2 });
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})().catch(e => { console.error(e); process.exit(1); });
