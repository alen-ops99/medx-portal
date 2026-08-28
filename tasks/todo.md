# MEMBER PORTAL REDESIGN → functional review build (started 2026-08-28)
Directive: build the Claude-Design member portal as a WORKING app, every button wired to the real
backend, deployed for team review on Render (staging backend) + Netlify (front end). NOT on main,
NOT on the prod Render services, NOT on medx.hr until Alen signs off. No spending without asking.
Branch: redesign/member-portal. Design source: ~/Downloads/uploads/export/medx-member-portal-final
(identical to the mocks at medx-member-portal-review.netlify.app; team comments due Sun 2026-08-30 → fold in).

## Phase 0 — Truth (DONE 2026-08-28)
- [x] Three audits: design/verify-2026-08-28/{USER,ADMIN,WEBSITE}-*-CONNECTIONS.md (all live-probed)
- [ ] Master doc + gap matrix (agent running): design/PORTAL-CONNECTIONS-MASTER-2026-08-28.md, verify-2026-08-28/REDESIGN-GAP-MATRIX.md

## Phase 1 — Staging backend ($0)
- [x] deploy/staging/launcher.js (both backends, one DB, /__admin prefix, waking 503) + build-seed.js + README
- [x] deploy/staging/seed.sql.gz scrubbed seed + SEED-NOTES.md (13 team kept, 43 pseudonymized, password Plexus2026!)
- [x] user server.js: honour CORS_ORIGIN env in the hardcoded allowlist (branch only)
- [x] Render free web service `medx-staging` (srv-da90uugae00c73dig42g, frankfurt) + Turso DB medx-staging; verified health, member+admin login, admin→member propagation
- [x] Netlify admin review site https://medx-admin-portal-staging.netlify.app (entry /wake.html)

## Phase 2 — Member front end v2 (user-portal/frontend-v2, no build step)
- [ ] Shell: Portal Chrome (top bar, stats strip, email banner, drawer), router (path-style, keeps /plexus?event=&ticket=&from=website&mxt=), api.js (JWT in localStorage medx_user_token, waking-state retry), auth screens
- [ ] Screens in parallel (one agent each, gap matrix = contract): Home · Plexus overview/program/Zagreb/My Plexus · Gala · Accelerator + 7-step wizard (port existing logic) · Forum · Bridges · Network · Messages · Profile · My Med&X wallet · empty states · system pages · mobile (≤430px bottom tabs) · PWA manifest/icons
- [ ] Every control from the README wiring map → endpoint; MISSING backend pieces → implement on the branch (staging deploys them) and list in the report
- [ ] Netlify site for v2 (new site; keep the mock review site untouched)

## Phase 3 — Verify (Alen: "check in the end that all buttons and connections work")
- [ ] Playwright sweep on the Netlify build against staging: every screen, every button → handler fires, network call succeeds, no console errors; admin→member chain test (publish speaker/program/status in admin → visible in member v2); website hooks unchanged
- [ ] Report to Alen: URLs, test logins, what is wired, what is stubbed, what needs him (Turso platform token, Stripe test key, photos)

## Phase 4 — Go-live (only on Alen's sign-off; separate session)
- [ ] Merge to main → Render prod (frontend dir swap, CORS/CSP entries, SW cache stamp), medx.hr links unchanged

---

# Admin Portal Overhaul — Alen's comments 2026-07-25 ("skeleton → muscles")

Directive given verbally before his 2h call; computer is ours. Plan → deep review (1-2h, three
parallel auditors) → execute → verify → deploy, incrementally.
His answers: he adds ANTHROPIC_API_KEY on Render (both services) · backup-then-purge approved ·
wire real analytics.

## Phase 0 — Safety + truth (FIRST)
- [ ] In-DB backup: purged rows copied to `_purged_*` tables before delete (restorable, no creds needed)
- [ ] Exact fake-data inventory from the SEED blocks in both server.js files (target seeded rows precisely, never heuristics)
- [ ] Purge migration (app_state-guarded, one-time): demo registrations/members/chat/tasks/action items — ambiguous rows LEFT and listed for Alen

## Phase A — Homepage (his exact spec)
- [ ] Action Center: clear stale/done items; henceforth computed from REAL data only
- [ ] "Numbers to chase" (payments/speaker apps/scholarships/visas): real queries only, drop tiles with no real source
- [ ] Live Overview → ONE bigger "Plexus Week" card (conference + gala + donor night): real registration counts + chase numbers + finance state; remove accelerator/forum/bridges fake tiles
- [ ] Registration trends moved up next to it (one card)
- [ ] Task Center by area (gala/plexus/forum): keep, make clearer
- [ ] To-do lists: keep but collapsed by default
- [ ] DELETE: "Content to fill" section + "Upcoming milestones"
- [ ] Executive suite: weekly (Fri 17:00 Zagreb) REAL digest reading all projects via AI
- [ ] Site analytics: wire real privacy-clean page-view tracking feeding the card

## Phase B — Plexus Week section
- [ ] Its Action Center: purge fake, CONNECT to the task section (urgency flows from tasks)
- [ ] 3D Esplanade ballroom planner: exists in Gala seating (commits #47/#48) but Alen can't find it in Plexus operations — surface a card there too + verify the Gala embed renders. URL (from Alen): https://plexus-tables.netlify.app/planner.html
- [ ] Full button inventory (communications, marketing content, every tab): fix dead/no-op buttons or remove
- [ ] Persistence audit: everything editable must save + reload

## Phase C — Branding + generated artifacts
- [ ] Real Med&X logo image (never "MEDX" in a font) in EVERY artifact: attendance cards, roll-up banners, badges, PDFs, emails
- [ ] Design customization (colors/layout/fields) + AI assistant for cards/banners
- [ ] Bar: five levels up; brand truth = medx-website-preview.netlify.app (Fraunces/Inter, ink/cream/crimson #9b1b22/gold #c9a962)

## Phase D — Navigation + feedback
- [ ] Browser back = previous section, not homepage (SPA history fix)
- [ ] Empty top-right toasts: reproduce + fix; every action gives real feedback
- [ ] Chat: reset fake content (purge), verify/expose channel creation UI

## Phase E — Merciless stress test
- [ ] Playwright sweep: every section/button — handler fires, no console errors, toast non-empty
- [ ] Test emails → juginovic.alen@gmail.com (check spam; SPF still pending)
- [ ] Generate every artifact type → ~/Downloads → READ back for quality + logo
- [ ] Final report: fixed / removed / needs-Alen

## Working rules
- Branch per phase off origin/main; local verify on scratch DB; deploy; live-verify (sw.js SHA)
- macOS has no `timeout` — nohup+sleep+kill; never edit while dev servers serve
- Purge = backup tables first; ambiguous rows untouched

## Round 2 — Alen post-call comments (2026-07-25 evening)
- [ ] SIDEBAR REORG: left nav has "a shit ton of stuff", badly organized — design a clean grouped IA
- [ ] CONNECTIVITY REVIEW: publish-from-admin → public page must be verified end-to-end (thorough)
### Colleague comments
- [ ] 1. Accelerator countdown controllable via admin, shown across the web
- [ ] 2. Change the Plexus program (schedule content — needs THEIR new program? flag what's needed)
- [ ] 3. Krešimir Luetić + George Abraham photos (speakers — need image files or sources)
- [ ] 4. ⚠ Gala price shows 0 somewhere, must be 150 — POSSIBLE REGRESSION from ticket-zeroing migration; find the surface, fix the source
- [ ] 5. "Darujte jednokratno" (one-time donation) broken link on the website
- [ ] 6. Add latest annual financial report to the website
- [ ] 7. Accelerator PDF: ability to add an article/section via admin
- [ ] 8. Interviewer magic link broken? + show candidate full name on scoring + evaluation sheet
- [ ] 9. Translate Accelerator application form to Croatian
- [ ] 10. ⚠ Web shows BB Boston, portal doesn't — MY PURGE removed Boston (audit called it fake; _purged_bridges_events has the backup) — verify with the live site, likely restore Boston, ask Alen re Zurich/Washington
- [ ] 11. Med&X Assistant returns wrong info about paid guests
- [ ] 12. Where do newsletter signups land in admin? (pr_subscribers → PR & Media; verify + surface clearly)
- [ ] 13. Brevo vs Outlook/medx.hr for newsletter sending — needs a decision memo (SPF still pending!)
- [ ] 14. "PDF export functionality" (ambiguous — probe which export they mean)
- [ ] admin-frontend articles editor for accelerator PDF (dynamic {title,text} list — mirror user-portal app.part9.js:35780-35850; backend already returns/accepts `articles`)
- [ ] ranking-PDF still filters validity_status='valid' (NULL until triage → empty table) — flagged, Alen to confirm intended
- [ ] MINI-SWEEP the hub-tile-only sections the registry sweep missed: speaker-itineraries (+enumerate any other non-sidebar sections) — Alen found blank-banner (stale SW likely) + localhost link (FIXED)
- [ ] FinanceApp.api() (user portal) still falls back to MOCK_DATA on failed list/detail reads — replace with honest error/empty state (fabricated rows must never render)
