# Staging content curation — 2026-08-28

**Scope:** content of the Turso `medx-staging` DB only (verified via `turso db list` before every batch; `medx-portal` never touched). No code changes. Applied via the staging admin API where a route exists, SQL otherwise. All changes verified afterwards through the live member endpoints on `https://medx-staging.onrender.com` (member replica syncs ≤60 s).

**Canonical source:** `design/handoff/admin-portal-2026-08-28/README.md` § "Admin review round — decisions" + member README product rules; news facts cross-checked against live `https://www.medx.hr` (homepage, /press.html, /building-bridges.html, /accelerator.html, /plexus.html, /biomedical-forum.html).

**Logins used:** `pjero.bacic@medx.hr` (project-status + project-settings routes — his `allowed_sections` is `[]`, so every sectioned admin route returns 403 for him); `juginovic.alen@gmail.com` (founder, full access) for all sectioned admin routes; `member003@staging.medx.hr` for member-view verification. 4 logins total (one pjero token was corrupted on disk and re-issued), within the 15/15 min limit.

---

## 1. Inventory — fact → where it lives → before → target → method

| Fact | Where (table.column, row) | Before | After (target) | Method |
|---|---|---|---|---|
| Conference venue | `conferences.venue_name` id=864e46dd… | Hotel Esplanade | **Novinarski dom** | PUT /api/admin/conferences/:id |
| Conference cap 100 | `conferences.max_capacity` | 200 | **100** | same PUT |
| No abstracts | `conferences.abstract_submission_open / abstract_deadline` | 1 / 2026-10-01 | **0 / NULL** | SQL (route has no field) |
| Conference dates | `conferences.start_date/end_date` | 2026-12-04/05 | unchanged (correct) | — |
| Website price phase | `conferences.early_bird_deadline` | 2026-09-01 | unchanged (drives €150→€175 flip via gala_settings fallback) | — |
| Conference free | `plexus_settings.price_*` (4 cols) | 39/59/99/149 | **0/0/0/0** (ticket_types stay 0 via route sync) | PUT /api/admin/plexus/settings |
| Stale "Sep 30" | `plexus_settings.early_bird_deadline` | 2026-09-30 | **2026-09-01** | same PUT |
| Stale abstracts | `plexus_settings.abstract_deadline` + `key_dates_json` | 2026-10-15 + "Abstract Submission Deadline Oct 15" | **NULL** + canonical key-dates JSON (see §2) | same PUT |
| Plexus venue | `plexus_settings.venue_name` | Hotel Esplanade | **Novinarski dom** | same PUT |
| Key dates list | `plexus_settings.key_dates_json` + `year_calendar_entries` | early-bird Sep 30 / abstracts / conference | **Conference Dec 4–5 · Gala Dec 5 · Gala early bird €150→€175 Sep 1 · Accelerator opens Dec 8 · Bridges Boston Sep 18–21 · Forum gathering May 28–29 2027** | PUT plexus/settings + year-calendar PUT×2/POST×1 |
| Gala venue | `gala_settings.venue` id=default | "Hotel Esplanade Emerald Ballroom; Zagreb, Croatia" | **"Emerald Ballroom, Hotel Esplanade, Zagreb"** | PUT /api/admin/gala/settings |
| Gala junk copy | `gala_settings.description` | started with "pojjpojpo" | junk word removed, €150/€175 + proceeds copy kept | same PUT |
| Performers TBA | `gala_settings.schedule_json` (22:30 item) | "Live music by Tatiana 'Tajci' Cameron and Ante Gelo until midnight" | **"Live music until midnight — two performers to be announced this autumn"** | same PUT |
| Gala prices | `gala_settings.price_gala_early_bird/regular/early_bird_deadline` | 150/175/2026-09-01 | unchanged (correct, auto flip) | — |
| Speaker style | `speakers.title` id=453439d0 (Spisso) | "President, UCLA Health; CEO, …" | semicolon → **·** | PUT /api/admin/plexus/speakers/:id |
| Speakers real 4 | `speakers` (del Carmen, K. Smith, Lord Smith, Spisso; published+confirmed) | — | kept unchanged | — |
| Program "in preparation" | `sessions` | empty | kept empty (no invented sessions) | — |
| Project cards | `project_status` ×5 | see §3 before-values | canonical labels/details/CTAs (mock copy: "December 4–5, 2026 · Novinarski dom, Zagreb · Free entry"; "€150 until Sep 1, then €175"; "Applications open December 8"; "Annual gathering · May 28–29, 2027 · Split or Zagreb"; "Boston · September 18–21, 2026") | PUT /api/admin/project-status/:key (pjero) |
| Project dates | `project_settings` ×4 | plexus 12-04 only; accel 06-01; forum 12-06; bridges 04-18 | plexus 12-04→05 Novinarski dom Zagreb; accel **2026-12-08**; forum **2027-05-28→29 Split or Zagreb**; bridges **2026-09-18→21 Boston** | PUT /api/projects/:project/settings (pjero) |
| Accelerator opens Dec 8 | `intake_windows.opens_at` iw_accelerator_2026 | 2026-11-01T00:00Z | **2026-12-08T00:00:00.000Z** (countdown label "Applications open") | SQL (route in comments does not exist) |
| No public close/interview/result dates | `accelerator_key_dates` (3 rows) | Application Deadline 03-15 · Interview Period 04-01→10 · Results 04-20 | one row **"Applications open" 2026-12-08**; other two **deleted** (§4) | PUT + DELETE /api/accelerator/dates/:id |
| Stale program deadline | `accelerator_programs.application_deadline` id=257b842a | 2026-03-15 | **NULL** | SQL (route COALESCEs, cannot NULL) |
| 4 hosts stat | `accelerator_programs.labs_count` | "15+ Worldwide" | **"4 host institutions"** | SQL |
| Hosts 2026 (wizard list) | `accelerator_institutions` ×8 | HMS/Yale/MIT/Mayo/Cleveland/MGH/Stanford/JHU all active | **Cleveland, Mayo, Columbia (ex-JHU row), University of Zurich (ex-Stanford row)** active sort 0–3; HMS/Yale/MIT/MGH `is_active=0` | SQL (route can't set city/country/active) |
| Hosts 2026 (member board) | `accelerator_sites` ×8 (code-seeded ids — edited, never deleted) | 8 active with "Prof./Dr. Example — …" mentor lines | **site-cleveland, site-mayo, site-columbia, site-kcl→University of Zurich (Zürich, Switzerland)** active with mentor_line/lab_or_clinic/spots NULLed; site-hms/mgh/yale/osaka `active=0`, Example lines NULLed | SQL |
| Bridges Boston | `bridges_events` id=f6dfe7c1 | "Building Bridges: Boston Symposium", Harvard Faculty Club, 20 Quincy St, 2026-09-20, deadline 09-12 | **"Building Bridges 05 — Boston"**, venue "To be announced", address/deadline/times NULL, date 2026-09-18, description carries "September 18–21, 2026 — exact date and venue will be announced", no Harvard | PUT /api/bridges/events/:id + SQL for the NULLs |
| Bridges history 01–04 | `bridges_events` | only Washington + Zürich (published), fake-ish dates | renamed **"Building Bridges 01 — Washington, DC"** / **"04 — Zürich"**, status past, registration_open 0, recap notes; **London 02 (Embassy of Croatia)** + **New York 03 (Consulate General of Croatia)** created UNPUBLISHED with placeholder date 2026-01-01 + warning note (§5.6) | PUT ×2, POST ×2 |
| Boston pre-reg form | `signup_forms` id=6b38089b | "…September 2026 at Harvard Medical School, Boston", venue "Harvard Medical School, Boston" | **Sep 18–21, no Harvard, venue "Boston — venue to be announced"** | SQL |
| Forum gathering | `forum_gala_settings` id=default | "…2026", "Wednesday, May 27, 2026 · 7:30 PM", "Crystal Ballroom, The Westin Zagreb" | **"…2027", "Saturday, May 29, 2027 · 7:30 PM", "To be announced — Split or Zagreb"** | PUT /api/admin/forum/gala-settings |
| Forum events | `forum_events` | May 25–27 2026 Split/Zagreb/Westin | best-effort **May 28–29 2027, "Split or Zagreb — to be announced"** — REVERTS AT EVERY COLD START (§5.1) | SQL ×2 passes |
| Editions | `event_editions` ×4 | plexus venue Esplanade; bridges 04-18; forum 12-06; gala NULL | plexus **Novinarski dom, Zagreb**; bridges **09-18→21 Boston**; forum **2027-05-28→29 Split or Zagreb**; gala **2026-12-05 Hotel Esplanade** | SQL (no PUT route) |
| Latest from Med&X | `feed_items` | 6 seed items incl. abstracts call, talk-library, Harvard-Boston | 3 new real items on top (Plexus free+9th year+Novinarski dom · Boston Sep 18–21 · Forum founded/May 28–29 2027 — all cross-checked on medx.hr); abstracts + talk-library + old Boston **unpublished** (kept as seed sentinels, §5.9); spotlight + old Plexus bodies fixed | POST ×3 + PUT ×5 /api/admin/feed-items |
| Member announcements | `member_announcements` ×3 | abstracts call · "open in November" · "lands at Harvard Medical School" | **registration free · applications open Dec 8 (+ access-code line) · Boston Sep 18–21, venue TBA** | SQL (no PUT route; ids are seed guards) |
| No Talk Library content | `talks` | 6 invented "#placeholder" Plexus talks published | **published=0** (5 TED rows stay — deliberately badged samples) | SQL |
| Abstracts opportunity | `opportunities` kind=abstract_call | approved | **status='archived'** (hidden; row is a seed sentinel) | SQL |
| Diacritics | `users.last_name` ×4, `team_members.name` ×3 | Juginovic/Vukovic/Pranjic/Rakic | **Juginović/Vuković/Pranjić/Rakić** (Nikolić already correct) | SQL |
| Placeholder team photos | `team_members.photo_url` ×4 | randomuser.me portraits | **NULL** — Laura's returns at every boot (§5.2) | SQL |
| "150–200 guests" | `plexus_page_settings.gala_desc` | "will gather 150–200 leading…" | **"Seating is limited — the evening gathers leading…"**; `conference_date` hyphen → en dash | SQL |
| "EUR" in copy | `project_status.gala` detail | "EUR 150 through 1 Sep" | **"€150 until Sep 1, then €175"**; sweep found no other member-facing "EUR" copy (currency-code columns left, §5.8) | PUT project-status |
| "10th year" / "goal 400" / junk "4wg4"/"dg"/"dgd"/duplicate "Welcome Cocktail" | full-dump grep | **not present** in current staging DB (already purged earlier; `sessions` empty) | — | — |

## 2. Canonical key-dates JSON now in `plexus_settings.key_dates_json`

```json
[{"label":"Plexus Conference — Novinarski dom, Zagreb","date":"December 4–5, 2026","color":"#0f172a"},
 {"label":"Gala Evening — Hotel Esplanade","date":"December 5, 2026","color":"#c9a962"},
 {"label":"Gala early bird — €150, then €175","date":"Until September 1, 2026","color":"var(--up-success)"},
 {"label":"Accelerator applications open","date":"December 8, 2026","color":"#22d3ee"},
 {"label":"Building Bridges — Boston","date":"September 18–21, 2026","color":"#2563eb"},
 {"label":"Biomedical Forum — annual gathering","date":"May 28–29, 2027","color":"#7c3aed"}]
```
`year_calendar_entries` now: Gala early bird (2026-09-01, retitled from "Plexus early-bird deadline", project gala) · Bridges Boston (2026-09-18→21, was 09-01 "potential") · Donor Night 12-04 · Plexus Week 12-04→05 · Plexus Gala 12-05 · **NEW** Accelerator applications open 2026-12-08 (id 33cb50bb-127e-4796-b363-1e780ed345a5) · Forum gathering 2027-05-28→29.

## 3. Every change call (in order)

Admin API, founder token (all 200): PUT `/api/admin/plexus/settings` · PUT `/api/admin/gala/settings` · PUT `/api/admin/conferences/864e46dd-…` · PUT `/api/admin/plexus/speakers/453439d0-…` · PUT `/api/accelerator/dates/2b020ae2-…` · DELETE `/api/accelerator/dates/c21634d2-…` · DELETE `/api/accelerator/dates/fddd9d28-…` · PUT `/api/admin/year-calendar/7d2d353e-…` · PUT `/api/admin/year-calendar/689e5441-…` · POST `/api/admin/year-calendar` → 33cb50bb · PUT `/api/bridges/events/{f6dfe7c1,b89ea36d,0c38bbd1}` · POST `/api/bridges/events` → 7eb9aa3e (London), 4ac0dd7c (New York) · PUT `/api/admin/forum/gala-settings` · PUT `/api/admin/feed-items/{ca9df54d,99cd10bb,f0df127b,3aa0ff67,bd4892dc}` · POST `/api/admin/feed-items` → 123e3ac5 (Plexus), 733e5c88 (Boston), da316ab0 (Forum).

Admin API, pjero token (all 200): PUT `/api/admin/project-status/{plexus,gala,accelerator,forum,bridges}` · PUT `/api/projects/{plexus,accelerator,forum,bridges}/settings`.

SQL (turso db shell medx-staging, all OK): conferences abstracts off · accelerator_programs deadline NULL + labs_count · accelerator_institutions ×4 statements · accelerator_sites ×3 statements · intake_windows Dec 8 · member_announcements ×3 · plexus_page_settings gala_desc/date · event_editions ×4 · forum_events ×3 (re-applied twice after boot reverts, then one blanket canonical pass) · talks unpublish placeholders · opportunities archive abstract_call · users diacritics ×4 · team_members names ×3 + photos NULL · signup_forms Boston · bridges_events Boston NULLs (venue_address/registration_deadline/event_time/end_time).

Project-status before-values (for restore): plexus "Pre-registration open / December 4-5, 2026 - Zagreb - Free entry / Register"; gala "Reserve your seat / Saturday December 5 - Hotel Esplanade - EUR 150 through 1 Sep / Reserve seat"; accelerator "Applications open in November / Placements across partner labs and clinics - November 2026 / Learn more"; forum "By invitation / Biomedical Forum gathering - May 2027 / Enter code"; bridges "Boston - September 2026 / Building Bridges at Harvard Medical School / View program". Full pre-change dump of the whole DB: session scratchpad `staging-dump-before.sql` (5.4 MB, not committed).

## 4. Rows deleted (full content, restore SQL)

Only two rows were hard-deleted (both violate "NO public close/interview/result dates"):

```sql
INSERT INTO accelerator_key_dates (id,year,name,date_start,date_end,description,color,sort_order,created_at,category) VALUES
('c21634d2-d8bf-4a0f-8ca6-a1a64a3be917',2026,'Interview Period','2026-04-01','2026-04-10','Shortlisted candidates will be interviewed','#22d3ee',2,'2026-06-12 13:21:46','event'),
('fddd9d28-2eaf-4c95-b21c-e5494d3c6aa5',2026,'Results Announced','2026-04-20','2026-04-20','Final selection results published','#22d3ee',3,'2026-06-12 13:21:47','event');
```

Nothing else deleted by me. (The admin backend itself deleted/rewrote `forum_events` rows during its boot "migration" — see §5.1.) The junk records named in the brief (speaker "4wg4", "dg"/"dgd", duplicate "Welcome Cocktail" session) do not exist in this database — nothing to delete.

## 5. Left for Alen to decide / cannot fix from data

1. **forum_events flaps on every cold start (code fix needed).** `admin-portal/backend/server.js:3232–3249` ("Fix forum event dates (migration — runs on every startup)") rewrites ALL forum_events rows to "Annual Biomedical Forum 2026, May 25–27, Split & Zagreb, €150" **with no WHERE clause**, then deletes all but one row; `user-portal/backend/server.js:8871–8905` then re-seeds day1/day2/gala with May-2026 defaults and re-asserts the 2026 titles at every boot. My canonical values (Annual Biomedical Forum 2027, May 28–29 2027, "Split or Zagreb — to be announced", free) are applied and currently live, but every restart reverts them. Observed three restarts in one session (boot ids 9097ab90 → beeb6f99 → c3f712cf), so this WILL happen during review. Low member impact: only the 2 pseudonymised forum-member accounts can open that list. Fix: delete/guard the admin block.
2. **Laura Rodman's placeholder photo returns at every boot.** `user-portal/backend/server.js:10744–10756` (admin twin ~:9028) backfills randomuser.me photos by exact name whenever photo_url is NULL. The diacritic renames protect Alen/Miro/Marija, but "Laura Rodman" still matches. Fix in code, or set a real photo in the admin (any non-empty value stops the backfill).
3. **Duplicate "Laura Rodman" team_members rows** (19ea44d6 Executive Assistant, 290156c4 Admin) — both are referenced by DM chat channels, so I left both.
4. `gala_settings.capacity` stays 150 (operational). The redesign must render "limited seating", never the number. Mock says "Grand Ballroom"; DB says "Emerald Ballroom, Hotel Esplanade, Zagreb" (the room the planning notes use) — confirm which name ships.
5. Gala `speakers_json` bios state del Carmen/Anderson are "professor at Harvard Medical School" (factual affiliations — left); 21:30 schedule item "Biomedical Forum Annual Awards" left — confirm.
6. **Bridges dates unverified:** Washington 2026-04-18 and Zürich 2026-03-15 are seed dates I could not verify (press suggests Zürich ≈ June 2026); London/New York rows are UNPUBLISHED scaffolds with placeholder date 2026-01-01 and a warning in notes — set real dates + per-edition recap guest counts (canonical total "150+"), then publish.
7. Opportunity-board seed listings (Harvard/Mayo/Cleveland roles) are deliberate code-seeded demo content — left approved except the abstracts call; the travel-grant deadline 2026-08-31 lapses in 3 days.
8. `ticket_types.currency`='EUR' and `/api/public/site` `price.currency`:"EUR" are currency codes (Stripe/API), not display copy — left. `ticket_types.name_hr` "General Admission" is not Croatian — left.
9. Unpublished seed sentinels intentionally kept (deleting them would resurrect the junk at next boot, seeds key on title/id): feed "Call for abstracts…", "New in the talk library…", "Building Bridges comes to Boston in September"; 6 placeholder talks; archived abstract_call opportunity. Do not delete these rows.
10. Not in the canonical diacritics list, left as stored: Bacic, Skejic, Vucica. "Croatian Biomedical Bridges" section of `plexus_page_settings` ("4 or 5 December 2026") left — not covered by the decisions.
11. `/api/public/impact` counts include test fixtures (members=59).

## 6. Post-change verification (live member endpoints, after ≥60 s replica sync, boot c3f712cf)

`/api/public/site`: venue **Novinarski dom**, "December 4–5, 2026", phase early_bird, price.current 150, 4 keynotes · `/api/public/status`: all five canonical cards (€ symbol, Dec 8, May 28–29 2027, Boston Sep 18–21) · `/api/plexus/settings`: prices 0, eb 2026-09-01, abstracts NULL, canonical key dates · `/api/plexus/schedule`: 0 sessions ("in preparation") · `/api/plexus/speakers`: the 4 real keynotes, Spisso fixed · `/api/accelerator/countdown`: target 2026-12-08 "Applications open" · key-dates: only "Applications open 2026-12-08" · program: deadline null, "4 host institutions" · institutions & sites: exactly Cleveland, Mayo, Columbia, University of Zurich · `/api/gala/settings`: Emerald Ballroom, junk gone, performers TBA · member `/api/feed/home`: top 3 = the three new real news items (title-dedup removed the duplicate Boston) · `/api/announcements`: 3 canonical · `/api/bridges/events` (member): Zürich 04, Washington 01, Boston 05 "To be announced"; London/NY hidden · `/api/talks`: 5 badged samples, 0 placeholders · `/api/opportunities`: no abstracts call. Raw before/after JSON: session scratchpad `before/` and `after/`.
