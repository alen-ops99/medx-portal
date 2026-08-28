# Med&X PORTAL CONNECTIONS — MASTER (2026-08-28)

**Spine:** ADMIN PORTAL → MEMBER PORTAL → WEBSITE. One document that says what talks to what, by which mechanism, with the file:line that proves it, and what is live today.

**Sources (this document supersedes `design/CONNECTIONS-MAP.md` and `design/IMPLEMENTATION_CONTRACT.md` of 2026-08-10 wherever they conflict):** `design/verify-2026-08-28/USER-PORTAL-CONNECTIONS.md`, `…/ADMIN-PORTAL-CONNECTIONS.md`, `…/WEBSITE-CONNECTIONS.md` (all read-only audits at `main @ 8b7ba23`), plus the live GET/HEAD probes rerun for §3 on 2026-08-28. Nothing in the repo or any database was modified.

**Citation tokens (verbatim, verified by `grep` at HEAD 8b7ba23):** `U:NNNN` = `user-portal/backend/server.js` · `A:NNNN` = `admin-portal/backend/server.js` · `IX:` = `user-portal/frontend/index.html` · `AIX:` = `admin-portal/frontend/index.html` · `P9:` = `user-portal/frontend/assets/app.part9.js` (`P1…P14` = the other parts) · `SW:` = `user-portal/frontend/sw.js` · `FW:` = `user-portal/frontend/forum-wing.html` · `RY:` = `render.yaml` · `SM:` = `tests/smoke.js` · `SS:` = `scripts/stamp-sw.sh` · `DB:`/`AI:`/`WL:` = `shared/db.js`/`ai.js`/`wallet.js` · `FS:` = `user-portal/backend/fira-service.js` · `PS:` = `admin-portal/backend/picker-sync.js` · `DP:` = `admin-portal/backend/demo-purge.js`.

**Tree note (added 19:00 EDT).** Nine commits landed on the checked-out branch `redesign/member-portal` (`main` itself is still `8b7ba23`; the branch is 9 commits ahead of `origin/main`) between 18:20 and 18:54 EDT while this document was being written (`45fb3ea` … `7e5f5dd`: staging launcher, design-handoff snapshots, `design-diff.js`, `user-portal/frontend-v2/`), not yet pushed to `origin/main` (local only) at the time of writing. The only cited file they touch is `user-portal/backend/server.js`: `52dc4cd` adds three lines inside the CORS block (`CORS_ORIGIN` now appended additively, U:593–595), so every member route below line 592 sits 3 lines lower than in the three 2026-08-28 audit files. **Every citation in this document was re-verified against the working tree at HEAD `7e5f5dd`.** The live member service still ran `189ac8d` at 18:35 EDT (service-worker stamp), i.e. it does not include `52dc4cd`.

## 0. Facts established today (2026-08-28) — verbatim

| Fact | Value |
|---|---|
| Live member portal deploy | commit `189ac8d` (no `user-portal/` commits since, so live = repo). Live `sw.js` reads `CACHE_NAME = 'medx-portal-v9-189ac8d'` and the served `index.html` carries `assets/app.css?v=189ac8d` (probed today). |
| Live admin portal deploy | `8b7ba23` = HEAD |
| Render | workspace "My Workspace"; services `medx-user-portal` (`srv-d6gbs26a2pns73fevl1g`) + `medx-admin-portal` (`srv-d6gbs2ea2pns73fevl6g`), both Starter / oregon / branch `main` / autoDeploy; `medx-gateway` free |
| Anthropic | `ANTHROPIC_API_KEY` set on admin only |
| Turso | prod DB `medx-portal-alen-ops99` @ `aws-eu-west-1`; the Render `TURSO_AUTH_TOKEN` is DB-scoped (cannot create DBs) |
| GitHub Actions | Turso nightly backup (03:17 UTC, artifacts 30 days, succeeds) · Uptime alert (6 h, succeeds) · Smoke (scheduled, **FAILING since ≥ 08-26** because it greps `index.html` for `MEDX_DATES` and `window.location.pathname.match`, which now live in `assets/app.part9.js` — stale test, not a portal fault) · keepalive cron disabled 07-18 · boot-smoke + predeploy-backup on push |
| CORS | production allowlist hardcoded in user `server.js:586–595` (`CORS_ORIGIN` env unread there; admin reads `CORS_ORIGIN`) — **superseded at HEAD `7e5f5dd`:** `52dc4cd` appends `CORS_ORIGIN` (comma list) to the member allowlist U:593–595; live `189ac8d` still ignores it |
| Email | Brevo HTTP API — `BREVO_API_KEY` IS set on both prod services (Render API, 2026-08-28); on STAGING it is deliberately absent ⇒ `[EMAIL DROPPED]` + `EMAIL_DUMP_DIR` outbox |
| DNS | `heritage.medx.hr` → 404 (DNS at Vercel, Netlify site claims it) |

---

## 1. One-page topology

```
                                   ┌────────────────────────────────────────────────────────────────────┐
                                   │  GitHub repo alen-ops99/medx-portal (main)                          │
                                   │  Actions: boot-smoke (push) · predeploy-backup (push) · smoke (07:00 │
                                   │  UTC, FAILING-stale) · uptime-alert (*/6h) · turso-backup (03:17 UTC)│
                                   │  · keepalive (cron OFF) · pages.yml (landing/ → GitHub Pages)        │
                                   └──────────────┬───────────────────────────────┬─────────────────────┘
                                                  │ autoDeploy (buildFilter admin-portal/**)   │ autoDeploy (buildFilter user-portal/**)
                                                  ▼                                            ▼
┌──────────────────────────────┐   ┌──────────────────────────────────────┐   ┌────────────────────────────────────────┐
│ WEBSITE medx.hr              │   │ ADMIN PORTAL                         │   │ MEMBER PORTAL                          │
│ Netlify site medx-website-   │   │ medx-admin-portal.onrender.com       │   │ medx-user-portal.onrender.com          │
│ preview (58a61ec7…), apex    │   │ Render srv-d6gbs2ea2pns73fevl6g      │   │ Render srv-d6gbs26a2pns73fevl1g        │
│ primary, www→301, digest     │   │ Starter · HEAD 8b7ba23               │   │ Starter · live 189ac8d (= repo)         │
│ deploys only, 5 Netlify Forms│   │ 1,080 routes · 19 permission sections│   │ 687 routes · SPA + server-rendered pages│
│ site.js = bridge layer       │   │ email OUTBOX drainer (Brevo)         │   │ Stripe money · Web Push (VAPID) · QR   │
└───┬──────────┬───────────────┘   └───┬───────────┬──────────┬───────────┘   └────┬──────────┬───────────┬───────────┘
    │ (1)      │ (2)                   │ (3)       │ (4)      │ (5)                │ (6)      │ (7)       │ (8)
    │ JS fetch │ JS fetch              │ shared DB │ HTTP GET │ browser fetch      │ Stripe   │ Brevo     │ Turso sync
    │ /api/    │ ADMIN/api/public/     │ (Turso)   │ (S2S)    │ admin JWT →        │ Checkout │ (dropped  │ 2 s debounce
    │ public/* │ press                 │           │          │ member /api/admin/ │ + webhook│ today)    │ + 60 s pull
    ▼          ▼                       ▼           ▼          ▼                    ▼          ▼           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ SHARED Turso/libsql DB  medx-portal-alen-ops99 @ aws-eu-west-1  (shared/db.js; 220 tables touched by both portals;      │
│ SCHEMA-MIRROR blocks byte-identical A:4154–4680 = U:9319–9845)  — the ONLY link admin→member for 14 pure push tables    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   External services (arrow = which service holds the credential)
   Stripe ──── member (secret+webhook, U:40–45, U:20243) · admin read-only (A:26753)     Brevo ──── both (U:102, A:105) — key ABSENT today
   FIRA fiscal ──── member (FS:156) · admin imports the member module (A:21)              Firestore picker plexus-gala-tables ──── admin only (PS:87–88)
   Google Wallet ──── member builds passes (U:13296/13383, WL:168) · admin provisions class (A:32462) · Apple = stub (U:13441)
   Google Sheets webhook ──── member only (U:668…28988)        Anthropic ──── admin (29 aiDraft sites) + member FAQ (U:12567) — key on admin only
   Amadeus / Publer / Meta / MS Graph(stub) ──── admin only     Cloudinary ──── member uploads (U:5511); admin uses it only as a 503 flag (A:945–965)
   jsDelivr ──── email logo + photos (U:302)                     plexus-tables.netlify.app ──── admin iframes/links (AIX:13301–13331), picker invites (PS:527)
```

**Every arrow, with its mechanism**

| # | From → To | Mechanism | Evidence | Live today |
|---|---|---|---|---|
| 1 | website → member | JS `fetch` of `/api/public/site`, `/content`, `/status`, (+`/supporters` on 2 pages), `POST /api/public/pv` beacon, `POST /api/auth/login`, `/api/bell-feed`, `/api/me/next-event`, `/api/user-notifications/*` | site.js (mirror = live, md5 `e59f65be…`); handlers U:11943, U:12048, U:12075, U:12144, U:12299, U:11095, U:23099, U:23167, U:23081/23085 | 10/10 reads 200 with ACAO for `https://medx.hr` and `https://www.medx.hr` |
| 1b | website → member | **URL in HTML/JS**: 41 registration CTAs rewritten to `/plexus?event=…&ticket=…&from=website[&mxt=]`; `/?mxt=…#section`; `/forum`; `/apply`; `/donate/checkout?…`; footer `/terms` `/privacy` | U:1295, IX:54 (`mxt` consumer, SPA only), U:4155, U:24062, U:5411 | all 200 / 303 |
| 2 | website → admin | JS `fetch` `ADMIN/api/public/press` (+ `/press/:slug` pages) on press pages only; footer "Team sign-in" link | A:11859, A:11884; CORS mount A:873 | 200, `releases: []` |
| 3 | admin ↔ member | **shared DB** (Turso embedded replica each side; `saveDb` 2 s debounce U:6011–6013 / A:1044–1050; 60 s pull U:29482–29484) | DB:14 `createDatabase`; opened U:6152–6156, A:3132–3136 | in sync (schema fingerprint printed at boot U:29453–29460) |
| 4 | admin backend → member backend | **HTTP GET, unauthenticated**: `fetch(userPortalBase()+'/api/public/registrations/<email>')` (10 s timeout) inside `GET /api/admin/users/:id/profile` | A:11341 → U:29190 | route live (no auth, no limiter) |
| 5 | admin SPA → member backend | **browser cross-origin fetch with the ADMIN JWT**: gala refund `POST …/api/admin/payments/gala/:id/refund` (AIX:43241 → U:733) and Live Q&A `QAAdmin` (`/api/admin/plexus/qa*`, AIX:53718 → U:21936–21982); base from `GET /api/admin/portal-config` A:33533 | member CORS admits the admin origin U:591; admin CSP `connect-src` admits the member origin A:915–917 | works only if both services' `JWT_SECRET` are identical (RY:24–25 vs RY:101–102 generate one each) |
| 6 | member → Stripe → member | Checkout sessions (`stripe.checkout.sessions.create`) at U:5433, U:15078, U:17516, U:20204, U:27820, U:27892, U:28406, U:28758; webhook `POST /api/stripe/webhook` U:20243 (raw body U:645–651, `constructEvent` U:20255, idempotency U:20274) | return URLs `?payment=…&reg|app|gala=` parsed at P9:3438–3500, P9:9822 | live key (donate → `cs_live_…`) |
| 7 | member/admin → Brevo | `sendEmail` U:75–145 (POST U:102) / A:71–135 (POST A:105); admin outbox drainer A:43350 | key read U:74/82/105, A:70/86/108 | key present on prod (Render env); **absent on staging by design ⇒ `[EMAIL DROPPED]` U:126–128, A:128–131; dumps to `EMAIL_DUMP_DIR` U:135–141** |
| 8 | admin → member (queues) | tables drained by the member service: `push_outbox` (admin writes A:22968, A:34343, A:39200, A:41860 → member `drainPushOutbox` U:200–224 every 45 s U:29487–29489); `member_announcements.push` fan-out U:257–298; `event_survey_responses` staged by admin A:2944, tapped via member U:12211–12267 | §2.9 | VAPID present (live `/api/push/vapid-key` returns a key) |
| 9 | admin → member (URLs in emails/JSON) | `userPortalBase()` A:803–811 at 33 sites: `/qr/<id>.png` (A:817), `/pay/gala/<token>` (A:30125–30150), `/invite/<b64>` (A:30440–30449, A:30515–30521), `/plexus/<token>` (A:36277–36294), `/f/<slug>` (A:30606–30607), `/pass/<token>` (A:22338/22350), `/forum/enter?token=` (A:39387–39388), `/?section=speaker&code=` (A:20962–20963, A:21039–21040), `/#mymedx` (A:2702–2703), `/verify/<b64>.<hmac>` (A:37632), `/plexus?claim=` (A:39068–39076) | member handlers §3 | all resolve on the member origin |
| 10 | member → admin | **none** — no HTTP call from the member backend to the admin backend anywhere (`ADMIN_PORTAL_URL` read once into an unused variable U:28495); the member SPA has one link-out P9:3693. The member portal *boots* admin code: `require('../../admin-portal/backend/demo-purge.js')` U:29463 | — | — |
| 11 | admin → Firestore picker | `picker-sync.js` Identity-Toolkit login as `PICKER_ADMIN_EMAIL/PASSWORD` (PS:87–88, PS:98); collections `invites/{token}`, `paid_emails/{sha256(email)}` (PS:48, PS:57–59), `tickets/{tid}` (PS:209); routes A:12872/12888/12904; invite link `https://plexus-tables.netlify.app/?t=<token>` PS:527 | member portal never touches Firestore; seats reach members via `gala_table_assignments` (CSV import A:12698) → U:13023 | `plexus-tables.netlify.app` 200 |
| 12 | both → Google Sheets | member-only `fetch(GOOGLE_SHEETS_WEBHOOK)` at U:671, 20496, 20847, 21013, 26924, 28345, 28805, 28991 (fire-and-forget) | admin never reads the var | unverified (silent) |
| 13 | both → Anthropic | `shared/ai.js` `aiDraft` AI:25 (model AI:28, 8 s, rate AI:35); member callers U:12564, U:13959; admin 29 callers + direct tool loops A:28941–28957, A:36664–36680, A:42256–42268 | key on admin only ⇒ member assistant runs in template mode (AI:84–89) | — |
| 14 | admin → member assets | `express.static('../../user-portal/frontend/assets')` mounted at `/photo-library` A:941; `require('../../user-portal/backend/fira-service')` A:21 | cross-directory coupling; `buildFilter` per service means `shared/*` edits deploy nothing (RY:16–18, RY:93–95) | — |

---

## 2. THE CHAIN — feature by feature

Column key: **admin action** (route + line) → **table(s)** → **member-visible effect** (route + line, UI section) → **website effect** (public route + `site.js` hook) → **live status today**.

### 2.1 Plexus registration (free conference; the ONE external form is `/plexus`)

| Step | Where | Evidence |
|---|---|---|
| Website CTA | 31 anchors `data-medx-reg="plexus-2026"` + 10 `plexus-gala-2026`, rewritten by `site.js applyRegLinks()` to `PORTAL/plexus?event=<slug>&ticket=<phase>&from=website[&mxt=<jwt>]`; `ticket` defaults to `site.conference.pricing_phase` (`early_bird` today) | WEBSITE audit §1A/§1I |
| Server-rendered wizard | `GET ['/plexus','/plexus/:token']` U:1295 → `PLEXUS_SHELL` U:1572; reads only `:token`/`?t=` (U:1295 → `registration_links` U:1302) and prefill `fn/ln/email/inst` (U:1392–1396); `event`, `ticket`, `from`, `mxt` are **ignored** on this path; offered components `conference|bridges|gala` from `component_keys` U:1307; Gala unit price `effectiveGalaPrice()` U:5712 (early-bird until `gala_settings.early_bird_deadline`, default `2026-09-01` U:5722; base price = `event_components.gala` U:5719) | member |
| Submit | `POST /api/plexus/register` U:19754 (`optionalAuth`; finds/creates the `users` row U:19763–19773) → `registrations`, `invoices`, FIRA (`FS:156`), welcome email with QR U:20001 (`buildEmailTemplate` U:425); two-step variant `POST /api/plexus/register/start` U:21321 + `/complete` U:21363; in-SPA form `PlexusPortal.submitRegistration` P9:9537 → same route | member |
| Card payment | `POST /api/plexus/checkout-session` U:20168 → Stripe → `POST /api/stripe/webhook` U:20243 fulfils, confirmation email with QR block U:20813–20826; return `?payment=success|cancelled&reg=<id>` U:20224 → `PlexusPortal.handleStripeReturn` P9:9822 | member |
| Admin sees / acts | list `GET /api/admin/plexus/registrations` A:20084 · edit `PUT /api/admin/plexus/registrations/:id` A:20059 · mark paid `POST /api/finance/conference-payments/:id/confirm` A:27078 (→ `registrations.payment_status`, `payment_transactions`, `invoices`, `finance_transactions`, optional FIRA A:27185) · resend ticket `POST /api/admin/registrant/:type/:id/resend-ticket` A:35517 · check-in `POST /api/checkin` A:33704, `POST /api/admin/checkin/ticket` A:32685, scan context `GET /api/admin/scan-context` A:11380 · transfer approve A:21380 · registration links §2.10 | admin |
| Member-visible effect | `GET /api/plexus/my-registration` U:21513 (Plexus tab "My Pass"), wallet `GET /api/my/events` U:13055 (`MyMedXPortal.renderMyEvents` P9:906 → `#mymedxMyEvents` IX:11666), nav chip `GET /api/me/next-event` U:23167 (P4:13 home hero + website chip), hosted QR `/qr/:id.png` U:4078 (`qrImageUrl` U:501), certificate after check-in `GET /api/plexus/my-certificate` U:22301 | member |
| Website effect | `GET /api/public/site` U:11943 → `conference.registration_open` (CTA closed state), `pricing_phase` (deep-link `ticket`), `price.current`, dates (countdown + JSON-LD); `GET /api/public/impact` U:12099 `registrations` count (build-time snapshot only) | `data-medx-cta`, `data-medx-reg`, `site:price.current`, `site:conference.*` |
| Live | `/plexus` 200 · `/plexus?event=plexus-2026&ticket=early_bird&from=website&mxt=probe` 200 · `/api/public/site` 200 (`registration_open` true, `pricing_phase` `early_bird`) · `/api/plexus/settings` 200 | probed 2026-08-28 |

### 2.2 Gala Evening — request → approve → pay (the only paid add-on)

| Step | Where | Evidence |
|---|---|---|
| Request | member `POST /api/gala/register` U:26870 (`optionalAuth`, `status='pending'`, `user_id` linked when signed in) → `gala_registrations`; rings every admin's bell `admin_notifications` U:26889; Sheets mirror U:26919; or as a component of the `/plexus` wizard (`pf_guests` IX-less, U:1426–1431, max +2 guests) | member |
| Admin approve | `PUT /api/gala/registrations/:id` A:30106 (also the member-origin twin U:26954): `status='approved'` mints `pay_token` A:30146–30149 and emails `${base}/#gala` + **`${base}/pay/gala/<pay_token>`** A:30125–30150 (twin email U:26964–26979 uses `PORTAL_URL`); pay-link JSON `GET /api/gala/registrations/:id/pay-link` A:30189 | admin |
| Pay | in-portal `GET /api/gala/my-status` U:27747 → Pay button (`GalaPortal.checkMyStatus` P9:11928, `startPayment` P9:12012) → `POST /api/gala/checkout-session` U:27786 (return `?payment=…&gala=<id>` U:27820 → P9:3481–3497); email pay-link `GET /pay/gala/:token` U:27871 (requires `status='approved'` U:27873, session U:27892) → Stripe → webhook U:20242 → `payment_status='paid'`, invoice, confirmation email | member |
| Price | `effectiveGalaPrice()` U:5712: `event_components(plexus/gala).price` or `gala_settings.price_gala_early_bird` until `early_bird_deadline` (default 2026-09-01), then `price_gala_regular`; admin edits via `PUT /api/admin/gala/settings` A:30009 (twin U:27001) and `PUT /api/admin/event-components/:id` A:36208 | both |
| Seats | admin `POST /api/admin/gala/tables` A:12628, assign A:12664, CSV import from the picker `POST /api/admin/gala/table-assignments/import` A:12698 → `gala_tables`, `gala_seat_assignments`, `gala_table_assignments` → member `GET /api/gala/my-seat` U:13023 (`MyMedXPortal._loadMemberData` P9:1008) | admin → member |
| Wallet | `GET /api/gala/my` U:27757 returns `qr_url:'/qr/<id>.png'` + payment/check-in state (`#mymedxQRCodes` IX:11676); Google Wallet ticket `GET /api/member/wallet/google/ticket/:regId` U:13383 (P9:2180); Apple stub U:13441 (flag off P9:2202) | member |
| Door | admin scanner `GET /api/admin/gala/scan/:regId` A:33437 → check-in `POST /api/admin/gala/checkin` A:33465 (member-origin twins U:27697/U:27725); universal `POST /api/admin/checkin/verify` A:32848 / U:27216 | admin |
| Refund | admin SPA AIX:43241 → member `POST /api/admin/payments/:kind/:id/refund` U:733 (`stripe.refunds.create` U:763) — cross-origin, needs identical `JWT_SECRET` | admin → member |
| Website effect | `GET /api/public/site` price fallback from `gala_settings` when no ticket has a non-zero early-bird price U:11970–11979; `content:gala.announcement` strip; `status:gala.*` card | site.js |
| Live | `/pay/gala/INVALID` 404 "Invalid payment link" · `/api/gala/settings` 200 · Stripe live key | probed 2026-08-28 |

### 2.3 Speakers · program · sponsors publishing

| Object | Admin action (write) | Table | Member-visible (read) | Website | Live |
|---|---|---|---|---|---|
| Speakers | `POST /api/admin/plexus/speakers` A:20290 · `PUT …/:id` A:20437 · `PUT …/:id/publish` A:20844 · import A:20888 · invite A:20936 (link `/?section=speaker&code=` A:20962–20963) · delete A:20485 (member-origin twins U:22471, U:22611, U:22666) | `speakers` (`is_confirmed`, `is_published`, `bio`, `photo_url`, `talk_title`, `is_keynote` U:6231) | `GET /api/plexus/speakers` U:22208 (safe columns) → `PlexusPortal.loadSpeakersFromDB` P9:8891; speaker self-service `POST /api/speakers/auth` U:27914, docs U:27981–28029 (SpeakerPortal P9:19519) | `/api/public/site` `speakers[]` U:11943 → `data-medx-list="site:speakers"` (hidden while names == baked keynotes) | `/api/plexus/speakers` 200 |
| Sessions (program) | `POST /api/admin/plexus/sessions` A:20183 · `PUT …/:id` A:20216 · `…/publish` A:20250 (inserts a `user_notifications` broadcast) · `bulk-publish` A:20267 · rooms `POST /api/admin/plexus/rooms` A:34655 (twins U:21744, U:21761, U:21791, U:21803) | `sessions`, `session_tracks`, `venue_rooms` | `GET /api/plexus/schedule` U:21721, `GET /api/plexus/sessions` U:28127 (`PlexusLiveBoard` poll P14:318), session detail U:21822, my-schedule add/remove U:21848/U:21858, Q&A U:21899–21922 | none (static program on medx.hr) | `/api/plexus/schedule` 200 |
| Sponsors / supporters | `POST /api/admin/plexus/sponsors` A:21128 · `PUT …/:id` A:21147 · `…/publish` A:21171 · delete A:21163 (twins U:22800, U:22815, U:22832) | `sponsors` (`category`, `logo_url`, `website`, `is_published`) | `GET /api/plexus/sponsors` U:22221 | `GET /api/public/supporters` U:12141 (logo → absolute member-origin URL U:12153–12166) → `data-medx-list="supporters:wall"`; **CORP `same-origin` on `/assets/supporters/*` blocks cross-origin `<img>` — masked today by baked tiles** | 200, 25 rows |
| Talks | `POST /api/admin/talks` A:12498 (twin U:14178) | `talks` | `GET /api/talks` U:14010 (`TalkLibrary` P9:47831) — **removed in the redesign (README note 16)** | none | — |
| Conference facts + tickets | `POST /api/admin/conferences` A:11027 · `PUT …/:id` A:11120 · `…/:id/activate` A:11139 · tickets A:11077/A:11096 · `PUT /api/admin/plexus/settings` A:34551 | `conferences`, `ticket_types`, `plexus_settings` | `GET /api/plexus/conference` U:19707, `GET /api/plexus/settings` U:28105 (key dates + testimonials JSON → P9:8775) | `/api/public/site` `conference.*`, `price.*`, `deadline.*`, `tickets[]` | 200 |

### 2.4 Project status · content blocks · portal content

| Object | Admin action | Table | Member-visible | Website | Live |
|---|---|---|---|---|---|
| Project status cards | `PUT /api/admin/project-status/:key` A:11770 | `project_status` (status_label, status_kind, detail_line, cta_label, cta_target U:9552) | `GET /api/project-status` U:14062 → `MedXSectionStatus` P8:10 (`[data-mx-status]` heroes) and `MedXProjectHub` P6 cards | `GET /api/public/status` U:12075 → `data-medx-slot="status:*"`, `data-medx-status-dot/cta` (`_hr` fields null today) | 200 |
| Website copy blocks | `PUT /api/admin/content-blocks/:key` A:11940 (whitelisted seeded keys; twin U:12373) | `content_blocks` (7 keys incl. `global.members_prompt` U:10538) | member portal seeds only (U:10538); no member UI reads them | `GET /api/public/content` U:12048 → `data-medx-slot="content:*"`, `data-medx-strip`, members bar | 200, all bodies empty except `global.members_prompt` |
| Project dates/venue | `PUT /api/projects/:project/settings` A:17991 (twin U:18999) | `project_settings` (event_date, end_date, venue, location, description U:7216) | admin-only read `GET /api/projects/settings` U:18983 — **no member endpoint**; member countdowns hardcode dates (`MEDX_DATES` P9:7) | none | — |
| Featured carousel / portal content | `POST /api/portal-content` A:33888 · publish A:33923 · reorder A:33933 | `portal_content` (section, project, title, content, image_url, link U:9284) | `GET /api/portal-content/published/:section` U:28097 → `FeaturedCarousel.loadFromAPI` P9:5561 (`#featuredCarouselTrack` IX:2914); `/published` U:28091 → `SharedData` P9:46905 | admin twin routes A:33944/A:33950 (unused by site) | 200 |
| Plexus wizard copy | `PUT /api/admin/plexus/page-text` A:30079 | `plexus_page_settings` | `/plexus` server page U:1326–1336 | none | — |
| Org signature | `POST /api/admin/org/signature` A:38426 | `org_settings` | `GET /api/org/signature` U:12066 → certificate download P9:1245 | — | — |

### 2.5 Press (newsroom)

| Step | Where |
|---|---|
| Admin | `POST /api/pr/press-releases` A:28264 (EN/HR pair) · `PUT …/:id` A:28298 · `POST …/:id/publish` A:28326 · `unpublish` A:28338 · delete A:28348 · AI draft A:28213 · send to media list A:28524 |
| Table | `press_releases` (**admin-only**; the member portal never reads it) |
| Member | none |
| Website | `GET ADMIN/api/public/press` A:11859 → `data-medx-list="press:releases"` on `press` + `hr/press`; card link → `ADMIN/api/public/press/<slug>` A:11884 (site-styled HTML, newsroom back-link `SITE_PUBLIC_URL` A:28123) |
| Live | `releases: []` → baked cards stay; `/api/public/press/no-such-slug` 404 |

### 2.6 News (member feed) · announcements

| Object | Admin action | Table | Member-visible | Website |
|---|---|---|---|---|
| Feed items ("Latest from Med&X") | `POST /api/admin/feed-items` A:12397 · `PUT …/:id` A:12411 · delete A:12431 (twins U:14104–14137) | `feed_items` (type, title, body, link_url, link_label, image_url, posted_at, published U:9402) | `GET /api/feed/home` U:13892 (feed + broadcast announcements + forum posts + AI summary) / flat `GET /api/feed` U:13858 → `MemberFeed.load` P9:47095 → `#newsCompactList` IX:3020 | none — README note 13 ("publish once, two destinations") has no data path today: website news = `press_releases` (admin) or `content:homepage.news_banner` block |
| Member announcements (bell) | `POST /api/admin/member-announcements` A:11985 · delete A:12036 | `member_announcements` (project_key, push, push_fanned U:9578) | `GET /api/announcements` U:23211 (audience-gated by `notify_topics`), `GET /api/bell-feed` U:23102; push fan-out U:257–298 | website bell (`/api/bell-feed`) |
| Conference announcements | `POST /api/admin/announcements` A:18986 (twin U:19656) | `announcements` | `GET /api/plexus/announcements` U:22228, `GET /api/conferences/:confId/announcements` U:13836 | none |
| Opportunities (curation) | `PUT /api/admin/opportunities/:id` A:12475 (twin U:14154) | `opportunities` | `GET /api/opportunities` U:13980, member submit U:13988 (`OpportunityBoard` P9:47251) | none |

### 2.7 Accelerator applications

| Step | Where |
|---|---|
| Member wizard (existing 7-step) | markup IX:7238–7640 (`ax-checklist` IX:7240, stepper IX:7281–7315, steps `#ax-wizard-step-1…7`, review IX:7580–7626); logic `AcceleratorPortal` P9:12265–14093: `updateChecklist` P9:13154, `nextStep` P9:13308, `prevStep` P9:13327, `validateStep` P9:13340, `saveDraft` P9:13419 (localStorage `ax_application_draft`), `loadDraft` P9:13426, `collectFormData` P9:13443, `updateReview` P9:13468, `submitApplication` P9:13494, `generateReviewPDF` P9:13823 |
| Member API | draft `POST /api/accelerator/applications` U:14586 · documents `POST …/:id/documents/:docType` U:14628 (multer → Cloudinary `cloudUpload` U:5570; **503 in prod without `CLOUDINARY_URL`** U:5540–5547) · submit `POST …/:id/submit` U:14769 (confirmation email + director notify) · my application U:14531 / `GET /api/accelerator/my-applications` U:16377 (`loadAppStatus` P9:12552) · package PDF U:14824 · fee `POST /api/accelerator/checkout-session` U:15060 (75 EUR; return `?payment=…&type=accelerator&app=` U:15078) · public `POST /api/accelerator/apply` U:15207 (unauthenticated) · intake pipeline U:16760–16909 (`AcceleratorIntake` P9:14094) · applicant portal `/apply` U:24062 (applicant JWT U:23450) |
| Admin review | applications A:13671 · full A:13692 · validity A:13794 · message A:13757 → `accelerator_messages` · criteria A:13855/13867/13878 · scores A:13887/13908 · Review Room `/api/admin/review/*` A:14297–15109 (rubric A:14320, assignments A:14529/14563, decisions A:14973, decision letters queue A:15069 / batch A:15092, funnel A:15109) · interviewers A:15149, send link A:15420 (magic link `/evaluate?token=` on the ADMIN origin A:15438, page A:24551) · rankings A:15777 / publish A:15799 (**phantom `notifications` insert A:15819 — applicants never notified**) · result codes `POST /api/admin/accelerator/result-codes` A:15838 · legacy review `PUT /api/admin/accelerator/applications/:id/review` A:18784 · export A:18825 |
| Tables | `accelerator_applications`, `accelerator_documents`, `accelerator_messages`, `accelerator_evaluations`, `accelerator_interviewers`, `accelerator_result_codes`, `submission_pipeline`, `intake_windows` |
| Member-visible effects | status/decision + messages via U:14531 (reads `accelerator_messages` U:15197); results `GET /api/accelerator/results?code=` U:16393 (`unlockResults` P9:13756, `#axResultsCode` IX:7668); key dates `GET /api/accelerator/key-dates` U:23255 (P9:12401) and countdown U:23270 (P9:12807) ← admin `POST /api/accelerator/years/:year/dates` A:13535, `PUT /api/accelerator/dates/:id` A:13561, delete A:13589; institutions `GET /api/accelerator/institutions` U:14529 ← A:13657/A:13645/A:13612; host sites `GET /api/accelerator/sites` U:14548 ← A:12051/A:12067/A:12086; overview copy `GET /api/accelerator/overview-config` U:23317 ← A:13511 |
| Website | `status:accelerator.*` card, `content:accelerator.announcement`; CTA "Go to the Med&X portal" (static) |
| Live | `/api/accelerator/key-dates` 200 · `/api/accelerator/sites` 200 · `/apply` 200 on both origins · admin `/evaluate?token=INVALID` 200 (shell), `/review?token=INVALID` 200 |

### 2.8 Forum admission (Biomedical Forum)

| Step | Where |
|---|---|
| Public interest | website form → `POST /api/public/forum-consideration` U:4329 → `forum_considerations` (Netlify Forms fallback if the portal errors) |
| Admin decides | `GET /api/admin/forum/considerations` A:39410 · approve A:39425 / decline A:39441 · candidates pipeline import A:39591/A:39615, verify A:39706, accept `POST /api/admin/forum/candidates/:id/accept` A:40209 → `forumAdmitAndInvite` A:39380–39388: `forum_members.membership_status='approved'` + `forum_magic_tokens` row (14-day) + email `${base}/forum/enter?token=<48-hex>`; applications from the SPA approve `PUT /api/admin/forum/applications/:id` A:16761 (twin U:17789) |
| Member enters | `GET /forum/enter?token=` U:4163 (single use, mints member JWT, redirects `/forum?mxt=`) → `forum-wing.html` (`FW:511` adopts `mxt`; `Wing.boot` → `GET /api/forum/wing/me` U:4277); SPA Forum section `GET /api/forum/me` U:16927, `POST /api/forum/apply` U:16935; directory U:4349/U:16984; convenings reserve `POST /api/forum/wing/convenings/:id/reserve` U:4407; gathering registration `POST /api/forum/events/:id/register` U:17368 (paid → checkout U:17483), AF26 `POST /api/af26/register` U:18607 |
| Invitation codes | `forum_invitations.invitation_code` created by `POST /api/admin/forum/invitations/send` U:18080 / `send-bulk` U:18100 (**no email sent**, member-origin admin routes); **no member route redeems a code** — the SPA checks hard-coded demo codes `MEDX2026|FORUM2026|BIOMEDICAL|MEMBER` P9:15017–15020 |
| Forum feed | `forum_posts` (post_type, tags, is_pinned U:6663) via `GET /api/forum/posts` U:17228, moderation `PUT /api/admin/forum/posts/:id` A:17183 (twin U:18011); `forum_news` (member-portal only, read in `/api/forum/wing/me` U:4286) |
| Events publish | `PUT /api/admin/forum/events/:id/publish` A:16965 (inserts `user_notifications`) → `GET /api/forum/events` U:17338 |
| Website | `/forum` link (static), `forum.announcement` block, `status:forum.*` |
| Live | `/forum` 200 · `/forum/enter?token=INVALID` 200 (notice) · `/api/public/forum-consideration` POST-only |

### 2.9 Notifications · bell · push · messages

| Channel | Admin writer | Table | Member reader / delivery |
|---|---|---|---|
| User notifications | `POST /api/admin/notifications/send` A:22948 (`createUserNotification` A:22925; push → `push_outbox` A:22968); list/delete A:22934/A:22982; forum event publish A:16965; outbox approve mirror A:38695; session publish U:21791 | `user_notifications` (user_id/user_group, category, link, is_read U:7259) | `GET /api/user-notifications` U:23057 (returns `unreadCount`), read U:23081, mark-all U:23088 → `Dashboard.toggleNotifications` P9:6839, `NotificationSystem.loadNotifications` P9:52719; website bell via `GET /api/bell-feed` U:23099 |
| Web Push | admin enqueues `push_outbox` A:22968, A:34343, A:39200, A:41860 | `push_outbox`, `push_subscriptions` | member `drainPushOutbox` U:200–224 (45 s, U:29487–29489) with VAPID U:573–577; subscribe `POST /api/push/subscribe` U:23021 (`MedXPush._persist` P9:52389); SW push/click handlers SW:121–161; default URL `/?app=1` |
| Member announcements | `POST /api/admin/member-announcements` A:11985 | `member_announcements` | `GET /api/announcements` U:23211; fan-out U:257–298 |
| Direct messages (admin ↔ member) | `POST /api/admin/messages` A:34328 (+push A:34343), bulk A:34355, thread A:34407, list + AI triage A:34302, draft reply A:34263 | `direct_messages` (sender_type/receiver_type/title/is_read added U:9271–9275; receiver_id = email for admin→member) | `GET /api/user/admin-messages` U:28050, read U:28060, reply `POST …/:id/reply` U:28071 (`NetworkingPortal.openAdminMessages` P9:17184, `replyToAdmin` P9:17185); member↔member `POST /api/messages` U:26727, list U:26778 (no unread count), thread U:26808 |
| Member → admin | gala request bell U:26889; `POST /api/assistant/escalate` U:12673; `POST /api/purchases/inquiry` U:12479; `POST /api/accelerator/ask-coordinator` U:14563 (all → `direct_messages`, sender_type `user`) | `admin_notifications`, `direct_messages` | admin bell `GET /api/notifications` A:22850; Action Center scan `runNagScan` A:1838 → `nag_items` |
| Email | 58 admin outbox writers → `scheduled_emails` → `drainScheduledEmails` A:43350 → Brevo A:105; member direct sends U:75; member stages 10 row kinds (U:11383…) drained only by the admin in prod (dev drainer U:29516–29540) | `scheduled_emails` | delivered on prod (Brevo key set); dropped on staging by design |

### 2.10 Invites · registration links · sign-up forms · guest passes

| Kind | Admin creates | Table | Member/guest lands on | Then |
|---|---|---|---|---|
| Plexus registration link | `POST /api/admin/registration-links` A:36226 (URL A:36277–36294: plexus → `/plexus/<token>`, other event types → `/invite/<b64 {t,e,n,i,p,x}>`), list A:36304 (adds `.url` A:36317–36325), deactivate A:36335 | `registration_links` | `GET /plexus/:token` U:1295 (U:1302–1307) · `GET /invite/:data` U:3257 | `POST /api/register-invite` U:28458 → Stripe → `GET /invite-success` U:804 / `/invite-cancelled` U:972; direct `GET/POST /api/register-direct/:token` U:29027/U:29059 |
| Gala VIP / price-override | `POST /api/admin/gala/invite-links` A:30452 (builder A:30440–30449; twin U:27052) | `gala_invite_links` | `/invite/<b64>` U:3257 | gala pre-filled request |
| Croatians abroad / international | `POST /api/admin/croatians-abroad/invite-links` A:30524 (twin U:27128) | `croatians_abroad_invite_links` | `/invite/<b64>` | `POST /api/croatians-abroad/register` U:28159 (multi-event, Stripe for gala) |
| Combo invite (admin-hosted) | `POST /api/admin/plexus/combo-links` A:30971 | — | `GET /e/:token` A:31136 on the ADMIN origin | CTAs `/plexus/<token>` A:31115, `/donor-night` A:31118 |
| Sign-up forms | `POST /api/admin/signup-forms` A:30715 · promote waitlist A:30856 | `signup_forms`, `signup_form_responses` | `GET /f/:slug` U:2366 (+ `/qr.png` U:2352, `/calendar.ics` U:3207) | `POST /api/signup-forms/:slug/submit` U:29229 (ticket email with QR) |
| Guest passes (VIP) | `POST /api/admin/guest-passes` A:22389 · send A:22469 | `vip_passes` | `GET /pass/:token` U:5366 (+ manifest U:5344, ics U:3230) | zero-login pass page |
| Member guest passes | member `POST /api/guest-passes` U:12851 (revoke U:12921); admin list/revoke A:33212/A:33250 | `guest_passes` | `/pass/<token>` | — |
| Speaker links | invite A:20936 / upload link A:21026 → `/?section=speaker&code=` (boot P9:3391–3399); itinerary A:22137 → `/speaker/:token` U:5097 | `speakers`, `speaker_itineraries` | `POST /api/speakers/auth` U:27914 | — |
| Live | `/invite/probe` 200 (notice page) · `/f/no-such-slug` 404 · `/pass/INVALID` 404 · `/speaker/INVALID` 404 · admin `/e/INVALID` 404 · `/api/register-direct/INVALID` 404 | | | |

### 2.11 Donations

| Step | Where |
|---|---|
| Website | `donate.html` builds `PORTAL/donate/checkout?src=medx.hr&amount=<n>&frequency=once|month|year&designation=<key>` and opens it (`window.open`) |
| Member backend | `GET /donate/checkout` U:5414 — limiter `donateCheckoutLimiter` U:5410–5413 (30/15 min → `302 …?checkout_error=1` U:5412); clamps amount 1…50000 U:5421–5423; `DONATION_DESIGNATIONS` U:5400–5407 (`unrestricted, accelerator, plexus, gala, forum, bridges`); Stripe session U:5433–5454 with `metadata.type='donation'`; **hardcoded** `success_url https://medx.hr/donate?thanks=1` U:5452 / `cancel_url …?cancelled=1` U:5453; `303` to Stripe U:5455; failure → `302 …?checkout_error=1` (`fail` U:5415–5418) |
| Fulfilment | webhook branch `metadata.type === 'donation'` U:20645 |
| Admin | read-only Stripe list `GET /api/finance/stripe-payments/recent` A:26875 (`STRIPE_READONLY_KEY || STRIPE_SECRET_KEY` A:26753); transparency board pack A:22639–22655 |
| Member portal | `GET /api/member/giving` U:13673 (Donor Night supporter status from `bridges_registrations`) |
| Website effect | toasts on `?thanks|cancelled|checkout_error` (donate.html inline); `/api/public/impact.charity_giving` from `auction_items` U:12124 |
| Live | `/donate/checkout?…` 303 → `checkout.stripe.com/c/pay/cs_live_…`; `medx.hr/donate?thanks=1` 200 |

---

## 3. Inbound forever-URLs (already in inboxes, QR codes, calendars, wallets, print)

Legend: **owner** = which service must keep serving the path. **Live** = today's GET probe with a bogus token unless stated (every route below exists at HEAD, and live member = repo).

| URL | Owner | Route | Credential / reads | Live today |
|---|---|---|---|---|
| `/qr/<uuid>.png` | member | U:4079 (`QR_BASE_URL` U:500) | id regex U:4082, resolves across registration tables | 404 JSON for an unknown id |
| `/pay/gala/<token>` | member | U:27871 | `gala_registrations.pay_token`, needs `status='approved'` U:27873 | 404 "Invalid payment link" |
| `/invite/<b64>` | member | U:3257 | `{e,x,i}` / `{t,x,n,vip,po}` payloads, `freshSync()` first | 200 "Invitation Not Valid" notice |
| `/invite-success?session_id=` · `/invite-cancelled` | member | U:804 · U:975 | Stripe session | 200 · 200 |
| `/plexus`, `/plexus/<token>` | member | U:1295 | `registration_links.token` | 200 |
| `/f/<slug>` (+`/qr.png`, `/calendar.ics`) | member | U:2366 (U:2352, U:3207) | `signup_forms.slug` | 404 for unknown slug |
| `/pass/<token>` (+`/manifest.json`, `/calendar.ics`) | member | U:5366 (U:5344, U:3230) | `vip_passes`/guest pass token, `revoked`, expiry | 404 |
| `/speaker/<token>` (+`/manifest.json`), `/api/public/speaker-itinerary/<token>` | member | U:5097 (U:5071), U:5120 | `speaker_itineraries` token (admin-written A:22137) | 404 |
| `/verify/<token>` · `/r/<token>` | member | U:2720 · U:2909 | badge / share HMAC tokens (neutral page on failure) | 200 · 200 |
| `/verify-certificate?n=` | member | U:22262 | `certificates.certificate_number` | 404 for unknown |
| `/api/auth/verify?token=` · `/api/verify-email?token=` | member | U:11701 · U:11256 | `email_verifications` / `users.verification_token` | 302 → `/?verified=invalid` |
| `/reset-password/<token>` (+ `POST /api/auth/reset-password`) | member | U:11789 (U:11858) | `users.reset_token` | 200 "Link Invalid or Expired" |
| `/unsubscribe?e=&s=` · `/email-prefs?e=&s=` · `POST /api/email-prefs` | member | U:1860 · U:1830 · U:1837 | HMAC `emailPrefSig` U:1777 | `/email-prefs` bad sig → 400 |
| `/calendar/medx-events.ics` · `/calendar/<slug>.ics` | member | U:3147 · U:3191 | none | 200 · `/calendar/plexus.ics` 200 |
| `/forum` · `/forum/enter?token=` | member | U:4155 · U:4163 | `forum_magic_tokens` (single use) | 200 · 200 (notice) |
| `/?section=speaker&code=` · `/?mxt=` · `/?verified=` · `/?payment=…&reg|app|gala=` · `/?invite=` · `/?register=` · `/?app=1&view=ticket|schedule` | member SPA | boot P9:3362–3512 (`invite` P9:3368, `register` P9:3369, `section=speaker` P9:3391–3399, `verified` P9:3403–3434, `payment` P9:3438, `view` P9:3455, `gala` P9:3481); `mxt` IX:54 | localStorage `medx_user_token` | 200 |
| `/building-bridges` · `/donor-night` · `/terms` · `/privacy` · `/apply` · `/evaluate` | member | U:1764 · U:1765 · U:1029 · U:1073 · U:24062 · U:23705 | — | all 200 |
| `/evaluate?token=` (interviewers) · `/review?token=` (external reviewers) · `/apply?verify=` (applicants) | **admin** | A:24551 · A:24377 · A:24908 (verify link A:24032–24033) | `accelerator_interviewers.access_token`, reviewer token, applicant token | 200 · 200 · 200 |
| `/e/<token>` (combo invite) · `/a/<token>` (auction) | admin | A:31136 · A:31645 | combo/auction tokens | 404 · 404 |
| `/api/public/confirm-seat?token=` · `/claim-seat?token=` · `/feedback?token=&score=` · `/api/public/survey?t=` (member) | admin (member for survey) | A:39045 · A:39062 · A:39098 · U:12211 | `seat_confirmations`, `waitlist_offers`, `event_feedback`, `event_survey_responses` | 404 · 404 · 404 · (not probed) |
| `/newsletter` · `POST /api/public/newsletter/subscribe` | admin | A:23770 · A:23777 | — | 200 |
| `/api/public/press/<slug>` | admin | A:11884 | `press_releases` | 404 for unknown |
| `/?gd=<token>` (game-day volunteer) | admin SPA | AIX:17751 (link A:42890–42891) | `gameday_invites` | — |
| `https://plexus-tables.netlify.app/?t=<token>` (picker invite) | external Netlify site | PS:527 | Firestore `invites/{token}` | 200 |
| `https://medx.hr/donate?thanks=1|cancelled=1|checkout_error=1` | website | U:5452–5453, U:5414 | — | 200 |
| `/photo-library/*` (member assets on the admin origin) · jsDelivr `EMAIL_LOGO_URL` U:302 | admin · CDN | A:941 | — | — |

---

## 4. Credentials & environments inventory

### 4.1 Where each secret lives today

| Credential | On this Mac | On Render (service) | In GitHub Actions | Consequence of the gap |
|---|---|---|---|---|
| `JWT_SECRET` | — (no `.env` files exist locally; only `user-portal/backend/.env.example`, which is stale) | both, `generateValue: true` **per service** RY:24–25, RY:101–102 | — | if the two values differ, admin→member cross-origin calls (gala refund AIX:43241 → U:736, Live Q&A AIX:53718) 401; unverifiable from the repo |
| Turso `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | turso CLI installed (`~/.turso/turso`), login state unknown | both, **DB-scoped token** (cannot create DBs) | `secrets.TURSO_AUTH_TOKEN` = a **platform** token used as `TURSO_API_TOKEN` (turso-backup.yml:31–32; predeploy-backup.yml), plus `vars.TURSO_DB_NAME` (default `medx-portal` ≠ prod name → must be set to `medx-portal-alen-ops99`) | no platform token on the Mac or Render ⇒ no branch DB / preview DB can be created from either; backups depend on the Actions secret alone |
| Render dashboard / API | no CLI, no API key file (`~/.render`, `~/.config/render` absent) | n/a | — | env changes only by browser login; nothing here can be scripted |
| Stripe | Stripe CLI config present (`~/.config/stripe/config.toml` with `test_mode_api_key`/`test_mode_pub_key` entries — CLI keys, expiry unknown); **no portal `STRIPE_*` keys locally** | member: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (live key confirmed by the donate 303 → `cs_live_…`); admin: `STRIPE_READONLY_KEY`/`STRIPE_SECRET_KEY` read A:26753 but **not declared** RY | — | no test-mode keys anywhere ⇒ a redesign preview cannot exercise checkout without touching live money; missing webhook secret would make payments succeed at Stripe with no fulfilment (U:20248–20251) |
| Brevo `BREVO_API_KEY` | — | **present on both prod services** (Render env, verified 2026-08-28; undeclared in render.yaml) — missing only on staging by design ⇒ `[EMAIL DROPPED]` U:126–128 / A:128–131, HTML dumped to `EMAIL_DUMP_DIR` U:135–141 | — | prod email works; `RESEND_API_KEY` in RY:27/RY:104 is read by nothing (stale) |
| VAPID | public key committed RY:32–33; private **not** on the Mac | member: `VAPID_PRIVATE_KEY` (sync:false) — live `/api/push/vapid-key` returns the key ⇒ set | — | push works in prod only; a preview host cannot send push |
| Google Wallet `GOOGLE_WALLET_SA_KEY` | — | both (sync:false), presence unverified today; issuer/class ids committed RY:73–77 | — | when absent, `/api/member/wallet/google*` return `{configured:false}` U:13298–13302 |
| Apple Wallet certs (`APPLE_WALLET_*`) | — | — (nowhere) | — | Apple route is a stub U:13441 / WL:272 ("coming soon" P9:2202) |
| Cloudinary `CLOUDINARY_URL` | — | member: not declared in RY; if unset in prod every multipart POST/PUT/PATCH is **503** U:5528–5547 (admin: same 503 flag A:945–965) | — | applicant/speaker/profile uploads depend on it; verify in the dashboard before launch |
| `CME_ENC_KEY` | — | undeclared (U:5655, A:2013) | — | CME/HLK personal data (DOB, OIB) stored **plaintext** when unset |
| Anthropic | — | admin only | — | member FAQ assistant and feed summary run in template mode (AI:84–89) |
| FIRA `FIRA_API_KEY` | — | member (sync:false); admin reads via the imported module | — | demo mode = no fiscal invoice (FS:148–151) |
| Google Sheets `GOOGLE_SHEETS_WEBHOOK` | — | member, undeclared | — | mirroring silently off when unset |
| Firestore picker `PICKER_ADMIN_EMAIL/PASSWORD` | firebase-tools login state present (`~/.config/configstore/firebase-tools.json`) | admin (sync:false) | — | seat-picker sync no-op when unset (PS:94) |
| Amadeus, Publer, Meta, MS Graph | — | admin (Amadeus declared; others undeclared) | — | 503 key-gate / not_configured / mock (§5 of the admin audit) |
| `TECH_PASSWORD`, `FOUNDER_RESET_PW` | — | admin, undeclared | — | tech tools 503 when unset; founder reset runs on every boot while set (A:8865–8869) |
| GitHub | `gh` logged in as `alen-ops99` (keyring) | — | `GITHUB_TOKEN` (uptime issues) | can dispatch workflows / set secrets from here |
| Netlify | API token used by today's website audit (not in repo; `netlify` CLI absent) | — | — | digest deploys possible from this Mac |
| AWS | `~/.aws/credentials` present (unrelated to the portals) | — | — | — |
| Local DBs | `shared/medx_portal.db`, `user-portal/backend/medx_portal.db`, `user_portal.db` all **0 bytes** | — | — | a local boot creates an empty schema; `DEV_AUTH_ENABLED` only with `NODE_ENV=development` and no Turso URL (U:6078) |

### 4.2 Environments

| Environment | What exists | Notes |
|---|---|---|
| Production | Render `medx-user-portal` + `medx-admin-portal` (Starter, oregon, `main`, autoDeploy), Turso `medx-portal-alen-ops99`, Netlify `medx-website-preview` (medx.hr) | `buildFilter` = `user-portal/**` / `admin-portal/**` (RY:16–18, RY:93–95): edits to `shared/*`, `scripts/*`, `render.yaml` deploy nothing |
| Staging | none (smoke.yml comments reference `staging.medx-user-portal.onrender.com`; it does not exist) | a preview needs its own Turso DB (platform token) + its own CORS entries |
| Review copies | Netlify `medx-member-portal-review` (`66cb26d8…`) and `medx-admin-portal-review` (`0261b147…`), static, 2026-08-20 | `medx-member-portal-review.netlify.app` is **not** in the member CORS allowlist U:586–595 (live probe: no ACAO) |
| Gateway / landing | Render `medx-gateway` (free, `landing/serve.js`); `pages.yml` also publishes `landing/` to GitHub Pages | — |
| Local dev | ports 3000/3001/8899 allowlisted U:592; admin `userPortalBase()` dev default 3010 (A:803–811) while the admin SPA uses 3001 (AIX:46981, AIX:43241) and 3010 (AIX:53709) | two dev-port conventions |

---

## 5. Risk register

Severity: **H** = data exposure or money/comms failure · **M** = silent feature failure · **L** = hygiene. "Blocks redesign?" = must be fixed before or during the member redesign go-live.

| # | Risk | Sev | Evidence | Suggested fix | Blocks redesign? |
|---|---|---|---|---|---|
| R1 | **Unauthenticated PII route** `GET /api/public/registrations/:email` returns all of a person's conference/forum/gala/bridges registrations to anyone with the email; consumed server-side by the admin | H | U:29190–29226 (no auth, no limiter); caller A:11341 | require a shared service header (e.g. `x-service-key` from a new env on both services) or move the lookup into the admin's own DB query (it already has the tables); add `publicLimiter` | yes — do not ship the new portal with it open |
| R2 | **Unauthenticated member lookup** `GET /api/members/verify?id=|email=` returns id/email/name | H | U:26841–26872 | put behind `auth, adminOnly` (its only legit caller is the admin scanner) or accept only the signed badge token from `/verify/:token` U:2720 | yes |
| R3 | **Picker console key in source and served HTML** `https://plexus-tables.netlify.app/admin.html?key=medx-smaragdna-x7k9q4t2`; the two iframes are also blocked by the admin CSP `frame-src` | H | A:42704; AIX:13302, AIX:13305, AIX:13331; CSP A:919–922 | rotate the key on the picker site; serve the console link from an env-backed admin route; add `plexus-tables.netlify.app` to `frame-src` or drop the iframes | no (admin only), but rotate before the admin redesign |
| R4 | **Fixed founder temp password in source** (`MedX-Unlock-2026`, applied once per DB via `founder_recovery_log`) and `FOUNDER_RESET_PW` re-applied on every boot while set | H | A:8874–8890 (marker A:8880, reset A:8882–8886); A:8865–8869 | remove both blocks now that the lockout is over; a restored DB copy without the marker re-applies the fixed password | yes for any DB restore / preview DB |
| R5 | **`CME_ENC_KEY` undeclared ⇒ CME/HLK data (DOB, OIB) plaintext**; `CLOUDINARY_URL` undeclared ⇒ every multipart upload 503 in prod when missing | H / M | U:5654–5657, A:2013; U:5528–5547, A:945–965 | declare both in `render.yaml` (`sync:false`) and set them; add an admin System-Health check that fails when absent | yes (profile-photo upload, documents) |
| R6 | **Shared `JWT_SECRET` assumption** for the two admin→member cross-origin clients while `render.yaml` generates one secret per service | H | AIX:43241 → U:736; AIX:53718 → U:21936–21982; RY:24–25, RY:101–102; comment U:13853 | either set one value in both dashboards and document it, or replace the cross-origin calls with admin-origin routes (the admin already owns the same tables) | yes if the redesigned admin keeps refunds/Q&A |
| R7 | **`BREVO_API_KEY` is undeclared in render.yaml** (set only in the Render dashboard on both services — a Blueprint re-sync or new service silently loses email) | M | Render env vs RY:27/RY:104 (`RESEND_API_KEY` declared but unread) | declare `BREVO_API_KEY` (sync:false) in render.yaml, remove the stale `RESEND_API_KEY`; add the outbox drain to uptime checks | no — prod email works today; staging drops email by design |
| R8 | **Stale smoke test** fails daily: greps `index.html` for `window.MEDX_DATES` and `window.location.pathname.match`, which live in `app.part9.js` since the split | M | SM:43–50; P9:7, P9:4925; live `index.html` has 0 hits | point the two checks at `/assets/app.part9.js` (or any part) and keep the SW regex SM:93–95; keep it green so real failures are seen | no, but fix before relying on CI for the redesign |
| R9 | **`heritage.medx.hr` → 404** (DNS A records at Vercel; Netlify site `medx-heritage` claims the domain, ssl off) | L | WEBSITE audit §2D/§3 | either point the A/CNAME at Netlify and enable SSL, or delete the Netlify site and stop advertising the host | no |
| R10 | Phantom table insert on ranking publish: `INSERT INTO notifications` (never created) inside try/catch ⇒ applicants are never notified | M | A:15819 | write to `user_notifications` (+ `push_outbox`) instead | no (admin) |
| R11 | Member Settings "Save changes" never calls the backend (`// TODO: Send to backend API`); photo upload is preview-only; profile completeness computed from localStorage | M | P9:23882–23930, P9:23933–23947, P9:48739–48760; backend `PUT /api/auth/profile` U:11925 exists | wire the new Profile screen to `PUT /api/auth/profile` + a new photo route (see gap matrix) | yes (Profile screen) |
| R12 | Forum invitation code is validated client-side against hard-coded demo codes | M | P9:15017–15020; codes exist server-side in `forum_invitations` (U:18089) but no redemption route | add `POST /api/forum/redeem-code` (see gap matrix) | yes (Forum screen) |
| R13 | `/api/public/site` is the only public read with no limiter and no cache header (registered before `publicLimiter` exists) | M | U:11943 vs U:12030 | register after the limiter and add `publicCacheHeaders` | no |
| R14 | Supporter logos served with `Cross-Origin-Resource-Policy: same-origin` ⇒ the first supporter without a baked tile renders broken on medx.hr | M | helmet default U:602–645; `/api/public/supporters` logo URLs U:12153–12166 | set CORP `cross-origin` for `/assets/supporters/*` (or serve logos from Netlify) | no |
| R15 | Admin-origin `/api/public/content` and `/status` omit `body_hr`/`*_hr` (unlike the member twins the site uses) | L | A:11818, A:11837 vs U:12048, U:12075 | either delete the admin twins or align shapes; never point `site.js` at them | no |
| R16 | Live member allowlist is hardcoded (review host `medx-member-portal-review.netlify.app` gets no ACAO); the fix (`CORS_ORIGIN` appended additively, U:593–595, commit `52dc4cd`) is in the tree but not deployed | M | U:586–597; live OPTIONS probe | deploy `52dc4cd` and set `CORS_ORIGIN=https://medx-member-portal-review.netlify.app,…` on the member service | yes (any preview host) |
| R17 | Member service boots admin code (`demo-purge.js`) and the admin serves member assets + imports `fira-service.js`; `buildFilter` per service never redeploys `shared/*` | L | U:29463; A:941; A:21; RY:16–18, RY:93–95 | add `shared/**` and `scripts/**` to both `buildFilter` path lists | no |
| R18 | Internal build/screenshot scripts publicly served on medx.hr (`/assemble_v2.py`, `/_shot*.py`, `/scripts/build-snapshot.sh`) and stale HR snapshot (2026-07-03 prices) | L | WEBSITE audit §2D | drop from the digest; regenerate `/hr/data/site-snapshot.json` | no |
| R19 | Two navigation id schemes in one SPA (`#up-section-<id>` member vs `#section-<id>` staff) and 102 localStorage keys | L | P9:4413–4470 (member), P9:27156–27172 (staff); USER audit §4.3 | the redesign should keep `medx_user_token`/`medx_user_data` and the hash names, and retire the staff `App` object from the member bundle | no |
| R20 | Website `mxt` hand-off on registration deep links is dead (`/plexus` is server-rendered and ignores `mxt`) | L | U:1295–1575, U:1295, U:1389; IX:54 | have `/plexus` read `mxt` (or `t`) and set the cookie/localStorage in the shell | no |

---

## 6. Go-live checklist — redesigned member portal on Render + medx.hr

Ordered; each line names the file that must change and the check that proves it.

### 6.1 Origins, CORS, CSP

- [ ] **CORS allowlist** U:586–595 keeps `https://medx.hr`, `https://www.medx.hr`, `https://medx-website-preview.netlify.app`, `https://medx-admin-portal.onrender.com`, `RENDER_EXTERNAL_URL`, `localhost:3000|3001|8899`; add every preview/review host via the new `CORS_ORIGIN` comma list (U:593–595, commit `52dc4cd` — deploy it first). Verify: `curl -H 'Origin: https://medx.hr' -I …/api/public/site` shows `access-control-allow-origin`.
- [ ] **CSP** U:599–643: any new font/CDN/script host of the redesign (Fraunces/Inter via `fonts.googleapis.com` + `fonts.gstatic.com` are already allowed; `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `unpkg.com` allowed for scripts) must be added in the same deploy; keep `script-src-attr 'unsafe-inline'` (smoke SM:75–80 pins it) unless every inline `onclick=` is migrated **and** the smoke test is updated together; keep `connect-src` = self + Stripe + Cloudinary (the SW never re-fetches cross-origin SW:65).
- [ ] Keep helmet CORP default except: `POST /api/public/pv` already `cross-origin` U:12299; add `cross-origin` for `/assets/supporters/*` (R14).
- [ ] Admin CSP `connect-src` already admits the member origin A:915–917 — unchanged unless the member host changes.

### 6.2 Path-style routes and the SPA fallback

- [ ] Server-rendered/public paths must stay: `/plexus`, `/plexus/:token`, `/invite/:data`, `/pay/gala/:token`, `/f/:slug`, `/pass/:token`, `/speaker/:token`, `/verify/:token`, `/r/:token`, `/forum`, `/forum/enter`, `/apply`, `/evaluate`, `/terms`, `/privacy`, `/building-bridges`, `/donor-night`, `/calendar/*`, `/qr/:id.png`, `/unsubscribe`, `/email-prefs`, `/reset-password/:token`, `/verify-certificate`, `/invite-success`, `/invite-cancelled`, `/donate/checkout`, `/health` (§3). Verify with the §3 probe list after deploy.
- [ ] SPA fallback U:29424–29429 serves `index.html` for extensionless paths only; JSON 404 for `/api/*` U:29418–29420. If the redesign adds path routes (e.g. `/plexus/program`, `/network`), they must not collide with the server-rendered `/plexus/:token` (a slug like `program` would be treated as a registration-link token → "Invitation Not Valid"). Use `/app/*` or hash routes, or exclude reserved slugs in U:1295.
- [ ] The path handler `window.location.pathname.match(/^\/forum\/events\/([a-z0-9-]+)\/?$/)` P9:4925 (anonymous forum registration) and `?event=` + `?mode=scanner` P9:37960–37971 must survive.
- [ ] Hash sections stay `#dashboard #plexus #gala #accelerator #forum #af26 #network #mymedx #rewards #settings #speaker #bridges #talks` (IX ids `up-section-*`: 2528, 3703, 5942, 6464, 7681, 8900, 9189, 9872, 9889, 10478, 10525, 11003, 11444) — emails and the admin newsletter link to `#gala`, `#mymedx`, `#<section>` (A:2702–2703, A:23092–23106, A:30125). `talks` may 302 to `#dashboard` once the Talk Library is removed.
- [ ] Boot query params P9:3362–3512 (`invite`, `register`, `logout`, `section`+`code`, `verified`, `payment`+`type`+`reg|app|gala`, `view`, `login`, `mxt` IX:54) keep their names.

### 6.3 Service worker + cache stamping

- [ ] Keep the literal `const CACHE_NAME = 'medx-portal-v<N>'` form SW:2 (bump `v9` → `v10` for the redesign); `stamp-sw.sh` SS:47–57 appends `-<sha7>` and the smoke test asserts `/medx-portal-v\d+/` SM:93–95.
- [ ] Keep asset URLs in the `assets/app.css?v=…` / `assets/app.part<N>.js?v=…` shape (IX:40, IX:193…) or update the `sed` in SS:93 and SW precache list SW:6–21 in the same commit. Vendored `/vendor/qrcode/qrcode.min.js` and `/vendor/fontawesome/css/all.min.css` are precached (SW:6–21) — replace only with matching precache edits.
- [ ] `manifest.json` `start_url /?app=1`, shortcuts `/?app=1&view=ticket|schedule`, icons `icon-192/512.png` unchanged (installed PWAs keep them).
- [ ] Push handlers SW:121–161 and `pushsubscriptionchange` SW:162–176 (`GET /api/push/vapid-key` SW:167) unchanged; `MedXPush._persist` P9:52389 re-subscribes.

### 6.4 `mxt` hand-off and website hooks

- [ ] Pre-boot adoption of `?mxt=` stays first in `<body>` (IX:54 today) and `forum-wing.html` FW:511; key names `medx_user_token` + `medx_user_data` are shared with `site.js`.
- [ ] `site.js` hooks stay unchanged: `/api/public/site|content|status|supporters|pv`, `/api/auth/login`, `/api/bell-feed`, `/api/me/next-event`, `/api/user-notifications/*` — **JSON field names are the contract** (WEBSITE audit §1I). No website deploy is needed for the member redesign if these are untouched.
- [ ] Optional (R20): make `/plexus` read `mxt`/`event` so website deep links preselect conference/gala.

### 6.5 Stripe

- [ ] Return URLs unchanged: `/?payment=success|cancelled&reg=` U:20224, `&type=forum&reg=` U:17513, `&type=accelerator&app=` U:15100, `&gala=` U:27841/U:27899, `/invite-success?session_id=` U:28403/U:28755, `https://medx.hr/donate?…` U:5452–5453. The redesigned boot must parse them (P9:3438–3500, P9:9822 today).
- [ ] Webhook `POST /api/stripe/webhook` keeps raw body U:645–651; `STRIPE_WEBHOOK_SECRET` set on Render; test with `stripe trigger checkout.session.completed` against a preview only if test keys are added (none exist today).
- [ ] `sessionStorage.medx_plexus_idemp` double-checkout guard (P9 `handleStripeReturn`) preserved.

### 6.6 Env vars to add / fix on Render (member service unless noted)

- [x] `BREVO_API_KEY` (both) — already set on prod (verified 2026-08-28); declare it in render.yaml.
- [ ] `CLOUDINARY_URL` (member; admin as flag) — uploads 503 without it.
- [ ] `CME_ENC_KEY` (both) — plaintext CME data without it.
- [ ] `CORS_ORIGIN` (member, new in `52dc4cd`) = comma list of preview/review origins.
- [ ] `PUBLIC_BASE_URL` (both) — wallet class URIs otherwise point at the admin host on Render (A:32458); interviewer links U:15709.
- [ ] Confirm `JWT_SECRET` is identical on both services (R6) or retire the cross-origin calls.
- [ ] Declare in `render.yaml` what the code reads but the yaml omits (member: 26 names, USER audit §6; admin: 42 names, ADMIN audit §6) and delete `RESEND_API_KEY`, `MEDX_VAT_ID`.
- [ ] Add `shared/**` and `scripts/**` to both `buildFilter` lists RY:16–18, RY:93–95.

### 6.7 CI and monitoring

- [ ] Fix `tests/smoke.js` SM:43–50 (R8) so the scheduled run is green before the redesign lands; run `npm run smoke` manually after the Render deploy (workflow_dispatch).
- [ ] `scripts/check-api-contract.js` must still find literal `/api/...` strings in the new bundle (no dynamic URL building); `scripts/check-schema-sync.sh` must stay green (do not touch U:9319–9845 without the admin twin A:4154–4680).
- [ ] `boot-smoke.yml` boots both services on a scratch DB on every push — a boot crash rolls back on Render (`healthCheckPath /health` RY:13).
- [ ] Set `vars.TURSO_DB_NAME=medx-portal-alen-ops99` in the repo if not already (turso-backup.yml:33 defaults to `medx-portal`); confirm the nightly artifact exists after go-live.
- [ ] Uptime alert (6 h) covers `/health` on both portals + `medx.hr`; add `/api/public/site` and the Brevo drain if possible.

### 6.8 Content prerequisites (admin-side data the new screens read)

- [ ] `project_status` rows for plexus/gala/accelerator/forum/bridges (A:11770) — drive Home cards and the website.
- [ ] `feed_items` (A:12397) and `portal_content` `featured` (A:33888) — Home news + hero rotation.
- [ ] `speakers` published (A:20844), `sessions` published (A:20250), `sponsors` published (A:21171).
- [ ] `gala_settings` prices/deadline (A:30009) and `event_components.gala` (A:36208) — the Sep 1 flip is server-side today.
- [ ] `accelerator_key_dates` (A:13535), `accelerator_sites` (A:12051), `accelerator_institutions` (A:13657).
- [ ] `plexus_settings.key_dates_json` (A:34551) — the only member-facing "key dates" store besides accelerator dates.

---

## 7. Appendix A — GitHub Actions, CI guards, monitoring

| Workflow | Trigger | What it does | Secrets / vars | Status today |
|---|---|---|---|---|
| `boot-smoke.yml` | push `main`, dispatch | `scripts/check-schema-sync.sh` (SCHEMA-MIRROR byte-identical) + `scripts/check-api-contract.js` (every frontend `/api/…` has a route) + boots both portals on a scratch DB and probes `/health`, `/`, login | none | passing |
| `predeploy-backup.yml` | push `main`, dispatch | Turso `.dump` before Render deploys | `secrets.TURSO_AUTH_TOKEN` (platform token, used as `TURSO_API_TOKEN`), `vars.TURSO_DB_NAME` (default `medx-portal`) | passing |
| `turso-backup.yml` | 03:17 UTC nightly, dispatch | Turso `.dump` → artifact, `retention-days: 30` | same two | succeeds |
| `smoke.yml` | PRs, 07:00 UTC daily, dispatch | `npm run smoke` → `tests/smoke.js` against `https://medx-user-portal.onrender.com` + admin (SM:22–23); also runs the schema-sync guard | none | **FAILING since ≥ 08-26** (SM:43–50 grep `index.html` for `window.MEDX_DATES` / `window.location.pathname.match`, now in P9:7 / P9:4925) |
| `uptime-alert.yml` | every 6 h, dispatch | GET `/health` on both portals + `https://medx.hr`, opens an issue on failure | `secrets.GITHUB_TOKEN` | succeeds |
| `keepalive.yml` | **cron disabled 2026-07-18**, dispatch only | pings both `/health` (Starter plans never sleep now) | none | idle |
| `pages.yml` | push `main` | publishes `landing/` to GitHub Pages (the same folder `medx-gateway` serves on Render) | pages permissions | — |

In-process timers that also "call" the portals: member — Turso `db.sync()` 60 s U:29482–29484, push-outbox drain 45 s U:29488–29490, announcement fan-out U:257–298, monthly reminders (`admin_notifications` writer U:22994), milestone reconcile, optional self keep-warm (`KEEP_WARM=1`) U:29472–29478; admin — `drainScheduledEmails` (production email delivery) A:43350, picker sweep, seat-confirm/survey/post-event daily rounds, staff stale-scan 60 s (A:41860), self keep-warm A:43291–43295.

## 8. Appendix B — Netlify, DNS, review hosts

| Item | Value (2026-08-28) |
|---|---|
| Serving site | `medx-website-preview` (id `58a61ec7-6dce-440b-92a8-c37256e6ba28`), custom domain `medx.hr`, alias `www.medx.hr` → 301 apex, `force_ssl`, pretty URLs on, digest deploys only (no repo), 416 files, published deploy `6a8b1da6c99824645d697fdf` (2026-08-23 16:19 UTC) = byte-identical to `MedX_Squarespace/site_live_mirror_2026-07-31/` |
| Netlify Forms on the site | `newsletter` (3 submissions), `contact`, `support-inquiry`, `forum-consideration` (fallback only), `dead-letter` (0 each) |
| Deploy rule | always include `"/netlify.toml": "ed27a064daed40cb7c28cd58f155be7ead6b1658"` in the digest; `_redirects` (3 rules: `/hr/heritage*` → `/heritage/?lang=hr`, `/hr/network` → `/network`) |
| DNS | NS `ns1/ns2.vercel-dns.com` (zone at Vercel); apex A `75.2.60.5` (Netlify LB); `www` CNAME `medx-website-preview.netlify.app`; MX `medx-hr.mail.protection.outlook.com`; SPF `include:spf.protection.outlook.com include:spf.brevo.com -all`; `heritage.medx.hr` A `64.29.17.65`/`216.198.79.65` (Vercel → 404) |
| Review copies (static, 2026-08-20) | `medx-member-portal-review.netlify.app` (`66cb26d8-72ff-403f-87d4-153bcaead792`), `medx-admin-portal-review.netlify.app` (`0261b147-f152-4021-b1fd-1ea8a0998161`) — neither is in a CORS allowlist |
| External Med&X sites the portals link to | `plexus-tables.netlify.app` (seat picker + 3D planner, Firestore project `plexus-gala-tables`), `medx-merch-studio.netlify.app` (admin nav AIX:7875), `medx-website-preview.netlify.app` (speaker photo host in `/api/public/site`, sponsor brochure PDF A:29092) |
| Duplicate/loose ends | `medx-website-preview.netlify.app` serves the whole site with 200; internal scripts served (`/assemble_v2.py`, `/_shot*.py`, `/scripts/build-snapshot.sh`); `/hr/data/site-snapshot.json` seed from 2026-07-03; 28 Med&X-named Netlify sites in total, 263 unrelated |

## 9. Appendix C — public API contract read by the website (field names are the contract)

| Route (member origin) | Limiter / cache | Top-level shape |
|---|---|---|
| `GET /api/public/site` U:11946 | **none** (registered before `publicLimiter` U:12033) | `conference{name,year,slug,description,start_date,end_date,date_range,venue_name,venue_city,venue_country,registration_open,early_bird_deadline,regular_deadline,pricing_phase,keynote_count,keynote_count_word,keynote_count_word_hr}`, `price{early_bird,regular,late,current,currency}`, `deadline{early_bird,regular}`, `tickets[]{name,name_hr,price_*,currency,includes_gala,sort_order}`, `speakers[]{name,title,institution,photo_url,talk_title,is_keynote,sort_order}`, `generated_at` |
| `GET /api/public/content[?page=]` U:12048 | `publicLimiter` 120/min; memo 45 s; `max-age=60, swr=300` | `blocks{<key>{type,body,body_hr,updated_at}}`, `generated_at` — keys `homepage.news_banner`, `plexus|gala|accelerator|forum|bridges.announcement`, `global.members_prompt` |
| `GET /api/public/status` U:12075 | same; memo 30 s | `projects[]{project_key,status_label,status_kind,detail_line,cta_label,cta_target,status_label_hr,detail_line_hr,cta_label_hr,updated_at}` ordered plexus, gala, accelerator, forum, bridges |
| `GET /api/public/impact` U:12099 | same; memo 120 s | `members, countries, registrations, events, speakers, charity_giving{pledged_eur,paid_eur}|null, generated_at` (build-time snapshot only) |
| `GET /api/public/supporters` U:12144 | same; memo 300 s | `strings{hr,en}{heading,intro}`, `groups[]{key,label_hr,label_en,items[]{name,logo,website}}`, `count`, `generated_at` |
| `POST /api/public/pv` U:12299 | `pvLimiter` 300/min; CORP `cross-origin` | `204`; body `{path, ref}` |
| `POST /api/public/forum-consideration` U:4332 | `forumWingLimiter` | `{success, message}` |
| `GET /api/public/survey?t=&r=&l=` U:12211, `…/recommend` U:12234, `POST …/comment` U:12253 | `publicLimiter`; `no-store` | HTML / `{success}` |
| `GET /api/public/speaker-itinerary/:token` U:5120 | `speakerLimiter`; `private, max-age=120` | itinerary payload |
| `GET /api/public/registrations/:email` U:29190 | **none** | `{registrations[], forumRegistrations[], galaRegistrations[], bridgesRegistrations[]}` (R1) |
| `GET /health` U:29187 · admin `GET /health` A:43169 | none | `{ok:true}` |
| admin `GET /api/public/press` A:11859 | `publicLimiter`; `max-age=60, swr=300`; CORS `PUBLIC_API_ORIGINS` A:868–873 | `releases[]{lang,tag,title,summary,date,datetime,date_label,url}`, `generated_at` |

**`site.js` hooks (live = mirror, 1,867 lines):** `data-medx-slot="site:*|content:*|status:*"` + `data-medx-fmt` (price, date-long, cap, raw) · `data-medx-strip` / `data-medx-strip-x` · `data-medx-statusbar`, `data-medx-status-dot`, `data-medx-status-cta` (href only via `CTA_ALLOW`) · `data-medx-list="site:speakers|press:releases|supporters:wall"` with `<template data-medx-item>` and `data-mx-field` · `data-medx-fallback="speakers"` + `data-medx-fallback-names` · `data-medx-cta="register"` (+ runtime `data-medx-closed`, `data-medx-href`) · `data-medx-reg="plexus-2026|plexus-gala-2026"` (+ `data-medx-reg-ticket`) · `data-medx-countdown` · `data-medx-jsonld` · `data-mx-newsletter` (Netlify form) · `data-cal-*` (`.ics` builder). Storage keys the website shares with the portal: `medx_user_token`, `medx_user_data`; its own: `medx_live_cache`, `medx_session_expired`, `medx_notif_read`, `medx_notif_snooze`, `medx_prompt_state`, `medx_strip_dismissed`.

## 10. Appendix D — the shared database, by direction

| Direction | Count | Tables |
|---|---|---|
| Admin writes, member reads only (pure admin → member push) | 14 | `auction_items` `bridges_program` `bridges_speakers` `cme_accreditations` `event_custom_fields` `gala_seat_assignments` `gala_table_assignments` `gala_tables` `org_settings` `portal_content` `signup_forms` `speaker_itineraries` `speaker_itinerary_items` `venue_rooms` |
| Member writes, admin reads only (pure member → admin feed) | 8 | `abstract_files` `cme_submissions` `forum_convening_segments` `forum_convenings` `forum_reservations` `notify_topics` `reward_redemptions` `speaker_documents` |
| Admin writes only, member W+R (queues drained by the member) | 2 | `forum_magic_tokens` `push_outbox` |
| Read + written by both | 133 | `users`, `registrations`, `gala_registrations`, `speakers`, `sessions`, `sponsors`, `feed_items`, `project_status`, `content_blocks`, `direct_messages`, `user_notifications`, `scheduled_emails`, `accelerator_*`, `forum_*`, `finance_*`, `pr_*` … (full list: ADMIN audit §2c) |
| Member-only (admin never touches) | 18 | `chat_read_status` `email_optouts` `email_verifications` `forum_email_templates` `forum_event_speakers` `forum_gallery_folders` `forum_group_messages` `forum_invitations` `forum_news` `forum_prospects` `intro_requests` `mentorship_profiles` `mentorship_requests` `messages` `networking_connections` `networking_meetings` `networking_profiles` `pending_meetings` |
| Declared in both, used by neither | 12 | `accelerator_consents` `conference_archives` `conference_stats` `contact_interactions` `email_log` `forum_notifications` `group_discounts` `group_registration_members` `group_registrations` `review_criteria` `sponsor_leads` `sponsor_materials` |
| Guarded by `check-schema-sync.sh` | 527 lines | only the SCHEMA-MIRROR block (U:9319–9845 = A:4154–4680); dozens of shared tables are declared outside it "identically by hand" — any new column for the redesign must be added in **both** files |
| Boot-time cross-side deletes | — | `demo-purge.js` runs on every production boot of **both** services (wired U:29466, A:43253) and deletes seed rows by exact id from member-owned tables (skips `gala_registrations`, `croatians_abroad_registrations`, `content_blocks`, `speakers`, `page_views`, Bridges events) |

## 11. Appendix E — environment variable declaration matrix

| Service | Declared in `render.yaml` | Read by code but NOT declared (dashboard-only or absent) | Declared but unread |
|---|---|---|---|
| `medx-user-portal` (RY:20–78) | `PORT, NODE_ENV, JWT_SECRET, RESEND_API_KEY, EMAIL_FROM, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, FIRA_API_KEY, FIRA_API_URL, MEDX_IBAN, MEDX_BANK_NAME, MEDX_SWIFT, MEDX_COMPANY_NAME, MEDX_VAT_ID, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_EVENT_CLASS_ID, GOOGLE_WALLET_SA_KEY` (23) | `ADMIN_PORTAL_URL, AI_DRAFT_MODEL, AI_DRAFT_RATE_MAX, ANTHROPIC_API_KEY, APPLE_WALLET_CERT_PEM, APPLE_WALLET_KEY_PEM, APPLE_WALLET_TEAM_ID, APPLE_WALLET_PASS_TYPE_ID, BREVO_API_KEY, CLOUDINARY_URL, CME_ENC_KEY, CONFIRMATION_CC, DATABASE_PATH, EMAIL_DUMP_DIR, EMAIL_LOGO_URL, FIRA_DISABLED, GOOGLE_SHEETS_WEBHOOK, GOOGLE_WALLET_CLASS_ID, GOOGLE_WALLET_OAUTH_URL, GOOGLE_WALLET_OBJECTS_BASE, GOOGLE_WALLET_TICKET_CLASS_ID, KEEP_WARM, PDF_FONT_BOLD_PATH, PDF_FONT_PATH, PORTAL_URL, PUBLIC_BASE_URL, USER_PORTAL_URL` (26) | `RESEND_API_KEY`, `MEDX_VAT_ID` |
| `medx-admin-portal` (RY:81–143) | `PORT, NODE_ENV, JWT_SECRET, RESEND_API_KEY, EMAIL_FROM, AMADEUS_API_KEY, AMADEUS_API_SECRET, AMADEUS_ENV, PICKER_ADMIN_EMAIL, PICKER_ADMIN_PASSWORD, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_EVENT_CLASS_ID, GOOGLE_WALLET_SA_KEY` (15) | `ADMIN_PORTAL_URL, AMADEUS_BASE_URL, ANTHROPIC_API_KEY, ASSISTANT_MODEL, ASSISTANT_MODEL_COMPLEX, BREVO_API_KEY, CHROME_PATH, CLOUDINARY_URL, CME_ENC_KEY, CORS_ORIGIN, DATABASE_PATH, ENABLE_FIRA_ON_MARK_PAID, FIRA_API_KEY, FORUM_SITE_URL, FOUNDER_RESET_PW, GHOSTSCRIPT_PATH, KEEP_WARM, MEDX_IBAN, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_MAILBOX, MS_GRAPH_TENANT_ID, NAG_DUE_SOON_DAYS, NAG_UNPAID_DAYS, PDF_FONT_BOLD_PATH, PDF_FONT_PATH, PICKER_AUTH_BASE, PICKER_BASE_URL, PICKER_FB_API_KEY, PICKER_FB_PROJECT_ID, PICKER_FS_BASE, PICKER_TICKET_HOST, PUBLER_API_KEY, PUBLER_WORKSPACE_ID, PUBLIC_BASE_URL, PUPPETEER_EXECUTABLE_PATH, SITE_PUBLIC_URL, SPONSOR_FOLLOWUP_DAYS, STRIPE_READONLY_KEY, STRIPE_SECRET_KEY, TECH_PASSWORD, USER_PORTAL_URL` (42, excluding platform-injected `RENDER`, `RENDER_EXTERNAL_URL`, `PATH`) | `RESEND_API_KEY` |
| `medx-gateway` | `PORT` | — | — |

Behaviour when a critical variable is missing: `JWT_SECRET` → process exits in production (U:569, A:859) · `STRIPE_WEBHOOK_SECRET` → webhook 500, payments succeed at Stripe with no fulfilment (U:20251) · `BREVO_API_KEY` → `[EMAIL DROPPED]` (U:126–128) · `CLOUDINARY_URL` → multipart 503 (U:5540–5547) · `CME_ENC_KEY` → plaintext CME data (U:5654–5657) · `VAPID_*` → push silently off · `TURSO_*` → local ephemeral SQLite · `ANTHROPIC_API_KEY` → template mode (AI:84–89).

## 12. Appendix F — do-not-rename contracts for the redesign

| Contract | Values | Why |
|---|---|---|
| Auth storage keys | `medx_user_token`, `medx_user_data` (member + website); admin `medx_token`, `medx_user`; legacy reads `medx_token`, `token`, `medx_user` in the member bundle | sign-in state shared with `site.js`; renaming logs everyone out |
| Offline scanner keys (admin) | `checkinQueue`, `checkinRoster` | in-flight offline scans |
| Other member keys worth keeping | `medx_onboarding_completed`, `plexus_registration_id`, `medx_locale`, `medx_theme`, `pwa_install_dismissed`, `medx_push_dismissed`, `medx_forum_verified` (session), `medx_plexus_idemp` (session) | boot logic and double-checkout guard |
| Section ids / hashes | `#dashboard #plexus #gala #accelerator #forum #af26 #network #mymedx #rewards #settings #speaker #bridges (#talks)`; DOM ids `up-section-<id>` | emails, admin newsletter links, PWA shortcuts, bottom nav map IX:1288 |
| Query params | `mxt, invite, register, logout, section+code, verified, payment+type+reg|app|gala, view, login, gd (admin), t, e+s, event, mode, claim, thanks|cancelled|checkout_error (website)` | boot code, Stripe, magic links, website |
| Route paths | every path in §3 plus all `/api/...` prefixes (the admin `SECTION_ROUTE_MAP` A:1183–1239 keys permissions on them) | emails, QR, website, permissions |
| `/api/public/*` field names | Appendix C | `site.js` overwrites baked HTML only with non-empty live values — a renamed field silently freezes the website |
| Stripe `metadata.type` values and return-URL shapes | `donation`, registration kinds; `?payment=…&reg|app|gala=`, `/invite-success?session_id=` | webhook dispatch and SPA return handling |
| SW `CACHE_NAME` literal + `?v=` asset shape | `medx-portal-v<N>`; `assets/app.(css|partN.js)?v=` | `stamp-sw.sh` SS:47–57, SS:93; smoke SM:93–95 |
| CSP allowlists | U:602–645 (member), A:892–933 (admin) | new CDN/font hosts need the same deploy |
| Cross-directory requires | `shared/db.js`, `shared/ai.js`, `shared/wallet.js`, `user-portal/backend/fira-service.js`, `admin-portal/backend/demo-purge.js` | both services boot them |
| Firestore doc ids | `invites/{16-hex token}`, `paid_emails/{sha256(lower(trim(email)))}` (PS:57–59) | byte-identical with the external picker app |

## 13. Appendix G — live probe log (GET/HEAD only, bogus tokens, 2026-08-28 ~22:30–22:50 UTC)

| Target | HTTP | Content | Reading |
|---|---|---|---|
| `https://medx-user-portal.onrender.com/health` · `/api/public/site` · `/content` · `/status` · `/supporters` · `/impact` | 200 | JSON | all public reads answer; `registration_open` true, `pricing_phase` `early_bird`, `content` bodies empty except `global.members_prompt`, `status.*_hr` null |
| `/api/plexus/settings` · `/api/gala/settings` · `/api/accelerator/key-dates` · `/api/accelerator/sites` · `/api/plexus/speakers` · `/api/plexus/schedule` · `/api/portal-content/published/featured` · `/api/member-card-visibility` · `/api/push/vapid-key` | 200 | JSON | the member-facing public reads the redesign will call are all live; VAPID public key returned |
| `/plexus` · `/plexus?event=plexus-2026&ticket=early_bird&from=website&mxt=probe` | 200 | HTML | server-rendered wizard; deep-link params tolerated (ignored) |
| `/forum` · `/forum/enter?token=INVALID` · `/apply` · `/evaluate` · `/building-bridges` · `/donor-night` · `/terms` · `/privacy` · `/invite-success` · `/invite-cancelled` · `/verify/INVALID` · `/r/INVALID` | 200 | HTML | neutral/notice pages on bad tokens (no information leak) |
| `/invite/probe` | 200 | HTML "Invitation Not Valid" | notice page |
| `/reset-password/INVALID` | 200 | HTML "Link Invalid or Expired" | notice page |
| `/api/auth/verify?token=INVALID` | 302 → `/?verified=invalid` | — | SPA shows the invalid state (P9:3403–3434) |
| `/email-prefs?e=eA&s=bogus` | 400 | HTML | HMAC rejected |
| `/pay/gala/INVALID` · `/f/no-such-slug` · `/pass/INVALID` · `/speaker/INVALID` · `/verify-certificate?n=INVALID` | 404 | HTML | branded not-found pages |
| `/qr/00000000-0000-0000-0000-000000000000.png` · `/api/register-direct/INVALID` · `/api/public/pv` (GET) · `/api/public/forum-consideration` (GET) · `/api/auth/login` (GET) | 404 | JSON | POST-only / unknown id |
| `/api/bell-feed?limit=30` · `/api/me/next-event` · `/api/user-notifications/` | 401 | JSON `Authentication required` | auth gate intact |
| `/calendar/medx-events.ics` · `/calendar/plexus.ics` | 200 | `text/calendar` | feed + per-event files |
| `/manifest.json` · `/sw.js` | 200 | JSON / JS | `CACHE_NAME = 'medx-portal-v9-189ac8d'`; `index.html` assets `?v=189ac8d` |
| `/donate/checkout?src=medx.hr` · `…?amount=50&frequency=once&designation=general` | 303 → `checkout.stripe.com/c/pay/cs_live_…` | — | live Stripe key; unknown designation clamps to `unrestricted` |
| CORS: `GET /api/public/site` with `Origin: https://www.medx.hr` / `https://medx.hr` | 200 + `access-control-allow-origin` echo | — | allowlist honoured; `https://medx-member-portal-review.netlify.app` gets **no** ACAO (OPTIONS 204 without allow-origin) |
| `https://medx-admin-portal.onrender.com/health` · `/api/public/press` · `/api/public/content` · `/sw.js` · `/newsletter` · `/apply` · `/review?token=INVALID` · `/evaluate?token=INVALID` | 200 | JSON/HTML | `releases: []`; admin `/health` sends no ACAO (unused by the site) |
| admin `/e/INVALID` · `/a/INVALID` · `/api/public/confirm-seat?token=INVALID` · `/claim-seat?token=INVALID` · `/feedback?token=INVALID&score=9` · `/api/public/press/no-such-slug` | 404 | HTML | token pages reject cleanly |
| `https://medx.hr/press` · `https://medx.hr/donate?thanks=1` · `https://plexus-tables.netlify.app/` | 200 | HTML | website + picker up |
| `https://www.medx.hr/` | 301 → `https://medx.hr/` | — | apex primary |
| `https://heritage.medx.hr/` | **404** (`server: Vercel`) | text | orphaned host (R9) |

## 14. Appendix H — member SPA boot parameters and section/tab vocabulary

| Parameter / id | Consumer | Behaviour |
|---|---|---|
| `?mxt=<jwt>` | IX:54 (pre-boot), FW:511 (forum wing) | stores `medx_user_token`, strips the query (`history.replaceState`) |
| `?invite=<b64>` | P9:3368 `showDirectInviteForm` | direct invite form, bypasses the portal |
| `?register=<token>` | P9:3369 → `showDirectRegistrationForm` P9:53573 (`GET/POST /api/register-direct/:token` U:29027/U:29059) | direct registration page |
| `?logout=true` | P9:3380 | clears the session |
| `?section=speaker&code=<invite_code>` | P9:3391–3399 → `SpeakerPortal.verifyInviteCode` P9:20070 (`POST /api/speakers/auth` U:27914) | speaker self-service |
| `?verified=true|already|expired|invalid` | P9:3403–3434 | post-confirmation toasts |
| `?payment=success|cancelled` + `type=forum|accelerator` + `reg|app|gala=<id>` | P9:3438 (`isStripeReturn`), P9:3481–3497 (gala), P9:3500 (plexus), `PlexusPortal.handleStripeReturn` P9:9822 | Stripe return routing + webhook polling; `sessionStorage.medx_plexus_idemp` guards double checkout |
| `?view=ticket|schedule` (+ `app=1`) | P9:3455; `manifest.json` shortcuts | installed-PWA entry points |
| `?login=true` | P9:3507 | opens the sign-in form |
| `/forum/events/<slug>` (path) + `?event=` | P9:4925 (`openAnonymousForumRegistration`, `POST /api/forum/events/:id/register` U:17368) | anonymous forum event registration overlay |
| `?mode=scanner` + `?event=<prefix>` | P9:37960–37971 (staff check-in) | scanner deep link |
| `#<section>` hashes | `UserPortal.showSection` P9:4413 (`#up-section-<id>`), `popstate` P9:3541–3549, `MedXBottomNav` IX:1290 | `dashboard, plexus, gala, accelerator, forum, af26, network, mymedx, rewards, settings, speaker, bridges, talks` |
| `data-tab` values in use | `PlexusPortal`, `GalaPortal`, `BuildingBridgesPortal.showTab`, `SettingsPortal` | `overview, upcoming, speakers, schedule, profile, past, register, apply, travel, results, programs, program, privacy, notifications, networking, network, myschedule, myplexus, mypass, mymedx, myevents, myapplications, logistics, live, intake, institutions, home, events, documents, connect, city, appearance, account, abstract` |
| Bottom-nav map | IX:1288–1289 | `dashboard→home`, `network→network`, `mymedx→mymedx`, `rewards|settings→profile`, all project sections → `programs` |

## 15. Appendix I — the member-origin `/api/admin/*` surface (routes the admin SPA and staff view call on the MEMBER service)

| Family | Member-origin routes | Admin-origin twin | Used by |
|---|---|---|---|
| Payments | `POST /api/admin/payments/:kind/:id/refund` U:736 (Stripe refund U:766) | none | admin SPA AIX:43241 (cross-origin) |
| Live Q&A | `GET /api/admin/plexus/qa` U:21936, answer U:21960, hide U:21973, ask U:21982 | A:19487–19530 | admin SPA `QAAdmin` AIX:53718 (cross-origin) |
| Plexus staff | sessions U:21736–21803, speakers U:22471–22778, sponsors U:22796–22870, registrations U:22384, stats U:22428, promo U:22451–22462, volunteers U:22488–22935, refunds/visa/pending U:22548–22566, check-in U:22355, recent check-ins U:22915 | A:20059–21356 | member bundle staff view (`App` P9:24986, `showSection` P9:27156) |
| Forum staff | `/api/admin/forum/*` U:17637–18588 (applications, members, groups, events, AF26, prospects, invitations, templates, media) | A:16726–17183, A:39410–40223 | member bundle staff view P9:30793–33973 |
| Gala staff | invite links U:27055–27106, scan/check-in U:27697–27738, registrations U:26948/U:26954, settings U:27004 | A:30094–30499, A:33437–33465 | both |
| Check-in | verify U:27219, enrich U:27466, test emails U:27539/U:27601 | A:32848, A:33119, A:33267/A:33331 | scanner |
| Content | content-blocks U:12360–12373, feed-items U:14103–14140, opportunities U:14149/U:14157, talks U:14177–14211 | A:11927–11940, A:12393–12431, A:12467/A:12475, A:12494–12528 | member bundle staff view |
| Accelerator staff | `/api/admin/accelerator/*` U:19482–19551 + `/api/accelerator/years/*` admin routes U:14974–16698 | A:13455–16256, A:18748–18825 | `AcceleratorApp` P9:34019 |
| Finance / PR / tasks / files / chat | `/api/finance/*` U:24670–25664, `/api/pr/*` U:25681–26303, `/api/tasks*` U:19078–19190, `/api/files*` U:19364–19458, `/api/channels|chat/*` U:18696–18916, `/api/team*` U:18664–18675, dashboard U:19043 | A:25546–26727, A:27212–28524, A:18227–18339, A:18619–18719, A:17236–17919 | member bundle staff view (`FinanceApp` P9:36535, `PRApp` P9:38824) |
| Invites / links | `/api/admin/croatians-abroad/*` U:27131–27202, `/api/admin/gala/invite-links*` U:27055–27106, registrations CSV U:792, errors U:29413 | A:30524–30568, A:30452–30499 | both |

**Redesign implication:** the member bundle ships a full staff dashboard (`App` P9:24986–34018, `AcceleratorApp`, `FinanceApp`, `CheckinApp`, `PRApp` P9:34019–39683). The redesigned member build should drop it; the admin portal already owns every twin except the two cross-origin families (payments refund, Live Q&A), which must either stay on the member service or move to the admin origin before the member staff code is removed.

*Generated 2026-08-28 from HEAD `8b7ba23`; the companion build contract is `design/verify-2026-08-28/REDESIGN-GAP-MATRIX.md`.*
