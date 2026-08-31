# Team review — consolidated (August 2026 doc)
Source: "Med&X Portals — Review & Comments (August 2026).docx". Reviewers who wrote: **Laura** (deep,
signed Aug 22), **Miro** (deep, unsigned), **Sara** (signed Aug 29), **Marija** (signed Aug 21).
Empty sections: Marina, Martina, Pjero, Ivan, Lucija, Nada, Paula.

⚠ CONTEXT: they reviewed the OLD STATIC DESIGN PREVIEWS (medx-*-review.netlify.app), not the
functional v2 builds. Most "dead button" and "sideways scroll" items are believed fixed in v2 —
each claim still gets re-verified against v2 before being marked done.

## A. Verify-against-v2 (expected already fixed in the functional build)
- All "ne rade botuni" lists (Laura §Broken, Miro's per-page lists): search, alerts, drawer,
  RESEND LINK, wallet/ticket buttons, messages switching/new/attach, network browse/search,
  ADD TO CALENDAR (v2 ships real .ics), DOWNLOAD PROGRAM PDF, profile buttons, admin form editors…
- Mobile sideways scroll on 15 screens (Laura's 390px list) — v2 built responsive; re-sweep at 390.
- Audit log future timestamp · days-to-Plexus 104 vs 103 · "0 FOLLOWING" counter · archived
  message hidden under "All" (Miro) · Boston manage / what-members-see routing (Miro).

## B. Content & wording fixes (do directly, no design tool needed)
1. Studio brand kit colours → pull from medx.hr/styles.css: ink #15110f, paper #fbf9f6,
   paper-2 #f3efe9 (red/gold stay). Add SVG + white-on-dark logo, ship real PNG (not WebP renamed).
2. Registered address everywhere: Mosećka 128, 21000 Split (footers already Split — add street where full).
3. Email templates: replace portal.medandx.com links → medx.hr; one sender identity
   (noreply@medx.hr) — fix Forum-hub "info@medx.hr" wording.
4. "ONE ACCOUNT · FIVE PROJECTS" → align with medx.hr ("Four projects, one mission").
5. Zagreb page: cathedral fact wrong (spires down post-2020; tallest = Dalmatia Tower Split) — rewrite line, keep tone.
6. Bridges mission text → Miro's version verbatim.
7. Titles unified: postnominals after name (MD, PhD), never "Dr." prefix; add Lucija to team list (Marija+Miro).
8. Accelerator: interview window ≥ Nov 15 (Marija); fellows list wrong/incomplete + add current cohort;
   fill step-by-step grey placeholder content; add cohort photos.
9. Key dates: add Building Bridges Boston; surface Donor Night to members.
10. Early-bird date: reviewers saw Sep 1 — canonical is now **Sep 15** (Alen changed it); align every mention.
11. Ticket email "reply lands in your portal inbox" vs admin "replies go to Med&X address" — pick one truth (mailbox) and align.
12. Getting-started tickboxes; CHECK IN button hidden until event day (or "check in on 4 December").
13. Photos: speakers, institutions' logos, landmarks/food (Zagreb), previous editions (Bridges, Accelerator),
    network avatars — content collection task with the team.

## C. Feature work (build queue — prioritize with Alen)
- **Refunds/cancellation/transfer** (Laura, top): policy visible BEFORE payment (Terms/Privacy/refund in member
  footer + checkout), member seat-transfer flow (promised on My Plexus!), admin refund line in Money.
- **Email template set** (Laura): payment received+receipt, payment reminder, cancelled/transferred, 7d/2d
  reminders, Accelerator received/REJECTED (must be a good letter), Forum invitation+code, Boston survey,
  certificate. HR versions driven by member language.
- **Money rebuild per Miro's exact spec**: knjiga ulaznih + izlaznih računa (columns specified), putni vs
  payment orders split (obrazac putnog naloga), radne jedinice registry with balances, reports by
  project/unit/person; COLLECTED/OWED/SPENT = all-projects incl. manual receivables (MZO); invoices
  tab = FIRA-only (matches standing rule); drop reconcile + board-pack from Money.
- **Messages**: staff identity on replies ("Laura, Med&X"), canned replies (6 recurring questions),
  MESSAGE US carries page context tag, attachments.
- **Forum**: member nomination flow, sponsorship section link, promote the Forum feed.
- **People**: unsubscribe state, GDPR consent, duplicate merge, combinable filters, export = filtered set (say so).
- **Calendar**: real PDF/CSV file downloads, editable project list, date-ranges not whole months,
  tasks carry project, done tasks strikethrough (Sara), assignees.
- **Event Day** (Sara): copy explaining scanner vs door list, "left the room" tracking, day-of ops
  task list after venue map. (Scanner two-mode ID-check already built 08-31.)
- **Studio**: photo library (Laura), badge/cert/print designers (dimensions, sponsor logos), social-card
  background options, sign-up form builder, remove 3D-planner tile (or fix link), upload buttons.
- **Plexus Hub** (Miro): fix ballroom-planner + charity-auction links, all "Edit the form fields" editors,
  drop before-the-week statuses, speaker-itineraries tool, ticket-&-prices editor (early/late, codes,
  student/employed), invite-link benefit properties editor, CME placement, gala add-tables + editable guest categories.
- **Auth**: echo the actually-typed email on confirmation screen, HR version, "why do I need an account" line.
- **FAQ** shared with canned replies · dietary captured at registration (kitchen screen ready).

## D. Decisions needed from Alen (one line each)
1. Gala canonical schedule (19:00 doors · 19:30 dinner · 21:00 awards? — 3 screens disagree).
2. Awards naming: Med&X Annual Awards vs Biomedical Forum Awards vs Gala&Awards — one name.
3. Forum gathering: two days (May 28–29) or three — fix copy accordingly.
4. Four projects or five (does the Gala count?) — affects sign-in tagline.
5. "Pre-registration" vs "Registration" for Plexus — one word everywhere.
6. Speaker tags: which of the four leaders are GALA vs PLEXUS stage.
7. Boston "Register" button: keep (portal goes live before Sept 18?) or replace with recap.
8. Reserved-but-unpaid seats at the Sep 15 price flip: honor €150 or re-price (4 people affected).
9. Seat transfer: offer it (build the flow) or remove the promise from My Plexus.

## Answers to reviewer questions (no build needed)
- Sara: scanner = QR entry incl. party-of-N; door list = manual tap-by-name backup. Inbox is
  team-shared; everyone sees replies. (Both now also in the new ID-check scanner copy.)
- Miro: outbox sends from president@medx.hr (authenticated domain since 08-30 — not spam-prone);
  system-health tiles in v2 are wired to real checks (plus the new nightly sentinel emails you+Laura on failure).

---
## STATUS 2026-08-31 (after verification + fix pass)
- **Bucket A verified** (REVIEW-VERIFY-A-2026-08-31.md): 117 claims → 93 already worked in v2,
  14 work differently, 7 dead, 3 missing. Fixed same day: file-picker preventDefault bug (UPLOAD
  PHOTO, both portals), 5 bare /member-pages deep links, 3 hub phone overflows (all 20+ screens
  now ≤396px @390). Deliberate stub: Messages ATTACH (queued C).
- **Bucket B: all shipped** (colors, Sep 15, Boston+Donor dates, check-in gating, cathedral,
  Bridges mission, reply-channel truth, titles+Lucija, sender identity, registered address).
- **Added to bucket C** from verification: People combinable filters + filter-scoped export
  wording; Gala add-tables control; editable guest categories; Studio social-card background
  options; Messages attachments.
- Bucket D (10 decisions) — waiting on Alen.

## Decisions — ANSWERED by Alen 2026-08-31 (all applied same day)
1 Gala: starts 19:00 with networking; no dinner/awards times shown. 2 Awards = "Med&X Annual
Awards". 3 Forum gathering = two days (its May closing evening is "a gala evening", not the Awards).
4 Project count sidestepped: "ONE ACCOUNT · EVERY MED&X PROJECT". 5 "Pre-registration" everywhere.
6 All four headliners tagged PLEXUS · GALA. 7 Keep "Register for Boston". 8 Price stays €150 —
early-bird deadline pushed to 2026-12-04 in prod+staging gala_settings (€175 flip parked, his call
later). 9 Seat transfer: Claude recommends BUILD (promised member-facing; pairs with non-refundable
policy) — awaiting his go in the feature ranking. 10 Accelerator opens November 15, 2026 (Marija).
