/**
 * shared/editions.js — Plexus Week EDITIONS: one table, one rollover rule, both portals.
 *
 * Owner's decision (design/MEETUPS-SPEC.md §1, Alen 2026-09-11):
 *   "in general Plexus Week and then we can choose 2026 and once it passes we archive it
 *    and then automatically we get 27."
 *
 * "Plexus Week" is the umbrella for Conference · Gala Evening · Building Bridges Zagreb ·
 * Meetups. Boston stays separate under Building Bridges and is NOT edition-scoped.
 *
 * WHY IT LIVES IN shared/ : the rollover has to be idempotent when BOTH backends run it (they
 * open the same Turso database). Two copies of the rule would drift the day one is edited; one
 * module required from both sides cannot. Dependency-free on purpose — like shared/db.js and
 * shared/wallet.js it resolves identically from either backend's node_modules.
 *
 * The caller supplies a tiny query bag `q = { run(sql, params), get(sql, params), all(sql, params) }`
 * built from that backend's own db() wrapper, so this module never opens a database itself.
 *
 * Existing tables (croatians_abroad_registrations, gala_registrations, registrations) are NOT
 * migrated — rows with no edition resolve through editionForDate(), which maps a created_at year
 * to the edition of that year (falling back to the active one).
 */
'use strict';

const SEED_ID = 'plexus-2026';
const SEED_YEAR = 2026;
const SEED_LABEL = 'Plexus Week 2026';
const SEED_START = '2026-12-03';
const SEED_END = '2026-12-06';
const SEED_CITY = 'Zagreb';

// DDL copied VERBATIM from design/MEETUPS-SPEC.md §1. Both portals share ONE database —
// CREATE TABLE IF NOT EXISTS, never a rename, never a drop.
const EDITIONS_DDL = `CREATE TABLE IF NOT EXISTS plexus_editions (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL,
  city TEXT DEFAULT 'Zagreb',
  starts_on TEXT, ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming','active','archived')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, archived_at TEXT
)`;

const STATUSES = ['upcoming', 'active', 'archived'];

// ---------------------------------------------------------------- date helpers (UTC, ISO dates)
const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function addDays(iso, n) {
    if (!isIsoDate(iso)) return null;
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
/** Same month/day, one year on. 29 Feb rolls to 28 Feb (Date would silently make it 1 Mar). */
function plusOneYear(iso) {
    if (!isIsoDate(iso)) return null;
    const y = Number(iso.slice(0, 4)) + 1, m = iso.slice(5, 7), d = iso.slice(8, 10);
    if (m === '02' && d === '29') return `${y}-02-28`;
    return `${y}-${m}-${d}`;
}
const todayIso = (now) => (now instanceof Date ? now : new Date(now || Date.now())).toISOString().slice(0, 10);

// ---------------------------------------------------------------- schema
function ensureSchema(q) {
    try { q.run(EDITIONS_DDL); } catch (e) { /* table exists, or the DB is not open yet */ }
    try { q.run('CREATE INDEX IF NOT EXISTS idx_plexus_editions_status ON plexus_editions (status)'); } catch (e) {}
}

// ---------------------------------------------------------------- reads
function listEditions(q) {
    try { return q.all('SELECT * FROM plexus_editions ORDER BY year DESC') || []; }
    catch (e) { return []; }
}
function getEdition(q, id) {
    if (!id) return null;
    try { return q.get('SELECT * FROM plexus_editions WHERE id = ?', [String(id)]) || null; }
    catch (e) { return null; }
}
function getEditionByYear(q, year) {
    try { return q.get('SELECT * FROM plexus_editions WHERE year = ?', [Number(year)]) || null; }
    catch (e) { return null; }
}
/** The one edition the portals write to. Exactly one row may be 'active'. */
function activeEdition(q) {
    try {
        return q.get("SELECT * FROM plexus_editions WHERE status = 'active' ORDER BY year DESC LIMIT 1")
            || q.get("SELECT * FROM plexus_editions WHERE status = 'upcoming' ORDER BY year LIMIT 1")
            || q.get('SELECT * FROM plexus_editions ORDER BY year DESC LIMIT 1')
            || null;
    } catch (e) { return null; }
}
/**
 * Legacy rows carry no edition_id. Treat a row as belonging to the edition of its created_at
 * year; if that year has no edition, fall back to the active one. NEVER migrates anything.
 */
function editionForDate(q, dateish) {
    const s = String(dateish || '');
    const y = Number(s.slice(0, 4));
    if (Number.isFinite(y) && y > 2000) {
        const hit = getEditionByYear(q, y);
        if (hit) return hit;
    }
    return activeEdition(q);
}

// ---------------------------------------------------------------- seed + rollover
function seed(q) {
    const existing = getEditionByYear(q, SEED_YEAR);
    if (existing) return existing;
    try {
        q.run(`INSERT INTO plexus_editions (id, year, label, city, starts_on, ends_on, status)
               VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [SEED_ID, SEED_YEAR, SEED_LABEL, SEED_CITY, SEED_START, SEED_END]);
    } catch (e) { /* another process seeded it first (UNIQUE year) */ }
    return getEditionByYear(q, SEED_YEAR);
}

/**
 * AUTO-ROLLOVER (spec §1): when `ends_on + 1 day` is already in the past and the edition is
 * still 'active' → archive it and make next year's edition active, minting it (same month/days,
 * +1 year, label 'Plexus Week <year+1>') when it does not exist yet. Admin edits the dates after.
 *
 * Idempotent by construction and safe to run from both backends on every boot:
 *   - the mint is keyed on the UNIQUE year, so a duplicate INSERT is swallowed;
 *   - an existing next-year row is activated instead of re-created;
 *   - once the active edition is still ahead, the loop does nothing at all.
 * Returns { archived: [...ids], created: [...ids], active: <row|null> }.
 */
function rollover(q, opts) {
    const o = opts || {};
    const today = todayIso(o.now);
    const out = { archived: [], created: [], active: null };
    for (let guard = 0; guard < 25; guard++) {
        const active = activeEdition(q);
        if (!active) break;
        if (String(active.status) !== 'active') break;
        const end = active.ends_on;
        if (!isIsoDate(end)) break;                       // undated edition never rolls by itself
        const dead = addDays(end, 1);
        if (!dead || !(dead < today)) break;              // still current (or ends today) → stop

        const nextYear = Number(active.year) + 1;
        let next = getEditionByYear(q, nextYear);
        if (!next) {
            const id = 'plexus-' + nextYear;
            try {
                q.run(`INSERT INTO plexus_editions (id, year, label, city, starts_on, ends_on, status)
                       VALUES (?, ?, ?, ?, ?, ?, 'upcoming')`,
                    [id, nextYear, 'Plexus Week ' + nextYear, active.city || SEED_CITY,
                     plusOneYear(active.starts_on), plusOneYear(active.ends_on)]);
                out.created.push(id);
            } catch (e) { /* the other backend minted it a millisecond earlier */ }
            next = getEditionByYear(q, nextYear);
        }
        if (!next) break;

        try {
            q.run("UPDATE plexus_editions SET status = 'archived', archived_at = ? WHERE id = ? AND status = 'active'",
                [new Date().toISOString(), active.id]);
            out.archived.push(active.id);
        } catch (e) { break; }
        try { q.run("UPDATE plexus_editions SET status = 'active', archived_at = NULL WHERE id = ?", [next.id]); }
        catch (e) { break; }
    }
    out.active = activeEdition(q);
    return out;
}

/** Boot call: schema + seed + rollover in one, never throwing. */
function bootstrap(q, opts) {
    try {
        ensureSchema(q);
        seed(q);
        return rollover(q, opts);
    } catch (e) {
        return { archived: [], created: [], active: null, error: e.message };
    }
}

/**
 * Activate one edition by id (admin action). Exactly one row stays 'active'; the previous
 * active edition is archived with a timestamp, matching what the rollover would have done.
 */
function activate(q, id) {
    const row = getEdition(q, id);
    if (!row) return null;
    try {
        q.run("UPDATE plexus_editions SET status = 'archived', archived_at = ? WHERE status = 'active' AND id <> ?",
            [new Date().toISOString(), row.id]);
        q.run("UPDATE plexus_editions SET status = 'active', archived_at = NULL WHERE id = ?", [row.id]);
    } catch (e) { return null; }
    return getEdition(q, id);
}

/** Public JSON shape — one place, so both portals answer identically. */
function toJson(row) {
    if (!row) return null;
    return {
        id: row.id,
        year: Number(row.year),
        label: row.label,
        city: row.city || SEED_CITY,
        starts_on: row.starts_on || null,
        ends_on: row.ends_on || null,
        status: row.status,
        archived_at: row.archived_at || null,
        created_at: row.created_at || null
    };
}

module.exports = {
    EDITIONS_DDL, STATUSES,
    SEED_ID, SEED_YEAR, SEED_LABEL, SEED_START, SEED_END, SEED_CITY,
    ensureSchema, seed, rollover, bootstrap, activate,
    listEditions, getEdition, getEditionByYear, activeEdition, editionForDate,
    toJson,
    // date helpers (exported for the tests' fake clock)
    addDays, plusOneYear, todayIso, isIsoDate
};
