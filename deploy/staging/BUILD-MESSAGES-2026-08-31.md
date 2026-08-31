# Messages upgrade — build notes (2026-08-31)

The four asks from the Laura + Miro team review (TEAM-REVIEW-CONSOLIDATED-2026-08.md § "Messages":
staff identity on replies · canned replies · MESSAGE US context tag · attachments). Built and
verified locally — **nothing deployed, no git, no emails, no live DB touched** (all DDL is
guarded in code and runs at the next boot).

## Files touched (the owned set)

- `user-portal/backend/v2/messages.js` — schema, attach route, attachment on team sends, sender_name in payloads
- `user-portal/frontend-v2/js/views/messages.js` — staff attribution, ?about= tag, real ATTACH flow
- `user-portal/frontend-v2/css/views/messages.css` — attachment overflow guards (responsive only)
- `admin-portal/backend/v2/inbox.js` — reply-with-identity route, canned CRUD + seeds, attach route + file serving
- `admin-portal/frontend-v2/js/views/inbox.js` — member-messages tab only: attribution, SAVED REPLIES picker, attach
- href strings only (allowed): `gala.js`, `bridges.js`, `accelerator.js` (×2), `plexus.js` (×2), `forum.js`

## 1 · Staff identity on replies

- Guarded column `direct_messages.sender_name TEXT` (added identically in both backends).
- New `POST /api/v2/inbox/threads/:key/reply` inserts the reply with the signed-in admin's real
  name (users.first/last → email local-part → "Med&X Team") and mirrors the legacy route's
  push_outbox enqueue. The legacy `POST /api/admin/messages` is untouched (v1 UI keeps working).
- Member view: admin bubbles are attributed **"LAURA · MED&X"**; rows from before the column
  existed show **"MED&X TEAM"** (COPY.team.meta — the old anonymous "MED&X COORDINATORS" label is
  gone). Admin conversation shows the same attribution line on staff bubbles, plus a
  "Replying as <name> · Med&X" note under the composer.

## 2 · Canned replies (admin)

- Table `v2_canned_replies (id, title, body, updated_at, updated_by)` — admin-portal only.
- CRUD: `GET/POST /api/v2/inbox/canned`, `PUT/DELETE /api/v2/inbox/canned/:id`.
- Seeds 6 drafts **only when the table is empty** (mentor letter · invoice-for-my-clinic — says
  the račun comes from FIRA automatically after payment, per the standing FIRA-only rule ·
  dietary requirements · bringing a partner · is-the-conference-free · travel costs).
- UI: "SAVED REPLIES" button next to the reply box opens a picker modal — click drops the body
  into the reply box (`{first_name}` → the member's first name), with in-place add/edit/delete.
  The reply box became a textarea (Enter sends, Shift+Enter newline) so multi-paragraph drafts fit.

## 3 · Context tag (MESSAGE US)

- Member messages view accepts `?about=<tag>` (gala, plexus, bridges, accelerator, forum) as an
  alias of the existing `?topic=` — preselects the team topic chip, opens the composer focused;
  the send stamps `direct_messages.topic`, which the admin thread list already renders as a chip.
- Hrefs extended: gala → `?about=gala`, bridges → `?about=bridges`, accelerator (2 links) →
  `?about=accelerator`; the untagged MESSAGE US links on Plexus (2) and Forum (1) now carry
  `?about=plexus` / `?about=forum`. `?topic=` deep links keep working.

## 4 · Attachments (replaces the "Attachments are on their way" stub)

- Guarded columns `direct_messages.attachment_path / attachment_name TEXT` (both backends).
- `POST /api/v2/messages/attach` on **both** backends (member JWT / admin JWT): multipart `file`,
  ONE image (jpg/png/webp/gif) or PDF, ≤ 5 MB — multer → magic-byte sniff → disk, mirrored from
  `v2/profile.js` (Cloudinary `medx/messages` when CLOUDINARY_URL is set; production without it
  hits the existing server-wide 503 multipart gate, same as the profile photo).
- Files land in ONE shared dir under `ctx.ROOT`: `user-portal/backend/uploads/messages/` —
  the member portal serves it via its existing hardened `/uploads` static route; the admin
  backend mirrors the same URL path (`GET /uploads/messages/:name`) with the same headers
  (attachment + nosniff + sandbox CSP) plus CORP `cross-origin` for Netlify-hosted thumbnails.
  Staging runs both backends from one tree (launcher.js), so one path works on both origins;
  production stores on Cloudinary, so the URL is absolute anyway.
- Send flow (both UIs): pick file (label-wrapped hidden input — avoids the ui.bind
  preventDefault trap that killed the profile photo chooser) → chip with ✕ → on SEND upload
  first, then the message POST carries `attachment_path/attachment_name`. Text-less sends are
  allowed when a file is attached. Both UIs render image thumbnails + a named download chip;
  thread lists preview "⊕ <name>" for file-only messages.
- Scope note: attachments ride member→team and admin→member messages. Member↔member DMs stay
  text-only (their send is the legacy `POST /api/messages`, which is outside the owned files);
  the ATTACH control simply doesn't render on 1:1 threads.

## Shared-DB discipline

- New table `v2_canned_replies` is touched by the admin side only (so no cross-file CREATE).
- The four `ALTER TABLE direct_messages ADD COLUMN …` statements are verbatim identical in
  `user-portal/backend/v2/messages.js` and `admin-portal/backend/v2/inbox.js`; the
  `v2_message_thread_state` CREATE remains verbatim identical as before. Nothing renamed/dropped.

## Verification (all green)

- `node --check` on all 9 touched JS files · `require()` of both backend modules · existing
  `scripts/check-api-contract.js` still passes.
- 31/31 integration checks via a throwaway harness (scratch sqlite DB + scratch uploads root,
  both modules mounted on real express apps, real multipart HTTP): schema columns; 6 canned
  seeds incl. the FIRA wording; canned CRUD + validation; png/pdf uploads; >5 MB → 413; wrong
  type and spoofed MIME → 400; foreign `attachment_path` dropped; team send stamps topic +
  attachment; attachment-only sends OK, empty sends still 400; admin threads expose topic +
  attachment preview; reply stores `sender_name` "Laura Rodman" + queues a push; admin origin
  serves `/uploads/messages/*` with the hardening headers and blocks traversal; member payloads
  carry `sender_name` on new replies and null on legacy rows; unread counts, mark-read and
  thread ordering unchanged.

## For the staging deploy (when it happens — not done here)

Nothing to migrate by hand: columns/table/seeds self-install at boot. Redeploy both portals
(deploy-v2.sh / deploy-admin-v2.sh) so the shared columns exist before the first reply is sent.
Known cosmetics: on cross-origin staging (Netlify → Render) the *member* portal's thumbnails may
be CORP-blocked by the existing helmet defaults on its static /uploads route (not owned here) —
the named download chip always works; the admin mirror route already sends CORP cross-origin.
Uploaded-but-never-sent files are rare orphans in uploads/messages/ (uuid names, ≤5 MB) — same
posture as chat uploads.
