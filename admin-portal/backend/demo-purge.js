// Demo-data purge — Alen's directive 2026-07-25: the portal must show REAL numbers only.
// Strategy: the legacy seed blocks re-arm on empty-table guards, so instead of fighting 12+
// guards we delete by EXACT fake identifiers on EVERY production boot (idempotent, self-healing:
// if a seed ever re-inserts, the next boot removes it again). First run copies each victim set
// into an in-DB _purged_<table> backup (restorable without credentials) and logs counts.
// Runs ONLY in production (RENDER env) — local scratch DBs keep demo data for testing.
// Inventory source: tasks/purge-plan.md (Audit A, 2026-07-25). Ambiguous tables are NOT touched:
// chat_channels, content_blocks, content_checklist, year_calendar_entries, accelerator config,
// gala_registrations, croatians_abroad_registrations, page_views, speakers, advisor_reviews.

'use strict';

const DEMO_REG_EMAILS = [
    'ana.kovacevic@mef.hr','marko.horvat@medri.uniri.hr','emma.schmidt@charite.de','luka.babic@mef.hr',
    'sofia.rossi@unimi.it','ivan.juric@kbc-zagreb.hr','marie.dubois@inserm.fr','petra.novak@mef.hr',
    'hans.mueller@tum.de','lucija.knezevic@mefst.hr','david.williams@oxford.ac.uk','mia.tomic@mef.hr',
    'laura.garcia@ub.edu','sarah.mitchell@hms.harvard.edu','michael.chen@mdanderson.org',
    'elena.rossi@novartis.com','james.thompson@nih.gov','helena.perkovic@mzss.hr',
    'nikola.simic@kbc-split.hr','katarina.varga@semmelweis.hu'
];

const DEMO_FORUM_EMAILS = [
    'helena.perkovic@mzss.hr','miroslav.radman@medils.hr','ivan.dikic@biophys.uni-frankfurt.de',
    'ana.marusic@mefst.hr','davor.milicic@kbc-zagreb.hr','sinisa.volarevic@medri.uniri.hr',
    'dragan.primorac@svkri.hr','bojan.polic@medri.uniri.hr','tihana.zanic@pbf.hr',
    'igor.stagljar@utoronto.ca','marina.kolakovic@kbc-rijeka.hr','kristijan.dinjar@mef.hr',
    'martina.lovric@svkri.hr','luka.cicin-sain@helmholtz-hzi.de'
];

const DEMO_CHAT_TIMES = [
    '2026-01-06 09:00:00','2026-01-06 09:15:00','2026-01-06 09:22:00','2026-01-08 14:30:00',
    '2026-01-08 14:45:00','2026-01-08 15:00:00','2026-01-10 10:00:00','2026-01-10 10:30:00',
    '2026-01-12 11:00:00','2026-01-12 13:00:00','2026-01-15 16:00:00','2026-01-15 16:15:00',
    '2026-01-18 09:30:00','2026-01-20 10:00:00','2026-01-31 17:00:00'
];

const DEMO_PR_SUBSCRIBERS = [
    'ana.kovac@gmail.com','marko.horvat@yahoo.com','john.smith@harvard.edu','elena.rossi@unimi.it',
    'petra.novak@medri.uniri.hr','thomas.mueller@charite.de','maria.garcia@hospital.es',
    'luka.babic@mef.hr','sophie.dubois@inserm.fr','david.johnson@mayo.edu',
    'ivan.petrov@mail.ru','old.subscriber@gmail.com'
];

const inList = (arr) => arr.map(() => '?').join(',');

// ---- Finance: the SEED SIGNATURE per table, never '1=1' (2026-09-22) ----
// Until today every finance table below was purged with '1=1' on every admin boot. The ledger was the
// first casualty (real Stripe income rows wiped within hours, see FINANCE_SEED_WHERE); the team is
// meant to use Finance for real invoices, travel orders, payment orders and work units, so each table
// now matches ONLY what the two portals' seed blocks insert. The discriminators, verified against
// both seed blocks and every real INSERT path in both server.js files:
//   created_by  — stamped (req.user.id) by every real Finance UI write to invoices, payment orders and
//                 bank balances; NULL on every seed row.
//   assigned_by — stamped by every real travel-order write; NULL on the seeds.
//   identifiers — the seed numbers (UR-/IR-2026-*, PUT-2026-*, PN-2026-*, RJ-*) AND, for work units
//                 (which carry no author column), the exact seed (code, name, grant_source) triple.
//   payment_method/reference — the webhook's ledger rows carry both; the seeds carry neither.
const FINANCE_SEED_WHERE = "payment_method IS NULL AND reference IS NULL AND created_by IS NULL AND date < '2026-02-01'";
const FINANCE_INVOICES_SEED_WHERE = "created_by IS NULL AND (invoice_number LIKE 'UR-2026-%' OR invoice_number LIKE 'IR-2026-%')";
const FINANCE_TRAVEL_SEED_WHERE = "assigned_by IS NULL AND order_number LIKE 'PUT-2026-%'";
const FINANCE_PAYMENT_ORDERS_SEED_WHERE = "created_by IS NULL AND order_number LIKE 'PN-2026-%'";
const FINANCE_BANK_SEED_WHERE = "created_by IS NULL AND date < '2026-02-01'";
// (code, name, grant_source) exactly as the user-portal and admin-portal seed blocks write them.
const FINANCE_WORK_UNIT_SEEDS = [
    ['RJ-2026-001', 'EU Horizon Grant', 'EU Horizon Europe'], ['RJ-2026-001', 'EU Horizon Grant - Plexus', 'EU Horizon Europe'],
    ['RJ-2026-002', 'Ministry of Science', 'MZOS Croatia'], ['RJ-2026-002', 'MZOS - Accelerator Program', 'MZOS Croatia'],
    ['RJ-2026-003', 'Corporate Sponsorship Pool', 'Various Sponsors'],
    ['RJ-2026-004', 'Biomedical Forum Endowment', 'Private Donors'], ['RJ-2026-005', 'EU Erasmus+ Mobility', 'EU Erasmus+'],
    ['RJ-2026-006', 'Building Bridges Program', 'MFA Croatia'], ['RJ-2025-001', 'EU Horizon Grant - 2025', 'EU Horizon Europe']
];
const FINANCE_WORK_UNITS_SEED_WHERE = '(' + FINANCE_WORK_UNIT_SEEDS.map(() => '(code = ? AND name = ? AND COALESCE(grant_source, \'\') = ?)').join(' OR ') + ')';
const FINANCE_WORK_UNITS_SEED_PARAMS = FINANCE_WORK_UNIT_SEEDS.flat();
const FINANCE_RESTORE_KEY = 'finance_ledger_restore_2026_09_22';

// Each entry: [table, whereSql, params]. Order matters (children before parents).
function purgeTargets() {
    return [
        // --- SAFE: pending-items demo rows (drove the fake chase tiles) ---
        ['visa_requests', "registration_id IN ('reg-placeholder-3','reg-placeholder-4')", []],
        ['refund_requests', "registration_id IN ('reg-placeholder-1','reg-placeholder-2')", []],
        ['registration_transfers', "registration_id = 'reg-placeholder-7'", []],
        ['scholarship_applications', "user_id IS NULL AND created_at IN ('2026-01-15','2026-01-19') AND institution IN ('University of Zagreb School of Medicine','University of Split')", []],
        ['speaker_applications', "user_id IS NULL AND email IN ('tradic@unipu.hr','smaric@kbc-zagreb.hr')", []],
        // --- Demo people/things across programs ---
        ['registrations', `user_id IS NULL AND ticket_qr_code IS NULL AND email IN (${inList(DEMO_REG_EMAILS)})`, DEMO_REG_EMAILS],
        ['abstracts', "submitter_id IS NULL AND submitter_email IN ('ana.kovacevic@mef.hr','marko.horvat@medri.uniri.hr','emma.schmidt@charite.de','sofia.rossi@unimi.it','marie.dubois@inserm.fr','hans.mueller@tum.de')", []],
        // forum_members has FK children — clear them first, scoped to the fake member set
        ['forum_group_members', `member_id IN (SELECT id FROM forum_members WHERE user_id IS NULL AND email IN (${inList(DEMO_FORUM_EMAILS)}))`, DEMO_FORUM_EMAILS],
        ['forum_mentorships', `mentor_id IN (SELECT id FROM forum_members WHERE user_id IS NULL AND email IN (${inList(DEMO_FORUM_EMAILS)})) OR mentee_id IN (SELECT id FROM forum_members WHERE user_id IS NULL AND email IN (${inList(DEMO_FORUM_EMAILS)}))`, [...DEMO_FORUM_EMAILS, ...DEMO_FORUM_EMAILS]],
        ['forum_member_badges', `member_id IN (SELECT id FROM forum_members WHERE user_id IS NULL AND email IN (${inList(DEMO_FORUM_EMAILS)}))`, DEMO_FORUM_EMAILS],
        ['forum_post_reactions', `member_id IN (SELECT id FROM forum_members WHERE user_id IS NULL AND email IN (${inList(DEMO_FORUM_EMAILS)}))`, DEMO_FORUM_EMAILS],
        ['forum_comments', `author_id IN (SELECT id FROM forum_members WHERE user_id IS NULL AND email IN (${inList(DEMO_FORUM_EMAILS)}))`, DEMO_FORUM_EMAILS],
        ['forum_event_registrations', "event_id IN (SELECT id FROM forum_events WHERE title IN ('Annual Biomedical Forum 2026','Annual Biomedical Forum 2026 — Day 1','Annual Biomedical Forum 2026 — Day 2'))", []],
        // posts/groups/events reference forum_members (author_id etc.) — they must go FIRST
        ['forum_posts', "title IN ('Welcome to the Biomedical Forum!','Upcoming: Annual Forum 2026','Research Collaboration Opportunity','New Publication Alert')", []],
        ['forum_groups', "name IN ('Cardiology Network','Research Methodology','Croatian Medical Diaspora','Young Leaders')", []],
        ['forum_events', "title IN ('Annual Biomedical Forum 2026','Annual Biomedical Forum 2026 — Day 1','Annual Biomedical Forum 2026 — Day 2') AND id NOT IN (SELECT DISTINCT event_id FROM forum_event_registrations WHERE event_id IS NOT NULL)", []],
        ['forum_members', `user_id IS NULL AND email IN (${inList(DEMO_FORUM_EMAILS)})`, DEMO_FORUM_EMAILS],
        ['forum_candidates', "email LIKE '%@example.org' OR email LIKE '%@example.net' OR email LIKE '%@example.com'", []],
        ['accelerator_applications', "created_at = '2026-01-20' AND phone = '+385 91 000 0000' AND email IN ('luka.maric@mef.hr','ivana.brkic@medri.uniri.hr','mpetrovic@mf.uns.ac.rs','sara.novak@mef.unizg.hr','david.horvat@mefst.hr')", []],
        ['chat_messages', `created_at IN (${inList(DEMO_CHAT_TIMES)}) AND poll_id IS NULL`, DEMO_CHAT_TIMES],
        ['sessions', "room IN ('Main Hall','Foyer','Room A','Room B','Restaurant','Exhibition Hall','Terrace','Grand Ballroom') AND title IN ('Opening Ceremony','Coffee Break & Networking','Neuroscience Track','Lunch Break','Panel: Future of AI in Medicine','Poster Session','Welcome Cocktail','Keynote: Immunotherapy Breakthroughs','Oncology Track','Cardiology Track','Closing Ceremony & Awards','Gala Dinner')", []],
        ['sponsors', "contact_email IS NULL AND amount_pledged IS NULL AND name IN ('Roche','Novartis','Pfizer','Johnson & Johnson','AstraZeneca','Medtronic','Boston Scientific')", []],
        ['volunteers', "user_id IS NULL AND email IN ('josip.matic@student.mef.hr','ivana.loncar@student.mef.hr','tomislav.brkic@student.mef.hr','marina.pavlovic@student.mef.hr','filip.radic@student.mef.hr')", []],
        // ⚠ real colleagues share these names (Ivan Nikolic, Sara Bonet are on the invite roster) —
        // demo rows are identified by NULL user_id + randomuser.me stock portrait, never name alone
        ['team_members', "name IN ('Ivan Nikolic','Sara Bonet','Petra Horvat') AND user_id IS NULL AND (photo_url LIKE '%randomuser.me%' OR photo_url IS NULL)", []],
        ['project_tasks', "COALESCE(created_by,'') = '' AND parent_id IS NULL", []],
        // Bridges events REMOVED from purge (2026-07-25 correction): the audit misclassified
        // them — the public site advertises Boston as the NEXT event and Zurich/Washington as
        // past ones. A restore migration in server.js brings back what the first purge removed.
        // --- Fabricated finance ledger (CFO advisor already excludes it) — SEED SIGNATURES ONLY.
        // Every line here was '1=1' until 2026-09-22 and wiped the REAL tables on every admin boot: the
        // ledger lost every Gala income row the member portal's Stripe webhook books (P-2026-005 …
        // P-2026-052, reference = the FIRA invoice number) within hours — they survived only in
        // _purged_finance_transactions (found by the Gala payment auditor). The other tables held only
        // seed rows so far; the first real invoice / travel order / work unit would have gone the same
        // way. See the FINANCE_*_SEED_WHERE constants for what marks a seed row.
        ['finance_invoice_items', `invoice_id IN (SELECT id FROM finance_invoices WHERE ${FINANCE_INVOICES_SEED_WHERE})`, []],
        ['finance_invoices', FINANCE_INVOICES_SEED_WHERE, []],
        ['finance_transactions', FINANCE_SEED_WHERE, []],
        ['finance_travel_orders', FINANCE_TRAVEL_SEED_WHERE, []],
        ['finance_payment_orders', FINANCE_PAYMENT_ORDERS_SEED_WHERE, []],
        ['finance_work_units', FINANCE_WORK_UNITS_SEED_WHERE, FINANCE_WORK_UNITS_SEED_PARAMS],
        ['finance_bank_balance', FINANCE_BANK_SEED_WHERE, []],
        ['sequence_steps', "sequence_id IN (SELECT id FROM task_sequences WHERE project='finances')", []],
        ['task_sequences', "project='finances'", []],
        // --- Fabricated PR dataset ---
        ['pr_analytics', "date IN ('2026-01-04','2026-01-11','2026-01-18','2026-01-25')", []],
        ['pr_newsletters', "name IN ('Plexus 2026 Launch','Speaker Announcement','Applications Open','Early Bird Reminder')", []],
        ['pr_campaigns', "start_date IN ('2026-01-01','2026-01-15','2026-02-01')", []],
        ['pr_posts', "published_at LIKE '2026-01-%'", []],
        ['pr_content_calendar', "scheduled_date IN ('2026-01-28','2026-01-30','2026-02-01','2026-02-05')", []],
        ['pr_subscribers', `email IN (${inList(DEMO_PR_SUBSCRIBERS)})`, DEMO_PR_SUBSCRIBERS],
        // --- User-portal seeds (shared DB, purge from either side) ---
        ['feed_items', "created_by='seed'", []],
        ['opportunities', "posted_by_user_id IS NULL AND title IN ('Research assistant — neuroscience lab','Visiting research fellowship','Call for abstracts — Plexus 2026','Travel grant — spend a summer in a lab abroad','Clinical research coordinator')", []],
        ['talks', "video_url='#placeholder'", []],
        ['accelerator_sites', "mentor_line LIKE '%Example%'", []],
        ['mentorship_profiles', "user_id IN (SELECT id FROM users WHERE email LIKE '%@test.medx.hr')", []],
    ];
}

// One-time repair for the '1=1' era: put the REAL ledger rows back from the in-DB backup (every
// row that is not a seed row). Marker-guarded in app_state so a row an admin later deletes on
// purpose is never resurrected by the next boot. Idempotent per row (INSERT OR IGNORE on the id).
function restoreRealFinanceRows(db, query) {
    try {
        if (query.get("SELECT 1 FROM app_state WHERE key = ?", [FINANCE_RESTORE_KEY])) return 0;
        const backup = query.get("SELECT name FROM sqlite_master WHERE type='table' AND name='_purged_finance_transactions'");
        if (!backup) { db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, datetime('now') || ' — no backup table')", [FINANCE_RESTORE_KEY]); return 0; }
        const cols = ['id', 'transaction_number', 'transaction_type', 'amount', 'date', 'description', 'project', 'work_unit_id', 'category', 'payment_method', 'reference', 'status', 'fiscal_year', 'created_by', 'created_at'];
        const have = new Set((query.all('PRAGMA table_info(_purged_finance_transactions)') || []).map(c => c.name));
        const use = cols.filter(c => have.has(c));
        const before = Number(query.get('SELECT COUNT(*) AS c FROM finance_transactions')?.c || 0);
        // work_unit_id is a FK to finance_work_units, which the purge also emptied — restore the row without it.
        const sel = use.map(c => c === 'work_unit_id' ? 'NULL' : c).join(', ');
        db.run(`INSERT OR IGNORE INTO finance_transactions (${use.join(', ')})
                SELECT ${sel} FROM _purged_finance_transactions WHERE NOT (${FINANCE_SEED_WHERE})`);
        const restored = Number(query.get('SELECT COUNT(*) AS c FROM finance_transactions')?.c || 0) - before;
        db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, datetime('now') || ' — restored ' || ?)", [FINANCE_RESTORE_KEY, String(restored)]);
        if (restored) console.log(`[DemoPurge] Restored ${restored} real finance_transactions row(s) from _purged_finance_transactions (the old '1=1' purge had removed them)`);
        return restored;
    } catch (e) {
        console.warn('[DemoPurge] finance ledger restore failed:', e.message);
        return 0;
    }
}

// Run the purge. Safe to call on every boot; only acts in production (or when forced for tests).
function runDemoPurge(db, query, saveDb, opts = {}) {
    const isProd = !!process.env.RENDER || process.env.NODE_ENV === 'production' || opts.force;
    if (!isProd) return { skipped: 'not production' };
    const results = [];
    let total = 0;
    const restored = restoreRealFinanceRows(db, query);
    if (restored) results.push(`finance_transactions_restored:${restored}`);
    for (const [table, where, params] of purgeTargets()) {
        try {
            const exists = query.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]);
            if (!exists) continue;
            const n = query.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, params)?.c || 0;
            if (!n) continue;
            // First-touch backup: snapshot the victim rows before deleting (restorable in-DB).
            // id-deduped so repeat runs (re-armed seeds, prior FK failures) never duplicate rows.
            db.run(`CREATE TABLE IF NOT EXISTS _purged_${table} AS SELECT * FROM ${table} WHERE 0`);
            try {
                db.run(`INSERT INTO _purged_${table} SELECT * FROM ${table} WHERE (${where}) AND id NOT IN (SELECT id FROM _purged_${table})`, params);
            } catch (dedupErr) {
                // table has no id column — back up without dedup rather than not at all
                db.run(`INSERT INTO _purged_${table} SELECT * FROM ${table} WHERE ${where}`, params);
            }
            db.run(`DELETE FROM ${table} WHERE ${where}`, params);
            results.push(`${table}:${n}`);
            total += n;
        } catch (e) {
            console.warn(`[DemoPurge] ${table} failed:`, e.message);
        }
    }
    // Stock randomuser.me portraits sit on REAL people too (Alen/Miro/Laura) — strip them so the
    // UI falls back to initials avatars instead of a stranger's face.
    try {
        const stock = query.get("SELECT COUNT(*) AS c FROM team_members WHERE photo_url LIKE '%randomuser.me%'")?.c || 0;
        if (stock) {
            db.run("UPDATE team_members SET photo_url = NULL WHERE photo_url LIKE '%randomuser.me%'");
            results.push(`team_photos_cleared:${stock}`);
        }
    } catch (e) {}
    if (total > 0 || results.length > 0) {
        try {
            db.run(`INSERT OR REPLACE INTO app_state (key, value) VALUES ('demo_purge_2026_07_25', datetime('now') || ' — ' || ?)`, [results.join(', ')]);
        } catch (e) {}
        if (saveDb) saveDb();
        console.log(`[DemoPurge] Removed ${total} demo rows (backed up to _purged_* tables): ${results.join(', ')}`);
    }
    return { purged: total, detail: results };
}

module.exports = {
    runDemoPurge, purgeTargets, restoreRealFinanceRows, FINANCE_RESTORE_KEY,
    FINANCE_SEED_WHERE, FINANCE_INVOICES_SEED_WHERE, FINANCE_TRAVEL_SEED_WHERE, FINANCE_PAYMENT_ORDERS_SEED_WHERE,
    FINANCE_BANK_SEED_WHERE, FINANCE_WORK_UNITS_SEED_WHERE, FINANCE_WORK_UNITS_SEED_PARAMS, FINANCE_WORK_UNIT_SEEDS
};
