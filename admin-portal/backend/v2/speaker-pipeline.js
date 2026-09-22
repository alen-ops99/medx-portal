/**
 * v2/speaker-pipeline.js — the SPEAKER PIPELINE (frontend-v2 › js/views/speaker-pipeline.js, under PEOPLE ▾).
 *
 * Why (Alen, 2026-09-22): "potential speakers for 2027 so we don't forget them — name, institution,
 * who they are, why relevant, potential event, contacted or not. I meet speakers at events, invite
 * them, and forget." A prospect is added in one line the moment he meets them, carries who they are
 * and why they matter, moves Idea → To contact → Contacted → In talks → Confirmed (or Declined /
 * Parked), and every touch — a call, an email, a note — is logged with a date. A confirmed prospect
 * is PROMOTED into the existing `speakers` table for a chosen conference (a button, never automatic).
 *
 * Tables (new, v2_ prefix; both portals share the database):
 *   v2_speaker_prospects     id · name · title · institution · country · email · linkedin_url · who (2–3 lines
 *                            who they are) · why (why relevant to us) · topics · target_event (key or free text:
 *                            plexus-2027 | gala-2027 | bridges-<city> | forum | accelerator | anything) ·
 *                            target_year (default 2027) · priority 1|2|3 · status idea|to_contact|contacted|
 *                            in_talks|confirmed|declined|parked · contacted_at · contacted_by · last_touch_at ·
 *                            next_step · next_step_due (YYYY-MM-DD) · met_at (the event/place Alen met them) ·
 *                            source · owner_id · owner_name · photo_url · notes · created_by · created_at ·
 *                            updated_at · archived_at · promoted_speaker_id · promoted_at
 *   v2_speaker_prospect_log  id · prospect_id · kind note|email|call|status · body · author_id · author_name · created_at
 *
 * Routes (all auth + adminOnly; /api/v2/speaker-pipeline is deliberately NOT in SECTION_ROUTE_MAP —
 * the pipeline is for the whole team, like TASKS and NOTES; NO emails are ever sent from here):
 *   GET    /api/v2/speaker-pipeline               ?status= &target_event= &year= &priority= &q= &mine=1 &archived=1 &sort=priority|last_touch
 *                                                 → { prospects, people, me, events }
 *   GET    /api/v2/speaker-pipeline/events        → { events: [{ key, label, kind, year }], conferences: [{ id, name, year }] }
 *   GET    /api/v2/speaker-pipeline/export.csv    same filters → text/csv (header + rows)
 *   GET    /api/v2/speaker-pipeline/:id           → { prospect, log }
 *   POST   /api/v2/speaker-pipeline               { name, …any column… }  (target_event defaults to plexus-2027, owner to the creator)
 *   PUT    /api/v2/speaker-pipeline/:id           { …any column… }  — a status change writes a 'status' log row and stamps
 *                                                 last_touch_at; reaching `contacted` (or beyond) stamps contacted_at/by once
 *   GET    /api/v2/speaker-pipeline/:id/log · POST { kind note|email|call, body? } — email/call stamp contacted_at (once) +
 *                                                 last_touch_at and lift an idea / to_contact prospect to `contacted`
 *   POST   /api/v2/speaker-pipeline/:id/archive · /unarchive
 *   POST   /api/v2/speaker-pipeline/:id/promote   { conference_id } → a `speakers` row (name, title, institution, bio=who,
 *                                                 email, linkedin_url, photo_url, year) — ONCE; only for a confirmed prospect
 * Every write appends an audit_log row (the shared activity trail), as tasks.js and notes.js do.
 */
'use strict';
const crypto = require('crypto');

const STATUSES = ['idea', 'to_contact', 'contacted', 'in_talks', 'confirmed', 'declined', 'parked'];
const STATUS_LABEL = { idea: 'Idea', to_contact: 'To contact', contacted: 'Contacted', in_talks: 'In talks', confirmed: 'Confirmed', declined: 'Declined', parked: 'Parked' };
const CONTACTED_STATUSES = ['contacted', 'in_talks', 'confirmed', 'declined'];   // reaching any of these means we have been in touch
const LOG_KINDS = ['note', 'email', 'call', 'status'];
const TOUCH_KINDS = ['email', 'call'];
const PRIORITIES = [1, 2, 3];
const DEFAULT_YEAR = 2027;
const DEFAULT_EVENT = 'plexus-2027';
const MAX_SHORT = 200, MAX_TEXT = 4000, MAX_NOTES = 8000, MAX_LOG = 4000, MAX_URL = 1000, MAX_Q = 120;
const TEXT_COLS = ['title', 'institution', 'country', 'email', 'linkedin_url', 'who', 'why', 'topics', 'target_event', 'next_step', 'met_at', 'source', 'photo_url', 'notes'];
const COL_MAX = { who: MAX_TEXT, why: MAX_TEXT, topics: MAX_TEXT, notes: MAX_NOTES, next_step: MAX_TEXT, linkedin_url: MAX_URL, photo_url: MAX_URL };
const CSV_COLS = ['name', 'title', 'institution', 'country', 'email', 'linkedin_url', 'who', 'why', 'topics', 'target_event', 'target_year', 'priority', 'status', 'contacted_at', 'contacted_by', 'last_touch_at', 'next_step', 'next_step_due', 'met_at', 'source', 'owner_name', 'notes', 'created_at', 'updated_at', 'archived_at'];

const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(String(s) + 'T00:00:00Z').getTime());
const cleanStr = (v, max) => (v === undefined ? undefined : String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max));
const firstOf = n => String(n || '').trim().split(/\s+/)[0] || '';
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const titleCase = s => String(s || '').split(/[-\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
// the human label of a target-event key: the picker's label, else the built-in shapes (plexus-<year>,
// gala-<year>, bridges-<city>, forum, accelerator), else the free text itself
const BUILTIN_LABEL = { forum: 'Biomedical Forum', accelerator: 'Accelerator' };
function eventLabel(key, known) {
    const k = String(key || '').trim(); if (!k) return '';
    const hit = (known || []).find(e => e.key === k); if (hit) return hit.label;
    if (BUILTIN_LABEL[k]) return BUILTIN_LABEL[k];
    let m = /^plexus-(\d{4})$/i.exec(k); if (m) return 'Plexus ' + m[1];
    m = /^gala-(\d{4})$/i.exec(k); if (m) return 'Gala ' + m[1];
    m = /^bridges-(.+)$/i.exec(k); if (m) return 'Building Bridges — ' + titleCase(m[1]);
    return k;
}

module.exports = function mountSpeakerPipeline(app, ctx) {
    const { auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/speaker-pipeline]', ...a));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const nowIso = () => new Date().toISOString();
    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    const persist = () => { try { saveDb && saveDb(); } catch (e) { /* periodic save still runs */ } };
    const fail = (res, e, what) => { console.error('[v2/speaker-pipeline] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    const hasTable = name => { try { return !!q.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]); } catch (e) { return false; } };
    const columnsOf = table => { try { return q.all(`PRAGMA table_info(${table})`).map(r => r.name); } catch (e) { return []; } };
    function audit(req, action, detail) {
        try {
            q.run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [uuid(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 300)]);
        } catch (e) { /* best-effort */ }
    }

    // ---- schema (new tables only — nothing of server.js's is touched) ----
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_speaker_prospects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            title TEXT,
            institution TEXT,
            country TEXT,
            email TEXT,
            linkedin_url TEXT,
            who TEXT,
            why TEXT,
            topics TEXT,
            target_event TEXT,
            target_year INTEGER DEFAULT ${DEFAULT_YEAR},
            priority INTEGER DEFAULT 2,
            status TEXT NOT NULL DEFAULT 'idea',
            contacted_at TEXT,
            contacted_by TEXT,
            last_touch_at TEXT,
            next_step TEXT,
            next_step_due TEXT,
            met_at TEXT,
            source TEXT,
            owner_id TEXT,
            owner_name TEXT,
            photo_url TEXT,
            notes TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            archived_at TEXT,
            promoted_speaker_id TEXT,
            promoted_at TEXT
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_speaker_prospects_status ON v2_speaker_prospects (status, priority)');
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_speaker_prospects_event ON v2_speaker_prospects (target_event, target_year)');
        q.run(`CREATE TABLE IF NOT EXISTS v2_speaker_prospect_log (
            id TEXT PRIMARY KEY,
            prospect_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'note',
            body TEXT,
            author_id TEXT,
            author_name TEXT,
            created_at TEXT NOT NULL
        )`);
        q.run('CREATE INDEX IF NOT EXISTS idx_v2_speaker_prospect_log_prospect ON v2_speaker_prospect_log (prospect_id, created_at)');
    } catch (e) { log('speaker-pipeline schema failed:', e.message); }

    // ---- who is acting ----
    function nameOfUser(u) { return [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.email || '').split('@')[0] || 'Someone'; }
    function actorOf(req) {
        const u = req.user || {};
        const row = q.get('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [u.id]) || {};
        const name = nameOfUser(Object.assign({ email: u.email }, row));
        return { id: u.id || null, email: row.email || u.email || null, name, first: firstOf(name) };
    }
    // the team who can own a prospect — every admin account
    function people() {
        try {
            return q.all('SELECT id, email, first_name, last_name, is_founder FROM users WHERE is_admin = 1 ORDER BY first_name, last_name, email')
                .map(u => ({ id: u.id, name: nameOfUser(u), first: firstOf(nameOfUser(u)), email: u.email || null, is_founder: !!Number(u.is_founder || 0) }));
        } catch (e) { return []; }
    }
    function ownerById(id) { const p = people().find(x => x.id === id); return p || null; }

    // ---- the target-event picker ----
    // Plexus 2027 · Gala 2027 · Building Bridges per city (bridges_events) · Forum · Accelerator, plus any
    // free-text target already in use (a "Coffee with the Dean" event keeps its door).
    function knownEvents() {
        const out = []; const seen = new Set();
        const add = e => { if (e && e.key && !seen.has(e.key)) { seen.add(e.key); out.push(e); } };
        add({ key: 'plexus-2027', label: 'Plexus 2027', kind: 'plexus', year: 2027 });
        add({ key: 'gala-2027', label: 'Gala 2027', kind: 'gala', year: 2027 });
        try {
            const cities = new Map();
            q.all(`SELECT city, MAX(event_date) AS last FROM bridges_events WHERE COALESCE(status, '') <> 'cancelled' AND city IS NOT NULL AND TRIM(city) <> '' GROUP BY city ORDER BY last DESC`)
                .forEach(r => { const c = String(r.city).trim(); const k = 'bridges-' + slug(c); if (k !== 'bridges-' && !cities.has(k)) cities.set(k, c); });
            cities.forEach((c, k) => add({ key: k, label: 'Building Bridges — ' + c, kind: 'bridges', city: c, year: null }));
        } catch (e) { /* table absent on a bare DB */ }
        add({ key: 'forum', label: 'Biomedical Forum', kind: 'forum', year: null });
        add({ key: 'accelerator', label: 'Accelerator', kind: 'accelerator', year: null });
        try {
            q.all(`SELECT target_event AS k, COUNT(*) AS c FROM v2_speaker_prospects WHERE target_event IS NOT NULL AND TRIM(target_event) <> '' GROUP BY target_event ORDER BY c DESC`)
                .forEach(r => { const k = String(r.k).trim(); if (!seen.has(k)) add({ key: k, label: eventLabel(k, out), kind: /^bridges-/.test(k) ? 'bridges' : 'custom', year: null, from_use: true }); });
        } catch (e) { /* fresh DB */ }
        return out;
    }
    function conferences() {
        try { return q.all('SELECT id, name, year, start_date FROM conferences ORDER BY COALESCE(year, 0) DESC, start_date DESC').map(r => ({ id: r.id, name: r.name, year: r.year == null ? null : Number(r.year) })); }
        catch (e) { return []; }
    }

    // ---- rows ----
    function shape(r) {
        return {
            id: r.id, name: r.name || '', title: r.title || '', institution: r.institution || '', country: r.country || '',
            email: r.email || '', linkedin_url: r.linkedin_url || '', who: r.who || '', why: r.why || '', topics: r.topics || '',
            target_event: r.target_event || '', target_event_label: eventLabel(r.target_event, null), target_year: r.target_year == null ? DEFAULT_YEAR : Number(r.target_year),
            priority: PRIORITIES.includes(Number(r.priority)) ? Number(r.priority) : 2, status: STATUSES.includes(r.status) ? r.status : 'idea',
            contacted_at: r.contacted_at || null, contacted_by: r.contacted_by || null, last_touch_at: r.last_touch_at || null,
            next_step: r.next_step || '', next_step_due: r.next_step_due && isYmd(String(r.next_step_due).slice(0, 10)) ? String(r.next_step_due).slice(0, 10) : null,
            met_at: r.met_at || '', source: r.source || '', owner_id: r.owner_id || null, owner_name: r.owner_name || null, owner_first: firstOf(r.owner_name) || null,
            photo_url: r.photo_url || '', notes: r.notes || '', created_by: r.created_by || null, created_at: r.created_at || null, updated_at: r.updated_at || r.created_at || null,
            archived_at: r.archived_at || null, promoted_speaker_id: r.promoted_speaker_id || null, promoted_at: r.promoted_at || null,
            log_count: Number(r.log_count || 0)
        };
    }
    const BASE_SELECT = `SELECT p.*, (SELECT COUNT(*) FROM v2_speaker_prospect_log l WHERE l.prospect_id = p.id AND l.kind <> 'status') AS log_count FROM v2_speaker_prospects p`;
    const row = id => q.get(BASE_SELECT + ' WHERE p.id = ?', [id]);
    const logOf = id => q.all('SELECT id, prospect_id, kind, body, author_id, author_name, created_at FROM v2_speaker_prospect_log WHERE prospect_id = ? ORDER BY created_at, rowid', [id]);
    function addLog(prospectId, actor, kind, body) {
        q.run('INSERT INTO v2_speaker_prospect_log (id, prospect_id, kind, body, author_id, author_name, created_at) VALUES (?,?,?,?,?,?,?)',
            [uuid(), prospectId, kind, body == null ? null : String(body).slice(0, MAX_LOG), actor.id || null, actor.name, nowIso()]);
    }

    // list filters → { where, vals } (shared by the list and the CSV)
    function filters(query, me) {
        const where = []; const vals = [];
        where.push(String(query.archived || '') === '1' ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL');
        const status = String(query.status || '').trim().toLowerCase();
        if (status) { const list = status.split(',').map(s => s.trim()).filter(s => STATUSES.includes(s)); if (list.length) { where.push(`p.status IN (${list.map(() => '?').join(',')})`); vals.push(...list); } }
        const ev = String(query.target_event || query.event || '').trim();
        if (ev) { where.push('p.target_event = ?'); vals.push(ev); }
        const year = String(query.year || query.target_year || '').trim();
        if (/^\d{4}$/.test(year)) { where.push('p.target_year = ?'); vals.push(Number(year)); }
        const pr = String(query.priority || '').trim();
        if (pr) { const list = pr.split(',').map(Number).filter(n => PRIORITIES.includes(n)); if (list.length) { where.push(`p.priority IN (${list.map(() => '?').join(',')})`); vals.push(...list); } }
        if (String(query.mine || '') === '1') { where.push('(p.owner_id = ? OR (p.owner_id IS NULL AND p.created_by = ?))'); vals.push(me.id || '', me.id || ''); }
        const qs = String(query.q || '').trim().slice(0, MAX_Q);
        for (const tok of qs.split(/\s+/).filter(Boolean).slice(0, 6)) {
            const like = '%' + tok.replace(/[%_]/g, c => '\\' + c) + '%';
            where.push(`(p.name LIKE ? ESCAPE '\\' OR p.institution LIKE ? ESCAPE '\\' OR p.who LIKE ? ESCAPE '\\' OR p.why LIKE ? ESCAPE '\\' OR p.topics LIKE ? ESCAPE '\\' OR p.notes LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\' OR p.met_at LIKE ? ESCAPE '\\')`);
            vals.push(like, like, like, like, like, like, like, like);
        }
        return { where, vals };
    }
    function orderBy(sort) {
        const touch = 'COALESCE(p.last_touch_at, p.updated_at, p.created_at)';
        if (String(sort || '') === 'last_touch') return `ORDER BY ${touch} DESC, p.priority ASC`;
        return `ORDER BY p.priority ASC, ${touch} DESC`;
    }
    function list(query, me) {
        const f = filters(query, me);
        return q.all(`${BASE_SELECT} WHERE ${f.where.join(' AND ')} ${orderBy(query.sort)}`, f.vals).map(shape);
    }

    // one body → { sets, vals, notes } for create/update; returns { error } on bad input
    function readPatch(b, cur) {
        const out = {}; const notes = [];
        const set = (k, v) => { out[k] = v; };
        if (b.name !== undefined) { const n = cleanStr(b.name, MAX_SHORT); if (!n) return { error: 'Give the speaker a name.' }; if (!cur || n !== (cur.name || '')) { set('name', n); if (cur) notes.push(`renamed to ${n}`); } }
        for (const k of TEXT_COLS) {
            if (b[k] === undefined) continue;
            let v = cleanStr(b[k], COL_MAX[k] || MAX_SHORT) || null;
            if (k === 'email' && v && !isEmail(v)) return { error: 'That email address does not look right.' };
            if (k === 'email' && v) v = v.toLowerCase();
            if ((k === 'linkedin_url' || k === 'photo_url') && v && !/^https?:\/\/\S+$/i.test(v)) { if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) v = 'https://' + v; else return { error: 'Links start with https://.' }; }
            if (!cur || (v || '') !== String(cur[k] || '')) set(k, v);
        }
        if (b.target_year !== undefined) {
            const y = b.target_year === null || b.target_year === '' ? DEFAULT_YEAR : Number(b.target_year);
            if (!Number.isInteger(y) || y < 2000 || y > 2100) return { error: 'The year must be a four-digit year.' };
            if (!cur || y !== Number(cur.target_year == null ? DEFAULT_YEAR : cur.target_year)) set('target_year', y);
        }
        if (b.priority !== undefined) {
            const p = b.priority === null || b.priority === '' ? 2 : Number(b.priority);
            if (!PRIORITIES.includes(p)) return { error: 'Priority is 1, 2 or 3.' };
            if (!cur || p !== Number(cur.priority || 2)) { set('priority', p); if (cur) notes.push(`priority ${p}`); }
        }
        if (b.next_step_due !== undefined) {
            const d = b.next_step_due == null || b.next_step_due === '' ? null : String(b.next_step_due).slice(0, 10);
            if (d && !isYmd(d)) return { error: 'The date must be YYYY-MM-DD.' };
            if (!cur || (d || '') !== String(cur.next_step_due || '').slice(0, 10)) set('next_step_due', d);
        }
        if (b.owner_id !== undefined) {
            const id = String(b.owner_id == null ? '' : b.owner_id).trim();
            const o = id ? ownerById(id) : null;
            if (id && !o) return { error: 'That person is not on the team.' };
            if (!cur || (id || null) !== (cur.owner_id || null)) { set('owner_id', id || null); set('owner_name', o ? o.name : null); if (cur) notes.push(o ? `owner → ${o.first}` : 'owner cleared'); }
        }
        if (b.status !== undefined) {
            const s = String(b.status || '').trim().toLowerCase();
            if (!STATUSES.includes(s)) return { error: 'Status is idea, to_contact, contacted, in_talks, confirmed, declined or parked.' };
            if (!cur || s !== cur.status) set('status', s);
        }
        return { patch: out, notes };
    }

    // ---- core writes ----
    function create(req, b) {
        const actor = actorOf(req);
        const r = readPatch(Object.assign({ name: b.name }, b), null);
        if (r.error) return { status: 400, body: { error: r.error } };
        const p = r.patch;
        if (!p.name) return { status: 400, body: { error: 'Give the speaker a name.' } };
        const id = uuid(); const now = nowIso();
        const status = p.status || 'idea';
        const owner = p.owner_id !== undefined ? { id: p.owner_id, name: p.owner_name } : { id: actor.id, name: actor.name };
        const contacted = CONTACTED_STATUSES.includes(status);
        q.run(`INSERT INTO v2_speaker_prospects (id, name, title, institution, country, email, linkedin_url, who, why, topics, target_event, target_year, priority, status,
                contacted_at, contacted_by, last_touch_at, next_step, next_step_due, met_at, source, owner_id, owner_name, photo_url, notes, created_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, p.name, p.title || null, p.institution || null, p.country || null, p.email || null, p.linkedin_url || null, p.who || null, p.why || null, p.topics || null,
                p.target_event === undefined ? DEFAULT_EVENT : p.target_event, p.target_year === undefined ? DEFAULT_YEAR : p.target_year, p.priority === undefined ? 2 : p.priority, status,
                contacted ? now : null, contacted ? actor.name : null, now, p.next_step || null, p.next_step_due || null, p.met_at || null, p.source || null,
                owner.id || null, owner.name || null, p.photo_url || null, p.notes || null, actor.id || null, now, now]);
        addLog(id, actor, 'status', `${actor.first} added ${p.name} as ${STATUS_LABEL[status]}${p.met_at ? ' — met at ' + p.met_at : ''}`);
        audit(req, 'speaker.create', `${p.name}${p.institution ? ' (' + p.institution + ')' : ''} → ${STATUS_LABEL[status]}`);
        persist();
        return { status: 200, body: { success: true, id, prospect: shape(row(id)) } };
    }
    function update(req, id, b) {
        const actor = actorOf(req);
        const cur = row(id);
        if (!cur) return { status: 404, body: { error: 'That speaker is not in the pipeline.' } };
        const r = readPatch(b, cur);
        if (r.error) return { status: 400, body: { error: r.error } };
        const p = r.patch; const keys = Object.keys(p);
        if (!keys.length) return { status: 200, body: { success: true, prospect: shape(cur), unchanged: true } };
        const now = nowIso();
        const sets = keys.map(k => `${k} = ?`); const vals = keys.map(k => p[k]);
        let statusNote = null;
        if (p.status) {
            statusNote = `${actor.first} moved ${cur.name} to ${STATUS_LABEL[p.status]}`;
            sets.push('last_touch_at = ?'); vals.push(now);
            if (CONTACTED_STATUSES.includes(p.status) && !cur.contacted_at) { sets.push('contacted_at = ?', 'contacted_by = ?'); vals.push(now, actor.name); }
        }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        q.run(`UPDATE v2_speaker_prospects SET ${sets.join(', ')} WHERE id = ?`, vals);
        if (statusNote) addLog(id, actor, 'status', statusNote);
        audit(req, p.status ? 'speaker.status' : 'speaker.update', `${cur.name}: ${(statusNote ? [STATUS_LABEL[p.status]] : []).concat(r.notes, keys.filter(k => k !== 'status' && k !== 'owner_name')).join(' · ')}`);
        persist();
        return { status: 200, body: { success: true, prospect: shape(row(id)) } };
    }

    // ================================================================ reads
    app.get('/api/v2/speaker-pipeline/events', auth, adminOnly, (req, res) => {
        try { res.json({ events: knownEvents(), conferences: conferences(), default_event: DEFAULT_EVENT, default_year: DEFAULT_YEAR }); } catch (e) { fail(res, e, 'events'); }
    });
    app.get('/api/v2/speaker-pipeline/export.csv', auth, adminOnly, (req, res) => {
        try {
            const me = actorOf(req);
            const rows = list(req.query || {}, me);
            const lines = [CSV_COLS.join(',')];
            rows.forEach(r => lines.push(CSV_COLS.map(c => csvCell(c === 'target_event' ? (r.target_event_label || r.target_event) : r[c])).join(',')));
            audit(req, 'speaker.export', `${rows.length} row(s)`);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="speaker-pipeline-${nowIso().slice(0, 10)}.csv"`);
            res.setHeader('Cache-Control', 'private, no-store');
            res.send('\ufeff' + lines.join('\r\n') + '\r\n');
        } catch (e) { fail(res, e, 'export'); }
    });
    app.get('/api/v2/speaker-pipeline', auth, adminOnly, (req, res) => {
        try {
            const me = actorOf(req);
            res.json({ prospects: list(req.query || {}, me), people: people(), me: { id: me.id, name: me.name, first: me.first, email: me.email }, events: knownEvents() });
        } catch (e) { fail(res, e, 'list'); }
    });
    app.get('/api/v2/speaker-pipeline/:id', auth, adminOnly, (req, res) => {
        try {
            const r = row(String(req.params.id || ''));
            if (!r) return res.status(404).json({ error: 'That speaker is not in the pipeline.' });
            res.json({ prospect: shape(r), log: logOf(r.id) });
        } catch (e) { fail(res, e, 'detail'); }
    });
    app.get('/api/v2/speaker-pipeline/:id/log', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!q.get('SELECT id FROM v2_speaker_prospects WHERE id = ?', [id])) return res.status(404).json({ error: 'That speaker is not in the pipeline.' });
            res.json({ log: logOf(id) });
        } catch (e) { fail(res, e, 'log'); }
    });

    // ================================================================ writes
    app.post('/api/v2/speaker-pipeline', auth, adminOnly, (req, res) => {
        try { const r = create(req, req.body || {}); res.status(r.status).json(r.body); } catch (e) { fail(res, e, 'create'); }
    });
    app.put('/api/v2/speaker-pipeline/:id', auth, adminOnly, (req, res) => {
        try { const r = update(req, String(req.params.id || ''), req.body || {}); res.status(r.status).json(r.body); } catch (e) { fail(res, e, 'update'); }
    });
    app.post('/api/v2/speaker-pipeline/:id/log', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = row(id);
            if (!cur) return res.status(404).json({ error: 'That speaker is not in the pipeline.' });
            const b = req.body || {}; const actor = actorOf(req);
            const kind = String(b.kind || 'note').trim().toLowerCase();
            if (!LOG_KINDS.includes(kind) || kind === 'status') return res.status(400).json({ error: 'A log entry is a note, an email or a call.' });
            const body = cleanStr(b.body, MAX_LOG) || null;
            if (kind === 'note' && !body) return res.status(400).json({ error: 'Write the note first.' });
            const now = nowIso();
            addLog(id, actor, kind, body || (kind === 'email' ? `${actor.first} emailed ${cur.name}` : `${actor.first} called ${cur.name}`));
            const sets = ['last_touch_at = ?', 'updated_at = ?']; const vals = [now, now];
            let lifted = null;
            if (TOUCH_KINDS.includes(kind)) {
                if (!cur.contacted_at) { sets.push('contacted_at = ?', 'contacted_by = ?'); vals.push(now, actor.name); }
                // an email or a call IS contact: an idea / to-contact prospect moves to Contacted
                if (cur.status === 'idea' || cur.status === 'to_contact') { sets.push('status = ?'); vals.push('contacted'); lifted = 'contacted'; }
            }
            vals.push(id);
            q.run(`UPDATE v2_speaker_prospects SET ${sets.join(', ')} WHERE id = ?`, vals);
            if (lifted) addLog(id, actor, 'status', `${actor.first} moved ${cur.name} to ${STATUS_LABEL[lifted]}`);
            audit(req, 'speaker.log', `${cur.name}: ${kind}${body ? ' — ' + body.slice(0, 120) : ''}${lifted ? ' → Contacted' : ''}`);
            persist();
            res.json({ success: true, prospect: shape(row(id)), log: logOf(id) });
        } catch (e) { fail(res, e, 'log add'); }
    });
    function setArchived(req, res, on) {
        const id = String(req.params.id || ''); const cur = row(id);
        if (!cur) return res.status(404).json({ error: 'That speaker is not in the pipeline.' });
        const actor = actorOf(req);
        if (!!cur.archived_at === on) return res.json({ success: true, prospect: shape(cur), unchanged: true });
        q.run('UPDATE v2_speaker_prospects SET archived_at = ?, updated_at = ? WHERE id = ?', [on ? nowIso() : null, nowIso(), id]);
        addLog(id, actor, 'status', on ? `${actor.first} archived ${cur.name}` : `${actor.first} brought ${cur.name} back`);
        audit(req, on ? 'speaker.archive' : 'speaker.unarchive', cur.name);
        persist();
        res.json({ success: true, prospect: shape(row(id)) });
    }
    app.post('/api/v2/speaker-pipeline/:id/archive', auth, adminOnly, (req, res) => { try { setArchived(req, res, true); } catch (e) { fail(res, e, 'archive'); } });
    app.post('/api/v2/speaker-pipeline/:id/unarchive', auth, adminOnly, (req, res) => { try { setArchived(req, res, false); } catch (e) { fail(res, e, 'unarchive'); } });

    // PROMOTE — a confirmed prospect becomes a row in the legacy `speakers` table for one conference.
    // Never automatic (the button offers it once the status is Confirmed); never twice (the prospect
    // remembers the speaker row it produced, and an identical name already on that conference is reused).
    app.post('/api/v2/speaker-pipeline/:id/promote', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || ''); const cur = row(id);
            if (!cur) return res.status(404).json({ error: 'That speaker is not in the pipeline.' });
            if (cur.status !== 'confirmed') return res.status(400).json({ error: 'Confirm the speaker first — promote is for confirmed speakers.' });
            if (!hasTable('speakers')) return res.status(503).json({ error: 'The speakers table is not on this server.' });
            const confId = String((req.body || {}).conference_id || '').trim();
            if (!confId) return res.status(400).json({ error: 'Pick the conference.' });
            const conf = hasTable('conferences') ? q.get('SELECT id, name, year FROM conferences WHERE id = ?', [confId]) : null;
            if (!conf) return res.status(400).json({ error: 'That conference is not here.' });
            const actor = actorOf(req);
            if (cur.promoted_speaker_id && q.get('SELECT id FROM speakers WHERE id = ?', [cur.promoted_speaker_id])) {
                return res.json({ success: true, speaker_id: cur.promoted_speaker_id, already: true, prospect: shape(cur) });
            }
            const cols = columnsOf('speakers');
            const dup = q.get('SELECT id FROM speakers WHERE conference_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))', [conf.id, cur.name]);
            let speakerId = dup ? dup.id : null;
            if (!speakerId) {
                speakerId = uuid();
                const values = {
                    id: speakerId, conference_id: conf.id, name: cur.name, title: cur.title || null, institution: cur.institution || null,
                    bio: cur.who || null, email: cur.email || null, linkedin_url: cur.linkedin_url || null, photo_url: cur.photo_url || null,
                    year: conf.year != null ? Number(conf.year) : (cur.target_year == null ? DEFAULT_YEAR : Number(cur.target_year)),
                    speaker_type: 'invited', is_confirmed: 1, confirmation_status: 'confirmed', notes: cur.why ? 'Why relevant: ' + cur.why : null
                };
                const use = Object.keys(values).filter(k => cols.includes(k));
                q.run(`INSERT INTO speakers (${use.join(', ')}) VALUES (${use.map(() => '?').join(',')})`, use.map(k => values[k]));
            }
            const now = nowIso();
            q.run('UPDATE v2_speaker_prospects SET promoted_speaker_id = ?, promoted_at = ?, last_touch_at = ?, updated_at = ? WHERE id = ?', [speakerId, now, now, now, id]);
            addLog(id, actor, 'status', `${actor.first} promoted ${cur.name} to the speakers of ${conf.name}${dup ? ' (already listed there — reused)' : ''}`);
            audit(req, 'speaker.promote', `${cur.name} → ${conf.name} (${speakerId})`);
            persist();
            res.json({ success: true, speaker_id: speakerId, reused: !!dup, conference: { id: conf.id, name: conf.name, year: conf.year }, prospect: shape(row(id)) });
        } catch (e) { fail(res, e, 'promote'); }
    });

    log('speaker-pipeline: /api/v2/speaker-pipeline{,/events,/export.csv,/:id,/:id/log,/:id/archive,/:id/unarchive,/:id/promote}');
};

module.exports._internals = { STATUSES, STATUS_LABEL, CONTACTED_STATUSES, LOG_KINDS, PRIORITIES, DEFAULT_EVENT, DEFAULT_YEAR, CSV_COLS, eventLabel, csvCell, isYmd };
