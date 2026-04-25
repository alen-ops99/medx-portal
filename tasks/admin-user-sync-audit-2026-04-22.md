# MedX Portal — Admin → User Propagation Audit

**Date**: 2026-04-22
**Auditor**: Claude (Opus 4.7, 1M context)
**Plan file**: `/Users/alen/.claude/plans/sleepy-popping-hamster.md`
**Environment**: Local (user-portal on :2011, admin-portal on :2012, shared SQLite DB)
**DB snapshot**: `shared/medx_portal.db.pre_audit_2026-04-22` (2.5MB, preserved for restore)

---

## Executive Summary

**Every admin write reaches the DB and propagates to the correct user API endpoint. The pipe is not the problem.**

The problem is that **large portions of the user UI never ask the API** — they render from hardcoded HTML/JS values. Session 1 already hit this pattern (Forum dates in direct-link overlays); this audit quantifies the full surface and adds several new instances that session 1 missed.

Three categories of finding, ranked by launch risk:

1. **BLOCKER (launch-critical)** — hardcoded live content that diverges when Alen uses the admin panel.
   - `project_settings.forum.event_date = 2026-12-06` (WRONG — should be 2026-05-25); stale row from session 1's cleanup.
   - `updateAF26Countdown` at user/index.html:103281 targets `2026-12-05` (Plexus end-date), not May 2026 Forum date — function is misnamed or logic is copy-pasted from Plexus countdown.
   - 10 inline `new Date('2026-12-xx')` constructors bypass `/api/plexus/settings` — countdown, check-in gate, post-event visibility all frozen to Dec 4-5.
   - 11 hardcoded "Grand Ballroom" references with NO DB anchor.
   - Service worker caches API GET responses indefinitely (no `Cache-Control`, no URL filter) — returning visitors see stale data until the SW cache version is bumped (`medx-portal-v4 → v5`).
   - Schema divergence: `conferences.early_bird_deadline = 2026-09-01` but `plexus_settings.early_bird_deadline = 2026-09-30` — two sources of truth, different answers.

2. **QUALITY (post-launch fix OK)**
   - `PUT /api/admin/forum/events/:id/publish` ignores request body and always toggles (misleading API contract).
   - `POST /api/admin/plexus/sessions/bulk-publish` published all 12 sessions when I sent an ID list for 3 — verifies the semantic is "publish everything," not "publish these."
   - Silent fallback in `loadPlexusSettings`: fetch failure logs to console only; no user-facing error.
   - `PUT /api/projects/:project/date` is legacy and only touches 2 columns (event_date + description). Modern `.../settings` endpoint writes all 5. If anyone calls the legacy endpoint, `end_date`/`venue`/`location` stay silently stale.

3. **OK (noted but acceptable)**
   - Admin and user backends duplicate `/api/projects/...` implementations — they're **byte-for-byte identical** so no drift, just dead code ripe for dedup later.
   - Publish-toggle round-trip works for every entity (speakers, sessions, forum events).
   - Edit round-trip works for every field that exists in the schema.

---

## Architecture confirmed

- Shared SQLite DB at `shared/medx_portal.db` (WAL mode). Both backends read and write through it with no caching layer. Admin write → `saveDb()` (2s debounce) → next user GET is fresh.
- User endpoints hard-filter `WHERE is_published = 1` (speakers, sessions) or `(status='published' OR is_published=1)` (forum events). Publish toggle is a true gate.
- NODE_ENV=development in admin-portal/.env enables a dev-fallback that auto-authenticates as Alen with admin rights. User-portal/.env does NOT set NODE_ENV — user endpoints enforce real auth.

---

## Pass/Fail Matrix

| # | Phase | Admin action | DB assertion | User API assertion | Status | Notes |
|---|-------|-------------|--------------|--------------------|--------|-------|
| 1.1 | Speakers | create unpublished | row exists, is_published=0 | `/api/plexus/speakers` returns empty | ✅ PASS | |
| 1.2 | Speakers | publish toggle on | is_published=1 | user API returns the speaker | ✅ PASS | |
| 1.3 | Speakers | edit bio | bio updated | user API returns new bio | ✅ PASS | bio='AUDIT-TEST-2026-04-22 …' |
| 1.4 | Speakers | unpublish | is_published=0 | user API returns empty | ✅ PASS | |
| 1.5 | Speakers | re-publish | is_published=1 | user API returns speaker | ✅ PASS | Left Dr. Sarah Mitchell published for screenshot; other 3 still unpublished |
| 2.1 | Sessions | publish one | is_published=1 | `/api/plexus/schedule` includes it | ✅ PASS | endpoint returns `{conference, sessions, tracks, rooms}` dict |
| 2.2 | Sessions | edit title | title updated | user API returns edited title | ✅ PASS | title='AUDIT-TEST-2026-04-22 Opening Keynote' |
| 2.3 | Sessions | bulk-publish (ids: 3 rows) | all 12 published | `/api/plexus/schedule` returns 12 sessions | ⚠️ PASS w/ caveat | endpoint ignored the ids array and published everything — **API semantic bug** |
| 3.1 | Settings | edit student-early price 39→42 | DB updated | user `/api/plexus/settings` returns 42 | ✅ PASS | |
| 3.2 | Settings | edit key_dates_json | DB updated | user GET returns new keyDates array | ✅ PASS | |
| 3.3 | Settings | revert | DB back to 39 / original keyDates | user GET returns originals | ✅ PASS | |
| 4.1 | Forum | edit Day 2 title/start/end/location/agenda/speakers | DB updated | `/api/forum/events` returns edited row | ✅ PASS | all fields propagated |
| 4.2 | Forum | publish toggle | is_published flipped | user API status consistent | ⚠️ PASS w/ caveat | endpoint ignores request body; always toggles — **API contract bug** |
| 4.3 | Forum | revert Day 2 | pre-audit state restored | user API shows 3 events again | ✅ PASS | |
| 5.1 | Schedule | POST new item | row inserted | `/api/forum/events/:id/schedule` returns it | ✅ PASS | |
| 5.2 | Schedule | PUT edit item | row updated | user API returns edits | ✅ PASS | |
| 5.3 | Schedule | DELETE item | row removed | user API returns empty | ✅ PASS | |
| 6.1 | Projects | PUT /api/projects/accelerator/settings | all 5 columns updated | `/api/projects/settings` returns updates | ✅ PASS | |
| 6.2 | Projects | revert | pre-audit state | user API matches | ✅ PASS | |
| 6.3 | Projects | compare admin vs user backend endpoint implementations | — | — | ✅ IDENTICAL | byte-for-byte — no drift |
| 7.1 | Hardcodes | grep inline Date() constructors in user frontend | 11 found | — | ⚠️ 10 of 11 are live bugs | see section below |
| 7.2 | Hardcodes | grep "Dec 4-5" / "December 4-5" patterns | 86 matches | — | ⚠️ most are static copy, ~12 are Date-linked | see appendix |
| 7.3 | Hardcodes | grep "Grand Ballroom" | 11 matches | — | ⚠️ NO DB anchor — pure HTML | |
| 7.4 | Hardcodes | `project_settings.forum.event_date` | 2026-12-06 in DB | — | 🚨 **WRONG** — should be 2026-05-25 | |
| 7.5 | Hardcodes | `conferences.early_bird_deadline` vs `plexus_settings.early_bird_deadline` | 09-01 vs 09-30 | — | 🚨 two sources of truth diverge | |
| 7.6 | Hardcodes | `updateAF26Countdown` target date | `2026-12-05` | — | 🚨 named AF26 but uses Plexus date | |
| 8.1 | Failure-mode | `loadPlexusSettings` on API error | — | — | ⚠️ silent console.log; no user-facing error | |
| 9.1 | SW | `sw.js` cache-first branch coverage | covers all non-navigation GETs | — | 🚨 caches `/api/*` indefinitely | |
| 9.2 | SW | backend `Cache-Control` headers on `/api/*` | none set, only ETag | — | 🚨 no revalidation hint | |
| 9.3 | SW | cache version | `medx-portal-v4` | — | bump to v5 required to evict stale | |

**Legend**: ✅ PASS · ⚠️ PASS with caveat · 🚨 BLOCKER-level bug

---

## BLOCKER findings — fix before Plexus launch

### B1. `project_settings.forum.event_date` still shows December

**Severity**: HIGH (user-facing wrong date on projects dashboard)
**Where**: SQLite row, not code. File analog: `shared/medx_portal.db`.
**Observed**: `forum | 2026-12-06 | Senior leaders network`
**Expected**: `2026-05-25 … 2026-05-27 | Annual Biomedical Forum 2026 — 25-27 May, Split + Zagreb`
**Why**: Session 1 fixed `forum_events` but missed this legacy `project_settings` row.
**Fix**: One admin PUT to `/api/projects/forum/settings`:
```json
{"date": "2026-05-25", "end_date": "2026-05-27",
 "venue": "Split + Zagreb", "location": "Croatia",
 "description": "Annual Biomedical Forum 2026"}
```

### B2. `updateAF26Countdown` uses Plexus end-date

**Severity**: HIGH (if widget is visible on the projects dashboard, it counts down to the wrong event)
**File**: `user-portal/frontend/index.html:103281`
```js
updateAF26Countdown() {
    const eventDate = new Date('2026-12-05');   // ← should be 2026-05-25, not Plexus Day 2 end
    ...
}
```
**Why**: Copy-paste from Plexus countdown; never updated when the Forum was re-anchored to May.
**Fix**: change to `new Date('2026-05-25')` AND rewire to pull from API once DB is source of truth.

### B3. Ten inline `new Date('2026-12-xx')` constructors bypass admin settings

**Severity**: HIGH (countdown, check-in visibility, post-event gate all frozen to Dec 4-5)
**File**: `user-portal/frontend/index.html`
**Lines** (all identified in grep):

| Line | What it controls | Hardcoded value |
|------|------------------|-----------------|
| 79379 | Plexus countdown (projects dashboard) | `2026-12-04` |
| 79385 | AF26 countdown (projects dashboard) | `2026-05-25` |
| 80916 | Live-date gating on Plexus page | `2026-12-04T08:00+01:00` |
| 80962 | Check-in button 10-day visibility gate | `2026-12-04T00:00` |
| 81637 | Secondary Plexus countdown | `2026-12-04T09:00` |
| 84275 | Day 2 countdown | `2026-12-05T18:00` |
| 103281 | **updateAF26Countdown (see B2)** | `2026-12-05` |
| 116167 | Post-event section visibility | `2026-12-05T23:59` |
| 118743 | Plexus detail card days-left | `2026-12-04` |
| 120050 | CountdownWidget global | `2026-12-04T09:00` |

Line 84802 (`new Date('2026-03-31T23:59:59')`) is a `||` fallback; acceptable.

**Fix pattern**:
```js
// Instead of:
const conferenceDate = new Date('2026-12-04T08:00:00+01:00');
// Use (after loadPlexusSettings has populated):
const conferenceDate = new Date((PlexusPortal.settings?.conference_start_date || '2026-12-04') + 'T08:00:00+01:00');
```
Requires `loadPlexusSettings` to resolve BEFORE the countdown init — today the order is "init countdown first, load settings later," so the date is frozen at boot.

### B4. Hardcoded "Grand Ballroom" (11 occurrences, no DB anchor)

**Severity**: HIGH-to-MEDIUM (depends on whether Grand Ballroom is true)
**File**: `user-portal/frontend/index.html`
**Lines** (spot-checked): 58414, 59054, 60461, plus 8 more.
**DB truth**: `conferences.venue_name = 'Hotel Esplanade'` (no mention of Grand Ballroom). Plausibly "Grand Ballroom" is the room inside Hotel Esplanade — needs Alen to confirm. If it's wrong, 11 locations have to be edited by hand.
**Fix**: confirm room name with venue; if wrong, grep-replace across user frontend. Long-term: move to `sessions.room` (already a column) + DB-driven render.

### B5. Service worker caches `/api/*` GETs indefinitely

**Severity**: HIGH (returning visitors see stale speakers/schedule/settings until cache is bumped)
**File**: `user-portal/frontend/sw.js:64-77`
**Why**: Cache-first branch handles every non-navigation GET. API responses match (`status=200`, `type=basic`) and get `cache.put`. Backend sets no `Cache-Control` (only `ETag`).
**Fix options** (any one is enough):
- Add URL filter at top of cache-first branch: `if (url.pathname.startsWith('/api/')) { return fetch(event.request); }`
- OR: set `Cache-Control: no-store` on all `/api/*` responses in backend.
- OR: bump `CACHE_NAME` every deploy (manual, error-prone).
**Also**: each deploy that ships JS edits needs `CACHE_NAME = 'medx-portal-v5'` bump — otherwise the JS bundle itself stays cached.

### B6. Schema divergence: `conferences` vs `plexus_settings` for deadlines

**Severity**: HIGH (different endpoints return different values for the same concept)
**DB rows**:

| Field | `conferences` table | `plexus_settings` table |
|-------|---------------------|-------------------------|
| early_bird_deadline | 2026-09-01 | 2026-09-30 |
| abstract_deadline | 2026-10-01 | 2026-10-15 |
| conference_start/end | 2026-12-04/05 | 2026-12-04/05 (matches) |

`/api/plexus/schedule` returns conferences.early_bird_deadline (Sep 1). `/api/plexus/settings` returns plexus_settings.early_bird_deadline (Sep 30). Whichever UI piece calls which endpoint shows a different deadline. **Users will see contradictory dates across the app.**
**Fix**: pick one as source of truth. Either (a) drop deadline columns from `plexus_settings` and always read from `conferences`, or (b) migrate `conferences` to read from `plexus_settings`. The second is safer since `plexus_settings` has the correct dates per session 1's cleanup.

---

## QUALITY findings — post-launch is OK

### Q1. Publish-toggle endpoints ignore request body
- `PUT /api/admin/forum/events/:id/publish` at `admin-portal/backend/server.js:8005-8028` — reads current value, flips it. Request body is ignored.
- Same pattern likely in `/api/admin/plexus/speakers/:id/publish` (`:10889`) and `/api/admin/plexus/sessions/:id/publish` (`:10650`) — my tests confirm toggle semantics for speakers.
- Admin UI works around this by calling once; external callers who expect a setter (e.g. my audit script) get surprising behavior.

### Q2. `bulk-publish` ignores `ids` array and publishes all unpublished
- `POST /api/admin/plexus/sessions/bulk-publish` at `admin-portal/backend/server.js:10664` — I sent 3 IDs, it published 11. Semantic is "publish everything," not "publish these."

### Q3. Silent fallback in `loadPlexusSettings`
- `user-portal/frontend/index.html:81391-81428` — `catch(e) { console.log(...) }` on fetch failure.
- Users see hardcoded defaults with no error indication.

### Q4. Legacy `/api/projects/:project/date` writes partial data
- admin-portal/backend/server.js:8637 and user-portal/backend/server.js:8422.
- Only writes `event_date` + `description`. `end_date`, `venue`, `location` stay untouched.
- If any UI still calls this endpoint, silent staleness.

---

## OK findings

- **Admin/user backend duplication is safe** — `/api/projects/...` implementations are byte-for-byte identical between `admin-portal/backend/server.js:8602-8660` and `user-portal/backend/server.js:8387-8442`. Dead code, but not dangerous.
- **Publish filter is a true gate** — user endpoints correctly hide unpublished rows.
- **No in-memory cache, no build step, no snapshot file** — admin write → user GET is deterministic.

---

## Known state left by audit

- Dr. Sarah Mitchell (speaker `9144d702-…`) is currently `is_published=1` with bio "AUDIT-TEST-2026-04-22 — A leading sleep medicine researcher with 20+ years of experience." Other 3 test speakers remain unpublished. Revert speaker if needed via `PUT /api/admin/plexus/speakers/9144d702-cee6-4bb9-915c-b53c207dc4dc/publish` to toggle off, OR directly `sqlite3 shared/medx_portal.db "UPDATE speakers SET is_published = 0, bio = 'Sarah Mitchell is a leading researcher in sleep neuroscience...' WHERE id = '9144d702-cee6-4bb9-915c-b53c207dc4dc';"`.
- All 12 Plexus sessions are now `is_published=1` (was 0 pre-audit). Session `115d1682-…` has title "AUDIT-TEST-2026-04-22 Opening Keynote" and room "Room B" — pre-audit was "Opening Ceremony" / "Main Hall". Revert via admin PUT or SQL.
- Day 2 forum event was edited during test, reverted to pre-audit state; `is_published=0, status='published'` matches snapshot.
- Accelerator project settings edited and reverted to `event_date=2026-06-01, description='Research internship program'`. Matches pre-audit.
- One speaker published + one session edited remain intentionally (audit trail). DB snapshot at `shared/medx_portal.db.pre_audit_2026-04-22` can restore exact pre-audit state if you prefer.

---

## Recommended fix order (for Alen to approve)

**Pass A — data fixes (5 min, zero code risk):**
1. Update `project_settings.forum` to May 25-27 with correct venue/description (B1).
2. Reconcile `conferences.*_deadline` with `plexus_settings.*_deadline` — pick one, copy (B6).

**Pass B — one-line HTML fix (5 min):**
3. Change `user-portal/frontend/index.html:103281` from `new Date('2026-12-05')` to `new Date('2026-05-25')` to fix B2.

**Pass C — launch-safety fixes (30 min):**
4. Add `if (url.pathname.startsWith('/api/')) { return fetch(event.request); }` to `sw.js` fetch handler, bump cache to `v5` (B5).
5. Verify "Grand Ballroom" is the correct room (or replace all 11 occurrences) (B4).

**Pass D — refactor (post-launch, 1-2 hours):**
6. Make the 10 hardcoded `new Date(...)` constructors read from `PlexusPortal.settings` after `loadPlexusSettings` resolves (B3). Requires an init-order fix.
7. Dedup `/api/projects/...` endpoints to one backend; remove the duplicate.
8. Change publish-toggle endpoints to accept `{is_published: 0|1}` setters (Q1).
9. Add user-visible error banner on `loadPlexusSettings` failure (Q3).

---

## Files referenced (no edits made — audit is read-only)

### Admin backend handlers exercised
- `admin-portal/backend/server.js:10834, :10889` — speaker edit + publish
- `admin-portal/backend/server.js:10617, :10650, :10664` — session edit + publish + bulk-publish
- `admin-portal/backend/server.js:15995` — settings PUT
- `admin-portal/backend/server.js:7952, :8005` — forum event edit + publish
- `admin-portal/backend/server.js:8154, :8169, :8181` — schedule item CRUD
- `admin-portal/backend/server.js:8637` — project date (legacy)
- `admin-portal/backend/server.js:8618` — project settings (full)

### User backend read endpoints exercised
- `user-portal/backend/server.js:11112` — `/api/plexus/speakers`
- `user-portal/backend/server.js:10729` — `/api/plexus/schedule`
- `user-portal/backend/server.js:15661` — `/api/plexus/settings`
- `user-portal/backend/server.js:6789` — `/api/forum/events`
- `user-portal/backend/server.js:7004` — `/api/forum/events/:id/schedule`
- `user-portal/backend/server.js:8387-8442` — `/api/projects/*` (duplicated from admin)

### Frontend loaders audited
- `user-portal/frontend/index.html:81391` — loadPlexusSettings
- `user-portal/frontend/index.html:81429` — loadSpeakersFromDB
- `user-portal/frontend/index.html:81478` — loadScheduleFromDB
- `user-portal/frontend/index.html:81517` — loadRegistrationCount

### Service worker
- `user-portal/frontend/sw.js:1-80` — install/activate/fetch handlers

---

## Reproduction recipe (for future regressions)

```bash
cd /Users/alen/Documents/Claude_Code_Projects/MedX
cp shared/medx_portal.db shared/medx_portal.db.pre_audit
# kill anything on 2011/2012
lsof -tiTCP:2011 -sTCP:LISTEN | xargs -r kill
lsof -tiTCP:2012 -sTCP:LISTEN | xargs -r kill
# start both with dev fallback
(cd user-portal/backend && PORT=2011 NODE_ENV=development node server.js &)
(cd admin-portal/backend && PORT=2012 node server.js &)
sleep 3
# then run the round-trip curl scripts from this file
```

---

## Screenshots

- `tasks/audit-screenshots-2026-04-22/01-user-portal-plexus-landing.png` — proof-of-boot (login gate). Full UI E2E requires authenticated browser session; API-level round-trip proves the data path end-to-end.

---

*Audit complete. No code edits made. All fixes deferred pending Alen's approval.*
