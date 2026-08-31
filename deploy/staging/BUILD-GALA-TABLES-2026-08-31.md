# Gala table-management upgrade — build notes (2026-08-31)

Ports the OLD portal's gala table tools into the v2 ADMIN Gala destination and brings the
external 3D ballroom planner loop beside the seating board. Built and verified locally —
**nothing deployed, no git, no emails, no live DB touched** (the one new table's DDL + seed are
guarded in code and run at the next boot).

## Files touched (the owned set)

- `admin-portal/backend/v2/gala-ops.js` — `v2_gala_categories` DDL + empty-table seed, category
  CRUD routes, per-guest re-tag route, live-set validation on ADD GUEST, categories in the overview
- `admin-portal/frontend-v2/js/views/gala.js` — table tools on the board, unseated strip,
  live category picker + chips + ✎ re-tag + manager modal, 3D-planner card with CSV import
- `admin-portal/frontend-v2/css/views/gala.css` — responsive/focus additions only (per
  ARCHITECTURE.md §4 the look stays inline)

Everything else was read-only recon (`server.js` legacy gala endpoints ~12630–12965, the
user-portal wallet/pass readers, `shared/db.js`).

## 1 · Add / edit / remove tables on the seating board

- **+ TABLE** in the board header and a **✎ on every tile** — create (label · capacity · notes,
  next free "T#" prefilled), edit, and DELETE TABLE (typed confirm) all go through the EXISTING
  legacy routes `POST/PUT/DELETE /api/admin/gala/tables[/:id]`; nothing is duplicated in v2.
- The table editor lists who is **SEATED HERE** with a per-guest ✕ (existing
  `POST /api/admin/gala/unassign`); the board keeps per-tile **occupancy vs capacity** (n/cap,
  gold when full) and gains an **UNSEATED — n** strip: click a guest chip, pick a table (full
  tables disabled), and the existing `POST /api/admin/gala/tables/:id/assign` seats them — that
  route mirrors `seat_number` onto the registration, so **wallet passes update** (the 2026-08-31
  server-side mirror; delete/unassign clear it again server-side).
- `ensureTables()` now seeds the default 10×8 room **only when the board is completely empty**
  (it used to top back up to 10 — that would have silently re-inflated a deliberately smaller,
  now-editable room). Room capacity, the waitlist math and the KPI strip already follow
  `SUM(gala_tables.capacity)`, so table edits move all of them live.

## 2 · Editable guest categories (the fixed INVOICE / VIP — FREE / SPONSOR SEAT trio becomes data)

- New table `v2_gala_categories (id, key, label, color, sort, archived)` — seeded **only when
  empty** with exactly the historical three: `invoice · #9b1b22`, `vip "VIP — free" · #7a6432`,
  `sponsor "Sponsor seat" · #1e6e42`.
- **Storage stays compatible**: recon confirmed the category lives in
  `gala_registrations.pricing` (v2 add-guest writes `invoice|vip|sponsor`, waitlist-accept writes
  `waitlist`, the v1 public flow also has `bundle`). Category **keys are those very values**;
  renames change the label, never the key; archiving hides a category from pickers while tagged
  guests keep resolving. Unknown legacy keys (`bundle`, …) fall back to the plain PAID chip, and
  a re-tag select shows them as "BUNDLE — LEGACY".
- Routes (all auth+adminOnly, in gala-ops.js): `GET/POST /api/v2/gala-ops/categories`,
  `PUT /api/v2/gala-ops/categories/:id` (rename / recolor / sort / archive+restore, with a
  last-live-category guard), `PUT /api/v2/gala-ops/registrations/:id/category` (re-tags ONE
  guest — pricing only, payment state and status deliberately untouched). The overview now
  carries `categories` so the screen stays a one-read.
- UI: the ADD GUEST picker is built from the live set (INVOICE keeps its dynamic
  "— €price" suffix; behaviour stays keyed on `invoice` alone — every other category counts as
  paid, exactly like VIP/sponsor did). Paid chips render the category label in its color. A ✎
  beside the chip swaps in a re-tag select. **EDIT CATEGORIES** (in the add panel) opens the
  small manager: color swatch + rename-in-place + ARCHIVE/RESTORE + add row, stable key shown.
- ADD GUEST server-side now validates `kind` against the live set (a dead/archived category is
  refused); the invoice path still stages the payment email as `pending_approval` in the outbox
  (FIRA-on-payment untouched — no invoice documents from portal code, per the standing rule).

## 3 · 3D ballroom planner card (under the board)

- **OPEN THE 3D PLANNER ↗** → https://plexus-tables.netlify.app (new tab, `rel=noopener`; the
  Firestore-backed picker stays fully decoupled — no Firebase creds in the portal).
- **IMPORT CONSOLE CSV** → file picker → EXISTING `POST /api/admin/gala/table-assignments/import`
  (header columns `table,name,email`, per the route: quote-aware split, upsert by
  `lower(email)` so re-imports update rather than duplicate) with an inline result summary
  ("IMPORTED — n NEW · n UPDATED · n SKIPPED") and a toast.
- **CONSOLE ASSIGNMENTS** list (scrollable) shows the email-keyed `gala_table_assignments` rows
  as "Stol N · name · when", each with ✕ (existing DELETE route).
- Source-of-truth note on the card (verified in user-portal code): **wallet passes print the
  table from THIS board** — the Apple pass and the member wallet card read
  `gala_registrations.seat_number`, i.e. the assign mirror; the console list fills "Stol N" on
  the member Gala page (and the Google Wallet ticket) by email match and **wins there** when both
  exist (`/api/gala/my-seat` checks the console import first, then falls back to the board plan).

## Verification (all green, nothing live touched)

- `node --check` on gala-ops.js · `node --input-type=module --check` on gala.js.
- Stub-express mount on a REAL in-memory libsql DB (`shared/db.js` wrapper, `:memory:`):
  16 routes register (4 new; auth+adminOnly everywhere but the public accept page), DDL + seed
  run, a second mount does not re-seed, and the handlers were exercised end-to-end — add /
  duplicate-slug guard / rename-keeps-key / per-guest re-tag / live-set add-guest / invoice
  email staged `pending_approval` / archive-last-guard / restore / `overview.categories`.
- Playwright render-smoke against the static dev-server with EVERY `/api` call intercepted
  (fixtures; no backend, no DB): screen renders clean-console; board tiles + occupancy + no
  auto-seed at 3 tables; + TABLE → `POST /tables {label:'T4',capacity:8}`; tile ✎ → unassign +
  PUT save + confirmed DELETE; unseated chip → `POST /tables/t2/assign`; picker parity
  (`INVOICE — €150 / VIP — FREE / SPONSOR SEAT` + live `MEDIA PASS`, archived hidden); custom
  chip `MEDIA PASS · PAID` + legacy `bundle` fallback; ✎ re-tag PUT; CSV import posts the file
  and shows "2 NEW · 1 UPDATED"; console-row ✕ DELETE; manager add + archive. The existing
  qa-admin-gala.py selectors (`tableSel`, `ngKind` value `vip`, tile text `n/8`, …) were kept
  compatible.

## Old-portal gems spotted during recon (NOT built — for Alen to pick from)

1. **Gala → picker automatic invite sync** (`/api/admin/gala/picker-sync[/run|/send-invites]`,
   server.js ~12803–12965): the portal as source of truth for the 3D picker's Firestore invites —
   auto-create on paid/confirmed, auto-revoke on refund/reject *unless the guest already picked a
   table* (flagged for a human), console-made "foreign" invites never touched, approval-gated
   bilingual "Odaberite svoj stol" mails with per-language deadlines fetched live from the picker
   config, debounced post-commit runs + 30-min sweep. Replaces this CSV loop entirely; no v2 UI.
2. **Who-is-coming intelligence brief** (`GET /api/admin/gala/who-is-coming`): per-institution
   rollup + regex-flagged senior guests (prof/dean/CEO/…) + an AI host brief with a deterministic
   fallback. Would sit beautifully on the Gala screen.
3. **Registrant activity timeline + append-only notes** (`/api/admin/registrant/:type/:id/activity`
   + `/notes`): one per-person history — registered → paid → checked in, audit-log mentions,
   direct messages, admin notes. v2 People/Registrations only mark-paid/resend today.
4. **Per-guest program notify** (`POST /api/admin/gala/program/notify`): personalized
   program-announcement that routes portal-message-if-member else email, audience filter
   (confirmed/all), refuses to send an empty program, approval-gated.
5. **Gala menu-options CRUD** (`POST/PUT/DELETE /api/admin/gala/menu-options`): v2 reads the
   dinner menu for the meal buckets but cannot edit it — the venue menu is still maintained in
   the old portal.

(Smaller find: `gala_seat_assignments.seat_note` exists and the assign route accepts it, but no
v2 UI writes it yet.)
