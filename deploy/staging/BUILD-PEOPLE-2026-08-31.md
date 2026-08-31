# BUILD — ADMIN People hygiene (team review — Laura + Miro) — 2026-08-31

Scope: the four People asks from the team review — unsubscribe status, GDPR consent, duplicate
merge, combinable filters + exact-set CSV export. Branch `redesign/member-portal`. No git/deploy/
email/live-DB actions were performed; all DDL is `CREATE TABLE IF NOT EXISTS` in code, applied only
when the admin server runs.

## Files touched (the three owned files + this report)
- `admin-portal/backend/v2/people.js` — directory assembly extracted into one `buildDirectory()`
  (identical source reads: users, gala, plexus, bridges, forum, vip_passes, contacts, merged by
  lowercased email), now emitting a STABLE `key` per row + hygiene `flags` + merge suppression.
  3 new routes, 2 new tables. `node --check` clean.
- `admin-portal/frontend-v2/js/views/people.js` — same screen + the four features (COPY/SOURCE
  exports, dc-block markers kept verbatim, new pieces marked `v2:`, data-act + ui.bind, api.settle,
  inline artboard styles).
- `admin-portal/frontend-v2/css/views/people.css` — existing ≤960/≤480 rules untouched; appended
  the same-discipline rules for the duplicates strip and hygiene chips (rows drop columns and wrap,
  the page never widens — the 390px-viewport fix from the Aug review keeps holding).

## 1 · Unsubscribe status — truth stays where it already lives
- Checked first (as asked): unsubscribe storage ALREADY exists — `v2_newsletter_subscriptions`
  (user-portal/backend/v2/newsletter.js, `unsubscribed_at`) and the legacy `pr_subscribers`
  (`status='unsubscribed'`, mirrored by newsletter.js). Both portals share one DB, so this module
  READS those two as the source of truth and never writes them.
- `v2_people_flags` (email PK = lower(email) · unsubscribed 0/1/NULL · unsubscribed_at · consent
  0/1/NULL · consent_note · updated_by · updated_at) is an admin OVERLAY: NULL defers to the
  newsletter tables, 0/1 is an explicit admin statement here and wins. `flags.unsub_source`
  reports which record decided: `newsletter` / `pr` / `admin` / null.
- UI: dark-wine `UNSUBSCRIBED` chip first in the row's status chips (searchable — typing
  "unsubscribed" filters to them); MAILING toggle in the member-file panel with the source note
  under it. Overriding someone's own unsubscribe asks for confirmation first.

## 2 · GDPR consent
- Same table: GDPR chip (`CONSENT ON FILE` / `NOT RECORDED`) + optional note ("collected at the
  Plexus form") with its own SAVE. Partial upserts — each field changes independently;
  `POST /api/v2/people/flags { email, unsubscribed? | consent? | consent_note? }`, null clears a
  statement. Rows without an email say so and offer no toggles (flags key on the address).

## 3 · Duplicate merge
- Strip between search and the list: groups by same normalized name (Croatian diacritics folded —
  Kovač≡Kovac, đ→d — honorifics dropped, ≥2 name tokens) or same email local-part (dots/+suffix
  stripped, ≥4 chars, generic locals like info/office/kontakt excluded). Groups are union-joined,
  richest row suggested first, reason labeled (SAME NAME / SAME EMAIL START), max 4 shown.
- `KEEP THIS ONE` on the survivor → confirm modal → one `POST /api/v2/people/merge` per folded
  row. `v2_people_merges` (id · kept_key · merged_key · merged_json snapshot · merged_by ·
  created_at). NOTHING is deleted: the directory suppresses merged keys; the survivor carries
  `absorbed` (shown as MERGED IN in the panel). Guards: already-merged → 409, team rows can never
  be merged away → 409, unknown keys → 404.
- UNDO within the session: toast UNDO + a `MERGED THIS SESSION` line in the strip; both call
  `DELETE /api/v2/people/merges/:id` — the row is back on the next read. `LEAVE AS SEPARATE
  PEOPLE` dismisses a false-positive group for the session.

## 4 · Combinable filters + exact-set export
- Segment chips are multi-select with union semantics — pick several, the list shows anyone in any
  of them; EVERYONE clears; chips show active state (styles + aria-pressed) and a one-line hint
  says they combine.
- EXPORT CSV exports exactly `filtered()` — the same list the rows render from (search included) —
  and the button label carries the live count: `EXPORT CSV · 27 FILTERED` (plain `EXPORT CSV · N`
  when nothing filters). UTF-8 BOM (\uFEFF) + Blob download so č ć đ š ž survive Excel, every
  field quoted, CRLF rows; columns now include Unsubscribed / GDPR consent / Consent note.

## Verification (all run 2026-08-30)
- `node --check` on both owned JS files — clean.
- Backend smoke (scratch sqlite via `shared/db.js` `createDatabase` + libsql, module mounted on a
  stub express with pass-through auth): 27/27 — DDL, stable keys (`e:` / `n:name:id`), newsletter +
  pr truth (mixed-case emails), UNSUBSCRIBED tag, admin override + clear-override round trip,
  consent+note partial upsert, merge → suppression → absorbed → undo → reappearance, double-undo
  404, team-merge 409, bad-input 400s, add-person regression, audit_log rows.
- Render smoke (real view + real ui.js/facts.js, stub api/chrome/router, fake DOM): 21/21 — full
  template renders with no `undefined` / `[object Object]` / `NaN`, COPY leaves all resolve, chip +
  strip + hygiene + absorbed + counts + dc markers present. It caught one real bug (COPY.passes
  dropped in the rewrite) which is fixed and re-verified.
- `scripts/check-api-contract.js` — OK (legacy surfaces; the v2 route pairing is covered by the
  smoke: every `api.*('/api/v2/people…')` call has its backend route).

## Review notes
- A merged-away row's own email keeps its newsletter record; the snapshot in `v2_people_merges`
  preserves everything it showed. The survivor's flags stay keyed to the survivor's address.
- Undo is deliberately available beyond the strip's session list only via the merge row itself —
  if a wrong merge is noticed later, deleting the `v2_people_merges` row restores it (no data loss
  by construction).
