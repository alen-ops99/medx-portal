/**
 * v2/gala-ops.js — Gala destination additions for the redesigned ADMIN portal
 * (admin-portal/frontend-v2 › js/views/gala.js · artboard: Admin Gala.dc.html).
 *
 * Everything the artboard needs that server.js does not already provide (guest list,
 * seating tables/assign, menu options, mark-paid, nag chase and the guest-message
 * outbox all stay on their existing v1 routes — this module never duplicates them):
 *
 *   GET  /api/v2/gala-ops/overview                       auth+adminOnly  one read for the screen:
 *        { tables, assignments, meals, waitlist, cancellations, meta, room, price, now }
 *   PUT  /api/v2/gala-ops/registrations/:id/meal         auth+adminOnly  { option_id } ('' clears the override)
 *   POST /api/v2/gala-ops/registrations                  auth+adminOnly  ADD GUEST { name, email?, institution?, kind: invoice|vip|sponsor }
 *        invoice → status 'approved' + pay_token + a payment-request email staged into the
 *        approval outbox (scheduled_emails pending_approval — NOTHING sends without the OK;
 *        the fiscal invoice itself comes from FIRA on payment, never from here).
 *        vip / sponsor → status 'confirmed', payment_status 'paid', amount 0.
 *   POST /api/v2/gala-ops/registrations/:id/cancel       auth+adminOnly  non-refundable SOFT cancel:
 *        status → 'cancelled' (payment record untouched, no refund path), seat assignment freed,
 *        previous state kept in v2_gala_cancellations, then the waitlist sweep runs.
 *   POST /api/v2/gala-ops/registrations/:id/restore      auth+adminOnly  the UNDO for cancel.
 *   GET/POST/DELETE /api/v2/gala-ops/waitlist[…]         auth+adminOnly  add / force-offer / remove / sweep
 *   GET  /api/v2/gala-ops/waitlist/accept/:token         PUBLIC          the 24 h offer's accept page (HTML)
 *   GET  /api/v2/gala-ops/categories                     auth+adminOnly  the editable guest-category set
 *   POST /api/v2/gala-ops/categories                     auth+adminOnly  { label, color? } → key is slugged once, then stable
 *   PUT  /api/v2/gala-ops/categories/:id                 auth+adminOnly  { label?, color?, sort?, archived? } rename/recolor/archive
 *   PUT  /api/v2/gala-ops/registrations/:id/category    auth+adminOnly  { key } re-tags ONE guest (writes gala_registrations.pricing)
 *   GET/PUT /api/v2/gala-ops/meta                        auth+adminOnly  performers TBA flip — SAME
 *        v2_gala_meta table the member side defines (user-portal/backend/v2/gala.js); the DDL below
 *        is copied VERBATIM from there and the value shape ({announced, list}, key 'performers')
 *        is kept identical so GET /api/v2/gala/meta on the member portal reflects the flip.
 *   GET  /api/v2/gala-ops/invites                        auth+adminOnly  the INVITATIONS card read:
 *        every v2_gala_invites row with its live state (invited / opened / registered — registered
 *        is DERIVED by email join against gala_registrations, never stored) + the summary counts.
 *   POST /api/v2/gala-ops/invites/queue                  auth+adminOnly  { people:[{email,name?}], lang:'en'|'hr' }
 *        upserts v2_gala_invites and stages ONE branded invitation email per person into the
 *        approval outbox (scheduled_emails 'pending_approval', batch gala-invite-…) — the EMAIL &
 *        OUTBOX tab's APPROVE & SEND is the only path to sending; sendEmail() is NEVER called here.
 *        People whose email already has a live gala registration are skipped (reported back).
 *   GET  /api/v2/gala-ops/invites/open/:token            PUBLIC          the invite email's CTA:
 *        stamps opened_at once, then 302s to the member portal's Gala page — open tracking only,
 *        never a dead end (an unknown token still redirects).
 *   GET/POST /api/v2/gala-ops/menu-options               auth+adminOnly  the MENU card: full list
 *        (archived included) / add with the v2-only fields (description, bucket).
 *   PUT  /api/v2/gala-ops/menu-options/:id               auth+adminOnly  edit label/description/
 *        bucket/keywords/sort_order + archive/restore via { active } (≥1 must stay active).
 *
 * INVITATIONS (build 2026-08-31 — the port of the old portal's invite machinery, reshaped):
 *   the legacy tables could not carry this feature — gala_picker_invites is the Firestore
 *   table-picker LEDGER (rows exist only for already-paid guests; token = the Firestore doc id;
 *   the picker-sync engine's known-emails / revoke logic reads it, so foreign writes would corrupt
 *   the sync), and gala_invite_links are anonymous multi-use registration URLs with no per-person
 *   email, so an invited/opened/registered join is impossible there. v2_gala_invites is the
 *   per-person shape both lacked: email (unique), name, lang, its own open-tracking token,
 *   invited_at / opened_at, queued_count. 'registered' is always computed live from
 *   gala_registrations (INACTIVE statuses excluded) — the registrations table stays the truth.
 *
 * MENU OPTIONS (build 2026-08-31): SAME gala_menu_options table server.js owns — the v1 routes
 *   (/api/admin/gala/menu-options…) keep working untouched (the old portal's Meals tab, this
 *   view's meal dropdowns and the keyword bucketing all read them). v2 adds what v1 cannot say:
 *   guarded ADD COLUMN description / bucket, a full list that includes archived rows, and
 *   archive/restore via `active` (v1 only hard-deletes). Members never read this table — the
 *   member form stores free-text `dietary` on gala_registrations and the keywords map that text
 *   to an option — so additive writes here cannot break the member-facing flow.
 *
 * WAITLIST DESIGN (README note 10: opens when seats sell out; a freed seat is offered to the
 * first in line with 24 h to accept, then passes on):
 *   v2_gala_waitlist rows: waiting → offered → accepted | expired (removed = admin took it out).
 *   Room capacity = SUM(gala_tables.capacity) (the 10×8 board = 80) — never gala_settings.capacity
 *   and never any 150-seat figure. Reserved seats = 1+guest_count over every non-cancelled,
 *   non-rejected registration PLUS one held seat per live offer (so two offers can never chase
 *   one seat). sweep(): expire overdue offers, then while seats are free offer to the oldest
 *   'waiting' row that has an email — sendEmail() with the public accept link (EMAIL_DUMP_DIR
 *   captures it on staging). A 5-minute interval runs it; cancel/restore/accept run it inline;
 *   POST /waitlist/sweep runs it on demand (QA simulates the 24 h by rewinding offer_expires_at).
 *   Accepting creates a gala_registrations row (status 'approved', payment pending, pay_token)
 *   so the guest lands in the guest list to chase and can pay via the member /pay/gala rail.
 *
 * GUEST CATEGORIES (build 2026-08-31): the ADD-GUEST picker's fixed INVOICE / VIP — FREE /
 * SPONSOR SEAT trio becomes data. v2_gala_categories(id, key, label, color, sort, archived) is
 * seeded with exactly those three ONLY when the table is empty; the seeded keys ('invoice',
 * 'vip', 'sponsor') are the very values gala_registrations.pricing already stores, and every
 * write path keeps using that column — so v1 screens, the seating export and old chips read on
 * unchanged. Renames touch the label, never the key; archive hides a category from pickers while
 * guests already tagged with it keep resolving. Behaviour stays keyed on 'invoice' alone: that
 * category takes the payment-request path, every other category counts as paid (like VIP/sponsor
 * always did). Legacy pricing values outside the set ('bundle', 'waitlist', …) still render — the
 * view falls back to its plain PAID chip for them.
 */
'use strict';
const crypto = require('crypto');

module.exports = function mountGalaOps(app, ctx) {
    const { db, auth, adminOnly, sendEmail, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/gala-ops]', ...a));

    const META_KEY = 'performers';
    const MAX_PERFORMERS = 6;
    const DEFAULT_DEADLINE = '2026-09-01';
    const DEFAULT_TABLES = 10, DEFAULT_SEATS = 8;              // the artboard's 10 × 8 room
    const OFFER_HOURS = 24;
    const INACTIVE = ['cancelled', 'rejected', 'declined', 'expired'];

    // ---------------------------------------------------------------- schema (try/catch DDL)
    try {
        // VERBATIM from user-portal/backend/v2/gala.js — both portals share ONE database.
        db().run(`CREATE TABLE IF NOT EXISTS v2_gala_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT,
            updated_by TEXT
        )`);
    } catch (e) { log('v2_gala_meta schema failed:', e.message); }
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_gala_meals (
            registration_id TEXT PRIMARY KEY,
            option_id TEXT NOT NULL,
            updated_at TEXT,
            updated_by TEXT
        )`);
    } catch (e) { log('v2_gala_meals schema failed:', e.message); }
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_gala_waitlist (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT,
            institution TEXT,
            note TEXT,
            status TEXT NOT NULL DEFAULT 'waiting',
            offer_token TEXT,
            offered_at TEXT,
            offer_expires_at TEXT,
            accepted_at TEXT,
            registration_id TEXT,
            source TEXT,
            added_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
    } catch (e) { log('v2_gala_waitlist schema failed:', e.message); }
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_gala_cancellations (
            registration_id TEXT PRIMARY KEY,
            prev_status TEXT,
            prev_payment_status TEXT,
            cancelled_by TEXT,
            cancelled_at TEXT,
            restored_at TEXT
        )`);
    } catch (e) { log('v2_gala_cancellations schema failed:', e.message); }
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_gala_categories (
            id TEXT PRIMARY KEY,
            key TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            color TEXT,
            sort INTEGER DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
        // Seed the picker's historical three ONLY on an empty table. The keys are exactly what
        // gala_registrations.pricing already stores — nothing existing re-labels or breaks.
        const seeded = getRow('SELECT COUNT(*) AS c FROM v2_gala_categories');
        if (!seeded || !Number(seeded.c)) {
            for (const [key, label, color, sort] of [
                ['invoice', 'Invoice', '#9b1b22', 10],
                ['vip', 'VIP — free', '#7a6432', 20],
                ['sponsor', 'Sponsor seat', '#1e6e42', 30]
            ]) {
                db().run('INSERT INTO v2_gala_categories (id, key, label, color, sort, archived) VALUES (?,?,?,?,?,0)',
                    [crypto.randomUUID(), key, label, color, sort]);
            }
            persist();
        }
    } catch (e) { log('v2_gala_categories schema failed:', e.message); }
    try {
        // Per-person Gala invitations (see the header for why neither legacy table could be reused).
        // email is UNIQUE: one invite identity per person; re-queues bump invited_at/queued_count
        // and keep the token, so an old link in an old email still tracks its open.
        db().run(`CREATE TABLE IF NOT EXISTS v2_gala_invites (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT,
            lang TEXT NOT NULL DEFAULT 'en',
            token TEXT NOT NULL UNIQUE,
            batch_id TEXT,
            invited_at TEXT,
            opened_at TEXT,
            queued_count INTEGER NOT NULL DEFAULT 0,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
    } catch (e) { log('v2_gala_invites schema failed:', e.message); }
    // Additive columns on the SHARED gala_menu_options table (v1 SELECT * simply carries them;
    // nothing existing is renamed or dropped, so every v1 reader keeps working unchanged).
    try { db().run('ALTER TABLE gala_menu_options ADD COLUMN description TEXT'); } catch (e) { /* exists */ }
    try { db().run('ALTER TABLE gala_menu_options ADD COLUMN bucket TEXT'); } catch (e) { /* exists */ }

    // ---------------------------------------------------------------- tiny query helpers
    function getRow(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        finally { if (st) st.free(); }
    }
    function getAll(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
        finally { if (st) st.free(); }
    }
    function persist() { try { saveDb(); } catch (e) {} try { db().sync(); } catch (e) {} }
    function audit(req, action, detail) {
        try {
            db().run(`INSERT INTO audit_log (id, actor_id, actor_email, action, detail, created_at) VALUES (?,?,?,?,?,datetime('now'))`,
                [crypto.randomUUID(), (req && req.user && req.user.id) || null, (req && req.user && req.user.email) || 'system', action, String(detail || '').slice(0, 500)]);
        } catch (e) { /* audit is best-effort */ }
    }
    const nowIso = () => new Date().toISOString();
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const cleanStr = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
    const slugKey = (label) => cleanStr(label, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const okColor = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : null);
    function readCategories() {
        try { return getAll('SELECT id, key, label, color, sort, archived FROM v2_gala_categories ORDER BY sort, label'); }
        catch (e) { return []; }
    }
    function liveCategories() { return readCategories().filter(c => !Number(c.archived)); }

    // Same env fallbacks server.js uses for its own absolute links / the member portal.
    function adminBase() {
        return (process.env.RENDER_EXTERNAL_URL || process.env.ADMIN_PORTAL_URL || ('http://localhost:' + (process.env.PORT || 3002))).replace(/\/+$/, '');
    }
    function memberBase() {
        if (process.env.USER_PORTAL_URL) return String(process.env.USER_PORTAL_URL).replace(/\/+$/, '');
        if (process.env.NODE_ENV === 'production' || process.env.RENDER) return 'https://medx-user-portal.onrender.com';
        return 'http://localhost:3010';
    }

    // Same arithmetic as effectiveGalaPrice() in server.js / the member v2 priceBlock — kept in step.
    function priceBlock() {
        let s = {};
        try { s = getRow("SELECT price_gala_only, price_gala_early_bird, price_gala_regular, early_bird_deadline FROM gala_settings WHERE id = 'default'") || {}; } catch (e) {}
        let comp = null;
        try { comp = getRow("SELECT price FROM event_components WHERE event_type = 'plexus' AND component_key = 'gala' AND is_active = 1"); } catch (e) {}
        const compPrice = comp && comp.price != null ? Number(comp.price) : NaN;
        const eb = Number.isFinite(compPrice) ? compPrice : Number(s.price_gala_early_bird);
        const early = Number.isFinite(eb) ? eb : (Number(s.price_gala_only) || 150);
        const regular = Number.isFinite(Number(s.price_gala_regular)) ? Number(s.price_gala_regular) : early;
        const flip = s.early_bird_deadline || DEFAULT_DEADLINE;
        const today = new Date().toISOString().slice(0, 10);
        const isEarly = today <= flip;
        return { current: isEarly ? early : regular, next: isEarly ? regular : null, early, regular, flip_date: flip, phase: isEarly ? 'early_bird' : 'regular', currency: 'EUR' };
    }

    // ---------------------------------------------------------------- room + seats
    function seatsOf(r) { return 1 + (Number(r.guest_count) || 0); }
    function activeRegs() {
        try {
            return getAll('SELECT id, status, payment_status, guest_count FROM gala_registrations')
                .filter(r => !INACTIVE.includes(String(r.status || '').toLowerCase()));
        } catch (e) { return []; }
    }
    function roomState() {
        let tables = [];
        try { tables = getAll('SELECT id, label, capacity, notes FROM gala_tables ORDER BY label'); } catch (e) {}
        const tableCount = tables.length || DEFAULT_TABLES;
        const capacity = tables.length ? tables.reduce((n, t) => n + (Number(t.capacity) || DEFAULT_SEATS), 0) : DEFAULT_TABLES * DEFAULT_SEATS;
        const regs = activeRegs();
        const regSeats = regs.reduce((n, r) => n + seatsOf(r), 0);
        const paidSeats = regs.filter(r => r.payment_status === 'paid').reduce((n, r) => n + seatsOf(r), 0);
        let offeredHolds = 0;
        try { offeredHolds = getRow("SELECT COUNT(*) AS c FROM v2_gala_waitlist WHERE status = 'offered'")?.c || 0; } catch (e) {}
        const reserved = regSeats + offeredHolds;
        return {
            tables, table_count: tableCount,
            seats_per_table: tables.length ? Math.max(1, Math.round(capacity / tableCount)) : DEFAULT_SEATS,
            capacity, reserved_seats: reserved, reg_seats: regSeats, paid_seats: paidSeats,
            offered_holds: offeredHolds, free_seats: Math.max(0, capacity - reserved), sold_out: capacity - reserved <= 0
        };
    }

    // ---------------------------------------------------------------- performers meta (shape = member v2/gala.js)
    function readMeta() {
        try {
            const r = getRow('SELECT value, updated_at FROM v2_gala_meta WHERE key = ?', [META_KEY]);
            if (!r) return { announced: false, list: [], updated_at: null };
            const v = JSON.parse(r.value);
            return { announced: !!v.announced, list: Array.isArray(v.list) ? v.list : [], updated_at: r.updated_at || null };
        } catch (e) { return { announced: false, list: [], updated_at: null }; }
    }
    function writeMeta(value, by) {
        db().run('INSERT OR REPLACE INTO v2_gala_meta (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
            [META_KEY, JSON.stringify(value), nowIso(), by || null]);
        persist();
    }
    function cleanPerformers(list) {
        if (!Array.isArray(list)) return null;
        const out = [];
        for (const p of list.slice(0, MAX_PERFORMERS)) {
            if (!p || typeof p !== 'object') continue;
            const name = cleanStr(p.name, 120);
            if (!name) continue;
            const row = { name, role: cleanStr(p.role, 160) };
            const photo = cleanStr(p.photo_url, 400);
            if (photo && /^(https?:\/\/|\/)/.test(photo)) row.photo_url = photo;
            out.push(row);
        }
        return out;
    }
    function metaJson() {
        const m = readMeta();
        return { performers_announced: !!m.announced, performers: m.list, price: priceBlock(), updated_at: m.updated_at };
    }

    // ---------------------------------------------------------------- offer emails + sweep
    function offerEmailHtml(w, price, acceptUrl) {
        return `<!doctype html><body style="margin:0;background:#f7f1e6;font-family:Georgia,serif;color:#191512">
<div style="max-width:600px;margin:0 auto;padding:28px 20px">
  <div style="background:#191512;color:#f7f1e6;padding:18px 24px;border-bottom:2px solid #c9a962">
    <div style="font-size:20px">Med&amp;X</div>
    <div style="font:600 9px Arial,sans-serif;letter-spacing:.3em;color:#c9a962">GALA EVENING · DECEMBER 5 · HOTEL ESPLANADE</div>
  </div>
  <div style="background:#fdfaf3;border:1px solid rgba(25,21,18,.16);border-top:0;padding:26px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#4a4239">
    <p style="margin:0 0 14px">Dear ${esc(w.name)},</p>
    <p style="margin:0 0 14px">A seat at the Med&amp;X <strong>Gala Evening</strong> has just opened, and you are first on the waitlist. It is yours if you confirm <strong>within ${OFFER_HOURS} hours</strong> — after that the seat passes to the next person in line.</p>
    <p style="margin:0 0 18px">Seat price: <strong>&euro;${esc(price)}</strong>. Gala seats are non-refundable.</p>
    <div style="text-align:center;margin:22px 0">
      <a href="${esc(acceptUrl)}" style="display:inline-block;background:#9b1b22;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.08em;padding:13px 30px">TAKE THE SEAT</a>
    </div>
    <p style="margin:0;font-size:12px;color:#6d6459">If the button does not open, paste this link into your browser:<br>${esc(acceptUrl)}</p>
    <p style="margin:18px 0 0">Warm regards,<br><strong>The Med&amp;X Team</strong></p>
  </div>
</div></body>`;
    }
    async function makeOffer(w, req) {
        const token = crypto.randomBytes(18).toString('hex');
        const expires = new Date(Date.now() + OFFER_HOURS * 3600 * 1000).toISOString();
        db().run(`UPDATE v2_gala_waitlist SET status='offered', offer_token=?, offered_at=?, offer_expires_at=?, updated_at=? WHERE id=?`,
            [token, nowIso(), expires, nowIso(), w.id]);
        const price = priceBlock().current;
        const acceptUrl = adminBase() + '/api/v2/gala-ops/waitlist/accept/' + token;
        try {
            await sendEmail(w.email, 'A seat at the Med&X Gala Evening has opened for you', offerEmailHtml(w, price, acceptUrl));
        } catch (e) { log('offer email failed (offer stands):', e.message); }
        audit(req, 'gala.waitlist_offer', `${w.name} <${w.email}> — ${OFFER_HOURS} h to accept`);
        return { id: w.id, name: w.name, email: w.email, offer_expires_at: expires };
    }
    // Expire overdue offers, then fill every free seat from the top of the list (oldest first).
    async function sweep(req) {
        const report = { expired: 0, offered: [], free_seats: 0 };
        try {
            const now = nowIso();
            const overdue = getAll(`SELECT id, name FROM v2_gala_waitlist WHERE status='offered' AND offer_expires_at IS NOT NULL AND offer_expires_at < ?`, [now]);
            for (const o of overdue) {
                db().run(`UPDATE v2_gala_waitlist SET status='expired', updated_at=? WHERE id=?`, [now, o.id]);
                report.expired++;
                audit(req, 'gala.waitlist_expired', `${o.name} — 24 h passed, seat moves on`);
            }
            let free = roomState().free_seats;
            if (free > 0) {
                const waiting = getAll(`SELECT * FROM v2_gala_waitlist WHERE status='waiting' AND email IS NOT NULL AND email != '' ORDER BY datetime(created_at) ASC`);
                for (const w of waiting) {
                    if (free <= 0) break;
                    report.offered.push(await makeOffer(w, req));
                    free--;
                }
            }
            report.free_seats = roomState().free_seats;
            if (report.expired || report.offered.length) persist();
        } catch (e) { log('sweep failed:', e.message); }
        return report;
    }
    const sweepTimer = setInterval(() => { sweep(null); }, 5 * 60 * 1000);
    if (sweepTimer.unref) sweepTimer.unref();

    // ---------------------------------------------------------------- routes
    app.get('/api/v2/gala-ops/overview', auth, adminOnly, (req, res) => {
        try {
            let assignments = [], mealsRows = [], wl = [], cancels = [];
            try { assignments = getAll('SELECT id, table_id, registration_id, seat_note FROM gala_seat_assignments'); } catch (e) {}
            try { mealsRows = getAll('SELECT registration_id, option_id FROM v2_gala_meals'); } catch (e) {}
            try { wl = getAll(`SELECT * FROM v2_gala_waitlist WHERE status != 'removed' ORDER BY datetime(created_at) ASC`); } catch (e) {}
            try { cancels = getAll('SELECT * FROM v2_gala_cancellations WHERE restored_at IS NULL'); } catch (e) {}
            const meals = {};
            for (const m of mealsRows) meals[m.registration_id] = m.option_id;
            const room = roomState();
            res.json({ tables: room.tables, assignments, meals, waitlist: wl, cancellations: cancels, categories: readCategories(), meta: metaJson(), room, price: priceBlock(), now: nowIso() });
        } catch (e) { log('overview failed:', e.message); res.status(500).json({ error: 'The Gala overview is unavailable right now.' }); }
    });

    // Meal override for one guest ('' clears it → back to the dietary-text mapping).
    app.put('/api/v2/gala-ops/registrations/:id/meal', auth, adminOnly, (req, res) => {
        try {
            const reg = getRow('SELECT id, first_name, last_name FROM gala_registrations WHERE id = ?', [req.params.id]);
            if (!reg) return res.status(404).json({ error: 'Guest not found' });
            const optionId = cleanStr(req.body && req.body.option_id, 80);
            if (!optionId) {
                db().run('DELETE FROM v2_gala_meals WHERE registration_id = ?', [req.params.id]);
                persist();
                return res.json({ success: true, option_id: null });
            }
            const opt = getRow('SELECT id, label FROM gala_menu_options WHERE id = ? AND active = 1', [optionId]);
            if (!opt) return res.status(400).json({ error: 'Unknown menu option' });
            db().run('INSERT OR REPLACE INTO v2_gala_meals (registration_id, option_id, updated_at, updated_by) VALUES (?,?,?,?)',
                [req.params.id, opt.id, nowIso(), req.user && req.user.email]);
            persist();
            audit(req, 'gala.meal_set', `${reg.first_name} ${reg.last_name} → ${opt.label}`);
            res.json({ success: true, option_id: opt.id });
        } catch (e) { log('meal set failed:', e.message); res.status(500).json({ error: 'Could not save the meal choice.' }); }
    });

    // ADD GUEST — invoice / VIP / sponsor entry paths (the artboard's + ADD GUEST panel).
    app.post('/api/v2/gala-ops/registrations', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const name = cleanStr(b.name, 160);
            const email = cleanStr(b.email, 200).toLowerCase();
            const institution = cleanStr(b.institution, 200);
            // The picker offers the LIVE category set; 'invoice' stays the one billed path and
            // every other category counts as paid — exactly how vip/sponsor always behaved.
            const wantKind = cleanStr(b.kind, 40).toLowerCase() || 'invoice';
            const kind = liveCategories().some(c => c.key === wantKind) ? wantKind : null;
            if (!kind) return res.status(400).json({ error: 'Pick one of the live guest categories' });
            if (!name) return res.status(400).json({ error: 'Type the guest’s name first' });
            if (kind === 'invoice' && !validEmail(email)) return res.status(400).json({ error: 'An invoice guest needs an email for the payment request' });
            if (email && !validEmail(email)) return res.status(400).json({ error: 'That email does not look right' });
            const sp = name.split(/\s+/);
            const firstName = sp.length > 1 ? sp.slice(0, -1).join(' ') : name;
            const lastName = sp.length > 1 ? sp[sp.length - 1] : '';
            const id = crypto.randomUUID();
            const paidKind = kind !== 'invoice';
            const payToken = kind === 'invoice' ? crypto.randomBytes(24).toString('hex') : null;
            db().run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, amount_paid, pricing, admin_notes, reviewed_by, reviewed_at, pay_token, guest_count, created_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,datetime('now'))`,
                [id, firstName, lastName, email || '', institution,
                 paidKind ? 'confirmed' : 'approved', paidKind ? 'paid' : 'pending', paidKind ? 0 : null, kind,
                 `Added from the Gala screen (${kind})`, (req.user && req.user.email) || 'admin', nowIso(), payToken]);
            let staged = false;
            if (kind === 'invoice') {
                // Payment request only — the fiscal document is FIRA's on payment, never generated here.
                const price = priceBlock().current;
                const payUrl = memberBase() + '/pay/gala/' + payToken;
                const subject = 'Your seat at the Med&X Gala Evening — payment details';
                const html = `<!doctype html><body style="margin:0;background:#f7f1e6;font-family:Arial,Helvetica,sans-serif;color:#191512">
<div style="max-width:600px;margin:0 auto;padding:28px 20px">
  <div style="background:#191512;color:#f7f1e6;padding:18px 24px;border-bottom:2px solid #c9a962">
    <div style="font-family:Georgia,serif;font-size:20px">Med&amp;X</div>
    <div style="font:600 9px Arial,sans-serif;letter-spacing:.3em;color:#c9a962">GALA EVENING · DECEMBER 5 · HOTEL ESPLANADE</div>
  </div>
  <div style="background:#fdfaf3;border:1px solid rgba(25,21,18,.16);border-top:0;padding:26px 24px;font-size:14px;line-height:1.7;color:#4a4239">
    <p style="margin:0 0 14px">Dear ${esc(firstName)},</p>
    <p style="margin:0 0 14px">A seat at the Med&amp;X <strong>Gala Evening</strong> is reserved for you. To confirm it, please complete the payment of <strong>&euro;${esc(price)}</strong> — the button below opens the secure payment page.</p>
    <div style="text-align:center;margin:22px 0"><a href="${esc(payUrl)}" style="display:inline-block;background:#9b1b22;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.08em;padding:13px 30px">COMPLETE PAYMENT</a></div>
    <p style="margin:0 0 6px;font-size:12px;color:#6d6459">Your fiscal invoice arrives automatically once the payment is confirmed. Gala seats are non-refundable.</p>
    <p style="margin:18px 0 0">Warm regards,<br><strong>The Med&amp;X Team</strong></p>
  </div>
</div></body>`;
                db().run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                          VALUES (?, 'pending_approval', ?, 'v2-gala-ops', 'gala_seat_payment_request', ?, ?, ?, ?, datetime('now'))`,
                    [crypto.randomUUID(), 'gala-add-' + Date.now().toString(36), JSON.stringify({ to: email, subject, html, channel: 'email', project: 'gala', guest_name: name }), email, subject, (req.user && req.user.email) || 'admin']);
                staged = true;
            }
            persist();
            audit(req, 'gala.guest_add', `${name}${email ? ' <' + email + '>' : ''} — ${kind}${staged ? ', payment email staged for approval' : ''}`);
            const registration = getRow('SELECT * FROM gala_registrations WHERE id = ?', [id]);
            res.json({ success: true, registration, staged_email: staged, approval_required: staged });
        } catch (e) { log('guest add failed:', e.message); res.status(500).json({ error: 'Could not add the guest.' }); }
    });

    // Non-refundable SOFT cancel — a door that can be walked back (restore) while the seat lasts.
    app.post('/api/v2/gala-ops/registrations/:id/cancel', auth, adminOnly, async (req, res) => {
        try {
            const reg = getRow('SELECT * FROM gala_registrations WHERE id = ?', [req.params.id]);
            if (!reg) return res.status(404).json({ error: 'Guest not found' });
            if (String(reg.status || '').toLowerCase() === 'cancelled') return res.status(400).json({ error: 'Already cancelled' });
            db().run('INSERT OR REPLACE INTO v2_gala_cancellations (registration_id, prev_status, prev_payment_status, cancelled_by, cancelled_at, restored_at) VALUES (?,?,?,?,?,NULL)',
                [reg.id, reg.status || null, reg.payment_status || null, (req.user && req.user.email) || 'admin', nowIso()]);
            // Status change only — the payment record stays as it is (seats are non-refundable;
            // any refund path lives elsewhere and is deliberately NOT touched here).
            db().run(`UPDATE gala_registrations SET status = 'cancelled' WHERE id = ?`, [reg.id]);
            try { db().run('DELETE FROM gala_seat_assignments WHERE registration_id = ?', [reg.id]); } catch (e) {}
            persist();
            const name = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || reg.email || reg.id;
            audit(req, 'gala.cancel', `${name} — seat freed (no refund), waitlist sweep runs`);
            const swept = await sweep(req);
            res.json({ success: true, freed_seats: seatsOf(reg), sweep: swept });
        } catch (e) { log('cancel failed:', e.message); res.status(500).json({ error: 'Could not cancel the seat.' }); }
    });

    // UNDO for the soft cancel.
    app.post('/api/v2/gala-ops/registrations/:id/restore', auth, adminOnly, async (req, res) => {
        try {
            const reg = getRow('SELECT * FROM gala_registrations WHERE id = ?', [req.params.id]);
            if (!reg) return res.status(404).json({ error: 'Guest not found' });
            if (String(reg.status || '').toLowerCase() !== 'cancelled') return res.status(400).json({ error: 'This seat is not cancelled' });
            const c = getRow('SELECT * FROM v2_gala_cancellations WHERE registration_id = ? AND restored_at IS NULL', [reg.id]);
            const prevStatus = (c && c.prev_status) || (reg.payment_status === 'paid' ? 'confirmed' : 'approved');
            db().run('UPDATE gala_registrations SET status = ? WHERE id = ?', [prevStatus, reg.id]);
            if (c) db().run('UPDATE v2_gala_cancellations SET restored_at = ? WHERE registration_id = ?', [nowIso(), reg.id]);
            persist();
            const name = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || reg.email || reg.id;
            audit(req, 'gala.cancel_undo', `${name} — back to '${prevStatus}'`);
            const swept = await sweep(req); // the seat is taken again — nothing new gets offered
            res.json({ success: true, status: prevStatus, sweep: swept });
        } catch (e) { log('restore failed:', e.message); res.status(500).json({ error: 'Could not restore the seat.' }); }
    });

    // ---- guest categories (the ADD-GUEST picker set as data; keys live in gala_registrations.pricing) ----
    app.get('/api/v2/gala-ops/categories', auth, adminOnly, (req, res) => {
        try { res.json({ categories: readCategories() }); }
        catch (e) { res.status(500).json({ error: 'Categories are unavailable right now.' }); }
    });
    app.post('/api/v2/gala-ops/categories', auth, adminOnly, (req, res) => {
        try {
            const label = cleanStr(req.body && req.body.label, 60);
            if (!label) return res.status(400).json({ error: 'Type the category label first' });
            const key = slugKey(label);
            if (!key) return res.status(400).json({ error: 'The label needs at least one letter or digit' });
            if (getRow('SELECT id FROM v2_gala_categories WHERE key = ?', [key]))
                return res.status(400).json({ error: `'${key}' already exists — it may be archived; restore it instead of adding a twin` });
            const top = getRow('SELECT MAX(sort) AS m FROM v2_gala_categories');
            const id = crypto.randomUUID();
            db().run('INSERT INTO v2_gala_categories (id, key, label, color, sort, archived, updated_at) VALUES (?,?,?,?,?,0,?)',
                [id, key, label, okColor(req.body && req.body.color) || '#6d6459', (Number(top && top.m) || 0) + 10, nowIso()]);
            persist();
            audit(req, 'gala.category_add', `${label} (${key})`);
            res.json({ success: true, category: getRow('SELECT id, key, label, color, sort, archived FROM v2_gala_categories WHERE id = ?', [id]) });
        } catch (e) { log('category add failed:', e.message); res.status(500).json({ error: 'Could not add the category.' }); }
    });
    app.put('/api/v2/gala-ops/categories/:id', auth, adminOnly, (req, res) => {
        try {
            const cat = getRow('SELECT * FROM v2_gala_categories WHERE id = ?', [req.params.id]);
            if (!cat) return res.status(404).json({ error: 'Category not found' });
            const b = req.body || {};
            const next = { label: cat.label, color: cat.color, sort: Number(cat.sort) || 0, archived: Number(cat.archived) ? 1 : 0 };
            const did = [];
            if (b.label !== undefined) {
                const l = cleanStr(b.label, 60);
                if (!l) return res.status(400).json({ error: 'The label cannot be empty' });
                if (l !== cat.label) did.push(`renamed '${cat.label}' → '${l}'`);
                next.label = l;                                    // the KEY never changes — storage stays put
            }
            if (b.color !== undefined) {
                const c = okColor(b.color);
                if (!c) return res.status(400).json({ error: 'Colors are #rrggbb' });
                if (c !== cat.color) did.push('recolored');
                next.color = c;
            }
            if (b.sort !== undefined) {
                if (!Number.isFinite(Number(b.sort))) return res.status(400).json({ error: 'sort must be a number' });
                next.sort = Math.round(Number(b.sort));
                if (next.sort !== (Number(cat.sort) || 0)) did.push('reordered');
            }
            if (b.archived !== undefined) {
                const a = (b.archived === true || b.archived === 1 || b.archived === '1' || b.archived === 'true') ? 1 : 0;
                if (a && !next.archived) {
                    if (!liveCategories().filter(c => c.id !== cat.id).length)
                        return res.status(400).json({ error: 'At least one live category must remain — add another before archiving this one' });
                    did.push('archived');
                }
                if (!a && next.archived) did.push('restored');
                next.archived = a;
            }
            if (!did.length) return res.json({ success: true, category: { id: cat.id, key: cat.key, label: cat.label, color: cat.color, sort: cat.sort, archived: cat.archived } });
            db().run('UPDATE v2_gala_categories SET label=?, color=?, sort=?, archived=?, updated_at=? WHERE id=?',
                [next.label, next.color, next.sort, next.archived, nowIso(), cat.id]);
            persist();
            audit(req, 'gala.category_edit', `${cat.key}: ${did.join(', ')}`);
            res.json({ success: true, category: getRow('SELECT id, key, label, color, sort, archived FROM v2_gala_categories WHERE id = ?', [cat.id]) });
        } catch (e) { log('category edit failed:', e.message); res.status(500).json({ error: 'Could not save the category.' }); }
    });
    // Re-tag ONE guest — writes the category key into gala_registrations.pricing (the column the
    // legacy portal, the seating payload and the chips already read). A label move only: status,
    // payment_status and amounts are deliberately untouched.
    app.put('/api/v2/gala-ops/registrations/:id/category', auth, adminOnly, (req, res) => {
        try {
            const reg = getRow('SELECT id, first_name, last_name, email, pricing FROM gala_registrations WHERE id = ?', [req.params.id]);
            if (!reg) return res.status(404).json({ error: 'Guest not found' });
            const key = cleanStr(req.body && req.body.key, 40).toLowerCase();
            if (!liveCategories().some(c => c.key === key)) return res.status(400).json({ error: 'Pick one of the live categories' });
            if (key !== String(reg.pricing || '')) {
                db().run('UPDATE gala_registrations SET pricing = ? WHERE id = ?', [key, reg.id]);
                persist();
                const name = `${reg.first_name || ''} ${reg.last_name || ''}`.trim() || reg.email || reg.id;
                audit(req, 'gala.category_set', `${name}: '${reg.pricing || '—'}' → '${key}'`);
            }
            res.json({ success: true, pricing: key });
        } catch (e) { log('category set failed:', e.message); res.status(500).json({ error: 'Could not change the guest category.' }); }
    });

    // ---- waitlist ----
    app.post('/api/v2/gala-ops/waitlist', auth, adminOnly, async (req, res) => {
        try {
            const b = req.body || {};
            const name = cleanStr(b.name, 160);
            const email = cleanStr(b.email, 200).toLowerCase();
            if (!name) return res.status(400).json({ error: 'A name is required' });
            if (email && !validEmail(email)) return res.status(400).json({ error: 'That email does not look right' });
            const id = crypto.randomUUID();
            db().run(`INSERT INTO v2_gala_waitlist (id, name, email, institution, note, status, source, added_by, created_at, updated_at)
                      VALUES (?,?,?,?,?,'waiting','admin',?,datetime('now'),?)`,
                [id, name, email || null, cleanStr(b.institution, 200) || null, cleanStr(b.note, 300) || null, (req.user && req.user.email) || 'admin', nowIso()]);
            persist();
            audit(req, 'gala.waitlist_add', `${name}${email ? ' <' + email + '>' : ''}`);
            // If seats are free right now the sweep offers immediately — the 24 h clock starts.
            const swept = await sweep(req);
            res.json({ success: true, id, entry: getRow('SELECT * FROM v2_gala_waitlist WHERE id = ?', [id]), sweep: swept });
        } catch (e) { log('waitlist add failed:', e.message); res.status(500).json({ error: 'Could not add to the waitlist.' }); }
    });
    app.delete('/api/v2/gala-ops/waitlist/:id', auth, adminOnly, (req, res) => {
        try {
            const w = getRow('SELECT * FROM v2_gala_waitlist WHERE id = ?', [req.params.id]);
            if (!w) return res.status(404).json({ error: 'Waitlist entry not found' });
            db().run(`UPDATE v2_gala_waitlist SET status='removed', updated_at=? WHERE id=?`, [nowIso(), req.params.id]);
            persist();
            audit(req, 'gala.waitlist_remove', w.name);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Could not remove the entry.' }); }
    });
    // Admin's explicit OFFER A SEAT on one row (works even when the sweep would not pick it yet).
    app.post('/api/v2/gala-ops/waitlist/:id/offer', auth, adminOnly, async (req, res) => {
        try {
            const w = getRow('SELECT * FROM v2_gala_waitlist WHERE id = ?', [req.params.id]);
            if (!w) return res.status(404).json({ error: 'Waitlist entry not found' });
            if (!w.email) return res.status(400).json({ error: 'Add an email first — the offer goes out by email' });
            if (w.status === 'offered') return res.status(400).json({ error: 'The offer is already out' });
            if (w.status === 'accepted') return res.status(400).json({ error: 'Already accepted — they are in the guest list' });
            const offer = await makeOffer(w, req);
            persist();
            res.json({ success: true, offer });
        } catch (e) { log('manual offer failed:', e.message); res.status(500).json({ error: 'Could not send the offer.' }); }
    });
    app.post('/api/v2/gala-ops/waitlist/sweep', auth, adminOnly, async (req, res) => {
        try { res.json({ success: true, ...(await sweep(req)) }); }
        catch (e) { res.status(500).json({ error: 'Sweep failed.' }); }
    });

    // PUBLIC accept page for the 24 h offer (linked from the offer email; no auth by design).
    app.get('/api/v2/gala-ops/waitlist/accept/:token', async (req, res) => {
        const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Med&X</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f7f1e6;color:#191512;font-family:Inter,Arial,sans-serif}a{color:#9b1b22}</style></head>
<body><div style="max-width:560px;margin:8vh auto;padding:0 20px">
  <div style="background:#191512;color:#f7f1e6;padding:20px 26px;border-bottom:2px solid #c9a962">
    <div style="font-family:Fraunces,serif;font-size:22px">Med&amp;X</div>
    <div style="font:600 9px Inter,sans-serif;letter-spacing:.3em;color:#c9a962">GALA EVENING · DECEMBER 5 · HOTEL ESPLANADE</div>
  </div>
  <div style="background:#fdfaf3;border:1px solid rgba(25,21,18,.16);border-top:0;padding:30px 26px">
    <div style="font-family:Fraunces,serif;font-style:italic;font-size:26px;line-height:1.2;margin-bottom:12px">${title}</div>
    <div style="font-size:14px;line-height:1.75;color:#4a4239">${body}</div>
  </div>
</div></body></html>`;
        try {
            const token = cleanStr(req.params.token, 80);
            const w = token ? getRow('SELECT * FROM v2_gala_waitlist WHERE offer_token = ?', [token]) : null;
            if (!w) return res.status(404).send(page('This link leads nowhere.', 'The offer link is not valid. If you believe a seat is waiting for you, write to <a href="mailto:info@medx.hr">info@medx.hr</a>.'));
            if (w.status === 'accepted' && w.registration_id) {
                const reg = getRow('SELECT pay_token, payment_status FROM gala_registrations WHERE id = ?', [w.registration_id]);
                const payLine = reg && reg.payment_status !== 'paid' && reg.pay_token
                    ? `Complete the payment here: <a href="${esc(memberBase() + '/pay/gala/' + reg.pay_token)}">secure payment page</a>.`
                    : 'Your seat is confirmed — see you on December 5.';
                return res.send(page('Your seat is already yours.', `You accepted this offer earlier. ${payLine}`));
            }
            if (w.status !== 'offered' || (w.offer_expires_at && w.offer_expires_at < nowIso())) {
                if (w.status === 'offered') { db().run(`UPDATE v2_gala_waitlist SET status='expired', updated_at=? WHERE id=?`, [nowIso(), w.id]); persist(); sweep(null); }
                return res.send(page('The 24 hours have passed.', 'This offer has moved on to the next person in line. You stay close to the top of the waitlist — we will write the moment another seat opens.'));
            }
            // Accept: the guest becomes a real registration, approved and awaiting payment.
            const regId = crypto.randomUUID();
            const payToken = crypto.randomBytes(24).toString('hex');
            const sp = String(w.name).split(/\s+/);
            db().run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status, payment_status, pricing, admin_notes, reviewed_by, reviewed_at, pay_token, guest_count, created_at)
                      VALUES (?,?,?,?,?,'approved','pending','waitlist','Accepted a waitlist offer','waitlist-offer',?,?,0,datetime('now'))`,
                [regId, sp.length > 1 ? sp.slice(0, -1).join(' ') : w.name, sp.length > 1 ? sp[sp.length - 1] : '', w.email || '', w.institution || '', nowIso(), payToken]);
            db().run(`UPDATE v2_gala_waitlist SET status='accepted', accepted_at=?, registration_id=?, updated_at=? WHERE id=?`, [nowIso(), regId, nowIso(), w.id]);
            persist();
            audit(null, 'gala.waitlist_accepted', `${w.name} <${w.email || 'no email'}> — registration ${regId}`);
            const price = priceBlock().current;
            const payUrl = memberBase() + '/pay/gala/' + payToken;
            return res.send(page('The seat is yours.', `Wonderful — your place at the Gala Evening is reserved, ${esc(w.name)}. One step remains: the payment of <strong>&euro;${esc(price)}</strong> confirms it.<br><br><a href="${esc(payUrl)}" style="display:inline-block;background:#9b1b22;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.08em;padding:13px 30px">COMPLETE PAYMENT</a><br><br><span style="font-size:12px;color:#6d6459">Gala seats are non-refundable. Questions — <a href="mailto:info@medx.hr">info@medx.hr</a>.</span>`));
        } catch (e) {
            log('accept failed:', e.message);
            res.status(500).send(page('Something went wrong.', 'Please try the link again in a moment, or write to <a href="mailto:info@medx.hr">info@medx.hr</a>.'));
        }
    });

    // ---- INVITATIONS (v2_gala_invites · states derived live · emails ONLY via the approval outbox) ----
    const INVITE_MAX_BATCH = 200;
    // Live registrations by lowercased email — the 'registered' truth for the join. A paid row
    // wins over an unpaid one so the card can say "registered · paid" when both exist.
    function liveRegByEmail() {
        const m = new Map();
        try {
            for (const r of getAll('SELECT email, status, payment_status FROM gala_registrations')) {
                const e = String(r.email || '').trim().toLowerCase();
                if (!e || INACTIVE.includes(String(r.status || '').toLowerCase())) continue;
                const prev = m.get(e);
                if (!prev || (r.payment_status === 'paid' && prev.payment_status !== 'paid'))
                    m.set(e, { status: r.status || null, payment_status: r.payment_status || null });
            }
        } catch (e) { /* no registrations table yet — everyone reads as not registered */ }
        return m;
    }
    function invitesPayload() {
        const regMap = liveRegByEmail();
        let rows = [];
        try { rows = getAll('SELECT * FROM v2_gala_invites ORDER BY datetime(invited_at) DESC, datetime(created_at) DESC'); } catch (e) {}
        const invites = rows.map(r => {
            const reg = regMap.get(String(r.email).toLowerCase()) || null;
            const state = reg ? 'registered' : (r.opened_at ? 'opened' : 'invited');
            return { id: r.id, email: r.email, name: r.name, lang: r.lang, invited_at: r.invited_at, opened_at: r.opened_at, queued_count: r.queued_count, created_at: r.created_at, state, reg };
        });
        const registered = invites.filter(i => i.state === 'registered').length;
        const opened = invites.filter(i => i.state === 'opened').length;
        return { invites, summary: { invited: invites.length, registered, opened, never: invites.length - registered - opened } };
    }
    // TODO: swap to email-templates — inline for now, branded exactly like this module's other
    // emails (ink band + gold rule + cream card + crimson CTA), in the guest's language.
    function inviteEmailHtml(lang, name, price, openUrl) {
        const T = lang === 'hr' ? {
            strip: 'GALA VEČER · 5. PROSINCA · HOTEL ESPLANADE',
            dear: name ? `Poštovani ${esc(name)},` : 'Poštovani,',
            p1: 'Sa zadovoljstvom Vas pozivamo na <strong>Gala večer Med&amp;X-a</strong> — svečanu večer u srcu Zagreba: večera, program i dodjela godišnjih nagrada Med&amp;X-a, uz vodeće ljude hrvatske biomedicine i naše dijaspore.',
            p2: `Broj mjesta je ograničen. Kotizacija iznosi <strong>&euro;${esc(price)}</strong> po osobi — svoje mjesto potvrđujete registracijom putem poveznice u nastavku.`,
            cta: 'REZERVIRAJTE SVOJE MJESTO',
            fallback: 'Ako se gumb ne otvori, zalijepite ovu poveznicu u preglednik:',
            bye: 'Srdačan pozdrav,<br><strong>Vaš Med&amp;X tim</strong>'
        } : {
            strip: 'GALA EVENING · DECEMBER 5 · HOTEL ESPLANADE',
            dear: name ? `Dear ${esc(name)},` : 'Dear guest,',
            p1: 'It is our pleasure to invite you to the <strong>Med&amp;X Gala Evening</strong> — a formal evening in the heart of Zagreb: dinner, the programme and the annual Med&amp;X Awards, together with the leading people of Croatian biomedicine and its diaspora.',
            p2: `Seats are limited. The seat is <strong>&euro;${esc(price)}</strong> per person — registering through the link below confirms yours.`,
            cta: 'RESERVE YOUR SEAT',
            fallback: 'If the button does not open, paste this link into your browser:',
            bye: 'Warm regards,<br><strong>The Med&amp;X Team</strong>'
        };
        return `<!doctype html><body style="margin:0;background:#f7f1e6;font-family:Arial,Helvetica,sans-serif;color:#191512">
<div style="max-width:600px;margin:0 auto;padding:28px 20px">
  <div style="background:#191512;color:#f7f1e6;padding:18px 24px;border-bottom:2px solid #c9a962">
    <div style="font-family:Georgia,serif;font-size:20px">Med&amp;X</div>
    <div style="font:600 9px Arial,sans-serif;letter-spacing:.3em;color:#c9a962">${T.strip}</div>
  </div>
  <div style="background:#fdfaf3;border:1px solid rgba(25,21,18,.16);border-top:0;padding:26px 24px;font-size:14px;line-height:1.7;color:#4a4239">
    <p style="margin:0 0 14px">${T.dear}</p>
    <p style="margin:0 0 14px">${T.p1}</p>
    <p style="margin:0 0 18px">${T.p2}</p>
    <div style="text-align:center;margin:22px 0">
      <a href="${esc(openUrl)}" style="display:inline-block;background:#9b1b22;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.08em;padding:13px 30px">${T.cta}</a>
    </div>
    <p style="margin:0;font-size:12px;color:#6d6459">${T.fallback}<br>${esc(openUrl)}</p>
    <p style="margin:18px 0 0">${T.bye}</p>
  </div>
</div></body>`;
    }
    function inviteEmail(inv, lang, price) {
        const openUrl = adminBase() + '/api/v2/gala-ops/invites/open/' + inv.token;
        const subject = lang === 'hr'
            ? 'Pozivnica na Gala večer Med&X-a — 5. prosinca'
            : 'An invitation to the Med&X Gala Evening — December 5';
        return { subject, html: inviteEmailHtml(lang, inv.name, price, openUrl) };
    }

    app.get('/api/v2/gala-ops/invites', auth, adminOnly, (req, res) => {
        try { res.json(invitesPayload()); }
        catch (e) { log('invites read failed:', e.message); res.status(500).json({ error: 'Invitations are unavailable right now.' }); }
    });

    // QUEUE INVITES — every email lands in the approval outbox as 'pending_approval'; the EMAIL &
    // OUTBOX tab's APPROVE & SEND (POST /api/admin/outbox/:batch/approve) is the ONLY way it sends.
    app.post('/api/v2/gala-ops/invites/queue', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const lang = String(b.lang || 'en').toLowerCase() === 'hr' ? 'hr' : 'en';
            const seen = new Set();
            const people = [];
            const bad = [];
            for (const p of (Array.isArray(b.people) ? b.people.slice(0, INVITE_MAX_BATCH) : [])) {
                const email = cleanStr(p && p.email, 200).toLowerCase();
                const name = cleanStr(p && p.name, 160);
                if (!validEmail(email)) { if (email || name) bad.push(email || name); continue; }
                if (seen.has(email)) continue;
                seen.add(email);
                people.push({ email, name });
            }
            if (!people.length) return res.status(400).json({ error: bad.length ? `No usable email in: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}` : 'Add at least one guest — an email each' });
            const regMap = liveRegByEmail();
            const skipped = people.filter(p => regMap.has(p.email)).map(p => p.email);
            const toInvite = people.filter(p => !regMap.has(p.email));
            if (!toInvite.length) return res.status(400).json({ error: 'Everyone on that list already has a live Gala registration — nothing to invite.' });
            const batchId = 'gala-invite-' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 5);
            const price = priceBlock().current;
            const by = (req.user && req.user.email) || 'admin';
            let queued = 0;
            for (const p of toInvite) {
                let inv = getRow('SELECT * FROM v2_gala_invites WHERE email = ?', [p.email]);
                if (inv) {
                    db().run(`UPDATE v2_gala_invites SET name = COALESCE(NULLIF(?, ''), name), lang = ?, batch_id = ?, invited_at = ?, queued_count = COALESCE(queued_count, 0) + 1, updated_at = ? WHERE id = ?`,
                        [p.name, lang, batchId, nowIso(), nowIso(), inv.id]);
                    inv = getRow('SELECT * FROM v2_gala_invites WHERE id = ?', [inv.id]);
                } else {
                    const id = crypto.randomUUID();
                    db().run(`INSERT INTO v2_gala_invites (id, email, name, lang, token, batch_id, invited_at, opened_at, queued_count, created_by, created_at, updated_at)
                              VALUES (?,?,?,?,?,?,?,NULL,1,?,datetime('now'),?)`,
                        [id, p.email, p.name || null, lang, crypto.randomBytes(18).toString('hex'), batchId, nowIso(), by, nowIso()]);
                    inv = getRow('SELECT * FROM v2_gala_invites WHERE id = ?', [id]);
                }
                const mail = inviteEmail(inv, lang, price);
                db().run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                          VALUES (?, 'pending_approval', ?, 'v2-gala-ops', ?, ?, ?, ?, ?, datetime('now'))`,
                    [crypto.randomUUID(), batchId, 'gala_invitation_' + lang,
                     JSON.stringify({ to: inv.email, subject: mail.subject, html: mail.html, lang, project: 'gala', invite_id: inv.id, guest_name: inv.name || null, reply_to: by !== 'admin' ? by : null }),
                     inv.email, mail.subject, by]);
                queued++;
            }
            persist();
            audit(req, 'gala.invites_queue', `${queued} ${lang.toUpperCase()} invitation(s) staged for approval — batch ${batchId}${skipped.length ? `, ${skipped.length} already registered skipped` : ''}`);
            res.json({ success: true, batch_id: batchId, queued, skipped_registered: skipped, approval_required: true });
        } catch (e) { log('invite queue failed:', e.message); res.status(500).json({ error: 'Could not queue the invitations.' }); }
    });

    // PUBLIC open-tracking hop (linked from the invite email; no auth by design). Stamps the first
    // open, then always redirects to the member portal's Gala page — never a dead end for a guest.
    app.get('/api/v2/gala-ops/invites/open/:token', (req, res) => {
        try {
            const token = cleanStr(req.params.token, 80);
            const inv = token ? getRow('SELECT id, email, opened_at FROM v2_gala_invites WHERE token = ?', [token]) : null;
            if (inv && !inv.opened_at) {
                db().run('UPDATE v2_gala_invites SET opened_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), inv.id]);
                persist();
                audit(null, 'gala.invite_opened', inv.email);
            }
        } catch (e) { log('invite open failed (redirecting anyway):', e.message); }
        res.redirect(302, memberBase() + '/app/gala');
    });

    // ---- MENU OPTIONS (same gala_menu_options table as v1 — v2 adds the full list, description/
    // bucket and archive/restore; the v1 routes and every v1 reader keep working untouched) ----
    const MENU_FIELDS = 'id, label, description, bucket, keywords, sort_order, is_default, active, created_at';
    function readMenuAll() {
        try { return getAll(`SELECT ${MENU_FIELDS} FROM gala_menu_options ORDER BY sort_order, created_at`); }
        catch (e) { return []; }
    }
    const okBucket = (v) => {
        const s = cleanStr(v, 24).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return s || null;
    };
    app.get('/api/v2/gala-ops/menu-options', auth, adminOnly, (req, res) => {
        try { res.json({ options: readMenuAll() }); }
        catch (e) { res.status(500).json({ error: 'The menu is unavailable right now.' }); }
    });
    app.post('/api/v2/gala-ops/menu-options', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const label = cleanStr(b.label, 80);
            if (!label) return res.status(400).json({ error: 'Type the option name first' });
            // Same defaults as the v1 POST: keywords fall back to the lowercased label, sort goes last.
            const keywords = (cleanStr(b.keywords, 300) || label.toLowerCase());
            const top = getRow('SELECT COALESCE(MAX(sort_order), -1) AS m FROM gala_menu_options');
            const id = crypto.randomUUID();
            db().run('INSERT INTO gala_menu_options (id, label, description, bucket, keywords, sort_order, is_default, active) VALUES (?,?,?,?,?,?,0,1)',
                [id, label, cleanStr(b.description, 300) || null, okBucket(b.bucket), keywords, (Number(top && top.m) >= 0 ? Number(top.m) : -1) + 1]);
            persist();
            audit(req, 'gala.menu_option_add', label);
            res.json({ success: true, option: getRow(`SELECT ${MENU_FIELDS} FROM gala_menu_options WHERE id = ?`, [id]) });
        } catch (e) { log('menu add failed:', e.message); res.status(500).json({ error: 'Could not add the menu option.' }); }
    });
    app.put('/api/v2/gala-ops/menu-options/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow(`SELECT ${MENU_FIELDS} FROM gala_menu_options WHERE id = ?`, [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Menu option not found' });
            const b = req.body || {};
            const fields = [], values = [], did = [];
            if (b.label !== undefined) {
                const l = cleanStr(b.label, 80);
                if (!l) return res.status(400).json({ error: 'The option name cannot be empty' });
                fields.push('label = ?'); values.push(l);
                if (l !== row.label) did.push(`renamed '${row.label}' → '${l}'`);
            }
            if (b.description !== undefined) { fields.push('description = ?'); values.push(cleanStr(b.description, 300) || null); did.push('description'); }
            if (b.bucket !== undefined) { fields.push('bucket = ?'); values.push(okBucket(b.bucket)); did.push('bucket'); }
            if (b.keywords !== undefined) { fields.push('keywords = ?'); values.push(cleanStr(b.keywords, 300)); did.push('keywords'); }
            if (b.sort_order !== undefined) {
                if (!Number.isFinite(Number(b.sort_order))) return res.status(400).json({ error: 'sort_order must be a number' });
                fields.push('sort_order = ?'); values.push(Math.round(Number(b.sort_order))); did.push('reordered');
            }
            if (b.active !== undefined) {
                const a = (b.active === true || b.active === 1 || b.active === '1' || b.active === 'true') ? 1 : 0;
                if (!a && Number(row.active)) {
                    const others = getRow('SELECT COUNT(*) AS c FROM gala_menu_options WHERE active = 1 AND id != ?', [row.id]);
                    if (!Number(others && others.c)) return res.status(400).json({ error: 'Keep at least one live menu option — the kitchen needs somewhere to count.' });
                    did.push('archived');
                }
                if (a && !Number(row.active)) did.push('restored');
                fields.push('active = ?'); values.push(a);
            }
            if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
            values.push(row.id);
            db().run(`UPDATE gala_menu_options SET ${fields.join(', ')} WHERE id = ?`, values);
            persist();
            audit(req, 'gala.menu_option_edit', `${row.label}: ${did.join(', ') || 'touched'}`);
            res.json({ success: true, option: getRow(`SELECT ${MENU_FIELDS} FROM gala_menu_options WHERE id = ?`, [row.id]) });
        } catch (e) { log('menu edit failed:', e.message); res.status(500).json({ error: 'Could not save the menu option.' }); }
    });

    // ---- performers meta (admin-side twin of the member GET/PUT — same table, same shape) ----
    app.get('/api/v2/gala-ops/meta', auth, adminOnly, (req, res) => {
        try { res.json(metaJson()); }
        catch (e) { res.status(500).json({ error: 'Gala details are unavailable right now.' }); }
    });
    app.put('/api/v2/gala-ops/meta', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const cur = readMeta();
            const next = { announced: !!cur.announced, list: Array.isArray(cur.list) ? cur.list : [] };
            let touched = false;
            if (b.performers_announced !== undefined) { next.announced = b.performers_announced === true || b.performers_announced === 1 || b.performers_announced === '1' || b.performers_announced === 'true'; touched = true; }
            if (b.performers !== undefined) {
                const list = cleanPerformers(b.performers);
                if (!list) return res.status(400).json({ error: 'performers must be an array of { name, role }' });
                next.list = list; touched = true;
            }
            if (!touched) return res.status(400).json({ error: 'Nothing to update — send performers_announced and/or performers' });
            if (next.announced && !next.list.length) return res.status(400).json({ error: 'Add at least one performer before announcing' });
            writeMeta(next, req.user && req.user.email);
            audit(req, 'gala.performers', next.announced ? `announced: ${next.list.map(p => p.name).join(', ')}` : 'back to TBA');
            res.json(Object.assign({ success: true }, metaJson()));
        } catch (e) { log('meta write failed:', e.message); res.status(500).json({ error: 'Could not save the Gala details.' }); }
    });

    log('gala-ops mounted (overview, add-guest, meal, soft-cancel/restore, waitlist + 24 h offers, performers meta, guest categories, invitations → outbox, menu options)');
};
