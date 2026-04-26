/**
 * sql.js → libsql compatibility wrapper for Turso migration.
 *
 * Creates a database object that exposes the sql.js API (db.run, db.prepare with
 * .bind/.step/.getAsObject/.free) but uses libsql (better-sqlite3 fork) under the hood.
 * When TURSO_DATABASE_URL is configured, the local SQLite file syncs to Turso cloud
 * via embedded replicas — data persists across Render deploys.
 *
 * Usage:
 *   const { createDatabase } = require('../../shared/db');
 *   db = createDatabase({ localPath, syncUrl, authToken });
 */

function createDatabase(Database, opts = {}) {
    const { localPath, syncUrl, authToken } = opts;

    // Open libsql database (with optional Turso sync)
    const openOpts = {};
    if (syncUrl && authToken) {
        openOpts.syncUrl = syncUrl;
        openOpts.authToken = authToken;
    }
    const rawDb = new Database(localPath, openOpts);

    // Enable WAL mode for better concurrent read/write performance
    try { rawDb.pragma('journal_mode = WAL'); } catch (e) {}

    // Initial sync: pull latest data from Turso
    if (syncUrl && authToken) {
        try {
            rawDb.sync();
            console.log('[Turso] Initial sync complete');
        } catch (e) {
            console.error('[Turso] Initial sync failed:', e.message);
        }
    }

    // Tracks the changes count of the most recent run() so callers can use
    // db.getRowsModified() after a parameterized UPDATE — needed by the
    // atomic promo-code claim pattern in both backends. libsql does not
    // expose this method natively (sql.js did), so we polyfill it here.
    let _lastRunChanges = 0;

    // sql.js-compatible facade
    const wrapper = {
        /**
         * sql.js: db.run(sql) for DDL, db.run(sql, [params]) for DML
         * libsql: db.exec(sql) for DDL, db.prepare(sql).run(...params) for DML
         */
        run(sql, params) {
            if (params && params.length > 0) {
                const result = rawDb.prepare(sql).run(...params);
                _lastRunChanges = (result && typeof result.changes === 'number') ? result.changes : 0;
                return result;
            }
            _lastRunChanges = 0; // exec() returns no changes count
            return rawDb.exec(sql);
        },

        /** sql.js polyfill — count of rows modified by the most recent run() with params */
        getRowsModified() { return _lastRunChanges; },

        /**
         * sql.js: db.prepare(sql) → { bind, step, getAsObject, free, run }
         * libsql: db.prepare(sql) → { get, all, run }
         *
         * Returns a shim that translates the sql.js iteration pattern
         * (bind → step → getAsObject → free) to libsql's batch pattern.
         */
        prepare(sql) {
            const stmt = rawDb.prepare(sql);
            let boundParams = [];
            let rows = null;
            let cursor = -1;

            return {
                bind(params) {
                    boundParams = params || [];
                    rows = null;
                    cursor = -1;
                    return this;
                },
                step() {
                    if (rows === null) {
                        rows = stmt.all(...boundParams);
                    }
                    cursor++;
                    return cursor < rows.length;
                },
                getAsObject() {
                    return rows[cursor] || {};
                },
                free() {
                    // libsql handles finalization automatically — no-op
                },
                // Direct run (used by admin portal for batch inserts)
                run(params) {
                    if (Array.isArray(params)) {
                        return stmt.run(...params);
                    }
                    return stmt.run(params);
                }
            };
        },

        /**
         * sql.js: db.export() → Uint8Array (full DB serialized)
         * libsql: not needed — data lives on disk + Turso cloud
         */
        export() {
            return new Uint8Array(0);
        },

        /** Close the database */
        close() {
            rawDb.close();
        },

        /** Push local changes to Turso + pull remote changes */
        sync() {
            if (syncUrl && authToken) {
                try {
                    rawDb.sync();
                } catch (e) {
                    console.error('[Turso] Sync error:', e.message);
                }
            }
        },

        /** Expose raw libsql db for edge cases */
        _raw: rawDb
    };

    return wrapper;
}

module.exports = { createDatabase };
