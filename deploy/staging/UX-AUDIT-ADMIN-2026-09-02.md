# UX Audit — Med&X Admin Portal v2

**Date:** 2026-09-02 · **Auditor:** fresh-eyes product-design pass (audit only, nothing changed, nothing sent)
**Build:** https://medx-admin-portal-v2.netlify.app (staging) · walked all 17 routes at 1280px and 390px (34 full-page captures + 4 operator walkthroughs: Laura 9am / guest-invoice reply / Miro month-end / event night on a phone)
**Screenshots:** scratchpad `ux-admin/` (session) · **Code cited read-only from** `admin-portal/frontend-v2` via dc markers.

The verdict in one line: the bones are excellent — hubs share one grammar, empty states teach, actions live inline — and the two things standing between this and a great operator tool are **numbers that disagree with each other** and **lists that repeat themselves**.

---

## Ranked improvements (15)

### 1. One truth for the gala & money numbers
- **Route:** `/` · `/gala` · `/money` · `/projects/plexus` · `/event-day` — dc: `Admin Home › "Hero numbers"`, `Admin Gala › "KPI strip"`, `Admin Event Day › "Counters"` + v2 `"HOST BRIEF"`, `Admin Plexus Hub › "Stat strip + key dates"`
- **Problem:** Five screens give five different gala tallies — Today says **27 paid · €5,250**, Money says **€5,100**, Plexus says **26 paid · 9 to chase**, Gala says **38 paid · 13 to chase · 51 reserved**, and on the Event Day gala door the counter card says "4 **of 39** expected" while the Host Brief on the same screen says "IN 4 **of 51**" — an operator cannot trust any one of them.
- **Fix:** Pick one vocabulary (people / bookings / seats / payments), serve every card from one shared counters endpoint, and label the basis on the stat itself: "38 **seats** paid", "27 **payments**", "51 **people incl. plus-ones**". Where two bases must coexist (door card vs host brief), use the same denominator or say why they differ in the sub-line.
- **Class:** [feature] · **Effort:** M

### 2. Door list: one person, one row
- **Route:** `/event-day` (Door list, all doors) — dc: `Admin Event Day › "DOOR LIST"` (`eventday.js` `st.door = d.rows` — raw per-registration rows)
- **Problem:** The door list prints one row per registration, so Member 026 appears **three times** and Member 028 three times with different product combos, and a staffer at a crowded door must guess which row to tap — while each row burns ~90px (button on its own line), so 70 names is six phone-screens of scrolling.
- **Fix:** Group rows by person: one row per human, badges for what they hold ("Conf + Bridges + Gala · gala pending"), one CHECK IN that admits the person across their registrations. Make rows one line (name left, button right, ~44px). Give unpaid gala guests a loud row state — crimson "€150 DUE" on the button, since the small grey "payment pending" is invisible under pressure. (Minor, same block: the venue-map placeholder says "Esplanade floor plan" even on the Conference door, which is at Novinarski dom.)
- **Class:** [feature] · **Effort:** M

### 3. Door-staff link card breaks the phone
- **Route:** `/event-day` (once a link is minted) — dc: `Admin Event Day › "DOOR-STAFF LINK"` (`eventday.js` `staffCardBody()`, the `data-role="doorUrl"` span)
- **Problem:** The raw token URL (`https://medx-staging.onrender.com/__admin/api/v2/door/f00fda…`, ~90 chars) sits in a nowrap monospace flex item without `min-width:0`, so the ellipsis never engages and the whole Event Day page stretches to ~756px — horizontal panning on a 390px phone on event night (measured: full-page capture came out 756px wide on the gala door, 390px on the linkless conference door).
- **Fix:** Add `min-width:0;flex:1 1 auto` to the URL span — or better, drop the raw URL entirely and render "Door link ready · expires DEC 5 02:59" with COPY LINK / SHOW QR, which is all a phone user can do with it anyway.
- **Class:** [style] · **Effort:** S

### 4. Member messages: a guest can wait invisibly
- **Route:** `/inbox` → `/inbox/messages` — dc: `Admin Inbox › "Tabs"`, `"MEMBER MESSAGES"`
- **Problem:** The Inbox badge (10) counts only outbound batches, the MEMBER MESSAGES tab has no badge at all, and the "needs a reply" thread appears neither there nor in Today's attention list — a guest asking "can I get an invoice for my clinic" is answerable in ~3 clicks (Inbox → Member messages → Saved replies), but only if someone thinks to open the tab.
- **Fix:** Badge the tab with the NEEDS A REPLY count and split the top-nav badge ("10 to approve · 1 to answer" on hover, sum in the pill). Add a NEEDS YOUR ATTENTION row on Today: "Member message waiting 2 days — Member 003" → OPEN. Two small polish items in the same pane: suppress the broken inline `<img>` preview when an attachment can't render (keep the chip), and make Enter = newline with ⌘Enter = send for member-facing replies — Enter-sends is fine for team chat, risky for half-typed replies to members.
- **Class:** [feature] · **Effort:** S

### 5. Needs-attention list: 13 rows, about half echoes
- **Route:** `/` — dc: `Admin Home › "NEEDS YOUR ATTENTION" + "DO IT NOW"`
- **Problem:** Expanded, the urgent list carries **six** near-identical "Gala payment pending — IN OUTBOX → approve it there" rows that are all the same single action, which row #1 ("91 emails in 10 batches are waiting for your OK") already covers — plus "Plan the coming month of content with AI", which is a feature ad, and no kind of urgent.
- **Fix:** Collapse queued-reminder echoes into one row: "6 payment reminders queued — approve in Outbox → REVIEW". Keep individual rows only for chases that still need a decision (CHASE PAYMENT). Move "Plan the month with AI" to DO IT NOW or delete it. Target: the badge count equals the number of distinct decisions.
- **Class:** [feature] · **Effort:** M

### 6. Weekly pulses: the only bulk action is the dangerous one
- **Route:** `/inbox` (EMAIL & OUTBOX) — dc: `Admin Inbox › "WAITING FOR YOUR OK"`
- **Problem:** Nine weekly pulses have piled up back to **July 6**, each needing an individual DISCARD, while the sole bulk affordance is "APPROVE ALL 9 →" — the one button that would blast two months of stale digests at members.
- **Fix:** Auto-supersede: a new weekly pulse replaces its unapproved predecessor (keep them in DRAFTS & HISTORY). Failing that, add "DISCARD ALL BUT LATEST" next to APPROVE ALL and an age flag ("8 weeks old") on stale rows.
- **Class:** [feature] · **Effort:** S

### 7. Calendar: delete the year board
- **Route:** `/calendar` — dc: `Admin Calendar › "Year board"` (keep `"NEXT UP"` + `"TEAM TASKS" + "KEY DATES"`)
- **Problem:** The Gantt-style board, the NEXT UP banner and the KEY DATES list all render the same eight entries — the page's own footer concedes "The board, NEXT UP and this list read the same live entries" — and one-day events become unreadable 8px bars in a ~1100×400 grid, so the board is the classic long-but-thin screen.
- **Fix:** Delete the year board. Promote KEY DATES to the main column (it already has color keys and both years), keep NEXT UP on top, keep EDIT ENTRIES / + ADD ENTRY where they are. If a visual is wanted later, a single 12-month strip with dots inside KEY DATES does the job at 1/6 the height.
- **Class:** [delete] · **Effort:** S

### 8. Links: ten dead twins and a `/null` bug
- **Route:** `/links` — dc: `Admin Links › "LIVE LINKS"`, `"NEW LINK"`
- **Problem:** The live list carries ~10 rows all named "Plexus Conference 2026 — link" whose URLs literally end in **`/plexus/null`** (minted without a slug — those QR/links are broken), plus triplicate "Plexus 2026 — Gala Evening" rows and expired links still listed as live, with no way to clean up in bulk.
- **Fix:** Fix the null-slug minting path and refuse to create a link whose target resolves to `null`. Auto-move expired and 0-sign-up duplicate links into a collapsed "ARCHIVE (12)" section, add "DEACTIVATE SELECTED", and make the "NOTE TO YOURSELF" field effectively required so twins can't accumulate namelessly.
- **Class:** [delete] · **Effort:** M

### 9. Early bird ends twice
- **Route:** `/` COMING UP · `/calendar` NEXT UP + KEY DATES · `/projects/plexus` tickets row — dc: `Admin Home › "COMING UP" + "TEAM TASKS"`, `Admin Calendar › "NEXT UP"`
- **Problem:** Two calendar entries describe one price switch with two dates — "Gala early bird — €150 until **Sep 1** · price moves to €175 automatically" sits directly above "Gala early-bird ends **Sep 15** — price moves to €175", and the Today hero card says "early bird ends Sep 15" while Settings shows the price already at €150/open — nobody can say what the price is on Sep 8.
- **Fix:** One entry, one date, one phrasing: "Gala early bird ends Sep 15 — €150 → €175 (automatic)". Delete the other entry, and have the tickets row on Plexus link to this single source.
- **Class:** [copy] · **Effort:** S

### 10. Search: no keyboard way in, and it can't see actions
- **Route:** global header — `chrome.js` search (no dc artboard; header chrome)
- **Problem:** "/" and ⌘K do nothing (no global keydown handler exists in `chrome.js`), the placeholder promises "Search or type a task.." yet "invoice" returns "No matches" even though Money has two invoice books and an Upiši račun action — and the results panel clips off the right edge of a 1280px viewport mid-word.
- **Fix:** Bind ⌘K and "/" to focus the box (skip when a field has focus). Index screens, section anchors and named actions with HR/EN synonyms — "invoice/račun → Money · Knjiga ulaznih računa · + Upiši račun", "travel order/putni nalog", "badge", "QR". Right-align the popover inside the viewport with a 16px gutter.
- **Class:** [feature] · **Effort:** M

### 11. Registrations & People: denser rows, matching counts
- **Route:** `/registrations` · `/people` — dc: `Admin Registrations › "All-events table"`, `"Stat strip"`, `Admin People › "Directory + member file"`
- **Problem:** Both tables render every row at once (140 → a 7,900px page; 81 → 4,900px) at ~52px two-line rows, the header says "ALL REGISTRATIONS **140**" while the export button says "EXPORT CSV · **142**" (unexplained gap — cancelled rows), and People's country column mixes formats freely ("Croatia" and "HR", "USA" and "US", "—").
- **Fix:** Single-line rows (name · dimmed email inline, ~40px) and windowed rendering at 50 with "Show all 140". Make the two counts agree or label them ("142 incl. 2 cancelled"). Normalize country display to one form (full name, ISO stored). Keep the right-hand file rail exactly as is — it's good.
- **Class:** [style] · **Effort:** M

### 12. Today on a phone leads with the brochure
- **Route:** `/` at 390px — dc: `Admin Home` section order (`"Hero numbers"` → `"YOUR PROJECTS"` → `"NEEDS YOUR ATTENTION"`)
- **Problem:** On mobile Laura gets greeting → four stat cards → chart → five project cards, and reaches "NEEDS YOUR ATTENTION 13" only ~2.5 screens down — the answer to "what needs me today?" is the last thing the page says.
- **Fix:** On narrow viewports render NEEDS YOUR ATTENTION directly under the greeting (hero numbers third, projects last), or put a jump chip in the greeting row — "● 13 need you →" next to "2 FAILING · 9 TO CHECK" — that anchors down. Desktop order stays as is.
- **Class:** [style] · **Effort:** S

### 13. Money speaks two languages mid-sentence
- **Route:** `/money` — dc: `Admin Money › "Money header row"`, `"Money stat row"`, invoice-book sections
- **Problem:** The subtitle reads "sve knjige na jednom mjestu — what came in, what's owed, what was spent", hero cards are English ("STILL OWED TO US") with Croatian sub-lines ("9 stavki — uključuje ručno unesena potraživanja"), and date inputs render US `mm/dd/yyyy` on a Croatian bookkeeping page where "09/01/2026" genuinely means two different days.
- **Fix:** Adopt the rule the book headers already use — Croatian term first, English gloss after ("KNJIGA ULAZNIH RAČUNA · incoming invoice book") — across the hero cards and subtitle, and force `dd.mm.yyyy` display on date fields (set input locale / add format hint). The bilingual glossing is charming; make it one-directional.
- **Class:** [copy] · **Effort:** S

### 14. Gala seating: 51 dropdowns and a truncated meal
- **Route:** `/gala` — dc: `Admin Gala › "GUEST LIST"`, `"SEATING BOARD"`
- **Problem:** Every guest's meal select shows as "MEAT / STANDA▾" (box too narrow for its own default), and seating 51 people means 51 per-row table dropdowns while the handsome SEATING BOARD with its UNSEATED chips is display-only ("this fills in live").
- **Fix:** Shorten menu labels to "Meat", "Fish", "Veg", "Vegan" (full names live in MENU OPTIONS) or widen the select. Make the board the input: tap an UNSEATED chip, tap a table, done — the row dropdown stays as the fallback. That also makes the "table TBD" rows on the Event Day door disappear faster.
- **Class:** [feature] · **Effort:** M

### 15. Cut the drifting cards
- **Route:** `/` · `/money` · `/studio` — dc: `Admin Home › "THE WEEKLY READ"` + `"ADMIN:" footer row`, `money.js` v2 `"MORNING-AFTER SURVEY"`, `Admin Studio › "STORED FILES"`
- **Problem:** Four blocks are occupying prime space without doing work: THE WEEKLY READ still ships its "SAMPLE" placeholder text, the MORNING-AFTER SURVEY queue lives on the Money page though it is email machinery ("approved like any email"), Studio's STORED FILES card is an empty box whose body text sends you to Settings → Team library, and the Today footer repeats the header's "2 FAILING · 9 TO CHECK" pill on the same screen.
- **Fix:** Wire THE WEEKLY READ to the real digest or delete the card until it exists. Move the survey card to Inbox (beside the outbox it feeds) or to the project hubs. Delete STORED FILES from Studio and move TEAM LIBRARY itself into Studio, which is where "make and store things" already claims to live. Drop the footer health link, keep the header pill.
- **Class:** [delete] · **Effort:** S

---

## KEEP — excellent (5)

1. **Plexus "BEFORE THE WEEK" checklist** (`/projects/plexus` — dc: `Admin Plexus Hub › "BEFORE THE WEEK"`). Status chip + plain-words state + exactly one action per row, in priority order. This is the pattern the whole portal should keep converging on.
2. **Settings → SYSTEM HEALTH** (`/settings` — dc: `Admin Settings › "SYSTEM HEALTH"`). Every failing check names the exact env var, the consequence, and where to set it ("Set BREVO_API_KEY in Render env…"), with data-sanity checks (test rows, orphan payments) beside infra. Rare quality; most admin tools never get this.
3. **Money inline entry + teaching empty states** (`/money` — dc: `Admin Money › "KNJIGA ULAZNIH RAČUNA"`). "+ UPIŠI RAČUN" opens an inline row with both dates prefilled — Miro's month-end task is one click plus typing — and every empty book explains its own bookkeeping rule ("Fiskalizirani računi nastaju isključivo u FIRA-i… Portal nikada ne izdaje ni generira račun"), which encodes the FIRA doctrine right where mistakes would happen.
4. **Event Day HOST BRIEF** (`/event-day` — dc: v2 `"HOST BRIEF"`). Live-composed talking points ("3 guests from KBC Sestre Milosrdnice — largest delegation", kitchen count, notable guests) with COPY AS TEXT and PRINT. This is the feature people will show other NGOs.
5. **"What members see" live editor** (`/member-pages` — dc: member-pages view). Edit-left, live-card-right with LIVE/PUBLISHED chips and versioning note — the safest possible shape for "type here, members see it instantly".

---
*Method note: static pass = full-page captures of all 17 routes at both widths with fold-lines drawn, plus innerText dumps; interactive pass = read-only walkthroughs (tab navigation, form-open without save, search probes, door-list filtering). No approve/send/save/check-in was ever clicked; no data was created or modified.*
