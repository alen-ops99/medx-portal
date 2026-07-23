#!/usr/bin/env node
/**
 * Post-event round AUTO-RUNNER test — scratch CI-style boot (mirrors member-card-toggle.test.js).
 *
 * The manual "Run round" button (POST /api/admin/post-event/run-round) was the one post-event job
 * with no timer twin. postEventAutoRunDue() adds that twin: once an event has ENDED it stages the
 * certificate + thank-you + missed + feedback batches on its own — approval-gated, drip-marker
 * idempotent. This proves the whole thing end to end by driving the real boot-time runner:
 *
 *   1. Boot user+admin on one throwaway DB (seeds a FUTURE-dated conference) → the runner is a
 *      no-op and NOTHING is staged (proves it never fires early).
 *   2. Backdate the conference to the past + add one checked-in attendee, then reboot admin →
 *      the boot-time runner stages 3 approval-gated batches (thankyou/cert/feedback), issues a
 *      certificate, writes the drip marker, and announces itself in the log.
 *   3. Every staged row stays status='pending_approval' (the approval gate is intact — the runner
 *      never sends).
 *   4. Reboot admin again → the drip marker blocks it: zero new rows (idempotent).
 *
 *   node tests/post-event-autorun.test.js
 *
 * Exits 1 on any failure. Cleans up its servers + scratch dir.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3111';
const ADMIN = 'http://localhost:3112';
// The libsql driver the servers use — reused here (raw, native API) to inspect/mutate the scratch
// DB between boots. .prepare().get()/.all()/.run() and .exec() are the native libsql methods.
const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 160) : ''));
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
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-pea-'));
    const DB_PATH = path.join(scratch, 'scratch.db');
    const baseEnv = {
        ...process.env,
        DATABASE_PATH: DB_PATH,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '',
        JWT_SECRET: 'post-event-autorun-test-secret',
        NODE_ENV: 'test',
    };
    const procs = [];
    // Boot one server; when logPath is given, its stdout is captured there for log assertions.
    const boot = (dir, port, logPath) => new Promise((resolve) => {
        const out = logPath ? fs.openSync(logPath, 'w') : 'ignore';
        const p = spawn('node', ['server.js'], {
            cwd: path.join(ROOT, dir),
            env: { ...baseEnv, PORT: String(port) },
            stdio: ['ignore', out, 'pipe'],
        });
        p.stderr.on('data', () => {});
        procs.push(p);
        resolve(p);
    });
    const stop = async (p) => { try { p.kill('SIGKILL'); } catch (e) {} await new Promise(r => setTimeout(r, 400)); };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    // Fresh short-lived raw connection to the scratch DB (WAL readers see committed data).
    const withDb = (fn) => {
        const db = new Database(DB_PATH);
        try { return fn(db); } finally { try { db.close(); } catch (e) {} }
    };
    const countStaged = () => withDb((db) =>
        db.prepare("SELECT COUNT(*) AS n FROM scheduled_emails WHERE batch_id LIKE 'postevent-%'").get().n);

    try {
        // ---- (1) seed on a FUTURE-dated conference: runner must NOT fire ----
        const u = await boot('user-portal/backend', 3111);
        await waitUp(USER);
        const a1 = await boot('admin-portal/backend', 3112);
        await waitUp(ADMIN);
        await stop(a1); await stop(u);

        check('scratch boot seeded ≥1 conference', withDb((db) => db.prepare('SELECT COUNT(*) AS n FROM conferences').get().n) >= 1);
        check('future-dated event: runner staged NOTHING on boot', countStaged() === 0);
        check('future-dated event: no drip marker yet',
            withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM drip_log WHERE user_id='post-event'").get().n) === 0);

        // ---- (2) backdate the event to the past + add one checked-in attendee ----
        const confId = withDb((db) => {
            db.exec("UPDATE conferences SET start_date = '2020-01-01', end_date = '2020-01-02'");
            const c = db.prepare("SELECT id FROM conferences ORDER BY COALESCE(is_active,0) DESC LIMIT 1").get();
            db.prepare(`INSERT INTO registrations (id, conference_id, first_name, last_name, email, status, payment_status, checked_in, checked_in_at)
                    VALUES ('pea-reg-1', ?, 'Test', 'Attendee', 'attendee.pea@medx.local', 'confirmed', 'paid', 1, datetime('now'))`).run(c.id);
            return c.id;
        });
        check('backdated conference + inserted a checked-in attendee', !!confId);

        // ---- (3) reboot admin: the boot-time runner should fire once ----
        const logPath = path.join(scratch, 'admin-run.log');
        const a2 = await boot('admin-portal/backend', 3112, logPath);
        await waitUp(ADMIN);
        await new Promise(r => setTimeout(r, 800)); // let the boot-time run finish committing
        await stop(a2);

        const log = fs.readFileSync(logPath, 'utf8');
        check('auto-runner announces itself in the boot log', /\[PostEvent\] Post-event round auto-runner active/.test(log));

        const staged = withDb((db) => db.prepare("SELECT status, COUNT(*) AS n FROM scheduled_emails WHERE batch_id LIKE 'postevent-%' GROUP BY status").all());
        const totalStaged = staged.reduce((s, r) => s + r.n, 0);
        const pending = (staged.find(r => r.status === 'pending_approval') || {}).n || 0;
        check('ended event: runner staged the post-event batches', totalStaged >= 3, 'staged=' + totalStaged);
        check('every staged row is pending_approval (approval gate intact)', totalStaged > 0 && pending === totalStaged, JSON.stringify(staged));
        check('runner issued a certificate for the checked-in attendee',
            withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM certificates WHERE registration_id='pea-reg-1'").get().n) === 1);
        check('runner wrote the per-event drip marker',
            withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM drip_log WHERE user_id='post-event' AND kind='postevent-auto:plexus'").get().n) === 1);

        // ---- (4) reboot admin again: drip marker must block a second run (idempotent) ----
        const before = countStaged();
        const a3 = await boot('admin-portal/backend', 3112);
        await waitUp(ADMIN);
        await new Promise(r => setTimeout(r, 800));
        await stop(a3);
        check('second boot is idempotent: no new staged rows', countStaged() === before, before + ' -> ' + countStaged());
        check('second boot issued no duplicate certificate',
            withDb((db) => db.prepare("SELECT COUNT(*) AS n FROM certificates WHERE registration_id='pea-reg-1'").get().n) === 1);
    } catch (e) {
        check('unexpected error: ' + e.message, false);
    } finally {
        cleanup();
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
