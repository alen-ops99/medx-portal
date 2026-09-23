/**
 * tests/final-qa-backend.test.js — the backend half of the 2026-09-23 final QA (both portals + the event app).
 *
 *  S  Header SEARCH (GET /api/member/search): event dates read '4–5 May 2099', never the raw ISO date; an event
 *     that is over says 'Past' and lists after every upcoming one; "ticket" / "wallet" answers with the wallet.
 *  B  Building Bridges recap (GET /api/v2/bridges/editions): an evening that has happened joins as the next
 *     edition until an admin enters it (the Boston evening was missing — "Four evenings so far").
 *  L  Event app (GET /api/live/events): a two-day event is labelled with both days ('Fri 4 – Sat 5 Dec'), and a
 *     venue string's trailing '; Zagreb, Croatia' (already on the address line) is dropped.
 *  I  Admin inbox: a member's own rows carry their EMAIL in sender_id; the thread (keyed by users.id) must show
 *     them, mark them read, and the draft-reply must find them.
 *  C  One "counts as registered" rule for a /plexus conference leg: Today (dashboard summary), Registrations
 *     (conference_people) and the Program editor (insight) move together — a held 'pending-review' row counts
 *     nowhere, a 'Confirmed' row (capitalised) counts everywhere.
 *  H  (close round) A free /plexus leg that counts nowhere (held for review, or no status) is tagged HELD in
 *     Registrations, never FREE like a counted row; the Bridges recap skips '[superseded] …' rows and the admin
 *     hub's past_evenings is the member recap's own list (shared/bridges-evenings.js).
 *  R  (close round) UNDO of a cancelled free leg restores exactly the previous status — a held leg goes back on
 *     hold, an empty status stays empty — and a stray status ('paid', 'approved' …) is refused.
 *
 * Boots BOTH portals against one throwaway SQLite file, network disabled (the tests/safety.test.js preload),
 * same shape as tests/admin-audit-fixes.test.js. Made-up people only. NO email.
 *
 * Run: node tests/final-qa-backend.test.js   (exit 0 = all passed)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER = 'http://127.0.0.1:3280';
const ADMIN = 'http://127.0.0.1:3281';
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

const results = [];
const check = (name, cond, detail = '') => {
    results.push([name, !!cond]);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 240) : ''));
};
const api = async (base, p, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let d = null; try { d = await r.json(); } catch (e) {}
    return { status: r.status, d };
};
const waitUp = async (base, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { const r = await fetch(base + '/health'); if (r.ok) return; } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('server at ' + base + ' did not come up');
};

(async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-final-qa-'));
    const dbPath = path.join(scratch, 'scratch.db');
    const preload = path.join(scratch, 'no-network.js');
    fs.writeFileSync(preload, NO_NET);
    const env = {
        ...process.env,
        DATABASE_PATH: dbPath, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
        RESEND_API_KEY: '', SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
        FIRA_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_SHEETS_WEBHOOK: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
        JWT_SECRET: 'final-qa-test-secret', NODE_ENV: 'test',
    };
    const procs = [];
    const boot = (dir, port) => {
        const p = spawn('node', ['-r', preload, 'server.js'], { cwd: path.join(ROOT, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        let errbuf = '';
        p.stderr.on('data', (d) => { errbuf += d.toString(); if (errbuf.length > 4000) errbuf = errbuf.slice(-4000); });
        p._errbuf = () => errbuf;
        procs.push(p);
    };
    const cleanup = () => {
        procs.forEach(p => { try { p.kill('SIGKILL'); } catch (e) {} });
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    };
    process.on('exit', cleanup);

    try {
        boot('user-portal/backend', 3280);
        await waitUp(USER);
        boot('admin-portal/backend', 3281);
        await waitUp(ADMIN);
        const Database = require(path.join(ROOT, 'admin-portal/backend/node_modules/libsql'));
        const tdb = new Database(dbPath);
        const x = (sql, params = []) => tdb.prepare(sql).run(...params);
        const g = (sql, params = []) => tdb.prepare(sql).get(...params);
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

        const email = 'qa.finalqa+mira@example.com';
        let r = await api(USER, '/api/auth/register', { method: 'POST', body: { email, password: 'test-password-9', first_name: 'Mira', last_name: 'Testić', institution: 'QA Institute' } });
        const mtok = r.d && r.d.token, mid = r.d && r.d.user && r.d.user.id;
        check('scratch boot: a made-up member signed up', !!(mtok && mid), r.status);
        r = await api(ADMIN, '/api/auth/login', { method: 'POST', body: { email: 'vp@medx.hr', password: 'admin123' } });
        const atok = r.d && r.d.token;
        check('scratch boot: seeded admin login works', !!atok, r.status);

        // ------------------------------------------------------------ S · search dates, past marker, order, wallet
        x(`INSERT INTO conferences (id, name, year, slug, description, start_date, end_date, venue_name, venue_city, venue_country, is_active)
           VALUES ('qa-conf', 'QA Summit', 2099, 'qa-summit-2099', 'made up', '2099-05-04', '2099-05-05', 'QA Hall', 'Qaville', 'Croatia', 0)`);
        x(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, is_published, created_by)
           VALUES ('qa-bb-next', 'qa-bb-next', 'QA Bridges — Qaburg', 'Qaburg', 'QA Room', '2099-03-01', 'upcoming', 1, 'test')`);
        x(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, is_published, created_by)
           VALUES ('qa-bb-past', 'qa-bb-past', 'QA Bridges — Qa Harbor', 'Qa Harbor', 'QA Hall, North Wing', '2020-02-02', 'completed', 1, 'test')`);
        r = await api(USER, '/api/member/search?q=' + encodeURIComponent('QA'), { token: mtok });
        const evs = (r.d && r.d.events) || [];
        const titles = evs.map(e => e.title);
        check('search: the three QA events come back', ['QA Summit', 'QA Bridges — Qaburg', 'QA Bridges — Qa Harbor'].every(t => titles.includes(t)), JSON.stringify(titles));
        check('search: no event detail prints a raw ISO date', evs.every(e => !/\d{4}-\d{2}-\d{2}/.test(e.detail || '')), JSON.stringify(evs.map(e => e.detail)));
        const summit = evs.find(e => e.title === 'QA Summit') || {};
        check('search: a two-day event reads "Qaville · 4–5 May 2099"', summit.detail === 'Qaville · 4–5 May 2099', summit.detail);
        const past = evs.find(e => e.title === 'QA Bridges — Qa Harbor') || {};
        check('search: an evening that is over says "Past" first', past.past === true && past.detail === 'Past · Qa Harbor · 2 February 2020', past.detail);
        const firstPast = evs.findIndex(e => e.past);
        check('search: every upcoming event lists before the first past one', firstPast === -1 || evs.slice(firstPast).every(e => e.past), JSON.stringify(evs.map(e => [e.title, e.past])));
        const qaUpcoming = evs.filter(e => !e.past && /^QA /.test(e.title)).map(e => e.title);
        check('search: upcoming events run soonest first', qaUpcoming.indexOf('QA Bridges — Qaburg') < qaUpcoming.indexOf('QA Summit'), JSON.stringify(qaUpcoming));
        for (const qs of ['ticket', 'tic', 'wallet', 'qr', 'my tickets']) {
            r = await api(USER, '/api/member/search?q=' + encodeURIComponent(qs), { token: mtok });
            const w = ((r.d && r.d.mine) || []).find(m => m.kind === 'wallet');
            check(`search "${qs}": MINE opens the wallet`, !!w && w.section === 'mymedx' && w.title === 'My wallet', JSON.stringify(r.d && r.d.mine));
        }
        r = await api(USER, '/api/member/search?q=' + encodeURIComponent('Qaburg'), { token: mtok });
        check('search "Qaburg": no wallet row for an unrelated query', !((r.d && r.d.mine) || []).some(m => m.kind === 'wallet'), JSON.stringify(r.d && r.d.mine));

        // ------------------------------------------------------------ B · the recap picks up an evening that has happened
        r = await api(USER, '/api/v2/bridges/editions');
        const ed = (r.d && r.d.editions) || [];
        const harbor = ed.find(e => e.city === 'Qa Harbor');
        const maxCurated = Math.max(...ed.filter(e => !String(e.id).startsWith('event-')).map(e => Number(e.edition_no)));
        check('editions: the past Qa Harbor evening is listed', !!harbor, JSON.stringify(ed.map(e => [e.edition_no, e.city])));
        check('editions: …as the next edition number, most recent first', harbor && harbor.edition_no === maxCurated + 1 && ed[0] === harbor, JSON.stringify(ed.map(e => [e.edition_no, e.city])));
        check('editions: …with its venue and date, no figures made up', harbor && harbor.venue === 'QA Hall, North Wing' && harbor.event_date === '2020-02-02' && harbor.guests === null && harbor.photos.length === 0, JSON.stringify(harbor));
        check('editions: the upcoming Qaburg evening is NOT a recap yet', !ed.some(e => e.city === 'Qaburg'));
        check('editions: totals count it (events + cities)', r.d.totals.events === ed.length && r.d.totals.cities === new Set(ed.map(e => e.city)).size, JSON.stringify(r.d.totals));
        const n0 = ed.length;
        x(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, is_published, created_by)
           VALUES ('qa-bb-zurich', 'qa-bb-zurich', 'QA Zurich', 'Zurich', 'ETH', '2020-03-15', 'completed', 1, 'test')`);
        x(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, is_published, created_by)
           VALUES ('qa-bb-cancel', 'qa-bb-cancel', 'QA Cancelled', 'Qa Nowhere', 'X', '2020-04-01', 'cancelled', 1, 'test')`);
        x(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, is_published, created_by)
           VALUES ('qa-bb-draft', 'qa-bb-draft', 'QA Draft', 'Qa Draftville', 'X', '2020-05-01', 'completed', 0, 'test')`);
        r = await api(USER, '/api/v2/bridges/editions');
        check('editions: "Zurich" folds onto the curated Zürich edition, a cancelled or unpublished evening adds nothing', r.d.editions.length === n0, JSON.stringify(r.d.editions.map(e => e.city)));
        x(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, is_published, created_by)
           VALUES ('qa-bb-super', 'qa-bb-super', '[superseded] QA Symposium', 'Qa Oldtown', 'X', '2020-06-01', 'completed', 1, 'test')`);
        x(`INSERT INTO bridges_events (id, slug, name, city, venue_name, event_date, status, is_published, created_by)
           VALUES ('qa-bb-donor', 'donor-night', 'QA Donor Night', 'Qa Donorville', 'X', '2020-07-01', 'completed', 1, 'test')`);
        r = await api(USER, '/api/v2/bridges/editions');
        check('editions: a published "[superseded] …" row or Donor Night adds nothing (the admin hub rule)', r.d.editions.length === n0 && !r.d.editions.some(e => /Oldtown|Donorville/.test(e.city)), JSON.stringify(r.d.editions.map(e => e.city)));
        const hub = (await api(ADMIN, '/api/v2/bridges/hub', { token: atok })).d || {};
        const memberDerived = r.d.editions.filter(e => String(e.id).startsWith('event-')).map(e => e.id + '#' + e.edition_no).sort();
        const hubDerived = (hub.past_evenings || []).map(e => e.id + '#' + e.edition_no).sort();
        check('bridges hub: past_evenings = the member recap\'s derived evenings (one shared rule)', hubDerived.length > 0 && JSON.stringify(hubDerived) === JSON.stringify(memberDerived), JSON.stringify({ hubDerived, memberDerived }));
        const hubCount = (hub.editions || []).filter(e => e.is_published).length + (hub.past_evenings || []).length;
        check('bridges hub: published editions + past_evenings = the member page\'s "N evenings so far"', hubCount === r.d.totals.events, `${hubCount} vs ${r.d.totals.events}`);
        x(`INSERT INTO v2_bridges_editions (id, edition_no, city, country, venue, note, event_id, photos_json, is_published, updated_at, updated_by)
           VALUES ('qa-ed-harbor', ?, 'Qa Harbor', 'Croatia', 'QA Hall', 'Entered by an admin.', 'qa-bb-past', '[]', 1, ?, 'test')`, [maxCurated + 1, now]);
        r = await api(USER, '/api/v2/bridges/editions');
        const again = r.d.editions.filter(e => e.city === 'Qa Harbor');
        check('editions: once an admin enters it, the curated row replaces the derived one', again.length === 1 && again[0].id === 'qa-ed-harbor' && r.d.editions.length === n0, JSON.stringify(r.d.editions.map(e => [e.id, e.city])));

        // ------------------------------------------------------------ L · the event app names both days, cleans the venue
        const conf = g("SELECT start_date, end_date FROM conferences WHERE slug = 'plexus-2026'");
        check('live: the scratch conference row runs 4–5 December', conf && conf.start_date === '2026-12-04' && conf.end_date === '2026-12-05', JSON.stringify(conf));
        const galaHas = g("SELECT id FROM gala_settings WHERE id = 'default'");
        if (galaHas) x("UPDATE gala_settings SET venue = 'Hotel Esplanade Emerald Ballroom; Zagreb, Croatia' WHERE id = 'default'");
        else x("INSERT INTO gala_settings (id, venue) VALUES ('default', 'Hotel Esplanade Emerald Ballroom; Zagreb, Croatia')");
        r = await api(USER, '/api/live/events?today=2026-12-04');
        const lc = ((r.d && r.d.events) || []).find(e => e.key === 'conference') || {};
        check('live: the conference is labelled with both days', lc.date_label === 'Fri 4 – Sat 5 Dec' && lc.short_date === '4–5 Dec', lc.date_label + ' / ' + lc.short_date);
        check('live: …and it is still "today" on the 4th', lc.is_today === true && lc.end_date === '2026-12-05');
        const ld = ((r.d && r.d.events) || []).find(e => e.key === 'donor') || {};
        check('live: a one-day event keeps its long day label', ld.date_label === 'Friday 4 Dec' && ld.short_date === '4 Dec', ld.date_label);
        const lg = ((r.d && r.d.events) || []).find(e => e.key === 'gala') || {};
        check('live: the Gala venue drops the "; Zagreb, Croatia" the address already carries', lg.venue === 'Hotel Esplanade Emerald Ballroom', lg.venue);

        // ------------------------------------------------------------ I · the admin opens a member thread and reads it
        x(`INSERT INTO direct_messages (id, sender_id, receiver_id, sender_type, receiver_type, title, content, is_read, created_at)
           VALUES ('qa-dm-1', ?, 'coordinators@medx.hr', 'user', 'admin', 'Question', 'Dear team, a made-up question about the program.', 0, ?)`, ['QA.FinalQA+Mira@example.com', now]);
        r = await api(ADMIN, '/api/v2/inbox/threads', { token: atok });
        const th = ((r.d && r.d.threads) || []).find(t => t.key === mid);
        check('inbox: the email-keyed message threads under the member (users.id), unread', th && th.unread === 1 && /made-up question/.test(th.last.content), JSON.stringify(th));
        r = await api(ADMIN, '/api/admin/messages/' + encodeURIComponent(mid), { token: atok });
        check('inbox: opening the thread by users.id returns the member\'s message', Array.isArray(r.d) && r.d.some(m => m.id === 'qa-dm-1'), JSON.stringify(r.d).slice(0, 200));
        check('inbox: …and marks it read', Number(g("SELECT is_read FROM direct_messages WHERE id = 'qa-dm-1'").is_read) === 1);
        r = await api(ADMIN, '/api/v2/inbox/threads', { token: atok });
        const th2 = ((r.d && r.d.threads) || []).find(t => t.key === mid);
        check('inbox: the thread\'s unread count is now 0', th2 && th2.unread === 0, JSON.stringify(th2));
        r = await api(ADMIN, '/api/admin/messages/' + encodeURIComponent(email), { token: atok });
        check('inbox: an older client keying by email still gets the same thread', Array.isArray(r.d) && r.d.some(m => m.id === 'qa-dm-1'));
        r = await api(ADMIN, '/api/admin/messages/' + encodeURIComponent(mid) + '/draft-reply', { method: 'POST', body: {}, token: atok });
        check('inbox: the reply draft finds the member\'s message (no 404)', r.status === 200 && typeof (r.d && r.d.text) === 'string', r.status + ' ' + JSON.stringify(r.d).slice(0, 120));

        // ------------------------------------------------------------ C · one live-leg rule for every conference count
        const counts = async () => {
            const s = (await api(ADMIN, '/api/dashboard/summary', { token: atok })).d || {};
            const reg = (await api(ADMIN, '/api/v2/registrations/all?event=conference', { token: atok })).d || {};
            const ins = (await api(ADMIN, '/api/v2/program/conference/insight', { token: atok })).d || {};
            return { today: s.plexus && s.plexus.registrations, registrations: reg.stats && reg.stats.conference_people, program: ins.registered, seats: ins.registered_seats };
        };
        const c0 = await counts();
        check('counts: baseline — Today, Registrations and the Program editor agree', c0.today === c0.registrations && c0.registrations === c0.program, JSON.stringify(c0));
        const seedCA = (id, mail, status) => x(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_conference, conference_status, source, created_at)
            VALUES (?, 'Made', 'Up', ?, 1, ?, 'plexus', ?)`, [id, mail, status, now]);
        seedCA('qa-ca-live', 'qa.finalqa+live@example.com', 'pre-registered');
        seedCA('qa-ca-cap', 'qa.finalqa+cap@example.com', 'Confirmed');           // capitalised — still live
        seedCA('qa-ca-held', 'qa.finalqa+held@example.com', 'pending-review');    // held by the review gate — nobody yet
        seedCA('qa-ca-merged', 'qa.finalqa+merged@example.com', 'merged');        // folded into a survivor
        const c1 = await counts();
        check('counts: Today +2 (live + Confirmed; held and merged count nowhere)', c1.today - c0.today === 2, `${c0.today} -> ${c1.today}`);
        check('counts: Registrations people +2, the same', c1.registrations - c0.registrations === 2, `${c0.registrations} -> ${c1.registrations}`);
        check('counts: Program editor registered +2 and seats +2, the same', c1.program - c0.program === 2 && c1.seats - c0.seats === 2, `${c0.program} -> ${c1.program}, seats ${c0.seats} -> ${c1.seats}`);
        check('counts: all three still agree', c1.today === c1.registrations && c1.registrations === c1.program, JSON.stringify(c1));

        // ------------------------------------------------------------ H · a leg that counts nowhere is tagged HELD, not FREE
        seedCA('qa-ca-null', 'qa.finalqa+null@example.com', null);                // no status at all
        x(`INSERT INTO croatians_abroad_registrations (id, first_name, last_name, email, selected_bridges, bridges_status, source, created_at)
            VALUES ('qa-ca-bheld', 'Made', 'Up', 'qa.finalqa+bheld@example.com', 1, 'pending-review', 'plexus', ?)`, [now]);
        const regRows = async (q = '') => ((await api(ADMIN, '/api/v2/registrations/all?limit=1000' + q, { token: atok })).d || {});
        let all = await regRows();
        const row = key => (all.rows || []).find(x => x.key === key) || {};
        const entry = rw => ((rw.facts || []).find(f => f[0] === 'ENTRY') || [])[1];
        check('held: the review gate\'s pending-review conference leg is tagged HELD', row('ca:qa-ca-held:conference').status === 'HELD'
            && entry(row('ca:qa-ca-held:conference')) === 'Held for review · counts once approved', JSON.stringify(row('ca:qa-ca-held:conference')));
        check('held: a leg with no status reads HELD · no status (never "Free · pre-registered")', row('ca:qa-ca-null:conference').status === 'HELD'
            && entry(row('ca:qa-ca-null:conference')) === 'Held · no status · not counted', JSON.stringify(row('ca:qa-ca-null:conference')));
        check('held: a held Building Bridges leg is tagged HELD too', row('ca:qa-ca-bheld:bridges').status === 'HELD', JSON.stringify(row('ca:qa-ca-bheld:bridges')));
        check('held: counted legs stay FREE (pre-registered, Confirmed)', row('ca:qa-ca-live:conference').status === 'FREE' && entry(row('ca:qa-ca-live:conference')) === 'Free · pre-registered'
            && row('ca:qa-ca-cap:conference').status === 'FREE' && entry(row('ca:qa-ca-cap:conference')) === 'Free · Confirmed', JSON.stringify([row('ca:qa-ca-live:conference').status, entry(row('ca:qa-ca-cap:conference'))]));
        check('held: the no-status leg counts nowhere either', all.stats && all.stats.conference_people === c1.registrations, `${all.stats && all.stats.conference_people} vs ${c1.registrations}`);
        const free = await regRows('&status=FREE');
        check('held: the FREE filter lists no HELD row', !(free.rows || []).some(x => x.status === 'HELD') && (free.rows || []).some(x => x.key === 'ca:qa-ca-live:conference'), (free.rows || []).map(x => x.key + ':' + x.status).join(' '));

        // ------------------------------------------------------------ R · UNDO puts a free leg back exactly where it was
        const caStatus = id => g('SELECT conference_status AS s FROM croatians_abroad_registrations WHERE id = ?', [id]).s;
        const cancel = id => api(ADMIN, `/api/v2/registrations/croatians-abroad/${id}/cancel`, { method: 'POST', body: { event: 'conference' }, token: atok });
        const restore = (id, status) => api(ADMIN, `/api/v2/registrations/croatians-abroad/${id}/restore`, { method: 'POST', body: { status, event: 'conference' }, token: atok });
        r = await cancel('qa-ca-held');
        check('undo: cancelling the held leg reports previous_status pending-review', r.status === 200 && r.d.previous_status === 'pending-review' && caStatus('qa-ca-held') === 'cancelled', JSON.stringify(r.d));
        r = await restore('qa-ca-held', r.d.previous_status || 'pending');
        check('undo: …and UNDO puts it back on hold (was refused: "Cannot restore to that status")', r.status === 200 && caStatus('qa-ca-held') === 'pending-review', r.status + ' ' + JSON.stringify(r.d));
        r = await cancel('qa-ca-null');
        r = await restore('qa-ca-null', r.d.previous_status || 'pending');       // the client's fallback for an empty status
        check('undo: a leg that had no status comes back with no status (not the stray "pending")', r.status === 200 && caStatus('qa-ca-null') === null, r.status + ' ' + JSON.stringify(caStatus('qa-ca-null')));
        r = await cancel('qa-ca-cap');
        r = await restore('qa-ca-cap', r.d.previous_status || 'pending');
        check('undo: a live leg comes back as written ("Confirmed") and counts again', r.status === 200 && caStatus('qa-ca-cap') === 'Confirmed', JSON.stringify(caStatus('qa-ca-cap')));
        for (const bad of ['paid', 'approved', 'awaiting_payment', 'merged']) {
            r = await restore('qa-ca-live', bad);
            check(`undo: a free leg refuses the stray status "${bad}"`, r.status === 400 && caStatus('qa-ca-live') === 'pre-registered', r.status + ' ' + caStatus('qa-ca-live'));
        }
        const c2 = await counts();
        check('undo: after every UNDO the three counts are back where they were', c2.today === c1.today && c2.registrations === c1.registrations && c2.program === c1.program, JSON.stringify({ c1, c2 }));

        tdb.close();
    } catch (e) {
        check('unexpected error', false, (e && e.stack || e) + ' | admin stderr: ' + (procs[1] ? procs[1]._errbuf() : '') + ' | user stderr: ' + (procs[0] ? procs[0]._errbuf() : ''));
    } finally {
        const failed = results.filter(r => !r[1]).length;
        console.log(`\n${results.length - failed}/${results.length} passed`);
        cleanup();
        process.exit(failed ? 1 : 0);
    }
})();
