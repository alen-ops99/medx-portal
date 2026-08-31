# BUILD — Seat transfer + cancellation policy (2026-08-31)

Gala seats are non-refundable; members can now pass their seat to a colleague themselves,
up to the day of the event. No refund flow exists anywhere — the policy line is the only
cancellation-related copy added.

## Routes

| Route | Portal | Auth | What |
|---|---|---|---|
| `POST /api/v2/transfer/gala` `{to_name, to_email}` | member | member JWT | Moves the caller's Gala seat to the colleague IN PLACE — same registration id, same hosted QR (`/qr/<id>.png`). Writes one `v2_seat_transfers` row (status `done`) and sends two confirmations via `ctx.sendEmail` (staging → EMAIL_DUMP_DIR, nothing external). |
| `GET /api/v2/transfer/log?limit=` | admin | admin JWT + adminOnly | Newest-first transfer audit (who → whom, when, which registration, current row status) for the RECENT TRANSFERS strip. |

Guards on the POST: seat must exist and be paid or pending (any status except
rejected/declined/cancelled) · `checked_in = 1` → **409** · one transfer per registration
per 24 h → **429** · transfer to the seat's own e-mail → **400** · no seat → **404**.

## Table (new, declared identically in BOTH portals' v2 modules)

```sql
CREATE TABLE IF NOT EXISTS v2_seat_transfers (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL,            -- 'gala' | 'ca'
  registration_ref TEXT NOT NULL,                     -- the row the seat lives on (id unchanged by the transfer)
  from_email TEXT, to_name TEXT, to_email TEXT,
  status TEXT DEFAULT 'done', created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```
DDL in code only (try/catch at module mount, v2_ prefix). No existing table or column was
renamed, dropped, or altered.

## How the seat moves (party/guests untouched)

Holder columns only — `first_name`, `last_name`, `email` **and `user_id`** (new holder's
account id when one exists, else NULL). Both must move: wallet/gala member queries key
ownership off `user_id = ? OR lower(email) = ?` (verified in `wallet.js › allItems` and
`/api/gala/my-status`), so leaving `user_id` behind would keep showing the seat to the old
member. `dietary`, `amount_paid`, `invoice_number`, `status`, `payment_status`, and every
`ca_registration_guests` row stay as they were.

Seat shapes handled (kind in the audit row):
- **`gala`** — a `gala_registrations` row. A CA row linked via `gala_registration_id`
  feeds the `/qr/:id.png` payload (server.js:4117), so it follows: gala-only CA row →
  holder columns move with the seat; CA row that also carries conference/bridges → those
  stay with the old holder and the gala portion is detached (`selected_gala = 0`,
  `gala_registration_id = NULL`; the QR falls through to the standalone gala payload).
- **`ca`** — CA row with `selected_gala = 1` and no linked gala row: the CA row IS the
  seat, its holder columns move. If it also carried the free conference portion, the whole
  row (one row, one QR) moves — stated in the confirm dialog response and both emails.

## Files

- `user-portal/backend/v2/transfer.js` — **new**; the whole member-side backend. Emails are
  composed inline with a `// TODO: swap to email-templates.seatTransferred` marker
  (email-templates.js is owned by another engineer this wave and was NOT touched).
- `user-portal/frontend-v2/js/views/plexus.js` — My Plexus "Transfer to a colleague" block
  only: know-card note now carries the policy line and shows **TRANSFER YOUR SEAT →** when
  a gala seat is held; new gala modal (name + e-mail) → `ui.confirm` spelling out *the QR
  moves · your ticket stops working · this cannot be undone by you* → POST → live reload of
  the tab. The legacy team-approved conference request flow is preserved verbatim
  (`openConfTransfer`, reachable directly and via a link inside the gala modal).
- `user-portal/frontend-v2/js/views/gala.js` — ONE dc-marked block ("Seat policy"): the
  policy line + a link to My Plexus. Nothing else changed.
- `user-portal/frontend-v2/js/views/me.js` — NOT touched; no entry point needed (the seat
  transfer lives where the artboard promised it, My Plexus).
- `admin-portal/backend/v2/registrations.js` — additive block at the end: the table DDL
  (mirror declaration, in case the admin server boots first) + `GET /api/v2/transfer/log`.
- `admin-portal/frontend-v2/js/views/registrations.js` — additive RECENT TRANSFERS strip
  (dc-marked) below the all-events table; hidden entirely when the endpoint is unavailable.

## Test notes (all offline — no git, no deploys, no staging/prod DB, no real email)

- `node --check` clean on both backend files and (as .mjs copies) all three ESM views.
- Harness (`scratchpad/transfer-harness.js`): both backend modules `require()`d and mounted
  on real express + real `shared/db.js` over a scratch SQLite file; `sendEmail` was a local
  capture stub. **30/30 assertions pass**: validation 400s, self-transfer 400, happy path
  (holder fields + user_id in place, status/payment untouched, audit row, 2 dumped emails
  with QR link `<base>/qr/<id>.png`, wallet-passes note, policy line), old-member wallet
  query returns nothing / new member sees the seat, 24 h rate limit 429 then allowed after
  the window, checked-in 409, CA-linked detach case, CA-only move case, no-seat 404,
  admin log 403 without adminOnly / 200 with enrichment, newest first.
- Repo guards still green: `scripts/check-schema-sync.sh` OK, `scripts/check-api-contract.js` OK.
- Not verified here (needs a running staging pair): the EMAIL_DUMP_DIR file drop itself and
  the visual pass over the three views.
