/**
 * gala-audit.js — the Gala payment auditor (Alen, 22 Sept 2026: "an auditor for every person that
 * pays the Gala, to make sure everything regarding payment, the total cost and the FIRA invoice is
 * correct; if not, double-check, and if it's really incorrect notify me immediately").
 *
 * WHAT IT CHECKS, per paid Gala registration (each check → {check, ok, expected, actual, note}):
 *   charge      Stripe amount_total (cents) == amount_paid × 100 and the session says paid.
 *   price       amount_paid == seats × Gala price on the PAYMENT DATE − coupon discount, where the
 *               seat price is the early-bird price until gala_settings.early_bird_deadline, the
 *               regular price after it, the early-bird price whatever the date for a Forum member,
 *               and either price on the deadline day itself (UTC vs Zagreb). A 'seat' code (the
 *               SLOVENIA-PLEXUS pool, settled by bank transfer, no Stripe) is k × price for some
 *               1 ≤ k ≤ seats. Comps (vip-comp / comp) are €0 and skipped.
 *   seats       1 + guest_count on the gala row == 1 + guest_count on the linked Zagreb row ==
 *               the FIRA line quantity == the seats the price was computed for; the named Gala
 *               guests never outnumber guest_count.
 *   fira        an invoice number is recorded, FIRA answered with an id / invoice number, and the
 *               ORDER WE SENT prints right: brutto == amount_paid, every line price × quantity
 *               equals its total, the lines sum to brutto, the buyer is the registrant, paymentType
 *               KARTICA for a card payment, webshopOrderNumber == our invoice number. FIRA's API
 *               has no read endpoint (every GET shape answers 400 requestRejected, probed
 *               2026-09-22), so the payload + response captured at creation are persisted here
 *               (gala_payment_audits.fira_json) and re-audits read them back.
 *   ledger      exactly one finance_transactions income row carries this invoice number, with the
 *               same amount.
 *   duplicates  no OTHER paid gala row with the same (lowercased) email — a second paid row is a
 *               double charge unless it is a different party, so a human decides.
 *   ticket      the ticket email was accepted by the provider (the send result is at hand in the
 *               webhook; a re-audit asks Brevo's transactional log for this address + subject).
 *
 * DOUBLE-CHECK BEFORE ALERTING. A failing first pass is stored as status 'retrying' and re-run
 * once after 90 s from FRESH rows (replica lag, Stripe / FIRA eventual consistency). Only a second
 * failure writes status 'failed' and emails the owner — once per registration, never the guest.
 * A check that could not be decided (Stripe unreachable, Brevo down) is ok:null → status
 * 'uncertain': stored, listed, re-audited by the sweep, never paged.
 *
 * KNOWN. The 15 multi-seat invoices issued before the 0%-VAT unit-price fix (8bba7cb) print the
 * wrong line — the owner already knows. They are seeded as status 'known' once and never alert.
 *
 * SWEEP. 60 s after boot and daily at 07:00 Europe/Zagreb: every paid gala row of the last 14
 * days without an ok / known audit, plus anything still 'retrying' (a restart loses the in-memory
 * 90 s timer). GALA_AUDIT_DISABLED=1 stops the sweep and the alerts; the routes stay.
 *
 * Deliberately a separate, dependency-injected module (the shape of gala-paylink.js) so it is
 * hermetically testable (tests/gala-audit.test.js) and server.js keeps a small wiring diff.
 *
 * Deps contract: { query, db, saveDb?, flushDb?, sendEmail, fira?, stripe?, fetchImpl?, log?,
 *                  now?, defer?, retryMs?, alertTo?, adminBase?, epoch? }
 *   db        the live libsql handle (server.js hands a getter, since it assigns db late)
 *   stripe    the Stripe client, or a function returning it (null → charge is 'uncertain' on re-audits)
 *   fira      fira-service (isConfigured, fetchOrder)
 *   defer     (fn, ms) → schedules the retry; default setTimeout(...).unref(). Tests inject a queue.
 */
'use strict';

const crypto = require('crypto');

const ALERT_TO_DEFAULT = 'juginovic.alen@gmail.com';
const RETRY_MS = 90 * 1000;
const BOOT_SWEEP_MS = 60 * 1000;
const SWEEP_WINDOW_DAYS = 14;
const SWEEP_HOUR_ZAGREB = 7;
const COMP_STATES = ['vip-comp', 'comp'];
const TICKET_SUBJECT_RE = /ticket|gala evening|payment confirmed/i;
const SEAT_CODE_RE = /paid by bank transfer\s*[—-]\s*code\s+([A-Z0-9-]+)/i;
const TEST_EMAIL_RE = /@example\.(org|com|net)$|@test\.medx\.hr$/i;
// Audits written from this moment on carry the FIRA payload; older rows can only be checked for
// the invoice reference (FIRA exposes no read endpoint).
const AUDITOR_EPOCH = '2026-09-22T16:00:00Z';

// The 15 fiscal invoices that print unit price = order total (fira-unit-price bug, fixed 8bba7cb).
// Seeded as status 'known' so the first sweep never pages the owner about a bug he already knows.
const KNOWN_UNIT_PRICE_INVOICES = [
    'CA-GALA-2026-0006', 'CA-GALA-2026-0007', 'CA-GALA-2026-0009', 'CA-GALA-2026-0010', 'CA-GALA-2026-0015',
    'CA-GALA-2026-0016', 'CA-GALA-2026-0018', 'CA-GALA-2026-0026', 'CA-GALA-2026-0031', 'CA-GALA-2026-0032',
    'CA-GALA-2026-0033', 'GALA26-0041', 'CA-GALA-2026-0045', 'CA-GALA-2026-0046', 'CA-GALA-2026-0047'
];
const KNOWN_NOTE = 'FIRA line prints unit price = order total (0%-VAT retry bug, fixed 2026-09-22 in 8bba7cb); totals and payment are right; correction = storno + reissue in FIRA';

const disabled = () => ['1', 'true', 'yes'].includes(String(process.env.GALA_AUDIT_DISABLED || '').toLowerCase());
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const cents = n => Math.round((Number(n) || 0) * 100);
const eur = n => { const v = Number(n); return Number.isFinite(v) ? '€' + (Math.round(v * 100) % 100 === 0 ? String(Math.round(v)) : v.toFixed(2)) : '—'; };
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const seatsOf = row => 1 + Math.max(0, parseInt(row && row.guest_count, 10) || 0);
const daysBetween = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const parseSqlDate = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
    const s = String(v);
    const t = Date.parse(s.includes('T') || /[zZ]$|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return Number.isFinite(t) ? new Date(t) : null;
};
const fullName = r => `${(r && r.first_name) || ''} ${(r && r.last_name) || ''}`.trim();

// ---------------------------------------------------------------- schema
const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS gala_payment_audits (
        id TEXT PRIMARY KEY,
        gala_registration_id TEXT,
        ca_registration_id TEXT,
        invoice_number TEXT,
        stripe_session_id TEXT,
        amount_paid REAL,
        seats INTEGER,
        checks_json TEXT,
        status TEXT,
        note TEXT,
        fira_json TEXT,
        first_run_at TEXT,
        last_run_at TEXT,
        alerted_at TEXT
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_gala_payment_audits_reg ON gala_payment_audits(gala_registration_id)'
];
function ensureSchema(db) {
    for (const sql of SCHEMA_SQL) { try { db.run(sql); } catch (e) { /* also mirrored in both server.js schema blocks */ } }
    for (const col of ['note TEXT', 'fira_json TEXT']) { try { db.run(`ALTER TABLE gala_payment_audits ADD COLUMN ${col}`); } catch (e) {} }
}

// ---------------------------------------------------------------- pure pieces
/** The Gala price table exactly as effectiveGalaPrice() reads it (event_components → gala_settings). */
function priceTable(query) {
    let s = {};
    try { s = query.get("SELECT price_gala_only, price_gala_early_bird, price_gala_regular, early_bird_deadline FROM gala_settings WHERE id = 'default'") || {}; } catch (e) {}
    let comp = null;
    try { comp = query.get("SELECT price FROM event_components WHERE event_type='plexus' AND component_key='gala' AND is_active=1"); } catch (e) {}
    const eb = (comp && comp.price != null) ? Number(comp.price) : Number(s.price_gala_early_bird);
    const reg = Number.isFinite(Number(s.price_gala_regular)) ? Number(s.price_gala_regular) : eb;
    const deadline = s.early_bird_deadline || '2026-09-15';
    if (!Number.isFinite(eb)) { const p = Number(s.price_gala_only) || 150; return { early: p, regular: p, deadline }; }
    return { early: round2(eb), regular: round2(reg), deadline };
}

/** Seat prices that are legitimate on `dayIso` (YYYY-MM-DD). */
function acceptableSeatPrices(table, dayIso, forumMember) {
    const set = new Set();
    set.add(dayIso <= table.deadline ? table.early : table.regular);
    if (forumMember) set.add(table.early);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(table.deadline)) && Math.abs(daysBetween(dayIso, table.deadline)) <= 1) { set.add(table.early); set.add(table.regular); }
    return [...set];
}

/** Forum membership by email — the redesign's forumGalaPriceApplies(), tolerant of a DB without the table. */
function forumMemberByEmail(query, email) {
    const e = norm(email);
    if (!e) return false;
    let row = null;
    try {
        row = query.get(`SELECT fm.membership_status, fm.banned, fm.valid_until
                         FROM forum_members fm LEFT JOIN users u ON u.id = fm.user_id
                         WHERE LOWER(COALESCE(fm.email, '')) = ? OR LOWER(COALESCE(u.email, '')) = ?
                         ORDER BY CASE WHEN LOWER(COALESCE(fm.membership_status, '')) IN ('approved', 'active') THEN 0 ELSE 1 END
                         LIMIT 1`, [e, e]);
    } catch (err) { return false; }
    if (!row || !['approved', 'active'].includes(norm(row.membership_status)) || Number(row.banned)) return false;
    if (row.valid_until && String(row.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10)) return false;
    return true;
}

/** Arithmetic of a FIRA order payload (what the invoice prints). Pure. */
function firaOrderArithmetic(order) {
    const lines = Array.isArray(order && order.lineItems) ? order.lineItems : [];
    const out = lines.map(l => {
        const price = round2(l.price), qty = Math.max(0, Number(l.quantity) || 0);
        return { name: l.name, price, quantity: qty, total: round2(price * qty) };
    });
    const sum = round2(out.reduce((a, l) => a + l.total, 0));
    return { lines: out, sum, brutto: round2(order && order.brutto) };
}

/** Milliseconds until the next `hour`:00 in Europe/Zagreb (DST-aware through Intl). */
function msUntilZagrebHour(hour, now = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zagreb', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const parts = d => { const o = {}; for (const p of fmt.formatToParts(d)) o[p.type] = p.value; return o; };
    const p = parts(now);
    // Zagreb's UTC offset right now, from the wall clock it reports for `now`.
    const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const offset = wallAsUtc - now.getTime();
    let target = Date.UTC(+p.year, +p.month - 1, +p.day, hour, 0, 0) - offset;
    if (target <= now.getTime()) target += 24 * 3600 * 1000;
    // Re-derive the offset at the target (a DST change between now and then shifts it by an hour).
    const q = parts(new Date(target));
    const wallAtTarget = Date.UTC(+q.year, +q.month - 1, +q.day, +q.hour, +q.minute, +q.second);
    target += (Date.UTC(+q.year, +q.month - 1, +q.day, hour, 0, 0) - wallAtTarget);
    return Math.max(1000, target - now.getTime());
}

// ---------------------------------------------------------------- the alert email
function buildAlertEmail({ name, email, amount, seats, invoice, galaRegId, caRegId, failing, uncertain, paymentState, adminBase, firaRef }) {
    const base = String(adminBase || process.env.ADMIN_PORTAL_URL || 'https://medx-admin-portal.onrender.com').replace(/\/+$/, '');
    const link = `${base}/#gala`;
    const inv = invoice || 'no invoice';
    const subject = `⚠ Gala payment audit failed — ${name || email || 'unknown'} · ${inv}`;
    const line = c => `${c.check}: expected ${c.expected == null ? '—' : c.expected} · actual ${c.actual == null ? '—' : c.actual}${c.note ? ` (${c.note})` : ''}`;
    const text = [
        `Gala payment audit FAILED (checked twice, 90 s apart).`,
        ``,
        `Person: ${name || '—'} <${email || '—'}>`,
        `Amount: ${eur(amount)} · ${seats || 1} seat${seats === 1 ? '' : 's'}`,
        `Invoice: ${inv}${firaRef ? ` · FIRA ${firaRef}` : ''}`,
        `Registration: ${galaRegId || '—'}${caRegId ? ` · Zagreb form ${caRegId}` : ''}`,
        ``,
        `Failing checks:`,
        ...(failing || []).map(c => `  - ${line(c)}`),
        ...(uncertain && uncertain.length ? [``, `Could not be decided:`, ...uncertain.map(c => `  - ${line(c)}`)] : []),
        ``,
        `payment itself: ${paymentState}`,
        ``,
        `Admin Gala card: ${link} (search ${inv !== 'no invoice' ? inv : (email || name)})`,
        `Re-audit: POST /api/admin/gala/audits/${galaRegId}/rerun on the member backend.`
    ].join('\n');
    const row = (k, v) => `<tr><td style="padding:6px 10px 6px 0;color:#6b6257;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-size:13px;color:#191512;">${v}</td></tr>`;
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f7f1e6;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2d9c4;border-radius:12px;padding:28px 30px;">
  <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9b1b22;font-weight:700;">Gala payment audit · failed</div>
  <h1 style="font-size:20px;margin:10px 0 6px;color:#191512;">${esc(name || email || 'Unknown registrant')} &middot; ${esc(inv)}</h1>
  <p style="margin:0 0 16px;font-size:13.5px;color:#4a4239;">Checked twice, 90&nbsp;s apart, from fresh rows &mdash; the discrepancy is still there.</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    ${row('Person', `${esc(name || '—')} &lt;${esc(email || '—')}&gt;`)}
    ${row('Amount', `${esc(eur(amount))} &middot; ${seats || 1} seat${seats === 1 ? '' : 's'}`)}
    ${row('Invoice', `${esc(inv)}${firaRef ? ` &middot; FIRA ${esc(firaRef)}` : ''}`)}
    ${row('Registration', `<code>${esc(galaRegId || '—')}</code>${caRegId ? ` &middot; Zagreb form <code>${esc(caRegId)}</code>` : ''}`)}
  </table>
  <h2 style="font-size:14px;margin:18px 0 6px;color:#191512;">Failing checks</h2>
  <ul style="margin:0;padding-left:18px;font-size:13.5px;color:#191512;line-height:1.55;">
    ${(failing || []).map(c => `<li><b>${esc(c.check)}</b>: expected <b>${esc(c.expected == null ? '—' : c.expected)}</b> &middot; actual <b style="color:#9b1b22;">${esc(c.actual == null ? '—' : c.actual)}</b>${c.note ? ` <span style="color:#6b6257;">(${esc(c.note)})</span>` : ''}</li>`).join('')}
  </ul>
  ${uncertain && uncertain.length ? `<h2 style="font-size:14px;margin:18px 0 6px;color:#191512;">Could not be decided</h2><ul style="margin:0;padding-left:18px;font-size:13px;color:#6b6257;line-height:1.55;">${uncertain.map(c => `<li>${esc(line(c))}</li>`).join('')}</ul>` : ''}
  <p style="margin:18px 0 0;font-size:14px;color:#191512;"><b>payment itself: ${esc(paymentState)}</b></p>
  <p style="margin:16px 0 0;font-size:13.5px;"><a href="${esc(link)}" style="color:#9b1b22;font-weight:600;">Open the admin Gala card</a> <span style="color:#6b6257;">(search ${esc(inv !== 'no invoice' ? inv : (email || name || ''))})</span></p>
  <p style="margin:14px 0 0;font-size:11.5px;color:#8a8175;">Re-audit by id: POST /api/admin/gala/audits/${esc(galaRegId || '')}/rerun on the member backend. Nothing was sent to the guest.</p>
</div></body></html>`;
    return { subject, html, text };
}

// ---------------------------------------------------------------- the auditor
function create(deps) {
    const { query, sendEmail } = deps;
    const db = () => deps.db;
    const log = deps.log || ((...a) => console.log('[GalaAudit]', ...a));
    const now = deps.now || (() => new Date());
    const defer = deps.defer || ((fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; });
    const retryMs = deps.retryMs != null ? deps.retryMs : RETRY_MS;
    const alertTo = deps.alertTo || process.env.GALA_AUDIT_ALERT_TO || ALERT_TO_DEFAULT;
    const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    const fira = deps.fira || null;
    const epoch = deps.epoch || AUDITOR_EPOCH;
    const stripeClient = () => { try { return typeof deps.stripe === 'function' ? deps.stripe() : (deps.stripe || null); } catch (e) { return null; } };
    const persist = () => { try { deps.saveDb && deps.saveDb(); } catch (e) {} };

    // Once per process: the table (also in both server.js mirror blocks) and the 15 'known' rows —
    // seeded on FIRST USE, so no path (webhook, manual rerun, sweep) can alert on them first.
    let ready = false;
    function schemaReady() {
        if (ready) return;
        ready = true;
        try { ensureSchema(db()); } catch (e) {}
        try { seedKnown(); } catch (e) { log('known-seed failed:', e.message); }
    }

    // ------------------------------------------------------------ rows
    const getAudit = galaRegId => { try { return query.get('SELECT * FROM gala_payment_audits WHERE gala_registration_id = ?', [galaRegId]) || null; } catch (e) { return null; } };
    function upsertAudit(galaRegId, fields) {
        schemaReady();
        const prev = getAudit(galaRegId);
        const t = now().toISOString();
        const checksJson = fields.checks ? JSON.stringify(fields.checks) : (prev ? prev.checks_json : null);
        const firaJson = fields.fira_json !== undefined ? fields.fira_json : (prev ? prev.fira_json : null);
        const note = fields.note !== undefined ? fields.note : (prev ? prev.note : null);
        const alertedAt = fields.alerted_at !== undefined ? fields.alerted_at : (prev ? prev.alerted_at : null);
        if (prev) {
            db().run(`UPDATE gala_payment_audits SET ca_registration_id = ?, invoice_number = ?, stripe_session_id = ?, amount_paid = ?, seats = ?,
                      checks_json = ?, status = ?, note = ?, fira_json = ?, last_run_at = ?, alerted_at = ? WHERE gala_registration_id = ?`,
                [fields.ca_registration_id || prev.ca_registration_id || null, fields.invoice_number || prev.invoice_number || null,
                 fields.stripe_session_id || prev.stripe_session_id || null, fields.amount_paid != null ? fields.amount_paid : prev.amount_paid,
                 fields.seats != null ? fields.seats : prev.seats, checksJson, fields.status || prev.status, note, firaJson, t, alertedAt, galaRegId]);
        } else {
            db().run(`INSERT INTO gala_payment_audits (id, gala_registration_id, ca_registration_id, invoice_number, stripe_session_id, amount_paid, seats,
                      checks_json, status, note, fira_json, first_run_at, last_run_at, alerted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [crypto.randomUUID(), galaRegId, fields.ca_registration_id || null, fields.invoice_number || null, fields.stripe_session_id || null,
                 fields.amount_paid != null ? fields.amount_paid : null, fields.seats != null ? fields.seats : null, checksJson, fields.status || 'retrying',
                 note, firaJson, t, t, alertedAt]);
        }
        persist();
        return getAudit(galaRegId);
    }

    /** Seed status 'known' for the 15 pre-fix multi-seat invoices (once; never overwrites an existing audit). */
    function seedKnown() {
        let seeded = 0;
        for (const inv of KNOWN_UNIT_PRICE_INVOICES) {
            let rows = [];
            try { rows = query.all('SELECT id, amount_paid, guest_count, stripe_session_id FROM gala_registrations WHERE invoice_number = ?', [inv]) || []; } catch (e) { rows = []; }
            for (const g of rows) {
                if (getAudit(g.id)) continue;
                const ca = caFor(g.id);
                upsertAudit(g.id, { status: 'known', note: KNOWN_NOTE, invoice_number: inv, ca_registration_id: ca ? ca.id : null,
                    stripe_session_id: g.stripe_session_id || null, amount_paid: g.amount_paid, seats: seatsOf(g), checks: [] });
                seeded++;
            }
        }
        if (seeded) log(`seeded ${seeded} 'known' audit row(s) for the pre-fix multi-seat invoices`);
        return seeded;
    }

    const caFor = galaRegId => { try { return query.get('SELECT * FROM croatians_abroad_registrations WHERE gala_registration_id = ?', [galaRegId]) || null; } catch (e) { return null; } };
    const caById = id => { try { return id ? (query.get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [id]) || null) : null; } catch (e) { return null; } };

    // ------------------------------------------------------------ evidence fetchers (network, all optional)
    async function fetchStripeSession(sessionId) {
        if (!sessionId) return { session: null, reason: 'no Stripe session id on the row' };
        const s = stripeClient();
        if (!s || !s.checkout || !s.checkout.sessions) return { session: null, reason: 'Stripe client not available' };
        try { return { session: await s.checkout.sessions.retrieve(sessionId), reason: null }; }
        catch (e) { return { session: null, reason: `Stripe: ${e.message}` }; }
    }
    async function brevoTicketLookup(email, sinceDate) {
        const key = process.env.BREVO_API_KEY;
        if (!key || !fetchImpl) return { skipped: key ? 'no fetch' : 'no BREVO_API_KEY' };
        const end = now();
        const oldest = new Date(end.getTime() - 29 * 86400000);
        const from = sinceDate && sinceDate > oldest ? sinceDate : oldest;
        const url = `https://api.brevo.com/v3/smtp/emails?email=${encodeURIComponent(email)}&startDate=${from.toISOString().slice(0, 10)}&endDate=${end.toISOString().slice(0, 10)}&limit=100&sort=desc`;
        try {
            const r = await fetchImpl(url, { headers: { 'api-key': key, Accept: 'application/json' } });
            if (!r.ok) return { error: `Brevo ${r.status}` };
            const j = await r.json().catch(() => ({}));
            const hits = (j.transactionalEmails || []).filter(m => TICKET_SUBJECT_RE.test(String(m.subject || '')));
            return { found: hits.length, subjects: hits.map(h => h.subject).slice(0, 3) };
        } catch (e) { return { error: `Brevo: ${e.message}` }; }
    }

    // ------------------------------------------------------------ the checks
    /**
     * @param {object} p  { galaRegId, caRegId?, stripeSession?, firaResult?, firaError?, ticketSend?, invoiceNumber?, amount? }
     *                    stripeSession / firaResult / ticketSend are the webhook's own evidence; a re-audit
     *                    fetches the session from Stripe, reads the FIRA payload back from the audit row
     *                    and asks Brevo's log.
     */
    async function runChecks(p) {
        const checks = [];
        const push = (check, ok, expected, actual, note) => { checks.push({ check, ok, expected: expected == null ? null : String(expected), actual: actual == null ? null : String(actual), note: note || undefined }); };

        const gala = p.galaRegId ? (query.get('SELECT * FROM gala_registrations WHERE id = ?', [p.galaRegId]) || null) : null;
        if (!gala) return { checks: [{ check: 'row', ok: false, expected: 'a gala_registrations row', actual: 'none', note: `id ${p.galaRegId}` }], gala: null, ca: null };
        const ca = caById(p.caRegId) || caFor(gala.id);
        const prev = getAudit(gala.id);
        const name = fullName(gala);
        const email = String(gala.email || (ca && ca.email) || '').trim();
        const amountPaid = round2(gala.amount_paid);
        const seats = seatsOf(gala);
        const invoice = gala.invoice_number || (ca && ca.invoice_number) || p.invoiceNumber || null;
        const sessionId = gala.stripe_session_id || (ca && ca.stripe_session_id) || (p.stripeSession && p.stripeSession.id) || null;
        const pay = norm(gala.payment_status);
        const comp = COMP_STATES.includes(pay);
        const seatCode = SEAT_CODE_RE.exec(String(gala.requests || '')) || SEAT_CODE_RE.exec(String((ca && ca.notes) || ''));
        const bankSettled = !!seatCode && !sessionId;
        const createdAt = parseSqlDate(gala.created_at);
        const afterEpoch = !!createdAt && createdAt.toISOString() >= epoch;

        // ---- Stripe session: the webhook's copy, else fetched (re-audit)
        let session = p.stripeSession || null, sessionReason = null;
        if (!session && !bankSettled && !comp) { const r = await fetchStripeSession(sessionId); session = r.session; sessionReason = r.reason; }
        const metadata = (session && session.metadata) || {};
        const discount = round2(metadata.discount_amount);

        // ---- payment date (drives the price)
        let payDate = null, payDateSource = null;
        if (session && session.created) { payDate = parseSqlDate(Number(session.created)); payDateSource = 'stripe'; }
        if (!payDate) { try { const f = query.get("SELECT date FROM finance_transactions WHERE transaction_type = 'income' AND reference = ? ORDER BY date LIMIT 1", [invoice || '']); if (f && f.date) { payDate = parseSqlDate(f.date); payDateSource = 'ledger'; } } catch (e) {} }
        if (!payDate && prev && prev.first_run_at) { payDate = parseSqlDate(prev.first_run_at); payDateSource = 'audit'; }
        if (!payDate) { payDate = createdAt || now(); payDateSource = createdAt ? 'registration' : 'now'; }
        const payDay = payDate.toISOString().slice(0, 10);

        // ---- 1. charge
        if (comp) push('charge', true, '€0 (complimentary)', eur(amountPaid), 'skipped: comp');
        else if (bankSettled) push('charge', true, `${eur(amountPaid)} by bank transfer`, `seat code ${seatCode[1]}`, 'skipped: settled outside Stripe by a seat code');
        else if (session) {
            const paidState = session.payment_status ? String(session.payment_status) : 'paid';
            const okAmt = Number(session.amount_total) === cents(amountPaid);
            const okState = paidState === 'paid' || paidState === 'no_payment_required';
            push('charge', okAmt && okState, `${cents(amountPaid)} cents, paid`, `${session.amount_total} cents, ${paidState}`, okAmt ? undefined : 'Stripe amount_total ≠ amount_paid on the row');
        } else push('charge', null, `${cents(amountPaid)} cents`, 'unknown', sessionReason || 'no Stripe session');

        // ---- 2. price
        const table = priceTable(query);
        const forum = forumMemberByEmail(query, email);
        const prices = acceptableSeatPrices(table, payDay, forum);
        let pricingSeats = null;   // seats the paid amount corresponds to (for the seats check)
        if (comp) push('price', true, '€0', eur(amountPaid), 'skipped: comp');
        else if (bankSettled) {
            const k = prices.map(pr => amountPaid / pr).find(k => Number.isInteger(round2(k)) && k >= 1 && k <= seats);
            pricingSeats = k ? Math.round(k) : null;
            push('price', !!k, `k × ${prices.map(eur).join(' or ')} for 1 ≤ k ≤ ${seats} (seat code ${seatCode[1]})`, eur(amountPaid), k ? `${Math.round(k)} seat(s) covered by the pool` : 'amount is not a whole number of seats');
        } else {
            const match = prices.find(pr => cents(seats * pr - discount) === cents(amountPaid));
            const expectedStr = prices.map(pr => `${seats} × ${eur(pr)}${discount ? ` − ${eur(discount)}` : ''} = ${eur(seats * pr - discount)}`).join(' or ');
            const basis = `${payDateSource === 'stripe' ? 'paid' : 'dated'} ${payDay}${forum ? ', Forum member' : ''}${discount ? `, coupon ${metadata.coupon_code || ''} −${eur(discount)}` : ''}`;
            push('price', !!match, expectedStr, eur(amountPaid), match ? basis : `${basis}; early-bird until ${table.deadline}: ${eur(table.early)}, then ${eur(table.regular)}`);
            if (match) pricingSeats = seats;
            else { const k = prices.map(pr => (amountPaid + discount) / pr).find(k => Number.isInteger(round2(k))); if (k) pricingSeats = Math.round(k); }
        }

        // ---- FIRA evidence: the webhook's result, else the stored payload
        let firaOrder = null, firaResp = null, firaSource = null;
        if (p.firaResult && (p.firaResult.order || p.firaResult.rawResponse)) { firaOrder = p.firaResult.order || null; firaResp = p.firaResult.rawResponse || null; firaSource = 'webhook'; }
        else if (prev && prev.fira_json) { try { const j = JSON.parse(prev.fira_json); firaOrder = j.order || null; firaResp = j.response || null; firaSource = 'stored'; } catch (e) {} }
        if (!firaOrder && !firaResp && fira && typeof fira.fetchOrder === 'function' && (invoice || (firaResp && firaResp.id))) {
            try { const fetched = await fira.fetchOrder(invoice); if (fetched) { firaResp = fetched; firaOrder = fetched.lineItems ? fetched : null; firaSource = 'api'; } } catch (e) {}
        }

        // ---- 3. seats
        {
            const problems = [];
            if (ca && seatsOf(ca) !== seats) problems.push(`Zagreb row says ${seatsOf(ca)}`);
            if (ca) {
                let named = [];
                try { named = query.all('SELECT conference, bridges, gala FROM ca_registration_guests WHERE registration_id = ?', [ca.id]) || []; } catch (e) { named = []; }
                const on = v => v === 1 || v === true || v === '1';
                const galaGuests = named.filter(g => on(g.gala) || (!on(g.conference) && !on(g.bridges) && !on(g.gala))).length;
                if (galaGuests > seats - 1) problems.push(`${galaGuests} named Gala guest(s) > guest_count ${seats - 1}`);
            }
            const arith = firaOrderArithmetic(firaOrder);
            const firaQty = arith.lines.length ? arith.lines[0].quantity : null;
            if (firaQty != null && firaQty !== seats) problems.push(`FIRA quantity ${firaQty}`);
            if (pricingSeats != null && pricingSeats !== seats) problems.push(`paid for ${pricingSeats}`);
            push('seats', problems.length === 0, `${seats} (1 + ${seats - 1} guest${seats - 1 === 1 ? '' : 's'})`, problems.length ? problems.join('; ') : String(seats));
        }

        // ---- 4. fira
        const firaConfigured = fira && typeof fira.isConfigured === 'function' ? fira.isConfigured() : true;
        let firaRef = null;
        if (comp) push('fira', true, 'no invoice (comp)', invoice || 'none', 'skipped: comp');
        else if (bankSettled) push('fira', true, 'invoice issued by hand in FIRA (bank transfer)', invoice || 'none', 'skipped: settled by a seat code outside Stripe');
        else if (!firaConfigured) push('fira', true, 'FIRA not configured', invoice || 'none', 'skipped: FIRA_API_KEY unset (dev/staging)');
        else if (!invoice) push('fira', sessionId ? false : null, 'an invoice number on the row', 'none', sessionId ? 'paid through Stripe but no invoice number recorded' : 'no Stripe session either — marked paid by hand?');
        else if (p.firaError) push('fira', false, `fiscal invoice ${invoice} created`, 'FIRA call failed', String(p.firaError).slice(0, 200));
        else if (!firaOrder && !firaResp) {
            if (afterEpoch && sessionId) push('fira', false, `fiscal invoice ${invoice} created`, 'no FIRA record', 'no FIRA response stored for a payment made after the auditor went live — was the fiscal invoice created?');
            else push('fira', true, `invoice ${invoice}`, `invoice ${invoice}`, 'lines not verifiable: issued before the auditor stored FIRA payloads, and FIRA has no read API');
        } else {
            const problems = [];
            firaRef = firaResp ? (firaResp.invoiceNumber || firaResp.id || null) : null;
            if (!firaRef) problems.push('FIRA returned no invoice id / number');
            if (firaOrder) {
                const a = firaOrderArithmetic(firaOrder);
                if (cents(a.brutto) !== cents(amountPaid)) problems.push(`brutto ${eur(a.brutto)} ≠ paid ${eur(amountPaid)}`);
                a.lines.forEach((l, i) => { if (cents(l.price * l.quantity) !== cents(l.total)) problems.push(`line ${i + 1} ${l.price} × ${l.quantity} ≠ ${l.total}`); });
                if (cents(a.sum) !== cents(a.brutto)) problems.push(`lines sum ${eur(a.sum)} ≠ brutto ${eur(a.brutto)}`);
                if (a.lines.length && a.lines[0].quantity !== seats) problems.push(`quantity ${a.lines[0].quantity} ≠ ${seats} seats`);
                const buyer = norm(firaOrder.billingAddress && firaOrder.billingAddress.name);
                if (buyer && name && buyer !== norm(name)) problems.push(`buyer "${firaOrder.billingAddress.name}" ≠ registrant "${name}"`);
                if (sessionId && norm(firaOrder.paymentType) !== 'kartica') problems.push(`paymentType ${firaOrder.paymentType || '—'} for a card payment`);
                if (firaOrder.webshopOrderNumber && firaOrder.webshopOrderNumber !== invoice) problems.push(`webshopOrderNumber ${firaOrder.webshopOrderNumber} ≠ ${invoice}`);
                const lineStr = a.lines.map(l => `${l.quantity} × ${eur(l.price)} = ${eur(l.total)}`).join(' + ');
                push('fira', problems.length === 0, `${seats} × ${eur(amountPaid / seats)} = ${eur(amountPaid)} to ${name}, KARTICA, ${invoice}`, problems.length ? problems.join('; ') : `${lineStr} = ${eur(a.brutto)}, ${firaRef}`, firaSource === 'stored' ? 'from the payload stored at creation' : undefined);
            } else push('fira', problems.length === 0, `FIRA id / number for ${invoice}`, firaRef || 'none', problems.join('; ') || undefined);
        }

        // ---- 5. ledger
        if (comp) push('ledger', true, 'no income row (comp)', '—', 'skipped: comp');
        else if (bankSettled) push('ledger', true, 'bank transfer booked by hand', '—', 'skipped: seat-code settlement writes no ledger row');
        else if (!invoice) push('ledger', null, `1 income row for ${eur(amountPaid)}`, 'no invoice number to look up');
        else {
            let rows = [];
            try { rows = query.all("SELECT id, transaction_number, amount FROM finance_transactions WHERE transaction_type = 'income' AND reference = ?", [invoice]) || []; } catch (e) { rows = []; }
            const ok = rows.length === 1 && cents(rows[0].amount) === cents(amountPaid);
            if (rows.length === 0) {
                // The admin boot purge wiped the live ledger on every boot until 2026-09-22 (demo-purge.js
                // '1=1'); the rows survive in _purged_finance_transactions and the admin restores them at
                // its next boot. A row that is only there is 'not yet decidable', never a page.
                let parked = [];
                try { parked = query.all("SELECT transaction_number, amount FROM _purged_finance_transactions WHERE transaction_type = 'income' AND reference = ?", [invoice]) || []; } catch (e) { parked = []; }
                if (parked.length) push('ledger', null, `1 income row · ${eur(amountPaid)} · ref ${invoice}`, `${parked.map(r => `${r.transaction_number} ${eur(r.amount)}`).join(', ')} in _purged_finance_transactions`, 'sits in the purge backup — the admin portal restores it at boot');
                else push('ledger', false, `1 income row · ${eur(amountPaid)} · ref ${invoice}`, 'no income row', 'finance_transactions has no row for this invoice');
            } else push('ledger', ok, `1 income row · ${eur(amountPaid)} · ref ${invoice}`, rows.map(r => `${r.transaction_number} ${eur(r.amount)}`).join(', '), rows.length > 1 ? `${rows.length} rows carry this invoice` : (ok ? undefined : 'amount differs'));
        }

        // ---- 6. duplicates
        {
            let dups = [];
            try { dups = email ? (query.all("SELECT id, invoice_number, amount_paid, created_at FROM gala_registrations WHERE LOWER(email) = LOWER(?) AND id <> ? AND payment_status = 'paid' AND COALESCE(status,'') NOT IN ('cancelled','rejected','declined','merged')", [email, gala.id]) || []) : []; } catch (e) { dups = []; }
            push('duplicates', dups.length === 0, `no other paid row for ${email || '—'}`, dups.length ? dups.map(d => `${d.invoice_number || d.id.slice(0, 8)} ${eur(d.amount_paid)} (${String(d.created_at || '').slice(0, 10)})`).join(', ') : 'none', dups.length ? 'a second paid row — double charge unless it is a different party' : undefined);
        }

        // ---- 7. ticket
        if (p.ticketSend) {
            const s = p.ticketSend;
            if (s.mock) push('ticket', process.env.NODE_ENV === 'production' ? false : true, 'accepted by Brevo', 'mock (no provider)', process.env.NODE_ENV === 'production' ? 'PAID guest got no ticket — no email provider configured' : 'skipped: dev mock');
            else push('ticket', s.success !== false, 'accepted by Brevo', s.success !== false ? 'accepted' : 'rejected', s.success === false ? String(s.error || 'provider rejected').slice(0, 160) : undefined);
        } else if (!email) push('ticket', false, 'a ticket email', 'no email on the row');
        else {
            const r = await brevoTicketLookup(email, createdAt);
            if (r.skipped) push('ticket', true, 'accepted by Brevo', 'not checked', `skipped: ${r.skipped}`);
            else if (r.error) push('ticket', null, `a ticket email to ${email} in the Brevo log`, 'unknown', r.error);
            // A log MISS is weak evidence (sent by hand, another sender, older than the 30-day log):
            // listed as undecided, never paged. The webhook's own send result is the strong check.
            else push('ticket', r.found > 0 ? true : null, `a ticket email to ${email} in the Brevo log`, r.found ? `${r.found} found (${r.subjects.join(' | ')})` : 'none found', r.found ? undefined : 'no ticket-shaped email logged for this address (log keeps 30 days) — check by hand');
        }

        const firaJson = (firaSource === 'webhook' && (firaOrder || firaResp)) ? JSON.stringify({ order: firaOrder, response: firaResp, captured_at: now().toISOString() }) : undefined;
        // "payment itself": did money actually move, whatever else is wrong.
        const paymentState = comp ? 'not applicable (complimentary seat)'
            : bankSettled ? `succeeded (bank transfer, seat code ${seatCode[1]})`
            : (session && ['paid', 'no_payment_required'].includes(String(session.payment_status || 'paid'))) ? `succeeded (Stripe collected ${eur((Number(session.amount_total) || 0) / 100)}, session ${session.id || sessionId || '—'})`
            : session ? `uncertain (Stripe session ${session.id || sessionId} is ${session.payment_status})`
            : `uncertain (${sessionReason || 'no Stripe session to verify'})`;
        return { checks, gala, ca, name, email, amountPaid, seats, invoice, sessionId, firaJson, firaRef, paymentState };
    }

    const verdictOf = checks => checks.some(c => c.ok === false) ? 'failed' : (checks.some(c => c.ok === null) ? 'uncertain' : 'ok');

    // ------------------------------------------------------------ alerting
    async function alert(result, checks) {
        const failing = checks.filter(c => c.ok === false), uncertain = checks.filter(c => c.ok === null);
        const mail = buildAlertEmail({ name: result.name, email: result.email, amount: result.amountPaid, seats: result.seats, invoice: result.invoice,
            galaRegId: result.gala && result.gala.id, caRegId: result.ca && result.ca.id, failing, uncertain, paymentState: result.paymentState, adminBase: deps.adminBase, firaRef: result.firaRef });
        let sent = null;
        try { sent = await sendEmail(alertTo, mail.subject, mail.html); } catch (e) { sent = { success: false, error: e.message }; }
        const ok = sent && sent.success !== false && !sent.mock;
        log(`${ok ? 'ALERT sent' : 'ALERT NOT DELIVERED'} -> ${alertTo}: ${mail.subject}${ok ? '' : ` (${(sent && (sent.error || (sent.mock && 'mock'))) || 'unknown'})`}`);
        return { sent: ok, mail };
    }

    // ------------------------------------------------------------ one pass + the double-check
    /**
     * Audit one Gala payment. First pass now; a failing pass is re-run once after `retryMs` from
     * fresh rows; only a second failure alerts. Resolves with the FIRST pass's stored row.
     * @param {object} p  see runChecks() — plus { reason?: 'webhook'|'sweep'|'manual', noRetry?: boolean }
     */
    async function auditPayment(p) {
        try {
            schemaReady();   // table + the 'known' rows exist before any verdict is reached
            const result = await runChecks(p);
            const galaRegId = result.gala ? result.gala.id : p.galaRegId;
            const prev = getAudit(galaRegId);
            const verdict = verdictOf(result.checks);
            const base = { checks: result.checks, ca_registration_id: result.ca ? result.ca.id : (p.caRegId || null), invoice_number: result.invoice || null,
                stripe_session_id: result.sessionId || null, amount_paid: result.amountPaid, seats: result.seats, fira_json: result.firaJson };
            if (prev && prev.status === 'known') {
                const row = upsertAudit(galaRegId, { ...base, status: 'known' });
                log(`${galaRegId} ${result.invoice || ''}: ${verdict} (kept 'known', no alert)`);
                return { status: 'known', verdict, checks: result.checks, row };
            }
            if (verdict !== 'failed') {
                const row = upsertAudit(galaRegId, { ...base, status: verdict });
                log(`${galaRegId} ${result.invoice || ''}: ${verdict}${verdict === 'uncertain' ? ' — ' + result.checks.filter(c => c.ok === null).map(c => `${c.check}: ${c.note || c.actual}`).join('; ') : ''}`);
                return { status: verdict, checks: result.checks, row };
            }
            const failing = result.checks.filter(c => c.ok === false);
            const isSecondPass = !!p.secondPass;
            if (!isSecondPass && !p.noRetry) {
                const row = upsertAudit(galaRegId, { ...base, status: 'retrying' });
                log(`${galaRegId} ${result.invoice || ''}: FAILED first pass (${failing.map(c => c.check).join(', ')}) — re-checking in ${Math.round(retryMs / 1000)} s`);
                // (returns the promise so an injected test queue can await the second pass; setTimeout ignores it)
                defer(() => auditPayment({ galaRegId, caRegId: p.caRegId, secondPass: true, reason: p.reason }).catch(() => {}), retryMs);
                return { status: 'retrying', checks: result.checks, row };
            }
            // Second (or forced single) pass still failing → failed + one alert, ever.
            const alreadyAlerted = !!(prev && prev.alerted_at);
            let alerted = false;
            if (!alreadyAlerted && !disabled()) { const a = await alert(result, result.checks); alerted = a.sent; }
            const row = upsertAudit(galaRegId, { ...base, status: 'failed', alerted_at: alerted ? now().toISOString() : (prev ? prev.alerted_at : null) });
            log(`${galaRegId} ${result.invoice || ''}: FAILED (${failing.map(c => `${c.check}: expected ${c.expected} / actual ${c.actual}`).join('; ')})${alerted ? ' — owner alerted' : (alreadyAlerted ? ' — already alerted' : (disabled() ? ' — alerts disabled' : ' — alert not delivered'))}`);
            return { status: 'failed', checks: result.checks, row, alerted };
        } catch (e) {
            log(`audit crashed for ${p && p.galaRegId}: ${e.message}`);
            return { status: 'error', error: e.message };
        }
    }

    // ------------------------------------------------------------ sweep
    function sweepCandidates() {
        schemaReady();
        let rows = [];
        try {
            rows = query.all(`SELECT g.id, g.email, g.invoice_number, g.created_at, a.status AS audit_status
                                FROM gala_registrations g
                                LEFT JOIN gala_payment_audits a ON a.gala_registration_id = g.id
                               WHERE g.payment_status = 'paid'
                                 AND COALESCE(g.status, '') NOT IN ('cancelled', 'rejected', 'declined', 'merged')
                                 AND ( (COALESCE(a.status, '') NOT IN ('ok', 'known') AND datetime(g.created_at) >= datetime('now', ?))
                                       OR a.status = 'retrying' )
                               ORDER BY g.created_at ASC`, [`-${SWEEP_WINDOW_DAYS} days`]) || [];
        } catch (e) { log('sweep query failed:', e.message); return []; }
        return rows.filter(r => !TEST_EMAIL_RE.test(String(r.email || '')));
    }
    async function sweep(opts = {}) {
        if (disabled() && !opts.force) { log('sweep skipped (GALA_AUDIT_DISABLED)'); return { skipped: true }; }
        const cands = sweepCandidates();   // schemaReady() inside seeds the 'known' rows first
        const tally = { candidates: cands.length, ok: 0, failed: 0, retrying: 0, uncertain: 0, known: 0, error: 0 };
        for (const c of cands) {
            // A row already 'retrying' is on its second pass: decide now, alert if still wrong. A row
            // already 'failed' takes the same decisive pass (fixed → ok; still wrong → stays failed, no
            // second email) instead of flapping back to 'retrying' for a day. Fresh and 'uncertain'
            // rows get the full first-pass + 90 s double-check.
            const out = await auditPayment({ galaRegId: c.id, reason: 'sweep', secondPass: c.audit_status === 'retrying' || c.audit_status === 'failed' });
            tally[out.status] = (tally[out.status] || 0) + 1;
        }
        log(`sweep done: ${tally.candidates} candidate(s) → ok ${tally.ok}, uncertain ${tally.uncertain}, retrying ${tally.retrying}, failed ${tally.failed}${tally.known ? `, known ${tally.known}` : ''}${tally.error ? `, error ${tally.error}` : ''}`);
        return tally;
    }
    function scheduleSweeps() {
        if (disabled()) { log('disabled by GALA_AUDIT_DISABLED — no sweeps, no alerts (routes stay)'); return null; }
        defer(() => { sweep().catch(e => log('boot sweep failed:', e.message)); }, BOOT_SWEEP_MS);
        const daily = () => {
            const ms = msUntilZagrebHour(SWEEP_HOUR_ZAGREB, now());
            defer(() => { sweep().catch(e => log('daily sweep failed:', e.message)).finally(daily); }, ms);
        };
        daily();
        log(`boot sweep in ${BOOT_SWEEP_MS / 1000} s, then daily at 0${SWEEP_HOUR_ZAGREB}:00 Europe/Zagreb (alerts -> ${alertTo})`);
        return true;
    }

    // ------------------------------------------------------------ routes
    function mountRoutes(app, { auth, adminOnly, JWT_SECRET } = {}) {
        const adminKey = () => crypto.createHmac('sha256', String(JWT_SECRET || '')).update('gala-audit').digest('hex').slice(0, 40);
        const keyOk = k => { const want = adminKey(); const got = String(k || ''); return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want)); };
        // Either a valid admin JWT (auth + adminOnly) or the team key — the same two doors as the other team routes.
        const gate = (req, res, next) => {
            if (req.query && req.query.key && JWT_SECRET) return keyOk(req.query.key) ? next() : res.status(404).json({ error: 'Not found' });
            if (!auth || !adminOnly) return res.status(404).json({ error: 'Not found' });
            return auth(req, res, () => adminOnly(req, res, next));
        };
        app.get('/api/admin/gala/audits', gate, (req, res) => {
            try {
                schemaReady();
                const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
                const where = [], params = [];
                if (req.query.status) { where.push('a.status = ?'); params.push(String(req.query.status)); }
                if (req.query.id) { where.push('(a.gala_registration_id = ? OR a.ca_registration_id = ? OR a.invoice_number = ?)'); params.push(String(req.query.id), String(req.query.id), String(req.query.id)); }
                const rows = query.all(`SELECT a.*, g.first_name, g.last_name, g.email, g.payment_status
                                          FROM gala_payment_audits a LEFT JOIN gala_registrations g ON g.id = a.gala_registration_id
                                          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                                          ORDER BY a.last_run_at DESC LIMIT ?`, [...params, limit]) || [];
                const out = rows.map(r => { let checks = []; try { checks = JSON.parse(r.checks_json || '[]'); } catch (e) {} const { checks_json, fira_json, ...rest } = r; return { ...rest, name: fullName(r), checks, has_fira_payload: !!fira_json }; });
                const counts = {};
                try { for (const c of query.all('SELECT status, COUNT(*) AS n FROM gala_payment_audits GROUP BY status') || []) counts[c.status] = Number(c.n); } catch (e) {}
                res.json({ disabled: disabled(), alert_to: alertTo, counts, audits: out });
            } catch (e) { res.status(500).json({ error: e.message }); }
        });
        // Re-audit one registration now (single decisive pass: a failure alerts unless already alerted).
        app.post('/api/admin/gala/audits/:galaRegId/rerun', gate, async (req, res) => {
            try {
                const out = await auditPayment({ galaRegId: String(req.params.galaRegId || ''), reason: 'manual', secondPass: true });
                res.json({ success: out.status !== 'error', ...out });
            } catch (e) { res.status(500).json({ error: e.message }); }
        });
        // Run the sweep now (the same one boot and 07:00 run).
        app.post('/api/admin/gala/audits/sweep', gate, async (req, res) => {
            try { res.json(await sweep({ force: true })); } catch (e) { res.status(500).json({ error: e.message }); }
        });
        return { adminKey };
    }

    return { auditPayment, runChecks, sweep, sweepCandidates, scheduleSweeps, mountRoutes, seedKnown, getAudit, ensureSchema: () => ensureSchema(db()), disabled };
}

module.exports = {
    create,
    ensureSchema,
    buildAlertEmail,
    priceTable,
    acceptableSeatPrices,
    firaOrderArithmetic,
    msUntilZagrebHour,
    forumMemberByEmail,
    KNOWN_UNIT_PRICE_INVOICES,
    KNOWN_NOTE,
    ALERT_TO_DEFAULT,
    RETRY_MS,
    SWEEP_WINDOW_DAYS,
    AUDITOR_EPOCH,
    SCHEMA_SQL
};
