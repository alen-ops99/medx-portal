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

---

# 2026-09-01 — presentation uploads + live-test edits

Second wave on the same wing (all inside `boston.js` + `tests/boston.test.js`, plus one 3-line
server.js gate exemption and two dependency additions). Everything below is additive and
degrades gracefully when its env is absent.

## New routes

| Route | What |
|---|---|
| `GET /boston/upload/:token` | Personal upload page — "Hi <first> — upload your 5-minute presentation", name + institution shown (attribution proof), drag-and-drop or picker, `accept=".pdf,.ppt,.pptx,.key"`, 25 MB note, XHR progress bar, on-file card + replace control after a first upload, exact success copy "Got it — <filename> is safely with us. You can replace it any time from this same link." Invalid token → friendly branded 404. `BB_S3_*` absent → the page renders an "Uploads open soon" note instead of the uploader. noindex (meta + `X-Robots-Tag`). |
| `POST /api/boston/upload/:token` | Multipart (field `file`) via **multer memoryStorage** (the parser server.js already uses; the stream aborts past 25 MB via `limits.fileSize`, plus a handler belt). Validates token → registration → extension whitelist (`pdf/ppt/pptx/key`) → **magic bytes** (`%PDF` in the first 1 KB; `PK\x03\x04` for pptx/key; OLE2 CFB *or* zip for legacy .ppt) → PUT to S3 → inserts a `bridges_presentations` history row. Errors are friendly JSON (404 bad link, 400 type/magic, 413 size, 502 S3 failure, 503 unconfigured). |
| `GET /boston/presentations?key=…` | Branded TEAM page (noindex, `private, no-store`): every registrant who requested a presentation **or** has an upload — name, institution, email, chips, upload status (newest file name, size, time, version count \| "not yet"), per-guest personal upload link with click-to-copy, DOWNLOAD button. Footer prints the JSON + CSV URLs. Renders (with a notice) even without `BB_S3_*`. |
| `GET /api/boston/presentations?key=…` | The same data as JSON for the v2 admin portal: `{event, generated_at, s3_configured, requested, uploaded, rows:[{registration_id, name, institution, email, requested, upload_url, upload:{id, filename, size, mime, uploaded_at, versions, download_url}\|null}]}`. |
| `GET /api/boston/presentations/:id/download?key=…` | 302 → **15-minute presigned S3 GET** with `response-content-disposition` carrying the original filename. Wrong key/id → 404. |
| `GET /api/boston/registrations.csv?key=…` | ALL bb-boston registrants for the separate Boston Google Sheet: UTF-8 **BOM**, every cell quoted, CRLF, oldest first. Columns: Registered at, First name, Last name, Email, Institution, Position, 5-min presentation (Yes/No from the notes marker), Status, Checked in (Yes/No). Wrong/missing key → **403**. |
| `GET /api/boston/qr/:id.png` | The confirmation email's entry QR with the **Med&X × HMPA plate** (`user-portal/backend/qr-plate.png`, 253×58) alpha-composited in the middle of a 300 px QR at error-correction **H** (prod's plain route uses L/560). Payload replicates the prod `/qr/:id.png` bridges branch **exactly**: `{"type":"MEDX_MEMBER","regId":"<id>","evt":"bridges"}` — the door scanner reads both interchangeably. jsQR-verified decodable in tests. qrcode/pngjs missing or compositing failure → 302 to the plain `/qr/:id.png`. |

## Token & key schemes (all HMAC-SHA256 over `JWT_SECRET`, hex)

- **Apple pass** (unchanged): `HMAC('boston:'+id).slice(0,32) + '.' + id`.
- **Upload token**: `uploadSig(id) = HMAC('bostonup:'+id).slice(0,32)`; token = `sig + '.' + id`.
  Distinct context string → pass and upload tokens can never be swapped. Timing-safe verify.
- **Admin key**: `HMAC('boston-admin').slice(0,40)` — derived, nothing to provision; gates the
  team page, JSON, download and CSV routes (timing-safe compare).

## S3 (private bucket, no SDK)

- Env: `BB_S3_BUCKET=medx-bb-presentations`, `BB_S3_REGION=us-east-1`, `BB_S3_KEY`, `BB_S3_SECRET`
  (scoped IAM) — read lazily per request; the wing mounts and answers fine without them
  (boot-smoked in production mode).
- **Plain-node SigV4 signer** (~90 lines, `crypto`+`https`) instead of `@aws-sdk/client-s3` —
  avoids ~40 MB of dependencies on every Render build for exactly two operations: header-signed
  single-chunk PUT and query-signed presigned GET. The presign core **reproduces AWS's published
  SigV4 documentation test vector bit-for-bit** in the test suite; the PUT request assembly is
  structurally verified hermetically (host/path/headers/payload-hash/Authorization shape).
- Key layout: `boston-2026/<registrationId>/<presentationId>.<ext>` — every upload is a NEW key
  and a NEW `bridges_presentations` row (history kept); the newest row per registrant is
  authoritative everywhere (page, admin, download).
- `bridges_presentations` (created lazily, `CREATE TABLE IF NOT EXISTS`): `id` uuid PK,
  `registration_id`, `original_name`, `stored_key`, `mime`, `size`, `uploaded_at` (ISO, ms).

## No automatic emails

Per the send-control rule nothing emails presenters: the team copies personal links from the
team page. The intended invite email lives as a **commented `sendUploadInvite(reg)` helper**
in boston.js for later deliberate wiring.

## Live-test edits (Alen's review of the deployed page)

- **/boston page**: kicker label removed (logos only above the title); title now
  "Building Bridges in Biomedicine: Croatia and the US" with *Boston* beneath; the
  "Organized by …" hero flavor line and the "Fifth edition — after London…" line removed;
  the date now appears **exactly once** (hero): "Monday, 21 September 2026 · 6:00–9:00 PM
  (doors from 5:30 PM) · Waterhouse Room, Gordon Hall (25 Shattuck St), Harvard Medical School"
  (facts card reduced to Admission + Dress); the "Co-organized with…" line removed; footer is
  now Laura → "Organized by Med&X and the Harvard Medical Postdoc Association" → **www.medx.hr**.
- **Apple pass**: header field label is now `BUILDING BRIDGES` (year dropped — it truncated),
  value `Boston`.
- **Email QR**: `qrPngUrl` now points at `/api/boston/qr/<id>.png` (logo plate, above). The
  Apple-pass barcode is Apple-rendered and cannot carry a logo.
- **Google pass**: objects mint against `BB_GOOGLE_CLASS_ID`
  (prod: `3388000000023175280.medx-bb-boston-2026`; falls back to
  `GOOGLE_WALLET_EVENT_CLASS_ID`). The class body carries name/venue/date at class level, so the
  duplicated per-object `category`/`events` text modules were dropped — objects keep holder
  name, registration №, status, dress code (JWT-decoded and asserted in tests).
- `v2/email-templates.js` footer alignment was fixed separately by Alen — not touched here.

## Dependencies

`user-portal/backend/package.json`: **pngjs** ^7.0.0 (dependency — QR compositing; multer and
qrcode were already there and are reused), **jsqr** ^1.4.0 (devDependency — decode assertion in
tests). New committed asset: `user-portal/backend/qr-plate.png`.

## server.js — one more small block (exact diff at the bottom)

The production ephemeral-disk guard 503s ALL multipart POSTs when `CLOUDINARY_URL` is unset.
Boston uploads never touch local disk (memory → S3), so the guard now exempts
`/api/boston/upload/` by prefix (+3 lines beside the existing suffix exemptions). Boot-smoked in
`NODE_ENV=production`: other multipart posts still get the guard's 503; the Boston route answers
for itself.

## Tests — `node tests/boston.test.js` → **37 passed, 0 failed**

All previous coverage kept (updated for the page edits + branded-QR email URL), plus: SigV4
presign vs the AWS doc vector; upload-token roundtrip + forged/pass-token/ghost 404s (page and
API); personal page content/attribution/noindex; `BB_S3_*`-absent graceful trio (page "open
soon", API 503, admin still lists); upload happy path (captured stub PUT, key layout, history
row, ISO timestamp); 25 MB reject (no PUT, no row); wrong-magic rejects; extension/no-file 400s;
replace flow (history kept, newest wins); admin gates (exact 40-char key; CSV 403); admin page
states + copyable links + download link; admin JSON shape/versions/counts; download 302 with
presigned URL anatomy + 15-min expiry + filename; CSV BOM/CRLF/all-quoted/order; Google object
class + trimmed text modules (JWT decoded); branded QR decodes via **jsQR** to the exact bridges
payload at 300 px (self-skips loudly if backend node_modules absent). Still hermetic: stubbed
express/sqlite/sendEmail, fetch disabled, S3 putObject captured — no network is reachable.

Also verified outside the suite: 16/16 boot-smoke checks against the REAL server.js (test mode
without `BB_S3_*`, and production mode proving the gate exemption + that everything mounts and
answers), sibling suites at exact pass-parity with pristine HEAD (my diff regresses nothing),
and Playwright screenshots of /boston (390/1280), the upload page, the team page and the 404
page — plus the composited QR image itself.

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

And the 2026-09-01 gate exemption (the ephemeral-storage guard, ~line 5575):

```diff
 // Endpoints whose multipart body is parsed then discarded (never persisted) — always allowed.
 const UPLOAD_EXEMPT_SUFFIXES = ['/import', '/prospects/preview'];
+// Boston presentation uploads never touch local disk (multer memoryStorage → S3 in boston.js),
+// so the ephemeral-disk guard does not apply to them — exempt the route by prefix.
+const UPLOAD_EXEMPT_PREFIXES = ['/api/boston/upload/'];
 app.use((req, res, next) => {
     if (!STORAGE_IS_EPHEMERAL) return next();
     if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return next();
     if (!(req.headers['content-type'] || '').includes('multipart/form-data')) return next();
     if (UPLOAD_EXEMPT_SUFFIXES.some(s => req.path.endsWith(s))) return next();
+    if (UPLOAD_EXEMPT_PREFIXES.some(s => req.path.startsWith(s))) return next();
```

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
