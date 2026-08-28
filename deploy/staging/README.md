# Staging (review) environment — Med&X portals

**Purpose.** A review copy of BOTH portal backends that the redesigned front ends can be
clicked against without touching production, real email, or Stripe. Built 2026-08-28 for the
member-portal redesign review.

## Shape ($0 — Render free instance)
```
Netlify: member redesign (v2)  ──┐                       ┌── member backend :3000 ─┐
Netlify: admin review (proxy)  ──┼─► Render web service ─┤                         ├─ one SQLite file
direct: https://<service>.onrender.com   (launcher.js)    └── admin backend  :3001 ─┘   (seeded per cold start)
        /__admin/*  → admin backend        /__staging/health  /__staging/emails
```
- `launcher.js` — starts both backends with one shared `DATABASE_PATH`, proxies `$PORT`,
  answers `503 {waking:true}` while booting, serves the dumped-email outbox.
- `build-seed.js` — build step: `seed.sql.gz` → `seed.db` (libsql driver).
- `seed.sql.gz` — scrubbed copy of the 2026-08-28 production dump (see `SEED-NOTES.md`:
  members pseudonymized, team accounts kept, every password = the staging password, all
  tokens/secrets nulled). Regenerate with `scrub-seed.*` from a newer nightly dump
  (`gh run download <Turso nightly backup run> -R alen-ops99/medx-portal`).

## Render service (created via API, plan `free`)
- Repo `alen-ops99/medx-portal`, branch `redesign/member-portal`, root dir `.`
- Build: `cd user-portal/backend && npm install && cd ../../admin-portal/backend && npm install && cd ../.. && node deploy/staging/build-seed.js`
- Start: `node deploy/staging/launcher.js` · health check `/__staging/health`
- Env: `JWT_SECRET` (fixed, so sessions survive restarts), `STAGING_MEMBER_URL` (Netlify member site),
  `STAGING_ADMIN_URL` (Netlify admin site), `CORS_ORIGIN` (comma list of both Netlify origins).
  Nothing else — no Turso, Brevo, Stripe, Sheets, FIRA, Cloudinary keys, by design.

## Free-plan facts to remember
- Spins down after 15 min idle; cold start ≈ 1–2 min (two backends on 0.1 vCPU); **the disk is
  ephemeral, so test data written by reviewers resets at every cold start** (content comes back
  from the seed). A persistent staging DB needs a Turso platform token (`turso auth token`).
- 750 free instance-hours/month per workspace, shared with `medx-gateway`.

## Never
- Never point staging at `TURSO_DATABASE_URL` of production.
- Never merge this folder's Render config into the production services.
