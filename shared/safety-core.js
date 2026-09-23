/**
 * shared/safety-core.js — REPORT + BLOCK for member-generated content (App Store guideline 1.2).
 *
 * One source of truth for the two tables, their vocabulary and the "is this pair blocked?" check,
 * required by BOTH backends (both portals boot the SAME database):
 *   user-portal/backend/v2/safety.js       member routes  (report · block · unblock · my blocks)
 *   user-portal/backend/v2/network.js      directory / search / suggestions skip blocked pairs
 *   user-portal/backend/v2/messages.js     the blocker's inbox hides the thread; peer card knows
 *   user-portal/backend/server.js          POST /api/messages + POST /api/networking/connections refuse a blocked pair
 *   admin-portal/backend/v2/safety-ops.js  the operator's report queue + HIDE PROFILE
 *
 * Schema (v2_ prefix, idempotent, never renamed or dropped):
 *   v2_reports (id · reporter_user_id · target_kind 'member'|'message' · target_id (users.id or
 *               direct_messages.id) · target_user_id (the member behind it) · reason · note ≤ 500 ·
 *               status open|reviewed|actioned|dismissed · created_at · reviewed_by · reviewed_at · action_note ·
 *               evidence_text (≤ 1000 chars: the reported message, or the member's bio, AT REPORT TIME) ·
 *               evidence_meta (JSON {sender_name, sender_email, created_at, context:[≤ 10 earlier messages
 *               from the reported member to the reporter, {text, created_at}]}) — so the record survives the
 *               reported member deleting the message or the account)
 *   v2_blocks  (blocker_user_id · blocked_user_id · created_at · UNIQUE pair)
 * Moderation columns on shared tables (added here idempotently; the admin backend's safety-ops.js writes them):
 *   users.suspended_at · users.suspended_reason   SUSPEND: auth() answers 403, the member leaves every list
 *   users.moderation_hidden_at                    HIDE PROFILE: out of every people list; the member's own
 *                                                 directory toggle cannot undo it
 *   direct_messages.removed_at · removed_by       REMOVE MESSAGE: gone from every member-facing read; the admin still sees it
 *   users.deleted_email_hash                      on a CLOSED account that another member had blocked: a keyed hash of
 *                                                 its old address, so a new sign-up on that address inherits the blocks
 * Enum values are validated in code (no CHECK constraints — SQLite cannot alter one later).
 * Nothing here sends email or calls the network.
 */
'use strict';

const REASONS = ['spam', 'harassment', 'inappropriate', 'impersonation', 'other'];
const REASON_LABELS = { spam: 'Spam', harassment: 'Harassment', inappropriate: 'Inappropriate', impersonation: 'Impersonation', other: 'Other' };
const TARGET_KINDS = ['member', 'message'];
const STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'];
const NOTE_MAX = 500;
const DEDUPE_HOURS = 24;          // the same reporter + the same target inside this window → one report
const RATE_PER_HOUR = 10;         // reports one member may file per rolling hour
// Neutral wording for either side of a blocked pair — never says who blocked whom.
const BLOCKED_MESSAGE = 'You can’t message this member.';
const BLOCKED_CONNECT = 'You can’t connect with this member.';

const DDL = [
    `CREATE TABLE IF NOT EXISTS v2_reports (
        id TEXT PRIMARY KEY,
        reporter_user_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_user_id TEXT,
        reason TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_by TEXT,
        reviewed_at TEXT,
        action_note TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_v2_reports_status ON v2_reports (status, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_v2_reports_reporter ON v2_reports (reporter_user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_v2_reports_target ON v2_reports (target_user_id)',
    `CREATE TABLE IF NOT EXISTS v2_blocks (
        blocker_user_id TEXT NOT NULL,
        blocked_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (blocker_user_id, blocked_user_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_v2_blocks_blocked ON v2_blocks (blocked_user_id)'
];
// [table, column, type] — each ALTER on its own; "duplicate column" on a re-run is the expected no-op
const COLUMNS = [
    ['users', 'suspended_at', 'TEXT'], ['users', 'suspended_reason', 'TEXT'], ['users', 'moderation_hidden_at', 'TEXT'],
    ['users', 'deleted_email_hash', 'TEXT'],
    ['direct_messages', 'removed_at', 'TEXT'], ['direct_messages', 'removed_by', 'TEXT'],
    ['v2_reports', 'evidence_text', 'TEXT'], ['v2_reports', 'evidence_meta', 'TEXT']
];

// dbw = the sql.js-compatible wrapper (shared/db.js): run(sql[, params]) · prepare().bind().step().getAsObject().free()
function ensureSchema(dbw, log) {
    for (const sql of DDL) {
        try { dbw.run(sql); } catch (e) { if (log) log('safety schema: ' + e.message); }
    }
    for (const [table, col, type] of COLUMNS) {
        try { dbw.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (e) { /* column exists (or the table is not on this engine) */ }
    }
}

function rows(dbw, sql, params) {
    const st = dbw.prepare(sql);
    st.bind(params || []);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
}

// true when EITHER member blocked the other. Fails open to false (a missing table must never take
// messaging down) — the table is created at every mount, so that only happens on a broken boot.
function isBlockedPair(dbw, a, b) {
    a = String(a || ''); b = String(b || '');
    if (!a || !b || a === b) return false;
    try {
        return rows(dbw, `SELECT 1 AS x FROM v2_blocks
                           WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?)
                           LIMIT 1`, [a, b, b, a]).length > 0;
    } catch (e) { return false; }
}

// ids this member blocked (their own list)
function blockedByMe(dbw, userId) {
    try { return new Set(rows(dbw, 'SELECT blocked_user_id AS id FROM v2_blocks WHERE blocker_user_id = ?', [String(userId || '')]).map(r => r.id)); }
    catch (e) { return new Set(); }
}

// ids on the other side of any block that involves this member (either direction)
function blockedEitherWay(dbw, userId) {
    const me = String(userId || '');
    try {
        return new Set(rows(dbw, `SELECT blocked_user_id AS id FROM v2_blocks WHERE blocker_user_id = ?
                                  UNION SELECT blocker_user_id AS id FROM v2_blocks WHERE blocked_user_id = ?`, [me, me]).map(r => r.id));
    } catch (e) { return new Set(); }
}

// current addresses of the members this member blocked — legacy direct_messages rows key a member by email
function blockedEmailsByMe(dbw, userId) {
    try {
        return new Set(rows(dbw, `SELECT lower(u.email) AS e FROM v2_blocks b JOIN users u ON u.id = b.blocked_user_id
                                   WHERE b.blocker_user_id = ? AND u.email IS NOT NULL`, [String(userId || '')]).map(r => r.e).filter(Boolean));
    } catch (e) { return new Set(); }
}

// SQL fragment for a users-alias column: "no block between <col> and ?" — bind the viewer id twice.
const notBlockedSql = (col) => `NOT EXISTS (SELECT 1 FROM v2_blocks bl WHERE (bl.blocker_user_id = ? AND bl.blocked_user_id = ${col}) OR (bl.blocker_user_id = ${col} AND bl.blocked_user_id = ?))`;
// SQL fragment for a users ALIAS: may this account appear in a people list? (not closed, not suspended,
// not hidden by the Med&X team). No parameters.
const listableSql = (alias) => `${alias}.deleted_at IS NULL AND ${alias}.suspended_at IS NULL AND ${alias}.moderation_hidden_at IS NULL`;
// The same test for a bare user-id COLUMN on a table read without a users join (forum_members.user_id …):
// a NULL id (no linked account) passes. No parameters.
const listableIdSql = (col) => `NOT EXISTS (SELECT 1 FROM users lx WHERE lx.id = ${col}
    AND (lx.deleted_at IS NOT NULL OR lx.suspended_at IS NOT NULL OR lx.moderation_hidden_at IS NOT NULL))`;

// ---------------------------------------------------------------- moderation state of one account
function moderationOf(dbw, userId) {
    try {
        const r = rows(dbw, 'SELECT suspended_at, suspended_reason, moderation_hidden_at FROM users WHERE id = ?', [String(userId || '')])[0];
        return { suspended: !!(r && r.suspended_at), hidden: !!(r && r.moderation_hidden_at), suspended_reason: (r && r.suspended_reason) || null };
    } catch (e) { return { suspended: false, hidden: false, suspended_reason: null }; }
}
const SUSPENDED_MESSAGE = 'This account is suspended. Write to info@medx.hr.';

// ---------------------------------------------------------------- content filter (App Store 1.2, first bullet)
// A short, conservative list: slurs, explicit sexual solicitation, direct abuse and violent threats, in English
// and Croatian. Text is folded first (lower case, diacritics dropped, đ → d, apostrophes dropped, everything else
// that is not a letter or digit → one space) so "Ubit ću te" and "ubit cu te" read alike. Two more readings of the
// same text are checked: common character swaps undone ("n1gger", "k1ll", "$lut" → i / e / a / o / s), and runs of
// three or more single letters joined ("n i g g e r"). Whole words / phrases only — ordinary words that merely
// CONTAIN one of these never match. Deliberately left out: words with an innocent reading in a medical or
// bilingual community (first names such as Peder, Dick or Kike, "retard" in pharmacology, "kurva" as a plain
// interjection, "gole brojke" = raw numbers), and verbs with an everyday reading ("I'll shoot you an email",
// "this will hurt you in review", "I know where you work"). The filter refuses; it never rewrites or stores
// what was refused.
const THREAT_LEAD = '(i will|ill|im going to|i am going to|im gonna|i am gonna|gonna|i will find you and)';
const CONTENT_PATTERNS = [
    // slurs
    /\b(nigg(er|a)s?|faggots?|wetbacks?)\b/,
    /\b(pederu|pederi|pedercin[aeiou])\b/,
    // explicit sexual solicitation
    /\bsend (me )?(your |ur |some )?nudes?\b/, /\bnudes? (pics?|photos?)\b/, /\b(wanna|want to|lets) fuck\b/,
    /\bsuck my (dick|cock)\b/, /\bsit on my face\b/,
    /\bposalji (mi )?(svoje |tvoje )?(gole (slike|fotke|fotografije)|golu (sliku|fotku|fotografiju)|nudes?)\b/,
    /\bhoces (li )?(se )?jebat(i)?\b/, /\b(po)?pusi (mi )?kurac\b/,
    // direct abuse of the person written to
    /\bfuck (you|u|off)\b/, /\b(you|u|ur|youre|you are) (a |an )?(stupid |fucking |dumb |little )?(cunt|whore|slut|bitch|retard)s?\b/,
    /\bkys\b/, /\bgo (kill|hang) (yourself|urself)\b/,
    /\bjebem ti (mater|majku|sve)\b/, /\bjebi se\b/, /\bpicka ti materina\b/, /\bidi u (picku|kurac)\b/, /\bkurvo\b/, /\bpicko\b/,
    // violent threats
    new RegExp('\\b' + THREAT_LEAD + ' (kill|rape|stab) you\\b'),
    new RegExp('\\b' + THREAT_LEAD + ' (shoot|hurt) you (dead|if|when|in the (head|face|back)|so bad|badly)\\b'),
    /\bkill (yourself|urself)\b/, /\bi know where you live\b/,
    /\b(ubit|ubiti|zaklat|zaklati|silovat|silovati) cu te\b/, /\b(ubicu|zaklacu|silovacu) te\b/, /\bubij se\b/,
    /\bznam gdje (zivis|stanujes)\b/
];
// "shoot / hurt you" is a threat only when the clause ENDS there ("I'll shoot you." — "I'll shoot you an email"
// goes through). Checked on each clause of the text (split at . ! ? ; : , and line breaks).
const CLAUSE_END_PATTERNS = [
    new RegExp('\\b' + THREAT_LEAD + ' (shoot|hurt) you $')
];
function foldText(text) {
    return ' ' + String(text == null ? '' : text).toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
        .replace(/['’‘`´]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}
// the same folding after undoing common character swaps (1 → i, 3 → e, 4 → a, 0 → o, @ → a, $ → s, ! | → i)
const LEET = { '1': 'i', '3': 'e', '4': 'a', '0': 'o', '@': 'a', '$': 's', '!': 'i', '|': 'i' };
const unleet = (text) => String(text == null ? '' : text).toLowerCase().replace(/[1340@$!|]/g, c => LEET[c]);
// "n i g g e r" → "nigger": runs of three or more one-letter words are joined (a folded string in, one out)
function joinSpelled(folded) {
    const words = folded.trim().split(' ');
    const out = [];
    for (let i = 0; i < words.length;) {
        let j = i;
        while (j < words.length && words[j].length === 1) j++;
        if (j - i >= 3) { out.push(words.slice(i, j).join('')); i = j; }
        else { out.push(words[i]); i++; }
    }
    return ' ' + out.join(' ') + ' ';
}
function readings(text) {
    const set = new Set();
    for (const f of [foldText(text), foldText(unleet(text))]) { set.add(f); set.add(joinSpelled(f)); }
    return [...set];
}
// true when ANY of the given strings carries a listed word or phrase
function contentProblem(...texts) {
    for (const t of texts) {
        if (t == null || t === '') continue;
        if (Array.isArray(t)) { if (contentProblem(...t)) return true; continue; }
        const raw = String(t);
        if (readings(raw).some(f => CONTENT_PATTERNS.some(re => re.test(f)))) return true;
        const clauses = raw.split(/[.!?;:,\n\r]+/);
        if (clauses.length && clauses.some(c => readings(c).some(f => CLAUSE_END_PATTERNS.some(re => re.test(f))))) return true;
    }
    return false;
}
// Neutral wording: says what happened and where to turn, never names the word that matched.
const CONTENT_MESSAGE = 'This message could not be sent as written. Rephrase it, or write to info@medx.hr if that looks wrong.';
const CONTENT_PROFILE = 'Part of your profile could not be saved as written. Rephrase it, or write to info@medx.hr if that looks wrong.';

module.exports = {
    REASONS, REASON_LABELS, TARGET_KINDS, STATUSES, NOTE_MAX, DEDUPE_HOURS, RATE_PER_HOUR,
    BLOCKED_MESSAGE, BLOCKED_CONNECT, SUSPENDED_MESSAGE, CONTENT_MESSAGE, CONTENT_PROFILE,
    ensureSchema, isBlockedPair, blockedByMe, blockedEitherWay, blockedEmailsByMe, notBlockedSql,
    listableSql, listableIdSql, moderationOf, contentProblem, foldText
};
