# BUILD — Per-registrant activity timeline + staff notes (ADMIN v2) · 2026-08-31

The old-portal gem (server.js `item 17`, `/api/admin/registrant/:type/:id/activity`) rebuilt for the
redesigned admin Registrations destination — **per person, not per row**: one email in, every event
across every source out, merged and time-ordered, with append-only staff notes at the bottom.

No git, no deploys, no emails, no live DB — DDL in code only (and this build adds **zero** DDL).

## Files touched (additive only)

| File | Change |
|---|---|
| `admin-portal/backend/v2/registrations.js` | New section at the end: `GET /api/v2/registrations/timeline` + `POST /api/v2/registrations/notes` (+ `timelineFor()` merge engine). Existing routes, incl. the transfer log, untouched. |
| `admin-portal/frontend-v2/js/views/registrations.js` | `COPY.timeline`, TIMELINE drawer inside the "Registration file" panel (dc-marked `› "Registration file › Timeline"`), note composer, `tlAdd` handler; `ensureTimeline()` hooked into `redrawData`/`open`/`openGala`; first paint pre-loads the selected row's history. RECENT TRANSFERS strip and all prior behaviour untouched. |
| `admin-portal/frontend-v2/css/views/registrations.css` | Responsive hooks only (file charter): `min-width:0`, `overflow-wrap:anywhere` on timeline text, textarea `max-width:100%`, ≤396px scroll-height trim. |

## API

**`GET /api/v2/registrations/timeline?email=<addr>`** · auth+adminOnly → `{ email, name, events, count }`
`events` = `[{ at, kind, label, detail, author? }]`, **ascending**. Kinds: `registered · paid ·
checkin · transfer · nomination · note · admin` (ticket revoked). Sources merged:

- `registrations ⋈ users/ticket_types` — registered (ticket, gala add-on, guests, source link/member/public), paid (+invoice), revoked
- `gala_registrations` — registered (pricing, seat, guests, invite-link label), paid (amount, invoice, Stripe vs marked-by), VIP-comp
- `bridges_registrations ⋈ bridges_events` — registered (event name/city), paid
- `croatians_abroad_registrations` — registered (Plexus Experience vs Croatians Abroad form, **event combo**, country), gala paid (skipped when a linked `gala_registration_id` row already carries it)
- `forum_event_registrations ⋈ forum_members`, `signup_form_responses` — registered/signed-up (the drawer opens from those union rows too)
- `invoices.paid_at` — upgrades a paid event's created_at fallback to the real payment date (matched by invoice_number or registration_id)
- `v2_checkin_admits` — **which door** (`Conference/Gala/Donor Night/Bridges door`) + **party progress** (`1 of 2 admitted`, last-scan time); matched by this person's registration ids or `guest_email`. The duplicate legacy `checked_in` flag (the scanner flips both) is suppressed per reg+door; legacy flags without a scanner ledger row (incl. CA `conference_checked_in_at` / `bridges_checked_in_at`) still emit.
- `v2_seat_transfers` — both directions ("Seat passed to Marko Perić" / "Seat received from …")
- `v2_forum_nominations` — nominee or nominator side
- `registrant_notes` — see below

Rows without their own timestamp fall back to the row's `created_at`/`registered_at`.
Ties sort by lifecycle rank (registered → paid → transfer → checkin → note).
**Unknown email → `200` with `events: []`** (never a 500). Malformed email → `400`.

**`POST /api/v2/registrations/notes`** ← `{ email, text }` · auth+adminOnly — **append-only**.
`author = req.user.email`. Returns the stored note entry. There is deliberately **no edit or delete
route** — append-only is the point. Audited (`registrations.note_appended`).

## Why `registrant_notes` is reused (no v2 duplicate table)

The legacy table (server.js, byte-identical in both portals, **exists in prod**):

```sql
CREATE TABLE IF NOT EXISTS registrant_notes (
    id TEXT PRIMARY KEY, registrant_id TEXT NOT NULL, section TEXT,
    author TEXT, body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)
```

It fits exactly: `registrant_id` is a free TEXT key with no FK (legacy stores row-uuids), and
`section` exists precisely to scope. v2 writes `registrant_id = lower(email)`,
`section = 'v2-email'` — uuid keys contain no `@`, so the two generations can never collide, legacy
reads (`WHERE registrant_id = <row-uuid>`) are untouched, and the v2 timeline surfaces **both**:
email-keyed v2 notes plus legacy per-row notes attached to any of this person's registrations.
Zero new tables, zero ALTERs.

## Frontend

Clicking a row already opens the "Registration file" side panel; the TIMELINE drawer now sits inside
it (between the action buttons and the People footer): vertical dot-and-line timeline (time · label
· detail, kind-coloured dots), notes visibly attributed in gold (**"Laura Rodman · AUG 31 · 14:02"**
— derived from the author email), and the composer at the bottom captioned **"Append-only — the team
sees every note."** Switching rows refetches; unrelated redraws keep the loaded history *and* any
half-typed draft. If the endpoint fails, the drawer says so rather than pretending the person has no
history. Phone ≤396px: composer row flex-wraps, all long text `overflow-wrap:anywhere`, scroll area
trimmed; the panel already single-columns ≤960px via app.css.

## Verification (all green, 2026-08-31)

1. `node --check` — backend ✓, frontend (as .mjs) ✓; `require()` of the backend module ✓.
2. **`/tmp/tl-verify.js`** — stub-express mount over **in-memory libsql** (`shared/db.js` wrapper,
   real DDL column sets), seeded across `registrations` + `gala_registrations` +
   `bridges_registrations` (+ invoices, admits, transfers, notes): **27/27 PASS** — ascending merge
   order across sources; `paid` at `invoices.paid_at` (not the created_at fallback); exactly one
   gala check-in (door + "1 of 2 admitted", legacy flag suppressed) while the bridges legacy
   check-in survives; outbound + inbound transfer labels; two notes appended with correct authors
   and merged **by time**; legacy uuid-keyed note surfaces; unknown email → 200 empty; bad
   email/empty note → 400; no note edit/delete route exists.
3. **`/tmp/tlsmoke/run.mjs`** — render-smoke of the real (unmodified copy) view over stub siblings +
   string DOM: **11/11 PASS** — page, dc-marked timeline block, header + count, events in order,
   attribution regex `Laura Rodman · AUG 31`, composer + append-only caption, flex-wrap composer,
   RECENT TRANSFERS strip and existing panel/actions untouched.

## Notes for the deployer

- Pure additive; safe with an **older backend**: the drawer shows its inline "would not load" line
  and the rest of the page is unaffected. Safe with an older *frontend*: new routes simply unused.
- Both portals share ONE DB; this build performs no DDL, so boot order is irrelevant.
- Not wired here (out of scope, no live DB): nothing — the feature is complete behind the existing
  auth+adminOnly gate.
