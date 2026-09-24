/**
 * shared/live-program.js — the ONE core of the Plexus Week event app ("Plexus Week Live",
 * docs/EVENT-APP-BRIEF.md). Pure: every database call goes through the `q` helper the caller
 * passes ({ get, all, run }), so the member backend (user-portal/backend/v2/live.js — the public
 * program API + the seed) and the admin backend (admin-portal/backend/v2/program-ops.js — the
 * PROGRAM EDITOR) read and write the same rows the same way.
 *
 * Data (both portals share ONE database):
 *   sessions               the existing table, extended (guarded ALTERs — never dropped, never renamed):
 *                          event_key · event_date · sort_order · location_note · kind · speaker_names_json ·
 *                          is_tbd · show_counts · updated_at
 *   v2_session_attendance  one row per (session, person): party + state 'attending'|'declined'
 *   v2_live_opens          who opened the app (per person) — the admin insight's "opened" column
 *
 * Event keys: conference · donor · bridges (Zagreb) · gala · boston · meetup:<id>
 * Kinds: keynote · talk · panel · presentations · break · lunch · dinner · networking · reception · ceremony · other
 *        (legacy session_type is mapped to a kind on read; `kind` wins once written)
 *
 * Live tokens (no login): HMAC-SHA256(JWT_SECRET, 'live:<kind>:<id>')[:32] + '.' + kind + '.' + id,
 * kinds ca · gala · bridges (a bridges_registrations row, Boston included) · speaker · user.
 */
'use strict';

const crypto = require('crypto');

const EVENT_KINDS = ['conference', 'donor', 'bridges', 'gala', 'boston'];
const KINDS = ['keynote', 'talk', 'panel', 'presentations', 'break', 'lunch', 'dinner', 'networking', 'reception', 'ceremony', 'other'];
const PERSON_KINDS = ['ca', 'gala', 'bridges', 'speaker', 'user'];
const STATES = ['attending', 'declined'];
const SEED_MARKER = 'live_program_seed_v1';
const BOSTON_EVENT_ID = 'bb-boston-2026-09-21';   // user-portal/backend/boston.js EVENT_ID
const ZAGREB = 'Europe/Zagreb', BOSTON_TZ = 'America/New_York';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The facts we know without a database row (the brief, plexus-ticket.js LEG, boston.js header).
// Database rows (conferences · bridges_events · gala_settings · plexus_settings) override them.
const FACTS = {
    conference: { label: 'Plexus Conference', short: 'Conference', date: '2026-12-04', start: '17:00', end: '21:00', venue: 'Novinarski dom', address: 'Perkovčeva 2, Zagreb', city: 'Zagreb', tz: ZAGREB, kind: 'conference' },
    donor:      { label: 'Plexus Donor Night', short: 'Donor Night', date: '2026-12-04', start: '19:30', end: '22:30', venue: 'Esplanade Zagreb', address: 'Esplanade Zagreb, private salon', city: 'Zagreb', tz: ZAGREB, kind: 'donor', times_tbd: true },
    bridges:    { label: 'Building Bridges Zagreb', short: 'Bridges Zagreb', date: '2026-12-05', start: '11:00', end: '14:00', venue: 'To be announced', address: '', city: 'Zagreb', tz: ZAGREB, kind: 'bridges', tentative: true },
    gala:       { label: 'Gala Evening', short: 'Gala', date: '2026-12-05', start: '19:00', end: '23:59', venue: 'Hotel Esplanade', address: 'Mihanovićeva 1, Zagreb', city: 'Zagreb', tz: ZAGREB, kind: 'gala' },
    boston:     { label: 'Building Bridges — Boston', short: 'Boston', date: '2026-09-21', start: '17:30', end: '21:00', venue: 'Waterhouse Room, Gordon Hall', address: '25 Shattuck Street, Harvard Medical School, Boston, MA', city: 'Boston', tz: BOSTON_TZ, kind: 'bridges' }
};

// ---------------------------------------------------------------- small helpers
const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(String(s) + 'T00:00:00Z').getTime());
const isHm = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const hm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim()); if (!m) return null; const h = Number(m[1]), mi = Number(m[2]); if (h > 23 || mi > 59) return null; return String(h).padStart(2, '0') + ':' + m[2]; };
const minutes = t => { const x = hm(t); return x ? Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) : null; };
const fromMinutes = n => { const m = ((Math.round(n) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const cleanStr = (v, max) => (v === undefined ? undefined : String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
const nowIso = () => new Date().toISOString();
const isEventKey = k => EVENT_KINDS.includes(String(k || '')) || /^meetup:[A-Za-z0-9_.-]{1,80}$/.test(String(k || ''));
const dayLabel = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return ''; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return DOW[d.getUTCDay()] + ' ' + Number(m[3]) + ' ' + MON[Number(m[2]) - 1]; };
const shortDay = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] : ''; };
// An event over more days names every day: 'Fri 4 – Sat 5 Dec' / '4–5 Dec' ('Mon 30 Nov – Tue 1 Dec' across a month);
// one day stays 'Friday 4 Dec' / '4 Dec'.
function spanLabels(from, to) {
    if (!isYmd(to) || !isYmd(from) || String(to) <= String(from)) return { label: dayLabel(from), short: shortDay(from) };
    const [aw, ad, am] = dayLabel(from).split(' '), [bw, bd, bm] = dayLabel(to).split(' ');
    return am === bm
        ? { label: `${aw.slice(0, 3)} ${ad} – ${bw.slice(0, 3)} ${bd} ${bm}`, short: `${ad}–${bd} ${bm}` }
        : { label: `${aw.slice(0, 3)} ${ad} ${am} – ${bw.slice(0, 3)} ${bd} ${bm}`, short: `${ad} ${am} – ${bd} ${bm}` };
}
// 'Hotel Esplanade Emerald Ballroom; Zagreb, Croatia' → 'Hotel Esplanade Emerald Ballroom': the app prints the
// address on its own line, so a venue string's trailing '; <city>, <country>' only repeats it.
const venueOnly = (v, city) => String(v || '').split(/\s*;\s*/).filter((p, i) => p && (i === 0 || !city || !p.toLowerCase().includes(String(city).toLowerCase()))).join(' · ');
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// The UTC offset of a zone at a given wall-clock instant, as '+01:00' — Intl only, no library.
function zoneOffset(tz, ymd, hhmm) {
    try {
        const [y, mo, d] = ymd.split('-').map(Number); const [h, mi] = (hhmm || '12:00').split(':').map(Number);
        const guess = Date.UTC(y, mo - 1, d, h, mi);
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
        const get = t => Number((parts.find(p => p.type === t) || {}).value);
        const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
        const offMin = Math.round((asUtc - guess) / 60000);
        const sign = offMin < 0 ? '-' : '+', a = Math.abs(offMin);
        return sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
    } catch (e) { return '+00:00'; }
}
// '2026-12-04' + '17:00' in Europe/Zagreb → '2026-12-04T17:00:00+01:00' (null when either part is missing)
function zonedIso(ymd, hhmm, tz) {
    if (!isYmd(ymd) || !hm(hhmm)) return null;
    return ymd + 'T' + hm(hhmm) + ':00' + zoneOffset(tz || ZAGREB, ymd, hm(hhmm));
}
// today's date (YYYY-MM-DD) and wall time (HH:MM) in a zone
function localNow(tz, now) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || ZAGREB, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now || new Date());
        const get = t => (parts.find(p => p.type === t) || {}).value;
        return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
    } catch (e) { const d = (now || new Date()).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; }
}

// ---------------------------------------------------------------- tokens
const liveSig = (secret, kind, id) => crypto.createHmac('sha256', String(secret)).update(`live:${kind}:${id}`).digest('hex').slice(0, 32);
const liveToken = (secret, kind, id) => `${liveSig(secret, kind, id)}.${kind}.${id}`;
const liveUrl = (base, secret, kind, id) => `${String(base || '').replace(/\/+$/, '')}/live/${liveToken(secret, kind, id)}`;
/** 'sig.kind.id' → { kind, id } or null (constant-time compare; 'user' has no signature — it is the Bearer session) */
function verifyLiveToken(secret, token) {
    const s = String(token || '');
    if (s === 'user') return { kind: 'user', id: null };
    const m = /^([0-9a-f]{32})\.(ca|gala|bridges|speaker)\.([A-Za-z0-9_-]{1,80})$/.exec(s);
    if (!m) return null;
    const expect = liveSig(secret, m[2], m[3]);
    try { if (!crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expect))) return null; } catch (e) { return null; }
    return { kind: m[2], id: m[3] };
}

// ---------------------------------------------------------------- schema (guarded; identical in both portals)
function ensureSchema(q, log) {
    const note = (...a) => { try { log && log(...a); } catch (e) { /* quiet */ } };
    for (const sql of [
        'ALTER TABLE sessions ADD COLUMN event_key TEXT',
        'ALTER TABLE sessions ADD COLUMN event_date TEXT',
        'ALTER TABLE sessions ADD COLUMN sort_order INTEGER DEFAULT 0',
        'ALTER TABLE sessions ADD COLUMN location_note TEXT',
        'ALTER TABLE sessions ADD COLUMN kind TEXT',
        'ALTER TABLE sessions ADD COLUMN speaker_names_json TEXT',
        'ALTER TABLE sessions ADD COLUMN is_tbd INTEGER DEFAULT 0',
        'ALTER TABLE sessions ADD COLUMN show_counts INTEGER DEFAULT 0',
        'ALTER TABLE sessions ADD COLUMN updated_at TEXT'
    ]) { try { q.run(sql); } catch (e) { /* column exists */ } }
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_session_attendance (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            event_key TEXT NOT NULL,
            person_kind TEXT NOT NULL,
            person_ref TEXT NOT NULL,
            person_name TEXT,
            party INTEGER NOT NULL DEFAULT 1,
            state TEXT NOT NULL DEFAULT 'attending',
            created_at TEXT NOT NULL,
            updated_at TEXT,
            UNIQUE(session_id, person_kind, person_ref)
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_session_attendance_event ON v2_session_attendance (event_key, session_id, state)');
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_session_attendance_person ON v2_session_attendance (person_kind, person_ref)');
        q.run(`CREATE TABLE IF NOT EXISTS v2_live_opens (
            id TEXT PRIMARY KEY,
            person_kind TEXT NOT NULL,
            person_ref TEXT NOT NULL,
            person_name TEXT,
            events_json TEXT,
            first_open_at TEXT NOT NULL,
            last_open_at TEXT NOT NULL,
            opens INTEGER NOT NULL DEFAULT 1,
            UNIQUE(person_kind, person_ref)
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions (event_key, event_date, sort_order)');
    } catch (e) { note('live-program schema failed:', e.message); }
    // One-time repair (2026-09-22): the first seed stamped conference_id on the Conference rows, which
    // made the legacy public program (/api/plexus/sessions → the v1 member Program page) list the TBD
    // placeholders. Event-app rows are keyed by event_key only — detach them once, marker-guarded.
    try {
        q.run('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
        if (!q.get('SELECT key FROM app_state WHERE key = ?', ['live_program_detach_v1'])) {
            q.run('UPDATE sessions SET conference_id = NULL WHERE event_key IS NOT NULL AND conference_id IS NOT NULL');
            q.run('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)', ['live_program_detach_v1', nowIso(), nowIso()]);
        }
    } catch (e) { note('live-program detach repair skipped:', e.message); }
}
const hasTable = (q, name) => { try { return !!q.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]); } catch (e) { return false; } };
const hasColumn = (q, table, col) => { try { return q.all(`PRAGMA table_info(${table})`).some(c => c.name === col); } catch (e) { return false; } };

// ---------------------------------------------------------------- kinds & speakers
const LEGACY_KIND = { talk: 'talk', keynote: 'keynote', panel: 'panel', workshop: 'other', break: 'break', lunch: 'lunch', dinner: 'dinner', networking: 'networking', reception: 'reception', ceremony: 'ceremony', poster: 'presentations', presentations: 'presentations', other: 'other' };
function normalizeKind(kind, sessionType) {
    const k = String(kind || '').toLowerCase().trim();
    if (KINDS.includes(k)) return k;
    return LEGACY_KIND[String(sessionType || '').toLowerCase().trim()] || 'other';
}
const guessKindFromTitle = t => { const s = String(t || '').toLowerCase(); if (/award/.test(s)) return 'ceremony'; if (/keynote|address/.test(s)) return 'keynote'; if (/reception|aperitif|cocktail|drinks|doors/.test(s)) return 'reception'; if (/dinner|supper/.test(s)) return 'dinner'; if (/lunch/.test(s)) return 'lunch'; if (/break|coffee/.test(s)) return 'break'; if (/network|entertain|music|closing/.test(s)) return 'networking'; if (/panel/.test(s)) return 'panel'; if (/talks|presentation|block/.test(s)) return 'presentations'; if (/welcome|opening/.test(s)) return 'ceremony'; return 'other'; };
const parseIds = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
// speaker_names_json: ['Name'] | [{ name, institution?, topic? }] | 'a, b' → [{ name, institution, topic }]
function parseNames(v) {
    if (v == null || v === '') return [];
    let arr = v;
    if (typeof v === 'string') { try { arr = JSON.parse(v); } catch (e) { arr = v.split(/[\n;,]+/); } }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const it of arr.slice(0, 60)) {
        const o = it && typeof it === 'object' ? it : { name: it };
        const name = cleanStr(o.name, 120); if (!name) continue;
        out.push({ name, institution: cleanStr(o.institution, 160) || null, topic: cleanStr(o.topic, 200) || null });
    }
    return out;
}
/** id → { id, name, title, institution, photo_url, logo_url } over speakers (+ v2_speaker_meta when present) */
function speakerDirectory(q, ids) {
    const map = {};
    try {
        const meta = hasTable(q, 'v2_speaker_meta');
        const want = Array.isArray(ids) ? ids.filter(Boolean) : null;
        const rows = want && !want.length ? [] : q.all(`SELECT s.id, s.name, s.title, s.institution, s.photo_url, s.is_keynote${meta ? ', m.institution_logo_url AS logo_url' : ''}
            FROM speakers s${meta ? ' LEFT JOIN v2_speaker_meta m ON m.speaker_id = s.id' : ''}${want ? ` WHERE s.id IN (${want.map(() => '?').join(',')})` : ''}`, want || []);
        for (const r of rows) map[r.id] = { id: r.id, name: r.name || '', title: r.title || '', institution: r.institution || '', photo_url: r.photo_url || null, logo_url: r.logo_url || null, is_keynote: !!Number(r.is_keynote) };
    } catch (e) { /* speakers table absent on a bare DB */ }
    return map;
}

// ---------------------------------------------------------------- sessions
function rowToSession(r, dir, opts = {}) {
    const ev = FACTS[r.event_key] || {};
    const tz = opts.tz || ev.tz || ZAGREB;
    const ids = parseIds(r.speaker_ids);
    const speakers = ids.map(id => (dir && dir[id]) || { id, name: '', title: '', institution: '', photo_url: null, logo_url: null });
    const startsAt = zonedIso(r.event_date, r.start_time, tz), endsAt = zonedIso(r.event_date, r.end_time, tz);
    return {
        id: r.id, event_key: r.event_key, event_date: r.event_date || null, day_label: dayLabel(r.event_date),
        start_time: hm(r.start_time), end_time: hm(r.end_time), starts_at: startsAt, ends_at: endsAt, tz,
        title: r.title || '', kind: normalizeKind(r.kind, r.session_type), description: r.description || '',
        room: r.room || '', location_note: r.location_note || '', track: r.track || '',
        capacity: r.capacity == null || r.capacity === '' ? null : Number(r.capacity),
        speaker_ids: ids, speakers, speaker_names: parseNames(r.speaker_names_json),
        is_tbd: !!Number(r.is_tbd), show_counts: !!Number(r.show_counts), is_published: !!Number(r.is_published),
        sort_order: Number(r.sort_order || 0), updated_at: r.updated_at || null
    };
}
const ORDER = 'ORDER BY COALESCE(event_date, \'\') ASC, COALESCE(start_time, \'99:99\') ASC, sort_order ASC, rowid ASC';
function loadSessionRows(q, eventKey, { publishedOnly = false } = {}) {
    try { return q.all(`SELECT * FROM sessions WHERE event_key = ?${publishedOnly ? ' AND COALESCE(is_published, 0) = 1' : ''} ${ORDER}`, [eventKey]); }
    catch (e) { return []; }
}
// A meetup is ONE networking slot in the guest app: when no session rows exist for 'meetup:<id>', the
// meetup row itself becomes a read-only session (the place is held on the meetup page, not by a tap here).
function meetupSession(q, eventKey) {
    const id = String(eventKey || '').replace(/^meetup:/, '');
    if (!id || !hasTable(q, 'plexus_meetups')) return null;
    let r = null; try { r = q.get("SELECT * FROM plexus_meetups WHERE id = ? AND status IN ('published', 'completed')", [id]); } catch (e) { r = null; }
    if (!r) return null;
    const d = String(r.starts_at || '').slice(0, 10); if (!isYmd(d)) return null;
    const start = hm(String(r.starts_at || '').slice(11, 16)), end = hm(String(r.ends_at || '').slice(11, 16));
    return {
        id: 'meetup:' + r.id, event_key: 'meetup:' + r.id, event_date: d, day_label: dayLabel(d),
        start_time: start, end_time: end, starts_at: zonedIso(d, start, ZAGREB), ends_at: zonedIso(d, end, ZAGREB), tz: ZAGREB,
        title: String(r.title || 'Meetup').trim(), kind: 'networking', description: r.description || '',
        room: r.venue_name || '', location_note: r.venue_address || '', track: '',
        capacity: r.capacity == null || r.capacity === '' ? null : Number(r.capacity),
        speaker_ids: [], speakers: [], speaker_names: r.host_name ? [{ name: String(r.host_name), topic: 'Host', institution: r.host_title || '' }] : [],
        is_tbd: false, show_counts: false, is_published: true, sort_order: 0, updated_at: r.updated_at || null, synthetic: 'meetup', count: 0
    };
}
function loadSessions(q, eventKey, opts = {}) {
    const rows = loadSessionRows(q, eventKey, opts);
    if (!rows.length && /^meetup:/.test(String(eventKey || ''))) { const m = meetupSession(q, eventKey); return m ? [m] : []; }
    const dir = speakerDirectory(q, [].concat(...rows.map(r => parseIds(r.speaker_ids))));
    const counts = opts.withCounts === false ? {} : attendanceCounts(q, eventKey);
    return rows.map(r => Object.assign(rowToSession(r, dir, opts), { count: counts[r.id] || 0 }));
}
function groupByDay(sessions) {
    const days = new Map();
    for (const s of sessions) { const k = s.event_date || 'tbd'; if (!days.has(k)) days.set(k, { date: s.event_date || null, label: s.event_date ? dayLabel(s.event_date) : 'Date to be confirmed', short: s.event_date ? shortDay(s.event_date) : 'TBD', sessions: [] }); days.get(k).sessions.push(s); }
    return Array.from(days.values());
}
/** overlapping sessions in the same room (case-insensitive; blank rooms never conflict) → [{ a, b }] */
function roomConflicts(sessions) {
    const out = [];
    const list = sessions.filter(s => s.room && s.event_date && s.start_time && s.end_time && s.kind !== 'break');
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.event_date !== b.event_date || a.room.trim().toLowerCase() !== b.room.trim().toLowerCase()) continue;
        if (minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time)) out.push({ a: a.id, b: b.id });
    }
    return out;
}
/** two sessions a person tapped that overlap in time (any room) → Set of ids */
function scheduleConflicts(sessions) {
    const ids = new Set();
    const list = sessions.filter(s => s.event_date && s.start_time && s.end_time);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.event_date !== b.event_date) continue;
        if (minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time)) { ids.add(a.id); ids.add(b.id); }
    }
    return ids;
}
// The program's version stamp = the newest sessions.updated_at OR the last admin touch (deletes and
// reorders leave no row to stamp, so every admin write also touches app_state 'live_program_touch:<event>').
const TOUCH_KEY = k => 'live_program_touch:' + k;
function touchEvent(q, eventKey) {
    try {
        const now = nowIso();
        if (q.get('SELECT key FROM app_state WHERE key = ?', [TOUCH_KEY(eventKey)])) q.run('UPDATE app_state SET value = ?, updated_at = ? WHERE key = ?', [now, now, TOUCH_KEY(eventKey)]);
        else q.run('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)', [TOUCH_KEY(eventKey), now, now]);
        return now;
    } catch (e) { return null; }
}
function lastUpdated(q, eventKey) {
    let u = null, n = 0;
    try { const r = q.get('SELECT MAX(updated_at) AS u, COUNT(*) AS n FROM sessions WHERE event_key = ?', [eventKey]); u = (r && r.u) || null; n = Number((r && r.n) || 0); } catch (e) { /* absent */ }
    try { const t = q.get('SELECT value FROM app_state WHERE key = ?', [TOUCH_KEY(eventKey)]); if (t && t.value && (!u || String(t.value) > String(u))) u = String(t.value); } catch (e) { /* absent */ }
    return { updated_at: u, n };
}

// ---------------------------------------------------------------- attendance
function attendanceCounts(q, eventKey) {
    const out = {};
    try { q.all("SELECT session_id, SUM(party) AS n FROM v2_session_attendance WHERE event_key = ? AND state = 'attending' GROUP BY session_id", [eventKey]).forEach(r => { out[r.session_id] = Number(r.n || 0); }); } catch (e) { /* fresh DB */ }
    return out;
}
function attendanceOf(q, personKind, personRef) {
    const out = {};
    try { q.all('SELECT session_id, state FROM v2_session_attendance WHERE person_kind = ? AND person_ref = ?', [personKind, personRef]).forEach(r => { out[r.session_id] = r.state; }); } catch (e) { /* fresh DB */ }
    return out;
}
/** upsert; declined keeps the row (state 'declined') so the count drops and the person's choice is remembered */
function setAttendance(q, { sessionId, eventKey, personKind, personRef, personName, party, state }) {
    const now = nowIso();
    const prev = q.get('SELECT id FROM v2_session_attendance WHERE session_id = ? AND person_kind = ? AND person_ref = ?', [sessionId, personKind, personRef]);
    if (prev) q.run('UPDATE v2_session_attendance SET state = ?, party = ?, person_name = ?, event_key = ?, updated_at = ? WHERE id = ?', [state, party, personName || null, eventKey, now, prev.id]);
    else q.run('INSERT INTO v2_session_attendance (id, session_id, event_key, person_kind, person_ref, person_name, party, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [uuid(), sessionId, eventKey, personKind, personRef, personName || null, party, state, now, now]);
    const c = q.get("SELECT COALESCE(SUM(party), 0) AS n FROM v2_session_attendance WHERE session_id = ? AND state = 'attending'", [sessionId]);
    return Number((c && c.n) || 0);
}
function recordOpen(q, { personKind, personRef, personName, events }) {
    try {
        const now = nowIso();
        const prev = q.get('SELECT id FROM v2_live_opens WHERE person_kind = ? AND person_ref = ?', [personKind, personRef]);
        if (prev) q.run('UPDATE v2_live_opens SET last_open_at = ?, opens = opens + 1, person_name = COALESCE(?, person_name), events_json = ? WHERE id = ?', [now, personName || null, JSON.stringify(events || []), prev.id]);
        else q.run('INSERT INTO v2_live_opens (id, person_kind, person_ref, person_name, events_json, first_open_at, last_open_at, opens) VALUES (?,?,?,?,?,?,?,1)', [uuid(), personKind, personRef, personName || null, JSON.stringify(events || []), now, now]);
    } catch (e) { /* best-effort */ }
}

// ---------------------------------------------------------------- the event catalogue
function plexusSettings(q) { try { return q.get("SELECT * FROM plexus_settings WHERE id = 'default'") || {}; } catch (e) { return {}; } }
/**
 * Every event the app can show, with dates/times/venues from the tables (falling back to FACTS),
 * the session window when sessions exist, and is_today / is_live / is_past computed in the
 * event's own zone (`today` may be the phone's date). Sorted: today's first, then upcoming
 * soonest-first, then past most-recent-first.
 */
function eventCatalogue(q, { today, now } = {}) {
    const at = now || new Date();
    const list = [];
    const st = plexusSettings(q);
    const push = (key, base, over) => {
        const e = Object.assign({ key }, base, over || {});
        list.push(e);
        return e;
    };
    // conference — the active conferences row (dates), plexus_settings.conference_venue / _start_date
    try {
        const c = q.get('SELECT * FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1') || q.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
        const date = isYmd(st.conference_start_date) ? String(st.conference_start_date).slice(0, 10) : (c && isYmd(String(c.start_date || '').slice(0, 10)) ? String(c.start_date).slice(0, 10) : FACTS.conference.date);
        // two days (4–5 December): the conferences row carries the end date; the event stays "today" on both days
        const endRaw = c && isYmd(String(c.end_date || '').slice(0, 10)) ? String(c.end_date).slice(0, 10) : null;
        const end_date = endRaw && endRaw >= date ? endRaw : date;
        push('conference', FACTS.conference, { date, end_date, venue: cleanStr(st.conference_venue, 160) || FACTS.conference.venue, title: (c && c.name) || 'Plexus Conference 2026', conference_id: c ? c.id : null });
    } catch (e) { push('conference', FACTS.conference, {}); }
    // donor night — bridges_events slug donor-night
    try {
        const r = q.get("SELECT * FROM bridges_events WHERE slug = 'donor-night' AND COALESCE(status, '') <> 'cancelled'");
        const d = r && isYmd(String(r.event_date || '').slice(0, 10)) ? String(r.event_date).slice(0, 10) : FACTS.donor.date;
        push('donor', FACTS.donor, { date: d, end_date: d, start: (r && hm(r.event_time)) || FACTS.donor.start, end: (r && hm(r.end_time)) || FACTS.donor.end, venue: (r && r.venue_name) || FACTS.donor.venue, address: (r && r.venue_address) || FACTS.donor.address, source_id: r ? r.id : null });
    } catch (e) { push('donor', FACTS.donor, {}); }
    // bridges zagreb — plexus_settings.bridges_zagreb_* (confirmed) else bridges_events slug building-bridges else tentative facts
    try {
        const r = q.get("SELECT * FROM bridges_events WHERE slug = 'building-bridges' AND COALESCE(status, '') <> 'cancelled'");
        const confirmed = isYmd(st.bridges_zagreb_date);
        const d = confirmed ? String(st.bridges_zagreb_date).slice(0, 10) : (r && isYmd(String(r.event_date || '').slice(0, 10)) ? String(r.event_date).slice(0, 10) : FACTS.bridges.date);
        const start = confirmed && hm(st.bridges_zagreb_time) ? hm(st.bridges_zagreb_time) : FACTS.bridges.start;
        const end = confirmed && hm(st.bridges_zagreb_time) ? fromMinutes(minutes(start) + 180) : FACTS.bridges.end;
        const venue = cleanStr(st.bridges_zagreb_venue, 160) || (r && r.venue_name && !/to be announced/i.test(r.venue_name) ? r.venue_name : FACTS.bridges.venue);
        push('bridges', FACTS.bridges, { date: d, end_date: d, start, end, venue, address: (r && r.venue_address) || '', tentative: !confirmed && !(r && isYmd(String(r.event_date || '').slice(0, 10))), source_id: r ? r.id : null });
    } catch (e) { push('bridges', FACTS.bridges, {}); }
    // gala — gala_settings
    try {
        const g = q.get("SELECT * FROM gala_settings WHERE id = 'default'");
        const d = g && isYmd(String(g.date || '').slice(0, 10)) ? String(g.date).slice(0, 10) : FACTS.gala.date;
        push('gala', FACTS.gala, { date: d, end_date: d, start: (g && hm(g.time)) || FACTS.gala.start, venue: (g && g.venue) || FACTS.gala.venue, title: (g && g.title) || 'Gala Evening 2026', dress_code: (g && g.dress_code) || 'Black tie' });
    } catch (e) { push('gala', FACTS.gala, {}); }
    // boston — the fixed bridges_events row (boston.js) when present, else the facts
    try {
        const r = q.get("SELECT * FROM bridges_events WHERE id = ? OR slug = 'boston'", [BOSTON_EVENT_ID]);
        const d = r && isYmd(String(r.event_date || '').slice(0, 10)) ? String(r.event_date).slice(0, 10) : FACTS.boston.date;
        push('boston', FACTS.boston, { date: d, end_date: d, end: (r && hm(r.end_time)) || FACTS.boston.end, venue: (r && r.venue_name) || FACTS.boston.venue, address: (r && r.venue_address) || FACTS.boston.address, source_id: r ? r.id : BOSTON_EVENT_ID });
    } catch (e) { push('boston', FACTS.boston, {}); }
    // meetups
    if (hasTable(q, 'plexus_meetups')) {
        try {
            q.all("SELECT id, title, kind, venue_name, venue_address, starts_at, ends_at, status FROM plexus_meetups WHERE status IN ('published', 'completed') ORDER BY starts_at").forEach(r => {
                const d = String(r.starts_at || '').slice(0, 10); if (!isYmd(d)) return;
                push('meetup:' + r.id, { label: String(r.title || 'Meetup').trim(), short: String(r.title || 'Meetup').trim(), kind: 'meetup', tz: ZAGREB, city: '' },
                    { date: d, end_date: String(r.ends_at || '').slice(0, 10) || d, start: hm(String(r.starts_at || '').slice(11, 16)) || '18:00', end: hm(String(r.ends_at || '').slice(11, 16)) || null, venue: r.venue_name || '', address: r.venue_address || '', source_id: r.id });
            });
        } catch (e) { /* absent */ }
    }
    // session windows + counts per event
    let stats = {};
    try { q.all("SELECT event_key, COUNT(*) AS n, SUM(COALESCE(is_published, 0)) AS p, SUM(COALESCE(is_tbd, 0)) AS t, MIN(CASE WHEN COALESCE(is_published,0)=1 THEN start_time END) AS s0, MAX(CASE WHEN COALESCE(is_published,0)=1 THEN end_time END) AS e0, MAX(updated_at) AS u FROM sessions WHERE event_key IS NOT NULL GROUP BY event_key").forEach(r => { stats[r.event_key] = r; }); } catch (e) { stats = {}; }
    for (const e of list) {
        const s = stats[e.key] || {};
        e.session_count = Number(s.n || 0); e.published_count = Number(s.p || 0); e.tbd_count = Number(s.t || 0); e.program_updated_at = s.u || null;
        const start = (e.session_count && hm(s.s0)) || e.start || null, end = (e.session_count && hm(s.e0)) || e.end || null;
        e.start = start; e.end = end;
        e.starts_at = zonedIso(e.date, start, e.tz); e.ends_at = zonedIso(e.end_date || e.date, end, e.tz);
        const local = localNow(e.tz, at);
        const td = isYmd(today) ? today : local.date;
        e.today = td;
        e.is_today = !!(e.date && e.date <= td && td <= (e.end_date || e.date));
        // live = the server's clock, in the event's zone, sits inside the session window right now
        e.is_live = !!(e.date && start && end && local.date >= e.date && local.date <= (e.end_date || e.date) && local.time >= start && local.time <= end);
        e.is_past = !!(e.date && (e.end_date || e.date) < td);
        e.is_upcoming = !!(e.date && e.date > td);
        e.times_tbd = !!e.times_tbd; e.tentative = !!e.tentative;
        const span = spanLabels(e.date, e.end_date);
        e.date_label = span.label; e.short_date = span.short;
        e.venue = venueOnly(e.venue, e.city) || e.venue;
    }
    list.sort((x, y) => {
        const gx = x.is_today ? 0 : x.is_upcoming ? 1 : 2, gy = y.is_today ? 0 : y.is_upcoming ? 1 : 2;
        if (gx !== gy) return gx - gy;
        const k = (x.date || '').localeCompare(y.date || '') || (x.start || '').localeCompare(y.start || '');
        return gx === 2 ? -k : k;
    });
    return list;
}
const eventByKey = (q, key, opts) => eventCatalogue(q, opts).find(e => e.key === key) || null;

// ---------------------------------------------------------------- .ics
function icsForSessions(sessions, event, opts = {}) {
    const stamp = nowIso().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const escIcs = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const compact = (ymd, t) => String(ymd).replace(/-/g, '') + 'T' + String(t).replace(':', '') + '00';
    const tz = (event && event.tz) || ZAGREB;
    const vt = tz === BOSTON_TZ ? [
        'BEGIN:VTIMEZONE', 'TZID:America/New_York',
        'BEGIN:STANDARD', 'DTSTART:19701101T020000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'TZNAME:EST', 'END:STANDARD',
        'BEGIN:DAYLIGHT', 'DTSTART:19700308T020000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'TZNAME:EDT', 'END:DAYLIGHT', 'END:VTIMEZONE'
    ] : [
        'BEGIN:VTIMEZONE', 'TZID:Europe/Zagreb',
        'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZNAME:CET', 'END:STANDARD',
        'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZNAME:CEST', 'END:DAYLIGHT', 'END:VTIMEZONE'
    ];
    const where = s => [s.room, s.location_note, event && event.venue, event && event.address].filter(Boolean).join(', ');
    const events = sessions.filter(s => s.event_date && s.start_time && s.end_time).map(s => [
        'BEGIN:VEVENT',
        `UID:medx-live-${s.id}@medx.hr`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${tz}:${compact(s.event_date, s.start_time)}`,
        `DTEND;TZID=${tz}:${compact(s.event_date, s.end_time)}`,
        `SUMMARY:${escIcs(((event && event.label) ? event.label + ' — ' : '') + (s.is_tbd ? (s.title || 'Session') + ' (TBD)' : (s.title || 'Session')))}`,
        `LOCATION:${escIcs(where(s))}`,
        `DESCRIPTION:${escIcs([s.speakers && s.speakers.length ? 'With ' + s.speakers.map(x => x.name).filter(Boolean).join(', ') : '', s.speaker_names && s.speaker_names.length ? s.speaker_names.map(x => x.name).join(', ') : '', s.description || '', opts.url || ''].filter(Boolean).join('\n'))}`,
        s.is_tbd ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED',
        'END:VEVENT'
    ].join('\r\n'));
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Med&X//Plexus Week Live//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...vt, ...events, 'END:VCALENDAR'].join('\r\n');
}

// ---------------------------------------------------------------- input → row
function cleanSessionInput(body, existing) {
    const b = body || {};
    const out = {};
    const has = k => Object.prototype.hasOwnProperty.call(b, k);
    if (has('title')) out.title = cleanStr(b.title, 200) || '';
    if (has('description')) out.description = cleanStr(b.description, 4000) || null;
    if (has('kind')) { const k = String(b.kind || '').toLowerCase().trim(); if (k && !KINDS.includes(k)) return { error: 'That kind is not one of ours.' }; out.kind = k || 'other'; }
    if (has('event_date')) { const d = String(b.event_date || '').slice(0, 10); if (d && !isYmd(d)) return { error: 'The date must be YYYY-MM-DD.' }; out.event_date = d || null; }
    if (has('start_time')) { const t = b.start_time == null || b.start_time === '' ? null : hm(b.start_time); if (b.start_time && !t) return { error: 'The start time must be HH:MM.' }; out.start_time = t; }
    if (has('end_time')) { const t = b.end_time == null || b.end_time === '' ? null : hm(b.end_time); if (b.end_time && !t) return { error: 'The end time must be HH:MM.' }; out.end_time = t; }
    if (has('room')) out.room = cleanStr(b.room, 120) || null;
    if (has('location_note')) out.location_note = cleanStr(b.location_note, 240) || null;
    if (has('track')) out.track = cleanStr(b.track, 120) || null;
    if (has('capacity')) { if (b.capacity === null || b.capacity === '') out.capacity = null; else { const n = Number(b.capacity); if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: 'Capacity must be a whole number.' }; out.capacity = n; } }
    if (has('speaker_ids')) out.speaker_ids = (Array.isArray(b.speaker_ids) ? b.speaker_ids : String(b.speaker_ids || '').split(',')).map(s => String(s || '').trim()).filter(s => /^[A-Za-z0-9_-]{1,80}$/.test(s)).slice(0, 40).join(',') || null;
    if (has('speaker_names')) { const n = parseNames(b.speaker_names); out.speaker_names_json = n.length ? JSON.stringify(n) : null; }
    if (has('is_tbd')) out.is_tbd = b.is_tbd ? 1 : 0;
    if (has('show_counts')) out.show_counts = b.show_counts ? 1 : 0;
    if (has('is_published')) out.is_published = b.is_published ? 1 : 0;
    if (has('sort_order')) { const n = Number(b.sort_order); out.sort_order = Number.isFinite(n) ? Math.round(n) : 0; }
    const merged = Object.assign({}, existing || {}, out);
    if (merged.start_time && merged.end_time && minutes(merged.end_time) < minutes(merged.start_time)) return { error: 'The session ends before it starts.' };
    return { values: out };
}

// ---------------------------------------------------------------- the seed (member boot; idempotent by marker)
const BOSTON_BLOCK1 = [
    { name: 'Prof. Manolis Kellis', institution: 'MIT · Broad Institute', topic: 'AI for genomic medicine' },
    { name: 'Dr. Nimrat Chatterjee', institution: 'University of Vermont Cancer Center', topic: 'DNA repair & therapy resistance' },
    { name: 'Prof. Siniša Hrvatin', institution: 'Whitehead Institute · MIT', topic: 'Biology of torpor & hibernation' },
    { name: 'Dr. Ana Jaklenec', institution: 'MIT · Koch Institute', topic: 'Single-injection vaccines' },
    { name: 'Prof. Craig Blackstone', institution: 'Mass General Brigham Neuroscience Institute', topic: 'Movement disorders, neurogenetics' },
    { name: 'Prof. Mladen-Roko Rašin', institution: 'Rutgers · RWJ Medical School', topic: 'Brain development, RNA-binding proteins' },
    { name: 'Dr. Yi-Hsiang (Sean) Hsu', institution: 'Harvard Medical School · Hebrew SeniorLife', topic: 'Genetics of aging' },
    { name: 'Dr. Matija Zelić', institution: 'Sanofi', topic: 'Neuroinflammation in MS (RIPK1, microglia)' }
];
const BOSTON_PANEL = [
    { name: 'Dr. Katarina Ruscic', institution: 'Massachusetts General Hospital · Harvard Medical School', topic: 'Senior Division Director, Multispecialty Anesthesia' },
    { name: 'Prof. Guido Musch', institution: 'UMass Chan Medical School', topic: 'Executive Vice-Chair of Anesthesiology, research lead' },
    { name: 'prim. dr. Gzim Redžepi', institution: 'Hospital Primamed, Zagreb', topic: 'Director · pulmonologist' },
    { name: 'Dr. J. Michael Gaziano', institution: "Brigham and Women's · VA Boston", topic: 'Chief, Division of Aging · PI, Million Veteran Program' }
];
const BOSTON_BLOCK2 = [
    { name: 'Prof. Chenchen Wang', institution: 'Tufts Medical Center · Tufts University', topic: 'Integrative medicine trials (Tai Chi)' },
    { name: 'Dr. Theodore Zwang', institution: 'Massachusetts General Hospital', topic: "Alzheimer's biosensing, neural electronics" },
    { name: 'Dr. Ulf Dettmer', institution: "Brigham and Women's Hospital", topic: "Parkinson's, alpha-synuclein" },
    { name: 'Prof. Tianmin Fu', institution: 'UMass Chan Medical School', topic: 'Cryo-EM structural immunology' },
    { name: 'Dr. Vesela Kovacheva', institution: "Brigham and Women's Hospital", topic: 'AI & genetics in obstetric anesthesia' },
    { name: 'Dr. Ksenia Kastanenka', institution: 'Massachusetts General Hospital', topic: "Sleep oscillations & Alzheimer's" },
    { name: 'prim. dr. Gzim Redžepi', institution: 'Hospital Primamed, Zagreb', topic: 'Primamed — a new hospital in Zagreb' },
    { name: 'Dr. John Pezaris', institution: 'Massachusetts General Hospital · Neurosurgery', topic: 'Visual prosthesis for the blind' }
];
const DEFAULT_GALA_SCHEDULE = [
    { time: '18:00', title: 'Welcome Reception', description: 'Champagne cocktails and canapés in the Grand Foyer' },
    { time: '19:00', title: 'Opening & Keynote Address', description: 'Keynote address to be announced' },
    { time: '20:00', title: 'Gala Dinner', description: 'Five-course dinner with premium wine pairings' },
    { time: '21:30', title: 'Biomedical Forum Annual Awards', description: 'Recognition of outstanding contributions to medical research' },
    { time: '22:30', title: 'Networking & Entertainment', description: 'Live music, dancing, and exclusive networking until midnight' }
];
function seedRows(q) {
    const rows = [];
    const add = (event_key, event_date, start, end, title, kind, extra) => rows.push(Object.assign({ event_key, event_date, start_time: start, end_time: end, title, kind, is_tbd: 0, is_published: 1, room: null, location_note: null, description: null, speaker_names: null, track: null }, extra || {}));
    // Conference — Fri 4 Dec 17:00–21:00, Novinarski dom
    const cd = '2026-12-04';
    add('conference', cd, '17:00', '17:15', 'Welcome', 'ceremony', { is_tbd: 1, room: 'Main Hall' });
    add('conference', cd, '17:15', '18:00', 'Keynote 1', 'keynote', { is_tbd: 1, room: 'Main Hall' });
    add('conference', cd, '18:00', '19:00', 'Panel', 'panel', { is_tbd: 1, room: 'Main Hall' });
    add('conference', cd, '19:00', '19:20', 'Break', 'break', { room: 'Foyer' });
    add('conference', cd, '19:20', '20:05', 'Keynote 2', 'keynote', { is_tbd: 1, room: 'Main Hall' });
    add('conference', cd, '20:05', '21:00', 'Networking', 'networking', { room: 'Foyer' });
    // Donor Night — Fri 4 Dec, Esplanade, times TBD
    add('donor', cd, '19:30', '20:00', 'Arrival & aperitif', 'reception', { is_tbd: 1, room: 'Private salon' });
    add('donor', cd, '20:00', '22:00', 'Supper', 'dinner', { is_tbd: 1, room: 'Private salon' });
    add('donor', cd, '22:00', '22:30', 'Remarks & farewell', 'talk', { is_tbd: 1, room: 'Private salon' });
    // Bridges Zagreb — Sat 5 Dec 11:00 (tentative)
    const bd = '2026-12-05';
    add('bridges', bd, '11:00', '11:15', 'Welcome', 'ceremony', { is_tbd: 1 });
    add('bridges', bd, '11:15', '12:00', 'Panel', 'panel', { is_tbd: 1 });
    add('bridges', bd, '12:00', '13:00', 'Presentations', 'presentations', { is_tbd: 1 });
    add('bridges', bd, '13:00', '14:00', 'Lunch & networking', 'lunch', { is_tbd: 1 });
    // Gala — Sat 5 Dec, Esplanade — gala_settings.schedule_json as real rows (Forum Annual Awards 21:30 always)
    let gala = [];
    try { const g = q.get("SELECT schedule_json FROM gala_settings WHERE id = 'default'"); gala = JSON.parse((g && g.schedule_json) || '[]'); } catch (e) { gala = []; }
    if (!Array.isArray(gala) || !gala.length) gala = DEFAULT_GALA_SCHEDULE.slice();
    gala = gala.filter(x => x && hm(x.time) && String(x.title || '').trim()).map(x => ({ time: hm(x.time), title: String(x.title).trim().slice(0, 200), description: cleanStr(x.description, 1000) || null }));
    if (!gala.some(x => /award/i.test(x.title))) gala.push({ time: '21:30', title: 'Biomedical Forum Annual Awards', description: 'Recognition of outstanding contributions to medical research' });
    gala.sort((a, b) => a.time.localeCompare(b.time));
    gala.forEach((x, i) => {
        const next = gala[i + 1];
        const end = next ? next.time : fromMinutes(Math.min(minutes(x.time) + 90, 23 * 60 + 59));
        add('gala', bd, x.time, end, x.title, guessKindFromTitle(x.title), { description: x.description });
    });
    // Boston — Mon 21 Sept, the MC run sheet
    const bo = '2026-09-21', room = 'Waterhouse Room';
    add('boston', bo, '17:30', '18:00', 'Doors open, welcome drinks', 'reception', { room, location_note: 'Gordon Hall, 25 Shattuck Street' });
    add('boston', bo, '18:00', '18:15', 'Welcome — Alen & HMPA', 'ceremony', { room, speaker_names: [{ name: 'Alen Juginovic', institution: 'Med&X · Harvard Medical School', topic: null }, { name: 'Harvard Medical Postdoc Association', institution: 'HMPA', topic: null }] });
    add('boston', bo, '18:15', '19:05', 'Talks, block 1 — 8 × 5 min', 'presentations', { room, speaker_names: BOSTON_BLOCK1, description: 'Eight five-minute talks.' });
    add('boston', bo, '19:05', '19:30', 'Panel — Croatia–US collaboration', 'panel', { room, speaker_names: BOSTON_PANEL, description: 'Moderated by Alen Juginovic · 25 min.' });
    add('boston', bo, '19:30', '19:35', 'Break', 'break', { room });
    add('boston', bo, '19:35', '20:20', 'Talks, block 2 — 8 × 5 min', 'presentations', { room, speaker_names: BOSTON_BLOCK2, description: 'Eight five-minute talks.' });
    add('boston', bo, '20:25', '21:00', 'Closing, group photo, networking with food', 'networking', { room });
    return rows;
}
/**
 * Runs once (app_state marker). Returns { seeded, inserted } — a second boot returns seeded:false.
 * Only ADDS rows (event_key set, is_published=1); nothing existing is touched, bridges_program is ignored.
 */
function runSeed(q, { log } = {}) {
    try { q.run('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)'); } catch (e) { /* exists */ }
    try { if (q.get('SELECT key FROM app_state WHERE key = ?', [SEED_MARKER])) return { seeded: false, inserted: 0 }; } catch (e) { return { seeded: false, inserted: 0, error: e.message }; }
    const now = nowIso();
    let inserted = 0;
    // conference_id stays NULL on every event-app row: the legacy readers (v1 member Program page via
    // /api/plexus/sessions, the admin Plexus hub's Schedule panel) key on conference_id and must not
    // suddenly show TBD placeholders — the event app reads by event_key only.
    const rows = seedRows(q);
    const perEvent = {};
    for (const r of rows) {
        perEvent[r.event_key] = (perEvent[r.event_key] || 0) + 1;
        try {
            q.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room, track, speaker_ids, is_published, capacity,
                                        event_key, event_date, sort_order, location_note, kind, speaker_names_json, is_tbd, show_counts, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [uuid(), null, r.title, r.description, r.kind, 1, r.start_time, r.end_time, r.room, r.track, null, r.is_published ? 1 : 0, null,
                 r.event_key, r.event_date, perEvent[r.event_key] * 10, r.location_note, r.kind, r.speaker_names ? JSON.stringify(r.speaker_names) : null, r.is_tbd ? 1 : 0, 0, now]);
            inserted++;
        } catch (e) { log && log('seed row failed (' + r.event_key + ' · ' + r.title + '):', e.message); }
    }
    try { q.run('INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)', [SEED_MARKER, JSON.stringify({ inserted, at: now }), now]); } catch (e) { log && log('seed marker failed:', e.message); }
    log && log(`live program seeded: ${inserted} session(s) — ` + Object.entries(perEvent).map(([k, n]) => k + ' ' + n).join(' · '));
    return { seeded: true, inserted };
}

module.exports = {
    EVENT_KINDS, KINDS, PERSON_KINDS, STATES, FACTS, SEED_MARKER, BOSTON_EVENT_ID, ZAGREB, BOSTON_TZ,
    isYmd, isHm, hm, minutes, fromMinutes, cleanStr, uuid, nowIso, isEventKey, dayLabel, shortDay, spanLabels, csvCell, zonedIso, localNow,
    liveSig, liveToken, liveUrl, verifyLiveToken,
    ensureSchema, hasTable, hasColumn,
    normalizeKind, guessKindFromTitle, parseIds, parseNames, speakerDirectory,
    rowToSession, loadSessionRows, loadSessions, meetupSession, groupByDay, roomConflicts, scheduleConflicts, lastUpdated, touchEvent,
    attendanceCounts, attendanceOf, setAttendance, recordOpen,
    eventCatalogue, eventByKey, plexusSettings,
    icsForSessions, cleanSessionInput,
    seedRows, runSeed
};
