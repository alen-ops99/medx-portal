# Med&X ADMIN PORTAL — Verified Connections Inventory

**Scope.** Every connection the admin (staff) portal has to the MEMBER portal, to the medx.hr WEBSITE, and to external services — verified at `git main @ 8b7ba23` (in sync with origin) on 2026-08-28. The spine of this report is the admin → member → website chain.

**Sources read (all at HEAD):** `admin-portal/backend/server.js` (43,529 lines), `admin-portal/backend/picker-sync.js` (547), `admin-portal/backend/demo-purge.js` (156), `admin-portal/frontend/index.html` (59,533), `admin-portal/frontend/sw.js` (57), `user-portal/backend/server.js` (29,600), `user-portal/backend/fira-service.js`, `shared/db.js`, `shared/ai.js`, `shared/wallet.js`, `render.yaml`, `scripts/check-schema-sync.sh`, `scripts/check-api-contract.js`, `design/CONNECTIONS-MAP.md` (treated as hypotheses), the two post-map commits `8e85c33` and `8b7ba23`, and the live medx.hr `site.js` mirror at `MedX_Squarespace/site_live_mirror_2026-07-31/`.

**Method.** Read-only. Route registrations, table names, env vars, URL builders and frontend calls were extracted with grep/perl from the files above; every table name was anchored to a `CREATE TABLE` statement in one of the two backends so prose words in comments could not leak in; each write site was mapped to its enclosing route/function; the SCHEMA-MIRROR guard and the API-contract guard were executed; the live services were probed with GET/HEAD only (no login route was called). Line numbers are HEAD line numbers unless marked otherwise.

## 0. Headline numbers

| Fact | Value | Where verified |
|---|---|---|
| Route registrations in admin `server.js` | **1,080** = 1,076 method routes (GET 419, POST 440, PUT 131, DELETE 85, PATCH 1) + 4 `app.use` mounts | §1 |
| Routes reachable without an admin JWT | **65** (49 with no middleware at all, 14 behind `publicLimiter` only, 2 behind `authLimiter` = login/register); plus 7 `applicantAuth` and 5 `gamedayVolunteerAuth` token-session routes | §1, §3 |
| Permission sections / route-prefix rules | 19 sections, 102 prefix rules (`SECTION_ROUTE_MAP` server.js:1183–1239) | §1 |
| Tables `CREATE`d across both backends | **297** (admin 286, member 231) | §2c |
| Tables referenced by BOTH backends (shared) | **220** — 133 read+written by both sides, 14 admin-writes/member-reads-only, 8 member-writes/admin-reads-only, 12 DDL-only in both | §2c |
| SCHEMA-MIRROR blocks | byte-identical, 527 lines, md5 `9d76c0f0138ae087cb07bb47a6b9cd32` (admin 4154–4680, member 9316–9842) | §2d |
| `check-api-contract.js` | OK (every frontend `/api` call has a route); the allowlist file it looks for does not exist | §2d |
| Admin → member URL builders | 1 base helper (`userPortalBase()` :803) used at 33 sites; 20 distinct member-portal URL shapes; 2 direct server-to-server HTTP calls; 3 browser cross-origin clients in the admin SPA | §2a, §2b, §4 |
| Admin public API used by the website | `GET /api/public/press` (+ `/press/:slug` page); `/api/public/content` and `/status` exist on the admin origin too but `site.js` reads those from the MEMBER origin | §3 |
| Env vars read by admin code | 56 distinct names across `server.js` (48), `picker-sync.js` (8), `demo-purge.js` (2 overlapping), plus 9 read through `shared/*` and 3 through the imported `fira-service.js`; **45 of the 56 are not declared in the `medx-admin-portal` block of `render.yaml`** (42 once the platform-injected `RENDER`, `RENDER_EXTERNAL_URL`, `PATH` are excluded) | §6 |
| Drift vs `design/CONNECTIONS-MAP.md` | 121 admin citations checked: 30 exact, 38 shifted by exactly +32 (the two post-map commits), 46 already stale by −2…+282 when the map was written, 7 wrong-file/wrong-line; 9 factual discrepancies; 9 omissions | §7 |
| Live (2026-08-28 21:41 UTC) | admin `/health` 200 in 0.65 s, `/api/public/press` 200 `{"releases":[]}`, CORS allow-origin echoes `https://www.medx.hr`, member `/health` 200, `www.medx.hr` 301 → `https://medx.hr/` | §8 |

**Surprises worth reading first (details in the sections cited):**

1. The two browser cross-origin calls from the admin SPA to the member backend (gala refund `index.html:43241`, Live Q&A `QAAdmin` :53718) send the ADMIN JWT to the MEMBER server, which verifies with its own `JWT_SECRET` (user server.js:569, 6085). `render.yaml` declares `JWT_SECRET: generateValue: true` separately for each service (lines 24–25 and 101–102), so these calls only work if the two dashboard values were manually made identical. Not verifiable from the repo. (§2b)
2. The member portal exposes `GET /api/public/registrations/:email` with **no auth and no rate limiter** (user server.js:29187) and the admin backend calls it server-side (admin server.js:11341, inside `GET /api/admin/users/:id/profile`). Anyone who knows an email can list that person's conference, forum, gala and bridges registrations. (§2b)
3. The "Outlook inbox" module never talks to Microsoft Graph: there is no `graph.microsoft.com` call anywhere in admin `server.js`; with `MS_GRAPH_*` set it returns an empty thread list (server.js:38840–38847), without them it serves mock threads in dev. The map describes it as reading the mailbox. (§5, §7)
4. `CLOUDINARY_URL` is never used to upload anything from the admin portal (no `cloudinary` require); it is only a "persistence configured" flag that turns multipart uploads into 503s in production when missing (server.js:945–965). (§5)
5. `admin-portal/backend/server.js:15819` inserts into a table named `notifications` that no backend ever creates (the real table is `user_notifications`); the insert is inside a try/catch, so ranking publication silently notifies nobody. (§2e)
6. Hard-coded picker console secret in source and in the served admin HTML: `https://plexus-tables.netlify.app/admin.html?key=medx-smaragdna-x7k9q4t2` (server.js:42704, index.html:13302/13305). The admin CSP `frame-src` (server.js:919–922) does not list `plexus-tables.netlify.app`, so the two seating `<iframe>`s at index.html:13305 and :13331 are blocked by the page's own CSP; only the `target=_blank` links work. (§4)
7. Commit `8b7ba23` ships a **fixed temporary founder password (`MedX-Unlock-2026`) in source** that is applied once per database (marker table `founder_recovery_log`); a fresh/restored DB copy without that marker row would re-apply it on next boot. `8e85c33` adds the env-gated `FOUNDER_RESET_PW` path that runs on EVERY boot while the variable is set. (§7)
8. The admin backend serves the member portal's static asset folder at `/photo-library` (`express.static('../../user-portal/frontend/assets')`, server.js:941) — a third cross-directory dependency beside `shared/*` and `fira-service.js`.

## 1. ROUTE TABLE — every registration in `admin-portal/backend/server.js`

### 1.1 How permissions resolve (read this before the table)

Every authenticated request passes through `auth()` (server.js:1067–1098): it verifies the Bearer JWT with `JWT_SECRET` (:859), loads `users.{is_admin,is_staff,is_founder,must_change_password,allowed_sections}` (:1072), blocks accounts still on an invite password except for `/api/auth/change-password` and `/api/auth/me` (:1078–1080), then calls `sectionDenied(user, req.path)` (:1082 → :1256–1262). `sectionDenied` returns `null` for founders and for `allowed_sections = NULL` (full access); otherwise it maps the path to a section with `sectionForPath()` (:1241–1246, first prefix match, boundary-aware) and 403s with `{ error, section }` when the section is not in the user's JSON array. Unmapped prefixes are open to every signed-in admin ("deny only what is mapped", comment :1176–1182). A dev bypass exists only when `NODE_ENV=development` AND no `TURSO_DATABASE_URL` (:1064).

Role middleware (all in server.js): `adminOnly` :1120 (`is_admin`), `staffOrAdmin` :1127 (`is_admin || is_staff` — scanner staff), `founderOnly` :1135 (`is_admin && is_founder`; `is_founder` is only ever set by the boot seed), `optionalAuth` :1100, `techAuth` :35953 (header `x-tech-password` must equal `TECH_PASSWORD`, 503 when unset), `applicantAuth` :24122 (JWT with `type:'applicant'`, minted at :24099), `gamedayVolunteerAuth` :43030 (JWT `kind:'gameday_volunteer'` + live `gameday_invites` row, minted at :43060 for 3 days). Rate limiters: `authLimiter` :10848, `publicLimiter` :11803 (120/min), `researchLimiter` :28997, `auctionBidLimiter` :31607, `assistantLimiter` :36762, `advisorLimiter` :42455, `gamedayLoginLimiter` :43021, `gamedayVolunteerLimiter` :43024. Upload handlers (multer): `upload` :990, `acceleratorUpload` :12981, `projectFilesUpload` :18613, `spatialUploadHandler` :20707, `travelEvidenceUpload` :26496, `prMediaUpload` :27687, `pressImportUpload` :28392, `contactImportUpload` :28687, `candidateImportUpload` :39473.

Global middleware order (server.js:873–941): `/api/public` gets its own CORS allowlist `PUBLIC_API_ORIGINS = [medx-website-preview.netlify.app, www.medx.hr, medx.hr]` (:868–873); the global CORS policy is `CORS_ORIGIN` (comma list) or the two onrender hosts + localhost:3000/3001 with credentials (:877–884); `X-Robots-Tag: noindex, nofollow` on everything (:891); helmet CSP (:892–933, quoted in §8 from the live headers); `express.json()`; static `../frontend`; `/uploads`; `/photo-library` → member-portal assets (:941).

### 1.2 `PERMISSION_SECTIONS` and `SECTION_ROUTE_MAP`, verbatim at HEAD

```js
// admin-portal/backend/server.js:1153-1239 (verbatim at HEAD 8b7ba23)
const PERMISSION_SECTIONS = [
    { id: 'plexus',        label: 'Plexus Week 2026',      group: 'Projects',        desc: 'Conference, Gala, ticketing, check-in, sponsors, volunteers, auctions' },
    { id: 'accelerator',   label: 'Med&X Accelerator',     group: 'Projects',        desc: 'Applications, reviews, interviews, sites' },
    { id: 'forum',         label: 'Biomedical Forum',      group: 'Projects',        desc: 'Members, events, mentorship, council' },
    { id: 'bridges',       label: 'Building Bridges',      group: 'Projects',        desc: 'Events, speakers, Croatians abroad' },
    { id: 'gameday',       label: 'Game Day',              group: 'Events & access', desc: 'Event-day staff console & tracking' },
    { id: 'conferences',   label: 'Conferences',           group: 'Events & access', desc: 'Conference & ticket-type management' },
    { id: 'editions',      label: 'Editions',              group: 'Events & access', desc: 'Past & future editions' },
    { id: 'signup-forms',  label: 'Sign-up Forms',         group: 'Events & access', desc: 'Public sign-up pages for short events' },
    { id: 'guest-passes',  label: 'Guest Passes',          group: 'Events & access', desc: 'Personal VIP access links' },
    { id: 'year-calendar', label: 'Year Calendar',         group: 'Events & access', desc: 'Season planning' },
    { id: 'cme',           label: 'CME / HLK',             group: 'Events & access', desc: 'CME points & attendee exports' },
    { id: 'pr-media',      label: 'Marketing & Content',   group: 'Marketing',       desc: 'PR & Media, Content studio, Newsletter, Merch' },
    { id: 'member-ops',    label: 'Member Ops & Comms',    group: 'Communications',  desc: 'Messages, announcements, email blasts, outbox' },
    { id: 'finances',      label: 'Finance',               group: 'Finance',         desc: 'Finances, invoices, travel orders, board pack' },
    { id: 'contacts',      label: 'My Network',            group: 'Network',         desc: 'Contacts & Outlook threads' },
    { id: 'advisors',      label: 'Executive Suite',       group: 'Leadership',      desc: 'AI CMO / CFO / COO / CLO weekly review + Ask the board' },
    { id: 'files',         label: 'Files & Resources',     group: 'System',          desc: 'Shared files & resource library' },
    { id: 'team',          label: 'Team Access',           group: 'System',          desc: 'Team list, invites, roles' },
    { id: 'tech',          label: 'System & Tech',         group: 'System',          desc: 'System health, audit log, tech dashboard' },
];

// Route-prefix → section map. Matching is boundary-aware (the prefix must be the whole path or
// be followed by '/'), first match wins — deeper prefixes are listed before shallower ones where
// a family overlaps (e.g. /api/admin/export/forum-registrations before /api/admin/export). The
// policy is DENY-only-what-is-mapped: anything not listed here (auth, me, section prefs, team
// chat, heartbeat, notifications bell, dashboard prefs, tasks, pinned, projects meta, public
// routes, portal-member self-service like /api/registrations + /api/abstracts, cross-section
// reads like /api/conferences) stays reachable for every signed-in admin. Correct-by-prefix,
// not exhaustive-by-route.
const SECTION_ROUTE_MAP = [
    ['/api/admin/export/forum-registrations', 'forum'],
    // — Plexus Week (incl. Gala, ticketing, check-in, sponsors, volunteers, auctions, event ops) —
    ['/api/plexus', 'plexus'], ['/api/admin/plexus', 'plexus'], ['/api/admin/plexus-experience', 'plexus'],
    ['/api/gala', 'plexus'], ['/api/admin/gala', 'plexus'],
    ['/api/checkin', 'plexus'], ['/api/admin/checkin', 'plexus'], ['/api/admin/scan-context', 'plexus'],
    ['/api/admin/auctions', 'plexus'], ['/api/admin/auction-summary', 'plexus'],
    ['/api/admin/speaker-itineraries', 'plexus'], ['/api/admin/speaker-kits', 'plexus'],
    ['/api/admin/sponsor-reports', 'plexus'], ['/api/admin/sponsor-tiers', 'plexus'],
    ['/api/admin/talks', 'plexus'], ['/api/admin/sessions', 'plexus'], ['/api/admin/spatial', 'plexus'],
    ['/api/admin/abstracts', 'plexus'], ['/api/admin/registrant', 'plexus'], ['/api/admin/registrant-emails', 'plexus'],
    ['/api/admin/registrations', 'plexus'], ['/api/admin/registration-links', 'plexus'],
    ['/api/admin/seat-confirmations', 'plexus'], ['/api/admin/waitlist', 'plexus'], ['/api/admin/waitlist-offers', 'plexus'],
    ['/api/admin/early-bird', 'plexus'], ['/api/admin/coupons', 'plexus'], ['/api/admin/tickets', 'plexus'],
    ['/api/admin/event-invites', 'plexus'], ['/api/admin/event-reminders', 'plexus'],
    ['/api/admin/event-survey', 'plexus'], ['/api/admin/event-components', 'plexus'],
    ['/api/admin/post-event', 'plexus'], ['/api/admin/testimonials', 'plexus'],
    ['/api/admin/print', 'plexus'], ['/api/admin/wallet', 'plexus'], ['/api/admin/analytics', 'plexus'],
    ['/api/admin/export', 'plexus'],
    // — Accelerator —
    ['/api/accelerator', 'accelerator'], ['/api/admin/accelerator', 'accelerator'], ['/api/admin/accelerator-sites', 'accelerator'],
    ['/api/applicant', 'accelerator'], ['/api/admin/review', 'accelerator'], ['/api/review-access', 'accelerator'],
    ['/api/admin/opportunities', 'accelerator'], ['/api/admin/research', 'accelerator'],
    // — Forum —
    ['/api/forum', 'forum'], ['/api/admin/forum', 'forum'], ['/api/admin/council', 'forum'],
    // — Bridges —
    ['/api/bridges', 'bridges'], ['/api/admin/bridges', 'bridges'], ['/api/admin/croatians-abroad', 'bridges'],
    // — Events & access —
    ['/api/gameday', 'gameday'], ['/api/admin/gameday', 'gameday'], ['/api/staff-tracking', 'gameday'], ['/api/admin/staff-tracking', 'gameday'],
    ['/api/admin/conferences', 'conferences'],
    ['/api/admin/editions', 'editions'],
    ['/api/admin/signup-forms', 'signup-forms'],
    ['/api/admin/guest-passes', 'guest-passes'], ['/api/admin/guest-pass-events', 'guest-passes'],
    ['/api/admin/member-guest-passes', 'guest-passes'],
    ['/api/admin/year-calendar', 'year-calendar'],
    ['/api/admin/cme', 'cme'],
    // — Marketing & Content (PR & Media + Newsletter + Content studio) —
    ['/api/pr', 'pr-media'], ['/api/admin/pr', 'pr-media'], ['/api/admin/pr-newsletters', 'pr-media'],
    ['/api/admin/newsletters', 'pr-media'], ['/api/admin/newsletter-interests', 'pr-media'], ['/api/admin/newsletter-segments', 'pr-media'],
    ['/api/admin/audiences', 'pr-media'], ['/api/admin/content', 'pr-media'], ['/api/admin/content-blocks', 'pr-media'],
    ['/api/admin/content-checklist', 'pr-media'], ['/api/admin/feed-items', 'pr-media'], ['/api/admin/digest', 'pr-media'],
    ['/api/sequences', 'pr-media'],
    // — Member ops / communications —
    ['/api/admin/messages', 'member-ops'], ['/api/admin/member-announcements', 'member-ops'], ['/api/admin/announcements', 'member-ops'],
    ['/api/admin/member-meta', 'member-ops'], ['/api/admin/member-card-toggles', 'member-ops'], ['/api/admin/bulk-email', 'member-ops'],
    ['/api/admin/outbox', 'member-ops'], ['/api/admin/rewards', 'member-ops'], ['/api/admin/users', 'member-ops'],
    ['/api/admin/notifications', 'member-ops'],
    // — Finance —
    ['/api/finance', 'finances'], ['/api/admin/transparency', 'finances'],
    // — Network / Leadership —
    ['/api/contacts', 'contacts'], ['/api/admin/outlook', 'contacts'],
    ['/api/admin/advisors', 'advisors'],
    // — Files / Team / System —
    ['/api/files', 'files'], ['/api/folders', 'files'], ['/api/admin/files', 'files'], ['/api/upload', 'files'],
    ['/api/admin/team', 'team'],
    ['/api/admin/tech', 'tech'], ['/api/admin/system-health', 'tech'], ['/api/admin/health', 'tech'], ['/api/admin/audit-log', 'tech'],
];
```

That is 19 sections and 102 prefix rules. Management routes: `GET /api/admin/team/permissions` (server.js:35290, `auth → adminOnly → founderOnly`) and `PUT /api/admin/team/permissions` (:35303, same chain); new invitees start at `'[]'` (Home only).

### 1.3 The table

Columns: HEAD line of the registration · method · path · middleware chain exactly as registered (`**none (public)**` = reachable by anyone) · permission section resolved by applying `SECTION_ROUTE_MAP` to the path (`—` = unmapped, i.e. open to every signed-in admin) · one-line purpose inferred from the handler. Grouped by feature area: unmapped families first, then the 19 permission sections. 1,080 rows.

#### Area: auth & session (6 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 10861 | POST | `/api/auth/register` | authLimiter | — | Reject self-registration on the admin portal (disabled endpoint) |
| 10865 | POST | `/api/auth/login` | authLimiter | — | Log in a user and issue a JWT |
| 10899 | GET | `/api/auth/me` | auth | — | Get the current authenticated user's profile |
| 10906 | PUT | `/api/auth/profile` | auth | — | Update the current user's profile fields |
| 10914 | PUT | `/api/auth/password` | auth | — | Change the current user's password (requires current password) |
| 10934 | POST | `/api/auth/change-password` | auth | — | Complete a forced password change (must_change_password flag) |

#### Area: shell: sections/dashboard/prefs/tasks/projects (33 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 10946 | GET | `/api/admin/sections` | auth | — | Get the current user's enabled admin section preferences |
| 10954 | POST | `/api/admin/sections` | auth | — | Save (replace) the current user's enabled admin sections |
| 10967 | PUT | `/api/admin/sections` | auth | — | Update the current user's enabled admin sections |
| 10981 | GET | `/api/dashboard-preferences/:section` | auth | — | Get dashboard card preferences for a section |
| 10987 | PUT | `/api/dashboard-preferences/:section` | auth | — | Save dashboard card preferences for a section |
| 11003 | DELETE | `/api/dashboard-preferences/:section/:cardId` | auth | — | Delete one dashboard preference card |
| 11162 | GET | `/api/admin/change-map` | auth → adminOnly | — | Get the cached admin change-map JSON |
| 11750 | GET | `/api/admin/project-status` | auth → adminOnly | — | Admin: list project hub status cards with waiting counts |
| 11762 | GET | `/api/admin/project-status/:key` | auth → adminOnly | — | Admin: get one project's status card |
| 11770 | PUT | `/api/admin/project-status/:key` | auth → adminOnly | — | Admin: update a project's status card |
| 17929 | GET | `/api/pinned` | auth → adminOnly | — | List the current user's pinned items |
| 17936 | POST | `/api/pinned` | auth → adminOnly | — | Pin an item for the current user |
| 17955 | DELETE | `/api/pinned/:id` | auth → adminOnly | — | Unpin an item |
| 17962 | PUT | `/api/pinned/reorder` | auth → adminOnly | — | Reorder the user's pinned items |
| 17975 | GET | `/api/projects/settings` | auth → adminOnly | — | Get settings for all projects |
| 17991 | PUT | `/api/projects/:project/settings` | auth → adminOnly | — | Update a project's date, venue, and details |
| 18010 | PUT | `/api/projects/:project/date` | auth → adminOnly | — | Update a project's date (legacy endpoint) |
| 18227 | GET | `/api/tasks/:project` | auth → adminOnly | — | List tasks and subtasks for a project |
| 18243 | GET | `/api/tasks` | auth → adminOnly | — | Get a summary of all tasks |
| 18260 | POST | `/api/tasks` | auth → adminOnly | — | Create a new task |
| 18271 | PUT | `/api/tasks/:id` | auth → adminOnly | — | Update a task |
| 18289 | POST | `/api/tasks/:id/files` | auth → upload.single('file') | — | Upload a file attachment to a task |
| 18312 | DELETE | `/api/tasks/files/:fileId` | auth → adminOnly | — | Delete a task file attachment |
| 18327 | POST | `/api/tasks/:id/toggle` | auth → adminOnly | — | Advance a task to its next status |
| 18339 | DELETE | `/api/tasks/:id` | auth → adminOnly | — | Delete a task |
| 33533 | GET | `/api/admin/portal-config` | auth | — | Get the user-portal base URL config |
| 39128 | POST | `/api/admin/nag/run` | auth → adminOnly | — | Run the nag-to-do action scan and refresh the team digest |
| 39138 | GET | `/api/admin/nag/items` | auth → adminOnly | — | List nag action-center items by status |
| 39154 | POST | `/api/admin/nag/items/:id/act` | auth → adminOnly | — | Execute the one-click DO action for a nag item |
| 39218 | POST | `/api/admin/nag/items/:id/done` | auth → adminOnly | — | Mark a nag item resolved and complete its underlying task |
| 39237 | POST | `/api/admin/nag/items/:id/dismiss` | auth → adminOnly | — | Dismiss a nag item as not relevant |
| 39251 | POST | `/api/admin/nag/items/:id/claim` | auth → adminOnly | — | Claim or release ownership of a nag action item |
| 39273 | POST | `/api/admin/nag/digest` | auth → adminOnly | — | Queue the daily team digest on demand |

#### Area: bell / notifications / me (4 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 11626 | GET | `/api/bell-feed` | auth | — | Get the member notification bell feed |
| 11694 | GET | `/api/me/next-event` | auth | — | Get the signed-in member's next upcoming event |
| 22850 | GET | `/api/notifications` | auth | — | Get notifications for the current user |
| 22859 | PUT | `/api/notifications/:id/read` | auth | — | Mark a notification as read |

#### Area: team chat / channels / heartbeat (31 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 17236 | GET | `/api/channels` | auth → adminOnly | — | List chat channels (optionally filtered by project) |
| 17251 | GET | `/api/channels/:project/tree` | auth → adminOnly | — | Get chat channels as a parent/child tree |
| 17269 | POST | `/api/channels` | auth → adminOnly | — | Create a chat channel with a slugified handle |
| 17290 | PUT | `/api/channels/:id` | auth → adminOnly | — | Update a chat channel's name and description |
| 17299 | DELETE | `/api/channels/:id` | auth → adminOnly | — | Delete a chat channel and its children/messages |
| 17324 | GET | `/api/channels/:id/members` | auth → adminOnly | — | List a chat channel's members |
| 17336 | POST | `/api/channels/:id/members` | auth → adminOnly | — | Add one or more members to a chat channel |
| 17358 | DELETE | `/api/channels/:id/members/:memberId` | auth → adminOnly | — | Remove a member from a chat channel |
| 17366 | POST | `/api/channels/:id/members/bulk` | auth → adminOnly | — | Bulk-add a member to all channels in a project |
| 17387 | GET | `/api/chat/messages` | auth → adminOnly | — | Get chat messages for a channel |
| 17413 | POST | `/api/chat/messages` | auth → adminOnly | — | Send a chat message to a channel |
| 17441 | POST | `/api/chat/upload` | auth → adminOnly → upload.single('file') | — | Upload a file attachment for chat |
| 17460 | POST | `/api/chat/dm` | auth → adminOnly | — | Create or get a DM channel between two team members |
| 17490 | GET | `/api/chat/unread` | auth → adminOnly | — | Get unread chat message counts per channel |
| 17516 | POST | `/api/chat/read` | auth → adminOnly | — | Mark a chat channel as read |
| 17615 | GET | `/api/teamchat/overview` | auth → adminOnly | — | Return the team chat sidebar overview |
| 17657 | GET | `/api/teamchat/messages` | auth → adminOnly | — | List messages in a chat channel |
| 17679 | POST | `/api/teamchat/messages` | auth → adminOnly | — | Post a new message to a chat channel |
| 17702 | POST | `/api/teamchat/upload` | auth → adminOnly → upload.single('file') | — | Upload a file attachment for team chat |
| 17714 | POST | `/api/teamchat/read` | auth → adminOnly | — | Mark a team chat channel as read |
| 17719 | POST | `/api/teamchat/channels` | auth → adminOnly | — | Create a new team chat channel |
| 17738 | PUT | `/api/teamchat/channels/:id` | auth → adminOnly | — | Rename or update a team chat channel |
| 17749 | DELETE | `/api/teamchat/channels/:id` | auth → adminOnly | — | Delete a team chat channel |
| 17769 | GET | `/api/teamchat/channels/:id/members` | auth → adminOnly | — | List members of a chat channel |
| 17774 | POST | `/api/teamchat/channels/:id/members` | auth → adminOnly | — | Add members to a chat channel |
| 17783 | DELETE | `/api/teamchat/channels/:id/members/:memberId` | auth → adminOnly | — | Remove a member from a chat channel |
| 17791 | POST | `/api/teamchat/dm` | auth → adminOnly | — | Start or open a direct message channel |
| 17814 | POST | `/api/teamchat/polls` | auth → adminOnly | — | Create a meeting-time poll in a channel |
| 17834 | POST | `/api/teamchat/polls/:id/vote` | auth → adminOnly | — | Vote on a meeting poll |
| 17852 | POST | `/api/teamchat/polls/:id/close` | auth → adminOnly | — | Close a meeting poll |
| 17919 | GET | `/api/teamchat/polls/:id` | auth → adminOnly | — | Get a meeting poll's details and results |

#### Area: conferences (member-facing reads) (19 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 11011 | GET | `/api/conferences/active` | **none (public)** | — | Get the currently active conference |
| 11015 | GET | `/api/conferences/:slug` | **none (public)** | — | Get a conference by slug |
| 11021 | GET | `/api/conferences` | **none (public)** | — | List all conferences |
| 11175 | GET | `/api/conferences/:confId/tickets` | **none (public)** | — | List ticket types for a conference |
| 11179 | POST | `/api/promo-codes/validate` | **none (public)** | — | Validate a promo code for a conference |
| 11189 | POST | `/api/registrations` | auth | — | Create a conference registration (with payment) |
| 11232 | GET | `/api/registrations/my` | auth | — | List the current user's own registrations |
| 11238 | GET | `/api/registrations/:id` | auth | — | Get a single registration by id |
| 11520 | POST | `/api/abstracts` | auth | — | Submit a conference abstract |
| 11536 | GET | `/api/abstracts/my` | auth | — | List the current user's submitted abstracts |
| 11545 | POST | `/api/abstracts/:id/withdraw` | auth | — | Withdraw an abstract submission |
| 11552 | GET | `/api/conferences/:confId/schedule` | **none (public)** | — | Get the session schedule for a conference |
| 11579 | GET | `/api/conferences/:confId/speakers` | **none (public)** | — | List confirmed, published speakers for a conference |
| 11584 | POST | `/api/sessions/:sessionId/questions` | auth | — | Post a question to a session Q&A |
| 11591 | GET | `/api/sessions/:sessionId/questions` | **none (public)** | — | List questions for a session |
| 11597 | GET | `/api/conferences/:confId/attendees` | auth | — | List public-profile attendees for a conference (networking) |
| 11614 | GET | `/api/conferences/:confId/announcements` | **none (public)** | — | List announcements for a conference |
| 11734 | GET | `/api/conferences/:confId/sponsors` | **none (public)** | — | List sponsors for a conference by tier |
| 11740 | GET | `/api/conferences/:confId/resources` | **none (public)** | — | List resources for a conference |

#### Area: portal content / org (12 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 33876 | GET | `/api/portal-content` | auth → adminOnly | — | List all portal content items |
| 33882 | GET | `/api/portal-content/section/:section` | auth → adminOnly | — | Get portal content items for a section |
| 33888 | POST | `/api/portal-content` | auth → adminOnly | — | Create a portal content item |
| 33901 | PUT | `/api/portal-content/:id` | auth → adminOnly | — | Update a portal content item |
| 33914 | DELETE | `/api/portal-content/:id` | auth → adminOnly | — | Delete a portal content item |
| 33923 | PUT | `/api/portal-content/:id/publish` | auth → adminOnly | — | Toggle publish status of a portal content item |
| 33933 | POST | `/api/portal-content/reorder` | auth → adminOnly | — | Reorder portal content items |
| 33944 | GET | `/api/portal-content/published` | **none (public)** | — | Get published portal content (public) |
| 33950 | GET | `/api/portal-content/published/:section` | **none (public)** | — | Get published portal content for a section (public) |
| 38423 | GET | `/api/org/signature` | **none (public)** | — | Get the org signature image URL (public) |
| 38426 | POST | `/api/admin/org/signature` | auth → adminOnly | — | Set the org signature image |
| 38441 | POST | `/api/admin/org/signature/delete` | auth → adminOnly | — | Remove the org signature |

#### Area: public (no auth) (13 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 11818 | GET | `/api/public/content` | publicLimiter | — | Public: get published website content blocks (optional page filter) |
| 11837 | GET | `/api/public/status` | publicLimiter | — | Public: mirror of project status cards (no auth) |
| 11859 | GET | `/api/public/press` | publicLimiter | — | Public: press releases feed for the newsroom |
| 11884 | GET | `/api/public/press/:slug` | publicLimiter | — | Public: render a single press release page as HTML |
| 19981 | POST | `/api/public/register-invite` | **none (public)** | — | Return a no-op response for deprecated invite registration |
| 21647 | GET | `/api/public/testimonial` | publicLimiter | — | Show the public testimonial consent landing page |
| 21669 | GET | `/api/public/testimonial/submit` | publicLimiter | — | Submit a testimonial consent response (public) |
| 23777 | POST | `/api/public/newsletter/subscribe` | publicLimiter | — | Subscribe an email to the newsletter (public) |
| 31609 | GET | `/api/public/auction/:token/state` | publicLimiter | — | Get public auction live state |
| 31617 | POST | `/api/public/auction/:token/bid` | auctionBidLimiter | — | Place a public auction bid |
| 39045 | GET | `/api/public/confirm-seat` | publicLimiter | — | Confirm a seat reservation via emailed token link (public) |
| 39062 | GET | `/api/public/claim-seat` | publicLimiter | — | Claim a released seat via emailed token link (public) |
| 39098 | GET | `/api/public/feedback` | publicLimiter | — | Record or prompt for one-question post-event feedback (public) |

#### Area: pages (HTML, non-API) (11 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 938 | USE | `/uploads` | (middleware mount) | — | Serve uploaded files as static assets |
| 941 | USE | `/photo-library` | (middleware mount) | — | Serve shared user-portal photo library as static assets |
| 23770 | GET | `/newsletter` | publicLimiter | — | Serve the public newsletter signup page |
| 24377 | GET | `/review` | **none (public)** | — | Serve external reviewer magic-link workspace page |
| 24551 | GET | `/evaluate` | **none (public)** | — | Serve candidate evaluation page |
| 24908 | GET | `/apply` | **none (public)** | — | Serve public applicant portal page |
| 31136 | GET | `/e/:token` | publicLimiter | — | Serve the public combo invite landing page |
| 31645 | GET | `/a/:token` | publicLimiter | — | Serve the public auction bid/display page |
| 43148 | USE | `/api` | (middleware mount) | — | Return 404 JSON for unmatched API routes |
| 43169 | GET | `/health` | **none (public)** | — | Return a basic health check OK status |
| 43296 | GET | `*` | **none (public)** | — | Serve the SPA frontend fallback for client-side routes |

#### Area: other unmapped /api (49 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 873 | USE | `/api/public` | (middleware mount) | — | Restrict CORS on the public API to whitelisted origins |
| 11556 | GET | `/api/schedule/my` | auth | — | Get the current user's personal schedule |
| 11561 | POST | `/api/schedule/add` | auth | — | Add a session to the current user's personal schedule |
| 11572 | DELETE | `/api/schedule/:sessionId` | auth | — | Remove a session from the personal schedule |
| 11603 | POST | `/api/connections/request` | auth | — | Send a networking connection request |
| 11609 | GET | `/api/connections/my` | auth | — | List the current user's connection requests |
| 12159 | GET | `/api/admin/tasks` | auth → adminOnly | — | Admin: list top-level project tasks (optional project filter) |
| 12169 | POST | `/api/admin/tasks` | auth → adminOnly | — | Admin: create a project task |
| 12182 | PUT | `/api/admin/tasks/:id` | auth → adminOnly | — | Admin: update a project task's status/fields |
| 12200 | DELETE | `/api/admin/tasks/:id` | auth → adminOnly | — | Admin: delete a project task |
| 12340 | POST | `/api/admin/tasks/extract` | auth → adminOnly | — | Admin: extract candidate tasks from pasted meeting notes |
| 12364 | POST | `/api/admin/tasks/bulk` | auth → adminOnly | — | Admin: bulk-create tasks from selected candidates |
| 17204 | GET | `/api/team` | auth → adminOnly | — | Get all team members |
| 17209 | GET | `/api/team/me` | auth → adminOnly | — | Get the current user's team member record |
| 17215 | POST | `/api/team` | auth → adminOnly | — | Create a team member record for the current user |
| 18035 | GET | `/api/dashboard/summary` | auth → adminOnly | — | Get summary counts for the admin dashboard |
| 18068 | GET | `/api/dashboard/trends` | auth → adminOnly | — | Get 30-day registration trend data |
| 18121 | GET | `/api/dashboard/portal-stats` | auth → adminOnly | — | Get portal stats with week-over-week trends |
| 18552 | GET | `/api/timeline/:project` | auth → adminOnly | — | List timeline events for a project |
| 18561 | GET | `/api/timeline` | auth → adminOnly | — | List all timeline events across projects |
| 18567 | POST | `/api/timeline/:project` | auth → adminOnly | — | Create a timeline event for a project |
| 18582 | PUT | `/api/timeline/:project/:id` | auth → adminOnly | — | Update a timeline event |
| 18595 | DELETE | `/api/timeline/:project/:id` | auth → adminOnly | — | Delete a timeline event |
| 18730 | GET | `/api/search` | auth → adminOnly | — | Search across tasks, files, and folders |
| 23560 | POST | `/api/admin/pulse/run` | auth → adminOnly | — | Generate and stage the weekly admin pulse |
| 35332 | POST | `/api/team/heartbeat` | auth → staffOrAdmin | — | Record a portal presence heartbeat for usage tracking |
| 35359 | GET | `/api/team/usage` | auth → founderOnly | — | Get per-admin login and usage rollup (founder only) |
| 35837 | GET | `/api/admin/search` | auth → adminOnly | — | Search registrants and members by name, email, or invoice |
| 36350 | GET | `/api/admin/custom-fields` | auth → adminOnly | — | List custom registration questions for an event or link |
| 36364 | POST | `/api/admin/custom-fields` | auth → adminOnly | — | Create a custom registration question |
| 36387 | PUT | `/api/admin/custom-fields/:id` | auth → adminOnly | — | Update a custom registration question |
| 36410 | DELETE | `/api/admin/custom-fields/:id` | auth → adminOnly | — | Delete a custom registration question |
| 36765 | POST | `/api/admin/assistant` | assistantLimiter → auth → adminOnly | — | Ask the admin AI co-pilot assistant a question |
| 36795 | POST | `/api/admin/assistant/execute` | assistantLimiter → auth → adminOnly | — | Execute a confirmed AI assistant action |
| 36869 | POST | `/api/admin/ai/draft` | assistantLimiter → auth → adminOnly | — | Generate an AI draft for a given purpose and context |
| 36885 | GET | `/api/admin/planner/facts` | auth → adminOnly | — | Get live facts and photo library for planner wizard intro |
| 36891 | GET | `/api/admin/planner/photos` | auth → adminOnly | — | Get the photo library for the planner image picker |
| 36898 | POST | `/api/admin/planner/converse` | assistantLimiter → auth → adminOnly | — | Converse with the content planner to build a plan |
| 36924 | GET | `/api/admin/planner/plans` | auth → adminOnly | — | List recent content planner plans |
| 36932 | GET | `/api/admin/planner/plans/:id` | auth → adminOnly | — | Get one full content planner plan |
| 36943 | PUT | `/api/admin/planner/plans/:id` | auth → adminOnly | — | Save an edited content planner plan |
| 36962 | POST | `/api/admin/planner/plans/:id/approve` | auth → adminOnly | — | Approve a planner plan and materialize its items |
| 38059 | GET | `/api/admin/design-presets` | auth → adminOnly | — | List saved design presets for an artifact |
| 38071 | POST | `/api/admin/design-presets` | auth → adminOnly | — | Save a new design preset |
| 38084 | DELETE | `/api/admin/design-presets/:id` | auth → adminOnly | — | Delete a design preset |
| 38129 | POST | `/api/admin/design-assist` | auth → adminOnly | — | Convert a design brief into style tokens via AI |
| 38292 | GET | `/api/admin/cards/roster` | auth → adminOnly | — | Get attendance card roster for an event |
| 38314 | POST | `/api/admin/cards/send` | auth → adminOnly → express.json({ limit: '30mb' }) | — | Stage rendered attendance cards into the approval outbox |
| 42072 | GET | `/api/app-install-qr.png` | **none (public)** | — | Generate a QR code PNG for the staff app install URL (public) |

#### Area: plexus (335 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 11380 | GET | `/api/admin/scan-context` | auth → staffOrAdmin | plexus | Resolve a scanned attendee to a cross-event check-in snapshot (read-only) |
| 12494 | GET | `/api/admin/talks` | auth → adminOnly | plexus | Admin: list talks |
| 12498 | POST | `/api/admin/talks` | auth → adminOnly | plexus | Admin: create a talk |
| 12511 | PUT | `/api/admin/talks/:id` | auth → adminOnly | plexus | Admin: update a talk |
| 12528 | DELETE | `/api/admin/talks/:id` | auth → adminOnly | plexus | Admin: delete a talk |
| 12540 | GET | `/api/admin/registrant/:type/:id/activity` | auth → adminOnly | plexus | Admin: get a registrant's activity timeline (read-only) |
| 12589 | POST | `/api/admin/registrant/:type/:id/notes` | auth → adminOnly | plexus | Append a note to a registrant's activity timeline |
| 12605 | GET | `/api/admin/gala/seating` | auth → adminOnly | plexus | Admin: get gala seating tables, assignments, and paid guests |
| 12628 | POST | `/api/admin/gala/tables` | auth → adminOnly | plexus | Admin: create a gala seating table |
| 12641 | PUT | `/api/admin/gala/tables/:id` | auth → adminOnly | plexus | Admin: update a gala seating table |
| 12655 | DELETE | `/api/admin/gala/tables/:id` | auth → adminOnly | plexus | Admin: delete a gala seating table (and its assignments) |
| 12664 | POST | `/api/admin/gala/tables/:id/assign` | auth → adminOnly | plexus | Admin: assign a guest registration to a gala table |
| 12679 | POST | `/api/admin/gala/unassign` | auth → adminOnly | plexus | Admin: unassign a guest from their gala table |
| 12693 | GET | `/api/admin/gala/table-assignments` | auth → adminOnly | plexus | Admin: list gala table assignments (email-keyed mirror) |
| 12698 | POST | `/api/admin/gala/table-assignments/import` | auth → adminOnly | plexus | Admin: import gala table assignments from CSV |
| 12755 | DELETE | `/api/admin/gala/table-assignments/:id` | auth → adminOnly | plexus | Admin: delete a gala table assignment |
| 12872 | GET | `/api/admin/gala/picker-sync` | auth → adminOnly | plexus | Admin: get gala seating-picker sync status |
| 12888 | POST | `/api/admin/gala/picker-sync/run` | auth → adminOnly | plexus | Admin: run a manual gala seating-picker sync |
| 12904 | POST | `/api/admin/gala/picker-sync/send-invites` | auth → adminOnly | plexus | Admin: send gala table-picker invite emails to unsent rows |
| 12934 | GET | `/api/admin/waitlist` | auth → adminOnly | plexus | Admin: list the ticket waitlist (optional section filter) |
| 12942 | POST | `/api/admin/waitlist` | auth → adminOnly | plexus | Admin: add an entry to the ticket waitlist |
| 12952 | PUT | `/api/admin/waitlist/:id` | auth → adminOnly | plexus | Admin: update a waitlist entry's status/note |
| 12963 | DELETE | `/api/admin/waitlist/:id` | auth → adminOnly | plexus | Admin: delete a waitlist entry |
| 18868 | GET | `/api/admin/registrations` | auth → adminOnly | plexus | List conference registrations with filters |
| 18879 | POST | `/api/admin/registrations/:id/checkin` | auth → adminOnly | plexus | Check in a registration |
| 18885 | POST | `/api/admin/checkin/scan` | auth → adminOnly | plexus | Check in an attendee by scanning a QR code |
| 18899 | GET | `/api/admin/abstracts` | auth → adminOnly | plexus | List all submitted abstracts |
| 18904 | PUT | `/api/admin/abstracts/:id/decision` | auth → adminOnly | plexus | Record an accept/reject decision on an abstract |
| 18915 | GET | `/api/admin/analytics` | auth → adminOnly | plexus | Get site analytics with views, referrers, and trends |
| 18956 | GET | `/api/admin/analytics/:confId` | auth → adminOnly | plexus | Get registration analytics for a conference |
| 18972 | POST | `/api/admin/sessions` | auth → adminOnly | plexus | Create a conference session |
| 19030 | GET | `/api/admin/export/registrations/:confId` | auth → adminOnly | plexus | Export conference registrations as CSV or XLSX |
| 19060 | GET | `/api/admin/export/abstracts/:confId` | auth → adminOnly | plexus | Export abstracts as an XLSX workbook |
| 19105 | GET | `/api/plexus/conference` | **none (public)** | plexus | Get Plexus conference info and ticket types |
| 19134 | POST | `/api/plexus/promo/validate` | **none (public)** | plexus | Validate a promo code |
| 19152 | POST | `/api/plexus/register/start` | **none (public)** | plexus | Start conference registration and create an account |
| 19189 | POST | `/api/plexus/register/complete` | auth | plexus | Complete registration with ticket selection and payment |
| 19257 | GET | `/api/plexus/my-registration` | auth | plexus | Get the current user's conference registration |
| 19272 | POST | `/api/plexus/waitlist` | auth | plexus | Join the ticket waiting list |
| 19290 | POST | `/api/plexus/registration/:regId/transfer` | auth | plexus | Request to transfer a registration to someone else |
| 19305 | POST | `/api/plexus/registration/:regId/refund` | auth | plexus | Request a refund for a registration |
| 19320 | POST | `/api/plexus/scholarship` | auth | plexus | Apply for a conference scholarship |
| 19335 | POST | `/api/plexus/abstracts` | auth | plexus | Submit a conference abstract |
| 19361 | GET | `/api/plexus/my-abstracts` | auth | plexus | List the current user's submitted abstracts |
| 19373 | PUT | `/api/plexus/abstracts/:id` | auth | plexus | Update an abstract before the deadline |
| 19389 | POST | `/api/plexus/abstracts/:id/withdraw` | auth | plexus | Withdraw a submitted abstract |
| 19398 | GET | `/api/plexus/schedule` | **none (public)** | plexus | Get the full conference schedule |
| 19413 | GET | `/api/plexus/sessions/:id` | **none (public)** | plexus | Get session details with speakers |
| 19436 | POST | `/api/plexus/my-schedule/:sessionId` | auth | plexus | Add a session to the personal schedule |
| 19446 | DELETE | `/api/plexus/my-schedule/:sessionId` | auth | plexus | Remove a session from the personal schedule |
| 19453 | GET | `/api/plexus/my-schedule` | auth | plexus | Get the current user's personal schedule |
| 19461 | POST | `/api/plexus/sessions/:id/questions` | auth | plexus | Submit a question for a session |
| 19471 | POST | `/api/plexus/questions/:id/upvote` | auth | plexus | Toggle an upvote on a session question |
| 19487 | GET | `/api/admin/plexus/qa` | auth → adminOnly | plexus | List live Q&A questions for admin |
| 19510 | POST | `/api/admin/plexus/qa/:id/answer` | auth → adminOnly | plexus | Answer a live Q&A question |
| 19522 | POST | `/api/admin/plexus/qa/:id/hide` | auth → adminOnly | plexus | Hide or unhide a Q&A question |
| 19530 | POST | `/api/admin/plexus/qa/ask` | auth → adminOnly | plexus | Post an admin question into the Q&A |
| 19543 | POST | `/api/plexus/polls/:id/respond` | auth | plexus | Submit a response to a session poll |
| 19561 | POST | `/api/plexus/sessions/:id/rate` | auth | plexus | Rate a session and leave a comment |
| 19579 | GET | `/api/plexus/attendees` | auth | plexus | Search the attendee directory |
| 19608 | GET | `/api/plexus/attendees/:id` | auth | plexus | Get a public attendee profile |
| 19623 | POST | `/api/plexus/connections` | auth | plexus | Send a networking connection request |
| 19638 | PUT | `/api/plexus/connections/:id` | auth | plexus | Accept or reject a connection request |
| 19646 | GET | `/api/plexus/my-connections` | auth | plexus | List the current user's accepted connections |
| 19656 | POST | `/api/plexus/meetings` | auth | plexus | Request a meeting with another attendee |
| 19668 | GET | `/api/plexus/my-meetings` | auth | plexus | List sent and received meeting requests |
| 19679 | POST | `/api/plexus/visa-request` | auth | plexus | Request a visa invitation letter |
| 19697 | GET | `/api/plexus/hotels` | **none (public)** | plexus | List partner hotels for the conference |
| 19706 | POST | `/api/plexus/volunteers` | auth | plexus | Apply to volunteer at the conference |
| 19721 | GET | `/api/plexus/my-volunteer` | auth | plexus | Get the current user's volunteer status and shifts |
| 19739 | POST | `/api/plexus/speaker-application` | auth | plexus | Submit a speaker application |
| 19754 | GET | `/api/plexus/speakers` | **none (public)** | plexus | List published, confirmed speakers (public) |
| 19761 | GET | `/api/plexus/sponsors` | **none (public)** | plexus | List published sponsors (public) |
| 19768 | GET | `/api/plexus/announcements` | **none (public)** | plexus | List recent conference announcements |
| 19775 | GET | `/api/plexus/posters` | **none (public)** | plexus | List the digital poster gallery |
| 19788 | GET | `/api/plexus/photos` | **none (public)** | plexus | List the public conference photo gallery |
| 19795 | GET | `/api/plexus/resources` | **none (public)** | plexus | List conference resources and downloads |
| 19802 | GET | `/api/plexus/my-certificate` | auth | plexus | Get an attendance certificate for the current user |
| 19826 | GET | `/api/plexus/survey` | auth | plexus | Get the active conference survey |
| 19836 | POST | `/api/plexus/survey/:id/respond` | auth | plexus | Submit a survey response |
| 19850 | POST | `/api/plexus/checkin` | auth → staffOrAdmin | plexus | Check in an attendee by QR code (staff) |
| 19924 | POST | `/api/checkin/undo` | auth → staffOrAdmin | plexus | Undo an attendee check-in |
| 20059 | PUT | `/api/admin/plexus/registrations/:id` | auth → adminOnly | plexus | Update a registration's payment or ticket details |
| 20084 | GET | `/api/admin/plexus/registrations` | auth → adminOnly | plexus | List Plexus registrations for admin |
| 20106 | GET | `/api/admin/plexus/abstracts` | auth → adminOnly | plexus | List Plexus conference abstracts for admin |
| 20124 | POST | `/api/admin/plexus/abstracts/:id/assign-reviewer` | auth → adminOnly | plexus | Assign a reviewer to an abstract |
| 20134 | PUT | `/api/admin/plexus/abstracts/:id/decision` | auth → adminOnly | plexus | Update a Plexus abstract's status and decision |
| 20142 | GET | `/api/admin/plexus/stats` | auth → adminOnly | plexus | Get Plexus conference dashboard stats |
| 20165 | POST | `/api/admin/plexus/promo-codes` | auth → adminOnly | plexus | Create a promo code |
| 20176 | GET | `/api/admin/plexus/promo-codes` | auth → adminOnly | plexus | List promo codes for the conference |
| 20183 | POST | `/api/admin/plexus/sessions` | auth → adminOnly | plexus | Create a conference session (schedule builder) |
| 20205 | GET | `/api/admin/plexus/sessions` | auth → adminOnly | plexus | List all sessions, including unpublished |
| 20216 | PUT | `/api/admin/plexus/sessions/:id` | auth → adminOnly | plexus | Update a session |
| 20239 | DELETE | `/api/admin/plexus/sessions/:id` | auth → adminOnly | plexus | Delete a session |
| 20250 | PUT | `/api/admin/plexus/sessions/:id/publish` | auth → adminOnly | plexus | Publish or unpublish a session |
| 20267 | POST | `/api/admin/plexus/sessions/bulk-publish` | auth → adminOnly | plexus | Bulk publish sessions |
| 20290 | POST | `/api/admin/plexus/speakers` | auth → adminOnly | plexus | Create a speaker record |
| 20308 | POST | `/api/admin/plexus/volunteer-shifts` | auth → adminOnly | plexus | Create a volunteer shift |
| 20320 | GET | `/api/admin/plexus/volunteers` | auth → adminOnly | plexus | List volunteers for the conference |
| 20334 | PUT | `/api/admin/plexus/volunteers/:id` | auth → adminOnly | plexus | Approve or reject a volunteer |
| 20342 | POST | `/api/admin/plexus/sessions/:sessionId/polls` | auth → adminOnly | plexus | Launch a live poll for a session |
| 20356 | GET | `/api/admin/plexus/polls/:id/results` | auth → adminOnly | plexus | Get results for a session poll |
| 20374 | PUT | `/api/admin/plexus/refunds/:id` | auth → adminOnly | plexus | Process a refund request |
| 20383 | PUT | `/api/admin/plexus/visa-requests/:id` | auth → adminOnly | plexus | Process a visa letter request |
| 20392 | GET | `/api/admin/plexus/pending` | auth → adminOnly | plexus | Get all pending approval items |
| 20415 | GET | `/api/admin/plexus/speakers` | auth → adminOnly | plexus | List speakers, optionally filtered by year |
| 20430 | GET | `/api/admin/plexus/speakers/years` | auth → adminOnly | plexus | List distinct speaker years for the filter |
| 20437 | PUT | `/api/admin/plexus/speakers/:id` | auth → adminOnly | plexus | Update a speaker's profile and status |
| 20485 | DELETE | `/api/admin/plexus/speakers/:id` | auth → adminOnly | plexus | Delete a speaker |
| 20497 | GET | `/api/admin/plexus/speakers/:id/flight` | auth → adminOnly | plexus | Get a speaker's flight search context and quotes |
| 20515 | PUT | `/api/admin/plexus/speakers/:id/flight` | auth → adminOnly | plexus | Save a speaker's flight route and dates |
| 20531 | POST | `/api/admin/plexus/speakers/:id/flight/quotes` | auth → adminOnly | plexus | Add a real flight fare quote for a speaker |
| 20552 | PUT | `/api/admin/plexus/speakers/:id/flight/quotes/:qid/choose` | auth → adminOnly | plexus | Mark a flight quote as chosen |
| 20561 | DELETE | `/api/admin/plexus/speakers/:id/flight/quotes/:qid` | auth → adminOnly | plexus | Delete a flight quote |
| 20574 | GET | `/api/admin/plexus/travel-budget` | auth → adminOnly | plexus | Get the total speaker travel budget roll-up |
| 20601 | POST | `/api/admin/plexus/speakers/:id/flight/search` | auth → adminOnly | plexus | Search live flight fares via Amadeus |
| 20652 | POST | `/api/admin/plexus/speakers/:id/flight/offers/pin` | auth → adminOnly | plexus | Pin a live flight offer as the chosen fare |
| 20718 | POST | `/api/admin/spatial/assets` | auth → adminOnly → spatialUploadHandler | plexus | Upload a 3D scan asset |
| 20733 | GET | `/api/admin/spatial/assets` | auth → adminOnly | plexus | List 3D scan assets |
| 20739 | PUT | `/api/admin/spatial/assets/:id` | auth → adminOnly | plexus | Update a 3D asset's title or notes |
| 20750 | PUT | `/api/admin/spatial/assets/:id/attach` | auth → adminOnly | plexus | Attach a 3D asset to a surface (stub) |
| 20762 | DELETE | `/api/admin/spatial/assets/:id` | auth → adminOnly | plexus | Delete a 3D scan asset |
| 20844 | PUT | `/api/admin/plexus/speakers/:id/publish` | auth → adminOnly | plexus | Publish or unpublish a speaker |
| 20869 | POST | `/api/admin/plexus/speakers/:id/notify` | auth → adminOnly | plexus | Send a push notification about a speaker |
| 20888 | POST | `/api/admin/plexus/speakers/import` | auth → adminOnly → upload.single('file') | plexus | Import speakers from a CSV file |
| 20936 | POST | `/api/admin/plexus/speakers/invite` | auth → adminOnly | plexus | Send invitation emails to selected speakers |
| 21007 | POST | `/api/admin/plexus/speakers/:id/reinvite` | auth → adminOnly | plexus | Re-invite a past speaker for a new year |
| 21026 | POST | `/api/admin/plexus/speakers/:id/send-upload-link` | auth → adminOnly | plexus | Email a speaker their materials-upload link |
| 21116 | GET | `/api/admin/plexus/sponsors` | auth → adminOnly | plexus | List sponsors plus org-wide supporters for admin |
| 21128 | POST | `/api/admin/plexus/sponsors` | auth → adminOnly | plexus | Add a sponsor |
| 21147 | PUT | `/api/admin/plexus/sponsors/:id` | auth → adminOnly | plexus | Update a sponsor's details and status |
| 21163 | DELETE | `/api/admin/plexus/sponsors/:id` | auth → adminOnly | plexus | Delete a sponsor and its tasks |
| 21171 | PUT | `/api/admin/plexus/sponsors/:id/publish` | auth → adminOnly | plexus | Publish or unpublish a sponsor |
| 21180 | GET | `/api/admin/sponsor-tiers` | auth → adminOnly | plexus | Get the sponsor tier benefit catalog |
| 21186 | POST | `/api/admin/plexus/sponsors/:id/apply-benefits` | auth → adminOnly | plexus | Reapply a sponsor's tier benefit checklist |
| 21197 | POST | `/api/admin/plexus/sponsors/renewal-wrap` | auth → adminOnly | plexus | Stage renewal emails for fulfilled sponsors |
| 21218 | GET | `/api/admin/plexus/sponsors/:id/tasks` | auth → adminOnly | plexus | List tasks for a sponsor |
| 21224 | POST | `/api/admin/plexus/sponsors/:id/tasks` | auth → adminOnly | plexus | Add a task for a sponsor |
| 21234 | PUT | `/api/admin/plexus/sponsor-tasks/:taskId` | auth → adminOnly | plexus | Update a sponsor task |
| 21248 | DELETE | `/api/admin/plexus/sponsor-tasks/:taskId` | auth → adminOnly | plexus | Delete a sponsor task |
| 21255 | GET | `/api/admin/plexus/volunteers/export` | auth → adminOnly | plexus | Export volunteers as CSV |
| 21301 | GET | `/api/admin/plexus/recent-checkins` | auth → adminOnly | plexus | List recent conference check-ins |
| 21321 | POST | `/api/admin/plexus/volunteers/:id/approve` | auth → adminOnly | plexus | Approve a volunteer |
| 21328 | POST | `/api/admin/plexus/volunteers/:id/reject` | auth → adminOnly | plexus | Reject a volunteer |
| 21335 | POST | `/api/admin/plexus/refund/:id/approve` | auth → adminOnly | plexus | Approve a refund request |
| 21342 | POST | `/api/admin/plexus/refund/:id/reject` | auth → adminOnly | plexus | Reject a refund request |
| 21349 | POST | `/api/admin/plexus/visa/:id/approve` | auth → adminOnly | plexus | Approve a visa letter request |
| 21356 | POST | `/api/admin/plexus/visa/:id/reject` | auth → adminOnly | plexus | Reject a visa letter request |
| 21363 | POST | `/api/admin/plexus/scholarship/:id/approve` | auth → adminOnly | plexus | Approve a scholarship application |
| 21370 | POST | `/api/admin/plexus/scholarship/:id/reject` | auth → adminOnly | plexus | Reject a scholarship application |
| 21380 | POST | `/api/admin/plexus/transfer/:id/approve` | auth → adminOnly | plexus | Approve a registration name transfer |
| 21448 | POST | `/api/admin/plexus/transfer/:id/reject` | auth → adminOnly | plexus | Reject a registration name transfer |
| 21472 | GET | `/api/admin/early-bird` | auth → adminOnly | plexus | List early-bird bridges with code stats |
| 21484 | POST | `/api/admin/early-bird` | auth → adminOnly | plexus | Create or edit an early-bird bridge config |
| 21513 | POST | `/api/admin/early-bird/:id/generate` | auth → adminOnly | plexus | Generate promo codes for an early-bird bridge |
| 21534 | POST | `/api/admin/early-bird/:id/approve` | auth → adminOnly | plexus | Approve an early-bird bridge for sending |
| 21548 | POST | `/api/admin/early-bird/:id/stage-thankyou` | auth → adminOnly | plexus | Stage early-bird thank-you emails with codes |
| 21604 | POST | `/api/admin/testimonials/harvest` | auth → adminOnly | plexus | Stage consent-ask emails for high-rating survey respondents |
| 21688 | GET | `/api/admin/testimonials` | auth → adminOnly | plexus | List testimonials, optionally by status |
| 21698 | POST | `/api/admin/testimonials/:id/approve` | auth → adminOnly | plexus | Approve a testimonial |
| 21711 | POST | `/api/admin/testimonials/:id` | auth → adminOnly | plexus | Edit a testimonial's quote or status |
| 21721 | GET | `/api/admin/testimonials/export` | auth → adminOnly | plexus | Export approved testimonials as CSV |
| 21766 | GET | `/api/admin/post-event/assemble/facts` | auth → adminOnly | plexus | Get facts for assembling a post-event recap |
| 21771 | POST | `/api/admin/post-event/assemble` | auth → adminOnly | plexus | Assemble the post-event recap package |
| 21879 | POST | `/api/admin/sponsor-reports/generate` | auth → adminOnly | plexus | Generate sponsor impact reports |
| 21906 | GET | `/api/admin/sponsor-reports` | auth → adminOnly | plexus | List sponsor reports |
| 21914 | GET | `/api/admin/sponsor-reports/:id` | auth → adminOnly | plexus | Get a sponsor report |
| 21919 | POST | `/api/admin/sponsor-reports/:id` | auth → adminOnly | plexus | Edit a sponsor report's title, HTML, or status |
| 21930 | GET | `/api/admin/sponsor-reports/:id/pdf` | auth → adminOnly | plexus | Export a sponsor report as PDF |
| 21948 | POST | `/api/admin/sponsor-reports/:id/send` | auth → adminOnly | plexus | Send a sponsor report to the sponsor contact |
| 22123 | GET | `/api/admin/speaker-itineraries` | auth → adminOnly | plexus | List speaker itineraries |
| 22129 | GET | `/api/admin/speaker-itineraries/:id` | auth → adminOnly | plexus | Get a speaker itinerary with its items |
| 22137 | POST | `/api/admin/speaker-itineraries` | auth → adminOnly | plexus | Create a speaker itinerary |
| 22164 | PUT | `/api/admin/speaker-itineraries/:id` | auth → adminOnly | plexus | Update a speaker itinerary |
| 22193 | POST | `/api/admin/speaker-itineraries/:id/revoke` | auth → adminOnly | plexus | Revoke a speaker itinerary link |
| 22201 | POST | `/api/admin/speaker-itineraries/:id/unrevoke` | auth → adminOnly | plexus | Restore a revoked speaker itinerary link |
| 22211 | GET | `/api/admin/speaker-itineraries/:id/items` | auth → adminOnly | plexus | List items in a speaker itinerary |
| 22217 | POST | `/api/admin/speaker-itineraries/:id/items` | auth → adminOnly | plexus | Add an item to a speaker itinerary |
| 22240 | PUT | `/api/admin/speaker-itineraries/:id/items/:itemId` | auth → adminOnly | plexus | Update a speaker itinerary item |
| 22261 | DELETE | `/api/admin/speaker-itineraries/:id/items/:itemId` | auth → adminOnly | plexus | Delete a speaker itinerary item |
| 22272 | GET | `/api/admin/speaker-itineraries/:id/program-preview` | auth → adminOnly | plexus | Preview auto-matched programme sessions for a speaker |
| 22280 | POST | `/api/admin/speaker-itineraries/:id/send` | auth → adminOnly | plexus | Stage a speaker itinerary email for approval |
| 22719 | POST | `/api/admin/speaker-kits/generate` | auth → adminOnly | plexus | Generate speaker thank-you kits |
| 22745 | GET | `/api/admin/speaker-kits` | auth → adminOnly | plexus | List generated speaker kits |
| 22751 | POST | `/api/admin/speaker-kits/send` | auth → adminOnly | plexus | Stage speaker thank-you kit emails for approval |
| 22788 | POST | `/api/admin/post-event/attendee-thankyou` | auth → adminOnly | plexus | Stage attendee thank-you emails for approval |
| 22823 | POST | `/api/admin/plexus/speaker/:id/approve` | auth → adminOnly | plexus | Approve a speaker application into a speaker record |
| 22840 | POST | `/api/admin/plexus/speaker/:id/reject` | auth → adminOnly | plexus | Reject a speaker application |
| 29914 | GET | `/api/admin/plexus/speakers/:id/documents` | auth → adminOnly | plexus | List documents for a Plexus speaker |
| 29923 | GET | `/api/admin/plexus/speakers/documents/summary` | auth → adminOnly | plexus | Document upload status summary for all speakers |
| 29946 | GET | `/api/admin/plexus/speakers/:id/documents/:docId/download` | auth → adminOnly | plexus | Download a speaker document |
| 29967 | GET | `/api/admin/gala/settings` | auth → adminOnly | plexus | Get gala settings, creating defaults if missing |
| 30009 | PUT | `/api/admin/gala/settings` | auth → adminOnly | plexus | Update gala settings |
| 30075 | GET | `/api/admin/plexus/page-text` | auth → adminOnly | plexus | Get Plexus page text content |
| 30079 | PUT | `/api/admin/plexus/page-text` | auth → adminOnly | plexus | Update Plexus page text content |
| 30094 | GET | `/api/admin/gala/registrations` | auth → adminOnly | plexus | List gala registrations |
| 30100 | GET | `/api/gala/registrations` | auth → adminOnly | plexus | List gala registrations, frontend-compat alias |
| 30106 | PUT | `/api/gala/registrations/:id` | auth → adminOnly | plexus | Approve or reject a gala registration |
| 30189 | GET | `/api/gala/registrations/:id/pay-link` | auth → adminOnly | plexus | Get a direct payment link for an approved gala guest |
| 30212 | GET | `/api/admin/gala/menu-options` | auth → adminOnly | plexus | List active gala dinner menu options |
| 30218 | POST | `/api/admin/gala/menu-options` | auth → adminOnly | plexus | Create a gala dinner menu option |
| 30232 | PUT | `/api/admin/gala/menu-options/:id` | auth → adminOnly | plexus | Update a gala dinner menu option |
| 30248 | DELETE | `/api/admin/gala/menu-options/:id` | auth → adminOnly | plexus | Delete a gala dinner menu option |
| 30264 | GET | `/api/admin/gala/who-is-coming` | auth → adminOnly | plexus | Gala attendee institutions breakdown with AI brief |
| 30310 | POST | `/api/admin/gala/guest-message/draft` | auth → adminOnly | plexus | Draft a personalized message to a gala guest |
| 30343 | POST | `/api/admin/gala/guest-message/queue` | auth → adminOnly | plexus | Queue a gala guest message into the approval outbox |
| 30379 | POST | `/api/admin/gala/program/notify` | auth → adminOnly | plexus | Email gala attendees the program, approval-gated |
| 30452 | POST | `/api/admin/gala/invite-links` | auth → adminOnly | plexus | Create a gala invite link |
| 30473 | GET | `/api/admin/gala/invite-links` | auth → adminOnly | plexus | List gala invite links |
| 30479 | GET | `/api/admin/gala/invite-links/:id` | auth → adminOnly | plexus | Get a gala invite link with its registrations |
| 30491 | DELETE | `/api/admin/gala/invite-links/:id` | auth → adminOnly | plexus | Revoke a gala invite link |
| 30499 | POST | `/api/admin/gala/invite-links/:id/revoke` | auth → adminOnly | plexus | Revoke a gala invite link |
| 30563 | GET | `/api/admin/plexus-experience/registrations` | auth → adminOnly | plexus | List Plexus Experience registrations |
| 30580 | GET | `/api/admin/plexus-experience/emails-by-event/:event` | auth → adminOnly | plexus | List emails by event for Plexus Experience registrants |
| 30971 | POST | `/api/admin/plexus/combo-links` | auth → adminOnly | plexus | Create a Plexus combo invite link |
| 31024 | GET | `/api/admin/plexus/combo-links` | auth → adminOnly | plexus | List Plexus combo invite links |
| 31032 | DELETE | `/api/admin/plexus/combo-links/:id` | auth → adminOnly | plexus | Revoke a Plexus combo invite link |
| 31294 | GET | `/api/admin/auctions` | auth → adminOnly | plexus | List auctions with item and sold counts |
| 31306 | POST | `/api/admin/auctions` | auth → adminOnly | plexus | Create an auction |
| 31330 | GET | `/api/admin/auctions/:id` | auth → adminOnly | plexus | Get an auction's detail |
| 31338 | PUT | `/api/admin/auctions/:id` | auth → adminOnly | plexus | Update an auction |
| 31362 | DELETE | `/api/admin/auctions/:id` | auth → adminOnly | plexus | Delete an auction and its items and bids |
| 31376 | POST | `/api/admin/auctions/:id/items` | auth → adminOnly | plexus | Add an item to an auction |
| 31397 | PUT | `/api/admin/auctions/:id/items/:itemId` | auth → adminOnly | plexus | Update an auction item |
| 31417 | DELETE | `/api/admin/auctions/:id/items/:itemId` | auth → adminOnly | plexus | Delete an auction item |
| 31431 | POST | `/api/admin/auctions/:id/items/:itemId/status` | auth → adminOnly | plexus | Open, pause, or close an auction lot |
| 31455 | POST | `/api/admin/auctions/:id/bids` | auth → adminOnly | plexus | Record a staff paddle bid entry |
| 31481 | POST | `/api/admin/auctions/:id/bids/:bidId/void` | auth → adminOnly | plexus | Void an auction bid |
| 31496 | POST | `/api/admin/auctions/:id/items/:itemId/confirm-winner` | auth → adminOnly | plexus | Confirm an auction lot's winner and stage donation email |
| 31526 | POST | `/api/admin/auctions/:id/items/:itemId/mark-paid` | auth → adminOnly | plexus | Mark an auction item as paid |
| 31540 | POST | `/api/admin/auctions/:id/items/:itemId/remind` | auth → adminOnly | plexus | Stage an unpaid auction item reminder email |
| 31569 | GET | `/api/admin/auction-summary` | auth → adminOnly | plexus | Auction results summary for the command center |
| 31592 | GET | `/api/admin/auctions/:id/qr` | auth → adminOnly | plexus | Get QR data URLs for an auction's public pages |
| 32538 | GET | `/api/admin/checkin/events` | auth → staffOrAdmin | plexus | List check-in scanner events and gates |
| 32551 | PUT | `/api/admin/checkin/events/:key` | auth → adminOnly | plexus | Upsert a check-in gate |
| 32576 | GET | `/api/admin/checkin/resolve` | auth → staffOrAdmin | plexus | Resolve a scanned code to a ticket without marking |
| 32685 | POST | `/api/admin/checkin/ticket` | auth → staffOrAdmin | plexus | Check in a ticket for an event |
| 32768 | GET | `/api/admin/checkin/lookup` | auth → staffOrAdmin | plexus | Manual check-in lookup by name, email, or id |
| 32801 | GET | `/api/admin/checkin/audit` | auth → adminOnly | plexus | Recent check-in scan audit log |
| 32810 | POST | `/api/admin/tickets/:id/revoke` | auth → adminOnly | plexus | Revoke or restore a ticket and sync Wallet state |
| 32831 | POST | `/api/admin/wallet/provision` | auth → adminOnly | plexus | Backfill Google Wallet class and objects for a conference |
| 32848 | POST | `/api/admin/checkin/verify` | auth → staffOrAdmin | plexus | Universal event check-in verify, mirrors user portal |
| 33119 | GET | `/api/admin/checkin/enrich` | auth → adminOnly | plexus | Look up a checked-in guest's other registrations and membership |
| 33267 | POST | `/api/admin/checkin/test-email` | auth → adminOnly | plexus | Send a test check-in QR email |
| 33331 | POST | `/api/admin/checkin/test-bundle-email` | auth → adminOnly | plexus | Send a simulated paid CA bundle confirmation email |
| 33437 | GET | `/api/admin/gala/scan/:regId` | auth → staffOrAdmin | plexus | Scan/look up a gala registration by id |
| 33465 | POST | `/api/admin/gala/checkin` | auth → staffOrAdmin | plexus | Check in a gala guest |
| 33538 | GET | `/api/checkin/stats` | auth → staffOrAdmin | plexus | Aggregated check-in counts across all event tables |
| 33584 | GET | `/api/checkin/recent` | auth → staffOrAdmin | plexus | List the 10 most recent check-ins across events |
| 33616 | GET | `/api/checkin/search` | auth → staffOrAdmin | plexus | Search attendees by name or email across tables |
| 33652 | GET | `/api/checkin/roster` | auth → staffOrAdmin | plexus | Full guest roster for offline scanner cache |
| 33704 | POST | `/api/checkin` | auth → staffOrAdmin | plexus | Universal check-in detecting event type from QR |
| 33756 | PUT | `/api/admin/plexus/sessions/:id/toggle-checkin` | auth → adminOnly | plexus | Toggle check-in for a session |
| 33786 | POST | `/api/admin/plexus/sessions/:id/checkin` | auth → adminOnly | plexus | Check a registrant into a conference session via QR |
| 33827 | GET | `/api/admin/plexus/checkin-enabled-sessions` | auth → adminOnly | plexus | List sessions with check-in enabled |
| 33838 | GET | `/api/admin/plexus/sessions/:id/checkins` | auth → adminOnly | plexus | List check-ins for a specific session |
| 33845 | POST | `/api/admin/plexus/regenerate-qr-codes` | auth → adminOnly | plexus | Regenerate QR codes for all registrations in v2 format |
| 34527 | GET | `/api/admin/plexus/settings` | auth → adminOnly | plexus | Get Plexus conference settings |
| 34551 | PUT | `/api/admin/plexus/settings` | auth → adminOnly | plexus | Update Plexus conference settings |
| 34649 | GET | `/api/admin/plexus/rooms` | auth → adminOnly | plexus | List venue rooms for the active conference |
| 34655 | POST | `/api/admin/plexus/rooms` | auth → adminOnly | plexus | Create a venue room |
| 34667 | PUT | `/api/admin/plexus/rooms/:id` | auth → adminOnly | plexus | Update a venue room |
| 34683 | DELETE | `/api/admin/plexus/rooms/:id` | auth → adminOnly | plexus | Delete a venue room |
| 34935 | GET | `/api/admin/registrant-emails` | auth → adminOnly | plexus | List deduped registrant emails for compose autocomplete |
| 35495 | POST | `/api/admin/registrant/:type/:id/mark-paid` | auth → adminOnly | plexus | Mark a registrant as paid manually |
| 35506 | POST | `/api/admin/registrant/:type/:id/note` | auth → adminOnly | plexus | Add or replace an admin note on a registrant |
| 35517 | POST | `/api/admin/registrant/:type/:id/resend-ticket` | auth → adminOnly | plexus | Resend a registrant's QR ticket confirmation email |
| 36197 | GET | `/api/admin/event-components` | auth → adminOnly | plexus | List selectable priced components for an event type |
| 36208 | PUT | `/api/admin/event-components/:id` | auth → adminOnly | plexus | Edit an event component's price or label |
| 36226 | POST | `/api/admin/registration-links` | auth → adminOnly | plexus | Create a direct registration link for an event |
| 36304 | GET | `/api/admin/registration-links` | auth → adminOnly | plexus | List all registration links |
| 36335 | PUT | `/api/admin/registration-links/:id/deactivate` | auth → adminOnly | plexus | Deactivate a registration link |
| 36424 | GET | `/api/admin/coupons` | auth → adminOnly | plexus | List coupon codes for an event type |
| 36433 | POST | `/api/admin/coupons` | auth → adminOnly | plexus | Create a coupon code |
| 36452 | PUT | `/api/admin/coupons/:id` | auth → adminOnly | plexus | Update a coupon code |
| 36467 | DELETE | `/api/admin/coupons/:id` | auth → adminOnly | plexus | Deactivate a coupon code |
| 38181 | GET | `/api/admin/print/context` | auth → adminOnly | plexus | Get context for the print picker (roster, sponsors, counts) |
| 38199 | POST | `/api/admin/print/preview` | auth → adminOnly | plexus | Preview print artwork HTML for badges, banner, or backdrop |
| 38218 | POST | `/api/admin/print/render` | auth → adminOnly | plexus | Render print artwork to PDF via headless Chrome |
| 38922 | GET | `/api/admin/post-event/summary` | auth → adminOnly | plexus | Get post-event close-out summary for an event |
| 38927 | POST | `/api/admin/post-event/run-round` | auth → adminOnly | plexus | Run the post-event round issuing certificates and staging emails |
| 38941 | POST | `/api/admin/event-survey/send` | auth → adminOnly | plexus | Stage a post-event micro-survey to checked-in attendees |
| 38953 | GET | `/api/admin/event-survey/results` | auth → adminOnly | plexus | Get live post-event survey result aggregates |
| 38961 | GET | `/api/admin/event-survey/ai-summary` | auth → adminOnly | plexus | Get an AI summary of post-event survey results |
| 38969 | GET | `/api/admin/event-survey/settings` | auth → adminOnly | plexus | Get the post-event survey auto-send setting |
| 38975 | POST | `/api/admin/event-survey/settings` | auth → adminOnly | plexus | Toggle the post-event survey auto-send setting |
| 38988 | GET | `/api/admin/seat-confirmations/summary` | auth → adminOnly | plexus | Get confirm-your-seat counts and config summary |
| 38995 | POST | `/api/admin/seat-confirmations/start-round` | auth → adminOnly | plexus | Start a seat confirmation or reminder round |
| 39007 | POST | `/api/admin/seat-confirmations/release-unconfirmed` | auth → adminOnly | plexus | Release unconfirmed seats and offer them to the waitlist |
| 39017 | PUT | `/api/admin/seat-confirmations/config` | auth → adminOnly | plexus | Configure seat confirmation T-offset timing |
| 39033 | GET | `/api/admin/waitlist-offers` | auth → adminOnly | plexus | List waitlist offer states |
| 40785 | GET | `/api/admin/event-invites/catalog` | auth → adminOnly | plexus | List event invite catalog with sender defaults |
| 40791 | GET | `/api/admin/event-invites/campaigns` | auth → adminOnly | plexus | List event invite campaigns |
| 40797 | POST | `/api/admin/event-invites/campaigns` | auth → adminOnly | plexus | Create a new event invite campaign |
| 40823 | GET | `/api/admin/event-invites/campaigns/:id` | auth → adminOnly | plexus | Get one event invite campaign with invitee counts |
| 40830 | PUT | `/api/admin/event-invites/campaigns/:id` | auth → adminOnly | plexus | Update an event invite campaign's settings |
| 40849 | DELETE | `/api/admin/event-invites/campaigns/:id` | auth → adminOnly | plexus | Delete an event invite campaign and its invitees/replies |
| 40861 | POST | `/api/admin/event-invites/campaigns/:id/approve` | auth → adminOnly | plexus | Approve an event invite campaign |
| 40871 | POST | `/api/admin/event-invites/campaigns/:id/pause` | auth → adminOnly | plexus | Pause an event invite campaign |
| 40881 | POST | `/api/admin/event-invites/campaigns/:id/resume` | auth → adminOnly | plexus | Resume a paused event invite campaign |
| 40892 | POST | `/api/admin/event-invites/campaigns/:id/tick` | auth → adminOnly | plexus | Run one tick of the event invite campaign sender |
| 40900 | POST | `/api/admin/event-invites/campaigns/:id/followup-tick` | auth → adminOnly | plexus | Run one tick of event invite follow-up sends |
| 40908 | POST | `/api/admin/event-invites/campaigns/:id/preview` | auth → adminOnly | plexus | Preview an event invite or follow-up email |
| 40922 | POST | `/api/admin/event-invites/campaigns/:id/import` | auth → adminOnly → candidateImportUpload.single('file') | plexus | Preview an uploaded CSV/XLSX of event invitees |
| 40944 | POST | `/api/admin/event-invites/campaigns/:id/import/commit` | auth → adminOnly | plexus | Commit mapped event invitee import rows, deduping |
| 41011 | GET | `/api/admin/event-invites/campaigns/:id/invitees` | auth → adminOnly | plexus | List invitees for an event invite campaign |
| 41025 | DELETE | `/api/admin/event-invites/invitees/:id` | auth → adminOnly | plexus | Delete an event invite invitee |
| 41035 | POST | `/api/admin/event-invites/invitees/:id/decline` | auth → adminOnly | plexus | Decline an event invite invitee |
| 41045 | POST | `/api/admin/event-invites/invitees/:id/reply` | auth → adminOnly | plexus | Log a manual reply from an event invitee |
| 41055 | GET | `/api/admin/event-invites/invitees/:id/replies` | auth → adminOnly | plexus | List logged replies for an event invitee |
| 41060 | POST | `/api/admin/event-invites/replies/ingest` | auth → adminOnly | plexus | Ingest an event invite reply from the Graph connector |
| 41071 | GET | `/api/admin/event-invites/reply-templates` | auth → adminOnly | plexus | List event invite auto-reply templates with readiness |
| 41077 | PUT | `/api/admin/event-invites/reply-templates/:category` | auth → adminOnly | plexus | Update an event invite auto-reply template |
| 41098 | POST | `/api/admin/event-invites/reply-templates/:category/approve` | auth → adminOnly | plexus | Approve an event invite auto-reply template |
| 41109 | POST | `/api/admin/event-invites/reply-templates/:category/unapprove` | auth → adminOnly | plexus | Unapprove an event invite auto-reply template |
| 41120 | POST | `/api/admin/event-invites/reply-templates/:category/preview` | auth → adminOnly | plexus | Preview an event invite auto-reply template |
| 41137 | GET | `/api/admin/event-invites/campaigns/:id/auto-reply` | auth → adminOnly | plexus | Get auto-reply settings, readiness, and log for a campaign |
| 41145 | POST | `/api/admin/event-invites/campaigns/:id/auto-reply/toggle` | auth → adminOnly | plexus | Toggle auto-reply on or off for a campaign |
| 41158 | GET | `/api/admin/event-invites/campaigns/:id/auto-reply/log` | auth → adminOnly | plexus | List auto-reply send log for a campaign |
| 41167 | POST | `/api/admin/event-invites/replies/mock-inbound` | auth → adminOnly | plexus | Inject a mock inbound reply to test the auto-reply path |
| 41176 | POST | `/api/admin/event-invites/discover` | auth → adminOnly | plexus | AI-discover candidate invitees from a brief |
| 41215 | POST | `/api/admin/event-invites/campaigns/:id/discover/add` | auth → adminOnly | plexus | Add reviewed AI-discovered candidates into a campaign |
| 41526 | GET | `/api/admin/event-reminders/catalog` | auth → adminOnly | plexus | List reminder-eligible events with default touch config |
| 41533 | GET | `/api/admin/event-reminders/sequences` | auth → adminOnly | plexus | List event reminder sequences |
| 41539 | POST | `/api/admin/event-reminders/sequences` | auth → adminOnly | plexus | Create a reminder sequence for an event |
| 41558 | GET | `/api/admin/event-reminders/sequences/:id` | auth → adminOnly | plexus | Get one event reminder sequence |
| 41565 | PUT | `/api/admin/event-reminders/sequences/:id` | auth → adminOnly | plexus | Update a reminder sequence's settings |
| 41580 | PUT | `/api/admin/event-reminders/sequences/:id/touches/:touchId` | auth → adminOnly | plexus | Update one touch in a reminder sequence |
| 41622 | POST | `/api/admin/event-reminders/sequences/:id/approve` | auth → adminOnly | plexus | Approve a reminder sequence to start firing |
| 41644 | POST | `/api/admin/event-reminders/sequences/:id/pause` | auth → adminOnly | plexus | Pause a reminder sequence and recall scheduled emails |
| 41669 | POST | `/api/admin/event-reminders/sequences/:id/resume` | auth → adminOnly | plexus | Resume a paused reminder sequence |
| 41679 | DELETE | `/api/admin/event-reminders/sequences/:id` | auth → adminOnly | plexus | Delete a reminder sequence and its touches |
| 41692 | POST | `/api/admin/event-reminders/sequences/:id/run` | auth → adminOnly | plexus | Run the due reminder touch now |
| 41703 | POST | `/api/admin/event-reminders/sequences/:id/preview` | auth → adminOnly | plexus | Render one reminder touch to HTML for preview |
| 41722 | GET | `/api/admin/event-reminders/sequences/:id/audience` | auth → adminOnly | plexus | Get a live sample of the reminder send audience |

#### Area: accelerator (120 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 12047 | GET | `/api/admin/accelerator-sites` | auth → adminOnly | accelerator | Admin: list accelerator host sites (member board) |
| 12051 | POST | `/api/admin/accelerator-sites` | auth → adminOnly | accelerator | Admin: create an accelerator host site |
| 12067 | PUT | `/api/admin/accelerator-sites/:id` | auth → adminOnly | accelerator | Admin: update an accelerator host site |
| 12086 | DELETE | `/api/admin/accelerator-sites/:id` | auth → adminOnly | accelerator | Admin: delete an accelerator host site |
| 12467 | GET | `/api/admin/opportunities` | auth → adminOnly | accelerator | Admin: list opportunities (optional status filter) |
| 12475 | PUT | `/api/admin/opportunities/:id` | auth → adminOnly | accelerator | Admin: update an opportunity's fields/status |
| 13034 | GET | `/api/accelerator/program` | **none (public)** | accelerator | Get the active accelerator program |
| 13041 | GET | `/api/accelerator/institutions` | **none (public)** | accelerator | List active accelerator partner institutions |
| 13052 | GET | `/api/accelerator/countdown` | **none (public)** | accelerator | Get the countdown target for the public accelerator hero |
| 13096 | GET | `/api/accelerator/applications/my` | auth | accelerator | Get the current user's accelerator application |
| 13112 | POST | `/api/accelerator/applications` | auth | accelerator | Create or update the user's accelerator application |
| 13160 | POST | `/api/accelerator/applications/:id/documents/:docType` | auth → acceleratorUpload.single('file') | accelerator | Upload a single document for an accelerator application |
| 13207 | POST | `/api/accelerator/applications/:id/documents` | auth → acceleratorUpload.single('file') | accelerator | Upload a document to any accelerator application (admin) |
| 13251 | GET | `/api/accelerator/documents/:docId` | auth | accelerator | Download a single accelerator application document |
| 13272 | DELETE | `/api/accelerator/documents/:docId` | auth | accelerator | Delete an accelerator application document |
| 13300 | POST | `/api/accelerator/applications/:id/submit` | auth | accelerator | Submit a completed accelerator application |
| 13312 | GET | `/api/accelerator/applications/:id/package` | auth | accelerator | Generate a combined PDF package for an application |
| 13455 | GET | `/api/accelerator/years` | auth | accelerator | List all accelerator program years |
| 13461 | GET | `/api/accelerator/years/:year` | auth | accelerator | Get program details for a specific accelerator year |
| 13468 | POST | `/api/accelerator/years` | auth | accelerator | Create a new accelerator program year |
| 13483 | PUT | `/api/accelerator/years/:year` | auth | accelerator | Update an accelerator program year's details |
| 13497 | GET | `/api/admin/accelerator/overview-config` | auth | accelerator | Get accelerator overview config for a year |
| 13511 | PUT | `/api/admin/accelerator/overview-config` | auth | accelerator | Update accelerator overview config for a year |
| 13529 | GET | `/api/accelerator/years/:year/dates` | auth | accelerator | List key dates for an accelerator year |
| 13535 | POST | `/api/accelerator/years/:year/dates` | auth | accelerator | Add a key date to an accelerator year |
| 13561 | PUT | `/api/accelerator/dates/:id` | auth | accelerator | Update an accelerator key date |
| 13589 | DELETE | `/api/accelerator/dates/:id` | auth | accelerator | Delete an accelerator key date |
| 13598 | GET | `/api/accelerator/years/:year/institutions` | auth | accelerator | Get partner institutions with year-specific details |
| 13612 | PUT | `/api/accelerator/years/:year/institutions/:instId` | auth | accelerator | Add or update an institution's details for a year |
| 13645 | PUT | `/api/accelerator/institutions/:id` | auth | accelerator | Update an institution's base fields |
| 13657 | POST | `/api/accelerator/institutions` | auth | accelerator | Add a new partner institution |
| 13671 | GET | `/api/accelerator/years/:year/applications` | auth | accelerator | List accelerator applications for a year (with filters) |
| 13692 | GET | `/api/accelerator/applications/:id/full` | auth | accelerator | Get a single accelerator application with full details |
| 13710 | POST | `/api/accelerator/apply` | **none (public)** | accelerator | Submit a public accelerator application (no auth) |
| 13757 | POST | `/api/accelerator/applications/:id/message` | auth → adminOnly | accelerator | Send a message to an accelerator candidate |
| 13794 | PUT | `/api/accelerator/applications/:id/validity` | auth | accelerator | Update an application's validity status and notify the applicant |
| 13849 | GET | `/api/accelerator/years/:year/criteria` | auth | accelerator | List evaluation criteria for an accelerator year |
| 13855 | POST | `/api/accelerator/years/:year/criteria` | auth | accelerator | Add an evaluation criterion |
| 13867 | PUT | `/api/accelerator/criteria/:id` | auth | accelerator | Update an evaluation criterion |
| 13878 | DELETE | `/api/accelerator/criteria/:id` | auth | accelerator | Delete (deactivate) an evaluation criterion |
| 13887 | POST | `/api/accelerator/applications/:appId/evaluate` | auth → adminOnly | accelerator | Save one evaluation score for an application |
| 13908 | POST | `/api/accelerator/applications/:appId/evaluate-batch` | auth → adminOnly | accelerator | Batch-save multiple evaluation scores at once |
| 14297 | GET | `/api/admin/review/config` | auth → adminOnly | accelerator | Admin: get the review rubric config and cycle progress |
| 14320 | PUT | `/api/admin/review/rubric` | auth → adminOnly | accelerator | Admin: update the review rubric's criteria |
| 14366 | POST | `/api/admin/review/blind` | auth → adminOnly | accelerator | Admin: toggle blind review on/off for a cycle |
| 14378 | GET | `/api/admin/review/reviewers` | auth → adminOnly | accelerator | Admin: list reviewers with assignment/submission counts |
| 14394 | POST | `/api/admin/review/reviewers/external` | auth → adminOnly | accelerator | Admin: add an external reviewer |
| 14413 | POST | `/api/admin/review/reviewers/external/:id/invite` | auth → adminOnly | accelerator | Admin: send an invite link to an external reviewer |
| 14445 | POST | `/api/admin/review/reviewers/external/:id/toggle` | auth → adminOnly | accelerator | Admin: toggle an external reviewer active/inactive |
| 14454 | POST | `/api/admin/review/reviewers/external/:id/regenerate` | auth → adminOnly | accelerator | Admin: regenerate an external reviewer's access token |
| 14486 | GET | `/api/admin/review/submissions` | auth → adminOnly | accelerator | Admin: list submissions with review-assignment overview |
| 14510 | GET | `/api/admin/review/submissions/:id` | auth → adminOnly | accelerator | Admin: get one submission's review detail |
| 14529 | POST | `/api/admin/review/assignments` | auth → adminOnly | accelerator | Admin: assign a reviewer to a submission |
| 14550 | DELETE | `/api/admin/review/assignments/:id` | auth → adminOnly | accelerator | Admin: remove a review assignment |
| 14563 | POST | `/api/admin/review/assignments/auto` | auth → adminOnly | accelerator | Admin: bulk auto-assign reviewers round-robin across submissions |
| 14602 | GET | `/api/admin/review/my/assignments` | auth | accelerator | Admin: list the logged-in reviewer's own assignments |
| 14621 | GET | `/api/admin/review/my/scorecard/:assignmentId` | auth | accelerator | Admin: get a scorecard for one of the reviewer's assignments |
| 14637 | POST | `/api/admin/review/my/scorecard/:assignmentId` | auth | accelerator | Admin: submit or save a review scorecard |
| 14648 | POST | `/api/admin/review/my/assignments/:assignmentId/recuse` | auth | accelerator | Admin: recuse self from a review assignment |
| 14660 | GET | `/api/admin/review/progress` | auth → adminOnly | accelerator | Admin: get review progress and scoring completion stats |
| 14692 | GET | `/api/review-access/:token` | **none (public)** | accelerator | External reviewer: load assignments via magic-link token |
| 14717 | GET | `/api/review-access/:token/submission/:assignmentId` | **none (public)** | accelerator | External reviewer: get one assigned submission's detail via token |
| 14734 | POST | `/api/review-access/:token/scorecard/:assignmentId` | **none (public)** | accelerator | External reviewer: submit a scorecard via token |
| 14746 | POST | `/api/review-access/:token/recuse/:assignmentId` | **none (public)** | accelerator | External reviewer: recuse from an assignment via token |
| 14923 | GET | `/api/admin/review/decisions` | auth → adminOnly | accelerator | Admin: get the decisions board (scores and status per submission) |
| 14973 | POST | `/api/admin/review/decisions/:submissionId` | auth → adminOnly | accelerator | Admin: record or revert a decision on a submission |
| 15019 | POST | `/api/admin/review/decisions/:submissionId/letter/preview` | auth → adminOnly | accelerator | Admin: preview a decision letter draft (no queueing) |
| 15069 | POST | `/api/admin/review/decisions/:submissionId/letter/queue` | auth → adminOnly | accelerator | Admin: queue a decision letter to the outbox |
| 15080 | POST | `/api/admin/review/decisions/:submissionId/letter/requeue` | auth → adminOnly | accelerator | Admin: requeue a decision letter (cancel pending, clear marker) |
| 15092 | POST | `/api/admin/review/decisions/letters/batch` | auth → adminOnly | accelerator | Admin: batch-queue decision letters for all decided submissions |
| 15109 | GET | `/api/admin/review/funnel` | auth → adminOnly | accelerator | Admin: get accelerator funnel counts by stage |
| 15143 | GET | `/api/accelerator/years/:year/interviewers` | auth | accelerator | List active interviewers for an accelerator year |
| 15149 | POST | `/api/accelerator/years/:year/interviewers` | auth | accelerator | Add an interviewer for a year |
| 15161 | PUT | `/api/accelerator/interviewers/:id` | auth | accelerator | Update an interviewer's fields |
| 15171 | DELETE | `/api/accelerator/interviewers/:id` | auth | accelerator | Delete (deactivate) an interviewer |
| 15178 | POST | `/api/accelerator/interview-score` | **none (public)** | accelerator | Submit an interview score via interviewer credentials |
| 15204 | GET | `/api/accelerator/interview-access/:token` | **none (public)** | accelerator | Validate an interviewer magic-link token and return session |
| 15276 | GET | `/api/accelerator/interview-access/:token/application/:appId` | **none (public)** | accelerator | Get full application details via interviewer magic link |
| 15342 | POST | `/api/accelerator/interview-access/:token/score` | **none (public)** | accelerator | Submit a criterion score via interviewer magic link |
| 15420 | POST | `/api/accelerator/interviewers/:id/send-link` | auth | accelerator | Send a magic-link email to an interviewer |
| 15475 | POST | `/api/accelerator/interviewers/:id/regenerate-token` | auth | accelerator | Regenerate an interviewer's access token |
| 15483 | GET | `/api/accelerator/interviewers/:id/assignments` | auth | accelerator | Get an interviewer's assigned applications |
| 15495 | PUT | `/api/accelerator/interviewers/:id/assignments` | auth | accelerator | Replace an interviewer's application assignments |
| 15523 | GET | `/api/accelerator/registrations` | auth | accelerator | List accelerator applicant registrations for admin |
| 15543 | GET | `/api/accelerator/registrations/:id` | auth | accelerator | Get a single applicant's details (admin) |
| 15678 | GET | `/api/accelerator/years/:year/pdf-settings` | auth | accelerator | Get PDF settings for an accelerator year (with defaults) |
| 15703 | PUT | `/api/accelerator/years/:year/pdf-settings` | auth | accelerator | Update PDF settings for an accelerator year |
| 15743 | GET | `/api/accelerator/years/:year/ranking` | auth | accelerator | Generate the ranking list for a year and institution |
| 15777 | POST | `/api/accelerator/years/:year/update-rankings` | auth | accelerator | Batch-update ranking positions for a year |
| 15799 | POST | `/api/accelerator/years/:year/publish-rankings` | auth | accelerator | Publish rankings and notify applicants of their rank |
| 15838 | POST | `/api/admin/accelerator/result-codes` | auth → adminOnly | accelerator | Generate a result-access code for a year |
| 15858 | GET | `/api/accelerator/files/grouped` | auth | accelerator | Get application files grouped by applicant |
| 15896 | GET | `/api/accelerator/years/:year/ranking-pdf` | auth | accelerator | Generate a ranking PDF with dynamic evaluation columns |
| 16092 | GET | `/api/accelerator/applications/:id/merge-docs` | auth | accelerator | Generate an application-summary cover-page PDF |
| 16193 | GET | `/api/accelerator/documents/:docId/download` | auth → adminOnly | accelerator | Download an individual accelerator document (admin) |
| 16206 | GET | `/api/accelerator/applications/:id/documents` | auth → adminOnly | accelerator | List all documents for an application (admin) |
| 16219 | GET | `/api/accelerator/form-config` | auth → adminOnly | accelerator | Get the accelerator form field configuration |
| 16225 | PUT | `/api/accelerator/form-config` | auth → adminOnly | accelerator | Bulk-update the accelerator form configuration |
| 16244 | POST | `/api/accelerator/form-config/field` | auth → adminOnly | accelerator | Add a new field to the accelerator form configuration |
| 16256 | DELETE | `/api/accelerator/form-config/field/:id` | auth → adminOnly | accelerator | Delete a field from the accelerator form configuration |
| 18748 | GET | `/api/admin/accelerator/applications` | auth → adminOnly | accelerator | List accelerator applications for admin |
| 18765 | GET | `/api/admin/accelerator/applications/:id` | auth → adminOnly | accelerator | Get one accelerator application with documents |
| 18784 | PUT | `/api/admin/accelerator/applications/:id/review` | auth → adminOnly | accelerator | Record a review decision on an application |
| 18799 | GET | `/api/admin/accelerator/analytics` | auth → adminOnly | accelerator | Get accelerator application analytics |
| 18825 | GET | `/api/admin/accelerator/export` | auth → adminOnly | accelerator | Export accelerator applications as CSV |
| 24008 | POST | `/api/applicant/register` | **none (public)** | accelerator | Register a new accelerator applicant account |
| 24063 | GET | `/api/applicant/verify/:token` | **none (public)** | accelerator | Verify an applicant's email via token |
| 24076 | POST | `/api/applicant/login` | **none (public)** | accelerator | Log in an accelerator applicant |
| 24142 | GET | `/api/applicant/profile` | applicantAuth | accelerator | Get applicant profile |
| 24157 | PUT | `/api/applicant/profile` | applicantAuth | accelerator | Update applicant profile |
| 24174 | GET | `/api/applicant/applications` | applicantAuth | accelerator | Get applicant's applications |
| 24192 | POST | `/api/applicant/applications` | applicantAuth | accelerator | Start a new application |
| 24237 | PUT | `/api/applicant/applications/:id` | applicantAuth | accelerator | Update an application |
| 24274 | POST | `/api/applicant/applications/:id/submit` | applicantAuth | accelerator | Submit an application |
| 24312 | POST | `/api/applicant/applications/:id/documents` | applicantAuth → upload.single('file') | accelerator | Upload an application document |
| 24340 | DELETE | `/api/applicant/documents/:docId` | applicantAuth | accelerator | Delete an application document |
| 24363 | GET | `/api/applicant/programs` | **none (public)** | accelerator | List available accelerator programs and institutions, public |
| 29000 | POST | `/api/admin/research` | researchLimiter → auth → adminOnly | accelerator | Run an AI research query and save it to history |
| 29022 | GET | `/api/admin/research` | auth → adminOnly | accelerator | List past AI research requests |
| 29037 | POST | `/api/admin/research/:id/to-contacts` | auth → adminOnly | accelerator | Add selected AI research findings to contacts |

#### Area: forum (87 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 16265 | GET | `/api/forum/me` | auth | forum | Get the current user's Forum membership status |
| 16271 | POST | `/api/forum/apply` | auth | forum | Apply for Forum membership |
| 16288 | PUT | `/api/forum/profile` | auth | forum | Update the current user's Forum profile |
| 16316 | GET | `/api/forum/members` | auth | forum | Get the Forum member directory (paginated, filtered) |
| 16357 | GET | `/api/forum/members/:id` | auth | forum | Get a single Forum member's profile |
| 16377 | POST | `/api/forum/connections` | auth | forum | Send a Forum connection request |
| 16398 | GET | `/api/forum/connections` | auth | forum | List the current user's Forum connections |
| 16422 | PUT | `/api/forum/connections/:id` | auth | forum | Accept or reject a Forum connection request |
| 16439 | GET | `/api/forum/groups` | auth | forum | List active Forum groups with member counts |
| 16460 | POST | `/api/forum/groups/:id/membership` | auth | forum | Join or leave a Forum group |
| 16479 | GET | `/api/forum/posts` | auth | forum | Get the Forum posts feed |
| 16509 | POST | `/api/forum/posts` | auth | forum | Create a Forum post |
| 16539 | POST | `/api/forum/posts/:id/react` | auth | forum | Like or unlike a Forum post |
| 16558 | GET | `/api/forum/posts/:id/comments` | auth | forum | Get comments on a Forum post |
| 16571 | POST | `/api/forum/posts/:id/comments` | auth | forum | Add a comment to a Forum post |
| 16590 | GET | `/api/forum/events` | auth | forum | Get published Forum events |
| 16617 | POST | `/api/forum/events/:id/register` | auth | forum | Register for a Forum event |
| 16643 | GET | `/api/forum/media` | auth | forum | Get Forum media/gallery items |
| 16661 | POST | `/api/forum/media` | auth | forum | Upload media to the Forum gallery |
| 16677 | GET | `/api/forum/resources` | auth | forum | Get Forum resources (filtered) |
| 16695 | GET | `/api/forum/mentors` | auth | forum | List Forum mentors |
| 16707 | POST | `/api/forum/mentorship` | auth | forum | Request Forum mentorship from a mentor |
| 16726 | GET | `/api/admin/forum/stats` | auth → adminOnly | forum | Admin: get Forum stats summary |
| 16742 | GET | `/api/admin/forum/applications` | auth → adminOnly | forum | Admin: list pending Forum applications |
| 16761 | PUT | `/api/admin/forum/applications/:id` | auth → adminOnly | forum | Admin: approve or reject a Forum application |
| 16776 | DELETE | `/api/admin/forum/members/:id` | auth → adminOnly | forum | Admin: delete a Forum member |
| 16785 | GET | `/api/admin/forum/members` | auth → adminOnly | forum | Admin: list Forum members with resolved names/emails |
| 16799 | POST | `/api/admin/forum/groups` | auth → adminOnly | forum | Admin: create a Forum group |
| 16827 | DELETE | `/api/admin/forum/groups/:id` | auth → adminOnly | forum | Admin: delete a Forum group |
| 16838 | POST | `/api/admin/forum/groups/:id/invite` | auth → adminOnly | forum | Admin: invite a member to a Forum group by email |
| 16860 | GET | `/api/admin/forum/events` | auth → adminOnly | forum | Admin: list all Forum events (no published filter) |
| 16877 | POST | `/api/admin/forum/events` | auth → adminOnly | forum | Admin: create a Forum event |
| 16903 | PUT | `/api/admin/forum/events/:id` | auth → adminOnly | forum | Admin: update a Forum event |
| 16953 | DELETE | `/api/admin/forum/events/:id` | auth → adminOnly | forum | Admin: delete a Forum event |
| 16965 | PUT | `/api/admin/forum/events/:id/publish` | auth → adminOnly | forum | Admin: publish or unpublish a Forum event |
| 16992 | GET | `/api/admin/forum/events/:id/registrations` | auth → adminOnly | forum | Admin: get registrations for a Forum event |
| 17009 | DELETE | `/api/admin/forum/events/:eventId/registrations/:regId` | auth → adminOnly | forum | Admin: delete a Forum event registration |
| 17020 | POST | `/api/admin/forum/events/:id/checkin` | auth → adminOnly | forum | Admin: check in a Forum event registrant |
| 17043 | GET | `/api/admin/forum/media/folders` | auth → adminOnly | forum | Admin: list Forum media folders |
| 17052 | POST | `/api/admin/forum/media/folders` | auth → adminOnly | forum | Admin: create a Forum media folder |
| 17066 | PUT | `/api/admin/forum/media/folders/:id` | auth → adminOnly | forum | Admin: rename a Forum media folder |
| 17078 | DELETE | `/api/admin/forum/media/folders/:id` | auth → adminOnly | forum | Admin: delete a Forum media folder (move contents to root) |
| 17093 | PUT | `/api/admin/forum/media/:id/move` | auth → adminOnly | forum | Admin: move a media item to a folder |
| 17109 | GET | `/api/admin/forum/events/:eventId/schedule` | auth → adminOnly | forum | Admin: get a Forum event's schedule |
| 17118 | POST | `/api/admin/forum/events/:eventId/schedule` | auth → adminOnly | forum | Admin: add a schedule item to a Forum event |
| 17133 | PUT | `/api/admin/forum/events/:eventId/schedule/:itemId` | auth → adminOnly | forum | Admin: update a Forum event schedule item |
| 17145 | DELETE | `/api/admin/forum/events/:eventId/schedule/:itemId` | auth → adminOnly | forum | Admin: delete a Forum event schedule item |
| 17158 | POST | `/api/admin/forum/resources` | auth → adminOnly | forum | Admin: upload a Forum resource |
| 17172 | GET | `/api/admin/forum/posts` | auth → adminOnly | forum | Admin: list all Forum posts |
| 17183 | PUT | `/api/admin/forum/posts/:id` | auth → adminOnly | forum | Admin: moderate a Forum post (status, pin, feature) |
| 18995 | GET | `/api/admin/export/forum-registrations/:eventId` | auth → adminOnly | forum | Export forum event registrations as CSV or XLSX |
| 33485 | POST | `/api/admin/forum/checkin` | auth → staffOrAdmin | forum | Check in a forum attendee |
| 33766 | PUT | `/api/admin/forum/events/:id/toggle-checkin` | auth → adminOnly | forum | Toggle check-in for a forum event |
| 38455 | GET | `/api/admin/council/list` | auth → adminOnly | forum | List saved council invitations |
| 38464 | POST | `/api/admin/council/save` | auth → adminOnly | forum | Create or update a draft council invitation |
| 38497 | POST | `/api/admin/council/asset` | auth → adminOnly | forum | Attach a rendered invitation image to a council invitation |
| 38521 | POST | `/api/admin/council/send` | auth → adminOnly | forum | Stage a council invitation email into the approval outbox |
| 38581 | POST | `/api/admin/council/delete` | auth → adminOnly | forum | Delete a council invitation and its asset |
| 39410 | GET | `/api/admin/forum/considerations` | auth → adminOnly | forum | List Biomedical Forum membership considerations by status |
| 39425 | POST | `/api/admin/forum/considerations/:id/approve` | auth → adminOnly | forum | Approve a forum consideration and send an invitation |
| 39441 | POST | `/api/admin/forum/considerations/:id/decline` | auth → adminOnly | forum | Decline a forum consideration with a regret note |
| 39591 | POST | `/api/admin/forum/candidates/import` | auth → adminOnly → candidateImportUpload.single('file') | forum | Preview an uploaded CSV/XLSX of forum candidates |
| 39615 | POST | `/api/admin/forum/candidates/import/commit` | auth → adminOnly | forum | Commit mapped forum candidate import rows, deduping |
| 39664 | GET | `/api/admin/forum/candidates` | auth → adminOnly | forum | List forum candidates with per-status counts |
| 39680 | GET | `/api/admin/forum/candidates/:id` | auth → adminOnly | forum | Get one forum candidate |
| 39688 | PUT | `/api/admin/forum/candidates/:id` | auth → adminOnly | forum | Update a forum candidate's fields |
| 39706 | POST | `/api/admin/forum/candidates/:id/verify` | auth → adminOnly | forum | Mark a forum candidate verified |
| 39714 | POST | `/api/admin/forum/candidates/:id/reject` | auth → adminOnly | forum | Reject a forum candidate |
| 39724 | POST | `/api/admin/forum/candidates/:id/dossier` | auth → adminOnly | forum | Run AI verification dossier checks on one candidate |
| 39741 | POST | `/api/admin/forum/candidates/dossier/bulk` | auth → adminOnly | forum | Run verification dossier checks on a batch of candidates |
| 39769 | POST | `/api/admin/forum/candidates/:id/escalate` | auth → adminOnly | forum | Escalate a forum candidate for presidential review |
| 39803 | DELETE | `/api/admin/forum/candidates/:id` | auth → adminOnly | forum | Delete a forum candidate |
| 40121 | GET | `/api/admin/forum/campaign` | auth → adminOnly | forum | Get the forum outreach campaign settings and stats |
| 40125 | PUT | `/api/admin/forum/campaign` | auth → adminOnly | forum | Update the forum outreach campaign settings |
| 40141 | POST | `/api/admin/forum/campaign/approve` | auth → adminOnly | forum | Approve the forum campaign template and settings |
| 40149 | POST | `/api/admin/forum/campaign/pause` | auth → adminOnly | forum | Pause the forum outreach campaign (kill switch) |
| 40157 | POST | `/api/admin/forum/campaign/resume` | auth → adminOnly | forum | Resume a paused forum outreach campaign |
| 40167 | POST | `/api/admin/forum/campaign/tick` | auth → adminOnly | forum | Run one tick of the forum outreach campaign sender |
| 40174 | POST | `/api/admin/forum/campaign/followup-tick` | auth → adminOnly | forum | Run one tick of forum campaign follow-up sends |
| 40183 | POST | `/api/admin/forum/candidates/:id/reply` | auth → adminOnly | forum | Log a manual reply from a forum candidate |
| 40193 | GET | `/api/admin/forum/candidates/:id/replies` | auth → adminOnly | forum | List logged replies for a forum candidate |
| 40199 | POST | `/api/admin/forum/replies/ingest` | auth → adminOnly | forum | Ingest a forum candidate reply from the Graph connector |
| 40209 | POST | `/api/admin/forum/candidates/:id/accept` | auth → adminOnly | forum | Accept a forum candidate and send a magic-link invitation |
| 40223 | POST | `/api/admin/forum/candidates/:id/decline` | auth → adminOnly | forum | Decline a forum candidate, optionally sending a regret |
| 41736 | GET | `/api/admin/forum/convenings` | auth → adminOnly | forum | List Forum convenings with reserved counts by segment |
| 41761 | GET | `/api/admin/forum/gala-settings` | auth → adminOnly | forum | Get Forum gala pricing settings |
| 41768 | PUT | `/api/admin/forum/gala-settings` | auth → adminOnly | forum | Update Forum gala pricing settings |

#### Area: bridges (30 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 29581 | GET | `/api/bridges/events` | auth | bridges | List Bridges events with registration counts |
| 29593 | GET | `/api/bridges/events/:id` | auth | bridges | Get a Bridges event with its registrations |
| 29612 | POST | `/api/bridges/events` | auth → adminOnly | bridges | Create a Bridges event |
| 29628 | PUT | `/api/bridges/events/:id` | auth → adminOnly | bridges | Update a Bridges event |
| 29669 | PUT | `/api/bridges/events/:id/publish` | auth → adminOnly | bridges | Publish or unpublish a Bridges event |
| 29681 | DELETE | `/api/bridges/events/:id` | auth → adminOnly | bridges | Delete a Bridges event |
| 29688 | GET | `/api/bridges/events/:id/registrations` | auth | bridges | List registrations for a Bridges event |
| 29696 | POST | `/api/bridges/events/:id/registrations` | auth → adminOnly | bridges | Add a comp registration to a Bridges event |
| 29718 | PUT | `/api/bridges/registrations/:id` | auth | bridges | Update a Bridges registration |
| 29740 | DELETE | `/api/bridges/registrations/:id` | auth → adminOnly | bridges | Delete a Bridges registration |
| 29747 | POST | `/api/bridges/registrations/:id/checkin` | auth | bridges | Check in a Bridges registration |
| 29755 | POST | `/api/bridges/registrations/:id/undo-checkin` | auth | bridges | Undo check-in for a Bridges registration |
| 29762 | POST | `/api/bridges/events/:id/checkin` | auth | bridges | Check in a Bridges registration by QR code or id |
| 29781 | GET | `/api/bridges/speakers` | auth | bridges | List Bridges speakers |
| 29794 | POST | `/api/bridges/speakers` | auth → adminOnly | bridges | Create a Bridges speaker |
| 29807 | PUT | `/api/bridges/speakers/:id` | auth → adminOnly | bridges | Update a Bridges speaker |
| 29828 | DELETE | `/api/bridges/speakers/:id` | auth → adminOnly | bridges | Delete a Bridges speaker |
| 29835 | PUT | `/api/bridges/speakers/:id/publish` | auth → adminOnly | bridges | Publish or unpublish a Bridges speaker |
| 29847 | GET | `/api/bridges/program` | auth | bridges | List Bridges program items |
| 29862 | POST | `/api/bridges/program` | auth → adminOnly | bridges | Create a Bridges program item |
| 29875 | PUT | `/api/bridges/program/:id` | auth → adminOnly | bridges | Update a Bridges program item |
| 29895 | DELETE | `/api/bridges/program/:id` | auth → adminOnly | bridges | Delete a Bridges program item |
| 29902 | PUT | `/api/bridges/program/:id/publish` | auth → adminOnly | bridges | Publish or unpublish a Bridges program item |
| 30524 | POST | `/api/admin/croatians-abroad/invite-links` | auth → adminOnly | bridges | Create a Croatians Abroad invite link |
| 30541 | GET | `/api/admin/croatians-abroad/invite-links` | auth → adminOnly | bridges | List Croatians Abroad invite links |
| 30547 | DELETE | `/api/admin/croatians-abroad/invite-links/:id` | auth → adminOnly | bridges | Revoke a Croatians Abroad invite link |
| 30555 | GET | `/api/admin/croatians-abroad/registrations` | auth → adminOnly | bridges | List Croatians Abroad registrations |
| 30568 | GET | `/api/admin/croatians-abroad/emails-by-event/:event` | auth → adminOnly | bridges | List emails by event for Croatians Abroad registrants |
| 33518 | POST | `/api/admin/bridges/checkin` | auth → staffOrAdmin | bridges | Check in a Bridges participant |
| 33776 | PUT | `/api/admin/bridges/events/:id/toggle-checkin` | auth → adminOnly | bridges | Toggle check-in enabled for a bridges event |

#### Area: gameday (30 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 41875 | GET | `/api/staff-tracking/me` | auth → staffOrAdmin | gameday | Get my own staff location-tracking opt-in state and pairings |
| 41894 | POST | `/api/staff-tracking/consent` | auth → staffOrAdmin | gameday | Opt in or out of staff location tracking |
| 41913 | POST | `/api/staff-tracking/ping` | auth → staffOrAdmin | gameday | Record one live staff location ping |
| 41929 | POST | `/api/staff-tracking/pairing-confirm` | auth → staffOrAdmin | gameday | Confirm my own staff pairing check-in status |
| 41941 | GET | `/api/admin/staff-tracking/live` | auth → adminOnly | gameday | Get live staff positions for the admin map |
| 41994 | GET | `/api/admin/staff-tracking/pairings` | auth → adminOnly | gameday | List staff-speaker pairings |
| 41998 | POST | `/api/admin/staff-tracking/pairings` | auth → adminOnly | gameday | Create a staff-speaker pairing assignment |
| 42009 | PATCH | `/api/admin/staff-tracking/pairings/:id` | auth → adminOnly | gameday | Update a staff-speaker pairing assignment |
| 42022 | DELETE | `/api/admin/staff-tracking/pairings/:id` | auth → adminOnly | gameday | Delete a staff-speaker pairing |
| 42028 | GET | `/api/admin/staff-tracking/settings` | auth → adminOnly | gameday | Get staff tracking settings |
| 42029 | POST | `/api/admin/staff-tracking/settings` | auth → adminOnly | gameday | Update staff tracking settings |
| 42048 | POST | `/api/admin/staff-tracking/purge` | auth → adminOnly | gameday | Purge all staff tracking position data |
| 42054 | GET | `/api/admin/staff-tracking/roster` | auth → adminOnly | gameday | Get trackable staff and speaker roster for pairing form |
| 42061 | POST | `/api/admin/staff-tracking/run-scan` | auth → adminOnly | gameday | Force a staff stale check-in scan now |
| 42909 | GET | `/api/admin/gameday/status` | auth → staffOrAdmin | gameday | Get game-day active status and role for login routing |
| 42918 | GET | `/api/admin/gameday/settings` | auth → adminOnly | gameday | Get game-day mode settings and event list |
| 42929 | PUT | `/api/admin/gameday/settings` | auth → adminOnly | gameday | Update game-day mode settings |
| 42945 | GET | `/api/admin/gameday/dashboard` | auth → staffOrAdmin | gameday | Get the admin game-day dashboard payload |
| 42951 | GET | `/api/admin/gameday/messages` | auth → staffOrAdmin | gameday | List game-day channel messages |
| 42957 | POST | `/api/admin/gameday/messages` | auth → staffOrAdmin | gameday | Post a game-day channel message (admin) |
| 42966 | GET | `/api/admin/gameday/invites` | auth → adminOnly | gameday | List game-day volunteer invites |
| 42971 | POST | `/api/admin/gameday/invites` | auth → adminOnly | gameday | Create a game-day volunteer invite |
| 42987 | PUT | `/api/admin/gameday/invites/:id` | auth → adminOnly | gameday | Update a game-day volunteer invite |
| 43006 | POST | `/api/admin/gameday/invites/:id/revoke` | auth → adminOnly | gameday | Revoke a game-day volunteer invite |
| 43053 | POST | `/api/gameday/volunteer/login` | gamedayLoginLimiter | gameday | Log in a game-day volunteer via invite token |
| 43071 | GET | `/api/gameday/volunteer/status` | gamedayVolunteerAuth → gamedayVolunteerLimiter | gameday | Get game-day status for the logged-in volunteer |
| 43080 | GET | `/api/gameday/volunteer/dashboard` | gamedayVolunteerAuth → gamedayVolunteerLimiter | gameday | Get the volunteer game-day dashboard payload |
| 43089 | GET | `/api/gameday/volunteer/messages` | gamedayVolunteerAuth → gamedayVolunteerLimiter | gameday | List game-day channel messages for a volunteer |
| 43097 | POST | `/api/gameday/volunteer/messages` | gamedayVolunteerAuth → gamedayVolunteerLimiter | gameday | Post a game-day channel message (volunteer) |
| 43112 | POST | `/api/gameday/volunteer/checkin` | gamedayVolunteerAuth → gamedayVolunteerLimiter | gameday | Scan and check in an attendee via volunteer door scan |

#### Area: conferences (6 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 11027 | POST | `/api/admin/conferences` | auth → adminOnly | conferences | Create a new conference year |
| 11054 | POST | `/api/admin/conferences/:id/clone-tickets` | auth → adminOnly | conferences | Clone ticket types from one conference into another |
| 11077 | PUT | `/api/admin/conferences/:confId/tickets/:ticketId` | auth → adminOnly | conferences | Edit one ticket tier's name and prices |
| 11096 | POST | `/api/admin/conferences/:confId/tickets` | auth → adminOnly | conferences | Add a new ticket tier to a conference |
| 11120 | PUT | `/api/admin/conferences/:id` | auth → adminOnly | conferences | Edit a conference's details |
| 11139 | POST | `/api/admin/conferences/:id/activate` | auth → adminOnly | conferences | Set a conference as the active one (requires tickets) |

#### Area: editions (6 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 32267 | GET | `/api/admin/editions` | auth → adminOnly | editions | List event editions grouped by project |
| 32291 | GET | `/api/admin/editions/:id` | auth → adminOnly | editions | Get an event edition's detail with snapshot |
| 32303 | POST | `/api/admin/editions/:id/archive-preview` | auth → adminOnly | editions | Preview archiving an edition, dry run |
| 32314 | POST | `/api/admin/editions/:id/archive` | auth → adminOnly | editions | Archive an event edition |
| 32327 | POST | `/api/admin/editions/:id/carryover-preview` | auth → adminOnly | editions | Preview carrying over an edition to next year, dry run |
| 32338 | POST | `/api/admin/editions/:id/carryover` | auth → adminOnly | editions | Create next year's edition by carrying over |

#### Area: signup-forms (9 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 30710 | GET | `/api/admin/signup-forms` | auth → adminOnly | signup-forms | List signup forms |
| 30715 | POST | `/api/admin/signup-forms` | auth → adminOnly | signup-forms | Create a signup form |
| 30730 | GET | `/api/admin/signup-forms/:id` | auth → adminOnly | signup-forms | Get a signup form |
| 30738 | PUT | `/api/admin/signup-forms/:id` | auth → adminOnly | signup-forms | Update a signup form |
| 30816 | DELETE | `/api/admin/signup-forms/:id` | auth → adminOnly | signup-forms | Delete a signup form and its responses |
| 30826 | GET | `/api/admin/signup-forms/:id/responses` | auth → adminOnly | signup-forms | List responses for a signup form |
| 30845 | DELETE | `/api/admin/signup-forms/:id/responses/:responseId` | auth → adminOnly | signup-forms | Delete a signup form response |
| 30856 | POST | `/api/admin/signup-forms/:id/responses/:responseId/promote` | auth → adminOnly | signup-forms | Promote a waitlisted signup and send their ticket |
| 30902 | GET | `/api/admin/signup-forms/:id/export` | auth → adminOnly | signup-forms | Export signup form responses as CSV/XLSX |

#### Area: guest-passes (11 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 22370 | GET | `/api/admin/guest-pass-events` | auth → adminOnly | guest-passes | List events a guest pass can target |
| 22378 | GET | `/api/admin/guest-passes` | auth → adminOnly | guest-passes | List guest passes |
| 22383 | GET | `/api/admin/guest-passes/:id` | auth → adminOnly | guest-passes | Get a guest pass |
| 22389 | POST | `/api/admin/guest-passes` | auth → adminOnly | guest-passes | Create a guest pass |
| 22413 | PUT | `/api/admin/guest-passes/:id` | auth → adminOnly | guest-passes | Update a guest pass |
| 22439 | POST | `/api/admin/guest-passes/:id/revoke` | auth → adminOnly | guest-passes | Revoke a guest pass |
| 22448 | POST | `/api/admin/guest-passes/:id/unrevoke` | auth → adminOnly | guest-passes | Restore a revoked guest pass |
| 22459 | DELETE | `/api/admin/guest-passes/:id` | auth → adminOnly | guest-passes | Permanently delete a guest pass |
| 22469 | POST | `/api/admin/guest-passes/:id/send` | auth → adminOnly | guest-passes | Stage a guest pass email for approval |
| 33212 | GET | `/api/admin/member-guest-passes` | auth → adminOnly | guest-passes | List member guest passes |
| 33250 | POST | `/api/admin/member-guest-passes/:id/revoke` | auth → adminOnly | guest-passes | Revoke a member guest pass |

#### Area: year-calendar (5 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 12111 | GET | `/api/admin/year-calendar` | auth → adminOnly | year-calendar | Admin: list year-calendar entries |
| 12115 | GET | `/api/admin/year-calendar/events` | auth → adminOnly | year-calendar | Admin: list active conferences as calendar event chips |
| 12122 | POST | `/api/admin/year-calendar` | auth → adminOnly | year-calendar | Admin: create a year-calendar entry |
| 12134 | PUT | `/api/admin/year-calendar/:id` | auth → adminOnly | year-calendar | Admin: update a year-calendar entry |
| 12147 | DELETE | `/api/admin/year-calendar/:id` | auth → adminOnly | year-calendar | Admin: delete a year-calendar entry |

#### Area: cme (4 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 34441 | GET | `/api/admin/cme/events` | auth → adminOnly | cme | List conferences with CME accreditation status |
| 34462 | PUT | `/api/admin/cme/events/:conferenceId` | auth → adminOnly | cme | Update CME accreditation settings for a conference |
| 34489 | GET | `/api/admin/cme/events/:conferenceId/attendees` | auth → adminOnly | cme | List consented CME submission attendees for a conference |
| 34508 | GET | `/api/admin/cme/events/:conferenceId/export.csv` | auth → adminOnly | cme | Export CME submissions as CSV for chamber reporting |

#### Area: pr-media (110 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 11927 | GET | `/api/admin/content-blocks` | auth → adminOnly | pr-media | Admin: list all content blocks grouped by page |
| 11934 | GET | `/api/admin/content-blocks/:key` | auth → adminOnly | pr-media | Admin: get one content block by key |
| 11940 | PUT | `/api/admin/content-blocks/:key` | auth → adminOnly | pr-media | Admin: update a content block's body |
| 12010 | GET | `/api/admin/audiences/:project` | auth → adminOnly | pr-media | Admin: get audience counts (interested/registered) for a project |
| 12393 | GET | `/api/admin/feed-items` | auth → adminOnly | pr-media | Admin: list feed items |
| 12397 | POST | `/api/admin/feed-items` | auth → adminOnly | pr-media | Admin: create a feed item |
| 12411 | PUT | `/api/admin/feed-items/:id` | auth → adminOnly | pr-media | Admin: update a feed item |
| 12431 | DELETE | `/api/admin/feed-items/:id` | auth → adminOnly | pr-media | Admin: delete a feed item |
| 18348 | GET | `/api/sequences` | auth → adminOnly | pr-media | List task sequences, optionally by project |
| 18366 | GET | `/api/sequences/:id` | auth → adminOnly | pr-media | Get a task sequence with its steps |
| 18375 | POST | `/api/sequences` | auth → adminOnly | pr-media | Create a new task sequence |
| 18451 | POST | `/api/sequences/:seqId/steps/:stepId/complete` | auth → adminOnly | pr-media | Complete a sequence step and advance |
| 18537 | DELETE | `/api/sequences/:id` | auth → adminOnly | pr-media | Delete a task sequence and its steps |
| 20779 | GET | `/api/admin/pr/meta/status` | auth → adminOnly | pr-media | Get Meta publishing configuration status |
| 20795 | PUT | `/api/admin/pr/meta/settings` | auth → adminOnly | pr-media | Update Meta publishing settings and token |
| 20815 | POST | `/api/admin/pr/meta/publish/:calendarId` | auth → adminOnly | pr-media | Publish or dry-run a calendar post to Meta |
| 23064 | GET | `/api/admin/newsletter-segments` | auth → adminOnly | pr-media | Get newsletter audience segments with live counts |
| 23288 | POST | `/api/admin/digest/run` | auth → adminOnly | pr-media | Generate or refresh the monthly digest draft |
| 23302 | POST | `/api/admin/digest/:id/restyle` | auth → adminOnly | pr-media | Restyle a digest draft with new settings |
| 23576 | GET | `/api/admin/newsletter-interests` | auth → adminOnly | pr-media | Get the newsletter interest catalog with counts |
| 23593 | POST | `/api/admin/newsletter-interests` | auth → adminOnly | pr-media | Set a person's newsletter interests |
| 23611 | POST | `/api/admin/pr-newsletters/audience-preview` | auth → adminOnly | pr-media | Preview deduplicated audience size for segments |
| 23623 | POST | `/api/admin/pr-newsletters/compose` | auth → adminOnly | pr-media | Compose a branded newsletter draft |
| 23650 | POST | `/api/admin/pr-newsletters/:id/stage` | auth → adminOnly | pr-media | Stage a newsletter to its audience for approval |
| 23807 | GET | `/api/admin/newsletters` | auth → adminOnly | pr-media | List all member newsletters |
| 23817 | POST | `/api/admin/newsletters` | auth → adminOnly | pr-media | Create a draft newsletter |
| 23834 | POST | `/api/admin/newsletters/auto-generate` | auth → adminOnly | pr-media | Auto-generate a newsletter draft from recent data |
| 23927 | PUT | `/api/admin/newsletters/:id` | auth → adminOnly | pr-media | Update a draft newsletter |
| 23945 | POST | `/api/admin/newsletters/:id/send` | auth → adminOnly | pr-media | Send a newsletter to its segment |
| 23995 | DELETE | `/api/admin/newsletters/:id` | auth → adminOnly | pr-media | Delete a newsletter |
| 27212 | GET | `/api/pr/dashboard` | auth | pr-media | Get PR dashboard summary |
| 27285 | GET | `/api/pr/calendar` | auth | pr-media | List PR content calendar items |
| 27311 | GET | `/api/pr/calendar/:id` | auth | pr-media | Get a PR content calendar item |
| 27317 | POST | `/api/pr/calendar` | auth | pr-media | Create a PR content calendar item |
| 27330 | PUT | `/api/pr/calendar/:id` | auth | pr-media | Update a PR content calendar item |
| 27342 | POST | `/api/pr/calendar/:id/approve` | auth | pr-media | Approve a PR content calendar item |
| 27349 | POST | `/api/pr/calendar/:id/publish` | auth | pr-media | Publish a PR calendar item as a post |
| 27368 | POST | `/api/pr/calendar/:id/approve-schedule` | auth | pr-media | Approve and schedule a post to Publer |
| 27411 | GET | `/api/pr/publer/status` | auth | pr-media | Get Publer connection status |
| 27432 | DELETE | `/api/pr/calendar/:id` | auth | pr-media | Delete a PR content calendar item |
| 27451 | GET | `/api/pr/posts` | auth | pr-media | List social media posts |
| 27474 | GET | `/api/pr/posts/:id` | auth | pr-media | Get a social media post |
| 27480 | POST | `/api/pr/posts` | auth | pr-media | Create a social media post record |
| 27491 | PUT | `/api/pr/posts/:id` | auth | pr-media | Update a social media post's metrics |
| 27506 | DELETE | `/api/pr/posts/:id` | auth | pr-media | Delete a social media post |
| 27513 | GET | `/api/pr/newsletters` | auth | pr-media | List newsletters |
| 27531 | GET | `/api/pr/newsletters/:id` | auth | pr-media | Get a newsletter |
| 27537 | POST | `/api/pr/newsletters` | auth | pr-media | Create a newsletter |
| 27549 | PUT | `/api/pr/newsletters/:id` | auth | pr-media | Update a newsletter |
| 27565 | POST | `/api/pr/newsletters/:id/send` | auth | pr-media | Send a newsletter to active subscribers |
| 27574 | DELETE | `/api/pr/newsletters/:id` | auth | pr-media | Delete a newsletter |
| 27581 | GET | `/api/pr/subscribers` | auth | pr-media | List newsletter subscribers |
| 27606 | POST | `/api/pr/subscribers` | auth | pr-media | Add a newsletter subscriber |
| 27622 | PUT | `/api/pr/subscribers/:id` | auth | pr-media | Update a subscriber |
| 27633 | POST | `/api/pr/subscribers/:id/unsubscribe` | auth | pr-media | Unsubscribe a subscriber |
| 27639 | DELETE | `/api/pr/subscribers/:id` | auth | pr-media | Delete a subscriber |
| 27647 | GET | `/api/pr/subscribers/export` | auth → adminOnly | pr-media | Export subscribers as CSV |
| 27659 | POST | `/api/pr/subscribers/import` | auth | pr-media | Bulk import subscribers |
| 27711 | GET | `/api/pr/media` | auth | pr-media | List PR media assets |
| 27733 | GET | `/api/pr/media/:id` | auth | pr-media | Get a PR media asset |
| 27739 | POST | `/api/pr/media` | auth → prMediaUpload.single('file') | pr-media | Upload a PR media asset |
| 27752 | PUT | `/api/pr/media/:id` | auth | pr-media | Update PR media asset metadata |
| 27760 | DELETE | `/api/pr/media/:id` | auth | pr-media | Delete a PR media asset |
| 27772 | GET | `/api/pr/media/:id/download` | auth | pr-media | Download a PR media asset file |
| 27783 | GET | `/api/pr/campaigns` | auth | pr-media | List PR campaigns |
| 27801 | GET | `/api/pr/campaigns/:id` | auth | pr-media | Get a PR campaign with related content and posts |
| 27813 | POST | `/api/pr/campaigns` | auth | pr-media | Create a PR campaign |
| 27827 | PUT | `/api/pr/campaigns/:id` | auth | pr-media | Update a PR campaign |
| 27842 | DELETE | `/api/pr/campaigns/:id` | auth | pr-media | Delete a PR campaign |
| 27849 | GET | `/api/pr/analytics` | auth | pr-media | List PR analytics entries |
| 27875 | POST | `/api/pr/analytics` | auth | pr-media | Add or update a PR analytics entry |
| 27896 | GET | `/api/pr/templates` | auth | pr-media | List PR content templates |
| 27918 | POST | `/api/pr/templates` | auth | pr-media | Create a PR content template |
| 27928 | PUT | `/api/pr/templates/:id` | auth | pr-media | Update a PR content template |
| 27937 | POST | `/api/pr/templates/:id/use` | auth | pr-media | Increment a template's use count |
| 27943 | DELETE | `/api/pr/templates/:id` | auth | pr-media | Delete a PR content template |
| 27950 | GET | `/api/pr/ai-generations` | auth | pr-media | List AI generation history entries |
| 27968 | POST | `/api/pr/ai-generations` | auth | pr-media | Record an AI generation result |
| 27986 | POST | `/api/pr/ai-generations/:id/use` | auth | pr-media | Mark an AI generation as used |
| 27992 | POST | `/api/pr/ai-generations/:id/rate` | auth | pr-media | Rate an AI generation |
| 28195 | GET | `/api/pr/press-seeds` | auth → adminOnly | pr-media | List recent content as press release draft seeds |
| 28213 | POST | `/api/pr/press-releases/draft` | auth → adminOnly | pr-media | AI-draft a press release in EN then HR, not persisted |
| 28243 | GET | `/api/pr/press-releases` | auth → adminOnly | pr-media | List press releases grouped by language pair |
| 28256 | GET | `/api/pr/press-releases/:id` | auth → adminOnly | pr-media | Get a press release with its paired versions |
| 28264 | POST | `/api/pr/press-releases` | auth → adminOnly | pr-media | Create a press release pair, EN and/or HR |
| 28298 | PUT | `/api/pr/press-releases/:id` | auth → adminOnly | pr-media | Edit a press release version |
| 28326 | POST | `/api/pr/press-releases/:id/publish` | auth → adminOnly | pr-media | Publish a press release and its paired language |
| 28338 | POST | `/api/pr/press-releases/:id/unpublish` | auth → adminOnly | pr-media | Unpublish a press release |
| 28348 | DELETE | `/api/pr/press-releases/:id` | auth → adminOnly | pr-media | Delete a press release |
| 28358 | GET | `/api/pr/press-releases/:id/preview` | auth → adminOnly | pr-media | Preview a press release as HTML |
| 28364 | GET | `/api/pr/press-releases/:id/export.doc` | auth → adminOnly | pr-media | Export a press release as a Word doc |
| 28372 | GET | `/api/pr/press-releases/:id/export.pdf` | auth → adminOnly | pr-media | Export a press release as PDF |
| 28420 | GET | `/api/pr/media-contacts` | auth → adminOnly | pr-media | List press media contacts |
| 28425 | POST | `/api/pr/media-contacts` | auth → adminOnly | pr-media | Add a press media contact |
| 28439 | PUT | `/api/pr/media-contacts/:id` | auth → adminOnly | pr-media | Update a press media contact |
| 28460 | DELETE | `/api/pr/media-contacts/:id` | auth → adminOnly | pr-media | Delete a press media contact |
| 28467 | POST | `/api/pr/media-contacts/pause` | auth → adminOnly | pr-media | Pause or resume press sends, kill switch |
| 28476 | POST | `/api/pr/media-contacts/import/preview` | auth → adminOnly → pressImportUpload.single('file') | pr-media | Preview a CSV/XLSX media contacts import |
| 28487 | POST | `/api/pr/media-contacts/import/commit` | auth → adminOnly | pr-media | Commit a media contacts import |
| 28524 | POST | `/api/pr/press-releases/:id/send` | auth → adminOnly | pr-media | Send a press release to the media contact list |
| 37077 | POST | `/api/admin/content/converse` | assistantLimiter → auth → adminOnly | pr-media | Converse with the content assistant to build a content brief |
| 37116 | POST | `/api/admin/content/asset` | auth → adminOnly | pr-media | Upload a finished content studio asset file |
| 37140 | GET | `/api/admin/content/assets` | auth → adminOnly | pr-media | List recent content studio assets |
| 37208 | GET | `/api/admin/content/pending-brief` | auth → adminOnly | pr-media | Read and clear a pending content-studio brief handoff |
| 37223 | POST | `/api/admin/content/schedule` | auth → adminOnly | pr-media | Schedule a finished content piece into the PR review flow |
| 37357 | GET | `/api/admin/content/video/prefill` | auth → adminOnly | pr-media | Prefill video studio bundle and events data |
| 37367 | POST | `/api/admin/content/video/compose` | assistantLimiter → auth → adminOnly | pr-media | Compose a video config from a description via AI |
| 39287 | GET | `/api/admin/content-checklist` | auth → adminOnly | pr-media | List content checklist items with status counts |
| 39300 | POST | `/api/admin/content-checklist` | auth → adminOnly | pr-media | Add a new content checklist item |
| 39322 | POST | `/api/admin/content-checklist/:id` | auth → adminOnly | pr-media | Update a content checklist item's status or fields |

#### Area: member-ops (29 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 11247 | GET | `/api/admin/users/:id/profile` | auth → adminOnly | member-ops | Admin: get a user's full profile for QR lookup |
| 11977 | GET | `/api/admin/member-announcements` | auth → adminOnly | member-ops | Admin: list member announcements with follower counts |
| 11985 | POST | `/api/admin/member-announcements` | auth → adminOnly | member-ops | Admin: create a member announcement |
| 12036 | DELETE | `/api/admin/member-announcements/:id` | auth → adminOnly | member-ops | Admin: delete a member announcement |
| 12444 | GET | `/api/admin/member-meta/:userId` | auth → adminOnly | member-ops | Admin: get member metadata (type/standing) for a user |
| 12449 | PUT | `/api/admin/member-meta/:userId` | auth → adminOnly | member-ops | Admin: update member metadata for a user |
| 18986 | POST | `/api/admin/announcements` | auth → adminOnly | member-ops | Create a conference announcement |
| 22934 | GET | `/api/admin/notifications/user-notifications` | auth → adminOnly | member-ops | List all user notifications (admin view) |
| 22948 | POST | `/api/admin/notifications/send` | auth → adminOnly | member-ops | Send a notification to users from admin |
| 22982 | DELETE | `/api/admin/notifications/user-notifications/:id` | auth → adminOnly | member-ops | Delete a user notification |
| 30689 | GET | `/api/admin/member-card-toggles` | auth → adminOnly | member-ops | Get member card display toggles |
| 30695 | PUT | `/api/admin/member-card-toggles` | auth → adminOnly | member-ops | Update member card display toggles |
| 34252 | POST | `/api/admin/messages/triage` | auth → adminOnly | member-ops | Run an AI triage sweep on inbox messages |
| 34263 | POST | `/api/admin/messages/:userId/draft-reply` | auth → adminOnly | member-ops | Generate a grounded AI reply draft for a member conversation |
| 34302 | GET | `/api/admin/messages` | auth → adminOnly | member-ops | List inbox message threads with AI triage |
| 34328 | POST | `/api/admin/messages` | auth → adminOnly | member-ops | Send a message to a user |
| 34355 | POST | `/api/admin/messages/bulk` | auth → adminOnly | member-ops | Bulk send a message to a group |
| 34407 | GET | `/api/admin/messages/:userId` | auth → adminOnly | member-ops | Get message conversation thread with a user |
| 34941 | GET | `/api/admin/bulk-email/count` | auth → adminOnly | member-ops | Preview recipient count for a bulk email audience |
| 34949 | POST | `/api/admin/bulk-email/preview` | auth → adminOnly | member-ops | Preview full recipient list for a bulk email |
| 34956 | POST | `/api/admin/bulk-email/test` | auth → adminOnly | member-ops | Send a test bulk email to the logged-in admin only |
| 34976 | POST | `/api/admin/bulk-email/send` | auth → adminOnly | member-ops | Send a bulk email to an audience in the background |
| 35044 | GET | `/api/admin/rewards/overview` | auth → adminOnly | member-ops | Get rewards points totals overview |
| 35096 | PUT | `/api/admin/rewards/settings` | auth → adminOnly | member-ops | Update rewards program settings |
| 35136 | POST | `/api/admin/rewards/adjust` | auth → adminOnly | member-ops | Manually adjust a member's rewards points |
| 35161 | GET | `/api/admin/rewards/member/:userId` | auth → adminOnly | member-ops | Get a member's rewards balance, ledger, and coupons |
| 38602 | GET | `/api/admin/outbox` | auth → adminOnly | member-ops | List email batches in the approval outbox by status |
| 38646 | POST | `/api/admin/outbox/:batch/approve` | auth → adminOnly | member-ops | Approve a batch of outbox emails to send |
| 38716 | POST | `/api/admin/outbox/:batch/cancel` | auth → adminOnly | member-ops | Cancel a pending batch of outbox emails |

#### Area: finances (66 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 22636 | GET | `/api/admin/transparency/facts` | auth → adminOnly | finances | Get transparency and financial facts for a year |
| 22639 | GET | `/api/admin/transparency/board-pack` | auth → adminOnly | finances | Preview the board transparency pack as HTML |
| 22646 | GET | `/api/admin/transparency/board-pack.doc` | auth → adminOnly | finances | Export the board transparency pack as Word |
| 22655 | GET | `/api/admin/transparency/board-pack.pdf` | auth → adminOnly | finances | Export the board transparency pack as PDF |
| 25546 | GET | `/api/finance/dashboard` | auth → adminOnly | finances | Get finance dashboard summary |
| 25598 | GET | `/api/finance/bank-balance` | auth → adminOnly | finances | List bank balance entries |
| 25603 | POST | `/api/finance/bank-balance` | auth → adminOnly | finances | Add a bank balance entry |
| 25614 | DELETE | `/api/finance/bank-balance/:id` | auth → adminOnly | finances | Delete a bank balance entry |
| 25621 | GET | `/api/finance/years` | auth → adminOnly | finances | List fiscal years |
| 25626 | POST | `/api/finance/years` | auth → adminOnly | finances | Create a fiscal year |
| 25634 | PUT | `/api/finance/years/:year` | auth → adminOnly | finances | Update a fiscal year's status |
| 25670 | GET | `/api/finance/work-units` | auth → adminOnly | finances | List work units |
| 25700 | POST | `/api/finance/work-units` | auth → adminOnly | finances | Create a work unit |
| 25715 | GET | `/api/finance/work-units/:id` | auth → adminOnly | finances | Get a work unit's detail with usage |
| 25725 | PUT | `/api/finance/work-units/:id` | auth → adminOnly | finances | Update a work unit |
| 25743 | DELETE | `/api/finance/work-units/:id` | auth → adminOnly | finances | Delete a work unit |
| 25755 | GET | `/api/finance/work-units/:id/transactions` | auth → adminOnly | finances | Get a work unit's transaction drilldown |
| 25766 | GET | `/api/finance/transactions` | auth → adminOnly | finances | List finance transactions |
| 25809 | POST | `/api/finance/transactions` | auth → adminOnly | finances | Create a finance transaction |
| 25837 | GET | `/api/finance/transactions/:id` | auth → adminOnly | finances | Get a finance transaction |
| 25846 | PUT | `/api/finance/transactions/:id` | auth → adminOnly | finances | Update a finance transaction |
| 25885 | DELETE | `/api/finance/transactions/:id` | auth → adminOnly | finances | Delete a finance transaction |
| 25907 | GET | `/api/finance/invoices` | auth → adminOnly | finances | List invoices |
| 25931 | POST | `/api/finance/invoices` | auth → adminOnly | finances | Create an invoice |
| 25984 | GET | `/api/finance/invoices/:id` | auth → adminOnly | finances | Get an invoice |
| 25995 | PUT | `/api/finance/invoices/:id` | auth → adminOnly | finances | Update an invoice |
| 26055 | DELETE | `/api/finance/invoices/:id` | auth → adminOnly | finances | Delete an invoice |
| 26076 | POST | `/api/finance/invoices/:id/issue` | auth → adminOnly | finances | Issue an invoice and assign its number |
| 26093 | POST | `/api/finance/invoices/:id/mark-paid` | auth → adminOnly | finances | Mark an invoice as paid |
| 26132 | GET | `/api/finance/invoices/:id/pdf` | auth → adminOnly | finances | Generate an invoice PDF |
| 26249 | GET | `/api/finance/payment-orders` | auth → adminOnly | finances | List payment orders |
| 26269 | POST | `/api/finance/payment-orders` | auth → adminOnly | finances | Create a payment order |
| 26285 | GET | `/api/finance/payment-orders/:id` | auth → adminOnly | finances | Get a payment order |
| 26294 | PUT | `/api/finance/payment-orders/:id` | auth → adminOnly | finances | Update a payment order |
| 26307 | DELETE | `/api/finance/payment-orders/:id` | auth → adminOnly | finances | Delete a payment order |
| 26318 | GET | `/api/finance/travel-orders` | auth → adminOnly | finances | List travel orders |
| 26343 | GET | `/api/finance/my-travel-orders` | auth | finances | List the current user's own travel orders |
| 26356 | POST | `/api/finance/travel-orders` | auth → adminOnly | finances | Create a travel order |
| 26377 | GET | `/api/finance/travel-orders/:id` | auth → adminOnly | finances | Get a travel order |
| 26388 | PUT | `/api/finance/travel-orders/:id` | auth → adminOnly | finances | Update a travel order's trip and cost details |
| 26407 | POST | `/api/finance/travel-orders/:id/submit` | auth → adminOnly | finances | Submit travel order actuals for approval |
| 26423 | POST | `/api/finance/travel-orders/:id/approve` | auth → adminOnly | finances | Approve a travel order and compute reimbursement |
| 26434 | POST | `/api/finance/travel-orders/:id/reject` | auth → adminOnly | finances | Reject a travel order |
| 26443 | POST | `/api/finance/travel-orders/:id/calculate` | auth → adminOnly | finances | Calculate reimbursement for an approved travel order |
| 26455 | POST | `/api/finance/travel-orders/:id/pay` | auth → adminOnly | finances | Mark a travel order as paid |
| 26498 | POST | `/api/finance/travel-orders/:id/evidence` | auth → adminOnly → travelEvidenceUpload.single('file') | finances | Upload a travel order evidence file |
| 26511 | DELETE | `/api/finance/travel-orders/:orderId/evidence/:evidenceId` | auth → adminOnly | finances | Delete a travel order evidence file |
| 26524 | GET | `/api/finance/travel-orders/:orderId/evidence/:evidenceId/download` | auth → adminOnly | finances | Download a travel order evidence file |
| 26536 | GET | `/api/finance/travel-orders/:id/pdf` | auth → adminOnly | finances | Generate a travel order PDF |
| 26670 | GET | `/api/finance/settings` | auth → adminOnly | finances | Get finance settings |
| 26682 | PUT | `/api/finance/settings` | auth → adminOnly | finances | Update finance settings |
| 26688 | POST | `/api/finance/settings` | auth → adminOnly | finances | Upsert finance settings |
| 26695 | GET | `/api/finance/reports/by-project` | auth → adminOnly | finances | Finance report grouped by project |
| 26710 | GET | `/api/finance/reports/by-work-unit` | auth → adminOnly | finances | Finance report grouped by work unit |
| 26727 | GET | `/api/finance/reports/monthly` | auth → adminOnly | finances | Finance report by month |
| 26875 | GET | `/api/finance/stripe-payments/recent` | auth → adminOnly | finances | List recent Stripe payments |
| 26904 | GET | `/api/finance/conference-payments` | auth → adminOnly | finances | List conference payment registrations across all sources |
| 27078 | POST | `/api/finance/conference-payments/:id/confirm` | auth → adminOnly | finances | Confirm a conference payment registration |
| 35658 | GET | `/api/finance/reconcile/candidates` | auth → adminOnly | finances | List candidate registrants for payment reconciliation matching |
| 35665 | POST | `/api/finance/reconcile/import` | auth → adminOnly | finances | Import bank statement rows for payment reconciliation |
| 35721 | GET | `/api/finance/reconcile/batches` | auth → adminOnly | finances | List recent reconciliation import batches with status counts |
| 35734 | GET | `/api/finance/reconcile/batch/:batchId` | auth → adminOnly | finances | Get reconciliation lines for a batch with suggestions |
| 35745 | POST | `/api/finance/reconcile/line/:lineId/confirm` | auth → adminOnly | finances | Confirm a reconciliation line and mark the registrant paid |
| 35776 | POST | `/api/finance/reconcile/line/:lineId/match` | auth → adminOnly | finances | Set a chosen reconciliation match without confirming |
| 35791 | POST | `/api/finance/reconcile/line/:lineId/ignore` | auth → adminOnly | finances | Ignore or un-ignore a reconciliation statement line |
| 35805 | POST | `/api/finance/reconcile/batch/:batchId/confirm-high` | auth → adminOnly | finances | Bulk-confirm high-confidence reconciliation matches in a batch |

#### Area: contacts (16 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 28575 | GET | `/api/contacts` | auth | contacts | List contacts |
| 28602 | GET | `/api/contacts/:id` | auth | contacts | Get a single contact |
| 28609 | POST | `/api/contacts` | auth | contacts | Create a contact |
| 28622 | PUT | `/api/contacts/:id` | auth | contacts | Update a contact |
| 28652 | DELETE | `/api/contacts/:id` | auth | contacts | Delete a contact |
| 28659 | POST | `/api/contacts/:id/favorite` | auth | contacts | Toggle a contact's favorite flag |
| 28669 | POST | `/api/contacts/:id/contacted` | auth | contacts | Mark a contact as contacted today |
| 28781 | POST | `/api/contacts/import/preview` | auth → adminOnly → contactImportUpload.single('file') | contacts | Preview a contacts file import, columns and mapping |
| 28803 | POST | `/api/contacts/import/commit` | auth → adminOnly | contacts | Commit a contacts import, dedupe by email |
| 29136 | POST | `/api/contacts/outreach/draft` | auth → adminOnly | contacts | Draft personalized outreach emails for selected contacts |
| 29188 | POST | `/api/contacts/outreach/queue` | auth → adminOnly | contacts | Queue drafted outreach emails into the approval outbox |
| 38828 | GET | `/api/admin/outlook/status` | auth → adminOnly | contacts | Get Outlook connection and configuration status |
| 38840 | GET | `/api/admin/outlook/threads` | auth → adminOnly | contacts | List Outlook inbox threads |
| 38858 | GET | `/api/admin/outlook/threads/:id` | auth → adminOnly | contacts | Read one Outlook thread with full messages |
| 38867 | POST | `/api/admin/outlook/threads/:id/draft-reply` | auth → adminOnly | contacts | Draft an AI reply for an Outlook thread |
| 38896 | POST | `/api/admin/outlook/threads/:id/queue-reply` | auth → adminOnly | contacts | Stage an Outlook reply into the approval outbox |

#### Area: advisors (6 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 42457 | GET | `/api/admin/advisors/latest` | auth → adminOnly | advisors | Get the latest advisory board review per seat |
| 42463 | GET | `/api/admin/advisors/history` | auth → adminOnly | advisors | Get review history for one advisor seat |
| 42471 | POST | `/api/admin/advisors/run/:seat` | advisorLimiter → auth → adminOnly | advisors | Force-run an advisor board review for one seat |
| 42479 | POST | `/api/admin/advisors/:reviewId/feedback` | auth → adminOnly | advisors | Record helpful or not-relevant feedback on an advisor observation |
| 42652 | POST | `/api/admin/advisors/ask` | advisorLimiter → auth → adminOnly | advisors | Ask the advisory board a routed question |
| 42664 | GET | `/api/admin/advisors/questions` | auth → adminOnly | advisors | List advisor board Q&A history |

#### Area: files (12 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 18619 | GET | `/api/folders/:project` | auth → adminOnly | files | List folders for a project |
| 18630 | POST | `/api/folders/:project` | auth → adminOnly | files | Create a folder for a project |
| 18643 | DELETE | `/api/folders/:id` | auth → adminOnly | files | Delete a folder and move its files to parent |
| 18658 | GET | `/api/files/:project` | auth → adminOnly | files | List files for a project by folder |
| 18678 | POST | `/api/files/:project` | auth → adminOnly → projectFilesUpload.single('file') | files | Upload a file to a project |
| 18705 | DELETE | `/api/files/:id` | auth → adminOnly | files | Delete a project file |
| 18719 | GET | `/api/files/:id/download` | auth → adminOnly | files | Download a project file with original filename |
| 19090 | POST | `/api/upload/:type` | auth | files | Upload a file of a validated type |
| 37151 | GET | `/api/admin/files` | auth → adminOnly | files | List team files, optionally filtered by scope |
| 37163 | POST | `/api/admin/files` | auth → adminOnly | files | Upload a team file |
| 37182 | GET | `/api/admin/files/:id/download` | auth → adminOnly | files | Download a team file |
| 37194 | DELETE | `/api/admin/files/:id` | auth → adminOnly | files | Delete a team file |

#### Area: team (8 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 35181 | GET | `/api/admin/team` | auth → adminOnly | team | List team members with admin access |
| 35210 | POST | `/api/admin/team/invite` | auth → adminOnly | team | Invite a new admin with a temporary password |
| 35249 | POST | `/api/admin/team/invite/resend` | auth → adminOnly | team | Resend an admin invite with a new temporary password |
| 35272 | POST | `/api/admin/team/invite/manual` | auth → adminOnly → founderOnly | team | Manually issue admin credentials (founder only) |
| 35290 | GET | `/api/admin/team/permissions` | auth → adminOnly → founderOnly | team | Get the section permission catalog and admin assignments |
| 35303 | PUT | `/api/admin/team/permissions` | auth → adminOnly → founderOnly | team | Set an admin's allowed portal sections |
| 35375 | POST | `/api/admin/team/grant` | auth → adminOnly | team | Create or update a team member's admin/staff role |
| 35398 | POST | `/api/admin/team/revoke` | auth → adminOnly | team | Revoke a team member's admin and staff access |

#### Area: tech (12 routes)

| line | method | path | auth middleware | permission section | purpose |
|---|---|---|---|---|---|
| 34694 | GET | `/api/admin/system-health` | auth → staffOrAdmin | tech | Run a preflight battery of read-only system health checks |
| 34868 | POST | `/api/admin/health/test-email` | auth → adminOnly | tech | Send a test email to verify the full delivery pipeline |
| 35008 | GET | `/api/admin/audit-log` | auth → adminOnly | tech | List recent admin audit log actions |
| 35962 | POST | `/api/admin/tech/verify-password` | auth → adminOnly → authLimiter | tech | Verify the tech-tools password |
| 35969 | GET | `/api/admin/tech/system-info` | auth → adminOnly → techAuth | tech | Get database and system info for the tech dashboard |
| 36021 | GET | `/api/admin/tech/tables` | auth → adminOnly → techAuth | tech | List all database tables with row counts |
| 36041 | GET | `/api/admin/tech/tables/:name` | auth → adminOnly → techAuth | tech | Get rows from a specific database table |
| 36083 | GET | `/api/admin/tech/db-download` | auth → adminOnly → techAuth | tech | Download the full database file |
| 36098 | GET | `/api/admin/tech/export-all` | auth → adminOnly → techAuth | tech | Export all database tables as JSON |
| 36115 | POST | `/api/admin/tech/test-stripe` | auth → adminOnly → techAuth | tech | Test the Stripe connection |
| 36139 | POST | `/api/admin/tech/test-fira` | auth → adminOnly → techAuth | tech | Test the FIRA API connection |
| 36169 | POST | `/api/admin/tech/test-email` | auth → adminOnly → techAuth | tech | Send a test email via the tech dashboard |

## 2. ADMIN → MEMBER PORTAL — the critical chain

The admin portal never holds a member session and never signs a member token. It reaches members through exactly four mechanisms: (a) URLs it mints into emails/JSON that resolve on the member origin, (b) two server-side HTTP calls plus three browser cross-origin clients, (c) the one shared Turso/libsql database, and (e) notification rows the member portal drains (bell, Web Push, email outbox). Section (d) verifies the guards that keep (c) safe.

### 2a. URLs that point members at the member portal

**The one base helper.** `userPortalBase()` (server.js:803–811): `USER_PORTAL_URL` (trailing slash stripped) → else `https://medx-user-portal.onrender.com` when `NODE_ENV=production` or `RENDER` is set → else `http://localhost:3010` with a one-time console warning. `QR_BASE_URL = userPortalBase()` at :816 and `qrImageUrl(regId)` = `${QR_BASE_URL}/qr/${regId}.png` at :817 (the PNG route lives only on the member portal, comment :813). Boot-order note: commit `a05677b` (2026-08-08) moved this helper above its first module-scope use after a TDZ crash.

Other bases that can stand in for the member origin: `walletBaseOrigin()` :32457–32459 = `PUBLIC_BASE_URL || RENDER_EXTERNAL_URL || userPortalBase()` (Google Wallet class URIs — note on Render `RENDER_EXTERNAL_URL` is the ADMIN host, so wallet passes point at the admin origin unless `PUBLIC_BASE_URL` is set); `psVerifyBase(req)` :37598–37603 = `USER_PORTAL_URL` → localhost:3001 when the request host is local → `userPortalBase()`. Admin-origin bases (for links that must resolve on the ADMIN host): `seatPublicBase()` :1956–1959 = `RENDER_EXTERNAL_URL || ADMIN_PORTAL_URL || https://medx-admin-portal.onrender.com`; `comboPublicBase()` :30950; `forumAdminBase()` :39822; `ADMIN_PORTAL_URL` const :1285 (env or `http://localhost:<PORT||3002>` — used raw in nag/digest emails :1931, :23518); newsletter page base :208; `MEDX_LOGO_URL` :185.

Every place the admin backend writes a member-portal URL (33 `userPortalBase()` call sites + the QR helper + two hard-coded footers), what triggers it, and the exact shape:

| server.js line | Triggered by | URL shape produced | Member-side handler |
|---|---|---|---|
| 257, 259 | every email (`buildEmailTemplate` footer) | `https://medx-user-portal.onrender.com/privacy`, `/terms` — hard-coded, ignores `USER_PORTAL_URL` | member static pages |
| 817 (`qrImageUrl`, 2 uses) | ticket/pass emails | `${base}/qr/<regId>.png` | user server.js:4076 `GET /qr/:id.png` |
| 2702–2703 `postEventEmail` ← `postEventStageBatch` :2793 ← `POST /api/admin/post-event/*` (:2808–2811) | post-event thank-you / certificate / feedback / missed emails | `${base}/#mymedx` | member hash router → `#section-mymedx` |
| 2885–2886 `surveyEmail` ← `surveyStageBatch` :2931 ← `POST /api/admin/event-survey/...` (:38945) and the daily tick (:3091) | NPS survey emails | `${base}/api/public/survey?t=<token>&l=<hr\|en>&r=<1..10>` and `${base}/api/public/survey/recommend?t=&l=&v=` | user server.js:12208 / :12231 write `event_survey_responses` |
| 11340–11341 | `GET /api/admin/users/:id/profile` when the member has 0 local registrations | server-side `fetch(${base}/api/public/registrations/<email>)` | user server.js:29187 (see §2b) |
| 20962–20963 | `POST /api/admin/plexus/speakers/invite` | `${base}/?section=speaker&code=<invite_code>` | member `init()` reads `section` + `code` (speaker portal deep link) |
| 21039–21040 | `POST /api/admin/plexus/speakers/:id/send-upload-link` | same shape as above | same |
| 21410 | `POST /api/admin/plexus/transfer/:id/approve` | portal root link in the two outbox emails | member root |
| 21557 | `POST /api/admin/early-bird/:id/stage-thankyou` | portal link in the staged thank-you | member root |
| 22005 `spkPublicBase` → 22338 (`gpSerialize`, `GET /api/admin/guest-passes`), 22350 (`gpEmail`, `POST /api/admin/guest-passes/:id/send`) | guest-pass list/send | `${base}/pass/<token>` | user server.js:5363 `GET /pass/:token` (+ `/calendar.ics`, `/manifest.json`) |
| 22792 | `POST /api/admin/post-event/attendee-thankyou` | portal link | member root |
| 23092 `digestPortalLink`, 23096–23106 `digestFeedUrl` ← `memberNewsletterHtml` :23959 ← `POST /api/admin/newsletters/:id/send` (:23961) | member digest/newsletter | `${base}/#<section>`; stored feed links: absolute kept, `#slug`/`/path`/`slug` → `${base}/#slug` or `${base}/path` | member hash router |
| 30125–30150 | `PUT /api/gala/registrations/:id` when status changes to `approved` | `${base}/#gala` and **`${base}/pay/gala/<pay_token>`** (token minted into `gala_registrations.pay_token` at :30146–30149 if absent) | user server.js:27868 `GET /pay/gala/:token` → Stripe Checkout (requires `status='approved'`, :27873) |
| 30200–30201 | `GET /api/gala/registrations/:id/pay-link` | JSON `{ url: ${base}/pay/gala/<token>, email, status, payment_status }` | same |
| 30440–30449 `buildGalaInviteUrlAdmin` ← `POST/GET /api/admin/gala/invite-links` (:30455+) | gala VIP / price-override links | `${base}/invite/<base64url JSON {t:link_type, x:expires_at, n:'Plexus 2026 — Gala Evening', vip?, po?}>` | user server.js:3254 `GET /invite/:data` |
| 30515–30521 `buildCroatiansAbroadInviteUrlAdmin` ← `POST /api/admin/croatians-abroad/invite-links` | Croatians-abroad / international collaborator links | `${base}/invite/<base64url {…, n:'Plexus 2026 — Croatians Abroad' \| 'International Collaborators'}>` | same landing → `POST /api/croatians-abroad/register` (user :28156) |
| 30606–30607 `signupFormPublicUrl` ← signup-forms routes (QR PNG at :30888 inside `POST /api/admin/signup-forms/:id/responses/:responseId/promote`) | public sign-up forms | `${base}/f/<slug>` | user server.js:2363 `GET /f/:slug` (+ `/qr.png`, `/calendar.ics`) |
| 31115, 31118 `comboInvitePage` ← admin-hosted `GET /e/:token` (:31136) | combo-invite landing page CTAs | `${base}/plexus/<reg_token>` and `${base}/donor-night` | user :1292 `GET /plexus/:token`, :1762 `GET /donor-night` |
| 33533–33534 | `GET /api/admin/portal-config` | JSON `{ user_portal_url }` | consumed by the SPA's `QAAdmin.loadBase()` (index.html:53714) |
| 36008–36009 | `GET /api/admin/tech/system-info` | `deployment.userPortalUrl` | display only |
| 36277–36294 | `POST /api/admin/registration-links` | plexus: `${base}/plexus/<token>`; other event types: `${base}/invite/<base64url {t,e,n,i,p,x}>` (component keys deliberately NOT in the URL, :36280–36282) | user :1292 / :3254; checkout re-reads `registration_links` by token |
| 36317–36325 | `GET /api/admin/registration-links` | adds `.url` per row with the same two shapes | same |
| 37632 `psMemberQr` (Print Suite badge QR, `/api/admin/print/*`) | badge/lanyard rendering | `${base}/verify/<base64url uid>.<hmac24>` (badge QR) | user :2717 `GET /verify/:token` |
| 39068–39076 | admin-hosted `GET /api/public/claim-seat?token=` (waitlist offer) | `${base}/plexus?claim=<token>&event=<key>[&email=&name=&ticket=]` | user `/plexus` tolerates intent params |
| 39387–39388 `forumAdmitAndInvite` ← forum candidate admit routes | Biomedical Forum invitation | `${base}/forum/enter?token=<48-hex>` (row in `forum_magic_tokens`, 14-day expiry) | user forum-wing enter |
| 39821 `forumConsiderationUrl` | forum campaign emails | `${base}/forum` | user `/forum` |
| 40283–40284 `eiEventFacts` | event-invite campaigns (`/api/admin/event-invites/*`) | conference/gala → `${base}/`; bridges → `${base}/building-bridges`; donor → `${base}/donor-night` | user :1761–1762 |
| 40354, 40368, 40567, 41414 | campaign / auto-reply / reminder CTAs | `cta_url` → facts.url → `userPortalBase()` fallback | — |

Admin-hosted links that members receive but that resolve on the ADMIN origin (not the member portal): interviewer console `${seatPublicBase}/evaluate?token=<access_token>` (:15438, `POST /api/accelerator/interviewers/:id/send-link`; page `GET /evaluate` :24551); reviewer console `${base}/review?token=` (:14410, :14422, :14459; page :24377); applicant portal `GET /apply` (:24908) with verify link `${req.headers.origin}/apply?verify=<token>` (:24032–24033 — the only link still derived from `Origin`); combo invites `comboPublicBase()/e/<token>` (:31019, :31027; page :31136); seat confirmation `${base}/api/public/confirm-seat?token=` (:2509) and waitlist claim `…/claim-seat?token=` (:2553); feedback taps `…/api/public/feedback?token=&score=` (:2754, :39111); auction guest page `GET /a/:token` (:31645) with `POST /api/public/auction/:token/bid` (:31617); gameday volunteer magic link `${ADMIN_PORTAL_URL || req host}/?gd=<token>` (:42890–42891); newsletter page `/newsletter` (:208, route :23770); picker invite `https://plexus-tables.netlify.app/?t=<16-hex>` (picker-sync.js:527).

### 2b. Direct HTTP between the two backends (and browser cross-origin calls)

| Direction | Where | Auth | What |
|---|---|---|---|
| admin backend → member backend | server.js:11341 inside `GET /api/admin/users/:id/profile` | **none** (public endpoint) | `GET ${userPortalBase()}/api/public/registrations/<email>` with a 10 s `AbortSignal.timeout`; merges the member's registrations when the admin's own query found none. Member handler user server.js:29187–29215 returns `registrations`, `forumRegistrations`, `galaRegistrations`, `bridgesRegistrations` for any email, unauthenticated and without a limiter. |
| admin backend → itself | server.js:43291–43294 | none | `GET ${RENDER_EXTERNAL_URL}/health` every 14 min, only when `NODE_ENV=production && KEEP_WARM==='1'` |
| admin SPA → member backend | index.html:43241 (`GalaAdmin` refund) | `Authorization: Bearer <admin medx_token>` | `POST https://medx-user-portal.onrender.com/api/admin/payments/gala/<id>/refund` (localhost → `http://localhost:3001`); member route user server.js:733 `POST /api/admin/payments/:kind/:id/refund` (`auth, adminOnly`) |
| admin SPA → member backend | index.html:53718 `QAAdmin.api()` (base from `/api/admin/portal-config`, fallback :53709) | admin JWT | `GET /api/admin/plexus/qa`, `POST /api/admin/plexus/qa/:id/{answer,hide}`, `POST /api/admin/plexus/qa/ask` → user server.js:21933–21979 (`auth, adminOnly`) |
| admin SPA → member origin (navigation only) | index.html:46981 `memberBaseHref()` → :47281 (Content Studio "borrow" drawer), :55583 quick action, :7447 login-page link | none | opens member pages in a drawer/new tab |

**Token compatibility caveat.** Both backends read `process.env.JWT_SECRET` (admin :859, user :569) and both mint `{ id, email, is_admin }` payloads (admin :10891, user :11135). The member `auth()` (user :6080–6100) accepts any token that verifies and whose `id` exists in the shared `users` table, then `adminOnly` checks `users.is_admin`. Because `render.yaml` generates the secret independently per service (lines 24–25, 101–102), the two browser cross-origin calls above fail with 401 unless the dashboard values are identical. The repo cannot confirm which is the case. The member CORS allowlist does admit the admin origin (user server.js:587–591) and the admin CSP `connect-src` admits the member origin (admin :915–917).

There is no shared secret, no service-to-service token, and no reverse call (member backend → admin backend) anywhere in user server.js.

### 2c. The shared database — 220 tables both portals touch

Both backends open the SAME libsql/Turso database through `shared/db.js` `createDatabase()` (admin server.js:3132–3136, user server.js:6148): `DATABASE_PATH` → `shared/medx_portal.db` if present → local file (admin :1000–1002); Turso embedded replica when `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` are set, with a 2 s debounced `db.sync()` after every write (`saveDb`, admin :1044–1050). `shared/db.js` reads no env itself (it takes `localPath/syncUrl/authToken` as options).

Extraction: table names after `CREATE TABLE [IF NOT EXISTS]` in either `server.js` (admin 286, member 231, union 297 — `picker-sync.js` creates none, `demo-purge.js` creates `_purged_<table>` backups); then every `FROM / JOIN / INSERT INTO / INSERT OR REPLACE|IGNORE INTO / UPDATE / DELETE FROM / ALTER TABLE` reference was kept only if it names a created table. Admin references 287, member 232, intersection 220 (three comment-noise tokens removed). Of the 220: 133 are read and written by both backends, 14 are pure admin→member pushes, 8 are pure member→admin feeds, 12 are declared in both but used by neither. Admin-only tables: 64 (gameday, staff tracking, nag/action center, contacts, press_releases, pr_meta_settings, planner, editions, candidates, auctions ledger, council, advisors, etc.). Member-only: 9 (`assistant_faq_log`, `card_photo_consents`, `direct_messages_nofk`, `forum_opportunities`, `processed_stripe_events`, `push_subscriptions`, `rewards_history` (member DDL), `talk_ratings`, plus 2 doc-comment artifacts).

Direction summary over the 220 shared tables (W = INSERT/UPDATE/DELETE, R = FROM/JOIN, per backend `server.js`):

| Pattern | Tables | Which |
|---|---|---|
| admin W+R, member W+R (fully shared) | 133 | `abstract_authors` `abstract_reviews` `abstracts` `accelerator_applicants` `accelerator_application_scores` `accelerator_applications` `accelerator_documents` `accelerator_evaluation_criteria` `accelerator_evaluations` `accelerator_form_config` `accelerator_institution_details` `accelerator_institutions` `accelerator_interview_scores` `accelerator_interviewers` `accelerator_key_dates` `accelerator_messages` `accelerator_pdf_settings` `accelerator_programs` `accelerator_sites` `admin_notifications` `announcements` `app_state` `bridges_events` `bridges_registrations` `certificates` `channel_members` `channel_read_status` `chat_channels` `chat_messages` `conferences` `connections` `content_blocks` `croatians_abroad_invite_links` `croatians_abroad_registrations` `dashboard_preferences` `direct_messages` `drip_log` `event_components` `event_survey_responses` `feed_items` `finance_bank_balance` `finance_fiscal_years` `finance_invoice_items` `finance_invoices` `finance_payment_orders` `finance_sequences` `finance_settings` `finance_transactions` `finance_travel_evidence` `finance_travel_orders` `finance_work_units` `forum_comments` `forum_connections` `forum_event_registrations` `forum_event_schedule` `forum_events` `forum_gala_settings` `forum_group_members` `forum_groups` `forum_media` `forum_members` `forum_mentorships` `forum_post_reactions` `forum_posts` `forum_resources` `gala_invite_links` `gala_registrations` `gala_settings` `guest_passes` `intake_windows` `invoices` `meeting_requests` `member_announcements` `member_meta` `monthly_reminders_sent` `opportunities` `payment_transactions` `personal_schedules` `pinned_items` `plexus_page_settings` `plexus_settings` `points_ledger` `poll_responses` `pr_ai_generations` `pr_analytics` `pr_campaigns` `pr_content_calendar` `pr_media_assets` `pr_newsletters` `pr_posts` `pr_subscribers` `pr_templates` `project_files` `project_folders` `project_settings` `project_status` `project_tasks` `project_timeline_events` `promo_codes` `question_upvotes` `refund_requests` `registration_details` `registration_links` `registration_transfers` `registrations` `rewards_settings` `scheduled_emails` `scholarship_applications` `sequence_steps` `session_polls` `session_questions` `session_ratings` `sessions` `signup_form_responses` `speaker_applications` `speakers` `sponsor_tasks` `sponsors` `submission_pipeline` `survey_responses` `talks` `task_files` `task_sequences` `team_members` `ticket_types` `user_notifications` `user_profiles` `users` `vip_passes` `visa_requests` `volunteer_shifts` `volunteers` `waitlist` |
| member W+R, admin never touches | 18 | `chat_read_status` `email_optouts` `email_verifications` `forum_email_templates` `forum_event_speakers` `forum_gallery_folders` `forum_group_messages` `forum_invitations` `forum_news` `forum_prospects` `intro_requests` `mentorship_profiles` `mentorship_requests` `messages` `networking_connections` `networking_meetings` `networking_profiles` `pending_meetings` |
| admin W+R, member reads only (pure admin → member push) | 14 | `auction_items` `bridges_program` `bridges_speakers` `cme_accreditations` `event_custom_fields` `gala_seat_assignments` `gala_table_assignments` `gala_tables` `org_settings` `portal_content` `signup_forms` `speaker_itineraries` `speaker_itinerary_items` `venue_rooms` |
| DDL only in both (declared, never used) | 12 | `accelerator_consents` `conference_archives` `conference_stats` `contact_interactions` `email_log` `forum_notifications` `group_discounts` `group_registration_members` `group_registrations` `review_criteria` `sponsor_leads` `sponsor_materials` |
| admin W+R, member never touches (declared in the mirror only) | 11 | `admin_section_preferences` `contacts` `event_feedback` `event_waitlist` `forum_media_folders` `nag_items` `planner_plans` `registrant_notes` `seat_confirmations` `testimonials` `waitlist_offers` |
| admin reads only, member W+R (pure member → admin) | 8 | `abstract_files` `cme_submissions` `forum_convening_segments` `forum_convenings` `forum_reservations` `notify_topics` `reward_redemptions` `speaker_documents` |
| read-only on both sides (no writer in either server.js) | 8 | `accelerator_recommendations` `conference_photos` `forum_activity` `partner_hotels` `resources` `session_tracks` `surveys` `volunteer_assignments` |
| admin W+R, member writes only | 3 | `audit_log` `automation_config` `forum_considerations` |
| member reads only | 3 | `forum_badges` `forum_member_badges` `session_attendance` |
| admin writes only, member W+R | 2 | `forum_magic_tokens` `push_outbox` |
| admin writes only | 2 | `post_event_log` `template_library` |
| admin reads only | 2 | `email_templates` `rewards_history` |
| both write only | 1 | `ticket_transfer_audit` |
| admin writes only, member reads only | 1 | `accelerator_result_codes` |
| admin reads only, member writes only | 1 | `page_views` |
| member writes only | 1 | `forum_import_batches` |

**The ten chains that matter most (admin action → table → what the member sees):**

1. `PUT /api/gala/registrations/:id` (admin :30106) sets `gala_registrations.status='approved'` (+ `pay_token`) → member `#gala` tab shows the Pay button and `/pay/gala/<token>` opens Stripe only when `status='approved'` (user :27795, :27873); member request comes in via `POST /api/gala/register` (user :26870) and rings the admin bell (`admin_notifications`, user :26886).
2. `POST /api/admin/registration-links` (admin :36277) inserts `registration_links` → member `/plexus/:token` / `/invite/:data` read the row by token (user :1299+, :20749+) and price the checkout server-side.
3. `POST /api/finance/conference-payments/:id/confirm` (admin :27078) updates `registrations.payment_status` / `payment_transactions` / `invoices` / `finance_transactions` (+ optional FIRA) → member My Pass flips to paid, QR/wallet become valid.
4. `PUT /api/admin/plexus/settings` (:34551), `PUT /api/admin/gala/settings` (:30009), `PUT /api/admin/event-components/:id` (:36208), conference/ticket routes (:11027–11139) → `plexus_settings`, `gala_settings`, `event_components`, `conferences`, `ticket_types` → member `GET /api/plexus/settings` (user :28102), `GET /api/gala/settings` (:26991), pricing phase, deadlines, registration_open; the same rows feed the website (§3).
5. Speakers / sessions / sponsors / talks CRUD + `…/publish` (admin :20183–21171, :12498) → `speakers`, `sessions`, `sponsors`, `talks` → member Speakers/Schedule/Sponsors/Talks tabs (user :4629+, :4647+, :8739+, :14007) and website lists.
6. `POST /api/admin/announcements` (:18986), `POST /api/admin/member-announcements` (:11985), `POST /api/admin/feed-items` (:12397), `POST /api/admin/notifications/send` (:22948) → `announcements`, `member_announcements`, `feed_items`, `user_notifications`, `push_outbox` → member `/api/announcements` (:23211), `/api/bell-feed` (:23099), `/api/feed` (:13855), `/api/user-notifications` (:23054), Web Push devices (user `drainPushOutbox` :200).
7. Check-in family (`POST /api/checkin` :33704, `/api/admin/checkin/ticket` :32685, `/api/admin/gala/checkin` :33465, `/api/plexus/checkin` :19850, forum/bridges variants) → `registrations.checked_in`, `gala_registrations.checked_in`, `forum_event_registrations`, `bridges_registrations` → member pass shows "checked in", certificates become claimable.
8. Accelerator: `PUT /api/accelerator/applications/:id/...` decisions, interviewers, criteria, key dates (admin `/api/accelerator/*`, `/api/admin/accelerator/*`, `/api/admin/review/*`) → `accelerator_applications`, `accelerator_key_dates`, `accelerator_programs`, `accelerator_messages`, `accelerator_result_codes` → member Accelerator tab status/messages (user :14531, :15197, :16397), `/api/accelerator/key-dates` (:23252).
9. Forum admission `forumAdmitAndInvite` (:39380–39388) → `forum_members.membership_status='approved'` + `forum_magic_tokens` → member `/forum/enter?token=` gains Forum access; forum events publish (`PUT /api/admin/forum/events/:id/publish` :16981 also inserts `user_notifications`).
10. Team Access (`POST /api/admin/team/invite|grant|revoke`, `PUT …/permissions` :35210–35398) writes the SAME `users` table members log in with: `grant` flips `is_admin` on an existing member account; `must_change_password` and `allowed_sections` only matter on the admin login.

Full matrix (220 rows; counts are distinct source lines, first lines listed; admin lines = admin server.js, member lines = user server.js):

| table | admin writes (n[lines]) | admin reads | member writes | member reads | member-visible effect / chain |
|---|---|---|---|---|---|
| `abstract_authors` | 2[11528,19351] | 4[11540,19366,19781,...] | 2[13724,21627] | 4[13736,21660,22238,...] | Co-authors: member writes (13724); admin edits (11528) |
| `abstract_files` | - | 1[19780] | 1[21703] | 1[22237] | Member uploads abstract file (21703); admin downloads (19780) |
| `abstract_reviews` | 1[20127] | 1[20117] | 1[22410] | 1[22400] | Reviewer scores: admin writes (20127); member reviewer routes (22410) -> decision surfaces to submitter |
| `abstracts` | 8[8804,11523,11546,18906,...] | 18[11537,18143,18160,...] | 7[13719,13742,19622,21621,...] | 12[13733,19617,19637,...] | Member submits abstract (13719+); admin assigns reviewers/decides (8804+, 20127) -> member Abstract tab shows decision |
| `accelerator_applicants` | 4[24026,24069,24095,24161] | 7[15529,15544,24017,...] | 4[23351,23394,23420,23486] | 7[15764,15779,23342,...] | Applicant accounts: admin-hosted /apply portal writes (24026); member portal writes (23351) |
| `accelerator_application_scores` | 2[15388,15391] | 6[15236,15319,15384,...] | 2[15675,15678] | 4[15539,15612,15671,...] | Interview scores (admin 15388; member 15675) |
| `accelerator_applications` | 17[3424,3435,10823,13138,...] | 67[5769,10805,13100,...] | 14[14601,14656,14705,14759,...] | 58[5927,5928,11646,...] | Member applies (14601+); admin reviews/scores/decides (3424+, 5769+) -> member sees status/decision in Accelerator tab |
| `accelerator_consents` | - | - | - | - | DDL only in both |
| `accelerator_documents` | 7[13173,13180,13223,13229,...] | 26[13104,13169,13173,...] | 7[14638,14645,14688,14694,...] | 24[14539,14634,14638,...] | Member uploads (14638); admin merges/downloads (13173+) |
| `accelerator_evaluation_criteria` | 7[10833,10834,10835,10836,...] | 10[13698,13850,13858,...] | 3[15353,15363,15373] | 8[15192,15344,15352,...] | Admin criteria (10833) -> reviewer scoring on both portals |
| `accelerator_evaluations` | 4[13893,13897,13932,13936] | 4[13698,13889,13928,...] | 4[15387,15391,15410,15414] | 4[15192,15383,15406,...] | Admin/evaluator scores (13893); member-portal admin routes mirror (15387) |
| `accelerator_form_config` | 4[16232,16235,16249,16257] | 3[16220,16230,16257] | 4[16671,16674,16688,16696] | 3[16659,16669,16696] | Admin form config (16232) -> member application form (16659) |
| `accelerator_institution_details` | 2[13621,13632] | 2[13605,13617] | 2[15132,15141] | 2[15117,15128] | Admin (13621) / member (15132) institution details |
| `accelerator_institutions` | 3[9051,13647,13661] | 20[3436,3438,10821,...] | 2[10774,15156] | 17[14527,14835,15116,...] | Admin institution list (9051) -> member application form dropdown (14527) |
| `accelerator_interview_scores` | 4[15190,15194,15407,15410] | 7[13701,13971,15186,...] | 2[15501,15505] | 6[15195,15441,15497,...] | Interviewer magic-link scores (admin 15190; member 15501) |
| `accelerator_interviewers` | 7[10839,10840,15153,15163,...] | 7[13701,15144,15182,...] | 5[15464,15474,15483,15699,...] | 7[15195,15455,15493,...] | Admin interviewers + magic links (10839+) -> /evaluate?token= on admin origin |
| `accelerator_key_dates` | 6[10828,10829,10830,13539,...] | 7[13060,13530,13538,...] | 3[15006,15026,15049] | 6[14997,15005,15033,...] | Admin key dates (10828+, /api/accelerator/years/:year/dates) -> member /api/accelerator/key-dates (23252) + website |
| `accelerator_messages` | 3[13761,13815,15828] | 1[13703] | 3[15255,15309,16027] | 1[15197] | Admin messages to applicant (13761) -> member sees (15197) |
| `accelerator_pdf_settings` | 2[15718,15730] | 3[15680,15715,15904] | 2[15930,15942] | 3[15892,15927,16083] | Admin PDF settings (15718) -> member package PDF (15892) |
| `accelerator_programs` | 4[9036,13475,13485,13514] | 37[3425,3428,9033,...] | 3[10759,14974,14984] | 26[10756,14520,14532,...] | Admin defines programs/years (9036+) -> member /api/accelerator/program (14519) and application form |
| `accelerator_recommendations` | - | 3[13106,13704,18770] | - | 3[14541,15198,19501] | Read by both (13106 / 14541) |
| `accelerator_result_codes` | 1[15848] | - | - | 1[16397] | Admin writes result codes (15848) -> member decision lookup (16397) |
| `accelerator_sites` | 4[6398,12056,12071,12089] | 5[6397,12048,12068,...] | 1[10518] | 3[10517,14552,14553] | Admin sites (6398) -> member site picker (10517) |
| `admin_notifications` | 4[18400,18481,22860,22900] | 1[22852] | 3[22951,22991,26886] | 1[22943] | MEMBER -> ADMIN bell: member portal inserts on gala request (26886) and monthly reminders (22991); admin bell GET /api/notifications (22850) reads; admin also self-writes (18400, 18481, 22900) |
| `admin_section_preferences` | 4[10957,10958,10970,10971] | 3[10947,10957,10970] | - | - | Admin (10957) |
| `announcements` | 1[18988] | 4[11615,11646,19770,...] | 1[19655] | 3[13834,22227,23119] | Admin POST /api/admin/announcements (18988) -> member /api/announcements (23211) + bell |
| `app_state` | 12[8385,8395,8410,8570,...] | 12[1027,8379,8389,...] | 3[8655,8665,8758] | 4[5607,8649,8659,...] | Misc flags/counters both sides (admin 8385+, member 8655) |
| `auction_items` | 9[31367,31389,31411,31422,...] | 21[22537,31191,31211,...] | - | 1[12121] | Admin auction CRUD / winner confirm (`/api/admin/auctions/*`, 31367+); member portal only sums paid lots into `/api/public/impact` charity_giving (user :12121); guests bid on the admin-hosted `/a/:token` page |
| `audit_log` | 6[1267,10873,10886,11964,...] | 4[12559,35011,35363,...] | 4[771,11103,11127,12390] | - | Admin logAudit (1267); member portal writes its own audit rows (771) |
| `automation_config` | 2[2343,5958] | 1[2340] | 1[10095] | - | Admin toggles (2343); member reads none (writes 10095 seed) |
| `bridges_events` | 10[10390,10424,10433,29619,...] | 40[10338,10409,10417,...] | 5[9052,9053,9059,9064,...] | 37[490,3113,3163,...] | Admin CRUD/publish (29762+, /api/bridges/events) -> member Bridges tab (16420) + /building-bridges page + website impact counters |
| `bridges_program` | 4[29866,29877,29896,29906] | 3[29850,29896,29903] | - | 1[16643] | Admin program items (29866) -> member event page (16643) |
| `bridges_registrations` | 10[10422,20044,29709,29721,...] | 42[10422,11311,11412,...] | 8[12898,16479,16542,20911,...] | 31[490,4123,5869,...] | Member registers (12898, 16446); admin check-in/status (10422+) -> member my-registration (16503) |
| `bridges_speakers` | 4[29798,29809,29829,29839] | 4[29783,29829,29836,...] | - | 3[16571,16572,16644] | Admin speakers (29798) -> member event page (16571) |
| `certificates` | 2[2689,19815] | 6[2684,2735,2823,...] | 1[22316] | 6[2945,13128,13239,...] | Admin issues certificates (2689+) -> member downloads / public /verify-certificate (2945+, 22262) |
| `channel_members` | 13[17307,17313,17346,17359,...] | 12[17238,17253,17307,...] | 2[18757,18762] | 6[18695,18705,18718,...] | Admin (17307); member (18757) |
| `channel_read_status` | 7[17309,17315,17525,17527,...] | 7[17309,17315,17498,...] | 3[11161,18922,18924] | 3[11161,18895,18918] | Both |
| `chat_channels` | 11[8958,17283,17292,17310,...] | 31[8926,10756,10757,...] | 6[10696,18734,18743,18759,...] | 12[10664,18696,18719,...] | Team chat (admin 8958+); member portal forum wing also writes (10696) |
| `chat_messages` | 9[6226,10789,17308,17314,...] | 15[10753,17308,17314,...] | 3[18758,18763,18821] | 8[18758,18763,18789,...] | Team chat messages (admin 6226+); member writes (18758) |
| `chat_read_status` | - | - | 1[11162] | 1[11162] | Member only |
| `cme_accreditations` | 2[34478,34481] | 3[34445,34476,34512] | - | 3[21442,21463,21492] | Admin CME/HLK accreditation records (34478) -> member CME view (21442) |
| `cme_submissions` | - | 6[34446,34492,34513,...] | 2[21476,21479] | 2[21474,21490] | Member submits CME data (21476); admin reads/exports (34446) |
| `conference_archives` | - | - | - | - | DDL only in both |
| `conference_photos` | - | 5[19790,21753,21754,...] | - | 1[22247] | Read by both (admin /api/plexus/photos; member 22247) |
| `conference_stats` | - | - | - | - | DDL only in both |
| `conferences` | 8[8698,11038,11126,11149,...] | 124[1037,1040,1604,...] | 1[10566] | 36[2932,4621,4669,...] | Admin creates/edits/activates the conference (11027-11139) -> member portal active event, dates, registration_open, wallet_class_id; website /api/public/site conference.* |
| `connections` | 3[11604,19631,19640] | 4[11610,19616,19626,...] | 5[11158,13800,13827,22080,...] | 6[11158,13811,13824,...] | Member networking connections (11158); admin mirror routes /api/connections/* (11603-11609) |
| `contact_interactions` | - | - | - | - | DDL only in both |
| `contacts` | 10[10489,28613,28625,28653,...] | 10[10451,28577,28603,...] | - | - | Admin-only network (10489) |
| `content_blocks` | 2[6419,11961] | 6[6418,11823,11824,...] | 2[10539,12387] | 6[10538,12050,12051,...] | Admin PUT /api/admin/content-blocks/:key (11940) -> website /api/public/content (user 12045) + member content (10538) |
| `croatians_abroad_invite_links` | 2[30530,30550] | 4[30536,30542,30548,...] | 5[20743,27134,27154,27162,...] | 6[3276,27140,27146,...] | Admin creates links (30530) -> member /invite/:data -> POST /api/croatians-abroad/register (28156) redeems and counts uses |
| `croatians_abroad_registrations` | 7[8384,8394,33093,33315,...] | 29[8382,8384,8392,...] | 10[8654,8664,20731,27435,...] | 16[4086,8652,8654,...] | Member registers (Stripe) -> admin lists/approves/exports (8382+, 27168 user-side); admin status edits show on member's confirmation/pass |
| `dashboard_preferences` | 3[10991,10995,11004] | 3[10982,10991,11004] | 4[13630,13632,13658,13660] | 4[13617,13627,13647,...] | Per-user dashboard layout; both portals own their own rows |
| `direct_messages` | 6[34221,34236,34338,34385,...] | 9[1672,12569,18149,...] | 8[11154,12531,12699,14571,...] | 7[8545,11154,26782,...] | Admin POST /api/admin/messages (34221+) -> member inbox /api/messages (26775); member replies (11154) |
| `drip_log` | 39[2937,3092,3118,14435,...] | 38[2963,3089,3115,...] | 6[4440,11027,11391,11528,...] | 5[4439,11005,11473,...] | Send-once markers on both sides (admin 39 writers) |
| `email_log` | - | - | - | - | DDL only in both |
| `email_optouts` | - | - | 3[1846,1849,1861] | 3[1787,1831,1849] | Member-only unsubscribe (1846) |
| `email_templates` | - | 1[10501] | - | - | Admin reads (10501) |
| `email_verifications` | - | - | 3[11325,11455,11727] | 1[11705] | Member-only verification tokens |
| `event_components` | 4[8547,8556,8558,36213] | 6[8554,30134,36201,...] | 3[7106,7115,7117] | 3[5699,5716,7113] | Admin PUT /api/admin/event-components/:id (36208) sets component prices/active -> member checkout price (effectiveGalaPrice) and gala pay-link price |
| `event_custom_fields` | 3[36380,36401,36411] | 5[36355,36357,36359,...] | - | 2[5948,5950] | Admin defines custom registration fields (36380) -> member registration form renders them (5948) |
| `event_feedback` | 2[2786,39118] | 3[2841,2844,39104] | - | - | Admin-only post-event feedback (2786+) |
| `event_survey_responses` | 1[2944] | 4[2946,2965,21608,...] | 3[12222,12242,12258] | 1[12197] | Admin stages survey emails (2944); member taps links -> user /api/public/survey writes (12222); admin reads scores (2946) |
| `event_waitlist` | 4[12946,12957,12966,39088] | 6[2541,12937,12938,...] | - | - | Admin-only waitlist ops (12946+) |
| `feed_items` | 3[12402,12416,12434] | 5[12394,12412,12432,...] | 4[10412,14109,14122,14140] | 7[10411,13857,13896,...] | Admin POST /api/admin/feed-items (12402) -> member /api/feed (13855) home feed |
| `finance_bank_balance` | 3[9151,25608,25615] | 4[9142,25550,25599,...] | 3[10792,24723,24730] | 4[10783,24671,24716,...] | Admin (9151) / member (10792) |
| `finance_fiscal_years` | 8[7458,9156,9157,25629,...] | 6[7456,25521,25553,...] | 6[8266,10797,24744,24757,...] | 3[8264,24674,24737] | Admin (7458) / member (8266) |
| `finance_invoice_items` | 5[9472,25973,26036,26044,...] | 4[25991,26036,26067,...] | 4[25001,25047,25055,25067] | 4[25019,25047,25067,...] | Admin (9472) / member (25001) |
| `finance_invoices` | 6[9464,25957,26029,26068,...] | 10[25577,25895,25910,...] | 6[10842,24985,25040,25068,...] | 6[24694,24942,25014,...] | Admin invoices (9464+); member webhook writes (10842) |
| `finance_payment_orders` | 4[9987,26277,26300,26312] | 5[26252,26287,26296,...] | 4[10860,25266,25285,25293] | 3[25243,25276,25293] | Admin (9987) / member (10860) |
| `finance_sequences` | 8[9233,9234,9235,9236,...] | 1[25494] | 12[10829,10830,10831,10832,...] | 3[20343,21202,24645] | Invoice numbering: admin (9233) and member (10829) both allocate |
| `finance_settings` | 3[7450,26661,26664] | 4[26138,26541,26659,...] | 5[8258,25604,25607,25619,...] | 5[25140,25500,25594,...] | Admin (7450) / member (8258) |
| `finance_transactions` | 10[9226,25537,25828,25877,...] | 17[25557,25558,25564,...] | 8[10824,20355,21228,24875,...] | 13[24677,24678,24688,...] | Admin finance ledger (9226+, Mark Paid 27098) ; member webhook fulfilment also books (10824) |
| `finance_travel_evidence` | 2[26504,26518] | 4[26384,26512,26518,...] | 2[25475,25489] | 3[25374,25483,25489] | Admin (26504) / member (25475) |
| `finance_travel_orders` | 8[9747,26366,26395,26413,...] | 8[25578,26321,26349,...] | 8[10851,10855,25357,25385,...] | 8[24695,25302,25330,...] | Admin (9747) / member (10851) |
| `finance_work_units` | 6[9176,25644,25655,25708,...] | 19[25561,25565,25679,...] | 12[10809,24755,24794,24812,...] | 14[24681,24775,24802,...] | Admin (9176) / member (10809) |
| `forum_activity` | - | 6[16736,18135,18136,...] | - | 1[17771] | Admin reads activity (16736); member reads (17771) |
| `forum_badges` | - | - | - | 2[2956,13142] | Member reads (2956) |
| `forum_comments` | 1[16578] | 1[16561] | 1[17322] | 1[17303] | Member comments (17322); admin moderation (16578) |
| `forum_connections` | 3[16391,16430,16432] | 5[16367,16382,16409,...] | 3[17056,17099,17101] | 5[17030,17047,17076,...] | Member connections (17056); admin reads/writes (16391) |
| `forum_considerations` | 2[39432,39446] | 9[1790,39414,39415,...] | 1[4341] | - | Public /api/public/forum-consideration on member portal writes (4341); admin reviews/escalates (39432, 1790) |
| `forum_convening_segments` | - | 1[41740] | 1[10194] | 2[4391,4413] | Member-side writes (10194); admin reads (41740) |
| `forum_convenings` | - | 2[33670,41738] | 1[10191] | 3[4389,4409,10189] | Member-side forum wing writes (10191); admin reads (33670) |
| `forum_email_templates` | - | - | 5[18214,18219,18231,18234,...] | 2[18204,18242] | Member-portal admin routes only (18214) |
| `forum_event_registrations` | 6[16634,16957,17011,17033,...] | 23[11256,11298,11444,...] | 12[8887,17428,17541,17916,...] | 27[4122,5864,12107,...] | Member registers (8887+); admin check-in/status (16634+) |
| `forum_event_schedule` | 3[17123,17136,17147] | 2[17111,17147] | 3[18411,18436,18443] | 4[17576,18393,18409,...] | Admin schedule (17123) -> member (17576) |
| `forum_event_speakers` | - | - | 3[18350,18376,18383] | 4[18295,18332,18348,...] | Member-portal admin routes only (18350); no admin-portal R/W |
| `forum_events` | 11[3234,3244,9092,9097,...] | 25[3241,3244,11299,...] | 18[8871,8875,8882,8883,...] | 39[3761,3765,3766,...] | Admin CRUD/publish (3234+, /api/admin/forum/events) -> member /api/forum/events (17335); member registers/pays |
| `forum_gala_settings` | 2[8320,41771] | 1[41763] | 2[8858,8861] | 6[491,3735,3746,...] | Admin forum gala settings (8320) -> member forum wing (491+) |
| `forum_gallery_folders` | - | - | 1[17639] | 2[17609,17627] | Member-portal admin routes only |
| `forum_group_members` | 4[16469,16472,16831,16852] | 6[16441,16452,16466,...] | 2[17138,17141] | 8[17112,17119,17135,...] | Member joins (17138); admin manages (16469) |
| `forum_group_messages` | - | - | 1[17216] | 1[17183] | Member-only group chat (17216) |
| `forum_groups` | 3[9131,16813,16832] | 7[16442,16732,16809,...] | 1[17828] | 2[17113,17766] | Admin creates groups (9131); member joins (17828) |
| `forum_import_batches` | - | - | 2[18160,18195] | - | Member-portal admin routes only (18160) |
| `forum_invitations` | - | - | 5[18088,18111,18125,18497,...] | 4[18075,18294,18478,...] | Member-portal admin routes only (18088+) |
| `forum_magic_tokens` | 1[39387] | - | 2[4172,4306] | 1[4168] | Admin creates invite token (39387) -> member /forum/enter?token= (4168) signs in |
| `forum_media` | 3[16669,17081,17096] | 1[16646] | 1[17658] | 1[17588] | Admin uploads media (16669); member views (17588) |
| `forum_media_folders` | 4[17057,17070,17083,17084] | 2[17045,17084] | - | - | Admin-only folders (17057) |
| `forum_member_badges` | - | - | - | 2[2956,13141] | Member reads (2956) |
| `forum_members` | 11[9085,16280,16308,16531,...] | 63[9060,9110,16266,...] | 12[4230,4232,4235,16942,...] | 70[2956,4199,4200,...] | Admin admits/approves members (9085+, forumAdmitAndInvite 39380) -> member Forum access; member applies (4230) |
| `forum_mentorships` | 1[16718] | 2[16713,16733] | 1[17713] | 1[17708] | Member requests (17713); admin pairs (16718) |
| `forum_news` | - | - | 1[10211] | 2[4286,10206] | Member-portal only |
| `forum_notifications` | - | - | - | - | DDL only in both |
| `forum_post_reactions` | 2[16546,16550] | 3[16501,16543,16546] | 2[17286,17290] | 3[17248,17283,17286] | Member reacts (17286); admin reads (16501) |
| `forum_posts` | 6[9114,16524,16547,16551,...] | 3[16482,16730,17175] | 5[17265,17287,17291,17324,...] | 4[13929,17229,17764,...] | Member posts (17265); admin moderates (9114+) -> feed |
| `forum_prospects` | - | - | 6[18043,18057,18066,18092,...] | 7[17767,18033,18066,...] | Member-portal admin routes only (18043+) |
| `forum_reservations` | - | 2[33670,41741] | 2[4424,4428] | 2[4392,4421] | Member reserves (4424); admin reads (33670) |
| `forum_resources` | 1[17164] | 1[16680] | 1[17992] | 1[17671] | Admin posts resources (17164) -> member (17671) |
| `gala_invite_links` | 3[30462,30494,30502] | 6[30468,30474,30480,...] | 5[20902,27062,27097,27106,...] | 10[3616,27068,27075,...] | Admin creates VIP/price-override invite links (30462+) -> member /invite/:data (3254) decodes and pre-fills gala registration; member side counts uses (20902+) |
| `gala_registrations` | 13[8383,8393,8408,20015,...] | 85[1621,1639,8381,...] | 22[8653,8663,20417,20736,...] | 34[4110,5859,5922,...] | THE gala chain: member requests via /api/gala/register (26870) [status=pending, rings admin bell]; admin PUT /api/gala/registrations/:id (30125) flips status -> approved sends pay link /pay/gala/<pay_token>; member #gala shows Pay button only when status='approved' (user 27795/27873); admin check-in/refund/seat writes show as checked_in / refunded / seat |
| `gala_seat_assignments` | 4[12658,12672,12673,12682] | 4[12608,12658,12672,...] | - | 1[13043] | Admin assigns seats (12658) -> member /api/gala/my-seat -> #galaSeatValue |
| `gala_settings` | 8[6336,6337,8275,8278,...] | 23[8416,21760,22306,...] | 12[8591,8626,8671,8674,...] | 22[488,1310,3095,...] | Admin PUT /api/admin/gala/settings (30009) -> member GET /api/gala/settings (26991): gala prices, deadlines, capacity shown in #gala |
| `gala_table_assignments` | 3[12734,12738,12757] | 4[12694,12732,12757,...] | - | 2[13031,13371] | Admin table assignment (12734) -> member my-seat (13031) |
| `gala_tables` | 3[12634,12646,12659] | 5[12607,12642,12656,...] | - | 1[13045] | Admin seating plan (12634) -> member /api/gala/my-seat (13023) shows table |
| `group_discounts` | - | - | - | - | DDL only in both |
| `group_registration_members` | - | - | - | - | DDL only in both |
| `group_registrations` | - | - | - | - | DDL only in both |
| `guest_passes` | 1[33255] | 5[23439,33191,33216,...] | 2[12905,12926] | 5[12840,12844,12864,...] | Member creates guest passes (12905); admin sends/reads (33255, 23439) -> guest gets /pass/<token> |
| `intake_windows` | 1[5651] | 1[13070] | 3[9963,16914,16915] | 4[16712,16913,16917,...] | Admin window (5651); member checks open window (16712) |
| `intro_requests` | - | - | 2[14405,14451] | 2[14426,14448] | Member-only |
| `invoices` | 1[27099] | 1[26922] | 6[767,19826,19838,19918,...] | 4[19822,20070,20182,...] | Member webhook / admin Mark Paid (27099) write; member sees invoice number on pass/receipt (19822+) |
| `meeting_requests` | 1[19661] | 2[19669,19671] | 1[22110] | 2[22118,22120] | Admin (19661) / member (22110) speaker meeting requests |
| `member_announcements` | 3[6382,11997,12039] | 6[6381,11661,11978,...] | 2[291,10499] | 5[263,10498,13908,...] | Admin composer POST /api/admin/member-announcements (11997) -> member bell-feed (263+) with audience gating; push=1 fans out to push_outbox |
| `member_meta` | 2[12456,12459] | 3[12445,12451,37628] | 1[12960] | 4[2727,2915,12956,...] | Admin flags/notes/card toggles (12456) -> member /api/member/meta (12968) card state |
| `mentorship_profiles` | - | - | 3[10555,14238,14241] | 5[10554,14223,14236,...] | Member-only |
| `mentorship_requests` | - | - | 2[14290,14345] | 6[14253,14255,14286,...] | Member-only |
| `messages` | - | - | 1[11159] | 1[11159] | Member-only thread table (11159) |
| `monthly_reminders_sent` | 1[22909] | 1[22877] | 1[23000] | 1[22968] | Cron dedupe on both portals |
| `nag_items` | 16[1848,1854,1859,1869,...] | 14[1844,1866,1874,...] | - | - | Admin Action Center (1848+) |
| `networking_connections` | - | - | 5[11150,26477,26511,26672,...] | 15[11150,13233,14357,...] | Member-only |
| `networking_meetings` | - | - | 3[11152,26543,26564] | 2[11152,26552] | Member-only |
| `networking_profiles` | - | - | 3[11151,26449,26453] | 6[11151,26427,26447,...] | Member-only |
| `notify_topics` | - | 6[11662,11752,11765,...] | 3[11163,14088,14091] | 9[272,11163,11231,...] | Member follows projects (11163); admin reads for audience targeting (11662) |
| `opportunities` | 1[12481] | 3[12470,12472,12476] | 3[10427,13994,14160] | 6[10426,13981,13984,...] | Admin edits (12481); member posts+reads /api/opportunities (13977) |
| `org_settings` | 3[5026,38434,38443] | 3[5018,38420,38443] | - | 1[12067] | Admin signature upload (38426) -> member /api/public/content signature (12067) |
| `page_views` | - | 1[18929] | 1[12316] | - | Member beacon /api/public/pv writes (12316); admin reads (18929) |
| `partner_hotels` | - | 1[19699] | - | 1[22152] | Read by both (admin /api/plexus/hotels 19697; member 22152); no writer in either server.js |
| `payment_transactions` | 1[27098] | 4[11279,26848,26921,...] | 8[766,19815,19843,19966,...] | 7[753,19809,20071,...] | Member Stripe webhook writes (766+); admin reads for finance reconciliation (11279+) and writes on Mark Paid (27098) |
| `pending_meetings` | - | - | 3[11153,26600,26633] | 5[11153,26597,26618,...] | Member-only |
| `personal_schedules` | 5[11564,11573,19440,19447,...] | 6[11558,11573,19437,...] | 6[11157,13760,13769,21782,...] | 7[11157,13754,13769,...] | Member builds My Schedule (11157+); admin has mirror routes /api/schedule/* (11556-11572) |
| `pinned_items` | 3[17947,17956,17965] | 4[17930,17940,17945,...] | 3[18952,18961,18970] | 4[18935,18945,18950,...] | Per-user pins; both |
| `planner_plans` | 3[36914,36953,37001] | 5[1745,36926,36934,...] | - | - | Admin planner (36914) |
| `plexus_page_settings` | 5[8295,8305,30085,30087,...] | 11[1435,1636,2087,...] | 3[8611,8621,8933] | 4[1325,8610,8931,...] | Admin page-settings edits (8295+) -> member Plexus page copy/toggles (user 1325+) |
| `plexus_settings` | 6[8460,8476,8485,34539,...] | 7[8456,8467,8483,...] | 2[8922,8946] | 5[3069,3685,8913,...] | Admin PUT /api/admin/plexus/settings (34551) -> member GET /api/plexus/settings (28102) drives the Plexus tab (phase, deadlines, toggles) |
| `points_ledger` | 1[35146] | 7[35051,35066,35144,...] | 2[5838,26406] | 5[5822,5825,5835,...] | Admin grants points (35146); member earns/reads rewards tab (5822+) |
| `poll_responses` | 2[19550,19553] | 2[19548,20360] | 2[21999,22002] | 2[21997,22531] | Member poll answers (21999); admin reads results (19548) |
| `portal_content` | 5[33892,33906,33917,33927,...] | 10[33877,33883,33896,...] | - | 2[28089,28095] | Admin POST /api/portal-content (33892) publish -> member /api/portal-content/published (28088) |
| `post_event_log` | 2[2780,2788] | - | - | - | Admin (2780) |
| `pr_ai_generations` | 4[10299,27976,27987,27994] | 1[27952] | 3[26287,26295,26302] | 1[26268] | Admin (10299) / member legacy (26287) |
| `pr_analytics` | 3[10327,27882,27886] | 4[27268,27269,27851,...] | 3[10944,26198,26202] | 4[25729,25730,26167,...] | Admin (10327) / member legacy (10944) |
| `pr_campaigns` | 4[10236,27820,27835,27843] | 5[27241,27785,27802,...] | 4[10931,26142,26151,26159] | 4[25707,26111,26128,...] | Admin (10236) / member legacy (10931) |
| `pr_content_calendar` | 12[10170,21796,27323,27335,...] | 13[1759,20817,21793,...] | 6[10895,25776,25785,25793,...] | 6[25684,25747,25768,...] | Admin (10170) / member legacy (10895) |
| `pr_media_assets` | 5[10268,27707,27745,27754,...] | 6[27263,27713,27734,...] | 3[26082,26091,26103] | 4[26050,26071,26098,...] | Admin (10268) / member legacy (26082) |
| `pr_newsletters` | 11[10192,23265,23273,23314,...] | 10[1776,23265,23304,...] | 5[10907,25905,25914,25924,...] | 5[25721,25880,25897,...] | Admin (10192) / member legacy (10907) |
| `pr_posts` | 9[10145,20833,27355,27398,...] | 10[10123,27225,27235,...] | 5[10881,25805,25855,25865,...] | 7[10869,25691,25701,...] | PR studio: admin (10145+); member portal legacy PR routes (10881) |
| `pr_subscribers` | 8[10216,23789,23793,27612,...] | 13[23028,23044,23413,...] | 6[10920,25963,25975,25983,...] | 6[25716,25923,25939,...] | Admin (10216) ; member portal newsletter signup writes (10920) |
| `pr_templates` | 5[10283,27921,27930,27938,...] | 2[27898,27944] | 4[26237,26246,26254,26260] | 2[26214,26260] | Admin (10283) / member legacy (26237) |
| `project_files` | 3[18648,18685,18713] | 5[18662,18706,18713,...] | 3[19390,19427,19455] | 4[19404,19448,19455,...] | Admin (18648) / member (19390) parallel |
| `project_folders` | 3[18635,18650,18652] | 5[18622,18644,18652,...] | 3[19377,19392,19394] | 5[19364,19386,19394,...] | Admin (18635) / member (19377) parallel |
| `project_settings` | 7[4119,17999,18002,18019,...] | 11[1656,2083,4117,...] | 6[7237,19004,19007,19024,...] | 5[7235,18981,19002,...] | Admin (4119+) / member (7237) parallel |
| `project_status` | 3[6368,11777,11788] | 10[1656,2073,6367,...] | 1[10484] | 3[10483,12076,14063] | Admin PUT /api/admin/project-status/:key (11770) -> member project cards (10483) AND website /api/public/status |
| `project_tasks` | 11[9010,10021,12174,12189,...] | 18[1577,12161,12183,...] | 5[10733,19111,19121,19180,...] | 10[19048,19064,19065,...] | Admin task engine (9010+); member portal parallel routes (10733) |
| `project_timeline_events` | 3[18574,18588,18596] | 4[18554,18562,18585,...] | 4[19305,19319,19331,19338] | 5[19285,19293,19316,...] | Admin (18574) / member (19305) parallel |
| `promo_codes` | 10[8679,8714,11205,19210,...] | 24[8677,11181,11202,...] | 9[8866,10582,12439,19876,...] | 11[5759,5762,5893,...] | Admin creates/edits codes (8679+) -> member validates at checkout (/api/plexus/promo/validate, user 5759+) |
| `push_outbox` | 4[22968,34343,39200,41860] | - | 2[218,288] | 1[205] | Admin enqueues (22968, 34343, 39200, 41860) -> USER portal drainPushOutbox (200) sends Web Push to member devices |
| `question_upvotes` | 2[19474,19476] | 5[19425,19472,19474,...] | 2[21883,21885] | 7[21834,21881,21883,...] | Member upvotes (21883); admin reads ranking (19425+) |
| `refund_requests` | 6[10727,10728,19312,20376,...] | 4[10718,18140,20154,...] | 2[21586,22547] | 2[22437,22568] | Member submits refund request (21586); admin decides (10727+) -> member sees status (22437) |
| `registrant_notes` | 1[12595] | 1[12581] | - | - | Admin notes (12595) |
| `registration_details` | 1[19234] | 1[19267] | 1[21404] | 1[21520] | Per-registration extras (dietary etc.). Admin edits (19234) -> member sees in My Pass / registration detail (21520) |
| `registration_links` | 4[31009,31037,36271,36337] | 2[36313,36314] | 5[20749,20918,28374,28785,...] | 7[1299,3651,5731,...] | Admin POST /api/admin/registration-links (36277) creates token rows -> member /plexus/:token chooser and /invite/:data landing read the row by token (user 1299+) and count uses at checkout |
| `registration_transfers` | 4[10739,19297,21400,21452] | 3[20406,21381,21449] | 1[21565] | 2[21556,22577] | Member requests a ticket transfer (21565); admin approves (21410) -> both parties emailed via outbox, member's registration owner changes |
| `registrations` | 15[4751,8788,11221,18880,...] | 115[1440,1458,1604,...] | 16[12453,12893,13353,19596,...] | 70[2932,2945,4121,...] | Conference registrations. Admin: mark paid (finance confirm), check-in/undo, transfer approve, ticket revoke, QR regenerate -> member #plexus My Pass shows status / payment_status / checked_in / QR; member creates via /api/registrations + /api/plexus/register/* |
| `resources` | - | 2[11741,19797] | - | 2[13845,22254] | Read by both (admin /api/conferences/:confId/resources; member 13845) |
| `review_criteria` | - | - | - | - | DDL only in both |
| `reward_redemptions` | - | 3[35052,35062,35171] | 1[26404] | 1[5888] | Member redeems (26404); admin reads (35052) |
| `rewards_history` | - | 1[11333] | - | - | Admin reads (11333); member DDL only |
| `rewards_settings` | 5[6352,30700,35104,35117,...] | 3[30684,35020,37585] | 2[2408,10373] | 2[2405,5802] | Admin sets rewards config (6352+) -> member rewards catalog (2405) |
| `scheduled_emails` | 58[1933,2352,2522,2793,...] | 19[1912,1914,2830,...] | 10[11380,12825,12931,16878,...] | 3[16784,29351,29521] | Admin outbox (58 writers) drained by admin drainScheduledEmails (43350) -> Brevo; member portal also stages rows (10 writers, e.g. invites) and reads 3 |
| `scholarship_applications` | 5[10735,10736,19325,21364,...] | 3[18141,20153,20403] | 1[21599] | 2[22436,22574] | Member applies (21599); admin decides (10735+) -> status visible to member (22436) |
| `seat_confirmations` | 5[2498,2528,2529,2577,...] | 6[2462,2489,2494,...] | - | - | Admin-only seat-confirmation round (2498+) -> member receives confirm links resolving on the admin origin |
| `sequence_steps` | 11[10043,10062,10080,10097,...] | 7[18359,18370,18439,...] | 4[19233,19255,19260,19274] | 5[19207,19218,19247,...] | Admin (10043) / member (19233) |
| `session_attendance` | - | - | - | 1[13247] | Member reads own attendance (13247); no admin R/W |
| `session_polls` | 2[20347,20349] | 3[19430,19545,20357] | 2[22518,22520] | 3[21839,21994,22528] | Admin creates polls (20347); member answers (21999 poll_responses) -> live results |
| `session_questions` | 5[11586,19464,19516,19525,...] | 5[11592,19426,19492,...] | 6[13782,21873,21926,21963,...] | 6[13788,21835,21902,...] | Member asks (13782, Live Q&A); admin answers/hides via USER-portal admin routes cross-origin (user 21957/21970) and admin-portal copies (11586) |
| `session_ratings` | 2[19566,19569] | 2[19563,22698] | 2[22015,22018] | 1[22012] | Member rates sessions (22015); admin reads (19563) |
| `session_tracks` | - | 1[19406] | - | 1[21726] | Read by both for schedule grouping |
| `sessions` | 20[8726,8728,8730,8734,...] | 24[11553,11557,19402,...] | 9[10594,10596,10598,19647,...] | 16[4647,4648,5192,...] | Admin CRUD/publish sessions (20183-20267) -> member schedule tab + website; member writes only via check-in/polls (10594+) |
| `signup_form_responses` | 4[30819,30848,30864,32884] | 15[18110,30670,30671,...] | 3[27254,29275,29318] | 9[2374,4124,13086,...] | Public submits on member portal /f/:slug (27254); admin lists/exports/check-in (18110+, 30819) |
| `signup_forms` | 4[30722,30779,30789,30820] | 13[30602,30711,30726,...] | - | 10[2351,2352,2365,...] | Admin creates public sign-up forms (30722) -> member-portal page /f/:slug (2351+) renders them |
| `speaker_applications` | 5[10742,10743,19744,22834,...] | 3[18142,20408,22824] | 1[22197] | 1[22579] | Member applies to speak (22197); admin decides (10742+) -> status (22579) |
| `speaker_documents` | - | 3[29916,29930,29948] | 3[28009,28013,28037] | 5[27980,28003,28009,...] | Speaker uploads via member portal (28009); admin reads/downloads (29916) |
| `speaker_itineraries` | 7[22148,22174,22196,22204,...] | 11[22124,22130,22159,...] | - | 1[4508] | Admin composes + sends itinerary (22148+) -> member/speaker /speaker/:token page (4508) |
| `speaker_itinerary_items` | 3[22228,22249,22264] | 8[22070,22132,22214,...] | - | 1[4677] | Itinerary rows (admin 22228) -> rendered on /speaker/:token (4677) |
| `speakers` | 16[6328,8721,20296,20452,...] | 43[2077,6328,11580,...] | 9[10334,10589,22473,22623,...] | 23[4629,4630,4636,...] | Admin CRUD/publish/invite speakers (20290-21026) -> member Speakers tab, speaker portal (?section=speaker&code=), website /api/public/site speakers[] |
| `sponsor_leads` | - | - | - | - | DDL only in both |
| `sponsor_materials` | - | - | - | - | DDL only in both |
| `sponsor_tasks` | 6[1424,21164,21227,21237,...] | 7[1422,1691,21164,...] | 5[22822,22846,22856,22859,...] | 3[22822,22838,22868] | Sponsor benefit checklist: admin writes (1424+); member portal has parallel writes (22822) but no member-facing surface |
| `sponsors` | 8[8821,21135,21151,21154,...] | 21[1441,1692,1718,...] | 6[8741,8751,22804,22814,...] | 6[8739,12145,13839,...] | Admin CRUD/publish sponsors (21128-21171) -> member Sponsors tab + website /api/public/supporters groups[] |
| `submission_pipeline` | 2[15006,15012] | 10[5768,14096,14136,...] | 4[16814,16817,16843,16898] | 4[16774,16810,16830,...] | Admin pipeline stages (15006) ; member (16814) -> applicant status |
| `survey_responses` | 1[19841] | 2[19831,19838] | 1[22343] | 2[22333,22340] | Member answers (22343); admin reads (19831) |
| `surveys` | - | 1[19828] | - | 1[22330] | Read by both; survey definitions |
| `talks` | 3[12502,12515,12531] | 4[12495,12512,12529,...] | 5[10445,10466,14182,14195,...] | 9[10444,10465,13552,...] | Admin CRUD talks (12498-12511) -> member Talks section /api/talks (14007); member rates talks (talk_ratings) |
| `task_files` | 2[18303,18321] | 4[18233,18236,18313,...] | 2[19151,19169] | 4[19081,19084,19161,...] | Admin (18303) / member (19151) |
| `task_sequences` | 9[10031,10049,10068,10086,...] | 5[18352,18354,18367,...] | 4[19227,19261,19265,19275] | 5[19200,19202,19215,...] | Admin (10031) / member (19227) |
| `team_members` | 5[8921,8981,9028,17225,...] | 52[1578,1693,1918,...] | 4[10641,10719,10751,18682] | 21[10704,10847,10848,...] | Admin team roster (8921) -> member Team page (10704) |
| `template_library` | 1[10707] | - | - | - | Admin (10707) |
| `testimonials` | 5[21620,21675,21682,21701,...] | 9[21614,21648,21670,...] | - | - | Admin harvest/publish (21620); member DDL only |
| `ticket_transfer_audit` | 3[21403,21405,21454] | - | 1[21571] | - | Audit rows written by both sides on transfer; no member-visible surface |
| `ticket_types` | 11[8569,8710,11063,11083,...] | 39[1038,8756,11060,...] | 4[10578,12457,19901,21412] | 38[2932,3714,5619,...] | Admin ticket/pricing edits (conferences/:confId/tickets, plexus/settings) -> member checkout price + /api/plexus/settings, website /api/public/site price.* |
| `user_notifications` | 5[16981,22925,22983,38695,...] | 4[11631,22936,22943,...] | 10[11156,15013,15036,16019,...] | 4[11156,23057,23067,...] | Admin send/publish (16981, 22925, 38695, 43379) -> member /api/user-notifications (23054) + bell |
| `user_profiles` | 1[19171] | 2[19586,19611] | 2[11160,21338] | 4[11160,13518,22035,...] | Admin edits (19171); member profile (11160) |
| `users` | 21[8852,8868,8884,8895,...] | 166[1072,1093,1105,...] | 28[4224,10612,10622,10634,...] | 197[211,269,273,...] | ONE table for staff AND members (is_admin/is_staff/is_founder flags). Admin Team Access invite/grant/revoke/permissions (35210-35398) + boot seeds/founder recovery (8865-8890) change who can sign in where; a member row edited by admin (profile, must_change_password) changes that member's login/profile on the member portal |
| `venue_rooms` | 3[34660,34674,34684] | 4[19407,34652,34668,...] | - | 1[21727] | Admin rooms (34660) -> member schedule room labels (21727) |
| `vip_passes` | 5[22398,22433,22442,22451,...] | 10[22379,22384,22409,...] | 1[5377] | 1[5168] | Admin issues VIP passes (22398+) -> member /pass/:token page (5168, 5377) |
| `visa_requests` | 6[10731,10732,19689,20385,...] | 3[18139,20155,20400] | 2[22141,22556] | 2[22438,22571] | Member submits visa letter request (22141); admin processes (10731+) -> member sees status (22438) |
| `volunteer_assignments` | - | 2[19730,21268] | - | 2[22183,22887] | Read by both; assignment shows in member volunteer view |
| `volunteer_shifts` | 1[20313] | 2[19729,21269] | 1[22490] | 2[22182,22888] | Admin defines shifts (20313); member picks (22490) |
| `volunteers` | 5[8836,19714,20336,21322,...] | 5[19710,19723,20327,...] | 4[22167,22507,22926,22933] | 4[22163,22176,22500,...] | Member volunteer application (22167); admin approve/reject (8836+) -> member sees status |
| `waitlist` | 1[19282] | 1[19277] | 1[21535] | 1[21530] | Member joins waitlist (21535); admin reads/offers (19277+) -> member gets claim link |
| `waitlist_offers` | 4[2548,2592,39081,39087] | 5[2543,2589,39037,...] | - | - | Admin-only writes (2548+): offers with claim_token -> member claims through admin-hosted /api/public/claim-seat which redirects to member /plexus?claim=<token> |

**Cross-side deletes.** `demo-purge.js` (wired at admin server.js:43253, runs on every production boot: `RENDER` or `NODE_ENV=production`, :111) deletes seed rows by exact identifier from member-owned tables too — `feed_items`, `opportunities`, `talks`, `accelerator_sites`, `mentorship_profiles`, `forum_*`, `sessions`, `sponsors`, `volunteers`, `team_members`, `project_tasks`, all `finance_*` ledgers (`'1=1'`), `pr_*` — after copying victims into `_purged_<table>` (:117–125). It deliberately skips `gala_registrations`, `croatians_abroad_registrations`, `content_blocks`, `speakers`, `page_views`, and Bridges events (:7–9, :86–89).

### 2d. Guards: SCHEMA-MIRROR and the API contract

- `bash scripts/check-schema-sync.sh` → `OK: schema mirror block is byte-identical across both portals (527 lines).` Markers: admin server.js:4154 → :4680, user server.js:9316 → :9842; md5 of both blocks `9d76c0f0138ae087cb07bb47a6b9cd32`. The script diffs the inclusive BEGIN…END region (extract() :35–41) and exits 1 on any difference.
- Many shared tables are declared OUTSIDE the mirror "identically by hand" (comments at admin :3163, :3318, :4758, :5832, :5916, :6024, :6058, :6288, :8028 and user :6186, :6273, :8505, :9186, :9846, :9969, :10053, :10125, :10159, :10244, :10294) — those are NOT guarded by the script. Examples: `conferences.wallet_class_id` (admin :3164 / user :6186), speaker itineraries (admin :6237 / user :10244), the unified check-in/wallet columns (user :9186).
- `node scripts/check-api-contract.js` → `OK: every frontend /api call has a matching backend route.` It extracts `app.<verb>('/api/…')` routes from each server.js and every `fetch(`/`.api(`/`api(` call in the SPA + the server's inline template pages, normalises `${…}` and concatenated tails to wildcards, and fails CI on any unmatched call (:35–101). It does NOT check cross-origin calls (they are same-string `/api/…` paths and happen to exist on the other server) and the allowlist file `scripts/api-contract-allowlist.txt` it reads (:27–32) does not exist in the repo (`ls scripts/` = `check-api-contract.js`, `check-schema-sync.sh`, `stamp-sw.sh`).

### 2e. Notifications: bell, Web Push, outbox

**Member actions that ring the ADMIN bell** (`admin_notifications`, read by admin `GET /api/notifications` :22850, marked read :22859): user server.js has exactly two writers — `POST /api/gala/register` (user :26886–26892: one row per `users.is_admin=1`, type `gala_request`, project `gala`) and the monthly project-reminder cron `checkAndSendMonthlyReminders` (user :22991). Admin-side writers of its own bell: `POST /api/sequences` (:18400), `POST /api/sequences/:seqId/steps/:stepId/complete` (:18481), its own monthly cron (:22900). Everything else members do reaches admins through the **Action Center** scan (`runNagScan` :1838, `nagCollectDesired` :1569+), which reads `registrations`, `gala_registrations`, `sponsors`, `sponsor_tasks`, `project_tasks`, `direct_messages`, `forum_considerations`, `forum_candidates`, `event_campaign_invitees`, `pr_newsletters`, `pr_content_calendar`, `planner_plans`, `users` (FROM-table census of :1297–1838) and writes `nag_items`.

**Admin actions that notify MEMBERS:**

| Admin trigger | Rows written | Member delivery |
|---|---|---|
| `POST /api/admin/notifications/send` :22948 (`createUserNotification` :22925) | `user_notifications` (+ `push_outbox` :22968 when push requested) | `GET /api/user-notifications` (user :23054), `GET /api/bell-feed` (user :23099), Web Push via user `drainPushOutbox` (:200–218) |
| `PUT /api/admin/forum/events/:id/publish` :16981 | `user_notifications` | same |
| `POST /api/admin/outbox/:batch/approve` :38695, `drainScheduledEmails` :43379 | `user_notifications` mirror of approved emails | same |
| `POST /api/admin/messages` :34343 | `direct_messages` + `push_outbox` | member inbox `GET /api/messages` (user :26775) + push |
| `POST /api/admin/nag/items/:id/act` :39200 | `push_outbox` | push |
| `runStaffStaleScan` :41860 | `push_outbox` | push (staff devices) |
| `POST /api/admin/member-announcements` :11997 | `member_announcements` (push=1 fans out on the member side, user :252–288) | bell-feed with `audience_scope` gating (user :263+) |
| `POST /api/admin/announcements` :18988 | `announcements` | `GET /api/announcements` (user :23211) + bell |
| 58 outbox writers (list in §1 purposes; e.g. gala approve, transfer approve, guest-pass send, speaker-kit send, newsletters, forum/event campaigns) | `scheduled_emails` (`pending_approval` → approved) | drained ONLY by the admin's own `drainScheduledEmails` (:43350) → Brevo; the member portal stages 10 kinds of its own rows (user :11380+) and has a dev-only drainer (user :29517) |

The admin holds no VAPID keys and no `web-push` dependency (no `require('web-push')`, no `VAPID_*` env in admin code); Web Push is entirely the member service's job (`VAPID_*` only in the `medx-user-portal` block of `render.yaml`:32–37).

**Latent defect.** `server.js:15819` (inside `POST /api/accelerator/years/:year/publish-rankings`, `rankedApps.forEach`) inserts into `notifications` — a table neither backend creates (the created names are `user_notifications`, `admin_notifications`, `forum_notifications`). The insert is wrapped in try/catch, so applicants are never notified of published rankings and no error surfaces.

## 3. ADMIN → WEBSITE (medx.hr on Netlify)

### 3.1 What the website actually fetches

`site.js` (live mirror, lines 957–962, 988–994) hard-codes two origins: `PORTAL = https://medx-user-portal.onrender.com` and `ADMIN = https://medx-admin-portal.onrender.com` (localhost:3001 / :3002 in dev). Every page calls `PORTAL/api/public/site`, `PORTAL/api/public/content`, `PORTAL/api/public/status`; pages hosting a `[data-medx-list="press:releases"]` add `ADMIN/api/public/press`; pages hosting `[data-medx-list="supporters:wall"]` add `PORTAL/api/public/supporters` (4.5 s timeout, fail-soft, SWR cache `medx_live_cache`). The comment at site.js:960–961 states the split: "The press composer publishes from the admin portal, which serves /api/public/press … Site + status + content still come from the user PORTAL."

So the ONLY admin-origin endpoint the website reads is `/api/public/press` (and the `/api/public/press/:slug` release pages it links to). Everything else the admin changes reaches the website **through the shared database and the MEMBER portal's public handlers**.

### 3.2 Public routes the admin backend exposes (all under the `/api/public` CORS allowlist, server.js:868–873, or unauthenticated pages)

| Route (HEAD line) | Limiter | Response shape (exact field names) |
|---|---|---|
| `GET /api/public/press` (:11859) | `publicLimiter` | `{ releases: [{ lang:'en'\|'hr', tag, title, summary, date:'YYYY-MM-DD', datetime, date_label, url:'<seatPublicBase>/api/public/press/<slug>' }], generated_at }`; reads `press_releases WHERE status='published'` ordered by `COALESCE(dateline_date, published_at)`; `Cache-Control: public, max-age=60, stale-while-revalidate=300` (`publicCacheHeaders`); on any error `{ releases: [] }` |
| `GET /api/public/press/:slug` (:11884) | `publicLimiter` | site-styled HTML page (`pressReleaseHtml(row,{web:true})`), 404 HTML when unpublished; `max-age=120, swr=600`; newsroom back-link = `SITE_PUBLIC_URL || https://medx.hr` + `/press.html` or `/hr/press.html` (:28123–28124) |
| `GET /api/public/content[?page=]` (:11818) | `publicLimiter` | `{ blocks: { <block_key>: { type, body, updated_at } }, generated_at }` from `content_blocks WHERE is_published=1` — NOTE: no `body_hr` (the member-portal twin at user :12045 returns `body_hr` too, and that is the one the site reads) |
| `GET /api/public/status` (:11837) | `publicLimiter` | `{ projects: [{ project_key, status_label, status_kind, detail_line, cta_label, cta_target, updated_at }], generated_at }` ordered plexus, gala, accelerator, forum, bridges — NOTE: no `_hr` fields (member twin user :12072 has them) |
| `GET /api/public/confirm-seat` (:39045), `GET /api/public/claim-seat` (:39062), `GET /api/public/feedback` (:39098) | `publicLimiter` | HTML result pages for emailed tokens (seat confirmations, waitlist offers, NPS taps) |
| `GET /api/public/auction/:token/state` (:31609), `POST …/bid` (:31617) | none / `auctionBidLimiter` | `{ ok, … }` live auction state for the guest page `GET /a/:token` (:31645) |
| `POST /api/public/newsletter/subscribe` (:23777), `GET /newsletter` (:23770) | `publicLimiter` | newsletter signup (writes `pr_subscribers`) |
| `POST /api/public/register-invite` (:19981) | none | invite-link registration (creates `users` + `registrations` rows) |
| `GET /api/public/testimonial` (:21647), `GET /api/public/testimonial/submit` (:21669) | `publicLimiter` | testimonial harvest pages |
| `GET /api/org/signature` (:38423) | none | `{ signature }` PNG data for email footers |
| `GET /api/app-install-qr.png` (:42072) | none | PNG QR pointing at `ADMIN_PORTAL_URL/?track=1` (:41858) |
| `GET /api/portal-content/published[/:section]` (:33944, :33950) | none | published `portal_content` rows (member portal has the same two routes at user :28088/:28094) |
| `GET /api/conferences`, `/active`, `/:slug`, `/:confId/{tickets,schedule,speakers,announcements,sponsors,resources}` (:11011–11740), `GET /api/plexus/{conference,schedule,sessions/:id,speakers,sponsors,announcements,posters,photos,resources,hotels}` (:19105–19795), `GET /api/sessions/:sessionId/questions` (:11591), `GET /api/accelerator/{program,institutions,countdown}` (:13034–13052), `GET /api/applicant/programs` (:24363) | none | member-facing reads duplicated on the admin origin (legacy of a single-server past); not used by `site.js` |
| `GET /evaluate` (:24551), `GET /review` (:24377), `GET /apply` (:24908), `GET /e/:token` (:31136), `GET /a/:token` (:31645), `GET /health` (:43169), `GET *` SPA fallback (:43296) | none | HTML pages |

`SITE_PUBLIC_URL` is read once (server.js:28123, press page newsroom link, default `https://medx.hr`). `FORUM_SITE_URL` is read once (:39820, `forumSiteUrl()`, default `https://medx.hr/biomedical-forum.html`, used in forum campaign emails). Other literal website links: email footer "Website" `https://medx.hr` (:248), newsletter/combo page footers (:23742, :31083), post-event photos placeholder (:2705), gala sponsor brochure `https://medx-website-preview.netlify.app/plexus-gala-sponsor.pdf` (:29092).

### 3.3 The CONTENT CHAIN — admin screen → table → member public handler → site.js hook

| Website hook (site.js / HTML) | Member public handler (user server.js) | Table(s) read | Admin route(s) that write the table (admin server.js) | Admin screen |
|---|---|---|---|---|
| `data-medx-slot="site:conference.date_range \| end_date \| keynote_count_word"`, `site:price.current`, `data-medx-cta="register"` ← `site.conference.registration_open`, `data-medx-reg` deep links ← `site.conference.pricing_phase`, countdown/JSON-LD dates | `GET /api/public/site` (:11943–12045): `conference.{name,year,slug,description,start_date,end_date,date_range,venue_*,registration_open,early_bird_deadline,regular_deadline,pricing_phase,keynote_count,keynote_count_word[_hr]}`, `price.{early_bird,regular,late,current,currency}`, `deadline.{early_bird,regular}`, `speakers[]`, `generated_at` | `conferences` (active row), `ticket_types`, `speakers` (confirmed+published), `gala_settings` | conferences: `POST /api/admin/conferences` :11027, `PUT …/:id` :11120, `POST …/:id/activate` :11139, `PUT /api/admin/plexus/settings` :34551; tickets: `PUT …/:confId/tickets/:ticketId` :11077, `POST …/:confId/tickets` :11096, `POST …/:id/clone-tickets` :11054; gala prices: `PUT /api/admin/gala/settings` :30009 | Conferences · Plexus → Settings · Gala → Settings |
| `data-medx-list="site:speakers"` rows bound by `data-mx-field="name\|title\|institution\|talk_title\|photo_url"`, `data-mx-keynote`, `data-medx-fallback="speakers"` | same `/api/public/site` → `speakers[] = { name, title, institution, photo_url, talk_title, is_keynote, sort_order }` (`is_confirmed=1` + published) | `speakers` | `POST /api/admin/plexus/speakers` :20290, `PUT …/:id` :20437, `PUT …/:id/publish` :20844, `POST …/import` :20888, `POST …/invite` :20936, `DELETE …/:id` :20485 | Plexus → Speakers |
| `data-medx-slot="content:plexus.announcement \| gala.announcement \| accelerator.announcement \| bridges.announcement \| homepage.news_banner"`, `data-medx-strip` | `GET /api/public/content` (:12045): `blocks[key] = { type, body, body_hr, updated_at }` (published only) | `content_blocks` | `PUT /api/admin/content-blocks/:key` :11940 (whitelist of seeded keys, sanitized by `block_type`, audited) | Marketing & Content → Website content |
| `data-medx-slot="status:{plexus,gala,accelerator,bridges}.status_label \| detail_line"`, `data-medx-status-cta/dot/statusbar` | `GET /api/public/status` (:12072): `projects[] = { project_key, status_label, status_kind, detail_line, cta_label, cta_target, *_hr }` | `project_status` | `PUT /api/admin/project-status/:key` :11770 | Home → project cards (status editor) |
| `data-medx-list="supporters:wall"` + `data-sup-tile/name/group/label/grid/logos-only/more` | `GET /api/public/supporters` (:12141): `groups[] = { key, label_en, label_hr, items[] = { name, logo (absolute), website } }` for categories public-body / company … | `sponsors` (published) | `POST /api/admin/plexus/sponsors` :21128, `PUT …/:id` :21147, `PUT …/:id/publish` :21171, `DELETE …/:id` :21163 | Plexus → Sponsors |
| `data-medx-list="press:releases"` rows: `data-mx-date/tag/title/summary/url` | **admin** `GET /api/public/press` (:11859) | `press_releases` (admin-only table) | `POST /api/pr/press-releases` :28264, `PUT …/:id` :28298, `POST …/:id/publish` :28326, `…/unpublish` :28338, `DELETE` :28348, AI draft `POST …/draft` :28213 | Marketing & Content → Press composer |
| impact counters (`/api/public/impact`, not wired in the live `site.js` mirror — no `data-medx-slot="impact:…"` found) | `GET /api/public/impact` (:12096): `{ members, countries, registrations, events, speakers, charity_giving, generated_at }` | `users`, `registrations`, `gala_registrations`, `bridges_registrations`, `croatians_abroad_registrations`, `forum_event_registrations`, `conferences`, `bridges_events`, `forum_events`, `speakers`, `auction_items` | every registration/check-in route; Bridges/Forum event CRUD (`/api/bridges/events*` :29762+, `/api/admin/forum/events*` :16981+); auctions (`/api/admin/auctions/*`) | many |
| key dates (accelerator) — website has no live slot; served for the member portal | `GET /api/accelerator/key-dates` (:23252) | `accelerator_key_dates` | `POST /api/accelerator/years/:year/dates`, `PUT /api/accelerator/dates/:id`, `DELETE …` (admin `/api/accelerator/*`) | Accelerator → Key dates |
| sessions / schedule — website has no live slot | `/api/plexus/schedule` (member) | `sessions`, `session_tracks`, `venue_rooms` | `POST /api/admin/plexus/sessions` :20183, `PUT …/:id` :20216, `…/publish` :20250, `bulk-publish` :20267, `DELETE` :20239; rooms `POST /api/admin/plexus/rooms` (:34660) | Plexus → Programme |
| events (Bridges / Forum) — website links are static | `/api/bridges/events` (:16420), `/api/forum/events` (:17335) | `bridges_events`, `forum_events` | `POST/PUT/DELETE /api/bridges/events*` (:29762 area), `…/publish`; `POST/PUT/DELETE /api/admin/forum/events*` | Bridges · Forum |
| team — website team page is static | `team_members` read by member (user :10704) | `team_members` | `POST/PUT/DELETE /api/admin/team/*` (:35210–35398 for access; roster routes under `/api/admin/team`) | Team Access |
| org signature in emails/site footer | `/api/public/content` also returns `{ signature }` via `org_settings` (user :12067) | `org_settings` | `POST /api/admin/org/signature` :38426, `…/delete` :38441 | Settings → Signature |

Two field-shape mismatches to keep in mind: the admin-origin `/api/public/content` and `/status` omit the `_hr` fields the site's `/hr/` pages need — harmless today only because `site.js` reads the member-origin copies.

## 4. ADMIN FRONTEND — `admin-portal/frontend/index.html` (59,533 lines) + `sw.js`

### 4.1 API surface called by the SPA

844 call sites (`fetch(`, `.api(`, `api(`) hit **517 distinct `/api/…` paths** (template `${…}` segments normalised to `:p`). `scripts/check-api-contract.js` confirms every one has a route. Heaviest families: `/api/admin/plexus/*` (58 paths), `/api/admin/forum/*` (38), `/api/admin/review/*` (17), `/api/admin/gala/*` (14), `/api/admin/outbox/*` (12), `/api/admin/checkin/*` (10), `/api/accelerator/years/*` (10), `/api/admin/content/*` (9), `/api/finance/reconcile/*` (7), `/api/admin/tech/*` (7), `/api/admin/staff-tracking/*` (7), `/api/admin/nag/*` (7).

The "triggering section/button" is recorded as the nearest enclosing module object (the SPA is organised as `const XxxApp = { … }` singletons; `App` is the shell/boot, `STATE` the dashboard widgets). Call-site counts per module: App 125, STATE 52, FinanceApp 36, PRApp 33, AcceleratorApp 29, ReviewEngine 17, PostEventEngine 15, GalaAdmin 13, BridgesApp 13, TeamChat 9, TechApp 7, TeamApp 7, StaffTracking 7, SeatConfirmAdmin 7, PrintSuite 7, NetworkApp 7, SurveyAdmin 6, SignupFormsApp 6, ProjectHome 6, FeedAdmin 6, EventInvitesApp 6, NewsletterApp 5, GuestPassApp 5, CouncilInvites 5, ContentCreator 5, AdvisoryBoard 5, VideoStudio 4, StaffShare 4, QAAdmin 4, PostEventAdmin 4, PortalContentApp 4, Planner 4, NLComposer 4, GameDay 4, CroatiansAbroadAdmin 4, ConfApp 4, WaitlistAdmin 3, UserNotifApp 3, TransparencyAdmin 3, SignageStudio 3, PlexusSettingsAdmin 3, PendingOutbox 3, OrgSignature 3, GameDaySettings 3, FilesApp 3, EventCheckin 3, DigestApp 3, CalendarApp 3, BulkSelect 3, BulkApp 3, AuctionAdmin 3, App2 3, ResearchApp 2, RemindersApp 2, LiveOverview 2, HealthApp 2, GuestPassAdmin 2, EditionsAdmin 2, ContentChecklist 2 (+ smaller ones). Full list (560 distinct path×module pairs):

| API path (admin frontend) | triggering module object |
|---|---|
| `/api/accelerator/applications` | AcceleratorApp |
| `/api/accelerator/applications/:p/documents` | AcceleratorApp |
| `/api/accelerator/applications/:p/evaluate-batch` | AcceleratorApp |
| `/api/accelerator/applications/:p/full` | AcceleratorApp |
| `/api/accelerator/applications/:p/message` | AcceleratorApp |
| `/api/accelerator/applications/:p/validity` | AcceleratorApp |
| `/api/accelerator/criteria/:p` | AcceleratorApp |
| `/api/accelerator/dates/:p` | AcceleratorApp |
| `/api/accelerator/files/grouped` | AcceleratorApp |
| `/api/accelerator/form-config` | AcceleratorApp |
| `/api/accelerator/institutions` | AcceleratorApp |
| `/api/accelerator/institutions/:p` | AcceleratorApp |
| `/api/accelerator/interviewers/:p` | AcceleratorApp |
| `/api/accelerator/interviewers/:p/assignments` | AcceleratorApp |
| `/api/accelerator/interviewers/:p/regenerate-token` | AcceleratorApp |
| `/api/accelerator/interviewers/:p/send-link` | AcceleratorApp |
| `/api/accelerator/registrations` | AcceleratorApp |
| `/api/accelerator/years` | AcceleratorApp |
| `/api/accelerator/years/:p/applications` | AcceleratorApp |
| `/api/accelerator/years/:p/criteria` | AcceleratorApp |
| `/api/accelerator/years/:p/dates` | AcceleratorApp |
| `/api/accelerator/years/:p/institutions` | AcceleratorApp |
| `/api/accelerator/years/:p/institutions/:p` | AcceleratorApp |
| `/api/accelerator/years/:p/interviewers` | AcceleratorApp |
| `/api/accelerator/years/:p/pdf-settings` | AcceleratorApp |
| `/api/accelerator/years/:p/publish-rankings` | AcceleratorApp |
| `/api/accelerator/years/:p/update-rankings` | AcceleratorApp |
| `/api/admin/accelerator/analytics` | ProjectHome |
| `/api/admin/accelerator/overview-config` | AcceleratorApp |
| `/api/admin/accelerator/result-codes` | AcceleratorApp |
| `/api/admin/advisors/` | AdvisoryBoard |
| `/api/admin/advisors/ask` | AdvisoryBoard |
| `/api/admin/advisors/latest` | AdvisoryBoard |
| `/api/admin/advisors/questions` | AdvisoryBoard |
| `/api/admin/advisors/run/` | AdvisoryBoard |
| `/api/admin/analytics` | App |
| `/api/admin/assistant` | App |
| `/api/admin/assistant/execute` | App |
| `/api/admin/auctions` | AuctionAdmin |
| `/api/admin/auctions/` | AuctionAdmin |
| `/api/admin/audit-log` | AuditApp |
| `/api/admin/bridges/checkin` | App |
| `/api/admin/bulk-email/preview` | BulkApp |
| `/api/admin/bulk-email/send` | BulkApp |
| `/api/admin/bulk-email/test` | BulkApp |
| `/api/admin/cards/roster` | CardStudio |
| `/api/admin/cards/send` | CardStudio |
| `/api/admin/change-map` | ChangeMap |
| `/api/admin/checkin/enrich` | STATE |
| `/api/admin/checkin/events` | EventCheckin |
| `/api/admin/checkin/lookup` | STATE |
| `/api/admin/checkin/ticket` | App |
| `/api/admin/checkin/ticket` | EventCheckin |
| `/api/admin/checkin/ticket` | STATE |
| `/api/admin/checkin/verify` | ? |
| `/api/admin/checkin/verify` | App |
| `/api/admin/checkin/verify` | EventCheckin |
| `/api/admin/checkin/verify` | STATE |
| `/api/admin/cme/events` | CmeAdmin |
| `/api/admin/cme/events/` | CmeAdmin |
| `/api/admin/conferences` | ConfApp |
| `/api/admin/conferences/` | ConfApp |
| `/api/admin/content-checklist` | ContentChecklist |
| `/api/admin/content-checklist/` | ContentChecklist |
| `/api/admin/content/asset` | ContentCreator |
| `/api/admin/content/asset` | VideoStudio |
| `/api/admin/content/assets` | ContentCreator |
| `/api/admin/content/converse` | ContentCreator |
| `/api/admin/content/pending-brief` | ContentStudio |
| `/api/admin/content/schedule` | ContentCreator |
| `/api/admin/content/schedule` | VideoStudio |
| `/api/admin/content/video/compose` | VideoStudio |
| `/api/admin/content/video/prefill` | VideoStudio |
| `/api/admin/council/asset` | CouncilInvites |
| `/api/admin/council/delete` | CouncilInvites |
| `/api/admin/council/list` | CouncilInvites |
| `/api/admin/council/save` | CouncilInvites |
| `/api/admin/council/send` | CouncilInvites |
| `/api/admin/coupons` | App |
| `/api/admin/coupons/:p` | App |
| `/api/admin/croatians-abroad/emails-by-event/:p` | CroatiansAbroadAdmin |
| `/api/admin/croatians-abroad/invite-links` | CroatiansAbroadAdmin |
| `/api/admin/croatians-abroad/invite-links/:p` | CroatiansAbroadAdmin |
| `/api/admin/croatians-abroad/registrations` | CroatiansAbroadAdmin |
| `/api/admin/croatians-abroad/registrations` | LiveOverview |
| `/api/admin/custom-fields` | App |
| `/api/admin/custom-fields/:p` | App |
| `/api/admin/design-assist` | PrintSuite |
| `/api/admin/design-presets` | PrintSuite |
| `/api/admin/design-presets/` | PrintSuite |
| `/api/admin/digest/` | DigestApp |
| `/api/admin/early-bird` | PostEventEngine |
| `/api/admin/early-bird/` | PostEventEngine |
| `/api/admin/editions` | EditionsAdmin |
| `/api/admin/editions/` | EditionsAdmin |
| `/api/admin/event-components` | App |
| `/api/admin/event-components/:p` | App |
| `/api/admin/event-invites/campaigns` | EventInvitesApp |
| `/api/admin/event-invites/campaigns/` | EventInvitesApp |
| `/api/admin/event-invites/catalog` | EventInvitesApp |
| `/api/admin/event-invites/discover` | EventInvitesApp |
| `/api/admin/event-invites/invitees/` | EventInvitesApp |
| `/api/admin/event-invites/reply-templates/` | EventInvitesApp |
| `/api/admin/event-reminders/sequences` | RemindersApp |
| `/api/admin/event-reminders/sequences/` | RemindersApp |
| `/api/admin/event-survey/ai-summary` | SurveyAdmin |
| `/api/admin/event-survey/results` | SurveyAdmin |
| `/api/admin/event-survey/send` | SurveyAdmin |
| `/api/admin/event-survey/settings` | SurveyAdmin |
| `/api/admin/feed-items` | FeedAdmin |
| `/api/admin/feed-items/:p` | FeedAdmin |
| `/api/admin/files` | FilesApp |
| `/api/admin/files/` | FilesApp |
| `/api/admin/files/:p/download` | FilesApp |
| `/api/admin/forum/applications` | STATE |
| `/api/admin/forum/applications/:p` | STATE |
| `/api/admin/forum/campaign` | STATE |
| `/api/admin/forum/campaign/` | STATE |
| `/api/admin/forum/campaign/followup-tick` | STATE |
| `/api/admin/forum/campaign/tick` | STATE |
| `/api/admin/forum/candidates` | ProjectHome |
| `/api/admin/forum/candidates` | STATE |
| `/api/admin/forum/candidates/` | STATE |
| `/api/admin/forum/candidates/dossier/bulk` | STATE |
| `/api/admin/forum/candidates/import` | STATE |
| `/api/admin/forum/candidates/import/commit` | STATE |
| `/api/admin/forum/checkin` | ? |
| `/api/admin/forum/checkin` | App |
| `/api/admin/forum/considerations` | STATE |
| `/api/admin/forum/considerations/` | STATE |
| `/api/admin/forum/convenings` | STATE |
| `/api/admin/forum/events` | App |
| `/api/admin/forum/events` | STATE |
| `/api/admin/forum/events/:p` | STATE |
| `/api/admin/forum/events/:p/checkin` | BulkSelect |
| `/api/admin/forum/events/:p/checkin` | STATE |
| `/api/admin/forum/events/:p/publish` | STATE |
| `/api/admin/forum/events/:p/registrations` | STATE |
| `/api/admin/forum/events/:p/registrations/:p` | STATE |
| `/api/admin/forum/events/:p/schedule` | STATE |
| `/api/admin/forum/events/:p/schedule/:p` | STATE |
| `/api/admin/forum/events/:p/toggle-checkin` | STATE |
| `/api/admin/forum/gala-settings` | STATE |
| `/api/admin/forum/groups` | STATE |
| `/api/admin/forum/groups/:p` | STATE |
| `/api/admin/forum/groups/:p/invite` | STATE |
| `/api/admin/forum/media/folders` | STATE |
| `/api/admin/forum/media/folders/:p` | STATE |
| `/api/admin/forum/members` | STATE |
| `/api/admin/forum/members/:p` | STATE |
| `/api/admin/forum/stats` | ProjectHome |
| `/api/admin/forum/stats` | STATE |
| `/api/admin/gala/guest-message/draft` | GalaAdmin |
| `/api/admin/gala/guest-message/queue` | GalaAdmin |
| `/api/admin/gala/invite-links` | App |
| `/api/admin/gala/invite-links` | GalaAdmin |
| `/api/admin/gala/invite-links/:p` | App |
| `/api/admin/gala/invite-links/:p` | GalaAdmin |
| `/api/admin/gala/menu-options` | GalaAdmin |
| `/api/admin/gala/menu-options/:p` | GalaAdmin |
| `/api/admin/gala/program/notify` | GalaAdmin |
| `/api/admin/gala/registrations` | ProjectHome |
| `/api/admin/gala/seating` | GalaAdmin |
| `/api/admin/gala/settings` | App |
| `/api/admin/gala/settings` | GalaAdmin |
| `/api/admin/gala/who-is-coming` | GalaAdmin |
| `/api/admin/gameday/invites` | GameDaySettings |
| `/api/admin/gameday/invites/` | GameDaySettings |
| `/api/admin/gameday/settings` | GameDaySettings |
| `/api/admin/gameday/status` | GameDay |
| `/api/admin/guest-pass-events` | GuestPassApp |
| `/api/admin/guest-passes` | GuestPassApp |
| `/api/admin/guest-passes/` | GuestPassApp |
| `/api/admin/guest-passes/:p/${revoked ` | GuestPassApp |
| `/api/admin/guest-passes/:p/send` | GuestPassApp |
| `/api/admin/health/test-email` | HealthApp |
| `/api/admin/member-card-toggles` | SignupFormsApp |
| `/api/admin/member-guest-passes` | GuestPassAdmin |
| `/api/admin/member-guest-passes/` | GuestPassAdmin |
| `/api/admin/messages` | App |
| `/api/admin/messages/:p` | App |
| `/api/admin/messages/:p/draft-reply` | App |
| `/api/admin/messages/bulk` | App |
| `/api/admin/nag/digest` | App |
| `/api/admin/nag/items` | App |
| `/api/admin/nag/items/:p/act` | App |
| `/api/admin/nag/items/:p/claim` | App |
| `/api/admin/nag/items/:p/dismiss` | App |
| `/api/admin/nag/items/:p/done` | App |
| `/api/admin/nag/run` | App |
| `/api/admin/newsletter-interests` | NLComposer |
| `/api/admin/newsletter-segments` | NLComposer |
| `/api/admin/newsletter-segments` | NewsletterApp |
| `/api/admin/newsletters` | NewsletterApp |
| `/api/admin/newsletters/:p` | NewsletterApp |
| `/api/admin/newsletters/:p/send` | NewsletterApp |
| `/api/admin/newsletters/auto-generate` | NewsletterApp |
| `/api/admin/notifications/send` | UserNotifApp |
| `/api/admin/notifications/user-notifications` | UserNotifApp |
| `/api/admin/notifications/user-notifications/:p` | UserNotifApp |
| `/api/admin/opportunities` | FeedAdmin |
| `/api/admin/opportunities/:p` | FeedAdmin |
| `/api/admin/org/signature` | OrgSignature |
| `/api/admin/org/signature/delete` | OrgSignature |
| `/api/admin/outbox` | OutboxNav |
| `/api/admin/outbox` | PendingOutbox |
| `/api/admin/outbox` | SeatConfirmAdmin |
| `/api/admin/outbox/:p/approve` | OutboxApproveUI |
| `/api/admin/outbox/:p/approve` | PendingOutbox |
| `/api/admin/outbox/:p/approve` | PostEventAdmin |
| `/api/admin/outbox/:p/approve` | SeatConfirmAdmin |
| `/api/admin/outbox/:p/approve` | SurveyAdmin |
| `/api/admin/outbox/:p/cancel` | PendingOutbox |
| `/api/admin/outbox/:p/cancel` | PostEventAdmin |
| `/api/admin/outbox/:p/cancel` | SeatConfirmAdmin |
| `/api/admin/outbox/:p/cancel` | SurveyAdmin |
| `/api/admin/planner/converse` | Planner |
| `/api/admin/planner/photos` | ContentCreator |
| `/api/admin/planner/photos` | DigestApp |
| `/api/admin/planner/photos` | Planner |
| `/api/admin/planner/plans` | Planner |
| `/api/admin/planner/plans/` | Planner |
| `/api/admin/plexus-experience/registrations` | PlexusRegs |
| `/api/admin/plexus/:p/:p/approve` | STATE |
| `/api/admin/plexus/:p/:p/reject` | STATE |
| `/api/admin/plexus/abstracts` | App |
| `/api/admin/plexus/abstracts/:p/assign-reviewer` | App |
| `/api/admin/plexus/abstracts/:p/decision` | App |
| `/api/admin/plexus/checkin-enabled-sessions` | App |
| `/api/admin/plexus/combo-links` | ComboLinks |
| `/api/admin/plexus/combo-links/` | ComboLinks |
| `/api/admin/plexus/page-text` | App |
| `/api/admin/plexus/page-text` | PlexusPageText |
| `/api/admin/plexus/pending` | STATE |
| `/api/admin/plexus/qa` | QAAdmin |
| `/api/admin/plexus/qa/` | QAAdmin |
| `/api/admin/plexus/qa/ask` | QAAdmin |
| `/api/admin/plexus/recent-checkins` | App |
| `/api/admin/plexus/registrations` | App |
| `/api/admin/plexus/registrations/:p` | App |
| `/api/admin/plexus/rooms` | PlexusSettingsAdmin |
| `/api/admin/plexus/rooms/:p` | PlexusSettingsAdmin |
| `/api/admin/plexus/sessions` | App |
| `/api/admin/plexus/sessions` | SignageStudio |
| `/api/admin/plexus/sessions/:p` | App |
| `/api/admin/plexus/sessions/:p/checkin` | App |
| `/api/admin/plexus/sessions/:p/publish` | App |
| `/api/admin/plexus/sessions/:p/toggle-checkin` | App |
| `/api/admin/plexus/sessions/bulk-publish` | App |
| `/api/admin/plexus/settings` | PlexusSettingsAdmin |
| `/api/admin/plexus/speakers` | App |
| `/api/admin/plexus/speakers` | App2 |
| `/api/admin/plexus/speakers/:p` | App |
| `/api/admin/plexus/speakers/:p/documents` | STATE |
| `/api/admin/plexus/speakers/:p/flight` | App |
| `/api/admin/plexus/speakers/:p/flight/offers/pin` | App |
| `/api/admin/plexus/speakers/:p/flight/quotes` | App |
| `/api/admin/plexus/speakers/:p/flight/quotes/:p` | App |
| `/api/admin/plexus/speakers/:p/flight/quotes/:p/choose` | App |
| `/api/admin/plexus/speakers/:p/flight/search` | App |
| `/api/admin/plexus/speakers/:p/notify` | App |
| `/api/admin/plexus/speakers/:p/publish` | App |
| `/api/admin/plexus/speakers/:p/reinvite` | App |
| `/api/admin/plexus/speakers/:p/send-upload-link` | App |
| `/api/admin/plexus/speakers/documents/summary` | STATE |
| `/api/admin/plexus/speakers/import` | App |
| `/api/admin/plexus/speakers/invite` | App |
| `/api/admin/plexus/speakers/years` | App |
| `/api/admin/plexus/sponsor-tasks/:p` | App |
| `/api/admin/plexus/sponsors` | App |
| `/api/admin/plexus/sponsors/:p` | App |
| `/api/admin/plexus/sponsors/:p/publish` | App |
| `/api/admin/plexus/sponsors/:p/tasks` | App |
| `/api/admin/plexus/sponsors/renewal-wrap` | App |
| `/api/admin/plexus/stats` | App |
| `/api/admin/plexus/stats` | ProjectHome |
| `/api/admin/plexus/travel-budget` | App |
| `/api/admin/plexus/volunteers` | App |
| `/api/admin/plexus/volunteers/:p/approve` | App |
| `/api/admin/plexus/volunteers/:p/reject` | App |
| `/api/admin/plexus/volunteers/export` | App |
| `/api/admin/portal-config` | QAAdmin |
| `/api/admin/post-event/assemble` | PostEventEngine |
| `/api/admin/post-event/assemble/facts` | PostEventEngine |
| `/api/admin/post-event/attendee-thankyou` | PostEventEngine |
| `/api/admin/post-event/run-round` | PostEventAdmin |
| `/api/admin/post-event/summary` | PostEventAdmin |
| `/api/admin/pr-newsletters/:p/stage` | PRApp |
| `/api/admin/pr-newsletters/audience-preview` | NLComposer |
| `/api/admin/pr-newsletters/audience-preview` | PRApp |
| `/api/admin/pr-newsletters/compose` | NLComposer |
| `/api/admin/pr/meta/publish/:p` | PRApp |
| `/api/admin/pr/meta/settings` | PRApp |
| `/api/admin/pr/meta/status` | PRApp |
| `/api/admin/print/context` | PrintSuite |
| `/api/admin/print/context` | SignageStudio |
| `/api/admin/print/preview` | PrintSuite |
| `/api/admin/print/render` | PrintSuite |
| `/api/admin/pulse/run` | WeeklyPulse |
| `/api/admin/registrant-emails` | App |
| `/api/admin/registrant/:p/:p/:p` | App |
| `/api/admin/registrant/:p/:p/activity` | App |
| `/api/admin/registrant/:p/:p/mark-paid` | BulkSelect |
| `/api/admin/registrant/:p/:p/note` | App |
| `/api/admin/registrant/:p/:p/notes` | App |
| `/api/admin/registration-links` | App |
| `/api/admin/registration-links/:p/deactivate` | App |
| `/api/admin/registrations/:p/checkin` | BulkSelect |
| `/api/admin/research` | ResearchApp |
| `/api/admin/research/:p/to-contacts` | ResearchApp |
| `/api/admin/review/assignments` | ReviewEngine |
| `/api/admin/review/assignments/` | ReviewEngine |
| `/api/admin/review/assignments/auto` | ReviewEngine |
| `/api/admin/review/config` | ReviewEngine |
| `/api/admin/review/decisions` | ReviewEngine |
| `/api/admin/review/decisions/` | ReviewEngine |
| `/api/admin/review/decisions/letters/batch` | ReviewEngine |
| `/api/admin/review/funnel` | ReviewEngine |
| `/api/admin/review/my/assignments` | ReviewEngine |
| `/api/admin/review/my/assignments/` | ReviewEngine |
| `/api/admin/review/my/scorecard/` | ReviewEngine |
| `/api/admin/review/progress` | ReviewEngine |
| `/api/admin/review/reviewers` | ReviewEngine |
| `/api/admin/review/reviewers/external` | ReviewEngine |
| `/api/admin/review/reviewers/external/` | ReviewEngine |
| `/api/admin/review/rubric` | ReviewEngine |
| `/api/admin/review/submissions` | ReviewEngine |
| `/api/admin/scan-context` | App |
| `/api/admin/search` | CmdPalette |
| `/api/admin/seat-confirmations/config` | SeatConfirmAdmin |
| `/api/admin/seat-confirmations/release-unconfirmed` | SeatConfirmAdmin |
| `/api/admin/seat-confirmations/start-round` | SeatConfirmAdmin |
| `/api/admin/seat-confirmations/summary` | SeatConfirmAdmin |
| `/api/admin/sections` | App |
| `/api/admin/signup-forms` | SignupFormsApp |
| `/api/admin/signup-forms/` | SignupFormsApp |
| `/api/admin/signup-forms/:p/responses` | SignupFormsApp |
| `/api/admin/signup-forms/:p/responses/:p` | SignupFormsApp |
| `/api/admin/signup-forms/:p/responses/:p/promote` | SignupFormsApp |
| `/api/admin/speaker-itineraries` | App2 |
| `/api/admin/speaker-itineraries/` | App2 |
| `/api/admin/speaker-kits` | PostEventEngine |
| `/api/admin/speaker-kits/generate` | PostEventEngine |
| `/api/admin/speaker-kits/send` | PostEventEngine |
| `/api/admin/sponsor-reports` | PostEventEngine |
| `/api/admin/sponsor-reports/` | PostEventEngine |
| `/api/admin/sponsor-reports/generate` | PostEventEngine |
| `/api/admin/sponsor-tiers` | App |
| `/api/admin/staff-tracking/live` | StaffTracking |
| `/api/admin/staff-tracking/pairings` | StaffTracking |
| `/api/admin/staff-tracking/pairings/` | StaffTracking |
| `/api/admin/staff-tracking/purge` | StaffTracking |
| `/api/admin/staff-tracking/roster` | StaffTracking |
| `/api/admin/staff-tracking/run-scan` | StaffTracking |
| `/api/admin/staff-tracking/settings` | StaffTracking |
| `/api/admin/system-health` | HealthApp |
| `/api/admin/talks` | FeedAdmin |
| `/api/admin/talks/:p` | FeedAdmin |
| `/api/admin/team` | TeamApp |
| `/api/admin/team/grant` | TeamApp |
| `/api/admin/team/invite` | TeamApp |
| `/api/admin/team/invite/resend` | TeamApp |
| `/api/admin/team/permissions` | TeamApp |
| `/api/admin/team/revoke` | TeamApp |
| `/api/admin/tech/` | TechApp |
| `/api/admin/tech/db-download` | TechApp |
| `/api/admin/tech/export-all` | TechApp |
| `/api/admin/tech/system-info` | TechApp |
| `/api/admin/tech/tables` | TechApp |
| `/api/admin/tech/tables/:p` | TechApp |
| `/api/admin/tech/verify-password` | TechApp |
| `/api/admin/testimonials` | PostEventEngine |
| `/api/admin/testimonials/` | PostEventEngine |
| `/api/admin/testimonials/export` | PostEventEngine |
| `/api/admin/testimonials/harvest` | PostEventEngine |
| `/api/admin/transparency/board-pack` | TransparencyAdmin |
| `/api/admin/transparency/board-pack.` | TransparencyAdmin |
| `/api/admin/transparency/facts` | TransparencyAdmin |
| `/api/admin/users/` | ? |
| `/api/admin/waitlist` | WaitlistAdmin |
| `/api/admin/waitlist-offers` | WaitlistAdmin |
| `/api/admin/waitlist/:p` | WaitlistAdmin |
| `/api/admin/year-calendar` | CalendarApp |
| `/api/admin/year-calendar/` | CalendarApp |
| `/api/admin/year-calendar/events` | CalendarApp |
| `/api/auth/change-password` | App |
| `/api/auth/login` | App |
| `/api/auth/me` | App |
| `/api/auth/password` | App |
| `/api/auth/profile` | App |
| `/api/bridges/events` | BridgesApp |
| `/api/bridges/events` | ProjectHome |
| `/api/bridges/events/:p` | App |
| `/api/bridges/events/:p` | BridgesApp |
| `/api/bridges/events/:p/publish` | BridgesApp |
| `/api/bridges/events/:p/registrations` | BridgesApp |
| `/api/bridges/program` | BridgesApp |
| `/api/bridges/program/:p` | BridgesApp |
| `/api/bridges/program/:p/publish` | BridgesApp |
| `/api/bridges/registrations/:p` | BridgesApp |
| `/api/bridges/registrations/:p/checkin` | BridgesApp |
| `/api/bridges/registrations/:p/undo-checkin` | BridgesApp |
| `/api/bridges/speakers` | BridgesApp |
| `/api/bridges/speakers/:p` | BridgesApp |
| `/api/bridges/speakers/:p/publish` | BridgesApp |
| `/api/channels` | App |
| `/api/channels/:p/members` | App |
| `/api/channels/:p/members/:p` | App |
| `/api/channels/:p/members/bulk` | App |
| `/api/chat/dm` | App |
| `/api/chat/messages` | App |
| `/api/chat/read` | App |
| `/api/chat/unread` | App |
| `/api/checkin` | STATE |
| `/api/checkin/recent` | App |
| `/api/checkin/roster` | STATE |
| `/api/checkin/search` | App |
| `/api/checkin/stats` | App |
| `/api/checkin/undo` | ? |
| `/api/checkin/undo` | STATE |
| `/api/conferences` | ConfApp |
| `/api/conferences/` | ConfApp |
| `/api/contacts` | NetworkApp |
| `/api/contacts/:p` | NetworkApp |
| `/api/contacts/:p/favorite` | NetworkApp |
| `/api/contacts/import/commit` | NetworkApp |
| `/api/contacts/import/preview` | NetworkApp |
| `/api/contacts/outreach/draft` | NetworkApp |
| `/api/contacts/outreach/queue` | NetworkApp |
| `/api/dashboard-preferences/:p` | App |
| `/api/dashboard/portal-stats` | App |
| `/api/dashboard/summary` | App |
| `/api/dashboard/trends` | App |
| `/api/files/:p` | App |
| `/api/finance/bank-balance` | FinanceApp |
| `/api/finance/bank-balance/:p` | FinanceApp |
| `/api/finance/conference-payments/:p/confirm` | FinanceApp |
| `/api/finance/dashboard` | App |
| `/api/finance/dashboard` | FinanceApp |
| `/api/finance/invoices` | FinanceApp |
| `/api/finance/invoices/:p` | FinanceApp |
| `/api/finance/invoices/:p/issue` | FinanceApp |
| `/api/finance/invoices/:p/mark-paid` | FinanceApp |
| `/api/finance/my-travel-orders` | App |
| `/api/finance/payment-orders` | FinanceApp |
| `/api/finance/payment-orders/:p` | FinanceApp |
| `/api/finance/reconcile/batch/:p` | FinanceApp |
| `/api/finance/reconcile/batch/:p/confirm-high` | FinanceApp |
| `/api/finance/reconcile/batches` | FinanceApp |
| `/api/finance/reconcile/import` | FinanceApp |
| `/api/finance/reconcile/line/:p/confirm` | FinanceApp |
| `/api/finance/reconcile/line/:p/ignore` | FinanceApp |
| `/api/finance/reconcile/line/:p/match` | FinanceApp |
| `/api/finance/reports/by-project` | FinanceApp |
| `/api/finance/reports/by-work-unit` | FinanceApp |
| `/api/finance/reports/monthly` | FinanceApp |
| `/api/finance/settings` | FinanceApp |
| `/api/finance/stripe-payments/recent` | FinanceApp |
| `/api/finance/transactions` | FinanceApp |
| `/api/finance/transactions/:p` | FinanceApp |
| `/api/finance/travel-orders` | FinanceApp |
| `/api/finance/travel-orders/:p` | FinanceApp |
| `/api/finance/travel-orders/:p/approve` | FinanceApp |
| `/api/finance/travel-orders/:p/calculate` | FinanceApp |
| `/api/finance/travel-orders/:p/pay` | FinanceApp |
| `/api/finance/travel-orders/:p/reject` | FinanceApp |
| `/api/finance/work-units` | FinanceApp |
| `/api/finance/work-units/:p` | FinanceApp |
| `/api/finance/work-units/:p/transactions` | FinanceApp |
| `/api/finance/years` | FinanceApp |
| `/api/finance/years/:p` | FinanceApp |
| `/api/folders/:p` | App |
| `/api/forum/events` | STATE |
| `/api/forum/events/:p/register` | STATE |
| `/api/forum/groups` | STATE |
| `/api/forum/groups/:p/membership` | STATE |
| `/api/forum/media` | STATE |
| `/api/forum/posts` | STATE |
| `/api/forum/posts/:p/react` | STATE |
| `/api/gala/registrations` | GalaAdmin |
| `/api/gala/registrations` | LiveOverview |
| `/api/gala/registrations/:p` | GalaAdmin |
| `/api/gala/registrations/:p/pay-link` | GalaAdmin |
| `/api/gameday/volunteer/checkin` | GameDay |
| `/api/gameday/volunteer/login` | GameDay |
| `/api/gameday/volunteer/status` | GameDay |
| `/api/org/signature` | OrgSignature |
| `/api/pinned` | App |
| `/api/pinned/:p` | App |
| `/api/pinned/reorder` | App |
| `/api/plexus/conference` | App |
| `/api/plexus/conference` | SignageStudio |
| `/api/plexus/schedule` | App |
| `/api/portal-content` | PortalContentApp |
| `/api/portal-content/:p` | PortalContentApp |
| `/api/portal-content/:p/publish` | PortalContentApp |
| `/api/portal-content/reorder` | PortalContentApp |
| `/api/pr/ai-generations` | PRApp |
| `/api/pr/ai-generations/:p/use` | PRApp |
| `/api/pr/calendar` | PRApp |
| `/api/pr/calendar/:p` | PRApp |
| `/api/pr/calendar/:p/approve-schedule` | PRApp |
| `/api/pr/campaigns` | PRApp |
| `/api/pr/campaigns/:p` | PRApp |
| `/api/pr/dashboard` | PRApp |
| `/api/pr/media` | PRApp |
| `/api/pr/media` | PrintSuite |
| `/api/pr/media-contacts` | PRApp |
| `/api/pr/media-contacts/` | PRApp |
| `/api/pr/media-contacts/import/commit` | PRApp |
| `/api/pr/media-contacts/import/preview` | PRApp |
| `/api/pr/media-contacts/pause` | PRApp |
| `/api/pr/media/:p` | PRApp |
| `/api/pr/newsletters` | PRApp |
| `/api/pr/newsletters/` | DigestApp |
| `/api/pr/newsletters/:p` | PRApp |
| `/api/pr/newsletters/:p/send` | PRApp |
| `/api/pr/posts` | PRApp |
| `/api/pr/posts/:p` | PRApp |
| `/api/pr/press-releases` | PRApp |
| `/api/pr/press-releases/` | PRApp |
| `/api/pr/press-releases/draft` | PRApp |
| `/api/pr/press-seeds` | PRApp |
| `/api/pr/publer/status` | PRApp |
| `/api/pr/subscribers` | PRApp |
| `/api/pr/subscribers/:p/unsubscribe` | PRApp |
| `/api/pr/subscribers/export` | PRApp |
| `/api/projects/:p/settings` | App |
| `/api/projects/settings` | App |
| `/api/search` | App |
| `/api/sequences` | App |
| `/api/sequences/:p` | App |
| `/api/sequences/:p/steps/:p/complete` | App |
| `/api/staff-tracking/consent` | StaffShare |
| `/api/staff-tracking/me` | StaffShare |
| `/api/staff-tracking/pairing-confirm` | StaffShare |
| `/api/staff-tracking/ping` | StaffShare |
| `/api/tasks` | App |
| `/api/tasks/:p` | App |
| `/api/tasks/:p/files` | App |
| `/api/tasks/:p/toggle` | App |
| `/api/tasks/files/:p` | App |
| `/api/team` | App |
| `/api/team` | FinanceApp |
| `/api/team/heartbeat` | App |
| `/api/team/me` | App |
| `/api/team/usage` | TeamApp |
| `/api/teamchat/channels` | TeamChat |
| `/api/teamchat/channels/` | TeamChat |
| `/api/teamchat/dm` | TeamChat |
| `/api/teamchat/messages` | TeamChat |
| `/api/teamchat/overview` | TeamChat |
| `/api/teamchat/polls` | TeamChat |
| `/api/teamchat/polls/` | TeamChat |
| `/api/teamchat/read` | TeamChat |
| `/api/teamchat/upload` | TeamChat |
| `/api/timeline/:p` | App |
| `/api/timeline/:p/:p` | App |
| `/api/upload/photos` | AuctionAdmin |
| `/api/upload/photos` | STATE |

### 4.2 Cross-origin calls and external links

| index.html line | Target | Kind |
|---|---|---|
| 43241 | `POST https://medx-user-portal.onrender.com/api/admin/payments/gala/${id}/refund` (localhost → `http://localhost:3001`), `Authorization: Bearer <medx_token>` | cross-origin fetch (gala refund, `GalaAdmin`) |
| 53709–53718 | `QAAdmin.base()` = `/api/admin/portal-config`.user_portal_url → fallback `https://medx-user-portal.onrender.com` (localhost → `:3010`); `api()` sends admin JWT to `/api/admin/plexus/qa*` | cross-origin fetch (Live Q&A) |
| 46981, 47281 | `memberBaseHref()` → `https://medx-user-portal.onrender.com` (localhost → `:3001`) | Content Studio "Member portal" drawer |
| 46009, 46980 | `WebsiteContentApp.siteBase()` → `https://medx.hr` (localhost → `http://localhost:8899`) | website preview links |
| 7447 | `https://medx-user-portal.onrender.com` | login-page "member portal" link |
| 55583 | `window.open('https://medx-user-portal.onrender.com')` | Quick action "View member portal" |
| 56692 | `https://medx-admin-portal.onrender.com` | install-QR / share |
| 7875 | `https://medx-merch-studio.netlify.app/studio/` | nav item `data-section="merch-studio"` (external, `target=_blank`) |
| 10596, 13321, 13331 (`iframe data-src`) | `https://plexus-tables.netlify.app/planner.html` | gala 3D seating planner |
| 13301 | `https://plexus-tables.netlify.app/` | guest picker |
| 13302, 13305 (`iframe src`) | `https://plexus-tables.netlify.app/admin.html?key=medx-smaragdna-x7k9q4t2` | picker admin console — key shipped in HTML; both iframes are blocked by the admin CSP `frame-src` (server.js:919–922 lists only self + Stripe) |
| 14806–14807 | `https://medx-website-preview.netlify.app/plexus-gala-sponsor.pdf` | sponsor brochure |
| 22750, 57016 | `https://harvard.zoom.us/my/alen1` | meeting links |
| 54266–54270 | `https://dashboard.stripe.com`, `https://app.fira.finance`, `https://dashboard.render.com`, `https://github.com/alen-ops99/medx-portal`, `https://drive.google.com` | Tech → external dashboards |
| 59032 | `https://alen-ops99.github.io/medx-claude-code-onboarding/` | onboarding guide |
| misc | `maps.google.com` (3), `ui-avatars.com` (2), `www.google.com/search?q=`, `fonts.googleapis.com`/`gstatic` (7), `cdn.jsdelivr.net` (2, chart.js) | assets / helpers |

No Google Docs/Sheets links exist in the admin SPA (only the generic `drive.google.com` button).

### 4.3 Storage keys

localStorage: `medx_token` (19 uses — the admin JWT), `medx_user` (7), `token` (13 legacy), `checkinQueue` (6) + `checkinRoster` (3) — offline door-scanner queue, `widget_<id>` (6, dynamic prefix), `medxCustomShortcut` (4), `medx_project_order`, `medx_pinned_projects`, `medx_admin_hint_off_<id>`, `medx_ac_collapsed`, `medxHomeNotes`, `medxDiscoverSeen`, `medxDiscoverLang`, `medxAdminTheme`, `chatPinned`, `chatHidden`, `accApplicationDraft`. sessionStorage: `medxGdVolSession` (5), `medxGdEscaped` (2).

Boot order (`App.init()` index.html:17746–17800): `?gd=<token>` → `GameDay.volunteerBoot` (before any admin auth) → `sessionStorage.medxGdVolSession` resume → `localStorage.medx_token`/`medx_user` → `GET /api/auth/me` revalidates `is_admin || is_staff`, refreshes `is_founder` + `allowed_sections` into `medx_user` → `showApp()`; `?forumCandidate=` deep link handled after boot (:17795); `?track=1` opens the install panel (:57773).

### 4.4 Navigation contract

`App.showSection(sectionId, navItem, skipHistory)` defined at :55397 and re-wrapped four times (:55890, :55898, :55909, :56639); 184 call sites, 43 distinct literal ids: `dashboard`(42) `pr-media`(12) `finances`(11) `member-ops`(9) `gala`(9) `user-notifications`(7) `announce`(7) `email-blast`(6) `messages`(5) `content-studio`(5) `gameday`(4) `advisors`(4) `team-chat`(3) `signup-forms`(3) `postevent`(3) `portal-content`(3) `health`(3) `guest-passes`(3) `event-invites`(3) `discover`(3) `team` `resources` `newsletter` `member-feed` `event-reminders` `croatians-abroad` `conferences` `year-calendar` `website-content` `transparency` `tech` `speaker-itineraries` `plexus` `outbox` `files` `event-tracking` `editions` `cme` `audit` `auctions` (+ dynamic `${section}`, `${r.section}`, `${cfg.section}`). Sidebar `data-section` values: `year-calendar website-content user-notifications transparency tech team-chat team signup-forms resources pr-media portal-content outbox newsletter messages merch-studio member-ops member-feed health guest-passes gameday finances files email-blast editions discover content-studio contacts conferences cme audit announce advisors` + dynamic `${s.id}`, `${projectId}`. Hash routing: `history.pushState({section}, '', '#'+id)` (:21452, :21535, :21575), popstate → `event.state?.section || location.hash.slice(1) || 'dashboard'` (:21580), boot `history.replaceState({section: hash||'dashboard'})` (:31309), `#scanner` fast path (:70). The permission-section ids in §1 are a strict subset of these UI ids; `users.allowed_sections` drives sidebar rendering after `/api/auth/me`.

Theme markers: `theme-fresh` appears 69 times (first :4198; the prod smoke test requires it in the served HTML); theme preference key `medxAdminTheme` (:7398).

### 4.5 Service worker (`admin-portal/frontend/sw.js`)

`CACHE_NAME = 'medx-staff-v2'` (:4; `stamp-sw.sh` appends `-<sha7>` at build); `SHELL = ['/index.html','/manifest.json','/icon-192.png']` (:5); install precaches the shell + `skipWaiting` (:7–9); activate deletes other caches + `clients.claim` (:11–16); fetch: GET only, never cross-origin (:28 — explained :21–27, OSM tiles under CSP), never `/api/` (:30), navigations network-first with `/index.html` fallback (:33–46), other same-origin GETs cache-first (:48–56).

## 5. EXTERNAL SERVICES used by the admin portal

| Service | Init / client (admin server.js unless noted) | Env vars | Routes / call sites | Behaviour when the env var is missing |
|---|---|---|---|---|
| **Brevo** (transactional email) | `mailProviderReady()` :70; `sendEmail(to, subject, html, attachments, replyTo, fromOverride)` :71–135 → `POST https://api.brevo.com/v3/smtp/email` :105 (header `api-key`) | `BREVO_API_KEY`, `EMAIL_FROM` (default `Med&X <noreply@medx.hr>` :75) | every email path: 58 `scheduled_emails` writers drained by `drainScheduledEmails` :43350, direct sends (gala approve :30151, speaker invites :20966+, …), `POST /api/admin/tech/test-email` :36177. Sender identities in code: president@medx.hr (25), alen_juginovic@hms.harvard.edu (11 reply-to), info@medx.hr (7), laura.rodman@medx.hr (5), accelerator@medx.hr (5), noreply@medx.hr (3), team@medx.hr, pr@medx.hr | production: logs `[EMAIL DROPPED]` and returns `{success:false, mock:true}` (:128–131) — nothing is sent, callers keep going; dev: `[Email Mock]` success. `RESEND_API_KEY` in render.yaml is unused by any code |
| **Stripe** (read-only reconciliation + tech test) | `stripeReadKey()` :26752–26755 = `STRIPE_READONLY_KEY \|\| STRIPE_SECRET_KEY`; `stripeApiGet()` :26756 → `https://api.stripe.com` with Basic auth (:26757); `require('stripe')(STRIPE_SECRET_KEY)` only inside `POST /api/admin/tech/test-stripe` :36120 | `STRIPE_READONLY_KEY`, `STRIPE_SECRET_KEY` | `GET /api/finance/stripe-payments/recent` :26875 (`/v1/checkout/sessions` + `/v1/charges`), `POST /api/admin/tech/test-stripe` :36112 (techAuth) | `{ configured:false }` gate naming the env var (:26748–26751); no checkout sessions, no webhook — money stays on the member portal. Refunds go through the member backend (§2b) |
| **FIRA** (Croatian fiscal invoicing) | `require('../../user-portal/backend/fira-service')` :21 — imports the MEMBER portal's module; `fira-service.js` reads `FIRA_API_URL` (:12, default `https://app.fira.finance`), `FIRA_API_KEY` (:13), `FIRA_DISABLED` (:21) | `ENABLE_FIRA_ON_MARK_PAID`, `FIRA_API_KEY`, `FIRA_API_URL`, `FIRA_DISABLED` | `POST /api/finance/conference-payments/:id/confirm` :27078 → `firaService.createFiscalInvoice` (:27185–27187, only when `ENABLE_FIRA_ON_MARK_PAID==='true'` AND `firaService.isConfigured()`), `POST /api/admin/tech/test-fira` :36138 (`https.request` to `api.fira.finance/v1/health` :36145–36153) | Mark Paid books the payment without a fiscal invoice (`firaResult=null`); test route returns `FIRA_API_KEY not configured`. Moving/renaming `fira-service.js` breaks the admin boot |
| **Firestore gala seat picker** | `admin-portal/backend/picker-sync.js` (required at server.js:12782, `new PickerClient()` :12783). Project `PICKER_FB_PROJECT_ID \|\| 'plexus-gala-tables'` (:25), public web API key default baked in (:27), `PICKER_BASE_URL \|\| 'https://plexus-tables.netlify.app/'` (:28), `PICKER_TICKET_HOST \|\| 'plexus-tables.netlify.app'` (:35), `PICKER_FS_BASE`/`PICKER_AUTH_BASE` test seams (:38–39). Auth = Identity Toolkit `signInWithPassword` as `PICKER_ADMIN_EMAIL`/`PICKER_ADMIN_PASSWORD` (:87–88, :98). **Doc-id contract:** `paidEmailDocId(email) = sha256hex(lower(trim(email)))` (:48, :57–59) — must stay byte-identical to the picker client. Collections: `invites/{16-hex token}` create-only (:151) / delete (:169); `paid_emails/{sha256}` upsert (:182) / delete (:194); `tickets/{tid}` read for the door scanner (:209, `extractPickerTid` :239); `config/settings` deadlines (:258–261). Engine `runInviteSync` :358 (diff :301). Invite mail `buildInviteEmail` :478, link `PICKER_BASE_URL?t=<token>` :527 | `PICKER_ADMIN_EMAIL`, `PICKER_ADMIN_PASSWORD`, `PICKER_FB_API_KEY`, `PICKER_FB_PROJECT_ID`, `PICKER_BASE_URL`, `PICKER_TICKET_HOST`, `PICKER_FS_BASE`, `PICKER_AUTH_BASE` | `GET /api/admin/gala/picker-sync` :12872, `POST …/run` :12888, `POST …/send-invites` :12904 (stages `scheduled_emails` :12916); scanner resolution `extractPickerTid` call :32710; local mirror table `gala_picker_invites` | `configured=false` (:94) → sync is a no-op, Seating card says "sync not configured"; registrations never blocked |
| **Anthropic** (Claude) | (1) `shared/ai.js` `aiDraft()` → `https://api.anthropic.com/v1/messages` (:25), model `AI_DRAFT_MODEL \|\| 'claude-haiku-4-5'` (:28), 8 s timeout, `AI_DRAFT_RATE_MAX` (:35, 30/min) — 29 `aiDraft(` call sites in admin server.js. (2) Direct calls: `advResearchSearch` :28941–28957 (server-side `web_search_20250305` tool, `ASSISTANT_MODEL_COMPLEX \|\| ASSISTANT_MODEL \|\| 'claude-haiku-4-5'`, 45 s, up to 4 rounds), `assistRunAgent` :36664–36680 (tools loop, `assistPickModel` :36656–36657: simple `ASSISTANT_MODEL \|\| 'claude-haiku-4-5-20251001'`, complex `ASSISTANT_MODEL_COMPLEX \|\| 'claude-opus-4-8'`), `advCallAnthropic` :42256–42268 (advisors, 12 s) | `ANTHROPIC_API_KEY`, `AI_DRAFT_MODEL`, `AI_DRAFT_RATE_MAX`, `ASSISTANT_MODEL`, `ASSISTANT_MODEL_COMPLEX` | `POST /api/admin/assistant` :36782 (+ `assistantLimiter`), `POST /api/admin/design-assist` :38129, `POST /api/admin/research/*` (:28997 limiter), `GET /api/admin/content/video/prefill` :37360, `POST /api/admin/event-invites/discover` :41180, advisors `/api/admin/advisors/*` (`advComposeReview` :42385, `advRouteQuestion` :42521, `advComposeAsk` :42621, COO pack :42209), member-message reply drafts :34179–34211 | **Mock mode everywhere:** `aiDraft` resolves `{ text:'', mock:true, mock_reason:'no_key' }` (ai.js:84–89) so callers use deterministic fallbacks and the UI badges "template mode" (`mock_reason` surfaced at :34211, :36876, :37381–37389); research returns `{ gated:true, actions:[…] }` (:28943); assistant answers "I'm not switched on yet — add ANTHROPIC_API_KEY" (:36666); advisors return deterministic observations with `is_mock=1` (:42385) |
| **Publer** (social scheduling) | `PUBLER_API_BASE = https://app.publer.com/api/v1` :309; `publerConfigured()` :311–313; headers `Authorization: Bearer-API <key>`, `Publer-Workspace-Id` :315–320 | `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID` | `GET /accounts` :337, `POST /posts/schedule` :421; routes `GET /api/pr/publer/status` :27411, PR calendar schedule/approve (`/api/pr/calendar/:id/*`, `/api/admin/content/schedule`) | `{ ok:false, error:'not_configured' }` (:335, :397, :27412) — posts stay local |
| **Meta Graph** (Instagram/Facebook publish) | `META_GRAPH_BASE = https://graph.facebook.com/v21.0` :693; credentials live in DB `pr_meta_settings` (:696, created :5100, kill switch `enabled`, seeded off :5109), not env; `fetch(call.url …)` :784 executes the planned Graph calls | (none — DB-held) | `GET /api/admin/pr/meta/status` :20779, `POST /api/admin/pr/meta/publish/:calendarId` :20815; log table `pr_meta_publish_log` | dry-run plan returned with `status:'not_configured'` / `kill_switch_off` (:770–777) |
| **Amadeus** (live flight offers) | :543–620: `AMADEUS_ENV` (:557, `production` → `https://api.amadeus.com`, else test host :558), `amadeusConfigured()` :560–563, OAuth `POST /v1/security/oauth2/token` :581, `GET /v2/shopping/flight-offers` :672 | `AMADEUS_API_KEY`, `AMADEUS_API_SECRET`, `AMADEUS_ENV`, `AMADEUS_BASE_URL` (test seam) | `POST /api/admin/plexus/speakers/:id/flight/search` :20601, `…/flight/offers/pin` :20652, `…/flight/quotes` :20531, `GET /api/admin/plexus/travel-budget` :20574 | 503 key-gate naming the owner actions (:20603); deep links + manual fare table keep working |
| **Google Wallet** | `shared/wallet.js` required at :16; `getConfig()` wallet.js:50–62 (`GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY` JSON), class id `GOOGLE_WALLET_EVENT_CLASS_ID \|\| GOOGLE_WALLET_TICKET_CLASS_ID` (:77), hosts `GOOGLE_WALLET_OBJECTS_BASE` (:42), `GOOGLE_WALLET_OAUTH_URL` (:43), save prefix `https://pay.google.com/gp/v/save/` (:44) | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY`, `GOOGLE_WALLET_EVENT_CLASS_ID`, `GOOGLE_WALLET_TICKET_CLASS_ID`, `GOOGLE_WALLET_OBJECTS_BASE`, `GOOGLE_WALLET_OAUTH_URL`, `PUBLIC_BASE_URL` | `ensureWalletClassForConference` :32462–32485 (fire-and-forget from `POST /api/admin/conferences` :11048; stores `conferences.wallet_class_id` :32469), `POST /api/admin/wallet/provision` :32833, ticket revoke patches object state `INACTIVE` in `POST /api/admin/tickets/:id/revoke` :32821–32823 | `wallet.isConfigured()` false → `{ configured:false, message:'Set GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SA_KEY' }` (:32834); pass building itself lives on the member portal |
| **Microsoft Graph / Outlook** | :38743–38747: `OUTLOOK_ENV = [MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_TENANT_ID]`, `outlookMailbox()` = `MS_GRAPH_MAILBOX \|\| 'team@medx.hr'`, `outlookMockActive()` = not configured AND not production. **No request to `graph.microsoft.com` or `login.microsoftonline.com` exists in the file** | `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID`, `MS_GRAPH_MAILBOX` | `GET /api/admin/outlook/status` :38828, `GET …/threads` :38840 (mock threads in dev, `[]` otherwise — comment :38839 "mock in dev until Graph is wired; empty in prod without keys"), `GET …/threads/:id` :38858 (404 unless mock), `POST …/draft-reply` :38867 (aiDraft), `POST …/queue-reply` :38896 (stages `scheduled_emails`) | production: empty inbox, `connected:true` if the three keys exist even though nothing is fetched; dev: deterministic sample threads |
| **Cloudinary** | NOT a client: no `require('cloudinary')` in admin code. `STORAGE_IS_EPHEMERAL = IS_PRODUCTION && !CLOUDINARY_URL` (:949–950); multer writes to local `uploads/` (:990, served at :938) | `CLOUDINARY_URL` (flag only) | middleware :963–975 returns 503 for `multipart/form-data` POST/PUT/PATCH in production when unset, except `/import` and `/prospects/preview` (:962); health/advisor checks :34700+, :42211 | uploads refused (503) in prod; dev writes to ephemeral disk |
| **Headless Chrome + Ghostscript** (Print Suite, PDFs) | No puppeteer/pdfkit for print: `psChromeBinary()` :37419–37433 searches `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, fixed paths, then `PATH`; `psRenderPdf` :37435 spawns `--headless=new --print-to-pdf`; `psGsBinary()` :37493–37498 (`GHOSTSCRIPT_PATH`) for CMYK (`psToCmyk` :37500). `pdfkit` is required lazily for accelerator PDFs (:13314, :15898, :16094) with fonts `PDF_FONT_PATH`/`PDF_FONT_BOLD_PATH` or `shared/fonts/DejaVuSans*.ttf` (:15628–15645) | `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, `GHOSTSCRIPT_PATH`, `PDF_FONT_PATH`, `PDF_FONT_BOLD_PATH`, `PATH` | `POST /api/admin/print/render` :38219, `GET /api/admin/print/...` engine status :38194, `GET /api/admin/sponsor-reports/:id/pdf` :21933, `GET /api/admin/transparency/board-pack.pdf` :22656, `GET /api/pr/press-releases/:id/export.pdf` :28375 | 503 `print_engine_unavailable` (:38219, :21933, :22656, :28375); CMYK silently skipped without Ghostscript; PDFs transliterate without a Unicode font |
| **Turso / libsql** | `require('libsql')` :13, `createDatabase` :3132–3136 via `shared/db.js`; `saveDb()` debounced sync :1044–1050; keep-alive/health probes at :30829–30903, :43310 | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `DATABASE_PATH` | all | local-only SQLite file (dev); in production without Turso the data is ephemeral on Render |
| **Render keep-alive** | :43291–43295 | `KEEP_WARM`, `RENDER_EXTERNAL_URL`, `NODE_ENV` | self `GET /health` every 14 min | disabled unless `KEEP_WARM === '1'` (opt-in since 2026-07-18) |
| **QR codes** | `require('qrcode')` :11; `QRCode.toBuffer` :821 (hosted-QR attachment helper), :30888 (signup-form QR), :42076 (`/api/app-install-qr.png`); `QRCode.toDataURL` :19225, :31600–31601 (auction pages), :33861 | — | — | — |
| **Google Sheets webhook, Web Push (VAPID), Resend, SendGrid, Firebase Admin SDK** | not present in admin code (`GOOGLE_SHEETS_WEBHOOK`, `VAPID_*`, `RESEND_API_KEY` are never read) | — | — | — |

## 6. ENV VARS — every `process.env.X` in `admin-portal/**` (+ the shared/imported modules it loads)

`render.yaml` `medx-admin-portal` block (lines 81–143) declares exactly: `PORT`=3001, `NODE_ENV`=production, `JWT_SECRET` (generated per service), `RESEND_API_KEY` (sync:false — **unused by any code**), `EMAIL_FROM`, `AMADEUS_API_KEY`, `AMADEUS_API_SECRET`, `AMADEUS_ENV`=test, `PICKER_ADMIN_EMAIL`, `PICKER_ADMIN_PASSWORD`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_EVENT_CLASS_ID`, `GOOGLE_WALLET_SA_KEY`. `buildFilter` = `admin-portal/**` (so edits to `shared/*`, `scripts/*` or `user-portal/backend/fira-service.js` do NOT redeploy the admin service even though it loads them).

| Var | File:lines | Effect when missing | In render.yaml (admin)? |
|---|---|---|---|
| `ADMIN_PORTAL_URL` | server.js:185, 208, 1285, 30951, 31167, 39822, 41858, 42890 | admin-origin links fall back to `RENDER_EXTERNAL_URL` (Render-injected) or `http://localhost:<PORT\|3002>`; `ADMIN_PORTAL_URL` const :1285 has NO onrender fallback, so nag/digest emails (:1931, :23518) and volunteer links (:42890 uses req host) would carry localhost if both are unset | no |
| `AMADEUS_API_KEY`, `AMADEUS_API_SECRET` | :561–562, 578–579 | flight search 503 key-gate | yes (sync:false) |
| `AMADEUS_ENV` | :557 | test host | yes (`test`) |
| `AMADEUS_BASE_URL` | :558 | derived from env; test seam only | no |
| `ANTHROPIC_API_KEY` | :28942, 29558, 36665, 36782, 37360, 41180, 42209, 42257, 42385, 42521, 42621 (+ ai.js:84) | all AI = mock/template mode (§5) | no |
| `ASSISTANT_MODEL` / `ASSISTANT_MODEL_COMPLEX` | :28944, 36656–36657, 42259, 42386, 42622 | defaults `claude-haiku-4-5` / `claude-haiku-4-5-20251001` / `claude-opus-4-8` | no |
| `BREVO_API_KEY` | :70, 86, 108, 36177 | production: every email dropped loudly | no (render.yaml has the stale `RESEND_API_KEY` instead) |
| `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, `PATH` | :37422, 37429 | print engine unavailable (503) unless a Chrome exists on a fixed path | no |
| `CLOUDINARY_URL` | :950, 42211 | production uploads 503 (§5) | no |
| `CME_ENC_KEY` | :2013, 42230 | CME/HLK records stored plaintext (`cmeEncKey()` returns null) | no |
| `CORS_ORIGIN` | :878 | default allowlist = both onrender hosts + localhost:3000/3001 | no |
| `DATABASE_PATH` | :1002 | `shared/medx_portal.db` if present else `backend/medx_portal.db` | no |
| `EMAIL_FROM` | :75, 34713 | `Med&X <noreply@medx.hr>` | yes |
| `ENABLE_FIRA_ON_MARK_PAID` | :27185 | Mark Paid never calls FIRA | no |
| `FIRA_API_KEY` (+ `FIRA_API_URL`, `FIRA_DISABLED` via fira-service.js:12–21) | :36141 | test-fira reports not configured; invoices skipped | no (declared only for the user service) |
| `FORUM_SITE_URL` | :39820 | `https://medx.hr/biomedical-forum.html` | no |
| `FOUNDER_RESET_PW` | :8865–8867 (commit 8e85c33) | nothing happens (intended) | no |
| `GHOSTSCRIPT_PATH` | :37496 | no CMYK conversion | no |
| `JWT_SECRET` | :859, 37591 | production: `process.exit(1)` at boot (:859); dev: `medx-dev-secret` | yes (generateValue, per service) |
| `KEEP_WARM` | :43292 | no self-ping | no |
| `MEDX_IBAN` | :34730 | health check warns; bank-transfer instructions hidden (member side) | no (user service only) |
| `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID`, `MS_GRAPH_MAILBOX` | :38744–38745 | Outlook module mock (dev) / empty (prod) | no |
| `NAG_UNPAID_DAYS`, `NAG_DUE_SOON_DAYS`, `SPONSOR_FOLLOWUP_DAYS` | :1281–1282, 1295 | 3 / 3 / 5 days | no |
| `NODE_ENV` | :129, 805, 859, 949, 1064, 35238, 35261, 38746, 43292 | dev behaviour: mock email, dev auth bypass (only with no Turso), mock Outlook | yes |
| `PDF_FONT_PATH`, `PDF_FONT_BOLD_PATH` | :15631, 15641 | falls back to `shared/fonts/DejaVuSans*.ttf`, else transliteration | no |
| `PORT` | :185, 208, 858, 1285, 30951, 31167, 39822 | 3002 default in URL builders (listen uses :858) | yes (3001) |
| `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID` | :312, 317–318, 27427 | Publer not configured | no |
| `PUBLIC_BASE_URL` | :32458 | wallet class origin = `RENDER_EXTERNAL_URL` (admin host) → `userPortalBase()` | no |
| `RENDER`, `RENDER_EXTERNAL_URL` | :805, 949; :185, 208, 1958, 30951, 31167, 32458, 35194, 36008, 39822, 43291 | Render-injected; without them prod detection relies on `NODE_ENV` and admin links fall back to `ADMIN_PORTAL_URL`/onrender literal | platform |
| `SITE_PUBLIC_URL` | :28123 | `https://medx.hr` | no |
| `STRIPE_READONLY_KEY`, `STRIPE_SECRET_KEY` | :26753; :26753, 36119–36120 | finance Stripe panel `{configured:false}`; test-stripe not configured | no (only the user service declares Stripe) |
| `TECH_PASSWORD` | :35942 | all `techAuth` routes 503 ("Tech tools disabled") | no |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | :1046, 1054, 1064, 3134, 3137, 30829, 30858, 30903, 43310; :3135 | local SQLite only; dev-auth bypass becomes possible if `NODE_ENV=development` | yes (sync:false) |
| `USER_PORTAL_URL` | :804, 37599 | `https://medx-user-portal.onrender.com` in production/Render, `http://localhost:3010` otherwise (one-time warning) | no |
| picker-sync.js: `PICKER_ADMIN_EMAIL` :87, `PICKER_ADMIN_PASSWORD` :88 | | sync no-op | yes (sync:false) |
| picker-sync.js: `PICKER_FB_PROJECT_ID` :25, `PICKER_FB_API_KEY` :27, `PICKER_BASE_URL` :28, `PICKER_TICKET_HOST` :35, `PICKER_FS_BASE` :38, `PICKER_AUTH_BASE` :39 | | baked defaults (`plexus-gala-tables`, public web key, `https://plexus-tables.netlify.app/`, Google endpoints) | no |
| demo-purge.js: `RENDER`, `NODE_ENV` :111 | | purge runs only in production | yes/platform |
| shared/ai.js: `AI_DRAFT_MODEL` :28, `AI_DRAFT_RATE_MAX` :35, `ANTHROPIC_API_KEY` :84 | | haiku default / 30 per min / mock | no |
| shared/wallet.js: `GOOGLE_WALLET_OBJECTS_BASE` :42, `GOOGLE_WALLET_OAUTH_URL` :43, `GOOGLE_WALLET_ISSUER_ID` :52, `GOOGLE_WALLET_SA_KEY` :53, `GOOGLE_WALLET_EVENT_CLASS_ID` / `GOOGLE_WALLET_TICKET_CLASS_ID` :77 | | Google defaults / `configured:false` | ISSUER_ID, EVENT_CLASS_ID, SA_KEY yes; the rest no |

**Referenced in admin code but NOT declared in `render.yaml` (admin service): 45 of 56 names** — `ADMIN_PORTAL_URL`, `AMADEUS_BASE_URL`, `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL`, `ASSISTANT_MODEL_COMPLEX`, `BREVO_API_KEY`, `CHROME_PATH`, `CLOUDINARY_URL`, `CME_ENC_KEY`, `CORS_ORIGIN`, `DATABASE_PATH`, `ENABLE_FIRA_ON_MARK_PAID`, `FIRA_API_KEY`, `FORUM_SITE_URL`, `FOUNDER_RESET_PW`, `GHOSTSCRIPT_PATH`, `KEEP_WARM`, `MEDX_IBAN`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_MAILBOX`, `MS_GRAPH_TENANT_ID`, `NAG_DUE_SOON_DAYS`, `NAG_UNPAID_DAYS`, `PATH`*, `PDF_FONT_BOLD_PATH`, `PDF_FONT_PATH`, `PICKER_AUTH_BASE`, `PICKER_BASE_URL`, `PICKER_FB_API_KEY`, `PICKER_FB_PROJECT_ID`, `PICKER_FS_BASE`, `PICKER_TICKET_HOST`, `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`, `PUBLIC_BASE_URL`, `PUPPETEER_EXECUTABLE_PATH`, `RENDER`*, `RENDER_EXTERNAL_URL`*, `SITE_PUBLIC_URL`, `SPONSOR_FOLLOWUP_DAYS`, `STRIPE_READONLY_KEY`, `STRIPE_SECRET_KEY`, `TECH_PASSWORD`, `USER_PORTAL_URL` (* = platform/OS-injected, leaving 42 genuine dashboard-only names). Declared but never read by admin code: `RESEND_API_KEY`.

## 7. DRIFT REPORT — `design/CONNECTIONS-MAP.md` (2026-08-10) vs HEAD `8b7ba23`

### 7.1 What changed in the admin backend after the map

`git log --since=2026-08-01 -- admin-portal/backend/server.js` shows eleven commits between 2026-08-08 and 2026-08-10 (`f30b9a7`, `6d623fa`, `a05677b`, `e15ede1`, `407b294`, `cd01987`, `5d096b3`, `82af72b`, `57994b5`, then `8e85c33`, `8b7ba23`). The map's own baseline is the tree at `37364a2` (43,497 lines — verified by re-reading the file at that commit); HEAD is 43,529 lines, i.e. exactly +32 from the two post-map commits, both inside `initializeApp()` right after the founder seed:

- **`8e85c33` "Admin: env-gated one-time founder password recovery"** (+15 lines at HEAD 8859–8873): when `FOUNDER_RESET_PW` is set and ≥ 8 chars, each boot bcrypt-hashes it and runs `UPDATE users SET password_hash=?, must_change_password=1 WHERE email='juginovic.alen@gmail.com'` (:8865–8869), logs `[FOUNDER RESET] … REMOVE the env var now` without printing the value. New env var: `FOUNDER_RESET_PW` (not in render.yaml). No routes added. It re-runs on EVERY boot while the variable exists.
- **`8b7ba23` "Admin: one-time automatic founder unlock (2026-08-10 lockout)"** (+17 lines at HEAD 8874–8890): creates marker table `founder_recovery_log (id, done_at)` (:8880), and if no row `'unlock-2026-08-10'` exists, resets the same account to the **fixed temporary password `'MedX-Unlock-2026'`** with `must_change_password=1` and inserts the marker (:8882–8886). No env var, no route. The marker lives in the shared DB, so a restored/older DB copy without it re-applies the reset on the next boot. Neither commit touched the member portal, the SCHEMA-MIRROR block, or any route.

Every admin `server.js` citation in the map that sits after line ~8858 is therefore at least +32 at HEAD; many are further off because the map was compiled against an even earlier tree for several sections (its header says "~43,400 lines").

### 7.2 Citation check (121 admin-related citations)

Legend: **exact** = same line at HEAD; **+32** = shifted by exactly the two post-map commits; **stale** = already wrong at `37364a2` (offset shown); **wrong** = points at unrelated code / wrong file.

| Map citation | What it names | HEAD | Verdict |
|---|---|---|---|
| server.js:71 | `sendEmail` | 71 | exact |
| :105 | Brevo POST | 105 | exact |
| :257–259 | privacy/terms footer links | 257, 259 | exact |
| :309, :315–318 | Publer base / headers | 309, 315–320 | exact |
| :543–620 | Amadeus block | 543–620 | exact |
| :693, :729–748 | Meta Graph base / calls | 693, 784 (execute loop) | exact / stale +36 |
| :803 | `userPortalBase()` | 803 | exact |
| :817 | `qrImageUrl` | 817 | exact |
| :821 | `qrPngAttachment` | 819 | stale −2 |
| :1081–1097 | `sectionDenied` enforcement in `auth()` | 1067–1098 (call at 1082) | exact |
| :1153–1173 | `PERMISSION_SECTIONS` | 1153–1173 | exact |
| :1183–1239 | `SECTION_ROUTE_MAP` | 1183–1239 | exact (map says 95-ish prefixes; HEAD has 102 entries; `registrant*`/`waitlist*` are two entries each) |
| :1256–1262 | `sectionDenied` | 1256–1262 | exact |
| :1958 | admin base helper | 1956–1959 (`seatPublicBase`) | stale −2 |
| :3132 | `createDatabase` | 3132 | exact |
| :4159, :4832, :11942, :22931 | `push_outbox` enqueue sites | 22968, 34343, 39200, 41860 | wrong (none of the four cited lines enqueue; the map likely cited CREATE/ALTER lines) |
| :11013 | wallet class on conference create | 11048 | stale +35 |
| :11187, :19193, :30792, :31504, :33765, :37674, :41939 | QR generation sites | 11219, 19225, 30888, 31600–31601, 33861, (none), 42076 | +32, +32, stale +96, stale +96, stale +96, wrong, stale +137 |
| :11786–11852 | `/api/public/{content,status,press,press/:slug}` | 11818, 11837, 11859, 11884 | +32 (the whole range moved to 11818–11884) |
| :12750 | picker-sync wired | 12782 | +32 |
| :12840, :12856, :12872 | picker-sync GET/run/send-invites | 12872, 12888, 12904 | +32 |
| :14660, :14685, :14702, :14714 | review-access family | 14692, 14717, 14734, 14746 | +32 |
| :15146, :15172, :15244, :15310 | interview-access family | 15178, 15204, 15276, 15342 | +32 |
| :15406 | evaluate magic link | 15438 | +32 |
| :15708 (user-side) | interviewer link builder | n/a | (user portal — not checked here) |
| :16988 | forum check-in variant | 17020 | +32 |
| :18853 | `/api/admin/checkin/scan` | 18885 | +32 |
| :19818 | `/api/plexus/checkin` | 19850 | +32 |
| :19949 | `/api/public/register-invite` | 19981 | +32 |
| :20499, :20542, :20569, :20620 | Amadeus routes | 20531, 20574, 20601, 20652 | +32 |
| :21615, :21637 | testimonial routes | 21647, 21669 | +32 |
| :23738, :23745 | `/newsletter`, subscribe | 23770, 23777 | +32 |
| :23976, :24031, :24044, :24331 | applicant routes | 24008, 24063, 24076, 24363 | +32 |
| :24345 | `/review` | 24377 | +32 |
| :24519 | `/evaluate` | 24551 | +32 |
| :24876 | `/apply` | 24908 | +32 |
| :26656, :26659, :26686–26687, :26778 | Stripe read-only block | 26753, 26756, 26783–26784, 26875 | stale +97 |
| :28856 | Anthropic research call | 28957 | stale +101 |
| :29651 | bridges check-in | 29747 / 29762 | stale +96 |
| :30511 | `/f/:slug` builder | 30606–30607 | stale +95 |
| :30854, :30921 | `/e/:token` | 31136 (single route) | stale +282 |
| :31019, :31022 | `/plexus/:token`, `/donor-night` in combo page | 31115, 31118 | stale +96 |
| :32273 | scanner accepts `/qr/<uuid>.png` | 30870 (`extractPickerTid` family) / picker-sync.js:239 | wrong |
| :32360–32400 | `ensureWalletClassForConference` | 32462–32485 | stale +102 |
| :32480, :32589 | checkin resolve / ticket | 32576, 32685 | stale +96 |
| :32614 | `extractPickerTid` | picker-sync.js:239 (definition), server.js:32710 (call) | wrong file |
| :33341, :33369, :33389, :33422, :33608 | gala scan/check-in, bridges variants, `/api/checkin` | 33437, 33465, 33518, 33704 (33389 → 29762) | stale +96…+104 |
| :33848 | `/api/portal-content/published` | 33944 | stale +96 |
| :35194, :35207 | team permissions GET/PUT | 35290, 35303 | stale +96 |
| :36157, :36158 | reg-link `/plexus/:token`, `/invite/` | 36293, 36294 | stale +136 |
| :36537 | assistant Anthropic call | 36664–36674 | stale +127 |
| :38286 | `/api/org/signature` | 38423 | stale +137 |
| :38593–38708, :38691, :38703 | MS Graph module, outlook status/threads | 38743–38900, 38828, 38840 | stale +137 |
| :38939, :39251, :39684 | `/plexus` claim, `/forum/enter`, `/forum` | 39076, 39388, 39821 | stale +137 |
| :41935 | `/api/app-install-qr.png` | 42072 | stale +137 |
| :42126 | advisors Anthropic call | 42256–42263 | stale +130 |
| :42916, :42934–42960 | gameday volunteer login/status/dashboard/messages | 43053, 43071–43089 | stale +137 |
| :43032 | `/health` | 43169 | stale +137 |
| index.html:17745–17762 | boot order | 17746–17800 | exact (block grew) |
| index.html:17751 | `?gd=` handling | 17751 | exact |
| index.html:31309 | hash `replaceState` | 31309 | exact |
| index.html:43173 | cross-origin gala refund | 43241 | stale +68 |
| index.html "184 call sites" | `showSection` | 184 | exact |
| sw.js `medx-staff-v2` | CACHE_NAME | :4 | exact |
| picker-sync.js :57, :98, :126, :150, :168, :206, :258, :358, :478–527 | doc-id, auth, list, create, delete, tickets, deadlines, sync, invite mail | 57, 98, 126, 151, 169, 209, 258, 358, 478–527 | exact (±3) |
| render.yaml claims | services, envVars, buildFilters | lines 1–154 | exact |
| user server.js:588–591 | CORS allowlist admits admin origin | 587–591 | exact |

Tally over the 121 citations: 30 exact, 38 shifted exactly +32, 46 stale by −2…+282 (already wrong before the two commits), 7 wrong-file/wrong-line. Line numbers were never the contract, but the pattern matters: everything the map cites from ~26,600 onward was already ~+96…+137 off on 2026-08-10, so any tool that trusts those numbers lands on unrelated code.

### 7.3 Factual discrepancies (the map says X; HEAD does Y)

1. **"No authenticated server-to-server API calls" (§2.3)** — true, but the map omits the ONE server-to-server call that exists: admin `GET /api/admin/users/:id/profile` fetches the member portal's unauthenticated `/api/public/registrations/:email` (admin :11341 → user :29187).
2. **Outlook module "reads mailbox, stages AI replies"** (§1.10) — it never calls Microsoft Graph; production shows an empty inbox, dev shows mock threads (:38839–38847). Only the AI-draft + outbox-staging half exists.
3. **"One direct browser cross-origin call"** (§2.3.5) — there are two families: the gala refund (index.html:43241) and the Live Q&A `QAAdmin` client (:53718 → user `/api/admin/plexus/qa*`). Both carry the admin JWT to a server that verifies with its own `JWT_SECRET` (§2b caveat, not mentioned by the map).
4. **Admin env list for Brevo (§1.2)** claims `CONFIRMATION_CC`, `EMAIL_DUMP_DIR`, `EMAIL_LOGO_URL` — none of these is read by admin code (only `BREVO_API_KEY`, `EMAIL_FROM`).
5. **Cloudinary "admin has the env too" (§1.14)** — admin never uses a Cloudinary client; `CLOUDINARY_URL` only gates uploads with a 503.
6. **`scripts/api-contract-allowlist.txt` (§5.5)** — the file does not exist; the checker runs with an empty allowlist.
7. **"233 distinct tables … cross-portal" (§2.3.1)** — anchored to `CREATE TABLE`, the union is 297 and the truly shared set is 220 (§2c); the map's list also omits `registration_transfers`, `waitlist_offers`, `seat_confirmations`, `event_survey_responses`, `signup_form_responses`, `project_status`, `content_blocks`, `org_settings` as admin→member channels.
8. **`SECTION_ROUTE_MAP` "registrant*", "waitlist*"** — HEAD spells them as two literal prefixes each (`/api/admin/registrant`, `/api/admin/registrant-emails`, `/api/admin/waitlist`, `/api/admin/waitlist-offers`); the `*` shorthand hides that `/api/admin/registrants` (plural) would NOT match.
9. **Admin base = `RENDER_EXTERNAL_URL || ADMIN_PORTAL_URL || onrender` (§2.3.3)** — true for `seatPublicBase()` (:1956) but the `ADMIN_PORTAL_URL` constant used by nag/digest emails (:1285, :1931, :23518) has no onrender fallback (localhost when the env is unset).

### 7.4 Things the map omits entirely

- `/photo-library` static mount of member-portal assets on the admin origin (server.js:941).
- The hard-coded picker console key in source/HTML (:42704; index.html:13302/13305) and the CSP `frame-src` conflict with the embedded picker iframes.
- The `notifications` phantom-table insert at :15819 (`publish-rankings`).
- `GET /api/admin/portal-config` (:33533) as the sanctioned way the SPA learns the member origin.
- The admin-side `/api/public/{content,status}` twins lacking `_hr` fields (§3.2).
- The admin-hosted survey/feedback/confirm-seat/claim-seat/auction public pages and their token links (§2a end).
- `walletBaseOrigin()` pointing wallet class URIs at the ADMIN host on Render unless `PUBLIC_BASE_URL` is set (:32458).
- The member portal's own parallel `/api/admin/*` surface (user server.js:733–29410, 150+ routes) that the admin SPA partly uses and the map's route table ignores.
- The founder recovery paths (`FOUNDER_RESET_PW`, `founder_recovery_log`) from the two post-map commits.

## 8. LIVE CHECK (GET/HEAD only, 2026-08-28 21:41 UTC, `curl -m 90`)

| Probe | Result |
|---|---|
| `GET https://medx-admin-portal.onrender.com/health` | **200** in 0.65 s, `application/json` — body `{"ok":true}` (no cold start; service was warm) |
| `GET https://medx-admin-portal.onrender.com/api/public/press` | **200** in 0.17 s — body `{"releases":[],"generated_at":"2026-08-28T21:41:52.206Z"}` (no published press releases yet; the website keeps its baked cards) |
| `GET https://medx-admin-portal.onrender.com/evaluate?token=INVALID` | **200** `text/html` — first bytes `<!DOCTYPE html><html lang="hr"><head>…<title>Med&X Accelerator - Evaluacija kandidata</title>` (the interviewer console shell; the token is validated client-side via `GET /api/accelerator/interview-access/:token`) |
| `GET https://medx-admin-portal.onrender.com/e/INVALID` | **404** `text/html` — first bytes `<!DOCTYPE html><html lang="en"><head>…<title>You are invited — Med&X</title>` (branded not-found page from `comboInvitePage`) |
| `GET /api/public/press` with `Origin: https://www.medx.hr` | **200**; `access-control-allow-origin: https://www.medx.hr`, `access-control-allow-credentials: true`, `vary: Origin`, `cache-control: public, max-age=60, stale-while-revalidate=300`, `ratelimit-limit: 120`, `ratelimit-policy: 120;w=60`, `cross-origin-resource-policy: same-origin`, `x-robots-tag: noindex, nofollow`, HSTS 1 y, served via Cloudflare + Render (`rndr-id`) |
| same with `Origin: https://evil.example` | **200** but **no** `access-control-allow-origin` header (allowlist honoured; browsers block the read) |
| Live CSP header (matches server.js:892–933) | `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com https://m.stripe.network https://m.stripe.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; connect-src 'self' blob: https://api.stripe.com https://m.stripe.network https://r.stripe.com https://*.cloudinary.com https://www.gstatic.com https://medx-user-portal.onrender.com http://localhost:3001; worker-src 'self' blob:; frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests` — confirms `frame-src` excludes `plexus-tables.netlify.app` (§4.2) |
| `GET https://medx-user-portal.onrender.com/health` | **200** in 0.30 s — `{"ok":true}` |
| `HEAD https://www.medx.hr/` | **301** → `https://medx.hr/` (Netlify) |

No login route, no POST/PUT/DELETE, and no authenticated endpoint was called.
