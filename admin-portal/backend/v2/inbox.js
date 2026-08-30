/**
 * admin-portal/backend/v2/inbox.js — backend for the redesigned INBOX destination
 * (frontend-v2 js/views/inbox.js, routes /inbox/*). Mounted by v2/index.js.
 *
 * The approval outbox is the SPINE (README note 2): nothing here sends an email directly.
 * Every audience email and newsletter is STAGED into the existing `scheduled_emails` table as
 * status='pending_approval' under a batch_id; the ONE human click that releases a batch stays
 * the existing POST /api/admin/outbox/:batch/approve, and delivery stays the existing
 * drainScheduledEmails() loop — no second send path. The only direct sendEmail() call is
 * "send a test to MYSELF" (the signed-in admin's own address, never a member).
 *
 * Owned additions (guarded, additive, shared DB — never rename/drop):
 *   direct_messages.topic                  topic tag on member messages (README note 24; the
 *                                          member portal's v2/messages.js adds the same column)
 *   v2_message_thread_state                archive = hide, never delete (DDL verbatim from
 *                                          user-portal/backend/v2/messages.js; admin rows use the
 *                                          admin's users.id so each admin keeps their own archive)
 *   v2_newsletter_subscriptions/_sends     DDL verbatim from user-portal/backend/v2/newsletter.js
 *                                          so the admin side works even before the member backend
 *                                          has booted on a fresh DB (source of truth is shared)
 *   v2_inbox_portal_posts                  a newsletter's "post in the member portal" half: recorded
 *                                          at queue time, PUBLISHED into `feed_items` (the member
 *                                          home feed, existing routes/tables) only after the batch
 *                                          passes the outbox approval gate — same one approval.
 *
 * Routes (all admin-JWT + adminOnly, under /api/v2/inbox/…):
 *   GET  /audiences                        the EMAIL REGISTRANTS dropdown + per-person tick lists
 *   POST /compose                          stage an audience email into the outbox (or test-to-self)
 *   GET  /outbox/:batch                    per-item detail + preview html for one batch
 *   POST /outbox/:batch/edit               edit subject/body of a batch still pending approval
 *   POST /outbox/:batch/unschedule         a batch approved for LATER (still unsent, future
 *                                          scheduled_for) → back to pending_approval (the artboard's
 *                                          CANCEL on "SENDS TOMORROW 09:00")
 *   GET  /threads                          member message threads (topic, unread, archived, names)
 *   POST /threads/:key/read {read}         mark a member's inbound messages read / unread
 *   POST /threads/:key/archive {archived}  hide (never delete); auto-reopens on a new message
 *   GET  /newsletter                       per-topic subscriber counts + drafts & history
 *   POST /newsletter/queue                 stage a newsletter into the outbox (email and/or portal)
 *   GET  /badges                           {outbox_batches, outbox_emails, unread_messages}
 */
'use strict';

const { randomUUID } = require('crypto');

const NL_TOPICS = ['all', 'plexus', 'gala', 'accelerator', 'bridges', 'forum'];
const NL_LABELS = { all: 'All Med&X', plexus: 'Plexus', gala: 'Gala Evening', accelerator: 'Accelerator', bridges: 'Building Bridges', forum: 'Biomedical Forum' };
const MAX_BODY = 8000;
const MAX_SUBJECT = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// "Test rows are excluded automatically" (artboard). The staging pseudonym scrub names everyone
// "Member NNN Test" @staging.medx.hr — those ARE the stand-ins for real members, so the rule
// matches only explicitly test-flavoured ADDRESSES, never the scrubbed names.
const TEST_EMAIL_RE = /(^|[.+_-])test[.+_-]?@|@(test|example)\./i;

module.exports = function mountInbox(app, ctx) {
    const { auth, adminOnly, sendEmail } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/inbox]', ...a));
    const db = () => ctx.db();
    const save = () => { try { ctx.saveDb && ctx.saveDb(); } catch (e) { /* best-effort */ } };
    const all = (sql, params = []) => {
        const s = db().prepare(sql);
        if (params.length) s.bind(params);
        const rows = [];
        while (s.step()) rows.push(s.getAsObject());
        s.free();
        return rows;
    };
    const one = (sql, params = []) => all(sql, params)[0] || null;
    const run = (sql, params = []) => db().run(sql, params);
    const fail = (res, err, msg) => { console.error('[v2/inbox]', err); res.status(500).json({ error: msg || 'Something went wrong — please try again.' }); };

    // ---- schema (additive, guarded) ----
    try { run('ALTER TABLE direct_messages ADD COLUMN topic TEXT'); } catch (e) { /* exists */ }
    try {
        run(`CREATE TABLE IF NOT EXISTS v2_message_thread_state (
            user_id TEXT NOT NULL,
            thread_key TEXT NOT NULL,
            archived INTEGER DEFAULT 0,
            archived_at TEXT,
            updated_at TEXT,
            PRIMARY KEY (user_id, thread_key)
        )`);
    } catch (e) { log('v2_message_thread_state create skipped:', e.message); }
    try {
        run(`CREATE TABLE IF NOT EXISTS v2_newsletter_subscriptions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            email TEXT NOT NULL UNIQUE,
            topics TEXT NOT NULL DEFAULT '["all"]',
            confirmed_at TEXT,
            unsubscribed_at TEXT,
            manage_token TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        run(`CREATE TABLE IF NOT EXISTS v2_newsletter_sends (
            id TEXT PRIMARY KEY,
            subject TEXT,
            topic TEXT,
            items_json TEXT,
            recipient_count INTEGER DEFAULT 0,
            sent_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'sending',
            test_to TEXT,
            last_error TEXT,
            sent_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            finished_at TEXT
        )`);
        run('CREATE INDEX IF NOT EXISTS idx_v2_nl_subs_user ON v2_newsletter_subscriptions (user_id)');
    } catch (e) { log('newsletter tables create skipped:', e.message); }
    try {
        run(`CREATE TABLE IF NOT EXISTS v2_inbox_portal_posts (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT,
            topic TEXT,
            status TEXT DEFAULT 'pending',
            feed_item_id TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            posted_at TEXT
        )`);
    } catch (e) { log('v2_inbox_portal_posts create skipped:', e.message); }

    // ---- branded email (email-client-safe: 600px table, inline CSS, no webfonts) ----
    const escHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const logoUrl = () => (process.env.EMAIL_LOGO_URL
        || ((process.env.RENDER_EXTERNAL_URL || process.env.ADMIN_PORTAL_URL || ('http://localhost:' + (process.env.PORT || 3002))).replace(/\/+$/, '') + '/assets/email-logo.png'));
    const paragraphs = (text) => String(text || '').trim().split(/\n\s*\n/).map(p =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4a4239;">${escHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
    // The artboard's "HOW IT WILL LOOK" card: ink header band with the wordmark, "Dear <first name>,",
    // the plain-text body as paragraphs, a hairline footer.
    function buildHtml({ firstName, body, footerNote }) {
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e1d8;">
<tr><td style="background:#191512;padding:14px 24px;"><img src="${logoUrl()}" alt="Med&amp;X" height="16" style="display:block;height:16px;border:0;"></td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#191512;">Dear ${escHtml(firstName || 'friend of Med&X')},</p>
${paragraphs(body)}
<p style="margin:18px 0 0;padding-top:12px;border-top:1px solid #eee9df;font-size:11px;line-height:1.6;color:#8a8177;">${escHtml(footerNote || 'You are receiving this from the Med&X team in Zagreb. Just reply to reach us.')}</p>
</td></tr></table></td></tr></table></body></html>`;
    }

    // ---- audiences (the EMAIL REGISTRANTS dropdown + tick lists) ----
    const cleanEmail = (v) => String(v || '').trim().toLowerCase();
    const isRealRecipient = (email) => EMAIL_RE.test(email) && !TEST_EMAIL_RE.test(email);
    const person = (first, last, email, tag, flags) => ({
        key: cleanEmail(email),
        name: [first, last].filter(Boolean).join(' ').trim() || email,
        first_name: String(first || '').trim() || null,
        email: cleanEmail(email),
        tag,
        paid: flags && 'paid' in flags ? !!flags.paid : null,
        checked_in: flags && 'checked_in' in flags ? !!flags.checked_in : null
    });
    function buildAudiences() {
        const groups = [];
        // Plexus conference (active edition)
        const conf = one('SELECT id, name, year FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1');
        let confPeople = [];
        if (conf) {
            confPeople = all(
                `SELECT COALESCE(NULLIF(TRIM(r.first_name), ''), u.first_name) AS fn,
                        COALESCE(NULLIF(TRIM(r.last_name), ''), u.last_name) AS ln,
                        COALESCE(NULLIF(TRIM(r.email), ''), u.email) AS em,
                        r.payment_status, r.checked_in
                   FROM registrations r LEFT JOIN users u ON u.id = r.user_id
                  WHERE r.conference_id = ? AND COALESCE(r.status, '') NOT IN ('cancelled', 'rejected')`, [conf.id])
                .filter(r => isRealRecipient(cleanEmail(r.em)))
                .map(r => person(r.fn, r.ln, r.em, 'PLEXUS', { paid: true, checked_in: !!Number(r.checked_in) }));
        }
        // Gala
        const galaPeople = all(
            `SELECT first_name, last_name, email, payment_status, checked_in FROM gala_registrations
              WHERE COALESCE(status, '') NOT IN ('rejected', 'cancelled')`)
            .filter(r => isRealRecipient(cleanEmail(r.email)))
            .map(r => {
                const paid = String(r.payment_status || '') === 'paid';
                return person(r.first_name, r.last_name, r.email, paid ? 'GALA' : 'GALA · UNPAID', { paid, checked_in: !!Number(r.checked_in) });
            });
        // Building Bridges — one group per upcoming event
        const bridgeGroups = [];
        try {
            const events = all(`SELECT id, city, event_date FROM bridges_events
                                 WHERE event_date IS NOT NULL AND event_date >= date('now') ORDER BY event_date ASC`);
            events.forEach(ev => {
                const people = all(
                    `SELECT first_name, last_name, email, payment_status, checked_in FROM bridges_registrations
                      WHERE event_id = ? AND COALESCE(status, '') NOT IN ('cancelled', 'rejected')`, [ev.id])
                    .filter(r => isRealRecipient(cleanEmail(r.email)))
                    .map(r => person(r.first_name, r.last_name, r.email, String(ev.city || 'BRIDGES').toUpperCase(),
                        { paid: ['paid', 'comp'].includes(String(r.payment_status || '')), checked_in: !!Number(r.checked_in) }));
                bridgeGroups.push({ key: 'bridges-' + ev.id, label: 'Building Bridges ' + (ev.city || ''), people });
            });
        } catch (e) { /* bridges tables optional */ }
        // Newsletter subscribers (active only)
        let nlPeople = [];
        try {
            nlPeople = all('SELECT email, user_id FROM v2_newsletter_subscriptions WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL')
                .filter(r => isRealRecipient(cleanEmail(r.email)))
                .map(r => {
                    const u = r.user_id ? one('SELECT first_name, last_name FROM users WHERE id = ?', [r.user_id]) : null;
                    return person(u && u.first_name, u && u.last_name, r.email, 'NEWSLETTER', {});
                });
        } catch (e) { nlPeople = []; }
        // Everyone (all events) — union of the event audiences, deduped by address
        const seen = new Map();
        [...confPeople, ...galaPeople, ...bridgeGroups.flatMap(g => g.people)].forEach(p => { if (!seen.has(p.key)) seen.set(p.key, p); });
        const everyone = Array.from(seen.values());
        const paidN = galaPeople.filter(p => p.paid).length;
        groups.push({ key: 'everyone', label: 'Everyone (all events)', people: everyone });
        groups.push({ key: 'conference', label: conf ? conf.name : 'Plexus Conference', people: confPeople });
        groups.push({ key: 'gala', label: `Gala Evening`, sub: `${paidN} paid · ${galaPeople.length - paidN} unpaid`, people: galaPeople });
        bridgeGroups.forEach(g => groups.push(g));
        groups.push({ key: 'newsletter', label: 'Newsletter subscribers', people: nlPeople });
        groups.forEach(g => { g.count = g.people.length; g.people.sort((a, b) => a.name.localeCompare(b.name)); });
        return groups;
    }

    app.get('/api/v2/inbox/audiences', auth, adminOnly, (req, res) => {
        try { res.json({ groups: buildAudiences() }); } catch (err) { fail(res, err, 'Could not load the audiences.'); }
    });

    // ---- compose → the outbox (never a direct member send) ----
    app.post('/api/v2/inbox/compose', auth, adminOnly, async (req, res) => {
        try {
            const b = req.body || {};
            const subject = String(b.subject || '').trim();
            const body = String(b.body || '').trim();
            if (!subject && !body) return res.status(400).json({ error: 'Write a subject or a message first.' });
            if (subject.length > MAX_SUBJECT) return res.status(400).json({ error: `Keep the subject under ${MAX_SUBJECT} characters.` });
            if (body.length > MAX_BODY) return res.status(400).json({ error: `Keep the message under ${MAX_BODY} characters.` });
            const me = req.user || {};

            // Send a test to MYSELF — the one direct send; it goes to the signed-in admin only.
            if (b.test) {
                if (!me.email) return res.status(400).json({ error: 'Your admin account has no email address.' });
                const html = buildHtml({ firstName: (me.email || '').split('@')[0].split('.')[0].replace(/^\w/, c => c.toUpperCase()), body: body || '(no message yet)' });
                const r = await sendEmail(me.email, '[TEST] ' + (subject || 'Untitled email'), html, undefined, me.email);
                return res.json({ ok: true, test: true, to: me.email, mock: !!(r && r.mock) });
            }

            // Resolve recipients SERVER-side from the audience snapshot (ticks override the dropdown).
            const groups = buildAudiences();
            const group = groups.find(g => g.key === String(b.audience || 'everyone')) || groups[0];
            let people = group.people.slice();
            const filter = String(b.filter || '');
            if (filter === 'unpaid') people = people.filter(p => p.paid === false);
            else if (filter === 'checked_in') people = people.filter(p => p.checked_in === true);
            else if (filter === 'not_checked_in') people = people.filter(p => p.checked_in === false);
            if (b.manual) {
                const picked = new Set((Array.isArray(b.picked) ? b.picked : []).map(cleanEmail).filter(Boolean));
                // hand-picked ticks may reach across groups — pull from every group, dedupe
                const byKey = new Map();
                groups.flatMap(g => g.people).forEach(p => { if (!byKey.has(p.key)) byKey.set(p.key, p); });
                people = Array.from(picked).map(k => byKey.get(k)).filter(Boolean);
            }
            const seen = new Set();
            people = people.filter(p => { if (seen.has(p.key)) return false; seen.add(p.key); return true; });
            if (!people.length) return res.status(400).json({ error: 'No recipients after the filters — nothing was queued.' });

            const batchId = 'admin-compose-' + Date.now().toString(36) + '-' + randomUUID().slice(0, 5);
            const replyTo = me.email || null;
            people.forEach(p => {
                const payload = {
                    to: p.email, subject, body_text: body, first_name: p.first_name,
                    html: buildHtml({ firstName: p.first_name, body }), reply_to: replyTo,
                    audience: group.key, tag: p.tag
                };
                run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                     VALUES (?, 'pending_approval', ?, 'admin-compose', 'admin_compose', ?, ?, ?, ?, datetime('now'))`,
                    [randomUUID(), batchId, JSON.stringify(payload), p.email, subject || '(no subject)', me.email || 'admin']);
            });
            save();
            log(`compose staged ${people.length} email(s) in ${batchId} (audience ${group.key}${b.manual ? ', hand-picked' : ''})`);
            res.json({ ok: true, batch_id: batchId, queued: people.length });
        } catch (err) { fail(res, err, 'Could not queue the email.'); }
    });

    // ---- one batch: items + preview (+ whether the composer can edit it) ----
    app.get('/api/v2/inbox/outbox/:batch', auth, adminOnly, (req, res) => {
        try {
            const batch = String(req.params.batch || '');
            const rows = all(`SELECT id, status, recipient_email, subject, payload_json, scheduled_for, source_engine, template, created_at
                                FROM scheduled_emails WHERE batch_id = ? ORDER BY created_at ASC, rowid ASC`, [batch]);
            if (!rows.length) return res.status(404).json({ error: 'No such batch.' });
            const parse = (r) => { try { return r.payload_json ? JSON.parse(r.payload_json) : {}; } catch (e) { return {}; } };
            const first = parse(rows[0]);
            const items = rows.map(r => { const p = parse(r); return { id: r.id, to: p.to || r.recipient_email, status: r.status, scheduled_for: r.scheduled_for || null }; });
            res.json({
                batch_id: batch,
                source_engine: rows[0].source_engine || null,
                count: rows.length,
                items,
                editable: rows.every(r => r.status === 'pending_approval') && ['admin-compose', 'v2-newsletter'].includes(rows[0].source_engine || ''),
                preview: {
                    subject: first.subject || rows[0].subject || '(no subject)',
                    to: first.to || rows[0].recipient_email || null,
                    body_text: first.body_text || null,
                    html: first.html || first.body_html || first.body || null
                }
            });
        } catch (err) { fail(res, err, 'Could not load that batch.'); }
    });

    // ---- edit a pending batch (subject/body) — it stays pending, approval still required ----
    app.post('/api/v2/inbox/outbox/:batch/edit', auth, adminOnly, (req, res) => {
        try {
            const batch = String(req.params.batch || '');
            const b = req.body || {};
            const subject = b.subject != null ? String(b.subject).trim() : null;
            const body = b.body != null ? String(b.body).trim() : null;
            if (subject == null && body == null) return res.status(400).json({ error: 'Nothing to change.' });
            if (subject != null && subject.length > MAX_SUBJECT) return res.status(400).json({ error: `Keep the subject under ${MAX_SUBJECT} characters.` });
            if (body != null && body.length > MAX_BODY) return res.status(400).json({ error: `Keep the message under ${MAX_BODY} characters.` });
            const rows = all(`SELECT id, payload_json, subject FROM scheduled_emails WHERE batch_id = ? AND status = 'pending_approval'`, [batch]);
            if (!rows.length) return res.status(404).json({ error: 'That batch is not editable any more — it already left the waiting list.' });
            rows.forEach(r => {
                let p = {}; try { p = r.payload_json ? JSON.parse(r.payload_json) : {}; } catch (e) { p = {}; }
                if (subject != null && subject) { p.subject = subject; }
                if (body != null) { p.body_text = body; p.html = buildHtml({ firstName: p.first_name, body }); }
                run('UPDATE scheduled_emails SET payload_json = ?, subject = ? WHERE id = ?',
                    [JSON.stringify(p), (subject != null && subject) ? subject : r.subject, r.id]);
            });
            save();
            res.json({ ok: true, edited: rows.length });
        } catch (err) { fail(res, err, 'Could not edit that batch.'); }
    });

    // ---- pull an approved-for-later batch back to the waiting list (nothing has been sent) ----
    app.post('/api/v2/inbox/outbox/:batch/unschedule', auth, adminOnly, (req, res) => {
        try {
            const batch = String(req.params.batch || '');
            const due = one(`SELECT COUNT(*) AS n FROM scheduled_emails
                              WHERE batch_id = ? AND status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for > datetime('now')`, [batch]);
            if (!due || !Number(due.n)) return res.status(404).json({ error: 'Nothing waiting to send later in that batch.' });
            run(`UPDATE scheduled_emails SET status = 'pending_approval', approved_by = NULL, scheduled_for = NULL
                  WHERE batch_id = ? AND status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for > datetime('now')`, [batch]);
            save();
            res.json({ ok: true, returned: Number(due.n) });
        } catch (err) { fail(res, err, 'Could not cancel the scheduled send.'); }
    });

    // ---- member message threads (topic tags · unread · archive) ----
    const threadState = (adminId) => {
        const out = {};
        try { all('SELECT thread_key, archived, archived_at FROM v2_message_thread_state WHERE user_id = ?', [adminId]).forEach(r => { out[r.thread_key] = r; }); } catch (e) { /* table missing */ }
        return out;
    };
    app.get('/api/v2/inbox/threads', auth, adminOnly, (req, res) => {
        try {
            const adminId = String((req.user && req.user.id) || 'admin');
            const rows = all(`SELECT id, sender_id, receiver_id, sender_type, receiver_type, title, topic, content, is_read, created_at
                                FROM direct_messages
                               WHERE COALESCE(sender_type,'user') = 'admin' OR COALESCE(receiver_type,'user') = 'admin'
                               ORDER BY created_at ASC, rowid ASC`);
            const byMember = new Map();
            rows.forEach(r => {
                const inbound = String(r.sender_type || 'user') !== 'admin';
                const rawKey = String(inbound ? r.sender_id : r.receiver_id || '');
                if (!rawKey) return;
                const u = one('SELECT id, email, first_name, last_name, institution FROM users WHERE id = ?', [rawKey])
                    || one('SELECT id, email, first_name, last_name, institution FROM users WHERE LOWER(email) = LOWER(?)', [rawKey]);
                const key = u ? u.id : rawKey;
                if (!byMember.has(key)) byMember.set(key, { key, user: u, rows: [] });
                byMember.get(key).rows.push(Object.assign({ inbound }, r));
            });
            const state = threadState(adminId);
            const threads = Array.from(byMember.values()).map(t => {
                const last = t.rows[t.rows.length - 1];
                const unread = t.rows.filter(r => r.inbound && !Number(r.is_read || 0)).length;
                const lastTopic = [...t.rows].reverse().find(r => r.inbound && r.topic);
                const st = state[t.key];
                let archived = !!(st && Number(st.archived));
                // archive hides until something NEW arrives — a newer message reopens the thread
                if (archived && st.archived_at && String(last.created_at) > String(st.archived_at)) {
                    archived = false;
                    try { run("UPDATE v2_message_thread_state SET archived = 0, updated_at = datetime('now') WHERE user_id = ? AND thread_key = ?", [adminId, t.key]); save(); } catch (e) { /* best-effort */ }
                }
                const u = t.user || {};
                return {
                    key: t.key,
                    name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || t.key,
                    email: u.email || null,
                    institution: u.institution || null,
                    gone: !t.user,
                    topic: (lastTopic && lastTopic.topic) || null,
                    topic_label: (lastTopic && (lastTopic.title || lastTopic.topic)) || null,
                    unread,
                    archived,
                    count: t.rows.length,
                    last: { content: last.content || '', at: last.created_at, mine: !last.inbound }
                };
            }).sort((a, b) => String(b.last.at).localeCompare(String(a.last.at)));
            res.json({ threads, unread: threads.filter(t => !t.archived).reduce((n, t) => n + t.unread, 0) });
        } catch (err) { fail(res, err, 'Could not load the member messages.'); }
    });

    app.post('/api/v2/inbox/threads/:key/read', auth, adminOnly, (req, res) => {
        try {
            const key = String(req.params.key || '').trim();
            if (!key || key.length > 120) return res.status(400).json({ error: 'Unknown thread.' });
            const u = one('SELECT id, email FROM users WHERE id = ?', [key]) || one('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?)', [key]);
            const k1 = key, k2 = u ? u.id : key, k3 = u && u.email ? u.email : key;
            const read = !(req.body && (req.body.read === false || req.body.read === 0));
            run(`UPDATE direct_messages SET is_read = ? WHERE sender_id IN (?, ?, ?) AND COALESCE(receiver_type,'user') = 'admin'`, [read ? 1 : 0, k1, k2, k3]);
            save();
            res.json({ ok: true, key, read });
        } catch (err) { fail(res, err, 'Could not update that thread.'); }
    });

    app.post('/api/v2/inbox/threads/:key/archive', auth, adminOnly, (req, res) => {
        try {
            const adminId = String((req.user && req.user.id) || 'admin');
            const key = String(req.params.key || '').trim();
            if (!key || key.length > 120) return res.status(400).json({ error: 'Unknown thread.' });
            const archived = req.body && (req.body.archived === false || req.body.archived === 0 || req.body.archived === '0') ? 0 : 1;
            run(`INSERT INTO v2_message_thread_state (user_id, thread_key, archived, archived_at, updated_at)
                 VALUES (?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
                 ON CONFLICT(user_id, thread_key) DO UPDATE SET archived = excluded.archived, archived_at = excluded.archived_at, updated_at = excluded.updated_at`,
                [adminId, key, archived, archived]);
            save();
            res.json({ ok: true, key, archived: !!archived });
        } catch (err) { fail(res, err, 'Could not update that thread.'); }
    });

    // ---- newsletter: counts, history, queue-into-outbox ----
    const parseTopics = (row) => { try { const a = JSON.parse(row.topics || '[]'); return Array.isArray(a) && a.length ? a : ['all']; } catch (e) { return ['all']; } };
    const topicMatch = (row, topic) => { if (!topic || topic === 'all') return true; const t = parseTopics(row); return t.includes('all') || t.includes(topic); };
    const activeSubs = () => {
        try {
            return all('SELECT * FROM v2_newsletter_subscriptions WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL ORDER BY created_at ASC')
                .filter(r => EMAIL_RE.test(cleanEmail(r.email)))
                .filter(r => {
                    try {
                        const o = one('SELECT scopes FROM email_optouts WHERE email = ?', [cleanEmail(r.email)]);
                        return !(o && String(o.scopes || '').split(',').map(s => s.trim()).includes('newsletter'));
                    } catch (e) { return true; }
                });
        } catch (e) { return []; }
    };
    app.get('/api/v2/inbox/newsletter', auth, adminOnly, (req, res) => {
        try {
            const subs = activeSubs();
            const topics = NL_TOPICS.map(t => ({ key: t, label: NL_LABELS[t], count: subs.filter(r => topicMatch(r, t)).length }));
            const batches = all(`SELECT batch_id, status, COUNT(*) AS cnt, MIN(subject) AS subject, MIN(created_at) AS created_at
                                   FROM scheduled_emails WHERE source_engine = 'v2-newsletter' AND batch_id IS NOT NULL
                                  GROUP BY batch_id, status ORDER BY MIN(created_at) DESC LIMIT 20`);
            const posts = all(`SELECT batch_id, status, title, posted_at FROM v2_inbox_portal_posts ORDER BY created_at DESC LIMIT 20`);
            const postBy = {}; posts.forEach(p => { postBy[p.batch_id] = p; });
            const history = [];
            const seen = new Set();
            batches.forEach(b => {
                const kb = b.batch_id + '|' + b.status;
                if (seen.has(kb)) return; seen.add(kb);
                history.push({ batch_id: b.batch_id, status: b.status, count: b.cnt, subject: b.subject, created_at: b.created_at, portal: postBy[b.batch_id] ? postBy[b.batch_id].status : null });
            });
            let sends = [];
            try { sends = all('SELECT id, subject, topic, recipient_count, sent_count, failed_count, status, created_at FROM v2_newsletter_sends ORDER BY created_at DESC LIMIT 10'); } catch (e) { sends = []; }
            res.json({ total_active: subs.length, topics, history, sends });
        } catch (err) { fail(res, err, 'Could not load the newsletter.'); }
    });

    app.post('/api/v2/inbox/newsletter/queue', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const subject = String(b.subject || '').trim();
            const body = String(b.body || '').trim();
            const topic = NL_TOPICS.includes(String(b.topic || 'all')) ? String(b.topic || 'all') : 'all';
            const asEmail = b.email !== false;
            const asPortal = !!b.portal;
            if (!subject) return res.status(400).json({ error: 'Give the newsletter a subject first.' });
            if (!body) return res.status(400).json({ error: 'Write the newsletter first.' });
            if (!asEmail && !asPortal) return res.status(400).json({ error: 'Pick email, the portal, or both.' });
            if (subject.length > MAX_SUBJECT || body.length > MAX_BODY) return res.status(400).json({ error: 'That newsletter is too long.' });
            const me = req.user || {};
            const replace = String(b.replace_batch || '').trim();

            const subs = activeSubs().filter(r => topicMatch(r, topic));
            if (asEmail && !subs.length) return res.status(400).json({ error: 'No active subscribers for that topic yet.' });

            const batchId = 'v2nl-' + Date.now().toString(36) + '-' + randomUUID().slice(0, 5);
            const footer = 'The Med&X newsletter · manage your topics from the member portal (Profile & settings) or just reply to unsubscribe.';
            if (asEmail) {
                subs.forEach(s => {
                    const u = s.user_id ? one('SELECT first_name FROM users WHERE id = ?', [s.user_id]) : null;
                    const payload = {
                        to: cleanEmail(s.email), subject, body_text: body, first_name: (u && u.first_name) || null,
                        html: buildHtml({ firstName: u && u.first_name, body, footerNote: footer }),
                        topic, reply_to: me.email || null
                    };
                    run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                         VALUES (?, 'pending_approval', ?, 'v2-newsletter', 'newsletter', ?, ?, ?, ?, datetime('now'))`,
                        [randomUUID(), batchId, JSON.stringify(payload), cleanEmail(s.email), subject, me.email || 'admin']);
                });
            } else {
                // portal-only: the approval gate still applies — the one staged row is an archive
                // copy to the APPROVING ADMIN's own address, never a member.
                const payload = { to: me.email, subject: '[Portal post] ' + subject, body_text: body, first_name: null, html: buildHtml({ firstName: null, body, footerNote: footer }), topic };
                run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                     VALUES (?, 'pending_approval', ?, 'v2-newsletter', 'newsletter_portal', ?, ?, ?, ?, datetime('now'))`,
                    [randomUUID(), batchId, JSON.stringify(payload), me.email || '', '[Portal post] ' + subject, me.email || 'admin']);
            }
            if (asPortal) {
                run(`INSERT INTO v2_inbox_portal_posts (id, batch_id, title, body, topic, status, created_by, created_at)
                     VALUES (?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
                    [randomUUID(), batchId, subject, body, topic, me.email || 'admin']);
            }
            if (replace) {
                try {
                    run(`UPDATE scheduled_emails SET status = 'cancelled' WHERE batch_id = ? AND source_engine = 'v2-newsletter' AND status = 'pending_approval'`, [replace]);
                    run(`UPDATE v2_inbox_portal_posts SET status = 'cancelled' WHERE batch_id = ? AND status = 'pending'`, [replace]);
                } catch (e) { /* replacing is best-effort */ }
            }
            save();
            log(`newsletter queued (${topic}) → ${batchId}: ${asEmail ? subs.length + ' email(s)' : 'portal only'}${asPortal ? ' + portal post' : ''}`);
            res.json({ ok: true, batch_id: batchId, queued: asEmail ? subs.length : 0, portal: asPortal, replaced: replace || null });
        } catch (err) { fail(res, err, 'Could not queue the newsletter.'); }
    });

    // The portal half of a newsletter publishes into feed_items (the member home feed) ONLY once
    // its batch has passed the outbox approval gate. Approval is still the existing
    // POST /api/admin/outbox/:batch/approve — this watcher only reacts to what that click did.
    function publishApprovedPortalPosts() {
        let pending;
        try { pending = all(`SELECT * FROM v2_inbox_portal_posts WHERE status = 'pending'`); } catch (e) { return; }
        if (!pending || !pending.length) return;
        let changed = false;
        pending.forEach(p => {
            try {
                const counts = { pending_approval: 0, scheduled: 0, sent: 0, cancelled: 0, failed: 0 };
                all('SELECT status, COUNT(*) AS n FROM scheduled_emails WHERE batch_id = ? GROUP BY status', [p.batch_id])
                    .forEach(r => { counts[r.status] = Number(r.n) || 0; });
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                if (!total || counts.pending_approval > 0) return;               // still waiting for the OK
                if (counts.scheduled + counts.sent + counts.failed > 0) {        // approved → post to the member feed
                    const feedId = randomUUID();
                    run(`INSERT INTO feed_items (id, type, title, body, link_url, link_label, posted_at, published, digest, created_by)
                         VALUES (?, 'news', ?, ?, NULL, NULL, datetime('now'), 1, 0, ?)`,
                        [feedId, p.title, p.body || null, p.created_by || 'inbox-newsletter']);
                    run(`UPDATE v2_inbox_portal_posts SET status = 'posted', feed_item_id = ?, posted_at = datetime('now') WHERE id = ?`, [feedId, p.id]);
                    changed = true;
                    log(`portal post published to the member feed: "${p.title}" (batch ${p.batch_id})`);
                } else if (counts.cancelled === total) {                          // discarded → never posts
                    run(`UPDATE v2_inbox_portal_posts SET status = 'cancelled' WHERE id = ?`, [p.id]);
                    changed = true;
                }
            } catch (e) { console.error('[v2/inbox] portal post publish:', e.message); }
        });
        if (changed) save();
    }
    const watcher = setInterval(() => { try { publishApprovedPortalPosts(); } catch (e) { /* keep ticking */ } }, 15 * 1000);
    if (watcher.unref) watcher.unref();

    // ---- one cheap call for the tab badges ----
    app.get('/api/v2/inbox/badges', auth, adminOnly, (req, res) => {
        try {
            const batches = one(`SELECT COUNT(DISTINCT batch_id) AS b, COUNT(*) AS e FROM scheduled_emails WHERE status = 'pending_approval' AND batch_id IS NOT NULL`) || { b: 0, e: 0 };
            const unread = one(`SELECT COUNT(*) AS c FROM direct_messages WHERE COALESCE(sender_type,'user') <> 'admin' AND COALESCE(receiver_type,'user') = 'admin' AND (is_read = 0 OR is_read IS NULL)`) || { c: 0 };
            res.json({ outbox_batches: Number(batches.b) || 0, outbox_emails: Number(batches.e) || 0, unread_messages: Number(unread.c) || 0 });
        } catch (err) { fail(res, err, 'Could not count the inbox.'); }
    });

    log('inbox: /api/v2/inbox/{audiences,compose,outbox/:batch(+edit,unschedule),threads(+read,archive),newsletter(+queue),badges}');
};
