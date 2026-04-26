# MedX Portal — Session Handoff

Quick-start for any future Claude session picking up this codebase.

## Health check (run this first)

```bash
cd /Users/alen/Documents/Claude_Code_Projects/MedX
npm run smoke
```

If 16/16 pass: production is healthy.
If anything fails: that's the regression. Fix it before doing anything else.

## What's currently shipped to production

11 PRs merged April 25-26, 2026:
- #1: Admin↔user propagation audit (B1-B6, Q1-Q3)
- #2: Forum Gala registration HTTP 500 fix
- #3: Admin portal fresh visual theme + classic toggle
- #4: Forum direct-link path-style + script defer
- #5: Plexus pricing sync (settings ↔ ticket_types)
- #6: helmet + CSP + HSTS security hardening
- #7: Speaker upload-link localhost fix
- #8: Invite event_id forwarding + bridges hardening
- #9: Speaker invite emails get auto CTA + code
- #10: db.getRowsModified polyfill (promo code crash)
- #11: production smoke test (`npm run smoke`)

See `tasks/audit-final-2026-04-26.md` for full bug-and-fix log.

## Live URLs

- User portal: https://medx-user-portal.onrender.com  (Starter $7/mo, always-on)
- Admin portal: https://medx-admin-portal.onrender.com  (still on Free tier — manual deploy needed)
- GitHub: https://github.com/alen-ops99/medx-portal

## Key constraint patterns

**Database is shared** — both portals point at `shared/medx_portal.db` (or Turso if `TURSO_DATABASE_URL` set on Render). Schema lives inline in both `server.js` files as `CREATE TABLE IF NOT EXISTS` blocks. No migration system.

**libsql ≠ sql.js** — the codebase originated on sql.js. The wrapper at `shared/db.js` provides compatibility, but some sql.js methods (e.g., `db.getRowsModified()`) are polyfilled. If a backend bug looks like "method undefined", check the wrapper first.

**Service worker is `medx-portal-v5`** — bumping the version (in `user-portal/frontend/sw.js`) is required after JS bundle changes that need to reach returning visitors. `/api/*` is bypassed; everything else is cached.

**Three URL formats for forum events:**
- `?event=<slug>` — query string (always worked)
- `/forum/events/<slug>` — path-style (PR #4)
- `/invite/<base64-token>` — encoded invite from admin "Generate Link" UI

**Single source of truth for Plexus prices**: `plexus_settings` table. Admin save automatically syncs `ticket_types`. Don't edit `ticket_types` directly anymore — it'll get overwritten on next admin save.

**FIRA invoices** — VAT-exempt NGO. `taxExempt: true` always. `country: 'HR'`. Header is `FIRA-Api-Key` (NOT Bearer). Invoice type: `FISKALNI_RAČUN`.

**Stripe** — currently LIVE keys on Render. Test cards won't work; real charges happen. Webhook needs raw body (already wired correctly).

## Workflow expectations

Set in `~/.claude/settings.json` April 26, 2026:
- Direct push to feature branches: ✅ allowed (no prompt)
- `gh pr merge`: ✅ allowed (no prompt)
- Direct push to `main`: blocked (must go through PR)
- Force push to anything: blocked

So Claude can ship end-to-end without click-through:
1. Edit code
2. Push to feature branch
3. Open PR
4. Auto-merge

Render then auto-deploys (user portal Starter — reliable; admin portal Free — sometimes needs manual deploy).

## Latent issues for future sessions

None launch-blocking. Pre-launch hardening complete.

- 5.4MB single-file user portal index.html (gzip helps; bundle-split is a real refactor)
- 16k-line monolithic server.js per backend (modular split is multi-day)
- 163 inline `CREATE TABLE IF NOT EXISTS` (no migration system)
- Stripe webhook handler is 6,450 lines in one async function
- No CSRF token (CSP `unsafe-inline` keeps the door slightly open)
- No forgot-password flow (one-shot Plexus registration doesn't need it; Forum members would)
- 22 dev-seed Plexus registrations in DB (cosmetic — admin sees fake names)
- Admin portal still on Render Free tier (manual deploy needed)
- Visual artifact in admin mobile login top-left (sidebar peeking pre-auth)
- "Grand Ballroom" venue is HTML-only with no DB anchor (acceptable for now)

## Useful commands

```bash
# Smoke test (after every deploy)
npm run smoke

# Run portals locally for testing
(cd user-portal/backend && PORT=2011 NODE_ENV=development node server.js &)
(cd admin-portal/backend && PORT=2012 node server.js &)

# Smoke test against local
npm run smoke:local

# Snapshot DB before audit
cp shared/medx_portal.db shared/medx_portal.db.pre-test-$(date +%Y-%m-%d)

# Check live SW cache version
curl -s https://medx-user-portal.onrender.com/sw.js | grep CACHE_NAME

# Check what's in DB
sqlite3 shared/medx_portal.db "SELECT slug, start_date, is_paid, price FROM forum_events;"

# Tail merge order on origin/main
git log origin/main --oneline -10
```
