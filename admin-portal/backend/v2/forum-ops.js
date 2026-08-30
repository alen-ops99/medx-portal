/**
 * v2/forum-ops.js — ADMIN backend for the redesigned Forum hub (frontend-v2 › js/views/forum.js).
 * Mounted by v2/index.js; every route lives under /api/v2/forum/… on the ADMIN service
 * (2026-08-30, admin portal redesign — Admin Forum Hub.dc.html).
 *
 * SHARED-TABLE RULE: the member portal's user-portal/backend/v2/forum.js DEFINES
 * v2_forum_invites, v2_forum_votes and v2_forum_feed. Both portals share ONE database, so the
 * DDL below is copied VERBATIM from that file and the semantics are kept identical
 * (FRM-XXXX-XXXX codes, open/used/expired statuses, published feed rows, one vote per member).
 * Whichever backend boots first creates the tables; the other's CREATE IF NOT EXISTS is a no-op.
 *
 * What this module adds on the admin side:
 *   GET  /api/v2/forum/hub                      — one read for the whole hub screen
 *   POST /api/v2/forum/feed                     — composer (spotlight | news | note)
 *   PUT  /api/v2/forum/feed/:id                 — edit / unpublish / republish (never hard-deletes)
 *   GET  /api/v2/forum/invites                  — codes, newest first
 *   POST /api/v2/forum/invites                  — mint FRM-XXXX-XXXX (+ queue the personal email)
 *   POST /api/v2/forum/invites/:id/send         — (re)queue the personal invitation
 *   DELETE /api/v2/forum/invites/:id            — revoke an open code (kept as expired — audit trail)
 *   POST /api/v2/forum/candidates               — add one pipeline row (forum_candidates, source 'forum-hub')
 *   PUT  /api/v2/forum/members/:id/renew        — extend an annual membership by one year
 *   GET/PUT /api/v2/forum/consideration-questions — the public request-consideration form questions
 *
 * SEND CODE queues through the approval outbox (scheduled_emails, status 'pending_approval') —
 * the same spine the Inbox approves and the ~60s drainer sends (README note 2: nothing emails a
 * member without an explicit OK there). This is the legacy pattern council/send follows.
 */
'use strict';
const crypto = require('crypto');

const POLL = 'venue-2027';
const CHOICES = ['split', 'zagreb'];
const CAP = 200;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — identical to the member side
const GATHERING = {
    slug: 'forum-2027-gathering', title: 'Annual Biomedical Forum 2027',
    description: 'The annual gathering of the Biomedical Forum — three days each May, closing with the Gala & Awards evening. Split or Zagreb; the venue is announced with your invitation.',
    start: '2027-05-28', end: '2027-05-29', where: 'Split or Zagreb — venue announced with your invitation'
};
const QUESTIONS_KEY = 'v2_forum_consideration_questions';
const DEFAULT_QUESTIONS = ['Name and titles', 'Email', 'Institution', 'A few lines — why the Forum'];

module.exports = function mountForumOps(app, ctx) {
    const { auth, adminOnly, saveDb } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/forum-ops]', ...a));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const nowIso = () => new Date().toISOString();
    const today = () => nowIso().slice(0, 10);

    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql); s.bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    const persist = () => { try { saveDb(); } catch (e) { /* periodic save still runs */ } };
    const fail = (res, e, what) => { console.error('[v2/forum-ops] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

    // ---- schema — DDL copied VERBATIM from user-portal/backend/v2/forum.js (shared tables) ----
    try {
        q.run(`CREATE TABLE IF NOT EXISTS v2_forum_invites (
            id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, email TEXT, name TEXT, note TEXT,
            created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT,
            used_at TEXT, used_by TEXT, sent_at TEXT, send_count INTEGER DEFAULT 0)`);
        q.run(`CREATE TABLE IF NOT EXISTS v2_forum_votes (
            id TEXT PRIMARY KEY, poll TEXT NOT NULL, user_id TEXT NOT NULL, choice TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT, UNIQUE(poll, user_id))`);
        q.run(`CREATE TABLE IF NOT EXISTS v2_forum_feed (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'news', tag TEXT, name TEXT, role TEXT, init TEXT, title TEXT, body TEXT,
            published INTEGER DEFAULT 1, published_at TEXT DEFAULT CURRENT_TIMESTAMP, created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT)`);
        q.run(`CREATE INDEX IF NOT EXISTS idx_v2_forum_invites_code ON v2_forum_invites(code)`);
    } catch (e) { console.error('[v2/forum-ops] schema:', e.message); }
    for (const sql of [
        `ALTER TABLE forum_members ADD COLUMN membership_year INTEGER`,
        `ALTER TABLE forum_members ADD COLUMN valid_until TEXT`,
        `ALTER TABLE forum_members ADD COLUMN joined_via TEXT`
    ]) { try { q.run(sql); } catch (e) { /* column exists */ } }
    // The gathering row: seeded ONCE by slug — identical to the member module's seed, so the hub
    // has a real forum_events target even when this backend boots first on a fresh DB.
    try {
        if (!q.get(`SELECT id FROM forum_events WHERE slug = ?`, [GATHERING.slug])) {
            q.run(`INSERT INTO forum_events (id, title, description, event_type, slug, event_scale, start_date, end_date, location_type, location_name, capacity, is_paid, price, is_members_only, status, is_published, registrations_count)
                   VALUES (?, ?, ?, 'gathering', ?, 'large', ?, ?, 'in_person', ?, ?, 0, 0, 1, 'published', 1, 0)`,
                [uuid(), GATHERING.title, GATHERING.description, GATHERING.slug, GATHERING.start, GATHERING.end, GATHERING.where, CAP]);
            log('seeded forum_events row ' + GATHERING.slug);
        }
    } catch (e) { console.error('[v2/forum-ops] gathering seed:', e.message); }

    // ---- shared semantics (same shapes the member module exposes) ----
    const inviteStatus = i => i.used_at ? 'used' : (i.expires_at && i.expires_at < nowIso()) ? 'expired' : 'open';
    const publicInvite = i => ({ id: i.id, code: i.code, email: i.email, name: i.name, note: i.note, created_by: i.created_by, created_at: i.created_at, expires_at: i.expires_at, used_at: i.used_at, used_by: i.used_by, sent_at: i.sent_at, send_count: i.send_count || 0, status: inviteStatus(i) });
    function newCode() {
        const pick = () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        for (;;) {
            const code = 'FRM-' + [0, 0, 0, 0].map(pick).join('') + '-' + [0, 0, 0, 0].map(pick).join('');
            if (!q.get(`SELECT id FROM v2_forum_invites WHERE code = ?`, [code])) return code;
        }
    }
    const initials = n => { const p = String(n || '').replace(/^(prof|dr|sc|med|mr|mrs|ms)\.?\s+/gi, '').trim().split(/\s+/).filter(Boolean); return (((p[0] || '')[0] || '') + ((p[p.length - 1] || '')[0] || '')).toUpperCase(); };
    const defaultTag = k => ({ spotlight: 'MEMBER SPOTLIGHT', news: 'FORUM NEWS', note: 'WORTH READING' }[String(k || '').toLowerCase()] || 'FROM THE FORUM');
    const isMemberStatus = s => ['approved', 'active'].includes(String(s || '').toLowerCase());
    const memberCount = () => (q.get(`SELECT COUNT(*) AS c FROM forum_members WHERE LOWER(COALESCE(membership_status,'')) IN ('approved','active') AND (valid_until IS NULL OR valid_until >= date('now'))`) || {}).c || 0;

    function shapeMember(r) {
        const name = [r.first_name || r.u_first, r.last_name || r.u_last].filter(Boolean).join(' ').trim() || r.email || 'Member';
        const expired = !!(r.valid_until && String(r.valid_until).slice(0, 10) < today());
        return {
            id: r.id, user_id: r.user_id || null, name, initials: initials(name) || 'M',
            email: r.email || r.u_email || null, institution: r.institution || r.u_inst || '',
            specialty: r.specialty || '', position: r.position || '',
            country: r.location_country || r.country || r.u_country || '',
            status: expired ? 'expired' : String(r.membership_status || 'pending'),
            valid_until: r.valid_until || null, membership_year: r.membership_year || null,
            joined_via: r.joined_via || null, approved_at: r.approved_at || null, expired
        };
    }
    function membersList() {
        return q.all(`SELECT fm.*, u.first_name AS u_first, u.last_name AS u_last, u.email AS u_email, u.institution AS u_inst, u.country AS u_country
                      FROM forum_members fm LEFT JOIN users u ON u.id = fm.user_id
                      WHERE LOWER(COALESCE(fm.membership_status,'')) IN ('approved','active') AND COALESCE(fm.banned, 0) = 0
                      ORDER BY COALESCE(fm.approved_at, fm.created_at) DESC`).map(shapeMember);
    }
    function voteState() {
        const counts = { split: 0, zagreb: 0 };
        q.all(`SELECT choice, COUNT(*) AS c FROM v2_forum_votes WHERE poll = ? GROUP BY choice`, [POLL]).forEach(r => { if (r.choice in counts) counts[r.choice] = r.c; });
        return { poll: POLL, choices: CHOICES, counts, total: counts.split + counts.zagreb };
    }
    function feedItems() {
        return q.all(`SELECT id, kind, tag, name, role, init, title, body, published, published_at, created_by FROM v2_forum_feed ORDER BY datetime(published_at) DESC LIMIT 60`)
            .map(r => ({ id: r.id, kind: r.kind || 'news', tag: r.tag || defaultTag(r.kind), name: r.name || null, role: r.role || null, init: r.init || (r.name ? initials(r.name) : null), title: r.title || null, body: r.body || '', published: !!r.published, published_at: r.published_at, created_by: r.created_by || null }));
    }
    function gatheringRow() {
        const e = q.get(`SELECT * FROM forum_events WHERE slug = ?`, [GATHERING.slug])
            || q.get(`SELECT * FROM forum_events WHERE event_type = 'gathering' AND start_date >= date('now') ORDER BY start_date ASC LIMIT 1`);
        if (!e) return null;
        const regs = (q.get(`SELECT COUNT(*) AS c FROM forum_event_registrations WHERE event_id = ? AND COALESCE(status,'registered') <> 'cancelled'`, [e.id]) || {}).c || 0;
        return { id: e.id, slug: e.slug, title: e.title, start_date: e.start_date, end_date: e.end_date, location_name: e.location_name || '', capacity: e.capacity, is_published: !!e.is_published, status: e.status, registrations_count: regs };
    }
    function questions() {
        try { const row = q.get(`SELECT value FROM app_state WHERE key = ?`, [QUESTIONS_KEY]); const v = row && JSON.parse(row.value); if (Array.isArray(v) && v.length) return v.map(x => String(x)); } catch (e) { /* fall through */ }
        return DEFAULT_QUESTIONS.slice();
    }

    // ---- the personal invitation email (Emails.dc.html voice — ink header · 2px rule · cream body) ----
    function memberPortalBase() {
        return String(process.env.STAGING_MEMBER_URL || process.env.MEMBER_PORTAL_URL || process.env.PUBLIC_BASE_URL || 'https://medx-staging.onrender.com').replace(/\/+$/, '');
    }
    function inviteEmailHtml(invite) {
        const url = memberPortalBase() + '/app/auth/forum-code?code=' + encodeURIComponent(invite.code);
        const first = clean(invite.name, 80).split(/\s+/)[0];
        const exp = invite.expires_at ? new Date(invite.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e9e2d2;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#191512">
<div style="max-width:600px;margin:0 auto;padding:28px 12px">
  <div style="background:#f7f1e6">
    <div style="background:#191512;padding:22px 40px;color:#f7f1e6"><span style="font-family:Fraunces,Georgia,serif;font-size:22px;letter-spacing:.02em">med<span style="color:#c9a962">&amp;</span>X</span><span style="float:right;font:600 9px Inter,Arial,sans-serif;letter-spacing:.2em;color:#c9a962;margin-top:8px">BIOMEDICAL FORUM</span></div>
    <div style="height:2px;background:#9b1b22"></div>
    <div style="padding:36px 40px 30px">
      <span style="font:600 10px Inter,Arial,sans-serif;letter-spacing:.18em;color:#c9a962">BIOMEDICAL FORUM · BY INVITATION</span>
      <div style="font-family:Fraunces,Georgia,serif;font-size:28px;line-height:1.15;margin-top:10px">An invitation to the <i>Forum</i>${first ? ', ' + esc(first) : ''}.</div>
      <div style="font-size:14px;color:#4a4239;line-height:1.65;margin-top:14px">
        <p style="margin:0 0 12px">On behalf of Med&amp;X, it is a pleasure to invite you to join the <strong style="color:#191512">Biomedical Forum</strong> — a standing network of leaders in medicine, science, and industry, limited to ${CAP} members, that meets in person once a year.</p>
        <p style="margin:0 0 12px">Your personal invitation code is below. Enter it in the member portal to join the network and unlock registration for the annual gathering (${esc(GATHERING.start.slice(0, 4))}).</p>
        <div style="border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:18px 22px;text-align:center;margin:18px 0"><span style="font:600 10px Inter,Arial,sans-serif;letter-spacing:.16em;color:#6e5626">YOUR INVITATION CODE</span><div style="font:600 22px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;color:#191512;margin-top:8px">${esc(invite.code)}</div></div>
        <p style="margin:0">Membership is annual and renews each year; the full terms appear when you register for the gathering.</p>
      </div>
      <div style="text-align:center;margin:26px 0"><a href="${esc(url)}" style="display:inline-block;padding:15px 34px;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,Arial,sans-serif;letter-spacing:.16em;text-decoration:none">ENTER YOUR CODE →</a></div>
      <div style="font-size:12px;color:#4a4239;line-height:1.6">${exp ? 'The code is valid until ' + esc(exp) + '. ' : ''}One code admits one person. If the button doesn't work, open <span style="font:11px ui-monospace,Menlo,monospace;color:#9b1b22">${esc(url)}</span></div>
    </div>
    <div style="border-top:1px solid rgba(25,21,18,.16);padding:18px 40px;font-size:11px;color:#4a4239">© Med&amp;X 2026 · Zagreb <span style="color:#c9a962">·</span> The Biomedical Forum is an initiative of Med&amp;X.</div>
  </div>
</div></body></html>`;
    }
    // Queue ONE personal invitation through the approval outbox (scheduled_emails,
    // status 'pending_approval') — the Inbox shows the batch, one human OK sends it.
    function queueInviteEmail(invite, createdBy) {
        const batchId = 'forum-invite-' + invite.id.slice(0, 8) + '-' + Date.now().toString(36);
        const subject = 'Your invitation to the Biomedical Forum';
        const html = inviteEmailHtml(invite);
        q.run(`INSERT INTO scheduled_emails (id, status, batch_id, source_engine, template, payload_json, recipient_email, subject, created_by, created_at)
               VALUES (?, 'pending_approval', ?, 'forum-invite', 'forum_invite_code', ?, ?, ?, ?, datetime('now'))`,
            [uuid(), batchId, JSON.stringify({ to: invite.email, subject, html }), invite.email, subject, createdBy || 'forum-hub']);
        return batchId;
    }

    // ================================================================ routes (all admin-only)

    // GET /api/v2/forum/hub — one read for the whole screen
    app.get('/api/v2/forum/hub', auth, adminOnly, (req, res) => {
        try {
            const members = membersList();
            const active = members.filter(m => !m.expired);
            const countMap = {};
            active.forEach(m => { const c = String(m.country || '').trim() || 'Unlisted'; countMap[c] = (countMap[c] || 0) + 1; });
            const countries = Object.keys(countMap).map(c => ({ country: c, count: countMap[c] })).sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
            const invites = q.all(`SELECT * FROM v2_forum_invites ORDER BY datetime(created_at) DESC LIMIT 200`).map(publicInvite);
            const considerations = (q.get(`SELECT COUNT(*) AS c FROM forum_considerations WHERE status = 'pending'`) || {}).c || 0;
            res.json({
                ok: true, cap: CAP,
                members: active, members_count: active.length, expired_members: members.filter(m => m.expired),
                countries, invites, codes_out: invites.filter(i => i.status === 'open' && (i.sent_at || i.email)).length,
                vote: voteState(), feed: feedItems(), gathering: gatheringRow(), considerations_pending: considerations
            });
        } catch (e) { fail(res, e, 'hub'); }
    });

    // POST /api/v2/forum/feed — the composer (identical validation + defaults to the member module)
    app.post('/api/v2/forum/feed', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const kind = ['spotlight', 'news', 'note'].includes(String(b.kind || '').toLowerCase()) ? String(b.kind).toLowerCase() : 'news';
            const body = clean(b.body, 2000); const title = clean(b.title, 200); const name = clean(b.name, 160);
            if (!body) return res.status(400).json({ error: 'Write the post body.', code: 'body' });
            if (kind === 'spotlight' && !name) return res.status(400).json({ error: 'A spotlight needs the member\'s name.', code: 'name' });
            if (kind !== 'spotlight' && !title) return res.status(400).json({ error: 'Add a title.', code: 'title' });
            const id = uuid(); const now = nowIso();
            q.run(`INSERT INTO v2_forum_feed (id, kind, tag, name, role, init, title, body, published, published_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, kind, clean(b.tag, 40).toUpperCase() || defaultTag(kind), name || null, clean(b.role, 160) || null, clean(b.init, 4).toUpperCase() || (name ? initials(name) : null), title || null, body, b.published === false || b.published === 0 ? 0 : 1, now, req.user.email || req.user.id, now]);
            persist();
            res.json({ ok: true, item: feedItems().find(i => i.id === id) || { id } });
        } catch (e) { fail(res, e, 'feed create'); }
    });

    // PUT /api/v2/forum/feed/:id — edit / unpublish (hides from members, never deletes) / republish
    app.put('/api/v2/forum/feed/:id', auth, adminOnly, (req, res) => {
        try {
            const row = q.get(`SELECT * FROM v2_forum_feed WHERE id = ?`, [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Post not found.', code: 'unknown' });
            const b = req.body || {}; const sets = []; const vals = [];
            for (const k of ['tag', 'name', 'role', 'init', 'title', 'body', 'published_at']) if (k in b) { sets.push(k + ' = ?'); vals.push(clean(b[k], k === 'body' ? 2000 : 200) || null); }
            if ('kind' in b && ['spotlight', 'news', 'note'].includes(String(b.kind))) { sets.push('kind = ?'); vals.push(String(b.kind)); }
            if ('published' in b) { sets.push('published = ?'); vals.push(b.published ? 1 : 0); }
            if (!sets.length) return res.status(400).json({ error: 'Nothing to change.', code: 'empty' });
            sets.push('updated_at = ?'); vals.push(nowIso()); vals.push(row.id);
            q.run(`UPDATE v2_forum_feed SET ${sets.join(', ')} WHERE id = ?`, vals); persist();
            res.json({ ok: true, item: feedItems().find(i => i.id === row.id) || null });
        } catch (e) { fail(res, e, 'feed update'); }
    });

    // GET /api/v2/forum/invites — codes newest first (same shape as the member module's list)
    app.get('/api/v2/forum/invites', auth, adminOnly, (req, res) => {
        try { res.json({ ok: true, invites: q.all(`SELECT * FROM v2_forum_invites ORDER BY datetime(created_at) DESC LIMIT 500`).map(publicInvite), members_count: memberCount(), cap: CAP }); }
        catch (e) { fail(res, e, 'invites list'); }
    });

    // POST /api/v2/forum/invites {email?, name?, note?, expires_in_days?=30, queue?=true}
    // Mints FRM-XXXX-XXXX; with an email (and queue !== false) the personal invitation is staged
    // in the approval outbox — SEND CODE with no copy-pasting, and no send without the Inbox OK.
    app.post('/api/v2/forum/invites', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const email = clean(b.email, 160).toLowerCase();
            if (email && !validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address for the invitee.', code: 'email' });
            const days = b.expires_in_days == null ? 30 : parseInt(b.expires_in_days, 10);
            const expiresAt = isNaN(days) ? null : new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
            const id = uuid(); const code = newCode(); const now = nowIso();
            q.run(`INSERT INTO v2_forum_invites (id, code, email, name, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, code, email || null, clean(b.name, 160) || null, clean(b.note, 300) || null, req.user.email || req.user.id, now, expiresAt]);
            let batchId = null;
            if (email && b.queue !== false) {
                batchId = queueInviteEmail({ id, code, email, name: clean(b.name, 160), expires_at: expiresAt }, req.user.email);
                q.run(`UPDATE v2_forum_invites SET sent_at = ?, send_count = send_count + 1 WHERE id = ?`, [now, id]);
            }
            persist();
            const invite = q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [id]);
            res.json({ ok: true, invite: publicInvite(invite), queued: !!batchId, batch_id: batchId,
                message: batchId ? `Code ${code} queued for ${email} — approve it in the Outbox to send.` : `Code ${code} minted.` });
        } catch (e) { fail(res, e, 'invite create'); }
    });

    // POST /api/v2/forum/invites/:id/send {email?, name?} — (re)queue; an email given here is stored on the code
    app.post('/api/v2/forum/invites/:id/send', auth, adminOnly, (req, res) => {
        try {
            const inv = q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [req.params.id]);
            if (!inv) return res.status(404).json({ error: 'Invitation not found.', code: 'unknown' });
            if (inviteStatus(inv) !== 'open') return res.status(409).json({ error: `That code is ${inviteStatus(inv)}.`, code: inviteStatus(inv) });
            const email = clean((req.body || {}).email, 160).toLowerCase() || inv.email;
            if (!validEmail(email || '')) return res.status(400).json({ error: 'Add the invitee\'s email address first.', code: 'email' });
            const name = clean((req.body || {}).name, 160) || inv.name;
            const batchId = queueInviteEmail({ id: inv.id, code: inv.code, email, name, expires_at: inv.expires_at }, req.user.email);
            q.run(`UPDATE v2_forum_invites SET email = ?, name = ?, sent_at = ?, send_count = send_count + 1 WHERE id = ?`, [email, name || null, nowIso(), inv.id]); persist();
            res.json({ ok: true, invite: publicInvite(q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [inv.id])), queued: true, batch_id: batchId,
                message: `Invitation for ${email} queued — approve it in the Outbox to send.` });
        } catch (e) { fail(res, e, 'invite send'); }
    });

    // DELETE /api/v2/forum/invites/:id — revoke an open code (kept as an expired row for the audit trail)
    app.delete('/api/v2/forum/invites/:id', auth, adminOnly, (req, res) => {
        try {
            const inv = q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [req.params.id]);
            if (!inv) return res.status(404).json({ error: 'Invitation not found.', code: 'unknown' });
            if (inv.used_at) return res.status(409).json({ error: 'That code was already used.', code: 'used' });
            q.run(`UPDATE v2_forum_invites SET expires_at = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), inv.id]); persist();
            res.json({ ok: true, invite: publicInvite(q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [inv.id])), message: 'Code revoked.' });
        } catch (e) { fail(res, e, 'invite revoke'); }
    });

    // POST /api/v2/forum/candidates {name, email?, institution?} — one pipeline row, typed straight
    // into the hub (the legacy pipeline only has CSV import + the public form as entry points).
    app.post('/api/v2/forum/candidates', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const name = clean(b.name, 200);
            const email = clean(b.email, 160).toLowerCase();
            if (!name) return res.status(400).json({ error: 'Type the candidate\'s name first.', code: 'name' });
            if (email && !validEmail(email)) return res.status(400).json({ error: 'That email address does not look right.', code: 'email' });
            if (email) {
                const dup = q.get(`SELECT id FROM forum_candidates WHERE LOWER(COALESCE(email,'')) = ?`, [email]);
                if (dup) return res.status(409).json({ error: 'A candidate with that email is already in the pipeline.', code: 'duplicate' });
            }
            const id = uuid();
            q.run(`INSERT INTO forum_candidates (id, name, email, institution, country, field, source, status, created_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'forum-hub', 'imported', ?, datetime('now'), datetime('now'))`,
                [id, name, email || null, clean(b.institution, 300) || null, clean(b.country, 120) || null, clean(b.field, 200) || null, req.user.email || 'admin']);
            persist();
            res.json({ ok: true, candidate: q.get(`SELECT * FROM forum_candidates WHERE id = ?`, [id]) });
        } catch (e) { fail(res, e, 'candidate create'); }
    });

    // PUT /api/v2/forum/members/:id/renew — annual membership: extend by one year from today
    app.put('/api/v2/forum/members/:id/renew', auth, adminOnly, (req, res) => {
        try {
            const row = q.get(`SELECT * FROM forum_members WHERE id = ?`, [req.params.id]);
            if (!row) return res.status(404).json({ error: 'Member not found.', code: 'unknown' });
            const validUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
            const now = nowIso();
            q.run(`UPDATE forum_members SET membership_status = 'approved', valid_until = ?, membership_year = ?, banned = 0, updated_at = ? WHERE id = ?`,
                [validUntil, new Date().getFullYear(), now, row.id]);
            persist();
            const fresh = q.get(`SELECT fm.*, u.first_name AS u_first, u.last_name AS u_last, u.email AS u_email, u.institution AS u_inst, u.country AS u_country FROM forum_members fm LEFT JOIN users u ON u.id = fm.user_id WHERE fm.id = ?`, [row.id]);
            res.json({ ok: true, member: shapeMember(fresh), message: `Membership renewed — runs until ${validUntil}.` });
        } catch (e) { fail(res, e, 'member renew'); }
    });

    // GET/PUT /api/v2/forum/consideration-questions — the public "Request consideration" form questions
    app.get('/api/v2/forum/consideration-questions', auth, adminOnly, (req, res) => {
        try { res.json({ ok: true, questions: questions() }); } catch (e) { fail(res, e, 'questions read'); }
    });
    app.put('/api/v2/forum/consideration-questions', auth, adminOnly, (req, res) => {
        try {
            const list = (req.body || {}).questions;
            if (!Array.isArray(list) || !list.length || list.length > 12) return res.status(400).json({ error: 'The form needs between 1 and 12 questions.', code: 'count' });
            const cleanList = list.map(v => clean(v, 120)).filter(Boolean);
            if (!cleanList.length) return res.status(400).json({ error: 'The form needs between 1 and 12 questions.', code: 'count' });
            const now = nowIso();
            if (q.get(`SELECT key FROM app_state WHERE key = ?`, [QUESTIONS_KEY])) q.run(`UPDATE app_state SET value = ?, updated_at = ? WHERE key = ?`, [JSON.stringify(cleanList), now, QUESTIONS_KEY]);
            else q.run(`INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)`, [QUESTIONS_KEY, JSON.stringify(cleanList), now]);
            persist();
            res.json({ ok: true, questions: cleanList });
        } catch (e) { fail(res, e, 'questions write'); }
    });

    log('forum-ops: /api/v2/forum/{hub,feed,invites,candidates,members/:id/renew,consideration-questions}');
};
