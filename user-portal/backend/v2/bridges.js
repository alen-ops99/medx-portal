/**
 * v2/bridges.js — Building Bridges additions for the redesigned member portal (frontend-v2 › js/views/bridges.js).
 *
 *   GET  /api/v2/bridges/editions      public           → { editions: [...], totals: { cities, events, guests } }
 *                                                         (curated rows + any past evening not entered yet — pastEvenings)
 *   POST /api/v2/bridges/editions      auth + adminOnly ← new edition row
 *   PUT  /api/v2/bridges/editions/:id  auth + adminOnly ← partial update (recap figures, note, photos…)
 *
 * Why: the artboard's "WHERE WE'VE BEEN" recap cards (per-edition guests / new-connections figures
 * + photo galleries) have no home in the existing schema — `bridges_events` carries live events,
 * not recap history, and its columns can't grow from here (schema lives in server.js).
 * `v2_bridges_editions` holds the canonical four editions (Washington 01 · Embassy of the Republic of
 * Croatia, London 02 · Embassy, New York 03 · Consulate, Zürich 04 · Zunfthaus zur Schmiden — admin
 * decisions, Aug 2026, venues corrected by Alen 26 Sept 2026), with guests /
 * connections NULL until admins enter real counts (the screen shows "—", the band shows the
 * canonical "150+" total until every edition has a figure).
 *
 * Photos: photos_json is an array of { url, caption } (≤ 40). Upload the files through the
 * existing admin route POST /api/upload/:type (admin portal, multer → /uploads/…) or any hosted
 * URL, then PUT the URLs here. An optional event_id can point at a bridges_events row.
 */
'use strict';
const crypto = require('crypto');
const evenings = require('../../../shared/bridges-evenings');   // the one "held evening" rule (admin hub too)

module.exports = function mountBridges(app, ctx) {
    const { db, auth, adminOnly } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/bridges]', ...a));
    const MAX_PHOTOS = 40;

    try {
        db().run(`CREATE TABLE IF NOT EXISTS v2_bridges_editions (
            id TEXT PRIMARY KEY,
            edition_no INTEGER NOT NULL,
            city TEXT NOT NULL,
            country TEXT,
            venue TEXT,
            event_date TEXT,
            note TEXT,
            guests INTEGER,
            connections INTEGER,
            photos_json TEXT DEFAULT '[]',
            photo_label TEXT,
            event_id TEXT,
            is_published INTEGER DEFAULT 1,
            updated_at TEXT,
            updated_by TEXT
        )`);
    } catch (e) { log('schema failed:', e.message); }

    function rows(sql, params) {
        let st = null; const out = [];
        try { st = db().prepare(sql); st.bind(params || []); while (st.step()) out.push(st.getAsObject()); return out; }
        finally { if (st) st.free(); }
    }
    function getRow(sql, params) { const r = rows(sql, params); return r.length ? r[0] : null; }

    // Seed the four canonical editions once (guards on an empty table only — admin edits stick).
    // No event_date here on purpose: shared/bridges-evenings.js covers an undated row by its city, and a
    // dated row with no event_id would un-cover the held bridges_events row of that city (a phantom edition).
    try {
        if (!getRow('SELECT id FROM v2_bridges_editions LIMIT 1')) {
            const seed = [
                [1, 'Washington DC', 'United States', 'Embassy of the Republic of Croatia, Washington DC', 'An embassy-level forum in the US capital, bringing Croatian and American biomedical leaders to the same table.', 'PHOTO · WASHINGTON EVENING'],
                [2, 'London', 'United Kingdom', 'Embassy of Croatia', 'At the Croatian Embassy — the UK’s Croatian medical community met London’s institutions.', 'PHOTO · LONDON RECEPTION'],
                [3, 'New York', 'United States', 'Consulate General of Croatia', 'An evening at the Consulate General with Croatian-American physicians and researchers.', 'PHOTO · CONSULATE EVENING, NEW YORK'],
                [4, 'Zürich', 'Switzerland', 'Zunfthaus zur Schmiden', 'An evening in a historic guild house, opened by Croatia’s ambassador to Switzerland, for Croatian and Swiss physicians and scientists.', 'PHOTO · ZÜRICH EVENING']
            ];
            const now = new Date().toISOString();
            seed.forEach(([no, city, country, venue, note, label]) => {
                db().run(`INSERT INTO v2_bridges_editions (id, edition_no, city, country, venue, note, guests, connections, photos_json, photo_label, is_published, updated_at, updated_by)
                          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, 1, ?, 'seed')`,
                    [crypto.randomUUID(), no, city, country, venue, note, label, now]);
            });
            try { db().sync(); } catch (e) { /* no Turso locally */ }
            log('seeded 4 canonical editions');
        }
    } catch (e) { log('seed failed:', e.message); }

    const cleanStr = (v, max) => (v === undefined ? undefined : String(v == null ? '' : v).trim().slice(0, max));
    function cleanCount(v) {
        if (v === undefined) return undefined;
        if (v === null || v === '') return null;
        const n = Math.round(Number(v));
        return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : NaN;
    }
    function cleanPhotos(v) {
        if (v === undefined) return undefined;
        if (!Array.isArray(v)) return NaN;
        const out = [];
        for (const p of v.slice(0, MAX_PHOTOS)) {
            if (!p || typeof p !== 'object') continue;
            const url = String(p.url || '').trim().slice(0, 500);
            if (!/^(https?:\/\/|\/)/.test(url)) continue;
            out.push({ url, caption: String(p.caption || '').trim().slice(0, 200) });
        }
        return out;
    }

    function shape(r) {
        let photos = [];
        try { photos = JSON.parse(r.photos_json || '[]'); } catch (e) {}
        return {
            id: r.id, edition_no: r.edition_no, city: r.city, country: r.country || null, venue: r.venue || null,
            event_date: r.event_date || null, note: r.note || null,
            guests: r.guests === null || r.guests === undefined ? null : Number(r.guests),
            connections: r.connections === null || r.connections === undefined ? null : Number(r.connections),
            photos: Array.isArray(photos) ? photos : [],
            photo_label: r.photo_label || null, event_id: r.event_id || null, updated_at: r.updated_at || null
        };
    }

    // An evening that has happened joins the recap on its own, numbered after the curated rows, until an admin
    // enters its edition. The rule (published, dated before today, not Donor Night, not cancelled, not a
    // '[superseded]' row; covered by the same event_id, date or undated city) is shared/bridges-evenings.js —
    // the admin hub reads the same file, so both sides count the same evenings. Read-only: nothing is written.
    function pastEvenings(list) {
        let evs = [];
        try { evs = rows(evenings.HELD_EVENINGS_SQL, [new Date().toISOString().slice(0, 10)]); }
        catch (e) { return []; }
        return evenings.pastEvenings(list, evs);
    }

    app.get('/api/v2/bridges/editions', (req, res) => {
        try {
            const curated = rows('SELECT * FROM v2_bridges_editions WHERE is_published = 1 ORDER BY edition_no DESC').map(shape);
            const list = pastEvenings(curated).reverse().concat(curated);
            const cities = new Set(list.map(e => e.city)).size;
            const withGuests = list.filter(e => e.guests !== null);
            const guests = list.length && withGuests.length === list.length ? withGuests.reduce((a, e) => a + e.guests, 0) : null;
            res.json({ editions: list, totals: { cities, events: list.length, guests } });
        } catch (e) { log('editions read failed:', e.message); res.status(500).json({ error: 'Editions are unavailable right now.' }); }
    });

    function applyPatch(b) {
        const patch = {};
        const err = (m) => ({ error: m });
        const strFields = { city: 80, country: 80, venue: 160, event_date: 40, note: 600, photo_label: 120, event_id: 80 };
        for (const [k, max] of Object.entries(strFields)) { const v = cleanStr(b[k], max); if (v !== undefined) patch[k] = v || null; }
        if (patch.city === null) return err('city cannot be empty');
        for (const k of ['guests', 'connections']) {
            const v = cleanCount(b[k]);
            if (v !== undefined) { if (Number.isNaN(v)) return err(k + ' must be a non-negative number or null'); patch[k] = v; }
        }
        const photos = cleanPhotos(b.photos);
        if (photos !== undefined) { if (!Array.isArray(photos)) return err('photos must be an array of { url, caption }'); patch.photos_json = JSON.stringify(photos); }
        if (b.is_published !== undefined) patch.is_published = b.is_published ? 1 : 0;
        if (b.edition_no !== undefined) { const n = Math.round(Number(b.edition_no)); if (!Number.isFinite(n) || n < 1 || n > 99) return err('edition_no must be 1–99'); patch.edition_no = n; }
        return { patch };
    }

    app.put('/api/v2/bridges/editions/:id', auth, adminOnly, (req, res) => {
        try {
            const row = getRow('SELECT id FROM v2_bridges_editions WHERE id = ?', [String(req.params.id)]);
            if (!row) return res.status(404).json({ error: 'Edition not found' });
            const r = applyPatch(req.body || {});
            if (r.error) return res.status(400).json({ error: r.error });
            const keys = Object.keys(r.patch);
            if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
            db().run(`UPDATE v2_bridges_editions SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`,
                [...keys.map(k => r.patch[k]), new Date().toISOString(), (req.user && req.user.email) || null, row.id]);
            try { db().sync(); } catch (e) {}
            res.json({ success: true, edition: shape(getRow('SELECT * FROM v2_bridges_editions WHERE id = ?', [row.id])) });
        } catch (e) { log('edition update failed:', e.message); res.status(500).json({ error: 'Could not save the edition.' }); }
    });

    app.post('/api/v2/bridges/editions', auth, adminOnly, (req, res) => {
        try {
            const r = applyPatch(req.body || {});
            if (r.error) return res.status(400).json({ error: r.error });
            if (!r.patch.city) return res.status(400).json({ error: 'city is required' });
            if (r.patch.edition_no === undefined) {
                const max = getRow('SELECT MAX(edition_no) AS m FROM v2_bridges_editions');
                r.patch.edition_no = ((max && Number(max.m)) || 0) + 1;
            }
            const id = crypto.randomUUID();
            const keys = Object.keys(r.patch);
            db().run(`INSERT INTO v2_bridges_editions (id, ${keys.join(', ')}, updated_at, updated_by) VALUES (?${', ?'.repeat(keys.length)}, ?, ?)`,
                [id, ...keys.map(k => r.patch[k]), new Date().toISOString(), (req.user && req.user.email) || null]);
            try { db().sync(); } catch (e) {}
            res.json({ success: true, edition: shape(getRow('SELECT * FROM v2_bridges_editions WHERE id = ?', [id])) });
        } catch (e) { log('edition create failed:', e.message); res.status(500).json({ error: 'Could not create the edition.' }); }
    });
};
