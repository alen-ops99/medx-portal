# Med&X Member Portal — frontend-v2 ARCHITECTURE

The redesigned member portal front end: vanilla ES modules, **no build step**, one HTML shell,
one shared chrome, a History-API router and one module per screen. Design source: the Claude
Design export `medx-member-portal-final` (2026-08-28; baseline copy in
`design/handoff/member-portal-2026-08-28/`). The backend is the existing
`user-portal/backend/server.js` — nothing in this folder changes it.

Screen engineers: read **§3 (module APIs)**, **§4 (how to add a screen)**, **§6 (artboard → view
table)** and **§7 (applying a design revision)**. Everything else is reference.

---

## 0. Status

| Area | State | Module |
|---|---|---|
| Shell, tokens, chrome (top bar · stats strip · email banner · drawer · SEARCH · ALERTS · mobile top bar + tab bar) | **built** | `index.html`, `css/*`, `js/chrome.js` |
| Router, API client (401 / 429 / 503-waking), session, UI helpers, facts | **built** | `js/router.js`, `js/api.js`, `js/state.js`, `js/ui.js`, `js/facts.js` |
| Auth — welcome · sign in · create account (01 details → 02 confirm email → in) · reset password (request + sent) · Forum invitation code | **built** | `js/views/auth.js` |
| Home — hero + GETTING STARTED · countdown band · project cards · Latest · Key dates (+ .ics) · Newsletter · From the Forum · Grow your network | **built** | `js/views/home.js` |
| 404 · Maintenance · Projects (mobile tab) | **built** | `js/views/notfound.js`, `maintenance.js`, `projects.js` |
| Plexus (overview/program/zagreb/mine) · Gala · Accelerator (+apply) · Forum · Bridges · Network · Messages · Profile · My Med&X (+certificates) · Mentorship · Opportunity board | **stub** (title + "in progress" note, routes live) | `js/views/<name>.js` via `_stub.js` |
| PWA (manifest, icons, service worker), Netlify files, dev server, QA scripts | **built** | `manifest.webmanifest`, `sw.js`, `assets/icons/`, `_redirects`, `netlify.toml`, `dev-server.js`, `scripts/` |

---

## 1. Folder map

```
frontend-v2/
├─ index.html                 the ONE shell: fonts, css, MEDX_CONFIG block, #chrome / #view, <script type=module src=/js/app.js>
├─ manifest.webmanifest       PWA manifest (name "Med&X", theme #191512, background #f7f1e6)
├─ sw.js                      service worker — `const CACHE_NAME = 'medx-portal-v2-1'` (stamp-sw.sh appends the deploy SHA)
├─ _redirects · netlify.toml  Netlify: proxy every server-rendered path + /api/* to the backend host, then /* → index.html
├─ config.staging.js · config.production.js   the two MEDX_CONFIG variants (scripts/apply-config.js stamps one into index.html)
├─ dev-server.js              local static server + proxy (BACKEND=http://localhost:3941)
├─ css/tokens.css             brand tokens as CSS variables + the small utility vocabulary (.micro, .btn-*, .card, .chip, .toggle…)
├─ css/app.css                chrome behaviour (drawer motion, popovers), overlays (toast/modal/waking), responsive + ≤430 mobile pattern
├─ js/app.js                  boot: entry-URL contracts → session restore → chrome.mount → router.start → SW
├─ js/config.js               window.MEDX_CONFIG → { apiBase, env, isStaging, serverPaths }
├─ js/facts.js                CANONICAL FACTS (dates, prices, venues) + PROJECT_ROUTES/routeFor()
├─ js/state.js                store + pub/sub; session (localStorage medx_user_token / medx_user_data)
├─ js/api.js                  fetch wrapper: api.get/post/put/patch/del, ApiError, waking overlay, 401 handling
├─ js/ui.js                   toast · modal · confirm · countdown · .ics · fmt · esc · bind · delegates
├─ js/router.js               History-API router (+ guards, scroll restore, not-found)
├─ js/routes.js               THE ROUTE TABLE
├─ js/chrome.js               Portal Chrome (desktop + mobile), SEARCH overlay, ALERTS panel, stats refresh
├─ js/member.js               profileCompletion() — one source of truth for the Home nudge + Profile checklist
├─ js/views/*.js              one module per screen (default export { title, render, destroy }); `_stub.js` = placeholder factory
├─ assets/                    logo.png · logo-white.png · mark-x.png · photo-*.jpg (from the export) · icons/ (generated)
├─ scripts/                   apply-config.js · make-icons.py · qa-shots.py · qa-flows.py
└─ _qa/                       QA screenshots (artboard vs v2) — not shipped
```

---

## 2. Runtime config, environments, deploy

`index.html` carries the config inline between markers:

```html
<script>/* MEDX_CONFIG:start */window.MEDX_CONFIG={apiBase:'',env:'production'};/* MEDX_CONFIG:end */</script>
```

* **production** (`config.production.js`): `apiBase:''` — same origin; the Express server serves this folder and the API.
* **staging** (`config.staging.js`): `apiBase:'https://medx-staging.onrender.com'`, `env:'staging'` — Netlify hosts the files, the browser calls the Render staging launcher directly (its `CORS_ORIGIN` must list the Netlify origin). Server-rendered pages (`/plexus`, `/pay/*` …) and `/api/*` are ALSO proxied by `_redirects`, so links inside the Netlify site keep working.

The deploy picks a variant by stamping it into the block (idempotent):

```
node scripts/apply-config.js staging                       # netlify.toml build command
node scripts/apply-config.js staging --host https://medx-review-xyz.onrender.com   # also rewrites config.staging.js + _redirects
node scripts/apply-config.js production                    # Render build for the real portal
```

`_redirects` uses the placeholder host `https://medx-staging.onrender.com` — `sed` it (or use `--host`). Order matters: server paths first (status 200 = proxy), `/* /index.html 200` last.
`scripts/stamp-sw.sh` (repo root) rewrites `const CACHE_NAME = 'medx-portal-v2-1'` → `…-v2-1-<sha>`; keep that line shape.

Server-rendered paths (never client routes; one list in `js/config.js › serverPaths`, mirrored in `sw.js`, `dev-server.js`, `_redirects`):
`/api /plexus /forum /apply /evaluate /pay /pass /invite /invite-success /invite-cancelled /reset-password /qr /calendar /verify-certificate /verify /r /unsubscribe /email-prefs /donate /uploads /f /speaker /building-bridges /donor-night /terms /privacy /health /__staging /__admin`.
All client routes live under **`/app/…`** (plus `/`).

---

## 3. Module APIs

### 3.1 `js/config.js`
```js
import cfg from './config.js';
cfg.apiBase      // '' | 'https://…onrender.com'
cfg.env          // 'production' | 'staging'
cfg.isStaging    // boolean
cfg.serverPaths  // string[] of server-rendered prefixes
```

### 3.2 `js/facts.js` — canonical facts
```js
import { FACTS, galaPriceNow, routeFor, PROJECT_ROUTES } from './facts.js';
FACTS.plexus.dateRange            // 'December 4–5, 2026'   FACTS.plexus.startAt → countdown target
FACTS.gala.priceEarly / priceRegular / priceFlip   // 150 / 175 / '2026-09-01'
FACTS.accelerator.opensLabel      // 'December 8, 2026'     FACTS.forum.gathering.label → 'May 28–29, 2027'
FACTS.bridges.next.label          // 'September 18–21, 2026'
FACTS.projectOrder                // ['plexus','gala','accelerator','forum','bridges'] (hub order = /api/public/status order)
galaPriceNow()                    // 150 before Sep 1, 175 after (fallback only — prefer /api/public/site price.current)
routeFor('gala')                  // '/app/gala'; accepts project keys, legacy section ids, 'app:'/'site:' tokens, absolute URLs
```
Rule: dates, prices, venues and caps in copy come from FACTS (or the API). Never inline them in a view.

### 3.3 `js/state.js` — store + session
```js
import { state, session } from './state.js';
state.get()                        // { token, user, stats, unread, notifications, active, layout, viewTitle }
state.set({ active: 'Plexus' })    // merges + notifies subscribers
const off = state.subscribe((store, changedKeys) => …);
session.isAuthed · session.token · session.user
session.set(token, user)           // after login/register — persists to localStorage (medx_user_token / medx_user_data)
session.update({ bio: '…' })       // merge into the cached user
session.clear()                    // sign out
session.displayName() · session.initials() · session.emailConfirmed()
```
`medx_user_token` / `medx_user_data` are the LEGACY key names on purpose: the live portal, medx.hr (`?mxt=` hand-off) and the server-rendered `/plexus` form read them.

### 3.4 `js/api.js` — the fetch wrapper
```js
import { api } from './api.js';
const me     = await api.get('/api/auth/me');
const login  = await api.post('/api/auth/login', { email, password }, { noAuth: true });
await api.put('/api/user-notifications/mark-all-read');
await api.patch('/api/me', { locale: 'en' });
await api.del('/api/push/unsubscribe');
const r = await api.settle({ me: api.get('/api/auth/me'), site: api.get('/api/public/site', { noAuth: true }) }); // r.me / r.site or null
api.url('/qr/abc.png')             // absolute URL on the API host (staging is cross-origin)
try { … } catch (e) {
  if (e instanceof api.ApiError) { e.status /* 0=network, 400, 401, 404, 429… */; e.message /* server error|message or a friendly default */; e.data; e.retryAfter }
}
```
Behaviour: JSON in/out · `Authorization: Bearer` from the session unless `{ noAuth: true }` · **401** → `session.clear()` + `medx:unauthorized` event → app.js routes to `/app/auth/signin?next=<path>` (pass `{ keepSession: true }` to opt out) · **429** → `ApiError` with the server's message (show it; the auth limiter is 15 hits / 15 min per IP) · **503 `{waking:true}`** → full-screen "One moment." overlay, retry with 2/3/5/8/10 s backoff until the staging launcher is up (≤4 min), then resolve normally.
Always write literal `'/api/…'` paths — `scripts/check-api-contract.js` greps for them.

### 3.5 `js/ui.js` — helpers
```js
import { ui, esc, fmt } from './ui.js';
ui.toast('Link sent — check your inbox.');                 // never empty: '' falls back to 'Done.'
ui.toast(e.message, { kind: 'error', ms: 5000 });
const m = ui.modal({ eyebrow: 'GALA · SEAT', title: 'Cancel your seat?', body: '<p>…</p>', actions: [{ label: 'KEEP IT' }, { label: 'CANCEL SEAT', kind: 'primary', onClick: () => … }] });
const ok = await ui.confirm({ title: 'Remove this connection?', body: '…', ok: 'REMOVE', cancel: 'KEEP' });
const stop = ui.countdown(FACTS.plexus.startAt, ({ days, hrs, min, sec, done }) => …, 30000);   // returns stop()
ui.downloadIcs('medx-plexus.ics', [{ uid: 'plexus2026', start: '20261204', end: '20261206', summary: 'Plexus Conference 2026', location: 'Novinarski dom, Zagreb' }]);
const unbind = ui.bind(root, { save: (el, ev) => …, cancel: () => … });   // <span data-act="save">
ui.lockScroll(true); ui.h('<div>…</div>') /* → element */
esc(userText)                                               // HTML-escape everything dynamic
fmt.eur(150) → '€150'      fmt.num(2500) → '2,500'      fmt.shortDate('2026-07-02') → 'JUL 2'
fmt.longRange('2026-12-04','2026-12-05') → 'December 4–5, 2026'     fmt.todayLabel() → 'FRIDAY, 28 AUGUST 2026 · ZAGREB'
fmt.detail('December 4-5, 2026 - Zagreb - EUR 150') → 'December 4–5, 2026 · Zagreb · €150'   (server strings → design punctuation)
fmt.euro('EUR 150 seat') → '€150 seat'      fmt.keyDateLabel('Until September 30, 2026') → 'UNTIL SEP 30'
fmt.parseLooseDate('December 4-5, 2026') → Date      fmt.ymd(date) → '20261204'      fmt.initials('Alen','Juginović') → 'AJ'
```
Delegates installed once by app.js (`ui.installDelegates()`): `data-hover="border-color:#191512;color:#191512"` reproduces the artboards' `style-hover` on mouse-over; Enter/Space on any `[data-act]`/`[data-nav]` span clicks it; such spans get `tabindex="0" role="button"` automatically (keyboard reachable without touching the copied markup).

### 3.6 `js/router.js` + `js/routes.js`
```js
import router from './router.js';
router.navigate('/app/plexus/mine');          // pushState + render
router.replace('/app/home');                  // replaceState + render
router.back();  router.path;  router.current  // { module, root, path }
```
Route table rows (`js/routes.js`): `{ path, view: () => import('./views/x.js'), auth, guestTo, layout, active, title }`. `path` supports `:param` and `:param?`. Guards: `auth: true` → guests go to `/app/auth/signin?next=…` (or `guestTo`); a view can bounce signed-in users itself (auth.js does). `layout`: `portal` (chrome) · `auth` (ink ground, no chrome) · `bare` (cream, no chrome). `active` = drawer highlight key (`Home · Plexus · Gala · Accelerator · Forum · Bridges · Network · My Med&X`).
Link handling is global: `<a href="/app/…">` and `[data-nav="/app/…"]` route client-side; server paths and external links fall through to a full load. Scroll: back/forward restores, forward navigation scrolls to top, `#hash` targets scroll into view.

### 3.7 `js/chrome.js`
```js
import { chrome } from './chrome.js';
chrome.refresh();                         // re-read stats strip (points, registrations, following, member since) + unread count
chrome.refresh({ only: 'notifications' });
chrome.openDrawer(); chrome.closeDrawer(); chrome.closePopover();
state.set({ active: 'Gala' });            // drawer highlight (the router does this from the route table)
```
Stats strip sources: `GET /api/rewards/summary` (balance → POINTS, hidden for `quiet` profiles), `GET /api/my/events` (count → REGISTRATIONS), `GET /api/notify-topics` (projects.length → FOLLOWING), `GET /api/member/meta` (member_since → MEMBER SINCE). ALERTS dot: `GET /api/user-notifications?limit=10` (unreadCount). Banner: `session.emailConfirmed()` + `sessionStorage.medx_verify_dismissed` (legacy key); RESEND → `POST /api/auth/request-verification`.

### 3.8 `js/member.js`
```js
import { profileCompletion, loadProfileCompletion, COMPLETION_ITEMS } from './member.js';
const c = profileCompletion(me, networkingProfile);  // { pct, done, total, items:[{key,label,done}], complete }
```
Five items = the Profile artboard checklist (name · institution · portrait · specialty · bio). Home and Profile must both use this.

---

## 4. Views — the contract and how to add a screen

A view module:

```js
// Source: Gala Evening.dc.html
import { api } from '../api.js';
import { session } from '../state.js';
import { ui, esc, fmt } from '../ui.js';
import { FACTS, routeFor } from '../facts.js';
import { chrome } from '../chrome.js';
import router from '../router.js';

export const SOURCE = 'Gala Evening.dc.html';
export const COPY = {                       // EVERY string likely to change, in one place; facts via FACTS
  eyebrow: 'ANNUAL AWARDS · BLACK TIE · SEATS LIMITED',
  reserve: 'RESERVE YOUR SEAT →',
  price: () => `€${FACTS.gala.priceEarly} per guest until ${FACTS.gala.priceFlipLabel}, then €${FACTS.gala.priceRegular}.`
};

let D = null, unbind = null, timers = [];
async function load() { return api.settle({ gala: api.get('/api/gala/settings', { noAuth: true }), mine: api.get('/api/gala/my-status') }); }

function blockHero() { return `
  <!-- dc: Gala Evening.dc.html › "Hero" -->
  <div style="…artboard inline styles verbatim…">…${esc(D.gala.title)}…</div>
  <!-- /dc -->`; }

const handlers = { reserve: () => router.navigate('/plexus?event=gala') /* server-rendered form */ };

export default {
  title: 'Gala Evening',
  async render(root, ctx) {             // ctx = { params, query, path, route, navigate, user, popped }
    D = await load();
    root.innerHTML = `<div data-screen-label="Gala Evening" style="…artboard root style…">${blockHero()}…</div>`;
    unbind = ui.bind(root, handlers);
  },
  destroy() { timers.forEach(s => s()); timers = []; if (unbind) unbind(); unbind = null; D = null; }
};
```

Steps to add/replace a screen:
1. Open the artboard (`design/handoff/member-portal-2026-08-28/<Screen>.dc.html`). Copy its markup **verbatim** (inline styles included) into block functions, one per section eyebrow, in artboard order, each wrapped in `<!-- dc: <file> › "<section label>" -->` … `<!-- /dc -->`.
2. Translate the prototype bindings: `{{ prop }}` → `${…}` (escape dynamic text with `esc()`), `onClick="{{ fn }}"` → `data-act="fn"` + a handler in `handlers`, `style-hover="…"` → `data-hover="…"`, `<sc-if value="{{ x }}">…</sc-if>` → `${x ? … : ''}`, `<sc-for list="{{ items }}" as="t">…</sc-for>` → `${items.map(t => …).join('')}`, artboard links `href="My MedX.dc.html"` → `/app/me` etc. (table in §6), `assets/x.jpg` → `/assets/x.jpg`.
3. Lift the copy into `COPY`; dates/prices/venues into `FACTS` (js/facts.js) if not there already.
4. Replace the stub file `js/views/<name>.js` (keep the file name — `js/routes.js` already points at it). Add rows to `js/routes.js` only for new paths.
5. Load real data (see §8 for verified endpoints) with `api.settle` so one failing call never blanks the screen. Never hardcode counts.
6. Every clickable element does something real or shows a non-empty toast. Micro-label buttons keep `white-space:nowrap`. `€` never `EUR`. Diacritics intact (Juginović).
7. Add the `mx-*` responsive hooks where the artboard uses the patterns in §9 (page gutter, 5-card grid, side grids).
8. Verify: `python3 scripts/qa-shots.py --only <name>` (compare `_qa/design-*.png` vs `_qa/v2-*.png` at 1280 px, 430 px), no console errors, keyboard pass (Tab/Enter on every control).

### Naming rules
* `data-act="name"` — clickable (handled by `ui.bind(root, handlers)`); `data-nav="/app/…"` — plain navigation; `data-role="…"` — element the JS reads/updates (inputs, error lines, countdown cells); `data-block="…"` — re-renderable block wrapper.
* `data-screen-label="…"` on the view root = the artboard's own label.
* Block markers: `<!-- dc: <artboard file> › "<eyebrow or label>" -->` … `<!-- /dc -->` — the label text is the artboard's own (e.g. `"01 · OUR PROJECTS"`, `"KEY DATES"`). Additions with no artboard counterpart are marked `<!-- v2: … -->` (or `data-v2="…"`).
* CSS class hooks are prefixed `mx-` and never carry look — only responsive overrides and behaviour.
* Module-level `COPY` (strings) and `SOURCE` (artboard file) exports on every view.
* Handlers never read the DOM by global ids; use `root.querySelector('[data-role=…]')`.

---

## 5. Route table, legacy hashes, entry params

| Route | View | Auth | Active | Notes |
|---|---|---|---|---|
| `/`, `/app`, `/app/home` | home | yes (guest → welcome) | Home | |
| `/app/auth/:view?` | auth | public | — | `welcome` · `signin` · `signup` · `verify` · `reset` · `forum-code`; signed-in users bounce from welcome/signin/signup |
| `/app/plexus/:tab?` | plexus (stub) | yes | Plexus | `program` · `zagreb` · `mine` |
| `/app/gala` | gala (stub) | yes | Gala | |
| `/app/accelerator/:tab?` | accelerator (stub) | yes | Accelerator | `apply` |
| `/app/forum` · `/app/bridges` · `/app/network` · `/app/messages` · `/app/profile` | stubs | yes | Forum · Bridges · Network · Network · My Med&X | |
| `/app/me/:tab?` | me (stub) | yes | My Med&X | `certificates` |
| `/app/mentorship` · `/app/opportunities` · `/app/projects` | stubs / projects | yes | — | projects = mobile PROJECTS tab |
| `/app/maintenance` | maintenance | public (bare) | — | |
| anything else | notfound (bare) | — | — | System Pages 404 |

Legacy hashes mapped on boot (`js/app.js › HASH_MAP`; prefixes `#up-section-` and `#section-` are stripped): `dashboard|home → /app/home`, `plexus`, `gala`, `accelerator`, `forum|af26 → /app/forum`, `bridges|building-bridges`, `network`, `messages|communications → /app/messages`, `profile|settings → /app/profile`, `mymedx|wallet|me|rewards → /app/me`, `talks|speaker|scanner|admin → /app/home`.

Entry query params consumed on `/` (any path): `?mxt=<jwt>` (website SSO — also handled by the inline script in index.html), `?logout=true`, `?verified=true|already|expired|invalid` (toast; sets `email_verified`; guests → `/app/auth/signin?notice=verified`), Stripe returns `?payment=success|cancelled` + `gala=` → `/app/me` · `type=accelerator&app=` → `/app/accelerator` · `type=forum&reg=` → `/app/forum` · `reg=` → `/app/plexus/mine`, PWA shortcuts `?app=1&view=ticket|schedule`, `?login=true`, `?register=<token>` (toast — the direct-registration form is server-rendered).

---

## 6. Artboard → view module → template blocks

| Artboard | View module | Template blocks (dc markers, in order) | Artboard links → routes |
|---|---|---|---|
| Portal Chrome.dc.html | `js/chrome.js` | "Top bar" · "Member stats strip" · "Email-confirm banner" · "Drawer" | Med&X Home → `/app/home`, My MedX → `/app/me`, Plexus Conference → `/app/plexus`, Gala Evening → `/app/gala`, Accelerator → `/app/accelerator`, Biomedical Forum → `/app/forum`, Building Bridges → `/app/bridges`, Network → `/app/network`, Profile → `/app/profile` |
| Mobile Portal.dc.html | `js/chrome.js` (bars) · `js/views/projects.js` | "Top bar" · "Email-confirm banner" · "Tab bar" · "Five projects, one membership." | tabs HOME `/app/home` · PROJECTS `/app/projects` · PEOPLE `/app/network` · INBOX `/app/messages` · MY M&X `/app/me` |
| Med&X Home.dc.html | `js/views/home.js` | "YOUR NEXT EVENT" (hero + GETTING STARTED) · "NEXT EVENT" · "01 · OUR PROJECTS" · "02 · LATEST FROM MED&X" (+ "KEY DATES") · "MED&X NEWSLETTER" · "FROM THE FORUM" · "03 · GROW YOUR NETWORK" | Plexus Program → `/app/plexus/program`, My Plexus → `/app/plexus/mine`, project cards → `routeFor(cta_target)` |
| Auth.dc.html | `js/views/auth.js` | "Welcome" · "Panel" › ("01 · DETAILS" · "02 · CONFIRM EMAIL" · "Sign in" · "Reset password" · "Invitation code") · "Footer" | view prop Welcome/Sign in/Create account/Verify email/Reset password/Invitation code → `/app/auth/welcome|signin|signup|verify|reset|forum-code` |
| System Pages.dc.html | `js/views/notfound.js` · `js/views/maintenance.js` | "01 · 404 — PAGE NOT FOUND" · "02 · MAINTENANCE" | BACK TO HOME → `/app/home`, MESSAGE US → `/app/messages` |
| Empty States.dc.html | pattern reused in home.js (Latest), chrome.js (ALERTS), `css/tokens.css › .empty` | "MY WALLET" · "MESSAGES" · "HOME · LATEST" · "NETWORK" | — |
| App Icon & Splash.dc.html | `scripts/make-icons.py` → `assets/icons/` | "01 · APP ICON — THE AMPERSAND MARK" (PRIMARY · 180 tile) | — |
| Plexus Conference / Program / Zagreb / My Plexus | `js/views/plexus.js` (stub, `:tab`) | — | `/app/plexus`, `/program`, `/zagreb`, `/mine` |
| Gala Evening · Accelerator (+ Application) · Biomedical Forum · Building Bridges · Network · Messages · Profile · My MedX | stubs of the same name | — | `/app/gala` · `/app/accelerator(/apply)` · `/app/forum` · `/app/bridges` · `/app/network` · `/app/messages` · `/app/profile` · `/app/me(/certificates)` |
| Emails.dc.html | not a portal screen (backend email templates) | — | — |

---

## 7. Applying a design revision

A new export of the same `.dc.html` folder arrives; patch only what changed:

```
node scripts/design-diff.js design/handoff/member-portal-2026-08-28 ~/Downloads/<new-export> --out design/handoff/DIFF-member-$(date +%F).md
```

The report lists, per changed artboard, the text removed/added, changed `data-props` defaults, style-only edits and a pretty-printed markup diff grouped by the artboard's section eyebrows. Then:

1. Find the block: the section label in the report = the `<!-- dc: <file> › "<label>" -->` marker in the view (table in §6; `grep -rn 'dc: Med&X Home' js/`).
2. Copy the artboard's new markup for that block into the block function — inline styles verbatim; keep the `data-act` / `data-role` / `data-hover` / `mx-*` attributes the block already carries (re-apply them on the new elements).
3. Text/labels/prices/dates: change `COPY` (view) or `FACTS` (js/facts.js) — never inside the template.
4. New section → new block function + marker in artboard order; removed section → delete the block, keep nothing dangling in `handlers`.
5. Chrome/responsive changes: `js/chrome.js` blocks and the `mx-*` rules in `css/app.css` (translate any new `responsive.css` selector to a class hook).
6. Re-shoot: `python3 scripts/qa-shots.py --only <screen>`; compare `_qa/design-<screen>.png` vs `_qa/v2-<screen>.png`. Run `python3 scripts/qa-flows.py` for the built flows.
7. Commit the new export into `design/handoff/member-portal-<date>/` so the next diff has a baseline.

---

## 8. Endpoints wired (verified in `user-portal/backend/server.js`)

| Screen | Method + path | Used for |
|---|---|---|
| Auth | `POST /api/auth/login` (authLimiter) | sign in → `{token,user}`; 401 bad credentials; 403 `{needsVerification,email}` |
| Auth | `POST /api/auth/register` (authLimiter) | create account → `{token,user,needsVerification,devVerifyUrl?}` (signed in, unverified) |
| Auth · chrome · Home | `POST /api/auth/request-verification` (authLimiter) | resend confirmation link (generic success; `devVerifyUrl` when no mail provider) |
| Auth | `POST /api/auth/forgot-password` (authLimiter) | reset link (generic success). The reset page itself is server-rendered: `GET /reset-password/:token` |
| Auth | `POST /api/forum/invitations/redeem` | **does not exist yet** — the name the Forum code screen calls; 404 → "not connected" notice |
| boot · Home | `GET /api/auth/me` | profile (no `email_verified` — see gaps) |
| chrome | `GET /api/rewards/summary` · `GET /api/my/events` · `GET /api/notify-topics` · `GET /api/member/meta` | stats strip |
| chrome | `GET /api/user-notifications?limit=10` · `PUT /api/user-notifications/:id/read` · `PUT /api/user-notifications/mark-all-read` | ALERTS dot + panel |
| chrome | `GET /api/member/search?q=` | SEARCH overlay (events · members · talks · mine) |
| Home | `GET /api/public/site` | conference name/date_range/venue/registration_open, countdown target (`start_date` + 09:00 +01:00) |
| Home | `GET /api/public/status` | project cards (`status_label`, `detail_line`, `cta_label`, `cta_target`) |
| Home | `GET /api/feed/home` (fallback shape also matches `GET /api/feed`) | Latest from Med&X + From the Forum teaser (`source:'forum'`) |
| Home | `GET /api/plexus/settings` | Key dates (`key_dates[]` {label,date,color}) |
| Home | `GET /api/public/impact` | Grow-your-network numbers |
| Home | `GET /api/me/next-event` | hero eyebrow name, REGISTER NOW ↔ MY TICKET |
| Home | `GET /api/networking/profile` | specialty item of the profile completion |
| Home | `POST /api/notify-topics {project,on}` | newsletter SUBSCRIBE (see gaps) |
| Home | `POST /api/member/profile-nudge/dismiss` | GETTING STARTED × (plus per-user localStorage) |
| sw.js | `GET /api/push/vapid-key` | push re-subscribe (contract kept from the legacy worker) |

---

## 9. Responsive & the mobile pattern

Desktop-first. `css/app.css` translates the export's `responsive.css` into class hooks (the export's `[style*="…"]` selectors only match browser-serialised styles, which raw markup never is):

| Hook | Where | Effect ≤900 / ≤700 / ≤500 |
|---|---|---|
| `mx-gutter` | `padding:0 36px` wrappers | gutter 18px |
| `mx-pad-hero` · `mx-pad-band` · `mx-pad-36` | hero / ink band / 36px paddings | compact paddings |
| `mx-topbar` · `mx-stats` · `mx-identity-text` | chrome | wrap; date on its own line; name hidden ≤700 |
| `mx-grid-5` · `mx-grid-4` · `mx-grid-6` · `mx-grid-3` · `mx-grid-2` | card grids | 2 → 1 columns |
| `mx-grid-hero` · `mx-grid-latest` · `mx-grid-side` | asymmetric grids | single column |
| `mx-next-event` · `mx-vrule` · `mx-cta-row` | countdown band | wraps ≤700 |
| `mx-display-46` · `mx-display-30` · `mx-display-26` | display type | 28 / 22 / 20 px ≤500 |
| `mx-w250` · `mx-w230` · `mx-w220` | fixed-width inputs | full width |

≤430 px (Mobile Portal.dc.html): the desktop chrome hides; the sticky compact top bar (logo or ← back on pushed sub-views, uppercase title, EN · HR, avatar), the compact email banner and the ink bottom tab bar show (`#mx-mobile-top`, `.mx-mobile-only`, `#mx-tabbar`; `#view` gets 86px bottom padding). Content keeps the desktop templates stacked by the hooks above — "carry full content". Hit targets ≥ 44px on the tab bar.

---

## 10. PWA

`manifest.webmanifest`: name/short_name "Med&X", `start_url /app/home?app=1`, `id medx-member-portal`, theme `#191512`, background `#f7f1e6`, icons 192/512 (any) + maskable 192/512, shortcuts My ticket → `/app/me?app=1&view=ticket`, Schedule → `/app/plexus/program?app=1`. Icons are rendered from the App Icon artboard by `python3 scripts/make-icons.py` (Playwright/Chromium; also `assets/icons/icon-1024.png` store master and `apple-touch-icon.png`).
`sw.js`: precache of the shell (same-origin only); navigations network-first with `/index.html` fallback; `/css /js /assets` cache-first; **`/api/*` and every server path are never intercepted**; cross-origin never intercepted; push + notificationclick + pushsubscriptionchange kept. app.js registers it except on localhost (add `?sw=1` to test locally). Bump/stamp `CACHE_NAME` on deploy or cached JS stays.

---

## 11. Run it locally

```bash
# 1) backend on :3941 with a COPY of the staging seed (never edit the original)
cp deploy/staging/seed.db /tmp/v2dev.db            # or the scratch copy you were given
cd user-portal/backend
DATABASE_PATH=/tmp/v2dev.db PORT=3941 NODE_ENV=staging JWT_SECRET=x nohup node server.js > /tmp/backend3941.log 2>&1 &
# stop later with:  lsof -ti tcp:3941 -sTCP:LISTEN | xargs kill   (macOS has no `timeout`; scope to LISTEN — a bare `lsof -ti :3941` also matches the dev server proxying to it)

# 2) front end on :8890
cd ../frontend-v2
BACKEND=http://localhost:3941 PORT=8890 node dev-server.js
open http://localhost:8890/app/auth/welcome

# 3) a test member (no mail provider → the verify link comes back in the JSON; auth routes are limited to 15 hits / 15 min per IP — reuse tokens)
curl -s -X POST http://localhost:3941/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"qa.v2+you@example.com","password":"Passw0rd!x","first_name":"Alen","last_name":"Juginović","country":"Croatia"}'
```

QA:
```bash
python3 scripts/make-icons.py                                   # regenerate icons from the artboard
MEDX_QA_TOKEN=<jwt> MEDX_QA_USER='<user json>' python3 scripts/qa-shots.py [--only home]   # artboard vs v2 screenshots → _qa/
MEDX_QA_EMAIL=… MEDX_QA_PASSWORD=… MEDX_QA_TOKEN=<jwt> python3 scripts/qa-flows.py          # functional pass (uses 5 auth calls)
node ../../scripts/check-api-contract.js                        # literal /api/ paths vs server routes (repo tripwire)
```
The 503-waking overlay can be exercised with a stub that answers `503 {waking:true}` for a few seconds before proxying (see `scripts/qa-flows.py --wake-base`).

---

## 12. Gaps found (backend / content) — for the backend owner

1. **No member newsletter endpoint.** `/api/pr/newsletters*` and `/api/pr/subscribers*` are admin-only; `POST /api/email-prefs` is the HMAC-signed opt-out form; `user_profiles.receive_newsletter` is written by nothing member-facing. The Home SUBSCRIBE button records the picked topics as project follows via `POST /api/notify-topics` (the real "get notified" store, drives the FOLLOWING stat and the admin "N members waiting"). When a newsletter endpoint lands, swap the call in `home.js › handlers.nlSub`.
2. **No Forum invitation-code endpoint.** `forum_invitations.invitation_code` is only inserted by admin; the legacy SPA checked a hard-coded demo list client-side. `auth.js` calls `POST /api/forum/invitations/redeem {code, email}` and treats 404 as "not connected yet". Needed: validate code → join network (forum_members) → optional inline account creation (README note 18).
3. **`GET /api/auth/me` does not return `email_verified`.** The session flag is set client-side: register → 0, login success → 1 (the server gates login on verification when a mail provider exists and self-heals otherwise), `?verified=true|already` → 1. A restored session from a legacy `medx_user_data` without the flag is treated as confirmed. Exposing `email_verified` on `/api/auth/me` would make the banner authoritative.
4. **No profile-completion %.** `GET /api/member/profile-nudge` only reports missing photo/institution. Completion is computed client-side (`js/member.js`) from `/api/auth/me` + `/api/networking/profile.research_interests` (the Profile artboard's five checklist items). The GETTING STARTED dismissal is persisted per user in localStorage and mirrored with `POST /api/member/profile-nudge/dismiss`.
5. **No Forum-feed endpoint** (README note 22 — admin composer → member "From the Forum"). Home shows the first `source:'forum'` item of `GET /api/feed/home` and hides the teaser when there is none (no fallback names).
6. **Impact numbers.** `GET /api/public/impact` has members/countries/registrations/events/speakers — no "Nobel laureates" figure; the band shows GUESTS SO FAR · MEMBERS · COUNTRIES · SPEAKERS HOSTED (live).
7. **Seed/admin content vs canonical facts** (admin-editable, so left as served): `project_status` rows say "Applications open in November", "Building Bridges at Harvard Medical School" (decision: no Harvard branding), "EUR 150" (rendered as €150 by `fmt.detail`), "December 4-5" (en-dashed on render); `plexus_settings.key_dates` still lists an Abstract Submission Deadline (no abstracts in 2026) and an early-bird date of Sep 30 (canonical: Sep 1). Update them in the admin portal.
8. **Staging redirect quirk.** `GET /api/auth/verify?token=` redirects to `/?verified=…` on the API host; with the Netlify front end on another origin the member lands on the Render host's page instead of v2. Either proxy the click through Netlify (`/api/*` is proxied — use the Netlify origin in the emailed link, i.e. `RENDER_EXTERNAL_URL`/`STAGING_MEMBER_URL`) or redirect to `STAGING_MEMBER_URL`.
9. The website's `mxt` hand-off on `/plexus?…&mxt=` stays dead (server-rendered path; audit §0.2) — untouched here.

## 13. Decisions & deviations (so a revision can revisit them)

* Hero photo rotation (6 s): the current Home artboard's hero has no photograph (mark-x decorations on cream), so the rotation runs on the GROW YOUR NETWORK photo band — `home.js › startTimers()`. Move it if the revision restores a photo hero.
* Greeting follows the clock in English only — the Croatian text easter egg was removed by the August decision ("visual easter eggs allowed, text ones not").
* "Messages" quick link added to the drawer (`data-v2` marked) — the export has no drawer entry for the Messages screen.
* SEARCH overlay and ALERTS panel have no artboard; built from tokens (`.mx-pop`, `.mx-search`).
* SEE ALL on Latest expands the list in place (no archive screen in the route table) and flips to SHOW LESS.
* REGISTER NOW → MY TICKET → on the countdown band once `/api/me/next-event.registered` is true (both go to `/app/plexus/mine`).
* POINTS hidden in the stats strip for server-flagged `quiet` profiles (senior guests never see gamified UI).
* Key dates fall back to FACTS rows only when the API returns none; the `.ics` is built from the rendered rows (unparseable free-text dates are skipped).
* Clickable spans stay spans (artboard markup) and get `role="button" tabindex="0"` + Enter/Space handling from a delegate; auth forms are wrapped in `<form style="display:contents">` so Enter submits; inline error lines (`data-role="error"`) are a v2 addition.
* `/` and `/app/home` send guests to the welcome landing; every other guarded route sends them to sign-in with `?next=`.
