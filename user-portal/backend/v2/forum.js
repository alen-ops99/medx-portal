/**
 * v2/forum.js — Biomedical Forum backend for the redesigned member portal (frontend-v2 /app/forum).
 * Mounted by v2/index.js; every route lives under /api/v2/forum/… (2026-08-28, member portal redesign).
 *
 * Product model (design README note 13 + admin review decisions): the Forum is a STANDING invitation-only
 * network (cap 200) with ANNUAL, renewable membership that gathers once a year (May 28–29, 2027, Split or
 * Zagreb — members vote). The invitation code JOINS the network; gathering registration is a second step.
 *
 * Tables it owns (v2_ prefix, CREATE TABLE IF NOT EXISTS at load):
 *   v2_forum_invites  — invitation codes (code UNIQUE, email, name, created_by, created_at, expires_at, used_at, used_by)
 *   v2_forum_votes    — venue vote, one row per member per poll, changeable
 *   v2_forum_feed     — the "From the Forum" composer target (kind, tag, name/role/init or title, body, published, published_at)
 *   v2_forum_nominations — a member puts a colleague forward (medx.hr: "…or put forward by a member
 *                       who can speak to a colleague's standing and character"); status new →
 *                       shortlisted/declined by the admin Forum hub's recruitment pipeline
 * Existing tables it reads/writes with the admin portal's semantics (never renamed, columns only ADDED):
 *   forum_members (the admission table both portals read; + membership_year, valid_until, joined_via)
 *   forum_event_registrations (the gathering registration table the admin lists/checks in; + terms_accepted_at)
 *   forum_events (the gathering row, seeded once by slug so registration has a real target; admin-editable)
 *   forum_invitations (legacy admin-minted codes — still redeemable), forum_news (legacy Forum news → feed)
 * The magic-link door (/forum/enter?token=) is untouched: members admitted there are 'approved' rows here too.
 */
'use strict';
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const POLL = 'venue-2027';
const CHOICES = ['split', 'zagreb'];
const CAP = 200;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const NOMINATION_STATEMENT_MIN = 120;   // the "standing and character" statement must carry real words
const NOMINATIONS_PER_WINDOW = 3;       // a member may put forward at most 3 colleagues…
const NOMINATION_WINDOW_DAYS = 30;      // …per rolling 30 days (429 with a warm message beyond that)
const GATHERING = {
    slug: 'forum-2027-gathering', title: 'Annual Biomedical Forum 2027',
    description: 'The annual gathering of the Biomedical Forum — three days each May, closing with the Gala & Awards evening. Split or Zagreb; the venue is announced with your invitation.',
    start: '2027-05-28', end: '2027-05-29', where: 'Split or Zagreb — venue announced with your invitation'
};

module.exports = function mountForum(app, ctx) {
    const { auth, adminOnly, optionalAuth, sendEmail } = ctx;
    const log = ctx.log || ((...a) => console.log('[v2/forum]', ...a));
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
    const nowIso = () => new Date().toISOString();
    const today = () => nowIso().slice(0, 10);

    // ---- tiny query helpers over the sql.js-style wrapper (see shared/db.js) ----
    const q = {
        get(sql, params) { const s = ctx.db().prepare(sql).bind(params || []); const row = s.step() ? s.getAsObject() : null; s.free(); return row; },
        all(sql, params) { const s = ctx.db().prepare(sql).bind(params || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, params) { return ctx.db().run(sql, params || []); }
    };
    // Turso: server.js debounces db.sync() in saveDb(); mirror it here (no-op without TURSO_DATABASE_URL).
    let syncTimer = null;
    const persist = () => { if (!process.env.TURSO_DATABASE_URL) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => { try { ctx.db().sync(); } catch (e) { /* retried by the periodic sync */ } }, 2000); };
    const fail = (res, e, what) => { console.error('[v2/forum] ' + what + ':', e && e.message); return res.status(500).json({ error: 'That could not be completed just now.' }); };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

    // ---- schema (both portals share ONE database: only v2_ tables + ADD COLUMN, all inside try/catch) ----
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
        q.run(`CREATE TABLE IF NOT EXISTS v2_forum_nominations (
            id TEXT PRIMARY KEY, nominee_name TEXT NOT NULL, nominee_email TEXT, institution TEXT,
            statement TEXT NOT NULL, nominated_by_user_id TEXT, nominated_by_email TEXT,
            status TEXT NOT NULL DEFAULT 'new', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
        q.run(`CREATE INDEX IF NOT EXISTS idx_v2_forum_invites_code ON v2_forum_invites(code)`);
    } catch (e) { console.error('[v2/forum] schema:', e.message); }
    for (const sql of [
        `ALTER TABLE forum_members ADD COLUMN membership_year INTEGER`,
        `ALTER TABLE forum_members ADD COLUMN valid_until TEXT`,
        `ALTER TABLE forum_members ADD COLUMN joined_via TEXT`,
        `ALTER TABLE forum_event_registrations ADD COLUMN terms_accepted_at TEXT`
    ]) { try { q.run(sql); } catch (e) { /* column exists */ } }
    // The gathering row: seeded ONCE by slug (like server.js seeds the 2026 events) so COMPLETE REGISTRATION has a real
    // forum_events target from day one; admins edit it in the Forum hub (title, dates, venue, capacity, publish flag).
    try {
        if (!q.get(`SELECT id FROM forum_events WHERE slug = ?`, [GATHERING.slug])) {
            q.run(`INSERT INTO forum_events (id, title, description, event_type, slug, event_scale, start_date, end_date, location_type, location_name, capacity, is_paid, price, is_members_only, status, is_published, registrations_count)
                   VALUES (?, ?, ?, 'gathering', ?, 'large', ?, ?, 'in_person', ?, ?, 0, 0, 1, 'published', 1, 0)`,
                [uuid(), GATHERING.title, GATHERING.description, GATHERING.slug, GATHERING.start, GATHERING.end, GATHERING.where, CAP]);
            log('seeded forum_events row ' + GATHERING.slug);
        }
    } catch (e) { console.error('[v2/forum] gathering seed:', e.message); }

    // ---- limiters (codes are guessable only by brute force; keep it slow) ----
    const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts — please wait a few minutes and try again.', code: 'rate_limited' } });

    // ---- membership helpers (forum_members = the admission table both portals read) ----
    const isMemberStatus = s => ['approved', 'active'].includes(String(s || '').toLowerCase());
    function memberRowFor(userId, email) {
        let row = userId ? q.get(`SELECT * FROM forum_members WHERE user_id = ? LIMIT 1`, [userId]) : null;
        if (!row && email) row = q.get(`SELECT * FROM forum_members WHERE LOWER(email) = LOWER(?) LIMIT 1`, [email]);
        return row || null;
    }
    function membershipOf(row) {
        if (!row) return { is_member: false, status: 'none', stage: 1 };
        const expired = !!(row.valid_until && String(row.valid_until).slice(0, 10) < today());
        const active = isMemberStatus(row.membership_status) && !expired && !row.banned;
        return {
            is_member: active, status: expired ? 'expired' : String(row.membership_status || 'none'),
            expired, since: row.approved_at || row.created_at || null, valid_until: row.valid_until || null,
            membership_year: row.membership_year || (row.approved_at ? Number(String(row.approved_at).slice(0, 4)) : null),
            joined_via: row.joined_via || null, member_id: row.id
        };
    }
    const memberCount = () => (q.get(`SELECT COUNT(*) AS c FROM forum_members WHERE LOWER(COALESCE(membership_status,'')) IN ('approved','active')`) || {}).c || 0;
    function userRow(id) { return q.get(`SELECT id, email, first_name, last_name, institution, country, is_public_profile FROM users WHERE id = ?`, [id]); }
    function gatheringRow() {
        return q.get(`SELECT * FROM forum_events WHERE event_type = 'gathering' AND start_date >= date('now') AND status = 'published' AND COALESCE(is_published, 0) = 1 ORDER BY start_date ASC LIMIT 1`)
            || q.get(`SELECT * FROM forum_events WHERE start_date >= date('now') AND status = 'published' AND COALESCE(is_published, 0) = 1 AND (slug IS NULL OR slug NOT LIKE '%gala%') ORDER BY start_date ASC LIMIT 1`)
            || null;
    }
    function registrationFor(eventId, memberId, email) {
        if (!eventId) return null;
        let reg = memberId ? q.get(`SELECT * FROM forum_event_registrations WHERE event_id = ? AND member_id = ? AND COALESCE(status,'registered') <> 'cancelled' LIMIT 1`, [eventId, memberId]) : null;
        if (!reg && email) reg = q.get(`SELECT * FROM forum_event_registrations WHERE event_id = ? AND LOWER(email) = LOWER(?) AND COALESCE(status,'registered') <> 'cancelled' LIMIT 1`, [eventId, email]);
        return reg || null;
    }
    const publicReg = r => r ? ({ id: r.id, qr_code: r.qr_code, status: r.status || 'registered', rsvp_status: r.rsvp_status || null, payment_status: r.payment_status || 'free', registered_at: r.registered_at, terms_accepted_at: r.terms_accepted_at || null, checked_in: !!r.checked_in }) : null;
    const publicEvent = e => e ? ({ id: e.id, slug: e.slug, title: e.title, description: e.description, start_date: e.start_date, end_date: e.end_date, location_name: e.location_name || e.venue || '', capacity: e.capacity, registrations_count: e.registrations_count || 0, is_paid: !!e.is_paid, price: e.price || 0, registration_deadline: e.registration_deadline || e.rsvp_deadline || null,
        registration_open: !(e.registration_deadline && String(e.registration_deadline).slice(0, 10) < today()) && !(e.capacity && (e.registrations_count || 0) >= e.capacity) }) : null;
    function voteState(userId) {
        const counts = { split: 0, zagreb: 0 };
        q.all(`SELECT choice, COUNT(*) AS c FROM v2_forum_votes WHERE poll = ? GROUP BY choice`, [POLL]).forEach(r => { if (r.choice in counts) counts[r.choice] = r.c; });
        const mine = userId ? q.get(`SELECT choice FROM v2_forum_votes WHERE poll = ? AND user_id = ?`, [POLL, userId]) : null;
        return { poll: POLL, choices: CHOICES, mine: mine ? mine.choice : null, counts, total: counts.split + counts.zagreb };
    }
    function scheduleFor(eventId) {
        if (!eventId) return [];
        return q.all(`SELECT title, description, session_type, date, start_time, end_time, room FROM forum_event_schedule WHERE event_id = ? ORDER BY date, sort_order, start_time`, [eventId])
            .map(r => ({ time: String(r.start_time || '').slice(0, 5), title: r.title, note: r.description || r.room || '', date: r.date || null, type: r.session_type || 'session' }));
    }
    function speakersFor(eventId) {
        if (!eventId) return [];
        return q.all(`SELECT name, title, institution, photo_url, talk_title, speaker_type FROM forum_event_speakers WHERE event_id = ? AND COALESCE(is_confirmed, 0) = 1 ORDER BY sort_order, name`, [eventId]);
    }

    // ---- invitation codes ----
    function newCode() {
        const pick = () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        for (;;) {
            const code = 'FRM-' + [0, 0, 0, 0].map(pick).join('') + '-' + [0, 0, 0, 0].map(pick).join('');
            if (!q.get(`SELECT id FROM v2_forum_invites WHERE code = ?`, [code])) return code;
        }
    }
    const normCode = v => String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
    const inviteStatus = i => i.used_at ? 'used' : (i.expires_at && i.expires_at < nowIso()) ? 'expired' : 'open';
    const publicInvite = i => ({ id: i.id, code: i.code, email: i.email, name: i.name, note: i.note, created_by: i.created_by, created_at: i.created_at, expires_at: i.expires_at, used_at: i.used_at, used_by: i.used_by, sent_at: i.sent_at, send_count: i.send_count || 0, status: inviteStatus(i) });
    // Look a code up in v2_forum_invites first, then the legacy admin-minted forum_invitations (invitation_code,
    // applied_at = used, no expiry column). Returns { source, row } or null.
    function findCode(code) {
        const v2 = q.get(`SELECT * FROM v2_forum_invites WHERE code = ?`, [code]);
        if (v2) return { source: 'v2', row: v2 };
        const legacy = q.get(`SELECT * FROM forum_invitations WHERE UPPER(invitation_code) = ?`, [code]);
        if (legacy) return { source: 'legacy', row: legacy };
        return null;
    }
    // Validation shared by check-code (read-only) and redeem-code. Returns { ok:true, hit } or { status, code, error }.
    function validateCode(raw, user) {
        const code = normCode(raw);
        if (!code) return { status: 400, code: 'empty', error: 'Enter the code from your invitation email.' };
        const hit = findCode(code);
        if (!hit) return { status: 404, code: 'unknown', error: "That code isn't valid — check the invitation email or write to the Forum team." };
        const r = hit.row;
        const usedAt = hit.source === 'v2' ? r.used_at : r.applied_at;
        if (usedAt) return { status: 409, code: 'used', error: 'That code has already been used. Each invitation admits one person — write to the Forum team if this is yours.' };
        if (hit.source === 'v2' && r.expires_at && r.expires_at < nowIso()) return { status: 410, code: 'expired', error: 'That invitation has expired. Write to the Forum team and we will send a fresh code.' };
        if (user && r.email && String(r.email).trim() && String(r.email).trim().toLowerCase() !== String(user.email || '').trim().toLowerCase()) {
            return { status: 403, code: 'email_mismatch', error: 'That code was issued to a different email address. Sign in with the address the invitation was sent to, or write to the Forum team.' };
        }
        return { ok: true, hit, code };
    }
    function portalBase(req) {
        return String(process.env.PUBLIC_BASE_URL || process.env.STAGING_MEMBER_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    }
    // 600px transactional template in the Emails.dc.html voice (ink header · 2px rule · cream body · Fraunces headline)
    function emailShell({ eyebrow, headline, bodyHtml, cta, ctaUrl, footnote, rule = '#9b1b22' }) {
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e9e2d2;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#191512">
<div style="max-width:600px;margin:0 auto;padding:28px 12px">
  <div style="background:#f7f1e6">
    <div style="background:#191512;padding:22px 40px;color:#f7f1e6"><span style="font-family:Fraunces,Georgia,serif;font-size:22px;letter-spacing:.02em">med<span style="color:#c9a962">&amp;</span>X</span><span style="float:right;font:600 9px Inter,Arial,sans-serif;letter-spacing:.2em;color:#c9a962;margin-top:8px">MEMBER PORTAL</span></div>
    <div style="height:2px;background:${rule}"></div>
    <div style="padding:36px 40px 30px">
      <span style="font:600 10px Inter,Arial,sans-serif;letter-spacing:.18em;color:#c9a962">${esc(eyebrow)}</span>
      <div style="font-family:Fraunces,Georgia,serif;font-size:28px;line-height:1.15;margin-top:10px">${headline}</div>
      <div style="font-size:14px;color:#4a4239;line-height:1.65;margin-top:14px">${bodyHtml}</div>
      ${cta ? `<div style="text-align:center;margin:26px 0"><a href="${esc(ctaUrl)}" style="display:inline-block;padding:15px 34px;background:#9b1b22;color:#f7f1e6;font:600 11px Inter,Arial,sans-serif;letter-spacing:.16em;text-decoration:none">${esc(cta)}</a></div>` : ''}
      ${footnote ? `<div style="font-size:12px;color:#4a4239;line-height:1.6">${footnote}</div>` : ''}
    </div>
    <div style="border-top:1px solid rgba(25,21,18,.16);padding:18px 40px;font-size:11px;color:#4a4239">© Med&amp;X 2026 · Zagreb <span style="color:#c9a962">·</span> The Biomedical Forum is an initiative of Med&amp;X.</div>
  </div>
</div></body></html>`;
    }
    async function emailInvite(req, invite) {
        const base = portalBase(req);
        const url = base + '/app/auth/forum-code?code=' + encodeURIComponent(invite.code);
        const first = clean(invite.name, 80).split(/\s+/)[0];
        const exp = invite.expires_at ? new Date(invite.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
        const html = emailShell({
            eyebrow: 'BIOMEDICAL FORUM · BY INVITATION',
            headline: `An invitation to the <i>Forum</i>${first ? ', ' + esc(first) : ''}.`,
            bodyHtml: `<p style="margin:0 0 12px">On behalf of Med&amp;X, it is a pleasure to invite you to join the <strong style="color:#191512">Biomedical Forum</strong> — a standing network of leaders in medicine, science, and industry, limited to ${CAP} members, that meets in person once a year.</p>
<p style="margin:0 0 12px">Your personal invitation code is below. Enter it in the member portal to join the network and unlock registration for the annual gathering (${esc(GATHERING.start.slice(0, 4))}).</p>
<div style="border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:18px 22px;text-align:center;margin:18px 0"><span style="font:600 10px Inter,Arial,sans-serif;letter-spacing:.16em;color:#6e5626">YOUR INVITATION CODE</span><div style="font:600 22px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;color:#191512;margin-top:8px">${esc(invite.code)}</div></div>
<p style="margin:0">Membership is annual and renews each year; the full terms appear when you register for the gathering.</p>`,
            cta: 'ENTER YOUR CODE →', ctaUrl: url,
            footnote: `${exp ? 'The code is valid until ' + esc(exp) + '. ' : ''}One code admits one person. If the button doesn't work, open <span style="font:11px ui-monospace,Menlo,monospace;color:#9b1b22">${esc(url)}</span>`
        });
        const r = await sendEmail(invite.email, 'Your invitation to the Biomedical Forum', html);
        return { emailed: !!(r && r.success && !r.mock), mock: !!(r && r.mock), preview_url: url };
    }
    async function emailRegistration(req, user, event, reg, membership) {
        const base = portalBase(req);
        const when = event.start_date === event.end_date || !event.end_date ? fmtDate(event.start_date) : fmtRange(event.start_date, event.end_date);
        const html = emailShell({
            eyebrow: "YOU'RE GOING", rule: '#c9a962',
            headline: `Forum gathering — seat <i>confirmed</i>.`,
            bodyHtml: `<p style="margin:0 0 12px">${user.first_name ? 'Dear ' + esc(user.first_name) + ',' : 'Dear colleague,'}</p>
<p style="margin:0 0 12px">Your seat at <strong style="color:#191512">${esc(event.title)}</strong> is confirmed.</p>
<div style="border:1px solid rgba(201,169,98,.65);background:#fdfaf3;padding:16px 20px;margin:16px 0;font-size:13px;line-height:1.7">
<span style="font:600 9px Inter,Arial,sans-serif;letter-spacing:.16em;color:#4a4239;display:inline-block;width:70px">WHEN</span>${esc(when)}<br>
<span style="font:600 9px Inter,Arial,sans-serif;letter-spacing:.16em;color:#4a4239;display:inline-block;width:70px">WHERE</span>${esc(event.location_name || GATHERING.where)}<br>
<span style="font:600 9px Inter,Arial,sans-serif;letter-spacing:.16em;color:#4a4239;display:inline-block;width:70px">REFERENCE</span><span style="font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.08em">${esc(reg.qr_code)}</span></div>
<p style="margin:0 0 12px">Your QR pass appears in My Med&amp;X and admits you at every door. The full program follows closer to the date.</p>
<p style="margin:0">Forum membership is annual and renews each year${membership && membership.valid_until ? ' — yours runs until ' + esc(fmtDate(membership.valid_until)) : ''}.</p>`,
            cta: 'OPEN MY MED&X →', ctaUrl: base + '/app/me',
            footnote: 'Questions about the gathering, the program, or your membership? Message us in the portal — replies land in your inbox there.'
        });
        try { await sendEmail(user.email, `Your seat is confirmed — ${event.title}`, html); } catch (e) { console.error('[v2/forum] confirmation email:', e && e.message); }
    }
    function fmtDate(v) { const d = new Date(String(v).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    function fmtRange(a, b) { const da = new Date(String(a).slice(0, 10) + 'T00:00:00Z'), db_ = new Date(String(b).slice(0, 10) + 'T00:00:00Z'); if (isNaN(da) || isNaN(db_)) return fmtDate(a); if (da.getUTCMonth() === db_.getUTCMonth()) return da.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' ' + da.getUTCDate() + '–' + db_.getUTCDate() + ', ' + da.getUTCFullYear(); return fmtDate(a) + ' – ' + fmtDate(b); }

    // Create-or-approve the caller's forum_members row (same shape the admin admit path and the magic-link door write).
    function admit(user, via, existing) {
        const now = nowIso();
        const validUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        const year = new Date().getFullYear();
        if (existing) {
            q.run(`UPDATE forum_members SET user_id = ?, email = COALESCE(email, ?), first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?), institution = COALESCE(institution, ?),
                       membership_status = 'approved', approved_at = ?, approved_by = ?, valid_until = ?, membership_year = ?, joined_via = ?, banned = 0, updated_at = ? WHERE id = ?`,
                [user.id, user.email, user.first_name || null, user.last_name || null, user.institution || null, now, via, validUntil, year, via, now, existing.id]);
            return q.get(`SELECT * FROM forum_members WHERE id = ?`, [existing.id]);
        }
        const id = uuid();
        q.run(`INSERT INTO forum_members (id, user_id, email, first_name, last_name, institution, country, membership_status, approved_at, approved_by, valid_until, membership_year, joined_via, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)`,
            [id, user.id, user.email, user.first_name || null, user.last_name || null, user.institution || null, user.country || null, now, via, validUntil, year, via, now, now]);
        return q.get(`SELECT * FROM forum_members WHERE id = ?`, [id]);
    }

    // ================================================================ routes

    // GET /api/v2/forum/state — everything the screen needs in one read (membership · gathering · my registration · vote · schedule · speakers)
    app.get('/api/v2/forum/state', auth, (req, res) => {
        try {
            const user = userRow(req.user.id) || { id: req.user.id, email: req.user.email };
            const row = memberRowFor(user.id, user.email);
            const membership = membershipOf(row);
            const event = gatheringRow();
            const reg = membership.is_member || row ? registrationFor(event && event.id, row && row.id, user.email) : null;
            const stage = reg ? 3 : membership.is_member ? 2 : 1;
            res.json({
                ok: true, stage, cap: CAP, members_count: memberCount(),
                user: { id: user.id, email: user.email, first_name: user.first_name || '', last_name: user.last_name || '', institution: user.institution || '' },
                membership, gathering: publicEvent(event), registration: publicReg(reg),
                vote: voteState(user.id), schedule: scheduleFor(event && event.id), speakers: speakersFor(event && event.id)
            });
        } catch (e) { fail(res, e, 'state'); }
    });

    // POST /api/v2/forum/check-code {code} — read-only validation (public + optionalAuth) for the Auth "Invitation code" screen:
    // a guest learns the code is good BEFORE creating an account; the redeem happens after sign-in (redeem-code).
    app.post('/api/v2/forum/check-code', codeLimiter, optionalAuth, (req, res) => {
        try {
            const v = validateCode(req.body && req.body.code, req.user ? { email: req.user.email } : null);
            if (!v.ok) return res.status(v.status).json({ error: v.error, code: v.code });
            const r = v.hit.row;
            res.json({ ok: true, valid: true, code: v.code, invited_name: v.hit.source === 'v2' ? (r.name || null) : ([r.first_name, r.last_name].filter(Boolean).join(' ') || null), expires_at: v.hit.source === 'v2' ? r.expires_at : null, message: 'Code accepted — welcome to the Forum network.' });
        } catch (e) { fail(res, e, 'check-code'); }
    });

    // POST /api/v2/forum/redeem-code {code} — JOIN the network (stage 2). Distinct errors: empty · unknown · expired · used ·
    // email_mismatch · member (already a current member) · full (cap 200). An expired membership is RENEWED by a fresh code.
    app.post('/api/v2/forum/redeem-code', codeLimiter, auth, async (req, res) => {
        try {
            const user = userRow(req.user.id);
            if (!user) return res.status(401).json({ error: 'Sign in to use your code.', code: 'unauthenticated' });
            const v = validateCode(req.body && req.body.code, user);
            if (!v.ok) return res.status(v.status).json({ error: v.error, code: v.code });
            const existing = memberRowFor(user.id, user.email);
            const before = membershipOf(existing);
            if (before.is_member) {
                return res.status(409).json({ error: `You're already a Forum member${before.valid_until ? ' — your membership runs until ' + fmtDate(before.valid_until) : ''}.`, code: 'member', membership: before });
            }
            if (!existing && memberCount() >= CAP) return res.status(409).json({ error: `The Forum is at its ${CAP}-member cap this year — the team will be in touch about the next opening.`, code: 'full' });
            const row = admit(user, 'invite-code', existing);
            const now = nowIso();
            if (v.hit.source === 'v2') q.run(`UPDATE v2_forum_invites SET used_at = ?, used_by = ? WHERE id = ?`, [now, user.id, v.hit.row.id]);
            else q.run(`UPDATE forum_invitations SET applied_at = ?, application_id = ?, delivery_status = 'redeemed' WHERE id = ?`, [now, row.id, v.hit.row.id]);
            persist();
            const membership = membershipOf(row);
            res.json({ ok: true, renewed: !!(existing && before.expired), stage: 2, membership, message: existing && before.expired ? 'Membership renewed — welcome back to the Forum.' : 'Code accepted — welcome to the Forum network.' });
        } catch (e) { fail(res, e, 'redeem-code'); }
    });

    // POST /api/v2/forum/register {terms_accepted:true, name?, institution?, dietary?} — gathering registration (stage 3).
    // Writes forum_event_registrations exactly as the legacy /api/forum/events/:id/register does (same columns, FORUM-XXXXXXXX
    // reference), plus terms_accepted_at (annual/renewable membership terms shown in the form) and a brand confirmation email.
    app.post('/api/v2/forum/register', auth, async (req, res) => {
        try {
            const b = req.body || {};
            const user = userRow(req.user.id);
            if (!user) return res.status(401).json({ error: 'Sign in to register.', code: 'unauthenticated' });
            const row = memberRowFor(user.id, user.email);
            const membership = membershipOf(row);
            if (!membership.is_member) return res.status(403).json({ error: membership.expired ? 'Your Forum membership has lapsed — enter this year\'s code to renew it, then register.' : 'Gathering registration is for Forum members — enter your invitation code first.', code: membership.expired ? 'expired_membership' : 'not_member' });
            if (!(b.terms_accepted === true || b.terms_accepted === 1 || b.terms_accepted === 'true')) return res.status(400).json({ error: 'Please accept the annual membership terms to register.', code: 'terms' });
            const event = gatheringRow();
            if (!event) return res.status(409).json({ error: 'Registration for the next gathering has not opened yet — Forum members hear first.', code: 'no_event' });
            const existing = registrationFor(event.id, row.id, user.email);
            if (existing) return res.status(409).json({ error: 'You are already registered for the gathering.', code: 'registered', registration: publicReg(existing) });
            const ev = publicEvent(event);
            if (!ev.registration_open) return res.status(409).json({ error: event.capacity && (event.registrations_count || 0) >= event.capacity ? 'The gathering is at capacity.' : 'Registration for the gathering has closed.', code: 'closed' });
            const name = clean(b.name, 160) || [user.first_name, user.last_name].filter(Boolean).join(' ');
            const institution = clean(b.institution, 200) || row.institution || user.institution || null;
            const dietary = clean(b.dietary, 300) || null;
            const id = uuid();
            const qrCode = 'FORUM-' + id.replace(/-/g, '').slice(0, 8).toUpperCase();
            const isPaid = !!(event.is_paid && event.price > 0);
            const now = nowIso();
            q.run(`INSERT INTO forum_event_registrations (id, event_id, member_id, status, ticket_type, payment_status, payment_amount, qr_code, rsvp_status, first_name, last_name, name, email, institution, dietary_requirements, terms_accepted_at, notes, registered_at)
                   VALUES (?, ?, ?, 'registered', 'general', ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, event.id, row.id, isPaid ? 'unpaid' : 'free', isPaid ? event.price : null, qrCode, user.first_name || null, user.last_name || null, name || null, user.email, institution, dietary, now, 'Registered in the member portal (v2) · annual membership terms accepted', now]);
            q.run(`UPDATE forum_events SET registrations_count = COALESCE(registrations_count, 0) + 1 WHERE id = ?`, [event.id]);
            if (institution && !row.institution) q.run(`UPDATE forum_members SET institution = ? WHERE id = ?`, [institution, row.id]);
            persist();
            const reg = q.get(`SELECT * FROM forum_event_registrations WHERE id = ?`, [id]);
            if (!isPaid) emailRegistration(req, user, event, reg, membership); // non-blocking
            res.json({ ok: true, stage: 3, registration: publicReg(reg), requires_payment: isPaid, price: isPaid ? event.price : 0, gathering: publicEvent(q.get(`SELECT * FROM forum_events WHERE id = ?`, [event.id])), message: isPaid ? 'Seat held — complete payment to confirm it.' : 'Your seat at the gathering is confirmed.' });
        } catch (e) { fail(res, e, 'register'); }
    });

    // POST /api/v2/forum/vote {choice:'split'|'zagreb'} — one vote per member, changeable; returns live counts
    app.post('/api/v2/forum/vote', auth, (req, res) => {
        try {
            const choice = String((req.body || {}).choice || '').toLowerCase();
            if (!CHOICES.includes(choice)) return res.status(400).json({ error: 'Pick Split or Zagreb.', code: 'choice' });
            const row = memberRowFor(req.user.id, req.user.email);
            if (!membershipOf(row).is_member) return res.status(403).json({ error: 'The venue vote is for Forum members — enter your invitation code first.', code: 'not_member' });
            const now = nowIso();
            const mine = q.get(`SELECT id FROM v2_forum_votes WHERE poll = ? AND user_id = ?`, [POLL, req.user.id]);
            if (mine) q.run(`UPDATE v2_forum_votes SET choice = ?, updated_at = ? WHERE id = ?`, [choice, now, mine.id]);
            else q.run(`INSERT INTO v2_forum_votes (id, poll, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [uuid(), POLL, req.user.id, choice, now, now]);
            persist();
            res.json({ ok: true, vote: voteState(req.user.id), message: mine ? 'Vote updated.' : 'Vote counted.' });
        } catch (e) { fail(res, e, 'vote'); }
    });

    // POST /api/v2/forum/nominate {name, email, institution, statement} — a member puts a colleague
    // forward (medx.hr: members join "invited by the Office of the Forum, or put forward by a member
    // who can speak to a colleague's standing and character" — this is the second route). Requires a
    // signed-in member; writes v2_forum_nominations (status 'new'), which the admin Forum hub surfaces
    // inside the recruitment pipeline as a NOMINATED row (shortlist / decline happens there).
    // Distinct errors: name · email · institution · statement (< 120 chars) · duplicate (same colleague
    // already before the Office) · rate_limited (429 — at most 3 per member per rolling 30 days).
    app.post('/api/v2/forum/nominate', auth, (req, res) => {
        try {
            const b = req.body || {};
            const user = userRow(req.user.id) || { id: req.user.id, email: req.user.email || '' };
            const name = clean(b.name, 160);
            const email = clean(b.email, 160).toLowerCase();
            const institution = clean(b.institution, 200);
            const statement = String(b.statement == null ? '' : b.statement).trim().slice(0, 2000);
            if (!name) return res.status(400).json({ error: 'Tell us your colleague\'s name.', code: 'name' });
            if (!validEmail(email)) return res.status(400).json({ error: 'Add your colleague\'s email address so the Office of the Forum can reach them.', code: 'email' });
            if (!institution) return res.status(400).json({ error: 'Add their institution — it helps the Office place them.', code: 'institution' });
            if (statement.length < NOMINATION_STATEMENT_MIN) return res.status(400).json({ error: `The statement is the part the Office of the Forum reads first — give it at least ${NOMINATION_STATEMENT_MIN} characters on their standing and character, in your own words.`, code: 'statement' });
            const since = new Date(Date.now() - NOMINATION_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
            const recent = (q.get(`SELECT COUNT(*) AS c FROM v2_forum_nominations WHERE nominated_by_user_id = ? AND created_at >= ?`, [user.id, since]) || {}).c || 0;
            if (recent >= NOMINATIONS_PER_WINDOW) return res.status(429).json({ error: `Three nominations in thirty days is the most we take from one member — it keeps each one weighty. Yours are with the Office of the Forum, and the next window opens soon.`, code: 'rate_limited' });
            const dup = q.get(`SELECT id FROM v2_forum_nominations WHERE LOWER(COALESCE(nominee_email, '')) = ? AND status = 'new'`, [email]);
            if (dup) return res.status(409).json({ error: 'That colleague has already been put forward — their nomination is with the Office of the Forum.', code: 'duplicate' });
            const id = uuid(); const now = nowIso();
            q.run(`INSERT INTO v2_forum_nominations (id, nominee_name, nominee_email, institution, statement, nominated_by_user_id, nominated_by_email, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
                [id, name, email, institution, statement, user.id, String(user.email || '').toLowerCase() || null, now]);
            persist();
            res.json({ ok: true, nomination: { id, nominee_name: name, nominee_email: email, institution, status: 'new', created_at: now },
                message: 'Your nomination is with the Office of the Forum — we treat these seriously and reply to you either way.' });
        } catch (e) { fail(res, e, 'nominate'); }
    });

    // GET /api/v2/forum/feed?limit=12 — "From the Forum": the v2 composer table ∪ legacy forum_news (published only; newest first).
    // Unpublish hides, never deletes (README note 22). Home and Network teasers can read the same endpoint with ?limit=1.
    function feedItems({ all = false, limit = 12 } = {}) {
        const v2 = q.all(`SELECT id, kind, tag, name, role, init, title, body, published, published_at FROM v2_forum_feed ${all ? '' : 'WHERE published = 1'} ORDER BY datetime(published_at) DESC LIMIT 60`)
            .map(r => ({ id: r.id, source: 'v2', kind: r.kind || 'news', tag: r.tag || defaultTag(r.kind), name: r.name || null, role: r.role || null, init: r.init || (r.name ? initials(r.name) : null), title: r.title || null, body: r.body || '', published: !!r.published, published_at: r.published_at }));
        let news = [];
        try { news = q.all(`SELECT id, title, body, date, created_at FROM forum_news WHERE status = 'published' ORDER BY date DESC, sort ASC LIMIT 20`).map(r => ({ id: 'news-' + r.id, source: 'forum_news', kind: 'news', tag: 'FORUM NEWS', name: null, role: null, init: null, title: r.title, body: r.body || '', published: true, published_at: (r.date || String(r.created_at || '').slice(0, 10)) + 'T09:00:00.000Z' })); } catch (e) { /* legacy table optional */ }
        const ts = v => new Date(String(v || '').replace(' ', 'T')).getTime() || 0;
        return v2.concat(news).sort((a, b) => ts(b.published_at) - ts(a.published_at)).slice(0, limit);
    }
    const defaultTag = k => ({ spotlight: 'MEMBER SPOTLIGHT', news: 'FORUM NEWS', note: 'WORTH READING' }[String(k || '').toLowerCase()] || 'FROM THE FORUM');
    const initials = n => { const p = String(n || '').replace(/^(prof|dr|sc|med|mr|mrs|ms)\.?\s+/gi, '').trim().split(/\s+/).filter(Boolean); return ((p[0] || '')[0] || '') + ((p[p.length - 1] || '')[0] || ''); };
    app.get('/api/v2/forum/feed', auth, (req, res) => {
        try {
            const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
            const all = String(req.query.all || '') === '1' && !!req.user.is_admin;
            res.json({ ok: true, items: feedItems({ all, limit }) });
        } catch (e) { fail(res, e, 'feed'); }
    });
    // adminOnly composer (Member spotlight / Forum news / Note): POST create · PUT publish/unpublish/edit
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
                [id, kind, clean(b.tag, 40).toUpperCase() || defaultTag(kind), name || null, clean(b.role, 160) || null, clean(b.init, 4).toUpperCase() || (name ? initials(name).toUpperCase() : null), title || null, body, b.published === false || b.published === 0 ? 0 : 1, clean(b.published_at, 40) || now, req.user.email || req.user.id, now]);
            persist();
            res.json({ ok: true, item: feedItems({ all: true, limit: 60 }).find(i => i.id === id) || { id } });
        } catch (e) { fail(res, e, 'feed create'); }
    });
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
            res.json({ ok: true, item: feedItems({ all: true, limit: 60 }).find(i => i.id === row.id) || null });
        } catch (e) { fail(res, e, 'feed update'); }
    });

    // GET /api/v2/forum/members-public?q= — Forum members for the portal Network, year-round (auth; respects users.is_public_profile
    // and forum_members.profile_visibility; never emails). For the Network builder: name · institution · city · country · specialty.
    app.get('/api/v2/forum/members-public', auth, (req, res) => {
        try {
            const needle = String(req.query.q || '').trim().toLowerCase();
            const rows = q.all(`SELECT fm.id, fm.user_id, fm.first_name AS fm_first, fm.last_name AS fm_last, fm.institution AS fm_inst, fm.location_city, fm.location_country, fm.country AS fm_country,
                                       fm.specialty, fm.position, fm.photo_url AS fm_photo, fm.approved_at, fm.created_at, fm.membership_year, fm.profile_visibility,
                                       u.first_name AS u_first, u.last_name AS u_last, u.institution AS u_inst, u.country AS u_country, u.photo_url AS u_photo, u.is_public_profile
                                FROM forum_members fm LEFT JOIN users u ON u.id = fm.user_id
                                WHERE LOWER(COALESCE(fm.membership_status,'')) IN ('approved','active') AND COALESCE(fm.banned, 0) = 0
                                  AND (fm.valid_until IS NULL OR fm.valid_until >= date('now'))
                                  AND COALESCE(u.is_public_profile, 1) = 1 AND LOWER(COALESCE(fm.profile_visibility, 'members')) <> 'private'`);
            let members = rows.map(r => {
                const name = [r.fm_first || r.u_first, r.fm_last || r.u_last].filter(Boolean).join(' ').trim();
                return { id: r.id, user_id: r.user_id || null, name, initials: initials(name).toUpperCase(), institution: r.fm_inst || r.u_inst || '', position: r.position || '', specialty: r.specialty || '',
                    city: r.location_city || '', country: r.location_country || r.fm_country || r.u_country || '', photo_url: r.fm_photo || r.u_photo || '',
                    member_since: r.membership_year || (r.approved_at || r.created_at ? Number(String(r.approved_at || r.created_at).slice(0, 4)) : null), program: 'forum' };
            }).filter(m => m.name);
            if (needle) members = members.filter(m => [m.name, m.institution, m.specialty, m.city, m.country].join(' ').toLowerCase().includes(needle));
            members.sort((a, b) => a.name.localeCompare(b.name));
            res.json({ ok: true, total: members.length, cap: CAP, members: members.slice(0, 200) });
        } catch (e) { fail(res, e, 'members-public'); }
    });

    // ---- admin: invitation codes (the Forum hub's SEND CODE / GENERATE A NEW CODE) ----
    // POST /api/v2/forum/invites {email?, name?, note?, expires_in_days?=30, expires_at?, send?=true}
    //   → mints FRM-XXXX-XXXX; with an email (and send !== false) it emails the personal invitation via ctx.sendEmail
    //     (dumped to EMAIL_DUMP_DIR on staging, Brevo in production).
    app.post('/api/v2/forum/invites', auth, adminOnly, async (req, res) => {
        try {
            const b = req.body || {};
            const email = clean(b.email, 160).toLowerCase();
            if (email && !validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address for the invitee.', code: 'email' });
            const days = b.expires_in_days == null ? 30 : parseInt(b.expires_in_days, 10);
            const expiresAt = clean(b.expires_at, 40) || (isNaN(days) ? null : new Date(Date.now() + days * 24 * 3600 * 1000).toISOString());
            const id = uuid(); const code = newCode(); const now = nowIso();
            q.run(`INSERT INTO v2_forum_invites (id, code, email, name, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, code, email || null, clean(b.name, 160) || null, clean(b.note, 300) || null, req.user.email || req.user.id, now, expiresAt]);
            let mail = null;
            if (email && b.send !== false) {
                mail = await emailInvite(req, { code, email, name: clean(b.name, 160), expires_at: expiresAt });
                q.run(`UPDATE v2_forum_invites SET sent_at = ?, send_count = send_count + 1 WHERE id = ?`, [now, id]);
            }
            persist();
            const invite = q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [id]);
            res.json({ ok: true, invite: publicInvite(invite), emailed: !!(mail && mail.emailed), email_mock: !!(mail && mail.mock), preview_url: mail ? mail.preview_url : null,
                message: mail ? (mail.emailed ? `Code ${code} emailed to ${email}.` : `Code ${code} minted — email delivery is off in this environment (logged).`) : `Code ${code} minted.` });
        } catch (e) { fail(res, e, 'invite create'); }
    });
    // GET /api/v2/forum/invites — newest first, with status open · used · expired
    app.get('/api/v2/forum/invites', auth, adminOnly, (req, res) => {
        try { res.json({ ok: true, invites: q.all(`SELECT * FROM v2_forum_invites ORDER BY datetime(created_at) DESC LIMIT 500`).map(publicInvite), members_count: memberCount(), cap: CAP }); }
        catch (e) { fail(res, e, 'invites list'); }
    });
    // POST /api/v2/forum/invites/:id/send {email?} — (re)send the personal invitation; an email given here is stored on the code
    app.post('/api/v2/forum/invites/:id/send', auth, adminOnly, async (req, res) => {
        try {
            const inv = q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [req.params.id]);
            if (!inv) return res.status(404).json({ error: 'Invitation not found.', code: 'unknown' });
            if (inviteStatus(inv) !== 'open') return res.status(409).json({ error: `That code is ${inviteStatus(inv)}.`, code: inviteStatus(inv) });
            const email = clean((req.body || {}).email, 160).toLowerCase() || inv.email;
            if (!validEmail(email || '')) return res.status(400).json({ error: 'Add the invitee\'s email address first.', code: 'email' });
            const name = clean((req.body || {}).name, 160) || inv.name;
            const mail = await emailInvite(req, { code: inv.code, email, name, expires_at: inv.expires_at });
            q.run(`UPDATE v2_forum_invites SET email = ?, name = ?, sent_at = ?, send_count = send_count + 1 WHERE id = ?`, [email, name || null, nowIso(), inv.id]); persist();
            res.json({ ok: true, invite: publicInvite(q.get(`SELECT * FROM v2_forum_invites WHERE id = ?`, [inv.id])), emailed: mail.emailed, email_mock: mail.mock, preview_url: mail.preview_url, message: mail.emailed ? `Invitation emailed to ${email}.` : 'Email delivery is off in this environment — the invitation was logged.' });
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

    log('forum: /api/v2/forum/{state,check-code,redeem-code,register,vote,nominate,feed,members-public,invites}');
};
