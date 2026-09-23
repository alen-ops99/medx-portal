/**
 * tests/account-delete.test.js — DELETE /api/auth/account (user-portal/backend/server.js), the in-app
 * account deletion the App Store asks for (guideline 5.1.1(v)) and GDPR Art. 17.
 *
 * The rules this file proves:
 *   1. Only the signed-in member can call it (no token → 401). A team (is_admin) account is refused
 *      (403) and nothing is touched.
 *   2. ERASED: the member's social / personal rows — networking profile, connections (both legacy
 *      tables), meetings, meeting + intro + mentorship requests, direct messages written or received
 *      (keyed by users.id AND by the email the legacy routes stored), legacy messages, thread state,
 *      push tokens, alerts, followed projects, the newsletter subscription (+ its pr_subscribers
 *      mirror row), user_profiles, saved schedule, pinned items, open sign-in links, photo consent.
 *   3. KEPT exactly as issued: paid registrations (name / email / invoice number), invoices,
 *      finance_transactions, gala payments, points. They still point at the member's users.id.
 *   4. The users row survives as a scrubbed TOMBSTONE (email → deleted-<id>@deleted.medx.invalid,
 *      name "Deleted User", every PII column NULL, deleted_at stamped) — never a hard DELETE.
 *   5. SESSION: every token of the member is dead afterwards (401 "This account has been closed.")
 *      — also for a member with NO paid records. The old code hard-deleted that member's row, and
 *      auth() then bound the still-valid token to its own claims, so the "deleted" member kept
 *      using the API. The old password no longer signs in; the address can sign up afresh.
 *   6. Another member's rows are untouched.
 *   7. Beyond the core tables (verifier round 2026-09-23): every pr_subscribers row on the address is
 *      unsubscribed whatever its source (an admin-import row the app re-activated included) and the address
 *      carries the 'newsletter' opt-out; the Forum profile (forum_members) is scrubbed and closed and leaves the
 *      members-only /api/forum/wing/directory, its Forum connections and group rows go; the portrait file and
 *      message attachment files are deleted from disk; attendance cards lose the address; native push devices
 *      go; dietary / accessibility / custom answers are cleared on registrations with NO payment only.
 *   8. The closed account's old token is ANONYMOUS on the soft-auth routes (/api/forum/wing/me, optionalAuth)
 *      — it never binds the closed account's claims.
 *   9. A new sign-up on the freed address inherits NOTHING: no wallet ticket, no Forum membership, no card
 *      (kept rows match by address only while no account owns them).
 *  10. Team accounts are refused: is_admin, and the admin portal's is_staff / is_founder.
 *  11. Round 3 (2026-09-23): the freed address inherits nothing through /api/my/events (Bridges, Donor Night and
 *      sign-up-form tickets), /api/member/giving, /api/member/passport, /api/v2/meetups/mine or the wallet's Forum
 *      branch (an unclaimed Forum record on the address is claimed by the tombstone). A meetup place is released
 *      (the first person waiting moves up) and the host no longer sees the name, address or bio. Mail still queued
 *      to the address is cancelled; the milestone reconcile never queues mail to the tombstone; drip_log forgets the
 *      address. The newsletter opt-out is stored lower-case (and merges a mixed-case row). Free 'n/a' Building
 *      Bridges answers are cleared, a paid Donor Night row is not; sign-up-form answers are cleared and the row
 *      takes the tombstone's address. BLOCKS: the member's own blocks go; a block another member placed stays with
 *      that conversation, and a new sign-up on the address inherits it (no message, no request). An account that
 *      never confirmed its address leaves address-only rows alone. A suspended member gets 403 (writes to info@).
 *
 * Scratch boot, the house pattern of tests/member-audit-fixes.test.js: the user portal alone on a
 * throwaway SQLite file — no Turso, no mail provider, no Stripe, no FIRA — plus a preload (written to
 * the scratch dir) that refuses every outbound socket and fetch except localhost. The run aborts if
 * user-portal/backend/.env exists (its loader fills blank env vars). Nothing here can reach production.
 *
 * Run: node tests/account-delete.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3149;
const USER = 'http://localhost:' + PORT;

if (fs.existsSync(path.join(ROOT, 'user-portal/backend/.env'))) {
    console.error('ABORT: user-portal/backend/.env exists — its loader would fill the blanked keys (Turso, mail). Move it away to run this test.');
    process.exit(2);
}

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 240) : ''));
};

const api = async (p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(USER + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

// the spawned server may talk to localhost only
const NO_NET = `
const net = require('net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const o = args[0] && typeof args[0] === 'object' ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (o && o.path) return connect.apply(this, args);
    const h = String((o && (o.host || o.hostname)) || 'localhost');
    if (!/^(localhost|127\\.0\\.0\\.1|::1|::ffff:127\\.0\\.0\\.1)$/.test(h)) {
        const e = new Error('NETWORK DISABLED IN TESTS (' + h + ')');
        process.nextTick(() => this.destroy(e));
        return this;
    }
    return connect.apply(this, args);
};
global.fetch = async (u) => { throw new Error('NETWORK DISABLED IN TESTS ' + String(u).slice(0, 80)); };
`;

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-acct-del-'));
    const testFiles = [];     // files this run writes under the backend's uploads dir — removed on exit
    const dbPath = path.join(scratch, 'scratch.db');
    const preload = path.join(scratch, 'no-network.js');
    fs.writeFileSync(preload, NO_NET);
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
        FIRA_API_KEY: '', CLOUDINARY_URL: '', GOOGLE_SHEETS_ID: '',
        JWT_SECRET: 'account-delete-test-secret',
        NODE_ENV: 'test', PORT: String(PORT)
    };
    let proc = null, errbuf = '';
    const cleanup = () => {
        if (proc) { try { proc.kill('SIGKILL'); } catch (e) {} }
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
        for (const f of testFiles) { try { fs.unlinkSync(f); } catch (e) {} }
    };
    process.on('exit', cleanup);

    try {
        proc = spawn('node', ['-r', preload, 'server.js'], { cwd: path.join(ROOT, 'user-portal/backend'), env, stdio: ['ignore', 'ignore', 'pipe'] });
        proc.stderr.on('data', d => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        await waitUp(USER);

        // ---- five accounts: A (paid records, will delete) · B (peer) · C (no paid records, will delete) · T (team) · S (door staff) ----
        const signup = async (tag, first, last) => {
            const email = `qa.acctdel+${tag}@example.com`;
            const r = await api('/api/auth/register', { method: 'POST', body: { email, password: 'test-password-9', first_name: first, last_name: last, institution: 'Deletion Institute', country: 'Croatia' } });
            return { token: r.d && r.d.token, id: r.d && r.d.user && r.d.user.id, email, status: r.status };
        };
        const A = await signup('a', 'Ana', 'Leaving');
        const B = await signup('b', 'Boris', 'Staying');
        const C = await signup('c', 'Cvita', 'Freeonly');
        const T = await signup('t', 'Tea', 'Team');
        const S = await signup('s', 'Sara', 'Staff');
        const D = await signup('d', 'Dora', 'Blocker');          // blocked A without reporting (the abuse case)
        const W = await signup('w', 'Wes', 'Waiting');           // on the waitlist of the meetup A has a place at
        const U = await signup('u', 'Una', 'Unconfirmed');       // never confirms the address, then deletes
        const M = await signup('Mixed.Case', 'Mia', 'Mixedcase'); // an address typed with capitals
        check('scratch boot: nine signups work', [A, B, C, T, S, D, W, U, M].every(u => u.status === 200 && u.token && u.id));

        const Database = require(path.join(ROOT, 'user-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const q = (sql, params = []) => tdb.prepare(sql).run(...params);
        // libsql adds a per-query `_metadata` (timing) to each row — dropped so rows compare by content
        const one = (sql, params = []) => { const row = tdb.prepare(sql).get(...params); if (row) delete row._metadata; return row; };
        const n = (sql, params = []) => Number((one(sql, params) || {}).c || 0);
        q('UPDATE users SET email_verified = 1, is_public_profile = 1 WHERE id IN (?, ?, ?, ?, ?, ?, ?)', [A.id, B.id, C.id, T.id, D.id, W.id, M.id]);
        q('UPDATE users SET email_verified = 0 WHERE id = ?', [U.id]);
        q('UPDATE users SET is_admin = 1 WHERE id = ?', [T.id]);
        // A's portrait as the Profile screen stores it (uploads/profile/<id>.jpg — the test server's own uploads dir,
        // gitignored) and one message attachment file; both must be gone from disk after the deletion
        const UPLOADS = path.join(ROOT, 'user-portal/backend/uploads');
        const photoFile = path.join(UPLOADS, 'profile', A.id + '.jpg');
        const attachName = 'acctdel-' + A.id + '.png';
        const attachFile = path.join(UPLOADS, 'messages', attachName);
        for (const f of [photoFile, attachFile]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])); }
        testFiles.push(photoFile, attachFile);
        q(`UPDATE users SET phone = '+385 91 000 0000', bio = 'Sleep researcher', photo_url = ?, title = 'Postdoc', city = 'Zagreb', specialties = '["SLEEP"]', last_login = '2026-09-01' WHERE id = ?`, ['/uploads/profile/' + A.id + '.jpg?v=1', A.id]);

        // ---- A's social / personal rows (and one of each for B ↔ C, which must survive) ----
        const seedSocial = (X, Y, tag) => {
            q(`INSERT INTO networking_profiles (id, user_id, research_interests) VALUES (?, ?, 'sleep')`, ['np-' + tag, X.id]);
            q(`INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES (?, ?, ?, 'accepted')`, ['nc1-' + tag, X.id, Y.id]);
            q(`INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES (?, ?, ?, 'pending')`, ['nc2-' + tag, Y.id, X.id]);
            q(`INSERT INTO networking_meetings (id, organizer_id, attendee_id, date, time) VALUES (?, ?, ?, '2026-12-04', '10:00')`, ['nm1-' + tag, Y.id, X.id]);
            q(`INSERT INTO pending_meetings (id, requester_id, recipient_id) VALUES (?, ?, ?)`, ['pm-' + tag, X.id, Y.id]);
            q(`INSERT INTO meeting_requests (id, requester_id, requestee_id) VALUES (?, ?, ?)`, ['mr-' + tag, Y.id, X.id]);
            q(`INSERT INTO connections (id, requester_id, requestee_id, status) VALUES (?, ?, ?, 'accepted')`, ['cx-' + tag, Y.id, X.id]);
            q(`INSERT INTO intro_requests (id, from_user_id, via_user_id, to_user_id) VALUES (?, ?, NULL, ?)`, ['ir-' + tag, X.id, Y.id]);
            q(`INSERT INTO mentorship_profiles (user_id, role) VALUES (?, 'mentor')`, [X.id]);
            q(`INSERT INTO mentorship_requests (id, from_user_id, to_user_id) VALUES (?, ?, ?)`, ['mq-' + tag, Y.id, X.id]);
            // direct messages: member↔member by id, member→team by EMAIL (legacy key), team→member by id
            q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES (?, ?, ?, 'hello', 'user', 'user')`, ['dm1-' + tag, X.id, Y.id]);
            q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES (?, ?, ?, 'reply', 'user', 'user')`, ['dm2-' + tag, Y.id, X.id]);
            q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES (?, ?, 'info@medx.hr', 'question for the team', 'user', 'admin')`, ['dm3-' + tag, X.email]);
            q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES (?, ?, ?, 'team answer', 'admin', 'user')`, ['dm4-' + tag, T.id, X.email]);
            q(`INSERT INTO messages (id, sender_id, recipient_id, body) VALUES (?, ?, ?, 'legacy')`, ['lm-' + tag, Y.id, X.id]);
            q(`INSERT INTO v2_message_thread_state (user_id, thread_key, archived) VALUES (?, 'team', 1)`, [X.id]);
            q(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, 'k', 'a')`, ['ps-' + tag, X.id, 'https://push.example/' + tag]);
            q(`INSERT INTO user_notifications (id, user_id, title) VALUES (?, ?, 'Your ticket')`, ['un-' + tag, X.id]);
            q(`INSERT INTO notify_topics (user_id, project_key) VALUES (?, 'plexus')`, [X.id]);
            q(`INSERT INTO v2_newsletter_subscriptions (id, user_id, email, confirmed_at, manage_token) VALUES (?, ?, ?, '2026-09-01', ?)`, ['nl-' + tag, X.id, X.email, (tag + '0'.repeat(64)).slice(0, 64)]);
            q(`INSERT INTO pr_subscribers (id, email, first_name, last_name, status, source) VALUES (?, ?, ?, 'X', 'active', 'member-portal-v2')`, ['pr-' + tag, X.email, tag]);
            q(`INSERT INTO user_profiles (user_id, dietary_requirements, emergency_contact_name) VALUES (?, 'vegetarian', 'Mum')`, [X.id]);
            q(`INSERT INTO personal_schedules (id, user_id, session_id) VALUES (?, ?, 's-1')`, ['sc-' + tag, X.id]);
            q(`INSERT INTO pinned_items (id, user_id, item_type, item_title) VALUES (?, ?, 'event', 'Plexus')`, ['pi-' + tag, X.id]);
            q(`INSERT INTO card_photo_consents (user_id, email, consent) VALUES (?, ?, 1)`, [X.id, X.email]);
            q(`INSERT INTO v2_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)`, [X.id, Y.id]);
            q(`INSERT INTO v2_reports (id, reporter_user_id, target_kind, target_id, target_user_id, reason) VALUES (?, ?, 'member', ?, ?, 'spam')`, ['rp-' + tag, Y.id, X.id, X.id]);
        };
        // REPORT / BLOCK tables (shared/safety-core.js) — created here too, in case the module is not mounted yet
        q(`CREATE TABLE IF NOT EXISTS v2_blocks (blocker_user_id TEXT NOT NULL, blocked_user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (blocker_user_id, blocked_user_id))`);
        q(`CREATE TABLE IF NOT EXISTS v2_reports (id TEXT PRIMARY KEY, reporter_user_id TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, target_user_id TEXT, reason TEXT NOT NULL, note TEXT,
           status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_by TEXT, reviewed_at TEXT, action_note TEXT)`);
        seedSocial(A, B, 'a');
        // B ↔ C rows (C is deleted later, so B's own profile is seeded apart from any pair)
        q(`INSERT INTO networking_profiles (id, user_id, research_interests) VALUES ('np-b', ?, 'cardio')`, [B.id]);
        q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES ('dm-b-team', ?, 'info@medx.hr', 'B asks the team', 'user', 'admin')`, [B.id]);
        q(`INSERT INTO notify_topics (user_id, project_key) VALUES (?, 'gala')`, [B.id]);
        q(`INSERT INTO v2_newsletter_subscriptions (id, user_id, email, confirmed_at, manage_token) VALUES ('nl-b', ?, ?, '2026-09-01', ?)`, [B.id, B.email, 'b'.repeat(64)]);
        q(`INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES ('nc-bt', ?, ?, 'accepted')`, [B.id, T.id]);
        // C: a few social rows, a FREE registration, nothing paid
        q(`INSERT INTO networking_profiles (id, user_id) VALUES ('np-c', ?)`, [C.id]);
        q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES ('dm-c', ?, ?, 'hi B', 'user', 'user')`, [C.id, B.id]);
        // C's address was ALREADY on the PR list (admin import); subscribing in the app re-activated that row in place
        // (v2/newsletter.js mirrorSubscribe keeps the row's source) — so it is not a 'member-portal-v2' row
        q(`INSERT INTO pr_subscribers (id, email, first_name, last_name, status, source) VALUES ('pr-c-import', ?, 'Cvita', 'F', 'active', 'import')`, [C.email]);

        // A received a message with an attachment file (B → A)
        q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type, attachment_path, attachment_name) VALUES ('dm5-a', ?, ?, 'the poster', 'user', 'user', ?, 'poster.png')`,
            [B.id, A.id, '/uploads/messages/' + attachName]);
        // A's Forum membership with a full profile, B's membership (so B may open the members-only wing), a Forum
        // connection between them and a group seat for A
        q(`INSERT INTO forum_members (id, user_id, email, first_name, last_name, institution, bio, research_interests, photo_url, linkedin_url, orcid_id, position, specialty,
                                      location_city, membership_status, profile_visibility, approved_at)
           VALUES ('fm-a', ?, ?, 'Ana', 'Leaving', 'Deletion Institute', 'Bio of Ana', 'sleep and the gut', '/uploads/profile/' || ? || '.jpg', 'https://linkedin.com/in/ana', '0000-0001', 'Postdoc', 'Neurology',
                   'Zagreb', 'approved', 'members', '2026-01-01')`, [A.id, A.email, A.id]);
        q(`INSERT INTO forum_members (id, user_id, email, first_name, last_name, membership_status, approved_at) VALUES ('fm-b', ?, ?, 'Boris', 'Staying', 'approved', '2026-01-01')`, [B.id, B.email]);
        // S reads the wing directory below (A and B block each other in seedSocial, so B never sees A there anyway)
        q(`INSERT INTO forum_members (id, user_id, email, first_name, last_name, membership_status, approved_at) VALUES ('fm-s', ?, ?, 'Sara', 'Staff', 'approved', '2026-01-01')`, [S.id, S.email]);
        q(`INSERT INTO forum_connections (id, requester_id, receiver_id, status) VALUES ('fc-ab', 'fm-a', 'fm-b', 'accepted')`);
        q(`INSERT INTO forum_groups (id, name, slug) VALUES ('g-1', 'Sleep and the gut', 'sleep-gut')`);
        q(`INSERT INTO forum_group_members (id, group_id, member_id) VALUES ('fg-a', 'g-1', 'fm-a')`);
        // an attendance card mailed to A's address, and a native push device (the table belongs to the app shell;
        // created here when this engine lacks it)
        q(`INSERT INTO v2_attendance_cards (id, user_id, kind, registration_ref, event_name, email_to) VALUES ('card-a', ?, 'plexus', 'reg-paid', 'Plexus Test', ?)`, [A.id, A.email]);
        q(`CREATE TABLE IF NOT EXISTS push_devices (id TEXT PRIMARY KEY, user_id TEXT, token TEXT)`);
        q(`INSERT INTO push_devices (id, user_id, token) VALUES ('pd-a', ?, 'apns-token-a')`, [A.id]);
        // a Forum invitation code issued to someone else's address — check-code answers 403 email_mismatch to a
        // signed-in member and 200 to an anonymous caller (the probe for optionalAuth below)
        q(`INSERT INTO v2_forum_invites (id, code, email, name, expires_at) VALUES ('inv-x', 'FRM-ACCT-DEL1', 'someone.else@example.com', 'Someone Else', '2099-01-01')`);

        // ---- round 3 seeds ----
        const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 16);
        const futureDay = future.slice(0, 10);
        // D blocked A after A wrote to D (two messages: one by id, one under the legacy email key) — no report filed
        q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type, sender_name) VALUES ('dm-ad1', ?, ?, 'Answer me or you will regret it', 'user', 'user', 'Ana Leaving')`, [A.id, D.id]);
        q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES ('dm-ad2', ?, ?, 'Why are you ignoring me?', 'user', 'user')`, [A.email, D.id]);
        q(`INSERT INTO direct_messages (id, sender_id, receiver_id, content, sender_type, receiver_type) VALUES ('dm-da', ?, ?, 'Please stop.', 'user', 'user')`, [D.id, A.id]);
        q(`INSERT INTO v2_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)`, [D.id, A.id]);
        // a Plexus Week meetup hosted by B, capacity 1: A holds the place, W waits
        q(`INSERT INTO plexus_meetups (id, edition_id, title, kind, starts_at, capacity, waitlist_enabled, visibility, status, host_user_id, host_name, host_email)
           VALUES ('mt-1', 'plexus-2026', 'Sleep science coffee', 'coffee', ?, 1, 1, 'open', 'published', ?, 'Boris Staying', ?)`, [future, B.id, B.email]);
        q(`INSERT INTO plexus_meetup_attendees (id, meetup_id, user_id, first_name, last_name, email, institution, position, bio, status, source, manage_token, confirmed_at)
           VALUES ('att-a', 'mt-1', ?, 'Ana', 'Leaving', ?, 'Deletion Institute', 'Postdoc', 'Sleep researcher at Harvard, Rogulja lab', 'confirmed', 'portal', 'tok-att-a', datetime('now'))`, [A.id, A.email]);
        q(`INSERT INTO plexus_meetup_attendees (id, meetup_id, user_id, first_name, last_name, email, status, waitlist_pos, source, manage_token)
           VALUES ('att-w', 'mt-1', ?, 'Wes', 'Waiting', ?, 'waitlisted', 1, 'portal', 'tok-att-w')`, [W.id, W.email]);
        // Donor Night (paid, A's account) and a FREE Building Bridges seat made as a guest on A's address ('n/a' — the public form)
        q(`INSERT INTO bridges_events (id, name, city, venue_name, event_date, status, slug, is_published) VALUES ('be-donor-t', 'Plexus Donor Night T', 'Zagreb', 'Esplanade', ?, 'open', 'donor-night-t', 1)`, [futureDay]);
        q(`UPDATE bridges_events SET slug = 'donor-night-old' WHERE slug = 'donor-night'`);
        q(`UPDATE bridges_events SET slug = 'donor-night' WHERE id = 'be-donor-t'`);
        q(`INSERT INTO bridges_events (id, name, city, venue_name, event_date, status, slug, is_published) VALUES ('be-bb-t', 'Building Bridges Boston T', 'Boston', 'HMS', ?, 'open', 'bb-boston-t', 1)`, [futureDay]);
        q(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status, payment_status, amount_paid, registered_at, qr_code, user_id, dietary_requirements)
           VALUES ('br-donor-a', 'be-donor-t', 'Ana', 'Leaving', ?, 'confirmed', 'paid', 500, datetime('now'), 'QR-DONOR-A', ?, 'pescatarian')`, [A.email, A.id]);
        q(`INSERT INTO bridges_registrations (id, event_id, first_name, last_name, email, status, payment_status, registered_at, qr_code, dietary_requirements, special_requests)
           VALUES ('br-bb-a', 'be-bb-t', 'Ana', 'Leaving', ?, 'registered', 'n/a', datetime('now'), 'QR-BB-A', 'coeliac, severe nut allergy', 'wheelchair access')`, [A.email]);
        // a free sign-up-form event on A's address (no account column on that table)
        q(`INSERT INTO signup_forms (id, slug, title, event_date, venue, status) VALUES ('sf-t', 'journal-club-t', 'Journal club', ?, 'HMS', 'open')`, [futureDay]);
        q(`INSERT INTO signup_form_responses (id, form_id, name, email, answers_json) VALUES ('sfr-a', 'sf-t', 'Ana Leaving', ?, '{"diet":"vegan"}')`, [A.email]);
        // an admin-imported Forum record on A's address that no account ever claimed, with a Forum event registration
        q(`INSERT INTO forum_members (id, user_id, email, first_name, last_name, bio, membership_status, approved_at) VALUES ('fm-a-guest', NULL, ?, 'Ana', 'Leaving', 'imported bio', 'approved', '2026-01-01')`, [A.email]);
        q(`INSERT INTO forum_events (id, title, start_date, venue, status, slug) VALUES ('fe-t', 'Biomedical Forum T', ?, 'Split', 'published', 'forum-t')`, [futureDay]);
        q(`INSERT INTO forum_event_registrations (id, event_id, member_id, status, payment_status, qr_code, email, first_name, last_name, registered_at)
           VALUES ('fer-a', 'fe-t', 'fm-a-guest', 'registered', 'free', 'QR-FORUM-A', ?, 'Ana', 'Leaving', datetime('now'))`, [A.email]);
        // mail queued to A's address by another engine (a reminder), next to the sign-up's own welcome drip
        q(`INSERT INTO scheduled_emails (id, status, source_engine, template, recipient_email, subject, payload_json, scheduled_for, created_by)
           VALUES ('se-a-rem', 'scheduled', 'meetup-reminder', 'reminder', ?, 'See you tomorrow', '{}', ?, 'test')`, [A.email, future.replace('T', ' ')]);
        // U never confirmed the address: a guest registration and a sign-up-form row on it belong to the address
        q(`INSERT INTO conferences (id, name, year, slug, is_active) VALUES ('conf-u', 'Plexus U', 2031, 'plexus-u', 0)`);
        q(`INSERT INTO registrations (id, conference_id, user_id, status, payment_status, first_name, last_name, email, dietary_requirements)
           VALUES ('reg-guest-u', 'conf-u', NULL, 'confirmed', 'free', 'Una', 'Real', ?, 'halal')`, [U.email]);
        q(`INSERT INTO signup_form_responses (id, form_id, name, email, answers_json) VALUES ('sfr-u', 'sf-t', 'Una Real', ?, '{"diet":"halal"}')`, [U.email]);
        // M's address as typed at sign-up carries capitals; an older opt-out row was stored the same way
        q(`INSERT INTO email_optouts (email, scopes) VALUES (?, 'reminders')`, [M.email]);

        // ---- A's financial / event records (must survive exactly as issued) ----
        q(`INSERT INTO conferences (id, name, year, slug, is_active) VALUES ('conf-t', 'Plexus Test', 2031, 'plexus-test', 0)`);
        q(`INSERT INTO registrations (id, conference_id, user_id, status, payment_status, amount_paid, invoice_number, first_name, last_name, email, institution, dietary_requirements, accessibility_needs)
           VALUES ('reg-paid', 'conf-t', ?, 'confirmed', 'paid', 150, 'R-2031-001', 'Ana', 'Leaving', ?, 'Deletion Institute', 'vegetarian', 'step-free access')`, [A.id, A.email]);
        q(`INSERT INTO registrations (id, conference_id, user_id, status, payment_status, first_name, last_name, email, dietary_requirements, accessibility_needs, custom_answers)
           VALUES ('reg-free-c', 'conf-t', ?, 'confirmed', 'free', 'Cvita', 'Freeonly', ?, 'vegan', 'wheelchair', '{"shirt":"M"}')`, [C.id, C.email]);
        // a GUEST registration on A's address (no account linked yet — e.g. filed from the public form after A's last sign-in)
        q(`INSERT INTO registrations (id, conference_id, user_id, status, payment_status, first_name, last_name, email, dietary_requirements)
           VALUES ('reg-guest-a', 'conf-t', NULL, 'confirmed', 'free', 'Ana', 'Leaving', ?, 'gluten-free')`, [A.email]);
        q(`INSERT INTO invoices (id, invoice_number, registration_id, recipient_name, recipient_email, total, status, issued_at)
           VALUES ('inv-1', 'R-2031-001', 'reg-paid', 'Ana Leaving', ?, 150, 'paid', '2031-01-02')`, [A.email]);
        q(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, reference)
           VALUES ('ft-1', 'T-2031-001', 'income', 150, '2031-01-02', 'Plexus ticket Ana Leaving', 'reg-paid')`);
        q(`INSERT INTO gala_registrations (id, first_name, last_name, email, user_id, payment_status, amount_paid, invoice_number)
           VALUES ('gala-1', 'Ana', 'Leaving', ?, ?, 'paid', 120, 'G-2031-001')`, [A.email, A.id]);
        q(`INSERT INTO points_ledger (id, user_id, delta, reason) VALUES ('pl-1', ?, 25, 'verify')`, [A.id]);
        const fin = () => JSON.stringify({
            reg: one(`SELECT user_id, status, payment_status, amount_paid, invoice_number, first_name, last_name, email, dietary_requirements, accessibility_needs FROM registrations WHERE id = 'reg-paid'`),
            inv: one(`SELECT invoice_number, recipient_name, recipient_email, total, status FROM invoices WHERE id = 'inv-1'`),
            ft: one(`SELECT transaction_number, amount, description, reference FROM finance_transactions WHERE id = 'ft-1'`),
            gala: one(`SELECT user_id, first_name, last_name, email, payment_status, amount_paid, invoice_number FROM gala_registrations WHERE id = 'gala-1'`),
            donor: one(`SELECT user_id, email, payment_status, amount_paid, qr_code, dietary_requirements FROM bridges_registrations WHERE id = 'br-donor-a'`),
            pts: one(`SELECT user_id, delta FROM points_ledger WHERE id = 'pl-1'`)
        });
        const finBefore = fin();

        // sanity: A is signed in before
        let r = await api('/api/auth/me', { token: A.token });
        check('before: A\'s token reads /api/auth/me', r.status === 200 && r.d && r.d.email === A.email, JSON.stringify(r.d));
        const walletIds = (d) => JSON.stringify(d || {}).match(/reg-paid|gala-1/g) || [];
        r = await api('/api/v2/wallet/tickets', { token: A.token });
        check('before: A\'s wallet carries the paid ticket (baseline for the re-signup check)', r.status === 200 && walletIds(r.d).includes('reg-paid'), r.status + ' ' + JSON.stringify(r.d).slice(0, 200));
        r = await api('/api/v2/forum/state', { token: A.token });
        check('before: A is a Forum member (baseline)', r.status === 200 && r.d && r.d.membership && r.d.membership.is_member === true, JSON.stringify(r.d && r.d.membership));
        const wingNames = async (token) => { const w = await api('/api/forum/wing/directory?limit=60', { token }); return { status: w.status, names: ((w.d && w.d.members) || []).map(m => m.name), raw: JSON.stringify(w.d || {}) }; };
        let wing = await wingNames(S.token);
        check('before: another Forum member sees Ana in the members-only wing directory', wing.status === 200 && wing.names.includes('Ana Leaving'), wing.status + ' ' + wing.names.join(', '));
        r = await api('/api/v2/forum/check-code', { method: 'POST', token: B.token, body: { code: 'FRM-ACCT-DEL1' } });
        check('probe: a signed-in member gets email_mismatch on someone else\'s code', r.status === 403 && r.d && r.d.code === 'email_mismatch', r.status + ' ' + JSON.stringify(r.d));
        r = await api('/api/v2/meetups/mt-1/host', { token: B.token });
        check('before: the meetup host sees Ana (name, bio) with the place; Wes waits', r.status === 200 && /Rogulja/.test(JSON.stringify(r.d)) && r.d.headcount && r.d.headcount.waitlisted === 1, r.status + ' ' + JSON.stringify(r.d && r.d.headcount));
        r = await api('/api/member/giving', { token: A.token });
        check('before: A is a Donor Night supporter (baseline)', r.status === 200 && r.d && r.d.is_supporter === true && r.d.total === 500, JSON.stringify(r.d));
        r = await api('/api/my/events', { token: A.token });
        const evIds = (d) => [...((d && d.upcoming) || []), ...((d && d.past) || [])].map(i => i.id);
        check('before: A\'s events carry Donor Night, Building Bridges and the sign-up form (baseline)', ['br-donor-a', 'br-bb-a', 'sfr-a'].every(x => evIds(r.d).includes(x)), JSON.stringify(evIds(r.d)));
        const schedA = n("SELECT COUNT(*) AS c FROM scheduled_emails WHERE lower(recipient_email) = lower(?) AND status IN ('scheduled','pending_approval')", [A.email]);
        check('before: mail is queued to A\'s address (the welcome drip + a reminder)', schedA >= 2, schedA);

        // ---- 1. guards ----
        r = await api('/api/auth/account', { method: 'DELETE' });
        check('no token → 401', r.status === 401, JSON.stringify(r.d));
        r = await api('/api/auth/account', { method: 'DELETE', token: T.token });
        check('team (is_admin) account → 403 with a message', r.status === 403 && /team account/i.test(String(r.d && r.d.error)), JSON.stringify(r.d));
        const tRow = one('SELECT email, deleted_at FROM users WHERE id = ?', [T.id]);
        check('team account untouched by the refusal', tRow && tRow.email === T.email && !tRow.deleted_at);
        // the admin portal's door-staff / founder roles live on the shared users table (added by the admin schema)
        for (const col of ['is_staff', 'is_founder']) { try { q(`ALTER TABLE users ADD COLUMN ${col} INTEGER DEFAULT 0`); } catch (e) { /* exists */ } }
        q('UPDATE users SET is_staff = 1 WHERE id = ?', [S.id]);
        r = await api('/api/auth/account', { method: 'DELETE', token: S.token });
        check('staff (is_staff) account → 403, untouched', r.status === 403 && /team account/i.test(String(r.d && r.d.error)) && !(one('SELECT deleted_at FROM users WHERE id = ?', [S.id]) || {}).deleted_at, r.status + ' ' + JSON.stringify(r.d));
        q('UPDATE users SET is_staff = 0, is_founder = 1 WHERE id = ?', [S.id]);
        r = await api('/api/auth/account', { method: 'DELETE', token: S.token });
        check('founder (is_founder) account → 403, untouched', r.status === 403 && !(one('SELECT deleted_at FROM users WHERE id = ?', [S.id]) || {}).deleted_at, r.status + ' ' + JSON.stringify(r.d));

        // ---- 2. A deletes (bodyless DELETE, as every client sends it) ----
        r = await api('/api/auth/account', { method: 'DELETE', token: A.token });
        check('A: DELETE → 200 success', r.status === 200 && r.d && r.d.success === true, JSON.stringify(r.d));
        check('A: response says paid records were kept (anonymized:true) with a message', r.d && r.d.anonymized === true && /accounting/i.test(String(r.d.message)), JSON.stringify(r.d));

        // ---- tombstone ----
        const a = one('SELECT * FROM users WHERE id = ?', [A.id]);
        check('A: users row kept as a tombstone (no hard delete)', !!a);
        check('A: email anonymised', a && a.email === `deleted-${A.id}@deleted.medx.invalid`, a && a.email);
        check('A: name → Deleted User, password gone', a && a.first_name === 'Deleted' && a.last_name === 'User' && a.password_hash == null);
        check('A: every PII column cleared', a && ['phone', 'institution', 'country', 'bio', 'photo_url', 'title', 'city', 'specialties', 'last_login', 'verification_token', 'reset_token'].every(c => a[c] == null),
            a && JSON.stringify({ phone: a.phone, institution: a.institution, country: a.country, bio: a.bio, photo_url: a.photo_url, title: a.title, city: a.city, specialties: a.specialties }));
        check('A: hidden from the directory, deleted_at stamped', a && Number(a.is_public_profile) === 0 && !!a.deleted_at);
        check('A: no row anywhere still carries the old address in users', n('SELECT COUNT(*) AS c FROM users WHERE lower(email) = lower(?)', [A.email]) === 0);

        // ---- erased ----
        const gone = {
            networking_profiles: n('SELECT COUNT(*) AS c FROM networking_profiles WHERE user_id = ?', [A.id]),
            networking_connections: n('SELECT COUNT(*) AS c FROM networking_connections WHERE requester_id = ? OR receiver_id = ?', [A.id, A.id]),
            networking_meetings: n('SELECT COUNT(*) AS c FROM networking_meetings WHERE organizer_id = ? OR attendee_id = ?', [A.id, A.id]),
            pending_meetings: n('SELECT COUNT(*) AS c FROM pending_meetings WHERE requester_id = ? OR recipient_id = ?', [A.id, A.id]),
            meeting_requests: n('SELECT COUNT(*) AS c FROM meeting_requests WHERE requester_id = ? OR requestee_id = ?', [A.id, A.id]),
            connections: n('SELECT COUNT(*) AS c FROM connections WHERE requester_id = ? OR requestee_id = ?', [A.id, A.id]),
            intro_requests: n('SELECT COUNT(*) AS c FROM intro_requests WHERE from_user_id = ? OR to_user_id = ?', [A.id, A.id]),
            mentorship_profiles: n('SELECT COUNT(*) AS c FROM mentorship_profiles WHERE user_id = ?', [A.id]),
            mentorship_requests: n('SELECT COUNT(*) AS c FROM mentorship_requests WHERE from_user_id = ? OR to_user_id = ?', [A.id, A.id]),
            // (the conversation with D, who blocked A, is the one that stays — checked below)
            direct_messages: n('SELECT COUNT(*) AS c FROM direct_messages WHERE (sender_id IN (?, ?) OR receiver_id IN (?, ?)) AND sender_id <> ? AND receiver_id <> ?', [A.id, A.email, A.id, A.email, D.id, D.id]),
            messages: n('SELECT COUNT(*) AS c FROM messages WHERE sender_id = ? OR recipient_id = ?', [A.id, A.id]),
            v2_message_thread_state: n('SELECT COUNT(*) AS c FROM v2_message_thread_state WHERE user_id = ?', [A.id]),
            push_subscriptions: n('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?', [A.id]),
            user_notifications: n('SELECT COUNT(*) AS c FROM user_notifications WHERE user_id = ?', [A.id]),
            notify_topics: n('SELECT COUNT(*) AS c FROM notify_topics WHERE user_id = ?', [A.id]),
            v2_newsletter_subscriptions: n('SELECT COUNT(*) AS c FROM v2_newsletter_subscriptions WHERE user_id = ? OR lower(email) = lower(?)', [A.id, A.email]),
            pr_subscribers_mirror: n('SELECT COUNT(*) AS c FROM pr_subscribers WHERE lower(email) = lower(?)', [A.email]),
            user_profiles: n('SELECT COUNT(*) AS c FROM user_profiles WHERE user_id = ?', [A.id]),
            personal_schedules: n('SELECT COUNT(*) AS c FROM personal_schedules WHERE user_id = ?', [A.id]),
            pinned_items: n('SELECT COUNT(*) AS c FROM pinned_items WHERE user_id = ?', [A.id]),
            card_photo_consents: n('SELECT COUNT(*) AS c FROM card_photo_consents WHERE user_id = ?', [A.id]),
            v2_blocks_placed_by_A: n('SELECT COUNT(*) AS c FROM v2_blocks WHERE blocker_user_id = ?', [A.id]),
            scheduled_emails_still_queued: n("SELECT COUNT(*) AS c FROM scheduled_emails WHERE lower(recipient_email) = lower(?) AND status IN ('scheduled','pending_approval')", [A.email]),
            drip_log_address: n('SELECT COUNT(*) AS c FROM drip_log WHERE lower(email) = lower(?)', [A.email])
        };
        for (const [table, left] of Object.entries(gone)) check(`A: erased · ${table}`, left === 0, left + ' row(s) left');
        check('A: a report ABOUT A stays in the operator\'s queue (moderation record)', n(`SELECT COUNT(*) AS c FROM v2_reports WHERE id = 'rp-a' AND status = 'open'`) === 1);
        check('A: the queued mail is cancelled, never sent (welcome drip and the reminder)',
            n("SELECT COUNT(*) AS c FROM scheduled_emails WHERE lower(recipient_email) = lower(?) AND status = 'cancelled' AND last_error = 'account deleted'", [A.email]) >= 2);

        // ---- blocks other members placed on A stay, with that conversation (the abuse case) ----
        check('A: D\'s block on A stays', n('SELECT COUNT(*) AS c FROM v2_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?', [D.id, A.id]) === 1);
        const dThread = tdb.prepare(`SELECT id, sender_id, receiver_id, sender_name FROM direct_messages WHERE id IN ('dm-ad1', 'dm-ad2', 'dm-da') ORDER BY id`).all().map(x => { delete x._metadata; return x; });
        check('A: the conversation with D stays for D, re-keyed from the old address to the tombstone id, without the sender name',
            dThread.length === 3 && dThread.every(x => ![x.sender_id, x.receiver_id].some(k => String(k).toLowerCase() === A.email)) &&
            dThread.filter(x => x.sender_id === A.id).length === 2 && dThread.every(x => x.sender_id !== A.id || x.sender_name == null), JSON.stringify(dThread));
        const hashRow = one('SELECT deleted_email_hash FROM users WHERE id = ?', [A.id]);
        check('A: the tombstone keeps a keyed hash of the address (never the address) because another member blocked it',
            hashRow && /^[0-9a-f]{64}$/.test(String(hashRow.deleted_email_hash || '')) && !String(hashRow.deleted_email_hash).includes('@'), JSON.stringify(hashRow));

        // ---- meetups: the place is released and the host sees nobody ----
        const attA = one(`SELECT status, first_name, last_name, email, institution, position, bio, manage_token FROM plexus_meetup_attendees WHERE id = 'att-a'`);
        check('A: the meetup place is cancelled and the snapshot scrubbed (name, address, institution, position, bio, manage link)',
            attA && attA.status === 'cancelled' && attA.first_name === 'Deleted' && /\.invalid$/.test(attA.email) && attA.bio == null && attA.institution == null && attA.position == null && attA.manage_token == null, JSON.stringify(attA));
        check('A: the first person waiting moved up (Wes is confirmed)', (one(`SELECT status FROM plexus_meetup_attendees WHERE id = 'att-w'`) || {}).status === 'confirmed');
        r = await api('/api/v2/meetups/mt-1/host', { token: B.token });
        check('A: the host no longer sees Ana (name, address, bio)', r.status === 200 && !/Rogulja|Leaving|qa\.acctdel\+a@/i.test(JSON.stringify(r.d)), r.status + ' ' + JSON.stringify(r.d && r.d.attendees).slice(0, 200));

        // ---- registrations with no money trace lose their answers; a paid one keeps them ----
        const bb = one(`SELECT user_id, dietary_requirements, special_requests FROM bridges_registrations WHERE id = 'br-bb-a'`);
        check('A: the free (n/a) Building Bridges seat on the address is claimed and loses the dietary and access answers', bb && bb.user_id === A.id && bb.dietary_requirements == null && bb.special_requests == null, JSON.stringify(bb));
        const sfr = one(`SELECT email, answers_json FROM signup_form_responses WHERE id = 'sfr-a'`);
        check('A: the sign-up-form row loses its answers and takes the tombstone\'s .invalid address', sfr && sfr.email === `deleted-${A.id}@deleted.medx.invalid` && sfr.answers_json === '{}', JSON.stringify(sfr));
        const fmg = one(`SELECT user_id, email, bio, membership_status FROM forum_members WHERE id = 'fm-a-guest'`);
        // forum_members.user_id is UNIQUE and fm-a is A's own record: the unclaimed one is scrubbed and its Forum
        // event registration moves onto fm-a, so nothing on the address matches a new sign-up
        check('A: the unclaimed Forum record on the address is scrubbed and closed; its Forum registration moves onto A\'s own record',
            fmg && fmg.email == null && fmg.bio == null && fmg.membership_status === 'closed' && (one(`SELECT member_id FROM forum_event_registrations WHERE id = 'fer-a'`) || {}).member_id === 'fm-a',
            JSON.stringify(fmg) + ' ' + JSON.stringify(one(`SELECT member_id FROM forum_event_registrations WHERE id = 'fer-a'`)));

        // ---- the milestone reconcile never queues mail to the tombstone (it now owns the claimed guest registration) ----
        r = await api('/api/dev/run-milestones', { method: 'POST' });
        check('A: the milestone reconcile runs and queues nothing to the tombstone',
            r.status === 200 && n('SELECT COUNT(*) AS c FROM scheduled_emails WHERE recipient_email = ?', [`deleted-${A.id}@deleted.medx.invalid`]) === 0, r.status + ' ' + JSON.stringify(r.d));

        // ---- Forum profile, files, cards, devices ----
        const fm = one(`SELECT * FROM forum_members WHERE id = 'fm-a'`);
        check('A: Forum profile scrubbed and closed (row kept, still A\'s id)',
            fm && fm.user_id === A.id && fm.membership_status === 'closed' && fm.profile_visibility === 'private' && fm.first_name === 'Deleted' && fm.last_name === 'User',
            fm && JSON.stringify({ user_id: fm.user_id, status: fm.membership_status, vis: fm.profile_visibility, name: fm.first_name + ' ' + fm.last_name }));
        check('A: Forum profile PII cleared (email, bio, interests, photo, LinkedIn, ORCID, position, specialty, city, institution)',
            fm && ['email', 'bio', 'research_interests', 'photo_url', 'linkedin_url', 'orcid_id', 'position', 'specialty', 'location_city', 'institution'].every(c => fm[c] == null), fm && JSON.stringify(fm).slice(0, 240));
        check('A: Forum connection and group seat removed; B\'s Forum row untouched',
            n(`SELECT COUNT(*) AS c FROM forum_connections WHERE id = 'fc-ab'`) === 0 && n(`SELECT COUNT(*) AS c FROM forum_group_members WHERE id = 'fg-a'`) === 0 &&
            n(`SELECT COUNT(*) AS c FROM forum_members WHERE id = 'fm-b' AND membership_status = 'approved' AND email = ?`, [B.email]) === 1);
        wing = await wingNames(S.token);
        check('A: gone from the members-only Forum wing directory (no name, no bio)', wing.status === 200 && !wing.names.includes('Ana Leaving') && !/Bio of Ana|Deleted User/.test(wing.raw), wing.status + ' ' + wing.names.join(', '));
        check('A: portrait file deleted from disk', !fs.existsSync(photoFile));
        check('A: message attachment file deleted from disk', !fs.existsSync(attachFile));
        check('A: attendance card kept without the address', (one(`SELECT email_to FROM v2_attendance_cards WHERE id = 'card-a'`) || {}).email_to === '');
        check('A: native push device removed', n('SELECT COUNT(*) AS c FROM push_devices WHERE user_id = ?', [A.id]) === 0);

        // ---- kept exactly as issued ----
        check('A: paid registration, invoice, finance transaction, gala payment, points — byte-identical', fin() === finBefore, fin());
        check('A: the paid registration still points at the tombstone id (minimal reference)', (one(`SELECT user_id FROM registrations WHERE id = 'reg-paid'`) || {}).user_id === A.id);
        const guest = one(`SELECT user_id, dietary_requirements FROM registrations WHERE id = 'reg-guest-a'`);
        check('A: a guest registration on the address is linked to the tombstone first (and, being free, loses its dietary note)',
            guest && guest.user_id === A.id && guest.dietary_requirements == null, JSON.stringify(guest));
        const audit = one(`SELECT actor_id, actor_email, action, detail FROM audit_log WHERE action = 'account_deleted' AND actor_id = ?`, [A.id]);
        check('A: one audit row, without the address', audit && audit.actor_email == null && /paid records kept/.test(audit.detail), JSON.stringify(audit));

        // ---- session revoked ----
        r = await api('/api/auth/me', { token: A.token });
        check('A: old token → 401 "This account has been closed."', r.status === 401 && /closed/i.test(String(r.d && r.d.error)), r.status + ' ' + JSON.stringify(r.d));
        r = await api('/api/v2/messages/team', { method: 'POST', token: A.token, body: { topic: 'general', body: 'still here?' } });
        check('A: old token cannot write to the team inbox', r.status === 401, r.status + ' ' + JSON.stringify(r.d));
        r = await api('/api/auth/account', { method: 'DELETE', token: A.token });
        check('A: a second DELETE with the old token → 401', r.status === 401);
        r = await api('/api/auth/login', { method: 'POST', body: { email: A.email, password: 'test-password-9' } });
        check('A: the old email + password no longer sign in', r.status === 401, r.status + ' ' + JSON.stringify(r.d));
        r = await api('/api/forum/wing/me', { token: A.token });
        check('A: /api/forum/wing/me treats the old token as anonymous (no profile, no members-only news)',
            r.status === 200 && r.d && r.d.authenticated === false && r.d.member === false && !r.d.profile && !r.d.news, r.status + ' ' + JSON.stringify(r.d).slice(0, 200));
        r = await api('/api/v2/forum/check-code', { method: 'POST', token: A.token, body: { code: 'FRM-ACCT-DEL1' } });
        check('A: optionalAuth treats the old token as anonymous (never the closed account\'s claims)', r.status === 200 && r.d && r.d.valid === true, r.status + ' ' + JSON.stringify(r.d));

        // ---- B untouched ----
        check('B: own networking profile kept', n('SELECT COUNT(*) AS c FROM networking_profiles WHERE user_id = ?', [B.id]) === 1);
        check('B: own team message, follow, newsletter and B↔T connection kept',
            n(`SELECT COUNT(*) AS c FROM direct_messages WHERE id = 'dm-b-team'`) === 1 &&
            n('SELECT COUNT(*) AS c FROM notify_topics WHERE user_id = ?', [B.id]) === 1 &&
            n('SELECT COUNT(*) AS c FROM v2_newsletter_subscriptions WHERE user_id = ?', [B.id]) === 1 &&
            n(`SELECT COUNT(*) AS c FROM networking_connections WHERE id = 'nc-bt'`) === 1);
        r = await api('/api/auth/me', { token: B.token });
        check('B: still signed in', r.status === 200 && r.d && r.d.email === B.email);

        // ---- 3. C — no paid records: the path that used to hard-delete ----
        r = await api('/api/auth/account', { method: 'DELETE', token: C.token });
        check('C: DELETE → 200, anonymized:false (nothing paid to keep)', r.status === 200 && r.d && r.d.success === true && r.d.anonymized === false, JSON.stringify(r.d));
        const c = one('SELECT email, first_name, password_hash, deleted_at FROM users WHERE id = ?', [C.id]);
        check('C: tombstoned too (row kept, scrubbed, deleted_at)', c && c.email === `deleted-${C.id}@deleted.medx.invalid` && c.first_name === 'Deleted' && c.password_hash == null && !!c.deleted_at, JSON.stringify(c));
        check('C: social rows erased', n('SELECT COUNT(*) AS c FROM networking_profiles WHERE user_id = ?', [C.id]) === 0 && n(`SELECT COUNT(*) AS c FROM direct_messages WHERE id = 'dm-c'`) === 0);
        check('C: the free registration is kept (event record)', n(`SELECT COUNT(*) AS c FROM registrations WHERE id = 'reg-free-c' AND user_id = ?`, [C.id]) === 1);
        const freeReg = one(`SELECT dietary_requirements, accessibility_needs, custom_answers FROM registrations WHERE id = 'reg-free-c'`);
        check('C: the free registration lost its dietary / accessibility / custom answers (no payment on it)',
            freeReg && freeReg.dietary_requirements == null && freeReg.accessibility_needs == null && freeReg.custom_answers == null, JSON.stringify(freeReg));
        const prC = one(`SELECT source, status, unsubscribed_at FROM pr_subscribers WHERE id = 'pr-c-import'`);
        check('C: the admin-import newsletter row the app re-activated is UNSUBSCRIBED (no audience mails C again)',
            prC && prC.source === 'import' && prC.status === 'unsubscribed' && !!prC.unsubscribed_at, JSON.stringify(prC));
        check('C: the address carries the newsletter opt-out', /newsletter/.test(String((one('SELECT scopes FROM email_optouts WHERE lower(email) = lower(?)', [C.email]) || {}).scopes || '')));
        r = await api('/api/auth/me', { token: C.token });
        check('C: old token → 401 (the hard-delete path used to answer 200 with an empty profile)', r.status === 401 && /closed/i.test(String(r.d && r.d.error)), r.status + ' ' + JSON.stringify(r.d));
        r = await api('/api/networking/profile', { method: 'PUT', token: C.token, body: { research_interests: ['ghost'] } });
        check('C: old token cannot re-create a networking profile', r.status === 401 && n('SELECT COUNT(*) AS c FROM networking_profiles WHERE user_id = ?', [C.id]) === 0, r.status);

        // ---- the address is free again ----
        const again = await signup('a', 'Ana', 'Returning');
        check('A\'s address can sign up again as a NEW account', again.status === 200 && again.id && again.id !== A.id, JSON.stringify(again));
        check('the new account does not inherit the tombstone\'s paid registration', (one(`SELECT user_id FROM registrations WHERE id = 'reg-paid'`) || {}).user_id === A.id);
        r = await api('/api/v2/wallet/tickets', { token: again.token });
        check('the new account\'s wallet shows none of the tombstone\'s tickets (address match only for unclaimed rows)', r.status === 200 && walletIds(r.d).length === 0, r.status + ' ' + JSON.stringify(r.d).slice(0, 240));
        r = await api('/api/v2/wallet/tickets/reg-paid/pass', { token: again.token });
        check('the new account cannot open the tombstone\'s ticket by id', r.status === 404 || r.status === 403, r.status + ' ' + JSON.stringify(r.d).slice(0, 160));
        r = await api('/api/v2/forum/state', { token: again.token });
        check('the new account does not inherit the Forum membership', r.status === 200 && r.d && r.d.membership && r.d.membership.is_member === false, JSON.stringify(r.d && r.d.membership));
        r = await api('/api/forum/wing/me', { token: again.token });
        check('the new account is not a Forum member in the wing either', r.status === 200 && r.d && r.d.authenticated === true && r.d.member === false, JSON.stringify(r.d).slice(0, 200));
        r = await api('/api/v2/attendance-cards/mine', { token: again.token });
        check('the new account does not inherit the tombstone\'s attendance card', r.status === 200 && !JSON.stringify(r.d).includes('card-a'), r.status + ' ' + JSON.stringify(r.d).slice(0, 160));
        r = await api('/api/my/events', { token: again.token });
        check('the new account\'s events carry no Donor Night, Building Bridges, sign-up-form or Forum ticket of the tombstone',
            r.status === 200 && !evIds(r.d).some(x => /^(br-|sfr-|fer-)/.test(x)), JSON.stringify(evIds(r.d)));
        r = await api('/api/member/giving', { token: again.token });
        check('the new account is not shown the tombstone\'s Donor Night giving', r.status === 200 && r.d && r.d.is_supporter === false && !r.d.total, JSON.stringify(r.d));
        r = await api('/api/member/passport', { token: again.token });
        check('the new account\'s passport has no Bridges stamp of the tombstone', r.status === 200 && !/Donor Night|Building Bridges/.test(JSON.stringify(r.d)), JSON.stringify(r.d).slice(0, 200));
        r = await api('/api/v2/meetups/mine', { token: again.token });
        check('the new account does not get the tombstone\'s meetup place (manage link, QR)', r.status === 200 && !(r.d.meetups || []).length, JSON.stringify(r.d).slice(0, 200));
        r = await api('/api/v2/wallet/tickets', { token: again.token });
        check('the new account\'s wallet has no Forum registration through the scrubbed Forum record', r.status === 200 && !/fer-a|QR-FORUM-A/.test(JSON.stringify(r.d)), JSON.stringify(r.d).slice(0, 200));
        // the block D placed follows the address
        check('the new account inherits D\'s block', n('SELECT COUNT(*) AS c FROM v2_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?', [D.id, again.id]) === 1);
        q(`INSERT INTO networking_connections (id, requester_id, receiver_id, status) VALUES ('nc-again-d', ?, ?, 'accepted')`, [again.id, D.id]);
        r = await api('/api/messages', { method: 'POST', token: again.token, body: { receiver_id: D.id, content: 'hi again' } });
        check('the new account cannot message D, even with a connection row', r.status === 403, r.status + ' ' + JSON.stringify(r.d));
        q(`DELETE FROM networking_connections WHERE id = 'nc-again-d'`);
        r = await api('/api/networking/connections', { method: 'POST', token: again.token, body: { receiver_id: D.id, message: 'hi again' } });
        check('the new account cannot send D a connection request', r.status === 403, r.status + ' ' + JSON.stringify(r.d));
        r = await api('/api/v2/network/search?q=Dora', { token: again.token });
        check('the new account does not find D in the directory', r.status === 200 && !JSON.stringify(r.d).includes(D.id), r.status);

        // ---- U: an address the account never confirmed — address-only rows stay with the address ----
        r = await api('/api/auth/account', { method: 'DELETE', token: U.token });
        check('U (unconfirmed address): DELETE → 200', r.status === 200 && r.d && r.d.success === true, JSON.stringify(r.d));
        const gU = one(`SELECT user_id, dietary_requirements FROM registrations WHERE id = 'reg-guest-u'`);
        const sU = one(`SELECT email, answers_json FROM signup_form_responses WHERE id = 'sfr-u'`);
        check('U: the guest registration on the address is neither claimed nor scrubbed', gU && gU.user_id == null && gU.dietary_requirements === 'halal', JSON.stringify(gU));
        check('U: the sign-up-form row keeps its address and answers', sU && sU.email === U.email && /halal/.test(sU.answers_json), JSON.stringify(sU));

        // ---- M: the opt-out is stored lower-case and merges the mixed-case row ----
        r = await api('/api/auth/account', { method: 'DELETE', token: M.token });
        check('M: DELETE → 200', r.status === 200, r.status);
        const optRows = tdb.prepare('SELECT email, scopes FROM email_optouts WHERE lower(email) = lower(?)').all(M.email).map(x => { delete x._metadata; return x; });
        check('M: one opt-out row, stored lower-case, carrying both scopes', optRows.length === 1 && optRows[0].email === M.email.toLowerCase() && /newsletter/.test(optRows[0].scopes) && /reminders/.test(optRows[0].scopes), JSON.stringify(optRows));
        const crypto = require('crypto');
        const lowM = M.email.toLowerCase();
        const e64 = Buffer.from(lowM).toString('base64url');
        const sig = crypto.createHmac('sha256', 'account-delete-test-secret').update('medx-email-prefs:' + lowM).digest('hex').slice(0, 24);
        const prefs = await fetch(USER + '/email-prefs?e=' + e64 + '&s=' + sig);
        const prefsHtml = await prefs.text();
        check('M: the address\'s email-preferences page shows News from Med&X switched off', prefs.status === 200 && !/name="newsletter" checked/.test(prefsHtml), prefs.status);

        // ---- a suspended member: the default is 403 (writes to info@medx.hr, stated in /privacy §6) ----
        q("UPDATE users SET suspended_at = datetime('now'), suspended_reason = 'test' WHERE id = ?", [W.id]);
        r = await api('/api/auth/account', { method: 'DELETE', token: W.token });
        check('a suspended member gets 403 with the suspension sentence and code (nothing is closed)',
            r.status === 403 && r.d && r.d.code === 'account_suspended' && !(one('SELECT deleted_at FROM users WHERE id = ?', [W.id]) || {}).deleted_at, r.status + ' ' + JSON.stringify(r.d));

        tdb.close();
    } catch (e) {
        check('test run crashed', false, (e && e.stack || e) + '\n--- server stderr ---\n' + errbuf);
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    cleanup();
    process.exit(passed === results.length ? 0 : 1);
})();
