# Sign-up Forms — verification report (2026-07-17)

Feature: premium Google-Forms-style signup forms for short events (networking evenings, workshops).
Commits: `a50d65e` (schema + admin API), `5530301` (admin module), `4b7a08e` (public page + submit + email + QR).
All three deployed to Render (both services) and confirmed live.

## Verified locally (same code as deployed, dev-auth, ports 4500/4501)

| Check | Result |
|---|---|
| Create form from admin, editor opens, title focused | PASS |
| Settings save + reload persistence (title, date, time, venue, capacity, project tag) | PASS |
| All 5 question types + required flags + options + reorder, persisted via API | PASS |
| Draft form → public link shows branded 404 | PASS |
| QR PNG served while draft (560×560, real PNG) | PASS |
| Open → public page renders (EN): eyebrow, serif title, facts strip, all questions in order | PASS |
| Native required (name/email) + custom required validation with inline highlight | PASS |
| Happy-path submit → success card with admin confirmation message | PASS |
| Duplicate email → 409 friendly message, no second row | PASS |
| Capacity 2: second signup OK, third → "event is full" (409) | PASS |
| Waitlist enabled → amber note + "Join the waiting list" + `waitlisted: true` | PASS |
| Closed status → "Sign-ups are closed" card | PASS |
| Past deadline (Zagreb wall clock) → closed card + submit blocked (410) | PASS |
| Invalid option / missing consent → 400 with correct codes | PASS |
| Confirmation emails: EN confirmed ×2, EN waitlist ×1, HR confirmed ×1 (mock mode, correct subjects) | PASS |
| Admin Responses tab: counts strip (2/2 + 1 waitlist), question columns, waitlist badge, 10s polling | PASS |
| CSV export: correct columns incl. question labels, answers, waitlist, GDPR, timestamps | PASS |
| XLSX export: valid Excel 2007+ file | PASS |
| Croatian form: lang=hr, HR chrome (Ime i prezime, Prijavite se, Suglasan/suglasna, HR date format), HR success card, HR email subject | PASS |
| Mobile 390px: no horizontal overflow, card fits, premium layout | PASS |
| Admin inline scripts: 8 parse clean (matches pre-change baseline) | PASS |

## Verified live (Render)

| Check | Result |
|---|---|
| medx-user-portal.onrender.com/f/&lt;unknown&gt; → branded 404 page (new shell) | PASS |
| /f/&lt;unknown&gt;/qr.png → 404 | PASS |
| Admin API /api/admin/signup-forms → 401 without token (endpoint live, auth intact) | PASS |
| Admin SPA serves SignupFormsApp (module present in live HTML) | PASS |
| User SPA + admin SPA still load normally (no regression) | PASS |

## Not yet exercised live (needs an admin login)

- Creating the first real form on the live admin and one live public submit. Everything below the login is the exact code verified above.
- Live confirmation emails send for real only once `RESEND_API_KEY` is set on Render (standing owner action). Until then they mock-log and signups still work.

## Artifacts

- `public-mobile-390.png` — public page at iPhone width (waitlist state)
- `public-desktop.png` — public page at 1440px
- `admin-builder-questions.png` — builder with all question types
- `admin-responses.png` — responses tab with counts + waitlist badge

## Note

Old local history (stale clone since June 10) is preserved on branch `backup/pre-sync-2026-07-17`, including a ~460-line June WIP that is almost certainly superseded by the June–July remote work.
