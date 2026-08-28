/**
 * v2/wallet.js — My Med&X wallet services for frontend-v2 (js/views/me.js).
 * Mounted by v2/index.js under /api/v2/wallet/…  (member JWT via ctx.auth on every route).
 *
 * What lives here (nothing existing is changed; server.js routes stay the source of truth
 * for QR hosting (/qr/:id.png), Google wallet passes (/api/member/wallet/*) and rewards):
 *   GET  /api/v2/wallet/member            — member-card facts + what the member QR encodes
 *   GET  /api/v2/wallet/member-qr.png     — the ONE member QR (PNG; Bearer-auth, fetched as a blob)
 *   GET  /api/v2/wallet/card.pdf          — member-card PDF (DOWNLOAD CARD)
 *   GET  /api/v2/wallet/card/pass         — Apple gate for the member card (?provider=apple)
 *   GET  /api/v2/wallet/tickets           — unified enriched ticket/order list across all 5 tables
 *   GET  /api/v2/wallet/tickets/:id.pdf   — per-ticket PDF (event facts + the frozen QR payload)
 *   POST /api/v2/wallet/tickets/:id/email — e-mail the ticket to the signed-in member (ctx.sendEmail)
 *   GET  /api/v2/wallet/tickets/:id/pass  — per-ticket wallet pass (?provider=google|apple; env-gated)
 *   GET  /api/v2/wallet/receipts/:id.pdf  — receipt PDF for PAID items (invoices + payment_transactions)
 *   GET  /api/v2/wallet/confirmations/:id.pdf — registration confirmation for free/confirmed items
 *   GET  /api/v2/wallet/certificates/:id.pdf  — attendance-certificate PDF (org signature included)
 *
 * MEMBER QR — what it encodes and how the admin scanner verifies it
 * (admin-portal/backend/server.js: POST /api/admin/checkin/ticket › resolveRegFromCode :32372,
 *  legacy POST /api/admin/checkin/verify :32848, enrichment GET /api/admin/scan-context :11380):
 *   1) Member HAS a conference registration → the QR is the RAW `registrations.checkin_token`
 *      (48-hex crypto token; minted here when missing — same memberEnsureRegToken pattern the
 *      member Google-ticket route uses). The unified scanner resolves the token to the
 *      registrations row and passAccess() admits them to conference AND gala/bridges/donor when a
 *      matching registration exists by e-mail — "jedna karta, sva vrata".
 *   2) No conference registration but another registration exists → slim JSON
 *      {type:'MEDX_MEMBER', regId, evt, email} — byte-compatible with the hosted /qr/:id.png
 *      payload. The unified scanner parses {regId}; the legacy per-event verify (which the admin
 *      scanner falls back to) resolves regId (UUID) or the e-mail.
 *   3) No registrations at all → {type:'MEDX_MEMBER', userId, email} — identity only. The legacy
 *      verify's e-mail fallback resolves any registration created LATER under the same address,
 *      and /api/admin/scan-context enriches by userId/email.
 *
 * Every ticket/receipt/certificate route resolves the item ACROSS tables and enforces ownership
 * (registrations.user_id = caller, or the row's e-mail equals the caller's account e-mail).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');

module.exports = function mountWallet(app, ctx) {
    const { auth, sendEmail, ROOT, log } = ctx;
    const QRCode = require('qrcode');
    const PDFDocument = require('pdfkit');
    const wallet = require(path.join(ROOT, 'shared', 'wallet.js'));

    // ---- sql.js-wrapper helpers (ctx.db() → prepare/bind/step/getAsObject/free, run) ----
    const q = {
        get(sql, params = []) {
            const stmt = ctx.db().prepare(sql);
            if (params.length) stmt.bind(params);
            if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
            stmt.free(); return null;
        },
        all(sql, params = []) {
            const stmt = ctx.db().prepare(sql);
            if (params.length) stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            stmt.free(); return rows;
        },
        run(sql, params = []) { ctx.db().run(sql, params); }
    };
    const tryGet = (sql, params) => { try { return q.get(sql, params); } catch (e) { return null; } };
    const tryAll = (sql, params) => { try { return q.all(sql, params); } catch (e) { return []; } };

    // ---- brand + shared bits ----
    const INK = '#191512', CREAM = '#f7f1e6', CARD = '#fdfaf3', CRIMSON = '#9b1b22', GOLD = '#c9a962', SOFT = '#4a4239';
    const ORG_LINE = '© Med&X 2026 · Zagreb';
    const FONT_BODY = path.join(ROOT, 'shared', 'fonts', 'DejaVuSans.ttf');
    const FONT_BOLD = path.join(ROOT, 'shared', 'fonts', 'DejaVuSans-Bold.ttf');
    const LOGO_DARKBG = path.join(ROOT, 'user-portal', 'frontend-v2', 'assets', 'logo-white.png'); // for ink surfaces
    const LOGO_LIGHTBG = path.join(ROOT, 'user-portal', 'frontend-v2', 'assets', 'logo.png');      // for cream surfaces
    const TRANSLIT = { 'č': 'c', 'ć': 'c', 'đ': 'd', 'š': 's', 'ž': 'z', 'Č': 'C', 'Ć': 'C', 'Đ': 'D', 'Š': 'S', 'Ž': 'Z' };
    function fonts(doc) {
        try {
            if (fs.existsSync(FONT_BODY)) {
                doc.registerFont('MXBody', FONT_BODY);
                doc.registerFont('MXBold', fs.existsSync(FONT_BOLD) ? FONT_BOLD : FONT_BODY);
                return { body: 'MXBody', bold: 'MXBold', safe: t => String(t == null ? '' : t) };
            }
        } catch (e) { /* fall through to the built-ins */ }
        return { body: 'Helvetica', bold: 'Helvetica-Bold', safe: t => String(t == null ? '' : t).replace(/[čćđšžČĆĐŠŽ]/g, c => TRANSLIT[c] || c) };
    }
    function baseUrl(req) {
        return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    }
    const eur = n => '€' + (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2));
    function longDate(d) {
        if (!d) return '';
        try { return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return String(d); }
    }
    function dateRange(a, b) {
        if (!a) return '';
        if (!b || String(b).slice(0, 10) === String(a).slice(0, 10)) return longDate(a);
        const da = new Date(String(a).slice(0, 10) + 'T12:00:00'), db_ = new Date(String(b).slice(0, 10) + 'T12:00:00');
        if (da.getMonth() === db_.getMonth() && da.getFullYear() === db_.getFullYear()) {
            return da.toLocaleDateString('en-GB', { month: 'long' }) + ' ' + da.getDate() + '–' + db_.getDate() + ', ' + da.getFullYear();
        }
        return longDate(a) + ' – ' + longDate(b);
    }
    const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function me(req) {
        const u = tryGet('SELECT id, email, first_name, last_name, institution, created_at FROM users WHERE id = ?', [req.user.id]);
        if (!u) return { id: req.user.id, email: (req.user.email || '').toLowerCase(), first_name: '', last_name: '' };
        u.email = String(u.email || '').toLowerCase();
        return u;
    }
    const fullName = u => (((u.first_name || '') + ' ' + (u.last_name || '')).trim()) || 'Med&X Member';

    // ---------------------------------------------------------------- unified item resolution
    // One bag per registration row, whatever table it lives in. Ownership is part of the WHERE.
    function galaSettings() {
        return tryGet("SELECT title, date, time, venue FROM gala_settings WHERE id = 'default'") || {};
    }
    function bagFromPlexus(r) {
        const paid = r.payment_status === 'paid' || r.status === 'confirmed';
        const amount = Number(r.amount_paid || 0);
        return {
            kind: 'plexus', id: r.id, table: 'registrations', title: r.conference_name || 'Plexus Conference',
            ticket_name: r.ticket_name || r.registration_type || 'General', date: r.start_date, end_date: r.end_date,
            venue: [r.venue_name, r.venue_city].filter(Boolean).join(', '), guest_name: ((r.first_name || r.u_first || '') + ' ' + (r.last_name || r.u_last || '')).trim(),
            email: (r.email || r.u_email || '').toLowerCase(), user_id: r.user_id,
            amount, free: !(amount > 0), paid, money: r.payment_status === 'paid', pending: !paid && amount > 0,
            status: Number(r.revoked) ? 'revoked' : (r.status === 'cancelled' ? 'cancelled' : (paid ? (amount > 0 && r.payment_status === 'paid' ? 'paid' : 'confirmed') : 'pending')),
            invoice_number: r.invoice_number || null, order_date: r.created_at, checked_in: !!r.checked_in,
            calendar: '/calendar/plexus.ics', checkin_token: r.checkin_token || null, includes_gala: !!Number(r.includes_gala)
        };
    }
    function bagFromGala(r) {
        const g = galaSettings();
        const paid = r.payment_status === 'paid' || r.payment_status === 'vip-comp';
        const confirmed = paid || ['confirmed', 'approved', 'vip-comp'].includes(String(r.status || ''));
        const amount = Number(r.amount_paid || 0);
        return {
            kind: 'gala', id: r.id, table: 'gala_registrations', title: g.title || 'Gala Evening',
            ticket_name: r.pricing === 'bundle' ? 'Gala seat · bundle' : 'Gala seat', date: g.date || null, end_date: null, time: g.time || null,
            venue: g.venue || '', guest_name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(), email: (r.email || '').toLowerCase(), user_id: r.user_id,
            amount, free: false, paid, money: paid, pending: !confirmed || (!paid && String(r.status || '') === 'awaiting_payment'),
            status: String(r.status || '') === 'cancelled' ? 'cancelled' : (paid ? (r.payment_status === 'vip-comp' ? 'vip' : 'paid') : (confirmed ? 'confirmed' : 'pending')),
            invoice_number: r.invoice_number || null, order_date: r.created_at, checked_in: !!r.checked_in, calendar: null
        };
    }
    function bagFromBridges(r) {
        return {
            kind: r.slug === 'donor-night' ? 'donor' : 'bridges', id: r.id, table: 'bridges_registrations',
            title: r.event_name || 'Building Bridges', ticket_name: 'Registration', date: r.event_date, end_date: null, time: r.event_time || null,
            venue: [r.venue_name, r.city].filter(Boolean).join(', '), guest_name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(),
            email: (r.email || '').toLowerCase(), user_id: r.user_id || null,
            amount: Number(r.amount_paid || 0), free: !(Number(r.amount_paid || 0) > 0), paid: true, money: r.payment_status === 'paid' && Number(r.amount_paid || 0) > 0, pending: false,
            status: String(r.status || '') === 'cancelled' ? 'cancelled' : 'confirmed',
            invoice_number: null, order_date: r.registered_at, checked_in: !!r.checked_in, calendar: null
        };
    }
    function bagFromForum(r) {
        const paid = r.payment_status === 'paid' || !r.payment_status;
        return {
            kind: 'forum', id: r.id, table: 'forum_event_registrations', title: r.event_title || 'Biomedical Forum',
            ticket_name: r.ticket_type || 'Forum', date: r.event_date, end_date: null, venue: r.venue || '',
            guest_name: (r.name || ((r.first_name || '') + ' ' + (r.last_name || '')).trim()), email: (r.email || '').toLowerCase(), user_id: null,
            amount: Number(r.payment_amount || 0), free: !(Number(r.payment_amount || 0) > 0), paid, money: r.payment_status === 'paid' && Number(r.payment_amount || 0) > 0, pending: !paid,
            status: String(r.status || '') === 'cancelled' ? 'cancelled' : (paid ? 'confirmed' : 'pending'),
            invoice_number: r.invoice_number || null, order_date: r.registered_at, checked_in: !!r.checked_in, calendar: null
        };
    }
    function bagFromSignup(r) {
        return {
            kind: 'signup-form', id: r.id, table: 'signup_form_responses', title: r.form_title || 'Med&X event',
            ticket_name: 'Registration', date: r.event_date, end_date: null, time: r.event_time || null, venue: r.venue || '',
            guest_name: r.name || '', email: (r.email || '').toLowerCase(), user_id: null,
            amount: 0, free: true, paid: !r.is_waitlisted, money: false, pending: false, waitlisted: !!r.is_waitlisted,
            status: r.is_waitlisted ? 'waitlisted' : 'confirmed', invoice_number: null, order_date: r.created_at,
            checked_in: !!r.checked_in, calendar: r.event_date && r.slug ? `/f/${r.slug}/calendar.ics` : null
        };
    }

    function allItems(user) {
        const em = user.email || '__none__';
        const items = [];
        tryAll(`SELECT r.*, c.name AS conference_name, c.start_date, c.end_date, c.venue_name, c.venue_city,
                       t.name AS ticket_name, u.first_name AS u_first, u.last_name AS u_last, u.email AS u_email
                  FROM registrations r JOIN conferences c ON r.conference_id = c.id
                  LEFT JOIN ticket_types t ON r.ticket_type_id = t.id
                  LEFT JOIN users u ON r.user_id = u.id
                 WHERE r.user_id = ? OR lower(r.email) = ?`, [user.id, em]).forEach(r => items.push(bagFromPlexus(r)));
        tryAll(`SELECT * FROM gala_registrations WHERE (user_id = ? OR lower(email) = ?)
                 AND COALESCE(status,'') NOT IN ('rejected','declined','cancelled')`, [user.id, em]).forEach(r => items.push(bagFromGala(r)));
        tryAll(`SELECT br.*, e.name AS event_name, e.event_date, e.event_time, e.venue_name, e.city, e.slug
                  FROM bridges_registrations br JOIN bridges_events e ON br.event_id = e.id
                 WHERE (br.user_id = ? OR lower(br.email) = ?) AND COALESCE(br.status,'') <> 'cancelled'`, [user.id, em]).forEach(r => items.push(bagFromBridges(r)));
        tryAll(`SELECT fer.*, fe.title AS event_title, COALESCE(fe.start_date, '') AS event_date, fe.venue
                  FROM forum_event_registrations fer JOIN forum_events fe ON fer.event_id = fe.id
                 WHERE lower(fer.email) = ?`, [em]).forEach(r => items.push(bagFromForum(r)));
        tryAll(`SELECT sr.*, sf.title AS form_title, sf.event_date, sf.event_time, sf.venue, sf.slug
                  FROM signup_form_responses sr JOIN signup_forms sf ON sr.form_id = sf.id
                 WHERE lower(sr.email) = ?`, [em]).forEach(r => items.push(bagFromSignup(r)));
        return items;
    }

    // Resolve ONE item by id, ownership enforced in each WHERE (404 otherwise).
    function findItem(id, user) {
        const em = user.email || '__none__';
        let r = tryGet(`SELECT r.*, c.name AS conference_name, c.start_date, c.end_date, c.venue_name, c.venue_city,
                               t.name AS ticket_name, u.first_name AS u_first, u.last_name AS u_last, u.email AS u_email
                          FROM registrations r JOIN conferences c ON r.conference_id = c.id
                          LEFT JOIN ticket_types t ON r.ticket_type_id = t.id
                          LEFT JOIN users u ON r.user_id = u.id
                         WHERE r.id = ? AND (r.user_id = ? OR lower(r.email) = ?)`, [id, user.id, em]);
        if (r) return bagFromPlexus(r);
        r = tryGet('SELECT * FROM gala_registrations WHERE id = ? AND (user_id = ? OR lower(email) = ?)', [id, user.id, em]);
        if (r) return bagFromGala(r);
        r = tryGet(`SELECT br.*, e.name AS event_name, e.event_date, e.event_time, e.venue_name, e.city, e.slug
                      FROM bridges_registrations br JOIN bridges_events e ON br.event_id = e.id
                     WHERE br.id = ? AND (br.user_id = ? OR lower(br.email) = ?)`, [id, user.id, em]);
        if (r) return bagFromBridges(r);
        r = tryGet(`SELECT fer.*, fe.title AS event_title, COALESCE(fe.start_date,'') AS event_date, fe.venue
                      FROM forum_event_registrations fer JOIN forum_events fe ON fer.event_id = fe.id
                     WHERE fer.id = ? AND lower(fer.email) = ?`, [id, em]);
        if (r) return bagFromForum(r);
        r = tryGet(`SELECT sr.*, sf.title AS form_title, sf.event_date, sf.event_time, sf.venue, sf.slug
                      FROM signup_form_responses sr JOIN signup_forms sf ON sr.form_id = sf.id
                     WHERE sr.id = ? AND lower(sr.email) = ?`, [id, em]);
        if (r) return bagFromSignup(r);
        return null;
    }

    // The frozen QR payload for one item — byte-compatible with GET /qr/:id.png in server.js
    // (the scanner keys on regId/evt; the CA linkage for gala rows is honoured).
    function qrPayloadFor(item) {
        if (item.kind === 'gala') {
            const ca = tryGet('SELECT * FROM croatians_abroad_registrations WHERE id = ? OR gala_registration_id = ?', [item.id, item.id]);
            if (ca) {
                const events = [ca.selected_conference ? 'conference' : null, ca.selected_bridges ? 'bridges' : null, ca.selected_gala ? 'gala' : null].filter(Boolean);
                const p = { type: 'MEDX_MEMBER', caRegId: ca.id, regId: ca.gala_registration_id || ca.id, email: ca.email, name: `${ca.first_name} ${ca.last_name || ''}`.trim(), evt: ca.selected_gala ? 'gala' : 'croatians-abroad', evtName: ca.selected_gala ? 'Plexus 2026 — Gala Evening' : 'Plexus 2026', events };
                if (ca.amount_paid) p.amt = ca.amount_paid;
                if (ca.dietary) p.diet = ca.dietary;
                return p;
            }
            return { type: 'MEDX_MEMBER', regId: item.id, evt: 'gala' };
        }
        const EVT = { plexus: 'plexus', bridges: 'bridges', donor: 'bridges', forum: 'forum', 'signup-form': 'signup-form' };
        return { type: 'MEDX_MEMBER', regId: item.id, evt: EVT[item.kind] || item.kind };
    }
    function qrBuffer(value, width) {
        const data = typeof value === 'string' ? value : JSON.stringify(value);
        return QRCode.toBuffer(data, { errorCorrectionLevel: 'L', width: width || 560, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    }

    // ---------------------------------------------------------------- member QR (jedna karta, sva vrata)
    function ensureRegToken(reg) {
        if (reg && reg.checkin_token) return reg.checkin_token;
        const tok = crypto.randomBytes(24).toString('hex');
        q.run('UPDATE registrations SET checkin_token = ? WHERE id = ?', [tok, reg.id]);
        reg.checkin_token = tok;
        return tok;
    }
    // → { value, kind, reg_id?, evt? }  (see the header comment for the scanner contract)
    function memberQr(user) {
        const reg = tryGet(`SELECT r.id, r.checkin_token FROM registrations r
                              JOIN conferences c ON r.conference_id = c.id
                             WHERE r.user_id = ? AND COALESCE(r.revoked,0) = 0 AND COALESCE(r.status,'') <> 'cancelled'
                             ORDER BY c.is_active DESC, c.year DESC, r.created_at DESC LIMIT 1`, [user.id]);
        if (reg) return { value: ensureRegToken(reg), kind: 'checkin_token', reg_id: reg.id, evt: 'conference' };
        const others = allItems(user).filter(i => !['cancelled', 'revoked', 'waitlisted'].includes(i.status))
            .sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || '')));
        if (others.length) {
            const it = others[0];
            const p = qrPayloadFor(it);
            if (!p.email && user.email) p.email = user.email;
            return { value: JSON.stringify(p), kind: 'registration', reg_id: it.id, evt: it.kind };
        }
        return { value: JSON.stringify({ type: 'MEDX_MEMBER', userId: user.id, email: user.email || '' }), kind: 'identity' };
    }
    function memberMeta(user) {
        const TYPE = { student: 'Student', physician: 'Physician', senior_forum: 'Senior Forum Member', alumni: 'Alumni' };
        const STANDING = { good_standing: 'Member in good standing', pending: 'Standing under review', lapsed: 'Membership lapsed' };
        const m = tryGet('SELECT member_type, member_since, standing FROM member_meta WHERE user_id = ?', [user.id]) || {};
        const sinceRaw = m.member_since || user.created_at || '';
        return {
            type: m.member_type || 'member',
            type_label: TYPE[m.member_type] || 'Member',
            since_year: sinceRaw ? String(sinceRaw).slice(0, 4) : String(new Date().getFullYear()),
            standing: m.standing || 'good_standing',
            standing_label: STANDING[m.standing] || 'Member in good standing'
        };
    }
    const memberNo = user => String(user.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();

    app.get('/api/v2/wallet/member', auth, (req, res) => {
        try {
            const user = me(req);
            const meta = memberMeta(user);
            const qr = memberQr(user);
            res.json({
                name: fullName(user), first_name: user.first_name || '', last_name: user.last_name || '',
                member_no: memberNo(user), ...meta,
                qr: { kind: qr.kind, reg_id: qr.reg_id || null, evt: qr.evt || null }
            });
        } catch (e) { console.error('[v2 wallet] member failed:', e.message); res.status(500).json({ error: 'Could not load your member card' }); }
    });

    app.get('/api/v2/wallet/member-qr.png', auth, async (req, res) => {
        try {
            const user = me(req);
            const qr = memberQr(user);
            const png = await qrBuffer(qr.value, 560);
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'private, max-age=300');
            res.send(png);
        } catch (e) { console.error('[v2 wallet] member-qr failed:', e.message); res.status(500).json({ error: 'QR generation failed' }); }
    });

    // ---------------------------------------------------------------- PDF plumbing
    function pdfHeaders(res, filename) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]+/g, '-')}"`);
    }
    function pdfBuffer(opts, draw) {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument(opts);
            const out = new PassThrough();
            const chunks = [];
            out.on('data', c => chunks.push(c));
            out.on('end', () => resolve(Buffer.concat(chunks)));
            out.on('error', reject);
            doc.pipe(out);
            Promise.resolve(draw(doc)).then(() => doc.end()).catch(reject);
        });
    }
    function logoOn(doc, file, x, y, h) {
        try { if (fs.existsSync(file)) { doc.image(file, x, y, { height: h }); return true; } } catch (e) { }
        return false;
    }
    // ink header band + gold rule (Emails.dc.html vocabulary, print edition)
    function headerBand(doc, F, tagline, ruleColor) {
        const W = doc.page.width;
        doc.rect(0, 0, W, 86).fill(INK);
        if (!logoOn(doc, LOGO_DARKBG, 50, 33, 20)) doc.font(F.bold).fontSize(16).fillColor(CREAM).text('med&X', 50, 33);
        doc.font(F.bold).fontSize(7.5).fillColor(GOLD).text(tagline, W - 250, 39, { width: 200, align: 'right', characterSpacing: 1.6 });
        doc.rect(0, 86, W, 3).fill(ruleColor || GOLD);
    }
    function footerLine(doc, F, extra) {
        const W = doc.page.width, H = doc.page.height;
        doc.moveTo(50, H - 64).lineTo(W - 50, H - 64).lineWidth(0.5).strokeColor('#d9d2c5').stroke();
        doc.font(F.body).fontSize(8.5).fillColor(SOFT).text(F.safe(ORG_LINE + (extra ? ' · ' + extra : '')), 50, H - 52, { width: W - 100 });
    }
    function factRow(doc, F, x, y, label, value, width) {
        doc.font(F.bold).fontSize(7).fillColor(SOFT).text(label.toUpperCase(), x, y + 2, { characterSpacing: 1.4 });
        doc.font(F.body).fontSize(10.5).fillColor(INK).text(F.safe(value), x + 78, y, { width: (width || 330) - 78 });
        return Math.max(doc.y, y + 16) + 6;
    }

    // ---------------------------------------------------------------- member card PDF (DOWNLOAD CARD)
    async function drawMemberCard(doc, user) {
        const F = fonts(doc);
        const meta = memberMeta(user);
        const qr = memberQr(user);
        const png = await qrBuffer(qr.value, 480);
        const W = doc.page.width, H = doc.page.height;
        doc.rect(0, 0, W, H).fill(INK);
        doc.rect(9, 9, W - 18, H - 18).lineWidth(1).strokeColor('rgba(201,169,98,0.55)').strokeOpacity(0.55).strokeColor(GOLD).stroke();
        doc.strokeOpacity(0.2).rect(12, 12, W - 24, H - 24).lineWidth(0.75).strokeColor(GOLD).stroke();
        doc.strokeOpacity(1);
        if (!logoOn(doc, LOGO_DARKBG, 26, 24, 15)) doc.font(F.bold).fontSize(13).fillColor(CREAM).text('med&X', 26, 24);
        doc.font(F.bold).fontSize(6.5).fillColor(GOLD).text('MEMBER CARD · 2026', W - 146, 28, { width: 120, align: 'right', characterSpacing: 1.6 });
        doc.rect(26, 58, 34, 1).fill(GOLD);
        doc.font(F.bold).fontSize(6).fillColor(CREAM).opacity(0.5).text('MEMBER', 26, 70, { characterSpacing: 1.6 });
        doc.opacity(1).font(F.bold).fontSize(17).fillColor(CREAM).text(F.safe(fullName(user)), 26, 80, { width: W - 160 });
        doc.font(F.body).fontSize(8).fillColor(CREAM).opacity(0.65)
            .text(F.safe(`${meta.type_label} · Member since ${meta.since_year}`), 26, doc.y + 3, { width: W - 160 });
        doc.opacity(1);
        const chipY = doc.y + 8;
        const chipText = meta.standing_label.toUpperCase();
        doc.font(F.bold).fontSize(6);
        const chipW = doc.widthOfString(chipText, { characterSpacing: 1.2 }) + 14;
        doc.rect(26, chipY, chipW, 14).fillOpacity(0.16).fill(GOLD);
        doc.fillOpacity(1).fillColor(GOLD).text(chipText, 33, chipY + 4.5, { characterSpacing: 1.2 });
        // QR plate (cream) right
        const qs = 92;
        doc.rect(W - qs - 26, 66, qs, qs).fill(CREAM);
        doc.image(png, W - qs - 26 + 7, 73, { width: qs - 14, height: qs - 14 });
        // foot
        doc.moveTo(26, H - 36).lineTo(W - 26, H - 36).lineWidth(0.5).strokeColor(CREAM).strokeOpacity(0.14).stroke();
        doc.strokeOpacity(1);
        doc.font(F.bold).fontSize(6.5).fillColor(CREAM).opacity(0.45).text(`N° ${memberNo(user)}`, 26, H - 28, { characterSpacing: 1.6 });
        doc.font(F.bold).fontSize(6).text('FAST CHECK-IN AT MED&X EVENTS', W - 226, H - 27.5, { width: 200, align: 'right', characterSpacing: 1.4 });
        doc.opacity(1);
        // back-of-card motto strip
        doc.font(F.body).fontSize(7.5).fillColor(GOLD).text(F.safe('Jedna karta, sva vrata.'), 26, H - 52, { oblique: true });
    }
    app.get('/api/v2/wallet/card.pdf', auth, async (req, res) => {
        try {
            const user = me(req);
            const buf = await pdfBuffer({ size: [360, 227], margin: 0 }, doc => drawMemberCard(doc, user)); // ≈127×80 mm card
            pdfHeaders(res, 'medx-member-card.pdf');
            res.send(buf);
        } catch (e) { console.error('[v2 wallet] card.pdf failed:', e.message); res.status(500).json({ error: 'Could not build the card PDF' }); }
    });

    // Member-card phone-wallet gate (Apple side; Google uses the existing GET /api/member/wallet/google).
    app.get('/api/v2/wallet/card/pass', auth, (req, res) => {
        const provider = req.query.provider === 'google' ? 'google' : 'apple';
        if (provider === 'google') {
            if (!wallet.isConfigured()) return res.json({ configured: false, provider, message_en: 'Google Wallet is not set up yet. Your team can enable it shortly.' });
            return res.json({ configured: false, provider, message_en: 'Use /api/member/wallet/google for the membership pass.' });
        }
        return res.json({ configured: false, provider: 'apple', reason: 'apple_pkpass_not_implemented', message_en: 'Apple Wallet is coming soon.' });
    });

    // ---------------------------------------------------------------- ticket list
    app.get('/api/v2/wallet/tickets', auth, (req, res) => {
        try {
            const user = me(req);
            const items = allItems(user).map(it => ({
                ...it,
                ticket: (it.paid || it.free) && !it.waitlisted && it.status !== 'cancelled' && it.status !== 'revoked' ? `/qr/${it.id}.png` : null,
                receipt: it.amount > 0 && it.money ? 'receipt' : (['confirmed', 'paid', 'vip'].includes(it.status) || it.checked_in ? 'confirmation' : null),
                can_wallet: it.table === 'registrations'
            }));
            const today = new Date().toISOString().slice(0, 10);
            const active = items.filter(i => !['cancelled', 'revoked'].includes(i.status));
            const upcoming = active.filter(i => !i.date || String(i.date).slice(0, 10) >= today)
                .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
            // "Past purchases" = the order history: every completed order (paid or free-confirmed),
            // newest order first — receipts and confirmations live here (README: receipts
            // downloadable from past purchases; with every 2026 event still ahead this is the only
            // reachable home for a receipt).
            const purchases = active.filter(i => i.receipt)
                .sort((a, b) => String(b.order_date || '').localeCompare(String(a.order_date || '')));
            res.json({ items, upcoming, purchases, count: active.length, generated_at: new Date().toISOString() });
        } catch (e) { console.error('[v2 wallet] tickets failed:', e.message); res.status(500).json({ error: 'Failed to load your tickets' }); }
    });

    // ---------------------------------------------------------------- ticket PDF
    async function drawTicket(doc, item, user, opts = {}) {
        const F = fonts(doc);
        const W = doc.page.width;
        headerBand(doc, F, 'MEMBER PORTAL', opts.confirmation ? CRIMSON : GOLD);
        doc.font(F.bold).fontSize(8).fillColor(GOLD).text(opts.confirmation ? 'REGISTRATION CONFIRMED' : "YOU'RE GOING", 50, 118, { characterSpacing: 2 });
        doc.font(F.bold).fontSize(23).fillColor(INK).text(F.safe(item.title), 50, 134, { width: W - 100 });
        // ticket card
        const cardY = doc.y + 18, cardH = 158;
        doc.rect(50, cardY, W - 100, cardH).fill(CARD);
        doc.rect(50, cardY, W - 100, cardH).lineWidth(1).strokeColor(GOLD).stroke();
        let y = cardY + 20;
        const when = dateRange(item.date, item.end_date) + (item.time ? ` · ${item.time}` : '');
        y = factRow(doc, F, 74, y, 'Event', item.title, 300);
        y = factRow(doc, F, 74, y, 'When', when || 'To be announced', 300);
        y = factRow(doc, F, 74, y, 'Where', item.venue || 'To be announced', 300);
        y = factRow(doc, F, 74, y, 'Guest', item.guest_name || fullName(user), 300);
        y = factRow(doc, F, 74, y, 'Ticket', item.ticket_name + (item.amount > 0 ? ` · ${eur(item.amount)}` : ' · Free entry'), 300);
        factRow(doc, F, 74, y, 'N°', item.invoice_number || String(item.id).slice(0, 8).toUpperCase(), 300);
        // QR right
        const png = await qrBuffer(qrPayloadFor(item), 480);
        const qs = 118;
        doc.rect(W - 50 - qs - 20, cardY + (cardH - qs - 20) / 2, qs + 20, qs + 20).fill('#ffffff');
        doc.rect(W - 50 - qs - 20, cardY + (cardH - qs - 20) / 2, qs + 20, qs + 20).lineWidth(0.75).strokeColor('#d9d2c5').stroke();
        doc.image(png, W - 50 - qs - 10, cardY + (cardH - qs - 20) / 2 + 10, { width: qs, height: qs });
        // status + notes
        const statusLabel = ({ paid: 'PAID', vip: 'VIP · COMPLIMENTARY', confirmed: 'CONFIRMED', pending: 'PAYMENT PENDING', waitlisted: 'WAITING LIST' })[item.status] || item.status.toUpperCase();
        doc.font(F.bold).fontSize(8).fillColor(item.pending || item.waitlisted ? CRIMSON : '#2f6b3a').text(statusLabel, 50, cardY + cardH + 16, { characterSpacing: 1.6 });
        doc.font(F.body).fontSize(10).fillColor(SOFT).text(F.safe(opts.confirmation
            ? 'This confirms your registration. Free registrations come with a confirmation rather than a monetary receipt.'
            : 'Present this code at the entrance. Your member QR admits you at every door — it also lives in My Med&X.'),
            50, cardY + cardH + 34, { width: W - 100, lineGap: 2 });
        if (item.checked_in) doc.font(F.body).fontSize(9.5).fillColor(SOFT).text('Checked in — welcome again any time the doors are open.', 50, doc.y + 6, { width: W - 100 });
        footerLine(doc, F, 'Questions? Message us from the portal — replies land in your inbox.');
    }
    app.get('/api/v2/wallet/tickets/:id.pdf', auth, async (req, res) => {
        try {
            const user = me(req);
            const item = findItem(String(req.params.id || ''), user);
            if (!item) return res.status(404).json({ error: 'We could not find that ticket on your account.' });
            if (item.waitlisted) return res.status(400).json({ error: 'You are on the waiting list — a ticket is issued once a place is confirmed.' });
            if (['cancelled', 'revoked'].includes(item.status)) return res.status(400).json({ error: 'This registration is no longer active.' });
            const buf = await pdfBuffer({ size: 'A4', margin: 0 }, doc => drawTicket(doc, item, user));
            pdfHeaders(res, `medx-ticket-${item.kind}-${String(item.id).slice(0, 8)}.pdf`);
            res.send(buf);
        } catch (e) { console.error('[v2 wallet] ticket.pdf failed:', e.message); res.status(500).json({ error: 'Could not build the ticket PDF' }); }
    });

    // ---------------------------------------------------------------- confirmation PDF (free items)
    app.get('/api/v2/wallet/confirmations/:id.pdf', auth, async (req, res) => {
        try {
            const user = me(req);
            const item = findItem(String(req.params.id || ''), user);
            if (!item) return res.status(404).json({ error: 'We could not find that registration on your account.' });
            if (['cancelled', 'revoked'].includes(item.status)) return res.status(400).json({ error: 'This registration is no longer active.' });
            const buf = await pdfBuffer({ size: 'A4', margin: 0 }, doc => drawTicket(doc, item, user, { confirmation: true }));
            pdfHeaders(res, `medx-confirmation-${String(item.id).slice(0, 8)}.pdf`);
            res.send(buf);
        } catch (e) { console.error('[v2 wallet] confirmation.pdf failed:', e.message); res.status(500).json({ error: 'Could not build the confirmation PDF' }); }
    });

    // ---------------------------------------------------------------- receipt PDF (paid items)
    app.get('/api/v2/wallet/receipts/:id.pdf', auth, async (req, res) => {
        try {
            const user = me(req);
            const item = findItem(String(req.params.id || ''), user);
            if (!item) return res.status(404).json({ error: 'We could not find that purchase on your account.' });
            if (!(item.amount > 0 && item.money)) {
                return res.status(400).json({ error: 'Free registrations come with a confirmation rather than a receipt.' });
            }
            const invoice = item.table === 'registrations' ? tryGet('SELECT * FROM invoices WHERE registration_id = ?', [item.id]) : null;
            const txn = item.table === 'registrations' ? tryGet('SELECT * FROM payment_transactions WHERE registration_id = ? ORDER BY created_at DESC', [item.id]) : null;
            let meta = {};
            try { meta = txn && txn.metadata ? JSON.parse(txn.metadata) : {}; } catch (e) { meta = {}; }
            // A hosted Stripe receipt takes precedence when the row carries one.
            const hosted = meta.receipt_url || meta.stripe_receipt_url || null;
            if (hosted && req.query.redirect === '1') return res.redirect(302, hosted);

            const buf = await pdfBuffer({ size: 'A4', margin: 0 }, async (doc) => {
                const F = fonts(doc);
                const W = doc.page.width;
                headerBand(doc, F, 'RECEIPT', GOLD);
                doc.font(F.bold).fontSize(8).fillColor(GOLD).text('PAYMENT RECEIVED', 50, 118, { characterSpacing: 2 });
                doc.font(F.bold).fontSize(23).fillColor(INK).text('Receipt', 50, 134);
                let y = 178;
                y = factRow(doc, F, 50, y, 'Receipt no.', item.invoice_number || (invoice && invoice.invoice_number) || String(item.id).slice(0, 8).toUpperCase(), 480);
                y = factRow(doc, F, 50, y, 'Order date', longDate((invoice && invoice.paid_at) || (txn && txn.created_at) || item.order_date), 480);
                const billing = meta.billing || {};
                const billName = billing.name || item.guest_name || fullName(user);
                const billLines = [billName, billing.company, billing.address, [billing.zip, billing.city].filter(Boolean).join(' '), billing.country, item.email || user.email].filter(Boolean).join('\n');
                doc.font(F.bold).fontSize(7).fillColor(SOFT).text('BILLED TO', 50, y + 2, { characterSpacing: 1.4 });
                doc.font(F.body).fontSize(10).fillColor(INK).text(F.safe(billLines), 128, y, { width: 340 });
                y = doc.y + 16;
                // item table
                doc.moveTo(50, y).lineTo(W - 50, y).lineWidth(0.5).strokeColor('#d9d2c5').stroke();
                y += 10;
                doc.font(F.bold).fontSize(7).fillColor(SOFT).text('DESCRIPTION', 50, y, { characterSpacing: 1.4 });
                doc.text('AMOUNT', W - 150, y, { width: 100, align: 'right', characterSpacing: 1.4 });
                y += 16;
                let rows = [];
                try { rows = invoice && invoice.items ? JSON.parse(invoice.items) : []; } catch (e) { rows = []; }
                if (!Array.isArray(rows) || !rows.length) rows = [{ description: `${item.title} — ${item.ticket_name}`, quantity: 1, price: item.amount }];
                rows.forEach(rw => {
                    const qty = Number(rw.quantity || 1);
                    doc.font(F.body).fontSize(10.5).fillColor(INK).text(F.safe((qty > 1 ? qty + ' × ' : '') + (rw.description || item.title)), 50, y, { width: W - 220 });
                    doc.text(eur(Number(rw.price != null ? rw.price : item.amount) * (qty > 1 ? qty : 1)), W - 150, y, { width: 100, align: 'right' });
                    y = doc.y + 8;
                });
                doc.moveTo(50, y).lineTo(W - 50, y).lineWidth(0.5).strokeColor('#d9d2c5').stroke();
                y += 12;
                const totalRow = (label, val, bold) => {
                    doc.font(bold ? F.bold : F.body).fontSize(bold ? 12 : 10).fillColor(bold ? INK : SOFT)
                        .text(label, W - 320, y, { width: 160, align: 'right' });
                    doc.text(val, W - 150, y, { width: 100, align: 'right' });
                    y += bold ? 20 : 16;
                };
                if (invoice && invoice.subtotal != null) {
                    totalRow('Subtotal', eur(invoice.subtotal));
                    totalRow(`VAT ${Number(invoice.vat_rate || 25)}%`, eur(invoice.vat_amount || 0));
                    totalRow('Total paid', eur(invoice.total != null ? invoice.total : item.amount), true);
                } else {
                    totalRow('Total paid', eur(item.amount), true);
                }
                const payBits = [];
                if (txn) payBits.push(`Paid by ${txn.payment_method || 'card'} via ${txn.payment_provider || 'Stripe'}`);
                if (txn && txn.provider_transaction_id) payBits.push(`ref ${txn.provider_transaction_id}`);
                if (meta.fira_invoice_number) payBits.push(`fiscal invoice ${meta.fira_invoice_number}`);
                if (payBits.length) doc.font(F.body).fontSize(9).fillColor(SOFT).text(F.safe(payBits.join(' · ')), 50, y + 6, { width: W - 100 });
                if (hosted) doc.font(F.body).fontSize(9).fillColor(CRIMSON).text(String(hosted), 50, doc.y + 6, { width: W - 100 });
                footerLine(doc, F, 'Med&X Association · Zagreb, Croatia');
            });
            pdfHeaders(res, `medx-receipt-${(item.invoice_number || String(item.id).slice(0, 8)).replace(/\s+/g, '')}.pdf`);
            res.send(buf);
        } catch (e) { console.error('[v2 wallet] receipt.pdf failed:', e.message); res.status(500).json({ error: 'Could not build the receipt PDF' }); }
    });

    // ---------------------------------------------------------------- e-mail the ticket to me
    function ticketEmailHtml(item, user, base) {
        const qrUrl = `${base}/qr/${item.id}.png`;
        const when = dateRange(item.date, item.end_date) + (item.time ? ` · ${item.time}` : '');
        const n = item.invoice_number || String(item.id).slice(0, 8).toUpperCase();
        const row = (k, v) => `<span style="display:flex;gap:10px;align-items:baseline"><span style="font:600 9px Inter,Arial,sans-serif;letter-spacing:.16em;color:#4a4239;width:64px">${k}</span><span style="font-size:13px;font-family:Georgia,serif">${escapeHtml(v)}</span></span>`;
        // 600px transactional shell — Emails.dc.html › "02 · TICKET CONFIRMATION", values live
        return `<!DOCTYPE html><html><body style="margin:0;background:#e9e2d2;font-family:Inter,Arial,sans-serif;color:#191512;padding:24px 0">
<div style="width:600px;max-width:100%;margin:0 auto;background:#f7f1e6;box-shadow:0 10px 34px rgba(25,21,18,.18)">
  <div style="background:#191512;padding:22px 40px;display:flex;align-items:center">
    <span style="font:600 16px Georgia,serif;color:#f7f1e6">med&amp;X</span>
    <div style="flex:1"></div>
    <span style="font:600 9px Inter,Arial,sans-serif;letter-spacing:.2em;color:#c9a962">MEMBER PORTAL</span>
  </div>
  <div style="height:2px;background:#c9a962"></div>
  <div style="padding:36px 40px 30px">
    <span style="font:600 10px Inter,Arial,sans-serif;letter-spacing:.18em;color:#c9a962">YOUR TICKET</span>
    <div style="font-family:Georgia,serif;font-size:28px;line-height:1.15;margin-top:10px">${escapeHtml(item.title)} — <i>${item.amount > 0 ? 'seat confirmed' : 'you are in'}</i>.</div>
    <div style="border:1px solid rgba(201,169,98,.65);background:#fdfaf3;margin-top:20px;padding:20px 24px;display:flex;gap:20px;align-items:center">
      <div style="flex:1;display:flex;flex-direction:column;gap:8px">
        ${row('EVENT', item.title)}
        ${row('WHEN', when || 'To be announced')}
        ${row('WHERE', item.venue || 'To be announced')}
        ${row('GUEST', (item.guest_name || fullName(user)) + ' · N° ' + n)}
      </div>
      <div style="width:104px;height:104px;background:#fff;flex:none;padding:7px;box-sizing:border-box;border:1px solid rgba(25,21,18,.16)">
        <img src="${qrUrl}" alt="Check-in QR" width="90" height="90" style="display:block;border:0">
      </div>
    </div>
    <div style="font-size:12.5px;color:#4a4239;line-height:1.6;margin-top:14px">Your member QR admits you at every door — it's also in <strong style="color:#191512">My Med&amp;X</strong>. The ticket PDF is attached.</div>
    <div style="text-align:center;margin:22px 0 4px">
      <a href="${base}/app/me" style="display:inline-block;padding:14px 30px;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,Arial,sans-serif;letter-spacing:.16em;text-decoration:none">OPEN MY TICKETS →</a>
    </div>
  </div>
  <div style="border-top:1px solid rgba(25,21,18,.16);padding:18px 40px;font-size:11px;color:#4a4239">
    <span>${escapeHtml(ORG_LINE)}</span> <span style="color:#c9a962">·</span> <span>Questions? Reply lands in your portal inbox.</span>
  </div>
</div></body></html>`;
    }
    app.post('/api/v2/wallet/tickets/:id/email', auth, async (req, res) => {
        try {
            const user = me(req);
            if (!user.email) return res.status(400).json({ error: 'No e-mail on this account.' });
            const item = findItem(String(req.params.id || ''), user);
            if (!item) return res.status(404).json({ error: 'We could not find that ticket on your account.' });
            if (item.waitlisted) return res.status(400).json({ error: 'You are on the waiting list — a ticket is issued once a place is confirmed.' });
            if (['cancelled', 'revoked'].includes(item.status)) return res.status(400).json({ error: 'This registration is no longer active.' });
            const base = baseUrl(req);
            const html = ticketEmailHtml(item, user, base);
            let atts = [];
            try {
                const pdf = await pdfBuffer({ size: 'A4', margin: 0 }, doc => drawTicket(doc, item, user));
                atts.push({ filename: `medx-ticket-${String(item.id).slice(0, 8)}.pdf`, content: pdf, type: 'application/pdf' });
            } catch (e) { /* the e-mail still carries the hosted QR */ }
            const r = await sendEmail(user.email, `Your ticket — ${item.title}`, html, atts);
            if (r && r.success === false) return res.status(502).json({ error: 'The mail service refused the message — try again shortly.' });
            res.json({ sent: true, to: user.email, mock: !!(r && r.mock) });
        } catch (e) { console.error('[v2 wallet] ticket email failed:', e.message); res.status(500).json({ error: 'Could not send the ticket' }); }
    });

    // ---------------------------------------------------------------- per-ticket phone-wallet pass
    app.get('/api/v2/wallet/tickets/:id/pass', auth, (req, res) => {
        try {
            const provider = req.query.provider === 'apple' ? 'apple' : 'google';
            const user = me(req);
            const item = findItem(String(req.params.id || ''), user);
            if (!item) return res.status(404).json({ error: 'We could not find that ticket on your account.' });
            if (provider === 'apple') {
                return res.json({ configured: false, provider: 'apple', reason: 'apple_pkpass_not_implemented', message_en: 'Apple Wallet is coming soon.' });
            }
            if (!wallet.isConfigured()) {
                return res.json({
                    configured: false, provider: 'google',
                    owner_action: 'Set GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SA_KEY in the server environment.',
                    message_en: 'Google Wallet is not set up yet. Your team can enable it shortly.'
                });
            }
            // Configured environments: registrations rows carry the crypto checkin_token; every
            // other kind uses the frozen /qr payload — both resolve at the door.
            const origin = baseUrl(req);
            let barcode;
            if (item.table === 'registrations') {
                const reg = q.get('SELECT id, checkin_token FROM registrations WHERE id = ?', [item.id]);
                barcode = ensureRegToken(reg);
            } else {
                barcode = JSON.stringify(qrPayloadFor(item));
            }
            const classId = wallet.classIdFor(item.kind + '-2026');
            const classBody = wallet.buildEventTicketClass({
                classId, issuerName: 'Med&X', eventName: item.title, venue: item.venue || null,
                startISO: item.date ? String(item.date).slice(0, 10) + 'T00:00:00Z' : null,
                logoUri: origin + '/assets/images/medx-logo.png', hexBackgroundColor: '#14100d', homepageUri: origin
            });
            const object = wallet.buildEventTicketObject({
                objectId: wallet.objectIdFor(item.id), classId, token: barcode,
                name: item.guest_name || fullName(user),
                registrationNumber: item.invoice_number || String(item.id).slice(0, 8).toUpperCase(),
                category: item.ticket_name, statusLabel: item.status,
                logoUri: origin + '/assets/images/medx-logo.png', hexBackgroundColor: '#14100d'
            });
            const { saveUrl } = wallet.buildSaveUrl({ classes: [classBody], objects: [object], origins: [origin] });
            Promise.resolve().then(() => wallet.ensureEventClass(classBody)).then(() => wallet.ensureEventObject(object))
                .catch(err => console.error('[v2 wallet] provision failed:', err.message));
            res.json({ configured: true, provider: 'google', save_url: saveUrl });
        } catch (e) { console.error('[v2 wallet] pass failed:', e.message); res.status(500).json({ error: 'Failed to build the wallet pass' }); }
    });

    // ---------------------------------------------------------------- certificate PDF
    app.get('/api/v2/wallet/certificates/:id.pdf', auth, async (req, res) => {
        try {
            const user = me(req);
            const cert = tryGet(`SELECT ct.*, r.user_id FROM certificates ct
                                   JOIN registrations r ON ct.registration_id = r.id
                                  WHERE ct.id = ? AND r.user_id = ?`, [String(req.params.id || ''), user.id]);
            if (!cert) return res.status(404).json({ error: 'We could not find that certificate on your account.' });
            let sig = null;
            const sigRow = tryGet("SELECT value FROM org_settings WHERE key = 'signature'");
            if (sigRow && /^data:image\/png;base64,/.test(String(sigRow.value || ''))) {
                try { sig = Buffer.from(String(sigRow.value).split(',')[1], 'base64'); } catch (e) { sig = null; }
            }
            const buf = await pdfBuffer({ size: 'A4', layout: 'landscape', margin: 0 }, doc => {
                const F = fonts(doc);
                const W = doc.page.width, H = doc.page.height;
                doc.rect(0, 0, W, H).fill('#fbf9f6');
                doc.rect(23, 23, W - 46, H - 46).lineWidth(2).strokeColor(GOLD).stroke();
                doc.rect(28, 28, W - 56, H - 56).lineWidth(0.75).strokeColor(GOLD).stroke();
                let y = 108;
                if (logoOn(doc, LOGO_LIGHTBG, W / 2 - 44, y, 30)) y += 48; else { doc.font(F.bold).fontSize(22).fillColor(CRIMSON).text('med&X', 0, y, { width: W, align: 'center' }); y += 42; }
                doc.font(F.bold).fontSize(9).fillColor('#6b6258').text('CERTIFICATE OF ' + String(cert.certificate_type || 'attendance').toUpperCase(), 0, y, { width: W, align: 'center', characterSpacing: 4 });
                y += 30;
                doc.font(F.bold).fontSize(30).fillColor('#15110f').text(F.safe(cert.recipient_name || fullName(user)), 60, y, { width: W - 120, align: 'center' });
                y = doc.y + 14;
                doc.font(F.body).fontSize(11.5).fillColor('#403a36').text(F.safe(`has attended ${cert.conference_name || 'a Med&X event'} and is recognized for their participation.`), W / 2 - 250, y, { width: 500, align: 'center', lineGap: 3 });
                y = doc.y + 30;
                if (sig) { try { doc.image(sig, W / 2 - 70, y, { fit: [140, 44] }); } catch (e) { } }
                y += 50;
                doc.moveTo(W / 2 - 115, y).lineTo(W / 2 + 115, y).lineWidth(1).strokeColor(GOLD).stroke();
                doc.font(F.bold).fontSize(11).fillColor('#15110f').text(F.safe('Alen Juginović, MD'), 0, y + 8, { width: W, align: 'center' });
                doc.font(F.body).fontSize(7.5).fillColor('#6b6258').text('FOUNDER & PRESIDENT, MED&X', 0, y + 24, { width: W, align: 'center', characterSpacing: 2 });
                const issued = cert.issue_date ? longDate(cert.issue_date) : '';
                doc.font(F.body).fontSize(9).fillColor('#6b6258').text(F.safe(`Certificate No. ${cert.certificate_number || ''}${issued ? '  ·  Issued ' + issued : ''}`), 0, y + 46, { width: W, align: 'center' });
                const verify = `${baseUrl(req)}/verify-certificate?n=${encodeURIComponent(cert.certificate_number || '')}`;
                doc.font(F.body).fontSize(7.5).fillColor(CRIMSON).text(verify, 0, y + 62, { width: W, align: 'center' });
            });
            try { q.run("UPDATE certificates SET downloaded_at = datetime('now') WHERE id = ?", [cert.id]); } catch (e) { }
            pdfHeaders(res, `medx-certificate-${(cert.certificate_number || String(cert.id).slice(0, 8)).replace(/\s+/g, '')}.pdf`);
            res.send(buf);
        } catch (e) { console.error('[v2 wallet] certificate.pdf failed:', e.message); res.status(500).json({ error: 'Could not build the certificate PDF' }); }
    });

    log('wallet: member QR + card/ticket/receipt/confirmation/certificate PDFs + resend + pass gates ready');
};
