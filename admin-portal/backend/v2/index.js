/**
 * admin-portal/backend/v2/ — backend additions for the redesigned ADMIN portal (frontend-v2).
 *
 * Convention (mirrors user-portal/backend/v2/ so several engineers work in parallel
 * without touching the 43k-line server.js):
 *   - one file per feature area: v2/<feature>.js exporting `module.exports = function (app, ctx) { … }`
 *   - register routes under /api/v2/<feature>/… (never reuse an existing /api path)
 *   - ctx = { db, auth, adminOnly, sendEmail, saveDb, JWT_SECRET, ROOT, log }
 *       db()      → the live sql.js-compatible wrapper (shared/db.js idioms)
 *       auth      → admin-JWT middleware; adminOnly → after auth
 *       sendEmail → (to, subject, html, …) — dumped to EMAIL_DUMP_DIR on staging
 *   - schema: CREATE TABLE IF NOT EXISTS / ALTER TABLE … ADD COLUMN in try/catch at load;
 *     new tables prefixed `v2_`; both portals share ONE database — never rename or drop
 *   - every route validates input, returns JSON, never throws (try/catch → 500 JSON)
 * Mounted once from server.js just before the /api 404 handler.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function mountAdminV2(app, ctx) {
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter(f => /^[a-z0-9-]+\.js$/.test(f) && f !== 'index.js').sort();
    const log = ctx.log || ((...a) => console.log('[admin-v2]', ...a));
    let mounted = 0;
    for (const f of files) {
        try {
            require(path.join(dir, f))(app, { ...ctx, log });
            mounted++;
        } catch (e) {
            console.error(`[admin-v2] failed to mount ${f}: ${e.message}`);
        }
    }
    app.get('/api/v2/_status', (req, res) => res.json({ ok: true, side: 'admin', modules: files, mounted }));
    log(`mounted ${mounted}/${files.length} admin v2 module(s): ${files.join(', ') || 'none yet'}`);
};
