/**
 * v2/program-ops.js — the PROGRAM EDITOR's API (frontend-v2 › js/views/program.js, route /program/:eventKey).
 * The event app's program (docs/EVENT-APP-BRIEF.md) lives in the shared `sessions` table, extended by
 * shared/live-program.js (event_key · event_date · sort_order · location_note · kind · speaker_names_json ·
 * is_tbd · show_counts). The member backend (user-portal/backend/v2/live.js) serves it to guests and runs
 * the TBD seed; this module is where Alen and Laura change times, rooms, speakers — "that stuff changes
 * a lot". Every write appends an audit_log row and touches the event's version stamp, so a phone polling
 * /api/live/:event/program?since= sees the change within a minute.
 *
 * Routes (all auth + adminOnly; not in SECTION_ROUTE_MAP → every admin, like TASKS and NOTES):
 *   GET    /api/v2/program/events                        → { today, events: [catalogue rows + session_count · published_count · tbd_count · attending] }
 *   GET    /api/v2/program/speakers?q=                   → { speakers: [{ id, name, title, institution, photo_url, logo_url }] }   (typeahead, ≤ 12)
 *   GET    /api/v2/program/:eventKey/sessions            → { event, sessions: [session + count], days, conflicts: [{a,b}], updated_at }
 *   POST   /api/v2/program/:eventKey/sessions            { title, kind, event_date, start_time, end_time, room, location_note, track, capacity, description,
 *                                                          speaker_ids, speaker_names, is_tbd, show_counts, is_published, after_id?, id? (undo) } → { session }
 *   PUT    /api/v2/program/:eventKey/sessions/reorder    { order: [ids] } (one day's rows, top to bottom) → { ok, sessions }
 *   POST   /api/v2/program/:eventKey/sessions/shift      { after:'HH:MM', minutes:±N, date? } → { ok, moved, sessions }
 *   PUT    /api/v2/program/:eventKey/sessions/:id        (any subset of the POST fields) → { session }
 *   DELETE /api/v2/program/:eventKey/sessions/:id        → { ok, session (the row as it was — POST it back with `id` to undo) }
 *   POST   /api/v2/program/:eventKey/sessions/:id/duplicate → { session }
 *   PUT    /api/v2/program/:eventKey/sessions/:id/publish { is_published } → { session }
 *   PUT    /api/v2/program/:eventKey/sessions/:id/tbd     { is_tbd } → { session }
 *   PUT    /api/v2/program/:eventKey/publish             { is_published } (every session of the event) → { ok, changed }
 *   GET    /api/v2/program/:eventKey/attendance          → { sessions: [{ id, title, event_date, start_time, end_time, room, capacity, count, over, people: [{ name, party, kind, ref, state, updated_at }] }] }
 *   GET    /api/v2/program/:eventKey/attendance.csv      UTF-8 BOM · CRLF
 *   GET    /api/v2/program/:eventKey/insight             → { registered, registered_seats, opened, scheduled, sessions, published, tbd, top: [{ id, title, start_time, count, capacity }],
 *                                                          speakers_unopened: [{ id, name, sessions }], attending_total }
 *   GET    /api/live/speaker-link/:speakerId             → { speaker_id, name, email, url, token, sessions } — the speaker's own Plexus Week Live link
 *                                                          (kind 'speaker'), for the team to paste into a speaker email. Nothing is sent from here.
 * Admin reads go through this backend's own DB handle (its Turso replica) — a write here is visible
 * to the member backend after its next sync (≤ 60 s), which is also the phones' poll interval.
 */
'use strict';

const crypto = require('crypto');
const core = require('../../../shared/live-program');

module.exports = function mountProgramOps(app, ctx) {
    const { auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/program-ops]', ...a));
    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    const persist = () => { try { saveDb && saveDb(); } catch (e) { /* periodic save still runs */ } };
    const fail = (res, e, what) => { console.error('[v2/program-ops] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    function audit(req, action, detail) {
        try {
            q.run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail, created_at) VALUES (?,?,?,?,?,?)',
                [crypto.randomUUID(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 500), core.nowIso()]);
        } catch (e) { /* best-effort */ }
    }

    // ---- schema (guarded, identical to the member side) ----
    core.ensureSchema(q, log);

    // ---- helpers ----
    const todayOf = req => { const t = String((req.query && req.query.today) || '').slice(0, 10); return core.isYmd(t) ? t : null; };
    const keyOf = req => { const k = String(req.params.eventKey || ''); return core.isEventKey(k) ? k : null; };
    const rowOf = (key, id) => q.get('SELECT * FROM sessions WHERE id = ? AND event_key = ?', [String(id || ''), key]);
    const dirFor = rows => core.speakerDirectory(q, [].concat(...rows.map(r => core.parseIds(r.speaker_ids))));
    const one = (row) => { const dir = dirFor([row]); const counts = core.attendanceCounts(q, row.event_key); return Object.assign(core.rowToSession(row, dir), { count: counts[row.id] || 0 }); };
    const listing = key => {
        const sessions = core.loadSessions(q, key);
        return { sessions, days: core.groupByDay(sessions), conflicts: core.roomConflicts(sessions), updated_at: core.lastUpdated(q, key).updated_at };
    };
    const brief = r => `${r.event_key} · ${r.title || '(untitled)'}${r.event_date ? ' · ' + r.event_date : ''}${r.start_time ? ' ' + r.start_time : ''}${r.end_time ? '–' + r.end_time : ''}`;
    const touch = key => { core.touchEvent(q, key); persist(); };
    const nextSortOrder = (key, date) => { const r = q.get('SELECT MAX(sort_order) AS m FROM sessions WHERE event_key = ? AND COALESCE(event_date, \'\') = COALESCE(?, \'\')', [key, date || null]); return (Number((r && r.m) || 0) || 0) + 10; };
    const defaultDate = key => { const e = core.eventByKey(q, key); return e && e.date ? e.date : null; };

    // registrants per event — who holds a ticket (rows) and seats (with guests) — best-effort per table
    function registeredFor(key) {
        const alive = "NOT IN ('cancelled','canceled','rejected','declined','withdrawn')";
        let people = 0, seats = 0;
        const add = (sql, params, seatSql) => { try { const r = q.get(sql, params || []); people += Number((r && r.n) || 0); seats += Number((r && (seatSql ? r.s : r.n)) || 0); } catch (e) { /* table absent */ } };
        if (key === 'conference') add(`SELECT COUNT(*) AS n, COUNT(*) + COALESCE((SELECT COUNT(*) FROM ca_registration_guests g JOIN croatians_abroad_registrations c2 ON c2.id = g.registration_id WHERE COALESCE(g.conference, 0) = 1 AND COALESCE(c2.selected_conference, 0) = 1 AND LOWER(COALESCE(c2.conference_status, '')) ${alive}), 0) AS s FROM croatians_abroad_registrations WHERE COALESCE(selected_conference, 0) = 1 AND LOWER(COALESCE(conference_status, '')) ${alive}`, [], true);
        if (key === 'bridges') {
            add(`SELECT COUNT(*) AS n, COUNT(*) + COALESCE((SELECT COUNT(*) FROM ca_registration_guests g JOIN croatians_abroad_registrations c2 ON c2.id = g.registration_id WHERE COALESCE(g.bridges, 0) = 1 AND COALESCE(c2.selected_bridges, 0) = 1 AND LOWER(COALESCE(c2.bridges_status, '')) ${alive}), 0) AS s FROM croatians_abroad_registrations WHERE COALESCE(selected_bridges, 0) = 1 AND LOWER(COALESCE(bridges_status, '')) ${alive}`, [], true);
            add(`SELECT COUNT(*) AS n FROM bridges_registrations r JOIN bridges_events e ON e.id = r.event_id WHERE e.slug = 'building-bridges' AND LOWER(COALESCE(r.status, '')) ${alive}`);
        }
        if (key === 'donor') add(`SELECT COUNT(*) AS n FROM bridges_registrations r JOIN bridges_events e ON e.id = r.event_id WHERE e.slug = 'donor-night' AND LOWER(COALESCE(r.status, '')) ${alive}`);
        if (key === 'boston') add(`SELECT COUNT(*) AS n FROM bridges_registrations r WHERE (r.event_id = ? OR r.event_id IN (SELECT id FROM bridges_events WHERE slug = 'boston')) AND LOWER(COALESCE(r.status, '')) ${alive}`, [core.BOSTON_EVENT_ID]);
        if (key === 'gala') add(`SELECT COUNT(*) AS n, COUNT(*) + COALESCE(SUM(COALESCE(guest_count, 0)), 0) AS s FROM gala_registrations WHERE LOWER(COALESCE(status, '')) ${alive} AND (LOWER(COALESCE(payment_status, '')) IN ('paid','comp','vip-comp') OR LOWER(COALESCE(status, '')) = 'confirmed')`, [], true);
        if (/^meetup:/.test(key)) add(`SELECT COUNT(*) AS n FROM plexus_meetup_attendees WHERE meetup_id = ? AND status IN ('confirmed','promoted')`, [key.slice(7)]);
        return { people, seats };
    }

    // ---- events + speakers ----
    app.get('/api/v2/program/events', auth, adminOnly, (req, res) => {
        try {
            const events = core.eventCatalogue(q, { today: todayOf(req) });
            let attending = {};
            try { q.all("SELECT event_key, COUNT(DISTINCT person_kind || ':' || person_ref) AS n FROM v2_session_attendance WHERE state = 'attending' GROUP BY event_key").forEach(r => { attending[r.event_key] = Number(r.n || 0); }); } catch (e) { attending = {}; }
            res.set('Cache-Control', 'private, no-store');
            res.json({ today: todayOf(req) || core.localNow(core.ZAGREB).date, events: events.map(e => Object.assign({}, e, { attending: attending[e.key] || 0 })) });
        } catch (e) { fail(res, e, 'events'); }
    });
    app.get('/api/v2/program/speakers', auth, adminOnly, (req, res) => {
        try {
            const needle = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
            const meta = core.hasTable(q, 'v2_speaker_meta');
            const rows = q.all(`SELECT s.id, s.name, s.title, s.institution, s.photo_url, s.email${meta ? ', m.institution_logo_url AS logo_url' : ''} FROM speakers s${meta ? ' LEFT JOIN v2_speaker_meta m ON m.speaker_id = s.id' : ''}
                WHERE ${needle ? '(LOWER(COALESCE(s.name, \'\')) LIKE ? OR LOWER(COALESCE(s.institution, \'\')) LIKE ? OR LOWER(COALESCE(s.email, \'\')) LIKE ?)' : '1=1'} ORDER BY s.sort_order, s.name LIMIT 12`, needle ? ['%' + needle + '%', '%' + needle + '%', '%' + needle + '%'] : []);
            res.json({ speakers: rows.map(r => ({ id: r.id, name: r.name || '', title: r.title || '', institution: r.institution || '', photo_url: r.photo_url || null, logo_url: r.logo_url || null })) });
        } catch (e) { fail(res, e, 'speakers'); }
    });

    // ---- sessions ----
    app.get('/api/v2/program/:eventKey/sessions', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const event = core.eventByKey(q, key, { today: todayOf(req) });
            res.set('Cache-Control', 'private, no-store');
            res.json(Object.assign({ event }, listing(key)));
        } catch (e) { fail(res, e, 'list'); }
    });

    app.post('/api/v2/program/:eventKey/sessions', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const body = req.body || {};
            const c = core.cleanSessionInput(body); if (c.error) return res.status(400).json({ error: c.error });
            const v = c.values;
            const isBreak = v.kind === 'break';
            if (!v.title && !isBreak) return res.status(400).json({ error: 'Give the session a title (or mark it TBD with a working title).' });
            const wantId = String(body.id || '').trim();
            if (wantId && !/^[A-Za-z0-9_-]{8,80}$/.test(wantId)) return res.status(400).json({ error: 'That id is not usable.' });
            if (wantId && q.get('SELECT id FROM sessions WHERE id = ?', [wantId])) return res.status(409).json({ error: 'That session already exists.' });
            const id = wantId || core.uuid();
            const date = v.event_date !== undefined ? v.event_date : defaultDate(key);
            let sort = v.sort_order;
            if (sort === undefined) {
                const after = body.after_id ? rowOf(key, body.after_id) : null;
                sort = after ? Number(after.sort_order || 0) + 5 : nextSortOrder(key, date);
            }
            const now = core.nowIso();
            q.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room, track, speaker_ids, is_published, capacity,
                                        event_key, event_date, sort_order, location_note, kind, speaker_names_json, is_tbd, show_counts, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [id, null, v.title || (isBreak ? 'Break' : ''), v.description || null, v.kind || 'other', 1, v.start_time || null, v.end_time || null, v.room || null, v.track || null, v.speaker_ids || null,
                 v.is_published === undefined ? 1 : v.is_published, v.capacity === undefined ? null : v.capacity,
                 key, date, sort, v.location_note || null, v.kind || 'other', v.speaker_names_json || null, v.is_tbd || 0, v.show_counts || 0, now]);
            const row = rowOf(key, id);
            audit(req, wantId ? 'program.session_restored' : 'program.session_added', brief(row));
            touch(key);
            res.json({ session: one(row), conflicts: core.roomConflicts(core.loadSessions(q, key, { withCounts: false })) });
        } catch (e) { fail(res, e, 'create'); }
    });

    // reorder BEFORE /:id — Express matches in registration order
    app.put('/api/v2/program/:eventKey/sessions/reorder', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const order = Array.isArray(req.body && req.body.order) ? req.body.order.map(x => String(x || '').trim()).filter(Boolean) : [];
            if (!order.length) return res.status(400).json({ error: 'Send the ids in their new order.' });
            const rows = order.map(id => rowOf(key, id)).filter(Boolean);
            if (rows.length !== order.length) return res.status(404).json({ error: 'One of those sessions is not in this program any more — reload.' });
            const now = core.nowIso();
            rows.forEach((r, i) => q.run('UPDATE sessions SET sort_order = ?, updated_at = ? WHERE id = ?', [(i + 1) * 10, now, r.id]));
            audit(req, 'program.reordered', `${key} · ${rows.length} rows`);
            touch(key);
            res.json(Object.assign({ ok: true }, listing(key)));
        } catch (e) { fail(res, e, 'reorder'); }
    });

    app.post('/api/v2/program/:eventKey/sessions/shift', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const b = req.body || {};
            const after = core.hm(b.after); const mins = Number(b.minutes);
            if (!after) return res.status(400).json({ error: 'After which time? HH:MM.' });
            if (!Number.isInteger(mins) || mins === 0 || Math.abs(mins) > 12 * 60) return res.status(400).json({ error: 'By how many minutes? A whole number, up to ±720.' });
            const date = core.isYmd(String(b.date || '').slice(0, 10)) ? String(b.date).slice(0, 10) : null;
            const rows = q.all(`SELECT * FROM sessions WHERE event_key = ? AND start_time IS NOT NULL${date ? ' AND event_date = ?' : ''}`, date ? [key, date] : [key])
                .filter(r => core.minutes(r.start_time) != null && core.minutes(r.start_time) >= core.minutes(after));
            const now = core.nowIso();
            let moved = 0;
            for (const r of rows) {
                const s = core.minutes(r.start_time) + mins; if (s < 0 || s > 1439) continue;
                const e = core.minutes(r.end_time); const e2 = e == null ? null : Math.min(1439, Math.max(s, e + mins));
                q.run('UPDATE sessions SET start_time = ?, end_time = ?, updated_at = ? WHERE id = ?', [core.fromMinutes(s), e2 == null ? null : core.fromMinutes(e2), now, r.id]);
                moved++;
            }
            audit(req, 'program.shifted', `${key}${date ? ' · ' + date : ''} · after ${after} by ${mins > 0 ? '+' : ''}${mins} min · ${moved} rows`);
            touch(key);
            res.json(Object.assign({ ok: true, moved }, listing(key)));
        } catch (e) { fail(res, e, 'shift'); }
    });

    app.put('/api/v2/program/:eventKey/sessions/:id', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const row = rowOf(key, req.params.id); if (!row) return res.status(404).json({ error: 'That session is not here any more.' });
            const c = core.cleanSessionInput(req.body || {}, row); if (c.error) return res.status(400).json({ error: c.error });
            const v = c.values; const keys = Object.keys(v);
            if (!keys.length) return res.json({ session: one(row) });
            if (v.title !== undefined && !v.title && (v.kind || core.normalizeKind(row.kind, row.session_type)) !== 'break') return res.status(400).json({ error: 'A session needs a title.' });
            const sets = keys.map(k => `${k} = ?`); const vals = keys.map(k => v[k]);
            if (v.kind !== undefined) { sets.push('session_type = ?'); vals.push(v.kind); }
            sets.push('updated_at = ?'); vals.push(core.nowIso());
            q.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, vals.concat([row.id]));
            const after = rowOf(key, row.id);
            audit(req, 'program.session_edited', brief(after) + ' · ' + keys.join(','));
            touch(key);
            res.json({ session: one(after), conflicts: core.roomConflicts(core.loadSessions(q, key, { withCounts: false })) });
        } catch (e) { fail(res, e, 'update'); }
    });

    app.delete('/api/v2/program/:eventKey/sessions/:id', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const row = rowOf(key, req.params.id); if (!row) return res.status(404).json({ error: 'That session is not here any more.' });
            const gone = one(row);
            q.run('DELETE FROM sessions WHERE id = ?', [row.id]);
            try { q.run('DELETE FROM v2_session_attendance WHERE session_id = ?', [row.id]); } catch (e) { /* none */ }
            audit(req, 'program.session_deleted', brief(row));
            touch(key);
            res.json({ ok: true, session: gone });
        } catch (e) { fail(res, e, 'delete'); }
    });

    app.post('/api/v2/program/:eventKey/sessions/:id/duplicate', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const row = rowOf(key, req.params.id); if (!row) return res.status(404).json({ error: 'That session is not here any more.' });
            const id = core.uuid(); const now = core.nowIso();
            q.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room, track, speaker_ids, is_published, capacity,
                                        event_key, event_date, sort_order, location_note, kind, speaker_names_json, is_tbd, show_counts, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [id, row.conference_id, (row.title || '') + ' (copy)', row.description, row.session_type, row.day || 1, row.start_time, row.end_time, row.room, row.track, row.speaker_ids, 0, row.capacity,
                 key, row.event_date, Number(row.sort_order || 0) + 5, row.location_note, row.kind, row.speaker_names_json, row.is_tbd || 0, row.show_counts || 0, now]);
            const made = rowOf(key, id);
            audit(req, 'program.session_duplicated', brief(made));
            touch(key);
            res.json({ session: one(made) });
        } catch (e) { fail(res, e, 'duplicate'); }
    });

    const flag = (column, action) => (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const row = rowOf(key, req.params.id); if (!row) return res.status(404).json({ error: 'That session is not here any more.' });
            const body = req.body || {};
            const value = body[column] === undefined ? (Number(row[column]) ? 0 : 1) : (body[column] ? 1 : 0);
            q.run(`UPDATE sessions SET ${column} = ?, updated_at = ? WHERE id = ?`, [value, core.nowIso(), row.id]);
            const after = rowOf(key, row.id);
            audit(req, action + (value ? '' : '_off'), brief(after));
            touch(key);
            res.json({ session: one(after) });
        } catch (e) { fail(res, e, action); }
    };
    app.put('/api/v2/program/:eventKey/sessions/:id/publish', auth, adminOnly, flag('is_published', 'program.session_published'));
    app.put('/api/v2/program/:eventKey/sessions/:id/tbd', auth, adminOnly, flag('is_tbd', 'program.session_tbd'));

    app.put('/api/v2/program/:eventKey/publish', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const value = (req.body && req.body.is_published === undefined) ? 1 : (req.body && req.body.is_published ? 1 : 0);
            const before = q.get('SELECT COUNT(*) AS n FROM sessions WHERE event_key = ? AND COALESCE(is_published, 0) <> ?', [key, value]);
            q.run('UPDATE sessions SET is_published = ?, updated_at = ? WHERE event_key = ? AND COALESCE(is_published, 0) <> ?', [value, core.nowIso(), key, value]);
            const changed = Number((before && before.n) || 0);
            audit(req, value ? 'program.event_published' : 'program.event_unpublished', `${key} · ${changed} rows`);
            touch(key);
            res.json(Object.assign({ ok: true, changed }, listing(key)));
        } catch (e) { fail(res, e, 'publish-all'); }
    });

    // ---- attendance ----
    function attendanceFor(key) {
        const sessions = core.loadSessions(q, key);
        let people = [];
        try { people = q.all('SELECT session_id, person_kind, person_ref, person_name, party, state, updated_at FROM v2_session_attendance WHERE event_key = ? ORDER BY updated_at DESC', [key]); } catch (e) { people = []; }
        const by = {}; people.forEach(p => { (by[p.session_id] = by[p.session_id] || []).push({ name: p.person_name || '(no name)', party: Number(p.party || 1), kind: p.person_kind, ref: p.person_ref, state: p.state, updated_at: p.updated_at }); });
        return sessions.map(s => ({ id: s.id, title: s.title, kind: s.kind, event_date: s.event_date, start_time: s.start_time, end_time: s.end_time, room: s.room, capacity: s.capacity, is_tbd: s.is_tbd, is_published: s.is_published, count: s.count, over: !!(s.capacity != null && s.count > s.capacity), people: (by[s.id] || []).filter(p => p.state === 'attending').concat((by[s.id] || []).filter(p => p.state !== 'attending')) }));
    }
    app.get('/api/v2/program/:eventKey/attendance', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            res.set('Cache-Control', 'private, no-store');
            res.json({ event_key: key, sessions: attendanceFor(key) });
        } catch (e) { fail(res, e, 'attendance'); }
    });
    app.get('/api/v2/program/:eventKey/attendance.csv', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const lines = [['Session', 'Date', 'Start', 'End', 'Room', 'Capacity', 'Attending', 'Name', 'Party', 'Kind', 'State', 'Updated'].join(',')];
            for (const s of attendanceFor(key)) {
                if (!s.people.length) lines.push([s.title, s.event_date, s.start_time, s.end_time, s.room, s.capacity == null ? '' : s.capacity, s.count, '', '', '', '', ''].map(core.csvCell).join(','));
                for (const p of s.people) lines.push([s.title, s.event_date, s.start_time, s.end_time, s.room, s.capacity == null ? '' : s.capacity, s.count, p.name, p.party, p.kind, p.state, p.updated_at].map(core.csvCell).join(','));
            }
            audit(req, 'program.attendance_exported', key);
            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', `attachment; filename="plexus-live-attendance-${key.replace(/[^a-z0-9]+/gi, '-')}.csv"`);
            res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
        } catch (e) { fail(res, e, 'attendance.csv'); }
    });

    // ---- insight ----
    app.get('/api/v2/program/:eventKey/insight', auth, adminOnly, (req, res) => {
        try {
            const key = keyOf(req); if (!key) return res.status(404).json({ error: 'No such event.' });
            const sessions = core.loadSessions(q, key);
            const reg = registeredFor(key);
            let opened = 0, scheduled = 0, total = 0;
            try { opened = Number((q.get('SELECT COUNT(*) AS n FROM v2_live_opens WHERE events_json LIKE ?', ['%"' + key + '"%']) || {}).n || 0); } catch (e) { opened = 0; }
            try { const r = q.get("SELECT COUNT(DISTINCT person_kind || ':' || person_ref) AS n, COALESCE(SUM(party), 0) AS s FROM v2_session_attendance WHERE event_key = ? AND state = 'attending'", [key]); scheduled = Number((r && r.n) || 0); total = Number((r && r.s) || 0); } catch (e) { scheduled = 0; }
            const top = sessions.filter(s => s.count > 0).sort((a, b) => b.count - a.count || String(a.start_time || '').localeCompare(String(b.start_time || ''))).slice(0, 5).map(s => ({ id: s.id, title: s.title, start_time: s.start_time, event_date: s.event_date, count: s.count, capacity: s.capacity }));
            // speakers on this program who have not opened their slots
            const bySpeaker = {};
            sessions.forEach(s => s.speakers.forEach(sp => { if (!sp.id) return; bySpeaker[sp.id] = bySpeaker[sp.id] || { id: sp.id, name: sp.name, sessions: 0 }; bySpeaker[sp.id].sessions++; }));
            let openedSpeakers = new Set();
            try { q.all("SELECT person_ref FROM v2_live_opens WHERE person_kind = 'speaker'").forEach(r => openedSpeakers.add(r.person_ref)); } catch (e) { openedSpeakers = new Set(); }
            const speakers_unopened = Object.values(bySpeaker).filter(s => !openedSpeakers.has(s.id));
            res.set('Cache-Control', 'private, no-store');
            res.json({ event_key: key, registered: reg.people, registered_seats: reg.seats, opened, scheduled, attending_total: total, sessions: sessions.length, published: sessions.filter(s => s.is_published).length, tbd: sessions.filter(s => s.is_tbd).length, top, speakers_unopened, speakers_total: Object.keys(bySpeaker).length });
        } catch (e) { fail(res, e, 'insight'); }
    });

    // ---- the speaker's live link (phase 2) ----
    // The event app lives on the MEMBER SPA host: MEMBER_PORTAL_URL when the redesign has its own origin,
    // else USER_PORTAL_URL (set on every deployed service; the staging launcher points it at the Netlify
    // member site). The token is HMAC(JWT_SECRET,'live:speaker:<id>') — both portals share the secret.
    const memberBase = () => String(process.env.MEMBER_PORTAL_URL || process.env.USER_PORTAL_URL || 'https://medx-user-portal.onrender.com').replace(/\/+$/, '');
    app.get('/api/live/speaker-link/:speakerId', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.speakerId || '').trim();
            if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return res.status(404).json({ error: 'No such speaker.' });
            const sp = q.get('SELECT id, name, email FROM speakers WHERE id = ?', [id]);
            if (!sp) return res.status(404).json({ error: 'No such speaker.' });
            const secret = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
            let sessions = [];
            try { sessions = q.all("SELECT id, event_key, event_date, start_time, end_time, title, room FROM sessions WHERE event_key IS NOT NULL AND (',' || COALESCE(speaker_ids, '') || ',') LIKE ? ORDER BY event_date, start_time", ['%,' + id + ',%']); } catch (e) { sessions = []; }
            res.set('Cache-Control', 'private, no-store');
            res.json({ speaker_id: sp.id, name: sp.name || '', email: sp.email || null, token: core.liveToken(secret, 'speaker', sp.id), url: core.liveUrl(memberBase(), secret, 'speaker', sp.id), sessions });
        } catch (e) { fail(res, e, 'speaker-link'); }
    });

    log('program-ops: the PROGRAM EDITOR API ready');
};
