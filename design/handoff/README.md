# Design handoff — Claude Design → implementation

## Baselines (exact copies of the exports Alen uploaded)
- `member-portal-2026-08-28/` — member portal redesign (22 artboards, README with product rules + implementation notes 1–16, handoff-notes, BRAND-BRIEF). Identical to the mocks the team reviews at medx-member-portal-review.netlify.app.
- `admin-portal-2026-08-28/` — admin portal redesign (17 artboards; its README is the shared one: member wiring map + "Admin Portal (redesign)" notes 0a–26 + Aug-2026 review decisions).

Each `.dc.html` is plain HTML with inline styles and a tiny template runtime (`{{ prop }}`, `onClick="{{ handler }}"`, `style-hover`, `data-props`). Implementation lives in `user-portal/frontend-v2/` (see its ARCHITECTURE.md — every view names its artboard and wraps blocks in `<!-- dc: <file> › "<section>" -->` markers).

## Applying a design revision (new export of the same folder)
```
node scripts/design-diff.js design/handoff/member-portal-2026-08-28 ~/Downloads/<new export> \
     --out design/handoff/DIFF-member-$(date +%F).md
```
The report lists, per artboard: added/removed screens, sections added/removed, text removed/added, `data-props` default changes, style-only edits, and a pretty-printed markup diff. Patch the v2 view blocks whose markers match, re-run the Playwright sweep, then copy the new export in as the next dated baseline folder.

Brand ground truth: `../brand-kit/BRAND-BRIEF.md`. This `design/` folder never triggers Render deploys (buildFilter covers only the portals).
