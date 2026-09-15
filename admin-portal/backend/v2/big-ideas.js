/**
 * v2/big-ideas.js — BIG IDEAS, the long-game book.
 *
 * The owner's brief, verbatim in intent: "Our organization should evolve beyond Plexus and
 * Building Bridges to facilitate concrete long-term projects — e.g. forming a PhD programme
 * between Yale and a Croatian university. We meet people interested in these big ideas that
 * won't happen overnight. I need somewhere in the admin to keep all of these in one place —
 * with whom we talked, what institution they are at, what the idea is in detail — so we can
 * find it easily (especially before meetings with Croatian ministries) and never forget.
 * It cannot be buried."
 *
 * So: one idea = one row, with the people we spoke to, the institutions behind them, a dated
 * log of every meeting and call, one next step with a date, and the files. Two printables carry
 * it out of the screen — a single idea's one-pager, and the whole active portfolio as a briefing
 * to read on the way into a ministry.
 *
 *   GET    /api/v2/big-ideas                      the list — filters: status, area, country,
 *                                                 person, q (title · thesis · description · log
 *                                                 summaries · people names · institutions),
 *                                                 archived=1 to include the archived
 *   POST   /api/v2/big-ideas                      create
 *   GET    /api/v2/big-ideas/due?days=N           next steps due (or overdue) — the Today card
 *   GET    /api/v2/big-ideas/portfolio            the ministry briefing (printable HTML)
 *   GET    /api/v2/big-ideas/export.csv           the list as a spreadsheet
 *   GET    /api/v2/big-ideas/people/search?q=     People-module search → a person_ref to attach
 *   GET    /api/v2/big-ideas/:id                  everything: idea · people · institutions · log · files
 *   PUT    /api/v2/big-ideas/:id                  edit any field
 *   DELETE /api/v2/big-ideas/:id                  archive (?hard=1 deletes, with its children)
 *   GET    /api/v2/big-ideas/:id/one-pager        the printable sheet
 *   POST   /api/v2/big-ideas/:id/people           attach — an existing person by ref, or free text
 *   PUT    /api/v2/big-ideas/people/:pid          edit one attached person
 *   DELETE /api/v2/big-ideas/people/:pid          detach
 *   POST   /api/v2/big-ideas/:id/institutions     add an institution
 *   PUT    /api/v2/big-ideas/institutions/:iid    edit
 *   DELETE /api/v2/big-ideas/institutions/:iid    remove
 *   POST   /api/v2/big-ideas/:id/log              a dated entry: meeting · call · email · note ·
 *                                                 milestone · decision
 *   PUT    /api/v2/big-ideas/log/:lid             edit an entry
 *   DELETE /api/v2/big-ideas/log/:lid             remove an entry
 *   POST   /api/v2/big-ideas/:id/files            multipart → S3 (pdf/docx/pptx/xlsx/png/jpg ≤20MB)
 *   GET    /api/v2/big-ideas/files/:fid           302 → a 15-minute presigned S3 GET
 *                                                 (?json=1 → { url, name } for a Bearer-authed SPA)
 *   DELETE /api/v2/big-ideas/files/:fid           delete the row (the object stays in the bucket)
 *
 * PERMISSION: every route sits under /api/v2/big-ideas, mapped to the section id `big-ideas` in
 * server.js SECTION_ROUTE_MAP. Admins with full access (allowed_sections NULL) — which is every
 * admin on the team today — have it automatically; a scoped admin (an explicit section list)
 * needs `big-ideas` granted in Settings → Team Access.
 *
 * NOTHING SENDS ITSELF. This module never puts an email on the wire: it is a book, not a campaign.
 * Every write is audited into audit_log and persisted with saveDb() + db().sync().
 *
 * Files live in the SAME private S3 bucket the Boston wing owns (BB_S3_*), under
 * big-ideas/<idea id>/, signed by the SAME SigV4 helper and vetted by the same magic-byte rule —
 * one signer, one bucket, no second quietly diverging copy.
 */
'use strict';

const crypto = require('crypto');

const AREAS = ['Education & training', 'Research collaboration', 'Clinical', 'Policy', 'Funding', 'Infrastructure', 'Other'];
const STATUSES = ['idea', 'exploring', 'in-talks', 'agreed', 'running', 'parked', 'dropped'];
const LIVE_STATUSES = ['idea', 'exploring', 'in-talks', 'agreed', 'running'];      // the portfolio's "active"
const LOG_KINDS = ['meeting', 'call', 'email', 'note', 'milestone', 'decision'];
const INSTITUTION_KINDS = ['university', 'hospital', 'ministry', 'company', 'NGO', 'other'];
const RELATIONSHIPS = ['champion', 'decision-maker', 'advisor', 'contact'];
const STATUS_LABELS = {
    'idea': 'Idea', 'exploring': 'Exploring', 'in-talks': 'In talks', 'agreed': 'Agreed',
    'running': 'Running', 'parked': 'Parked', 'dropped': 'Dropped'
};
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FILE_TYPES = {                                   // accepted extension → stored Content-Type
    pdf:  { mime: 'application/pdf' },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    png:  { mime: 'image/png' },
    jpg:  { mime: 'image/jpeg' },
    jpeg: { mime: 'image/jpeg' }
};

// ---------------------------------------------------------------- pure helpers (also the test seam)
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 4000);
const nowIso = () => new Date().toISOString();
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();
const ymd = (v) => { const s = String(v == null ? '' : v).trim(); const m = /^(\d{4}-\d{2}-\d{2})/.exec(s); return m ? m[1] : ''; };
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
const priorityOf = (v) => { const n = Math.round(Number(v)); return (n === 1 || n === 2 || n === 3) ? n : 2; };
// JSON list column ← an array, a comma-separated string, or nothing. Always stored as a JSON array.
function jsonList(v) {
    if (v == null || v === '') return '[]';
    let arr = Array.isArray(v) ? v : String(v).split(',');
    arr = arr.map(x => clean(x, 120)).filter(Boolean);
    const seen = new Set(); const out = [];
    for (const x of arr) { const k = lower(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
    return JSON.stringify(out.slice(0, 40));
}
function parseList(v) { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } }
// Whole days from today to a date. Negative = overdue. null when there is no date.
function daysUntil(dateStr, now) {
    const d = ymd(dateStr); if (!d) return null;
    const t = new Date((now ? ymd(now) : ymd(nowIso())) + 'T00:00:00Z').getTime();
    const x = new Date(d + 'T00:00:00Z').getTime();
    if (!isFinite(t) || !isFinite(x)) return null;
    return Math.round((x - t) / 86400000);
}
// Magic-byte check — the extension must match what the bytes actually are. Same discipline as the
// Boston wing's (a renamed .exe never reaches the bucket); the office formats are zip containers.
function magicOk(ext, buf) {
    if (!buf || buf.length < 8) return false;
    const starts = sig => sig.every((b, i) => buf[i] === b);
    if (ext === 'pdf') return buf.slice(0, 1024).includes('%PDF');        // the spec allows a short preamble
    if (ext === 'png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (ext === 'jpg' || ext === 'jpeg') return starts([0xff, 0xd8, 0xff]);
    return starts([0x50, 0x4b, 0x03, 0x04]);                              // docx / pptx / xlsx
}
const sanitizeFilename = n => String(n || 'file').replace(/[\/\\]/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 180) || 'file';
const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
// CSV: UTF-8 BOM upstream, every field quoted — the same rule the other exports use.
const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
const csvRow = arr => arr.map(csvCell).join(',') + '\r\n';

const BIG_IDEAS_DDL = [
    `CREATE TABLE IF NOT EXISTS big_ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  thesis TEXT,
  description TEXT,
  area TEXT,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','exploring','in-talks','agreed','running','parked','dropped')),
  croatian_side TEXT,
  international_side TEXT,
  countries TEXT,
  tags TEXT,
  owner_user_id TEXT,
  next_step TEXT,
  next_step_due TEXT,
  priority INTEGER DEFAULT 2,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  archived_at TEXT
)`,
    `CREATE TABLE IF NOT EXISTS big_idea_people (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  person_ref TEXT,
  name TEXT NOT NULL,
  institution TEXT,
  role TEXT,
  email TEXT,
  relationship TEXT,
  our_owner_user_id TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
    `CREATE TABLE IF NOT EXISTS big_idea_institutions (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  kind TEXT,
  website TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
    `CREATE TABLE IF NOT EXISTS big_idea_log (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  at TEXT,
  kind TEXT,
  summary TEXT,
  detail TEXT,
  by_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
    `CREATE TABLE IF NOT EXISTS big_idea_files (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL,
  original_name TEXT,
  stored_key TEXT,
  size INTEGER,
  mime TEXT,
  uploaded_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
    'CREATE INDEX IF NOT EXISTS idx_big_ideas_status ON big_ideas (status)',
    'CREATE INDEX IF NOT EXISTS idx_big_idea_people_idea ON big_idea_people (idea_id)',
    'CREATE INDEX IF NOT EXISTS idx_big_idea_institutions_idea ON big_idea_institutions (idea_id)',
    'CREATE INDEX IF NOT EXISTS idx_big_idea_log_idea ON big_idea_log (idea_id)',
    'CREATE INDEX IF NOT EXISTS idx_big_idea_files_idea ON big_idea_files (idea_id)'
];

module.exports = function mountBigIdeas(app, ctx) {
    const { db, auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/big-ideas]', ...a));

    // ---------------------------------------------------------------- query bag
    function getRow(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    function getAll(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    const q = {
        run: (s, p) => db().run(s, p),
        get: (s, p) => { try { return getRow(s, p); } catch (e) { return null; } },
        all: (s, p) => { try { return getAll(s, p); } catch (e) { return []; } }
    };
    function persist() { try { saveDb(); } catch (e) {} try { db().sync(); } catch (e) {} }
    function auditAdmin(req, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail, created_at) VALUES (?,?,?,?,?,?)',
                [crypto.randomUUID(), (req && req.user && req.user.id) || null, (req && req.user && req.user.email) || 'system',
                 action, String(detail || '').slice(0, 500), nowIso()]);
        } catch (e) { /* audit is best-effort — it never throws into the request path */ }
    }
    const actorId = (req) => (req && req.user && req.user.id) || null;
    const actorEmail = (req) => (req && req.user && req.user.email) || 'admin';

    // ---------------------------------------------------------------- schema
    let schemaReady = false;
    function ensureSchema() {
        BIG_IDEAS_DDL.forEach(sql => { try { q.run(sql); } catch (e) { /* exists, or the DB is not open yet */ } });
        try { schemaReady = !!q.get("SELECT name FROM sqlite_master WHERE type='table' AND name='big_ideas'"); }
        catch (e) { schemaReady = false; }
        return schemaReady;
    }
    if (!ensureSchema()) {
        let tries = 0;
        const retry = setInterval(() => { if (ensureSchema() || ++tries >= 10) clearInterval(retry); }, 4000);
        if (retry.unref) retry.unref();
    }

    // ---------------------------------------------------------------- S3 (one signer, one bucket)
    // The SigV4 helper lives in the member wing. Loaded lazily and defensively so this module still
    // mounts in a checkout where that wing is absent — uploads then answer a clean 503, nothing else.
    function s3() {
        try { return require('../../../user-portal/backend/boston')._s3; } catch (e) { return null; }
    }
    const s3Ready = () => { const s = s3(); return !!(s && s.isConfigured && s.isConfigured()); };

    function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
    const multerLib = tryRequire('multer');
    const fileUpload = multerLib
        ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } }).single('file')
        : null;
    function uploadParser(req, res, next) {
        // Already parsed upstream (another body parser, or a test harness handing the route a
        // buffer): the file is here, so there is nothing to read off the stream.
        if (req.file && req.file.buffer) return next();
        if (!fileUpload) return res.status(503).json({ error: 'Uploads are momentarily unavailable on this server.' });
        fileUpload(req, res, err => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 20 MB limit. Please compress it and try again.' });
            return res.status(400).json({ error: 'We could not read that upload. Please try a .pdf, .docx, .pptx, .xlsx, .png or .jpg file.' });
        });
    }

    // ---------------------------------------------------------------- readers
    function teamById() {
        const out = {};
        q.all('SELECT id, email, first_name, last_name FROM users WHERE is_admin = 1 OR is_staff = 1').forEach(u => {
            out[u.id] = { id: u.id, email: u.email || '', name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Team' };
        });
        return out;
    }
    function personName(id, team) {
        if (!id) return null;
        if (team && team[id]) return team[id];
        const u = q.get('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [id]);
        if (!u) return null;
        return { id: u.id, email: u.email || '', name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Team' };
    }

    function shapeIdea(row, extras) {
        const e = extras || {};
        const due = ymd(row.next_step_due);
        const d = due ? daysUntil(due) : null;
        return {
            id: row.id,
            title: row.title || '',
            thesis: row.thesis || '',
            description: row.description || '',
            area: row.area || '',
            status: row.status || 'idea',
            status_label: STATUS_LABELS[row.status] || row.status || 'Idea',
            croatian_side: row.croatian_side || '',
            international_side: row.international_side || '',
            countries: parseList(row.countries),
            tags: parseList(row.tags),
            owner_user_id: row.owner_user_id || null,
            owner: e.owner || null,
            next_step: row.next_step || '',
            next_step_due: due,
            days_until: d,
            overdue: d != null && d < 0,
            priority: priorityOf(row.priority),
            created_by: row.created_by || null,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null,
            archived_at: row.archived_at || null,
            people_count: e.people_count == null ? undefined : e.people_count,
            institution_count: e.institution_count == null ? undefined : e.institution_count,
            file_count: e.file_count == null ? undefined : e.file_count,
            log_count: e.log_count == null ? undefined : e.log_count,
            last_activity: e.last_activity === undefined ? undefined : e.last_activity
        };
    }
    function shapePerson(row, team) {
        return {
            id: row.id, idea_id: row.idea_id,
            person_ref: row.person_ref || null,
            name: row.name || '', institution: row.institution || '', role: row.role || '',
            email: row.email || '', relationship: row.relationship || '',
            our_owner_user_id: row.our_owner_user_id || null,
            our_owner: personName(row.our_owner_user_id, team),
            notes: row.notes || '', created_at: row.created_at || null
        };
    }
    const shapeInstitution = (row) => ({
        id: row.id, idea_id: row.idea_id, name: row.name || '', country: row.country || '',
        kind: row.kind || '', website: row.website || '', notes: row.notes || '', created_at: row.created_at || null
    });
    function shapeLog(row, team) {
        return {
            id: row.id, idea_id: row.idea_id, at: ymd(row.at) || ymd(row.created_at),
            kind: row.kind || 'note', summary: row.summary || '', detail: row.detail || '',
            by_user_id: row.by_user_id || null, by: personName(row.by_user_id, team), created_at: row.created_at || null
        };
    }
    const shapeFile = (row) => ({
        id: row.id, idea_id: row.idea_id, original_name: row.original_name || '',
        size: Number(row.size || 0), mime: row.mime || '', uploaded_by: row.uploaded_by || '',
        created_at: row.created_at || null
    });

    const ideaRow = (id) => q.get('SELECT * FROM big_ideas WHERE id = ?', [String(id || '')]);
    function touch(id) { try { q.run('UPDATE big_ideas SET updated_at = ? WHERE id = ?', [nowIso(), id]); } catch (e) {} }

    // The search haystack: everything a person might half-remember about an idea — its own words,
    // the people we spoke to, the institutions behind them, and what the log says happened.
    function haystackFor(id) {
        const row = ideaRow(id); if (!row) return '';
        const bits = [row.title, row.thesis, row.description, row.area, row.croatian_side, row.international_side,
                      parseList(row.countries).join(' '), parseList(row.tags).join(' '), row.next_step];
        q.all('SELECT name, institution, role, email, relationship, notes FROM big_idea_people WHERE idea_id = ?', [id])
            .forEach(p => bits.push(p.name, p.institution, p.role, p.email, p.relationship, p.notes));
        q.all('SELECT name, country, kind, notes FROM big_idea_institutions WHERE idea_id = ?', [id])
            .forEach(i => bits.push(i.name, i.country, i.kind, i.notes));
        q.all('SELECT summary, detail FROM big_idea_log WHERE idea_id = ?', [id])
            .forEach(l => bits.push(l.summary, l.detail));
        return lower(bits.filter(Boolean).join(' · '));
    }

    function countsFor(id) {
        const one = (sql) => { const r = q.get(sql, [id]); return r ? Number(r.n || 0) : 0; };
        const last = q.get('SELECT MAX(at) AS at FROM big_idea_log WHERE idea_id = ?', [id]);
        return {
            people_count: one('SELECT COUNT(*) AS n FROM big_idea_people WHERE idea_id = ?'),
            institution_count: one('SELECT COUNT(*) AS n FROM big_idea_institutions WHERE idea_id = ?'),
            log_count: one('SELECT COUNT(*) AS n FROM big_idea_log WHERE idea_id = ?'),
            file_count: one('SELECT COUNT(*) AS n FROM big_idea_files WHERE idea_id = ?'),
            last_activity: (last && ymd(last.at)) || null
        };
    }

    // status order for the grouped list — the way the work actually moves
    const STATUS_ORDER = {}; STATUSES.forEach((s, i) => { STATUS_ORDER[s] = i; });
    function sortIdeas(list) {
        return list.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
            || (a.priority - b.priority)
            || ((a.next_step_due || '9999-12-31') < (b.next_step_due || '9999-12-31') ? -1 : 1)
            || String(a.title).localeCompare(String(b.title)));
    }

    function listIdeas(query) {
        const f = query || {};
        const includeArchived = String(f.archived || '') === '1';
        const team = teamById();
        let rows = q.all('SELECT * FROM big_ideas' + (includeArchived ? '' : ' WHERE archived_at IS NULL'));
        const status = clean(f.status, 40), area = clean(f.area, 80), country = lower(f.country), person = lower(f.person), term = lower(f.q);
        if (status) rows = rows.filter(r => String(r.status) === status);
        if (area) rows = rows.filter(r => lower(r.area) === lower(area));
        if (country) rows = rows.filter(r => parseList(r.countries).some(c => lower(c).includes(country)));
        if (person) {
            // a name, an email, or the exact ref — whichever the caller happens to hold
            const matching = new Set(
                q.all('SELECT idea_id, name, email, person_ref FROM big_idea_people')
                    .filter(p => lower(p.name).includes(person) || lower(p.email).includes(person) || lower(p.person_ref) === person)
                    .map(p => p.idea_id)
            );
            rows = rows.filter(r => matching.has(r.id));
        }
        if (term) rows = rows.filter(r => haystackFor(r.id).includes(term));
        return sortIdeas(rows.map(r => shapeIdea(r, Object.assign({ owner: personName(r.owner_user_id, team) }, countsFor(r.id)))));
    }

    function fullIdea(id) {
        const row = ideaRow(id);
        if (!row) return null;
        const team = teamById();
        const idea = shapeIdea(row, Object.assign({ owner: personName(row.owner_user_id, team) }, countsFor(row.id)));
        return {
            idea,
            people: q.all('SELECT * FROM big_idea_people WHERE idea_id = ? ORDER BY created_at ASC', [id]).map(r => shapePerson(r, team)),
            institutions: q.all('SELECT * FROM big_idea_institutions WHERE idea_id = ? ORDER BY created_at ASC', [id]).map(shapeInstitution),
            // newest first — the log reads like a page of minutes, latest at the top
            log: q.all('SELECT * FROM big_idea_log WHERE idea_id = ?', [id])
                .map(r => shapeLog(r, team))
                .sort((a, b) => (a.at === b.at ? String(b.created_at || '').localeCompare(String(a.created_at || '')) : String(b.at || '').localeCompare(String(a.at || '')))),
            files: q.all('SELECT * FROM big_idea_files WHERE idea_id = ? ORDER BY created_at DESC', [id]).map(shapeFile)
        };
    }

    // ---------------------------------------------------------------- printables
    // Same ink/cream/crimson/gold language as the rest of the house, in a sheet built for paper:
    // white ground, Fraunces headings, Inter body, hairlines, nothing that needs a screen.
    const PRINT_CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #f6f2ea; color: #201b16; font: 400 12.5px/1.6 Inter, "Helvetica Neue", Arial, sans-serif; }
  .sheet { background: #fff; max-width: 820px; margin: 22px auto; padding: 38px 42px; border: 1px solid rgba(32,27,22,.14); break-inside: avoid; }
  section, tr { break-inside: avoid; }
  .eyebrow { font: 600 9px Inter, sans-serif; letter-spacing: .22em; text-transform: uppercase; color: #9b1b22; }
  .rule { width: 34px; height: 1px; background: #c9a962; margin: 12px 0 14px; }
  h1 { font: 400 30px/1.15 Fraunces, Georgia, serif; margin: 0 0 6px; }
  h2 { font: 600 9.5px Inter, sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #6d6459; margin: 26px 0 8px; }
  .thesis { font: italic 400 16px/1.5 Fraunces, Georgia, serif; color: #201b16; margin: 0 0 4px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; }
  .chip { font: 600 8.5px Inter, sans-serif; letter-spacing: .1em; text-transform: uppercase; padding: 4px 8px; background: #eee9df; color: #4a4239; }
  .chip-gold { background: #f8f1e2; color: #7a6432; }
  .chip-crimson { background: #9b1b22; color: #fff; }
  .chip-overdue { background: #9b1b22; color: #fff; }
  p { margin: 0 0 10px; }
  .body { white-space: pre-wrap; }
  .soft { color: #6d6459; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font: 600 8.5px Inter, sans-serif; letter-spacing: .13em; text-transform: uppercase; color: #6d6459; border-bottom: 1px solid rgba(32,27,22,.14); padding: 7px 8px 7px 0; }
  td { padding: 8px 8px 8px 0; border-bottom: 1px solid rgba(32,27,22,.08); vertical-align: top; }
  .next { border-left: 2px solid #9b1b22; background: #faf7f1; padding: 12px 14px; margin-top: 8px; }
  .next .step { font: 400 15px/1.4 Fraunces, Georgia, serif; }
  .log-at { font: 600 9px Inter, sans-serif; letter-spacing: .1em; color: #9b1b22; white-space: nowrap; }
  .foot { margin-top: 30px; padding-top: 12px; border-top: 1px solid rgba(32,27,22,.14); font-size: 10.5px; color: #9a9086; display: flex; justify-content: space-between; gap: 12px; }
  .page-break { page-break-before: always; }
  .none { color: #9a9086; font-style: italic; }
  .toolbar { max-width: 820px; margin: 18px auto -8px; display: flex; justify-content: flex-end; }
  .toolbar button { font: 600 10px Inter, sans-serif; letter-spacing: .14em; text-transform: uppercase; background: #9b1b22; color: #fff; border: 0; padding: 9px 15px; cursor: pointer; }
  @media print { .toolbar { display: none; } body { background: #fff; } .sheet { margin: 0; border: 0; padding: 0; max-width: none; } }`;

    function printShell(title, inner) {
        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>${PRINT_CSS}</style></head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">Print</button></div>
${inner}
</body></html>`;
    }

    const areaChip = (a) => a ? `<span class="chip chip-gold">${esc(a)}</span>` : '';
    const priorityWord = (p) => (p === 1 ? 'Priority 1 — first' : p === 3 ? 'Priority 3 — when it comes' : 'Priority 2 — soon');
    function nextStepBlock(idea) {
        if (!idea.next_step && !idea.next_step_due) {
            return `<div class="next"><span class="step none">No next step named yet.</span></div>`;
        }
        const d = idea.days_until;
        const when = idea.next_step_due
            ? (d == null ? esc(idea.next_step_due)
                : d < 0 ? `${esc(idea.next_step_due)} — ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`
                : d === 0 ? `${esc(idea.next_step_due)} — today`
                : `${esc(idea.next_step_due)} — in ${d} day${d === 1 ? '' : 's'}`)
            : 'no date set';
        return `<div class="next"><div class="step">${esc(idea.next_step || 'No next step named yet.')}</div>
      <div class="soft" style="margin-top:6px;font-size:11.5px">${idea.overdue ? '<span class="chip chip-overdue">Overdue</span> ' : ''}${when}</div></div>`;
    }
    function onePagerBody(full, opts) {
        const o = opts || {};
        const i = full.idea;
        const sides = [
            i.croatian_side ? `<tr><th style="width:150px">Croatian side</th><td>${esc(i.croatian_side)}</td></tr>` : '',
            i.international_side ? `<tr><th style="width:150px">International side</th><td>${esc(i.international_side)}</td></tr>` : '',
            i.countries.length ? `<tr><th>Countries</th><td>${esc(i.countries.join(', '))}</td></tr>` : '',
            i.owner ? `<tr><th>Ours</th><td>${esc(i.owner.name)}</td></tr>` : ''
        ].filter(Boolean).join('');
        const people = full.people.length
            ? `<table><tr><th>Person</th><th>Institution</th><th>Role</th><th>Relationship</th></tr>${full.people.map(p =>
                `<tr><td>${esc(p.name)}${p.email ? `<br><span class="soft" style="font-size:11px">${esc(p.email)}</span>` : ''}</td><td>${esc(p.institution)}</td><td>${esc(p.role)}</td><td>${esc(p.relationship)}</td></tr>`).join('')}</table>`
            : `<p class="none">Nobody attached yet.</p>`;
        const institutions = full.institutions.length
            ? `<table><tr><th>Institution</th><th>Country</th><th>Kind</th></tr>${full.institutions.map(n =>
                `<tr><td>${esc(n.name)}${n.website ? `<br><span class="soft" style="font-size:11px">${esc(n.website)}</span>` : ''}</td><td>${esc(n.country)}</td><td>${esc(n.kind)}</td></tr>`).join('')}</table>`
            : `<p class="none">No institutions named yet.</p>`;
        const timeline = full.log.length
            ? `<table>${full.log.map(l =>
                `<tr><td style="width:96px"><span class="log-at">${esc(l.at || '')}</span><br><span class="soft" style="font-size:10.5px">${esc(l.kind || 'note')}</span></td><td>${esc(l.summary || '')}${l.detail ? `<br><span class="soft">${esc(l.detail)}</span>` : ''}</td></tr>`).join('')}</table>`
            : `<p class="none">Nothing logged yet — the first meeting writes the first line.</p>`;
        const files = full.files.length
            ? `<ul style="margin:6px 0 0;padding-left:18px">${full.files.map(f => `<li>${esc(f.original_name)} <span class="soft">(${Math.max(1, Math.round(Number(f.size || 0) / 1024))} KB)</span></li>`).join('')}</ul>`
            : `<p class="none">No files yet.</p>`;
        return `<div class="sheet${o.pageBreak ? ' page-break' : ''}">
    <span class="eyebrow">Med&amp;X · Big Ideas</span>
    <div class="rule"></div>
    <h1>${esc(i.title)}</h1>
    ${i.thesis ? `<p class="thesis">${esc(i.thesis)}</p>` : ''}
    <div class="meta"><span class="chip chip-crimson">${esc(i.status_label)}</span>${areaChip(i.area)}<span class="chip">${esc(priorityWord(i.priority))}</span>${i.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    <h2>Next step</h2>
    ${nextStepBlock(i)}
    ${i.description ? `<h2>The idea</h2><p class="body">${esc(i.description)}</p>` : ''}
    ${sides ? `<h2>The two sides</h2><table>${sides}</table>` : ''}
    <h2>People</h2>${people}
    <h2>Institutions</h2>${institutions}
    <h2>What has happened</h2>${timeline}
    <h2>Files</h2>${files}
    <div class="foot"><span>Med&amp;X — Big Ideas</span><span>${esc(ymd(nowIso()))}</span></div>
  </div>`;
    }

    function portfolioHtml(ideas) {
        const summary = `<div class="sheet">
    <span class="eyebrow">Med&amp;X · Big Ideas</span>
    <div class="rule"></div>
    <h1>Portfolio briefing</h1>
    <p class="thesis">Everything we are trying to build that will not happen overnight.</p>
    <h2>The list</h2>
    ${ideas.length ? `<table><tr><th>Idea</th><th>Status</th><th>Area</th><th>Sides</th><th>Next step</th></tr>${ideas.map(f => {
        const i = f.idea;
        return `<tr><td><strong>${esc(i.title)}</strong>${i.thesis ? `<br><span class="soft" style="font-size:11px">${esc(i.thesis)}</span>` : ''}</td>
      <td>${esc(i.status_label)}</td><td>${esc(i.area)}</td>
      <td>${esc([i.croatian_side, i.international_side].filter(Boolean).join(' × '))}</td>
      <td>${esc(i.next_step)}${i.next_step_due ? `<br><span class="${i.overdue ? 'log-at' : 'soft'}" style="font-size:11px">${esc(i.next_step_due)}${i.overdue ? ' · overdue' : ''}</span>` : ''}</td></tr>`;
    }).join('')}</table>` : `<p class="none">No big ideas yet — the first one is a sentence long.</p>`}
    <div class="foot"><span>Med&amp;X — Big Ideas · portfolio briefing</span><span>${esc(ymd(nowIso()))}</span></div>
  </div>`;
        return printShell('Big Ideas — portfolio briefing', summary + ideas.map(f => onePagerBody(f, { pageBreak: true })).join(''));
    }

    // ================================================================ ROUTES
    // Static paths first: '/due', '/portfolio' and '/export.csv' are single segments and would
    // otherwise be swallowed by '/:id'.

    // ---- GET /api/v2/big-ideas ------------------------------------------------------------------
    app.get('/api/v2/big-ideas', auth, adminOnly, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const ideas = listIdeas(req.query || {});
            res.json({
                ideas,
                areas: AREAS, statuses: STATUSES, status_labels: STATUS_LABELS,
                log_kinds: LOG_KINDS, institution_kinds: INSTITUTION_KINDS, relationships: RELATIONSHIPS,
                team: Object.values(teamById()).sort((a, b) => a.name.localeCompare(b.name)),
                counts: STATUSES.reduce((o, s) => { o[s] = ideas.filter(i => i.status === s).length; return o; }, {}),
                uploads_configured: s3Ready(),
                generated_at: nowIso()
            });
        } catch (e) { log('list failed:', e.message); res.status(500).json({ error: 'Could not read the big ideas just now.' }); }
    });

    // ---- GET /api/v2/big-ideas/due --------------------------------------------------------------
    // Everything whose next step is already due or falls inside the window. Overdue first, then
    // soonest. The Today card reads exactly this.
    app.get('/api/v2/big-ideas/due', auth, adminOnly, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const days = Math.min(365, Math.max(0, Math.round(Number((req.query && req.query.days) || 14)) || 14));
            const team = teamById();
            const items = q.all("SELECT * FROM big_ideas WHERE archived_at IS NULL AND next_step_due IS NOT NULL AND next_step_due <> '' AND status NOT IN ('parked','dropped')")
                .map(r => shapeIdea(r, { owner: personName(r.owner_user_id, team) }))
                .filter(i => i.days_until != null && i.days_until <= days)
                .sort((a, b) => (a.days_until - b.days_until) || (a.priority - b.priority) || String(a.title).localeCompare(String(b.title)));
            res.json({
                days,
                items,
                overdue: items.filter(i => i.overdue).length,
                upcoming: items.filter(i => !i.overdue).length,
                generated_at: nowIso()
            });
        } catch (e) { log('due failed:', e.message); res.status(500).json({ error: 'Could not read the next steps just now.' }); }
    });

    // ---- GET /api/v2/big-ideas/portfolio --------------------------------------------------------
    app.get('/api/v2/big-ideas/portfolio', auth, adminOnly, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const rows = q.all('SELECT * FROM big_ideas WHERE archived_at IS NULL');
            const team = teamById();
            const live = sortIdeas(rows.filter(r => LIVE_STATUSES.includes(String(r.status)))
                .map(r => shapeIdea(r, Object.assign({ owner: personName(r.owner_user_id, team) }, countsFor(r.id)))));
            const full = live.map(i => fullIdea(i.id)).filter(Boolean);
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', 'private, no-store');
            res.send(portfolioHtml(full));
        } catch (e) { log('portfolio failed:', e.message); res.status(500).json({ error: 'Could not build the briefing just now.' }); }
    });

    // ---- GET /api/v2/big-ideas/export.csv -------------------------------------------------------
    app.get('/api/v2/big-ideas/export.csv', auth, adminOnly, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const ideas = listIdeas(req.query || {});
            let out = '﻿' + csvRow(['Title', 'Thesis', 'Area', 'Status', 'Priority', 'Croatian side', 'International side',
                'Countries', 'Tags', 'Ours', 'Next step', 'Due', 'People', 'Institutions', 'Log entries', 'Files', 'Last activity', 'Created']);
            ideas.forEach(i => {
                out += csvRow([i.title, i.thesis, i.area, i.status_label, i.priority, i.croatian_side, i.international_side,
                    i.countries.join('; '), i.tags.join('; '), i.owner ? i.owner.name : '', i.next_step, i.next_step_due,
                    i.people_count, i.institution_count, i.log_count, i.file_count, i.last_activity || '', ymd(i.created_at)]);
            });
            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', 'attachment; filename="medx-big-ideas.csv"');
            res.send(out);
        } catch (e) { log('csv failed:', e.message); res.status(500).json({ error: 'Could not build the export just now.' }); }
    });

    // ---- GET /api/v2/big-ideas/people/search ----------------------------------------------------
    // The People module, searched for someone to attach. Three sources, three ref shapes:
    //   user:<id>   a portal account (members and the team both live in `users`)
    //   member:<id> a Biomedical Forum member
    //   person:<id> a contact from My Network
    app.get('/api/v2/big-ideas/people/search', auth, adminOnly, (req, res) => {
        try {
            const term = lower((req.query && req.query.q) || '');
            if (term.length < 2) return res.json({ results: [], term });
            const like = '%' + term.replace(/[%_]/g, ' ') + '%';
            const results = [];
            q.all(`SELECT id, email, first_name, last_name, institution, country, is_admin FROM users
                   WHERE lower(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'') || ' ' || COALESCE(email,'')) LIKE ?
                   ORDER BY first_name, last_name LIMIT 12`, [like]).forEach(u => results.push({
                ref: 'user:' + u.id, kind: Number(u.is_admin) ? 'TEAM' : 'MEMBER',
                name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Unnamed',
                email: u.email || '', institution: u.institution || '', country: u.country || '', profile_key: u.email ? 'e:' + lower(u.email) : null
            }));
            q.all(`SELECT id, email, first_name, last_name, institution, position, location_country FROM forum_members
                   WHERE lower(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'') || ' ' || COALESCE(email,'')) LIKE ?
                   ORDER BY first_name, last_name LIMIT 12`, [like]).forEach(m => results.push({
                ref: 'member:' + m.id, kind: 'FORUM',
                name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Unnamed',
                email: m.email || '', institution: m.institution || '', role: m.position || '',
                country: m.location_country || '', profile_key: m.email ? 'e:' + lower(m.email) : null
            }));
            q.all(`SELECT id, email, first_name, last_name, organization, position, country FROM contacts
                   WHERE lower(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'') || ' ' || COALESCE(email,'') || ' ' || COALESCE(organization,'')) LIKE ?
                   ORDER BY first_name, last_name LIMIT 12`, [like]).forEach(c => results.push({
                ref: 'person:' + c.id, kind: 'CONTACT',
                name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Unnamed',
                email: c.email || '', institution: c.organization || '', role: c.position || '',
                country: c.country || '', profile_key: c.email ? 'e:' + lower(c.email) : null
            }));
            // one person, one row: the same email from two sources is the same human
            const seen = new Set(); const dedup = [];
            results.forEach(r => { const k = r.email ? lower(r.email) : r.ref; if (!seen.has(k)) { seen.add(k); dedup.push(r); } });
            res.json({ results: dedup.slice(0, 20), term });
        } catch (e) { log('people search failed:', e.message); res.json({ results: [], term: '' }); }
    });

    // ---- POST /api/v2/big-ideas -----------------------------------------------------------------
    app.post('/api/v2/big-ideas', auth, adminOnly, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const b = req.body || {};
            const title = clean(b.title, 200);
            if (!title) return res.status(400).json({ error: 'Give it a title — one line is enough.' });
            const status = STATUSES.includes(String(b.status)) ? String(b.status) : 'idea';
            const area = AREAS.includes(String(b.area)) ? String(b.area) : (clean(b.area, 80) || 'Other');
            const due = b.next_step_due ? ymd(b.next_step_due) : '';
            if (b.next_step_due && !isYmd(due)) return res.status(400).json({ error: 'The due date needs to be a real date (YYYY-MM-DD).' });
            const id = crypto.randomUUID();
            const at = nowIso();
            q.run(`INSERT INTO big_ideas (id, title, thesis, description, area, status, croatian_side, international_side,
                    countries, tags, owner_user_id, next_step, next_step_due, priority, created_by, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [id, title, clean(b.thesis, 300), clean(b.description, 20000), area, status,
                 clean(b.croatian_side, 300), clean(b.international_side, 300),
                 jsonList(b.countries), jsonList(b.tags), clean(b.owner_user_id, 80) || null,
                 clean(b.next_step, 400), due, priorityOf(b.priority), actorEmail(req), at, at]);
            auditAdmin(req, 'big-ideas.create', `${title} (${status})`);
            persist();
            res.json({ success: true, idea: shapeIdea(ideaRow(id), Object.assign({ owner: personName(clean(b.owner_user_id, 80)) }, countsFor(id))) });
        } catch (e) { log('create failed:', e.message); res.status(500).json({ error: 'Could not save that idea just now.' }); }
    });

    // ---- GET /api/v2/big-ideas/:id --------------------------------------------------------------
    app.get('/api/v2/big-ideas/:id', auth, adminOnly, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const full = fullIdea(req.params.id);
            if (!full) return res.status(404).json({ error: 'That big idea is not here.' });
            res.json(Object.assign({
                areas: AREAS, statuses: STATUSES, status_labels: STATUS_LABELS,
                log_kinds: LOG_KINDS, institution_kinds: INSTITUTION_KINDS, relationships: RELATIONSHIPS,
                team: Object.values(teamById()).sort((a, b) => a.name.localeCompare(b.name)),
                uploads_configured: s3Ready()
            }, full));
        } catch (e) { log('read failed:', e.message); res.status(500).json({ error: 'Could not open that idea just now.' }); }
    });

    // ---- PUT /api/v2/big-ideas/:id --------------------------------------------------------------
    app.put('/api/v2/big-ideas/:id', auth, adminOnly, (req, res) => {
        try {
            const row = ideaRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'That big idea is not here.' });
            const b = req.body || {};
            const sets = [], vals = [], said = [];
            const put = (col, val, label) => { sets.push(col + ' = ?'); vals.push(val); if (label) said.push(label); };
            if (b.title !== undefined) {
                const t = clean(b.title, 200);
                if (!t) return res.status(400).json({ error: 'Give it a title — one line is enough.' });
                put('title', t, 'title');
            }
            if (b.thesis !== undefined) put('thesis', clean(b.thesis, 300), 'thesis');
            if (b.description !== undefined) put('description', clean(b.description, 20000), 'description');
            if (b.area !== undefined) put('area', AREAS.includes(String(b.area)) ? String(b.area) : clean(b.area, 80), 'area');
            if (b.status !== undefined) {
                if (!STATUSES.includes(String(b.status))) return res.status(400).json({ error: 'That is not one of the seven states.' });
                put('status', String(b.status), 'status → ' + b.status);
            }
            if (b.croatian_side !== undefined) put('croatian_side', clean(b.croatian_side, 300), 'Croatian side');
            if (b.international_side !== undefined) put('international_side', clean(b.international_side, 300), 'international side');
            if (b.countries !== undefined) put('countries', jsonList(b.countries), 'countries');
            if (b.tags !== undefined) put('tags', jsonList(b.tags), 'tags');
            if (b.owner_user_id !== undefined) put('owner_user_id', clean(b.owner_user_id, 80) || null, 'owner');
            if (b.next_step !== undefined) put('next_step', clean(b.next_step, 400), 'next step');
            if (b.next_step_due !== undefined) {
                const due = b.next_step_due ? ymd(b.next_step_due) : '';
                if (b.next_step_due && !isYmd(due)) return res.status(400).json({ error: 'The due date needs to be a real date (YYYY-MM-DD).' });
                put('next_step_due', due, 'due date');
            }
            if (b.priority !== undefined) put('priority', priorityOf(b.priority), 'priority');
            if (b.archived !== undefined) put('archived_at', b.archived ? nowIso() : null, b.archived ? 'archived' : 'restored');
            if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
            sets.push('updated_at = ?'); vals.push(nowIso());
            vals.push(row.id);
            q.run('UPDATE big_ideas SET ' + sets.join(', ') + ' WHERE id = ?', vals);
            auditAdmin(req, 'big-ideas.update', `${row.title}: ${said.join(', ')}`);
            persist();
            const fresh = ideaRow(row.id);
            res.json({ success: true, idea: shapeIdea(fresh, Object.assign({ owner: personName(fresh.owner_user_id) }, countsFor(row.id))) });
        } catch (e) { log('update failed:', e.message); res.status(500).json({ error: 'Could not save that change just now.' }); }
    });

    // ---- DELETE /api/v2/big-ideas/:id -----------------------------------------------------------
    // Archive by default — an idea that went quiet is not a mistake. ?hard=1 removes it and its
    // children (the S3 objects are left in the bucket; nothing in the app points at them again).
    app.delete('/api/v2/big-ideas/:id', auth, adminOnly, (req, res) => {
        try {
            const row = ideaRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'That big idea is not here.' });
            const hard = String((req.query && req.query.hard) || '') === '1';
            if (hard) {
                ['big_idea_people', 'big_idea_institutions', 'big_idea_log', 'big_idea_files']
                    .forEach(t => { try { q.run('DELETE FROM ' + t + ' WHERE idea_id = ?', [row.id]); } catch (e) {} });
                q.run('DELETE FROM big_ideas WHERE id = ?', [row.id]);
                auditAdmin(req, 'big-ideas.delete', row.title);
            } else {
                q.run('UPDATE big_ideas SET archived_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), row.id]);
                auditAdmin(req, 'big-ideas.archive', row.title);
            }
            persist();
            res.json({ success: true, deleted: hard, archived: !hard });
        } catch (e) { log('delete failed:', e.message); res.status(500).json({ error: 'Could not remove that idea just now.' }); }
    });

    // ---- GET /api/v2/big-ideas/:id/one-pager ----------------------------------------------------
    app.get('/api/v2/big-ideas/:id/one-pager', auth, adminOnly, (req, res) => {
        try {
            const full = fullIdea(req.params.id);
            if (!full) return res.status(404).json({ error: 'That big idea is not here.' });
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Cache-Control', 'private, no-store');
            res.send(printShell(full.idea.title + ' — Big Ideas', onePagerBody(full)));
        } catch (e) { log('one-pager failed:', e.message); res.status(500).json({ error: 'Could not build that sheet just now.' }); }
    });

    // ---- people ---------------------------------------------------------------------------------
    app.post('/api/v2/big-ideas/:id/people', auth, adminOnly, (req, res) => {
        try {
            const row = ideaRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'That big idea is not here.' });
            const b = req.body || {};
            const ref = clean(b.person_ref, 120);
            if (ref && !/^(user|member|person):[A-Za-z0-9_-]+$/.test(ref)) return res.status(400).json({ error: 'That person reference is not one we recognise.' });
            let name = clean(b.name, 160), institution = clean(b.institution, 200), email = clean(b.email, 200), role = clean(b.role, 160);
            // An attached ref fills in whatever the form left blank — the People module stays the source.
            if (ref) {
                const [kind, rid] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
                let src = null;
                if (kind === 'user') src = q.get('SELECT first_name, last_name, email, institution FROM users WHERE id = ?', [rid]);
                else if (kind === 'member') src = q.get('SELECT first_name, last_name, email, institution, position FROM forum_members WHERE id = ?', [rid]);
                else if (kind === 'person') src = q.get('SELECT first_name, last_name, email, organization AS institution, position FROM contacts WHERE id = ?', [rid]);
                if (!src) return res.status(404).json({ error: 'We could not find that person in the directory any more.' });
                name = name || [src.first_name, src.last_name].filter(Boolean).join(' ') || src.email || 'Unnamed';
                institution = institution || src.institution || '';
                email = email || src.email || '';
                role = role || src.position || '';
            }
            if (!name) return res.status(400).json({ error: 'A name, at least — the rest can wait.' });
            const relationship = RELATIONSHIPS.includes(String(b.relationship)) ? String(b.relationship) : (clean(b.relationship, 60) || 'contact');
            const id = crypto.randomUUID();
            q.run(`INSERT INTO big_idea_people (id, idea_id, person_ref, name, institution, role, email, relationship, our_owner_user_id, notes, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                [id, row.id, ref || null, name, institution, role, email, relationship,
                 clean(b.our_owner_user_id, 80) || null, clean(b.notes, 4000), nowIso()]);
            touch(row.id);
            auditAdmin(req, 'big-ideas.person.add', `${row.title}: ${name}${ref ? ' (' + ref + ')' : ''}`);
            persist();
            res.json({ success: true, person: shapePerson(q.get('SELECT * FROM big_idea_people WHERE id = ?', [id])) });
        } catch (e) { log('person add failed:', e.message); res.status(500).json({ error: 'Could not add that person just now.' }); }
    });

    app.put('/api/v2/big-ideas/people/:pid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_people WHERE id = ?', [String(req.params.pid || '')]);
            if (!row) return res.status(404).json({ error: 'That person is not on this idea.' });
            const b = req.body || {};
            const sets = [], vals = [];
            const put = (c, v) => { sets.push(c + ' = ?'); vals.push(v); };
            if (b.name !== undefined) { const n = clean(b.name, 160); if (!n) return res.status(400).json({ error: 'A name, at least.' }); put('name', n); }
            if (b.institution !== undefined) put('institution', clean(b.institution, 200));
            if (b.role !== undefined) put('role', clean(b.role, 160));
            if (b.email !== undefined) put('email', clean(b.email, 200));
            if (b.relationship !== undefined) put('relationship', clean(b.relationship, 60));
            if (b.our_owner_user_id !== undefined) put('our_owner_user_id', clean(b.our_owner_user_id, 80) || null);
            if (b.notes !== undefined) put('notes', clean(b.notes, 4000));
            if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
            vals.push(row.id);
            q.run('UPDATE big_idea_people SET ' + sets.join(', ') + ' WHERE id = ?', vals);
            touch(row.idea_id);
            auditAdmin(req, 'big-ideas.person.update', row.name);
            persist();
            res.json({ success: true, person: shapePerson(q.get('SELECT * FROM big_idea_people WHERE id = ?', [row.id])) });
        } catch (e) { log('person update failed:', e.message); res.status(500).json({ error: 'Could not save that change just now.' }); }
    });

    app.delete('/api/v2/big-ideas/people/:pid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_people WHERE id = ?', [String(req.params.pid || '')]);
            if (!row) return res.status(404).json({ error: 'That person is not on this idea.' });
            q.run('DELETE FROM big_idea_people WHERE id = ?', [row.id]);
            touch(row.idea_id);
            auditAdmin(req, 'big-ideas.person.remove', row.name);
            persist();
            res.json({ success: true });
        } catch (e) { log('person remove failed:', e.message); res.status(500).json({ error: 'Could not remove that person just now.' }); }
    });

    // ---- institutions ---------------------------------------------------------------------------
    app.post('/api/v2/big-ideas/:id/institutions', auth, adminOnly, (req, res) => {
        try {
            const row = ideaRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'That big idea is not here.' });
            const b = req.body || {};
            const name = clean(b.name, 200);
            if (!name) return res.status(400).json({ error: 'The institution needs a name.' });
            const kind = INSTITUTION_KINDS.includes(String(b.kind)) ? String(b.kind) : (clean(b.kind, 40) || 'other');
            const id = crypto.randomUUID();
            q.run(`INSERT INTO big_idea_institutions (id, idea_id, name, country, kind, website, notes, created_at)
                   VALUES (?,?,?,?,?,?,?,?)`,
                [id, row.id, name, clean(b.country, 80), kind, clean(b.website, 300), clean(b.notes, 4000), nowIso()]);
            touch(row.id);
            auditAdmin(req, 'big-ideas.institution.add', `${row.title}: ${name}`);
            persist();
            res.json({ success: true, institution: shapeInstitution(q.get('SELECT * FROM big_idea_institutions WHERE id = ?', [id])) });
        } catch (e) { log('institution add failed:', e.message); res.status(500).json({ error: 'Could not add that institution just now.' }); }
    });

    app.put('/api/v2/big-ideas/institutions/:iid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_institutions WHERE id = ?', [String(req.params.iid || '')]);
            if (!row) return res.status(404).json({ error: 'That institution is not on this idea.' });
            const b = req.body || {};
            const sets = [], vals = [];
            const put = (c, v) => { sets.push(c + ' = ?'); vals.push(v); };
            if (b.name !== undefined) { const n = clean(b.name, 200); if (!n) return res.status(400).json({ error: 'The institution needs a name.' }); put('name', n); }
            if (b.country !== undefined) put('country', clean(b.country, 80));
            if (b.kind !== undefined) put('kind', clean(b.kind, 40));
            if (b.website !== undefined) put('website', clean(b.website, 300));
            if (b.notes !== undefined) put('notes', clean(b.notes, 4000));
            if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
            vals.push(row.id);
            q.run('UPDATE big_idea_institutions SET ' + sets.join(', ') + ' WHERE id = ?', vals);
            touch(row.idea_id);
            auditAdmin(req, 'big-ideas.institution.update', row.name);
            persist();
            res.json({ success: true, institution: shapeInstitution(q.get('SELECT * FROM big_idea_institutions WHERE id = ?', [row.id])) });
        } catch (e) { log('institution update failed:', e.message); res.status(500).json({ error: 'Could not save that change just now.' }); }
    });

    app.delete('/api/v2/big-ideas/institutions/:iid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_institutions WHERE id = ?', [String(req.params.iid || '')]);
            if (!row) return res.status(404).json({ error: 'That institution is not on this idea.' });
            q.run('DELETE FROM big_idea_institutions WHERE id = ?', [row.id]);
            touch(row.idea_id);
            auditAdmin(req, 'big-ideas.institution.remove', row.name);
            persist();
            res.json({ success: true });
        } catch (e) { log('institution remove failed:', e.message); res.status(500).json({ error: 'Could not remove that institution just now.' }); }
    });

    // ---- log ------------------------------------------------------------------------------------
    app.post('/api/v2/big-ideas/:id/log', auth, adminOnly, (req, res) => {
        try {
            const row = ideaRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'That big idea is not here.' });
            const b = req.body || {};
            const summary = clean(b.summary, 400);
            if (!summary) return res.status(400).json({ error: 'One line about what happened.' });
            const at = b.at ? ymd(b.at) : ymd(nowIso());
            if (!isYmd(at)) return res.status(400).json({ error: 'The date needs to be a real date (YYYY-MM-DD).' });
            const kind = LOG_KINDS.includes(String(b.kind)) ? String(b.kind) : 'note';
            const id = crypto.randomUUID();
            q.run(`INSERT INTO big_idea_log (id, idea_id, at, kind, summary, detail, by_user_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?)`,
                [id, row.id, at, kind, summary, clean(b.detail, 20000), actorId(req), nowIso()]);
            touch(row.id);
            auditAdmin(req, 'big-ideas.log.add', `${row.title}: ${kind} ${at} — ${summary}`);
            persist();
            res.json({ success: true, entry: shapeLog(q.get('SELECT * FROM big_idea_log WHERE id = ?', [id])) });
        } catch (e) { log('log add failed:', e.message); res.status(500).json({ error: 'Could not save that entry just now.' }); }
    });

    app.put('/api/v2/big-ideas/log/:lid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_log WHERE id = ?', [String(req.params.lid || '')]);
            if (!row) return res.status(404).json({ error: 'That entry is not here.' });
            const b = req.body || {};
            const sets = [], vals = [];
            const put = (c, v) => { sets.push(c + ' = ?'); vals.push(v); };
            if (b.at !== undefined) { const at = ymd(b.at); if (!isYmd(at)) return res.status(400).json({ error: 'The date needs to be a real date (YYYY-MM-DD).' }); put('at', at); }
            if (b.kind !== undefined) put('kind', LOG_KINDS.includes(String(b.kind)) ? String(b.kind) : 'note');
            if (b.summary !== undefined) { const s = clean(b.summary, 400); if (!s) return res.status(400).json({ error: 'One line about what happened.' }); put('summary', s); }
            if (b.detail !== undefined) put('detail', clean(b.detail, 20000));
            if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
            vals.push(row.id);
            q.run('UPDATE big_idea_log SET ' + sets.join(', ') + ' WHERE id = ?', vals);
            touch(row.idea_id);
            auditAdmin(req, 'big-ideas.log.update', row.summary);
            persist();
            res.json({ success: true, entry: shapeLog(q.get('SELECT * FROM big_idea_log WHERE id = ?', [row.id])) });
        } catch (e) { log('log update failed:', e.message); res.status(500).json({ error: 'Could not save that change just now.' }); }
    });

    app.delete('/api/v2/big-ideas/log/:lid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_log WHERE id = ?', [String(req.params.lid || '')]);
            if (!row) return res.status(404).json({ error: 'That entry is not here.' });
            q.run('DELETE FROM big_idea_log WHERE id = ?', [row.id]);
            touch(row.idea_id);
            auditAdmin(req, 'big-ideas.log.remove', row.summary);
            persist();
            res.json({ success: true });
        } catch (e) { log('log remove failed:', e.message); res.status(500).json({ error: 'Could not remove that entry just now.' }); }
    });

    // ---- files ----------------------------------------------------------------------------------
    app.post('/api/v2/big-ideas/:id/files', auth, adminOnly, uploadParser, async (req, res) => {
        try {
            const row = ideaRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'That big idea is not here.' });
            const S = s3();
            if (!S || !S.isConfigured()) return res.status(503).json({ error: 'File storage is not configured on this server yet — everything else on this page works.' });
            const file = req.file;
            if (!file || !file.buffer || !file.buffer.length) return res.status(400).json({ error: 'Choose a file first — pdf, docx, pptx, xlsx, png or jpg, up to 20 MB.' });
            const name = sanitizeFilename(file.originalname);
            const ext = extOf(name);
            const type = FILE_TYPES[ext];
            if (!type) return res.status(400).json({ error: 'That file type is not accepted. Please use a .pdf, .docx, .pptx, .xlsx, .png or .jpg file.' });
            if (file.buffer.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'That file is over the 20 MB limit. Please compress it and try again.' });
            if (!magicOk(ext, file.buffer)) return res.status(400).json({ error: `That file does not look like a real .${ext} file inside. Please re-export it and try again.` });
            const fid = crypto.randomUUID();
            const storedKey = `big-ideas/${row.id}/${fid}.${ext}`;
            await S.putObject(storedKey, file.buffer, type.mime);   // S3 first — a DB row only for a stored file
            q.run(`INSERT INTO big_idea_files (id, idea_id, original_name, stored_key, size, mime, uploaded_by, created_at)
                   VALUES (?,?,?,?,?,?,?,?)`,
                [fid, row.id, name, storedKey, file.buffer.length, type.mime, actorEmail(req), nowIso()]);
            touch(row.id);
            auditAdmin(req, 'big-ideas.file.upload', `${row.title}: ${name} (${file.buffer.length} bytes)`);
            persist();
            res.json({ success: true, file: shapeFile(q.get('SELECT * FROM big_idea_files WHERE id = ?', [fid])) });
        } catch (e) { log('file upload failed:', e.message); res.status(502).json({ error: 'The upload did not go through. Please try again.' }); }
    });

    // A 15-minute presigned GET. The SPA holds a Bearer token the browser cannot replay on a
    // redirect, so ?json=1 hands back { url, name } and the page opens the signed link itself.
    app.get('/api/v2/big-ideas/files/:fid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_files WHERE id = ?', [String(req.params.fid || '')]);
            if (!row) return res.status(404).json({ error: 'That file is not here.' });
            const S = s3();
            const url = S && S.presignGet ? S.presignGet(row.stored_key, { expires: 900, filename: row.original_name || 'file' }) : null;
            if (!url) return res.status(503).json({ error: 'File storage is not configured on this server yet.' });
            if (String((req.query && req.query.json) || '') === '1') return res.json({ url, name: row.original_name || 'file' });
            res.redirect(302, url);
        } catch (e) { log('file link failed:', e.message); res.status(500).json({ error: 'Could not open that file just now.' }); }
    });

    app.delete('/api/v2/big-ideas/files/:fid', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM big_idea_files WHERE id = ?', [String(req.params.fid || '')]);
            if (!row) return res.status(404).json({ error: 'That file is not here.' });
            q.run('DELETE FROM big_idea_files WHERE id = ?', [row.id]);
            touch(row.idea_id);
            auditAdmin(req, 'big-ideas.file.remove', row.original_name || row.id);
            persist();
            res.json({ success: true });
        } catch (e) { log('file remove failed:', e.message); res.status(500).json({ error: 'Could not remove that file just now.' }); }
    });

    log('big ideas mounted (/api/v2/big-ideas — the long game, one place)');
};

// Test seam: the pure rules, without a database or an express app.
module.exports._internals = {
    AREAS, STATUSES, LIVE_STATUSES, LOG_KINDS, INSTITUTION_KINDS, RELATIONSHIPS, STATUS_LABELS,
    MAX_FILE_BYTES, FILE_TYPES,
    clean, ymd, isYmd, priorityOf, jsonList, parseList, daysUntil, magicOk, sanitizeFilename, extOf, esc, csvRow
};
