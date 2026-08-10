# Med&X Portals — IMPLEMENTATION CONTRACT for the full UI redesign

Built 2026-08-10 by scripted extraction + manual reading of the live codebase. Owner's rule:
**"Functionality stays, design changes completely."** Everything in this file is wiring that the
redesigned user portal and admin portal MUST keep intact. If a redesigned screen does not make the
same calls, keep the same URLs, and read/write the same storage keys listed here, something breaks
in production — usually silently, and usually in an email link someone already received.

Sources (read-only, never edited):
- `/Users/alen/Documents/Claude_Code_Projects/MedX/medx-portal-fresh`
  - `user-portal/backend/server.js` (29,600 lines), `user-portal/frontend/` (index.html 19,056 lines + `assets/app.part1-14.js`, ~57k lines, + `forum-wing.html`)
  - `admin-portal/backend/server.js` (43,392 lines), `admin-portal/frontend/index.html` (59,465 lines)
  - `render.yaml`, `shared/` (db.js, ai.js, wallet.js), `admin-portal/backend/picker-sync.js`, `.github/workflows/`
- `/Users/alen/Documents/Claude_Code_Projects/MedX_Squarespace/site_live_mirror_2026-07-31` (`site.js` 1,867 lines + pages)

How to re-verify after any change: the repo ships its own tripwire —
`node scripts/check-api-contract.js` fails CI when any frontend `/api/...` call has no matching
backend route (it parses both SPAs AND the inline JS of server-rendered template pages). Run it,
plus `bash scripts/check-schema-sync.sh`, before shipping any redesigned frontend. CI: `.github/workflows/boot-smoke.yml` boots both servers and probes `/health`, `/`, and `/api/auth/login`.

---

## 1. System topology — what talks to what

Four properties, one database:

| Property | Production origin | Runtime | Local dev |
|---|---|---|---|
| User portal | `https://medx-user-portal.onrender.com` | Render web service `medx-user-portal`, Node, rootDir `user-portal/backend`, PORT 3000, health `/health` | site.js assumes `http://localhost:3001` |
| Admin portal | `https://medx-admin-portal.onrender.com` | Render `medx-admin-portal`, rootDir `admin-portal/backend`, PORT 3001, health `/health` | site.js assumes `http://localhost:3002`; admin code also defaults to 3010 for the user portal in dev (`userPortalBase()`, admin server.js:803) |
| Marketing site | `https://medx.hr` / `https://www.medx.hr` (+ preview `https://medx-website-preview.netlify.app`) | Netlify static; `site.js` is the integration layer | — |
| Gala table picker | `https://plexus-tables.netlify.app` | Separate repo (`alen-ops99/plexus-gala-suite`), Firestore project `plexus-gala-tables` | — |
| Gateway landing | Render `medx-gateway`, `landing/serve.js`, PORT 3005, free plan | serves one static page | — |

Render deploy details that are part of the contract (render.yaml):
- `buildCommand` on BOTH portals runs `bash ../../scripts/stamp-sw.sh` — appends the git SHA to
  each service worker's `CACHE_NAME` (`medx-portal-v9-<sha>` / `medx-staff-v2-<sha>`). The prod
  smoke test asserts `/medx-portal-v\d+/`. A redesigned frontend must keep `sw.js` with a
  `CACHE_NAME = 'medx-portal-vN'`-style constant or deploys stop cache-busting.
- `buildFilter` paths (`user-portal/**`, `admin-portal/**`) mean a frontend-only commit still
  deploys the right service. Keep the directory layout or update render.yaml deliberately.
- `healthCheckPath: /health` on both — Render only shifts traffic when `/health` returns 200.
  **`GET /health` must exist on both backends forever** (also pinged by keepalive.yml,
  uptime-alert.yml, the site's warming splash code, and boot-smoke CI).

### 1a. THE two load-bearing invariants

1. **One shared database.** Both portals open the same Turso DB (`medx-portal`) through
   `shared/db.js` (libsql embedded replica; local file `shared/medx_portal.db` fallback;
   `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` on both services; `db.sync()` every 60s each side).
   Users, registrations, permissions, outbox, everything is one schema shared by both servers.
2. **One shared JWT_SECRET.** The admin's JWT must verify on the USER portal — stated in code at
   user server.js:13850 ("called by the admin portal with its admin JWT (shared JWT_SECRET +
   Turso DB)") and exercised by the admin SPA's cross-origin gala refund call (below).
   WARNING: render.yaml says `generateValue: true` for JWT_SECRET on both services — that is
   misleading; in production the dashboard values are manually kept identical. Never rotate one
   side alone, and never "fix" render.yaml to per-service secrets.

### 1b. CORS matrix (verbatim from code — the redesign must not need more than this)

User portal (user server.js:586) — one global allowlist:
`RENDER_EXTERNAL_URL`, `https://medx.hr`, `https://www.medx.hr`,
`https://medx-website-preview.netlify.app`, `https://medx-admin-portal.onrender.com`,
`http://localhost:3000`, `http://localhost:3001`, `http://localhost:8899`.
(The admin origin is in there because the admin SPA calls the user API from the browser.)

Admin portal (admin server.js:868-884) — two layers:
- `/api/public/*` only: `https://medx-website-preview.netlify.app`, `https://www.medx.hr`, `https://medx.hr` (registered BEFORE the global policy so it owns the preflight).
- Global: `CORS_ORIGIN` env (comma-split) or default `https://medx-admin-portal.onrender.com`,
  `https://medx-user-portal.onrender.com`, `http://localhost:3000`, `http://localhost:3001`,
  with `credentials: true`. Never falls back to reflect-any-origin — keep it that way.

---

## 2. Auth & session wiring (per principal — there are SIX kinds of credentials)

### 2.1 Member (user portal + website)
- Login: `POST /api/auth/login` -> `{ token, user }`, JWT `{ id, email, is_admin }`, 7d expiry.
- Storage keys — **shared vocabulary between medx.hr and the portal, do not rename**:
  - `medx_user_token` (JWT), `medx_user_data` (user JSON) — set by the portal AND by the
    website's own sign-in modal (site.js:439). The site's bridge, the server-rendered
    registration pages (`PLEX_AUTH`, `PE_TOKEN`), and the SPA all read these exact keys.
  - `medx_session_expired` — site-side soft-expiry marker (server-confirmed 401/403 drops ONLY
    the token, keeps the name for warm re-entry; network failure must NEVER clear the session).
- **`?mxt=` token handoff (cross-origin session transfer)**: the site appends
  `?mxt=<token>` to portal-bound links; the user SPA shell adopts it into `medx_user_token` and
  strips it via history.replaceState (user frontend/index.html:52-54). `GET /forum/enter?token=`
  redirects to `/forum?mxt=<jwt>`. Deep-link form: `PORTAL/?mxt=<tok>#<hash>` (e.g. `#mymedx`).
  The redesigned SPA must keep adopting `?mxt=` on EVERY entry path.
- Full member auth surface (user portal): `POST /api/auth/register`,
  `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` (+ page
  `/reset-password/:token`), `POST /api/auth/change-password`, `POST /api/auth/request-verification`,
  `GET /api/auth/verify?token=`, `GET /api/auth/me`, `PUT /api/auth/profile`,
  `GET /api/auth/my-data` (data export), `DELETE /api/auth/account`.
- Middleware behavior the UI depends on (user server.js:6080): `Bearer` header; a token minted
  before a password change is rejected 401 "Session expired" (`password_changed_at`); deleted
  accounts get 401 "This account has been closed."; dev sentinel token `auto-login`.
- Legacy key: one badge-connect template page reads `localStorage.userToken`
  (user server.js:2586, `/api/networking/connect-by-badge`). Keep tolerating it.

### 2.2 Admin / staff (admin portal)
- Login: `POST /api/auth/login` -> `{ success, token, mustChangePassword, user }` where user
  carries `is_admin, is_staff, is_founder, allowed_sections` (array | null, pre-parsed).
- Storage: `localStorage.medx_token` (primary), **legacy fallback read of `localStorage.token`**
  (admin frontend:16940, 36813), `medx_user` (user JSON). Boot revalidates via `GET /api/auth/me`.
- **must_change_password flow**: login answering `mustChangePassword: true` locks the SPA into a
  change-password screen; only `POST /api/auth/change-password` is accepted; on success the SPA
  proceeds with `must_change_password: 0`. Invites (Team Access) create/repurpose accounts with a
  temp password + `must_change_password = 1`, `allowed_sections = '[]'` (Home only).
- Other admin auth routes: `POST /api/auth/register` (authLimiter), `PUT /api/auth/profile`,
  `PUT /api/auth/password`.
- Presence heartbeat: `POST /api/team/heartbeat` on load + every 60s (feeds founder usage stats).
- Founder: `users.is_founder` seeded idempotently at boot for `juginovic.alen@gmail.com`
  (admin server.js:8863). `founderOnly` middleware gates usage stats + permission grants.
  The founder can never be restricted (guard in the PUT + short-circuit in `sectionDenied`).
- Tech dashboard: additional `TECH_PASSWORD` env gate.

### 2.3 Applicant (Accelerator — separate principal, both portals serve it)
- Pages: `GET /apply` on BOTH portals (self-contained applicant SPA in a template string).
- API: `POST /api/applicant/register`, `POST /api/applicant/login`,
  `GET /api/applicant/verify/:token` (consumed via `/apply?verify=<token>` then
  history.replaceState to `/apply`), `GET/PUT /api/applicant/profile`,
  `GET/POST /api/applicant/applications`, `POST/PUT /api/applicant/applications/...`,
  `DELETE /api/applicant/documents/...`, `GET /api/applicant/programs`.
- Storage: `localStorage.applicantToken` (both portals' /apply pages).

### 2.4 External reviewer / interviewer (magic link — the token IS the whole credential, no JWT)
- Admin `GET /review?token=` -> talks ONLY to `/api/review-access/:token/*`
  (`GET /:token`, `GET /:token/submission/:assignmentId`, `POST /:token/scorecard/:assignmentId`,
  `POST /:token/recuse/:assignmentId`). Bilingual EN/HR; per-cycle blind toggle honored server-side.
- Interview console `GET /evaluate?token=` exists on BOTH portals; talks to
  `/api/accelerator/interview-access/*`. Links are minted as
  `${baseUrl}/evaluate?token=${interviewer.access_token}` by
  `POST /api/accelerator/interviewers/:id/send-link`; token lifecycle via
  `POST .../regenerate-token`. (Admin SPA + user SPA both host the management calls.)
- Storage on those pages: `rv_lang` (reviewer language), `medx_auction_lang`.

### 2.5 Forum member via magic link (passwordless)
- `POST /api/forum/wing/request-link` (neutral response, no enumeration) -> email ->
  `GET /forum/enter?token=` (table `forum_magic_tokens`, single-use, expiring) ->
  `/forum?mxt=<jwt>`. Magic-link-only accounts carry password hash sentinel
  `'!magic-link-no-password!'` so password login can never succeed for them.
- The forum wing page (`user-portal/frontend/forum-wing.html`) calls:
  `/api/forum/wing/me|directory|convenings`, `POST /api/forum/wing/convenings/...`,
  `PATCH /api/me`, `POST /api/public-events/register`, `POST /api/public/forum-consideration`.

### 2.6 Speakers, guest passes, volunteers (token pages)
- Speaker console: `POST /api/speakers/auth` (invite code `SPK-XXXX-2026` format) and the
  server-rendered `GET /speaker/:token` (+ `/speaker/:token/manifest.json`) plan page; document
  upload endpoints `/api/speakers/:id/documents`. Storage: `medx_speaker_prefs`,
  `medx_speaker_data`, `medx_speaker_lang`, `medx_speaker_atsh`.
- Guest/VIP passes: `GET /pass/:token` (+ `/calendar.ics`, `/manifest.json`) on the user portal;
  admin manages via `/api/admin/guest-passes*`, member self-service via `/api/guest-passes`.
  Unknown and revoked tokens answer identically (no existence leak) — preserve that behavior.
- Volunteer invites: magic-link tokens (crypto-random hex; the token is the whole credential),
  staff-tracking console gated the same way (admin `/api/staff-tracking`, section `gameday`).

---

## 3. Admin permission system — THE most breakable wiring in a redesign

Enforcement is server-side in ONE place: the admin `auth()` middleware calls `sectionDenied()`
on every authenticated request (admin server.js:1072-1146). Deny returns
`403 { error, section }` and the SPA shows a locked state. Everything the SPA does (hiding nav)
is UX only. `users.allowed_sections`: `NULL` = full access, `'[]'` = Home only, else JSON array
of section ids. Managed by `GET/PUT /api/admin/team/permissions` (founderOnly).

### 3.1 PERMISSION_SECTIONS — the 19 permission ids (admin server.js:1153)
`plexus`, `accelerator`, `forum`, `bridges`, `gameday`, `conferences`, `editions`,
`signup-forms`, `guest-passes`, `year-calendar`, `cme`, `pr-media`, `member-ops`, `finances`,
`contacts`, `advisors`, `files`, `team`, `tech`.
These ids are STORED IN THE DATABASE per admin. They are also the SPA's own nav /
`admin_section_preferences` ids ("one shared language" — comment at server.js:1149).

### 3.2 SECTION_ROUTE_MAP — route-prefix -> section (admin server.js:1183, verbatim)
Boundary-aware prefix match, first match wins, deeper prefixes listed first. Policy:
DENY-only-what-is-mapped — anything unlisted (auth, me, section prefs, team chat, heartbeat,
bell, dashboard prefs, tasks, pinned, projects meta, public routes, member self-service like
`/api/registrations` + `/api/abstracts`, cross-section reads like `/api/conferences`) stays
reachable for every signed-in admin.

| Prefix | Section |
|---|---|
| /api/admin/export/forum-registrations | forum |
| /api/plexus, /api/admin/plexus, /api/admin/plexus-experience, /api/gala, /api/admin/gala, /api/checkin, /api/admin/checkin, /api/admin/scan-context, /api/admin/auctions, /api/admin/auction-summary, /api/admin/speaker-itineraries, /api/admin/speaker-kits, /api/admin/sponsor-reports, /api/admin/sponsor-tiers, /api/admin/talks, /api/admin/sessions, /api/admin/spatial, /api/admin/abstracts, /api/admin/registrant, /api/admin/registrant-emails, /api/admin/registrations, /api/admin/registration-links, /api/admin/seat-confirmations, /api/admin/waitlist, /api/admin/waitlist-offers, /api/admin/early-bird, /api/admin/coupons, /api/admin/tickets, /api/admin/event-invites, /api/admin/event-reminders, /api/admin/event-survey, /api/admin/event-components, /api/admin/post-event, /api/admin/testimonials, /api/admin/print, /api/admin/wallet, /api/admin/analytics, /api/admin/export | plexus |
| /api/accelerator, /api/admin/accelerator, /api/admin/accelerator-sites, /api/applicant, /api/admin/review, /api/review-access, /api/admin/opportunities, /api/admin/research | accelerator |
| /api/forum, /api/admin/forum, /api/admin/council | forum |
| /api/bridges, /api/admin/bridges, /api/admin/croatians-abroad | bridges |
| /api/gameday, /api/admin/gameday, /api/staff-tracking, /api/admin/staff-tracking | gameday |
| /api/admin/conferences | conferences |
| /api/admin/editions | editions |
| /api/admin/signup-forms | signup-forms |
| /api/admin/guest-passes, /api/admin/guest-pass-events, /api/admin/member-guest-passes | guest-passes |
| /api/admin/year-calendar | year-calendar |
| /api/admin/cme | cme |
| /api/pr, /api/admin/pr, /api/admin/pr-newsletters, /api/admin/newsletters, /api/admin/newsletter-interests, /api/admin/newsletter-segments, /api/admin/audiences, /api/admin/content, /api/admin/content-blocks, /api/admin/content-checklist, /api/admin/feed-items, /api/admin/digest, /api/sequences | pr-media |
| /api/admin/messages, /api/admin/member-announcements, /api/admin/announcements, /api/admin/member-meta, /api/admin/member-card-toggles, /api/admin/bulk-email, /api/admin/outbox, /api/admin/rewards, /api/admin/users, /api/admin/notifications | member-ops |
| /api/finance, /api/admin/transparency | finances |
| /api/contacts, /api/admin/outlook | contacts |
| /api/admin/advisors | advisors |
| /api/files, /api/folders, /api/admin/files, /api/upload | files |
| /api/admin/team | team |
| /api/admin/tech, /api/admin/system-health, /api/admin/health, /api/admin/audit-log | tech |

### 3.3 The SPA side — WARNING: nav section ids are load-bearing
The admin SPA's nav `data-section` ids are the permission vocabulary. **Renaming a nav id in the
redesign breaks stored permissions and stored per-user section preferences** (both live in the
DB: `users.allowed_sections` + `admin_section_preferences`), breaks `#hash` deep links, and
breaks the NAV_TO_PERM mapping. Current `data-section` id inventory (admin frontend):
`advisors announce audit cme conferences contacts content-studio discover editions email-blast
files finances gameday guest-passes health member-feed member-ops merch-studio messages
newsletter outbox portal-content pr-media resources signup-forms team team-chat tech
transparency user-notifications website-content year-calendar` (+ `dashboard` and the project
ids `plexus accelerator forum bridges` rendered into `#projectsList`).

- `NAV_TO_PERM` (admin frontend:18465): `gala/auctions/postevent/event-invites/event-reminders/
  event-tracking/speaker-itineraries -> plexus`, `gameday-settings -> gameday`,
  `content-studio/newsletter/merch-studio/portal-content/website-content/member-feed -> pr-media`,
  `outbox/messages/announce/email-blast/user-notifications -> member-ops`,
  `transparency -> finances`, `health/audit -> tech`, `resources -> files`,
  `network -> contacts`; anything unlisted maps to itself.
- `PERM_ALWAYS` = `dashboard, discover, team-chat, settings` (mirrors server's unmapped routes).
- `CORE_PROJECTS` = `plexus, accelerator, forum, bridges` (never hidden on the prefs axis).
- `OPS_ALWAYS_VISIBLE` (admin frontend:18648) — list of nav ids exempt from prefs filtering.
- Self-chosen section prefs: `GET/POST /api/admin/sections` (onboarding modal); permission-
  restricted members skip onboarding.
- Hash routing: `showSection()` + `history.replaceState('#'+section)`; `#scanner` is
  special-cased BEFORE app boot (admin frontend:70) for the check-in scanner; `?track` query
  opens the tracking panel (frontend:57705). Keep `#<section-id>` URLs working.

### 3.4 Locked-state contract
Any 403 with `{ section }` -> `showLockedSection(navId)` clean state ("Ask Alen — he grants
access per section"). Redesign must keep a locked-state screen for 403s, not a broken page.

---

## 4. Cross-property links (site <-> user portal <-> admin portal <-> picker)

### 4.1 Site -> user portal URLs (baked into medx.hr HTML + stamped by site.js)
These URLs exist in the wild (site pages, emails, press). None may 404 after the redesign:
- `https://medx-user-portal.onrender.com/` — portal home / login / SPA shell
- `/plexus` — server-rendered combined registration page. Site stamps intent params:
  `?event=<data-medx-reg, default plexus-2026>&ticket=<data-medx-reg-ticket || live
  pricing_phase>&from=website[&mxt=<token>]` (site.js:1297 `mxRegUrl`). The page itself
  consumes `?t=` / `/plexus/:token` = `registration_links` token (label, expiry, max_uses,
  component_keys filtering conference/bridges/gala). `event/ticket/from` are entry-intent
  params — currently tolerated unread; they must at minimum never break the page.
- `/apply` — Accelerator application start
- `/forum` — Biomedical Forum page; `/f/dozqZ4xG` — short event link (any `/f/:slug`)
- `/mymedx` — member area deep link (SPA)
- `/donate/checkout?src=medx.hr` — donation checkout (params incl. `src`, amount, designation,
  frequency; invalid input falls back to safe defaults, never blocks)
- `/?mxt=<token>` and `/?mxt=<token>#<hash>` — signed-in app handoff (menu "Open the app",
  next-event chip -> `#mymedx`, notification targets `app:<hash>`)
- `/health` — warm-ping target (interceptor currently disabled, code + CI still call it)
- Desktop app installers: `https://github.com/alen-ops99/medx-portal/releases/download/v1.1.0/`
  (site.js:374 "Get the app" flow).
- Admin origin from the site: account menu "Admin console" link (`is_admin` users only) ->
  `https://medx-admin-portal.onrender.com/`.

### 4.2 Site JS -> portal APIs (CORS calls from medx.hr; the site is a second frontend)
From `MedXBridge` + `MedXLive` + beacons (site.js) — the redesigned PORTAL BACKEND surface these
hit must stay, and the redesigned PORTAL UI must keep the same localStorage vocabulary because
the site writes it:
- `POST {user}/api/auth/login` (website-native sign-in modal)
- `GET {user}/api/bell-feed?limit=30` (bell union: personal notifications + announcements;
  announcement ids arrive as `ann:<id>`; NOT `/api/feed` which is feed_items)
- `PUT {user}/api/user-notifications/mark-all-read`, `PUT {user}/api/user-notifications/:id/read`
- `GET {user}/api/me/next-event` (nav chip; fields: registered, event_name, date_short,
  balance_due, has_gala)
- `GET {user}/api/public/site`, `/api/public/content`, `/api/public/status`,
  `/api/public/supporters` (MedXLive hydration; 4.5s timeout; SWR cache key `medx_live_cache`;
  build-time seed `data/site-snapshot.json`)
- `GET {admin}/api/public/press` (press releases; locale rule: EN pages show non-hr, /hr/ shows hr)
- `POST {user}/api/public/pv` (privacy-friendly pageview beacon; sendBeacon, text/plain body
  `{path, ref}`; respects DNT/GPC)
- Netlify Forms POST `/` with `form-name=newsletter` (newsletter capture + dead-letter fallback
  forms — stays on the site side, but the fallback only appears when the portal is unreachable).

Site-side notification target vocabulary (admin composer writes it, site.js:584-607 routes it):
`site:<plexus|gala|accelerator|forum|bridges>` -> marketing pages, `app:<hash>` ->
`PORTAL/?mxt=<tok>#<hash>`, absolute http(s) URLs pass through; keyword fallback sends
ticket/payment/wallet/confirmed/receipt to `#mymedx`. The ADMIN portal's notification composer
must keep emitting these token forms.

Site data attributes that bind to portal data (`data-medx-slot`, `data-medx-fmt`,
`data-medx-html`, `data-medx-list` [site:speakers | press:releases | supporters:wall],
`data-medx-strip`, `data-medx-status-cta` / `data-medx-status-dot` (+ `CTA_ALLOW` map incl.
`apply -> PORTAL/apply`, `portal -> PORTAL/`, `register -> PORTAL/plexus`),
`data-medx-countdown`, `data-medx-jsonld`, `data-medx-cta` [+ `data-medx-closed` registration-
closed state driven by `site.conference.registration_open`], `data-medx-reg` /
`data-medx-reg-ticket`) — the ADMIN content/status/speakers/supporters/press editors feed these.
Field names in `/api/public/*` payloads are therefore part of the contract:
`site.conference.{start_date,end_date,date_range,keynote_count_word[_hr],registration_open,
pricing_phase}`, `site.price.*` + `site.price.currency`, `site.deadline.*`, `site.speakers[]
{name,title,photo,is_keynote,talk,...}`, `content.blocks{key:{body,body_hr}}`,
`status.projects[]{project_key,status_label[_hr],detail_line[_hr],cta_label[_hr],cta_target,
status_kind}`, `supporters.groups[]`, press releases array with `lang`.

### 4.3 Admin portal -> user portal (browser cross-origin + server-to-server)
- BROWSER: admin SPA `POST {user}/api/admin/payments/gala/:id/refund` with the ADMIN Bearer
  token (admin frontend:43173; user route: `POST /api/admin/payments/:kind/:id/refund`,
  auth + adminOnly, user server.js:733). Depends on: user CORS allowlist containing the admin
  origin AND the shared JWT_SECRET. localhost maps to `http://localhost:3001`.
- BROWSER: `memberBaseHref()` (admin frontend:46913) and Quick Action "View member portal" open
  the user portal; a member-impersonation preview uses `localhost:3010` in dev (frontend:53641).
- SERVER: admin backend fetches `GET {user}/api/public/registrations/:email`
  (admin server.js:11309, guest-pass/dupe cross-check).
- SERVER (module import, monorepo coupling): admin backend `require`s
  `../../user-portal/backend/fira-service` (line 21), reads
  `../../user-portal/frontend/assets` (2061) and `../../user-portal/backend/uploads/speakers`
  (29858). The two portals MUST stay in one repo/filesystem layout or these break.
- Admin-sent emails embed USER-portal URLs (minted via `userPortalBase()` = `USER_PORTAL_URL`
  env): hosted ticket QR `{user}/qr/:id.png` (Gmail strips data: URIs — the hosted PNG is
  load-bearing), gala payment links `{user}/pay/gala/:token`, `{user}/#gala`, survey tap links,
  speaker pages `{user}/speaker/:token`, invite pages, `{user}/assets/logo.png`.
- Admin-origin public pages linked from admin-sent emails: `/e/:token` (event invite page),
  `/a/:token` (auction bid page; `?display=1` = projector mode), `/newsletter` (public signup,
  `POST /api/public/newsletter/subscribe`), `/review`, `/evaluate`, `/apply`.
- Photo CDN: newsletters/digests load images via
  `https://cdn.jsdelivr.net/gh/alen-ops99/medx-portal@main/user-portal/frontend/assets/...`
  (admin server.js:23038,23056) — moving/renaming those asset paths in the repo breaks email
  images already in inboxes. Treat `user-portal/frontend/assets/photos` as append-only.

### 4.4 Admin portal -> gala table picker (Firestore)
`admin-portal/backend/picker-sync.js` — portal is source of truth for gala invites:
- Auth: Google Identity Toolkit `signInWithPassword` as the organizer console account
  (`PICKER_ADMIN_EMAIL`/`PICKER_ADMIN_PASSWORD`; unset = clean no-op `configured:false`).
- Firestore REST (`https://firestore.googleapis.com/v1`), project `plexus-gala-tables`
  (public web API key baked in, overridable via `PICKER_FB_API_KEY`).
- Data contract: `invites/{token}` (doc id IS the guest credential, 16 hex chars; guest link =
  `https://plexus-tables.netlify.app/?t=<token>`); `paid_emails/{sha256hex(lower(trim(email)))}`
  — the hash MUST stay byte-identical to the picker client's sha256hex.
- Scanner integration: picker tickets QR to `https://plexus-tables.netlify.app/ticket.html?id=<tid>`
  (`PICKER_TICKET_HOST`) — the admin check-in scanner recognizes that URL shape.
- Runs: manual + auto sweep every 30 min (admin server.js:43303). Refund/delete kills unpicked
  invites instantly; booked tables are only FLAGGED, never auto-deleted.

### 4.5 Stripe return URLs (browser round-trip contract)
The redesigned user SPA must keep parsing these query params on `/`:
`?payment=success|cancelled` + `type=accelerator&app=`, `type=forum&reg=`, `reg=` (plexus),
`gala=` (gala), plus pages `/invite-success?session_id={CHECKOUT_SESSION_ID}` and
`/invite-cancelled`. Donations return to the SITE: `https://medx.hr/donate?thanks=1` /
`?cancelled=1` / `?checkout_error=1` — the site page owns those states.

---

## 5. Public (no-auth) API surface — the website's read contract
User portal: `GET /api/public/site | content | status | impact | supporters | survey |
survey/recommend`, `POST /api/public/survey/comment`, `POST /api/public/pv`,
`GET /api/public/speaker-itinerary/:token`, `POST /api/public/forum-consideration`,
`POST /api/public-events/register`, `GET /api/public/registrations/:email` (admin S2S),
plus `GET /api/plexus/stripe-config`, `GET /api/push/vapid-key`.
Admin portal: `GET /api/public/press` (+ per-release pages), `POST /api/public/newsletter/subscribe`,
`GET/POST /api/public/auction/...` (bid pages).
All are rate-limited and CORS-scoped (section 1b). These are consumed by a STATIC site with a
never-blank fallback design — an empty/error answer keeps baked HTML, so changing a payload
field name silently freezes the site's live data rather than erroring. Field names are contract.

---

## 6. Inbound URL map — pages that live in already-sent emails, QR codes, and print
Nothing here may change shape. User portal (server-rendered unless noted):
`/` (SPA; adopts ?mxt, parses ?payment=..., manifest start_url `/?app=1`),
`/plexus`, `/plexus/:token` (+`?t=`), `/apply` (+`?verify=`), `/building-bridges`, `/donor-night`,
`/donate/checkout`, `/forum`, `/forum/enter?token=`, `/f/:slug` (+`/qr.png`, `/calendar.ics`),
`/evaluate?token=`, `/email-prefs`, `/unsubscribe` (one-click, immediate), `/r/:token`
(referral/reward link), `/invite/:data` (base64url payload invite page), `/invite-success`,
`/invite-cancelled`, `/pass/:token` (+`/calendar.ics`, `/manifest.json`), `/pay/gala/:token`,
`/privacy`, `/terms`, `/qr/:id.png` (hosted ticket QR referenced by admin emails),
`/reset-password/:token`, `/speaker/:token` (+`/manifest.json`), `/verify/:token`,
`/verify-certificate`, `/calendar/medx-events.ics`, `/calendar/:file`, `/health`,
catch-all `GET *` -> SPA index (paths WITH file extensions 404 instead — keep that guard).
Admin portal: `/` (SPA), `/health`, `/a/:token` (+`?display=1`), `/e/:token`,
`/evaluate?token=`, `/review?token=`, `/apply`, `/newsletter`, static `/photo-library`, `/uploads`.

---

## 7. External integrations (each with env keys and graceful-degradation behavior)

| Integration | Where | Wiring | Degrades to |
|---|---|---|---|
| Stripe (payments) | user backend (checkout + webhook + refunds); admin (health checks, reconciliation via `STRIPE_READONLY_KEY`) | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (served via `/api/plexus/stripe-config`), `STRIPE_WEBHOOK_SECRET`; **`POST /api/stripe/webhook` requires RAW body — express.json is skipped for exactly that path (user server.js:645); webhook is idempotent (dupe event ids skipped)**; browser loads js.stripe.com / checkout.stripe.com (CSP) | demo mode / no card payments |
| Brevo (transactional email) | BOTH backends | `POST https://api.brevo.com/v3/smtp/email`, header `api-key: BREVO_API_KEY`; `EMAIL_FROM` ("Med&X <noreply@medx.hr>"); `CONFIRMATION_CC` (default laura.rodman@medx.hr); `EMAIL_LOGO_URL`; dev: `EMAIL_DUMP_DIR` writes .eml. WARNING: render.yaml + one admin toast still say `RESEND_API_KEY` — legacy name, the live check is `BREVO_API_KEY` (admin server.js:70 `mailProviderReady`) | dev: mock success; prod: loud "[EMAIL DROPPED]" |
| Google Sheets mirror | user backend | `GOOGLE_SHEETS_WEBHOOK` (Apps Script URL; receiving end in `docs/google-sheets-apps-script.gs`); fire-and-forget POST after commit; `events` field picks the sheet tab | silently skipped |
| Google Wallet passes | shared/wallet.js, both portals | service account JWT (RS256) -> `https://oauth2.googleapis.com/token`, objects API `walletobjects.googleapis.com/walletobjects/v1`, save links `https://pay.google.com/gp/v/save/<jwt>`; `GOOGLE_WALLET_ISSUER_ID` (3388000000023175280), `GOOGLE_WALLET_EVENT_CLASS_ID` (…plexus_week_2026), `GOOGLE_WALLET_SA_KEY`; user endpoints `GET /api/member/wallet/google[, /ticket/:regId]`; admin `POST /api/admin/wallet/provision` | `{configured:false}`, nothing breaks |
| Apple Wallet | user backend | `GET /api/member/wallet/apple/ticket/:regId` (.pkpass); `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_PASS_TYPE_ID`, `APPLE_WALLET_CERT_PEM`, `APPLE_WALLET_KEY_PEM` | unconfigured = off |
| Web Push (VAPID) | user backend | `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `DELETE /api/push/unsubscribe`; `VAPID_PUBLIC_KEY` (committed), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:accelerator@medx.hr); outbox drained every 45s | push disabled, logged |
| Anthropic (AI drafts + admin assistant + AI executive suite) | shared/ai.js + admin backend (11 uses) + admin template pages | `POST https://api.anthropic.com/v1/messages`; `ANTHROPIC_API_KEY`, `AI_DRAFT_MODEL`, `AI_DRAFT_RATE_MAX`, `ASSISTANT_MODEL`, `ASSISTANT_MODEL_COMPLEX` | AI features off |
| FIRA fiscal invoicing (Croatian fiscalization) | user-portal/backend/fira-service.js, REQUIRED by BOTH backends | `https://app.fira.finance` API; `FIRA_API_KEY`, `FIRA_API_URL`, `FIRA_DISABLED`, `ENABLE_FIRA_ON_MARK_PAID`; card payments get the invoice AFTER the Stripe webhook confirms | off |
| Amadeus flight search | admin backend | OAuth token + Flight Offers Search; `AMADEUS_API_KEY`, `AMADEUS_API_SECRET`, `AMADEUS_ENV` (test|production selects test.api.amadeus.com vs api.amadeus.com), `AMADEUS_BASE_URL` override; deep links to Google Flights / Skyscanner remain as plain links | clean key-gate + manual fare table |
| Publer (social scheduling) | admin backend | `https://app.publer.com/api/v1` (`/accounts`, posts); `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID` | not_configured |
| Meta Graph API | admin backend | `https://graph.facebook.com/v21.0` (IG publishing pipeline) | off |
| Microsoft Graph (Outlook threads, My Network) | admin backend | `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID`, `MS_GRAPH_MAILBOX` (default team@medx.hr); one-time admin consent | dev mock threads; prod: configured-check |
| Cloudinary (durable uploads) | both backends | `CLOUDINARY_URL` auto-config; `https://*.cloudinary.com` in CSP connect-src; without it prod storage is EPHEMERAL (admin server.js:5529) | local disk (lost on redeploy) |
| Firestore + Identity Toolkit (gala picker) | admin backend | see section 4.4 | configured:false no-op |
| Turso (DB) | both + CI | see 1a; nightly backup workflow + pre-deploy backup (GitHub secret TURSO_AUTH_TOKEN = platform token, repo alen-ops99/medx-portal, db name `medx-portal`) | local sqlite only |
| Google Calendar links | both | `https://calendar.google.com/calendar/render` template links + self-hosted `.ics` routes | — |
| CDN script/style dependencies | both frontends | cdn.jsdelivr.net, cdnjs.cloudflare.com (FontAwesome, Chart.js, html5-qrcode, jsQR), unpkg.com, fonts.googleapis.com/gstatic — ALL enumerated in each backend's helmet CSP (user server.js:599, admin server.js:891). A redesigned frontend adding any new CDN host must extend the CSP in the SAME deploy or it will be blocked | — |

---

## 8. Environment variable contract (what the redesign must not orphan)

Render.yaml-declared (user portal): PORT=3000, NODE_ENV, JWT_SECRET (see 1a WARNING),
RESEND_API_KEY (legacy — live code uses BREVO_API_KEY), EMAIL_FROM, VAPID_PUBLIC_KEY,
VAPID_PRIVATE_KEY, VAPID_SUBJECT, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY,
STRIPE_WEBHOOK_SECRET, FIRA_API_KEY, FIRA_API_URL, MEDX_IBAN (placeholder -> bank-transfer
instructions hidden), MEDX_BANK_NAME, MEDX_SWIFT, MEDX_COMPANY_NAME, MEDX_VAT_ID (reserved),
TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_EVENT_CLASS_ID,
GOOGLE_WALLET_SA_KEY.
Render.yaml-declared (admin): PORT=3001, NODE_ENV, JWT_SECRET, RESEND_API_KEY (legacy),
EMAIL_FROM, AMADEUS_API_KEY/SECRET/ENV, PICKER_ADMIN_EMAIL, PICKER_ADMIN_PASSWORD,
TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GOOGLE_WALLET_* (same three).

Read by code but NOT in render.yaml (dashboard-only / optional — do not delete when tidying):
- User backend: BREVO_API_KEY, GOOGLE_SHEETS_WEBHOOK, PUBLIC_BASE_URL, PORTAL_URL,
  USER_PORTAL_URL, ADMIN_PORTAL_URL, RENDER_EXTERNAL_URL (Render-injected), RENDER,
  EMAIL_DUMP_DIR, EMAIL_LOGO_URL, CONFIRMATION_CC, CME_ENC_KEY, CLOUDINARY_URL, DATABASE_PATH,
  KEEP_WARM (opt-in self-ping every 14 min), PDF_FONT_PATH, PDF_FONT_BOLD_PATH,
  APPLE_WALLET_TEAM_ID/PASS_TYPE_ID/CERT_PEM/KEY_PEM, GOOGLE_WALLET_CLASS_ID,
  GOOGLE_WALLET_TICKET_CLASS_ID.
- Admin backend: ANTHROPIC_API_KEY, ASSISTANT_MODEL, ASSISTANT_MODEL_COMPLEX, BREVO_API_KEY,
  CORS_ORIGIN, USER_PORTAL_URL, ADMIN_PORTAL_URL, PUBLIC_BASE_URL, SITE_PUBLIC_URL,
  FORUM_SITE_URL, STRIPE_SECRET_KEY, STRIPE_READONLY_KEY, PUBLER_API_KEY, PUBLER_WORKSPACE_ID,
  MS_GRAPH_CLIENT_ID/CLIENT_SECRET/TENANT_ID/MAILBOX, CME_ENC_KEY, CLOUDINARY_URL,
  TECH_PASSWORD, NAG_UNPAID_DAYS, NAG_DUE_SOON_DAYS, SPONSOR_FOLLOWUP_DAYS,
  ENABLE_FIRA_ON_MARK_PAID, FIRA_API_KEY, KEEP_WARM, DATABASE_PATH, GHOSTSCRIPT_PATH,
  CHROME_PATH, PUPPETEER_EXECUTABLE_PATH, PDF_FONT_PATH, PDF_FONT_BOLD_PATH,
  PICKER_FB_PROJECT_ID, PICKER_FB_API_KEY, PICKER_BASE_URL, PICKER_TICKET_HOST,
  PICKER_FS_BASE, PICKER_AUTH_BASE (test seams), AMADEUS_BASE_URL.
- shared/: AI_DRAFT_MODEL, AI_DRAFT_RATE_MAX, GOOGLE_WALLET_OBJECTS_BASE,
  GOOGLE_WALLET_OAUTH_URL; fira-service: FIRA_DISABLED.

---

## 9. Background jobs, CI, and monitoring touchpoints (things that call the portals)
- In-process timers, user backend: monthly reminders (daily check), signup-form reminders
  (hourly), Turso `db.sync()` (60s), push outbox drain (45s), announcement fanout (20s),
  verification nudges (daily), milestone triggers (15 min), dev scheduled-email drain (20s),
  optional self keep-warm ping of `/health` (14 min, KEEP_WARM=1).
- Admin backend: monthly reminders, event campaigns (daily), reminders (daily), expired
  check-in reset (daily), Turso sync (60s), scheduled-email outbox drain (60s — production
  email delivery lives HERE), gala picker sweep (30 min), seat-confirm auto (daily), survey
  auto-stage (daily), post-event auto-run (daily), waitlist offer sweep (15 min), monthly
  digest + weekly pulse (daily checks), staff stale-scan (60s).
- GitHub Actions (repo `alen-ops99/medx-portal`): `boot-smoke.yml` (schema-sync +
  api-contract + real boot + `/health` + `/` + login probe), `smoke.yml` (daily 07:00 UTC),
  `keepalive.yml` (currently disabled cron; pings both `/health` URLs), `uptime-alert.yml`
  (every 6h: both portals + medx.hr), `turso-backup.yml` (nightly 03:17 UTC),
  `predeploy-backup.yml`, `pages.yml`.
- The admin Tech/System Health section reads env-presence and hits health checks — it is the
  in-app mirror of this section (admin server.js:34622 area).

## 10. PWA / offline contract
- User portal: `manifest.json` start_url `/?app=1`; sw.js `CACHE_NAME 'medx-portal-v9'`
  (+deploy SHA); precaches app shell incl. vendored QR generator so the event-day boarding
  pass renders fully offline; API responses NEVER cached. Admin: `medx-staff-v2`, `#scanner`
  works as an installed-PWA entry. `robots.txt` on both; admin also sends
  `X-Robots-Tag: noindex, nofollow` globally. Keep sw update flow + stamp-sw.sh compatibility.
- Offline check-in: admin scanner queues to `localStorage.checkinQueue` / `checkinRoster` and
  drains later — the redesign must preserve the queue keys or in-flight offline scans are lost.

## 11. Redesign landmines — the do-not-break checklist
1. Admin nav `data-section` ids = DB-stored permission + preference vocabulary (section 3.3).
2. `?mxt=` adoption on every user-portal entry path; `medx_user_token`/`medx_user_data`
   key names shared with medx.hr.
3. Shared JWT_SECRET + shared Turso DB across both services (section 1a).
4. `POST /api/stripe/webhook` must keep RAW body handling if any middleware is reordered.
5. Hosted QR `{user}/qr/:id.png` + `/pay/gala/:token` + `/pass|speaker|invite|f|r|e|a/:token`
   pages are in sent emails — URLs frozen forever.
6. `/api/public/*` payload FIELD NAMES feed a never-blank static site — renaming a field
   freezes medx.hr content silently (no error will surface).
7. User-portal CORS allowlist must keep the admin origin (gala refund) and site origins
   (login/bell/live-data); admin `/api/public` allowlist must keep the site origins.
8. `/health` on both portals; SPA catch-all `GET *` (extensionless only); 404-on-extension guard.
9. CSP allowlists live in each backend's helmet config — any new CDN/font/script host in the
   redesigned UI needs the CSP updated in the same deploy.
10. check-api-contract.js parses `fetch('/api/...')`, `.api('/api/...')`, `api('/api/...')`
    patterns — keep using literal `/api/` prefixes in code (dynamic URL-building defeats the
    tripwire and the audit history shows that class of bug shipping).
11. `localStorage.medx_token` (+ legacy `token` read) for admin; `applicantToken`;
    `checkinQueue`/`checkinRoster`; notification read/snooze keys on the site.
12. Notification target token vocabulary `site:*` / `app:*` between admin composer and site.js.
13. Monorepo file coupling: admin backend requires user-portal files by relative path
    (fira-service, frontend assets, uploads dirs); jsdelivr CDN serves
    `user-portal/frontend/assets/photos` to emails already sent — treat as append-only.
14. Stripe return-URL query params on `/` (`?payment=...&reg/app/gala=`) parsed by the SPA.
15. `start_url /?app=1`, `#scanner`, `#<admin-section>` and `#mymedx`-style hashes are
    installed-PWA and email deep links — hash routing must survive.
16. The `sendEmail` boundary checks `BREVO_API_KEY` (NOT the RESEND key render.yaml mentions).
17. Both `/apply` applicant consoles and `/evaluate` interviewer consoles exist on BOTH
    portals — the user-facing one is linked from medx.hr, the admin-origin one from emails.
    Both must survive.

---

## Appendix A — User portal SPA: every API call the redesigned member UI must keep making

Source: `user-portal/frontend/assets/app.part1-14.js` (the SPA shell index.html adds:
`GET /api/rewards/summary`, `GET /api/registrations/my`, `GET /api/member/meta`,
`GET /api/forum/wing/me` — via an optional `API_BASE` global + Bearer header).
`:p` = dynamic segment. Auth: Bearer `medx_user_token` unless the route is public.

```
POST /api/accelerator/applications
POST /api/accelerator/applications/:p/documents
POST /api/accelerator/applications/:p/evaluate-batch
GET /api/accelerator/applications/:p/full
POST /api/accelerator/applications/:p/message
PUT /api/accelerator/applications/:p/validity
POST /api/accelerator/ask-coordinator
POST /api/accelerator/checkout-session
GET /api/accelerator/countdown
PUT /api/accelerator/criteria/:p
DELETE /api/accelerator/criteria/:p
PUT /api/accelerator/dates/:p
DELETE /api/accelerator/dates/:p
GET /api/accelerator/files/grouped
GET /api/accelerator/form-config
PUT /api/accelerator/form-config
GET /api/accelerator/institutions
POST /api/accelerator/institutions
GET /api/accelerator/intake
POST /api/accelerator/intake/
POST /api/accelerator/intake/draft
GET /api/accelerator/intake/mine
PUT /api/accelerator/interviewers/:p
DELETE /api/accelerator/interviewers/:p
POST /api/accelerator/interviewers/:p/regenerate-token
POST /api/accelerator/interviewers/:p/send-link
GET /api/accelerator/key-dates
GET /api/accelerator/my-applications
GET /api/accelerator/overview-config
GET /api/accelerator/registrations
GET /api/accelerator/results
GET /api/accelerator/sites
GET /api/accelerator/years
POST /api/accelerator/years
GET /api/accelerator/years/:p/applications
GET /api/accelerator/years/:p/criteria
POST /api/accelerator/years/:p/criteria
GET /api/accelerator/years/:p/dates
POST /api/accelerator/years/:p/dates
GET /api/accelerator/years/:p/institutions
PUT /api/accelerator/years/:p/institutions/:p
GET /api/accelerator/years/:p/interviewers
POST /api/accelerator/years/:p/interviewers
GET /api/accelerator/years/:p/pdf-settings
PUT /api/accelerator/years/:p/pdf-settings
POST /api/accelerator/years/:p/publish-rankings
POST /api/accelerator/years/:p/update-rankings
GET /api/admin/forum/applications
PUT /api/admin/forum/applications/:p
POST /api/admin/forum/bulk-email
POST /api/admin/forum/events/af26/checkin
GET /api/admin/forum/events/af26/checkins
GET /api/admin/forum/events/af26/invitations
POST /api/admin/forum/events/af26/invitations/send
POST /api/admin/forum/events/af26/invitations/send-all
GET /api/admin/forum/events/af26/registrations
PUT /api/admin/forum/events/af26/registrations/:p
GET /api/admin/forum/events/af26/schedule
POST /api/admin/forum/events/af26/schedule
PUT /api/admin/forum/events/af26/schedule/:p
DELETE /api/admin/forum/events/af26/schedule/:p
PUT /api/admin/forum/events/af26/settings
GET /api/admin/forum/events/af26/speakers
POST /api/admin/forum/events/af26/speakers
PUT /api/admin/forum/events/af26/speakers/:p
DELETE /api/admin/forum/events/af26/speakers/:p
GET /api/admin/forum/events/af26/stats
POST /api/admin/forum/gallery/folders
POST /api/admin/forum/groups
GET /api/admin/forum/invitations
POST /api/admin/forum/invitations/:p/resend
POST /api/admin/forum/invitations/send
POST /api/admin/forum/invitations/send-bulk
POST /api/admin/forum/media
GET /api/admin/forum/members
DELETE /api/admin/forum/members/:p
POST /api/admin/forum/notify-all
GET /api/admin/forum/prospects
POST /api/admin/forum/prospects
PUT /api/admin/forum/prospects/:p
DELETE /api/admin/forum/prospects/:p
POST /api/admin/forum/prospects/import
POST /api/admin/forum/prospects/preview
GET /api/admin/forum/stats
GET /api/admin/forum/templates
POST /api/admin/forum/templates
PUT /api/admin/forum/templates/:p
DELETE /api/admin/forum/templates/:p
POST /api/admin/plexus/:p/:p/approve
POST /api/admin/plexus/:p/:p/reject
GET /api/admin/plexus/abstracts
GET /api/admin/plexus/pending
GET /api/admin/plexus/registrations
POST /api/admin/plexus/speakers
PUT /api/admin/plexus/speakers/:p/publish
PUT /api/admin/plexus/sponsor-tasks/:p
DELETE /api/admin/plexus/sponsor-tasks/:p
GET /api/admin/plexus/sponsors
POST /api/admin/plexus/sponsors
PUT /api/admin/plexus/sponsors/:p
DELETE /api/admin/plexus/sponsors/:p
PUT /api/admin/plexus/sponsors/:p/publish
GET /api/admin/plexus/sponsors/:p/tasks
POST /api/admin/plexus/sponsors/:p/tasks
GET /api/admin/plexus/stats
GET /api/admin/plexus/volunteers
POST /api/admin/plexus/volunteers/:p/approve
POST /api/admin/plexus/volunteers/:p/reject
POST /api/af26/register
GET /api/announcements
DELETE /api/auth/account
POST /api/auth/change-password
POST /api/auth/forgot-password
POST /api/auth/login
GET /api/auth/me
GET /api/auth/my-data
POST /api/auth/register
POST /api/auth/request-verification
POST /api/bridges/apply
GET /api/bridges/events
POST /api/bridges/events/:p/register
DELETE /api/bridges/program/:p
PUT /api/bridges/program/:p/publish
DELETE /api/bridges/speakers/:p
PUT /api/bridges/speakers/:p/publish
GET /api/channels
POST /api/chat/dm
GET /api/chat/messages
POST /api/chat/messages
POST /api/connections/:p/respond
POST /api/connections/request
GET /api/dashboard/summary
GET /api/feed
GET /api/feed/home
POST /api/files/:p
DELETE /api/files/:p
GET /api/finance/bank-balance
POST /api/finance/bank-balance
DELETE /api/finance/bank-balance/:p
GET /api/finance/dashboard
POST /api/finance/invoices
PUT /api/finance/invoices/:p
DELETE /api/finance/invoices/:p
POST /api/finance/invoices/:p/issue
POST /api/finance/invoices/:p/mark-paid
GET /api/finance/my-travel-orders
GET /api/finance/payment-orders
POST /api/finance/payment-orders
GET /api/finance/payment-orders/:p
PUT /api/finance/payment-orders/:p
DELETE /api/finance/payment-orders/:p
GET /api/finance/reports/by-project
GET /api/finance/reports/by-work-unit
GET /api/finance/reports/monthly
GET /api/finance/settings
POST /api/finance/settings
POST /api/finance/transactions
GET /api/finance/transactions
GET /api/finance/transactions/:p
PUT /api/finance/transactions/:p
DELETE /api/finance/transactions/:p
POST /api/finance/travel-orders
GET /api/finance/travel-orders/:p
POST /api/finance/travel-orders/:p/approve
POST /api/finance/travel-orders/:p/pay
POST /api/finance/travel-orders/:p/reject
GET /api/finance/work-units
POST /api/finance/work-units
GET /api/finance/work-units/:p
PUT /api/finance/work-units/:p
DELETE /api/finance/work-units/:p
GET /api/finance/years
PUT /api/finance/years/:p
POST /api/folders/:p
DELETE /api/folders/:p
GET /api/forum/events
POST /api/forum/events/
GET /api/forum/events/:p
POST /api/forum/events/:p/checkout-session
POST /api/forum/events/:p/register
GET /api/forum/gallery/folders:p*
GET /api/forum/gallery/folders/:p
GET /api/forum/groups
GET /api/forum/groups/:p/members
POST /api/forum/groups/:p/membership
GET /api/forum/groups/:p/messages
POST /api/forum/groups/:p/messages
GET /api/forum/media:p*
POST /api/forum/opportunities
GET /api/forum/posts
POST /api/forum/posts
POST /api/forum/posts/:p/react
POST /api/gala/checkout-session
GET /api/gala/my-seat
GET /api/gala/my-status
POST /api/gala/register
GET /api/gala/settings
GET /api/guest-passes
POST /api/guest-passes
POST /api/guest-passes/
POST /api/intro-requests
GET /api/mentorship/mentors
GET /api/mentorship/profile
PUT /api/mentorship/profile
GET /api/mentorship/requests
POST /api/mentorship/requests
PUT /api/mentorship/requests/
GET /api/messages
POST /api/messages
GET /api/messages/:p
GET /api/networking/coffee-match
POST /api/networking/connections
GET /api/networking/connections
PUT /api/networking/connections/
PUT /api/networking/connections/:p
GET /api/networking/connections/pending
GET /api/networking/discover
GET /api/networking/meeting-requests
POST /api/networking/meeting-requests
PUT /api/networking/meeting-requests/:p
PUT /api/networking/profile
GET /api/notify-topics
POST /api/notify-topics
GET /api/opportunities
POST /api/opportunities
GET /api/pinned
POST /api/pinned
DELETE /api/pinned/:p
PUT /api/pinned/reorder
POST /api/plexus/abstracts
POST /api/plexus/abstracts/:p/files
GET /api/plexus/attendees
POST /api/plexus/checkin
POST /api/plexus/checkout-session
POST /api/plexus/cme/attach
GET /api/plexus/cme/status
GET /api/plexus/qa
POST /api/plexus/qa
POST /api/plexus/questions/
POST /api/plexus/register
POST /api/plexus/registration/:p*
GET /api/plexus/registration/:p/invoice
GET /api/plexus/schedule
POST /api/plexus/scholarship
GET /api/plexus/sessions
GET /api/plexus/settings
GET /api/plexus/speakers
GET /api/plexus/stats
GET /api/plexus/stripe-config
POST /api/plexus/visa-request
GET /api/portal-content/published
GET /api/portal-content/published/featured
GET /api/pr/ai-generations
POST /api/pr/ai-generations
POST /api/pr/ai-generations/:p/use
POST /api/pr/calendar
GET /api/pr/calendar/:p
PUT /api/pr/calendar/:p
POST /api/pr/campaigns
GET /api/pr/campaigns/:p
PUT /api/pr/campaigns/:p
GET /api/pr/dashboard
POST /api/pr/media
GET /api/pr/media/:p
DELETE /api/pr/media/:p
POST /api/pr/newsletters
GET /api/pr/newsletters/:p
PUT /api/pr/newsletters/:p
POST /api/pr/newsletters/:p/send
POST /api/pr/posts
POST /api/pr/subscribers
POST /api/pr/subscribers/:p/unsubscribe
PUT /api/projects/:p/settings
GET /api/projects/settings
POST /api/push/subscribe
DELETE /api/push/unsubscribe
GET /api/push/vapid-key
GET /api/register-direct/
POST /api/register-direct/
POST /api/rewards/redeem
GET /api/rewards/summary
GET /api/search
GET /api/sequences
POST /api/sequences
DELETE /api/sequences/:p
POST /api/sequences/:p/steps/:p/complete
POST /api/speakers/:p/documents
GET /api/speakers/:p/documents
DELETE /api/speakers/:p/documents/:p
POST /api/speakers/auth
GET /api/talks
POST /api/talks/
POST /api/tasks
GET /api/tasks/:p
DELETE /api/tasks/:p
PUT /api/tasks/:p
POST /api/tasks/:p/files
POST /api/tasks/:p/toggle
DELETE /api/tasks/files/:p
POST /api/team
GET /api/team
GET /api/team/me
PUT /api/timeline/:p
GET /api/timeline/:p
POST /api/timeline/:p
PUT /api/timeline/:p/:p
DELETE /api/timeline/:p/:p
POST /api/upload/abstracts
POST /api/upload/accelerator
GET /api/user-notifications
PUT /api/user-notifications/:p/read
PUT /api/user-notifications/mark-all-read
GET /api/user/admin-messages
PUT /api/user/admin-messages/:p/read
POST /api/user/admin-messages/:p/reply
```

## Appendix B — Admin portal SPA: every API call the redesigned admin UI must keep making

Source: `admin-portal/frontend/index.html`. Auth: Bearer `medx_token`. 654 unique method+path pairs.
Note the one CROSS-ORIGIN call (gala refund -> user portal) at the end of section 4.3.

```
POST   /api/accelerator/applications
POST   /api/accelerator/applications/:p/documents
POST   /api/accelerator/applications/:p/evaluate-batch
GET    /api/accelerator/applications/:p/full
POST   /api/accelerator/applications/:p/message
PUT    /api/accelerator/applications/:p/validity
DELETE /api/accelerator/criteria/:p
PUT    /api/accelerator/criteria/:p
DELETE /api/accelerator/dates/:p
PUT    /api/accelerator/dates/:p
GET    /api/accelerator/files/grouped
GET    /api/accelerator/form-config
PUT    /api/accelerator/form-config
POST   /api/accelerator/institutions
PUT    /api/accelerator/institutions/:p
DELETE /api/accelerator/interviewers/:p
PUT    /api/accelerator/interviewers/:p
GET    /api/accelerator/interviewers/:p/assignments
PUT    /api/accelerator/interviewers/:p/assignments
POST   /api/accelerator/interviewers/:p/regenerate-token
POST   /api/accelerator/interviewers/:p/send-link
GET    /api/accelerator/registrations
GET    /api/accelerator/years
POST   /api/accelerator/years
GET    /api/accelerator/years/:p/applications
GET    /api/accelerator/years/:p/criteria
POST   /api/accelerator/years/:p/criteria
GET    /api/accelerator/years/:p/dates
POST   /api/accelerator/years/:p/dates
GET    /api/accelerator/years/:p/institutions
PUT    /api/accelerator/years/:p/institutions/:p
GET    /api/accelerator/years/:p/interviewers
POST   /api/accelerator/years/:p/interviewers
GET    /api/accelerator/years/:p/pdf-settings
PUT    /api/accelerator/years/:p/pdf-settings
POST   /api/accelerator/years/:p/publish-rankings
POST   /api/accelerator/years/:p/update-rankings
GET    /api/admin/accelerator/analytics
GET    /api/admin/accelerator/overview-config
PUT    /api/admin/accelerator/overview-config
POST   /api/admin/accelerator/result-codes
POST   /api/admin/advisors/
POST   /api/admin/advisors/ask
GET    /api/admin/advisors/latest
GET    /api/admin/advisors/questions
POST   /api/admin/advisors/run/
GET    /api/admin/analytics
POST   /api/admin/assistant
POST   /api/admin/assistant/execute
GET    /api/admin/auctions
GET    /api/admin/auctions/
GET    /api/admin/audit-log
POST   /api/admin/bridges/checkin
POST   /api/admin/bulk-email/preview
POST   /api/admin/bulk-email/send
POST   /api/admin/bulk-email/test
GET    /api/admin/cards/roster
POST   /api/admin/cards/send
GET    /api/admin/change-map
GET    /api/admin/checkin/enrich
GET    /api/admin/checkin/events
GET    /api/admin/checkin/lookup
POST   /api/admin/checkin/ticket
POST   /api/admin/checkin/verify
GET    /api/admin/cme/events
GET    /api/admin/cme/events/
POST   /api/admin/conferences
POST   /api/admin/conferences/
PUT    /api/admin/conferences/
GET    /api/admin/content-checklist
POST   /api/admin/content-checklist
POST   /api/admin/content-checklist/
POST   /api/admin/content/asset
GET    /api/admin/content/assets
POST   /api/admin/content/converse
GET    /api/admin/content/pending-brief
POST   /api/admin/content/schedule
POST   /api/admin/content/video/compose
GET    /api/admin/content/video/prefill
POST   /api/admin/council/asset
POST   /api/admin/council/delete
GET    /api/admin/council/list
POST   /api/admin/council/save
POST   /api/admin/council/send
GET    /api/admin/coupons
POST   /api/admin/coupons
DELETE /api/admin/coupons/:p
GET    /api/admin/croatians-abroad/emails-by-event/:p
GET    /api/admin/croatians-abroad/invite-links
POST   /api/admin/croatians-abroad/invite-links
DELETE /api/admin/croatians-abroad/invite-links/:p
GET    /api/admin/croatians-abroad/registrations
GET    /api/admin/custom-fields
POST   /api/admin/custom-fields
DELETE /api/admin/custom-fields/:p
POST   /api/admin/design-assist
GET    /api/admin/design-presets
POST   /api/admin/design-presets
DELETE /api/admin/design-presets/
POST   /api/admin/digest/
GET    /api/admin/early-bird
POST   /api/admin/early-bird
POST   /api/admin/early-bird/
GET    /api/admin/editions
GET    /api/admin/editions/
GET    /api/admin/event-components
PUT    /api/admin/event-components/:p
GET    /api/admin/event-invites/campaigns
POST   /api/admin/event-invites/campaigns
DELETE /api/admin/event-invites/campaigns/
GET    /api/admin/event-invites/campaigns/
POST   /api/admin/event-invites/campaigns/
PUT    /api/admin/event-invites/campaigns/
GET    /api/admin/event-invites/catalog
POST   /api/admin/event-invites/discover
DELETE /api/admin/event-invites/invitees/
POST   /api/admin/event-invites/invitees/
POST   /api/admin/event-invites/reply-templates/
PUT    /api/admin/event-invites/reply-templates/
GET    /api/admin/event-reminders/sequences
POST   /api/admin/event-reminders/sequences
DELETE /api/admin/event-reminders/sequences/
GET    /api/admin/event-reminders/sequences/
POST   /api/admin/event-reminders/sequences/
PUT    /api/admin/event-reminders/sequences/
GET    /api/admin/event-survey/ai-summary
GET    /api/admin/event-survey/results
POST   /api/admin/event-survey/send
POST   /api/admin/event-survey/settings
GET    /api/admin/feed-items
DELETE /api/admin/feed-items/:p
PUT    /api/admin/feed-items/:p
GET    /api/admin/files
POST   /api/admin/files
DELETE /api/admin/files/
GET    /api/admin/files/:p/download
GET    /api/admin/forum/applications
PUT    /api/admin/forum/applications/:p
GET    /api/admin/forum/campaign
PUT    /api/admin/forum/campaign
POST   /api/admin/forum/campaign/
POST   /api/admin/forum/campaign/followup-tick
POST   /api/admin/forum/campaign/tick
GET    /api/admin/forum/candidates
DELETE /api/admin/forum/candidates/
GET    /api/admin/forum/candidates/
POST   /api/admin/forum/candidates/
PUT    /api/admin/forum/candidates/
POST   /api/admin/forum/candidates/dossier/bulk
POST   /api/admin/forum/candidates/import
POST   /api/admin/forum/candidates/import/commit
POST   /api/admin/forum/checkin
GET    /api/admin/forum/considerations
POST   /api/admin/forum/considerations/
GET    /api/admin/forum/convenings
GET    /api/admin/forum/events
POST   /api/admin/forum/events
DELETE /api/admin/forum/events/:p
PUT    /api/admin/forum/events/:p
POST   /api/admin/forum/events/:p/checkin
PUT    /api/admin/forum/events/:p/publish
GET    /api/admin/forum/events/:p/registrations
DELETE /api/admin/forum/events/:p/registrations/:p
GET    /api/admin/forum/events/:p/schedule
POST   /api/admin/forum/events/:p/schedule
DELETE /api/admin/forum/events/:p/schedule/:p
PUT    /api/admin/forum/events/:p/schedule/:p
PUT    /api/admin/forum/events/:p/toggle-checkin
GET    /api/admin/forum/gala-settings
PUT    /api/admin/forum/gala-settings
POST   /api/admin/forum/groups
DELETE /api/admin/forum/groups/:p
POST   /api/admin/forum/groups/:p/invite
POST   /api/admin/forum/media/folders
DELETE /api/admin/forum/media/folders/:p
GET    /api/admin/forum/members
DELETE /api/admin/forum/members/:p
GET    /api/admin/forum/stats
POST   /api/admin/gala/guest-message/draft
POST   /api/admin/gala/guest-message/queue
GET    /api/admin/gala/invite-links
POST   /api/admin/gala/invite-links
DELETE /api/admin/gala/invite-links/:p
GET    /api/admin/gala/menu-options
DELETE /api/admin/gala/menu-options/:p
POST   /api/admin/gala/program/notify
GET    /api/admin/gala/registrations
GET    /api/admin/gala/seating
GET    /api/admin/gala/settings
PUT    /api/admin/gala/settings
GET    /api/admin/gala/who-is-coming
GET    /api/admin/gameday/invites
POST   /api/admin/gameday/invites
POST   /api/admin/gameday/invites/
PUT    /api/admin/gameday/invites/
GET    /api/admin/gameday/settings
PUT    /api/admin/gameday/settings
GET    /api/admin/gameday/status
GET    /api/admin/guest-pass-events
GET    /api/admin/guest-passes
POST   /api/admin/guest-passes
DELETE /api/admin/guest-passes/
GET    /api/admin/guest-passes/
PUT    /api/admin/guest-passes/
POST   /api/admin/guest-passes/:p/:p*
POST   /api/admin/guest-passes/:p/send
POST   /api/admin/health/test-email
GET    /api/admin/member-card-toggles
PUT    /api/admin/member-card-toggles
GET    /api/admin/member-guest-passes
POST   /api/admin/member-guest-passes/
GET    /api/admin/messages
POST   /api/admin/messages
GET    /api/admin/messages/:p
POST   /api/admin/messages/:p/draft-reply
POST   /api/admin/messages/bulk
POST   /api/admin/nag/digest
GET    /api/admin/nag/items
POST   /api/admin/nag/items/:p/act
POST   /api/admin/nag/items/:p/claim
POST   /api/admin/nag/items/:p/dismiss
POST   /api/admin/nag/items/:p/done
POST   /api/admin/nag/run
GET    /api/admin/newsletter-interests
GET    /api/admin/newsletter-segments
GET    /api/admin/newsletters
POST   /api/admin/newsletters
DELETE /api/admin/newsletters/:p
PUT    /api/admin/newsletters/:p
POST   /api/admin/newsletters/:p/send
POST   /api/admin/newsletters/auto-generate
POST   /api/admin/notifications/send
GET    /api/admin/notifications/user-notifications
DELETE /api/admin/notifications/user-notifications/:p
GET    /api/admin/opportunities
PUT    /api/admin/opportunities/:p
POST   /api/admin/org/signature
POST   /api/admin/org/signature/delete
GET    /api/admin/outbox
POST   /api/admin/outbox/:p/approve
POST   /api/admin/outbox/:p/cancel
POST   /api/admin/planner/converse
GET    /api/admin/planner/photos
GET    /api/admin/planner/plans
GET    /api/admin/planner/plans/
POST   /api/admin/planner/plans/
PUT    /api/admin/planner/plans/
GET    /api/admin/plexus-experience/registrations
POST   /api/admin/plexus/:p/:p/approve
POST   /api/admin/plexus/:p/:p/reject
GET    /api/admin/plexus/abstracts
POST   /api/admin/plexus/abstracts/:p/assign-reviewer
PUT    /api/admin/plexus/abstracts/:p/decision
GET    /api/admin/plexus/checkin-enabled-sessions
GET    /api/admin/plexus/combo-links
POST   /api/admin/plexus/combo-links
DELETE /api/admin/plexus/combo-links/
GET    /api/admin/plexus/page-text
PUT    /api/admin/plexus/page-text
GET    /api/admin/plexus/pending
GET    /api/admin/plexus/qa
POST   /api/admin/plexus/qa/
POST   /api/admin/plexus/qa/ask
GET    /api/admin/plexus/recent-checkins
GET    /api/admin/plexus/registrations
PUT    /api/admin/plexus/registrations/:p
GET    /api/admin/plexus/rooms
POST   /api/admin/plexus/rooms
DELETE /api/admin/plexus/rooms/:p
PUT    /api/admin/plexus/rooms/:p
GET    /api/admin/plexus/sessions
POST   /api/admin/plexus/sessions
DELETE /api/admin/plexus/sessions/:p
PUT    /api/admin/plexus/sessions/:p
POST   /api/admin/plexus/sessions/:p/checkin
PUT    /api/admin/plexus/sessions/:p/publish
PUT    /api/admin/plexus/sessions/:p/toggle-checkin
POST   /api/admin/plexus/sessions/bulk-publish
GET    /api/admin/plexus/settings
PUT    /api/admin/plexus/settings
GET    /api/admin/plexus/speakers
POST   /api/admin/plexus/speakers
DELETE /api/admin/plexus/speakers/:p
PUT    /api/admin/plexus/speakers/:p
GET    /api/admin/plexus/speakers/:p/documents
GET    /api/admin/plexus/speakers/:p/flight
PUT    /api/admin/plexus/speakers/:p/flight
POST   /api/admin/plexus/speakers/:p/flight/offers/pin
POST   /api/admin/plexus/speakers/:p/flight/quotes
DELETE /api/admin/plexus/speakers/:p/flight/quotes/:p
PUT    /api/admin/plexus/speakers/:p/flight/quotes/:p/choose
POST   /api/admin/plexus/speakers/:p/flight/search
POST   /api/admin/plexus/speakers/:p/notify
PUT    /api/admin/plexus/speakers/:p/publish
POST   /api/admin/plexus/speakers/:p/reinvite
POST   /api/admin/plexus/speakers/:p/send-upload-link
GET    /api/admin/plexus/speakers/documents/summary
POST   /api/admin/plexus/speakers/import
POST   /api/admin/plexus/speakers/invite
GET    /api/admin/plexus/speakers/years
DELETE /api/admin/plexus/sponsor-tasks/:p
PUT    /api/admin/plexus/sponsor-tasks/:p
GET    /api/admin/plexus/sponsors
POST   /api/admin/plexus/sponsors
DELETE /api/admin/plexus/sponsors/:p
PUT    /api/admin/plexus/sponsors/:p
PUT    /api/admin/plexus/sponsors/:p/publish
GET    /api/admin/plexus/sponsors/:p/tasks
POST   /api/admin/plexus/sponsors/:p/tasks
POST   /api/admin/plexus/sponsors/renewal-wrap
GET    /api/admin/plexus/stats
GET    /api/admin/plexus/travel-budget
GET    /api/admin/plexus/volunteers
POST   /api/admin/plexus/volunteers/:p/approve
POST   /api/admin/plexus/volunteers/:p/reject
GET    /api/admin/plexus/volunteers/export
GET    /api/admin/portal-config
POST   /api/admin/post-event/assemble
GET    /api/admin/post-event/assemble/facts
POST   /api/admin/post-event/attendee-thankyou
POST   /api/admin/post-event/run-round
GET    /api/admin/post-event/summary
POST   /api/admin/pr-newsletters/:p/stage
POST   /api/admin/pr-newsletters/audience-preview
POST   /api/admin/pr-newsletters/compose
POST   /api/admin/pr/meta/publish/:p
PUT    /api/admin/pr/meta/settings
GET    /api/admin/pr/meta/status
GET    /api/admin/print/context
POST   /api/admin/print/preview
POST   /api/admin/print/render
POST   /api/admin/pulse/run
GET    /api/admin/registrant-emails
POST   /api/admin/registrant/:p/:p/:p
GET    /api/admin/registrant/:p/:p/activity
POST   /api/admin/registrant/:p/:p/mark-paid
POST   /api/admin/registrant/:p/:p/note
POST   /api/admin/registrant/:p/:p/notes
GET    /api/admin/registration-links
POST   /api/admin/registration-links
PUT    /api/admin/registration-links/:p/deactivate
POST   /api/admin/registrations/:p/checkin
GET    /api/admin/research
POST   /api/admin/research
POST   /api/admin/research/:p/to-contacts
GET    /api/admin/review/assignments
GET    /api/admin/review/assignments/
GET    /api/admin/review/assignments/auto
GET    /api/admin/review/config
GET    /api/admin/review/decisions
GET    /api/admin/review/decisions/
GET    /api/admin/review/decisions/letters/batch
GET    /api/admin/review/funnel
GET    /api/admin/review/my/assignments
GET    /api/admin/review/my/assignments/
GET    /api/admin/review/my/scorecard/
GET    /api/admin/review/progress
GET    /api/admin/review/reviewers
GET    /api/admin/review/reviewers/external
GET    /api/admin/review/reviewers/external/
GET    /api/admin/review/rubric
GET    /api/admin/review/submissions
GET    /api/admin/scan-context
GET    /api/admin/search
PUT    /api/admin/seat-confirmations/config
POST   /api/admin/seat-confirmations/release-unconfirmed
POST   /api/admin/seat-confirmations/start-round
GET    /api/admin/seat-confirmations/summary
GET    /api/admin/sections
POST   /api/admin/sections
GET    /api/admin/signup-forms
POST   /api/admin/signup-forms
DELETE /api/admin/signup-forms/
GET    /api/admin/signup-forms/
PUT    /api/admin/signup-forms/
GET    /api/admin/signup-forms/:p/responses
DELETE /api/admin/signup-forms/:p/responses/:p
POST   /api/admin/signup-forms/:p/responses/:p/promote
GET    /api/admin/speaker-itineraries
POST   /api/admin/speaker-itineraries
DELETE /api/admin/speaker-itineraries/
GET    /api/admin/speaker-itineraries/
POST   /api/admin/speaker-itineraries/
PUT    /api/admin/speaker-itineraries/
GET    /api/admin/speaker-kits
POST   /api/admin/speaker-kits/generate
POST   /api/admin/speaker-kits/send
GET    /api/admin/sponsor-reports
GET    /api/admin/sponsor-reports/
POST   /api/admin/sponsor-reports/
POST   /api/admin/sponsor-reports/generate
GET    /api/admin/sponsor-tiers
GET    /api/admin/staff-tracking/live
GET    /api/admin/staff-tracking/pairings
GET    /api/admin/staff-tracking/pairings/
GET    /api/admin/staff-tracking/purge
GET    /api/admin/staff-tracking/roster
GET    /api/admin/staff-tracking/run-scan
GET    /api/admin/staff-tracking/settings
GET    /api/admin/system-health
GET    /api/admin/talks
DELETE /api/admin/talks/:p
PUT    /api/admin/talks/:p
GET    /api/admin/team
POST   /api/admin/team/grant
POST   /api/admin/team/invite
POST   /api/admin/team/invite/resend
GET    /api/admin/team/permissions
PUT    /api/admin/team/permissions
POST   /api/admin/team/revoke
POST   /api/admin/tech/
GET    /api/admin/tech/db-download
GET    /api/admin/tech/export-all
GET    /api/admin/tech/system-info
GET    /api/admin/tech/tables
GET    /api/admin/tech/tables/:p
POST   /api/admin/tech/verify-password
GET    /api/admin/testimonials
POST   /api/admin/testimonials/
GET    /api/admin/testimonials/export
POST   /api/admin/testimonials/harvest
GET    /api/admin/transparency/board-pack
GET    /api/admin/transparency/board-pack.
GET    /api/admin/transparency/facts
GET    /api/admin/users/
GET    /api/admin/waitlist
POST   /api/admin/waitlist
GET    /api/admin/waitlist-offers
DELETE /api/admin/waitlist/:p
PUT    /api/admin/waitlist/:p
GET    /api/admin/year-calendar
POST   /api/admin/year-calendar
DELETE /api/admin/year-calendar/
PUT    /api/admin/year-calendar/
GET    /api/admin/year-calendar/events
POST   /api/auth/change-password
POST   /api/auth/login
GET    /api/auth/me
PUT    /api/auth/password
PUT    /api/auth/profile
GET    /api/bridges/events
POST   /api/bridges/events
DELETE /api/bridges/events/:p
GET    /api/bridges/events/:p
PUT    /api/bridges/events/:p
PUT    /api/bridges/events/:p/publish
POST   /api/bridges/events/:p/registrations
POST   /api/bridges/program
DELETE /api/bridges/program/:p
PUT    /api/bridges/program/:p
PUT    /api/bridges/program/:p/publish
DELETE /api/bridges/registrations/:p
PUT    /api/bridges/registrations/:p
POST   /api/bridges/registrations/:p/checkin
POST   /api/bridges/registrations/:p/undo-checkin
GET    /api/bridges/speakers
POST   /api/bridges/speakers
DELETE /api/bridges/speakers/:p
PUT    /api/bridges/speakers/:p
PUT    /api/bridges/speakers/:p/publish
GET    /api/channels
POST   /api/channels
GET    /api/channels/:p/members
POST   /api/channels/:p/members
DELETE /api/channels/:p/members/:p
POST   /api/channels/:p/members/bulk
POST   /api/chat/dm
GET    /api/chat/messages
POST   /api/chat/messages
POST   /api/chat/read
GET    /api/chat/unread
POST   /api/checkin
GET    /api/checkin/recent
GET    /api/checkin/roster
GET    /api/checkin/search
GET    /api/checkin/stats
POST   /api/checkin/undo
GET    /api/conferences
GET    /api/conferences/
GET    /api/contacts
POST   /api/contacts
DELETE /api/contacts/:p
PUT    /api/contacts/:p
POST   /api/contacts/:p/favorite
POST   /api/contacts/import/commit
POST   /api/contacts/import/preview
POST   /api/contacts/outreach/draft
POST   /api/contacts/outreach/queue
GET    /api/dashboard-preferences/:p
PUT    /api/dashboard-preferences/:p
GET    /api/dashboard/portal-stats
GET    /api/dashboard/summary
GET    /api/dashboard/trends
DELETE /api/files/:p
POST   /api/files/:p
GET    /api/finance/bank-balance
POST   /api/finance/bank-balance
DELETE /api/finance/bank-balance/:p
POST   /api/finance/conference-payments/:p/confirm
GET    /api/finance/dashboard
POST   /api/finance/invoices
DELETE /api/finance/invoices/:p
PUT    /api/finance/invoices/:p
POST   /api/finance/invoices/:p/issue
POST   /api/finance/invoices/:p/mark-paid
GET    /api/finance/my-travel-orders
GET    /api/finance/payment-orders
POST   /api/finance/payment-orders
DELETE /api/finance/payment-orders/:p
GET    /api/finance/payment-orders/:p
PUT    /api/finance/payment-orders/:p
GET    /api/finance/reconcile/batch/:p
POST   /api/finance/reconcile/batch/:p/confirm-high
GET    /api/finance/reconcile/batches
POST   /api/finance/reconcile/import
POST   /api/finance/reconcile/line/:p/confirm
POST   /api/finance/reconcile/line/:p/ignore
POST   /api/finance/reconcile/line/:p/match
GET    /api/finance/reports/by-project
GET    /api/finance/reports/by-work-unit
GET    /api/finance/reports/monthly
GET    /api/finance/settings
POST   /api/finance/settings
GET    /api/finance/stripe-payments/recent
POST   /api/finance/transactions
DELETE /api/finance/transactions/:p
GET    /api/finance/transactions/:p
PUT    /api/finance/transactions/:p
POST   /api/finance/travel-orders
GET    /api/finance/travel-orders/:p
POST   /api/finance/travel-orders/:p/approve
POST   /api/finance/travel-orders/:p/calculate
POST   /api/finance/travel-orders/:p/pay
POST   /api/finance/travel-orders/:p/reject
GET    /api/finance/work-units
POST   /api/finance/work-units
DELETE /api/finance/work-units/:p
GET    /api/finance/work-units/:p
PUT    /api/finance/work-units/:p
GET    /api/finance/work-units/:p/transactions
GET    /api/finance/years
PUT    /api/finance/years/:p
DELETE /api/folders/:p
POST   /api/folders/:p
GET    /api/forum/events
POST   /api/forum/events/:p/register
GET    /api/forum/groups
POST   /api/forum/groups/:p/membership
GET    /api/forum/media
POST   /api/forum/media
GET    /api/forum/posts
POST   /api/forum/posts
POST   /api/forum/posts/:p/react
GET    /api/gala/registrations
PUT    /api/gala/registrations/:p
GET    /api/gala/registrations/:p/pay-link
POST   /api/gameday/volunteer/checkin
POST   /api/gameday/volunteer/login
GET    /api/gameday/volunteer/status
GET    /api/org/signature
GET    /api/pinned
POST   /api/pinned
DELETE /api/pinned/:p
PUT    /api/pinned/reorder
GET    /api/plexus/conference
GET    /api/plexus/schedule
GET    /api/portal-content
POST   /api/portal-content
DELETE /api/portal-content/:p
PUT    /api/portal-content/:p
PUT    /api/portal-content/:p/publish
POST   /api/portal-content/reorder
GET    /api/pr/ai-generations
POST   /api/pr/ai-generations
POST   /api/pr/ai-generations/:p/use
GET    /api/pr/calendar
POST   /api/pr/calendar
GET    /api/pr/calendar/:p
PUT    /api/pr/calendar/:p
POST   /api/pr/calendar/:p/approve-schedule
POST   /api/pr/campaigns
GET    /api/pr/campaigns/:p
PUT    /api/pr/campaigns/:p
GET    /api/pr/dashboard
GET    /api/pr/media
POST   /api/pr/media
GET    /api/pr/media-contacts
POST   /api/pr/media-contacts
DELETE /api/pr/media-contacts/
PUT    /api/pr/media-contacts/
POST   /api/pr/media-contacts/import/commit
POST   /api/pr/media-contacts/import/preview
POST   /api/pr/media-contacts/pause
DELETE /api/pr/media/:p
GET    /api/pr/media/:p
POST   /api/pr/newsletters
GET    /api/pr/newsletters/
GET    /api/pr/newsletters/:p
POST   /api/pr/newsletters/:p
PUT    /api/pr/newsletters/:p
POST   /api/pr/newsletters/:p/send
POST   /api/pr/posts
DELETE /api/pr/posts/:p
PUT    /api/pr/posts/:p
GET    /api/pr/press-releases
POST   /api/pr/press-releases
DELETE /api/pr/press-releases/
GET    /api/pr/press-releases/
POST   /api/pr/press-releases/
PUT    /api/pr/press-releases/
POST   /api/pr/press-releases/draft
GET    /api/pr/press-seeds
GET    /api/pr/publer/status
POST   /api/pr/subscribers
POST   /api/pr/subscribers/:p/unsubscribe
GET    /api/pr/subscribers/export
PUT    /api/projects/:p/settings
GET    /api/projects/settings
GET    /api/search
GET    /api/sequences
POST   /api/sequences
DELETE /api/sequences/:p
POST   /api/sequences/:p/steps/:p/complete
GET    /api/staff-tracking/consent
GET    /api/staff-tracking/me
GET    /api/staff-tracking/pairing-confirm
GET    /api/staff-tracking/ping
POST   /api/tasks
DELETE /api/tasks/:p
GET    /api/tasks/:p
PUT    /api/tasks/:p
POST   /api/tasks/:p/files
POST   /api/tasks/:p/toggle
DELETE /api/tasks/files/:p
GET    /api/team
POST   /api/team
POST   /api/team/heartbeat
GET    /api/team/me
GET    /api/team/usage
GET    /api/teamchat/channels
GET    /api/teamchat/channels/
GET    /api/teamchat/dm
GET    /api/teamchat/messages
GET    /api/teamchat/overview
GET    /api/teamchat/polls
GET    /api/teamchat/polls/
GET    /api/teamchat/read
POST   /api/teamchat/upload
GET    /api/timeline/:p
POST   /api/timeline/:p
DELETE /api/timeline/:p/:p
PUT    /api/timeline/:p/:p
POST   /api/upload/photos
POST   https://medx-user-portal.onrender.com/api/admin/payments/gala/:p/refund
```

## Appendix C — Server-rendered template pages: inline-JS calls (both portals)

USER portal template pages (registration flows, consoles — inline JS in user server.js):
```
GET    /api/accelerator/interview-access/
POST   /api/accelerator/interview-access/
GET    /api/applicant/applications
POST   /api/applicant/applications
POST   /api/applicant/applications/
PUT    /api/applicant/applications/
DELETE /api/applicant/documents/
POST   /api/applicant/login
GET    /api/applicant/profile
PUT    /api/applicant/profile
GET    /api/applicant/programs
POST   /api/applicant/register
GET    /api/applicant/verify/
POST   /api/auth/reset-password
POST   /api/croatians-abroad/register
POST   /api/invite/validate-coupon
POST   /api/networking/connect-by-badge
POST   /api/public-events/register
POST   /api/public/survey/comment
POST   /api/register-invite
POST   /api/signup-forms/
POST   https://api.brevo.com/v3/smtp/email

```
ADMIN portal template pages (applicant portal, review/evaluate consoles, auction + invite + newsletter pages):
```
GET    /api/accelerator/interview-access/
POST   /api/accelerator/interview-access/
GET    /api/applicant/applications
POST   /api/applicant/applications
POST   /api/applicant/applications/
PUT    /api/applicant/applications/
DELETE /api/applicant/documents/
POST   /api/applicant/login
GET    /api/applicant/profile
PUT    /api/applicant/profile
GET    /api/applicant/programs
POST   /api/applicant/register
GET    /api/applicant/verify/
GET    /api/public/auction/
POST   /api/public/auction/
POST   /api/public/newsletter/subscribe
GET    /api/review-access/
POST   https://api.anthropic.com/v1/messages
POST   https://api.brevo.com/v3/smtp/email
GET    https://api.stripe.com:p

```
Forum wing (user-portal/frontend/forum-wing.html):
```
GET    /api/forum/wing/convenings
POST   /api/forum/wing/convenings/
GET    /api/forum/wing/directory
GET    /api/forum/wing/me
POST   /api/forum/wing/request-link
PATCH  /api/me
POST   /api/public-events/register
POST   /api/public/forum-consideration

```

## Appendix D — localStorage / sessionStorage key inventory (grep-extracted, deduped)

| Surface | Keys |
|---|---|
| medx.hr site.js | medx_user_token, medx_user_data, medx_session_expired, medx_notif_read, medx_notif_snooze, medx_prompt_state, medx_strip_dismissed, medx_live_cache |
| User SPA | medx_user_token, medx_speaker_prefs, medx_speaker_data, medx_notify_topics |
| User server-rendered pages | medx_user_token, medx_user_data, applicantToken, medx_speaker_lang, medx_speaker_atsh, userToken (legacy badge page) |
| Admin SPA | medx_token, token (legacy fallback read), medx_user, widget_*, checkinQueue, checkinRoster, medxCustomShortcut, medx_project_order, medx_pinned_projects, medx_admin_hint_off_*, medx_ac_collapsed, medxHomeNotes, medxDiscoverSeen, medxDiscoverLang, medxAdminTheme, chatPinned, chatHidden, accApplicationDraft |
| Admin template pages | applicantToken, rv_lang, medx_auction_lang |

## Appendix E — Regeneration

This file was produced by scripted extraction (route/call regexes matching the repo's own
check-api-contract.js) plus manual reading of auth/permission/CORS/integration code.
To regenerate the call lists after a change: run `node scripts/check-api-contract.js`
for drift, and re-grep with the same patterns (fetch/.api/api + '/api/' literals).
