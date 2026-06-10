# Full Portal Audit + Fix — 2026-06-10 (Fable 5 session)

User mandate: thorough audit of BOTH portals; fix all bugs found; free rein on UI/UX
improvements (respect Med&X brand + typographic restraint rule). Commit to main,
Alen deploys on Render. Only test data live — read-only probes against prod OK.

Old master plan archived at tasks/todo-archive-2026-02-overhaul.md.

## Plan

### Phase 1 — Map (parallel agents)
- [ ] Map user-portal backend (18k lines): routes by subsystem, auth model, integrations
- [ ] Map admin-portal backend (17k lines): same
- [ ] Map admin frontend (31k lines): views, API calls, styling
- [ ] Map user frontend (5.4MB SPA + sw.js + root index.html)
- [ ] Map DB schema across BOTH server.js files (dual-file divergence = bug source)
- [ ] Live smoke test (read-only GETs) on both Render services

### Phase 2 — Find (parallel audit agents, ~12 dimensions)
Security/auth, injection/XSS, invite flows, Stripe/payments/FIRA, email+QR+scanner,
data integrity, admin correctness, user-frontend UX/perf, admin-frontend UX,
legacy routes (accelerator/conferences/push), config/deps, cross-portal consistency.

### Phase 3 — Verify (adversarial)
Every finding adversarially verified (critical/high get 2 independent skeptics).
Completeness critic looks for under-audited areas → follow-up finders.

### Phase 4 — Triage + Fix (this session, after audit returns)
- [ ] Triage confirmed findings by severity × user impact
- [ ] Fix critical/high bugs first (active Plexus flows = priority)
- [ ] UI/UX improvements batch
- [ ] Local verification (run both servers + Playwright drive-through)
- [ ] Logical commits to main; push only verified states (auto-deploy may be on)

### Out of scope (explicitly)
- Modular split of server.js monoliths
- Migration-system overhaul
- Resend domain verification (separate blocked workstream — Vercel DNS)

## Findings log
Full audit output: tasks/audit-findings-2026-06-10.json (108 confirmed findings:
6 critical, 35 high, 44 medium, 23 low).

## PROGRESS — paused 2026-06-10 (Alen switching accounts, will resume)

### 7 commits made locally on main, NOT YET PUSHED (Alen deploys on Render):
- 269f36b  Stop tracking shared SQLite DB in public repo (.gitignore + git rm --cached)
- d4ba74e  QR ticket emails: hosted /qr/:id.png + PNG attachment (Gmail/Outlook strip data: URIs)
- fa730f5  Security: adminOnly on ~130 routes (accelerator/finance/PR/CSV), IDOR checks,
           speaker leak, admin self-register disabled, tech tools fail-closed
- 2018e29  Data safety: boot wipes scoped to TEST rows; bridges placeholder migration gated;
           gala demo seed retired; fresh-DB boot no longer crashes (FK seeds wrapped)
- b640e6b  Scanner: merged duplicate undo route (+gala), standalone-conference door fallback,
           profile-card gala check-in silent-fail fixed
- 8de660e  Payments: Stripe webhook idempotency (event.id), no free fulfillment on payment
           failure, guest_count clamp, no placeholder IBAN (+render.yaml sync:false)
- 5cff401  /invite-success XSS escaping + real payment-status check; forum API_BASE undefined fix

### NEXT STEP WHEN RESUMING:
1. `git push origin main` (Alen authorized commit-to-main; confirm before push if unsure).
2. Alen: Manual Deploy BOTH services on Render; set real MEDX_IBAN + MEDX_VAT_ID env vars;
   set a strong TECH_PASSWORD; rotate the shared RESEND_API_KEY (shared in chat earlier).
3. SEPARATE (history): the public-repo DB blob is still in git history → purge with
   git filter-repo/BFG + force-push, AND rotate the 3 admin-account passwords (offline-crackable).

### REMAINING AUDIT FINDINGS not yet fixed (from audit-findings JSON), by priority:
HIGH: [19] email send failures swallowed everywhere (sendEmail never throws; callers ignore
  success:false) — ops visibility; [22] CA-gala payments get no FIRA invoice/finance record;
  [24] admin mirror /api/public/register-invite double-inserts (ghost 'pending' rows);
  [28] GalaAdmin.saveSettings wipes speakers/schedule to []; [33][34] more forum/doc IDOR;
  [36] admin JWT accepted in ?token= query param (log/referer leak); [40] password reset
  doesn't invalidate existing sessions; [10b] CA-bundle confirmation email field injection.
MEDIUM (44) + LOW (23): see JSON. Notables: [42] NODE_ENV=development auth auto-admin
  (prod is production so dormant, but fragile); [44] SVG/HTML upload stored-XSS via /uploads;
  [52] admin /api/public/register-invite unauthenticated+unthrottled; [63] gala settings save
  rewrites cleared price to stale 95/174/194; [64] dashboard revenue invents €140 for blank rows;
  [68] viewport user-scalable=no; [69][97][98] redesign wins (strip embedded admin app from
  5.4MB SPA; lightweight ticket page for bare-root/invite visitors; PWA = 'My Ticket' app);
  [70][71] sw.js + 2.7MB dead images; [72] expired 'Apply by Apr 1' carousel copy.

### Local test harness (recreate when resuming):
- Backends boot on isolated DB via DATABASE_PATH=/tmp/medx_test.db; high ports (4310/4311
  or 432x) avoid the parallel session on 3000. .env reloads real Stripe TEST + Resend keys
  via dotenv even with `env -u`, so local Stripe is live-test (harmless).
- Verified locally this session: authz 403s for non-admin; hosted QR PNG renders; speaker
  secrets hidden; fresh-DB admin boot starts; real paid + Zagreb-bridges rows survive wipes;
  scanner 6/6 scenarios; paid register → Stripe checkout (no row pre-payment).

## Review
(filled in at end — audit ~50% of high-severity findings fixed + verified; criticals 6/6 done)
