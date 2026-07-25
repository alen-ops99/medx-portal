# Connectivity review findings (2026-07-25) — ranked, with exact fixes

FIXED IN fix/connectivity-top (see commit): #1 forum leak, #11-assistant paid guests, #2 HR hub text select.

1. ⚠ LEAK: forum events visible to members BEFORE publish — admin :16389 defaults status='published'
   while is_published=0; member gate user :16875 `(status='published' OR is_published=1)` → gate on
   is_published=1 ONLY. Two prod rows may sit leaked (status published, is_published 0).
2. Croatian project-hub text write-only: user :13742 never selects *_hr cols (sibling /api/public/status
   :11809 does); part6.js :16-29 translates via hardcoded EN→HR phrase-book keyed on exact English.
3. Accelerator intake window NOT editable from admin (PUT exists only on user backend :16438; admin UI 0 refs).
4. Accelerator countdown ignores intake_windows: app.part9.js :12699 fed overview-config; :12358 nulls past
   deadlines → falls to literal 2026-03-31 → hides + paints hardcoded 'Applications open in November 2026'.
5. project_settings dates reach NOBODY member-facing (adminOnly readers + cron only).
6. gala_desc discarded: user :1342 overwrites with computed hardcoded string.
7. Gala countdown counts to plexus day2EndAt (:12038), not gala_settings.date; seeded literals 312/14/32.
8. Year-drift no-ops on 2027-01-01: admin overview-config PUT WHERE year=current returns success writing
   nothing; public read uses is_active=1 ORDER BY year DESC — align selectors + report rows-affected.
9. Public API split across origins: press+newsletter ONLY on admin; site/impact/survey/status ONLY on user;
   CORS 200s on 404s → marketing site silently keeps baked fallbacks. Consolidate or mirror.
10. Propagation lag ~2.5 min worst case (45s PUBLIC_MEMO per-process + 60s sync + 60s cache); bumpPublicMemo
    can't reach the other portal → cross-portal bust ping or 5s TTL.
11. Assistant paid-guest bug (REPRODUCED): :28194 counts bookings not people, omits vip-comp, no TEST
    exclusion; duplicated :35107-11 (assistComputeOverview) + :40377-81 (advisor pack, persists stale
    figure into advisor_reviews). Reference-correct impl 11 lines away at :28183. HR question falls to
    fallback entirely (no Croatian intent match).
12. PR Subscribers Export 401: index.html :39075 window.location.href without auth header. (admin frontend
    — do with next index.html wave)
13. is_accepting/program_start/end have NO admin UI; health check points at nonexistent control.
14. Newsletter: /newsletter works ONLY on admin origin; user origin serves the SPA silently.
15. Repo-root frontend/index.html (4.9MB) is DEAD CODE no service mounts — misleads greps; delete someday.
Zero dead Save buttons across both frontends (616+333 paths swept). CORS reflects medx.hr correctly.
