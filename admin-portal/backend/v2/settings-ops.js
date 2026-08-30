/**
 * v2/settings-ops.js — small server pieces the redesigned SETTINGS screen needs beyond the
 * existing routes (team/invites/permissions, audit-log, system-health and team files all
 * already exist in server.js and are used as-is by the frontend). Mounted by v2/index.js.
 *
 *   v2_health_runs    — the "last run …" sentinel note on the SYSTEM HEALTH card: every explicit
 *                       RUN CHECKS records who ran the 24-check report and what it counted, so
 *                       the whole team sees one shared "last run today 14:02 · 17 OK · 7 TO CHECK"
 *                       line instead of a per-browser guess.
 *   v2_org_settings   — the ORGANISATION & PAYMENTS card (OIB · IBAN · FIRA key note). Stored
 *                       server-side per README note 15 ("everything saves, instantly"). The live
 *                       health checks read MEDX_IBAN / FIRA_API_KEY from the service environment —
 *                       these rows are the team's single reference for what ops must put there.
 */
'use strict';

const crypto = require('crypto');

module.exports = function mountSettingsOps(app, ctx) {
    const { db, auth, adminOnly, saveDb, log } = ctx;

    const q = {
        get(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, p = []) { db().run(sql, p); saveDb(); }
    };
    function audit(user, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), (user && user.id) || null, (user && user.email) || 'unknown', action, detail || null]);
            saveDb();
        } catch (e) { /* never break the action */ }
    }

    // Individually-guarded DDL with a retry: a transient SQLITE_BUSY while the other portal
    // boots on the same file must not silently cost a table.
    const DDL = [
        `CREATE TABLE IF NOT EXISTS v2_health_runs (
            id TEXT PRIMARY KEY,
            ran_at TEXT DEFAULT (datetime('now')),
            ok INTEGER DEFAULT 0, warn INTEGER DEFAULT 0, fail INTEGER DEFAULT 0,
            by_email TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS v2_org_settings (
            id TEXT PRIMARY KEY,
            oib TEXT, iban TEXT, fira_key TEXT,
            updated_at TEXT, updated_by TEXT
        )`
    ];
    let schemaReady = false;
    function ensureSchema() {
        if (schemaReady) return true;
        let ok = true;
        for (const sql of DDL) {
            try { db().run(sql); } catch (e) { ok = false; if (!/database is locked|SQLITE_BUSY/i.test(e.message)) console.error('[v2/settings-ops] schema:', e.message); }
        }
        schemaReady = ok;
        return ok;
    }
    ensureSchema();
    { let tries = 0; const t = setInterval(() => { if (ensureSchema() || ++tries >= 10) clearInterval(t); }, 4000); if (t.unref) t.unref(); }

    // ---- health sentinel ----
    app.get('/api/v2/settings/health-run', auth, (req, res) => {
        try {
            res.json({ last: q.get('SELECT * FROM v2_health_runs ORDER BY ran_at DESC, rowid DESC LIMIT 1') });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/v2/settings/health-run', auth, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const b = req.body || {};
            const n = v => Math.max(0, Math.min(999, parseInt(v, 10) || 0));
            q.run('INSERT INTO v2_health_runs (id, ok, warn, fail, by_email) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), n(b.ok), n(b.warn), n(b.fail), req.user.email || null]);
            try { q.run('DELETE FROM v2_health_runs WHERE id NOT IN (SELECT id FROM v2_health_runs ORDER BY ran_at DESC, rowid DESC LIMIT 50)'); } catch (e) {}
            res.json({ ok: true, last: q.get('SELECT * FROM v2_health_runs ORDER BY ran_at DESC, rowid DESC LIMIT 1') });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- organisation & payments ----
    app.get('/api/v2/settings/org', auth, adminOnly, (req, res) => {
        try {
            const row = q.get("SELECT * FROM v2_org_settings WHERE id = 'default'") || { id: 'default', oib: '', iban: '', fira_key: '' };
            res.json({
                oib: row.oib || '', iban: row.iban || '', fira_key: row.fira_key || '',
                updated_at: row.updated_at || null, updated_by: row.updated_by || null,
                // what the live service actually runs with (the health checks read the env, not this table)
                env: { iban_set: !!(process.env.MEDX_IBAN && String(process.env.MEDX_IBAN).trim()), fira_set: !!(process.env.FIRA_API_KEY && String(process.env.FIRA_API_KEY).trim()) }
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.put('/api/v2/settings/org', auth, adminOnly, (req, res) => {
        try {
            if (!schemaReady) ensureSchema();
            const b = req.body || {};
            const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
            const oib = clean(b.oib, 20), iban = clean(b.iban, 40).replace(/\s+/g, ' '), fira = clean(b.fira_key, 120);
            if (oib && !/^\d{11}$/.test(oib)) return res.status(400).json({ error: 'An OIB has exactly 11 digits.' });
            if (iban && !/^[A-Z]{2}[0-9A-Z ]{13,40}$/i.test(iban)) return res.status(400).json({ error: 'That does not look like an IBAN (HR + digits).' });
            const now = new Date().toISOString();
            if (q.get("SELECT 1 x FROM v2_org_settings WHERE id = 'default'")) {
                q.run("UPDATE v2_org_settings SET oib = ?, iban = ?, fira_key = ?, updated_at = ?, updated_by = ? WHERE id = 'default'",
                    [oib, iban, fira, now, req.user.email]);
            } else {
                q.run("INSERT INTO v2_org_settings (id, oib, iban, fira_key, updated_at, updated_by) VALUES ('default',?,?,?,?,?)",
                    [oib, iban, fira, now, req.user.email]);
            }
            audit(req.user, 'settings.org', `OIB ${oib ? 'set' : '—'} · IBAN ${iban ? iban.slice(0, 4) + '…' : '—'} · FIRA ${fira ? 'set' : '—'}`);
            res.json({ ok: true, updated_at: now });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    log('settings-ops: health sentinel + org settings ready');
};
