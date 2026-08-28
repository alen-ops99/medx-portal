/**
 * user-portal/backend/v2/messages.js — the MESSAGES screen of the redesigned member portal
 * (frontend-v2 js/views/messages.js, route /app/messages). Mounted by v2/index.js.
 *
 * Everything lives in the EXISTING shared `direct_messages` table (both portals read/write it):
 *   member → team    sender_type='user',  receiver_type='admin'  (admin inbox: GET /api/admin/messages)
 *   team   → member  sender_type='admin', receiver_type='user'   (admin: POST /api/admin/messages)
 *   member ↔ member  sender_type='user',  receiver_type='user'   (member: POST /api/messages, read_at)
 * Key forms differ by writer: the admin backend stores users.id in sender_id/receiver_id, the
 * legacy member routes store the member's EMAIL. Every query here matches BOTH forms
 * (`IN (id, email)`) so nothing already written disappears, and new rows use users.id (the
 * key the admin backend's own inserts, thread route and 48h nag scan expect).
 *
 * Additive schema (guarded): direct_messages.topic TEXT (topic tag — README note 24) and the
 * per-member thread state table v2_message_thread_state (archive = hide, never delete).
 *
 * Routes (all member-JWT, a member only ever sees their own threads):
 *   GET  /api/v2/messages/threads                 thread list: official team thread first, then
 *                                                 member threads; unread counts; archived flags
 *   GET  /api/v2/messages/team?mark=1             the team thread (mark=1 marks admin replies read)
 *   POST /api/v2/messages/team {topic, body}      write to the team (lands in the admin inbox)
 *   POST /api/v2/messages/threads/:key/archive    {archived:true|false}  key = 'team' | users.id
 *   GET  /api/v2/messages/peer/:userId            partner card for ?to=<userId> (+ connection state)
 *   GET  /api/v2/messages/unread-count            {unread, team, direct} for the chrome ALERTS dot
 * Member ↔ member reads/writes reuse the existing routes (GET /api/messages/:userId marks read,
 * POST /api/messages enforces the accepted-connection rule and pushes).
 */
'use strict';
const { randomUUID } = require('crypto');

const TEAM_KEY = 'team';
const TOPICS = { general: 'General', plexus: 'Plexus', gala: 'Gala', accelerator: 'Accelerator', bridges: 'Building Bridges', forum: 'Forum', membership: 'Membership' };
const MAX_BODY = 4000;
const TEAM_FALLBACK_EMAIL = 'info@medx.hr';
const MSG_COLS = 'id, sender_id, receiver_id, sender_type, receiver_type, title, topic, content, attachment_url, is_read, read_at, created_at';

module.exports = function mountMessages(app, ctx) {
    const { auth } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/messages]', ...a));
    const db = () => ctx.db();
    const all = (sql, params = []) => {
        const s = db().prepare(sql);
        if (params.length) s.bind(params);
        const rows = [];
        while (s.step()) rows.push(s.getAsObject());
        s.free();
        return rows;
    };
    const one = (sql, params = []) => all(sql, params)[0] || null;
    const run = (sql, params = []) => db().run(sql, params);
    const fail = (res, err, msg) => { console.error('[v2/messages]', err); res.status(500).json({ error: msg || 'Something went wrong — please try again.' }); };

    // ---- schema (additive, guarded; shared DB — never rename/drop) ----
    try { run("ALTER TABLE direct_messages ADD COLUMN topic TEXT"); } catch (e) { /* exists */ }
    try {
        run(`CREATE TABLE IF NOT EXISTS v2_message_thread_state (
            user_id TEXT NOT NULL,
            thread_key TEXT NOT NULL,
            archived INTEGER DEFAULT 0,
            archived_at TEXT,
            updated_at TEXT,
            PRIMARY KEY (user_id, thread_key)
        )`);
    } catch (e) { log('v2_message_thread_state create skipped:', e.message); }

    // ---- helpers ----
    const keysOf = (u) => [String((u && u.id) || ''), String((u && u.email) || '')];       // users.id + email (legacy rows)
    const isAdminType = (t) => String(t || 'user') === 'admin';
    const teamRowsFor = (k1, k2) => all(
        `SELECT ${MSG_COLS} FROM direct_messages
          WHERE (COALESCE(sender_type,'user') = 'admin' AND receiver_id IN (?, ?))
             OR (COALESCE(receiver_type,'user') = 'admin' AND sender_id IN (?, ?))
          ORDER BY created_at ASC, rowid ASC`, [k1, k2, k1, k2]);
    const directRowsFor = (id) => all(
        `SELECT ${MSG_COLS}, CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS partner_id
           FROM direct_messages
          WHERE (sender_id = ? OR receiver_id = ?)
            AND COALESCE(sender_type,'user') <> 'admin' AND COALESCE(receiver_type,'user') <> 'admin'
          ORDER BY created_at ASC, rowid ASC`, [id, id, id]);
    // one shape for the client, whichever side wrote the row
    const normTeam = (r) => {
        const mine = !isAdminType(r.sender_type);
        return { id: r.id, mine, content: r.content || '', title: r.title || null, topic: r.topic || null,
                 attachment_url: r.attachment_url || null, created_at: r.created_at, read: !!Number(r.is_read || 0) };
    };
    const threadState = (userId) => {
        const out = {};
        try { all('SELECT thread_key, archived, archived_at FROM v2_message_thread_state WHERE user_id = ?', [userId]).forEach(r => { out[r.thread_key] = r; }); } catch (e) { /* table missing */ }
        return out;
    };
    // archive = hide until something new arrives; a message newer than the archive stamp reopens the thread
    const archivedNow = (state, key, lastAt, userId) => {
        const s = state[key];
        if (!s || !Number(s.archived)) return false;
        if (lastAt && s.archived_at && String(lastAt) > String(s.archived_at)) {
            try { run("UPDATE v2_message_thread_state SET archived = 0, updated_at = datetime('now') WHERE user_id = ? AND thread_key = ?", [userId, key]); } catch (e) { /* best-effort */ }
            return false;
        }
        return true;
    };
    const connectionBetween = (a, b) => one(
        `SELECT id, status, requester_id, receiver_id FROM networking_connections
          WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)
          ORDER BY CASE status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END LIMIT 1`, [a, b, b, a]);
    const teamAddress = () => {
        const admin = one("SELECT id, email FROM users WHERE is_admin = 1 AND email IS NOT NULL AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1")
                   || one("SELECT id, email FROM users WHERE is_admin = 1 AND email IS NOT NULL ORDER BY created_at ASC LIMIT 1");
        return (admin && admin.email) || TEAM_FALLBACK_EMAIL;   // same convention as the three existing member→team writers
    };

    // ---- GET /api/v2/messages/threads ----
    app.get('/api/v2/messages/threads', auth, (req, res) => {
        try {
            const me = req.user || {};
            const [k1, k2] = keysOf(me);
            const state = threadState(k1);
            const threads = [];

            // 1) the official team thread — always first, always present (the MESSAGE US entry point)
            const teamRows = teamRowsFor(k1, k2);
            const teamLast = teamRows.length ? normTeam(teamRows[teamRows.length - 1]) : null;
            const teamUnread = teamRows.filter(r => isAdminType(r.sender_type) && !Number(r.is_read || 0)).length;
            threads.push({
                key: TEAM_KEY, kind: 'team', official: true, count: teamRows.length, unread: teamUnread,
                last: teamLast, archived: archivedNow(state, TEAM_KEY, teamLast && teamLast.created_at, k1)
            });

            // 2) member ↔ member threads, newest activity first
            const dm = directRowsFor(k1);
            const byPartner = new Map();
            dm.forEach(r => {
                const pid = String(r.partner_id || '');
                if (!pid) return;
                if (!byPartner.has(pid)) byPartner.set(pid, { rows: [], unread: 0 });
                const g = byPartner.get(pid);
                g.rows.push(r);
                if (r.receiver_id === k1 && r.sender_id !== k1 && !r.read_at) g.unread++;
            });
            const ids = Array.from(byPartner.keys());
            const users = {};
            if (ids.length) {
                all(`SELECT id, first_name, last_name, institution, photo_url, is_admin, deleted_at FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
                    .forEach(u => { users[u.id] = u; });
            }
            const members = ids.map(pid => {
                const g = byPartner.get(pid), u = users[pid] || {};
                const last = g.rows[g.rows.length - 1];
                const lastNorm = { id: last.id, mine: last.sender_id === k1, content: last.content || '', created_at: last.created_at, read: !!last.read_at };
                return {
                    key: pid, kind: 'member', official: false, partner_id: pid,
                    first_name: u.first_name || '', last_name: u.last_name || '', institution: u.institution || '',
                    photo_url: u.photo_url || '', gone: !!u.deleted_at || !users[pid],
                    count: g.rows.length, unread: g.unread, last: lastNorm,
                    archived: archivedNow(state, pid, last.created_at, k1)
                };
            }).sort((a, b) => String(b.last.created_at).localeCompare(String(a.last.created_at)));

            res.json({ me: { id: k1, email: me.email || null }, threads: threads.concat(members),
                       unread: teamUnread + members.reduce((n, t) => n + t.unread, 0), topics: TOPICS });
        } catch (err) { fail(res, err, 'Could not load your inbox.'); }
    });

    // ---- GET /api/v2/messages/team?mark=1 ----
    app.get('/api/v2/messages/team', auth, (req, res) => {
        try {
            const [k1, k2] = keysOf(req.user || {});
            const rows = teamRowsFor(k1, k2);
            let marked = 0;
            if (String(req.query.mark || '') === '1') {
                const unread = rows.filter(r => isAdminType(r.sender_type) && !Number(r.is_read || 0));
                if (unread.length) {
                    run(`UPDATE direct_messages SET is_read = 1
                          WHERE COALESCE(sender_type,'user') = 'admin' AND receiver_id IN (?, ?) AND (is_read = 0 OR is_read IS NULL)`, [k1, k2]);
                    marked = unread.length;
                    unread.forEach(r => { r.is_read = 1; });
                }
            }
            res.json({ key: TEAM_KEY, messages: rows.map(normTeam), marked, topics: TOPICS });
        } catch (err) { fail(res, err, 'Could not load the conversation.'); }
    });

    // ---- POST /api/v2/messages/team {topic, body} — MESSAGE US, identity from the JWT ----
    app.post('/api/v2/messages/team', auth, (req, res) => {
        try {
            const me = req.user || {};
            const topic = String((req.body && req.body.topic) || 'general').toLowerCase().trim();
            if (!TOPICS[topic]) return res.status(400).json({ error: 'Pick a topic for your message.' });
            const body = String((req.body && (req.body.body != null ? req.body.body : req.body.content)) || '').trim();
            if (!body) return res.status(400).json({ error: 'Write a message first.' });
            if (body.length > MAX_BODY) return res.status(400).json({ error: `Keep it under ${MAX_BODY} characters.` });
            const sender = one('SELECT id, email FROM users WHERE id = ?', [String(me.id || '')]);
            if (!sender) return res.status(403).json({ error: 'Your account could not be resolved — sign in again.' });
            const id = randomUUID();
            run(`INSERT INTO direct_messages (id, sender_id, receiver_id, sender_type, receiver_type, title, topic, content, is_read, created_at)
                 VALUES (?, ?, ?, 'user', 'admin', ?, ?, ?, 0, datetime('now'))`,
                [id, sender.id, teamAddress(), TOPICS[topic], topic, body]);
            const row = one(`SELECT ${MSG_COLS} FROM direct_messages WHERE id = ?`, [id]);
            res.json({ success: true, message: normTeam(row) });
        } catch (err) { fail(res, err, 'Could not send your message. Please try again.'); }
    });

    // ---- POST /api/v2/messages/threads/:key/archive {archived} — hide, never delete ----
    app.post('/api/v2/messages/threads/:key/archive', auth, (req, res) => {
        try {
            const userId = String((req.user && req.user.id) || '');
            const key = String(req.params.key || '').trim();
            if (!key || key.length > 80) return res.status(400).json({ error: 'Unknown thread.' });
            if (key !== TEAM_KEY && !one('SELECT id FROM users WHERE id = ?', [key])) return res.status(404).json({ error: 'Unknown thread.' });
            const archived = req.body && (req.body.archived === false || req.body.archived === 0 || req.body.archived === '0') ? 0 : 1;
            run(`INSERT INTO v2_message_thread_state (user_id, thread_key, archived, archived_at, updated_at)
                 VALUES (?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
                 ON CONFLICT(user_id, thread_key) DO UPDATE SET archived = excluded.archived, archived_at = excluded.archived_at, updated_at = excluded.updated_at`,
                [userId, key, archived, archived]);
            res.json({ success: true, key, archived: !!archived });
        } catch (err) { fail(res, err, 'Could not update that thread.'); }
    });

    // ---- GET /api/v2/messages/peer/:userId — who am I writing to (for ?to=<userId>) ----
    app.get('/api/v2/messages/peer/:userId', auth, (req, res) => {
        try {
            const me = req.user || {};
            const pid = String(req.params.userId || '').trim();
            if (!pid || pid === String(me.id)) return res.status(400).json({ error: 'Pick another member to message.' });
            const u = one('SELECT id, first_name, last_name, institution, photo_url, is_public_profile, deleted_at FROM users WHERE id = ?', [pid]);
            if (!u || u.deleted_at) return res.status(404).json({ error: 'That member could not be found.' });
            const conn = connectionBetween(String(me.id), pid);
            const connected = !!Number(me.is_admin) || !!(conn && conn.status === 'accepted');
            const pending = conn && conn.status === 'pending' ? (conn.requester_id === String(me.id) ? 'sent' : 'received') : null;
            // non-public profiles stay invisible unless there is already a connection between the two
            if (!connected && !pending && !Number(u.is_public_profile)) return res.status(404).json({ error: 'That member could not be found.' });
            res.json({ id: u.id, first_name: u.first_name || '', last_name: u.last_name || '', institution: u.institution || '',
                       photo_url: u.photo_url || '', connected, pending, connection_id: conn ? conn.id : null });
        } catch (err) { fail(res, err, 'Could not load that member.'); }
    });

    // ---- GET /api/v2/messages/unread-count — for the chrome ALERTS dot ----
    app.get('/api/v2/messages/unread-count', auth, (req, res) => {
        try {
            const [k1, k2] = keysOf(req.user || {});
            const team = one(`SELECT COUNT(*) AS c FROM direct_messages
                               WHERE COALESCE(sender_type,'user') = 'admin' AND receiver_id IN (?, ?) AND (is_read = 0 OR is_read IS NULL)`, [k1, k2]);
            const direct = one(`SELECT COUNT(*) AS c FROM direct_messages
                                 WHERE receiver_id = ? AND sender_id <> ? AND read_at IS NULL
                                   AND COALESCE(sender_type,'user') <> 'admin' AND COALESCE(receiver_type,'user') <> 'admin'`, [k1, k1]);
            const t = Number((team && team.c) || 0), d = Number((direct && direct.c) || 0);
            res.json({ unread: t + d, team: t, direct: d });
        } catch (err) { fail(res, err, 'Could not count unread messages.'); }
    });

    log('messages: /api/v2/messages/{threads,team,threads/:key/archive,peer/:userId,unread-count}');
};
