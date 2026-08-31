/**
 * v2/transfer.js — Gala seat transfer for the redesigned member portal
 * (frontend-v2 › js/views/plexus.js › My Plexus › "Transfer to a colleague" block).
 *
 *   POST /api/v2/transfer/gala   auth ← { to_name, to_email }
 *        Moves the signed-in member's Gala seat to a colleague IN PLACE: the same
 *        registration id (and therefore the same hosted QR, /qr/<id>.png) now belongs
 *        to the new person. Writes one v2_seat_transfers audit row (status 'done') and
 *        sends two confirmations via ctx.sendEmail (old holder + new holder — on staging
 *        both are dumped to EMAIL_DUMP_DIR, nothing leaves the box).
 *
 * How the seat is found (mirrors wallet.js › allItems and server.js › /api/gala/my-status):
 *   1) gala_registrations WHERE (user_id = me OR lower(email) = me) and status not
 *      rejected/declined/cancelled                                  → kind 'gala'
 *   2) else croatians_abroad_registrations WHERE selected_gala = 1 (same ownership +
 *      not-cancelled rule); when that row links a gala_registrations row
 *      (gala_registration_id) the LINKED row is the seat (kind 'gala'), otherwise the
 *      CA row itself is (kind 'ca').
 *
 * What the transfer updates — holder columns ONLY (party/guests untouched:
 * ca_registration_guests rows key off registration_id and are not touched; dietary,
 * amount_paid, invoice_number, status, payment_status all stay):
 *   - kind 'gala': gala_registrations.first_name/last_name/email + user_id (the new
 *     holder's account id when one exists, else NULL — wallet.js keys ownership off
 *     `user_id = ? OR lower(email) = ?`, so BOTH must move or the old member would
 *     keep seeing the seat).
 *     A CA row linked to that gala row feeds the /qr/:id.png payload (server.js:4117
 *     matches `id = ? OR gala_registration_id = ?`), so it must follow:
 *       · CA row is gala-only (no conference/bridges portion) → its holder columns move
 *         with the seat (same person on the QR payload).
 *       · CA row also carries conference/bridges → those stay with the old holder: the
 *         gala portion is detached (selected_gala = 0, gala_registration_id = NULL) and
 *         /qr/<gala_id>.png falls through to the standalone gala payload (new holder).
 *   - kind 'ca' (no linked gala row): the CA row's holder columns move — that row IS
 *     the seat and the QR. (If it also carries the free conference portion the whole
 *     registration moves with it: one row, one QR — stated in the member confirm
 *     dialog and both emails.)
 *
 * Guards: seat must exist and be paid or pending (any status except
 * rejected/declined/cancelled) · checked_in = 1 → 409 · one transfer per registration
 * per 24 h (v2_seat_transfers.created_at) → 429 · transferring to the seat's own
 * e-mail → 400.
 *
 * Admin visibility: GET /api/v2/transfer/log lives in the ADMIN portal
 * (admin-portal/backend/v2/registrations.js) and reads the same v2_seat_transfers
 * table (both portals share ONE database; the table is declared identically there).
 *
 * Policy (also shown on the member Gala page + My Plexus): seats are non-refundable —
 * but transferable to a colleague up to the day of the event. No refund flow exists here.
 */
'use strict';

const crypto = require('crypto');

module.exports = function mountTransfer(app, ctx) {
    const { db, auth, sendEmail } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/transfer]', ...a));

    // ---- schema (both portals share ONE DB — v2_ prefix, try/catch DDL at load) ----
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
    } catch (e) { log('schema failed:', e.message); }

    // ---- sql.js-wrapper helpers (shared/db.js idioms, as in wallet.js) ----
    const q = {
        get(sql, params = []) {
            const stmt = db().prepare(sql);
            if (params.length) stmt.bind(params);
            if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
            stmt.free(); return null;
        },
        all(sql, params = []) {
            const stmt = db().prepare(sql);
            if (params.length) stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free(); return rows;
        },
        run(sql, params = []) { db().run(sql, params); }
    };
    const tryGet = (sql, params) => { try { return q.get(sql, params); } catch (e) { return null; } };
    const syncSoon = () => { try { db().sync(); } catch (e) { /* no Turso locally */ } };
    const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const NOT_A_SEAT = new Set(['rejected', 'declined', 'cancelled']);

    function me(req) {
        const u = tryGet('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [req.user.id]);
        const email = String((u && u.email) || req.user.email || '').toLowerCase();
        return { id: req.user.id, email, first_name: (u && u.first_name) || '', last_name: (u && u.last_name) || '' };
    }

    // The member's transferable Gala seat (see header). Returns { kind, row, ca } or null.
    function findSeat(user) {
        const em = user.email || '__none__';
        const g = tryGet(`SELECT * FROM gala_registrations
                           WHERE (user_id = ? OR lower(email) = ?)
                             AND COALESCE(status,'') NOT IN ('rejected','declined','cancelled')
                           ORDER BY created_at DESC LIMIT 1`, [user.id, em]);
        if (g) {
            const ca = tryGet('SELECT * FROM croatians_abroad_registrations WHERE id = ? OR gala_registration_id = ?', [g.id, g.id]);
            return { kind: 'gala', row: g, ca: ca || null };
        }
        const ca = tryGet(`SELECT * FROM croatians_abroad_registrations
                            WHERE selected_gala = 1
                              AND COALESCE(gala_status,'') NOT IN ('rejected','declined','cancelled')
                              AND (user_id = ? OR lower(email) = ?)
                            ORDER BY created_at DESC LIMIT 1`, [user.id, em]);
        if (!ca) return null;
        if (ca.gala_registration_id) {
            const linked = tryGet('SELECT * FROM gala_registrations WHERE id = ?', [ca.gala_registration_id]);
            if (linked && !NOT_A_SEAT.has(String(linked.status || '').toLowerCase())) return { kind: 'gala', row: linked, ca };
        }
        return { kind: 'ca', row: ca, ca };
    }

    function splitName(full) {
        const parts = String(full || '').trim().replace(/\s+/g, ' ').split(' ');
        return { first: parts.shift() || '', last: parts.join(' ') };  // last may be '' (column is NOT NULL, never NULL here)
    }

    function galaFacts() {
        const s = tryGet("SELECT title, date, time, venue, dress_code FROM gala_settings WHERE id = 'default'") || {};
        return {
            title: s.title || 'Plexus 2026 — Gala Evening',
            date: s.date || '2026-12-05', time: s.time || '19:00',
            venue: s.venue || 'Hotel Esplanade, Zagreb', dress: s.dress_code || 'Black tie / formal evening attire'
        };
    }

    function publicBase() {
        return String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com').replace(/\/+$/, '');
    }

    // ---- inline email HTML (staging: ctx.sendEmail dumps to EMAIL_DUMP_DIR, nothing is sent)
    // TODO: swap to email-templates.seatTransferred once that module lands (owned by another
    // engineer this wave — email-templates.js is NOT touched from here on purpose).
    function emailShell(inner) {
        return `<div style="margin:0;padding:28px 16px;background:#f7f1e6;font-family:Georgia,'Times New Roman',serif;color:#191512">
  <div style="max-width:560px;margin:0 auto;background:#fdfaf3;border:1px solid rgba(25,21,18,.16);border-top:3px solid #9b1b22">
    <div style="padding:22px 28px 0;font:600 11px Arial,Helvetica,sans-serif;letter-spacing:.18em;color:#9b1b22">MED&amp;X · PLEXUS 2026</div>
    <div style="padding:14px 28px 26px;font-size:15px;line-height:1.65">${inner}</div>
    <div style="padding:14px 28px;border-top:1px solid rgba(25,21,18,.12);font:400 11.5px Arial,Helvetica,sans-serif;color:#4a4239">
      Seats are non-refundable — but a seat can be transferred to a colleague up to the day of the event.<br>
      Questions: <a href="mailto:info@medx.hr" style="color:#9b1b22">info@medx.hr</a> · © Med&amp;X 2026, Zagreb
    </div>
  </div>
</div>`;
    }
    function oldHolderEmail(seat, toName, toEmail, movedEverything) {
        const f = galaFacts();
        return emailShell(`
      <p style="margin:0 0 14px">Dear <strong>${escapeHtml(seat.row.first_name || 'colleague')}</strong>,</p>
      <p style="margin:0 0 14px">Your seat at the <strong style="color:#9b1b22">${escapeHtml(f.title)}</strong> (${escapeHtml(f.date)}) has been transferred, at your request, to
      <strong>${escapeHtml(toName)}</strong> (${escapeHtml(toEmail)}).${movedEverything ? ' Every event portion on that registration moved with it.' : ''}</p>
      <p style="margin:0 0 14px">Your ticket and QR code for this seat <strong>no longer admit you</strong> — the same registration now belongs to your colleague, and this transfer cannot be undone from your side.</p>
      <p style="margin:0 0 14px">If you did not request this, write to <a href="mailto:info@medx.hr" style="color:#9b1b22">info@medx.hr</a> immediately.</p>
      <p style="margin:0">Warm regards,<br><strong>The Med&amp;X Team</strong></p>`);
    }
    function newHolderEmail(seat, toName, fromLabel, qrUrl) {
        const f = galaFacts();
        return emailShell(`
      <p style="margin:0 0 14px">Dear <strong>${escapeHtml(toName)}</strong>,</p>
      <p style="margin:0 0 14px"><strong>${escapeHtml(fromLabel)}</strong> has transferred their seat at the <strong style="color:#9b1b22">${escapeHtml(f.title)}</strong> to you — welcome.</p>
      <p style="margin:0 0 14px"><strong>${escapeHtml(f.date)}</strong> · ${escapeHtml(f.time)} · ${escapeHtml(f.venue)}<br>${escapeHtml(f.dress)}</p>
      <p style="margin:0 0 14px">The seat is now registered under your name. Your entry QR code — shown at the door — is here:<br>
      <a href="${escapeHtml(qrUrl)}" style="color:#9b1b22;font-weight:bold">${escapeHtml(qrUrl)}</a></p>
      <p style="margin:0 0 14px">Phone wallet passes (Apple / Google) arrive with this QR through the Med&amp;X member portal — sign in (or create a free account) with this e-mail address and the ticket appears in <strong>My Med&amp;X</strong>.</p>
      <p style="margin:0">Warm regards,<br><strong>The Med&amp;X Team</strong></p>`);
    }

    // ---------------------------------------------------------------- POST /api/v2/transfer/gala
    app.post('/api/v2/transfer/gala', auth, async (req, res) => {
        try {
            const user = me(req);
            const toName = String((req.body || {}).to_name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
            const toEmail = String((req.body || {}).to_email || '').trim().toLowerCase().slice(0, 160);
            if (toName.length < 2) return res.status(400).json({ error: "Your colleague's full name is needed." });
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) return res.status(400).json({ error: "A valid e-mail address for your colleague is needed." });

            const seat = findSeat(user);
            if (!seat) return res.status(404).json({ error: 'No Gala seat was found on your account.' });
            const holderEmail = String(seat.row.email || '').toLowerCase();
            if (toEmail === holderEmail) return res.status(400).json({ error: 'That is the e-mail the seat is already registered to.' });

            // Checked-in seats stay where they are (kind 'ca' rows have no gala check-in column —
            // check-in always lands on the linked gala_registrations row, resolved above).
            if (Number(seat.row.checked_in) === 1) {
                return res.status(409).json({ error: 'This seat has already been checked in at the event — it can no longer be transferred.' });
            }

            // One transfer per registration per 24 h (ISO-vs-ISO string compare — created_at is written as toISOString below;
            // seed/legacy rows in CURRENT_TIMESTAMP form compare safely too: both sort lexicographically by date first).
            const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
            const recent = tryGet(`SELECT id, created_at FROM v2_seat_transfers
                                    WHERE registration_ref = ? AND replace(substr(created_at, 1, 19), 'T', ' ') > ?
                                    ORDER BY created_at DESC LIMIT 1`, [seat.row.id, cutoff]);
            if (recent) return res.status(429).json({ error: 'This seat was transferred within the last 24 hours — one transfer per day per seat. Try again later or message us.' });

            const newUser = tryGet('SELECT id FROM users WHERE lower(email) = ?', [toEmail]);
            const newUserId = (newUser && newUser.id) || null;
            const nm = splitName(toName);
            let movedEverything = false;   // kind 'ca' only: conference/bridges portions ride along on the one row

            if (seat.kind === 'gala') {
                q.run('UPDATE gala_registrations SET first_name = ?, last_name = ?, email = ?, user_id = ? WHERE id = ?',
                    [nm.first, nm.last, toEmail, newUserId, seat.row.id]);
                if (seat.ca) {
                    const galaOnly = !Number(seat.ca.selected_conference) && !Number(seat.ca.selected_bridges);
                    if (galaOnly) {
                        // The CA row is the QR payload for this seat — same person moves on it.
                        q.run('UPDATE croatians_abroad_registrations SET first_name = ?, last_name = ?, email = ?, user_id = ? WHERE id = ?',
                            [nm.first, nm.last, toEmail, newUserId, seat.ca.id]);
                    } else {
                        // Conference/bridges stay with the old holder — detach the gala portion so
                        // /qr/<gala_id>.png falls through to the standalone gala payload (new holder).
                        q.run('UPDATE croatians_abroad_registrations SET selected_gala = 0, gala_registration_id = NULL WHERE id = ?', [seat.ca.id]);
                    }
                }
            } else {
                movedEverything = Number(seat.row.selected_conference) === 1 || Number(seat.row.selected_bridges) === 1;
                q.run('UPDATE croatians_abroad_registrations SET first_name = ?, last_name = ?, email = ?, user_id = ? WHERE id = ?',
                    [nm.first, nm.last, toEmail, newUserId, seat.row.id]);
            }

            const transferId = crypto.randomUUID();
            q.run(`INSERT INTO v2_seat_transfers (id, kind, registration_ref, from_email, to_name, to_email, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'done', ?)`,
                [transferId, seat.kind, seat.row.id, holderEmail || user.email, toName, toEmail, new Date().toISOString()]);
            syncSoon();

            // Two confirmations — the transfer is already committed, so a mail hiccup never fails it.
            // ctx.sendEmail only: on staging both land in EMAIL_DUMP_DIR as .html files.
            const qrUrl = `${publicBase()}/qr/${seat.row.id}.png`;
            const fromLabel = (`${seat.row.first_name || ''} ${seat.row.last_name || ''}`.trim()) || holderEmail || 'A colleague';
            const emails = { old_holder: false, new_holder: false };
            try {
                const r1 = await sendEmail(holderEmail || user.email, 'Your Gala seat has been transferred', oldHolderEmail(seat, toName, toEmail, movedEverything));
                emails.old_holder = !(r1 && r1.success === false);
            } catch (e) { log('old-holder email failed:', e.message); }
            try {
                const r2 = await sendEmail(toEmail, `Your seat — ${galaFacts().title}`, newHolderEmail(seat, toName, fromLabel, qrUrl));
                emails.new_holder = !(r2 && r2.success === false);
            } catch (e) { log('new-holder email failed:', e.message); }

            log(`seat ${seat.row.id} (${seat.kind}) ${holderEmail} → ${toEmail}`);
            res.json({ success: true, transfer_id: transferId, kind: seat.kind, registration_ref: seat.row.id, to_name: toName, to_email: toEmail, moved_everything: movedEverything, emails });
        } catch (e) {
            log('transfer failed:', e.message);
            res.status(500).json({ error: 'The transfer could not be completed. Try again, or message us and we sort it out.' });
        }
    });
};
