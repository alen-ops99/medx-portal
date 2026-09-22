/**
 * v2/notes.js — shared NOTES (frontend-v2 › js/views/notes.js, nav item NOTES, next to TASKS).
 *
 * Why (Alen, 2026-09-22): at an event he meets people and dictates to Laura over WhatsApp — who he
 * met, what was agreed, what to follow up — and it gets lost in the chat. Here a note is written in
 * one tap, PER EVENT (a conference, Building Bridges Boston, the Gala…) or as a plain DAY note, and
 * afterwards he reads what happened — one event as one document (EXPORT), one person across events.
 *
 * Tables (new, v2_ prefix, both portals share the database):
 *   v2_notes        id · scope 'event'|'day'|'general' · event_key · event_label · note_date (YYYY-MM-DD) ·
 *                   title · body · author_id · author_name · pinned · created_at · updated_at · archived_at
 *   v2_note_files   id · note_id · filename · original_name · stored_key · size · mime · uploaded_at
 *   v2_note_people  id · note_id · person_name · person_email · institution   ("met Prof. X, MGH" — searchable by person)
 *
 * Event keys: bridges:<id> · conference:<id> · gala:default · meetup:<id> · custom:<slug> (free text —
 * "Coffee with Dean X" is a fine event). The picker (/events) reads bridges_events, the active
 * conference, gala_settings, plexus_meetups when present, plus every event_label already used.
 *
 * Routes (all auth + adminOnly; /api/v2/notes is deliberately NOT in SECTION_ROUTE_MAP — notes are
 * for the whole team, like TASKS and Today; NO emails are ever sent from here):
 *   GET    /api/v2/notes                 ?scope= &event=<key> &from= &to= &q= &person= &pinned=1 &archived=1 &order=asc|desc &limit=
 *                                        → { notes, me, today }
 *   GET    /api/v2/notes/events          ?today=YYYY-MM-DD (the phone's local date) → { today, events: [{ key, label, kind, date, end_date, today, upcoming, count, export_url }] }
 *   GET    /api/v2/notes/people          → { people: [{ name, email, institution, count, last_date }] }
 *   GET    /api/v2/notes/summary         ?today= → the Today tile: { today, count, last, event, event_count }
 *   GET    /api/v2/notes/export          ?event=<key> | ?date=YYYY-MM-DD — Bearer OR signed ?exp=&sig= → a clean printable HTML page
 *   GET    /api/v2/notes/export-link     ?event= | ?date= → { url } (signed, one hour)
 *   GET    /api/v2/notes/:id             → { note }
 *   POST   /api/v2/notes                 { body, title?, event_key?, event_label?, note_date?, scope?, people?, pinned? }
 *   PUT    /api/v2/notes/:id             { body?, title?, event_key?, event_label?, note_date?, scope? }   (event_key '' = detach → day note)
 *   POST   /api/v2/notes/:id/pin · /unpin · /archive · /unarchive
 *   DELETE /api/v2/notes/:id             hard delete (files, people go with it) — archive is the everyday door
 *   GET    /api/v2/notes/:id/files · POST multipart 'file' (≤ 25 MB, any type; phone camera photos included)
 *   GET    /api/v2/notes/files/:fid      Bearer OR signed ?exp=&sig= (+ &inline=1 for thumbnails) — S3 302 / local stream
 *   DELETE /api/v2/notes/files/:fid
 *   POST   /api/v2/notes/:id/people      { name, email?, institution? } → { people }
 *   DELETE /api/v2/notes/:id/people/:pid → { people }
 *
 * Files: S3 (the BB_S3_* bucket + SigV4 helper the Boston wing owns, under notes/<note>/) when
 * configured — the Render service has no disk; otherwise the shared uploads root (user-portal/backend/
 * uploads/notes). Every write appends an audit_log row (the shared activity trail), as tasks.js does.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCOPES = ['event', 'day', 'general'];
const MAX_TITLE = 200, MAX_BODY = 20000, MAX_LABEL = 160, MAX_PERSON = 120, MAX_EMAIL = 200, MAX_INST = 160, MAX_PEOPLE = 40;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LINK_TTL_S = 60 * 60;   // signed links handed out with a list live one hour
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(String(s) + 'T00:00:00Z').getTime());
const cleanStr = (v, max) => (v === undefined ? undefined : String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max));
const firstOf = n => String(n || '').trim().split(/\s+/)[0] || '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sanitizeFilename = n => String(n || 'file').replace(/[\/\\]/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'file';
const extOf = name => { const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
const dayLabel = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] : ''; };
const rangeLabel = (a, b) => { if (!a) return ''; if (!b || b === a) return dayLabel(a); const ma = a.slice(5, 7), mb = b.slice(5, 7); return ma === mb ? Number(a.slice(8, 10)) + '–' + Number(b.slice(8, 10)) + ' ' + MON[Number(ma) - 1] : dayLabel(a) + ' – ' + dayLabel(b); };
const isEventKey = k => /^(bridges|conference|gala|meetup|custom):[A-Za-z0-9_.:-]{1,80}$/.test(String(k || ''));
// "Building Bridges — Boston · 21 Sep": the city column is the truth, the long name is shortened;
// any other event keeps its name and gains the city only when the name does not already carry it
function bridgesLabel(name, city, ymd) {
    const n = String(name || '').trim(), c = String(city || '').trim();
    const base = /^building bridges/i.test(n) || !n ? 'Building Bridges' + (c ? ' — ' + c : '') : n + (c && !n.toLowerCase().includes(c.toLowerCase()) ? ' — ' + c : '');
    return base + (ymd ? ' · ' + dayLabel(ymd) : '');
}
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));
const firstLine = s => String(s || '').split('\n').map(l => l.trim()).find(Boolean) || '';

// people: [{name,email?,institution?}] | ['Prof. X, MGH'] | 'a, b' → cleaned, de-duplicated by name; NaN when unusable
function cleanPeople(v) {
    if (v === undefined) return undefined;
    let arr = v;
    if (typeof v === 'string') { try { arr = JSON.parse(v); } catch (e) { arr = v.split(/[\n;]+/); } }
    if (!Array.isArray(arr)) return NaN;
    const out = []; const seen = new Set();
    for (const it of arr.slice(0, MAX_PEOPLE)) {
        const o = it && typeof it === 'object' ? it : { name: it };
        const name = cleanStr(o.name, MAX_PERSON);
        if (!name) continue;
        const k = name.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
        const email = cleanStr(o.email, MAX_EMAIL) || null;
        out.push({ name, email: email && isEmail(email) ? email.toLowerCase() : null, institution: cleanStr(o.institution, MAX_INST) || null });
    }
    return out;
}

module.exports = function mountNotes(app, ctx) {
    const { auth, adminOnly, saveDb, JWT_SECRET } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/notes]', ...a));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const nowIso = () => new Date().toISOString();
    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    const persist = () => { try { saveDb && saveDb(); } catch (e) { /* periodic save still runs */ } };
    const fail = (res, e, what) => { console.error('[v2/notes] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    const hasTable = name => { try { return !!q.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]); } catch (e) { return false; } };
    function audit(req, action, detail) {
        try {
            q.run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [uuid(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 300)]);
        } catch (e) { /* best-effort */ }
    }
    // "today" is the phone's date when the client says so (Boston at 21:00 is already tomorrow in UTC)
    const todayOf = req => { const t = String((req.query && req.query.today) || '').slice(0, 10); return isYmd(t) ? t : nowIso().slice(0, 10); };

    // ---- schema (new tables only — nothing of server.js's is touched) ----
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_notes (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL DEFAULT 'day',
            event_key TEXT,
            event_label TEXT,
            note_date TEXT NOT NULL,
            title TEXT,
            body TEXT NOT NULL,
            author_id TEXT,
            author_name TEXT,
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            archived_at TEXT
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_notes_date ON v2_notes (note_date, created_at)');
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_notes_event ON v2_notes (event_key, note_date)');
        q.run(`CREATE TABLE IF NOT EXISTS v2_note_files (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT,
            stored_key TEXT,
            size INTEGER,
            mime TEXT,
            uploaded_at TEXT
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_note_files_note ON v2_note_files (note_id, uploaded_at)');
        q.run(`CREATE TABLE IF NOT EXISTS v2_note_people (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            person_name TEXT NOT NULL,
            person_email TEXT,
            institution TEXT
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_note_people_note ON v2_note_people (note_id)');
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_note_people_name ON v2_note_people (person_name)');
    } catch (e) { log('notes schema failed:', e.message); }

    // ---- who is writing ----
    function nameOfUser(u) { return [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.email || '').split('@')[0] || 'Someone'; }
    function actorOf(req) {
        const u = req.user || {};
        const row = q.get('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [u.id]) || {};
        const name = nameOfUser(Object.assign({ email: u.email }, row));
        return { id: u.id || null, email: row.email || u.email || null, name, first: firstOf(name) };
    }

    // ---- the event picker ----
    // Every event the team could be at: bridges_events · the active conference(s) · the gala ·
    // plexus_meetups (when the table exists) · any event_label already used in notes (free-text
    // events and events that have since left the tables keep their door).
    function knownEvents(today) {
        const out = new Map();
        const add = e => { if (e && e.key && !out.has(e.key)) out.set(e.key, e); };
        try {
            q.all(`SELECT id, name, city, event_date, end_time, status FROM bridges_events WHERE COALESCE(status, '') <> 'cancelled' ORDER BY event_date`).forEach(r => {
                const d = String(r.event_date || '').slice(0, 10); const dated = isYmd(d);
                add({ key: 'bridges:' + r.id, kind: 'bridges', label: bridgesLabel(r.name, r.city, dated ? d : null), date: dated ? d : null, end_date: dated ? d : null });
            });
        } catch (e) { /* table absent on a bare DB */ }
        try {
            q.all(`SELECT id, name, year, start_date, end_date, is_active FROM conferences WHERE COALESCE(is_active, 0) = 1 ORDER BY start_date`).forEach(r => {
                const a = String(r.start_date || '').slice(0, 10), b = String(r.end_date || r.start_date || '').slice(0, 10);
                add({ key: 'conference:' + r.id, kind: 'conference', label: `${String(r.name || 'Plexus').trim()}${isYmd(a) ? ' · ' + rangeLabel(a, isYmd(b) ? b : a) : ''}`, date: isYmd(a) ? a : null, end_date: isYmd(b) ? b : (isYmd(a) ? a : null) });
            });
        } catch (e) { /* absent */ }
        try {
            const g = q.get(`SELECT id, title, date FROM gala_settings WHERE id = 'default'`);
            if (g) { const d = String(g.date || '').slice(0, 10); add({ key: 'gala:default', kind: 'gala', label: `${String(g.title || 'Gala Evening').trim()}${isYmd(d) ? ' · ' + dayLabel(d) : ''}`, date: isYmd(d) ? d : null, end_date: isYmd(d) ? d : null }); }
        } catch (e) { /* absent */ }
        if (hasTable('plexus_meetups')) {
            try {
                q.all(`SELECT id, title, kind, starts_at, status FROM plexus_meetups WHERE status IN ('published', 'completed') ORDER BY starts_at`).forEach(r => {
                    const d = String(r.starts_at || '').slice(0, 10); if (!isYmd(d)) return;
                    add({ key: 'meetup:' + r.id, kind: 'meetup', label: `${String(r.title || 'Meetup').trim()} · ${dayLabel(d)}`, date: d, end_date: d });
                });
            } catch (e) { /* absent */ }
        }
        // labels already in use — their dates are the notes' dates
        try {
            q.all(`SELECT event_key, MAX(event_label) AS label, MIN(note_date) AS d0, MAX(note_date) AS d1 FROM v2_notes WHERE event_key IS NOT NULL AND event_key <> '' GROUP BY event_key`).forEach(r => {
                if (out.has(r.event_key)) { if (!out.get(r.event_key).date) { out.get(r.event_key).date = r.d0; out.get(r.event_key).end_date = r.d1; } return; }
                add({ key: r.event_key, kind: String(r.event_key).split(':')[0], label: String(r.label || r.event_key), date: r.d0, end_date: r.d1, from_notes: true });
            });
        } catch (e) { /* fresh DB */ }
        const counts = {};
        try { q.all(`SELECT event_key, COUNT(*) AS c FROM v2_notes WHERE archived_at IS NULL AND event_key IS NOT NULL GROUP BY event_key`).forEach(r => { counts[r.event_key] = Number(r.c || 0); }); } catch (e) { /* fresh DB */ }
        const list = Array.from(out.values()).map(e => {
            const a = e.date, b = e.end_date || e.date;
            const isToday = !!(a && b && a <= today && today <= b);
            return Object.assign(e, { today: isToday, upcoming: !!(a && a > today), count: counts[e.key] || 0, export_url: exportPath('event:' + e.key) });
        });
        // today's first · then upcoming soonest-first · then everything else most-recent-first
        list.sort((x, y) => {
            const gx = x.today ? 0 : x.upcoming ? 1 : 2, gy = y.today ? 0 : y.upcoming ? 1 : 2;
            if (gx !== gy) return gx - gy;
            const dx = x.date || '', dy = y.date || '';
            if (gx === 1) return dx.localeCompare(dy) || x.label.localeCompare(y.label);
            return dy.localeCompare(dx) || x.label.localeCompare(y.label);
        });
        return list;
    }
    const eventByKey = (key, today) => knownEvents(today).find(e => e.key === key) || null;

    // ---- rows ----
    function peopleOf(ids) {
        if (!ids.length) return {};
        const rows = q.all(`SELECT id, note_id, person_name, person_email, institution FROM v2_note_people WHERE note_id IN (${ids.map(() => '?').join(',')}) ORDER BY rowid`, ids);
        const by = {}; rows.forEach(r => { (by[r.note_id] = by[r.note_id] || []).push({ id: r.id, name: r.person_name, email: r.person_email || null, institution: r.institution || null }); });
        return by;
    }
    function filesOf(ids) {
        if (!ids.length) return {};
        const rows = q.all(`SELECT * FROM v2_note_files WHERE note_id IN (${ids.map(() => '?').join(',')}) ORDER BY uploaded_at, rowid`, ids);
        const by = {}; rows.forEach(r => { (by[r.note_id] = by[r.note_id] || []).push(shapeFile(r)); });
        return by;
    }
    function shape(r, people, files) {
        return {
            id: r.id, scope: SCOPES.includes(r.scope) ? r.scope : (r.event_key ? 'event' : 'day'),
            event_key: r.event_key || null, event_label: r.event_label || null, note_date: String(r.note_date || '').slice(0, 10),
            title: r.title || '', body: r.body || '', first_line: firstLine(r.title || r.body),
            author_id: r.author_id || null, author_name: r.author_name || null, author_first: firstOf(r.author_name) || null,
            pinned: !!Number(r.pinned || 0), created_at: r.created_at || null, updated_at: r.updated_at || r.created_at || null, archived_at: r.archived_at || null,
            people: people || [], files: files || []
        };
    }
    function shapeMany(rows) {
        const ids = rows.map(r => r.id); const P = peopleOf(ids), F = filesOf(ids);
        return rows.map(r => shape(r, P[r.id], F[r.id]));
    }
    const noteRow = id => q.get('SELECT * FROM v2_notes WHERE id = ?', [id]);
    const shapeOne = id => { const r = noteRow(id); return r ? shapeMany([r])[0] : null; };
    function touch(id) { q.run('UPDATE v2_notes SET updated_at = ? WHERE id = ?', [nowIso(), id]); }

    // event_key / event_label / scope from a request body → { scope, event_key, event_label } or { error }.
    //   event_key 'bridges:…'            → that event (label from the picker unless one is sent)
    //   event_label 'Coffee with Dean X' → a free-text event: custom:coffee-with-dean-x (a known label is matched first)
    //   event_key '' (or event_label '') → detached: a day note (scope 'general' when asked)
    //   neither                          → unchanged (an update) / a day note (a create)
    function resolveEvent(b, today, cur) {
        const keyIn = b.event_key === undefined ? undefined : String(b.event_key == null ? '' : b.event_key).trim();
        const labelIn = cleanStr(b.event_label, MAX_LABEL);
        const scopeIn = b.scope === undefined ? undefined : String(b.scope || '').trim().toLowerCase();
        if (scopeIn && !SCOPES.includes(scopeIn)) return { error: 'Scope is event, day or general.' };
        let key = cur ? (cur.event_key || null) : null, label = cur ? (cur.event_label || null) : null;
        if (keyIn) {
            if (!isEventKey(keyIn)) return { error: 'That event key is not recognised.' };
            const known = eventByKey(keyIn, today);
            key = keyIn; label = labelIn || (known ? known.label : null) || (cur && cur.event_key === keyIn ? cur.event_label : null) || keyIn.split(':').slice(1).join(':');
        } else if (labelIn) {
            const known = knownEvents(today).find(e => e.label.toLowerCase() === labelIn.toLowerCase());
            key = known ? known.key : 'custom:' + slug(labelIn); label = known ? known.label : labelIn;
        } else if (keyIn === '' || labelIn === '') { key = null; label = null; }
        const kept = cur && !cur.event_key && (cur.scope === 'day' || cur.scope === 'general') ? cur.scope : 'day';
        const scope = key ? 'event' : (scopeIn === 'day' || scopeIn === 'general' ? scopeIn : kept);
        return { scope, event_key: key, event_label: key ? label : null };
    }

    // ---- files (S3 when the bucket is configured, else the shared uploads root) ----
    function s3() { try { return require('../../../user-portal/backend/boston')._s3; } catch (e) { return null; } }
    const s3Ready = () => { const S = s3(); return !!(S && S.isConfigured && S.isConfigured()); };
    const LOCAL_DIR = path.join(String(ctx.ROOT || path.join(__dirname, '..', '..', '..')), 'user-portal', 'backend', 'uploads', 'notes');
    let multerLib = null; try { multerLib = require('multer'); } catch (e) { multerLib = null; }
    const fileUpload = multerLib ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } }).fields([{ name: 'file', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]) : null;
    function uploadParser(req, res, next) {
        if (req.file && req.file.buffer) return next();   // already parsed (a test handing the route a buffer)
        if (!fileUpload) return res.status(503).json({ error: 'Uploads are momentarily unavailable on this server.' });
        fileUpload(req, res, err => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 25 MB limit — share a link to it instead.' });
                return res.status(400).json({ error: 'We could not read that upload — try again.' });
            }
            if (req.files) req.file = (req.files.file && req.files.file[0]) || (req.files.attachment && req.files.attachment[0]) || null;
            next();
        });
    }
    const sign = (what, exp) => crypto.createHmac('sha256', String(JWT_SECRET || 'medx')).update('note:' + what + ':' + exp).digest('hex').slice(0, 32);
    const signedOk = (what, req) => {
        const exp = Number(req.query && req.query.exp); const sig = String((req.query && req.query.sig) || '');
        if (!what || !exp || sig.length !== 32 || exp <= Math.floor(Date.now() / 1000)) return false;
        try { return crypto.timingSafeEqual(Buffer.from(sign(what, exp)), Buffer.from(sig)); } catch (e) { return false; }
    };
    function filePath(fid) { const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S; return `/api/v2/notes/files/${encodeURIComponent(fid)}?exp=${exp}&sig=${sign('file:' + fid, exp)}`; }
    function exportPath(target) { const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S; const [kind, ...rest] = target.split(':'); return `/api/v2/notes/export?${kind}=${encodeURIComponent(rest.join(':'))}&exp=${exp}&sig=${sign('export:' + target, exp)}`; }
    const isImage = m => /^image\//i.test(String(m || ''));
    function shapeFile(f) {
        const url = filePath(f.id);
        return { id: f.id, note_id: f.note_id, name: f.original_name || f.filename, size: Number(f.size || 0), mime: f.mime || '', uploaded_at: f.uploaded_at || null, is_image: isImage(f.mime), url, view_url: url + '&inline=1' };
    }
    // a signed link is as good as the Bearer the SPA holds (only an authenticated list hands one out)
    const fileGate = (req, res, next) => (signedOk('file:' + String(req.params.fid || ''), req) ? next() : auth(req, res, () => adminOnly(req, res, next)));
    const exportGate = (req, res, next) => {
        const target = req.query && req.query.event ? 'event:' + String(req.query.event) : req.query && req.query.date ? 'date:' + String(req.query.date) : '';
        return signedOk('export:' + target, req) ? next() : auth(req, res, () => adminOnly(req, res, next));
    };

    // ---- listing ----
    function listNotes(opts, today) {
        const where = []; const vals = [];
        where.push(opts.archived ? 'n.archived_at IS NOT NULL' : 'n.archived_at IS NULL');
        if (opts.scope) { if (opts.scope === 'day') where.push("n.scope IN ('day', 'general')"); else { where.push('n.scope = ?'); vals.push(opts.scope); } }
        if (opts.event) { where.push('n.event_key = ?'); vals.push(opts.event); }
        if (opts.from) { where.push('n.note_date >= ?'); vals.push(opts.from); }
        if (opts.to) { where.push('n.note_date <= ?'); vals.push(opts.to); }
        if (opts.pinned) where.push('n.pinned = 1');
        if (opts.person) { where.push('EXISTS (SELECT 1 FROM v2_note_people p WHERE p.note_id = n.id AND LOWER(p.person_name) = LOWER(?))'); vals.push(opts.person); }
        for (const tok of String(opts.q || '').trim().slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 6)) {
            const like = '%' + tok.replace(/[%_]/g, c => '\\' + c) + '%';
            where.push(`(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\' OR n.event_label LIKE ? ESCAPE '\\'
                         OR EXISTS (SELECT 1 FROM v2_note_people p WHERE p.note_id = n.id AND (p.person_name LIKE ? ESCAPE '\\' OR p.institution LIKE ? ESCAPE '\\' OR p.person_email LIKE ? ESCAPE '\\'))
                         OR EXISTS (SELECT 1 FROM v2_note_files f WHERE f.note_id = n.id AND f.original_name LIKE ? ESCAPE '\\'))`);
            vals.push(like, like, like, like, like, like, like);
        }
        const dir = opts.order === 'asc' ? 'ASC' : 'DESC';
        const limit = Math.min(Math.max(Number(opts.limit) || 400, 1), 2000);
        const rows = q.all(`SELECT n.* FROM v2_notes n WHERE ${where.join(' AND ')} ORDER BY n.note_date ${dir}, n.created_at ${dir} LIMIT ${limit}`, vals);
        return shapeMany(rows);
    }
    function queryOpts(qs) {
        const scope = String(qs.scope || '').trim().toLowerCase();
        return {
            archived: String(qs.archived || '') === '1', scope: SCOPES.includes(scope) ? scope : null,
            event: isEventKey(qs.event) ? String(qs.event) : null,
            from: isYmd(qs.from) ? String(qs.from) : null, to: isYmd(qs.to) ? String(qs.to) : null,
            pinned: String(qs.pinned || '') === '1', person: cleanStr(qs.person, MAX_PERSON) || null,
            q: qs.q, order: String(qs.order || '').toLowerCase(), limit: qs.limit
        };
    }
    function peopleIndex() {
        return q.all(`SELECT p.person_name, MAX(p.person_email) AS email, MAX(p.institution) AS institution, COUNT(*) AS c, MAX(n.note_date) AS last_date
                      FROM v2_note_people p JOIN v2_notes n ON n.id = p.note_id WHERE n.archived_at IS NULL
                      GROUP BY LOWER(p.person_name) ORDER BY MAX(n.note_date) DESC, LOWER(p.person_name)`)
            .map(r => ({ name: r.person_name, email: r.email || null, institution: r.institution || null, count: Number(r.c || 0), last_date: r.last_date || null }));
    }

    // ---- the printable page (one event, or one day, as one document) ----
    function exportHtml({ heading, sub, notes, showEvent }) {
        const people = []; const seenP = new Set();
        notes.forEach(n => n.people.forEach(p => { const k = p.name.toLowerCase(); if (!seenP.has(k)) { seenP.add(k); people.push(p); } }));
        const byDay = {}; notes.forEach(n => { (byDay[n.note_date] = byDay[n.note_date] || []).push(n); });
        const days = Object.keys(byDay).sort();
        // times are written in UTC and re-rendered in the reader's local time by the one-line script at the end
        const hm = iso => { const d = new Date(iso || 0); return isNaN(d) ? '' : `<span data-t="${esc(d.toISOString())}">${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC</span>`; };
        const longDay = ymd => { const d = new Date(ymd + 'T00:00:00Z'); return isNaN(d) ? ymd : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
        const note = n => `
      <article class="note${n.pinned ? ' pinned' : ''}">
        <div class="meta">${n.pinned ? '<span class="pin">PINNED</span>' : ''}<span>${esc(n.author_first || n.author_name || '')}</span><span>${hm(n.created_at)}</span>${showEvent && n.event_label ? `<span>${esc(n.event_label)}</span>` : ''}</div>
        ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}
        <div class="body">${esc(n.body)}</div>
        ${n.people.length ? `<div class="people">${n.people.map(p => `<span>${esc(p.name)}${p.institution ? ' · ' + esc(p.institution) : ''}</span>`).join('')}</div>` : ''}
        ${n.files.length ? `<div class="files">${n.files.map(f => f.is_image ? `<a href="${esc(f.url)}"><img src="${esc(f.view_url)}" alt="${esc(f.name)}"></a>` : `<a href="${esc(f.url)}">${esc(f.name)}</a>`).join('')}</div>` : ''}
      </article>`;
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(heading)} — notes</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f2ea; color: #201b16; font: 15px/1.6 Inter, -apple-system, Helvetica, Arial, sans-serif; }
  .page { max-width: 760px; margin: 0 auto; padding: 40px 28px 80px; }
  .eyebrow { font: 600 10px Inter, sans-serif; letter-spacing: .22em; color: #9b1b22; text-transform: uppercase; }
  h1 { font-family: Fraunces, Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 34px; line-height: 1.12; margin: 10px 0 4px; }
  .sub { color: #6d6459; font-size: 13px; }
  .roll { margin: 26px 0 8px; padding: 16px 18px; background: #fff; border: 1px solid rgba(32,27,22,.14); border-top: 2px solid #c9a962; }
  .roll .eyebrow { color: #7a6432; }
  .roll ul { margin: 8px 0 0; padding: 0; list-style: none; columns: 2; column-gap: 24px; }
  .roll li { break-inside: avoid; padding: 3px 0; font-size: 14px; }
  .roll li small { color: #6d6459; }
  h2 { font: 600 11px Inter, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: #201b16; margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(32,27,22,.18); }
  .note { background: #fff; border: 1px solid rgba(32,27,22,.14); padding: 16px 18px; margin: 0 0 12px; break-inside: avoid; }
  .note.pinned { border-left: 3px solid #9b1b22; }
  .meta { display: flex; gap: 12px; flex-wrap: wrap; font: 600 10px Inter, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #6d6459; }
  .meta .pin { color: #9b1b22; }
  h3 { font-family: Fraunces, Georgia, serif; font-weight: 400; font-size: 20px; margin: 8px 0 4px; }
  .body { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 6px; }
  .people { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .people span { font-size: 12px; padding: 3px 8px; background: #f8f1e2; color: #7a6432; }
  .files { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; align-items: flex-start; }
  .files img { max-width: 220px; max-height: 160px; border: 1px solid rgba(32,27,22,.14); display: block; }
  .files a { font-size: 12.5px; color: #9b1b22; }
  .print { position: fixed; right: 18px; top: 18px; padding: 12px 18px; background: #201b16; color: #f6f2ea; font: 600 10px Inter, sans-serif; letter-spacing: .16em; border: 0; cursor: pointer; }
  .foot { margin-top: 40px; font-size: 11px; color: #6d6459; }
  .empty { font-family: Fraunces, Georgia, serif; font-style: italic; color: #6d6459; padding: 30px 0; }
  @media print { body { background: #fff; } .print { display: none; } .page { padding: 0; max-width: none; } .note { border-color: #ccc; } a { color: inherit; text-decoration: none; } }
</style></head><body>
<button class="print" onclick="window.print()">PRINT · SAVE AS PDF</button>
<div class="page">
  <div class="eyebrow">Med&amp;X · Notes</div>
  <h1>${esc(heading)}</h1>
  <div class="sub">${esc(sub)}</div>
  ${people.length ? `<div class="roll"><div class="eyebrow">People met · ${people.length}</div><ul>${people.map(p => `<li>${esc(p.name)}${p.institution ? ` <small>· ${esc(p.institution)}</small>` : ''}${p.email ? ` <small>· ${esc(p.email)}</small>` : ''}</li>`).join('')}</ul></div>` : ''}
  ${days.map(d => `<h2>${esc(longDay(d))}</h2>${byDay[d].map(note).join('')}`).join('')}
  ${!notes.length ? '<div class="empty">No notes here yet.</div>' : ''}
  <div class="foot">Exported ${esc(new Date().toUTCString())} · ${notes.length} note${notes.length === 1 ? '' : 's'} · Med&amp;X admin portal</div>
</div>
<script>document.querySelectorAll('[data-t]').forEach(function (e) { var d = new Date(e.getAttribute('data-t')); if (!isNaN(d)) e.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); });</script>
</body></html>`;
    }

    // ================================================================ reads
    app.get('/api/v2/notes/events', auth, adminOnly, (req, res) => {
        try { const today = todayOf(req); res.json({ today, events: knownEvents(today) }); } catch (e) { fail(res, e, 'events'); }
    });
    app.get('/api/v2/notes/people', auth, adminOnly, (req, res) => {
        try { res.json({ people: peopleIndex() }); } catch (e) { fail(res, e, 'people'); }
    });
    app.get('/api/v2/notes/summary', auth, adminOnly, (req, res) => {
        try {
            const today = todayOf(req);
            const todays = listNotes({ from: today, to: today }, today);
            const last = listNotes({ limit: 1 }, today)[0] || null;
            const ev = knownEvents(today).find(e => e.today) || null;
            res.json({
                today, count: todays.length,
                last: last ? { id: last.id, first_line: last.first_line, author_first: last.author_first, event_label: last.event_label, note_date: last.note_date, created_at: last.created_at } : null,
                event: ev ? { key: ev.key, label: ev.label, kind: ev.kind } : null, event_count: ev ? ev.count : 0
            });
        } catch (e) { fail(res, e, 'summary'); }
    });
    app.get('/api/v2/notes/export-link', auth, adminOnly, (req, res) => {
        try {
            if (isEventKey(req.query.event)) return res.json({ url: exportPath('event:' + String(req.query.event)) });
            if (isYmd(req.query.date)) return res.json({ url: exportPath('date:' + String(req.query.date)) });
            res.status(400).json({ error: 'Name an event or a date to export.' });
        } catch (e) { fail(res, e, 'export link'); }
    });
    app.get('/api/v2/notes/export', exportGate, (req, res) => {
        try {
            const today = todayOf(req);
            let heading, sub, notes, showEvent = false;
            if (isEventKey(req.query.event)) {
                const key = String(req.query.event); const ev = eventByKey(key, today);
                notes = listNotes({ event: key, order: 'asc', limit: 2000 }, today);
                heading = ev ? ev.label : (notes[0] ? notes[0].event_label : key);
                sub = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} · ${rangeLabel(notes[0].note_date, notes[notes.length - 1].note_date)} ${notes[0].note_date.slice(0, 4)}` : 'No notes yet';
            } else if (isYmd(req.query.date)) {
                const d = String(req.query.date);
                notes = listNotes({ from: d, to: d, order: 'asc', limit: 2000 }, today);
                heading = 'Notes · ' + dayLabel(d) + ' ' + d.slice(0, 4);
                sub = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
                showEvent = true;
            } else return res.status(400).json({ error: 'Name an event or a date to export.' });
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(exportHtml({ heading, sub, notes, showEvent }));
        } catch (e) { fail(res, e, 'export'); }
    });

    app.get('/api/v2/notes', auth, adminOnly, (req, res) => {
        try {
            const today = todayOf(req); const me = actorOf(req);
            res.json({ notes: listNotes(queryOpts(req.query || {}), today), me: { id: me.id, name: me.name, first: me.first, email: me.email }, today });
        } catch (e) { fail(res, e, 'list'); }
    });

    // ================================================================ writes
    app.post('/api/v2/notes', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {}; const today = todayOf(req); const actor = actorOf(req);
            const body = cleanStr(b.body, MAX_BODY);
            const title = cleanStr(b.title, MAX_TITLE) || null;
            if (!body && !title) return res.status(400).json({ error: 'Write the note first.' });
            const date = b.note_date == null || b.note_date === '' ? today : String(b.note_date).slice(0, 10);
            if (!isYmd(date)) return res.status(400).json({ error: 'The date must be YYYY-MM-DD.' });
            const ev = resolveEvent(b, today, null); if (ev.error) return res.status(400).json({ error: ev.error });
            const people = cleanPeople(b.people); if (people !== undefined && !Array.isArray(people)) return res.status(400).json({ error: 'People must be a list of names.' });
            const id = uuid(); const now = nowIso();
            q.run(`INSERT INTO v2_notes (id, scope, event_key, event_label, note_date, title, body, author_id, author_name, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
                [id, ev.scope, ev.event_key, ev.event_label, date, title, body || '', actor.id, actor.name, b.pinned === true || b.pinned === 1 || b.pinned === '1' ? 1 : 0, now, now]);
            (people || []).forEach(p => q.run('INSERT INTO v2_note_people (id, note_id, person_name, person_email, institution) VALUES (?,?,?,?,?)', [uuid(), id, p.name, p.email, p.institution]));
            audit(req, 'note.create', (ev.event_label ? ev.event_label + ': ' : date + ': ') + firstLine(title || body));
            persist();
            res.json({ success: true, id, note: shapeOne(id) });
        } catch (e) { fail(res, e, 'create'); }
    });

    app.get('/api/v2/notes/:id', auth, adminOnly, (req, res) => {
        try { const n = shapeOne(String(req.params.id || '')); if (!n) return res.status(404).json({ error: 'That note is not here.' }); res.json({ note: n }); } catch (e) { fail(res, e, 'detail'); }
    });

    app.put('/api/v2/notes/:id', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = noteRow(id);
            if (!cur) return res.status(404).json({ error: 'That note is not here.' });
            const b = req.body || {}; const today = todayOf(req); const actor = actorOf(req);
            const sets = []; const vals = []; const notes = [];
            if (b.body !== undefined) {
                const body = cleanStr(b.body, MAX_BODY);
                const title = b.title !== undefined ? cleanStr(b.title, MAX_TITLE) : (cur.title || '');
                if (!body && !title) return res.status(400).json({ error: 'A note needs some text — archive it instead if it is not needed.' });
                if (body !== (cur.body || '')) { sets.push('body = ?'); vals.push(body); notes.push('text'); }
            }
            if (b.title !== undefined) { const t = cleanStr(b.title, MAX_TITLE) || null; if ((t || '') !== (cur.title || '')) { sets.push('title = ?'); vals.push(t); notes.push('title'); } }
            if (b.note_date !== undefined) {
                const d = String(b.note_date || '').slice(0, 10); if (!isYmd(d)) return res.status(400).json({ error: 'The date must be YYYY-MM-DD.' });
                if (d !== String(cur.note_date).slice(0, 10)) { sets.push('note_date = ?'); vals.push(d); notes.push('date → ' + d); }
            }
            if (b.event_key !== undefined || b.event_label !== undefined || b.scope !== undefined) {
                const ev = resolveEvent(b, today, cur); if (ev.error) return res.status(400).json({ error: ev.error });
                if (ev.event_key !== (cur.event_key || null) || ev.event_label !== (cur.event_label || null) || ev.scope !== cur.scope) {
                    sets.push('scope = ?', 'event_key = ?', 'event_label = ?'); vals.push(ev.scope, ev.event_key, ev.event_label);
                    notes.push(ev.event_key ? 'event → ' + ev.event_label : 'detached from its event');
                }
            }
            if (!sets.length) return res.json({ success: true, note: shapeOne(id), unchanged: true });
            sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(id);
            q.run(`UPDATE v2_notes SET ${sets.join(', ')} WHERE id = ?`, vals);
            audit(req, 'note.update', `${actor.first} edited ${notes.join(', ')}: ${firstLine(cur.title || cur.body)}`);
            persist();
            res.json({ success: true, note: shapeOne(id) });
        } catch (e) { fail(res, e, 'update'); }
    });

    function flag(req, res, col, on, action, word) {
        const id = String(req.params.id || ''); const cur = noteRow(id);
        if (!cur) return res.status(404).json({ error: 'That note is not here.' });
        const actor = actorOf(req);
        const now = !!(col === 'pinned' ? Number(cur.pinned) : cur.archived_at);
        if (now === on) return res.json({ success: true, note: shapeOne(id), unchanged: true });
        if (col === 'pinned') q.run('UPDATE v2_notes SET pinned = ?, updated_at = ? WHERE id = ?', [on ? 1 : 0, nowIso(), id]);
        else q.run('UPDATE v2_notes SET archived_at = ?, updated_at = ? WHERE id = ?', [on ? nowIso() : null, nowIso(), id]);
        audit(req, action, `${actor.first} ${word}: ${firstLine(cur.title || cur.body)}`);
        persist();
        res.json({ success: true, note: shapeOne(id) });
    }
    app.post('/api/v2/notes/:id/pin', auth, adminOnly, (req, res) => { try { flag(req, res, 'pinned', true, 'note.pin', 'pinned'); } catch (e) { fail(res, e, 'pin'); } });
    app.post('/api/v2/notes/:id/unpin', auth, adminOnly, (req, res) => { try { flag(req, res, 'pinned', false, 'note.unpin', 'unpinned'); } catch (e) { fail(res, e, 'unpin'); } });
    app.post('/api/v2/notes/:id/archive', auth, adminOnly, (req, res) => { try { flag(req, res, 'archived_at', true, 'note.archive', 'archived'); } catch (e) { fail(res, e, 'archive'); } });
    app.post('/api/v2/notes/:id/unarchive', auth, adminOnly, (req, res) => { try { flag(req, res, 'archived_at', false, 'note.unarchive', 'brought back'); } catch (e) { fail(res, e, 'unarchive'); } });

    app.delete('/api/v2/notes/:id', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = noteRow(id);
            if (!cur) return res.status(404).json({ error: 'That note is not here.' });
            q.all('SELECT * FROM v2_note_files WHERE note_id = ?', [id]).forEach(f => { if (f.stored_key && !String(f.stored_key).startsWith('s3:')) { try { fs.unlinkSync(f.stored_key); } catch (e) { /* gone */ } } });
            q.run('DELETE FROM v2_note_files WHERE note_id = ?', [id]);
            q.run('DELETE FROM v2_note_people WHERE note_id = ?', [id]);
            q.run('DELETE FROM v2_notes WHERE id = ?', [id]);
            audit(req, 'note.delete', firstLine(cur.title || cur.body));
            persist();
            res.json({ success: true });
        } catch (e) { fail(res, e, 'delete'); }
    });

    // ---- people ----
    const peopleList = id => peopleOf([id])[id] || [];
    app.post('/api/v2/notes/:id/people', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = noteRow(id);
            if (!cur) return res.status(404).json({ error: 'That note is not here.' });
            const list = cleanPeople([req.body || {}]);
            if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'Type the name first.' });
            const p = list[0];
            if (peopleList(id).length >= MAX_PEOPLE) return res.status(400).json({ error: 'That is plenty of people for one note — start another.' });
            const dup = q.get('SELECT id FROM v2_note_people WHERE note_id = ? AND LOWER(person_name) = LOWER(?)', [id, p.name]);
            if (!dup) {
                q.run('INSERT INTO v2_note_people (id, note_id, person_name, person_email, institution) VALUES (?,?,?,?,?)', [uuid(), id, p.name, p.email, p.institution]);
                touch(id);
                audit(req, 'note.person.add', `${p.name}${p.institution ? ' (' + p.institution + ')' : ''} → ${firstLine(cur.title || cur.body)}`);
                persist();
            }
            res.json({ success: true, people: peopleList(id), note: shapeOne(id) });
        } catch (e) { fail(res, e, 'person add'); }
    });
    app.delete('/api/v2/notes/:id/people/:pid', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const pid = String(req.params.pid || '');
            const p = q.get('SELECT * FROM v2_note_people WHERE id = ? AND note_id = ?', [pid, id]);
            if (!p) return res.status(404).json({ error: 'That person is not on the note.' });
            q.run('DELETE FROM v2_note_people WHERE id = ?', [pid]);
            touch(id);
            audit(req, 'note.person.remove', p.person_name);
            persist();
            res.json({ success: true, people: peopleList(id), note: shapeOne(id) });
        } catch (e) { fail(res, e, 'person remove'); }
    });

    // ---- files ----
    app.get('/api/v2/notes/:id/files', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!noteRow(id)) return res.status(404).json({ error: 'That note is not here.' });
            res.json({ files: filesOf([id])[id] || [], storage: s3Ready() ? 's3' : 'local' });
        } catch (e) { fail(res, e, 'files'); }
    });
    app.post('/api/v2/notes/:id/files', auth, adminOnly, uploadParser, async (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = noteRow(id);
            if (!cur) return res.status(404).json({ error: 'That note is not here.' });
            const file = req.file;
            if (!file || !file.buffer || !file.buffer.length) return res.status(400).json({ error: 'Choose a file first — anything up to 25 MB.' });
            if (file.buffer.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'That file is over the 25 MB limit — share a link to it instead.' });
            const name = sanitizeFilename(file.originalname);
            const ext = extOf(name) || 'bin';
            const fid = uuid(); const stored = `${fid}.${ext}`;
            const mime = String(file.mimetype || 'application/octet-stream').slice(0, 120);
            let storedKey;
            if (s3Ready()) {
                const key = `notes/${id}/${stored}`;
                await s3().putObject(key, file.buffer, mime);   // S3 first — a DB row only for a stored file
                storedKey = 's3:' + key;
            } else {
                fs.mkdirSync(LOCAL_DIR, { recursive: true });
                storedKey = path.join(LOCAL_DIR, stored);
                fs.writeFileSync(storedKey, file.buffer);
            }
            q.run(`INSERT INTO v2_note_files (id, note_id, filename, original_name, stored_key, size, mime, uploaded_at) VALUES (?,?,?,?,?,?,?,?)`,
                [fid, id, stored, name, storedKey, file.buffer.length, mime, nowIso()]);
            touch(id);
            audit(req, 'note.file.upload', `${firstLine(cur.title || cur.body)}: ${name} (${file.buffer.length} bytes)`);
            persist();
            res.json({ success: true, file: shapeFile(q.get('SELECT * FROM v2_note_files WHERE id = ?', [fid])), files: filesOf([id])[id] || [] });
        } catch (e) { log('upload failed:', e.message); res.status(502).json({ error: 'The upload did not go through — try again.' }); }
    });
    app.get('/api/v2/notes/files/:fid', fileGate, (req, res) => {
        try {
            const f = q.get('SELECT * FROM v2_note_files WHERE id = ?', [String(req.params.fid || '')]);
            if (!f) return res.status(404).json({ error: 'That file is not here.' });
            const name = f.original_name || f.filename || 'file';
            const inline = String((req.query && req.query.inline) || '') === '1' && isImage(f.mime);   // thumbnails: images only
            const wantJson = String((req.query && req.query.json) || '') === '1';
            if (String(f.stored_key || '').startsWith('s3:')) {
                const S = s3();
                const url = S && S.presignGet ? S.presignGet(String(f.stored_key).slice(3), inline ? { expires: 900 } : { expires: 900, filename: name }) : null;
                if (!url) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
                if (wantJson) return res.json({ url, name });
                return res.redirect(302, url);
            }
            const local = f.stored_key && fs.existsSync(f.stored_key) ? f.stored_key : path.join(LOCAL_DIR, f.filename || '');
            if (!f.filename || !fs.existsSync(local)) return res.status(404).json({ error: 'That file is no longer on this server.' });
            if (wantJson) return res.json({ url: filePath(f.id), name });
            const safe = name.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_');
            res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
            res.setHeader('Content-Disposition', (inline ? 'inline' : 'attachment') + '; filename="' + safe + '"; filename*=UTF-8\'\'' + encodeURIComponent(name));
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.sendFile(local);
        } catch (e) { fail(res, e, 'download'); }
    });
    app.delete('/api/v2/notes/files/:fid', auth, adminOnly, (req, res) => {
        try {
            const f = q.get('SELECT * FROM v2_note_files WHERE id = ?', [String(req.params.fid || '')]);
            if (!f) return res.status(404).json({ error: 'That file is not here.' });
            q.run('DELETE FROM v2_note_files WHERE id = ?', [f.id]);
            if (f.stored_key && !String(f.stored_key).startsWith('s3:')) { try { fs.unlinkSync(f.stored_key); } catch (e) { /* already gone */ } }
            touch(f.note_id);
            audit(req, 'note.file.remove', f.original_name || f.id);
            persist();
            res.json({ success: true, files: filesOf([f.note_id])[f.note_id] || [] });
        } catch (e) { fail(res, e, 'file remove'); }
    });

    log('notes: /api/v2/notes{,/events,/people,/summary,/export,/export-link,/:id,/:id/pin,/:id/archive,/:id/people,/:id/files,/files/:fid} · files → ' + (s3Ready() ? 'S3 notes/' : LOCAL_DIR));
};

module.exports._internals = { cleanPeople, isYmd, isEventKey, slug, dayLabel, rangeLabel, SCOPES };
