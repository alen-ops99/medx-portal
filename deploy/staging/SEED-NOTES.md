# Staging seed — scrub notes (built 2026-08-28T22:42Z)

**Source:** production Turso dump of 2026-08-28 (326 tables, 56 users, 13 admins) — never modified; the scrub ran on a copy in
the session scratch folder.
**Output:** `deploy/staging/seed.sql.gz` — 299,732 bytes gzip (SQL dump 5,234,006 bytes, 293 tables, 8.2 MB once built),
sha256 `2bd40d5189b9c752e032c93c1f669bf5defdaed46acdef292eaf3412aef52066`. Gitignored (`.gitignore:44`) — hand it to the Render build, never commit it.
`node deploy/staging/build-seed.js` rebuilds `deploy/staging/seed.db` from it (verified with the same libsql driver the portals use).
The dump is Python's `iterdump` output: the sqlite3 CLI ≥ 3.50 `.dump` writes `unistr('…')` literals that this libsql build rejects.
**Regenerate from a newer dump:**
`python3 deploy/staging/scrub-seed.py --src <dump.db> --out /tmp/scrubbed.db --sql-gz deploy/staging/seed.sql.gz --map-out /tmp/map.json --report /tmp/report.json`
(needs `node` + `user-portal/backend/node_modules/bcryptjs`; `--map-out` links real addresses to pseudonyms — keep it out of the repo;
the script exits non-zero if any verification below fails).

## Staging credentials
- **Password for EVERY account (team and members): `Plexus2026!`** — one bcryptjs hash, cost 10, on all 56 users;
  `email_verified=1`, `must_change_password=0`, `reset_token`/`verification_token`/`reset_token_expires` NULL on all of them.
- Example pseudonymised member logins (all `Plexus2026!`):
  - `member003@staging.medx.hr` — plain member (the one used in the boot test)
  - `member019@staging.medx.hr` — paid Plexus 2026 registration + invoice + Stripe payment record
  - `member053@staging.medx.hr` — Croatians-abroad + Gala registration paid via Stripe (session id kept)
- Team logins keep their real e-mail, e.g. `laura.rodman@medx.hr` / `pjero.bacic@medx.hr` (both `Plexus2026!`).

## Team accounts kept as-is (email, first/last name, institution, is_admin / is_staff / is_founder, allowed_sections)
- ivan.nikolic102@gmail.com
- juginovic.alen@gmail.com
- laura.rodman@medx.hr
- lucija.skejic@medx.hr
- marija.pranjic@medx.hr
- nada.rakic@medx.hr
- paula.vucica@medx.hr
- pjero.bacic@medx.hr
- pr@medx.hr
- sara.bonet@medx.hr
- test.admin@medx.hr
- test@medx.hr
- vp@medx.hr

The founder row is `juginovic.alen@gmail.com`; the founder's *other* personal accounts in `users` are not team rows and were
pseudonymised like every other member.

## What was pseudonymised
- **110 distinct personal e-mail addresses → `member<NNN>@staging.medx.hr`** (43 of them are `users` rows, numbered
  001–043 in `created_at` order; the rest were first met in registrations, logs, JSON payloads or free text). Same real address →
  same pseudonym in every table, JSON blob and free-text cell (case-insensitive). Two `CREATE TABLE … DEFAULT '<personal e-mail>'`
  clauses (`event_campaigns.sender_from` / `reply_to`, `reminder_sequences`) were rewritten in the schema with the same map.
- Names: `first_name` → `Member NNN`, `last_name` → `Test`, single-name columns → `Member NNN Test` in every row whose e-mail was
  pseudonymised (`users` 43, `gala_registrations` 33, `croatians_abroad_registrations` 57, `forum_considerations` 3,
  `forum_members` 2, `pr_subscribers` 1, `invoices` 1), in rows keyed only by a user/registration FK (`staff_tracking_consent`,
  `guest_passes`, `team_members`, `certificates`, `finance_travel_orders`, `nag_items.claimed_by_name` — all team-only or empty in this dump),
  and in the admin nag queue (`nag_items` 11 titles/payloads; one purged forum candidate became "Scrubbed Person").
  A diacritic- and case-insensitive sweep then replaced **69 full-name patterns** wherever they still appeared in non-content
  tables (chat message 1, audit details 2, payment metadata 1, institution strings that contained the owner's own name 7).
- Other e-mail columns mapped: `email_verifications` 116, `drip_log` 156, `scheduled_emails.recipient_email` 158, `audit_log.actor_email` 23,
  `newsletter_interests` 5, `forum_magic_tokens` 2, plus e-mails inside free text/JSON (`audit_log.detail` 6, `research_requests` 2, `forum_campaign.reply_to` 1, `nag_items` 1).
- Business/role mailboxes stay: `info@medx.hr`, `bridges@medx.hr`, `hlk@hlk.hr` are the only non-team, non-pseudonym addresses left in the dump.
- Public content untouched: speakers (4), talks, sessions, sponsors (25), accelerator institutions/programs, gala/plexus settings, content blocks,
  `template_library` (2,500 templates, 0 changed), forum news/convenings, `team_members` (7, all team).

## PII cleared
- Phones, addresses/street/postal, IBAN/bank, DOB/passport/OIB/ID numbers, VAT-of-person, IP columns, staff GPS → NULL everywhere by column
  pattern (`users.phone` 1, `invoices.recipient_address` 1; every other such column was empty in this dump but stays covered).
  Venue/location/hotel/pharmacy addresses are content and stay; `finance_settings` (organisation OIB/IBAN/address) stays.
- Health-related free text of pseudonymised people → NULL: `gala_registrations.dietary` 14 + `requests` (allergies) 15,
  `croatians_abroad_registrations.dietary` 14; `notes` about a person → placeholder (6).
- Personal statements → `Scrubbed for staging seed.`: `forum_considerations.note` 3; accelerator / scholarship / speaker-application / visa /
  forum-candidate statements, CVs and document paths are pattern-covered (all empty in this dump). `users.bio` / `photo_url` and forum social links of
  pseudonymised members cleared (were empty).
- IPs → `0.0.0.0` in `audit_log.detail` (94 login rows) and `scheduled_emails.last_error` (94).
- `payment_transactions.metadata.billing`: address/zip/oib/vatNumber blanked, name/e-mail pseudonymised, company name kept.

## Secrets
- NULL: `users` verification/reset tokens (all 56 rows), `registration_links.token` 35 (existing invite links are dead on staging — create new ones
  in the admin), `checkin_scans.token` 38, `registrations.checkin_token` 2, `event_checkins.checkin_token` 2, `gala_registrations.reg_link_token` 4 / `pay_token` 1,
  `speakers.invite_code` 4, `accelerator_interviewers.access_token` 2, `rewards_settings.badge_verify_secret` (key/value), `pr_meta_settings.page_access_token` (was empty).
- NOT NULL token columns got a unique placeholder `scrubbed-<rowid>`: `email_verifications.token` 140, `forum_magic_tokens.token` 2, `speaker_itineraries.token` 2.
- `scheduled_emails.payload_json`: the 158 e-mails addressed to pseudonymised members keep recipient/subject/template/status but their rendered
  body is now a placeholder; the 24 bodies addressed to team accounts are kept with every `verify?token=…` link rewritten to `token=SCRUBBED`.
- `push_subscriptions`: 3 rows deleted (endpoint/p256dh/auth are device credentials).
- Kept on purpose: Stripe `cs_live_…` session ids, `pi_…` payment ids, invoice numbers, `processed_stripe_events` (identifiers, not secrets).
  A scan of the final dump for `sk_live_ / sk_test_ / whsec_ / xkeysib- / AKIA / PRIVATE KEY` finds nothing.

## Dropped
33 `_purged_*` backup tables (accelerator_applications, accelerator_sites, bridges_events, chat_messages, feed_items, finance_bank_balance, finance_invoices, finance_payment_orders, finance_transactions, finance_travel_orders, finance_work_units, forum_candidates, forum_events, forum_groups, forum_members, forum_posts, mentorship_profiles, opportunities, pr_analytics, pr_campaigns, pr_content_calendar, pr_newsletters, pr_posts, pr_subscribers, project_tasks, refund_requests, registration_transfers, scholarship_applications, sessions, speaker_applications, talks, team_members, visa_requests), then VACUUM. Nothing else dropped.

## Verification
- (a) Row counts before/after identical for all 292 remaining tables except `push_subscriptions` 3→0; the 33 `_purged_*` tables are gone.
  Populated tables (rows): accelerator_evaluation_criteria 4, accelerator_institutions 8, accelerator_interviewers 2, accelerator_key_dates 3, accelerator_programs 1, admin_notifications 32, admin_section_preferences 56, admin_usage 13, advisor_reviews 30, app_state 10, assistant_faq_log 1, audit_log 414, automation_config 1, bridges_events 5, channel_members 14, channel_read_status 28, chat_channels 29, chat_messages 22, checkin_events 4, checkin_scans 38, cme_accreditations 1, conferences 1, content_blocks 7, content_checklist 10, croatians_abroad_invite_links 2, croatians_abroad_registrations 57, dashboard_preferences 5, drip_log 220, email_verifications 140, event_checkins 2, event_components 8, event_editions 5, finance_fiscal_years 1, finance_sequences 6, finance_settings 10, finance_transactions 9, forum_campaign 1, forum_considerations 3, forum_convening_segments 5, forum_convenings 2, forum_gala_settings 1, forum_magic_tokens 2, forum_members 2, forum_news 2, founder_recovery_log 1, gala_menu_options 4, gala_registrations 33, gala_settings 1, gameday_settings 1, intake_windows 1, invoices 1, member_announcements 3, member_meta 23, member_rewards 1, monthly_reminders_sent 2, nag_items 28, networking_connections 1, newsletter_interests 5, notify_topics 1, org_settings 1, page_views 1186, payment_transactions 1, planner_plans 1, plexus_page_settings 1, plexus_settings 1, points_ledger 8, pr_ai_generations 2, pr_meta_settings 1, pr_newsletters 1, pr_subscribers 1, press_settings 1, processed_stripe_events 30, project_settings 4, project_status 5, project_tasks 6, promo_codes 2, push_subscriptions 3→0, registration_links 35, registrations 2, reply_templates 3, research_requests 1, review_rubrics 1, rewards_settings 8, scheduled_emails 260, session_questions 2, signup_forms 1, speaker_itineraries 2, speakers 4, sponsors 25, sqlite_sequence 1, staff_pairings 1, staff_tracking_consent 3, staff_tracking_settings 1, talks 5, team_members 7, template_library 2500, ticket_types 5, users 56, year_calendar_entries 6.
- (b) `users`: total 56 = 43 `@staging.medx.hr` + 13 team. 56/56 carry the staging hash and the login-ready flags.
- (c) Dump scan: 0 of the 110 mapped addresses remain; 0 personal addresses outside the team; 0 gmail/yahoo/hotmail/outlook/icloud/proton
  addresses outside the two team gmail accounts; 0 secret-like strings; 0 swept full names left in non-content tables. An independent second
  pass (every e-mail and full name taken from the ORIGINAL dump, searched in the final dump with diacritics folded) finds only the three role
  mailboxes above and the team name "Test Recenzija".
- (d) `bcrypt.compareSync('Plexus2026!', hash)` → true for the hash read back from the built `seed.db` (wrong password → false).
- (e) Boot test — `DATABASE_PATH=<copy of scrubbed.db> PORT=3921 NODE_ENV=staging JWT_SECRET=x node server.js` from `user-portal/backend`:
  `GET /health` → 200 `{"ok":true}`; `GET /api/public/site` → 200 (Plexus Conference 2026 payload);
  `POST /api/auth/login` `member003@staging.medx.hr` → **200** (token issued, `is_admin:0`);
  `POST /api/auth/login` `pjero.bacic@medx.hr` → **200** (`is_admin:1`). One attempt each, server killed afterwards, boot log clean
  (Stripe / FIRA / VAPID / Cloudinary all "not configured", no outbound calls, no errors).
- `PRAGMA integrity_check` = ok on the scrubbed file and on the libsql-built `seed.db`.

## Known leftovers / judgement calls
- Team members' names stay everywhere, including free text that refers to a team member's *non-team* alt account
  (e.g. a nag "Gala payment pending: <founder>" whose e-mail is now `member004@…`).
- `research_requests` (1 row, an admin AI lookup): a public official's name from a public web page stays; the personal e-mail in it was pseudonymised.
- Institutions / countries / tiers of pseudonymised members are kept for realism (weakly identifying); institution strings that spelled out the
  member's own name were swept.
- `org_settings.signature` (base64 PNG of the invoice signature) is kept because invoices render with it — delete it in staging if unwanted.
- On first boot the backend re-creates its three code-seeded test fixtures (`*@test.medx.hr`, Ivan Horvat / Maria Kovac / Petra Babic, password
  `Test2026!`, hard-coded in `server.js`), so a live staging DB shows 59 users; the original fixture rows were pseudonymised like everyone else.
- `deploy/staging/seed.db` previously held the UNSCRUBBED production copy; it was rebuilt from the scrubbed dump by `build-seed.js` (gitignored).
- Nothing was committed: `deploy/staging/scrub-seed.py` and this file are untracked; `seed.sql.gz` / `seed.db` are gitignored.

## Everything the script touched (rows changed, from the run report)
| table | column:operation=rows |
|---|---|
| `accelerator_interviewers` | access_token:null-secret=2 |
| `audit_log` | detail:mask-ip=94, actor_email:pseudonymise=23, detail:sweep-email=6, detail:sweep-name=2 |
| `chat_messages` | message:sweep-name=1 |
| `checkin_scans` | token:null-secret=38 |
| `croatians_abroad_registrations` | email:pseudonymise=57, first_name:pseudonymise=57, last_name:pseudonymise=57, dietary:pseudonymise=14, notes:pseudonymise=6, institution:sweep-name=3 |
| `drip_log` | email:pseudonymise=156 |
| `email_verifications` | token:null-secret=140, email:pseudonymise=116 |
| `event_campaigns` | <schema DEFAULT>:pseudonymise-schema-default=1 |
| `event_checkins` | checkin_token:null-secret=2 |
| `finance_transactions` | description:sweep-name=9 |
| `forum_campaign` | reply_to:sweep-email=1 |
| `forum_considerations` | email:pseudonymise=3, name:pseudonymise=3, note:pseudonymise=3 |
| `forum_magic_tokens` | email:pseudonymise=2, token:null-secret=2 |
| `forum_members` | email:pseudonymise=2, first_name:pseudonymise=2 |
| `gala_registrations` | email:pseudonymise=33, first_name:pseudonymise=33, last_name:pseudonymise=33, requests:pseudonymise=15, dietary:pseudonymise=14, reg_link_token:null-secret=4, institution:sweep-name=3, pay_token:null-secret=1 |
| `invoices` | recipient_address:null-address=1, recipient_email:pseudonymise=1, recipient_name:pseudonymise=1 |
| `nag_items` | action_payload_json:pseudonymise-nag=11, title:pseudonymise-nag=11, action_payload_json:sweep-email=1 |
| `newsletter_interests` | email:pseudonymise=5 |
| `payment_transactions` | metadata:sweep-email=1, metadata:sweep-json-pii=1, metadata:sweep-name=1 |
| `pr_subscribers` | email:pseudonymise=1, first_name:pseudonymise=1, last_name:pseudonymise=1 |
| `push_subscriptions` | *:delete-push-subscriptions=3 |
| `registration_links` | token:null-secret=35 |
| `registrations` | checkin_token:null-secret=2 |
| `reminder_sequences` | <schema DEFAULT>:pseudonymise-schema-default=1 |
| `research_requests` | findings_json:sweep-email=1, summary:sweep-email=1 |
| `rewards_settings` | value:null-secret-kv=1 |
| `scheduled_emails` | payload_json:replace-body=158, recipient_email:pseudonymise=158, last_error:mask-ip=94, payload_json:sweep-token-url=24 |
| `speaker_itineraries` | token:null-secret=2 |
| `speakers` | invite_code:null-secret=4 |
| `users` | email_verified:set=56, must_change_password:set=56, password_hash:set-staging-password=56, reset_token:set=56, reset_token_expires:set=56, verification_token:set=56, bio:pseudonymise=43, email:pseudonymise=43, first_name:pseudonymise=43, last_name:pseudonymise=43, photo_url:pseudonymise=43, institution:sweep-name=1, phone:null-phone=1 |
