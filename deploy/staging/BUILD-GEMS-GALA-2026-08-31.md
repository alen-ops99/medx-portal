# Gala invitations + menu options — build notes (2026-08-31)

Ports two old-portal Gala features into the v2 ADMIN Gala destination: a per-person
**invite-sync engine** (invited / opened / registered, with invitation emails **queued for
approval, never sent**) and **menu-options CRUD** (v2 could read the dinner menu but not edit it).
Built and verified locally — **nothing deployed, no git, no emails, no live DB touched** (the one
new table and the two guarded ALTERs run at the next boot from code).

## Files touched (the owned set)

- `admin-portal/backend/v2/gala-ops.js` — `v2_gala_invites` DDL, guarded `description` / `bucket`
  columns on `gala_menu_options`, the invitations engine (read · queue → outbox · public open hop)
  and the v2 menu-options routes (full list · add · edit/archive/restore)
- `admin-portal/frontend-v2/js/views/gala.js` — INVITATIONS card (states, summary line, queue
  modal with EN/HR templates and a re-invite tick list) and MENU OPTIONS card (list with per-option
  kitchen counts, add/edit modal, archive/restore)
- `admin-portal/frontend-v2/css/views/gala.css` — responsive/touch/focus additions only (per
  ARCHITECTURE.md §4 the look stays inline in the copied markup)

Everything else was read-only recon: `server.js` (legacy invite sync ~12803–12968, invite links
~30492–30545, menu options DDL ~8359 + routes ~30252–30301, outbox ~38634–38767, drainer ~43400),
`admin-portal/backend/v2/inbox.js` (outbox staging shape), `v2/index.js` (module conventions),
`shared/db.js` (the sql.js→libsql facade).

## 1 · Invitations — the recon verdict first

**The legacy tables could not be reused, so the card is backed by a new `v2_gala_invites`.** Why:

- `gala_picker_invites` (server.js:5015) is **not an invitation ledger** — it is the Firestore
  table-picker's ledger. Rows exist only for guests who are *already paid/confirmed*, `token` is
  the Firestore doc id that grants the "Odaberite svoj stol" link, and the picker-sync engine reads
  the table for its known-emails set and its revoke path. Writing invitation rows there would put
  never-registered people into the sync's eligibility/revocation logic and hand out picker
  credentials to people with no seat.
- `gala_invite_links` (server.js:8267) are **anonymous, multi-use registration URLs**
  (label · link_type · price_override · max_uses) with no per-person email — an
  invited/opened/registered join is structurally impossible on them.

`v2_gala_invites (id, email UNIQUE, name, lang, token UNIQUE, batch_id, invited_at, opened_at,
queued_count, created_by, created_at, updated_at)` is the per-person shape both lacked. Nothing
legacy is renamed, dropped or written to.

### What the card does

- **States** — `invited` (queued at least once), `opened` (the invite link was followed), and
  `registered`. **`registered` is never stored**: it is derived on every read by joining the
  invite email against `gala_registrations`, excluding cancelled/rejected/declined/expired, with a
  paid row winning over an unpaid one (so the row can read "registered · paid"). The registrations
  table stays the single truth; the invite ledger can never contradict it.
- **Summary line** — `n invited · n registered · n never answered`, in the card header.
- **QUEUE INVITES** — paste guests (`Ana Anić <ana@kbc.hr>`, `ana@kbc.hr, Ana Anić`, or a bare
  address, one per line) and/or tick from the invited-but-never-registered list; pick the **EN or
  HR** template. Both templates are written inline in `gala-ops.js`, branded like this module's
  other emails (ink band, gold rule, cream card, crimson CTA), marked
  `// TODO: swap to email-templates`.
- **QUEUE AGAIN** on any non-registered row re-queues that one person in their own language.
- Emails already carrying a live registration are **skipped and reported back**; a queue of only
  already-registered people is refused (400) rather than silently doing nothing.
- **Open tracking** — the CTA points at the public
  `GET /api/v2/gala-ops/invites/open/:token`, which stamps `opened_at` once and then **302s to the
  member portal's `/app/gala`**. An unknown or revoked token still redirects: a guest never hits a
  dead end, and the hop leaks nothing.

### The approval gate (the hard rule)

`POST /api/v2/gala-ops/invites/queue` writes **one `scheduled_emails` row per guest** as
`status='pending_approval'`, `source_engine='v2-gala-ops'`, `template='gala_invitation_en|hr'`,
under a `gala-invite-<ts>-<rand>` batch — byte-for-byte the shape `v2/inbox.js` stages its
compose/newsletter batches in. So the batch appears on the **EMAIL & OUTBOX tab** through the
existing `GET /api/admin/outbox?status=pending_approval` listing, its detail/preview loads through
`GET /api/v2/inbox/outbox/:batch`, and the only thing that can ever send it is the existing
**APPROVE & SEND** (`POST /api/admin/outbox/:batch/approve` → the 60 s drainer). **`sendEmail()` is
never called on any invitation path** — the harness asserts a call count of exactly zero across
both features.

## 2 · Menu options — CRUD in place, same table

The v2 view could read the menu (`GET /api/admin/gala/menu-options`) but not edit it. The new MENU
OPTIONS card writes to the **same `gala_menu_options` table** server.js owns, so the old portal's
Meals tab, this view's meal dropdowns, the dietary-keyword bucketing and the kitchen-sheet export
all keep reading the identical rows.

- **List** — name, description, bucket chip, live/archived, plus the **guest count per option**
  (the very numbers on the MEALS card and the kitchen CSV: seats, not rows).
- **Add / edit** — name, description, bucket (meat · fish · vegetarian · vegan · kids · other) and
  the keyword list, with a line explaining that keywords are what map a member's free-text dietary
  wish onto an option.
- **Archive / restore** — v2 flips `active` (v1 only hard-deletes, which loses the row). At least
  one live option must remain; the last one refuses to archive.
- **Schema** — two guarded `ALTER TABLE gala_menu_options ADD COLUMN` (`description`, `bucket`).
  Purely additive: v1's `SELECT *` simply carries them, and no existing reader changes.

**Member-facing form:** confirmed unaffected. Nothing on the member side reads
`gala_menu_options` — a repo-wide grep finds the table only in `admin-portal/backend/server.js`,
`v2/gala-ops.js`, the v2 view and the old admin frontend. The member Gala form stores a free-text
`dietary` string on `gala_registrations`, and the admin side maps that text onto an option via
`keywords`. Guest rows are never mutated by any menu write (the v1 contract, kept), so adding,
renaming or archiving an option cannot break member registration.

### Guest counts per option

Choices are **not** stored as a menu id on registrations. The count comes from the same two-step
the view already used: an explicit per-guest override in `v2_gala_meals` if one exists, otherwise
the guest's `dietary` text matched against each option's keywords (falling back to the default
option), weighted by `1 + guest_count`. The MENU card reuses `mealCounts()`, so its numbers and the
MEALS bars can never drift apart.

## Routes added (all `auth` + `adminOnly` except the public open hop)

| Route | What |
|---|---|
| `GET /api/v2/gala-ops/invites` | invite rows with derived states + the summary counts |
| `POST /api/v2/gala-ops/invites/queue` | `{ people:[{email,name?}], lang:'en'\|'hr' }` → outbox rows, pending approval |
| `GET /api/v2/gala-ops/invites/open/:token` | **public** — stamps `opened_at` once, 302 → member `/app/gala` |
| `GET /api/v2/gala-ops/menu-options` | full list, archived included |
| `POST /api/v2/gala-ops/menu-options` | add (label · description · bucket · keywords) |
| `PUT /api/v2/gala-ops/menu-options/:id` | edit + archive/restore via `{ active }` |

## Verification (all local, in-memory)

- `node --check` on `v2/gala-ops.js` and `js/views/gala.js` — both clean.
- **`require()` + stub-express mount over an in-memory libsql DB** (`shared/db.js` facade, the
  production DDL for `scheduled_emails` / `gala_registrations` / `gala_menu_options` /
  `gala_settings` / `gala_tables` / `audit_log`): **40/40 checks pass**, 22 routes mounted. Covers
  menu add/edit/archive/restore, the last-live-option refusal, 404/400 paths, the v1 active-only
  read seeing v2's writes, the existing meal-override route still validating against the same
  table; then queue dedupe + invalid-address rejection, the already-registered skip, the
  `pending_approval` row shape read back through **both** `inbox.js`'s batch query and server.js's
  `/api/admin/outbox` GROUP BY, the HR and EN payloads (subject · CTA · tracked link), the open hop
  (stamp once · 302 · unknown token still redirects), the derived registered state after inserting
  a matching registration, one ledger row per email with `queued_count` incrementing, and
  **`sendEmail` call count === 0** at the end.
- **Render-smoke** on the real view module over stub `api`/`ui`/`facts`/`router`: **34/34** —
  both new cards render (chips, summary line, description, bucket chip, archived tag, restore,
  edit/archive affordances, default tag), hostile invite names are escaped (no raw `<script>`
  survives), and the blocks the view gained earlier this week — **guest list, seating board with
  + TABLE, 3D planner card with CSV import, meals, waitlist, the night, add-guest/categories** —
  all still render, with the `data-block` anchors `redrawLive()` needs.

## Not done, on purpose

- No git, no deploy, no live DB access. DDL/ALTERs are guarded and in code only.
- No email left the machine, and no code path can send one without the Outbox approval click.
- The legacy Firestore picker-sync engine and `gala_invite_links` are untouched — read-only recon.
- FIRA remains the only source of invoices; nothing here generates a money document.
