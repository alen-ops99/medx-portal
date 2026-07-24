#!/usr/bin/env node
/**
 * gala-ticket-scan.test.js — gala table-picker tickets scannable at the door.
 *
 * Bridges the picker's per-guest QR tickets (QR value = plexus-tables.netlify.app/ticket.html?id=<tid>)
 * into the admin door scanner's unified POST /api/admin/checkin/ticket. A scanned gala ticket is
 * resolved against the picker's Firestore (public tickets/{tid} GET), cross-checked against a PAID
 * portal gala_registration, and that portal row is atomically marked checked_in for the gala.
 *
 * PART A — pure engine (picker-sync.js, no server, no network):
 *   - extractPickerTid: host-anchored URL parse (+ negatives), isBareTid (16-hex)
 *   - PickerClient.getTicket against an injected fetch: field mapping + email lowercasing,
 *     404 → null (invalid), 500 → throws (transient, not "not found")
 *
 * PART B — scratch CI boot (mirrors gala-picker-sync.test.js): both portals on a throwaway
 *   SQLite file + an in-test MOCK Firestore/Identity-Toolkit (PICKER_FS_BASE / PICKER_AUTH_BASE
 *   seams). Production Firestore is NEVER touched. Proves end to end:
 *   - paid gala reg + Firestore ticket → scan the ticket URL → ADMIT, table shown, portal row checked_in
 *   - scan again → already_checked_in (atomic single-winner)
 *   - concurrent double-scan → exactly one valid, the other already_checked_in
 *   - bare 16-hex tid at the gala gate resolves the same ticket
 *   - Firestore ticket with NO paid portal reg → edge-case ADMIT + verify flag (never hard-reject)
 *   - bogus tid → invalid
 *   - transient Firestore error (500) → result 'error' (try again), HTTP 200 (never a 500)
 *   - picker ticket at a NON-gala gate → wrong_event
 *   - REGRESSION: a portal conference registration still scans valid at the conference gate,
 *     and a bogus non-picker code is invalid — the picker path never disturbs the portal path
 *
 *   node tests/gala-ticket-scan.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3121';
const ADMIN = 'http://localhost:3122';
const HOST = 'plexus-tables.netlify.app';

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        await sleep(500);
    }
    throw new Error('server at ' + base + ' did not come up');
};

// ═════════════════════════════════════════════════════════════════════════════
// PART A — pure engine
// ═════════════════════════════════════════════════════════════════════════════
async function unitTests() {
    const ps = require(path.join(ROOT, 'admin-portal/backend/picker-sync.js'));

    // ---- extractPickerTid: host-anchored URL parse ----
    check('unit: extractPickerTid pulls id from a ticket URL',
        ps.extractPickerTid('https://' + HOST + '/ticket.html?id=0123456789abcdef') === '0123456789abcdef');
    check('unit: extractPickerTid handles id after other params',
        ps.extractPickerTid('https://' + HOST + '/ticket.html?lang=hr&id=deadbeefdeadbeef') === 'deadbeefdeadbeef');
    check('unit: extractPickerTid rejects a foreign host', ps.extractPickerTid('https://evil.example/ticket.html?id=x') === null);
    check('unit: extractPickerTid rejects a non-ticket path on the host', ps.extractPickerTid('https://' + HOST + '/index.html?t=demo') === null);
    check('unit: extractPickerTid rejects a bare uuid', ps.extractPickerTid('550e8400-e29b-41d4-a716-446655440000') === null);

    // ---- isBareTid: 16 hex ----
    check('unit: isBareTid true for 16-hex', ps.isBareTid('0123456789abcdef') === true);
    check('unit: isBareTid false for short/long/non-hex', !ps.isBareTid('abc') && !ps.isBareTid('0123456789abcdefff') && !ps.isBareTid('zzzz'));
    check('unit: isBareTid false for a uuid', ps.isBareTid('550e8400-e29b-41d4-a716-446655440000') === false);

    // ---- PickerClient.getTicket against an injected fetch ----
    const wrap = (v) => (typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) });
    const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ fields: { name: wrap('Ana Kovač'), email: wrap('ANA@Example.com'), table: wrap(7), registrant: wrap(true), pickRef: wrap('p1') } }) });
    const c1 = new ps.PickerClient({ fetch: okFetch, email: 'x', password: 'y' });
    const doc = await c1.getTicket('abc123');
    check('unit: getTicket maps fields + lowercases email + parses table int',
        doc && doc.name === 'Ana Kovač' && doc.email === 'ana@example.com' && doc.table === 7 && doc.registrant === true, JSON.stringify(doc));

    const c404 = new ps.PickerClient({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), email: 'x', password: 'y' });
    check('unit: getTicket → null on 404 (invalid ticket)', (await c404.getTicket('nope')) === null);

    const c500 = new ps.PickerClient({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), email: 'x', password: 'y' });
    let threw = false; try { await c500.getTicket('x'); } catch (e) { threw = true; }
    check('unit: getTicket THROWS on transient 500 (not silently "not found")', threw);
}

// ═════════════════════════════════════════════════════════════════════════════
// Mock Firestore + Identity Toolkit (PART B seam) — serves the PUBLIC tickets/{tid}
// GET plus the invites/paid_emails/auth the background mark-paid sync touches.
// ═════════════════════════════════════════════════════════════════════════════
function startMockFirebase() {
    const state = { tickets: new Map(), invites: new Map(), paid: new Map(), err500: new Set() };
    const wrap = (v) => {
        if (v === null || v === undefined) return { nullValue: null };
        if (typeof v === 'boolean') return { booleanValue: v };
        if (typeof v === 'number') return { integerValue: String(v) };
        return { stringValue: String(v) };
    };
    const unwrap = (f) => {
        if (!f || typeof f !== 'object') return null;
        if ('stringValue' in f) return f.stringValue;
        if ('booleanValue' in f) return f.booleanValue;
        if ('integerValue' in f) return parseInt(f.integerValue, 10);
        return null;
    };
    const srv = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            const u = new URL(req.url, 'http://x');
            const p = u.pathname;
            const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            try {
                // ---- test control plane ----
                if (p === '/__mock/ticket' && req.method === 'POST') {
                    const j = JSON.parse(body);
                    state.tickets.set(j.tid, { name: j.name || '', email: j.email || '', table: j.table ?? null, registrant: !!j.registrant, pickRef: j.pickRef || null });
                    return send(200, { ok: true });
                }
                if (p === '/__mock/err500' && req.method === 'POST') { state.err500.add(JSON.parse(body).tid); return send(200, { ok: true }); }

                const fsBase = '/v1fs/projects/plexus-gala-tables/databases/(default)/documents';

                // ---- tickets/{tid}: PUBLIC GET-by-id (no auth), mirrors the picker's rules ----
                if (p.startsWith(fsBase + '/tickets/') && req.method === 'GET') {
                    const tid = decodeURIComponent(p.slice((fsBase + '/tickets/').length));
                    if (state.err500.has(tid)) return send(500, { error: { message: 'INTERNAL' } });
                    const v = state.tickets.get(tid);
                    if (!v) return send(404, { error: { message: 'NOT_FOUND' } });
                    return send(200, { fields: { tid: wrap(tid), name: wrap(v.name), email: wrap(v.email), table: wrap(v.table), registrant: wrap(v.registrant), pickRef: wrap(v.pickRef) } });
                }

                // ---- identity toolkit (only used by the background sync) ----
                if (p === '/v1auth/accounts:signInWithPassword') {
                    const j = JSON.parse(body || '{}');
                    if (!j.email || !j.password) return send(400, { error: { message: 'MISSING_CREDS' } });
                    return send(200, { idToken: 'mock-id-token', refreshToken: 'r', expiresIn: '3600' });
                }
                if (p === fsBase + '/config/settings' && req.method === 'GET') return send(200, { fields: {} });
                if (p.startsWith(fsBase + '/invites')) {
                    if ((req.headers.authorization || '') !== 'Bearer mock-id-token') return send(401, { error: { message: 'UNAUTHENTICATED' } });
                    if (p === fsBase + '/invites' && req.method === 'GET') {
                        return send(200, { documents: [...state.invites.entries()].map(([t, v]) => ({ name: fsBase + '/invites/' + t, fields: { token: wrap(t), name: wrap(v.name), email: wrap(v.email), maxParty: wrap(v.maxParty), picked: wrap(v.picked), table: wrap(v.table) } })) });
                    }
                    const token = decodeURIComponent(p.slice((fsBase + '/invites/').length));
                    if (req.method === 'PATCH') {
                        const f = (JSON.parse(body || '{}').fields) || {};
                        state.invites.set(token, { name: unwrap(f.name) || '', email: unwrap(f.email) || '', maxParty: unwrap(f.maxParty) || 3, picked: unwrap(f.picked) === true, table: unwrap(f.table) });
                        return send(200, {});
                    }
                    if (req.method === 'DELETE') { state.invites.delete(token); return send(200, {}); }
                }
                if (p.startsWith(fsBase + '/paid_emails')) {
                    if (req.method === 'GET') { const h = decodeURIComponent(p.slice((fsBase + '/paid_emails/').length)); const v = state.paid.get(h); return v ? send(200, { fields: { email: wrap(v.email) } }) : send(404, {}); }
                    if ((req.headers.authorization || '') !== 'Bearer mock-id-token') return send(401, { error: { message: 'UNAUTHENTICATED' } });
                    const h = decodeURIComponent(p.slice((fsBase + '/paid_emails/').length));
                    if (req.method === 'PATCH') { const f = (JSON.parse(body || '{}').fields) || {}; state.paid.set(h, { email: unwrap(f.email) || '' }); return send(200, {}); }
                    if (req.method === 'DELETE') { state.paid.delete(h); return send(200, {}); }
                }
                send(404, { error: { message: 'not found: ' + req.method + ' ' + p } });
            } catch (e) { send(500, { error: { message: e.message } }); }
        });
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, state, port: srv.address().port })));
}

// ═════════════════════════════════════════════════════════════════════════════
// PART B — scratch boot E2E
// ═════════════════════════════════════════════════════════════════════════════
async function bootTests() {
    const mock = await startMockFirebase();
    const mockBase = 'http://127.0.0.1:' + mock.port;
    const mctl = async (p, body) => (await fetch(mockBase + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-gts-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(scratch, 'scratch.db'),
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '',
        JWT_SECRET: 'gala-ticket-scan-test-secret',
        NODE_ENV: 'test',
        GOOGLE_SHEETS_WEBHOOK: '',
        PICKER_ADMIN_EMAIL: 'president@medx.hr',
        PICKER_ADMIN_PASSWORD: 'mock-console-password',
        PICKER_FS_BASE: mockBase + '/v1fs',
        PICKER_AUTH_BASE: mockBase + '/v1auth',
    };
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errbuf = ''; p.stderr.on('data', (d) => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); }); p._errbuf = () => errbuf;
        procs.push(p); return p;
    };
    const cleanup = () => {
        procs.forEach((p) => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { mock.srv.close(); } catch (e) {}
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('user-portal/backend', 3121); await waitUp(USER);
        boot('admin-portal/backend', 3122); await waitUp(ADMIN);

        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('boot: seeded admin login works', r.status === 200 && !!atok);

        // seed a PAID gala registration (register via user portal, mark paid via admin)
        const paidEmail = 'qa.robot+galaticket@example.com';
        await api(USER, '/api/gala/register', { method: 'POST', body: { first_name: 'Ana', last_name: 'Kovac', email: paidEmail, institution: 'QA', pricing: 'gala' } });
        let list = await api(ADMIN, '/api/admin/gala/registrations', { token: atok });
        const galaRow = (Array.isArray(list.d) ? list.d : []).find((x) => x.email === paidEmail);
        check('boot: gala registration row created', !!galaRow, galaRow && galaRow.id);
        r = await api(ADMIN, '/api/admin/registrant/gala/' + (galaRow && galaRow.id) + '/mark-paid', { method: 'POST', token: atok });
        check('boot: mark-paid succeeds', r.status === 200 && r.d.success);

        const readGala = async (email) => {
            const l = await api(ADMIN, '/api/admin/gala/registrations', { token: atok });
            return (Array.isArray(l.d) ? l.d : []).find((x) => x.email === email);
        };

        // ---- (1) seed a Firestore ticket for the paid guest, scan the ticket URL ----
        await mctl('/__mock/ticket', { tid: 'aaaa0000bbbb1111', name: 'Ana Kovac', email: paidEmail, table: 7, registrant: true });
        const ticketUrl = 'https://' + HOST + '/ticket.html?id=aaaa0000bbbb1111&lang=hr';
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: ticketUrl, event: 'gala', mark: true } });
        check('scan gala ticket URL → ADMIT (valid)', r.d && r.d.result === 'valid' && r.d.valid === true, JSON.stringify(r.d).slice(0, 160));
        check('scan gala ticket URL → TABLE shown as "Stol 7"', r.d && r.d.ticket && r.d.ticket.table === 'Stol 7', r.d && r.d.ticket && r.d.ticket.table);
        check('scan gala ticket URL → guest name from Firestore ticket', r.d && r.d.ticket && r.d.ticket.name === 'Ana Kovac', r.d && r.d.ticket && r.d.ticket.name);
        let gr = await readGala(paidEmail);
        check('scan gala ticket URL → portal gala row marked checked_in', gr && Number(gr.checked_in) === 1, gr && gr.checked_in);

        // ---- (2) scan again → already_checked_in ----
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: ticketUrl, event: 'gala', mark: true } });
        check('re-scan → already_checked_in (single-winner)', r.d && r.d.result === 'already_checked_in' && !!r.d.checked_in_at, JSON.stringify(r.d).slice(0, 140));
        check('re-scan → table still shown', r.d && r.d.ticket && r.d.ticket.table === 'Stol 7');

        // ---- (3) bare 16-hex tid at the gala gate resolves the same ticket ----
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: 'aaaa0000bbbb1111', event: 'gala', mark: true } });
        check('bare tid at gala gate → resolves (already_checked_in here)', r.d && r.d.result === 'already_checked_in', r.d && r.d.result);

        // ---- (4) concurrent double-scan on a fresh paid guest → exactly one valid ----
        const paid2 = 'qa.robot+galaticket2@example.com';
        await api(USER, '/api/gala/register', { method: 'POST', body: { first_name: 'Bo', last_name: 'Novak', email: paid2, institution: 'QA', pricing: 'gala' } });
        const row2 = await readGala(paid2);
        await api(ADMIN, '/api/admin/registrant/gala/' + (row2 && row2.id) + '/mark-paid', { method: 'POST', token: atok });
        await mctl('/__mock/ticket', { tid: 'cccc2222dddd3333', name: 'Bo Novak', email: paid2, table: 3, registrant: true });
        const url2 = 'https://' + HOST + '/ticket.html?id=cccc2222dddd3333';
        const both = await Promise.all([
            api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: url2, event: 'gala', mark: true } }),
            api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: url2, event: 'gala', mark: true } }),
        ]);
        const valids = both.filter((x) => x.d && x.d.result === 'valid').length;
        const alreadys = both.filter((x) => x.d && x.d.result === 'already_checked_in').length;
        check('CONCURRENT gala double-scan → exactly one valid', valids === 1, 'valid=' + valids + ' already=' + alreadys);
        check('CONCURRENT gala double-scan → the other already_checked_in', alreadys === 1);

        // ---- (5) edge case: valid ticket, NO paid portal reg → ADMIT + verify (never reject) ----
        await mctl('/__mock/ticket', { tid: 'eeee4444ffff5555', name: 'Drift Guest', email: 'nobody+drift@example.com', table: 12, registrant: true });
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: 'https://' + HOST + '/ticket.html?id=eeee4444ffff5555', event: 'gala', mark: true } });
        check('edge case (no paid portal reg) → still ADMIT (valid)', r.d && r.d.result === 'valid', JSON.stringify(r.d).slice(0, 160));
        check('edge case → verify flag + note set on ticket', r.d && r.d.ticket && r.d.ticket.verify === true && /verify/i.test(r.d.ticket.verify_note || ''), r.d && r.d.ticket && r.d.ticket.verify_note);
        check('edge case → table still shown', r.d && r.d.ticket && r.d.ticket.table === 'Stol 12');

        // ---- (6) bogus tid → invalid ----
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: 'https://' + HOST + '/ticket.html?id=0000dead0000beef', event: 'gala', mark: true } });
        check('bogus tid → invalid', r.d && r.d.result === 'invalid' && r.d.valid === false, r.d && r.d.result);

        // ---- (7) transient Firestore error (500) → result 'error', HTTP 200 (never a 500) ----
        await mctl('/__mock/err500', { tid: 'ffff6666aaaa7777' });
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: 'https://' + HOST + '/ticket.html?id=ffff6666aaaa7777', event: 'gala', mark: true } });
        check('transient Firestore error → result error (try again), HTTP 200', r.status === 200 && r.d && r.d.result === 'error' && r.d.retry === true, r.status + ' ' + (r.d && r.d.result));

        // ---- (8) picker ticket at a NON-gala gate → wrong_event ----
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: ticketUrl, event: 'conference', mark: true } });
        check('picker ticket at conference gate → wrong_event', r.d && r.d.result === 'wrong_event', r.d && r.d.result);

        // ---- (9) REGRESSION: portal conference registration still scans valid; the picker path
        //          never disturbs a real portal token. Also a bogus non-picker code is invalid. ----
        r = await api(ADMIN, '/api/admin/conferences', { method: 'POST', token: atok, body: { name: 'Scan Regression Conf', year: 2026 } });
        const confId = r.d && r.d.id;
        r = await api(ADMIN, '/api/admin/conferences/' + confId + '/tickets', { method: 'POST', token: atok, body: { name: 'General', price_regular: 0 } });
        const ticketTypeId = r.d && r.d.id;
        r = await api(ADMIN, '/api/registrations', { method: 'POST', token: atok, body: { conference_id: confId, ticket_type_id: ticketTypeId } });
        const regId = r.d && r.d.registration_id;
        check('regression: portal conference registration created', !!regId);
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: regId, event: 'conference', mark: true } });
        check('regression: portal conference token still scans VALID (unchanged)', r.d && r.d.result === 'valid', r.d && r.d.result);
        r = await api(ADMIN, '/api/admin/checkin/ticket', { method: 'POST', token: atok, body: { code: 'totally-bogus-non-picker-code', event: 'conference', mark: true } });
        check('regression: bogus non-picker code → invalid', r.d && r.d.result === 'invalid', r.d && r.d.result);

    } catch (e) {
        check('unexpected error: ' + e.message, false, e.stack);
        procs.forEach((p) => { const b = p._errbuf && p._errbuf(); if (b) console.log('--- server stderr ---\n' + b.slice(-1500)); });
    } finally {
        cleanup();
    }
}

(async () => {
    await unitTests();
    await bootTests();
    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
