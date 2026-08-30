# Med&X Admin Portal — frontend-v2 ARCHITECTURE

The redesigned ADMIN front end: vanilla ES modules, **no build step**, one HTML shell, one shared
header, a History-API router and one module per destination. Design source: the Claude Design export
in `design/handoff/admin-portal-2026-08-28/` (17 artboards + README implementation notes 0a–26).
The backend is the existing `admin-portal/backend/server.js` (1,076 routes) — nothing in this folder
changes it, and `admin-portal/frontend/` (the live SPA) is untouched.

Destination engineers: read **§3 (module APIs)**, **§4 (how to add a destination)**, **§6 (artboard →
view table)** and **§7 (applying a design revision)**. Everything else is reference.

The conventions are deliberately the same as the member portal's `user-portal/frontend-v2/` — same
view contract, same `data-act` + `ui.bind`, same `<!-- dc: … -->` block markers, same `COPY`/`FACTS`
split, same `api.settle`, same waking overlay. Differences are listed in §13.

---

## 0. Status

| Area | State | Module |
|---|---|---|
| Shell, tokens, header chrome (logo lockup + ADMIN · top nav with live INBOX badge · PROJECTS dropdown · TEAM CHAT pill · search-or-task field · profile menu with editable display name) | **built** | `index.html`, `css/*`, `js/chrome.js` |
| Router (+ auth guard, permission guard, scroll restore), API client (401 / 403-locked / 429 / 503-waking), session, permissions, UI helpers, facts, health probes | **built** | `js/router.js`, `js/api.js`, `js/state.js`, `js/perms.js`, `js/ui.js`, `js/facts.js`, `js/health.js` |
| Sign in (+ invited-admin "set your password" step) | **built** | `js/views/signin.js` |
| **Today** — greeting · ✎ CUSTOMISE · hero numbers + 30-day registration trend · YOUR PROJECTS · NEEDS YOUR ATTENTION (+ snooze/undo, one-click DO) · DO IT NOW · COMING UP · TEAM TASKS (add/tick/undo) · THE WEEKLY READ · ADMIN footer · ALL SYSTEMS OK pill | **built** | `js/views/today.js` |
| Settings | **partial** — the SYSTEM HEALTH card is real (the door behind the status pill); team access, org & payments, audit log, team library are stubs | `js/views/settings.js` |
| 404 · Locked (permission 403 state) | **built** | `js/views/notfound.js`, `js/views/locked.js` |
| Plexus · Accelerator · Forum · Bridges hubs · Inbox · People · Money · Calendar · Event Day · Studio · Gala · Registrations · Links · Member Pages · Review Room | **stub** (title + IN PROGRESS, routes + sub-nav live) | `js/views/<name>.js` via `_stub.js` |
| PWA manifest, Netlify files, dev server, QA script | **built** | `manifest.webmanifest`, `netlify/_redirects`, `netlify.toml`, `dev-server.js`, `scripts/` |

No service worker yet (the member portal's `sw.js` is the pattern when offline Event Day lands, note 4).

---

## 1. Folder map

```
admin-portal/frontend-v2/
├─ index.html                 the ONE shell: fonts, css, MEDX_CONFIG block, #chrome / #view, <script type=module src=/js/app.js>
├─ manifest.webmanifest       PWA manifest (note 0a — Mac dock + Add to Home Screen), start_url /today
├─ netlify/_redirects         /api/* → https://medx-staging.onrender.com/__admin/api/*, /__member/* → the member origin, SPA fallback
├─ netlify.toml               build = copy _redirects to the root + stamp the staging config
├─ config.staging.js · config.production.js   the two MEDX_CONFIG variants (scripts/apply-config.js stamps one into index.html)
├─ dev-server.js              local static server + proxy (BACKEND=admin, MEMBER_BACKEND=member)
├─ css/tokens.css             admin tokens as CSS variables + the small utility vocabulary (.micro, .card, .btn-*, .tag, .badge, .empty…)
├─ css/app.css                header popovers, mobile MENU collapse, toast/modal/waking overlays, responsive (≤960 / ≤620)
├─ js/app.js                  boot: legacy #section hashes → session restore → chrome.mount → router.start → /api/auth/me
├─ js/config.js               window.MEDX_CONFIG → { apiBase, memberBase, memberPortalUrl, env, serverPaths }
├─ js/facts.js                CANONICAL FACTS (dates, prices, caps) + SECTION_ROUTES/routeForSection() + DEST_SECTIONS
├─ js/state.js                store + pub/sub; session (localStorage medx_token / medx_user / medx_admin_display_name)
├─ js/perms.js                the 19 PERMISSION_SECTIONS + perms.canAny() + locked-state copy
├─ js/api.js                  fetch wrapper: api.get/post/put/patch/del, ApiError (+.section), settle, waking overlay, 401 handling
├─ js/health.js               the ALL SYSTEMS OK pill: 3 probes (admin /health · member /api/public/status · /api/admin/system-health)
├─ js/ui.js                   toast (with UNDO) · modal · confirm · fmt · esc · bind · hover/keyboard delegates · lockedBlock
├─ js/router.js               History-API router (+ auth + permission guards, scroll restore, not-found)
├─ js/routes.js               THE ROUTE TABLE
├─ js/chrome.js               the header (nav, badges, PROJECTS dropdown, search + assistant, profile menu)
├─ js/views/*.js              one module per destination (default export { title, render, destroy }); `_stub.js` = placeholder factory
├─ assets/                    logo.png · logo-white.png · mark-x.png (from the export) · icons/ (shared with the member PWA)
├─ scripts/                   apply-config.js · qa-today.py
└─ _qa/                       QA screenshots (artboard vs v2) + console.txt — not shipped
```

---

## 2. Runtime config, environments, deploy

`index.html` carries the config inline between markers:

```html
<script>/* MEDX_CONFIG:start */window.MEDX_CONFIG={apiBase:'',memberBase:'/__member',memberPortalUrl:'…',env:'staging'};/* MEDX_CONFIG:end */</script>
```

* **`apiBase` is `''` in BOTH environments.** Production: the admin Express server serves this folder
  and the API from one origin. Staging: the admin backend lives **behind the launcher prefix**
  `https://medx-staging.onrender.com/__admin/…` (`deploy/staging/launcher.js` strips `/__admin`), and
  `netlify/_redirects` proxies `/api/*` there — so every literal `'/api/…'` call just works, with no
  CORS involved (the admin CORS policy is env-restricted and never reflects an arbitrary origin).
* **`memberBase`** is the prefix for the member-portal reachability probe (`GET <memberBase>/api/public/status`).
  Staging `/__member` (proxied to the launcher root); production `''` — see §12 gap 6.
* **`memberPortalUrl`** is where "VIEW MEMBER PORTAL ↗" and the sign-in footer link go.

Stamping a variant (idempotent):

```
node scripts/apply-config.js staging                                     # netlify.toml build command
node scripts/apply-config.js staging --host https://medx-review-xyz.onrender.com   # also rewrites config.staging.js + netlify/_redirects
node scripts/apply-config.js production                                  # Render build
```

Server-rendered / proxied paths that are NEVER client routes (one list in `js/config.js › serverPaths`,
mirrored in `dev-server.js` and `netlify/_redirects`):
`/api /uploads /photo-library /health /newsletter /review /evaluate /apply /e /a /__staging /__admin /__member`.
Everything else is a client route at a **root path** (`/today`, `/projects/plexus`, `/inbox` …) — the
admin portal owns its own origin, so no `/app` prefix is needed.

---

## 3. Module APIs

### 3.1 `js/config.js`
```js
import cfg from './config.js';
cfg.apiBase          // '' (both envs — see §2)
cfg.memberBase       // '/__member' | ''
cfg.memberPortalUrl  // 'https://medx-staging.onrender.com'
cfg.env · cfg.isStaging · cfg.serverPaths
```

### 3.2 `js/facts.js` — canonical facts + section routing
```js
import { FACTS, galaPriceNow, routeForSection, SECTION_ROUTES, DEST_SECTIONS } from './facts.js';
FACTS.plexus.dateRange          // 'December 4–5, 2026'   FACTS.plexus.cap → 100 (never "goal 400")
FACTS.gala.priceEarly / priceRegular / priceFlip   // 150 / 175 / '2026-09-01'
FACTS.bridges.next.label        // 'September 18–21, 2026'  (no Harvard branding anywhere)
FACTS.forum.gathering.label     // 'May 28–29, 2027'
galaPriceNow(galaSettings)      // server early_bird_deadline first, FACTS as the fallback
routeForSection('gala')         // '/gala' — maps EVERY legacy admin section id (SECTION_ROUTE_MAP ids,
                                //   SPA data-section ids, nag `open_section`, advisor `link_section`,
                                //   assistant `deepLink.target`, `#section-…` hashes) to a v2 route
DEST_SECTIONS.money             // ['finances'] — permission ids that unlock a destination
```
Rule: dates, prices, venues and caps in copy come from FACTS (or the API). Never inline them in a view.

### 3.3 `js/state.js` — store + session
```js
import { state, session } from './state.js';
state.get()                     // { token, user, badges:{inbox,chat}, health, eventDay, active, layout, viewTitle }
state.set({ active: 'Money' }); const off = state.subscribe((store, changedKeys) => …);
session.isAuthed · session.token · session.user · session.isFounder
session.allowed                 // null = full access · [] = Today only · ['plexus','finances',…]
session.set(token, user) · session.update(patch) · session.clear()
session.displayName() · session.setDisplayName(v) · session.firstName() · session.initials() · session.roleLabel()
```
`medx_token` / `medx_user` are the LEGACY key names on purpose — the live admin SPA reads the same
keys, so a session survives switching between v1 and v2. `medx_admin_display_name` is the per-admin
display name from the design (drives greeting, avatar initials, and later the chat sender).

### 3.4 `js/perms.js` — the permission vocabulary
```js
import { perms, PERMISSION_SECTIONS } from './perms.js';
perms.canAny(['finances','plexus'])   // founder / allowed_sections NULL → true
perms.can('tech') · perms.label('member-ops') · perms.lockedCopy('finances')
```
Enforcement is **server-side** (`auth()` → `sectionDenied()` → `403 { error, section }`). Everything
here is UX: nav items dim, guarded routes render `views/locked.js`, and a block whose own call 403s
renders `ui.lockedBlock()` (IMPLEMENTATION_CONTRACT §3.4).

### 3.5 `js/api.js` — the fetch wrapper
```js
import { api } from './api.js';
const me = await api.get('/api/auth/me');
await api.post('/api/auth/login', { email, password }, { noAuth: true });
await api.put('/api/admin/tasks/' + id, { done: true });
const r = await api.settle({ gala: api.get('/api/admin/gala/registrations'), fin: api.get('/api/finance/dashboard') });
r.gala           // value or null      r.$errors.gala   // the ApiError when it failed
try { … } catch (e) { if (e instanceof api.ApiError) { e.status; e.section /* 403 lock */; e.isLocked; e.message; e.data } }
```
Behaviour: JSON in/out · `Authorization: Bearer` from the session unless `{ noAuth: true }` ·
**401** → `session.clear()` + `medx:unauthorized` → app.js routes to `/signin?next=…` (`{ keepSession: true }`
opts out) · **403 `{section}`** → ApiError with `.section`, session untouched · **429** → the server's
message (the auth limiter is 15 hits / 15 min per IP — reuse tokens in QA) · **503 `{waking:true}`** →
full-screen "One moment." overlay, retry 2/3/5/8/10 s until the launcher is up (≤4 min).
Always write literal `'/api/…'` paths (`scripts/check-api-contract.js` greps for them).

### 3.6 `js/ui.js` — helpers
```js
import { ui, esc, fmt } from './ui.js';
ui.toast('TASK ADDED — VISIBLE TO THE WHOLE TEAM');                 // never empty
ui.toast('SNOOZED FOR 1 DAY', { undo: () => … });                    // gold UNDO, the artboard's toast
ui.toast(e.message, { kind: 'error' });
const ok = await ui.confirm({ title: 'Remove access?', ok: 'REMOVE', cancel: 'KEEP' });
const unbind = ui.bind(root, { save: (el, ev) => …, snooze: () => … });   // <span data-act="save">
ui.lockedBlock(perms.label('finances'));                             // inline locked mini-state for one card
esc(userText)                                                        // HTML-escape everything dynamic
fmt.eur(3150) → '€3,150'   fmt.num(1200) → '1,200'   fmt.dayLabel('2026-09-01') → 'SEP 1'   fmt.dayShort(…) → 'Sep 1'
fmt.rangeLabel('2026-09-18','2026-09-21') → 'SEP 18–21'   fmt.longRange('2026-12-04','2026-12-05') → 'December 4–5, 2026'
fmt.todayLabel() → 'SUNDAY, 30 AUGUST 2026'   fmt.daysUntil('2026-12-04') → 96   fmt.daysSince(…)
fmt.detail('December 4-5, 2026 - Zagreb - EUR 150') → 'December 4–5, 2026 · Zagreb · €150'   fmt.sparkRange(30) → 'AUG 1 — AUG 30'
```
Delegates installed once by app.js (`ui.installDelegates()`): `data-hover="color:#201b16"` reproduces
the artboards' `style-hover`; Enter/Space on any `[data-act]`/`[data-nav]` span clicks it; such spans
get `tabindex="0" role="button"` automatically (keyboard reachable without touching copied markup).

### 3.7 `js/router.js` + `js/routes.js`
```js
import router from './router.js';
router.navigate('/projects/plexus');   router.replace('/today');   router.back();   router.path;   router.current
```
Route rows: `{ path, view: () => import('./views/x.js'), auth, guestOnly, layout, active, title, sections, redirect }`.
`path` supports `:param` / `:param?`. Guards: `auth` (default true) → guests go to `/signin?next=…`;
`sections` (ANY of) missing → `views/locked.js`. `layout`: `portal` (header) · `signin` (no header).
`active` = top-nav highlight key. Link handling is global: `<a href="/…">` and `[data-nav]` route
client-side; server paths and external links fall through to a full load. Scroll: back/forward
restores, forward navigation scrolls to top, `#hash` targets scroll into view.

### 3.8 `js/chrome.js`
```js
import { chrome } from './chrome.js';
chrome.refresh();       // INBOX badge (pending outbox batches + unread member messages) + TEAM CHAT unread + event-day flag
chrome.closePopover();
state.set({ active: 'Money' });   // nav highlight (the router sets it from the route table)
```
Badge sources: `GET /api/admin/outbox?status=pending_approval` (batches) + `GET /api/dashboard/portal-stats`
(`pending.unreadMessages`) → INBOX; `GET /api/teamchat/overview` (channels + DMs `unread`) → TEAM CHAT.
EVENT DAY appears in the nav when today falls inside the active conference dates, on the Gala date, or
on a `bridges_events.event_date` (`GET /api/conferences/active`, `GET /api/bridges/events`) — and it is
always reachable at `/event-day` and from the PROJECTS dropdown (note 0b). `?eventday=1` forces it for a
rehearsal. The search field is the agent's front door (note 14): screen/action palette + `GET /api/admin/search`
people, Enter on an imperative phrase asks `POST /api/admin/assistant`, and each proposed action is
confirmed through `POST /api/admin/assistant/execute` (confirm-before-execute, always).

### 3.9 `js/health.js`
```js
import { health } from './health.js';
await health.refresh();          // cached 5 min; { state:'ok'|'warn'|'fail'|'locked'|'unknown', ok, warn, fail, label, color, groups, probes }
```
Three real probes: `GET /health` (admin backend), `GET <memberBase>/api/public/status` (member portal —
falls back to a `no-cors` reachability ping), `GET /api/admin/system-health` (the 24-check report;
403 for admins without `tech`, which reads as `locked` and keeps the two reachability probes). The
result drives the Today status pill, the Today ADMIN footer line and the Settings health card; the pill
turns crimson when any probe or check fails.

---

## 4. Views — the contract and how to add a destination

A view module:

```js
// Source: Admin Money.dc.html
import { api } from '../api.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS } from '../facts.js';
import { perms } from '../perms.js';
import router from '../router.js';

export const SOURCE = 'Admin Money.dc.html';
export const COPY = {                        // EVERY string likely to change, in one place; facts via FACTS
  title: 'Money', chase: n => `${n} to chase`, owed: v => `${fmt.eur(v)} owed`
};

let D = null, st = null, unbind = null, rootEl = null;
async function load() { return api.settle({ fin: api.get('/api/finance/dashboard'), gala: api.get('/api/admin/gala/registrations') }); }

function blockLedger() { return `
  <!-- dc: Admin Money.dc.html › "SPONSORS & DONORS" -->
  <div style="…artboard inline styles verbatim…">…${esc(D.fin.totalIncome)}…</div>
  <!-- /dc -->`; }

const handlers = { chase: async (el) => { … } };

export default {
  title: 'Money',
  async render(root, ctx) {            // ctx = { params, query, path, route, navigate, user, popped, lockedSection }
    rootEl = root; st = { … };
    D = await load();
    if (rootEl !== root) return;       // navigated away while loading
    root.innerHTML = `<div data-screen-label="Admin Money" style="…artboard root style…">${blockLedger()}</div>`;
    unbind = ui.bind(root, handlers);
  },
  destroy() { if (unbind) unbind(); unbind = null; rootEl = null; D = null; st = null; }
};
```

Steps to add/replace a destination:
1. Open the artboard (`design/handoff/admin-portal-2026-08-28/<Screen>.dc.html`). Copy its markup
   **verbatim** (inline styles included) into block functions, one per card/section, in artboard
   order, each wrapped in `<!-- dc: <file> › "<section label>" -->` … `<!-- /dc -->`. Skip the header —
   `js/chrome.js` already renders it.
2. Translate the prototype bindings: `{{ prop }}` → `${…}` (escape dynamic text with `esc()`),
   `onClick="{{ fn }}"` → `data-act="fn"` + a handler, `style-hover="…"` → `data-hover="…"`,
   `<sc-if value="{{ x }}">…</sc-if>` → `${x ? … : ''}`, `<sc-for list="{{ items }}" as="t">…</sc-for>` →
   `${items.map(t => …).join('')}`, artboard links `href="Admin Money.dc.html"` → `/money` (table in §6),
   `assets/x.png` → `/assets/x.png`.
3. Lift the copy into `COPY`; dates/prices/venues/caps into `FACTS` if not there already.
4. Replace the stub file `js/views/<name>.js` (keep the file name — `js/routes.js` already points at it).
   Add rows to `js/routes.js` only for new paths, with the right `sections` for the permission guard.
5. Load real data (see §8 for verified endpoints) with `api.settle` so one failing or 403-locked call
   never blanks the screen; render `ui.lockedBlock(perms.label(sec))` inside the card that lost its data.
   Never hardcode counts, € figures or countdowns (note 6: all numbers are live database reads).
6. Every status, badge and count is a **door** (note 0b) — wrap it in an `<a href>` or `data-nav` to the
   place where you act on it. Row-lists in white cards, never grids of same-size tool boxes (note 0c).
7. Every clickable element does something real or shows a non-empty toast. Micro-label buttons keep
   `white-space:nowrap`. `€` never `EUR`. Diacritics intact (Juginović, Vuković, Pranjić, Rakić, Nikolić).
   No Croatian text easter eggs (removed by decision); visual ones are fine.
8. Add the responsive hooks from §9 where the artboard uses those patterns.
9. Verify: `python3 scripts/qa-today.py --base http://localhost:8910` (extend `PAGES` for your screen),
   zero console errors, keyboard pass (Tab/Enter on every control), and a 960/620 px look.

### Naming rules
* `data-act="name"` — clickable (handled by `ui.bind(root, handlers)`); `data-nav="/…"` — plain navigation;
  `data-role="…"` — element the JS reads/updates (inputs, error lines); `data-block="…"` — re-renderable
  block wrapper; `data-row` / `data-task` — list-row identity for surgical updates.
* `data-screen-label="…"` on the view root = the artboard's own label.
* Block markers: `<!-- dc: <artboard file> › "<label>" -->` … `<!-- /dc -->`. Additions with no artboard
  counterpart are marked `data-v2="…"` or `<!-- v2: … -->`.
* CSS class hooks are prefixed `mx-` and never carry look — only responsive overrides and behaviour.
* Module-level `COPY` (strings) and `SOURCE` (artboard file) exports on every view.
* Handlers never read the DOM by global ids; use `root.querySelector('[data-role=…]')`.

---

## 5. Route table

| Route | View | Active | Permission sections | Notes |
|---|---|---|---|---|
| `/`, `/today` | today | Today | — (unmapped on the server) | the built screen |
| `/signin` | signin | — | public, guestOnly | + `?step=password` for invited admins |
| `/projects` | → `/projects/plexus` | | | redirect |
| `/projects/plexus/:tab?` | plexus (stub) | Projects | `plexus` | |
| `/projects/accelerator/:tab?` | accelerator (stub) | Projects | `accelerator` | |
| `/projects/forum/:tab?` | forum (stub) | Projects | `forum` | |
| `/projects/bridges/:tab?` | bridges (stub) | Projects | `bridges` | |
| `/inbox/:tab?` | inbox (stub) | Inbox | `member-ops`, `pr-media` | `outbox·email·messages·announcements·newsletter·chat` |
| `/people/:tab?` | people (stub) | People | `member-ops`, `guest-passes`, `team`, `contacts` | |
| `/money/:tab?` | money (stub) | Money | `finances` | |
| `/calendar/:tab?` | calendar (stub) | Calendar | — | `tasks`; tasks are unmapped → every signed-in admin |
| `/event-day` | eventday (stub) | Event Day | `gameday`, `plexus` | nav item auto-appears on event dates; always reachable |
| `/settings/:tab?` | settings (**health built**) | Settings | — (blocks lock individually) | `health·team·audit·library·org` |
| `/studio/:tab?` | studio (stub) | Studio | `pr-media`, `plexus`, `signup-forms` | |
| `/gala/:tab?` | gala (stub) | Projects | `plexus` | |
| `/registrations` | registrations (stub) | People | `plexus`, `forum`, `bridges`, `signup-forms` | |
| `/links` | links (stub) | Projects | `plexus`, `bridges`, `signup-forms` | |
| `/member-pages/:tab?` | member-pages (stub) | Projects | `pr-media`, `plexus`, `accelerator` | |
| `/accelerator-review/:tab?` | accelerator-review (stub) | Projects | `accelerator` | |
| anything else | notfound | — | — | |

Legacy `#<section-id>` deep links from the v1 SPA are mapped on boot (`js/app.js` → `routeForSection`),
including `#scanner` → `/event-day` and `?track` → `/event-day`; `?logout=true` clears the session.

---

## 6. Artboard → view module → template blocks

| Artboard | View module | Template blocks (dc markers, in order) | Artboard links → routes |
|---|---|---|---|
| Admin Home.dc.html (header, shared by all 17) | `js/chrome.js` | "Header" | TODAY `/today` · PROJECTS `/projects/plexus` (+ dropdown) · INBOX `/inbox` · PEOPLE `/people` · MONEY `/money` · CALENDAR `/calendar` · STUDIO `/studio` · SETTINGS `/settings` · TEAM CHAT `/inbox/chat` · avatar → profile menu |
| Admin Home.dc.html (Today) | `js/views/today.js` | "Greeting row" · "Customise panel" · "Hero numbers" · "YOUR PROJECTS" · "NEEDS YOUR ATTENTION" + "DO IT NOW" · "COMING UP" + "TEAM TASKS" · "THE WEEKLY READ" · "ADMIN: footer row" | project cards → the four hubs + `/settings`; REVIEW & SEND → `/inbox/outbox`; CHASE PAYMENT → nag act; OPEN TASKS/ALL TASKS → `/calendar/tasks`; FULL CALENDAR → `/calendar`; status pill + SYSTEM HEALTH → `/settings/health`; AUDIT LOG → `/settings/audit`; VIEW MEMBER PORTAL → `cfg.memberPortalUrl` |
| Admin Settings.dc.html | `js/views/settings.js` (health only) | "SYSTEM HEALTH" (built) · TEAM ACCESS · ORGANISATION & PAYMENTS · WHAT THE PUBLIC & MEMBERS SEE · MAKE & STORE → STUDIO · AUDIT LOG · TEAM LIBRARY (stubs) | OPEN THE STUDIO → `/studio`; member/website text → `/member-pages`; sign-up form pages → `/links` |
| Admin Plexus Hub · Accelerator Hub · Forum Hub · Bridges Hub | `plexus.js` · `accelerator.js` · `forum.js` · `bridges.js` (stubs, `:tab`) | — | `/projects/<key>`; the hubs' shared sub-nav row (PROJECTS · PLEXUS WEEK 2026 · ACCELERATOR · BIOMEDICAL FORUM · BUILDING BRIDGES) is already in `_stub.js` |
| Admin Accelerator Review.dc.html | `accelerator-review.js` (stub) | — | `/accelerator-review` |
| Admin Inbox.dc.html | `inbox.js` (stub, 6 tabs) | — | `/inbox/(outbox·email·messages·announcements·newsletter·chat)` |
| Admin People · Money · Calendar · Event Day · Studio · Gala · Registrations · Links · Member Pages | stubs of the same name | — | `/people` · `/money` · `/calendar` · `/event-day` · `/studio` · `/gala` · `/registrations` · `/links` · `/member-pages` |
| (no artboard) Sign in · 404 · Locked · PROJECTS dropdown · search results | `signin.js` · `notfound.js` · `locked.js` · `chrome.js` | built from the header/Settings vocabulary | — |

---

## 7. Applying a design revision

A new export of the same `.dc.html` folder arrives; patch only what changed:

```
node ../../scripts/design-diff.js design/handoff/admin-portal-2026-08-28 ~/Downloads/<new-export> --out design/handoff/DIFF-admin-$(date +%F).md
```

1. Find the block: the section label in the report = the `<!-- dc: <file> › "<label>" -->` marker in the
   view (table in §6; `grep -rn 'dc: Admin Home' js/`).
2. Copy the artboard's new markup for that block into the block function — inline styles verbatim; keep
   the `data-act` / `data-role` / `data-hover` / `mx-*` attributes the block already carries.
3. Text/labels/prices/dates: change `COPY` (view) or `FACTS` (js/facts.js) — never inside the template.
4. New section → new block function + marker in artboard order; removed section → delete the block and
   its handlers.
5. Header/responsive changes: `js/chrome.js` blocks and the `mx-*` rules in `css/app.css` (translate any
   new `admin-responsive.css` selector to a class hook — the export's `[style*=…]` selectors only match
   browser-serialised styles, which raw markup never is).
6. Re-shoot: `python3 scripts/qa-today.py`; compare `_qa/design-today.png` vs `_qa/v2-today.png`.
7. Commit the new export into `design/handoff/admin-portal-<date>/` so the next diff has a baseline.

---

## 8. Endpoints wired (every one verified against `admin-portal/backend/server.js` at HEAD)

| Screen | Method + path | Used for |
|---|---|---|
| Sign in | `POST /api/auth/login` (authLimiter, 15/15 min) | `{ token, mustChangePassword, user{…, allowed_sections} }`; 401 bad credentials; 403 non-admin |
| Sign in | `POST /api/auth/change-password` | invited admin's first password (only while `must_change_password` is armed) |
| boot · Today | `GET /api/auth/me` | identity + `allowed_sections` (parsed array \| null) + `must_change_password` |
| chrome | `GET /api/admin/outbox?status=pending_approval` | INBOX badge (batch count) + Today's outbox row |
| chrome · Today | `GET /api/dashboard/portal-stats` | INBOX badge (`pending.unreadMessages`), revenue, gala awaiting, task counts |
| chrome | `GET /api/teamchat/overview` | TEAM CHAT pill unread (channels + DMs) |
| chrome · Today | `GET /api/conferences/active` · `GET /api/bridges/events` | EVENT DAY auto-appearance, Plexus dates/cap, Bridges next edition + `registration_count` |
| chrome | `GET /api/admin/search?q=` | header search — people/registrations/gala rows |
| chrome | `POST /api/admin/assistant` · `POST /api/admin/assistant/execute` | the agent front door (note 14); confirm-before-execute |
| Today | `GET /api/dashboard/summary` | conference registrations, accelerator applications, forum members, bridges cities |
| Today | `GET /api/dashboard/trends` | the 30-day registration sparkline (plexus + accelerator + events series, summed per day) |
| Today | `GET /api/admin/gala/registrations` · `GET /api/admin/gala/settings` | GALA SEATS PAID, payments to chase, collected €, early-bird deadline + price flip |
| Today | `GET /api/finance/dashboard` | collected-this-year cross-check (`totalIncome`, `byProject`) |
| Today | `GET /api/admin/nag/items` | Action Center rows (kind, title, `action_payload`, status) |
| Today | `POST /api/admin/nag/items/:id/act` | the one-click DO — stages an approval-gated reminder in the Outbox, never sends |
| Today | `GET /api/admin/tasks` · `POST /api/admin/tasks` · `PUT /api/admin/tasks/:id {done}` | the shared team To Do list (`project_tasks` — the same rows Calendar shows, note 17) |
| Today | `GET /api/team` | task assignee dropdown (team_members) |
| Today | `GET /api/admin/advisors/latest` | THE WEEKLY READ — real observations per seat (CMO/CFO/COO/CLO) + `week_key` + `is_mock` |
| Today | `GET /api/dashboard-preferences/today-v2` · `PUT /api/dashboard-preferences/today-v2` | ✎ CUSTOMISE, per admin, server-side (note 16) |
| Today | `GET /api/admin/year-calendar` | COMING UP rows |
| Today | `GET /api/public/status` | project status labels (the same rows members see) |
| Today | `GET /api/admin/forum/candidates?status=all` · `GET /api/accelerator/institutions` | Forum candidate count · host-institution count on the project cards |
| Today · Settings | `GET /health` · `GET /api/admin/system-health` · `GET <memberBase>/api/public/status` | the status pill + the Settings health card |

Nothing on Today is mocked. Where a call 403s (a section this admin lacks), the affected number shows
`—` with "locked for you · ask Alen" and the rest of the screen still renders.

---

## 9. Responsive

Desktop-first, max content width 1180 px. `css/app.css` translates the export's `admin-responsive.css`
into class hooks:

| Hook | Where | Effect ≤960 / ≤620 |
|---|---|---|
| `mx-gutter` | `padding:0 28px` wrappers | gutter 16 px |
| `mx-topbar` · `mx-nav` · `mx-search` | header | wraps; ≤760 the nav collapses behind MENU (`body.menu-open`) |
| `mx-subnav` | hub sub-nav row | wraps |
| `mx-kpi` · `mx-grid-5` · `mx-grid-4` · `mx-grid-3` | stat rows / card grids | 2 → 1 column; KPI cells swap the right hairline for a bottom one |
| `mx-two` · `mx-side` | asymmetric two-pane layouts | single column |
| `mx-row` + `mx-row-text` | attention / weekly-read rows | the text takes the full width, the CTA + SNOOZE drop below it |
| `mx-display-34` · `mx-display-32` · `mx-display-30` | display type | 24 / 24 / 22 px |
| `mx-sticky` | sticky side panels | static |

Note 0a (installable PWA, phone + iPad) is satisfied by the manifest plus these rules; the mocks are
desktop-width by design.

---

## 10. Run it locally

```bash
S=/tmp/adminv2                                   # or your scratch dir
mkdir -p $S && cp deploy/staging/seed.db $S/adminv2.db && rm -f $S/adminv2.db-wal $S/adminv2.db-shm

# 1) admin backend on :3971 (COPY of the seed — never edit the original)
cd admin-portal/backend
DATABASE_PATH=$S/adminv2.db PORT=3971 NODE_ENV=staging JWT_SECRET=x nohup node server.js > /tmp/adminv2-backend.log 2>&1 &

# 2) member backend on :3941 on the SAME DB (so the member health probe is real, like the staging launcher)
cd ../../user-portal/backend
DATABASE_PATH=$S/adminv2.db PORT=3941 NODE_ENV=staging JWT_SECRET=x nohup node server.js > /tmp/memberv2-backend.log 2>&1 &

# 3) front end on :8910
cd ../../admin-portal/frontend-v2
BACKEND=http://localhost:3971 MEMBER_BACKEND=http://localhost:3941 PORT=8910 node dev-server.js
open http://localhost:8910/today
```
Sign in with `pjero.bacic@medx.hr` / `Plexus2026!`. On the current seed that account has
`allowed_sections='[]'` (Today only), so most nav items read as locked — to see the full nav once:
```bash
python3 -c "import sqlite3;c=sqlite3.connect('$S/adminv2.db');c.execute(\"UPDATE users SET allowed_sections=NULL WHERE email='pjero.bacic@medx.hr'\");c.commit()"
```
Stop later with `lsof -ti tcp:3971 -sTCP:LISTEN | xargs kill` (macOS has no `timeout`; scope to LISTEN —
a bare `lsof -ti :3971` also matches the dev server proxying to it). The auth limiter allows 15 logins
per 15 minutes per IP — reuse the token.

QA:
```bash
MEDX_QA_EMAIL=pjero.bacic@medx.hr MEDX_QA_PASSWORD='Plexus2026!' python3 scripts/qa-today.py            # artboard vs v2 + console check
MEDX_QA_TOKEN=<jwt> python3 scripts/qa-today.py --flows                                                 # + CUSTOMISE persistence, task add/tick/undo, snooze/undo (writes to the scratch DB)
node ../../scripts/check-api-contract.js                                                                # repo tripwire (v1 surfaces; see §12 gap 8)
```
Screenshots land in `_qa/`; `_qa/console.txt` holds any console errors and the script exits 1 when it
is non-empty.

---

## 11. Interactions kept from the design

* **Every status is a door** (0b): the hero numbers, project cards, attention rows, tasks, coming-up
  rows, the status pill and the footer health line all navigate to where you act.
* **Row-lists in white cards** (0c), open stat rows between hairlines, no tool-card grids.
* **✎ CUSTOMISE** (16): per-admin choice of hero numbers and DO IT NOW shortcuts, saved to
  `dashboard_preferences` (section `today-v2`) — server-side, not localStorage.
* **Snooze 1 day** on an attention row hides it until the next local midnight, with a gold UNDO in the
  toast; the row returns until the underlying thing is resolved. Snoozes are per-admin and per-browser
  (localStorage) — see §12 gap 4.
* **One shared team task list** (17): add / tick / undo write to `project_tasks`; ticking anywhere
  completes for everyone, and Calendar reads the same rows.
* **The approval outbox is the spine** (2): the Action Center's one-click DO stages a reminder in the
  Outbox and says so; nothing emails a member without an explicit approval there.
* **The Weekly Read headline IS the read** (18): the collapsed bar prints the actual first conclusion of
  each advisor seat, computed from live numbers; expanding shows one line per advisor, with ALL N LINES
  for the rest and per-line OPEN → deep links. With no advisor rows it renders a clean key-gate state.
* **Event Day** appears in the nav automatically on event dates and stays reachable at all times (4).
* **Croatian text easter eggs removed** by decision; the visual language is unchanged.

---

## 12. Gaps found (backend / data) — for the backend owner

1. **No admin "unread member messages" endpoint of its own.** The INBOX badge uses
   `GET /api/dashboard/portal-stats › pending.unreadMessages` (a `direct_messages` count) plus the
   pending outbox batch count. A dedicated `GET /api/admin/messages/unread-count` would avoid pulling
   the whole dashboard payload for a badge.
2. **`GET /api/admin/outbox` returns batches, not an email total in one field.** Today sums `count`
   across batches to say "78 emails in 9 batches". Fine, but a `totals` field would be cheaper.
3. **The Weekly Read has no stored headline.** `GET /api/admin/advisors/latest` returns per-seat
   observations; the collapsed headline is composed client-side from the first observation of each seat
   (note 18 wants the computed conclusion — this is it, but a server-side `headline` would keep Today
   and any future digest identical).
4. **No per-admin snooze store.** `nag_items` has `status` (`open/actioned/done/dismissed`) and
   `claimed_by`, but "hide this row for me until tomorrow" has no column, so snoozes live in
   localStorage (`medx_admin_snooze:<userId>`). Production wants `nag_snoozes(user_id, item_id, until)`
   (README: "snooze = per-admin, 24 h").
5. **`GET /api/admin/tasks` has no assignee email/name for user-linked assignees.** It joins
   `team_members` only, so tasks assigned to a `users` row show no name. Today falls back to "TEAM".
6. **Member-portal health probe in production.** Staging proxies `/__member/*` through Netlify. In
   production the admin and member portals are different Render services, and the admin origin is not on
   the member's `/api/public` CORS allowlist, so the probe degrades to an opaque `no-cors` reachability
   ping (up/down only, no payload). Either add the admin origin to `PUBLIC_API_ORIGINS` on the member
   backend, or expose the member check inside `GET /api/admin/system-health` (server-to-server).
7. **`GET /api/admin/system-health` counts nothing about the member portal.** It checks the admin
   service's own env/DB/event readiness; the pill therefore merges the report counts with the two
   reachability probes.
8. **`scripts/check-api-contract.js` does not scan the v2 folders.** It reads
   `admin-portal/frontend/index.html` and `user-portal/frontend/index.html` only. Add
   `admin-portal/frontend-v2/js/**` (and the member v2 folder) so the tripwire covers the new surfaces;
   a manual pass over every literal `/api/…` in this folder matched an existing admin route (2026-08-30).
9. **Seed data vs canonical facts** (admin-editable, so left as served): `conferences.max_capacity` is
   200 on the staging seed while the canonical cap is 100; `project_status.accelerator` still says
   "Applications open in November" (canonical: Dec 8, 2026) and `project_status.bridges` still says
   "Building Bridges at Harvard Medical School" (decision: no Harvard branding); one seeded
   `bridges_events` row has `venue_name = "Harvard Faculty Club"`. Today prints what the API serves —
   fix the rows in the admin portal, not in the client.
10. **`nag_items` for gala payments reference test rows** on the seed (`Member 0xx Test`), which is why
    the Action Center is long there. Real data behaves the same way.

---

## 13. Decisions & deviations (so a revision can revisit them)

* The header's **PROJECTS dropdown** has no artboard (the mocks navigate straight to the Plexus hub).
  It is a v2 addition marked `data-v2`, built from the panel vocabulary, and it also carries Review
  Room, Gala, What members see, Links and the Event Day room — the destinations with no top-nav slot.
* **EVENT DAY** is a nav item only on event dates (note 0a/4); the route and the dropdown entry are
  always live. `?eventday=1` forces the nav item for a rehearsal.
* **Sign in** has no artboard; it reuses the header lockup, the Settings input/button vocabulary and the
  member `Auth.dc.html` structure. The invited-admin password step lives on the same screen.
* The Today greeting follows the clock in English only — the Croatian toggle was removed by the August
  decision ("visual easter eggs allowed, text ones not"). The DAYS TO GO tooltip easter egg belongs to
  the Plexus hub artboard, not Today.
* **Hero numbers** are the artboard's four, with live values: DAYS TO PLEXUS (conference `start_date`),
  CONFERENCE REGISTERED (+ the live cap), GALA SEATS PAID (+ payments to chase and the real early-bird
  date), COLLECTED THIS YEAR (paid gala rows + conference revenue). The artboard's "€3,150 · 21 payments"
  is the mock; the real numbers come from the DB.
* **Registration trend** sums the plexus + accelerator + events series per day over the last 30 days and
  scales the y-axis to the data (the artboard's fixed 30/15/0 grid is a mock).
* The attention list shows the top 6 rows with SHOW ALL N; the Weekly Read shows one line per advisor
  with ALL N LINES — the seeded advisor pack carries 18 observations, which would otherwise bury Today.
* Snoozed rows return at local midnight (README: 24 h, per admin).
* `medx_admin_display_name` stays in localStorage as the design specifies; when a server field for it
  lands, `session.setDisplayName()` is the single place to change.
* The status pill reads `ALL SYSTEMS OK` only when nothing warns and nothing fails; the staging seed has
  no `BREVO_API_KEY`, so it legitimately reads `1 FAILING · 11 TO CHECK` there.
