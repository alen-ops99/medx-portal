/**
 * v2/accelerator.js — Accelerator additions for frontend-v2 (js/views/accelerator.js).
 *
 * Only what the existing member routes do NOT cover (README note 15 / gap matrix E-4):
 *   GET    /api/v2/accelerator/alumni           public  — published fellows for the "PREVIOUS COHORTS"
 *                                                          rotator ({ alumni:[{id,name,year,placement_institution,city,photo_url,sort_order}], count, years })
 *   GET    /api/v2/accelerator/alumni/all       admin   — every row incl. unpublished (admin editor list)
 *   POST   /api/v2/accelerator/alumni           admin   — { name*, year, placement_institution, city, photo_url, sort_order, is_published }
 *   PUT    /api/v2/accelerator/alumni/:id       admin   — same fields, partial update
 *   DELETE /api/v2/accelerator/alumni/:id       admin   — hard delete (a fellow is not a record; unpublish first if unsure)
 *
 * Everything else the screen needs already exists in server.js: institutions/sites, overview-config,
 * countdown, intake, key-dates, notify-topics, results lookup, portal-content (FAQ rows, section
 * 'accelerator-faq'), the member application routes and the checkout session.
 *
 * Schema: v2_accelerator_alumni (created here, CREATE TABLE IF NOT EXISTS; never renamed/dropped).
 * The table ships EMPTY on purpose — the view falls back to the published 2024–25 names (COPY) until
 * the admin enters the real list; nothing seeds data into the shared DB at boot.
 */
'use strict';
const crypto = require('crypto');

module.exports = function mountAccelerator(app, ctx) {
    const { db, auth, adminOnly, log } = ctx;

    // ---- sql.js-style helpers (shared/db.js idioms) ----
    const q = {
        all(sql, params) {
            const s = db().prepare(sql);
            s.bind(params || []);
            const rows = [];
            while (s.step()) rows.push(s.getAsObject());
            s.free();
            return rows;
        },
        get(sql, params) { return q.all(sql, params)[0] || null; },
        run(sql, params) { return db().run(sql, params || []); }
    };

    // ---- schema ----
    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_accelerator_alumni (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            year INTEGER,
            placement_institution TEXT,
            city TEXT,
            photo_url TEXT,
            sort_order INTEGER DEFAULT 0,
            is_published INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (e) { log('accelerator schema failed: ' + e.message); }

    // ---- validation ----
    const str = (v, max) => (v === undefined || v === null) ? null : String(v).trim().slice(0, max);
    function clean(body, partial) {
        const b = body || {};
        const out = {};
        if (!partial || b.name !== undefined) {
            out.name = str(b.name, 160);
            if (!out.name) return { error: 'name is required' };
        }
        if (b.year !== undefined) {
            if (b.year === null || b.year === '') out.year = null;
            else {
                const y = parseInt(b.year, 10);
                if (isNaN(y) || y < 2000 || y > 2100) return { error: 'year must be a four-digit year' };
                out.year = y;
            }
        }
        if (b.placement_institution !== undefined) out.placement_institution = str(b.placement_institution, 200);
        if (b.city !== undefined) out.city = str(b.city, 120);
        if (b.photo_url !== undefined) {
            const u = str(b.photo_url, 500);
            if (u && !/^(https?:\/\/|\/uploads\/|\/f\/)/.test(u)) return { error: 'photo_url must be an http(s) URL or an /uploads path' };
            out.photo_url = u || null;
        }
        if (b.sort_order !== undefined) { const n = parseInt(b.sort_order, 10); out.sort_order = isNaN(n) ? 0 : n; }
        if (b.is_published !== undefined) out.is_published = (b.is_published === true || b.is_published === 1 || b.is_published === '1' || b.is_published === 'true') ? 1 : 0;
        return { fields: out };
    }
    const COLS = 'id, name, year, placement_institution, city, photo_url, sort_order, is_published, created_at, updated_at';
    function summary(rows) {
        const years = rows.map(r => r.year).filter(y => typeof y === 'number' && !isNaN(y));
        return { alumni: rows, count: rows.length, years: years.length ? { from: Math.min.apply(null, years), to: Math.max.apply(null, years) } : null };
    }

    // ---- routes ----
    // Public read: published fellows, newest cohort first, then admin order, then name.
    app.get('/api/v2/accelerator/alumni', (req, res) => {
        try {
            const rows = q.all(`SELECT id, name, year, placement_institution, city, photo_url, sort_order FROM v2_accelerator_alumni
                                WHERE is_published = 1 ORDER BY year DESC, sort_order ASC, name ASC`);
            res.json(summary(rows));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/v2/accelerator/alumni/all', auth, adminOnly, (req, res) => {
        try {
            res.json(summary(q.all(`SELECT ${COLS} FROM v2_accelerator_alumni ORDER BY year DESC, sort_order ASC, name ASC`)));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/v2/accelerator/alumni', auth, adminOnly, (req, res) => {
        try {
            const c = clean(req.body, false);
            if (c.error) return res.status(400).json({ error: c.error });
            const f = Object.assign({ year: null, placement_institution: null, city: null, photo_url: null, sort_order: 0, is_published: 1 }, c.fields);
            const id = crypto.randomUUID();
            q.run(`INSERT INTO v2_accelerator_alumni (id, name, year, placement_institution, city, photo_url, sort_order, is_published)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, f.name, f.year, f.placement_institution, f.city, f.photo_url, f.sort_order, f.is_published]);
            res.json({ success: true, alumnus: q.get(`SELECT ${COLS} FROM v2_accelerator_alumni WHERE id = ?`, [id]) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/v2/accelerator/alumni/:id', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!q.get('SELECT id FROM v2_accelerator_alumni WHERE id = ?', [id])) return res.status(404).json({ error: 'Not found' });
            const c = clean(req.body, true);
            if (c.error) return res.status(400).json({ error: c.error });
            const keys = Object.keys(c.fields);
            if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
            const sets = keys.map(k => `${k} = ?`).join(', ');
            q.run(`UPDATE v2_accelerator_alumni SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, keys.map(k => c.fields[k]).concat([id]));
            res.json({ success: true, alumnus: q.get(`SELECT ${COLS} FROM v2_accelerator_alumni WHERE id = ?`, [id]) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/v2/accelerator/alumni/:id', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '');
            if (!q.get('SELECT id FROM v2_accelerator_alumni WHERE id = ?', [id])) return res.status(404).json({ error: 'Not found' });
            q.run('DELETE FROM v2_accelerator_alumni WHERE id = ?', [id]);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    log('accelerator: alumni routes mounted');
};
