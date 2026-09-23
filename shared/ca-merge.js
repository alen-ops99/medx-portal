'use strict';
/**
 * Merged /plexus registrations (2026-09-17).
 *
 * Fifteen people registered twice through the Zagreb form before the one-person-one-registration
 * guard landed (typically: first attempt sent to Stripe and abandoned, second attempt minutes later).
 * Each attempt emailed its own QR and we cannot know which one the guest kept — so a duplicate is
 * never cancelled. It is MERGED: `merged_into` points at the surviving row, its selected legs carry
 * the status 'merged' (which every count reads as "not live"), and anything that resolves a
 * registration by id — the doors, the ticket page, the wallet pass — follows the pointer so the
 * older QR still admits the same person, once, on the survivor's record.
 */

const MERGED = 'merged';
const MAX_HOPS = 4;

/** True when the row is a merged-away duplicate. */
function isMerged(row) { return !!(row && row.merged_into); }

/**
 * Follow `merged_into` to the surviving croatians_abroad_registrations row.
 * `get(sql, params)` is the caller's synchronous single-row reader. Returns the survivor (or the
 * row itself when it is not merged, or when the chain is broken).
 */
function followMerge(get, row) {
    let cur = row, hops = 0;
    while (cur && cur.merged_into && hops < MAX_HOPS) {
        let next = null;
        try { next = get('SELECT * FROM croatians_abroad_registrations WHERE id = ?', [cur.merged_into]); } catch (e) { next = null; }
        if (!next || next.id === cur.id) break;
        cur = next; hops++;
    }
    return cur;
}

/**
 * A /plexus leg (conference_status · bridges_status · gala_status) that counts as a REGISTRANT — ONE list for
 * every count (Today, the Plexus hub, Registrations, the Program editor used to disagree by the one held row).
 * Held ('pending-review', the review gate), cancelled and merged legs never count; case-blind.
 */
const LIVE_LEG = ['pre-registered', 'confirmed', 'registered'];
const isLiveLeg = (status) => LIVE_LEG.includes(String(status || '').trim().toLowerCase());
/** The same rule as SQL over a column, e.g. liveLegSql('c.conference_status'). */
const liveLegSql = (col) => `LOWER(TRIM(COALESCE(${col}, ''))) IN (${LIVE_LEG.map(s => `'${s}'`).join(', ')})`;

/** Guarded schema step for both backends' boot sequences. */
function ensureColumn(run) {
    try { run('ALTER TABLE croatians_abroad_registrations ADD COLUMN merged_into TEXT'); } catch (e) { /* exists */ }
}

module.exports = { MERGED, isMerged, followMerge, ensureColumn, LIVE_LEG, isLiveLeg, liveLegSql };
