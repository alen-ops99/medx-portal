# Exhaustive button sweep findings (2026-07-25) — fix-wave source

## Sweep B (second half, 16 sections, 211 real controls clicked, 293 records) — DONE
BROKEN (1): pr-media Subscribers Export → 401 (index.html:39072 location.href, auth() Bearer-only) — fix: fetch+blob download with auth header.
BY-DESIGN (1): tech Unlock 503 when TECH_PASSWORD unset — add honest "disabled" hint to the gate.
NO-OPs (4, benign): messages Member-messages/Inbox re-click; portal-content Featured/Quick-Links highlight-only.
Toast shows raw "Failed to fetch" on pulse send failure — humanize error copy.

### Design defects ranked (fix queue)
1. FAB stack covers live controls (team-chat Send, website-content Preview, member-ops, task deletes, year-calendar bars). Existing fix at index.html:20608 hides only globalQRBtn+assistantFab and only on 2 sections — staffShareBtn NEVER hidden. Proper fix: hide/shift ALL fabs when overlapping interactive elements, or reserve right gutter padding on content.
2. FABs float above modal overlays (z-index above dialogs) — put fabs below modal z.
3. Media Library "No Preview" wall on off-brand slate-navy (#3a4657) tiles.
4. Dev/infra copy in PR Calendar UI (PUBLER_API_KEY, Render redeploy, kill switch, docs path, "coming later" button).
5. Breadcrumbs print raw slugs (newsletter/resources/team/tech/...) vs H1 names; Media Library breadcrumb says "Media Kit".
6. Off-brand accents: green stats/labels, green signup icon, blue/purple/slate calendar legend, system-blue native checkboxes.
7. ~25 native <select>s — style globally (single CSS rule for select to match inputs).
8. Clipping: PR Subscribers Actions column cut off; chat messages clip mid-word; sidebar sub-labels clip ("Email Registrant", "Board pack").
9. Raw data in tables: ISO timestamps, slug lists, "-" open rates, "Linkedin".
10. Monospace placeholders in textareas; AI Studio placeholder clipped by box height.
11. Calendar toolbar: 4 control heights in one row, "Add Content" wraps.
12. Layout dead space: Team Access ~620px forms in 1180; Resources 1/3-width cards; Newsletter/Portal Content ~500px empty below fold.
13. Croatian strings in English admin UI (Godišnje izvješće etc.).
14. Sidebar search icon overlaps placeholder (STILL — my padding fix hit .search-input; sidebar input uses another class — find and fix that one).
15. Outbox has no page (drops mid-email-blast, no title); destructive Discard as bare text link.
Also: merch-studio nav = hidden external link (fine, but show external-link affordance).

## Sweep A (first half) — PENDING, append below when it lands.

## Sweep A (first half, 18 sections, 789 controls, 866 records) — DONE
Full: /Users/alen/.claude/jobs/ad4f417d/tmp/final_report.txt + design_audit.json + sweepA_inventory.jsonl + 369 shots.
ERRORED (11): ⚠ finances Event Payments HTTP 500 hangs on "Loading…" (server.js:26137 selects a.payment_status/payment_amount/payment_date/stripe_session_id from accelerator_applications — columns don't exist) · forum Groups "Join" 403 for admins (endpoint requires forum membership; hide or fix) · accelerator Files "Members" modal throws getBoundingClientRect null · Interviewers "Copy link" clipboard-denied SILENTLY (add fallback+toast) · conferences Q&A refresh/post fail unstyled when member portal absent.
NO-OPs (8): filters Clear inert (disable when inactive) · bare <i> false affordance (accel form) · empty-composer send silent · closeCandDrawer × on drawerless tabs (forum ×2) · benign already-active tabs.
DESIGN (ranked, merge with B's list):
A1 SIDEBAR CLIPS 2/3 OF NAV at 1440×900 (#sidebarNav 604px vs 1896px scrollHeight, no scroll affordance, active section itself often hidden) — make it scroll visibly/fit.
A2 Event Payments tab: broken + most off-brand screen (4 saturated gradient KPI tiles).
A3 Tab bars overflow viewport (accelerator "Files" tab renders PAST 1440px; forum slices last tab; finances wraps ragged) — scrollable tab strips with affordance.
A4 Stale sidebar highlight: showSection clears .nav-item.active but never .sidebar-project.active (one-line fix ~20495-20580).
A5 Table action columns stack vertically at 9+ cols (finances transactions/invoices/work units); ids+dates wrap 2-3 lines — nowrap + min-widths.
A6 Discover tour chips overlap/truncate (.thd-item 329px in 291px; "Content Stud"); broken-image glyph tile.
A7 Nine off-brand hues (greens/purple/teal/sky/amber/orange/pink) — unify to brand w/ semantic exceptions.
A8 Bridges New Event modal malformed (175px inputs < labels, mixed label positions, native pickers, mono textarea, no required marks).
A9 FABs occlude content (also B#1) — reserve gutter / auto-hide contextually + tooltips.
A10 Native controls in styled forms (37 selects, checkboxes, date inputs; Reconcile row worst).
A11 One crimson style for create/confirm/delete — introduce destructive variant; dialog severity icons.
A12 Three confirm-dialog patterns — standardize title+body+verb.
A13 Machine strings: breadcrumbs print ids ("home-general", "email-blast"); Audit Log raw kinds; System Health prints env-var names to the president.
A14 "Candidate #null" modal title (~31368), "Your title appears here" preview strings, "12 members from 0 countries".
A15 Destructive inline at equal weight (Archive next to Start next; Approve&send heaviest with real emails printed; Set live styled like Edit; Bank Balance delete-only rows).
Runners: Croatian in EN UI (gameday), 4 date formats, Reports tab no export, Copy-link opens Live Editor modal, hub pages 55-65% blank below 390px.
