# Med&X Portal Overhaul — Lessons Learned

## Architecture

### 2026-02-25: Codebase Reconnaissance
- **DB sync is file-based**: Both portals share `../../shared/medx_portal.db`. After writes, `saveDb()` exports to disk. `watchSharedDb()` detects changes from other portal. Writes within 2s of own save are ignored.
- **Any schema change must go in BOTH server.js files**: New tables and ALTER TABLE statements need to be duplicated in admin-portal AND user-portal server.js.
- **sql.js is in-memory SQLite**: Entire DB loaded into RAM. No true concurrent writes. File watching is the sync mechanism.
- **No .env files**: All config is hardcoded with defaults. JWT secret = 'medx-portal-secret-key-2026'.
- **User portal logo is CDN-dependent**: Uses a Squarespace CDN URL that could break. Should be local.
- **Both portals seed on startup**: CREATE TABLE IF NOT EXISTS + seed data runs every time. Idempotent but can mask issues.

### 2026-02-25: Document Type Key Chaos (Found & Fixed)
- **There were 4 different naming conventions** for the same 20 accelerator document types across the codebase: Croatian keys (user frontend), long English keys (admin frontend), short English keys (both backends main), and abbreviated keys (both backends embedded portal).
- **Root cause**: Each document type array was created independently in each file without coordination.
- **Fix**: Unified all arrays to match the backend `DOCUMENT_TYPES` canonical keys (e.g., `domovnica`, `student_status`, `transcript`, `motivation`, `recommendation`, etc.)
- **Lesson**: When renaming internal identifiers in one file, ALWAYS grep all files for the old AND new names to check for cross-file consistency. The backends define the canonical keys; frontends must match.
- **Also found**: Unescaped apostrophes in `Dean's Award` / `Rector's Award` caused a JS SyntaxError that would have broken the entire Accelerator module. Always check for quote escaping when translating text into single-quoted JS strings.
