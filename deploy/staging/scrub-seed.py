#!/usr/bin/env python3
"""
deploy/staging/scrub-seed.py — build the SCRUBBED staging seed (seed.sql.gz) from a
production SQLite dump of the Med&X portal database.

    python3 deploy/staging/scrub-seed.py \
        --src   /path/to/prod-dump.db          # never modified (copied first)
        --out   /tmp/scrubbed.db               # scrubbed SQLite file (scratch)
        --sql-gz deploy/staging/seed.sql.gz    # gzip of the SQL dump of scrubbed.db (gitignored)
        --map-out /tmp/pseudonym-map.json      # real email -> pseudonym (SENSITIVE, scratch only)
        --report  /tmp/scrub-report.json       # machine-readable summary of what was touched
        [--password 'Plexus2026!'] [--hash '$2a$10$...'] [--backend user-portal/backend]

What it does (see SEED-NOTES.md for the policy in prose):
  1. TEAM accounts (users.is_admin=1 OR is_staff=1 OR is_founder=1) keep email/name/institution/flags.
  2. Every other person is pseudonymised consistently across the WHOLE database:
     real email -> member<NNN>@staging.medx.hr, real name -> "Member <NNN>" / "Test".
     The map is built from users (by created_at) first, then every other *email* column,
     then any personal address found in free text; the same real email always gets the
     same pseudonym. Name-like columns are rewritten in rows whose email is pseudonymised,
     plus a diacritic-insensitive full-name sweep over free text / JSON in non-content tables.
     Public content (speakers, sessions, sponsors, news, settings, templates...) stays intact.
  3. PII not needed for a review -> NULL (phones, addresses, IBAN/bank, DOB/passport/OIB/IDs,
     IPs, staff GPS), health-related free text of pseudonymised people -> NULL, personal
     statements / CVs / document paths in applications -> a placeholder sentence.
  4. Secrets -> NULL (token/secret/api_key/password/webhook/private_key/vapid/... columns,
     secret-like keys in key/value tables, token-bearing URLs inside stored email HTML);
     push subscriptions deleted. Stripe session / payment ids are kept (identifiers, not secrets).
  5. Every password_hash -> bcrypt(staging password, cost 10); email_verified=1,
     must_change_password=0, reset/verification tokens NULL.
  6. `_purged_*` backup tables dropped, VACUUM.
  7. Verification: row counts, users arithmetic, dump scan for leftover personal emails,
     bcrypt round-trip. (The boot/login test is done by hand — see SEED-NOTES.md.)

The script contains no real names or addresses; everything is derived from the database.
Never commit --map-out or the un-scrubbed source.
"""
import argparse
import collections
import datetime
import gzip
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import unicodedata

# ----------------------------------------------------------------------------------------
# Policy tables
# ----------------------------------------------------------------------------------------
STAGING_DOMAIN = 'staging.medx.hr'
PLACEHOLDER = 'Scrubbed for staging seed.'
PLACEHOLDER_JSON = '{"scrubbed":true}'
DEFAULT_PASSWORD = 'Plexus2026!'

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
IPV4_RE = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
# token-bearing URLs / query strings inside stored HTML, audit details, JSON payloads
URL_TOKEN_RES = [
    re.compile(r'(\btoken=)[A-Za-z0-9._~\-]{8,}'),
    re.compile(r'(/(?:verify|magic|reset|confirm|claim|unsubscribe|itinerary|pass|invite|r)/)[A-Za-z0-9._~\-]{16,}'),
]

# Role / generic mailboxes are business addresses, never pseudonymised (unless they are a
# non-team *user account*, which the users pass maps first).
GENERIC_LOCALS = {
    'info', 'hello', 'contact', 'kontakt', 'office', 'ured', 'admin', 'support', 'help',
    'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'press', 'pr', 'media', 'accelerator',
    'bridges', 'forum', 'plexus', 'gala', 'donations', 'donate', 'newsletter', 'team',
    'tajnistvo', 'postmaster', 'webmaster', 'sales', 'billing', 'invoices', 'privacy',
    'legal', 'security', 'abuse', 'careers', 'jobs', 'events', 'registration', 'tickets',
}

# Column names that hold a PERSON's name (rewritten only in rows whose email is pseudonymised
# or whose FK points at a pseudonymised user).
PERSON_NAME_COLS = {
    'first_name', 'last_name', 'middle_name', 'full_name', 'display_name', 'guest_name',
    'attendee_name', 'contact_name', 'applicant_name', 'recipient_name', 'submitter_name',
    'author_name', 'winner_name', 'bidder_name', 'member_name', 'traveler_name', 'passport_name',
    'billing_name', 'party_name', 'reviewer_name', 'recommender_name', 'new_user_name',
    'orig_first_name', 'orig_last_name', 'recipient_first_name', 'recipient_last_name',
    'contact_person', 'claimed_by_name', 'uploaded_by_name', 'consent_name', 'emergency_contact_name',
}
# Person columns whose values also seed the free-text full-name sweep (never org-capable ones).
SWEEP_SEED_COLS = {
    'name', 'full_name', 'display_name', 'guest_name', 'attendee_name', 'applicant_name', 'submitter_name',
    'author_name', 'winner_name', 'member_name', 'traveler_name', 'new_user_name', 'claimed_by_name',
    'uploaded_by_name', 'consent_name',
}
# Tables where the bare column `name` is a person (elsewhere `name` is an event/org/thing).
BARE_NAME_IS_PERSON = {
    'forum_considerations', 'forum_candidates', 'event_campaign_invitees', 'council_invitations',
    'event_waitlist', 'waitlist_offers', 'seat_confirmations', 'forum_reservations',
    'signup_form_responses', 'gala_picker_invites', 'gameday_invites', 'review_reviewers',
    'accelerator_interviewers', 'speaker_applications', 'forum_event_registrations',
    'media_contacts', 'team_members', 'contacts', 'pr_subscribers', 'volunteers', 'waitlist',
}
# name-column prefix -> the email column(s) that identify that person inside the same row
NAME_PREFIX_EMAIL = [
    ('orig_', ['orig_email']), ('recipient_', ['new_user_email', 'recipient_email']),
    ('new_user_', ['new_user_email']), ('guest_', ['guest_email']), ('winner_', ['winner_email']),
    ('reviewer_', ['reviewer_email']), ('recommender_', ['recommender_email']),
    ('author_', ['author_email']), ('submitter_', ['submitter_email']), ('contact_', ['contact_email']),
    ('attendee_', ['attendee_email']), ('party_', ['party_email']), ('billing_', ['email']),
]
# (table, name column, FK column, FK target) — person names keyed by a user/registration id
FK_NAME_RULES = [
    ('staff_tracking_consent', 'display_name', 'user_id', 'users'),
    ('guest_passes', 'member_name', 'member_user_id', 'users'),
    ('finance_travel_orders', 'traveler_name', 'traveler_id', 'users'),
    ('team_members', 'name', 'user_id', 'users'),
    ('team_files', 'uploaded_by_name', 'uploaded_by', 'users'),
    ('certificates', 'recipient_name', 'registration_id', 'registrations'),
    ('nag_items', 'claimed_by_name', 'claimed_by', 'email'),
]
# Profile-style tables keyed by user_id whose free text belongs to the (pseudonymised) user
FK_PROFILE_TABLES = {'user_profiles': 'user_id', 'networking_profiles': 'user_id',
                     'submission_pipeline': 'user_id', 'mentorship_profiles': 'user_id'}

# Public content: names here are content (speakers, talks, sponsors, settings, templates...).
# The full-name sweep skips these tables; column-level rules still apply (e.g. a personal
# speaker email is pseudonymised, the speaker's public name is kept).
PUBLIC_TABLES = {
    'speakers', 'bridges_speakers', 'forum_event_speakers', 'talks', 'sessions', 'forum_event_schedule',
    'sponsors', 'sponsor_materials', 'sponsor_tasks', 'sponsor_reports', 'team_members', 'forum_news',
    'content_blocks', 'template_library', 'email_templates', 'forum_email_templates', 'reply_templates',
    'reminder_touches', 'pr_templates', 'gala_settings', 'forum_gala_settings', 'plexus_settings',
    'plexus_page_settings', 'press_releases', 'pr_newsletters', 'pr_posts', 'pr_content_calendar',
    'pr_campaigns', 'pr_media_assets', 'pr_ai_generations', 'accelerator_institutions',
    'accelerator_institution_details', 'accelerator_programs', 'accelerator_key_dates',
    'accelerator_evaluation_criteria', 'accelerator_pdf_settings', 'accelerator_sites',
    'accelerator_interviewers', 'conferences', 'ticket_types', 'event_editions', 'event_components',
    'checkin_events', 'project_settings', 'project_status', 'project_timeline_events', 'feed_items',
    'portal_content', 'forum_convenings', 'forum_convening_segments', 'gala_menu_options',
    'year_calendar_entries', 'content_checklist', 'review_rubrics', 'review_criteria', 'org_settings',
    'finance_settings', 'app_state', 'rewards_settings', 'automation_config', 'council_settings',
    'signup_forms', 'forum_campaign', 'event_campaigns', 'reminder_sequences', 'speaker_itineraries',
    'speaker_itinerary_items', 'speaker_kits', 'speaker_flight_quotes', 'staff_pairings', 'venue_rooms',
    'partner_hotels', 'session_tracks', 'surveys', 'session_polls', 'forum_badges', 'forum_groups',
    'opportunities', 'member_announcements', 'member_newsletters', 'gameday_settings',
    'staff_tracking_settings', 'press_settings', 'intake_windows', 'planner_plans', 'advisor_reviews',
    'design_presets', 'spatial_assets', 'conference_archives', 'conference_photos', 'resources',
}

# --- PII column classes (NULLed everywhere, team rows included) ---
PHONE_RE = re.compile(r'(^|_)(phone|mobile|tel|telephone|whatsapp|fax)(_|$)|_phone_24h$', re.I)
ADDRESS_RE = re.compile(r'(^|_)(address|street|postal|postcode|postal_code|zip|zip_code)(_|$)', re.I)
ADDRESS_KEEP_PREFIX = ('venue_', 'location_', 'pharmacy_', 'hotel_', 'company_', 'office_', 'embassy_')
BANK_RE = re.compile(r'(^|_)(iban|bank|bank_details|swift|bic|account_number|bank_account)(_|$)', re.I)
ID_RE = re.compile(r'(^|_)(date_of_birth|dob|birth_date|birthdate|passport|passport_\w+|id_number|oib|'
                   r'national_id|ssn|registration_plate|vat_number|billing_vat|institution_vat|recipient_vat|party_oib)(_|$)', re.I)
IP_RE = re.compile(r'(^|_)ip(_address)?$', re.I)
GEO_COLS = {'lat', 'lng', 'latitude', 'longitude', 'accuracy', 'heading', 'speed'}
GEO_TABLES = {'staff_positions'}
PII_NULL_SKIP_TABLES = {'finance_settings'}  # key/value org data (company OIB/IBAN are org facts)

# --- Secrets ---
SECRET_RE = re.compile(r'token|secret|api_key|apikey|password|webhook|private_key|vapid|stripe_secret|'
                       r'invite_code|invitation_code|access_key|p256dh|(^|_)auth$', re.I)
SECRET_SKIP_COLS = {'password_hash', 'must_change_password', 'password_changed_at', 'tokens_json'}
KV_KEY_COLS = ('key', 'setting_key', 'name')
KV_VALUE_COLS = ('value', 'setting_value')
PUSH_SUB_COLS = {'endpoint'}  # a table with `endpoint` + (p256dh|auth|keys) is a push-subscription table

# --- Personal-statement / document columns (application-style tables) ---
APPLICATION_TABLES = {
    'accelerator_applications', 'accelerator_applicants', 'accelerator_documents', 'accelerator_recommendations',
    'accelerator_messages', 'accelerator_consents', 'scholarship_applications', 'speaker_applications',
    'visa_requests', 'cme_submissions', 'forum_candidates', 'forum_prospects', 'forum_considerations',
    'forum_candidate_replies', 'event_campaign_invitees', 'event_campaign_replies', 'council_invitations',
    'user_profiles', 'networking_profiles', 'registration_details', 'contacts', 'contact_interactions',
    'submission_pipeline', 'review_scores', 'signup_form_responses', 'forum_members', 'auto_reply_log',
}
STATEMENT_COLS = {
    'motivation_statement', 'previous_experience', 'previous_research_experience', 'publications',
    'awards_honors', 'additional_info', 'special_arrangements', 'research_interests', 'application_text',
    'financial_need_statement', 'research_statement', 'personal_sentence', 'bio', 'achievements',
    'working_on', 'looking_for', 'mentor_topics', 'notes', 'note', 'reviewer_notes', 'decision_notes',
    'admin_notes', 'private_comments', 'feedback_to_applicant', 'content', 'body', 'subject', 'co_presenter_info',
    'rejection_reason', 'traveler_notes', 'dossier', 'summary',
}
FILE_COLS = {'cv_file', 'support_letter_file', 'letter_file', 'photo_file', 'student_id_file',
             'original_filename', 'stored_filename', 'file_path', 'file_size', 'mime_type'}
JSON_BLOB_COLS = {'dossier_json', 'history_json', 'enc', 'payload_json', 'answers_json', 'custom_answers'}
SOCIAL_COLS = {'linkedin_url', 'twitter_handle', 'twitter_url', 'website_url', 'orcid_id', 'orcid',
               'photo_url', 'linkedin', 'website'}
HEALTH_COLS = {'dietary', 'dietary_requirements', 'dietary_notes', 'accessibility_needs', 'requests',
               'special_requests', 'accommodation', 'accommodation_needed', 'hotel_preference',
               'tshirt_size', 'availability'}
# tables where `notes`/`admin_notes` etc. are ABOUT the pseudonymised person (row-level, mapped rows only)
PERSON_NOTE_TABLES = {
    'gala_registrations', 'croatians_abroad_registrations', 'registrations', 'bridges_registrations',
    'forum_event_registrations', 'forum_reservations', 'volunteers', 'guest_passes', 'sponsors',
    'media_contacts', 'registrant_notes', 'registration_transfers', 'refund_requests', 'event_waitlist',
    'waitlist', 'event_feedback', 'event_survey_responses', 'testimonials',
}
# JSON keys scrubbed inside JSON cells anywhere (billing blocks in payment metadata etc.)
JSON_PII_KEY_RE = re.compile(r'phone|address|street|zip|postal|iban|bank|oib|vatnumber|vat_number|passport|birth|dob', re.I)
JSON_PII_KEY_KEEP_PREFIX = ('venue_', 'pharmacy_', 'hotel_', 'location_', 'company_', 'office_')
NAG_PERSON_KINDS = ('forum_candidate', 'forum_consideration', 'gala_unpaid', 'reg_unpaid', 'guest')

# Diacritic-insensitive matching for the full-name sweep (Croatian + common Latin variants)
FOLD_VARIANTS = {'c': 'cčć', 'd': 'dđ', 's': 'sš', 'z': 'zž', 'a': 'aáàâä', 'e': 'eéèêë',
                 'i': 'iíìîï', 'o': 'oóòôö', 'u': 'uúùûü', 'n': 'nñ', 'y': 'yý'}


# ----------------------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------------------
def q(ident):
    return '"' + ident.replace('"', '""') + '"'


def fold(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace('đ', 'd').replace('Đ', 'D').replace('ß', 'ss')
    return re.sub(r'\s+', ' ', s).strip().lower()


def name_pattern(name):
    """Regex that matches `name` case- and diacritic-insensitively, whole words only."""
    out = []
    for ch in name.strip():
        if ch.isspace():
            out.append(r'\s+')
        elif ch.isalpha():
            base = fold(ch)
            variants = FOLD_VARIANTS.get(base, base)
            out.append('[' + re.escape(variants) + re.escape(variants.upper()) + ']' if base in FOLD_VARIANTS else re.escape(ch))
        else:
            out.append(re.escape(ch))
    return r'(?<![\w])' + ''.join(out) + r'(?![\w])'


class Scrubber:
    def __init__(self, db, pw_hash, log):
        self.db = db
        self.pw_hash = pw_hash
        self.log = log
        self.touch = collections.Counter()      # (table, column, op) -> rows
        self.tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence' ORDER BY name")]
        self.cols = {t: [dict(cid=r[0], name=r[1], type=r[2], notnull=r[3], pk=r[5]) for r in db.execute(f'PRAGMA table_info({q(t)})')] for t in self.tables}
        self.email_map = {}          # lower real email -> pseudonym email
        self.nnn_of_email = {}       # lower real email -> NNN
        self.names_by_nnn = {}       # NNN -> set of real full-name strings (for the sweep)
        self.nnn_of_user = {}        # users.id -> NNN
        self.team = set()
        self.team_names = set()
        self.next_nnn = 1

    # ---------------- bookkeeping ----------------
    def count(self, table, col, op, n=1):
        if n:
            self.touch[(table, col, op)] += n

    def colnames(self, t):
        return [c['name'] for c in self.cols[t]]

    def notnull(self, t, c):
        return any(x['name'] == c and x['notnull'] for x in self.cols[t])

    def live_tables(self):
        return [t for t in self.tables if not t.startswith('_purged_')]

    # ---------------- pseudonym map ----------------
    def pseudo_email(self, nnn):
        return f'member{nnn:03d}@{STAGING_DOMAIN}'

    def pseudo_first(self, nnn):
        return f'Member {nnn:03d}'

    def pseudo_full(self, nnn):
        return f'Member {nnn:03d} Test'

    def keep_email(self, e):
        """Business/role mailboxes stay as they are."""
        if e in self.team:
            return True
        local, _, domain = e.partition('@')
        base = local.split('+')[0]
        if base in GENERIC_LOCALS:
            return True
        if base == domain.split('.')[0]:          # org@org.tld style organisation mailbox
            return True
        return False

    def assign(self, real_email, names=()):
        e = real_email.strip().lower()
        if e in self.email_map:
            nnn = self.nnn_of_email[e]
        else:
            nnn = self.next_nnn
            self.next_nnn += 1
            self.email_map[e] = self.pseudo_email(nnn)
            self.nnn_of_email[e] = nnn
        for n in names:
            n = re.sub(r'\s+', ' ', (n or '')).strip()
            if n:
                self.names_by_nnn.setdefault(nnn, set()).add(n)
        return nnn

    def lookup(self, value, create=True, names=()):
        """Return (nnn, pseudonym) for a personal email, or None if it is kept as-is."""
        if value is None:
            return None
        e = str(value).strip().lower()
        if not e or '@' not in e or e.endswith('@' + STAGING_DOMAIN):
            return None                      # already a pseudonym: never re-map
        if e in self.email_map:
            nnn = self.nnn_of_email[e]
            for n in names:
                n = re.sub(r'\s+', ' ', (n or '')).strip()
                if n:
                    self.names_by_nnn.setdefault(nnn, set()).add(n)
            return nnn, self.email_map[e]
        if self.keep_email(e) or not create:
            return None
        nnn = self.assign(e, names)
        return nnn, self.email_map[e]

    # ---------------- step 1: team + users ----------------
    def build_team(self):
        rows = self.db.execute("SELECT email, first_name, last_name FROM users WHERE is_admin=1 OR is_staff=1 OR is_founder=1").fetchall()
        self.team = {r[0].strip().lower() for r in rows}
        for r in rows:
            full = re.sub(r'\s+', ' ', f"{r[1] or ''} {r[2] or ''}").strip()
            if full:
                self.team_names.add(full)
        for (n,) in self.db.execute("SELECT name FROM team_members WHERE name IS NOT NULL"):
            self.team_names.add(re.sub(r'\s+', ' ', n).strip())
        return sorted(r[0] for r in rows)

    def scrub_users(self):
        t = 'users'
        cols = self.colnames(t)
        rows = self.db.execute("SELECT rowid, id, email, first_name, last_name FROM users ORDER BY created_at, id").fetchall()
        for rowid, uid, email, fn, ln in rows:
            e = (email or '').strip().lower()
            if e in self.team:
                continue
            full = re.sub(r'\s+', ' ', f"{fn or ''} {ln or ''}").strip()
            nnn = self.assign(e, [full])
            self.nnn_of_user[uid] = nnn
            sets = {'email': self.pseudo_email(nnn), 'first_name': self.pseudo_first(nnn)}
            if ln:
                sets['last_name'] = 'Test'
            for c in ('bio', 'photo_url'):
                if c in cols:
                    sets[c] = None
            self._update(t, rowid, sets, op='pseudonymise')
        # every account: staging password, verified, no pending tokens
        self._set_passwords(t)

    def _set_passwords(self, t):
        cols = self.colnames(t)
        sets = {'password_hash': self.pw_hash}
        for c, v in (('email_verified', 1), ('must_change_password', 0), ('verification_token', None),
                     ('reset_token', None), ('reset_token_expires', None)):
            if c in cols:
                sets[c] = v
        n = self.db.execute(f'SELECT count(*) FROM {q(t)}').fetchone()[0]
        self.db.execute(f'UPDATE {q(t)} SET ' + ', '.join(f'{q(c)}=?' for c in sets), list(sets.values()))
        for c in sets:
            self.count(t, c, 'set-staging-password' if c == 'password_hash' else 'set', n)

    def _update(self, t, rowid, sets, op):
        if not sets:
            return
        self.db.execute(f'UPDATE {q(t)} SET ' + ', '.join(f'{q(c)}=?' for c in sets) + ' WHERE rowid=?', list(sets.values()) + [rowid])
        for c in sets:
            self.count(t, c, op)

    # ---------------- step 2: every table with an email column ----------------
    def scrub_email_tables(self):
        for t in self.live_tables():
            if t == 'users':
                continue
            cols = self.colnames(t)
            email_cols = [c for c in cols if 'email' in c.lower()]
            if not email_cols:
                continue
            name_cols = [c for c in cols if c in PERSON_NAME_COLS or (c == 'name' and t in BARE_NAME_IS_PERSON)]
            sel = ['rowid'] + cols
            for row in self.db.execute(f'SELECT {", ".join(q(c) for c in sel)} FROM {q(t)}').fetchall():
                r = dict(zip(sel, row))
                # names in this row (for the free-text sweep) — attach to the row's primary email
                full_names = []
                if 'first_name' in cols or 'last_name' in cols:
                    full_names.append(f"{r.get('first_name') or ''} {r.get('last_name') or ''}")
                for c in name_cols:
                    # only unambiguous person columns seed the free-text sweep (recipient_/billing_/party_
                    # names are often institutions and must not be swept out of other rows)
                    if c in SWEEP_SEED_COLS and r.get(c):
                        full_names.append(str(r[c]))
                mapped = {}
                for c in email_cols:
                    hit = self.lookup(r.get(c), names=full_names if c == 'email' or len(email_cols) == 1 else ())
                    if hit:
                        mapped[c] = hit
                if not mapped:
                    continue
                primary = mapped.get('email') or next(iter(mapped.values()))
                sets = {c: hit[1] for c, hit in mapped.items()}
                if t in PUBLIC_TABLES and t != 'team_members':
                    # public content: personal email pseudonymised, public name kept
                    self._update(t, r['rowid'], sets, op='pseudonymise-email')
                    continue
                for c in name_cols:
                    if not r.get(c):
                        continue
                    nnn = primary[0]
                    for prefix, ecols in NAME_PREFIX_EMAIL:
                        if c.startswith(prefix):
                            for ec in ecols:
                                if ec in mapped:
                                    nnn = mapped[ec][0]
                                    break
                            break
                    if c.endswith('last_name'):
                        sets[c] = 'Test'
                    elif c.endswith('first_name'):
                        sets[c] = self.pseudo_first(nnn)
                    else:
                        sets[c] = self.pseudo_full(nnn)
                for c in cols:
                    v = r.get(c)
                    if v in (None, ''):
                        continue
                    if c in HEALTH_COLS or c in SOCIAL_COLS:
                        sets[c] = None
                    elif c in JSON_BLOB_COLS and (t in APPLICATION_TABLES or c in ('custom_answers', 'answers_json')):
                        # (scheduled_emails.payload_json is rebuilt by the hook instead — the drainer needs a payload)
                        sets[c] = PLACEHOLDER_JSON if self.notnull(t, c) else None
                    elif (t in APPLICATION_TABLES or t in PERSON_NOTE_TABLES) and c in STATEMENT_COLS:
                        sets[c] = PLACEHOLDER
                    elif t in APPLICATION_TABLES and c in FILE_COLS:
                        sets[c] = None if not self.notnull(t, c) else PLACEHOLDER
                self._update(t, r['rowid'], sets, op='pseudonymise')

    # ---------------- step 3: names/profiles keyed by FK ----------------
    def scrub_fk_names(self):
        reg_user = {}
        if 'registrations' in self.cols:
            for rid, uid, email in self.db.execute('SELECT id, user_id, email FROM registrations'):
                nnn = self.nnn_of_user.get(uid)
                if nnn is None and email:
                    hit = self.lookup(email, create=False)
                    nnn = hit[0] if hit else None
                reg_user[rid] = nnn
        for t, ncol, fk, target in FK_NAME_RULES:
            if t not in self.cols or ncol not in self.colnames(t) or fk not in self.colnames(t):
                continue
            for rowid, ref, val in self.db.execute(f'SELECT rowid, {q(fk)}, {q(ncol)} FROM {q(t)}'):
                if not val:
                    continue
                if target == 'users':
                    nnn = self.nnn_of_user.get(ref)
                    if nnn is None and ref and '@' in str(ref):
                        hit = self.lookup(ref, create=False)
                        nnn = hit[0] if hit else None
                elif target == 'registrations':
                    nnn = reg_user.get(ref)
                else:  # email
                    hit = self.lookup(ref, create=False)
                    nnn = hit[0] if hit else None
                if nnn is None:
                    continue
                sets = {ncol: self.pseudo_full(nnn)}
                if target == 'email':
                    sets[fk] = self.email_map[str(ref).strip().lower()]
                self._update(t, rowid, sets, op='pseudonymise-fk')
        for t, ucol in FK_PROFILE_TABLES.items():
            if t not in self.cols:
                continue
            cols = self.colnames(t)
            sel = ['rowid'] + cols
            for row in self.db.execute(f'SELECT {", ".join(q(c) for c in sel)} FROM {q(t)}').fetchall():
                r = dict(zip(sel, row))
                if r.get(ucol) not in self.nnn_of_user:
                    continue
                sets = {}
                for c in cols:
                    v = r.get(c)
                    if v in (None, ''):
                        continue
                    if c in HEALTH_COLS or c in SOCIAL_COLS or c in PERSON_NAME_COLS:
                        sets[c] = None
                    elif c in JSON_BLOB_COLS:
                        sets[c] = PLACEHOLDER_JSON if self.notnull(t, c) else None
                    elif c in STATEMENT_COLS:
                        sets[c] = PLACEHOLDER
                self._update(t, r['rowid'], sets, op='pseudonymise-fk')

    # ---------------- step 4: column-class PII / secrets ----------------
    def scrub_pii_columns(self):
        for t in self.live_tables():
            if t in PII_NULL_SKIP_TABLES:
                continue
            for c in self.colnames(t):
                lc = c.lower()
                hit = None
                if PHONE_RE.search(lc):
                    hit = 'null-phone'
                elif ADDRESS_RE.search(lc) and not lc.startswith(ADDRESS_KEEP_PREFIX):
                    hit = 'null-address'
                elif BANK_RE.search(lc):
                    hit = 'null-bank'
                elif ID_RE.search(lc):
                    hit = 'null-id-document'
                elif IP_RE.search(lc):
                    hit = 'null-ip'
                elif t in GEO_TABLES and lc in GEO_COLS:
                    hit = 'null-geo'
                if hit:
                    self._null_column(t, c, hit)
        # application-style tables: statements / documents for EVERY row (they are applicant data)
        for t in sorted(APPLICATION_TABLES):
            if t not in self.cols or t == 'forum_members':
                continue
            for c in self.colnames(t):
                if c in STATEMENT_COLS and c not in ('subject',):
                    self._placeholder_column(t, c, PLACEHOLDER)
                elif c in FILE_COLS:
                    self._null_column(t, c, 'null-document', fallback=PLACEHOLDER)
                elif c in JSON_BLOB_COLS:
                    self._null_column(t, c, 'null-json-blob', fallback=PLACEHOLDER_JSON)

    def _null_column(self, t, c, op, fallback=None):
        n = self.db.execute(f'SELECT count(*) FROM {q(t)} WHERE {q(c)} IS NOT NULL AND CAST({q(c)} AS TEXT)!=\'\'').fetchone()[0]
        if not n:
            return
        if self.notnull(t, c):
            if fallback is None:
                self.db.execute(f"UPDATE {q(t)} SET {q(c)}='scrubbed-' || rowid")
            else:
                self.db.execute(f'UPDATE {q(t)} SET {q(c)}=?', (fallback,))
        else:
            self.db.execute(f'UPDATE {q(t)} SET {q(c)}=NULL')
        self.count(t, c, op, n)

    def _placeholder_column(self, t, c, text):
        n = self.db.execute(f'SELECT count(*) FROM {q(t)} WHERE {q(c)} IS NOT NULL AND {q(c)}!=\'\' AND {q(c)}!=?', (text,)).fetchone()[0]
        if n:
            self.db.execute(f'UPDATE {q(t)} SET {q(c)}=? WHERE {q(c)} IS NOT NULL AND {q(c)}!=\'\'', (text,))
            self.count(t, c, 'placeholder', n)

    def scrub_secrets(self):
        for t in self.live_tables():
            cols = self.colnames(t)
            lcols = [c.lower() for c in cols]
            # push subscriptions -> delete rows
            if 'endpoint' in lcols and ({'p256dh', 'auth', 'keys'} & set(lcols)):
                n = self.db.execute(f'SELECT count(*) FROM {q(t)}').fetchone()[0]
                if n:
                    self.db.execute(f'DELETE FROM {q(t)}')
                    self.count(t, '*', 'delete-push-subscriptions', n)
                continue
            for c in cols:
                if c in SECRET_SKIP_COLS or c.endswith('_hash'):
                    continue
                if SECRET_RE.search(c):
                    self._null_column(t, c, 'null-secret')
            # key/value settings tables
            kcol = next((c for c in cols if c.lower() in KV_KEY_COLS), None)
            vcol = next((c for c in cols if c.lower() in KV_VALUE_COLS), None)
            if kcol and vcol and len(cols) <= 6:
                for rowid, k, v in self.db.execute(f'SELECT rowid, {q(kcol)}, {q(vcol)} FROM {q(t)}').fetchall():
                    if v not in (None, '') and SECRET_RE.search(str(k)) and str(k) not in SECRET_SKIP_COLS:
                        self._update(t, rowid, {vcol: None if not self.notnull(t, vcol) else ''}, op='null-secret-kv')
        # any other table with a password_hash column (applicant accounts etc.)
        for t in self.live_tables():
            if t != 'users' and 'password_hash' in self.colnames(t):
                if self.db.execute(f'SELECT count(*) FROM {q(t)}').fetchone()[0]:
                    self._set_passwords(t)

    # ---------------- step 5: table-specific hooks ----------------
    def scrub_hooks(self):
        # stored outbound emails: pseudonymised recipients lose the rendered body entirely
        if 'scheduled_emails' in self.cols:
            cols = self.colnames('scheduled_emails')
            for rowid, to, subject, payload in self.db.execute('SELECT rowid, recipient_email, subject, payload_json FROM scheduled_emails').fetchall():
                hit = self.lookup(to, create=False) if to else None
                if not payload:
                    continue
                try:
                    p = json.loads(payload)
                except Exception:
                    p = None
                if not isinstance(p, dict):
                    continue
                phit = self.lookup(p.get('to'), create=True) if p.get('to') else None
                if hit or phit:
                    nnn, pe = hit or phit
                    keep = {k: p[k] for k in ('channel', 'project', 'user_id') if k in p}
                    keep.update({'to': pe, 'subject': p.get('subject') or subject, 'html': f'<p>{PLACEHOLDER}</p>', 'body_text': PLACEHOLDER})
                    if 'guest_name' in p:
                        keep['guest_name'] = self.pseudo_full(nnn)
                    self._update('scheduled_emails', rowid, {'payload_json': json.dumps(keep, ensure_ascii=False)}, op='replace-body')
        # admin nag items: the "who" of person-kinds
        if 'nag_items' in self.cols:
            for rowid, kind, title, payload in self.db.execute('SELECT rowid, kind, title, action_payload_json FROM nag_items').fetchall():
                if not payload or not str(kind).startswith(NAG_PERSON_KINDS):
                    continue
                try:
                    p = json.loads(payload)
                except Exception:
                    continue
                who = p.get('who') or p.get('name')
                if not who or who in self.team_names or who == 'Unassigned':
                    continue
                repl = None
                to = p.get('to')
                if to:
                    hit = self.lookup(to, names=[who])
                    if hit:
                        repl = self.pseudo_full(hit[0])
                        p['to'] = hit[1]
                if repl is None:
                    fw = fold(who)
                    for nnn, names in self.names_by_nnn.items():
                        if any(fold(n) == fw for n in names):
                            repl = self.pseudo_full(nnn)
                            break
                if repl is None:
                    repl = 'Scrubbed Person'
                for k in ('who', 'name'):
                    if p.get(k):
                        p[k] = repl
                self._update('nag_items', rowid, {'action_payload_json': json.dumps(p, ensure_ascii=False),
                                                  'title': (title or '').replace(who, repl)}, op='pseudonymise-nag')
        # audit trail: IP addresses in login rows / delivery errors
        for t, c in (('audit_log', 'detail'), ('scheduled_emails', 'last_error')):
            if t in self.cols and c in self.colnames(t):
                n = 0
                for rowid, v in self.db.execute(f"SELECT rowid, {q(c)} FROM {q(t)} WHERE typeof({q(c)})='text'").fetchall():
                    nv = IPV4_RE.sub('0.0.0.0', v)
                    if nv != v:
                        self.db.execute(f'UPDATE {q(t)} SET {q(c)}=? WHERE rowid=?', (nv, rowid))
                        n += 1
                self.count(t, c, 'mask-ip', n)

    # ---------------- step 6: global text sweeps ----------------
    def sweep_text(self):
        # pass A: emails + token URLs + JSON PII keys, everywhere
        for t in self.live_tables():
            for c in self.colnames(t):
                n_email = n_tok = n_json = 0
                rows = self.db.execute(f"SELECT rowid, {q(c)} FROM {q(t)} WHERE typeof({q(c)})='text' AND ({q(c)} LIKE '%@%' OR {q(c)} LIKE '%token=%' OR {q(c)} LIKE '{{%' OR {q(c)} LIKE '[%' OR {q(c)} LIKE '%/verify/%' OR {q(c)} LIKE '%/magic/%')").fetchall()
                for rowid, v in rows:
                    nv = v
                    if '@' in nv:
                        def rep(m):
                            hit = self.lookup(m.group(0))
                            return hit[1] if hit else m.group(0)
                        nv2 = EMAIL_RE.sub(rep, nv)
                        if nv2 != nv:
                            n_email += 1
                            nv = nv2
                    for rx in URL_TOKEN_RES:
                        nv2 = rx.sub(r'\1SCRUBBED', nv)
                        if nv2 != nv:
                            n_tok += 1
                            nv = nv2
                    if nv[:1] in '{[':
                        nv2 = self._scrub_json_pii(nv)
                        if nv2 is not None and nv2 != nv:
                            n_json += 1
                            nv = nv2
                    if nv != v:
                        self.db.execute(f'UPDATE {q(t)} SET {q(c)}=? WHERE rowid=?', (nv, rowid))
                self.count(t, c, 'sweep-email', n_email)
                self.count(t, c, 'sweep-token-url', n_tok)
                self.count(t, c, 'sweep-json-pii', n_json)

    def _scrub_json_pii(self, text):
        try:
            obj = json.loads(text)
        except Exception:
            return None
        changed = [False]

        def walk(o):
            if isinstance(o, dict):
                for k, v in list(o.items()):
                    if isinstance(v, (str, int, float)) and v not in ('', None) and JSON_PII_KEY_RE.search(k) and not k.lower().startswith(JSON_PII_KEY_KEEP_PREFIX):
                        o[k] = ''
                        changed[0] = True
                    else:
                        walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(obj)
        return json.dumps(obj, ensure_ascii=False) if changed[0] else text

    def sweep_names(self):
        """Replace every pseudonymised person's full name in free text of non-content tables."""
        folded_to_repl = {}
        for nnn, names in self.names_by_nnn.items():
            for n in names:
                f = fold(n)
                if len(f) < 5 or ' ' not in f:
                    continue
                if any(f in fold(tn) for tn in self.team_names):
                    continue
                parts = f.split(' ')
                if len(parts) < 2 or min(len(p) for p in parts) < 2:
                    continue
                folded_to_repl.setdefault(f, self.pseudo_full(nnn))
        self.name_patterns = folded_to_repl
        if not folded_to_repl:
            return
        # longest first so "First Middle Last" wins over "First Last"
        alts = sorted(folded_to_repl, key=len, reverse=True)
        big = re.compile('|'.join(name_pattern(a) for a in alts), re.IGNORECASE)

        def rep(m):
            return folded_to_repl.get(fold(m.group(0)), m.group(0))
        for t in self.live_tables():
            if t in PUBLIC_TABLES:
                continue
            for c in self.colnames(t):
                n = 0
                for rowid, v in self.db.execute(f"SELECT rowid, {q(c)} FROM {q(t)} WHERE typeof({q(c)})='text' AND length({q(c)})>=5").fetchall():
                    nv = big.sub(rep, v)
                    if nv != v:
                        self.db.execute(f'UPDATE {q(t)} SET {q(c)}=? WHERE rowid=?', (nv, rowid))
                        n += 1
                self.count(t, c, 'sweep-name', n)

    # ---------------- step 7: schema-level defaults (DEFAULT '<email>' clauses) ----------------
    def patch_schema_emails(self):
        """CREATE TABLE ... DEFAULT 'person@x' clauses are part of the dump too; rewrite them
        with the same map (sqlite_master edit, validated by VACUUM + integrity_check)."""
        def rep(m):
            hit = self.lookup(m.group(0))
            return hit[1] if hit else m.group(0)
        patched = []
        for name, sql in self.db.execute("SELECT name, sql FROM sqlite_master WHERE sql LIKE '%@%'").fetchall():
            new = EMAIL_RE.sub(rep, sql)
            if new != sql:
                self.db.execute('PRAGMA writable_schema=ON')
                self.db.execute('UPDATE sqlite_master SET sql=? WHERE name=? AND sql=?', (new, name, sql))
                self.db.execute('PRAGMA writable_schema=RESET')
                patched.append(name)
                self.count(name, '<schema DEFAULT>', 'pseudonymise-schema-default')
        return patched

    # ---------------- step 8: drop backups ----------------
    def drop_purged(self):
        dropped = []
        for t in self.tables:
            if t.startswith('_purged_'):
                self.db.execute(f'DROP TABLE {q(t)}')
                dropped.append(t)
        return dropped


# ----------------------------------------------------------------------------------------
def bcrypt_hash(backend, password, given=None):
    node_dir = os.path.abspath(backend)
    if given is None:
        given = subprocess.run(['node', '-e', "const b=require('bcryptjs');process.stdout.write(b.hashSync(process.env.PW,10))"],
                               cwd=node_dir, env={**os.environ, 'PW': password}, capture_output=True, text=True, check=True).stdout.strip()
    ok = subprocess.run(['node', '-e', "const b=require('bcryptjs');process.stdout.write(String(b.compareSync(process.env.PW,process.env.H)))"],
                        cwd=node_dir, env={**os.environ, 'PW': password, 'H': given}, capture_output=True, text=True, check=True).stdout.strip()
    if ok != 'true':
        raise SystemExit('bcrypt hash does not verify against the staging password')
    return given


def sql_dump(path):
    """Plain SQL dump (Python's iterdump). The sqlite3 CLI >= 3.50 writes unistr('...') literals
    for text with control characters, which the libsql driver bundled with the portals rejects."""
    con = sqlite3.connect(path)
    text = 'PRAGMA foreign_keys=OFF;\n' + '\n'.join(con.iterdump()) + '\n'
    con.close()
    return text


def row_counts(path):
    db = sqlite3.connect(path)
    out = {}
    for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        out[t] = db.execute(f'SELECT count(*) FROM {q(t)}').fetchone()[0]
    db.close()
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sql-gz', default=None)
    ap.add_argument('--map-out', default=None)
    ap.add_argument('--report', default=None)
    ap.add_argument('--password', default=DEFAULT_PASSWORD)
    ap.add_argument('--hash', default=None, help='pre-computed bcrypt hash (skips node hashing)')
    ap.add_argument('--backend', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'user-portal', 'backend'))
    a = ap.parse_args()

    log = print
    for suffix in ('', '-wal', '-shm', '-journal'):
        try:
            os.unlink(a.out + suffix)
        except FileNotFoundError:
            pass
    shutil.copyfile(a.src, a.out)
    before = row_counts(a.out)
    pw_hash = bcrypt_hash(a.backend, a.password, a.hash)
    log(f'[hash] bcrypt cost-10 hash verified against the staging password')

    db = sqlite3.connect(a.out)
    db.execute('PRAGMA foreign_keys=OFF')
    s = Scrubber(db, pw_hash, log)
    team = s.build_team()
    log(f'[team] {len(team)} team accounts kept: ' + ', '.join(team))
    s.scrub_users()
    s.scrub_email_tables()
    s.scrub_fk_names()
    s.scrub_pii_columns()
    s.scrub_secrets()
    s.scrub_hooks()
    s.sweep_text()
    s.sweep_names()
    dropped = s.drop_purged()
    db.commit()
    db.isolation_level = None                 # autocommit for the schema edit + VACUUM
    patched = s.patch_schema_emails()
    db.close()
    db = sqlite3.connect(a.out, isolation_level=None)   # fresh connection re-parses the schema
    db.execute('PRAGMA journal_mode=DELETE')
    db.execute('VACUUM')
    integrity = db.execute('PRAGMA integrity_check').fetchone()[0]
    db.close()
    log(f'[drop] {len(dropped)} _purged_* tables dropped, schema DEFAULT emails patched in {patched}, VACUUM done, integrity={integrity}')

    # ---------------- verification ----------------
    after = row_counts(a.out)
    shrunk = {t: (before[t], after.get(t)) for t in before if after.get(t, 0) != before[t]}
    bad_shrink = {t: v for t, v in shrunk.items() if not (t.startswith('_purged_') or 'push' in t)}
    db = sqlite3.connect(a.out)
    n_users = db.execute('SELECT count(*) FROM users').fetchone()[0]
    n_staging = db.execute("SELECT count(*) FROM users WHERE email LIKE ?", (f'%@{STAGING_DOMAIN}',)).fetchone()[0]
    n_team = db.execute('SELECT count(*) FROM users WHERE is_admin=1 OR is_staff=1 OR is_founder=1').fetchone()[0]
    n_hash = db.execute('SELECT count(*) FROM users WHERE password_hash=?', (pw_hash,)).fetchone()[0]
    n_flags = db.execute('SELECT count(*) FROM users WHERE email_verified=1 AND COALESCE(must_change_password,0)=0 AND reset_token IS NULL AND verification_token IS NULL').fetchone()[0]
    # leftover name check inside the DB (non-content tables)
    name_left = 0
    if s.name_patterns:
        big = re.compile('|'.join(name_pattern(x) for x in sorted(s.name_patterns, key=len, reverse=True)), re.IGNORECASE)
        for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name!='sqlite_sequence'"):
            if t in PUBLIC_TABLES:
                continue
            for r in db.execute(f'PRAGMA table_info({q(t)})').fetchall():
                for (v,) in db.execute(f"SELECT {q(r[1])} FROM {q(t)} WHERE typeof({q(r[1])})='text'"):
                    if big.search(v):
                        name_left += 1
    db.close()

    dump = sql_dump(a.out)
    dump_l = dump.lower()
    leaked_mapped = [e for e in s.email_map if re.search(r'(?<![a-z0-9._%+\-])' + re.escape(e) + r'(?![a-z0-9.\-])', dump_l)]
    all_emails = {m.lower() for m in EMAIL_RE.findall(dump)}
    leftover_personal = sorted(e for e in all_emails if not e.endswith('@' + STAGING_DOMAIN) and not s.keep_email(e))
    consumer = sorted(e for e in all_emails if re.search(r'@(gmail\.com|yahoo\.|hotmail\.|outlook\.|icloud\.com|proton\.me|pm\.me|live\.)', e) and e not in s.team)
    kept_business = sorted(e for e in all_emails if not e.endswith('@' + STAGING_DOMAIN) and e not in s.team)
    secret_like = re.findall(r'(sk_live_|sk_test_|whsec_|xkeysib-|AKIA[0-9A-Z]{12,}|BEGIN (?:RSA |EC )?PRIVATE KEY)', dump)

    if a.sql_gz:
        os.makedirs(os.path.dirname(os.path.abspath(a.sql_gz)), exist_ok=True)
        with gzip.GzipFile(a.sql_gz, 'wb', compresslevel=9, mtime=0) as f:
            f.write(dump.encode('utf-8'))
    if a.map_out:
        with open(a.map_out, 'w', encoding='utf-8') as f:
            json.dump({'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'email_map': s.email_map,
                       'names_by_nnn': {str(k): sorted(v) for k, v in s.names_by_nnn.items()}}, f, ensure_ascii=False, indent=1)

    touched = collections.defaultdict(dict)
    for (t, c, op), n in sorted(s.touch.items()):
        touched[t][f'{c}:{op}'] = n
    report = {
        'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': os.path.abspath(a.src), 'out': os.path.abspath(a.out), 'sql_gz': a.sql_gz and os.path.abspath(a.sql_gz),
        'team_kept': team, 'pseudonyms': len(s.email_map), 'users_pseudonymised': len(s.nnn_of_user),
        'name_patterns_swept': len(s.name_patterns), 'dropped_tables': dropped, 'schema_defaults_patched': patched, 'integrity': integrity,
        'rows_before': before, 'rows_after': after, 'shrunk': shrunk, 'unexpected_shrink': bad_shrink,
        'users': {'total': n_users, 'staging': n_staging, 'team': n_team, 'staging_plus_team': n_staging + n_team,
                  'with_staging_hash': n_hash, 'login_ready_flags': n_flags},
        'dump': {'bytes': len(dump), 'gz_bytes': a.sql_gz and os.path.getsize(a.sql_gz), 'leaked_mapped_emails': leaked_mapped,
                 'leftover_personal_emails': leftover_personal, 'consumer_domain_emails_outside_team': consumer,
                 'business_or_role_emails_kept': kept_business, 'secret_like_strings': secret_like,
                 'names_left_in_non_content_tables': name_left},
        'touched': touched,
    }
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=1)

    log(f'[map] {len(s.email_map)} personal addresses pseudonymised ({len(s.nnn_of_user)} user accounts), {len(s.name_patterns)} full-name patterns swept')
    log(f'[users] total={n_users} staging={n_staging} team={n_team} -> {n_staging + n_team} ; staging-hash={n_hash} login-ready-flags={n_flags}')
    log(f'[rows] shrunk tables: {shrunk} ; unexpected: {bad_shrink}')
    log(f'[dump] {len(dump):,} bytes ; leaked mapped emails: {len(leaked_mapped)} ; leftover personal: {leftover_personal} ; consumer-domain outside team: {consumer} ; secret-like: {len(secret_like)} ; names left: {name_left}')
    ok = (not bad_shrink and n_staging + n_team == n_users and n_hash == n_users and n_flags == n_users
          and not leaked_mapped and not leftover_personal and not consumer and not secret_like and name_left == 0 and integrity == 'ok')
    log('[verify] ' + ('ALL CHECKS PASSED' if ok else 'CHECKS FAILED — see report'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
