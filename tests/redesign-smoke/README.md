# Redesign smoke suite — user portal

The gate every redesigned user-portal build must pass before it is shown. Ten journeys
exercise the portal's **behavioral contracts** — routes, API responses, localStorage keys,
URL params, and `data-*` contract attributes from `design/IMPLEMENTATION_CONTRACT.md` —
never CSS classes or visual selectors, so a full visual redesign should pass untouched
as long as the wiring survives.

Location note: this folder deliberately lives at repo-root `tests/` (NOT under
`user-portal/`), because `render.yaml`'s `buildFilter` deploys on any `user-portal/**`
or `admin-portal/**` change — committing here does not trigger a portal deploy.

## Run it

```bash
# against the local scratch instance (default)
python3 tests/redesign-smoke/run.py

# against a redesign branch build on another port
BASE_URL=http://localhost:4000 python3 tests/redesign-smoke/run.py

# machine-readable (JSON on stdout, table on stderr); exit code = number of FAILs
python3 tests/redesign-smoke/run.py --json
```

Requirements: `python3` with `playwright` installed (same setup as
`tests/wallet-checkin-ui.py` — no new dependencies).

### Running against a redesign branch build

1. Boot the redesigned build against a **scratch DB** (never the production Turso DB —
   the suite creates ZZSMOKE rows and performs one real form login).
2. Make sure the scratch DB has the standard seed account
   `juginovic.alen@gmail.com` / `admin123` with at least one conference registration
   (the TICKET-QR journey needs an existing row), or point `SMOKE_EMAIL` /
   `SMOKE_PASSWORD` at an equivalent seeded member.
3. `BASE_URL=http://localhost:<port> python3 tests/redesign-smoke/run.py`
4. Green = exit 0. Any FAIL is a redesign regression against a shipped contract —
   fix the build, not the suite.

Env vars: `BASE_URL`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `MEDX_TOKEN` (fallback JWT if
the form login can't run), `SKIP_LOGIN=1` (skip the login journey, use `MEDX_TOKEN`),
`HEADED=1` (visible browser for debugging).

## The journeys

| # | Journey | Contract asserted |
|---|---------|-------------------|
| 1 | LOGIN | Form login → `POST /api/auth/login` 200 → token persisted under **`medx_user_token`** → `/api/auth/me` 200. UI is found by role/text (Get Started / Sign In) + input types, not markup. |
| 2 | DASHBOARD | A seeded session boots the SPA: ≥2 core data endpoints (`/api/registrations/my`, `/api/rewards/summary`, `/api/member/meta`, `/api/feed(/home)`, `/api/auth/me`) return 200, **no 5xx**, non-empty rendered content, session key never dropped. |
| 3 | PLEXUS REGISTRATION | `/plexus`: select the FREE conference card via its **`data-key="conference"`** contract attribute, submit ZZSMOKE data → `POST /api/croatians-abroad/register` 200 + `{success, id}`, confirmed UI state, row verified via `/qr/<id>.png` + `GET /api/admin/plexus-experience/registrations`. |
| 4 | TICKET / QR | `#mymedx` hash deep-link renders an existing registration (matched by its API `conference_name`); hosted `GET /qr/<regId>.png` → 200 `image/png` (URL embedded in already-sent emails — must survive forever). |
| 5 | GALA CHECKOUT | `POST /api/gala/checkout-session`: with Stripe keys → checkout URL (or 404 for an unknown id — proves wiring without paying); without keys → the clean 400 `Stripe is not configured`. |
| 6 | DONATE CHECKOUT | `GET /donate/checkout?amount=25&frequency=once&designation=plexus` → 302/303 to Stripe, or to `medx.hr/donate?checkout_error=1` when keys are absent — either proves the route. |
| 7 | ACCELERATOR DRAFT | Draft save + re-read persistence via API. Uses `POST /api/accelerator/intake/draft` + `/mine` when the intake window is **open**; otherwise the ungated `POST /api/accelerator/applications` (status `draft`) + `/api/accelerator/my-applications`. |
| 8 | PROFILE | `PUT /api/auth/profile` round-trip: change institution → `/api/auth/me` shows it → restore original → verified restored. |
| 9 | SERVER PAGES | `/plexus`, `/donor-night`, `/building-bridges`, `/forum`, `/invite-cancelled` each answer 200 with non-trivial HTML (all are linked from sent emails). |
| 10 | AUTH GUARDS | Member-only APIs reject an invalid Bearer token with 401. Missing-token behavior is also probed: 401 in production config; on a local scratch (`NODE_ENV=development`, no Turso) the app **deliberately** dev-auto-logs-in, which the suite accepts and labels. |

## Rate limits (why the suite is shaped this way)

- `POST /api/auth/login` is limited to **15 attempts / 15 min / IP** — the suite performs
  exactly ONE form login per run. If you trip the limit (e.g. many runs back-to-back),
  rerun with `SKIP_LOGIN=1 MEDX_TOKEN=<jwt>`.
- Registration endpoints allow 20 / 10 min / IP — one ZZSMOKE registration per run is
  far under it.

## Data the suite leaves behind (scratch DB only)

Every mutation is tagged `ZZSMOKE` with a unique per-run epoch suffix:

- One `croatians_abroad_registrations` row (source `plexus`, email
  `zzsmoke-<epoch>@smoke.medx.test`, notes-tagged "safe to delete") **plus the user row
  auto-created for that email**. The user portal has no member-facing delete/cancel for
  these — rows are left and are filterable by the `zzsmoke-` email prefix.
- One `accelerator_applications` draft (`ZZSMOKE-<epoch> Institute`) when the intake
  window is closed; one `submission_pipeline` draft when it is open. No owner delete
  route exists for either.
- The profile journey fully restores the original values; login/QR/checkout journeys
  write nothing durable (the gala journey posts a nonexistent id on purpose).

This is why the suite must only ever point at scratch builds.

## KNOWN-FAILs

None currently. If a journey fails because of a real app defect (not a suite bug), add
its journey name to `KNOWN_FAILS` in `run.py` with a reason, document it here, and
report it — a KNOWN-FAIL does not count toward the exit code.

## Last verified

2026-08-10 against `http://localhost:3018` (local scratch): **10 pass, 0 fail** on two
consecutive runs (replayability confirmed), `--json` output and non-zero exit on an
unreachable target both verified.
