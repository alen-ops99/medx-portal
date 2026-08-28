#!/usr/bin/env node
/**
 * deploy/staging/build-seed.js — turn the committed scrubbed dump (seed.sql.gz) into
 * seed.db at BUILD time (build machines have CPU; the free runtime has ~0.1 vCPU).
 * The launcher copies seed.db into the ephemeral data dir on every cold start.
 *
 * Uses the same libsql driver the portals use (installed under user-portal/backend).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(__dirname, 'seed.sql.gz');
const OUT = path.join(__dirname, 'seed.db');

if (!fs.existsSync(SRC)) {
    console.log(`[build-seed] no ${path.basename(SRC)} in the repo — skipping (Turso mode: the staging database itself is the seed)`);
    process.exit(0);
}
const Database = require(path.join(ROOT, 'user-portal', 'backend', 'node_modules', 'libsql'));
for (const suffix of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(OUT + suffix); } catch (e) {} }

const sql = zlib.gunzipSync(fs.readFileSync(SRC)).toString('utf8');
const t0 = Date.now();
const db = new Database(OUT);
db.exec(sql);
db.pragma('journal_mode = DELETE'); // single file, safe to copy
const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n;
const users = (() => { try { return db.prepare('SELECT count(*) AS n FROM users').get().n; } catch (e) { return '?'; } })();
db.close();
console.log(`[build-seed] ${path.basename(OUT)}: ${tables} tables, ${users} users, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB, ${Date.now() - t0} ms`);
