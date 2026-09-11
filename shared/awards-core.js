/**
 * shared/awards-core.js — the PLEXUS GALA AWARDS domain: schema, the four seeded categories,
 * the intake window, word limits, entry placement, reviewer scoping and the ranking maths.
 * ONE implementation, used by both backends.
 *
 * Why shared (same reasoning as shared/meetups-core.js): the member backend writes entries and
 * scores from the public forms and the reviewer room, and the admin backend reads and decides on
 * the SAME rows in the SAME database. Two copies of "who may score what", "is the window open"
 * or "what is the mean with conflicts excluded" would drift, and the day they drift a reviewer
 * scores an entry they should never have seen, or a winner is picked on a number nobody can
 * reproduce. There is exactly one copy, here, and both modules call it.
 *
 * Dependency-free and stateless: every function takes a query bag
 *   q = { run(sql, params), get(sql, params), all(sql, params) }
 * built from that backend's own db() wrapper, plus a `sign(kind, id)` HMAC minter for the tokens.
 *
 * Spec: design/AWARDS-SPEC.md (data · public side · reviewer room · admin · non-negotiables).
 */
'use strict';

const crypto = require('crypto');
// Europe/Zagreb wall-clock → real instant. The awards windows are typed as naive Zagreb time
// ('2026-10-01T09:00') exactly like a meetup's starts_at, so the same converter decides both.
const { zagrebMs } = require('./meetups-core');

// ---------------------------------------------------------------- vocabulary
const INTAKES = ['none', 'nomination', 'application'];
const KINDS = ['nomination', 'self-nomination', 'application', 'organizer'];
const STATUSES = ['received', 'eligible', 'ineligible', 'shortlisted', 'winner', 'declined', 'withdrawn', 'pending-review'];
/** Statuses an entry can still be judged on. 'withdrawn' and 'pending-review' are out of the run. */
const LIVE_STATUSES = ['received', 'eligible', 'shortlisted', 'winner'];
const REVIEWER_STATUSES = ['invited', 'active', 'revoked'];
const LANGS = ['en', 'hr'];

const WORD_LIMITS = { statement: 400, challenge: 200, solution: 300, why_you: 100 };
const SCORE_MIN = 1, SCORE_MAX = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;   // one page, PDF only (spec)

// ---------------------------------------------------------------- DDL
// Copied from design/AWARDS-SPEC.md §Data, with the spec's own correction applied: the UNIQUE
// is per (category, nominee, nominator) so the SAME person may be nominated by several people
// and appear as ONE candidate with several nominations in the admin drawer. SQLite cannot put
// COALESCE() in a table-level UNIQUE, so the two normalized keys are stored on the row
// (nominee_key / nominator_key) and the uniqueness lives in a UNIQUE INDEX over them — same
// rule, visible in the data, and testable.
const AWARDS_DDL = [
    `CREATE TABLE IF NOT EXISTS award_categories (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, key TEXT NOT NULL,
  name TEXT NOT NULL, name_hr TEXT, citation TEXT, criteria_md TEXT, criteria_md_hr TEXT,
  intake TEXT NOT NULL CHECK (intake IN ('none','nomination','application')),
  allow_self INTEGER DEFAULT 1, laureates_max INTEGER DEFAULT 2,
  rubric_json TEXT,
  sort_order INTEGER, opens_at TEXT, closes_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  citation_hr TEXT, updated_at TEXT,
  UNIQUE (edition_id, key)
)`,
    `CREATE TABLE IF NOT EXISTS award_entries (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('nomination','self-nomination','application','organizer')),
  nominee_first TEXT, nominee_last TEXT, nominee_email TEXT, nominee_institution TEXT, nominee_position TEXT,
  nominee_country TEXT, nominee_birth_year INTEGER, nominee_links TEXT,
  nominator_name TEXT, nominator_email TEXT, nominator_relation TEXT,
  statement TEXT,
  challenge TEXT, solution TEXT, why_you TEXT,
  language TEXT DEFAULT 'en', school TEXT, study_year TEXT, willing_to_present INTEGER DEFAULT 0,
  attachment_key TEXT, attachment_name TEXT, attachment_size INTEGER,
  consent_publish INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','eligible','ineligible','shortlisted','winner','declined','withdrawn','pending-review')),
  gate_reason TEXT, source_ip_hash TEXT, user_id TEXT,
  decided_at TEXT, decided_by TEXT, notified_at TEXT, notify_kind TEXT,
  manage_token TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT,
  nominee_key TEXT, nominator_key TEXT, merged_into TEXT, admin_notes TEXT
)`,
    `CREATE TABLE IF NOT EXISTS award_reviewers (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  categories TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  invited_at TEXT, accepted_at TEXT, last_seen TEXT, status TEXT DEFAULT 'invited',
  UNIQUE (edition_id, email)
)`,
    `CREATE TABLE IF NOT EXISTS award_scores (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, reviewer_id TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  total INTEGER NOT NULL, comment TEXT, conflict INTEGER DEFAULT 0,
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT, UNIQUE (entry_id, reviewer_id)
)`,
    `CREATE TABLE IF NOT EXISTS award_laureates (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL, entry_id TEXT, name TEXT NOT NULL, institution TEXT,
  citation TEXT, photo_url TEXT, present_minutes INTEGER DEFAULT 0, gala_registration_id TEXT,
  slides_token TEXT, announced INTEGER DEFAULT 0, sort_order INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  email TEXT, presentation_confirmed INTEGER DEFAULT 0, presentation_confirmed_at TEXT,
  slides_key TEXT, slides_name TEXT, slides_size INTEGER, slides_uploaded_at TEXT
)`,
    `CREATE TABLE IF NOT EXISTS award_audit (id TEXT PRIMARY KEY, entry_id TEXT, category_id TEXT, action TEXT, detail TEXT, actor TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_award_entry_person ON award_entries (category_id, nominee_key, nominator_key)',
    'CREATE INDEX IF NOT EXISTS idx_award_entries_cat ON award_entries (category_id)',
    'CREATE INDEX IF NOT EXISTS idx_award_entries_status ON award_entries (status)',
    'CREATE INDEX IF NOT EXISTS idx_award_cats_edition ON award_categories (edition_id)',
    'CREATE INDEX IF NOT EXISTS idx_award_scores_entry ON award_scores (entry_id)',
    'CREATE INDEX IF NOT EXISTS idx_award_reviewers_edition ON award_reviewers (edition_id)',
    'CREATE INDEX IF NOT EXISTS idx_award_laureates_cat ON award_laureates (category_id)'
];

// Columns added after the first release land here — CREATE TABLE IF NOT EXISTS never alters an
// existing table, so a database that already carries the tables gets them this way. Additive only.
const AWARDS_ALTERS = [
    'ALTER TABLE award_categories ADD COLUMN citation_hr TEXT',
    'ALTER TABLE award_categories ADD COLUMN updated_at TEXT',
    'ALTER TABLE award_entries ADD COLUMN nominee_key TEXT',
    'ALTER TABLE award_entries ADD COLUMN nominator_key TEXT',
    'ALTER TABLE award_entries ADD COLUMN merged_into TEXT',
    'ALTER TABLE award_entries ADD COLUMN admin_notes TEXT',
    'ALTER TABLE award_laureates ADD COLUMN email TEXT',
    'ALTER TABLE award_laureates ADD COLUMN presentation_confirmed INTEGER DEFAULT 0',
    'ALTER TABLE award_laureates ADD COLUMN presentation_confirmed_at TEXT',
    'ALTER TABLE award_laureates ADD COLUMN slides_key TEXT',
    'ALTER TABLE award_laureates ADD COLUMN slides_name TEXT',
    'ALTER TABLE award_laureates ADD COLUMN slides_size INTEGER',
    'ALTER TABLE award_laureates ADD COLUMN slides_uploaded_at TEXT',
    'ALTER TABLE award_scores ADD COLUMN updated_at TEXT'
];

function ensureSchema(q) {
    let ok = false;
    AWARDS_DDL.forEach(sql => { try { q.run(sql); } catch (e) { /* exists, or the DB is not open yet */ } });
    AWARDS_ALTERS.forEach(sql => { try { q.run(sql); } catch (e) { /* already there */ } });
    try { ok = !!q.get("SELECT name FROM sqlite_master WHERE type='table' AND name='award_categories'"); } catch (e) { ok = false; }
    return ok;
}

// ---------------------------------------------------------------- small pure helpers
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const nowIso = () => new Date().toISOString();
const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();
const fullName = (r) => [r && (r.nominee_first || r.first_name), r && (r.nominee_last || r.last_name)].filter(Boolean).join(' ').trim()
    || (r && (r.nominee_email || r.email)) || 'Unnamed';
const splitName = (full) => {
    const parts = clean(full, 160).split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: null, last: null };
    return { first: parts[0], last: parts.slice(1).join(' ') || null };
};
/** Words, the way a person counts them: runs of non-whitespace. */
const wordCount = (v) => String(v == null ? '' : v).trim().split(/\s+/).filter(Boolean).length;
const withinWords = (v, max) => wordCount(v) <= Number(max || 0);

/** JSON array of links, http(s) only, at most six. */
function parseLinks(v) {
    let list = v;
    if (typeof v === 'string') {
        const s = v.trim();
        if (s.startsWith('[')) { try { list = JSON.parse(s); } catch (e) { list = s.split(/[\s,]+/); } }
        else list = s.split(/[\s,]+/);
    }
    if (!Array.isArray(list)) return [];
    return list.map(x => clean(x, 400)).filter(x => /^https?:\/\//i.test(x)).slice(0, 6);
}
const readLinks = (json) => { try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

/** The two normalized keys the uniqueness index is built on (spec's COALESCE correction). */
const nomineeKeyOf = (p) => lower(p.nominee_email) || (lower(p.nominee_first) + ' ' + lower(p.nominee_last)).trim() || 'unknown';
const nominatorKeyOf = (p) => (p.kind === 'nomination' ? (lower(p.nominator_email) || lower(p.nominator_name) || 'anonymous') : 'self');

// ---------------------------------------------------------------- the intake window
/**
 * 'before' · 'open' · 'closed' — from the category's own opens_at/closes_at, read as naive
 * Europe/Zagreb wall time. A category with no dates is always open; a category whose intake is
 * 'none' (Lifetime Bridge: the organizers choose) is never open to the public.
 */
function windowState(cat, now) {
    if (!cat) return 'closed';
    if (String(cat.intake) === 'none') return 'none';
    const t = (now === undefined ? Date.now() : (now instanceof Date ? now.getTime() : Number(now)));
    const o = zagrebMs(cat.opens_at), c = zagrebMs(cat.closes_at);
    if (Number.isFinite(o) && t < o) return 'before';
    if (Number.isFinite(c) && t > c) return 'closed';
    return 'open';
}
const isOpen = (cat, now) => windowState(cat, now) === 'open';

// ---------------------------------------------------------------- the four categories
// Seeded once per edition; every string is editable from the admin SETTINGS panel afterwards.
const RUBRIC_AWARD = [
    { key: 'achievement', label: 'Achievement', label_hr: 'Postignuće', desc: 'The substance of the work itself — what was actually done, and how well.' },
    { key: 'impact', label: 'Impact', label_hr: 'Učinak', desc: 'What changed because of it: for patients, for the field, for Croatia.' },
    { key: 'trajectory', label: 'Trajectory', label_hr: 'Putanja', desc: 'Where this is going — the next five years, not only the last five.' }
];
const RUBRIC_FELLOWSHIP = [
    { key: 'impact', label: 'Impact', label_hr: 'Učinak', desc: 'If it worked, who would be better off, and by how much.' },
    { key: 'originality', label: 'Originality', label_hr: 'Izvornost', desc: 'Is this their own thinking, or a familiar idea retold.' },
    { key: 'feasibility', label: 'Feasibility', label_hr: 'Izvedivost', desc: 'Could a student actually do this, with the time and hands they have.' }
];

const OPENS_AT = '2026-10-01T09:00';
const CLOSES_AT = '2026-11-01T23:59';

const SEED_CATEGORIES = [
    {
        key: 'lifetime-bridge', sort_order: 1, intake: 'none', allow_self: 0, laureates_max: 2,
        name: 'Med&X Lifetime Bridge Award',
        name_hr: 'Med&X nagrada Most za životno djelo',
        citation: 'for substantial contributions connecting Croatian medicine and science with the world',
        citation_hr: 'za izniman doprinos povezivanju hrvatske medicine i znanosti sa svijetom',
        criteria_md: 'The Lifetime Bridge Award is given to someone whose career has, over decades, carried Croatian medicine and science into the world and brought the world back to Croatia — through the laboratories they built, the people they trained, and the collaborations that outlasted them.\n\nThere is no public call for this one. The laureates are chosen by the organizers and announced at the Gala Evening on 5 December 2026.',
        criteria_md_hr: 'Nagrada Most za životno djelo dodjeljuje se osobi čija je karijera desetljećima nosila hrvatsku medicinu i znanost u svijet i svijet vraćala u Hrvatsku — kroz laboratorije koje je izgradila, ljude koje je odgojila i suradnje koje su je nadživjele.\n\nZa ovu nagradu nema javnog poziva. Laureate biraju organizatori, a objavljuju se na Gala večeri 5. prosinca 2026.',
        rubric: RUBRIC_AWARD
    },
    {
        key: 'excellence', sort_order: 2, intake: 'nomination', allow_self: 1, laureates_max: 2,
        name: 'Croatian Excellence in Medicine & Science Award',
        name_hr: 'Nagrada za hrvatsku izvrsnost u medicini i znanosti',
        citation: 'for outstanding international achievement in medicine or science',
        citation_hr: 'za izniman međunarodni doprinos u medicini ili znanosti',
        criteria_md: 'For a Croatian physician or scientist in the early or middle of their career — as a rule of thumb, under forty — whose work already stands up internationally: a body of research, a clinical programme, a technology or a company that colleagues elsewhere in the world have noticed and use.\n\nAnyone may nominate, and you may nominate yourself — a self-nomination is read exactly like any other. Tell us in no more than 400 words what this person did and why it matters.\n\nNominations open 1 October 2026 and close 1 November 2026. Decisions are made in November; the award is presented at the Gala Evening on 5 December 2026.',
        criteria_md_hr: 'Za hrvatskog liječnika ili znanstvenika na početku ili u sredini karijere — u pravilu do četrdesete — čiji rad već ima međunarodnu težinu: niz istraživanja, klinički program, tehnologiju ili tvrtku koju su kolege u svijetu primijetile i koriste.\n\nNominirati može svatko, a možete nominirati i sebe — samonominacija se čita jednako kao i svaka druga. Recite nam u najviše 400 riječi što je ta osoba napravila i zašto je to važno.\n\nNominacije su otvorene od 1. listopada do 1. studenoga 2026. Odluke se donose u studenome, a nagrada se uručuje na Gala večeri 5. prosinca 2026.',
        rubric: RUBRIC_AWARD
    },
    {
        key: 'rising-talent', sort_order: 3, intake: 'nomination', allow_self: 1, laureates_max: 2,
        name: 'Rising Talent Award',
        name_hr: 'Nagrada za talent u usponu',
        citation: 'for stepping well beyond the comfort zone, early',
        citation_hr: 'za iskorak daleko izvan zone udobnosti, i to rano',
        criteria_md: 'For Croatian medical students and young physicians or scientists who went further than the path in front of them asked — a first paper defended abroad, a project started with no budget, a summer in a laboratory that had never taken a Croatian student, an idea carried through the Med&X Accelerator and out the other side.\n\nAnyone may nominate, and you may nominate yourself. Four hundred words is plenty: tell us what they did, and what it cost them to do it.\n\nNominations open 1 October 2026 and close 1 November 2026. The award is presented at the Gala Evening on 5 December 2026.',
        criteria_md_hr: 'Za hrvatske studente medicine i mlade liječnike ili znanstvenike koji su otišli dalje nego što je put pred njima tražio — prvi rad obranjen u inozemstvu, projekt pokrenut bez ijedne kune, ljeto u laboratoriju koji nikada prije nije primio studenta iz Hrvatske, ideja pronesena kroz Med&X Accelerator i izašla s druge strane.\n\nNominirati može svatko, a možete nominirati i sebe. Četiristo riječi je sasvim dovoljno: recite nam što su napravili i koliko ih je to stajalo.\n\nNominacije su otvorene od 1. listopada do 1. studenoga 2026. Nagrada se uručuje na Gala večeri 5. prosinca 2026.',
        rubric: RUBRIC_AWARD
    },
    {
        key: 'fellowship', sort_order: 4, intake: 'application', allow_self: 1, laureates_max: 2,
        name: 'Plexus Fellowship',
        name_hr: 'Plexus stipendija',
        citation: 'for the most convincing idea a student brought us this year',
        citation_hr: 'za najuvjerljiviju ideju koju nam je ove godine donio student',
        criteria_md: 'Open to high-school students and medical students in Croatia. Bring us a problem in medicine or health you would like to solve, and a proposal for how you would go at it.\n\nThree fields, and a word limit on each so that thinking beats padding:\n\n· **The challenge** — 200 words. What is wrong, for whom, and how do you know.\n· **Your solution** — 300 words. What you would actually do.\n· **Why you** — 100 words. Why this is yours to try.\n\nYou may write in Croatian or in English — both are read by the same panel, and neither is at any advantage. One optional page as a PDF may be attached if a figure or a table says it better.\n\nTwo Fellows are chosen. Each receives a funded seat at the Gala Evening on 5 December 2026 and gives a three-minute presentation from the stage.\n\nApplications open 1 October 2026 and close 1 November 2026.',
        criteria_md_hr: 'Otvoreno za učenike srednjih škola i studente medicine u Hrvatskoj. Donesite nam problem u medicini ili zdravstvu koji biste htjeli riješiti i prijedlog kako biste mu pristupili.\n\nTri polja, sa zadanim brojem riječi, da razmišljanje bude važnije od opsega:\n\n· **Izazov** — 200 riječi. Što ne valja, kome i kako to znate.\n· **Vaše rješenje** — 300 riječi. Što biste zapravo napravili.\n· **Zašto vi** — 100 riječi. Zašto je ovo vaše da pokušate.\n\nMožete pisati na hrvatskom ili engleskom — isti panel čita oboje i nijedan jezik nema prednost. Neobavezno možete priložiti jednu stranicu u PDF-u ako slika ili tablica kaže više.\n\nBiraju se dva stipendista. Svaki dobiva plaćeno mjesto na Gala večeri 5. prosinca 2026. i tri minute na pozornici.\n\nPrijave su otvorene od 1. listopada do 1. studenoga 2026.',
        rubric: RUBRIC_FELLOWSHIP
    }
];

/** Idempotent seed for one edition. Never overwrites an admin's edit (INSERT only). */
function seedCategories(q, editionId) {
    const ed = String(editionId || '');
    if (!ed) return [];
    for (const c of SEED_CATEGORIES) {
        const existing = q.get('SELECT id FROM award_categories WHERE edition_id = ? AND key = ?', [ed, c.key]);
        if (existing) continue;
        try {
            q.run(`INSERT INTO award_categories
                     (id, edition_id, key, name, name_hr, citation, citation_hr, criteria_md, criteria_md_hr,
                      intake, allow_self, laureates_max, rubric_json, sort_order, opens_at, closes_at, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                ['awc-' + ed + '-' + c.key, ed, c.key, c.name, c.name_hr, c.citation, c.citation_hr,
                 c.criteria_md, c.criteria_md_hr, c.intake, c.allow_self, c.laureates_max,
                 JSON.stringify(c.rubric), c.sort_order,
                 c.intake === 'none' ? null : OPENS_AT, c.intake === 'none' ? null : CLOSES_AT, nowIso()]);
        } catch (e) { /* another process seeded it first (UNIQUE edition_id, key) */ }
    }
    return listCategories(q, ed);
}

// ---------------------------------------------------------------- reads
const listCategories = (q, editionId) =>
    q.all('SELECT * FROM award_categories WHERE edition_id = ? ORDER BY COALESCE(sort_order, 99), name', [String(editionId || '')]) || [];
const categoryById = (q, id) => q.get('SELECT * FROM award_categories WHERE id = ?', [String(id || '')]) || null;
const categoryByKey = (q, editionId, key) =>
    q.get('SELECT * FROM award_categories WHERE edition_id = ? AND key = ?', [String(editionId || ''), String(key || '')]) || null;
const entryById = (q, id) => q.get('SELECT * FROM award_entries WHERE id = ?', [String(id || '')]) || null;
const entriesOf = (q, categoryId) =>
    q.all('SELECT * FROM award_entries WHERE category_id = ? ORDER BY created_at', [String(categoryId || '')]) || [];
const scoresOf = (q, entryId) =>
    q.all('SELECT * FROM award_scores WHERE entry_id = ? ORDER BY submitted_at', [String(entryId || '')]) || [];
const laureatesOf = (q, categoryId) =>
    q.all('SELECT * FROM award_laureates WHERE category_id = ? ORDER BY COALESCE(sort_order, 99), created_at', [String(categoryId || '')]) || [];
const reviewersOf = (q, editionId) =>
    q.all('SELECT * FROM award_reviewers WHERE edition_id = ? ORDER BY name', [String(editionId || '')]) || [];

function rubricOf(cat) {
    try {
        const a = JSON.parse((cat && cat.rubric_json) || '[]');
        if (Array.isArray(a) && a.length) return a.slice(0, 5).map(r => ({
            key: String(r.key || '').slice(0, 40) || 'criterion',
            label: String(r.label || r.key || 'Criterion').slice(0, 60),
            label_hr: r.label_hr ? String(r.label_hr).slice(0, 60) : null,
            desc: r.desc ? String(r.desc).slice(0, 300) : null
        }));
    } catch (e) { /* fall through */ }
    return (cat && String(cat.key) === 'fellowship') ? RUBRIC_FELLOWSHIP : RUBRIC_AWARD;
}

function audit(q, entryId, categoryId, action, detail, actor) {
    try {
        q.run('INSERT INTO award_audit (id, entry_id, category_id, action, detail, actor) VALUES (?,?,?,?,?,?)',
            [crypto.randomUUID(), entryId || null, categoryId || null, String(action).slice(0, 60),
             clean(detail, 400) || null, clean(actor, 160) || null]);
    } catch (e) { /* audit is best-effort — it must never block a submission */ }
}

// ---------------------------------------------------------------- the transaction
// Same contract as shared/meetups-core.js: BEGIN IMMEDIATE takes the write lock before the read
// that a write depends on. A wrapper without transactions still runs the body — Node is
// single-threaded and each handler runs to completion, so the invariants hold either way.
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

// ---------------------------------------------------------------- validation
/**
 * validateEntry(cat, body) → { errors: [...], fields: {...} }
 * The ONE gate both the public form and any admin-side entry pass through. Word limits are
 * enforced here, in words, on the server — the live counters in the browser are a courtesy.
 */
function validateEntry(cat, body) {
    const b = body || {};
    const errors = [];
    const intake = String((cat && cat.intake) || 'nomination');
    const self = b.self === true || b.self === 'true' || b.self === 1 || b.self === '1' || b.self === 'on';
    const kind = intake === 'application' ? 'application' : (self ? 'self-nomination' : 'nomination');

    const first = clean(b.nominee_first || (b.nominee_name ? splitName(b.nominee_name).first : ''), 80);
    const last = clean(b.nominee_last || (b.nominee_name ? splitName(b.nominee_name).last : ''), 80);
    const email = clean(b.nominee_email, 200);
    const fields = {
        kind,
        nominee_first: first || null,
        nominee_last: last || null,
        nominee_email: email ? email.toLowerCase() : null,
        nominee_institution: clean(b.nominee_institution, 200) || null,
        nominee_position: clean(b.nominee_position, 200) || null,
        nominee_country: clean(b.nominee_country, 120) || null,
        nominee_birth_year: /^\d{4}$/.test(String(b.nominee_birth_year || '')) ? Number(b.nominee_birth_year) : null,
        nominee_links: JSON.stringify(parseLinks(b.nominee_links)),
        nominator_name: null, nominator_email: null, nominator_relation: null,
        statement: null, challenge: null, solution: null, why_you: null,
        language: LANGS.includes(String(b.language)) ? String(b.language) : 'en',
        school: clean(b.school, 200) || null,
        study_year: clean(b.study_year, 60) || null,
        willing_to_present: (b.willing_to_present === true || b.willing_to_present === 1 || ['1', 'true', 'on', 'yes'].includes(String(b.willing_to_present).toLowerCase())) ? 1 : 0,
        consent_publish: (b.consent_publish === true || b.consent_publish === 1 || ['1', 'true', 'on', 'yes'].includes(String(b.consent_publish).toLowerCase())) ? 1 : 0
    };

    if (!first) errors.push(intake === 'application' ? 'Please tell us your name.' : 'Please tell us who you are nominating.');
    if (email && !validEmail(email)) errors.push('That email address does not look right.');

    if (intake === 'application') {
        if (!validEmail(email)) errors.push('We need an email address to write back to you.');
        if (!fields.school) errors.push('Please tell us your school or university.');
        for (const [f, label] of [['challenge', 'The challenge'], ['solution', 'Your solution'], ['why_you', 'Why you']]) {
            const v = clean(b[f], 20000);
            if (!v) { errors.push(`${label} is empty — this one we do need.`); continue; }
            if (!withinWords(v, WORD_LIMITS[f])) errors.push(`${label} runs to ${wordCount(v)} words — the limit is ${WORD_LIMITS[f]}.`);
            fields[f] = v;
        }
        if (!fields.nominee_country) fields.nominee_country = 'Croatia';
    } else {
        const st = clean(b.statement, 20000);
        if (!st) errors.push('Tell us in a few sentences why this person — that part we cannot skip.');
        else if (!withinWords(st, WORD_LIMITS.statement)) errors.push(`Your statement runs to ${wordCount(st)} words — the limit is ${WORD_LIMITS.statement}.`);
        fields.statement = st || null;

        if (kind === 'self-nomination') {
            if (cat && Number(cat.allow_self) !== 1) errors.push('This award does not take self-nominations.');
            if (!validEmail(email)) errors.push('We need your email address so we can write back.');
        } else {
            const nname = clean(b.nominator_name, 160);
            const nemail = clean(b.nominator_email, 200);
            if (!nname) errors.push('Please tell us your name, so we know who is nominating.');
            if (!validEmail(nemail)) errors.push('Please give us an email address we can reply to.');
            fields.nominator_name = nname || null;
            fields.nominator_email = nemail ? nemail.toLowerCase() : null;
            fields.nominator_relation = clean(b.nominator_relation, 200) || null;
        }
    }
    if (!fields.consent_publish) errors.push('Please tick the consent box so we know we may name the laureate publicly.');

    fields.nominee_key = nomineeKeyOf(fields);
    fields.nominator_key = nominatorKeyOf(fields);
    return { errors, fields };
}

// ---------------------------------------------------------------- writing an entry
/**
 * createEntry({ q, sign }, category, fields, opts) → { entry, duplicate }
 *
 * Uniqueness is per (category, nominee, nominator): the same person nominated by three different
 * people is three rows and ONE candidate; the same nominator sending the same nominee twice is
 * the SAME row, updated, never a second one. A self-nomination and a third-party nomination of
 * the same person coexist (nominator_key 'self' vs the nominator's address).
 */
function createEntry(cx, cat, fields, opts) {
    const { q, sign } = cx;
    const o = opts || {};
    return tx(q, () => {
        const prior = q.get('SELECT * FROM award_entries WHERE category_id = ? AND nominee_key = ? AND nominator_key = ?',
            [cat.id, fields.nominee_key, fields.nominator_key]);
        if (prior) {
            // A second submission from the same nominator for the same person refreshes the text
            // rather than creating a twin — unless the row already went somewhere (decided,
            // withdrawn), in which case it is left exactly as it is.
            if (['winner', 'declined', 'withdrawn', 'ineligible'].includes(String(prior.status))) {
                return { entry: prior, duplicate: true, locked: true };
            }
            const cols = ['nominee_first', 'nominee_last', 'nominee_email', 'nominee_institution', 'nominee_position',
                'nominee_country', 'nominee_birth_year', 'nominee_links', 'nominator_name', 'nominator_email',
                'nominator_relation', 'statement', 'challenge', 'solution', 'why_you', 'language', 'school',
                'study_year', 'willing_to_present', 'consent_publish'];
            const set = cols.filter(c => fields[c] !== undefined);
            q.run(`UPDATE award_entries SET ${set.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`,
                set.map(c => fields[c]).concat([nowIso(), prior.id]));
            audit(q, prior.id, cat.id, 'resubmitted', 'the same person sent it again', o.actor);
            return { entry: entryById(q, prior.id), duplicate: true };
        }
        const id = crypto.randomUUID();
        const row = Object.assign({}, fields, {
            id, category_id: cat.id,
            status: o.status || 'received',
            gate_reason: o.gate_reason || null,
            source_ip_hash: o.source_ip_hash || null,
            user_id: o.user_id || null,
            manage_token: sign('manage', id),
            created_at: nowIso(), updated_at: nowIso()
        });
        const keys = Object.keys(row);
        q.run(`INSERT INTO award_entries (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => row[k]));
        audit(q, id, cat.id, 'received', `${row.kind} · ${row.status}`, o.actor || row.nominator_email || row.nominee_email);
        return { entry: entryById(q, id), duplicate: false };
    });
}

/** Withdraw one entry from its own manage page. Idempotent. */
function withdrawEntry(cx, entry, actor) {
    const { q } = cx;
    return tx(q, () => {
        const row = entryById(q, entry.id);
        if (!row) return { ok: false, reason: 'notfound' };
        if (row.status === 'withdrawn') return { ok: true, already: true, entry: row };
        if (['winner'].includes(String(row.status))) return { ok: false, reason: 'decided', entry: row };
        q.run("UPDATE award_entries SET status = 'withdrawn', updated_at = ? WHERE id = ?", [nowIso(), row.id]);
        audit(q, row.id, row.category_id, 'withdrawn', 'withdrawn from the public page', actor || row.nominator_email || row.nominee_email);
        return { ok: true, entry: entryById(q, row.id) };
    });
}

// ---------------------------------------------------------------- candidates (grouping)
/**
 * One CANDIDATE per nominee within a category, carrying every nomination of that person.
 * The admin drawer shows "nominated by 3 people" rather than three near-identical rows.
 * Withdrawn and merged-away rows never form a candidate of their own.
 */
function candidatesOf(q, categoryId, opts) {
    const o = opts || {};
    const rows = entriesOf(q, categoryId).filter(e => e.status !== 'withdrawn' && !e.merged_into);
    const by = new Map();
    for (const e of rows) {
        const key = String(e.nominee_key || nomineeKeyOf(e));
        if (!by.has(key)) {
            by.set(key, {
                key, category_id: categoryId,
                name: fullName(e), email: e.nominee_email || null,
                institution: e.nominee_institution || null, position: e.nominee_position || null,
                country: e.nominee_country || null, birth_year: e.nominee_birth_year || null,
                entries: [], nominators: [], self_nominated: false, status: e.status,
                first_seen: e.created_at || null
            });
        }
        const c = by.get(key);
        c.entries.push(e);
        if (e.kind === 'self-nomination' || e.kind === 'application') c.self_nominated = true;
        if (e.nominator_name || e.nominator_email) {
            c.nominators.push({ name: e.nominator_name || null, email: e.nominator_email || null, relation: e.nominator_relation || null, entry_id: e.id });
        }
        // The candidate wears the strongest status any of its rows carries.
        const rank = (s) => ['ineligible', 'received', 'pending-review', 'eligible', 'declined', 'shortlisted', 'winner'].indexOf(String(s));
        if (rank(e.status) > rank(c.status)) c.status = e.status;
        if (!c.institution && e.nominee_institution) c.institution = e.nominee_institution;
        if (!c.email && e.nominee_email) c.email = e.nominee_email;
    }
    const out = [...by.values()];
    out.forEach(c => { c.nominations = c.entries.length; c.lead_entry_id = c.entries[0].id; });
    if (o.withScores) out.forEach(c => { c.ranking = rankEntry(q, c.entries[0]); });
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// ---------------------------------------------------------------- ranking maths
/**
 * The one place a printed mean comes from. Conflict-flagged scores are EXCLUDED from every
 * number (they are shown separately, as a count) — a reviewer who declared a conflict has not
 * judged the entry, and letting their row into the mean would be exactly the thing the flag is
 * there to prevent. spread = max − min over the counted totals; n = how many counted.
 */
function rankScores(rows) {
    const all = Array.isArray(rows) ? rows : [];
    const counted = all.filter(s => Number(s.conflict) !== 1).map(s => Number(s.total)).filter(Number.isFinite);
    const conflicts = all.length - counted.length;
    if (!counted.length) return { n: 0, mean: null, min: null, max: null, spread: null, conflicts, total: all.length };
    const sum = counted.reduce((a, b) => a + b, 0);
    const min = Math.min(...counted), max = Math.max(...counted);
    return {
        n: counted.length,
        mean: Math.round((sum / counted.length) * 100) / 100,
        min, max, spread: max - min,
        conflicts, total: all.length
    };
}
const rankEntry = (q, entry) => rankScores(scoresOf(q, entry && entry.id));

/** A category's entries ordered by mean (highest first); unscored entries sink to the bottom. */
function rankingFor(q, categoryId) {
    const rows = entriesOf(q, categoryId).filter(e => LIVE_STATUSES.includes(String(e.status)) && !e.merged_into);
    return rows.map(e => ({ entry: e, ranking: rankEntry(q, e) }))
        .sort((a, b) => {
            const am = a.ranking.mean, bm = b.ranking.mean;
            if (am == null && bm == null) return String(a.entry.created_at).localeCompare(String(b.entry.created_at));
            if (am == null) return 1;
            if (bm == null) return -1;
            return bm - am || (b.ranking.n - a.ranking.n);
        });
}

// ---------------------------------------------------------------- reviewers
const reviewerCategories = (r) => { try { const a = JSON.parse((r && r.categories) || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch (e) { return []; } };
/** ABSOLUTE scoping: a reviewer token grants that reviewer's categories and nothing else. */
const reviewerMaySee = (reviewer, categoryId) => reviewerCategories(reviewer).includes(String(categoryId || ''));

/** The entries one reviewer may read, in a stable order, with their own score attached. */
function reviewerQueue(q, reviewer) {
    const out = [];
    for (const cid of reviewerCategories(reviewer)) {
        const cat = categoryById(q, cid);
        if (!cat) continue;
        const rows = entriesOf(q, cid)
            .filter(e => LIVE_STATUSES.includes(String(e.status)) && !e.merged_into)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        out.push({
            category: cat,
            rubric: rubricOf(cat),
            entries: rows.map(e => ({
                entry: e,
                mine: q.get('SELECT * FROM award_scores WHERE entry_id = ? AND reviewer_id = ?', [e.id, reviewer.id]) || null
            }))
        });
    }
    const flat = out.flatMap(g => g.entries);
    return { groups: out, total: flat.length, scored: flat.filter(x => x.mine).length };
}

/**
 * One score per (entry, reviewer): a second submission EDITS the first, never adds a row.
 * Every criterion must be an integer 1..5; total is their sum, computed here so no caller can
 * print a total the components do not add up to.
 */
function submitScore(cx, reviewer, entry, cat, body) {
    const { q } = cx;
    const b = body || {};
    const rubric = rubricOf(cat);
    const conflict = (b.conflict === true || b.conflict === 1 || ['1', 'true', 'on', 'yes'].includes(String(b.conflict).toLowerCase())) ? 1 : 0;
    const scores = {};
    const errors = [];
    if (!conflict) {
        for (const c of rubric) {
            const raw = (b.scores && b.scores[c.key] !== undefined) ? b.scores[c.key] : b[c.key];
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < SCORE_MIN || n > SCORE_MAX) { errors.push(`${c.label}: give it a score from ${SCORE_MIN} to ${SCORE_MAX}.`); continue; }
            scores[c.key] = n;
        }
    }
    if (errors.length) return { errors };
    const total = conflict ? 0 : Object.values(scores).reduce((a, n) => a + n, 0);
    const comment = clean(b.comment, 4000) || null;
    return tx(q, () => {
        const prior = q.get('SELECT * FROM award_scores WHERE entry_id = ? AND reviewer_id = ?', [entry.id, reviewer.id]);
        if (prior) {
            q.run('UPDATE award_scores SET scores_json = ?, total = ?, comment = ?, conflict = ?, updated_at = ? WHERE id = ?',
                [JSON.stringify(scores), total, comment, conflict, nowIso(), prior.id]);
            audit(q, entry.id, entry.category_id, 'score-updated', `${reviewer.email} · ${conflict ? 'conflict' : total}`, reviewer.email);
            return { score: q.get('SELECT * FROM award_scores WHERE id = ?', [prior.id]), edited: true };
        }
        const id = crypto.randomUUID();
        q.run('INSERT INTO award_scores (id, entry_id, reviewer_id, scores_json, total, comment, conflict, submitted_at) VALUES (?,?,?,?,?,?,?,?)',
            [id, entry.id, reviewer.id, JSON.stringify(scores), total, comment, conflict, nowIso()]);
        audit(q, entry.id, entry.category_id, 'scored', `${reviewer.email} · ${conflict ? 'conflict' : total}`, reviewer.email);
        return { score: q.get('SELECT * FROM award_scores WHERE id = ?', [id]), edited: false };
    });
}

// ---------------------------------------------------------------- decisions
/**
 * Set one entry's status. 'winner' additionally mints a laureate row — ONCE, keyed on entry_id,
 * so clicking "Choose as winner" twice never creates two laureates or two gala seats.
 */
function setStatus(cx, entry, status, actor, opts) {
    const { q } = cx;
    const o = opts || {};
    if (!STATUSES.includes(String(status))) return { error: 'unknown status' };
    return tx(q, () => {
        const row = entryById(q, entry.id);
        if (!row) return { error: 'notfound' };
        const cat = categoryById(q, row.category_id);
        if (status === 'winner' && cat) {
            const already = q.get("SELECT COUNT(*) AS n FROM award_laureates WHERE category_id = ? AND entry_id IS NOT NULL AND entry_id <> ?", [cat.id, row.id]);
            const max = Number(cat.laureates_max) || 2;
            if ((Number(already && already.n) || 0) >= max && row.status !== 'winner') {
                return { error: `This award already has ${max} laureate${max === 1 ? '' : 's'} — decline one first.` };
            }
        }
        q.run('UPDATE award_entries SET status = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE id = ?',
            [status, nowIso(), clean(actor, 160) || 'admin', nowIso(), row.id]);
        audit(q, row.id, row.category_id, 'status:' + status, o.reason || '', actor);
        let laureate = null;
        if (status === 'winner') laureate = ensureLaureate(cx, cat, entryById(q, row.id), actor);
        return { entry: entryById(q, row.id), laureate };
    });
}

/** Find-or-create the laureate row for a winning entry. Exactly one per entry, ever. */
function ensureLaureate(cx, cat, entry, actor) {
    const { q, sign } = cx;
    const existing = q.get('SELECT * FROM award_laureates WHERE entry_id = ?', [entry.id]);
    if (existing) return existing;
    const id = crypto.randomUUID();
    q.run(`INSERT INTO award_laureates (id, category_id, entry_id, name, institution, citation, email,
                                        present_minutes, slides_token, sort_order, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, cat.id, entry.id, fullName(entry), entry.nominee_institution || null,
         cat.citation || null, entry.nominee_email || null,
         String(cat.key) === 'fellowship' ? 3 : 0, sign('slides', id),
         (laureatesOf(q, cat.id).length || 0) + 1, nowIso()]);
    audit(q, entry.id, cat.id, 'laureate-created', fullName(entry), actor);
    return q.get('SELECT * FROM award_laureates WHERE id = ?', [id]);
}

/** The Lifetime Bridge path: a laureate with no entry behind it (the organizers chose). */
function addLaureate(cx, cat, body, actor) {
    const { q, sign } = cx;
    const name = clean(body && body.name, 160);
    if (!name) return { error: 'A name is needed.' };
    const max = Number(cat.laureates_max) || 2;
    if (laureatesOf(q, cat.id).length >= max) return { error: `This award already has ${max} laureate${max === 1 ? '' : 's'}.` };
    const id = crypto.randomUUID();
    q.run(`INSERT INTO award_laureates (id, category_id, entry_id, name, institution, citation, photo_url, email,
                                        present_minutes, slides_token, sort_order, created_at)
           VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?)`,
        [id, cat.id, name, clean(body.institution, 200) || null,
         clean(body.citation, 600) || cat.citation || null, clean(body.photo_url, 500) || null,
         clean(body.email, 200) || null, Number(body.present_minutes) || 0, sign('slides', id),
         laureatesOf(q, cat.id).length + 1, nowIso()]);
    audit(q, null, cat.id, 'laureate-added', name, actor);
    return { laureate: q.get('SELECT * FROM award_laureates WHERE id = ?', [id]) };
}

/**
 * Merge one candidate's entries into another (the same person typed two ways). The losing rows
 * keep their text — they become extra NOMINATIONS of the surviving nominee, which is exactly
 * what a duplicate is — and stop forming a candidate of their own.
 */
function mergeCandidates(cx, categoryId, fromKey, intoKey, actor) {
    const { q } = cx;
    if (!fromKey || !intoKey || String(fromKey) === String(intoKey)) return { error: 'Pick two different candidates.' };
    return tx(q, () => {
        const target = entriesOf(q, categoryId).find(e => String(e.nominee_key) === String(intoKey));
        if (!target) return { error: 'That candidate is not in this award.' };
        const losing = entriesOf(q, categoryId).filter(e => String(e.nominee_key) === String(fromKey));
        if (!losing.length) return { error: 'That candidate is not in this award.' };
        let moved = 0;
        for (const e of losing) {
            // Re-key onto the surviving nominee. If the same nominator already has a row there,
            // this one is parked (merged_into) instead, so the unique index is never violated.
            const clash = q.get('SELECT id FROM award_entries WHERE category_id = ? AND nominee_key = ? AND nominator_key = ? AND id <> ?',
                [categoryId, String(intoKey), String(e.nominator_key), e.id]);
            if (clash) {
                q.run('UPDATE award_entries SET merged_into = ?, updated_at = ? WHERE id = ?', [clash.id, nowIso(), e.id]);
            } else {
                q.run(`UPDATE award_entries SET nominee_key = ?, nominee_first = ?, nominee_last = ?,
                          nominee_email = COALESCE(nominee_email, ?), merged_into = NULL, updated_at = ? WHERE id = ?`,
                    [String(intoKey), target.nominee_first, target.nominee_last, target.nominee_email, nowIso(), e.id]);
            }
            moved++;
        }
        audit(q, target.id, categoryId, 'merged', `${moved} row(s) from ${fromKey} into ${intoKey}`, actor);
        return { moved, into: String(intoKey) };
    });
}

// ---------------------------------------------------------------- shaping
function categoryJson(q, cat, opts) {
    const o = opts || {};
    const rows = entriesOf(q, cat.id).filter(e => !e.merged_into);
    const count = (s) => rows.filter(e => e.status === s).length;
    return {
        id: cat.id, edition_id: cat.edition_id, key: cat.key,
        name: cat.name, name_hr: cat.name_hr || null,
        citation: cat.citation || null, citation_hr: cat.citation_hr || null,
        criteria_md: cat.criteria_md || null, criteria_md_hr: cat.criteria_md_hr || null,
        intake: cat.intake, allow_self: Number(cat.allow_self) === 1,
        laureates_max: Number(cat.laureates_max) || 2,
        rubric: rubricOf(cat), sort_order: Number(cat.sort_order) || 99,
        opens_at: cat.opens_at || null, closes_at: cat.closes_at || null,
        window: windowState(cat, o.now),
        counts: {
            entries: rows.length,
            candidates: candidatesOf(q, cat.id).length,
            received: count('received'), eligible: count('eligible'), ineligible: count('ineligible'),
            shortlisted: count('shortlisted'), winner: count('winner'), declined: count('declined'),
            pending_review: count('pending-review'), withdrawn: entriesOf(q, cat.id).filter(e => e.status === 'withdrawn').length
        },
        laureates: laureatesOf(q, cat.id).length
    };
}

function entryJson(e, opts) {
    const o = opts || {};
    return {
        id: e.id, category_id: e.category_id, kind: e.kind, status: e.status,
        name: fullName(e),
        nominee_first: e.nominee_first || null, nominee_last: e.nominee_last || null,
        nominee_email: o.redactEmail ? null : (e.nominee_email || null),
        nominee_institution: e.nominee_institution || null, nominee_position: e.nominee_position || null,
        nominee_country: e.nominee_country || null, nominee_birth_year: e.nominee_birth_year || null,
        links: readLinks(e.nominee_links),
        // The reviewer room never sees who nominated whom (spec: "anonymised nominator").
        nominator: o.anonymiseNominator ? null : {
            name: e.nominator_name || null, email: e.nominator_email || null, relation: e.nominator_relation || null
        },
        statement: e.statement || null,
        challenge: e.challenge || null, solution: e.solution || null, why_you: e.why_you || null,
        language: e.language || 'en', school: e.school || null, study_year: e.study_year || null,
        willing_to_present: Number(e.willing_to_present) === 1,
        attachment: e.attachment_key ? { name: e.attachment_name || 'attachment.pdf', size: Number(e.attachment_size) || 0 } : null,
        consent_publish: Number(e.consent_publish) === 1,
        gate_reason: o.redactGate ? null : (e.gate_reason || null),
        created_at: e.created_at || null, updated_at: e.updated_at || null,
        decided_at: e.decided_at || null, decided_by: o.redactGate ? null : (e.decided_by || null),
        notified_at: e.notified_at || null, notify_kind: e.notify_kind || null,
        merged_into: e.merged_into || null,
        admin_notes: o.redactGate ? null : (e.admin_notes || null)
    };
}

module.exports = {
    // vocabulary
    INTAKES, KINDS, STATUSES, LIVE_STATUSES, REVIEWER_STATUSES, LANGS,
    WORD_LIMITS, SCORE_MIN, SCORE_MAX, MAX_ATTACHMENT_BYTES,
    AWARDS_DDL, AWARDS_ALTERS, SEED_CATEGORIES, RUBRIC_AWARD, RUBRIC_FELLOWSHIP, OPENS_AT, CLOSES_AT,
    // schema + seed
    ensureSchema, seedCategories,
    // reads
    listCategories, categoryById, categoryByKey, entryById, entriesOf, scoresOf, laureatesOf, reviewersOf,
    rubricOf, candidatesOf, rankingFor, rankScores, rankEntry,
    reviewerCategories, reviewerMaySee, reviewerQueue,
    // writes
    tx, audit, validateEntry, createEntry, withdrawEntry, submitScore, setStatus,
    ensureLaureate, addLaureate, mergeCandidates,
    // shaping + helpers
    categoryJson, entryJson,
    esc, clean, lower, validEmail, nowIso, fullName, splitName, wordCount, withinWords,
    parseLinks, readLinks, nomineeKeyOf, nominatorKeyOf, windowState, isOpen, zagrebMs
};
