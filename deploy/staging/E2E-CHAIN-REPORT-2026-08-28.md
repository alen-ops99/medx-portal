# E2E chain verification — Med&X review deployment (staging)

**Run:** 2026-08-28 → 2026-08-29 (UTC) · report-only, nothing fixed
**Member UI:** https://medx-member-portal-v2.netlify.app (/app/…) · **Admin API:** https://medx-staging.onrender.com/__admin/api/… · **Member API:** …/api/…
**Accounts:** admin `pjero.bacic@medx.hr` (admin-backend token + member-backend token for /api/v2 adminOnly routes) · members 003 / 007 / 010. One login per account, tokens reused everywhere (Playwright via injected `localStorage.medx_user_token` + `medx_user_data`).
**Screenshots:** `user-portal/frontend-v2/_qa/e2e/` (39 files, names cited below).
**DB topology:** two backends on one Turso DB via embedded replicas — every cross-backend hop was polled every ~10 s; observed sync latencies ranged **11–63 s** (all within the ~90 s allowance).
**Instance behavior:** the free instance slept twice mid-run (boot `9be509ef` → `3bad368c` → `3a7f93ca`). Each restart wipes the ephemeral `/__staging/emails` outbox — emails observed before a restart are recorded as such. Tokens survived restarts (fixed JWT_SECRET).

Verdicts: **12 PASS · 1 FAIL (S8) · 2 PARTIAL (S9, S11)**

---

## S1 · Project status chain — PASS
- `GET /__admin/api/admin/project-status/bridges` → baseline `detail_line: "Exact date and venue announced later · open to everyone"`.
- `PUT /__admin/api/admin/project-status/bridges` `{detail_line: "... · E2E 20260828-2358"}` → `{"success":true}`.
- Member backend `GET /api/public/status` showed the marker after **11 s** (first poll).
- Member UI `/app/home` (member003): bridges project card rendered the marker — note the v2 typography engine renders the hyphen as an en dash (`20260828–2358`), text otherwise verbatim. Screenshot `s1-home-bridges-e2e.png`.
- REVERT via same PUT → member-visible after **42 s** (public/status carries a 60 s in-process memo + cache headers, so revert lag > forward lag is expected).

## S2 · Program publish chain — PASS
- Baseline: member `GET /api/plexus/schedule` had `sessions: 0` (program page shows the "in preparation" state).
- `POST /__admin/api/admin/plexus/sessions` `{title:"E2E test session — delete me", day:1 (= Fri Dec 4 2026), start_time:"14:00", end_time:"14:30", room:"Hall A", is_published:1}` → `session_id 37466de7…`.
- Member `GET /api/plexus/schedule` listed it after **31 s**.
- UI `/app/plexus/program`: session listed under FRI DEC 4 ("14:00 E2E test session — delete me · Hall A"); the one remaining IN PREPARATION belongs to Day 2 (no sessions) — correct. `s2-program-session.png`.
- UI `/app/plexus` at-a-glance: Day-1 row flipped from IN PREPARATION to the day's time range "14:00 – 14:30" (the glance shows time ranges by design, never titles). `s2-plexus-glance.png`.
- `DELETE /__admin/api/admin/plexus/sessions/:id` → gone member-side after **11 s**.

## S3 · Speakers chain — PASS
- `POST /__admin/api/admin/plexus/speakers` ("E2E Testović", is_published 1) + `PUT …/speakers/:id` `{confirmation_status:"confirmed"}` → visible in member `GET /api/plexus/speakers` after **12 s** (5th speaker).
- UI: the `/app/plexus` hub block deliberately renders only the first four speakers (`D.speakers.slice(0, 4)` in views/plexus.js:491) — the full list with search lives on `/app/plexus/program`. Found via the "Search speakers…" box; card `s3-speaker-card.png`; clicking the card opens the speaker overlay with name, "Professor of Connectivity Testing, E2E Institute, Zagreb" and the BIO + ADD SESSION action `s3-speaker-modal.png`.
- `DELETE /__admin/api/admin/plexus/speakers/:id` → gone member-side after **11 s** (list back to 4).

## S4 · Gala performers flag (v2) — PASS
- `PUT /api/v2/gala/meta` (member backend, **pjero's member-side token**, adminOnly) `{performers_announced:true, performers:[E2E Ana Harmonija/Soprano, E2E Trio Adriatic/Jazz trio]}` → success echo with both rows.
- UI `/app/gala` (member003): both names rendered, placeholder copy gone. Same-backend write, no replica wait. `s4-gala-performers.png`.
- REVERT `{performers_announced:false, performers:[]}` → the un-announced state returned ("Headline performer — announced this autumn" + badge "…NAMES ANNOUNCED CLOSER TO DECEMBER" — this is the artboard's TBA state; the literal string "TBA" is not used). `s4-gala-tba-reverted.png`.

## S5 · Bridges recap figures (v2) — PASS
- `PUT /api/v2/bridges/editions/84bc09a6-…` (Zürich, edition 04) `{guests:84, connections:312}` → success.
- UI `/app/bridges` recap card: "84 GUESTS / 312 NEW CONNECTIONS". `s5-bridges-recap.png`.
- REVERT `{guests:null, connections:null}` → card shows "— GUESTS / — NEW CONNECTIONS". `s5-bridges-reverted.png`.

## S6 · Forum invite chain (v2) — PASS
- `POST /api/v2/forum/invites` (pjero member token) `{email:"member007@staging.medx.hr", name:"Member 007 Test", note:"E2E test invite — safe to delete"}` → code **FRM-DWFP-C2HE**, invite id `d8b0c1de…`, `sent_at` set; outbox listed `Your_invitation_to_the_Biomedical_Forum_… .html` immediately (observed pre-restart; regenerated after the instance restart via `POST /api/v2/forum/invites/:id/send` for template inspection).
- Email opened: v2 brand template (med&X wordmark header on #191512, cream #f7f1e6 body, Fraunces + gold #c9a962) with the FRM code embedded.
- UI redeem (member007, `/app/forum`): FORUM CODE input + "UNLOCK REGISTRATION →" → `POST /api/v2/forum/redeem-code` accepted; forum state flipped to **stage 2** (`is_member:true, status:"approved", valid_until:"2027-08-29"`, members_count 2→3). `s6-forum-code-entered.png`, `s6-forum-after-redeem.png`.
- Admin list `GET /__admin/api/admin/forum/members`: member007 present with status approved on first check (≤ ~60 s after redeem).
- UI vote: clicked the `[data-act="vote"][data-choice="split"]` control → "SPLIT 1", aria-checked true; API state `{mine:"split", counts:{split:1, zagreb:0}, total:1}`. `s6-forum-vote-before/after.png`.
- Left in place as instructed: membership, vote, and the used invite row.

## S7 · Messages chain — PASS
- UI (member003) `/app/messages?topic=plexus`: PLEXUS topic chip preselected by the query param; sent "E2E test message about Plexus — automated connectivity check…" via the composer (`POST /api/v2/messages/team`). `s7-composer.png`, `s7-member-sent.png`.
- `GET /__admin/api/admin/messages` listed it after **42 s** with `topic:"plexus"`, `title:"Plexus"`, member=member003.
- Admin reply: the actual send route is `POST /__admin/api/admin/messages` with `{receiver_id, title, content}` — there is no POST `/api/admin/messages/:userId` (that path is GET-thread; `POST …/:userId/draft-reply` is the AI draft). Reply accepted (`id a3f8e74f…`).
- member003 `GET /api/v2/messages/unread-count` flipped to `{"unread":1,"team":1}` after **41 s** — this is exactly the endpoint the chrome ALERTS dot consumes. UI: thread list showed the reply preview with unread state (`s7-thread-unread.png`, chrome `s7-chrome-unread.png`); opening the team thread (mark=1) displayed the reply and cleared it — unread-count back to 0. `s7-thread-opened.png`.

## S8 · Registration chain — **FAIL** (member-visible half of the chain is not connected)
What passed:
- `GET https://medx-staging.onrender.com/plexus?pick=conference&src=portal`: the conference card carried class `event-option evt-conference selected` — the ?pick preselect works. `s8-plexus-form-preselect.png`.
- Filled pf_first/pf_last/pf_email(member010)/pf_inst/pf_country and submitted "Complete registration" → success screen. `s8-plexus-submitted.png`. The form posts **`POST /api/croatians-abroad/register`** (source `plexus`) — it writes `croatians_abroad_registrations` (id `2e109a34-e733-4a54-9974-8bb3a18f5474`, selected_conference 1, conference_status "pre-registered"), and the row landed with **user_id NULL** (the page was opened without the portal's `?mxt=` token hand-off; the form origin has no portal session).
- Confirmation email in outbox: `You_re_pre_registered_Plexus_2026_… .html` — Med&X template with a **QR PNG embedded as a data URI**. (Footer links point at the prod portal /privacy /terms — boilerplate.)
- Admin table: the row is served by **`GET /__admin/api/admin/plexus-experience/registrations`** (source='plexus' rows); note `GET /api/admin/croatians-abroad/registrations` deliberately excludes them and `GET /api/admin/registrations` reads the `registrations` table only, so the row never appears there.
- `/qr/2e109a34-….png` → 200 image/png (S14) — the QR/scanner path resolves CA rows.

What failed (evidence):
- **/app/plexus/mine** still shows "MY PLEXUS · REGISTRATION OPEN / REGISTER NOW →" — no registered state, no QR pass. `s8-mine-member010.png`.
- **/app/me wallet** shows "MY WALLET · NO TICKETS YET". `s8-wallet-member010.png`.
- Cause (code, user-portal/backend): `GET /api/plexus/my-registration` and `GET /api/my/events` (server.js:13037) read `registrations` (by user_id) and gala/bridges/forum/signup tables (by email) — none of them read `croatians_abroad_registrations`; likewise the v2 wallet ticket sources (v2/wallet.js:187–200). A conference pre-registration made through the public /plexus form is therefore invisible to the member portal even when the email matches, and user_id linking would not change that.
- **Attendance card: never generated.** `GET /api/v2/attendance-cards/mine` (member010) stayed `{"cards":[]}` from 13:18:39Z (registration) through 13:49:33Z (**31 min**, ≥6 sweep cycles at the 5-min interval; no card email in the outbox). Cause: the sweep's plexus eligibility (v2/attendance-cards.js `findEligible`) scans `registrations` with `status='confirmed'` and paid-ish `payment_status` — CA pre-registrations are not scanned at all.

## S9 · Gala request → approve chain — PARTIAL (one leg fails: approval email unreachable on staging)
- Public `POST /api/gala/register` (the route the old #gala "request an invitation" flow uses) for member010 → `{success, id ad185ed3-1f89-4e38-a44e-07eff02346cf, status:"pending"}`; request-received email landed in the outbox (`Gala_Evening_Invitation_Request_Received_…`).
- Admin bell: `GET /__admin/api/notifications` (the admin_notifications-backed route; there is no /api/admin/notifications bell route) showed "New Gala invitation request … Member 010" after **17 s**, unread.
- Approve: `PUT /__admin/api/gala/registrations/ad185ed3…` `{status:"approved"}` → success, audit row, picker-sync queued.
- **FAIL leg:** the approval email (subject "Your Gala Evening Invitation Has Been Approved!" with the Complete Payment CTA, built in admin server.js:30116 handler) never appeared in `/__staging/emails`. Cause: only the member backend implements the staging email dump (`EMAIL_DUMP_DIR`, user-portal server.js:135); `grep EMAIL_DUMP admin-portal/backend/server.js` matches nothing, so every admin-backend send (gala approval/rejection and any other admin-triggered mail) is silently dropped on staging and cannot be reviewed in the outbox.
- Member side: `GET /api/gala/my-status` (member010) flipped to approved after **58 s**. UI `/app/gala`: "Your seat is approved — complete the payment to confirm it." + PAY FOR YOUR SEAT →. `s9-gala-approved.png`.
- Stripe-off: one click on PAY FOR YOUR SEAT → `POST /api/gala/checkout-session` returned **400 `{"error":"Stripe is not configured"}`** and the UI surfaced "STRIPE IS NOT CONFIGURED" — clean, no 5xx anywhere in the session. `s9-gala-pay-stripe-off.png`. (Checkout POST called exactly once.)
- Left in place: member010's approved gala registration (admin_notes marked "E2E approval - automated check").

## S10 · Accelerator chain — PASS
- Wizard `/app/accelerator/apply?preview=1` (member007) driven through PERSONAL → EDUCATION → PROGRAM → SUPPLEMENTARY → DOCUMENTS (CV stub PDF attached; "they upload when you submit") → CONSENT (3 checkboxes) → REVIEW (checklist all COMPLETE, submit enabled). `s10-wizard-review.png`.
- Submit → `POST /api/accelerator/applications` 200 → **ACC26-001** (id `14ebc65b…`), then `POST …/documents/cv` 200 (document id `6a1f11a9…`). UI: "SUBMITTED · AUGUST 29, 2026 — Application ACC26-001 is in." `s10-submitted.png`.
- Admin `GET /__admin/api/admin/accelerator/applications` listed it after **11 s** (`status:"submitted"`).
- Member overview `/app/accelerator` → "YOUR APPLICATION / SUBMITTED / Application ACC26-001 submitted August 29, 2026." `s10-your-application.png`.
- Automation note (not a product bug): the wizard autosaves its draft each second, which re-renders the active panel; naive per-element Playwright fills go stale mid-step. Completed by seeding `localStorage.medx_accelerator_draft` + driving Documents/Consent/Review through the real UI controls; the application/document POSTs all came from the app itself. Drafts are localStorage-only (a fresh browser starts blank).

## S11 · Profile → directory chain — PARTIAL (admin profile route omits the new v2 fields)
- UI `/app/profile` (member003): photo uploaded (`POST /api/v2/profile/photo` 200 → `/uploads/profile/1dfd5f6a….png`), specialty tag "Sleep medicine (E2E)" added, title "Professor of E2E Medicine" + institution "E2E University Hospital, Zagreb" saved (`PATCH /api/v2/profile` 200). `s11-profile-saved.png`.
- Admin route `GET /__admin/api/admin/users/:id/profile` (the only member-profile read the admin UI calls): **institution updated after 11 s**; `title` and `photo_url` stayed null for 115 s and will stay null indefinitely — the handler (admin server.js:11257) selects only `id,email,first_name,last_name,phone,institution,country,bio,is_admin,created_at` from users and never reads the v2 columns (`users.title`, `users.photo_url`, `users.specialties`) the redesigned profile writes. Institution-level PASS, title/photo structurally absent.
- Member directory: `/app/network` search "Member 003" (as member007) → row with the new institution and the uploaded portrait (`<img src="/uploads/profile/1dfd5f6a….png?v=…">`). `s11-network-search.png`.
- Profile changes left in place (E2E-marked values).

## S12 · Newsletter chain — PASS
- UI Home newsletter block (member003): PLEXUS + GALA chips → SUBSCRIBE → `POST /api/v2/newsletter/subscribe` 200 `{topics:["plexus","gala"], confirmed}`; welcome email in outbox. `s12-newsletter-block.png`, `s12-subscribed.png`.
- Admin count: `GET /api/v2/newsletter/subscribers?topic=plexus` (pjero member token) → `counts {active:1, plexus:1, gala:1}` with member003's row.
- Preferences (member003) returned the `manage_url` (`…/api/v2/newsletter/manage?t=<64-hex>`); GET → 200 text/html branded "NEWSLETTER · PREFERENCE CENTER". `s12-manage-page.png`.
- Unsubscribe `GET …/unsubscribe?t=` → 200 "You're unsubscribed." page (`s12-unsubscribed-page.png`); preferences flipped `subscribed:false`.
- Re-subscribed via `POST /api/v2/newsletter/subscribe` → active again, counts back to plexus:1/gala:1. Subscription left active.

## S13 · Notifications/announcement chain — PASS
- `POST /__admin/api/admin/notifications/send` `{user_group:"all", category:"announcement", project:"plexus", title:"E2E announcement — safe to ignore", …}` (writes user_notifications; push not requested) → id `b4d26e97…`.
- member003 `GET /api/user-notifications` showed it after **63 s**.
- UI: ALERTS control opened, announcement listed with unread state (`s13-alerts-dropdown.png`); MARK ALL READ → `POST /api/user-notifications/mark-all-read` 200; API confirms `is_read:1`, no unread left. `s13-alerts-after-read.png`.
- Cleanup: `DELETE /__admin/api/admin/notifications/user-notifications/:id` → success.

## S14 · Forever-URLs on staging — PASS (6/6)
| URL | Status | Content-Type | Evidence |
|---|---|---|---|
| `/calendar/medx-events.ics` | 200 | text/calendar | `BEGIN:VCALENDAR … PRODID −//Med&X//Plexus Week 2026//EN` |
| `/qr/2e109a34-e733-4a54-9974-8bb3a18f5474.png` (member010's regId) | 200 | image/png | magic `89504e470d0a1a0a`, 6,676 B |
| `/verify-certificate?n=INVALID` | 404 | text/html | branded "Certificate verification — Med&X" not-found page |
| `/pass/INVALIDTOKEN` | 404 | text/html | branded "This page is not available — Med&X" clean error |
| `/reset-password/INVALID` | 200 | text/html | "Link Invalid or Expired — Med&X" page |
| `/invite-success` | 200 | text/html | renders ("No Recent Payment Session — Med&X" fallback state) |

## S15 · Production untouched — PASS (read-only)
- `https://medx-user-portal.onrender.com/` → 200, still serving `app.part1.js?v=189ac8d`.
- `https://medx-admin-portal.onrender.com/health` → 200 `{"ok":true}`.
- Repo `git log origin/main -1 --format=%h` → **8b7ba23** (working branch remains redesign/member-portal).
- `https://www.medx.hr` → 301 → `https://medx.hr/` 200; its `site.js` references `medx-user-portal.onrender.com` (6×) and `medx-admin-portal.onrender.com` (2×) — zero staging references.

---

## Final table

| # | Scenario | Verdict | Cross-backend latency | Key evidence |
|---|---|---|---|---|
| 1 | Project status | PASS | 11 s fwd · 42 s revert | s1-home-bridges-e2e.png |
| 2 | Program publish | PASS | 31 s create · 11 s delete | s2-program-session.png, s2-plexus-glance.png |
| 3 | Speakers | PASS | 12 s · 11 s | s3-speaker-card/modal.png |
| 4 | Gala performers (v2) | PASS | same-backend | s4-gala-performers/tba-reverted.png |
| 5 | Bridges recap (v2) | PASS | same-backend | s5-bridges-recap/reverted.png |
| 6 | Forum invite | PASS | ≤60 s (admin list) | s6-* (4), invite email in outbox |
| 7 | Messages | PASS | 42 s in · 41 s out | s7-* (5) |
| 8 | Registration | **FAIL** | admin row present; member legs broken | s8-* (4) |
| 9 | Gala request→approve | PARTIAL | bell 17 s · approve→member 58 s | s9-* (2); approval email never in outbox |
| 10 | Accelerator | PASS | 11 s (admin list) | s10-* (4) |
| 11 | Profile→directory | PARTIAL | 11 s (institution) | s11-* (2); admin SELECT lacks title/photo |
| 12 | Newsletter | PASS | same-backend | s12-* (4) |
| 13 | Announcement | PASS | 63 s | s13-* (2) |
| 14 | Forever-URLs | PASS | n/a | table above |
| 15 | Production untouched | PASS | n/a | v=189ac8d · health ok · 8b7ba23 · site.js→prod |

## Defects found (report-only, none fixed)
1. **S8 — public /plexus form registrations never reach the member portal.** The form writes `croatians_abroad_registrations` (source='plexus'); `/api/plexus/my-registration`, `/api/my/events`, and the v2 wallet only read `registrations`/gala/bridges/forum/signup tables, and the attendance-card sweep's eligibility queries skip CA rows entirely → no "registered" state on /app/plexus/mine, no wallet ticket, no attendance card (none after 31 min; the /qr png and admin plexus-experience list do work). Also: the row lands with user_id NULL unless the portal passes its `?mxt=` hand-off.
2. **S9 — admin-backend emails are invisible on staging.** admin-portal/backend/server.js has no `EMAIL_DUMP_DIR` support (member backend: server.js:135), so the gala approval email (Complete Payment CTA) — and any other admin-side send — cannot be reviewed in `/__staging/emails`.
3. **S11 — admin member-profile route omits v2 fields.** `GET /api/admin/users/:id/profile` selects a fixed users column list without `title`, `photo_url`, `specialties`; institution syncs (11 s), the redesigned profile's title/photo/specialty can never show in the admin view.
4. Minor route-table deviations to note in docs: admin message reply is `POST /api/admin/messages` (body receiver_id) rather than `POST /api/admin/messages/:userId`; the admin bell is `GET /__admin/api/notifications`; public-form registrations list under `/api/admin/plexus-experience/registrations`.

## Observed sync latencies (Turso embedded replicas)
11 s · 11 s · 12 s · 17 s · 31 s · 41 s · 42 s · 42 s · 58 s · 63 s — median ≈ 36 s, max 63 s, all under the 90 s allowance. Same-backend v2 writes (gala meta, bridges, newsletter, forum redeem) were instant.

## Test data left on staging (marked, by design)
- member007: Forum membership (approved, until 2027-08-29) + venue vote "split" + accelerator application **ACC26-001** with stub CV PDF.
- member010: plexus-experience pre-registration `2e109a34…` (conference, "pre-registered") + gala registration `ad185ed3…` (approved, E2E admin note).
- member003: profile title/institution/specialty/photo (E2E values) + active newsletter subscription (plexus, gala).
- Used forum invite FRM-DWFP-C2HE.
Reverted/deleted during the run: bridges detail_line, E2E session, E2E speaker, gala performers, Zürich recap numbers, E2E announcement.

## Other observations
- The Netlify member site proxies `/api/*` same-origin to the staging backend (requests observed against the netlify.app origin returning staging data) — the `config.staging.js` direct-URL path is therefore not the only wiring in play.
- Free-instance restarts wipe the outbox and any uploaded files on ephemeral disk; DB state survives via Turso.
- No 403s: pjero's account covered every admin section touched (member-ops, plexus, bridges, forum, accelerator, gala) — the founder fallback was never needed.
- No 5xx responses were observed in any UI session across all scenarios.
