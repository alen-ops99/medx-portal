# Med&X WEBSITE → PORTALS: live-verified connection inventory

**Audit date:** 2026-08-28 (probes run ~21:40–22:00 UTC)  
**Scope:** public website (`medx.hr`, Netlify site `medx-website-preview`) → member portal (`medx-user-portal.onrender.com`) + admin portal (`medx-admin-portal.onrender.com`) + Netlify account inventory.  
**Method:** read-only. GET/HEAD/OPTIONS only. No forms submitted, no POSTs, Stripe redirects recorded but never followed. Netlify API GET only.  
**Sources:** live site fetched from `https://medx.hr/` (every page in the 07-31 mirror + sitemap), diffed against `MedX_Squarespace/site_live_mirror_2026-07-31/` (the `site_v2/` folder was ignored as stale); `site.js` read in full (1,867 lines); portal handlers cross-referenced in `user-portal/backend/server.js` and `admin-portal/backend/server.js`.

## 0. Headline facts (read this first)

1. **Which is newer, mirror or live?** They are **byte-identical**. Every one of the 70 files fetched from the live host (site.js, all 62 HTML pages incl. `/hr/*`, sitemap.xml, sw.js, manifest.json, robots.txt, both `data/site-snapshot.json` files) matched the mirror with `cmp`. `site.js` MD5 `e59f65be4fe47bbbad8f0c7ce6017ada` on both; deployed blob SHA-1s from the Netlify files API match the mirror (`site.js` 7057c9e4…, `_redirects` 00d9f659…, `data/site-snapshot.json` 4d03f866…). The "07-31" mirror folder has clearly been kept in sync after each deploy (file mtimes Aug 7, 8, 23) — the newest production deploy is **`6a8b1da6c99824645d697fdf`, published 2026-08-23T16:19:52Z**, and the mirror's newest mtime is Aug 23 12:19 EDT = 16:19 UTC. There is **no portal-URL drift** between mirror and live; the list of deploys after the mirror (6a6d…, 6a6f…, 6a77…, 6a8b…) are all reflected in the mirror content.
2. **The canonical host is now the apex.** `https://www.medx.hr/*` → **301 → `https://medx.hr/*`** (Netlify primary domain = `medx.hr`, alias = `www.medx.hr`). All on-page SEO metadata still says `www.medx.hr` (55/57 canonicals, 107 og:url/og:image, 60 hreflang, all 29 sitemap `<loc>`s, robots.txt `Sitemap:`) → every one is a 301 hop. Crawlers cope, but canonical ≠ served host. `http://www.medx.hr/` is a double hop (→ https://www → https://apex).
3. **Portal connectivity: all core targets OK.** 10/10 `/api/public/*` + `/health` reads answer 200 with correct `Access-Control-Allow-Origin` for both `https://medx.hr` and `https://www.medx.hr`; foreign origins get no ACAO; OPTIONS preflights return 204 with ACAO. `/donate/checkout` → 303 to `checkout.stripe.com` (live key `cs_live_…`, not followed).
4. **Broken / suspicious (details in §2):**
   - `heritage.medx.hr` → **404 from Vercel** (DNS A 64.29.17.65/216.198.79.65 = Vercel, while the Netlify site `medx-heritage` claims that custom domain, ssl=false). Not linked from the website (heritage lives at `medx.hr/heritage/`), but the Netlify site is orphaned.
   - Internal build/screenshot scripts are **publicly served**: `https://medx.hr/assemble_v2.py`, `/_shotplx.py`, `/_shotsec.py`, `/_shotvc.py`, `/scripts/build-snapshot.sh` all 200. Harmless content, but should not be in the deploy digest.
   - `admin /api/public/press` returns **`releases: []`** → both press pages fall back to baked cards (by design, but the "live newsroom" is effectively inactive).
   - Portal-hosted supporter logos (`medx-user-portal.onrender.com/assets/supporters/*.png`, 14 of 25 live rows) are served with **`Cross-Origin-Resource-Policy: same-origin`** → a browser will block them as cross-origin `<img>` on medx.hr. Invisible today only because `site.js` prefers the baked local asset by name and all 25 live supporters have a baked tile; the first supporter added in admin without a local logo will render as a broken image.
   - `/hr/data/site-snapshot.json` is a **stale 2026-07-03 seed** (prices 150/200/250, `includes_gala=1`, no speakers) that HR pages fetch (relative path); the live fetch overrides it within ~0.4 s, so it only affects the first paint / offline.
   - `medx-website-preview.netlify.app` serves the whole site with 200 (no redirect to the primary domain) — duplicate host; and the portal's `/api/public/site` speaker `photo_url`s point at that host.
5. **Netlify account:** 291 sites (list endpoint pages at 100; 3 pages fetched, page 4 empty), 28 Med&X-related by name/domain, 4 with custom domains (`medx.hr`, `heritage.medx.hr`, `spavajbolje.com`, `lightkeeperstories.com`). Netlify Forms on the website site: 5 forms registered (`newsletter` 3 submissions, others 0).

---

## 1. LINK INVENTORY (live site, verified identical to mirror)

Columns: exact target | pages (EN and HR listed separately; page names without `.html`) | element / context (button text, class, data-attr) | purpose.

### 1A. Member portal — `https://medx-user-portal.onrender.com`

| Target URL | Pages | Element / context | Purpose |
|---|---|---|---|
| `https://medx-user-portal.onrender.com/` | **EN (28):** 404, about, accelerator-sponsor, accelerator, advisory-council, book-of-abstract, building-bridges-sponsor, building-bridges, bylaws, contact, donate, events, faq, get-involved, index, network, plexus-attend, plexus-gala-sponsor, plexus-gala, plexus-sponsor, plexus, portal, press, privacy, refund, speakers, supporters, terms<br>**HR (24):** hr/about, hr/accelerator-sponsor, hr/accelerator, hr/advisory-council, hr/building-bridges, hr/bylaws, hr/contact, hr/donate, hr/events, hr/faq, hr/get-involved, hr/index, hr/plexus-attend, hr/plexus-gala-sponsor, hr/plexus-gala, hr/plexus-sponsor, hr/plexus, hr/portal, hr/press, hr/privacy, hr/refund, hr/speakers, hr/supporters, hr/terms | a href class="btn btn-ghost" target="_blank" rel="noopener" — "Create a free account →"<br>a href class="btn btn-ghost" target="_blank" rel="noopener" — "Otvorite besplatan račun →"<br>a href class="btn btn-light" target="_blank" rel="noopener" — "Join Med&X — free →"<br>a href class="btn btn-light" target="_blank" rel="noopener" — "Join the network →"<br>a href class="btn btn-light" target="_blank" rel="noopener" — "Učlanite se — besplatno →"<br>a href class="btn btn-line" target="_blank" rel="noopener" — "Log in →"<br>a href class="btn btn-line" target="_blank" rel="noopener" — "Prijava →"<br>a href class="btn btn-primary" target="_blank" rel="noopener" — "Access the alumni network →" | Nav "Log in or sign up" (`a.nav-portal` + mobile `a.mm-portal`, 27 EN + 24 HR pages), footer "Log in to the portal" / "Članski portal", CTA buttons "Join Med&X — free", "Create a free account", "Join the network", portal.html hero buttons. `site.js` MedXBridge rewrites `.nav-portal` at runtime: logged-out → opens the in-page sign-in modal (href removed); logged-in → hidden and replaced by the account widget (see §1I). |
| `https://medx-user-portal.onrender.com` | **EN (2):** accelerator, biomedical-forum<br>**HR (2):** hr/accelerator, hr/biomedical-forum | a href class="btn btn-primary" target="_blank" rel="noopener" — "Go to the Med&X portal →"<br>a href class="btn btn-primary" target="_blank" rel="noopener" — "Idite na Med&X portal →"<br>inline-script URL literal | "Go to the Med&X portal →" / "Idite na Med&X portal →" on the Accelerator page; also the `PORTAL` constant in the forum page inline script. |
| `https://medx-user-portal.onrender.com/plexus` | **EN (8):** book-of-abstract, events, faq, get-involved, index, plexus-attend, plexus-gala, plexus<br>**HR (7):** hr/events, hr/faq, hr/get-involved, hr/index, hr/plexus-attend, hr/plexus-gala, hr/plexus | a href class="btn btn-dark" data-medx-cta="register" data-medx-reg="plexus-2026" target="_blank" rel="noopener" — "Reserve your place →"<br>a href class="btn btn-dark" data-medx-cta="register" data-medx-reg="plexus-2026" target="_blank" rel="noopener" — "Rezervirajte svoje mjesto →"<br>a href class="btn btn-gold" target="_blank" rel="noopener" — "Gala Evening — reserve a seat →"<br>a href class="btn btn-gold" target="_blank" rel="noopener" — "Gala večer — rezervirajte mjesto →"<br>a href class="btn btn-light" data-medx-cta="register" data-medx-reg="plexus-2026" target="_blank" rel="noopener" — "Pre-register for Plexus →"<br>a href class="btn btn-light" data-medx-cta="register" data-medx-reg="plexus-2026" target="_blank" rel="noopener" — "Prijavite se unaprijed za Plexus →"<br>a href class="btn btn-light" data-medx-cta="register" data-medx-reg="plexus-2026" target="_blank" rel="noopener" — "Register for Plexus →"<br>a href class="btn btn-outline" data-medx-cta="register" data-medx-reg="plexus-2026" target="_blank" rel="noopener" — "Pre-register →" | Baked (no-JS) href of every registration CTA: 31 anchors carry `data-medx-reg="plexus-2026"` + 10 carry `data-medx-reg="plexus-gala-2026"`, all with `data-medx-cta="register"`. At runtime `site.js` `applyRegLinks()` rewrites these to the deep link `…/plexus?event=<slug>&ticket=<phase>&from=website[&mxt=<token>]` (§1I). Also plain "Gala Evening — reserve a seat →" buttons. |
| `https://medx-user-portal.onrender.com/forum` | **EN (1):** biomedical-forum<br>**HR (1):** hr/biomedical-forum | a href class="btn btn-light" — "Enter the Forum membership portal →"<br>a href class="btn btn-light" — "Uđite u članski portal Foruma →"<br>a href class="enter" — "Enter the Forum membership portal"<br>a href class="enter" — "Uđite u članski portal Foruma"<br>a href class="fnav-enter" — "Enter the portal →"<br>a href class="fnav-enter" — "Uđite u portal →"<br>a href class="tlink" — "Enter the Forum membership portal →"<br>a href class="tlink" — "Uđite u članski portal Foruma →" | Biomedical Forum wing: "Enter the Forum membership portal" / "Enter the portal →" (`a.fnav-enter`, `a.enter`, `a.tlink`, `a.btn-light`, all `data-enter-forum`). Portal route `/forum` serves `forum-wing.html`. |
| `https://medx-user-portal.onrender.com/donate/checkout?src=medx.hr` | **EN (1):** donate<br>**HR (1):** hr/donate | inline-script URL literal | Inline script constant `DONATE_CHECKOUT` on donate.html / hr/donate.html. Built at click time as `…?src=medx.hr&amount=<n>&frequency=<once / month / year>&designation=<unrestricted / accelerator / plexus / gala / forum / bridges>` and opened with `window.open(url,'_blank','noopener')` (express "Donate now" button `[data-express-donate]` uses amount=50, frequency=once, designation=unrestricted). Server: `GET /donate/checkout` → 303 to Stripe Checkout; success_url `https://medx.hr/donate?thanks=1`, cancel_url `…?cancelled=1`, any failure → 302 `…?checkout_error=1`. |
| `https://medx-user-portal.onrender.com/apply` | site.js only (search index entry "Apply to the Accelerator") | Cmd/Ctrl-K site search result, opens in new tab | Accelerator application entry. |
| `https://medx-user-portal.onrender.com/?mxt=<token>` and `…/?mxt=<token>#mymedx` | site.js only (runtime, signed-in state) | Account menu "Open the app", "Get the app on your phone", the "My next event" nav chip (`#mymedx`), notification click-through targets (`app:<hash>` tokens → `PORTAL/?mxt=…#<hash>`), mobile `.mm-portal` when logged in | Hands the website session token to the portal so it opens signed in. |
| `https://medx-user-portal.onrender.com/plexus?event=<slug>&ticket=<phase>&from=website[&mxt=<token>]` | runtime rewrite of all 41 `a[data-medx-reg]` anchors (EN: index, plexus, plexus-attend, plexus-gala, events, faq, get-involved, book-of-abstract; HR: index, plexus, plexus-attend, plexus-gala, events, faq, get-involved) | `applyRegLinks()` in site.js | Intent-carrying registration deep link (§1I). Probed live: 200. |
| `https://medx-user-portal.onrender.com/health` | site.js dead-letter backstop (pages with a portal-flow CTA); the warming-splash interceptor references it too but is **disabled** (`portalOrigin()` returns `null` since 2026-08-02) | `fetch(PORTAL+'/health',{mode:'cors'})` after 6 s if MedXLive never reported | Reachability probe; ACAO for medx.hr verified. |
| `https://medx-user-portal.onrender.com/api/public/site` | every page (site.js MedXLive) | `fetchWithTimeout(…,4500)` | Conference facts, typed price/deadline, tickets, speakers → `data-medx-slot="site:*"`, countdowns, JSON-LD, CTA open/closed, ticket phase. |
| `…/api/public/content` | every page | same | Admin content blocks → `data-medx-slot="content:*"`, `data-medx-strip`, members-bar copy. |
| `…/api/public/status` | every page | same | Project status rows → `data-medx-slot="status:*"`, `data-medx-status-dot`, `data-medx-status-cta`. |
| `…/api/public/supporters` | only pages hosting `[data-medx-list="supporters:wall"]`: index, supporters (EN + HR) | conditional fetch | Supporters wall. |
| `…/api/public/pv` (POST) | every page (site.js) + forum pages (own inline copy) | `navigator.sendBeacon(url, Blob text/plain)` → fallback `fetch(POST, mode:'cors', keepalive)` | First-party pageview counter (path + referrer domain only). |
| `…/api/public/forum-consideration` (POST JSON) | biomedical-forum, hr/biomedical-forum | inline script, form `#rcForm` "Send this note" | Forum "request for consideration"; falls back to Netlify Forms `forum-consideration` if the portal errors. |
| `…/api/auth/login` (POST) | every page (MedXBridge modal) | in-page sign-in modal `#medxAuthModal` | Website-native login against the portal API over CORS; stores `medx_user_token` + `medx_user_data`. |
| `…/api/bell-feed?limit=30` | every page when signed in | bell widget | Notifications + announcements union. |
| `…/api/me/next-event` | every page when signed in | nav chip `#medxNextEvt` | Member's registered event. |
| `…/api/user-notifications/<id>/read` (PUT), `…/api/user-notifications/mark-all-read` (PUT) | every page when signed in | notification panel | Cross-surface read sync. |
| `…/api/public/impact` | **not referenced by any live page or by site.js** — only by `scripts/build-snapshot.sh` (and the value lands in `data/site-snapshot.json`, which site.js ignores for `impact`) | build-time only | `impact.html` is a redirect stub to `press.html`; the endpoint is live but unused by the website. |

### 1B. Admin portal — `https://medx-admin-portal.onrender.com`

| Target URL | Pages | Element / context | Purpose |
|---|---|---|---|
| `https://medx-admin-portal.onrender.com` | **EN (29):** 404, about, accelerator-sponsor, accelerator, advisory-council, book-of-abstract, building-bridges-sponsor, building-bridges, bylaws, contact, donate, events, faq, footer, get-involved, index, network, plexus-attend, plexus-gala-sponsor, plexus-gala, plexus-sponsor, plexus, portal, press, privacy, refund, speakers, supporters, terms<br>**HR (24):** hr/about, hr/accelerator-sponsor, hr/accelerator, hr/advisory-council, hr/building-bridges, hr/bylaws, hr/contact, hr/donate, hr/events, hr/faq, hr/get-involved, hr/index, hr/plexus-attend, hr/plexus-gala-sponsor, hr/plexus-gala, hr/plexus-sponsor, hr/plexus, hr/portal, hr/press, hr/privacy, hr/refund, hr/speakers, hr/supporters, hr/terms | a href rel="nofollow" — "Prijava za tim"<br>a href rel="nofollow" — "Team sign-in" | Footer legal line "Team sign-in" / "Prijava za tim" (`rel="nofollow"`) on every full page incl. 404 and the `footer.html` partial. Only baked admin link on the site. |
| `https://medx-admin-portal.onrender.com/` | site.js runtime — account menu item "Admin console" (`data-mx-admin`), injected only when `medx_user_data.is_admin` is truthy | MedXBridge `render()` | Staff shortcut. |
| `https://medx-admin-portal.onrender.com/api/public/press` | only pages hosting `[data-medx-list="press:releases"]`: press, hr/press | site.js `pressWanted()` conditional fetch | Live newsroom feed; renders only when the array is non-empty **for the page locale**, else baked cards stay. Live result today: `releases: []`. |
| `https://medx-admin-portal.onrender.com/api/public/press/<slug>` | runtime — `[data-mx-url]` "Read the announcement" link inside each rendered press card | `applyPress()` | Individual release page (site-styled HTML from admin). |
| `https://medx-admin-portal.onrender.com/health` | referenced only inside the **disabled** warming-splash interceptor in site.js | dead code path | Not exercised by the live site. (Admin `/health` sends no ACAO for medx.hr — irrelevant while disabled.) |

### 1C. `*.netlify.app` and same-origin data hooks

| Target URL | Where | Context | Purpose |
|---|---|---|---|
| `https://medx-website-preview.netlify.app/assets/photos/kn_{delcarmen,kevin_smith,smith_finsbury,spisso}.jpg` | **not in HTML** — inside the portal's `/api/public/site` `speakers[].photo_url` and in `data/site-snapshot.json` (EN) | live data | Keynote photos for the live speaker roster. Today the baked keynote cards win (`data-medx-fallback-names` match the live roster after normalisation) so these URLs are not loaded; they would be used the moment admin changes the roster. Probed 200. |
| `data/site-snapshot.json` (relative → `/data/site-snapshot.json` on EN pages, `/hr/data/site-snapshot.json` on HR pages) | every page (site.js `seedFromSnapshot`) | `fetch(…,{cache:'no-store'})` when `medx_live_cache` is empty | Build-time seed for first paint. EN seed generated 2026-07-28; HR seed 2026-07-03 (stale). |
| `sw.js` (relative → `/sw.js` or `/hr/sw.js`) | every page | `navigator.serviceWorker.register('sw.js')` | PWA; cross-origin (portal, checkout) requests are passed straight to the network. |
| `https://medx.hr/{plexus,plexus-gala,biomedical-forum,events}` and `https://medx.hr/hr/{plexus,biomedical-forum}` | events, index, plexus, plexus-attend, biomedical-forum (EN + HR) | `<span class="medx-cal" data-cal-url="…">` | URL embedded in the generated `.ics` / Google Calendar links. All probed 200. |
| `https://medx.hr`, `https://medx.hr/donate` | heritage/index.html | `a.en-site`, `a.gr-cta` "Register", QR links | Heritage micro-site back-links. |
| `https://www.medx.hr/…` | 45 pages as JSON-LD/og/canonical/hreflang literals; sitemap.xml; robots.txt | metadata | All now 301 → apex (see §0.2). |
| `/accelerator.html`, `/press.html`, `/hr/press.html`, `/hr/accelerator.html` | accelerator-news.html, impact.html, hr/impact.html, hr/accelerator-news.html | `<meta http-equiv="refresh" content="0;url=…">` + `location.replace(…)` | Legacy-URL stubs. |

### 1D. Third-party targets

| Target URL | Pages | Element / context | Purpose |
|---|---|---|---|
| `https://docs.google.com/forms/d/e/1FAIpQLSdFmbM1Oje9AzJ6CXJ2fKXe2QfsjVre_P7JaSiVLY_W61fwag/viewform?usp=sharing` | **EN (2):** building-bridges, index<br>**HR (2):** hr/building-bridges, hr/index | a href class="btn btn-primary" target="_blank" rel="noopener" — "Pre-register now →"<br>a href class="btn btn-primary" target="_blank" rel="noopener" — "Predbilježite se →"<br>a href class="gn-btn" target="_blank" rel="noopener" — "Pre-register"<br>a href class="gn-btn" target="_blank" rel="noopener" — "Predbilježite se" | Building Bridges Boston pre-registration ("Pre-register now →", `a.gn-btn`). The only Google Form on the site — Building Bridges registration does NOT go through the portal. |
| `https://github.com/alen-ops99/medx-portal/releases/download/v1.1.0/MedX-Member-1.1.0-mac-arm64.dmg` | **EN (2):** index, portal<br>**HR (2):** hr/index, hr/portal | a href class="app-get" — "Download for Mac ↓"<br>a href class="app-get" — "Preuzmi za Mac ↓"<br>a href class="btn btn-light" — "Mac aplikacija ↓"<br>a href class="btn btn-light" — "Mac app ↓" | "Download for Mac ↓" / "Mac app ↓" (`a.app-get`, `a.btn-light`). site.js "Get the app" overlay also links `…/MedX-Member-Setup-1.1.0-win.exe`. |
| `https://maps.google.com/?q=Hotel+Esplanade+Zagreb,… / …?q=Novinarski+dom,…` | **EN (1):** plexus-attend<br>**HR (0):** — | a href class="gt-map" target="_blank" rel="noopener" — "Open in Google Maps →" | "Open in Google Maps →" (`a.gt-map`) on the participant guide. |
| `https://www.facebook.com/profile.php?id=61554188818525` | **EN (29):** 404, about, accelerator-sponsor, accelerator, advisory-council, book-of-abstract, building-bridges-sponsor, building-bridges, bylaws, contact, donate, events, faq, footer, get-involved, index, network, plexus-attend, plexus-gala-sponsor, plexus-gala, plexus-sponsor, plexus, portal, press, privacy, refund, speakers, supporters, terms<br>**HR (22):** hr/about, hr/accelerator-sponsor, hr/accelerator, hr/advisory-council, hr/building-bridges, hr/bylaws, hr/contact, hr/donate, hr/events, hr/faq, hr/get-involved, hr/index, hr/plexus-attend, hr/plexus-gala-sponsor, hr/plexus-gala, hr/plexus-sponsor, hr/plexus, hr/portal, hr/press, hr/privacy, hr/speakers, hr/supporters | a href aria-label="Med and X na Facebooku"<br>a href aria-label="Med and X on Facebook"<br>a href aria-label="Med&X na Facebooku" — "Facebook"<br>a href aria-label="Med&X on Facebook" — "Facebook"<br>inline-script URL literal | Footer social icon + JSON-LD sameAs on every page. |
| `https://www.instagram.com/medx_association/` | **EN (29):** 404, about, accelerator-sponsor, accelerator, advisory-council, book-of-abstract, building-bridges-sponsor, building-bridges, bylaws, contact, donate, events, faq, footer, get-involved, index, network, plexus-attend, plexus-gala-sponsor, plexus-gala, plexus-sponsor, plexus, portal, press, privacy, refund, speakers, supporters, terms<br>**HR (22):** hr/about, hr/accelerator-sponsor, hr/accelerator, hr/advisory-council, hr/building-bridges, hr/bylaws, hr/contact, hr/donate, hr/events, hr/faq, hr/get-involved, hr/index, hr/plexus-attend, hr/plexus-gala-sponsor, hr/plexus-gala, hr/plexus-sponsor, hr/plexus, hr/portal, hr/press, hr/privacy, hr/speakers, hr/supporters | a href aria-label="Med and X na Instagramu"<br>a href aria-label="Med and X on Instagram"<br>a href aria-label="Med&X na Instagramu" — "Instagram"<br>a href aria-label="Med&X on Instagram" — "Instagram"<br>inline-script URL literal | Footer social icon + JSON-LD sameAs. |
| `https://www.linkedin.com/company/med-x-association/` | **EN (29):** 404, about, accelerator-sponsor, accelerator, advisory-council, book-of-abstract, building-bridges-sponsor, building-bridges, bylaws, contact, donate, events, faq, footer, get-involved, index, network, plexus-attend, plexus-gala-sponsor, plexus-gala, plexus-sponsor, plexus, portal, press, privacy, refund, speakers, supporters, terms<br>**HR (22):** hr/about, hr/accelerator-sponsor, hr/accelerator, hr/advisory-council, hr/building-bridges, hr/bylaws, hr/contact, hr/donate, hr/events, hr/faq, hr/get-involved, hr/index, hr/plexus-attend, hr/plexus-gala-sponsor, hr/plexus-gala, hr/plexus-sponsor, hr/plexus, hr/portal, hr/press, hr/privacy, hr/speakers, hr/supporters | a href aria-label="Med and X na LinkedInu"<br>a href aria-label="Med and X on LinkedIn"<br>a href aria-label="Med&X na LinkedInu" — "LinkedIn"<br>a href aria-label="Med&X on LinkedIn" — "LinkedIn"<br>inline-script URL literal | Footer social icon + JSON-LD sameAs. |
| `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…` | runtime on every page with `[data-cal-title]` (events, index, plexus, plexus-attend, plexus-gala, biomedical-forum, EN + HR) | `window.MedXCalendar` "Add to calendar — Google" | Prefilled Google Calendar event; the Apple/Outlook link is a same-page `blob:` .ics. |
| `https://fonts.googleapis.com/css2?family=Fraunces…&family=Inter…`, `https://fonts.gstatic.com` | every page (`head-links.html` partial) | `<link rel="preconnect">` + stylesheet | Web fonts. |
| `https://en.wikipedia.org/wiki/*`, `pmc.ncbi.nlm.nih.gov`, `nobelprize.org`, `hmmf.hazu.hr`, `tzdubrovnik.hr`, `my.clevelandclinic.org`, `wipo.int`, `encyclopedia.com` | heritage/index.html | source/reference links | Heritage micro-site citations. |
| `https://images.squarespace-cdn.com/*` (20), Croatian media hosts (poslovni.hr, tportal.hr, novilist.hr, index.hr, hrt.hr, slobodnadalmacija.hr, …) | `assets/media_curated.json`, `assets/photos/cdn/mapping.json` (data files only, not referenced by live markup) | legacy asset map | Squarespace-era image CDN references; no live page loads them. |
| Stripe (`checkout.stripe.com`) | never linked directly | reached only via the portal 303 | Donation checkout. |
| Brevo / Google Sheets / Vercel / Zoom / YouTube / Publer / Calendly / Eventbrite / Mailchimp | **none found** on any live page or in site.js | — | (Brevo appears only in the domain's SPF/TXT records; Vercel only as the DNS host.) |

### 1E. `mailto:` targets (5 distinct addresses, 143 anchors)

| Address | EN pages | HR pages | Subjects used (URL-encoded, deduplicated) |
|---|---|---|---|
| `info@medx.hr` | 29: 404, about, accelerator-sponsor, accelerator, advisory-council, book-of-abstract, building-bridges-sponsor, building-bridges, bylaws, contact, donate, events, faq, footer, get-involved, index, network, plexus-attend, plexus-gala-sponsor, plexus-gala, plexus-sponsor, plexus, portal, press, privacy, refund, speakers, supporters, terms | 24: hr/about, hr/accelerator-sponsor, hr/accelerator, hr/advisory-council, hr/building-bridges, hr/bylaws, hr/contact, hr/donate, hr/events, hr/faq, hr/get-involved, hr/index, hr/plexus-attend, hr/plexus-gala-sponsor, hr/plexus-gala, hr/plexus-sponsor, hr/plexus, hr/portal, hr/press, hr/privacy, hr/refund, hr/speakers, hr/supporters, hr/terms | Book%20of%20Abstracts<br>Hosting%20Med%26X%20Accelerator%20students<br>Press%20enquiry<br>Press%20kit%20request<br>Subscribe%20to%20Med%26X%20updates<br>Upit%20medija<br>Zahtjev%20za%20medijski%20paket |
| `president@medx.hr` | 13: about, advisory-council, biomedical-forum, building-bridges-sponsor, building-bridges, donate, faq, index, plexus-gala-sponsor, plexus-gala, plexus-sponsor, plexus, supporters | 11: hr/about, hr/advisory-council, hr/biomedical-forum, hr/building-bridges, hr/donate, hr/faq, hr/index, hr/plexus-gala-sponsor, hr/plexus-gala, hr/plexus-sponsor, hr/plexus | Biomedicinski%20forum%20%E2%80%94%20zamolba%20za%20razmatranje<br>Building%20Bridges%20%E2%80%94%20a%20custom%20partnership<br>Building%20Bridges%20%E2%80%94%20prilago%C4%91eno%20partnerstvo<br>Building%20Bridges%20partnership<br>Building%20Bridges%20partnerstvo<br>Naming%20an%20internship%20with%20Med%26X<br>Plexus%202026%20sponsorship<br>Plexus%20Conference%202026%20partnership<br>Plexus%20Gala%202026%20partnership<br>Sponsoring%20Med%26X<br>Sponsoring%20the%20Biomedical%20Forum<br>Sponsoring%20the%20Plexus%20Gala<br>Sponzoriranje%20Biomedicinskog%20foruma<br>Supporting%20Med%26X<br>The%20Biomedical%20Forum%20%E2%80%94%20request%20for%20consideration |
| `vp@medx.hr` | 2: about, index | 2: hr/about, hr/index | (no subject) |
| `pr@medx.hr` | 2: about, index | 2: hr/about, hr/index | (no subject) |
| `marija.pranjic@medx.hr` | 2: accelerator-sponsor, accelerator | 2: hr/accelerator-sponsor, hr/accelerator | Hosting%20Med%26X%20Accelerator%20participants<br>Med%26X%20Accelerator%20%E2%80%94%20question<br>Med%26X%20Accelerator%20%E2%80%94%20question%20about%20applying<br>Med%26X%20Accelerator%20%E2%80%94%20question%20for%20Marija<br>Med%26X%20Accelerator%20%E2%80%94%20upit<br>Med%26X%20Accelerator%20%E2%80%94%20upit%20o%20prijavi<br>Med%26X%20Accelerator%20%E2%80%94%20upit%20za%20Mariju<br>Med%26X%20Accelerator%20sponsorship<br>Podrska%20Med%26X%20Acceleratoru<br>Sponsoring%20a%20Med%26X%20Accelerator%20fellowship<br>Sponzoriranje%20Med%26X%20Accelerator%20stipendije<br>Supporting%20the%20Med%26X%20Accelerator<br>Ugoscivanje%20Med%26X%20Accelerator%20polaznika |

### 1F. Forms — all POST to Netlify Forms (`fetch('/', {method:'POST', 'application/x-www-form-urlencoded'})`), never to a portal

| Netlify form name | Pages (visible form) | Hidden registration stub | Fields | Submissions to date |
|---|---|---|---|---|
| `newsletter` | every full page (`<form data-mx-newsletter>`, 27 EN + 24 HR + 2 `home-nl-form`) | index, hr/index, events, hr/events | email, page, bot-field | 3 |
| `contact` | contact, hr/contact (`#contactForm`) | same pages | first, last, email, topic, message, page, bot-field | 0 |
| `support-inquiry` | donate, hr/donate (configurator step "Send my details / Request a partnership pack"), plexus-sponsor, plexus-gala-sponsor, accelerator-sponsor, building-bridges-sponsor (+ HR variants; `#inqForm data-program=…`) | 9 stubs | bot-field, role, designation, tier, next_step, call_window, name, organisation, email, message, summary | 0 |
| `forum-consideration` | biomedical-forum, hr/biomedical-forum (`#rcForm`) — **fallback only**, tried after `POST PORTAL/api/public/forum-consideration` | 4 stubs | name, email, institution, message, intent, page, bot-field | 0 |
| `dead-letter` | injected by site.js on any page with a portal-flow CTA when the portal is judged unreachable (`.mxdl-band`) | index, hr/index | name, email, intent, page, bot-field | 0 |

No `<form action>` points at either portal; the only portal-bound form-like write is the forum page's JSON `POST /api/public/forum-consideration` and the MedXBridge login `POST /api/auth/login`. The Netlify site has `processing_settings.ignore_html_forms=false` (forms enabled).

### 1G. Redirects and rewrites

| Source | Rule | Live result |
|---|---|---|
| `_redirects` (deployed, SHA 00d9f659…, identical to mirror) | `/hr/heritage → /heritage/?lang=hr 301`, `/hr/heritage/* → /heritage/?lang=hr 301`, `/hr/network → /network 301` | verified: 301 with those `Location`s |
| `netlify.toml` (deployed, SHA ed27a064…, 1,932 B; raw content not downloadable via API — the API returns the file-meta stub, as the `_DEPLOY_README.txt` warns) | unknown contents; observed effects: pretty URLs on (`/plexus`, `/donate?thanks=1` etc. serve the `.html`), custom `404.html` served with status 404 | behaves as expected |
| Netlify domain settings | primary `medx.hr`; `www.medx.hr` alias → 301 to apex; `force_ssl` true; `http://` → 301 https | verified |
| HTML stubs | `accelerator-news.html`, `impact.html`, `hr/impact.html`, `hr/accelerator-news.html`: `<meta http-equiv="refresh">` + `location.replace()` | 200 + client-side redirect |
| `window.location` / `window.open` in site.js | notification click-through (`notifTarget`), `warmAndGo` (disabled), calendar `blob:` download; donate.html `window.open(DONATE_CHECKOUT…)` | — |

### 1H. Per-page portal-link counts (raw string occurrences in live HTML)

| Page | user-portal | admin-portal | mailto | Google Form |
|---|---|---|---|---|
| 404 | 1 | 1 | 1 | 0 |
| about | 2 | 1 | 4 | 0 |
| accelerator-news | 0 | 0 | 0 | 0 |
| accelerator-sponsor | 2 | 1 | 6 | 0 |
| accelerator | 4 | 1 | 7 | 0 |
| advisory-council | 2 | 1 | 2 | 0 |
| biomedical-forum | 5 | 0 | 3 | 0 |
| book-of-abstract | 3 | 1 | 2 | 0 |
| building-bridges-sponsor | 2 | 1 | 5 | 0 |
| building-bridges | 2 | 1 | 4 | 1 |
| bylaws | 2 | 1 | 4 | 0 |
| contact | 2 | 1 | 3 | 0 |
| donate | 3 | 1 | 5 | 0 |
| events | 10 | 1 | 15 | 0 |
| faq | 4 | 1 | 11 | 0 |
| footer | 0 | 1 | 1 | 0 |
| get-involved | 5 | 1 | 1 | 0 |
| head-links | 0 | 0 | 0 | 0 |
| hr/about | 2 | 1 | 4 | 0 |
| hr/accelerator-news | 0 | 0 | 0 | 0 |
| hr/accelerator-sponsor | 2 | 1 | 5 | 0 |
| hr/accelerator | 4 | 1 | 7 | 0 |
| hr/advisory-council | 2 | 1 | 2 | 0 |
| hr/biomedical-forum | 5 | 0 | 3 | 0 |
| hr/building-bridges | 2 | 1 | 4 | 1 |
| hr/bylaws | 2 | 1 | 4 | 0 |
| hr/contact | 2 | 1 | 3 | 0 |
| hr/donate | 3 | 1 | 5 | 0 |
| hr/events | 10 | 1 | 15 | 0 |
| hr/faq | 4 | 1 | 13 | 0 |
| hr/get-involved | 5 | 1 | 1 | 0 |
| hr/impact | 0 | 0 | 0 | 0 |
| hr/index | 8 | 1 | 4 | 1 |
| hr/plexus-attend | 7 | 1 | 1 | 0 |
| hr/plexus-gala-sponsor | 2 | 1 | 6 | 0 |
| hr/plexus-gala | 5 | 1 | 2 | 0 |
| hr/plexus-sponsor | 2 | 1 | 5 | 0 |
| hr/plexus | 8 | 1 | 2 | 0 |
| hr/portal | 10 | 1 | 1 | 0 |
| hr/press | 2 | 1 | 5 | 0 |
| hr/privacy | 2 | 1 | 3 | 0 |
| hr/refund | 3 | 1 | 3 | 0 |
| hr/speakers | 2 | 1 | 1 | 0 |
| hr/supporters | 2 | 1 | 1 | 0 |
| hr/terms | 3 | 1 | 4 | 0 |
| impact | 0 | 0 | 0 | 0 |
| index | 8 | 1 | 4 | 1 |
| network | 4 | 1 | 1 | 0 |
| plexus-attend | 7 | 1 | 1 | 0 |
| plexus-gala-sponsor | 2 | 1 | 7 | 0 |
| plexus-gala | 5 | 1 | 2 | 0 |
| plexus-sponsor | 2 | 1 | 6 | 0 |
| plexus | 8 | 1 | 2 | 0 |
| portal | 10 | 1 | 1 | 0 |
| press | 2 | 1 | 5 | 0 |
| privacy | 2 | 1 | 3 | 0 |
| refund | 2 | 1 | 3 | 0 |
| speakers | 2 | 1 | 1 | 0 |
| supporters | 2 | 1 | 2 | 0 |
| terms | 2 | 1 | 4 | 0 |

(`heritage/index.html`, `assets/og-card.html`, `head-links.html` and the four redirect stubs carry no portal links; `footer.html` is a partial with the admin link only.)

### 1I. `site.js` hydration + bridge layer (read in full, 1,867 lines; live == mirror)

**Base URLs (three separate IIFEs each define them):** `PORTAL = https://medx-user-portal.onrender.com` (localhost → `http://localhost:3001`), `ADMIN = https://medx-admin-portal.onrender.com` (localhost → `http://localhost:3002`).

**Fetch plan (`MedXLive.fetchLive`, all `cache:'no-store'`, 4.5 s `AbortController` timeout each, every source fails soft to `null`):**
`PORTAL/api/public/site`, `PORTAL/api/public/content`, `PORTAL/api/public/status`, `ADMIN/api/public/press` (only if `[data-medx-list="press:releases"]` exists), `PORTAL/api/public/supporters` (only if `[data-medx-list="supporters:wall"]` exists). Three-tier never-blank: `localStorage.medx_live_cache` (SWR, instant paint) → live revalidate → baked HTML; the first visit seeds the cache from `data/site-snapshot.json`. A slot is only ever overwritten by a **non-empty** live value. Reachability flag `window.__MEDX_PORTAL_OK` + `medx:portal` event = (site || content || status answered).

**`data-medx-*` attributes and the `/api/public/*` field that feeds them**

| Attribute | Values found in live HTML (count) | Source field |
|---|---|---|
| `data-medx-slot="site:price.current"` (+ `data-medx-fmt="price"`) | 8 | `site.price.current` (server-derived from `pricing_phase`; currency from `site.price.currency`) → "EUR 150" / HR "150 EUR" |
| `data-medx-slot="site:conference.keynote_count_word"` | 6 | `site.conference.keynote_count_word` (HR pages: `keynote_count_word_hr`) |
| `data-medx-slot="site:conference.end_date"` (+ `fmt="date-long"`) | 6 | `site.conference.end_date` |
| `data-medx-slot="site:conference.date_range"` | 4 | `site.conference.date_range` (HR: recomputed from `start_date`/`end_date` with Croatian months) |
| `data-medx-slot="status:<plexus|gala|bridges|accelerator>.status_label"` / `.detail_line` | 2 each (16) | `status.projects[project_key].status_label` / `.detail_line` (HR pages read `status_label_hr` / `detail_line_hr` and keep baked text when those are empty — they are empty today) |
| `data-medx-slot="content:<homepage.news_banner|plexus.announcement|gala.announcement|bridges.announcement|accelerator.announcement>"` | 2 each (10) | `content.blocks[key].body` (HR: `body_hr`); `data-medx-html="1"` (2) allows sanitised `b/i/em/strong/br/a[http]` |
| `data-medx-slot="content:global.members_prompt"` | injected by MedXBridge members bar | `content.blocks['global.members_prompt'].body` |
| `data-medx-fmt` | `price` 8, `date-long` 6, `cap` 5, `raw` 4 | formatter switch |
| `data-medx-strip="<block key>"` + `data-medx-strip-x` | 10 + 10 | strip shown only when the block body is non-empty; dismissal stored in `medx_strip_dismissed` keyed by exact text |
| `data-medx-statusbar="<project>"`, `data-medx-status-dot`, `data-medx-status-cta` | 8 / 8 / 8 | `status.projects[].status_kind` → dot colour; `cta_label` (+`cta_label_hr`) → text; `cta_target` → href only via allow-list `CTA_ALLOW` (plexus, gala, accelerator, forum, bridges, attend, donate, events, about, network, get-involved, contact, speakers) or an absolute http(s) URL that is not the current page |
| `data-medx-list="site:speakers"` + `<template data-medx-item>` + `data-medx-list-target` + `data-mx-field="name|title|institution|talk_title|photo_url"` + `data-mx-keynote` + `data-mx-photo-fallback` | 6 lists | `site.speakers[]` (rendered only if every name is plausible; hidden while live keynote names == `data-medx-fallback-names` so the designed baked cards stay) |
| `data-medx-fallback="speakers"` + `data-medx-fallback-names="Lord Smith of Finsbury\|Johnese Spisso, MPA\|Dr Marcela del Carmen\|Dr Kevin Smith"` | 6 | drift detector vs live keynotes (matches today) |
| `data-medx-list="press:releases"` + `data-mx-date`, `data-mx-tag`, `data-mx-title`, `data-mx-summary`, `data-mx-url` | 2 (press, hr/press) | `press.releases[].{date_label,datetime|date,tag,title,summary,url,lang}` from **ADMIN** |
| `data-medx-list="supporters:wall"` + `data-sup-group="public-body|company"`, `data-sup-grid`, `data-sup-label`, `data-sup-tile`, `data-sup-name`, `data-sup-more`, `data-sup-logos-only="1"` | 4 walls (index + supporters, EN + HR); 78 tiles | `supporters.groups[].{key,label_en,label_hr,items[].{name,logo,website}}`; logo resolution prefers the baked local asset indexed by `data-sup-name`, else `items[].logo` (portal URL) |
| `data-medx-cta="register"` (+ runtime `data-medx-closed="1"`, `data-medx-href`) | 43 | `site.conference.registration_open === false` → CTA text "Registration closed", href stashed in `data-medx-href`, `aria-disabled` |
| `data-medx-reg="plexus-2026|plexus-gala-2026"` (+ optional `data-medx-reg-ticket`, unused) | 31 + 10 | deep-link builder (below); ticket param defaults to `site.conference.pricing_phase` |
| `data-medx-countdown="conference.start_date"` + `data-medx-countdown-time` | 2 | rewrites `[data-countdown]` and restarts `window.__medxStartCountdowns()` |
| `data-medx-jsonld="1"` | 2 | `startDate`/`endDate` in the JSON-LD script kept in step with `site.conference.*` |
| `data-mx-rendered="1"` | runtime marker | nodes rendered from live data (removed on re-render) |
| `data-mx-newsletter` | 50 forms | Netlify Forms submit handler (§1F) |
| `data-mx-members-signin`, `data-mx-members-dismiss`, `data-mx-guest`, `data-mx-close`, `data-mx-signout`, `data-mx-getapp`, `data-mx-admin`, `data-mx-warm-cancel` | runtime (MedXBridge / splash) | UI hooks |
| `data-cal-title`, `data-cal-start`, `data-cal-end`, `data-cal-time`, `data-cal-endtime`, `data-cal-location`, `data-cal-desc`, `data-cal-url`, `data-cal-lbl`, runtime `data-cal-ready` | 18 events | `MedXCalendar.build()` → `.ics` blob (UID `<slug>-<date>@medx.hr`, `TZID=Europe/Zagreb`) + Google Calendar template URL |
| `data-plx-rotate`, `data-plx-marquee` | 4 | purely visual (plexus page) |

**Storage keys used by site.js**

| Key | Store | Purpose |
|---|---|---|
| `medx_live_cache` | localStorage | `{data:{site,content,status,press,supporters}, at}` SWR cache |
| `medx_user_token` | localStorage | portal JWT from `/api/auth/login`; appended as `mxt` to deep links |
| `medx_user_data` | localStorage | JSON user object (`first_name`, `name`, `is_admin`) |
| `medx_session_expired` | localStorage | `'1'` after a server-confirmed 401/403 on an authenticated call ("your session expired" copy) |
| `medx_notif_read` | localStorage | array of read notification ids (local mirror) |
| `medx_notif_snooze` | localStorage | `{id: untilEpochMs}` (7-day snooze) |
| `medx_prompt_state` | localStorage | `{dismissCount, snoozedUntil, passiveLastShownAt}` — passive members bar at most once per 7 days, stops after 2 dismissals |
| `medx_strip_dismissed` | localStorage | `{blockKey: exactText}` |
| `medxLaureate`, `medxPlexusLive` | sessionStorage | easter-egg / live-day toast once per session |

**Warming splash / `/health` probe / "Opening the Med&X portal…" interceptor:** still present in site.js (`warmAndGo()`: overlay `.mx-warm-overlay`, title "Opening the Med&X portal…", sub "First load can take a moment", `fetch(origin+'/health',{mode:'no-cors'})` every 0.9 s up to 45 s, Escape/Cancel aborts) **but disabled**: `portalOrigin()` starts with `return null;` (comment dated 2026-08-02: portals are on always-on paid instances and the no-cors probe looped the overlay). The forum page's own copy (`fx-warm-overlay`, "Opening the door…") is disabled the same way (`var a = null`). Net effect: every portal link is a plain link today.

**Dead-letter capture (active):** on any page with a portal-flow CTA (`a[data-medx-reg]` or a user-portal href matching `/(apply|plexus|gala|register|donor|bridges|forum|mymedx|join)/`), if `__MEDX_PORTAL_OK===false` — or, after 6 s with no signal, a `mode:'cors'` `GET PORTAL/health` keeps failing for 16 s — an inline band ("The portal is taking a moment to open.") with a Netlify `dead-letter` form is inserted after the CTA's section.

**Intent interception (active):** a left-click on `a[data-medx-cta]` while logged out is intercepted → sign-in modal with context copy (`register`/`tickets`/`members`/`return`/`default`) and a "Continue as guest" link (`data-mx-guest`) carrying the CTA's own href, so registration is never blocked.

**Deep link builder (`mxRegUrl`):** `PORTAL + '/plexus?event=' + encodeURIComponent(event||'plexus-2026') [+ '&ticket=' + encodeURIComponent(ticket)] + '&from=website' [+ '&mxt=' + encodeURIComponent(localStorage.medx_user_token)]`; `ticket` = `a[data-medx-reg-ticket]` or `site.conference.pricing_phase` (live value today: `early_bird`). Re-stamped on every sign-in state change via `MedXLive.refreshLinks()`. Live probe of the resulting URL: 200.

**Donate-page toasts (`donate.html` / `hr/donate.html` inline, not site.js):** on load, `URLSearchParams` checks `thanks` → "Thank you — your gift is complete. A receipt is on its way to your inbox." / `cancelled` → "Checkout was cancelled — nothing was charged." / `checkout_error` → "Our checkout had a hiccup and nothing was charged. Please try again in a moment, or use the form below and we will follow up." (Croatian equivalents on `/hr/donate`), fixed toast for 9 s, then `history.replaceState` strips the query. Matches the portal's `success_url`/`cancel_url`/error redirect exactly (`https://medx.hr/donate?thanks=1` etc. — apex host, pretty URL; all three probed 200).

**Analytics beacon:** one `sendBeacon`/`fetch` POST per pageview to `PORTAL/api/public/pv` with `{path, ref}`; honours DNT/GPC; server drops bots and answers 204 with `CORP: cross-origin`.

---

## 2. LIVE PROBE TABLE

`curl -sS -m 90 -o /dev/null -w '%{http_code} %{redirect_url} %{time_total}s'`, plain GET, no `-L`, run 2026-08-28 ~21:43–21:55 UTC. Verdict legend: **OK** / **BROKEN** / **SUSPICIOUS** / **EXPECTED** (non-2xx that is the designed behaviour for a bare probe).

### 2A. Portal targets

| Target | Status | Redirect / body | Time | Verdict — reason |
|---|---|---|---|---|
| `https://medx-user-portal.onrender.com/` | 200 | text/html | 0.61 s | OK |
| `https://medx-user-portal.onrender.com/?mxt=probe` | 200 | text/html | — | OK (token ignored server-side for a bogus value) |
| `https://medx-user-portal.onrender.com/apply` | 200 | text/html | 0.35 s | OK |
| `https://medx-user-portal.onrender.com/plexus` | 200 | "Plexus 2026 — Reserve Your Place" | 0.17 s | OK |
| `https://medx-user-portal.onrender.com/plexus?event=plexus-2026&ticket=early_bird&from=website` | 200 | same page | 0.42 s | OK |
| `…/plexus?event=plexus-2026&ticket=early_bird&from=website&mxt=probe` | 200 | same page | 0.49 s | OK |
| `https://medx-user-portal.onrender.com/forum` | 200 | forum-wing.html | 0.19 s | OK |
| `https://medx-user-portal.onrender.com/donate/checkout?amount=50&frequency=once&designation=general` | **303** | `checkout.stripe.com` (`/c/pay/cs_live_…`) — not followed | 0.79 s | OK — `designation=general` is not in `DONATION_DESIGNATIONS`, server clamps to `unrestricted` |
| `https://medx-user-portal.onrender.com/donate/checkout?src=medx.hr` | 303 | `checkout.stripe.com` — not followed | 0.58 s | OK (defaults: 50 EUR, once, unrestricted) |
| `https://medx-user-portal.onrender.com/health` | 200 | `{"ok":true}` | 0.34 s | OK |
| `https://medx-user-portal.onrender.com/invite/probe` | 200 | "Invitation Not Valid — Med&X" page | 0.33 s | EXPECTED (bogus token → human notice page) |
| `https://medx-user-portal.onrender.com/pay/gala/probe` | 404 | "Invalid payment link — Med&X" page | 0.17 s | EXPECTED |
| `https://medx-user-portal.onrender.com/api/public/pv` (GET) | 404 | `{"error":"API endpoint not found"}` | 0.16 s | EXPECTED (POST-only beacon; OPTIONS preflight 204 — see 2C) |
| `https://medx-user-portal.onrender.com/api/public/forum-consideration` (GET) | 404 | JSON | 0.14 s | EXPECTED (POST-only) |
| `https://medx-user-portal.onrender.com/api/auth/login` (GET) | 404 | JSON | 0.29 s | EXPECTED (POST-only) |
| `https://medx-user-portal.onrender.com/api/bell-feed?limit=30` | 401 | `{"error":"Authentication required"}` | 0.14 s | EXPECTED |
| `https://medx-user-portal.onrender.com/api/me/next-event` | 401 | same | 0.16 s | EXPECTED |
| `https://medx-user-portal.onrender.com/api/user-notifications/` | 401 | same | 0.22 s | EXPECTED |
| `https://medx-admin-portal.onrender.com` (footer "Team sign-in") | 200 | text/html (`X-Robots-Tag: noindex`) | 0.86 s | OK |
| `https://medx-admin-portal.onrender.com/health` | 200 | `{"ok":true}` | 0.17 s | OK (no ACAO for medx.hr — unused by the site) |
| `https://medx-admin-portal.onrender.com/api/public/press/no-such-slug` | 404 | "This announcement is not available." | 0.15 s | EXPECTED |
| `https://medx-admin-portal.onrender.com/api/public/newsletter/subscribe` (GET) | 404 | — | 0.29 s | EXPECTED (POST-only; not used by the website — newsletter goes to Netlify Forms) |

### 2B. `/api/public/*` reads — status, CORS (GET with `Origin: https://www.medx.hr`), body keys

| Endpoint | GET | ACAO (Origin www) | ACAO (Origin apex) | ACAO (Origin evil.example) | Cache-Control | RateLimit | Top-level JSON keys | Verdict |
|---|---|---|---|---|---|---|---|---|
| user `/api/public/site` | 200, 0.39 s | `https://www.medx.hr` | `https://medx.hr` | none | **(none)** | (none) | `conference{name,year,slug,description,start_date,end_date,date_range,venue_name,venue_city,venue_country,registration_open,early_bird_deadline,regular_deadline,pricing_phase,keynote_count,keynote_count_word,keynote_count_word_hr}`, `price{early_bird,regular,late,current,currency}`, `deadline{early_bird,regular}`, `tickets[5]`, `speakers[4]`, `generated_at` | OK (note: the only public read without `publicLimiter`/cache headers, matches code) |
| user `/api/public/content` | 200, 0.16 s | www | apex | none | `public, max-age=60, stale-while-revalidate=300` | 120/min | `blocks{homepage.news_banner, plexus.announcement, gala.announcement, accelerator.announcement, forum.announcement, bridges.announcement, global.members_prompt}` (each `{type,body,body_hr,updated_at}`), `generated_at` | OK — all announcement bodies empty today; only `global.members_prompt` has text |
| user `/api/public/status` | 200, 0.30 s | www | apex | none | same | 120 | `projects[5]{project_key,status_label,status_kind,detail_line,cta_label,cta_target,status_label_hr,detail_line_hr,cta_label_hr,updated_at}`, `generated_at` | OK — `_hr` fields all null (HR pages keep baked text) |
| user `/api/public/supporters` | 200, 0.15 s | www | apex | none | same | 120 | `strings{hr,en}`, `groups[2]{key,label_hr,label_en,items[]}`, `count`=25, `generated_at` | OK — 14 logos on `medx-user-portal.onrender.com/assets/supporters/*` (see SUSPICIOUS row below) |
| user `/api/public/impact` | 200, 0.22 s | www | apex | — | same | 120 | `members`=56, `countries`=11, `registrations`=92, `events`=6, `speakers`=4, `charity_giving`=null, `generated_at` | OK but **unused by the live website** |
| admin `/api/public/press` | 200, 0.30 s | www | apex | none | same | 120 | `releases[]` (**empty**), `generated_at` | SUSPICIOUS — no published releases; press pages show baked cards only |
| admin `/api/public/content` | 200, 0.16 s | www | — | — | same | 120 | same block keys as user, **without `body_hr`** | OK (not used by the site; shape differs from the user copy despite the "byte-identical" code comment) |
| admin `/api/public/status` | 200, 0.16 s | www | — | — | same | 120 | `projects[5]` **without `_hr` fields** | OK (not used by the site) |
| user `/health` | 200 | www | apex | — | — | — | `{ok:true}` | OK |
| admin `/health` | 200 | **none** | **none** | — | — | — | `{ok:true}` | OK for uptime pings; would fail a browser CORS probe from medx.hr (only the disabled interceptor would care) |

All responses carry `Cross-Origin-Resource-Policy: same-origin`, `Vary: Origin`, helmet CSP, `server: cloudflare` (Render fronted by Cloudflare).

### 2C. OPTIONS preflight (`Origin: https://www.medx.hr`, `Access-Control-Request-Method: GET`)

| Endpoint | Status | ACAO | ACAM | Credentials |
|---|---|---|---|---|
| user `/health`, `/api/public/site`, `/content`, `/status`, `/supporters`, `/impact`, `/pv` | 204 | `https://www.medx.hr` | `GET,HEAD,PUT,PATCH,POST,DELETE` | — |
| user `/api/public/pv` with `Origin: https://medx.hr`, `ACRM: POST`, `ACRH: content-type` | 204 | `https://medx.hr` | same | `Access-Control-Allow-Headers: content-type` |
| admin `/api/public/press`, `/content`, `/status` | 204 | `https://www.medx.hr` | same | — |
| admin `/health` | 204 | **none** | same | `true` (global env-restricted policy) |

CORS verdict: **OK** for everything the website actually calls, for both the old `www` origin and the current apex origin. Allow-lists confirmed in code: user portal `cors({origin:[RENDER_EXTERNAL_URL,'https://medx.hr','https://www.medx.hr','https://medx-website-preview.netlify.app','https://medx-admin-portal.onrender.com','http://localhost:3000|3001|8899']})`; admin portal `app.use('/api/public', cors({origin:['https://medx-website-preview.netlify.app','https://www.medx.hr','https://medx.hr']}))` registered before the credentialed global policy.

### 2D. Website host, redirects, pretty URLs, exposure

| Target | Status | Redirect | Verdict — reason |
|---|---|---|---|
| `https://www.medx.hr/` | 301 | `https://medx.hr/` | OK (alias → primary); SUSPICIOUS only in that all canonicals/sitemap still name www |
| `https://medx.hr/` | 200 (`server: Netlify`, `cache-status: "Netlify Edge"`) | — | OK |
| `http://medx.hr/`, `http://www.medx.hr/` | 301 | https (www → https://www → https://apex, 2 hops) | OK |
| `https://medx-website-preview.netlify.app/` and `/plexus.html` | 200 | — (no redirect to primary) | SUSPICIOUS — duplicate host serving the full site |
| `https://medx.hr/donate`, `/donate?thanks=1`, `/donate?cancelled=1`, `/donate?checkout_error=1` | 200 | — | OK (Stripe return URLs resolve) |
| `https://medx.hr/plexus`, `/hr/plexus`, `/plexus-gala`, `/biomedical-forum`, `/events`, `/hr/biomedical-forum`, `/portal`, `/hr/portal`, `/press`, `/hr/press`, `/index.html` | 200 | — | OK (pretty URLs on) |
| `https://medx.hr/hr/heritage`, `/hr/heritage/x` | 301 | `/heritage/?lang=hr` | OK (`_redirects`) |
| `https://medx.hr/hr/network` | 301 | `/network` | OK |
| `https://medx.hr/heritage/`, `/heritage/?lang=hr` | 200 | — | OK |
| `https://heritage.medx.hr/` | **404** (`server: Vercel`) | — | **BROKEN** — DNS points at Vercel (64.29.17.65, 216.198.79.65); Netlify site `medx-heritage` (deploy 2026-07-11, 277 files, custom_domain set, `ssl:false`) never receives the traffic. Not linked from the website. |
| `https://medx.hr/impact`, `/accelerator-news` | 200 (meta-refresh stubs) | client-side → `/press.html`, `/accelerator.html` | OK |
| `https://medx.hr/no-such-page-xyz` | 404 (custom 404.html) | — | OK |
| `https://medx.hr/_redirects`, `/netlify.toml`, `/_DEPLOY_README.txt` | 404 | — | OK (not served) |
| `https://medx.hr/assemble_v2.py`, `/_shotplx.py`, `/_shotsec.py`, `/_shotvc.py`, `/scripts/build-snapshot.sh` | **200** (`text/x-python`, `application/x-sh`) | — | **SUSPICIOUS** — internal tooling shipped in the deploy digest (not linked anywhere) |
| `https://medx.hr/footer.html`, `/head-links.html` | 200 | — | OK (harmless partials) |
| `https://medx.hr/hr/site.js` | 404 | — | OK — HR pages load `/site.js` absolutely (24 pages); EN pages use relative `site.js` (27 pages) |
| `https://medx.hr/data/site-snapshot.json` | 200 (generated 2026-07-28, price regular=150) | — | OK as a seed; live `regular` is now 175 |
| `https://medx.hr/hr/data/site-snapshot.json` | 200 (generated **2026-07-03**, prices 150/200/250, `includes_gala=1`, 0 speakers) | — | SUSPICIOUS — stale HR seed fetched by every `/hr/` page (relative path); overridden by the live read |
| `https://medx-website-preview.netlify.app/assets/photos/kn_delcarmen.jpg` (speaker photo host in `/api/public/site`) | 200 image/jpeg | — | OK today; ties live speaker photos to the netlify.app host |
| `https://medx-user-portal.onrender.com/assets/supporters/sredisnji-drzavni-ured.png` (live supporter logo) | 200 image/png, `Cross-Origin-Resource-Policy: same-origin` | — | **SUSPICIOUS** — CORP blocks cross-origin `<img>` embedding from medx.hr; masked today because all 25 live supporters have a baked local tile |
| `https://www.medx.hr/assets/og-card.jpg` (og:image on every page) | 301 → `https://medx.hr/assets/og-card.jpg` (200 image/jpeg) | — | OK-ish — social scrapers must follow a redirect for the share image |

### 2E. Third-party targets

| Target | Status | Redirect | Verdict |
|---|---|---|---|
| GitHub `MedX-Member-1.1.0-mac-arm64.dmg` | 302 | `release-assets.githubusercontent.com/…` (signed, expiring) | OK |
| GitHub `MedX-Member-Setup-1.1.0-win.exe` (site.js overlay) | 302 | same host | OK |
| Google Form `1FAIpQLSdFmbM1Oje9AzJ6…` (Building Bridges pre-registration) | 200 | — | OK |
| `maps.google.com/?q=Hotel+Esplanade…`, `…Novinarski+dom…` | 302 | `maps.google.com/maps?q=…` | OK |
| `facebook.com/profile.php?id=61554188818525` | 301 | `facebook.com/people/MedX-Association/61554188818525/` | OK |
| `instagram.com/medx_association/` | 200 | — | OK |
| `linkedin.com/company/med-x-association/` | 999 | — | OK (LinkedIn anti-bot status for non-browser clients; not a dead link) |
| `calendar.google.com/calendar/render?action=TEMPLATE&text=…` | 200 | — | OK |
| `fonts.googleapis.com/css2?family=Fraunces…&family=Inter…` | 200 | — | OK |
| `en.wikipedia.org/wiki/Nikola_Tesla` (heritage sample) | 200 | — | OK |
| `mailto:` (5 addresses) | n/a | — | not probed (non-HTTP); `medx.hr` MX = `medx-hr.mail.protection.outlook.com`, SPF includes Outlook + Brevo |

**Totals:** 24 distinct website→portal targets (19 user-portal, 5 admin-portal) plus 1 netlify.app data dependency. Probed: every HTTP target above. **BROKEN: 1** (`heritage.medx.hr` → Vercel 404, Netlify-inventory level, not a website link). **SUSPICIOUS: 6** (www-host metadata vs apex primary; netlify.app duplicate host; exposed `.py`/`.sh` build scripts; empty admin press feed; CORP on portal-hosted supporter logos; stale HR snapshot). Everything the site actually fetches or links into the portals answered OK.

---

## 3. DNS + HOSTING TODAY (2026-08-28)

```
dig +short www.medx.hr CNAME   → medx-website-preview.netlify.app.
dig +short www.medx.hr A       → 98.84.224.111, 18.208.88.157   (via the CNAME)
dig +short www.medx.hr AAAA    → 2600:1f18:16e:df01::258, ::259
dig +short medx.hr A           → 75.2.60.5                      (Netlify apex load balancer)
dig +short medx.hr NS          → ns1.vercel-dns.com., ns2.vercel-dns.com.   (zone hosted at Vercel DNS)
dig +short medx.hr MX          → 0 medx-hr.mail.protection.outlook.com.
dig +short medx.hr TXT         → "v=spf1 include:spf.protection.outlook.com include:spf.brevo.com -all", "brevo-code:043fe38d…"
dig +short heritage.medx.hr A  → 64.29.17.65, 216.198.79.65    (Vercel anycast → 404 "server: Vercel")

curl -sI https://www.medx.hr   → HTTP/2 301, location: https://medx.hr/, server: Netlify, strict-transport-security: max-age=31536000, x-nf-request-id: 01M1551B…
curl -sI https://medx.hr       → HTTP/2 200, server: Netlify, cache-control: public,max-age=0,must-revalidate, cache-status: "Netlify Edge"; fwd=miss; fwd-status=200; stored
curl -sI http://medx.hr        → 301 → https://medx.hr/ (Server: Netlify)
```

**Confirmed:** still Netlify. Serving site = **`medx-website-preview`** (id `58a61ec7-6dce-440b-92a8-c37256e6ba28`, `custom_domain: medx.hr`, `domain_aliases: [www.medx.hr]`, `ssl_url: https://medx.hr`, `force_ssl: true`, `managed_dns: true` flag on the site object even though the authoritative NS is Vercel; Netlify's `dns_zones` endpoint lists only `lightkeeperstories.com`). The primary domain is the apex; `www` is a redirecting alias. `heritage.medx.hr` is the one Med&X hostname that does not reach Netlify.

---

## 4. NETLIFY ACCOUNT INVENTORY (GET only)

Account: **alen.juginovic27@gmail.com** — team "alen-juginovic27's team" (slug `alen-juginovic27`, plan Free). `GET /api/v1/user` reports `site_count: 291`; `GET /sites?per_page=100&page=1..4` returned 100 + 100 + 91 + 0 = **291 unique sites**. Every site object already carries `processing_settings`, so `pretty_urls` below comes from the list payload (the website site was additionally fetched via `GET /sites/{id}`).

Custom domains in the account (4): `medx.hr` (+www) → medx-website-preview · `heritage.medx.hr` → medx-heritage (ssl false, DNS not pointed) · `spavajbolje.com` (+www) → spavajbolje · `lightkeeperstories.com` (+www) → lightkeeper-preview.

### 4A. The site serving medx.hr — `medx-website-preview`

| Field | Value |
|---|---|
| id | `58a61ec7-6dce-440b-92a8-c37256e6ba28` |
| name | medx-website-preview |
| created_at | 2026-06-27T00:27:16.369Z |
| ssl_url / url | https://medx.hr / https://medx.hr |
| custom_domain / aliases | medx.hr / ['www.medx.hr'] |
| default_domain | medx-website-preview.netlify.app (serves the site with 200, no redirect) |
| admin_url | https://app.netlify.com/projects/medx-website-preview |
| plan / account | nf_team_dev / alen-juginovic27 |
| state | current |
| processing_settings | `{"html": {"pretty_urls": true}, "ignore_html_forms": false}` → pretty URLs **on**, HTML form detection **on** |
| build_settings | `{}` (no repo, no build command — digest/drag-and-drop deploys only) |
| force_ssl / ssl | True / True |
| managed_dns | True |
| functions_region | us-east-2 |
| published_deploy | `6a8b1da6c99824645d697fdf` state=ready created=2026-08-23T16:19:50.180Z published=2026-08-23T16:19:52.729Z branch=main context=production title=None |
| deployed files | 416 (62 HTML, `/netlify.toml` sha ed27a064… 1,932 B, `/_redirects` sha 00d9f659… 178 B, no `/_headers`; also `/assemble_v2.py`, `/_shot*.py`, `/scripts/build-snapshot.sh` — see §2D) |

**Recent deploys (`GET /sites/{id}/deploys?per_page=15`, pages 1–3 fetched = 24 deploys back to 2026-07-06)** — newest first. The 07-31 mirror's content equals the newest deploy (see §0.1). All 15 deploys created after 2026-07-31 are listed, followed by the five deploys of 2026-07-31 itself (the mirror day):

| Deploy id | State | Created (UTC) | Published (UTC) | Title | Deploy time |
|---|---|---|---|---|---|
| `6a8b1da6c99824645d697fdf` | ready | 2026-08-23T16:19:50.180Z | 2026-08-23T16:19:52.729Z | — | 2 s |
| `6a8b0df49f17279e0feb61bf` | ready | 2026-08-23T15:12:52.366Z | 2026-08-23T15:12:55.101Z | — | 2 s |
| `6a77b0c9ffc8a6bc37c5b911` | ready | 2026-08-08T22:42:17.194Z | 2026-08-08T22:42:19.969Z | — | 2 s |
| `6a77b09ab8374a68ed8e071f` | ready | 2026-08-08T22:41:30.884Z | 2026-08-08T22:41:42.338Z | — | 11 s |
| `6a777af0dc70693250e7744e` | ready | 2026-08-08T18:52:32.609Z | 2026-08-08T18:52:34.516Z | — | 1 s |
| `6a775eb9ced126fd75f8ce96` | ready | 2026-08-08T16:52:09.296Z | 2026-08-08T16:52:13.211Z | — | 3 s |
| `6a76647d821d4e689ef2b222` | ready | 2026-08-07T23:04:29.967Z | 2026-08-07T23:04:36.419Z | — | 6 s |
| `6a765148099a2bf9404a82fb` | ready | 2026-08-07T21:42:32.826Z | 2026-08-07T21:42:48.201Z | — | 15 s |
| `6a762aaac56797e53fe8e474` | ready | 2026-08-07T18:57:46.060Z | 2026-08-07T18:58:13.189Z | — | 27 s |
| `6a76086edc7069117ae77306` | ready | 2026-08-07T16:31:42.162Z | 2026-08-07T16:31:45.444Z | — | 3 s |
| `6a75e5b0af1df6e8d462657b` | ready | 2026-08-07T14:03:28.664Z | 2026-08-07T14:03:31.207Z | — | 2 s |
| `6a6fdbc2628867bfec4a8233` | ready | 2026-08-03T00:07:30.657Z | 2026-08-03T00:07:32.090Z | — | 1 s |
| `6a6fd382e78e89a6a3f12cf3` | ready | 2026-08-02T23:32:19.013Z | 2026-08-02T23:32:20.202Z | — | 1 s |
| `6a6fd1dda54bae86316aa99c` | ready | 2026-08-02T23:25:17.986Z | 2026-08-02T23:25:19.863Z | — | 1 s |
| `6a6e1be840083daee41c73c3` | ready | 2026-08-01T16:16:40.847Z | 2026-08-01T16:16:42.788Z | — | 1 s |
| `6a6d1b3e5584ba352daf7853` | ready | 2026-07-31T22:01:34.405Z | 2026-07-31T22:01:35.322Z | — | 0 s |
| `6a6d1adc41c50632efe4a62b` | ready | 2026-07-31T21:59:56.697Z | 2026-07-31T22:00:14.016Z | — | 17 s |
| `6a6d0a9f00dc7c2f6cfd0315` | ready | 2026-07-31T20:50:39.733Z | 2026-07-31T20:50:41.351Z | — | 1 s |
| `6a6cfcfe40083d06a41c713a` | ready | 2026-07-31T19:52:30.382Z | 2026-07-31T19:52:34.129Z | — | 3 s |
| `6a6cb41970384330335d8e2c` | ready | 2026-07-31T14:41:29.690Z | 2026-07-31T14:41:31.317Z | — | 1 s |

(The four deploy ids named in the brief all exist on this site: `6a6d1adc41c50632efe4a62b` published 2026-07-31T22:00:14Z and `6a6d1b3e5584ba352daf7853` published 2026-07-31T22:01:35Z are the last two deploys of the mirror day; `6a6fd1dda54bae86316aa99c` (2026-08-02) and `6a775eb9ced126fd75f8ce96` (2026-08-08) are among the 15 later ones. All are superseded by `6a8b1da6c99824645d697fdf` (2026-08-23), whose content the mirror folder matches byte for byte.)

**Netlify Forms registered on this site (`GET /sites/{id}/forms`):**

| Form | id | Fields | Submissions | Created |
|---|---|---|---|---|
| `contact` | `6a4c1096078532000808fdc9` | first, last, email, topic, message, page, bot-field | 0 | 2026-07-06T20:31:18.659Z |
| `support-inquiry` | `6a4c1096078532000808fdc3` | bot-field, role, designation, tier, next_step, call_window, name, organisation, email, message, summary | 0 | 2026-07-06T20:31:18.552Z |
| `forum-consideration` | `6a4c1096078532000808fdc1` | name, email, institution, message, intent, page, bot-field | 0 | 2026-07-06T20:31:18.506Z |
| `dead-letter` | `6a4c1096078532000808fdbf` | name, email, intent, page, bot-field | 0 | 2026-07-06T20:31:18.493Z |
| `newsletter` | `6a4c1096078532000808fdb9` | email, page, bot-field | 3 | 2026-07-06T20:31:18.345Z |

### 4B. Med&X-related sites (28 of 291; matched on name/domain: medx*, plexus*, spiffy-crostata, loquacious-truffle, merch, tables, forum, bridges, heritage, kontakti, liata, speaker, registration, jersey/auction, fundraiser, sponsorship)

| name | id | ssl_url | custom_domain | published_at | updated_at | repo_url | pretty_urls |
|---|---|---|---|---|---|---|---|
| medx-website-preview | `58a61ec7-6dce-440b-92a8-c37256e6ba28` | https://medx.hr | medx.hr (+ www.medx.hr) | 2026-08-23T16:19:52.729Z | 2026-08-23T16:19:52.830Z | — | True |
| medx-admin-portal-review | `0261b147-f152-4021-b1fd-1ea8a0998161` | https://medx-admin-portal-review.netlify.app | — | 2026-08-20T15:52:06.498Z | 2026-08-20T15:52:15.221Z | — | False |
| medx-member-portal-review | `66cb26d8-72ff-403f-87d4-153bcaead792` | https://medx-member-portal-review.netlify.app | — | 2026-08-20T15:51:55.616Z | 2026-08-20T15:51:59.652Z | — | False |
| plexus-flight-brief | `957be126-3672-48c6-9ab0-6dbf3ab99a84` | https://plexus-flight-brief.netlify.app | — | 2026-08-19T15:57:37.205Z | 2026-08-19T15:57:42.200Z | — | True |
| loquacious-truffle-0392b5 | `dc07908e-ed69-40e8-8d81-c855df9e7f6b` | https://loquacious-truffle-0392b5.netlify.app | — | 2026-08-13T15:00:09.009Z | 2026-08-13T15:00:16.935Z | — | True |
| spiffy-crostata-b8882f | `9aedc70a-11b3-4edc-80f8-27d51614ea8e` | https://spiffy-crostata-b8882f.netlify.app | — | 2026-08-10T21:45:04.249Z | 2026-08-10T21:45:19.486Z | — | True |
| medx-merch-print | `1faaa206-8cf6-401f-ad9c-967e7d6ca5a6` | https://medx-merch-print.netlify.app | — | 2026-07-28T05:32:20.077Z | 2026-07-28T05:32:27.736Z | — | True |
| medx-fundraiser-26 | `470b5f65-e266-41a5-8947-ffefd107d2b8` | https://medx-fundraiser-26.netlify.app | — | 2026-07-26T17:51:01.147Z | 2026-07-26T17:51:11.815Z | — | True |
| medx-sponsorship-2026 | `11c74fdc-f83c-4b7c-8a60-42a7f46cad63` | https://medx-sponsorship-2026.netlify.app | — | 2026-07-26T17:50:55.866Z | 2026-07-26T17:51:07.009Z | — | True |
| plexus-tables | `eb80bcc2-f7f5-4c4f-820c-956d4f18e939` | https://plexus-tables.netlify.app | — | 2026-07-24T16:50:26.607Z | 2026-07-24T16:50:37.576Z | — | True |
| medx-heritage | `579eff28-1598-4825-acef-a7f06ff28276` | https://heritage.medx.hr | heritage.medx.hr | 2026-07-11T04:49:51.661Z | 2026-07-11T05:23:40.223Z | — | True |
| medx-forum-preview | `d0bd6c08-6fa0-4350-a72e-4e09b49f5f9b` | https://medx-forum-preview.netlify.app | — | 2026-07-05T15:47:07.959Z | 2026-07-05T15:47:11.546Z | — | True |
| medx-merch-studio | `a0fef7fa-fd49-4b32-b48f-0305bc6ef3a6` | https://medx-merch-studio.netlify.app | — | 2026-07-04T03:36:04.167Z | 2026-07-04T03:36:04.237Z | — | True |
| buildingbridges-dc | `ccaeb780-75d5-4d09-8c86-8ee1e80b312b` | https://buildingbridges-dc.netlify.app | — | 2026-02-24T03:51:52.062Z | 2026-02-24T03:52:40.684Z | — | True |
| medx-portal-demo | `f74943de-6b17-45b6-8cfc-d6dd19b5bd08` | https://medx-portal-demo.netlify.app | — | 2026-02-11T07:58:19.600Z | 2026-02-11T07:58:30.167Z | — | True |
| kontakti-medicinske-institucije | `6583ecb7-8542-4b7e-9ea7-3bbb861172fe` | https://kontakti-medicinske-institucije.netlify.app | — | 2026-02-07T21:19:47.120Z | 2026-02-07T21:19:56.127Z | — | True |
| liata-predavaca | `d15c56ba-a405-492d-9d83-67c190fee0b1` | https://liata-predavaca.netlify.app | — | 2026-02-05T06:57:30.864Z | 2026-02-05T06:57:48.180Z | — | True |
| speaker-invitation-plexus26 | `41ab9a28-4d97-48da-8be5-c9960ccb3706` | https://speaker-invitation-plexus26.netlify.app | — | 2026-02-03T06:41:50.493Z | 2026-02-03T06:42:01.741Z | — | True |
| medx-2026 | `badc0214-f872-4b6b-85a7-c6326ff4180a` | https://medx-2026.netlify.app | — | 2026-02-03T06:29:42.736Z | 2026-02-03T06:29:52.181Z | — | True |
| medx-overview1 | `18413a27-f3b6-4527-89de-122978c3b231` | https://medx-overview1.netlify.app | — | 2026-01-28T14:36:33.869Z | 2026-01-28T14:39:00.209Z | — | True |
| medx-overview | `7a85a38b-50d0-4cde-ad4e-33f474e74fd7` | https://medx-overview.netlify.app | — | 2026-01-27T17:58:06.352Z | 2026-01-27T17:58:45.027Z | — | True |
| plexus26-timeline | `3be6cab3-ac85-4216-9785-4af20e37dbb0` | https://plexus26-timeline.netlify.app | — | 2026-01-19T01:37:25.862Z | 2026-01-19T01:37:35.625Z | — | True |
| medxmerch | `9c88f17e-00a6-49a8-925c-13272482b1e5` | https://medxmerch.netlify.app | — | 2026-01-12T02:37:07.672Z | 2026-01-12T02:37:34.911Z | — | True |
| jersey-auction | `7ec6dfb2-cb69-4bc9-9013-0f58cc31c30e` | https://jersey-auction.netlify.app | — | 2025-12-04T11:22:55.268Z | 2025-12-04T11:25:24.768Z | — | True |
| plexus-registrations | `6c24ce24-db57-4eae-a5d7-bced56ca03da` | https://plexus-registrations.netlify.app | — | 2025-11-14T23:11:32.685Z | 2025-11-14T23:13:32.424Z | — | True |
| registration-plexus | `736637f4-a7b0-4942-a53d-051b1506ce31` | https://registration-plexus.netlify.app | — | 2025-11-14T22:59:17.968Z | 2025-11-14T22:59:49.701Z | — | True |
| plexusregistrationlink | `56eb5f7a-130f-443d-bc23-8e5e5377e0b2` | https://plexusregistrationlink.netlify.app | — | 2025-11-14T22:40:29.346Z | 2025-11-14T22:43:00.343Z | — | True |
| plexusregistration | `107b58c0-8626-49a2-9d6f-5bc1fbf05527` | https://plexusregistration.netlify.app | — | 2025-10-10T04:46:50.218Z | 2025-10-29T13:52:03.710Z | — | True |

Notes on the Med&X set: `medx-admin-portal-review` / `medx-member-portal-review` (2026-08-20) are the static review copies for the August portal review cycle; `spiffy-crostata-b8882f` (08-10) and `loquacious-truffle-0392b5` (08-13) are unnamed Med&X deliverable sites; `plexus-tables` = the Esplanade ballroom/table planner (the admin portal's seating links point at `https://plexus-tables.netlify.app/?t=<token>`); `medx-merch-studio` / `medx-merch-print` / `medxmerch` = merch work; `medx-heritage` is orphaned by DNS (§3); `medx-portal-demo`, `medx-2026`, `medx-overview*`, `plexus26-timeline`, `speaker-invitation-plexus26`, `liata-predavaca`, `kontakti-medicinske-institucije`, `buildingbridges-dc`, `jersey-auction`, `medx-forum-preview`, `plexus-flight-brief`, `medx-fundraiser-26`, `medx-sponsorship-2026` and the four Nov-2025/Oct-2025 `plexus*registration*` sites are earlier one-offs; none of them is referenced by the live website.

### 4C. Unrelated sites (263) — personal / other projects

| name | id | ssl_url | custom_domain | published_at | updated_at | repo_url | pretty_urls |
|---|---|---|---|---|---|---|---|
| pf-74c64d59-tracker | `f6ca9f38-08aa-4877-b889-64e42ba0350a` | https://pf-74c64d59-tracker.netlify.app | — | 2026-08-28T20:40:00.716Z | 2026-08-28T20:40:10.647Z | — | True |
| lightkeeper-preview | `a9a8d227-b701-4f35-ac25-78d6636fd8f3` | https://lightkeeperstories.com | lightkeeperstories.com (+ www.lightkeeperstories.com) | 2026-08-28T15:18:37.529Z | 2026-08-28T15:18:46.677Z | — | True |
| spavaj-bolje-redesign | `ac55d800-9c62-4984-b18c-68928be485a0` | https://spavaj-bolje-redesign.netlify.app | — | 2026-08-21T04:40:09.179Z | 2026-08-21T04:40:13.776Z | — | True |
| debe-uci-engleski | `d08cf339-bd5d-4765-ace7-8cacac539c60` | https://debe-uci-engleski.netlify.app | — | 2026-08-16T15:47:13.571Z | 2026-08-16T15:47:18.122Z | — | True |
| ipo-field-guide-4159f1ca | `bf9ff8c3-6d38-4de4-bacb-059bf3b9cb24` | https://ipo-field-guide-4159f1ca.netlify.app | — | 2026-07-23T04:59:59.647Z | 2026-07-23T05:00:04.421Z | — | True |
| palatium-diocletiani | `74af31b5-0fec-429c-8b4b-ea5234f96f75` | https://palatium-diocletiani.netlify.app | — | 2026-07-14T04:30:34.409Z | 2026-07-14T04:30:42.925Z | — | True |
| sleep-wellness | `2c9b75a4-196e-4ed1-924c-5b32f7dac865` | https://sleep-wellness.netlify.app | — | 2026-07-07T20:19:20.767Z | 2026-07-07T20:19:30.727Z | — | True |
| spavajbolje | `ac75867d-2909-4a99-9d6d-2ebdb4b7008c` | https://spavajbolje.com | spavajbolje.com (+ www.spavajbolje.com) | 2026-07-06T23:56:59.722Z | 2026-07-06T23:57:03.995Z | — | True |
| mellow-genie-e9424a | `b1549908-a521-4291-983a-cadf2736fa57` | https://mellow-genie-e9424a.netlify.app | — | 2026-06-12T14:56:30.125Z | 2026-06-12T14:56:36.737Z | — | True |
| effulgent-nougat-384464 | `5567e651-f490-46d1-9fee-275005880d6d` | https://effulgent-nougat-384464.netlify.app | — | 2026-06-12T14:56:00.576Z | 2026-06-12T14:56:07.520Z | — | True |
| dazzling-naiad-bcb6ca | `7185ae00-5bbb-4575-9edb-586a6fd12daf` | https://dazzling-naiad-bcb6ca.netlify.app | — | 2026-06-12T11:33:47.106Z | 2026-06-12T11:33:56.390Z | — | True |
| benevolent-cascaron-071f0d | `beec6dea-cb9f-4113-8016-e7cdc7fd4c8d` | https://benevolent-cascaron-071f0d.netlify.app | — | 2026-06-09T08:42:49.282Z | 2026-06-09T08:42:53.255Z | — | True |
| willowy-selkie-09fe26 | `be775cfc-d65c-46f2-9f70-1b4a9233de2b` | https://willowy-selkie-09fe26.netlify.app | — | 2026-06-09T08:24:39.134Z | 2026-06-09T08:24:42.461Z | — | True |
| aesthetic-arithmetic-b63c48 | `5a67bb02-f62a-4012-8b0f-722590ef9002` | https://aesthetic-arithmetic-b63c48.netlify.app | — | 2026-06-09T08:23:27.686Z | 2026-06-09T08:24:25.855Z | — | True |
| heartfelt-empanada-7498a5 | `0d500293-ab0f-4c3c-8146-75760e5a04ff` | https://heartfelt-empanada-7498a5.netlify.app | — | 2026-04-27T00:56:19.991Z | 2026-04-27T00:56:23.543Z | — | True |
| san-app | `195c2080-ed65-4a62-b972-a111a2cbff26` | https://san-app.netlify.app | — | 2026-03-09T13:50:09.821Z | 2026-03-09T13:50:14.169Z | — | True |
| somnia-app | `94058db1-f6a5-4a96-9fa1-0d716a33f888` | https://somnia-app.netlify.app | — | 2026-03-08T06:37:08.590Z | 2026-03-08T06:37:14.089Z | — | True |
| sleep-one-app | `ceb07d07-9fdc-43ae-9153-6afadbec3152` | https://sleep-one-app.netlify.app | — | 2026-02-20T07:40:08.903Z | 2026-02-28T07:10:43.820Z | — | True |
| sleep-wellness-portal | `1707b253-0d84-411c-b906-5ae018700241` | https://sleep-wellness-portal.netlify.app | — | 2026-02-20T08:29:19.750Z | 2026-02-20T08:29:23.207Z | — | True |
| effulgent-speculoos-30522e | `87425b34-89f4-4556-a650-4cd37b985348` | https://effulgent-speculoos-30522e.netlify.app | — | — (never published) | 2026-02-20T08:27:34.565Z | — | True |
| circadian-app | `13474c78-bf79-4d7e-b3ff-c16f68987dcc` | https://circadian-app.netlify.app | — | 2026-02-20T07:31:05.508Z | 2026-02-20T07:31:14.956Z | — | True |
| myelinres | `37349385-b957-4a55-82d2-a07b84aa06fd` | https://myelinres.netlify.app | — | 2026-02-12T10:58:09.349Z | 2026-02-12T10:58:15.465Z | https://github.com/alen-ops99/myelin-paper-tracker | True |
| myelinresearch | `af2fa629-e5f6-473d-8061-ec51b0c500f7` | https://myelinresearch.netlify.app | — | 2026-02-12T10:57:50.730Z | 2026-02-12T10:57:59.907Z | https://github.com/alen-ops99/myelin-paper-tracker | True |
| calm-kangaroo-076007 | `157659f9-d444-4776-8a84-e6a33a25e058` | https://calm-kangaroo-076007.netlify.app | — | 2026-02-10T04:59:37.567Z | 2026-02-10T04:59:46.966Z | — | True |
| cheerful-bienenstitch-f787f6 | `be8dcdc4-bf9c-47b6-9e68-b576b3bfb39d` | https://cheerful-bienenstitch-f787f6.netlify.app | — | 2026-02-05T15:57:41.510Z | 2026-02-05T15:57:44.779Z | — | True |
| chic-kulfi-dd4eac | `67188e69-93ff-471e-9cc5-c4694721a403` | https://chic-kulfi-dd4eac.netlify.app | — | 2026-02-03T06:48:16.602Z | 2026-02-03T06:48:25.708Z | — | True |
| fascinating-gumdrop-08bcad | `bf602dda-b4e7-4cd4-af59-b43b5617622b` | https://fascinating-gumdrop-08bcad.netlify.app | — | 2026-02-03T06:29:32.814Z | 2026-02-03T06:29:38.585Z | — | True |
| frolicking-quokka-7551f9 | `7a43d839-d38a-4048-983a-78970b752d7e` | https://frolicking-quokka-7551f9.netlify.app | — | 2026-02-03T06:11:53.454Z | 2026-02-03T06:11:57.372Z | — | True |
| thriving-naiad-7a7eff | `4d9debb7-09d9-4ab5-bc98-b99257444bd6` | https://thriving-naiad-7a7eff.netlify.app | — | 2026-02-02T19:56:36.475Z | 2026-02-02T19:56:50.102Z | — | True |
| visionary-pavlova-c10ff3 | `7fd40b55-f0d8-4aa0-8d3f-4e180914d619` | https://visionary-pavlova-c10ff3.netlify.app | — | 2026-02-02T19:56:28.519Z | 2026-02-02T19:56:28.571Z | — | True |
| astonishing-unicorn-e492c2 | `3c29658a-d453-4e69-99ed-b155f38a5aea` | https://astonishing-unicorn-e492c2.netlify.app | — | 2026-02-02T15:47:20.796Z | 2026-02-02T15:47:30.905Z | — | True |
| luminous-empanada-6ffe7e | `67bd8e98-9ffb-4065-966f-92104ff1641f` | https://luminous-empanada-6ffe7e.netlify.app | — | 2026-01-31T13:32:06.777Z | 2026-01-31T13:32:12.279Z | — | True |
| alen-shopping | `d8048e25-6cea-466c-a89c-57c757268407` | https://alen-shopping.netlify.app | — | 2026-01-29T01:50:22.598Z | 2026-01-29T01:50:30.942Z | — | True |
| luminous-praline-a4dd44 | `b0377356-7091-4ac6-9b89-cb9d230255a6` | https://luminous-praline-a4dd44.netlify.app | — | 2026-01-28T06:26:06.458Z | 2026-01-28T06:26:12.566Z | — | True |
| rad-sable-0e1e52 | `6a055196-e77f-4aa2-b24b-d6c67503ca7b` | https://rad-sable-0e1e52.netlify.app | — | 2026-01-26T00:53:39.849Z | 2026-01-26T00:53:45.078Z | — | True |
| chic-mochi-0abd2b | `f9b50815-ea84-446c-8ed1-8187c20851da` | https://chic-mochi-0abd2b.netlify.app | — | 2026-01-26T00:52:06.710Z | 2026-01-26T00:52:11.228Z | — | True |
| heartfelt-sfogliatella-a633aa | `bcdc8ed9-38f8-487b-b55b-0d66a0897755` | https://heartfelt-sfogliatella-a633aa.netlify.app | — | 2026-01-26T00:16:40.333Z | 2026-01-26T00:16:50.075Z | — | True |
| alensshopping | `3e392b9e-d49a-442b-8f1e-39b0cc7fefcb` | https://alensshopping.netlify.app | — | 2026-01-26T00:11:59.293Z | 2026-01-26T00:12:14.892Z | — | True |
| alenshopping | `904feae5-264e-4e62-a4f0-9fc1f6e42f26` | https://alenshopping.netlify.app | — | 2026-01-26T00:09:10.631Z | 2026-01-26T00:09:17.531Z | — | True |
| candid-ganache-3ffc14 | `b15a407d-2a8a-4d96-bfff-1d5760bc15d0` | https://candid-ganache-3ffc14.netlify.app | — | 2026-01-24T18:23:44.832Z | 2026-01-24T18:23:49.740Z | — | True |
| beautiful-jalebi-77fe08 | `c79eeba5-4a38-49bc-a0cc-628c2dbe8e1d` | https://beautiful-jalebi-77fe08.netlify.app | — | 2026-01-19T16:31:22.529Z | 2026-01-19T16:31:22.582Z | — | True |
| venerable-eclair-3e4518 | `fc40dcf3-6224-4cd4-9936-79ba8c7a4eb8` | https://venerable-eclair-3e4518.netlify.app | — | 2026-01-13T01:02:35.921Z | 2026-01-13T01:02:41.695Z | — | True |
| thriving-paletas-9d59f3 | `94218e58-9a20-4989-9af8-19786376e4f4` | https://thriving-paletas-9d59f3.netlify.app | — | 2026-01-13T00:57:49.694Z | 2026-01-13T00:57:57.930Z | — | True |
| earnest-sunflower-2a6473 | `7ecca69e-6194-42ee-a5fa-616ed99633cf` | https://earnest-sunflower-2a6473.netlify.app | — | 2026-01-13T00:32:41.511Z | 2026-01-13T00:32:46.932Z | — | True |
| vermillion-cranachan-3d18b4 | `ec660e48-d750-46e9-9744-56b630d0a2a4` | https://vermillion-cranachan-3d18b4.netlify.app | — | 2025-12-06T15:55:47.515Z | 2025-12-06T15:55:52.258Z | — | True |
| harmonious-souffle-609d1c | `f05033b3-03fd-405e-8070-66fb2dc1d59d` | https://harmonious-souffle-609d1c.netlify.app | — | 2025-12-04T11:13:17.666Z | 2025-12-04T11:13:20.666Z | — | True |
| chipper-marshmallow-71ec9d | `bcb00382-c1da-4461-bf2c-fb1448fa7cc1` | https://chipper-marshmallow-71ec9d.netlify.app | — | — (never published) | 2025-12-04T10:46:29.391Z | — | True |
| bejewelled-cheesecake-137819 | `bcf81d75-1f77-4f5a-9421-b7ede8363c99` | https://bejewelled-cheesecake-137819.netlify.app | — | 2025-11-14T22:39:28.421Z | 2025-11-14T22:39:32.162Z | — | True |
| sweet-crepe-72541c | `a5149b0b-534c-4d9e-955f-50db6f0519e5` | https://sweet-crepe-72541c.netlify.app | — | 2025-11-14T22:37:24.213Z | 2025-11-14T22:37:32.623Z | — | True |
| regal-muffin-cb94f1 | `a417aec8-0d62-4827-a79f-49eb1ed18236` | https://regal-muffin-cb94f1.netlify.app | — | 2025-11-14T22:35:05.081Z | 2025-11-14T22:35:12.025Z | — | True |
| resplendent-eclair-8026d1 | `53e138bb-92cf-4b20-9bbf-2968eb480f58` | https://resplendent-eclair-8026d1.netlify.app | — | 2025-11-14T22:23:18.372Z | 2025-11-14T22:23:26.879Z | — | True |
| gregarious-marzipan-d58433 | `7321e15b-b9e1-4d83-9644-c34e3792e84b` | https://gregarious-marzipan-d58433.netlify.app | — | 2025-11-14T22:04:57.437Z | 2025-11-14T22:05:03.975Z | — | True |
| cute-trifle-2d664f | `c1034973-66af-4db0-badf-9c784617ee73` | https://cute-trifle-2d664f.netlify.app | — | 2025-11-14T22:04:05.854Z | 2025-11-14T22:04:09.222Z | — | True |
| rad-macaron-8543eb | `a501dd4d-2fd7-4aa4-b4a6-a01bc9484ef7` | https://rad-macaron-8543eb.netlify.app | — | 2025-10-29T12:08:34.064Z | 2025-10-29T12:08:42.408Z | — | True |
| jolly-pastelito-b7383d | `bb5b5d9b-0aaa-4755-9626-830aaa1c3228` | https://jolly-pastelito-b7383d.netlify.app | — | 2025-10-29T12:06:47.868Z | 2025-10-29T12:06:50.904Z | — | True |
| superb-gumption-bb271b | `19624565-bae8-4612-b3f7-b5f9cb1d3c8f` | https://superb-gumption-bb271b.netlify.app | — | 2025-10-29T12:04:48.908Z | 2025-10-29T12:04:54.771Z | — | True |
| fancy-bunny-4a5d54 | `bda71b29-d481-46f0-b417-ef7940f27447` | https://fancy-bunny-4a5d54.netlify.app | — | 2025-10-29T12:02:23.991Z | 2025-10-29T12:02:26.920Z | — | True |
| unique-wisp-3a692b | `401330d1-f8a3-4be0-93a1-dcdeb2709705` | https://unique-wisp-3a692b.netlify.app | — | 2025-10-29T11:59:28.765Z | 2025-10-29T11:59:34.034Z | — | True |
| jade-eclair-318221 | `9d076cf6-d94c-4c8f-9b62-9c6002a1c6d3` | https://jade-eclair-318221.netlify.app | — | 2025-10-29T11:57:58.896Z | 2025-10-29T11:58:07.228Z | — | True |
| gilded-flan-1837b4 | `63183229-f179-4bc9-abe8-06549abc3b28` | https://gilded-flan-1837b4.netlify.app | — | 2025-10-21T06:02:52.551Z | 2025-10-21T06:02:57.337Z | — | True |
| mellow-kashata-ec8010 | `02592b5a-0353-4c70-a803-1c8af684a3b2` | https://mellow-kashata-ec8010.netlify.app | — | 2025-10-21T06:00:15.160Z | 2025-10-21T06:00:24.718Z | — | True |
| deft-choux-78fbb9 | `f2106732-220a-4c58-9781-25916fb87777` | https://deft-choux-78fbb9.netlify.app | — | 2025-10-21T05:56:30.724Z | 2025-10-21T05:56:34.591Z | — | True |
| vocal-frangipane-a62ea7 | `445fa507-3c22-4cad-bc57-bc7970ad0a3f` | https://vocal-frangipane-a62ea7.netlify.app | — | 2025-10-21T05:50:45.754Z | 2025-10-21T05:50:49.726Z | — | True |
| super-hummingbird-25566b | `d5b1464a-3818-4168-990b-515c9c0c4373` | https://super-hummingbird-25566b.netlify.app | — | 2025-10-21T05:46:27.188Z | 2025-10-21T05:46:35.104Z | — | True |
| lucky-praline-b7c17d | `f2b41163-da0b-4e33-9025-b9ee838fc570` | https://lucky-praline-b7c17d.netlify.app | — | 2025-10-21T05:40:13.405Z | 2025-10-21T05:40:17.412Z | — | True |
| chic-pie-1f43cc | `e2c2d7ad-d12f-4bb6-84ab-0ff50a3d196c` | https://chic-pie-1f43cc.netlify.app | — | 2025-10-21T05:27:36.931Z | 2025-10-21T05:27:46.855Z | — | True |
| joyful-longma-cf8adc | `7c77a275-997b-40df-bae8-c1d58b268d13` | https://joyful-longma-cf8adc.netlify.app | — | 2025-10-21T05:24:58.978Z | 2025-10-21T05:25:08.311Z | — | True |
| super-granita-f8caf1 | `0322b200-da4b-42ee-a934-e1599a0f9c5a` | https://super-granita-f8caf1.netlify.app | — | 2025-10-21T05:21:58.853Z | 2025-10-21T05:22:03.239Z | — | True |
| spontaneous-faun-6ac9a0 | `8bf690b5-c672-4d94-bdf0-729287c34740` | https://spontaneous-faun-6ac9a0.netlify.app | — | 2025-10-21T05:19:21.715Z | 2025-10-21T05:19:31.458Z | — | True |
| fluffy-manatee-255e14 | `0352c646-a920-45d8-99a6-98460d1f87d4` | https://fluffy-manatee-255e14.netlify.app | — | 2025-10-21T05:09:17.015Z | 2025-10-21T05:09:21.140Z | — | True |
| reliable-khapse-818eb4 | `71a77565-0c64-4d1c-894d-583b3a4b1a2f` | https://reliable-khapse-818eb4.netlify.app | — | 2025-10-21T05:04:10.290Z | 2025-10-21T05:04:18.071Z | — | True |
| venerable-pudding-8ac175 | `45958660-64ea-4d2d-b26b-71a09f511a17` | https://venerable-pudding-8ac175.netlify.app | — | 2025-10-21T05:01:01.694Z | 2025-10-21T05:01:05.688Z | — | True |
| silver-tartufo-9f5c50 | `5519c014-71e4-4439-b2d9-ab8956263531` | https://silver-tartufo-9f5c50.netlify.app | — | 2025-10-21T04:57:46.895Z | 2025-10-21T04:57:51.067Z | — | True |
| soft-banoffee-bb1bbc | `33ae300a-3f94-4c55-bd75-b6e329b077bf` | https://soft-banoffee-bb1bbc.netlify.app | — | 2025-10-21T04:54:37.547Z | 2025-10-21T04:54:46.782Z | — | True |
| comfy-sherbet-0b2a57 | `9c27b4bf-95ce-455d-8f01-84eee575c6fe` | https://comfy-sherbet-0b2a57.netlify.app | — | 2025-10-21T04:50:53.072Z | 2025-10-21T04:50:57.553Z | — | True |
| effervescent-arithmetic-8cd2bb | `4371bef3-a185-4e51-ae5e-a80211497e45` | https://effervescent-arithmetic-8cd2bb.netlify.app | — | 2025-10-21T04:48:43.959Z | 2025-10-21T04:48:48.062Z | — | True |
| bejewelled-sprinkles-348b6b | `29bb1d82-e20f-49cc-93a7-84dba696d870` | https://bejewelled-sprinkles-348b6b.netlify.app | — | 2025-10-21T04:45:51.040Z | 2025-10-21T04:45:59.545Z | — | True |
| candid-valkyrie-5c6b0e | `1830ca5d-9644-4efe-8808-47f5526c63fb` | https://candid-valkyrie-5c6b0e.netlify.app | — | 2025-10-21T04:44:53.646Z | 2025-10-21T04:45:02.655Z | — | True |
| clinquant-crostata-484e3b | `44fe1170-0edb-4e36-858b-e312ae807368` | https://clinquant-crostata-484e3b.netlify.app | — | 2025-10-21T04:42:52.566Z | 2025-10-21T04:42:56.191Z | — | True |
| stunning-brioche-67aa0b | `f585f5c2-ca0b-43b3-b0cf-4582f3b2c034` | https://stunning-brioche-67aa0b.netlify.app | — | 2025-10-21T04:41:37.836Z | 2025-10-21T04:41:47.185Z | — | True |
| inspiring-cranachan-64a1dc | `fc8bf054-815b-4028-8d38-e47e75561379` | https://inspiring-cranachan-64a1dc.netlify.app | — | 2025-10-21T04:38:06.670Z | 2025-10-21T04:38:10.866Z | — | True |
| heroic-llama-54dc72 | `b5c90f4e-318a-4f97-b725-f84d4d33adec` | https://heroic-llama-54dc72.netlify.app | — | 2025-10-21T04:35:47.686Z | 2025-10-21T04:35:57.416Z | — | True |
| jazzy-brioche-f2400b | `7fd4a13f-d7a3-4c08-9408-a787fcb1edd4` | https://jazzy-brioche-f2400b.netlify.app | — | 2025-10-21T04:33:04.268Z | 2025-10-21T04:33:08.164Z | — | True |
| deft-axolotl-c5e0f8 | `d09c6525-2ac1-4443-b818-669dac9b0da6` | https://deft-axolotl-c5e0f8.netlify.app | — | 2025-10-21T03:47:36.356Z | 2025-10-21T03:47:39.881Z | — | True |
| exquisite-panda-b6c327 | `9aceffaf-6308-4693-ad92-42a2fd5e391b` | https://exquisite-panda-b6c327.netlify.app | — | 2025-10-21T03:44:58.159Z | 2025-10-21T03:45:02.350Z | — | True |
| sage-liger-c70e53 | `bbe759f6-21c7-4a41-8abc-ec4b76896835` | https://sage-liger-c70e53.netlify.app | — | 2025-10-21T03:41:33.932Z | 2025-10-21T03:41:43.089Z | — | True |
| spectacular-fairy-a62e46 | `ba8eddfd-74c0-4baf-96a2-9101b1801dd5` | https://spectacular-fairy-a62e46.netlify.app | — | 2025-10-21T03:36:12.004Z | 2025-10-21T03:36:15.736Z | — | True |
| clinquant-rabanadas-4a594a | `0eac9119-e633-4aae-867d-50be048fb246` | https://clinquant-rabanadas-4a594a.netlify.app | — | 2025-10-21T03:31:43.412Z | 2025-10-21T03:31:47.736Z | — | True |
| stalwart-florentine-b19026 | `accdd6e5-a03d-4c4a-8d96-a90c85972bcb` | https://stalwart-florentine-b19026.netlify.app | — | 2025-10-21T03:24:22.141Z | 2025-10-21T03:24:31.487Z | — | True |
| effulgent-meerkat-f2161d | `aaabcabe-787f-4534-bddd-b5271b4713ae` | https://effulgent-meerkat-f2161d.netlify.app | — | 2025-10-21T03:23:54.862Z | 2025-10-21T03:24:03.212Z | — | True |
| classy-brioche-72c8d5 | `c4b4af4f-dd29-434f-ba70-943159a3e22b` | https://classy-brioche-72c8d5.netlify.app | — | 2025-10-21T03:21:22.377Z | 2025-10-21T03:21:26.915Z | — | True |
| radiant-palmier-58f496 | `986d2f69-6c27-44d6-9a3e-be2ccbc0d0d9` | https://radiant-palmier-58f496.netlify.app | — | 2025-10-21T03:11:32.388Z | 2025-10-21T03:11:37.618Z | — | True |
| deft-taffy-504ac1 | `fe58081c-e324-4d6d-90fb-c882a7f207bd` | https://deft-taffy-504ac1.netlify.app | — | 2025-10-21T03:01:36.473Z | 2025-10-21T03:01:46.946Z | — | True |
| serene-kheer-ae3daa | `e27d3585-e03c-4551-81ad-8e12f45ce60d` | https://serene-kheer-ae3daa.netlify.app | — | 2025-10-21T02:37:13.917Z | 2025-10-21T02:37:20.004Z | — | True |
| sunny-tanuki-488a8d | `2cf587d5-d919-4e30-b7ca-780a0a4ab980` | https://sunny-tanuki-488a8d.netlify.app | — | 2025-10-20T15:15:16.722Z | 2025-10-20T17:38:07.298Z | — | True |
| dulcet-taiyaki-868995 | `cbc40338-88bb-4a8f-b9b7-dc1541bb4edb` | https://dulcet-taiyaki-868995.netlify.app | — | 2025-10-20T15:13:15.205Z | 2025-10-20T17:37:42.636Z | — | True |
| magenta-clafoutis-aa5841 | `669134a6-a325-4c42-bc3d-9183355aa5a8` | https://magenta-clafoutis-aa5841.netlify.app | — | 2025-10-20T15:09:36.420Z | 2025-10-20T17:36:52.424Z | — | True |
| gilded-otter-ac563c | `120f5cc7-411c-49b2-a7bb-e8b00a3e73b4` | https://gilded-otter-ac563c.netlify.app | — | 2025-10-20T15:05:23.048Z | 2025-10-20T17:36:04.937Z | — | True |
| superb-sfogliatella-4ab49c | `4f2ac350-eccb-4453-a38f-1a48c8bccfff` | https://superb-sfogliatella-4ab49c.netlify.app | — | 2025-10-20T15:03:57.993Z | 2025-10-20T17:35:42.127Z | — | True |
| sparkling-conkies-8cfd85 | `2dd43d00-1e3f-4df8-95b2-e658052cf02b` | https://sparkling-conkies-8cfd85.netlify.app | — | 2025-10-20T15:00:41.654Z | 2025-10-20T17:35:10.122Z | — | True |
| taupe-kulfi-b8abe8 | `6172a2ca-b38d-4a04-9635-5656a190ebe0` | https://taupe-kulfi-b8abe8.netlify.app | — | 2025-10-20T14:49:51.589Z | 2025-10-20T14:49:51.649Z | — | True |
| statuesque-gingersnap-1b40c1 | `15c1a710-d9c0-4bc6-818d-96e6eca78f20` | https://statuesque-gingersnap-1b40c1.netlify.app | — | 2025-10-20T14:36:53.346Z | 2025-10-20T14:40:38.681Z | — | True |
| dainty-kataifi-3f36d3 | `484b7e2a-d8f3-436d-84e9-36806a5cd6b1` | https://dainty-kataifi-3f36d3.netlify.app | — | 2025-10-20T14:24:47.628Z | 2025-10-20T14:24:47.684Z | — | True |
| tranquil-gumdrop-d5ccce | `9840bde9-3b60-46d7-aef1-4e0ef1f4733a` | https://tranquil-gumdrop-d5ccce.netlify.app | — | 2025-10-20T13:46:32.417Z | 2025-10-20T13:46:32.468Z | — | True |
| sprightly-marshmallow-bc16f2 | `5dbb62b6-425c-4359-8df1-82a8151795c8` | https://sprightly-marshmallow-bc16f2.netlify.app | — | 2025-10-20T13:33:49.408Z | 2025-10-20T13:33:58.168Z | — | True |
| iridescent-tulumba-3d141f | `fbfd09b0-abf3-4a98-b8a2-a197777e4bb8` | https://iridescent-tulumba-3d141f.netlify.app | — | 2025-10-20T13:27:13.820Z | 2025-10-20T13:27:16.845Z | — | True |
| elaborate-cassata-e60bdf | `28afe5a6-445f-4755-9d15-b7201a5718a4` | https://elaborate-cassata-e60bdf.netlify.app | — | 2025-10-20T13:26:25.511Z | 2025-10-20T13:26:29.189Z | — | True |
| lustrous-parfait-d715dd | `ea210fef-6ba0-4b9c-b119-fb0a1f3dc4b5` | https://lustrous-parfait-d715dd.netlify.app | — | 2025-10-20T13:16:51.018Z | 2025-10-20T13:16:56.555Z | — | True |
| radiant-florentine-953bab | `6ef9c095-1dcb-4da3-aa1c-77e88732ce6e` | https://radiant-florentine-953bab.netlify.app | — | 2025-10-20T13:12:37.471Z | 2025-10-20T13:12:37.506Z | — | True |
| gleaming-caramel-598348 | `f1ddeaf7-c942-4f9a-9017-a058e84ba838` | https://gleaming-caramel-598348.netlify.app | — | 2025-10-19T18:38:39.689Z | 2025-10-19T18:38:44.594Z | — | True |
| creative-tanuki-c56514 | `da264ca5-fb90-43f7-8800-861e24ab006f` | https://creative-tanuki-c56514.netlify.app | — | 2025-10-19T18:27:19.838Z | 2025-10-19T18:27:23.891Z | — | True |
| mellow-chaja-04490d | `75bfd16c-6063-41b8-a988-99689f493718` | https://mellow-chaja-04490d.netlify.app | — | 2025-10-19T17:17:22.694Z | 2025-10-19T17:17:31.019Z | — | True |
| quiet-cobbler-ad4e34 | `b112be32-3c96-4bc1-b88f-48fe5f386012` | https://quiet-cobbler-ad4e34.netlify.app | — | 2025-10-19T17:01:58.313Z | 2025-10-19T17:01:58.374Z | — | True |
| elegant-haupia-24967a | `eed69af7-4327-4f6c-8db9-e5f2deeb00db` | https://elegant-haupia-24967a.netlify.app | — | 2025-10-19T12:33:56.418Z | 2025-10-19T12:33:59.807Z | — | True |
| leafy-puppy-63e763 | `99a50cd5-f5a7-4399-bd6a-53c4f557cc02` | https://leafy-puppy-63e763.netlify.app | — | 2025-10-19T12:31:26.975Z | 2025-10-19T12:31:35.452Z | — | True |
| beautiful-semolina-81a6c7 | `5a87bbc7-512e-483a-b49a-a0414ea5b088` | https://beautiful-semolina-81a6c7.netlify.app | — | — (never published) | 2025-10-19T12:30:40.386Z | — | True |
| whimsical-peony-25f96b | `ee0053f8-52d1-496b-9901-a9ec795068df` | https://whimsical-peony-25f96b.netlify.app | — | — (never published) | 2025-10-19T12:30:12.552Z | — | True |
| soft-torte-d830e0 | `cc49c36f-7885-4d4a-b944-fe3def6411ae` | https://soft-torte-d830e0.netlify.app | — | 2025-10-19T12:23:35.305Z | 2025-10-19T12:23:43.810Z | — | True |
| meek-croquembouche-8840b5 | `608d9cb7-9694-40d5-9f48-10cb7f18923e` | https://meek-croquembouche-8840b5.netlify.app | — | 2025-10-19T12:17:17.814Z | 2025-10-19T12:17:23.158Z | — | True |
| courageous-gingersnap-76a359 | `49f6aa19-7e5a-4ac2-a27d-764c9f9ca912` | https://courageous-gingersnap-76a359.netlify.app | — | 2025-10-17T11:57:58.632Z | 2025-10-17T11:58:07.148Z | — | True |
| sparkling-pudding-985b5b | `8e645eb2-4caa-4584-9e1f-062cc3f7ea57` | https://sparkling-pudding-985b5b.netlify.app | — | 2025-10-17T11:42:11.268Z | 2025-10-17T11:42:13.952Z | — | True |
| papaya-kulfi-42c154 | `d4b729e5-09f9-42c4-81ae-759031b8ab12` | https://papaya-kulfi-42c154.netlify.app | — | 2025-10-17T11:41:39.445Z | 2025-10-17T11:41:42.526Z | — | True |
| boisterous-pastelito-a51d0c | `763dcca5-47b9-4778-a8d3-2c6b7479d51e` | https://boisterous-pastelito-a51d0c.netlify.app | — | 2025-10-16T16:15:51.912Z | 2025-10-16T16:15:57.804Z | — | True |
| resonant-dusk-0b6e61 | `9f8add45-7852-4b1e-9d82-3241b477b75e` | https://resonant-dusk-0b6e61.netlify.app | — | 2025-10-13T14:36:18.814Z | 2025-10-13T14:36:18.863Z | — | True |
| rainbow-chimera-234f7f | `bd33ce27-8d6e-4c3f-bb9c-2152f00c68c3` | https://rainbow-chimera-234f7f.netlify.app | — | 2025-10-13T14:31:47.314Z | 2025-10-13T14:31:50.999Z | — | True |
| loquacious-llama-9bb534 | `85c6e2f1-2c90-465f-9270-14e35e4aa5ab` | https://loquacious-llama-9bb534.netlify.app | — | 2025-10-10T04:45:17.100Z | 2025-10-10T04:45:20.400Z | — | True |
| deluxe-pie-54204a | `823542bb-34a7-431d-9811-809882a31024` | https://deluxe-pie-54204a.netlify.app | — | 2025-10-10T04:40:08.829Z | 2025-10-10T04:40:08.878Z | — | True |
| nimble-baklava-d8fd1c | `e7bc2b9a-2e64-4db3-8812-8d6372b3930b` | https://nimble-baklava-d8fd1c.netlify.app | — | 2025-10-10T04:18:31.655Z | 2025-10-10T04:20:08.967Z | — | True |
| dulcet-sopapillas-a5e57a | `efc75f4b-b129-4e87-b8a5-07dd59187984` | https://dulcet-sopapillas-a5e57a.netlify.app | — | 2025-10-10T04:07:05.254Z | 2025-10-10T04:07:07.950Z | — | True |
| frolicking-starship-742685 | `aa871d1b-3843-45f6-a06a-5906598de083` | https://frolicking-starship-742685.netlify.app | — | 2025-10-10T04:04:37.070Z | 2025-10-10T04:04:37.116Z | — | True |
| dancing-lokum-cdd6a2 | `8255e167-d4fd-4977-bf02-39ceb0904080` | https://dancing-lokum-cdd6a2.netlify.app | — | 2025-10-10T03:54:37.893Z | 2025-10-10T03:54:37.929Z | — | True |
| celebrated-concha-9afe4b | `2ba12d18-1495-470a-90ff-4f8ed3d547d5` | https://celebrated-concha-9afe4b.netlify.app | — | 2025-10-10T03:46:48.780Z | 2025-10-10T03:46:48.834Z | — | True |
| velvety-chebakia-4c822f | `f454226f-9c57-4000-8af4-49b096e3e2b9` | https://velvety-chebakia-4c822f.netlify.app | — | 2025-10-10T03:40:52.338Z | 2025-10-10T03:40:56.000Z | — | True |
| gorgeous-sable-110d5d | `5f06f87d-a28e-4ee9-8033-dbaeeb210622` | https://gorgeous-sable-110d5d.netlify.app | — | 2025-10-10T03:35:19.834Z | 2025-10-10T03:35:28.305Z | — | True |
| keen-travesseiro-c1b8d2 | `55b6aa01-f2f0-4b50-af9f-284d1e2764bc` | https://keen-travesseiro-c1b8d2.netlify.app | — | 2025-10-10T03:32:30.918Z | 2025-10-10T03:32:33.603Z | — | True |
| super-semolina-4c59ea | `f8e9369b-3a69-4996-85f0-c793dbe72da8` | https://super-semolina-4c59ea.netlify.app | — | 2025-10-10T03:24:20.574Z | 2025-10-10T03:24:23.794Z | — | True |
| charming-squirrel-4ccfaa | `7535ca0a-d164-4583-95da-33c9ee74cbf1` | https://charming-squirrel-4ccfaa.netlify.app | — | 2025-10-10T03:21:53.780Z | 2025-10-10T03:21:56.750Z | — | True |
| flourishing-liger-4a553d | `d760f7c2-b63f-46ef-b81b-a896019c96dc` | https://flourishing-liger-4a553d.netlify.app | — | 2025-10-10T03:17:26.044Z | 2025-10-10T03:17:28.607Z | — | True |
| effortless-melomakarona-fe5051 | `fff760a0-5ecf-4105-9ab3-91d7ee999f3e` | https://effortless-melomakarona-fe5051.netlify.app | — | 2025-10-10T03:13:56.515Z | 2025-10-10T03:13:59.258Z | — | True |
| quiet-tulumba-14b20b | `1365a734-e358-47fe-b0e2-9e8daf6f9ee7` | https://quiet-tulumba-14b20b.netlify.app | — | 2025-10-10T00:22:40.577Z | 2025-10-10T00:22:43.116Z | — | True |
| legendary-capybara-ff1ed3 | `6b552c8f-fa2e-41bf-804a-ab0206c2c42b` | https://legendary-capybara-ff1ed3.netlify.app | — | 2025-10-10T00:20:27.871Z | 2025-10-10T00:20:34.618Z | — | True |
| chic-kringle-17451d | `08dce46b-699e-4ad3-8fe8-b17e28806e54` | https://chic-kringle-17451d.netlify.app | — | 2025-10-09T14:30:47.675Z | 2025-10-09T14:30:51.099Z | — | True |
| incandescent-naiad-0e31df | `7e8a20f6-6818-4c62-8fec-4d385d1dfb50` | https://incandescent-naiad-0e31df.netlify.app | — | 2025-10-09T14:01:27.244Z | 2025-10-09T14:01:27.280Z | — | True |
| unrivaled-tarsier-4df983 | `239dda82-02e1-4f14-bad2-80b3657c8e1f` | https://unrivaled-tarsier-4df983.netlify.app | — | 2025-10-09T07:03:48.445Z | 2025-10-09T07:03:48.496Z | — | True |
| splendorous-bubblegum-717576 | `8fd2d507-686a-456f-8e22-458b99b494cf` | https://splendorous-bubblegum-717576.netlify.app | — | 2025-10-09T07:00:01.547Z | 2025-10-09T07:00:04.111Z | — | True |
| teal-biscochitos-043e8c | `6546a049-e5a2-4381-aafe-73792833c156` | https://teal-biscochitos-043e8c.netlify.app | — | 2025-10-09T06:57:39.005Z | 2025-10-09T06:57:39.060Z | — | True |
| startling-dolphin-3de442 | `ddf85167-8b0a-410c-ac83-94447e58ff89` | https://startling-dolphin-3de442.netlify.app | — | 2025-10-09T06:54:20.359Z | 2025-10-09T06:54:20.453Z | — | True |
| serene-phoenix-72cd42 | `87e2480c-83b5-45b6-915b-7cd6e319c818` | https://serene-phoenix-72cd42.netlify.app | — | 2025-10-09T06:52:12.133Z | 2025-10-09T06:52:12.176Z | — | True |
| boisterous-zabaione-2034cc | `9b16c674-3659-477e-a36e-d863de399cd3` | https://boisterous-zabaione-2034cc.netlify.app | — | 2025-10-09T06:50:32.242Z | 2025-10-09T06:50:32.280Z | — | True |
| frolicking-dango-e14f0b | `81ad5c3c-be72-4d68-8e3a-587ea701e783` | https://frolicking-dango-e14f0b.netlify.app | — | 2025-10-09T06:44:54.961Z | 2025-10-09T06:44:58.223Z | — | True |
| luxury-treacle-3e3b1d | `a10e1865-a4fd-4227-8909-624f688a4301` | https://luxury-treacle-3e3b1d.netlify.app | — | 2025-10-09T06:37:53.322Z | 2025-10-09T06:37:57.782Z | — | True |
| resplendent-halva-eaf419 | `f4610212-611a-490a-9cf0-71cdce511e0f` | https://resplendent-halva-eaf419.netlify.app | — | 2025-10-09T06:28:44.491Z | 2025-10-09T06:28:44.526Z | — | True |
| melodic-speculoos-19cdf3 | `87a660b3-02fc-4d09-8d0d-afcee3003921` | https://melodic-speculoos-19cdf3.netlify.app | — | 2025-10-09T06:27:50.149Z | 2025-10-09T06:27:50.186Z | — | True |
| lighthearted-mandazi-357e92 | `552dbd24-30ab-41d1-8c44-bd2c3523e128` | https://lighthearted-mandazi-357e92.netlify.app | — | 2025-10-09T06:27:07.443Z | 2025-10-09T06:27:07.496Z | — | True |
| tiny-chimera-9be48f | `a5196dc0-6890-4907-ae87-0cc8f30a51a7` | https://tiny-chimera-9be48f.netlify.app | — | 2025-10-09T06:24:42.451Z | 2025-10-09T06:24:45.058Z | — | True |
| sparkly-pudding-eafb09 | `061c910b-509b-491c-9bda-6e60639ae943` | https://sparkly-pudding-eafb09.netlify.app | — | 2025-10-09T06:21:35.434Z | 2025-10-09T06:21:49.259Z | — | True |
| ornate-duckanoo-916895 | `23be59e2-ab3d-406b-93de-12dbdabeaff1` | https://ornate-duckanoo-916895.netlify.app | — | 2025-10-09T06:14:31.023Z | 2025-10-09T06:14:33.575Z | — | True |
| boisterous-platypus-df52cc | `3e2953c3-fcfc-4225-8467-99fbe11e8c15` | https://boisterous-platypus-df52cc.netlify.app | — | 2025-10-09T06:10:40.221Z | 2025-10-09T06:10:40.260Z | — | True |
| eloquent-heliotrope-97ce23 | `e10ac10a-3c19-44c7-b4dc-1e70ef98db39` | https://eloquent-heliotrope-97ce23.netlify.app | — | 2025-10-09T05:53:32.001Z | 2025-10-09T05:53:40.864Z | — | True |
| magnificent-cupcake-8456d7 | `20467f1f-2d60-447f-aa71-4bb41de169e0` | https://magnificent-cupcake-8456d7.netlify.app | — | 2025-10-09T05:45:19.305Z | 2025-10-09T05:45:19.358Z | — | True |
| lucent-starlight-3f2492 | `e0a647c5-fcf3-41b6-8822-fbe5eb2638ab` | https://lucent-starlight-3f2492.netlify.app | — | 2025-10-09T05:31:07.491Z | 2025-10-09T05:31:07.545Z | — | True |
| unrivaled-pastelito-d3078a | `7c60d0bb-069a-4382-a197-65cb1a9e83cb` | https://unrivaled-pastelito-d3078a.netlify.app | — | 2025-10-09T05:30:39.727Z | 2025-10-09T05:30:45.854Z | — | True |
| luminous-douhua-856ffa | `5161bac5-7ca6-49f3-9ae7-ff833c78f142` | https://luminous-douhua-856ffa.netlify.app | — | 2025-10-09T05:29:02.957Z | 2025-10-09T05:29:02.994Z | — | True |
| marvelous-kheer-81f38a | `f9bba53d-1866-4fc6-9e8f-0ae359c7de18` | https://marvelous-kheer-81f38a.netlify.app | — | 2025-10-09T05:25:46.940Z | 2025-10-09T05:25:52.255Z | — | True |
| deluxe-platypus-5547c4 | `0cddc3e6-bcf6-4b7e-b3be-2d4492a3410a` | https://deluxe-platypus-5547c4.netlify.app | — | 2025-10-09T05:24:59.795Z | 2025-10-09T05:25:03.418Z | — | True |
| steady-licorice-6d7982 | `39109f47-2db3-42b4-9656-cf337500804b` | https://steady-licorice-6d7982.netlify.app | — | 2025-10-09T05:23:40.586Z | 2025-10-09T05:23:43.182Z | — | True |
| resilient-selkie-f06197 | `78602900-c554-48a2-aa84-7a907ea50420` | https://resilient-selkie-f06197.netlify.app | — | 2025-10-09T05:22:20.124Z | 2025-10-09T05:22:23.090Z | — | True |
| wonderful-mousse-715952 | `25367c9b-a538-4309-85a3-6b533ecd4b9f` | https://wonderful-mousse-715952.netlify.app | — | 2025-10-09T05:20:16.504Z | 2025-10-09T05:20:24.995Z | — | True |
| starlit-rugelach-c0d604 | `287626f4-d1e7-4338-bbf1-77afa3a6282e` | https://starlit-rugelach-c0d604.netlify.app | — | 2025-10-09T05:16:03.598Z | 2025-10-09T05:16:07.770Z | — | True |
| heroic-moonbeam-133c85 | `071d81b4-c2c5-43c5-bbea-4cb55a3ead5b` | https://heroic-moonbeam-133c85.netlify.app | — | 2025-10-09T05:12:40.693Z | 2025-10-09T05:12:43.698Z | — | True |
| ornate-narwhal-8b50c6 | `07d23575-19ff-4689-82b3-193e10d24c71` | https://ornate-narwhal-8b50c6.netlify.app | — | 2025-10-09T05:09:07.112Z | 2025-10-09T05:09:09.707Z | — | True |
| unique-platypus-537a41 | `807fcc71-a27f-4faa-9e9b-d507cc46c922` | https://unique-platypus-537a41.netlify.app | — | 2025-10-09T05:07:09.093Z | 2025-10-09T05:07:12.008Z | — | True |
| stirring-speculoos-c672ca | `a16d6a3f-1e1c-4658-9d21-daa06b369209` | https://stirring-speculoos-c672ca.netlify.app | — | 2025-10-09T05:02:58.801Z | 2025-10-09T05:02:58.851Z | — | True |
| stirring-donut-74c7fc | `39ddae8d-4c0c-482e-9299-7b6bb7537622` | https://stirring-donut-74c7fc.netlify.app | — | 2025-10-09T04:56:29.266Z | 2025-10-09T04:56:37.908Z | — | True |
| dancing-medovik-21c95e | `f38ca5dc-36bc-4b9e-b5ab-f22587f5e667` | https://dancing-medovik-21c95e.netlify.app | — | 2025-10-09T04:55:41.197Z | 2025-10-09T04:55:43.758Z | — | True |
| regal-biscochitos-aa4d77 | `56908126-e0fd-48b7-8f0d-bd6356296084` | https://regal-biscochitos-aa4d77.netlify.app | — | 2025-10-09T04:54:25.985Z | 2025-10-09T04:54:34.310Z | — | True |
| clever-tarsier-1c928c | `52414bbb-1fc7-48ef-9469-fcff8f8ea688` | https://clever-tarsier-1c928c.netlify.app | — | 2025-10-09T04:52:03.053Z | 2025-10-09T04:52:05.533Z | — | True |
| bright-pixie-905391 | `1c9501fd-8c56-4531-a92e-72b16a2e835d` | https://bright-pixie-905391.netlify.app | — | 2025-10-09T04:43:19.272Z | 2025-10-09T04:43:22.224Z | — | True |
| comfy-fox-8c6f60 | `1d1f26f4-6169-492c-ad98-03dec5ce0531` | https://comfy-fox-8c6f60.netlify.app | — | 2025-10-09T04:42:45.414Z | 2025-10-09T04:42:48.086Z | — | True |
| magenta-bonbon-957462 | `411a19e6-6fab-46f7-a953-b17ab1c9d02d` | https://magenta-bonbon-957462.netlify.app | — | 2025-10-09T03:50:55.782Z | 2025-10-09T03:50:59.960Z | — | True |
| visionary-marzipan-03698c | `366796c8-a89f-437a-ab48-bbc4f832db54` | https://visionary-marzipan-03698c.netlify.app | — | 2025-10-09T03:47:23.208Z | 2025-10-09T03:47:23.252Z | — | True |
| fantastic-cascaron-b5c496 | `962d8dad-cc64-4530-b686-6d2619bd59d4` | https://fantastic-cascaron-b5c496.netlify.app | — | 2025-10-09T03:44:42.856Z | 2025-10-09T03:44:51.264Z | — | True |
| ubiquitous-biscuit-13ec3d | `d25aef04-9e0d-44f3-9bbe-78bf3d54178e` | https://ubiquitous-biscuit-13ec3d.netlify.app | — | 2025-10-09T03:34:54.923Z | 2025-10-09T03:34:54.963Z | — | True |
| transcendent-jalebi-a9ebaa | `09bfa6f7-487c-483f-ad25-3c1275224d5c` | https://transcendent-jalebi-a9ebaa.netlify.app | — | 2025-10-09T03:29:13.445Z | 2025-10-09T03:29:16.252Z | — | True |
| silly-squirrel-486690 | `a071ac4f-1d30-4ed0-8cc8-c9fe218225b0` | https://silly-squirrel-486690.netlify.app | — | 2025-10-09T03:15:57.682Z | 2025-10-09T03:16:00.475Z | — | True |
| courageous-crumble-939b59 | `48ed6faf-1185-469d-863d-02b45574bc7d` | https://courageous-crumble-939b59.netlify.app | — | 2025-10-09T03:05:36.695Z | 2025-10-09T03:05:43.504Z | — | True |
| incandescent-semolina-bbfafb | `ebefe890-b54a-4ad8-a554-3284a1b5feab` | https://incandescent-semolina-bbfafb.netlify.app | — | 2025-10-09T02:59:54.823Z | 2025-10-09T02:59:58.983Z | — | True |
| phenomenal-starburst-9eb3ed | `a17a2b3d-c5de-485e-a599-a6e8e5ba27ab` | https://phenomenal-starburst-9eb3ed.netlify.app | — | 2025-10-09T02:22:13.199Z | 2025-10-09T02:22:21.606Z | — | True |
| lambent-kringle-84ff1c | `5b8c0243-cc09-4611-bdb4-a60702343c9e` | https://lambent-kringle-84ff1c.netlify.app | — | 2025-10-09T02:22:01.892Z | 2025-10-09T02:22:05.042Z | — | True |
| sensational-nasturtium-3d9be1 | `faf78c2d-5c39-4faa-85d5-6eeb07372be1` | https://sensational-nasturtium-3d9be1.netlify.app | — | 2025-10-09T02:21:47.781Z | 2025-10-09T02:21:54.723Z | — | True |
| vocal-piroshki-4a9c10 | `df6335a6-5b52-40c2-87d2-b009fae5783d` | https://vocal-piroshki-4a9c10.netlify.app | — | 2025-10-09T02:19:10.493Z | 2025-10-09T02:19:19.027Z | — | True |
| animated-faun-e829ad | `39116b6f-281e-4b6c-b46c-7cf67957a88c` | https://animated-faun-e829ad.netlify.app | — | 2025-10-08T15:40:04.189Z | 2025-10-08T15:40:04.254Z | — | True |
| phenomenal-fox-05f250 | `2fd79c2d-c7c4-49c1-8286-dbb9470c782d` | https://phenomenal-fox-05f250.netlify.app | — | 2025-10-08T15:36:53.630Z | 2025-10-08T15:36:53.681Z | — | True |
| zingy-liger-1848e7 | `0393bda6-69a9-4d7d-bd7c-fdff6db7466c` | https://zingy-liger-1848e7.netlify.app | — | 2025-10-08T15:28:55.290Z | 2025-10-08T15:28:58.170Z | — | True |
| sprightly-cheesecake-20a9b0 | `da2a13b7-3583-4709-b5aa-3c0309657a74` | https://sprightly-cheesecake-20a9b0.netlify.app | — | 2025-10-08T15:22:13.343Z | 2025-10-08T15:22:13.392Z | — | True |
| beamish-melomakarona-2187e8 | `c013d910-e4e2-47bb-9d6a-b283040eacb9` | https://beamish-melomakarona-2187e8.netlify.app | — | 2025-10-08T15:16:13.210Z | 2025-10-08T15:16:13.262Z | — | True |
| merry-jalebi-e1c230 | `fbb485cf-bbd5-4c61-93c8-ffaf06f74228` | https://merry-jalebi-e1c230.netlify.app | — | 2025-10-08T15:08:03.120Z | 2025-10-08T15:08:03.158Z | — | True |
| fluffy-nougat-c571dc | `277fb1da-7400-423a-804b-7bf2d07ac12c` | https://fluffy-nougat-c571dc.netlify.app | — | 2025-10-08T14:58:06.467Z | 2025-10-08T14:58:10.657Z | — | True |
| fancy-cucurucho-c95ba5 | `97c3aed0-d488-434e-9870-016e1c202a68` | https://fancy-cucurucho-c95ba5.netlify.app | — | 2025-10-08T04:40:11.633Z | 2025-10-08T04:40:11.686Z | — | True |
| marvelous-belekoy-758c47 | `9c7ac1c9-8fba-4cb4-b5db-8cd2cd3b83a6` | https://marvelous-belekoy-758c47.netlify.app | — | 2025-10-08T04:39:35.880Z | 2025-10-08T04:39:40.431Z | — | True |
| silver-sundae-ef0b8a | `c265ceaa-da7e-457c-a51e-69a49ab4afa4` | https://silver-sundae-ef0b8a.netlify.app | — | 2025-10-08T04:37:38.496Z | 2025-10-08T04:37:41.229Z | — | True |
| thriving-figolla-55b555 | `17350dc6-aea9-4f14-89d5-d888acee27b8` | https://thriving-figolla-55b555.netlify.app | — | 2025-10-08T04:36:00.477Z | 2025-10-08T04:36:03.442Z | — | True |
| timely-selkie-a5106b | `a0d8b023-7e6d-47b8-9fcd-f0f93478dcf7` | https://timely-selkie-a5106b.netlify.app | — | 2025-10-08T04:33:38.980Z | 2025-10-08T04:33:41.519Z | — | True |
| super-pithivier-60c787 | `0c54b5a5-790d-4825-af2c-37f2e3914940` | https://super-pithivier-60c787.netlify.app | — | 2025-10-08T04:32:05.061Z | 2025-10-08T04:32:13.604Z | — | True |
| dainty-panda-3377d0 | `2a801c58-6a15-47da-8d3f-b208d094ae36` | https://dainty-panda-3377d0.netlify.app | — | 2025-10-08T04:24:53.570Z | 2025-10-08T04:24:56.434Z | — | True |
| cerulean-belekoy-3d844b | `0263ccba-a0c4-4206-b526-d12bdaa8ccb5` | https://cerulean-belekoy-3d844b.netlify.app | — | 2025-10-08T04:19:08.005Z | 2025-10-08T04:19:10.525Z | — | True |
| aesthetic-syrniki-521a83 | `acc76da6-3199-45c6-911d-2b6c9c457d6a` | https://aesthetic-syrniki-521a83.netlify.app | — | 2025-10-08T04:18:29.010Z | 2025-10-08T04:18:29.072Z | — | True |
| dancing-kataifi-0ec558 | `3ae5d995-7400-4de0-83a8-20230a7c829f` | https://dancing-kataifi-0ec558.netlify.app | — | 2025-10-08T04:17:23.376Z | 2025-10-08T04:17:23.410Z | — | True |
| inquisitive-cheesecake-cf77ca | `e1dc8fd1-94d2-49b2-a1c2-ca731680dfcb` | https://inquisitive-cheesecake-cf77ca.netlify.app | — | 2025-10-08T04:15:24.459Z | 2025-10-08T04:15:27.090Z | — | True |
| adorable-travesseiro-64cf75 | `9e41cd10-25c3-4b63-9a6a-0db3c5a35166` | https://adorable-travesseiro-64cf75.netlify.app | — | 2025-10-08T04:08:16.443Z | 2025-10-08T04:08:20.119Z | — | True |
| wonderful-douhua-276479 | `0db384f4-4936-4db7-8b58-b19754b3c8ff` | https://wonderful-douhua-276479.netlify.app | — | 2025-10-08T04:05:25.035Z | 2025-10-08T04:05:25.083Z | — | True |
| fabulous-shortbread-23b2af | `c261b632-108d-4fb4-b87f-35c2d7f36329` | https://fabulous-shortbread-23b2af.netlify.app | — | 2025-10-08T03:59:00.084Z | 2025-10-08T03:59:08.811Z | — | True |
| super-llama-172516 | `4fe02fbb-f19c-4ea4-b43c-57355d07dfeb` | https://super-llama-172516.netlify.app | — | 2025-10-08T03:58:17.662Z | 2025-10-08T03:58:20.339Z | — | True |
| creative-sopapillas-e3b7a7 | `ee9898d3-b444-4790-9755-6a79c97c2db3` | https://creative-sopapillas-e3b7a7.netlify.app | — | 2025-10-08T03:57:27.772Z | 2025-10-08T03:57:30.862Z | — | True |
| ephemeral-dasik-05b62b | `b57a6bd6-8502-4c81-8c9a-c51449ccb01a` | https://ephemeral-dasik-05b62b.netlify.app | — | 2025-10-08T03:53:05.300Z | 2025-10-08T03:53:07.925Z | — | True |
| tiny-sable-5bb5e0 | `29cf2938-7079-4824-8301-0060449fd600` | https://tiny-sable-5bb5e0.netlify.app | — | 2025-10-08T03:48:09.935Z | 2025-10-08T03:48:09.998Z | — | True |
| chimerical-empanada-191eac | `e66d582d-e90b-4b4e-9053-39e2e4c86992` | https://chimerical-empanada-191eac.netlify.app | — | 2025-10-08T03:46:52.218Z | 2025-10-08T03:46:52.252Z | — | True |
| magical-tarsier-832099 | `28c51d25-22df-42e5-9c52-69bc80bcb47b` | https://magical-tarsier-832099.netlify.app | — | 2025-10-08T03:33:52.815Z | 2025-10-08T03:33:56.243Z | — | True |
| astonishing-dodol-18bf16 | `20547ed4-e9dc-4682-9f98-58d2136d7877` | https://astonishing-dodol-18bf16.netlify.app | — | 2025-10-07T04:53:14.888Z | 2025-10-07T04:53:14.942Z | — | True |
| fanciful-alfajores-8388b5 | `63a3c766-39f3-402c-8801-17bc6049fb44` | https://fanciful-alfajores-8388b5.netlify.app | — | 2025-10-07T04:48:25.882Z | 2025-10-07T04:48:29.733Z | — | True |
| dynamic-bavarois-c17211 | `34fe6c18-a6d5-442d-a720-b7c5f9b17680` | https://dynamic-bavarois-c17211.netlify.app | — | 2025-10-07T04:44:05.977Z | 2025-10-07T04:44:08.707Z | — | True |
| sparkly-smakager-63a163 | `b5f26f91-1d10-417f-8398-6afa0fc20614` | https://sparkly-smakager-63a163.netlify.app | — | 2025-10-07T04:40:08.247Z | 2025-10-07T04:40:11.936Z | — | True |
| luminous-meerkat-7a4918 | `6659940c-6cee-4259-b599-9d2a126efb88` | https://luminous-meerkat-7a4918.netlify.app | — | 2025-10-07T04:35:37.775Z | 2025-10-07T04:35:41.431Z | — | True |
| monumental-licorice-027deb | `f4edbb8d-10ff-48a2-816a-a2b3d5427c8c` | https://monumental-licorice-027deb.netlify.app | — | 2025-10-07T04:30:56.853Z | 2025-10-07T04:30:56.906Z | — | True |
| cozy-lily-27d46d | `12463ae3-b8e3-4a79-a91a-f2c9fb1232a2` | https://cozy-lily-27d46d.netlify.app | — | 2025-10-07T04:27:42.617Z | 2025-10-07T04:27:45.220Z | — | True |
| classy-kitsune-4fe766 | `97c1861d-b306-4448-aec8-78ab7873f0dc` | https://classy-kitsune-4fe766.netlify.app | — | 2025-10-07T04:27:27.451Z | 2025-10-07T04:27:30.801Z | — | True |
| sensational-phoenix-0efb29 | `3e7e4acc-c92d-4f3c-ab80-2a95f949c542` | https://sensational-phoenix-0efb29.netlify.app | — | — (never published) | 2025-10-07T04:25:32.430Z | — | True |
| melodic-duckanoo-5d901a | `a24206b0-c94a-44dd-a42d-675bd54af1a7` | https://melodic-duckanoo-5d901a.netlify.app | — | 2025-10-07T04:13:27.851Z | 2025-10-07T04:13:31.099Z | — | True |
| bespoke-concha-c0b8d0 | `c4e0987a-e51b-41f9-884f-8f8607a6e5be` | https://bespoke-concha-c0b8d0.netlify.app | — | 2025-10-07T04:05:18.687Z | 2025-10-07T04:05:18.735Z | — | True |
| stirring-cajeta-069929 | `148a0d2b-4537-40de-932c-fdf04f36a8b2` | https://stirring-cajeta-069929.netlify.app | — | 2025-10-07T03:59:54.869Z | 2025-10-07T04:00:03.825Z | — | True |
| cheery-sawine-b17cf3 | `9f527832-8ac2-4935-a5b6-eb8a6ae06061` | https://cheery-sawine-b17cf3.netlify.app | — | 2025-10-07T03:47:44.002Z | 2025-10-07T03:47:52.413Z | — | True |
| fastidious-eclair-48a67e | `9c75a4fe-8722-4b6d-aa9e-dfbc5aeddcb8` | https://fastidious-eclair-48a67e.netlify.app | — | 2025-10-07T02:53:02.305Z | 2025-10-07T02:53:06.496Z | — | True |
| cool-torrone-94c7f8 | `418cc483-30e1-4712-acc2-0f057a5d2b0d` | https://cool-torrone-94c7f8.netlify.app | — | 2025-10-07T02:41:19.845Z | 2025-10-07T02:41:23.087Z | — | True |
| boisterous-medovik-07a23e | `284a47f3-370f-413c-a6c4-9228ddf6a175` | https://boisterous-medovik-07a23e.netlify.app | — | 2025-10-07T02:26:00.461Z | 2025-10-07T02:26:08.789Z | — | True |
| cute-pasca-6e314b | `032ad35b-a3db-44e4-b01d-4d3a51318fbd` | https://cute-pasca-6e314b.netlify.app | — | 2025-10-07T01:52:08.674Z | 2025-10-07T01:52:08.715Z | — | True |
| darling-snickerdoodle-7fb133 | `10521ef3-2c33-49c1-aba8-a933665323b8` | https://darling-snickerdoodle-7fb133.netlify.app | — | 2025-10-07T01:34:17.695Z | 2025-10-07T01:34:20.132Z | — | True |
| rainbow-sfogliatella-94aa89 | `c248b248-bad1-4fbe-b0f1-4f73dac531bb` | https://rainbow-sfogliatella-94aa89.netlify.app | — | 2025-10-06T23:49:33.282Z | 2025-10-06T23:49:37.379Z | — | True |
| ephemeral-alpaca-f6fc25 | `f79c24cf-9614-4651-a560-f7b1e3a050c7` | https://ephemeral-alpaca-f6fc25.netlify.app | — | 2025-10-06T23:38:20.256Z | 2025-10-06T23:38:24.721Z | — | True |
| effervescent-kitten-1ab1a0 | `3d678e4e-1f94-4666-9667-581a8ceb2d9f` | https://effervescent-kitten-1ab1a0.netlify.app | — | 2025-10-06T23:36:45.812Z | 2025-10-06T23:36:58.219Z | — | True |
| mellifluous-cajeta-77d0cd | `9fb60c72-1974-44b4-90c4-79599b80cd91` | https://mellifluous-cajeta-77d0cd.netlify.app | — | 2025-10-06T23:14:49.562Z | 2025-10-06T23:14:52.591Z | — | True |
| sunny-duckanoo-2b2b23 | `a8cfa8c4-3f74-4dbb-ac16-2fe93d747abc` | https://sunny-duckanoo-2b2b23.netlify.app | — | 2025-10-06T22:48:54.137Z | 2025-10-06T22:49:02.720Z | — | True |
| clever-liger-54cbe0 | `c111de8a-cdb3-4fc0-820a-869c542aac52` | https://clever-liger-54cbe0.netlify.app | — | 2025-10-06T20:34:50.809Z | 2025-10-06T20:34:54.175Z | — | True |
| vocal-fairy-077fa5 | `083f4c9d-1d53-4d85-802f-53d7f69c83a4` | https://vocal-fairy-077fa5.netlify.app | — | 2025-10-06T20:17:34.324Z | 2025-10-06T20:17:34.377Z | — | True |
| bespoke-pika-e6b8ff | `b14c4113-fc73-4e20-ad01-8eb8a6f77906` | https://bespoke-pika-e6b8ff.netlify.app | — | 2025-10-06T20:01:56.765Z | 2025-10-06T20:02:01.892Z | — | True |
| euphonious-melomakarona-180cae | `86088aaf-a0eb-4bdc-bf31-85279a856227` | https://euphonious-melomakarona-180cae.netlify.app | — | 2025-10-06T19:45:38.693Z | 2025-10-06T19:45:38.746Z | — | True |
| heartfelt-sorbet-8c65ac | `3ad6cb16-6a48-428d-8973-1bda26ff9284` | https://heartfelt-sorbet-8c65ac.netlify.app | — | 2025-10-06T15:28:21.591Z | 2025-10-06T15:28:21.631Z | — | True |
| delightful-blini-e02260 | `77a60c1b-e690-46fa-a7d7-c041ccb50aec` | https://delightful-blini-e02260.netlify.app | — | 2025-10-06T15:18:02.973Z | 2025-10-06T15:18:11.335Z | — | True |
| dainty-blancmange-daeec0 | `49c2b3bc-7306-47ac-9995-cbcd9106a38f` | https://dainty-blancmange-daeec0.netlify.app | — | 2025-10-06T15:13:25.436Z | 2025-10-06T15:13:27.852Z | — | True |
| gleaming-cranachan-9e2f38 | `7b1c027d-739b-4adf-9213-6bef9f5edef6` | https://gleaming-cranachan-9e2f38.netlify.app | — | 2025-10-05T18:20:36.668Z | 2025-10-05T18:20:36.725Z | — | True |
| luminous-duckanoo-955424 | `33f864cb-7a99-420e-8bc1-4028ab57d9a1` | https://luminous-duckanoo-955424.netlify.app | — | 2025-10-05T18:19:39.805Z | 2025-10-05T18:19:42.949Z | — | True |
| superb-conkies-276719 | `2079368b-67fe-48d3-b9f0-cac6a1b00300` | https://superb-conkies-276719.netlify.app | — | 2025-10-05T17:22:47.616Z | 2025-10-05T17:22:51.110Z | — | True |
| sparkling-queijadas-e20bd4 | `72750e9f-0d1a-4d58-b4a2-4d49e1772139` | https://sparkling-queijadas-e20bd4.netlify.app | — | 2025-10-05T17:02:51.057Z | 2025-10-05T17:02:54.247Z | — | True |
| tourmaline-fenglisu-a4b579 | `5591dc06-b7fd-4fba-9b8a-bb7eeaa759c8` | https://tourmaline-fenglisu-a4b579.netlify.app | — | 2025-10-05T16:03:41.652Z | 2025-10-05T16:03:41.698Z | — | True |
| dainty-kelpie-52b102 | `e5551196-8aa0-4794-961e-086575184e7d` | https://dainty-kelpie-52b102.netlify.app | — | 2025-10-05T15:40:32.102Z | 2025-10-05T15:40:35.333Z | — | True |
| aesthetic-sunshine-eee816 | `3ce08f81-98da-425c-9874-2db717b9b495` | https://aesthetic-sunshine-eee816.netlify.app | — | 2025-10-05T15:18:30.469Z | 2025-10-05T15:18:33.606Z | — | True |
| majestic-granita-14c40d | `266f5728-dd52-42ec-855a-9c96d8e4aa01` | https://majestic-granita-14c40d.netlify.app | — | 2025-10-05T15:10:00.955Z | 2025-10-05T15:10:05.310Z | — | True |
| super-sunburst-d1943b | `e08b9df7-ed7c-45e3-9fbc-4a96e9332636` | https://super-sunburst-d1943b.netlify.app | — | 2025-10-05T06:52:44.214Z | 2025-10-05T06:52:47.300Z | — | True |
| voluble-sawine-b5198c | `f8a8247b-2be1-4cb0-8e07-5a084d2ff98d` | https://voluble-sawine-b5198c.netlify.app | — | 2025-10-05T01:24:07.336Z | 2025-10-05T01:24:11.276Z | — | True |
| relaxed-pika-ba3643 | `81305188-dc53-4e42-9dab-6c9acd17dc4b` | https://relaxed-pika-ba3643.netlify.app | — | 2025-10-05T01:14:57.240Z | 2025-10-05T01:15:00.016Z | — | True |
| wondrous-banoffee-085b93 | `03b4581d-70a7-4966-b331-6eba18415c39` | https://wondrous-banoffee-085b93.netlify.app | — | 2025-10-05T01:06:16.790Z | 2025-10-05T01:06:20.120Z | — | True |
| guileless-queijadas-8a0493 | `c9db47e1-9770-4471-a327-093185f81612` | https://guileless-queijadas-8a0493.netlify.app | — | 2025-10-05T00:54:35.460Z | 2025-10-05T00:54:35.498Z | — | True |
| exquisite-arithmetic-29544e | `4bb45457-4785-4eba-883b-f072595b2467` | https://exquisite-arithmetic-29544e.netlify.app | — | 2025-10-05T00:33:36.083Z | 2025-10-05T00:33:38.801Z | — | True |
| benevolent-torrone-77e0a5 | `1518a21e-6be0-41ac-bd64-2fcbf8010e6e` | https://benevolent-torrone-77e0a5.netlify.app | — | 2025-10-05T00:21:35.066Z | 2025-10-05T00:29:14.285Z | — | True |

---

## 5. WEBSITE → PORTAL DATA DEPENDENCIES (what breaks when a portal is down)

Design principle in `site.js`: baked HTML is the ground truth and is only overwritten by non-empty live data, so **no page blanks**; what changes is *freshness* and a few interactive features. Verified by reading `applySlots/applyStatus/applyLists/applyPress/applySupporters/applyCtas/applyRegLinks` and by the live probes.

### 5A. If the MEMBER portal API (`medx-user-portal.onrender.com`) is down

| Page(s) | What is affected | What the visitor sees |
|---|---|---|
| **every page** (nav + footer) | "Log in or sign up" opens the in-page modal → `POST /api/auth/login` fails → modal shows "Couldn't reach Med&X right now. Open the portal directly →" (which would also be down). Bell / "My next event" / account menu unavailable for signed-in members. | Baked page renders normally; sign-in unusable |
| every page | `/api/public/site|content|status` 4.5 s timeouts → `localStorage.medx_live_cache` (last good) or `data/site-snapshot.json` (2026-07-28 EN / 2026-07-03 HR) is painted; `__MEDX_PORTAL_OK=false` | Prices/dates/status from the last cache or snapshot — currently **stale** vs live in one place: live gala `regular` = 175, snapshot says 150; announcement strips stay hidden |
| index, plexus, plexus-attend, plexus-gala, events, faq, get-involved, book-of-abstract (+ HR) | registration CTAs keep their deep-link hrefs but the destination is down; the **dead-letter band** ("The portal is taking a moment to open.") appears with a Netlify `dead-letter` form after the CTA section | fallback capture works (Netlify), registration itself impossible |
| donate, hr/donate | "Give now on our secure checkout" opens `…/donate/checkout` → nothing loads (no Stripe session) | donations by card impossible; the "Send my details" path still works (Netlify `support-inquiry`) |
| biomedical-forum, hr/biomedical-forum | "Enter the Forum membership portal" dead; consideration form falls back to Netlify `forum-consideration` automatically | membership entry impossible, contact capture OK |
| accelerator, hr/accelerator | "Go to the Med&X portal →" / apply dead | applications impossible |
| index, supporters (+ HR) | `/api/public/supporters` fails → baked 25-tile wall stays (identical to live today) | no visible change |
| plexus, plexus-gala, speakers pages with `site:speakers` | baked keynote cards stay (they are already what shows today) | no visible change |
| every page | pageview beacon lost | no visible change |
| portal.html, hr/portal.html | all buttons and the Mac/Windows download links: downloads still work (GitHub), portal buttons dead | — |

Pages with **no** member-portal data dependency beyond the nav sign-in: about, advisory-council, bylaws, contact, network, press, privacy, refund, terms, speakers, 404, heritage — they render fully from baked HTML.

### 5B. If the ADMIN portal API (`medx-admin-portal.onrender.com`) is down

| Page(s) | What is affected | What the visitor sees |
|---|---|---|
| press, hr/press | `GET admin/api/public/press` fails (or, as today, returns `[]`) → baked fallback cards remain | **no visible change today** — the live feed is empty anyway; verified live: `releases: []` |
| any rendered press card "Read the announcement" | would link to `admin/api/public/press/<slug>` | n/a while the feed is empty |
| footer "Team sign-in" (every page) | link dead | staff-only impact |
| signed-in admins | "Admin console" menu item dead | staff-only |

The website reads `content` and `status` from the **member** portal only; the admin portal's copies of those endpoints exist but are not used (and lack the `_hr` fields). So an admin-portal outage has **zero** effect on public content beyond the newsroom feed, which is empty.

### 5C. If BOTH are down
Everything in 5A + 5B; plus the site still serves fully from Netlify (static + service worker), Netlify Forms (newsletter, contact, support-inquiry, forum-consideration, dead-letter) keep capturing, GitHub app downloads and the Building Bridges Google Form keep working, calendar links keep working (client-side).

### 5D. Data that only exists at build time
`data/site-snapshot.json` (EN) bundles `site`, `content`, `status`, `impact`, `supporters` from the member portal at snapshot time (`scripts/build-snapshot.sh`, `MEDX_PORTAL_BASE=https://medx-user-portal.onrender.com`). It is the only place `/api/public/impact` is consumed, and `site.js` ignores that key. The HR snapshot is a separate, older file that was never regenerated (2026-07-03) and lacks `impact`/`supporters`.

---

## Appendix — probe artefacts
Raw bodies/headers are in the session scratchpad (`probes/*.body`, `netlify/*.json`, `live/` mirror of the fetched site, `fetch-report.txt`, `inventory_rows.json`). Nothing was written to the portals or to Netlify.
