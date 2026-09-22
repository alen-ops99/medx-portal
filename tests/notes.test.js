/**
 * tests/notes.test.js — shared NOTES (admin-portal/backend/v2/notes.js).
 *
 * Hermetic, in the house pattern (tests/tasks-board.test.js): a stub express app collects routes,
 * ONE in-memory libsql database carries the legacy tables the module reads (users · audit_log ·
 * bridges_events · conferences · gala_settings), and the module is mounted exactly as production
 * does. No sendEmail is passed (notes never email), global.fetch throws, no S3 is configured
 * (files land in a temp dir) — A REAL EMAIL OR NETWORK CALL IS IMPOSSIBLE HERE.
 *
 * Covers: day + event notes · the event picker (today's event first, upcoming next, recent after,
 * free-text labels kept) · list filters (scope, event, date range, pinned, person) · search over
 * body, title, event label and people · pin/unpin · archive hides / unarchive shows · people
 * add/remove · files (metadata, signed link, inline gate, delete) · export page + signed link ·
 * the Today summary · hard delete · audit rows · the permission wiring (unmapped = every admin).
 *
 * Run:  node tests/notes.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('BB_S3_')) delete process.env[k];

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));

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
            const req = { user: opts.user === undefined ? null : opts.user, params: opts.params || {}, query: opts.query || {}, body: opts.body || {}, headers: opts.headers || {}, ip: '10.0.0.1', path: opts.path || p, file: opts.file || undefined, protocol: 'https', get: () => 'admin.test' };
            const r = { status: 200, body: undefined, headers: {} };
            let ended = false;
            const res = {
                status(c) { r.status = c; return res; },
                json(o) { r.body = o; ended = true; return res; },
                send(x) { r.body = x; ended = true; return res; },
                sendFile(f) { r.body = '[sendFile] ' + f; r.file = f; ended = true; },
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

// ---------------------------------------------------------------- the legacy tables the module reads
const db = createDatabase(Database, { localPath: ':memory:' });
db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, first_name TEXT, last_name TEXT, is_admin INTEGER DEFAULT 0, is_staff INTEGER DEFAULT 0, is_founder INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0, allowed_sections TEXT)`);
db.run(`CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE bridges_events (id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, venue_name TEXT, event_date TEXT NOT NULL, event_time TEXT, end_time TEXT, status TEXT DEFAULT 'upcoming', slug TEXT)`);
db.run(`CREATE TABLE conferences (id TEXT PRIMARY KEY, name TEXT NOT NULL, year INTEGER, slug TEXT UNIQUE, start_date TEXT, end_date TEXT, is_active INTEGER DEFAULT 1)`);
db.run(`CREATE TABLE gala_settings (id TEXT PRIMARY KEY DEFAULT 'default', title TEXT DEFAULT 'Gala Evening 2026', date TEXT DEFAULT '2026-12-05')`);

function step(sql, params, all) { const st = db.prepare(sql); st.bind(params || []); const out = []; while (st.step()) { out.push(st.getAsObject()); if (!all) break; } st.free(); return all ? out : (out[0] || null); }
const q = { run: (sql, p) => (p && p.length ? db.run(sql, p) : db.run(sql)), get: (sql, p) => step(sql, p, false), all: (sql, p) => step(sql, p, true) };

const U = { alen: 'u-alen', laura: 'u-laura', guest: 'u-guest' };
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin, is_founder) VALUES (?,?,?,?,1,1)`, [U.alen, 'juginovic.alen@gmail.com', 'Alen', 'Juginovic']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,1)`, [U.laura, 'laura.rodman@medx.hr', 'Laura', 'Rodman']);
q.run(`INSERT INTO users (id, email, first_name, last_name, is_admin) VALUES (?,?,?,?,0)`, [U.guest, 'guest@example.com', 'Guest', 'Member']);
// TODAY for the whole run is Boston's evening; the phone hands the date to the API
const TODAY = '2026-09-21';
q.run(`INSERT INTO bridges_events (id, name, city, event_date, event_time, status, slug) VALUES ('bb-bos', 'Building Bridges in Biomedicine — Boston', 'Boston', '2026-09-21', '18:00', 'upcoming', 'boston')`);
q.run(`INSERT INTO bridges_events (id, name, city, event_date, event_time, status, slug) VALUES ('bb-zg', 'Building Bridges in Biomedicine Croatia', 'Zagreb', '', '09:00', 'upcoming', 'building-bridges')`);
q.run(`INSERT INTO bridges_events (id, name, city, event_date, event_time, status, slug) VALUES ('donor', 'Plexus Donor Night', 'Zagreb', '2026-12-04', '19:30', 'upcoming', 'donor-night')`);
q.run(`INSERT INTO bridges_events (id, name, city, event_date, status, slug) VALUES ('bb-old', 'Building Bridges', 'Zürich', '2026-05-12', 'completed', 'zurich')`);
q.run(`INSERT INTO bridges_events (id, name, city, event_date, status, slug) VALUES ('bb-x', 'Building Bridges', 'Nowhere', '2026-10-01', 'cancelled', 'x')`);
q.run(`INSERT INTO conferences (id, name, year, slug, start_date, end_date, is_active) VALUES ('conf-26', 'Plexus Week 2026', 2026, 'plexus-2026', '2026-12-04', '2026-12-05', 1)`);
q.run(`INSERT INTO conferences (id, name, year, slug, start_date, end_date, is_active) VALUES ('conf-25', 'Plexus 2025', 2025, 'plexus-2025', '2025-12-05', '2025-12-06', 0)`);
q.run(`INSERT INTO gala_settings (id, title, date) VALUES ('default', 'Gala Evening 2026', '2026-12-05')`);

// ---------------------------------------------------------------- mount
const app = stubApp();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-notes-'));
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentication required' }));
const adminOnly = (req, res, next) => (req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admin only' }));
const mountNotes = require(path.join(ROOT, 'admin-portal/backend/v2/notes.js'));
mountNotes(app, { db: () => db, auth, adminOnly, saveDb: () => {}, JWT_SECRET: 'notes-test-secret', ROOT: tmpRoot, log: () => {} });
const as = { alen: { id: U.alen, email: 'juginovic.alen@gmail.com', is_admin: 1, is_founder: 1 }, laura: { id: U.laura, email: 'laura.rodman@medx.hr', is_admin: 1 } };
const call = (m, p, user, opts = {}) => { opts.query = Object.assign({ today: TODAY }, opts.query || {}); return app.call(m, p, Object.assign({ user }, opts)); };
const list = async (user, query) => (await call('GET', '/api/v2/notes', user, { query })).body.notes;

(async () => {
    console.log('notes.test.js — hermetic (stub express, one in-memory libsql DB, no email path at all, temp uploads)\n');
    let dayId = null, evId = null, fileId = null, personId = null;

    await t('every route is mounted', () => {
        for (const k of ['GET /api/v2/notes', 'GET /api/v2/notes/events', 'GET /api/v2/notes/people', 'GET /api/v2/notes/summary', 'GET /api/v2/notes/export', 'GET /api/v2/notes/export-link',
            'GET /api/v2/notes/:id', 'POST /api/v2/notes', 'PUT /api/v2/notes/:id', 'POST /api/v2/notes/:id/pin', 'POST /api/v2/notes/:id/unpin',
            'POST /api/v2/notes/:id/archive', 'POST /api/v2/notes/:id/unarchive', 'DELETE /api/v2/notes/:id',
            'GET /api/v2/notes/:id/files', 'POST /api/v2/notes/:id/files', 'GET /api/v2/notes/files/:fid', 'DELETE /api/v2/notes/files/:fid',
            'POST /api/v2/notes/:id/people', 'DELETE /api/v2/notes/:id/people/:pid']) assert.ok(app.routes[k], 'missing ' + k);
        for (const tbl of ['v2_notes', 'v2_note_files', 'v2_note_people']) assert.ok(q.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tbl]), tbl + ' created');
    });

    await t('no session → 401; a non-admin → 403; any admin is in (no section gate)', async () => {
        assert.strictEqual((await call('GET', '/api/v2/notes', null)).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/notes', { id: U.guest, email: 'guest@example.com', is_admin: 0 })).status, 403);
        assert.strictEqual((await call('GET', '/api/v2/notes', as.laura)).status, 200);
    });

    await t('the event picker: today\'s Boston first (label "Building Bridges — Boston · 21 Sep"), upcoming next (soonest first), recent after, cancelled never', async () => {
        const r = await call('GET', '/api/v2/notes/events', as.laura);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.today, TODAY);
        const ev = r.body.events;
        assert.strictEqual(ev[0].key, 'bridges:bb-bos');
        assert.strictEqual(ev[0].label, 'Building Bridges — Boston · 21 Sep');
        assert.strictEqual(ev[0].today, true);
        assert.match(ev[0].export_url, /^\/api\/v2\/notes\/export\?event=bridges%3Abb-bos&exp=\d+&sig=[0-9a-f]{32}$/);
        const keys = ev.map(e => e.key);
        assert.ok(!keys.includes('bridges:bb-x'), 'cancelled rows are not events');
        assert.ok(!keys.includes('conference:conf-25'), 'an inactive conference is not offered');
        // upcoming block, soonest first: Donor Night (4 Dec) and Plexus Week (4–5 Dec) before the Gala (5 Dec)
        const up = ev.filter(e => e.upcoming).map(e => e.key);
        assert.deepStrictEqual(up.slice(0, 3).sort(), ['bridges:donor', 'conference:conf-26', 'gala:default'].sort());
        assert.strictEqual(up[up.length - 1], 'gala:default');
        assert.ok(ev.find(e => e.key === 'conference:conf-26').label.startsWith('Plexus Week 2026 · 4–5 Dec'));
        assert.strictEqual(ev.find(e => e.key === 'gala:default').label, 'Gala Evening 2026 · 5 Dec');
        assert.strictEqual(ev.find(e => e.key === 'bridges:donor').label, 'Plexus Donor Night — Zagreb · 4 Dec');
        // the past and the undated come last
        assert.ok(keys.indexOf('bridges:bb-old') > keys.indexOf('gala:default'));
        assert.strictEqual(ev.find(e => e.key === 'bridges:bb-zg').date, null);
        assert.ok(ev.every(e => e.count === 0));
    });

    await t('a DAY note: body only, date defaults to today, scope day, author stamped, audit row', async () => {
        const r = await call('POST', '/api/v2/notes', as.laura, { body: { body: '  Alen called: ask the Esplanade for the tasting menu by Friday.  ' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        dayId = r.body.id;
        const n = r.body.note;
        assert.strictEqual(n.scope, 'day');
        assert.strictEqual(n.event_key, null);
        assert.strictEqual(n.note_date, TODAY);
        assert.strictEqual(n.body, 'Alen called: ask the Esplanade for the tasting menu by Friday.');
        assert.strictEqual(n.author_first, 'Laura');
        assert.strictEqual(n.pinned, false);
        assert.deepStrictEqual(n.people, []);
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'note.create' AND actor_id = ?", [U.laura]));
    });

    await t('an EVENT note with people: event_key → label from the picker, people cleaned + de-duplicated, scope event', async () => {
        const r = await call('POST', '/api/v2/notes', as.laura, { body: {
            event_key: 'bridges:bb-bos', title: 'Met Prof. Rogulja\'s neighbour',
            body: 'Prof. Ana Kovač (MGH, sleep lab) wants to host a Plexus satellite in Boston next spring. Agreed: Alen sends the one-pager, she introduces us to the dean.\nFollow-up: Laura books a call for the first week of October.',
            people: [{ name: 'Prof. Ana Kovač', institution: 'MGH', email: 'AKOVAC@MGH.HARVARD.EDU' }, 'Prof. Ana Kovač', { name: 'Dean Marko Horvat', institution: 'Harvard Medical School' }, { name: '  ' }]
        } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        evId = r.body.id;
        const n = r.body.note;
        assert.strictEqual(n.scope, 'event');
        assert.strictEqual(n.event_key, 'bridges:bb-bos');
        assert.strictEqual(n.event_label, 'Building Bridges — Boston · 21 Sep');
        assert.strictEqual(n.title, 'Met Prof. Rogulja\'s neighbour');
        assert.strictEqual(n.people.length, 2);
        assert.strictEqual(n.people[0].name, 'Prof. Ana Kovač');
        assert.strictEqual(n.people[0].email, 'akovac@mgh.harvard.edu');
        assert.strictEqual(n.people[0].institution, 'MGH');
        assert.strictEqual(n.first_line, 'Met Prof. Rogulja\'s neighbour');
        assert.strictEqual((await call('GET', '/api/v2/notes/events', as.alen)).body.events[0].count, 1, 'the picker counts it');
    });

    await t('a FREE-TEXT event ("Coffee with Dean X") becomes custom:<slug> and joins the picker; the same label reuses the key', async () => {
        const a = await call('POST', '/api/v2/notes', as.alen, { body: { event_label: 'Coffee with Dean Horvat', body: 'He is in for the Accelerator jury. Send dates.', note_date: '2026-09-20' } });
        assert.strictEqual(a.status, 200, JSON.stringify(a.body));
        assert.strictEqual(a.body.note.event_key, 'custom:coffee-with-dean-horvat');
        assert.strictEqual(a.body.note.event_label, 'Coffee with Dean Horvat');
        assert.strictEqual(a.body.note.note_date, '2026-09-20');
        const b = await call('POST', '/api/v2/notes', as.laura, { body: { event_label: 'coffee with dean horvat', body: 'Second coffee — he brought the dean of medicine.' } });
        assert.strictEqual(b.body.note.event_key, 'custom:coffee-with-dean-horvat');
        assert.strictEqual(b.body.note.event_label, 'Coffee with Dean Horvat', 'the first spelling wins');
        const ev = (await call('GET', '/api/v2/notes/events', as.alen)).body.events.find(e => e.key === 'custom:coffee-with-dean-horvat');
        assert.ok(ev, 'a used label is an event in the picker');
        assert.strictEqual(ev.count, 2);
        assert.strictEqual(ev.date, '2026-09-20');
        assert.strictEqual(ev.today, true, 'its date span reaches today (a note dated today)');
    });

    await t('validation: empty body 400 · bad date 400 · bad scope 400 · malformed event key 400 · unknown id 404', async () => {
        assert.strictEqual((await call('POST', '/api/v2/notes', as.alen, { body: { body: '   ' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/notes', as.alen, { body: { body: 'x', note_date: '21/09/2026' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/notes', as.alen, { body: { body: 'x', scope: 'diary' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/notes', as.alen, { body: { body: 'x', event_key: 'boston' } })).status, 400);
        assert.strictEqual((await call('GET', '/api/v2/notes/:id', as.alen, { params: { id: 'nope' } })).status, 404);
        assert.strictEqual((await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: 'nope' }, body: { body: 'x' } })).status, 404);
    });

    await t('the stream: newest day first, then newest note first; filters scope=day, event=, from/to', async () => {
        const all = await list(as.alen);
        assert.strictEqual(all.length, 4);
        assert.ok(all.slice(0, 3).every(n => n.note_date === TODAY) && all[3].note_date === '2026-09-20');
        assert.ok(new Date(all[0].created_at) >= new Date(all[1].created_at), 'newest first within the day');
        const day = await list(as.alen, { scope: 'day' });
        assert.deepStrictEqual(day.map(n => n.id), [dayId]);
        const bos = await list(as.alen, { event: 'bridges:bb-bos' });
        assert.deepStrictEqual(bos.map(n => n.id), [evId]);
        const range = await list(as.alen, { from: '2026-09-20', to: '2026-09-20' });
        assert.strictEqual(range.length, 1); assert.strictEqual(range[0].event_key, 'custom:coffee-with-dean-horvat');
        const asc = await list(as.alen, { order: 'asc' });
        assert.strictEqual(asc[0].note_date, '2026-09-20');
    });

    await t('search reaches the body, the title, the event label, a person and an institution — and misses cleanly', async () => {
        const hit = async term => (await list(as.alen, { q: term })).map(n => n.id);
        assert.deepStrictEqual(await hit('tasting menu'), [dayId], 'body');
        assert.deepStrictEqual(await hit('neighbour'), [evId], 'title');
        assert.ok((await hit('boston')).includes(evId), 'event label');
        assert.deepStrictEqual(await hit('kovač'), [evId], 'person');
        assert.deepStrictEqual(await hit('MGH'), [evId], 'institution');
        assert.strictEqual((await hit('dean horvat')).length, 3, 'two tokens: the coffee label twice + the person on the Boston note');
        assert.deepStrictEqual(await hit('zzz-nothing'), []);
    });

    await t('by person: person= filter (case-insensitive) and the /people index with counts', async () => {
        const byP = await list(as.alen, { person: 'prof. ana kovač' });
        assert.deepStrictEqual(byP.map(n => n.id), [evId]);
        const idx = (await call('GET', '/api/v2/notes/people', as.alen)).body.people;
        assert.strictEqual(idx.length, 2);
        const ana = idx.find(p => p.name === 'Prof. Ana Kovač');
        assert.strictEqual(ana.count, 1); assert.strictEqual(ana.institution, 'MGH'); assert.strictEqual(ana.last_date, TODAY);
    });

    await t('people add / remove on an existing note (duplicates ignored, empty 400, unknown 404)', async () => {
        const a = await call('POST', '/api/v2/notes/:id/people', as.laura, { params: { id: dayId }, body: { name: 'Ivana Perić', institution: 'Esplanade' } });
        assert.strictEqual(a.status, 200, JSON.stringify(a.body));
        assert.strictEqual(a.body.people.length, 1); personId = a.body.people[0].id;
        const dup = await call('POST', '/api/v2/notes/:id/people', as.laura, { params: { id: dayId }, body: { name: 'ivana perić' } });
        assert.strictEqual(dup.body.people.length, 1, 'same name once');
        assert.strictEqual((await call('POST', '/api/v2/notes/:id/people', as.laura, { params: { id: dayId }, body: { name: '  ' } })).status, 400);
        assert.strictEqual((await call('POST', '/api/v2/notes/:id/people', as.laura, { params: { id: 'nope' }, body: { name: 'x' } })).status, 404);
        assert.ok((await list(as.alen, { person: 'Ivana Perić' })).some(n => n.id === dayId));
        const d = await call('DELETE', '/api/v2/notes/:id/people/:pid', as.alen, { params: { id: dayId, pid: personId } });
        assert.strictEqual(d.status, 200); assert.deepStrictEqual(d.body.people, []);
        assert.strictEqual((await call('DELETE', '/api/v2/notes/:id/people/:pid', as.alen, { params: { id: dayId, pid: personId } })).status, 404);
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'note.person.add'") && q.get("SELECT id FROM audit_log WHERE action = 'note.person.remove'"));
    });

    await t('edit: body / title / date / event move; unchanged → no write; detaching → a day note again', async () => {
        const r = await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { body: 'Alen called: ask the Esplanade for the tasting menu by Friday. DONE — menu arrived.', title: 'Esplanade tasting' } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.note.title, 'Esplanade tasting');
        assert.match(r.body.note.body, /DONE/);
        assert.strictEqual((await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { title: 'Esplanade tasting' } })).body.unchanged, true);
        // move it onto the Boston event, then back off
        const mv = await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { event_key: 'bridges:bb-bos' } });
        assert.strictEqual(mv.body.note.scope, 'event'); assert.strictEqual(mv.body.note.event_label, 'Building Bridges — Boston · 21 Sep');
        const off = await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { event_key: '' } });
        assert.strictEqual(off.body.note.scope, 'day'); assert.strictEqual(off.body.note.event_key, null); assert.strictEqual(off.body.note.event_label, null);
        const dated = await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { note_date: '2026-09-19' } });
        assert.strictEqual(dated.body.note.note_date, '2026-09-19');
        assert.strictEqual((await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { body: '', title: '' } })).status, 400, 'a note cannot be emptied — archive it');
        assert.strictEqual((await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { note_date: 'soon' } })).status, 400);
        await call('PUT', '/api/v2/notes/:id', as.alen, { params: { id: dayId }, body: { note_date: TODAY } });
    });

    await t('pin / unpin: pinned=1 filter, idempotent, audited', async () => {
        const p = await call('POST', '/api/v2/notes/:id/pin', as.alen, { params: { id: evId } });
        assert.strictEqual(p.status, 200); assert.strictEqual(p.body.note.pinned, true);
        assert.strictEqual((await call('POST', '/api/v2/notes/:id/pin', as.alen, { params: { id: evId } })).body.unchanged, true);
        assert.deepStrictEqual((await list(as.alen, { pinned: '1' })).map(n => n.id), [evId]);
        const u = await call('POST', '/api/v2/notes/:id/unpin', as.laura, { params: { id: evId } });
        assert.strictEqual(u.body.note.pinned, false);
        assert.deepStrictEqual(await list(as.alen, { pinned: '1' }), []);
        await call('POST', '/api/v2/notes/:id/pin', as.alen, { params: { id: evId } });
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'note.pin'") && q.get("SELECT id FROM audit_log WHERE action = 'note.unpin'"));
    });

    await t('files: upload (no S3 → the shared uploads root), signed link, inline gate for images, forged/expired → 401, delete', async () => {
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
        const up = await call('POST', '/api/v2/notes/:id/files', as.laura, { params: { id: evId }, file: { originalname: 'Ana Kovač — business card.png', mimetype: 'image/png', buffer: png, size: png.length } });
        assert.strictEqual(up.status, 200, JSON.stringify(up.body));
        fileId = up.body.file.id;
        assert.strictEqual(up.body.file.name, 'Ana Kovač — business card.png');
        assert.strictEqual(up.body.file.size, png.length);
        assert.strictEqual(up.body.file.mime, 'image/png');
        assert.strictEqual(up.body.file.is_image, true);
        assert.match(up.body.file.url, /^\/api\/v2\/notes\/files\/[^?]+\?exp=\d+&sig=[0-9a-f]{32}$/);
        assert.strictEqual(up.body.file.view_url, up.body.file.url + '&inline=1');
        const row = q.get('SELECT * FROM v2_note_files WHERE id = ?', [fileId]);
        assert.ok(row.stored_key.startsWith(path.join(tmpRoot, 'user-portal', 'backend', 'uploads', 'notes')), 'stored under the shared uploads root: ' + row.stored_key);
        assert.ok(fs.existsSync(row.stored_key));
        // the note carries its files in the list
        const inList = (await list(as.alen)).find(n => n.id === evId);
        assert.strictEqual(inList.files.length, 1); assert.strictEqual(inList.files[0].id, fileId);
        // the signed link opens the file with NO session; inline=1 serves the real image type for a thumbnail
        const u = new URL('https://x' + up.body.file.url);
        const dl = await call('GET', '/api/v2/notes/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(dl.status, 200, JSON.stringify(dl.body)); assert.strictEqual(dl.file, row.stored_key);
        assert.match(String(dl.headers['content-disposition']), /^attachment/); assert.strictEqual(dl.headers['content-type'], 'application/octet-stream');
        const inl = await call('GET', '/api/v2/notes/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), inline: '1' } });
        assert.strictEqual(inl.status, 200); assert.strictEqual(inl.headers['content-type'], 'image/png'); assert.match(String(inl.headers['content-disposition']), /^inline/);
        assert.strictEqual((await call('GET', '/api/v2/notes/files/:fid', null, { params: { fid: fileId }, query: { exp: u.searchParams.get('exp'), sig: 'f'.repeat(32) } })).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/notes/files/:fid', null, { params: { fid: fileId }, query: { exp: '1000', sig: u.searchParams.get('sig') } })).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/notes/files/:fid', as.alen, { params: { fid: fileId }, query: { json: '1' } })).body.name, 'Ana Kovač — business card.png');
        // a non-image is never served inline, whatever the query says
        const pdf = Buffer.from('%PDF-1.7\nagenda\n%%EOF');
        const up2 = await call('POST', '/api/v2/notes/:id/files', as.laura, { params: { id: evId }, file: { originalname: 'agenda.pdf', mimetype: 'application/pdf', buffer: pdf, size: pdf.length } });
        const u2 = new URL('https://x' + up2.body.file.url);
        const inl2 = await call('GET', '/api/v2/notes/files/:fid', null, { params: { fid: up2.body.file.id }, query: { exp: u2.searchParams.get('exp'), sig: u2.searchParams.get('sig'), inline: '1' } });
        assert.strictEqual(inl2.headers['content-type'], 'application/octet-stream'); assert.match(String(inl2.headers['content-disposition']), /^attachment/);
        assert.ok((await list(as.alen, { q: 'agenda' })).some(n => n.id === evId), 'file names are searchable');
        assert.strictEqual((await call('POST', '/api/v2/notes/:id/files', as.laura, { params: { id: evId }, file: { originalname: 'e.txt', buffer: Buffer.alloc(0), size: 0 } })).status, 400);
        const del = await call('DELETE', '/api/v2/notes/files/:fid', as.alen, { params: { fid: up2.body.file.id } });
        assert.strictEqual(del.status, 200); assert.strictEqual(del.body.files.length, 1);
        assert.ok(!fs.existsSync(q.get('SELECT stored_key FROM v2_note_files WHERE id = ?', [fileId]) ? path.join(tmpRoot, 'nothing') : ''), 'sanity');
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM v2_note_files WHERE id = ?', [up2.body.file.id]).c, 0);
    });

    await t('the Today summary: today\'s count, the last note\'s first line, the event of the day and its count', async () => {
        const s = (await call('GET', '/api/v2/notes/summary', as.alen)).body;
        assert.strictEqual(s.today, TODAY);
        assert.strictEqual(s.count, 3);
        assert.ok(s.last && s.last.first_line, 'last note present');
        assert.strictEqual(s.event.key, 'bridges:bb-bos');
        assert.strictEqual(s.event.label, 'Building Bridges — Boston · 21 Sep');
        assert.strictEqual(s.event_count, 1);
        const quiet = (await call('GET', '/api/v2/notes/summary', as.alen, { query: { today: '2026-09-25' } })).body;
        assert.strictEqual(quiet.count, 0); assert.strictEqual(quiet.event, null);
    });

    await t('export: one event as one printable page (people roll-up, notes in order, files linked) — Bearer or the signed link; a day page too', async () => {
        const link = (await call('GET', '/api/v2/notes/export-link', as.alen, { query: { event: 'bridges:bb-bos' } })).body.url;
        assert.match(link, /^\/api\/v2\/notes\/export\?event=bridges%3Abb-bos&exp=\d+&sig=[0-9a-f]{32}$/);
        const u = new URL('https://x' + link);
        const page = await call('GET', '/api/v2/notes/export', null, { query: { event: 'bridges:bb-bos', exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') } });
        assert.strictEqual(page.status, 200, JSON.stringify(page.body));
        assert.match(String(page.headers['content-type']), /text\/html/);
        const html = String(page.body);
        assert.match(html, /<h1>Building Bridges — Boston · 21 Sep<\/h1>/);
        assert.match(html, /People met · 2/);
        assert.match(html, /Prof\. Ana Kovač/); assert.match(html, /Dean Marko Horvat/);
        assert.match(html, /Plexus satellite in Boston/);
        assert.match(html, /business card\.png/);
        assert.match(html, /PINNED/);
        assert.ok(!/Esplanade tasting/.test(html), 'a day note stays out of the event page');
        assert.strictEqual((await call('GET', '/api/v2/notes/export', null, { query: { event: 'bridges:bb-bos', exp: u.searchParams.get('exp'), sig: 'a'.repeat(32) } })).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/notes/export', as.laura, { query: { event: 'bridges:bb-bos' } })).status, 200, 'a Bearer session is always enough');
        assert.strictEqual((await call('GET', '/api/v2/notes/export', as.laura, { query: {} })).status, 400);
        const day = await call('GET', '/api/v2/notes/export', as.laura, { query: { date: TODAY } });
        assert.strictEqual(day.status, 200);
        assert.match(String(day.body), /Esplanade tasting/); assert.match(String(day.body), /Coffee with Dean Horvat/, 'a day page names each note\'s event');
    });

    await t('archive hides it from the stream, the picker count, the person index and the export; unarchive brings it back', async () => {
        const a = await call('POST', '/api/v2/notes/:id/archive', as.alen, { params: { id: evId } });
        assert.strictEqual(a.status, 200); assert.ok(a.body.note.archived_at);
        assert.ok(!(await list(as.alen)).some(n => n.id === evId), 'hidden by default');
        assert.ok((await list(as.alen, { archived: '1' })).some(n => n.id === evId), 'listed under archived');
        assert.strictEqual((await call('GET', '/api/v2/notes/events', as.alen)).body.events.find(e => e.key === 'bridges:bb-bos').count, 0);
        assert.ok(!(await call('GET', '/api/v2/notes/people', as.alen)).body.people.some(p => p.name === 'Prof. Ana Kovač'));
        assert.ok(!/Ana Kovač/.test(String((await call('GET', '/api/v2/notes/export', as.alen, { query: { event: 'bridges:bb-bos' } })).body)));
        assert.strictEqual((await call('GET', '/api/v2/notes/summary', as.alen)).body.count, 2);
        const u = await call('POST', '/api/v2/notes/:id/unarchive', as.laura, { params: { id: evId } });
        assert.strictEqual(u.body.note.archived_at, null);
        assert.ok((await list(as.alen)).some(n => n.id === evId));
        assert.ok(q.get("SELECT id FROM audit_log WHERE action = 'note.archive'") && q.get("SELECT id FROM audit_log WHERE action = 'note.unarchive'"));
    });

    await t('hard delete removes the note, its people and its files (local file unlinked); a second delete → 404', async () => {
        const stored = q.get('SELECT stored_key FROM v2_note_files WHERE id = ?', [fileId]).stored_key;
        assert.ok(fs.existsSync(stored));
        const d = await call('DELETE', '/api/v2/notes/:id', as.alen, { params: { id: evId } });
        assert.strictEqual(d.status, 200);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM v2_notes WHERE id = ?', [evId]).c, 0);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM v2_note_people WHERE note_id = ?', [evId]).c, 0);
        assert.strictEqual(q.get('SELECT COUNT(*) AS c FROM v2_note_files WHERE note_id = ?', [evId]).c, 0);
        assert.ok(!fs.existsSync(stored), 'local file unlinked');
        assert.strictEqual((await call('DELETE', '/api/v2/notes/:id', as.alen, { params: { id: evId } })).status, 404);
    });

    await t('every write left an audit row; nothing here can email (no sendEmail in ctx, no mail code path)', () => {
        const actions = q.all('SELECT DISTINCT action FROM audit_log').map(r => r.action);
        for (const a of ['note.create', 'note.update', 'note.pin', 'note.unpin', 'note.archive', 'note.unarchive', 'note.delete', 'note.file.upload', 'note.file.remove', 'note.person.add', 'note.person.remove']) assert.ok(actions.includes(a), 'missing audit ' + a);
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/v2/notes.js'), 'utf8');
        assert.ok(!/sendEmail|emailHtml|nodemailer|brevo/i.test(src), 'notes.js has no email path');
    });

    await t('permissions: /api/v2/notes is NOT section-gated (every signed-in admin) and the SPA route carries no `sections`', () => {
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');
        const m = /const SECTION_ROUTE_MAP = \[([\s\S]*?)\n\];/.exec(src);
        assert.ok(m, 'SECTION_ROUTE_MAP found');
        const map = new Function('return [' + m[1] + '\n];')();
        const sectionFor = p => { for (const [prefix, section] of map) if (p === prefix || p.startsWith(prefix + '/')) return section; return null; };
        assert.strictEqual(sectionFor('/api/v2/notes'), null);
        assert.strictEqual(sectionFor('/api/v2/notes/events'), null);
        const routes = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/routes.js'), 'utf8');
        const row = routes.split('\n').find(l => /path: '\/notes\/:id\?'/.test(l));
        assert.ok(row, 'the /notes/:id? route exists');
        assert.ok(!/sections:/.test(row), 'no sections gate on /notes');
        const nav = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/chrome.js'), 'utf8');
        const navRow = nav.split('\n').find(l => /key: 'Notes'/.test(l));
        assert.ok(navRow && !/sections:/.test(navRow), 'the NOTES nav item is for everyone');
    });

    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})().catch(e => { console.error(e); process.exit(1); });
