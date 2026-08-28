# Med&X Member Portal — Claude Code handoff notes

Running notes captured during design review. Include these in the implementation spec.

## Admin-portal-driven content (must be editable from the admin portal)
- Home "next event" panel: event name, dates, venue, status label, countdown target, CTA labels.
- Home news items (Latest from Med&X) + Key dates list (names + dates).
- Project cards (statuses like PRE-REGISTRATION OPEN / BY INVITATION, dates, metas).
- Plexus program list (Program & Speakers page + overview at-a-glance): rows of {date/time, title, note} — conference days, networking events (welcome reception), Gala. Admin adds/edits rows; "program in preparation" empty state shows until published.
- Speakers list (name, role, institution, portrait, institution logo, confirmed flag).
- Hero photos everywhere (rotating set on Home).

## Contact = in-portal messaging, not email
- Every "MESSAGE US" button opens portal chat/messaging tied to the logged-in member (identity known server-side; replies land in portal inbox, visible in admin portal). Email is fallback only.

## Registration model
- Plexus Conference registration is FREE (both days + welcome reception). The Gala Evening seat (EUR 150) is the only paid add-on.
- After registering (and paying, if Gala), the member's QR pass appears in: My Plexus, My Med&X wallet, phone wallets (Apple/Google).
- One QR opens all doors: the member-card QR encodes identity + all current registrations; per-event tickets also exist, but the member QR must admit them to anything they're registered for.

## Attendance / share cards
- No "Share your Med&X" section in the portal. Instead: when a member registers (and pays where applicable), the system AUTO-GENERATES their attendance card ("I'm attending Plexus 2026" etc., branded) and EMAILS it to them. Same idea for year-in-review card (sent at year end).

## Tickets (My Med&X wallet)
- Per-ticket actions: Download PDF, Email to me, Add to wallet (Apple/Google).
- Current tickets vs Past purchases are two tabs; receipts downloadable from past purchases.

## Misc
- Plexus is in its 9th year (not 10th).
- No abstract submissions for Plexus 2026 — feature removed.
- Profile completion: when profile is complete, the Home profile nudge disappears and the next-event countdown panel expands full-width.

## Accelerator specifics
- "My Application" embeds the EXISTING application system from the current portal: 7-step wizard (Personal, Education, Program, Supplementary, Documents, Consent, Review) with the Application Checklist sidebar and % complete. Do not rebuild — reuse/embed it, restyled to the brand.
- Before applications open: "Get notified" capture. Results lookup by emailed access code (AX26-XXXX format).
- Host institutions list (name, city, positions, blurb, logo) is admin-editable.
- No "Ask the coordinators" form — coordinator questions go through the standard in-portal MESSAGE US chat.

## Gala specifics
- Two featured performers are confirmed; names announced closer to December (admin flips them from TBA to named).
- Emphasize limited seating everywhere; registration/RSVP is the same external form as Plexus (Render app) — one form, pick conference and/or Gala.
