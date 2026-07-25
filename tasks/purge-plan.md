# Backup-then-purge plan (from Audit A, 2026-07-25) — EXECUTE FROM THIS FILE

⚠ CRITICAL: most seeds re-arm on empty-table guards. The migration MUST set one app_state marker
`demo_purge_2026_07_25` AND convert/neutralize these guards to check that marker, or restarts
re-insert the fakes. Guard lines (admin server.js): refund_requests 10580, forum_members 8925,
accelerator_applications 10667, chat_messages 10615, chat_channels 8791, team_members 8831,
bridges_events 10200, finance_bank_balance 9007, pr_posts 9988, forum_candidates 5193,
content_checklist 6033, year_calendar_entries 8542. (user-portal has mirror blocks — same rule.)
Already marker-safe: contacts, bridges city migration, gala test wipes.

⚠ Both portals share ONE Turso DB. Before purging, COUNT each WHERE below in prod (via the
migration logging counts) — do not assume admin seeds ran there.

## Backup mechanism (inside the same migration, before every DELETE)
CREATE TABLE IF NOT EXISTS _purged_<table> AS SELECT * FROM <table> WHERE <same-where> — then DELETE.

## SAFE auto-purges (exact WHERE)
- visa_requests: registration_id IN ('reg-placeholder-3','reg-placeholder-4')
- refund_requests: registration_id IN ('reg-placeholder-1','reg-placeholder-2')
- registration_transfers: registration_id='reg-placeholder-7'
- scholarship_applications: user_id IS NULL AND created_at IN ('2026-01-15','2026-01-19') AND institution IN ('University of Zagreb School of Medicine','University of Split')
- speaker_applications: user_id IS NULL AND email IN ('tradic@unipu.hr','smaric@kbc-zagreb.hr')
- forum_candidates: email LIKE '%@example.org' OR '%@example.net' OR '%@example.com'
- finance ledger block: finance_invoice_items, finance_invoices, finance_transactions, finance_travel_orders, finance_payment_orders, finance_work_units, finance_bank_balance, finance_sequences (KEEP finance_fiscal_years) — verify no real rows first via counts/log
- pr_analytics: date IN ('2026-01-04','2026-01-11','2026-01-18','2026-01-25')
- pr_newsletters: name IN ('Plexus 2026 Launch','Speaker Announcement','Applications Open','Early Bird Reminder')
- pr_campaigns: start_date IN ('2026-01-01','2026-01-15','2026-02-01')
- pr_posts: published_at LIKE '2026-01-%'
- pr_content_calendar: scheduled_date IN ('2026-01-28','2026-01-30','2026-02-01','2026-02-05')
- task_sequences project='finances' (+ its sequence_steps)
- sessions: room IN ('Main Hall','Foyer','Room A','Room B','Restaurant','Exhibition Hall','Terrace','Grand Ballroom') AND title IN ('Opening Ceremony','Coffee Break & Networking','Neuroscience Track','Lunch Break','Panel: Future of AI in Medicine','Poster Session','Welcome Cocktail','Keynote: Immunotherapy Breakthroughs','Oncology Track','Cardiology Track','Closing Ceremony & Awards','Gala Dinner')
- sponsors: contact_email IS NULL AND amount_pledged IS NULL AND name IN ('Roche','Novartis','Pfizer','Johnson & Johnson','AstraZeneca','Medtronic','Boston Scientific')  ← fabricated sponsorships of REAL companies, reputational risk
- volunteers: user_id IS NULL AND email IN ('josip.matic@student.mef.hr','ivana.loncar@student.mef.hr','tomislav.brkic@student.mef.hr','marina.pavlovic@student.mef.hr','filip.radic@student.mef.hr')
- bridges fake events: city IN ('Zurich','Washington DC','Boston') AND contact_email='bridges@medx.hr' AND COALESCE(created_by,'')<>'seed' (+ their bridges_registrations first). ⚠ created_by='seed' marks REAL Plexus Week events — inverted intuition!
- feed_items (user): created_by='seed'
- opportunities (user): posted_by_user_id IS NULL AND title IN ('Research assistant — neuroscience lab','Visiting research fellowship','Call for abstracts — Plexus 2026','Travel grant — spend a summer in a lab abroad','Clinical research coordinator')
- talks: video_url='#placeholder' (keep is_sample=1 rows — honestly labelled)
- accelerator_sites: mentor_line LIKE '%Example%'
- mentorship_profiles: user_id IN (SELECT id FROM users WHERE email LIKE '%@test.medx.hr')

## MIXED — purge with exact identifiers (log counts, backup first)
- registrations (20 demo): user_id IS NULL AND ticket_qr_code IS NULL AND email IN (ana.kovacevic@mef.hr, marko.horvat@medri.uniri.hr, emma.schmidt@charite.de, luka.babic@mef.hr, sofia.rossi@unimi.it, ivan.juric@kbc-zagreb.hr, marie.dubois@inserm.fr, petra.novak@mef.hr, hans.mueller@tum.de, lucija.knezevic@mefst.hr, david.williams@oxford.ac.uk, mia.tomic@mef.hr, laura.garcia@ub.edu, sarah.mitchell@hms.harvard.edu, michael.chen@mdanderson.org, elena.rossi@novartis.com, james.thompson@nih.gov, helena.perkovic@mzss.hr, nikola.simic@kbc-split.hr, katarina.varga@semmelweis.hu)
- abstracts (6): submitter_id IS NULL AND submitter_email IN (ana.kovacevic@mef.hr, marko.horvat@medri.uniri.hr, emma.schmidt@charite.de, sofia.rossi@unimi.it, marie.dubois@inserm.fr, hans.mueller@tum.de)
- forum_members (14): user_id IS NULL AND email IN (helena.perkovic@mzss.hr, miroslav.radman@medils.hr, ivan.dikic@biophys.uni-frankfurt.de, ana.marusic@mefst.hr, davor.milicic@kbc-zagreb.hr, sinisa.volarevic@medri.uniri.hr, dragan.primorac@svkri.hr, bojan.polic@medri.uniri.hr, tihana.zanic@pbf.hr, igor.stagljar@utoronto.ca, marina.kolakovic@kbc-rijeka.hr, kristijan.dinjar@mef.hr, martina.lovric@svkri.hr, luka.cicin-sain@helmholtz-hzi.de)  ← real public figures, fabricated membership
- forum_events (3 titles 'Annual Biomedical Forum 2026*') — CHECK forum_event_registrations for real rows first; forum_posts (4 titles), forum_groups (4 names)
- accelerator_applications (5): created_at='2026-01-20' AND phone='+385 91 000 0000' AND email IN (luka.maric@mef.hr, ivana.brkic@medri.uniri.hr, mpetrovic@mf.uns.ac.rs, sara.novak@mef.unizg.hr, david.horvat@mefst.hr)
- chat_messages (15): created_at IN ('2026-01-06 09:00:00','2026-01-06 09:15:00','2026-01-06 09:22:00','2026-01-08 14:30:00','2026-01-08 14:45:00','2026-01-08 15:00:00','2026-01-10 10:00:00','2026-01-10 10:30:00','2026-01-12 11:00:00','2026-01-12 13:00:00','2026-01-15 16:00:00','2026-01-15 16:15:00','2026-01-18 09:30:00','2026-01-20 10:00:00','2026-01-31 17:00:00') AND kind IS NULL AND poll_id IS NULL
- pr_subscribers (12 exact): ana.kovac@gmail.com, marko.horvat@yahoo.com, john.smith@harvard.edu, elena.rossi@unimi.it, petra.novak@medri.uniri.hr, thomas.mueller@charite.de, maria.garcia@hospital.es, luka.babic@mef.hr, sophie.dubois@inserm.fr, david.johnson@mayo.edu, ivan.petrov@mail.ru, old.subscriber@gmail.com
- project_tasks (~29): COALESCE(created_by,'')='' AND parent_id IS NULL — count first
- team_members: delete ONLY invented Ivan Nikolic / Sara Bonet / Petra Horvat rows; FIX randomuser.me photos on the 3 real people (Alen/Miro/Laura)

## DO NOT PURGE
chat_channels (structural, real messages inside) · content_blocks (whitelist, breaks editor) ·
accelerator_programs/institutions/key_dates/criteria/interviewers (config; interviewers = real
Alen+Miro) · content_checklist (real to-dos; only the UI section is removed) ·
year_calendar_entries (real dates) · template_library · gala_registrations · croatians_abroad ·
page_views (REAL analytics — never seeded!) · speakers (clean) · advisor_reviews.

## Frontend literals no purge reaches
- Hardcoded milestones array index.html:17146-17153 (Zurich/Washington/Boston fakes; Forum date wrong twice over) — Alen wants milestones DELETED anyway; also feeds deadline pills 18341-48 + LiveOverview.deadline() 42856 → replace those with real project_settings dates
- randomuser.me stock photos on the six team members (server.js:8884-8893)

## Facts that change the plan
- Homepage Site Analytics is ALREADY REAL (page_views, first-party, DNT-honoring; writer in user portal, reader in admin — works because shared DB). Nothing to wire; the FABRICATED analytics are pr_analytics in the PR section (purged above).
- Executive Suite is well-engineered (cite-or-drop grounding, honest mock label). Needs: ANTHROPIC_API_KEY (Alen adding), purge (CMO pack reads 4 seeded tables), and schedule moved Monday → Friday 17:00 Zagreb per "end of every week".
- "Payments to chase" tile is REAL (abandoned gala checkouts). Speaker apps / scholarships / visas / refunds tiles = 100% seeded → after purge they read true zeros.
