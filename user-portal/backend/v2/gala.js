/**
 * v2/gala.js — Gala Evening additions for the redesigned member portal (frontend-v2 › js/views/gala.js).
 *
 *   GET /api/v2/gala/meta   public          → { performers_announced, performers: [{name, role, photo_url}], price: {…}, updated_at }
 *   PUT /api/v2/gala/meta   auth + adminOnly ← { performers_announced?: boolean, performers?: [{name, role, photo_url?}] }
 *
 * Why: the artboard's two performer slots stay "TBA" until an admin flips `performersAnnounced`
 * (README › Gala specifics). gala_settings has no such flag and its admin PUT whitelists columns,
 * so the flag + names live in `v2_gala_meta` (key/value JSON) — never in gala_settings.
 *
 * price{} mirrors server.js › effectiveGalaPrice() exactly (the Gala component price in
 * event_components is the early-bird amount, gala_settings.price_gala_regular applies after
 * gala_settings.early_bird_deadline, inclusive) so the screen shows the amount the /plexus form
 * charges — the member portal never derives the price from its own clock.
 *
 * Everything else on the screen (date, time, venue, dress code, speakers_json, schedule_json,
 * prices, deadline) stays in gala_settings: read via GET /api/gala/settings, written by the admin
 * portal's PUT /api/admin/gala/settings.
 */
'use strict';

module.exports = function mountGala(app, ctx) {
    const { db, auth, adminOnly } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/gala]', ...a));
    const KEY = 'performers';
    const DEFAULT_DEADLINE = '2026-09-01';
    const MAX_PERFORMERS = 6;

    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_gala_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT,
            updated_by TEXT
        )`);
    } catch (e) { log('schema failed:', e.message); }

    function getRow(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        finally { if (st) st.free(); }
    }
    function readMeta(key, fallback) {
        try { const r = getRow('SELECT value, updated_at FROM v2_gala_meta WHERE key = ?', [key]); if (!r) return fallback; const v = JSON.parse(r.value); v.updated_at = r.updated_at || null; return v; }
        catch (e) { return fallback; }
    }
    function writeMeta(key, value, by) {
        db().run('INSERT OR REPLACE INTO v2_gala_meta (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)',
            [key, JSON.stringify(value), new Date().toISOString(), by || null]);
        try { db().sync(); } catch (e) { /* no Turso locally */ }
    }

    // Same arithmetic as effectiveGalaPrice() in server.js — kept in step on purpose.
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

    function cleanPerformers(list) {
        if (!Array.isArray(list)) return null;
        const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
        const out = [];
        for (const p of list.slice(0, MAX_PERFORMERS)) {
            if (!p || typeof p !== 'object') continue;
            const name = clean(p.name, 120);
            if (!name) continue;
            const row = { name, role: clean(p.role, 160) };
            const photo = clean(p.photo_url, 400);
            if (photo && /^(https?:\/\/|\/)/.test(photo)) row.photo_url = photo;
            out.push(row);
        }
        return out;
    }

    function metaJson() {
        const m = readMeta(KEY, null) || {};
        return {
            performers_announced: !!m.announced,
            performers: Array.isArray(m.list) ? m.list : [],
            price: priceBlock(),
            updated_at: m.updated_at || null
        };
    }

    app.get('/api/v2/gala/meta', (req, res) => {
        try { res.json(metaJson()); }
        catch (e) { log('meta read failed:', e.message); res.status(500).json({ error: 'Gala details are unavailable right now.' }); }
    });

    app.put('/api/v2/gala/meta', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const cur = readMeta(KEY, null) || { announced: false, list: [] };
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
            writeMeta(KEY, next, req.user && req.user.email);
            res.json(Object.assign({ success: true }, metaJson()));
        } catch (e) { log('meta write failed:', e.message); res.status(500).json({ error: 'Could not save the Gala details.' }); }
    });
};
