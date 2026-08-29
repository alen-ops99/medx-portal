#!/usr/bin/env node
/**
 * deploy/staging/launcher.js — ONE free Render web service runs BOTH portal backends.
 *
 * Why: the admin→member chain (admin publishes → member sees it) needs one shared DB,
 * and a free Render instance has only one exposed port and an ephemeral disk. So this
 * launcher (1) copies the scrubbed seed DB into place on every cold start, (2) starts the
 * member backend on :3000 and the admin backend on :3001 with the SAME DATABASE_PATH, and
 * (3) listens on Render's $PORT and routes:
 *       /__admin/...   → admin backend (prefix stripped)
 *       /__staging/... → launcher status endpoints
 *       everything else → member backend
 * While the backends boot it answers 503 {waking:true} immediately, so front ends can
 * show a "waking up" state instead of timing out behind Netlify's 26 s proxy limit.
 *
 * Safety: children never see RENDER*, TURSO_*, BREVO/RESEND, STRIPE_* or Google-Sheets
 * secrets, so staging cannot touch the production DB, send real email, or charge a card.
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.PORT || '10000', 10);
const USER_PORT = 3000;
const ADMIN_PORT = 3001;
const DATA_DIR = process.env.STAGING_DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'staging.db');
const SEED_DB = path.join(__dirname, 'seed.db');
const EMAIL_DIR = path.join(DATA_DIR, 'emails');
const SELF = (process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MEMBER_FRONT = (process.env.STAGING_MEMBER_URL || SELF).replace(/\/$/, '');
const ADMIN_FRONT = (process.env.STAGING_ADMIN_URL || `${SELF}/__admin`).replace(/\/$/, '');
const BOOT_ID = crypto.randomBytes(4).toString('hex');
const STARTED = Date.now();

// Persistent mode: a dedicated STAGING Turso database (never the production one). The env
// names are deliberately different from production's TURSO_DATABASE_URL/TURSO_AUTH_TOKEN so a
// copy-pasted prod env can never leak in — those two are stripped from the children below.
const TURSO_URL = (process.env.STAGING_TURSO_URL || '').trim();
const TURSO_TOKEN = (process.env.STAGING_TURSO_TOKEN || '').trim();
const USE_TURSO = !!(TURSO_URL && TURSO_TOKEN);
if (USE_TURSO && /medx-portal-alen-ops99|medx-portal\./i.test(TURSO_URL)) {
    console.error('[staging] FATAL: STAGING_TURSO_URL points at the PRODUCTION database — refusing to start');
    process.exit(1);
}

function log(...a) { console.log(`[staging ${new Date().toISOString()}]`, ...a); }

// ── 1. Database: Turso replica per backend (persistent) or one seeded file (ephemeral) ──
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(EMAIL_DIR, { recursive: true });
let seeded = false;
if (USE_TURSO) {
    log(`Turso mode: ${TURSO_URL.replace(/^libsql:\/\//, '')} — each backend keeps its own embedded replica in ${DATA_DIR}`);
} else if (!fs.existsSync(DB_FILE)) {
    if (!fs.existsSync(SEED_DB)) {
        console.error(`[staging] FATAL: seed DB missing at ${SEED_DB} — run "node deploy/staging/build-seed.js" in the build step`);
        process.exit(1);
    }
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + suffix); } catch (e) {} }
    fs.copyFileSync(SEED_DB, DB_FILE);
    seeded = true;
    log(`seeded ${DB_FILE} from ${path.basename(SEED_DB)} (${(fs.statSync(SEED_DB).size / 1048576).toFixed(1)} MB)`);
} else {
    log(`reusing existing ${DB_FILE}`);
}

// ── 1b. Restore seeded upload files (speaker portraits, galleries, logos) ───────────
// Runtime uploads live on the ephemeral disk and vanish at every cold start, while their
// DB rows persist in Turso — so reviewers would see broken images after each sleep.
// deploy/staging/uploads-seed/ is committed; copy it over the backend's uploads dir at boot.
try {
    const SEED_UPLOADS = path.join(__dirname, 'uploads-seed');
    const TARGET_UPLOADS = path.join(ROOT, 'user-portal', 'backend', 'uploads');
    if (fs.existsSync(SEED_UPLOADS)) {
        let n = 0;
        const copyDir = (src, dst) => {
            fs.mkdirSync(dst, { recursive: true });
            for (const e of fs.readdirSync(src, { withFileTypes: true })) {
                const s = path.join(src, e.name), d = path.join(dst, e.name);
                if (e.isDirectory()) copyDir(s, d);
                else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); n++; }
            }
        };
        copyDir(SEED_UPLOADS, TARGET_UPLOADS);
        log(`restored ${n} seeded upload file(s) into user-portal/backend/uploads`);
    }
} catch (e) { console.error('[staging] uploads-seed restore failed:', e.message); }

// ── 2. Child environments ───────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    log('WARN: JWT_SECRET not set — using a per-boot random secret (sessions reset on restart)');
    return crypto.randomBytes(32).toString('hex');
})();

const STRIP_PREFIXES = ['RENDER', 'TURSO_', 'STRIPE_', 'BREVO_', 'RESEND_', 'GOOGLE_SHEETS', 'FIRA_', 'PICKER_', 'CLOUDINARY', 'AMADEUS_', 'PUBLER_', 'VAPID_PRIVATE'];
function childEnv(name, extra) {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (STRIP_PREFIXES.some(p => k.startsWith(p))) continue;
        env[k] = v;
    }
    if (USE_TURSO) {
        env.TURSO_DATABASE_URL = TURSO_URL;
        env.TURSO_AUTH_TOKEN = TURSO_TOKEN;
    }
    Object.assign(env, {
        NODE_ENV: 'staging',
        JWT_SECRET,
        DATABASE_PATH: USE_TURSO ? path.join(DATA_DIR, `${name}-replica.db`) : DB_FILE,
        EMAIL_DUMP_DIR: EMAIL_DIR,
        EMAIL_FROM: process.env.EMAIL_FROM || 'Med&X staging <noreply@medx.hr>',
        SITE_PUBLIC_URL: process.env.SITE_PUBLIC_URL || 'https://www.medx.hr',
        MEDX_STAGING: '1',
        KEEP_WARM: '0',
    }, extra);
    return env;
}

const children = {};
function start(name, dir, env, port) {
    const child = spawn(process.execPath, ['server.js'], {
        cwd: path.join(ROOT, dir),
        env: childEnv(name, { PORT: String(port), ...env }),
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    children[name] = { child, port, ready: false, exited: false };
    log(`started ${name} (pid ${child.pid}) on :${port}`);
    child.on('exit', (code, signal) => {
        children[name].exited = true;
        children[name].ready = false;
        console.error(`[staging] ${name} exited (code ${code}, signal ${signal}) — exiting so the platform restarts the service`);
        shutdown(1);
    });
}

start('member', 'user-portal/backend', {
    PORTAL_URL: MEMBER_FRONT,
    PUBLIC_BASE_URL: MEMBER_FRONT,
    USER_PORTAL_URL: MEMBER_FRONT,
    ADMIN_PORTAL_URL: ADMIN_FRONT,
    CORS_ORIGIN: process.env.CORS_ORIGIN || '',
}, USER_PORT);

start('admin', 'admin-portal/backend', {
    PORTAL_URL: ADMIN_FRONT,
    PUBLIC_BASE_URL: ADMIN_FRONT,
    ADMIN_PORTAL_URL: ADMIN_FRONT,
    USER_PORTAL_URL: MEMBER_FRONT,
    CORS_ORIGIN: process.env.CORS_ORIGIN || '',
}, ADMIN_PORT);

// ── 3. Readiness polling ────────────────────────────────────────────────────────────
function probe(port) {
    return new Promise(resolve => {
        const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, res => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}
async function pollReady() {
    for (const name of Object.keys(children)) {
        const c = children[name];
        if (!c.ready && !c.exited && await probe(c.port)) {
            c.ready = true;
            log(`${name} backend READY after ${((Date.now() - STARTED) / 1000).toFixed(1)} s`);
        }
    }
    if (!Object.values(children).every(c => c.ready)) setTimeout(pollReady, 1500);
}
pollReady();
const allReady = () => Object.values(children).every(c => c.ready);

// ── 4. Reverse proxy on $PORT ───────────────────────────────────────────────────────
function route(url) {
    if (url === '/__admin' || url.startsWith('/__admin/') || url.startsWith('/__admin?')) {
        return { name: 'admin', port: ADMIN_PORT, url: url.slice('/__admin'.length) || '/' };
    }
    return { name: 'member', port: USER_PORT, url };
}

function wakingPayload() {
    return {
        waking: !allReady(),
        member: !!(children.member && children.member.ready),
        admin: !!(children.admin && children.admin.ready),
        uptime_s: Math.round((Date.now() - STARTED) / 1000),
        boot: BOOT_ID,
    };
}

function sendWaking(req, res) {
    const p = wakingPayload();
    const wantsHtml = /text\/html/.test(req.headers.accept || '') && !/application\/json/.test(req.headers.accept || '');
    res.statusCode = 503;
    res.setHeader('Retry-After', '5');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (!wantsHtml) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(p));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Med&amp;X — waking up</title>
<body style="margin:0;background:#f7f1e6;color:#191512;font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="text-align:center;max-width:420px;padding:32px"><div style="font:italic 500 34px/1.1 Fraunces,Georgia,serif">One moment.</div>
<p style="font-size:14px;color:#4a4239;margin:14px 0 0">The review portal is waking up (about a minute after a quiet spell). This page refreshes itself.</p>
<p style="font:600 10px Inter,sans-serif;letter-spacing:.16em;color:#6e5626;margin-top:20px">STAGING · MEMBER ${p.member ? 'READY' : 'STARTING'} · ADMIN ${p.admin ? 'READY' : 'STARTING'}</p></div></body>`);
}

const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/__staging/health') {
        const ok = allReady();
        res.statusCode = ok ? 200 : 503;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*'); // wake pages on the Netlify sites poll this
        return res.end(JSON.stringify({ ok, mode: USE_TURSO ? 'turso' : 'file', seeded, ...wakingPayload() }));
    }
    if (url === '/__staging/emails' || url.startsWith('/__staging/emails/')) return serveEmails(url, res);

    const t = route(url);
    const c = children[t.name];
    if (!c || !c.ready) return sendWaking(req, res);

    const headers = { ...req.headers };
    headers['x-forwarded-for'] = [req.socket.remoteAddress, headers['x-forwarded-for']].filter(Boolean).join(', ');
    headers['x-forwarded-proto'] = headers['x-forwarded-proto'] || 'https';
    headers['x-forwarded-host'] = headers['x-forwarded-host'] || headers.host;
    headers['x-medx-staging-prefix'] = t.name === 'admin' ? '/__admin' : '';
    const up = http.request({ host: '127.0.0.1', port: t.port, method: req.method, path: t.url, headers }, upRes => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
    });
    up.on('error', err => {
        if (!res.headersSent) { res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); }
        res.end(JSON.stringify({ error: 'upstream error', detail: err.message, backend: t.name }));
    });
    req.pipe(up);
});

// WebSocket / SSE upgrade pass-through (chat, live Q&A)
server.on('upgrade', (req, socket, head) => {
    const t = route(req.url || '/');
    const c = children[t.name];
    if (!c || !c.ready) { socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\n\r\n'); return socket.destroy(); }
    const upstream = net.connect(t.port, '127.0.0.1', () => {
        const lines = [`${req.method} ${t.url} HTTP/${req.httpVersion}`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (head && head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
});

// Dumped emails (no provider on staging) — lets reviewers open what "would have been sent".
function serveEmails(url, res) {
    const name = decodeURIComponent(url.replace(/^\/__staging\/emails\/?/, ''));
    if (!name) {
        const files = fs.readdirSync(EMAIL_DIR).sort().reverse();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(`<!doctype html><meta charset="utf-8"><title>Staging outbox</title><body style="font-family:Inter,system-ui,sans-serif;padding:32px;background:#f7f1e6;color:#191512"><h1 style="font:italic 500 28px Fraunces,Georgia,serif">Staging outbox</h1><p style="color:#4a4239;font-size:13px">Emails the portal tried to send on staging (nothing is delivered here). ${files.length} file(s), newest first.</p><ul style="font-size:13px;line-height:1.9">${files.map(f => `<li><a href="/__staging/emails/${encodeURIComponent(f)}">${f}</a></li>`).join('') || '<li>none yet</li>'}</ul></body>`);
    }
    const file = path.join(EMAIL_DIR, path.basename(name));
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(file).pipe(res);
}

server.listen(PORT, '0.0.0.0', () => log(`proxy listening on :${PORT} (boot ${BOOT_ID}) — member :${USER_PORT}, admin :${ADMIN_PORT}, data ${DATA_DIR}`));

// ── 5. Shutdown ─────────────────────────────────────────────────────────────────────
let shuttingDown = false;
function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const c of Object.values(children)) { try { c.child.kill('SIGTERM'); } catch (e) {} }
    setTimeout(() => process.exit(code), 800);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
