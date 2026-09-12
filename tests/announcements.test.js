#!/usr/bin/env node
/**
 * Member announcements END-TO-END — scratch CI-style dual boot (mirrors member-card-toggle.test.js).
 *
 * One announcement is TWO rows in TWO tables, written by the admin composer in one click:
 *   member_announcements  — member home feed, the member notification centre, the medx.hr bell
 *   user_notifications    — the in-portal bell
 * Four things were wrong with that pair, and this proves all four:
 *
 *   1. BELL TARGETING. GET /api/user-notifications matched `user_id IS NULL`, so the bell copy of a
 *      project-scoped announcement rang for EVERY member. A project item must reach only the
 *      audience the composer picked (followers via notify_topics / registrants by email), while a
 *      global one still reaches everyone and legacy rows keep behaving exactly as they did.
 *   2. EDIT. PUT /api/admin/member-announcements/:id rewrote only member_announcements — the bell
 *      kept the old title and body forever.
 *   3. REMOVE. DELETE orphaned the bell row, which then rang with nothing behind it.
 *   4. SHOW UNTIL. member_announcements had no expiry column at all, so the composer's SHOW UNTIL
 *      governed only the bell copy; the home feed and the notification centre never dropped it.
 *
 * Plus the composer's audience sizing (GET /api/admin/audiences/:project), which must count
 * registrants separately from the members among them — a bell item can only reach a member.
 *
 *   node tests/announcements.test.js
 *
 * Boots both backends on ONE throwaway SQLite file (no Turso, no Stripe, no email provider), so
 * nothing here can email anyone or touch a live database. Exits 1 on any failure.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://localhost:3141';
const ADMIN = 'http://localhost:3142';

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

// The composer's publish, verbatim: the member row first, then the bell copy carrying the
// announcement id + the audience, exactly as js/views/inbox.js annPublish does it.
const publish = async (atok, { project, scope, title, body, expires }) => {
    const a = await api(ADMIN, '/api/admin/member-announcements', {
        method: 'POST', token: atok,
        body: { project_key: project || null, title, body: body || null, push: 0, audience_scope: project ? scope : 'everyone', expires_at: expires || null }
    });
    const id = a.d && a.d.id;
    const n = await api(ADMIN, '/api/admin/notifications/send', {
        method: 'POST', token: atok,
        body: {
            user_group: project || 'all', category: 'announcement', project: project || null,
            title, message: body || '', expires_at: expires || null, send_push: false,
            announcement_id: id, audience_scope: project ? scope : 'everyone'
        }
    });
    return { id, notifId: n.d && n.d.id, aStatus: a.status, nStatus: n.status };
};

const bellTitles = async (tok) => {
    const r = await api(USER, '/api/user-notifications', { token: tok });
    return ((r.d && r.d.notifications) || []).map(n => n.title);
};
const centreTitles = async (tok) => {
    const r = await api(USER, '/api/announcements', { token: tok });
    return ((r.d && r.d.announcements) || []).map(a => a.title);
};
const homeTitles = async (tok) => {
    const r = await api(USER, '/api/feed/home', { token: tok });
    return ((r.d && r.d.items) || []).map(i => i.title);
};
const bellFeedTitles = async (tok) => {
    const r = await api(USER, '/api/bell-feed', { token: tok });
    return ((r.d && r.d.items) || []).map(i => i.title);
};

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-ann-'));
    const env = {
        ...process.env,
        DATABASE_PATH: path.join(scratch, 'scratch.db'),
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', BREVO_API_KEY: '', SMTP_USER: '', GOOGLE_SHEETS_WEBHOOK: '',
        JWT_SECRET: 'announcements-test-secret',
        NODE_ENV: 'test',
    };
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        p.stderr.on('data', () => {});
        procs.push(p);
        return p;
    };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('user-portal/backend', 3141);
        await waitUp(USER);
        boot('admin-portal/backend', 3142);
        await waitUp(ADMIN);

        // vp@medx.hr, not the founder: the boot's one-time founder unlock resets
        // juginovic.alen@gmail.com to a temp password with must_change_password armed on every
        // fresh database, so that account cannot be logged into from a scratch boot.
        let r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'vp@medx.hr', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', r.status === 200 && !!atok, JSON.stringify(r.d && r.d.error));

        // Two members: one FOLLOWS the gala, one follows nothing at all.
        const mk = async (email) => {
            const rr = await api(USER, '/api/auth/register', {
                method: 'POST',
                body: { email, password: 'test-password-1', first_name: 'QA', last_name: 'Robot', institution: 'Test', country: 'HR' }
            });
            return rr.d && rr.d.token;
        };
        const follower = await mk('qa.robot+follows@example.com');
        const stranger = await mk('qa.robot+nofollow@example.com');
        check('two scratch members created', !!follower && !!stranger);
        r = await api(USER, '/api/notify-topics', { method: 'POST', token: follower, body: { project: 'gala', on: true } });
        check('one member follows the gala (notify_topics)', r.status === 200 && r.d && r.d.on === true);

        // ---- (1) BELL TARGETING -------------------------------------------------------------
        const scoped = await publish(atok, { project: 'gala', scope: 'interested', title: 'Gala seating opens', body: 'Pick your table.' });
        check('publish wrote both rows', scoped.aStatus === 200 && scoped.nStatus === 200 && !!scoped.id, JSON.stringify(scoped));

        let fBell = await bellTitles(follower);
        let sBell = await bellTitles(stranger);
        check('project bell item REACHES the follower', fBell.includes('Gala seating opens'), JSON.stringify(fBell));
        check('project bell item does NOT reach a member outside the audience', !sBell.includes('Gala seating opens'), JSON.stringify(sBell));

        const global = await publish(atok, { project: null, scope: 'everyone', title: 'Portal maintenance Sunday', body: 'Ten minutes.' });
        check('global publish wrote both rows', global.aStatus === 200 && global.nStatus === 200);
        fBell = await bellTitles(follower);
        sBell = await bellTitles(stranger);
        check('a global bell item still reaches EVERY member', fBell.includes('Portal maintenance Sunday') && sBell.includes('Portal maintenance Sunday'));

        // The unread count must agree with the list it belongs to.
        r = await api(USER, '/api/user-notifications', { token: stranger });
        check('unread count matches the targeted list', r.d && r.d.unreadCount === (r.d.notifications || []).length,
            'count=' + (r.d && r.d.unreadCount) + ' rows=' + (r.d && (r.d.notifications || []).length));

        // BACK-COMPAT: a 1:1 row (user_group 'targeted' + a user_id) and any non-project group token
        // must keep behaving as before — the audience gate only bites on the five project keys.
        r = await api(ADMIN, '/api/admin/notifications/send', {
            method: 'POST', token: atok,
            body: { user_group: 'legacy-cohort', category: 'system', title: 'Legacy broadcast', message: 'x', send_push: false }
        });
        check('legacy non-project user_group still broadcasts', r.status === 200 && (await bellTitles(stranger)).includes('Legacy broadcast'));

        // ---- (2) EDIT reaches the bell copy -------------------------------------------------
        r = await api(ADMIN, '/api/admin/member-announcements/' + scoped.id, {
            method: 'PUT', token: atok, body: { title: 'Gala seating opens Friday', body: 'Pick your table from Friday.' }
        });
        check('edit reports it rewrote the bell copy too', r.status === 200 && r.d && r.d.bell_updated === 1, JSON.stringify(r.d));
        fBell = await bellTitles(follower);
        check('the bell now shows the EDITED title', fBell.includes('Gala seating opens Friday'), JSON.stringify(fBell));
        check('the bell no longer shows the OLD title', !fBell.includes('Gala seating opens'), JSON.stringify(fBell));
        check('the notification centre shows the edited title', (await centreTitles(follower)).includes('Gala seating opens Friday'));

        // ---- (3) REMOVE takes the bell copy with it -----------------------------------------
        r = await api(ADMIN, '/api/admin/member-announcements/' + scoped.id, { method: 'DELETE', token: atok });
        check('remove reports it removed the bell copy too', r.status === 200 && r.d && r.d.bell_removed === 1, JSON.stringify(r.d));
        fBell = await bellTitles(follower);
        check('no orphan bell row survives the removal', !fBell.some(t => /Gala seating opens/.test(t)), JSON.stringify(fBell));
        check('the announcement is gone from the notification centre', !(await centreTitles(follower)).some(t => /Gala seating opens/.test(t)));

        // ---- (4) SHOW UNTIL governs the member surfaces, not only the bell ------------------
        const past = await publish(atok, { project: null, scope: 'everyone', title: 'Early bird ended', body: 'It has ended.', expires: '2020-01-01 23:59:59' });
        const future = await publish(atok, { project: null, scope: 'everyone', title: 'Still running', body: 'Open.', expires: '2099-01-01 23:59:59' });
        check('both expiring announcements published', past.aStatus === 200 && future.aStatus === 200);

        r = await api(ADMIN, '/api/admin/member-announcements', { token: atok });
        const stored = (Array.isArray(r.d) ? r.d : []).find(x => x.id === past.id);
        check('the admin list carries the stored expiry', stored && String(stored.expires_at || '').startsWith('2020-01-01'), 'expires_at=' + (stored && stored.expires_at));

        const centre = await centreTitles(stranger);
        const home = await homeTitles(stranger);
        const feed = await bellFeedTitles(stranger);
        const bell = await bellTitles(stranger);
        check('expired announcement is OUT of the notification centre', !centre.includes('Early bird ended') && centre.includes('Still running'), JSON.stringify(centre));
        check('expired announcement is OUT of the member home feed', !home.includes('Early bird ended') && home.includes('Still running'), JSON.stringify(home));
        check('expired announcement is OUT of the website bell feed', !feed.includes('Early bird ended') && feed.includes('Still running'), JSON.stringify(feed));
        check('expired bell copy is OUT of the in-portal bell', !bell.includes('Early bird ended') && bell.includes('Still running'), JSON.stringify(bell));

        // A bare date is widened to the end of that day rather than dropped.
        const dayOnly = await publish(atok, { project: null, scope: 'everyone', title: 'Bare date item', expires: '2099-06-01' });
        r = await api(ADMIN, '/api/admin/member-announcements', { token: atok });
        const bare = (Array.isArray(r.d) ? r.d : []).find(x => x.id === dayOnly.id);
        check('a bare YYYY-MM-DD expiry becomes end of that day', bare && bare.expires_at === '2099-06-01 23:59:59', 'expires_at=' + (bare && bare.expires_at));

        // ---- (5) the composer's audience sizing ---------------------------------------------
        r = await api(ADMIN, '/api/admin/audiences/gala', { token: atok });
        const aud = r.d || {};
        check('audiences route answers with both raw and member-only counts',
            r.status === 200 && aud.interested === 1 && typeof aud.members_registered === 'number' && typeof aud.registered === 'number',
            JSON.stringify(aud));
        check('members_interested equals interested (notify_topics joins users)', aud.members_interested === aud.interested);
        check('members_registered never exceeds registered', aud.members_registered <= aud.registered,
            aud.members_registered + ' / ' + aud.registered);
        r = await api(ADMIN, '/api/admin/audiences/not-a-project', { token: atok });
        check('an unknown project is refused', r.status === 400);
    } catch (e) {
        check('unexpected error: ' + e.message, false);
    } finally {
        cleanup();
    }

    const passed = results.filter(([, ok]) => ok).length;
    console.log('\n' + passed + '/' + results.length + ' passed');
    process.exit(passed === results.length ? 0 : 1);
})();
