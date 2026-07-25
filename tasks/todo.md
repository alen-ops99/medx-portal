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
