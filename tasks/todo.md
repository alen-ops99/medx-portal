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

## PROGRESS — 2026-06-10 (resumed after account switch; ALL 6 CRITICALS + most HIGHS done)

### 14 commits on main, NOT YET PUSHED (Alen deploys on Render):
269f36b DB out of public repo · d4ba74e QR emails hosted+attached · fa730f5 ~130 routes adminOnly
+ IDOR + admin self-register off + tech fail-closed · 2018e29 boot-wipe data-safety + fresh-DB boot
· b640e6b scanner undo/standalone/profile-card · 8de660e payments idempotency/gate/IBAN · 5cff401
invite-success XSS+payment-check+API_BASE · 8b303ee forum-chat IDOR + accel doc gating + reset
invalidates sessions (password_changed_at) · dc4b7ca ghost dup registrations + gala settings
data-loss + stale prices · 751a74f dashboard revenue accuracy + email-fail visibility · 88df4dc
legacy scanner reads regId + no JWT in download URLs · 68ee4e2 CA-gala FIRA+finance · a2d8294
fixed 3 self-review regressions (travel-order over-gating, wipe column order, scanner dietary col).

### VERIFICATION: ran an 11-agent adversarial review of the full diff → found 3 regressions,
all fixed + re-verified. Runtime battery green: authz 403/200 correct (incl. applicant routes
NOT over-gated), QR PNG renders, speaker secrets hidden, scanner 6/6, payment gate, session
invalidation, mirror no-op (0 rows), fresh-DB boot clean, traveler self-service restored.

### NEXT STEP WHEN RESUMING:
1. `git push origin main` (Alen authorized commit-to-main).
2. Alen: Manual Deploy BOTH services on Render; set real MEDX_IBAN + MEDX_VAT_ID; set a strong
   TECH_PASSWORD; rotate the shared RESEND_API_KEY (shared in chat earlier).
3. SEPARATE (history): public-repo DB blob still in git history → purge with filter-repo/BFG +
   force-push, AND rotate the 3 admin-account passwords (offline-crackable).

### REMAINING (lower priority — not launch-blocking), from audit-findings JSON:
HIGH still open: [6709] interviewer magic-link tokens have no expiry/rotation (accelerator,
  off-season).
MEDIUM (44) + LOW (23): mostly polish. Notables: [42] NODE_ENV=development auth auto-admin
  (dormant in prod, fragile); [44] SVG/HTML upload stored-XSS via /uploads (add type allowlist +
  Content-Disposition); [52] now moot (mirror is a no-op); [68] viewport user-scalable=no;
  [69][97][98] REDESIGN WINS (strip embedded admin app from 5.4MB SPA; lightweight ticket page
  for bare-root/invite visitors; PWA = 'My Ticket'); [70][71] sw.js hygiene + 2.7MB dead images;
  [72] expired 'Apply by Apr 1 2026' carousel copy. Full list: tasks/audit-findings-2026-06-10.json.

### Local test harness (recreate when resuming):
- Backends boot on isolated DB via DATABASE_PATH=/tmp/medx_test.db; high ports (4310/4311
  or 432x) avoid the parallel session on 3000. .env reloads real Stripe TEST + Resend keys
  via dotenv even with `env -u`, so local Stripe is live-test (harmless).
- Verified locally this session: authz 403s for non-admin; hosted QR PNG renders; speaker
  secrets hidden; fresh-DB admin boot starts; real paid + Zagreb-bridges rows survive wipes;
  scanner 6/6 scenarios; paid register → Stripe checkout (no row pre-payment).

## Review
(filled in at end — audit ~50% of high-severity findings fixed + verified; criticals 6/6 done)
