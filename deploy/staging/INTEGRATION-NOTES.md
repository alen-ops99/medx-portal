# Integration notes (I apply these after all builders finish)

## From FORUM builder (done, committed)
- auth.js handleCode: replace `/api/forum/invitations/redeem` call —
  signed-in → `api.post('/api/v2/forum/redeem-code',{code})` → toast r.message → `router.replace('/app/forum')`;
  guest → `api.post('/api/v2/forum/check-code',{code},{noAuth:true})` → `sessionStorage.setItem('medx_forum_code',code)` → `/app/auth/signup?next=%2Fapp%2Fforum` (forum view auto-redeems).
  Errors: `e.data?.code==='unknown'` → invalid-code copy; bare 404 → offline copy; else e.message. Optional: prefill from ?code=.
- Backend bug found: `/api/my/events` forum branch selects nonexistent columns → forum registrations never reach wallet/stats (server.js fix at integration).
- Seed content: no future forum_events besides the seeded forum-2027-gathering; forum_news future-dated (Sep 1 / Oct 15); only 2 forum_members.
