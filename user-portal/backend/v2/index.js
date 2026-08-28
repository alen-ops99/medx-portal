/**
 * user-portal/backend/v2/ — backend additions for the redesigned member portal (frontend-v2).
 *
 * Convention (so several engineers can work in parallel without touching server.js):
 *   - one file per feature area: v2/<feature>.js exporting `module.exports = function (app, ctx) { … }`
 *   - register routes under /api/v2/<feature>/… (never reuse an existing /api path)
 *   - ctx = { db, auth, adminOnly, optionalAuth, sendEmail, JWT_SECRET, ROOT, log }
 *       db()        → the live sql.js-compatible wrapper (see shared/db.js): db().prepare(sql).bind([...]).step()/getAsObject()/free(), db().run(sql, params)
 *       auth        → member-JWT middleware (req.user = { id, email, is_admin … })
 *       adminOnly   → after auth; is_admin only
 *       optionalAuth→ sets req.user when a token is present, never rejects
 *       sendEmail   → (to, subject, html) — on staging it is dumped to EMAIL_DUMP_DIR
 *   - schema: CREATE TABLE IF NOT EXISTS / ALTER TABLE … ADD COLUMN inside a try/catch at
 *     module load (both portals share ONE database — prefix new tables with `v2_`, never
 *     rename or drop existing columns)
 *   - every route validates input, returns JSON, and never throws (wrap in try/catch → 500 JSON)
 * Mounted once from server.js inside initializeApp(), just before the /api/* 404 handler.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function mountV2(app, ctx) {
    const dir = __dirname;
    const files = fs.readdirSync(dir).filter(f => /^[a-z0-9-]+\.js$/.test(f) && f !== 'index.js').sort();
    const log = ctx.log || ((...a) => console.log('[v2]', ...a));
    let mounted = 0;
    for (const f of files) {
        try {
            require(path.join(dir, f))(app, { ...ctx, log });
            mounted++;
        } catch (e) {
            console.error(`[v2] failed to mount ${f}: ${e.message}`);
        }
    }
    app.get('/api/v2/_status', (req, res) => res.json({ ok: true, modules: files, mounted }));
    log(`mounted ${mounted}/${files.length} v2 module(s): ${files.join(', ') || 'none yet'}`);
};
