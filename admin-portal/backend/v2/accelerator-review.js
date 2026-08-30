/**
 * v2/accelerator-review.js — admin-origin additions for the redesigned Accelerator Hub
 * (js/views/accelerator.js) and Review Room (js/views/accelerator-review.js).
 *
 * Only what the existing admin routes do NOT cover (74-route accelerator surface verified 2026-08-30):
 *
 *   ALUMNI (the member origin owns the same table via user-portal/backend/v2/accelerator.js;
 *   the admin origin needs local CRUD because the admin front end only reaches this server —
 *   DDL copied VERBATIM from that module; both portals share ONE database):
 *     GET    /api/v2/accelerator-review/alumni            admin — every row incl. unpublished
 *     POST   /api/v2/accelerator-review/alumni            admin — { name*, year, placement_institution, city, photo_url, sort_order, is_published }
 *     PUT    /api/v2/accelerator-review/alumni/:id        admin — partial update
 *     DELETE /api/v2/accelerator-review/alumni/:id        admin — hard delete
 *
 *   INTAKE WINDOW (the member origin owns PUT /api/accelerator/intake/window; the admin server
 *   has the intake_windows table + the countdown read but no write — same semantics, mirrored):
 *     GET /api/v2/accelerator-review/intake               admin — latest accelerator window + state
 *     PUT /api/v2/accelerator-review/intake-window        admin — { opens_at, closes_at, track?, cycle? }
 *
 *   PER-REVIEWER SCORES (legacy accelerator_evaluations is UNIQUE(application, criterion) — one
 *   shared score; the Review Room needs reviewer × application × criterion, averaged):
 *     GET /api/v2/accelerator-review/scores?year=         admin — all rows for that year's program
 *     PUT /api/v2/accelerator-review/scores               admin — { application_id, criterion_id, score } (0–5, reviewer = the signed-in admin)
 *
 *   REVIEWER NOTE (writes the legacy accelerator_applications.reviewer_notes column so the old
 *   admin surfaces see the same note; the legacy review route always flips status, so a note-only PUT):
 *     PUT /api/v2/accelerator-review/applications/:id/note        admin — { note }
 *
 *   DECISIONS (accept → offer / decline → kind no; the email QUEUES in the scheduled_emails
 *   outbox as pending_approval — decision-letter pattern — and never sends directly; undo
 *   restores the previous status and cancels the still-pending batch):
 *     POST /api/v2/accelerator-review/applications/:id/decision        admin — { decision: 'accepted'|'declined' }
 *     POST /api/v2/accelerator-review/applications/:id/decision/undo   admin — { prev_status?, prev_decision? }
 *
 *   INTERVIEW INVITE (queues TWO outbox rows: the applicant's booking link + the interviewer's
 *   notification carrying their legacy magic evaluation link /evaluate?token=… — reusing the
 *   accelerator_interviewers.access_token + accelerator_interviewer_assignments infrastructure):
 *     GET  /api/v2/accelerator-review/interview-invites?year=          admin
 *     POST /api/v2/accelerator-review/applications/:id/interview-invite  admin — { interviewer_id }
 *     GET  /api/v2/accelerator-review/book/:token                      public — the booking page the applicant email links to
 *     POST /api/v2/accelerator-review/book/:token/confirm              public — marks the slot request booked
 *
 *   GET /api/v2/accelerator-review/notify-count           admin — get-notified list size (notify_topics, project_key 'accelerator')
 *
 * Schema added here (never renamed/dropped): v2_accelerator_alumni (verbatim copy),
 * v2_accel_scores, v2_accel_interview_invites.
 */
'use strict';
const crypto = require('crypto');

module.exports = function mountAcceleratorReview(app, ctx) {
    const { db, auth, adminOnly, saveDb, log } = ctx;

    // ---- sql.js-style helpers (shared/db.js idioms) ----
    const q = {
        all(sql, params) {
            const s = db().prepare(sql);
            s.bind(params || []);
            const rows = [];
            while (s.step()) rows.push(s.getAsObject());
            s.free();
            return rows;
        },
        get(sql, params) { return q.all(sql, params)[0] || null; },
        run(sql, params) { return db().run(sql, params || []); }
    };
    const uuid = () => crypto.randomUUID();
    const persist = () => { try { if (typeof saveDb === 'function') saveDb(); } catch (e) { /* staging in-memory saves are advisory */ } };

    // ---- schema ----
    try {
        // VERBATIM copy of the member-origin DDL (user-portal/backend/v2/accelerator.js) — shared table.
        db().run(`CREATE TABLE IF NOT EXISTS v2_accelerator_alumni (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            year INTEGER,
            placement_institution TEXT,
            city TEXT,
            photo_url TEXT,
            sort_order INTEGER DEFAULT 0,
            is_published INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_accel_scores (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            criterion_id TEXT NOT NULL,
            reviewer_email TEXT NOT NULL,
            reviewer_name TEXT,
            score REAL NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(application_id, criterion_id, reviewer_email)
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_accel_interview_invites (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            interviewer_id TEXT NOT NULL,
            token TEXT UNIQUE,
            status TEXT DEFAULT 'queued',
            batch_id TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            booked_at TEXT
        )`);
    } catch (e) { log('accelerator-review schema failed: ' + e.message); }

    // ---------------------------------------------------------------- shared bits
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Never derive links from req.headers.origin (legacy send-link lesson): protocol + forwarded host.
    function publicBase(req) {
        try { return `${req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`; } catch (e) { return ''; }
    }
    // Brand email shell — ink header, cream body, Fraunces headline (design tokens).
    function emailShell(headline, bodyHtml) {
        return `<div style="max-width:600px;margin:0 auto;background:#f7f1e6;font-family:Inter,Arial,sans-serif;color:#191512">
  <div style="background:#191512;padding:22px 28px;border-bottom:2px solid #9b1b22"><span style="font:600 16px Georgia,serif;color:#f7f1e6;letter-spacing:.02em">Med&amp;X</span></div>
  <div style="padding:28px;background:#fdfaf3;border:1px solid rgba(25,21,18,.16);border-top:0">
    <div style="font:italic 600 22px Georgia,serif;margin-bottom:14px">${headline}</div>
    <div style="font-size:14px;line-height:1.7;color:#4a4239">${bodyHtml}</div>
  </div>
  <div style="padding:14px 28px;font-size:11px;color:#4a4239">Med&amp;X · Zagreb · accelerator@medx.hr</div>
</div>`;
    }
    function queueEmail({ batch, engine, template, to, subject, html, actor }) {
        q.run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
               VALUES (?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [uuid(), batch, engine, template, JSON.stringify({ to, subject, html }), to, subject, actor || 'admin']);
    }
    const cancelPending = (batch) => { try { q.run("UPDATE scheduled_emails SET status = 'cancelled' WHERE batch_id = ? AND status = 'pending_approval'", [batch]); } catch (e) {} };
    // One batch per decision KIND: the outbox list samples a batch with a plain LIMIT 1 (no status
    // filter), so a batch that mixed a cancelled offer with a pending kind-no would show the wrong
    // subject. Homogeneous batches keep the outbox truthful; cancellation sweeps the prefix.
    const cancelPendingLike = (prefix) => { try { q.run("UPDATE scheduled_emails SET status = 'cancelled' WHERE batch_id LIKE ? AND status = 'pending_approval'", [prefix + '%']); } catch (e) {} };
    const getApplication = (id) => q.get('SELECT * FROM accelerator_applications WHERE id = ?', [String(id || '')]);
    const applicantName = (a) => [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || 'Applicant';

    // ---------------------------------------------------------------- ALUMNI (admin CRUD, DDL shared with the member origin)
    const str = (v, max) => (v === undefined || v === null) ? null : String(v).trim().slice(0, max);
    function cleanAlumni(body, partial) {
        const b = body || {};
        const out = {};
        if (!partial || b.name !== undefined) {
            out.name = str(b.name, 160);
            if (!out.name) return { error: 'name is required' };
        }
        if (b.year !== undefined) {
            if (b.year === null || b.year === '') out.year = null;
            else {
                const y = parseInt(b.year, 10);
                if (isNaN(y) || y < 2000 || y > 2100) return { error: 'year must be a four-digit year' };
                out.year = y;
            }
        }
        if (b.placement_institution !== undefined) out.placement_institution = str(b.placement_institution, 200);
        if (b.city !== undefined) out.city = str(b.city, 120);
        if (b.photo_url !== undefined) {
            const u = str(b.photo_url, 500);
            if (u && !/^(https?:\/\/|\/uploads\/|\/f\/)/.test(u)) return { error: 'photo_url must be an http(s) URL or an /uploads path' };
            out.photo_url = u || null;
        }
        if (b.sort_order !== undefined) { const n = parseInt(b.sort_order, 10); out.sort_order = isNaN(n) ? 0 : n; }
        if (b.is_published !== undefined) out.is_published = (b.is_published === true || b.is_published === 1 || b.is_published === '1' || b.is_published === 'true') ? 1 : 0;
        return { fields: out };
    }
    const ALUMNI_COLS = 'id, name, year, placement_institution, city, photo_url, sort_order, is_published, created_at, updated_at';

    app.get('/api/v2/accelerator-review/alumni', auth, adminOnly, (req, res) => {
        try {
            const rows = q.all(`SELECT ${ALUMNI_COLS} FROM v2_accelerator_alumni ORDER BY year DESC, sort_order ASC, name ASC`);
            const years = rows.map(r => r.year).filter(y => typeof y === 'number' && !isNaN(y));
            res.json({ alumni: rows, count: rows.length, years: years.length ? { from: Math.min.apply(null, years), to: Math.max.apply(null, years) } : null });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/v2/accelerator-review/alumni', auth, adminOnly, (req, res) => {
        try {
            const c = cleanAlumni(req.body, false);
            if (c.error) return res.status(400).json({ error: c.error });
            const f = Object.assign({ year: null, placement_institution: null, city: null, photo_url: null, sort_order: 0, is_published: 1 }, c.fields);
            const id = uuid();
            q.run(`INSERT INTO v2_accelerator_alumni (id, name, year, placement_institution, city, photo_url, sort_order, is_published)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, f.name, f.year, f.placement_institution, f.city, f.photo_url, f.sort_order, f.is_published]);
            persist();
            res.json({ success: true, alumnus: q.get(`SELECT ${ALUMNI_COLS} FROM v2_accelerator_alumni WHERE id = ?`, [id]) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.put('/api/v2/accelerator-review/alumni/:id', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!q.get('SELECT id FROM v2_accelerator_alumni WHERE id = ?', [id])) return res.status(404).json({ error: 'Not found' });
            const c = cleanAlumni(req.body, true);
            if (c.error) return res.status(400).json({ error: c.error });
            const keys = Object.keys(c.fields);
            if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
            q.run(`UPDATE v2_accelerator_alumni SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                keys.map(k => c.fields[k]).concat([id]));
            persist();
            res.json({ success: true, alumnus: q.get(`SELECT ${ALUMNI_COLS} FROM v2_accelerator_alumni WHERE id = ?`, [id]) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.delete('/api/v2/accelerator-review/alumni/:id', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!q.get('SELECT id FROM v2_accelerator_alumni WHERE id = ?', [id])) return res.status(404).json({ error: 'Not found' });
            q.run('DELETE FROM v2_accelerator_alumni WHERE id = ?', [id]);
            persist();
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------------------------------------------------------------- INTAKE WINDOW (member-route semantics, mirrored)
    const INTAKE_TRACK = 'accelerator';
    const INTAKE_CYCLE = '2026';
    function intakeState(w) {
        const now = Date.now();
        if (!w || !w.opens_at) return 'before';
        const opens = Date.parse(w.opens_at);
        if (isNaN(opens) || now < opens) return 'before';
        if (w.closes_at) { const closes = Date.parse(w.closes_at); if (!isNaN(closes) && now > closes) return 'closed'; }
        return 'open';
    }
    app.get('/api/v2/accelerator-review/intake', auth, adminOnly, (req, res) => {
        try {
            const w = q.get("SELECT * FROM intake_windows WHERE track = ? ORDER BY cycle DESC LIMIT 1", [INTAKE_TRACK]);
            res.json({ track: INTAKE_TRACK, cycle: w ? w.cycle : INTAKE_CYCLE, opens_at: w ? w.opens_at : null, closes_at: w ? w.closes_at : null, state: intakeState(w), server_time: new Date().toISOString() });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.put('/api/v2/accelerator-review/intake-window', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const track = b.track ? String(b.track) : INTAKE_TRACK;
            const latest = q.get("SELECT cycle FROM intake_windows WHERE track = ? ORDER BY cycle DESC LIMIT 1", [track]);
            const cycle = b.cycle ? String(b.cycle) : (latest ? String(latest.cycle) : INTAKE_CYCLE);
            const opens = b.opens_at ? String(b.opens_at) : null;
            const closes = b.closes_at ? String(b.closes_at) : null;
            const now = new Date().toISOString();
            const existing = q.get('SELECT id FROM intake_windows WHERE track = ? AND cycle = ?', [track, cycle]);
            if (existing) q.run('UPDATE intake_windows SET opens_at = ?, closes_at = ?, updated_at = ? WHERE id = ?', [opens, closes, now, existing.id]);
            else q.run('INSERT INTO intake_windows (id, track, cycle, opens_at, closes_at, updated_at) VALUES (?,?,?,?,?,?)', [uuid(), track, cycle, opens, closes, now]);
            persist();
            const w = q.get('SELECT * FROM intake_windows WHERE track = ? AND cycle = ?', [track, cycle]);
            res.json({ success: true, window: w, state: intakeState(w) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------------------------------------------------------------- GET-NOTIFIED COUNT
    app.get('/api/v2/accelerator-review/notify-count', auth, adminOnly, (req, res) => {
        try {
            const row = q.get("SELECT COUNT(*) AS c FROM notify_topics WHERE project_key = 'accelerator'");
            res.json({ count: row ? (row.c || 0) : 0 });
        } catch (e) { res.json({ count: 0, unavailable: true }); }
    });

    // ---------------------------------------------------------------- PER-REVIEWER SCORES (0–5, averaged client-side)
    app.get('/api/v2/accelerator-review/scores', auth, adminOnly, (req, res) => {
        try {
            const year = parseInt(req.query.year, 10);
            let rows;
            if (Number.isFinite(year)) {
                rows = q.all(`SELECT s.* FROM v2_accel_scores s
                              JOIN accelerator_applications a ON a.id = s.application_id
                              JOIN accelerator_programs p ON p.id = a.program_id
                              WHERE p.year = ?`, [year]);
            } else {
                rows = q.all('SELECT * FROM v2_accel_scores');
            }
            res.json({ scores: rows, reviewer: req.user && req.user.email ? req.user.email : null });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.put('/api/v2/accelerator-review/scores', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const appId = String(b.application_id || '');
            const critId = String(b.criterion_id || '');
            const application = getApplication(appId);
            if (!application) return res.status(404).json({ error: 'Application not found' });
            const criterion = q.get('SELECT * FROM accelerator_evaluation_criteria WHERE id = ?', [critId]);
            if (!criterion) return res.status(400).json({ error: 'Invalid criterion' });
            const n = Number(String(b.score).replace(',', '.'));
            const cap = Math.min(5, Number(criterion.max_points) || 5);
            if (!Number.isFinite(n) || n < 0 || n > cap) return res.status(400).json({ error: `Score for "${criterion.name}" must be between 0 and ${cap}` });
            const reviewer = (req.user && req.user.email) || 'admin';
            const reviewerName = (req.user && (req.user.name || req.user.email)) || 'admin';
            const existing = q.get('SELECT id FROM v2_accel_scores WHERE application_id = ? AND criterion_id = ? AND reviewer_email = ?', [appId, critId, reviewer]);
            if (existing) q.run("UPDATE v2_accel_scores SET score = ?, reviewer_name = ?, updated_at = datetime('now') WHERE id = ?", [n, reviewerName, existing.id]);
            else q.run('INSERT INTO v2_accel_scores (id, application_id, criterion_id, reviewer_email, reviewer_name, score) VALUES (?,?,?,?,?,?)', [uuid(), appId, critId, reviewer, reviewerName, n]);
            persist();
            const agg = q.get('SELECT AVG(score) AS avg, COUNT(*) AS n FROM v2_accel_scores WHERE application_id = ? AND criterion_id = ?', [appId, critId]);
            res.json({ success: true, avg: agg ? agg.avg : n, n: agg ? agg.n : 1 });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------------------------------------------------------------- REVIEWER NOTE (legacy column, note-only write)
    app.put('/api/v2/accelerator-review/applications/:id/note', auth, adminOnly, (req, res) => {
        try {
            const application = getApplication(req.params.id);
            if (!application) return res.status(404).json({ error: 'Application not found' });
            const note = req.body && req.body.note != null ? String(req.body.note).slice(0, 4000) : null;
            q.run("UPDATE accelerator_applications SET reviewer_notes = ?, updated_at = datetime('now') WHERE id = ?", [note, application.id]);
            persist();
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------------------------------------------------------------- DECISIONS (queue the letter, never send)
    const decisionPrefix = (appId) => 'accel-rev2-decision-' + appId + '-';
    const decisionBatch = (appId, decision) => decisionPrefix(appId) + decision;
    app.post('/api/v2/accelerator-review/applications/:id/decision', auth, adminOnly, (req, res) => {
        try {
            const application = getApplication(req.params.id);
            if (!application) return res.status(404).json({ error: 'Application not found' });
            const decision = String((req.body || {}).decision || '');
            if (!['accepted', 'declined'].includes(decision)) return res.status(400).json({ error: "decision must be 'accepted' or 'declined'" });
            const prev_status = application.status;
            const prev_decision = application.decision || null;
            const newStatus = decision === 'accepted' ? 'accepted' : 'rejected';
            q.run(`UPDATE accelerator_applications SET status = ?, decision = ?, reviewed_at = datetime('now'), reviewed_by = ?, updated_at = datetime('now') WHERE id = ?`,
                [newStatus, decision === 'accepted' ? 'accepted' : 'rejected', (req.user && req.user.email) || 'admin', application.id]);
            const batch = decisionBatch(application.id, decision);
            cancelPendingLike(decisionPrefix(application.id)); // a fresh decision supersedes any still-pending letter
            let queued = false;
            if (application.email) {
                const name = applicantName(application);
                if (decision === 'accepted') {
                    queueEmail({
                        batch, engine: 'accelerator-review-v2', template: 'acc_offer_v2', to: application.email,
                        subject: 'Med&X Accelerator — your offer',
                        html: emailShell('Congratulations — you are in.', `
<p>Dear ${esc(application.first_name || name)},</p>
<p>The review committee is delighted to offer you a place in the <b>Med&amp;X Accelerator</b>. Your application (${esc(application.application_number || '')}) stood out across every criterion.</p>
<p>The offer paperwork follows in a separate message: placement details, dates and what to prepare. Nothing is needed from you until it arrives.</p>
<p>Welcome aboard,<br><b>Med&amp;X Accelerator Team</b></p>`),
                        actor: req.user && req.user.email
                    });
                } else {
                    queueEmail({
                        batch, engine: 'accelerator-review-v2', template: 'acc_kind_no_v2', to: application.email,
                        subject: 'Med&X Accelerator — about your application',
                        html: emailShell('Thank you for applying.', `
<p>Dear ${esc(application.first_name || name)},</p>
<p>Thank you for the time and care you put into your Med&amp;X Accelerator application (${esc(application.application_number || '')}). After a very competitive review, we are unable to offer you a place in this cycle.</p>
<p>This is a decision about a small number of spots, not about your potential. We would be glad to see you apply again next cycle, and Med&amp;X membership keeps every other door open in the meantime.</p>
<p>With respect and best wishes,<br><b>Med&amp;X Accelerator Team</b></p>`),
                        actor: req.user && req.user.email
                    });
                }
                queued = true;
            }
            persist();
            res.json({ success: true, status: newStatus, prev_status, prev_decision, batch_id: batch, queued, warning: queued ? null : 'This applicant has no email on file — no letter was queued.' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/v2/accelerator-review/applications/:id/decision/undo', auth, adminOnly, (req, res) => {
        try {
            const application = getApplication(req.params.id);
            if (!application) return res.status(404).json({ error: 'Application not found' });
            const b = req.body || {};
            const prev = ['draft', 'submitted', 'under_review', 'accepted', 'rejected'].includes(String(b.prev_status)) ? String(b.prev_status) : 'submitted';
            const prevDecision = b.prev_decision != null && b.prev_decision !== '' ? String(b.prev_decision) : null;
            q.run("UPDATE accelerator_applications SET status = ?, decision = ?, updated_at = datetime('now') WHERE id = ?", [prev, prevDecision, application.id]);
            cancelPendingLike(decisionPrefix(application.id));
            persist();
            res.json({ success: true, status: prev });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------------------------------------------------------------- INTERVIEW INVITES (queue both emails)
    const inviteBatch = (appId) => 'accel-rev2-interview-' + appId;
    app.get('/api/v2/accelerator-review/interview-invites', auth, adminOnly, (req, res) => {
        try {
            const year = parseInt(req.query.year, 10);
            let rows;
            const base = `SELECT v.*, i.name AS interviewer_name, i.email AS interviewer_email
                          FROM v2_accel_interview_invites v
                          LEFT JOIN accelerator_interviewers i ON i.id = v.interviewer_id`;
            if (Number.isFinite(year)) {
                rows = q.all(`${base}
                              JOIN accelerator_applications a ON a.id = v.application_id
                              JOIN accelerator_programs p ON p.id = a.program_id
                              WHERE p.year = ? ORDER BY v.created_at DESC`, [year]);
            } else {
                rows = q.all(`${base} ORDER BY v.created_at DESC`);
            }
            res.json({ invites: rows });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/v2/accelerator-review/applications/:id/interview-invite', auth, adminOnly, (req, res) => {
        try {
            const application = getApplication(req.params.id);
            if (!application) return res.status(404).json({ error: 'Application not found' });
            if (!application.email) return res.status(400).json({ error: 'This applicant has no email on file.' });
            const interviewerId = String((req.body || {}).interviewer_id || '');
            const interviewer = q.get('SELECT * FROM accelerator_interviewers WHERE id = ? AND is_active = 1', [interviewerId]);
            if (!interviewer) return res.status(404).json({ error: 'Interviewer not found' });
            if (!interviewer.email) return res.status(400).json({ error: 'This interviewer has no email on file.' });
            const existing = q.get("SELECT * FROM v2_accel_interview_invites WHERE application_id = ? AND status IN ('queued','booked')", [application.id]);
            if (existing && !(req.body && req.body.again)) {
                return res.json({ success: true, already: true, invite_id: existing.id, batch_id: existing.batch_id, status: existing.status });
            }
            if (existing) { q.run("UPDATE v2_accel_interview_invites SET status = 'superseded' WHERE id = ?", [existing.id]); cancelPending(existing.batch_id); }

            // Reuse the legacy magic-link infrastructure: the interviewer's access_token drives /evaluate.
            if (!interviewer.access_token) {
                interviewer.access_token = uuid();
                q.run('UPDATE accelerator_interviewers SET access_token = ? WHERE id = ?', [interviewer.access_token, interviewer.id]);
            }
            try { q.run('INSERT INTO accelerator_interviewer_assignments (id, interviewer_id, application_id) VALUES (?,?,?)', [uuid(), interviewer.id, application.id]); } catch (e) { /* UNIQUE — already assigned */ }
            if (application.status === 'submitted') {
                q.run("UPDATE accelerator_applications SET status = 'under_review', updated_at = datetime('now') WHERE id = ?", [application.id]);
            }

            const token = uuid().replace(/-/g, '');
            const batch = inviteBatch(application.id);
            const inviteId = uuid();
            q.run('INSERT INTO v2_accel_interview_invites (id, application_id, interviewer_id, token, status, batch_id, created_by) VALUES (?,?,?,?,?,?,?)',
                [inviteId, application.id, interviewer.id, token, 'queued', batch, (req.user && req.user.email) || 'admin']);

            const base = publicBase(req);
            const name = applicantName(application);
            const bookingLink = `${base}/api/v2/accelerator-review/book/${token}`;
            queueEmail({
                batch, engine: 'accelerator-review-v2', template: 'acc_interview_applicant_v2', to: application.email,
                subject: 'Med&X Accelerator — book your interview',
                html: emailShell('Your interview awaits.', `
<p>Dear ${esc(application.first_name || name)},</p>
<p>Great news — your Med&amp;X Accelerator application (${esc(application.application_number || '')}) is moving to the interview phase with <b>${esc(interviewer.name)}</b>.</p>
<p style="text-align:center;margin:22px 0"><a href="${esc(bookingLink)}" style="display:inline-block;background:#9b1b22;color:#ffffff;padding:12px 22px;text-decoration:none;font-weight:600;letter-spacing:.08em">BOOK YOUR INTERVIEW SLOT</a></p>
<p style="font-size:12px;color:#4a4239">The link is personal to you. If the button does not work, open: ${esc(bookingLink)}</p>
<p>Good luck,<br><b>Med&amp;X Accelerator Team</b></p>`),
                actor: req.user && req.user.email
            });
            const evaluateLink = `${base}/evaluate?token=${interviewer.access_token}`;
            queueEmail({
                batch, engine: 'accelerator-review-v2', template: 'acc_interview_interviewer_v2', to: interviewer.email,
                subject: `Med&X Accelerator — interview to schedule: ${name}`,
                html: emailShell('A candidate is headed your way.', `
<p>Dear ${esc(interviewer.name)},</p>
<p><b>${esc(name)}</b> (${esc(application.current_institution || 'institution on file')}) has been invited to book an interview with you for the Med&amp;X Accelerator.</p>
<p>Their booking request will arrive by email; the full application and your scoring sheet are in the evaluation system:</p>
<p style="text-align:center;margin:22px 0"><a href="${esc(evaluateLink)}" style="display:inline-block;background:#191512;color:#f7f1e6;padding:12px 22px;text-decoration:none;font-weight:600;letter-spacing:.08em">OPEN THE EVALUATION SYSTEM</a></p>
<p style="font-size:12px;color:#4a4239">This link is unique to you — please do not share it.</p>
<p>Thank you,<br><b>Med&amp;X Accelerator Team</b></p>`),
                actor: req.user && req.user.email
            });
            persist();
            res.json({ success: true, invite_id: inviteId, batch_id: batch, queued: 2 });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- the booking page the applicant email links to (public, tokenized) ----
    function bookingPage(invite, application, interviewer, booked) {
        const name = applicantName(application);
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Med&X Accelerator — interview</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f7f1e6;font-family:Inter,sans-serif;color:#191512}</style></head>
<body><div style="max-width:560px;margin:48px auto;padding:0 20px">
  <div style="font:600 14px Fraunces,serif">Med&amp;X <span style="font:600 8px Inter,sans-serif;letter-spacing:.3em;color:#9b1b22">ACCELERATOR</span></div>
  <div style="margin-top:18px;background:#fdfaf3;border:1px solid rgba(25,21,18,.16);border-top:2px solid #c9a962;padding:28px">
    <div style="font:italic 500 26px Fraunces,serif">${booked ? 'Your slot request is in.' : 'Book your interview.'}</div>
    <p style="font-size:13.5px;line-height:1.7;color:#4a4239;margin:14px 0 6px">
      ${booked
        ? `Thank you, ${esc(application.first_name || name)} — <b>${esc(interviewer ? interviewer.name : 'your interviewer')}</b> has been asked to confirm a time with you by email. Nothing else is needed.`
        : `Dear ${esc(application.first_name || name)}, your Med&amp;X Accelerator interview is with <b>${esc(interviewer ? interviewer.name : 'the committee')}</b>. Confirm below and we will match calendars by email.`}
    </p>
    ${booked ? '' : `<form method="post" action="/api/v2/accelerator-review/book/${esc(invite.token)}/confirm" style="margin-top:18px">
      <button type="submit" style="background:#9b1b22;color:#fff;border:0;padding:12px 22px;font:600 11px Inter,sans-serif;letter-spacing:.14em;cursor:pointer">REQUEST MY SLOT</button>
    </form>`}
  </div>
  <div style="font-size:11px;color:#4a4239;margin-top:12px">Med&amp;X · Zagreb · accelerator@medx.hr</div>
</div></body></html>`;
    }
    function inviteByToken(token) {
        const invite = q.get("SELECT * FROM v2_accel_interview_invites WHERE token = ? AND status IN ('queued','booked')", [String(token || '')]);
        if (!invite) return null;
        return { invite, application: getApplication(invite.application_id), interviewer: q.get('SELECT * FROM accelerator_interviewers WHERE id = ?', [invite.interviewer_id]) };
    }
    app.get('/api/v2/accelerator-review/book/:token', (req, res) => {
        try {
            const hit = inviteByToken(req.params.token);
            if (!hit || !hit.application) return res.status(404).send('<h3 style="font-family:sans-serif">This booking link is no longer valid.</h3>');
            res.type('html').send(bookingPage(hit.invite, hit.application, hit.interviewer, hit.invite.status === 'booked'));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/v2/accelerator-review/book/:token/confirm', (req, res) => {
        try {
            const hit = inviteByToken(req.params.token);
            if (!hit || !hit.application) return res.status(404).send('<h3 style="font-family:sans-serif">This booking link is no longer valid.</h3>');
            if (hit.invite.status !== 'booked') {
                q.run("UPDATE v2_accel_interview_invites SET status = 'booked', booked_at = datetime('now') WHERE id = ?", [hit.invite.id]);
                persist();
                hit.invite.status = 'booked';
            }
            res.type('html').send(bookingPage(hit.invite, hit.application, hit.interviewer, true));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    log('accelerator-review: alumni, intake, scores, notes, decisions, interview-invite routes mounted');
};
