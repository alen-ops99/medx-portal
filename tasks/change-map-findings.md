# Change-map findings (2026-07-25) — feeds the in-admin "Where this appears" panels
Full data: /Users/alen/.claude/jobs/ad4f417d/tmp/change_map/ (map.json = 8 groups, 60 surfaces,
36 traps; originals/ + annotated/ screenshots).

KEY FACTS
- Live medx.hr runs MedXLive hydration (1763-line site.js) — the LOCAL site_v2 copy is STALE, never trace from it.
- 4 no-auth reads feed the site: /api/public/site + /content + /status (user origin), /api/public/press (ADMIN origin — cold-start soft-fail to baked cards).
- Rule: a slot only overwrites when live value NON-EMPTY (blank = baked HTML stays; 0 is NOT blank — hence the EUR 0 incident, FIXED ff41776).
- Site footprint: 28 slots, 5 strips, 4 status bars, 4 lists, 2 countdowns on 8 of 16 pages; everything else baked.

TRAPS (the panel's third state: WIRED-BUT-INVISIBLE / HARDCODED)
- Speakers grid on 3 pages is SUPPRESSED while live keynote names == baked fallback names; edits to title/photo/talk change nothing; Add-Speaker modal never sends is_published (inserts hidden). keynote_count_word DOES update (count can contradict cards).
- Accelerator date on the site = hand-typed project_status text; intake_windows has NO admin UI; portal short-circuits /countdown with an argument (programs.deadline races intake_windows); 6 hardcoded "Applications open in November 2026" strings when target null.
- Program/sessions NEVER reach the site (baked #program); public /api/plexus/schedule lacks is_published filter; publish button sends no body (unpublish unreachable).
- Gala date: 3 sources (site=conferences.end_date, portal hero=gala_settings.date, portal countdown=plexus_settings day2EndAt); SITE countdown targets deadline.early_bird ("38 days" ≠ ~133 to gala); gala status bar has `hidden` attr applyStatus never removes; dress code/venue baked.
- Homepage "Four projects" hub fully baked; forum page has zero hooks; project_settings reaches no surface.
- Content blocks: hard 7-key whitelist; forum.announcement has NO consumer; body_hr returned but PUT never writes it.
- Press: works, admin-origin only.
- Prices: 3 independent sources (ticket_types=site, plexus_settings.price_*=portal plexus, gala_settings=portal gala).

PANEL IMPLEMENTATION PLAN (agent's rec, adopt): serve map.json as /api/admin/change-map (version
in repo); one "Where this appears" affordance per section at anchors: speakers hdr :8304,
sessionModal :8218, galaSettingsTab :12955, moHomeRows :12535/44548, contentStudio openSlot
:45344, prPressComposer :11709, confTickets :51321, accel overview config :8815. Three status
pills: LIVE / HARDCODED (redeploy) / WIRED-BUT-INVISIBLE (amber; precondition string evaluated
live, e.g. keynote_names != baked_names). Add propagation_seconds (~150) + "verify on medx.hr"
button (#:~:text= deep link).
PRE-PANEL FIXES still open: gala countdown targets (both surfaces), speaker suppression UX,
intake_windows admin UI, is_published on Add-Speaker.
