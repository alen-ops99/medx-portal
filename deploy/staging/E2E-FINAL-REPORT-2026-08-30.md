# E2E FINAL verification — Med&X ADMIN portal v2 ↔ member portal v2 ↔ website feed (staging)

**Run:** 2026-08-30 22:04–23:0x UTC · **report-only, nothing fixed** · admin `pjero.bacic@medx.hr`, members 003/007/010 (one login each, tokens reused; Playwright sessions via injected localStorage `medx_token`/`medx_user` and `medx_user_token`/`medx_user_data`).
**Surfaces:** admin v2 https://medx-admin-portal-v2.netlify.app · member v2 https://medx-member-portal-v2.netlify.app · staging backend https://medx-staging.onrender.com (member /api, admin /__admin/api, outbox dump /__staging/emails). Backend awake at start (boot `11e77446`); the free instance restarted once at ≈22:35Z (boot `c9060af1`), wiping the ephemeral e-mail dump as documented — dump evidence captured before the wipe is preserved in `_qa/e2e-final/` (`s8-invite-email-…html`). Tokens survived (fixed JWT secret).
**Screenshots:** `admin-portal/frontend-v2/_qa/e2e-final/` (36+ files, names cited per scenario). Sweep: `_qa/e2e-final/SWEEP.md` + `scripts/qa-admin-sweep-final.py`.
**No mail risk:** staging has no provider (health check proves BREVO_API_KEY unset on both backends); every send landed only in the `/__staging/emails` dump. No Brevo/external mail API was ever called. Test registrant e-mails used `@example.com` (void) and `@staging.medx.hr` pseudonyms.

## ⚠ Mid-run incident — deployed admin origin flapped (fact, not fixed)
From **~22:27Z to ~22:41Z** the Netlify admin origin served a broken deploy: every non-root path (all 17 routes) and every `/api/*` proxy call returned Netlify's default 404 page; the served `index.html` carried `memberPortalUrl:'http://localhost:8890'`; the 404s carried a deploy-timestamp etag `1788119386` = 2026-08-30T19:49:46Z. Until ~22:26 the same routes served fine (edge-cache of the previous good deploy — S1/S5/S7/S10–S12 evidence collected there). By **22:41:54Z** the origin was healthy again with the correct staging config (`memberPortalUrl:'https://medx-staging.onrender.com'`); all 17 routes re-probed 200 with **0 console errors, 0 API 5xx** (`s1-admin-today-origin-recovered.png`, origin_routes probe). Someone appears to have published an unstamped local build (no `_redirects`, dev config) and then restored it. Scenario UI evidence gathered inside the window (S6 part, S13 UI) was completed through the repo's own `dev-server` pattern (scratchpad harness: same static files + SPA fallback + proxy to the same staging `/__admin`), and the deployed origin was re-verified after recovery.

## Verdicts — 10 PASS · 4 PARTIAL (S1, S5, S6, S13) · 1 FAIL by rule (S15: two API 5xx in the sweep, both diagnosed)

| # | Scenario | Verdict | Cross-portal latency | Evidence |
|---|---|---|---|---|
| 1 | Admin Today + doors + pill | **PARTIAL** — pill not green (2 staging-config fails); everything else passed | pill probes live | s1-admin-today.png, s1-settings-health.png, s1-attention-door-toast.png |
| 2 | Member Pages → member Home + /api/public/status | **PASS** | fwd 32 s · revert 31 s | s2-member-home-marker.png |
| 3 | Plexus Hub session publish | **PASS** | fwd 32 s · delete 11 s | s3-member-program.png |
| 4 | Speaker add→publish | **PASS** | fwd 32 s · delete 11 s | s4-member-speaker.png |
| 5 | Gala MARK PAID + seating | **PARTIAL** — pay+board pass; seat does NOT reach member pass data | pay→member ≈60 s | s5-gala-*.png (3) |
| 6 | Registrations + Links + bulk outbox | **PARTIAL** — all legs pass except the link TAG on the row (bug) | row in admin table 11 s | s6-*.png (3) |
| 7 | Inbox messages + announcement | **PASS** | in 51 s · reply out ≤60 s · announce 52 s | s7-*.png (6) |
| 8 | Forum invite→dump→redeem→feed | **PASS** | email 12 s post-approve · members list 21 s · feed 52/51 s | s8-member-forum-feed.png, dump file |
| 9 | Bridges Zürich recap | **PASS** | fwd 41 s | s9-member-bridges-recap.png |
| 10 | Accelerator Review Room | **PASS** | n/a (admin-side) | s10-*.png (2) + CSV |
| 11 | Money chase + FIRA gate | **PASS** | same-backend | s11-money-chase.png |
| 12 | Calendar/Today tasks | **PASS** | same-backend | s12-*.png (3) |
| 13 | Event Day party scanning | **PARTIAL** — scan core+rehearsal+revoke perfect; door-link URL & rehearsal-lookup bugs | scans instant | s13-*.png (3), s13_scans.json |
| 14 | Website feed integrity | **PASS** | n/a | prod_status.json, curl |
| 15 | Button sweep (17 routes) | **FAIL by the 5xx rule** — 283 controls, 235 work, 0 4xx, but 2 API 5xx (503 print-engine env · 500 known doc-download); 3 console errors = headless clipboard only | n/a | SWEEP.md + sweep-*.png |

---

## S1 · Admin Today — PARTIAL
- `/today` loaded in **2.5 s** with live numbers: DAYS TO PLEXUS 96 · CONFERENCE REGISTERED 2 · GALA SEATS PAID 24 · COLLECTED €5,250 + 30-day trend. 0 console errors.
- **Doors (5/5 work):** hero DAYS TO PLEXUS→`/projects/plexus` ✓, CONFERENCE REGISTERED→`/registrations` ✓, GALA SEATS PAID→`/gala` ✓ (all NAV OK); pill→`/settings/health` ✓; NEEDS-ATTENTION "Gala payment pending — Member 086" CHASE PAYMENT → toast "REMINDER QUEUED — APPROVE IT IN THE OUTBOX" + real `nag-…` batch created (verified in outbox, then cancelled). Attention rows present: outbox (91 e-mails/10 batches), member message, 4× gala chase.
- **FAIL leg — ALL SYSTEMS pill is crimson**, `2 FAILING · 8 TO CHECK`: ① *Email provider* — BREVO_API_KEY unset (**deliberate on staging**; the health check has no staging awareness) ② *Document storage persistence* — 1 accelerator document (ACC26-001 stub CV) on ephemeral disk, no CLOUDINARY_URL. Config-level, not v2 code.

## S2 · Member Pages → Plexus card — PASS
`PUT /__admin/api/admin/project-status/plexus` appended ` · E2E-F 22:05` → member `GET /api/public/status` served it after **32 s** → member v2 `/app/home` card rendered it verbatim (s2). REVERTED to the exact baseline (`December 4–5, 2026 · Novinarski dom, Zagreb · Free entry`); marker gone member-side after 31 s.

## S3 · Program session — PASS
`POST /api/admin/plexus/sessions` "E2E Final session", day 1 (Fri Dec 4), 15:00–15:30, Hall A, published → member `/api/plexus/schedule` after **32 s** → `/app/plexus/program` listed "E2E Final session · Hall A" under Dec 4 (s3). DELETE → gone member-side in **11 s**.

## S4 · Speakers — PASS
`POST /api/admin/plexus/speakers` "E2E Testović" + PUT confirmed/published → member speakers API **32 s** → program-page speaker search found the card "E2E Testović — Professor of Final Verification, E2E Institute, Zagreb · BIO + ADD SESSION →" (s4). DELETE → gone in **11 s**.

## S5 · Gala board — PARTIAL
- Target: member010's approved-unpaid `ad185ed3…` (left by the 08-28 run).
- **MARK PAID via the admin UI row action** → toast "MARKED PAID — MONEY UPDATES TOO"; member010 `GET /api/gala/my-status` flipped to `payment_status:"paid"` (first check ≈60 s); wallet ticket flipped `paid:true`. The member-backend card sweep then e-mailed "I'm attending Gala Evening 2026 — your card is inside" — **into the dump** (bonus: the 08-29 S8-fix works).
- **Seating:** UI `tableSel` → T1 → `POST /api/admin/gala/tables/:id/assign` → board shows Member 010 on T1; `/api/v2/gala-ops/overview` assignment confirmed (s5-gala-seat-assigned.png).
- **Noted (asked by the scenario): the seat does NOT reach member-side pass data.** The v2 board writes `gala_seat_assignments`; the wallet pass builder reads `gala_registrations.seat_number` — still NULL → pass would say "TBD — assigned closer to the Gala"; member `GET /api/gala/my-seat` → `{"assigned":false}`. (Also `/api/v2/wallet/tickets/:id/pass` → `configured:false` — Google Wallet env unset on staging.) Matches the open "wallet pass updates" build-queue item — the seat-assign→wallet PATCH is not wired yet.
- Cleanup: seat unassigned. **`payment_status:'paid'` cannot be reverted via any admin API — left in place, listed.**

## S6 · Registrations + Links — PARTIAL (one tagging bug)
- `POST /api/admin/registration-links` (PUBLIC/generic, plexus) → token `24bb3626…`, URL `…/plexus/<token>`; the public chooser page serves 200.
- Public form: `POST /api/croatians-abroad/register` `{source:'plexus', link_token, "E2E Final", e2efinal@example.com, selected_conference:1}` → `pre-registered`; confirmation e-mail → dump only.
- Admin cross-event table (`GET /api/v2/registrations/all`) listed the row after **11 s**; stats ALL 139→140, CONFERENCE 57→58 (counts increment ✓); Links screen shows "E2E Final link · 1 sign-up" (uses ✓); Registrations UI finds the row by search (s6-registrations-row.png).
- **BUG — the row is NOT tagged with its source link:** `link:null, source_kind:"public"`. Cause (member backend `user-portal/backend/server.js` ≈:28357): the denormalize writes `reg_link_token = invite_link_id || null` — the *diaspora* field, null in the plexus flow — instead of the resolved `link_token`/`plexusLinkRow.token`. The per-link sign-ups drill-down (`/registrations?link=…`) therefore misses public-form sign-ups; only the uses counter ties them to the link.
- Bulk e-mail: `POST /api/v2/registrations/bulk-email` (1 recipient) → batch `adminregs-…` `pending_approval`; visible on Inbox→EMAIL & OUTBOX (s6-inbox-outbox-batch.png); **never approved** — deleted via `POST /api/admin/outbox/:batch/cancel` → gone.
- Cleanup: link deactivated, e2efinal registration cancelled (soft-cancel by design).

## S7 · Inbox — PASS
- member003 → `POST /api/v2/messages/team {topic:'plexus'}`; admin `GET /api/v2/inbox/threads` showed it after **51 s** — row "Member 003 Test · PLEXUS · unread" (s7-admin-inbox-messages.png).
- Reply typed in the admin thread UI → member003 thread carried "E2E FINAL reply…" with `unread-count {team:1}` (≤60 s; s7-member-thread-unread.png); opening the thread cleared it (unread 0).
- Announcement composer route (`POST /api/admin/notifications/send`, all members) → member bell after **52 s**; bell popover "ALERTS · 1 NEW" with the announcement (s7-member-bell-announcement.png); UI MARK ALL READ → `is_read:1` (PUT `/api/user-notifications/mark-all-read` — note: PUT, not POST). Both announcements deleted after.

## S8 · Forum — PASS
- Admin v2 mint `POST /api/v2/forum/invites` → code **FRM-MBZT-HASF**, personal e-mail staged `pending_approval` (outbox-first, by design). Approved **that one batch** → **`Your_invitation_to_the_Biomedical_Forum_1788128348434.html` in the dump 12 s later**, containing the code + recipient.
- Redeem: **member010** (member007 is already a member since the 08-28 run — a second redeem is refused 409 `'member'` by design, so the scenario's growth leg used member010). `POST /api/v2/forum/redeem-code` → "welcome to the Forum network", valid until 2027-08-30. Admin `GET /api/admin/forum/members` grew **3→4** after **21 s**.
- Feed: `POST /api/v2/forum/feed` (news "E2E FINAL feed item") → member `/api/v2/forum/feed` + `/app/forum` UI after **52 s** (s8-member-forum-feed.png) → `PUT {published:false}` → gone member-side after **51 s**.

## S9 · Bridges — PASS
Zürich edition `84bc09a6…` `PUT {guests:87, connections:315}` → member `/api/v2/bridges/editions` after **41 s** → `/app/bridges` recap card "87 GUESTS / 315 NEW CONNECTIONS" (s9). REVERTED to null/null (echo confirmed).

## S10 · Accelerator Review Room — PASS
- `/accelerator-review` lists **1 APPLICATION** (ACC26-001, Member 007 Test) with 4 criteria score cells.
- Scored Academic Excellence **4** as pjero → toast "SCORE SAVED — TEAM AVERAGE UPDATED"; cell title flipped "team avg — · 0 reviewers" → "**team avg 4 · 1 reviewer**" (+ legacy evaluate-batch mirror).
- EXPORT RANKING (CSV) → downloaded `accelerator-ranking-2026.csv` (277 B) with the scored row. *Observation:* the CSV "Average" column divides by all 4 criteria (one 4 → "1.00") — confirm intended.
- Cleanup: no score-removal API exists — **pjero's 4 stays**, listed.

## S11 · Money — PASS
- Chase: `POST /api/v2/money/chase/61b314c1…` (Member 088, awaiting_payment) → batch `v2-chase-…` in `pending_approval`; Money→chase UI shows "REMINDER QUEUED ✓" (s11) → **unscheduled** via outbox cancel → queue `{}` again.
- Sponsors ledger FIRA gate: pledge row created → `POST …/advance {to:'invoiced'}` **without** a FIRA number → **HTTP 400 "Type the FIRA invoice number first — invoices are issued in FIRA, the portal only records the number."** (exact refusal verified) → test row deleted.

## S12 · Calendar/Today tasks — PASS
Calendar→tasks add "E2E FINAL task — tick me" → appears on Today → ticked on Today (toast "DONE — REMOVED FOR THE WHOLE TEAM" + UNDO) → task `status:'done'` via API; the Calendar open list drops done tasks by design → DELETE `/api/admin/tasks/:id` → gone. (s12 ×3)

## S13 · Event Day — PARTIAL (scan core is flawless; two peripheral bugs)
- **Party of 3, real mode** (seeded paid row `16434a9c…`, Member 079, guest_count 2 — creating one was impossible via API: v2 ADD GUEST hardcodes `guest_count 0`, and the public gala path refuses without Stripe — see gaps below):
  scan1 `1 of 3 admitted — 2 still to come` · scan2 `2 of 3` · scan3 `party_complete — 3 of 3 admitted — party complete` · **scan4 `over_capacity` "All 3 of this party are already in — do not admit again without an override"** (crimson state, override input offered in the UI).
- **Legacy flag exactly once:** `checked_in 0→1` on scan1, `checked_in_at 22:36:05.583Z` byte-identical after scans 2/3/4. Reverted afterwards via `/api/checkin/undo` (5-min window). Same exactly-once verified on the VIP row (`party_complete` then `over_capacity`).
- **VIP path:** v2 ADD GUEST kind:vip → confirmed/paid, no payment, scannable ✓ (soft-cancelled at cleanup).
- **Rehearsal:** TEST-6 (party of 3) through the same 1/3→2/3→3/3→over-capacity ladder with `rehearsal:true`; real gala counters stayed **36 expected / 4 admitted** throughout — rehearsal wrote only its own table; RESET cleared it. UI: quiet-state ("Quiet until the big day"), rehearsal banner, SIMULATE A SCAN admitted TEST-1 "1 of 2", INSTANT ADMIT+manual TEST-6 "1 of 3", ID-check on the real VIP row rendered the identity card (GALA REGISTERED ✓, per-door ADMIT) (s13 ×3).
- **BUG A — door-staff link URL is dead on staging:** mint works (id, QR, expiry Dec 6), but `doorUrl()` (admin `v2/event-day.js:702`) builds `https://medx-staging.onrender.com/api/v2/door/<t>` — missing the launcher's `/__admin` prefix → **404 (lands on the member backend)**, from both direct and Netlify-proxied mints. The corrected `…/__admin/api/v2/door/<t>` serves the scanner page **200 with no auth**, its `/status` is public, and **revoke → 410** exactly as specced. Prod (single-origin admin) is unaffected; staging rehearsal would hand out dead links.
- **BUG B — rehearsal codes fail in the default ID-check scan mode:** the identify-first flow (`POST /api/v2/eventday/lookup`) never checks the TEST-x rehearsal guests (only `doScan` does) → typing/scanning TEST-6 in rehearsal shows **NOT FOUND**; SIMULATE and INSTANT ADMIT work because they call `/scan` directly.
- **Gap (Alen's party doctrine):** no admin path can create/edit `guest_count` on a gala booking (ADD GUEST inserts 0; legacy PUT accepts status only) — walk-up parties can't be represented without Stripe metadata.

## S14 · Website feed integrity — PASS
- Read-only `GET https://medx-user-portal.onrender.com/api/public/status` → 200; plexus label "December 4-5, 2026 - Zagreb - Free entry"; **no E2E marker anywhere in the payload**.
- `https://www.medx.hr` → 301 → `https://medx.hr/` **200**.

## S15 · Button sweep — see `_qa/e2e-final/SWEEP.md`
**Run:** 17 routes · **283 unique controls** — **235 working** (NAV/MODAL/TOAST/NET/DOM/DOWNLOAD) · 21 skipped by policy (destructive-labelled + approve/send/mark-paid mass actions — the approve path was exercised on a purpose-made batch in S8) · 7 external links · **4 NO EFFECT** · 0 empty toasts · 0 click errors · **0 API 4xx** · **2 API 5xx** · 3 console errors. Script: `scripts/qa-admin-sweep-final.py` (adapted from the member `qa-sweep.py`: localStorage session injection, admin chrome `#chrome`/`#chrome-overlays`, per-route screenshots `sweep-*.png`).
- Because of the Netlify flap (box above) the click sweep ran against the repo's dev-server pattern (same static files, same staging `/__admin` API); the deployed origin was then re-verified route-by-route: **all 17 load with doc 200, 0 console errors, 0 API 5xx**.
- **API 5xx (2):** ① `GET /api/admin/transparency/board-pack.pdf` → **503 `print_engine_unavailable`** — headless Chrome/CHROME_PATH not present on the staging Render box (self-describing; Word export + preview unaffected). ② `GET /api/accelerator/documents/:id/download` → **500** — the KNOWN pre-existing backend defect (selects non-existent columns; already on the integration-notes fix list) compounded by the stub CV living on ephemeral disk.
- **Console errors (3):** all `Clipboard writeText: Write permission denied` from COPY-link buttons — headless-browser permission, not an app bug (0 other console/page errors across all 17 routes).
- **NO EFFECT (4):** `/inbox pickTg`, `/settings permTg` (state-dependent toggles with nothing selected), `/gala kpiSeated` (scrolls to the seating board — no DOM/net change, classifier false positive), `/member-pages tab` (re-click of the already-active tab).
- Per-route console/API detail + full click tables: `_qa/e2e-final/SWEEP.md`.

## Observed Turso replica latencies
11 · 11 · 11 · 12 · 21 · 31 · 32 · 32 · 32 · 41 · 51 · 51 · 52 · 52 s — median ≈ 32 s, max 52 s, all inside the 90 s allowance. Same-backend v2 writes instant.

## Cleanup ledger
**Reverted/deleted:** plexus detail_line · E2E session · E2E speaker · Zürich recap numbers · forum feed item (unpublished) · both announcements · E2E task · ledger test row · chase batch, nag batch, bulk-email batch (all cancelled, never approved) · member010's T1 seat unassigned · seeded row 16434a9c checked_in undone (within the 5-min window) · rehearsal table reset (×2) · both door tokens revoked (→410) · E2E registration link deactivated · e2efinal@example.com registration cancelled · E2E Party VIP guest cancelled.
**Could not be reverted (no API):** member010 gala `payment_status:'paid'` (no un-pay route; row was already E2E data) · member010 forum membership + used invite FRM-MBZT-HASF (kept as audit rows by design) · pjero's review score 4 on ACC26-001 (no score delete) · `v2_checkin_admits` rows for 16434a9c (3/3) and the cancelled VIP row (1/1) + VIP row's `checked_in:1` (undo window expired) — no admit-removal API; append-only `v2_checkin_log`/audit entries · the 2-message E2E team thread (member003↔admin; no deletion route) · the sent forum-invite e-mail row (status 'sent', dump-only delivery).
**Sweep side effects — all reverted:** 3 queued nag payment-reminder batches cancelled · the SEND LATER click on `weeklypulse-f318cfbe…` unscheduled (13 e-mails returned to pending_approval) · the ACCEPT click on ACC26-001 undone (status back to `submitted`, its offer-letter batch auto-cancelled) · sweep-minted door token revoked · sweep-minted forum code FRM-QCVK-H336 revoked · team task "ZZZ test task" un-done (back to `todo`) · Building Bridges Boston signup form reopened (`status:'open'`) · plexus Q&A question re-hidden · my unpublished feed item (republished by the sweep) unpublished again. Outbox verified **byte-identical to the pre-run baseline** (same 10 pending batch ids, 0 scheduled); chase queue `{}`. Remaining sweep residue: one 1-day snooze on a Today nag (pjero-scoped, self-expires) and the unpublished `E2E FINAL feed item` row (feed has publish-toggle only, no delete).

## Defect list (report-only; none fixed)
1. **Link attribution lost for public-form sign-ups** — member `server.js` ≈:28357 stores `invite_link_id` (null in the plexus flow) into `reg_link_token` instead of the supplied `link_token` → admin Registrations rows from shareable links are untagged (S6).
2. **Door-staff link minted with a dead URL on staging** — `doorUrl()` ignores the `/__admin` launcher prefix (S13-A).
3. **Rehearsal TEST codes → NOT FOUND in the default ID-check scan mode** — `/api/v2/eventday/lookup` lacks the TEST-guest branch (S13-B).
4. **Gala seat assignment doesn't reach member pass data** — board writes `gala_seat_assignments`; wallet/member read `seat_number` (S5; matches the open wallet build-queue item).
5. **No API path to a `guest_count>0` gala booking without Stripe** — ADD GUEST hardcodes 0; public gala register refuses when Stripe is off (S13 gap).
6. **ALL SYSTEMS pill can never be green on staging** — the e-mail-provider health check fails by design where BREVO_API_KEY is deliberately absent (+ ephemeral-disk doc check) (S1).
7. **Deployed Netlify admin origin served a broken build ~22:27–22:41Z** (default 404s everywhere, localhost config), then recovered — deploy hygiene, not app code (see incident box).
8. *Minor:* ranking CSV Average divides by all criteria (S10) · mark-all-read is PUT (a POST 404s — S7 note) · `/api/v2/eventday/overview` has no `rehearsal` flag field the UI could reconcile against (cosmetic).
