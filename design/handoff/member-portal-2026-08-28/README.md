# Handoff: Med&X Member Portal Redesign

## Overview
Full visual redesign of the Med&X Member Portal — the logged-in area where members register for the Plexus Conference and Gala Evening, hold QR tickets and wallet passes, apply to the Accelerator, use the Biomedical Forum, message the team, and manage their profile. **Only the visual design changes: flows, forms, and features stay as they are in the current portal.**

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code. Each opens directly in a browser (keep `support.js` and `assets/` beside them). The task is to **recreate these designs in the target codebase's existing environment** using its established patterns and libraries — or, if none exists yet, choose an appropriate framework and implement the designs there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final; recreate pixel-perfectly. All styling is inline in the HTML, so exact values can be read off any element.

## Screens
| File | Screen | Purpose |
|---|---|---|
| Portal Chrome.dc.html | Shared chrome | Top bar (menu, logo, search/alerts/EN·HR, member identity), member-stats strip, email-confirm banner, slide-out ink nav drawer. Imported by every screen. |
| Med&X Home.dc.html | Home | Rotating hero, profile-completion nudge, next-event countdown panel, project cards, Latest from Med&X + Key dates. |
| Plexus Conference.dc.html | Plexus overview | Free 2-day conference; registration CTA, program at a glance, speakers. |
| Plexus Program.dc.html | Program & Speakers | Admin-published program rows; "in preparation" empty state until published. |
| Plexus Zagreb.dc.html | Explore Zagreb | Travel/venue guidance. |
| My Plexus.dc.html | My Plexus | Member's registration state, QR pass slot, package, Gala add-on, help. |
| Gala Evening.dc.html | Gala Evening | Paid add-on (EUR 150 until Sep 1, EUR 175 after), black tie, limited seats, performers TBA. |
| Accelerator.dc.html | Accelerator overview | Program, host labs & clinics (admin-editable), what's included, selection, your application, team, FAQ. |
| Accelerator Application.dc.html | Application wizard | Restyled shell for the EXISTING 7-step wizard (see below). |
| Biomedical Forum.dc.html | Biomedical Forum | Invitation-only network; enter-code unlock, "From the Forum" live highlights feed, evening schedule, speakers. |
| Messages.dc.html | Messages (Network) | In-portal inbox: thread list + conversation + composer; official coordinators thread. |
| Profile.dc.html | Profile & settings | Identity, about (specialty chips, bio), account prefs, completion meter, directory preview. |
| My MedX.dc.html | My Med&X | Wallet: member QR card, Current tickets vs Past purchases tabs, per-ticket actions, record, settings. |
| Building Bridges.dc.html | Building Bridges in Biomedicine | Diaspora networking evenings; next event + countdown + photo, past-city recap cards (guests/connections, admin-editable), open registration — no application. |
| Network.dc.html | Network — People | One consolidated flow: smart search (one field matches names/institutions/specialties/cities/programs), "People for you" (requests first, then suggestions with reasons), "My network" (connections), browse-all. |
| Auth.dc.html | Auth flow | Welcome landing, sign in, create account (3-step: details → confirm email → in), reset password, Forum invitation-code entry. Split layout: photo panel + cream form column. |
| Mobile Portal.dc.html | Mobile app (430px) | Full portal at phone width: bottom tab bar (Home, Projects, People, Inbox, My M&X), project sub-views with back nav. The pattern source for the phone app / PWA. |
| Emails.dc.html | Email templates | 600px transactional emails: confirm-email, ticket confirmation (QR card), monthly newsletter. |
| System Pages.dc.html | 404 + maintenance | Error and downtime pages in brand voice. |
| Empty States.dc.html | Empty states | New-member first-day states: wallet, inbox, news, network — pattern: italic Fraunces line + one sentence of why + one CTA. |
| App Icon & Splash.dc.html | App icon + splash | The Fraunces ampersand mark (ink/crimson/cream variants, 1024 master) and two splash screens. |

## Product Rules (from design review — `handoff-notes.md` verbatim in this bundle)

### Admin-portal-driven content (must be editable from the admin portal)
- Home "next event" panel: event name, dates, venue, status label, countdown target, CTA labels.
- Home news items + Key dates list (names + dates).
- Project cards (statuses like PRE-REGISTRATION OPEN / BY INVITATION, dates, metas).
- Plexus program list: rows of {date/time, title, note} — conference days, networking events, Gala. "Program in preparation" empty state until published.
- Speakers list (name, role, institution, portrait, institution logo, confirmed flag).
- Accelerator host institutions (name, city, positions, blurb, logo).
- Hero photos everywhere (rotating set on Home).
- Gala performers: admin flips two slots from TBA to named (announced closer to December).

### Contact = in-portal messaging, not email
Every MESSAGE US button opens the portal inbox (`Messages.dc.html`) tied to the logged-in member — identity known server-side; replies land in the portal inbox and are visible in the admin portal. Email is fallback only. No "Ask the coordinators" form.

### Registration model
- Plexus Conference registration is FREE (both days + welcome reception). The Gala seat (EUR 150) is the only paid add-on. One external form (Render app) covers conference and/or Gala.
- After registering (and paying, if Gala), the QR pass appears in My Plexus, the My Med&X wallet, and phone wallets (Apple/Google).
- One QR opens all doors: the member-card QR encodes identity + all current registrations; per-event tickets also exist, but the member QR must admit them to anything they're registered for.

### Attendance / share cards
No "Share your Med&X" section. On registration (and payment where applicable), the system auto-generates a branded attendance card ("I'm attending Plexus 2026") and emails it. Same for a year-in-review card at year end.

### Tickets (My Med&X wallet)
- Per-ticket actions: Download PDF, Email to me, Add to wallet (Apple/Google).
- Current tickets vs Past purchases are two tabs; receipts downloadable from past purchases.

### Accelerator
- "My Application" embeds the EXISTING application system: 7-step wizard (Personal, Education, Program, Supplementary, Documents, Consent, Review) with the Application Checklist sidebar and % complete. **Do not rebuild — reuse/embed it, restyled to the brand.** `Accelerator Application.dc.html` defines the restyled shell: stepper, checklist card, footer nav, and the fully-styled Personal step (input/label/button vocabulary for all steps). Steps 2–6 in the mock are placeholders — they keep their existing fields.
- Before applications open: "Get notified" capture. Results lookup by emailed access code (AX26-XXXX).

### Misc
- Plexus is in its 9th year (not 10th).
- No abstract submissions for Plexus 2026 — feature removed everywhere.
- Profile completion: at 100% the Home profile nudge disappears and the next-event countdown panel expands full-width (see `profileComplete` prop in `Med&X Home.dc.html`).

## Implementation Notes for Claude Code
Read these before building — they resolve the ambiguities the mocks can't show.

1. **Portal Chrome is one shared component.** Every screen renders the same top bar, stats strip, email banner, and drawer (`Portal Chrome.dc.html`); the `active` value drives the drawer highlight (2px gold left border + `rgba(201,169,98,.08)` fill). `Med&X Home.dc.html` carries its own inline copy of the same chrome — in production there is only ONE implementation.
2. **State that must be server-driven, not local:** profile-completion % (drives both the Home nudge and Profile checklist — one source of truth), unread message counts (Messages list + REQUESTS badge), request counts, wallet tickets, countdown targets, and every admin-editable list (news, key dates, program rows, speakers, hosts, performers).
3. **Gala performers:** render TBA slots by default; an admin flag flips them to named performers (see `performersAnnounced` prop in `Gala Evening.dc.html` for both states). Never hardcode names.
4. **Accelerator wizard:** steps 2–6 in `Accelerator Application.dc.html` are striped placeholders on purpose — embed the existing form fields per step, restyled to the input/label vocabulary defined on step 1 (labels: 600 10px Inter, .14em tracking, `#4a4239`; inputs: `#f7f1e6` fill, 1px `rgba(25,21,18,.25)` border, 10px 12px padding, 13px text; crimson focus outline). Checklist % and the Review list must share one completion source; "Application reviewed" completes only on submit.
5. **Messaging:** every MESSAGE US button routes to the portal inbox (`Messages.dc.html`) with the member's identity attached server-side; coordinator threads carry the OFFICIAL tag. Email is a notification fallback only — no mailto: anywhere.
6. **Dates to keep consistent everywhere:** conference Dec 4–5, 2026 (free, Novinarski dom, Zagreb, capped at 100 seats); Gala Dec 5, Hotel Esplanade — EUR 150 until Sep 1 / EUR 175 after (the price flips automatically on Sep 1); Gala seats are NOT refundable (never show refund copy); Accelerator applications open Dec 8, 2026 — two-phase document review, then interviews, results by emailed access code (no fixed public close date; the window is announced at opening); Plexus is in its 9th year. No abstract submissions exist anywhere.
7. **Buttons/labels never wrap mid-button:** all micro-label CTAs get `white-space:nowrap`; button rows use flex with `gap` and `flex-wrap:wrap` so whole buttons reflow instead.
8. **Placeholders:** striped blocks with monospace labels mark spots where real content drops in — replace with admin-uploaded imagery, live QR codes, and member portraits at implementation.
9. **Screenshot artifact warning:** DOM-cloning screenshot tools mis-measure italic Fraunces at large sizes (phantom two-line overlap). Trust the browser rendering.
10. **Mobile is out of scope** in these mocks by request; desktop-first, min content width tested ≈ 920px.
11. **Email newsletter is a real service, not just UI.** The Home "Med&X Newsletter" compact rail card (right of the Latest-news list) subscribes the member's email to any-or-all project topics (All, Plexus, Gala, Accelerator, Building Bridges, Forum); preferences also manageable from Profile & settings. Separate from in-portal "get updates" follows.
12. **Network search is semantic-ish:** the single field must match across name, institution, specialty, city, and program participation — not just name substring. Suggestions carry a reason chip (shared field, attends Plexus, mutual contacts…) computed server-side.
13. **Biomedical Forum = a standing invitation-only network** (max 200 members) that gathers once a year. The invitation code JOINS the network; gathering registration is a second step. Forum members surface in the portal Network year-round.
14. **Building Bridges has NO membership application** — event registration is open to anyone; targeting copy only. Past-city recap figures (guests, new connections) are admin-editable.
15. **Accelerator "Previous cohorts" panel** auto-rotates through the real fellows (4 at a time, ~4.5s); names/placements load from the admin portal — the mock ships with the published 2024–25 alumni names from medx.hr. Current-cycle host institutions: Cleveland Clinic, Mayo Clinic, Columbia, University of Zurich.
16. **Talk Library was removed** — no menu entry, no page; revisit only when real Plexus recordings exist.
17. **Easter eggs to keep:** the Home greeting follows the clock (morning/afternoon/evening) and occasionally greets in Croatian (Dobro jutro / Dobar dan / Dobra večer, ~15% of sessions); the My Med&X member card flips on tap to a QR back with “Jedna karta, sva vrata.” Both are intentional.
18. **Auth flow** (`Auth.dc.html`): account creation is 3 steps — details → confirm email → in. Members can explore before confirming (banner nags until confirmed). The Forum invitation code works with or without an existing account; entering it creates the account inline when needed. No social logins.
19. **Mobile** (`Mobile Portal.dc.html`) is the app pattern source: 430px, bottom tab bar (HOME / PROJECTS / PEOPLE / INBOX / MY M&X — diamond indicator, no icon fonts), sticky compact top bar, project pages as pushed sub-views with back. Desktop lists shortened in the mock — carry full content at implementation; hit targets ≥ 44px. Built as a PWA/wrapped app ("Add to home screen" flow exists in the current portal — keep it).
20. **Emails** (`Emails.dc.html`): 600px, ink header with wordmark, 2px crimson/gold rule, cream body, Fraunces headlines. Ticket confirmation embeds the QR. Newsletter footer must carry Manage topics + Unsubscribe.
21. **System pages** (`System Pages.dc.html`) and **empty states** (`Empty States.dc.html`) follow one voice: italic Fraunces line, one sentence of why, one CTA. Never a bare "nothing here".
22. **Forum Feed is a real publish flow.** Admin Forum Hub has a composer (Member spotlight / Forum news / Note) that publishes to a feed; the member Biomedical Forum page renders it as "From the Forum" (newest = featured card, rest in a grid). In these mocks the two pages share one client store (localStorage key `medx_forum_feed`, identical seed on both) so a post made in admin appears on the member page immediately — at implementation back this with a real posts table + endpoint (fields: kind, tag, name/role/init or title, body, publishedAt, published bool). Unpublish hides from members but never hard-deletes. The latest post also surfaces as a slim "From the Forum" teaser on **Home** (between Latest news and Grow-your-network) and on **Network** (above People for you) — both read the same store and link to the full feed; a real build feeds all three from one endpoint.

## Admin Portal (redesign)
The current admin (30+ pages, 6 sidebar groups) was consolidated into 7 top-nav destinations. Design language: calm workspace — warm paper background `#f6f2ea`, white cards, hairline borders `rgba(32,27,22,.14)`, square corners, Inter UI 13px, Fraunces for page titles and big numbers, crimson `#9b1b22` for primary actions only. No sidebar.

| File | Destination | Consolidates (from current admin) |
|---|---|---|
| Admin Home.dc.html | Today | Dashboard, Action Center, Live Overview, Quick actions, trends, Executive Suite (as "Weekly Read"), To Do peek |
| Admin Accelerator Review.dc.html | Projects → Accelerator → Review Room | Applications, Evaluation (editable criteria), Interviews, Ranking |
| Admin Member Pages.dc.html | "What members see" from every hub | Per-project member-facing content: publish/draft rows, live-preview card, registration-form editor |
| Admin Studio.dc.html | Studio (header) | Make & store: name badges, certificates, print suite, social cards, sign-up form pages, 3D ballroom planner, brand assets, stored files |
| Admin Plexus Hub.dc.html | Projects → Plexus | Plexus Week hub, Conferences, Editions, Sign-up Forms, CME/HLK, Speakers, Schedule, Gala tools (seating, 3D Ballroom planner, Auctions, Donor Night), Live Q&A, Post-event — as 3 row-lists (Before the week / Gala evening / After), not tool-card grids |
| Admin Accelerator Hub.dc.html | Projects → Accelerator | Applications, Evaluation, Ranking, Institutions, Key dates |
| Admin Forum Hub.dc.html | Projects → Forum | Forum Feed composer (spotlights/news/notes), Members, Candidates, invitation codes, Events |
| Admin Bridges Hub.dc.html | Projects → Bridges | Events & program, invitations, reminders, post-event recaps |
| Admin Inbox.dc.html | Inbox | Outbox (approval), Email Registrants, Messages, Message members (announcements), Newsletter, Team Chat — 5 tabs |
| Admin People.dc.html | People | Member Ops directory, registrations, gala guests, team, Guest Passes |
| Admin Money.dc.html | Money | Finances (all sub-tools as quiet links), payments to chase, Board pack |
| Admin Calendar.dc.html | Calendar | Year Calendar, key dates, team To Do/tasks |
| Admin Event Day.dc.html | Event Day | Game Day control room — rehearsal mode, scanner, door list, ops map, Q&A link |
| Admin Settings.dc.html | Settings | System Health, Team Access, Audit Log, Files+Resources ("Team library"), Content/Brand/Merch studios, website & portal text |

### Admin implementation notes
0a. **Ships as an installable web app (PWA)** — runs in the Mac dock and via iPhone/iPad "Add to Home Screen"; no App Store. Build fully responsive from day one (top nav collapses to a menu; lists stack) even though these mocks are desktop-width.
0b. **Every status is a door**: any badge, count, or state pill navigates to the place where you act on it (ALL SYSTEMS OK → health checks; "4 to chase" → Money; outbox count → Inbox). Never render a dead status label.
0c. **Calm layout rule**: one white card per group of RELATED rows — never grids of same-size tool boxes. Status tag column (left, colored) + name + one-line state + one action per row. Open stat rows (numbers between hairlines, no boxes) instead of boxed KPI strips.

1. **Nothing was deleted** — every current-admin capability has a home; niche tools (Auctions, 3D planner, Merch studio) are one link deeper, not gone.
2. **The approval outbox is the spine of comms**: nothing emails members without an explicit "Approve & send" on the Inbox → Email & Outbox tab. The top-nav INBOX badge = items waiting.
3. **"What members see" editors** live inside each project hub and write straight to the member portal (status label + detail line + button); show a "Saved ✓" confirmation.
4. **Event Day activates automatically** on event dates; Rehearsal mode is a visible amber state with test data only. Scanner works offline and syncs later.
5. **AI kept but quiet**: Executive Suite = collapsed "Weekly Read" row on Today, advice-only with per-line links.
6. **All numbers are live database reads** (registrations, seats, € figures, countdowns) — one source of truth shared with the member portal; the Forum "days to gathering" in the mock is hardcoded, compute it in production.
7. **Roles**: Admin (full) and Scanner staff (Event Day only) — permissions per section behind the Permissions button, not a matrix screen.
8. English UI for v1; HR toggle can come later (board pack already offers EN/HR export).
9. **Sponsors & donors ledger** (Money): pledge → invoiced → paid → thanked, one row each; Donor Night pledges and auction results land here automatically; "Send thank-you" queues in the Outbox.
10. **Gala waitlist**: opens automatically when seats sell out; a freed seat is offered to the first in line with 24 h to accept, then passes on. No refunds — a seat frees only if admin cancels it manually.
11. **Morning-after survey**: auto-queues in the Outbox at 08:00 the day after each event (3 questions max); admin approves like any email; results feed the Board pack.
12. **Door-staff link** (Event Day): tokenized URL opening the scanner only — no account, expires when the event ends.
13. **Publish news once, two destinations**: the news composer has checkboxes for member portal and public website; one post, both places.
14. **The header search is the agent's front door.** "Search or type a task…" must detect intent: names/emails/countries → search results; imperative phrases ("email all unpaid gala guests", "add KBC Rijeka as host") → the assistant proposes the action, admin confirms. Wire it to the same agent API as the member portal; confirm-before-execute always.
15. **Everything saves, instantly and server-side.** Every admin edit (member-page rows, criteria, expenses, tasks, channels, calendar entries, display name) persists the moment it changes — no Save-and-lose model; the mocks' localStorage is a stand-in for real endpoints.
16. **Today is per-admin customisable**: the ✎ CUSTOMISE control lets each admin pick which hero numbers and DO IT NOW shortcuts show; defaults ship as mocked. Store per-user.
17. **Team tasks are one shared list** surfacing on both Today and Calendar; ticking anywhere completes for everyone.
18. **The Weekly Read headline IS the read** — the collapsed bar shows this week's actual conclusions (computed from live numbers), not a description of the feature.
19. **Review Room** (Accelerator): applications stream in from the member wizard; criteria are admin-editable (add/rename/remove, 0–5 scale, per-reviewer scores averaged); SEND INTERVIEW LINK emails the applicant a booking link and notifies the interviewer; ranking exports CSV and feeds the institution match.
20. **Forum hub**: SEND CODE emails the personal invitation automatically (no copy-paste); the public interest form feeds the candidate pipeline; the "where the network is" panel becomes an interactive world map (hover a country → its members) once membership grows — build with real geo data, counts from the DB.
21. **Bridges stats widget** ("Stats for media & sponsors") is reusable on every project hub: scoped live numbers, any figure manually overridable, one-click copy line. Follow-ups list = lightweight CRM rows (who, why, tag) with a done-check.
22. **Member Pages manager** is the single write-path to member-facing content: per-project rows with PUBLISHED/DRAFT state, live preview, and the registration-form field editor. Hubs' "WHAT MEMBERS SEE — MANAGE" buttons all land here.
23. **Studio** owns make-and-store (badges from live guest lists, per-person certificates, print suite, social cards, brand kit downloads, stored files). Calendar's EXPORT PDF produces a print-ready one-page year board in the Med&X look.
24. **Inbox upgrades**: approvals grouped by kind with APPROVE ALL per group; audiences by dropdown AND hand-picked per-person ticks (ticks override); member messages carry topic tags (members pick a topic when writing), unread dots, read/unread + archive (archive hides, never deletes); announcements composer previews the actual bell dropdown and supports link + show-until; Newsletter tab = subscriber counts per topic + composer that queues into the outbox and can send as email and/or portal post; team chat is global via the header TEAM CHAT pill — channels can be created/deleted (general is permanent, history archives), messages support reply-to and attachments (drag-drop in production).
25. **Header**: stacked logo lockup with ADMIN under the wordmark; profile avatar opens a menu with an editable display name (persists; greeting uses it), team access, sign out.
26. **Admin easter eggs to keep**: clicking the Today greeting toggles Croatian (Dobro jutro/Dobar dan/Dobra večer); the profile menu signs off "Radiš sjajan posao."; the Plexus DAYS TO GO cell tooltip reads "…i isto toliko noći."

## Design Tokens
Colors (exact, non-negotiable — from BRAND-BRIEF.md):
- Ink `#191512` (dark surfaces, text) · Cream `#f7f1e6` (page ground — never pure white) · Card cream `#fdfaf3`
- Crimson `#9b1b22` (primary actions; hover `#7e151b`) · Gold `#c9a962` (premium/highlights; hover `#d9bd7f`; dark-on-light gold text `#6e5626`)
- Soft ink `#4a4239` (secondary text) · Hairlines `rgba(25,21,18,.16)` (light) / `rgba(247,241,230,.25)` (on ink)

Typography:
- Display: Fraunces (optical sizing; italics for emphasis words). Body/UI: Inter.
- Micro-labels: 9–11px Inter, weight 600, uppercase, letter-spacing .14–.18em — eyebrows, buttons, tags.
- Numbered section eyebrows ("01 · THE PROGRAM") are a house signature.

Shape:
- Square corners everywhere (0 radius). No pills, no shadows on cards — 1px hairline borders.
- Buttons: crimson filled (primary), hairline ghost (secondary), gold filled (premium/Gala/Forum moments); uppercase micro-label text.
- Page gutter 36px; cards on `#fdfaf3` with `1px solid rgba(25,21,18,.16)`.
- Toggles: 34×18px rectangle, 14px square knob, crimson when on.

## Interactions & State
- Portal Chrome: MENU opens a 300px ink drawer (translateX, .6s cubic-bezier(.22,1,.36,1), scrim fade); active nav item gets a 2px gold left border. Email banner dismissible; hidden when `emailConfirmed`.
- Home: hero rotates every 6s; countdown ticks to 2026-12-04T09:00+01:00; profile nudge ↔ full-width countdown swap on completion.
- Wizard: stepper is clickable; checklist % = completed steps / 6; Previous disabled on step 1; autosave note in footer.
- Forum: invitation code unlocks registration state (3-stage indicator: Event Details → Registration → Confirmed).
- Messages: thread switch, unread markers, local send-to-thread; official threads carry an "OFFICIAL · MED&X TEAM" tag.
- Profile: specialty chips toggle, directory/updates toggles, EN·HR segmented control, completion meter recomputes.

## Assets
`assets/` — logo.png (dark, for light grounds), logo-white.png (for dark grounds; never redraw/stretch/recolor the mark), six real event photos (hero/gallery use). Striped placeholder blocks with monospace labels mark spots awaiting real photos (Accelerator cohort gallery, QR codes).

## Files
All `.dc.html` screens listed above, `support.js` (prototype runtime — reference only), `assets/`, `BRAND-BRIEF.md`, `handoff-notes.md` (raw review notes).

## Button & control wiring map (production)
Review feedback flagged "dead" buttons — most are intentionally production-scope in these mocks. This map says where each control must go. Controls marked (prototyped) already work in the mocks; recreate that behavior server-backed.

### Global (Portal Chrome + Home top bar)
- SEARCH → global search overlay (members, events, news) — same agent API as the admin header search.
- ALERTS → notifications dropdown; the unread dot is a live count.
- EN · HR → locale switch. HR is v2 — keep the control visible, wire when translations exist.
- RESEND LINK (banner, Profile, My Med&X) → resend-confirmation endpoint + "sent" toast.
- Drawer: Certificates → My Med&X record (wired); Forum eligibility → Biomedical Forum (wired); Mentorship and Opportunity board → the existing current-portal pages (features unchanged; restyle at implementation).
- Identity block (avatar/name) → My Med&X.

### Home
- CHECK IN → wallet QR (wired to My Med&X).
- READ / SEE ALL → news article page / archive (admin-published posts).
- ADD → (Key dates) → .ics download (prototyped).
- SUBSCRIBE → newsletter endpoint with the picked topic chips (confirmation state exists).
- GETTING STARTED card → rows disappear as server state completes (email confirmed / profile 100%); dismissal persists per user.

### Plexus (Overview / Program / Zagreb / My Plexus)
- REGISTER NOW / REGISTER — FREE / RESERVE A SEAT / RSVP → the ONE external Render form; the source button preselects conference and/or Gala.
- I'M INTERESTED → follow + notify endpoint (prototyped: label flips, updates turn on).
- ADD TO CALENDAR → .ics (prototyped).
- VIEW BIO → speaker bio modal (prototyped; bios are admin-entered content).
- BIO + ADD SESSION (Program page) → bio modal + add-to-my-schedule endpoint.
- DOWNLOAD PROGRAM · PDF → PDF generated from the admin program rows.
- ALL PHOTOS → per-event galleries (admin uploads).
- MESSAGE (attendee rows) → Messages thread with that member.
- Speaker portraits + institution logos → admin uploads (photo folder pending from Laura).

### Gala
- RESERVE YOUR SEAT / RSVP → same Render form. Price flips EUR 150 → 175 automatically after Sep 1 (prototyped from the clock; production reads server config).
- ADD TO CALENDAR → .ics (prototyped).
- Performers: admin flips `performersAnnounced` — real names replace the two "announced this autumn" slots.

### Accelerator
- GET NOTIFIED (hero + Your application) → notify-list endpoint (prototyped: toast + ✓ label).
- Host institution cards → expandable admin-editable blurbs (prototyped inline detail).
- RESULTS LOOKUP + VIEW RESULTS → results endpoint; validate AX26-XXXX format; distinct errors for empty vs unknown codes (prototyped: toasts).
- FAQ accordion (prototyped) → answers are admin-editable content.
- PREVIEW THE APPLICATION → the restyled 7-step wizard.

### Biomedical Forum
- UNLOCK REGISTRATION → invitation-code validation; success joins the network (stage 2) and unlocks gathering registration. Membership is ANNUAL and renewable — the terms must appear in the registration form.
- COMPLETE REGISTRATION → gathering registration flow.

### Building Bridges
- REGISTER (Boston card) → event registration form — open to anyone, no membership gate.
- Past-city cards → per-edition photo galleries (admin uploads); recap figures admin-editable.

### Network
- BROWSE ALL 50 MEMBERS → paginated full-directory query.
- CONNECT / MESSAGE / ACCEPT / DECLINE → server endpoints (local-state in mock).

### My Med&X
- DOWNLOAD CARD → member-card PDF; ADD TO PHONE WALLET → Apple/Google passes.
- OPEN REWARDS → rewards / points-ledger page.
- Ticket DOWNLOAD / EMAIL / ADD TO WALLET → per-ticket endpoints.
- RECEIPT → receipt PDF (paid items); CONFIRMATION → registration confirmation (free items get no monetary receipt).
- CHANGE / SWITCH rows → settings modals; PROJECTS I FOLLOW and MY INTERESTS chips → follow/interest endpoints (add + remove).

### Profile
- UPLOAD PHOTO (prototyped local preview) → profile photo upload.
- SAVE CHANGES (prototyped ✓ SAVED + toast) → PATCH profile; every field persists server-side.
- Specialty tags: fixed suggestions + free-text custom tags (prototyped) — store as strings.
- Country dropdown: full country list (prototyped).

### Emails / misc
- Newsletter footer: Manage topics / Unsubscribe → preference center.
- Update the PUBLIC site FAQ to point newsletter signup at the portal (it currently says "email info@medx.hr").

## Admin review round — decisions & new screens (Aug 2026)
Canonical facts (ONE source of truth — every screen must agree):
- Conference: Dec 4–5, Novinarski dom, Zagreb, free, **cap 100** (never "goal 400").
- Gala: Dec 5, Esplanade, €150 → €175 on Sep 1 (auto), **25 reserved · 21 paid · 4 to chase · €600 owed**, non-refundable, "limited seating" (never a 150 figure).
- Boston: **Sep 18–21, 2026**, exact date & venue announced later — NO Harvard branding anywhere.
- Bridges history: 4 editions — Washington 01 (NIH), London 02 (Embassy), New York 03 (Consulate), Zürich 04 (ETH); 150+ guests total; counts per edition entered by admins on recap.
- Accelerator: opens **Dec 8, 2026**; two-phase review → interviews → results by emailed access code; NO public close/interview/result dates. Hosts 2026: Cleveland Clinic, Mayo, Columbia, Zurich. 18 fellows across 2024–26.
- Forum: annual renewable membership, cap 200; gathering **May 28–29, 2027**, Split or Zagreb (members vote).
- Diacritics everywhere: Juginović, Vuković, Pranjić, Rakić, Nikolić. € symbol, never "EUR".
- Croatian easter-egg strings were removed by decision (visual easter eggs allowed, text ones not).
- Signed-in admin name (localStorage `medx_admin_display_name`) drives greeting, chat sender, avatar initials.
- Shared team-task store: localStorage `medx_admin_tasks_v1` (Today + Calendar read/write the same list) — production replaces with the tasks table.

New admin screens added this round (all fully interactive mocks):
- **Admin Gala.dc.html** — guest list (table + meal per guest), live seating board (10×8), kitchen counts + CSV, waitlist with 24 h auto-offer, add guest (invoice/VIP/sponsor), chase/mark-paid, non-refundable cancel with confirm + undo.
- **Admin Registrations.dc.html** — all-events table: search, event filter, status chips, multi-select + bulk email (queues to Outbox), CSV export, registration file panel with contextual actions (resend confirmation, mark paid, cancel).
- **Admin Links.dc.html** — invitation-link generator: live links with visit/sign-up counts, copy, pause/resume, QR; creator for PUBLIC / VIP (free) / DIASPORA / SPONSOR with use limits. Every sign-up lands in Registrations tagged with its source link.
- **Admin Accelerator Review.dc.html** — now contains the full applicant file (project line, motivation, preferences, documents) in an expandable drawer + ACCEPT → offer / DECLINE (confirm + undo, queues the kind-no email) + reviewer notes + interviewer roster + ranking CSV.

Still spec-only (build from this list; no mock exists):
1. Program & schedule builder (sessions, times, rooms → member Program page + PDF).
2. Speakers manager (bio, photo, itinerary/travel per speaker → member page cards + Calendar).
3. Form builder (custom questions per event form; Forum "request consideration" editor exists as a mini version in the Forum hub).
4. Website-text editor for medx.hr (same pattern as Admin Member Pages, website tab).
5. Full DM system between admins (team chat has channels; DMs are v2).
6. Auctions tool (pledges land in Money → Sponsors & donors for now).
7. 3D ballroom walk-through (2D seating board is the base).
8. Merch studio, rewards/points ledger (kept in nav, one link deep, marked as their own tools).
9. Bank import (CSV/API) behind Money → Reconcile.
10. Member analytics (People shows last-active; full usage analytics later).
Production notes: EN·HR locale switch stays visible but HR ships when translations exist; all "queued in the Outbox" copy is literal — nothing sends without explicit OK on the Outbox tab; snooze = per-admin, 24 h.

