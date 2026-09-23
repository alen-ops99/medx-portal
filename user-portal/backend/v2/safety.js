/**
 * user-portal/backend/v2/safety.js — REPORT and BLOCK for the member portal (App Store guideline 1.2:
 * member profiles in Network and member-to-member messages are user-generated content). Mounted by
 * v2/index.js; routes live under /api/v2/safety/…. Schema + vocabulary: shared/safety-core.js.
 *
 * Routes (member JWT):
 *   POST   /api/v2/safety/report {target_kind | target_type, target_id, reason, note?}
 *            target_kind 'member' → target_id = users.id (never yourself)
 *            target_kind 'message' → target_id = direct_messages.id of ANY member↔member message SENT TO YOU
 *                                     (the per-message REPORT in a thread; ids you did not receive → 404)
 *            reason spam|harassment|inappropriate|impersonation|other · note ≤ 500 chars
 *            The same reporter + target inside 24 h answers the existing report ({duplicate:true}, no new row);
 *            more than 10 new reports in a rolling hour → 429. → {success, id, duplicate}
 *            EVIDENCE is copied onto the report when it is filed, so it survives the reported member removing
 *            the message or deleting the account: evidence_text = the message (or, for a member report, the
 *            bio) ≤ 1000 chars; evidence_meta = JSON {sender_name, sender_email, created_at, context: up to 10
 *            earlier messages from the reported member to the reporter, [{id, text, created_at}] oldest first
 *            (the id lets the team remove one of them), and for a member report profile: {photo_url, title,
 *            institution, city, specialties} as they were shown when the report was filed}.
 *   POST   /api/v2/safety/block {user_id}
 *            never yourself, never the Med&X team (the 'team' thread or an admin account). Blocking also
 *            ends the connection between the two (any state — pending requests included), exactly like
 *            REMOVE in Network. → {success, already, disconnected, member:{id,name}}
 *   DELETE /api/v2/safety/block/:userId   → {success, removed}  (the connection does not come back)
 *   GET    /api/v2/safety/blocks          → {blocks:[{user_id, first_name, last_name, name, institution, photo_url, created_at}]}
 *
 * What a block does elsewhere (both directions unless noted):
 *   v2/network.js   the pair never appears in each other's directory, search or suggestions
 *   v2/messages.js  the BLOCKER's inbox hides the thread and its unread count; the peer card tells the blocker
 *                   ("blocked": true) and answers 404 to the blocked member, like any unknown member
 *   server.js       POST /api/messages, POST /api/networking/connections, the 1:1 meeting request and meeting
 *                   routes, mentorship and intro requests answer 403 with a neutral message; a badge scan answers
 *                   404 'Badge not recognized.'; MY NETWORK (connections + pending), the global member search,
 *                   the Plexus attendees and the Forum member lists leave the pair out
 * Nothing here emails anyone: reports surface only in the admin portal (admin-portal/backend/v2/safety-ops.js).
 */
'use strict';
const { randomUUID } = require('crypto');
const core = require('../../../shared/safety-core');

module.exports = function mountSafety(app, ctx) {
    const { auth } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/safety]', ...a));
    const db = () => ctx.db();
    const all = (sql, params = []) => {
        const st = db().prepare(sql); st.bind(params);
        const out = []; while (st.step()) out.push(st.getAsObject()); st.free();
        return out;
    };
    const one = (sql, params = []) => all(sql, params)[0] || null;
    const run = (sql, params = []) => db().run(sql, params);
    const fail = (res, err, msg) => { console.error('[v2/safety]', err); res.status(500).json({ error: msg || 'Something went wrong — please try again.' }); };
    const nameOf = (u) => [u && u.first_name, u && u.last_name].filter(Boolean).join(' ').trim() || 'Med&X member';
    const str = (v) => (v == null ? '' : String(v)).trim();

    core.ensureSchema(db(), log);

    // ---- the evidence copy (see the header): what the reported member wrote, frozen at report time ----
    const EVIDENCE_MAX = 1000, CONTEXT_MAX = 10;
    function evidenceFor(reported, message, targetUserId, reporterKeys) {
        try {
            const senderKeys = [targetUserId, reported && reported.email].filter(Boolean).map(String);
            if (message && !senderKeys.includes(String(message.sender_id))) senderKeys.push(String(message.sender_id));
            let context = [];
            if (senderKeys.length && reporterKeys.length) {
                const ph = (a) => a.map(() => '?').join(',');
                // earlier messages from the reported member to the reporter (before the reported one; for a member
                // report, the latest ones) — newest 10, returned oldest first
                const before = message ? ' AND (created_at < ? OR (created_at = ? AND id <> ?))' : '';
                const params = senderKeys.concat(reporterKeys, message ? [message.created_at, message.created_at, message.id] : []);
                context = all(`SELECT id, content, created_at FROM direct_messages
                                WHERE sender_id IN (${ph(senderKeys)}) AND receiver_id IN (${ph(reporterKeys)})
                                  AND COALESCE(sender_type,'user') <> 'admin' AND COALESCE(receiver_type,'user') <> 'admin'${before}
                                ORDER BY created_at DESC, rowid DESC LIMIT ${CONTEXT_MAX}`, params)
                    .reverse().map(r => ({ id: r.id || null, text: String(r.content || '').slice(0, EVIDENCE_MAX), created_at: r.created_at || null }));
            }
            const text = message ? String(message.content || '') : String((reported && reported.bio) || '');
            return {
                text: text ? text.slice(0, EVIDENCE_MAX) : null,
                meta: JSON.stringify({
                    sender_name: reported ? nameOf(reported) : null,
                    sender_email: (reported && reported.email) || (message && String(message.sender_id).includes('@') ? String(message.sender_id) : null),
                    created_at: message ? (message.created_at || null) : null,
                    context,
                    // a member report: the rest of what the directory showed (the portrait, the headline, the tags)
                    profile: (!message && reported) ? {
                        photo_url: reported.photo_url || null, title: reported.title || null, institution: reported.institution || null,
                        city: reported.city || null, specialties: reported.specialties || null
                    } : undefined
                })
            };
        } catch (e) { log('safety: evidence copy skipped: ' + e.message); return { text: null, meta: null }; }
    }

    // ---- POST /api/v2/safety/report ----
    app.post('/api/v2/safety/report', auth, (req, res) => {
        try {
            const me = req.user || {};
            const myId = str(me.id);
            if (!myId) return res.status(401).json({ error: 'Authentication required' });
            const b = req.body || {};
            const kind = str(b.target_kind != null ? b.target_kind : b.target_type).toLowerCase();
            const targetId = str(b.target_id);
            const reason = str(b.reason).toLowerCase();
            const note = str(b.note);
            if (!core.TARGET_KINDS.includes(kind)) return res.status(400).json({ error: 'Say what you are reporting — a member or a message.' });
            if (!targetId || targetId.length > 120) return res.status(400).json({ error: 'That report is missing what it is about.' });
            if (!core.REASONS.includes(reason)) return res.status(400).json({ error: 'Pick what is wrong first.' });
            if (note.length > core.NOTE_MAX) return res.status(400).json({ error: `Keep the note under ${core.NOTE_MAX} characters.` });

            // resolve the member behind the target (and what the report is about, for the evidence copy)
            const myKeys = [myId, str(me.email)].filter(Boolean);
            let targetUserId = null, reported = null, message = null;
            if (kind === 'member') {
                if (targetId === myId) return res.status(400).json({ error: 'You can’t report yourself.' });
                // title / city / specialties come from later migrations — read them when the columns exist
                let u = null;
                try { u = one('SELECT id, email, first_name, last_name, bio, photo_url, institution, title, city, specialties FROM users WHERE id = ?', [targetId]); }
                catch (e) { u = one('SELECT id, email, first_name, last_name, bio, photo_url, institution FROM users WHERE id = ?', [targetId]); }
                if (!u) return res.status(404).json({ error: 'That member could not be found.' });
                targetUserId = u.id; reported = u;
            } else {
                // a member↔member message the reporter RECEIVED (either key form — legacy rows store the email)
                const m = one(`SELECT id, sender_id, receiver_id, sender_type, receiver_type, content, created_at FROM direct_messages WHERE id = ?`, [targetId]);
                const isMember = m && String(m.sender_type || 'user') !== 'admin' && String(m.receiver_type || 'user') !== 'admin';
                if (!m || !isMember || !myKeys.includes(String(m.receiver_id)) || myKeys.includes(String(m.sender_id))) {
                    return res.status(404).json({ error: 'That message could not be found.' });
                }
                const sender = one('SELECT id, email, first_name, last_name, bio FROM users WHERE id = ? OR lower(email) = lower(?) LIMIT 1', [String(m.sender_id), String(m.sender_id)]);
                targetUserId = sender ? sender.id : String(m.sender_id);
                reported = sender; message = m;
            }

            // dedupe: the same reporter + target inside the window is ONE report (checked before the rate limit,
            // so tapping SEND twice never counts against anyone)
            const dup = one(`SELECT id FROM v2_reports WHERE reporter_user_id = ? AND target_kind = ? AND target_id = ?
                               AND created_at > datetime('now', ?) ORDER BY created_at DESC LIMIT 1`,
                [myId, kind, targetId, `-${core.DEDUPE_HOURS} hours`]);
            if (dup) return res.json({ success: true, id: dup.id, duplicate: true });

            const recent = one(`SELECT COUNT(*) AS n FROM v2_reports WHERE reporter_user_id = ? AND created_at > datetime('now', '-1 hour')`, [myId]);
            if (Number((recent && recent.n) || 0) >= core.RATE_PER_HOUR) {
                return res.status(429).json({ error: 'That is a lot of reports in a short time — please try again in an hour.' });
            }

            const id = randomUUID();
            const ev = evidenceFor(reported, message, targetUserId, myKeys);
            run(`INSERT INTO v2_reports (id, reporter_user_id, target_kind, target_id, target_user_id, reason, note, status, created_at, evidence_text, evidence_meta)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'), ?, ?)`,
                [id, myId, kind, targetId, targetUserId, reason, note || null, ev.text, ev.meta]);
            res.json({ success: true, id, duplicate: false });
        } catch (err) { fail(res, err, 'Could not send your report. Please try again.'); }
    });

    // ---- POST /api/v2/safety/block {user_id} ----
    app.post('/api/v2/safety/block', auth, (req, res) => {
        try {
            const myId = str((req.user || {}).id);
            if (!myId) return res.status(401).json({ error: 'Authentication required' });
            const b = req.body || {};
            const target = str(b.user_id != null ? b.user_id : (b.userId != null ? b.userId : b.blocked_user_id));
            if (!target) return res.status(400).json({ error: 'Pick the member to block.' });
            if (target.toLowerCase() === 'team') return res.status(400).json({ error: 'The Med&X team can’t be blocked — use Report if something is wrong.' });
            if (target === myId) return res.status(400).json({ error: 'You can’t block yourself.' });
            const u = one('SELECT id, first_name, last_name, is_admin, deleted_at FROM users WHERE id = ?', [target]);
            if (!u || u.deleted_at) return res.status(404).json({ error: 'That member could not be found.' });
            if (Number(u.is_admin)) return res.status(400).json({ error: 'The Med&X team can’t be blocked — use Report if something is wrong.' });

            const already = !!one('SELECT 1 AS x FROM v2_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?', [myId, target]);
            if (!already) run(`INSERT OR IGNORE INTO v2_blocks (blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, datetime('now'))`, [myId, target]);
            // the connection ends with the block (any state, both directions) — the same row delete as REMOVE in Network
            let disconnected = 0;
            try {
                const c = one(`SELECT COUNT(*) AS n FROM networking_connections WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`, [myId, target, target, myId]);
                disconnected = Number((c && c.n) || 0);
                if (disconnected) run(`DELETE FROM networking_connections WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`, [myId, target, target, myId]);
            } catch (e) { /* no connections table on this engine — nothing to end */ }
            res.json({ success: true, already, disconnected, member: { id: u.id, name: nameOf(u) } });
        } catch (err) { fail(res, err, 'Could not block that member. Please try again.'); }
    });

    // ---- DELETE /api/v2/safety/block/:userId ----
    app.delete('/api/v2/safety/block/:userId', auth, (req, res) => {
        try {
            const myId = str((req.user || {}).id);
            if (!myId) return res.status(401).json({ error: 'Authentication required' });
            const target = str(req.params.userId);
            if (!target) return res.status(400).json({ error: 'Pick the member to unblock.' });
            const had = !!one('SELECT 1 AS x FROM v2_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?', [myId, target]);
            if (had) run('DELETE FROM v2_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?', [myId, target]);
            res.json({ success: true, removed: had });
        } catch (err) { fail(res, err, 'Could not unblock that member. Please try again.'); }
    });

    // ---- GET /api/v2/safety/blocks — my own list, newest first ----
    app.get('/api/v2/safety/blocks', auth, (req, res) => {
        try {
            const myId = str((req.user || {}).id);
            const blocks = all(`SELECT b.blocked_user_id AS user_id, b.created_at, u.first_name, u.last_name, u.institution, u.photo_url
                                  FROM v2_blocks b LEFT JOIN users u ON u.id = b.blocked_user_id
                                 WHERE b.blocker_user_id = ? ORDER BY b.created_at DESC, b.rowid DESC`, [myId])
                .map(r => ({ user_id: r.user_id, first_name: r.first_name || '', last_name: r.last_name || '', name: nameOf(r),
                             institution: r.institution || '', photo_url: r.photo_url || '', created_at: r.created_at }));
            res.json({ blocks });
        } catch (err) { fail(res, err, 'Could not load your blocked members.'); }
    });

    log('safety: /api/v2/safety/{report,block,block/:userId,blocks}');
};
