/**
 * v2/meetups-ops.js — PLEXUS WEEK MEETUPS, admin side (design/MEETUPS-SPEC.md §3 "Admin view").
 *
 * The Plexus Week hub's MEETUPS tab: the table, the create/edit drawer, the attendees drawer, the
 * invites drawer, the host link, the CSV export and the stats strip.
 *
 *   GET    /api/v2/meetups-ops/overview[?edition=]        table + stats strip + edition list
 *   POST   /api/v2/meetups-ops/meetups                    create (draft by default)
 *   PUT    /api/v2/meetups-ops/meetups/:id                edit every field
 *   POST   /api/v2/meetups-ops/meetups/:id/publish        draft → published (mints the host token)
 *   POST   /api/v2/meetups-ops/meetups/:id/cancel         cancel + email everyone holding a place
 *   DELETE /api/v2/meetups-ops/meetups/:id                delete — DRAFTS ONLY, never a live table
 *   GET    /api/v2/meetups-ops/meetups/:id/attendees      the drawer: confirmed · waitlist · invited
 *   POST   /api/v2/meetups-ops/meetups/:id/attendees      manual add (member or raw email)
 *   GET    /api/v2/meetups-ops/meetups/:id/attendees.csv  export (UTF-8 BOM, every field quoted)
 *   POST   /api/v2/meetups-ops/attendees/:aid/promote     force one waitlisted person up
 *   POST   /api/v2/meetups-ops/attendees/:aid/cancel      remove a place → auto-promotes the next
 *   POST   /api/v2/meetups-ops/attendees/:aid/checkin     { checked_in } check in / undo
 *   DELETE /api/v2/meetups-ops/attendees/:aid             hard-remove a row (mistakes, duplicates)
 *   GET    /api/v2/meetups-ops/meetups/:id/invites        invite drawer state
 *   POST   /api/v2/meetups-ops/meetups/:id/invites        { people[], preview? } invite / preview
 *   GET    /api/v2/meetups-ops/meetups/:id/host-link      copy-the-host-link
 *   GET    /api/v2/meetups-ops/members?q=                 host + invite picker (member search)
 *
 * PERMISSION: every route sits under /api/v2/meetups-ops, mapped to the new section id
 * `plexus-meetups` in server.js SECTION_ROUTE_MAP. Admins with full access (allowed_sections
 * NULL) have it automatically; a scoped admin needs the grant from Team Access.
 *
 * The domain — schema, placement, waitlist, the cancel→promote transaction — is shared/meetups-core.js,
 * the SAME module the member backend calls, so a place cancelled here and a place cancelled from
 * the email link behave identically. The emails are shared/meetup-emails.js, so an invite sent
 * from this drawer is byte-identical to one the member side would render.
 */
'use strict';

const crypto = require('crypto');

const core = require('../../../shared/meetups-core');
const editions = require('../../../shared/editions');
const mail = require('../../../shared/meetup-emails');

const { LIVE, clean, validEmail, nowIso, fullName, shortCode, whenLabel, parseTags, splitName } = core;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 60;

module.exports = function mountMeetupsOps(app, ctx) {
    const { db, auth, adminOnly, sendEmail, saveDb } = ctx;
    const JWT_SECRET = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const log = ctx.log || ((...a) => console.log('[v2/meetups-ops]', ...a));

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

    // ---------------------------------------------------------------- schema (same DDL, verbatim)
    let schemaReady = false;
    function ensureSchema() {
        try { schemaReady = core.ensureSchema(q); editions.ensureSchema(q); } catch (e) { schemaReady = false; }
        return schemaReady;
    }
    ensureSchema();
    if (!schemaReady) {
        let tries = 0;
        const retry = setInterval(() => { if (ensureSchema() || ++tries >= 10) clearInterval(retry); }, 4000);
        if (retry.unref) retry.unref();
    }
    // Seed + auto-rollover — idempotent, and identical to the member backend's call.
    try { editions.bootstrap(q); } catch (e) { log('editions bootstrap:', e.message); }
    if (!process.env.MEETUPS_NO_TIMERS && process.env.NODE_ENV !== 'test') {
        const roll = setInterval(() => { try { editions.bootstrap(q); } catch (e) {} }, 12 * 3600 * 1000);
        if (roll.unref) roll.unref();
    }

    // ---------------------------------------------------------------- tokens + bases
    const sign = (kind, id) => crypto.createHmac('sha256', JWT_SECRET).update(`medxmeet:${kind}:${id}`).digest('hex').slice(0, 32);
    const cx = { q, sign };
    // The member portal serves every public meetup page (manage / invite / host) — its origin, not
    // ours, goes into anything a guest will click. Same resolution gala-ops uses.
    function memberBase() {
        if (process.env.USER_PORTAL_URL) return String(process.env.USER_PORTAL_URL).replace(/\/+$/, '');
        if (process.env.NODE_ENV === 'production' || process.env.RENDER) return 'https://medx-user-portal.onrender.com';
        return 'http://localhost:3010';
    }
    const manageUrl = (tok) => `${memberBase()}/meetups/manage/${tok}`;
    const acceptUrl = (tok) => `${memberBase()}/meetups/invite/${tok}/accept`;
    const declineUrl = (tok) => `${memberBase()}/meetups/invite/${tok}/decline`;
    const hostUrl = (tok) => `${memberBase()}/meetups/host/${tok}`;
    const qrUrl = (aid) => `${memberBase()}/api/v2/meetups/qr/${aid}.png`;
    const browseUrl = () => `${memberBase()}/app/plexus/meetups`;
    const signupUrl = () => `${memberBase()}/app/auth/signup`;

    function ensureHostToken(m) {
        if (m.host_token) return m.host_token;
        const tok = sign('host', m.id);
        try { q.run('UPDATE plexus_meetups SET host_token = ? WHERE id = ?', [tok, m.id]); } catch (e) {}
        return tok;
    }
    const manageTokenOf = (a) => a.manage_token || core.ensureManageToken(cx, a.id);
    const hostLineOf = (m) => [m.host_name, m.host_title].filter(Boolean).join(' · ') || null;

    // ---------------------------------------------------------------- email plumbing
    async function send(to, subject, html) {
        if (!to || !validEmail(to)) return false;
        try { await sendEmail(to, subject, html); return true; }
        catch (e) { log('email failed:', e.message); return false; }
    }
    const isMemberEmail = (email) => !!q.get('SELECT id FROM users WHERE lower(email) = lower(?)', [String(email || '')]);
    function mailParams(a, m, extra) {
        const tok = manageTokenOf(a);
        return Object.assign({
            firstName: a.first_name || null,
            isMember: !!a.user_id || isMemberEmail(a.email),
            signupUrl: signupUrl(), browseUrl: browseUrl(),
            hostLine: hostLineOf(m), hostName: m.host_name || null,
            hostFirstName: String(m.host_name || '').split(' ')[0] || null,
            manageUrl: manageUrl(tok), qrPngUrl: qrUrl(a.id), shortCode: shortCode(a.id),
            calendarUrl: `${memberBase()}/api/v2/meetups/calendar/${tok}.ics`,
            acceptUrl: acceptUrl(tok), declineUrl: declineUrl(tok),
            meetup: {
                title: m.title, kind: m.kind, description: m.description,
                venue_name: m.venue_name, venue_address: m.venue_address, venue_map_url: m.venue_map_url,
                capacity: Number(m.capacity) || null, whenLabel: whenLabel(m.starts_at, m.ends_at)
            }
        }, extra || {});
    }
    const headcountLine = (m) => `${core.confirmedCount(q, m.id)} of ${Number(m.capacity) || 0} confirmed`;

    async function afterCancel(m, result) {
        if (result.promoted) {
            try { await send(result.promoted.email, `A place opened — ${m.title}`, mail.promoted(mailParams(result.promoted, m))); } catch (e) { log('promote mail:', e.message); }
            if (m.host_email) {
                try { await send(m.host_email, `${m.title} — list update`, mail.hostFyi({
                    meetup: { title: m.title, whenLabel: whenLabel(m.starts_at, m.ends_at), venue_name: m.venue_name, venue_address: m.venue_address },
                    line: `${fullName(result.promoted)} moved up from the waitlist and now has a place at ${m.title}.`,
                    headcountLine: headcountLine(m), hostUrl: hostUrl(ensureHostToken(m))
                })); } catch (e) { log('host fyi:', e.message); }
            }
        }
    }

    // ---------------------------------------------------------------- shaping
    function rowJson(m) {
        const live = core.confirmedCount(q, m.id);
        const waiting = core.waitingOf(q, m.id).length;
        const invited = core.attendeesOf(q, m.id).filter(a => a.status === 'invited').length;
        const cap = Number(m.capacity) || 0;
        return {
            id: m.id, edition_id: m.edition_id, title: m.title, kind: m.kind,
            description: m.description || null, audience: m.audience || null, tags: parseTags(m.tags),
            venue_name: m.venue_name || null, venue_address: m.venue_address || null, venue_map_url: m.venue_map_url || null,
            starts_at: m.starts_at, ends_at: m.ends_at || null, when_label: whenLabel(m.starts_at, m.ends_at),
            day: String(m.starts_at || '').slice(0, 10),
            capacity: cap, waitlist_enabled: Number(m.waitlist_enabled) === 1,
            visibility: m.visibility, status: m.status,
            host_user_id: m.host_user_id || null, host_name: m.host_name || null,
            host_title: m.host_title || null, host_email: m.host_email || null, host_line: hostLineOf(m),
            host_link: m.host_token ? hostUrl(m.host_token) : null,
            confirmed: live, waitlisted: waiting, invited,
            spots_left: Math.max(0, cap - live), full: cap > 0 && live >= cap,
            checked_in: core.liveOf(q, m.id).filter(a => Number(a.checked_in) === 1).length,
            created_by: m.created_by || null, created_at: m.created_at || null, updated_at: m.updated_at || null
        };
    }
    function statsFor(rows) {
        const pub = rows.filter(r => r.status === 'published');
        const seats = pub.reduce((n, r) => n + r.capacity, 0);
        const taken = pub.reduce((n, r) => n + r.confirmed, 0);
        return {
            meetups: rows.length, published: pub.length,
            drafts: rows.filter(r => r.status === 'draft').length,
            cancelled: rows.filter(r => r.status === 'cancelled').length,
            seats, taken, seats_left: Math.max(0, seats - taken),
            fill_percent: seats ? Math.round((taken / seats) * 100) : 0,
            waitlisted: rows.reduce((n, r) => n + r.waitlisted, 0),
            hosts: new Set(pub.map(r => r.host_email || r.host_name).filter(Boolean)).size
        };
    }
    const resolveEdition = (query) => {
        const wanted = query && query.edition ? String(query.edition) : null;
        if (wanted) { const e = editions.getEdition(q, wanted); if (e) return e; }
        return editions.activeEdition(q);
    };

    // ---------------------------------------------------------------- validation
    const ISO_AT = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
    function readBody(b, existing) {
        const e = existing || {};
        const out = {}; const errors = [];
        const has = (k) => b && Object.prototype.hasOwnProperty.call(b, k);

        if (has('title') || !existing) {
            const v = clean(b.title, 160);
            if (!v) errors.push('A title is needed.'); else out.title = v;
        }
        if (has('kind')) {
            const v = String(b.kind || '').toLowerCase();
            if (!core.KINDS.includes(v)) errors.push('kind must be one of ' + core.KINDS.join(', ')); else out.kind = v;
        }
        if (has('description')) out.description = clean(b.description, 2000) || null;
        if (has('audience')) out.audience = clean(b.audience, 300) || null;
        if (has('tags')) {
            const list = Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',');
            out.tags = JSON.stringify(list.map(t => clean(t, 40)).filter(Boolean).slice(0, 12));
        }
        if (has('venue_name')) out.venue_name = clean(b.venue_name, 200) || null;
        if (has('venue_address')) out.venue_address = clean(b.venue_address, 300) || null;
        if (has('venue_map_url')) {
            const v = clean(b.venue_map_url, 500) || null;
            if (v && !/^https?:\/\//i.test(v)) errors.push('venue_map_url must be an http(s) link.'); else out.venue_map_url = v;
        }
        if (has('starts_at') || !existing) {
            const v = clean(b.starts_at, 30);
            if (!ISO_AT.test(v)) errors.push('starts_at must look like 2026-12-04T10:30.'); else out.starts_at = v;
        }
        if (has('ends_at')) {
            const v = clean(b.ends_at, 30) || null;
            if (v && !ISO_AT.test(v)) errors.push('ends_at must look like 2026-12-04T11:30.');
            else if (v && (out.starts_at || e.starts_at) && v < (out.starts_at || e.starts_at)) errors.push('ends_at cannot be before starts_at.');
            else out.ends_at = v;
        }
        if (has('capacity') || !existing) {
            const n = parseInt(b.capacity, 10);
            if (!Number.isFinite(n) || n < MIN_CAPACITY || n > MAX_CAPACITY) errors.push(`capacity must be between ${MIN_CAPACITY} and ${MAX_CAPACITY}.`);
            else out.capacity = n;
        }
        if (has('waitlist_enabled')) out.waitlist_enabled = (b.waitlist_enabled === false || b.waitlist_enabled === 0 || b.waitlist_enabled === '0') ? 0 : 1;
        if (has('visibility')) {
            const v = String(b.visibility || '').toLowerCase();
            if (!core.VISIBILITIES.includes(v)) errors.push('visibility must be open or invite.'); else out.visibility = v;
        }
        // host: either a member id (profile fills the rest) or a free name + email
        if (has('host_user_id') && b.host_user_id) {
            const u = q.get('SELECT id, email, first_name, last_name, title, institution FROM users WHERE id = ?', [String(b.host_user_id)]);
            if (!u) errors.push('That member could not be found.');
            else {
                out.host_user_id = u.id;
                out.host_name = clean(b.host_name, 160) || fullName(u);
                out.host_title = clean(b.host_title, 200) || [u.title, u.institution].filter(Boolean).join(' · ') || null;
                out.host_email = u.email;
            }
        } else {
            if (has('host_user_id')) out.host_user_id = null;
            if (has('host_name')) out.host_name = clean(b.host_name, 160) || null;
            if (has('host_title')) out.host_title = clean(b.host_title, 200) || null;
            if (has('host_email')) {
                const v = clean(b.host_email, 200) || null;
                if (v && !validEmail(v)) errors.push('The host email does not look like an email address.');
                else {
                    out.host_email = v;
                    // A host who already has a Med&X account gets the logged-in host view too.
                    if (v && !has('host_user_id')) {
                        const u = q.get('SELECT id FROM users WHERE lower(email) = lower(?)', [v]);
                        if (u) out.host_user_id = u.id;
                    }
                }
            }
        }
        return { patch: out, errors };
    }

    // ================================================================ OVERVIEW + STATS
    app.get('/api/v2/meetups-ops/overview', auth, adminOnly, (req, res) => {
        try {
            const ed = resolveEdition(req.query);
            const all = editions.listEditions(q).map(editions.toJson);
            if (!ed) return res.json({ edition: null, editions: all, meetups: [], stats: statsFor([]) });
            const rows = q.all('SELECT * FROM plexus_meetups WHERE edition_id = ? ORDER BY starts_at, title', [ed.id]).map(rowJson);
            res.json({
                edition: editions.toJson(ed), editions: all,
                read_only: ed.status === 'archived',
                meetups: rows, stats: statsFor(rows),
                kinds: core.KINDS, visibilities: core.VISIBILITIES
            });
        } catch (e) { log('overview:', e.message); res.status(500).json({ error: 'Could not load the meetups.' }); }
    });

    // ================================================================ CRUD
    app.post('/api/v2/meetups-ops/meetups', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const ed = b.edition_id ? editions.getEdition(q, String(b.edition_id)) : editions.activeEdition(q);
            if (!ed) return res.status(400).json({ error: 'No Plexus Week edition exists yet.' });
            if (ed.status === 'archived') return res.status(400).json({ error: 'That edition is archived — switch to the active one first.' });
            const { patch, errors } = readBody(b, null);
            if (errors.length) return res.status(400).json({ error: errors[0], errors });

            const id = crypto.randomUUID();
            const cols = Object.assign({
                id, edition_id: ed.id, kind: 'coffee', waitlist_enabled: 1, visibility: 'open',
                status: core.STATUSES.includes(String(b.status)) && String(b.status) !== 'cancelled' ? String(b.status) : 'draft',
                created_by: (req.user && req.user.email) || 'admin', updated_at: nowIso()
            }, patch);
            cols.host_token = sign('host', id);
            const keys = Object.keys(cols);
            q.run(`INSERT INTO plexus_meetups (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => cols[k]));
            core.audit(q, id, null, 'created', `${cols.title} · ${cols.status}`, (req.user && req.user.email) || 'admin');
            auditAdmin(req, 'meetups.create', `${cols.title} (${cols.status}) in ${ed.id}`);
            persist();
            res.json({ success: true, meetup: rowJson(core.meetupById(q, id)) });
        } catch (e) { log('create:', e.message); res.status(500).json({ error: 'Could not create that meetup.' }); }
    });

    app.put('/api/v2/meetups-ops/meetups/:id', auth, adminOnly, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            const { patch, errors } = readBody(req.body || {}, m);
            if (errors.length) return res.status(400).json({ error: errors[0], errors });
            // Never shrink a table below the people already holding a place.
            if (patch.capacity !== undefined) {
                const live = core.confirmedCount(q, m.id);
                if (patch.capacity < live) return res.status(400).json({ error: `${live} people already hold a place — the capacity cannot go below that. Cancel someone first.` });
            }
            const keys = Object.keys(patch);
            if (!keys.length) return res.status(400).json({ error: 'Nothing to update.' });
            patch.updated_at = nowIso();
            const all = Object.keys(patch);
            q.run(`UPDATE plexus_meetups SET ${all.map(k => k + ' = ?').join(', ')} WHERE id = ?`, all.map(k => patch[k]).concat([m.id]));
            core.audit(q, m.id, null, 'updated', keys.join(', '), (req.user && req.user.email) || 'admin');
            auditAdmin(req, 'meetups.update', `${m.title}: ${keys.join(', ')}`);
            persist();
            res.json({ success: true, meetup: rowJson(core.meetupById(q, m.id)) });
        } catch (e) { log('update:', e.message); res.status(500).json({ error: 'Could not save that meetup.' }); }
    });

    app.post('/api/v2/meetups-ops/meetups/:id/publish', auth, adminOnly, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            if (m.status === 'cancelled') return res.status(400).json({ error: 'A cancelled meetup cannot be published — create a new one.' });
            const unpublish = (req.body || {}).published === false;
            const next = unpublish ? 'draft' : 'published';
            if (!unpublish && !m.host_name && !m.host_email) return res.status(400).json({ error: 'Give the meetup a host before publishing it.' });
            ensureHostToken(m);
            q.run('UPDATE plexus_meetups SET status = ?, updated_at = ? WHERE id = ?', [next, nowIso(), m.id]);
            core.audit(q, m.id, null, next === 'published' ? 'published' : 'unpublished', '', (req.user && req.user.email) || 'admin');
            auditAdmin(req, 'meetups.' + next, m.title);
            persist();
            res.json({ success: true, meetup: rowJson(core.meetupById(q, m.id)) });
        } catch (e) { log('publish:', e.message); res.status(500).json({ error: 'Could not change that meetup.' }); }
    });

    // Cancel the whole table — everyone holding a place or waiting is told, once.
    app.post('/api/v2/meetups-ops/meetups/:id/cancel', auth, adminOnly, async (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            if (m.status === 'cancelled') return res.json({ success: true, already: true, meetup: rowJson(m) });
            const reason = clean((req.body || {}).reason, 300) || null;
            const notify = (req.body || {}).notify !== false;
            const people = core.attendeesOf(q, m.id).filter(a => LIVE.includes(a.status) || a.status === 'waitlisted' || a.status === 'invited');
            q.run('UPDATE plexus_meetups SET status = ?, updated_at = ? WHERE id = ?', ['cancelled', nowIso(), m.id]);
            core.audit(q, m.id, null, 'meetup-cancelled', reason || '', (req.user && req.user.email) || 'admin');
            auditAdmin(req, 'meetups.cancel', `${m.title}${reason ? ' — ' + reason : ''} (${people.length} notified)`);
            persist();
            let mailed = 0;
            if (notify) {
                for (const a of people) {
                    const ok = await send(a.email, `Cancelled — ${m.title}`, mail.meetupCancelled(mailParams(a, m, { reason })));
                    if (ok) mailed++;
                }
            }
            res.json({ success: true, notified: mailed, meetup: rowJson(core.meetupById(q, m.id)) });
        } catch (e) { log('cancel meetup:', e.message); res.status(500).json({ error: 'Could not cancel that meetup.' }); }
    });

    app.delete('/api/v2/meetups-ops/meetups/:id', auth, adminOnly, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            if (m.status !== 'draft') return res.status(400).json({ error: 'Only a draft can be deleted — cancel the meetup instead, so everyone is told.' });
            if (core.attendeesOf(q, m.id).length) return res.status(400).json({ error: 'This draft already has people on it — cancel it instead.' });
            q.run('DELETE FROM plexus_meetups WHERE id = ?', [m.id]);
            auditAdmin(req, 'meetups.delete_draft', m.title);
            persist();
            res.json({ success: true });
        } catch (e) { log('delete:', e.message); res.status(500).json({ error: 'Could not delete that draft.' }); }
    });

    app.get('/api/v2/meetups-ops/meetups/:id/host-link', auth, adminOnly, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            const tok = ensureHostToken(m);
            persist();
            res.json({ host_link: hostUrl(tok), host_name: m.host_name || null, host_email: m.host_email || null });
        } catch (e) { res.status(500).json({ error: 'Could not build the host link.' }); }
    });

    // ================================================================ ATTENDEES DRAWER
    app.get('/api/v2/meetups-ops/meetups/:id/attendees', auth, adminOnly, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            const rows = core.attendeesOf(q, m.id);
            const card = (a) => Object.assign(core.personCard(a), {
                source: a.source || null, manage_url: a.manage_token ? manageUrl(a.manage_token) : null,
                invited_at: a.invited_at || null, confirmed_at: a.confirmed_at || null,
                cancelled_at: a.cancelled_at || null, promoted_at: a.promoted_at || null
            });
            res.json({
                meetup: rowJson(m),
                confirmed: rows.filter(a => LIVE.includes(a.status)).map(card),
                waitlist: core.waitingOf(q, m.id).map(card),
                invited: rows.filter(a => a.status === 'invited').map(card),
                declined: rows.filter(a => a.status === 'declined').map(card),
                cancelled: rows.filter(a => a.status === 'cancelled').map(card)
            });
        } catch (e) { log('attendees:', e.message); res.status(500).json({ error: 'Could not load the attendees.' }); }
    });

    app.post('/api/v2/meetups-ops/meetups/:id/attendees', auth, adminOnly, async (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            if (m.status === 'cancelled') return res.status(400).json({ error: 'This meetup is cancelled.' });
            const b = req.body || {};
            let person = null;
            if (b.user_id) {
                const u = q.get('SELECT id, email, first_name, last_name, title, institution, bio FROM users WHERE id = ?', [String(b.user_id)]);
                if (!u) return res.status(404).json({ error: 'That member could not be found.' });
                person = { user_id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, institution: u.institution, position: u.title, bio: u.bio };
            } else {
                const email = clean(b.email, 200);
                if (!validEmail(email)) return res.status(400).json({ error: 'A valid email address is needed.' });
                const u = q.get('SELECT id, first_name, last_name, title, institution, bio FROM users WHERE lower(email) = lower(?)', [email]);
                const named = b.name ? splitName(b.name) : { first_name: clean(b.first_name, 80) || null, last_name: clean(b.last_name, 80) || null };
                person = {
                    user_id: u ? u.id : null, email,
                    first_name: named.first_name || (u && u.first_name) || null,
                    last_name: named.last_name || (u && u.last_name) || null,
                    institution: clean(b.institution, 200) || (u && u.institution) || null,
                    position: clean(b.position, 200) || (u && u.title) || null,
                    bio: (u && u.bio) || null
                };
            }
            const result = core.placePerson(cx, m, person, 'admin', { actor: (req.user && req.user.email) || 'admin' });
            persist();
            if (result.status === 'full') return res.status(409).json({ error: 'This table is full and the waitlist is off.' });
            if (!result.already && (req.body || {}).notify !== false) {
                if (result.status === 'confirmed') await send(result.attendee.email, `You are in — ${m.title}`, mail.joinedConfirmed(mailParams(result.attendee, m)));
                else if (result.status === 'waitlisted') await send(result.attendee.email, `Waitlisted — ${m.title}`, mail.waitlisted(mailParams(result.attendee, m, { position: Number(result.attendee.waitlist_pos) || 1 })));
            }
            auditAdmin(req, 'meetups.attendee_add', `${person.email} → ${m.title} (${result.status})`);
            res.json({ success: true, status: result.status, already: !!result.already, attendee: result.attendee ? core.personCard(result.attendee) : null, meetup: rowJson(core.meetupById(q, m.id)) });
        } catch (e) { log('attendee add:', e.message); res.status(500).json({ error: 'Could not add that person.' }); }
    });

    function attendeeAndMeetup(req, res) {
        const a = q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [String(req.params.aid || '')]);
        if (!a) { res.status(404).json({ error: 'Attendee not found' }); return null; }
        const m = core.meetupById(q, a.meetup_id);
        if (!m) { res.status(404).json({ error: 'Meetup not found' }); return null; }
        return { a, m };
    }

    app.post('/api/v2/meetups-ops/attendees/:aid/promote', auth, adminOnly, async (req, res) => {
        try {
            const hit = attendeeAndMeetup(req, res); if (!hit) return;
            const out = core.promoteOne(cx, hit.m, hit.a);
            persist();
            if (!out.promoted) return res.status(400).json({ error: out.reason === 'full' ? 'The table is full — cancel someone first.' : 'That person is not on the waitlist.' });
            if ((req.body || {}).notify !== false) await send(out.promoted.email, `A place opened — ${hit.m.title}`, mail.promoted(mailParams(out.promoted, hit.m)));
            auditAdmin(req, 'meetups.promote', `${out.promoted.email} → ${hit.m.title}`);
            res.json({ success: true, attendee: core.personCard(out.promoted), meetup: rowJson(core.meetupById(q, hit.m.id)) });
        } catch (e) { log('promote:', e.message); res.status(500).json({ error: 'Could not promote that person.' }); }
    });

    app.post('/api/v2/meetups-ops/attendees/:aid/cancel', auth, adminOnly, async (req, res) => {
        try {
            const hit = attendeeAndMeetup(req, res); if (!hit) return;
            const result = core.cancelAndPromote(cx, hit.m, hit.a, (req.user && req.user.email) || 'admin');
            persist();
            if ((req.body || {}).notify !== false && result.cancelled && !result.noop) {
                await send(result.cancelled.email, `Cancelled — ${hit.m.title}`, mail.cancelledByYou(mailParams(result.cancelled, hit.m)));
            }
            await afterCancel(hit.m, result);
            auditAdmin(req, 'meetups.attendee_cancel', `${hit.a.email} ← ${hit.m.title}${result.promoted ? ' (promoted ' + result.promoted.email + ')' : ''}`);
            res.json({ success: true, promoted: result.promoted ? core.personCard(result.promoted) : null, meetup: rowJson(core.meetupById(q, hit.m.id)) });
        } catch (e) { log('attendee cancel:', e.message); res.status(500).json({ error: 'Could not cancel that place.' }); }
    });

    app.post('/api/v2/meetups-ops/attendees/:aid/checkin', auth, adminOnly, (req, res) => {
        try {
            const hit = attendeeAndMeetup(req, res); if (!hit) return;
            const on = (req.body || {}).checked_in === false ? 0 : 1;
            q.run('UPDATE plexus_meetup_attendees SET checked_in = ?, checked_in_at = ? WHERE id = ?', [on, on ? nowIso() : null, hit.a.id]);
            core.audit(q, hit.m.id, hit.a.id, on ? 'checked-in' : 'check-in-undone', 'admin list', (req.user && req.user.email) || 'admin');
            persist();
            res.json({ success: true, attendee: core.personCard(q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [hit.a.id])) });
        } catch (e) { log('checkin:', e.message); res.status(500).json({ error: 'Could not change the check-in.' }); }
    });

    app.delete('/api/v2/meetups-ops/attendees/:aid', auth, adminOnly, (req, res) => {
        try {
            const hit = attendeeAndMeetup(req, res); if (!hit) return;
            q.run('DELETE FROM plexus_meetup_attendees WHERE id = ?', [hit.a.id]);
            core.renumberWaitlist(q, hit.m.id);
            core.audit(q, hit.m.id, null, 'attendee-removed', hit.a.email, (req.user && req.user.email) || 'admin');
            auditAdmin(req, 'meetups.attendee_remove', `${hit.a.email} ← ${hit.m.title}`);
            persist();
            res.json({ success: true, meetup: rowJson(core.meetupById(q, hit.m.id)) });
        } catch (e) { log('attendee remove:', e.message); res.status(500).json({ error: 'Could not remove that row.' }); }
    });

    // ---- CSV (UTF-8 BOM so Excel opens č ć đ š ž; every field quoted; formulas defused)
    app.get('/api/v2/meetups-ops/meetups/:id/attendees.csv', auth, adminOnly, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            const cell = (v) => {
                const s = String(v == null ? '' : v);
                return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
            };
            const head = ['Name', 'Email', 'Institution', 'Position', 'Status', 'Waitlist position', 'Source', 'Checked in', 'Checked in at', 'Joined', 'Cancelled'];
            const rows = core.attendeesOf(q, m.id).map(a => [
                fullName(a), a.email, a.institution || '', a.position || '', a.status,
                a.waitlist_pos || '', a.source || '', Number(a.checked_in) === 1 ? 'yes' : 'no',
                a.checked_in_at || '', a.confirmed_at || a.created_at || '', a.cancelled_at || ''
            ].map(cell).join(','));
            const csv = '﻿' + [head.map(cell).join(',')].concat(rows).join('\r\n');
            const slug = String(m.title || 'meetup').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meetup';
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="medx-meetup-${slug}.csv"`);
            res.send(csv);
        } catch (e) { log('csv:', e.message); res.status(500).json({ error: 'Could not build the export.' }); }
    });

    // ================================================================ INVITES DRAWER
    app.get('/api/v2/meetups-ops/meetups/:id/invites', auth, adminOnly, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            const rows = core.attendeesOf(q, m.id);
            const card = (a) => Object.assign(core.personCard(a), { invited_at: a.invited_at || null, accept_url: a.manage_token ? acceptUrl(a.manage_token) : null });
            res.json({
                meetup: rowJson(m),
                invited: rows.filter(a => a.status === 'invited').map(card),
                accepted: rows.filter(a => LIVE.includes(a.status) && a.source === 'email-invite').map(card),
                declined: rows.filter(a => a.status === 'declined').map(card),
                summary: {
                    invited: rows.filter(a => a.status === 'invited').length,
                    accepted: rows.filter(a => LIVE.includes(a.status) && a.source === 'email-invite').length,
                    declined: rows.filter(a => a.status === 'declined').length
                }
            });
        } catch (e) { log('invites:', e.message); res.status(500).json({ error: 'Could not load the invitations.' }); }
    });

    /**
     * POST invites — { people: [{ email, name?, user_id? }] | 'a@b.c, d@e.f', preview?: true }.
     * `preview: true` renders the exact email for the first person and sends NOTHING, so the
     * drawer can show it before anyone commits.
     */
    app.post('/api/v2/meetups-ops/meetups/:id/invites', auth, adminOnly, async (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            if (m.status === 'cancelled') return res.status(400).json({ error: 'This meetup is cancelled.' });
            const b = req.body || {};
            const raw = Array.isArray(b.people) ? b.people
                : String(b.people || b.emails || '').split(/[\s,;]+/).filter(Boolean).map(e => ({ email: e }));
            const people = [];
            const invalid = [];
            const seen = new Set();
            for (const p of raw.slice(0, 200)) {
                const email = clean(typeof p === 'string' ? p : p.email, 200).toLowerCase();
                if (!validEmail(email)) { invalid.push(typeof p === 'string' ? p : (p.email || '')); continue; }
                if (seen.has(email)) continue;
                seen.add(email);
                const u = q.get('SELECT id, first_name, last_name, title, institution FROM users WHERE lower(email) = lower(?)', [email]);
                const named = p && p.name ? splitName(p.name) : { first_name: null, last_name: null };
                people.push({
                    email, user_id: (p && p.user_id) || (u && u.id) || null,
                    first_name: named.first_name || (u && u.first_name) || null,
                    last_name: named.last_name || (u && u.last_name) || null,
                    institution: (u && u.institution) || null, position: (u && u.title) || null
                });
            }
            if (!people.length) return res.status(400).json({ error: 'No valid email addresses in that list.', invalid });

            if (b.preview) {
                const sample = Object.assign({ id: 'preview', manage_token: sign('manage', 'preview') }, people[0]);
                return res.json({
                    preview: true, recipients: people.length, invalid,
                    subject: `An invitation — ${m.title}`,
                    html: mail.invited(mailParams(sample, m))
                });
            }

            const created = []; const skipped = [];
            for (const p of people) {
                const out = core.placePerson(cx, m, p, 'email-invite', { asInvited: true, actor: (req.user && req.user.email) || 'admin' });
                if (out.already) { skipped.push(p.email); continue; }
                created.push(out.attendee);
            }
            persist();
            let mailed = 0;
            for (const a of created) {
                if (await send(a.email, `An invitation — ${m.title}`, mail.invited(mailParams(a, m)))) mailed++;
            }
            auditAdmin(req, 'meetups.invites', `${mailed} invitation(s) for ${m.title}`);
            res.json({ success: true, invited: created.length, mailed, skipped, invalid, meetup: rowJson(core.meetupById(q, m.id)) });
        } catch (e) { log('invite:', e.message); res.status(500).json({ error: 'Could not send those invitations.' }); }
    });

    // ================================================================ member picker (host + invites)
    app.get('/api/v2/meetups-ops/members', auth, adminOnly, (req, res) => {
        try {
            const term = clean(req.query.q, 80);
            if (term.length < 2) return res.json({ members: [] });
            const like = '%' + term.toLowerCase() + '%';
            const rows = q.all(`SELECT id, email, first_name, last_name, title, institution FROM users
                                 WHERE deleted_at IS NULL AND (lower(email) LIKE ? OR lower(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE ? OR lower(COALESCE(institution,'')) LIKE ?)
                                 ORDER BY first_name, last_name LIMIT 20`, [like, like, like]);
            res.json({
                members: rows.map(u => ({
                    id: u.id, email: u.email, name: fullName(u),
                    title: u.title || null, institution: u.institution || null,
                    line: [u.title, u.institution].filter(Boolean).join(' · ') || null
                }))
            });
        } catch (e) { log('members:', e.message); res.json({ members: [] }); }
    });

    mountMeetupsOps._internals = { sign, cx, q, rowJson, statsFor, ensureHostToken, readBody };
    log('meetups-ops: CRUD · publish/cancel · attendees · invites · CSV · host link · stats');
};
