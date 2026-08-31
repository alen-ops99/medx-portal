# Host brief — build notes (2026-08-31)

Ports the OLD portal's "who is coming tonight" one-pager into the v2 ADMIN Event Day room.
Built and verified locally — **nothing deployed, no git, no emails, no live DB touched, and NO
external AI/LLM calls**: the brief is composed **deterministically** from the registration
tables (staging has no API keys; a templated brief that reads well beats a dead OpenAI call,
and every number stays auditable against the door list).

## Files touched (the owned set)

- `admin-portal/backend/v2/host-brief.js` — **NEW**, mounted automatically by `v2/index.js`
  (filename passes its `/^[a-z0-9-]+\.js$/` filter). One route, zero tables, zero writes.
- `admin-portal/frontend-v2/js/views/eventday.js` — **additive only**: a HOST BRIEF card +
  three handlers + a print-only stylesheet injection. Scanner (ID-check + instant), door
  lists, rehearsal and door tokens untouched — the render smoke asserts they still render.

Everything else was read-only recon: `v2/index.js` conventions, `v2/event-day.js` (gating +
inclusion rules), `v2/gala-ops.js` (`v2_gala_categories`), `server.js` registration-table DDL
(~3178–8290, registrant_notes ~4345/12569), `shared/db.js`, and a read-only peek at
`deploy/staging/seed.db` for real value distributions (payment_status 'pending' exists beside
'unpaid'; countries arrive as "USA"/"United States"/"Österreich"; gala pricing is mostly NULL).

## Backend — GET `/api/v2/host-brief?event=conference|gala|bridges` (+ `donor`)

- **Gate**: `auth` + a locally declared `staffOrAdmin`, byte-for-byte the gate
  `v2/event-day.js` uses for the scanner family. Bad/missing `event` → 400 JSON.
  `donor` is accepted beyond the spec'd three because the Event Day room has four doors and
  the card follows the door picker; it scopes to the Donor Night `bridges_events` row.
- **Read-only by construction**: the module builds only `q.get`/`q.all` helpers (no `run`),
  owns no DDL; the unit harness booby-traps `db.run` after seeding to prove zero writes.
  Tables other modules own (`v2_checkin_admits`, `v2_gala_categories`) are read behind
  try/catch and simply thin the brief before those modules' first boot.
- **Inclusion mirrors event-day.js** so brief and door list never disagree: conference =
  registrations (not revoked/cancelled) + CA `selected_conference`; gala = gala_registrations
  (not cancelled — paid AND pending, the pending ones are the door problem) + CA
  `selected_gala` with **no** linked gala registration; donor/bridges split
  bridges_registrations by the donor event id; CA rows with SCANNER/BUNDLE TEST notes are
  excluded everywhere. One booking = a party of `1 + guest_count`.
- **The brief** (JSON + `text` plain-text twin):
  - `headline` — people incl. parties, bookings, plus-ones, paid/pending/free people
    (per-table pay rules: gala `paid|vip-comp`; CA-gala `gala_payment_status`; conference
    `paid`, unticketed rows count as free entry; bridges `n/a` = free evening), distinct
    institutions and countries (multilingual spellings canonicalised — "USA"/"United
    States" → United States, "Österreich" → Austria — unknown spellings kept verbatim).
  - `notable` — VIP/sponsor **category** guests (`gala_registrations.pricing` resolved
    through `v2_gala_categories` labels, `vip-comp` payment status included; `invoice`/
    `bundle`/`waitlist` are not notable), guests with `admin_notes` / CA/bridges `notes` /
    append-only `registrant_notes` (snippet in the tag), and parties of 3+. Ranked
    categories → notes → parties, capped at 12.
  - `dietary` — kitchen buckets (vegan/vegetarian/gluten-free/lactose-free/halal/kosher/no
    pork/pescatarian/allergy, English + Croatian keywords) **plus the verbatim lines with
    names** — the kitchen works from the exact words, diacritics untouched — and the count
    of plus-ones with no dietary info.
  - `arrivals` — present only when someone is actually in: `v2_checkin_admits` sums plus
    legacy-only checked_in rows (same side-by-side arithmetic as event-day's counters);
    parties started vs complete.
  - `talking_points` — auto-derived one-liners, e.g. "3 guests from Sveučilište u Zagrebu —
    largest delegation", "2 unpaid seats to resolve at the door (1 booking)", "Notable
    seats: 1 × VIP — free · 1 × Sponsor seat (…) — greet by name at the door", "Largest
    party: … — 3 people on one QR", "Kitchen: …", "2 of 8 already in — 1 party arriving in
    parts". Zero data → ok:true, empty:true and one friendly line.
  - `text` — the same one-pager as plain text for COPY AS TEXT (pasteable to Alen).

## Frontend — HOST BRIEF card on Event Day

- Full-width card after the staff/map/Q&A grid, dc-marked
  (`<!-- dc: v2 addition › "HOST BRIEF" -->` + `data-v2` attribute), crimson top rule.
  Renders for the **selected door** and refetches on door change (stale responses from a
  quick door flip are dropped by a gate-token check). Loading / locked (403 §perms) / error /
  empty states all render; rehearsal shows a note that the brief reads the real list.
- **PRINT** — `window.print()` with a print-only stylesheet: the view's CSS-injection
  pattern is the id-guarded head link (`mx-css-event-day`); the print sheet uses the same
  id-guarded injection but inline `<style id="mx-css-hostbrief-print">` because
  `css/views/event-day.css` is outside this build's owned set. Scoped to
  `body.mx-hb-print`, set only while the button prints a dedicated `.mx-hb-printbox` twin
  (clean black-on-white, pt-sized) — a normal ⌘P of the page is pixel-identical to before.
  Cleanup on `afterprint` + a 1.5 s fallback (Safari).
- **COPY AS TEXT** — puts the backend's `text` on the clipboard (async API, hidden-textarea
  `execCommand` fallback for http/permission-blocked contexts), flips to ✓ COPIED, toasts.
- Croatian diacritics render end to end (asserted in DOM, clipboard and print sheet).

## Verification (all green, 2026-08-31)

- `node --check admin-portal/backend/v2/host-brief.js` ✓ · `require()` loads, arity 2 ✓ ·
  the view imports clean as an ES module ✓.
- **`node tests/host-brief.test.js` — ALL 43 PASSED.** Stub-express mount over an
  **in-memory libsql** DB (the real `shared/db.js` wrapper) seeded with a small Plexus
  evening: headline counts (8 people / 5 bookings / 6 paid / 2 pending / 5 institutions /
  Österreich→Austria), notable selection (VIP + sponsor + admin_notes + registrant_notes +
  party of 3), kitchen buckets + verbatim diacritics, arrivals from `v2_checkin_admits`
  (+ legacy), donor/bridges scoping, zero-data graceful empty brief, 401/403/400 gates, and
  the read-only booby trap (any `db.run` throws — never fired).
- **`python3 tests/host-brief-render-smoke.py` — ALL 18 PASSED.** Real frontend-v2 module
  tree in Chromium (route-intercepted from disk, APIs stubbed with fixtures the real backend
  produced): card renders with header/date/stats, diacritics in DOM, PRINT isolates the
  brief (printbox + body class during `print()`, cleaned up after), clipboard carries the
  full plain-text brief, door switch refetches, empty door graceful, **scanner + door list
  still render**, zero page errors.

## Integration notes for the next engineer

- No schema changes, no new env, no seed changes. The endpoint goes live the moment this
  branch boots; `/api/v2/_status` will list `host-brief` among the mounted modules.
- If gala-ops renames categories, the brief follows automatically (labels are read live);
  archived categories still resolve for already-tagged guests.
- The brief deliberately counts pending gala bookings that `expectedPeople()` (scanner
  counter) excludes — the counter predicts admits, the brief warns the host. Documented here
  so the difference is not "fixed".
