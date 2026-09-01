# Building Bridges in Biomedicine — Boston · build notes (2026-09-01)

Public registration flow for **Monday, 21 September 2026 · 18:00 (doors 17:30) · Waterhouse Room,
Gordon Hall, 25 Shattuck Street, Harvard Medical School, Boston, MA**. Free, business attire,
co-organized with the Harvard Medical Postdoc Association (HMPA). Everything is **additive on
main** — no existing route, table, or behaviour was modified beyond the two files listed under
"Modified" (both backward-compatible).

## Files

### New
| File | What |
|---|---|
| `user-portal/backend/boston.js` | The whole wing: `module.exports = mountBoston(app, { query, saveDb, sendEmail, flushDb, JWT_SECRET })`. Routes: `GET /boston` (registration page), `GET /boston/hero.jpg` + `GET /boston/hmpa.png` (page assets), `POST /api/boston/register`, `GET /boston.ics`, `GET /api/boston/pass/:token.pkpass`. |
| `user-portal/backend/boston-hero.jpg` | Invitation hero (dark HMS Gordon Hall facade), recompressed from `/tmp/boston-hero.png` to progressive JPEG q72, 1400×1980, 167 KB. |
| `user-portal/backend/hmpa-logo.png` | HMPA logo (verbatim copy of the staged asset). |
| `user-portal/backend/v2/email-templates.js` | Verbatim copy from the redesign branch (standalone template library, zero requires; `ticketConfirmation` is used for the confirmation email). Nothing auto-mounts it — main has no v2 registry. |
| `user-portal/backend/v2/apple-pass.js` | Copy from the redesign branch **plus one additive feature**: `buildPkpass(model)` now honors `model.stripFiles = {1x,2x,3x}` paths to swap in a per-event strip image (cached; a bad path falls back to that scale's default; passes without `stripFiles` are byte-identical to before). Exports used: `isConfigured()`, `buildPkpass()`. |
| `user-portal/backend/v2/apple-assets/` | The 8 default pass images (verbatim) + `boston-strip.png` / `@2x` / `@3x` — 375×123 / 750×246 / 1125×369 crops of the facade's "HARVARD MEDICAL SCHOOL" inscription + ionic-column band. |
| `tests/boston.test.js` | 18 hermetic tests (see below). |

### Modified
| File | Diff |
|---|---|
| `user-portal/backend/server.js` | **One 7-line block** (exact diff at the bottom). |
| `shared/wallet.js` | Overwritten with the redesign-branch version — verified backward-compatible superset: `module.exports` blocks are byte-identical (all of main's exported functions unchanged); the only differences are (1) a new optional `dressCode` field on `buildEventTicketObject` and (2) the gala-table text-module header reading "Table" instead of "Gala table". |

## Behaviour

- **Event row**: find-or-created lazily per request via `INSERT OR IGNORE` with the FIXED id
  `bb-boston-2026-09-21` (slug `boston-2026`, city Boston, 2026-09-21, 18:00–21:00, capacity 60,
  registration_open 1, is_published 0 so it never surfaces in the member portal). Admin edits are
  never overwritten. Registrations land in `bridges_registrations`, so the existing `/qr/:id.png`
  route, the door scanner's bridges mode (`{type:'MEDX_MEMBER', regId, evt:'bridges'}` payload —
  verified against the route) and the admin bridges views see them with zero schema change.
- **Register** (`POST /api/boston/register`): validates name/email/institution (400s), splits the
  full name, dedupes by `lower(email)` on held seats — a duplicate **re-sends the confirmation to
  the on-file address** (no throttle — per spec a resubmit always re-sends; the response is
  `{already:true}` and never echoes the registration id) — capacity-gates at 60 like the sibling
  `/api/public-events/register`, inserts (`notes = '5-minute presentation requested'` when the
  checkbox is ticked, `confirmation_sent` flipped to 1 after the send), then fires the
  non-blocking Google-Sheets POST (same JSON shape as the Stripe-webhook posts, `events:['bridges']`,
  `event 'Building Bridges Boston 2026'`, `payment 'Free'`, `ticket_code` = first 8 of the id
  uppercased) when `GOOGLE_SHEETS_WEBHOOK` is set.
- **Confirmation email**: v2 `ticketConfirmation` — hosted QR `${RENDER_EXTERNAL_URL||https://medx-user-portal.onrender.com}/qr/<id>.png`,
  ticket № `BB-BOS-XXXXXXXX`, Google Wallet save-URL minted exactly like the v2 wallet
  (`objectIdFor('t-br-'+id)`, class from `GOOGLE_WALLET_EVENT_CLASS_ID`, barcode token = the
  registration id, non-blocking `ensureEventClass/Object` provisioning), Apple button **only when
  `applePass.isConfigured()`**, calendar button → `/boston.ics`. Sent through `sendEventConfirmation`,
  so Laura is CC'd exactly like every other event confirmation.
- **Apple pass** (`GET /api/boston/pass/:token.pkpass`): no-login token =
  `hex HMAC-SHA256(JWT_SECRET,'boston:'+id).slice(0,32) + '.' + id`, timing-safe verify + row check
  (404 on any mismatch), 503 JSON when the `APPLE_WALLET_*` env is absent. Serial `medx-t-br-<id>`
  (same scheme as v2 → a re-issued pass replaces, never duplicates), Boston facade strip via the new
  `stripFiles` override, header `BUILDING BRIDGES 2026 / Boston`, WHEN `Sep 21 · 18:00 (doors 17:30)`,
  WHERE `Gordon Hall · Harvard Medical School`, back: INCLUDED / VENUE (full 25 Shattuck Street
  address) / DRESS CODE `Business attire` / SUPPORT. `qrMessage` = registration id.
- **`GET /boston.ics`**: single VEVENT, `DTSTART:20260921T220000Z` → `DTEND:20260922T010000Z`
  (18:00–21:00 America/New_York; 21 Sep 2026 is EDT = UTC−4 — verified, US DST ends 1 Nov 2026),
  RFC-5545 escaping + 75-octet folding, doors-17:30 + QR note in DESCRIPTION, `text/calendar`.
- **Page** (`GET /boston`): ink/cream/crimson/gold shell in the portal's premium public-page
  language (Fraunces + Inter, warm-ink hero band, cream sheet, crimson primary, gold hairlines);
  dark HMS-facade hero with Med&X × HMPA logos, "Fifth Edition · By invitation only", the
  confirmed blurb, program line, facts card, the form (checkbox wording verbatim + slots note),
  in-page success state ("confirmation email with your entry QR + wallet passes is on its way",
  distinct copy for `{already:true}`), Laura support line. Mobile-first — composed and
  screenshot-verified at 390 px and 1280 px, including the submitted-success state.

## Env vars needed on prod (Render → medx-user-portal)

Everything already present keeps working with no new vars — absent Apple env just omits the Apple
button and the pass route answers 503 JSON. To turn Apple Wallet on, add:

```
APPLE_WALLET_CERT_PEM     — Pass Type ID certificate (PEM; one-line \n-escaped paste is handled)
APPLE_WALLET_KEY_PEM      — its RSA private key (no passphrase)
APPLE_WALLET_WWDR_PEM     — Apple WWDR G4 intermediate
APPLE_WALLET_TEAM_ID      — e.g. 4XC4NRV538
APPLE_WALLET_PASS_TYPE_ID — e.g. pass.hr.medx.plexus
```

Google Wallet (`GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY`, `GOOGLE_WALLET_EVENT_CLASS_ID`),
Brevo (`BREVO_API_KEY`, `EMAIL_FROM`, `CONFIRMATION_CC`), `GOOGLE_SHEETS_WEBHOOK`, `JWT_SECRET`
and `RENDER_EXTERNAL_URL` are already there and are picked up as-is.

## Tests — `node tests/boston.test.js` → **18 passed, 0 failed**

Hermetic by construction: stub express route-collector, scratch **in-memory `node:sqlite`** DB
carrying the real `bridges_events`/`bridges_registrations` schema (CREATEs + ALTERs copied
verbatim from server.js), a capturing `sendEmail` stub, `global.fetch` replaced with a
thrower, and the shared wallet's network provisioners stubbed — **a real email send or any
network call is impossible**. Covered: route presence; 400 validation (×4); happy path
(row + response + email-once + `confirmation_sent`); email HTML (hosted QR url, Google save
url, `Business attire`, `Monday`/`21 September 2026`, `25 Shattuck Street`, ticket №, `.ics`
link, no `undefined`/`NaN`); Apple button omitted while unconfigured; event row created exactly
once with the fixed id + confirmed facts; presentation flag → notes + intro line + ticket-label
suffix; duplicate → `{already:true}`, one row, re-send to on-file address; `.ics` VEVENT +
UTC window + escaping; pass route 404 on bad/forged/unknown tokens and graceful 503 without
Apple env; page content; asset routes.

Also smoke-tested outside the suite: full `.pkpass` assembly with a throwaway self-signed
cert — the zip carries `pass.json` + signature, `stripFiles` puts the Boston strips in the
Boston pass while a default model still gets the default strips, byte-compared both ways.

## Exact server.js diff

```diff
@@ -5635,6 +5635,13 @@ const query = {
     }
 };
 
+// ===== BUILDING BRIDGES — BOSTON (public wing; additive, self-contained module) =====
+// Registered here (top-level, before initializeApp's SPA catch-all) so /boston and its API beat
+// the SPA; the module touches the DB lazily at request time, after initializeApp has opened it.
+try {
+    require('./boston')(app, { query, saveDb, sendEmail: sendEventConfirmation, flushDb, JWT_SECRET });
+} catch (e) { console.error('[Boston] wing failed to mount:', e.message); }
+
 // Once the production demo purge has run (app_state marker), the demo seed blocks must never
```

(Placed immediately after the `query` helper: `app`, `JWT_SECRET` and `query` are initialized by
then, `saveDb`/`flushDb`/`sendEventConfirmation` are hoisted declarations, and every top-level
route beats the SPA catch-all that `initializeApp()` registers later. The try/catch means a
broken wing can never take the portal down.)

## Not done / notes for review

- **No commit/push/deploy** — working tree left for your review (`git status`: 2 modified,
  6 new paths).
- Duplicate resubmits re-send every time (spec'd); unlike the sibling route there is no 15-min
  re-send throttle — add one if resubmit-bombing ever becomes a concern.
- The Google pass reuses the already-approved event class from `GOOGLE_WALLET_EVENT_CLASS_ID`
  (per spec); if you'd rather mint a dedicated Boston class, change one line in
  `confirmationEmailHtml` (`wallet.classIdFor('bridges-boston-2026')` is already the fallback).
- `bridges_events.venue_address` was set to `Harvard Medical School, Boston, MA` per the row
  spec; the full 25 Shattuck Street address is used in the email WHERE line, `.ics` LOCATION
  and the pass back VENUE field.
