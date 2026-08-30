/**
 * v2/money.js — MONEY destination additions for the redesigned admin portal (frontend-v2 › js/views/money.js).
 *
 * Owns (all /api/v2/money/* unless noted; auth → adminOnly, section enforcement stays server-side
 * on the existing /api/finance/* surface this screen also reads):
 *
 *   SPONSORS & DONORS ledger (README note 9: pledge → invoiced → paid → thanked, one row each;
 *   Donor Night pledges + auction results land here — manual add for now):
 *     GET    /api/v2/money/ledger                 → { rows, sums:{pledge,invoiced,paid,thanked} }
 *     POST   /api/v2/money/ledger                 ← { party, kind:'sponsor'|'donor', amount, contact_email?, event_ref?, notes? }
 *     POST   /api/v2/money/ledger/:id/advance     ← { to:'invoiced'|'paid'|'thanked', fira_invoice_number?, queue_email?, contact_email? }
 *     PUT    /api/v2/money/ledger/:id             ← partial edit (incl. validated status revert for UNDO)
 *     DELETE /api/v2/money/ledger/:id
 *
 *   ⚠ FIRA RULE (hard): invoices are issued ONLY through the FIRA fiscal system. Nothing here
 *   generates an invoice document or an invoice number — advancing to 'invoiced' REQUIRES the
 *   FIRA invoice number the admin typed from FIRA, and the optional queued email is a REQUEST
 *   that references that FIRA number (plain HTML notice, never a generated PDF).
 *
 *   PAYMENTS TO CHASE:
 *     GET  /api/v2/money/chase          → { queued: { <email lower>: {batch_id, created_at} } }
 *          (pending payment_reminder rows across engines — nag-engine AND v2-money — so the
 *           Money list shows REMINDER QUEUED ✓ no matter which door queued it)
 *     POST /api/v2/money/chase/:galaId  → queues ONE approval-gated reminder into scheduled_emails
 *          (status 'pending_approval'; the Outbox approve click is the only thing that sends).
 *          Also marks the matching open nag_items row 'actioned' so Today agrees.
 *
 *   MORNING-AFTER SURVEY (README note 11: auto-queues at 08:00 the day after each event,
 *   3 questions max, approved like any email; results feed the Board pack):
 *     GET  /api/v2/money/survey           → per-event state (scheduled | due | queued/answered counts)
 *     POST /api/v2/money/survey/sweep     ← { now?, window_days? } — run the sweep immediately (QA/simulation)
 *     GET  /api/v2/money/survey/results   → aggregates per event (n_sent, n_answered, avg_q1, yes_pct, comments)
 *     GET  /api/v2/survey/:token          → PUBLIC tokenized answer page (GET form; 3 questions)
 *   A 10-minute in-process sweep queues one batch per finished event: per-recipient rows in
 *   scheduled_emails (pending_approval, scheduled_for = next-day 08:00) + token rows in
 *   v2_survey_responses. Nothing sends without the human approve click in the Outbox.
 *
 * Tables (v2_ prefix, DDL guarded — both portals share ONE database):
 *   v2_sponsor_ledger, v2_survey_responses.
 */
'use strict';

const crypto = require('crypto');

module.exports = function mountMoney(app, ctx) {
    const { db, auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/money]', ...a));

    // ------------------------------------------------------------------ schema (guarded)
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_sponsor_ledger (
            id TEXT PRIMARY KEY,
            party TEXT NOT NULL,
            kind TEXT DEFAULT 'sponsor',
            amount REAL DEFAULT 0,
            status TEXT DEFAULT 'pledge',
            fira_invoice_number TEXT,
            contact_email TEXT,
            event_ref TEXT,
            notes TEXT,
            pledged_at TEXT,
            invoiced_at TEXT,
            paid_at TEXT,
            thanked_at TEXT,
            invoice_batch_id TEXT,
            thankyou_batch_id TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_survey_responses (
            id TEXT PRIMARY KEY,
            token TEXT UNIQUE,
            event_key TEXT,
            event_label TEXT,
            event_date TEXT,
            recipient_email TEXT,
            batch_id TEXT,
            q1 INTEGER,
            q2 TEXT,
            q3 TEXT,
            queued_at TEXT,
            answered_at TEXT
        )`);
    } catch (e) { log('schema failed:', e.message); }

    // ------------------------------------------------------------------ tiny sql helpers (shared/db.js idioms)
    function getAll(sql, params) {
        let st = null; const out = [];
        try { st = db().prepare(sql); st.bind(params || []); while (st.step()) out.push(st.getAsObject()); return out; }
        finally { if (st) st.free(); }
    }
    function getRow(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        finally { if (st) st.free(); }
    }
    const uuid = () => crypto.randomUUID();
    const nowIso = () => new Date().toISOString();
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 300);
    const persist = () => { try { saveDb(); } catch (e) { /* saveDb is best-effort on some drivers */ } };

    // Public base for links inside queued emails (survey answer links).
    function publicBase() {
        return process.env.PUBLIC_ADMIN_URL || process.env.RENDER_EXTERNAL_URL || ('http://localhost:' + (process.env.PORT || 3001));
    }

    // Brand-lite email shell (ink header, cream body, crimson rule) — matches the Med&X email
    // vocabulary without touching any server.js template helper.
    function emailShell(title, bodyHtml) {
        return `<!doctype html><html><body style="margin:0;background:#f7f1e6;font-family:Inter,Arial,sans-serif;color:#191512">
<div style="max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background:#191512;color:#f7f1e6;padding:18px 28px;font:600 15px Georgia,serif;letter-spacing:.02em">Med&amp;X</div>
  <div style="height:2px;background:#9b1b22"></div>
  <div style="padding:26px 28px">
    <div style="font-family:Georgia,serif;font-size:21px;line-height:1.25;margin-bottom:14px">${title}</div>
    ${bodyHtml}
  </div>
  <div style="padding:14px 28px 22px;font-size:11px;color:#8a8178;border-top:1px solid rgba(25,21,18,.12)">Med&amp;X · Zagreb · medx.hr</div>
</div></body></html>`;
    }

    // One approval-gated row into the outbox spine. NOTHING sends here — the Outbox approve
    // click flips pending_approval → scheduled and the existing drainer delivers.
    function queueOutboxEmail({ batchId, sourceEngine, template, to, subject, html, scheduledFor, createdBy }) {
        db().run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, scheduled_for, created_by, created_at)
                  VALUES (?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [uuid(), batchId, sourceEngine, template, JSON.stringify({ to, subject, html }), to, subject, scheduledFor || null, createdBy || 'admin']);
    }

    // ================================================================== SPONSORS & DONORS LEDGER
    const LEDGER_STATUSES = ['pledge', 'invoiced', 'paid', 'thanked'];
    const LEDGER_KINDS = ['sponsor', 'donor'];

    function ledgerRow(id) { return getRow('SELECT * FROM v2_sponsor_ledger WHERE id = ?', [id]); }
    function ledgerJson() {
        const rows = getAll(`SELECT * FROM v2_sponsor_ledger ORDER BY (status='thanked'), datetime(COALESCE(updated_at, created_at)) DESC`);
        const sums = { pledge: 0, invoiced: 0, paid: 0, thanked: 0 };
        rows.forEach(r => { if (sums[r.status] != null) sums[r.status] += Number(r.amount) || 0; });
        return { rows, sums };
    }

    app.get('/api/v2/money/ledger', auth, adminOnly, (req, res) => {
        try { res.json(ledgerJson()); }
        catch (e) { log('ledger list:', e.message); res.status(500).json({ error: 'The ledger is unavailable right now.' }); }
    });

    app.post('/api/v2/money/ledger', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const party = clean(b.party, 160);
            const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
            const kind = LEDGER_KINDS.includes(b.kind) ? b.kind : 'sponsor';
            if (!party) return res.status(400).json({ error: 'Who is pledging? Add a company or a person.' });
            if (!(amount > 0)) return res.status(400).json({ error: 'The pledge needs a positive € amount.' });
            const email = clean(b.contact_email, 200).toLowerCase();
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That contact email does not look right.' });
            const id = uuid();
            db().run(`INSERT INTO v2_sponsor_ledger (id, party, kind, amount, status, contact_email, event_ref, notes, pledged_at, created_by, created_at, updated_at)
                      VALUES (?,?,?,?, 'pledge', ?,?,?,?,?, datetime('now'), ?)`,
                [id, party, kind, amount, email || null, clean(b.event_ref, 80) || null, clean(b.notes, 500) || null,
                 nowIso(), (req.user && req.user.email) || 'admin', nowIso()]);
            persist();
            res.json({ success: true, row: ledgerRow(id) });
        } catch (e) { log('ledger add:', e.message); res.status(500).json({ error: 'Could not record the pledge.' }); }
    });

    app.post('/api/v2/money/ledger/:id/advance', auth, adminOnly, (req, res) => {
        try {
            const row = ledgerRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'Ledger row not found.' });
            const b = req.body || {};
            const to = String(b.to || '').trim();
            const by = (req.user && req.user.email) || 'admin';

            if (to === 'invoiced') {
                if (row.status !== 'pledge') return res.status(409).json({ error: 'Only a pledge can move to invoiced.' });
                // ⚠ FIRA RULE: the number comes from FIRA — typed by the admin. The portal never
                // generates an invoice number or an invoice document.
                const fira = clean(b.fira_invoice_number, 60);
                if (!fira) return res.status(400).json({ error: 'Type the FIRA invoice number first — invoices are issued in FIRA, the portal only records the number.' });
                let batchId = null;
                const email = clean(b.contact_email, 200).toLowerCase() || row.contact_email;
                if (b.queue_email) {
                    if (!email) return res.status(400).json({ error: 'Add a contact email to queue the invoice notice.' });
                    batchId = 'v2-ledger-inv-' + uuid();
                    const subject = `Med&X — invoice ${fira} for your ${row.kind === 'donor' ? 'donation' : 'sponsorship'}`;
                    const html = emailShell('Your Med&X invoice is on its way.',
                        `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">Dear ${esc(row.party)},</p>
                         <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Thank you for supporting Med&amp;X${row.event_ref ? ' — ' + esc(row.event_ref) : ''}. Fiscal invoice <strong>${esc(fira)}</strong> over <strong>&euro;${Number(row.amount).toLocaleString('en-US')}</strong> has been issued through the FIRA fiscal system and reaches you separately from FIRA.</p>
                         <p style="font-size:14px;line-height:1.65;margin:0">If anything on it needs correcting, reply to this email and we will sort it out.</p>`);
                    queueOutboxEmail({ batchId, sourceEngine: 'v2-money', template: 'sponsor_invoice_request', to: email, subject, html, createdBy: by });
                }
                db().run(`UPDATE v2_sponsor_ledger SET status='invoiced', fira_invoice_number=?, contact_email=COALESCE(?, contact_email),
                          invoiced_at=?, invoice_batch_id=?, updated_at=? WHERE id=?`,
                    [fira, email || null, nowIso(), batchId, nowIso(), row.id]);
                persist();
                return res.json({ success: true, row: ledgerRow(row.id), batch_id: batchId });
            }

            if (to === 'paid') {
                if (!['pledge', 'invoiced'].includes(row.status)) return res.status(409).json({ error: 'Only a pledged or invoiced row can be marked paid.' });
                db().run(`UPDATE v2_sponsor_ledger SET status='paid', paid_at=?, updated_at=? WHERE id=?`, [nowIso(), nowIso(), row.id]);
                persist();
                return res.json({ success: true, row: ledgerRow(row.id) });
            }

            if (to === 'thanked') {
                if (row.status !== 'paid') return res.status(409).json({ error: 'Mark the row paid before sending the thank-you.' });
                const email = clean(b.contact_email, 200).toLowerCase() || row.contact_email;
                if (!email) return res.status(400).json({ error: 'Add a contact email for the thank-you first.' });
                const batchId = 'v2-ledger-thanks-' + uuid();
                const subject = `Thank you from Med&X${row.event_ref ? ' — ' + row.event_ref : ''}`;
                const html = emailShell('Thank you.',
                    `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">Dear ${esc(row.party)},</p>
                     <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Your ${row.kind === 'donor' ? 'donation' : 'sponsorship'} of <strong>&euro;${Number(row.amount).toLocaleString('en-US')}</strong>${row.event_ref ? ' for ' + esc(row.event_ref) : ''} makes our work possible — from the Plexus Conference to the Accelerator fellowships. The whole team is grateful.</p>
                     <p style="font-size:14px;line-height:1.65;margin:0">We would love to show you what it enabled — you are always welcome at our events.</p>
                     <p style="font-size:14px;line-height:1.65;margin:12px 0 0">Warm regards,<br>the Med&amp;X team</p>`);
                queueOutboxEmail({ batchId, sourceEngine: 'v2-money', template: 'sponsor_thank_you', to: email, subject, html, createdBy: by });
                db().run(`UPDATE v2_sponsor_ledger SET status='thanked', contact_email=COALESCE(?, contact_email), thanked_at=?, thankyou_batch_id=?, updated_at=? WHERE id=?`,
                    [email, nowIso(), batchId, nowIso(), row.id]);
                persist();
                return res.json({ success: true, row: ledgerRow(row.id), batch_id: batchId });
            }

            return res.status(400).json({ error: "to must be 'invoiced', 'paid' or 'thanked'." });
        } catch (e) { log('ledger advance:', e.message); res.status(500).json({ error: 'Could not update the ledger row.' }); }
    });

    app.put('/api/v2/money/ledger/:id', auth, adminOnly, (req, res) => {
        try {
            const row = ledgerRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'Ledger row not found.' });
            const b = req.body || {};
            const party = b.party !== undefined ? clean(b.party, 160) : row.party;
            if (!party) return res.status(400).json({ error: 'The row needs a name.' });
            const amount = b.amount !== undefined ? Math.round((Number(b.amount) || 0) * 100) / 100 : row.amount;
            if (!(amount > 0)) return res.status(400).json({ error: 'Amount must stay a positive number.' });
            const kind = b.kind !== undefined ? (LEDGER_KINDS.includes(b.kind) ? b.kind : row.kind) : row.kind;
            let status = row.status;
            if (b.status !== undefined) {
                if (!LEDGER_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
                status = b.status; // validated revert path (UNDO uses this — no emails fire here)
            }
            const email = b.contact_email !== undefined ? (clean(b.contact_email, 200).toLowerCase() || null) : row.contact_email;
            db().run(`UPDATE v2_sponsor_ledger SET party=?, kind=?, amount=?, status=?, contact_email=?, event_ref=?, notes=?,
                      invoiced_at = CASE WHEN ? IN ('pledge') THEN NULL ELSE invoiced_at END,
                      paid_at     = CASE WHEN ? IN ('pledge','invoiced') THEN NULL ELSE paid_at END,
                      thanked_at  = CASE WHEN ? != 'thanked' THEN NULL ELSE thanked_at END,
                      updated_at=? WHERE id=?`,
                [party, kind, amount, status, email,
                 b.event_ref !== undefined ? (clean(b.event_ref, 80) || null) : row.event_ref,
                 b.notes !== undefined ? (clean(b.notes, 500) || null) : row.notes,
                 status, status, status, nowIso(), row.id]);
            persist();
            res.json({ success: true, row: ledgerRow(row.id) });
        } catch (e) { log('ledger edit:', e.message); res.status(500).json({ error: 'Could not save the ledger row.' }); }
    });

    app.delete('/api/v2/money/ledger/:id', auth, adminOnly, (req, res) => {
        try {
            const row = ledgerRow(req.params.id);
            if (!row) return res.status(404).json({ error: 'Ledger row not found.' });
            db().run('DELETE FROM v2_sponsor_ledger WHERE id = ?', [row.id]);
            persist();
            res.json({ success: true, removed: row });
        } catch (e) { log('ledger delete:', e.message); res.status(500).json({ error: 'Could not remove the row.' }); }
    });

    // ================================================================== PAYMENTS TO CHASE
    app.get('/api/v2/money/chase', auth, adminOnly, (req, res) => {
        try {
            const rows = getAll(`SELECT recipient_email, batch_id, created_at FROM scheduled_emails
                                 WHERE status='pending_approval' AND template='payment_reminder' AND recipient_email IS NOT NULL`);
            const queued = {};
            rows.forEach(r => { const k = String(r.recipient_email || '').toLowerCase(); if (k && !queued[k]) queued[k] = { batch_id: r.batch_id, created_at: r.created_at }; });
            res.json({ queued });
        } catch (e) { log('chase state:', e.message); res.status(500).json({ error: 'Could not read the queue state.' }); }
    });

    app.post('/api/v2/money/chase/:galaId', auth, adminOnly, (req, res) => {
        try {
            const g = getRow('SELECT * FROM gala_registrations WHERE id = ?', [req.params.galaId]);
            if (!g) return res.status(404).json({ error: 'Gala registration not found.' });
            if (g.payment_status === 'paid') return res.status(409).json({ error: 'That seat is already paid — nothing to chase.' });
            if (['rejected', 'cancelled'].includes(String(g.status || ''))) return res.status(409).json({ error: 'That registration is no longer active.' });
            if (!g.email) return res.status(400).json({ error: 'This registration has no email address.' });
            const dup = getRow(`SELECT batch_id FROM scheduled_emails WHERE status='pending_approval' AND template='payment_reminder' AND LOWER(recipient_email) = ?`, [String(g.email).toLowerCase()]);
            if (dup) return res.status(409).json({ error: 'A reminder for this guest is already waiting in the Outbox — approve it there.', batch_id: dup.batch_id });

            // Price by the clock — server gala settings first (same rule the member portal charges by).
            let gs = {};
            try { gs = getRow("SELECT price_gala_early_bird, price_gala_regular, early_bird_deadline FROM gala_settings WHERE id = 'default'") || {}; } catch (e) {}
            const early = Number(gs.price_gala_early_bird) || 150;
            const regular = Number(gs.price_gala_regular) || 175;
            const deadline = String(gs.early_bird_deadline || '2026-09-01').slice(0, 10);
            const price = new Date().toISOString().slice(0, 10) <= deadline ? early : regular;
            const owed = Number(g.amount_paid) > 0 ? null : price; // partial payments keep the wording generic

            const name = [g.first_name, g.last_name].filter(Boolean).join(' ') || 'there';
            const batchId = 'v2-chase-' + uuid();
            const subject = 'Your Gala Evening seat — payment reminder';
            const html = emailShell('Your Gala seat is reserved — one step left.',
                `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">Dear ${esc(name)},</p>
                 <p style="font-size:14px;line-height:1.65;margin:0 0 12px">Your seat for the Med&amp;X <strong>Gala Evening</strong> (December 5 · Hotel Esplanade, Zagreb) is reserved${owed ? ' — the payment of <strong>&euro;' + owed + '</strong> is still open' : ' — your payment shows as open on our side'}. Seats are limited and reservations are confirmed in order of payment.</p>
                 <p style="font-size:14px;line-height:1.65;margin:0 0 12px">You can complete the payment from <strong>My Plexus</strong> in the member portal; card and bank transfer both work.</p>
                 <p style="font-size:14px;line-height:1.65;margin:0">Already paid in the last day or two? Then this crossed your payment — please ignore it.</p>`);
            queueOutboxEmail({ batchId, sourceEngine: 'v2-money', template: 'payment_reminder', to: g.email, subject, html, createdBy: (req.user && req.user.email) || 'admin' });

            // Keep Today's Action Center in step: the matching open nag row reads as actioned.
            try { db().run("UPDATE nag_items SET status='actioned' WHERE kind='gala_unpaid' AND status='open' AND subject_id = ?", [g.id]); } catch (e) {}
            persist();
            res.json({ success: true, action: 'email_queued', batch_id: batchId });
        } catch (e) { log('chase queue:', e.message); res.status(500).json({ error: 'Could not queue the reminder.' }); }
    });

    // ================================================================== MORNING-AFTER SURVEY
    const SURVEY_WINDOW_DAYS = 14;   // an event older than this never gets a late survey
    const SWEEP_EVERY_MS = 10 * 60 * 1000;

    function surveyEvents() {
        const out = [];
        try {
            getAll(`SELECT id, name, end_date FROM conferences WHERE is_active = 1 AND end_date IS NOT NULL AND end_date != ''`)
                .forEach(c => out.push({ key: 'conf-' + c.id, label: c.name, date: String(c.end_date).slice(0, 10), source: 'conference', source_id: c.id }));
        } catch (e) {}
        try {
            getAll(`SELECT id, name, city, event_date FROM bridges_events WHERE event_date IS NOT NULL AND event_date != ''`)
                .forEach(b => out.push({ key: 'bridges-' + b.id, label: b.name + (b.city && !String(b.name).toLowerCase().includes(String(b.city).toLowerCase()) ? ' — ' + b.city : ''), date: String(b.event_date).slice(0, 10), source: 'bridges', source_id: b.id }));
        } catch (e) {}
        return out.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((a, b) => a.date.localeCompare(b.date));
    }
    function morningAfter(dateStr) {          // local 08:00 the day AFTER the event (note 11)
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d + 1, 8, 0, 0);
    }
    function surveyRecipients(ev) {
        const seen = new Set(); const out = [];
        const push = (email, name) => { const k = String(email || '').trim().toLowerCase(); if (!k || seen.has(k) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return; seen.add(k); out.push({ email: k, name: name || '' }); };
        try {
            if (ev.source === 'conference') {
                getAll(`SELECT COALESCE(r.email, u.email) AS email, COALESCE(r.first_name, u.first_name) AS name
                        FROM registrations r LEFT JOIN users u ON r.user_id = u.id
                        WHERE r.conference_id = ? AND COALESCE(r.status,'') NOT IN ('cancelled','rejected')`, [ev.source_id])
                    .forEach(r => push(r.email, r.name));
            } else if (ev.source === 'bridges') {
                getAll(`SELECT email, first_name AS name FROM bridges_registrations
                        WHERE event_id = ? AND COALESCE(status,'') != 'cancelled'`, [ev.source_id])
                    .forEach(r => push(r.email, r.name));
            }
        } catch (e) { log('survey recipients:', e.message); }
        return out.slice(0, 500);
    }
    function surveyQueuedFor(eventKey) {
        const r = getRow('SELECT COUNT(*) AS n, SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END) AS a FROM v2_survey_responses WHERE event_key = ?', [eventKey]);
        return { sent: (r && r.n) || 0, answered: (r && r.a) || 0 };
    }
    function surveyHtml(name, label, link) {
        return emailShell('How was it? Three quick questions.',
            `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">Dear ${esc(name || 'guest')},</p>
             <p style="font-size:14px;line-height:1.65;margin:0 0 14px">Thank you for being at <strong>${esc(label)}</strong> yesterday. Three questions, under a minute — your answers go straight to the team and the board.</p>
             <p style="margin:0 0 6px"><a href="${esc(link)}" style="display:inline-block;background:#9b1b22;color:#ffffff;padding:11px 18px;font:600 11px Inter,Arial,sans-serif;letter-spacing:.12em;text-decoration:none">ANSWER THE 3 QUESTIONS</a></p>
             <p style="font-size:12px;color:#8a8178;line-height:1.6;margin:10px 0 0">The link is personal — no sign-in needed.</p>`);
    }

    function runSurveySweep(nowArg, windowDays) {
        const now = nowArg instanceof Date && !isNaN(nowArg) ? nowArg : new Date();
        const win = Number(windowDays) > 0 ? Number(windowDays) : SURVEY_WINDOW_DAYS;
        const queued = []; let skipped = 0;
        for (const ev of surveyEvents()) {
            const at = morningAfter(ev.date);
            const ageDays = (now - at) / 86400000;
            if (now < at || ageDays > win) { skipped++; continue; }             // not due yet, or too old
            if (surveyQueuedFor(ev.key).sent > 0) { skipped++; continue; }       // already queued once
            const recipients = surveyRecipients(ev);
            if (!recipients.length) { skipped++; continue; }
            const batchId = 'v2-survey-' + ev.key;
            const scheduledFor = at.toISOString().replace('T', ' ').slice(0, 19); // next-day 08:00
            const subject = `How was ${ev.label}? — 3 quick questions`;
            let sampleToken = null;
            for (const r of recipients) {
                const token = crypto.randomBytes(24).toString('hex');
                if (!sampleToken) sampleToken = token;
                db().run(`INSERT INTO v2_survey_responses (id, token, event_key, event_label, event_date, recipient_email, batch_id, queued_at)
                          VALUES (?,?,?,?,?,?,?,?)`,
                    [uuid(), token, ev.key, ev.label, ev.date, r.email, batchId, nowIso()]);
                queueOutboxEmail({ batchId, sourceEngine: 'v2-survey', template: 'morning_after_survey',
                    to: r.email, subject, html: surveyHtml(r.name, ev.label, publicBase() + '/api/v2/survey/' + token),
                    scheduledFor, createdBy: 'v2-survey-sweep' });
            }
            queued.push({ event_key: ev.key, event_label: ev.label, recipients: recipients.length, batch_id: batchId, sample_token: sampleToken });
            log(`survey queued for ${ev.label}: ${recipients.length} email(s), batch ${batchId} (awaits Outbox approval)`);
        }
        if (queued.length) persist();
        return { queued, skipped };
    }

    app.get('/api/v2/money/survey', auth, adminOnly, (req, res) => {
        try {
            const now = new Date();
            const events = surveyEvents().map(ev => {
                const at = morningAfter(ev.date);
                const q = surveyQueuedFor(ev.key);
                const pending = getRow(`SELECT COUNT(*) AS n FROM scheduled_emails WHERE batch_id = ? AND status='pending_approval'`, ['v2-survey-' + ev.key]);
                let state = 'scheduled';
                if (q.sent > 0) state = 'queued';
                else if (now >= at && (now - at) / 86400000 <= SURVEY_WINDOW_DAYS) state = 'due';
                else if (now >= at) state = 'missed';
                return { ...ev, queue_at: at.toISOString(), state, sent: q.sent, answered: q.answered, awaiting_approval: (pending && pending.n) || 0 };
            });
            res.json({ events, sweep_interval_min: SWEEP_EVERY_MS / 60000, window_days: SURVEY_WINDOW_DAYS });
        } catch (e) { log('survey state:', e.message); res.status(500).json({ error: 'Could not read the survey state.' }); }
    });

    app.post('/api/v2/money/survey/sweep', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const now = b.now ? new Date(b.now) : new Date();
            if (b.now && isNaN(now)) return res.status(400).json({ error: 'now must be an ISO datetime.' });
            res.json({ success: true, ...runSurveySweep(now, b.window_days) });
        } catch (e) { log('survey sweep:', e.message); res.status(500).json({ error: 'Sweep failed.' }); }
    });

    app.get('/api/v2/money/survey/results', auth, adminOnly, (req, res) => {
        try {
            const events = {};
            getAll('SELECT event_key, event_label, event_date, q1, q2, q3, answered_at FROM v2_survey_responses ORDER BY event_date DESC').forEach(r => {
                const e = events[r.event_key] || (events[r.event_key] = { event_key: r.event_key, event_label: r.event_label, event_date: r.event_date, n_sent: 0, n_answered: 0, q1_sum: 0, q1_n: 0, yes: 0, q2_n: 0, comments: [] });
                e.n_sent++;
                if (r.answered_at) {
                    e.n_answered++;
                    if (r.q1 != null) { e.q1_sum += Number(r.q1); e.q1_n++; }
                    if (r.q2) { e.q2_n++; if (r.q2 === 'yes') e.yes++; }
                    if (r.q3 && e.comments.length < 5) e.comments.push(String(r.q3));
                }
            });
            res.json({ results: Object.values(events).map(e => ({
                event_key: e.event_key, event_label: e.event_label, event_date: e.event_date,
                n_sent: e.n_sent, n_answered: e.n_answered,
                avg_q1: e.q1_n ? Math.round((e.q1_sum / e.q1_n) * 10) / 10 : null,
                yes_pct: e.q2_n ? Math.round((e.yes / e.q2_n) * 100) : null,
                comments: e.comments })) });
        } catch (e) { log('survey results:', e.message); res.status(500).json({ error: 'Could not read the results.' }); }
    });

    // ---- PUBLIC tokenized answer page (GET; the form itself submits by GET too). 3 questions max.
    function surveyPage(title, sub, inner) {
        return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Med&X — your feedback</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f7f1e6;color:#191512;font-family:Inter,sans-serif}
.wrap{max-width:520px;margin:0 auto;padding:46px 22px}
.brand{font:600 15px Fraunces,serif}.rule{height:2px;background:#9b1b22;width:44px;margin:14px 0 22px}
h1{font-family:Fraunces,serif;font-weight:500;font-size:30px;line-height:1.15;margin:0 0 8px}
.sub{font-size:14px;color:#4a4239;line-height:1.6;margin:0 0 26px}
.q{font:600 10px Inter,sans-serif;letter-spacing:.15em;color:#4a4239;margin:22px 0 8px;text-transform:uppercase}
.scale{display:flex;gap:6px;flex-wrap:wrap}
.scale label{border:1px solid rgba(25,21,18,.3);background:#fff;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font:600 13px Inter,sans-serif;cursor:pointer}
.scale input{display:none}.scale input:checked+span{background:#9b1b22;color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.yn{display:flex;gap:8px}.yn label{border:1px solid rgba(25,21,18,.3);background:#fff;padding:10px 18px;font:600 10px Inter,sans-serif;letter-spacing:.13em;cursor:pointer}
.yn input{display:none}.yn input:checked+span{color:#9b1b22}
textarea,input[type=text]{width:100%;box-sizing:border-box;border:1px solid rgba(25,21,18,.3);background:#fff;padding:10px 12px;font:400 14px Inter,sans-serif;color:#191512;min-height:74px}
button{margin-top:26px;background:#9b1b22;color:#fff;border:0;padding:13px 22px;font:600 11px Inter,sans-serif;letter-spacing:.14em;cursor:pointer}
button:hover{background:#7e151b}.foot{margin-top:34px;font-size:11px;color:#8a8178}</style></head>
<body><div class="wrap"><div class="brand">Med&amp;X</div><div class="rule"></div><h1>${title}</h1><p class="sub">${sub}</p>${inner}<div class="foot">Med&amp;X · Zagreb · medx.hr</div></div></body></html>`;
    }

    app.get('/api/v2/survey/:token', (req, res) => {
        res.set('Content-Type', 'text/html; charset=utf-8');
        try {
            const token = String(req.params.token || '');
            if (!/^[a-f0-9]{48}$/.test(token)) return res.status(404).send(surveyPage('Link not found.', 'This feedback link is not valid — it may have been trimmed by your email app.', ''));
            const row = getRow('SELECT * FROM v2_survey_responses WHERE token = ?', [token]);
            if (!row) return res.status(404).send(surveyPage('Link not found.', 'We could not find this feedback link.', ''));
            if (row.answered_at) return res.send(surveyPage('Thank you.', `We already have your answers for ${esc(row.event_label)} — they go straight to the team and the board.`, ''));

            const hasAnswer = req.query.q1 !== undefined || req.query.q2 !== undefined || req.query.q3 !== undefined;
            if (!hasAnswer) {
                return res.send(surveyPage(`How was ${esc(row.event_label)}?`, 'Three questions, under a minute. Your answers reach the Med&X team and the board pack.',
                    `<form method="get" action="/api/v2/survey/${esc(token)}">
                       <div class="q">1 · How was it overall? (1–10)</div>
                       <div class="scale">${[1,2,3,4,5,6,7,8,9,10].map(n => `<label><input type="radio" name="q1" value="${n}" required><span>${n}</span></label>`).join('')}</div>
                       <div class="q">2 · Would you come again next year?</div>
                       <div class="yn"><label><input type="radio" name="q2" value="yes"><span>YES</span></label><label><input type="radio" name="q2" value="no"><span>NO</span></label></div>
                       <div class="q">3 · One thing we should improve</div>
                       <textarea name="q3" maxlength="500" placeholder="Optional — a sentence is plenty."></textarea>
                       <button type="submit">SEND MY ANSWERS</button>
                     </form>`));
            }
            let q1 = parseInt(req.query.q1, 10);
            q1 = Number.isFinite(q1) ? Math.max(1, Math.min(10, q1)) : null;
            if (q1 == null) return res.status(400).send(surveyPage('One thing missing.', 'Please pick a number from 1 to 10 for the first question, then send again.', ''));
            const q2 = ['yes', 'no'].includes(String(req.query.q2)) ? String(req.query.q2) : null;
            const q3 = clean(req.query.q3, 500) || null;
            db().run(`UPDATE v2_survey_responses SET q1=?, q2=?, q3=?, answered_at=? WHERE id=? AND answered_at IS NULL`, [q1, q2, q3, nowIso(), row.id]);
            persist();
            return res.send(surveyPage('Thank you.', `You rated ${esc(row.event_label)} a ${q1}/10. Your answers help us make the next edition better.`, ''));
        } catch (e) {
            log('survey answer:', e.message);
            return res.status(500).send(surveyPage('Something went wrong.', 'Please open the link again in a moment.', ''));
        }
    });

    // The sweep timer — checks every 10 minutes; queueing itself stays approval-gated in the Outbox.
    const timer = setInterval(() => { try { runSurveySweep(); } catch (e) { log('sweep tick:', e.message); } }, SWEEP_EVERY_MS);
    if (timer.unref) timer.unref();
    const boot = setTimeout(() => { try { runSurveySweep(); } catch (e) { log('sweep boot:', e.message); } }, 20000);
    if (boot.unref) boot.unref();

    log('money module ready: ledger + chase + morning-after survey (sweep every ' + (SWEEP_EVERY_MS / 60000) + ' min)');
};
