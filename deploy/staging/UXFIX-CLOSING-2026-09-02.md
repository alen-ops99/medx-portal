# UXFIX-CLOSING · 2026-09-02 — closing sweep over the five agents' leftovers

Closes the handoff items from **UXFIX-M1**, **UXFIX-M2** (sections A · B · C), **UXFIX-A2**
(the Sep-1 stray list) and **UXFIX-A3** (the "still divergent" list), plus M1's one skipped
item. Branch `redesign/member-portal`, working-tree edits only. No git, no deploys, no emails;
nothing the five agents wrote was reverted.

---

## 1 · Rewards economy removed from the member views (M2 §A · §B · §C)

**`user-portal/frontend-v2/js/views/me.js`** — applied M2 §A exactly: the `COPY.rewards`
block, the `/api/rewards/summary` fetch and `rewards:` return key, `blockRewardsBand()` and
its call, the whole `rewardsTab()` and its template branch, the `redeem` / `copyCode` /
`moreLedger` handlers, and `ledgerN` are all gone. The route line no longer knows a `rewards`
tab, so a bookmarked `/app/me/rewards` lands on the wallet. Header comment updated. Badges,
certificates and attendance cards stay — the recognition layer the audit keeps.

**`user-portal/frontend-v2/js/chrome.js`** — applied M2 §B exactly: `points` out of
`COPY.stats`, the points cell out of `statsStrip()`, and the `/api/rewards/summary` fetch +
`points:` field out of `refresh()`. The client no longer calls `/api/rewards/*` anywhere
(backend routes untouched, as prescribed).

**`user-portal/frontend-v2/js/views/plexus.js`** — applied M2 §C:
- `pts: '+10 PTS PER CONNECTION'` out of `COPY.connect`; the chip fragment out of the
  CONNECT strip in `ovProgramInk()`.
- **Explore Zagreb text collapse**, following the row-vocabulary prescription literally:
  "01 · SIX STOPS BEFORE DINNER" is now six numbered text rows — Fraunces gold `s.n`,
  Fraunces name, `s.note` in `#4a4239`, hairline `border-bottom:1px solid rgba(25,21,18,.12)`
  per row — with the ink "December bonus: Advent in Zagreb" box kept as the closing element.
  "02 · TASTE ZAGREB" lost the 120px stripe strips (name+note cards stay). The hero lost the
  stripe underlay and the `Z.heroPh` corner label and sits on flat ink (`#191512`) under the
  kept scrim gradient. The unused `ph`/`wide` fields and `heroPh` left `COPY.zagreb` with the
  markup that read them; a code comment carries the restore recipe (`zg-<stop>.jpg` ≤300 KB,
  `<img …object-fit:cover>` per card as accelerator.js does its cohort blocks).
- Optional §C hardening done: `crumb()`'s row div now carries `mx-crumbs` (app.css already
  styles the hook — 44px targets at ≤480px).
- `css/views/plexus.css`: `.mx-zagreb-grid` and `.mx-span-2` were orphaned by the collapse
  and are removed with their media-query lines.

## 2 · Early-bird Sep-1 strays → 2026-09-15 (A2's list, then a grep to zero)

Every functional `2026-09-01` / "September 1" early-bird remnant on the branch now says
**2026-09-15 / September 15**, the A2-named ones and the ones the confirming grep surfaced:

| File | What changed |
| --- | --- |
| `admin-portal/backend/server.js` | :8305 schema DEFAULT · :8673 `Plexus early-bird deadline` calendar seed row · :8721 conferences seed · :23159 digest deadline + "runs through 15 September." · :30177 fallback · :6383 gala `detail_line` seed → "EUR 150 through 15 Sep" |
| `user-portal/backend/server.js` | :1315 · :5760 · :8640 schema DEFAULT · :10620 conferences seed · :10530 gala `detail_line` seed · the :8635 rule comment |
| `admin-portal/backend/v2/{money,event-day,gala-ops}.js` | the three `\|\| '2026-09-01'` fallbacks (money :317, event-day :604, gala-ops `GALA_DEFAULT_DEADLINE` :105) |
| `user-portal/backend/v2/gala.js` | `DEFAULT_DEADLINE` :26 |
| `admin-portal/frontend-v2/js/views/member-pages.js` | :52 "price switch on Sep 15" |
| `admin-portal/frontend/index.html` | :16104 newsletter placeholder · :42016 fallback |
| `admin-portal/backend/change-map.json` | two date mentions (the file is served at `/api/admin/change-map`) |
| `user-portal/frontend/assets/app.part9.js` | :7776 · :8183 "Until September 15" · :7838 stale **€100 → €150** (until Sep 15) |
| `user-portal/frontend/assets/app.part6.js` | the HR translation pair + the offline fallback `detail_line` (kept key = value so the translation still fires) |
| `user-portal/frontend-v2/_qa/emails/03-newsletter.html` | :14 preheader + :38 headline |
| `admin-portal/frontend-v2/scripts/qa-admin-inbox.py` | :208 QA announcement fixture |

**One adjacent correction, flagged:** the calendar seed row directly above the named one —
`['Building Bridges — Boston', 'bridges', '2026-09-01', …, 'potential', 'date to be
confirmed']` — seeded a fresh DB with a Boston date every portal surface now contradicts. It
now reads `2026-09-21 · confirmed · Waterhouse Room, Gordon Hall — Harvard Medical School`,
matching `FACTS.bridges.next` (M1's canonical truth). Not an early-bird stray, so saying it
here rather than doing it silently.

**Confirming grep** — the only `2026-09-01` / "Sep 1" survivors on the branch are comments
and history: two decision-dated comments in `v2/event-day.js` ("(Alen 2026-09-01)"), the
`ui.js` / `facts.js` format-example and repair-doc comments, the Autumn-Symposium forum seed
(a real event date, no early-bird meaning), and the `deploy/staging` / `snapshots/` /
`design/handoff/` / `tasks/` record files. Zero functional early-bird remnants.

## 3 · QA suites target the new labels/flows (M1 handoff) + CSS orphans

**`scripts/qa-plexus.py`** — the named assertions rewritten against the live view code:
- :158 `RSVP ·` → `RESERVE A SEAT ·` (href `/plexus?pick=gala` + live € price).
- :159–163 the `I'M INTERESTED` flow → the surviving `[data-act=tgFollow]` toggle: reads the
  starting `aria-checked`, expects `POST /api/notify-topics 200` + the matching toast
  ("You follow Plexus now…" / "…off") on each flip, asserts the aria flip, and flips back so
  the account leaves in its starting state.
- :242–246 `[data-role=speakerQ]` typing (and the `spf` filter chips above it) → absence
  assertions — both controls deleted by design — plus the canonical-roster and
  `PLEXUS · GALA` v2-meta-tag checks kept.
- Also broken by the same renames and fixed in step: :157 and :280/:283 `REGISTER NOW` →
  `REGISTER — FREE` (overview hero and My Plexus hero, em-dash exact).

**`scripts/qa-gala-bridges.py`** — :133 `RESERVE YOUR SEAT` → `RESERVE A SEAT` (prefill
href), :135–136 `RSVP` → both reserve blocks asserted on the one verb + one form (≥2 links,
all `pick=gala`) plus a no-stale-wording check. Two more assertions the M1 gala changes
break were aligned: :123 dropped `FEATURED PERFORMERS` from the default section list and
:130 now expects the single "announced this autumn" line with no placeholder cards (both
render only once the admin announces names — the :192 announce/revert pass covers that).

**`css/views/plexus.css`** — the two orphans M1 named are deleted (`.mx-speaker-q` + its
focus and ≤900px rules, `.mx-speaker-filters`). `.mx-gala-perf` untouched — still used by
gala.js's announced-performers branch (verified at gala.js:312).

## 4 · Gala numbers converge on `/api/v2/gala-ops/summary` (A3's divergent three)

**`admin-portal/frontend-v2/js/views/today.js`** — reads the canonical summary (preferred
path per the handoff). `GALA SEATS PAID` shows `summary.seats.paid` with a
"N seats unpaid · €X outstanding · early bird ends …" sub; COLLECTED uses
`summary.eur.collected` and counts payments from `summary.bookings.paid`; the YOUR PROJECTS
plexus card says "N gala seats paid". Against an older backend the local row walk survives
as the degraded path and the card relabels itself `GALA BOOKINGS PAID` / "N gala bookings
paid" — rows are bookings, and it says so.

**`admin-portal/frontend-v2/js/views/plexus.js`** — same treatment for the stat strip: label
`GALA SEATS`, value `summary.seats.reserved`, sub `seats.paid PAID · seats.chase TO CHASE`;
the THE GALA EVENING rows and the media-widget `gala_paid` figure read the same block;
COLLECTED uses `summary.eur.collected`. The fallback walk's inactive filter was extended to
the canonical list (`cancelled/rejected/declined/expired`), so cancelled rows are out of the
chase count on both paths — the correctness bug A3 flagged — and the fallback relabels to
`GALA BOOKINGS`.

**`admin-portal/backend/v2/host-brief.js`** — denominators now follow **event-day.js's
computation** (the canonical pick): `expectedPeople()`'s rule, under which the gala door
expects only paid / vip-comp seats (an unpaid gala QR is a refusal state) while every other
door expects all non-cancelled bookings. The headline `people` / `bookings` / `plus_ones`
and `arrivals.expected_people` are computed over that population, so the brief's "IN 4 of N"
and the Event Day counters now quote the same N. The full guest list, pay breakdown, notes
and dietary lines still cover everyone; the unpaid-seats talking point adds "— not in the
expected count until paid" for the gala, and the empty gate keys off the full list so a
gala with only pending rows still renders a brief. `eventday.js` counters already read
`gates[].expected` = `expectedPeople()` — canonical by construction, so no frontend edit was
needed there; verified rather than assumed.

Smoke: host-brief mounted against a stub db (2 paid rows incl. one +1, 1 pending +2) →
headline `people 3 · bookings 2 · plus_ones 1 · pending_people 3`, text line "3 people
expected across 2 bookings (1 plus-one)", gala pending point present. **PASS.**

## 5 · Accelerator RESULTS LOOKUP gated (M1's skipped item 15 case)

**`user-portal/frontend-v2/js/views/accelerator.js`** — `appSectionInner()` renders the
RESULTS LOOKUP row, its error line and the results block only when `openState() !== 'before'`
— the live intake state, with `FACTS.accelerator.opens` (`2026-11-15T09:00+01:00`) as the
clock fallback, exactly the gate the rest of the page already uses. Before applications open
a `v2:` marker comment holds the spot; the field returns the moment they open and stays
afterwards, which is when `AX26-XXXX` codes exist. Handler and COPY untouched.

---

## Verification (all pass)

| Check | Result |
| --- | --- |
| `node --check` (as `.mjs`) on all 8 touched frontend modules | 8/8 OK |
| `node --check` on both `server.js` + 5 touched backend/asset js files | OK |
| `python3 -m py_compile` qa-plexus.py · qa-gala-bridges.py · qa-admin-inbox.py | OK |
| `bash scripts/check-schema-sync.sh` | OK — mirror block byte-identical (527 lines; both DEFAULTs changed in step) |
| `node scripts/check-api-contract.js` | OK — the two new `/api/v2/gala-ops/summary` call sites resolve |
| host-brief stub-db smoke (gala denominators) | PASS |
| `change-map.json` still valid JSON · plexus.css braces balanced | OK |
| `dc:` markers balanced in every touched view | me 6/6 · plexus(member) 21/21 · chrome 7/7 · accelerator 22/22 · today 10/10 · plexus(admin) 9/9 |
| Residue greps | zero `api/rewards` / POINTS / `+10 PTS` in frontend-v2 js · zero stale QA selectors · zero functional Sep-1 early-bird strays |

## Files touched (23)

Member portal: `js/views/me.js` · `js/chrome.js` · `js/views/plexus.js` ·
`js/views/accelerator.js` · `css/views/plexus.css` · `scripts/qa-plexus.py` ·
`scripts/qa-gala-bridges.py` · `_qa/emails/03-newsletter.html` · `backend/server.js` ·
`backend/v2/gala.js` · `frontend/assets/app.part6.js` · `frontend/assets/app.part9.js`
Admin portal: `frontend-v2/js/views/today.js` · `frontend-v2/js/views/plexus.js` ·
`frontend-v2/js/views/member-pages.js` · `frontend-v2/scripts/qa-admin-inbox.py` ·
`frontend/index.html` · `backend/server.js` · `backend/v2/money.js` ·
`backend/v2/event-day.js` · `backend/v2/gala-ops.js` · `backend/v2/host-brief.js` ·
`backend/change-map.json`

## Open ends for the deployer (nothing blocking)

- The **live** DB may still hold the old Sep-1 board row / gala_settings value — A2's
  REMOVE IT panel and the admin Gala settings are the operator path; the seeds no longer
  regenerate the contradiction on a fresh environment.
- M2's register-form reskin patch (`UXFIX-M2-register-reskin.patch.md`) and its §D Anderson
  copy onto the legacy Render `frontend/assets/gala/` remain with their owners — out of this
  sweep's brief.
- The Playwright suites want a staging run with the **new** build once one is deployed; the
  assertions now describe the new UI, and the old deployed build would fail them by design.
