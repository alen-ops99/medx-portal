/**
 * v2/awards-ops.js — PLEXUS GALA AWARDS, admin side (design/AWARDS-SPEC.md §Admin).
 *
 * The Plexus Week hub's AWARDS tab: the overview, the entries table grouped by nominee, the
 * drawer, eligibility and shortlist and winner, the Lifetime Bridge "add laureate", the reviewer
 * panel, the ranking view, decide-and-notify (staged into the Outbox, never sent from here), the
 * fellowship winner's funded gala seat, the gala roster CSV and the MC's printable one-pager.
 *
 *   GET    /api/v2/awards-ops/overview[?edition=]          categories · counts · reviewer progress
 *   GET    /api/v2/awards-ops/categories/:id/entries       candidates (grouped by nominee) + rows
 *   PUT    /api/v2/awards-ops/categories/:id               settings: dates, names, criteria, rubric
 *   POST   /api/v2/awards-ops/categories/:id/merge         { from, into } two spellings, one person
 *   GET    /api/v2/awards-ops/categories/:id/ranking       mean · spread · n, conflicts excluded
 *   POST   /api/v2/awards-ops/categories/:id/laureates     Lifetime Bridge: add a laureate
 *   POST   /api/v2/awards-ops/categories/:id/notify        stage the decision emails into the Outbox
 *   GET    /api/v2/awards-ops/categories/:id/entries.csv   the full export for one award
 *   GET    /api/v2/awards-ops/entries/:id                  the drawer: everything, plus the scores
 *   POST   /api/v2/awards-ops/entries/:id/status           eligible · ineligible · shortlist · winner · decline
 *   POST   /api/v2/awards-ops/entries/:id/notes            the organizer's own note on a row
 *   GET    /api/v2/awards-ops/entries/:id/attachment       302 → a 15-minute presigned S3 GET
 *   GET    /api/v2/awards-ops/reviewers[?edition=]         the panel + how far each reader has got
 *   POST   /api/v2/awards-ops/reviewers                    add + send the invitation (sends at once)
 *   POST   /api/v2/awards-ops/reviewers/:id/resend         same link, sent again
 *   DELETE /api/v2/awards-ops/reviewers/:id                revoke: the room 404s from that moment
 *   PUT    /api/v2/awards-ops/laureates/:id                citation · photo · minutes · order
 *   DELETE /api/v2/awards-ops/laureates/:id                remove a laureate (the entry stays)
 *   GET    /api/v2/awards-ops/roster[?edition=]            the gala roster (JSON)
 *   GET    /api/v2/awards-ops/roster.csv                   the same, for the seating team
 *   GET    /api/v2/awards-ops/one-pager                    the MC's printable sheet
 *
 * PERMISSION: every route sits under /api/v2/awards-ops, mapped to the section id `plexus-awards`
 * in server.js SECTION_ROUTE_MAP. Admins with full access (allowed_sections NULL) have it
 * automatically; a scoped admin needs the grant from Team Access.
 *
 * NOTHING SENDS ITSELF. The only email this module puts on the wire is the reviewer invitation —
 * Alen's own instruction ("admin will assign a few people, send them: do you want to be a
 * reviewer"). Every decision email is STAGED into scheduled_emails as 'pending_approval' and
 * waits under Inbox → Email & Outbox, exactly like the gala payment request and the meetup host
 * message before it.
 *
 * The domain — schema, window, uniqueness, ranking, laureates — is shared/awards-core.js, the
 * SAME module the member backend calls, so a decision made here and a withdrawal made from a
 * public link can never disagree.
 */
'use strict';

const crypto = require('crypto');

const core = require('../../../shared/awards-core');
const editions = require('../../../shared/editions');
const mail = require('../../../shared/award-emails');

const { clean, validEmail, nowIso, fullName } = core;

module.exports = function mountAwardsOps(app, ctx) {
    const { db, auth, adminOnly, sendEmail, saveDb } = ctx;
    const JWT_SECRET = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const log = ctx.log || ((...a) => console.log('[v2/awards-ops]', ...a));

    // ---------------------------------------------------------------- query bag
    function getRow(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    function getAll(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    const q = {
        run: (s, p) => db().run(s, p),
        get: (s, p) => { try { return getRow(s, p); } catch (e) { return null; } },
        all: (s, p) => { try { return getAll(s, p); } catch (e) { return []; } }
    };
    function persist() { try { saveDb(); } catch (e) {} try { db().sync(); } catch (e) {} }
    function auditAdmin(req, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail, created_at) VALUES (?,?,?,?,?,?)',
                [crypto.randomUUID(), (req && req.user && req.user.id) || null, (req && req.user && req.user.email) || 'system',
                 action, String(detail || '').slice(0, 500), nowIso()]);
        } catch (e) { /* best-effort */ }
    }
    const actorOf = (req) => (req && req.user && req.user.email) || 'admin';

    // ---------------------------------------------------------------- schema + seed
    // Same two guards as the member wing: the v2 modules mount alphabetically, so this one can
    // load before an edition exists. The boot call seeds what it can; resolveEdition() re-checks
    // on the first request. Both are idempotent — nothing can be created twice.
    let schemaReady = false, seededFor = null;
    function seedCategoriesFor(ed) {
        if (!ed || seededFor === ed.id) return;
        core.seedCategories(q, ed.id);
        if (core.listCategories(q, ed.id).length) seededFor = ed.id;
    }
    function ensureSchema() {
        try {
            editions.ensureSchema(q);
            editions.seed(q);
            schemaReady = core.ensureSchema(q);
            if (schemaReady) seedCategoriesFor(editions.activeEdition(q));
        } catch (e) { schemaReady = false; }
        return schemaReady && !!seededFor;
    }
    if (!ensureSchema()) {
        let tries = 0;
        const retry = setInterval(() => { if (ensureSchema() || ++tries >= 10) clearInterval(retry); }, 4000);
        if (retry.unref) retry.unref();
    }

    // ---------------------------------------------------------------- tokens + bases
    const sign = (kind, id) => crypto.createHmac('sha256', JWT_SECRET).update(`medxaward:${kind}:${id}`).digest('hex').slice(0, 32);
    const cx = { q, sign };
    // The member portal serves every public awards page — its origin, not ours, goes into anything
    // a nominee, a reviewer or a laureate will click. Same resolution gala-ops and meetups-ops use.
    function memberBase() {
        if (process.env.USER_PORTAL_URL) return String(process.env.USER_PORTAL_URL).replace(/\/+$/, '');
        if (process.env.NODE_ENV === 'production' || process.env.RENDER) return 'https://medx-user-portal.onrender.com';
        return 'http://localhost:3010';
    }
    const reviewUrl = (tok) => `${memberBase()}/awards/review/${tok}`;
    const slidesUrl = (tok) => `${memberBase()}/awards/slides/${tok}`;
    const manageUrl = (tok) => `${memberBase()}/awards/manage/${tok}`;
    const qrUrl = (regId) => `${memberBase()}/qr/${regId}.png`;
    const galaUrl = () => `${memberBase()}/app/gala`;

    const resolveEdition = (query) => {
        const wanted = query && query.edition ? String(query.edition) : null;
        const ed = (wanted && editions.getEdition(q, wanted)) || editions.activeEdition(q);
        if (ed && seededFor !== ed.id) seedCategoriesFor(ed);
        return ed;
    };

    // The S3 signer lives in the member wing (one implementation, one bucket). Loaded lazily and
    // defensively so this module still mounts in a checkout where that wing is absent.
    function s3() {
        try { return require('../../../user-portal/backend/boston')._s3; } catch (e) { return null; }
    }

    // ================================================================ OVERVIEW
    function reviewerProgress(ed) {
        const rows = core.reviewersOf(q, ed.id);
        return rows.map(r => {
            const queue = core.reviewerQueue(q, r);
            return {
                id: r.id, name: r.name, email: r.email, status: r.status,
                categories: core.reviewerCategories(r),
                invited_at: r.invited_at || null, accepted_at: r.accepted_at || null, last_seen: r.last_seen || null,
                scored: queue.scored, total: queue.total,
                percent: queue.total ? Math.round((queue.scored / queue.total) * 100) : 0,
                room_url: reviewUrl(r.token)
            };
        });
    }

    function daysTo(iso) {
        const t = core.zagrebMs(iso);
        if (!Number.isFinite(t)) return null;
        return Math.ceil((t - Date.now()) / 86400000);
    }

    app.get('/api/v2/awards-ops/overview', auth, adminOnly, (req, res) => {
        try {
            const ed = resolveEdition(req.query);
            const all = editions.listEditions(q).map(editions.toJson);
            if (!ed) return res.json({ edition: null, editions: all, categories: [], reviewers: [], stats: {} });
            const list = core.listCategories(q, ed.id).map(cat => Object.assign(core.categoryJson(q, cat), {
                days_to_close: daysTo(cat.closes_at),
                laureate_rows: core.laureatesOf(q, cat.id).map(laureateJson)
            }));
            const reviewers = reviewerProgress(ed);
            res.json({
                edition: editions.toJson(ed), editions: all,
                read_only: ed.status === 'archived',
                categories: list,
                reviewers,
                statuses: core.STATUSES,
                stats: {
                    entries: list.reduce((n, c) => n + c.counts.entries, 0),
                    candidates: list.reduce((n, c) => n + c.counts.candidates, 0),
                    pending_review: list.reduce((n, c) => n + c.counts.pending_review, 0),
                    shortlisted: list.reduce((n, c) => n + c.counts.shortlisted, 0),
                    winners: list.reduce((n, c) => n + c.counts.winner, 0),
                    laureates: list.reduce((n, c) => n + c.laureates, 0),
                    reviewers: reviewers.length,
                    reviewer_percent: reviewers.length ? Math.round(reviewers.reduce((n, r) => n + r.percent, 0) / reviewers.length) : 0
                }
            });
        } catch (e) { log('overview:', e.message); res.status(500).json({ error: 'Could not load the awards.' }); }
    });

    // ================================================================ ENTRIES (grouped by nominee)
    function scoreBlock(entry) {
        const rows = core.scoresOf(q, entry.id);
        const ranking = core.rankScores(rows);
        return Object.assign({}, ranking, {
            per_reviewer: rows.map(s => {
                const r = q.get('SELECT name, email FROM award_reviewers WHERE id = ?', [s.reviewer_id]);
                let scores = {};
                try { scores = JSON.parse(s.scores_json || '{}'); } catch (e) {}
                return {
                    reviewer: (r && r.name) || 'A reader', email: (r && r.email) || null,
                    scores, total: Number(s.total) || 0, comment: s.comment || null,
                    conflict: Number(s.conflict) === 1,
                    at: s.updated_at || s.submitted_at || null
                };
            })
        });
    }

    const laureateJson = (l) => ({
        id: l.id, category_id: l.category_id, entry_id: l.entry_id || null,
        name: l.name, institution: l.institution || null, citation: l.citation || null,
        photo_url: l.photo_url || null, email: l.email || null,
        present_minutes: Number(l.present_minutes) || 0,
        gala_registration_id: l.gala_registration_id || null,
        presentation_confirmed: Number(l.presentation_confirmed) === 1,
        presentation_confirmed_at: l.presentation_confirmed_at || null,
        slides_url: l.slides_token ? slidesUrl(l.slides_token) : null,
        slides_name: l.slides_name || null, slides_uploaded_at: l.slides_uploaded_at || null,
        announced: Number(l.announced) === 1, sort_order: Number(l.sort_order) || 99,
        qr_url: l.gala_registration_id ? qrUrl(l.gala_registration_id) : null
    });

    app.get('/api/v2/awards-ops/categories/:id/entries', auth, adminOnly, (req, res) => {
        try {
            const cat = core.categoryById(q, req.params.id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const wantStatus = clean(req.query.status, 40);
            const term = clean(req.query.q, 80).toLowerCase();
            const cands = core.candidatesOf(q, cat.id)
                .filter(c => !wantStatus || c.status === wantStatus)
                .filter(c => !term || [c.name, c.email, c.institution, c.position].filter(Boolean).some(v => String(v).toLowerCase().includes(term)))
                .map(c => ({
                    key: c.key, name: c.name, email: c.email, institution: c.institution, position: c.position,
                    country: c.country, birth_year: c.birth_year,
                    status: c.status, nominations: c.nominations, self_nominated: c.self_nominated,
                    nominators: c.nominators,
                    lead_entry_id: c.lead_entry_id,
                    entries: c.entries.map(e => core.entryJson(e)),
                    scores: scoreBlock(c.entries[0])
                }));
            res.json({
                category: core.categoryJson(q, cat),
                rubric: core.rubricOf(cat),
                candidates: cands,
                laureates: core.laureatesOf(q, cat.id).map(laureateJson),
                withdrawn: core.entriesOf(q, cat.id).filter(e => e.status === 'withdrawn').map(e => core.entryJson(e))
            });
        } catch (e) { log('entries:', e.message); res.status(500).json({ error: 'Could not load the entries.' }); }
    });

    app.get('/api/v2/awards-ops/entries/:id', auth, adminOnly, (req, res) => {
        try {
            const entry = core.entryById(q, req.params.id);
            if (!entry) return res.status(404).json({ error: 'Entry not found' });
            const cat = core.categoryById(q, entry.category_id);
            const siblings = core.entriesOf(q, entry.category_id)
                .filter(e => String(e.nominee_key) === String(entry.nominee_key) && e.id !== entry.id);
            res.json({
                entry: core.entryJson(entry),
                category: cat ? core.categoryJson(q, cat) : null,
                rubric: cat ? core.rubricOf(cat) : [],
                scores: scoreBlock(entry),
                nominators: [entry].concat(siblings)
                    .filter(e => e.nominator_name || e.nominator_email)
                    .map(e => ({ name: e.nominator_name, email: e.nominator_email, relation: e.nominator_relation, entry_id: e.id, at: e.created_at })),
                other_entries: siblings.map(e => core.entryJson(e)),
                attachment_url: entry.attachment_key ? `/api/v2/awards-ops/entries/${entry.id}/attachment` : null,
                manage_url: entry.manage_token ? manageUrl(entry.manage_token) : null
            });
        } catch (e) { log('entry:', e.message); res.status(500).json({ error: 'Could not load that entry.' }); }
    });

    app.get('/api/v2/awards-ops/entries/:id/attachment', auth, adminOnly, (req, res) => {
        try {
            const entry = core.entryById(q, req.params.id);
            if (!entry || !entry.attachment_key) return res.status(404).json({ error: 'Not found' });
            const signer = s3();
            const url = signer && signer.presignGet(entry.attachment_key, { expires: 900, filename: entry.attachment_name || 'entry.pdf' });
            if (!url) return res.status(503).json({ error: 'Attachments are not available on this server yet.' });
            res.redirect(302, url);
        } catch (e) { res.status(500).json({ error: 'Unavailable' }); }
    });

    // ================================================================ DECISIONS
    app.post('/api/v2/awards-ops/entries/:id/status', auth, adminOnly, (req, res) => {
        try {
            const entry = core.entryById(q, req.params.id);
            if (!entry) return res.status(404).json({ error: 'Entry not found' });
            const cat = core.categoryById(q, entry.category_id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const status = clean((req.body || {}).status, 30);
            if (!core.STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
            const out = core.setStatus(cx, entry, status, actorOf(req), { reason: clean((req.body || {}).reason, 300) });
            if (out.error) return res.status(out.error === 'notfound' ? 404 : 400).json({ error: out.error });
            // A fellowship winner's funded seat is minted the moment they become a winner, not at
            // notify time: the seat is the decision, and creating it here keeps it EXACTLY ONCE
            // (the laureate row carries the registration id, and a matching seat is reused).
            let seat = null;
            if (out.laureate && String(cat.key) === 'fellowship') seat = ensureGalaSeat(out.laureate, cat, actorOf(req));
            persist();
            auditAdmin(req, 'awards.status', `${fullName(entry)} → ${status} (${cat.name})`);
            res.json({
                success: true,
                entry: core.entryJson(core.entryById(q, entry.id)),
                laureate: out.laureate ? laureateJson(q.get('SELECT * FROM award_laureates WHERE id = ?', [out.laureate.id])) : null,
                gala_seat: seat
            });
        } catch (e) { log('status:', e.message); res.status(500).json({ error: 'Could not change that.' }); }
    });

    app.post('/api/v2/awards-ops/entries/:id/notes', auth, adminOnly, (req, res) => {
        try {
            const entry = core.entryById(q, req.params.id);
            if (!entry) return res.status(404).json({ error: 'Entry not found' });
            const notes = clean((req.body || {}).notes, 4000) || null;
            q.run('UPDATE award_entries SET admin_notes = ?, updated_at = ? WHERE id = ?', [notes, nowIso(), entry.id]);
            core.audit(q, entry.id, entry.category_id, 'note', 'organizer note updated', actorOf(req));
            persist();
            res.json({ success: true, notes });
        } catch (e) { res.status(500).json({ error: 'Could not save that note.' }); }
    });

    app.post('/api/v2/awards-ops/categories/:id/merge', auth, adminOnly, (req, res) => {
        try {
            const cat = core.categoryById(q, req.params.id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const b = req.body || {};
            const out = core.mergeCandidates(cx, cat.id, clean(b.from, 300), clean(b.into, 300), actorOf(req));
            if (out.error) return res.status(400).json({ error: out.error });
            persist();
            auditAdmin(req, 'awards.merge', `${b.from} → ${b.into} in ${cat.name}`);
            res.json(Object.assign({ success: true }, out));
        } catch (e) { log('merge:', e.message); res.status(500).json({ error: 'Could not merge those.' }); }
    });

    // ================================================================ RANKING
    app.get('/api/v2/awards-ops/categories/:id/ranking', auth, adminOnly, (req, res) => {
        try {
            const cat = core.categoryById(q, req.params.id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const rows = core.rankingFor(q, cat.id).map((r, i) => ({
                rank: i + 1,
                entry: core.entryJson(r.entry),
                mean: r.ranking.mean, min: r.ranking.min, max: r.ranking.max,
                spread: r.ranking.spread, n: r.ranking.n, conflicts: r.ranking.conflicts
            }));
            res.json({
                category: core.categoryJson(q, cat),
                rubric: core.rubricOf(cat),
                max_total: core.rubricOf(cat).length * core.SCORE_MAX,
                ranking: rows,
                note: 'Conflict-flagged scores are excluded from the mean, the spread and n.'
            });
        } catch (e) { log('ranking:', e.message); res.status(500).json({ error: 'Could not build the ranking.' }); }
    });

    // ================================================================ SETTINGS
    const ISO_AT = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
    app.put('/api/v2/awards-ops/categories/:id', auth, adminOnly, (req, res) => {
        try {
            const cat = core.categoryById(q, req.params.id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const b = req.body || {};
            const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
            const patch = {}; const errors = [];
            if (has('name')) { const v = clean(b.name, 200); if (!v) errors.push('A name is needed.'); else patch.name = v; }
            if (has('name_hr')) patch.name_hr = clean(b.name_hr, 200) || null;
            if (has('citation')) patch.citation = clean(b.citation, 600) || null;
            if (has('citation_hr')) patch.citation_hr = clean(b.citation_hr, 600) || null;
            if (has('criteria_md')) patch.criteria_md = clean(b.criteria_md, 20000) || null;
            if (has('criteria_md_hr')) patch.criteria_md_hr = clean(b.criteria_md_hr, 20000) || null;
            if (has('allow_self')) patch.allow_self = (b.allow_self === false || b.allow_self === 0 || b.allow_self === '0') ? 0 : 1;
            if (has('laureates_max')) {
                const n = parseInt(b.laureates_max, 10);
                if (!Number.isFinite(n) || n < 1 || n > 10) errors.push('laureates_max must be between 1 and 10.');
                else patch.laureates_max = n;
            }
            for (const f of ['opens_at', 'closes_at']) {
                if (!has(f)) continue;
                const v = clean(b[f], 30) || null;
                if (v && !ISO_AT.test(v)) errors.push(`${f} must look like 2026-10-01T09:00.`);
                else patch[f] = v;
            }
            if (has('rubric')) {
                const list = Array.isArray(b.rubric) ? b.rubric : null;
                if (!list || !list.length) errors.push('The rubric needs at least one criterion.');
                else patch.rubric_json = JSON.stringify(list.slice(0, 5).map(r => ({
                    key: clean(r.key, 40) || 'criterion', label: clean(r.label, 60) || 'Criterion',
                    label_hr: clean(r.label_hr, 60) || null, desc: clean(r.desc, 300) || null
                })));
            }
            if (errors.length) return res.status(400).json({ error: errors[0], errors });
            const keys = Object.keys(patch);
            if (!keys.length) return res.status(400).json({ error: 'Nothing to update.' });
            patch.updated_at = nowIso();
            const all = Object.keys(patch);
            q.run(`UPDATE award_categories SET ${all.map(k => k + ' = ?').join(', ')} WHERE id = ?`, all.map(k => patch[k]).concat([cat.id]));
            core.audit(q, null, cat.id, 'settings', keys.join(', '), actorOf(req));
            auditAdmin(req, 'awards.settings', `${cat.name}: ${keys.join(', ')}`);
            persist();
            res.json({ success: true, category: core.categoryJson(q, core.categoryById(q, cat.id)) });
        } catch (e) { log('settings:', e.message); res.status(500).json({ error: 'Could not save those settings.' }); }
    });

    // ================================================================ LAUREATES
    app.post('/api/v2/awards-ops/categories/:id/laureates', auth, adminOnly, (req, res) => {
        try {
            const cat = core.categoryById(q, req.params.id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const out = core.addLaureate(cx, cat, req.body || {}, actorOf(req));
            if (out.error) return res.status(400).json({ error: out.error });
            persist();
            auditAdmin(req, 'awards.laureate_add', `${out.laureate.name} — ${cat.name}`);
            res.json({ success: true, laureate: laureateJson(out.laureate) });
        } catch (e) { log('laureate add:', e.message); res.status(500).json({ error: 'Could not add that laureate.' }); }
    });

    app.put('/api/v2/awards-ops/laureates/:id', auth, adminOnly, (req, res) => {
        try {
            const l = q.get('SELECT * FROM award_laureates WHERE id = ?', [String(req.params.id)]);
            if (!l) return res.status(404).json({ error: 'Laureate not found' });
            const b = req.body || {};
            const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
            const patch = {};
            if (has('name')) { const v = clean(b.name, 160); if (v) patch.name = v; }
            if (has('institution')) patch.institution = clean(b.institution, 200) || null;
            if (has('citation')) patch.citation = clean(b.citation, 600) || null;
            if (has('photo_url')) patch.photo_url = clean(b.photo_url, 500) || null;
            if (has('email')) patch.email = clean(b.email, 200) || null;
            if (has('present_minutes')) patch.present_minutes = Math.max(0, Math.min(30, parseInt(b.present_minutes, 10) || 0));
            if (has('sort_order')) patch.sort_order = Math.max(1, Math.min(99, parseInt(b.sort_order, 10) || 1));
            if (has('announced')) patch.announced = b.announced ? 1 : 0;
            const keys = Object.keys(patch);
            if (!keys.length) return res.status(400).json({ error: 'Nothing to update.' });
            q.run(`UPDATE award_laureates SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`, keys.map(k => patch[k]).concat([l.id]));
            core.audit(q, l.entry_id, l.category_id, 'laureate-updated', keys.join(', '), actorOf(req));
            persist();
            res.json({ success: true, laureate: laureateJson(q.get('SELECT * FROM award_laureates WHERE id = ?', [l.id])) });
        } catch (e) { res.status(500).json({ error: 'Could not save that laureate.' }); }
    });

    app.delete('/api/v2/awards-ops/laureates/:id', auth, adminOnly, (req, res) => {
        try {
            const l = q.get('SELECT * FROM award_laureates WHERE id = ?', [String(req.params.id)]);
            if (!l) return res.status(404).json({ error: 'Laureate not found' });
            q.run('DELETE FROM award_laureates WHERE id = ?', [l.id]);
            core.audit(q, l.entry_id, l.category_id, 'laureate-removed', l.name, actorOf(req));
            auditAdmin(req, 'awards.laureate_remove', l.name);
            persist();
            // The comp seat, if one was issued, is NOT silently cancelled — a seat is a person's
            // evening, and cancelling it belongs to the Gala screen where it can be seen.
            res.json({ success: true, gala_registration_id: l.gala_registration_id || null });
        } catch (e) { res.status(500).json({ error: 'Could not remove that laureate.' }); }
    });

    // ---------------------------------------------------------------- the funded gala seat
    /**
     * A Fellowship laureate's seat, created EXACTLY ONCE.
     *   1. the laureate row already carries a registration id → that seat, untouched;
     *   2. a live gala_registrations row already exists for the address → link it, never a twin
     *      (a Fellow who had already bought a ticket keeps the one seat they have);
     *   3. otherwise a comp row: payment_status 'comp', amount_paid 0, the spec's own note.
     * The ticket pipeline itself is NOT duplicated: /qr/<id>.png renders from this row, the member
     * wallet lists it, and the door scanner validates it — exactly as for any other gala guest.
     */
    function ensureGalaSeat(laureate, cat, actor) {
        try {
            if (laureate.gala_registration_id) {
                const r = q.get('SELECT * FROM gala_registrations WHERE id = ?', [laureate.gala_registration_id]);
                if (r) return { id: r.id, created: false, qr_url: qrUrl(r.id) };
            }
            const entry = laureate.entry_id ? core.entryById(q, laureate.entry_id) : null;
            const email = clean((entry && entry.nominee_email) || laureate.email, 200).toLowerCase();
            if (!email || !validEmail(email)) return null;
            const existing = q.get(`SELECT * FROM gala_registrations
                                     WHERE lower(email) = lower(?) AND COALESCE(status,'') NOT IN ('cancelled','rejected','declined','expired')
                                     ORDER BY created_at LIMIT 1`, [email]);
            if (existing) {
                q.run('UPDATE award_laureates SET gala_registration_id = ? WHERE id = ?', [existing.id, laureate.id]);
                core.audit(q, laureate.entry_id, cat.id, 'gala-seat-linked', `${email} → ${existing.id}`, actor);
                return { id: existing.id, created: false, linked: true, qr_url: qrUrl(existing.id) };
            }
            const parts = String(laureate.name || '').trim().split(/\s+/);
            const first = parts[0] || laureate.name || 'Fellow';
            const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
            const id = crypto.randomUUID();
            q.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, status,
                                                   payment_status, amount_paid, pricing, admin_notes, created_at)
                   VALUES (?,?,?,?,?,'confirmed','comp',0,?,?,?)`,
                [id, first, last, email, (entry && entry.nominee_institution) || laureate.institution || null,
                 'fellowship', 'Plexus Fellowship laureate', nowIso()]);
            q.run('UPDATE award_laureates SET gala_registration_id = ? WHERE id = ?', [id, laureate.id]);
            core.audit(q, laureate.entry_id, cat.id, 'gala-seat-comped', `${email} → ${id}`, actor);
            log(`fellowship laureate ${laureate.name} given a comp gala seat (${id})`);
            return { id, created: true, qr_url: qrUrl(id) };
        } catch (e) { log('gala seat:', e.message); return null; }
    }

    // ================================================================ DECIDE & NOTIFY → OUTBOX
    /**
     * Stage one email as a DRAFT in the approval outbox. Same table and same payload shape every
     * other module uses (v2/meetups.js, v2/gala-ops.js), so the drafts appear under
     * Inbox → Email & Outbox with the standard APPROVE & SEND — the only path to an actual send.
     */
    function stage(batch, to, subject, html, template, extra) {
        if (!to || !validEmail(to)) return false;
        try {
            q.run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                   VALUES (?, 'pending_approval', ?, 'v2-awards-ops', ?, ?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), batch, template,
                 JSON.stringify(Object.assign({ to, subject, html, channel: 'email', project: 'awards' }, extra || {})),
                 to, subject, (extra && extra.actor) || 'admin', nowIso()]);
            return true;
        } catch (e) { log('stage:', e.message); return false; }
    }

    function localeOf(entry) { return core.LANGS.includes(String(entry && entry.language)) ? entry.language : 'en'; }

    app.post('/api/v2/awards-ops/categories/:id/notify', auth, adminOnly, (req, res) => {
        try {
            const cat = core.categoryById(q, req.params.id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const b = req.body || {};
            const preview = b.preview === true || b.preview === 'true';
            const want = {
                winners: b.winners !== false,
                shortlisted: b.shortlisted !== false,
                declined: b.declined !== false,
                nominators: b.nominators !== false
            };
            const rows = core.entriesOf(q, cat.id).filter(e => !e.merged_into);
            const winners = rows.filter(e => e.status === 'winner');
            if (want.winners && !winners.length && !core.laureatesOf(q, cat.id).length) {
                return res.status(400).json({ error: 'No winner is chosen yet — pick one first, then notify.' });
            }
            const batch = 'awards-' + String(cat.key) + '-' + Date.now().toString(36);
            const actor = actorOf(req);
            const drafts = [];
            const push = (kind, to, subject, html, entryId) => {
                drafts.push({ kind, to, subject, entry_id: entryId || null, html_length: html.length });
                if (!preview) {
                    stage(batch, to, subject, html, 'award_' + kind, { actor, award: cat.name, entry_id: entryId || null });
                    if (entryId) {
                        q.run('UPDATE award_entries SET notified_at = ?, notify_kind = ?, updated_at = ? WHERE id = ?',
                            [nowIso(), kind, nowIso(), entryId]);
                    }
                }
            };

            if (want.winners) {
                for (const e of winners) {
                    const locale = localeOf(e);
                    const laureate = q.get('SELECT * FROM award_laureates WHERE entry_id = ?', [e.id]);
                    const to = e.nominee_email || (laureate && laureate.email);
                    if (!to) continue;
                    if (String(cat.key) === 'fellowship') {
                        const seat = laureate ? ensureGalaSeat(laureate, cat, actor) : null;
                        const fresh = laureate ? q.get('SELECT * FROM award_laureates WHERE id = ?', [laureate.id]) : null;
                        push('fellowship_winner', to,
                            locale === 'hr' ? 'Vi ste Plexus stipendist — Med&X' : 'You are a Plexus Fellow — Med&X',
                            mail.fellowshipWinner({
                                firstName: e.nominee_first || null, locale, awardName: cat.name,
                                qrPngUrl: seat && seat.id ? qrUrl(seat.id) : null,
                                slidesUrl: fresh && fresh.slides_token ? slidesUrl(fresh.slides_token) : null,
                                confirmUrl: fresh && fresh.slides_token ? slidesUrl(fresh.slides_token) : null
                            }), e.id);
                    } else {
                        push('winner', to,
                            locale === 'hr' ? `Nagrada je vaša — ${cat.name}` : `The award is yours — ${cat.name}`,
                            mail.winner({
                                firstName: e.nominee_first || null, locale, awardName: cat.name,
                                laureateName: fullName(e), citation: (laureate && laureate.citation) || cat.citation || null,
                                replyUrl: galaUrl()
                            }), e.id);
                    }
                }
                // Organizer-chosen laureates (Lifetime Bridge) have no entry behind them.
                for (const l of core.laureatesOf(q, cat.id).filter(x => !x.entry_id)) {
                    if (!l.email || !validEmail(l.email)) continue;
                    push('winner', l.email, `The award is yours — ${cat.name}`,
                        mail.winner({
                            firstName: String(l.name || '').split(/\s+/)[0] || null, locale: 'en',
                            awardName: cat.name, laureateName: l.name,
                            citation: l.citation || cat.citation || null, replyUrl: galaUrl()
                        }), null);
                }
            }
            if (want.shortlisted) {
                for (const e of rows.filter(x => x.status === 'shortlisted')) {
                    const to = e.nominee_email; if (!to) continue;
                    const locale = localeOf(e);
                    push('shortlisted', to,
                        locale === 'hr' ? `O ovogodišnjoj nagradi — ${cat.name}` : `About this year’s award — ${cat.name}`,
                        mail.shortlisted({ firstName: e.nominee_first || null, locale, awardName: cat.name }), e.id);
                }
            }
            if (want.declined) {
                for (const e of rows.filter(x => ['declined', 'eligible', 'received'].includes(String(x.status)) && x.status !== 'winner')) {
                    const to = e.kind === 'application' ? e.nominee_email : (e.nominee_email || e.nominator_email);
                    if (!to) continue;
                    const locale = localeOf(e);
                    push('declined', to,
                        locale === 'hr' ? `Odluka — ${cat.name}` : `The decision — ${cat.name}`,
                        mail.declined({
                            firstName: (e.nominee_first || e.nominator_name || '').split(/\s+/)[0] || null,
                            locale, awardName: cat.name, isApplication: e.kind === 'application'
                        }), e.id);
                }
            }
            if (want.nominators) {
                const seen = new Set();
                for (const e of rows.filter(x => x.kind === 'nomination' && x.nominator_email)) {
                    const to = String(e.nominator_email).toLowerCase();
                    if (seen.has(to)) continue;
                    seen.add(to);
                    const locale = localeOf(e);
                    push('thanks_nominator', to,
                        locale === 'hr' ? `Hvala na nominaciji — ${cat.name}` : `Thank you for nominating — ${cat.name}`,
                        mail.thankYouNominator({
                            firstName: String(e.nominator_name || '').split(/\s+/)[0] || null, locale,
                            nomineeName: fullName(e), galaUrl: galaUrl()
                        }), null);
                }
            }

            if (!preview) {
                core.audit(q, null, cat.id, 'notify-staged', `${drafts.length} draft(s), batch ${batch}`, actor);
                auditAdmin(req, 'awards.notify', `${cat.name}: ${drafts.length} draft(s) staged for approval`);
                persist();
            }
            res.json({
                success: true, preview, batch: preview ? null : batch,
                staged: preview ? 0 : drafts.length,
                drafts: drafts.map(d => ({ kind: d.kind, to: d.to, subject: d.subject })),
                approval_required: true,
                message: preview
                    ? `${drafts.length} email${drafts.length === 1 ? '' : 's'} would be staged — nothing has been written yet.`
                    : 'The letters are waiting in the Outbox for your approval — nothing goes out until you send them.'
            });
        } catch (e) { log('notify:', e.message); res.status(500).json({ error: 'Could not stage those letters.' }); }
    });

    // ================================================================ REVIEWERS
    app.get('/api/v2/awards-ops/reviewers', auth, adminOnly, (req, res) => {
        try {
            const ed = resolveEdition(req.query);
            if (!ed) return res.json({ reviewers: [], categories: [] });
            res.json({
                edition: editions.toJson(ed),
                reviewers: reviewerProgress(ed),
                categories: core.listCategories(q, ed.id).map(c => ({ id: c.id, key: c.key, name: c.name }))
            });
        } catch (e) { log('reviewers:', e.message); res.status(500).json({ error: 'Could not load the panel.' }); }
    });

    async function sendInvitation(r, ed) {
        const names = core.reviewerCategories(r)
            .map(id => { const c = core.categoryById(q, id); return c ? c.name : null; })
            .filter(Boolean);
        const closes = core.listCategories(q, ed.id).map(c => c.closes_at).filter(Boolean).sort().pop();
        const html = mail.reviewerInvitation({
            firstName: String(r.name || '').split(/\s+/)[0] || null,
            categoryNames: names,
            roomUrl: reviewUrl(r.token),
            closesLabel: closes ? String(closes).slice(0, 10) : null
        });
        try {
            await sendEmail(r.email, 'Would you read for the Plexus awards? — Med&X', html);
            q.run('UPDATE award_reviewers SET invited_at = ? WHERE id = ?', [nowIso(), r.id]);
            return true;
        } catch (e) { log('reviewer invite failed:', e.message); return false; }
    }

    app.post('/api/v2/awards-ops/reviewers', auth, adminOnly, async (req, res) => {
        try {
            const ed = resolveEdition(req.query.edition ? req.query : (req.body || {}));
            if (!ed) return res.status(400).json({ error: 'No Plexus Week edition exists yet.' });
            const b = req.body || {};
            const name = clean(b.name, 160);
            const email = clean(b.email, 200).toLowerCase();
            if (!name) return res.status(400).json({ error: 'A name is needed.' });
            if (!validEmail(email)) return res.status(400).json({ error: 'That email address does not look right.' });
            const wanted = (Array.isArray(b.categories) ? b.categories : String(b.categories || '').split(','))
                .map(x => clean(x, 80)).filter(Boolean);
            const valid = wanted.filter(id => !!core.categoryById(q, id));
            if (!valid.length) return res.status(400).json({ error: 'Give the reader at least one award to read.' });

            const prior = q.get('SELECT * FROM award_reviewers WHERE edition_id = ? AND lower(email) = lower(?)', [ed.id, email]);
            let row;
            if (prior) {
                q.run("UPDATE award_reviewers SET name = ?, categories = ?, status = CASE WHEN status = 'revoked' THEN 'invited' ELSE status END WHERE id = ?",
                    [name, JSON.stringify(valid), prior.id]);
                row = q.get('SELECT * FROM award_reviewers WHERE id = ?', [prior.id]);
            } else {
                const id = crypto.randomUUID();
                q.run(`INSERT INTO award_reviewers (id, edition_id, name, email, categories, token, invited_at, status)
                       VALUES (?,?,?,?,?,?,?, 'invited')`,
                    [id, ed.id, name, email, JSON.stringify(valid), sign('reviewer', id), nowIso()]);
                row = q.get('SELECT * FROM award_reviewers WHERE id = ?', [id]);
            }
            persist();
            // The invitation is the ONE email this module sends directly — Alen's instruction.
            const sent = (b.notify === false) ? false : await sendInvitation(row, ed);
            persist();
            auditAdmin(req, 'awards.reviewer_add', `${name} <${email}> · ${valid.length} award(s)${sent ? ' · invited' : ''}`);
            res.json({ success: true, invited: sent, reviewer: reviewerProgress(ed).find(x => x.id === row.id) || null });
        } catch (e) { log('reviewer add:', e.message); res.status(500).json({ error: 'Could not add that reader.' }); }
    });

    app.post('/api/v2/awards-ops/reviewers/:id/resend', auth, adminOnly, async (req, res) => {
        try {
            const r = q.get('SELECT * FROM award_reviewers WHERE id = ?', [String(req.params.id)]);
            if (!r) return res.status(404).json({ error: 'Reader not found' });
            if (String(r.status) === 'revoked') return res.status(400).json({ error: 'That reader was revoked — add them again to reinstate the link.' });
            const ed = editions.getEdition(q, r.edition_id);
            const sent = await sendInvitation(r, ed || { id: r.edition_id });
            persist();
            auditAdmin(req, 'awards.reviewer_resend', `${r.email}${sent ? '' : ' (send failed)'}`);
            res.json({ success: true, sent, room_url: reviewUrl(r.token) });
        } catch (e) { res.status(500).json({ error: 'Could not resend that invitation.' }); }
    });

    app.delete('/api/v2/awards-ops/reviewers/:id', auth, adminOnly, (req, res) => {
        try {
            const r = q.get('SELECT * FROM award_reviewers WHERE id = ?', [String(req.params.id)]);
            if (!r) return res.status(404).json({ error: 'Reader not found' });
            // Revoked, not deleted: the scores they already gave stay in the ranking, and the room
            // 404s from this moment on. Deleting the row would silently rewrite decided numbers.
            q.run("UPDATE award_reviewers SET status = 'revoked' WHERE id = ?", [r.id]);
            core.audit(q, null, null, 'reviewer-revoked', r.email, actorOf(req));
            auditAdmin(req, 'awards.reviewer_revoke', r.email);
            persist();
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Could not revoke that reader.' }); }
    });

    // ================================================================ EXPORTS
    const cell = (v) => {
        const s = String(v == null ? '' : v);
        return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
    };
    const csv = (head, rows) => '﻿' + [head.map(cell).join(',')].concat(rows.map(r => r.map(cell).join(','))).join('\r\n');

    app.get('/api/v2/awards-ops/categories/:id/entries.csv', auth, adminOnly, (req, res) => {
        try {
            const cat = core.categoryById(q, req.params.id);
            if (!cat) return res.status(404).json({ error: 'Award not found' });
            const head = ['Nominee', 'Email', 'Institution', 'Position', 'Country', 'Birth year', 'Kind', 'Status',
                'Nominator', 'Nominator email', 'Relation', 'School', 'Year', 'Willing to present', 'Attachment',
                'Mean', 'Spread', 'Scores counted', 'Conflicts', 'Submitted'];
            const rows = core.entriesOf(q, cat.id).map(e => {
                const r = core.rankEntry(q, e);
                return [fullName(e), e.nominee_email || '', e.nominee_institution || '', e.nominee_position || '',
                    e.nominee_country || '', e.nominee_birth_year || '', e.kind, e.status,
                    e.nominator_name || '', e.nominator_email || '', e.nominator_relation || '',
                    e.school || '', e.study_year || '', Number(e.willing_to_present) === 1 ? 'yes' : 'no',
                    e.attachment_name || '', r.mean == null ? '' : r.mean, r.spread == null ? '' : r.spread,
                    r.n, r.conflicts, String(e.created_at || '').slice(0, 19)];
            });
            const slug = String(cat.key || 'award').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'award';
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="medx-awards-${slug}.csv"`);
            res.send(csv(head, rows));
        } catch (e) { log('csv:', e.message); res.status(500).json({ error: 'Could not build the export.' }); }
    });

    /** Every laureate of an edition, in gala order — the roster the seating team and the MC use. */
    function roster(ed) {
        const out = [];
        for (const cat of core.listCategories(q, ed.id)) {
            for (const l of core.laureatesOf(q, cat.id)) {
                const entry = l.entry_id ? core.entryById(q, l.entry_id) : null;
                out.push({
                    award: cat.name, award_key: cat.key, award_hr: cat.name_hr || null,
                    name: l.name, institution: l.institution || null,
                    citation: l.citation || cat.citation || null,
                    email: l.email || (entry && entry.nominee_email) || null,
                    presents: Number(l.present_minutes) > 0,
                    present_minutes: Number(l.present_minutes) || 0,
                    presentation_confirmed: Number(l.presentation_confirmed) === 1,
                    slides: l.slides_name || null,
                    gala_registration_id: l.gala_registration_id || null,
                    seat_kind: l.gala_registration_id ? 'comp' : null,
                    photo_url: l.photo_url || null,
                    sort_order: Number(l.sort_order) || 99
                });
            }
        }
        return out;
    }

    app.get('/api/v2/awards-ops/roster', auth, adminOnly, (req, res) => {
        try {
            const ed = resolveEdition(req.query);
            if (!ed) return res.json({ laureates: [] });
            res.json({ edition: editions.toJson(ed), laureates: roster(ed) });
        } catch (e) { res.status(500).json({ error: 'Could not build the roster.' }); }
    });

    app.get('/api/v2/awards-ops/roster.csv', auth, adminOnly, (req, res) => {
        try {
            const ed = resolveEdition(req.query);
            const head = ['Award', 'Laureate', 'Institution', 'Citation', 'Email', 'Presents', 'Minutes', 'Confirmed', 'Slides', 'Gala seat'];
            const rows = (ed ? roster(ed) : []).map(l => [l.award, l.name, l.institution || '', l.citation || '', l.email || '',
                l.presents ? 'yes' : 'no', l.present_minutes || '', l.presentation_confirmed ? 'yes' : 'no',
                l.slides || '', l.gala_registration_id || '']);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="medx-awards-gala-roster.csv"');
            res.send(csv(head, rows));
        } catch (e) { res.status(500).json({ error: 'Could not build the export.' }); }
    });

    const escH = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** The MC's sheet: one page, big type, the citation to read out, and who is speaking. */
    app.get('/api/v2/awards-ops/one-pager', auth, adminOnly, (req, res) => {
        try {
            const ed = resolveEdition(req.query);
            const list = ed ? roster(ed) : [];
            const byAward = {};
            list.forEach(l => { (byAward[l.award] = byAward[l.award] || []).push(l); });
            const blocks = Object.keys(byAward).map(award => `
      <section>
        <h2>${escH(award)}</h2>
        ${byAward[award].map(l => `
        <div class="lau">
          <div class="nm">${escH(l.name)}</div>
          ${l.institution ? `<div class="inst">${escH(l.institution)}</div>` : ''}
          ${l.citation ? `<div class="cit">&ldquo;${escH(l.citation)}&rdquo;</div>` : ''}
          ${l.presents ? `<div class="pres">SPEAKS · ${l.present_minutes} min · ${l.presentation_confirmed ? 'CONFIRMED' : 'NOT YET CONFIRMED'}${l.slides ? ' · slides on file' : ' · no slides'}</div>` : ''}
        </div>`).join('')}
      </section>`).join('');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>The Plexus Awards — running order</title><meta name="robots" content="noindex,nofollow">
<style>
  @page{size:A4;margin:18mm 16mm;}
  body{margin:0;background:#fff;color:#191512;font-family:Inter,Helvetica,Arial,sans-serif;}
  .wrap{max-width:760px;margin:0 auto;padding:28px 24px 60px;}
  .eyebrow{font-weight:600;font-size:10px;letter-spacing:.2em;color:#9b7d2e;text-transform:uppercase;}
  h1{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:32px;line-height:1.15;margin:8px 0 4px;}
  .sub{font-size:13px;color:#6d6459;}
  section{margin-top:26px;padding-top:14px;border-top:2px solid #191512;break-inside:avoid;}
  h2{font-weight:600;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9b1b22;margin:0 0 10px;}
  .lau{margin-bottom:16px;break-inside:avoid;}
  .nm{font-family:Fraunces,Georgia,serif;font-size:23px;line-height:1.2;}
  .inst{font-size:13px;color:#6d6459;margin-top:2px;}
  .cit{font-size:14px;font-style:italic;line-height:1.6;margin-top:6px;max-width:60ch;}
  .pres{font-weight:600;font-size:10px;letter-spacing:.13em;color:#1e6e42;margin-top:6px;}
  .none{font-size:13px;color:#6d6459;font-style:italic;}
  .foot{margin-top:34px;padding-top:12px;border-top:1px solid rgba(25,21,18,.2);font-size:11px;color:#6d6459;}
  @media print{.noprint{display:none;}}
</style></head><body><div class="wrap">
  <div class="eyebrow">Med&amp;X &middot; Gala Evening &middot; 5 December 2026</div>
  <h1>The Plexus Awards</h1>
  <div class="sub">Running order for the master of ceremonies. Citations are printed exactly as they should be read.</div>
  ${blocks || '<p class="none">No laureates are on file yet.</p>'}
  <div class="foot">Printed ${escH(new Date().toISOString().slice(0, 10))} &middot; ${escH(list.length)} laureate${list.length === 1 ? '' : 's'} &middot; ${escH(list.filter(l => l.presents).length)} speaking</div>
  <p class="noprint" style="margin-top:18px;"><button onclick="window.print()" style="padding:10px 18px;border:1px solid #191512;background:#191512;color:#fff;font:600 10px Inter,sans-serif;letter-spacing:.14em;cursor:pointer;">PRINT</button></p>
</div></body></html>`);
        } catch (e) { log('one-pager:', e.message); res.status(500).send('Could not build the sheet.'); }
    });

    mountAwardsOps._internals = { sign, cx, q, ensureGalaSeat, stage, roster, reviewerProgress, scoreBlock, laureateJson };
    log('awards-ops: overview · entries by nominee · decisions · ranking · reviewers · notify→outbox · roster + one-pager');
};
