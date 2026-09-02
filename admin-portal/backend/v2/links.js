/**
 * v2/links.js — backend additions for the redesigned admin LINKS destination
 * (admin-portal/frontend-v2 › js/views/links.js · artboard: Admin Links.dc.html).
 *
 * The link tables + their CRUD already exist (server.js):
 *   registration_links            POST/GET /api/admin/registration-links (+ /:id/deactivate)
 *   gala_invite_links             POST/GET /api/admin/gala/invite-links (+ /:id/revoke)
 *   croatians_abroad_invite_links POST/GET/DELETE /api/admin/croatians-abroad/invite-links
 * The v2 view lists and creates through THOSE routes. This module adds only what the
 * artboard needs and the legacy surface lacks:
 *
 *   POST /api/v2/links/:kind/:id/active   auth+adminOnly ← { active: true|false }
 *        PAUSE / RESUME in both directions. kind: 'registration' → registration_links.is_active,
 *        'gala' → gala_invite_links.revoked, 'croatians' → croatians_abroad_invite_links.revoked.
 *        (Legacy has deactivate/revoke but NO resume — gap matrix: "resume MISSING".)
 *   GET  /api/v2/links/qr?data=<url>      auth+adminOnly → { dataUrl }
 *        Print-ready QR of the shareable link as a PNG data URL (same `qrcode` dep the
 *        server already uses for tickets, server.js:11).
 *   POST /api/v2/links/bulk-archive       auth+adminOnly ← { items: [{ kind, id }, …] } (≤200)
 *        UX audit 2026-09-02 #8: checkbox-select → ARCHIVE N. Archive = the same pause flag the
 *        single toggle writes (is_active=0 / revoked=1) — history kept, pages say registration
 *        is closed, RESUME still works. Returns { archived, failed:[{kind,id,error}] }.
 *
 * No new tables, no ALTERs — is_active / revoked already exist on all three tables.
 */
'use strict';
const QRCode = require('qrcode');

module.exports = function mountLinks(app, ctx) {
    const { db, auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/links]', ...a));

    function one(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        catch (e) { log('query failed:', e.message); return null; }
        finally { if (st) st.free(); }
    }
    function audit(req, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [require('crypto').randomUUID(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 300)]);
        } catch (e) { /* best-effort */ }
    }

    // kind → { table, how the active flag is stored }
    const KINDS = {
        registration: { table: 'registration_links', col: 'is_active', activeVal: a => (a ? 1 : 0) },
        gala: { table: 'gala_invite_links', col: 'revoked', activeVal: a => (a ? 0 : 1) },
        croatians: { table: 'croatians_abroad_invite_links', col: 'revoked', activeVal: a => (a ? 0 : 1) }
    };

    app.post('/api/v2/links/:kind/:id/active', auth, adminOnly, (req, res) => {
        try {
            const k = KINDS[req.params.kind];
            if (!k) return res.status(400).json({ error: "kind must be one of: registration, gala, croatians" });
            const row = one(`SELECT * FROM ${k.table} WHERE id = ?`, [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Link not found' });
            const active = !!(req.body && (req.body.active === true || req.body.active === 1 || req.body.active === '1' || req.body.active === 'true'));
            db().run(`UPDATE ${k.table} SET ${k.col} = ? WHERE id = ?`, [k.activeVal(active), req.params.id]);
            saveDb();
            audit(req, active ? 'links.resume' : 'links.pause', `${req.params.kind}/${row.label || row.event_name || req.params.id}`);
            res.json({ success: true, id: req.params.id, kind: req.params.kind, active });
        } catch (e) { log('active toggle failed:', e.message); res.status(500).json({ error: 'Could not update the link.' }); }
    });

    // Bulk archive (audit #8) — one call for the checkbox sweep; per-row failures are reported,
    // never silently dropped, and every archived row is the SAME reversible pause the single
    // toggle writes (no deletes here — link history is sign-up history).
    app.post('/api/v2/links/bulk-archive', auth, adminOnly, (req, res) => {
        try {
            const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 200) : [];
            if (!items.length) return res.status(400).json({ error: 'Send items: [{ kind, id }, …]' });
            let archived = 0;
            const failed = [];
            for (const it of items) {
                const kind = String((it && it.kind) || '');
                const id = String((it && it.id) || '');
                const k = KINDS[kind];
                if (!k || !id) { failed.push({ kind, id, error: 'kind must be one of: registration, gala, croatians' }); continue; }
                try {
                    const row = one(`SELECT * FROM ${k.table} WHERE id = ?`, [id]);
                    if (!row) { failed.push({ kind, id, error: 'Link not found' }); continue; }
                    db().run(`UPDATE ${k.table} SET ${k.col} = ? WHERE id = ?`, [k.activeVal(false), id]);
                    archived++;
                    audit(req, 'links.bulk_archive', `${kind}/${row.label || row.event_name || id}`);
                } catch (e) { failed.push({ kind, id, error: 'Could not update the link.' }); }
            }
            if (archived) saveDb();
            res.json({ success: true, archived, failed });
        } catch (e) { log('bulk-archive failed:', e.message); res.status(500).json({ error: 'Could not archive the links.' }); }
    });

    app.get('/api/v2/links/qr', auth, adminOnly, async (req, res) => {
        try {
            const data = String(req.query.data || '').trim();
            if (!data || data.length > 2000 || !/^https?:\/\//i.test(data)) {
                return res.status(400).json({ error: 'data must be an http(s) URL (max 2000 chars)' });
            }
            const dataUrl = await QRCode.toDataURL(data, { width: 560, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#15110f', light: '#ffffff' } });
            res.json({ dataUrl, data });
        } catch (e) { log('qr failed:', e.message); res.status(500).json({ error: 'Could not draw the QR.' }); }
    });
};
