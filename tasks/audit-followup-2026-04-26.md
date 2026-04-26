# MedX Portal — Follow-up Audit (April 26, 2026)

Audit continuation after PR #1 (admin↔user sync), with focus on any flow Alen might already be sending links for.

## What was shipped tonight

| PR | Title | Status |
|----|-------|--------|
| #1 | Admin↔user propagation audit fixes (B1-B6, Q1-Q3) | ✅ merged + live |
| #2 | URGENT: Fix Forum Gala registration HTTP 500 | ✅ merged + live, Playwright-verified |
| #3 | Admin portal fresh visual theme + classic toggle | ✅ merged + live |
| #4 | Forum direct links: support path-style URLs + defer scripts | 🟡 OPEN — please merge |

## Cumulative bugs found tonight

### Critical (already fixed in PR #2 or #4)

1. **SQL syntax `datetime("now")`** in 15 INSERT/UPDATE statements across both backends. SQLite read `now` as a column identifier (no such column). Replaced with `CURRENT_TIMESTAMP`. PR #2.

2. **Wrong FK target in register-invite forum branch** — passed `user.id` as `forum_event_registrations.member_id`, which FKs to `forum_members(id)`. Now does proper lookup-or-create. PR #2.

3. **No `forum_events` row for Forum Gala** — FK on `forum_event_registrations.event_id` had no valid target. Added idempotent seed for slug `forum-2026-gala` in boot init. PR #2.

4. **Path-style direct links never triggered overlay** — `/forum/events/<slug>` URLs silently fell through to the generic homepage. Fixed in PR #4.

### Latent (unfixed — no urgency, no invites sent yet)

5. **Plexus pricing mismatch.** `/api/plexus/settings` shows €39 student / €99 professional (from `plexus_settings` table). `/api/plexus/register` charges €75-€150 (from `ticket_types` table). Two sources of truth for the same concept. **Will hurt Plexus invitation conversion** when Alen sends those — visitors see €39, get charged €75+.

6. **22 Plexus registrations exist in DB**, mostly seed data with €0 amount_paid. Only Alen's two test rows have real amounts. Not a bug, just dev data lingering — should be cleared before launch.

7. **`waived` payment status used for 5 rows** (seed) — unclear semantics; should be `comp` or `complimentary` consistently. Cosmetic.

8. **Service worker bypass for `/api/*`** added in PR #1 — confirmed live, but only takes effect for users whose browsers have the new `medx-portal-v5` cache. First load after deploy refreshes; existing visitors may need hard refresh.

### Architectural risks (defer post-Plexus)

9. **123,053-line / 5.4 MB user-portal `index.html`** — single artifact that bundles all UI. First contentful paint on slow 4G can exceed 5-8 seconds. Bundle-splitting / code-split would be huge perf win. Untouched tonight (changes risky pre-blast).

10. **No CSRF protection + CSP allows `unsafe-inline`** — any successful XSS = JWT exfiltration = full account takeover. Stripe + FIRA in scope. Should land helmet + CSRF middleware ASAP, but post-blast.

11. **No schema migration system.** 163+ inline `CREATE TABLE IF NOT EXISTS` statements in init code. Forum-2026-gala seed I just added is one more example — works but is fragile. A real migration runner (e.g. `db-migrate`) would replace all of these.

12. **16,111-line monolithic `server.js`** in user portal. Stripe webhook alone is 6,450 lines. Hard to test, easy to introduce regressions. Module split is a multi-day refactor.

## Verified flows on production

| Flow | Status |
|------|--------|
| `/invite/<base64-token>` (Gala invite) | ✅ end-to-end Playwright walked: form fill → FORUM26 promo → Stripe LIVE checkout |
| `/api/plexus/settings` GET | ✅ returns DB-driven prices + key_dates with September 30 / October 15 deadlines |
| `/api/plexus/speakers` GET | ✅ filters `is_published=1` |
| `/api/plexus/schedule` GET | ✅ returns `{conference, sessions, tracks, rooms}` shape |
| `/api/forum/events` GET (auth) | ✅ returns 3 rows |
| `/api/forum/events/forum-2026-day1/register` POST anon | ✅ creates `users` + `forum_members` + `forum_event_registrations` rows with FK chain intact (verified locally pre-PR-#4) |
| Service worker v5 caching | ✅ `/api/*` bypassed |
| `MEDX_DATES` global hydration | ✅ replaces 9 hardcoded date constructors at runtime |
| Path-style `/forum/events/<slug>` | 🟡 fixed in PR #4 (open), works locally — will work in prod after merge |
| Admin portal fresh theme + toggle | ✅ live, palette icon in sidebar flips between fresh and classic |

## Open questions for Alen

1. **What URLs are in your invitation emails?** Three formats exist:
   - `/invite/<base64-token>` — encoded by admin "Generate Link" tool. Used for Gala, works since PR #2.
   - `?event=<slug>` — query-string. Always worked.
   - `/forum/events/<slug>` — path-style. Fixed in PR #4 (pending merge).
   If you've sent path-style URLs, recipients hit "Get Started" landing — **PR #4 fixes that retroactively** once deployed.

2. **Plexus pricing — €39 (display) vs €75 (charged) which is right?** Need to know your actual intended pricing before Plexus invites go out. If €39 is the real student early-bird, `ticket_types.Student.price_early_bird` should be 39. If €75, the website hero needs to show 75.

3. **Should I delete the 22 Plexus dev seed registrations?** They look like seed data from when the portal was first set up — names like "Ana Kovačević", "Marko Horvat", etc. Two are your real test rows. Cleaning these would make the admin Plexus registrations view show actual data only.

## Suggested next session priorities (your call)

A. **Merge PR #4** so path-style links work for any in-app notifications + manual links.
B. **Decide on Plexus pricing** and unify the two tables (1-2 hour fix).
C. **Mobile responsive audit** of user portal — drive Playwright at iPhone viewport, capture issues. Many medical students attend on phones.
D. **Help Alen deploy admin portal on Render Starter** ($7/mo) so auto-deploy works for it too.
E. **Backend modular refactor** — split `server.js` into route files. Big change, high value, post-blast.

## Screenshots index

All in `tasks/audit-screenshots-2026-04-22/`:

| File | What |
|------|------|
| `01-user-portal-plexus-landing.png` | original portal pre-fix (#plexus hash) |
| `02-post-fix-portal-loads-clean.png` | post-fix portal landing (PR #1 deployed) |
| `03-gala-link-landing.png` | Gala link initial overlay (€100, all fields) |
| `04-gala-forum26-applied.png` | Gala link after FORUM26 (€80, "✓ Code applied") |
| `05-gala-stripe-checkout-live.png` | Gala link after fix → Stripe LIVE checkout page |
| `06-admin-current-dashboard.png` | admin login screen pre-theme |
| `07-admin-fresh-theme-login.png` | admin login screen post-theme (radial gradient) |
| `08-admin-fresh-theme-dashboard.png` | admin dashboard with fresh theme |
| `09-admin-classic-theme-dashboard.png` | admin dashboard with classic theme (toggle test) |
| `10-admin-fresh-finances.png` | admin Finances section with fresh theme |
| `11-admin-fresh-LIVE-login.png` | LIVE production admin login (PR #3 deployed) |
| `12-forum-day1-direct-link.png` | broken state — landed on "Get Started" homepage |
| `13-forum-day1-direct-link-FIXED-local.png` | post-PR-#4 — overlay now shows |
| `14-forum-day1-registration-success.png` | end-to-end success — "✓ You are registered" with QR ref |

---
*Audit pause point. Tomorrow's Gala blast verified safe. PR #4 awaiting your merge.*
