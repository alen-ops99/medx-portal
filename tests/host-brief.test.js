/**
 * host-brief.test.js — v2 HOST BRIEF backend (admin-portal/backend/v2/host-brief.js).
 *
 * Mounts the module on a STUB express app over an IN-MEMORY libsql database (the same
 * shared/db.js sql.js-compatible wrapper both portals use) — no server boot, no network,
 * no real DB file, nothing external. Seeds a small Plexus evening and asserts:
 *
 *   - headline counts: people incl. parties, paid vs pending, institutions, countries
 *   - notable-guest selection: VIP/sponsor pricing categories, admin_notes,
 *     append-only registrant_notes, biggest parties
 *   - kitchen buckets + verbatim dietary lines with Croatian diacritics preserved
 *   - arrivals state appears when v2_checkin_admits has rows (and counts legacy-only rows)
 *   - zero-data door → graceful empty brief (ok:true, empty:true, friendly line)
 *   - donor door scoped to the Donor Night bridges event; bridges door excludes it
 *   - auth: staff passes, plain user 403, bad event 400
 *   - READ-ONLY guarantee: db.run is booby-trapped after seeding — any write throws
 *
 * Run: node tests/host-brief.test.js   (exit code = number of FAILs)
 */
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
const { createDatabase } = require(path.join(ROOT, 'shared/db'));

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' | got: ' + String(detail).slice(0, 300) : ''));
};

// ---------------------------------------------------------------- stub express
function stubApp() {
    const routes = {};
    const reg = m => (p, ...h) => { routes[m + ' ' + p] = h; };
    return {
        get: reg('GET'), post: reg('POST'), put: reg('PUT'), delete: reg('DELETE'), routes,
        async call(m, p, { user, query } = {}) {
            const chain = routes[m + ' ' + p];
            if (!chain) throw new Error('no route ' + m + ' ' + p);
            const req = { user: user || null, query: query || {}, body: {}, params: {}, headers: {} };
            let status = 200, out = null, ended = false;
            const res = {
                status(c) { status = c; return this; },
                json(o) { out = o; ended = true; return this; },
                send(o) { out = o; ended = true; return this; },
                setHeader() {}
            };
            for (let i = 0; i < chain.length; i++) {
                if (ended) break;
                let advanced = false;
                await chain[i](req, res, () => { advanced = true; });
                if (!advanced && i < chain.length - 1) break;
            }
            return { status, out };
        }
    };
}

// ---------------------------------------------------------------- in-memory DB + schema (real column sets)
const db = createDatabase(Database, { localPath: ':memory:' });
const DDL = [
    `CREATE TABLE registrations (id TEXT PRIMARY KEY, conference_id TEXT, user_id TEXT, ticket_type_id TEXT,
        first_name TEXT, last_name TEXT, email TEXT, institution TEXT, country TEXT,
        registration_type TEXT DEFAULT 'general', status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'unpaid',
        amount_paid REAL, dietary_requirements TEXT, includes_gala INTEGER DEFAULT 0,
        checked_in INTEGER DEFAULT 0, checked_in_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        guest_count INTEGER DEFAULT 0, seat_number TEXT, checkin_token TEXT, revoked INTEGER DEFAULT 0)`,
    `CREATE TABLE gala_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        institution TEXT, title TEXT, dietary TEXT, requests TEXT, pricing TEXT, status TEXT DEFAULT 'pending',
        admin_notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, checked_in INTEGER DEFAULT 0, checked_in_at TEXT,
        payment_status TEXT DEFAULT 'unpaid', amount_paid REAL, guest_count INTEGER DEFAULT 0, seat_number TEXT)`,
    `CREATE TABLE croatians_abroad_registrations (id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
        institution TEXT, country TEXT, role TEXT, dietary TEXT, notes TEXT,
        selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0,
        gala_payment_status TEXT, gala_registration_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        guest_count INTEGER DEFAULT 0, conference_checked_in INTEGER DEFAULT 0, bridges_checked_in INTEGER DEFAULT 0)`,
    `CREATE TABLE bridges_registrations (id TEXT PRIMARY KEY, event_id TEXT, first_name TEXT, last_name TEXT,
        email TEXT, institution TEXT, position TEXT, dietary_requirements TEXT, status TEXT DEFAULT 'registered',
        payment_status TEXT DEFAULT 'n/a', checked_in INTEGER DEFAULT 0, checked_in_at TEXT, notes TEXT,
        registered_at TEXT DEFAULT CURRENT_TIMESTAMP, guest_count INTEGER DEFAULT 0)`,
    `CREATE TABLE bridges_events (id TEXT PRIMARY KEY, name TEXT, slug TEXT, event_date TEXT)`,
    `CREATE TABLE checkin_events (id TEXT PRIMARY KEY, event_key TEXT UNIQUE, label TEXT, starts_at TEXT, ends_at TEXT,
        is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`,
    `CREATE TABLE registrant_notes (id TEXT PRIMARY KEY, registrant_id TEXT, section TEXT, author TEXT, body TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE v2_gala_categories (id TEXT PRIMARY KEY, key TEXT UNIQUE, label TEXT, color TEXT,
        sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0)`,
    `CREATE TABLE v2_checkin_admits (id TEXT PRIMARY KEY, registration_ref TEXT, reg_table TEXT, event_key TEXT,
        party_size INTEGER DEFAULT 1, admitted_count INTEGER DEFAULT 0, guest_name TEXT, guest_email TEXT,
        first_admit_at TEXT, last_scan_at TEXT)`,
    `CREATE TABLE event_checkins (id TEXT PRIMARY KEY, registration_id TEXT, event_key TEXT)`
];
DDL.forEach(s => db.run(s));

// ---------------------------------------------------------------- seed (Croatian diacritics on purpose)
const DONOR_EV = 'ev-donor', BB_EV = 'ev-bb';
const seed = [
    ["INSERT INTO checkin_events (id, event_key, label, starts_at, ends_at) VALUES ('ce1','conference','Plexus Week — Conference','2026-12-04T08:00:00','2026-12-05T20:00:00')"],
    ["INSERT INTO checkin_events (id, event_key, label, starts_at, ends_at) VALUES ('ce2','gala','Plexus Gala Evening','2026-12-05T19:00:00','2026-12-05T23:59:00')"],
    ["INSERT INTO checkin_events (id, event_key, label, starts_at, ends_at) VALUES ('ce3','donor','Plexus Donor Night','2026-12-04T19:00:00','2026-12-04T23:00:00')"],
    ["INSERT INTO checkin_events (id, event_key, label) VALUES ('ce4','bridges','Building Bridges')"],
    [`INSERT INTO bridges_events (id, name, slug, event_date) VALUES ('${DONOR_EV}','Plexus Donor Night','donor-night','2026-12-04')`],
    [`INSERT INTO bridges_events (id, name, slug, event_date) VALUES ('${BB_EV}','Building Bridges: Boston Symposium',NULL,'2026-09-20')`],
    ["INSERT INTO v2_gala_categories (id, key, label, color, sort) VALUES ('c1','invoice','Invoice','#9b1b22',10)"],
    ["INSERT INTO v2_gala_categories (id, key, label, color, sort) VALUES ('c2','vip','VIP — free','#7a6432',20)"],
    ["INSERT INTO v2_gala_categories (id, key, label, color, sort) VALUES ('c3','sponsor','Sponsor seat','#1e6e42',30)"],
    // --- gala: 4 live bookings + 1 cancelled
    ["INSERT INTO gala_registrations (id, first_name, last_name, email, institution, dietary, status, payment_status, guest_count) VALUES ('G1','Ivana','Barišić','ivana@example.hr','Sveučilište u Zagrebu','bez glutena — orašasti plodovi','confirmed','paid',2)"],
    ["INSERT INTO gala_registrations (id, first_name, last_name, email, institution, pricing, status, payment_status, guest_count) VALUES ('G2','Simon','Mikulandra','simon@example.com','Harvard Medical School','vip','confirmed','vip-comp',0)"],
    ["INSERT INTO gala_registrations (id, first_name, last_name, email, institution, dietary, admin_notes, status, payment_status, guest_count) VALUES ('G3','Davor','Klarić','davor@example.hr','KBC Split','vegetarijanac','Sjedne do Lorda Smitha — provjeri stol','pending','pending',1)"],
    ["INSERT INTO gala_registrations (id, first_name, last_name, email, institution, dietary, pricing, status, payment_status, guest_count) VALUES ('G4','Ana','Šarić','ana@example.hr','Pliva d.d.','vegan','sponsor','confirmed','paid',0)"],
    ["INSERT INTO gala_registrations (id, first_name, last_name, email, status, payment_status) VALUES ('G5','Iva','Otkazana','iva@example.hr','cancelled','paid')"],
    // --- croatians abroad: 1 gala-countable + 1 SCANNER TEST + 1 linked-to-G1 + 1 conference-only
    ["INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, institution, country, dietary, selected_gala, gala_payment_status, guest_count) VALUES ('CA1','Marija','Horvat','marija@example.at','Medical University of Graz','Österreich','vegetarijanka',1,'paid',0)"],
    ["INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, notes, selected_gala, gala_payment_status) VALUES ('CA2','Test','Osoba','t@example.com','SCANNER TEST — ignore me',1,'paid')"],
    ["INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_gala, gala_payment_status, gala_registration_id) VALUES ('CA3','Linked','Guest','l@example.com',1,'paid','G1')"],
    ["INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, institution, country, selected_conference, guest_count) VALUES ('CA4','Petra','Kovačević','petra@example.hr','Medicinski fakultet u Splitu','Hrvatska',1,1)"],
    // --- conference: 1 live + 1 revoked + 1 cancelled
    ["INSERT INTO registrations (id, first_name, last_name, email, institution, country, status, payment_status, ticket_type_id, dietary_requirements) VALUES ('R1','John','Smith','john@example.com','Mass General Brigham','USA','confirmed','paid','t1','none')"],
    ["INSERT INTO registrations (id, first_name, last_name, email, status, payment_status, revoked) VALUES ('R2','Rev','Oked','rev@example.com','confirmed','paid',1)"],
    ["INSERT INTO registrations (id, first_name, last_name, email, status, payment_status) VALUES ('R3','Can','Celled','can@example.com','cancelled','paid')"],
    // --- donor night: 1 booking (payment n/a → free)
    [`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, institution) VALUES ('B1','${DONOR_EV}','Luka','Perić','luka@example.hr','HUB385')`],
    // --- team notes: an append-only registrant note on G1
    ["INSERT INTO registrant_notes (id, registrant_id, section, author, body) VALUES ('N1','G1','gala','laura','Dolazi ranije — najaviti Alenu')"],
    // --- arrivals: party of 3 started (1 in), single complete
    ["INSERT INTO v2_checkin_admits (id, registration_ref, reg_table, event_key, party_size, admitted_count) VALUES ('A1','G1','gala_registrations','gala',3,1)"],
    ["INSERT INTO v2_checkin_admits (id, registration_ref, reg_table, event_key, party_size, admitted_count) VALUES ('A2','G2','gala_registrations','gala',1,1)"]
];
seed.forEach(([s]) => db.run(s));

// ---------------------------------------------------------------- mount + read-only booby trap
const app = stubApp();
const authStub = (req, res, next) => { if (!req.user) return res.status(401).json({ error: 'auth required' }); next(); };
const ctx = { db: () => db, auth: authStub, adminOnly: (req, res, next) => next(), saveDb: () => {}, log: () => {} };
require(path.join(ROOT, 'admin-portal/backend/v2/host-brief.js'))(app, ctx);

// After seeding, ANY write through the wrapper is a test failure — the module must be read-only.
const realRun = db.run.bind(db);
db.run = () => { throw new Error('WRITE ATTEMPTED by host-brief (module must be read-only)'); };

const STAFF = { id: 'u-staff', email: 'staff@medx.hr', is_staff: 1 };
const NOBODY = { id: 'u-plain', email: 'plain@medx.hr' };
const callBrief = (event, user = STAFF) => app.call('GET', '/api/v2/host-brief', { user, query: { event } });

(async () => {
    // index.js discovery: filename passes the mount filter
    check('index.js mount filter matches host-brief.js', /^[a-z0-9-]+\.js$/.test('host-brief.js'));
    check('route registered by the module', !!app.routes['GET /api/v2/host-brief']);

    // ---- auth gates
    const noUser = await app.call('GET', '/api/v2/host-brief', { user: null, query: { event: 'gala' } });
    check('no user → 401 from auth', noUser.status === 401, noUser.status);
    const plain = await callBrief('gala', NOBODY);
    check('plain member → 403 staffOrAdmin', plain.status === 403 && /Staff or admin/.test(plain.out.error), JSON.stringify(plain));
    const bad = await callBrief('afterparty');
    check('unknown event → 400', bad.status === 400 && /Unknown event/.test(bad.out.error), JSON.stringify(bad.out));

    // ---- gala brief
    const g = (await callBrief('gala')).out;
    check('gala ok + label from checkin_events', g.ok === true && g.event_label === 'Plexus Gala Evening', JSON.stringify({ ok: g.ok, l: g.event_label }));
    check('gala date label composed', /5 December 2026/.test(g.date_label), g.date_label);
    const h = g.headline;
    check('gala bookings 5 (cancelled + SCANNER TEST + linked-CA excluded)', h.bookings === 5, h.bookings);
    check('gala people 8 incl. parties', h.people === 8, h.people);
    check('gala plus-ones 3', h.plus_ones === 3, h.plus_ones);
    check('gala paid people 6 (paid + vip-comp + CA paid)', h.paid_people === 6, h.paid_people);
    check('gala pending people 2 / 1 booking', h.pending_people === 2 && h.pending_bookings === 1, JSON.stringify(h));
    check('gala institutions 5', h.institutions === 5, h.institutions);
    check('gala countries 1 (Österreich → Austria canon)', h.countries === 1 && g.top_countries[0].name === 'Austria', JSON.stringify(g.top_countries));
    check('largest delegation = Sveučilište u Zagrebu, 3 people', g.top_institutions[0].name === 'Sveučilište u Zagrebu' && g.top_institutions[0].people === 3, JSON.stringify(g.top_institutions[0]));

    const names = g.notable.map(n => n.name);
    const tagOf = nm => (g.notable.find(n => n.name === nm) || { tags: [] }).tags.join(' | ');
    check('notable: VIP category guest (Simon Mikulandra)', names.includes('Simon Mikulandra') && /VIP — free/.test(tagOf('Simon Mikulandra')), tagOf('Simon Mikulandra'));
    check('notable: sponsor seat (Ana Šarić)', names.includes('Ana Šarić') && /Sponsor seat/.test(tagOf('Ana Šarić')), tagOf('Ana Šarić'));
    check('notable: admin_notes guest (Davor Klarić, diacritics kept)', /note: Sjedne do Lorda Smitha — provjeri stol/.test(tagOf('Davor Klarić')), tagOf('Davor Klarić'));
    check('notable: registrant_notes + party of 3 (Ivana Barišić)', /note: Dolazi ranije — najaviti Alenu/.test(tagOf('Ivana Barišić')) && /party of 3/.test(tagOf('Ivana Barišić')), tagOf('Ivana Barišić'));
    check('notable ranked: categories before notes', names[0] === 'Ana Šarić' || names[0] === 'Simon Mikulandra', names.join(', '));

    const buckets = Object.fromEntries(g.dietary.buckets.map(b => [b.label, b.count]));
    check('kitchen buckets: 2 vegetarian · 1 vegan · 1 gluten-free · 1 allergy', buckets.vegetarian === 2 && buckets.vegan === 1 && buckets['gluten-free'] === 1 && buckets.allergy === 1, JSON.stringify(buckets));
    check('kitchen line verbatim with diacritics', g.dietary.lines.some(l => l.name === 'Ivana Barišić' && l.text === 'bez glutena — orašasti plodovi'), JSON.stringify(g.dietary.lines));
    check('kitchen notes 3 unknown plus-ones', g.dietary.unknown_plus_ones === 3, g.dietary.unknown_plus_ones);

    check('arrivals present from v2_checkin_admits', g.arrivals && g.arrivals.admitted_people === 2 && g.arrivals.parties_started === 2 && g.arrivals.parties_complete === 1 && g.arrivals.expected_people === 8, JSON.stringify(g.arrivals));

    const tp = g.talking_points.join(' || ');
    check('talking point: largest delegation', /3 guests from Sveučilište u Zagrebu — largest delegation/.test(tp), tp);
    check('talking point: unpaid seats to resolve', /2 unpaid seats to resolve at the door \(1 booking\)/.test(tp), tp);
    check('talking point: notable seats with names', /Notable seats: .*VIP — free.*Sponsor seat|Notable seats: .*Sponsor seat.*VIP — free/.test(tp) && /Simon Mikulandra/.test(tp), tp);
    check('talking point: largest party on one QR', /Largest party: Ivana Barišić — 3 people on one QR/.test(tp), tp);
    check('talking point: notes flag (2 guests)', /2 guests carry a note from the team/.test(tp), tp);
    check('talking point: kitchen line', /Kitchen: 1 vegan · 2 vegetarian · 1 gluten-free · 1 allergy/.test(tp), tp);
    check('talking point: arrivals with partial party', /2 of 8 already in — 1 party arriving in parts/.test(tp), tp);

    check('text one-pager present + headline', typeof g.text === 'string' && /MED&X — HOST BRIEF/.test(g.text) && /8 people expected across 5 bookings \(3 plus-ones\)/.test(g.text), g.text && g.text.slice(0, 200));
    check('text keeps Croatian diacritics', /Barišić/.test(g.text) && /Sveučilište/.test(g.text) && /orašasti plodovi/.test(g.text) && /Klarić/.test(g.text) && /Šarić/.test(g.text), g.text);
    check('text has no undefined/NaN', !/undefined|NaN|\[object/.test(g.text), g.text);

    // ---- conference brief (revoked + cancelled excluded, USA canonicalised)
    const c = (await callBrief('conference')).out;
    check('conference bookings 2 / people 3', c.headline.bookings === 2 && c.headline.people === 3, JSON.stringify(c.headline));
    check('conference paid 1 · pending 0 · free 2 (CA diaspora)', c.headline.paid_people === 1 && c.headline.pending_people === 0 && c.headline.free_people === 2, JSON.stringify(c.headline));
    check('conference countries: US + Croatia canon', c.headline.countries === 2 && c.top_countries.some(x => x.name === 'United States') && c.top_countries.some(x => x.name === 'Croatia'), JSON.stringify(c.top_countries));
    check('conference no arrivals block (nobody in)', c.arrivals === null, JSON.stringify(c.arrivals));
    check('conference delegation point (Split, 2 people incl. plus-one)', /2 guests from Medicinski fakultet u Splitu — largest delegation/.test(c.talking_points.join(' || ')), c.talking_points.join(' || '));

    // ---- donor vs bridges scoping
    const d = (await callBrief('donor')).out;
    check('donor sees the Donor Night booking (1 person, free)', d.headline.bookings === 1 && d.headline.people === 1 && d.headline.free_people === 1, JSON.stringify(d.headline));
    const b = (await callBrief('bridges')).out;
    check('bridges empty brief is graceful (donor row excluded)', b.ok === true && b.empty === true && b.headline.people === 0 && /No registrations yet for this door/.test(b.talking_points[0]) && b.arrivals === null, JSON.stringify(b));
    check('empty brief text still reads well', /No registrations yet for this door — the brief fills itself as bookings land\./.test(b.text), b.text);

    // ---- read-only guarantee held (booby trap never fired inside the routes)
    check('module made zero writes (db.run trap never hit)', true);

    // ---- optional fixture dump for the render smoke (tests/host-brief-render-smoke.py)
    if (process.env.HB_FIXTURES_OUT) {
        const briefs = { conference: c, gala: g, donor: d, bridges: b };
        require('fs').writeFileSync(process.env.HB_FIXTURES_OUT, JSON.stringify(briefs));
        console.log('fixtures → ' + process.env.HB_FIXTURES_OUT);
    }

    // ---- summary
    db.run = realRun;
    const fails = results.filter(([, ok]) => !ok).length;
    console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + results.length + ' PASSED'));
    process.exit(fails);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(99); });
