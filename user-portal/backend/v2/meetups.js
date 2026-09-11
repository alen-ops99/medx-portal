/**
 * v2/meetups.js — PLEXUS WEEK MEETUPS, member side (design/MEETUPS-SPEC.md §2–§3).
 *
 * "Host a coffee or lunch or something networking with students or residents or whoever."
 * Small tables during Plexus Week: an admin creates one, assigns a host (speaker, professor,
 * participant — anyone), sets the capacity (3…15, usually 5–10), and members join. Full table →
 * waitlist. Someone cancels → the first person waiting is promoted AUTOMATICALLY and told so.
 * "As automatic as possible."
 *
 * MEMBER API (auth, Bearer member JWT)
 *   GET  /api/v2/meetups                          the published board for an edition + my state
 *   GET  /api/v2/meetups/mine                     my meetups (+ pass assets, cancel link)
 *   GET  /api/v2/meetups/:id                      one meetup (published · invited · mine · host)
 *   POST /api/v2/meetups/:id/join                 join → confirmed | waitlisted (idempotent)
 *   POST /api/v2/meetups/:id/cancel               leave; promotes the first waitlisted person
 *   GET  /api/v2/meetups/:id/host                 HOST VIEW for the logged-in host (scoped)
 *   POST /api/v2/meetups/:id/host/scan            host scanner (camera) → check in one attendee
 *   POST /api/v2/meetups/:id/host/message         message my attendees → outbox DRAFT, never a blast
 *
 * PUBLIC (the token IS the credential — HMAC(JWT_SECRET), 32 hex, timingSafeEqual)
 *   GET  /meetups/manage/:token                   branded page: your place + "Cancel my place"
 *   POST /meetups/manage/:token                   the cancel itself (form post)
 *   GET  /meetups/invite/:token/accept            invitation → join logic (may waitlist)
 *   GET  /meetups/invite/:token/decline           invitation → declined
 *   GET  /meetups/host/:token                     host page without a login
 *   GET  /api/v2/meetups/host/:token/data         JSON behind that page
 *   POST /api/v2/meetups/host/:token/scan         host scanner on the token page
 *   GET  /api/v2/meetups/qr/:attendeeId.png       branded entry QR (Med&X plate), payload 'm-<id>'
 *   GET  /api/v2/meetups/pass/:token.pkpass       Apple Wallet eventTicket
 *   GET  /api/v2/meetups/wallet/:token            302 → Google Wallet save link
 *   GET  /api/v2/meetups/calendar/:token.ics      one-event calendar file
 *
 * SCOPING IS ABSOLUTE (spec §3 "Host view"): a host token and a logged-in host resolve exactly
 * ONE meetup. There is no list endpoint for hosts and no id a host can steer — host A asking for
 * meetup B gets a 404, never a 403 (a 403 would confirm B exists).
 *
 * REVIEW GATE (spec §3): joins by signed-in members skip it (vetted at signup) and invitation
 * accepts skip it (we invited them). No public self-serve meetup form exists; if one is ever
 * added it goes through review-gate.js like every other public form.
 *
 * The domain itself — schema, placement, waitlist, the cancel→promote transaction — lives in
 * shared/meetups-core.js, because the admin backend mutates the SAME rows and two copies of that
 * logic would drift. This module owns the member-facing surface: routes, tokens, pages, assets,
 * emails and the reminder timer.
 */
'use strict';

const crypto = require('crypto');
const path = require('path');

const core = require('../../../shared/meetups-core');
const editions = require('../../../shared/editions');
const mail = require('../../../shared/meetup-emails');
const brandedQr = require('../../../shared/branded-qr');
const wallet = require('../../../shared/wallet');
const applePass = require('./apple-pass');
const tpl = require('./email-templates');

function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
const QRCodeLib = tryRequire('qrcode');
const pngjsLib = tryRequire('pngjs');

const MEDX_PLATE = path.join(__dirname, '..', 'qr-plate-medx.png');
const REMINDER_ACTION = 'reminder-sent';
const REMINDER_WINDOW_H = 24;

const { LIVE, esc, clean, validEmail, nowIso, fullName, shortCode, whenLabel, parseTags, zagrebMs } = core;

module.exports = function mountMeetups(app, ctx) {
    const { db, auth, sendEmail } = ctx;
    const JWT_SECRET = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const log = ctx.log || ((...a) => console.log('[v2/meetups]', ...a));

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
    let syncTimer = null;
    function persist() {
        try {
            if (!process.env.TURSO_DATABASE_URL) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(() => { try { db().sync(); } catch (e) {} }, 2000);
            if (syncTimer.unref) syncTimer.unref();
        } catch (e) {}
    }

    // ---------------------------------------------------------------- schema
    let schemaReady = false;
    function ensureSchema() {
        try { schemaReady = core.ensureSchema(q); editions.ensureSchema(q); } catch (e) { schemaReady = false; }
        return schemaReady;
    }
    ensureSchema();
    if (!schemaReady) {                                   // in some boots the DB opens after mount
        let tries = 0;
        const retry = setInterval(() => { if (ensureSchema() || ++tries >= 10) clearInterval(retry); }, 4000);
        if (retry.unref) retry.unref();
    }

    // ---------------------------------------------------------------- tokens
    // HMAC(JWT_SECRET) over 'medxmeet:<kind>:<id>', first 32 hex. The token is STORED on the row
    // (host_token / manage_token, both UNIQUE) so the lookup is one indexed read; the recomputed
    // HMAC is then compared with timingSafeEqual, so a forged token can never shortcut the check.
    function sign(kind, id) {
        return crypto.createHmac('sha256', JWT_SECRET).update(`medxmeet:${kind}:${id}`).digest('hex').slice(0, 32);
    }
    function tokenMatches(kind, id, given) {
        const expected = Buffer.from(sign(kind, id), 'utf8');
        const got = Buffer.from(String(given == null ? '' : given), 'utf8');
        if (expected.length !== got.length) return false;
        try { return crypto.timingSafeEqual(expected, got); } catch (e) { return false; }
    }
    const isToken = (t) => /^[0-9a-f]{32}$/.test(String(t || ''));
    const cx = { q, sign };

    /** Resolve a manage token → { attendee, meetup } or null. Forged/unknown → null (→ 404). */
    function byManageToken(token) {
        if (!isToken(token)) return null;
        const a = q.get('SELECT * FROM plexus_meetup_attendees WHERE manage_token = ?', [String(token)]);
        if (!a) return null;
        if (!tokenMatches('manage', a.id, token)) return null;
        const m = core.meetupById(q, a.meetup_id);
        return m ? { attendee: a, meetup: m } : null;
    }
    /** Resolve a host token → meetup or null. Scoped by construction: one token, one meetup. */
    function byHostToken(token) {
        if (!isToken(token)) return null;
        const m = q.get('SELECT * FROM plexus_meetups WHERE host_token = ?', [String(token)]);
        if (!m) return null;
        return tokenMatches('host', m.id, token) ? m : null;
    }
    const manageTokenOf = (a) => a.manage_token || core.ensureManageToken(cx, a.id);

    // ---------------------------------------------------------------- bases
    const absBase = () => String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
    const memberBase = () => String(process.env.MEMBER_PORTAL_URL || absBase()).replace(/\/+$/, '');
    const manageUrl = (tok) => `${absBase()}/meetups/manage/${tok}`;
    const acceptUrl = (tok) => `${absBase()}/meetups/invite/${tok}/accept`;
    const declineUrl = (tok) => `${absBase()}/meetups/invite/${tok}/decline`;
    const hostUrl = (tok) => `${absBase()}/meetups/host/${tok}`;
    const qrUrl = (aid) => `${absBase()}/api/v2/meetups/qr/${aid}.png`;
    const icsUrl = (tok) => `${absBase()}/api/v2/meetups/calendar/${tok}.ics`;
    const browseUrl = () => `${memberBase()}/app/plexus/meetups`;
    const signupUrl = () => `${memberBase()}/app/auth/signup`;

    // ---------------------------------------------------------------- shaping
    const hostLineOf = (m) => [m.host_name, m.host_title].filter(Boolean).join(' · ') || null;

    function meetupJson(m, opts) {
        const o = opts || {};
        const live = core.confirmedCount(q, m.id);
        const waiting = core.waitingOf(q, m.id).length;
        const cap = Number(m.capacity) || 0;
        const mine = o.mine || null;
        const tok = mine ? (mine.manage_token || null) : null;
        return {
            id: m.id, edition_id: m.edition_id, title: m.title, kind: m.kind,
            description: m.description || null, audience: m.audience || null, tags: parseTags(m.tags),
            venue_name: m.venue_name || null, venue_address: m.venue_address || null, venue_map_url: m.venue_map_url || null,
            starts_at: m.starts_at, ends_at: m.ends_at || null, when_label: whenLabel(m.starts_at, m.ends_at),
            day: String(m.starts_at || '').slice(0, 10),
            capacity: cap, waitlist_enabled: Number(m.waitlist_enabled) === 1,
            visibility: m.visibility, status: m.status,
            host_name: m.host_name || null, host_title: m.host_title || null, host_line: hostLineOf(m),
            confirmed: live, waitlisted: waiting, spots_left: Math.max(0, cap - live), full: live >= cap,
            my_status: mine ? mine.status : null,
            my_waitlist_pos: mine && mine.status === 'waitlisted' ? Number(mine.waitlist_pos) || null : null,
            checked_in: mine ? Number(mine.checked_in) === 1 : false,
            manage_url: tok ? manageUrl(tok) : null,
            qr_url: mine && LIVE.includes(mine.status) ? qrUrl(mine.id) : null,
            calendar_url: tok ? icsUrl(tok) : null,
            apple_pass_url: tok && applePass.isConfigured() ? `${absBase()}/api/v2/meetups/pass/${tok}.pkpass` : null,
            google_wallet_url: tok && wallet.isConfigured() ? `${absBase()}/api/v2/meetups/wallet/${tok}` : null,
            is_host: !!o.isHost
        };
    }

    // ---------------------------------------------------------------- wallet + assets
    function googleSaveUrl(attendee, m) {
        if (!wallet.isConfigured()) return null;
        try {
            const base = absBase();
            const classId = wallet.classIdFor('plexus-meetup-' + m.id);
            const classBody = wallet.buildEventTicketClass({
                classId, issuerName: 'Med&X',
                eventName: m.title || 'Plexus Week meetup',
                venue: m.venue_name || 'Zagreb', venueAddress: m.venue_address || m.venue_name || 'Zagreb',
                startISO: m.starts_at || undefined, endISO: m.ends_at || undefined,
                hexBackgroundColor: '#14100d', homepageUri: base
            });
            const object = wallet.buildEventTicketObject({
                objectId: wallet.objectIdFor('mt-' + attendee.id), classId,
                token: 'm-' + attendee.id, name: fullName(attendee),
                registrationNumber: shortCode(attendee.id),
                category: 'Meetup', statusLabel: 'Confirmed',
                events: [m.title].filter(Boolean), hexBackgroundColor: '#14100d'
            });
            const url = wallet.buildSaveUrl({ classes: [classBody], objects: [object], origins: [base] }).saveUrl;
            Promise.resolve()
                .then(() => wallet.ensureEventClass(classBody))
                .then(() => wallet.ensureEventObject(object))
                .catch(err => log('wallet provision failed (non-blocking):', err.message));
            return url;
        } catch (e) { log('Google Wallet mint failed:', e.message); return null; }
    }
    function assetLinks(attendee, m) {
        const tok = manageTokenOf(attendee);
        return {
            manageUrl: manageUrl(tok),
            qrPngUrl: qrUrl(attendee.id),
            shortCode: shortCode(attendee.id),
            calendarUrl: icsUrl(tok),
            applePassUrl: applePass.isConfigured() ? `${absBase()}/api/v2/meetups/pass/${tok}.pkpass` : null,
            walletSaveUrl: googleSaveUrl(attendee, m)
        };
    }
    function icsFor(attendee, m) {
        const stamp = (iso, fallbackHour) => {
            const d = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
            if (!d) return null;
            return `${d[1]}${d[2]}${d[3]}T${String(d[4] || fallbackHour || '10').padStart(2, '0')}${d[5] || '00'}00`;
        };
        const startHour = Number(String(m.starts_at || '').slice(11, 13));
        const start = stamp(m.starts_at, '10');
        const end = stamp(m.ends_at, null) || stamp(m.starts_at, String(Math.min(23, (Number.isFinite(startHour) ? startHour : 10) + 1)).padStart(2, '0'));
        const escIcs = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
        return [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Med&X//Plexus Week Meetups//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
            'BEGIN:VTIMEZONE', 'TZID:Europe/Zagreb',
            'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZNAME:CET', 'END:STANDARD',
            'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZNAME:CEST', 'END:DAYLIGHT',
            'END:VTIMEZONE',
            'BEGIN:VEVENT',
            `UID:medx-meetup-${attendee.id}@medx.hr`,
            `DTSTAMP:${nowIso().replace(/[-:]/g, '').slice(0, 15)}Z`,
            start ? `DTSTART;TZID=Europe/Zagreb:${start}` : null,
            end ? `DTEND;TZID=Europe/Zagreb:${end}` : null,
            `SUMMARY:${escIcs(m.title || 'Plexus Week meetup')}`,
            m.venue_name ? `LOCATION:${escIcs([m.venue_name, m.venue_address].filter(Boolean).join(', '))}` : null,
            `DESCRIPTION:${escIcs([m.description, hostLineOf(m) ? 'Host: ' + hostLineOf(m) : null].filter(Boolean).join('\n'))}`,
            'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR'
        ].filter(Boolean).join('\r\n');
    }

    // ---------------------------------------------------------------- email
    // EVERY send goes through ctx.sendEmail (Brevo in prod, EMAIL_DUMP_DIR on staging, a capturing
    // stub in the tests). Nothing here ever touches the wire itself.
    async function send(to, subject, html) {
        if (!to || !validEmail(to)) return false;
        try { await sendEmail(to, subject, html); return true; }
        catch (e) { log('email failed:', e.message); return false; }
    }
    const isMemberEmail = (email) => !!q.get('SELECT id FROM users WHERE lower(email) = lower(?)', [String(email || '')]);
    function mailParams(attendee, m, extra) {
        return Object.assign({
            firstName: attendee.first_name || null,
            isMember: !!attendee.user_id || isMemberEmail(attendee.email),
            signupUrl: signupUrl(), browseUrl: browseUrl(),
            hostLine: hostLineOf(m), hostName: m.host_name || null,
            hostFirstName: String(m.host_name || '').split(' ')[0] || null,
            meetup: {
                title: m.title, kind: m.kind, description: m.description,
                venue_name: m.venue_name, venue_address: m.venue_address, venue_map_url: m.venue_map_url,
                capacity: Number(m.capacity) || null, whenLabel: whenLabel(m.starts_at, m.ends_at)
            }
        }, assetLinks(attendee, m), extra || {});
    }
    const mailJoined = (a, m) => send(a.email, `You are in — ${m.title}`, mail.joinedConfirmed(mailParams(a, m)));
    const mailWaitlisted = (a, m) => send(a.email, `Waitlisted — ${m.title}`, mail.waitlisted(mailParams(a, m, { position: Number(a.waitlist_pos) || 1 })));
    const mailPromoted = (a, m) => send(a.email, `A place opened — ${m.title}`, mail.promoted(mailParams(a, m)));
    const mailCancelledByYou = (a, m) => send(a.email, `Cancelled — ${m.title}`, mail.cancelledByYou(mailParams(a, m)));
    function mailHostFyi(m, line, headcountLine) {
        if (!m.host_email || !validEmail(m.host_email)) return Promise.resolve(false);
        return send(m.host_email, `${m.title} — list update`, mail.hostFyi({
            meetup: { title: m.title, whenLabel: whenLabel(m.starts_at, m.ends_at), venue_name: m.venue_name, venue_address: m.venue_address },
            line, headcountLine, hostUrl: m.host_token ? hostUrl(m.host_token) : null
        }));
    }
    const headcountLine = (m) => `${core.confirmedCount(q, m.id)} of ${Number(m.capacity) || 0} confirmed`;

    /** The after-effects of a cancel: the emails, all of them OUTSIDE the transaction. */
    async function afterCancel(m, result, opts) {
        const o = opts || {};
        if (result.cancelled && !result.noop && o.notifyCancelled !== false) {
            try { await mailCancelledByYou(result.cancelled, m); } catch (e) { log('cancel mail:', e.message); }
        }
        if (result.promoted) {
            try { await mailPromoted(result.promoted, m); } catch (e) { log('promote mail:', e.message); }
            try { await mailHostFyi(m, `${fullName(result.promoted)} moved up from the waitlist and now has a place at ${m.title}.`, headcountLine(m)); } catch (e) { log('host fyi:', e.message); }
        }
    }

    // ================================================================ MEMBER ROUTES
    const me = (req) => (req.user || {});
    const myEmail = (req) => String(me(req).email || '').trim();
    const myRowFor = (req, mid) => {
        const email = myEmail(req);
        return email ? q.get('SELECT * FROM plexus_meetup_attendees WHERE meetup_id = ? AND lower(email) = lower(?)', [mid, email]) : null;
    };
    const isHostOf = (req, m) => !!(m && m.host_user_id && String(m.host_user_id) === String(me(req).id));
    const resolveEdition = (query) => {
        const wanted = query && query.edition ? String(query.edition) : null;
        if (wanted) { const e = editions.getEdition(q, wanted); if (e) return e; }
        return editions.activeEdition(q);
    };
    const profileSnapshot = (userId) => userId
        ? (q.get('SELECT id, email, first_name, last_name, institution, title, bio FROM users WHERE id = ?', [userId])
            || q.get('SELECT id, email, first_name, last_name, institution, bio FROM users WHERE id = ?', [userId]))
        : null;

    // ---- the board
    app.get('/api/v2/meetups', auth, (req, res) => {
        try {
            const ed = resolveEdition(req.query);
            if (!ed) return res.json({ edition: null, editions: [], meetups: [], days: [], tags: [] });
            const email = myEmail(req);
            const mine = email ? q.all('SELECT * FROM plexus_meetup_attendees WHERE lower(email) = lower(?)', [email]) : [];
            const mineBy = {}; mine.forEach(a => { mineBy[a.meetup_id] = a; });
            const rows = q.all("SELECT * FROM plexus_meetups WHERE edition_id = ? AND status IN ('published','completed') ORDER BY starts_at, title", [ed.id]);
            // Invite-only meetups appear ONLY to people who were invited (spec §3 "Member view").
            const visible = rows.filter(m => m.visibility !== 'invite' || (mineBy[m.id] && mineBy[m.id].status !== 'declined'));
            const out = visible.map(m => meetupJson(m, { mine: mineBy[m.id] || null, isHost: isHostOf(req, m) }));
            res.json({
                edition: editions.toJson(ed),
                editions: editions.listEditions(q).map(editions.toJson),
                meetups: out,
                days: [...new Set(out.map(m => m.day).filter(Boolean))].sort(),
                tags: [...new Set(out.flatMap(m => m.tags))].sort()
            });
        } catch (e) { log('board:', e.message); res.status(500).json({ error: 'The meetups board is unavailable right now.' }); }
    });

    // ---- my meetups
    app.get('/api/v2/meetups/mine', auth, (req, res) => {
        try {
            const email = myEmail(req);
            if (!email) return res.json({ meetups: [], hosting: [] });
            const rows = q.all("SELECT * FROM plexus_meetup_attendees WHERE lower(email) = lower(?) AND status IN ('confirmed','promoted','waitlisted','invited')", [email]);
            const out = [];
            for (const a of rows) {
                const m = core.meetupById(q, a.meetup_id);
                if (!m || m.status === 'draft') continue;
                const tok = manageTokenOf(a);
                out.push(Object.assign(meetupJson(m, { mine: a }), {
                    invite: a.status === 'invited' ? { accept_url: acceptUrl(tok), decline_url: declineUrl(tok) } : null,
                    cancelled: m.status === 'cancelled'
                }));
            }
            out.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
            const hosting = q.all("SELECT * FROM plexus_meetups WHERE host_user_id = ? AND status <> 'draft' ORDER BY starts_at", [me(req).id || ''])
                .map(m => Object.assign(meetupJson(m, { isHost: true }), { host_url: `${memberBase()}/app/plexus/meetups/${m.id}/host` }));
            res.json({ meetups: out, hosting });
        } catch (e) { log('mine:', e.message); res.status(500).json({ error: 'Your meetups are unavailable right now.' }); }
    });

    // ---- one meetup
    app.get('/api/v2/meetups/:id', auth, (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m || m.status === 'draft') return res.status(404).json({ error: 'Meetup not found' });
            const mine = myRowFor(req, m.id);
            const host = isHostOf(req, m);
            if (m.visibility === 'invite' && !mine && !host && !me(req).is_admin) return res.status(404).json({ error: 'Meetup not found' });
            res.json({ meetup: meetupJson(m, { mine, isHost: host }) });
        } catch (e) { log('detail:', e.message); res.status(500).json({ error: 'That meetup is unavailable right now.' }); }
    });

    // ---- join
    app.post('/api/v2/meetups/:id/join', auth, async (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m || m.status !== 'published') return res.status(404).json({ error: 'Meetup not found' });
            const email = myEmail(req);
            if (!email) return res.status(400).json({ error: 'Your account has no email address — write to us and we will fix it.' });
            const existing = myRowFor(req, m.id);
            if (m.visibility === 'invite' && !existing) {
                return res.status(403).json({ error: 'This meetup is by invitation. Watch your inbox — the host invites people directly.' });
            }
            const startsMs = zagrebMs(m.starts_at);          // Europe/Zagreb wall time, not the server's clock
            if (Number.isFinite(startsMs) && startsMs < Date.now()) {
                return res.status(400).json({ error: 'This meetup has already happened.' });
            }
            const p = profileSnapshot(me(req).id) || {};
            const result = core.placePerson(cx, m, {
                user_id: me(req).id || null, email,
                first_name: p.first_name || null, last_name: p.last_name || null,
                institution: p.institution || null, position: p.title || null, bio: p.bio || null
            }, 'portal', { actor: email });
            persist();

            if (result.status === 'full') {
                return res.status(409).json({ error: 'This table is full and the waitlist is closed.', meetup: meetupJson(m, { mine: result.attendee }) });
            }
            if (!result.already) {
                if (result.status === 'confirmed') {
                    await mailJoined(result.attendee, m);
                    await mailHostFyi(m, `${fullName(result.attendee)} joined ${m.title}.`, headcountLine(m));
                } else {
                    await mailWaitlisted(result.attendee, m);
                }
            }
            res.json({ success: true, status: result.status, already: !!result.already, meetup: meetupJson(m, { mine: result.attendee }) });
        } catch (e) { log('join:', e.message); res.status(500).json({ error: 'Could not join this meetup — please try again.' }); }
    });

    // ---- cancel (portal)
    app.post('/api/v2/meetups/:id/cancel', auth, async (req, res) => {
        try {
            const m = core.meetupById(q, req.params.id);
            if (!m) return res.status(404).json({ error: 'Meetup not found' });
            const mine = myRowFor(req, m.id);
            if (!mine || mine.status === 'cancelled') return res.status(404).json({ error: 'You do not have a place at this meetup.' });
            const result = core.cancelAndPromote(cx, m, mine, myEmail(req));
            persist();
            // A receipt, because the portal's toast is gone in a second and nothing else says it
            // happened. The manage PAGE is its own receipt, so that path stays silent.
            await afterCancel(m, result);
            res.json({ success: true, promoted: !!result.promoted, meetup: meetupJson(m, { mine: result.cancelled }) });
        } catch (e) { log('cancel:', e.message); res.status(500).json({ error: 'Could not cancel your place — please try again.' }); }
    });

    // ================================================================ HOST VIEW (scoped, both doors)
    function hostPayload(m) {
        const rows = core.attendeesOf(q, m.id);
        const live = rows.filter(a => LIVE.includes(a.status));
        const waiting = core.waitingOf(q, m.id);
        return {
            meetup: {
                id: m.id, title: m.title, kind: m.kind, description: m.description || null,
                when_label: whenLabel(m.starts_at, m.ends_at), starts_at: m.starts_at, ends_at: m.ends_at || null,
                venue_name: m.venue_name || null, venue_address: m.venue_address || null, venue_map_url: m.venue_map_url || null,
                capacity: Number(m.capacity) || 0, status: m.status,
                host_name: m.host_name || null, host_title: m.host_title || null
            },
            headcount: {
                confirmed: live.length, capacity: Number(m.capacity) || 0,
                waitlisted: waiting.length, checked_in: live.filter(a => Number(a.checked_in) === 1).length
            },
            attendees: live.map(core.personCard),
            waitlist: waiting.map(core.personCard),
            invited: rows.filter(a => a.status === 'invited').map(core.personCard)
        };
    }
    /**
     * 404, never 403: a host must not be able to learn that another meetup exists.
     * Admins are exempt on purpose — they already read every attendee in the admin portal's
     * drawer, so refusing them the host's own view would hide nothing and would stop them
     * helping a host who has lost their link. The scoping that matters holds: a member who is
     * not this meetup's host, admin or not, gets 404.
     */
    function hostGuard(req, res) {
        const m = core.meetupById(q, req.params.id);
        if (!m) { res.status(404).json({ error: 'Meetup not found' }); return null; }
        if (!isHostOf(req, m) && !me(req).is_admin) { res.status(404).json({ error: 'Meetup not found' }); return null; }
        return m;
    }

    app.get('/api/v2/meetups/:id/host', auth, (req, res) => {
        try {
            const m = hostGuard(req, res); if (!m) return;
            res.json(Object.assign(hostPayload(m), { host_link: m.host_token ? hostUrl(m.host_token) : null }));
        } catch (e) { log('host view:', e.message); res.status(500).json({ error: 'Your meetup is unavailable right now.' }); }
    });

    app.post('/api/v2/meetups/:id/host/scan', auth, (req, res) => {
        try {
            const m = hostGuard(req, res); if (!m) return;
            const out = core.checkInByCode({ q, sign, actor: myEmail(req) }, m, (req.body || {}).code);
            persist();
            res.json(out);
        } catch (e) { log('host scan:', e.message); res.status(500).json({ error: 'Could not read that code.' }); }
    });

    // Message my attendees → DRAFTS in the approval outbox. House rule: no direct blasts.
    function stageHostMessage(m, subject, body, actor) {
        const recipients = core.liveOf(q, m.id).map(a => a.email).filter(validEmail);
        if (!recipients.length) return { staged: 0, batch: null };
        const batch = 'meetup-host-' + String(m.id).slice(0, 8) + '-' + Date.now().toString(36);
        let staged = 0;
        for (const to of recipients) {
            const subj = `${m.title} — ${subject}`;
            const html = mail.meetupShell({
                eyebrow: 'A note from your host',
                headline: esc(subject),
                bodyHtml: `<p style="margin:0;">${esc(body).replace(/\n/g, '<br>')}</p>`,
                preheader: clean(body, 120)
            });
            try {
                // SAME outbox contract every other module uses: 'pending_approval', the mail itself
                // in payload_json {to, subject, html, channel, project}. The admin EMAIL & OUTBOX
                // tab's APPROVE & SEND is the only path to an actual send.
                q.run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
                       VALUES (?, 'pending_approval', ?, 'v2-meetups', 'meetup_host_message', ?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), batch,
                     JSON.stringify({ to, subject: subj, html, channel: 'email', project: 'meetups', meetup_id: m.id }),
                     to, subj, actor || 'host', nowIso()]);
                staged++;
            } catch (e) { log('stage host message:', e.message); }
        }
        core.audit(q, m.id, null, 'host-message-staged', `${staged} draft(s), batch ${batch}`, actor);
        persist();
        return { staged, batch };
    }

    app.post('/api/v2/meetups/:id/host/message', auth, (req, res) => {
        try {
            const m = hostGuard(req, res); if (!m) return;
            const subject = clean((req.body || {}).subject, 160);
            const body = clean((req.body || {}).body, 4000);
            if (!subject || !body) return res.status(400).json({ error: 'A subject and a message are both needed.' });
            const out = stageHostMessage(m, subject, body, myEmail(req));
            res.json(Object.assign({ success: true, approval_required: true }, out,
                { message: 'Your note is waiting for the team to approve and send — nothing goes out automatically.' }));
        } catch (e) { log('host message:', e.message); res.status(500).json({ error: 'Could not stage that message.' }); }
    });

    // ================================================================ PUBLIC TOKEN SURFACES
    const page = (o) => tpl.brandedPage({ title: o.title, eyebrow: o.eyebrow, headlineHtml: o.headline, bodyHtml: o.bodyHtml });
    function notFoundPage(res) {
        res.status(404).send(page({
            title: 'This link is not available — Med&X',
            eyebrow: 'Plexus Week',
            headline: 'This link is not available.',
            bodyHtml: '<p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">The link may have expired, or the place it pointed at is gone. If you believe this is a mistake, write to Laura Rodman at laura.rodman@medx.hr and she will sort it out.</p>'
        }));
    }
    const factLine = (label, value) => value
        ? `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(25,21,18,.1);font-size:13px;">
             <span style="min-width:92px;font-weight:600;font-size:9px;letter-spacing:.14em;color:#6e5626;text-transform:uppercase;padding-top:3px;">${esc(label)}</span>
             <span style="color:#191512;">${esc(value)}</span></div>`
        : '';
    const factsFor = (m) => factLine('When', whenLabel(m.starts_at, m.ends_at))
        + factLine('Where', [m.venue_name, m.venue_address].filter(Boolean).join(' · '))
        + factLine('Host', hostLineOf(m));

    function managePageHtml(a, m) {
        const gone = a.status === 'cancelled' || a.status === 'declined';
        const place = a.status === 'waitlisted' ? `Waitlist · number ${Number(a.waitlist_pos) || 1}` : (gone ? 'Cancelled' : 'Confirmed');
        return page({
            title: `${m.title} — Med&X`,
            eyebrow: 'Plexus Week · Meetups',
            headline: esc(m.title),
            bodyHtml: `
      <p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">${gone
                ? 'You are no longer on the list for this meetup. Nothing more to do.'
                : 'Everything about your place is below. Plans change — if you cannot make it, releasing the place hands it straight to the next person waiting.'}</p>
      <div style="margin-top:18px;">${factsFor(m)}${factLine('Your place', place)}</div>
      ${gone ? '' : `<form method="POST" action="/meetups/manage/${esc(a.manage_token)}" style="margin:0;"><button class="mx" type="submit">Cancel my place</button></form>`}
      ${m.status === 'cancelled' ? '<p style="font-size:13px;color:#9b1b22;margin-top:16px;">This meetup has been cancelled by the organizers.</p>' : ''}
      <p style="font-size:12px;color:#4a4239;margin-top:22px;">Questions? Reply to the email that brought you here, or write to laura.rodman@medx.hr.</p>`
        });
    }

    app.get('/meetups/manage/:token', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return notFoundPage(res);
            const { attendee, meetup } = hit;
            if (attendee.status === 'invited') {
                const tok = manageTokenOf(attendee);
                return res.send(page({
                    title: `${meetup.title} — Med&X`,
                    eyebrow: 'An invitation',
                    headline: esc(meetup.title),
                    bodyHtml: `<p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">${esc(meetup.description || 'A small table during Plexus Week — good conversation, and the time to have it.')}</p>
                      <div style="margin-top:18px;">${factsFor(meetup)}</div>
                      <div style="margin-top:22px;display:flex;gap:12px;flex-wrap:wrap;">
                        <a class="ghost" style="background:#9b1b22;color:#f7f1e6;border-color:#9b1b22;" href="/meetups/invite/${esc(tok)}/accept">Yes, I would love to</a>
                        <a class="ghost" href="/meetups/invite/${esc(tok)}/decline">I can&#39;t make it</a>
                      </div>`
                }));
            }
            res.send(managePageHtml(attendee, meetup));
        } catch (e) { log('manage page:', e.message); notFoundPage(res); }
    });

    app.post('/meetups/manage/:token', async (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return notFoundPage(res);
            const { attendee, meetup } = hit;
            if (attendee.status === 'cancelled') return res.send(managePageHtml(attendee, meetup));
            const result = core.cancelAndPromote(cx, meetup, attendee, attendee.email);
            persist();
            await afterCancel(meetup, result, { notifyCancelled: false });   // they are looking at the page
            res.send(page({
                title: `Cancelled — ${meetup.title}`,
                eyebrow: 'Plexus Week · Meetups',
                headline: 'Your place is released.',
                bodyHtml: `<p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">You are off the list for <b>${esc(meetup.title)}</b>${result.promoted ? ', and the place has already gone to the next person waiting' : ''}. Thank you for letting us know.</p>
                  <p style="font-size:13px;color:#4a4239;margin-top:16px;">There are usually a few places left elsewhere in the week — <a href="${esc(browseUrl())}">have a look</a>.</p>`
            }));
        } catch (e) { log('manage cancel:', e.message); notFoundPage(res); }
    });

    // ---- invitation accept / decline (public GET, the manage token is the credential)
    app.get('/meetups/invite/:token/accept', async (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return notFoundPage(res);
            const { attendee, meetup } = hit;
            if (meetup.status === 'cancelled') {
                return res.send(page({
                    title: `${meetup.title} — Med&X`, eyebrow: 'Plexus Week · Meetups',
                    headline: 'This meetup was cancelled.',
                    bodyHtml: `<p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">We are sorry — <b>${esc(meetup.title)}</b> will not go ahead. Nothing is needed from you.</p>`
                }));
            }
            // Invitation accepts skip the review gate on purpose (spec §3): we invited them.
            const result = core.placePerson(cx, meetup, {
                email: attendee.email, user_id: attendee.user_id,
                first_name: attendee.first_name, last_name: attendee.last_name,
                institution: attendee.institution, position: attendee.position, bio: attendee.bio
            }, 'email-invite', { actor: attendee.email });
            persist();
            if (!result.already && result.attendee) {
                if (result.status === 'confirmed') {
                    await mailJoined(result.attendee, meetup);
                    await mailHostFyi(meetup, `${fullName(result.attendee)} accepted your invitation to ${meetup.title}.`, headcountLine(meetup));
                } else if (result.status === 'waitlisted') {
                    await mailWaitlisted(result.attendee, meetup);
                }
            }
            const waitlisted = result.status === 'waitlisted';
            res.send(page({
                title: `${meetup.title} — Med&X`,
                eyebrow: 'Plexus Week · Meetups',
                headline: waitlisted ? 'You are on the waitlist.' : 'Wonderful — you are in.',
                bodyHtml: `<p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">${waitlisted
                    ? `Every place at <b>${esc(meetup.title)}</b> is taken for now, so we have put you on the waitlist. If a place opens it is yours automatically, and we write to you at once.`
                    : `Your place at <b>${esc(meetup.title)}</b> is held. A confirmation with your code and wallet passes is on its way to <b>${esc(attendee.email)}</b>.`}</p>
                  <div style="margin-top:18px;">${factsFor(meetup)}</div>
                  <a class="ghost" href="/meetups/manage/${esc(manageTokenOf(attendee))}">Manage my place</a>`
            }));
        } catch (e) { log('invite accept:', e.message); notFoundPage(res); }
    });

    app.get('/meetups/invite/:token/decline', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return notFoundPage(res);
            const { attendee, meetup } = hit;
            if (!['cancelled', 'declined'].includes(attendee.status)) {
                q.run("UPDATE plexus_meetup_attendees SET status = 'declined', waitlist_pos = NULL, cancelled_at = ? WHERE id = ?", [nowIso(), attendee.id]);
                core.audit(q, meetup.id, attendee.id, 'declined', 'declined the invitation', attendee.email);
                core.renumberWaitlist(q, meetup.id);
                persist();
            }
            res.send(page({
                title: `${meetup.title} — Med&X`,
                eyebrow: 'Plexus Week · Meetups',
                headline: 'Thank you for telling us.',
                bodyHtml: `<p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">We have taken you off the list for <b>${esc(meetup.title)}</b>. There is plenty else happening during the week.</p>
                  <a class="ghost" href="${esc(browseUrl())}">See what else is on</a>`
            }));
        } catch (e) { log('invite decline:', e.message); notFoundPage(res); }
    });

    // ---- the host page's scanner (spec §3 "Check-in": the host page gets the same camera
    // scanner, gated by host_token). Self-contained and OPTIONAL by design — no camera, or a
    // refused permission, simply leaves the manual code box, because check-in is optional in
    // practice and a host who cannot scan must never be stuck. jsQR is the same vendored decoder
    // the member SPA precaches, served from this origin (CSP 'self').
    function hostScannerHtml(token) {
        const t = esc(token);
        return `
      <div style="margin-top:26px;padding-top:18px;border-top:1px solid rgba(25,21,18,.12);">
        <div style="font-weight:600;font-size:10px;letter-spacing:.16em;color:#6e5626;">CHECK SOMEONE IN <span style="color:#4a4239;font-weight:400;letter-spacing:0;text-transform:none;">— entirely optional</span></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;">
          <button class="mx" type="button" id="mxCam" style="margin-top:0;">Open the camera</button>
          <input id="mxCode" placeholder="…or type the code" style="flex:1;min-width:180px;padding:12px 14px;border:1px solid rgba(25,21,18,.25);background:#fff;font-family:inherit;font-size:13px;">
          <button class="mx" type="button" id="mxGo" style="margin-top:0;">Check in</button>
        </div>
        <video id="mxVid" playsinline muted style="display:none;width:100%;max-width:340px;margin-top:12px;background:#191512;"></video>
        <div id="mxOut" style="margin-top:14px;"></div>
      </div>
      <script src="/vendor/jsqr/jsQR.min.js"></script>
      <script>
      (function () {
        var TOKEN = ${JSON.stringify(String(token))};
        var out = document.getElementById('mxOut');
        var vid = document.getElementById('mxVid');
        var stream = null, raf = null, busy = false, last = '';
        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
        function card(r) {
          var p = r.person || {};
          var good = !!r.ok;
          var line = [p.position, p.institution].filter(Boolean).join(' \\u00b7 ');
          out.innerHTML = '<div style="border-left:3px solid ' + (good ? '#1e6e42' : '#9b1b22') + ';padding:10px 14px;background:#fdfaf3;">'
            + '<div style="font-weight:600;font-size:10px;letter-spacing:.14em;color:' + (good ? '#1e6e42' : '#9b1b22') + ';">' + esc((r.message || '').toUpperCase()) + '</div>'
            + (p.name ? '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;margin-top:4px;">' + esc(p.name) + '</div>' : '')
            + (line ? '<div style="font-size:12px;color:#4a4239;margin-top:2px;">' + esc(line) + '</div>' : '')
            + (p.bio ? '<div style="font-size:12px;color:#4a4239;margin-top:6px;line-height:1.6;">' + esc(String(p.bio).slice(0, 240)) + '</div>' : '')
            + '</div>';
        }
        function send(code) {
          if (busy || !code) return;
          busy = true;
          fetch('/api/v2/meetups/host/' + TOKEN + '/scan', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code })
          }).then(function (r) { return r.json(); })
            .then(function (r) { card(r); if (r.ok) setTimeout(function () { location.reload(); }, 1600); })
            .catch(function () { out.textContent = 'No connection — try again in a moment.'; })
            .then(function () { setTimeout(function () { busy = false; }, 900); });
        }
        document.getElementById('mxGo').addEventListener('click', function () { send(document.getElementById('mxCode').value.trim()); });
        document.getElementById('mxCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(this.value.trim()); } });
        document.getElementById('mxCam').addEventListener('click', function () {
          if (stream) { stop(); return; }
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof jsQR !== 'function') {
            out.textContent = 'This device cannot scan — type the code instead.'; return;
          }
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
            stream = s; vid.srcObject = s; vid.style.display = 'block'; vid.play();
            this && 0; document.getElementById('mxCam').textContent = 'Close the camera';
            var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
            (function tick() {
              raf = requestAnimationFrame(tick);
              if (vid.readyState !== vid.HAVE_ENOUGH_DATA) return;
              cv.width = vid.videoWidth; cv.height = vid.videoHeight;
              cx.drawImage(vid, 0, 0, cv.width, cv.height);
              var img = cx.getImageData(0, 0, cv.width, cv.height);
              var hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (hit && hit.data && hit.data !== last) { last = hit.data; send(hit.data); }
            })();
          }).catch(function () { out.textContent = 'The camera was not allowed — type the code instead.'; });
        });
        function stop() {
          if (raf) cancelAnimationFrame(raf); raf = null;
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
          stream = null; vid.style.display = 'none';
          document.getElementById('mxCam').textContent = 'Open the camera';
        }
        window.addEventListener('pagehide', stop);
      })();
      </script>`;
    }

    // ---- host page without a login
    app.get('/meetups/host/:token', (req, res) => {
        try {
            const m = byHostToken(req.params.token);
            if (!m) return notFoundPage(res);
            const d = hostPayload(m);
            const card = (a) => `
        <div style="padding:12px 0;border-bottom:1px solid rgba(25,21,18,.1);">
          <div style="font-family:Fraunces,Georgia,serif;font-size:17px;">${esc(a.name)}${a.checked_in ? ' <span style="font-size:10px;letter-spacing:.14em;color:#1e6e42;">· HERE</span>' : ''}</div>
          <div style="font-size:12px;color:#4a4239;margin-top:2px;">${esc([a.position, a.institution].filter(Boolean).join(' · ') || '—')}</div>
          ${a.bio ? `<div style="font-size:12px;color:#4a4239;margin-top:6px;line-height:1.6;">${esc(String(a.bio).slice(0, 260))}</div>` : ''}
        </div>`;
            const stat = (label, value, sub) => `<div><div style="font-weight:600;font-size:9px;letter-spacing:.16em;color:#6e5626;">${label}</div><div style="font-family:Fraunces,Georgia,serif;font-size:26px;">${value}${sub || ''}</div></div>`;
            res.send(page({
                title: `${m.title} — host view`,
                eyebrow: 'Plexus Week · Host',
                headline: esc(m.title),
                bodyHtml: `
        <p style="font-size:14px;line-height:1.7;color:#4a4239;margin-top:14px;">${esc(d.meetup.when_label)}${d.meetup.venue_name ? ' · ' + esc(d.meetup.venue_name) : ''}</p>
        <div style="display:flex;gap:26px;margin-top:20px;padding:16px 0;border-top:1px solid rgba(25,21,18,.12);border-bottom:1px solid rgba(25,21,18,.12);">
          ${stat('COMING', d.headcount.confirmed, `<span style="font-size:14px;color:#4a4239;"> / ${d.headcount.capacity}</span>`)}
          ${stat('WAITING', d.headcount.waitlisted)}
          ${stat('ARRIVED', d.headcount.checked_in)}
        </div>
        <div style="margin-top:18px;font-weight:600;font-size:10px;letter-spacing:.16em;color:#6e5626;">YOUR TABLE</div>
        ${d.attendees.length ? d.attendees.map(card).join('') : '<p style="font-size:13px;color:#4a4239;font-style:italic;margin-top:10px;">Nobody has joined yet — the invitations are out.</p>'}
        ${d.waitlist.length ? `<div style="margin-top:22px;font-weight:600;font-size:10px;letter-spacing:.16em;color:#6e5626;">WAITLIST</div>${d.waitlist.map(card).join('')}` : ''}
        ${m.status === 'cancelled' ? '' : hostScannerHtml(req.params.token)}
        <p style="font-size:12px;color:#4a4239;margin-top:24px;">This page is yours alone — the link is the key, so please keep it to yourself. Check-in is entirely optional: scanning a guest&#39;s code simply tells you who is in front of you.</p>`
            }));
        } catch (e) { log('host page:', e.message); notFoundPage(res); }
    });

    app.get('/api/v2/meetups/host/:token/data', (req, res) => {
        try {
            const m = byHostToken(req.params.token);
            if (!m) return res.status(404).json({ error: 'Not found' });
            res.json(hostPayload(m));
        } catch (e) { res.status(500).json({ error: 'Unavailable' }); }
    });

    app.post('/api/v2/meetups/host/:token/scan', (req, res) => {
        try {
            const m = byHostToken(req.params.token);
            if (!m) return res.status(404).json({ error: 'Not found' });
            const out = core.checkInByCode({ q, sign, actor: m.host_email || 'host' }, m, (req.body || {}).code);
            persist();
            res.json(out);
        } catch (e) { res.status(500).json({ error: 'Could not read that code.' }); }
    });

    // ---- branded QR (Med&X plate only — spec §3 "Wallet + QR")
    app.get('/api/v2/meetups/qr/:attendeeId.png', async (req, res) => {
        const id = String(req.params.attendeeId || '').trim();
        try {
            if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) return res.status(404).json({ error: 'Not found' });
            const a = q.get('SELECT id FROM plexus_meetup_attendees WHERE id = ?', [id]);
            if (!a) return res.status(404).json({ error: 'Not found' });
            if (!QRCodeLib || !pngjsLib) return res.status(503).json({ error: 'QR rendering is unavailable on this server.' });
            const png = await brandedQr.render({ payload: 'm-' + a.id, platePath: MEDX_PLATE, qrcode: QRCodeLib, pngjs: pngjsLib });
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=3600');
            res.send(png);
        } catch (e) { log('qr:', e.message); if (!res.headersSent) res.status(500).json({ error: 'Could not render that code.' }); }
    });

    // ---- Apple Wallet
    app.get('/api/v2/meetups/pass/:token.pkpass', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return res.status(404).json({ error: 'Not found' });
            const { attendee, meetup } = hit;
            if (!LIVE.includes(attendee.status)) return res.status(404).json({ error: 'Not found' });
            if (!applePass.isConfigured()) return res.status(503).json({ error: 'Apple Wallet passes are not enabled on this server yet. The QR in your email is enough.' });
            const buf = applePass.buildPkpass({
                style: 'eventTicket',
                serial: 'medx-mt-' + attendee.id,
                description: 'Med&X — ' + (meetup.title || 'Plexus Week meetup'),
                relevantDate: meetup.starts_at || undefined,
                fields: {
                    header: [{ key: 'event', label: 'PLEXUS WEEK', value: 'Meetup' }],
                    primary: [],
                    secondary: [
                        { key: 'when', label: 'WHEN', value: whenLabel(meetup.starts_at, meetup.ends_at) || 'During Plexus Week' },
                        { key: 'where', label: 'WHERE', value: meetup.venue_name || 'Zagreb' }
                    ],
                    auxiliary: [
                        { key: 'guest', label: 'GUEST', value: fullName(attendee) },
                        { key: 'ref', label: 'N°', value: shortCode(attendee.id) }
                    ],
                    back: [
                        { key: 'title', label: 'MEETUP', value: meetup.title || '' },
                        { key: 'host', label: 'HOST', value: hostLineOf(meetup) || '—' },
                        { key: 'venue', label: 'VENUE', value: [meetup.venue_name, meetup.venue_address].filter(Boolean).join(' · ') || '—' },
                        { key: 'manage', label: 'CHANGE OF PLAN?', value: 'Cancel your place: ' + manageUrl(attendee.manage_token) },
                        { key: 'support', label: 'SUPPORT', value: 'Questions? laura.rodman@medx.hr' }
                    ]
                },
                qrMessage: 'm-' + attendee.id,
                altText: shortCode(attendee.id)
            });
            res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
            res.setHeader('Content-Disposition', 'inline; filename="medx-meetup.pkpass"');
            res.setHeader('Content-Length', buf.length);
            res.setHeader('Cache-Control', 'private, no-store');
            res.send(buf);
        } catch (e) { log('apple pass:', e.message); res.status(500).json({ error: 'Could not build the pass. The QR in your email admits you.' }); }
    });

    // ---- Google Wallet (302 to the signed save link)
    app.get('/api/v2/meetups/wallet/:token', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return res.status(404).json({ error: 'Not found' });
            if (!LIVE.includes(hit.attendee.status)) return res.status(404).json({ error: 'Not found' });
            const url = googleSaveUrl(hit.attendee, hit.meetup);
            if (!url) return res.status(503).json({ configured: false, error: 'Google Wallet is not enabled on this server yet.' });
            if (String(req.query.format || '') === 'json') return res.json({ configured: true, save_url: url });
            res.redirect(302, url);
        } catch (e) { log('google wallet:', e.message); res.status(500).json({ error: 'Could not build the wallet link.' }); }
    });

    // ---- calendar
    app.get('/api/v2/meetups/calendar/:token.ics', (req, res) => {
        try {
            const hit = byManageToken(req.params.token);
            if (!hit) return res.status(404).json({ error: 'Not found' });
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="medx-meetup.ics"');
            res.send(icsFor(hit.attendee, hit.meetup));
        } catch (e) { res.status(500).json({ error: 'Could not build the calendar file.' }); }
    });

    // ================================================================ REMINDERS (24 h before)
    // Idempotent through the audit trail: one 'reminder-sent' row per attendee, checked before
    // every send, so a restart, the second backend or an extra tick can never double-mail anyone.
    async function runReminders(opts) {
        const o = opts || {};
        const now = o.now ? new Date(o.now) : new Date();
        const horizon = new Date(now.getTime() + REMINDER_WINDOW_H * 3600 * 1000);
        let sent = 0, skipped = 0;
        for (const m of q.all("SELECT * FROM plexus_meetups WHERE status = 'published' AND starts_at IS NOT NULL")) {
            const t = zagrebMs(m.starts_at);                 // Europe/Zagreb wall time → real instant
            if (!Number.isFinite(t) || t < now.getTime() || t > horizon.getTime()) continue;
            for (const a of core.liveOf(q, m.id)) {
                if (q.get('SELECT id FROM plexus_meetup_audit WHERE attendee_id = ? AND action = ?', [a.id, REMINDER_ACTION])) { skipped++; continue; }
                core.audit(q, m.id, a.id, REMINDER_ACTION, 'reminder for ' + m.starts_at, 'system');
                if (await send(a.email, `Tomorrow — ${m.title}`, mail.reminder(mailParams(a, m)))) sent++;
            }
        }
        if (sent) persist();
        return { sent, skipped };
    }
    if (process.env.NODE_ENV !== 'test' && !process.env.MEETUPS_NO_TIMERS) {
        const t = setInterval(() => { runReminders().catch(e => log('reminders:', e.message)); }, 30 * 60 * 1000);
        if (t.unref) t.unref();
    }

    // Exposed for the test suite (and for anything in-process that needs the same maths).
    mountMeetups._internals = {
        sign, tokenMatches, byManageToken, byHostToken, meetupJson, hostPayload,
        runReminders, assetLinks, icsFor, stageHostMessage, ensureSchema, q, cx
    };

    log('meetups: board · join/cancel · waitlist auto-promotion · invites · wallet + QR · host view · reminders');
};

module.exports.MEETUPS_DDL = core.MEETUPS_DDL;
module.exports.whenLabel = whenLabel;
