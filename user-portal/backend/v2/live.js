/**
 * v2/live.js — PLEXUS WEEK LIVE, the public program API of the event app (docs/EVENT-APP-BRIEF.md).
 * Guests hit the member portal, so the member backend owns the public routes AND runs the TBD
 * seed at boot; the admin backend's v2/program-ops.js edits the same rows. Core: shared/live-program.js.
 *
 * No login: a person is a LIVE TOKEN — HMAC(JWT_SECRET,'live:<kind>:<id>')[:32].<kind>.<id> — minted
 * from a registration row (kinds ca · gala · bridges — Boston guests are bridges rows — · speaker) and
 * handed out on the ticket pages / Boston me page / ticket emails (phase 2; plexus-ticket.liveUrl()).
 * A signed-in member is the literal token 'user' with the Bearer session. Unknown visitor → the
 * read-only program (events + program need no token at all).
 *
 * Routes (public, rate-limited like server.js's publicLimiter):
 *   GET  /api/live/events                       ?today=YYYY-MM-DD → { today, now, events: [{ key, label, short, kind, date, end_date, start, end,
 *                                                 starts_at, ends_at, tz, venue, address, city, is_today, is_live, is_past, is_upcoming, tentative,
 *                                                 times_tbd, session_count, published_count, tbd_count, program_updated_at, date_label, short_date }] }
 *   GET  /api/live/:eventKey/program            ?since=<iso> → { event, updated_at, changed, days: [{ date, label, short, sessions: [...] }], sessions, speakers }
 *                                                 (unchanged since `since` → { changed:false, updated_at } only)
 *                                                 session = { id, event_key, event_date, day_label, start_time, end_time, starts_at, ends_at, tz, title, kind,
 *                                                 description, room, location_note, track, capacity, speakers:[{id,name,title,institution,photo_url,logo_url}],
 *                                                 speaker_names:[{name,institution,topic}], is_tbd, show_counts, count (only when show_counts), sort_order, updated_at }
 *   GET  /api/live/:eventKey/sessions/:id.ics   one session as a calendar file (no token)
 *   GET  /api/live/me/:token                    → { ok, person: { kind, ref, name, first_name, is_speaker, speaker_id, speaker_session_ids, events, party },
 *                                                 events: [catalogue rows + held, party], attendance: { session_id: 'attending'|'declined' }, current_event }
 *   POST /api/live/me/:token/attend             { session_id, state:'attending'|'declined' } → { ok, session_id, state, party, count }
 *   GET  /api/live/me/:token/schedule           → { days, sessions (attending + speaking slots), conflicts: [ids] }
 *   GET  /api/live/me/:token/schedule.ics       ?session=<id> | ?date=YYYY-MM-DD | (all) → text/calendar
 *
 * Every 'me' open is recorded in v2_live_opens (the admin insight's "opened the app"). Nothing here
 * sends email. Both portals share ONE database — schema is guarded in shared/live-program.ensureSchema.
 */
'use strict';

const core = require('../../../shared/live-program');
const plexusTicket = require('../plexus-ticket');
// D17: the one e-mail-link helper the wallet uses (MEDX_VERIFIED_EMAIL_GATE on and the account unverified gives '__none__')
const { emailLinkFor } = require('./apple-pass.js');

function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
const rateLimitLib = tryRequire('express-rate-limit');
const passthrough = (req, res, next) => next();

module.exports = function mountLive(app, ctx) {
    const { optionalAuth } = ctx;
    const JWT_SECRET = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const log = ctx.log || ((...a) => console.log('[v2/live]', ...a));
    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    // Turso: server.js debounces db.sync() in saveDb(); mirror it here (no-op without TURSO_DATABASE_URL).
    let syncTimer = null;
    const persist = () => { if (ctx.saveDb) { try { ctx.saveDb(); } catch (e) { /* periodic */ } return; } if (!process.env.TURSO_DATABASE_URL) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => { try { ctx.db().sync(); } catch (e) { /* retried by the periodic sync */ } }, 2000); };
    const fail = (res, e, what) => { console.error('[v2/live] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    const optional = typeof optionalAuth === 'function' ? optionalAuth : passthrough;
    const mkLimiter = (max) => ctx.publicLimiter || (rateLimitLib ? rateLimitLib({ windowMs: 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } }) : passthrough);
    const readLimiter = mkLimiter(120), writeLimiter = mkLimiter(60);

    // ---- schema + seed (boot) ----
    core.ensureSchema(q, log);
    try { const r = core.runSeed(q, { log }); if (r.seeded) persist(); } catch (e) { log('seed failed:', e.message); }

    // ---- helpers ----
    const todayOf = req => { const t = String((req.query && req.query.today) || '').slice(0, 10); return core.isYmd(t) ? t : null; };
    const baseUrl = req => (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
    const nameOf = r => [r && r.first_name, r && r.last_name].filter(Boolean).join(' ').trim();
    const alive = s => !['cancelled', 'canceled', 'rejected', 'declined', 'withdrawn'].includes(String(s || '').toLowerCase());
    const eventOfBridgesRow = (eventId) => {
        if (!eventId) return null;
        if (eventId === core.BOSTON_EVENT_ID) return 'boston';
        try {
            const ev = q.get('SELECT id, slug FROM bridges_events WHERE id = ?', [eventId]);
            if (!ev) return null;
            if (ev.slug === 'boston' || ev.id === core.BOSTON_EVENT_ID) return 'boston';
            if (ev.slug === 'building-bridges') return 'bridges';
            if (ev.slug === 'donor-night') return 'donor';
        } catch (e) { /* absent */ }
        return null;
    };
    const guestsOf = caId => { try { return q.all('SELECT * FROM ca_registration_guests WHERE registration_id = ? ORDER BY rowid', [caId]) || []; } catch (e) { return []; } };
    // A CA row → the legs it holds with people per leg (registrant + guests ticking that leg; gala = billed seats)
    function caParty(ca, galaRow) {
        const g = galaRow || (ca.gala_registration_id ? (q.get('SELECT * FROM gala_registrations WHERE id = ?', [ca.gala_registration_id]) || null) : null);
        const legs = [];
        if (Number(ca.selected_conference) && alive(ca.conference_status)) legs.push('conference');
        if (Number(ca.selected_bridges) && alive(ca.bridges_status)) legs.push('bridges');
        const hasGala = !!(g && alive(g.status) && alive(g.payment_status)) || (!g && Number(ca.selected_gala) && alive(ca.gala_status));
        if (hasGala) legs.push('gala');
        const seats = 1 + Math.max(0, parseInt((g || ca || {}).guest_count, 10) || 0);
        const p = plexusTicket.partyByLeg(legs, guestsOf(ca.id), seats);
        const party = {};
        for (const l of legs) party[l] = Math.max(1, Number(p[l]) || 1);
        return party;
    }
    const mergeParty = (into, from) => { for (const k of Object.keys(from || {})) into[k] = Math.max(Number(into[k] || 0), Number(from[k] || 0)); return into; };
    function speakerByEmail(email) {
        if (!email) return null;
        try { return q.get('SELECT id, name, email FROM speakers WHERE LOWER(email) = LOWER(?) ORDER BY rowid LIMIT 1', [String(email).trim()]) || null; } catch (e) { return null; }
    }
    function speakerSessions(speakerId) {
        if (!speakerId) return [];
        try { return q.all("SELECT id, event_key FROM sessions WHERE event_key IS NOT NULL AND (',' || COALESCE(speaker_ids, '') || ',') LIKE ?", ['%,' + speakerId + ',%']); } catch (e) { return []; }
    }
    /**
     * A live token → the person: { kind, ref (canonical: the CA row when one exists), name, first_name, email,
     * party: { event_key: n }, events: [keys], is_speaker, speaker_id, speaker_session_ids } — or null.
     */
    function resolvePerson(tok, req) {
        if (!tok) return null;
        let person = null;
        const party = {};
        let email = null, name = '', kind = tok.kind, ref = tok.id, speakerId = null;
        let linkEmail = null;   // the address rows no account owns may match by. For 'user' it goes through emailLinkFor.
        if (tok.kind === 'ca') {
            const ca = q.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [tok.id]); if (!ca) return null;
            mergeParty(party, caParty(ca)); name = nameOf(ca); email = ca.email;
        } else if (tok.kind === 'gala') {
            const g = q.get('SELECT * FROM gala_registrations WHERE id = ?', [tok.id]); if (!g) return null;
            const ca = q.get('SELECT * FROM croatians_abroad_registrations WHERE gala_registration_id = ?', [g.id]);
            if (ca) { kind = 'ca'; ref = ca.id; mergeParty(party, caParty(ca, g)); }
            else if (alive(g.status) && alive(g.payment_status)) party.gala = 1 + Math.max(0, parseInt(g.guest_count, 10) || 0);
            name = nameOf(g); email = g.email;
        } else if (tok.kind === 'bridges') {
            const b = q.get('SELECT * FROM bridges_registrations WHERE id = ?', [tok.id]); if (!b) return null;
            const ek = eventOfBridgesRow(b.event_id);
            if (ek && alive(b.status)) party[ek] = 1;
            name = nameOf(b); email = b.email;
        } else if (tok.kind === 'speaker') {
            const s = q.get('SELECT id, name, email FROM speakers WHERE id = ?', [tok.id]); if (!s) return null;
            speakerId = s.id; name = s.name || ''; email = s.email || null;
        } else if (tok.kind === 'user') {
            const u = req && req.user && req.user.id ? (q.get('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [req.user.id]) || { id: req.user.id, email: req.user.email }) : null;
            if (!u) return null;
            name = nameOf(u) || String(u.email || '').split('@')[0]; email = u.email; ref = u.id;
            // linked registrations: by account, then by e-mail — the address only for rows no account has claimed
            // (a closed account's rows keep its id, so a new sign-up on the freed address never inherits them).
            // D17: the address comes from emailLinkFor, so with the gate on an unverified account links no row by e-mail.
            let verified = 0;
            try { const v = q.get('SELECT email_verified FROM users WHERE id = ?', [u.id]); verified = v ? v.email_verified : 0; } catch (e) { /* no email_verified column: counts as unverified */ }
            const em = emailLinkFor({ email: u.email, email_verified: verified });
            linkEmail = em === '__none__' ? '' : em;
            const cas = q.all('SELECT * FROM croatians_abroad_registrations WHERE user_id = ? OR (user_id IS NULL AND LOWER(email) = LOWER(?) AND ? <> \'\') ORDER BY created_at DESC', [u.id, linkEmail, linkEmail]);
            const galas = q.all('SELECT * FROM gala_registrations WHERE user_id = ? OR (user_id IS NULL AND LOWER(email) = LOWER(?) AND ? <> \'\') ORDER BY created_at DESC', [u.id, linkEmail, linkEmail]);
            let bridges = []; try { bridges = q.all('SELECT * FROM bridges_registrations WHERE user_id = ? OR (user_id IS NULL AND LOWER(email) = LOWER(?) AND ? <> \'\')', [u.id, linkEmail, linkEmail]); } catch (e) { bridges = []; }
            for (const ca of cas) mergeParty(party, caParty(ca));
            for (const g of galas) if (!cas.some(c => c.gala_registration_id === g.id) && alive(g.status) && alive(g.payment_status)) mergeParty(party, { gala: 1 + Math.max(0, parseInt(g.guest_count, 10) || 0) });
            for (const b of bridges) { const ek = eventOfBridgesRow(b.event_id); if (ek && alive(b.status)) mergeParty(party, { [ek]: 1 }); }
            // canonical identity for counting = the ticket row the person would also open by link
            if (cas.length) { kind = 'ca'; ref = cas[0].id; }
            else if (galas.length) { kind = 'gala'; ref = galas[0].id; }
            else if (bridges.length) { kind = 'bridges'; ref = bridges[0].id; }
        } else return null;
        // ONE person across every form: whatever link they opened (a Gala ticket, the Boston page, a speaker link),
        // every other registration under the same e-mail joins their events — conference · Bridges · Gala ·
        // Donor Night — so the schedule is complete whichever door they came in by. The /plexus form row is the
        // canonical identity (the same one its own ticket link resolves to), so taps never split across doors.
        if (email && tok.kind !== 'user') {
            try {
                const cas = q.all('SELECT * FROM croatians_abroad_registrations WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC', [email]);
                for (const ca of cas) mergeParty(party, caParty(ca));
                const galas = q.all('SELECT * FROM gala_registrations WHERE LOWER(email) = LOWER(?)', [email]);
                for (const g of galas) if (!cas.some(c => c.gala_registration_id === g.id) && alive(g.status) && alive(g.payment_status)) mergeParty(party, { gala: 1 + Math.max(0, parseInt(g.guest_count, 10) || 0) });
                let brs = []; try { brs = q.all('SELECT * FROM bridges_registrations WHERE LOWER(email) = LOWER(?)', [email]); } catch (e) { brs = []; }
                for (const b of brs) { const ek = eventOfBridgesRow(b.event_id); if (ek && alive(b.status)) mergeParty(party, { [ek]: 1 }); }
                const live = cas.find(c => ['conference_status', 'bridges_status', 'gala_status'].some(k => alive(c[k]) && String(c[k] || '').toLowerCase() !== 'merged'));
                if (live && kind !== 'ca') { kind = 'ca'; ref = live.id; }
            } catch (e) { /* a table absent on a fresh DB */ }
        }
        // meetups: a confirmed (or promoted) place, or hosting one, holds that meetup — found by account or e-mail
        try {
            const uid = tok.kind === 'user' && req && req.user ? req.user.id : null;
            const meetupEmail = (tok.kind === 'user' ? linkEmail : email) || '';
            if (meetupEmail || uid) {
                q.all(`SELECT DISTINCT meetup_id AS id FROM plexus_meetup_attendees WHERE status IN ('confirmed', 'promoted')
                         AND ((? IS NOT NULL AND user_id = ?) OR (? <> '' AND user_id IS NULL AND LOWER(email) = LOWER(?)))`, [uid, uid, meetupEmail, meetupEmail])
                    .concat(q.all(`SELECT id FROM plexus_meetups WHERE status IN ('published', 'completed')
                         AND ((? IS NOT NULL AND host_user_id = ?) OR (? <> '' AND host_user_id IS NULL AND LOWER(host_email) = LOWER(?)))`, [uid, uid, meetupEmail, meetupEmail]))
                    .forEach(m => { if (m && m.id) party['meetup:' + m.id] = Math.max(1, Number(party['meetup:' + m.id] || 0)); });
            }
        } catch (e) { /* meetup tables absent */ }
        // a registrant who is also a speaker (by e-mail) gets their slots too
        if (!speakerId) { const sp = speakerByEmail(email); if (sp) speakerId = sp.id; }
        const slots = speakerSessions(speakerId);
        for (const s of slots) if (s.event_key && !party[s.event_key]) party[s.event_key] = 1;
        if (tok.kind === 'speaker' && !slots.length) { /* a speaker with no slot yet still opens the app read-only */ }
        person = {
            kind, ref, token_kind: tok.kind, name: name || 'Guest', first_name: (name || '').split(/\s+/)[0] || 'Guest', email: email || null,
            party, events: Object.keys(party), is_speaker: !!speakerId, speaker_id: speakerId, speaker_session_ids: slots.map(s => s.id)
        };
        return person;
    }
    function personFromReq(req) {
        const tok = core.verifyLiveToken(JWT_SECRET, req.params.token);
        if (!tok) return { error: 404 };
        if (tok.kind === 'user' && !(req.user && req.user.id)) return { error: 401 };
        const person = resolvePerson(tok, req);
        if (!person) return { error: 404 };
        return { person };
    }
    const sendIcs = (res, filename, body) => { res.set('Content-Type', 'text/calendar; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="${filename}"`); res.set('Cache-Control', 'private, no-store'); return res.send(body); };
    // the public session shape: counts only when the admin enabled them
    const publicSession = s => { const o = Object.assign({}, s); if (!s.show_counts) delete o.count; return o; };
    // the event the app should open: today's held event whose window holds now → next upcoming held → first held → today's/next any
    function guessEvent(events, held) {
        const mine = events.filter(e => held.includes(e.key));
        const pool = mine.length ? mine : events;
        return (pool.find(e => e.is_live) || pool.find(e => e.is_today) || pool.find(e => e.is_upcoming) || pool[0] || {}).key || null;
    }

    // ---- routes ----
    app.get('/api/live/events', readLimiter, (req, res) => {
        try {
            const today = todayOf(req);
            const events = core.eventCatalogue(q, { today });
            res.set('Cache-Control', 'public, max-age=30');
            res.json({ today: today || core.localNow(core.ZAGREB).date, now: core.nowIso(), events });
        } catch (e) { fail(res, e, 'events'); }
    });

    app.get('/api/live/me/:token', readLimiter, optional, (req, res) => {
        try {
            const r = personFromReq(req);
            if (r.error === 401) return res.status(401).json({ error: 'Sign in to open your live schedule.' });
            if (r.error) return res.status(404).json({ error: 'That link is not one of ours — open the app from your ticket.' });
            const p = r.person;
            const events = core.eventCatalogue(q, { today: todayOf(req) }).map(e => Object.assign({}, e, { held: p.events.includes(e.key), party: Number(p.party[e.key] || 0) }));
            core.recordOpen(q, { personKind: p.kind, personRef: p.ref, personName: p.name, events: p.events });
            persist();
            res.set('Cache-Control', 'private, no-store');
            res.json({ ok: true, person: p, events, attendance: core.attendanceOf(q, p.kind, p.ref), current_event: guessEvent(events, p.events), now: core.nowIso() });
        } catch (e) { fail(res, e, 'me'); }
    });

    app.post('/api/live/me/:token/attend', writeLimiter, optional, (req, res) => {
        try {
            const r = personFromReq(req);
            if (r.error === 401) return res.status(401).json({ error: 'Sign in to build your schedule.' });
            if (r.error) return res.status(404).json({ error: 'That link is not one of ours.' });
            const p = r.person;
            const body = req.body || {};
            const sessionId = String(body.session_id || '').trim();
            const state = String(body.state || 'attending').toLowerCase();
            if (!sessionId) return res.status(400).json({ error: 'Which session?' });
            if (!core.STATES.includes(state)) return res.status(400).json({ error: 'State must be attending or declined.' });
            if (/^meetup:/.test(sessionId)) return res.status(400).json({ error: 'Your meetup place is kept on the meetup page.' });
            const row = q.get('SELECT * FROM sessions WHERE id = ? AND event_key IS NOT NULL', [sessionId]);
            if (!row || !Number(row.is_published)) return res.status(404).json({ error: 'That session is not on the program.' });
            const speaking = p.speaker_session_ids.includes(row.id);
            if (!p.events.includes(row.event_key) && !speaking) return res.status(403).json({ error: 'That event is not on your ticket.' });
            const party = Math.max(1, Number(p.party[row.event_key] || 1));
            const count = core.setAttendance(q, { sessionId: row.id, eventKey: row.event_key, personKind: p.kind, personRef: p.ref, personName: p.name, party, state });
            persist();
            res.set('Cache-Control', 'private, no-store');
            res.json({ ok: true, session_id: row.id, state, party, count: Number(row.show_counts) ? count : undefined, counted: count });
        } catch (e) { fail(res, e, 'attend'); }
    });

    // The person's schedule builds itself from what they registered for: every published session of every
    // event they hold (conference · Gala · Bridges · Donor Night · their meetups) is IN unless they tapped it
    // off ('declined'), plus anything they tapped on elsewhere, plus the slots where they speak.
    function scheduleOf(p) {
        const att = core.attendanceOf(q, p.kind, p.ref);
        const byId = new Map();
        for (const key of p.events) {
            let list = []; try { list = core.loadSessions(q, key, { publishedOnly: true, withCounts: false }); } catch (e) { list = []; }
            for (const s of list) if (att[s.id] !== 'declined') byId.set(s.id, Object.assign({}, s, { auto: att[s.id] !== 'attending' }));
        }
        const extra = Object.keys(att).filter(id => att[id] === 'attending').concat(p.speaker_session_ids).filter(id => !byId.has(id));
        const rows = extra.length ? q.all(`SELECT * FROM sessions WHERE id IN (${extra.map(() => '?').join(',')}) AND COALESCE(is_published, 0) = 1 AND event_key IS NOT NULL`, extra) : [];
        const dir = core.speakerDirectory(q, [].concat(...rows.map(r => core.parseIds(r.speaker_ids))));
        rows.forEach(r => byId.set(r.id, Object.assign(core.rowToSession(r, dir), { auto: false })));
        if (!byId.size) return { sessions: [], days: [], conflicts: [] };
        const events = {}; core.eventCatalogue(q).forEach(e => { events[e.key] = e; });
        const sessions = Array.from(byId.values()).map(r => Object.assign(publicSession(r), { event_label: (events[r.event_key] || {}).label || r.event_key, venue: (events[r.event_key] || {}).venue || '', speaking: p.speaker_session_ids.includes(r.id), state: p.speaker_session_ids.includes(r.id) ? 'speaking' : (att[r.id] || 'included') }))
            .sort((a, b) => String(a.event_date || '').localeCompare(String(b.event_date || '')) || String(a.start_time || '99').localeCompare(String(b.start_time || '99')) || a.sort_order - b.sort_order);
        const conflicts = Array.from(core.scheduleConflicts(sessions));
        sessions.forEach(s => { s.conflict = conflicts.includes(s.id); });
        return { sessions, days: core.groupByDay(sessions), conflicts };
    }
    app.get('/api/live/me/:token/schedule', readLimiter, optional, (req, res) => {
        try {
            const r = personFromReq(req);
            if (r.error === 401) return res.status(401).json({ error: 'Sign in to see your schedule.' });
            if (r.error) return res.status(404).json({ error: 'That link is not one of ours.' });
            res.set('Cache-Control', 'private, no-store');
            res.json(Object.assign({ ok: true, person: { name: r.person.name, kind: r.person.kind } }, scheduleOf(r.person)));
        } catch (e) { fail(res, e, 'schedule'); }
    });
    app.get('/api/live/me/:token/schedule.ics', readLimiter, optional, (req, res) => {
        try {
            const r = personFromReq(req);
            if (r.error) return res.status(404).send('Not found');
            let { sessions } = scheduleOf(r.person);
            const one = String(req.query.session || '').trim(), day = String(req.query.date || '').slice(0, 10);
            if (one) sessions = sessions.filter(s => s.id === one);
            else if (core.isYmd(day)) sessions = sessions.filter(s => s.event_date === day);
            if (!sessions.length) return res.status(404).send('Nothing on your schedule for that.');
            const ev = core.eventByKey(q, sessions[0].event_key);
            const name = one ? 'plexus-live-session.ics' : core.isYmd(day) ? `plexus-live-${day}.ics` : 'plexus-live-my-schedule.ics';
            return sendIcs(res, name, core.icsForSessions(sessions, ev, { url: baseUrl(req) + '/live/' + req.params.token }));
        } catch (e) { fail(res, e, 'schedule.ics'); }
    });

    app.get('/api/live/:eventKey/program', readLimiter, (req, res) => {
        try {
            const key = String(req.params.eventKey || '');
            if (!core.isEventKey(key)) return res.status(404).json({ error: 'No such event.' });
            const event = core.eventByKey(q, key, { today: todayOf(req) });
            if (!event) return res.status(404).json({ error: 'No such event.' });
            const { updated_at } = core.lastUpdated(q, key);
            const since = String(req.query.since || '').trim();
            res.set('Cache-Control', 'no-cache');
            if (since && updated_at && !isNaN(new Date(since).getTime()) && new Date(updated_at).getTime() <= new Date(since).getTime()) return res.json({ changed: false, updated_at, event_key: key });
            const sessions = core.loadSessions(q, key, { publishedOnly: true }).map(publicSession);
            const speakers = {}; sessions.forEach(s => s.speakers.forEach(sp => { if (sp && sp.id) speakers[sp.id] = sp; }));
            res.json({ changed: true, updated_at, event, days: core.groupByDay(sessions), sessions, speakers });
        } catch (e) { fail(res, e, 'program'); }
    });

    app.get('/api/live/:eventKey/sessions/:id.ics', readLimiter, (req, res) => {
        try {
            const key = String(req.params.eventKey || '');
            const row = q.get('SELECT * FROM sessions WHERE id = ? AND event_key = ? AND COALESCE(is_published, 0) = 1', [String(req.params.id || ''), key]);
            if (!row) return res.status(404).send('Not found');
            const ev = core.eventByKey(q, key);
            const s = core.rowToSession(row, core.speakerDirectory(q, core.parseIds(row.speaker_ids)));
            return sendIcs(res, 'plexus-live-session.ics', core.icsForSessions([s], ev));
        } catch (e) { fail(res, e, 'session.ics'); }
    });

    log('live: public program API ready (events · program · me · attend · schedule)');
};
// exported for the ticket pages / Boston me page / ticket emails (phase 2): the app link of a person
module.exports.liveUrl = core.liveUrl;
module.exports.liveToken = core.liveToken;
