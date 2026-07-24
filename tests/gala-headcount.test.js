/**
 * gala-headcount.test.js — plus-one guests are counted in Gala attendee/head-count totals.
 *
 * The bug: 3 people booked the Gala, one brought a plus-one → 4 people in the room, but the
 * admin surfaces (check-in "expected", catering head count, seating) showed 3 because they used
 * COUNT(*) (bookings) instead of SUM(1 + guest_count) (people). Revenue was already correct
 * (a plus-one is paid for inside the booking's amount), and the number of BOOKINGS must stay 3.
 *
 * This test boots the admin portal in NODE_ENV=test against a throwaway SQLite file (never
 * Turso/prod), seeds 3 paid gala bookings — one with guest_count=1 — directly via a second
 * libsql connection (same style as tests/gala-picker-sync.test.js), and asserts:
 *
 *   - /api/checkin/stats  → gala PEOPLE total rises by 4, bookings by 3 (delta, prod-seed-safe)
 *   - checking in the +1 booking admits 2 people on its one QR (numerator = SUM(1+guest_count))
 *   - /api/gala/registrations still returns 3 rows and €300 (bookings + revenue unchanged)
 *   - /api/dashboard/trends → the 3 fresh Gala bookings show up in the combined `events` series
 *     (previously the 30-day chart only drew conference + accelerator, so Gala was invisible)
 *
 * Run: node tests/gala-headcount.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Boot BOTH portals against one shared SQLite file: /api/checkin/stats reads columns the USER
// portal adds to croatians_abroad_registrations (selected_conference, *_checked_in), so an
// admin-only boot would 500 on a missing column. In production both portals share the DB.
const USER = 'http://localhost:3250';
const ADMIN = 'http://localhost:3251';

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

const todayUtc = () => new Date().toISOString().split('T')[0];

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-headcount-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '',
        JWT_SECRET: 'gala-headcount-test-secret',
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
        boot('user-portal/backend', 3250);
        await waitUp(USER);
        boot('admin-portal/backend', 3251);
        await waitUp(ADMIN);

        // --- admin login ---
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', r.status === 200 && !!atok, JSON.stringify(r.d).slice(0, 120));

        // --- baselines (prod-seed-safe: assert on deltas, not absolutes) ---
        const stats0 = (await api(ADMIN, '/api/checkin/stats', { token: atok })).d || {};
        const gala0 = stats0.gala || { total: 0, checked_in: 0, bookings: 0 };
        const trends0 = (await api(ADMIN, '/api/dashboard/trends?event=all', { token: atok })).d || {};
        const evTotal0 = (trends0.events || []).reduce((s, x) => s + (Number(x.count) || 0), 0);
        const regs0 = (await api(ADMIN, '/api/gala/registrations', { token: atok })).d;
        const bookings0 = Array.isArray(regs0) ? regs0.length : 0;
        check('baseline: /api/checkin/stats returns a gala block with a people total field', typeof gala0.total === 'number', JSON.stringify(gala0));
        check('baseline: /api/dashboard/trends now exposes an events series', Array.isArray(trends0.events), JSON.stringify(Object.keys(trends0)));

        // --- seed 3 PAID bookings, one with a plus-one, directly on the same SQLite file ---
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const now = "strftime('%Y-%m-%d %H:%M:%S','now')";
        const seed = (id, fn, email, guests, amt) => tdb.exec(
            `INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, amount_paid, guest_count, checked_in, created_at)
             VALUES ('${id}', '${fn}', 'Headcount', '${email}', 'QA', 'confirmed', 'paid', ${amt}, ${guests}, 0, ${now})`
        );
        seed('hc-plusone', 'Ana', 'qa.robot+hc1@example.com', 1, 100);  // brings 1 guest → 2 people
        seed('hc-solo-1', 'Boris', 'qa.robot+hc2@example.com', 0, 100); // 1 person
        seed('hc-solo-2', 'Cvita', 'qa.robot+hc3@example.com', 0, 100); // 1 person
        tdb.close();
        // 3 bookings, 4 people, €300 collected.

        // --- (1) check-in EXPECTED denominator is people, not bookings ---
        let stats = (await api(ADMIN, '/api/checkin/stats', { token: atok })).d || {};
        let gala = stats.gala || {};
        check('checkin/stats: expected head count rose by 4 people (not 3 bookings)', gala.total - gala0.total === 4, `${gala0.total} -> ${gala.total}`);
        check('checkin/stats: bookings count rose by exactly 3', (gala.bookings || 0) - (gala0.bookings || 0) === 3, `${gala0.bookings} -> ${gala.bookings}`);
        check('checkin/stats: nobody checked in yet → checked_in delta 0', gala.checked_in - gala0.checked_in === 0, `${gala0.checked_in} -> ${gala.checked_in}`);

        // --- (2) checking in the +1 booking admits 2 people on the one QR ---
        const tdb2 = new Database(dbPath);
        tdb2.exec("UPDATE gala_registrations SET checked_in = 1, checked_in_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = 'hc-plusone'");
        tdb2.close();
        stats = (await api(ADMIN, '/api/checkin/stats', { token: atok })).d || {};
        gala = stats.gala || {};
        check('checkin/stats: checking in the +1 booking admits 2 people (host + guest)', gala.checked_in - gala0.checked_in === 2, `${gala0.checked_in} -> ${gala.checked_in}`);
        check('checkin/stats: expected head count unchanged at +4 after check-in', gala.total - gala0.total === 4, `${gala0.total} -> ${gala.total}`);

        // --- (3) bookings count + revenue are unchanged (a plus-one is not a new booking / not new money) ---
        const regs = (await api(ADMIN, '/api/gala/registrations', { token: atok })).d;
        const mine = (Array.isArray(regs) ? regs : []).filter(x => ['hc-plusone', 'hc-solo-1', 'hc-solo-2'].includes(x.id));
        check('gala/registrations: exactly 3 booking rows exist (bookings unchanged)', mine.length === 3 && (Array.isArray(regs) ? regs.length : 0) - bookings0 === 3, `n=${mine.length}`);
        const revenue = mine.reduce((s, x) => s + (Number(x.amount_paid) || 0), 0);
        check('gala/registrations: revenue is €300 — per booking, NOT inflated by the guest', revenue === 300, `€${revenue}`);
        const guestSum = mine.reduce((s, x) => s + (Number(x.guest_count) || 0), 0);
        check('gala/registrations: guest_count is stored and totals 1 plus-one', guestSum === 1, `guests=${guestSum}`);

        // --- (5) FIX 2: the Gala "Paid" tile now reads PEOPLE (SUM 1+guest_count) over the paid rows,
        //     not bookings. 3 paid bookings, one with a +1 → the owner reads 4; revenue stays €300 and
        //     the booking count stays visible. This mirrors GalaAdmin.updateStats() exactly. ---
        const paidRows = (Array.isArray(regs) ? regs : []).filter(x => x.payment_status === 'paid' && ['hc-plusone', 'hc-solo-1', 'hc-solo-2'].includes(x.id));
        const paidPeople = paidRows.reduce((s, x) => s + 1 + (Number(x.guest_count) || 0), 0);
        const paidBookings = paidRows.length;
        const paidRevenue = paidRows.reduce((s, x) => s + (Number(x.amount_paid) || 0), 0);
        check('paid tile: PEOPLE = SUM(1+guest_count) over paid rows = 4 (owner sees 4, not 3)', paidPeople === 4, `people=${paidPeople}`);
        check('paid tile: bookings still countable as 3 (reservations sub-note)', paidBookings === 3, `bookings=${paidBookings}`);
        check('paid tile: revenue unchanged at €300 (a plus-one is not new money)', paidRevenue === 300, `€${paidRevenue}`);
        // Source-level wiring: the tile is fed by paidPeople and relabelled — not the old bookings count.
        const galaSrc = fs.readFileSync(path.join(ROOT, 'admin-portal/frontend/index.html'), 'utf8');
        check('frontend: paid tile computes paidPeople as SUM(1+guest_count) over paid rows',
            galaSrc.includes('const paidPeople = paidOnly.reduce((s, r) => s + 1 + (Number(r.guest_count) || 0), 0)'));
        check('frontend: galaStatPaidOnly tile is assigned paidPeople (people), not paidCount (bookings)',
            galaSrc.includes('if (paidOnlyEl) paidOnlyEl.textContent = paidPeople;'));
        check('frontend: paid tile relabelled to people with a reservations sub-note',
            galaSrc.includes('galaStatPaidBookings') && galaSrc.includes('Paid people'));

        // --- (4) the fresh Gala bookings appear in the 30-day registration trends (combined events series) ---
        const trends = (await api(ADMIN, '/api/dashboard/trends?event=all', { token: atok })).d || {};
        const evTotal = (trends.events || []).reduce((s, x) => s + (Number(x.count) || 0), 0);
        const todayRow = (trends.events || []).find(x => x.date === todayUtc());
        check('trends: combined events series grew by the 3 Gala bookings', evTotal - evTotal0 === 3, `${evTotal0} -> ${evTotal}`);
        check("trends: today's date carries the Gala bookings in the events series", !!todayRow && (todayRow.count || 0) >= 3, JSON.stringify(todayRow));
        check('trends: Gala did NOT leak into the conference (plexus) series', (trends.plexus || []).reduce((s, x) => s + (Number(x.count) || 0), 0) === (trends0.plexus || []).reduce((s, x) => s + (Number(x.count) || 0), 0));
        const trendsEv = (await api(ADMIN, '/api/dashboard/trends?event=events', { token: atok })).d || {};
        check('trends: ?event=events filter returns the same combined series', (trendsEv.events || []).reduce((s, x) => s + (Number(x.count) || 0), 0) - evTotal0 === 3, JSON.stringify((trendsEv.events || []).slice(-2)));

    } catch (err) {
        check('test harness ran without throwing', false, err && err.message);
        procs.forEach((p, i) => { if (p && p._errbuf && p._errbuf()) console.error(`portal[${i}] stderr tail:\n` + p._errbuf()); });
    }

    const failed = results.filter(([, ok]) => !ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed.`);
    cleanup();
    process.exit(failed.length ? 1 : 0);
})();
