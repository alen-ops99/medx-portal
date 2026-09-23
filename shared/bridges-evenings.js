'use strict';
/**
 * shared/bridges-evenings.js — ONE rule for "a Building Bridges evening that has been held" (2026-09-23).
 *
 * The member /app/bridges recap (user-portal/backend/v2/bridges.js › GET /api/v2/bridges/editions) and the
 * admin Bridges hub (admin-portal/backend/v2/bridges-ops.js › GET /api/v2/bridges/hub › past_evenings) read
 * the same bridges_events rows through this file, so "N evenings so far" cannot drift between the two sides.
 *
 * A held evening: a published bridges_events row dated before today that is a Building Bridges city —
 * Donor Night (slug 'donor-night') borrows a row for its guest list, cancelled rows never happened, and a
 * "[superseded] …" row is history kept for the record (the June Boston Symposium seed).
 * It joins the recap as the next edition until an admin enters it: a curated v2_bridges_editions row with
 * the same event_id, the same date, or — for the undated canonical rows — the same city (accents ignored,
 * so 'Zurich' folds onto 'Zürich').
 */

/** WHERE clause over bridges_events; bind [today] ('YYYY-MM-DD'). */
const HELD_EVENING_WHERE = `is_published = 1
    AND COALESCE(slug, '') <> 'donor-night'
    AND COALESCE(status, '') <> 'cancelled'
    AND COALESCE(name, '') NOT LIKE '[superseded]%'
    AND COALESCE(event_date, '') <> '' AND substr(event_date, 1, 10) < ?`;

const HELD_EVENINGS_SQL = `SELECT id, name, city, venue_name, event_date FROM bridges_events
    WHERE ${HELD_EVENING_WHERE} ORDER BY event_date ASC`;

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ymd = v => String(v || '').slice(0, 10);

/** True when a curated edition already stands for this evening. */
function coveredBy(editions, ev) {
    return (editions || []).some(ed => (ed.event_id && ed.event_id === ev.id)
        || (ed.event_date && ymd(ed.event_date) === ymd(ev.event_date))
        || (!ed.event_id && !ed.event_date && fold(ed.city) === fold(ev.city)));
}

/**
 * The held evenings no curated (published) edition covers yet, shaped like an edition and numbered after
 * the curated rows, oldest first. `evenings` = rows of HELD_EVENINGS_SQL. Nothing is invented: no guests,
 * photos or note until an admin enters the edition.
 */
function pastEvenings(curated, evenings) {
    let no = (curated || []).reduce((m, ed) => Math.max(m, Number(ed.edition_no) || 0), 0);
    return (evenings || []).filter(ev => ev.city && !coveredBy(curated, ev)).map(ev => ({
        id: 'event-' + ev.id, edition_no: ++no, city: ev.city, country: null, venue: ev.venue_name || null,
        event_date: ymd(ev.event_date), note: null, guests: null, connections: null, photos: [],
        photo_label: null, event_id: ev.id, updated_at: null
    }));
}

module.exports = { HELD_EVENING_WHERE, HELD_EVENINGS_SQL, coveredBy, pastEvenings, fold };
