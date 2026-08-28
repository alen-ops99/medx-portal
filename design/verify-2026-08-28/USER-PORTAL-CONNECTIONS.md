# Med&X MEMBER PORTAL — Verified Connections Inventory

**Audit date:** 2026-08-28 · **Repo:** `/Users/alen/Documents/Claude_Code_Projects/MedX/medx-portal-fresh` · **HEAD:** `main @ 8b7ba23` (in sync with origin; the two commits since the 2026-08-10 map — `8e85c33`, `8b7ba23` — touch only `admin-portal/`). Read-only: nothing committed, edited, or written to any database; live probes were GET/OPTIONS only and `/api/auth/login` was never called.

**Files audited (line counts at HEAD):** `user-portal/backend/server.js` 29,600 · `faq-kb.js` 721 · `fira-service.js` 237 · `user-portal/frontend/index.html` 19,056 · `forum-wing.html` 1,038 · `sw.js` 177 · `assets/app.part1.js` 2,112 · `app.part9.js` 53,672 · parts 2–8, 10–14 (19–359 lines each) · `shared/db.js` 137 · `shared/ai.js` 136 · `shared/wallet.js` 287 · `render.yaml` 154 · `admin-portal/backend/server.js` 43,529 (read only where the member portal touches it). Unless another file is named, a bare `:NNNN` below means `user-portal/backend/server.js:NNNN`.

**Method.** Deterministic extraction with grep/awk/perl/python (route registrations, `process.env.*`, SQL table identifiers, `fetch(`/`api(` call sites, storage keys, URLs), then handler-level reads of every non-obvious block. The purpose/feature columns of the two big tables were annotated from pre-extracted source context (3 lines above + 7 below each route; 14 above + 3 below each frontend call site) and spot-verified. Line-number citations from `design/CONNECTIONS-MAP.md` were re-checked by a regex-at-line script (§7).

## 0. Headline findings

1. **CORS is a hardcoded allowlist, not `CORS_ORIGIN`.** `CORS_ORIGIN` is read only by the admin portal (`admin-portal/backend/server.js:878`); the member portal never reads it (zero hits in `user-portal/**` and `shared/**`). The member allowlist at `:586–595` is `RENDER_EXTERNAL_URL`, `https://medx.hr`, `https://www.medx.hr`, `https://medx-website-preview.netlify.app`, `https://medx-admin-portal.onrender.com`, `http://localhost:3000|3001|8899`. **`https://medx-member-portal-review.netlify.app` is not allowed** — live probe returned no `access-control-allow-origin` for it while `https://www.medx.hr` got one (§8).
2. **The website's `mxt` hand-off on registration deep links is dead.** `site.js` (live file is byte-identical to the 2026-07-31 mirror, md5 `e59f65be…`) builds `PORTAL/plexus?event=…&ticket=…&from=website&mxt=…` (`site.js:1297–1301`). `/plexus` is a server-rendered page (`:1292` → `res.send(PLEXUS_SHELL(...))` at `:1569`) that reads only `:token`/`?t=` (`:1295`) and prefill keys (`:1386`); `event`, `ticket`, `from` and `mxt` are read nowhere on that path, and `index.html:54` (the `mxt` consumer) never executes because `index.html` is not served for `/plexus`. The website's `/?mxt=…#section` links (`site.js:592, 600, 665, 687`) do work.
3. **One server-to-server call admin → member exists** (map §2.3 says none): `admin-portal/backend/server.js:11341` does an unauthenticated `GET {userPortalBase()}/api/public/registrations/<email>` with a 10 s timeout as a cross-portal fallback. The member route `:29187` has no auth and no rate limit and returns registration rows by email.
4. **The admin→member gala refund depends on a shared `JWT_SECRET`.** Admin frontend `admin-portal/frontend/index.html:43241` POSTs to `https://medx-user-portal.onrender.com/api/admin/payments/gala/<id>/refund` with the admin portal's own JWT; the member route `:733` (`/api/admin/payments/:kind/:id/refund`, `auth, adminOnly`) verifies it with the member portal's `JWT_SECRET` (`:569`). `render.yaml:24–25` and `:101–102` declare `JWT_SECRET: generateValue: true` per service; the code comment at `:13850` assumes "shared JWT_SECRET + Turso DB". Whether the dashboard values match cannot be verified from the repo.
5. **Two navigation systems, two id schemes.** `UserPortal.showSection` (`app.part9.js:4413`) targets `#up-section-<id>` (`:4430`, 13 static ids in `index.html`) — not `#section-<id>` as the map says. `#section-<id>` (11 static ids) belongs to the staff `App` object (`app.part9.js:24986`, its `showSection` at `:27156–27172`).
6. **SCHEMA-MIRROR blocks are byte-identical** (`:9316–9842` vs admin `:4154–4680`, 527 lines, md5 `9d76c0f0138ae087cb07bb47a6b9cd32` on both).
7. **171 tables are touched by both portals** (139 written by both, 9 written only by the member portal and read by admin, 15 written only by admin and read by the member portal, 8 read-only in both); 28 tables are member-only, 79 admin-only.
8. **The member portal imports admin-portal code at boot:** `require('../../admin-portal/backend/demo-purge.js').runDemoPurge(...)` at `:29463` (the map only records the admin-side import of `fira-service.js`).
9. `ADMIN_PORTAL_URL` is read once (`:28495`) into `adminUrl`, which is never used; the member backend makes **no** HTTP call to the admin backend anywhere.
10. Drift: of 119 map line citations for the member portal/shared code, 113 still match at the cited line, 5 moved by 1–8 lines, 1 path is wrong (`POST /email-prefs` is really `POST /api/email-prefs`, `:1837`). The larger discrepancies are semantic (items 1–5, 8–9 above and §7).

---

## 1. ROUTE TABLE — every registration in `user-portal/backend/server.js`

**Extraction:** `^\s*(app|router)\.(get|post|put|patch|delete)\(` → **687 rows** (323 GET, 233 POST, 81 PUT, 2 PATCH, 48 DELETE). One registration uses an array path: `app.get(['/plexus', '/plexus/:token'], …)` at `:1292`. Non-route registrations, for completeness: `app.use(cors(...))` `:586`, `app.use(helmet(...))` `:599`, raw-body switch for the Stripe webhook `:645–651`, `express.static(../frontend)` `:5459`, `/uploads` hardening (`Content-Disposition: attachment`, nosniff, sandbox CSP) `:5463–5470`, ephemeral-storage 503 guard for multipart POST/PUT/PATCH when `CLOUDINARY_URL` is unset in production `:5541–5547`, JSON 404 for unknown `/api/*` `:29415–29417`, SPA fallback `app.get('*')` `:29421–29427` (404 for paths with an extension), global error handler `:29429`.

**Auth column — the middleware names actually used and what they do:**

| middleware | defined | behaviour |
|---|---|---|
| `auth` | `:6080–6111` | Bearer JWT verified with `JWT_SECRET` (`:569`), loads `users` row, rejects closed accounts (`deleted_at`) and tokens issued before `password_changed_at` (`:6066–6073`); a valid token with no user row binds `req.user` to the token's own claims with `is_admin:0` (`:6099`). Dev auto-login only when `DEV_AUTH_ENABLED` (`NODE_ENV=development` **and** no `TURSO_DATABASE_URL`, `:6078`). Labelled **member JWT**. |
| `adminOnly` | `:6139–6142` | after `auth`: 403 unless `req.user.is_admin`. Labelled **member JWT + is_admin** — there is no separate admin secret; "admin" is a member account flagged `users.is_admin=1`. |
| `optionalAuth` | `:6113–6137` | JWT if present, else `req.user = null`. **optional member JWT** |
| `applicantAuth` | `:23447–23464` | JWT whose payload has `type === 'applicant'` (Accelerator applicant portal). **applicant JWT** |
| `speakerDocAuth` | `:27951–27975` | `x-speaker-code` header matching `speakers.invite_code`, or a member JWT that is admin / matches the speaker email. |
| `travelOrderAccess` | `:25327–25334` | after `auth`: admin, or the traveller who owns the order. |
| `forumWingMemberGate` | `:4266–4271` | after `auth`: 403 unless a Forum member row exists. |
| `rewardsGone` | `:26370` | returns 410 (retired endpoints). |
| rate limiters | `authLimiter` `:10953` (15 / 15 min), `registrationLimiter` `:10964` (20 / 10 min), `publicLimiter` `:12030` (120 / min), `pvLimiter` `:12270` (300 / min), `speakerLimiter` `:4481` (120 / min), `forumWingLimiter` `:4186` (30 / 15 min), `donateCheckoutLimiter` `:5407–5410` (30 / 15 min, redirects to `https://medx.hr/donate?checkout_error=1`) | limiters only — no identity. |
| uploads | `upload` `:5499` (multer), `acceleratorUpload` `:14466`, `projectFilesUpload` `:19355`, `travelEvidenceUpload` `:25467`, `prMediaUpload` `:26033`, `cloudUpload(folder)` `:5567` (moves the file to Cloudinary when configured) | multipart handling only. |

Routes with **no** middleware (87) were classified by reading each handler: `public`, `signed-token` (a capability token / HMAC in the URL or body is the credential), `webhook (Stripe signature)`, `dev-only`. **Totals:** member JWT + is_admin 336 · member JWT 214 · optional member JWT 7 · applicant JWT 8 · speaker code/JWT 3 · signed-token 23 · Stripe webhook 1 · dev-only 1 · public 94 (of which 2 return PII with no auth: `:26838`, `:29187`).


#### Payments admin (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 733 | POST | `/api/admin/payments/:kind/:id/refund` | member JWT + is_admin | Admin refunds gala/forum/conference payment via Stripe, marks row refunded, emails guest confirmation |

#### Other admin (user-portal admin routes) (34 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 789 | GET | `/api/admin/registrations-csv` | member JWT + is_admin | Admin downloads registrations-log.csv file as CSV attachment, 404 if absent |
| 12357 | GET | `/api/admin/content-blocks` | member JWT + is_admin | Admin lists all content_blocks grouped by page |
| 12364 | GET | `/api/admin/content-blocks/:key` | member JWT + is_admin | Admin reads a single content block by key, 404 if missing |
| 12370 | PUT | `/api/admin/content-blocks/:key` | member JWT + is_admin | Admin updates content block body with type/length validation, bumps public memo |
| 14100 | GET | `/api/admin/feed-items` | member JWT + is_admin | Admin-only: lists all feed_items newest first |
| 14104 | POST | `/api/admin/feed-items` | member JWT + is_admin | Admin-only: creates a feed_items row |
| 14117 | PUT | `/api/admin/feed-items/:id` | member JWT + is_admin | Admin-only: updates a feed_items row by id |
| 14137 | DELETE | `/api/admin/feed-items/:id` | member JWT + is_admin | Admin-only: deletes a feed_items row by id |
| 14146 | GET | `/api/admin/opportunities` | member JWT + is_admin | Admin-only: lists opportunities queue, optional ?status= filter |
| 14154 | PUT | `/api/admin/opportunities/:id` | member JWT + is_admin | Admin-only: edits an opportunity including status approve/archive |
| 14174 | GET | `/api/admin/talks` | member JWT + is_admin | Admin-only: lists all talks in library |
| 14178 | POST | `/api/admin/talks` | member JWT + is_admin | Admin-only: creates a talks row |
| 14191 | PUT | `/api/admin/talks/:id` | member JWT + is_admin | Admin-only: updates a talks row by id |
| 14208 | DELETE | `/api/admin/talks/:id` | member JWT + is_admin | Admin-only: deletes a talks row by id |
| 19584 | GET | `/api/admin/registrations` | member JWT + is_admin | Admin lists conference registrations with user and ticket info, filterable |
| 19595 | POST | `/api/admin/registrations/:id/checkin` | member JWT + is_admin | Admin marks a registration as checked in |
| 19601 | POST | `/api/admin/checkin/scan` | member JWT + is_admin | Admin checks in registration from scanned QR JSON, returns registration |
| 19615 | GET | `/api/admin/abstracts` | member JWT + is_admin | Admin lists all abstracts with submitter details |
| 19620 | PUT | `/api/admin/abstracts/:id/decision` | member JWT + is_admin | Admin sets abstract decision, status and presentation type |
| 19628 | GET | `/api/admin/analytics/:confId` | member JWT + is_admin | Admin returns registration, abstract and other counts for a conference |
| 19644 | POST | `/api/admin/sessions` | member JWT + is_admin | Admin creates conference session row in sessions table |
| 19653 | POST | `/api/admin/announcements` | member JWT + is_admin | Admin creates announcement for a conference |
| 19661 | GET | `/api/admin/export/registrations/:confId` | member JWT + is_admin | Admin downloads CSV of registrations for a conference |
| 27128 | POST | `/api/admin/croatians-abroad/invite-links` | member JWT + is_admin | Admin creates Croatians Abroad invite link (croatian or international variant) |
| 27145 | GET | `/api/admin/croatians-abroad/invite-links` | member JWT + is_admin | Admin lists Croatians Abroad invite links with built URLs |
| 27151 | DELETE | `/api/admin/croatians-abroad/invite-links/:id` | member JWT + is_admin | Admin revokes a Croatians Abroad invite link |
| 27159 | POST | `/api/admin/croatians-abroad/invite-links/:id/revoke` | member JWT + is_admin | POST alias revoking a Croatians Abroad invite link |
| 27168 | GET | `/api/admin/croatians-abroad/registrations` | member JWT + is_admin | Admin lists diaspora registrations, excluding Plexus Experience rows |
| 27185 | GET | `/api/admin/croatians-abroad/emails-by-event/:event` | member JWT + is_admin | Admin exports diaspora registrant emails for conference, bridges or gala |
| 27216 | POST | `/api/admin/checkin/verify` | member JWT + is_admin | Admin verifies scanned QR/code for an event, optionally marks checked in |
| 27463 | GET | `/api/admin/checkin/enrich` | member JWT + is_admin | Admin read-only cross-registration lookup by email or userId for scanner |
| 27536 | POST | `/api/admin/checkin/test-email` | member JWT + is_admin | Admin creates test CA registration and emails themselves a scanner QR |
| 27598 | POST | `/api/admin/checkin/test-bundle-email` | member JWT + is_admin | Admin emails a simulated paid 3-event confirmation with Gala QR |
| 29410 | GET | `/api/admin/errors/recent` | member JWT + is_admin | Admin-only view of recent errors ring buffer, most recent first |

#### Invites (4 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 801 | GET | `/invite-success` | public (Stripe return, ?session_id) | Verifies Stripe Checkout session paid, returns HTML success page with QR ticket details |
| 972 | GET | `/invite-cancelled` | public (Stripe return) | Returns HTML payment-cancelled page for Plexus 2026 invite checkout |
| 3254 | GET | `/invite/:data` | signed-token (base64url {e,x,i}) | Renders invite registration HTML page from base64 payload, checks revoked/expired/max-use links |
| 28138 | POST | `/api/invite/validate-coupon` | public | Validates a coupon code for invite registrations via lookupPromo |

#### Legal pages (2 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 1026 | GET | `/terms` | public | Returns Terms and Conditions HTML page for Med&X event registration |
| 1073 | GET | `/privacy` | public | Returns Privacy Policy HTML page for the portal |

#### Misc (5 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 1292 | GET | `['/plexus','/plexus/:token']` | public (optional ?t=/:token invite) | renders Plexus registration wizard HTML, validates registration_links token |
| 13716 | POST | `/api/abstracts` | member JWT | Creates abstract submission with authors in abstracts and abstract_authors tables |
| 13732 | GET | `/api/abstracts/my` | member JWT | Returns caller's submitted abstracts with conference name and author list |
| 13741 | POST | `/api/abstracts/:id/withdraw` | member JWT | Marks caller's own abstract withdrawn in abstracts table |
| 23099 | GET | `/api/bell-feed` | member JWT | Returns website bell feed of caller's unexpired notifications with deep-link targets |

#### Building Bridges (16 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 1761 | GET | `/building-bridges` | public | Returns server-rendered public Building Bridges event HTML page |
| 16420 | GET | `/api/bridges/events` | member JWT | Lists published Building Bridges events with registration and check-in counts |
| 16438 | GET | `/api/bridges/events/:id` | member JWT | Returns single published Building Bridges event with registration count |
| 16446 | POST | `/api/bridges/events/:id/register` | member JWT | Registers user for free Bridges event, writes bridges_registrations, returns QR, rejects paid events |
| 16503 | GET | `/api/bridges/events/:id/my-registration` | member JWT | Returns caller's registration and event summary for a Bridges event, or registered false |
| 16512 | POST | `/api/bridges/apply` | member JWT | Legacy Bridges apply: registers for free event by event_id, writes bridges_registrations, returns QR |
| 16567 | GET | `/api/bridges/speakers` | member JWT | Lists published Bridges speakers, optionally by event_id, admins also see drafts |
| 16611 | POST | `/api/bridges/speakers` | member JWT + is_admin; shared handler factory | Admin: creates a Bridges speaker row via generic upsert handler |
| 16612 | PUT | `/api/bridges/speakers/:id` | member JWT + is_admin; shared handler factory | Admin: updates a Bridges speaker row via generic upsert handler |
| 16613 | POST | `/api/bridges/program` | member JWT + is_admin; shared handler factory | Admin: creates a Bridges program item via generic upsert handler |
| 16614 | PUT | `/api/bridges/program/:id` | member JWT + is_admin; shared handler factory | Admin: updates a Bridges program item via generic upsert handler |
| 16623 | DELETE | `/api/bridges/speakers/:id` | member JWT + is_admin; shared handler factory | Admin: deletes a Bridges speaker by id |
| 16624 | DELETE | `/api/bridges/program/:id` | member JWT + is_admin; shared handler factory | Admin: deletes a Bridges program item by id |
| 16635 | PUT | `/api/bridges/speakers/:id/publish` | member JWT + is_admin; shared handler factory | Admin: toggles is_published on a Bridges speaker |
| 16636 | PUT | `/api/bridges/program/:id/publish` | member JWT + is_admin; shared handler factory | Admin: toggles is_published on a Bridges program item |
| 16640 | GET | `/api/bridges/program` | member JWT | Lists published Bridges program items with speaker names, optionally by event_id, admins see drafts |

#### Public event pages (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 1762 | GET | `/donor-night` | public | Returns server-rendered public Donor Night event HTML page |

#### Member (MyMedX) (32 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 1768 | GET | `/api/member-card-visibility` | public | Returns JSON member-card visibility toggles for Plexus and Gala SPA surfaces, fail-open |
| 12479 | POST | `/api/purchases/inquiry` | member JWT | Files member refund request or question about a purchase into direct_messages inbox |
| 12968 | GET | `/api/member/meta` | member JWT | Returns member type, label and member-since metadata (get-or-create member meta) |
| 12986 | GET | `/api/member/verify-link` | member JWT | Mints member's own public verification badge link with name and member-since year |
| 13008 | GET | `/api/member/share-record-link` | member JWT | Mints member's own shareable read-only record link token (/r/:token) |
| 13055 | GET | `/api/my/events` | member JWT | Unified list of member's event registrations across tables, upcoming/past, with QR and calendar links |
| 13106 | GET | `/api/member/record` | member JWT | Returns member's participation record: conference registrations with status, check-in, invoice |
| 13156 | GET | `/api/member/passport` | member JWT | Returns member passport stamps from registrations/check-ins and Bridges participation, quiet profiles empty |
| 13200 | GET | `/api/member/wrapped` | member JWT | Returns member year-in-review ("wrapped") counts, quiet flag disables gamified framing |
| 13275 | POST | `/api/member/card-consent` | member JWT | Upserts member's marketing-card photo consent flag into card_photo_consents |
| 13293 | GET | `/api/member/wallet/google` | member JWT | Returns Google Wallet membership pass link, or unconfigured gate without issuer secrets |
| 13383 | GET | `/api/member/wallet/google/ticket/:regId` | member JWT | Returns Google Wallet event ticket link for member's registration, creates class/object server-side |
| 13438 | GET | `/api/member/wallet/apple/ticket/:regId` | member JWT | Apple Wallet ticket for own registration, returns unconfigured gate until signing certs exist |
| 13467 | GET | `/api/member/search` | member JWT | Member search across events, members, talks and own items, forum directory gated |
| 13609 | GET | `/api/member/profile-nudge` | member JWT | Returns whether to show profile-completion nudge (missing photo/institution), quiet profiles never |
| 13625 | POST | `/api/member/profile-nudge/dismiss` | member JWT | Persists profile-nudge dismissal in dashboard_preferences, idempotent |
| 13645 | GET | `/api/member/founder-welcome` | member JWT | Returns whether founder welcome note is still unseen (dashboard_preferences) |
| 13653 | POST | `/api/member/founder-welcome/seen` | member JWT | Marks founder welcome note seen in dashboard_preferences |
| 13673 | GET | `/api/member/giving` | member JWT | Returns member's Donor Night supporter status and totals from bridges_registrations, fail-closed |
| 13696 | GET | `/api/me/locale` | member JWT | Returns member's saved portal locale (en/hr/null) from users |
| 13705 | PATCH | `/api/me` | member JWT | Saves member's portal locale (en or hr) to users.locale |
| 14222 | GET | `/api/mentorship/profile` | member JWT | Returns caller's mentorship_profiles row or null |
| 14228 | PUT | `/api/mentorship/profile` | member JWT | Upserts caller's mentorship profile (role, topics, capacity, active) |
| 14249 | GET | `/api/mentorship/mentors` | member JWT | Lists active mentors with remaining capacity, excluding caller, with request status |
| 14279 | POST | `/api/mentorship/requests` | member JWT | Creates a mentorship request from caller to a mentor (mentorship_requests) |
| 14302 | GET | `/api/mentorship/requests` | member JWT | Returns caller's mentorship requests in both directions with names |
| 14327 | PUT | `/api/mentorship/requests/:id` | member JWT | Recipient accepts/declines/ends a mentorship request, sender may withdraw or end |
| 23167 | GET | `/api/me/next-event` | member JWT | Returns caller's next-event chip data: registration, ticket, gala, balance due |
| 26724 | POST | `/api/messages` | member JWT | Sends direct message, inserts direct_messages row, pushes notification to receiver |
| 26775 | GET | `/api/messages` | member JWT | Lists member's conversations with latest message per partner |
| 26805 | GET | `/api/messages/:userId` | member JWT | Returns paginated direct-message conversation with a specific user |
| 26838 | GET | `/api/members/verify` | public (NO auth — returns member id/email/name) | Public member QR verification lookup by id or email |

#### Email preferences (3 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 1827 | GET | `/email-prefs` | signed-token (HMAC e+s) | Returns email preferences HTML page for HMAC-signed link, reads email_optouts scopes |
| 1837 | POST | `/api/email-prefs` | public; body parser override | Saves reminders/newsletter opt-out choices to email_optouts from signed form post |
| 1857 | GET | `/unsubscribe` | signed-token (HMAC e+s) | One-click unsubscribe: writes reminders+newsletter opt-out to email_optouts, redirects to prefs page |

#### Signup forms (4 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 2349 | GET | `/f/:slug/qr.png` | public | Returns PNG QR code image linking to the public sign-up form URL |
| 2363 | GET | `/f/:slug` | public | Renders public sign-up form HTML page from signup_forms by slug, syncs Turso if missing |
| 3204 | GET | `/f/:slug/calendar.ics` | public | Returns ICS calendar file for a sign-up form event by slug |
| 29226 | POST | `/api/signup-forms/:slug/submit` | public; rate-limited: registrationLimiter | Public sign-up form submit: inserts response, emails ticket, honeypot and waitlist handling |

#### Verification links (2 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 2717 | GET | `/verify/:token` | signed-token (badge token) | Public member verification badge HTML page resolved from signed token, neutral on invalid |
| 2906 | GET | `/r/:token` | signed-token (share token) | Public read-only shareable member record HTML page from signed token, neutral on invalid |

#### Calendar feeds (2 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 3147 | GET | `/calendar/medx-events.ics` | public | Returns ICS calendar feed of all upcoming open published Med&X events |
| 3188 | GET | `/calendar/:file` | public | Returns downloadable ICS calendar file for a named event slug, 404 if unknown |

#### Guest passes (6 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 3227 | GET | `/pass/:token/calendar.ics` | signed-token (guest-pass token) | Returns ICS calendar file for a valid non-revoked guest pass event |
| 5341 | GET | `/pass/:token/manifest.json` | signed-token; rate-limited: speakerLimiter | Returns guest pass PWA manifest JSON by token, 404 if revoked |
| 5363 | GET | `/pass/:token` | signed-token; rate-limited: speakerLimiter | Renders guest pass HTML page by token, syncs Turso if missing, 404 if revoked/expired |
| 12832 | GET | `/api/guest-passes` | member JWT | Lists member's own guest passes, optionally per event, plus remaining allowance |
| 12851 | POST | `/api/guest-passes` | member JWT | Creates guest pass: validates eligibility/limit, inserts linked ticket row, stages invite email |
| 12921 | POST | `/api/guest-passes/:id/revoke` | member JWT | Member revokes own guest pass, cancels linked ticket, pulls unsent invite from outbox |

#### QR images (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 4076 | GET | `/qr/:id.png` | public (unguessable uuid) | Returns hosted PNG QR ticket image for registration UUID, embedded in confirmation emails |

#### Forum (40 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 4155 | GET | `/forum` | public | Serves the Forum wing HTML file (forum-wing.html) to anyone |
| 4163 | GET | `/forum/enter` | signed-token (forum magic link) | Consumes one-time forum magic-link token, marks used, mints JWT, redirects member into wing |
| 4274 | GET | `/api/forum/wing/me` | public (soft optional JWT) | Soft-auth JSON: returns authenticated, forum member, profile and news, always 200 |
| 4294 | POST | `/api/forum/wing/request-link` | public; rate-limited: forumWingLimiter | Creates forum_magic_tokens row and emails member a magic access link, neutral response |
| 4349 | GET | `/api/forum/wing/directory` | member JWT; + forum member | Members-only search over approved forum members directory with field/institution filters |
| 4386 | GET | `/api/forum/wing/convenings` | member JWT; + forum member | Lists published forum convenings with segments and the member's confirmed reservations |
| 4407 | POST | `/api/forum/wing/convenings/:id/reserve` | member JWT; + forum member | Reserves member seat at forum convening with segments, generates QR, sends confirmation email |
| 16924 | GET | `/api/forum/me` | member JWT | Returns caller's forum_members row or membership_status none |
| 16932 | POST | `/api/forum/apply` | member JWT | Creates pending forum_members application for caller, rejects duplicates |
| 16951 | PUT | `/api/forum/profile` | member JWT | Updates approved forum member's profile fields in forum_members |
| 16981 | GET | `/api/forum/members` | member JWT | Paginated forum member directory with specialty, career-stage, country, search filters, members/admins only |
| 17019 | GET | `/api/forum/members/:id` | member JWT | Returns approved forum member profile with user name and connection status to caller |
| 17041 | POST | `/api/forum/connections` | member JWT | Sends forum connection request, inserts forum_connections row, blocks duplicates |
| 17064 | GET | `/api/forum/connections` | member JWT | Lists caller's forum connections with the other member's details |
| 17090 | PUT | `/api/forum/connections/:id` | member JWT | Receiver accepts or rejects a forum connection request, updates forum_connections status |
| 17109 | GET | `/api/forum/groups` | member JWT | Lists active forum groups with member counts and caller's membership flag |
| 17128 | POST | `/api/forum/groups/:id/membership` | member JWT | Approved member joins or leaves a forum group, writes forum_group_members |
| 17149 | GET | `/api/forum/groups/:id/members` | member JWT | Lists a forum group's member roster, group members or admins only |
| 17171 | GET | `/api/forum/groups/:id/messages` | member JWT | Returns a forum group's chat messages, group members or admins only |
| 17195 | POST | `/api/forum/groups/:id/messages` | member JWT; multipart upload | Posts a group chat message with optional file upload into forum_group_messages |
| 17225 | GET | `/api/forum/posts` | member JWT | Paginated approved forum posts feed filtered by group, author, or type |
| 17257 | POST | `/api/forum/posts` | member JWT | Approved member creates a forum post, inserts forum_posts |
| 17278 | POST | `/api/forum/posts/:id/react` | member JWT | Toggles caller's like on a forum post in forum_post_reactions |
| 17299 | GET | `/api/forum/posts/:id/comments` | member JWT | Returns approved comments for a forum post with author details |
| 17314 | POST | `/api/forum/posts/:id/comments` | member JWT | Adds a comment or reply to a forum post, inserts forum_comments |
| 17335 | GET | `/api/forum/events` | member JWT | Lists published forum events with organizer and registration counts, upcoming/past filters |
| 17365 | POST | `/api/forum/events/:id/register` | optional member JWT; rate-limited: registrationLimiter | Registers member or guest for forum event, writes forum_event_registrations, sends confirmation email |
| 17480 | POST | `/api/forum/events/:id/checkout-session` | member JWT | Creates Stripe Checkout session for a paid forum event registration |
| 17552 | GET | `/api/forum/events/:id` | member JWT | Returns a forum event by id or slug, no published filter |
| 17558 | GET | `/api/forum/events/:id/my-registration` | member JWT | Returns caller's registration for a forum event with check-in flag and event title |
| 17574 | GET | `/api/forum/events/:eventId/schedule` | member JWT | Returns forum event schedule items ordered by sort order and start time |
| 17584 | GET | `/api/forum/media` | member JWT | Lists approved forum media filtered by event, gallery name, type, or folder |
| 17606 | GET | `/api/forum/gallery/folders` | member JWT | Lists forum gallery folders, optionally by parent_id |
| 17625 | GET | `/api/forum/gallery/folders/:id` | member JWT | Returns a single forum gallery folder by id |
| 17667 | GET | `/api/forum/resources` | member JWT | Lists forum resources with uploader names, filtered by category, type, search |
| 17687 | GET | `/api/forum/mentors` | member JWT | Lists approved forum mentors ordered by points |
| 17701 | POST | `/api/forum/mentorship` | member JWT | Approved member requests mentorship, inserts forum_mentorships, blocks duplicate active requests |
| 17722 | POST | `/api/forum/opportunities` | member JWT | Creates a forum opportunity post in forum_opportunities, creating the table if missing |
| 17740 | GET | `/api/forum/opportunities` | member JWT | Lists forum opportunities with poster names, creating the table if missing |
| 18604 | POST | `/api/af26/register` | member JWT | Member registers for AF26, writes forum_event_registrations, mirrors to Sheets, returns QR code |

#### Public website API (14 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 4329 | POST | `/api/public/forum-consideration` | public; rate-limited: forumWingLimiter | Public forum membership application, inserts pending row into forum_considerations |
| 5117 | GET | `/api/public/speaker-itinerary/:token` | signed-token; rate-limited: speakerLimiter | Returns read-only speaker itinerary JSON payload by token, 404 if revoked |
| 11943 | GET | `/api/public/site` | public | Public site JSON: active conference, ticket prices, confirmed speakers, no PII |
| 12045 | GET | `/api/public/content` | public; rate-limited: publicLimiter | Returns published website content_blocks JSON, optional page filter, memoised 45s |
| 12072 | GET | `/api/public/status` | public; rate-limited: publicLimiter | Public project status cards JSON in hub order, memoised 30s |
| 12096 | GET | `/api/public/impact` | public; rate-limited: publicLimiter | Public impact counts JSON (members, countries, registrations), memoised 2 min |
| 12141 | GET | `/api/public/supporters` | public; rate-limited: publicLimiter | Public supporters wall JSON from published public-body/company sponsors, memoised 5 min |
| 12208 | GET | `/api/public/survey` | public; rate-limited: publicLimiter | Renders tokenized post-event survey HTML page, localized, invalid state if token unknown |
| 12231 | GET | `/api/public/survey/recommend` | public; rate-limited: publicLimiter | Records yes/no recommend vote on event_survey_responses once, re-renders survey page |
| 12250 | POST | `/api/public/survey/comment` | public; rate-limited: publicLimiter | Stores survey free-text comment on event_survey_responses by token, once only |
| 12296 | POST | `/api/public/pv` | public; rate-limited: pvLimiter; body parser override | Records PII-free website page-view beacon, honours DNT/GPC, cross-origin allowed |
| 28897 | POST | `/api/public-events/register` | optional member JWT; rate-limited: registrationLimiter | Public event registration: inserts bridges_registrations, emails QR ticket, Sheets sync |
| 29184 | GET | `/health` | public | Health check returning ok true |
| 29187 | GET | `/api/public/registrations/:email` | public (NO auth — registrations by email) | Public cross-portal lookup of a member's registrations by email |

#### Speakers (6 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 5071 | GET | `/speaker/:token/manifest.json` | signed-token; rate-limited: speakerLimiter | Returns per-speaker dynamic PWA manifest JSON for itinerary token, 404 if revoked |
| 5097 | GET | `/speaker/:token` | signed-token; rate-limited: speakerLimiter | Server-rendered speaker itinerary HTML plan page by token, 404 notice if unknown/revoked |
| 27911 | POST | `/api/speakers/auth` | public; rate-limited: authLimiter | Verifies speaker invite code, returns speaker record |
| 27978 | GET | `/api/speakers/:id/documents` | speaker code (x-speaker-code) or JWT (admin/own email) | Lists a speaker's uploaded documents |
| 27987 | POST | `/api/speakers/:id/documents` | speaker code (x-speaker-code) or JWT (admin/own email); multipart upload | Uploads speaker document, replaces same-type doc, writes speaker_documents |
| 28026 | DELETE | `/api/speakers/:id/documents/:docId` | speaker code (x-speaker-code) or JWT (admin/own email) | Deletes a speaker document and removes file from disk |

#### Donations (medx.hr) (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 5411 | GET | `/donate/checkout` | public (medx.hr donate form); rate-limited: donateCheckoutLimiter | Creates Stripe Checkout session for one-time or recurring donation and redirects donor |

#### Auth & account (15 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 11034 | POST | `/api/auth/register` | public; rate-limited: authLimiter | Creates user account, issues verification email, schedules welcome drip, returns JWT |
| 11095 | POST | `/api/auth/login` | public; rate-limited: authLimiter | Validates email/password, returns JWT, audits failed login attempts |
| 11141 | DELETE | `/api/auth/account` | member JWT | Deletes member account: removes social rows, anonymizes/deletes user row |
| 11211 | GET | `/api/auth/my-data` | member JWT | GDPR export: returns JSON of account, registrations, points ledger, followed topics |
| 11253 | GET | `/api/verify-email` | signed-token (verification token) | Legacy email verification via users.verification_token, marks email_verified |
| 11278 | POST | `/api/resend-verification` | public; rate-limited: authLimiter | Resends verification email to unverified user by email address |
| 11664 | POST | `/api/dev/run-milestones` | dev-only (404 in production) | Dev-only trigger runs milestone reconcile, returns enqueued count, 404 in production |
| 11672 | POST | `/api/auth/request-verification` | public; rate-limited: authLimiter | Re-issues signup confirmation link email for unverified user, generic success response |
| 11701 | GET | `/api/auth/verify` | signed-token (verification token) | Confirms email_verifications token, sets users.email_verified=1, redirects to app with ?verified status |
| 11750 | POST | `/api/auth/forgot-password` | public; rate-limited: authLimiter | Generates password reset token and emails reset link, success even if unknown email |
| 11789 | GET | `/reset-password/:token` | signed-token (reset token) | Server-rendered password reset form HTML page for token, invalid/expired notice otherwise |
| 11855 | POST | `/api/auth/reset-password` | public; rate-limited: authLimiter | Validates reset token, hashes and saves new password, clears token |
| 11882 | POST | `/api/auth/change-password` | member JWT; rate-limited: authLimiter | In-session password change: verifies current password, saves new hash |
| 11903 | GET | `/api/auth/me` | member JWT | Returns current member profile JSON from users plus quiet flag |
| 11922 | PUT | `/api/auth/profile` | member JWT | Updates member profile fields in users, awards profile-completion points once |

#### Conference data (16 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 11936 | GET | `/api/conferences/active` | public | Returns the active conference row JSON |
| 12398 | GET | `/api/conferences/:slug` | public | Returns conference row by slug, 404 if missing |
| 12404 | GET | `/api/conferences` | public | Lists all conferences ordered by year descending |
| 12409 | GET | `/api/conferences/:confId/tickets` | public | Lists ticket_types for a conference ordered by sort_order |
| 12413 | POST | `/api/promo-codes/validate` | public | Validates active promo code for conference, returns discount type/value and id |
| 13748 | GET | `/api/conferences/:confId/schedule` | public | Public: returns conference sessions ordered by day and start time |
| 13752 | GET | `/api/schedule/my` | member JWT | Returns sessions in caller's personal schedule |
| 13757 | POST | `/api/schedule/add` | member JWT | Adds a session to caller's personal_schedules, tolerates duplicates |
| 13768 | DELETE | `/api/schedule/:sessionId` | member JWT | Removes a session from caller's personal schedule |
| 13775 | GET | `/api/conferences/:confId/speakers` | public | Public: returns confirmed published speakers for a conference, keynotes first |
| 13780 | POST | `/api/sessions/:sessionId/questions` | member JWT | Posts a member question to a session (writes session_questions) |
| 13787 | GET | `/api/sessions/:sessionId/questions` | public | Public: returns session questions with asker names, upvotes first |
| 13793 | GET | `/api/conferences/:confId/attendees` | member JWT | Returns public-profile confirmed attendees of a conference for networking |
| 13833 | GET | `/api/conferences/:confId/announcements` | public | Public: returns conference announcements, urgent first |
| 13838 | GET | `/api/conferences/:confId/sponsors` | public | Public: returns conference sponsors ordered by tier then sort order |
| 13844 | GET | `/api/conferences/:confId/resources` | public | Public: returns conference resources ordered by category and title |

#### Content & feed (10 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 12066 | GET | `/api/org/signature` | public; rate-limited: publicLimiter | Returns org founder signature data URL from org_settings, public read |
| 13855 | GET | `/api/feed` | member JWT | Returns latest 20 published feed_items for Member Home feed |
| 13892 | GET | `/api/feed/home` | member JWT | Builds Member Home activity stream from feed, announcements, forum posts with AI summary |
| 13977 | GET | `/api/opportunities` | member JWT | Returns approved opportunities, optional ?kind= filter |
| 13988 | POST | `/api/opportunities` | member JWT | Member submits opportunity, inserted as pending for admin curation |
| 14007 | GET | `/api/talks` | member JWT | Returns published talk library with rating count, avg (3+ ratings), caller's rating |
| 14024 | GET | `/api/talks/:id/rating` | member JWT | Returns a talk's rating count, average (only at 3+), and caller's rating |
| 14037 | POST | `/api/talks/:id/rating` | member JWT | Upserts caller's 1-5 star rating for a talk, returns fresh aggregate |
| 28088 | GET | `/api/portal-content/published` | public | Public list of all published portal content |
| 28094 | GET | `/api/portal-content/published/:section` | public | Public list of published portal content by section |

#### Registrations (6 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 12423 | POST | `/api/registrations` | member JWT | Creates conference registration row with tiered pricing, promo discount, QR file, invoice number |
| 12464 | GET | `/api/registrations/my` | member JWT | Lists member's own conference registrations with conference/ticket info, triggers milestone reconcile |
| 12710 | GET | `/api/registrations/:id` | member JWT | Returns registration detail with conference/ticket/user joins, owner or admin only |
| 28455 | POST | `/api/register-invite` | public; rate-limited: registrationLimiter | Public invite registration: creates user, applies coupon, Stripe Checkout, confirmation email, Sheets sync |
| 29024 | GET | `/api/register-direct/:token` | signed-token (registration link token) | Validates direct registration link token, returns event and package info |
| 29056 | POST | `/api/register-direct/:token` | signed-token (registration link token) | Submits direct registration via link token, creates user, increments link uses |

#### Member assistant (3 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 12578 | POST | `/api/assistant/ask` | member JWT | FAQ assistant: answers member question from KB, blocks medical questions, logs assistant_faq_log |
| 12659 | POST | `/api/assistant/feedback` | member JWT | Records helpful yes/no vote on assistant_faq_log row |
| 12673 | POST | `/api/assistant/escalate` | member JWT | Escalates assistant question to admin inbox via direct_messages, routed team/support/president |

#### Gala (10 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 13023 | GET | `/api/gala/my-seat` | member JWT | Returns member's gala seat/table from gala_table_assignments or in-portal seating plan |
| 26870 | POST | `/api/gala/register` | optional member JWT | Public gala invitation request: inserts pending row, notifies admins, emails confirmation, Sheets sync |
| 26945 | GET | `/api/gala/registrations` | member JWT + is_admin | Admin lists all gala registrations, newest first |
| 26951 | PUT | `/api/gala/registrations/:id` | member JWT + is_admin | Admin approves/rejects gala registration, emails approval with payment link |
| 26991 | GET | `/api/gala/settings` | public | Public read of gala settings with parsed speakers and schedule |
| 27001 | PUT | `/api/gala/settings` | member JWT + is_admin | Admin updates gala settings fields (title, prices, capacity, speakers, schedule) |
| 27744 | GET | `/api/gala/my-status` | member JWT | Returns member's latest gala registration status by email |
| 27757 | GET | `/api/gala/my` | member JWT | Returns member's gala tickets for wallet with hosted QR and payment state |
| 27783 | POST | `/api/gala/checkout-session` | member JWT | Creates Stripe Checkout session for approved gala ticket, assigns invoice number |
| 27868 | GET | `/pay/gala/:token` | signed-token; rate-limited: publicLimiter | Public pay-link page: redirects approved gala registrant to Stripe Checkout, else HTML status page |

#### Networking & chat (35 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 13799 | POST | `/api/connections/request` | member JWT | Creates a connection request row in connections table |
| 13805 | GET | `/api/connections/my` | member JWT | Returns caller's connection requests both directions with member details |
| 13818 | POST | `/api/connections/:id/respond` | member JWT | Accepts or declines an incoming connection request (updates connections status) |
| 14352 | GET | `/api/networking/mutual-counts` | member JWT | Returns count of caller's accepted connections shared with each other member |
| 14373 | GET | `/api/networking/mutuals/:userId` | member JWT | Lists caller's connections who are mutual with a given user |
| 14394 | POST | `/api/intro-requests` | member JWT | Creates a warm-intro request via a connector to a target member (intro_requests) |
| 14419 | GET | `/api/intro-requests` | member JWT | Returns caller's intro requests sent and to-forward, with names and status |
| 14445 | PUT | `/api/intro-requests/:id` | member JWT | Connector marks an intro request forwarded or declined |
| 18693 | GET | `/api/channels` | member JWT + is_admin | Admin lists chat channels with member counts, filterable by project or membership |
| 18716 | GET | `/api/channels/:project/tree` | member JWT + is_admin | Admin returns project chat channels as parent/child tree with member counts |
| 18731 | POST | `/api/channels` | member JWT + is_admin | Admin creates chat channel with slugified name and optional parent |
| 18741 | PUT | `/api/channels/:id` | member JWT + is_admin | Admin updates chat channel name and description |
| 18750 | DELETE | `/api/channels/:id` | member JWT + is_admin | Admin deletes non-default chat channel plus child channels, messages and members |
| 18772 | GET | `/api/channels/:id/members` | member JWT + is_admin | Admin lists channel members joined with team member name, role, avatar |
| 18784 | GET | `/api/chat/messages` | member JWT + is_admin | Admin lists chat messages for a channel with sender and reply info |
| 18810 | POST | `/api/chat/messages` | member JWT + is_admin | Admin posts chat message to channel (default if none) and returns it |
| 18838 | POST | `/api/chat/upload` | member JWT + is_admin; multipart upload | Admin uploads chat file to uploads/chat (cloud) and returns file URL |
| 18857 | POST | `/api/chat/dm` | member JWT + is_admin | Admin creates or returns existing DM channel between two team members |
| 18887 | GET | `/api/chat/unread` | member JWT + is_admin | Admin returns unread message count per channel for current team member |
| 18913 | POST | `/api/chat/read` | member JWT + is_admin | Admin marks a channel as read by upserting channel_read_status |
| 26420 | GET | `/api/networking/discover` | member JWT | Lists visible members with networking profiles for the Discover tab |
| 26443 | PUT | `/api/networking/profile` | member JWT | Upserts member's networking preferences and coffee-matchmaker opt-in in networking_profiles |
| 26461 | GET | `/api/networking/profile` | member JWT | Returns member's networking profile with parsed research interests |
| 26470 | POST | `/api/networking/connections` | member JWT | Sends connection request, inserts networking_connections row, pushes notification to receiver |
| 26496 | GET | `/api/networking/connections` | member JWT | Lists member's accepted connections with partner details |
| 26506 | PUT | `/api/networking/connections/:id` | member JWT | Receiver accepts or rejects a pending connection request |
| 26518 | GET | `/api/networking/connections/pending` | member JWT | Lists pending incoming connection requests with requester details |
| 26526 | POST | `/api/networking/meetings` | member JWT | Schedules meeting with an accepted connection, inserts networking_meetings row |
| 26550 | GET | `/api/networking/meetings` | member JWT | Lists member's meetings with counterpart details, newest first |
| 26561 | PUT | `/api/networking/meetings/:id` | member JWT | Participant updates meeting status to confirmed, cancelled or completed |
| 26580 | POST | `/api/networking/meeting-requests` | member JWT | Creates 1:1 meeting request in pending_meetings for accepted connection, pushes notification |
| 26616 | GET | `/api/networking/meeting-requests` | member JWT | Lists member's incoming and outgoing meeting requests |
| 26627 | PUT | `/api/networking/meeting-requests/:id` | member JWT | Recipient accepts or declines meeting request, pushes notification, placeholder link only |
| 26657 | POST | `/api/networking/connect-by-badge` | member JWT | Resolves scanned badge token, creates accepted connection, pushes notification |
| 26693 | GET | `/api/networking/coffee-match` | member JWT | Returns this month's deterministic coffee-chat match for opted-in member |

#### PR & media (staff) (51 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 14062 | GET | `/api/project-status` | member JWT | Returns project status cards (project_status table) in fixed hub order |
| 18980 | GET | `/api/projects/settings` | member JWT + is_admin | Admin returns all project_settings keyed by project (date, venue, description) |
| 18996 | PUT | `/api/projects/:project/settings` | member JWT + is_admin | Admin upserts project_settings date, end_date, venue, location, description |
| 19015 | PUT | `/api/projects/:project/date` | member JWT + is_admin | Legacy admin endpoint upserting project_settings date and description |
| 25678 | GET | `/api/pr/dashboard` | member JWT + is_admin | Admin-only PR dashboard, returns upcoming content, posts, campaigns, subscriber and analytics stats |
| 25745 | GET | `/api/pr/calendar` | member JWT + is_admin | Admin-only, lists pr_content_calendar filtered by month, project and platform |
| 25767 | GET | `/api/pr/calendar/:id` | member JWT + is_admin | Admin-only, returns one pr_content_calendar item by id |
| 25773 | POST | `/api/pr/calendar` | member JWT + is_admin | Admin-only, creates scheduled content item in pr_content_calendar |
| 25783 | PUT | `/api/pr/calendar/:id` | member JWT + is_admin | Admin-only, updates all fields of a pr_content_calendar item |
| 25792 | POST | `/api/pr/calendar/:id/approve` | member JWT + is_admin | Admin-only, marks calendar item approved with approver and timestamp |
| 25799 | POST | `/api/pr/calendar/:id/publish` | member JWT + is_admin | Admin-only, marks calendar item published and inserts pr_posts row, no external API |
| 25815 | DELETE | `/api/pr/calendar/:id` | member JWT + is_admin | Admin-only, deletes a pr_content_calendar item by id |
| 25822 | GET | `/api/pr/posts` | member JWT + is_admin | Admin-only, lists pr_posts filtered by project and platform with limit |
| 25845 | GET | `/api/pr/posts/:id` | member JWT + is_admin | Admin-only, returns one pr_posts record by id |
| 25851 | POST | `/api/pr/posts` | member JWT + is_admin | Admin-only, records social post with metrics in pr_posts, computes engagement rate |
| 25862 | PUT | `/api/pr/posts/:id` | member JWT + is_admin | Admin-only, updates post engagement metrics and recomputes engagement_rate |
| 25871 | DELETE | `/api/pr/posts/:id` | member JWT + is_admin | Admin-only, deletes a pr_posts record by id |
| 25878 | GET | `/api/pr/newsletters` | member JWT + is_admin | Admin-only, lists pr_newsletters filtered by status and project |
| 25896 | GET | `/api/pr/newsletters/:id` | member JWT + is_admin | Admin-only, returns one pr_newsletters record by id |
| 25902 | POST | `/api/pr/newsletters` | member JWT + is_admin | Admin-only, creates newsletter draft in pr_newsletters |
| 25912 | PUT | `/api/pr/newsletters/:id` | member JWT + is_admin | Admin-only, updates newsletter content, status and schedule in pr_newsletters |
| 25921 | POST | `/api/pr/newsletters/:id/send` | member JWT + is_admin | Admin-only, marks newsletter sent with active subscriber count, sends no email |
| 25930 | DELETE | `/api/pr/newsletters/:id` | member JWT + is_admin | Admin-only, deletes a pr_newsletters record by id |
| 25937 | GET | `/api/pr/subscribers` | member JWT + is_admin | Admin-only, lists pr_subscribers filtered by status, project and search |
| 25959 | POST | `/api/pr/subscribers` | member JWT + is_admin | Admin-only, adds subscriber to pr_subscribers, rejects duplicate email |
| 25973 | PUT | `/api/pr/subscribers/:id` | member JWT + is_admin | Admin-only, updates subscriber details and status in pr_subscribers |
| 25982 | POST | `/api/pr/subscribers/:id/unsubscribe` | member JWT + is_admin | Admin-only, marks subscriber unsubscribed with timestamp |
| 25988 | DELETE | `/api/pr/subscribers/:id` | member JWT + is_admin | Admin-only, deletes a pr_subscribers record by id |
| 25995 | GET | `/api/pr/subscribers/export` | member JWT + is_admin | Admin-only, exports all pr_subscribers as CSV download |
| 26007 | POST | `/api/pr/subscribers/import` | member JWT + is_admin | Admin-only, bulk imports subscribers into pr_subscribers, returns imported and skipped counts |
| 26048 | GET | `/api/pr/media` | member JWT + is_admin | Admin-only, lists pr_media_assets filtered by project, category and search |
| 26070 | GET | `/api/pr/media/:id` | member JWT + is_admin | Admin-only, returns one pr_media_assets record by id |
| 26076 | POST | `/api/pr/media` | member JWT + is_admin; multipart upload | Admin-only, uploads media file to uploads/pr-media, writes pr_media_assets row |
| 26089 | PUT | `/api/pr/media/:id` | member JWT + is_admin | Admin-only, updates media asset metadata in pr_media_assets |
| 26097 | DELETE | `/api/pr/media/:id` | member JWT + is_admin | Admin-only, deletes media file from disk and its pr_media_assets row |
| 26109 | GET | `/api/pr/campaigns` | member JWT + is_admin | Admin-only, lists pr_campaigns filtered by status and project |
| 26127 | GET | `/api/pr/campaigns/:id` | member JWT + is_admin | Admin-only, returns campaign with its calendar content, posts and newsletters |
| 26139 | POST | `/api/pr/campaigns` | member JWT + is_admin | Admin-only, creates campaign in pr_campaigns with budget, platforms and KPIs |
| 26149 | PUT | `/api/pr/campaigns/:id` | member JWT + is_admin | Admin-only, updates campaign fields including status, budget and spent |
| 26158 | DELETE | `/api/pr/campaigns/:id` | member JWT + is_admin | Admin-only, deletes a pr_campaigns record by id |
| 26165 | GET | `/api/pr/analytics` | member JWT + is_admin | Admin-only, lists pr_analytics filtered by project, platform and date range |
| 26191 | POST | `/api/pr/analytics` | member JWT + is_admin | Admin-only, upserts daily platform analytics snapshot in pr_analytics |
| 26212 | GET | `/api/pr/templates` | member JWT + is_admin | Admin lists active PR templates filtered by type, platform, project |
| 26234 | POST | `/api/pr/templates` | member JWT + is_admin | Admin creates a PR template row in pr_templates |
| 26244 | PUT | `/api/pr/templates/:id` | member JWT + is_admin | Admin updates PR template fields and active flag |
| 26253 | POST | `/api/pr/templates/:id/use` | member JWT + is_admin | Admin increments a PR template use_count |
| 26259 | DELETE | `/api/pr/templates/:id` | member JWT + is_admin | Admin deletes a PR template |
| 26266 | GET | `/api/pr/ai-generations` | member JWT + is_admin | Admin lists AI generation history filtered by type and project |
| 26284 | POST | `/api/pr/ai-generations` | member JWT + is_admin | Admin records an AI generation result in pr_ai_generations |
| 26294 | POST | `/api/pr/ai-generations/:id/use` | member JWT + is_admin | Admin marks an AI generation as used |
| 26300 | POST | `/api/pr/ai-generations/:id/rate` | member JWT + is_admin | Admin sets a rating on an AI generation |

#### Notifications (11 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 14076 | GET | `/api/notify-topics` | member JWT | Returns project keys caller subscribed to in notify_topics |
| 14081 | POST | `/api/notify-topics` | member JWT | Toggles caller's notify_topics subscription for a project, never sends push |
| 22941 | GET | `/api/notifications` | member JWT | Returns caller's latest 50 admin_notifications rows |
| 22950 | PUT | `/api/notifications/:id/read` | member JWT | Marks one of caller's admin_notifications as read |
| 23054 | GET | `/api/user-notifications` | member JWT | Returns caller's targeted and broadcast user_notifications, unexpired, with category/placement filters |
| 23078 | PUT | `/api/user-notifications/:id/read` | member JWT | Marks one user notification read, scoped to caller or broadcast rows |
| 23085 | PUT | `/api/user-notifications/mark-all-read` | member JWT | Marks all of caller's visible user_notifications as read |
| 23211 | GET | `/api/announcements` | member JWT | Returns newest 30 member announcements, audience-gated, flagged by followed projects, nudges push fan-out |
| 28047 | GET | `/api/user/admin-messages` | member JWT | Returns admin messages sent to the logged-in user |
| 28057 | PUT | `/api/user/admin-messages/:id/read` | member JWT | Marks an admin message as read |
| 28068 | POST | `/api/user/admin-messages/:id/reply` | member JWT | Inserts member's reply to an admin message into direct_messages |

#### Accelerator (72 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 14519 | GET | `/api/accelerator/program` | public | Public: returns active accelerator program with document types |
| 14526 | GET | `/api/accelerator/institutions` | public | Public: returns active accelerator partner institutions |
| 14531 | GET | `/api/accelerator/applications/my` | member JWT | Returns caller's application for active accelerator program with documents, or null |
| 14548 | GET | `/api/accelerator/sites` | public | Public: returns active accelerator host sites, optional ?year= filter |
| 14563 | POST | `/api/accelerator/ask-coordinator` | member JWT | Routes member question to admin inbox via direct_messages row, no email |
| 14583 | POST | `/api/accelerator/applications` | member JWT | Creates or updates caller's accelerator application draft |
| 14625 | POST | `/api/accelerator/applications/:id/documents/:docType` | member JWT; multipart upload | Uploads one document of a given type to caller's own application |
| 14672 | POST | `/api/accelerator/applications/:id/documents` | member JWT; multipart upload | Uploads a document to any application (admin allowed), file via multer |
| 14716 | GET | `/api/accelerator/documents/:docId` | member JWT | Downloads an accelerator document if caller owns application or is admin |
| 14738 | DELETE | `/api/accelerator/documents/:docId` | member JWT | Deletes caller's own accelerator document |
| 14766 | POST | `/api/accelerator/applications/:id/submit` | member JWT | Submits draft application, sends confirmation email, notifies program director |
| 14821 | GET | `/api/accelerator/applications/:id/package` | member JWT | Generates combined PDF application package with pdfkit |
| 14958 | GET | `/api/accelerator/years` | member JWT | Returns distinct accelerator program years |
| 14964 | GET | `/api/accelerator/years/:year` | member JWT | Returns accelerator program details for a year |
| 14971 | POST | `/api/accelerator/years` | member JWT + is_admin | Admin-only: creates a new accelerator program year |
| 14982 | PUT | `/api/accelerator/years/:year` | member JWT + is_admin | Admin-only: updates accelerator program fields for a year |
| 14996 | GET | `/api/accelerator/years/:year/dates` | member JWT | Returns accelerator key dates for a year |
| 15002 | POST | `/api/accelerator/years/:year/dates` | member JWT + is_admin | Admin-only: adds an accelerator key date for a year |
| 15024 | PUT | `/api/accelerator/dates/:id` | member JWT + is_admin | Admin-only: updates an accelerator key date |
| 15048 | DELETE | `/api/accelerator/dates/:id` | member JWT + is_admin | Admin-only: deletes an accelerator key date |
| 15057 | POST | `/api/accelerator/checkout-session` | member JWT | Creates Stripe Checkout session for 75 EUR accelerator processing fee |
| 15111 | GET | `/api/accelerator/years/:year/institutions` | member JWT | Returns active institutions with year-specific details for a year |
| 15124 | PUT | `/api/accelerator/years/:year/institutions/:instId` | member JWT + is_admin | Admin-only: upserts institution details for a year |
| 15152 | POST | `/api/accelerator/institutions` | member JWT + is_admin | Admin-only: adds a new accelerator institution |
| 15166 | GET | `/api/accelerator/years/:year/applications` | member JWT + is_admin | Admin-only: lists a year's applications with status/institution/search filters and doc counts |
| 15186 | GET | `/api/accelerator/applications/:id/full` | member JWT + is_admin | Admin-only: returns one application with documents and evaluations |
| 15204 | POST | `/api/accelerator/apply` | public (unauthenticated POST) | Public: creates draft application with generated application number and candidate ID |
| 15251 | POST | `/api/accelerator/applications/:id/message` | member JWT + is_admin | Admin-only: records message to candidate in accelerator_messages, emails unless send_email false |
| 15288 | PUT | `/api/accelerator/applications/:id/validity` | member JWT + is_admin | Admin-only: sets application validity status, optionally records message and sends email |
| 15343 | GET | `/api/accelerator/years/:year/criteria` | member JWT | Returns active evaluation criteria for a year |
| 15349 | POST | `/api/accelerator/years/:year/criteria` | member JWT + is_admin | Admin-only: adds an evaluation criterion for a year |
| 15361 | PUT | `/api/accelerator/criteria/:id` | member JWT + is_admin | Admin-only: updates an evaluation criterion |
| 15372 | DELETE | `/api/accelerator/criteria/:id` | member JWT + is_admin | Admin-only: soft-deletes an evaluation criterion (is_active = 0) |
| 15381 | POST | `/api/accelerator/applications/:appId/evaluate` | member JWT + is_admin | Admin-only: upserts one evaluation score for an application criterion |
| 15402 | POST | `/api/accelerator/applications/:appId/evaluate-batch` | member JWT + is_admin | Admin-only: upserts multiple evaluation scores for an application at once |
| 15454 | GET | `/api/accelerator/years/:year/interviewers` | member JWT + is_admin | Admin-only: lists active interviewers for a year |
| 15460 | POST | `/api/accelerator/years/:year/interviewers` | member JWT + is_admin | Admin-only: adds an interviewer with generated access token |
| 15472 | PUT | `/api/accelerator/interviewers/:id` | member JWT + is_admin | Admin-only: updates an interviewer |
| 15482 | DELETE | `/api/accelerator/interviewers/:id` | member JWT + is_admin | Admin-only: soft-deletes an interviewer (is_active = 0) |
| 15489 | POST | `/api/accelerator/interview-score` | signed-token (interviewer access_token in body) | Public: interviewer with token upserts interview score, recalculates application scores |
| 15515 | GET | `/api/accelerator/interview-access/:token` | signed-token (interviewer token) | Public: validates interviewer magic-link token, returns interviewer session and applications |
| 15576 | GET | `/api/accelerator/interview-access/:token/application/:appId` | signed-token (interviewer token) | Public: returns full application details to interviewer via magic-link token |
| 15635 | POST | `/api/accelerator/interview-access/:token/score` | signed-token (interviewer token) | Public: interviewer upserts a criterion score via magic-link token, recalculates scores |
| 15688 | POST | `/api/accelerator/interviewers/:id/send-link` | member JWT + is_admin | Admin-only: sends magic-link email to interviewer, generating token if missing |
| 15748 | POST | `/api/accelerator/interviewers/:id/regenerate-token` | member JWT + is_admin | Admin-only: regenerates an interviewer's access token |
| 15758 | GET | `/api/accelerator/registrations` | member JWT + is_admin | Admin-only: lists applicant registrations with application counts |
| 15778 | GET | `/api/accelerator/registrations/:id` | member JWT + is_admin | Admin-only: returns one applicant's details minus sensitive fields |
| 15890 | GET | `/api/accelerator/years/:year/pdf-settings` | member JWT + is_admin | Admin-only: returns PDF settings for a year, defaults if unset |
| 15915 | PUT | `/api/accelerator/years/:year/pdf-settings` | member JWT + is_admin | Admin-only: updates PDF settings (articles, header, signatory) for a year |
| 15955 | GET | `/api/accelerator/years/:year/ranking` | member JWT + is_admin | Admin-only: returns ranking list for a year, optional institution filter |
| 15978 | POST | `/api/accelerator/years/:year/update-rankings` | member JWT + is_admin | Admin-only: recomputes rank positions per institution for a year |
| 16000 | POST | `/api/accelerator/years/:year/publish-rankings` | member JWT + is_admin | Admin-only: publishes rankings, writes user_notifications and accelerator_messages, no email |
| 16037 | GET | `/api/accelerator/files/grouped` | member JWT + is_admin | Admin: returns accelerator applications for a year with their uploaded documents grouped by applicant |
| 16075 | GET | `/api/accelerator/years/:year/ranking-pdf` | member JWT + is_admin | Admin: generates and streams accelerator ranking PDF with dynamic evaluation-criteria columns |
| 16252 | GET | `/api/accelerator/applications/:id/merge-docs` | member JWT + is_admin | Admin: generates and streams application cover-page PDF with applicant summary |
| 16341 | GET | `/api/accelerator/documents/:docId/download` | member JWT | Streams an accelerator document file download, owner or admin only |
| 16359 | GET | `/api/accelerator/applications/:id/documents` | member JWT | Lists document metadata for an accelerator application, owner or admin only |
| 16374 | GET | `/api/accelerator/my-applications` | member JWT | Returns current user's accelerator applications across all years with institution name |
| 16390 | GET | `/api/accelerator/results` | public (result code lookup) | Public: validates result code and returns accelerator ranking results for that year |
| 16658 | GET | `/api/accelerator/form-config` | member JWT | Returns accelerator form-config fields ordered by section and sort order |
| 16664 | PUT | `/api/accelerator/form-config` | member JWT + is_admin | Admin: bulk updates or inserts accelerator form-config fields from array |
| 16683 | POST | `/api/accelerator/form-config/field` | member JWT + is_admin | Admin: adds a new accelerator form-config field |
| 16695 | DELETE | `/api/accelerator/form-config/field/:id` | member JWT + is_admin | Admin: deletes an accelerator form-config field by id |
| 16757 | GET | `/api/accelerator/intake` | public | Public: returns current accelerator intake window dates and computed open/closed state |
| 16770 | GET | `/api/accelerator/intake/mine` | member JWT | Returns caller's submission_pipeline rows for the current accelerator intake cycle |
| 16802 | POST | `/api/accelerator/intake/draft` | member JWT | Saves or updates an accelerator intake draft in submission_pipeline while window is open |
| 16827 | POST | `/api/accelerator/intake/:id/submit` | member JWT | Submits intake draft, validates required fields, enqueues one confirmation email via scheduled_emails |
| 16890 | POST | `/api/accelerator/intake/:id/withdraw` | member JWT | Withdraws caller's submitted or under-review accelerator intake application |
| 16906 | PUT | `/api/accelerator/intake/window` | member JWT + is_admin | Admin: upserts intake_windows open/close datetimes for a track and cycle |
| 23252 | GET | `/api/accelerator/key-dates` | public | Public: returns accelerator key dates for requested or current year |
| 23270 | GET | `/api/accelerator/countdown` | public | Public: returns next upcoming accelerator deadline as countdown target, null if none |
| 23314 | GET | `/api/accelerator/overview-config` | public | Public: returns active accelerator program overview config (deadline, duration, labs, positions) |

#### Forum admin (user-portal admin routes) (51 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 17634 | POST | `/api/admin/forum/gallery/folders` | member JWT + is_admin | Admin: creates a forum gallery folder |
| 17647 | POST | `/api/admin/forum/media` | member JWT + is_admin; multipart upload | Admin: uploads image or video file into forum_media with caption and folder |
| 17760 | GET | `/api/admin/forum/stats` | member JWT + is_admin | Admin: returns forum stats counts for members, applications, posts, events, groups, prospects |
| 17777 | GET | `/api/admin/forum/applications` | member JWT + is_admin | Admin: lists pending forum membership applications with user details |
| 17789 | PUT | `/api/admin/forum/applications/:id` | member JWT + is_admin | Admin: approves or rejects a forum membership application, updates forum_members status |
| 17804 | DELETE | `/api/admin/forum/members/:id` | member JWT + is_admin | Admin: deletes a forum_members row by id |
| 17812 | GET | `/api/admin/forum/members` | member JWT + is_admin | Admin: lists all forum members with user details |
| 17823 | POST | `/api/admin/forum/groups` | member JWT + is_admin | Admin: creates a forum group with generated slug |
| 17838 | GET | `/api/admin/forum/events` | member JWT + is_admin | Admin: lists all forum events with organizer and registration counts, unpublished included |
| 17849 | POST | `/api/admin/forum/events` | member JWT + is_admin | Admin: creates a forum event, inserts forum_events |
| 17870 | PUT | `/api/admin/forum/events/:id` | member JWT + is_admin | Admin: updates a forum event's fields in forum_events |
| 17912 | DELETE | `/api/admin/forum/events/:id` | member JWT + is_admin | Admin: deletes a forum event and its registrations |
| 17923 | PUT | `/api/admin/forum/events/:id/publish` | member JWT + is_admin | Admin: toggles forum event publish status and writes user_notifications for members |
| 17947 | GET | `/api/admin/forum/events/:id/registrations` | member JWT + is_admin | Admin: lists a forum event's registrations with user and member details, skips af26 |
| 17963 | POST | `/api/admin/forum/events/:id/checkin` | member JWT + is_admin | Admin: checks in a forum event registrant by registration_id or QR code, skips af26 |
| 17986 | POST | `/api/admin/forum/resources` | member JWT + is_admin | Admin: creates a forum resource entry in forum_resources |
| 18000 | GET | `/api/admin/forum/posts` | member JWT + is_admin | Admin: lists all forum posts with author details |
| 18011 | PUT | `/api/admin/forum/posts/:id` | member JWT + is_admin | Admin: moderates a forum post, sets moderation_status, pinned, featured flags |
| 18032 | GET | `/api/admin/forum/prospects` | member JWT + is_admin | Admin: lists all forum prospects |
| 18038 | POST | `/api/admin/forum/prospects` | member JWT + is_admin | Admin: creates a forum prospect row |
| 18054 | PUT | `/api/admin/forum/prospects/:id` | member JWT + is_admin | Admin: updates a forum prospect row |
| 18065 | DELETE | `/api/admin/forum/prospects/:id` | member JWT + is_admin | Admin: deletes a forum prospect by id |
| 18074 | GET | `/api/admin/forum/invitations` | member JWT + is_admin | Admin: lists all forum invitations |
| 18080 | POST | `/api/admin/forum/invitations/send` | member JWT + is_admin | Admin: creates coded invitation for a prospect, marks prospect invited, no email sent |
| 18100 | POST | `/api/admin/forum/invitations/send-bulk` | member JWT + is_admin | Admin: bulk creates coded invitations for prospect_ids, marks prospects invited, no email sent |
| 18124 | POST | `/api/admin/forum/invitations/:id/resend` | member JWT + is_admin | Admin: marks a forum invitation as resent by updating sent_at, no email sent |
| 18131 | POST | `/api/admin/forum/prospects/preview` | member JWT + is_admin; multipart upload | Admin: parses uploaded Excel/CSV of prospects and returns preview rows for mapping |
| 18152 | POST | `/api/admin/forum/prospects/import` | member JWT + is_admin | Admin: imports mapped prospect rows into forum_prospects with an import batch record |
| 18203 | GET | `/api/admin/forum/templates` | member JWT + is_admin | Admin: lists forum email templates |
| 18208 | POST | `/api/admin/forum/templates` | member JWT + is_admin | Admin: creates a forum email template, optionally setting it as default |
| 18226 | PUT | `/api/admin/forum/templates/:id` | member JWT + is_admin | Admin: updates a forum email template, optionally setting it as default |
| 18241 | DELETE | `/api/admin/forum/templates/:id` | member JWT + is_admin | Admin: deletes a forum email template by id |
| 18248 | POST | `/api/admin/forum/notify-all` | member JWT + is_admin | Admin: notify-all only logs recipient count to console, no email actually sent |
| 18262 | POST | `/api/admin/forum/bulk-email` | member JWT + is_admin | Admin: bulk-email selected members only logs to console, no email actually sent |
| 18279 | GET | `/api/admin/forum/events/af26/stats` | member JWT + is_admin | Admin: returns Annual Forum 2026 stats, creating the AF26 event row if missing |
| 18302 | GET | `/api/admin/forum/events/af26/registrations` | member JWT + is_admin | Admin: lists Annual Forum 2026 registrations with user and institution details |
| 18318 | PUT | `/api/admin/forum/events/af26/registrations/:id` | member JWT + is_admin | Admin updates AF26 registration RSVP status, dietary, accommodation and notes |
| 18328 | GET | `/api/admin/forum/events/af26/speakers` | member JWT + is_admin | Admin lists AF26 speakers ordered by sort_order from forum_event_speakers |
| 18337 | POST | `/api/admin/forum/events/af26/speakers` | member JWT + is_admin | Admin adds AF26 speaker, creating the forum event row if missing |
| 18358 | PUT | `/api/admin/forum/events/af26/speakers/:id` | member JWT + is_admin | Admin partially updates AF26 speaker fields in forum_event_speakers |
| 18382 | DELETE | `/api/admin/forum/events/af26/speakers/:id` | member JWT + is_admin | Admin deletes an AF26 speaker row by id |
| 18389 | GET | `/api/admin/forum/events/af26/schedule` | member JWT + is_admin | Admin lists AF26 schedule sessions ordered by date and start time |
| 18398 | POST | `/api/admin/forum/events/af26/schedule` | member JWT + is_admin | Admin adds AF26 schedule session, creating the forum event if missing |
| 18419 | PUT | `/api/admin/forum/events/af26/schedule/:id` | member JWT + is_admin | Admin partially updates an AF26 schedule session |
| 18442 | DELETE | `/api/admin/forum/events/af26/schedule/:id` | member JWT + is_admin | Admin deletes an AF26 schedule session by id |
| 18449 | PUT | `/api/admin/forum/events/af26/settings` | member JWT + is_admin | Admin upserts AF26 event settings (title, dates, venue, capacity, RSVP deadline) |
| 18475 | GET | `/api/admin/forum/events/af26/invitations` | member JWT + is_admin | Admin lists AF26 invitations joined with prospect names, newest first |
| 18488 | POST | `/api/admin/forum/events/af26/invitations/send` | member JWT + is_admin | Admin records AF26 invitation with code for one email, logs only, no email sent |
| 18508 | POST | `/api/admin/forum/events/af26/invitations/send-all` | member JWT + is_admin | Admin bulk-records AF26 invitation rows for uninvited approved forum members, no email sent |
| 18539 | POST | `/api/admin/forum/events/af26/checkin` | member JWT + is_admin | Admin checks in AF26 attendee by registration id, name, email or QR code |
| 18585 | GET | `/api/admin/forum/events/af26/checkins` | member JWT + is_admin | Admin lists recent AF26 check-ins with attendee names |

#### Staff dashboard (28 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 18661 | GET | `/api/team` | member JWT + is_admin | Admin lists all team_members ordered by name |
| 18666 | GET | `/api/team/me` | member JWT + is_admin | Admin returns current user's team_members record |
| 18672 | POST | `/api/team` | member JWT + is_admin | Admin creates team_members record for current user if none exists |
| 18934 | GET | `/api/pinned` | member JWT + is_admin | Admin lists current user's pinned_items ordered by display_order |
| 18941 | POST | `/api/pinned` | member JWT + is_admin | Admin pins an item for current user, skipping duplicates |
| 18960 | DELETE | `/api/pinned/:id` | member JWT + is_admin | Admin unpins an item owned by current user |
| 18967 | PUT | `/api/pinned/reorder` | member JWT + is_admin | Admin reorders current user's pinned items by given id order |
| 19040 | GET | `/api/dashboard/summary` | member JWT + is_admin | Admin dashboard counts for Plexus registrations, speakers, accelerator and more |
| 19075 | GET | `/api/tasks/:project` | member JWT + is_admin | Admin lists project parent tasks with attached files and subtasks |
| 19091 | GET | `/api/tasks` | member JWT + is_admin | Admin returns task summary counts by status and by project |
| 19108 | POST | `/api/tasks` | member JWT + is_admin | Admin creates project_tasks row (optional parent for subtask) |
| 19119 | PUT | `/api/tasks/:id` | member JWT + is_admin | Admin updates task title, description, assignee, priority, status, due date, project |
| 19137 | POST | `/api/tasks/:id/files` | member JWT; multipart upload | Authenticated upload of file to a task, moved to tasks folder, writes task_files |
| 19160 | DELETE | `/api/tasks/files/:fileId` | member JWT + is_admin | Admin deletes task file record and its physical file |
| 19175 | POST | `/api/tasks/:id/toggle` | member JWT + is_admin | Admin cycles task status todo to in_progress to done to todo |
| 19187 | DELETE | `/api/tasks/:id` | member JWT + is_admin | Admin deletes a project task by id |
| 19196 | GET | `/api/sequences` | member JWT + is_admin | Admin lists task_sequences, optionally filtered by project |
| 19214 | GET | `/api/sequences/:id` | member JWT + is_admin | Admin returns one task sequence with its steps and assignees |
| 19223 | POST | `/api/sequences` | member JWT + is_admin | Admin creates task sequence and inserts its steps |
| 19243 | POST | `/api/sequences/:seqId/steps/:stepId/complete` | member JWT + is_admin | Admin completes active sequence step and activates the next one |
| 19273 | DELETE | `/api/sequences/:id` | member JWT + is_admin | Admin deletes a task sequence and its steps |
| 19283 | GET | `/api/timeline/:project` | member JWT + is_admin | Admin lists project_timeline_events for a project by date |
| 19292 | GET | `/api/timeline` | member JWT + is_admin | Admin lists all project_timeline_events for home timeline |
| 19298 | POST | `/api/timeline/:project` | member JWT + is_admin | Admin creates timeline event for a project (name and date required) |
| 19313 | PUT | `/api/timeline/:project/:id` | member JWT + is_admin | Admin updates timeline event fields, keeping existing values as fallback |
| 19326 | PATCH | `/api/timeline/:project/:id/toggle-complete` | member JWT + is_admin | Admin toggles timeline event completed flag |
| 19337 | DELETE | `/api/timeline/:project/:id` | member JWT + is_admin | Admin deletes a timeline event by id |
| 19461 | GET | `/api/search` | member JWT + is_admin | Admin LIKE-searches tasks, files and folders by query string |

#### Files (7 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 19361 | GET | `/api/folders/:project` | member JWT + is_admin | Admin lists project_folders for a project under optional parent folder |
| 19372 | POST | `/api/folders/:project` | member JWT + is_admin | Admin creates project folder with optional parent and color |
| 19385 | DELETE | `/api/folders/:id` | member JWT + is_admin | Admin deletes folder, moving its files and subfolders to parent |
| 19400 | GET | `/api/files/:project` | member JWT + is_admin | Admin lists project_files in a folder with uploader names |
| 19420 | POST | `/api/files/:project` | member JWT + is_admin; multipart upload | Admin uploads file to project folder and writes project_files row |
| 19447 | DELETE | `/api/files/:id` | member JWT + is_admin | Admin deletes project file record and its physical file |
| 19675 | POST | `/api/upload/:type` | member JWT | Authenticated file upload by type to cloud/local storage, returns file URL |

#### Accelerator admin (5 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 19479 | GET | `/api/admin/accelerator/applications` | member JWT + is_admin | Admin lists accelerator_applications with doc counts, filterable by status/program |
| 19496 | GET | `/api/admin/accelerator/applications/:id` | member JWT + is_admin | Admin returns one accelerator application with documents, recommendations, institutions |
| 19515 | PUT | `/api/admin/accelerator/applications/:id/review` | member JWT + is_admin | Admin records accelerator application decision, notes and assigned institution |
| 19530 | GET | `/api/admin/accelerator/analytics` | member JWT + is_admin | Admin returns accelerator application counts by status for active program |
| 19548 | GET | `/api/admin/accelerator/export` | member JWT + is_admin | Admin downloads CSV export of non-draft accelerator applications |

#### Plexus (member) (59 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 19704 | GET | `/api/plexus/conference` | public | Public active conference info with ticket types and current pricing tier |
| 19733 | POST | `/api/plexus/promo/validate` | public | Public promo code validation against promo_codes (expiry, max uses) |
| 19751 | POST | `/api/plexus/register` | optional member JWT | Single-step Plexus registration: finds/creates user, writes registration, invoice, FIRA, sends welcome email |
| 20057 | GET | `/api/plexus/registration/:id/invoice` | optional member JWT | Returns registration invoice details, FIRA info, bank transfer details and transaction |
| 20114 | POST | `/api/plexus/registration/:id/confirm-payment` | member JWT | Admin-only confirms bank transfer: marks registration, transaction, invoice paid, writes finance record |
| 20157 | GET | `/api/plexus/stripe-config` | public | Public Stripe publishable key and enabled flag |
| 20165 | POST | `/api/plexus/checkout-session` | optional member JWT | Creates Stripe Checkout session for a registration, stores session id on transaction |
| 21243 | GET | `/api/plexus/conference-payments` | member JWT | Admin-only lists all conference registration payments, filterable by status and search |
| 21318 | POST | `/api/plexus/register/start` | public (creates account / checks password) | Step 1 registration: finds or creates user, returns 24h JWT token |
| 21360 | POST | `/api/plexus/register/complete` | member JWT | Step 2 registration: applies promo, writes registration and details, increments sold count |
| 21438 | GET | `/api/plexus/cme/status` | public | Public flag whether active conference is chamber-accredited for CME |
| 21457 | POST | `/api/plexus/cme/attach` | member JWT | Member attaches CME record (DOB, OIB, consent) to own registration, upsert |
| 21488 | GET | `/api/plexus/cme/my` | member JWT | Member views own decrypted CME submissions with conference points |
| 21510 | GET | `/api/plexus/my-registration` | member JWT | Returns current user's registration for the active Plexus conference |
| 21525 | POST | `/api/plexus/waitlist` | member JWT | Member joins ticket waitlist with next position for active conference |
| 21543 | POST | `/api/plexus/registration/:regId/transfer` | member JWT | Member requests ticket transfer to colleague, writes registration_transfers and audit |
| 21579 | POST | `/api/plexus/registration/:regId/refund` | member JWT | Member submits refund request for own registration into refund_requests |
| 21594 | POST | `/api/plexus/scholarship` | member JWT | Member submits scholarship application for active conference |
| 21609 | POST | `/api/plexus/abstracts` | member JWT | Member submits abstract with authors, emails pr@medx.hr notification |
| 21655 | GET | `/api/plexus/my-abstracts` | member JWT | Returns caller's abstracts for active conference with their author lists |
| 21667 | PUT | `/api/plexus/abstracts/:id` | member JWT | Updates caller's own abstract fields in abstracts table, rejected after abstract deadline |
| 21683 | POST | `/api/plexus/abstracts/:id/withdraw` | member JWT | Marks caller's own abstract as withdrawn (is_withdrawn=1) and returns success |
| 21690 | POST | `/api/plexus/abstracts/:id/files` | member JWT | Links uploaded file record to caller's own abstract, writes abstract_files table |
| 21718 | GET | `/api/plexus/schedule` | public | Public: returns active conference's published sessions with speaker names, tracks and rooms |
| 21822 | GET | `/api/plexus/sessions/:id` | public | Public: returns session details by id with resolved speaker records |
| 21845 | POST | `/api/plexus/my-schedule/:sessionId` | member JWT | Adds a session to caller's personal schedule (personal_schedules), idempotent |
| 21855 | DELETE | `/api/plexus/my-schedule/:sessionId` | member JWT | Removes a session from caller's personal schedule |
| 21862 | GET | `/api/plexus/my-schedule` | member JWT | Returns sessions in caller's personal schedule ordered by day and start time |
| 21870 | POST | `/api/plexus/sessions/:id/questions` | member JWT | Inserts caller's question for a session into session_questions, returns question_id |
| 21880 | POST | `/api/plexus/questions/:id/upvote` | member JWT | Toggles caller's upvote on a question in question_upvotes table |
| 21896 | GET | `/api/plexus/qa` | member JWT | Lists visible floor questions for active conference with upvote counts and caller's vote |
| 21919 | POST | `/api/plexus/qa` | member JWT | Submits caller's conference-wide floor question (5-500 chars) into session_questions |
| 21992 | POST | `/api/plexus/polls/:id/respond` | member JWT | Saves or updates caller's response to an active session poll in poll_responses |
| 22010 | POST | `/api/plexus/sessions/:id/rate` | member JWT | Creates or updates caller's rating and comment for a session (session_ratings) |
| 22028 | GET | `/api/plexus/attendees` | member JWT | Returns searchable attendee directory of registered users with profile fields and filters |
| 22057 | GET | `/api/plexus/attendees/:id` | member JWT | Returns one attendee's public profile plus connection status with caller |
| 22072 | POST | `/api/plexus/connections` | member JWT | Creates a pending connection request from caller to another user (connections table) |
| 22087 | PUT | `/api/plexus/connections/:id` | member JWT | Accepts or rejects a connection request addressed to the caller |
| 22095 | GET | `/api/plexus/my-connections` | member JWT | Returns caller's accepted connections with counterpart name and institution |
| 22105 | POST | `/api/plexus/meetings` | member JWT | Creates a meeting request with proposed times in meeting_requests table |
| 22117 | GET | `/api/plexus/my-meetings` | member JWT | Returns caller's sent and received meeting requests with counterpart names |
| 22128 | POST | `/api/plexus/visa-request` | member JWT | Creates visa invitation letter request (passport details) for caller's latest registration |
| 22149 | GET | `/api/plexus/hotels` | public | Public: returns partner hotels for active conference ordered by sort_order |
| 22159 | POST | `/api/plexus/volunteers` | member JWT | Submits caller's volunteer application (availability, preferred tasks), one per conference |
| 22174 | GET | `/api/plexus/my-volunteer` | member JWT | Returns caller's volunteer record for active conference with assigned shifts |
| 22192 | POST | `/api/plexus/speaker-application` | member JWT | Inserts caller's speaker application (talk proposal, bio, AV needs) into speaker_applications |
| 22208 | GET | `/api/plexus/speakers` | public | Public: returns confirmed published speakers with safe columns only (no email or invite_code) |
| 22218 | GET | `/api/plexus/sponsors` | public | Public: returns published sponsors for active conference ordered by tier |
| 22225 | GET | `/api/plexus/announcements` | public | Public: returns latest 20 conference announcements for active conference |
| 22232 | GET | `/api/plexus/posters` | public | Public: returns accepted poster abstracts with poster file and author names |
| 22245 | GET | `/api/plexus/photos` | public | Public: returns public conference photos for active conference |
| 22252 | GET | `/api/plexus/resources` | public | Public: returns conference resources/downloads ordered by category and title |
| 22298 | GET | `/api/plexus/my-certificate` | member JWT | Returns caller's attendance certificate, creating certificates row if checked-in attendee lacks one |
| 22327 | GET | `/api/plexus/survey` | member JWT | Returns active conference survey and whether caller has already responded |
| 22338 | POST | `/api/plexus/survey/:id/respond` | member JWT | Stores caller's survey answers in survey_responses, rejects duplicate submission |
| 22352 | POST | `/api/plexus/checkin` | member JWT + is_admin | Admin-only: checks in attendee by QR data or registration id, sets checked_in |
| 28102 | GET | `/api/plexus/settings` | public | Public read of Plexus settings with parsed key dates and testimonials |
| 28113 | GET | `/api/plexus/stats` | public | Public live count of total and paid Plexus registrations |
| 28124 | GET | `/api/plexus/sessions` | public | Public list of published Plexus sessions with speaker names |

#### Stripe webhook (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 20240 | POST | `/api/stripe/webhook` | webhook (Stripe signature) | Stripe webhook (no auth): verifies signature, fulfills paid registrations idempotently, emails, refund alerts |

#### Plexus admin (user-portal admin routes) (50 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 21733 | GET | `/api/admin/plexus/sessions` | member JWT + is_admin | Admin-only: returns all sessions including unpublished for active conference with speaker names |
| 21744 | POST | `/api/admin/plexus/sessions` | member JWT + is_admin | Admin-only: creates a session row for active conference from request body |
| 21758 | PUT | `/api/admin/plexus/sessions/:id` | member JWT + is_admin | Admin-only: updates all editable fields of an existing session by id |
| 21778 | DELETE | `/api/admin/plexus/sessions/:id` | member JWT + is_admin | Admin-only: deletes a session and its personal_schedules entries |
| 21788 | PUT | `/api/admin/plexus/sessions/:id/publish` | member JWT + is_admin | Admin-only: publishes one session and inserts a broadcast user_notifications announcement |
| 21800 | POST | `/api/admin/plexus/sessions/bulk-publish` | member JWT + is_admin | Admin-only: publishes selected or all unpublished sessions, inserts one broadcast notification |
| 21933 | GET | `/api/admin/plexus/qa` | member JWT + is_admin | Admin-only: lists all floor questions including hidden, with author identity and email |
| 21957 | POST | `/api/admin/plexus/qa/:id/answer` | member JWT + is_admin | Admin-only: records an answer to a question, marks it answered for all members |
| 21970 | POST | `/api/admin/plexus/qa/:id/hide` | member JWT + is_admin | Admin-only: hides or unhides a question (moderation flag is_hidden) |
| 21979 | POST | `/api/admin/plexus/qa/ask` | member JWT + is_admin | Admin-only: posts an admin-authored question to the audience (is_from_admin=1) |
| 22381 | GET | `/api/admin/plexus/registrations` | member JWT + is_admin | Admin-only: lists all registrations for active conference with user and ticket details |
| 22392 | GET | `/api/admin/plexus/abstracts` | member JWT + is_admin | Admin-only: lists all abstracts for active conference with submitter and authors |
| 22407 | POST | `/api/admin/plexus/abstracts/:id/assign-reviewer` | member JWT + is_admin | Admin-only: assigns a reviewer to an abstract (inserts abstract_reviews row) |
| 22417 | PUT | `/api/admin/plexus/abstracts/:id/decision` | member JWT + is_admin | Admin-only: sets an abstract's status and decision fields |
| 22425 | GET | `/api/admin/plexus/stats` | member JWT + is_admin | Admin-only: returns dashboard counts (registrations, paid, checked-in, revenue) for active conference |
| 22448 | POST | `/api/admin/plexus/promo-codes` | member JWT + is_admin | Admin-only: creates a promo code (uppercased) for active conference |
| 22459 | GET | `/api/admin/plexus/promo-codes` | member JWT + is_admin | Admin-only: lists promo codes for active conference |
| 22468 | POST | `/api/admin/plexus/speakers` | member JWT + is_admin | Admin-only: creates a speaker row for active conference from request body |
| 22485 | POST | `/api/admin/plexus/volunteer-shifts` | member JWT + is_admin | Admin-only: creates a volunteer shift (volunteer_shifts) for active conference |
| 22497 | GET | `/api/admin/plexus/volunteers` | member JWT + is_admin | Admin-only: lists volunteers for active conference with user contact details |
| 22505 | PUT | `/api/admin/plexus/volunteers/:id` | member JWT + is_admin | Admin-only: sets a volunteer's status (approve/reject) by id |
| 22513 | POST | `/api/admin/plexus/sessions/:sessionId/polls` | member JWT + is_admin | Admin-only: launches a new live poll for a session, closing that session's active polls |
| 22527 | GET | `/api/admin/plexus/polls/:id/results` | member JWT + is_admin | Admin-only: tallies poll_responses per option and returns poll results |
| 22545 | PUT | `/api/admin/plexus/refunds/:id` | member JWT + is_admin | Admin-only: processes a refund request (status, amount approved, notes, processed_by) |
| 22554 | PUT | `/api/admin/plexus/visa-requests/:id` | member JWT + is_admin | Admin-only: processes a visa request, setting status, letter file and processor |
| 22563 | GET | `/api/admin/plexus/pending` | member JWT + is_admin | Admin-only: returns pending refund requests, visa requests and other open items |
| 22586 | GET | `/api/admin/plexus/speakers` | member JWT + is_admin | Admin-only: lists speakers for active conference, optional ?year= filter |
| 22601 | GET | `/api/admin/plexus/speakers/years` | member JWT + is_admin | Admin-only: returns distinct speaker years for active conference |
| 22608 | PUT | `/api/admin/plexus/speakers/:id` | member JWT + is_admin | Admin-only: updates speaker profile, talk, confirmation, flight and hotel logistics fields |
| 22656 | DELETE | `/api/admin/plexus/speakers/:id` | member JWT + is_admin | Admin-only: deletes a speaker row by id |
| 22663 | PUT | `/api/admin/plexus/speakers/:id/publish` | member JWT + is_admin | Admin-only: publishes or unpublishes a speaker (is_published flag) |
| 22672 | POST | `/api/admin/plexus/speakers/:id/notify` | member JWT + is_admin | Admin-only stub: looks up speaker and returns success, sends no notification |
| 22679 | POST | `/api/admin/plexus/speakers/import` | member JWT + is_admin; multipart upload | Admin-only: imports speakers from uploaded CSV file into speakers table |
| 22726 | POST | `/api/admin/plexus/speakers/invite` | member JWT + is_admin | Admin-only: sends personalized invitation emails to selected speakers, marks invitation_status sent |
| 22775 | POST | `/api/admin/plexus/speakers/:id/reinvite` | member JWT + is_admin | Admin-only: copies a past speaker into a new unpublished row for given year |
| 22793 | GET | `/api/admin/plexus/sponsors` | member JWT + is_admin | Admin-only: lists all sponsors for active conference ordered by tier, name |
| 22800 | POST | `/api/admin/plexus/sponsors` | member JWT + is_admin | Admin-only: creates a sponsor row (tier, status, amounts, contact) for active conference |
| 22812 | PUT | `/api/admin/plexus/sponsors/:id` | member JWT + is_admin | Admin-only: updates all sponsor fields by id |
| 22821 | DELETE | `/api/admin/plexus/sponsors/:id` | member JWT + is_admin | Admin-only: deletes a sponsor and its sponsor_tasks |
| 22829 | PUT | `/api/admin/plexus/sponsors/:id/publish` | member JWT + is_admin | Admin-only: publishes or unpublishes a sponsor (is_published flag) |
| 22837 | GET | `/api/admin/plexus/sponsors/:id/tasks` | member JWT + is_admin | Admin-only: lists tasks for a sponsor ordered by completion and due date |
| 22843 | POST | `/api/admin/plexus/sponsors/:id/tasks` | member JWT + is_admin | Admin-only: adds a task (title, due date, assignee) to a sponsor |
| 22853 | PUT | `/api/admin/plexus/sponsor-tasks/:taskId` | member JWT + is_admin | Admin-only: updates a sponsor task's fields or just its completion flag |
| 22867 | DELETE | `/api/admin/plexus/sponsor-tasks/:taskId` | member JWT + is_admin | Admin-only: deletes a sponsor task by id |
| 22874 | GET | `/api/admin/plexus/volunteers/export` | member JWT + is_admin | Admin-only: exports active conference volunteers with contact details as CSV download |
| 22912 | GET | `/api/admin/plexus/recent-checkins` | member JWT + is_admin | Admin-only: returns 20 most recent check-ins (name, email, time) for active conference |
| 22925 | POST | `/api/admin/plexus/volunteers/:id/approve` | member JWT + is_admin | Admin-only: sets a volunteer's status to approved |
| 22932 | POST | `/api/admin/plexus/volunteers/:id/reject` | member JWT + is_admin | Admin-only: sets a volunteer's status to rejected |
| 27178 | GET | `/api/admin/plexus-experience/registrations` | member JWT + is_admin | Admin lists Plexus Experience registrations (source=plexus) |
| 27199 | GET | `/api/admin/plexus-experience/emails-by-event/:event` | member JWT + is_admin | Admin exports Plexus Experience registrant emails per event |

#### Certificates (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 22262 | GET | `/verify-certificate` | public | Public: returns HTML page verifying a certificate number, shows recipient, event, issue date |

#### Web push (3 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 23013 | GET | `/api/push/vapid-key` | public | Public: returns VAPID public key for web push from environment |
| 23018 | POST | `/api/push/subscribe` | member JWT | Stores caller's web push subscription (endpoint, keys) in push_subscriptions |
| 23036 | DELETE | `/api/push/unsubscribe` | member JWT | Deletes caller's push subscription by endpoint, or all if none given |

#### Accelerator applicant portal (14 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 23333 | POST | `/api/applicant/register` | public (applicant signup) | Registers accelerator applicant, writes accelerator_applicants, sends verification email |
| 23388 | GET | `/api/applicant/verify/:token` | signed-token (applicant verify token) | Verifies applicant email by token, sets email_verified in accelerator_applicants |
| 23401 | POST | `/api/applicant/login` | public (applicant credentials) | Applicant login, checks password and email_verified, returns JWT token |
| 23467 | GET | `/api/applicant/profile` | applicant JWT (type=applicant) | Returns authenticated applicant profile from accelerator_applicants without password hash |
| 23482 | PUT | `/api/applicant/profile` | applicant JWT (type=applicant) | Updates applicant personal and study fields in accelerator_applicants |
| 23499 | GET | `/api/applicant/applications` | applicant JWT (type=applicant) | Lists applicant's own applications joined with program year and institution name |
| 23517 | POST | `/api/applicant/applications` | applicant JWT (type=applicant) | Starts new application for program year, inserts accelerator_applications unless one exists |
| 23562 | PUT | `/api/applicant/applications/:id` | applicant JWT (type=applicant) | Updates applicant's own unsubmitted application fields in accelerator_applications |
| 23599 | POST | `/api/applicant/applications/:id/submit` | applicant JWT (type=applicant) | Submits application with GDPR consent, sets status submitted, sends confirmation email |
| 23641 | POST | `/api/applicant/applications/:id/documents` | applicant JWT (type=applicant); multipart upload | Uploads application document to cloud storage, writes accelerator_documents row |
| 23669 | DELETE | `/api/applicant/documents/:docId` | applicant JWT (type=applicant) | Deletes applicant's own document file and accelerator_documents row |
| 23692 | GET | `/api/applicant/programs` | public | Public list of active accelerator programs and institutions with available spots |
| 23702 | GET | `/evaluate` | public (HTML shell) | Returns public Croatian HTML page for magic-link candidate evaluation |
| 24059 | GET | `/apply` | public (HTML shell) | Returns public HTML page for the Accelerator applicant portal |

#### Finance (staff) (48 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 24667 | GET | `/api/finance/dashboard` | member JWT + is_admin | Admin-only finance dashboard, returns bank balance, fiscal year totals, pending counts |
| 24715 | GET | `/api/finance/bank-balance` | member JWT + is_admin | Admin-only, lists all finance_bank_balance entries newest first |
| 24720 | POST | `/api/finance/bank-balance` | member JWT + is_admin | Admin-only, inserts new bank balance snapshot into finance_bank_balance |
| 24729 | DELETE | `/api/finance/bank-balance/:id` | member JWT + is_admin | Admin-only, deletes a finance_bank_balance entry by id |
| 24736 | GET | `/api/finance/years` | member JWT + is_admin | Admin-only, lists finance_fiscal_years newest first |
| 24741 | POST | `/api/finance/years` | member JWT + is_admin | Admin-only, creates open fiscal year in finance_fiscal_years |
| 24749 | PUT | `/api/finance/years/:year` | member JWT + is_admin | Admin-only, updates fiscal year status or notes, closing also closes its work units |
| 24771 | GET | `/api/finance/work-units` | member JWT + is_admin | Admin-only, lists finance_work_units filtered by year and status |
| 24791 | POST | `/api/finance/work-units` | member JWT + is_admin | Admin-only, creates work unit in finance_work_units with budget and grant source |
| 24801 | GET | `/api/finance/work-units/:id` | member JWT + is_admin | Admin-only, returns one work unit with its finance_transactions |
| 24810 | PUT | `/api/finance/work-units/:id` | member JWT + is_admin | Admin-only, updates work unit fields and status in finance_work_units |
| 24818 | DELETE | `/api/finance/work-units/:id` | member JWT + is_admin | Admin-only, deletes work unit unless transactions reference it |
| 24830 | GET | `/api/finance/transactions` | member JWT + is_admin | Admin-only, lists finance_transactions with work unit info, filterable and paginated |
| 24869 | POST | `/api/finance/transactions` | member JWT + is_admin | Admin-only, creates numbered transaction in finance_transactions, updates work unit budget_used |
| 24888 | GET | `/api/finance/transactions/:id` | member JWT + is_admin | Admin-only, returns one finance transaction with work unit code and name |
| 24897 | PUT | `/api/finance/transactions/:id` | member JWT + is_admin | Admin-only, updates transaction fields, adjusts work unit budget_used for expenses |
| 24924 | DELETE | `/api/finance/transactions/:id` | member JWT + is_admin | Admin-only, deletes transaction and reverses work unit budget_used for expenses |
| 24939 | GET | `/api/finance/invoices` | member JWT + is_admin | Admin-only, lists finance_invoices filtered by year, direction and status |
| 24963 | POST | `/api/finance/invoices` | member JWT + is_admin | Admin-only, creates numbered invoice with line items in finance_invoices |
| 25012 | GET | `/api/finance/invoices/:id` | member JWT + is_admin | Admin-only, returns one invoice with its finance_invoice_items |
| 25023 | PUT | `/api/finance/invoices/:id` | member JWT + is_admin | Admin-only, updates invoice, recalculates totals and replaces line items |
| 25066 | DELETE | `/api/finance/invoices/:id` | member JWT + is_admin | Admin-only, deletes invoice and its finance_invoice_items |
| 25074 | POST | `/api/finance/invoices/:id/issue` | member JWT + is_admin | Admin-only, marks invoice issued and stamps issue date |
| 25082 | POST | `/api/finance/invoices/:id/mark-paid` | member JWT + is_admin | Admin-only, marks invoice paid, creates matching transaction, updates work unit budget |
| 25134 | GET | `/api/finance/invoices/:id/pdf` | member JWT + is_admin | Admin-only, renders invoice as printable inline HTML despite pdf path |
| 25240 | GET | `/api/finance/payment-orders` | member JWT + is_admin | Admin-only, lists finance_payment_orders filtered by year and status |
| 25260 | POST | `/api/finance/payment-orders` | member JWT + is_admin | Admin-only, creates numbered payment order in finance_payment_orders |
| 25274 | GET | `/api/finance/payment-orders/:id` | member JWT + is_admin | Admin-only, returns one payment order with work unit info |
| 25283 | PUT | `/api/finance/payment-orders/:id` | member JWT + is_admin | Admin-only, updates payment order fields, status and execution date |
| 25292 | DELETE | `/api/finance/payment-orders/:id` | member JWT + is_admin | Admin-only, deletes a finance_payment_orders row by id |
| 25299 | GET | `/api/finance/travel-orders` | member JWT + is_admin | Admin-only, lists finance_travel_orders filtered by year, status and traveler |
| 25336 | GET | `/api/finance/my-travel-orders` | member JWT | Lists the caller's own travel orders via their team_members record |
| 25349 | POST | `/api/finance/travel-orders` | member JWT + is_admin | Admin-only, creates numbered travel order in finance_travel_orders with advance amount |
| 25367 | GET | `/api/finance/travel-orders/:id` | member JWT; + own order or admin | Returns one travel order with its evidence files, admin or traveler access |
| 25378 | PUT | `/api/finance/travel-orders/:id` | member JWT + is_admin | Admin-only, updates travel order details and costs, recomputes cost_total |
| 25397 | POST | `/api/finance/travel-orders/:id/submit` | member JWT; + own order or admin | Traveler submits actual travel dates and costs, sets order status submitted |
| 25413 | POST | `/api/finance/travel-orders/:id/approve` | member JWT + is_admin | Admin-only, approves travel order and computes reimbursement minus advance |
| 25424 | POST | `/api/finance/travel-orders/:id/reject` | member JWT + is_admin | Admin-only, rejects travel order with rejection reason |
| 25432 | POST | `/api/finance/travel-orders/:id/pay` | member JWT + is_admin | Admin-only, marks travel order paid, creates expense transaction, updates work unit budget |
| 25469 | POST | `/api/finance/travel-orders/:id/evidence` | member JWT; + own order or admin; multipart upload | Uploads travel evidence file to disk, writes finance_travel_evidence row |
| 25482 | DELETE | `/api/finance/travel-orders/:orderId/evidence/:evidenceId` | member JWT + is_admin | Admin-only, deletes travel evidence file from disk and its DB row |
| 25495 | GET | `/api/finance/travel-orders/:id/pdf` | member JWT + is_admin | Admin-only, renders travel order as printable inline HTML despite pdf path |
| 25592 | GET | `/api/finance/settings` | member JWT + is_admin | Admin-only, returns all finance_settings as key-value object |
| 25600 | PUT | `/api/finance/settings` | member JWT + is_admin | Admin-only, upserts finance_settings key-value pairs from request body |
| 25615 | POST | `/api/finance/settings` | member JWT + is_admin | Admin-only, upserts finance_settings key-value pairs, duplicate of PUT |
| 25631 | GET | `/api/finance/reports/by-project` | member JWT + is_admin | Admin-only report of income, expenses and counts per project for year |
| 25646 | GET | `/api/finance/reports/by-work-unit` | member JWT + is_admin | Admin-only report of budget used and remaining per work unit |
| 25661 | GET | `/api/finance/reports/monthly` | member JWT + is_admin | Admin-only report of monthly income and expenses for fiscal year |

#### Rewards (7 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 26310 | POST | `/api/rewards/claim-missing` | member JWT | Member reports missing reward points, sends claim email to pr@medx.hr |
| 26346 | GET | `/api/rewards` | member JWT | Legacy alias returning read-only rewards summary derived from points_ledger |
| 26357 | GET | `/api/rewards/summary` | member JWT | Returns canonical rewards summary: balance, lifetime, ledger, redeem tiers, coupons |
| 26371 | PUT | `/api/rewards/sync` | public | 410 retired: client-side rewards sync removed, points now earned server-side |
| 26372 | POST | `/api/rewards/earn` | public | 410 retired: manual points earning removed |
| 26373 | POST | `/api/rewards/purchase-checkout` | public | 410 retired: rewards purchase checkout removed |
| 26378 | POST | `/api/rewards/redeem` | member JWT | Redeems points tier into member-bound one-time coupon in promo_codes table |

#### Gala admin (8 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 27052 | POST | `/api/admin/gala/invite-links` | member JWT + is_admin | Admin creates a gala invite link (generic or VIP) with limits |
| 27074 | GET | `/api/admin/gala/invite-links` | member JWT + is_admin | Admin lists gala invite links with built URLs |
| 27081 | GET | `/api/admin/gala/invite-links/:id` | member JWT + is_admin | Admin gets one gala invite link plus its registrations |
| 27094 | DELETE | `/api/admin/gala/invite-links/:id` | member JWT + is_admin | Admin revokes a gala invite link (sets revoked=1) |
| 27103 | POST | `/api/admin/gala/invite-links/:id/revoke` | member JWT + is_admin | POST alias revoking a gala invite link |
| 27694 | GET | `/api/admin/gala/scan/:regId` | member JWT + is_admin | Admin looks up gala registration by scanned regId, with invite label |
| 27722 | POST | `/api/admin/gala/scan/:regId/check-in` | member JWT + is_admin | Admin marks gala registration checked in via scanner |
| 27735 | POST | `/api/admin/gala/scan/:regId/uncheck` | member JWT + is_admin | Admin undoes a gala check-in |

#### Croatians Abroad (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 28156 | POST | `/api/croatians-abroad/register` | optional member JWT; rate-limited: registrationLimiter | Public Croatians Abroad multi-event registration: emails confirmation, Stripe Checkout for gala, Sheets sync |

#### SPA fallback (1 routes)

| line | method | path | auth | purpose |
|---|---|---|---|---|
| 29421 | GET | `*` | public (SPA fallback) | SPA fallback serving frontend index.html, 404 for paths with extensions |


---

## 2. MEMBER ↔ ADMIN touchpoints

### 2.1 Member backend → admin portal (HTTP, env, URLs)

| item | where | verdict |
|---|---|---|
| `process.env.ADMIN_PORTAL_URL` | `:28495` — `const adminUrl = process.env.ADMIN_PORTAL_URL \|\| 'https://medx-admin-portal.onrender.com';` inside `POST /api/register-invite` (`:28455`) | **Dead variable.** `adminUrl` has exactly one occurrence in the file (the assignment). The comment above it (`:28493–28494`) says admin sync "moved to AFTER payment (in Stripe webhook handler)" — but no webhook branch calls the admin portal either. |
| HTTP calls from the member backend | every `fetch(` in `server.js`, `fira-service.js`, `shared/*.js` | Outbound targets are only: Brevo `:102`; Google Sheets webhook `:668, :20493, :20844, :21010, :26921, :28342, :28802, :28988`; FIRA `fira-service.js:156, :174, :215`; Anthropic `shared/ai.js:102`; Google Wallet `shared/wallet.js:168`; self keep-alive `:29473` (`RENDER_EXTERNAL_URL + '/health'`, only when `KEEP_WARM === '1'`). **No request to `medx-admin-portal.onrender.com` or any admin route exists.** The literal `medx-admin-portal.onrender.com` appears only in the CORS allowlist (`:591`) and the dead `adminUrl` (`:28495`). |
| Admin URL in emails/pages | `:15706–15708` builds `${baseUrl}/evaluate?token=…` where `baseUrl = PUBLIC_BASE_URL \|\| RENDER_EXTERNAL_URL \|\| req.headers.origin \|\| host` — i.e. the **member** origin; the member portal serves its own `GET /evaluate` (`:23702`). | Interviewer magic links from this backend resolve on the member origin (the map's "`:15708→admin`" is not what the code does). |
| Cross-directory code import | `:29463` `require('../../admin-portal/backend/demo-purge.js').runDemoPurge(db, query, saveDb)` | The member service boots admin-portal code. Renaming/moving `demo-purge.js` breaks the member boot path (caught by `try/catch` `:29462–29464`, so it degrades to a warning). |

### 2.2 Admin portal → member portal

| channel | admin side | member side |
|---|---|---|
| **Server-to-server GET** | `admin-portal/backend/server.js:11339–11350`: `fetch(userPortalBase() + '/api/public/registrations/' + encodeURIComponent(user.email), { signal: AbortSignal.timeout(10000) })`, used when a member has zero registrations locally. `userPortalBase()` `:803–810` = `USER_PORTAL_URL` → prod default `https://medx-user-portal.onrender.com` → `http://localhost:3010`. | `GET /api/public/registrations/:email` `:29187–29223` — no auth, no limiter; returns `{registrations[], forumRegistrations[], galaRegistrations[], bridgesRegistrations[]}` (rows from `registrations`, `forum_event_registrations`, `gala_registrations`, `bridges_registrations`). |
| **Browser cross-origin POST** | `admin-portal/frontend/index.html:43241–43244` `fetch('https://medx-user-portal.onrender.com/api/admin/payments/gala/${id}/refund', { method:'POST', headers:{ Authorization: 'Bearer ' + App.token } })` (localhost → `http://localhost:3001`). | `POST /api/admin/payments/:kind/:id/refund` `:733–790`, `auth, adminOnly`; `kind ∈ gala \| forum-event \| conference`; retrieves the Stripe session/payment intent, `stripe.refunds.create` (`:763`), marks the row `refunded`, emails the guest. Requires the admin JWT to verify under the member `JWT_SECRET` and the admin user to exist in `users` with `is_admin=1` (shared DB). CORS for this call passes because `https://medx-admin-portal.onrender.com` is allowlisted (`:591`). |
| **Links into the member portal** | `admin-portal/backend/server.js` `userPortalBase()` call sites build `/plexus?…`, `/plexus/<token>`, `/forum/enter?token=`, `/f/<slug>`, `/donor-night`, `/#<section>`; `admin-portal/frontend/index.html:46981` and `:53709` (`memberBaseHref`, two dev ports: 3001 vs 3010), `:55583` "View member portal". | served by `:1292`, `:4163`, `:2363`, `:1762`, SPA. |
| **Admin CORS toward member origin** | `admin-portal/backend/server.js:876–884`: `origin: process.env.CORS_ORIGIN ? CORS_ORIGIN.split(',') : ['https://medx-admin-portal.onrender.com','https://medx-user-portal.onrender.com','http://localhost:3000','http://localhost:3001'], credentials: true`; `/api/public` on admin uses `PUBLIC_API_ORIGINS` (`:868–873`). | The member frontend has one absolute admin URL, a link-out at `app.part9.js:3693`; no member-frontend fetch targets the admin origin. |

### 2.3 Notification / queue tables shared through the DB

| table | member portal | admin portal | direction |
|---|---|---|---|
| `admin_notifications` | CREATE `:7243`; **writes** `:22991` (monthly project reminders → every admin) and `:26886` (`POST /api/gala/register` rings every admin); **reads** `:22943` (`GET /api/notifications`, `auth`), `:22951` (`PUT /api/notifications/:id/read`) | CREATE `admin:4125`; writes `admin:18400, :18481, :22900`; reads `admin:22852, :22860` | both write, both read (same bell, both origins) |
| `push_outbox` | CREATE `:9323` (+ `target_email` ALTER `:9331`); **drains** `:200–224` (`drainPushOutbox`, every 45 s when VAPID keys exist `:29485–29487`), sends via `web-push`, marks `sent=1`; also **enqueues** `:288` (announcement fan-out `fanoutAnnouncements` `:257–298`) | INSERTs `admin:22968, :34343, :39200, :41860` (admin holds no VAPID keys) | admin writes → member sends |
| `push_subscriptions` | CREATE (mirror block), writes `:23018–23035` (`POST /api/push/subscribe`), `:23036` (DELETE), pruned on 404/410 `:191` | not touched | member-only |
| `member_announcements` | reads `:263`, flips `push_fanned` `:291` | authored in admin | admin writes → member fans out |
| `user_notifications` | 22 references (routes `/api/user-notifications*`, `:6872`-family in the frontend) | written by admin campaigns | both |
| `event_survey_responses` | public tap endpoints `:12208–12264` update `rating/recommend/improve` by row `token` | admin stages rows | admin writes → member updates |
| `scheduled_emails` | dev-only drainer `:29516–29540` (no Turso) | admin drains in prod | admin owns |

### 2.4 The shared database

- Both services open the **same** Turso-backed SQLite through `shared/db.js` `createDatabase(Database, {localPath, syncUrl, authToken})` (`shared/db.js:14`): member `:6149–6153` (`DB_PATH` `:5582` = `DATABASE_PATH` → `shared/medx_portal.db` if present → local file), admin `admin:3132`. Cloud sync: debounced push 2 s after writes (`:6011–6013`), throttled `freshSync()` pull (`:6037–6040`, min 5 s apart, used by `/plexus`, `/invite/:data`, `/f/:slug`, speaker itineraries), periodic `db.sync()` every 60 s (`:29479–29481`). Schema fingerprint printed at boot `:29450–29457` so both portals can be compared in logs.
- **SCHEMA-MIRROR blocks:** member `:9316` (`BEGIN`) → `:9842` (`END`) = 527 lines; admin `:4154` → `:4680` = 527 lines. `diff` is empty; md5 of both extracts `9d76c0f0138ae087cb07bb47a6b9cd32`. `scripts/check-schema-sync.sh` (the CI guard) extracts exactly these markers.
- **Table census** (identifiers after `CREATE TABLE IF NOT EXISTS` in both `server.js` files + `shared/db.js` + `picker-sync.js`): **290** canonical tables; 218 are created in both files; 12 are created in the member file but never read or written by either portal (`accelerator_consents, conference_archives, conference_stats, contact_interactions, email_log, forum_notifications, group_discounts, group_registration_members, group_registrations, review_criteria, sponsor_leads, sponsor_materials`).
- **Touched by both portals: 171 tables.** Direction counts: 139 both write · 9 member-writes/admin-reads-only · 15 admin-writes/member-reads-only · 8 read-only in both. **Member-only (28):** `assistant_faq_log, card_photo_consents, chat_read_status, email_optouts, email_verifications, forum_badges, forum_email_templates, forum_event_speakers, forum_gallery_folders, forum_group_messages, forum_import_batches, forum_invitations, forum_member_badges, forum_news, forum_opportunities, forum_prospects, intro_requests, mentorship_profiles, mentorship_requests, messages, networking_connections, networking_meetings, networking_profiles, pending_meetings, processed_stripe_events, push_subscriptions, session_attendance, talk_ratings`. Admin-only: 79.
- Counting rule: a *write* is `INSERT [OR …] INTO t`, `REPLACE INTO t`, `UPDATE t`, `DELETE FROM t`; a *read* is `FROM t` / `JOIN t` (SQL text in each `server.js`; dynamic `${table}` strings such as the refund route's `UPDATE ${table}` and `AUDIENCE_REG_TABLE` reads at `:238–250` are not counted). "created:" shows which file(s) carry the `CREATE TABLE` (U = member, A = admin).

| table | user (W/R counts) | user first write / read (server.js line) | admin (W/R counts) | admin first write / read (admin server.js line) | direction |
|---|---|---|---|---|---|
| `abstract_authors` (created: UA) | RW 2/4 | W 13724,21627 / R 13736,21660,22238 | RW 2/4 | W 11528,19351 / R 11540,19366,19781 | both write |
| `abstract_files` (created: UA) | RW 1/1 | W 21703 / R 22237 | R 0/1 | W - / R 19780 | user writes → admin reads |
| `abstract_reviews` (created: UA) | RW 1/1 | W 22410 / R 22400 | RW 1/1 | W 20127 / R 20117 | both write |
| `abstracts` (created: UA) | RW 7/12 | W 13719,13742,19622 / R 13733,19617,19637 | RW 8/18 | W 8804,11523,11546 / R 11537,18143,18160 | both write |
| `accelerator_applicants` (created: UA) | RW 4/7 | W 23351,23394,23420 / R 15764,15779,23342 | RW 4/7 | W 24026,24069,24095 / R 15529,15544,24017 | both write |
| `accelerator_application_scores` (created: UA) | RW 2/5 | W 15675,15678 / R 15533,15539,15612 | RW 2/7 | W 15388,15391 / R 15222,15236,15319 | both write |
| `accelerator_applications` (created: UA) | RW 14/58 | W 14601,14656,14705 / R 5927,5928,11646 | RW 17/67 | W 3424,3435,10823 / R 5769,10805,13100 | both write |
| `accelerator_documents` (created: UA) | RW 7/24 | W 14638,14645,14688 / R 14539,14634,14638 | RW 7/26 | W 13173,13180,13223 / R 13104,13169,13173 | both write |
| `accelerator_evaluation_criteria` (created: UA) | RW 3/8 | W 15353,15363,15373 / R 15192,15344,15352 | RW 7/10 | W 10833,10834,10835 / R 13698,13850,13858 | both write |
| `accelerator_evaluations` (created: UA) | RW 4/4 | W 15387,15391,15410 / R 15192,15383,15406 | RW 4/4 | W 13893,13897,13932 / R 13698,13889,13928 | both write |
| `accelerator_form_config` (created: UA) | RW 4/3 | W 16671,16674,16688 / R 16659,16669,16696 | RW 4/3 | W 16232,16235,16249 / R 16220,16230,16257 | both write |
| `accelerator_institution_details` (created: UA) | RW 2/2 | W 15132,15141 / R 15117,15128 | RW 2/2 | W 13621,13632 / R 13605,13617 | both write |
| `accelerator_institutions` (created: UA) | RW 2/17 | W 10774,15156 / R 14527,14835,15116 | RW 3/20 | W 9051,13647,13661 / R 3436,3438,10821 | both write |
| `accelerator_interview_scores` (created: UA) | RW 2/6 | W 15501,15505 / R 15195,15441,15497 | RW 4/7 | W 15190,15194,15407 / R 13701,13971,15186 | both write |
| `accelerator_interviewers` (created: UA) | RW 5/7 | W 15464,15474,15483 / R 15195,15455,15493 | RW 7/7 | W 10839,10840,15153 / R 13701,15144,15182 | both write |
| `accelerator_key_dates` (created: UA) | RW 3/6 | W 15006,15026,15049 / R 14997,15005,15033 | RW 6/7 | W 10828,10829,10830 / R 13060,13530,13538 | both write |
| `accelerator_messages` (created: UA) | RW 3/1 | W 15255,15309,16027 / R 15197 | RW 3/1 | W 13761,13815,15828 / R 13703 | both write |
| `accelerator_pdf_settings` (created: UA) | RW 2/3 | W 15930,15942 / R 15892,15927,16083 | RW 2/3 | W 15718,15730 / R 15680,15715,15904 | both write |
| `accelerator_programs` (created: UA) | RW 3/26 | W 10759,14974,14984 / R 10756,14520,14532 | RW 4/37 | W 9036,13475,13485 / R 3425,3428,9033 | both write |
| `accelerator_recommendations` (created: UA) | R 0/3 | W - / R 14541,15198,19501 | R 0/3 | W - / R 13106,13704,18770 | read-only in both |
| `accelerator_result_codes` (created: UA) | R 0/1 | W - / R 16397 | W 1/0 | W 15848 / R - | admin writes → user reads |
| `accelerator_sites` (created: UA) | RW 1/3 | W 10518 / R 10517,14552,14553 | RW 4/5 | W 6398,12056,12071 / R 6397,12048,12068 | both write |
| `admin_notifications` (created: UA) | RW 3/1 | W 22951,22991,26886 / R 22943 | RW 4/1 | W 18400,18481,22860 / R 22852 | both write |
| `announcements` (created: UA) | RW 1/3 | W 19655 / R 13834,22227,23119 | RW 1/4 | W 18988 / R 11615,11646,19770 | both write |
| `app_state` (created: UA) | RW 3/4 | W 8655,8665,8758 / R 5607,8649,8659 | RW 12/12 | W 8385,8395,8410 / R 1027,8379,8389 | both write |
| `auction_items` (created: A) | R 0/1 | W - / R 12121 | RW 9/21 | W 31367,31389,31411 / R 22537,31191,31211 | admin writes → user reads |
| `audit_log` (created: UA) | W 4/0 | W 771,11103,11127 / R - | RW 6/4 | W 1267,10873,10886 / R 12559,35011,35363 | both write |
| `automation_config` (created: UA) | W 1/0 | W 10095 / R - | RW 2/1 | W 2343,5958 / R 2340 | both write |
| `bridges_events` (created: UA) | RW 5/37 | W 9052,9053,9059 / R 490,3113,3163 | RW 10/40 | W 10390,10424,10433 / R 10338,10409,10417 | both write |
| `bridges_program` (created: UA) | R 0/1 | W - / R 16643 | RW 4/3 | W 29866,29877,29896 / R 29850,29896,29903 | admin writes → user reads |
| `bridges_registrations` (created: UA) | RW 8/31 | W 12898,16479,16542 / R 490,4123,5869 | RW 10/42 | W 10422,20044,29709 / R 10422,11311,11412 | both write |
| `bridges_speakers` (created: UA) | R 0/3 | W - / R 16571,16572,16644 | RW 4/4 | W 29798,29809,29829 / R 29783,29829,29836 | admin writes → user reads |
| `certificates` (created: UA) | RW 1/6 | W 22316 / R 2945,13128,13239 | RW 2/6 | W 2689,19815 / R 2684,2735,2823 | both write |
| `channel_members` (created: UA) | RW 2/6 | W 18757,18762 / R 18695,18705,18718 | RW 13/12 | W 17307,17313,17346 / R 17238,17253,17307 | both write |
| `channel_read_status` (created: UA) | RW 3/3 | W 11161,18922,18924 / R 11161,18895,18918 | RW 7/7 | W 17309,17315,17525 / R 17309,17315,17498 | both write |
| `chat_channels` (created: UA) | RW 6/12 | W 10696,18734,18743 / R 10664,18696,18719 | RW 11/31 | W 8958,17283,17292 / R 8926,10756,10757 | both write |
| `chat_messages` (created: UA) | RW 3/8 | W 18758,18763,18821 / R 18758,18763,18789 | RW 9/15 | W 6226,10789,17308 / R 10753,17308,17314 | both write |
| `cme_accreditations` (created: UA) | R 0/3 | W - / R 21442,21463,21492 | RW 2/3 | W 34478,34481 / R 34445,34476,34512 | admin writes → user reads |
| `cme_submissions` (created: UA) | RW 2/2 | W 21476,21479 / R 21474,21490 | R 0/6 | W - / R 34446,34492,34513 | user writes → admin reads |
| `conference_photos` (created: UA) | R 0/1 | W - / R 22247 | R 0/5 | W - / R 19790,21753,21754 | read-only in both |
| `conferences` (created: UA) | RW 1/37 | W 10566 / R 2932,3293,4621 | RW 8/126 | W 8698,11038,11126 / R 1037,1040,1604 | both write |
| `connections` (created: UA) | RW 5/6 | W 11158,13800,13827 / R 11158,13811,13824 | RW 3/4 | W 11604,19631,19640 / R 11610,19616,19626 | both write |
| `content_blocks` (created: UA) | RW 2/6 | W 10539,12387 / R 10538,12050,12051 | RW 2/6 | W 6419,11961 / R 6418,11823,11824 | both write |
| `croatians_abroad_invite_links` (created: UA) | RW 5/6 | W 20743,27134,27154 / R 3276,27140,27146 | RW 2/4 | W 30530,30550 / R 30536,30542,30548 | both write |
| `croatians_abroad_registrations` (created: UA) | RW 10/16 | W 8654,8664,20731 / R 4086,8652,8654 | RW 7/29 | W 8384,8394,33093 / R 8382,8384,8392 | both write |
| `dashboard_preferences` (created: UA) | RW 4/4 | W 13630,13632,13658 / R 13617,13627,13647 | RW 3/3 | W 10991,10995,11004 / R 10982,10991,11004 | both write |
| `direct_messages` (created: UA) | RW 8/7 | W 11154,12531,12699 / R 8545,11154,26782 | RW 6/9 | W 34221,34236,34338 / R 1672,12569,18149 | both write |
| `drip_log` (created: UA) | RW 6/5 | W 4440,11027,11391 / R 4439,11005,11473 | RW 39/38 | W 2937,3092,3118 / R 2963,3089,3115 | both write |
| `event_components` (created: UA) | RW 3/3 | W 7106,7115,7117 / R 5699,5716,7113 | RW 4/6 | W 8547,8556,8558 / R 8554,30134,36201 | both write |
| `event_custom_fields` (created: UA) | R 0/2 | W - / R 5948,5950 | RW 3/5 | W 36380,36401,36411 / R 36355,36357,36359 | admin writes → user reads |
| `event_survey_responses` (created: UA) | RW 3/1 | W 12222,12242,12258 / R 12197 | RW 1/4 | W 2944 / R 2946,2965,21608 | both write |
| `feed_items` (created: UA) | RW 4/7 | W 10412,14109,14122 / R 10411,13857,13896 | RW 3/5 | W 12402,12416,12434 / R 12394,12412,12432 | both write |
| `finance_bank_balance` (created: UA) | RW 3/4 | W 10792,24723,24730 / R 10783,24671,24716 | RW 3/4 | W 9151,25608,25615 / R 9142,25550,25599 | both write |
| `finance_fiscal_years` (created: UA) | RW 6/3 | W 8266,10797,24744 / R 8264,24674,24737 | RW 8/6 | W 7458,9156,9157 / R 7456,25521,25553 | both write |
| `finance_invoice_items` (created: UA) | RW 4/4 | W 25001,25047,25055 / R 25019,25047,25067 | RW 5/4 | W 9472,25973,26036 / R 25991,26036,26067 | both write |
| `finance_invoices` (created: UA) | RW 6/6 | W 10842,24985,25040 / R 24694,24942,25014 | RW 6/10 | W 9464,25957,26029 / R 25577,25895,25910 | both write |
| `finance_payment_orders` (created: UA) | RW 4/3 | W 10860,25266,25285 / R 25243,25276,25293 | RW 4/5 | W 9987,26277,26300 / R 26252,26287,26296 | both write |
| `finance_sequences` (created: UA) | RW 12/3 | W 10829,10830,10831 / R 20343,21202,24645 | RW 8/1 | W 9233,9234,9235 / R 25494 | both write |
| `finance_settings` (created: UA) | RW 5/5 | W 8258,25604,25607 / R 25140,25500,25594 | RW 3/4 | W 7450,26661,26664 / R 26138,26541,26659 | both write |
| `finance_transactions` (created: UA) | RW 8/13 | W 10824,20355,21228 / R 24677,24678,24688 | RW 10/17 | W 9226,25537,25828 / R 25557,25558,25564 | both write |
| `finance_travel_evidence` (created: UA) | RW 2/3 | W 25475,25489 / R 25374,25483,25489 | RW 2/4 | W 26504,26518 / R 26384,26512,26518 | both write |
| `finance_travel_orders` (created: UA) | RW 8/8 | W 10851,10855,25357 / R 24695,25302,25330 | RW 8/8 | W 9747,26366,26395 / R 25578,26321,26349 | both write |
| `finance_work_units` (created: UA) | RW 12/14 | W 10809,24755,24794 / R 24681,24775,24802 | RW 6/19 | W 9176,25644,25655 / R 25561,25565,25679 | both write |
| `forum_activity` (created: UA) | R 0/1 | W - / R 17771 | R 0/6 | W - / R 16736,18135,18136 | read-only in both |
| `forum_comments` (created: UA) | RW 1/1 | W 17322 / R 17303 | RW 1/1 | W 16578 / R 16561 | both write |
| `forum_connections` (created: UA) | RW 3/5 | W 17056,17099,17101 / R 17030,17047,17076 | RW 3/5 | W 16391,16430,16432 / R 16367,16382,16409 | both write |
| `forum_considerations` (created: UA) | W 1/0 | W 4341 / R - | RW 2/9 | W 39432,39446 / R 1790,39414,39415 | both write |
| `forum_convening_segments` (created: UA) | RW 1/2 | W 10194 / R 4391,4413 | R 0/1 | W - / R 41740 | user writes → admin reads |
| `forum_convenings` (created: UA) | RW 1/3 | W 10191 / R 4389,4409,10189 | R 0/2 | W - / R 33670,41738 | user writes → admin reads |
| `forum_event_registrations` (created: UA) | RW 12/27 | W 8887,17428,17541 / R 4122,5864,12107 | RW 6/23 | W 16634,16957,17011 / R 11256,11298,11444 | both write |
| `forum_event_schedule` (created: UA) | RW 3/4 | W 18411,18436,18443 / R 17576,18393,18409 | RW 3/2 | W 17123,17136,17147 / R 17111,17147 | both write |
| `forum_events` (created: UA) | RW 18/39 | W 8871,8875,8882 / R 3761,3765,3766 | RW 11/26 | W 3234,3244,9092 / R 3241,3244,11299 | both write |
| `forum_gala_settings` (created: UA) | RW 2/6 | W 8858,8861 / R 491,3735,3746 | RW 2/1 | W 8320,41771 / R 41763 | both write |
| `forum_group_members` (created: UA) | RW 2/8 | W 17138,17141 / R 17112,17119,17135 | RW 4/6 | W 16469,16472,16831 / R 16441,16452,16466 | both write |
| `forum_groups` (created: UA) | RW 1/2 | W 17828 / R 17113,17766 | RW 3/7 | W 9131,16813,16832 / R 16442,16732,16809 | both write |
| `forum_magic_tokens` (created: UA) | RW 2/1 | W 4172,4306 / R 4168 | W 1/0 | W 39387 / R - | both write |
| `forum_media` (created: UA) | RW 1/1 | W 17658 / R 17588 | RW 3/1 | W 16669,17081,17096 / R 16646 | both write |
| `forum_members` (created: UA) | RW 12/70 | W 4230,4232,4235 / R 2956,4199,4200 | RW 11/63 | W 9085,16280,16308 / R 9060,9110,16266 | both write |
| `forum_mentorships` (created: UA) | RW 1/1 | W 17713 / R 17708 | RW 1/2 | W 16718 / R 16713,16733 | both write |
| `forum_post_reactions` (created: UA) | RW 2/3 | W 17286,17290 / R 17248,17283,17286 | RW 2/3 | W 16546,16550 / R 16501,16543,16546 | both write |
| `forum_posts` (created: UA) | RW 5/4 | W 17265,17287,17291 / R 13929,17229,17764 | RW 6/3 | W 9114,16524,16547 / R 16482,16730,17175 | both write |
| `forum_reservations` (created: UA) | RW 2/2 | W 4424,4428 / R 4392,4421 | R 0/2 | W - / R 33670,41741 | user writes → admin reads |
| `forum_resources` (created: UA) | RW 1/1 | W 17992 / R 17671 | RW 1/1 | W 17164 / R 16680 | both write |
| `gala_invite_links` (created: UA) | RW 5/11 | W 20902,27062,27097 / R 3616,8767,27068 | RW 3/6 | W 30462,30494,30502 / R 30468,30474,30480 | both write |
| `gala_registrations` (created: UA) | RW 22/34 | W 8653,8663,20417 / R 4110,5859,5922 | RW 13/85 | W 8383,8393,8408 / R 1621,1639,8381 | both write |
| `gala_seat_assignments` (created: UA) | R 0/1 | W - / R 13043 | RW 4/4 | W 12658,12672,12673 / R 12608,12658,12672 | admin writes → user reads |
| `gala_settings` (created: UA) | RW 12/25 | W 8591,8626,8671 / R 488,1310,3095 | RW 8/24 | W 6336,6337,8275 / R 8416,21760,22306 | both write |
| `gala_table_assignments` (created: UA) | R 0/2 | W - / R 13031,13371 | RW 3/4 | W 12734,12738,12757 / R 12694,12732,12757 | admin writes → user reads |
| `gala_tables` (created: UA) | R 0/1 | W - / R 13045 | RW 3/5 | W 12634,12646,12659 / R 12607,12642,12656 | admin writes → user reads |
| `guest_passes` (created: UA) | RW 2/5 | W 12905,12926 / R 12840,12844,12864 | RW 1/5 | W 33255 / R 23439,33191,33216 | both write |
| `intake_windows` (created: UA) | RW 3/4 | W 9963,16914,16915 / R 16712,16913,16917 | RW 1/1 | W 5651 / R 13070 | both write |
| `invoices` (created: UA) | RW 6/4 | W 767,19826,19838 / R 19822,20070,20182 | RW 1/1 | W 27099 / R 26922 | both write |
| `meeting_requests` (created: UA) | RW 1/2 | W 22110 / R 22118,22120 | RW 1/2 | W 19661 / R 19669,19671 | both write |
| `member_announcements` (created: UA) | RW 2/5 | W 291,10499 / R 263,10498,13908 | RW 3/6 | W 6382,11997,12039 / R 6381,11661,11978 | both write |
| `member_meta` (created: UA) | RW 1/4 | W 12960 / R 2727,2915,12956 | RW 2/3 | W 12456,12459 / R 12445,12451,37628 | both write |
| `monthly_reminders_sent` (created: UA) | RW 1/1 | W 23000 / R 22968 | RW 1/1 | W 22909 / R 22877 | both write |
| `notify_topics` (created: UA) | RW 3/9 | W 11163,14088,14091 / R 272,11163,11231 | R 0/7 | W - / R 11662,11746,11752 | user writes → admin reads |
| `opportunities` (created: UA) | RW 3/6 | W 10427,13994,14160 / R 10426,13981,13984 | RW 1/3 | W 12481 / R 12470,12472,12476 | both write |
| `org_settings` (created: UA) | R 0/1 | W - / R 12067 | RW 3/3 | W 5026,38434,38443 / R 5018,38420,38443 | admin writes → user reads |
| `page_views` (created: UA) | W 1/0 | W 12316 / R - | R 0/1 | W - / R 18929 | user writes → admin reads |
| `partner_hotels` (created: UA) | R 0/1 | W - / R 22152 | R 0/1 | W - / R 19699 | read-only in both |
| `payment_transactions` (created: UA) | RW 8/7 | W 766,19815,19843 / R 753,19809,20071 | RW 1/4 | W 27098 / R 11279,26848,26921 | both write |
| `personal_schedules` (created: UA) | RW 6/7 | W 11157,13760,13769 / R 11157,13754,13769 | RW 5/6 | W 11564,11573,19440 / R 11558,11573,19437 | both write |
| `pinned_items` (created: UA) | RW 3/4 | W 18952,18961,18970 / R 18935,18945,18950 | RW 3/4 | W 17947,17956,17965 / R 17930,17940,17945 | both write |
| `plexus_page_settings` (created: UA) | RW 3/5 | W 8611,8621,8933 / R 1323,1325,8610 | RW 5/12 | W 8295,8305,30085 / R 1435,1636,2087 | both write |
| `plexus_settings` (created: UA) | RW 2/6 | W 8922,8946 / R 3069,3685,8913 | RW 6/11 | W 8460,8476,8485 / R 8456,8467,8483 | both write |
| `points_ledger` (created: UA) | RW 2/5 | W 5838,26406 / R 5822,5825,5835 | RW 1/7 | W 35146 / R 35051,35066,35144 | both write |
| `poll_responses` (created: UA) | RW 2/2 | W 21999,22002 / R 21997,22531 | RW 2/2 | W 19550,19553 / R 19548,20360 | both write |
| `portal_content` (created: UA) | R 0/2 | W - / R 28089,28095 | RW 5/10 | W 33892,33906,33917 / R 33877,33883,33896 | admin writes → user reads |
| `pr_ai_generations` (created: UA) | RW 3/1 | W 26287,26295,26302 / R 26268 | RW 4/1 | W 10299,27976,27987 / R 27952 | both write |
| `pr_analytics` (created: UA) | RW 3/4 | W 10944,26198,26202 / R 25729,25730,26167 | RW 3/4 | W 10327,27882,27886 / R 27268,27269,27851 | both write |
| `pr_campaigns` (created: UA) | RW 4/4 | W 10931,26142,26151 / R 25707,26111,26128 | RW 4/5 | W 10236,27820,27835 / R 27241,27785,27802 | both write |
| `pr_content_calendar` (created: UA) | RW 6/6 | W 10895,25776,25785 / R 25684,25747,25768 | RW 12/13 | W 10170,21796,27323 / R 1759,20817,21793 | both write |
| `pr_media_assets` (created: UA) | RW 3/4 | W 26082,26091,26103 / R 26050,26071,26098 | RW 5/6 | W 10268,27707,27745 / R 27263,27713,27734 | both write |
| `pr_newsletters` (created: UA) | RW 5/5 | W 10907,25905,25914 / R 25721,25880,25897 | RW 11/10 | W 10192,23265,23273 / R 1776,23265,23304 | both write |
| `pr_posts` (created: UA) | RW 5/7 | W 10881,25805,25855 / R 10869,25691,25701 | RW 9/10 | W 10145,20833,27355 / R 10123,27225,27235 | both write |
| `pr_subscribers` (created: UA) | RW 6/6 | W 10920,25963,25975 / R 25716,25923,25939 | RW 8/13 | W 10216,23789,23793 / R 23028,23044,23413 | both write |
| `pr_templates` (created: UA) | RW 4/2 | W 26237,26246,26254 / R 26214,26260 | RW 5/2 | W 10283,27921,27930 / R 27898,27944 | both write |
| `project_files` (created: UA) | RW 3/4 | W 19390,19427,19455 / R 19404,19448,19455 | RW 3/5 | W 18648,18685,18713 / R 18662,18706,18713 | both write |
| `project_folders` (created: UA) | RW 3/5 | W 19377,19392,19394 / R 19364,19386,19394 | RW 3/5 | W 18635,18650,18652 / R 18622,18644,18652 | both write |
| `project_settings` (created: UA) | RW 6/5 | W 7237,19004,19007 / R 7235,18981,19002 | RW 7/11 | W 4119,17999,18002 / R 1656,2083,4117 | both write |
| `project_status` (created: UA) | RW 1/3 | W 10484 / R 10483,12076,14063 | RW 3/10 | W 6368,11777,11788 / R 1656,2073,6367 | both write |
| `project_tasks` (created: UA) | RW 5/10 | W 10733,19111,19121 / R 19048,19064,19065 | RW 11/18 | W 9010,10021,12174 / R 1577,12161,12183 | both write |
| `project_timeline_events` (created: UA) | RW 4/5 | W 19305,19319,19331 / R 19285,19293,19316 | RW 3/4 | W 18574,18588,18596 / R 18554,18562,18585 | both write |
| `promo_codes` (created: UA) | RW 9/11 | W 8866,10582,12439 / R 5759,5762,5893 | RW 10/24 | W 8679,8714,11205 / R 8677,11181,11202 | both write |
| `push_outbox` (created: UA) | RW 2/1 | W 218,288 / R 205 | W 4/0 | W 22968,34343,39200 / R - | both write |
| `question_upvotes` (created: UA) | RW 2/7 | W 21883,21885 / R 21834,21881,21883 | RW 2/5 | W 19474,19476 / R 19425,19472,19474 | both write |
| `refund_requests` (created: UA) | RW 2/2 | W 21586,22547 / R 22437,22568 | RW 6/4 | W 10727,10728,19312 / R 10718,18140,20154 | both write |
| `registration_details` (created: UA) | RW 1/1 | W 21404 / R 21520 | RW 1/1 | W 19234 / R 19267 | both write |
| `registration_links` (created: UA) | RW 5/7 | W 20749,20918,28374 / R 1299,3651,5731 | RW 4/2 | W 31009,31037,36271 / R 36313,36314 | both write |
| `registration_transfers` (created: UA) | RW 1/2 | W 21565 / R 21556,22577 | RW 4/3 | W 10739,19297,21400 / R 20406,21381,21449 | both write |
| `registrations` (created: UA) | RW 16/70 | W 12453,12893,13353 / R 2932,2945,4121 | RW 15/115 | W 4751,8788,11221 / R 1440,1458,1604 | both write |
| `resources` (created: UA) | R 0/2 | W - / R 13845,22254 | R 0/2 | W - / R 11741,19797 | read-only in both |
| `reward_redemptions` (created: UA) | RW 1/1 | W 26404 / R 5888 | R 0/3 | W - / R 35052,35062,35171 | user writes → admin reads |
| `rewards_settings` (created: UA) | RW 2/2 | W 2408,10373 / R 2405,5802 | RW 5/3 | W 6352,30700,35104 / R 30684,35020,37585 | both write |
| `scheduled_emails` (created: UA) | RW 10/3 | W 11380,12825,12931 / R 16784,29351,29521 | RW 58/19 | W 1933,2352,2522 / R 1912,1914,2830 | both write |
| `scholarship_applications` (created: UA) | RW 1/2 | W 21599 / R 22436,22574 | RW 5/3 | W 10735,10736,19325 / R 18141,20153,20403 | both write |
| `sequence_steps` (created: UA) | RW 4/5 | W 19233,19255,19260 / R 19207,19218,19247 | RW 11/7 | W 10043,10062,10080 / R 18359,18370,18439 | both write |
| `session_polls` (created: UA) | RW 2/3 | W 22518,22520 / R 21839,21994,22528 | RW 2/3 | W 20347,20349 / R 19430,19545,20357 | both write |
| `session_questions` (created: UA) | RW 6/6 | W 13782,21873,21926 / R 13788,21835,21902 | RW 5/5 | W 11586,19464,19516 / R 11592,19426,19492 | both write |
| `session_ratings` (created: UA) | RW 2/1 | W 22015,22018 / R 22012 | RW 2/2 | W 19566,19569 / R 19563,22698 | both write |
| `session_tracks` (created: UA) | R 0/1 | W - / R 21726 | R 0/1 | W - / R 19406 | read-only in both |
| `sessions` (created: UA) | RW 9/16 | W 10594,10596,10598 / R 4647,4648,5192 | RW 20/24 | W 8726,8728,8730 / R 11553,11557,19402 | both write |
| `signup_form_responses` (created: UA) | RW 3/9 | W 27254,29275,29318 / R 2374,4124,13086 | RW 4/15 | W 30819,30848,30864 / R 18110,30670,30671 | both write |
| `signup_forms` (created: UA) | R 0/10 | W - / R 2351,2352,2365 | RW 4/13 | W 30722,30779,30789 / R 30602,30711,30726 | admin writes → user reads |
| `speaker_applications` (created: UA) | RW 1/1 | W 22197 / R 22579 | RW 5/3 | W 10742,10743,19744 / R 18142,20408,22824 | both write |
| `speaker_documents` (created: UA) | RW 3/5 | W 28009,28013,28037 / R 27980,28003,28009 | R 0/3 | W - / R 29916,29930,29948 | user writes → admin reads |
| `speaker_itineraries` (created: UA) | R 0/1 | W - / R 4508 | RW 7/11 | W 22148,22174,22196 / R 22124,22130,22159 | admin writes → user reads |
| `speaker_itinerary_items` (created: UA) | R 0/1 | W - / R 4677 | RW 3/8 | W 22228,22249,22264 / R 22070,22132,22214 | admin writes → user reads |
| `speakers` (created: UA) | RW 9/23 | W 10334,10589,22473 / R 4629,4630,4636 | RW 16/43 | W 6328,8721,20296 / R 2077,6328,11580 | both write |
| `sponsor_tasks` (created: UA) | RW 5/3 | W 22822,22846,22856 / R 22822,22838,22868 | RW 6/7 | W 1424,21164,21227 / R 1422,1691,21164 | both write |
| `sponsors` (created: UA) | RW 6/6 | W 8741,8751,22804 / R 8739,12145,13839 | RW 8/21 | W 8821,21135,21151 / R 1441,1692,1718 | both write |
| `submission_pipeline` (created: UA) | RW 4/4 | W 16814,16817,16843 / R 16774,16810,16830 | RW 2/10 | W 15006,15012 / R 5768,14096,14136 | both write |
| `survey_responses` (created: UA) | RW 1/2 | W 22343 / R 22333,22340 | RW 1/2 | W 19841 / R 19831,19838 | both write |
| `surveys` (created: UA) | R 0/1 | W - / R 22330 | R 0/1 | W - / R 19828 | read-only in both |
| `talks` (created: UA) | RW 5/9 | W 10445,10466,14182 / R 10444,10465,13552 | RW 3/4 | W 12502,12515,12531 / R 12495,12512,12529 | both write |
| `task_files` (created: UA) | RW 2/4 | W 19151,19169 / R 19081,19084,19161 | RW 2/4 | W 18303,18321 / R 18233,18236,18313 | both write |
| `task_sequences` (created: UA) | RW 4/5 | W 19227,19261,19265 / R 19200,19202,19215 | RW 9/5 | W 10031,10049,10068 / R 18352,18354,18367 | both write |
| `team_members` (created: UA) | RW 4/21 | W 10641,10719,10751 / R 10704,10847,10848 | RW 5/52 | W 8921,8981,9028 / R 1578,1693,1918 | both write |
| `ticket_transfer_audit` (created: UA) | W 1/0 | W 21571 / R - | W 3/0 | W 21403,21405,21454 / R - | both write |
| `ticket_types` (created: UA) | RW 4/38 | W 10578,12457,19901 / R 2932,3714,5619 | RW 11/40 | W 8569,8710,11063 / R 1038,8756,11060 | both write |
| `user_notifications` (created: UA) | RW 10/4 | W 11156,15013,15036 / R 11156,23057,23067 | RW 5/4 | W 16981,22925,22983 / R 11631,22936,22943 | both write |
| `user_profiles` (created: UA) | RW 2/4 | W 11160,21338 / R 11160,13518,22035 | RW 1/2 | W 19171 / R 19586,19611 | both write |
| `users` (created: UA) | RW 28/197 | W 4224,10612,10622 / R 211,269,273 | RW 21/168 | W 8852,8868,8884 / R 1072,1093,1105 | both write |
| `venue_rooms` (created: UA) | R 0/1 | W - / R 21727 | RW 3/4 | W 34660,34674,34684 / R 19407,34652,34668 | admin writes → user reads |
| `vip_passes` (created: UA) | RW 1/1 | W 5377 / R 5168 | RW 5/10 | W 22398,22433,22442 / R 22379,22384,22409 | both write |
| `visa_requests` (created: UA) | RW 2/2 | W 22141,22556 / R 22438,22571 | RW 6/3 | W 10731,10732,19689 / R 18139,20155,20400 | both write |
| `volunteer_assignments` (created: UA) | R 0/2 | W - / R 22183,22887 | R 0/2 | W - / R 19730,21268 | read-only in both |
| `volunteer_shifts` (created: UA) | RW 1/2 | W 22490 / R 22182,22888 | RW 1/2 | W 20313 / R 19729,21269 | both write |
| `volunteers` (created: UA) | RW 4/4 | W 22167,22507,22926 / R 22163,22176,22500 | RW 5/5 | W 8836,19714,20336 / R 19710,19723,20327 | both write |
| `waitlist` (created: UA) | RW 1/1 | W 21535 / R 21530 | RW 1/1 | W 19282 / R 19277 | both write |


---

## 3. WEBSITE-FACING surface (medx.hr `site.js` and everything the marketing site links to)

**What `site.js` actually calls** (live `https://medx.hr/site.js`, 119,621 bytes, md5 identical to `MedX_Squarespace/site_live_mirror_2026-07-31/site.js`): `PORTAL/api/public/site` (`site.js:988`), `/api/public/content` (`:989`), `/api/public/status` (`:990`), `/api/public/supporters` (`:992`, conditional), beacon `POST /api/public/pv` (`:1571`), `/health` probes (`:916` **`mode:'no-cors'`** still present, `:1733` `mode:'cors'`), plus the registration deep link `mxRegUrl` (`:1297–1301`).

### 3.1 `/api/public/*` handlers and exact response shapes

| route (line) | auth / limiter / caching | response shape (top-level → nested keys) |
|---|---|---|
| `GET /api/public/site` (`:11943–12027`) | none, **no limiter, no memo, no Cache-Control** (registered before `publicLimiter` exists) | no active conference → `{conference:null, tickets:[], speakers:[]}`. Otherwise `{ conference:{name, year, slug, description, start_date, end_date, date_range, venue_name, venue_city, venue_country, registration_open(bool), early_bird_deadline, regular_deadline, pricing_phase('early_bird'\|'regular'\|'late'), keynote_count, keynote_count_word, keynote_count_word_hr}, price:{early_bird, regular, late, current, currency}, deadline:{early_bird, regular}, tickets:[{name, name_hr, price_early_bird, price_regular, price_late, currency, includes_gala, sort_order}], speakers:[{name, title, institution, photo_url, talk_title, is_keynote, sort_order}], generated_at }`. When no ticket has a non-zero `price_early_bird`, `price.*` is filled from `gala_settings` (`:11967–11976`, default 150). |
| `GET /api/public/content[?page=]` (`:12045–12061`) | `publicLimiter`; memo 45 s; `Cache-Control: public, max-age=60, stale-while-revalidate=300` (`:12041`) | `{ blocks:{ [block_key]:{type, body, body_hr, updated_at} }, generated_at }` from `content_blocks WHERE is_published=1`. |
| `GET /api/org/signature` (`:12066–12069`) | `publicLimiter` | `{ signature: <data URL or null> }` (org_settings key `signature`). |
| `GET /api/public/status` (`:12072–12089`) | `publicLimiter`; memo 30 s; cache headers | `{ projects:[{project_key, status_label, status_kind, detail_line, cta_label, cta_target, status_label_hr, detail_line_hr, cta_label_hr, updated_at}], generated_at }` ordered `plexus, gala, accelerator, forum, bridges` then the rest (`:12075–12081`). |
| `GET /api/public/impact` (`:12096–12135`) | `publicLimiter`; memo 120 s; cache headers | `{ members, countries, registrations, events, speakers, charity_giving:{pledged_eur, paid_eur}\|null, generated_at }` — counts only; `auction_items` (admin-only table) read inside try/catch. |
| `GET /api/public/supporters` (`:12141–12203`) | `publicLimiter`; memo 300 s; cache headers | `{ strings:{hr:{heading, intro}, en:{heading, intro}}, groups:[{key('public-body'\|'company'), label_hr, label_en, items:[{name, logo(absolute URL or null), website}]}], count, generated_at }`; `logo` = `(RENDER_EXTERNAL_URL \|\| req host) + '/' + logo_url` (`:12153–12166`). |
| `GET /api/public/survey?t=&r=&l=` (`:12208–12229`), `GET …/survey/recommend?t=&v=` (`:12231–12248`), `POST …/survey/comment {t,text}` (`:12250–12264`) | `publicLimiter`; `no-store` | HTML page (bilingual) for the two GETs; the POST returns `{success:true[, already:true]}` or `{error:'not_found'}`. Row is resolved by `event_survey_responses.token` (`surveyRowByToken` `:12195`). |
| `POST /api/public/pv` (`:12296–12328`) | `pvLimiter`; body `express.text({type:'*/*', limit:'2kb'})`; sets `Cross-Origin-Resource-Policy: cross-origin` (`:12299`) | always `204`; honours `DNT`/`Sec-GPC`; drops bot UAs; UPSERT into `page_views(day, path, referrer_domain, device, count)`. Payload `{path, ref}` as text/plain or JSON. |
| `POST /api/public/forum-consideration` (`:4329–4345`) | `forumWingLimiter` | `{success:true, message}` or `{error}`; accepts website field aliases (`full_name`, `organisation`, `specialty`, `message`, `nominator`, `source` default `'website'`) → `forum_considerations`. |
| `GET /api/public/speaker-itinerary/:token` (`:5117–5129`) | `speakerLimiter`; `Cache-Control: private, max-age=120` | `buildSpeakerPayload(itin)` or `404 {error:'not_found'}`. |
| `GET /api/public/registrations/:email` (`:29187–29223`) | **none** | `{registrations[], forumRegistrations[], galaRegistrations[], bridgesRegistrations[]}` — used by the admin backend (§2.2). |
| `POST /api/public-events/register` (`:28897`) | `registrationLimiter`, `optionalAuth` | public event sign-up (donor night / building bridges pages). |
| `GET /health` (`:29184`) | none | `{ok:true}` (Render health gate, workflows, site probes). |

The member portal has **no** separate `/api/public` CORS mount (the admin portal does, `admin:873`); the global allowlist in §3.5 applies.

### 3.2 Donation flow — `GET /donate/checkout` (`:5411–5455`)

- Limiter `donateCheckoutLimiter` `:5407–5410`: 30 hits / 15 min per IP; over the limit → `302 https://medx.hr/donate?checkout_error=1` (`:5409`).
- Params (all optional, never rejected): `amount` → `parseInt`, default 50, clamped to 1…50000 (`:5418–5420`); `frequency` ∈ `once|month|year` else `once` (`:5421`); `designation` must be a key of `DONATION_DESIGNATIONS` (`:5397–5404`: `unrestricted, accelerator, plexus, gala, forum, bridges`) else `unrestricted` (`:5422–5423`). **`src` is not read** (donate.html sends `src=medx.hr`; the server hardcodes `source:'medx.hr'` in metadata).
- Stripe (`:5430–5451`): `mode` `payment` or `subscription` (`recurring.interval = frequency`), `currency:'eur'`, `unit_amount: amount*100`, `metadata:{type:'donation', designation, frequency, source:'medx.hr'}`, **`success_url: 'https://medx.hr/donate?thanks=1'` (`:5449`), `cancel_url: 'https://medx.hr/donate?cancelled=1'` (`:5450`)** — both hardcoded; `303` to `session.url` (`:5452`). No Stripe / any error → `302 https://medx.hr/donate?checkout_error=1` (`fail`, `:5412–5415`). Registered before `express.static` so it beats the SPA (`:5394–5395`).
- Webhook side: `metadata.type === 'donation'` branch at `:20642`.

### 3.3 Deep links from the website — what is actually consumed

| param | consumer | line |
|---|---|---|
| `?mxt=<token>` | `index.html:54` — `localStorage.setItem('medx_user_token', t)` then `history.replaceState` to `pathname+hash` (runs before any app script); `forum-wing.html:511` — same, key `TOKEN_KEY='medx_user_token'`, URL rewritten to `/forum`. Also produced by the member backend itself: `GET /forum/enter?token=` redirects to `/forum?mxt=<jwt>` (`:4176`). | **Not consumed on `/plexus`** (server-rendered, no `mxt` handling anywhere in `server.js` other than the forum redirect). |
| `?event=<slug>` | `app.part9.js:4923` (`p.get('event')` inside the `/forum/events/<slug>` path handler at `:4925`, opens anonymous forum registration) and `app.part9.js:37966` (check-in scanner filter, with `?mode=scanner`). | Not read by the `/plexus` handler (`:1292–1572` reads only `req.params.token \|\| req.query.t` at `:1295` and prefill keys through `pfPrefill` at `:1386`). |
| `?ticket=<phase>`, `?from=website` | **nowhere** — zero occurrences of `get('ticket')`, `get('from')`, `query.ticket`, `query.from` in `server.js`, `index.html`, `forum-wing.html`, `app.part*.js`. | Tolerated (ignored). |
| `?t=<token>` / `/plexus/:token` | `:1295` → `registration_links WHERE token=? AND event_type='plexus'` (`:1299`), disabled/expired/max-uses notices (`:1301–1303`), `component_keys` decide which of `conference/bridges/gala` are offered (`:1304`). | The wizard's client JS reads `localStorage.medx_user_token` / `medx_user_data` (`:1457–1458`) to link the registration to a signed-in member. |
| SPA boot params (`UserPortal.init`, `app.part9.js:3362–3512`) | `invite` (`:3368`, direct invite form), `register` (`:3369`), `logout=true` (`:3380`), `section=speaker&code=` (`:3391–3399`), `verified=true\|already\|expired\|invalid` (`:3403–3434`), `payment=success\|cancelled` (`:3438`), `view=ticket` (`:3455`, manifest shortcut), `gala=<id>` (`:3481`), `login=true` (`:3507`), path `/forum/events/<slug>` (`:4925`), `mode=scanner` + `event` (`:37960–37971`). | `manifest.json` `start_url: /?app=1`, shortcuts `/?app=1&view=ticket`, `/?app=1&view=schedule`. |

### 3.4 Stripe return handling (`?payment=` / `?type=` / `?reg=` / `?app=` / `?gala=`)

- Producers (all verified at the cited lines): accelerator `:15075` → `?payment=success\|cancelled&type=accelerator&app=<id>`; forum event `:17513` → `…&type=forum&reg=<id>`; Plexus `:20201` → `?payment=…&reg=<id>` (no `type`); gala `:27817` and pay-link `:27889` → `?payment=…&gala=<id>`; Croatians Abroad `:28403` and invite `:28755` → `/invite-success?session_id={CHECKOUT_SESSION_ID}` / `/invite-cancelled`; donation `:5449–5450` → medx.hr.
- Consumers: `UserPortal.init` sets `isStripeReturn` when `payment ∈ success\|cancelled` (`app.part9.js:3438`), restores the saved session, and if `gala` is present routes to `GalaPortal.showTab('register')` + `checkMyStatus()` with a success/cancel toast (`:3481–3497`), else `showSection('plexus')` (`:3500`). `PlexusPortal.handleStripeReturn` (`:9822–9880+`) reads `payment`, `type` (default `plexus`), `reg \|\| app`; `type=forum` → forum section + `App.loadForumEvents()`; `type=accelerator` → accelerator section + `loadMyApplications()`; default → Plexus section and polls for webhook confirmation. `sessionStorage.medx_plexus_idemp` guards double checkout (3 uses).
- `GET /invite-success` (`:801`) without `session_id` renders "No recent payment session" (live-confirmed 200); `GET /invite-cancelled` (`:972`) is static.

### 3.5 CORS — exact code (`:583–595`)

```js
// Public read endpoints (conferences/tickets/schedule/speakers) are consumed by the
// marketing website for live prices/dates — explicit allowlist (never wildcard) since
// this server also handles Stripe/registration. Add the website + preview origins.
app.use(cors({
    origin: [
        process.env.RENDER_EXTERNAL_URL,
        'https://medx.hr', 'https://www.medx.hr',
        'https://medx-website-preview.netlify.app',
        'https://medx-admin-portal.onrender.com',
        'http://localhost:3000', 'http://localhost:3001', 'http://localhost:8899'
    ].filter(Boolean)
}));
```

- It **is** a list (an array literal), but it is **not env-driven**: `CORS_ORIGIN` does not appear in `user-portal/**` or `shared/**` (only in `admin-portal/backend/server.js:876–878` and the 2026-06-03 snapshot). When `RENDER_EXTERNAL_URL` is unset the first entry is dropped by `.filter(Boolean)` and the seven literals remain — there is no "default when unset" other than that.
- `credentials` is not set (defaults to false); methods default to `GET,HEAD,PUT,PATCH,POST,DELETE` (confirmed by the live OPTIONS probe). A non-listed origin gets **no** `Access-Control-Allow-Origin` header (cors package behaviour; live-confirmed for `https://medx-member-portal-review.netlify.app`).
- Helmet (`:599–643`) adds `Cross-Origin-Resource-Policy: same-origin` (helmet default; visible in §8) and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (`:639`); COEP is disabled (`:638`). Only `POST /api/public/pv` overrides CORP to `cross-origin` (`:12299`). CSP `connect-src` is `'self'` + Stripe hosts + `https://*.cloudinary.com` (`:621–625`), which is why the service worker never re-fetches cross-origin (`sw.js:57–66`).

### 3.6 Forever-URLs (links already in inboxes, QR codes, calendars, wallets)

| URL | route line | credential / what it reads | behaviour |
|---|---|---|---|
| `/api/auth/verify?token=` | `:11701` | `email_verifications.token`, legacy fallback `users.verification_token` (`:11707–11712`) | redirects to `/?verified=true\|already\|expired\|invalid` |
| `/api/verify-email?token=` | `:11253` | `users.verification_token` | plain-text responses (legacy path) |
| `/reset-password/:token` | `:11789` | `users.reset_token` + `reset_token_expires` | server-rendered form (`premiumPage`); the page's JS POSTs `/api/auth/reset-password` (`:11845`); invalid → "Link Invalid or Expired" page, HTTP 200 (live-confirmed) |
| `/invite/:data` | `:3254` | base64url JSON `{e,x,i}` (both base64 flavours accepted `:3261–3263`), `freshSync()` first | Croatians-Abroad / gala invite registration page |
| `/pass/:token` (+ `/calendar.ics` `:3227`, `/manifest.json` `:5341`) | `:5363` (`speakerLimiter`) | `guestPassByToken`, `revoked`, expiry | zero-login guest micro-page |
| `/pay/gala/:token` | `:27868` (`publicLimiter`) | gala pay-link token → creates a Stripe session (`:27889`) | invalid token → `404` HTML "Invalid payment link" (live-confirmed) |
| `/qr/:id.png` | `:4076` | id must match `^[0-9a-fA-F-]{16,64}$` (`:4079`); resolves across `croatians_abroad_registrations` → `gala_registrations` → other registration tables | PNG; helper `qrImageUrl()` `:501` = `${QR_BASE_URL}/qr/<id>.png`, `QR_BASE_URL = RENDER_EXTERNAL_URL \|\| 'https://medx-user-portal.onrender.com'` `:500` |
| `/unsubscribe?e=&s=` | `:1857` | `e` = base64url email, `s` = `emailPrefSig(email)` HMAC (`:1777`) | upserts `email_optouts` scopes `reminders,newsletter`, redirects to `/email-prefs?…&saved=1` |
| `/email-prefs?e=&s=` (GET `:1827`), **`POST /api/email-prefs`** (`:1837`, `express.urlencoded`) | signed as above | preferences page; link builder `emailPrefLink()` `:1780–1784` |
| `/calendar/medx-events.ics` | `:3147` | none; base URL `RENDER_EXTERNAL_URL` fallback `:3151` | subscribe-once feed (open signup forms + events), `text/calendar` (live 200) |
| `/calendar/:file` | `:3188` | slug → `calendarEventsFor(slug)`; 404 when empty | per-event `.ics`, `Cache-Control: public, max-age=3600` |
| `/verify-certificate?n=\|number=` | `:22262` | `certificates.certificate_number` | HTML, `noindex`; unknown number → 404 page (live-confirmed) |
| `/invite-success?session_id=` / `/invite-cancelled` | `:801` / `:972` | Stripe session id | HTML pages |
| `/verify/:token`, `/r/:token` | `:2717`, `:2906` | badge / share tokens (`resolveVerifyBadgeToken`, `resolveShareRecordToken`) | neutral 200 pages on any failure |
| `/f/:slug` (+ `/qr.png` `:2349`, `/calendar.ics` `:3204`) | `:2363` | `signup_forms.slug` (drafts 404, `freshSync` retry) | public sign-up form |
| `/speaker/:token` | `:5097` (`speakerLimiter`) | itinerary token | speaker itinerary page |
| `/forum/enter?token=` | `:4163` | `forum_magic_tokens` (single use, expiry) | mints a member JWT and redirects to `/forum?mxt=` (`:4176`) |
| `/plexus`, `/plexus/:token`, `/donor-night` `:1762`, `/building-bridges` `:1761`, `/forum` `:4155`, `/apply` `:24059`, `/evaluate` `:23702`, `/terms` `:1026`, `/privacy` `:1073` | as listed | — | server-rendered public pages |

---

## 4. FRONTEND FETCH INVENTORY (member SPA, forum wing, service worker)

**Extraction:** `fetch(`, `api(`/`.api(`, `apiFetch(`, `apiCall(`, `apiGet(`, `apiPost(`, `apiRequest(`, `XMLHttpRequest`, `EventSource(` across `index.html`, `forum-wing.html`, `sw.js`, `assets/app.part1–14.js` → 465 grep hits; after removing wrapper definitions and comments, **423 literal-path call sites → 289 distinct normalized paths** (template placeholders and string concatenations shown as `:X`, query strings stripped), plus **36 variable-URL sites** and **2 XHR uploads** (`app.part9.js:25872/25901` and `:26073/26099`, both `POST /api/chat/upload`). No `EventSource` anywhere. Distribution: `app.part9.js` 427 hits, `forum-wing.html` 10, `app.part12.js` 5, `index.html` 4, `sw.js` 4, `app.part6.js` 3, `app.part13.js` 3, parts 1/5 2 each, parts 3/4/7/8/14 1 each.

**API base:** always same-origin — `apiBase()` returns `API_BASE` if defined else `''` (`app.part1.js:1874`, `app.part3.js:9`, `app.part4.js:3`, `app.part5.js:5`, `app.part6.js:3`, `app.part8.js:3`, `app.part13.js:29`; inline `var apiBase = …` at `app.part9.js:40, 910, 950, 986, 1013, 6871, 6953, 6974`). Wrappers that carry the Bearer token: `UserPortal.api(endpoint, options)` `app.part9.js:4693–4697`, staff `App.api` `:25315–25319`, `:34097`, `:36651`, `:38840`, `MedXAssistant`-style `:45211–45213`, `app.part12.js:3` (`api(path, opts)` → `UserPortal.api` or raw `fetch`), forum wing `Wing.api` `forum-wing.html:669`. Variable-URL call sites (the URL is assembled just above the call): `app.part9.js:19416, 19464, 28241, 29602, 30595, 30668, 30693, 30743, 35729, 36914, 37286, 37479, 37596, 39010, 39109, 39175, 39272, 39384, 39468, 43166, 44844` (`/api/public/pv` beacon fallback, text/plain, keepalive), `sw.js:78, 97` (`event.request` passthrough).

**Six normalized paths have no exact backend route** (all explained): `/api/admin/plexus/:X/:X/approve|reject` (`app.part9.js:30393/30413`, built as `/api/admin/plexus/${type}/${id}/approve`) only match the backend's `…/volunteers/:id/approve|reject` (`:22925`, `:22932`); `/api/forum/gallery/folders${…}` and `/api/forum/media${…}` (`:31599–31600`) are `/api/forum/gallery/folders?parent_id=` and `/api/forum/media?folder_id=` (`:17606`, `:17584`); `/api/forum/wing/directory:X` and `/api/opportunities:X` are query-string concatenations onto existing routes (`GET /api/forum/wing/directory` `:4349`, `GET /api/opportunities` `:13977`).

### 4.1 Distinct API paths called by the member frontend (289)

| API path (normalized) | first call site | #calls | triggering UI feature | backend route match |
|---|---|---|---|---|
| `/api/accelerator/applications` | assets/app.part9.js:13530 | 2 | AcceleratorPortal.submitApplication — Accelerator Apply form Submit button (also AcceleratorApp admin Apply tab) | /api/accelerator/applications |
| `/api/accelerator/applications/:X/documents` | assets/app.part9.js:36199 | 1 | AcceleratorApp.submitApplication — admin Accelerator Apply tab uploads PDF documents after submit | /api/accelerator/applications/:id/documents |
| `/api/accelerator/applications/:X/evaluate-batch` | assets/app.part9.js:35489 | 1 | AcceleratorApp.saveEvaluation — admin Accelerator Evaluation tab Save points button | /api/accelerator/applications/:appId/evaluate-batch |
| `/api/accelerator/applications/:X/full` | assets/app.part9.js:35038 | 2 | AcceleratorApp.viewApplication — admin Accelerator Applications tab View application detail modal | /api/accelerator/applications/:id/full |
| `/api/accelerator/applications/:X/message` | assets/app.part9.js:35180 | 1 | AcceleratorApp.sendMessage — admin Accelerator message applicant modal (#accMessageModal) Send | /api/accelerator/applications/:id/message |
| `/api/accelerator/applications/:X/validity` | assets/app.part9.js:35256 | 1 | AcceleratorApp.saveValidity — admin Accelerator application validity modal Save (#accValidityStatus) | /api/accelerator/applications/:id/validity |
| `/api/accelerator/ask-coordinator` | assets/app.part9.js:12609 | 1 | AcceleratorPortal.askCoordinator — Accelerator section Ask the coordinators form Send button (#axAskSend) | /api/accelerator/ask-coordinator |
| `/api/accelerator/checkout-session` | assets/app.part9.js:13606 | 1 | AcceleratorPortal.startPayment — Accelerator processing fee modal Pay button, Stripe checkout redirect | /api/accelerator/checkout-session |
| `/api/accelerator/countdown` | assets/app.part9.js:12809 | 1 | AcceleratorPortal.fetchCountdownTarget — Accelerator section deadline countdown widget on load | /api/accelerator/countdown |
| `/api/accelerator/criteria/:X` | assets/app.part9.js:35415 | 2 | AcceleratorApp.saveCriterion — admin Accelerator Evaluation tab edit criterion modal Save | /api/accelerator/criteria/:id |
| `/api/accelerator/dates/:X` | assets/app.part9.js:34317 | 5 | AcceleratorApp.inlineEditText — admin Accelerator Key Dates tab inline edit save (also delete date) | /api/accelerator/dates/:id |
| `/api/accelerator/files/grouped` | assets/app.part9.js:35911 | 1 | AcceleratorApp.loadGroupedFiles — admin Accelerator Files tab grouped documents list | /api/accelerator/files/grouped |
| `/api/accelerator/form-config` | assets/app.part9.js:36347 | 2 | AcceleratorApp.loadFormConfig — admin Accelerator Apply tab form preview (saveFormConfig PUTs it) | /api/accelerator/form-config |
| `/api/accelerator/institutions` | assets/app.part9.js:12651 | 2 | AcceleratorPortal.loadDynamicInstitutions — Accelerator section institution list on section load | /api/accelerator/institutions |
| `/api/accelerator/intake` | assets/app.part9.js:14305 | 1 | AcceleratorIntake.render — Accelerator intake panel window state (#ax-panel-intake) on load | /api/accelerator/intake |
| `/api/accelerator/intake/:X/submit` | assets/app.part9.js:14706 | 1 | AcceleratorIntake.submit — Accelerator intake form Submit button (#axiNext) | /api/accelerator/intake/:id/submit |
| `/api/accelerator/intake/:X/withdraw` | assets/app.part9.js:14768 | 1 | AcceleratorIntake.withdraw — Accelerator intake status card Withdraw link after confirmation | /api/accelerator/intake/:id/withdraw |
| `/api/accelerator/intake/draft` | assets/app.part9.js:14601 | 1 | AcceleratorIntake.saveDraft — Accelerator intake form autosave draft (#axiSaveInd indicator) | /api/accelerator/intake/draft |
| `/api/accelerator/intake/mine` | assets/app.part9.js:14310 | 1 | AcceleratorIntake.render — Accelerator intake panel my submissions on load | /api/accelerator/intake/mine |
| `/api/accelerator/interviewers/:X` | assets/app.part9.js:35584 | 2 | AcceleratorApp.saveInterviewer — admin Accelerator Interviewers tab edit interviewer modal Save | /api/accelerator/interviewers/:id |
| `/api/accelerator/interviewers/:X/regenerate-token` | assets/app.part9.js:35656 | 1 | AcceleratorApp.regenerateToken — admin Accelerator Interviewers tab Regenerate token button | /api/accelerator/interviewers/:id/regenerate-token |
| `/api/accelerator/interviewers/:X/send-link` | assets/app.part9.js:35637 | 1 | AcceleratorApp.sendMagicLink — admin Accelerator Interviewers tab Send magic link button | /api/accelerator/interviewers/:id/send-link |
| `/api/accelerator/key-dates` | assets/app.part9.js:12404 | 1 | AcceleratorPortal.loadPublicKeyDates — Accelerator section key dates timeline on section load | /api/accelerator/key-dates |
| `/api/accelerator/my-applications` | assets/app.part9.js:12556 | 2 | AcceleratorPortal.loadAppStatus — Accelerator application status strip (#axAppStatusStrip) on load | /api/accelerator/my-applications |
| `/api/accelerator/overview-config` | assets/app.part9.js:12454 | 1 | AcceleratorPortal.loadOverviewConfig — Accelerator section overview text from admin config on load | /api/accelerator/overview-config |
| `/api/accelerator/registrations` | assets/app.part9.js:35670 | 1 | AcceleratorApp.loadRegistrations — admin Accelerator registrations list and stats | /api/accelerator/registrations |
| `/api/accelerator/results` | assets/app.part9.js:13770 | 1 | AcceleratorPortal.unlockResults — Accelerator results lookup by AX26 code (#axResultsCode) Unlock button | /api/accelerator/results |
| `/api/accelerator/sites` | assets/app.part9.js:12522 | 1 | AcceleratorPortal.loadSites — Accelerator "Where you could go" host sites board (#axSitesGrid) | /api/accelerator/sites |
| `/api/accelerator/years` | assets/app.part9.js:34188 | 2 | AcceleratorApp.loadYears — admin Accelerator year selector (#accYearSelect) on init | /api/accelerator/years |
| `/api/accelerator/years/:X/applications` | assets/app.part9.js:34781 | 1 | AcceleratorApp.loadApplications — admin Accelerator Applications tab list | /api/accelerator/years/:year/applications |
| `/api/accelerator/years/:X/criteria` | assets/app.part9.js:35283 | 3 | AcceleratorApp.loadCriteria — admin Accelerator Evaluation tab criteria cards (#accCriteriaCards) | /api/accelerator/years/:year/criteria |
| `/api/accelerator/years/:X/dates` | assets/app.part9.js:34238 | 2 | AcceleratorApp.loadKeyDates — admin Accelerator Key Dates tab list and timeline | /api/accelerator/years/:year/dates |
| `/api/accelerator/years/:X/institutions` | assets/app.part9.js:34562 | 1 | AcceleratorApp.loadInstitutions — admin Accelerator Institutions tab list (#accInstitutionsList) | /api/accelerator/years/:year/institutions |
| `/api/accelerator/years/:X/institutions/:X` | assets/app.part9.js:34764 | 1 | AcceleratorApp.saveInstitutionDetails — admin Accelerator Institutions tab edit institution modal Save | /api/accelerator/years/:year/institutions/:instId |
| `/api/accelerator/years/:X/interviewers` | assets/app.part9.js:35499 | 2 | AcceleratorApp.loadInterviewers — admin Accelerator Interviewers tab list (#accInterviewersList) | /api/accelerator/years/:year/interviewers |
| `/api/accelerator/years/:X/pdf-settings` | assets/app.part9.js:35762 | 2 | AcceleratorApp.editPdfSettings — admin Accelerator Ranking tab PDF settings modal | /api/accelerator/years/:year/pdf-settings |
| `/api/accelerator/years/:X/publish-rankings` | assets/app.part9.js:35895 | 1 | AcceleratorApp.publishRankings — admin Accelerator Ranking tab Publish rankings button | /api/accelerator/years/:year/publish-rankings |
| `/api/accelerator/years/:X/update-rankings` | assets/app.part9.js:35752 | 1 | AcceleratorApp.updateRankings — admin Accelerator Ranking tab Update rankings button | /api/accelerator/years/:year/update-rankings |
| `/api/admin/forum/applications` | assets/app.part9.js:32426 | 1 | App.loadForumApplications — admin Forum Applications tab list | /api/admin/forum/applications |
| `/api/admin/forum/applications/:X` | assets/app.part9.js:32473 | 2 | App.approveForumApplication — admin Forum Applications tab Approve button (also Reject) | /api/admin/forum/applications/:id |
| `/api/admin/forum/bulk-email` | assets/app.part9.js:32399 | 1 | App.emailSelectedMembers — admin Forum Members tab Email selected members prompts | /api/admin/forum/bulk-email |
| `/api/admin/forum/events/af26/checkin` | assets/app.part9.js:33755 | 2 | App.processAF26Checkin — admin Forum AF26 Check-in tab check-in input (#af26CheckinInput) | /api/admin/forum/events/:id/checkin, /api/admin/forum/events/af26/checkin |
| `/api/admin/forum/events/af26/checkins` | assets/app.part9.js:33717 | 1 | App.loadAF26Checkins — admin Forum AF26 Check-in tab recent check-ins list | /api/admin/forum/events/af26/checkins |
| `/api/admin/forum/events/af26/invitations` | assets/app.part9.js:33888 | 1 | App.loadAF26Invites — admin Forum AF26 Invites tab list | /api/admin/forum/events/af26/invitations |
| `/api/admin/forum/events/af26/invitations/send` | assets/app.part9.js:33973 | 1 | App.sendAF26Invite — admin Forum AF26 Invites tab Send invite form | /api/admin/forum/events/af26/invitations/send |
| `/api/admin/forum/events/af26/invitations/send-all` | assets/app.part9.js:33942 | 1 | App.inviteAllForumMembers — admin Forum AF26 Invites tab Invite all members button | /api/admin/forum/events/af26/invitations/send-all |
| `/api/admin/forum/events/af26/registrations` | assets/app.part9.js:33360 | 1 | App.loadAF26Registrations — admin Forum AF26 Registrations tab list | /api/admin/forum/events/:id/registrations, /api/admin/forum/events/af26/registra |
| `/api/admin/forum/events/af26/registrations/:X` | assets/app.part9.js:33799 | 1 | App.confirmAF26Registration — admin Forum AF26 Registrations tab Confirm button | /api/admin/forum/events/af26/registrations/:id |
| `/api/admin/forum/events/af26/schedule` | assets/app.part9.js:33549 | 2 | App.loadAF26Schedule — admin Forum AF26 Schedule tab session list | /api/admin/forum/events/af26/schedule |
| `/api/admin/forum/events/af26/schedule/:X` | assets/app.part9.js:33672 | 2 | App.saveAF26Session — admin Forum AF26 Schedule tab edit session modal Save | /api/admin/forum/events/af26/schedule/:id |
| `/api/admin/forum/events/af26/settings` | assets/app.part9.js:33864 | 1 | App.saveAF26Settings — admin Forum AF26 Overview tab event settings Save | /api/admin/forum/events/af26/settings |
| `/api/admin/forum/events/af26/speakers` | assets/app.part9.js:33420 | 2 | App.loadAF26Speakers — admin Forum AF26 Speakers tab list | /api/admin/forum/events/af26/speakers |
| `/api/admin/forum/events/af26/speakers/:X` | assets/app.part9.js:33498 | 3 | App.saveAF26Speaker — admin Forum AF26 Speakers tab edit speaker modal Save (also delete) | /api/admin/forum/events/af26/speakers/:id |
| `/api/admin/forum/events/af26/stats` | assets/app.part9.js:33346 | 1 | App.loadAF26Overview — admin Forum AF26 Overview tab stat counters | /api/admin/forum/events/af26/stats |
| `/api/admin/forum/gallery/folders` | assets/app.part9.js:31695 | 1 | App.createGalleryFolder — admin Forum Gallery tab Create folder modal | /api/admin/forum/gallery/folders |
| `/api/admin/forum/groups` | assets/app.part9.js:31580 | 1 | App.createForumGroup — admin Forum Groups tab Create group prompts | /api/admin/forum/groups |
| `/api/admin/forum/invitations` | assets/app.part9.js:33245 | 1 | App.loadForumInvitations — admin Forum Invitations tab list and stats | /api/admin/forum/invitations |
| `/api/admin/forum/invitations/:X/resend` | assets/app.part9.js:33316 | 1 | App.resendInvitation — admin Forum Invitations tab Resend button | /api/admin/forum/invitations/:id/resend |
| `/api/admin/forum/invitations/send` | assets/app.part9.js:33045 | 1 | App.inviteProspect — admin Forum Prospects tab Send invitation button | /api/admin/forum/invitations/send |
| `/api/admin/forum/invitations/send-bulk` | assets/app.part9.js:33070 | 1 | App.inviteSelectedProspects — admin Forum Prospects tab Invite selected button | /api/admin/forum/invitations/send-bulk |
| `/api/admin/forum/media` | assets/app.part9.js:31756 | 1 | App.uploadGalleryMedia — admin Forum Gallery tab Upload media (#galleryFileInput) | /api/admin/forum/media |
| `/api/admin/forum/members` | assets/app.part9.js:31784 | 1 | App.loadForumMembers — admin Forum Members tab list, filters and stats | /api/admin/forum/members |
| `/api/admin/forum/members/:X` | assets/app.part9.js:31956 | 1 | App.removeForumMember — admin Forum Members tab Remove member button | /api/admin/forum/members/:id |
| `/api/admin/forum/notify-all` | assets/app.part9.js:32681 | 1 | App.sendNotifyAll — admin Forum Notify all members prompts Send to All | /api/admin/forum/notify-all |
| `/api/admin/forum/prospects` | assets/app.part9.js:32700 | 2 | App.loadForumProspects — admin Forum Prospects tab list | /api/admin/forum/prospects |
| `/api/admin/forum/prospects/:X` | assets/app.part9.js:32807 | 2 | App.saveProspect — admin Forum Prospects tab edit prospect modal Save (also delete) | /api/admin/forum/prospects/:id |
| `/api/admin/forum/prospects/import` | assets/app.part9.js:33011 | 1 | App.executeImport — admin Forum Prospects import modal Import button (#importNextBtn) | /api/admin/forum/prospects/:id, /api/admin/forum/prospects/import |
| `/api/admin/forum/prospects/preview` | assets/app.part9.js:32861 | 1 | App.previewImportFile — admin Forum Prospects import modal file preview (#prospectFile) | /api/admin/forum/prospects/:id, /api/admin/forum/prospects/preview |
| `/api/admin/forum/stats` | assets/app.part9.js:30793 | 1 | App.loadForumStats — admin Forum section stat counters | /api/admin/forum/stats |
| `/api/admin/forum/templates` | assets/app.part9.js:33087 | 2 | App.loadForumTemplates — admin Forum Templates tab list | /api/admin/forum/templates |
| `/api/admin/forum/templates/:X` | assets/app.part9.js:33166 | 2 | App.saveTemplate — admin Forum Templates tab edit template modal Save | /api/admin/forum/templates/:id |
| `/api/admin/plexus/:X/:X/approve` | assets/app.part9.js:30393 | 1 | App.approvePendingItem — admin Plexus Pending tab Approve button | only `/api/admin/plexus/volunteers/:id/approve\|reject` (:22925/:22932) exist |
| `/api/admin/plexus/:X/:X/reject` | assets/app.part9.js:30413 | 1 | App.rejectPendingItem — admin Plexus Pending tab Reject button after confirmation | only `/api/admin/plexus/volunteers/:id/approve\|reject` (:22925/:22932) exist |
| `/api/admin/plexus/abstracts` | assets/app.part9.js:29177 | 1 | App.loadPlexusAbstracts — admin Plexus Abstracts tab list | /api/admin/plexus/abstracts |
| `/api/admin/plexus/pending` | assets/app.part9.js:30354 | 1 | App.loadPlexusPending — admin Plexus Pending tab approval queue | /api/admin/plexus/pending |
| `/api/admin/plexus/registrations` | assets/app.part9.js:28887 | 1 | App.loadPlexusRegistrations — admin Plexus Registrations tab list | /api/admin/plexus/registrations |
| `/api/admin/plexus/speakers` | assets/app.part9.js:29679 | 1 | App.createSpeaker — admin Plexus Speakers tab Add speaker prompts | /api/admin/plexus/speakers |
| `/api/admin/plexus/speakers/:X/publish` | assets/app.part9.js:29652 | 1 | App.toggleSpeakerPublishUP — admin Plexus Speakers tab Publish/Unpublish button | /api/admin/plexus/speakers/:id/publish |
| `/api/admin/plexus/sponsor-tasks/:X` | assets/app.part9.js:30067 | 2 | App.toggleSponsorTask — admin Plexus Sponsors tab task checkbox (also delete task) | /api/admin/plexus/sponsor-tasks/:taskId |
| `/api/admin/plexus/sponsors` | assets/app.part9.js:29690 | 2 | App.loadPlexusSponsors — admin Plexus Sponsors tab pipeline list (also saveSponsor create) | /api/admin/plexus/sponsors |
| `/api/admin/plexus/sponsors/:X` | assets/app.part9.js:29999 | 2 | App.saveSponsor — admin Plexus Sponsors tab edit sponsor form Save (also delete) | /api/admin/plexus/sponsors/:id |
| `/api/admin/plexus/sponsors/:X/publish` | assets/app.part9.js:30039 | 1 | App.toggleSponsorPublish — admin Plexus Sponsors tab Publish toggle | /api/admin/plexus/sponsors/:id/publish |
| `/api/admin/plexus/sponsors/:X/tasks` | assets/app.part9.js:29697 | 2 | App.loadPlexusSponsors — admin Plexus Sponsors tab per-sponsor task lists (also add task) | /api/admin/plexus/sponsors/:id/tasks |
| `/api/admin/plexus/stats` | assets/app.part9.js:28803 | 2 | App.loadPlexusStats — admin Plexus section stat counters | /api/admin/plexus/stats |
| `/api/admin/plexus/volunteers` | assets/app.part9.js:30089 | 1 | App.loadPlexusVolunteers — admin Plexus Volunteers tab list | /api/admin/plexus/volunteers |
| `/api/admin/plexus/volunteers/:X/approve` | assets/app.part9.js:30123 | 1 | App.approveVolunteer — admin Plexus Volunteers tab Approve button | /api/admin/plexus/volunteers/:id/approve |
| `/api/admin/plexus/volunteers/:X/reject` | assets/app.part9.js:30141 | 1 | App.rejectVolunteer — admin Plexus Volunteers tab Reject button after confirmation | /api/admin/plexus/volunteers/:id/reject |
| `/api/af26/register` | assets/app.part9.js:16731 | 1 | AF26Portal.submitRegistration — AF26 Biomedical Forum registration form Submit (#af26Email) | /api/af26/register |
| `/api/announcements` | assets/app.part9.js:52728 | 1 | NotificationSystem.loadNotifications — notification center bell merges member announcements on load | /api/announcements |
| `/api/assistant/ask` | assets/app.part13.js:93 | 1 | MedXAssistant chat widget ask() — Send button or suggestion chip question | /api/assistant/ask |
| `/api/assistant/escalate` | assets/app.part13.js:77 | 1 | MedXAssistant chat widget connectRow — "Connect me with the team" hand-off button | /api/assistant/escalate |
| `/api/assistant/feedback` | assets/app.part13.js:62 | 1 | MedXAssistant chat widget feedbackRow vote — "Was this helpful?" Yes/No chips | /api/assistant/feedback |
| `/api/auth/account` | assets/app.part9.js:24103 | 1 | SettingsPortal.deleteAccount — Settings > Delete account button after confirmation | /api/auth/account |
| `/api/auth/change-password` | assets/app.part9.js:24010 | 1 | SettingsPortal.changePassword — Settings > Change password form submit | /api/auth/change-password |
| `/api/auth/forgot-password` | assets/app.part9.js:3828 | 1 | UserPortal.openForgotPassword — login form Forgot password link | /api/auth/forgot-password |
| `/api/auth/login` | assets/app.part9.js:3918 | 2 | UserPortal.login — login form Sign in button (#userLoginBtn) (also App admin login) | /api/auth/login |
| `/api/auth/me` | assets/app.part9.js:2255 | 3 | MyMedXPortal.loadPhoto — My MedX hero avatar portrait photo (#mymedxHeroAvatar), also MedXQuiet and UserPortal | /api/auth/me |
| `/api/auth/my-data` | assets/app.part9.js:24209 | 1 | SettingsPortal.downloadData — Settings > Privacy "Download my data" button | /api/auth/my-data |
| `/api/auth/register` | assets/app.part9.js:4166 | 2 | UserPortal.register — Create account form submit (#userRegisterBtn) | /api/auth/register |
| `/api/auth/request-verification` | assets/app.part9.js:3857 | 1 | UserPortal.resendVerification — resend verification email button (login error, step 3, soft-gate banner) | /api/auth/request-verification |
| `/api/bridges/apply` | assets/app.part9.js:19180 | 1 | BuildingBridgesPortal.submitApplication — Apply tab form, legacy fallback on transient failure | /api/bridges/apply |
| `/api/bridges/events` | assets/app.part9.js:18621 | 1 | BuildingBridgesPortal.loadEventsFromAPI — Building Bridges tab events list and hero stats on init | /api/bridges/events |
| `/api/bridges/events/:X/register` | assets/app.part9.js:19145 | 1 | BuildingBridgesPortal.submitApplication — Apply tab form submit, primary registration endpoint | /api/bridges/events/:id/register |
| `/api/bridges/program/:X` | assets/app.part9.js:30753 | 1 | App.deleteBridgesProgramItem — Admin Building Bridges program item Delete button (edit modal also PUTs) | /api/bridges/program/:id |
| `/api/bridges/program/:X/publish` | assets/app.part9.js:30758 | 1 | App.toggleBridgesProgramPublish — Admin Building Bridges program item publish/unpublish toggle | /api/bridges/program/:id/publish |
| `/api/bridges/speakers/:X` | assets/app.part9.js:30678 | 1 | App.deleteBridgesSpeaker — Admin Building Bridges speaker Delete button (edit modal also PUTs) | /api/bridges/speakers/:id |
| `/api/bridges/speakers/:X/publish` | assets/app.part9.js:30683 | 1 | App.toggleBridgesSpeakerPublish — Admin Building Bridges speaker publish/unpublish toggle | /api/bridges/speakers/:id/publish |
| `/api/channels` | assets/app.part9.js:25466 | 2 | App.loadChannels — Team portal chat channel list, auto-selects #general on homepage | /api/channels |
| `/api/chat/dm` | assets/app.part9.js:25798 | 1 | App.startDM — Team portal "Message" a member starts a direct-message channel | /api/chat/dm |
| `/api/chat/messages` | assets/app.part9.js:25489 | 5 | App.loadMessages — Team portal chat messages for the selected channel | /api/chat/messages |
| `/api/connections/:X/respond` | assets/app.part9.js:17879 | 2 | NetworkingPortal.acceptRequest — My Network connection request Accept button, legacy fallback | /api/connections/:id/respond |
| `/api/connections/request` | assets/app.part9.js:17567 | 3 | NetworkingPortal.connectFromProfile — profile modal Connect button (#profileConnectBtn), legacy fallback | /api/connections/request |
| `/api/dashboard/summary` | assets/app.part9.js:26809 | 1 | App.loadDashboardSummary — Team portal dashboard stat cards and badges | /api/dashboard/summary |
| `/api/feed` | assets/app.part9.js:47112 | 2 | MemberFeed.load — Member Home feed (#newsCompactList) flat fallback when /api/feed/home fails | /api/feed |
| `/api/feed/home` | assets/app.part9.js:47105 | 1 | MemberFeed.load — Member Home "Latest from Med&X" enriched feed (#newsCompactList) | /api/feed/home |
| `/api/files/:X` | assets/app.part9.js:28353 | 2 | App.uploadFile — Team portal project Files tab upload (fileUpload-<project> input) | /api/files/:id, /api/files/:project |
| `/api/finance/bank-balance` | assets/app.part9.js:36820 | 2 | FinanceApp.loadBankBalance — Finance > Bank Balance table (#finBankBalanceTable) | /api/finance/bank-balance |
| `/api/finance/bank-balance/:X` | assets/app.part9.js:36872 | 1 | FinanceApp.deleteBankBalance — Finance > Bank Balance entry Delete button | /api/finance/bank-balance/:id |
| `/api/finance/dashboard` | assets/app.part9.js:26869 | 2 | App.loadDashboardFinance — Team portal dashboard finance tiles (#dashFinBalance etc) | /api/finance/dashboard |
| `/api/finance/invoices` | assets/app.part9.js:37423 | 1 | FinanceApp.saveInvoice — Finance > Invoices modal Save (create new invoice) | /api/finance/invoices |
| `/api/finance/invoices/:X` | assets/app.part9.js:37421 | 2 | FinanceApp.saveInvoice — Finance > Invoices modal Save (update existing invoice) | /api/finance/invoices/:id |
| `/api/finance/invoices/:X/issue` | assets/app.part9.js:37440 | 1 | FinanceApp.issueInvoice — Finance > Invoices "Issue" action after confirm | /api/finance/invoices/:id/issue |
| `/api/finance/invoices/:X/mark-paid` | assets/app.part9.js:37454 | 1 | FinanceApp.markInvoicePaid — Finance > Invoices "Mark Paid" action after confirm | /api/finance/invoices/:id/mark-paid |
| `/api/finance/my-travel-orders` | assets/app.part9.js:26884 | 1 | App.loadMyTravelOrders — Team portal dashboard "My travel orders" section (#myTravelOrdersList) | /api/finance/my-travel-orders |
| `/api/finance/payment-orders` | assets/app.part9.js:37497 | 2 | FinanceApp.loadPaymentOrders — Finance > Payment Orders table (#finPaymentOrdersTable) | /api/finance/payment-orders |
| `/api/finance/payment-orders/:X` | assets/app.part9.js:37537 | 3 | FinanceApp.editPaymentOrder — Finance > Payment Orders Edit opens prefilled modal | /api/finance/payment-orders/:id |
| `/api/finance/reports/by-project` | assets/app.part9.js:37781 | 1 | FinanceApp.loadReports — Finance > Reports tab by-project breakdown | /api/finance/reports/by-project |
| `/api/finance/reports/by-work-unit` | assets/app.part9.js:37782 | 1 | FinanceApp.loadReports — Finance > Reports tab by-work-unit breakdown | /api/finance/reports/by-work-unit |
| `/api/finance/reports/monthly` | assets/app.part9.js:37783 | 1 | FinanceApp.loadReports — Finance > Reports tab monthly breakdown | /api/finance/reports/monthly |
| `/api/finance/settings` | assets/app.part9.js:37859 | 2 | FinanceApp.loadSettings — Finance > Settings tab company fields (#finSettingCompanyName etc) | /api/finance/settings |
| `/api/finance/transactions` | assets/app.part9.js:37004 | 2 | FinanceApp.saveTransaction — Finance > Transactions modal Save (create new) | /api/finance/transactions |
| `/api/finance/transactions/:X` | assets/app.part9.js:36971 | 3 | FinanceApp.editTransaction — Finance > Transactions Edit opens prefilled modal (also PUT/DELETE) | /api/finance/transactions/:id |
| `/api/finance/travel-orders` | assets/app.part9.js:37671 | 1 | FinanceApp.saveTravelOrder — Finance > Travel Orders modal Create | /api/finance/travel-orders |
| `/api/finance/travel-orders/:X` | assets/app.part9.js:37677 | 1 | FinanceApp.viewTravelOrder — Finance > Travel Orders row opens detail modal | /api/finance/travel-orders/:id |
| `/api/finance/travel-orders/:X/approve` | assets/app.part9.js:37736 | 1 | FinanceApp.approveTravelOrder — travel order detail modal Approve button | /api/finance/travel-orders/:id/approve |
| `/api/finance/travel-orders/:X/pay` | assets/app.part9.js:37768 | 1 | FinanceApp.payTravelOrder — travel order detail modal "Mark Paid" button | /api/finance/travel-orders/:id/pay |
| `/api/finance/travel-orders/:X/reject` | assets/app.part9.js:37750 | 1 | FinanceApp.rejectTravelOrder — travel order detail modal Reject with reason prompt | /api/finance/travel-orders/:id/reject |
| `/api/finance/work-units` | assets/app.part9.js:37029 | 2 | FinanceApp.loadWorkUnits — Finance > Work Units table and transaction modal dropdown | /api/finance/work-units |
| `/api/finance/work-units/:X` | assets/app.part9.js:37226 | 3 | FinanceApp.editWorkUnit — Finance > Work Units Edit opens prefilled modal (also PUT/DELETE) | /api/finance/work-units/:id |
| `/api/finance/years` | assets/app.part9.js:36583 | 1 | FinanceApp.loadYears — Finance fiscal year selector (#finYearSelector) | /api/finance/years |
| `/api/finance/years/:X` | assets/app.part9.js:37847 | 1 | FinanceApp.closeYear — Finance "Close Fiscal Year" button after confirm | /api/finance/years/:year |
| `/api/folders/:X` | assets/app.part9.js:28403 | 2 | App.createFolder — Team portal project Files "New Folder" prompt | /api/folders/:id, /api/folders/:project |
| `/api/forum/events` | assets/app.part9.js:31166 | 1 | App.loadForumEvents — Team portal Forum events tab upcoming events list | /api/forum/events |
| `/api/forum/events/:X` | assets/app.part9.js:15322 | 1 | ForumPortal.toggleEventDetails — Forum timeline event expand enriches detail view | /api/forum/events/:id |
| `/api/forum/events/:X/checkout-session` | assets/app.part9.js:15184 | 2 | ForumPortal.completeRegistration — Forum event registration modal, paid event redirect to Stripe | /api/forum/events/:id/checkout-session |
| `/api/forum/events/:X/register` | assets/app.part9.js:5073 | 4 | openAnonymousForumRegistration — logged-out ?event= forum registration overlay (#afrForm) submit | /api/forum/events/:id/register |
| `/api/forum/gallery/folders[?parent_id=]` | assets/app.part9.js:31599 | 1 | App.loadForumGallery — Team portal Forum gallery folder listing | `/api/forum/gallery/folders` (:17606) |
| `/api/forum/gallery/folders/:X` | assets/app.part9.js:31655 | 1 | App.navigateGalleryFolder — Forum gallery folder click builds breadcrumbs | /api/forum/gallery/folders/:id |
| `/api/forum/groups` | assets/app.part9.js:31389 | 1 | App.loadForumGroups — Team portal Forum groups tab list | /api/forum/groups |
| `/api/forum/groups/:X/members` | assets/app.part9.js:31453 | 1 | App.loadGroupMembers — group detail modal member list (#groupMemberList) | /api/forum/groups/:id/members |
| `/api/forum/groups/:X/membership` | assets/app.part9.js:31539 | 1 | App.toggleGroupMembership — Forum group Join/Leave button | /api/forum/groups/:id/membership |
| `/api/forum/groups/:X/messages` | assets/app.part9.js:31473 | 2 | App.loadGroupMessages — group detail modal chat, polled every 5s (also POST send) | /api/forum/groups/:id/messages |
| `/api/forum/media[?folder_id=]` | assets/app.part9.js:31600 | 1 | App.loadForumGallery — Team portal Forum gallery media grid | `/api/forum/media` (:17584) |
| `/api/forum/opportunities` | assets/app.part9.js:15443 | 1 | ForumPortal.submitOpportunity — Forum opportunity board post form (#fmOppTitle) submit | /api/forum/opportunities |
| `/api/forum/posts` | assets/app.part9.js:30925 | 2 | App.loadForumPosts — Team portal Forum posts tab list | /api/forum/posts |
| `/api/forum/posts/:X/react` | assets/app.part9.js:31011 | 1 | App.likeForumPost — Forum post heart/like button | /api/forum/posts/:id/react |
| `/api/forum/wing/convenings` | forum-wing.html:737 | 2 | Wing.renderHome — forum-wing Home view convenings summary (#homeConvenings) | /api/forum/wing/convenings |
| `/api/forum/wing/convenings/:X/reserve` | forum-wing.html:842 | 1 | Wing.reserve — forum-wing Convenings "Reserve my place" button with segment ticks | /api/forum/wing/convenings/:id/reserve |
| `/api/forum/wing/directory?<qs>` | forum-wing.html:757 | 1 | Wing.loadDirectory — forum-wing Directory view search/filter query | `/api/forum/wing/directory` (:4349) |
| `/api/forum/wing/me` | forum-wing.html:681 | 2 | Wing.boot — forum-wing page boot, decides enterWing vs access screen | /api/forum/wing/me |
| `/api/forum/wing/request-link` | forum-wing.html:1006 | 1 | Wing.requestLink — forum-wing access screen "Send link" magic-link email (#lkBtn) | /api/forum/wing/request-link |
| `/api/gala/checkout-session` | assets/app.part9.js:12020 | 1 | GalaPortal.startPayment — Gala registration status card Pay button redirects to Stripe | /api/gala/checkout-session |
| `/api/gala/my` | assets/app.part9.js:1020 | 1 | MyMedXPortal._loadMemberData — My Med&X wallet gala tickets (#mymedxQRCodes) | /api/gala/my |
| `/api/gala/my-seat` | assets/app.part9.js:1022 | 2 | MyMedXPortal._loadMemberData — My Med&X wallet gala table/seat (also GalaPortal) | /api/gala/my-seat |
| `/api/gala/my-status` | assets/app.part9.js:11930 | 1 | GalaPortal.checkMyStatus — Gala tab registration status on load | /api/gala/my-status |
| `/api/gala/register` | assets/app.part9.js:12152 | 1 | GalaPortal.submitRegistration — Gala registration form submit (galaFirstName etc) | /api/gala/register |
| `/api/gala/settings` | assets/app.part9.js:11795 | 1 | GalaPortal.loadSettings — Gala tab public settings (date, venue, pricing) on load | /api/gala/settings |
| `/api/guest-passes` | assets/app.part12.js:73 | 3 | GuestPass.renderEventCard — "Bring a colleague" guest pass card per event (also POST send) | /api/guest-passes |
| `/api/guest-passes/:X/revoke` | assets/app.part12.js:157 | 1 | GuestPass.revoke — guest pass row Revoke button after confirm | /api/guest-passes/:id/revoke |
| `/api/intro-requests` | assets/app.part9.js:47731 | 1 | DirectoryPowerups.submitIntro — "Request an intro" modal Send request button (#introSend) | /api/intro-requests |
| `/api/me` | forum-wing.html:657 | 2 | forum-wing.html WingI18n.setLocale — language toggle PATCHes profile locale (also MedXI18n.persistServer) | /api/me |
| `/api/me/locale` | assets/app.part1.js:1936 | 1 | MedXI18n.hydrateFromServer — boot adopts profile's saved locale when device has none | /api/me/locale |
| `/api/member-card-visibility` | assets/app.part9.js:41 | 1 | MemberLinkCard._loadVisibility — admin toggle for member link card on Plexus/Gala pages | /api/member-card-visibility |
| `/api/member/card-consent` | assets/app.part9.js:3071 | 1 | ImAttendingCard._syncConsent — "I'm attending" card download records photo consent | /api/member/card-consent |
| `/api/member/founder-welcome` | assets/app.part9.js:3239 | 1 | FounderWelcome.afterOnboarding — first-login founder note shown after onboarding | /api/member/founder-welcome |
| `/api/member/founder-welcome/seen` | assets/app.part9.js:3254 | 1 | FounderWelcome.dismiss — founder welcome banner dismiss marks seen | /api/member/founder-welcome/seen |
| `/api/member/giving` | assets/app.part9.js:987 | 1 | MyMedXPortal.renderGiving — My Med&X supporter thank-you card and Supporter chip | /api/member/giving |
| `/api/member/meta` | index.html:2903 | 2 | MedXDashSnapshot.load — Home dashboard snapshot "Member since" tile (#dsSince) | /api/member/meta |
| `/api/member/passport` | assets/app.part9.js:1995 | 1 | MyMedXPortal.loadPassport — member link card flip reveals passport stamps | /api/member/passport |
| `/api/member/profile-nudge` | assets/app.part5.js:14 | 1 | MedXProfileNudge.render — Home "add a photo" profile nudge (#upProfileNudge) | /api/member/profile-nudge |
| `/api/member/profile-nudge/dismiss` | assets/app.part5.js:34 | 1 | MedXProfileNudge.dismiss — profile nudge close (x) button | /api/member/profile-nudge/dismiss |
| `/api/member/record` | assets/app.part9.js:1113 | 1 | MyMedXPortal.renderRecord — My Med&X "My Record" wall of events/certificates (#mymedxRecord) | /api/member/record |
| `/api/member/search` | assets/app.part3.js:66 | 1 | GlobalSearch._run — global search spotlight (#upSearchOverlay) debounced query | /api/member/search |
| `/api/member/share-record-link` | assets/app.part9.js:1331 | 1 | MyMedXPortal.shareRecord — My Record "Share" copies read-only /r/:token link | /api/member/share-record-link |
| `/api/member/verify-link` | assets/app.part9.js:1349 | 1 | MyMedXPortal._fetchVerifyLink — "Share your membership" verify link and LinkedIn credential | /api/member/verify-link |
| `/api/member/wallet/apple/ticket/:X` | assets/app.part9.js:2213 | 1 | MyMedXPortal.addTicketToAppleWallet — ticket "Add to Apple Wallet" (flag off, dormant) | /api/member/wallet/apple/ticket/:regId |
| `/api/member/wallet/google` | assets/app.part9.js:2046 | 1 | MyMedXPortal.addToGoogleWallet — membership card "Save to Google Wallet" button | /api/member/wallet/google |
| `/api/member/wallet/google/ticket/:X` | assets/app.part9.js:2187 | 1 | MyMedXPortal.addTicketToGoogleWallet — event ticket "Save to Google Wallet" button | /api/member/wallet/google/ticket/:regId |
| `/api/member/wrapped` | assets/app.part9.js:2494 | 1 | MyMedXPortal.openWrapped — My Med&X "Wrapped" year card generator | /api/member/wrapped |
| `/api/mentorship/mentors` | assets/app.part9.js:47423 | 1 | Mentorship.load — My Network > Mentorship tab mentor list | /api/mentorship/mentors |
| `/api/mentorship/profile` | assets/app.part9.js:47422 | 2 | Mentorship.load — My Network > Mentorship tab my mentor/mentee profile (also save) | /api/mentorship/profile |
| `/api/mentorship/requests` | assets/app.part9.js:47424 | 3 | Mentorship.load — My Network > Mentorship tab requests list (also POST request) | /api/mentorship/requests |
| `/api/mentorship/requests/:X` | assets/app.part9.js:47627 | 1 | Mentorship.respond — mentorship request Accept/Decline/End buttons | /api/mentorship/requests/:id |
| `/api/messages` | assets/app.part9.js:17180 | 2 | NetworkingPortal.loadConversationsList — My Network > Messages tab inbox and chat polling | /api/messages |
| `/api/messages/:X` | assets/app.part9.js:17183 | 2 | NetworkingPortal.pollCurrentChat — Messages tab open chat polling for new messages | /api/messages/:userId |
| `/api/my/events` | assets/app.part9.js:911 | 1 | MyMedXPortal.renderMyEvents — My Med&X upcoming registrations cards with QR ticket (#mymedxMyEvents) | /api/my/events |
| `/api/networking/coffee-match` | assets/app.part9.js:17995 | 1 | NetworkingPortal.loadCoffeeMatch — Discover panel monthly coffee matchmaker banner (#coffeeMatchWrap) | /api/networking/coffee-match |
| `/api/networking/connections` | assets/app.part9.js:859 | 7 | NetworkActions.sendConnectionRequest — dashboard networking widget Connect button | /api/networking/connections |
| `/api/networking/connections/:X` | assets/app.part9.js:839 | 3 | NetworkActions.acceptConnection — dashboard networking widget Accept request button | /api/networking/connections/:id |
| `/api/networking/connections/pending` | assets/app.part9.js:16869 | 1 | NetworkingPortal.loadPendingRequests — Requests tab pending connection requests grid (#requestsGrid) | /api/networking/connections/:id, /api/networking/connections/pending |
| `/api/networking/discover` | assets/app.part9.js:16955 | 1 | NetworkingPortal.loadDiscover — Discover tab member suggestions list | /api/networking/discover |
| `/api/networking/meeting-requests` | assets/app.part9.js:18030 | 2 | NetworkingPortal.loadMeetingRequests — meeting requests grid (#meetingRequestsGrid) | /api/networking/meeting-requests |
| `/api/networking/meeting-requests/:X` | assets/app.part9.js:18087 | 2 | NetworkingPortal.acceptMeetingRequest — Accept button on incoming meeting request card | /api/networking/meeting-requests/:id |
| `/api/networking/profile` | assets/app.part9.js:18424 | 1 | NetworkingPortal.saveProfile — networking profile settings save (coffee chats, collaborators, matchmaker opt-in) | /api/networking/profile |
| `/api/notify-topics` | assets/app.part7.js:19 | 5 | MedXNotify.toggle — "Notify me" switch on project section heroes (Plexus, Gala, etc) | /api/notify-topics |
| `/api/opportunities` | assets/app.part9.js:47399 | 1 | OpportunityBoard.submit — Share an opportunity form submit button (#oppSubmitBtn) | /api/opportunities |
| `/api/opportunities?<qs>` | assets/app.part9.js:47267 | 1 | OpportunityBoard.load — Opportunities board grid with kind filter (#oppGrid) | `/api/opportunities` (:13977) |
| `/api/org/signature` | assets/app.part9.js:1258 | 1 | MyMedXPortal.downloadCertificate — My Record certificate download fetches org signature | /api/org/signature |
| `/api/pinned` | assets/app.part9.js:26343 | 2 | App.loadPinnedItems — admin team app pinned items sidebar load | /api/pinned |
| `/api/pinned/:X` | assets/app.part9.js:26502 | 1 | App.unpinItem — admin team app unpin item button | /api/pinned/:id |
| `/api/pinned/reorder` | assets/app.part9.js:26465 | 1 | App.savePinnedItemsOrder — admin team app drag-reorder pinned items | /api/pinned/:id, /api/pinned/reorder |
| `/api/plexus/abstracts` | assets/app.part9.js:10138 | 1 | PlexusPortal.submitAbstract — Plexus abstract submission form Submit button | /api/plexus/abstracts |
| `/api/plexus/abstracts/:X/files` | assets/app.part9.js:10166 | 1 | PlexusPortal.submitAbstract — link uploaded file to submitted abstract | /api/plexus/abstracts/:id/files |
| `/api/plexus/attendees` | assets/app.part9.js:9153 | 1 | PlexusPortal.loadAttendees — Plexus Connect tab attendees grid (#plexusAttendeesGrid) | /api/plexus/attendees |
| `/api/plexus/checkin` | assets/app.part9.js:30326 | 1 | App.performCheckin — admin Plexus check-in by registration ID or QR (#pxCheckinInput) | /api/plexus/checkin |
| `/api/plexus/checkout-session` | assets/app.part9.js:9727 | 1 | PlexusPortal.redirectToStripeCheckout — card payment redirect after Plexus registration | /api/plexus/checkout-session |
| `/api/plexus/cme/attach` | assets/app.part9.js:8870 | 1 | PlexusPortal._attachCMEIfNeeded — attach physician CME record after registration succeeds | /api/plexus/cme/attach |
| `/api/plexus/cme/my` | assets/app.part9.js:951 | 1 | MyMedXPortal.renderMyCme — My Med&X own CME record card (#mymedxCme) | /api/plexus/cme/my |
| `/api/plexus/cme/status` | assets/app.part9.js:8839 | 1 | PlexusPortal.loadCMEStatus — registration form physician CME section visibility (#pxCmeSection) | /api/plexus/cme/status |
| `/api/plexus/qa` | assets/app.part9.js:45232 | 2 | LiveQA.load — Plexus live Q&A question list with 25s polling (#qaList) | /api/plexus/qa |
| `/api/plexus/questions/:X/upvote` | assets/app.part9.js:45259 | 1 | LiveQA.vote — live Q&A question upvote button | /api/plexus/questions/:id/upvote |
| `/api/plexus/register` | assets/app.part9.js:9634 | 1 | PlexusPortal.submitRegistration — Plexus registration form submit (#pxSubmitRegBtn) | /api/plexus/register |
| `/api/plexus/registration/:X/invoice` | assets/app.part9.js:9663 | 4 | PlexusPortal.submitRegistration — already-registered check of paid status | /api/plexus/registration/:id/invoice |
| `/api/plexus/registration/:X/refund` | assets/app.part9.js:11430 | 1 | PlexusPortal.submitRefundRequest — Plexus refund request form (#refundReason) | /api/plexus/registration/:regId/refund |
| `/api/plexus/registration/:X/transfer` | assets/app.part9.js:11403 | 1 | PlexusPortal.submitTicketTransfer — Plexus ticket transfer to colleague form (#transferEmail) | /api/plexus/registration/:regId/transfer |
| `/api/plexus/schedule` | assets/app.part9.js:29431 | 1 | App.loadPlexusSchedule — admin Schedule Builder read-only calendar grid | /api/plexus/schedule |
| `/api/plexus/scholarship` | assets/app.part9.js:11452 | 1 | PlexusPortal.submitScholarship — Plexus scholarship application form (#scholarshipType) | /api/plexus/scholarship |
| `/api/plexus/sessions` | assets/app.part14.js:318 | 2 | PlexusLiveBoard pollSchedule — live board 60s schedule change poll | /api/plexus/sessions |
| `/api/plexus/settings` | assets/app.part9.js:8777 | 1 | PlexusPortal.loadPlexusSettings — Plexus page pricing, key dates, testimonials load | /api/plexus/settings |
| `/api/plexus/speakers` | assets/app.part9.js:8893 | 1 | PlexusPortal.loadSpeakersFromDB — Plexus speakers section load | /api/plexus/speakers |
| `/api/plexus/stats` | assets/app.part9.js:8979 | 1 | PlexusPortal.loadRegistrationCount — Connect section participant count (#pxParticipantCount) | /api/plexus/stats |
| `/api/plexus/stripe-config` | assets/app.part9.js:10282 | 1 | PlexusPortal.initStripe — Stripe client init for card payment | /api/plexus/stripe-config |
| `/api/plexus/visa-request` | assets/app.part9.js:11484 | 1 | PlexusPortal.submitVisaRequest — Plexus visa invitation letter request form (#visaFullName) | /api/plexus/visa-request |
| `/api/portal-content/published` | assets/app.part9.js:46840 | 1 | SharedData.fetchDynamicContent — news feed dynamic content on init | /api/portal-content/published |
| `/api/portal-content/published/featured` | assets/app.part9.js:5563 | 1 | FeaturedCarousel.loadFromAPI — home featured carousel slides (#featuredCarouselTrack) | /api/portal-content/published/:section |
| `/api/pr/ai-generations` | assets/app.part9.js:39538 | 3 | PRApp.loadAiHistory — PR AI Studio generation history (#prAiHistory) | /api/pr/ai-generations |
| `/api/pr/ai-generations/:X/use` | assets/app.part9.js:39614 | 1 | PRApp.markUsed — PR AI Studio history Mark used button | /api/pr/ai-generations/:id/use |
| `/api/pr/calendar` | assets/app.part9.js:39094 | 1 | PRApp.saveContent — PR content calendar Schedule Content modal save (#prContentModal) | /api/pr/calendar |
| `/api/pr/calendar/:X` | assets/app.part9.js:39062 | 2 | PRApp.editContent — PR content calendar edit item modal | /api/pr/calendar/:id |
| `/api/pr/campaigns` | assets/app.part9.js:39455 | 1 | PRApp.saveCampaign — PR New Campaign modal save (#prCampaignModal) | /api/pr/campaigns |
| `/api/pr/campaigns/:X` | assets/app.part9.js:39426 | 2 | PRApp.editCampaign — PR campaign edit modal load | /api/pr/campaigns/:id |
| `/api/pr/dashboard` | assets/app.part9.js:38906 | 1 | PRApp.loadDashboard — PR dashboard stats tiles (#prDashPosts) | /api/pr/dashboard |
| `/api/pr/media` | assets/app.part9.js:39360 | 1 | PRApp.uploadMedia — PR media library upload form (#prUploadFile) | /api/pr/media |
| `/api/pr/media/:X` | assets/app.part9.js:39294 | 2 | PRApp.viewMedia — PR media library asset click lightbox | /api/pr/media/:id |
| `/api/pr/newsletters` | assets/app.part9.js:39240 | 1 | PRApp.saveNewsletter — PR Create Newsletter modal save (#prNewsletterModal) | /api/pr/newsletters |
| `/api/pr/newsletters/:X` | assets/app.part9.js:39215 | 2 | PRApp.editNewsletter — PR newsletter edit modal load | /api/pr/newsletters/:id |
| `/api/pr/newsletters/:X/send` | assets/app.part9.js:39257 | 1 | PRApp.sendNewsletter — PR newsletter Send button with confirmation | /api/pr/newsletters/:id/send |
| `/api/pr/posts` | assets/app.part9.js:39163 | 1 | PRApp.savePost — PR log social post modal save (#prPostModal) | /api/pr/posts |
| `/api/pr/subscribers` | assets/app.part9.js:39513 | 1 | PRApp.saveSubscriber — PR add subscriber modal save (#prSubscriberModal) | /api/pr/subscribers |
| `/api/pr/subscribers/:X/unsubscribe` | assets/app.part9.js:39528 | 1 | PRApp.unsubscribe — PR subscriber list Unsubscribe button | /api/pr/subscribers/:id/unsubscribe |
| `/api/project-status` | assets/app.part8.js:10 | 2 | MedXSectionStatus.refresh — project status labels on section heroes ([data-mx-status]) on load | /api/project-status |
| `/api/projects/:X/settings` | assets/app.part9.js:25119 | 1 | App.saveProjectSettings — admin project settings form save (dates, venue, location) | /api/projects/:project/settings |
| `/api/projects/settings` | assets/app.part9.js:25039 | 1 | App.loadProjectSettings — admin team app project dates load on showApp | /api/projects/settings |
| `/api/public-events/register` | forum-wing.html:888 | 1 | Wing.beyondReserve — forum wing Beyond card one-click Building Bridges reserve | /api/public-events/register |
| `/api/public/forum-consideration` | forum-wing.html:1022 | 1 | Wing.requestConsideration — forum wing Submit for consideration form (#rcBtn) | /api/public/forum-consideration |
| `/api/purchases/inquiry` | assets/app.part9.js:2394 | 1 | MyMedXPortal.submitPurchaseInquiry — My Med&X purchase inquiry/refund modal send (#mmxInquirySend) | /api/purchases/inquiry |
| `/api/push/subscribe` | assets/app.part9.js:52395 | 1 | MedXPush._persist — save push subscription after enabling notifications or SW re-subscribe | /api/push/subscribe |
| `/api/push/unsubscribe` | assets/app.part9.js:52444 | 1 | MedXPush.unsubscribe — push notifications toggle off | /api/push/unsubscribe |
| `/api/push/vapid-key` | sw.js:167 | 2 | sw.js pushsubscriptionchange re-subscribe with current VAPID key | /api/push/vapid-key |
| `/api/register-direct/:X` | assets/app.part9.js:53573 | 2 | showDirectRegistrationForm — ?register= token direct registration page on boot (UserPortal.init) | /api/register-direct/:token |
| `/api/registrations/my` | assets/app.part4.js:13 | 4 | MedXNextEvent.render — home greeting hero Your next event (#upNextEvent) | /api/registrations/:id, /api/registrations/my |
| `/api/rewards/redeem` | assets/app.part9.js:704 | 1 | RewardsPortal.confirmRedeem — Rewards redeem points confirmation modal (#rw2ConfirmBtn) | /api/rewards/redeem |
| `/api/rewards/summary` | index.html:2901 | 3 | MedXDashSnapshot.load — home dashboard snapshot tiles points balance (index.html inline) | /api/rewards/summary |
| `/api/search` | assets/app.part9.js:27546 | 1 | App.handleSearch — admin team app search box results (#searchResults) | /api/search |
| `/api/sequences` | assets/app.part9.js:27706 | 2 | App.loadSequences — admin team app Sequence tasks list | /api/sequences |
| `/api/sequences/:X` | assets/app.part9.js:27969 | 1 | App.deleteSequence — sequence Delete button with confirmation | /api/sequences/:id |
| `/api/sequences/:X/steps/:X/complete` | assets/app.part9.js:27947 | 1 | App.completeSequenceStep — view sequence modal step complete button | /api/sequences/:seqId/steps/:stepId/complete |
| `/api/speakers/:X/documents` | assets/app.part9.js:20470 | 2 | SpeakerPortal.uploadDocument — speaker portal event document upload | /api/speakers/:id/documents |
| `/api/speakers/:X/documents/:X` | assets/app.part9.js:21741 | 1 | SpeakerPortal.deleteDocument — speaker portal document delete | /api/speakers/:id/documents/:docId |
| `/api/speakers/auth` | assets/app.part9.js:20079 | 1 | SpeakerPortal.verifyInviteCode — speaker invite code form (#spInviteCode) | /api/speakers/auth |
| `/api/talks` | assets/app.part9.js:47842 | 1 | TalkLibrary.init — Talk Library past-session grid (#talksGrid) | /api/talks |
| `/api/talks/:X/rating` | assets/app.part9.js:47997 | 1 | TalkLibrary.rate — talk card star rating tap | /api/talks/:id/rating |
| `/api/tasks` | assets/app.part9.js:27330 | 2 | App.addSubtask — task modal add subtask (#newSubtaskTitle) | /api/tasks |
| `/api/tasks/:X` | assets/app.part9.js:26964 | 4 | App.loadAllTasks — admin team app per-project task lists load | /api/tasks/:id, /api/tasks/:project |
| `/api/tasks/:X/files` | assets/app.part9.js:27489 | 1 | App.saveTask — task modal save uploads pending attachments | /api/tasks/:id/files |
| `/api/tasks/:X/toggle` | assets/app.part9.js:27136 | 2 | App.toggleTask — task list checkbox toggle done | /api/tasks/:id/toggle |
| `/api/tasks/files/:X` | assets/app.part9.js:27437 | 1 | App.removeTaskFile — task modal Remove file button with confirmation | /api/tasks/files/:fileId |
| `/api/team` | assets/app.part9.js:25446 | 3 | App.loadTeamMember — auto-create team member record when none exists on login | /api/team |
| `/api/team/me` | assets/app.part9.js:25439 | 1 | App.loadTeamMember — admin team app current member role (#userRole) | /api/team/me |
| `/api/timeline/:X` | assets/app.part9.js:26793 | 3 | App.markTimelineEventComplete — timeline event Mark as Completed confirmation | /api/timeline/:project |
| `/api/timeline/:X/:X` | assets/app.part9.js:28130 | 2 | App.saveTimelineEvent — timeline event edit modal save | /api/timeline/:project/:id |
| `/api/upload/abstracts` | assets/app.part9.js:10154 | 1 | PlexusPortal.submitAbstract — abstract file upload (#pxAbstractFile) | /api/upload/:type |
| `/api/upload/accelerator` | assets/app.part9.js:14677 | 1 | AcceleratorIntake.onPdfPicked — accelerator intake PDF upload zone (#axiPdfInput) | /api/upload/:type |
| `/api/user-notifications` | assets/app.part9.js:6872 | 4 | Dashboard.toggleNotifications — hub bell notification panel open loads latest 10 | /api/user-notifications |
| `/api/user-notifications/:X/read` | assets/app.part9.js:6975 | 4 | Dashboard.handleNotificationClick — notification item click marks read | /api/user-notifications/:id/read |
| `/api/user-notifications/mark-all-read` | assets/app.part9.js:6954 | 2 | Dashboard.markAllNotificationsRead — notification panel Mark all read button | /api/user-notifications/mark-all-read |
| `/api/user/admin-messages` | assets/app.part9.js:17184 | 2 | NetworkingPortal.openAdminMessages — Messages tab Med&X Team admin conversation | /api/user/admin-messages |
| `/api/user/admin-messages/:X/read` | assets/app.part9.js:53084 | 1 | NotificationSystem.openAdminMessage — notification center admin message open marks read | /api/user/admin-messages/:id/read |
| `/api/user/admin-messages/:X/reply` | assets/app.part9.js:17185 | 2 | NetworkingPortal.replyToAdmin — Messages tab reply to admin message (#networkChatInput) | /api/user/admin-messages/:id/reply |


### 4.2 External hrefs / URLs in the member frontend (104 distinct; grouped by host, first occurrence)

- **Scripts/styles actually loaded:** `https://js.stripe.com/v3/` (`index.html:39`, async); `https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js` (`index.html:35`, SRI `sha384-ZZ1pncU3…`; also lazily injected at `app.part9.js:1857`); `https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js` (lazy fallback `app.part9.js:1856`, only if the vendored `/vendor/qrcode/qrcode.min.js` from `index.html:34` is missing); Google Fonts Inter + Fraunces (`index.html:24–25`, `forum-wing.html:10–12`, `app.part9.js:1275`, preconnect `fonts.gstatic.com`); `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css` (`app.part9.js:10997`; the page itself uses vendored `/vendor/fontawesome/css/all.min.css`, `index.html:26`); vendored `/vendor/jsqr/jsQR.min.js` (`index.html:38`).
- **Med&X properties:** `https://medx-admin-portal.onrender.com` (`app.part9.js:3693`, admin link-out), `https://medx-website-preview.netlify.app` (`index.html:2439`, nav link), `https://medx.hr` (`index.html:7024`), `https://www.medx.hr/` (`app.part9.js:27627`), `https://medx.hr/forum/apply?code=ABC123` (`app.part9.js:33210`, sample copy), `https://plexus.medx.hr` (`app.part9.js:44871`), social footers `linkedin.com/company/medx` `:971`, `instagram.com/medx.hr` `:972`, `www.instagram.com/medx.hr/` `:979`, `www.linkedin.com/company/medx-hr/` `:980`, `x.com/MedXhr` `:981`, `www.facebook.com/medx.hr/` `:982`, `www.youtube.com/@medxhr` `:983`, `www.linkedin.com/company/medx-croatia` `:7018`, `www.instagram.com/medx.croatia` `:7021`.
- **Share / calendar / maps intents:** `calendar.google.com/calendar/render` (`app.part9.js:44897`, `:51900`), `outlook.live.com/calendar/…` (`:44902`, `:51915`), `maps.google.com/?q=` (`:18893`, `:19846`, `:19869`, `:19892`, `:19915`, `:22613`), `www.google.com/maps/search/?api=1&query=` (`:11379`), LinkedIn add-to-profile / share (`:1210`, `:1362`, `:21102`), `twitter.com/intent/tweet` (`:1211`), `www.facebook.com/sharer` (`:1212`), `wa.me/?text=` (`:1213`), `ui-avatars.com/api/?name=` (`:25676`).
- **Demo/placeholder imagery (not infrastructure):** `randomuser.me/api/portraits/*` ×45 (`index.html:4984–5071`, `app.part9.js:8908, 10857, 11653–11780, 13028–13113`), `images.unsplash.com` ×30 (`index.html:5165–5312`, `7045–7206`), `images.squarespace-cdn.com` ×5 (`index.html:10658–10682`), `upload.wikimedia.org` ×3 (`index.html:5197`…), institution homepages (`hms.harvard.edu`, `med.stanford.edu`, `medicine.yale.edu`, `my.clevelandclinic.org`, `www.mayo.edu`, `www.massgeneral.org`, `web.mit.edu`, `www.hopkinsmedicine.org` at `app.part9.js:13012–13110`), literal `https://...` placeholder (`index.html:14391`), `https://linkedin.com/in/...` (`index.html:8830`), sample profiles (`app.part9.js:41723`, `:41745`).
- No `zoom.us`, no `plexus-tables.netlify.app`, no Firebase/Firestore URL in the member frontend.

### 4.3 Browser storage keys

- **localStorage — 102 distinct literal keys** (uses in parentheses): canonical auth pair `medx_user_token` (65) + `medx_user_data` (23); legacy mirrors `medx_token` (6), `medx_user` (4), `token` (4), `userToken` (1), `userPortalUser` (1), `user_id` (1); identity/security `medx_user_email` (2), `medx_biometric_enabled` (2), `medx_biometric_email` (2), `medx_2fa_enabled` (2), `medx_2fa_recovery_codes` (1); onboarding `medx_onboarding_completed` (9), `medx_onboarding_complete` (1), `medx_onboarding_skipped` (1), `medx_demo_persona` (1); Plexus `plexus_registration_id` (9), `plexus_registered` (7), `medx_plexus_registered` (1), `plexus_my_schedule` (5), `plexus_interested` (5), `plexus_sessions` (4), `plexus_checkin` (2), `plexus_schedule_selections` (1), `plexus_package_items` (1), `medx_registrations` (4), `medx_session_bookmarks` (2), `medx_prep_checklist` (2); gala `gala_registration_status` (2), `gala_registration_data` (1); forum `forum_registered_events` (7), `forum_registered_events_data` (2), `forum_interested_events` (3), `forum_project_interests` (2), `forum_opportunities` (2), `forum_member` (1), `medx_forum_member` (2), `medx_forum_profile` (3); accelerator `medx_accelerator_applications` (7), `medx_accelerator_draft` (1), `accApplicationDraft` (2), `ax_application_draft` (3), `medx_ax_doc_checklist_` (2, prefix), `bb_applications_` (3, prefix), `medx_af26_rsvp` (1); preferences/UI `medx_user_preferences` (7), `medx_theme` (4), `medx_locale` (1), `medx_last_section` (1), `medx_display_settings` (1), `medx_hidden_cards` (6), `medx_hidden_widgets` (2), `medx_user_widgets` (3), `medx_dashboard_widgets` (3), `medx_dashboard_layout` (2), `medx_dashboard_customized` (1), `dashboard_card_order` (2), `medx_admin_dashboard_widgets` (5), `medx_project_order` (2), `medx_pinned_projects` (2), `medx_saved_filters` (2), `medx_recent_actions` (2), `medxCustomShortcut` (4), `medxHomeNotes` (2), `chatPinned` (2), `chatHidden` (2), `pwa_install_dismissed` (2), `medx_install_dismissed` (2), `medx_push_dismissed` (1), `medx_scanner_hint_shown` (2), `medx_homepage_notifs_dismissed` (2), `medx_notification_settings` (2), `medx_notification_prefs` (2), `medx_notify_topics` (1), `medx_privacy_settings` (2); member data caches `mymedx_interests` (6), `medx_user_profile` (4), `medx_quiz_progress` (4), `medx_pending_invites` (4), `medx_achievements` (4), `medx_poll_votes` (3), `medx_login_streak` (2), `medx_rewards_last_balance` (1), `medx_connections` (2), `medx_checkins` (2), `medx_duel_history` (2), `networkingProfile` (2), `medx_speaker_data` (2), `medx_speaker_prefs` (1), `medx_shared_data` (2), `medx_subscriptions` (2), `medx_profile_tasks` (2), `medx_profile_notes` (2), `medx_task_assignments` (2), `medx_pending_users` (2); staff-side `medx_scheduled_emails` (5), `medx_email_templates` (5), `medx_email_drafts` (2), `medx_sent_emails` (2), `finClosedYears` (2), `accLockedYears` (2). Dynamic keys: `offline_${key}` (ticket offline cache), `${eventConfig.event}_registration_id`, and object-property keys (`this.LS_ENABLED`, `this.notesKey`, `this.prefix`, `this.storageKey`, `this.draftKey`, `this.checklistKey`, `this.tasksKey`, `this.preferencesKey`, `LS_KEY`/`LS_SET` = the i18n locale keys in forum-wing/part1).
- **sessionStorage (6):** `medx_verify_dismissed` (5), `medx_login_attempts` (4), `medx_plexus_idemp` (3, double-checkout guard), `medx_login_lockout` (3), `medx_forum_verified` (3), `medx_milestone_dismissed` (2).

### 4.4 Navigation contracts — hash routes, section ids, tabs

- **Member SPA:** `UserPortal.showSection(sectionId, addToHistory = true)` `app.part9.js:4413`: `rewards` is redirected to `dashboard` for "quiet" members (`:4415`); `history.pushState({section}, '', '#'+sectionId)` (`:4420`); toggles `.up-section.active` and activates **`#up-section-<id>`** (`:4426–4432`); syncs `MedXBottomNav` (`:4463`). Static `id="up-section-…"` in `index.html` (13): `accelerator, af26, bridges, dashboard, forum, gala, mymedx, network, plexus, rewards, settings, speaker, talks`. `showSection('…')` call targets across the code (20): `plexus, dashboard, network, forum, settings, accelerator, mymedx, communications, rewards, gala, finances, bridges, talks, speaker, checkin-scanner, speaker-management, profile, pr-media, building-bridges, automations`. Back/forward: `popstate` → `showSection(e.state.section || 'dashboard', false)` (`:3541–3549`); `history.replaceState({section:'dashboard'}, '', '#dashboard')` at `:4303`, `:4335`.
- **Staff dashboard (`App`, `app.part9.js:24986`):** `App.showSection(sectionId, navItem, skipHistory)` `:27156–27172` toggles `.section.active`, targets **`#section-<id>`** (`:27158`), pushes `#<id>` (`:27170`); `popstate` reads `event.state?.section || location.hash.slice(1) || 'dashboard'` (`:27220`). Static `id="section-…"` in `index.html` (11): `accelerator, automations, bridges, checkin-scanner, communications, dashboard, finances, forum, plexus, pr-media, speaker-management`; sidebar `data-section` values (10): `accelerator, bridges, building-bridges, communications, finances, forum, gala, plexus, pr-media, speaker-management`. `#admin` hash opens the staff view (`:51095`).
- **Other hash consumers:** `hashchange` listeners in `index.html:1297` (bottom nav sync), `index.html:2908`, `app.part2.js:27` (load → `setActive(hash||'dashboard')`), `app.part4.js:51–55`, `app.part5.js:43–45`, `app.part6.js:88`, `app.part7.js:50`, `app.part8.js:18`; `app.part14.js:37–38` parses `#k=v&…` hash params; notification links set `location.hash = notif.link` (`app.part9.js:52918`).
- **Tabs:** `data-tab` values (34): `overview, upcoming, speakers, schedule, profile, past, register, apply, travel, results, programs, program, privacy, notifications, networking, network, myschedule, myplexus, mypass, mymedx, myevents, myapplications, logistics, live, intake, institutions, home, events, documents, connect, city, appearance, account, abstract`. `data-settings-tab` appears once in `index.html` and twice in `app.part9.js`; `data-project` 0× in `index.html` / 2× in `app.part9.js`; `sidebar-project` 0× / 5× (JS-built).
- **Asset cache-busters:** `/assets/app.css?v=split5` (`index.html:40`) and `/assets/app.part1–14.js?v=split5` (`:193, 1305, 2517, 2684, 2701, 2754, 2777, 2781, 18737, 18754, 18757, 18774, 18853, 18862`) — the exact `assets/app.(css|partN.js)?v=` shape `stamp-sw.sh` rewrites.

### 4.5 Service worker (`sw.js`, 177 lines)

- `const CACHE_NAME = 'medx-portal-v9';` (`sw.js:2`). Precache `ASSETS_TO_CACHE` (`:6–13`): `/index.html`, `/manifest.json`, `/icon-192.png`, `/vendor/qrcode/qrcode.min.js`, `/vendor/fontawesome/css/all.min.css` (same-origin only by design, `:15–20`). Install `cache.addAll` + `skipWaiting` (`:24–33`); activate deletes other cache names + `clients.claim` (`:36–48`).
- Fetch (`:52–105`): non-GET ignored (`:54`); **cross-origin never intercepted** (`:66`); `/api/` never cached (`:68–70`); navigations network-first, shell fallback `caches.match('/index.html')`, shell refreshed only from `/` or `/index.html` (`:75–89`); other same-origin GETs cache-first with `type === 'basic'` gate (`:92–104`).
- Push (`:114–132`): payload `{title, body, url}` default url `/?app=1`; `notificationclick` (`:135–147`) focuses/navigates an open tab or `openWindow(target)`; `pushsubscriptionchange` (`:152–176`) fetches `GET /api/push/vapid-key` (`:167`), re-subscribes, and `postMessage({type:'medx-push-resubscribe', subscription})` to open tabs.
- `manifest.json`: `start_url: "/?app=1"`, `scope: "/"`, `id: "medx-plexus-attendee"`, shortcuts `/?app=1&view=ticket` and `/?app=1&view=schedule`, icons `icon-192.png` / `icon-512.png`.

---

## 5. EXTERNAL SERVICES (member portal + shared)

| service | initialised | env vars | routes / call sites | when the env var is missing |
|---|---|---|---|---|
| **Stripe** | `:40–45` `stripe = require('stripe')(STRIPE_SECRET_KEY)` only if the key exists, else `stripe` stays `null` with a console line | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (`:20159`), `STRIPE_WEBHOOK_SECRET` (`:20248`, `:20252`) | `checkout.sessions.create` at `:5430, :15075, :17513, :20201, :27817, :27889, :28403, :28755`; refunds `:762`; webhook `POST /api/stripe/webhook` `:20240` (raw body `:645–651`, `constructEvent` `:20252`, idempotency `processed_stripe_events` `:20271`); `GET /api/plexus/stripe-config` `:20157` | No secret key → every checkout returns an error/redirect (`if (!stripe)` guards, e.g. `:5427`, `:735`), webhook answers `400 Stripe not configured` (`:20244`), `stripe-config` reports `enabled:false`. No webhook secret → webhook `500 Webhook secret not configured` (`:20248–20251`): **payments succeed at Stripe but nothing is fulfilled**. No publishable key → `publishableKey:null`. |
| **Brevo (email)** | `sendEmail()` `:75–145`; readiness `mailProviderReady()` `:74` | `BREVO_API_KEY`, `EMAIL_FROM` (default `Med&X <noreply@medx.hr>` `:76`), `CONFIRMATION_CC` (default `laura.rodman@medx.hr` `:148`), `EMAIL_DUMP_DIR` (dev HTML dump `:135–141`), `EMAIL_LOGO_URL` (`:302`, default jsDelivr GitHub mirror) | `POST https://api.brevo.com/v3/smtp/email` `:102`, header `api-key`; every verification / ticket / confirmation email | Missing key: **production** → logs `[EMAIL DROPPED]` and returns `{success:false, mock:true}` (`:126–128`), callers proceed (registrations are saved, mail is not sent); non-production → mock success + optional file dump. |
| **Resend** | not used | `RESEND_API_KEY` is declared in `render.yaml:27` but read nowhere (`:69` comment: the SendGrid/Resend/SMTP chain was removed; `.env.example:21–26` still lists `SMTP_*`) | — | no effect. |
| **FIRA (fiscal invoicing)** | `fira-service.js:12–13` constants; `isConfigured()` `:20–23` | `FIRA_API_KEY`, `FIRA_API_URL` (default `https://app.fira.finance`), `FIRA_DISABLED` (`'true'` forces off) | `createFiscalInvoice` → `POST ${FIRA_API_URL}/api/v1/webshop/order/custom` (`:156`, retry with 0 % VAT `:174`), `getInvoiceStatus` `:215`; callers `server.js:19941, 20316, 20427, 20554, 20758, 20939, 21092`; status flags `fira_active` `:20048`, `:21309`; boot log `:48–52` | Unconfigured → `createFiscalInvoice` returns `null` after a warning (`:148–151`) — "demo mode", no fiscal invoice, registration still completes. API errors **throw** (`:203`), caught per call site. |
| **Google Sheets mirror** | `mirrorToSheets()` `:664–673` + 7 inline copies | `GOOGLE_SHEETS_WEBHOOK` (Apps Script URL) | `fetch(webhook, POST JSON)` at `:668, 20493, 20844, 21010, 26921, 28342, 28802, 28988` (Plexus/gala/invite/forum/AF26/direct/sign-up-form registrations) | Unset → each site short-circuits (`if (!webhook) return` / `if (sheetsWebhook)`); fire-and-forget, failures only `console.warn`. |
| **Google Wallet** | `shared/wallet.js:42–45` endpoints; `getConfig()` `:50–61`, `isConfigured()` `:63` | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY` (service-account JSON), `GOOGLE_WALLET_EVENT_CLASS_ID` / `GOOGLE_WALLET_TICKET_CLASS_ID` (`shared/wallet.js:77`, `server.js:13407`), `GOOGLE_WALLET_CLASS_ID` (membership class `:13297`), `GOOGLE_WALLET_OBJECTS_BASE`, `GOOGLE_WALLET_OAUTH_URL` (test overrides) | `GET /api/member/wallet/google` `:13293`, `GET /api/member/wallet/google/ticket/:regId` `:13383` (`wallet.buildSaveUrl` `:13426`, `ensureEventClass/Object` fire-and-forget `:13427`); network via `shared/wallet.js:168` (`walletobjects.googleapis.com`, `oauth2.googleapis.com`) | Missing issuer/SA key → `{configured:false, owner_action:…}` JSON (`:13298–13302`, `:13385–13389`); nothing throws. Invalid SA JSON → `saError` and `configured:false`. |
| **Apple Wallet** | stub only | `APPLE_WALLET_CERT_PEM`, `APPLE_WALLET_KEY_PEM`, `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_PASS_TYPE_ID` (`:13442–13443`, `shared/wallet.js:264–265`) | `GET /api/member/wallet/apple/ticket/:regId` `:13438` | Always returns the "not configured" JSON; `providers.apple.buildPass()` throws `apple_pkpass_not_implemented` (`shared/wallet.js:272`) — dormant by design. |
| **Firestore / seat picker** | **not present** in the member portal (`firebase`/`firestore`/`picker` hits are comments `:9510–9512`, `:13027`, `:14372`) | — | seats are read from the shared DB: `gala_table_assignments` (CSV import from the picker console, admin-written) via `GET /api/gala/my-seat` (frontend `app.part9.js:1022`) | n/a |
| **Anthropic** | `shared/ai.js` — `AI_ENDPOINT = https://api.anthropic.com/v1/messages` (`:25`), model `AI_DRAFT_MODEL \|\| 'claude-haiku-4-5'` (`:28`), 8 s timeout (`:30`), rate cap `AI_DRAFT_RATE_MAX \|\| 30` per minute (`:35`) | `ANTHROPIC_API_KEY` (`:84`), `AI_DRAFT_MODEL`, `AI_DRAFT_RATE_MAX` | `aiDraft()` called at `server.js:12564` (FAQ assistant answer enhancer) and `:13956` (member summary) | No key / timeout / HTTP error / rate-limited → `{text:'', mock:true, mock_reason}` (`:80`); never throws; callers fall back to deterministic text. |
| **Cloudinary** | `:5508–5521` (`require('cloudinary').v2` inside `if (CLOUDINARY_URL)`), `uploadToCloud()` `:5549–5564`, `cloudUpload(folder)` `:5567` | `CLOUDINARY_URL` | multer routes with `cloudUpload(...)` at `:18838`, `:19692`, `:23641` (applicant documents), `:27987` (speaker documents) | Unset in **production** (`NODE_ENV=production` or `RENDER`) → `STORAGE_IS_EPHEMERAL` (`:5528–5529`), loud boot error (`:5530–5538`) and **every multipart POST/PUT/PATCH returns 503** except paths ending `/import` or `/prospects/preview` (`:5540–5547`). Dev → local `uploads/` disk. |
| **Web push (VAPID)** | `webpush.setVapidDetails` `:573–577` only when both keys exist | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (default `mailto:accelerator@medx.hr`) | `GET /api/push/vapid-key` `:23013`, `POST /api/push/subscribe` `:23018`, `DELETE /api/push/unsubscribe` `:23036`; senders `sendPushToUser` `:152`, `sendPushToAll` `:180`, outbox drain `:198` (interval `:29485–29487`) | Either key missing → all senders return early; outbox rows accumulate unsent; `vapid-key` returns `{publicKey:''}` so the browser subscription fails silently. |
| **PDF generation** | `pdfkit` (`require` inside handlers `:14823`, `:16077`, `:16254`); fonts `PDF_FONT_PATH` / `PDF_FONT_BOLD_PATH` with `shared/fonts/DejaVuSans*.ttf` fallback (`:15841–15854`) | `PDF_FONT_PATH`, `PDF_FONT_BOLD_PATH` | `GET /api/accelerator/applications/:id/package` `:14821`, `…/years/:year/ranking-pdf` `:16075`, `…/applications/:id/merge-docs` `:16252` | **No Puppeteer/Chrome anywhere** in `user-portal/**` or `shared/**` (all 7 "chrome" hits are the word "UI chrome"). Missing font env → bundled DejaVu is used. |
| **Publer, Amadeus, MS Graph** | **absent** from the member portal (0 hits for `publer`, `amadeus`, `graph.microsoft`, `MS_GRAPH`) | — | admin-only | n/a |
| **Turso / libsql** | `shared/db.js:14–36`; opened `:6149–6153` | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `DATABASE_PATH` | all SQL | Both unset → local SQLite file only; sync helpers no-op (`:6011`, `:6021`, `:6038`, `:6054`); `DEV_AUTH_ENABLED` becomes possible when `NODE_ENV=development` (`:6078`). |
| **QR** | `qrcode` npm (`:10`) | — | `/qr/:id.png` `:4076`, `/f/:slug/qr.png` `:2349`, email attachments | local, no external call. |
| **Self / Render** | keep-alive `:29469–29475` | `RENDER_EXTERNAL_URL`, `KEEP_WARM`, `NODE_ENV`, `RENDER` | `fetch(RENDER_EXTERNAL_URL + '/health')` every 14 min only when `KEEP_WARM === '1'` in production | Off by default (comment `:29471`: always-on ping burned the free instance hours). |

---

## 6. ENV VARS — every `process.env.X` in `user-portal/**` and `shared/**` (109 references, 49 distinct)

| var | read at | effect when missing |
|---|---|---|
| `ADMIN_PORTAL_URL` | `:28495` | none — assigned to an unused variable; default literal `https://medx-admin-portal.onrender.com` |
| `AI_DRAFT_MODEL` | `shared/ai.js:28` | model defaults to `claude-haiku-4-5` |
| `AI_DRAFT_RATE_MAX` | `shared/ai.js:35` | 30 live calls / minute |
| `ANTHROPIC_API_KEY` | `shared/ai.js:84` | `aiDraft` returns mock (`mock_reason:'no_key'`); UI shows template mode |
| `APPLE_WALLET_CERT_PEM`, `APPLE_WALLET_KEY_PEM`, `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_PASS_TYPE_ID` | `:13442–13443` (+ `shared/wallet.js:264–265`) | Apple route reports not configured (it is a stub either way) |
| `BREVO_API_KEY` | `:74`, `:82`, `:105` | prod: email dropped loudly, `{success:false,mock:true}`; dev: mock success |
| `CLOUDINARY_URL` | `:5510` | prod: multipart uploads 503, boot error; dev: local disk |
| `CME_ENC_KEY` | `:5652` | `null` key → CME/HLK personal data stored **in plaintext** (`:5651` comment "No key => null (plaintext fallback)") |
| `CONFIRMATION_CC` | `:148` | CC defaults to `laura.rodman@medx.hr` |
| `DATABASE_PATH` | `:5582` | uses `shared/medx_portal.db` if present, else `user-portal/backend/medx_portal.db` |
| `EMAIL_DUMP_DIR` | `:135`, `:139` | no HTML dumps (dev only) |
| `EMAIL_FROM` | `:76` | `Med&X <noreply@medx.hr>` |
| `EMAIL_LOGO_URL` | `:302` | jsDelivr GitHub-mirror logo URL |
| `FIRA_API_KEY` | `fira-service.js:13` | FIRA demo mode, no fiscal invoices |
| `FIRA_API_URL` | `fira-service.js:12` | `https://app.fira.finance` |
| `FIRA_DISABLED` | `fira-service.js:21` | (only `'true'` matters) FIRA stays on if key present |
| `GOOGLE_SHEETS_WEBHOOK` | `:666, 20491, 20837, 21007, 26919, 28339, 28796, 28986` | no Sheets mirroring (silent) |
| `GOOGLE_WALLET_CLASS_ID` | `:13297` | membership class defaults to `<issuer>.medx_membership` |
| `GOOGLE_WALLET_ISSUER_ID` | `:13295`, `:13407`, `shared/wallet.js:52` | wallet `{configured:false}` |
| `GOOGLE_WALLET_SA_KEY` | `:13296`, `shared/wallet.js:53` | wallet `{configured:false}` |
| `GOOGLE_WALLET_EVENT_CLASS_ID` | `shared/wallet.js:77` | Plexus class id minted as `<issuer>.<slug>` instead of the approved id |
| `GOOGLE_WALLET_TICKET_CLASS_ID` | `:13407`, `shared/wallet.js:77` | fallback `<issuer>.medx_event_ticket` |
| `GOOGLE_WALLET_OBJECTS_BASE`, `GOOGLE_WALLET_OAUTH_URL` | `shared/wallet.js:42–43` | real Google endpoints |
| `JWT_SECRET` | `:569` | production: **process exits** (`FATAL`); development: `'medx-dev-secret'` |
| `KEEP_WARM` | `:29471` | self-ping off |
| `MEDX_IBAN` | `:510` | bank-transfer instructions hidden (placeholder IBANs rejected `:511`) |
| `MEDX_BANK_NAME`, `MEDX_SWIFT`, `MEDX_COMPANY_NAME` | `:516–518` | `Zagrebačka banka d.d.` / `''` / `Med&X` |
| `NODE_ENV` | `:126`, `:569`, `:5528`, `:6078`, `:11665`, `:29471` | non-production behaviours: email mock, dev JWT secret, no upload guard, dev auth possible, `/api/dev/run-milestones` enabled, no keep-alive |
| `PDF_FONT_PATH`, `PDF_FONT_BOLD_PATH` | `:15842`, `:15852` | bundled `shared/fonts/DejaVuSans*.ttf` |
| `PORT` | `:568` | 3000 |
| `PORTAL_URL` | `:26964`, `:27047`, `:27124` | gala approval email link and invite links fall back to `https://medx-user-portal.onrender.com` / request host |
| `PUBLIC_BASE_URL` | `:3066`, `:13317`, `:13402`, `:15706` | falls through to `RENDER_EXTERNAL_URL` → request host |
| `RENDER` | `:5528` | (Render sets it) used only to detect production for the upload guard |
| `RENDER_EXTERNAL_URL` | 18 sites (`:500, 588, 1781, 2354, 3066, 3151, 3208, 3244, 11763, 12153, 13317, 13402, 15706, 28402, 28754, 29304, 29353, 29470`) | literal `https://medx-user-portal.onrender.com` or request host; CORS loses its first entry; keep-alive off |
| `STRIPE_SECRET_KEY` | `:40–41` | card payments disabled |
| `STRIPE_PUBLISHABLE_KEY` | `:20159` | `publishableKey:null` |
| `STRIPE_WEBHOOK_SECRET` | `:20248`, `:20252` | webhook 500 → no fulfilment |
| `TURSO_DATABASE_URL` | `:6011, 6021, 6038, 6054, 6078, 6151, 6154, 29479, 29516` | local-only DB, dev email drainer active |
| `TURSO_AUTH_TOKEN` | `:6152` | sync silently not configured (`shared/db.js:19` needs both) |
| `USER_PORTAL_URL` | `:11369` (`PORTAL_BASE_URL()`), `:16858` | `https://medx-user-portal.onrender.com` |
| `VAPID_PUBLIC_KEY` | `:155, 181, 201, 572, 575, 23014, 29485` | push disabled |
| `VAPID_PRIVATE_KEY` | `:155, 181, 201, 572, 576, 29485` | push disabled |
| `VAPID_SUBJECT` | `:574` | `mailto:accelerator@medx.hr` |

**Cross-check with `render.yaml` (service `medx-user-portal`, lines 19–78).** Declared there (23): `PORT, NODE_ENV, JWT_SECRET (generateValue), RESEND_API_KEY (sync:false), EMAIL_FROM, VAPID_PUBLIC_KEY (committed value), VAPID_PRIVATE_KEY, VAPID_SUBJECT, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, FIRA_API_KEY, FIRA_API_URL, MEDX_IBAN, MEDX_BANK_NAME, MEDX_SWIFT, MEDX_COMPANY_NAME, MEDX_VAT_ID, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_EVENT_CLASS_ID, GOOGLE_WALLET_SA_KEY`.

- **Read by code but NOT declared in `render.yaml`** (set only in the Render dashboard, or absent — 26): `ADMIN_PORTAL_URL, AI_DRAFT_MODEL, AI_DRAFT_RATE_MAX, ANTHROPIC_API_KEY, APPLE_WALLET_CERT_PEM, APPLE_WALLET_KEY_PEM, APPLE_WALLET_TEAM_ID, APPLE_WALLET_PASS_TYPE_ID, BREVO_API_KEY` (**the only live mail key**), `CLOUDINARY_URL` (**without it every upload 503s in prod**), `CME_ENC_KEY` (**without it CME data is plaintext**), `CONFIRMATION_CC, DATABASE_PATH, EMAIL_DUMP_DIR, EMAIL_LOGO_URL, FIRA_DISABLED, GOOGLE_SHEETS_WEBHOOK, GOOGLE_WALLET_CLASS_ID, GOOGLE_WALLET_OAUTH_URL, GOOGLE_WALLET_OBJECTS_BASE, GOOGLE_WALLET_TICKET_CLASS_ID, KEEP_WARM, PDF_FONT_BOLD_PATH, PDF_FONT_PATH, PORTAL_URL, PUBLIC_BASE_URL, USER_PORTAL_URL`. (`RENDER` and `RENDER_EXTERNAL_URL` are injected by Render itself.)
- **Declared but never read by member/shared code (2):** `RESEND_API_KEY` (stale — the code is Brevo-only), `MEDX_VAT_ID` (the yaml comment at `render.yaml:52–53` already says nothing reads it).
- `.env.example` (`user-portal/backend/.env.example`) is also stale: lists `SMTP_HOST/PORT/USER/PASS/FROM` and `MEDX_ADDRESS` which no code reads, and omits `BREVO_API_KEY`, `TURSO_*`, `CLOUDINARY_URL`, `VAPID_*`.

---

## 7. DRIFT REPORT — `design/CONNECTIONS-MAP.md` vs HEAD

**Method.** Every `:NNNN` citation in the map that names member-portal or `shared/` code (119 citations across map lines 29–280) was checked by matching a regex for the cited construct **at the cited line (or range)**; on a miss the file was searched for the nearest match. Admin-portal citations were only checked where they define a member-portal contract (§2).

**Result: 113 citations still match at the cited line · 5 moved · 1 wrong path.**

| map line | citation | status | now |
|---|---|---|---|
| 93 | `createDatabase` at `:6148` | moved | `:6149` |
| 109 | `qrImageUrl()` at `:497` | moved | `:501` (`QR_BASE_URL` `:500` is correct) |
| 152 | `checkout_error=1` at `:5408` (limiter) | moved | `:5409` |
| 152 | `checkout_error=1` at `:5416` (fail) | moved | `:5414` |
| 206 | `POST /email-prefs` at `:1837` | **wrong path** | the route is `POST /api/email-prefs` (`:1837`); `GET /email-prefs` `:1827` is correct |
| 268 | forum-wing token at `forum-wing.html:511` | moved | `TOKEN_KEY` `:508`, `mxt` harvest `:511` (the line itself is correct for `mxt`; the "token" definition is `:508`) |
| 270 | `showSection` `:27156–27170` toggles `.active` on `#section-<id>` | **wrong object** | that is the staff `App.showSection` (`app.part9.js:27156–27172`); the member `UserPortal.showSection` is `:4413–4470` and targets `#up-section-<id>` |
| 163 | CORS allowlist `:588–591` | range widened | block is `:586–595` (regex still hits inside the cited range) |

**Verified unchanged (selection, all OK at the cited line):** Stripe init `:40–44`; raw-body `:646`; all 8 `checkout.sessions.create` lines and the 8 routes; webhook `:20240` and every dispatch branch (`:20252, 20271, 20286, 20398, 20523, 20629, 20642, 20707, 20879, 20971, 21171, 21185`); `sendEmail :75`, Brevo `:102`, CC `:148`, drop `:126–128`; wallet routes `:13293/13383/13438`, `shared/wallet.js:77`; `aiDraft` `:12564/13956`; VAPID `:573`, push routes `:23013/23018/23036`; `/qr/:id.png :4076`, `:2349`; `fira-service.js:156`; Sheets env reads `:666…28986`; cloudinary `:5510–5514`; logo `:302`; calendar `:11541`; donate URLs `:5449–5450`; `app.part9.js:33210`, `index.html:2439`; verify/reset/invite/interviewer/applicant link builders `:11297, 11331, 11481, 11764, 27048, 27125, 15708, 23358`; QR images `:29367, 2255, 13090`; legal links `:467–469`; `PORTAL_BASE_URL :11369`, `ADMIN_PORTAL_URL :28495`; every §3 route line (`:801, 972, 11701, 11253, 11789, 1292, 3254, 27868, 5363, 3227, 5341, 2717, 2906, 2363, 3204, 15515, 15635, 23388, 23401, 1857, 1827, 3147, 3188, 22262, 1762, 1761, 26838, 5097, 5117`); `app.part9.js:3442–3476, 3362, 9822, 4925, 3693, 1022`; `index.html:54, 39, 24–25, 35`; `sw.js:2`.

### 7.1 Discrepancies of substance (not line numbers)

| # | map claim | what HEAD shows |
|---|---|---|
| D1 | §5.1 lists `CORS_ORIGIN` among env "read by code"; IMPLEMENTATION_CONTRACT §69 describes a comma-split `CORS_ORIGIN` with an admin default | Member portal never reads `CORS_ORIGIN`; the allowlist is hardcoded (`:586–595`). Only the admin portal reads it (`admin:878`). |
| D2 | §2.1 / exec-summary #5: "`mxt` is consumed pre-boot at user `index.html:54`" for the `/plexus?event=…&mxt=` deep link | `index.html` is never served for `/plexus` (server-rendered at `:1292–1572`); `mxt`, `event`, `ticket`, `from` are all ignored on that URL. Only `/?mxt=` (SPA) and `/forum?mxt=` (`forum-wing.html:511`) consume it. |
| D3 | §2.3: "No authenticated server-to-server API calls and no shared secret exist" | Admin backend calls the member backend at `admin:11341` (`GET /api/public/registrations/:email`, unauthenticated). The refund POST (`admin index.html:43241`) needs the two services' `JWT_SECRET` to be equal (`:733` verifies with the member secret; `render.yaml` generates one per service). |
| D4 | §2.3.5 cites admin `index.html:43173` for the refund call and the member route as `/api/admin/payments/gala/:id/refund` | Call is at `admin index.html:43241`; the member route is generic `POST /api/admin/payments/:kind/:id/refund` (`:733`, kinds `gala`, `forum-event`, `conference`). |
| D5 | §4.2: section nodes are `#section-<id>`; `[data-settings-tab]`, `.sidebar-project[data-project]` are contracts | Member sections are `#up-section-<id>` (13 ids); `#section-<id>` (11 ids) is the staff `App` scheme; `data-settings-tab` 1×/2×, `data-project` 0×/2× in `index.html`/`app.part9.js` (JS-built only). |
| D6 | §1.13 "call sites :666, :20491, …" | Those are the `process.env.GOOGLE_SHEETS_WEBHOOK` reads; the `fetch(webhook…)` lines are `:668, 20493, 20844, 21010, 26921, 28342, 28802, 28988`. |
| D7 | §2.4: interviewer link `:15708→admin` | `baseUrl` at `:15706–15707` is `PUBLIC_BASE_URL \|\| RENDER_EXTERNAL_URL \|\| req.headers.origin \|\| host` — the member origin; the member portal serves `/evaluate` itself (`:23702`). |
| D8 | §2.1: site.js probes are "always `mode:'cors'`" | Live/mirror `site.js:916` still fetches `origin + '/health'` with `mode:'no-cors'`; `:1733` uses `mode:'cors'`. (Website-side; the member portal's CORP `same-origin` header makes the `:916` probe opaque.) |
| D9 | §1.3: "user portal has no Firebase" | Confirmed — and additionally `gala_table_assignments` (picker CSV import, `:9510–9512`) is the seat source. No change needed. |
| D10 | §5.1: `BREVO_API_KEY` "lives only in the Render dashboard" | Confirmed; additionally `CLOUDINARY_URL` and `CME_ENC_KEY` are undeclared but have prod-breaking / data-protection effects (§6). |

### 7.2 Things the map does not mention (found in this audit)

1. `require('../../admin-portal/backend/demo-purge.js')` at `:29463` — member boot depends on an admin-portal file.
2. Dead `adminUrl` (`:28495`) and the absence of any member→admin HTTP call.
3. Public routes absent from the map's §3 table: `GET /api/public/impact` (`:12096`), `GET /api/public/survey`, `…/recommend`, `POST …/comment` (`:12208–12264`), `POST /api/public/forum-consideration` (`:4329`), `GET /api/public/registrations/:email` (`:29187`, PII, no auth, consumed by admin), `GET /api/org/signature` (`:12066`), `GET /api/member-card-visibility` (`:1768`), `GET /api/members/verify?id=|email=` (`:26838`, returns id/email/name with no auth), `GET /forum/enter?token=` (`:4163`), `POST /api/accelerator/apply` (`:15204`, unauthenticated), `POST /api/plexus/register/start` (`:21318`), `POST /api/applicant/register|login` (`:23333`, `:23401`), the whole read-only public conference family (`/api/conferences*`, `/api/plexus/{conference,schedule,sessions,speakers,sponsors,announcements,posters,photos,resources,hotels,settings,stats,cme/status,stripe-config,promo/validate}`), `/api/accelerator/{program,institutions,sites,results,intake,key-dates,countdown,overview-config}`, `/api/gala/settings`, `/api/portal-content/published*`, `/api/invite/validate-coupon`, `/api/register-direct/:token`.
4. `/api/public/site` is the only public read with **no rate limiter and no cache header** (registered at `:11943`, before `publicLimiter` is created at `:12030`).
5. `POST /api/public/pv` overrides CORP to `cross-origin` (`:12299`); every other response carries `Cross-Origin-Resource-Policy: same-origin` (helmet default, visible live).
6. `/uploads` responses are forced to `Content-Disposition: attachment` + sandbox CSP (`:5463–5470`).
7. Production upload guard: multipart requests 503 without `CLOUDINARY_URL` (`:5528–5547`).
8. `CME_ENC_KEY` plaintext fallback (`:5651–5654`).
9. `JWT_SECRET` missing in production exits the process (`:569`).
10. `DEV_AUTH_ENABLED` requires both `NODE_ENV=development` and no `TURSO_DATABASE_URL` (`:6078`); `auth()` never falls back to another user's row for an orphan token (`:6095–6100`).
11. `manifest.json` shortcuts (`/?app=1&view=ticket`, `/?app=1&view=schedule`) and `start_url /?app=1`; the SW/notification default URL `/?app=1` and announcement links `/?app=1&section=<id>` (`:286`).
12. Lazy CDN fallbacks for `qrcode@1.5.1` and `html2canvas@1.4.1` from jsDelivr (`app.part9.js:1856–1857`) and a second Font Awesome source on cdnjs (`app.part9.js:10997`) — both already allowed by the CSP `script-src`/`style-src` (`:604–616`).
13. The full localStorage inventory is 102 keys (map lists ~30).
14. `.env.example` lists `SMTP_*`/`MEDX_ADDRESS` that nothing reads and omits the keys that matter (§6).
15. The admin frontend uses two different dev ports for the member portal (`admin index.html:46981` → 3001, `:53709` → 3010, `:43241` → 3001) while the admin backend's `userPortalBase()` defaults to 3010.

---

## 8. LIVE CHECK — `https://medx-user-portal.onrender.com` (GET/OPTIONS only, `curl -sS -m 90`, 2026-08-28)

| request | HTTP | content-type | bytes | first bytes of body |
|---|---|---|---|---|
| `GET /health` | 200 | application/json | 11 | `{"ok":true}` |
| `GET /api/public/site` | 200 | application/json | 2402 | `{"conference":{"name":"Plexus Conference 2026","year":2026,"slug":"plexus-2026","description":"Where young biomedical minds connect","start_date":"2026-12-04","end_date":"2026-12-05","date_range":"Dec…` |
| `GET /api/public/content` | 200 | application/json | 847 | `{"blocks":{"homepage.news_banner":{"type":"richtext","body":"","body_hr":"","updated_at":"2026-07-02T17:39:23.054Z"},"plexus.announcement":{"type":"text","body":"","body_hr":"","updated_at":"2026-07-0…` |
| `GET /api/public/status` | 200 | application/json | 1545 | `{"projects":[{"project_key":"plexus","status_label":"Pre-registration open","status_kind":"open","detail_line":"December 4-5, 2026 - Zagreb - Free entry","cta_label":"Register","cta_target":"plexus",…` |
| `GET /api/public/supporters` | 200 | application/json | 3345 | `{"strings":{"hr":{"heading":"Podržali su nas","intro":"Zahvaljujemo svim tvrtkama, institucijama i javnim tijelima koja su podržala jedan ili više Med&X programa. Vaša potpora omogućuje našu mis…` |
| `GET /calendar/medx-events.ics` | 200 | text/calendar | 1666 | `BEGIN:VCALENDAR VERSION:2.0 PRODID:-//Med&X//Plexus Week 2026//EN CALSCALE:GREGORIAN METHOD:PUBLISH BEGIN:VTIMEZONE TZID:Europe/Zagreb …` |
| `GET /pay/gala/INVALIDTOKEN` | **404** | text/html | 984 | `<!DOCTYPE html><html><head>…<title>Invalid payment link — Med&X</title>…` |
| `GET /verify-certificate?n=INVALID` | **404** | text/html | 1814 | `<!DOCTYPE html><html lang="en"><head>…<meta name="robots" content="noindex"><title>Certificate verification —…` |
| `GET /invite-success` (no `session_id`) | 200 | text/html | 5982 | `…<title>No Recent Payment Session — Med&X</title>…` |
| `GET /reset-password/INVALID` | 200 | text/html | 5691 | `…<title>Link Invalid or Expired — Med&X</title>…` |

All responses arrived in 0.14–0.36 s (the service was warm; no cold start observed).

**CORS probes on `GET /api/public/site`:**

| `Origin` header sent | response headers of interest |
|---|---|
| `https://www.medx.hr` | `HTTP/2 200` · **`access-control-allow-origin: https://www.medx.hr`** · `cross-origin-opener-policy: same-origin-allow-popups` · `cross-origin-resource-policy: same-origin` · `vary: Origin` |
| `https://medx-member-portal-review.netlify.app` | `HTTP/2 200` · **no `access-control-allow-origin` header** · `cross-origin-resource-policy: same-origin` · `vary: Origin` |
| `OPTIONS` preflight from `https://medx-member-portal-review.netlify.app` (`Access-Control-Request-Method: GET`) | `HTTP/2 204` · `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE` · **no allow-origin** → the browser rejects the request |

Conclusion: the live allowlist matches `:586–595`; a member-portal redesign preview hosted on `medx-member-portal-review.netlify.app` cannot call the live API until that origin is added to the array at `:590`-area (and redeployed — `shared/` and non-`user-portal/**` edits do not trigger a deploy, `render.yaml:16–18`).

---

*Generated 2026-08-28 from HEAD `8b7ba23`. Working files (route dumps, table matrix, drift script output, curl transcripts) were kept in the session scratchpad and are reproducible from the commands described in each section.*
