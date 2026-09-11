/**
 * v2/plexus-hub.js — backend additions for the redesigned ADMIN Plexus Hub screen
 * (admin-portal/frontend-v2 js/views/plexus.js).
 *
 * Routes (all under /api/v2/plexus-hub/…, never reusing an existing /api path):
 *   GET  /api/v2/plexus-hub/speaker-meta                    admin → { meta: { <speaker_id>: { institution_logo_url, event_tag } } }
 *   PUT  /api/v2/plexus-hub/speakers/:id/meta               admin { institution_logo_url?, event_tag? ('plexus'|'gala'|'both'|null) }
 *   GET  /api/v2/plexus-hub/stats-overrides?scope=plexus    admin → { scope, overrides: { <figure_key>: { value, updated_at } } }
 *   PUT  /api/v2/plexus-hub/stats-overrides/:scope          admin { figure_key, value }  (null/'' clears the override)
 *   GET  /api/v2/plexus-hub/editions                        admin → { active, editions[] }   (edition switcher)
 *   POST /api/v2/plexus-hub/editions                        admin { year, label?, city?, starts_on?, ends_on?, status? }
 *   PATCH/api/v2/plexus-hub/editions/:id                    admin { label?, city?, starts_on?, ends_on?, status? }
 *   POST /api/v2/plexus-hub/editions/:id/activate           admin — makes this THE active edition
 *
 * Tables (both portals share ONE database — new tables prefixed v2_, nothing renamed):
 *   v2_speaker_meta — DDL copied VERBATIM from user-portal/backend/v2/plexus.js (the member-side
 *     module defines the same table; whichever backend loads first creates it). The admin origin
 *     needs its own write route because the admin frontend only talks to the admin backend.
 *   v2_stats_overrides — per-figure manual overrides for the reusable "Stats for media & sponsors"
 *     widget (handoff README admin note 21): scoped live numbers, any figure manually overridable.
 */
'use strict';

const editionsLib = require('../../../shared/editions');

const EVENT_TAGS = ['plexus', 'gala', 'both'];

module.exports = function mountPlexusHub(app, ctx) {
    const { db, auth, adminOnly } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/plexus-hub]', ...a));

    // ---- sql.js-style helpers (shared/db.js wrapper: prepare → bind → step → getAsObject → free)
    const q = {
        all(sql, params = []) {
            const st = db().prepare(sql);
            st.bind(params);
            const rows = [];
            while (st.step()) rows.push(st.getAsObject());
            st.free();
            return rows;
        },
        get(sql, params = []) { return q.all(sql, params)[0] || null; },
        run(sql, params = []) { return db().run(sql, params); }
    };
    const safeAll = (sql, params) => { try { return q.all(sql, params); } catch (e) { return []; } };
    const safeGet = (sql, params) => { try { return q.get(sql, params); } catch (e) { return null; } };

    // ---- schema (try/catch DDL at load)
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_speaker_meta (
            speaker_id TEXT PRIMARY KEY,
            institution_logo_url TEXT,
            event_tag TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
    } catch (e) { log('v2_speaker_meta schema failed:', e.message); }
    // v2_stats_overrides is DEFINED by v2/bridges-ops.js (the widget is reusable per note 21 and
    // that module claimed the table first) — DDL copied VERBATIM from there; this module only
    // writes rows with hub = 'plexus'.
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_stats_overrides (
            id TEXT PRIMARY KEY,
            hub TEXT NOT NULL,
            scope TEXT NOT NULL,
            stat_key TEXT NOT NULL,
            value TEXT,
            updated_at TEXT,
            updated_by TEXT,
            UNIQUE(hub, scope, stat_key)
        )`);
    } catch (e) { log('v2_stats_overrides schema failed:', e.message); }

    const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
    const isUrl = (s) => /^(https?:\/\/[^\s"'<>]+|\/uploads\/[^\s"'<>]+)$/i.test(String(s || ''));
    const okScope = (s) => /^[a-z][a-z0-9-]{0,39}$/.test(String(s || ''));
    const okKey = (s) => /^[a-z][a-z0-9_-]{0,59}$/.test(String(s || ''));

    // ================================================================ speaker meta (admin-side
    // wrapper of the member module's routes — same table, admin JWT + adminOnly)
    app.get('/api/v2/plexus-hub/speaker-meta', auth, adminOnly, (req, res) => {
        try {
            const rows = safeAll('SELECT speaker_id, institution_logo_url, event_tag FROM v2_speaker_meta');
            const meta = {};
            rows.forEach(r => { meta[r.speaker_id] = { institution_logo_url: r.institution_logo_url || null, event_tag: r.event_tag || null }; });
            res.json({ meta });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/v2/plexus-hub/speakers/:id/meta', auth, adminOnly, (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            const speaker = safeGet('SELECT id FROM speakers WHERE id = ?', [id]);
            if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
            const b = req.body || {};
            const prev = safeGet('SELECT * FROM v2_speaker_meta WHERE speaker_id = ?', [id]) || {};
            let logo = prev.institution_logo_url || null;
            if (b.institution_logo_url !== undefined) {
                const v = clip(b.institution_logo_url, 500);
                if (v && !isUrl(v)) return res.status(400).json({ error: 'institution_logo_url must be an http(s) URL or an /uploads/ path' });
                logo = v;
            }
            let tag = prev.event_tag || null;
            if (b.event_tag !== undefined) {
                const v = b.event_tag == null || b.event_tag === '' ? null : String(b.event_tag).trim().toLowerCase();
                if (v && !EVENT_TAGS.includes(v)) return res.status(400).json({ error: 'event_tag must be plexus, gala, both or empty' });
                tag = v;
            }
            q.run(`INSERT INTO v2_speaker_meta (speaker_id, institution_logo_url, event_tag, updated_at) VALUES (?, ?, ?, datetime('now'))
                   ON CONFLICT(speaker_id) DO UPDATE SET institution_logo_url = excluded.institution_logo_url, event_tag = excluded.event_tag, updated_at = excluded.updated_at`,
                [id, logo, tag]);
            if (ctx.saveDb) try { ctx.saveDb(); } catch (e) {}
            res.json({ success: true, speaker_id: id, institution_logo_url: logo, event_tag: tag });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ================================================================ stats overrides (note 21)
    const HUB = 'plexus';
    const overridesFor = (scope) => {
        const rows = safeAll('SELECT stat_key, value, updated_at FROM v2_stats_overrides WHERE hub = ? AND scope = ? AND value IS NOT NULL', [HUB, scope]);
        const overrides = {};
        rows.forEach(r => { overrides[r.stat_key] = { value: r.value, updated_at: r.updated_at }; });
        return overrides;
    };

    app.get('/api/v2/plexus-hub/stats-overrides', auth, adminOnly, (req, res) => {
        try {
            const scope = String(req.query.scope || 'plexus').toLowerCase();
            if (!okScope(scope)) return res.status(400).json({ error: 'scope must be a short lowercase key' });
            res.json({ scope, overrides: overridesFor(scope) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/v2/plexus-hub/stats-overrides/:scope', auth, adminOnly, (req, res) => {
        try {
            const scope = String(req.params.scope || '').toLowerCase();
            if (!okScope(scope)) return res.status(400).json({ error: 'scope must be a short lowercase key' });
            const b = req.body || {};
            const key = String(b.figure_key || '').toLowerCase();
            if (!okKey(key)) return res.status(400).json({ error: 'figure_key must be a short lowercase key' });
            const raw = b.value;
            const value = raw === undefined || raw === null || String(raw).trim() === '' ? null : clip(raw, 200);
            const by = (req.user && (req.user.email || req.user.id)) || 'admin';
            const now = new Date().toISOString();
            const existing = safeGet('SELECT id FROM v2_stats_overrides WHERE hub = ? AND scope = ? AND stat_key = ?', [HUB, scope, key]);
            if (value === null) {
                if (existing) q.run('DELETE FROM v2_stats_overrides WHERE id = ?', [existing.id]);
            } else if (existing) {
                q.run('UPDATE v2_stats_overrides SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?', [value, now, by, existing.id]);
            } else {
                q.run('INSERT INTO v2_stats_overrides (id, hub, scope, stat_key, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [require('crypto').randomUUID(), HUB, scope, key, value, now, by]);
            }
            if (ctx.saveDb) try { ctx.saveDb(); } catch (e) {}
            res.json({ success: true, scope, figure_key: key, value, overrides: overridesFor(scope) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ================================================================ PLEXUS WEEK EDITIONS
    // "in general Plexus Week and then we can choose 2026 and once it passes we archive it and
    // then automatically we get 27." (Alen, design/MEETUPS-SPEC.md §1.) The table, the seed and
    // the auto-rollover live in shared/editions.js — the member backend runs the identical code
    // against the identical rows, so neither side can drift.
    const eq = { run: (s, p) => q.run(s, p), get: (s, p) => safeGet(s, p), all: (s, p) => safeAll(s, p) };
    try { editionsLib.bootstrap(eq); } catch (e) { log('editions bootstrap failed:', e.message); }
    if (!process.env.MEETUPS_NO_TIMERS && process.env.NODE_ENV !== 'test') {
        const roll = setInterval(() => { try { editionsLib.bootstrap(eq); } catch (e) {} }, 12 * 3600 * 1000);
        if (roll.unref) roll.unref();
    }

    const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const editionsPayload = () => ({
        active: editionsLib.toJson(editionsLib.activeEdition(eq)),
        editions: editionsLib.listEditions(eq).map(editionsLib.toJson)
    });

    app.get('/api/v2/plexus-hub/editions', auth, adminOnly, (req, res) => {
        try { res.json(editionsPayload()); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/v2/plexus-hub/editions', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const year = parseInt(b.year, 10);
            if (!Number.isFinite(year) || year < 2015 || year > 2100) return res.status(400).json({ error: 'A four-digit year between 2015 and 2100 is needed.' });
            if (editionsLib.getEditionByYear(eq, year)) return res.status(409).json({ error: `Plexus Week ${year} already exists.` });
            const starts = b.starts_on == null || b.starts_on === '' ? null : String(b.starts_on).slice(0, 10);
            const ends = b.ends_on == null || b.ends_on === '' ? null : String(b.ends_on).slice(0, 10);
            if (starts && !isoDate(starts)) return res.status(400).json({ error: 'starts_on must be an ISO date (2027-12-03).' });
            if (ends && !isoDate(ends)) return res.status(400).json({ error: 'ends_on must be an ISO date (2027-12-06).' });
            if (starts && ends && ends < starts) return res.status(400).json({ error: 'ends_on cannot be before starts_on.' });
            const status = editionsLib.STATUSES.includes(String(b.status)) ? String(b.status) : 'upcoming';
            q.run(`INSERT INTO plexus_editions (id, year, label, city, starts_on, ends_on, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['plexus-' + year, year, clip(b.label, 120) || `Plexus Week ${year}`, clip(b.city, 80) || 'Zagreb', starts, ends, status === 'active' ? 'upcoming' : status]);
            if (status === 'active') editionsLib.activate(eq, 'plexus-' + year);
            if (ctx.saveDb) try { ctx.saveDb(); } catch (e) {}
            res.json(Object.assign({ success: true }, editionsPayload()));
        } catch (e) { log('edition create failed:', e.message); res.status(500).json({ error: 'Could not create that edition.' }); }
    });

    app.patch('/api/v2/plexus-hub/editions/:id', auth, adminOnly, (req, res) => {
        try {
            const row = editionsLib.getEdition(eq, req.params.id);
            if (!row) return res.status(404).json({ error: 'Edition not found' });
            const b = req.body || {};
            const sets = []; const vals = [];
            if (b.label !== undefined) { const v = clip(b.label, 120); if (!v) return res.status(400).json({ error: 'The label cannot be empty.' }); sets.push('label = ?'); vals.push(v); }
            if (b.city !== undefined) { sets.push('city = ?'); vals.push(clip(b.city, 80) || 'Zagreb'); }
            for (const k of ['starts_on', 'ends_on']) {
                if (b[k] === undefined) continue;
                const v = b[k] == null || b[k] === '' ? null : String(b[k]).slice(0, 10);
                if (v && !isoDate(v)) return res.status(400).json({ error: `${k} must be an ISO date.` });
                sets.push(`${k} = ?`); vals.push(v);
            }
            if (b.status !== undefined) {
                const v = String(b.status);
                if (!editionsLib.STATUSES.includes(v)) return res.status(400).json({ error: 'status must be upcoming, active or archived.' });
                if (v === 'active') { editionsLib.activate(eq, row.id); }
                else { sets.push('status = ?'); vals.push(v); if (v === 'archived') { sets.push('archived_at = ?'); vals.push(new Date().toISOString()); } }
            }
            if (sets.length) { vals.push(row.id); q.run(`UPDATE plexus_editions SET ${sets.join(', ')} WHERE id = ?`, vals); }
            else if (b.status === undefined) return res.status(400).json({ error: 'Nothing to update.' });
            const after = editionsLib.getEdition(eq, row.id);
            if (after && after.starts_on && after.ends_on && after.ends_on < after.starts_on) {
                q.run('UPDATE plexus_editions SET ends_on = starts_on WHERE id = ?', [row.id]);
            }
            if (ctx.saveDb) try { ctx.saveDb(); } catch (e) {}
            res.json(Object.assign({ success: true, edition: editionsLib.toJson(editionsLib.getEdition(eq, row.id)) }, editionsPayload()));
        } catch (e) { log('edition patch failed:', e.message); res.status(500).json({ error: 'Could not save that edition.' }); }
    });

    app.post('/api/v2/plexus-hub/editions/:id/activate', auth, adminOnly, (req, res) => {
        try {
            const row = editionsLib.activate(eq, req.params.id);
            if (!row) return res.status(404).json({ error: 'Edition not found' });
            if (ctx.saveDb) try { ctx.saveDb(); } catch (e) {}
            res.json(Object.assign({ success: true, edition: editionsLib.toJson(row) }, editionsPayload()));
        } catch (e) { log('edition activate failed:', e.message); res.status(500).json({ error: 'Could not activate that edition.' }); }
    });

    log('plexus-hub: speaker-meta (admin wrapper) · stats-overrides (note 21) · Plexus Week editions + rollover');
};
