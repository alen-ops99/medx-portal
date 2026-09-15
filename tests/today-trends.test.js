/**
 * tests/today-trends.test.js — GET /api/dashboard/trends, the Today dashboard's activity chart.
 *
 * Hermetic, in the house pattern (tests/big-ideas.test.js): a stub express app collects routes, ONE
 * in-memory libsql database (the same shared/db.js wrapper both portals use) carries the real
 * schema, and global.fetch is disabled, so A REAL NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * The route lives inline in the 43k-line admin-portal/backend/server.js, which boots a listener the
 * moment it is required — so nothing is exported from it and nothing is copied out of it either.
 * Instead the route's whole body is ONE self-contained function, buildDashboardTrends(query, days,
 * event), fenced by the TRENDS-SERIES-HELPER markers, and this file LIFTS THAT SOURCE VERBATIM and
 * runs it against its own database. A static check below proves the shipped route is nothing but a
 * delegation to the lifted function, so what is tested here is what is served there.
 *
 * Covers what the endpoint has to get right:
 *   every per-source key present (conference · gala · gala_paid · gala_unpaid · bridges_zagreb ·
 *   bridges_boston · accelerator · forum · meetups · total) beside the compat trio (plexus ·
 *   accelerator · events) · the zero-fill (exactly `days` entries, ascending, consecutive, ending
 *   today) · ?days=7|30|90 with junk falling back to 30 · total = the per-day sum of the seven
 *   sources · gala_paid + gala_unpaid = gala day by day · the window boundary (a row on the first
 *   day counts, a row before it does not, a row today does) · ?event= narrowing the compat trio ·
 *   and a table this replica does not have answering zeros rather than a 500.
 *
 * Run:  node tests/today-trends.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
process.env.PORT = '3000';

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));
const meetupsCore = require(path.join(ROOT, 'shared/meetups-core'));

const SERVER_JS = path.join(ROOT, 'admin-portal/backend/server.js');
const BOSTON_OPS = path.join(ROOT, 'admin-portal/backend/v2/boston-ops.js');

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
                headers: {}, protocol: 'https', get: () => 'admin.test'
            };
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

// ---------------------------------------------------------------- lift the real helper
const serverSrc = fs.readFileSync(SERVER_JS, 'utf8');
const MARK_START = '── TRENDS-SERIES-HELPER';
const MARK_END = '── END TRENDS-SERIES-HELPER';
const startAt = serverSrc.indexOf(MARK_START);
const endAt = serverSrc.indexOf(MARK_END);
if (startAt < 0 || endAt < 0 || endAt < startAt) {
    console.error('FATAL: the TRENDS-SERIES-HELPER markers are gone from server.js — this test cannot see the code it is meant to cover.');
    process.exit(1);
}
const fenced = serverSrc.slice(startAt, endAt);
// from the declaration to its closing brace — the END marker's own comment line stays out.
const fnSrc = fenced.slice(fenced.indexOf('function buildDashboardTrends'), fenced.lastIndexOf('}') + 1);
// eslint-disable-next-line no-new-func
const buildDashboardTrends = new Function('return (\n' + fnSrc + '\n);')();

// ---------------------------------------------------------------- one shared DB
const db = createDatabase(Database, { localPath: ':memory:' });
[
    `CREATE TABLE croatians_abroad_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        conference_status TEXT, bridges_status TEXT, gala_status TEXT, source TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        status TEXT DEFAULT 'pending', payment_status TEXT, guest_count INTEGER DEFAULT 0, requests TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE bridges_registrations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, first_name TEXT, last_name TEXT,
        email TEXT, status TEXT DEFAULT 'registered', payment_status TEXT DEFAULT 'n/a',
        registered_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE accelerator_programs (id TEXT PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 0)`,
    `CREATE TABLE accelerator_applications (id TEXT PRIMARY KEY, program_id TEXT, status TEXT, payment_status TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE forum_event_registrations (id TEXT PRIMARY KEY, event_id TEXT, member_id TEXT, email TEXT,
        status TEXT DEFAULT 'registered', registered_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE signup_form_responses (id TEXT PRIMARY KEY, form_id TEXT, email TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
].forEach(s => db.run(s));

const q = {
    run: (s, p) => db.run(s, p || []),
    get: (s, p) => { const st = db.prepare(s); st.bind(p || []); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
    all: (s, p) => { const st = db.prepare(s); st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; }
};

// plexus_meetup_attendees comes from the REAL DDL, so a renamed column here would fail the run.
meetupsCore.ensureSchema(q);

// ---------------------------------------------------------------- mount as production does
const auth = (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'Authentication required' }); next(); };
const adminOnly = (req, res, next) => { if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Admin only' }); next(); };
const ADMIN = { id: 'u-alen', email: 'juginovic.alen@gmail.com', is_admin: true };
const NOT_ADMIN = { id: 'u-ana', email: 'ana@example.hr', is_admin: false };

const app = stubApp();
app.get('/api/dashboard/trends', auth, adminOnly, (req, res) => {
    res.json(buildDashboardTrends(q, req.query.days, req.query.event));
});

// ---------------------------------------------------------------- helpers
const trends = (query) => app.call('GET', '/api/dashboard/trends', { user: ADMIN, query: query || {} });
const SOURCE_KEYS = ['conference', 'gala', 'bridges_zagreb', 'bridges_boston', 'accelerator', 'forum', 'meetups'];
const ALL_KEYS = ['conference', 'gala', 'gala_paid', 'gala_unpaid', 'bridges_zagreb', 'bridges_boston',
    'accelerator', 'forum', 'meetups', 'total', 'plexus', 'events'];

const NOW = new Date();
const dayKey = (n) => new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - n)).toISOString().slice(0, 10);
const at = (n) => dayKey(n) + ' 12:00:00';
const sum = (s) => (s || []).reduce((a, p) => a + (Number(p.count) || 0), 0);
const onDay = (s, n) => { const row = (s || []).find(p => p.date === dayKey(n)); return row ? row.count : null; };

const BOSTON_EVENT_ID = 'bb-boston-2026-09-21';

(async () => {
    console.log('today-trends.test.js — hermetic (stub express, in-memory libsql, helper lifted from server.js, no network)\n');

    // ============================================================ wiring
    await t('the shipped route is nothing but a delegation to the lifted helper', () => {
        assert.match(serverSrc, /app\.get\('\/api\/dashboard\/trends',\s*auth,\s*adminOnly,\s*\(req,\s*res\)\s*=>\s*\{\s*\n\s*res\.json\(buildDashboardTrends\(query,\s*req\.query\.days,\s*req\.query\.event\)\);\s*\n\s*\}\);/,
            'the route body drifted away from buildDashboardTrends(query, req.query.days, req.query.event)');
        assert.strictEqual((serverSrc.match(/function buildDashboardTrends\(/g) || []).length, 1, 'exactly one helper definition');
        assert.ok(app.routes['GET /api/dashboard/trends'], 'route mounted in the harness too');
    });

    await t('the Boston event id is the same literal boston-ops.js fixes, never a second one', () => {
        const ops = fs.readFileSync(BOSTON_OPS, 'utf8');
        assert.match(ops, new RegExp("EVENT_ID = '" + BOSTON_EVENT_ID + "'"), 'boston-ops still fixes that id');
        assert.ok(fenced.includes("'" + BOSTON_EVENT_ID + "'"), 'the trends helper reuses it verbatim');
    });

    await t('a signed-out caller is refused, a non-admin is refused, an admin is served', async () => {
        assert.strictEqual((await app.call('GET', '/api/dashboard/trends')).status, 401);
        assert.strictEqual((await app.call('GET', '/api/dashboard/trends', { user: NOT_ADMIN })).status, 403);
        assert.strictEqual((await trends()).status, 200);
    });

    // ============================================================ shape on an EMPTY database
    await t('every per-source key and every compat key is present on an empty database', async () => {
        const r = await trends();
        assert.strictEqual(r.status, 200);
        for (const k of ALL_KEYS) {
            assert.ok(Object.prototype.hasOwnProperty.call(r.body, k), 'missing key: ' + k);
            assert.ok(Array.isArray(r.body[k]), k + ' is not an array');
        }
        assert.strictEqual(r.body.days, 30);
        assert.strictEqual(r.body.from, dayKey(29));
        assert.strictEqual(r.body.to, dayKey(0));
    });

    await t('an empty database still answers a full zero-filled axis: length, all zeros, last day today', async () => {
        const r = await trends();
        for (const k of ALL_KEYS) {
            const s = r.body[k];
            assert.strictEqual(s.length, 30, k + ' has ' + s.length + ' entries, not 30');
            assert.ok(s.every(p => p.count === 0), k + ' is not all-zero on an empty database');
            assert.strictEqual(s[s.length - 1].date, dayKey(0), k + ' does not end today');
            assert.strictEqual(s[0].date, dayKey(29), k + ' does not start 29 days back');
        }
    });

    await t('the axis is strictly ascending and consecutive calendar days, with no gaps', async () => {
        const r = await trends({ days: '30' });
        for (const k of ALL_KEYS) {
            const s = r.body[k];
            for (let i = 1; i < s.length; i++) {
                assert.ok(s[i].date > s[i - 1].date, k + ': dates not ascending at ' + i);
                const gap = (Date.parse(s[i].date + 'T00:00:00Z') - Date.parse(s[i - 1].date + 'T00:00:00Z')) / 86400000;
                assert.strictEqual(gap, 1, k + ': ' + s[i - 1].date + ' → ' + s[i].date + ' is not one day');
            }
        }
    });

    // ============================================================ the window parameter
    await t('?days=7|30|90 changes the length, and junk falls back to 30', async () => {
        for (const d of [7, 30, 90]) {
            const r = await trends({ days: String(d) });
            assert.strictEqual(r.body.days, d);
            assert.strictEqual(r.body.total.length, d, 'days=' + d);
            assert.strictEqual(r.body.from, dayKey(d - 1));
            assert.strictEqual(r.body.to, dayKey(0));
            for (const k of ALL_KEYS) assert.strictEqual(r.body[k].length, d, k + ' at days=' + d);
        }
        for (const junk of ['abc', '5000', '0', '-7', '', '31', 'null', '7.5']) {
            const r = await trends({ days: junk });
            assert.strictEqual(r.body.days, 30, '?days=' + JSON.stringify(junk) + ' should fall back to 30');
            assert.strictEqual(r.body.total.length, 30);
        }
        const none = await trends();
        assert.strictEqual(none.body.days, 30, 'no ?days at all defaults to 30');
    });

    // ============================================================ seed rows on KNOWN dates
    await t('seeding rows on known dates', () => {
        const ca = (id, back, conf, bridges) => q.run(
            'INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, conference_status, bridges_status, created_at) VALUES (?,?,?,?,?,?,?)',
            [id, 'A', 'B', id + '@example.hr', conf, bridges, at(back)]);
        ca('ca-1', 1, 'pre-registered', 'pre-registered');
        ca('ca-2', 1, 'confirmed', null);
        ca('ca-3', 3, 'registered', 'confirmed');
        ca('ca-4', 3, null, 'not-attending');          // neither a conference nor a bridges sign-up
        ca('ca-5', 20, 'pre-registered', 'pre-registered');   // inside 30 and 90, outside 7
        ca('ca-6', 0, 'pre-registered', '');           // today; the empty string is not a sign-up
        ca('ca-7', 60, 'pre-registered', null);        // inside 90 only
        ca('ca-8', 200, 'pre-registered', 'confirmed');  // outside every window

        const gala = (id, back, status, pay) => q.run(
            'INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status, created_at) VALUES (?,?,?,?,?,?,?)',
            [id, 'G', 'B', id + '@example.hr', status, pay, at(back)]);
        gala('g-1', 2, 'confirmed', 'paid');
        gala('g-2', 2, 'awaiting_payment', 'pending');
        gala('g-3', 4, 'approved', 'paid');
        gala('g-4', 4, 'cancelled', 'refunded');       // neither paid nor awaiting
        gala('g-5', 0, 'pending', null);               // today, no payment row yet
        gala('g-6', 25, 'confirmed', 'paid');          // inside 30 and 90, outside 7

        const bridges = (id, back, eventId, status) => q.run(
            'INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status, registered_at) VALUES (?,?,?,?,?,?,?)',
            [id, eventId, 'B', 'B', id + '@example.com', status, at(back)]);
        bridges('bb-1', 1, BOSTON_EVENT_ID, 'registered');
        bridges('bb-2', 1, BOSTON_EVENT_ID, 'cancelled');    // not a Boston head, still an "events" row
        bridges('bb-3', 5, 'bb-some-other-city', 'registered');

        q.run("INSERT INTO accelerator_programs (id, name, is_active) VALUES ('p-live','Accelerator 2026',1)");
        q.run("INSERT INTO accelerator_programs (id, name, is_active) VALUES ('p-old','Accelerator 2025',0)");
        const acc = (id, back, program) => q.run('INSERT INTO accelerator_applications (id, program_id, status, created_at) VALUES (?,?,?,?)',
            [id, program, 'submitted', at(back)]);
        acc('acc-1', 2, 'p-live');
        acc('acc-2', 6, 'p-live');                     // the very first day of the 7-day window
        acc('acc-3', 2, 'p-old');                      // last year's programme never counts

        const forum = (id, back) => q.run('INSERT INTO forum_event_registrations (id, event_id, email, status, registered_at) VALUES (?,?,?,?,?)',
            [id, 'fe-1', id + '@example.hr', 'registered', at(back)]);
        forum('f-1', 3);
        forum('f-2', 0);

        const meet = (id, back, status) => q.run(
            'INSERT INTO plexus_meetup_attendees (id, meetup_id, email, status, created_at) VALUES (?,?,?,?,?)',
            [id, 'm-zagreb', id + '@example.hr', status, at(back)]);
        meet('mt-1', 1, 'confirmed');
        meet('mt-2', 1, 'waitlisted');                 // a seat not yet taken is not a sign-up
        meet('mt-3', 0, 'confirmed');

        q.run('INSERT INTO signup_form_responses (id, form_id, email, created_at) VALUES (?,?,?,?)', ['sf-1', 'form-1', 'sf@example.hr', at(2)]);

        assert.strictEqual(q.all('SELECT id FROM croatians_abroad_registrations').length, 8);
        assert.strictEqual(q.all('SELECT id FROM gala_registrations').length, 6);
    });

    // ============================================================ the per-source counts
    await t('each source counts exactly its own rows over a 7-day window', async () => {
        const b = (await trends({ days: '7' })).body;
        assert.strictEqual(sum(b.conference), 4, 'conference: ca-1, ca-2, ca-3, ca-6');
        assert.strictEqual(sum(b.bridges_zagreb), 2, 'bridges_zagreb: ca-1, ca-3 (NULL, empty and not-attending are out)');
        assert.strictEqual(sum(b.gala_paid), 2, 'gala_paid: g-1, g-3');
        assert.strictEqual(sum(b.gala_unpaid), 2, 'gala_unpaid: g-2, g-5 (cancelled g-4 is out)');
        assert.strictEqual(sum(b.gala), 4);
        assert.strictEqual(sum(b.bridges_boston), 1, 'bridges_boston: bb-1 only (cancelled and other-city are out)');
        assert.strictEqual(sum(b.accelerator), 2, 'accelerator: acc-1, acc-2 (last year\'s programme is out)');
        assert.strictEqual(sum(b.forum), 2);
        assert.strictEqual(sum(b.meetups), 2, 'meetups: mt-1, mt-3 (waitlisted is out)');

        assert.strictEqual(onDay(b.conference, 1), 2, 'two conference rows landed on the same day');
        assert.strictEqual(onDay(b.conference, 2), 0, 'a quiet day is a zero, not a missing entry');
        assert.strictEqual(onDay(b.gala_paid, 2), 1);
        assert.strictEqual(onDay(b.meetups, 0), 1);
    });

    await t('total is the per-day sum of the seven sources, at 7, 30 and 90 days', async () => {
        for (const d of [7, 30, 90]) {
            const b = (await trends({ days: String(d) })).body;
            for (let i = 0; i < d; i++) {
                const expect = SOURCE_KEYS.reduce((a, k) => a + b[k][i].count, 0);
                assert.strictEqual(b.total[i].count, expect,
                    'days=' + d + ' on ' + b.total[i].date + ': total ' + b.total[i].count + ' ≠ ' + expect);
                assert.strictEqual(b.total[i].date, b.conference[i].date, 'the series are not on one axis');
            }
        }
        assert.strictEqual(sum((await trends({ days: '7' })).body.total), 17);
        assert.strictEqual(sum((await trends({ days: '30' })).body.total), 20, 'ca-5 and g-6 join at 30 days');
        assert.strictEqual(sum((await trends({ days: '90' })).body.total), 21, 'ca-7 joins at 90 days');
    });

    await t('gala_paid + gala_unpaid equals gala, day by day, at every window', async () => {
        for (const d of [7, 30, 90]) {
            const b = (await trends({ days: String(d) })).body;
            for (let i = 0; i < d; i++) {
                assert.strictEqual(b.gala[i].count, b.gala_paid[i].count + b.gala_unpaid[i].count,
                    'days=' + d + ' on ' + b.gala[i].date);
                assert.strictEqual(b.gala[i].date, b.gala_paid[i].date);
                assert.strictEqual(b.gala[i].date, b.gala_unpaid[i].date);
            }
        }
    });

    // ============================================================ the window edges
    await t('a row dated outside the window is excluded and a row dated today is included', async () => {
        const seven = (await trends({ days: '7' })).body;
        assert.strictEqual(onDay(seven.conference, 0), 1, 'ca-6 is today and counts');
        assert.strictEqual(onDay(seven.gala_unpaid, 0), 1, 'g-5 is today and counts');
        assert.strictEqual(onDay(seven.meetups, 0), 1, 'mt-3 is today and counts');
        assert.strictEqual(seven.conference.find(p => p.date === dayKey(20)), undefined, 'day-20 is not even on a 7-day axis');
        assert.strictEqual(sum(seven.conference), 4, 'ca-5 (20 days back) stays out of the 7-day window');

        const thirty = (await trends({ days: '30' })).body;
        assert.strictEqual(onDay(thirty.conference, 20), 1, 'ca-5 appears once the window reaches it');
        assert.strictEqual(sum(thirty.conference), 5);
        assert.strictEqual(onDay(thirty.gala_paid, 25), 1, 'g-6 appears at 30 days');

        const ninety = (await trends({ days: '90' })).body;
        assert.strictEqual(onDay(ninety.conference, 60), 1, 'ca-7 appears at 90 days');
        assert.strictEqual(sum(ninety.conference), 6, 'ca-8 at 200 days back is never counted, at any window');
    });

    await t('the first day of the window is inside it', async () => {
        const seven = (await trends({ days: '7' })).body;
        assert.strictEqual(seven.accelerator[0].date, dayKey(6));
        assert.strictEqual(seven.accelerator[0].count, 1, 'acc-2 sits on the oldest day of the axis and counts');
    });

    // ============================================================ the compat trio
    await t('plexus is the conference series and events is the combined sign-up series', async () => {
        const b = (await trends({ days: '7' })).body;
        assert.deepStrictEqual(b.plexus, b.conference, 'plexus keeps its old meaning: the conference series');
        // gala 5 + bridges 3 + croatians abroad 5 + forum 2 + sign-up forms 1
        assert.strictEqual(sum(b.events), 16, 'events sums every event table, unfiltered by status');
        assert.strictEqual(b.events.length, 7);
    });

    await t('?event= still narrows the compat trio exactly as before, and the per-source keys survive', async () => {
        const all = (await trends({ days: '7', event: 'all' })).body;
        assert.ok(sum(all.plexus) > 0 && sum(all.accelerator) > 0 && sum(all.events) > 0);

        const onlyPlexus = (await trends({ days: '7', event: 'plexus' })).body;
        assert.deepStrictEqual(onlyPlexus.plexus, all.conference);
        assert.deepStrictEqual(onlyPlexus.accelerator, []);
        assert.deepStrictEqual(onlyPlexus.events, []);
        assert.strictEqual(sum(onlyPlexus.conference), 4, 'the per-source conference series is never narrowed');
        assert.strictEqual(sum(onlyPlexus.total), 17, 'total stays whole whatever the compat filter asks for');

        const onlyAcc = (await trends({ days: '7', event: 'accelerator' })).body;
        assert.deepStrictEqual(onlyAcc.plexus, []);
        assert.strictEqual(sum(onlyAcc.accelerator), 2);
        assert.deepStrictEqual(onlyAcc.events, []);

        const onlyEvents = (await trends({ days: '7', event: 'events' })).body;
        assert.deepStrictEqual(onlyEvents.plexus, []);
        assert.deepStrictEqual(onlyEvents.accelerator, []);
        assert.strictEqual(sum(onlyEvents.events), 16);

        const nonsense = (await trends({ days: '7', event: 'zzz' })).body;
        assert.deepStrictEqual(nonsense.plexus, all.plexus, 'an unknown ?event is treated as all');
        assert.deepStrictEqual(nonsense.events, all.events);
    });

    // ============================================================ a replica missing a table
    await t('a table this replica does not have answers an all-zero series, not a 500', async () => {
        const before = (await trends({ days: '7' })).body;
        assert.strictEqual(sum(before.meetups), 2);

        q.run('DROP TABLE plexus_meetup_attendees');

        const r = await trends({ days: '7' });
        assert.strictEqual(r.status, 200, 'a missing table must never become a 500');
        assert.strictEqual(r.body.meetups.length, 7, 'still a full axis');
        assert.ok(r.body.meetups.every(p => p.count === 0), 'and all zeros');
        assert.strictEqual(sum(r.body.total), 15, 'total drops by exactly the two meetup sign-ups');
        for (let i = 0; i < 7; i++) {
            assert.strictEqual(r.body.total[i].count, SOURCE_KEYS.reduce((a, k) => a + r.body[k][i].count, 0));
        }
        for (const k of ALL_KEYS) assert.ok(Array.isArray(r.body[k]), k + ' vanished when a table did');
    });

    await t('every table missing at once still answers the full shape', async () => {
        for (const table of ['croatians_abroad_registrations', 'gala_registrations', 'bridges_registrations',
            'accelerator_applications', 'accelerator_programs', 'forum_event_registrations', 'signup_form_responses']) {
            q.run('DROP TABLE ' + table);
        }
        const r = await trends({ days: '90' });
        assert.strictEqual(r.status, 200);
        for (const k of ALL_KEYS) {
            assert.strictEqual(r.body[k].length, 90, k);
            assert.ok(r.body[k].every(p => p.count === 0), k + ' is not all-zero');
        }
        assert.strictEqual(r.body.days, 90);
        assert.strictEqual(r.body.to, dayKey(0));
    });

    // ============================================================ the browser's side of the same
    // contract: admin-portal/frontend-v2/js/trends.js turns this payload into the chart's axis and
    // series. It is import-free on purpose so it can be exercised here, under plain node, with no
    // DOM — the drawing in js/views/today.js is the only part left that needs a browser.
    const T = await import(require('node:url').pathToFileURL(
        path.join(ROOT, 'admin-portal/frontend-v2/js/trends.js')).href);

    // One payload shaped exactly like the endpoint's answer above: 7 days ending 2026-09-15.
    const FD = ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'];
    const ser = (counts) => FD.map((d, i) => ({ date: d, count: counts[i] }));
    const PAYLOAD = {
        days: 7, from: FD[0], to: FD[6],
        conference:     ser([1, 0, 2, 0, 0, 3, 1]),
        gala:           ser([0, 2, 0, 0, 1, 0, 0]),
        gala_paid:      ser([0, 1, 0, 0, 1, 0, 0]),
        gala_unpaid:    ser([0, 1, 0, 0, 0, 0, 0]),
        bridges_zagreb: ser([0, 0, 1, 1, 0, 0, 0]),
        bridges_boston: ser([2, 0, 0, 0, 0, 0, 1]),
        accelerator:    ser([0, 0, 0, 0, 0, 0, 0]),
        forum:          ser([0, 0, 0, 1, 0, 0, 0]),
        meetups:        ser([0, 0, 0, 0, 0, 0, 0]),
        total:          ser([3, 2, 3, 2, 1, 3, 2]),
        plexus:         ser([1, 0, 2, 0, 0, 3, 1]),
        events:         ser([3, 2, 3, 2, 1, 3, 2])
    };

    await t('[frontend] the axis comes from the payload window, not the browser clock', () => {
        const m = T.buildTrend(PAYLOAD, { days: 7, now: new Date('2030-01-01T00:00:00') });
        assert.deepStrictEqual(m.dates, FD);
        assert.strictEqual(m.days, 7);
        assert.strictEqual(m.rangeLabel, '9 SEP — 15 SEP');
    });

    await t('[frontend] every legend series exists, in legend order, with its window sum', () => {
        const m = T.buildTrend(PAYLOAD, { days: 7 });
        assert.deepStrictEqual(m.series.map(s => s.key),
            ['total', 'conference', 'gala', 'bridges_zagreb', 'bridges_boston', 'accelerator', 'forum', 'meetups']);
        assert.deepStrictEqual(m.series.map(s => s.label),
            ['TOTAL', 'CONFERENCE', 'GALA', 'BRIDGES ZAGREB', 'BRIDGES BOSTON', 'ACCELERATOR', 'FORUM', 'MEETUPS']);
        assert.strictEqual(m.series.find(s => s.key === 'conference').sum, 7);
        assert.strictEqual(m.series.find(s => s.key === 'gala').sum, 3);
        assert.strictEqual(m.series.find(s => s.key === 'bridges_boston').sum, 3);
        assert.ok(m.series.every(s => /^#[0-9a-f]{6}$/i.test(s.color)), 'every series needs a colour');
        assert.strictEqual(new Set(m.series.map(s => s.color)).size, 8, 'colours must be distinct');
    });

    await t('[frontend] the headline number is the total over the window', () => {
        const m = T.buildTrend(PAYLOAD, { days: 7 });
        assert.strictEqual(m.total, 16);
        assert.strictEqual(m.total, PAYLOAD.total.reduce((a, r) => a + r.count, 0));
    });

    await t('[frontend] a sparse or out-of-order series still lands on the right days', () => {
        const m = T.buildTrend(Object.assign({}, PAYLOAD, {
            conference: [{ date: '2026-09-15', count: 4 }, { date: '2026-09-09', count: 1 }, { date: '2026-08-01', count: 99 }]
        }), { days: 7 });
        const c = m.series.find(s => s.key === 'conference');
        assert.deepStrictEqual(c.values, [1, 0, 0, 0, 0, 0, 4]);
        assert.strictEqual(c.sum, 5, 'a day outside the window must not be counted');
    });

    await t('[frontend] no total in the payload -> summed from the seven sources', () => {
        const p = Object.assign({}, PAYLOAD); delete p.total;
        const m = T.buildTrend(p, { days: 7 });
        const t0 = m.series.find(s => s.total);
        assert.deepStrictEqual(t0.values, FD.map((d, i) =>
            T.SOURCE_KEYS.reduce((a, k) => a + PAYLOAD[k][i].count, 0)));
    });

    await t('[frontend] a pre-deploy backend (plexus/accelerator/events only) still draws', () => {
        const m = T.buildTrend({ plexus: PAYLOAD.plexus, accelerator: PAYLOAD.accelerator, events: PAYLOAD.events },
            { days: 7, now: new Date('2026-09-15T12:00:00') });
        assert.strictEqual(m.stale, true, 'the view has to know to say so');
        assert.deepStrictEqual(m.series.find(s => s.key === 'conference').values, [1, 0, 2, 0, 0, 3, 1]);
        assert.strictEqual(m.total, 16);
        assert.strictEqual(m.dates.length, 7);
    });

    await t('[frontend] all-zero series start hidden — except the total', () => {
        const m = T.buildTrend(PAYLOAD, { days: 7 });
        assert.strictEqual(m.series.find(s => s.key === 'accelerator').hidden, true);
        assert.strictEqual(m.series.find(s => s.key === 'meetups').hidden, true);
        assert.strictEqual(m.series.find(s => s.key === 'conference').hidden, false);
        const empty = T.buildTrend({ days: 7, to: FD[6] }, { days: 7 });
        assert.strictEqual(empty.series.find(s => s.total).hidden, false, 'an empty window still shows its total');
        assert.ok(empty.visible.length >= 1, 'the chart is never left with nothing to draw');
    });

    await t('[frontend] a chip the reader set wins over the all-zero default, both ways', () => {
        const on = T.buildTrend(PAYLOAD, { days: 7, hidden: { accelerator: false } });
        assert.strictEqual(on.series.find(s => s.key === 'accelerator').hidden, false);
        const off = T.buildTrend(PAYLOAD, { days: 7, hidden: { conference: true } });
        assert.strictEqual(off.series.find(s => s.key === 'conference').hidden, true);
        assert.ok(!off.visible.some(s => s.key === 'conference'));
    });

    await t('[frontend] cumulative is the running sum; daily is untouched', () => {
        const d = T.buildTrend(PAYLOAD, { days: 7, mode: 'daily' });
        const c = T.buildTrend(PAYLOAD, { days: 7, mode: 'cumulative' });
        assert.deepStrictEqual(d.series.find(s => s.total).plot, [3, 2, 3, 2, 1, 3, 2]);
        assert.deepStrictEqual(c.series.find(s => s.total).plot, [3, 5, 8, 10, 11, 14, 16]);
        assert.deepStrictEqual(c.series.find(s => s.total).values, [3, 2, 3, 2, 1, 3, 2], 'values stay daily');
        assert.strictEqual(c.total, 16, 'the headline is the window total in either mode');
    });

    await t('[frontend] the scope line names what is on screen', () => {
        const all = T.buildTrend(PAYLOAD, { days: 7, hidden: Object.fromEntries(T.SOURCE_KEYS.map(k => [k, false])) });
        assert.strictEqual(all.scopeLabel, 'ALL EVENTS');
        const some = T.buildTrend(PAYLOAD, { days: 7, hidden: Object.assign(
            Object.fromEntries(T.SOURCE_KEYS.map(k => [k, true])), { conference: false, gala: false }) });
        assert.strictEqual(some.scopeLabel, 'CONFERENCE + GALA');
        const none = T.buildTrend(PAYLOAD, { days: 7, hidden: Object.fromEntries(
            T.SERIES_DEFS.map(s => [s.key, true])) });
        assert.strictEqual(none.visible.length, 0);
        assert.strictEqual(none.scopeLabel, 'NOTHING SHOWN — PICK A SERIES');
    });

    await t('[frontend] the y axis is 3-4 whole-number gridlines that clear the tallest value', () => {
        for (const max of [0, 1, 3, 7, 12, 49, 137, 2600]) {
            const { top, ticks } = T.niceTicks(max);
            assert.ok(top >= max, 'top ' + top + ' below max ' + max);
            assert.ok(ticks.length >= 3 && ticks.length <= 5, max + ' -> ' + ticks.length + ' labels');
            assert.strictEqual(ticks[0], 0);
            assert.strictEqual(ticks[ticks.length - 1], top);
            assert.ok(ticks.every(v => Number.isInteger(v)), max + ' -> non-integer label');
        }
        const m = T.buildTrend(PAYLOAD, { days: 7, mode: 'cumulative' });
        assert.ok(m.top >= 16, 'the axis has to clear the cumulative curve');
    });

    await t('[frontend] x ticks step 1/5/15 by window and always land on today', () => {
        assert.deepStrictEqual(T.tickIndexes(7, 7), [0, 1, 2, 3, 4, 5, 6]);
        assert.deepStrictEqual(T.tickIndexes(30, 30), [4, 9, 14, 19, 24, 29]);
        assert.deepStrictEqual(T.tickIndexes(90, 90), [14, 29, 44, 59, 74, 89]);
        for (const d of [7, 30, 90]) assert.strictEqual(T.tickIndexes(d, d).pop(), d - 1, 'today must be a tick');
        assert.strictEqual(T.dayTick('2026-09-01'), '1 Sep');
        assert.strictEqual(T.dayTick('2026-09-06'), '6 Sep');
        assert.strictEqual(T.dayFull('2026-09-06'), '6 Sep 2026');
    });

    await t('[frontend] ?days is whitelisted the same way the backend whitelists it', () => {
        assert.strictEqual(T.normDays(7), 7);
        assert.strictEqual(T.normDays('90'), 90);
        for (const junk of ['abc', 5000, 0, -1, null, undefined, 31]) assert.strictEqual(T.normDays(junk), 30, String(junk));
        assert.strictEqual(T.buildTrend(PAYLOAD, { days: 'abc' }).dates.length, 30);
    });

    await t('[frontend] ymd never shifts a day across a timezone', () => {
        // toISOString() would roll 23:30 local back to the previous day west of UTC; ymd must not.
        assert.strictEqual(T.ymd(new Date(2026, 8, 15, 23, 30)), '2026-09-15');
        assert.strictEqual(T.ymd(new Date(2026, 0, 1, 0, 15)), '2026-01-01');
        const m = T.buildTrend({ days: 30, to: '2026-09-15' }, { days: 30 });
        assert.strictEqual(m.dates[0], '2026-08-17');
        assert.strictEqual(m.dates[29], '2026-09-15');
        assert.strictEqual(new Set(m.dates).size, 30, 'no repeated day across a DST boundary');
    });

    // ============================================================ done
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})();
