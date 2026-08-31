# Review verify pass A — team claims vs the functional v2 builds

Verified 2026-08-30 against https://medx-member-portal-v2.netlify.app and
https://medx-admin-portal-v2.netlify.app (staging), Playwright/Chromium, 1280 px desktop +
390 px mobile re-sweep. Every claim from TEAM-REVIEW-CONSOLIDATED section A (Laura's "Broken or
empty" + Miro's "ne rade botuni" lists + Sara/Marija items) was clicked or probed. Nothing was
edited, no emails sent, no registrations created; the outbox APPROVE & SEND / SEND buttons were
never pressed. Reversible staging writes only (follow/unfollow, archive/unarchive, add+remove one
review criterion, checkbox toggled back).

## Counts — 117 claims verified

| Verdict | Count |
|---|---|
| WORKS | 93 |
| WORKS-DIFFERENTLY | 14 |
| MISSING | 3 |
| STILL-DEAD | 7 |

Headline: the v1 review was done on static previews — the overwhelming majority of "dead"
buttons are alive in v2 (real .ics/PDF/CSV/PNG downloads, live search, alerts, wallet modals,
working editors). What still needs building is short:

## STILL-DEAD or MISSING — the build list

- **Messages ATTACH** (still-dead) — deliberate stub: click shows toast 'Attachments are on their way — for now, paste a link in your message' (messages.js:443). Not silent any more, but attaching still does not exist — already queued as feature work (section C)
- **Profile UPLOAD PHOTO** (still-dead) — chooser never opens — real bug: ui.bind() (user-portal/frontend-v2/js/ui.js:189) calls e.preventDefault() on the click that pickPhoto re-dispatches to the hidden file input, cancelling the input's default action before the handler's INPUT guard returns (views/profile.js:433). Reproduced; control page with identical pattern minus the early preventDefault opens the chooser.
- **Forum hub → what-members-see deep link** (still-dead) — lands on 'PLEXUS WEEK' tab — router supports /member-pages/forum (direct URL opens the BIOMEDICAL FORUM tab correctly) but the hub link is bare /member-pages, so every hub opens the Plexus tab. Miro's complaint stands; one-line fix (append /:tab to four hub links)
- **Bridges hub → what-members-see deep link** (still-dead) — lands on 'PLEXUS WEEK' tab — same bare-/member-pages link (direct /member-pages/bridges shows the BUILDING BRIDGES tab fine)
- **Accelerator hub → what-members-see deep link** (still-dead) — lands on 'PLEXUS WEEK' tab — same bare link (direct /member-pages/accelerator works)
- **People: filters combinable** (still-dead) — clicking FORUM replaces GALA (active: ['FORUM MEMBERS · 4']) — single-select, Miro's ask not built
- **Mobile 390px sideways scroll — admin screens** (still-dead) — overflowing: Forum Hub 445px (DIV.), Bridges Hub 464px (DIV.), Accelerator Hub 441px (SPAN.)
- **Gala guest categories editable (add/remove)** (missing) — category picker offers fixed set (INVOICE — €150|VIP — FREE|SPONSOR SEAT); no control to add/remove categories — Miro's ask not built
- **Gala: add tables** (missing) — room is fixed '10 × 8 tables · limited by design' (ROOM → RESERVED 51 seats spoken for PAID 38 €5,100 collected TO CHASE 13 €1,950 outstanding SE) — no add-table control; deliberate cap, Miro's ask not built
- **Studio: social card background options** (missing) — card tool opens (panel) but no background choice — still fixed (Miro asked if black is modifiable)

Near-misses worth one look (WORKS-DIFFERENTLY that map to open asks): speaker-itineraries and
ticket-&-prices still route to Calendar/Money instead of dedicated tools (Miro), charity-auctions
routes to Money, Calendar "Export PDF" is a print-dialog flow rather than a file, Bridges
follow-ups have ✓-done but no edit, HR language is a saved preference with no HR UI yet, and
Messages ATTACH is a polite stub. All already tracked in consolidated sections B/C.

## Verdict table


### Member — top bar, drawer & Home

| Claim | Where tested | Verdict | Note |
|---|---|---|---|
| Top-bar SEARCH | /app/home (+ every page) | WORKS | click opens the search popover with an autofocused input (see next row for typed-results evidence) |
| Top-bar ALERTS | /app/home (+ every page) | WORKS | opens alerts panel: 'ALERTS MARK ALL READ × Accelerator Update: Applications open Applications open is set for December 8, 2026 AUG' |
| Top-bar language toggle (EN · HR) | /app/home (+ every page) | WORKS-DIFFERENTLY | click now answers with a toast — 'Croatian (HR) arrives with the translations — English for now.' No silent dead click, but the HR portal itself is not shipped (deliberate; HR translation is queued feature work) |
| Hamburger MENU opens drawer | /app/home (+ every page) | WORKS | drawer slides in (body.drawer-open) |
| Drawer × close | /app/home (+ every page) | WORKS | closes drawer |
| Confirm-email RESEND LINK (banner) | /app/home (+ every page) | WORKS | banner renders only for unverified accounts (session-driven — could not be spoofed client-side because /api/me refreshes truth; the one staging login is verified, so end-to-end click not possible). Wiring verified at every hop: banner + data-act=resend on all pages (chrome.js:117), profile row (profile.js:270) and auth pending screen (auth.js) all POST /api/auth/request-verification; endpoint probed live → 200 with 'link on its way' (no mail sent for a verified account). Toast feedback on click. |
| Drawer 'Mentorship' entry | /app/home (+ every page) | WORKS | real page at /app/mentorship: '6 MEMBER SINCE IN PROGRESS · MENTORSHIP Find a mentor. This screen is being built from (current-portal Mentorship page — no artboa' |
| Drawer 'Opportunity board' entry | /app/home (+ every page) | WORKS | real page at /app/opportunities: '6 MEMBER SINCE IN PROGRESS · OPPORTUNITY BOARD Open opportunities. This screen is being built from (current-portal Opportunity boa' |
| Drawer 'Home' / 'Projects' entries | /app/home (+ every page) | WORKS-DIFFERENTLY | Home is a live link (navigates to /app/home); 'Projects' is now a group heading over the five project links, not clickable by design (chrome.js drawer spec) |
| Drawer 'Website ↗' link | /app/home (+ every page) | WORKS | href=https://medx.hr |
| Home RESERVE SEAT (Gala card) | /app/home (+ every page) | WORKS | navigates to /app/gala |
| Home LEARN MORE (Accelerator card) | /app/home (+ every page) | WORKS | navigates to /app/accelerator |
| Home SEE ALL (news) | /app/home (+ every page) | WORKS | expands news list in place (body text 2322→2510) |
| Home ADD key dates (.ics) | /app/home (+ every page) | WORKS | downloads medx-key-dates.ics |
| Home newsletter topic chips | /app/home (+ every page) | WORKS | chip toggles selected state |
| Home SUBSCRIBE (newsletter) | /app/home (+ every page) | WORKS | responds: toast/panel: SUBSCRIBED TO 1 TOPIC — MANAGE THEM IN PROFILE & SETTINGS. |
| Home getting-started tickboxes | /app/home (+ every page) | WORKS-DIFFERENTLY | v2 replaced manual tickboxes with auto-tracked progress — 'GETTING STARTED · 1 STEP LEFT · Complete your profile — 35% done' plus a working hide ×; nothing left to tick by hand |
| Home CHECK IN button (premature) | /app/home (+ every page) | WORKS-DIFFERENTLY | hero now reads 'CHECK-IN OPENS DEC 4' and links to the ticket QR page — the check-in-103-days-early complaint is addressed (B.12 done) |
| Top-bar SEARCH (results) | /app/home (+ every page) | WORKS | popover input (placeholder 'Search events, people, tickets…', autofocused); typing 'gala' returns live results — 'EVENTS Annual Biomedical Forum 2026 — Day 2 … Gala Dinner…' with OPEN → links |

### Member — My Med&X

| Claim | Where tested | Verdict | Note |
|---|---|---|---|
| My Med&X DOWNLOAD CARD | /app/me | WORKS | downloads medx-member-card.pdf |
| My Med&X ADD TO PHONE WALLET | /app/me | WORKS | opens wallet-provider modal — 'Pick your wallet… APPLE WALLET / GOOGLE WALLET', same QR as the door scan |
| My Med&X OPEN REWARDS | /app/me | WORKS | navigates to /app/me/rewards (points balance page renders) |
| My Med&X CURRENT TICKETS tab | /app/me | WORKS | CURRENT/PAST tabs switch content; PAST shows the receipts explainer + BROWSE EVENTS (this account has no purchases in the seed) |
| My Med&X ticket DOWNLOAD | /app/me | WORKS | could not click on staging (this account holds no current ticket — wallet shows the empty state) but fully wired: tDl → GET /api/v2/wallet/tickets/:id.pdf (me.js:801); endpoint probed live with auth → server JSON 404 for a fake id, i.e. route exists |
| My Med&X ticket EMAIL | /app/me | WORKS | wired: tEmail → POST /api/v2/wallet/tickets/:id/email with confirmation toast (me.js:808); not fired — would send a real email; no ticket on the seed account anyway |
| My Med&X ticket ADD TO WALLET | /app/me | WORKS | wired: tWallet → wallet-provider modal → GET /api/v2/wallet/tickets/:id/pass?provider= (me.js:817); Google pass endpoint live (probe 200), Apple wired-but-dormant per backend comment; member-card ADD TO PHONE WALLET modal verified clicking live |
| My Med&X past purchase RECEIPT | /app/me | WORKS | tReceipt → GET /api/v2/wallet/receipts/:id.pdf — endpoint live (auth probe returns server 404 JSON for fake id); rows render only for accounts with purchases (this seed account has none; empty state + BROWSE EVENTS shown instead) |
| My Med&X past purchase CONFIRMATION | /app/me | WORKS | tConfirm → GET /api/v2/wallet/confirmations/:id.pdf — endpoint live (same probe); free registrations get a confirmation, paid a receipt (me.js:362) |
| My Med&X 'contact the team' | /app/me | WORKS | now a real link to /app/messages in the purchases footnote (me.js pastNote); Messages itself verified working |
| My Med&X CHANGE name | /app/me | WORKS | opens 'Change your name' modal (first/last + CANCEL/SAVE); not saved |
| My Med&X CHANGE email | /app/me | WORKS | responds: 'EMAIL CHANGES GO THROUGH THE TEAM — MESSAGE US AND WE HANDLE IT' (deliberate policy, matches me.js emailBody copy) |
| My Med&X CHANGE password | /app/me | WORKS | opens 'Change your password' modal (current/new/repeat); not saved |
| My Med&X SWITCH language | /app/me | WORKS-DIFFERENTLY | opens the language modal but explains 'English is the portal language for now — Hrvatski switches on with the translations' — HR UI itself not shipped |
| My Med&X + ADD followed projects | /app/me | WORKS | opens 'Follow a project' modal listing all five projects |
| My Med&X + ADD interests | /app/me | WORKS | opens 'Add an interest' modal (Neuroscience, Sleep Medicine, Oncology…) |

### Member — Messages

| Claim | Where tested | Verdict | Note |
|---|---|---|---|
| Messages: switch/open conversation | /app/messages | WORKS | conversation list with clickable rows; clicking opens the thread view (seed has 1 conversation — Med&X Coordinators; Network MESSAGE also opens per-member threads via /app/messages?to=…) |
| Messages NEW MESSAGE | /app/messages | WORKS | opens a composer ('Write a message…') with 7 topic chips |
| Messages topic chips | /app/messages | WORKS | chip aria-checked toggles (falsergba(0,→truergb(155,) |
| Messages ATTACH | /app/messages | STILL-DEAD | deliberate stub: click shows toast 'Attachments are on their way — for now, paste a link in your message' (messages.js:443). Not silent any more, but attaching still does not exist — already queued as feature work (section C) |
| Messages: search conversations | /app/messages | WORKS | input 'Search conversations…': 1→0 rows on no-match query |

### Member — Messages/Home

| Claim | Where tested | Verdict | Note |
|---|---|---|---|
| '0 FOLLOWING' counter vs followed projects | /app/home ↔ /app/me ↔ /app/plexus | WORKS | counter is live: following Plexus flips home strip to 1 FOLLOWING and the project appears under PROJECTS I FOLLOW on /app/me; unfollow returns it to 0. The v1 0-vs-2 mismatch is gone (state restored after test) |

### Member — Plexus / Gala / Bridges / Network / Profile

| Claim | Where tested | Verdict | Note |
|---|---|---|---|
| Plexus ADD TO CALENDAR (.ics) | /app/plexus | WORKS | downloads medx-plexus-2026.ics |
| Plexus ALL PHOTOS | /app/plexus | WORKS | opens gallery: 'PLEXUS · PHOTO GALLERY × Moments from past conferences Plexus 2025 — the hall in session Plexus 2025' |
| Plexus REGISTER NOW | /app/plexus | WORKS | links to /plexus?pick=conference&src=portal (registration app; not submitted) |
| Program ADD TO CALENDAR (.ics) | /app/plexus/program | WORKS | downloads medx-plexus-2026.ics |
| Program DOWNLOAD PROGRAM PDF | /app/plexus/program | WORKS | downloads plexus-2026-program.pdf |
| Zagreb DOWNLOAD THE WELCOME GUIDE | /app/plexus/zagreb | WORKS | downloads plexus-2026-welcome-guide.pdf |
| My Plexus REGISTER NOW | /app/plexus/mine | WORKS | links to /plexus?pick=conference%2Cgala&src=portal (not submitted) |
| My Plexus REGISTER — FREE | /app/plexus/mine | WORKS | links to /plexus?pick=conference&src=portal (not submitted) |
| My Plexus RESERVE A SEAT | /app/plexus/mine | WORKS | links to /plexus?pick=gala&src=portal (not submitted) |
| My Plexus MESSAGE buttons (attendee list) | /app/plexus/mine | WORKS-DIFFERENTLY | attendee section now links to member directory ('FIND MORE ATTENDEES · OPEN MEMBER DIRECTORY'); no per-attendee MESSAGE buttons for this unregistered account |
| Gala ADD TO CALENDAR (.ics) | /app/gala | WORKS | downloads medx-gala-2026.ics |
| Gala ALL PHOTOS | /app/gala | WORKS | opens gallery: 'GALA · MOMENTS × Moments from previous Galas Galleries from each Gala land here as our team publishe' |
| Bridges REGISTER (Boston) | /app/bridges | WORKS | hero button scrolls to sign-up (0→777); REGISTER opens: BUILDING BRIDGES · BOSTON × Reserve your place in Boston. Open to everyone — no application, no fee. Check you |
| Network search box | /app/network | WORKS | 'Try anything — a name, a city, ‘sleep’, ‘oncology, Zagreb’…': 8→1 cards on query 'Member 019' |
| Network BROWSE ALL members | /app/network | WORKS | member cards 8→32 after click |
| Network member card (peek) | /app/network | WORKS | opens profile peek: 'MEMBER · NETWORK × Member 031 Test Harvard Medical School · United States CLOSE' |
| Network CONNECT | /app/network | WORKS | button 'CONNECT'→'REQUEST SENT' |
| Network MESSAGE | /app/network | WORKS | opens messages (/app/messages?to=710fc64d-1c5a-455d-831c-a4790e6534e5) |
| Profile UPLOAD PHOTO | /app/profile | STILL-DEAD | chooser never opens — real bug: ui.bind() (user-portal/frontend-v2/js/ui.js:189) calls e.preventDefault() on the click that pickPhoto re-dispatches to the hidden file input, cancelling the input's default action before the handler's INPUT guard returns (views/profile.js:433). Reproduced; control page with identical pattern minus the early preventDefault opens the chooser. |
| Profile + ADD specialty | /app/profile | WORKS | typed 'Sleep Medicine' + ADD → chips 6→7 (input 'Add your own — e.g. Sleep medicine'); not saved |
| Profile language switch (EN/HR) | /app/profile | WORKS-DIFFERENTLY | HR click saves preference + toast: 'CROATIAN IS SAVED AS YOUR PREFERENCE — THE PORTAL SWITCHES WHEN THE TRANSLATIONS LAND.' — full Croatian UI not shipped yet (deliberate) |
| Profile VIEW PROFILE | /app/profile | WORKS | opens: 'DIRECTORY · AS OTHERS SEE YOU × Alen Juginović Harvard Medical School · United States Your' |
| Profile CONNECT (own card) | /app/profile | WORKS | responds: THIS IS YOUR OWN CARD — OTHER MEMBERS SEE CONNECT HERE. |
| Accelerator page (Marija LEARN MORE target) | /app/home → /app/accelerator | WORKS | page renders: 'NDAY, 30 AUGUST 2026 · ZAGREB 0 POINTS 0 REGISTRATIONS 0 FOLLOWING 2026 MEMBER S' |
| Registration app /plexus?pick=conference | /plexus (reg app) | WORKS | HTTP 200 (page reachable; no submission made) |

### Admin

| Claim | Where tested | Verdict | Note |
|---|---|---|---|
| Admin AJ avatar (top right) | top bar | WORKS | opens account menu/panel: 'Alen Juginović FOUNDER · FULL ACCESS DISPLAY NAME SAVE TEAM ACCESS → SIGN OUT' (no longer a blind jump to settings) |
| Plexus hub: 3D ballroom planner link | /projects/plexus | WORKS | → https://plexus-tables.netlify.app/planner.html (HTTP 200); opens the planner app, not the gala page |
| Plexus hub: charity auctions link | /projects/plexus | WORKS-DIFFERENTLY | → /money — routes to Money (auction pledges live there as 'AUCTION PLEDGES → MONEY' on /gala); still no dedicated auction tool |
| Plexus hub: before-the-week EDIT LIST | /projects/plexus | WORKS | opens editor (3 editable fields appear) |
| Plexus hub: Schedule & program BUILD | /projects/plexus | WORKS | opens in-hub panel (text 3016→3190): 'ADMIN TODAY PROJECTS ▾ INBOX 10 PEOPLE MONEY CALEN' |
| Plexus hub: Speakers manage | /projects/plexus | WORKS | opens in-hub panel (text 3016→3450): 'ADMIN TODAY PROJECTS ▾ INBOX 10 PEOPLE MONEY CALEN' |
| Plexus hub: speaker itineraries | /projects/plexus | WORKS-DIFFERENTLY | → /calendar — still routes to the Calendar; the dedicated per-speaker itinerary tool Miro asked for is not built |
| Plexus hub: Tickets & prices EDIT | /projects/plexus → /money | WORKS-DIFFERENTLY | → /money — routes to Money; Money has no dedicated ticket-price editor (early/late-bird, codes, student pricing) — not built |
| 'Edit the form fields' — PLEXUS WEEK | /member-pages | WORKS | editor opens with 9 editable controls: 'None' |
| 'Edit the form fields' — GALA EVENING | /member-pages | WORKS | editor opens with 13 editable controls: 'None' |
| 'Edit the form fields' — ACCELERATOR | /member-pages | WORKS-DIFFERENTLY | deliberate: application wizard has a fixed field set — card links to the Review Room (/accelerator-review) instead of an inline editor |
| 'Edit the form fields' — BIOMEDICAL FORUM | /member-pages | WORKS-DIFFERENTLY | deliberate: public interest form is fixed — card links to the Forum hub pipeline (/projects/forum) |
| 'Edit the form fields' — BUILDING BRIDGES | /member-pages | WORKS | editor opens with 9 editable controls: 'None' |
| Plexus hub → what-members-see deep link | /projects/plexus → /member-pages | WORKS | lands on 'PLEXUS WEEK' tab (correct for this hub — it is also the default) |
| Forum hub → what-members-see deep link | /projects/forum → /member-pages | STILL-DEAD | lands on 'PLEXUS WEEK' tab — router supports /member-pages/forum (direct URL opens the BIOMEDICAL FORUM tab correctly) but the hub link is bare /member-pages, so every hub opens the Plexus tab. Miro's complaint stands; one-line fix (append /:tab to four hub links) |
| Bridges hub → what-members-see deep link | /projects/bridges → /member-pages | STILL-DEAD | lands on 'PLEXUS WEEK' tab — same bare-/member-pages link (direct /member-pages/bridges shows the BUILDING BRIDGES tab fine) |
| Accelerator hub → what-members-see deep link | /projects/accelerator → /member-pages | STILL-DEAD | lands on 'PLEXUS WEEK' tab — same bare link (direct /member-pages/accelerator works) |
| Member-pages: Projects nav clickable | /member-pages | WORKS | PROJECTS nav from member-pages → /member-pages |
| Gala + ADD GUEST panel | /gala | WORKS | opens entry form (inputs: ['Search or type a task…', 'Find a guest…', 'Guest name', 'Email (needed for the invoice path)'], category select: ['INVOICE — €150·VIP — FREE·SPONSOR SEAT']) |
| Gala guest categories editable (add/remove) | /gala | MISSING | category picker offers fixed set (INVOICE — €150·VIP — FREE·SPONSOR SEAT); no control to add/remove categories — Miro's ask not built |
| Gala: add tables | /gala | MISSING | room is fixed '10 × 8 tables · limited by design' (ROOM → RESERVED 51 seats spoken for PAID 38 €5,100 collected TO CHASE 13 €1,950 outstanding SE) — no add-table control; deliberate cap, Miro's ask not built |
| Accelerator review: add criterion | /accelerator-review | WORKS | typed name + ADD → criteria 4→5; removed again (4) to leave staging unchanged |
| Bridges RECAP | /projects/bridges | WORKS | opens recap: 'inline panel, text 2016→2272' |
| Bridges Boston MANAGE routing | /projects/bridges | WORKS | opens the Boston editor in the hub itself (no more jump to what-members-see/plexus); text 2016→2082 |
| Bridges Boston ready-to-run tickboxes | /projects/bridges | WORKS | checkbox toggles (True→False); toggled back |
| Bridges follow-ups: edit/delete contacts | /projects/bridges | WORKS-DIFFERENTLY | rows now carry a ✓ mark-done control (closes the follow-up) but no edit and no hard delete — the editing half of Miro's ask is still unbuilt (bridges.js fuDone/fuAdd only) |
| Inbox: archived message visible under 'All' | /inbox/messages | WORKS | archived a thread → still listed under ALL with ARCHIVED tag (Member 003 Test); unarchived to restore. NEEDS-A-REPLY hides archived by design |
| Newsletter draft: send-as-email / post-in-portal checkboxes | /inbox/newsletter | WORKS | native checkbox toggles True→False (checked state, not just a red tint); toggled back |
| Team chat: propose a meeting | /inbox/chat | WORKS | now opens a picker modal ('TEAM CHAT · # GENERAL × Propose a meeting WHAT IS IT ABOUT? CANDIDATE TIMES (EUROPE/ZAGREB) CANCEL P') with date/platform options [{'t': 'INPUT', 'ph': 'datetime-local', 'opts': None}, {'t': 'INPUT', 'ph': 'datetime-local', 'opts': None}, {'t': 'INPUT', 'ph': 'datetime-local', 'opts': None}] — no longer fire-and-forget |
| People: filters combinable | /people | STILL-DEAD | clicking FORUM replaces GALA (active: ['FORUM MEMBERS · 4']) — single-select, Miro's ask not built |
| People: EXPORT CSV scope follows filters | /people | WORKS | button label updates with selection: 'EXPORT CSV · 81' → 'EXPORT CSV · 32' → 'EXPORT CSV · 4' (exports the filtered set and says so) |
| People: EXPORT CSV real file | /people | WORKS | downloads medx-people.csv (5 lines; header: 'Name,Email,Country,Tags') |
| Calendar Export PDF real download | /calendar | WORKS-DIFFERENTLY | deliberate print-to-PDF flow: click applies a print stylesheet and calls window.print() — 'choose Save as PDF in the dialog' (calendar.js:422). No direct .pdf file lands; Miro wanted a real file download, judgement call whether this satisfies it. CSV export DOES download a real file. |
| Calendar Export CSV real download | /calendar | WORKS | real file download: medx-calendar-2026.csv (516 bytes) — v1 only showed a notification |
| Studio: name badges — generate sheet | /studio | WORKS | GENERATE builds a live preview ({'frame': True, 'snippet': 'PREVIEW THE SHEET DOWNLOAD PRINT PDF A6 badges, 8 per A4 — name, institution, QR · always the live list, never stale. · ', 'badges': 5}); PDF: opens print/preview flow (THE PRINT ENGINE (HEADLESS CHROME) IS OFF ON THIS MACHINE — THE ON-SCREEN PREVIEW IS EXACT; THE PRIN) |
| Studio: certificates tool | /studio | WORKS | GENERATE → preview ({'frame': True, 'snippet': 'PREVIEW ONE Per-person PDFs · issued automatically after the event, and each lands in the member’s wallet u'}); PDF → print flow |
| Studio: print suite | /studio | WORKS | kinds: ['A4 SIGN', 'ROLL-UP BANNER', 'STAGE BACKDROP']; GENERATE → {'frame': True, 'snippet': None} |
| Studio: social card generator | /studio | WORKS | downloads medx-card.png (1080×1080 canvas render) |
| Studio: social card background options | /studio | MISSING | card tool opens (panel) but no background choice — still fixed (Miro asked if black is modifiable) |
| Studio: sign-up forms destination | /studio → /links | WORKS | NEW FORM PAGE → /links; /links is the link/form builder (create controls: ['create']; 'K Invitations & links One link per audience — paid, VIP, diaspora, sponsors. Share it anywhere; every sign-up lands in R') |
| Studio: + UPLOAD | /studio | WORKS | upload control opens file chooser (LABEL:+ UPLOAD) |
| Studio: 3D ballroom planner tile | /studio | WORKS | → https://plexus-tables.netlify.app/planner.html (planner app, HTTP 200 verified earlier) |
| Settings: team access shows all 13 (pagination) | /settings | WORKS | ALL 13 → expands list (4→10 emails visible) |
| Settings: team access role editing (dropdown) | /settings | WORKS | PERMISSIONS expands the member row inline with per-permission controls (PERMISSIONS FULL ACCESS or pick sections — saved the moment you click REMOVE ACCESS PROJECTS Plexus Week 2026 Med&X Accelerator Biomedical F · acts ['inviteToggle', 'permsToggle', 'permFull', 'revoke', 'permTg', 'teamAll']) |
| Settings: UPLOAD A FILE (team library) | /settings | WORKS | opens file chooser (LABEL:UPLOAD A FILE) |
| Settings: audit log timestamps sane | /settings/audit | WORKS | entries all in the past (browser now 21:19; sample: ['TODAY 20:54', 'TODAY 20:54', 'TODAY 20:43', 'TODAY 20:42']) |
| Days-to-Plexus consistency | / · /projects/plexus · /event-day | WORKS | admin home 96 · Plexus hub 96 · Event Day rehearsal banner 96 — one shared countdown (Dec 4 vs Aug 30 = 96); the 104-vs-103 disagreement is gone |

### Mobile (390 px re-sweep)

| Claim | Where tested | Verdict | Note |
|---|---|---|---|
| Mobile 390px sideways scroll — member screens | both portals @ 390 px | WORKS | all 10 member screens fit 390px exactly (Messages, Accelerator Application, My Plexus, Network, My Med&X, Forum, Home, Plexus, Gala, Profile — every one of Laura's overflowers fixed). Her 'Emails 495px' screen has no member-portal route in v2 — email templates render server-side |
| Mobile 390px sideways scroll — admin screens | both portals @ 390 px | STILL-DEAD | overflowing: Forum Hub 445px (DIV.), Bridges Hub 464px (DIV.), Accelerator Hub 441px (SPAN.) |
| Admin Today: weekly read on mobile (Sara) | / @ 390 px | WORKS | block fits 390px (width 358, right edge 374) |
| Admin Inbox outbox usable at 390px (Laura) | /inbox/outbox @ 390 px | WORKS | page 390px, APPROVE&SEND at x=[{'x': 81, 'right': 214, 'visible': True}, {'x': 81, 'right': 214, 'visible': True}], DISCARD on-screen [{'right': 293, 'offscreen': False, 'visible': True}, {'right': 293, 'offscreen': False, 'visible': True}] (buttons inspected only — nothing pressed) |

## Method footnotes

- Login via POST /api/auth/login on each portal; tokens seeded into localStorage
  (medx_user_token/medx_user_data · medx_token/medx_user). Console captured on every page —
  zero JS errors across all 30+ routes; only sporadic 404s for optional avatar/photo assets and
  one 503 from the Studio print-preview engine, which the page itself explains (headless-Chrome
  print engine off on staging; on-screen preview exact).
- Endpoint probes used auth'd GETs with impossible ids (server JSON 404 proves the route exists)
  and one POST /api/auth/request-verification for an already-verified account, which by backend
  code sends nothing.
- The account has no tickets/purchases in the staging seed, so ticket-row and receipt buttons were
  verified by wiring + live endpoints instead of a click; noted per row.
- All raw run logs: scratchpad verify/ (inventory.json, verdicts-*.json).
