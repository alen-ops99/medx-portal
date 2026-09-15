/**
 * tests/big-ideas.test.js — BIG IDEAS, the long-game book (admin-portal/backend/v2/big-ideas.js).
 *
 * Hermetic, in the house pattern (tests/awards.test.js): a stub express app collects routes, ONE
 * in-memory libsql database (the same shared/db.js wrapper both portals use) carries the real
 * schema, and the module is mounted on it exactly as production does. global.fetch is disabled and
 * the S3 signer is stubbed, so A REAL NETWORK CALL OR BUCKET WRITE IS IMPOSSIBLE HERE.
 *
 * Covers what the section has to get right:
 *   every route mounted · CRUD on an idea · the filters (status · area · country · person) ·
 *   the search reaching into the LOG, the PEOPLE and the INSTITUTIONS, not only the title ·
 *   a person attached by ref (user / member / person) and a person written in free ·
 *   the log newest-first · the due list's maths (overdue before upcoming, the window, parked out) ·
 *   the one-pager and the portfolio briefing carrying the real data · the upload gate
 *   (extension · size · magic bytes · the S3 key shape) · the permission wiring (no admin → refused,
 *   admin → served, and /api/v2/big-ideas mapped to the `big-ideas` section) · an audit row per write.
 *
 * Run:  node tests/big-ideas.test.js      (exit code = number of FAILs)
 */
'use strict';

const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
delete process.env.BREVO_API_KEY;
delete process.env.TURSO_DATABASE_URL;
delete process.env.RENDER_EXTERNAL_URL;
for (const k of Object.keys(process.env)) if (k.startsWith('BB_S3_')) delete process.env[k];
process.env.PORT = '3000';

global.fetch = () => { throw new Error('NETWORK DISABLED IN TESTS'); };

const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));
const boston = require(path.join(ROOT, 'user-portal/backend/boston'));

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
                headers: opts.headers || {}, ip: '10.0.0.1', path: opts.path || p,
                file: opts.file || undefined,
                protocol: 'https', get: () => 'admin.test'
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

// ---------------------------------------------------------------- one shared DB
const db = createDatabase(Database, { localPath: ':memory:' });
[
    `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, first_name TEXT, last_name TEXT,
        institution TEXT, country TEXT, is_admin INTEGER DEFAULT 0, is_staff INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE forum_members (id TEXT PRIMARY KEY, user_id TEXT, first_name TEXT, last_name TEXT, email TEXT,
        institution TEXT, position TEXT, location_country TEXT)`,
    `CREATE TABLE contacts (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        organization TEXT, position TEXT, country TEXT)`,
    `CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT, detail TEXT, created_at TEXT)`
].forEach(s => db.run(s));

const q = {
    run: (s, p) => db.run(s, p || []),
    get: (s, p) => { const st = db.prepare(s); st.bind(p || []); const r = st.step() ? st.getAsObject() : null; st.free(); return r; },
    all: (s, p) => { const st = db.prepare(s); st.bind(p || []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; }
};

q.run('INSERT INTO users (id, email, first_name, last_name, institution, is_admin) VALUES (?,?,?,?,?,1)',
    ['u-alen', 'juginovic.alen@gmail.com', 'Alen', 'Juginovic', 'Harvard Medical School']);
q.run('INSERT INTO users (id, email, first_name, last_name, institution, is_admin) VALUES (?,?,?,?,?,1)',
    ['u-miro', 'vp@medx.hr', 'Miro', 'Vukovic', 'Med&X']);
q.run('INSERT INTO users (id, email, first_name, last_name, institution, is_admin) VALUES (?,?,?,?,?,0)',
    ['u-ana', 'ana@example.hr', 'Ana', 'Horvat', 'KBC Split']);
q.run('INSERT INTO forum_members (id, first_name, last_name, email, institution, position, location_country) VALUES (?,?,?,?,?,?,?)',
    ['fm-1', 'Ivan', 'Kovačević', 'ivan@mef.hr', 'School of Medicine Zagreb', 'Vice-dean', 'Croatia']);
q.run('INSERT INTO contacts (id, first_name, last_name, email, organization, position, country) VALUES (?,?,?,?,?,?,?)',
    ['c-1', 'Sarah', 'Whitfield', 'sarah@yale.edu', 'Yale University', 'Associate dean', 'United States']);

// ---------------------------------------------------------------- auth stubs + S3 stub
const auth = (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'Authentication required' }); next(); };
const adminOnly = (req, res, next) => { if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Admin only' }); next(); };
const ADMIN = { id: 'u-alen', email: 'juginovic.alen@gmail.com', is_admin: true };
const NOT_ADMIN = { id: 'u-ana', email: 'ana@example.hr', is_admin: false };

// The bucket is never touched: putObject records the call, presignGet answers a fixed URL.
const puts = [];
boston._s3.isConfigured = () => true;
boston._s3.putObject = async (key, body, mime) => { puts.push({ key, size: body.length, mime }); return { etag: '"stub"' }; };
boston._s3.presignGet = (key, opts) => 'https://bucket.test/' + key + '?sig=stub&name=' + encodeURIComponent((opts && opts.filename) || '');

// ---------------------------------------------------------------- mount
const app = stubApp();
const mountBigIdeas = require(path.join(ROOT, 'admin-portal/backend/v2/big-ideas.js'));
mountBigIdeas(app, { db: () => db, auth, adminOnly, sendEmail: async () => ({ success: true }), saveDb: () => {}, JWT_SECRET: 'test-secret-big-ideas', ROOT, log: () => {} });
const I = mountBigIdeas._internals;

// ---------------------------------------------------------------- helpers
const call = (m, p, o) => app.call(m, p, o);
const asAdmin = (m, p, o) => app.call(m, p, Object.assign({ user: ADMIN }, o || {}));
const auditCount = () => Number(q.get('SELECT COUNT(*) AS n FROM audit_log').n || 0);
const auditsFor = (action) => q.all('SELECT * FROM audit_log WHERE action = ?', [action]);
const dayOffset = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const zip = (n) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(Math.max(8, n - 4), 0x41)]);
const pdf = (n) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(8, n - 9), 0x41)]);

let YALE = null, SECOND = null;

(async () => {
    console.log('big-ideas.test.js — hermetic (stub express, in-memory libsql, stubbed S3, no network)\n');

    // ============================================================ routes
    await t('every big-ideas route is mounted', () => {
        for (const k of [
            'GET /api/v2/big-ideas', 'POST /api/v2/big-ideas',
            'GET /api/v2/big-ideas/due', 'GET /api/v2/big-ideas/portfolio', 'GET /api/v2/big-ideas/export.csv',
            'GET /api/v2/big-ideas/people/search',
            'GET /api/v2/big-ideas/:id', 'PUT /api/v2/big-ideas/:id', 'DELETE /api/v2/big-ideas/:id',
            'GET /api/v2/big-ideas/:id/one-pager',
            'POST /api/v2/big-ideas/:id/people', 'PUT /api/v2/big-ideas/people/:pid', 'DELETE /api/v2/big-ideas/people/:pid',
            'POST /api/v2/big-ideas/:id/institutions', 'PUT /api/v2/big-ideas/institutions/:iid', 'DELETE /api/v2/big-ideas/institutions/:iid',
            'POST /api/v2/big-ideas/:id/log', 'PUT /api/v2/big-ideas/log/:lid', 'DELETE /api/v2/big-ideas/log/:lid',
            'POST /api/v2/big-ideas/:id/files', 'GET /api/v2/big-ideas/files/:fid', 'DELETE /api/v2/big-ideas/files/:fid'
        ]) assert.ok(app.routes[k], 'missing ' + k);
    });

    await t('the five tables exist with the columns the spec names', () => {
        const cols = (table) => q.all(`SELECT name FROM pragma_table_info('${table}')`).map(r => r.name);
        for (const c of ['id', 'title', 'thesis', 'description', 'area', 'status', 'croatian_side', 'international_side',
            'countries', 'tags', 'owner_user_id', 'next_step', 'next_step_due', 'priority', 'created_by', 'created_at',
            'updated_at', 'archived_at']) assert.ok(cols('big_ideas').includes(c), 'big_ideas.' + c);
        for (const c of ['id', 'idea_id', 'person_ref', 'name', 'institution', 'role', 'email', 'relationship',
            'our_owner_user_id', 'notes', 'created_at']) assert.ok(cols('big_idea_people').includes(c), 'big_idea_people.' + c);
        for (const c of ['id', 'idea_id', 'name', 'country', 'kind', 'website', 'notes']) assert.ok(cols('big_idea_institutions').includes(c), 'big_idea_institutions.' + c);
        for (const c of ['id', 'idea_id', 'at', 'kind', 'summary', 'detail', 'by_user_id', 'created_at']) assert.ok(cols('big_idea_log').includes(c), 'big_idea_log.' + c);
        for (const c of ['id', 'idea_id', 'original_name', 'stored_key', 'size', 'mime', 'uploaded_by', 'created_at']) assert.ok(cols('big_idea_files').includes(c), 'big_idea_files.' + c);
    });

    // ============================================================ permission wiring
    await t('the section is wired: /api/v2/big-ideas → `big-ideas`, and the id is in PERMISSION_SECTIONS', () => {
        const src = require('fs').readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');
        assert.match(src, /\['\/api\/v2\/big-ideas',\s*'big-ideas'\]/, 'SECTION_ROUTE_MAP maps the prefix');
        assert.match(src, /id:\s*'big-ideas',\s*label:\s*'Big Ideas'/, 'PERMISSION_SECTIONS carries the id');
        // the ids stored per admin are never renamed — the other Projects rows must still be there
        for (const id of ['plexus', 'accelerator', 'forum', 'bridges', 'plexus-meetups', 'plexus-awards']) {
            assert.ok(src.includes(`id: '${id}'`), 'existing permission id survives: ' + id);
        }
        const perms = require('fs').readFileSync(path.join(ROOT, 'admin-portal/frontend-v2/js/perms.js'), 'utf8');
        assert.match(perms, /\{ id: 'big-ideas', label: 'Big Ideas', group: 'Projects' \}/, 'the SPA mirrors the id, adjacent to Projects');
    });

    await t('a signed-out caller is refused, a non-admin is refused, an admin is served', async () => {
        assert.strictEqual((await call('GET', '/api/v2/big-ideas')).status, 401);
        assert.strictEqual((await call('GET', '/api/v2/big-ideas', { user: NOT_ADMIN })).status, 403);
        assert.strictEqual((await asAdmin('GET', '/api/v2/big-ideas')).status, 200);
        assert.strictEqual((await call('POST', '/api/v2/big-ideas', { user: NOT_ADMIN, body: { title: 'x' } })).status, 403);
    });

    // ============================================================ create + read
    await t('the empty list answers the vocabulary and no ideas', async () => {
        const r = await asAdmin('GET', '/api/v2/big-ideas');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.ideas, []);
        assert.deepStrictEqual(r.body.statuses, ['idea', 'exploring', 'in-talks', 'agreed', 'running', 'parked', 'dropped']);
        assert.ok(r.body.areas.includes('Education & training'));
        assert.deepStrictEqual(r.body.log_kinds, ['meeting', 'call', 'email', 'note', 'milestone', 'decision']);
        assert.strictEqual(r.body.uploads_configured, true);
    });

    await t('a big idea is created with a title alone, and a title-less one is refused', async () => {
        const bad = await asAdmin('POST', '/api/v2/big-ideas', { body: { thesis: 'no title here' } });
        assert.strictEqual(bad.status, 400);
        const before = auditCount();
        const r = await asAdmin('POST', '/api/v2/big-ideas', {
            body: {
                title: 'Joint PhD programme — Yale × a Croatian university',
                thesis: 'A structured, co-supervised PhD track between Yale and a Croatian medical faculty, with time in both labs',
                area: 'Education & training', status: 'idea',
                international_side: 'Yale University', croatian_side: 'to be decided (Zagreb / Split / Rijeka)',
                countries: 'Croatia, United States', tags: 'phd, yale',
                owner_user_id: 'u-alen', priority: 1,
                next_step: 'Identify the Croatian faculty and a Yale champion', next_step_due: dayOffset(30),
                description: 'Two supervisors, one thesis, a year on each side.'
            }
        });
        assert.strictEqual(r.status, 200);
        YALE = r.body.idea;
        assert.strictEqual(YALE.status, 'idea');
        assert.strictEqual(YALE.status_label, 'Idea');
        assert.strictEqual(YALE.priority, 1);
        assert.deepStrictEqual(YALE.countries, ['Croatia', 'United States']);
        assert.deepStrictEqual(YALE.tags, ['phd', 'yale']);
        assert.strictEqual(YALE.owner.name, 'Alen Juginovic');
        assert.strictEqual(auditCount(), before + 1, 'the create wrote one audit row');
        assert.match(auditsFor('big-ideas.create')[0].detail, /Joint PhD programme/);
    });

    await t('a bad date and a bad status are refused', async () => {
        const d = await asAdmin('POST', '/api/v2/big-ideas', { body: { title: 'x', next_step_due: 'next spring' } });
        assert.strictEqual(d.status, 400);
        const s = await asAdmin('PUT', '/api/v2/big-ideas/:id', { params: { id: YALE.id }, body: { status: 'maybe' } });
        assert.strictEqual(s.status, 400);
    });

    await t('the detail read carries the idea and four empty collections', async () => {
        const r = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.idea.title, YALE.title);
        assert.deepStrictEqual(r.body.people, []);
        assert.deepStrictEqual(r.body.institutions, []);
        assert.deepStrictEqual(r.body.log, []);
        assert.deepStrictEqual(r.body.files, []);
        assert.ok(Array.isArray(r.body.team) && r.body.team.length >= 2, 'the team list comes with it');
        const missing = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: 'no-such-idea' } });
        assert.strictEqual(missing.status, 404);
    });

    await t('an update changes only what it names, and writes an audit row', async () => {
        const before = auditCount();
        const r = await asAdmin('PUT', '/api/v2/big-ideas/:id', { params: { id: YALE.id }, body: { status: 'exploring', priority: 2 } });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.idea.status, 'exploring');
        assert.strictEqual(r.body.idea.priority, 2);
        assert.strictEqual(r.body.idea.thesis, YALE.thesis, 'the untouched fields are untouched');
        assert.strictEqual(auditCount(), before + 1);
        assert.match(auditsFor('big-ideas.update')[0].detail, /status → exploring/);
        await asAdmin('PUT', '/api/v2/big-ideas/:id', { params: { id: YALE.id }, body: { status: 'idea', priority: 1 } });
    });

    // ============================================================ people
    await t('a person is attached by ref from each of the three People sources', async () => {
        const search = await asAdmin('GET', '/api/v2/big-ideas/people/search', { query: { q: 'kovač' } });
        assert.strictEqual(search.status, 200);
        const ivan = search.body.results.find(x => x.ref === 'member:fm-1');
        assert.ok(ivan, 'the forum member is findable');
        assert.strictEqual(ivan.kind, 'FORUM');
        assert.strictEqual(ivan.institution, 'School of Medicine Zagreb');

        const yale = await asAdmin('GET', '/api/v2/big-ideas/people/search', { query: { q: 'whitfield' } });
        assert.ok(yale.body.results.some(x => x.ref === 'person:c-1' && x.kind === 'CONTACT'));

        const team = await asAdmin('GET', '/api/v2/big-ideas/people/search', { query: { q: 'miro' } });
        assert.ok(team.body.results.some(x => x.ref === 'user:u-miro' && x.kind === 'TEAM'));

        // a one-letter term never scans the directory
        assert.deepStrictEqual((await asAdmin('GET', '/api/v2/big-ideas/people/search', { query: { q: 'k' } })).body.results, []);

        // attaching by ref fills in the name, institution and email from the directory
        const a = await asAdmin('POST', '/api/v2/big-ideas/:id/people', { params: { id: YALE.id }, body: { person_ref: 'member:fm-1', relationship: 'champion' } });
        assert.strictEqual(a.status, 200);
        assert.strictEqual(a.body.person.name, 'Ivan Kovačević');
        assert.strictEqual(a.body.person.institution, 'School of Medicine Zagreb');
        assert.strictEqual(a.body.person.email, 'ivan@mef.hr');
        assert.strictEqual(a.body.person.role, 'Vice-dean');
        assert.strictEqual(a.body.person.relationship, 'champion');
        assert.strictEqual(a.body.person.person_ref, 'member:fm-1');

        const b = await asAdmin('POST', '/api/v2/big-ideas/:id/people', { params: { id: YALE.id }, body: { person_ref: 'person:c-1', relationship: 'decision-maker', our_owner_user_id: 'u-alen' } });
        assert.strictEqual(b.body.person.institution, 'Yale University');
        assert.strictEqual(b.body.person.our_owner.name, 'Alen Juginovic');

        const gone = await asAdmin('POST', '/api/v2/big-ideas/:id/people', { params: { id: YALE.id }, body: { person_ref: 'user:nobody' } });
        assert.strictEqual(gone.status, 404, 'a ref that no longer resolves is refused, never half-saved');
        const forged = await asAdmin('POST', '/api/v2/big-ideas/:id/people', { params: { id: YALE.id }, body: { person_ref: 'root:1;drop', name: 'X' } });
        assert.strictEqual(forged.status, 400, 'only the three ref shapes are accepted');
    });

    await t('a person can also be written in free, and needs a name', async () => {
        const none = await asAdmin('POST', '/api/v2/big-ideas/:id/people', { params: { id: YALE.id }, body: { institution: 'Somewhere' } });
        assert.strictEqual(none.status, 400);
        const r = await asAdmin('POST', '/api/v2/big-ideas/:id/people', {
            params: { id: YALE.id },
            body: { name: 'Marija Lovrić', institution: 'Ministry of Science', role: 'State secretary', email: 'marija@mzo.hr', relationship: 'advisor' }
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.person.person_ref, null, 'a free contact carries no ref');
        const full = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.strictEqual(full.body.people.length, 3);
        assert.strictEqual(full.body.idea.people_count, 3);
        assert.ok(auditsFor('big-ideas.person.add').length >= 3, 'every attach is audited');
    });

    await t('a person is edited and detached', async () => {
        const full = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        const marija = full.body.people.find(p => p.name === 'Marija Lovrić');
        const up = await asAdmin('PUT', '/api/v2/big-ideas/people/:pid', { params: { pid: marija.id }, body: { role: 'Minister' } });
        assert.strictEqual(up.status, 200);
        assert.strictEqual(up.body.person.role, 'Minister');
        assert.strictEqual(up.body.person.name, 'Marija Lovrić', 'the rest of the row is untouched');
        const del = await asAdmin('DELETE', '/api/v2/big-ideas/people/:pid', { params: { pid: marija.id } });
        assert.strictEqual(del.status, 200);
        const after = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.strictEqual(after.body.people.length, 2);
        // put her back — the search test below looks for a ministry person
        await asAdmin('POST', '/api/v2/big-ideas/:id/people', {
            params: { id: YALE.id },
            body: { name: 'Marija Lovrić', institution: 'Ministry of Science', role: 'Minister', relationship: 'advisor' }
        });
    });

    // ============================================================ institutions
    await t('institutions are added, edited and removed', async () => {
        const none = await asAdmin('POST', '/api/v2/big-ideas/:id/institutions', { params: { id: YALE.id }, body: { country: 'Croatia' } });
        assert.strictEqual(none.status, 400);
        const a = await asAdmin('POST', '/api/v2/big-ideas/:id/institutions', {
            params: { id: YALE.id }, body: { name: 'Yale School of Medicine', country: 'United States', kind: 'university', website: 'https://medicine.yale.edu' }
        });
        assert.strictEqual(a.status, 200);
        assert.strictEqual(a.body.institution.kind, 'university');
        const b = await asAdmin('POST', '/api/v2/big-ideas/:id/institutions', {
            params: { id: YALE.id }, body: { name: 'Ministarstvo znanosti i obrazovanja', country: 'Croatia', kind: 'ministry' }
        });
        assert.strictEqual(b.status, 200);
        const up = await asAdmin('PUT', '/api/v2/big-ideas/institutions/:iid', { params: { iid: b.body.institution.id }, body: { notes: 'The signature has to come from here.' } });
        assert.strictEqual(up.body.institution.notes, 'The signature has to come from here.');
        assert.strictEqual(up.body.institution.name, 'Ministarstvo znanosti i obrazovanja');
        const full = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.strictEqual(full.body.institutions.length, 2);
        assert.ok(auditsFor('big-ideas.institution.add').length >= 2);
    });

    // ============================================================ log
    await t('the log is newest first, whatever order the entries were written in', async () => {
        const add = (at, kind, summary, detail) => asAdmin('POST', '/api/v2/big-ideas/:id/log', { params: { id: YALE.id }, body: { at, kind, summary, detail } });
        assert.strictEqual((await add('2026-06-02', 'meeting', 'First coffee with Ivan in Zagreb', 'He offered to sound out the dean.')).status, 200);
        assert.strictEqual((await add('2026-08-14', 'call', 'Call with Sarah at Yale', 'Yale would host for a year if the funding is Croatian.')).status, 200);
        assert.strictEqual((await add('2026-07-09', 'email', 'Wrote to the ministry', '')).status, 200);
        const bad = await add('the summer', 'note', 'x', '');
        assert.strictEqual(bad.status, 400, 'a date has to be a date');
        const noSummary = await asAdmin('POST', '/api/v2/big-ideas/:id/log', { params: { id: YALE.id }, body: { at: '2026-08-01', kind: 'note' } });
        assert.strictEqual(noSummary.status, 400, 'one line, at least');

        const full = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.deepStrictEqual(full.body.log.map(l => l.at), ['2026-08-14', '2026-07-09', '2026-06-02']);
        assert.strictEqual(full.body.log[0].kind, 'call');
        assert.strictEqual(full.body.log[0].by.name, 'Alen Juginovic', 'an entry knows who wrote it');
        assert.strictEqual(full.body.idea.last_activity, '2026-08-14');
        assert.ok(auditsFor('big-ideas.log.add').length >= 3);
    });

    await t('a log entry is edited and removed', async () => {
        const full = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        const email = full.body.log.find(l => l.kind === 'email');
        const up = await asAdmin('PUT', '/api/v2/big-ideas/log/:lid', { params: { lid: email.id }, body: { detail: 'No answer yet.' } });
        assert.strictEqual(up.body.entry.detail, 'No answer yet.');
        assert.strictEqual(up.body.entry.summary, 'Wrote to the ministry');
        const spare = await asAdmin('POST', '/api/v2/big-ideas/:id/log', { params: { id: YALE.id }, body: { at: '2026-05-01', kind: 'note', summary: 'A line to delete' } });
        assert.strictEqual((await asAdmin('DELETE', '/api/v2/big-ideas/log/:lid', { params: { lid: spare.body.entry.id } })).status, 200);
        const after = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.strictEqual(after.body.log.length, 3);
    });

    // ============================================================ a second idea, then the filters
    await t('a second idea is created, so the filters have something to choose between', async () => {
        const r = await asAdmin('POST', '/api/v2/big-ideas', {
            body: {
                title: 'A shared biobank between Split and Vienna',
                thesis: 'One consent form, two freezers, a single catalogue.',
                area: 'Research collaboration', status: 'in-talks',
                croatian_side: 'KBC Split', international_side: 'Medizinische Universität Wien',
                countries: ['Croatia', 'Austria'], tags: ['biobank'],
                owner_user_id: 'u-miro', priority: 2,
                next_step: 'Draft the joint consent form', next_step_due: dayOffset(-3)
            }
        });
        assert.strictEqual(r.status, 200);
        SECOND = r.body.idea;
        assert.strictEqual(SECOND.overdue, true, 'a date three days back reads as overdue');
        assert.strictEqual(SECOND.days_until, -3);
    });

    await t('the list groups, orders and counts', async () => {
        const r = await asAdmin('GET', '/api/v2/big-ideas');
        assert.strictEqual(r.body.ideas.length, 2);
        assert.deepStrictEqual(r.body.ideas.map(i => i.status), ['idea', 'in-talks'], 'status order, not alphabetical');
        assert.strictEqual(r.body.counts['idea'], 1);
        assert.strictEqual(r.body.counts['in-talks'], 1);
        const yale = r.body.ideas.find(i => i.id === YALE.id);
        assert.strictEqual(yale.people_count, 3);
        assert.strictEqual(yale.institution_count, 2);
        assert.strictEqual(yale.log_count, 3);
    });

    await t('status, area and country each narrow the list', async () => {
        const byStatus = await asAdmin('GET', '/api/v2/big-ideas', { query: { status: 'in-talks' } });
        assert.deepStrictEqual(byStatus.body.ideas.map(i => i.id), [SECOND.id]);
        const byArea = await asAdmin('GET', '/api/v2/big-ideas', { query: { area: 'Education & training' } });
        assert.deepStrictEqual(byArea.body.ideas.map(i => i.id), [YALE.id]);
        const byCountry = await asAdmin('GET', '/api/v2/big-ideas', { query: { country: 'austria' } });
        assert.deepStrictEqual(byCountry.body.ideas.map(i => i.id), [SECOND.id], 'country match is case-insensitive');
        const bothCountries = await asAdmin('GET', '/api/v2/big-ideas', { query: { country: 'Croatia' } });
        assert.strictEqual(bothCountries.body.ideas.length, 2);
    });

    await t('the person filter finds the idea by a name, an email or the exact ref', async () => {
        for (const term of ['kovač', 'ivan@mef.hr', 'member:fm-1']) {
            const r = await asAdmin('GET', '/api/v2/big-ideas', { query: { person: term } });
            assert.deepStrictEqual(r.body.ideas.map(i => i.id), [YALE.id], 'person=' + term);
        }
        const none = await asAdmin('GET', '/api/v2/big-ideas', { query: { person: 'nobody at all' } });
        assert.deepStrictEqual(none.body.ideas, []);
    });

    await t('the search reads the log, the people and the institutions — not only the title', async () => {
        const hits = async (term) => (await asAdmin('GET', '/api/v2/big-ideas', { query: { q: term } })).body.ideas.map(i => i.id);
        assert.deepStrictEqual(await hits('joint phd'), [YALE.id], 'the title');
        assert.deepStrictEqual(await hits('co-supervised'), [YALE.id], 'the thesis');
        assert.deepStrictEqual(await hits('both labs'), [YALE.id], 'the description');
        assert.deepStrictEqual(await hits('first coffee'), [YALE.id], 'a log summary');
        assert.deepStrictEqual(await hits('sound out the dean'), [YALE.id], 'a log detail');
        assert.deepStrictEqual(await hits('marija'), [YALE.id], 'a person we attached');
        assert.deepStrictEqual(await hits('ministarstvo'), [YALE.id], 'an institution');
        assert.deepStrictEqual(await hits('freezers'), [SECOND.id], 'the other idea, by its thesis');
        assert.deepStrictEqual(await hits('nothing like this exists'), []);
        const combined = await asAdmin('GET', '/api/v2/big-ideas', { query: { q: 'coffee', status: 'in-talks' } });
        assert.deepStrictEqual(combined.body.ideas, [], 'a filter and a search narrow together, never widen');
    });

    // ============================================================ the due list
    await t('the due list puts the overdue first, honours the window and skips the parked', async () => {
        const soon = await asAdmin('POST', '/api/v2/big-ideas', { body: { title: 'Due in two days', next_step: 'Ring the dean', next_step_due: dayOffset(2) } });
        const later = await asAdmin('POST', '/api/v2/big-ideas', { body: { title: 'Due in forty days', next_step: 'Later', next_step_due: dayOffset(40) } });
        const parked = await asAdmin('POST', '/api/v2/big-ideas', { body: { title: 'Parked but dated', status: 'parked', next_step: 'Nothing for now', next_step_due: dayOffset(1) } });

        const r = await asAdmin('GET', '/api/v2/big-ideas/due');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.days, 14, 'a fortnight by default');
        const ids = r.body.items.map(i => i.id);
        assert.strictEqual(ids[0], SECOND.id, 'the overdue one leads');
        assert.ok(ids.includes(soon.body.idea.id), 'inside the window');
        assert.ok(!ids.includes(later.body.idea.id), 'outside the window');
        assert.ok(!ids.includes(parked.body.idea.id), 'a parked idea is not chasing anybody');
        assert.ok(!ids.includes(YALE.id), 'thirty days away is outside a fortnight');
        assert.strictEqual(r.body.overdue, 1);
        assert.strictEqual(r.body.upcoming, ids.length - 1);
        assert.strictEqual(r.body.items[0].days_until, -3);
        assert.strictEqual(r.body.items[0].overdue, true);

        const wide = await asAdmin('GET', '/api/v2/big-ideas/due', { query: { days: 60 } });
        assert.ok(wide.body.items.map(i => i.id).includes(later.body.idea.id), 'a wider window reaches further');
        assert.ok(wide.body.items.map(i => i.id).includes(YALE.id));

        // tidy up so the printables and the CSV read on the two real ideas
        for (const x of [soon, later, parked]) await asAdmin('DELETE', '/api/v2/big-ideas/:id', { params: { id: x.body.idea.id }, query: { hard: '1' } });
    });

    await t('daysUntil is whole days, signed, and null without a date', () => {
        assert.strictEqual(I.daysUntil('2026-09-20', '2026-09-15'), 5);
        assert.strictEqual(I.daysUntil('2026-09-10', '2026-09-15'), -5);
        assert.strictEqual(I.daysUntil('2026-09-15', '2026-09-15'), 0);
        assert.strictEqual(I.daysUntil('', '2026-09-15'), null);
        assert.strictEqual(I.daysUntil('2026-09-20T23:30:00Z', '2026-09-15'), 5, 'a timestamp is read as its date');
    });

    // ============================================================ the printables
    await t('the one-pager carries the idea, the people, the institutions, the log and the next step', async () => {
        const r = await asAdmin('GET', '/api/v2/big-ideas/:id/one-pager', { params: { id: YALE.id } });
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'] || '', /text\/html/);
        const html = String(r.body);
        assert.match(html, /<!DOCTYPE html>/i, 'a full HTML document');
        assert.match(html, /Joint PhD programme/);
        assert.match(html, /co-supervised PhD track/);
        assert.match(html, /Ivan Kovačević/, 'a person');
        assert.match(html, /School of Medicine Zagreb/, 'their institution');
        assert.match(html, /Ministarstvo znanosti i obrazovanja/, 'an institution of the idea');
        assert.match(html, /First coffee with Ivan in Zagreb/, 'the log');
        assert.match(html, /Identify the Croatian faculty/, 'the next step');
        assert.match(html, /noindex/, 'never indexed');
        assert.match(html, /Fraunces/, 'the house display face');
        assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no leaked placeholders');
        const missing = await asAdmin('GET', '/api/v2/big-ideas/:id/one-pager', { params: { id: 'nope' } });
        assert.strictEqual(missing.status, 404);
    });

    await t('the portfolio briefing is a summary table plus one page per active idea', async () => {
        const r = await asAdmin('GET', '/api/v2/big-ideas/portfolio');
        assert.strictEqual(r.status, 200);
        const html = String(r.body);
        assert.match(html, /Portfolio briefing/);
        assert.match(html, /Joint PhD programme/);
        assert.match(html, /shared biobank between Split and Vienna/);
        assert.match(html, /page-break/, 'each idea starts a page');
        assert.match(html, /Ivan Kovačević/, 'the pages carry the detail, not only the table');
        assert.ok(!html.includes('undefined') && !html.includes('NaN'));

        // a parked idea is not part of the briefing
        const parked = await asAdmin('POST', '/api/v2/big-ideas', { body: { title: 'A parked thought about telemedicine', status: 'parked' } });
        const again = String((await asAdmin('GET', '/api/v2/big-ideas/portfolio')).body);
        assert.ok(!/parked thought about telemedicine/.test(again), 'the briefing is the ACTIVE portfolio');
        await asAdmin('DELETE', '/api/v2/big-ideas/:id', { params: { id: parked.body.idea.id }, query: { hard: '1' } });
    });

    await t('the CSV is BOM-first, quoted, and follows the same filters', async () => {
        const r = await asAdmin('GET', '/api/v2/big-ideas/export.csv');
        assert.strictEqual(r.status, 200);
        assert.ok(String(r.body).startsWith('﻿'), 'a BOM, so Excel shows č ć đ š ž');
        assert.match(r.headers['content-disposition'] || '', /medx-big-ideas\.csv/);
        assert.match(String(r.body), /"Joint PhD programme — Yale × a Croatian university"/);
        assert.match(String(r.body), /"Kovačević"|"Croatia; United States"/);
        const filtered = await asAdmin('GET', '/api/v2/big-ideas/export.csv', { query: { status: 'in-talks' } });
        assert.ok(!/Joint PhD programme/.test(String(filtered.body)), 'the export is what the screen shows');
        assert.match(String(filtered.body), /shared biobank/);
    });

    // ============================================================ files
    await t('the upload gate is the extension, the size AND the bytes', () => {
        assert.strictEqual(I.MAX_FILE_BYTES, 20 * 1024 * 1024);
        assert.deepStrictEqual(Object.keys(I.FILE_TYPES).sort(), ['docx', 'jpeg', 'jpg', 'pdf', 'png', 'pptx', 'xlsx']);
        assert.strictEqual(I.magicOk('pdf', Buffer.from('%PDF-1.7\nreally')), true);
        assert.strictEqual(I.magicOk('pdf', Buffer.from('PK a zip pretending')), false);
        assert.strictEqual(I.magicOk('docx', zip(64)), true);
        assert.strictEqual(I.magicOk('docx', Buffer.from('%PDF-1.7 pretending')), false);
        assert.strictEqual(I.magicOk('png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])), true);
        assert.strictEqual(I.magicOk('png', zip(64)), false);
        assert.strictEqual(I.magicOk('jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5])), true);
        assert.strictEqual(I.magicOk('pdf', Buffer.alloc(0)), false);
        assert.strictEqual(I.extOf('Letter of intent.DOCX'), 'docx');
        assert.strictEqual(I.sanitizeFilename('../../etc/passwd'), '.. .. etc passwd', 'a path never survives as a path');
    });

    await t('an upload lands in the bucket under big-ideas/<idea id>/ and a row is written', async () => {
        puts.length = 0;
        const r = await asAdmin('POST', '/api/v2/big-ideas/:id/files', {
            params: { id: YALE.id },
            file: { originalname: 'Draft memorandum.pdf', buffer: pdf(2048) }
        });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.file.original_name, 'Draft memorandum.pdf');
        assert.strictEqual(r.body.file.mime, 'application/pdf');
        assert.strictEqual(puts.length, 1, 'exactly one object was written');
        assert.match(puts[0].key, new RegExp('^big-ideas/' + YALE.id + '/[0-9a-f-]{8,}\\.pdf$'));
        const row = q.get('SELECT * FROM big_idea_files WHERE id = ?', [r.body.file.id]);
        assert.strictEqual(row.stored_key, puts[0].key);
        assert.strictEqual(Number(row.size), 2048);
        assert.ok(auditsFor('big-ideas.file.upload').length >= 1);
    });

    await t('a wrong type, an empty pick, a lying extension and an oversized file are all refused', async () => {
        puts.length = 0;
        const exe = await asAdmin('POST', '/api/v2/big-ideas/:id/files', { params: { id: YALE.id }, file: { originalname: 'payload.exe', buffer: Buffer.alloc(64, 1) } });
        assert.strictEqual(exe.status, 400);
        const none = await asAdmin('POST', '/api/v2/big-ideas/:id/files', { params: { id: YALE.id } });
        assert.strictEqual(none.status, 400);
        const liar = await asAdmin('POST', '/api/v2/big-ideas/:id/files', { params: { id: YALE.id }, file: { originalname: 'notes.pdf', buffer: zip(64) } });
        assert.strictEqual(liar.status, 400, 'a .pdf that is a zip inside never reaches the bucket');
        assert.match(String(liar.body.error), /does not look like a real \.pdf/);
        const huge = await asAdmin('POST', '/api/v2/big-ideas/:id/files', { params: { id: YALE.id }, file: { originalname: 'huge.pdf', buffer: pdf(20 * 1024 * 1024 + 1) } });
        assert.strictEqual(huge.status, 413);
        assert.strictEqual(puts.length, 0, 'nothing was written for any of them');
    });

    await t('a file hands back a presigned link and is removed from the idea', async () => {
        const full = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.strictEqual(full.body.files.length, 1);
        assert.strictEqual(full.body.idea.file_count, 1);
        const f = full.body.files[0];
        assert.ok(!('stored_key' in f), 'the bucket key never leaves the server');

        const json = await asAdmin('GET', '/api/v2/big-ideas/files/:fid', { params: { fid: f.id }, query: { json: '1' } });
        assert.strictEqual(json.status, 200);
        assert.match(json.body.url, /^https:\/\/bucket\.test\/big-ideas\//);
        assert.strictEqual(json.body.name, 'Draft memorandum.pdf');

        const redirect = await asAdmin('GET', '/api/v2/big-ideas/files/:fid', { params: { fid: f.id } });
        assert.strictEqual(redirect.status, 302);
        assert.match(redirect.headers.location, /^https:\/\/bucket\.test\//);

        assert.strictEqual((await asAdmin('DELETE', '/api/v2/big-ideas/files/:fid', { params: { fid: f.id } })).status, 200);
        const after = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: YALE.id } });
        assert.strictEqual(after.body.files.length, 0);
        assert.strictEqual((await asAdmin('GET', '/api/v2/big-ideas/files/:fid', { params: { fid: 'no-such-file' } })).status, 404);
    });

    // ============================================================ archive + delete
    await t('archiving hides an idea from the list without losing anything, and it comes back', async () => {
        const before = auditCount();
        assert.strictEqual((await asAdmin('DELETE', '/api/v2/big-ideas/:id', { params: { id: SECOND.id } })).status, 200);
        assert.strictEqual(auditCount(), before + 1);
        assert.ok(auditsFor('big-ideas.archive').length >= 1);
        const list = await asAdmin('GET', '/api/v2/big-ideas');
        assert.ok(!list.body.ideas.some(i => i.id === SECOND.id), 'gone from the list');
        const withArchived = await asAdmin('GET', '/api/v2/big-ideas', { query: { archived: '1' } });
        assert.ok(withArchived.body.ideas.some(i => i.id === SECOND.id), 'still there when asked for');
        const still = await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id: SECOND.id } });
        assert.strictEqual(still.status, 200, 'the idea itself is never unreachable');
        assert.ok(still.body.idea.archived_at);
        const due = await asAdmin('GET', '/api/v2/big-ideas/due', { query: { days: 90 } });
        assert.ok(!due.body.items.some(i => i.id === SECOND.id), 'an archived idea stops chasing');
        await asAdmin('PUT', '/api/v2/big-ideas/:id', { params: { id: SECOND.id }, body: { archived: false } });
        const back = await asAdmin('GET', '/api/v2/big-ideas');
        assert.ok(back.body.ideas.some(i => i.id === SECOND.id));
    });

    await t('a hard delete takes the children with it', async () => {
        const spare = await asAdmin('POST', '/api/v2/big-ideas', { body: { title: 'One to remove' } });
        const id = spare.body.idea.id;
        await asAdmin('POST', '/api/v2/big-ideas/:id/people', { params: { id }, body: { name: 'Someone' } });
        await asAdmin('POST', '/api/v2/big-ideas/:id/log', { params: { id }, body: { at: '2026-09-01', kind: 'note', summary: 'A line' } });
        assert.strictEqual((await asAdmin('DELETE', '/api/v2/big-ideas/:id', { params: { id }, query: { hard: '1' } })).status, 200);
        assert.strictEqual((await asAdmin('GET', '/api/v2/big-ideas/:id', { params: { id } })).status, 404);
        assert.strictEqual(q.all('SELECT * FROM big_idea_people WHERE idea_id = ?', [id]).length, 0);
        assert.strictEqual(q.all('SELECT * FROM big_idea_log WHERE idea_id = ?', [id]).length, 0);
        assert.ok(auditsFor('big-ideas.delete').length >= 1);
    });

    // ============================================================ the audit trail as a whole
    await t('every kind of write left an audit row, and nothing wrote one without an actor', () => {
        const kinds = new Set(q.all('SELECT DISTINCT action FROM audit_log').map(r => r.action));
        for (const k of ['big-ideas.create', 'big-ideas.update', 'big-ideas.archive', 'big-ideas.delete',
            'big-ideas.person.add', 'big-ideas.person.update', 'big-ideas.person.remove',
            'big-ideas.institution.add', 'big-ideas.institution.update',
            'big-ideas.log.add', 'big-ideas.log.update', 'big-ideas.log.remove',
            'big-ideas.file.upload', 'big-ideas.file.remove']) assert.ok(kinds.has(k), 'no audit row for ' + k);
        const rows = q.all("SELECT * FROM audit_log WHERE action LIKE 'big-ideas.%'");
        assert.ok(rows.length >= 20, 'the trail is the whole session, not a sample: ' + rows.length);
        rows.forEach(r => {
            assert.strictEqual(r.actor_email, 'juginovic.alen@gmail.com');
            assert.ok(r.created_at, 'every row is dated');
        });
    });

    // ============================================================ done
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed);
})();
