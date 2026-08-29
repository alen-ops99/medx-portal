# Med&X Portal Overhaul — Lessons Learned

## Architecture

### 2026-02-25: Codebase Reconnaissance
- **DB sync is file-based**: Both portals share `../../shared/medx_portal.db`. After writes, `saveDb()` exports to disk. `watchSharedDb()` detects changes from other portal. Writes within 2s of own save are ignored.
- **Any schema change must go in BOTH server.js files**: New tables and ALTER TABLE statements need to be duplicated in admin-portal AND user-portal server.js.
- **sql.js is in-memory SQLite**: Entire DB loaded into RAM. No true concurrent writes. File watching is the sync mechanism.
- **Secrets come from env, fail-closed**: JWT_SECRET (and Stripe/Resend/FIRA/Turso/VAPID keys) are read from the environment; in production the server exits if JWT_SECRET is unset (no hardcoded fallback). Set them in Render / a local .env.
- **User portal logo is CDN-dependent**: Uses a Squarespace CDN URL that could break. Should be local.
- **Both portals seed on startup**: CREATE TABLE IF NOT EXISTS + seed data runs every time. Idempotent but can mask issues.

### 2026-02-25: Document Type Key Chaos (Found & Fixed)
- **There were 4 different naming conventions** for the same 20 accelerator document types across the codebase: Croatian keys (user frontend), long English keys (admin frontend), short English keys (both backends main), and abbreviated keys (both backends embedded portal).
- **Root cause**: Each document type array was created independently in each file without coordination.
- **Fix**: Unified all arrays to match the backend `DOCUMENT_TYPES` canonical keys (e.g., `domovnica`, `student_status`, `transcript`, `motivation`, `recommendation`, etc.)
- **Lesson**: When renaming internal identifiers in one file, ALWAYS grep all files for the old AND new names to check for cross-file consistency. The backends define the canonical keys; frontends must match.
- **Also found**: Unescaped apostrophes in `Dean's Award` / `Rector's Award` caused a JS SyntaxError that would have broken the entire Accelerator module. Always check for quote escaping when translating text into single-quoted JS strings.

## Print / PDF generation (Event Print Suite, 2026-07-07)

### headless Chrome -> PDF
- **@page size in mm makes the PDF page the physical size**, but Chrome quantises to device px so expect ~0.1-0.2mm rounding (e.g. 1000mm -> 1000.2mm). Verify with round-to-nearest-mm, not exact pt equality.
- **Chrome `--headless=new --print-to-pdf` does NOT reliably self-exit** — the request hangs waiting on the process. Don't use execFile-and-wait; spawn, poll for a stable (size-unchanged) output file, then SIGKILL and resolve. Use a unique `--user-data-dir` per render to avoid profile-lock conflicts between concurrent renders.
- Large pages work fine (2000mm = 5669pt, well under the 14400pt/200in PDF limit).
- Prod (Render) has no Chrome — gate cleanly (`print_engine_unavailable`) and expose CHROME_PATH; local dev has `/Applications/Google Chrome.app/...`.

### QR codes in PDF
- **`qrcode` npm `toString({type:'svg'})` is STROKE-based and renders faint / undecodable at higher module counts** (near-white on a page). Build the QR yourself from `QRCode.create(text).modules` as filled 1x1 rects with a 4-module quiet zone and `shape-rendering:crispEdges` — crisp, vector, reliably scannable. Higher ECC = more modules = worse with the stroke SVG, so this bit me after "improving" ECC M->Q.
- Verify a QR by rasterising the PDF (pymupdf) and decoding with **zxing-cpp** (pyzbar/opencv segfault or are absent in this env; install zxing-cpp in a throwaway venv — PEP 668 blocks system pip).

### Cross-portal signed tokens
- **render.yaml gives each portal its OWN `generateValue: true` JWT_SECRET** — they do NOT share a secret in prod. A token signed by the admin portal will NOT verify on the user portal. For anything cross-portal (e.g. admin-minted /verify badge tokens), store a shared secret in the mirrored `rewards_settings(key,value)` KV (both portals read the same DB) and have the verifier accept BOTH the shared secret and its legacy JWT_SECRET (backward compatible).

### Misc
- **Bash tool cwd resets between calls, and a `cd` inside a compound command changes cwd for the rest of that command** — a later relative `cp admin-portal/...` after `cd .../backend` silently fails. Use absolute paths.
- Print-shop convention reconciled: badges are sheet-trimmed (page = A4 with per-badge bleed + crop marks); large-format roll-ups/backdrops are made at the exact ordered size, so page = the named size with INWARD 3mm bleed + trim marks (satisfies both "3mm bleed + crop marks" and "banner PDF = 100x200cm").

- 2026-07-17 (signup-forms build): shared tables MUST go INSIDE the SCHEMA-MIRROR:BEGIN/END markers in BOTH server.js files, byte-identical including comments — CI (Boot smoke → scripts/check-schema-sync.sh) fails the deploy gate otherwise. Run the script locally before any schema push.
- 2026-07-17 (guest-pass build): admin-portal/ contains a VESTIGIAL NESTED .git repo — a commit run with cwd inside admin-portal/ lands there silently (wrong identity, no origin). Always run git from the MedX repo ROOT. Also: table name guest_passes is TAKEN (member +1 guest tickets) — the VIP capability links live in vip_passes.

## 2026-07-20 — fake-content sweeps need a person-name gate
The broken-things sweep found ~25 separate fabricated organs in the member portal
(fake people, fake stats, fake-success buttons). Six auditor agents + adversarial
verify still missed a second layer (static Timeline program, My Events demo card,
Forum projects, Today's Match) that only surfaced when a live browser pass compared
rendered names against reality and a follow-up trace walked every remaining
fabricated-name hit. LESSON: for demo-mockup-turned-product codebases, the finisher
gate is a plain grep for person-name patterns (Dr./Prof. + FirstName LastName) over
SERVED files, then a reachability verdict per hit — auditors organized by feature
area will miss organs that sit outside any feature's happy path. Also: fixes via
raw bash/python rewrites invalidate the Edit tool's read state — re-Read before
mixing the two.

## 2026-08-28 — member portal redesign build
- Money: NEVER create paid infra without asking (EC2 attempt cancelled; rule saved to memory). Use Render free + Netlify + Turso free.
- Netlify sites created via API ship the "Built with Netlify" HUD badge iframe bottom-right — it COVERS page controls; disable `built_with_badge_enabled` via PATCH /sites/:id on every new site.
- zsh eats `?` in unquoted args (route lists) — quote them.
- sqlite3 ≥3.50 `.dump` emits unistr() that libsql rejects — dump via Python iterdump.
- Admin server.js had a no-WHERE forum_events UPDATE running at EVERY boot (same class as the EUR-0 ticket-zeroing bug). Now app_state-guarded on the branch; prod main still has it.
