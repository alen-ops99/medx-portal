/**
 * tests/speaker-pipeline.test.js — the SPEAKER PIPELINE (admin-portal/backend/v2/speaker-pipeline.js).
 *
 * Hermetic, in the house pattern (tests/tasks-board.test.js): a stub express app collects routes, ONE
 * in-memory libsql database (the same shared/db.js wrapper both portals use) carries the legacy tables
 * the module touches (users · audit_log · conferences · speakers · bridges_events), and the module is
 * mounted on it exactly as production does. global.fetch throws and no sendEmail is handed in — A REAL
 * EMAIL OR NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Covers: create (defaults: Idea · Plexus 2027 · priority 2 · owner = creator · a status log row) ·
 * list + every filter (status, event, year, priority, mine, archived) · search over name/institution/
 * who/why/topics/notes · the status change writing a log row and stamping last_touch_at, reaching
 * Contacted stamping contacted_at/by ONCE · the EMAILED/CALLED log lifting an idea to Contacted and
 * stamping the dates, a note touching only last_touch · promote refused before Confirmed, creating ONE
 * speakers row (name, title, institution, bio=who, email, year) and never a second · archive hiding,
 * unarchive restoring · the CSV (header + rows, quoting, filters) · the events picker · audit rows on
 * every write · the permission wiring (unmapped on the server = every signed-in admin, no `sections`
 * on the SPA routes, the PEOPLE ▾ group carries the row).
 *
 * Run:  node tests/speaker-pipeline.test.js      (exit code = number of FAILs)
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

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));

// ---------------------------------------------------------------- tiny harness
let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok    ' + name); }
    catch (e) { failed++; console.error('  FAIL  ' + name + '\n        ' + (e && e.stack || e)); }
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
            const req = { user: opts.user === undefined ? null : opts.user, params: opts.params || {}, query: opts.query || {}, body: opts.body || {}, headers: {}, ip: '10.0.0.1', path: opts.path || p, protocol: 'https', get: () => 'admin.test' };
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

// ---------------------------------------------------------------- the legacy schema (server.js DDL shapes)
const db = createDatabase(Database, { localPath: ':memory:' });
db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, first_name TEXT, last_name TEXT, is_admin INTEGER DEFAULT 0, is_staff INTEGER DEFAULT 0, is_founder INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0, allowed_sections TEXT)`);
db.run(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE conferences (id TEXT PRIMARY KEY, name TEXT NOT NULL, year INTEGER, slug TEXT UNIQUE, description TEXT, start_date TEXT, end_date TEXT, is_active INTEGER DEFAULT 1)`);
db.run(`CREATE TABLE speakers (id TEXT PRIMARY KEY, conference_id TEXT, name TEXT, title TEXT, institution TEXT, bio TEXT, photo_url TEXT, talk_title TEXT, talk_abstract TEXT, speaker_type TEXT DEFAULT 'invited', is_keynote INTEGER DEFAULT 0, is_confirmed INTEGER DEFAULT 1, linkedin_url TEXT, twitter_url TEXT, sort_order INTEGER DEFAULT 0)`);
for (const col of ['confirmation_status TEXT DEFAULT "pending"', 'notes TEXT', 'email TEXT', 'invite_code TEXT', 'is_published INTEGER DEFAULT 0', 'year INTEGER']) db.run('ALTER TABLE speakers ADD COLUMN ' + col);
db.run(`CREATE TABLE bridges_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, venue_name TEXT, event_date TEXT NOT NULL, event_time TEXT, end_time TEXT, status TEXT DEFAULT 'upcoming', slug TEXT)`);

function step(sql, params, all) { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) { out.push(st.getAsObject()); if (!all) break; } st.free(); return all ? out : (out[0] || null); }
const q = { run: (sql, p) => (p && p.length ? db.run(sql, p) : db.run(sql)), get: (sql, p) => step(sql, p, false), all: (sql, p) => step(sql, p, true) };

const U = { alen: 'u-alen', laura: 'u-laura', guest: 'u-guest' };
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin, is_founder) VALUES (?,?,?,?,1,1)`, [U.alen, 'juginovic.alen@gmail.com', 'Alen', 'Juginovic']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,1)`, [U.laura, 'laura.rodman@medx.hr', 'Laura', 'Rodman']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,0)`, [U.guest, 'guest@example.com', 'Guest', 'Member']);
q.run(`INSERT INTO conferences (id, name, year, slug, start_date, end_date) VALUES ('conf-2026', 'Plexus Conference 2026', 2026, 'plexus-2026', '2026-12-04', '2026-12-05')`);
q.run(`INSERT INTO conferences (id, name, year, slug, start_date, end_date) VALUES ('conf-2027', 'Plexus Conference 2027', 2027, 'plexus-2027', '2027-12-03', '2027-12-04')`);
q.run(`INSERT INTO bridges_events (id, name, city, event_date, status) VALUES ('bb-bos', 'Building Bridges Boston', 'Boston', '2026-09-21', 'completed')`);
q.run(`INSERT INTO bridges_events (id, name, city, event_date, status) VALUES ('bb-lon', 'Building Bridges London', 'London', '2027-03-10', 'upcoming')`);
q.run(`INSERT INTO bridges_events (id, name, city, event_date, status) VALUES ('bb-x', 'Cancelled one', 'Nowhere', '2027-01-01', 'cancelled')`);

// ---------------------------------------------------------------- mount
const app = stubApp();
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentication required' }));
const adminOnly = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admin only' }));
const mount = require(path.join(ROOT, 'admin-portal/backend/v2/speaker-pipeline.js'));
mount(app, { db: () => db, auth, adminOnly, saveDb: () => {}, JWT_SECRET: 'speakers-test-secret', ROOT, log: () => {} });
const as = { alen: { id: U.alen, email: 'juginovic.alen@gmail.com', is_admin: 1, is_founder: 1 }, laura: { id: U.laura, email: 'laura.rodman@medx.hr', is_admin: 1 } };
const call = (m, p, user, opts = {}) => app.call(m, p, Object.assign({ user }, opts));
const logOf = id => q.all(`SELECT kind, body, author_name FROM v2_speaker_prospect_log WHERE prospect_id = ? ORDER BY created_at, rowid`, [id]);
const audits = () => q.all('SELECT action, detail FROM audit_log ORDER BY rowid');

(async () => {
    console.log('speaker-pipeline.test.js — hermetic (stub express, one in-memory libsql DB, no network, no email)\n');
    let A = null, B = null, C = null;   // three prospects

    await t('every route is mounted', () => {
        for (const k of ['GET /api/v2/speaker-pipeline', 'GET /api/v2/speaker-pipeline/events', 'GET /api/v2/speaker-pipeline/export.csv', 'GET /api/v2/speaker-pipeline/:id',
            'POST /api/v2/speaker-pipeline', 'PUT /api/v2/speaker-pipeline/:id', 'GET /api/v2/speaker-pipeline/:id/log', 'POST /api/v2/speaker-pipeline/:id/log',
            'POST /api/v2/speaker-pipeline/:id/archive', 'POST /api/v2/speaker-pipeline/:id/unarchive', 'POST /api/v2/speaker-pipeline/:id/promote']) {
            assert.ok(app.routes[k], 'missing ' + k);
        }
        assert.ok(q.get("SELECT name FROM sqlite_master WHERE name = 'v2_speaker_prospects'"), 'table created');
        assert.ok(q.get("SELECT name FROM sqlite_master WHERE name = 'v2_speaker_prospect_log'"), 'log table created');
    });

    await t('no session → 401; a non-admin → 403; nothing beyond admin gates it', async () => {
        assert.strictEqual((await call('GET', '/api/v2/speaker-pipeline', null)).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/speaker-pipeline', { id: U.guest, email: 'guest@example.com', is_admin: 0 })).status, 403);
        assert.strictEqual((await call('GET', '/api/v2/speaker-pipeline', as.laura)).status, 200, 'any admin reads the pipeline');
    });

    await t('the events picker: Plexus 2027 · Gala 2027 · Building Bridges per city (cancelled skipped) · Forum · Accelerator + the conferences', async () => {
        const r = await call('GET', '/api/v2/speaker-pipeline/events', as.alen);
        assert.strictEqual(r.status, 200);
        const keys = r.body.events.map(e => e.key);
        assert.deepStrictEqual(keys.slice(0, 2), ['plexus-2027', 'gala-2027']);
        assert.ok(keys.includes('bridges-boston') && keys.includes('bridges-london'), 'bridges cities from bridges_events');
        assert.ok(!keys.includes('bridges-nowhere'), 'a cancelled event lends no city');
        assert.ok(keys.includes('forum') && keys.includes('accelerator'));
        assert.strictEqual(r.body.events.find(e => e.key === 'bridges-london').label, 'Building Bridges — London');
        assert.strictEqual(r.body.default_event, 'plexus-2027');
        assert.deepStrictEqual(r.body.conferences.map(c => c.id), ['conf-2027', 'conf-2026'], 'newest conference first');
    });

    await t('create with just a name → Idea · Plexus 2027 · 2027 · priority 2 · owner = creator · one status log row · audit', async () => {
        const r = await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: '  Prof. Matthew Walker  ' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        A = r.body.id;
        const p = r.body.prospect;
        assert.strictEqual(p.name, 'Prof. Matthew Walker');
        assert.strictEqual(p.status, 'idea');
        assert.strictEqual(p.target_event, 'plexus-2027');
        assert.strictEqual(p.target_event_label, 'Plexus 2027');
        assert.strictEqual(p.target_year, 2027);
        assert.strictEqual(p.priority, 2);
        assert.strictEqual(p.owner_id, U.alen);
        assert.strictEqual(p.owner_first, 'Alen');
        assert.strictEqual(p.contacted_at, null);
        assert.ok(p.last_touch_at, 'a fresh card has a first touch (its creation)');
        assert.deepStrictEqual(logOf(A).map(x => [x.kind, x.body]), [['status', 'Alen added Prof. Matthew Walker as Idea']]);
        assert.strictEqual(audits().filter(a => a.action === 'speaker.create').length, 1);
    });

    await t('create with the full card (Laura, met at Boston, priority 1, a free-text target event) — the free text joins the picker', async () => {
        await new Promise(r => setTimeout(r, 5));   // a distinct last_touch_at from Walker's
        const r = await call('POST', '/api/v2/speaker-pipeline', as.laura, { body: {
            name: 'Dr. Ana Horvat', title: 'Head of Cardiology', institution: 'KBC Zagreb', country: 'Croatia', email: 'Ana.Horvat@KBC.HR', linkedin_url: 'linkedin.com/in/anahorvat',
            who: 'Runs the largest cardiology unit in Croatia; trained at the Cleveland Clinic.', why: 'Bridge between the diaspora and the home system — exactly the Plexus story.',
            topics: 'cardiology, diaspora, training', target_event: 'Plexus 2028', target_year: 2028, priority: 1, met_at: 'Building Bridges Boston, Sep 2026', source: 'Met in person', next_step: 'Send the 2027 programme draft', next_step_due: '2026-10-15'
        } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        B = r.body.id;
        const p = r.body.prospect;
        assert.strictEqual(p.email, 'ana.horvat@kbc.hr', 'email lower-cased');
        assert.strictEqual(p.linkedin_url, 'https://linkedin.com/in/anahorvat', 'a bare domain gets https://');
        assert.strictEqual(p.target_event, 'Plexus 2028');
        assert.strictEqual(p.target_year, 2028);
        assert.strictEqual(p.priority, 1);
        assert.strictEqual(p.owner_first, 'Laura');
        assert.strictEqual(p.next_step_due, '2026-10-15');
        assert.match(logOf(B)[0].body, /met at Building Bridges Boston/);
        const ev = await call('GET', '/api/v2/speaker-pipeline/events', as.alen);
        assert.ok(ev.body.events.some(e => e.key === 'Plexus 2028' && e.from_use), 'the free-text event is offered next time');
        await new Promise(r => setTimeout(r, 5));   // a distinct last_touch_at for the sort assertions below
        const c = await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: 'Dr. Ivan Kos', institution: 'MGH', target_event: 'bridges-boston', priority: 3, who: 'Neurologist, sleep lab', status: 'to_contact' } });
        assert.strictEqual(c.status, 200); C = c.body.id;
        assert.strictEqual(c.body.prospect.target_event_label, 'Building Bridges — Boston');
        assert.strictEqual(c.body.prospect.status, 'to_contact');
    });

    await t('validation: no name 400 · bad email 400 · bad priority 400 · bad year 400 · bad date 400 · bad status 400 · unknown owner 400', async () => {
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: '   ' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: 'X', email: 'not-an-email' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: 'X', priority: 5 } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: 'X', target_year: 27 } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: 'X', next_step_due: '15/10/2026' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: 'X', status: 'maybe' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline', as.alen, { body: { name: 'X', owner_id: 'nobody' } })).status, 400);
        assert.strictEqual((await call('PUT', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: 'missing' }, body: { name: 'Y' } })).status, 404);
    });

    await t('list: priority first, then most recent touch; carries people (admins) + me + the picker', async () => {
        const r = await call('GET', '/api/v2/speaker-pipeline', as.alen);
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.prospects.map(p => p.id), [B, A, C], 'P1 Ana · P2 Walker · P3 Kos');
        assert.deepStrictEqual(r.body.people.map(p => p.id).sort(), [U.alen, U.laura].sort(), 'admins only, never a guest');
        assert.strictEqual(r.body.me.first, 'Alen');
        assert.ok(Array.isArray(r.body.events) && r.body.events.length >= 6);
    });

    await t('filters: status · target_event · year · priority · mine (owner or creator)', async () => {
        const ids = async query => (await call('GET', '/api/v2/speaker-pipeline', as.alen, { query })).body.prospects.map(p => p.id);
        assert.deepStrictEqual(await ids({ status: 'idea' }), [B, A], 'Ana (P1) and Walker are ideas');
        assert.deepStrictEqual(await ids({ status: 'to_contact,idea' }), [B, A, C]);
        assert.deepStrictEqual(await ids({ status: 'to_contact' }), [C]);
        assert.deepStrictEqual(await ids({ target_event: 'bridges-boston' }), [C]);
        assert.deepStrictEqual(await ids({ event: 'Plexus 2028' }), [B]);
        assert.deepStrictEqual(await ids({ year: '2028' }), [B]);
        assert.deepStrictEqual(await ids({ year: '2027' }), [A, C]);
        assert.deepStrictEqual(await ids({ priority: '1' }), [B]);
        assert.deepStrictEqual(await ids({ priority: '2,3' }), [A, C]);
        assert.deepStrictEqual(await ids({ mine: '1' }), [A, C], 'Alen owns Walker and Kos');
        assert.deepStrictEqual((await call('GET', '/api/v2/speaker-pipeline', as.laura, { query: { mine: '1' } })).body.prospects.map(p => p.id), [B]);
        assert.deepStrictEqual(await ids({ sort: 'last_touch' }), [C, B, A], 'most recent touch first');
    });

    await t('search reaches name, institution, who, why, topics and notes (multi-word AND)', async () => {
        const ids = async qs => (await call('GET', '/api/v2/speaker-pipeline', as.alen, { query: { q: qs } })).body.prospects.map(p => p.id);
        assert.deepStrictEqual(await ids('walker'), [A], 'name');
        assert.deepStrictEqual(await ids('kbc'), [B], 'institution');
        assert.deepStrictEqual(await ids('sleep lab'), [C], 'who');
        assert.deepStrictEqual(await ids('diaspora plexus'), [B], 'why, two words');
        assert.deepStrictEqual(await ids('cardiology'), [B], 'topics');
        await call('PUT', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: A }, body: { notes: 'Wrote "Why We Sleep" — keynote material.' } });
        assert.deepStrictEqual(await ids('keynote'), [A], 'notes');
        assert.deepStrictEqual(await ids('nobody-here'), []);
    });

    await t('update: fields save, an unchanged body is a no-op, no log row for a plain edit', async () => {
        const before = logOf(A).length;
        const r = await call('PUT', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: A }, body: { institution: 'UC Berkeley', who: 'Sleep scientist, author of Why We Sleep.', priority: 1, owner_id: U.laura } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.prospect.institution, 'UC Berkeley');
        assert.strictEqual(r.body.prospect.priority, 1);
        assert.strictEqual(r.body.prospect.owner_first, 'Laura');
        assert.strictEqual(logOf(A).length, before, 'a plain edit writes no log row');
        const same = await call('PUT', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: A }, body: { institution: 'UC Berkeley' } });
        assert.strictEqual(same.body.unchanged, true);
        assert.ok(audits().some(a => a.action === 'speaker.update' && /UC Berkeley|institution/.test(a.detail)));
    });

    await t('status change → a status log row + last_touch stamped; reaching Contacted stamps contacted_at/by ONCE (a later move keeps the first date)', async () => {
        const r1 = await call('PUT', '/api/v2/speaker-pipeline/:id', as.laura, { params: { id: A }, body: { status: 'to_contact' } });
        assert.strictEqual(r1.status, 200);
        assert.strictEqual(r1.body.prospect.status, 'to_contact');
        assert.strictEqual(r1.body.prospect.contacted_at, null, 'to_contact is not contact');
        assert.deepStrictEqual(logOf(A).slice(-1).map(x => [x.kind, x.body, x.author_name]), [['status', 'Laura moved Prof. Matthew Walker to To contact', 'Laura Rodman']]);
        const r2 = await call('PUT', '/api/v2/speaker-pipeline/:id', as.laura, { params: { id: A }, body: { status: 'contacted' } });
        assert.ok(r2.body.prospect.contacted_at, 'contacted_at stamped');
        assert.strictEqual(r2.body.prospect.contacted_by, 'Laura Rodman');
        assert.strictEqual(r2.body.prospect.last_touch_at, r2.body.prospect.contacted_at);
        const first = r2.body.prospect.contacted_at;
        await new Promise(r => setTimeout(r, 5));
        const r3 = await call('PUT', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: A }, body: { status: 'in_talks' } });
        assert.strictEqual(r3.body.prospect.contacted_at, first, 'the first contact date survives');
        assert.strictEqual(r3.body.prospect.contacted_by, 'Laura Rodman');
        assert.notStrictEqual(r3.body.prospect.last_touch_at, first, 'last touch moved on');
        assert.strictEqual(logOf(A).filter(x => x.kind === 'status').length, 4, 'added · to contact · contacted · in talks');
        assert.strictEqual(audits().filter(a => a.action === 'speaker.status').length, 3);
    });

    await t('EMAILED on an Idea: a log row of kind email, contacted_at/by + last_touch stamped, status lifted to Contacted (with its own status row)', async () => {
        const r = await call('POST', '/api/v2/speaker-pipeline/:id/log', as.alen, { params: { id: B }, body: { kind: 'email', body: 'Sent the save-the-date for Plexus 2027.' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.prospect.status, 'contacted');
        assert.ok(r.body.prospect.contacted_at);
        assert.strictEqual(r.body.prospect.contacted_by, 'Alen Juginovic');
        assert.deepStrictEqual(logOf(B).slice(-2).map(x => [x.kind, x.body]), [['email', 'Sent the save-the-date for Plexus 2027.'], ['status', 'Alen moved Dr. Ana Horvat to Contacted']]);
        assert.ok(r.body.log.length >= 3, 'the response carries the log');
    });

    await t('CALLED without a body writes a default line; a NOTE touches last_touch only and never changes status; a note needs text', async () => {
        const c = await call('POST', '/api/v2/speaker-pipeline/:id/log', as.laura, { params: { id: C }, body: { kind: 'call' } });
        assert.strictEqual(c.status, 200);
        assert.strictEqual(c.body.prospect.status, 'contacted', 'to_contact + a call = contacted');
        assert.strictEqual(logOf(C).find(x => x.kind === 'call').body, 'Laura called Dr. Ivan Kos');
        const beforeTouch = (await call('GET', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: A } })).body.prospect;
        await new Promise(r => setTimeout(r, 5));
        const n = await call('POST', '/api/v2/speaker-pipeline/:id/log', as.alen, { params: { id: A }, body: { kind: 'note', body: 'Prefers a morning slot.' } });
        assert.strictEqual(n.body.prospect.status, 'in_talks', 'a note never moves the card');
        assert.strictEqual(n.body.prospect.contacted_at, beforeTouch.contacted_at);
        assert.notStrictEqual(n.body.prospect.last_touch_at, beforeTouch.last_touch_at);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline/:id/log', as.alen, { params: { id: A }, body: { kind: 'note', body: '  ' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline/:id/log', as.alen, { params: { id: A }, body: { kind: 'status', body: 'x' } })).status, 400, 'status rows are the module\'s own');
        assert.strictEqual((await call('GET', '/api/v2/speaker-pipeline/:id/log', as.alen, { params: { id: A } })).body.log.length, logOf(A).length);
    });

    await t('promote: refused before Confirmed · needs a real conference · creates ONE speakers row with the card\'s fields · a second call reuses it', async () => {
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline/:id/promote', as.alen, { params: { id: A }, body: { conference_id: 'conf-2027' } })).status, 400, 'in_talks is not confirmed');
        await call('PUT', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: A }, body: { status: 'confirmed', email: 'mwalker@berkeley.edu', title: 'Professor of Neuroscience' } });
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline/:id/promote', as.alen, { params: { id: A }, body: {} })).status, 400, 'no conference');
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline/:id/promote', as.alen, { params: { id: A }, body: { conference_id: 'conf-nope' } })).status, 400, 'unknown conference');
        const before = q.get('SELECT COUNT(*) AS c FROM speakers').c;
        const r = await call('POST', '/api/v2/speaker-pipeline/:id/promote', as.alen, { params: { id: A }, body: { conference_id: 'conf-2027' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.ok(r.body.speaker_id);
        assert.strictEqual(r.body.reused, false);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM speakers').c, before + 1);
        const s = q.get('SELECT * FROM speakers WHERE id = ?', [r.body.speaker_id]);
        assert.strictEqual(s.conference_id, 'conf-2027');
        assert.strictEqual(s.name, 'Prof. Matthew Walker');
        assert.strictEqual(s.title, 'Professor of Neuroscience');
        assert.strictEqual(s.institution, 'UC Berkeley');
        assert.strictEqual(s.bio, 'Sleep scientist, author of Why We Sleep.', 'bio = who');
        assert.strictEqual(s.email, 'mwalker@berkeley.edu');
        assert.strictEqual(Number(s.year), 2027);
        assert.strictEqual(s.confirmation_status, 'confirmed');
        assert.strictEqual(r.body.prospect.promoted_speaker_id, r.body.speaker_id);
        assert.ok(r.body.prospect.promoted_at);
        const again = await call('POST', '/api/v2/speaker-pipeline/:id/promote', as.laura, { params: { id: A }, body: { conference_id: 'conf-2027' } });
        assert.strictEqual(again.status, 200);
        assert.strictEqual(again.body.already, true);
        assert.strictEqual(again.body.speaker_id, r.body.speaker_id);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM speakers').c, before + 1, 'never a second row');
        assert.strictEqual(audits().filter(a => a.action === 'speaker.promote').length, 1);
        assert.match(logOf(A).slice(-1)[0].body, /promoted Prof\. Matthew Walker to the speakers of Plexus Conference 2027/);
    });

    await t('promote reuses an identical name already on that conference instead of duplicating it', async () => {
        q.run(`INSERT INTO speakers (id, conference_id, name) VALUES ('sp-existing', 'conf-2026', 'Dr. Ana Horvat')`);
        await call('PUT', '/api/v2/speaker-pipeline/:id', as.alen, { params: { id: B }, body: { status: 'confirmed' } });
        const before = q.get('SELECT COUNT(*) AS c FROM speakers').c;
        const r = await call('POST', '/api/v2/speaker-pipeline/:id/promote', as.alen, { params: { id: B }, body: { conference_id: 'conf-2026' } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.reused, true);
        assert.strictEqual(r.body.speaker_id, 'sp-existing');
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM speakers').c, before);
    });

    await t('archive hides the card from the list (archived=1 shows it); unarchive brings it back; both log + audit', async () => {
        const r = await call('POST', '/api/v2/speaker-pipeline/:id/archive', as.alen, { params: { id: C } });
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.prospect.archived_at);
        const live = (await call('GET', '/api/v2/speaker-pipeline', as.alen)).body.prospects.map(p => p.id);
        assert.ok(!live.includes(C), 'hidden');
        const arch = (await call('GET', '/api/v2/speaker-pipeline', as.alen, { query: { archived: '1' } })).body.prospects.map(p => p.id);
        assert.deepStrictEqual(arch, [C]);
        assert.strictEqual((await call('POST', '/api/v2/speaker-pipeline/:id/archive', as.alen, { params: { id: C } })).body.unchanged, true);
        const u = await call('POST', '/api/v2/speaker-pipeline/:id/unarchive', as.alen, { params: { id: C } });
        assert.strictEqual(u.body.prospect.archived_at, null);
        assert.ok((await call('GET', '/api/v2/speaker-pipeline', as.alen)).body.prospects.map(p => p.id).includes(C));
        assert.deepStrictEqual(logOf(C).slice(-2).map(x => x.body), ['Alen archived Dr. Ivan Kos', 'Alen brought Dr. Ivan Kos back']);
        assert.ok(audits().some(a => a.action === 'speaker.archive') && audits().some(a => a.action === 'speaker.unarchive'));
    });

    await t('CSV export: a header + one row per prospect, quoted fields, event labels, the list filters respected', async () => {
        const r = await call('GET', '/api/v2/speaker-pipeline/export.csv', as.alen);
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'], /text\/csv/);
        assert.match(r.headers['content-disposition'], /attachment; filename="speaker-pipeline-\d{4}-\d{2}-\d{2}\.csv"/);
        const text = String(r.body).replace(/^\ufeff/, '');
        const lines = text.trim().split('\r\n');
        assert.strictEqual(lines[0], 'name,title,institution,country,email,linkedin_url,who,why,topics,target_event,target_year,priority,status,contacted_at,contacted_by,last_touch_at,next_step,next_step_due,met_at,source,owner_name,notes,created_at,updated_at,archived_at');
        assert.strictEqual(lines.length, 4, 'header + 3 live prospects');
        assert.ok(lines.some(l => l.startsWith('Prof. Matthew Walker,Professor of Neuroscience,UC Berkeley,')));
        assert.ok(lines.some(l => /"Wrote ""Why We Sleep"" — keynote material\."/.test(l)), 'quotes doubled, field quoted');
        assert.ok(lines.some(l => /Building Bridges — Boston/.test(l)), 'the event label, not the key');
        const one = await call('GET', '/api/v2/speaker-pipeline/export.csv', as.alen, { query: { priority: '1', year: '2028' } });
        assert.strictEqual(String(one.body).replace(/^\ufeff/, '').trim().split('\r\n').length, 2, 'header + Ana');
        assert.ok(audits().some(a => a.action === 'speaker.export'));
    });

    await t('detail carries the prospect + its log; an unknown id is 404', async () => {
        const r = await call('GET', '/api/v2/speaker-pipeline/:id', as.laura, { params: { id: B } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.prospect.name, 'Dr. Ana Horvat');
        assert.ok(r.body.log.length >= 3);
        assert.strictEqual((await call('GET', '/api/v2/speaker-pipeline/:id', as.laura, { params: { id: 'nope' } })).status, 404);
    });

    await t('every write left an audit row; nothing here can email (no sendEmail in ctx, no mail code path)', () => {
        const actions = audits().map(a => a.action);
        for (const a of ['speaker.create', 'speaker.update', 'speaker.status', 'speaker.log', 'speaker.archive', 'speaker.unarchive', 'speaker.promote', 'speaker.export']) assert.ok(actions.includes(a), 'missing audit ' + a);
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/v2/speaker-pipeline.js'), 'utf8');
        assert.ok(!/sendEmail|emailHtml|nodemailer|brevo/i.test(src), 'speaker-pipeline.js has no email path');
    });

    await t('permissions: /api/v2/speaker-pipeline is NOT section-gated, the SPA routes carry no `sections`, PEOPLE ▾ lists the pipeline', () => {
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');
        const m = /const SECTION_ROUTE_MAP = \[([\s\S]*?)\n\];/.exec(src);
        assert.ok(m, 'SECTION_ROUTE_MAP found');
        const map = new Function('return [' + m[1] + '\n];')();
        const sectionFor = p => { for (const [prefix, section] of map) if (p === prefix || p.startsWith(prefix + '/')) return section; return null; };
        assert.strictEqual(sectionFor('/api/v2/speaker-pipeline'), null);
        assert.strictEqual(sectionFor('/api/v2/speaker-pipeline/export.csv'), null);
        const routes = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/routes.js'), 'utf8').split('\n');
        const main = routes.find(l => /path: '\/people\/speakers\/:id\?'/.test(l)); const alias = routes.find(l => /path: '\/speakers\/:id\?'/.test(l));
        assert.ok(main && alias, 'both routes exist');
        assert.ok(!/sections:/.test(main) && !/sections:/.test(alias), 'no sections gate');
        assert.ok(routes.indexOf(main) < routes.findIndex(l => /path: '\/people\/:tab\?'/.test(l)), '/people/speakers is matched before /people/:tab');
        const nav = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/chrome.js'), 'utf8');
        const row = nav.split('\n').find(l => /to: '\/people\/speakers'/.test(l));
        assert.ok(row && !/sections:/.test(row), 'the PEOPLE ▾ row is for everyone');
        assert.ok(/People: \[/.test(nav), 'the PEOPLE group exists in MENUS');
        assert.ok(/href: '\/people\/speakers'/.test(nav), 'the ⌘K palette reaches it');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})().catch(e => { console.error(e); process.exit(1); });
