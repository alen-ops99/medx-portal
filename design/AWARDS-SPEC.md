# Plexus Gala Awards — build spec (Alen 2026-09-11)

All four are awarded at the Gala Evening (5 Dec 2026, Esplanade). Edition-scoped (plexus_editions, active = plexus-2026). Lives under the Plexus Week umbrella next to Meetups.

## Categories (seed for edition plexus-2026; names/criteria editable in admin)
| key | name | who decides | intake | laureates |
|---|---|---|---|---|
| `lifetime-bridge` | **Med&X Lifetime Bridge Award** · citation "for substantial contributions connecting Croatian medicine and science with the world" | organizers pick (no public call) | admin "add laureate" | 1–2 |
| `excellence` | **Croatian Excellence in Medicine & Science Award** · criteria text mentions early/mid career (~under 40), outstanding international achievement | public nominations (third-party AND self) | nomination form | 1–2 |
| `rising-talent` | **Rising Talent Award** · upcoming Croatian medical students / young physicians & scientists who went beyond the comfort zone (e.g. Accelerator alumni) | public nominations (third-party AND self) | nomination form | 1–2 |
| `fellowship` | **Plexus Fellowship** · high-school + medical students in Croatia; structured proposal; winners get a funded gala seat and give a 3-minute presentation | public application | application form + optional PDF | 2 |

## Timeline (settings, admin-editable per edition)
`opens_at` 2026-10-01 09:00 Zagreb · `closes_at` 2026-11-01 23:59 Zagreb · decisions in November · awarded 2026-12-05. Before opens: pages show "Nominations open 1 October". After closes: forms closed, "Thank you — decisions in November".

## Data
```sql
CREATE TABLE IF NOT EXISTS award_categories (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, key TEXT NOT NULL,
  name TEXT NOT NULL, name_hr TEXT, citation TEXT, criteria_md TEXT, criteria_md_hr TEXT,
  intake TEXT NOT NULL CHECK (intake IN ('none','nomination','application')),
  allow_self INTEGER DEFAULT 1, laureates_max INTEGER DEFAULT 2,
  rubric_json TEXT,          -- [{key,label,label_hr,desc}] three criteria, 1–5 each
  sort_order INTEGER, opens_at TEXT, closes_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (edition_id, key)
);
CREATE TABLE IF NOT EXISTS award_entries (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('nomination','self-nomination','application','organizer')),
  -- nominee / applicant
  nominee_first TEXT, nominee_last TEXT, nominee_email TEXT, nominee_institution TEXT, nominee_position TEXT,
  nominee_country TEXT, nominee_birth_year INTEGER, nominee_links TEXT,   -- links JSON array
  -- nominator (null for self/application)
  nominator_name TEXT, nominator_email TEXT, nominator_relation TEXT,
  -- narrative
  statement TEXT,                           -- nominations: why this person (≤400 words)
  challenge TEXT, solution TEXT, why_you TEXT,   -- fellowship structured fields (≤200/300/100 words)
  language TEXT DEFAULT 'en', school TEXT, study_year TEXT, willing_to_present INTEGER DEFAULT 0,
  attachment_key TEXT, attachment_name TEXT, attachment_size INTEGER,   -- S3 (BB_S3_* bucket, prefix awards/)
  consent_publish INTEGER DEFAULT 0,        -- may we mention the nominee publicly if selected
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','eligible','ineligible','shortlisted','winner','declined','withdrawn','pending-review')),
  gate_reason TEXT, source_ip_hash TEXT, user_id TEXT,
  decided_at TEXT, decided_by TEXT, notified_at TEXT, notify_kind TEXT,
  manage_token TEXT UNIQUE,                 -- HMAC: nominee/applicant status page + withdraw
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT,
  UNIQUE (category_id, nominee_email, kind)   -- same person nominated twice by different people → merged as second nomination row? NO: allow multiple nominators per nominee; uniqueness only per (category, nominee_email, nominator_email) — see below
);
-- correction: use UNIQUE (category_id, nominee_email, COALESCE(nominator_email,'self'))
CREATE TABLE IF NOT EXISTS award_reviewers (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  categories TEXT NOT NULL,                 -- JSON array of category ids
  token TEXT UNIQUE NOT NULL,               -- HMAC review-room token (no admin login needed)
  invited_at TEXT, accepted_at TEXT, last_seen TEXT, status TEXT DEFAULT 'invited',
  UNIQUE (edition_id, email)
);
CREATE TABLE IF NOT EXISTS award_scores (
  id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, reviewer_id TEXT NOT NULL,
  scores_json TEXT NOT NULL,                -- {impact:4, originality:5, feasibility:3}
  total INTEGER NOT NULL, comment TEXT, conflict INTEGER DEFAULT 0,   -- conflict-of-interest flag → excluded
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (entry_id, reviewer_id)
);
CREATE TABLE IF NOT EXISTS award_laureates (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL, entry_id TEXT, name TEXT NOT NULL, institution TEXT,
  citation TEXT, photo_url TEXT, present_minutes INTEGER DEFAULT 0, gala_registration_id TEXT,
  slides_token TEXT, announced INTEGER DEFAULT 0, sort_order INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## Public side (member portal backend + frontend-v2, EN + HR)
- `/awards` (public, no login) — the four awards, status banner (opens/closes), each card → `/awards/<key>`.
- `/awards/<key>` — criteria, deadline, **Nominate someone / Nominate yourself** (excellence, rising-talent) or **Apply** (fellowship). Lifetime Bridge: no form ("chosen by the organizers"). Logged-in members get fields prefilled.
- Nomination form: nominee (name, email optional-but-encouraged, institution, position, country, links), nominator (name, email, relation) or self, statement ≤400 words (live counter), consent checkbox, honeypot. Application (fellowship): applicant (name, email, school/university, year, city), **The challenge ≤200 · Your solution ≤300 · Why you ≤100** (live counters, language toggle irrelevant — either language accepted), optional one-page PDF ≤5 MB, **"I am willing to give a 3-minute presentation at the Gala"** checkbox, consent, honeypot.
- **Review gate is mandatory** (standing rule): run `review-gate.js` suspicionScore + country hold (safe list) + honeypot; held → `pending-review` + review email to Alen + the soft "we received your nomination" note; never tip off.
- Acknowledgment emails (dark house shell): "We received your nomination of <name>" (to nominator; to nominee too if email given and third-party: "You have been nominated for … by <nominator>" — warm, no action needed) · "We received your application" (fellowship). Each carries a manage link (status + withdraw).
- Public status page `/awards/manage/:token` — status (received / under review / decided), withdraw button.
- Closing: form disabled after closes_at; page text switches.

## Reviewer room (public HMAC page, no login): `/awards/review/:token`
- Lists the reviewer's categories → entries (anonymised nominator; nominee visible), each with full text, attachment viewer link (presigned 15-min), score form: three rubric criteria 1–5 + comment + "conflict of interest — skip". One submission per entry, editable until the category closes for review. Reviewers never see other reviewers' scores. Progress bar "you've scored 12 of 31".
- Rubrics: awards → Achievement / Impact / Trajectory; fellowship → Impact / Originality / Feasibility (rubric_json editable in admin).

## Admin (admin backend v2 `awards-ops.js` + frontend-v2: Plexus Week → **AWARDS** tab, section id `plexus-awards`)
- **Overview**: per category — received / eligible / shortlisted / winners, days to close, reviewer progress.
- **Entries table** per category: filter by status, search, open drawer: all fields, attachment, gate reason, nominators list (a nominee nominated by 3 people shows as ONE candidate with 3 nominations — group by nominee_email within category), reviewer scores (avg, spread, n, per-reviewer), notes (registrant_notes reuse), actions: mark eligible/ineligible, shortlist, **Choose as winner**, decline, merge duplicates.
- **Lifetime Bridge**: "Add laureate" (name, institution, citation, photo).
- **Reviewers**: add (name, email, categories) → sends the invitation email with their room link (through sendEmail immediately — Alen: "admin will assign a few people, send them: do you want to be a reviewer"); resend; revoke; see progress.
- **Ranking view** per category: entries sorted by mean total, with min/max and reviewer count; one-click winner / shortlist from here.
- **Decide & notify**: when all winners in a category are set → "Notify" button stages the emails into the **Outbox for approval** (house rule): winner email (with citation, gala details; fellowship winners: funded gala seat → creates a comp `gala_registrations` row (payment_status='comp', amount_paid=0, notes 'Plexus Fellowship laureate') and issues QR + wallet pass via the existing gala ticket flow, plus a slides-upload link and the "please confirm you'll present 3 minutes" ask), shortlisted-not-selected email, declined email (kind), thank-you to nominators. Nothing sends until approved in Outbox.
- **Gala roster export**: laureates with citation + presentation flag → CSV and a printable one-pager for the MC; also exposed to the Gala hub as "Awards" block.
- **Settings**: opens/closes dates, names, criteria (EN/HR), rubric, laureates_max, allow_self.

## Website hook (later, not this build): medx.hr copy for the public call — spec produces the EN/HR announcement text as `design/AWARDS-CALL-COPY.md`.

## Non-negotiables
- Additive only; new tables/routes/section id; HMAC tokens via JWT_SECRET (`medxaward:manage:<id>`, `medxaward:reviewer:<id>`), 32-hex, timingSafeEqual; reviewer token grants ONLY that reviewer's categories; forged/other → 404.
- All emails on the dark house shell via `tpl.shell({tone:'dark'})`; registrant voice rules (never "Building Bridges evening"; "all three events").
- Attachments to the existing S3 bucket (BB_S3_* env) under `awards/<entry id>/`, PDF only, ≤5 MB, magic-byte check (reuse Boston's upload helpers/sanitizers).
- Tests `tests/awards.test.js`: word-limit enforcement, self vs third-party uniqueness, multiple nominators grouped, gate hold path, reviewer scoping (A cannot score B's category → 404), score uniqueness + edit, ranking math (mean/spread, conflict excluded), winner → comp gala row created exactly once, notify staged to outbox not sent, opens/closes windows, withdraw via manage token. Existing suites stay green. Boot-test both backends before pushing.
- Branch `redesign/member-portal`; do not touch `main`; no deploys (operator deploys).
