/**
 * admin-portal/backend/v2/safety-ops.js — the operator's side of REPORT + BLOCK (App Store guideline 1.2:
 * the team acts on what members report, within 24 hours, by removing the content and the user). Mounted by
 * v2/index.js; routes under /api/v2/safety/… (this server only — the member portal's /api/v2/safety/* is a
 * different origin). Surfaces in the admin People screen (frontend-v2 js/views/people.js › REPORTS), the
 * PEOPLE nav badge and the Today line (js/chrome.js, js/views/today.js). Schema: shared/safety-core.js plus
 * the moderation columns ensured below.
 *
 * Moderation columns (shared DB — the member backend ensures the same ones; both ALTERs are idempotent):
 *   users.suspended_at · users.suspended_reason   the member backend's auth() answers 403 while set
 *   users.moderation_hidden_at                    HIDE PROFILE; the member cannot switch the directory back on
 *   direct_messages.removed_at · removed_by       REMOVE MESSAGE; gone from every member-facing read, kept here
 *   v2_reports.evidence_text · evidence_meta      the copy the member backend takes when the report is filed
 *                                                 (text ≤ 1000 · JSON {sender_name, sender_email, created_at,
 *                                                 context:[{id, text, created_at}] ≤ 10 other messages from the sender to the
 *                                                 reporter, profile:{photo_url,title,institution,city,specialties} on member reports})
 *
 * Routes (admin JWT — ctx.auth → ctx.adminOnly; section 'member-ops' via SECTION_ROUTE_MAP in server.js):
 *   GET  /api/v2/safety/reports?status=open|handled|reviewed|actioned|dismissed|all   (default open)
 *        → { status, counts:{open,reviewed,actioned,dismissed,handled,all}, reports:[{ id, created_at, status,
 *            reason, reason_label, note, target_kind, target_id, action_note, reviewed_at,
 *            reporter:{id,name,email}, target:{id,name,email,is_public_profile,deleted,is_admin,is_team,
 *            suspended,suspended_at,suspended_reason,moderation_hidden,moderation_hidden_at},
 *            message:{id,content,created_at,removed_at,removed_by}|null (message reports; content null = gone),
 *            evidence:{text,sender_name,sender_email,created_at,context:[{id,text,created_at,removed}],profile|null}|null,
 *            reviewed_by:{id,name}|null, target_open_reports }] }   newest first, 200 at most
 *   GET  /api/v2/safety/reports/count → { open }   (the nav badge + the Today line)
 *   PUT  /api/v2/safety/reports/:id {status, note?}
 *        status reviewed|actioned|dismissed stamps reviewed_by/at; 'open' reopens (clears the stamp).
 *        note (≤ 500) becomes action_note when given. → { success, report }
 *   POST /api/v2/safety/reports/:id/remove-message {note?, scope?, message_id?}
 *        default (message reports): the reported message. message_id: one of the other messages the report lists
 *        (context) — it must be FROM the reported member TO the reporter. scope 'thread': every message from the
 *        reported member to the reporter (by account id and by the address legacy rows store), any report kind.
 *        direct_messages.removed_at/removed_by are stamped (the rows and their text stay for this queue); the
 *        report becomes 'actioned'. Nothing left to remove → 200 {already:true}. → { success, already, removed, report }
 *   POST /api/v2/safety/reports/:id/clear-profile {fields:['photo','bio','title','specialties'], note?}
 *        the reported member's portrait (users + the Forum record, and the files: uploads/profile/<id>.* when this
 *        server shares the member backend's disk, and Cloudinary when configured), bio, title (+ the user_profiles
 *        mirror) or specialty tags (+ the Forum specialty and the networking research interests) are cleared;
 *        never a team or closed account. The report becomes 'actioned'. → { success, cleared:[…], report }
 *   POST /api/v2/safety/reports/:id/suspend {reason, note?}
 *        reason 1–200 chars. users.suspended_at/suspended_reason on the reported member (never a team account,
 *        never a closed one); the report becomes 'actioned'. → { success, already, user:{id,suspended:true}, report }
 *   POST /api/v2/safety/users/:userId/unsuspend {report_id?, note?}  → { success, user:{id,suspended:false} }
 *   POST /api/v2/safety/members/:userId/hide-profile {report_id?, note?}
 *        users.is_public_profile = 0 (+ user_profiles.is_profile_public = 0 when that row exists) and
 *        users.moderation_hidden_at (first stamp kept) — the member drops out of every directory and cannot
 *        switch it back on. NOTHING is deleted. With report_id, that report becomes 'actioned'.
 *        → { success, user:{id,is_public_profile:false}, report|null }
 *   POST /api/v2/safety/users/:userId/unhide {report_id?, note?}
 *        clears moderation_hidden_at and puts the profile back in the directory (is_public_profile = 1 — the
 *        state HIDE PROFILE took it from). → { success, user:{id,is_public_profile:true,moderation_hidden:false} }
 * Every write is audited into audit_log (best-effort) and saveDb()'d. Nothing here emails anyone.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const core = require('../../../shared/safety-core');
const photoFiles = require('../../../shared/photo-files');
// the member backend's uploads folder — the admin server reads the same tree for speaker documents (server.js)
const MEMBER_UPLOADS = path.join(__dirname, '..', '..', '..', 'user-portal', 'backend', 'uploads');
const CLEARABLE = ['photo', 'bio', 'title', 'specialties'];

const HANDLED = ['reviewed', 'actioned', 'dismissed'];
const EXCERPT = 600;
const REASON_MAX = 200;           // SUSPEND ACCOUNT — a short reason, shown back to the team (never to the member)
const CONTEXT_MAX = 10;

// the contract columns — added here as well as in the member backend so either server can boot first
const MODERATION_COLUMNS = [
    ['users', 'suspended_at', 'TEXT'], ['users', 'suspended_reason', 'TEXT'], ['users', 'moderation_hidden_at', 'TEXT'],
    ['direct_messages', 'removed_at', 'TEXT'], ['direct_messages', 'removed_by', 'TEXT'],
    ['v2_reports', 'evidence_text', 'TEXT'], ['v2_reports', 'evidence_meta', 'TEXT']
];

module.exports = function mountSafetyOps(app, ctx) {
    const { auth, adminOnly } = ctx;
    const saveDb = ctx.saveDb || (() => {});
    const log = ctx.log || ((...a) => console.log('[admin-v2/safety]', ...a));
    const db = () => ctx.db();
    const all = (sql, params = []) => { const st = db().prepare(sql); st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
    const one = (sql, params = []) => all(sql, params)[0] || null;
    const run = (sql, params = []) => db().run(sql, params);
    const str = (v) => (v == null ? '' : String(v)).trim();
    const nameOf = (u) => [u && u.first_name, u && u.last_name].filter(Boolean).join(' ').trim();
    const fail = (res, err, msg) => { console.error('[admin-v2/safety]', err); res.status(500).json({ error: msg || 'Something went wrong — please try again.' }); };
    const actorId = (req) => (req.user && req.user.id) || null;
    const audit = (req, action, detail) => {
        try {
            run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), actorId(req), (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 400)]);
        } catch (e) { /* audit is best-effort */ }
    };

    core.ensureSchema(db(), log);
    for (const [table, col, type] of MODERATION_COLUMNS) {
        try { run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (e) { /* already there (or the table belongs to a later boot) */ }
    }

    // users.is_staff / is_founder come from the admin schema (server.js) — a database without them still answers
    const PERSON_COLS = 'id, email, first_name, last_name, is_admin, is_public_profile, deleted_at, suspended_at, suspended_reason, moderation_hidden_at';
    function person(id) {
        if (!id) return null;
        try { return one(`SELECT ${PERSON_COLS}, is_staff, is_founder FROM users WHERE id = ?`, [String(id)]); }
        catch (e) {
            try { return one(`SELECT ${PERSON_COLS} FROM users WHERE id = ?`, [String(id)]); }
            catch (e2) { return one('SELECT id, email, first_name, last_name, is_admin, is_public_profile, deleted_at FROM users WHERE id = ?', [String(id)]); }
        }
    }
    const isTeam = (u) => !!(u && (Number(u.is_admin) || Number(u.is_staff) || Number(u.is_founder)));
    function evidenceOf(r) {
        const text = r.evidence_text == null ? '' : String(r.evidence_text);
        let meta = null;
        if (r.evidence_meta) { try { meta = JSON.parse(r.evidence_meta); } catch (e) { meta = null; } }
        if (!text && !meta) return null;
        meta = meta && typeof meta === 'object' ? meta : {};
        const context = (Array.isArray(meta.context) ? meta.context : []).slice(0, CONTEXT_MAX)
            .map(c => ({ id: (c && c.id) || null, text: String((c && (c.text != null ? c.text : c.content)) || '').slice(0, EXCERPT), created_at: (c && c.created_at) || null }))
            .filter(c => c.text);
        // is each listed message still in the conversation? (removed by the team, or gone with an account)
        context.forEach(c => {
            if (!c.id) { c.removed = null; return; }
            let m = null;
            try { m = one('SELECT removed_at FROM direct_messages WHERE id = ?', [String(c.id)]); } catch (e) { m = null; }
            c.removed = m ? !!m.removed_at : true;
            c.gone = !m;
        });
        const pr = meta.profile && typeof meta.profile === 'object' ? meta.profile : null;
        const profile = pr ? { photo_url: str(pr.photo_url) || null, title: str(pr.title) || null, institution: str(pr.institution) || null,
                               city: str(pr.city) || null, specialties: pr.specialties || null } : null;
        return { text: text.slice(0, 1000), sender_name: str(meta.sender_name), sender_email: str(meta.sender_email), created_at: meta.created_at || null, context, profile };
    }

    function shape(r, cache) {
        const who = (id) => { if (!id) return null; if (!cache.has(id)) cache.set(id, person(id)); return cache.get(id); };
        const rep = who(r.reporter_user_id), tgt = who(r.target_user_id), rev = who(r.reviewed_by);
        let message = null;
        if (r.target_kind === 'message') {
            let m = null;
            try { m = one('SELECT id, content, created_at, removed_at, removed_by FROM direct_messages WHERE id = ?', [r.target_id]); }
            catch (e) { m = one('SELECT id, content, created_at FROM direct_messages WHERE id = ?', [r.target_id]); }
            const remover = m && m.removed_by ? who(m.removed_by) : null;
            message = m ? { id: m.id, content: String(m.content || '').slice(0, EXCERPT), created_at: m.created_at, removed_at: m.removed_at || null,
                            removed_by: m.removed_by ? (remover ? nameOf(remover) || remover.email || 'Admin' : 'Admin') : null }
                        : { id: r.target_id, content: null, created_at: null, removed_at: null, removed_by: null };
        }
        const openOnTarget = r.target_user_id ? Number((one("SELECT COUNT(*) AS n FROM v2_reports WHERE target_user_id = ? AND status = 'open'", [r.target_user_id]) || {}).n || 0) : 0;
        return {
            id: r.id, created_at: r.created_at, status: r.status, reason: r.reason, reason_label: core.REASON_LABELS[r.reason] || r.reason,
            note: r.note || '', target_kind: r.target_kind, target_id: r.target_id, action_note: r.action_note || '', reviewed_at: r.reviewed_at || null,
            reporter: rep ? { id: rep.id, name: nameOf(rep) || rep.email || 'Member', email: rep.email || '' } : { id: r.reporter_user_id, name: 'Unknown member', email: '' },
            target: tgt ? { id: tgt.id, name: nameOf(tgt) || tgt.email || 'Member', email: tgt.email || '', is_public_profile: Number(tgt.is_public_profile) !== 0,
                            deleted: !!tgt.deleted_at, is_admin: !!Number(tgt.is_admin), is_team: isTeam(tgt),
                            suspended: !!tgt.suspended_at, suspended_at: tgt.suspended_at || null, suspended_reason: tgt.suspended_reason || '',
                            moderation_hidden: !!tgt.moderation_hidden_at, moderation_hidden_at: tgt.moderation_hidden_at || null }
                        : { id: r.target_user_id, name: 'Unknown member', email: '', is_public_profile: false, deleted: true, is_admin: false, is_team: false,
                            suspended: false, suspended_at: null, suspended_reason: '', moderation_hidden: false, moderation_hidden_at: null },
            message,
            evidence: evidenceOf(r),
            reviewed_by: rev ? { id: rev.id, name: nameOf(rev) || rev.email || 'Admin' } : null,
            target_open_reports: openOnTarget
        };
    }
    function counts() {
        const c = { open: 0, reviewed: 0, actioned: 0, dismissed: 0 };
        all('SELECT status, COUNT(*) AS n FROM v2_reports GROUP BY status').forEach(r => { if (c[r.status] != null) c[r.status] = Number(r.n) || 0; });
        c.handled = c.reviewed + c.actioned + c.dismissed;
        c.all = c.handled + c.open;
        return c;
    }
    const reportRow = (id) => one('SELECT * FROM v2_reports WHERE id = ?', [str(id)]);
    const shaped = (id) => shape(reportRow(id), new Map());
    // a note is optional everywhere and capped at the shared limit
    function noteOf(b, res) {
        const note = str(b && b.note);
        if (note.length > core.NOTE_MAX) { res.status(400).json({ error: `Keep the note under ${core.NOTE_MAX} characters.` }); return null; }
        return note;
    }
    function markActioned(req, reportId, note) {
        run(`UPDATE v2_reports SET status = 'actioned', reviewed_by = ?, reviewed_at = datetime('now'), action_note = ? WHERE id = ?`, [actorId(req), note, reportId]);
    }
    // an optional report_id on a user action must be about that user
    function linkedReport(b, u, res) {
        if (b.report_id == null || !str(b.report_id)) return { report: null };
        const report = reportRow(b.report_id);
        if (!report) { res.status(404).json({ error: 'That report could not be found.' }); return null; }
        if (String(report.target_user_id) !== String(u.id)) { res.status(400).json({ error: 'That report is about a different member.' }); return null; }
        return { report };
    }

    // ---- GET /api/v2/safety/reports?status= ----
    app.get('/api/v2/safety/reports', auth, adminOnly, (req, res) => {
        try {
            const status = str(req.query.status || 'open').toLowerCase();
            const want = status === 'all' ? core.STATUSES : status === 'handled' ? HANDLED : core.STATUSES.includes(status) ? [status] : null;
            if (!want) return res.status(400).json({ error: 'Unknown status — use open, handled, reviewed, actioned, dismissed or all.' });
            const rows = all(`SELECT * FROM v2_reports WHERE status IN (${want.map(() => '?').join(',')})
                               ORDER BY created_at DESC, rowid DESC LIMIT 200`, want);
            const cache = new Map();
            res.json({ status, counts: counts(), reports: rows.map(r => shape(r, cache)) });
        } catch (err) { fail(res, err, 'Could not load the reports.'); }
    });

    // ---- GET /api/v2/safety/reports/count — the nav badge and the Today line ----
    app.get('/api/v2/safety/reports/count', auth, adminOnly, (req, res) => {
        try {
            const r = one("SELECT COUNT(*) AS n FROM v2_reports WHERE status = 'open'");
            res.json({ open: Number((r && r.n) || 0) });
        } catch (err) { fail(res, err, 'Could not count the reports.'); }
    });

    // ---- PUT /api/v2/safety/reports/:id {status, note} ----
    app.put('/api/v2/safety/reports/:id', auth, adminOnly, (req, res) => {
        try {
            const id = str(req.params.id);
            const r = reportRow(id);
            if (!r) return res.status(404).json({ error: 'That report could not be found.' });
            const b = req.body || {};
            const status = str(b.status).toLowerCase();
            if (!core.STATUSES.includes(status)) return res.status(400).json({ error: 'Status must be open, reviewed, actioned or dismissed.' });
            const hasNote = b.note != null;
            const note = str(b.note);
            if (note.length > core.NOTE_MAX) return res.status(400).json({ error: `Keep the note under ${core.NOTE_MAX} characters.` });
            if (status === 'open') {
                run(`UPDATE v2_reports SET status = 'open', reviewed_by = NULL, reviewed_at = NULL${hasNote ? ', action_note = ?' : ''} WHERE id = ?`, hasNote ? [note || null, id] : [id]);
            } else {
                run(`UPDATE v2_reports SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')${hasNote ? ', action_note = ?' : ''} WHERE id = ?`,
                    hasNote ? [status, actorId(req), note || null, id] : [status, actorId(req), id]);
            }
            audit(req, 'safety.report.' + status, `report ${id} (${r.target_kind} ${r.target_id}, reason ${r.reason})${note ? ' — ' + note : ''}`);
            saveDb();
            res.json({ success: true, report: shaped(id) });
        } catch (err) { fail(res, err, 'Could not update that report.'); }
    });

    // ---- POST /api/v2/safety/reports/:id/remove-message {note?, scope?, message_id?} ----
    // the keys a member's messages can carry: the account id, and the address older writers stored instead
    const keysOf = (id) => { const u = person(id); return [String(id || ''), u && u.email ? String(u.email).toLowerCase() : null].filter(Boolean); };
    app.post('/api/v2/safety/reports/:id/remove-message', auth, adminOnly, (req, res) => {
        try {
            const r = reportRow(req.params.id);
            if (!r) return res.status(404).json({ error: 'That report could not be found.' });
            const b = req.body || {};
            const note = noteOf(b, res); if (note === null) return;
            const scope = str(b.scope).toLowerCase();
            const oneId = str(b.message_id);
            const fromKeys = keysOf(r.target_user_id), toKeys = keysOf(r.reporter_user_id);
            const ph = (a) => a.map(() => '?').join(',');
            const pairSql = `lower(sender_id) IN (${ph(fromKeys)}) AND lower(receiver_id) IN (${ph(toKeys)})`;
            const pairParams = fromKeys.map(k => k.toLowerCase()).concat(toKeys.map(k => k.toLowerCase()));

            // (a) every message from the reported member to the reporter
            if (scope === 'thread') {
                if (!fromKeys.length || !toKeys.length) return res.status(400).json({ error: 'This report does not name both members.' });
                const rows = all(`SELECT id FROM direct_messages WHERE ${pairSql} AND removed_at IS NULL
                                    AND COALESCE(sender_type,'user') <> 'admin' AND COALESCE(receiver_type,'user') <> 'admin'`, pairParams);
                rows.forEach(m => run("UPDATE direct_messages SET removed_at = datetime('now'), removed_by = ? WHERE id = ?", [actorId(req), m.id]));
                markActioned(req, r.id, note || `Every message from the reported member to the reporter removed (${rows.length}).`);
                audit(req, 'safety.remove_messages', `${rows.length} message(s) from ${r.target_user_id} to ${r.reporter_user_id} — report ${r.id}${note ? ' — ' + note : ''}`);
                saveDb();
                return res.json({ success: true, already: rows.length === 0, removed: rows.length, report: shaped(r.id) });
            }

            // (b) one message: the reported one, or one of the others the report lists
            if (!oneId && r.target_kind !== 'message') return res.status(400).json({ error: 'This report is about a profile — pick a message from the list, or remove them all.' });
            const targetId = oneId || String(r.target_id);
            const m = one('SELECT id, sender_id, receiver_id, content, created_at, removed_at FROM direct_messages WHERE id = ?', [targetId]);
            if (!m) return res.status(404).json({ error: 'That message is no longer there. The copy saved with the report stays in the queue.' });
            if (oneId && oneId !== String(r.target_id)) {
                const okPair = fromKeys.map(k => k.toLowerCase()).includes(String(m.sender_id).toLowerCase())
                            && toKeys.map(k => k.toLowerCase()).includes(String(m.receiver_id).toLowerCase());
                if (!okPair) return res.status(400).json({ error: 'That message is not one the reported member sent to the reporter.' });
            }
            // the report keeps its own copy even if the member backend filed it without one (older build)
            if (!oneId && !r.evidence_text && m.content) {
                const s = person(m.sender_id);
                run('UPDATE v2_reports SET evidence_text = ?, evidence_meta = COALESCE(evidence_meta, ?) WHERE id = ?',
                    [String(m.content).slice(0, 1000), JSON.stringify({ sender_name: nameOf(s) || '', sender_email: (s && s.email) || '', created_at: m.created_at || null, context: [] }), r.id]);
            }
            const already = !!m.removed_at;
            if (!already) run("UPDATE direct_messages SET removed_at = datetime('now'), removed_by = ? WHERE id = ?", [actorId(req), m.id]);
            markActioned(req, r.id, note || 'Message removed from the member’s inbox.');
            audit(req, 'safety.remove_message', `message ${m.id} from ${m.sender_id} — report ${r.id}${already ? ' (already removed)' : ''}${note ? ' — ' + note : ''}`);
            saveDb();
            res.json({ success: true, already, removed: already ? 0 : 1, report: shaped(r.id) });
        } catch (err) { fail(res, err, 'Could not remove that message.'); }
    });

    // ---- POST /api/v2/safety/reports/:id/clear-profile {fields, note?} ----
    // Takes offending content off a profile without suspending the account: the portrait, the bio, the title or
    // the specialty tags — wherever other members see them (the directory card, message headers, the Forum).
    app.post('/api/v2/safety/reports/:id/clear-profile', auth, adminOnly, async (req, res) => {
        try {
            const r = reportRow(req.params.id);
            if (!r) return res.status(404).json({ error: 'That report could not be found.' });
            const b = req.body || {};
            const fields = [...new Set((Array.isArray(b.fields) ? b.fields : []).map(f => str(f).toLowerCase()))];
            if (!fields.length || fields.some(f => !CLEARABLE.includes(f))) return res.status(400).json({ error: 'Pick what to clear: photo, bio, title or specialties.' });
            const note = noteOf(b, res); if (note === null) return;
            const u = person(r.target_user_id);
            if (!u || u.deleted_at) return res.status(404).json({ error: 'That account is closed — there is no profile to clear.' });
            if (isTeam(u)) return res.status(400).json({ error: 'Med&X team profiles are not cleared from the reports queue.' });
            const tryRun = (sql, params) => { try { run(sql, params); return true; } catch (e) { return false; } };
            let photoUrl = null, forumPhotos = [];
            if (fields.includes('photo')) {
                try { photoUrl = (one('SELECT photo_url FROM users WHERE id = ?', [u.id]) || {}).photo_url || null; } catch (e) { photoUrl = null; }
                try { forumPhotos = all('SELECT photo_url FROM forum_members WHERE user_id = ? AND photo_url IS NOT NULL', [u.id]).map(x => x.photo_url); } catch (e) { forumPhotos = []; }
                tryRun('UPDATE users SET photo_url = NULL WHERE id = ?', [u.id]);
                tryRun('UPDATE forum_members SET photo_url = NULL WHERE user_id = ?', [u.id]);
            }
            if (fields.includes('bio')) {
                tryRun('UPDATE users SET bio = NULL WHERE id = ?', [u.id]);
                tryRun('UPDATE forum_members SET bio = NULL WHERE user_id = ?', [u.id]);
            }
            if (fields.includes('title')) {
                tryRun('UPDATE users SET title = NULL WHERE id = ?', [u.id]);
                tryRun('UPDATE user_profiles SET title = NULL WHERE user_id = ?', [u.id]);
            }
            if (fields.includes('specialties')) {
                tryRun('UPDATE users SET specialties = NULL WHERE id = ?', [u.id]);
                tryRun('UPDATE forum_members SET specialty = NULL, sub_specialties = NULL WHERE user_id = ?', [u.id]);
                tryRun("UPDATE networking_profiles SET research_interests = '[]' WHERE user_id = ?", [u.id]);
            }
            const labels = { photo: 'portrait', bio: 'bio', title: 'title', specialties: 'specialty tags' };
            markActioned(req, r.id, note || ('Cleared from the profile: ' + fields.map(f => labels[f]).join(', ') + '.'));
            audit(req, 'safety.clear_profile', `${nameOf(u) || u.email} (${u.id}) — ${fields.join(', ')} — report ${r.id}${note ? ' — ' + note : ''}`);
            saveDb();
            // the portrait files: disk now; Cloudinary after the answer (5 s cap), never blocking the team
            if (fields.includes('photo')) {
                const stillUsed = (url) => { try { return !!(one('SELECT 1 AS x FROM users WHERE photo_url = ? LIMIT 1', [url]) || one('SELECT 1 AS x FROM forum_members WHERE photo_url = ? LIMIT 1', [url])); } catch (e) { return true; } };
                const cloud = () => require('cloudinary').v2;
                const urls = [photoUrl].concat(forumPhotos.filter(x => x && x !== photoUrl));
                urls.forEach(url => photoFiles.removeLocal(MEMBER_UPLOADS, u.id, url, { stillUsed }));
                setImmediate(async () => {
                    for (const url of urls) {
                        await Promise.race([
                            photoFiles.destroyCloud(u.id, url, { stillUsed, cloud }),
                            new Promise(resolve => { const t = setTimeout(resolve, 5000); if (t.unref) t.unref(); })
                        ]).catch(e => log('clear-profile photo clean-up: ' + (e && e.message)));
                    }
                });
            }
            res.json({ success: true, cleared: fields, report: shaped(r.id) });
        } catch (err) { fail(res, err, 'Could not clear that profile.'); }
    });

    // ---- POST /api/v2/safety/reports/:id/suspend {reason, note?} ----
    app.post('/api/v2/safety/reports/:id/suspend', auth, adminOnly, (req, res) => {
        try {
            const r = reportRow(req.params.id);
            if (!r) return res.status(404).json({ error: 'That report could not be found.' });
            const b = req.body || {};
            const reason = str(b.reason).replace(/\s+/g, ' ');
            if (!reason) return res.status(400).json({ error: 'Give a short reason — the team sees it next to the account.' });
            if (reason.length > REASON_MAX) return res.status(400).json({ error: `Keep the reason under ${REASON_MAX} characters.` });
            const note = noteOf(b, res); if (note === null) return;
            const u = person(r.target_user_id);
            if (!u || u.deleted_at) return res.status(404).json({ error: 'That account is already closed.' });
            if (isTeam(u)) return res.status(400).json({ error: 'Med&X team accounts cannot be suspended from the reports queue.' });
            if (String(u.id) === String(actorId(req))) return res.status(400).json({ error: 'You cannot suspend your own account.' });
            const already = !!u.suspended_at;
            if (!already) run("UPDATE users SET suspended_at = datetime('now'), suspended_reason = ? WHERE id = ?", [reason, u.id]);
            else run('UPDATE users SET suspended_reason = ? WHERE id = ?', [reason, u.id]);
            markActioned(req, r.id, note || ('Account suspended — ' + reason).slice(0, core.NOTE_MAX));
            audit(req, 'safety.suspend', `${nameOf(u) || u.email} (${u.id}) — report ${r.id} — ${reason}`);
            saveDb();
            res.json({ success: true, already, user: { id: u.id, suspended: true }, report: shaped(r.id) });
        } catch (err) { fail(res, err, 'Could not suspend that account.'); }
    });

    // ---- POST /api/v2/safety/users/:userId/unsuspend {report_id?, note?} ----
    app.post('/api/v2/safety/users/:userId/unsuspend', auth, adminOnly, (req, res) => {
        try {
            const u = person(str(req.params.userId));
            if (!u) return res.status(404).json({ error: 'That member could not be found.' });
            const b = req.body || {};
            const note = noteOf(b, res); if (note === null) return;
            const link = linkedReport(b, u, res); if (!link) return;
            const was = !!u.suspended_at;
            run('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?', [u.id]);
            audit(req, 'safety.unsuspend', `${nameOf(u) || u.email} (${u.id})${link.report ? ' — report ' + link.report.id : ''}${was ? '' : ' (was not suspended)'}${note ? ' — ' + note : ''}`);
            saveDb();
            res.json({ success: true, user: { id: u.id, suspended: false }, report: link.report ? shaped(link.report.id) : null });
        } catch (err) { fail(res, err, 'Could not lift the suspension.'); }
    });

    // ---- POST /api/v2/safety/members/:userId/hide-profile {report_id?, note?} ----
    app.post('/api/v2/safety/members/:userId/hide-profile', auth, adminOnly, (req, res) => {
        try {
            const uid = str(req.params.userId);
            const u = person(uid);
            if (!u) return res.status(404).json({ error: 'That member could not be found.' });
            const b = req.body || {};
            const note = noteOf(b, res); if (note === null) return;
            const link = linkedReport(b, u, res); if (!link) return;
            const report = link.report;
            run('UPDATE users SET is_public_profile = 0 WHERE id = ?', [u.id]);
            // the moderation stamp is what keeps the member from switching the directory back on
            try { run("UPDATE users SET moderation_hidden_at = COALESCE(moderation_hidden_at, datetime('now')) WHERE id = ?", [u.id]); } catch (e) { log('moderation_hidden_at: ' + e.message); }
            try { run('UPDATE user_profiles SET is_profile_public = 0 WHERE user_id = ?', [u.id]); } catch (e) { /* optional mirror table */ }
            if (report) markActioned(req, report.id, note || 'Profile hidden from the member directory.');
            audit(req, 'safety.hide_profile', `${nameOf(u) || u.email} (${u.id})${report ? ' — report ' + report.id : ''}${note ? ' — ' + note : ''}`);
            saveDb();
            res.json({ success: true, user: { id: u.id, is_public_profile: false },
                       report: report ? shaped(report.id) : null });
        } catch (err) { fail(res, err, 'Could not hide that profile.'); }
    });

    // ---- POST /api/v2/safety/users/:userId/unhide {report_id?, note?} ----
    app.post('/api/v2/safety/users/:userId/unhide', auth, adminOnly, (req, res) => {
        try {
            const u = person(str(req.params.userId));
            if (!u) return res.status(404).json({ error: 'That member could not be found.' });
            if (u.deleted_at) return res.status(400).json({ error: 'That account is closed — there is no profile to show.' });
            const b = req.body || {};
            const note = noteOf(b, res); if (note === null) return;
            const link = linkedReport(b, u, res); if (!link) return;
            run('UPDATE users SET moderation_hidden_at = NULL, is_public_profile = 1 WHERE id = ?', [u.id]);
            try { run('UPDATE user_profiles SET is_profile_public = 1 WHERE user_id = ?', [u.id]); } catch (e) { /* optional mirror table */ }
            audit(req, 'safety.unhide_profile', `${nameOf(u) || u.email} (${u.id})${link.report ? ' — report ' + link.report.id : ''}${note ? ' — ' + note : ''}`);
            saveDb();
            res.json({ success: true, user: { id: u.id, is_public_profile: true, moderation_hidden: false }, report: link.report ? shaped(link.report.id) : null });
        } catch (err) { fail(res, err, 'Could not put that profile back.'); }
    });

    log('safety-ops: /api/v2/safety/{reports,reports/count,reports/:id,reports/:id/remove-message,reports/:id/clear-profile,reports/:id/suspend,members/:userId/hide-profile,users/:userId/unhide,users/:userId/unsuspend}');
};
