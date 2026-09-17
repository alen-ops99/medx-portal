#!/usr/bin/env node
/**
 * Merged duplicate /plexus registrations (shared/ca-merge.js) — 2026-09-17.
 *
 * Fifteen people registered twice before the one-person-one-registration guard; each attempt
 * emailed its own QR. The duplicate is never cancelled: it points at the survivor, its legs read
 * 'merged' (never counted), and every id-based reader follows the pointer so the older QR still
 * admits the same person once. Hermetic: node:sqlite scratch tables, no server boot.
 */
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const caMerge = require('../shared/ca-merge.js');
const program = require('../user-portal/backend/plexus-program.js');

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE croatians_abroad_registrations (
    id TEXT PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, created_at TEXT,
    selected_conference INTEGER DEFAULT 0, selected_bridges INTEGER DEFAULT 0, selected_gala INTEGER DEFAULT 0,
    conference_status TEXT, bridges_status TEXT, gala_status TEXT, gala_payment_status TEXT, gala_registration_id TEXT,
    guest_count INTEGER DEFAULT 0, notes TEXT)`);
const get = (sql, params = []) => db.prepare(sql).get(...params) || null;
const run = (sql, params = []) => db.prepare(sql).run(...params);

let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };

// ensureColumn is idempotent and safe on a table that already has the column
check('ensureColumn adds merged_into once and tolerates a second call', () => {
    caMerge.ensureColumn(sql => db.exec(sql));
    caMerge.ensureColumn(sql => db.exec(sql));
    const cols = db.prepare("SELECT name FROM pragma_table_info('croatians_abroad_registrations')").all().map(r => r.name);
    assert.strictEqual(cols.filter(c => c === 'merged_into').length, 1);
});

// A: first attempt (abandoned gala), B: second attempt, paid — A merged into B
run(`INSERT INTO croatians_abroad_registrations (id,email,first_name,last_name,created_at,selected_conference,selected_bridges,selected_gala,conference_status,bridges_status,gala_status,notes)
     VALUES ('aaa','x@y.z','Ana','Prva','2026-09-15 15:16',1,1,1,'merged','merged','merged','MERGED-INTO bbb 2026-09-17')`);
run(`UPDATE croatians_abroad_registrations SET merged_into='bbb' WHERE id='aaa'`);
run(`INSERT INTO croatians_abroad_registrations (id,email,first_name,last_name,created_at,selected_conference,selected_bridges,selected_gala,conference_status,bridges_status,gala_status,gala_registration_id)
     VALUES ('bbb','x@y.z','Ana','Prva','2026-09-15 15:27',1,1,1,'pre-registered','pre-registered','confirmed','g-bbb')`);
run(`INSERT INTO croatians_abroad_registrations (id,email,first_name,last_name,created_at,selected_conference,conference_status)
     VALUES ('solo','s@y.z','Solo','Row','2026-09-01 10:00',1,'pre-registered')`);

check('isMerged reads the pointer', () => {
    assert.strictEqual(caMerge.isMerged(get('SELECT * FROM croatians_abroad_registrations WHERE id=?', ['aaa'])), true);
    assert.strictEqual(caMerge.isMerged(get('SELECT * FROM croatians_abroad_registrations WHERE id=?', ['bbb'])), false);
});

check('followMerge: the older duplicate resolves to the survivor row', () => {
    const a = get('SELECT * FROM croatians_abroad_registrations WHERE id=?', ['aaa']);
    const s = caMerge.followMerge(get, a);
    assert.strictEqual(s.id, 'bbb');
    assert.strictEqual(s.conference_status, 'pre-registered');
});

check('followMerge: a live row returns itself, a broken pointer returns the row it has', () => {
    const b = get('SELECT * FROM croatians_abroad_registrations WHERE id=?', ['bbb']);
    assert.strictEqual(caMerge.followMerge(get, b).id, 'bbb');
    run(`INSERT INTO croatians_abroad_registrations (id,email,created_at,merged_into) VALUES ('orphan','o@y.z','2026-09-01',' missing-id')`);
    assert.strictEqual(caMerge.followMerge(get, get('SELECT * FROM croatians_abroad_registrations WHERE id=?', ['orphan'])).id, 'orphan');
});

check('followMerge: a cycle cannot loop forever', () => {
    run(`INSERT INTO croatians_abroad_registrations (id,email,created_at,merged_into) VALUES ('c1','c@y.z','2026-09-01','c2')`);
    run(`INSERT INTO croatians_abroad_registrations (id,email,created_at,merged_into) VALUES ('c2','c@y.z','2026-09-01','c1')`);
    const r = caMerge.followMerge(get, get('SELECT * FROM croatians_abroad_registrations WHERE id=?', ['c1']));
    assert.ok(r && (r.id === 'c1' || r.id === 'c2'));
});

check("counts: 'merged' legs are not live, so the survivor is counted once", () => {
    const n = get(`SELECT COUNT(*) c FROM croatians_abroad_registrations WHERE email='x@y.z' AND selected_conference=1 AND conference_status IN ('pre-registered','confirmed')`).c;
    assert.strictEqual(n, 1);
});

check('November send: a merged row classifies as merged and is never sendable', () => {
    const a = get('SELECT * FROM croatians_abroad_registrations WHERE id=?', ['aaa']);
    const c = program.classify ? program.classify(a, { status: 'awaiting_payment', payment_status: 'pending', pay_token: 't' }) : program._classify(a, null);
    assert.strictEqual(c.state, 'merged');
    assert.deepStrictEqual(c.legs, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
