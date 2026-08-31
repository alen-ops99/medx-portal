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
 * MONEY REBUILD (Miro's team-review spec, Aug 2026) — the screen itself now runs on:
 *     GET/POST      /api/v2/money/book?direction=out|in     knjiga izlaznih/ulaznih računa (+ legacy finance_invoices listed read-only)
 *     PUT/DELETE    /api/v2/money/book/:id
 *     GET/POST/PUT/DELETE /api/v2/money/travel-orders(/:id)  putni nalozi — SEPARATED from payment orders, no e-signing anywhere
 *     GET/POST/PUT/DELETE /api/v2/money/payment-orders(/:id) nalozi za plaćanje (own list)
 *     GET/POST/PUT/DELETE /api/v2/money/work-units(/:id)     radne jedinice registry (šifra/naziv/opis/preneseno + computed prihod/rashod/konačno)
 *     GET/POST/PUT/DELETE /api/v2/money/expected(/:id)       manually entered receivables (e.g. awarded MZO grant), POST /:id/receive
 *     GET           /api/v2/money/summary?year=              all-projects COLLECTED / OWED / SPENT tiles + RECENT MONEY IN (legacy tables read-only)
 *     GET           /api/v2/money/report?group=project|work_unit|person(&from&to&…)
 *     GET           /api/v2/money/export.csv?set=book_out|book_in|travel|payment|units|expected|report (+ the same filters — always the filtered set)
 *   The ledger/chase/survey endpoints above STAY (their cards moved off the Money screen
 *   to live with their projects, and queued survey links must keep resolving).
 *
 * Tables (v2_ prefix, DDL guarded — both portals share ONE database):
 *   v2_sponsor_ledger, v2_survey_responses, v2_money_book_entries, v2_money_travel_orders,
 *   v2_money_payment_orders, v2_money_work_units, v2_money_expected_income.
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


    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║ MONEY REBUILD — Miro's spec (team review, August 2026, MONEY section) ║
    // ╚══════════════════════════════════════════════════════════════════════╝
    // Books (knjiga izlaznih/ulaznih računa), putni nalozi SEPARATED from nalozi
    // za plaćanje, radne jedinice registry, expected income (e.g. an awarded MZO
    // grant not yet paid out), all-projects summary tiles, reports + CSV.
    //
    // ⚠ FIRA RULE here too: the outgoing book LISTS invoices — fiscal invoices are
    // issued ONLY in FIRA and their number is TYPED into the row. Nothing in these
    // routes generates an invoice number or an invoice document. Non-fiscalized
    // rows are manual entries.
    //
    // Aggregation rules (one consistent composition everywhere):
    //   COLLECTED = legacy finance_transactions income (non-draft)
    //             + paid gala seats NOT already booked as a transaction (reference dedup)
    //             + collected outgoing-book rows NOT matching a transaction reference
    //             + expected income marked received + sponsor-ledger paid/thanked.
    //   SPENT     = legacy finance_transactions expense + incoming book + travel orders.
    //               (Payment orders are NOT added — they usually EXECUTE an incoming
    //                invoice; their own total is reported separately.)
    //   OWED      = open expected income + unpaid gala seats × price-by-the-clock
    //             + legacy outgoing invoices still open + outgoing-book rows without
    //               datum naplate + sponsor-ledger rows sitting at 'invoiced'.

    // ------------------------------------------------------------------ schema (guarded)
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_money_book_entries (
            id TEXT PRIMARY KEY,
            direction TEXT NOT NULL,             -- 'out' (izlazni) | 'in' (ulazni)
            invoice_number TEXT NOT NULL,        -- FIRA number for fiscalized outgoing rows (typed, never generated)
            party_name TEXT NOT NULL,            -- kupac (out) / dobavljač (in)
            party_oib TEXT,
            invoice_date TEXT NOT NULL,          -- datum računa
            amount REAL NOT NULL,
            booking_date TEXT NOT NULL,          -- datum knjiženja (≠ datum računa)
            vrsta TEXT,                          -- out only: 'fiskalizirani' | 'nefiskalizirani'
            settled_date TEXT,                   -- out: datum naplate · in: datum plaćanja
            work_unit_id TEXT,
            project TEXT DEFAULT 'general',
            notes TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_money_travel_orders (
            id TEXT PRIMARY KEY,
            order_number TEXT NOT NULL,          -- broj putnog naloga
            traveler_name TEXT NOT NULL,         -- ime i prezime
            travel_date TEXT NOT NULL,           -- datum putovanja
            destination TEXT NOT NULL,           -- odredište
            purpose TEXT,                        -- svrha
            total_cost REAL DEFAULT 0,           -- ukupan trošak
            opened_date TEXT,                    -- datum otvaranja
            work_unit_id TEXT,
            project TEXT DEFAULT 'general',
            notes TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_money_payment_orders (
            id TEXT PRIMARY KEY,
            order_number TEXT NOT NULL,
            recipient_name TEXT NOT NULL,
            description TEXT,
            amount REAL NOT NULL,
            order_date TEXT NOT NULL,
            work_unit_id TEXT,
            project TEXT DEFAULT 'general',
            notes TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_money_work_units (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL,                  -- šifra radne jedinice
            name TEXT NOT NULL,                  -- naziv
            description TEXT,                    -- (pod)opis
            carryover_prev REAL DEFAULT 0,       -- preneseno stanje iz prethodne godine
            active INTEGER DEFAULT 1,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
        db().run(`CREATE TABLE IF NOT EXISTS v2_money_expected_income (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,                -- tko nam duguje (e.g. MZO — natječaj)
            description TEXT,
            amount REAL NOT NULL,
            expected_date TEXT,
            project TEXT DEFAULT 'general',
            work_unit_id TEXT,
            status TEXT DEFAULT 'open',          -- open | received | cancelled
            received_date TEXT,
            notes TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
    } catch (e) { log('money-rebuild schema failed:', e.message); }

    // ------------------------------------------------------------------ small helpers
    const num2 = v => Math.round((Number(v) || 0) * 100) / 100;
    const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const yearOfDate = s => isYmd(s) ? parseInt(s.slice(0, 4), 10) : null;
    const todayYmd = () => new Date().toISOString().slice(0, 10);
    const by = req => (req.user && req.user.email) || 'admin';
    const oibOk = v => !v || /^\d{11}$/.test(String(v).trim());
    const VRSTE = ['fiskalizirani', 'nefiskalizirani'];

    function yearClosed(y) {
        if (!y) return null;
        try {
            const r = getRow('SELECT status FROM finance_fiscal_years WHERE year = ?', [y]);
            if (r && ['closed', 'archived'].includes(String(r.status))) {
                return `Fiscal year ${y} is closed — reopen it under FINANCE TOOLS before changing its records.`;
            }
        } catch (e) { /* no fiscal-years table → nothing to guard */ }
        return null;
    }
    function unitExists(id) {
        if (!id) return true;
        return !!getRow('SELECT id FROM v2_money_work_units WHERE id = ?', [id]);
    }
    // Next human-friendly order number within a year for a v2 table. The admin can
    // always overtype it — this is a convenience, not an authority (and NEVER used
    // for invoices: those numbers come from FIRA or the supplier's own document).
    function nextOrderNumber(table, dateCol, prefix, year) {
        const r = getRow(`SELECT COUNT(*) AS n FROM ${table} WHERE substr(${dateCol},1,4) = ?`, [String(year)]);
        let n = ((r && r.n) || 0) + 1;
        for (let i = 0; i < 200; i++) {
            const cand = `${prefix}-${year}-${String(n).padStart(3, '0')}`;
            if (!getRow(`SELECT id FROM ${table} WHERE order_number = ?`, [cand])) return cand;
            n++;
        }
        return `${prefix}-${year}-${uuid().slice(0, 6)}`;
    }
    // CSV with UTF-8 BOM (Croatian diacritics survive Excel) + formula-injection guard.
    const csvCell = v => {
        let s = String(v == null ? '' : v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
    };
    function sendCsv(res, filename, headers, rows) {
        const body = '\uFEFF' + [headers.map(csvCell).join(',')]
            .concat(rows.map(r => r.map(csvCell).join(','))).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(body);
    }
    const qYear = req => parseInt(req.query.year, 10) || new Date().getFullYear();

    // Shared WHERE-builder for book/order lists: year on the governing date column,
    // then optional project / work unit / person / from / to.
    function listFilters(req, dateCol, personCol) {
        const wh = []; const params = [];
        const y = req.query.year ? parseInt(req.query.year, 10) : null;
        if (y) { wh.push(`substr(${dateCol},1,4) = ?`); params.push(String(y)); }
        if (req.query.from && isYmd(req.query.from)) { wh.push(`${dateCol} >= ?`); params.push(req.query.from); }
        if (req.query.to && isYmd(req.query.to)) { wh.push(`${dateCol} <= ?`); params.push(req.query.to); }
        if (req.query.project) { wh.push('project = ?'); params.push(clean(req.query.project, 60)); }
        if (req.query.work_unit) { wh.push('work_unit_id = ?'); params.push(clean(req.query.work_unit, 60)); }
        if (personCol && req.query.person) { wh.push(`LOWER(${personCol}) LIKE ?`); params.push('%' + clean(req.query.person, 120).toLowerCase() + '%'); }
        return { where: wh.length ? 'WHERE ' + wh.join(' AND ') : '', params };
    }
    const unitJoin = t => `LEFT JOIN v2_money_work_units wu ON wu.id = ${t}.work_unit_id`;

    // ================================================================== INVOICE BOOKS
    function bookRows(req, direction) {
        const f = listFilters(req, 'b.booking_date', 'b.party_name');
        f.where = (f.where ? f.where + ' AND ' : 'WHERE ') + 'b.direction = ?';
        f.params.push(direction);
        return getAll(`SELECT b.*, wu.code AS work_unit_code, wu.name AS work_unit_name
                       FROM v2_money_book_entries b ${unitJoin('b')}
                       ${f.where.replace(/\bproject = \?/, 'b.project = ?').replace(/\bwork_unit_id = \?/, 'b.work_unit_id = ?')}
                       ORDER BY b.booking_date DESC, datetime(b.created_at) DESC`, f.params);
    }
    // Legacy finance_invoices shown read-only inside the books so "all invoices"
    // really is all of them (they keep living in their legacy table).
    function legacyBookRows(direction, year) {
        try {
            return getAll(`SELECT i.id, i.invoice_number, i.party_name, i.party_oib, i.issue_date AS invoice_date,
                                  i.total AS amount, NULL AS booking_date,
                                  CASE WHEN i.fiscalized = 1 THEN 'fiskalizirani' ELSE 'nefiskalizirani' END AS vrsta,
                                  i.paid_date AS settled_date, i.status, i.project, wu.code AS work_unit_code, wu.name AS work_unit_name
                           FROM finance_invoices i LEFT JOIN finance_work_units wu ON wu.id = i.work_unit_id
                           WHERE i.direction = ? AND CAST(COALESCE(i.fiscal_year, substr(COALESCE(i.issue_date, i.created_at),1,4)) AS TEXT) = ?
                           ORDER BY COALESCE(i.issue_date, i.created_at) DESC`,
                [direction === 'out' ? 'outgoing' : 'incoming', String(year)]);
        } catch (e) { return []; }
    }
    function bookSums(rows) {
        const s = { count: rows.length, total: 0, settled_total: 0, open_total: 0, fisk_total: 0, nefisk_total: 0, by_project: {}, by_work_unit: {} };
        rows.forEach(r => {
            const a = Number(r.amount) || 0;
            s.total = num2(s.total + a);
            if (r.settled_date) s.settled_total = num2(s.settled_total + a); else s.open_total = num2(s.open_total + a);
            if (r.vrsta === 'fiskalizirani') s.fisk_total = num2(s.fisk_total + a);
            if (r.vrsta === 'nefiskalizirani') s.nefisk_total = num2(s.nefisk_total + a);
            const p = r.project || 'general'; s.by_project[p] = num2((s.by_project[p] || 0) + a);
            const w = r.work_unit_code || '—'; s.by_work_unit[w] = num2((s.by_work_unit[w] || 0) + a);
        });
        return s;
    }

    app.get('/api/v2/money/book', auth, adminOnly, (req, res) => {
        try {
            const direction = req.query.direction === 'in' ? 'in' : 'out';
            const rows = bookRows(req, direction);
            const legacy = legacyBookRows(direction, qYear(req));
            res.json({ direction, rows, sums: bookSums(rows),
                legacy_rows: legacy, legacy_total: num2(legacy.reduce((n, r) => n + (Number(r.amount) || 0), 0)) });
        } catch (e) { log('book list:', e.message); res.status(500).json({ error: 'The invoice book is unavailable right now.' }); }
    });

    function validateBookBody(b, direction, existing) {
        const out = {};
        out.invoice_number = b.invoice_number !== undefined ? clean(b.invoice_number, 60) : (existing ? existing.invoice_number : '');
        out.party_name = b.party_name !== undefined ? clean(b.party_name, 200) : (existing ? existing.party_name : '');
        out.party_oib = b.party_oib !== undefined ? (clean(b.party_oib, 11) || null) : (existing ? existing.party_oib : null);
        out.invoice_date = b.invoice_date !== undefined ? String(b.invoice_date || '').slice(0, 10) : (existing ? existing.invoice_date : '');
        out.booking_date = b.booking_date !== undefined ? String(b.booking_date || '').slice(0, 10) : (existing ? existing.booking_date : '');
        out.amount = b.amount !== undefined ? num2(b.amount) : (existing ? existing.amount : 0);
        out.settled_date = b.settled_date !== undefined ? (isYmd(b.settled_date) ? String(b.settled_date).slice(0, 10) : null) : (existing ? existing.settled_date : null);
        out.work_unit_id = b.work_unit_id !== undefined ? (clean(b.work_unit_id, 60) || null) : (existing ? existing.work_unit_id : null);
        out.project = b.project !== undefined ? (clean(b.project, 60) || 'general') : (existing ? existing.project : 'general');
        out.notes = b.notes !== undefined ? (clean(b.notes, 500) || null) : (existing ? existing.notes : null);
        if (direction === 'out') out.vrsta = b.vrsta !== undefined ? String(b.vrsta || '') : (existing ? existing.vrsta : '');
        else out.vrsta = null;

        if (!out.party_name) return { error: direction === 'out' ? 'Naziv kupca is required.' : 'Naziv dobavljača is required.' };
        if (!oibOk(out.party_oib)) return { error: 'OIB must be exactly 11 digits (or left empty).' };
        if (!isYmd(out.invoice_date)) return { error: 'Datum računa must be a date (YYYY-MM-DD).' };
        if (!isYmd(out.booking_date)) return { error: 'Datum knjiženja must be a date (YYYY-MM-DD) — it may differ from datum računa.' };
        if (!(out.amount > 0)) return { error: 'Iznos must be a positive amount.' };
        if (direction === 'out' && !VRSTE.includes(out.vrsta)) return { error: "Vrsta must be 'fiskalizirani' or 'nefiskalizirani'." };
        if (!out.invoice_number) {
            return { error: direction === 'out' && out.vrsta === 'fiskalizirani'
                ? 'Type the FIRA invoice number — fiscal invoices are issued only in FIRA, the portal never creates one.'
                : 'Broj računa is required.' };
        }
        if (!unitExists(out.work_unit_id)) return { error: 'That radna jedinica does not exist — add it in the registry first.' };
        return { value: out };
    }

    app.post('/api/v2/money/book', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const direction = b.direction === 'in' ? 'in' : b.direction === 'out' ? 'out' : null;
            if (!direction) return res.status(400).json({ error: "direction must be 'out' (izlazni) or 'in' (ulazni)." });
            const v = validateBookBody(b, direction, null);
            if (v.error) return res.status(400).json({ error: v.error });
            const closed = yearClosed(yearOfDate(v.value.booking_date));
            if (closed) return res.status(409).json({ error: closed });
            const dup = getRow('SELECT id FROM v2_money_book_entries WHERE direction = ? AND invoice_number = ?', [direction, v.value.invoice_number]);
            if (dup) return res.status(409).json({ error: `Invoice ${v.value.invoice_number} is already in this book.` });
            const id = uuid();
            db().run(`INSERT INTO v2_money_book_entries (id, direction, invoice_number, party_name, party_oib, invoice_date, amount,
                        booking_date, vrsta, settled_date, work_unit_id, project, notes, created_by, created_at, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), ?)`,
                [id, direction, v.value.invoice_number, v.value.party_name, v.value.party_oib, v.value.invoice_date, v.value.amount,
                 v.value.booking_date, v.value.vrsta, v.value.settled_date, v.value.work_unit_id, v.value.project, v.value.notes, by(req), nowIso()]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_book_entries WHERE id = ?', [id]) });
        } catch (e) { log('book add:', e.message); res.status(500).json({ error: 'Could not save the book entry.' }); }
    });

    app.put('/api/v2/money/book/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_book_entries WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Book entry not found.' });
            const v = validateBookBody(req.body || {}, row.direction, row);
            if (v.error) return res.status(400).json({ error: v.error });
            const closed = yearClosed(yearOfDate(row.booking_date)) || yearClosed(yearOfDate(v.value.booking_date));
            if (closed) return res.status(409).json({ error: closed });
            db().run(`UPDATE v2_money_book_entries SET invoice_number=?, party_name=?, party_oib=?, invoice_date=?, amount=?,
                        booking_date=?, vrsta=?, settled_date=?, work_unit_id=?, project=?, notes=?, updated_at=? WHERE id=?`,
                [v.value.invoice_number, v.value.party_name, v.value.party_oib, v.value.invoice_date, v.value.amount,
                 v.value.booking_date, v.value.vrsta, v.value.settled_date, v.value.work_unit_id, v.value.project, v.value.notes, nowIso(), row.id]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_book_entries WHERE id = ?', [row.id]) });
        } catch (e) { log('book edit:', e.message); res.status(500).json({ error: 'Could not save the book entry.' }); }
    });

    app.delete('/api/v2/money/book/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_book_entries WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Book entry not found.' });
            const closed = yearClosed(yearOfDate(row.booking_date));
            if (closed) return res.status(409).json({ error: closed });
            db().run('DELETE FROM v2_money_book_entries WHERE id = ?', [row.id]);
            persist();
            res.json({ success: true, removed: row });
        } catch (e) { log('book delete:', e.message); res.status(500).json({ error: 'Could not remove the book entry.' }); }
    });

    // ================================================================== TRAVEL ORDERS (putni nalozi)
    app.get('/api/v2/money/travel-orders', auth, adminOnly, (req, res) => {
        try {
            const f = listFilters(req, 't.travel_date', 't.traveler_name');
            const rows = getAll(`SELECT t.*, wu.code AS work_unit_code, wu.name AS work_unit_name
                                 FROM v2_money_travel_orders t ${unitJoin('t')}
                                 ${f.where.replace(/\bproject = \?/, 't.project = ?').replace(/\bwork_unit_id = \?/, 't.work_unit_id = ?')}
                                 ORDER BY t.travel_date DESC, datetime(t.created_at) DESC`, f.params);
            res.json({ rows, sums: { count: rows.length, total: num2(rows.reduce((n, r) => n + (Number(r.total_cost) || 0), 0)) } });
        } catch (e) { log('travel list:', e.message); res.status(500).json({ error: 'Travel orders are unavailable right now.' }); }
    });

    function validateTravelBody(b, existing) {
        const out = {};
        out.order_number = b.order_number !== undefined ? clean(b.order_number, 60) : (existing ? existing.order_number : '');
        out.traveler_name = b.traveler_name !== undefined ? clean(b.traveler_name, 160) : (existing ? existing.traveler_name : '');
        out.travel_date = b.travel_date !== undefined ? String(b.travel_date || '').slice(0, 10) : (existing ? existing.travel_date : '');
        out.destination = b.destination !== undefined ? clean(b.destination, 200) : (existing ? existing.destination : '');
        out.purpose = b.purpose !== undefined ? (clean(b.purpose, 300) || null) : (existing ? existing.purpose : null);
        out.total_cost = b.total_cost !== undefined ? num2(b.total_cost) : (existing ? existing.total_cost : 0);
        out.opened_date = b.opened_date !== undefined ? (isYmd(b.opened_date) ? String(b.opened_date).slice(0, 10) : todayYmd()) : (existing ? existing.opened_date : todayYmd());
        out.work_unit_id = b.work_unit_id !== undefined ? (clean(b.work_unit_id, 60) || null) : (existing ? existing.work_unit_id : null);
        out.project = b.project !== undefined ? (clean(b.project, 60) || 'general') : (existing ? existing.project : 'general');
        out.notes = b.notes !== undefined ? (clean(b.notes, 500) || null) : (existing ? existing.notes : null);
        if (!out.traveler_name) return { error: 'Ime i prezime is required.' };
        if (!isYmd(out.travel_date)) return { error: 'Datum putovanja must be a date (YYYY-MM-DD).' };
        if (!out.destination) return { error: 'Odredište is required.' };
        if (!(out.total_cost >= 0)) return { error: 'Ukupan trošak cannot be negative.' };
        if (!unitExists(out.work_unit_id)) return { error: 'That radna jedinica does not exist — add it in the registry first.' };
        return { value: out };
    }

    app.post('/api/v2/money/travel-orders', auth, adminOnly, (req, res) => {
        try {
            const v = validateTravelBody(req.body || {}, null);
            if (v.error) return res.status(400).json({ error: v.error });
            const closed = yearClosed(yearOfDate(v.value.travel_date));
            if (closed) return res.status(409).json({ error: closed });
            if (!v.value.order_number) v.value.order_number = nextOrderNumber('v2_money_travel_orders', 'travel_date', 'PUT', yearOfDate(v.value.travel_date));
            const id = uuid();
            db().run(`INSERT INTO v2_money_travel_orders (id, order_number, traveler_name, travel_date, destination, purpose,
                        total_cost, opened_date, work_unit_id, project, notes, created_by, created_at, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), ?)`,
                [id, v.value.order_number, v.value.traveler_name, v.value.travel_date, v.value.destination, v.value.purpose,
                 v.value.total_cost, v.value.opened_date, v.value.work_unit_id, v.value.project, v.value.notes, by(req), nowIso()]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_travel_orders WHERE id = ?', [id]) });
        } catch (e) { log('travel add:', e.message); res.status(500).json({ error: 'Could not save the travel order.' }); }
    });

    app.put('/api/v2/money/travel-orders/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_travel_orders WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Travel order not found.' });
            const v = validateTravelBody(req.body || {}, row);
            if (v.error) return res.status(400).json({ error: v.error });
            const closed = yearClosed(yearOfDate(row.travel_date)) || yearClosed(yearOfDate(v.value.travel_date));
            if (closed) return res.status(409).json({ error: closed });
            if (!v.value.order_number) v.value.order_number = row.order_number;
            db().run(`UPDATE v2_money_travel_orders SET order_number=?, traveler_name=?, travel_date=?, destination=?, purpose=?,
                        total_cost=?, opened_date=?, work_unit_id=?, project=?, notes=?, updated_at=? WHERE id=?`,
                [v.value.order_number, v.value.traveler_name, v.value.travel_date, v.value.destination, v.value.purpose,
                 v.value.total_cost, v.value.opened_date, v.value.work_unit_id, v.value.project, v.value.notes, nowIso(), row.id]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_travel_orders WHERE id = ?', [row.id]) });
        } catch (e) { log('travel edit:', e.message); res.status(500).json({ error: 'Could not save the travel order.' }); }
    });

    app.delete('/api/v2/money/travel-orders/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_travel_orders WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Travel order not found.' });
            const closed = yearClosed(yearOfDate(row.travel_date));
            if (closed) return res.status(409).json({ error: closed });
            db().run('DELETE FROM v2_money_travel_orders WHERE id = ?', [row.id]);
            persist();
            res.json({ success: true, removed: row });
        } catch (e) { log('travel delete:', e.message); res.status(500).json({ error: 'Could not remove the travel order.' }); }
    });

    // ================================================================== PAYMENT ORDERS (nalozi za plaćanje)
    app.get('/api/v2/money/payment-orders', auth, adminOnly, (req, res) => {
        try {
            const f = listFilters(req, 'p.order_date', 'p.recipient_name');
            const rows = getAll(`SELECT p.*, wu.code AS work_unit_code, wu.name AS work_unit_name
                                 FROM v2_money_payment_orders p ${unitJoin('p')}
                                 ${f.where.replace(/\bproject = \?/, 'p.project = ?').replace(/\bwork_unit_id = \?/, 'p.work_unit_id = ?')}
                                 ORDER BY p.order_date DESC, datetime(p.created_at) DESC`, f.params);
            res.json({ rows, sums: { count: rows.length, total: num2(rows.reduce((n, r) => n + (Number(r.amount) || 0), 0)) } });
        } catch (e) { log('payment list:', e.message); res.status(500).json({ error: 'Payment orders are unavailable right now.' }); }
    });

    function validatePaymentBody(b, existing) {
        const out = {};
        out.order_number = b.order_number !== undefined ? clean(b.order_number, 60) : (existing ? existing.order_number : '');
        out.recipient_name = b.recipient_name !== undefined ? clean(b.recipient_name, 200) : (existing ? existing.recipient_name : '');
        out.description = b.description !== undefined ? (clean(b.description, 300) || null) : (existing ? existing.description : null);
        out.amount = b.amount !== undefined ? num2(b.amount) : (existing ? existing.amount : 0);
        out.order_date = b.order_date !== undefined ? String(b.order_date || '').slice(0, 10) : (existing ? existing.order_date : todayYmd());
        out.work_unit_id = b.work_unit_id !== undefined ? (clean(b.work_unit_id, 60) || null) : (existing ? existing.work_unit_id : null);
        out.project = b.project !== undefined ? (clean(b.project, 60) || 'general') : (existing ? existing.project : 'general');
        out.notes = b.notes !== undefined ? (clean(b.notes, 500) || null) : (existing ? existing.notes : null);
        if (!out.recipient_name) return { error: 'The recipient name is required.' };
        if (!(out.amount > 0)) return { error: 'Iznos must be a positive amount.' };
        if (!isYmd(out.order_date)) return { error: 'Datum naloga must be a date (YYYY-MM-DD).' };
        if (!unitExists(out.work_unit_id)) return { error: 'That radna jedinica does not exist — add it in the registry first.' };
        return { value: out };
    }

    app.post('/api/v2/money/payment-orders', auth, adminOnly, (req, res) => {
        try {
            const v = validatePaymentBody(req.body || {}, null);
            if (v.error) return res.status(400).json({ error: v.error });
            const closed = yearClosed(yearOfDate(v.value.order_date));
            if (closed) return res.status(409).json({ error: closed });
            if (!v.value.order_number) v.value.order_number = nextOrderNumber('v2_money_payment_orders', 'order_date', 'PN', yearOfDate(v.value.order_date));
            const id = uuid();
            db().run(`INSERT INTO v2_money_payment_orders (id, order_number, recipient_name, description, amount, order_date,
                        work_unit_id, project, notes, created_by, created_at, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'), ?)`,
                [id, v.value.order_number, v.value.recipient_name, v.value.description, v.value.amount, v.value.order_date,
                 v.value.work_unit_id, v.value.project, v.value.notes, by(req), nowIso()]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_payment_orders WHERE id = ?', [id]) });
        } catch (e) { log('payment add:', e.message); res.status(500).json({ error: 'Could not save the payment order.' }); }
    });

    app.put('/api/v2/money/payment-orders/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_payment_orders WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Payment order not found.' });
            const v = validatePaymentBody(req.body || {}, row);
            if (v.error) return res.status(400).json({ error: v.error });
            const closed = yearClosed(yearOfDate(row.order_date)) || yearClosed(yearOfDate(v.value.order_date));
            if (closed) return res.status(409).json({ error: closed });
            if (!v.value.order_number) v.value.order_number = row.order_number;
            db().run(`UPDATE v2_money_payment_orders SET order_number=?, recipient_name=?, description=?, amount=?, order_date=?,
                        work_unit_id=?, project=?, notes=?, updated_at=? WHERE id=?`,
                [v.value.order_number, v.value.recipient_name, v.value.description, v.value.amount, v.value.order_date,
                 v.value.work_unit_id, v.value.project, v.value.notes, nowIso(), row.id]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_payment_orders WHERE id = ?', [row.id]) });
        } catch (e) { log('payment edit:', e.message); res.status(500).json({ error: 'Could not save the payment order.' }); }
    });

    app.delete('/api/v2/money/payment-orders/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_payment_orders WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Payment order not found.' });
            const closed = yearClosed(yearOfDate(row.order_date));
            if (closed) return res.status(409).json({ error: closed });
            db().run('DELETE FROM v2_money_payment_orders WHERE id = ?', [row.id]);
            persist();
            res.json({ success: true, removed: row });
        } catch (e) { log('payment delete:', e.message); res.status(500).json({ error: 'Could not remove the payment order.' }); }
    });

    // ================================================================== WORK UNITS (radne jedinice)
    function unitYearNumbers(unitId, year) {
        const y = String(year);
        const prihod = (getRow(`SELECT COALESCE(SUM(amount),0) AS n FROM v2_money_book_entries WHERE direction='out' AND work_unit_id = ? AND substr(booking_date,1,4) = ?`, [unitId, y]) || {}).n || 0;
        const rashodIn = (getRow(`SELECT COALESCE(SUM(amount),0) AS n FROM v2_money_book_entries WHERE direction='in' AND work_unit_id = ? AND substr(booking_date,1,4) = ?`, [unitId, y]) || {}).n || 0;
        const rashodTravel = (getRow(`SELECT COALESCE(SUM(total_cost),0) AS n FROM v2_money_travel_orders WHERE work_unit_id = ? AND substr(travel_date,1,4) = ?`, [unitId, y]) || {}).n || 0;
        return { prihod: num2(prihod), rashod: num2(rashodIn + rashodTravel) };
    }

    app.get('/api/v2/money/work-units', auth, adminOnly, (req, res) => {
        try {
            const year = qYear(req);
            const rows = getAll('SELECT * FROM v2_money_work_units ORDER BY active DESC, code').map(u => {
                const n = unitYearNumbers(u.id, year);
                return { ...u, year, prihod: n.prihod, rashod: n.rashod,
                    konacno: num2((Number(u.carryover_prev) || 0) + n.prihod - n.rashod) };
            });
            res.json({ rows, year });
        } catch (e) { log('units list:', e.message); res.status(500).json({ error: 'The work-unit registry is unavailable right now.' }); }
    });

    app.post('/api/v2/money/work-units', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const code = clean(b.code, 40), name = clean(b.name, 160);
            if (!code) return res.status(400).json({ error: 'Šifra radne jedinice is required.' });
            if (!name) return res.status(400).json({ error: 'Naziv radne jedinice is required.' });
            if (getRow('SELECT id FROM v2_money_work_units WHERE LOWER(code) = ?', [code.toLowerCase()]))
                return res.status(409).json({ error: `A work unit with šifra ${code} already exists.` });
            const id = uuid();
            db().run(`INSERT INTO v2_money_work_units (id, code, name, description, carryover_prev, active, created_by, created_at, updated_at)
                      VALUES (?,?,?,?,?,1,?, datetime('now'), ?)`,
                [id, code, name, clean(b.description, 400) || null, num2(b.carryover_prev), by(req), nowIso()]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_work_units WHERE id = ?', [id]) });
        } catch (e) { log('unit add:', e.message); res.status(500).json({ error: 'Could not save the work unit.' }); }
    });

    app.put('/api/v2/money/work-units/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_work_units WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Work unit not found.' });
            const b = req.body || {};
            const code = b.code !== undefined ? clean(b.code, 40) : row.code;
            const name = b.name !== undefined ? clean(b.name, 160) : row.name;
            if (!code || !name) return res.status(400).json({ error: 'A work unit needs both šifra and naziv.' });
            const dup = getRow('SELECT id FROM v2_money_work_units WHERE LOWER(code) = ? AND id != ?', [code.toLowerCase(), row.id]);
            if (dup) return res.status(409).json({ error: `A work unit with šifra ${code} already exists.` });
            db().run(`UPDATE v2_money_work_units SET code=?, name=?, description=?, carryover_prev=?, active=?, updated_at=? WHERE id=?`,
                [code, name,
                 b.description !== undefined ? (clean(b.description, 400) || null) : row.description,
                 b.carryover_prev !== undefined ? num2(b.carryover_prev) : row.carryover_prev,
                 b.active !== undefined ? (b.active ? 1 : 0) : row.active,
                 nowIso(), row.id]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_work_units WHERE id = ?', [row.id]) });
        } catch (e) { log('unit edit:', e.message); res.status(500).json({ error: 'Could not save the work unit.' }); }
    });

    app.delete('/api/v2/money/work-units/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_work_units WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Work unit not found.' });
            const used = ['v2_money_book_entries', 'v2_money_travel_orders', 'v2_money_payment_orders', 'v2_money_expected_income']
                .some(t => getRow(`SELECT id FROM ${t} WHERE work_unit_id = ? LIMIT 1`, [row.id]));
            if (used) return res.status(409).json({ error: 'Rows are booked on this work unit — reassign them first (or leave the unit and mark it inactive).' });
            db().run('DELETE FROM v2_money_work_units WHERE id = ?', [row.id]);
            persist();
            res.json({ success: true, removed: row });
        } catch (e) { log('unit delete:', e.message); res.status(500).json({ error: 'Could not remove the work unit.' }); }
    });

    // ================================================================== EXPECTED INCOME (owed to us, entered by hand)
    app.get('/api/v2/money/expected', auth, adminOnly, (req, res) => {
        try {
            const rows = getAll(`SELECT x.*, wu.code AS work_unit_code, wu.name AS work_unit_name
                                 FROM v2_money_expected_income x ${unitJoin('x')}
                                 ORDER BY (x.status != 'open'), COALESCE(x.expected_date, x.created_at) ASC`);
            const open = rows.filter(r => r.status === 'open');
            res.json({ rows, sums: { open_count: open.length, open_total: num2(open.reduce((n, r) => n + (Number(r.amount) || 0), 0)) } });
        } catch (e) { log('expected list:', e.message); res.status(500).json({ error: 'Expected income is unavailable right now.' }); }
    });

    app.post('/api/v2/money/expected', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const source = clean(b.source, 200);
            const amount = num2(b.amount);
            if (!source) return res.status(400).json({ error: 'Who owes us? Name the source (e.g. MZO — natječaj).' });
            if (!(amount > 0)) return res.status(400).json({ error: 'The expected amount must be positive.' });
            if (b.work_unit_id && !unitExists(clean(b.work_unit_id, 60))) return res.status(400).json({ error: 'That radna jedinica does not exist.' });
            const id = uuid();
            db().run(`INSERT INTO v2_money_expected_income (id, source, description, amount, expected_date, project, work_unit_id, status, notes, created_by, created_at, updated_at)
                      VALUES (?,?,?,?,?,?,?, 'open', ?, ?, datetime('now'), ?)`,
                [id, source, clean(b.description, 400) || null, amount,
                 isYmd(b.expected_date) ? String(b.expected_date).slice(0, 10) : null,
                 clean(b.project, 60) || 'general', clean(b.work_unit_id, 60) || null,
                 clean(b.notes, 500) || null, by(req), nowIso()]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_expected_income WHERE id = ?', [id]) });
        } catch (e) { log('expected add:', e.message); res.status(500).json({ error: 'Could not record the expected income.' }); }
    });

    app.put('/api/v2/money/expected/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_expected_income WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Expected-income row not found.' });
            const b = req.body || {};
            const source = b.source !== undefined ? clean(b.source, 200) : row.source;
            const amount = b.amount !== undefined ? num2(b.amount) : row.amount;
            if (!source) return res.status(400).json({ error: 'The source needs a name.' });
            if (!(amount > 0)) return res.status(400).json({ error: 'The amount must stay positive.' });
            let status = row.status, received = row.received_date;
            if (b.status !== undefined) {
                if (!['open', 'received', 'cancelled'].includes(b.status)) return res.status(400).json({ error: 'Unknown status.' });
                status = b.status;
                if (status !== 'received') received = null;
            }
            if (b.work_unit_id !== undefined && b.work_unit_id && !unitExists(clean(b.work_unit_id, 60))) return res.status(400).json({ error: 'That radna jedinica does not exist.' });
            db().run(`UPDATE v2_money_expected_income SET source=?, description=?, amount=?, expected_date=?, project=?, work_unit_id=?, status=?, received_date=?, notes=?, updated_at=? WHERE id=?`,
                [source,
                 b.description !== undefined ? (clean(b.description, 400) || null) : row.description,
                 amount,
                 b.expected_date !== undefined ? (isYmd(b.expected_date) ? String(b.expected_date).slice(0, 10) : null) : row.expected_date,
                 b.project !== undefined ? (clean(b.project, 60) || 'general') : row.project,
                 b.work_unit_id !== undefined ? (clean(b.work_unit_id, 60) || null) : row.work_unit_id,
                 status, received,
                 b.notes !== undefined ? (clean(b.notes, 500) || null) : row.notes,
                 nowIso(), row.id]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_expected_income WHERE id = ?', [row.id]) });
        } catch (e) { log('expected edit:', e.message); res.status(500).json({ error: 'Could not save the row.' }); }
    });

    app.post('/api/v2/money/expected/:id/receive', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_expected_income WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Expected-income row not found.' });
            if (row.status === 'received') return res.status(409).json({ error: 'Already marked received.' });
            const when = isYmd((req.body || {}).received_date) ? String(req.body.received_date).slice(0, 10) : todayYmd();
            db().run(`UPDATE v2_money_expected_income SET status='received', received_date=?, updated_at=? WHERE id=?`, [when, nowIso(), row.id]);
            persist();
            res.json({ success: true, row: getRow('SELECT * FROM v2_money_expected_income WHERE id = ?', [row.id]) });
        } catch (e) { log('expected receive:', e.message); res.status(500).json({ error: 'Could not mark the row received.' }); }
    });

    app.delete('/api/v2/money/expected/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT * FROM v2_money_expected_income WHERE id = ?', [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Expected-income row not found.' });
            db().run('DELETE FROM v2_money_expected_income WHERE id = ?', [row.id]);
            persist();
            res.json({ success: true, removed: row });
        } catch (e) { log('expected delete:', e.message); res.status(500).json({ error: 'Could not remove the row.' }); }
    });

    // ================================================================== SUMMARY (the header tiles + recent money in)
    function galaPriceByClock() {
        let gs = {};
        try { gs = getRow("SELECT price_gala_early_bird, price_gala_regular, early_bird_deadline FROM gala_settings WHERE id = 'default'") || {}; } catch (e) {}
        const early = Number(gs.price_gala_early_bird) || 150;
        const regular = Number(gs.price_gala_regular) || 175;
        const deadline = String(gs.early_bird_deadline || '2026-12-04').slice(0, 10);
        return todayYmd() <= deadline ? early : regular;
    }
    const sumRow = (sql, params) => { try { return (getRow(sql, params) || {}); } catch (e) { return {}; } };

    function moneySummary(year) {
        const y = String(year);

        // -- legacy ledger (the canonical "money moved" table every payment flow books into)
        const legIn = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM finance_transactions
                              WHERE transaction_type='income' AND fiscal_year = ? AND COALESCE(status,'completed') != 'draft'`, [year]);
        const legEx = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM finance_transactions
                              WHERE transaction_type='expense' AND fiscal_year = ? AND COALESCE(status,'completed') != 'draft'`, [year]);

        // -- paid gala seats that never reached the ledger (webhook books by reference = invoice number)
        const galaUnbooked = sumRow(`SELECT COALESCE(SUM(amount_paid),0) AS t, COUNT(*) AS c FROM gala_registrations g
                                     WHERE g.payment_status = 'paid' AND COALESCE(g.amount_paid,0) > 0
                                       AND (g.invoice_number IS NULL OR g.invoice_number NOT IN
                                            (SELECT reference FROM finance_transactions WHERE reference IS NOT NULL))`, []);

        // -- v2 books (booking year); collected outgoing rows deduped against ledger references
        const bookOutCollected = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_money_book_entries b
                                         WHERE b.direction='out' AND substr(b.booking_date,1,4) = ? AND b.settled_date IS NOT NULL
                                           AND b.invoice_number NOT IN (SELECT reference FROM finance_transactions WHERE reference IS NOT NULL)`, [y]);
        const bookOutOpen = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_money_book_entries
                                    WHERE direction='out' AND substr(booking_date,1,4) = ? AND settled_date IS NULL`, [y]);
        const bookIn = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_money_book_entries
                               WHERE direction='in' AND substr(booking_date,1,4) = ?`, [y]);

        // -- v2 travel + payment orders
        const travel = sumRow(`SELECT COALESCE(SUM(total_cost),0) AS t, COUNT(*) AS c FROM v2_money_travel_orders WHERE substr(travel_date,1,4) = ?`, [y]);
        const payOrders = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_money_payment_orders WHERE substr(order_date,1,4) = ?`, [y]);

        // -- expected income (manual receivables — e.g. an awarded MZO grant not yet paid out)
        const expOpen = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_money_expected_income WHERE status='open'`, []);
        const expReceived = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_money_expected_income
                                    WHERE status='received' AND substr(COALESCE(received_date,''),1,4) = ?`, [y]);

        // -- sponsor & donor ledger (card lives with its project now; the money still counts here)
        const ledgerPaid = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_sponsor_ledger
                                   WHERE status IN ('paid','thanked') AND substr(COALESCE(paid_at,''),1,4) = ?`, [y]);
        const ledgerInvoiced = sumRow(`SELECT COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM v2_sponsor_ledger WHERE status='invoiced'`, []);

        // -- unpaid gala seats at today's price + legacy invoices still open
        const galaUnpaid = sumRow(`SELECT COUNT(*) AS c FROM gala_registrations
                                   WHERE payment_status != 'paid' AND COALESCE(status,'') NOT IN ('rejected','cancelled')`, []);
        const price = galaPriceByClock();
        const legacyInvOpen = sumRow(`SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS c FROM finance_invoices
                                      WHERE direction='outgoing' AND status IN ('issued','sent') AND fiscal_year = ?`, [year]);

        const src = (key, label, amount, count) => ({ key, label, amount: num2(amount || 0), count: count || 0 });
        const collectedSources = [
            src('legacy_tx', 'Booked income (ledger — Stripe, bank, mark-paid)', legIn.t, legIn.c),
            src('gala_unbooked', 'Gala seats paid, not yet in the ledger', galaUnbooked.t, galaUnbooked.c),
            src('book_out', 'Izlazni računi — naplaćeni (book rows)', bookOutCollected.t, bookOutCollected.c),
            src('expected', 'Expected income received (MZO & friends)', expReceived.t, expReceived.c),
            src('sponsor_ledger', 'Sponsors & donors paid', ledgerPaid.t, ledgerPaid.c)
        ].filter(s => s.amount > 0 || s.key === 'legacy_tx');
        const spentSources = [
            src('legacy_tx', 'Booked expenses (ledger)', legEx.t, legEx.c),
            src('book_in', 'Ulazni računi (book rows)', bookIn.t, bookIn.c),
            src('travel', 'Putni nalozi', travel.t, travel.c)
        ].filter(s => s.amount > 0 || s.key === 'legacy_tx');
        const owedSources = [
            src('expected', 'Expected income — entered by hand', expOpen.t, expOpen.c),
            src('gala_unpaid', `Reserved Gala seats × ${price} €`, (galaUnpaid.c || 0) * price, galaUnpaid.c),
            src('book_out_open', 'Izlazni računi — nenaplaćeni', bookOutOpen.t, bookOutOpen.c),
            src('legacy_invoices', 'Legacy invoices still open', legacyInvOpen.t, legacyInvOpen.c),
            src('sponsor_ledger', 'Sponsor pledges at invoiced', ledgerInvoiced.t, ledgerInvoiced.c)
        ].filter(s => s.amount > 0);

        const total = list => num2(list.reduce((n, s) => n + s.amount, 0));

        // -- RECENT MONEY IN: every source, one stream (same dedup as the tile)
        const recent = [];
        try {
            getAll(`SELECT date, description, amount, category, payment_method FROM finance_transactions
                    WHERE transaction_type='income' AND fiscal_year = ? AND COALESCE(status,'completed') != 'draft'
                    ORDER BY date DESC, datetime(created_at) DESC LIMIT 40`, [year])
                .forEach(r => recent.push({ date: r.date, label: r.description || 'Income', amount: num2(r.amount),
                    source: /card|stripe/i.test(r.payment_method || '') ? 'CARD' : /gala/.test(r.category || '') ? 'GALA' : /conference/.test(r.category || '') ? 'PLEXUS' : 'BANK' }));
        } catch (e) {}
        getAll(`SELECT b.settled_date AS date, b.party_name, b.invoice_number, b.amount FROM v2_money_book_entries b
                WHERE b.direction='out' AND b.settled_date IS NOT NULL AND substr(b.booking_date,1,4) = ?
                  AND b.invoice_number NOT IN (SELECT reference FROM finance_transactions WHERE reference IS NOT NULL)
                ORDER BY b.settled_date DESC LIMIT 20`, [y])
            .forEach(r => recent.push({ date: r.date, label: `${r.party_name} — račun ${r.invoice_number}`, amount: num2(r.amount), source: 'RAČUN' }));
        try {
            getAll(`SELECT substr(g.created_at,1,10) AS date, g.first_name, g.last_name, g.amount_paid FROM gala_registrations g
                    WHERE g.payment_status = 'paid' AND COALESCE(g.amount_paid,0) > 0
                      AND (g.invoice_number IS NULL OR g.invoice_number NOT IN
                           (SELECT reference FROM finance_transactions WHERE reference IS NOT NULL))
                    ORDER BY g.created_at DESC LIMIT 20`, [])
                .forEach(r => recent.push({ date: r.date, label: `Gala Evening — ${[r.first_name, r.last_name].filter(Boolean).join(' ')}`, amount: num2(r.amount_paid), source: 'GALA' }));
        } catch (e) {}
        getAll(`SELECT received_date AS date, source, description, amount FROM v2_money_expected_income
                WHERE status='received' AND substr(COALESCE(received_date,''),1,4) = ? ORDER BY received_date DESC LIMIT 20`, [y])
            .forEach(r => recent.push({ date: r.date, label: r.source + (r.description ? ' — ' + r.description : ''), amount: num2(r.amount), source: 'GRANT' }));
        try {
            getAll(`SELECT substr(COALESCE(paid_at,''),1,10) AS date, party, amount FROM v2_sponsor_ledger
                    WHERE status IN ('paid','thanked') AND substr(COALESCE(paid_at,''),1,4) = ? ORDER BY paid_at DESC LIMIT 20`, [y])
                .forEach(r => recent.push({ date: r.date, label: r.party + ' — sponsorship/donation', amount: num2(r.amount), source: 'SPONSOR' }));
        } catch (e) {}
        recent.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

        return {
            year,
            collected: { total: total(collectedSources), sources: collectedSources },
            spent: { total: total(spentSources), sources: spentSources },
            owed: { total: total(owedSources), sources: owedSources },
            payment_orders: { total: num2(payOrders.t), count: payOrders.c || 0 },
            gala: { unpaid_count: galaUnpaid.c || 0, price },
            recent_in: recent.slice(0, 25)
        };
    }

    app.get('/api/v2/money/summary', auth, adminOnly, (req, res) => {
        try { res.json(moneySummary(qYear(req))); }
        catch (e) { log('summary:', e.message); res.status(500).json({ error: 'The money summary is unavailable right now.' }); }
    });

    // ================================================================== REPORTS (by project · work unit · person · date range)
    // One consistent composition: prihod = izlazni računi (booked) + expected received;
    // rashod = ulazni računi + putni nalozi. Payment orders stay out of the sums (they
    // usually execute an incoming invoice) — export them from their own list instead.
    function reportDetailRows(req) {
        const rows = [];
        const push = (set, r, kind, amount, person, date) => rows.push({
            set, kind, amount: num2(amount), person: person || '',
            date: date || '', number: r.invoice_number || r.order_number || '',
            name: r.party_name || r.traveler_name || r.recipient_name || r.source || '',
            description: r.description || r.purpose || r.notes || '',
            project: r.project || 'general',
            work_unit: r.work_unit_code ? `${r.work_unit_code} ${r.work_unit_name || ''}`.trim() : ''
        });
        bookRows(req, 'out').forEach(r => push('izlazni-racun', r, 'income', r.amount, r.party_name, r.booking_date));
        bookRows(req, 'in').forEach(r => push('ulazni-racun', r, 'expense', r.amount, r.party_name, r.booking_date));
        {
            const f = listFilters(req, 't.travel_date', 't.traveler_name');
            getAll(`SELECT t.*, wu.code AS work_unit_code, wu.name AS work_unit_name FROM v2_money_travel_orders t ${unitJoin('t')} ${f.where}`, f.params)
                .forEach(r => push('putni-nalog', r, 'expense', r.total_cost, r.traveler_name, r.travel_date));
        }
        {
            const f = listFilters(req, "COALESCE(x.received_date, x.expected_date, substr(x.created_at,1,10))", 'x.source');
            getAll(`SELECT x.*, wu.code AS work_unit_code, wu.name AS work_unit_name FROM v2_money_expected_income x ${unitJoin('x')}
                    ${f.where ? f.where + ' AND ' : 'WHERE '} x.status = 'received'`, f.params)
                .forEach(r => push('ocekivana-uplata', r, 'income', r.amount, r.source, r.received_date));
        }
        return rows;
    }
    function reportGroups(req, group) {
        const rows = reportDetailRows(req);
        const groups = {};
        const keyOf = r => group === 'work_unit' ? (r.work_unit || '— bez radne jedinice —')
                        : group === 'person' ? (r.person || '— bez osobe —')
                        : (r.project || 'general');
        rows.forEach(r => {
            const k = keyOf(r);
            const g = groups[k] || (groups[k] = { key: k, label: k, income: 0, expense: 0, items: 0 });
            if (r.kind === 'income') g.income = num2(g.income + r.amount); else g.expense = num2(g.expense + r.amount);
            g.items++;
        });
        // by-project reports also fold in the legacy ledger so they reconcile with the tiles
        if (group === 'project' && !req.query.from && !req.query.to && !req.query.work_unit && !req.query.person) {
            try {
                getAll(`SELECT project, transaction_type, COALESCE(SUM(amount),0) AS t, COUNT(*) AS c FROM finance_transactions
                        WHERE fiscal_year = ? AND COALESCE(status,'completed') != 'draft' GROUP BY project, transaction_type`, [qYear(req)])
                    .forEach(r => {
                        const k = r.project || 'general';
                        const g = groups[k] || (groups[k] = { key: k, label: k, income: 0, expense: 0, items: 0 });
                        if (r.transaction_type === 'income') g.income = num2(g.income + r.t); else g.expense = num2(g.expense + r.t);
                        g.items += r.c; g.includes_legacy = true;
                    });
            } catch (e) {}
        }
        const list = Object.values(groups).map(g => ({ ...g, net: num2(g.income - g.expense) }))
            .sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
        return { group, rows: list,
            totals: { income: num2(list.reduce((n, g) => n + g.income, 0)), expense: num2(list.reduce((n, g) => n + g.expense, 0)),
                      net: num2(list.reduce((n, g) => n + g.net, 0)), items: list.reduce((n, g) => n + g.items, 0) } };
    }

    app.get('/api/v2/money/report', auth, adminOnly, (req, res) => {
        try {
            const group = ['project', 'work_unit', 'person'].includes(req.query.group) ? req.query.group : 'project';
            res.json(reportGroups(req, group));
        } catch (e) { log('report:', e.message); res.status(500).json({ error: 'The report is unavailable right now.' }); }
    });

    // ================================================================== CSV EXPORTS (always the FILTERED set)
    const unitLabel = r => r.work_unit_code ? `${r.work_unit_code} ${r.work_unit_name || ''}`.trim() : '';
    app.get('/api/v2/money/export.csv', auth, adminOnly, (req, res) => {
        try {
            const set = String(req.query.set || '');
            const year = qYear(req);
            if (set === 'book_out' || set === 'book_in') {
                const dir = set === 'book_out' ? 'out' : 'in';
                const rows = bookRows(req, dir);
                const legacy = String(req.query.include_legacy || '') === '1' ? legacyBookRows(dir, year) : [];
                const partyH = dir === 'out' ? 'Naziv kupca' : 'Naziv dobavljača';
                const oibH = dir === 'out' ? 'OIB kupca' : 'OIB dobavljača';
                const settledH = dir === 'out' ? 'Datum naplate' : 'Datum plaćanja';
                const headers = ['Broj računa', partyH, oibH, 'Datum računa', 'Iznos (EUR)', 'Datum knjiženja']
                    .concat(dir === 'out' ? ['Vrsta'] : []).concat([settledH, 'Radna jedinica', 'Projekt', 'Napomena', 'Izvor']);
                const data = rows.map(r => [r.invoice_number, r.party_name, r.party_oib || '', r.invoice_date, r.amount, r.booking_date]
                        .concat(dir === 'out' ? [r.vrsta || ''] : []).concat([r.settled_date || '', unitLabel(r), r.project || '', r.notes || '', 'knjiga']))
                    .concat(legacy.map(r => [r.invoice_number || '', r.party_name || '', r.party_oib || '', r.invoice_date || '', r.amount, '']
                        .concat(dir === 'out' ? [r.vrsta || ''] : []).concat([r.settled_date || '', unitLabel(r), r.project || '', r.status || '', 'legacy'])));
                return sendCsv(res, `medx-${dir === 'out' ? 'izlazni' : 'ulazni'}-racuni-${year}.csv`, headers, data);
            }
            if (set === 'travel') {
                const f = listFilters(req, 't.travel_date', 't.traveler_name');
                const rows = getAll(`SELECT t.*, wu.code AS work_unit_code, wu.name AS work_unit_name FROM v2_money_travel_orders t ${unitJoin('t')} ${f.where} ORDER BY t.travel_date DESC`, f.params);
                return sendCsv(res, `medx-putni-nalozi-${year}.csv`,
                    ['Broj naloga', 'Ime i prezime', 'Datum putovanja', 'Odredište', 'Svrha', 'Ukupan trošak (EUR)', 'Datum otvaranja', 'Radna jedinica', 'Projekt', 'Napomena'],
                    rows.map(r => [r.order_number, r.traveler_name, r.travel_date, r.destination, r.purpose || '', r.total_cost, r.opened_date || '', unitLabel(r), r.project || '', r.notes || '']));
            }
            if (set === 'payment') {
                const f = listFilters(req, 'p.order_date', 'p.recipient_name');
                const rows = getAll(`SELECT p.*, wu.code AS work_unit_code, wu.name AS work_unit_name FROM v2_money_payment_orders p ${unitJoin('p')} ${f.where} ORDER BY p.order_date DESC`, f.params);
                return sendCsv(res, `medx-nalozi-za-placanje-${year}.csv`,
                    ['Broj naloga', 'Primatelj', 'Opis', 'Iznos (EUR)', 'Datum naloga', 'Radna jedinica', 'Projekt', 'Napomena'],
                    rows.map(r => [r.order_number, r.recipient_name, r.description || '', r.amount, r.order_date, unitLabel(r), r.project || '', r.notes || '']));
            }
            if (set === 'units') {
                const rows = getAll('SELECT * FROM v2_money_work_units ORDER BY active DESC, code');
                return sendCsv(res, `medx-radne-jedinice-${year}.csv`,
                    ['Šifra', 'Naziv', 'Opis', `Prihod ${year} (EUR)`, `Rashod ${year} (EUR)`, 'Preneseno stanje (EUR)', 'Konačno stanje (EUR)', 'Aktivna'],
                    rows.map(u => { const n = unitYearNumbers(u.id, year);
                        return [u.code, u.name, u.description || '', n.prihod, n.rashod, num2(u.carryover_prev),
                                num2((Number(u.carryover_prev) || 0) + n.prihod - n.rashod), u.active ? 'da' : 'ne']; }));
            }
            if (set === 'expected') {
                const rows = getAll(`SELECT x.*, wu.code AS work_unit_code, wu.name AS work_unit_name FROM v2_money_expected_income x ${unitJoin('x')} ORDER BY (x.status != 'open'), COALESCE(x.expected_date, x.created_at)`);
                return sendCsv(res, `medx-ocekivane-uplate.csv`,
                    ['Izvor', 'Opis', 'Iznos (EUR)', 'Očekivani datum', 'Status', 'Datum primitka', 'Projekt', 'Radna jedinica'],
                    rows.map(r => [r.source, r.description || '', r.amount, r.expected_date || '', r.status, r.received_date || '', r.project || '', unitLabel(r)]));
            }
            if (set === 'report') {
                const group = ['project', 'work_unit', 'person'].includes(req.query.group) ? req.query.group : 'project';
                const rep = reportGroups(req, group);
                const label = { project: 'Projekt', work_unit: 'Radna jedinica', person: 'Osoba' }[group];
                return sendCsv(res, `medx-izvjestaj-${group.replace('_', '-')}-${year}.csv`,
                    [label, 'Prihod (EUR)', 'Rashod (EUR)', 'Neto (EUR)', 'Stavki'],
                    rep.rows.map(g => [g.label, g.income, g.expense, g.net, g.items])
                        .concat([['UKUPNO', rep.totals.income, rep.totals.expense, rep.totals.net, rep.totals.items]]));
            }
            res.status(400).json({ error: "set must be one of: book_out, book_in, travel, payment, units, expected, report." });
        } catch (e) { log('csv export:', e.message); res.status(500).json({ error: 'The CSV export failed.' }); }
    });

    log('money module ready: books + orders + units + expected + summary + reports/CSV (Miro rebuild) · ledger + chase + survey retained for project screens (sweep every ' + (SWEEP_EVERY_MS / 60000) + ' min)');
};
