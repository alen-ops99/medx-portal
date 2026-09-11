/**
 * shared/meetups-core.js — the Plexus Week MEETUP domain: schema, placement, the waitlist, and
 * the cancel→promote transaction. ONE implementation, used by both backends.
 *
 * Why shared: the member portal cancels a place (portal button, or the cancel link in an email)
 * and the admin portal cancels a place (attendee drawer, cancelling a whole meetup) — against the
 * SAME rows in the SAME database. Two copies of "free the seat, promote the first person waiting,
 * renumber the rest" would drift, and the day they drift a table over-fills or a waitlist grows a
 * hole. There is exactly one copy, here, and both modules call it.
 *
 * Dependency-free and stateless: every function takes a query bag
 *   q = { run(sql, params), get(sql, params), all(sql, params) }
 * built from that backend's own db() wrapper, plus a `sign(kind, id)` HMAC minter for the tokens.
 *
 * Spec: design/MEETUPS-SPEC.md §2 (data) and §3 (behaviour).
 */
'use strict';

const crypto = require('crypto');

const KINDS = ['coffee', 'lunch', 'dinner', 'walk', 'visit', 'other'];
const VISIBILITIES = ['open', 'invite'];
const STATUSES = ['draft', 'published', 'cancelled', 'completed'];
const ATT_STATUSES = ['confirmed', 'waitlisted', 'cancelled', 'promoted', 'invited', 'declined'];
/** Statuses that occupy a place at the table. 'promoted' is kept for rows written before the
 *  single-status rule; the spec says a promoted person IS confirmed, with promoted_at set. */
const LIVE = ['confirmed', 'promoted'];

// DDL copied VERBATIM from design/MEETUPS-SPEC.md §2 — both portals declare it, whichever
// backend boots first creates the tables. Never a rename, never a drop.
const MEETUPS_DDL = [
    `CREATE TABLE IF NOT EXISTS plexus_meetups (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'coffee',
  description TEXT, audience TEXT,
  tags TEXT,
  venue_name TEXT, venue_address TEXT, venue_map_url TEXT,
  starts_at TEXT NOT NULL, ends_at TEXT,
  capacity INTEGER NOT NULL DEFAULT 8, waitlist_enabled INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open','invite')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled','completed')),
  host_user_id TEXT, host_name TEXT, host_title TEXT, host_email TEXT,
  host_token TEXT UNIQUE,
  created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
)`,
    `CREATE TABLE IF NOT EXISTS plexus_meetup_attendees (
  id TEXT PRIMARY KEY, meetup_id TEXT NOT NULL,
  user_id TEXT, first_name TEXT, last_name TEXT, email TEXT NOT NULL,
  institution TEXT, position TEXT, bio TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','waitlisted','cancelled','promoted','invited','declined')),
  waitlist_pos INTEGER, source TEXT,
  checked_in INTEGER DEFAULT 0, checked_in_at TEXT,
  manage_token TEXT UNIQUE,
  invited_at TEXT, confirmed_at TEXT, cancelled_at TEXT, promoted_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (meetup_id, email)
)`,
    `CREATE TABLE IF NOT EXISTS plexus_meetup_audit (id TEXT PRIMARY KEY, meetup_id TEXT, attendee_id TEXT, action TEXT, detail TEXT, actor TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    'CREATE INDEX IF NOT EXISTS idx_meetups_edition ON plexus_meetups (edition_id)',
    'CREATE INDEX IF NOT EXISTS idx_meetups_starts ON plexus_meetups (starts_at)',
    'CREATE INDEX IF NOT EXISTS idx_meetup_att_meetup ON plexus_meetup_attendees (meetup_id)',
    'CREATE INDEX IF NOT EXISTS idx_meetup_att_email ON plexus_meetup_attendees (email)',
    'CREATE INDEX IF NOT EXISTS idx_meetup_att_user ON plexus_meetup_attendees (user_id)',
    'CREATE INDEX IF NOT EXISTS idx_meetup_audit_meetup ON plexus_meetup_audit (meetup_id)'
];

function ensureSchema(q) {
    let ok = false;
    MEETUPS_DDL.forEach(sql => { try { q.run(sql); } catch (e) { /* exists, or the DB is not open yet */ } });
    try { ok = !!q.get("SELECT name FROM sqlite_master WHERE type='table' AND name='plexus_meetups'"); } catch (e) { ok = false; }
    return ok;
}

// ---------------------------------------------------------------- small pure helpers
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const nowIso = () => new Date().toISOString();
const fullName = (r) => [r && r.first_name, r && r.last_name].filter(Boolean).join(' ').trim() || (r && r.email) || 'Guest';
const shortCode = (id) => String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase();
const parseTags = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String).slice(0, 12) : []; } catch (e) { return []; } };
const splitName = (full) => {
    const parts = clean(full, 160).split(/\s+/).filter(Boolean);
    if (!parts.length) return { first_name: null, last_name: null };
    return { first_name: parts[0], last_name: parts.slice(1).join(' ') || null };
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// `starts_at` is stored as NAIVE Europe/Zagreb wall time ('2026-12-04T10:30') — the way an admin
// types it and the way the page and the .ics show it. Date.parse() would read that in the SERVER's
// timezone (UTC on Render, whatever the laptop says locally), which silently slides the 24-hour
// reminder window and the "already happened" guard by an hour or more. So convert explicitly.
// EU rule: CEST (UTC+2) from the last Sunday in March 02:00 local to the last Sunday in October
// 03:00 local; CET (UTC+1) otherwise.
function lastSundayUtc(year, monthIndex) {
    const d = new Date(Date.UTC(year, monthIndex + 1, 0));        // last day of that month
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());                 // walk back to Sunday
    return d;
}
/** Milliseconds since epoch for a Europe/Zagreb wall-clock stamp. NaN when unparseable. */
function zagrebMs(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return NaN;
    const y = +m[1];
    const wall = Date.UTC(y, +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    const dstFrom = lastSundayUtc(y, 2).getTime() + 2 * 3600 * 1000;   // last Sun March, 02:00 local
    const dstTo = lastSundayUtc(y, 9).getTime() + 3 * 3600 * 1000;     // last Sun October, 03:00 local
    const offsetH = (wall >= dstFrom && wall < dstTo) ? 2 : 1;
    return wall - offsetH * 3600 * 1000;
}
/** 'Friday, 4 December · 10:30–11:30' — the stored ISO is already Europe/Zagreb wall time. */
function whenLabel(startsAt, endsAt) {
    const m = String(startsAt || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const day = `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    if (!m[4]) return day;
    const e = String(endsAt || '').match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
    return `${day} · ${m[4]}:${m[5]}${e ? `–${e[1]}:${e[2]}` : ''}`;
}

// ---------------------------------------------------------------- reads
const meetupById = (q, id) => q.get('SELECT * FROM plexus_meetups WHERE id = ?', [String(id || '')]);
const attendeesOf = (q, mid) => q.all('SELECT * FROM plexus_meetup_attendees WHERE meetup_id = ? ORDER BY COALESCE(waitlist_pos, 0), created_at', [mid]) || [];
const liveOf = (q, mid) => attendeesOf(q, mid).filter(a => LIVE.includes(a.status));
const waitingOf = (q, mid) => attendeesOf(q, mid).filter(a => a.status === 'waitlisted')
    .sort((a, b) => (Number(a.waitlist_pos) || 9999) - (Number(b.waitlist_pos) || 9999) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
const confirmedCount = (q, mid) => liveOf(q, mid).length;

function audit(q, meetupId, attendeeId, action, detail, actor) {
    try {
        q.run('INSERT INTO plexus_meetup_audit (id, meetup_id, attendee_id, action, detail, actor) VALUES (?,?,?,?,?,?)',
            [crypto.randomUUID(), meetupId || null, attendeeId || null, String(action).slice(0, 60), clean(detail, 400) || null, clean(actor, 160) || null]);
    } catch (e) { /* audit is best-effort — it must never block a place */ }
}

// ---------------------------------------------------------------- the transaction
// BEGIN IMMEDIATE takes the write lock BEFORE the capacity read, so the read-then-write that
// decides "confirmed or waitlisted" is atomic. If the wrapper cannot begin (already inside a
// transaction, or a shim without it), the body still runs — Node is single-threaded and each
// handler runs to completion, so the invariants hold either way.
function tx(q, fn) {
    let began = false;
    try { q.run('BEGIN IMMEDIATE'); began = true; } catch (e) { began = false; }
    try {
        const out = fn();
        if (began) { try { q.run('COMMIT'); } catch (e) {} }
        return out;
    } catch (e) {
        if (began) { try { q.run('ROLLBACK'); } catch (e2) {} }
        throw e;
    }
}

function renumberWaitlist(q, mid) {
    waitingOf(q, mid).forEach((a, i) => {
        if (Number(a.waitlist_pos) !== i + 1) q.run('UPDATE plexus_meetup_attendees SET waitlist_pos = ? WHERE id = ?', [i + 1, a.id]);
    });
}

/**
 * Place one person on a meetup.
 *   placePerson({ q, sign }, meetup, person, source) → { status, attendee, already? }
 *   status ∈ 'confirmed' | 'waitlisted' | 'invited' | 'full'
 *
 * Idempotent: a live or already-waitlisted row comes back untouched (`already: true`). A row that
 * was cancelled or declined re-joins and goes to the BACK of the queue — never back to its old
 * position (spec §3: "a cancelled row can re-join (goes to the back)").
 *
 * Sends nothing. The caller mails AFTER the transaction commits, so a mail failure can never roll
 * back somebody's place.
 */
function placePerson(cx, m, person, source, opts) {
    const { q, sign } = cx;
    const o = opts || {};
    return tx(q, () => {
        const email = String(person.email || '').trim();
        const existing = q.get('SELECT * FROM plexus_meetup_attendees WHERE meetup_id = ? AND lower(email) = lower(?)', [m.id, email]);

        if (o.asInvited) {
            const when = nowIso();
            if (existing) {
                if (LIVE.includes(existing.status) || existing.status === 'waitlisted') return { status: existing.status, attendee: existing, already: true };
                q.run(`UPDATE plexus_meetup_attendees SET status = 'invited', waitlist_pos = NULL, invited_at = ?, cancelled_at = NULL,
                          first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), user_id = COALESCE(?, user_id),
                          institution = COALESCE(?, institution), position = COALESCE(?, position), source = 'email-invite'
                       WHERE id = ?`,
                    [when, person.first_name || null, person.last_name || null, person.user_id || null,
                     person.institution || null, person.position || null, existing.id]);
                ensureManageToken(cx, existing.id);
                audit(q, m.id, existing.id, 'invited', 're-invited', o.actor);
                return { status: 'invited', attendee: q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [existing.id]) };
            }
            const id = crypto.randomUUID();
            q.run(`INSERT INTO plexus_meetup_attendees (id, meetup_id, user_id, first_name, last_name, email, institution, position, bio, status, source, manage_token, invited_at)
                   VALUES (?,?,?,?,?,?,?,?,?,'invited','email-invite',?,?)`,
                [id, m.id, person.user_id || null, person.first_name || null, person.last_name || null, email,
                 person.institution || null, person.position || null, person.bio || null, sign('manage', id), when]);
            audit(q, m.id, id, 'invited', 'invitation queued', o.actor);
            return { status: 'invited', attendee: q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [id]) };
        }

        if (existing && LIVE.includes(existing.status)) return { status: existing.status, attendee: existing, already: true };
        if (existing && existing.status === 'waitlisted') return { status: 'waitlisted', attendee: existing, already: true };

        const live = confirmedCount(q, m.id);
        const cap = Number(m.capacity) || 0;
        const target = live < cap ? 'confirmed' : (Number(m.waitlist_enabled) === 1 ? 'waitlisted' : null);
        if (!target) return { status: 'full', attendee: existing || null };

        let pos = null;
        if (target === 'waitlisted') {
            const last = q.get("SELECT MAX(COALESCE(waitlist_pos,0)) AS p FROM plexus_meetup_attendees WHERE meetup_id = ? AND status = 'waitlisted'", [m.id]);
            pos = (Number(last && last.p) || 0) + 1;
        }
        const when = nowIso();

        if (existing) {
            q.run(`UPDATE plexus_meetup_attendees SET status = ?, waitlist_pos = ?, source = ?, user_id = COALESCE(?, user_id),
                      first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
                      institution = COALESCE(?, institution), position = COALESCE(?, position), bio = COALESCE(?, bio),
                      confirmed_at = CASE WHEN ? = 'confirmed' THEN ? ELSE confirmed_at END,
                      cancelled_at = NULL
                   WHERE id = ?`,
                [target, pos, source || existing.source || 'portal', person.user_id || null,
                 person.first_name || null, person.last_name || null,
                 person.institution || null, person.position || null, person.bio || null,
                 target, when, existing.id]);
            ensureManageToken(cx, existing.id);
            audit(q, m.id, existing.id, target === 'confirmed' ? 'rejoined' : 'waitlisted', `re-joined as ${target}`, o.actor || email);
            return { status: target, attendee: q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [existing.id]) };
        }

        const id = crypto.randomUUID();
        q.run(`INSERT INTO plexus_meetup_attendees
                  (id, meetup_id, user_id, first_name, last_name, email, institution, position, bio,
                   status, waitlist_pos, source, manage_token, invited_at, confirmed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, m.id, person.user_id || null, person.first_name || null, person.last_name || null, email,
             person.institution || null, person.position || null, person.bio || null,
             target, pos, source || 'portal', sign('manage', id),
             source === 'email-invite' ? when : null, target === 'confirmed' ? when : null]);
        audit(q, m.id, id, target === 'confirmed' ? 'joined' : 'waitlisted', `${target} via ${source || 'portal'}`, o.actor || email);
        return { status: target, attendee: q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [id]) };
    });
}

/**
 * Cancel one attendee and, in the SAME transaction, promote the first person waiting into the
 * freed place, then renumber the rest of the queue.
 *   cancelAndPromote({ q, sign }, meetup, attendee, actor) → { cancelled, promoted }
 *
 * Two cancels in a row therefore promote two DIFFERENT people, and the table can never over-fill:
 * the promote only fires while live < capacity, and the renumber leaves no gap behind. The
 * promoted row keeps the single status 'confirmed' with promoted_at stamped (spec §3).
 */
function cancelAndPromote(cx, m, attendee, actor) {
    const { q } = cx;
    return tx(q, () => {
        const row = q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [attendee.id]);
        if (!row || row.status === 'cancelled') return { cancelled: row || null, promoted: null, noop: true };
        const wasLive = LIVE.includes(row.status);
        q.run("UPDATE plexus_meetup_attendees SET status = 'cancelled', waitlist_pos = NULL, cancelled_at = ? WHERE id = ?", [nowIso(), row.id]);
        audit(q, m.id, row.id, 'cancelled', `cancelled by ${actor || row.email}`, actor || row.email);

        let promoted = null;
        if (wasLive && confirmedCount(q, m.id) < (Number(m.capacity) || 0)) {
            const next = waitingOf(q, m.id)[0];
            if (next) {
                const when = nowIso();
                q.run("UPDATE plexus_meetup_attendees SET status = 'confirmed', waitlist_pos = NULL, promoted_at = ?, confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?",
                    [when, when, next.id]);
                ensureManageToken(cx, next.id);
                promoted = q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [next.id]);
                audit(q, m.id, next.id, 'promoted', 'promoted from the waitlist', 'system');
            }
        }
        renumberWaitlist(q, m.id);
        return { cancelled: q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [row.id]), promoted };
    });
}

/** Force one waitlisted person up (admin action) — only while a place is actually free. */
function promoteOne(cx, m, attendee) {
    const { q } = cx;
    return tx(q, () => {
        const row = q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [attendee.id]);
        if (!row || row.status !== 'waitlisted') return { promoted: null, reason: 'not_waitlisted' };
        if (confirmedCount(q, m.id) >= (Number(m.capacity) || 0)) return { promoted: null, reason: 'full' };
        const when = nowIso();
        q.run("UPDATE plexus_meetup_attendees SET status = 'confirmed', waitlist_pos = NULL, promoted_at = ?, confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?", [when, when, row.id]);
        ensureManageToken(cx, row.id);
        audit(q, m.id, row.id, 'promoted', 'promoted by an organizer', 'admin');
        renumberWaitlist(q, m.id);
        return { promoted: q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [row.id]) };
    });
}

function ensureManageToken(cx, attendeeId) {
    const tok = cx.sign('manage', attendeeId);
    try { cx.q.run('UPDATE plexus_meetup_attendees SET manage_token = ? WHERE id = ?', [tok, attendeeId]); } catch (e) {}
    return tok;
}

/** Check one attendee in from a code ('m-<id>', a bare id, or a URL carrying one). */
function checkInByCode(cx, m, code) {
    const { q } = cx;
    const raw = String(code || '').trim();
    const idm = raw.match(/m-([0-9a-fA-F-]{8,64})/) || raw.match(/^([0-9a-fA-F-]{8,64})$/);
    if (!idm) return { ok: false, result: 'bad_code', message: 'That code is not a Med&X meetup code.' };
    const a = q.get('SELECT * FROM plexus_meetup_attendees WHERE id = ?', [idm[1]]);
    if (!a) return { ok: false, result: 'not_found', message: 'No place found for this code.' };
    if (m && String(a.meetup_id) !== String(m.id)) {
        return { ok: false, result: 'wrong_meetup', message: 'This code belongs to a different meetup.', person: personCard(a) };
    }
    const meetup = m || meetupById(q, a.meetup_id);
    if (!LIVE.includes(a.status)) return { ok: false, result: 'not_confirmed', message: `This place is ${a.status}, not confirmed.`, person: personCard(a), meetup: meetup || null };
    const already = Number(a.checked_in) === 1;
    if (!already) {
        q.run('UPDATE plexus_meetup_attendees SET checked_in = 1, checked_in_at = ? WHERE id = ?', [nowIso(), a.id]);
        audit(q, a.meetup_id, a.id, 'checked-in', 'scanner', cx.actor || 'scanner');
    }
    return {
        ok: true, result: already ? 'already' : 'checked_in',
        message: already ? 'Already checked in.' : 'Checked in.',
        person: personCard(a), meetup: meetup || null
    };
}

/** The host/door card: exactly what makes the "oh, you're a sleep researcher at Harvard" moment. */
function personCard(a) {
    return {
        id: a.id, name: fullName(a), email: a.email || null,
        institution: a.institution || null, position: a.position || null,
        bio: a.bio ? String(a.bio).slice(0, 400) : null,
        status: a.status, waitlist_pos: a.waitlist_pos || null,
        checked_in: Number(a.checked_in) === 1, checked_in_at: a.checked_in_at || null
    };
}

module.exports = {
    KINDS, VISIBILITIES, STATUSES, ATT_STATUSES, LIVE, MEETUPS_DDL,
    ensureSchema, tx,
    meetupById, attendeesOf, liveOf, waitingOf, confirmedCount,
    placePerson, cancelAndPromote, promoteOne, renumberWaitlist, ensureManageToken,
    checkInByCode, personCard, audit,
    esc, clean, validEmail, nowIso, fullName, shortCode, parseTags, splitName, whenLabel,
    zagrebMs, lastSundayUtc
};
