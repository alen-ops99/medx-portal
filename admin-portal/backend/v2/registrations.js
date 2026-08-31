/**
 * v2/registrations.js — backend additions for the redesigned admin REGISTRATIONS destination
 * (admin-portal/frontend-v2 › js/views/registrations.js · artboard: Admin Registrations.dc.html).
 *
 *   GET  /api/v2/registrations/all                      auth+adminOnly — ONE cross-event table:
 *        ?q= &event=all|conference|gala|boston|donor|bridges|forum|signup &status=ALL|PAID|PENDING|FREE
 *        &link=<reg_link_token or invite-link id> &limit= &offset=
 *        → { rows, total, grand_total, stats } — unions registrations + gala_registrations +
 *          bridges_registrations + forum_event_registrations + croatians_abroad_registrations
 *          (source='plexus' rows are the public Plexus Experience form; one sub-row per selected
 *          event, the gala sub-row skipped when a linked gala_registrations row exists) +
 *          signup_form_responses. Every row carries its source-link tag (registration_links.token /
 *          gala_invite_links.id / croatians_abroad_invite_links.id — README: "Every sign-up lands
 *          in Registrations tagged with its source link").
 *   POST /api/v2/registrations/bulk-email               auth+adminOnly ← { recipients:[{email,name}], subject, message }
 *        Stages ONE scheduled_emails row per unique recipient as status='pending_approval'
 *        (INSERT shape copied from the legacy engines, e.g. server.js › gala-program /
 *        event-survey writers; drainScheduledEmails sends only after the human Approve click
 *        on Inbox → Outbox). NOTHING here sends directly.
 *   POST /api/v2/registrations/:type/:id/resend-confirmation   auth+adminOnly
 *        Stages the confirmation re-send in the SAME approval outbox (the legacy
 *        /api/admin/registrant/:type/:id/resend-ticket sends immediately — the redesign
 *        routes every outbound email through the outbox, README note 2).
 *   POST /api/v2/registrations/:type/:id/cancel        auth+adminOnly ← { event? } (event for croatians-abroad sub-rows)
 *        Soft-cancels: status → 'cancelled' (per-event status column for croatians-abroad).
 *        Returns { previous_status } so the client can offer UNDO via /restore.
 *   POST /api/v2/registrations/:type/:id/restore       auth+adminOnly ← { status, event? } — the UNDO.
 *
 * No new tables, no ALTERs — reads/writes existing columns only. Both portals share ONE DB.
 */
'use strict';

module.exports = function mountRegistrations(app, ctx) {
    const { db, auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/registrations]', ...a));
    const uuid = () => require('crypto').randomUUID();

    // ---- sql.js-compatible read helpers (shared/db.js idioms) ----
    function all(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
        catch (e) { log('query failed:', e.message, '—', sql.slice(0, 80)); return []; }
        finally { if (st) st.free(); }
    }
    function one(sql, params) { return all(sql, params)[0] || null; }
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const trim = v => String(v == null ? '' : v).trim();
    const eur = n => '€' + String(Number.isInteger(Number(n)) ? Number(n) : Number(n).toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    function audit(req, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [uuid(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 300)]);
        } catch (e) { /* audit is best-effort */ }
    }

    const CANCELLED = new Set(['cancelled', 'canceled', 'rejected', 'refunded']);
    const isCancelled = s => CANCELLED.has(String(s || '').toLowerCase());

    // ---------------------------------------------------------------- the union
    function buildRows() {
        // Source-link lookups (the tag on every row)
        const regLinks = {}; all('SELECT id, token, label, event_name, link_type FROM registration_links').forEach(l => { if (l.token) regLinks[l.token] = l; });
        const galaLinks = {}; all('SELECT id, label, link_type FROM gala_invite_links').forEach(l => { galaLinks[l.id] = l; });
        const caLinks = {}; all('SELECT id, label, variant FROM croatians_abroad_invite_links').forEach(l => { caLinks[l.id] = l; });

        const linkTag = (token) => { const l = token && regLinks[token]; if (!l) return null; return { ref: token, kind: l.link_type === 'vip' ? 'VIP' : 'LINK', label: l.label || l.event_name || 'Invitation link' }; };
        const rows = [];

        // --- Plexus conference (registrations ⋈ users ⋈ ticket_types) ---
        all(`SELECT r.*, COALESCE(NULLIF(r.first_name,''), u.first_name) AS fn, COALESCE(NULLIF(r.last_name,''), u.last_name) AS ln,
                    COALESCE(NULLIF(r.email,''), u.email) AS em, COALESCE(NULLIF(r.institution,''), u.institution) AS inst, t.name AS ticket_name
             FROM registrations r LEFT JOIN users u ON r.user_id = u.id LEFT JOIN ticket_types t ON r.ticket_type_id = t.id`).forEach(r => {
            const cancelled = isCancelled(r.status) || Number(r.revoked) === 1;
            const paid = r.payment_status === 'paid';
            const owes = ['pending', 'unpaid'].includes(String(r.payment_status || '')) && Number(r.amount_paid) > 0;
            const lt = linkTag(r.reg_link_token);
            const facts = [];
            facts.push(['ENTRY', cancelled ? 'Cancelled' : paid ? `Paid ${eur(r.amount_paid || 0)} · confirmed` : owes ? `Reserved · ${eur(r.amount_paid)} pending` : 'Free · confirmed']);
            if (r.ticket_name) facts.push(['TICKET', r.ticket_name]);
            if (trim(r.dietary_requirements)) facts.push(['MEAL', trim(r.dietary_requirements)]);
            if (Number(r.includes_gala)) facts.push(['GALA', 'Gala add-on included']);
            if (r.user_id) facts.push(['CHECK-IN', 'QR in the member wallet']);
            if (trim(r.applied_for)) facts.push(['APPLIED FOR', trim(r.applied_for)]);
            rows.push({
                key: 'conference:' + r.id, type: 'conference', id: r.id,
                name: [trim(r.fn), trim(r.ln)].filter(Boolean).join(' ') || trim(r.em) || 'Registrant',
                email: trim(r.em), institution: trim(r.inst),
                event: 'Plexus Conference', event_key: 'conference',
                status: cancelled ? 'CANCELLED' : paid ? 'PAID' : owes ? 'PENDING' : 'FREE',
                when: r.created_at, amount: r.amount_paid, checked_in: Number(r.checked_in) === 1,
                link: lt, source_kind: lt ? 'link' : (r.user_id ? 'member' : 'public'),
                source: lt ? lt.label : (r.user_id ? 'Member portal — My Plexus' : 'Public registration form'),
                facts, can_mark_paid: !cancelled && !paid && owes, reg_type: 'conference'
            });
        });

        // --- Gala Evening (gala_registrations) ---
        all('SELECT * FROM gala_registrations').forEach(r => {
            const cancelled = isCancelled(r.status);
            const paid = r.payment_status === 'paid';
            const vip = r.payment_status === 'vip-comp';
            const gl = r.invite_link_id ? galaLinks[r.invite_link_id] : null;
            const lt = linkTag(r.reg_link_token) || (gl ? { ref: r.invite_link_id, kind: gl.link_type === 'vip' ? 'VIP' : 'LINK', label: gl.label || 'Gala invite link' } : null);
            const facts = [];
            facts.push(['SEAT', cancelled ? 'Cancelled — the seat is freed' : vip ? 'VIP · free · named guest' : paid ? `Paid ${eur(r.amount_paid || 150)}${r.stripe_session_id ? ' · card' : ''}${r.seat_number ? ' · seat ' + r.seat_number : ' · table unassigned'}` : (r.status === 'pending' ? 'Requested · awaiting approval' : 'Reserved · payment pending')]);
            if (trim(r.dietary)) facts.push(['MEAL', trim(r.dietary)]);
            if (trim(r.requests)) facts.push(['REQUESTS', trim(r.requests)]);
            if (r.invoice_number) facts.push(['INVOICE', r.invoice_number]);
            if (!paid && !vip && !cancelled) facts.push(['REMINDER', 'Queues to the Outbox from here']);
            rows.push({
                key: 'gala:' + r.id, type: 'gala', id: r.id,
                name: [trim(r.first_name), trim(r.last_name)].filter(Boolean).join(' ') || trim(r.email) || 'Guest',
                email: trim(r.email), institution: trim(r.institution),
                event: 'Gala Evening', event_key: 'gala',
                status: cancelled ? 'CANCELLED' : paid ? 'PAID' : vip ? 'FREE' : 'PENDING',
                when: r.created_at, amount: r.amount_paid, checked_in: Number(r.checked_in) === 1,
                link: lt, source_kind: lt ? 'link' : (r.user_id ? 'member' : 'public'),
                source: lt ? lt.label : (r.user_id ? 'Member portal — Gala section' : 'Public registration form'),
                facts, can_mark_paid: !cancelled && !paid && !vip, reg_type: 'gala'
            });
        });

        // --- Building Bridges + Donor Night (bridges_registrations ⋈ bridges_events) ---
        all(`SELECT br.*, be.name AS ev_name, be.city AS ev_city FROM bridges_registrations br LEFT JOIN bridges_events be ON br.event_id = be.id`).forEach(r => {
            const cancelled = isCancelled(r.status);
            const paid = r.payment_status === 'paid';
            const free = ['n/a', '', null, undefined].includes(r.payment_status);
            const lt = linkTag(r.reg_link_token);
            const evName = r.ev_name || 'Building Bridges';
            const key = /donor/i.test(evName) ? 'donor' : /boston/i.test(evName + ' ' + (r.ev_city || '')) ? 'boston' : 'bridges';
            const facts = [];
            facts.push(['ENTRY', cancelled ? 'Cancelled' : paid ? `Paid ${eur(r.amount_paid || 0)}` : free ? 'Free · ' + (r.status === 'confirmed' ? 'confirmed' : String(r.status || 'registered')) : 'Reserved · payment pending']);
            if (trim(r.position)) facts.push(['ROLE', trim(r.position)]);
            if (trim(r.dietary_requirements)) facts.push(['MEAL', trim(r.dietary_requirements)]);
            if (trim(r.special_requests)) facts.push(['REQUESTS', trim(r.special_requests)]);
            rows.push({
                key: 'bridges:' + r.id, type: 'bridges', id: r.id,
                name: [trim(r.first_name), trim(r.last_name)].filter(Boolean).join(' ') || trim(r.email) || 'Guest',
                email: trim(r.email), institution: trim(r.institution),
                event: evName, event_key: key,
                status: cancelled ? 'CANCELLED' : paid ? 'PAID' : free ? 'FREE' : 'PENDING',
                when: r.registered_at, amount: r.amount_paid, checked_in: Number(r.checked_in) === 1,
                link: lt, source_kind: lt ? 'link' : (r.user_id ? 'member' : 'public'),
                source: lt ? lt.label : (r.user_id ? 'Member portal' : 'Public registration form'),
                facts, can_mark_paid: !cancelled && !paid && !free, reg_type: 'bridges'
            });
        });

        // --- Biomedical Forum gatherings (forum_event_registrations ⋈ forum_events ⋈ forum_members) ---
        all(`SELECT fr.*, fe.title AS ev_title, fm.first_name AS m_fn, fm.last_name AS m_ln, fm.email AS m_em, fm.institution AS m_inst
             FROM forum_event_registrations fr LEFT JOIN forum_events fe ON fr.event_id = fe.id LEFT JOIN forum_members fm ON fr.member_id = fm.id`).forEach(r => {
            const cancelled = isCancelled(r.status);
            const paid = r.payment_status === 'paid' || Number(r.amount_paid) > 0;
            const owes = !paid && Number(r.payment_amount) > 0;
            const lt = linkTag(r.reg_link_token);
            const facts = [];
            facts.push(['ENTRY', cancelled ? 'Cancelled' : paid ? `Paid ${eur(r.amount_paid || r.payment_amount || 0)}` : owes ? 'Reserved · payment pending' : 'Member · confirmed']);
            if (trim(r.dietary) || trim(r.dietary_requirements)) facts.push(['MEAL', trim(r.dietary) || trim(r.dietary_requirements)]);
            if (Number(r.guest_count)) facts.push(['GUESTS', String(r.guest_count)]);
            rows.push({
                key: 'forum:' + r.id, type: 'forum', id: r.id,
                name: [trim(r.first_name) || trim(r.m_fn), trim(r.last_name) || trim(r.m_ln)].filter(Boolean).join(' ') || trim(r.email) || trim(r.m_em) || 'Member',
                email: trim(r.email) || trim(r.m_em), institution: trim(r.institution) || trim(r.m_inst),
                event: r.ev_title || 'Forum gathering', event_key: 'forum',
                status: cancelled ? 'CANCELLED' : paid ? 'PAID' : owes ? 'PENDING' : 'FREE',
                when: r.registered_at, amount: r.amount_paid, checked_in: Number(r.checked_in) === 1,
                link: lt, source_kind: lt ? 'link' : 'member',
                source: lt ? lt.label : 'Forum member registration',
                facts, can_mark_paid: false, reg_type: 'forum'   // forum is outside the mark-paid allowlist (server.js REG_TABLES)
            });
        });

        // --- Public Plexus Experience form + Croatians Abroad (croatians_abroad_registrations) ---
        // One sub-row per selected event; the gala sub-row is skipped when a linked
        // gala_registrations row exists (that row already appears above — no double counting).
        all('SELECT * FROM croatians_abroad_registrations').forEach(r => {
            const isPublicForm = r.source === 'plexus';
            const cl = r.invite_link_id ? caLinks[r.invite_link_id] : null;
            const lt = linkTag(r.reg_link_token) || (cl ? { ref: r.invite_link_id, kind: 'DIASPORA', label: cl.label || 'Diaspora invite link' } : null);
            const source = lt ? lt.label : (r.user_id ? 'Member portal' : isPublicForm ? 'Public form — Plexus Experience' : 'Croatians Abroad form');
            const base = {
                type: 'croatians-abroad', id: r.id,
                name: [trim(r.first_name), trim(r.last_name)].filter(Boolean).join(' ') || trim(r.email) || 'Registrant',
                email: trim(r.email), institution: trim(r.institution),
                when: r.created_at, link: lt,
                source_kind: lt ? 'link' : (r.user_id ? 'member' : 'public'), source,
                reg_type: 'croatians-abroad', gala_id: trim(r.gala_registration_id) || null
            };
            const commonFacts = [];
            if (trim(r.country)) commonFacts.push(['COUNTRY', trim(r.country)]);
            if (trim(r.role)) commonFacts.push(['ROLE', trim(r.role)]);
            if (trim(r.dietary)) commonFacts.push(['MEAL', trim(r.dietary)]);
            if (trim(r.applied_for)) commonFacts.push(['APPLIED FOR', trim(r.applied_for)]);

            if (Number(r.selected_conference) === 1) {
                const cancelled = isCancelled(r.conference_status);
                rows.push({ ...base, key: 'ca:' + r.id + ':conference', ca_event: 'conference',
                    event: 'Plexus Conference', event_key: 'conference',
                    status: cancelled ? 'CANCELLED' : 'FREE', checked_in: Number(r.conference_checked_in) === 1,
                    facts: [['ENTRY', cancelled ? 'Cancelled' : 'Free · ' + (r.conference_status || 'pre-registered')], ...commonFacts],
                    can_mark_paid: false });
            }
            if (Number(r.selected_bridges) === 1) {
                const cancelled = isCancelled(r.bridges_status);
                rows.push({ ...base, key: 'ca:' + r.id + ':bridges', ca_event: 'bridges',
                    event: 'Building Bridges', event_key: 'bridges',
                    status: cancelled ? 'CANCELLED' : 'FREE', checked_in: Number(r.bridges_checked_in) === 1,
                    facts: [['ENTRY', cancelled ? 'Cancelled' : 'Free · ' + (r.bridges_status || 'pre-registered')], ...commonFacts],
                    can_mark_paid: false });
            }
            if (Number(r.selected_gala) === 1 && !trim(r.gala_registration_id)) {
                const cancelled = isCancelled(r.gala_status);
                const paid = r.gala_payment_status === 'paid';
                rows.push({ ...base, key: 'ca:' + r.id + ':gala', ca_event: 'gala',
                    event: 'Gala Evening', event_key: 'gala',
                    status: cancelled ? 'CANCELLED' : paid ? 'PAID' : 'PENDING', amount: r.amount_paid,
                    facts: [['SEAT', cancelled ? 'Cancelled' : paid ? `Paid ${eur(r.amount_paid || 150)}` : 'Reserved · payment pending'], ...commonFacts],
                    can_mark_paid: !cancelled && !paid });
            } else if (Number(r.selected_gala) === 1 && trim(r.gala_registration_id)) {
                // annotate the linked gala row so the panel can jump to it
                const g = rows.find(x => x.key === 'gala:' + r.gala_registration_id);
                if (g) { g.ca_id = r.id; if (!g.link && lt) { g.link = lt; g.source = source; g.source_kind = base.source_kind; } }
            }
        });

        // --- Sign-up form responses (signup_form_responses ⋈ signup_forms) ---
        all(`SELECT sr.*, sf.title AS form_title, sf.slug AS form_slug FROM signup_form_responses sr LEFT JOIN signup_forms sf ON sr.form_id = sf.id`).forEach(r => {
            const facts = [];
            facts.push(['ENTRY', Number(r.is_waitlisted) === 1 ? 'Waitlisted' : 'Confirmed · free']);
            facts.push(['FORM', r.form_title || 'Sign-up form']);
            rows.push({
                key: 'signup:' + r.id, type: 'signup', id: r.id, form_id: r.form_id,
                name: trim(r.name) || trim(r.email) || 'Guest', email: trim(r.email), institution: '',
                event: r.form_title || 'Sign-up form', event_key: 'signup',
                status: Number(r.is_waitlisted) === 1 ? 'PENDING' : 'FREE',
                when: r.created_at, checked_in: Number(r.checked_in) === 1,
                link: null, source_kind: 'form', source: 'Sign-up form — ' + (r.form_title || r.form_slug || ''),
                facts, can_mark_paid: false, reg_type: 'signup'
            });
        });

        rows.sort((a, b) => String(b.when || '').localeCompare(String(a.when || '')));
        return rows;
    }

    function buildStats(rows) {
        const live = rows.filter(r => r.status !== 'CANCELLED');
        const conf = one("SELECT max_capacity FROM conferences WHERE slug = 'plexus-2026'") || {};
        const boston = one("SELECT capacity FROM bridges_events WHERE city LIKE '%Boston%' ORDER BY event_date DESC LIMIT 1") || {};
        const gala = live.filter(r => r.event_key === 'gala');
        return {
            all: live.length,
            conference: live.filter(r => r.event_key === 'conference').length,
            conference_cap: Number(conf.max_capacity) || null,
            gala: gala.length,
            gala_unpaid: gala.filter(r => r.status === 'PENDING').length,
            boston: live.filter(r => r.event_key === 'boston').length,
            boston_cap: Number(boston.capacity) || null
        };
    }

    app.get('/api/v2/registrations/all', auth, adminOnly, (req, res) => {
        try {
            const rows = buildRows();
            const stats = buildStats(rows);
            const q = trim(req.query.q).toLowerCase();
            const event = trim(req.query.event).toLowerCase();
            const status = trim(req.query.status).toUpperCase();
            const link = trim(req.query.link);
            let out = rows;
            if (event && event !== 'all') out = out.filter(r => r.event_key === event);
            if (status && status !== 'ALL') out = out.filter(r => r.status === status);
            if (link) out = out.filter(r => r.link && r.link.ref === link);
            if (q) out = out.filter(r => [r.name, r.email, r.institution, r.event, r.status, r.source, (r.facts || []).map(f => f.join(' ')).join(' ')].join(' ').toLowerCase().includes(q));
            const total = out.length;
            const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
            const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 400));
            res.json({ rows: out.slice(offset, offset + limit), total, grand_total: rows.length, stats });
        } catch (e) { log('all failed:', e.message); res.status(500).json({ error: 'Could not load the registrations.' }); }
    });

    // ---------------------------------------------------------------- outbox writers
    // INSERT shape copied from server.js's approval-outbox writers (status='pending_approval';
    // the ~60s drainer sends only rows an admin flipped to 'scheduled' via outbox approve).
    function stageEmail(batchId, engine, template, to, subject, html, by) {
        db().run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                  VALUES (?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [uuid(), batchId, engine, template, JSON.stringify({ to, subject, html }), to, subject, by || 'admin']);
    }
    function emailShell(bodyHtml) {
        return `<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#15110f;">
            <div style="background:#191512;padding:18px 24px;"><span style="color:#f7f1e6;font-size:18px;letter-spacing:.02em;">Med&amp;X</span></div>
            <div style="height:2px;background:linear-gradient(90deg,#9b1b22,#c9a962);"></div>
            <div style="background:#f7f1e6;padding:26px 24px;font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.65;color:#201b16;">${bodyHtml}</div>
            <div style="background:#191512;padding:14px 24px;font-family:Inter,Arial,sans-serif;font-size:11px;color:rgba(247,241,230,.7);">Med&amp;X · Zagreb · <a href="mailto:info@medx.hr" style="color:#c9a962;">info@medx.hr</a></div>
        </div>`;
    }
    const paragraphs = msg => String(msg).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

    app.post('/api/v2/registrations/bulk-email', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const subject = trim(b.subject);
            const message = trim(b.message);
            if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });
            const list = Array.isArray(b.recipients) ? b.recipients : [];
            const seen = new Set(); const recips = [];
            for (const r of list) {
                const em = trim(r && r.email).toLowerCase();
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) || seen.has(em)) continue;
                seen.add(em); recips.push({ email: trim(r.email), name: trim(r.name) });
                if (recips.length >= 500) break;
            }
            if (!recips.length) return res.status(400).json({ error: 'No sendable recipients in the selection.' });
            const batchId = 'adminregs-' + Date.now().toString(36) + '-' + uuid().slice(0, 6);
            for (const r of recips) {
                const first = (r.name || '').split(/\s+/)[0];
                const html = emailShell((first ? `<p style="margin:0 0 14px;">Dear ${esc(first)},</p>` : '') + paragraphs(message));
                stageEmail(batchId, 'admin-registrations', 'admin_regs_bulk', r.email, subject, html, req.user && req.user.email);
            }
            saveDb();
            audit(req, 'registrations.bulk_email_staged', `"${subject}" → ${recips.length} (awaits Outbox approval)`);
            res.json({ success: true, batch_id: batchId, staged: recips.length, approval_required: true });
        } catch (e) { log('bulk-email failed:', e.message); res.status(500).json({ error: 'Could not queue the email.' }); }
    });

    // type → table map (mirrors server.js REG_TABLES + the two types it lacks)
    const TABLES = {
        conference: { table: 'registrations', evtName: 'Plexus Conference 2026' },
        plexus: { table: 'registrations', evtName: 'Plexus Conference 2026' },
        gala: { table: 'gala_registrations', evtName: 'Plexus 2026 — Gala Evening' },
        bridges: { table: 'bridges_registrations', evtName: 'Building Bridges' },
        'croatians-abroad': { table: 'croatians_abroad_registrations', evtName: 'Plexus 2026' },
        forum: { table: 'forum_event_registrations', evtName: 'Biomedical Forum gathering' },
        signup: { table: 'signup_form_responses', evtName: 'Med&X event' }
    };
    const rowFor = (type, id) => { const t = TABLES[type]; return t ? one(`SELECT * FROM ${t.table} WHERE id = ?`, [id]) : null; };

    app.post('/api/v2/registrations/:type/:id/resend-confirmation', auth, adminOnly, (req, res) => {
        try {
            const t = TABLES[req.params.type];
            const r = t && rowFor(req.params.type, req.params.id);
            if (!r) return res.status(404).json({ error: 'Registrant not found' });
            const email = trim(r.email);
            if (!email) return res.status(400).json({ error: 'This registration has no email address.' });
            const first = trim(r.first_name) || trim(r.name).split(/\s+/)[0] || 'guest';
            const evtName = trim(r.applied_for) || t.evtName;
            const subject = `Your ${evtName} registration`;
            const html = emailShell(`
                <p style="margin:0 0 14px;">Dear <strong>${esc(first)}</strong>,</p>
                <p style="margin:0 0 14px;">This is a fresh copy of your registration confirmation for <strong style="color:#9b1b22;">${esc(evtName)}</strong>, re-sent by the Med&amp;X team.</p>
                <p style="margin:0 0 14px;">Your check-in QR code is in your member wallet in the Med&amp;X portal; questions go to <a href="mailto:info@medx.hr" style="color:#9b1b22;">info@medx.hr</a>.</p>
                <p style="margin:0;">Warm regards,<br><strong>The Med&amp;X Team</strong></p>`);
            const batchId = `adminregs-resend-${req.params.id.slice(0, 8)}-` + Date.now().toString(36);
            stageEmail(batchId, 'admin-registrations', 'resend_confirmation', email, subject, html, req.user && req.user.email);
            saveDb();
            audit(req, 'registrations.resend_staged', `${email} (${req.params.type}) — awaits Outbox approval`);
            res.json({ success: true, batch_id: batchId, staged: 1, approval_required: true });
        } catch (e) { log('resend failed:', e.message); res.status(500).json({ error: 'Could not queue the confirmation.' }); }
    });

    // ---------------------------------------------------------------- soft-cancel + restore (UNDO)
    const CA_COLS = { conference: 'conference_status', bridges: 'bridges_status', gala: 'gala_status' };
    const RESTORE_OK = new Set(['pending', 'confirmed', 'approved', 'registered', 'awaiting_payment', 'pre-registered', 'paid', '']);

    function setStatus(req, res, nextStatus) {
        const type = req.params.type;
        const t = TABLES[type];
        if (!t || type === 'signup') return res.status(400).json({ error: type === 'signup' ? 'Sign-up responses are removed via the existing delete route.' : 'Unknown registrant type' });
        const r = rowFor(type, req.params.id);
        if (!r) return res.status(404).json({ error: 'Registrant not found' });
        let col = 'status';
        if (type === 'croatians-abroad') {
            col = CA_COLS[trim((req.body || {}).event)];
            if (!col) return res.status(400).json({ error: 'event must be one of: conference, bridges, gala' });
        }
        const previous = r[col] == null ? '' : String(r[col]);
        if (nextStatus !== 'cancelled') {           // restore path — validate the target status
            if (!RESTORE_OK.has(String(nextStatus).toLowerCase())) return res.status(400).json({ error: 'Cannot restore to that status.' });
        }
        db().run(`UPDATE ${t.table} SET ${col} = ? WHERE id = ?`, [nextStatus, req.params.id]);
        saveDb();
        audit(req, nextStatus === 'cancelled' ? 'registrations.cancel' : 'registrations.restore', `${r.email || req.params.id} (${type}${col !== 'status' ? '/' + col : ''}) ${previous || '—'} → ${nextStatus}`);
        res.json({ success: true, previous_status: previous, status: nextStatus });
    }

    app.post('/api/v2/registrations/:type/:id/cancel', auth, adminOnly, (req, res) => {
        try { setStatus(req, res, 'cancelled'); }
        catch (e) { log('cancel failed:', e.message); res.status(500).json({ error: 'Could not cancel the registration.' }); }
    });
    app.post('/api/v2/registrations/:type/:id/restore', auth, adminOnly, (req, res) => {
        try { setStatus(req, res, String((req.body || {}).status || 'pending')); }
        catch (e) { log('restore failed:', e.message); res.status(500).json({ error: 'Could not restore the registration.' }); }
    });

    // ---------------------------------------------------------------- seat transfers (additive, 2026-08-31)
    // GET /api/v2/transfer/log — feeds the RECENT TRANSFERS strip on the admin Registrations view.
    // v2_seat_transfers is WRITTEN by the member portal (user-portal/backend/v2/transfer.js —
    // POST /api/v2/transfer/gala moves a Gala seat to a colleague in place, same registration id +
    // QR). Both portals share ONE database, so the table is declared identically here (the same
    // pattern as croatians_abroad_registrations.user_id) in case the admin server boots first —
    // the one exception to this file's "no new tables" header note, which predates this strip.
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_seat_transfers (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            registration_ref TEXT NOT NULL,
            from_email TEXT,
            to_name TEXT,
            to_email TEXT,
            status TEXT DEFAULT 'done',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (e) { log('v2_seat_transfers schema failed:', e.message); }

    app.get('/api/v2/transfer/log', auth, adminOnly, (req, res) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
            const rows = all(`SELECT id, kind, registration_ref, from_email, to_name, to_email, status, created_at
                                FROM v2_seat_transfers ORDER BY created_at DESC LIMIT ?`, [limit]);
            const transfers = rows.map(t => {
                // "which registration" — the row the seat lives on today (holder already = the new person)
                let event = 'Gala Evening', reg = null;
                if (t.kind === 'gala') {
                    reg = one('SELECT email, status, payment_status, checked_in FROM gala_registrations WHERE id = ?', [t.registration_ref]);
                } else {
                    reg = one('SELECT email, gala_status AS status, gala_payment_status AS payment_status, selected_conference FROM croatians_abroad_registrations WHERE id = ?', [t.registration_ref]);
                    event = reg && Number(reg.selected_conference) === 1 ? 'Gala Evening + Conference (public form)' : 'Gala Evening (public form)';
                }
                return {
                    id: t.id, kind: t.kind, registration_ref: t.registration_ref, event,
                    from_email: t.from_email, to_name: t.to_name, to_email: t.to_email,
                    status: t.status, created_at: t.created_at,
                    registration_status: reg ? (reg.payment_status === 'paid' || reg.payment_status === 'vip-comp' ? 'PAID' : String(reg.status || 'pending').toUpperCase()) : 'MISSING',
                    checked_in: !!(reg && Number(reg.checked_in) === 1)
                };
            });
            const totalRow = one('SELECT COUNT(*) AS c FROM v2_seat_transfers');
            res.json({ transfers, total: (totalRow && totalRow.c) || 0 });
        } catch (e) { log('transfer log failed:', e.message); res.status(500).json({ error: 'Could not read the transfer log.' }); }
    });
};
