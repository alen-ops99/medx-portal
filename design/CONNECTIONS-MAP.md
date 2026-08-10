# Med&X DO-NOT-BREAK Connections Map

**Purpose.** Contract of everything that must survive the UI redesign of the user portal, admin portal, and medx.hr. The redesign keeps ALL functionality; visual markup, CSS, and layout are free — the routes, IDs, attributes, storage keys, URL params, env vars, and payload shapes below are not.

**Sources (read-only audit, 2026-08-09/10):**
- `MedX/medx-portal-fresh/user-portal/backend/server.js` (~29,600 lines) + `frontend/index.html` + `frontend/assets/app.part1–14.js` + `frontend/sw.js`
- `MedX/medx-portal-fresh/admin-portal/backend/server.js` (~43,400 lines) + `backend/picker-sync.js` + `frontend/index.html` + `frontend/sw.js`
- `MedX/medx-portal-fresh/render.yaml`, `scripts/stamp-sw.sh`, `scripts/check-api-contract.js`, `scripts/check-schema-sync.sh`, `tests/smoke.js`, `.github/workflows/*`, `shared/{db,ai,wallet}.js`
- `MedX_Squarespace/site_live_mirror_2026-07-31/` (`site.js`, all `*.html`, `/hr/*`, `_redirects`, `_DEPLOY_README.txt`, `data/site-snapshot.json`)

**Executive summary — the ten things that can never be renamed or deleted:**
1. `POST /api/stripe/webhook` (user portal) and the exact `metadata.type` strings: `donation`, `accelerator-fee`, `forum-event`, `gala-ticket`, `croatians-abroad-gala`, `invite-<event_type>` prefix — plus the **type-less** Plexus branch keyed on `metadata.registration_id` + `invoice_number`.
2. Forever-URLs already living in inboxes/phones: `/api/auth/verify?token=`, `/api/verify-email?token=`, `/reset-password/:token`, `/invite/:data`, `/pass/:token`, `/pay/gala/:token`, `/qr/:id.png`, `/unsubscribe?e=&s=`, `/calendar/medx-events.ics`, admin `/evaluate?token=`, admin `/e/:token`, `?gd=` volunteer links, picker `?t=` tokens, `pay.google.com/gp/v/save/<JWT>` wallet links.
3. Donation return URLs hardcoded to `https://medx.hr/donate?thanks=1|cancelled=1|checkout_error=1` — the donate page must keep reading those params.
4. medx.hr `site.js` hydration: every `data-medx-*` / `data-sup-*` / `data-mx-*` / `data-cal-*` attribute, and the `/api/public/{site,content,status,supporters}` (user) + `/api/public/press` (admin) response shapes.
5. Website→portal deep link `…/plexus?event=<slug>&ticket=<phase>&from=website[&mxt=<token>]` — `mxt` is consumed pre-boot at user `index.html:54`.
6. Admin `SECTION_ROUTE_MAP` route prefixes (server.js:1183–1239) — renaming any `/api/...` prefix silently breaks the permission system.
7. localStorage: `medx_user_token`/`medx_user_data` (user portal), `medx_token`/`medx_user` (admin), `medx_live_cache` + `medx_user_token` (medx.hr).
8. SPA navigation contracts: user `#section-<id>` + hash routing + `data-tab` values; admin `showSection('<id>')` + `data-section` + hash; smoke-pinned markers `window.MEDX_DATES`, the path-style direct-link handler, admin `theme-fresh`.
9. Service workers: `CACHE_NAME = 'medx-portal-v9'` / `'medx-staff-v2'` — `stamp-sw.sh` rewrites that exact `const CACHE_NAME = '…-vN'` line and the `?v=` busters on `assets/app.css|app.partN.js`; smoke asserts `/medx-portal-v\d+/`.
10. One shared Turso DB for both portals (SCHEMA-MIRROR blocks must stay byte-identical), the Firestore picker's `sha256(lower(email))` doc-id contract, and the digest-deploy rule pinning `"/netlify.toml": "ed27a064daed40cb7c28cd58f155be7ead6b1658"`.

---

## 1. External services / APIs

### 1.1 Stripe — user portal owns money; admin is read-only

**User portal** (`user-portal/backend/server.js`): client init :40–44 (`STRIPE_SECRET_KEY`); raw-body bypass for the webhook at :646.

All 8 `checkout.sessions.create` call sites:

| # | Line | Route | `metadata.type` | success_url | cancel_url |
|---|------|-------|-----------------|-------------|------------|
| 1 | 5430 | `GET /donate/checkout` (:5411, public) | `donation` (+ `designation`, `frequency`, `source:'medx.hr'`) | `https://medx.hr/donate?thanks=1` (hardcoded) | `https://medx.hr/donate?cancelled=1` (hardcoded) |
| 2 | 15075 | `POST /api/accelerator/checkout-session` | `accelerator-fee` | `${host}/?payment=success&type=accelerator&app=<id>` | `…?payment=cancelled&type=accelerator&app=<id>` |
| 3 | 17513 | `POST /api/forum/events/:id/checkout-session` | `forum-event` (+ `forum_registration_id`) | `${host}/?payment=success&type=forum&reg=<id>` | `…?payment=cancelled&type=forum&reg=<id>` |
| 4 | 20201 | `POST /api/plexus/checkout-session` | **none** — keyed on `registration_id` + `invoice_number` | `${host}/?payment=success&reg=<id>` | `…?payment=cancelled&reg=<id>` |
| 5 | 27817 | `POST /api/gala/checkout-session` | `gala-ticket` (+ `gala_registration_id`, `invoice_number`) | `${host}/?payment=success&gala=<id>` | `…?payment=cancelled&gala=<id>` |
| 6 | 27889 | `GET /pay/gala/:token` (public pay link) | `gala-ticket` | same as #5 | same as #5 |
| 7 | 28403 | `POST /api/croatians-abroad/register` | `croatians-abroad-gala` (+ `invite_link_id`, bundle flags) | `${base}/invite-success?session_id={CHECKOUT_SESSION_ID}` | `${base}/invite-cancelled` |
| 8 | 28755 | `POST /api/register-invite` | `invite-<event_type>` (+ `reg_link_id`, `coupon_code`, `guest_count`…) | `${base}/invite-success?session_id={CHECKOUT_SESSION_ID}` | `${base}/invite-cancelled` |

**Webhook** `POST /api/stripe/webhook` (:20240) — `constructEvent` with `STRIPE_WEBHOOK_SECRET` (:20252), idempotency via `processed_stripe_events` (:20271). Dispatch branches: `accelerator-fee` :20286, `gala-ticket` :20398, `forum-event` :20523, `points-purchase` :20629 (**retired** — logs and returns), `donation` :20642, `croatians-abroad-gala` :20707, `invite-*` prefix :20879 (QR payload built :20971), type-less Plexus fallthrough ~:21032, `charge.refunded`/`charge.dispute.created` :21171 (emails laura.rodman@medx.hr), `checkout.session.expired` :21185. Fulfillment fans out to Brevo emails, FIRA invoicing, and the Google Sheets webhook — renaming any type string silently kills all of it.

**Admin portal**: read-only reconciliation only. `stripeApiGet` (admin server.js:26659) → `GET /v1/checkout/sessions` + `/v1/charges` (:26686–26687), route `GET /api/finance/stripe-payments/recent` (:26778). Env: `STRIPE_READONLY_KEY` (preferred) falling back to `STRIPE_SECRET_KEY` (:26656). No sessions created, no webhook.

Frontend dependencies: `https://js.stripe.com/v3/` in user `index.html:39`; checkout idempotency guard `sessionStorage.medx_plexus_idemp`; Stripe-return handling via `?payment=`/`?type=`/`?reg=`/`?app=`/`?gala=` (see §4.2). Env: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (served at :20159), `STRIPE_WEBHOOK_SECRET`, `STRIPE_READONLY_KEY`.

### 1.2 Brevo (email) — the only live email path

- User portal: `sendEmail(to, subject, html, attachments, cc, replyTo)` at server.js:75 → `POST https://api.brevo.com/v3/smtp/email` (:102, header `api-key`). `sendEventConfirmation` CCs `CONFIRMATION_CC || 'laura.rodman@medx.hr'` (:148). Prod without key = mail dropped loudly (:126–128).
- Admin portal: same-shaped `sendEmail` at server.js:71 → Brevo at :105. Sender identities: default `noreply@medx.hr` via `EMAIL_FROM`; campaigns default `president@medx.hr`, reply-to `pr@medx.hr` / `alen_juginovic@hms.harvard.edu`; accelerator `accelerator@medx.hr`; picker invites footer `pr@medx.hr`.
- Env: `BREVO_API_KEY`, `EMAIL_FROM`, `CONFIRMATION_CC`, `EMAIL_DUMP_DIR`, `EMAIL_LOGO_URL`.
- **Drift to know about:** `render.yaml` still declares `RESEND_API_KEY` and `.env.example` still lists `SMTP_*` — both stale; the code is Brevo-only. `BREVO_API_KEY` lives only in the Render dashboard.

### 1.3 Firebase / Firestore — gala seat picker (admin only)

`admin-portal/backend/picker-sync.js` (wired at admin server.js:12750). Talks to Firestore project **`plexus-gala-tables`** (picker app `https://plexus-tables.netlify.app/`, separate repo `alen-ops99/plexus-gala-suite`). Auth = Identity Toolkit `signInWithPassword` as the organizer console account (:98).

- Collections: `invites/{token}` (16-hex doc id IS the guest credential; create :150 / delete :168 / list :126), `paid_emails/{sha256hex(lower(email))}` (:57 `paidEmailDocId` — **hash must stay byte-identical to the picker client**), `tickets/{tid}` (door-scanner resolution :206), `config/settings` (choose deadlines :258).
- Sync engine `runInviteSync` (:358): paid gala registrants → invites; refunded-unpicked → delete; refunded-but-booked → flagged for a human, never auto-deleted; foreign invites left alone. Local mirror table `gala_picker_invites`.
- Admin routes: `GET /api/admin/gala/picker-sync` (:12840), `POST …/run` (:12856), `POST …/send-invites` (:12872). Scanner recognizes picker tickets via `extractPickerTid` (:32614).
- Invite email contract (:478–527): personal link `PICKER_BASE_URL?t=<token>`, logo `PICKER_BASE_URL/assets/logo-white.png`.
- Env: `PICKER_ADMIN_EMAIL`, `PICKER_ADMIN_PASSWORD` (unset → clean no-op), `PICKER_FB_API_KEY`, `PICKER_FB_PROJECT_ID`, `PICKER_BASE_URL`, `PICKER_TICKET_HOST`, `PICKER_FS_BASE`, `PICKER_AUTH_BASE`.
- The **user portal has no Firebase** — its seat display reads the shared DB (`/api/gala/my-seat`, user app.part9.js:1022 → `#galaSeatValue`).

### 1.4 Google Wallet

- Shared engine `shared/wallet.js`: `walletobjects.googleapis.com/walletobjects/v1`, OAuth `oauth2.googleapis.com/token`, save prefix `https://pay.google.com/gp/v/save/<RS256 JWT>`. The barcode value of every pass is the per-registration `checkin_token` — same credential as printed/email QR.
- User portal routes (pass building): `GET /api/member/wallet/google` (:13293, membership `genericObject`), `GET /api/member/wallet/google/ticket/:regId` (:13383), Apple stub `GET /api/member/wallet/apple/ticket/:regId` (:13438).
- Admin: class provisioning `ensureWalletClassForConference` (:32360–32400), fire-and-forget on conference create (:11013); stores `conferences.wallet_class_id`.
- Env: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY` (secret JSON), `GOOGLE_WALLET_EVENT_CLASS_ID` (read by shared/wallet.js:77), `GOOGLE_WALLET_TICKET_CLASS_ID` + `GOOGLE_WALLET_CLASS_ID` (read by user server.js — note the `.env.example`/code name split), `GOOGLE_WALLET_OBJECTS_BASE`, `GOOGLE_WALLET_OAUTH_URL`; Apple `APPLE_WALLET_*` (dormant). Unconfigured → `{configured:false}`, nothing breaks.

### 1.5 Amadeus (admin only)

Admin server.js:543–620: OAuth vs `test.api.amadeus.com` / `api.amadeus.com` (`AMADEUS_ENV=production`). Routes: `POST /api/admin/plexus/speakers/:id/flight/search` (:20569), `…/flight/quotes` (:20499), `…/flight/offers/pin` (:20620), `GET /api/admin/plexus/travel-budget` (:20542). Env: `AMADEUS_API_KEY`, `AMADEUS_API_SECRET`, `AMADEUS_ENV`, `AMADEUS_BASE_URL`. Unset → key-gate UI, deep links + manual fares keep working.

### 1.6 Meta / Publer (admin only)

- Publer: `https://app.publer.com/api/v1` (:309), auth header literally `Bearer-API <key>` + `Publer-Workspace-Id` (:315–318). Env: `PUBLER_API_KEY`, `PUBLER_WORKSPACE_ID`.
- Meta Graph: `https://graph.facebook.com/v21.0` (:693), IG media/publish + page feed (:729–748). **Credentials live in DB table `pr_meta_settings`** (ig_user_id, page_id, token), not env. Publish log `pr_meta_publish_log`.
- User portal: no social APIs (instagram appears only as a footer link + seed analytics rows).

### 1.7 Anthropic (aiDraft + assistant)

- `shared/ai.js` — `aiDraft()` → `https://api.anthropic.com/v1/messages`, model `AI_DRAFT_MODEL || 'claude-haiku-4-5'`, 8s timeout, rate cap `AI_DRAFT_RATE_MAX` (30/min), no key → empty mock (callers fall back to deterministic text; UI badges "template mode" via `mock_reason`). Used by both portals (user: FAQ enhancer :12564, member summary :13956).
- Admin also calls the API directly: web research w/ server-side `web_search` tool (:28856), assistant chat (:36537), CMO/CFO/COO/CLO advisors (:42126). Models `ASSISTANT_MODEL` (haiku default) and `ASSISTANT_MODEL_COMPLEX` (default `claude-opus-4-8`).
- Env: `ANTHROPIC_API_KEY`, `AI_DRAFT_MODEL`, `AI_DRAFT_RATE_MAX`, `ASSISTANT_MODEL`, `ASSISTANT_MODEL_COMPLEX`.

### 1.8 Turso / libsql — ONE shared database

- Both backends open the SAME DB through `shared/db.js` `createDatabase(...)`: user server.js:6148, admin server.js:3132. Path fallback: `DATABASE_PATH` → `shared/medx_portal.db` → local file; cloud sync via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (embedded replica, debounced push + throttled `freshSync()` pull).
- `scripts/check-schema-sync.sh` requires the `// ===== SCHEMA-MIRROR:BEGIN/END =====` blocks in both server.js files to stay **byte-identical** — any redesign-era backend edit must respect the markers.
- Backups: `.github/workflows/turso-backup.yml` + `predeploy-backup.yml`.

### 1.9 Web Push / VAPID — user portal owns delivery

- User portal: `webpush.setVapidDetails` (:573), routes `GET /api/push/vapid-key` (:23013), `POST /api/push/subscribe` (:23018), `DELETE /api/push/unsubscribe` (:23036); tables `push_subscriptions` + shared `push_outbox`. sw.js handles `push`, `notificationclick` (opens `/?app=1`), `pushsubscriptionchange` (re-subscribes via `/api/push/vapid-key`).
- Admin holds NO VAPID keys — it only **enqueues** rows into `push_outbox`; the user portal drains and sends (admin :4159, :4832, :11942, :22931).
- Env (user service only): `VAPID_PUBLIC_KEY` (committed in render.yaml — the browser subscription is bound to this exact key), `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

### 1.10 Microsoft Graph (admin only)

Outlook inbox module, admin server.js:38593–38708: reads mailbox, stages AI replies to outbox (never auto-sends). Routes `/api/admin/outlook/*` (status :38691, threads :38703) → `contacts` permission section. Env: `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID`, `MS_GRAPH_MAILBOX` (default `team@medx.hr`).

### 1.11 QR generation

- **Hosted QR images live ONLY on the user portal:** `GET /qr/:id.png` (user server.js:4076) — resolves the id across `croatians_abroad_registrations` → `gala_registrations` → `registrations`/`forum_event_registrations`/`bridges_registrations`/`signup_form_responses`; payload JSON `{type:'MEDX_MEMBER', regId, evt, …}`. URL helper `qrImageUrl()` (:497) = `${QR_BASE_URL}/qr/<id>.png`, `QR_BASE_URL = RENDER_EXTERNAL_URL || 'https://medx-user-portal.onrender.com'`.
- Admin mirrors the helper (`qrImageUrl` :817 builds `${userPortalBase()}/qr/<regId>.png` — comment :813 "the /qr/:id.png route lives there") and generates inline QR/PDFs itself (:821, :11187, :19193, :30792, :31504, :33765, :37674, :41939). Admin scanner accepts raw uuid / JSON / `MEDX:` prefix / `/qr/<uuid>.png` URLs (:32273).
- Other QR routes: user `GET /f/:slug/qr.png` (:2349), admin `GET /api/app-install-qr.png` (:41935).
- Frontend rendering depends on the precached `/vendor/qrcode/qrcode.min.js` (user) and `/vendor/html5-qrcode.min.js` + `/vendor/jsqr.min.js` (admin scanner + user scanner).

### 1.12 FIRA fiscal invoicing (Croatian fiskalizacija)

`user-portal/backend/fira-service.js`: `POST ${FIRA_API_URL}/api/v1/webshop/order/custom` (:156), header `FIRA-Api-Key`. Called from webhook fulfillment (user) and from admin "Mark Paid" — **admin imports the user portal's file directly**: `require('../../user-portal/backend/fira-service')` (admin server.js:21). Do not move/rename that file without updating the admin import. Env: `FIRA_API_KEY`, `FIRA_API_URL` (default `https://app.fira.finance`), `FIRA_DISABLED`, admin gate `ENABLE_FIRA_ON_MARK_PAID`.

### 1.13 Google Sheets registration mirror

Outbound POST of registration rows to a Google Apps Script webhook — env `GOOGLE_SHEETS_WEBHOOK`; user server.js call sites :666, :20491, :20837, :21007, :26919, :28339, :28796, :28986. Fire-and-forget; the workbook contract (3 tabs Gala/Conference/Bridges, 14 pipe-set columns) is documented in `google-sheets-setup.md`.

### 1.14 Cloudinary (uploads)

`require('cloudinary').v2` from `CLOUDINARY_URL` (user :5510–5514; admin has the env too). No key → local-disk `uploads/` (ephemeral on Render).

### 1.15 Misc external URLs baked into output

Email logo default `https://cdn.jsdelivr.net/gh/alen-ops99/medx-portal@main/...medx-logo.png` (user :302, override `EMAIL_LOGO_URL`); add-to-calendar `https://calendar.google.com/calendar/render?action=TEMPLATE` (user :11541, site.js:1823); frontends load Google Fonts, `cdn.jsdelivr.net` (html2canvas w/ SRI, chart.js 4.4.1), `js.stripe.com` — all CSP-pinned (smoke test asserts `js.stripe.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com` in the CSP allowlist).

---

## 2. Cross-property URL contracts

### 2.1 Website (medx.hr) → user portal

Bases in `site.js`: `PORTAL = https://medx-user-portal.onrender.com`, `ADMIN = https://medx-admin-portal.onrender.com` (:434/:438/:958–963).

| URL the site sends people to | Built by / carried on | Params |
|---|---|---|
| `…/plexus?event=<slug>&ticket=<phase>&from=website[&mxt=<token>]` | `mxRegUrl` (site.js:1297–1303) rewriting every `a[data-medx-reg]`; ~26 EN + 25 HR links | `event` ∈ `plexus-2026`, `plexus-gala-2026`; `ticket` = live `site.conference.pricing_phase` or `data-medx-reg-ticket`; `mxt` = `localStorage.medx_user_token`. **`mxt` is consumed pre-boot at user `index.html:54`** (stored to `medx_user_token`, stripped from URL). `event`/`ticket`/`from` are intent params — the portal must keep tolerating them on `/plexus` |
| `…/` (portal root) | footers, nav, portal.html (~71 EN + 64 HR) | — |
| `…/forum` | biomedical-forum.html:156,169,183,516 | — |
| `…/donate/checkout?src=medx.hr&amount=&frequency=&designation=` | donate.html:827 `DONATE_CHECKOUT` + :968–975 | `frequency` ∈ `once|month|year` |
| `…/f/dozqZ4xG` | building-bridges.html:480 (Boston pre-registration form slug) | — |
| `…/apply` | site.js `CTA_ALLOW` (:1168) + search index only | — |
| `medx-admin-portal…/` | "Team sign-in" footer link on every page (~29 EN + 24 HR) | — |

Hydration fetches (4.5s timeout, fail-soft): `PORTAL/api/public/site`, `/api/public/content`, `/api/public/status`, `/api/public/supporters` (conditional), `ADMIN/api/public/press` (conditional); MedXBridge also calls `PORTAL/api/auth/login`, `/api/user-notifications/*`, `/api/bell-feed`, `/api/me/next-event`, beacon `/api/public/pv`, probe `<origin>/health` (**always `mode:'cors'` — no-cors probes are rejected by the portals' CORP header**). Field-name contract that must not drift: `site.price.current`, `site.conference.{date_range,end_date,keynote_count_word,pricing_phase,registration_open,start_date}`, `status.projects[].{project_key,status_label,detail_line,cta_label,cta_target,status_kind}` (+`_hr` variants), `content.blocks[key].{body,body_hr}`, `supporters.groups[].{key,label_en,label_hr,items[].{name,logo}}`.

### 2.2 User portal → website

- Stripe donation redirects **hardcoded**: `https://medx.hr/donate?thanks=1` / `?cancelled=1` (user server.js:5449–5450); error/rate-limit fallback `https://medx.hr/donate?checkout_error=1` (:5408, :5416). donate.html reads presence of `thanks` / `cancelled` (British spelling) / `checkout_error` (:829–833).
- UI link-outs: `https://medx.hr`, `https://www.medx.hr`, forum apply `https://medx.hr/forum/apply?code=…` (app.part9.js:33210), plus `medx-website-preview.netlify.app` nav link (:2439).

### 2.3 Admin ↔ user portal

**No authenticated server-to-server API calls and no shared secret exist.** Integration is:

1. **Shared Turso DB** (same `TURSO_DATABASE_URL`, same `shared/medx_portal.db`). Cross-portal tables: `registrations`, `registration_links`, `gala_registrations`, `gala_picker_invites`, `gala_*` seating tables, `payment_transactions`, `finance_transactions`, `push_outbox` (admin writes → user sends), `portal_content`, `feed_items`, `opportunities`, `announcements`, `user_notifications`, `points_ledger`, all `forum_*` / `accelerator_*` / `bridges_*` tables. 233 distinct tables; either portal may mutate the other's rows (demo-purge.js:100 purges user seeds from the admin side).
2. **Shared/imported code**: `shared/db.js`, `shared/ai.js`, `shared/wallet.js`, `shared/medx-tokens.css`, and admin's direct `require('../../user-portal/backend/fira-service')`.
3. **URL generation** via `userPortalBase()` (admin server.js:803) = `USER_PORTAL_URL` env → `https://medx-user-portal.onrender.com` (prod) → `http://localhost:3010` (dev). Admin builds these user-portal links: `/plexus/:token` (:31019, :36157, :38939), `/invite/:base64` (:36158), `/donor-night` (:31022), `/forum` (:39684), `/forum/enter?token=` (:39251), `/f/:slug` (:30511), `/qr/:regId.png` (:817), `/privacy`, `/terms` (:257–259). Admin base = `RENDER_EXTERNAL_URL || ADMIN_PORTAL_URL || https://medx-admin-portal.onrender.com` (:1958).
4. **Admin-hosted public links** (resolve on the ADMIN origin): `/evaluate?token=` interviewer console (:15406), `/e/:token` combo invites (:30854), `/apply` (:24876), `/review` (:24345), `/newsletter` (:23738), volunteer `?gd=<token>` deep link.
5. **One direct browser cross-origin call**: admin frontend `index.html:43173` POSTs a gala refund to `https://medx-user-portal.onrender.com/api/admin/payments/gala/:id/refund` (localhost:3001 in dev) — the user portal owns Stripe, so admin refunds cross origins. Keep the route AND the user portal's CORS allowlist (user server.js:588–591 allows both onrender hosts + medx.hr).
6. **Firestore picker** as an out-of-band rendezvous (§1.3), and the user-portal-served `theme`/wallet assets.
7. Admin UI links out to `https://plexus-tables.netlify.app/planner.html` + `/admin.html` (picker consoles) and `https://harvard.zoom.us/my/alen1`.

### 2.4 Email/QR/wallet/ICS contracts (URLs that live forever)

Baked into already-sent emails, printed QRs, wallet passes, and calendar subscriptions — these exact paths + param names are permanent:

- Verify: `${base}/api/verify-email?token=` (:11297, legacy) and `${base}/api/auth/verify?token=` (:11331, :11481).
- Password reset `${base}/reset-password/<token>` (:11764).
- Invites: `${base}/invite/<base64url {e,x,i}>` (:27048, :27125; revocation list `REVOKED_INVITE_IDS`), `/plexus/<token>` chooser, admin `/e/<token>` combo links, interviewer `${adminBase}/evaluate?token=<access_token>` (:15708→admin), applicant `${base}/apply?verify=<token>` (:23358).
- Passes/tickets: `/pass/<token>` guest passes (+ `/pass/<token>/calendar.ics`, `/manifest.json`), `/pay/gala/<token>`, `/qr/<id>.png` images embedded in emails (:29367, :2255, :13090), wallet `https://pay.google.com/gp/v/save/<JWT>` (barcode = `checkin_token`).
- Badges/records/certificates: `/verify/<token>` member badge, `/r/<token>` shared record, `/verify-certificate?n=<number>`.
- Forms & calendars: `/f/<slug>` (+ `/qr.png`, `/calendar.ics`), `/calendar/medx-events.ics` subscription feed, `/calendar/:file`, `/speaker/<token>` itineraries.
- Unsubscribe/prefs: `/unsubscribe?e=<b64url email>&s=<HMAC>` and `/email-prefs?e=&s=` (HMAC `emailPrefSig` — the signing scheme itself is a contract).
- Picker invites: `https://plexus-tables.netlify.app/?t=<16-hex token>` (doc id = credential).
- Legal links in every email footer: `https://medx-user-portal.onrender.com/privacy` + `/terms` (hardcoded, user :467–469, admin :257–259).

**Base-URL hazard:** user server.js resolves "my own URL" 7+ different ways (`QR_BASE_URL` :500, `PORTAL_BASE_URL()` :11369, `PUBLIC_BASE_URL || RENDER_EXTERNAL_URL || req host`, `PORTAL_URL || req host`, plain req host, `ADMIN_PORTAL_URL` :28495). A redesign must not "unify" these into different output URLs.

---

## 3. Inbound routes outside things call (cannot be renamed)

### User portal (`medx-user-portal.onrender.com`)

| Route | Caller | Reads |
|---|---|---|
| `POST /api/stripe/webhook` (:20240) | Stripe | `stripe-signature` header, raw body |
| `GET /invite-success` (:801) / `GET /invite-cancelled` (:972) | Stripe redirects | `?session_id=` |
| `GET /?payment=…` (SPA root) | Stripe redirects (#2–6 in §1.1) | `payment`, `type`, `reg`, `app`, `gala` |
| `GET /donate/checkout` (:5411) | medx.hr donate page | `amount`, `frequency`, `designation`, `src` |
| `GET /api/auth/verify` (:11701) / `GET /api/verify-email` (:11253) | verification emails | `?token=` |
| `GET /reset-password/:token` (:11789) | reset emails | token |
| `GET /plexus` + `GET /plexus/:token` (:1292) | website deep links + invite emails | `:token` or `?t=`; tolerates `event`/`ticket`/`from`/`mxt` |
| `GET /invite/:data` (:3254) | invite emails | base64url `{e,x,i}` |
| `GET /pay/gala/:token` (:27868) | gala pay-link emails | token → creates Stripe session |
| `GET /pass/:token` (:5363) + `/calendar.ics` (:3227) + `/manifest.json` (:5341) | guest-pass links | token, `?lang=` |
| `GET /verify/:token` (:2717), `GET /r/:token` (:2906) | badge QRs, shared records | token |
| `GET /f/:slug` (:2363) + `/qr.png` (:2349) + `/calendar.ics` (:3204) | signup-form QRs/links | slug |
| `GET /qr/:id.png` (:4076) | QR `<img>` in emails, wallet, admin | hex/uuid id |
| `GET /api/accelerator/interview-access/:token` (:15515) + `POST …/score` (:15635) | interviewer magic links | token |
| `GET /api/applicant/verify/:token` (:23388), `POST /api/applicant/login` (:23401) | applicant emails/portal | token |
| `GET /unsubscribe` (:1857), `GET/POST /email-prefs` (:1827/:1837) | one-click links in every email | `e`, `s`, `saved` |
| `GET /calendar/medx-events.ics` (:3147), `GET /calendar/:file` (:3188) | calendar subscriptions | — |
| `GET /verify-certificate` (:22262) | printed certificate QRs | `n` / `number` |
| `GET /donor-night` (:1762), `GET /building-bridges` (:1761) | public event pages | — |
| `GET /api/members/verify` (:26838) | external member checks | `id` / `email` |
| `GET /speaker/:token` (:5097) + `/api/public/speaker-itinerary/:token` (:5117) | speaker links | token |
| `GET /api/push/vapid-key`, `POST /api/push/subscribe`, `DELETE …/unsubscribe` (:23013–23036) | browsers + sw.js | subscription JSON |
| `/api/public/{site,content,status,supporters,pv}` | medx.hr site.js | — |
| `GET /health` | Render deploy gate, GH keepalive/uptime workflows, site probes | — |
| `POST /api/admin/payments/gala/:id/refund` | admin portal frontend (cross-origin) | admin JWT |

### Admin portal (`medx-admin-portal.onrender.com`)

| Route | Caller | Reads |
|---|---|---|
| `GET /evaluate` (:24519) + no-auth APIs `GET /api/accelerator/interview-access/:token` (:15172), `…/application/:appId` (:15244), `POST …/score` (:15310), `POST /api/accelerator/interview-score` (:15146) | evaluator magic links | token |
| `GET /review` (:24345) + `GET /api/review-access/:token` (:14660), `…/submission/:assignmentId` (:14685), `POST …/scorecard/:assignmentId` (:14702), `POST …/recuse/:assignmentId` (:14714) | reviewer magic links | token |
| `GET /apply` (:24876), `POST /api/applicant/register` (:23976), `GET /api/applicant/verify/:token` (:24031), `POST /api/applicant/login` (:24044), `GET /api/applicant/programs` (:24331) | applicant portal | token/body |
| `/?gd=<token>` (frontend :17751) → `POST /api/gameday/volunteer/login` (:42916) + volunteer status/dashboard/messages (:42934–42960) | gameday volunteer magic links | 16–128 hex token from `gameday_invites`; 3-day JWT `kind:'gameday_volunteer'`; session `sessionStorage.medxGdVolSession` |
| `GET /e/:token` (:30854, :30921) | combo-invite emails | token (`combo_invite_links`) |
| `GET /api/public/{content,status,press,press/:slug}` (:11786–11852) | medx.hr site.js | — |
| `POST /api/public/newsletter/subscribe` (:23745), `GET /newsletter` (:23738) | website/public | — |
| `POST /api/public/register-invite` (:19949), `/api/public/testimonial[/submit]` (:21615/:21637), `GET /api/org/signature` (:38286), `GET /api/app-install-qr.png` (:41935), `/api/portal-content/published…` (:33848) | public | — |
| Check-in scan family (auth `staffOrAdmin`/`adminOnly`, NOT public — but the scanner UI depends on them): `POST /api/admin/checkin/scan` (:18853), `POST /api/admin/checkin/ticket` (:32589), `GET /api/admin/checkin/resolve` (:32480), `GET /api/admin/gala/scan/:regId` (:33341), `POST /api/admin/gala/checkin` (:33369), `POST /api/plexus/checkin` (:19818), `POST /api/checkin` (:33608), forum/bridges variants (:16988, :33389, :33422, :29651) | door scanners | QR payloads (§1.11) |
| `GET /health` (:43032) | Render, workflows | — |

Note: there is **no** public volunteer login on the user portal — user-portal volunteer/check-in routes are all JWT-gated; gameday magic links resolve on the admin origin.

---

## 4. Frontend element / attribute contracts

### 4.1 medx.hr `site.js` hooks (the entire live-data contract)

Every page (EN + `/hr/`) loads `/site.js`. Hooks are queried by attribute presence:

| Attribute | site.js | Purpose |
|---|---|---|
| `data-medx-slot="source:key"` | :1083–1094 | text/HTML hydration; source ∈ `site` / `content` / `status`; never blanks baked copy |
| `data-medx-fmt` (`date-long`/`price`/`cap`/`raw`) | :1041 | locale-aware formatter |
| `data-medx-html="1"` | :1092 | sanitized innerHTML slots |
| `data-medx-cta="register"` | :1098–1116 | closes/reopens registration CTAs from `site.conference.registration_open`; stashes href in `data-medx-href` |
| `data-medx-reg="plexus-2026|plexus-gala-2026"` + `data-medx-reg-ticket`, skip flag `data-medx-closed="1"` | :1297–1312 | **rewrites href → portal deep link** (§2.1) |
| `data-medx-status-cta` / `data-medx-status-dot` / `data-medx-statusbar` (`plexus|gala|bridges|accelerator`) | :1174–1198 | project status bars; href rewrite gated by `CTA_ALLOW` allowlist (:1168) |
| `data-medx-strip` / `data-medx-strip-x` | :1151–1163 | announcement strips; dismissal keyed by exact text in `localStorage.medx_strip_dismissed` |
| `data-medx-countdown` / `data-medx-countdown-time`, `[data-countdown]` | :1119–1130 | live countdown re-targeting (`window.__medxStartCountdowns`) |
| `data-medx-jsonld` | :1133 | JSON-LD date patching (plexus.html:547) |
| `data-medx-list="site:speakers|press:releases|supporters:wall"` + `<template data-medx-item>` + `[data-medx-list-target]` | :1204–1256, :1270–1291, :1326–1389 | list hydration; renders only on non-empty live arrays |
| `data-medx-fallback="speakers"` + `data-medx-fallback-names` | :1226–1231 | drift-aware swap between baked cards and live list |
| Row bindings `data-mx-field`, `data-mx-date/tag/title/summary/url`, `data-mx-keynote`, `data-mx-photo-fallback`, `data-mx-rendered` | :1245–1288 | field binding inside cloned template rows |
| Supporters `data-sup-tile/name/group/label/grid/logos-only/more` | :1336–1388 | supporters wall; prefers local logo assets over portal URLs |
| `data-cal-title/start/end/location/desc/url/time/endtime` on `.medx-cal` | :1751–1780 | calendar builder — ICS w/ hardcoded Europe/Zagreb VTIMEZONE + Google Calendar link; `data-cal-end` is the INCLUSIVE last day |
| Nav hooks `.nav-portal`, `.mm-portal` | :677–724 | MedXBridge hijacks these anchors for signed-in state |

Website storage: `medx_live_cache` (SWR blob), `medx_user_token` (for `&mxt`), MedXBridge `TOKEN_KEY`/`USER_KEY`, `medx_session_expired`, `medx_notif_read`, `medx_notif_snooze`, `medx_prompt_state`, `medx_strip_dismissed`; sessionStorage `medxLaureate`, `medxPlexusLive`.

Structural contracts: the `/hr/` **path prefix** drives locale (`IS_HR = pathname.indexOf('/hr/')===0`, :1002) — do not switch Croatian to `?lang=` for existing pages; `data/site-snapshot.json` is fetched **relative** (so `/hr/data/site-snapshot.json` must exist); `_redirects` keeps `/hr/heritage→/heritage/?lang=hr` and `/hr/network→/network`; events.html builds three portal links in page-local JS (:770–786) outside the `data-medx-reg` system.

### 4.2 User portal frontend

**localStorage (canonical auth pair):** `medx_user_token` + `medx_user_data` — read by `init()` auto-login (app.part9.js:3442–3476) and every API call; `mxt` handoff writes the token pre-boot (index.html:54). Legacy mirrors also referenced: `medx_token`, `medx_user`, `token`, `userToken`, `userPortalUser`, `user_id`. Other load-bearing keys: `medx_user_email`, `medx_biometric_enabled`/`medx_biometric_email` (WebAuthn), `medx_2fa_enabled`/`medx_2fa_recovery_codes`, onboarding flags (`medx_onboarding_*`), event state (`plexus_registered`, `plexus_registration_id`, `gala_registration_data`, `medx_registrations`, `forum_*`…), drafts (`accApplicationDraft`, `medx_accelerator_draft`…), preferences (`medx_theme`, `medx_locale`, dashboard layout keys). sessionStorage: `medx_verify_dismissed`, `medx_login_attempts`, `medx_login_lockout`, **`medx_plexus_idemp`** (double-charge guard), `medx_forum_verified`.

**URL params handled in `UserPortal.init()`** (app.part9.js:3362+) — all must keep working: `mxt`, `invite`, `register`, `logout=true`, `section`+`code` (speaker portal deep link), `verified` (`true|already|expired|invalid`), `payment` (`success|cancelled`) + `type`+`reg`/`app` (`handleStripeReturn` :9822), `gala`, `view=ticket`, `login=true`, `mode=scanner`+`event`, plus the accelerator-prefill family (`first_name`, `email`, `oib`, `gpa`, …). Path route: `/forum/events/<slug>` regex (:4925); forum-wing token at forum-wing.html:511.

**Navigation contract:** `UserPortal.showSection(id)` toggles `.active` on **`#section-<id>`** nodes and pushes `#<id>` to history (:27156–27170). Section ids: `dashboard, plexus, network, forum, settings, accelerator, mymedx, communications, rewards, gala, finances, bridges, talks, speaker, checkin-scanner, speaker-management, profile, pr-media, building-bridges, automations` (+ `.sidebar-project[data-project]`). Sub-navigation switches on **`data-tab`** values (`overview, register, abstract, schedule, speakers, mypass, myschedule, …`) via `PlexusPortal.showTab` / `GalaPortal.showTab`; settings uses `[data-settings-tab]`.

**Load-bearing element IDs:** auth `#loginModal #loginPage #loginEmail #loginPassword #loginError #userLoginBtn #splashEntry #registerModal`; register `#registerFirstName …LastName …Email …Password …PasswordConfirm …Institution …Country …Consent …Error …Success #regConfirmEmail #regResendBtn`; shell `#landingPage` + `#userPortal`; Stripe recovery `#pxStripeCancelled #pxStripeProcessing`; gala `#galaRegisterForm #galaFirstName …LastName …Email …Institution …Title …Dietary …Requests #galaSeatValue #galaMyPassTab`; QR/tickets `#pxQrCanvas #passModal #passPreview #passQrCanvas #quickQRModal #mxPresentQR #mymedxCardQr #ticketTransferModal`; notification attrs `[data-mx-notify] [data-mx-status] [data-mx-detail] [data-pending]`.

**API base:** always same-origin relative `/api/...` (`apiBase()` returns `''`). The only absolute portal URL is the admin-portal link-out (app.part9.js:3693). `scripts/check-api-contract.js` enforces frontend-call ↔ backend-route matching in CI — any renamed endpoint fails the build.

**Service worker** (`sw.js`): `CACHE_NAME = 'medx-portal-v9'`; precache EXACT paths `/index.html /manifest.json /icon-192.png /vendor/qrcode/qrcode.min.js /vendor/fontawesome/css/all.min.css` (same-origin only, deliberately); never caches `/api/`; navigations network-first with `/index.html` shell fallback; handles push/notificationclick/pushsubscriptionchange. Renaming any precached file breaks SW install silently. Asset tags carry `?v=` busters rewritten by `stamp-sw.sh`.

**Smoke-pinned markers** (tests/smoke.js — CI will fail without them): `window.MEDX_DATES` global in the served HTML, the `window.location.pathname.match` path-style direct-link handler, SW cache name matching `/medx-portal-v\d+/`, SW `/api/` bypass, CSP allowing `js.stripe.com` + `cdn.jsdelivr.net` + `cdnjs.cloudflare.com`, `script-src-attr` permitting inline `onclick=` (the SPA relies on inline handlers), `/api/plexus/settings` schema + seeded promo codes `FORUM26` / `EARLYBIRD25`, `/forum/events/<slug>` returning 200.

**External script tags:** `https://js.stripe.com/v3/` (:39), Google Fonts Inter + Fraunces (:24–25), html2canvas via jsdelivr with SRI (:35), vendored `/vendor/jsqr/jsQR.min.js`, `/vendor/fontawesome/...`, `/vendor/qrcode/...`.

### 4.3 Admin portal frontend

**localStorage:** `medx_token` (JWT) + `medx_user` — read in `init()` (index.html:17757–17759); also `token` (19/13 uses). Offline door-scanner queue: **`checkinQueue`** + **`checkinRoster`** (queued scans survive reloads — must persist through redesign). Preferences: `medxAdminTheme`, `widget_*`, `medx_project_order`, `medx_pinned_projects`, `medx_ac_collapsed`, `medx_admin_hint_off_*`, `medxCustomShortcut`, `medxHomeNotes`, `medxDiscoverSeen/Lang`, `chatPinned`, `chatHidden`, `accApplicationDraft`. sessionStorage: **`medxGdVolSession`** (gameday volunteer session), `medxGdEscaped`.

**Boot order contract** (index.html:17745–17762): `?gd=<token>` volunteer magic link is handled BEFORE admin auth (`GameDay.volunteerBoot`), then `medxGdVolSession` resume, then `medx_token`/`medx_user` validation.

**Navigation:** `showSection('<id>')` (184 call sites) + sidebar `data-section="<id>"` + hash routing (`history.replaceState({section: location.hash.slice(1) || 'dashboard'})`, :31309). Frontend section ids include UI-only sections (`dashboard, discover, merch-studio, website-content, content-studio, team-chat, outbox, newsletter, email-blast, announce, member-feed, postevent, event-tracking, croatians-abroad, auctions, speaker-itineraries, health, audit, resources, portal-content, user-notifications, messages, transparency, year-calendar, signup-forms, guest-passes, gameday, gala, plexus, conferences, editions, cme, finances, contacts, advisors, files, team, tech, pr-media, member-ops`) — the subset that matches backend permission ids (§5.3) must stay aligned, and `users.allowed_sections` drives sidebar rendering (`allowed_sections`, 15 hits).

**Login IDs:** `#loginPage #loginForm #loginEmail #loginPassword #loginError`.

**Vendor libs (keep or replace deliberately):** `/vendor/html5-qrcode.min.js` + `/vendor/jsqr.min.js` (scanner), `/vendor/leaflet/leaflet.js` (Live Ops Map — SW deliberately never intercepts cross-origin so OSM tiles load), `/vendor/model-viewer`, `chart.js@4.4.1` from jsdelivr CDN, fontawesome.

**Cross-origin calls from this frontend:** the gala refund POST to the user portal (:43173, §2.3.5); links to `plexus-tables.netlify.app/planner.html|admin.html`.

**Service worker** (`sw.js`): `CACHE_NAME = 'medx-staff-v2'`; shell `['/index.html','/manifest.json','/icon-192.png']`; network-first, never cross-origin, never `/api/`. Smoke test requires the served admin HTML to contain **`theme-fresh`**.

---

## 5. Config that pins behavior

### 5.1 `render.yaml` (three services)

| Service | rootDir | buildFilter (what triggers deploys) | Health | Plan |
|---|---|---|---|---|
| `medx-user-portal` | `user-portal/backend` | `user-portal/**` | `/health` gates traffic; crash → rollback | starter (free tier sleeps — the old "waiting for portal" bug) |
| `medx-admin-portal` | `admin-portal/backend` | `admin-portal/**` | `/health` | starter |
| `medx-gateway` | `landing` | (none) | — | free (static landing linking to both portals) |

Build command for both portals: `npm install && bash ../../scripts/stamp-sw.sh` — the frontend is served BY the backend service; a frontend-only commit deploys because of the `buildFilter` paths. **Changes outside `user-portal/**` / `admin-portal/**` (e.g. `shared/`, `scripts/`) do NOT auto-deploy** — shared-code edits need a portal-dir touch or manual deploy.

**Committed env values (safe list):** `PORT`, `NODE_ENV`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY` (user), `VAPID_SUBJECT`, `FIRA_API_URL`, `MEDX_BANK_NAME`, `MEDX_SWIFT`, `MEDX_COMPANY_NAME`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_EVENT_CLASS_ID`, `AMADEUS_ENV` (admin).
**Dashboard-only secrets (`sync: false`):** `RESEND_API_KEY` (stale name — real key in use is `BREVO_API_KEY`, set in dashboard), `VAPID_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIRA_API_KEY`, `MEDX_IBAN`, `MEDX_VAT_ID`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_WALLET_SA_KEY`, `AMADEUS_API_KEY/SECRET` (admin), `PICKER_ADMIN_EMAIL/PASSWORD` (admin); `JWT_SECRET` is `generateValue: true` **per service** (the two portals mint different JWTs — admin tokens are not user tokens). Additional prod env set only in the dashboard (read by code, absent from render.yaml): `ANTHROPIC_API_KEY`, `STRIPE_READONLY_KEY`, `GOOGLE_SHEETS_WEBHOOK`, `CLOUDINARY_URL`, `MS_GRAPH_*`, `PUBLER_*`, `USER_PORTAL_URL`, `ADMIN_PORTAL_URL`, `CONFIRMATION_CC`, `KEEP_WARM`, `ENABLE_FIRA_ON_MARK_PAID`, `TECH_PASSWORD`, `CME_ENC_KEY`, `CORS_ORIGIN`.

### 5.2 `scripts/stamp-sw.sh` (SW cache-bust mechanism)

Runs on every Render build. Contract it depends on:
- Each `sw.js` must contain a line matching `const CACHE_NAME = '<base>-v<N>'` — the script appends `-<gitSHA7>` while PRESERVING the `-vN` prefix (`medx-portal-v9` → `medx-portal-v9-a1b2c3d`). The prod smoke test asserts `/medx-portal-v\d+/`. If a redesign rewrites sw.js, keep that exact declaration form.
- User `index.html` asset tags must keep the shape `assets/app.css?v=<token>` / `assets/app.partN.js?v=<token>` — the script rewrites `?v=` by regex `assets/app\.(css|part[0-9]+\.js)\?v=...`. Renaming the split-asset scheme (e.g. to `bundle.js`) silently disables cache-busting unless the script is updated in the same commit.
- Build-safe: never fails the build; verifies rewrites through temp files.

### 5.3 Admin `SECTION_ROUTE_MAP` (permission prefixes)

Admin server.js:1183–1239; enforced in `auth()` via `sectionDenied()` (:1081–1097, :1256–1262). `users.allowed_sections`: NULL = full access, `'[]'` = Home only, else JSON array of section ids. Founder bypasses. First match wins; deny-only-what-is-mapped. Section → route prefixes:

- **plexus**: `/api/plexus`, `/api/admin/plexus`, `/api/admin/plexus-experience`, `/api/gala`, `/api/admin/gala`, `/api/checkin`, `/api/admin/checkin`, `/api/admin/scan-context`, `/api/admin/auctions`, `/api/admin/auction-summary`, `/api/admin/speaker-itineraries`, `/api/admin/speaker-kits`, `/api/admin/sponsor-reports`, `/api/admin/sponsor-tiers`, `/api/admin/talks`, `/api/admin/sessions`, `/api/admin/spatial`, `/api/admin/abstracts`, `/api/admin/registrant*`, `/api/admin/registrations`, `/api/admin/registration-links`, `/api/admin/seat-confirmations`, `/api/admin/waitlist*`, `/api/admin/early-bird`, `/api/admin/coupons`, `/api/admin/tickets`, `/api/admin/event-invites`, `/api/admin/event-reminders`, `/api/admin/event-survey`, `/api/admin/event-components`, `/api/admin/post-event`, `/api/admin/testimonials`, `/api/admin/print`, `/api/admin/wallet`, `/api/admin/analytics`, `/api/admin/export`
- **accelerator**: `/api/accelerator`, `/api/admin/accelerator`, `/api/admin/accelerator-sites`, `/api/applicant`, `/api/admin/review`, `/api/review-access`, `/api/admin/opportunities`, `/api/admin/research`
- **forum**: `/api/admin/export/forum-registrations` (**must stay listed BEFORE `/api/admin/export`** — deeper-prefix-first), `/api/forum`, `/api/admin/forum`, `/api/admin/council`
- **bridges**: `/api/bridges`, `/api/admin/bridges`, `/api/admin/croatians-abroad`
- **gameday**: `/api/gameday`, `/api/admin/gameday`, `/api/staff-tracking`, `/api/admin/staff-tracking`
- **conferences** `/api/admin/conferences` · **editions** `/api/admin/editions` · **signup-forms** `/api/admin/signup-forms` · **guest-passes** `/api/admin/guest-passes`, `/api/admin/guest-pass-events`, `/api/admin/member-guest-passes` · **year-calendar** `/api/admin/year-calendar` · **cme** `/api/admin/cme`
- **pr-media**: `/api/pr`, `/api/admin/pr`, `/api/admin/pr-newsletters`, `/api/admin/newsletters`, `/api/admin/newsletter-interests`, `/api/admin/newsletter-segments`, `/api/admin/audiences`, `/api/admin/content`, `/api/admin/content-blocks`, `/api/admin/content-checklist`, `/api/admin/feed-items`, `/api/admin/digest`, `/api/sequences`
- **member-ops**: `/api/admin/messages`, `/api/admin/member-announcements`, `/api/admin/announcements`, `/api/admin/member-meta`, `/api/admin/member-card-toggles`, `/api/admin/bulk-email`, `/api/admin/outbox`, `/api/admin/rewards`, **`/api/admin/users`** (note: member-ops, not team), `/api/admin/notifications`
- **finances**: `/api/finance`, `/api/admin/transparency` · **contacts**: `/api/contacts`, `/api/admin/outlook` · **advisors**: `/api/admin/advisors` · **files**: `/api/files`, `/api/folders`, `/api/admin/files`, `/api/upload` · **team**: `/api/admin/team` · **tech**: `/api/admin/tech`, `/api/admin/system-health`, `/api/admin/health`, `/api/admin/audit-log`

Renaming ANY of these route prefixes = the permission system stops seeing them (unmapped routes are open to every signed-in admin). Section metadata in `PERMISSION_SECTIONS` (:1153–1173); management routes `GET/PUT /api/admin/team/permissions` (founderOnly, :35194/:35207).

### 5.4 medx.hr digest-deploy rules (Netlify)

- Deploy ONLY via the Netlify digest API from the live mirror (site id `58a61ec7-6dce-440b-92a8-c37256e6ba28`); `MedX_Squarespace/site_v2/` is stale (249/398 live files missing) — a folder deploy from it would delete pages.
- **Pinned rule** (`_DEPLOY_README.txt`): always include `"/netlify.toml": "ed27a064daed40cb7c28cd58f155be7ead6b1658"` in the digest and NEVER upload a local netlify.toml — the API cannot download the real one (returns stubs).
- The pinned netlify.toml holds caching headers only (`site.js`/`styles.css` max-age 3600 + SWR; `photos/cdn/*` immutable). Redirects live in `_redirects` (3 rules, §4.1).
- Never probe the portals with `mode:'no-cors'` — the portals' CORP header makes every such probe reject (root cause of the 2026-08 "waiting for portal" saga).

### 5.5 CI / repo guards that will catch (or block) redesign mistakes

- `scripts/check-api-contract.js` — every `/api/...` the frontends call must have a matching Express route on the serving backend (allowlist in `scripts/api-contract-allowlist.txt`).
- `scripts/check-schema-sync.sh` — SCHEMA-MIRROR blocks in both server.js files must stay byte-identical.
- `tests/smoke.js` (`npm run smoke`) — prod assertions listed in §4.2; runs against `https://medx-user-portal.onrender.com` + admin.
- `.github/workflows/`: `boot-smoke.yml` (boot the servers before deploy — a TDZ bug once nearly took prod down), `keepalive.yml` + `uptime-alert.yml` (ping `/health` on both portals + `https://medx.hr`), `turso-backup.yml` + `predeploy-backup.yml` (DB dumps), `smoke.yml` (staging URL `https://staging.medx-user-portal.onrender.com`).
- Boot-test `server.js` locally before pushing backend changes (Render's health gate is the last line, not the first).

---

## 6. Safe to restyle vs must-preserve cheat sheet

| Category | Redesign may change freely? | Notes |
|---|---|---|
| Visual markup, CSS, layout, spacing, animation | **YES** | Entire look and feel is fair game — `app.css` (1.5 MB), admin styles, site styles |
| Copy/text inside elements | YES (subject to content rules) | Hydration slots overwrite text anyway; keep slot attributes on the new elements |
| Class names used only for styling | YES | EXCEPT: `.section`/`.active`/`.nav-item` (user SPA), `.nav-portal`/`.mm-portal` (site.js), `.medx-cal`, `.sidebar-project`, `theme-fresh` (admin, smoke-pinned), `.medx-cta-closed` |
| Images, icons, fonts | YES | Keep `/icon-192.png`, `/manifest.json`, precached vendor paths (or update `sw.js` + bump cache) |
| DOM structure around hooks | MOSTLY | Attributes/IDs may move to new elements, but must exist once with same semantics; `<template data-medx-item>` + target structure must survive |
| Element **IDs** listed in §4.2/§4.3 (login, register, gala, QR, shell) | **NO** | JS queries them directly |
| `data-medx-*`, `data-sup-*`, `data-mx-*`, `data-cal-*`, `data-tab`, `data-section`, `data-settings-tab`, `data-project`, `data-countdown` | **NO** | The wiring IS these attributes |
| `#section-<id>` id scheme + section/hash names (user), `showSection` ids (admin) | **NO** | Deep links + history + permission alignment |
| localStorage / sessionStorage keys (§4.1/§4.2/§4.3) | **NO** | Renaming logs everyone out, loses offline check-in queues, drops caches |
| URL query params (`mxt`, `payment`, `type`, `reg`, `app`, `gala`, `verified`, `invite`, `register`, `login`, `section`+`code`, `gd`, `t`, `e`+`s`, `thanks`/`cancelled`/`checkout_error`, `event`/`ticket`/`from`) | **NO** | Read by boot code, Stripe returns, magic links, the website |
| Backend route paths (§3) + `/api/...` prefixes (§5.3) | **NO** | Emails/QRs/Stripe/website/permissions depend on exact paths |
| Stripe `metadata.type` strings + success/cancel URL shapes | **NO** | Fulfillment dispatch keys on them |
| `/api/public/*` JSON field names (§2.1) | **NO** | site.js hydration + snapshot seeding |
| SW `CACHE_NAME` declaration form + `?v=` asset-buster shape | **NO** (bump versions, keep the form) | stamp-sw.sh + smoke regex |
| Inline `onclick=` handlers | Keep working | CSP `script-src-attr 'unsafe-inline'` is load-bearing (smoke-pinned); if migrating to listeners, migrate the CSP test too |
| Env var names, render.yaml services/buildFilters | **NO** (additions fine) | Dashboard secrets are keyed to these names |
| Vendored libs (qrcode, jsQR, html5-qrcode, leaflet) | Replace only with feature parity | Scanner, passes, Live Ops Map |
| Split-asset scheme `assets/app.partN.js` + `app.css` | Renameable ONLY with a matched `stamp-sw.sh` + `sw.js` + smoke update in the same commit | Otherwise cache-busting dies silently |
| `/hr/` path prefix + relative `data/site-snapshot.json` | **NO** | Locale + snapshot seeding |
| `shared/` file locations (`db.js`, `ai.js`, `wallet.js`, user `fira-service.js`) | **NO** without updating both requires | Admin imports across directories |
| Firestore doc-id scheme (`invites/{token}`, `paid_emails/{sha256}`) | **NO** | Byte-identical with the external picker app |
| netlify.toml sha pin + `_redirects` | **NO** | Digest-deploy contract |

---

*Compiled 2026-08-10 from a read-only audit of the sources listed at top. Line numbers refer to the files as of this date; they will drift with edits — the route paths, names, and shapes are the contract, not the line numbers.*
