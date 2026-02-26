# Med&X Portal Overhaul — Master Implementation Plan

**Created:** 2026-02-25
**Status:** ALL PHASES COMPLETE (0-8)
**Architecture:** Two monolithic Node.js/Express SPAs + shared SQLite DB (sql.js)

## Key Files

| File | Lines | Description |
|------|-------|-------------|
| `admin-portal/backend/server.js` | 12,789 | Admin API (405 routes, 77+ tables) |
| `admin-portal/frontend/index.html` | 17,201 | Admin SPA (8 sections, 50+ tabs) |
| `user-portal/backend/server.js` | 11,271 | User API (329+ routes, 111 tables) |
| `user-portal/frontend/index.html` | 113,631 | User SPA (8 sections, 40+ tabs) |
| `shared/medx_portal.db` | 1.7M | Shared SQLite database |

## DB Sync Mechanism

Both portals load `../../shared/medx_portal.db` into memory via sql.js. After writes, `saveDb()` exports to disk. `watchSharedDb()` uses `fs.watch()` with 500ms debounce to detect changes from the other portal and reload. Own writes are ignored via `_lastSaveTime` (2s window).

**Implication:** Any new table or column added to one server.js MUST also be added to the other's CREATE TABLE / ALTER TABLE statements.

---

## Phase 0: Foundation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 0A. Notification System ✅ COMPLETE

- [x] `user_notifications` table exists in both portals
- [x] Admin: POST/GET/DELETE endpoints for notifications
- [x] User: GET notifications, mark read (single + bulk)
- [x] Admin frontend: "User Notifications" sidebar section with send form + history
- [x] User frontend: NotificationSystem polls every 30s, slide-out panel, preferences modal

### 0B. Language Cleanup — All English ✅ COMPLETE

~380+ additional Croatian→English translations made across all 4 files. Remaining Croatian diacritics are only proper nouns (Dr. Ana Kovač, Ban Jelačić Square, etc.).

#### Admin Frontend (`admin-portal/frontend/index.html`)

**Accelerator Section (highest density):**
- [ ] Line ~5059: "Zadaci" → "Tasks"
- [ ] Line ~5076: "Ključni datumi za [year]" → "Key Dates for [year]"
- [ ] Line ~5083: "Timeline pregled" → "Timeline Preview"
- [ ] Line ~5093: "Nova institutiona" → "New Institution" (also a typo — should be "institucija")
- [ ] Line ~5114: "Ime", "Prezime" → "First Name", "Last Name"
- [ ] Line ~5134: "OIB" → "National ID" or "Tax ID" (with tooltip explaining Croatian context)
- [ ] Line ~5138: "Address stanovanja" → "Residential Address"
- [ ] Line ~5160: "Drugo" → "Other"
- [ ] Line ~5266: "Save nacrt" → "Save Draft"
- [ ] Line ~5269: "Send prijavu" → "Submit Application"
- [ ] Lines ~5301-5393: Ranking table headers: "BR" → "#", "PROSJEK" → "GPA", "MOTIVACIJSKO PISMO" → "MOTIVATION LETTER", "PISMO PREPORUKE" → "RECOMMENDATION LETTER", "OSTALI BODOVI" → "OTHER POINTS", "INTERVJU" → "INTERVIEW", "UKUPNO" → "TOTAL"
- [ ] Line ~5305: "Godina" → "Year"
- [ ] Line ~5355: "Ime" → "Name" (Interviewers table)
- [ ] Line ~5378: "PDF postavke" → "PDF Settings"
- [ ] Line ~14883: "PDF postavke spremljene!" → "PDF settings saved!"
- [ ] Line ~14888: "OBAVEZNA DOKUMENTACIJA" → "REQUIRED DOCUMENTATION"
- [ ] Line ~14900: "NEOBAVEZNA DOKUMENTACIJA" → "OPTIONAL DOCUMENTATION"
- [ ] Line ~14988: "Samo PDF datoteke su dozvoljene." → "Only PDF files are allowed."

**Finance Section:**
- [ ] Line ~6279: "Radne jedinice" → "Work Units"
- [ ] Line ~6312: "Ulazni" / "Izlazni" → "Incoming" / "Outgoing"
- [ ] Line ~6344: "Ostali nalozi" → "Payment Orders"
- [ ] Line ~6372: "Putni nalozi" → "Travel Orders"
- [ ] Line ~6482: "OIB" → "Tax ID"

#### Admin Backend (`admin-portal/backend/server.js`)

- [ ] `name_hr` column in `ticket_types` — seed data has Croatian names
- [ ] `evaluation_criteria` — seed data may have Croatian names
- [ ] PDF generation code — "Povjerenstvo", "Predsjednik" strings in PDFKit output
- [ ] Finance seed data — work unit names, category names in Croatian

#### User Frontend (`user-portal/frontend/index.html`)

- [ ] "Nova godina" (New Year) → "New Year"
- [ ] "Zadaci" → "Tasks"
- [ ] "Prijavni obrazac" → "Application Form"
- [ ] "Ključni datumi" → "Key Dates"
- [ ] "Za pregled" → "For Review" / "Pending Review"
- [ ] "Valjanih" → "Valid"
- [ ] "Obavezna dokumentacija" → "Required Documentation"
- [ ] "Dodatna dokumentacija" → "Additional Documentation"
- [ ] "Pročitao/la sam i prihvaćam..." → "I have read and accept..."
- [ ] "Dokumentacija" → "Documentation"
- [ ] "Datum rođenja" → "Date of Birth"
- [ ] "OIB" → "National ID"
- [ ] "Address stanovanja" → "Residential Address"
- [ ] "Fakultet / Institution" → "Faculty / Institution"
- [ ] "Studijski program" → "Study Program" / "Degree Program"
- [ ] "Godina studija" → "Year of Study"
- [ ] "GPA ocjena" → "GPA"
- [ ] "Europass obrazac" → "Europass Form"
- [ ] "Dopunske informacije" → "Additional Information"
- [ ] "Save nacrt" → "Save Draft"

#### User Backend (`user-portal/backend/server.js`)

- [ ] Same seed data issues as admin backend
- [ ] PDF generation strings

**Strategy:** Use grep to find ALL remaining Croatian characters (č, ć, š, ž, đ) and common Croatian words. Do a comprehensive sweep of all 4 files.

### 0C. Med&X Logo Integration ✅ COMPLETE

**Changes made:**
- [x] Copied `medx-logo.png` to `user-portal/frontend/assets/images/medx-logo.png`
- [x] Admin login page: Replaced text `Med<span>&</span>X` with `<img>` logo
- [x] Admin sidebar: Replaced text logo with `<img>` logo (32px height)
- [x] Admin mobile header: Replaced text logo with `<img>` logo (28px height)
- [x] User portal: Replaced ALL 4 Squarespace CDN URLs with local `assets/images/medx-logo.png`
  - Welcome splash logo
  - Hub header logo
  - Footer brand logo
  - Sidebar logo
- [ ] Email templates: Add inline logo (deferred — needs hosted URL for email clients)
- [ ] PDF exports: Add logo to header (deferred — will add during Phase 7 audit)

### 0D. File Storage ✅ DECIDED

- [x] Files stay in `backend/uploads/` (local)
- [x] Upload dirs organized: abstracts/, posters/, documents/, badges/, photos/, tickets/, accelerator/, chat/, speakers/
- No changes needed

---

## Phase 1: Homepage & Dashboard ━━━━━━━━━━━━━━━━━━━━━━━━

### 1A. Fix Timeline Overlapping

**Current implementation:** `renderTimeline()` in admin frontend (line ~9689-9783)
- Uses simple `staggerThreshold = 8` (percent)
- Alternates above/below when events are within 8% of each other
- Breaks with 3+ events in a cluster — third event overwrites first's position

**Fix needed:**

- [ ] **Admin frontend:** Replace collision detection in `renderTimeline()`:
  ```
  Current: Simple pairwise check → above/below toggle
  New: Track occupied bands per lane (above[], below[])
       For each event, check BOTH lanes for collisions
       If both lanes occupied at this position, increase stem height
       Handle 3+ event clusters with graduated stem heights (40px, 60px, 80px)
  ```
- [ ] Test with dense dates (e.g., Plexus Dec 4-5 + Accelerator deadlines + Forum events close together)
- [ ] User frontend: Apply same fix to user-side timeline (if it has one — verify)

**Files to modify:**
- `admin-portal/frontend/index.html` — `renderTimeline()` function (~line 9689)
- `user-portal/frontend/index.html` — Check for equivalent timeline code

### 1B. Editable Project Dates (Synced to User Side)

**Current state:**
- `project_settings` table exists with project-level settings
- Projects have dates but may not be easily editable inline

**Tasks:**
- [ ] Admin frontend: Add inline date picker on dashboard project cards
- [ ] Verify `PUT /api/projects/:project/date` endpoint exists in admin backend — if not, create it
- [ ] Add `venue` and `location` fields to `project_settings` table (ALTER TABLE in BOTH server.js files)
- [ ] User portal reads project dates/venue from `project_settings` via shared DB
- [ ] User frontend: Display updated dates on relevant project pages

**DB Changes (both server.js):**
```sql
ALTER TABLE project_settings ADD COLUMN venue TEXT;
ALTER TABLE project_settings ADD COLUMN location TEXT;
```

### 1C. Remove Finance Overview from Homepage

**Current state:** Dashboard has a "Finance Overview" widget with 4 cards: Balance, Income, Expenses, Net Balance

- [ ] Admin frontend: Remove or hide the Finance Overview card from dashboard HTML
- [ ] Keep the Finance section itself intact (just remove from homepage)
- [ ] Optionally: Replace with a more useful widget or leave the space

### 1D. Improve Portal Pulse UI/UX

**Current state:** Dashboard has a "Portal Pulse" card with refresh button, loads via `App.loadPortalStats()`

- [ ] Admin backend: Enhance `/api/portal/stats` (or equivalent) to return real metrics:
  - Active users (last 7 days) from `users` table
  - Recent signups from shared DB
  - Pending items per section (registrations, applications, approvals)
  - Content freshness (last update timestamps per section)
- [ ] Admin frontend: Redesign stat cards:
  - Tighter layout, reduce empty space
  - Add trend indicators (↑↓ arrows with color)
  - Mini sparkline charts (optional, CSS-only)
- [ ] Add customization: Admin can add/remove/reorder stat widgets
- [ ] Store preferences in `admin_section_preferences` table (already exists or create)

### 1E. Automated Sequence Notifications

**Current state:** Sequences widget exists on dashboard — workflow chains with steps

- [ ] Admin backend: When a sequence step completes → INSERT into `user_notifications`
- [ ] Admin backend: Call `sendEmail()` to notify assigned person
- [ ] Admin frontend: Visual indicator (badge/icon) on sequence steps showing pending notifications
- [ ] Wire up: sequence step completion triggers → notification creation + email

---

## Phase 2: Chat System ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 2A. Sub-Channels

**Current state:**
- `chat_channels` table exists (id, name, project, is_default, created_at)
- Flat channel list per project (e.g., #general, #announcements)
- No hierarchy/sub-channel support

**Tasks:**

- [ ] **DB changes (both server.js):**
  ```sql
  ALTER TABLE chat_channels ADD COLUMN parent_channel_id TEXT;
  ALTER TABLE chat_channels ADD COLUMN description TEXT;
  ALTER TABLE chat_channels ADD COLUMN sort_order INTEGER DEFAULT 0;
  ```

- [ ] **Admin backend:** Update channel CRUD endpoints to support parent_channel_id
  - `POST /api/channels` — accept `parent_channel_id` parameter
  - `GET /api/channels` — return channels with parent info, ordered for hierarchy
  - New: `GET /api/channels/:project/tree` — return channel tree structure

- [ ] **Admin frontend:** Update chat sidebar to show hierarchical channels
  - Project header → top-level channels → sub-channels (indented)
  - "Add sub-channel" button on each top-level channel
  - Expand/collapse toggle for channel groups

- [ ] **User frontend:** Mirror the hierarchical display
  - Read channel tree from API
  - Show sub-channels indented under parent

### 2B. Channel Member Assignment

**Tasks:**

- [ ] **DB changes (both server.js):**
  ```sql
  CREATE TABLE IF NOT EXISTS channel_members (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, member_id)
  );
  ```

- [ ] **Admin backend:**
  - `POST /api/channels/:id/members` — add member(s)
  - `DELETE /api/channels/:id/members/:memberId` — remove member
  - `GET /api/channels/:id/members` — list members
  - `POST /api/channels/:id/members/bulk` — "Add to all project channels"
  - Modify message fetch to filter by membership

- [ ] **Admin frontend:**
  - Channel creation/edit modal: Add member picker (multi-select from team_members)
  - "Add to all channels" bulk action button
  - Member list display in channel info panel

- [ ] **User backend:**
  - Filter `/api/chat/messages` by user's channel membership
  - `GET /api/channels` — only return channels user is a member of

---

## Phase 3: Plexus Conference ━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 3A. Registration Grouping & Filtering

**Current state:** Registrations tab has search + type filter + export (CSV)

- [ ] Admin frontend: Add filter bar with dropdowns:
  - Status (all, confirmed, pending, cancelled)
  - Country (populated from distinct countries in registrations)
  - Institution (populated from distinct institutions)
  - Ticket type (populated from ticket_types table)
  - Payment status (paid, pending, refunded)
- [ ] Add group-by toggle:
  - Group by status → collapsible sections
  - Group by country → collapsible sections
  - Group by ticket type → collapsible sections
- [ ] Add column sorting (click header → sort asc/desc)
- [ ] Keep existing "Export" CSV button — ensure it exports filtered results

**Implementation approach:** All client-side filtering/grouping on the loaded data (no new API endpoints needed — data is already fetched).

### 3B. Abstract Grouping & Export

- [ ] Admin frontend: Same filter/group pattern as registrations:
  - Filter: status, type (oral/poster), category/track
  - Group-by: status, category
  - Column sorting
- [ ] Admin frontend: Add "Export" button:
  - CSV export function (like registrations)
  - Include: title, submitter, type, category, status, reviewer scores

### 3C. Schedule Builder (Google Calendar-like)

**Current state:** Schedule tab shows day selector (Day 1/Day 2) + simple session timeline + "Add Session" button

**This is a significant new feature:**

- [ ] **Admin frontend:** Build calendar grid view:
  - Y-axis: Time slots (8:00 AM → 8:00 PM, 30-min increments)
  - X-axis: Rooms/tracks (configurable — pull from `session_tracks` table)
  - Day tabs at top
  - Cells show session blocks (colored by type: keynote, panel, workshop, break)
  - Click empty cell → session creation popup

- [ ] **Session popup fields:**
  - Title (text input)
  - Speaker (searchable dropdown from `speakers` table, allow multiple)
  - Type (keynote, panel, workshop, poster session, break, networking)
  - Start time + End time (time pickers)
  - Room/Track (dropdown)
  - Description (textarea)
  - Capacity (number, optional)
  - Is Published (toggle, default off)

- [ ] **Admin backend:** Verify/enhance session CRUD:
  - `POST /api/sessions` — create session (should exist)
  - `PUT /api/sessions/:id` — update session
  - `DELETE /api/sessions/:id` — delete session
  - `PUT /api/sessions/:id/publish` — set is_published = 1 + trigger notification
  - `POST /api/sessions/bulk-publish` — publish multiple sessions

- [ ] **DB changes (both server.js):** Ensure sessions table has:
  ```sql
  ALTER TABLE sessions ADD COLUMN is_published INTEGER DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN room TEXT;
  ALTER TABLE sessions ADD COLUMN capacity INTEGER;
  ```

- [ ] **Notification trigger:** When sessions are published:
  - INSERT into `user_notifications` for all registered users (user_group = 'plexus_registered')
  - Title: "Schedule Update: [Session Title] added"
  - Link: `/plexus/schedule`

- [ ] **User frontend:** Update schedule display to show only published sessions from shared DB
  - Filter: `WHERE is_published = 1`
  - Display in same day-by-day timeline format

### 3D. Speaker Management

**Current state:** Speakers tab shows grid + "Add Speaker" button. `speakers` table has basic fields.

- [ ] **"Publish" toggle per speaker:**
  - Add `is_published` column to `speakers` table (ALTER TABLE in both server.js)
  - Admin frontend: Toggle switch on each speaker card
  - On publish → INSERT `user_notifications` for registered users
  - On publish → user portal shows speaker in public speakers list

- [ ] **"Push notification" button:**
  - Admin frontend: Button on speaker card → sends targeted notification
  - Notification: "New Speaker Announced: [Name] - [Title]"
  - Target: all users registered for this conference

- [ ] **Past speakers database:**
  - Add `conference_id` and `year` columns to speakers (if not present)
  - Admin frontend: Filter dropdown by year/conference
  - Maintain historical records (don't delete, just filter)

- [ ] **Excel import:**
  - Admin backend: `POST /api/speakers/import` endpoint
  - Accept .xlsx file (use xlsx library — already in user-portal deps, add to admin)
  - Parse: name, title, institution, bio, email, photo_url
  - Create speaker records

- [ ] **Email invitation system:**
  - Admin frontend: Multi-select speakers → "Send Invitation" button
  - Compose popup: subject, body (with template), attach files
  - Admin backend: `POST /api/speakers/invite` → sends via Nodemailer
  - Track: `invitation_status` column (unsent, sent, opened, responded)

- [ ] **User portal:**
  - Show published speakers in Plexus speakers grid
  - Display "New speaker" notification badge

### 3E. Sponsor Enhancement

**Current state:** `sponsors` table exists with basic fields (name, tier, logo_url, website, description, conference_id)

- [ ] **DB changes (both server.js):**
  ```sql
  ALTER TABLE sponsors ADD COLUMN status TEXT DEFAULT 'prospect';
  ALTER TABLE sponsors ADD COLUMN amount_pledged REAL DEFAULT 0;
  ALTER TABLE sponsors ADD COLUMN amount_received REAL DEFAULT 0;
  ALTER TABLE sponsors ADD COLUMN contact_name TEXT;
  ALTER TABLE sponsors ADD COLUMN contact_email TEXT;
  ALTER TABLE sponsors ADD COLUMN notes TEXT;
  ALTER TABLE sponsors ADD COLUMN is_published INTEGER DEFAULT 0;

  CREATE TABLE IF NOT EXISTS sponsor_tasks (
      id TEXT PRIMARY KEY,
      sponsor_id TEXT NOT NULL,
      title TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      due_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  ```

- [ ] **Admin frontend:**
  - Status pipeline view: prospect → contacted → negotiating → confirmed → fulfilled
  - Tier badges (gold/silver/bronze) with visual indicators
  - Per-sponsor task checklist (expandable)
  - Financial tracking: pledged vs received amounts
  - "Publish to users" button → sets `is_published = 1`

- [ ] **User portal:** Show confirmed/published sponsors under project page

### 3F. Volunteer Export

- [ ] Admin backend: `GET /api/volunteers/export` — returns CSV
- [ ] Admin frontend: Add "Export" button on Volunteers tab → downloads CSV
- [ ] Include: name, email, institution, skills, availability, assigned shifts

### 3G. Past Speakers Database & Email System

This overlaps with 3D — consolidate:

- [ ] Searchable/filterable past speaker list (all years)
- [ ] Excel import for bulk adding (same as 3D)
- [ ] Select speakers → compose invitation email → send
- [ ] Track invitation status (sent, opened, responded)
- [ ] Add `invitation_sent_at`, `invitation_opened_at`, `invitation_responded_at` columns

---

## Phase 4: Accelerator ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 4A. Fix Timeline (Editable + Better UI)

**Current state:** "Key Dates" tab with "Ključni datumi" heading, add button, timeline preview

- [ ] Admin frontend: Make key dates editable inline (click to edit, not just via modal)
- [ ] Improve visual design: color-coded by type, better spacing, milestone markers
- [ ] Verify CRUD for `accelerator_key_dates` works end-to-end:
  - POST (create) — test
  - PUT (update) — test
  - DELETE — test
  - Inline editing saves via PUT

### 4B. Key Dates Push to Users

- [ ] Admin backend: When key date created/updated → INSERT `user_notifications`:
  - Target: `user_group = 'accelerator_applicants'`
  - Title: "Accelerator Update: [Date Name]"
  - Message: "[Date Name] is set for [date]"
- [ ] User frontend: Display accelerator key dates on Accelerator section
- [ ] User frontend: Show notification for new/updated key dates

### 4C. Application Form as Preview/Editor

**Current state:** Application Form tab shows a 7-section form (Personal Info, Education, Program Selection, Additional Info, Required Docs, Optional Docs, GDPR)

- [ ] Admin frontend: Default to **read-only preview mode** (form fields disabled, styled as preview)
- [ ] Admin frontend: "Edit Form" toggle button → enables all fields for editing
- [ ] Admin backend: Store form configuration in DB (`accelerator_form_config` table or JSON in `accelerator_programs`)
- [ ] User portal: Read form config from shared DB → render dynamic form based on config
- [ ] Changes on admin side propagate automatically via shared DB

**DB changes (both server.js):**
```sql
CREATE TABLE IF NOT EXISTS accelerator_form_config (
    id TEXT PRIMARY KEY,
    program_id TEXT,
    section_name TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_type TEXT DEFAULT 'text',
    label TEXT,
    placeholder TEXT,
    is_required INTEGER DEFAULT 0,
    options TEXT,
    sort_order INTEGER DEFAULT 0,
    is_visible INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 4D. Better Application Grouping

- [ ] Admin frontend: Add filter bar (same pattern as Plexus registrations):
  - Status (draft, submitted, valid, invalid)
  - Institution (from accelerator_institutions)
  - Program type (scientific, clinical)
  - Score range
- [ ] Add group-by toggle (status, institution, program)
- [ ] Summary stats at top: Total, Pending, Reviewed, Accepted, Rejected
- [ ] Column sorting

### 4E. Fix All Action Buttons

- [ ] **Audit every button in Accelerator section:**
  - Download application package → test
  - Send email to applicant → test
  - Approve application → test status change
  - Reject application → test status change
  - View documents → test file viewing
  - Download individual documents → test
  - Bulk download per applicant → test
- [ ] Fix any non-functional buttons
- [ ] Add loading states (button shows spinner while processing)
- [ ] Add success/error feedback (toast notifications or inline messages)

### 4F. Fix Evaluation Scoring

**Current state:** Evaluation tab has "Kriteriji evaluacije" heading with scoring interface

- [ ] Debug candidate point input (score submission form):
  - Are scores saving to `accelerator_evaluations` table? Test
  - Is the PUT/POST endpoint working? Test
- [ ] Fix score calculation:
  - `total_score = SUM(score * weight)` for each criterion
  - Rank by `total_score DESC`
- [ ] Admin frontend: "Publish rankings" button:
  - Sets published flag on rankings
  - Creates notification for each applicant with their rank
  - `user_notifications`: "Your Accelerator ranking: #[rank] out of [total]"
- [ ] User portal: Applicants see their ranking/status on Accelerator page

### 4G. Remove "Registrations" Tab

- [ ] Admin frontend: Remove the "Registrations" tab from Accelerator section
- [ ] It duplicates "Applications" — confirm no unique data before removing

### 4H. Files Tab Grouped by Applicant

- [ ] Admin backend: `GET /api/accelerator/files/grouped` — returns files grouped by application_id
- [ ] Admin frontend: Display as:
  ```
  ▶ Applicant Name (3 files)
    ├── motivation_letter.pdf
    ├── cv.pdf
    └── recommendation.pdf
  ▶ Another Applicant (2 files)
    ├── motivation_letter.pdf
    └── cv.pdf
  ```
- [ ] Download individual file button
- [ ] Bulk download per applicant (zip)

---

## Phase 5: Biomedical Forum ━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 5A. Fix Directory → Merge into Members Tab

**Current state:** Forum has both "Directory" tab (member grid with filters) and "Members" tab (admin table with export)

- [ ] Admin frontend: Remove separate "Directory" tab
- [ ] Enhance "Members" tab:
  - Add search + filter capabilities from Directory (specialty, career level, country, industry)
  - Keep export button (CSV/Excel)
  - Add grouping: by specialty, by country, by institution
  - Add per-member actions: message, email, view profile
  - Fix missing names (some members show without names)

### 5B. Event Management from Admin

**Current state:** Forum has "Events" tab with event cards and "Create Event" button

- [ ] Admin frontend: Create events with full details:
  - Date, time, end time
  - Venue/location
  - Speaker(s) — multi-select
  - Description (rich text or markdown)
  - Max capacity
  - Registration deadline
  - Type (symposium, workshop, networking, seminar)

- [ ] **"Publish to users" button:**
  - Sets `is_published` flag on event
  - Triggers notification to forum members
  - Published event appears on user portal

- [ ] **Registration form editing:**
  - Admin can customize what fields the registration form asks
  - Store form config in DB
  - User portal reads config and renders dynamic registration form

- [ ] **Optional QR check-in per event:**
  - Admin toggle: "Enable check-in for this event"
  - When enabled: generate QR codes for registrants
  - Check-in scanner page (camera-based, reuse Plexus check-in pattern)
  - Check-in stats dashboard

- [ ] **User portal:**
  - Show published events on Forum page
  - Registration form (dynamic based on admin config)
  - QR code display for registered events with check-in enabled

### 5C. Admin Content Management for User Portal

**Current state:** User portal has homepage with Smart Action Suggestions, Activity Feed, etc.

- [ ] **Admin frontend: Add "User Portal Management" section within Forum:**
  - Visual preview of user-facing content
  - Editable sections:
    - Rotating hero cards (title, description, image, link)
    - News posts / announcements
    - Featured content

- [ ] **DB changes (both server.js):**
  ```sql
  CREATE TABLE IF NOT EXISTS portal_content (
      id TEXT PRIMARY KEY,
      section TEXT NOT NULL,
      project TEXT,
      title TEXT,
      content TEXT,
      image_url TEXT,
      link TEXT,
      is_published INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  ```

- [ ] Admin backend: CRUD endpoints for portal_content
- [ ] User backend: GET published content by section
- [ ] User frontend: Replace hardcoded content with dynamic DB-driven content

---

## Phase 6: Building Bridges ━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 6A. Editable Event Details (Synced to User Side)

**Current state:** Admin has event list with New Event / Edit / Delete. User portal shows 3 hardcoded events (ETH, Harvard-MIT, NIH editions)

- [ ] Admin frontend: Full event editor:
  - Date, time
  - Venue, location (city, address)
  - Capacity
  - Description
  - Status (planning, upcoming, registration_open, ongoing, completed)
  - Contact info

- [ ] Admin backend: Ensure CRUD works for Building Bridges events:
  - `POST /api/bridges/events` — create
  - `PUT /api/bridges/events/:id` — update
  - `DELETE /api/bridges/events/:id` — delete

- [ ] User frontend: Replace hardcoded events with dynamic data from shared DB
  - Fetch from API on load
  - Display current event info (auto-updates when admin changes)

### 6B. Registration + QR Check-in

- [ ] **QR code generation:**
  - When user registers for BB event → generate QR code (reuse Plexus pattern)
  - Store QR data in `registrations` table or dedicated BB table
  - Display QR to user in their registration confirmation

- [ ] **Admin check-in scanner:**
  - Camera-based scanner page (reuse Plexus check-in code)
  - Scan QR → mark as checked in
  - Manual input fallback (name/email search)

- [ ] **Check-in dashboard:**
  - Real-time stats: checked in / total / remaining
  - Recent check-ins list
  - Per-event check-in view

### 6C. Program/Speakers/Schedule Management

- [ ] **Speaker management:** Reuse Plexus speaker pattern:
  - Add speakers to BB events
  - Publish toggle
  - Speaker cards on user portal

- [ ] **Schedule/Program builder:** Lighter version of Plexus schedule:
  - Program items with time, title, speaker, description
  - Simple list view (not full calendar grid — BB events are smaller)
  - Publish to user portal

- [ ] **User portal:** Show speakers + schedule for each BB event

### 6D. Chat Sub-Channels

- [ ] Apply Phase 2 sub-channel system to Building Bridges project
- [ ] Default sub-channels: #general, #operations, #speakers, #logistics

---

## Phase 7: Finances & PR Audit ━━━━━━━━━━━━━━━━━━━━━━━━

### 7A. Finance Module — Full Audit

**Current state:** 9 tabs (Dashboard, Bank Balance, Transactions, Work Units, Invoices, Payment Orders, Travel Orders, Reports, Settings). Multiple Croatian labels remaining.

**Testing checklist:**

- [ ] **Dashboard tab:**
  - Verify balance cards show correct data
  - Verify work units overview
  - Verify by-project chart renders
  - Verify pending items count
  - Test "Close Fiscal Year" button (carefully!)

- [ ] **Bank Balance tab:**
  - Test add entry (modal)
  - Test edit entry
  - Test delete entry
  - Verify balance calculations

- [ ] **Transactions tab:**
  - Test add transaction (income + expense)
  - Test filter by type/project
  - Test edit + delete
  - Verify all form fields save correctly

- [ ] **Work Units tab:**
  - Test add work unit
  - Test edit (code, name, grant source, budget)
  - Verify budget/used/remaining calculations
  - Test status changes

- [ ] **Invoices tab:**
  - Test create incoming invoice
  - Test create outgoing invoice
  - Test all fields save correctly
  - Verify total calculations
  - Test status workflow: draft → issued → paid
  - Test PDF generation (`/api/finance/invoices/:id/pdf`)

- [ ] **Payment Orders tab:**
  - Test create payment order
  - Test all fields
  - Test status changes

- [ ] **Travel Orders tab:**
  - Test create travel order
  - Test all fields (traveler, destination, dates, expenses)
  - Test status workflow: assigned → submitted → approved/rejected → paid
  - Test PDF generation (`/api/finance/travel-orders/:id/pdf`)
  - Verify cost calculations (daily allowance, km rate)

- [ ] **Reports tab:**
  - Test by-project report
  - Test by-work-unit report
  - Test monthly overview

- [ ] **Settings tab:**
  - Test saving company info
  - Test saving travel rates
  - Test saving invoice footer

- [ ] **Language fixes:** Replace all Croatian labels (see Phase 0B list)

### 7B. PR & Media — Full Audit

**Current state:** 8 tabs (Dashboard, Calendar, Social Media, Newsletters, Media Library, AI Studio, Campaigns, Subscribers)

**Testing checklist:**

- [ ] **Dashboard tab:**
  - Verify all stat cards
  - Verify upcoming content, recent posts, draft newsletters, active campaigns

- [ ] **Calendar tab:**
  - Test month navigation (prev/next)
  - Test platform filter
  - Test clicking on a date to create content
  - Verify calendar grid renders correctly for each month

- [ ] **Social Media tab:**
  - Test "Log Post" → create post
  - Test platform filter
  - Test edit + delete post
  - Verify post card rendering

- [ ] **Newsletters tab:**
  - Test create newsletter
  - Test status filter (draft/scheduled/sent)
  - Test edit newsletter
  - Test "Send" action (via Nodemailer)
  - Verify table data

- [ ] **Media Library tab:**
  - Test file upload (images, documents)
  - Test category filter
  - Test search
  - Verify grid display
  - Test download/delete

- [ ] **AI Studio tab:**
  - Test "Generate Image" (if backend AI is configured)
  - Test "Generate Caption"
  - Verify platform and tone selectors work
  - Test "Use" button to save generated content

- [ ] **Campaigns tab:**
  - Test create campaign
  - Test edit/delete
  - Verify display

- [ ] **Subscribers tab:**
  - Test add subscriber
  - Test export (CSV)
  - Verify subscriber list

- [ ] **Add weekly planning view:**
  - New view option on Calendar tab: "Week View"
  - Shows 7-day grid with key dates, scheduled posts, tasks

---

## Phase 8: Final Polish & Verification ━━━━━━━━━━━━━━━━━

### 8A. Cross-Portal Sync Verification

**Test matrix — every admin action that should appear on user side:**

| Admin Action | User Side Effect | Status |
|-------------|-----------------|--------|
| Publish speaker | Appears in user speaker grid | [ ] |
| Publish session/schedule | Appears in user schedule | [ ] |
| Publish event (Forum/BB) | Appears in user events | [ ] |
| Publish sponsor | Appears in user sponsors | [ ] |
| Send notification | Appears in user notification panel | [ ] |
| Update event date/venue | User sees updated info | [ ] |
| Change registration status | User sees status update | [ ] |
| Publish rankings | Applicant sees rank | [ ] |
| Update project dates | User dashboard timeline updates | [ ] |
| Portal content changes | User homepage content updates | [ ] |

### 8B. Responsive & UI Polish

- [ ] Consistent spacing, typography, colors across all sections
- [ ] Logo properly displayed: admin sidebar, admin login, user sidebar, user login
- [ ] No broken icons or placeholder text
- [ ] All modals/popups close properly (test X button + clicking outside)
- [ ] All export buttons work (CSV, PDF)
- [ ] No console errors in browser
- [ ] No remaining Croatian text anywhere
- [ ] All forms validate properly
- [ ] All toast/feedback messages display correctly
- [ ] Loading states on all async operations
- [ ] Tab navigation works correctly in all sections

---

## Execution Strategy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Dependency Graph

```
Phase 0 (Foundation) ──┬──→ Phase 3 (Plexus)     ──┐
                       ├──→ Phase 4 (Accelerator)  ──┤
                       ├──→ Phase 5 (Forum)        ──┤
                       ├──→ Phase 7 (Finance/PR)   ──┤──→ Phase 8 (Polish)
                       │                             │
Phase 1 (Dashboard) ───┤  (can start during Phase 0)│
Phase 2 (Chat) ────────┤  (independent)             │
                       └──→ Phase 6 (BB) ───────────┘
                            (needs Phase 2 for chat)
```

### Parallelization Plan

| Batch | Phases | Prerequisites |
|-------|--------|---------------|
| Batch 1 | 0B + 0C + 1 + 2 | None (0A done) |
| Batch 2 | 3 + 4 | Phase 0 done |
| Batch 3 | 5 + 6 | Phase 0 done, Phase 2 done (for 6D) |
| Batch 4 | 7 | Phase 0B done |
| Batch 5 | 8 | All above done |

### Per-Phase Verification Protocol

After completing each phase:
1. Kill both servers: `lsof -ti:3006,3007 | xargs kill -9`
2. Restart admin: `cd admin-portal/backend && node server.js` (port 3007)
3. Restart user: `cd user-portal/backend && node server.js` (port 3006)
4. Open admin in browser → test all changed sections
5. Open user portal → verify changes propagated via shared DB
6. Check browser console for JS errors
7. Grep for remaining Croatian text in changed sections
8. Update this todo.md with results

### Estimated Scope Per Phase

| Phase | New Tables | New Endpoints | Frontend Changes | Complexity |
|-------|-----------|---------------|-----------------|------------|
| 0B | 0 | 0 | ~50 string replacements | Low |
| 0C | 0 | 0 | ~8 HTML changes | Low |
| 1 | 0-1 | 1-3 | ~200 lines | Medium |
| 2 | 1 | 5-8 | ~150 lines | Medium |
| 3 | 1 | 8-12 | ~500 lines | High |
| 4 | 0-1 | 3-5 | ~300 lines | Medium-High |
| 5 | 1 | 5-8 | ~300 lines | Medium-High |
| 6 | 0 | 3-5 | ~200 lines | Medium |
| 7 | 0 | 0 | ~100 lines (fixes) | Medium |
| 8 | 0 | 0 | ~100 lines (polish) | Low-Medium |

---

## Important Patterns & Conventions

### Modal Pattern (admin frontend)
```html
<div id="[modalId]" class="modal" style="display: none; max-width: 550px;">
    <div class="modal-body">
        <h2>Title</h2>
        <button class="modal-close" onclick="App.closeModal('[modalId]')">
            <i class="fas fa-times"></i>
        </button>
        <!-- Form fields -->
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button class="btn btn-secondary" onclick="App.closeModal('[modalId]')">Cancel</button>
            <button class="btn btn-primary" onclick="submitHandler()">Save</button>
        </div>
    </div>
</div>
```

### API Pattern (backend)
```javascript
app.post('/api/resource', authenticateToken, async (req, res) => {
    try {
        const { field1, field2 } = req.body;
        const id = generateId();
        db.run(`INSERT INTO table (id, field1, field2) VALUES (?, ?, ?)`, [id, field1, field2]);
        saveDb();
        res.json({ success: true, id });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to create resource' });
    }
});
```

### Notification Trigger Pattern
```javascript
// After an admin action (e.g., publishing a speaker):
db.run(`INSERT INTO user_notifications (id, user_group, category, project, title, message, icon, icon_class, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [generateId(), 'plexus_registered', 'announcement', 'plexus',
     'New Speaker Announced', 'Dr. X will present on Topic Y',
     'fa-user-tie', 'plexus', adminUserId]);
saveDb();
```

### Color Scheme
```
--bg-primary: #0f172a      (dark navy)
--bg-secondary: #1e293b    (lighter navy)
--accent-gold: #c9a962     (brand gold)
--plexus: #a78bfa          (purple)
--accelerator: #22d3ee     (cyan)
--forum: #fb923c           (orange)
--bridges: #f472b6         (pink)
--finances: #10b981        (green)
--pr-media: #ec4899        (magenta)
```

---

## Progress Log

| Date | Phase | Task | Status | Notes |
|------|-------|------|--------|-------|
| 2026-02-25 | All | Created master implementation plan | ✅ | |
| | 0A | Notification system | ✅ | Complete |
| 2026-02-25 | 0B | Language cleanup | ✅ | ~380+ edits, all Croatian UI text now English. Only proper nouns remain. |
| 2026-02-25 | 0C | Logo integration | ✅ | Local logo in both portals, 7 HTML references updated, CDN dependency removed |
| 2026-02-25 | 1 | Homepage & Dashboard | ✅ | Timeline collision fix, editable project dates, Portal Pulse redesign, sequence notifications |
| 2026-02-25 | 2 | Chat System | ✅ | Sub-channels with hierarchy, channel members with bulk add, member-filtered listing |
| 2026-02-25 | 3 | Plexus Conference | ✅ | Reg/abstract filtering+grouping+sorting+export, calendar schedule builder, speaker mgmt with publish/import/email, sponsor pipeline, volunteer export |
| 2026-02-25 | 4 | Accelerator | ✅ | Inline editable timeline with categories, form preview/editor, app filtering+grouping, button loading states, publish rankings, remove dup tab, files by applicant |
| 2026-02-25 | 5 | Biomedical Forum | ✅ | Merged directory→members with filters/grouping, event mgmt with QR check-in, portal content CMS with live preview |
| 2026-02-25 | 6 | Building Bridges | ✅ | Dynamic events replacing hardcoded, QR registration+check-in, speaker CRUD+publish, program timeline, 4 default chat channels |
| 2026-02-25 | 7 | Finance & PR | ✅ | Finance audit clean, PR weekly planning view with 7-day grid |
| 2026-02-25 | 8 | Final Polish | ✅ | Croatian sweep clean (only proper nouns), all syntax verified |
