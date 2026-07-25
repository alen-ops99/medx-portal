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
