# RESKIN-NOTES — /plexus registration-form reskin (UXFIX-M2 #3) applied to main

Date: 2026-09-01 · Patch: `medx-portal-fresh/deploy/staging/UXFIX-M2-register-reskin.patch.md`
Files touched (only these two):
- `user-portal/backend/server.js` — blocks 1–11, presentation strings only
- `user-portal/frontend/assets/gala/gala_keynote_anderson.jpg` — section D copy (512×512 full-bleed square from redesign repo's `frontend-v2/assets/gala/`, replaces the 400×400 gold-ring circle badge; visually confirmed both before overwrite)

## Blocks applied — 11/11, all OLD anchors matched prod verbatim, zero adaptation needed

1. `galaKeynoteBlock(light)` — cream light variant added; dark default preserved for the two invite call sites (lines 3478, 3914 — verified they pass no arg). `onerror` now collapses (`display:none`).
2. `PLEXUS_SHELL` — full replacement by the patch's start/end anchors (was lines 1156–1288, 133 lines). Fraunces+Inter Google-Fonts head, cream ground, ink hero, hairline zero-radius cards, crimson submit, ink logo mark + typeset fallback. 880/768/480 breakpoints and iOS ≥16px input rule kept.
3. Notice-page heading `#ef4444` → `#9b1b22`.
4. `/plexus` calls `galaKeynoteBlock(true)`.
5. `plexLinkNote` green chip → gold-hairline cream banner.
6. Three `#64748b` hint spans → `#9b8f80` (guest-count, discount-code, guest-email). The 4th occurrence of the same span string (line ~2737, different page) deliberately untouched.
7. Coupon Apply button → flat gold house button.
8. Guest cards in `plexGuestFields` → hairline cream cards.
9. Coupon messages: 3× `#fca5a5` → `#9b1b22`, 1× `#5eead4` → `#6e5626`.
10. Success-card check `#22c55e` → `#c9a962`.
11. `plexPayFallback` box → cream `#f1e8d3` / ink / crimson retry button.

## Deviations from the patch

None. Every OLD block was found byte-identical in prod main; line numbers differed slightly from the patch's redesign-branch estimates (e.g. shell at 1156 not 1159) — applied by anchor text as the patch instructs. One expected side effect of the whole-shell replacement: prod's orphaned `.event-icon` CSS rules (5 selectors + one 768px rule) are gone with the old shell — grep-verified no /plexus markup ever renders `event-icon` (the selectors at ~3393 belong to a different page's own shell, untouched).

## Verification (all on this working tree)

- `node --check user-portal/backend/server.js` — OK.
- Diff audit: `git diff -U0` contains no functional lines (no fetch/route/Stripe/API/DB tokens; only markup/CSS strings and comments).
- Boot test: `NODE_ENV=development PORT=3117 JWT_SECRET=devtest DATABASE_PATH=/tmp/reskin-boot.db node user-portal/backend/server.js` → up in ~1s, dev mock-email drainer active. `GET /plexus` → **200**.
- Marker greps on the live response: Fraunces ×8, `#191512` ×26, `#f7f1e6` ×19, `#9b1b22` ×10, Fraunces fonts link present; **zero** occurrences of `0f172a`, `1e293b`, `linear-gradient(160deg`, `rgba(34,197,94`, `a7f3d0`, `fca5a5`, `5eead4`, `22c55e`, `ef4444`, `event-icon`, `b8965a`, `64748b`, `94a3b8`, `e2e8f0`. JS contract intact: `plexToggle`/`plexRecompute`/`plexSubmit`/`plexGuestFields`/`plexApplyCoupon` + `/api/croatians-abroad/register` all present.
- POST test: `POST /api/croatians-abroad/register` `{first_name, last_name, email, institution, country, selected_conference:1, source:'plexus'}` → **200 `{"success":true, "status":"pre-registered"}`** (dev mode, mock email — nothing sent).
- Screenshots (Playwright, looked at both): `/tmp/reskin-work/plexus-1280.png` and `plexus-390.png` — cream/ink/gold house look, italic Fraunces hero, hairline event cards with gold-dark FREE/€ labels, four keynote photos rendering in the light block, crimson COMPLETE REGISTRATION; 390px stacks to one clean column with 16px inputs and 44px calendar chips. No navy, no SaaS card look anywhere.
- Invalid `/plexus/<token>` falls through to the public form — pre-existing route logic (notice pages fire only for disabled/expired/exhausted links), unchanged; the notice code itself now renders crimson-on-cream via the shared shell.
- Teardown: test server killed, `/tmp/reskin-boot.db` deleted.

NOT done (per instructions): no commit, no push, no deploy, no emails.
