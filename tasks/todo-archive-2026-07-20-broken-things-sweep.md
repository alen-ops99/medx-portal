# Broken-things sweep — fix batch (2026-07-20) — ALL DONE, deployed 82c9fd7 + 44ed67a, live-verified EN+HR

Source: commissioned sweep (30-agent audit + live browser pass, all findings adversarially verified).
Full findings JSON: /private/tmp/claude-501/-Users-alen/d47fa78e-4f04-4103-a514-06b17b01cd53/tasks/wuzn44pj2.output
Previous todo archived at tasks/todo-archive-2026-06-10-full-audit.md.

## Broken (fix now)
- [x] 1. .ics calendar links bake https://portal.medx.hr (404) — user server.js:2977 fallback chain
- [x] 2. Prep-checklist "Add Details" throws TypeError (this=window) — make it a working mailto CTA

## Fake-success / fake content (member-visible, de-fake now)
- [x] 3. Registration wizard fake paid add-ons (€35 AI workshop, €35 Grant Writing, €15 cert, €10 proceedings) — remove from seed, empty-safe render
- [x] 4. Plexus "What Attendees Say" 5 fabricated testimonials (hardcoded + DB) — empty seed, hide-when-empty, blank DB field
- [x] 5. Building Bridges 2 fabricated testimonials (Petra Novak / Ivan Matic) — remove cards
- [x] 6. Forum Concierge "Message sent" but sends nothing — wire to real inbox endpoint or mailto
- [x] 7. Pass modal "Resend Email" fake toast — remove button
- [x] 8. Speaker photo upload "(Demo mode)" fake success — truthful message
- [x] 9. Settings + Forum photo upload preview-only, silently unsaved — truthful message
- [x] 10. Abstract submit catch() fakes success + awards points on network error — error toast, keep form
- [x] 11. "Admin Access" tile → embedded legacy demo admin (demo-admin-token) — open real admin portal, delete demo fallbacks
- [x] 12. Forum wing "My Network" fake 24-connections demo grid — real empty state
- [x] 13. Explore Zagreb: Museum of Broken Relationships shows St. Mark's photo — fix URL (verify live before commit)
- [x] 14. Dead "See All Recommendations" button — remove
- [x] 15. Venue Map tile "coming soon" toast — open real venue map link
- [x] 16. Network nav phantom "Messages 3" badge vs empty inbox — real count or hide
- [x] 17. "People You May Know — AI-powered matches" fictional trio — remove/empty state
- [x] 18. Profile modal fabricated 54 connections / 20 publications / 860 citations — real or hidden
- [x] 19. member-profile-panel fake shared connections/achievements/activity — de-fake if reachable

## Hardening (small, do now)
- [x] 20. Admin CORS `: true` fallback → explicit allowlist (admin server.js:945-948)
- [x] 21. VAPID send guards require BOTH keys (user server.js:247/273/293/28415)
- [x] 22. loadSpeakersFromDB fails open (seed revival on empty DB) — symmetric with schedule
- [x] 23. stamp-sw.sh: auto-stamp ?v= busters in user index.html (kill the manual-bump trap); hand-bump split4→split5 this deploy

## Report only (Alen / later)
- EMAIL_FROM: render.yaml sets noreply@medx.hr — Alen verify domain is verified in the active provider
- Test data in prod DB (ZZZ task, QA members, sgseg institution, HR/Croatia + USA/United States dropdown dupes)
- Post-event stubs (certificate/feedback/recordings) hidden until Dec 5 — wire before conference
- portal.medx.hr DNS/Vercel still unset (Alen's go-live item)

## Rules for this pass
- Croatian strings ship in the same commit for every user-visible string change
- No new inline handlers; keep existing pattern (script-src-attr 'unsafe-inline' is set here)
- Bump sw buster: split4→split5 (app.part*.js edits)
- CI green before done; verify live in real browser EN+HR after Render deploy
