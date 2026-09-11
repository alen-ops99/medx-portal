# Plexus Week · Editions + Meetups — build spec (Alen 2026-09-11)

Owner decisions (verbatim intent):
- "Plexus Week" is the umbrella: Conference · Gala Evening · Building Bridges **Zagreb** · **Meetups**. Boston stays separate under Building Bridges.
- Editions: "in general Plexus Week and then we can choose 2026 and once it passes we archive it and then automatically we get 27."
- Hosts: **anyone the admin assigns** (speaker, professor, participant) — host "a coffee or lunch or something networking with students or residents or whoever".
- Capacity: **per meetup, set by admin** when creating (3 … 15 typical, 5–10 usual). **Waitlist per meetup.**
- Cancellation: attendee can cancel **in the portal or via a link in the email** ("hey, you can cancel here"). On cancel the **first waitlisted person is promoted automatically** and gets an email ("you moved from the waitlist — you're coming").
- Participants are invited to join the member portal (account = easy cancel/manage), but the flow must also work from email alone.
- Wallet: attendees get **Apple + Google Wallet passes** with QR, exactly like other events.
- Check-in: infrastructure must exist (host may scan a QR and see "oh, you're Alen, sleep researcher at Harvard"; admins can check people in via the existing Event Day scanner), but it is **optional** in practice.
- Hosts see **only their own meetup(s)**: attendee list with profiles (name, institution, position/field, short bio), headcount, waitlist count, message-my-attendees.
- "As automatic as possible."

## 1. Editions (both backends, one shared table)

```sql
CREATE TABLE IF NOT EXISTS plexus_editions (
  id TEXT PRIMARY KEY,            -- 'plexus-2026'
  year INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL,            -- 'Plexus Week 2026'
  city TEXT DEFAULT 'Zagreb',
  starts_on TEXT, ends_on TEXT,   -- ISO dates
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming','active','archived')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, archived_at TEXT
);
```
- Seed `plexus-2026` (active, 2026-12-03 … 2026-12-06) if absent.
- **Auto-rollover** (boot + daily timer, both backends idempotent): when `ends_on + 1 day` < today and status='active' → set archived, and create next year's edition as `active` with `label='Plexus Week <year+1>'`, dates = same month/days +1 year (admin edits later).
- Admin API: `GET /api/v2/plexus-hub/editions`, `POST …/editions` (create), `PATCH …/editions/:id` (label/dates/status; status='archived' allowed manually), `POST …/editions/:id/activate`.
- Everything edition-scoped carries `edition_id`; existing tables (croatians_abroad_registrations, gala_registrations) are NOT migrated — treat rows with NULL edition as the active edition of their created_at year (helper `editionForDate`).
- Admin UI: the Plexus page title becomes "Plexus Week" with an **edition switcher** (chip: 2026 ▾ → lists editions; archived ones open read-only). Route `/projects/plexus/:tab?` keeps working; add `?edition=<id>`.
- Member UI: rename nav "Plexus Conference" → **"Plexus Week"**; `/app/plexus` overview shows the four blocks of the active edition (Conference · Gala Evening · Building Bridges Zagreb · Meetups) each with status/date/venue/CTA. Past editions: "Past editions" link → read-only summary (what I attended, certificates).
- Fix the stale member copy `EUR 150 through 1 Sep` → read the real early-bird date from `gala_settings` (currently 15 Sep).

## 2. Meetups — data

```sql
CREATE TABLE IF NOT EXISTS plexus_meetups (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'coffee',      -- coffee|lunch|dinner|walk|visit|other
  description TEXT, audience TEXT,                                -- free text: 'Students & residents in neuroscience'
  tags TEXT,                                                      -- JSON array of field tags
  venue_name TEXT, venue_address TEXT, venue_map_url TEXT,
  starts_at TEXT NOT NULL, ends_at TEXT,                          -- ISO, Europe/Zagreb
  capacity INTEGER NOT NULL DEFAULT 8, waitlist_enabled INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open','invite')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled','completed')),
  host_user_id TEXT, host_name TEXT, host_title TEXT, host_email TEXT,   -- host may not be a member yet
  host_token TEXT UNIQUE,                                          -- HMAC page token for host view without login
  created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS plexus_meetup_attendees (
  id TEXT PRIMARY KEY, meetup_id TEXT NOT NULL,
  user_id TEXT, first_name TEXT, last_name TEXT, email TEXT NOT NULL,
  institution TEXT, position TEXT, bio TEXT,                      -- snapshot for host view; refreshed from profile when user_id
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','waitlisted','cancelled','promoted','invited','declined')),
  waitlist_pos INTEGER, source TEXT,                              -- portal|email-invite|admin
  checked_in INTEGER DEFAULT 0, checked_in_at TEXT,
  manage_token TEXT UNIQUE,                                       -- HMAC for cancel-by-email / accept-invite
  invited_at TEXT, confirmed_at TEXT, cancelled_at TEXT, promoted_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (meetup_id, email)
);
CREATE TABLE IF NOT EXISTS plexus_meetup_audit (id TEXT PRIMARY KEY, meetup_id TEXT, attendee_id TEXT, action TEXT, detail TEXT, actor TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
```

## 3. Meetups — behaviour (member backend `v2/meetups.js`, admin backend `v2/meetups-ops.js`)

**Join (member, logged in)** `POST /api/v2/meetups/:id/join` → if confirmed < capacity → `confirmed` (+ confirmation email w/ QR + Apple/Google wallet + calendar + **Cancel link**) else if waitlist_enabled → `waitlisted` with `waitlist_pos` (+ "you're on the waitlist, position N" email w/ cancel link). Idempotent; a cancelled row can re-join (goes to the back).

**Cancel** — portal `POST /api/v2/meetups/:id/cancel` (auth) **and** public `GET /meetups/manage/:manage_token` → branded page with "Cancel my place" button → `POST` same path. On cancel: status→cancelled, then **promote**: lowest `waitlist_pos` waitlisted → `promoted`→`confirmed` (single status `confirmed`, `promoted_at` set), renumber the rest, email the promoted person "You're in — a place opened up" (with ticket assets + cancel link), email the host a one-line FYI only if `host_email`. Runs in one DB transaction; never over-fills.

**Invite-only** — admin picks people (members or raw emails) → rows `invited` with `manage_token` → email "Would you like to join <host> for <coffee>…" with **Accept** / **Can't make it** buttons (public GET routes on the manage token). Accept → join logic (may waitlist). Decline → `declined`.

**Reminder** — 24 h before `starts_at`: email confirmed attendees (venue, map, host, cancel link). Idempotent via audit action `reminder-sent`.

**Wallet + QR** — reuse `shared/wallet.js` (class per meetup: `plexus-meetup-<id>`), `v2/apple-pass.js` eventTicket with strip = house default, WHERE = venue_name. QR payload = attendee id (`m-<attendee id>`), served at `/api/v2/meetups/qr/:attendeeId.png` using the Boston branded-QR helper (Med&X plate only).

**Check-in** — Event Day scanner: add door kind `meetup` with a meetup picker; scanning `m-<id>` → checks in, response shows name, institution, position, bio snippet (the "oh, you're a sleep researcher at Harvard" moment). Host page gets the same scanner (camera) gated by host_token. Admin can check in / undo from the attendee list.

**Host view** — `GET /meetups/host/:host_token` (public token page, no login) AND `/app/plexus/meetups/:id/host` for logged-in host (user_id match): title/time/venue, headcount `confirmed/capacity`, waitlist count, attendee cards (name, institution, position, bio), "Message attendees" (posts through existing inbox/outbox as a **draft for team approval**, per house rule — no direct blasts), scanner button. **Strictly scoped**: a host token/user can never list other meetups.

**Member view** — `/app/plexus/meetups`: cards for published meetups of the active edition (kind icon, host, time, venue, spots left / waitlist), filters by tag/day, Join / Leave, "My meetups" section with passes + cancel. Invite-only meetups appear only to invited users.

**Admin view** — `/projects/plexus/meetups` tab: table (title, host, time, venue, confirmed/capacity, waitlist, status), create/edit drawer (all fields; host picker = member search or free name+email; capacity stepper; visibility), publish/cancel (cancel emails all attendees), attendee drawer (statuses, manual add, promote, check-in, remove, export CSV), invite drawer (pick members / paste emails, preview email, send = creates `invited` rows and mails), copy host link. Stats strip: meetups, seats, fill %, waitlisted.

**Emails** (house dark shell, `tone:'dark'`, registrant voice, warm, never "Building Bridges evening" phrasing rules, "all three events" not "evenings"): joined-confirmed, waitlisted, promoted, invited, cancelled-by-you, meetup-cancelled-by-organizer, reminder, host-fyi. Every attendee email carries the cancel/manage link. **Non-members** get a one-line "create your Med&X account to manage everything in one place" nudge with the signup link.

**Review gate** — meetup joins by logged-in members skip the gate (already vetted at signup); email-invite accepts skip it (we invited them). Any future public meetup form goes through review-gate.js per standing rule.

## 4. Non-negotiables
- Additive only: new tables, new routes; touch existing tables only via UPDATE on check-in columns you add yourself. No renames of stored permission ids; new admin section id `plexus-meetups` under group Projects (perms.js) — default granted to admins.
- All HMAC tokens via JWT_SECRET (`medxmeet:host:<id>`, `medxmeet:manage:<id>`), 32-hex, timingSafeEqual.
- Every send goes through the backend `sendEmail`; nothing automatic to real people during build — use EMAIL_DUMP / mock in tests.
- Tests: `tests/meetups.test.js` — capacity boundary, waitlist ordering, cancel→promote atomicity (two cancels in a row promote two distinct people), re-join after cancel, invite accept/decline, host scoping (host A cannot read meetup B: 404), manage-token forgery → 404, edition rollover (fake clock), reminder idempotency. Run existing suites; zero regressions.
- Boot-test both backends before pushing (TDZ lesson). Branch: `redesign/member-portal`. Do not touch `main`.
