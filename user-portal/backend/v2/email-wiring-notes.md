# Email wiring notes — the transactional set (2026-08-30)

Where each new builder in `v2/email-templates.js` should be wired **later**. Nothing below is
wired yet — these are the trigger points, with `file:line` references into
`user-portal/backend/server.js` and `user-portal/backend/v2/*` as of 2026-08-30 (line numbers
drift with edits; the quoted route/function names are the durable anchors).

Ground rules that hold at every wiring point:

- **Invoices only via FIRA.** `paymentReceived` references the FIRA fiscal invoice **number**
  only. No wiring may generate an invoice document in portal code — the invoice itself is issued
  by `firaService.createFiscalInvoice()` (`fira-service.js`) and reaches the guest from FIRA.
- **Locale.** Every builder takes `locale` — pass `memberLocale(user)` where a user row exists
  (see `server.js:13734`, i18n cluster HR1), or the event/form language where it does not
  (`signupFormLang(form)`).
- **Send rails.** Direct sends go through `sendEmail()` (`server.js:75`) or
  `sendEventConfirmation()` (`server.js:147`, CCs laura.rodman by default). Engine sends are
  **staged** into `scheduled_emails` (payload_json `{to, subject, html}`) — transactional rows
  as `status='scheduled'`, marketing-ish nags as `status='pending_approval'` — and drained by
  the outbox drainer (admin portal in prod; `drainScheduledEmailsDev` at `server.js:29706` in dev).
- Existing legacy `buildEmailTemplate(...)` bodies at these points should be **replaced** by the
  branded builder, keeping subject, recipients, attachments, idempotency guards and logging
  exactly as they are.

---

## 1 · paymentReceived — Stripe webhook, one call per paid branch

All six fulfillment branches live inside `POST /api/stripe/webhook` (`server.js:20282`,
`checkout.session.completed` from `server.js:20323`). Each already mints/knows the FIRA invoice
number and sends a legacy "Payment Confirmed" email — swap the body for
`paymentReceived({ firstName, amountLabel: '€…', invoiceNumber, itemsLabel, qrPngUrl?, locale })`.

1. **Accelerator fee** branch (`metadata.type === 'accelerator-fee'`, `server.js:20328`) —
   legacy email at `server.js:20411`; FIRA number `AX-…` minted at `server.js:20357`.
   `itemsLabel: 'Accelerator 2026 · processing fee'`, amount €75, no QR.
2. **Gala Evening** branch (`metadata.type === 'gala-ticket'`, `server.js:20440`) — legacy email
   at `server.js:20506`; invoice number from `metadata.invoice_number` (`server.js:20442`);
   `qrPngUrl: qrImageUrl(galaRegId)` (`qrImageUrl` at `server.js:501`).
3. **Forum event** branch (`metadata.type === 'forum-event'`, `server.js:20566`) — legacy email
   at `server.js:20637`; FIRA call at `server.js:20597`.
4. **Croatians Abroad — the CA branch** (`metadata.type === 'croatians-abroad-gala'`,
   `server.js:20750`) — the big legacy confirmation at `server.js:20858` (`caSend`); invoice
   `CA-GALA-…` minted at `server.js:20771`; FIRA call at `server.js:20803`. This branch also
   carries the ticket/QR duty, so either keep `ticketConfirmation` for the ticket and add
   `paymentReceived` as the receipt, or pass `qrPngUrl` here and send one email — decide at
   wiring time, do not send two QRs. Keep the loud `[EMAIL-FAIL]` check at `server.js:20876`.
5. **Invite-link payment** (`server.js:20940`) — legacy email at `server.js:21055` (`invSend`);
   invoice from `metadata.invoice_number` (`server.js:21001` FIRA call).
6. **Plexus conference payment** (`server.js:21085`) — legacy email at `server.js:21200`;
   invoice `metadata.invoice_number` (`server.js:21087`); FIRA call at `server.js:21154`.

All branches sit behind the webhook's global idempotency guard (`processed_stripe_events`,
`server.js:20305`) — no extra dedup needed.

## 2 · paymentReminder — the unpaid-registration rail

No reminder engine exists yet for unpaid registrations; three places to hang it:

7. **`POST /api/registrations`** (`server.js:12452`) creates the rows this reminder targets:
   `status='pending'`, `payment_status='unpaid'`, `invoiceNumber` minted at `server.js:12477`,
   response `status:'pending_payment'` at `server.js:12489`. A new
   `runPaymentReminders()` should scan `registrations WHERE payment_status='unpaid'` (age > 48h,
   max 1–2 nudges via `drip_log` kinds `payrem_1:<regId>` / `payrem_2:<regId>`) and stage
   `paymentReminder({...})` as `pending_approval`. `payUrl`: the portal registration surface
   (`PORTAL_BASE_URL() + '/app/me'`) unless a fresh checkout-session link is minted at send time.
8. **Home for the engine**: right beside `runSignupFormReminders()` (`server.js:29435`, hourly
   interval at `server.js:29482`) — same shape, same outbox, same `saveDb()` discipline.
9. **NAG→DO Action Center** (`nag_items` schema `server.js:9730`) — the admin daily scan writes
   "unpaid registrations" items whose one-click DO action queues an approval-gated reminder;
   that executor (admin portal) should render THIS builder so both paths send the same letter.

## 3 · registrationCancelled / seatTransferred / transferReceived

10. **Admin cancel + refund** — `POST /api/admin/payments/:kind/:id/refund` (`server.js:736`,
    kinds gala / forum-event / conference). Replace the plain-text refund email at
    `server.js:780` with `registrationCancelled({ firstName: row.first_name, eventName, locale })`
    (the template already carries the 5–10-business-days refund line).
11. **Guest-pass revoke** — `POST /api/guest-passes/:id/revoke` (`server.js:12950`) cancels the
    linked ticket at `server.js:12957` and today tells the guest nothing; optionally send
    `registrationCancelled` to `pass.guest_email` when the invite had already gone out
    (it pulls unapproved outbox rows at `server.js:12960` — only email if that UPDATE matched 0).
12. **Ticket transfer — request** is member-initiated at
    `POST /api/plexus/registration/:regId/transfer` (`server.js:21628`): inserts
    `registration_transfers` `status='pending'` (`server.js:21650`) with `orig_*` snapshot and
    `new_user_email` / `recipient_first_name`. No email here (it is only a request).
13. **Ticket transfer — execution** is the wiring point for BOTH letters. The approval step is
    not in this repo yet — the admin queue reads pending transfers at `server.js:22662`
    (`GET /api/admin/plexus/pending`) and the execution rail is prepared
    (`registration_transfers.reassigned_at` + `ticket_transfer_audit`, `server.js:10115–10130`).
    Wherever the approve/execute route lands (this file, near the pending queue, or the admin
    portal), on success send, from the SAME transaction that flips the registration:
    - `seatTransferred({ firstName: orig_first_name, toName: new_user_name, eventName, locale })`
      → `orig_email`;
    - `transferReceived({ firstName: recipient_first_name, fromName: orig name, eventName,
      qrPngUrl: qrImageUrl(reg.id), walletSaveUrl?, appleWalletUrl?, calendarUrl?, locale })`
      → `new_user_email`. Wallet URLs come from the per-ticket pass route
      `GET /api/v2/wallet/tickets/:id/pass` (`v2/wallet.js:683`; Google `save_url`, Apple
      tokenized `.pkpass` via `v2/apple-pass.js`), calendar from the .ics rail (`server.js:3005`).

## 4 · eventReminder — T-7 / T-2

14. **`runSignupFormReminders()`** (`server.js:29435`) is the live reminder engine: offsets
    `[7, 2, 0]` at `server.js:29437`, per-guest legacy HTML at `server.js:29455–29470`, staged
    `pending_approval` at `server.js:29471`. Replace the inline `buildEmailTemplate` with
    `eventReminder({ firstName: g.name, eventName: form.title, whenLines, venueLines,
    daysOut: off, qrPngUrl: base + '/qr/' + g.id + '.png', locale: signupFormLang(form) })` for
    offsets 7 and 2 (the builder's 2-day variant leads with the QR). Day-of (offset 0) keeps its
    short text or reuses the 2-day variant — decide at wiring time. Keep the opt-out check
    (`emailOptedOut(g.email,'reminders')`, `server.js:29451`) and the per-batch dedup.
15. **Plexus/gala reminders** ride the confirm-seat rail (`seat_confirmations` schema
    `server.js:9771`, `reminder_sent_at` at `server.js:9780`) — that engine runs in the ADMIN
    portal against the shared DB; it should render this same builder for its T-2 pass.

## 5 · Accelerator letters

16. **acceleratorReceived** — `POST /api/accelerator/intake/:id/submit` (`server.js:16874`).
    The confirmation is already enqueued exactly-once (drip kind `acc_submit:<id>`,
    `server.js:16895`) into `scheduled_emails` at `server.js:16925` — replace the legacy
    `buildEmailTemplate(subject, body, loc)` at `server.js:16924` with
    `acceleratorReceived({ firstName: req.user.first_name, locale: loc })`.
17. **acceleratorDecision** — decisions are recorded by
    `PUT /api/admin/accelerator/applications/:id/review` (`server.js:19560`, sets
    `status/decision` accepted | rejected | under_review at `server.js:19565–19570`) — today it
    emails nothing. Stage the letter here (or in the admin portal's decision round), rendering
    `acceleratorDecision({ firstName, accepted: decision === 'accepted', locale })`.
    **Hard contract:** the applicant portal reveals a decision ONLY after its letter is `sent` —
    the gate at `server.js:16825–16838` checks
    `scheduled_emails WHERE source_engine='accelerator-decision' AND batch_id='acc-decision-'+subId AND status='sent'`
    (`server.js:16831`). The staged row MUST carry exactly that `source_engine` and `batch_id`,
    or accepted/declined cards stay stuck at "under review" forever. Note: the pipeline also has
    a `waitlisted` status (`server.js:16829`) — this builder covers accepted/rejected; a
    waitlist letter is a separate follow-up when needed.

## 6 · forumInvitation

18. **`emailInvite()` in `v2/forum.js:197`** — the single sender behind both
    `POST /api/v2/forum/invites` (`v2/forum.js:441`, mints `FRM-XXXX-XXXX`, emails at
    `v2/forum.js:453`) and `POST /api/v2/forum/invites/:id/send` (resend, `v2/forum.js:468`,
    emails at `v2/forum.js:476`). Replace its hand-built `emailShell(...)` body with
    `forumInvitation({ firstName: first, code: invite.code, enterUrl: url, locale })` — `url` is
    already built at `v2/forum.js:199` (`/app/auth/forum-code?code=…`), expiry text can move into
    an `inviterLine`-style sentence or stay in the footer. Codes are redeemed at
    `v2/forum.js:277` (check) and `v2/forum.js:288` (redeem).
19. **Legacy admin invitation routes** — `POST /api/admin/forum/invitations/send`
    (`server.js:18125`), `/send-bulk` (`server.js:18145`), `/:id/resend` (`server.js:18169`)
    write `forum_invitations` rows (codes minted at `server.js:18131` and `server.js:18154`) but
    never actually email — the TODO comment sits at `server.js:18140`. Wire
    `forumInvitation({ firstName: prospect.first_name, code: invitation_code, enterUrl, locale })`
    there; those legacy codes already redeem through the v2 lookup (`v2/forum.js:156`).

## 7 · certificateOfAttendance

20. **First issue on pull** — `GET /api/plexus/my-certificate` (`server.js:22383`) creates the
    `certificates` row on first request (`INSERT` at `server.js:22401`). When the row is newly
    created, also send `certificateOfAttendance({ firstName, eventName: reg.conference_name,
    downloadUrl: PORTAL_BASE_URL() + '/api/v2/wallet/certificates/' + cert.id + '.pdf', locale })`
    — the PDF route is `GET /api/v2/wallet/certificates/:id.pdf` (`v2/wallet.js:751`).
21. **Post-event round** — the admin portal's round issues certificate rows and stages the cert
    batch into the shared outbox (marker `post_event_log` kind `cert`, schema `server.js:9843`);
    that stager should render THIS builder with the same wallet PDF `downloadUrl`.

## 8 · surveyMorningAfter

22. **The micro-survey rail** — invites are staged by the ADMIN portal's post-event round
    (comments at `server.js:9831–9841` and `server.js:10209`) against the shared tables:
    per-guest tokens live in `event_survey_responses` (schema `server.js:10214`). The stager
    should render `surveyMorningAfter({ firstName, eventName, surveyUrl, locale })` with
    `surveyUrl` the tokenized tap link answered by THIS portal's public endpoints:
    `GET /api/public/survey` (`server.js:12237`), `GET /api/public/survey/recommend`
    (`server.js:12260`), `POST /api/public/survey/comment` (`server.js:12279`); thank-you page
    at `server.js:2631`.
23. **Signup-form events (local option)** — a morning-after sibling of
    `runSignupFormReminders()` (`server.js:29435`): scan `signup_forms WHERE event_date =
    yesterday`, guests who checked in, stage this builder `pending_approval` with a fresh token
    row per guest. Timing note: "morning after" means schedule `scheduled_for` at ~09:00
    Europe/Zagreb the day after `event_date`, never at midnight.

---

**Total: 23 wiring points** (6 webhook payment branches · 3 payment-reminder · 4
cancellation/transfer · 2 event-reminder · 2 accelerator · 2 forum-invitation · 2 certificate
· 2 survey). Nothing has been wired — `v2/email-templates.js` only gained the builders, and every
existing export renders byte-identically.

## Tone rule (Alen 2026-09-02)
Every participant-facing confirmation opens WARM: a 'Dear …, we are happy to have you at …' / 'thank you for joining us' sentence before the logistics. Plain language over mechanics — never 'the door counts your party in as you arrive'; say 'the QR below is the entry for both of you'. Applies when wiring the template set.
- Never call Building Bridges an "evening" (its format/time may change) — say "Building Bridges" alone.
- Never say "all three evenings" for the Plexus Week combo — say "all three events".
