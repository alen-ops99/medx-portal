# Plexus Week Live — event app brief (Alen, 2026-09-22)

Owner's words: "for each of our events a beautiful event app … they choose the event (sync date/time to guess it) … see the
program for the conference, Building Bridges, the gala … attend / not attend, personal schedule … we know how many people chose
what … type of talk, speaker, location … speakers see 'I speak here, lunch here, networking break here' … admin adjusts times,
dates, locations because that stuff changes a lot." Decisions: **program content = TBD placeholders for now** (Alen will fill it in
the editor); **attending is ONE tap** (tap = attending = in my schedule = counted).

## Who opens it and how (no login required)
- Every Zagreb registrant already holds a ticket link (`/plexus/ticket/:sig/:id`, `/gala/ticket/:sig/:id`) and Boston guests a
  personal page (`/boston/me/:token`). Those pages get an "OPEN THE EVENT APP" button → `/live/:sig/:id` (same HMAC scheme:
  `HMAC(JWT_SECRET,'live:<kind>:<id>')[:32]`). The app resolves the person (name, events held, party size) from the registration
  row; Boston guests via their me-token. Speakers: `v2_speaker_meta`/`speakers` rows get a speaker token → same app with their
  own slots highlighted. Logged-in members (`/app/live`) resolve via their user → linked registrations. Unknown visitor → read-only
  program, no personal schedule.
- Event guess: on open, pick the event whose date == today and whose time window contains now (else the next upcoming one the
  person holds); a switcher lists the person's events (Conference · Bridges Zagreb · Gala · Donor Night · Boston).

## Data (reuse, extend)
- `sessions` (exists: conference_id, title, description, session_type, day, start_time, end_time, room, track, speaker_ids,
  is_published, capacity …) → add `event_key TEXT` ('conference'|'bridges'|'gala'|'donor'|'boston'|'meetup:<id>'), `event_date`
  (YYYY-MM-DD), `sort_order`, `location_note` (floor / how to find it), `kind` normalised: keynote | talk | panel | presentations |
  break | lunch | networking | reception | ceremony | other, `speaker_names_json` (free-text speakers when not in `speakers`),
  `is_tbd INTEGER` (placeholder rows show "TBD" styling). `bridges_program` (exists, empty) folds into `sessions` with
  event_key='bridges'/'boston' — do not keep two tables.
- Attendance: new `v2_session_attendance (id, session_id, event_key, person_kind 'ca'|'gala'|'bridges'|'user'|'speaker', person_ref,
  person_name, party INTEGER default 1, state 'attending'|'declined', created_at, updated_at)` — UNIQUE(session_id, person_kind,
  person_ref). Head count per session = SUM(party) where attending. (`personal_schedules` is user_id-only — leave it, migrate nothing.)
- Speakers per session: `speaker_ids` (existing `speakers` table) + `speaker_names_json`; the app shows photo (speakers.photo_url /
  v2_speaker_meta) + one-line title.

## Member app `/live` (user-portal frontend-v2, view `live.js`) — phone-first
- Header: event name · date · venue; a NOW / NEXT strip (the session in progress, the next one, with room and minutes-to).
- Tabs: PROGRAM (by day → time blocks; each card: time, kind chip, title, speakers with photos, room, capacity/attending count when
  the admin enables "show counts", one big ATTENDING toggle) · MY SCHEDULE (what I tapped, chronological, conflicts flagged, "add to
  calendar" .ics per session and for the whole day) · SPEAKERS (photo grid, tap → bio + their sessions) · INFO (venue, map link, dress
  code, Wi-Fi, contact — from the existing FACTS/settings) · for speakers an extra YOUR SLOTS panel at the top ("You speak 16:20 ·
  Main Hall · 12 min · slides due …").
- TBD rows render as elegant placeholders ("Session 3 · TBD · 15:00–15:45 · Main Hall") so the structure is visible before content.
- Networking events / receptions / meals are sessions like any other (kind = networking / reception / lunch).
- Live updates: poll `/api/live/:event/program?since=` every 60 s; an admin change appears within a minute; a small "program updated"
  toast. Works offline-ish: last program cached in localStorage.
- Design: the member portal's ink/red/serif language, big type, 44 px targets, no login walls, loads in < 1 s on a phone.

## Admin: PROGRAM EDITOR (admin frontend-v2, under PROJECTS › each event, and one shared view `/program/:event`)
- Event picker (Conference Dec 4 · Bridges Zagreb Dec 5 · Gala Dec 5 · Donor Night Dec 4 · Boston · meetups), day tabs.
- Table/list of sessions: inline edit of time, title, kind, room, speakers (typeahead over `speakers` + free text), capacity, track,
  description; drag to reorder; duplicate; "+ ADD SESSION" and "+ ADD BREAK"; bulk shift ("move everything after 15:00 by +10 min");
  publish/unpublish per session and per event; "TBD" toggle. Every save writes `audit_log`.
- Attendance column: attending count / capacity, red when over capacity; click → the list of names (exportable CSV); event-level
  totals (how many people built a schedule, most-attended sessions).
- Seed: create the TBD skeleton for Plexus Week 2026 from the known facts — Conference Fri 4 Dec 17:00–21:00 (Novinarski dom):
  Welcome · Keynote 1 · Panel · Break · Keynote 2 · Networking; Donor Night Fri 4 Dec (Esplanade, times TBD); Bridges Zagreb Sat 5
  Dec 11:00 (tentative): Welcome · Panel · Presentations · Lunch/Networking; Gala Sat 5 Dec (Esplanade, gala_settings.schedule_json
  already has a run of show: reception · dinner · keynotes · Forum Annual Awards 21:30 · music) — import that as real rows.
- Emails: none automatic. A "send my-schedule digest" button (morning-of) can come in v2.

## Admin insight
- Per event: registered vs opened-the-app vs built-a-schedule; per session head counts; speakers who have not opened their slots.

## Out of scope v1: push notifications, Q&A/polls (tables exist — later), session check-in (Event Day already scans people).
