/**
 * v2/boston-ops.js — the BOSTON "5-minute presentations" panel for the redesigned ADMIN portal
 * (admin-portal/frontend-v2 › js/views/bridges.js, card "Boston · 5-minute presentations").
 *
 * The member backend already owns this feature end to end (user-portal/backend/boston.js): the
 * bridges_presentations table, the per-registrant HMAC upload links (/boston/upload/:token), the
 * branded invite email, the team page and the ZIP of every deck. Nothing of that is duplicated
 * here. This module is the ORGANIZER'S DOOR to it — so the evening can be run from the admin
 * portal instead of from a URL with a secret key pasted into the address bar:
 *
 *   GET  /api/v2/boston/presenters              auth+adminOnly  the list the card renders:
 *        the member portal's own JSON (name, institution, upload state, per-deck download link)
 *        + `invited_at` / `status` read from the SHARED bridges_registrations row, + the counts
 *        the buttons need (`not_invited`) + `zip_url`.
 *   POST /api/v2/boston/presenters/:id/send-link  auth+adminOnly  send / re-send ONE upload link.
 *   POST /api/v2/boston/presenters/send-all       auth+adminOnly  send to everyone not yet invited.
 *   POST /api/v2/boston/presenters/add            auth+adminOnly  { name, email } — the presenter
 *        who never filled the public form. Creates the bridges_registrations row (status
 *        'registered', notes '5-minute presentation requested | added by team', confirmation_sent 0
 *        — deliberately NO ticket, no wallet pass, no confirmation email), then sends the link.
 *        An email that already has a row is never duplicated: the existing row is marked as a
 *        presenter if it was not one, and the link goes to it.
 *   GET  /api/v2/boston/presentations.zip         auth+adminOnly  302 → the member ZIP with the key.
 *   GET  /api/v2/boston/catering                  auth+adminOnly  the catering summary + one row per
 *        registrant (preference, allergies, answered, reminder state) + the CSV url.
 *   POST /api/v2/boston/reminders/:id/send        auth+adminOnly  send / re-send ONE reminder.
 *   POST /api/v2/boston/reminders/send-all        auth+adminOnly  everyone not yet reminded.
 *   GET  /api/v2/boston/catering.csv              auth+adminOnly  302 → the member CSV with the key.
 *
 * THE KEY. The member wing authorizes those routes with a derived team key —
 * HMAC-SHA256(JWT_SECRET, 'boston-admin').slice(0, 40) — and both portals run on ONE JWT_SECRET
 * (IMPLEMENTATION_CONTRACT §1a), so this side simply mints the same string. Nothing to provision,
 * nothing to store, and the key never reaches the browser except inside the download links the
 * member portal itself already builds into its JSON.
 *
 * THE SEND ALWAYS HAPPENS ON THE MEMBER SIDE. sendEmail() is never called here: one branded
 * template, one place that stamps `UPLOAD-LINK-SENT <date>` into the notes, so a link sent from
 * this panel and a link sent from the team page are the same email with the same bookkeeping.
 *
 * REPLICA LAG (the one wrinkle). Both portals share one Turso database, but each keeps its own
 * embedded replica and pulls on a 60 s timer, so a row THIS backend has just inserted can be
 * invisible to the member backend for up to a minute — its send-links route would then quietly
 * find nobody. So sendLink() treats "nothing sent" as "not there yet": it retries briefly inside
 * the request (the common case answers at once), then keeps retrying in the background and stops
 * the moment the member portal confirms. The answer says which of the two happened (`pending`),
 * and the row's invited date is the proof either way.
 *
 * Permission: `bridges` — SECTION_ROUTE_MAP in server.js maps the /api/v2/boston prefix, so a
 * scoped admin sees the same lock here as on the rest of Building Bridges.
 */
'use strict';

const crypto = require('crypto');

// The Boston evening, as user-portal/backend/boston.js fixes it (same literals on purpose — this
// module must never invent a second event id).
const EVENT_ID = 'bb-boston-2026-09-21';
const PRESENTER_MARK = '5-minute presentation';
const PRESENTER_NOTE = '5-minute presentation requested';
const ADDED_NOTE = 'added by team';
const SENT_MARK = 'UPLOAD-LINK-SENT';
const REMINDER_MARK = 'REMINDER-SENT';                 // the member wing's stamp for the reminder
const SENDABLE = ['registered', 'confirmed'];          // the member route's own status filter

// Retry budget for the member send after an insert (see REPLICA LAG above). Under test both
// portals run in one process against one database, so there is never anything to wait for.
const TEST = process.env.NODE_ENV === 'test';
const FOREGROUND_TRIES = TEST ? [5, 5, 5] : [1500, 3000, 5000];   // ~9.5 s inside the request
const BACKGROUND_EVERY_MS = TEST ? 20 : 15000;
const BACKGROUND_FOR_MS = TEST ? 200 : 4 * 60 * 1000;

module.exports = function mountBostonOps(app, ctx) {
    const { db, auth, adminOnly, saveDb } = ctx;
    const JWT_SECRET = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const log = ctx.log || ((...a) => console.log('[v2/boston-ops]', ...a));

    // ---------------------------------------------------------------- query bag
    function getAll(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    function getRow(sql, params) {
        let st = null;
        try { st = db().prepare(sql); st.bind(params || []); return st.step() ? st.getAsObject() : null; }
        finally { if (st) try { st.free(); } catch (e) {} }
    }
    const q = {
        run: (s, p) => db().run(s, p),
        get: (s, p) => { try { return getRow(s, p); } catch (e) { return null; } },
        all: (s, p) => { try { return getAll(s, p); } catch (e) { return []; } }
    };
    function persist() { try { saveDb(); } catch (e) {} try { db().sync(); } catch (e) {} }
    function audit(req, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail, created_at) VALUES (?,?,?,?,?,?)',
                [crypto.randomUUID(), (req && req.user && req.user.id) || null, (req && req.user && req.user.email) || 'system',
                 action, String(detail || '').slice(0, 500), new Date().toISOString()]);
        } catch (e) { /* best-effort */ }
    }

    const cleanStr = (v, n) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, n || 200);
    const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

    // ---------------------------------------------------------------- the member portal
    // Same env fallbacks gala-ops.js uses (USER_PORTAL_URL is set on every deployed service).
    function memberBase() {
        if (process.env.USER_PORTAL_URL) return String(process.env.USER_PORTAL_URL).replace(/\/+$/, '');
        if (process.env.NODE_ENV === 'production' || process.env.RENDER) return 'https://medx-user-portal.onrender.com';
        return 'http://localhost:3010';
    }
    // The member wing's derived team key — same HMAC, same slice. Never logged.
    const adminKey = () => crypto.createHmac('sha256', String(JWT_SECRET)).update('boston-admin').digest('hex').slice(0, 40);
    const keyed = (path) => memberBase() + path + (path.includes('?') ? '&' : '?') + 'key=' + adminKey();

    async function memberCall(method, path, body) {
        const init = { method, headers: { Accept: 'application/json' } };
        if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
        const res = await fetch(keyed(path), init);
        const text = await res.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; } }
        if (!res.ok) {
            const msg = (data && (data.error || data.message)) || ('The member portal answered ' + res.status + '.');
            const err = new Error(msg); err.status = res.status; err.data = data;
            throw err;
        }
        return data || {};
    }

    // ---------------------------------------------------------------- the shared registration rows
    // presentationAdminData() does not carry `notes` or `status` — and the invite marker lives in
    // the notes — so the invited date is read straight from the row both portals share.
    function regsByEvent() {
        return q.all('SELECT id, email, status, notes FROM bridges_registrations WHERE event_id = ?', [EVENT_ID]);
    }
    function invitedAtOf(notes) {
        const m = new RegExp(SENT_MARK + '\\s+(\\d{4}-\\d{2}-\\d{2})').exec(String(notes || ''));
        if (m) return m[1];
        return new RegExp(SENT_MARK).test(String(notes || '')) ? '' : null;   // marker without a date
    }
    const isPresenter = (notes) => new RegExp(PRESENTER_MARK, 'i').test(String(notes || ''));
    const isSendable = (row) => SENDABLE.includes(String((row && row.status) || 'registered').toLowerCase());

    function findByEmail(email) {
        const want = String(email || '').trim().toLowerCase();
        return regsByEvent().find(r => String(r.email || '').trim().toLowerCase() === want) || null;
    }

    // ---------------------------------------------------------------- the send (member side only)
    // Answers { sent:[…], pending:bool }. `pending` means the member backend could not see the row
    // yet (replica lag) and a background retry now owns the send.
    async function sendLink(id, { retry = false } = {}) {
        const out = await memberCall('POST', '/api/boston/presenters/send-links', { to: String(id) });
        const sent = Array.isArray(out.sent) ? out.sent : [];
        if (sent.length || !retry) return { sent, pending: false, raw: out };

        for (const wait of FOREGROUND_TRIES) {
            await new Promise(r => setTimeout(r, wait));
            const again = await memberCall('POST', '/api/boston/presenters/send-links', { to: String(id) });
            if (Array.isArray(again.sent) && again.sent.length) return { sent: again.sent, pending: false, raw: again };
        }
        backgroundSend(id);
        return { sent: [], pending: true, raw: out };
    }
    // Keeps trying until the member replica catches up (or the budget runs out). Stops on the first
    // confirmed send — the member route is the one that stamps the notes, so it cannot double-send.
    function backgroundSend(id) {
        const until = Date.now() + BACKGROUND_FOR_MS;
        const tick = setInterval(async () => {
            if (Date.now() > until) { clearInterval(tick); log('upload link for ' + id + ' still unsent after the retry budget'); return; }
            try {
                const out = await memberCall('POST', '/api/boston/presenters/send-links', { to: String(id) });
                if (Array.isArray(out.sent) && out.sent.length) { clearInterval(tick); log('upload link sent to ' + out.sent.join(', ') + ' (background retry)'); }
            } catch (e) { /* keep trying */ }
        }, BACKGROUND_EVERY_MS);
        if (tick.unref) tick.unref();
    }

    // ---------------------------------------------------------------- GET the list
    app.get('/api/v2/boston/presenters', auth, adminOnly, async (req, res) => {
        try {
            const data = await memberCall('GET', '/api/boston/presentations');
            const byId = new Map(regsByEvent().map(r => [String(r.id), r]));
            const rows = (data.rows || []).map(r => {
                const reg = byId.get(String(r.registration_id)) || {};
                return Object.assign({}, r, {
                    status: reg.status || null,
                    invited_at: invitedAtOf(reg.notes),
                    added_by_team: new RegExp(ADDED_NOTE, 'i').test(String(reg.notes || ''))
                });
            });
            const notInvited = rows.filter(r => r.requested && r.invited_at == null && isSendable(r)).length;
            res.set('Cache-Control', 'private, no-store');
            res.json({
                ok: true,
                event: data.event || EVENT_ID,
                event_name: data.event_name || null,
                generated_at: data.generated_at || new Date().toISOString(),
                s3_configured: !!data.s3_configured,
                requested: Number(data.requested) || 0,
                uploaded: Number(data.uploaded) || 0,
                invited: rows.filter(r => r.invited_at != null).length,
                not_invited: notInvited,
                zip_url: keyed('/api/boston/presentations.zip'),
                rows
            });
        } catch (e) {
            log('presenter list failed:', e.message);
            res.status(502).json({ error: 'Could not reach the member portal for the presenter list.' });
        }
    });

    // ---------------------------------------------------------------- send ONE link
    app.post('/api/v2/boston/presenters/:id/send-link', auth, adminOnly, async (req, res) => {
        try {
            const id = cleanStr(req.params.id, 64);
            const reg = id ? q.get('SELECT id, email, status, notes FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
            if (!reg) return res.status(404).json({ error: 'That presenter is not on the Boston list.' });
            const again = invitedAtOf(reg.notes) != null;
            const r = await sendLink(id);
            if (!r.sent.length) return res.status(409).json({ error: 'The member portal did not send it — check that the registration is still active.' });
            audit(req, 'boston.upload_link_sent', (again ? 're-sent to ' : 'sent to ') + r.sent.join(', '));
            res.json({ success: true, sent: r.sent, resent: again });
        } catch (e) {
            log('send-link failed:', e.message);
            res.status(502).json({ error: e.message || 'The link could not be sent.' });
        }
    });

    // ---------------------------------------------------------------- send to everyone not yet invited
    app.post('/api/v2/boston/presenters/send-all', auth, adminOnly, async (req, res) => {
        try {
            const out = await memberCall('POST', '/api/boston/presenters/send-links', { to: 'all' });
            const sent = Array.isArray(out.sent) ? out.sent : [];
            audit(req, 'boston.upload_links_sent_all', sent.length + ' sent, ' + (Number(out.skipped_already_sent) || 0) + ' already invited');
            res.json({ success: true, sent, skipped_already_sent: Number(out.skipped_already_sent) || 0 });
        } catch (e) {
            log('send-all failed:', e.message);
            res.status(502).json({ error: e.message || 'The links could not be sent.' });
        }
    });

    // ---------------------------------------------------------------- add a presenter who never registered
    app.post('/api/v2/boston/presenters/add', auth, adminOnly, async (req, res) => {
        try {
            const b = req.body || {};
            const name = cleanStr(b.name, 120);
            const email = cleanStr(b.email, 160).toLowerCase();
            if (!name) return res.status(400).json({ error: 'Type the presenter\'s name first' });
            if (!validEmail(email)) return res.status(400).json({ error: 'That email address does not look right' });

            const bits = name.split(' ');
            const first = bits.length > 1 ? bits.slice(0, -1).join(' ') : name;
            const last = bits.length > 1 ? bits[bits.length - 1] : '';

            let reg = findByEmail(email);
            let created = false, promoted = false;
            if (!reg) {
                const id = crypto.randomUUID();
                q.run(`INSERT INTO bridges_registrations
                    (id, event_id, first_name, last_name, email, institution, position, notes, status, payment_status, confirmation_sent, registered_at)
                    VALUES (?,?,?,?,?,NULL,NULL,?,'registered','n/a',0,CURRENT_TIMESTAMP)`,
                    [id, EVENT_ID, first, last, email, PRESENTER_NOTE + ' | ' + ADDED_NOTE]);
                created = true;
                reg = q.get('SELECT id, email, status, notes FROM bridges_registrations WHERE id = ?', [id]) || { id, email, notes: PRESENTER_NOTE };
            } else if (!isPresenter(reg.notes)) {
                // Already coming to the evening, just never ticked the presentation box — mark the
                // existing row instead of creating a second one for the same person.
                q.run('UPDATE bridges_registrations SET notes = ? WHERE id = ?',
                    [(reg.notes ? reg.notes + ' | ' : '') + PRESENTER_NOTE + ' | ' + ADDED_NOTE, reg.id]);
                promoted = true;
                reg = q.get('SELECT id, email, status, notes FROM bridges_registrations WHERE id = ?', [reg.id]) || reg;
            }
            if (created || promoted) persist();
            if (!isSendable(reg)) return res.status(409).json({ error: 'That registration is ' + String(reg.status || 'inactive') + ' — reopen it before sending a link.' });

            const r = await sendLink(reg.id, { retry: created || promoted });
            audit(req, 'boston.presenter_added',
                (created ? 'created ' : promoted ? 'marked ' : 'existing ') + email + (r.sent.length ? ' — link sent' : ' — link pending'));
            res.json({
                success: true, created, promoted,
                registration_id: reg.id, email,
                sent: r.sent, pending: r.pending
            });
        } catch (e) {
            log('add presenter failed:', e.message);
            res.status(502).json({ error: e.message || 'Could not add the presenter.' });
        }
    });

    // ---------------------------------------------------------------- catering + the reminder
    // Same doctrine as the upload links: the member wing owns the email, the token, the answer
    // pages and the bookkeeping (reminder_sent + the REMINDER-SENT marker in notes). This side is
    // the button. Nothing is ever sent from here on a timer — only from an explicit admin click.
    app.get('/api/v2/boston/catering', auth, adminOnly, async (req, res) => {
        try {
            const data = await memberCall('GET', '/api/boston/catering');
            res.set('Cache-Control', 'private, no-store');
            res.json(Object.assign({ ok: true }, data, { csv_url: keyed('/api/boston/catering.csv') }));
        } catch (e) {
            log('catering list failed:', e.message);
            res.status(502).json({ error: 'Could not reach the member portal for the catering list.' });
        }
    });

    // Send / re-send ONE reminder. Unlike the upload links this always sends — the button is
    // literally labelled Resend once a reminder has gone out.
    app.post('/api/v2/boston/reminders/:id/send', auth, adminOnly, async (req, res) => {
        try {
            const id = cleanStr(req.params.id, 64);
            const reg = id ? q.get('SELECT id, email, status, notes, reminder_sent FROM bridges_registrations WHERE id = ? AND event_id = ?', [id, EVENT_ID]) : null;
            if (!reg) return res.status(404).json({ error: 'That guest is not on the Boston list.' });
            const again = Number(reg.reminder_sent) === 1 || new RegExp(REMINDER_MARK).test(String(reg.notes || ''));
            const out = await memberCall('POST', '/api/boston/reminders/send', { to: String(id) });
            const sent = Array.isArray(out.sent) ? out.sent : [];
            if (!sent.length) return res.status(409).json({ error: 'The member portal did not send it — check that the registration is still active.' });
            audit(req, 'boston.reminder_sent', (again ? 're-sent to ' : 'sent to ') + sent.join(', '));
            res.json({ success: true, sent, resent: again });
        } catch (e) {
            log('reminder send failed:', e.message);
            res.status(502).json({ error: e.message || 'The reminder could not be sent.' });
        }
    });

    // Everyone who has not had one yet. Already-reminded rows are skipped by the member route.
    app.post('/api/v2/boston/reminders/send-all', auth, adminOnly, async (req, res) => {
        try {
            const out = await memberCall('POST', '/api/boston/reminders/send', { to: 'all' });
            const sent = Array.isArray(out.sent) ? out.sent : [];
            audit(req, 'boston.reminders_sent_all', sent.length + ' sent, ' + (Number(out.skipped_already_sent) || 0) + ' already reminded');
            res.json({ success: true, sent, skipped_already_sent: Number(out.skipped_already_sent) || 0 });
        } catch (e) {
            log('reminder send-all failed:', e.message);
            res.status(502).json({ error: e.message || 'The reminders could not be sent.' });
        }
    });

    // The caterer's list, as a file. 302 with the key in the URL, exactly like the deck archive.
    app.get('/api/v2/boston/catering.csv', auth, adminOnly, (req, res) => {
        res.redirect(302, keyed('/api/boston/catering.csv'));
    });

    // ---------------------------------------------------------------- every deck, one archive
    // 302 to the member portal, which builds the ZIP from S3. The key rides in the URL, so the hop
    // needs no header and works from a plain browser navigation.
    app.get('/api/v2/boston/presentations.zip', auth, adminOnly, (req, res) => {
        res.redirect(302, keyed('/api/boston/presentations.zip'));
    });

    log('mounted — Boston presenters panel (member portal: ' + memberBase() + ')');
};
