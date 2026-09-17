/**
 * bridges-home-count.test.js — the Bridges hub counts the home (Zagreb) edition's guests.
 *
 * The bug: GET /api/v2/bridges/hub counted `bridges_registrations` per event only, so the home
 * edition (bridges_events.slug = 'building-bridges') read 0 sign-ups — its guests register through
 * the Plexus Week / Croatians-abroad form and live in croatians_abroad_registrations
 * (selected_bridges = 1, bridges_status pre-registered|confirmed, bridges_checked_in). Every other
 * city (Boston!) is counted from bridges_registrations exactly as before.
 *
 * This test boots the ADMIN portal in NODE_ENV=test against a throwaway SQLite file (never
 * Turso/prod). The admin server creates croatians_abroad_registrations itself and heals the
 * bridges_checked_in column at the end of init, so the user portal is not needed. It seeds two
 * bridges_events rows (the home edition + a control city), then diaspora rows directly on the same
 * file, and asserts on DELTAS (prod-seed-safe). Login is vp@medx.hr: the boot resets the founder's password.
 *
 *   - 3 diaspora people who ticked Bridges (two pre-registered, one confirmed; one of them checked
 *     in; one duplicate email in a different case) → home registration_count +3, checked_in_count +1
 *   - a cancelled and a pending-review diaspora row, and one with selected_bridges = 0, add nothing
 *   - a bridges_registrations row for the home event whose email matches a diaspora row (other case)
 *     does not double-count that person; a fresh email does add one
 *   - the control city sees none of the diaspora rows and counts its own bridges_registrations rows
 *   - the per-event payload keys are unchanged (registration_count · checked_in_count · speakers_count …)
 *
 * Run: node tests/bridges-home-count.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN = 'http://localhost:3271';

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
};

const api = async (base, p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let d = null;
    try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
};

const waitUp = async (base, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('server at ' + base + ' did not come up');
};

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-bridges-home-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '',
        JWT_SECRET: 'bridges-home-count-test-secret',
        NODE_ENV: 'test',
    };
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errbuf = '';
        p.stderr.on('data', (d) => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        p._errbuf = () => errbuf;
        procs.push(p);
        return p;
    };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('admin-portal/backend', 3271);
        await waitUp(ADMIN);

        // --- admin login — vp@medx.hr, not the founder: the boot's one-time founder unlock resets
        //     juginovic.alen@gmail.com to a temp password on every fresh database (see announcements.test.js) ---
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'vp@medx.hr', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', r.status === 200 && !!atok, JSON.stringify(r.d && r.d.error));

        // --- the two events: the home edition (slug 'building-bridges' — reuse one if the boot seeded it) + a control city ---
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const existingHome = tdb.prepare("SELECT id FROM bridges_events WHERE slug = 'building-bridges'").get();
        const HOME = existingHome ? existingHome.id : 'bb-home-test';
        const OTHER = 'bb-other-test';
        if (!existingHome) {
            tdb.exec(`INSERT INTO bridges_events (id, name, city, event_date, status, slug) VALUES ('${HOME}', 'Building Bridges in Biomedicine Croatia', 'Zagreb', '', 'upcoming', 'building-bridges')`);
        }
        tdb.exec(`INSERT INTO bridges_events (id, name, city, event_date, status) VALUES ('${OTHER}', 'Building Bridges: Testville', 'Testville', '2031-01-01', 'upcoming')`);
        tdb.close();

        const hub = async () => {
            const res = await api(ADMIN, '/api/v2/bridges/hub', { token: atok });
            const events = (res.d && res.d.events) || [];
            return { status: res.status, ok: !!(res.d && res.d.ok), events, home: events.find(e => e.id === HOME) || null, other: events.find(e => e.id === OTHER) || null };
        };

        // --- baseline ---
        const h0 = await hub();
        check('baseline: GET /api/v2/bridges/hub answers ok with an events array', h0.status === 200 && h0.ok && Array.isArray(h0.events), `status=${h0.status} n=${h0.events.length}`);
        check('baseline: the home edition and the control city are both in the payload', !!h0.home && !!h0.other, JSON.stringify({ home: !!h0.home, other: !!h0.other }));
        const home0 = h0.home || { registration_count: 0, checked_in_count: 0 };
        const other0 = h0.other || { registration_count: 0, checked_in_count: 0 };
        const keys0 = h0.home ? Object.keys(h0.home).sort() : [];
        check('baseline: per-event shape carries registration_count and checked_in_count as numbers',
            typeof home0.registration_count === 'number' && typeof home0.checked_in_count === 'number', JSON.stringify({ r: home0.registration_count, c: home0.checked_in_count }));

        // --- seed the diaspora rows directly on the same SQLite file ---
        const tdb2 = new Database(dbPath);
        const ca = (id, first, email, status, checkedIn, selected = 1) => tdb2.exec(
            `INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_bridges, bridges_status, bridges_checked_in, created_at)
             VALUES ('${id}', '${first}', 'HomeCount', '${email}', ${selected}, ${status === null ? 'NULL' : "'" + status + "'"}, ${checkedIn}, strftime('%Y-%m-%d %H:%M:%S','now'))`
        );
        ca('hc-ana',    'Ana',    'qa.robot+bbhome1@example.com', 'pre-registered', 1);   // counts · checked in
        ca('hc-boris',  'Boris',  'qa.robot+bbhome2@example.com', 'pre-registered', 0);   // counts
        ca('hc-cvita',  'Cvita',  'qa.robot+bbhome3@example.com', 'confirmed',      0);   // counts
        ca('hc-ana-2',  'Ana',    'QA.Robot+BBHome1@Example.com', 'pre-registered', 0);   // duplicate of Ana, other case → not a new person
        ca('hc-cancel', 'Dario',  'qa.robot+bbhome4@example.com', 'cancelled',      0);   // never counts
        ca('hc-review', 'Ema',    'qa.robot+bbhome5@example.com', 'pending-review', 0);   // never counts
        ca('hc-noflag', 'Filip',  'qa.robot+bbhome6@example.com', 'confirmed',      1, 0); // did not tick Bridges → never counts
        tdb2.close();

        // --- (1) the home edition rises by 3 distinct people / 1 checked in; the control city does not move ---
        const h1 = await hub();
        check('home: registration_count rose by exactly 3 distinct people (case-duplicate + cancelled + pending-review + unticked ignored)',
            h1.home && h1.home.registration_count - home0.registration_count === 3, `${home0.registration_count} -> ${h1.home && h1.home.registration_count}`);
        check('home: checked_in_count rose by exactly 1', h1.home && h1.home.checked_in_count - home0.checked_in_count === 1, `${home0.checked_in_count} -> ${h1.home && h1.home.checked_in_count}`);
        check('control city: diaspora rows did not leak into another event (registration_count unchanged)',
            h1.other && h1.other.registration_count === other0.registration_count && h1.other.checked_in_count === other0.checked_in_count,
            `${other0.registration_count}/${other0.checked_in_count} -> ${h1.other && h1.other.registration_count}/${h1.other && h1.other.checked_in_count}`);

        // --- (2) cross-table dedupe: a bridges_registrations row for the HOME event with Cvita's email (other case)
        //         is the same person; a fresh email is a new one. The control city counts its own rows as before. ---
        const tdb3 = new Database(dbPath);
        const br = (id, eventId, first, email, checkedIn) => tdb3.exec(
            `INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status, checked_in)
             VALUES ('${id}', '${eventId}', '${first}', 'HomeCount', '${email}', 'registered', ${checkedIn})`
        );
        br('hc-br-cvita', HOME,  'Cvita', 'QA.ROBOT+BBHOME3@EXAMPLE.COM', 1);   // same person as hc-cvita → +0 registered, +1 checked in (she is not checked in on the diaspora side)
        br('hc-br-goran', HOME,  'Goran', 'qa.robot+bbhome7@example.com', 0);   // new person → +1
        br('hc-br-other', OTHER, 'Hana',  'qa.robot+bbhome8@example.com', 1);   // control city → its own +1 / +1
        tdb3.close();

        const h2 = await hub();
        check('home: a bridges_registrations row with a diaspora email (other case) counts once — total now +4, not +5',
            h2.home && h2.home.registration_count - home0.registration_count === 4, `${home0.registration_count} -> ${h2.home && h2.home.registration_count}`);
        check('home: checked_in_count now +2 (Ana on the diaspora side, Cvita on the bridges side)',
            h2.home && h2.home.checked_in_count - home0.checked_in_count === 2, `${home0.checked_in_count} -> ${h2.home && h2.home.checked_in_count}`);
        check('control city: counts its own bridges_registrations row exactly as before (+1 registered, +1 checked in)',
            h2.other && h2.other.registration_count - other0.registration_count === 1 && h2.other.checked_in_count - other0.checked_in_count === 1,
            `${other0.registration_count}/${other0.checked_in_count} -> ${h2.other && h2.other.registration_count}/${h2.other && h2.other.checked_in_count}`);

        // --- (3) shape: the per-event keys the view consumes did not change ---
        const keys2 = h2.home ? Object.keys(h2.home).sort() : [];
        check('shape: per-event keys unchanged between reads', keys0.length > 0 && JSON.stringify(keys0) === JSON.stringify(keys2), keys2.join(','));
        const expectedKeys = ['id', 'name', 'city', 'venue_name', 'venue_address', 'event_date', 'event_time', 'end_time', 'description', 'capacity', 'registration_open',
            'registration_deadline', 'status', 'is_published', 'notes', 'price', 'registration_count', 'checked_in_count', 'speakers_count', 'invitation_queued', 'reminder_queued', 'thankyou_queued'].sort();
        check('shape: per-event keys are exactly the ones bridges.js reads', JSON.stringify(keys2) === JSON.stringify(expectedKeys), keys2.filter(k => !expectedKeys.includes(k)).concat(expectedKeys.filter(k => !keys2.includes(k))).join(',') || 'same set');

        // --- (4) source-level wiring: the hub resolves the home edition the way event-day.js does ---
        const src = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/v2/bridges-ops.js'), 'utf8');
        check('source: bridges-ops.js resolves the home edition by slug = building-bridges (same rule as event-day.js homeBridgesId)',
            src.includes(`SELECT id FROM bridges_events WHERE slug = 'building-bridges'`));
        check('source: home count reads croatians_abroad_registrations as COUNT(DISTINCT lower(email)) with the pre-registered|confirmed filter',
            /COUNT\(DISTINCT lower\(email\)\) AS c FROM croatians_abroad_registrations\s+WHERE selected_bridges = 1 AND bridges_status IN \('pre-registered','confirmed'\)/.test(src));
    } catch (err) {
        check('test harness ran without throwing', false, err && err.message);
        procs.forEach((p, i) => { if (p && p._errbuf && p._errbuf()) console.error(`portal[${i}] stderr tail:\n` + p._errbuf()); });
    }

    const failed = results.filter(([, ok]) => !ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed.`);
    cleanup();
    process.exit(failed.length ? 1 : 0);
})();
