/**
 * gala-buckets.test.js — the gala "not paid yet" vocabulary (admin audit 2026-09-17, item A).
 *
 * The bug: every admin surface counted every active gala row with payment_status != 'paid' as
 * "unpaid / TO CHASE" — four different real states under one word, PLUS the abandoned first
 * attempts of guests who then paid under the same email (9 of 19 "unpaid" rows in prod). The
 * outstanding € was a phantom built on those rows.
 *
 * The fix (backend/v2/gala-ops.js GALA_BUCKETS + bucketGalaRows, reused by v2/registrations.js
 * and v2/people.js): rows are bucketed by their real state —
 *   link_sent           approved (payment link in the guest's hands)
 *   checkout_abandoned  awaiting_payment WITH a stripe_session_id
 *   no_link_yet         awaiting_payment WITHOUT one
 *   held                pending-review (never chased, never owed)
 *   paid_twins          unpaid row whose lowercased email also has an ACTIVE PAID row
 * chase = link_sent + checkout_abandoned + no_link_yet · outstanding € = (link_sent +
 * checkout_abandoned) seats × the price by the clock.
 *
 * Boots BOTH portals in NODE_ENV=test against a throwaway SQLite file (never Turso/prod — the
 * same recipe as tests/gala-headcount.test.js: the user portal adds the croatians_abroad
 * columns the registrations union reads), seeds one row per state directly via libsql, and
 * asserts DELTAS (baseline first — the scratch DB may carry seed rows) on:
 *   - GET /api/v2/gala-ops/summary      buckets · seats.chase · bookings.chase · eur.outstanding · states
 *   - GET /api/v2/registrations/all     stats.gala_buckets · stats.gala_unpaid · per-row gala_state + SEAT fact
 *   - GET /api/v2/money/summary         gala.unpaid_count = owed seats · open_seats = chase seats (shared block)
 *   - GET /api/v2/people/directory      gala tags speak the bucket ('GALA — CHECKOUT NOT COMPLETED' …,
 *                                       a paid guest's twin never surfaces) + audit item C: live
 *                                       conference / bridges legs of croatians_abroad_registrations
 *                                       earn PLEXUS / BRIDGES ZAGREB (REGISTRANTS, never BOSTON)
 *
 * Run: node tests/gala-buckets.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3260';
const ADMIN = 'http://localhost:3261';

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 220) : ''));
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

// The six seeded rows + one cancelled control. Emails are unique to this test; the twin's email
// is the paid guest's in UPPER case so the lowercased-email rule is what makes it a twin.
const SEEDS = [
    //  id            first     email                          status             pay        stripe     token    guests  amount
    ['gb-paid',      'Paid',    'qa.robot+gb1@example.com',    'confirmed',       'paid',    'cs_gb1',  null,    1,      150],
    ['gb-twin',      'Twin',    'QA.ROBOT+GB1@EXAMPLE.COM',    'awaiting_payment','pending', 'cs_gb2',  null,    0,      null],
    ['gb-abandon',   'Abandon', 'qa.robot+gb3@example.com',    'awaiting_payment','pending', 'cs_gb3',  null,    2,      null],
    ['gb-nolink',    'NoLink',  'qa.robot+gb4@example.com',    'awaiting_payment','pending', null,      null,    0,      null],
    ['gb-link',      'Link',    'qa.robot+gb5@example.com',    'approved',        'pending', null,      'tokgb5', 1,     null],
    ['gb-held',      'Held',    'qa.robot+gb6@example.com',    'pending-review',  'pending', null,      null,    1,      null],
    ['gb-cancelled', 'Gone',    'qa.robot+gb7@example.com',    'cancelled',       'pending', 'cs_gb7',  null,    0,      null]
];
const IDS = SEEDS.map(s => s[0]);
const EXPECT = {                      // rows / seats added per bucket by the seeds above
    link_sent: { rows: 1, seats: 2 }, checkout_abandoned: { rows: 1, seats: 3 }, no_link_yet: { rows: 1, seats: 1 },
    held: { rows: 1, seats: 2 }, paid_twins: { rows: 1, seats: 1 }
};
const CHASE_SEATS = 2 + 3 + 1;        // link_sent + checkout_abandoned + no_link_yet
const OWED_SEATS = 2 + 3;             // link_sent + checkout_abandoned
const RESERVED_SEATS = 2 + 1 + 3 + 1 + 2 + 2;   // every active row incl. the twin and the held row

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-gala-buckets-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '',
        JWT_SECRET: 'gala-buckets-test-secret',
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

    const bucketDelta = (after, before, k, f) => (Number(((after || {})[k] || {})[f]) || 0) - (Number(((before || {})[k] || {})[f]) || 0);

    try {
        boot('user-portal/backend', 3260);
        await waitUp(USER);
        boot('admin-portal/backend', 3261);
        await waitUp(ADMIN);

        // --- admin login: vp@medx.hr, not the founder — the boot's one-time founder unlock resets
        //     juginovic.alen@gmail.com to a temp password on a fresh DB (announcements.test.js does the same) ---
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'vp@medx.hr', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', r.status === 200 && !!atok, JSON.stringify(r.d).slice(0, 120));

        // --- baselines (delta style — the scratch DB may carry seed rows) ---
        const sum0 = (await api(ADMIN, '/api/v2/gala-ops/summary', { token: atok })).d || {};
        const regs0 = (await api(ADMIN, '/api/v2/registrations/all?event=gala&limit=1', { token: atok })).d || {};
        const money0 = (await api(ADMIN, '/api/v2/money/summary', { token: atok })).d || {};
        check('baseline: /summary carries buckets + states', sum0.buckets && typeof sum0.buckets === 'object' && sum0.states && typeof sum0.states === 'object', JSON.stringify(Object.keys(sum0)));
        check('baseline: /summary buckets name all five states', ['link_sent', 'checkout_abandoned', 'no_link_yet', 'held', 'paid_twins'].every(k => sum0.buckets && sum0.buckets[k]), JSON.stringify(Object.keys(sum0.buckets || {})));
        check('baseline: /registrations/all stats carries gala_buckets', regs0.stats && regs0.stats.gala_buckets && typeof regs0.stats.gala_buckets === 'object', JSON.stringify(Object.keys((regs0.stats || {}))));
        const price = Number(sum0.price && sum0.price.current) || 0;
        check('baseline: /summary states a current price', price > 0, `price=${price}`);

        // --- seed one row per state on the same SQLite file ---
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const q = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
        for (const [id, fn, email, status, pay, stripe, token, guests, amount] of SEEDS) {
            tdb.exec(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, stripe_session_id, pay_token, amount_paid, guest_count, checked_in, created_at)
                      VALUES (${q(id)}, ${q(fn)}, 'Bucket', ${q(email)}, 'QA', ${q(status)}, ${q(pay)}, ${q(stripe)}, ${q(token)}, ${amount == null ? 'NULL' : amount}, ${guests}, 0, strftime('%Y-%m-%d %H:%M:%S','now'))`);
        }
        // Public-form rows for the People directory (audit item C): two live legs, one held, one
        // cancelled, one that selected nothing live — only the first two may earn a tag.
        const caSeed = (id, email, sc, cs, sb, bs) => tdb.exec(
            `INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, institution, selected_conference, conference_status, selected_bridges, bridges_status, selected_gala, source, created_at)
             VALUES (${q(id)}, 'Form', 'Leg', ${q(email)}, 'QA', ${sc}, ${q(cs)}, ${sb}, ${q(bs)}, 0, 'plexus', strftime('%Y-%m-%d %H:%M:%S','now'))`);
        caSeed('gb-ca-both', 'qa.robot+gbca1@example.com', 1, 'pre-registered', 1, 'confirmed');     // PLEXUS + BRIDGES ZAGREB
        caSeed('gb-ca-conf', 'qa.robot+gbca2@example.com', 1, 'confirmed', 0, null);                // PLEXUS only
        caSeed('gb-ca-held', 'qa.robot+gbca3@example.com', 1, 'pending-review', 1, 'pending-review'); // nothing (held)
        caSeed('gb-ca-gone', 'qa.robot+gbca4@example.com', 1, 'cancelled', 1, 'cancelled');         // nothing (cancelled)
        tdb.close();

        // --- (1) the canonical summary ---
        const sum = (await api(ADMIN, '/api/v2/gala-ops/summary', { token: atok })).d || {};
        for (const k of Object.keys(EXPECT)) {
            check(`summary.buckets.${k}: +${EXPECT[k].rows} row / +${EXPECT[k].seats} seats`,
                bucketDelta(sum.buckets, sum0.buckets, k, 'rows') === EXPECT[k].rows && bucketDelta(sum.buckets, sum0.buckets, k, 'seats') === EXPECT[k].seats,
                JSON.stringify(sum.buckets && sum.buckets[k]));
        }
        check('summary.buckets: every bucket carries a human label + tag', Object.keys(EXPECT).every(k => sum.buckets[k] && sum.buckets[k].label && sum.buckets[k].tag), JSON.stringify(Object.fromEntries(Object.keys(EXPECT).map(k => [k, sum.buckets[k] && sum.buckets[k].tag]))));
        check(`summary.seats.chase: +${CHASE_SEATS} (link sent + checkout abandoned + no link yet — NOT held, NOT the twin)`,
            sum.seats.chase - sum0.seats.chase === CHASE_SEATS, `${sum0.seats.chase} -> ${sum.seats.chase}`);
        check('summary.bookings.chase: +3 rows', sum.bookings.chase - sum0.bookings.chase === 3, `${sum0.bookings.chase} -> ${sum.bookings.chase}`);
        check('summary.seats.paid: +2 (the paid row and its plus-one)', sum.seats.paid - sum0.seats.paid === 2, `${sum0.seats.paid} -> ${sum.seats.paid}`);
        check(`summary.seats.reserved: +${RESERVED_SEATS} (every active row still holds its seats)`, sum.seats.reserved - sum0.seats.reserved === RESERVED_SEATS, `${sum0.seats.reserved} -> ${sum.seats.reserved}`);
        const owedDelta = Math.round((sum.eur.outstanding - sum0.eur.outstanding) * 100) / 100;
        check(`summary.eur.outstanding: +${OWED_SEATS} seats × €${price} = €${OWED_SEATS * price} (no_link_yet, held and the twin add nothing)`,
            owedDelta === Math.round(OWED_SEATS * price * 100) / 100, `Δ€${owedDelta}`);
        check('summary.eur.collected: +€150 (the paid row only)', Math.round((sum.eur.collected - sum0.eur.collected) * 100) / 100 === 150, `Δ€${Math.round((sum.eur.collected - sum0.eur.collected) * 100) / 100}`);
        check('summary.states: every seeded active row is classified as expected',
            sum.states['gb-paid'] === 'paid' && sum.states['gb-twin'] === 'paid_twins' && sum.states['gb-abandon'] === 'checkout_abandoned'
            && sum.states['gb-nolink'] === 'no_link_yet' && sum.states['gb-link'] === 'link_sent' && sum.states['gb-held'] === 'held',
            JSON.stringify(Object.fromEntries(IDS.map(id => [id, sum.states[id] || null]))));
        check('summary.states: the cancelled row is not a state at all', !('gb-cancelled' in sum.states), JSON.stringify(sum.states['gb-cancelled'] || null));
        check('summary: the legacy keys still exist for money.js (seats.chase, eur.outstanding, price.current, bookings)',
            typeof sum.seats.chase === 'number' && typeof sum.eur.outstanding === 'number' && typeof sum.price.current === 'number' && sum.bookings && typeof sum.bookings.paid === 'number');

        // --- (2) the overview embeds the same block ---
        const ov = (await api(ADMIN, '/api/v2/gala-ops/overview', { token: atok })).d || {};
        check('overview.summary: same buckets + states as /summary', ov.summary && JSON.stringify(ov.summary.buckets) === JSON.stringify(sum.buckets) && ov.summary.states && ov.summary.states['gb-twin'] === 'paid_twins');

        // --- (3) the registrations union ---
        const regs = (await api(ADMIN, '/api/v2/registrations/all?event=gala&limit=1000', { token: atok })).d || {};
        const gb = regs.stats && regs.stats.gala_buckets;
        for (const k of Object.keys(EXPECT)) {
            check(`registrations stats.gala_buckets.${k}: +${EXPECT[k].rows} row / +${EXPECT[k].seats} seats`,
                bucketDelta(gb, regs0.stats.gala_buckets, k, 'rows') === EXPECT[k].rows && bucketDelta(gb, regs0.stats.gala_buckets, k, 'seats') === EXPECT[k].seats,
                JSON.stringify(gb && gb[k]));
        }
        check('registrations stats.gala_unpaid: +3 (= chase rows, the held row and the twin are out)', regs.stats.gala_unpaid - regs0.stats.gala_unpaid === 3, `${regs0.stats.gala_unpaid} -> ${regs.stats.gala_unpaid}`);
        check('registrations stats.gala: +6 live rows (the cancelled control is out)', regs.stats.gala - regs0.stats.gala === 6, `${regs0.stats.gala} -> ${regs.stats.gala}`);
        const row = id => (regs.rows || []).find(x => x.key === 'gala:' + id) || null;
        const fact = (x, k) => { const f = x && (x.facts || []).find(y => y[0] === k); return f ? f[1] : null; };
        check('registrations row: the abandoned checkout carries gala_state + the bucket sentence as its SEAT fact',
            row('gb-abandon') && row('gb-abandon').gala_state === 'checkout_abandoned' && fact(row('gb-abandon'), 'SEAT') === 'Checkout started, not completed' && row('gb-abandon').gala_seats === 3,
            JSON.stringify(row('gb-abandon') && { gala_state: row('gb-abandon').gala_state, seat: fact(row('gb-abandon'), 'SEAT'), gala_seats: row('gb-abandon').gala_seats }));
        check('registrations row: the held row says so and carries no REMINDER fact',
            row('gb-held') && row('gb-held').gala_state === 'held' && fact(row('gb-held'), 'SEAT') === 'Held for review' && fact(row('gb-held'), 'REMINDER') === null,
            JSON.stringify(row('gb-held') && row('gb-held').facts));
        check('registrations row: the paid twin is named as such and carries no REMINDER fact',
            row('gb-twin') && row('gb-twin').gala_state === 'paid_twins' && fact(row('gb-twin'), 'SEAT') === 'Already paid under the same email' && fact(row('gb-twin'), 'REMINDER') === null,
            JSON.stringify(row('gb-twin') && row('gb-twin').facts));
        check('registrations row: the link-sent row still gets its REMINDER door',
            row('gb-link') && row('gb-link').gala_state === 'link_sent' && fact(row('gb-link'), 'REMINDER') !== null, JSON.stringify(row('gb-link') && row('gb-link').facts));
        check('registrations row: public shape intact (status PENDING/PAID/CANCELLED, can_mark_paid, facts, link)',
            row('gb-abandon').status === 'PENDING' && row('gb-paid').status === 'PAID' && row('gb-cancelled').status === 'CANCELLED'
            && row('gb-abandon').can_mark_paid === true && 'link' in row('gb-abandon') && Array.isArray(row('gb-abandon').facts));

        // --- (4) money.js compatibility — it reads seats.chase / eur.outstanding off the shared block ---
        const money = (await api(ADMIN, '/api/v2/money/summary', { token: atok })).d || {};
        // unpaid_count = the OWED seats (link sent + checkout not completed — what the € figure is
        // built from); open_seats = every chaseable seat (owed + no link yet). Both off the shared block.
        check('money/summary: gala.unpaid_count = owed seats (+' + OWED_SEATS + ') and open_seats = chase seats (+' + CHASE_SEATS + '), shared:true',
            money.gala && money.gala.shared === true
            && (money.gala.unpaid_count - ((money0.gala || {}).unpaid_count || 0)) === OWED_SEATS
            && (money.gala.open_seats - ((money0.gala || {}).open_seats || 0)) === CHASE_SEATS
            && money.gala.buckets && typeof money.gala.buckets.link_sent === 'object',
            JSON.stringify(money.gala));
        const owedSrc = list => ((list && list.sources) || []).find(s => s.key === 'gala_unpaid') || { amount: 0 };
        const moneyOwedDelta = Math.round((owedSrc(money.owed).amount - owedSrc(money0.owed).amount) * 100) / 100;
        check(`money/summary: the gala owed source rose by exactly the outstanding € (+€${OWED_SEATS * price})`,
            moneyOwedDelta === Math.round(OWED_SEATS * price * 100) / 100, `Δ€${moneyOwedDelta}`);

        // --- (5) the People directory: gala tags speak the bucket (item A) + the public form is a
        //     PLEXUS / BRIDGES ZAGREB source (item C) ---
        const dir = (await api(ADMIN, '/api/v2/people/directory', { token: atok })).d || {};
        const person = email => (dir.people || []).find(p => String(p.email || '').toLowerCase() === email) || null;
        const tagsOf = email => (person(email) || { tags: [] }).tags;
        check('people: the paid guest reads GALA PAID — their abandoned twin never surfaces as a tag',
            tagsOf('qa.robot+gb1@example.com').includes('GALA PAID') && !tagsOf('qa.robot+gb1@example.com').some(t => /^GALA — /.test(t)),
            JSON.stringify(tagsOf('qa.robot+gb1@example.com')));
        check('people: the abandoned checkout is tagged GALA — CHECKOUT NOT COMPLETED (+ bucket on the gala block)',
            tagsOf('qa.robot+gb3@example.com').includes('GALA — CHECKOUT NOT COMPLETED') && person('qa.robot+gb3@example.com').gala.bucket === 'checkout_abandoned'
            && person('qa.robot+gb3@example.com').gala.bucket_label === 'Checkout started, not completed',
            JSON.stringify(tagsOf('qa.robot+gb3@example.com')));
        check('people: no link yet / link sent / held read their own words',
            tagsOf('qa.robot+gb4@example.com').includes('GALA — NO LINK YET') && tagsOf('qa.robot+gb5@example.com').includes('GALA — LINK SENT') && tagsOf('qa.robot+gb6@example.com').includes('GALA — HELD FOR REVIEW'),
            JSON.stringify([tagsOf('qa.robot+gb4@example.com'), tagsOf('qa.robot+gb5@example.com'), tagsOf('qa.robot+gb6@example.com')]));
        check('people: nobody carries the old "GALA — TO CHASE" tag any more', !(dir.people || []).some(p => (p.tags || []).includes('GALA — TO CHASE')));
        check('people: a live conference + bridges form leg → PLEXUS + BRIDGES ZAGREB, in REGISTRANTS, never BOSTON',
            tagsOf('qa.robot+gbca1@example.com').includes('PLEXUS') && tagsOf('qa.robot+gbca1@example.com').includes('BRIDGES ZAGREB')
            && person('qa.robot+gbca1@example.com').segs.includes('REGISTRANTS') && !person('qa.robot+gbca1@example.com').segs.includes('BOSTON')
            && person('qa.robot+gbca1@example.com').plexus && person('qa.robot+gbca1@example.com').plexus.source === 'plexus-form',
            JSON.stringify(person('qa.robot+gbca1@example.com') && { tags: person('qa.robot+gbca1@example.com').tags, segs: person('qa.robot+gbca1@example.com').segs }));
        check('people: a confirmed conference-only leg → PLEXUS, no bridges', tagsOf('qa.robot+gbca2@example.com').includes('PLEXUS') && !person('qa.robot+gbca2@example.com').bridges, JSON.stringify(tagsOf('qa.robot+gbca2@example.com')));
        check('people: held and cancelled form legs earn no PLEXUS / bridges tag (rows absent or untagged)',
            !tagsOf('qa.robot+gbca3@example.com').includes('PLEXUS') && !tagsOf('qa.robot+gbca3@example.com').includes('BRIDGES ZAGREB')
            && !tagsOf('qa.robot+gbca4@example.com').includes('PLEXUS') && !tagsOf('qa.robot+gbca4@example.com').includes('BRIDGES ZAGREB'),
            JSON.stringify([tagsOf('qa.robot+gbca3@example.com'), tagsOf('qa.robot+gbca4@example.com')]));

        // --- (6) the module exports the vocabulary for the other backend modules ---
        const galaOps = require(path.join(ROOT, 'admin-portal/backend/v2/gala-ops.js'));
        check('gala-ops exports GALA_BUCKETS / galaStateOf / bucketGalaRows',
            galaOps.GALA_BUCKETS && typeof galaOps.galaStateOf === 'function' && typeof galaOps.bucketGalaRows === 'function');
        check('galaStateOf: a bare member request (status pending, no token) is NOT "link sent"',
            galaOps.galaStateOf({ status: 'pending', payment_status: 'pending' }) === 'no_link_yet');
        check('galaStateOf: a legacy vip-comp seat counts as settled, never chased',
            galaOps.galaStateOf({ status: 'confirmed', payment_status: 'vip-comp' }) === 'paid');
    } catch (e) {
        check('test harness ran without throwing', false, (e && e.stack) || String(e));
        procs.forEach((p, i) => { const eb = p._errbuf && p._errbuf(); if (eb) console.error(`--- server ${i} stderr tail ---\n` + eb); });
    }

    const failed = results.filter(x => !x[1]).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    cleanup();
    process.exit(failed ? 1 : 0);
})();
