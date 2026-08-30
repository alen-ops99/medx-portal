/**
 * v2/calendar-ops.js — CALENDAR destination additions for the redesigned admin portal
 * (frontend-v2 › js/views/calendar.js).
 *
 *   GET /api/v2/calendar/key-dates   auth → adminOnly
 *     → { entries, conferences, bridges, gala } — ONE live feed the Calendar screen composes its
 *       NEXT UP banner and KEY DATES panel from (the year board itself stays the editable
 *       year_calendar_entries CRUD that already exists at /api/admin/year-calendar).
 *
 *       entries      the editable board rows (year_calendar_entries, verbatim)
 *       conferences  active conferences (name, start/end, venue, early_bird_deadline)
 *       bridges      dated bridges_events (name, city, event_date)
 *       gala         { early, regular, deadline } price facts from gala_settings — the price-flip
 *                    line under "Gala early-bird ends" is a live read, never a hardcode (note 6)
 *
 * Why here: the redesign gap matrix flagged that no cross-project key-dates read exists — the v1
 * screens each queried their own corner. This is a read-only union; nothing writes, and the
 * existing year-calendar CRUD stays the single write path for board entries.
 */
'use strict';

module.exports = function mountCalendarOps(app, ctx) {
    const { db, auth, adminOnly } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/calendar-ops]', ...a));

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
    const day = (v) => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };

    app.get('/api/v2/calendar/key-dates', auth, adminOnly, (req, res) => {
        try {
            let entries = [];
            try {
                entries = getAll(`SELECT id, title, project, starts_on, ends_on, status, color, notes
                                  FROM year_calendar_entries ORDER BY (starts_on IS NULL), starts_on, title`)
                    .filter(e => day(e.starts_on));
            } catch (e) { log('entries read:', e.message); }

            let conferences = [];
            try {
                conferences = getAll(`SELECT id, name, start_date, end_date, venue_name, venue_city, early_bird_deadline
                                      FROM conferences WHERE is_active = 1`)
                    .filter(c => day(c.start_date))
                    .map(c => ({ id: c.id, name: c.name, start_date: day(c.start_date), end_date: day(c.end_date) || day(c.start_date),
                                 venue: [c.venue_name, c.venue_city].filter(Boolean).join(', ') || null,
                                 early_bird_deadline: day(c.early_bird_deadline) }));
            } catch (e) { log('conferences read:', e.message); }

            let bridges = [];
            try {
                bridges = getAll(`SELECT id, name, city, venue_name, event_date FROM bridges_events
                                  WHERE event_date IS NOT NULL AND event_date != ''`)
                    .filter(b => day(b.event_date))
                    .map(b => ({ id: b.id, name: b.name, city: b.city || null, venue: b.venue_name || null, event_date: day(b.event_date) }));
            } catch (e) { log('bridges read:', e.message); }

            let gala = null;
            try {
                const g = getRow(`SELECT price_gala_early_bird, price_gala_regular, early_bird_deadline
                                  FROM gala_settings WHERE id = 'default'`);
                if (g) gala = { early: Number(g.price_gala_early_bird) || null, regular: Number(g.price_gala_regular) || null,
                               deadline: day(g.early_bird_deadline) };
            } catch (e) { log('gala read:', e.message); }

            res.json({ entries, conferences, bridges, gala });
        } catch (e) {
            log('key-dates failed:', e.message);
            res.status(500).json({ error: 'Key dates are unavailable right now.' });
        }
    });

    log('calendar-ops module ready: key-dates union feed');
};
