# UX Audit — Member Portal v2 · 2026-09-02

Fresh-eyes product-design critique of https://medx-member-portal-v2.netlify.app (staging), signed in as a brand-new member. Every route walked at 1280px and 390px, screenshots reviewed visually; three first-time-member task walkthroughs. Audit only — nothing was changed or submitted. The house style (ink/cream/crimson/gold, Fraunces + Inter micro-labels) is judged as fixed; every recommendation stays inside it.

**Task walkthroughs**
- **(a) Attend Plexus + Gala:** Home hero → `EVENT TICKETS` → lands on the *empty wallet* (`/app/me`) → `REGISTER FOR PLEXUS` → `/app/plexus/mine` → `PRE-REGISTER NOW` → `/plexus` form. Four hops before the form, and the form breaks the brand (items 2, 3, 6).
- **(b) Where are my tickets:** Home → `MY MED&X` → wallet. One hop, and the empty state is the best screen in the portal. Passes.
- **(c) Forum invite code:** `/app/forum` hero `JOIN WITH YOUR CODE` anchors straight to the code field with a clear 1-2-3 stepper. Passes.

---

## The 15 improvements, ranked by impact

### 1. The portal contradicts itself about money and dates
- **Route:** `/app/home` + `/app/projects` vs `/app/gala`, `/app/plexus`, `/plexus` form · dc: `Med&X Home.dc.html › "KEY DATES"` + `"01 · OUR PROJECTS"` vs `Gala Evening.dc.html › "THE EVENING BEGINS IN"`
- **Wrong:** Home says gala early bird ends **Sep 1** (key dates + gala card); the Gala page, Plexus band, My Plexus facts and the registration form all say **Sep 15** — and Building Bridges is simultaneously "Exact date and venue announced later" (home/projects cards), "BOSTON · SEPTEMBER 18, 2026 · ONLY 80 SPOTS · REGISTER" (`/app/bridges`), "SEP 18–21" (home key dates) and Sep 21 in `js/facts.js:34`.
- **Do:** One source of truth — server settings feed both `key_dates` and the pages (today `key_dates` content and `js/facts.js:19` disagree). Reconcile the real deadline and the real Boston date today, then delete every hardcoded copy so this class of bug can't recur. A member who trusts "until Sep 1" and finds €175 — or worse, trusts "announced later" and misses Boston — is a support ticket and a burned relationship.
- **Class:** copy(data) · **Effort:** S

### 2. Three hero buttons, none of them registers you
- **Route:** `/app/home` · dc: `Med&X Home.dc.html › "YOUR NEXT EVENT"` (hero)
- **Wrong:** Under the headline "Plexus 2026 is open for registration", `EVENT TICKETS →` and `MY MED&X` both go to `/app/me` (the empty wallet) and `CHECK-IN OPENS DEC 4` is a status dressed as a button that links to a QR pass you don't have (`js/views/home.js:199-200`) — the page's biggest CTA row cannot start the page's own headline task.
- **Do:** Make the red button `REGISTER FOR PLEXUS →` → `/app/plexus/mine` (the black band's `PRE-REGISTER NOW` already goes there — match it). Demote check-in to plain micro-label text until Dec 4. Delete `MY MED&X` from the row — the avatar, tab bar, and drawer already go there.
- **Class:** feature · **Effort:** S

### 3. The registration form is the one screen that goes off-brand
- **Route:** `/plexus` (the ONE server-rendered form every `REGISTER` / `RESERVE` / `PRE-REGISTER` CTA opens; portal side dc: `My Plexus.dc.html › "MY PLEXUS · REGISTRATION"`)
- **Wrong:** The moment a member commits (and pays €150) the cream editorial world snaps into a navy generic-SaaS card UI — rounded dark panels, green "FREE" chips, empty grey speaker-photo boxes — nothing of ink/cream/Fraunces survives the click.
- **Do:** Keep the one-form rule (standing decision — don't rebuild); reskin it in place with portal tokens: cream ground, ink text, Fraunces headline, crimson primary button, gold price accents, hairline card rules, and drop the four empty speaker photo rectangles. This is the highest-value style fix in the product.
- **Class:** style · **Effort:** M

### 4. Delete the points-and-coupons economy
- **Route:** `/app/me` (strip) + `/app/me/rewards` · dc: `My MedX.dc.html › "REWARDS"`
- **Wrong:** Earning is +1/€1 and +100/check-in, the only purchasable thing all year is one €150 gala seat, and the cheapest reward is a €5 coupon at 500 points valid only on €50+ purchases — a full year of perfect engagement (~325 pts) redeems nothing, ever, and meanwhile "0 POINTS" is the first thing the chrome says on every page.
- **Do:** Remove the coupon tiers, the rewards page, and the `+10 PTS PER CONNECTION` chip on Plexus; keep badges, certificates, and attendance cards as the recognition layer (they fit a learned society; discount coupons on a black-tie gala don't). If points must stay, park the data server-side and stop showing it until there's something real to redeem.
- **Class:** delete · **Effort:** M

### 5. The stats strip greets every member with a row of zeros
- **Route:** every `/app/*` page · dc: `Portal Chrome.dc.html › "Member stats strip"`
- **Wrong:** "0 POINTS · 0 REGISTRATIONS · 0 FOLLOWING · 2026 MEMBER SINCE" sits above every screen — a premium portal telling each new member four times that they are nothing, with the last stat reading backwards.
- **Do:** Hide any zero stat (render the strip only once at least one number is real), flip the last to "MEMBER SINCE 2026", and with item 4 done drop POINTS entirely — on day one the strip becomes just the date + member-since, which is calm and correct.
- **Class:** style/delete · **Effort:** S

### 6. Six verbs for two actions
- **Routes:** `/app/home`, `/app/projects`, `/app/plexus`, `/app/gala` · dc: `Plexus Conference.dc.html › "Hero"`, `Gala Evening.dc.html › "Hero"`, `Med&X Home.dc.html › "01 · OUR PROJECTS"`
- **Wrong:** The same single form is behind "REGISTER", "PRE-REGISTER NOW", "EVENT TICKETS", "RESERVE YOUR SEAT", "RSVP · €150", and "REGISTER — FREE" — and "pre-register" appears beside "REGISTER — FREE" on the same page while registration is, per the portal itself, open.
- **Do:** Two verbs, everywhere: **"Register — free"** (conference) and **"Reserve a seat · €150"** (gala). Kill "pre-register" and "RSVP" globally (grep the four views); "Event tickets" dies with item 2.
- **Class:** copy · **Effort:** S

### 7. Explore Zagreb ships striped placeholder art
- **Route:** `/app/plexus/zagreb` · dc: `Plexus Zagreb.dc.html › "01 · SIX STOPS BEFORE DINNER"` + `"02 · TASTE ZAGREB"`; same on `Accelerator.dc.html › "PREVIOUS COHORTS"`
- **Wrong:** All ten photo slots on the page whose only job is atmosphere are grey diagonal-stripe placeholders ("PHOTO · BAN JELAČIĆ SQUARE" …), so the most romantic page in the portal looks broken; the Accelerator's two cohort photos are the same stripes.
- **Do:** Ship the photos (the portal demonstrably has a real photo pipeline — Bridges' four edition cards carry real images), or until then collapse the six stops to the numbered text rows with the December-bonus box — text-only in this house style still looks finished; stripes never do.
- **Class:** style/content · **Effort:** M

### 8. Settings live in two places; language switch in three
- **Routes:** `/app/me` vs `/app/profile` · dc: `My MedX.dc.html › "03 · SETTINGS"` vs `Profile.dc.html › "03 · ACCOUNT & PREFERENCES"`
- **Wrong:** Name, email, and language each appear on both screens in two different UI systems (rows + `CHANGE →` vs form fields + `SAVE CHANGES`), and EN·HR also sits in the top bar — the same thing styled two (three) ways, and no obvious answer to "where do I change X".
- **Do:** One owner: Profile & Settings keeps identity, about, visibility, notifications, language, password; on My Med&X replace section 03 with a single row — "Settings live in Profile & settings →". My Med&X stays what it is best at: card, wallet, record.
- **Class:** feature/IA · **Effort:** M

### 9. Program & Speakers duplicates the overview — with a search box for four people
- **Route:** `/app/plexus/program` · dc: `Plexus Program.dc.html › "01 · THE PROGRAM"` + `"02 · SPEAKERS"`
- **Wrong:** The tab repeats the overview's identical three program rows and identical four speaker portraits one click away, then adds ALL/PLEXUS/GALA filter chips although every speaker is tagged "PLEXUS · GALA" (the filter can never change the result) and a "Search speakers…" box over four names.
- **Do:** Delete the filter chips and search until the roster passes ~12; delete the helper line "Click a speaker to view their full bio…" (each card already says `BIO + ADD SESSION →`). Make this tab the canonical program (calendar + PDF live here) and cut the overview's program/speaker sections to a teaser row linking in.
- **Class:** delete · **Effort:** S

### 10. Gala speaker grid: an orphan card with a mismatched portrait
- **Route:** `/app/gala` · dc: `Gala Evening.dc.html › "01 · ON STAGE THAT NIGHT"`
- **Wrong:** Four full-bleed rectangular portraits, then Dr. Anderson alone on row two with a pixelated circle-badge headshot floating in white — one speaker looks pasted in from another product, on the portal's most formal page (and the same five people appear again on `/app/plexus` in yet another crop).
- **Do:** Five across on desktop (or 3+2 centered), one enforced treatment: square crop, `object-fit: cover`, no pre-cropped circular assets — replace Anderson's image file. Share one speaker-card partial between gala and plexus so the two pages can't drift.
- **Class:** style · **Effort:** S

### 11. "Featured performers" says nothing, three times — and the form already spills the names
- **Route:** `/app/gala` · dc: `Gala Evening.dc.html › "FEATURED PERFORMERS"`
- **Wrong:** A chip ("TWO PERFORMERS CONFIRMED · NAMES ANNOUNCED CLOSER TO DECEMBER") plus two dark placeholder cards ("Headline performer — announced this autumn" / "Second performer — announced this autumn") tell the member "we won't say" three times — while the registration form one click away already prints "LIVE MUSIC — Tatiana 'Tajči' Cameron & Ante Gelo".
- **Do:** Either announce them on the gala page (they're effectively public) or delete the two cards and keep a single italic line under the schedule: "Two performers confirmed — names announced this autumn." Nothing in this house style should be decoration standing in for content.
- **Class:** delete/copy · **Effort:** S

### 12. "I'M INTERESTED" is the follow toggle wearing a different coat
- **Route:** `/app/plexus` hero · dc: `Plexus Conference.dc.html › "Hero"` (`js/views/plexus.js:447` and `:1020`)
- **Wrong:** The hero offers `I'M INTERESTED` and, directly beneath it, the "GET UPDATES FROM PLEXUS · OFF" toggle — both set the same `followed` flag, so two adjacent controls do one thing and the member can't tell what either commits them to.
- **Do:** Delete the `I'M INTERESTED` button (here and in the register-closed variant); the labeled toggle is the better control because it shows state. Hero becomes two buttons: register + schedule. Same review for the gala/bridges/accelerator heroes, which repeat the toggle pattern correctly — one control each, keep them.
- **Class:** delete · **Effort:** S

### 13. Phone tap targets on tab strips are 12px tall
- **Route:** all project pages at 390px · dc: `Plexus Conference.dc.html › "Section tabs"` + `"Breadcrumb"`
- **Wrong:** Measured on device-size viewport: `OVERVIEW` 65×12px, `PROGRAM & SPEAKERS` 142×12px, breadcrumb links 130×11px at 9.5-10px type — roughly a quarter of the 44px minimum, on the strip that is the only way around a 10,000px-tall page.
- **Do:** Give tab links ~14px vertical padding (44px hit area) and make the strip a single left-aligned horizontally-scrollable row on mobile instead of two centered wrapped rows; same padding for breadcrumbs. Keep the type size — the touch area, not the label, is what grows.
- **Class:** style · **Effort:** S

### 14. The main menu links to screens that don't exist yet
- **Route:** drawer (all pages) · dc: `Portal Chrome.dc.html › "Drawer"`
- **Wrong:** Quick links "Mentorship" and "Opportunity board" open `_stub` screens that literally say "the wiring is on its way" — construction tape inside the front door — and "Event tickets" is a third name for My Med&X in the same list as "My Med&X".
- **Do:** Remove both stub links until the screens ship (the routes can stay for direct URLs); rename "Event tickets" → "My wallet" or drop it. A shorter menu of real doors reads more premium than a long menu with two locked ones.
- **Class:** delete · **Effort:** S

### 15. Affordances shown for state the member doesn't have
- **Routes:** `/app/gala` + `/app/plexus/mine` + `/app/accelerator` + `/app/me` · dc: `Gala Evening.dc.html › "Seat policy"`, `My Plexus.dc.html › "02 · GOOD TO KNOW"`, `Accelerator.dc.html › "04 · YOUR APPLICATION"` (results lookup), `My MedX.dc.html › "02 · MY RECORD"`
- **Wrong:** With zero registrations the gala still offers `TRANSFER YOUR SEAT →`, which lands on a card claiming you can transfer "right from this page" where no control exists; the Accelerator shows a `RESULTS LOOKUP AX26-XXXX` field three months before applications even open; and My Record lists the same "BUILDING BRIDGES — BOSTON" attendance card twice, for an event that hasn't happened.
- **Do:** Render from state: show the transfer link only when a seat exists (and put the actual control where the copy promises it); hide results lookup until a results window is open; de-duplicate attendance cards by event id and never show one before check-in. Dead ends cost more trust than missing features.
- **Class:** feature · **Effort:** S

---

## KEEP — genuinely excellent, don't touch

1. **The member card + wallet empty state** (`/app/me` · dc: `My MedX.dc.html › "MY MED&X · MEMBERSHIP, TICKETS & RECORD"`, `Empty States.dc.html › "MY WALLET · NO TICKETS YET"`) — the dark gold-ruled card with QR is the portal's best premium moment, and "*Your wallet is ready for December.*" with the dashed first-ticket slot is a model empty state: warm, specific, one CTA.
2. **The logged-out welcome** (`/app/auth/welcome` · dc: `Auth.dc.html › "Welcome"`) — ballroom, one Fraunces line, two clear doors. Exactly right.
3. **The "Message us" footers** (every project page · e.g. dc: `Plexus Conference.dc.html › "Message us"`) — context-aware question line + "replies land right here in your portal inbox" is quietly the best trust copy in the product, and it's consistent everywhere.
4. **Home's KEY DATES rail with `ADD →` ICS export** (dc: `Med&X Home.dc.html › "KEY DATES"`) — dense, scannable, useful; once item 1 fixes its data source it's perfect.
5. **The empty-state voice system** — "*No messages — yet.*", "*No connections yet.*", "*This door isn't on the guest list.*" (404) — one italic Fraunces sentence, one action, everywhere. This consistency is a real asset; extend it, never dilute it.

## Small notes (no slot spent)
- `/signin` 404s logged-out — the real route is `/app/auth/signin`; add a one-line `_redirects` alias, people will type it.
- Home band says "59 MEMBERS", Network says "BROWSE ALL 48 MEMBERS" — two counters, one directory.
- Network search placeholder truncates mid-word at 390px ("…a city, 'sle") — shorten the mobile placeholder.
- Forum: the two "FROM THE FORUM" news cards render at unrelated widths, and "…so every relationship stays personal" appears twice on one screen.

*Method: Python + Playwright, 14 routes × 1280/390px full-page captures + interactive walkthroughs; screenshots in the session scratchpad (`ux-member/`). Staging API cold-start measured at ~155s (Render free tier) — worth remembering when judging loading feel on staging; production sizing is a separate question.*
