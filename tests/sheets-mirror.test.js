#!/usr/bin/env node
/**
 * Google Sheets mirror COVERAGE test — scratch CI-style boot (mirrors member-card-toggle.test.js).
 *
 * The paid + invite registration paths already mirror each registration into the Google Sheets staff
 * log; several free paths (free Forum sign-ups, the Annual Forum form, the direct-link path) did not,
 * so those registrations were invisible in the staff Sheet. mirrorToSheets() + the new call sites
 * close that gap. This proves it end to end with a local capture server standing in for the Apps
 * Script web-app:
 *
 *   1. With GOOGLE_SHEETS_WEBHOOK set, a guest free-Forum registration fires exactly one mirror POST
 *      routed to the Forum tab (events:['forum']) carrying the registrant's name/email.
 *   2. The mirror is best-effort: the registration still returns success, and the DB row is written
 *      whether or not the webhook is reachable.
 *   3. With NO webhook configured, the same registration still succeeds and fires no POST (no crash,
 *      no coupling) — the mirror is purely additive.
 *
 *   node tests/sheets-mirror.test.js
 *
 * Exits 1 on any failure. Cleans up its server, capture server, and scratch dir.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3121';

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

// Minimal capture server standing in for the Apps Script /exec web app.
const captured = [];
const capture = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        try { captured.push(JSON.parse(body)); } catch (e) { captured.push({ _raw: body }); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
    });
});

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-shm-'));
    const procs = [];
    const bootUser = (extraEnv) => {
        const p = spawn('node', ['server.js'], {
            cwd: path.join(ROOT, 'user-portal/backend'),
            env: {
                ...process.env,
                DATABASE_PATH: path.join(scratch, 'scratch.db'),
                TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
                RESEND_API_KEY: '', SMTP_USER: '',
                JWT_SECRET: 'sheets-mirror-test-secret',
                NODE_ENV: 'test',
                PORT: '3121',
                ...extraEnv,
            },
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        p.stderr.on('data', () => {});
        procs.push(p);
        return p;
    };
    const stop = async (p) => { try { p.kill('SIGKILL'); } catch (e) {} await new Promise(r => setTimeout(r, 400)); };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { capture.close(); } catch (e) {}
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    const register = async (email) => {
        const r = await fetch(USER + '/api/forum/events/forum-2026-day1/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Sheet Guest', email, institution: 'Test Clinic' }),
        });
        let d = null; try { d = await r.json(); } catch (e) {}
        return { status: r.status, d };
    };
    const waitFor = async (pred, ms = 5000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (pred()) return true; await new Promise(r => setTimeout(r, 100)); }
        return pred();
    };

    try {
        // Bring up the capture server on an ephemeral port.
        await new Promise((res) => capture.listen(0, '127.0.0.1', res));
        const webhook = `http://127.0.0.1:${capture.address().port}/exec`;

        // ---- (1) WITH the webhook: a free Forum sign-up mirrors to the Forum tab ----
        let u = bootUser({ GOOGLE_SHEETS_WEBHOOK: webhook });
        await waitUp(USER);
        const before = captured.length;
        let r = await register('sheet.guest+with@example.com');
        check('free Forum registration succeeds (webhook set)', r.status === 200 && r.d && r.d.success, JSON.stringify(r.d));
        const got = await waitFor(() => captured.length > before);
        check('exactly one mirror POST fired', got && captured.length === before + 1, 'delta=' + (captured.length - before));
        const row = captured[captured.length - 1] || {};
        check('mirror routed to the Forum tab (events:["forum"])', Array.isArray(row.events) && row.events.includes('forum'), JSON.stringify(row.events));
        check('mirror carries the registrant email', row.email === 'sheet.guest+with@example.com', row.email);
        check('mirror carries a name + timestamp + event_type', !!row.name && !!row.timestamp && row.event_type === 'forum', JSON.stringify({ name: row.name, ts: !!row.timestamp, et: row.event_type }));
        await stop(u);

        // ---- (2) WITHOUT a webhook: same registration succeeds, no POST fired ----
        const countBefore = captured.length;
        u = bootUser({ GOOGLE_SHEETS_WEBHOOK: '' });
        await waitUp(USER);
        r = await register('sheet.guest+without@example.com');
        check('free Forum registration succeeds (webhook unset)', r.status === 200 && r.d && r.d.success, JSON.stringify(r.d));
        await new Promise(res => setTimeout(res, 800)); // give any stray POST time to (not) arrive
        check('no mirror POST fired when webhook is unset', captured.length === countBefore, 'delta=' + (captured.length - countBefore));
        await stop(u);
    } catch (e) {
        check('unexpected error: ' + e.message, false);
    } finally {
        cleanup();
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
