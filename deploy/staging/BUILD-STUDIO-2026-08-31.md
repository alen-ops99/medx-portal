# BUILD — ADMIN Studio extras (Laura + Miro) — 2026-08-31

Scope: TEAM-REVIEW-CONSOLIDATED-2026-08.md §C "Studio" — photo library (Laura's build-before-December
pick), badge/cert/print designer settings, social-card backgrounds, sign-up-forms tile, 3D-planner
tile, the dead "+ UPLOAD". Branch `redesign/member-portal`. No git/deploy/email/DB actions were
performed; all DDL is `CREATE TABLE IF NOT EXISTS` in code, applied only when the server runs.

## Files touched (the two owned files + this report)
- `admin-portal/backend/v2/studio.js` — kept the three existing routes (attendance-cards window,
  certificates summary/preview) and added the extras: 8 new routes, 2 new tables
  (`v2_studio_assets`, `v2_studio_settings`). 744 lines, `node --check` clean.
- `admin-portal/frontend-v2/js/views/studio.js` — extended screen (760 lines, ESM syntax-checked;
  COPY/SOURCE exports, dc markers kept, new blocks marked `<!-- v2: … -->`/`data-v2`, data-act +
  ui.bind, api.settle, inline ink/cream/crimson/gold styles).
- `admin-portal/frontend-v2/css/views/studio.css` — **untouched** (it already existed, and the
  ownership rule allowed creating it only if absent; every new style is inline per house style —
  the photo grid is `auto-fill,minmax(158px,1fr)`, all rows wrap, so nothing needed media rules).

## 1 · Photo library (v2_studio_assets)
- New PHOTO LIBRARY card between BRAND ASSETS and STORED FILES: upload, search-by-name, tag filter
  chips with counts, grid of thumbnails (filename · size · px · uploaded-by), per-photo tag select,
  COPY URL (absolute — Cloudinary URL as-is, local paths prefixed with the portal origin), REMOVE.
- `GET/POST /api/v2/studio/library`, `PATCH/DELETE /api/v2/studio/library/:id`. Upload = multipart
  `photo`, ≤ 8 MB, jpg/png/webp with a **magic-byte sniff** of what was written; storage mirrors
  `user-portal/backend/v2/profile.js`: disk under `<ROOT>/admin-portal/backend/uploads/studio-library`
  (served by the existing `/uploads` static), pushed to **Cloudinary** (`medx/studio`) when
  `CLOUDINARY_URL` is set; on production without it the server-wide multipart gate already 503s.
- Delete is **soft** — `deleted_at` stamped, row and file kept (the toast says so).
- Tags: `gala / plexus / bridges / team / sponsor / misc`. **`sponsor` was added** to the asked five
  because ask 2 picks badge-strip logos "from the photo library by tag sponsor" — the two asks only
  reconcile if the tag exists.
- ⚠ ops note: `cloudinary` is NOT in `admin-portal/backend/package.json` (profile.js has the same
  guarded require on the member side, where it is installed). Before setting `CLOUDINARY_URL` on the
  admin service, `npm i cloudinary` — until then the guarded require logs and keeps the local file.

## 2 · Designer settings (v2_studio_settings, key/value JSON) — threaded for real
Each print drawer has a ⚙ SETTINGS strip; SAVE persists via `PUT /api/v2/studio/settings`
(validated/clamped server-side, audited). How each generate button READS them:
- **Badges — dimensions + sponsor strip.** Inspected first: the legacy engine hard-codes
  `PS_BADGE_W/H = 90×55` and `/api/admin/print/preview|render` accept no dimension fields, so
  passing anything would have been decorative. Instead `POST /api/v2/studio/badges/preview|render`
  build the sheet server-side at the configured trim (STD 90×55 · A6 148×105 · A7 105×74 · custom
  60–190 × 40–130 mm) and the badge buttons now call them. The builder mirrors the engine's
  contracts 1:1 — face geometry (psBadgeFace, scaled by k=min(W/90,H/55)), roster SQL
  (psEventPeople incl. staff-email promotion + dedupe), consent-aware member-verify QR
  (rewards_settings `badge_verify_secret`, same HMAC + eligibility), crop marks/bleed, A4
  imposition (7 mm outer minimum ⇒ at STD it reproduces the engine's exact 2×4/8mm layout;
  A6 → 2-up, A7 → 4-up), headless-Chrome PDF (same locator/args/poll/validation), and the saved
  `content_studio_assets` gallery row. No Chrome → the same 503 `print_engine_unavailable` the UI
  already explains. Sponsor strip: latest 6 library photos tagged `sponsor`, local files ≤ 4 MB
  embedded as data URIs (file:// PDF rendering can't fetch relative paths), drawn as a white bottom
  strip with the role chip/QR lifted above it. **Drift risk**: if the engine's badge face changes in
  server.js, v2/studio.js must follow — both sites carry a pointer comment.
- **Certificates — signature line + signer name/title.** `POST /api/v2/studio/certificates/preview`
  (already this module's route) now reads the persisted `certs` settings at generate time: signature
  on → "SIGNER · TITLE" + "MED&X ORGANISING TEAM" bars; off → team bar only. Verified end-to-end in
  the smoke (changed signer appears uppercased in the HTML; toggling removes it).
- **Print suite — paper size.** The engine's only real size knob is the roll-up banner's own `size`
  field ('100x200'|'85x200'), which `psBannerDoc` genuinely consumes — the drawer persists it and
  OPEN TEMPLATE / DOWNLOAD PRINT PDF now send it for `kind:'banner'`. The A4 sign and 240×240 cm
  backdrop are fixed formats in the engine; the strip says so instead of faking a knob.

## 3 · Social cards — background choice
Ink (unchanged default) · crimson `#9b1b22` · gold (ink text) · cream + ink text · **any library
photo** drawn cover-cropped under a `rgba(21,17,15,.30→.82)` scrim so the type stays legible. The
220px live preview mirrors the choice; the 1080×1080 PNG download still works (photo loads with
`crossOrigin='anonymous'` — same-origin locally, ACAO:* on Cloudinary; a tainted canvas is caught
with a clear toast instead of a silent failure). Background choice is per-session by design (ask 2
lists persisted settings for badge/cert/print only).

## 4 · Sign-up forms tile → FORM LINKS panel
The tile no longer routes blind to /links (Miro). It opens a drawer that lists every live link via
the SAME three GETs `js/views/links.js` reads (`/api/admin/registration-links`,
`/api/admin/gala/invite-links`, `/api/admin/croatians-abroad/invite-links`) — kind chip, label,
sign-up count, paused/expired state, URL + COPY — plus **NEW FORM LINK →** deep-linking
`/links?new=1`. The links tool itself is untouched (the `?new=1` create-intent is there for it to
honor; today it simply lands on the creator panel screen).

## 5 · 3D ballroom planner tile
Points at the external planner `https://plexus-tables.netlify.app` (new tab) with the one-line note
"external tool — seating imports back via Gala → table assignments"; GALA SEATING → /gala kept.

## 6 · The dead "+ UPLOAD"
The review-era dead button (STORED FILES header — the file-picker preventDefault bug, since fixed in
ui.js) is now the **photo-library upload**: the Studio's one "+ UPLOAD" sits on the PHOTO LIBRARY
card and feeds `v2_studio_assets`. The STORED FILES card keeps its list + OPEN and its header points
non-image team files at Settings → TEAM LIBRARY (same `/api/admin/files` engine, upload included) —
nothing lost, no duplicate upload buttons.

## Verification (all green, 2026-08-31)
- `node --check` on the backend module; ESM syntax-check on the view (as .mjs).
- `require()` mount smoke with stub `(app, ctx)` — 11 routes register, schema DDL guarded.
- Route-drive smoke (stub db): settings defaults → save → clamped echo → read-back; certificate
  preview picks up a changed signer and drops the line when toggled off; badges preview at A6 =
  148×105 cells, 2-up, sponsor logo + vector QR present; STD = 90×55, **8-up engine parity**;
  badges render produced a REAL headless-Chrome PDF locally (81,686 bytes, `%PDF-` validated,
  gallery row written, test file removed); library list/retag/validation; legacy routes intact.
- View render-smoke (stub modules + capturing fake DOM): base screen, every drawer (badges incl.
  settings save → PUT payload, certs, print incl. `size:'85x200'` on banner preview AND render but
  absent for sign, social all four solids + photo scrim + member-card strip, signup busy → rows →
  `?new=1`), library filter/soft-delete/copy toasts, destroy clean.
- `scripts/check-api-contract.js` — OK.

## Open follow-ups (not in this build's ownership)
- `js/views/links.js`: honor `?new=1` by focusing/highlighting the NEW LINK panel.
- Ops: `npm i cloudinary` on the admin service before `CLOUDINARY_URL` (see §1).
- If the print engine's badge face is restyled in server.js, mirror it in v2/studio.js (comments at
  both sites).
