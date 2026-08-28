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
