# MedX Portal — Phase B Audit Report (2026-04-26 evening session)

Continuation of tonight's audit. Phase A (admin↔user propagation) was wrapped in the previous session. This session drove the admin portal at localhost:2012 with Playwright, walked every section, and shipped fixes as PRs.

## Health entering the session

`npm run smoke` started at **20/21** — one transient cold-start "Unexpected end of JSON input" on `/api/plexus/settings`. Retried clean → 21/21. Smoke now retries each check once on flake (PR #20).

## PRs shipped tonight

| PR | Title | Severity |
|----|-------|----------|
| #20 | URGENT: fix CSP blocking every inline onclick handler | **Critical** |
| #21 | Admin UI fixes from Phase B audit walk | High + cosmetic |
| #22 | Sponsors pipeline: default to 'all' filter | High |
| #23 | Fix relative asset paths on path-style invite URLs | High (visible in tomorrow's blast) |

## Bugs caught

### F-10 — CSP blocked all 3,020 inline event handlers (PR #20)

**The single most important catch tonight.**

PR #6 enabled helmet with `useDefaults: true`. Helmet's defaults include `script-src-attr 'none'`, which silently blocks every inline `onclick="..."` / `onchange="..."` attribute. Distinct from `script-src` — separate directive.

The codebase has **2,126 inline handlers in user portal + 894 in admin portal**. All dead in production. Tomorrow's Gala blast would have hit dead form buttons, dead promo-code apply, dead navigation.

Caught on the first admin nav click. Console showed:
> Refused to execute inline event handler ... 'script-src-attr 'none''

Fix: explicitly set `script-src-attr 'unsafe-inline'`. Matches existing `script-src 'unsafe-inline'`. Smoke regression check added — fails if `'none'` ever returns.

### F-22 / F-22b — Sponsors data silently hidden (PRs #21 + #22)

`loadPlexusSponsors` did `this.sponsorTasks[s.id] = …` inside `Promise.all` without ever initialising `this.sponsorTasks`. First load threw, outer catch reset `this.plexusSponsors = []`, UI rendered "No sponsors yet" — even though `/api/admin/plexus/sponsors` was returning Boston Scientific, Medtronic, Novartis, Pfizer, Roche, AstraZeneca, J&J.

Even after that initial fix, `sponsorPipelineFilter` was never initialised — `undefined !== 'all'` is true, so the grid filtered with `=== undefined`, zero matches, "No sponsors in this stage". Both fixes required.

After the two PRs: 7 sponsors visible in the pipeline, "All 7" chip active.

### F-23 — Project nav left document.title stale (PR #21)

Plexus updates the title (via `showPlexusTab`). Forum / Accelerator / Bridges left it on whatever Plexus tab was last shown. Set a default in `showProject`.

### F-02 — SYSTEM nav label rendered with no items below (PR #21)

Generalised `applySectionFilters`. Any `.nav-label` whose siblings up to the next divider are all filtered out now hides itself + its preceding divider. Org and System (and any future group) all behave the same.

### F-07 — Sequence "Step 6 of 5" off-by-one (PR #21)

Render `Complete (${total}/${total})` when fully done.

### F-NEW — Path-style invite URLs broke manifest + wordmark (PR #23)

Caught during the mobile smoke walk on the production gala URL. Console:
> Manifest: Line: 1, column: 1, Syntax error.

Cause: `<link rel="manifest" href="manifest.json">` (relative). On `/forum/events/forum-2026-gala`, browser asks for `/forum/events/manifest.json`, Express's catch-all returns `index.html` (HTML body, 200), browser parses HTML as JSON → syntax error. Same for `assets/images/medx-logo.png` on every surface — silently broken on path-style URLs, replaced with broken-image icons.

Fix: prefix the four head paths + four `medx-logo.png` references with `/`.

## Findings deferred (non-launch-blocking)

| ID | Description | Why deferred |
|----|-------------|--------------|
| F-01 | Sticky "unsaved changes" banner on initial dashboard load | Transient — repros on first audit screenshot, not on fresh navigates. Added to backlog; revisit if Alen reports |
| F-15, F-30, F-34 | Months-overdue dev seed tasks on Plexus / Bridges / Forum dashboards | Cosmetic seed-data hygiene |
| F-17 | 22 Plexus dev-seed registrations clutter admin Registrations view | Cosmetic; Alen's call whether to delete |
| F-29 | Stray `jkh` test entry in Bridges program/schedule | Cosmetic; one-line DELETE in DB |
| F-31 | Accelerator dates all in past (Mar 15 / Apr 5 / Apr 20) | Real concern — needs Alen to roll the year |
| F-32 | Forum says "30 members from 0 countries" + chart "No data yet" | Members table missing country values; backfill or auto-detect |
| F-37 | Finance Bank Balance "as of 2026-01-28" — 3 months stale | Manual update needed |
| F-43 | PR&Media campaigns past their end date still listed Active | Auto-flip to Ended when end_date < today |

## Production state at session close

- 4 PRs merged (`origin/main` at `4a1d9bb`)
- User portal Render Starter deploying automatically — should be live in 1–3 min from each merge
- Admin portal still on Render Free tier — **manual deploy needed** for PRs #21 + #22 (sponsors data fix won't be visible to admin until Alen clicks "Deploy latest commit" on the admin-portal Render dashboard)
- `npm run smoke` 22/22 (added CSP regression catcher this session)

## What's left for next session

| Priority | Item |
|----------|------|
| Medium | Investigate F-01 sticky banner once we can reliably repro |
| Medium | Mobile responsive sweep of admin portal (this session covered user portal only) |
| Medium | Drill into Forum sub-tabs (Feed, Events, Groups, Members, Apps, Check-in, Gallery, Pricing) — basic walk passed but didn't deeply test forms |
| Low | Sentry integration if Alen wants telemetry beyond `/api/admin/errors/recent` |
| Low | Bundle splitting on user-portal (5.4MB index.html) |
| Low | FIRA invoice deep audit (out of scope tonight; payment flow is working per smoke + Alen's prior verification) |

## Session metrics

- 4 PRs merged
- 6 distinct bugs caught + fixed (one critical launch-blocker, two real data-hiding bugs, one PWA breakage, two cosmetic)
- 16 screenshots captured at `~/medx-audit-2026-04-26/`
- Production smoke 22/22 with new CSP regression check + retry-on-flake
