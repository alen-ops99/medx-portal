# FINAL AUDIT — Med&X portal v2 builds on staging (2026-08-31)

**Run:** 2026-08-30 ~23:00 → 2026-08-31 UTC · **verify-and-document only, nothing fixed** · admin `juginovic.alen@gmail.com`; members 003/025/007/040 (staging password, tokens cached against the 15/15-min login limit).
**Surfaces:** member v2 https://medx-member-portal-v2.netlify.app · admin v2 https://medx-admin-portal-v2.netlify.app · backend https://medx-staging.onrender.com (member `/api`, admin `/__admin/api`, outbox dump `/__staging/emails`). Staging now runs in **persistent Turso mode** (boot efb0e9e6; data survives restarts — cleanup mattered and was done). No production system, no real email address, no git, no deploys were touched; every email landed only in the `/__staging/emails` dump. Nothing in the admin Inbox EMAIL & OUTBOX tab labelled SEND / APPROVE & SEND was ever pressed (the sweep skip-regex was widened to enforce this).
**Cross-backend replica lag:** the two backends keep separate Turso embedded replicas; member→admin visibility ran ~35–55 s in this run (nomination 36 s, messages 52 s) — same order as the 2026-08-30 audit. All chain verifications polled across it.
**Evidence:** screenshots, CSVs, the nominator-email HTML and per-chain step JSONs in `admin-portal/frontend-v2/_qa/final-audit-2026-08-31/evidence/` (44 files, a1…h3 prefixes match the chain letters); sweep tables in `admin-portal/frontend-v2/_qa/final-audit-2026-08-31/SWEEP-ADMIN.md` and `user-portal/frontend-v2/_qa/final-audit-2026-08-31/SWEEP-MEMBER.md` (+ per-route screenshots beside them).

## 1 · Feature E2E chains — verdicts

| Chain | Verdict | Key evidence |
|---|---|---|
| (a) Forum nomination | **PASS** | confirmation copy in place; hub carried the nomination after 36 s; "put forward by Member 003 Test"; statement expands verbatim; SHORTLIST → `forum_candidates` row (source `nomination`, status `imported`) + `Your_Forum_nomination_is_moving_forward_….html` in the dump naming the colleague; decline-after-decision 409; short-statement 400; candidate row deleted via `DELETE /api/admin/forum/candidates/:id` |
| (b) Seat transfer | **PASS** | UI modal + final check ("the QR moves…"); holder columns incl. `user_id` swapped, status/payment/amount/invoice untouched; RECENT TRANSFERS strip row on /registrations; 2 dumped emails, recipient one carries `/qr/<id>.png`; immediate re-transfer 429 (24 h/seat); row restored byte-identical (see cleanup log) |
| (c) Money | **PASS** | AUD-X unit, AUD-OUT-001 row (nefisk.), PUT-2026-001 auto-number; OWED +100 / SPENT +50 then back to baseline; CSV labels `· AUD-X · 1 redak` and files match counts (book 1, travel 1, units 1); fiscalized w/o FIRA number → UI toast "TYPE THE FIRA INVOICE NUMBER…" + API 400; referenced-unit delete 409; all rows deleted via their own ✕ |
| (d) Messages | **PASS** | ?about=gala preselects the GALA chip + focused composer; admin thread row carries GALA chip after 52 s; 6 seeded saved replies incl. the FIRA one; picker inserts with {first_name} resolved; "Replying as Alen · Med&X" note; member sees "ALEN JUGINOVIĆ · MED&X"; PNG thumbnail + download 200 both directions |
| (e) People | **PASS** | MAILING toggle → dark UNSUBSCRIBED chip, source `admin`, searchable by typing "unsubscribed"; strip found the planted pair (SAME NAME ×2 / SAME EMAIL START ×1); merge → 1 row suppressed, survivor `absorbed`; UNDO → 2/2 back; MEMBERS+GALA union → label `EXPORT CSV · 46 → 68 FILTERED`; CSV = exactly 68 rows |
| (f) Studio | **PASS** | upload → library row; tag `sponsor`; photo offered as social background; 1080×1080 PNG downloaded; settings persisted `{size a6, 148×105, sponsor_strip true}`; preview = A6 sheet (148×105 cells, sponsor strip in markup); render → 503 `print_engine_unavailable` (staging box has no headless Chrome — environment, self-describing); asset soft-deleted, settings restored |
| (g) Gala | **PASS** | T-AUD (cap 2) created; scrubbed guest seated from the UNSEATED strip → toast "…WALLET PASS UPDATES TOO" and `gala_registrations.seat_number = T-AUD` (the 2026-08-30 defect #4 is FIXED); tile 1/2; unassign clears the mirror; table deleted; category `audit-cat` added → renamed (key stable) → archived; picker shows only the live set (`INVOICE — €150 / VIP — FREE / SPONSOR SEAT`) |
| (h) Wallet/day | **PASS** | member025 my-status intact after all the churn (same reg id); ID-check lookup resolves the scrubbed code (person + 3 doors, read-only); rehearsal party TEST-6: admitted → admitted → ALL IN → **over_capacity** with the crimson card (rgb(155,27,34) border, #f8e9ea fill); door-token URL now carries the `/__admin` prefix (2026-08-30 defect #2 FIXED), page 200 → revoked 410; rehearsal reset via its own endpoint |

Chain step detail (every check + evidence line) is in the per-chain JSONs in the session scratchpad; the notable notes:

- **(b) note** — the transfer-BACK leg was not exercised through the member flow: the audit harness deleted the 24 h rate-limit row only after its poll (script ordering bug, not the app), so every back-attempt correctly hit the 429 guard. Restoration was done directly on the staging Turso DB instead (see cleanup log) and verified byte-identical. The forward flow, both emails, the strip and both guards are fully verified.
- **(d) note** — `{first_name}` in saved replies substitutes the FIRST TOKEN of the thread display name (`Laura Rodman` → `Laura`, correct; the scrubbed seed name `Member 003 Test` → `Member`). A real multi-word first name (`Ana Marija`) would also be cut — minor, listed under defects.
- **(f) note** — badges/print PDF render 503s on staging by environment (no headless Chrome/CHROME_PATH on the Render box) — the same self-describing 503 the 2026-08-30 audit logged; preview path fully verified instead.
- **(h) note** — 2026-08-30 defect #3 re-tested and **still present**: TEST-1…6 codes → NOT FOUND in the default ID-check lookup (`/api/v2/eventday/lookup` has no TEST-guest branch); rehearsal scanning in INSTANT mode handles them fine.

## 2 · Whole-portal control sweep (desktop 1280)

Reused the repo sweep harnesses (`scripts/qa-admin-sweep-final.py`, `scripts/qa-sweep.py`) with a **widened skip-regex** so the audit clicks nothing that sends, approves, queues, publishes, pays, merges, imports or mutates seeded state (34 admin + 19 member controls sat out, each listed as SKIPPED in the sweep tables). Empty-field ADD probes that 400 with a validation toast count as working validation, per the established rule. Full per-control tables: `SWEEP-ADMIN.md` / `SWEEP-MEMBER.md` in the two `_qa/final-audit-2026-08-31/` dirs.

| Portal | routes | controls | WORKS | SKIPPED (by audit rule) | DEAD (no effect / empty toast) | BROKEN (click error) | console errors | API 5xx | API 4xx |
|---|---|---|---|---|---|---|---|---|---|
| Admin v2 | 17 | 283 | 213 | 34 | 4 | 0 | 3 | 1 | 1 |
| Member v2 | 13 | 155 | 115 | 19 | 1 | 0 | 0 | 0 | 0 |

**Admin detail** — 7 further controls are EXTERNAL links (left unclicked by design: the 3D planner, live-page links, etc.). The 4 DEAD are the same four state-dependent classifier false-positives the 2026-08-30 sweep already adjudicated (`/inbox pickTg` and `/settings permTg` are toggles with nothing selected, `/gala kpiSeated` scrolls to the board with no DOM/net change, `/member-pages tab` is a re-click of the already-active tab). The 3 console errors are all headless-Chromium `Clipboard writeText: Write permission denied` from COPY-link buttons (forum ×2, bridges ×1) — browser permission, not app code. The 1×API 4xx is the sweep’s own empty-field probe (`400 POST /api/v2/money/work-units`, validation working; no row created — verified). The 1×API 5xx is `500 GET /api/accelerator/documents/:id/download` — the **known pre-existing** backend defect (selects non-existent columns; stub CV on the ephemeral disk; already on the integration-notes fix list; also logged 2026-08-30).

**Member detail** — a fully clean sheet: 0 console errors, 0 API 5xx, 0 API 4xx, 0 click errors. The 1 DEAD is `setEN` on `/app/profile` — the language chip re-clicked while English is already active (aria-pressed already true; `setHR` right beside it works and toasts) — the same re-click-of-active-state false-positive class as the admin four. 2 controls are EXTERNAL links.

Row accounting: controls are counted when seen; those that turn out zero-size/off-viewport at click time are passed over without a table row (25 admin, 18 member) — visibility artifacts of collapsed drawers, not dead controls.

## 3 · Phone pass — every route at 390 px (`document.documentElement.scrollWidth` ≤ 396)

| Portal | Route | scrollWidth | Verdict |
|---|---|---|---|
| admin | `/` | 390 | OK |
| admin | `/projects/plexus` | 390 | OK |
| admin | `/projects/accelerator` | 396 | OK |
| admin | `/projects/forum` | 390 | OK |
| admin | `/projects/bridges` | 390 | OK |
| admin | `/gala` | 390 | OK |
| admin | `/inbox` | 390 | OK |
| admin | `/people` | 390 | OK |
| admin | `/money` | 390 | OK |
| admin | `/calendar` | 390 | OK |
| admin | `/studio` | 390 | OK |
| admin | `/settings` | 390 | OK |
| admin | `/event-day` | 390 | OK |
| admin | `/registrations` | 390 | OK |
| admin | `/links` | 1664 | **OVERFLOW** |
| admin | `/member-pages` | 390 | OK |
| admin | `/accelerator-review` | 390 | OK |
| member | `/app/home` | 390 | OK |
| member | `/app/plexus` | 390 | OK |
| member | `/app/plexus/program` | 390 | OK |
| member | `/app/plexus/zagreb` | 390 | OK |
| member | `/app/gala` | 390 | OK |
| member | `/app/accelerator` | 394 | OK |
| member | `/app/forum` | 390 | OK |
| member | `/app/bridges` | 390 | OK |
| member | `/app/network` | 390 | OK |
| member | `/app/messages` | 390 | OK |
| member | `/app/me` | 390 | OK |
| member | `/app/profile` | 390 | OK |
| member | `/app/projects` | 390 | OK |

**29/30 OK. One offender: admin `/links` → scrollWidth 1664 at 390 px.** Cause: the invite-link rows print the full share URL in an unbroken monospace `<span>` (the diaspora `/invite/eyJ…` token URL measures 1627 px) with no overflow wrapper or word-break — the row flex-wraps but the span itself cannot. Screenshot `evidence/phone-OFFENDER-admin-links.png`. `links.js` was not part of the 8-feature wave (pre-existing).

## 4 · Wiring inventory — go-live checklist (§6 of design/PORTAL-CONNECTIONS-MASTER-2026-08-28.md) vs what this audit saw

§6 still correctly names: CORS allowlist + `CORS_ORIGIN` comma list · CSP hosts · server-rendered path survival (incl. `/qr/:id.png`, which the new transfer emails link) · SPA fallback rules (`/app/*` is what member v2 uses — compliant) · SW cache stamping · `mxt` hand-off (present in the deployed member v2 index.html) · Stripe return URLs · env-var list · CI guards · content prerequisites. The v2 backend modules **self-mount** (both `server.js` files scan `v2/*.js` before the 404 handler) and all new tables are guarded `CREATE TABLE IF NOT EXISTS` at boot — so a deploy of this branch brings every new route/table up without a migration step. Verified live on staging: all wave-1/2 endpoints answer.

**Gaps §6 does not yet name (from what this audit exercised):**

1. **`CLOUDINARY_URL` on the ADMIN service is now functional, not a flag.** §6.6 says "CLOUDINARY_URL (member; admin as flag)" — since the Studio photo library and message attachments, the admin backend genuinely uploads (`medx/studio`, `medx/messages`). `cloudinary@^2.9.0` is already in `admin-portal/backend/package.json` (the BUILD-STUDIO ops note is satisfied); the env var line should move the admin from "flag" to required-for-uploads.
2. **`CHROME_PATH` (headless Chrome) on the admin service** — without it `/api/v2/studio/badges/render`, the print suite and the legacy board-pack PDF all 503 `print_engine_unavailable` (seen live on staging). It sits in Appendix E's generic "42 undeclared names" but deserves its own §6 line now that Studio render buttons are first-class.
3. **Email-template wiring is absent from §6** — `user-portal/backend/v2/email-wiring-notes.md` enumerates **8 wiring points** (paymentReceived, paymentReminder, registrationCancelled/seatTransferred/transferReceived, eventReminder, accelerator letters, forumInvitation, certificateOfAttendance, surveyMorningAfter), none wired yet; additionally two NEW inline senders carry `TODO: swap to email-templates` markers (`v2/transfer.js` → seatTransferred/transferReceived family, `admin v2/forum-ops.js` → forumInvitation family). A go-live line should either wire them or accept the legacy bodies consciously.
4. **Direct member-emails vs the Outbox-OK rule** — the forum-nomination shortlist note and both seat-transfer confirmations send **directly** via `ctx.sendEmail` (on prod = Brevo, no approval step). If the "nothing emails a member without an Outbox OK" doctrine should cover them, they need rerouting through `scheduled_emails` (BUILD-FORUM-NOM already flags this). §6 has no line for it.
5. **Admin v2 SPA cutover is out of §6's scope** — §6 is titled for the member portal + medx.hr; nothing covers pointing the production admin at frontend-v2 (serving it from the admin Render service or keeping a Netlify origin: CSP `connect-src`, CORS, and the `/uploads` CORP/proxy question for cross-origin thumbnails — staging solves it with the `_redirects` proxy + the admin mirror route's CORP header; BUILD-MESSAGES notes the member-side static route still helmet-blocks cross-origin thumbnails, cosmetic once Cloudinary URLs are absolute on prod).
6. **`USER_PORTAL_URL` on the admin service** — now read by three v2 modules (people invite links, gala-ops, studio QR verify) with an onrender.com default; undeclared in render.yaml (inside Appendix E's 42) — worth naming since member-facing links break quietly if unset.
7. **Wave-specific data prerequisites** are absent from §6.8: `v2_gala_categories` seeds the historic trio only when empty; canned replies seed 6 drafts only when empty; `v2_money_work_units` starts empty (books/travel/payment-orders reference it) — all self-healing, listed for awareness.

## 5 · Console hygiene (target: zero uncaught errors)

Uncaught errors found, by route, across the chains, both sweeps and the 390 px pass:

| Route | Error | Adjudication |
|---|---|---|
| admin `/projects/forum` | `pageerror: Clipboard writeText: Write permission denied` ×2 (COPY code/link buttons) | headless-browser permission, not app code — same 3 as 2026-08-30 |
| admin `/projects/bridges` | `pageerror: Clipboard writeText: Write permission denied` ×1 | same |
| member (all 13 routes) | — none — | clean |

No other uncaught console/page error appeared anywhere (all 8 chains ran clean; the 390 px pass logged none). `Failed to load resource` noise lines were excluded per the established rule where they belong to deliberate 4xx guard probes; the only organic batch was ~5 resource-404s while `/studio` loads its STORED FILES card — seeded `content_studio_assets`/file rows whose binaries live on the ephemeral disk and vanish at cold start (staging-data artifact, not app code).

## 6 · Cleanup log

**Everything created by the audit was reverted via the app's own delete/undo endpoints, except where noted.** Verified against a table-count baseline + final diff on the staging Turso DB.

Reverted (own endpoints): money book row AUD-OUT-001, travel order PUT-2026-001, work unit AUD-X (after the 409-while-referenced guard test) · people: both `audit.dup*` contacts (`DELETE /api/contacts/:id`), merge undone in-session (`v2_people_merges` empty), unsubscribe overlay cleared to NULL then the inert flags row removed (see below) · forum: shortlisted candidate row (`DELETE /api/admin/forum/candidates/:id`) · studio: asset soft-deleted (row kept by design), badge settings restored to `{std, 90×55, strip off}` · gala: T-AUD table deleted (guests unseated first), seat mirror verified NULL again · messages: the temp saved reply deleted (6 seeds intact) · event-day: door token revoked (page 410), rehearsal admits cleared via `/rehearsal/reset` · seat transfer: seat back with member025.

Direct staging-DB touches (staging Turso only — documented, smallest possible):
- `DELETE FROM v2_seat_transfers` ×1 row (the audit's own forward-transfer audit row; table back to 0).
- `UPDATE gala_registrations` ×1 row (cfb9a158…): holder columns restored to the pre-run snapshot after the flow-based back-transfer was blocked by the (correct) 24 h guard; byte-identical verified.
- `DELETE FROM v2_people_flags` ×1 inert NULL row for member040 (created by the audit; output-equivalent either way).

**Could not be reverted (no route by design — residue):**
- `v2_forum_nominations`: 2 rows for the fake nominee (`audit.nominee@staging.medx.hr`) — one `declined`, one `shortlisted`; kept as audit trail by design.
- `v2_gala_categories`: 1 archived row `audit-cat` ("AUDIT CAT RENAMED") — categories archive, never delete.
- `direct_messages`: 3 audit messages member003 ↔ team (2 with PNG attachments) — no delete route.
- `v2_studio_assets`: 1 soft-deleted row (`deleted_at` stamped; file on the ephemeral disk).
- `v2_checkin_log`: rehearsal-tagged scan rows + `audit_log` entries — append-only by design. No real `v2_checkin_admits` rows were written.
- Dumped emails in `/__staging/emails` (nomination + 2×2 transfer emails) — ephemeral disk, wiped at the next cold start.

**Sweep side effects — all audited row-by-row and reverted** (the sweeps click every non-skipped control, so a handful of one-click mutations slipped past the widened skip-regex; each was traced via a table-count baseline + the sweep tables and undone via its own endpoint):
- `later` on the outbox scheduled the weeklypulse-f318cfbe batch (13 emails, sends-tomorrow) → **unscheduled** (`POST /outbox/:batch/unschedule`, 13 returned to pending_approval; nothing was ever sent — staging dumps anyway).
- `nagAct` queued a 1-email payment-reminder batch (nag-2e835d7d, pending_approval — an APPROVE click away, never given) → **cancelled** via `POST /api/admin/outbox/:batch/cancel`. The row stays as `cancelled` (audit trail; same class as the four cancelled nag rows the 2026-08-30 audit left).
- `taskDone` ×2 marked the team tasks "ZZZ test task (safe to delete)" and ";ojpojpo" done → both set back to `todo`.
- `formToggle` closed the Building Bridges Boston sign-up form → **reopened** (`status: open`).
- `qaHide` unhid the previously-hidden plexus Q&A question → **re-hidden** (both E2E questions hidden again, the pre-sweep state).
- `repub` republished the prior audit's unpublished "E2E FINAL feed item" → **unpublished again**.
- `rehSim`/`doorIn` ran rehearsal-mode practice scans (the sweep had toggled Rehearsal ON first, so NO real `v2_checkin_admits` row was written — verified: the only 2 admit rows predate this audit) → rehearsal table **cleared** via `/rehearsal/reset`; +2 append-only `v2_checkin_log` rehearsal rows remain (by design).
- Member side: the profile toggles + `save` had persisted `locale: hr`, flipped `is_public_profile`/`updates_opt_in` and added the NEUROSCIENCE specialty → **profile restored** (specialties back to `["SLEEP MEDICINE (E2E)"]`, public + updates true, locale en). `tgFollow`/`interested`/`notify`/`followRm` netted to one `notify_topics` row (gala) → **removed** (`on:false`; table back to 0 rows for member003, matching the seed). `archive` archived the team thread → **unarchived**. `hideStart` dismissed the profile-nudge card → dismissal row **removed** (did not exist pre-sweep).
- Idempotent no-content-change effects left as-is: unchanged-value re-saves (`msSave`, `instSave`, `gatherSave`, `evSave`, `rcSave`, `notesSave` — same data re-written, only timestamps), one self-expiring 1-day nag `snooze` (admin-scoped; the prior audit left the identical item), health-check `run` (diagnostics), bell/alerts mark-seen, thread mark-read stamps.

**Final residue diff vs the audit baseline** (staging Turso, table counts): only `v2_checkin_log` +2 (append-only rehearsal rows) and `scheduled_emails` pending 91 / cancelled 10 (the cancelled nag row) — every other tracked table byte-count-identical. Nothing is left scheduled; the outbox pending set is the pre-audit set.

## 7 · Defect list (report-only; none fixed)

New from this audit (all minor):

1. **Admin `/links` overflows at 390 px** (scrollWidth 1664): invite-link rows print the full share URL in an unbroken monospace span (diaspora `/invite/eyJ…` token measures 1627 px) with no overflow wrapper/word-break. Pre-existing screen, not part of the 8-feature wave. Screenshot: `evidence/phone-OFFENDER-admin-links.png`.
2. **Saved-reply `{first_name}` substitutes the first whitespace token of the thread display name**, not the `users.first_name` field — correct for `Laura Rodman` → `Laura`, wrong whenever first_name itself contains a space (Croatian double names like `Ana Marija` → `Ana`; the scrubbed seed `Member 003 Test` → `Member`, which is how it surfaced). Cosmetic.

Re-verified pre-existing (unchanged by the wave, still open):

3. **TEST codes → NOT FOUND in the default ID-check lookup** (`/api/v2/eventday/lookup` lacks the TEST-guest branch) — 2026-08-30 defect #3. Rehearsal scans in INSTANT mode resolve them fine.
4. **`GET /api/accelerator/documents/:id/download` → 500** — known backend defect (bad column select + ephemeral stub file), on the integration-notes fix list.
5. **Print engine 503 on staging** (`print_engine_unavailable`) for Studio badge/print renders — environment (no headless Chrome on the free Render box), self-describing; wire `CHROME_PATH` at go-live (§4 gap 2).

Fixed since 2026-08-30 and confirmed by this audit: **defect #2** (door-staff link URL now carries the `/__admin` staging prefix via the `x-medx-staging-prefix` header) and **defect #4** (gala table assign/unassign now mirrors `gala_registrations.seat_number`, so wallet passes update).
