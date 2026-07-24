#!/usr/bin/env node
/**
 * Gala → table-picker automatic invite sync — full test suite.
 *
 * PART A — unit tests on the pure engine (admin-portal/backend/picker-sync.js, no server):
 *   - computeInviteDiff: create / unchanged / revoke-unpicked / flag-picked / foreign /
 *     email dedupe
 *   - runInviteSync against a mock client: callbacks, report shape, idempotent re-run,
 *     unconfigured no-op, create-failure collected not thrown
 *   - buildInviteEmail: approved design (hosted logo header, red button copy, fallback
 *     link, bilingual blocks, per-language deadlines + sentence-drop, HTML escaping,
 *     no "Kliknite ovdje")
 *   - fetchChooseDeadlines: per-language fields, legacy '·' split, error → nulls
 *   - token format (16 hex, console-compatible)
 *
 * PART B — scratch CI-style boot (mirrors member-card-toggle.test.js): both portals on a
 *   throwaway SQLite file + an in-test MOCK Firestore/Identity-Toolkit HTTP server (the
 *   engine's PICKER_FS_BASE / PICKER_AUTH_BASE test seams). Production Firestore is NEVER
 *   touched here. Proves end to end:
 *   - paid gala reg → invite created in (mock) Firestore + gala_picker_invites row
 *     + public paid_emails/{sha256(email)} marker written (picker-compatible id)
 *   - fire-and-forget trigger on the admin mark-paid path (no manual run needed)
 *   - re-run → idempotent (unchanged, nothing created/deleted)
 *   - refund (status→rejected) → unpicked invite DELETED + revoked_at stamped +
 *     paid_emails marker DELETED (flagged/booked guest keeps both)
 *   - refund with picked invite → flagged, NOT deleted
 *   - console-created invite with unknown email → foreign, untouched
 *   - re-eligible guest → fresh invite with a NEW token (old ledger row stays revoked)
 *   - "Pošalji pozivnice" approval → stages exactly N outbox rows (From president@medx.hr,
 *     approved HTML, both deadlines) and never double-stages
 *   - registration/status responses are NEVER blocked by a hanging Firestore
 *
 * PART C — guarded production E2E (opt-in: PICKER_E2E=1 + PICKER_ADMIN_EMAIL/PASSWORD or
 *   guest_picker/.env with ADMIN_CONSOLE_EMAIL/PASSWORD): creates ONE invite for
 *   qa.robot+sync@example.com in the real plexus-gala-tables project, verifies the doc via
 *   REST, deletes it again, verifies it is gone. Touches nothing else.
 *
 *   node tests/gala-picker-sync.test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3111';
const ADMIN = 'http://localhost:3112';

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
// PART A — unit tests (pure engine, no server, no network)
// ═════════════════════════════════════════════════════════════════════════════
async function unitTests() {
    const ps = require(path.join(ROOT, 'admin-portal/backend/picker-sync.js'));

    // token format — must match the console's genTid() output (8 bytes → 16 hex)
    const tok = ps.genInviteToken();
    check('unit: token is 16 lowercase hex chars', /^[0-9a-f]{16}$/.test(tok), tok);
    check('unit: tokens are random', ps.genInviteToken() !== ps.genInviteToken());

    // ---- paid_emails doc-id — MUST equal the picker's client-side sha256hex ----
    // The picker (guest_picker index.html/admin.html) hashes an added guest's e-mail as
    // hex(SHA-256(TextEncoder(normEmail(email)))) and GETs paid_emails/{that}. Reproduce that
    // exact Web-Crypto recipe here and prove the sync's Node createHash id is byte-identical,
    // including the trim + lowercase normalization on which the marker's uniqueness depends.
    const pickerHex = async (str) => {
        const buf = await require('crypto').webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        const b = new Uint8Array(buf); let h = '';
        for (let i = 0; i < b.length; i++) h += ('0' + b[i].toString(16)).slice(-2);
        return h;
    };
    const norm = (e) => String(e || '').trim().toLowerCase();
    for (const raw of ['a@x.hr', '  A@X.HR  ', 'Ana.Kovac@Example.COM', 'qa.robot+syncguest@example.com', 'DUP@x.hr']) {
        const want = await pickerHex(norm(raw));     // picker: sha256hex(normEmail(email))
        const got = ps.paidEmailDocId(raw);
        check('paid: doc-id matches picker sha256hex for ' + JSON.stringify(raw), got === want, got);
    }
    check('paid: trim + case variants collapse to one marker id',
        ps.paidEmailDocId('  A@X.HR  ') === ps.paidEmailDocId('a@x.hr') && ps.paidEmailDocId('A@x.hr') === ps.paidEmailDocId('a@x.hr'));
    check('paid: id is 64 lowercase hex chars', /^[0-9a-f]{64}$/.test(ps.paidEmailDocId('a@x.hr')));

    // ---- computeInviteDiff ----
    const diff1 = ps.computeInviteDiff({
        eligible: [{ email: 'a@x.hr', name: 'Ana' }, { email: 'b@x.hr', name: 'Bo' }],
        invites: [],
        portalEmails: new Set(['a@x.hr', 'b@x.hr']),
    });
    check('diff: two new eligible → two creates', diff1.toCreate.length === 2 && diff1.toRevoke.length === 0 && diff1.unchanged === 0);

    const diff2 = ps.computeInviteDiff({
        eligible: [{ email: 'a@x.hr', name: 'Ana' }],
        invites: [{ token: 't1', email: 'a@x.hr', name: 'Ana', picked: false, table: null }],
        portalEmails: new Set(['a@x.hr']),
    });
    check('diff: eligible already invited → unchanged, no create', diff2.toCreate.length === 0 && diff2.unchanged === 1);

    const diff3 = ps.computeInviteDiff({
        eligible: [],
        invites: [{ token: 't1', email: 'a@x.hr', name: 'Ana', picked: false, table: null }],
        portalEmails: new Set(['a@x.hr']),
    });
    check('diff: known refunded + unpicked → revoke', diff3.toRevoke.length === 1 && diff3.toRevoke[0].token === 't1' && diff3.flagged.length === 0);

    const diff4 = ps.computeInviteDiff({
        eligible: [],
        invites: [{ token: 't1', email: 'a@x.hr', name: 'Ana', picked: true, table: 4 }],
        portalEmails: new Set(['a@x.hr']),
    });
    check('diff: known refunded + PICKED → flagged, never revoked', diff4.flagged.length === 1 && diff4.flagged[0].table === 4 && diff4.toRevoke.length === 0);

    const diff5 = ps.computeInviteDiff({
        eligible: [],
        invites: [{ token: 't9', email: 'special@guest.com', name: 'VIP', picked: false, table: null }],
        portalEmails: new Set(['a@x.hr']),
    });
    check('diff: unknown email (console special) → foreign, untouched', diff5.foreign.length === 1 && diff5.toRevoke.length === 0 && diff5.flagged.length === 0);

    const diff6 = ps.computeInviteDiff({
        eligible: [{ email: 'Dup@X.hr', name: 'One' }, { email: 'dup@x.hr', name: 'Two' }],
        invites: [],
        portalEmails: new Set(['dup@x.hr']),
    });
    check('diff: same email twice → deduped to one create', diff6.toCreate.length === 1 && diff6.toCreate[0].email === 'dup@x.hr');

    // ---- runInviteSync with a mock client ----
    const mkClient = (invites, opts = {}) => {
        const calls = { created: [], deleted: [], paidUp: [], paidDel: [] };
        return {
            calls,
            configured: true,
            listInvites: async () => invites,
            createInvite: async (inv) => {
                if (opts.failCreate === inv.email) throw new Error('boom');
                calls.created.push(inv);
            },
            deleteInvite: async (t) => { calls.deleted.push(t); },
            upsertPaidEmail: async (em) => { if (opts.failPaid === em) throw new Error('paid-boom'); calls.paidUp.push(em); },
            deletePaidEmail: async (em) => { calls.paidDel.push(em); },
        };
    };
    let ledger = [];
    let revoked = [];
    const deps = (client) => ({
        getEligible: async () => [{ email: 'new@x.hr', name: 'Novi Gost' }],
        getPortalEmails: async () => new Set(['new@x.hr', 'gone@x.hr']),
        client,
        maxParty: 3,
        onCreated: async (row) => ledger.push(row),
        onRevoked: async (row) => revoked.push(row),
    });
    const c1 = mkClient([{ token: 'g1', email: 'gone@x.hr', name: 'Gone', picked: false, table: null }]);
    const rep1 = await ps.runInviteSync(deps(c1));
    check('run: creates the missing invite (16-hex token, maxParty 3)',
        rep1.created.length === 1 && c1.calls.created.length === 1 && /^[0-9a-f]{16}$/.test(c1.calls.created[0].token) && c1.calls.created[0].maxParty === 3);
    check('run: revokes the refunded unpicked invite', rep1.revoked.length === 1 && c1.calls.deleted[0] === 'g1' && revoked[0].email === 'gone@x.hr');
    check('run: ledger callback recorded the create', ledger.length === 1 && ledger[0].email === 'new@x.hr');
    check('run: ok with no errors', rep1.ok === true && rep1.errors.length === 0);
    // paid_emails markers ride the same pass: create → mark paid, revoke → unmark
    check('run: create ALSO upserts the paid_emails marker', c1.calls.paidUp.includes('new@x.hr') && rep1.paidMarked.includes('new@x.hr'));
    check('run: revoke ALSO deletes the paid_emails marker', c1.calls.paidDel.includes('gone@x.hr') && rep1.paidUnmarked.includes('gone@x.hr'));

    // idempotent second pass — state now converged
    const c2 = mkClient([{ token: c1.calls.created[0].token, email: 'new@x.hr', name: 'Novi Gost', picked: false, table: null }]);
    const rep2 = await ps.runInviteSync(deps(c2));
    check('run: second pass idempotent (1 unchanged, nothing created/deleted)',
        rep2.created.length === 0 && rep2.revoked.length === 0 && rep2.unchanged === 1 && c2.calls.created.length === 0 && c2.calls.deleted.length === 0);
    check('run: kept invite RE-asserts its paid marker (idempotent upsert, no invite churn)',
        c2.calls.paidUp.includes('new@x.hr') && rep2.paidMarked.includes('new@x.hr') && c2.calls.paidDel.length === 0);

    // unconfigured → graceful no-op
    const rep3 = await ps.runInviteSync({ client: { configured: false }, getEligible: async () => [], getPortalEmails: async () => new Set() });
    check('run: unconfigured → configured:false, no throw', rep3.configured === false && rep3.ok === false && /not configured/.test(rep3.errors[0]));

    // create failure is collected, not thrown; other work continues
    ledger = []; revoked = [];
    const c4 = mkClient([], { failCreate: 'new@x.hr' });
    const rep4 = await ps.runInviteSync(deps(c4));
    check('run: create failure collected in errors (retried next pass), not thrown',
        rep4.ok === false && rep4.errors.length === 1 && rep4.created.length === 0 && ledger.length === 0);
    check('run: failed create does NOT mark paid (invite + marker stay consistent)',
        !c4.calls.paidUp.includes('new@x.hr') && rep4.paidMarked.length === 0);

    // paid-mark failure is collected too — never aborts the invite work, self-heals next pass
    ledger = []; revoked = [];
    const c5 = mkClient([], { failPaid: 'new@x.hr' });
    const rep5 = await ps.runInviteSync(deps(c5));
    check('run: paid-mark failure collected in errors, invite still created, not thrown',
        rep5.created.length === 1 && rep5.ok === false && rep5.errors.some((e) => /paid-mark/.test(e)) && rep5.paidMarked.length === 0);

    // ---- buildInviteEmail — approved design ----
    const link = 'https://plexus-tables.netlify.app/?t=00ff00ff00ff00ff';
    const m1 = ps.buildInviteEmail({ name: 'Ana Kovač', link, deadlineHr: '15. studenoga 2026.', deadlineEn: 'November 15, 2026' });
    check('mail: subject is the approved bilingual subject', m1.subject === 'Odaberite svoj stol — Plexus Gala 2026 · Choose your table');
    check('mail: hosted logo header', m1.html.includes('https://plexus-tables.netlify.app/assets/logo-white.png'));
    check('mail: PLEXUS GALA 2026 header', m1.html.includes('PLEXUS GALA 2026'));
    check('mail: red button with approved copy', m1.html.includes('background:#9b1b22') && m1.html.includes('Rezervirajte svoj stol · Reserve your table'));
    check('mail: fallback link under the button', m1.html.includes('Ako gumb ne radi, otvorite · If the button does not work, open:'));
    check('mail: personal link present in button + fallback', m1.html.split(link).length >= 3);
    check('mail: no "Kliknite ovdje"', !/kliknite ovdje/i.test(m1.html));
    check('mail: pr@medx.hr footer', m1.html.includes('mailto:pr@medx.hr'));
    const [hrTxt, enTxt] = m1.text.split('—EN—');
    check('mail: HR block carries HR deadline only', hrTxt.includes('do 15. studenoga 2026.') && !hrTxt.includes('November 15, 2026'));
    check('mail: EN block carries EN deadline only', enTxt.includes('by November 15, 2026') && !enTxt.includes('15. studenoga 2026.'));
    check('mail: html carries both deadlines', m1.html.includes('15. studenoga 2026.') && m1.html.includes('November 15, 2026'));

    const m2 = ps.buildInviteEmail({ name: 'Ana', link, deadlineHr: null, deadlineEn: null });
    check('mail: no deadline → HR sentence dropped, paragraph rest kept',
        !m2.text.includes('Molimo odaberite svoj stol do') && m2.text.includes('Poveznica je osobna i vrijedi samo za Vas.'));
    check('mail: no deadline → EN sentence dropped, paragraph rest kept',
        !m2.text.includes('Please choose your table by') && m2.text.includes('The link is personal and valid only for you.'));

    const m3 = ps.buildInviteEmail({ name: 'Ana <script>alert(1)</script>', link, deadlineHr: null, deadlineEn: null });
    check('mail: guest name is HTML-escaped', m3.html.includes('Ana &lt;script&gt;') && !m3.html.includes('<script>alert'));
    const m4 = ps.buildInviteEmail({ name: '', link, deadlineHr: null, deadlineEn: null });
    check('mail: empty name → neutral salutation', m4.text.includes('gošćo/gostu'));

    // HR deadline only — EN sentence drops, HR stays (mixed configuration)
    const m5 = ps.buildInviteEmail({ name: 'Ana', link, deadlineHr: '15. studenoga 2026.', deadlineEn: null });
    check('mail: HR-only deadline → HR kept, EN sentence dropped',
        m5.text.includes('do 15. studenoga 2026.') && !m5.text.includes('Please choose your table by'));

    // ---- fetchChooseDeadlines ----
    const fsResp = (fields) => async () => ({ ok: true, json: async () => ({ fields }) });
    let dl = await ps.fetchChooseDeadlines(fsResp({ chooseDeadlineHr: { stringValue: 'X hr' }, chooseDeadlineEn: { stringValue: 'X en' } }));
    check('deadline: per-language fields read', dl.hr === 'X hr' && dl.en === 'X en');
    dl = await ps.fetchChooseDeadlines(fsResp({ chooseDeadline: { stringValue: '15. studenoga 2026. · November 15, 2026' } }));
    check('deadline: legacy bilingual field split on ·', dl.hr === '15. studenoga 2026.' && dl.en === 'November 15, 2026');
    dl = await ps.fetchChooseDeadlines(async () => { throw new Error('offline'); });
    check('deadline: fetch failure → nulls (sentence drops, mail still sends)', dl.hr === null && dl.en === null);

    // ---- static guard: triggers are fire-and-forget (never awaited) ----
    const serverSrc = fs.readFileSync(path.join(ROOT, 'admin-portal/backend/server.js'), 'utf8');
    check('static: queueGalaPickerSync is never awaited', !/await\s+queueGalaPickerSync/.test(serverSrc));
    check('static: all three mutation hooks present',
        (serverSrc.match(/queueGalaPickerSync\('gala-status-change'\)/g) || []).length === 1
        && (serverSrc.match(/queueGalaPickerSync\('mark-paid'\)/g) || []).length === 1
        && (serverSrc.match(/queueGalaPickerSync\('finance-confirm'\)/g) || []).length === 1);
    check('static: 30-min sweep registered', /syncGalaPicker\('sweep'\)/.test(serverSrc) && /30 \* 60 \* 1000/.test(serverSrc));
}

// ═════════════════════════════════════════════════════════════════════════════
// Mock Firestore + Identity Toolkit (PART B test seam)
// ═════════════════════════════════════════════════════════════════════════════
function startMockFirebase() {
    const state = {
        invites: new Map(),   // token → { name, email, maxParty, picked, table }
        paid: new Map(),      // sha256hex(email) → { email, ts } — the public paid_emails markers
        settings: { chooseDeadlineHr: '15. studenoga 2026.', chooseDeadlineEn: 'November 15, 2026' },
        delayMs: 0,
        authCalls: 0,
    };
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
    const srv = http.createServer(async (req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
            const u = new URL(req.url, 'http://x');
            const p = u.pathname;
            const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            try {
                // ---- test control plane (never delayed) ----
                if (p === '/__mock/invite' && req.method === 'POST') {
                    const j = JSON.parse(body);
                    state.invites.set(j.token, { name: j.name || '', email: j.email || '', maxParty: j.maxParty || 3, picked: !!j.picked, table: j.table ?? null });
                    return send(200, { ok: true });
                }
                if (p === '/__mock/state') return send(200, { invites: [...state.invites.entries()].map(([t, v]) => ({ token: t, ...v })), paid: [...state.paid.entries()].map(([h, v]) => ({ hash: h, ...v })), authCalls: state.authCalls });
                if (p === '/__mock/config' && req.method === 'POST') { Object.assign(state, JSON.parse(body)); return send(200, { ok: true }); }

                if (state.delayMs) await sleep(state.delayMs);

                // ---- identity toolkit ----
                if (p === '/v1auth/accounts:signInWithPassword') {
                    state.authCalls++;
                    const j = JSON.parse(body || '{}');
                    if (!j.email || !j.password) return send(400, { error: { message: 'MISSING_CREDS' } });
                    return send(200, { idToken: 'mock-id-token', refreshToken: 'r', expiresIn: '3600' });
                }

                // ---- firestore ----
                const fsBase = '/v1fs/projects/plexus-gala-tables/databases/(default)/documents';
                if (p === fsBase + '/config/settings' && req.method === 'GET') {
                    return send(200, { fields: { chooseDeadlineHr: wrap(state.settings.chooseDeadlineHr), chooseDeadlineEn: wrap(state.settings.chooseDeadlineEn) } });
                }
                if (p.startsWith(fsBase + '/invites')) {
                    if ((req.headers.authorization || '') !== 'Bearer mock-id-token') return send(401, { error: { message: 'UNAUTHENTICATED' } });
                    if (p === fsBase + '/invites' && req.method === 'GET') {
                        return send(200, {
                            documents: [...state.invites.entries()].map(([t, v]) => ({
                                name: 'projects/plexus-gala-tables/databases/(default)/documents/invites/' + t,
                                fields: { token: wrap(t), name: wrap(v.name), email: wrap(v.email), maxParty: wrap(v.maxParty), picked: wrap(v.picked), table: wrap(v.table) },
                            })),
                        });
                    }
                    const token = decodeURIComponent(p.slice((fsBase + '/invites/').length));
                    if (req.method === 'PATCH') {
                        if (u.searchParams.get('currentDocument.exists') === 'false' && state.invites.has(token)) return send(409, { error: { message: 'ALREADY_EXISTS' } });
                        const f = (JSON.parse(body || '{}').fields) || {};
                        state.invites.set(token, { name: unwrap(f.name) || '', email: unwrap(f.email) || '', maxParty: unwrap(f.maxParty) || 3, picked: unwrap(f.picked) === true, table: unwrap(f.table) });
                        return send(200, {});
                    }
                    if (req.method === 'DELETE') { state.invites.delete(token); return send(200, {}); }
                }
                if (p.startsWith(fsBase + '/paid_emails')) {
                    // Public GET-by-id, admin-only write — mirror the picker's rules: writes MUST
                    // carry the organizer bearer token, GET is open (unused by the sync).
                    const hash = decodeURIComponent(p.slice((fsBase + '/paid_emails/').length));
                    if (req.method === 'PATCH') {
                        if ((req.headers.authorization || '') !== 'Bearer mock-id-token') return send(401, { error: { message: 'UNAUTHENTICATED' } });
                        const f = (JSON.parse(body || '{}').fields) || {};
                        state.paid.set(hash, { email: unwrap(f.email) || '', ts: unwrap(f.ts) || '' });
                        return send(200, {});
                    }
                    if (req.method === 'DELETE') {
                        if ((req.headers.authorization || '') !== 'Bearer mock-id-token') return send(401, { error: { message: 'UNAUTHENTICATED' } });
                        state.paid.delete(hash); return send(200, {}); // idempotent: absent doc is a no-op
                    }
                    if (req.method === 'GET') { const v = state.paid.get(hash); return v ? send(200, { fields: { email: wrap(v.email), ts: wrap(v.ts) } }) : send(404, { error: { message: 'NOT_FOUND' } }); }
                }
                send(404, { error: { message: 'not found: ' + req.method + ' ' + p } });
            } catch (e) { send(500, { error: { message: e.message } }); }
        });
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, state, port: srv.address().port })));
}

// ═════════════════════════════════════════════════════════════════════════════
// PART B — scratch boot E2E against the mock
// ═════════════════════════════════════════════════════════════════════════════
async function bootTests() {
    const mock = await startMockFirebase();
    const mockBase = 'http://127.0.0.1:' + mock.port;
    const mctl = async (p, body) => (await fetch(mockBase + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const ps = require(path.join(ROOT, 'admin-portal/backend/picker-sync.js')); // for the picker-compatible marker id

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-gps-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', BREVO_API_KEY: '',
        JWT_SECRET: 'gala-picker-sync-test-secret',
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
        p.stderr.on('data', () => {});
        procs.push(p);
        return p;
    };
    const cleanup = () => {
        procs.forEach((p) => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { mock.srv.close(); } catch (e) {}
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('user-portal/backend', 3111);
        await waitUp(USER);
        boot('admin-portal/backend', 3112);
        await waitUp(ADMIN);

        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'juginovic.alen@gmail.com', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('boot: seeded admin login works', r.status === 200 && atok);

        // status endpoint sees the configured engine
        r = await api(ADMIN, '/api/admin/gala/picker-sync', { token: atok });
        check('boot: picker-sync status configured on scratch boot', r.status === 200 && r.d.configured === true && r.d.default_max_party === 3, JSON.stringify(r.d).slice(0, 120));

        // ---- (1) pending registration is NOT eligible ----
        r = await api(USER, '/api/gala/register', { method: 'POST', body: { first_name: 'Sync', last_name: 'Guest', email: 'qa.robot+syncguest@example.com', institution: 'QA', pricing: 'gala' } });
        const regA = r.d && r.d.id;
        check('e2e: public gala registration created (pending)', r.status === 200 || (r.d && r.d.success) || !!regA, JSON.stringify(r.d).slice(0, 120));
        // find the row id via the admin list if the endpoint didn't return one
        let regAId = regA;
        if (!regAId) {
            const list = await api(ADMIN, '/api/gala/registrations', { token: atok });
            const hit = (Array.isArray(list.d) ? list.d : (list.d && list.d.registrations) || []).find((x) => x.email === 'qa.robot+syncguest@example.com');
            regAId = hit && hit.id;
        }
        check('e2e: registration row resolvable', !!regAId);
        r = await api(ADMIN, '/api/admin/gala/picker-sync/run', { method: 'POST', token: atok });
        check('e2e: sync with only a pending reg creates nothing', r.status === 200 && r.d.created.length === 0 && r.d.revoked.length === 0, JSON.stringify(r.d).slice(0, 160));

        // ---- (2) mark paid → AUTOMATIC invite (fire-and-forget trigger, no manual run) ----
        r = await api(ADMIN, '/api/admin/registrant/gala/' + regAId + '/mark-paid', { method: 'POST', token: atok });
        check('e2e: mark-paid succeeds', r.status === 200 && r.d.success);
        await sleep(3500); // debounce 1.5s + run
        let ms = await mctl('/__mock/state');
        let invA = ms.invites.find((i) => i.email === 'qa.robot+syncguest@example.com');
        check('e2e: TRIGGER created the Firestore invite automatically', !!invA, JSON.stringify(ms.invites));
        check('e2e: invite doc matches console shape (16-hex token, maxParty 3, unpicked)',
            invA && /^[0-9a-f]{16}$/.test(invA.token) && invA.maxParty === 3 && invA.picked === false && invA.name === 'Sync Guest');
        // the SAME trigger must have written the public paid_emails marker so the picker's guest
        // page recognises this e-mail as paid — no manual "Refresh paid list" needed
        const paidHashA = ps.paidEmailDocId('qa.robot+syncguest@example.com');
        check('e2e: TRIGGER also wrote the paid_emails marker (picker-compatible sha256 id)',
            ms.paid && ms.paid.some((x) => x.hash === paidHashA && x.email === 'qa.robot+syncguest@example.com'), JSON.stringify(ms.paid));
        r = await api(ADMIN, '/api/admin/gala/picker-sync', { token: atok });
        let ledgerA = (r.d.invites || []).find((i) => i.email === 'qa.robot+syncguest@example.com' && !i.revoked_at);
        check('e2e: gala_picker_invites ledger row written (email lowercased, mail pending)',
            ledgerA && ledgerA.token === invA.token && ledgerA.invited_email_sent === 0);
        check('e2e: pending invitation-mail counter = 1', r.d.pending_invite_emails === 1);
        check('e2e: last-sync report stored (trigger = mark-paid)', r.d.last && r.d.last.trigger === 'mark-paid' && r.d.last.ranAt, JSON.stringify(r.d.last).slice(0, 120));

        // ---- (3) idempotent re-run ----
        r = await api(ADMIN, '/api/admin/gala/picker-sync/run', { method: 'POST', token: atok });
        check('e2e: manual re-run idempotent (1 unchanged, nothing created/revoked)',
            r.status === 200 && r.d.created.length === 0 && r.d.revoked.length === 0 && r.d.unchanged === 1, JSON.stringify(r.d).slice(0, 160));

        // ---- (4) second guest: paid, then PICKS a table, then refund → flagged not deleted ----
        r = await api(USER, '/api/gala/register', { method: 'POST', body: { first_name: 'Picky', last_name: 'Guest', email: 'qa.robot+picky@example.com', pricing: 'gala' } });
        let regBId = r.d && r.d.id;
        if (!regBId) {
            const list = await api(ADMIN, '/api/gala/registrations', { token: atok });
            const hit = (Array.isArray(list.d) ? list.d : (list.d && list.d.registrations) || []).find((x) => x.email === 'qa.robot+picky@example.com');
            regBId = hit && hit.id;
        }
        await api(ADMIN, '/api/admin/registrant/gala/' + regBId + '/mark-paid', { method: 'POST', token: atok });
        await sleep(3500);
        ms = await mctl('/__mock/state');
        const invB = ms.invites.find((i) => i.email === 'qa.robot+picky@example.com');
        check('e2e: second paid guest got an invite via trigger', !!invB);
        // guest books table 5 (console/guest flow does this in Firestore)
        await mctl('/__mock/invite', { token: invB.token, email: invB.email, name: invB.name, maxParty: 3, picked: true, table: 5 });
        r = await api(ADMIN, '/api/gala/registrations/' + regBId, { method: 'PUT', token: atok, body: { status: 'rejected', admin_notes: 'refund — QA' } });
        check('e2e: refund (status→rejected) accepted', r.status === 200);
        await sleep(3500);
        ms = await mctl('/__mock/state');
        check('e2e: PICKED invite of refunded guest NOT deleted', ms.invites.some((i) => i.token === invB.token));
        // invite kept for the organizer's call → its paid marker is kept too (only revoked invites lose theirs)
        check('e2e: flagged guest keeps paid_emails marker (invite kept → marker kept)',
            ms.paid.some((x) => x.email === 'qa.robot+picky@example.com'));
        r = await api(ADMIN, '/api/admin/gala/picker-sync/run', { method: 'POST', token: atok });
        check('e2e: refunded-but-booked guest FLAGGED for organizer decision',
            r.d.flagged.some((f) => f.email === 'qa.robot+picky@example.com' && f.table === 5) && !r.d.revoked.some((f) => f.email === 'qa.robot+picky@example.com'),
            JSON.stringify(r.d.flagged));
        r = await api(ADMIN, '/api/admin/gala/picker-sync', { token: atok });
        check('e2e: flagged guest ledger row NOT revoked', (r.d.invites || []).some((i) => i.email === 'qa.robot+picky@example.com' && !i.revoked_at));

        // ---- (5) refund of UNPICKED guest → invite deleted, revoked_at stamped ----
        r = await api(ADMIN, '/api/gala/registrations/' + regAId, { method: 'PUT', token: atok, body: { status: 'rejected', admin_notes: 'refund — QA' } });
        check('e2e: refund of unpicked guest accepted', r.status === 200);
        await sleep(3500);
        ms = await mctl('/__mock/state');
        check('e2e: unpicked invite DELETED from Firestore (link dead)', !ms.invites.some((i) => i.email === 'qa.robot+syncguest@example.com'));
        // refund revoked the invite → its paid_emails marker must be gone too (email no longer valid as a paid guest)
        check('e2e: refund also DELETED the paid_emails marker', !ms.paid.some((x) => x.hash === paidHashA || x.email === 'qa.robot+syncguest@example.com'));
        r = await api(ADMIN, '/api/admin/gala/picker-sync', { token: atok });
        ledgerA = (r.d.invites || []).find((i) => i.email === 'qa.robot+syncguest@example.com');
        check('e2e: ledger row stamped revoked_at', ledgerA && !!ledgerA.revoked_at);
        check('e2e: pending-mail counter dropped to the flagged guest only', r.d.pending_invite_emails === 1);

        // ---- (6) console-created special guest (unknown email) → foreign, untouched ----
        await mctl('/__mock/invite', { token: 'aaaabbbbccccdddd', email: 'special.vip@sponsor.com', name: 'Sponsor VIP', maxParty: 5, picked: false, table: null });
        r = await api(ADMIN, '/api/admin/gala/picker-sync/run', { method: 'POST', token: atok });
        check('e2e: unknown console invite reported foreign, never revoked',
            r.d.foreign.some((f) => f.email === 'special.vip@sponsor.com') && !r.d.revoked.length, JSON.stringify(r.d).slice(0, 160));
        ms = await mctl('/__mock/state');
        check('e2e: foreign invite still present in Firestore', ms.invites.some((i) => i.token === 'aaaabbbbccccdddd'));

        // ---- (7) re-eligible guest → NEW invite with NEW token ----
        const oldToken = invA.token;
        r = await api(ADMIN, '/api/gala/registrations/' + regAId, { method: 'PUT', token: atok, body: { status: 'approved', admin_notes: 'refund reversed — QA' } });
        await sleep(3500);
        ms = await mctl('/__mock/state');
        invA = ms.invites.find((i) => i.email === 'qa.robot+syncguest@example.com');
        check('e2e: re-eligible guest got a FRESH invite with a new token', invA && invA.token !== oldToken, 'old=' + oldToken + ' new=' + (invA && invA.token));
        check('e2e: re-eligible guest paid_emails marker restored', ms.paid.some((x) => x.hash === paidHashA && x.email === 'qa.robot+syncguest@example.com'));
        r = await api(ADMIN, '/api/admin/gala/picker-sync', { token: atok });
        const rowsA = (r.d.invites || []).filter((i) => i.email === 'qa.robot+syncguest@example.com');
        check('e2e: ledger keeps history (revoked row + new active row)', rowsA.length === 2 && rowsA.some((x) => x.revoked_at) && rowsA.some((x) => !x.revoked_at));
        check('e2e: pending mails now 2 (fresh invite + flagged guest)', r.d.pending_invite_emails === 2);

        // ---- (8) approval-gated invitation mail: stage exactly N, correct HTML, no double-stage ----
        r = await api(ADMIN, '/api/admin/gala/picker-sync/send-invites', { method: 'POST', token: atok });
        check('e2e: "Pošalji pozivnice" staged exactly 2', r.status === 200 && r.d.success && r.d.staged === 2, JSON.stringify(r.d).slice(0, 160));
        check('e2e: deadlines resolved from picker config at send time', r.d.deadline_hr === '15. studenoga 2026.' && r.d.deadline_en === 'November 15, 2026');

        // read the outbox rows straight from the scratch DB
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const mails = tdb.prepare("SELECT * FROM scheduled_emails WHERE source_engine = 'gala-picker-invite'").all();
        check('outbox: exactly 2 rows staged', mails.length === 2);
        const forA = mails.find((m) => m.recipient_email === 'qa.robot+syncguest@example.com');
        const pay = forA && JSON.parse(forA.payload_json);
        check('outbox: From president@medx.hr + reply-to pr@medx.hr', pay && pay.from === 'president@medx.hr' && pay.reply_to === 'pr@medx.hr');
        check('outbox: subject is the approved invite subject', pay && pay.subject === 'Odaberite svoj stol — Plexus Gala 2026 · Choose your table');
        check('outbox: HTML carries hosted logo + button copy', pay && pay.html.includes('assets/logo-white.png') && pay.html.includes('Rezervirajte svoj stol · Reserve your table'));
        check('outbox: HTML carries the guest\'s PERSONAL link (fresh token)', pay && invA && pay.html.includes('?t=' + invA.token));
        check('outbox: HTML carries both deadlines, no "Kliknite ovdje"', pay && pay.html.includes('15. studenoga 2026.') && pay.html.includes('November 15, 2026') && !/kliknite ovdje/i.test(pay.html));
        tdb.close();

        r = await api(ADMIN, '/api/admin/gala/picker-sync/send-invites', { method: 'POST', token: atok });
        check('e2e: second click stages 0 (never double-mails)', r.status === 200 && r.d.staged === 0);
        r = await api(ADMIN, '/api/admin/gala/picker-sync', { token: atok });
        check('e2e: pending counter back to 0', r.d.pending_invite_emails === 0);

        // ---- (9) mutation responses NEVER wait on Firestore (hang test) ----
        await mctl('/__mock/config', { delayMs: 15000 });
        const t0 = Date.now();
        r = await api(ADMIN, '/api/gala/registrations/' + regBId, { method: 'PUT', token: atok, body: { status: 'pending', admin_notes: 'hang test' } });
        const dt = Date.now() - t0;
        check('e2e: status change returns instantly while Firestore hangs (' + dt + 'ms)', r.status === 200 && dt < 2000);
        const t1 = Date.now();
        r = await api(ADMIN, '/api/admin/registrant/gala/' + regBId + '/mark-paid', { method: 'POST', token: atok });
        const dt2 = Date.now() - t1;
        check('e2e: mark-paid returns instantly while Firestore hangs (' + dt2 + 'ms)', r.status === 200 && dt2 < 2000);
        await mctl('/__mock/config', { delayMs: 0 });
        await sleep(2000); // let the queued background pass finish against the healthy mock
    } catch (e) {
        check('unexpected boot-test error: ' + e.message, false);
    } finally {
        cleanup();
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// PART C — guarded E2E against PRODUCTION Firestore (opt-in)
// ═════════════════════════════════════════════════════════════════════════════
async function prodE2E() {
    if (process.env.PICKER_E2E !== '1') {
        console.log('SKIP | prod E2E (set PICKER_E2E=1 + organizer creds to run)');
        return;
    }
    // creds: PICKER_ADMIN_EMAIL/PASSWORD, or guest_picker/.env (ADMIN_CONSOLE_EMAIL/PASSWORD)
    if (!process.env.PICKER_ADMIN_EMAIL || !process.env.PICKER_ADMIN_PASSWORD) {
        const envPath = process.env.GUEST_PICKER_ENV
            || path.join(os.homedir(), 'Documents/Claude_Code_Projects/Esplanade_Emerald_Ballroom/guest_picker/.env');
        if (fs.existsSync(envPath)) {
            for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
                const m = line.match(/^(ADMIN_CONSOLE_EMAIL|ADMIN_CONSOLE_PASSWORD)\s*=\s*(.+)$/);
                if (m) process.env[m[1] === 'ADMIN_CONSOLE_EMAIL' ? 'PICKER_ADMIN_EMAIL' : 'PICKER_ADMIN_PASSWORD'] = m[2].trim();
            }
        }
    }
    // picker-sync reads creds at construction — re-require fresh
    delete require.cache[require.resolve(path.join(ROOT, 'admin-portal/backend/picker-sync.js'))];
    const ps = require(path.join(ROOT, 'admin-portal/backend/picker-sync.js'));
    const client = new ps.PickerClient();
    if (!client.configured) { check('prodE2E: organizer creds available', false, 'no creds found'); return; }

    const token = ps.genInviteToken();
    const email = 'qa.robot+sync@example.com';
    try {
        await client.createInvite({ token, name: 'QA Sync Robot', email, maxParty: 3 });
        // verify via unauthenticated GET (doc id IS the credential — GET is open by rules)
        let r = await fetch('https://firestore.googleapis.com/v1/projects/plexus-gala-tables/databases/(default)/documents/invites/' + token);
        const doc = await r.json();
        check('prodE2E: invite created & readable (link would work)',
            r.ok && doc.fields && doc.fields.email.stringValue === email && doc.fields.picked.booleanValue === false);
        // the sync engine's own listing sees it
        const all = await client.listInvites();
        check('prodE2E: authed LIST sees the QA invite', all.some((i) => i.token === token));
        check('prodE2E: known production test invite untouched', all.some((i) => i.token === 'ddd05a3b30ff3622'));
    } finally {
        // always clean up
        try { await client.deleteInvite(token); } catch (e) { check('prodE2E cleanup failed — DELETE invites/' + token + ' manually', false, e.message); }
    }
    const r2 = await fetch('https://firestore.googleapis.com/v1/projects/plexus-gala-tables/databases/(default)/documents/invites/' + token);
    check('prodE2E: invite revoked — link dead (404)', r2.status === 404);
}

(async () => {
    await unitTests();
    await bootTests();
    await prodE2E();
    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
