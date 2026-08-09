# Design handoff — Claude Design → implementation

Claude Design writes its member-portal redesign output HERE:
- `tokens.css` (or .json) — colors, type scale, spacing, radii as variables
- `components/` — per-component specs (buttons, cards, inputs, nav, badges) with states
- `screens/` — final screens, desktop + mobile, named by area (dashboard, register, tickets, …)

The implementation (Claude Code) reads this folder and applies it 1:1 to `user-portal/frontend/`
without changing features or backend logic. Brand ground truth: `../brand-kit/BRAND-BRIEF.md`.
Note: this `design/` folder does NOT trigger Render deploys (buildFilter covers only the portals).
