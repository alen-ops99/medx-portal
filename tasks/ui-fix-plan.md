# UI fix plan (Audit B, 2026-07-25) — shots in /Users/alen/.claude/jobs/ad4f417d/tmp/ui_audit_shots/

## Root causes (exact)
1. TOASTS INVISIBLE: index.html:6202 `.toast{color:#fff}` + :6784 `body.theme-fresh .toast{background:#fff}` (theme-fresh = default). Text present, contrast 1.0. Fix: dark color on themed toast + per-type tinted backgrounds. ALSO window.Toast undefined (top-level const never attached — dozens of `if(window.Toast)` calls dead) and App.showToast called ~11× but NEVER defined (index.html:28066 unguarded → throws). Persistence is SOLID — invisible toasts caused the whole "is it saving?" feeling.
2. BACK BUTTON: section/tab navigation pushes no history (history.length pinned at 4) → Back exits app. Plexus leaves sidebar .active=null.
3. QR CHECK-IN 500: croatians_abroad_registrations MISSING conference_checked_in (+3 sibling cols) — ALTER at server.js:8088 silently failed (empty catch), queries at 32265/32305/32341 crash. Heal with logged ALTERs at END of init.
4. DEAD (Discover page): Skip tour, Try-it-now Finances, Try-it-now Sponsors/Campaigns (+QR one 500s). Auctions section's 1 button dead. Plexus tiles + all sub-tabs: ALL WORK.
5. VISUAL worst-first: FABs overlap content (chat text, form fields) + one teal off-brand FAB; search icon overlaps placeholder EVERY page (padding-left 14→~34px); native <select>s; Finances 12 tabs wrap 3 lines; stat-card grid hole; onboarding CTA below fold (y=994 @900px); empty Croatian placeholders Member Ops.
6. CHAT: channel creation EXISTS + works (modal via + next to CHANNELS); Team Chat surfaces only 3 of 22 channels (split-brain — seeded msgs in 'general' invisible; purge removes demo msgs anyway); dupe channel names general/operations ×2.
7. Console: clean (0 errors) across 22 sections.

## Batches
- [x] Audit banked
- [x] B1 quick wins (f5e8165, LIVE) (one commit): toast CSS + window.Toast + App.showToast alias; search padding; FAB reposition + brand color; checkin column heal; advisor weekly Monday→Friday
- [x] B2 homepage restructure (260052f, LIVE) (Alen spec): Plexus Week mega-card real numbers, kill milestones + content-to-fill, collapse todos, move trends, clarify task center, Discover dead buttons wired or removed
- [x] B3 back-button history (7fa2a38, LIVE) (pushState/popstate + sidebar active)
- [x] B4 artifacts branding wave (48ef6cf, LIVE; deferred items in memory) (tasks/artifact-fix-plan.md)
- [ ] B5 chat channel-list fix + Playwright regression sweep + test emails + docs to ~/Downloads
