# Registration Review Gate — build notes (2026-09-06)

Bot/gibberish detection + country-based holds + country-claim coherence + an institutional-
confirmation flow, with email approval by Alen. Built in the `main-wt` worktree; nothing
committed, nothing deployed, no real emails were sent while building (hermetic stubs + dev-mode
`[Email Mock]` only). In production the review emails DO go to **juginovic.alen@gmail.com** —
that is intended.

## What ships

### 1. `user-portal/backend/review-gate.js` — NEW shared module (single implementation)
- **Gibberish heuristics** — `looksRandom()`, `suspicionScore({name, institution, position})`,
  score ≥ 2 → hold. Moved out of boston.js's module scope and refined so real registrants
  never trip it: case-flip and consonant-run counting is **per word** (Title-Case words and
  ALL-CAPS acronyms count zero — 'Tufts University School of Medicine' no longer accumulates
  cross-word flips), and `stripCredentials()` removes ', Ph.D.' / 'MD' style suffixes before
  scoring the name. Verified: the six real bot rows (incl. the verbatim
  `RQstQeTGKseNqJzmVHMmE / Ugakeu LLC / cCzNfiIdNITvvnWjrBf`) all score ≥ 2; the six real
  registrants (Ana Jaklenec Ph.D., Mladen-Roko Rasin, Tanja Petnicki-Ocwieja PhD, J Michael
  Gaziano, Katarina Ruscic + long position, Nikitha Chauhan Palthyavath) all score < 2.
- **Safe-country matcher** — `isSafeCountry()` / `countryCode()` over a variant table keyed by
  ccTLD-style code: EU-27, EEA/EFTA, UK (all spellings/parts), the full Balkans, unambiguous
  rest-of-Europe (Ukraine, Moldova, Belarus, Russia, microstates), US, Canada, Australia,
  New Zealand. Tolerant: trim/case, diacritics folded (Sjedinjene Američke Države), native and
  Croatian names (Hrvatska, Deutschland, Njemačka…), codes (US/USA/U.S./UK/GB/SAD/BiH/NZ),
  'Republic of X'. **Judgment call:** Turkey and the Caucasus states are NOT on the safe list
  (transcontinental; conservative = a cheap hold Alen can approve in one click). Blank/unknown
  → hold on the Zagreb form.
- **Country-claim coherence** — `coherenceHold({country,name,email,institution})`: a SAFE claim
  must be corroborated by ≥ 1 aligning signal, else (only if the address is free-mail) it holds
  with reason *'Claimed country does not match name/email/institution'*. Signals: (a) email
  domain = the claim's ccTLD, or institutional (.edu/.ac.*/.gov/.mil or a
  university/hospital/institute token); (b) Croatia only — name reads Croatian (č ć ž š đ,
  -ić/-ović/-ek/-ac incl. ASCII spellings, or ~90 common given names); (c) institution names
  the country (Croatia: hrvat/zagreb/split/rijeka/osijek/klinik/bolnic/KBC/sveučilišt or
  d.o.o.; elsewhere the country's own name). An unrecognized **corporate** domain alone never
  holds anyone. Verified both ways: 'Mohamed Hassan / mh8842x@gmail.com / TradeLink LLC /
  Croatia' → HOLD; 'Ivana Horvat / gmail' and 'John Smith / jsmith@kbc-zagreb.hr' → pass.
- **Tokens** — `reviewToken()`: `HMAC(JWT_SECRET,'medxrev:'+table+':'+id).slice(0,32)`
  + `.table.id` for table ∈ {bridges_registrations, croatians_abroad_registrations}; verified
  with `timingSafeEqual`. Separate contexts for the verification flow (`medxver:` page token,
  `medxver2:…:instEmail` confirm sig) so tokens are never interchangeable.
- **`buildReviewEmail()`** — branded ink/cream/gold inline-HTML: 'A registration needs your
  review', every submitted field verbatim-escaped, the reason chip, APPROVE / REJECT buttons
  + the third **ASK FOR INSTITUTIONAL CONFIRMATION** button.
- **`registerReviewHandlers(table, {approve,reject,getRow,setNotes})` + `mountReviewRoutes(app,
  {JWT_SECRET, sendEmail})`** — routes are mounted ONCE (server.js top level, before the
  /api/* 404 catch-all); each wing plugs its own table handlers into the registry (consulted
  per request, so order never matters). Wrong/forged token → branded 404 page; every decision
  idempotent (applies only while the row is still 'pending-review').

### 2. Boston flow (`user-portal/backend/boston.js`)
- `POST /api/boston/register`: score ≥ 2 → row inserted with status **'pending-review'**,
  notes marker **'HELD — review'**, `flushDb()`; NO confirmation, NO wallet links, NO sheet
  push; response `{success:true, held:true}`; review email to Alen via `deps.sendEmail`
  (= `sendEventConfirmation`, so Laura's standing CC applies). A retrying held address gets
  `{success:true, held:true}` without a second row or a second review email.
- **Honeypot**: visually hidden `website` input (off-screen CSS class `.hp`, `tabindex=-1`,
  `autocomplete=off`, aria-hidden) posted by the form JS; filled → `{success:true}` and
  NOTHING written (console line only).
- **Held-state copy** (page JS): `held:true` → headline **'Thank you for registering.'** +
  'Your registration is being reviewed — we will confirm it by email shortly.' — no wallet
  buttons, no calendar link. Honeypot drops still see the normal success (indistinguishable).
- **APPROVE** → status 'registered', notes marker '· approved <date>', standard confirmation
  (QR + wallet) via the existing `sendConfirmation`, `pushToBostonSheet` fired,
  `confirmation_sent` flipped. **REJECT** → 'cancelled', marker '· rejected <date>', no email.

### 3. Zagreb flow (`server.js`, `POST /api/croatians-abroad/register`)
- Three holds evaluated after validation, before any insert: gibberish
  (name/institution/**role**), country outside the safe list or blank, coherence fail.
  Reasons join with ' · ' when several apply.
- Held → CA row written with `conference_status`/`bridges_status`/`gala_status` =
  **'pending-review'** (selected components only); a gala selection still creates the linked
  `gala_registrations` row (status 'pending-review') and persists guests/allergies — but **NO
  Stripe checkout session, NO payment link, NO registrant email, NO Sheets webhook**. Response
  `{success:true, id, status:'pending-review', held:true}` → the /plexus page shows the
  review copy (same 'Thank you for registering.' held state). Held-duplicate emails are not
  re-reviewed.
- The confirmation email + Sheets mirror were **extracted** into `caSendPreRegConfirmation()`
  and `caMirrorPreRegToSheets()` (defined just above the route) — the untouched Path A now
  calls them, and the APPROVE handler replays the exact same code path.
- **APPROVE** → statuses flip to the normal initial values ('pre-registered' /
  'awaiting_payment' + linked gala row → 'awaiting_payment'), invite-link counter incremented,
  standard confirmation sent, Sheets webhook fired (free tabs only — a gala row reaches the
  sheet when payment confirms, as on the untouched path). For gala-inclusive approvals the
  standard email's existing 'reply and we will send you the ticket link' line covers payment —
  **the Stripe gala webhook is untouched; payment remains the filter there**. **REJECT** →
  selected statuses 'cancelled' (+ linked gala row).
- **Honeypot** on /plexus: hidden `website` input inside the form grid; silent drop.

### 4. Institutional-confirmation flow (third review action; all in review-gate.js)
- Review email button → `GET /api/review/:token/verify` (idempotent, branded 'Confirmation
  request sent.' page) → polite, unsuspicious email to the REGISTRANT ('One more step —
  confirm your registration' / 'please confirm it from your institutional email address',
  CONFIRM MY REGISTRATION → `GET /verify-registration/:vtoken`).
- Public page: one sentence + a single 'Your institutional email' input. Server-side vetting
  `checkInstitutionalEmail()` rejects free-mail (gmail/yahoo/hotmail/outlook/proton/aol/
  icloud/mail.ru/gmx/web.de/yandex/qq/163/live/msn/… + brand-label fallback for ccTLD
  variants like yahoo.co.in) and disposable domains (mailinator/yopmail/10minute/…); accepts
  everything else and records the domain. POST sends 'Confirm your registration — Med&X' to
  THAT address with `GET /verify-registration/:vtoken/confirm/:sig2`,
  `sig2 = HMAC('medxver2:'+table+':'+id+':'+lower(instEmail)).slice(0,32)` — the click proves
  access to that inbox.
- Confirm click → 'verified via <email>' marker, then the SAME approve path as the APPROVE
  button (statuses, standard confirmation **to the original registered address**, sheet push),
  FYI one-liner to Alen ('✓ <name> confirmed via <inst email> — tickets issued
  automatically.'), warm 'You are confirmed — your ticket is on its way' page. Idempotent.
- **State is restart-safe**: everything derives from HMACs + notes markers
  ('VERIFY-REQUESTED <ts>', 'VERIFY-SENT <email> <ts>', 'verified via <email>'), upserted
  without disturbing existing notes content. Outgoing emails rate-limited to one per row per
  10 minutes (marker timestamps — no in-memory state).

## Verification (all green)
- `node --check` on review-gate.js, boston.js, server.js.
- `tests/boston.test.js` — **50/50** (33 pre-existing kept passing + 17 new: honeypot
  silent-drop, held row + review email with working tokens, held-duplicate suppression,
  forged-token 404s, approve → confirmation + sheet-push-attempted (captured fetch),
  idempotent approve, reject → cancelled, full verify happy path incl. gmail rejection /
  uni.rs acceptance / sig2 confirm / FYI / idempotency, rejected-row verify links inactive,
  clean credentialed registrant untouched). One pre-existing self-skip (QR decode wants jsqr).
- `tests/review-gate.test.js` — NEW, **19/19** (6 bot rows ≥ 2; 6 real registrants < 2;
  country matcher + variants; coherence fixtures both ways; institutional-email vetting;
  token roundtrip/forgery/context separation; review-email escaping + three buttons;
  markers; route dispatch over stub handlers).
- `tests/sheets-mirror.test.js` — **7/7** (boots the MODIFIED server.js — regression check).
- **Boot test** (dev mode, port 3119, `DATABASE_PATH=/tmp/gate-boot.db`, BREVO/Stripe/Sheets
  env force-unset): server up; `/boston` 200; `/plexus` 200; honeypots present on both pages;
  Boston gibberish POST held with `[Email Mock] To: juginovic.alen@gmail.com`; honeypot POST
  silently dropped; Zagreb coherence-fraud POST (Mohamed Hassan/gmail/TradeLink/Croatia) held
  with the coherence reason; Ghana POST held with the country reason; clean Croatian POST
  confirmed normally. Live clicks: forged token 404 · approve → 'Approved.' + mock
  confirmation + 'Already approved.' on re-click · verify ask → registrant mock →
  gmail rejected → kbc-zagreb.hr accepted → confirm click 'You are confirmed.' + standard
  confirmation to the original address + FYI to Alen, idempotent · reject → 'Rejected.'.
  DB inspected afterwards: statuses and markers exactly as designed. Server killed,
  `/tmp/gate-boot.db*` removed.
- Suites that boot the ADMIN portal (gala-headcount, gala-picker-sync, gala-ticket-scan,
  member-card-toggle, post-event-autorun, wallet-checkin) cannot run in this worktree —
  `admin-portal/backend` has no node_modules here (pre-existing; `Cannot find module
  'express'`). `tests/smoke.js` targets the LIVE prod URLs and was deliberately not run.

## Operational notes / trade-offs
- Approve/reject/verify are GETs per spec — idempotency caps what a link-prefetching mail
  scanner could do, and Gmail (Alen's client) does not prefetch anchors; a scanner that hit
  both approve and reject would land whichever came first. If that ever bites, the fix is a
  confirm-button interstitial.
- Review + verification emails go through `sendEventConfirmation`, so the standing team CC
  (laura.rodman@medx.hr / CONFIRMATION_CC) receives copies — consistent with every other
  registrant-facing email; Laura's copy of a review email also carries working buttons.
- Held rows do not consume Boston capacity and are invisible to dedupe until approved;
  approval does not re-check capacity (Alen's call outranks the cap).
- CA notes gain audit markers (verify trail); the Sheets 'notes' column on an approved row
  includes them — informative, not harmful.
- Plexus `registration_links` uses counter is NOT incremented for held→approved rows (the link
  id is not persisted on the CA row; public bots come tokenless, so exposure is nil). The CA
  invite-link counter IS incremented on approve.
- `REVIEW_EMAIL` env var can override the review recipient; default
  `juginovic.alen@gmail.com`.
- Alen's boston.js module-scope draft (looksRandom/suspicionScore/reviewSig) was superseded by
  the shared module — `reviewSig` ('bostonrev:') is replaced by the 'medxrev:' scheme.

## Files touched
- `user-portal/backend/review-gate.js` — NEW (~740 lines)
- `user-portal/backend/boston.js` — gate + honeypot + held copy + handlers (~+120 net)
- `user-portal/backend/server.js` — mount + /plexus honeypot & held copy + CA gate/held branch
  + extracted confirmation/mirror + handlers (~+330 net)
- `tests/boston.test.js` — +17 tests; `tests/review-gate.test.js` — NEW (19 tests)

NOT committed/pushed (per instructions) — `git add` + commit is Alen's move.
