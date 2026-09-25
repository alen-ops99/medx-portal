/**
 * v2/bridges-ops.js — ADMIN backend for the redesigned Building Bridges hub
 * (frontend-v2 › js/views/bridges.js). Mounted by v2/index.js; every route lives under
 * /api/v2/bridges/… on the ADMIN service (2026-08-30, admin portal redesign — Admin Bridges Hub.dc.html).
 *
 * SHARED-TABLE RULE: the member portal's user-portal/backend/v2/bridges.js DEFINES
 * v2_bridges_editions (the recap rows the member /app/bridges page renders). Both portals share
 * ONE database, so the DDL + the canonical four-edition seed below are copied VERBATIM from that
 * file and the field semantics are identical (guests/connections NULL until an admin enters real
 * counts; photos_json = [{url, caption}] ≤ 40; unpublish hides, never deletes).
 *
 * Admin-side surface:
 *   GET  /api/v2/bridges/hub                    — one read for the whole hub screen (+ past_evenings: held evenings
 *                                                 with no recap yet, shared/bridges-evenings.js — the member recap's rule)
 *   PUT  /api/v2/bridges/editions/:id           — recap editing (guests · connections · note · photos · venue …)
 *   POST /api/v2/bridges/editions               — a new past-edition row
 *   GET  /api/v2/bridges/stats?scope=           — the reusable "Stats for media & sponsors" widget payload
 *   PUT  /api/v2/bridges/stats                  — {scope, key, value|null} manual override (null clears → live number)
 *   POST /api/v2/bridges/followups              — lightweight CRM row (who · why · tag)
 *   PUT  /api/v2/bridges/followups/:id          — {done:true|false} tick / undo
 *   POST /api/v2/bridges/events/:id/queue-email — {kind:'invitation'|'reminder'|'thankyou'} → approval outbox
 *
 * Emails NEVER send from here: queue-email stages a batch in scheduled_emails as
 * 'pending_approval' — the Inbox approves, the ~60s drainer sends (README note 2).
 * v2_stats_overrides is defined here (no other builder had claimed it — verified by grep
 * 2026-08-30); it is hub-scoped so the Plexus/Accelerator/Forum hubs can reuse the same widget.
 */
'use strict';
const crypto = require('crypto');
const bridgesEvenings = require('../../../shared/bridges-evenings');   // the one "held evening" rule (member recap too)
const emailLayout = require('../../../shared/email-layout');   // THE Med&X email layout

const MAX_PHOTOS = 40;
const STAT_KEYS = ['guests', 'cities', 'countries', 'speakers'];
const SCOPES = ['bridges', 'all', 'y2026'];
const CANON_GUESTS = '150+'; // canonical total until every edition has an admin-entered count

module.exports = function mountBridgesOps(app, ctx) {
    const { auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/bridges-ops]', ...a));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const nowIso = () => new Date().toISOString();

    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    const persist = () => { try { saveDb(); } catch (e) { /* periodic save still runs */ } };
    const fail = (res, e, what) => { console.error('[v2/bridges-ops] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const count = (sql, params) => { try { return (q.get(sql, params) || {}).c || 0; } catch (e) { return 0; } };

    // ---- schema — v2_bridges_editions DDL + seed copied VERBATIM from user-portal/backend/v2/bridges.js ----
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_bridges_editions (
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
    } catch (e) { log('editions schema failed:', e.message); }
    // Seed the four canonical editions once (guards on an empty table only — admin edits stick).
    try {
        if (!q.get('SELECT id FROM v2_bridges_editions LIMIT 1')) {
            const seed = [
                [1, 'Washington DC', 'United States', 'NIH Campus', 'Where Building Bridges began — researchers from the institutes met the Croatian community of the capital region.', 'PHOTO · WASHINGTON EVENING'],
                [2, 'London', 'United Kingdom', 'Embassy of Croatia', 'At the Croatian Embassy — the UK’s Croatian medical community met London’s institutions.', 'PHOTO · LONDON RECEPTION'],
                [3, 'New York', 'United States', 'Consulate General of Croatia', 'An evening at the Consulate General with Croatian-American physicians and researchers.', 'PHOTO · CONSULATE EVENING, NEW YORK'],
                [4, 'Zürich', 'Switzerland', 'ETH Zentrum', 'Clinicians and engineers from across the Swiss research hub, in one room.', 'PHOTO · ZÜRICH EVENING']
            ];
            const now = new Date().toISOString();
            seed.forEach(([no, city, country, venue, note, label]) => {
                q.run(`INSERT INTO v2_bridges_editions (id, edition_no, city, country, venue, note, guests, connections, photos_json, photo_label, is_published, updated_at, updated_by)
                          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, 1, ?, 'seed')`,
                    [uuid(), no, city, country, venue, note, label, now]);
            });
            persist();
            log('seeded 4 canonical editions');
        }
    } catch (e) { log('editions seed failed:', e.message); }
    // The stats widget's manual overrides — hub-scoped so every project hub can reuse the widget.
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
        q.run(`CREATE TABLE IF NOT EXISTS v2_bridges_followups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            why TEXT,
            tag TEXT,
            done_at TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )`);
    } catch (e) { log('ops schema failed:', e.message); }

    // ---- edition shaping + validation (identical semantics to the member module) ----
    function shapeEdition(r) {
        let photos = [];
        try { photos = JSON.parse(r.photos_json || '[]'); } catch (e) {}
        return {
            id: r.id, edition_no: r.edition_no, city: r.city, country: r.country || null, venue: r.venue || null,
            event_date: r.event_date || null, note: r.note || null,
            guests: r.guests === null || r.guests === undefined ? null : Number(r.guests),
            connections: r.connections === null || r.connections === undefined ? null : Number(r.connections),
            photos: Array.isArray(photos) ? photos : [],
            photo_label: r.photo_label || null, event_id: r.event_id || null,
            is_published: !!r.is_published, updated_at: r.updated_at || null
        };
    }
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

    // ---- stats: live numbers per scope, with per-cell manual overrides on top ----
    function liveStats(scope) {
        const editions = q.all(`SELECT * FROM v2_bridges_editions WHERE is_published = 1`).map(shapeEdition);
        const upcoming = q.all(`SELECT * FROM bridges_events`);
        if (scope === 'bridges') {
            const cities = new Set(editions.map(e => e.city));
            const countries = new Set(editions.map(e => e.country).filter(Boolean));
            const withGuests = editions.filter(e => e.guests !== null);
            const guests = editions.length && withGuests.length === editions.length ? String(withGuests.reduce((a, e) => a + e.guests, 0)) : CANON_GUESTS;
            return { guests, cities: String(cities.size), countries: String(countries.size), speakers: String(count(`SELECT COUNT(*) AS c FROM bridges_speakers`)) };
        }
        if (scope === 'y2026') {
            const ev26 = upcoming.filter(e => String(e.event_date || '').startsWith('2026'));
            const cities = new Set(ev26.map(e => e.city).filter(Boolean)); cities.add('Zagreb'); // Plexus Week
            return {
                guests: String(count(`SELECT COUNT(*) AS c FROM registrations WHERE COALESCE(status,'') <> 'cancelled'`) +
                               count(`SELECT COUNT(*) AS c FROM gala_registrations WHERE COALESCE(status,'') NOT IN ('cancelled','rejected')`) +
                               count(`SELECT COUNT(*) AS c FROM bridges_registrations WHERE COALESCE(status,'registered') <> 'cancelled'`)),
                cities: String(cities.size), countries: String(new Set(['Croatia'].concat(ev26.map(() => 'United States'))).size),
                speakers: String(count(`SELECT COUNT(*) AS c FROM bridges_speakers`) + count(`SELECT COUNT(*) AS c FROM forum_event_speakers`))
            };
        }
        // scope 'all' — across all Med&X projects
        const cities = new Set(editions.map(e => e.city).concat(upcoming.map(e => e.city).filter(Boolean))); cities.add('Zagreb');
        const countries = new Set(editions.map(e => e.country).filter(Boolean)); countries.add('Croatia');
        return {
            guests: String(count(`SELECT COUNT(*) AS c FROM registrations WHERE COALESCE(status,'') <> 'cancelled'`) +
                           count(`SELECT COUNT(*) AS c FROM gala_registrations WHERE COALESCE(status,'') NOT IN ('cancelled','rejected')`) +
                           count(`SELECT COUNT(*) AS c FROM bridges_registrations WHERE COALESCE(status,'registered') <> 'cancelled'`) +
                           count(`SELECT COUNT(*) AS c FROM forum_event_registrations WHERE COALESCE(status,'registered') <> 'cancelled'`)),
            cities: String(cities.size), countries: String(countries.size),
            // The conference roster lives in `speakers` (GET /api/admin/plexus/speakers reads it);
            // `conference_speakers` never existed, so count() swallowed the error and the
            // all-projects press line under-reported every Plexus speaker as zero.
            speakers: String(count(`SELECT COUNT(*) AS c FROM bridges_speakers`) + count(`SELECT COUNT(*) AS c FROM forum_event_speakers`) + count(`SELECT COUNT(*) AS c FROM speakers`))
        };
    }
    function statsPayload() {
        const overrides = {};
        q.all(`SELECT scope, stat_key, value FROM v2_stats_overrides WHERE hub = 'bridges'`).forEach(r => {
            overrides[r.scope] = overrides[r.scope] || {}; overrides[r.scope][r.stat_key] = r.value;
        });
        const out = {};
        for (const scope of SCOPES) {
            const live = liveStats(scope);
            const ov = overrides[scope] || {};
            const effective = {}; const overridden = {};
            for (const k of STAT_KEYS) { effective[k] = ov[k] != null && ov[k] !== '' ? ov[k] : live[k]; overridden[k] = ov[k] != null && ov[k] !== ''; }
            out[scope] = { live, overrides: ov, effective, overridden };
        }
        return out;
    }

    // ---- outbox staging (approval-gated batches — the Inbox spine) ----
    function stageBatch(sourceEngine, template, rows, createdBy) {
        const batchId = sourceEngine + '-' + Date.now().toString(36);
        for (const r of rows) {
            q.run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                   VALUES (?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [uuid(), batchId, sourceEngine, template, JSON.stringify({ to: r.to, subject: r.subject, html: r.html }), r.to, r.subject, createdBy || 'bridges-hub']);
        }
        persist();
        return { batch_id: batchId, count: rows.length };
    }
    // THE Med&X email layout (shared/email-layout.js): ink band + wordmark · rule · cream body.
    // Keeps its </body> — eventQueued() finds the event id in an html comment placed before it.
    function emailShell(eyebrow, headline, bodyHtml, rule) {
        return emailLayout.layout({
            title: String(headline || '').replace(/<[^>]+>/g, '') + ' — Med&X',
            label: 'BUILDING BRIDGES',
            rule: /c9a962/i.test(String(rule || '')) ? 'gold' : 'crimson',
            body: emailLayout.block({ eyebrow: esc(eyebrow), headline, bodyHtml }),
            footer: ['© Med&amp;X 2026 · Zagreb <span style="color:#c9a962">·</span> Building Bridges in Biomedicine is an initiative of Med&amp;X.']
        });
    }
    function eventWhen(e) {
        const d = String(e.event_date || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            const dt = new Date(d + 'T00:00:00Z');
            return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) + (e.event_time ? ' · ' + String(e.event_time).slice(0, 5) : '');
        }
        return e.event_date || 'date announced soon';
    }
    // event-scoped queued check (the event id travels inside payload_json via an html comment)
    function eventQueued(sourceEngine, eventId) {
        return count(`SELECT COUNT(*) AS c FROM scheduled_emails WHERE source_engine = ? AND status IN ('pending_approval','scheduled','sent') AND payload_json LIKE ?`,
            [sourceEngine, '%' + eventId + '%']) > 0;
    }
    // ---- per-event head counts. The home (Zagreb) edition is the exception: its guests register
    // through the Plexus Week / Croatians-abroad form, so they live in croatians_abroad_registrations
    // (selected_bridges + bridges_status), not in bridges_registrations — counting the latter alone
    // showed Zagreb as 0. Same home-edition resolution as v2/event-day.js homeBridgesId(): the
    // bridges_events row whose slug is 'building-bridges' (rename-safe). Every other city — Boston
    // included — is counted exactly as before.
    function homeBridgesId() {
        try { return (q.get("SELECT id FROM bridges_events WHERE slug = 'building-bridges'") || {}).id || null; } catch (e) { return null; }
    }
    function eventCounts(eventId, homeId) {
        const registered = count(`SELECT COUNT(*) AS c FROM bridges_registrations WHERE event_id = ? AND COALESCE(status,'registered') <> 'cancelled'`, [eventId]);
        const checkedIn = count(`SELECT COUNT(*) AS c FROM bridges_registrations WHERE event_id = ? AND checked_in = 1`, [eventId]);
        if (!homeId || String(eventId) !== String(homeId)) return { registration_count: registered, checked_in_count: checkedIn };
        // Home edition: add the diaspora rows as distinct people (lower-cased email), leaving out
        // anyone already holding a bridges_registrations row for this event — so a person in both
        // tables counts once. `email IS NOT NULL` keeps NOT IN from going null-blind.
        const diasporaRegistered = count(`SELECT COUNT(DISTINCT lower(email)) AS c FROM croatians_abroad_registrations
            WHERE selected_bridges = 1 AND bridges_status IN ('pre-registered','confirmed')
              AND lower(email) NOT IN (SELECT lower(email) FROM bridges_registrations WHERE event_id = ? AND COALESCE(status,'registered') <> 'cancelled' AND email IS NOT NULL)`, [eventId]);
        const diasporaCheckedIn = count(`SELECT COUNT(DISTINCT lower(email)) AS c FROM croatians_abroad_registrations
            WHERE selected_bridges = 1 AND bridges_checked_in = 1
              AND lower(email) NOT IN (SELECT lower(email) FROM bridges_registrations WHERE event_id = ? AND checked_in = 1 AND email IS NOT NULL)`, [eventId]);
        return { registration_count: registered + diasporaRegistered, checked_in_count: checkedIn + diasporaCheckedIn };
    }

    // ================================================================ routes (all admin-only)

    // GET /api/v2/bridges/hub — one read for the whole screen
    app.get('/api/v2/bridges/hub', auth, adminOnly, (req, res) => {
        try {
            const homeId = homeBridgesId();
            // Cancelled / superseded rows (the June "[superseded] Boston Symposium" seed) stay in the table for
            // history but have no place on the working screen.
            // Donor Night borrows a bridges_events row (slug 'donor-night') for its guest list — it is a Plexus
            // Week evening, not a Bridges city, and it was showing here as "Zagreb · DEC 4 · draft".
            const events = q.all(`SELECT * FROM bridges_events WHERE COALESCE(status,'upcoming') <> 'cancelled' AND name NOT LIKE '[superseded]%'
                                    AND COALESCE(slug,'') <> 'donor-night'
                                  ORDER BY (event_date IS NULL) ASC, event_date DESC, created_at DESC`).map(e => ({
                id: e.id, slug: e.slug || null, name: e.name, city: e.city, venue_name: e.venue_name || null, venue_address: e.venue_address || null,
                event_date: e.event_date || null, event_time: e.event_time || null, end_time: e.end_time || null,
                description: e.description || null, capacity: e.capacity || null, registration_open: !!e.registration_open,
                registration_deadline: e.registration_deadline || null, status: e.status || 'upcoming', is_published: !!e.is_published,
                notes: e.notes || null, price: e.price || 0,
                ...eventCounts(e.id, homeId),                       // registration_count · checked_in_count
                speakers_count: count(`SELECT COUNT(*) AS c FROM bridges_speakers WHERE event_id = ?`, [e.id]),
                invitation_queued: eventQueued('bridges-invitation', e.id),
                reminder_queued: eventQueued('bridges-reminder', e.id),
                thankyou_queued: eventQueued('bridges-thankyou', e.id)
            }));
            const editions = q.all(`SELECT * FROM v2_bridges_editions ORDER BY edition_no DESC`).map(shapeEdition);
            // past_evenings: the held evenings no published recap covers yet, by the member recap's own rule
            // (shared/bridges-evenings.js) — published editions + past_evenings = the member page's "N evenings so far".
            let pastEvenings = [];
            try { pastEvenings = bridgesEvenings.pastEvenings(editions.filter(e => e.is_published), q.all(bridgesEvenings.HELD_EVENINGS_SQL, [nowIso().slice(0, 10)])); }
            catch (e) { pastEvenings = []; }
            const followups = q.all(`SELECT * FROM v2_bridges_followups WHERE done_at IS NULL ORDER BY datetime(created_at) DESC LIMIT 50`);
            const diaspora = count(`SELECT COUNT(*) AS c FROM croatians_abroad_registrations WHERE selected_bridges = 1 AND COALESCE(source,'croatians-abroad') <> 'plexus'`);
            res.json({ ok: true, events, editions, past_evenings: pastEvenings, followups, stats: statsPayload(), diaspora_bridges_contacts: diaspora, canonical_guests: CANON_GUESTS });
        } catch (e) { fail(res, e, 'hub'); }
    });

    // PUT /api/v2/bridges/editions/:id — the recap editor (guests · connections · note · photos · …)
    app.put('/api/v2/bridges/editions/:id', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT id FROM v2_bridges_editions WHERE id = ?', [String(req.params.id)]);
            if (!row) return res.status(404).json({ error: 'Edition not found' });
            const r = applyPatch(req.body || {});
            if (r.error) return res.status(400).json({ error: r.error });
            const keys = Object.keys(r.patch);
            if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
            q.run(`UPDATE v2_bridges_editions SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`,
                [...keys.map(k => r.patch[k]), nowIso(), (req.user && req.user.email) || null, row.id]);
            persist();
            res.json({ success: true, edition: shapeEdition(q.get('SELECT * FROM v2_bridges_editions WHERE id = ?', [row.id])) });
        } catch (e) { fail(res, e, 'edition update'); }
    });

    // POST /api/v2/bridges/editions — a new past-edition row (city required, edition_no auto)
    app.post('/api/v2/bridges/editions', auth, adminOnly, (req, res) => {
        try {
            const r = applyPatch(req.body || {});
            if (r.error) return res.status(400).json({ error: r.error });
            if (!r.patch.city) return res.status(400).json({ error: 'city is required' });
            if (r.patch.edition_no === undefined) {
                const max = q.get('SELECT MAX(edition_no) AS m FROM v2_bridges_editions');
                r.patch.edition_no = ((max && Number(max.m)) || 0) + 1;
            }
            const id = uuid();
            const keys = Object.keys(r.patch);
            q.run(`INSERT INTO v2_bridges_editions (id, ${keys.join(', ')}, updated_at, updated_by) VALUES (?${', ?'.repeat(keys.length)}, ?, ?)`,
                [id, ...keys.map(k => r.patch[k]), nowIso(), (req.user && req.user.email) || null]);
            persist();
            res.json({ success: true, edition: shapeEdition(q.get('SELECT * FROM v2_bridges_editions WHERE id = ?', [id])) });
        } catch (e) { fail(res, e, 'edition create'); }
    });

    // GET /api/v2/bridges/stats — the reusable widget payload (all three scopes)
    app.get('/api/v2/bridges/stats', auth, adminOnly, (req, res) => {
        try { res.json({ ok: true, stats: statsPayload() }); } catch (e) { fail(res, e, 'stats read'); }
    });
    // PUT /api/v2/bridges/stats {scope, key, value|null} — type over any number; null/'' clears back to the live value
    app.put('/api/v2/bridges/stats', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const scope = String(b.scope || '');
            const key = String(b.key || '');
            if (!SCOPES.includes(scope)) return res.status(400).json({ error: 'scope must be bridges, all or y2026', code: 'scope' });
            if (!STAT_KEYS.includes(key)) return res.status(400).json({ error: 'key must be guests, cities, countries or speakers', code: 'key' });
            const value = b.value == null ? '' : String(b.value).trim().slice(0, 24);
            const existing = q.get(`SELECT id FROM v2_stats_overrides WHERE hub = 'bridges' AND scope = ? AND stat_key = ?`, [scope, key]);
            if (!value) { if (existing) q.run(`DELETE FROM v2_stats_overrides WHERE id = ?`, [existing.id]); }
            else if (existing) q.run(`UPDATE v2_stats_overrides SET value = ?, updated_at = ?, updated_by = ? WHERE id = ?`, [value, nowIso(), req.user.email || null, existing.id]);
            else q.run(`INSERT INTO v2_stats_overrides (id, hub, scope, stat_key, value, updated_at, updated_by) VALUES (?, 'bridges', ?, ?, ?, ?, ?)`, [uuid(), scope, key, value, nowIso(), req.user.email || null]);
            persist();
            res.json({ ok: true, stats: statsPayload(), cleared: !value });
        } catch (e) { fail(res, e, 'stats write'); }
    });

    // POST /api/v2/bridges/followups {name, why?, tag?} — never lose a good contact again
    app.post('/api/v2/bridges/followups', auth, adminOnly, (req, res) => {
        try {
            const name = String((req.body || {}).name || '').trim().slice(0, 200);
            if (!name) return res.status(400).json({ error: 'Type who to follow up with first.', code: 'name' });
            const id = uuid();
            q.run(`INSERT INTO v2_bridges_followups (id, name, why, tag, created_by, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
                [id, name, String((req.body || {}).why || 'Follow up').trim().slice(0, 400), String((req.body || {}).tag || 'FOLLOW UP').trim().toUpperCase().slice(0, 40), req.user.email || 'admin']);
            persist();
            res.json({ ok: true, followup: q.get(`SELECT * FROM v2_bridges_followups WHERE id = ?`, [id]) });
        } catch (e) { fail(res, e, 'followup create'); }
    });
    // PUT /api/v2/bridges/followups/:id {done:true|false} — tick done (with undo)
    app.put('/api/v2/bridges/followups/:id', auth, adminOnly, (req, res) => {
        try {
            const row = q.get(`SELECT * FROM v2_bridges_followups WHERE id = ?`, [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Follow-up not found.', code: 'unknown' });
            const done = !!(req.body || {}).done;
            q.run(`UPDATE v2_bridges_followups SET done_at = ?, updated_at = ? WHERE id = ?`, [done ? nowIso() : null, nowIso(), row.id]);
            persist();
            res.json({ ok: true, followup: q.get(`SELECT * FROM v2_bridges_followups WHERE id = ?`, [row.id]) });
        } catch (e) { fail(res, e, 'followup update'); }
    });

    // POST /api/v2/bridges/events/:id/queue-email {kind} — invitations · reminders · thank-yous,
    // staged as an approval-gated batch. Audiences:
    //   invitation → the Croatians-abroad diaspora list that ticked Building Bridges (the existing
    //                emails-by-event audience) — dedup + valid addresses only
    //   reminder   → everyone registered for THIS event
    //   thankyou   → everyone checked in at THIS event (falls back to all registered)
    app.post('/api/v2/bridges/events/:id/queue-email', auth, adminOnly, (req, res) => {
        try {
            const e = q.get(`SELECT * FROM bridges_events WHERE id = ?`, [req.params.id]);
            if (!e) return res.status(404).json({ error: 'Event not found.', code: 'unknown' });
            const kind = String((req.body || {}).kind || '');
            if (!['invitation', 'reminder', 'thankyou'].includes(kind)) return res.status(400).json({ error: 'kind must be invitation, reminder or thankyou', code: 'kind' });
            let people = [];
            if (kind === 'invitation') {
                people = q.all(`SELECT first_name, last_name, email FROM croatians_abroad_registrations WHERE selected_bridges = 1 AND COALESCE(source,'croatians-abroad') <> 'plexus'`);
                if (!people.length) return res.status(400).json({ error: 'No diaspora contacts have ticked Building Bridges yet — grow the list from People → Croatians abroad first.', code: 'empty' });
            } else {
                people = q.all(`SELECT first_name, last_name, email, checked_in FROM bridges_registrations WHERE event_id = ? AND COALESCE(status,'registered') <> 'cancelled'`, [e.id]);
                if (kind === 'thankyou') { const ci = people.filter(p => p.checked_in); if (ci.length) people = ci; }
                if (!people.length) return res.status(400).json({ error: `No one is registered for ${e.city} yet — there is nobody to ${kind === 'reminder' ? 'remind' : 'thank'}.`, code: 'empty' });
            }
            const seen = new Set();
            const rows = [];
            const when = eventWhen(e);
            const venue = e.venue_name && !/tba|announce/i.test(e.venue_name) ? e.venue_name : 'venue announced soon';
            for (const p of people) {
                const to = String(p.email || '').trim().toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || seen.has(to)) continue;
                seen.add(to);
                const first = String(p.first_name || '').trim();
                let subject, html;
                if (kind === 'invitation') {
                    subject = `An evening in ${e.city} — Building Bridges in Biomedicine`;
                    html = emailShell('BUILDING BRIDGES · ' + String(e.city).toUpperCase(), `An evening in <i>${esc(e.city)}</i>.`,
                        `<p style="margin:0 0 12px">${first ? 'Dear ' + esc(first) + ',' : 'Dear colleague,'}</p>
<p style="margin:0 0 12px">Building Bridges in Biomedicine comes to <strong style="color:#191512">${esc(e.city)}</strong> — ${esc(when)}, ${esc(venue)}. An evening connecting Croatian and international biomedicine; registration is open to anyone.</p>
<p style="margin:0">Seats are limited — reply to this email or register through the Med&amp;X portal.</p>`);
                } else if (kind === 'reminder') {
                    subject = `See you in ${e.city} — ${when}`;
                    html = emailShell('YOUR EVENING IS COMING UP', `See you in <i>${esc(e.city)}</i>.`,
                        `<p style="margin:0 0 12px">${first ? 'Dear ' + esc(first) + ',' : 'Dear colleague,'}</p>
<p style="margin:0 0 12px">A short reminder — <strong style="color:#191512">Building Bridges · ${esc(e.city)}</strong> is on ${esc(when)}, ${esc(venue)}.</p>
<p style="margin:0">Your registration stands; just bring yourself.</p>`, '#c9a962');
                } else {
                    subject = `Thank you for ${e.city}`;
                    html = emailShell('THANK YOU', `What an evening, <i>${esc(e.city)}</i>.`,
                        `<p style="margin:0 0 12px">${first ? 'Dear ' + esc(first) + ',' : 'Dear colleague,'}</p>
<p style="margin:0 0 12px">Thank you for joining <strong style="color:#191512">Building Bridges · ${esc(e.city)}</strong>. The connections made in that room are the whole point — photos and the recap follow on the member page.</p>
<p style="margin:0">Until the next city.</p>`, '#c9a962');
                }
                rows.push({ to, subject, html: html.replace('</body>', `<!-- event_id:${e.id} --></body>`) });
            }
            if (!rows.length) return res.status(400).json({ error: 'No sendable email addresses in that audience.', code: 'empty' });
            // event id inside payload_json (via the html comment) lets the hub show the queued state per event
            const staged = stageBatch('bridges-' + kind, 'bridges_' + kind, rows, req.user.email);
            res.json({ ok: true, ...staged, kind, message: `${staged.count} ${kind === 'thankyou' ? 'thank-you' : kind} email${staged.count === 1 ? '' : 's'} queued — approve in the Outbox to send.` });
        } catch (e) { fail(res, e, 'queue-email'); }
    });

    log('bridges-ops: /api/v2/bridges/{hub,editions,stats,followups,events/:id/queue-email}');
};
