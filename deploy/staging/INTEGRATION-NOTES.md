# Integration notes (I apply these after all builders finish)

## From FORUM builder (done, committed)
- auth.js handleCode: replace `/api/forum/invitations/redeem` call —
  signed-in → `api.post('/api/v2/forum/redeem-code',{code})` → toast r.message → `router.replace('/app/forum')`;
  guest → `api.post('/api/v2/forum/check-code',{code},{noAuth:true})` → `sessionStorage.setItem('medx_forum_code',code)` → `/app/auth/signup?next=%2Fapp%2Fforum` (forum view auto-redeems).
  Errors: `e.data?.code==='unknown'` → invalid-code copy; bare 404 → offline copy; else e.message. Optional: prefill from ?code=.
- Backend bug found: `/api/my/events` forum branch selects nonexistent columns → forum registrations never reach wallet/stats (server.js fix at integration).
- Seed content: no future forum_events besides the seeded forum-2027-gathering; forum_news future-dated (Sep 1 / Oct 15); only 2 forum_members.

## From PROFILE builder (done, committed)
- home.js load(): add `comp: api.get('/api/v2/profile/completion')` to settle; replace `completion: profileCompletion(me, r.net),` with the r.comp-based object (fallback to client calc when absent).
- server.js ~11907 `/api/auth/me` SELECT: append `, email_verified`; app.js refreshMe: preserve prev.email_verified when undefined.
- server.js v2 mount ctx (~29420): add `awardPoints, rewardsSettingNum` so profile PATCH awards completion points.
- Columns added by module: users.title/city/specialties/updates_opt_in/profile_saved_at (+user_profiles mirrors). Completion formula server-side (photo20/spec15/bio15/name10/inst10/title10/country10/verified5/saved5).
- Seed: users.country mixes codes/names; 0 photos/bios; founder row missing diacritic.

## From MESSAGES builder (done, committed)
- chrome.js refresh(): add `inbox: api.get('/api/v2/messages/unread-count')` to the settle map; unread = (r.notifs?.unreadCount||0)+(r.inbox?.unread||0); same in the only:'notifications' branch.
- Note for Alen/report: admin replies do NOT email members today (artboard footer promises it) — candidate server-side follow-up.
- Seed: pjero.bacic lacks admin `member-ops` section (admin inbox 403) — curator/me: extend allowed_sections on staging; zero seeded messages; one pending connection.

## From PLEXUS builder (done, committed)
- server.js /plexus clientJs (≈:1569, after plexRetry, before </script>): add the ?pick= preselect IIFE (in the builder's report; splits pick on comma → .event-option[data-key] .selected + plexRecompute()).
- Seed: conferences.venue_name "Hotel Esplanade" + max_capacity 200 (canonical: Novinarski dom, cap 100); plexus_settings key_dates keep abstracts + Sep 30; gala_settings.description starts "pojjpojpo"; gala time 19:00 vs design 19:30 — CURATOR territory; speaker bios all empty; impact 92 guests.
- v2_speaker_meta (logo/event_tag) adminOnly PUT until the Speakers manager ships; conference photos writer added (adminOnly).

## From ACCELERATOR builder (done, committed)
- No shared changes requested.
- CURATOR/staging data: intake_windows opens 2026-11-01 (canonical Dec 8) → PUT /api/accelerator/intake/window; institutions = 8 US schools, canonical hosts (Cleveland/Mayo/Columbia/Zurich) missing; "Dr. Example" mentor lines; stale key dates + program deadline.
- FOR ALEN (policy): the live portal charges a €75 accelerator fee — the design does not mention it; kept for now.
- Pre-existing backend defects (server.js, candidates for the fix pass): GET /api/accelerator/applications/:id/documents + /documents/:docId/download 500 (select non-existent file_name/verified columns); member POST /api/accelerator/applications never sets program_id (applications/my misses wizard rows); no server-side open-window gate on that POST.

## From GALA+BRIDGES builder (done, committed)
- server.js /plexus inline script ?pick= preselect: TWO builders asked for this — use the plexToggle variant (Gala builder) so the form's own logic runs; verify plexToggle/plexRecompute names at apply time. Single insertion only.
- FACTS additions (optional): bridges.next.venue null, bridges.perEvening '40–50'. ARCHITECTURE §0 rows → built.
- CURATOR/staging data: Boston row says "Harvard Faculty Club"/"symposium at Harvard" (must lose Harvard branding); Zurich/Washington rows dated past but flagged upcoming; gala schedule 18:00 vs event 19:00; awards row titled "Biomedical Forum Annual Awards"; gala description "pojjpojpo"; 5 speakers vs 4 hardcoded on /plexus page.
- Note: medx.hr Boston pre-registration still goes to a Google Form — the portal's bridges registrations and that form don't meet (for the report to Alen).

## From NETWORK builder (done, committed)
- No shared changes requested.
- CURATOR/staging data: 12+ blank/junk institutions ("sgseg", "QA - DELETE"); one nameless account; internal admin/test accounts publicly listed in the directory; country codes vs names mixed. Pseudonymized "Member NNN" names are by design (seed scrub) — reviewers should be told.


## From EMAILS builder (done, committed) — SERVER.JS PATCH LIST (apply verbatim at integration)
- :11341–11359 issueEmailVerification template block (ends `, loc);`) -> const emailHtml = require('./v2/email-templates').confirmEmail({ firstName: user.first_name, verifyUrl, locale: loc, validFor: hr ? '24 sata' : '24 hours' });
- :11301–11309 /api/resend-verification block -> confirmEmail({ firstName: user.first_name, verifyUrl, validFor: null });
- :20001–20021 Plexus welcome -> ticketConfirmation({ firstName: userName, eventName: 'Plexus Conference 2026', headlineHtml: 'Plexus 2026 — seat <i>confirmed</i>.', dateLabel: lookupEventWhen('plexus', regId) || 'December 4–5, 2026', guestLabel: userName, ticketNumber: invoiceNumber, ticketLabel: ticket.name, priceLabel: price > 0 ? `€${price.toFixed(2)} · ${paymentStatus === 'paid' ? 'paid' : 'payment pending'}` : 'Free', qrPngUrl: qrImageUrl(regId), passUrl: `${QR_BASE_URL}/app/plexus/mine`, walletUrl: `${QR_BASE_URL}/app/me`, calendarUrl: `${QR_BASE_URL}/calendar/plexus.ics` })
- :26968–26984 gala approval -> ticketConfirmation({ firstName: updated.first_name, eventName: 'Plexus Gala Evening 2026', headlineHtml: 'Gala Evening — invitation <i>approved</i>.', dateLabel: lookupEventWhen('gala', updated.id) || 'December 5, 2026 · 19:00', guestLabel: `${updated.first_name} ${updated.last_name}`.trim(), ticketLabel: updated.pricing || undefined, note: 'Your invitation is approved — one step left: payment. Your seat and its entry QR are confirmed the moment it completes.', ctaLabel: 'COMPLETE PAYMENT →', passUrl: portalUrl })
- :17460–17472 forum confirmation -> ticketConfirmation({ firstName: greetName, eventName: event.title, dateLabel: eventDate, venue, ticketNumber: qrCode, ctaLabel: 'OPEN THE PORTAL →', passUrl: 'https://medx-user-portal.onrender.com/app/forum', note: `Keep reference <strong>${qrCode}</strong> — you'll need it at check-in. Schedule updates are posted in the portal.` })
- :28925–28933 ticketEmailHtml -> (rid, greetName) => ticketConfirmation({ firstName: greetName, eventName: cfg.name, dateLabel: cfg.whenLine.replace(/&middot;/g, '·'), note: cfg.whenNote || undefined, qrPngUrl: qrImageUrl(rid), passUrl: `${QR_BASE_URL}/app/me` })

## From EMAILS builder — home.js diffs
1. load() settle: add `nl: api.get('/api/v2/newsletter/preferences'),` after topics; return `nl: r.nl || null,`.
2. render(): st init -> derive nlLabels from D.nl.subscribed/topics (all -> ALL_TOPIC; else map via TOPIC_KEY reverse), st = { expanded:false, nlTopics: nlLabels || (followedLabels.length ? followedLabels : [ALL_TOPIC]), nlDone: !!nlLabels, nlCount: nlLabels ? nlLabels.length : 0 }.
3. nlSub handler -> POST /api/v2/newsletter/subscribe { topics[, email: typed] }; toast pending_confirmation ? confirm-inbox copy : done(count). (Newsletter now separate from follows.)

## From EMAILS builder — misc
- Profile screen (optional add later): Newsletter prefs row via GET/PUT /api/v2/newsletter/preferences; manage_url links the preference center.
- GO-LIVE env: V2_CARDS_EMAIL_SINCE (suppress card backfill on first prod boot — otherwise it emails the whole eligible list), EMAIL_LOGO_URL (white wordmark).
- Open: verification-link copy says 48h, expiry is 24h (server.js:11330) — Alen decides; site FAQ newsletter retarget = website content task.

## From CURATOR (done)
- Staging content now canonical (Novinarski dom cap 100, abstracts gone, hosts fixed, Boston de-Harvarded, news/announcements real, diacritics fixed). Log: deploy/staging/CONTENT-CURATION-2026-08-28.md (incl. restore SQL for 2 deleted rows).
- BRANCH FIX at integration: admin server.js:3232 startup "migration" rewrites ALL forum_events rows with no WHERE at every boot (canonical values revert; also re-adds Laura's placeholder photo) — wrap in an app_state one-time guard. ⚠ Same behavior exists in PROD main = report to Alen as a prod bug.
- STAGING DB task at integration: team admin accounts have allowed_sections=[] (403 everywhere; only founder works) — grant full sections to the team so reviewers can drive the admin portal.

## FROM ALEN (2026-08-30) — portal build queue
- ⚠ GUEST-AWARE QR SCANNING: 9 of 28 paid gala registrations carry guest_count>0. The door scanner must treat one QR as a PARTY (admit N people: "2 of 3 checked in"), never "already scanned" after the first guest. Touch: admin check-in routes (resolveRegFromCode/passAccess), check-in UI counter, member wallet copy ("this QR admits you + N guests"). Build on the branch with the admin redesign.

## FIRA invoices — findings 2026-08-30 + build queue
- Every CA-gala payment creates a FIRA fiscal invoice in the Stripe webhook (logs: 59/1/1 Aug 25 … 63/1/1 Aug 30 13:50, all "created (no VAT)", zero failures in the visible window). The portal itself never emails the invoice PDF (pdfUrl comes back null) and does NOT persist the FIRA id/number on gala/CA rows (only one legacy payment_transactions row carries fira_invoice_number 39/1/1).
- Whether customers RECEIVED invoices depends solely on FIRA's own "email invoice to customer" behaviour (order carries billing.email) — verifiable only in the FIRA dashboard (no read API with our key; GET order needs the numeric FIRA id we never stored).
- BUILD: (1) webhook stores firaId + invoiceNumber (+ pdfUrl when present) on gala_registrations / croatians_abroad_registrations / payment_transactions.metadata; (2) ticket email shows "Fiscal invoice (FIRA) 63/1/1" + link when FIRA returns a PDF URL; (3) wallet receipts reference it (already coded to read fira_invoice_number); (4) nightly sentinel: count paid registrations without a FIRA number ⇒ alert. FIRA rule stays: invoices ONLY from FIRA.

## From ADMIN GALA builder (done, committed)
- No shared diffs. Found pre-existing member bug: GET /api/public/registrations/:email gala branch ORDER BY nonexistent registered_at (user server.js:29311) → silently returns [] — fix in the next server pass (also on PROD main).
- Seed: gala_tables empty (view seeds T1–T10×8 via existing route once); event_components has two active gala rows.

## From ADMIN REGS+LINKS builder (done, committed)
- No shared diffs. PARTIALs by design: SPONSOR table-booking (no backend) → explanatory toast; per-link visit counts don't exist (uses only).
- Seed: all 35 registration_links rows have token=NULL → seeded rows produce /plexus/null dead links (new links fine) — worth a data fix; conferences.max_capacity 200 vs canonical 100 (data task).

## From ADMIN FORUM+BRIDGES builder (done, committed)
- No shared diffs. Fix-pass items (member server, also PROD): POST /api/bridges/events/:id/register 500s (NOT NULL defect); plus earlier: /api/public/registrations/:email gala ORDER BY registered_at.
- v2_stats_overrides claimed by this builder (hub-scoped, reusable).
