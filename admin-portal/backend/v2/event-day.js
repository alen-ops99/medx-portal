/**
 * v2/event-day.js — the EVENT DAY control room backend (admin frontend-v2, Admin Event Day.dc.html).
 * Mounted by v2/index.js. Owns the /api/v2/eventday/* family + the public tokenized door scanner.
 *
 * WHY THIS EXISTS (Alen's requirement — party-size scanning): one QR admits a PARTY of N people
 * (1 + guest_count on the registration row). The legacy scanner family treats a second scan of the
 * same code as "already checked in" — wrong at a real door where a booking of 3 arrives in twos.
 * This module keeps its own admission ledger:
 *
 *   v2_checkin_admits (registration_ref, event_key) UNIQUE → admitted_count / party_size.
 *   Each scan admits +1 (or an explicit "admit N now") until the party is full; guests may arrive
 *   separately; an attempt beyond party_size answers result 'over_capacity' (a clear crimson state)
 *   and admits NOBODY unless the operator overrides (logged with a reason).
 *
 * COEXISTENCE with the legacy checked_in flag: on the FIRST admitted person only, the row's legacy
 * flag flips through the same UPDATE the frozen verify route performs (registrations.checked_in /
 * gala_registrations.checked_in / croatians_abroad conference_checked_in|bridges_checked_in /
 * bridges_registrations.checked_in, + the event_checkins mirror for `registrations` rows exactly
 * like POST /api/admin/checkin/ticket). Later scans of the same party touch ONLY v2_checkin_admits,
 * so the legacy flag is never double-written and the old scanner keeps saying "already checked in"
 * for a party that has started entering. No legacy ROUTE is modified — the resolver logic of
 * /api/admin/checkin/ticket + /api/admin/checkin/verify is replicated here read-only.
 *
 * REHEARSAL MODE (README note 4): scans with { rehearsal: true } write to v2_checkin_rehearsal and
 * NEVER touch real rows (no legacy flag, no v2_checkin_admits). TEST-1 … TEST-6 resolve to built-in
 * practice guests so the team can drill with printed test QRs; scanning a real code in rehearsal
 * resolves it read-only and still writes only the rehearsal table.
 *
 * DOOR-STAFF LINK (README note 12): POST /api/v2/eventday/door-tokens mints a tokenized URL
 * (/api/v2/door/<token>) that serves a standalone scanner page — no account, scanner only, stops
 * working when the event ends (expires_at from the gate schedule) or when revoked here.
 *
 * Tables owned here (v2_ prefix, try/catch DDL): v2_checkin_admits, v2_checkin_rehearsal,
 * v2_checkin_log, v2_door_tokens, v2_eventday_notes.
 */
'use strict';

const crypto = require('crypto');

const UUID_RE = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
const GATE_KEYS = ['conference', 'gala', 'donor', 'bridges'];
const MAX_ADMIT_PER_SCAN = 12;

// Rehearsal practice guests (names from the Admin Event Day.dc.html door list — test data only).
const TEST_GUESTS = [
    { ref: 'TEST-1', name: 'Ivana Barišić',   meta: 'Gala · paid · table TBD',      party: 2, events: ['gala'], paid: true },
    { ref: 'TEST-2', name: 'Simon Mikulandra', meta: 'Gala · VIP',                   party: 1, events: ['gala'], paid: true },
    { ref: 'TEST-3', name: 'Marko Petrović',   meta: 'Conference · free entry',      party: 1, events: ['conference'], paid: true },
    { ref: 'TEST-4', name: 'Dr. Maja Horvat',  meta: 'Conference · free entry',      party: 1, events: ['conference'], paid: true },
    { ref: 'TEST-5', name: 'Davor Klarić',     meta: 'Gala · payment pending',       party: 2, events: ['gala'], paid: false },
    { ref: 'TEST-6', name: 'Jelena Vidić',     meta: 'Gala · party of three',        party: 3, events: ['gala'], paid: true }
];

module.exports = function mountEventDay(app, ctx) {
    const { db, auth, adminOnly, saveDb, log } = ctx;

    const q = {
        get(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; },
        run(sql, p = []) { db().run(sql, p); saveDb(); }
    };

    // ctx carries auth + adminOnly only; scanner staff (is_staff) must reach the room like the
    // legacy scanner family (staffOrAdmin in server.js) — same gate, declared locally.
    function staffOrAdmin(req, res, next) {
        if (req.user && (req.user.is_admin || req.user.is_staff)) return next();
        return res.status(403).json({ error: 'Staff or admin access required' });
    }

    // Consequential actions land in the SAME audit_log the Settings audit page reads (logAudit replica).
    function audit(user, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), (user && user.id) || null, (user && user.email) || 'door-staff', action, detail || null]);
            saveDb();
        } catch (e) { /* audit must never break the action */ }
    }

    // ---------------------------------------------------------------- schema (try/catch DDL)
    // Each statement is individually guarded and the whole block retries: at boot BOTH portals
    // hammer one SQLite file, and a transient SQLITE_BUSY must not silently cost a table.
    const DDL = [];
    let schemaReady = false;
    function ensureSchema() {
        if (schemaReady) return true;
        let ok = true;
        for (const sql of DDL) {
            try { db().run(sql); } catch (e) { ok = false; if (!/database is locked|SQLITE_BUSY/i.test(e.message)) console.error('[v2/event-day] schema:', e.message); }
        }
        schemaReady = ok;
        return ok;
    }
    {
        DDL.push(`CREATE TABLE IF NOT EXISTS v2_checkin_admits (
            id TEXT PRIMARY KEY,
            registration_ref TEXT NOT NULL,
            reg_table TEXT NOT NULL,
            event_key TEXT NOT NULL,
            party_size INTEGER NOT NULL DEFAULT 1,
            admitted_count INTEGER NOT NULL DEFAULT 0,
            guest_name TEXT, guest_email TEXT,
            first_admit_at TEXT, last_scan_at TEXT,
            UNIQUE (registration_ref, event_key)
        )`);
        DDL.push(`CREATE TABLE IF NOT EXISTS v2_checkin_rehearsal (
            id TEXT PRIMARY KEY,
            registration_ref TEXT NOT NULL,
            reg_table TEXT NOT NULL,
            event_key TEXT NOT NULL,
            party_size INTEGER NOT NULL DEFAULT 1,
            admitted_count INTEGER NOT NULL DEFAULT 0,
            guest_name TEXT, guest_email TEXT,
            first_admit_at TEXT, last_scan_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE (registration_ref, event_key)
        )`);
        DDL.push(`CREATE TABLE IF NOT EXISTS v2_checkin_log (
            id TEXT PRIMARY KEY,
            ts TEXT DEFAULT (datetime('now')),
            event_key TEXT, registration_ref TEXT, code TEXT,
            result TEXT, admitted_delta INTEGER DEFAULT 0,
            admitted_count INTEGER DEFAULT 0, party_size INTEGER DEFAULT 1,
            method TEXT DEFAULT 'qr', actor TEXT, device TEXT,
            rehearsal INTEGER DEFAULT 0, is_override INTEGER DEFAULT 0, override_reason TEXT
        )`);
        DDL.push(`CREATE TABLE IF NOT EXISTS v2_door_tokens (
            id TEXT PRIMARY KEY,
            token TEXT UNIQUE NOT NULL,
            event_key TEXT NOT NULL,
            label TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            expires_at TEXT,
            revoked INTEGER DEFAULT 0
        )`);
        DDL.push(`CREATE TABLE IF NOT EXISTS v2_eventday_notes (
            event_key TEXT PRIMARY KEY,
            notes TEXT,
            updated_at TEXT, updated_by TEXT
        )`);
        DDL.push('CREATE INDEX IF NOT EXISTS idx_v2_admits_event ON v2_checkin_admits (event_key)');
        DDL.push('CREATE INDEX IF NOT EXISTS idx_v2_log_ts ON v2_checkin_log (ts)');
        ensureSchema();
        let tries = 0;
        const retry = setInterval(() => { if (ensureSchema() || ++tries >= 10) clearInterval(retry); }, 4000);
        if (retry.unref) retry.unref();
    }

    // ---------------------------------------------------------------- gates
    function gates() {
        try { return q.all('SELECT * FROM checkin_events WHERE is_active = 1 ORDER BY sort_order, label'); }
        catch (e) { return []; }
    }
    function gateFor(key) {
        try { return q.get('SELECT * FROM checkin_events WHERE event_key = ? AND is_active = 1', [key]); }
        catch (e) { return null; }
    }
    // defaultGateKey replica (schedule-aware; see server.js — the one happening now, else next, else lowest sort).
    function defaultGateKey(list) {
        const now = Date.now(), H = 3 * 3600 * 1000;
        const dated = list.filter(g => g.starts_at && !isNaN(Date.parse(g.starts_at)));
        const active = dated.filter(g => {
            const s = Date.parse(g.starts_at);
            const e = g.ends_at && !isNaN(Date.parse(g.ends_at)) ? Date.parse(g.ends_at) : s + 12 * 3600 * 1000;
            return now >= s - H && now <= e + H;
        });
        if (active.length) return active.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0].event_key;
        const up = dated.filter(g => Date.parse(g.starts_at) > now).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
        if (up.length) return up[0].event_key;
        return list.length ? list.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0].event_key : 'conference';
    }
    function donorEventId() {
        try {
            return (q.get("SELECT id FROM bridges_events WHERE slug = 'donor-night'")
                 || q.get("SELECT id FROM bridges_events WHERE name = 'Plexus Donor Night'") || {}).id || null;
        } catch (e) {
            try { return (q.get("SELECT id FROM bridges_events WHERE name = 'Plexus Donor Night'") || {}).id || null; } catch (e2) { return null; }
        }
    }

    // Is today an event date? (conference span · gala date · any bridges_events date) — mirrors chrome.isEventDay.
    function isEventDay() {
        const today = new Date().toISOString().slice(0, 10);
        try {
            const conf = q.get('SELECT start_date, end_date FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1');
            if (conf && conf.start_date) {
                const s = String(conf.start_date).slice(0, 10), e = String(conf.end_date || conf.start_date).slice(0, 10);
                if (today >= s && today <= e) return true;
            }
        } catch (e) {}
        try { if (q.get('SELECT 1 x FROM bridges_events WHERE substr(event_date,1,10) = ?', [today])) return true; } catch (e) {}
        try { if (q.get("SELECT 1 x FROM checkin_events WHERE is_active = 1 AND substr(starts_at,1,10) <= ? AND substr(COALESCE(ends_at, starts_at),1,10) >= ?", [today, today])) return true; } catch (e) {}
        return false;
    }

    // ---------------------------------------------------------------- resolver (legacy logic replicated, read-only)
    const party = row => 1 + (Number(row && row.guest_count) || 0);
    const fullName = r => (((r.first_name || '') + ' ' + (r.last_name || '')).trim()) || r.email || 'Guest';
    function normShort(s) { const n = String(s).toLowerCase().replace(/[^0-9a-f]/g, ''); return (n.length >= 4 && n.length <= 32) ? n : null; }

    function findByUuid(id, eventKey) {
        let r = null;
        try { r = q.get('SELECT * FROM registrations WHERE id = ?', [id]); if (r) return { table: 'registrations', row: r }; } catch (e) {}
        try { r = q.get('SELECT * FROM gala_registrations WHERE id = ?', [id]); if (r) return { table: 'gala_registrations', row: r }; } catch (e) {}
        try {
            r = q.get('SELECT * FROM croatians_abroad_registrations WHERE id = ? OR gala_registration_id = ?', [id, id]);
            if (r) return { table: 'croatians_abroad_registrations', row: r };
        } catch (e) {}
        try { r = q.get('SELECT * FROM bridges_registrations WHERE id = ?', [id]); if (r) return { table: 'bridges_registrations', row: r }; } catch (e) {}
        return null;
    }

    // Per-gate lookup priority for email / short-code fallbacks (mirrors POST /api/admin/checkin/verify).
    function findByEmailOrShort(codeClean, eventKey) {
        const email = codeClean.includes('@') ? codeClean : null;
        const short = email ? null : normShort(codeClean);
        if (!email && !short) return null;
        const donorId = (eventKey === 'donor' || eventKey === 'bridges') ? donorEventId() : null;
        const tryOne = (table, where, args, orderCol) => {
            try {
                if (email) {
                    const r = q.get(`SELECT * FROM ${table} WHERE LOWER(email) = LOWER(?) ${where} ORDER BY ${orderCol} DESC LIMIT 1`, [email, ...args]);
                    if (r) return r;
                }
                if (short) {
                    const r = q.get(`SELECT * FROM ${table} WHERE replace(lower(id),'-','') LIKE ? ${where} ORDER BY ${orderCol} DESC LIMIT 1`, [short + '%', ...args]);
                    if (r) return r;
                }
            } catch (e) {}
            return null;
        };
        if (eventKey === 'conference') {
            let r = tryOne('registrations', '', [], 'created_at'); if (r) return { table: 'registrations', row: r };
            r = tryOne('croatians_abroad_registrations', 'AND selected_conference = 1', [], 'created_at'); if (r) return { table: 'croatians_abroad_registrations', row: r };
        } else if (eventKey === 'gala') {
            let r = tryOne('gala_registrations', '', [], 'created_at'); if (r) return { table: 'gala_registrations', row: r };
            r = tryOne('croatians_abroad_registrations', 'AND selected_gala = 1', [], 'created_at'); if (r) return { table: 'croatians_abroad_registrations', row: r };
        } else if (eventKey === 'donor') {
            const w = donorId ? 'AND event_id = ?' : '', a = donorId ? [donorId] : [];
            const r = tryOne('bridges_registrations', w, a, 'registered_at'); if (r) return { table: 'bridges_registrations', row: r };
        } else { // bridges
            const w = donorId ? 'AND event_id != ?' : '', a = donorId ? [donorId] : [];
            let r = tryOne('bridges_registrations', w, a, 'registered_at'); if (r) return { table: 'bridges_registrations', row: r };
            r = tryOne('croatians_abroad_registrations', 'AND selected_bridges = 1', [], 'created_at'); if (r) return { table: 'croatians_abroad_registrations', row: r };
        }
        return null;
    }

    // Every legacy code format resolves here: checkin_token → JSON {id|reg_id|regId} → uuid anywhere
    // in the string (MEDX:<uuid>, /qr/<uuid>.png) → email → short id prefix (per-gate tables).
    function resolveCode(code, eventKey) {
        if (code === null || code === undefined) return null;
        const s = String(code).trim();
        if (!s) return null;
        try { const r = q.get('SELECT * FROM registrations WHERE checkin_token = ?', [s]); if (r) return { table: 'registrations', row: r }; } catch (e) {}
        if (s[0] === '{') {
            try {
                const j = JSON.parse(s);
                const id = j.id || j.reg_id || j.regId || j.registration_id;
                if (id) { const hit = findByUuid(String(id), eventKey); if (hit) return hit; }
                if (j.email) { const hit = findByEmailOrShort(String(j.email), eventKey); if (hit) return hit; }
            } catch (e) {}
        }
        const m = s.match(UUID_RE);
        if (m) { const hit = findByUuid(m[1], eventKey); if (hit) return hit; }
        return findByEmailOrShort(s, eventKey);
    }

    // Fit the resolved row to the gate. Returns { ok } or { block: <result>, message } — and may
    // SWAP the row (CA → its linked gala registration; other-table row → same-email row at this
    // gate, the "one QR opens all doors" hop the member wallet promises).
    function fitForGate(hit, eventKey, override) {
        const t = hit.table, r = hit.row;
        const swapByEmail = () => {
            if (!r.email) return null;
            const alt = findByEmailOrShort(String(r.email), eventKey);
            return (alt && !(alt.table === t && String(alt.row.id) === String(r.id))) ? alt : null;
        };
        if (t === 'registrations') {
            if (Number(r.revoked)) return { block: 'revoked', message: 'Cancelled or revoked — do NOT admit.' };
            if (String(r.status || '').toLowerCase() === 'cancelled') return { block: 'cancelled', message: 'This registration was cancelled. Do NOT admit.' };
            if (eventKey === 'conference') return { ok: true, hit };
            if (eventKey === 'gala' && Number(r.includes_gala)) return { ok: true, hit };
            const alt = swapByEmail();
            if (alt) return fitForGate(alt, eventKey, override);
            return override ? { ok: true, hit } : { block: 'wrong_event', message: 'A conference ticket — not valid at this door.' };
        }
        if (t === 'gala_registrations') {
            if (String(r.status || '').toLowerCase() === 'cancelled') return { block: 'cancelled', message: 'This registration was cancelled. Do NOT admit.' };
            if (eventKey !== 'gala') {
                const alt = swapByEmail();
                if (alt) return fitForGate(alt, eventKey, override);
                return override ? { ok: true, hit } : { block: 'wrong_event', message: 'A Gala seat — switch the scanner to the Gala door.' };
            }
            const paid = ['paid', 'vip-comp'].includes(String(r.payment_status || ''));
            if (!paid && !override) return { block: 'not_paid', message: 'Payment not completed. Do NOT admit without an override.' };
            return { ok: true, hit };
        }
        if (t === 'croatians_abroad_registrations') {
            if (eventKey === 'gala') {
                if (r.gala_registration_id) {
                    try {
                        const g = q.get('SELECT * FROM gala_registrations WHERE id = ?', [r.gala_registration_id]);
                        if (g) return fitForGate({ table: 'gala_registrations', row: g }, eventKey, override);
                    } catch (e) {}
                }
                if (!Number(r.selected_gala) && !override) return { block: 'not_registered_for_event', message: 'Not registered for the Gala Evening.' };
                if (String(r.gala_payment_status || '') !== 'paid' && !override) return { block: 'not_paid', message: 'Gala payment not completed. Do NOT admit without an override.' };
                return { ok: true, hit };
            }
            if (eventKey === 'conference') {
                if (!Number(r.selected_conference) && !override) return { block: 'not_registered_for_event', message: 'Not registered for the Conference.' };
                return { ok: true, hit };
            }
            if (eventKey === 'bridges') {
                if (!Number(r.selected_bridges) && !override) return { block: 'not_registered_for_event', message: 'Not registered for the Bridges event.' };
                return { ok: true, hit };
            }
            // donor guests never come from the diaspora table (legacy rule) — try the email hop.
            const alt = swapByEmail();
            if (alt) return fitForGate(alt, eventKey, override);
            return override ? { ok: true, hit } : { block: 'wrong_event', message: 'Not a Donor Night registration.' };
        }
        // bridges_registrations — Building Bridges and Donor Night share the table, scoped by event_id.
        if (String(r.status || '').toLowerCase() === 'cancelled') return { block: 'cancelled', message: 'This registration was cancelled. Do NOT admit.' };
        const donorId = donorEventId();
        const isDonorRow = donorId && String(r.event_id) === String(donorId);
        if (eventKey === 'donor' && !isDonorRow && donorId && !override) {
            return { block: 'wrong_event', message: 'This seat belongs to a Building Bridges evening, not Donor Night.' };
        }
        if (eventKey === 'bridges' && isDonorRow && !override) {
            return { block: 'wrong_event', message: 'A Donor Night seat — switch the scanner to the Donor door.' };
        }
        if (eventKey === 'donor' || eventKey === 'bridges') return { ok: true, hit };
        const alt = swapByEmail();
        if (alt) return fitForGate(alt, eventKey, override);
        return override ? { ok: true, hit } : { block: 'wrong_event', message: 'A Bridges seat — not valid at this door.' };
    }

    function metaFor(table, row, eventKey) {
        if (table === 'registrations') {
            let ticket = '';
            try { const t = row.ticket_type_id ? q.get('SELECT name FROM ticket_types WHERE id = ?', [row.ticket_type_id]) : null; ticket = (t && t.name) || ''; } catch (e) {}
            return ['Conference', ticket || 'free entry', row.payment_status === 'paid' ? 'paid' : null].filter(Boolean).join(' · ');
        }
        if (table === 'gala_registrations') {
            const pay = row.payment_status === 'paid' ? 'paid' : row.payment_status === 'vip-comp' ? 'VIP' : 'payment pending';
            let table_ = row.seat_number || '';
            try { if (!table_ && row.email) { const ta = q.get('SELECT table_no FROM gala_table_assignments WHERE lower(email)=lower(?) ORDER BY updated_at DESC LIMIT 1', [row.email]); if (ta && String(ta.table_no || '').trim()) table_ = /^\d+$/.test(String(ta.table_no).trim()) ? 'Stol ' + String(ta.table_no).trim() : String(ta.table_no).trim(); } } catch (e) {}
            return ['Gala', pay, table_ ? table_ : 'table TBD'].join(' · ');
        }
        if (table === 'croatians_abroad_registrations') {
            const what = [Number(row.selected_conference) ? 'Conference' : null, Number(row.selected_bridges) ? 'Bridges' : null, Number(row.selected_gala) ? 'Gala' : null].filter(Boolean).join(' + ');
            const pay = Number(row.selected_gala) ? (String(row.gala_payment_status || '') === 'paid' ? 'gala paid' : 'gala pending') : null;
            return [what || 'Croatians abroad', pay].filter(Boolean).join(' · ');
        }
        let ev = '';
        try { if (row.event_id) ev = (q.get('SELECT name FROM bridges_events WHERE id = ?', [row.event_id]) || {}).name || ''; } catch (e) {}
        return ev || 'Building Bridges';
    }

    // ---------------------------------------------------------------- the scan (party-size core)
    function admitTableFor(rehearsal) { return rehearsal ? 'v2_checkin_rehearsal' : 'v2_checkin_admits'; }

    function logScan(o) {
        try {
            db().run(`INSERT INTO v2_checkin_log (id, event_key, registration_ref, code, result, admitted_delta, admitted_count, party_size, method, actor, device, rehearsal, is_override, override_reason)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [crypto.randomUUID(), o.event_key || null, o.registration_ref || null, o.code == null ? null : String(o.code).slice(0, 160),
                 o.result || null, o.admitted_delta || 0, o.admitted_count || 0, o.party_size || 1,
                 o.method || 'qr', o.actor || null, o.device || null, o.rehearsal ? 1 : 0, o.is_override ? 1 : 0, o.override_reason || null]);
            saveDb();
        } catch (e) { console.error('[v2/event-day] log write failed:', e.message); }
    }

    // Legacy flag — FIRST admit only, real mode only. The exact writes the frozen routes perform.
    function flipLegacy(table, row, eventKey) {
        const now = new Date().toISOString();
        try {
            if (table === 'registrations') {
                db().run('UPDATE registrations SET checked_in = 1, checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ? AND COALESCE(checked_in, 0) = 0', [now, row.id]);
                // event_checkins mirror, exactly like POST /api/admin/checkin/ticket (INSERT OR IGNORE;
                // UNIQUE(registration_id, event_key) makes this idempotent and race-safe).
                db().run(`INSERT OR IGNORE INTO event_checkins (id, registration_id, event_key, checkin_token, admin_id, admin_email, device, method, override_reason)
                          VALUES (?,?,?,?,?,?,?,?,?)`,
                    [crypto.randomUUID(), row.id, eventKey, row.checkin_token || null, null, 'v2-eventday', null, 'qr', null]);
            } else if (table === 'gala_registrations') {
                db().run('UPDATE gala_registrations SET checked_in = 1, checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ? AND COALESCE(checked_in, 0) = 0', [now, row.id]);
            } else if (table === 'croatians_abroad_registrations') {
                if (eventKey === 'conference') db().run('UPDATE croatians_abroad_registrations SET conference_checked_in = 1, conference_checked_in_at = COALESCE(conference_checked_in_at, ?) WHERE id = ? AND COALESCE(conference_checked_in, 0) = 0', [now, row.id]);
                else if (eventKey === 'bridges' || eventKey === 'donor') db().run('UPDATE croatians_abroad_registrations SET bridges_checked_in = 1, bridges_checked_in_at = COALESCE(bridges_checked_in_at, ?) WHERE id = ? AND COALESCE(bridges_checked_in, 0) = 0', [now, row.id]);
                // gala admits arrive here only for CA rows with NO linked gala registration — there is
                // no legacy CA gala flag to flip; v2_checkin_admits carries the state.
            } else if (table === 'bridges_registrations') {
                db().run('UPDATE bridges_registrations SET checked_in = 1, checked_in_at = COALESCE(checked_in_at, ?) WHERE id = ? AND COALESCE(checked_in, 0) = 0', [now, row.id]);
            }
            saveDb();
        } catch (e) { console.error('[v2/event-day] legacy flip failed:', e.message); }
    }

    function doScan(body, actor) {
        const b = body || {};
        const eventKey = String(b.event || '').trim();
        const rehearsal = !!b.rehearsal;
        const override = !!b.override;
        const overrideReason = b.override_reason ? String(b.override_reason).slice(0, 300) : null;
        const method = b.method === 'manual' ? 'manual' : 'qr';
        const device = b.device ? String(b.device).slice(0, 120) : null;
        let admitN = parseInt(b.admit, 10); if (!Number.isFinite(admitN) || admitN < 1) admitN = 1; if (admitN > MAX_ADMIT_PER_SCAN) admitN = MAX_ADMIT_PER_SCAN;
        const codeRaw = b.code;
        const actorStr = typeof actor === 'string' ? actor : ((actor && actor.email) || null);

        if (!GATE_KEYS.includes(eventKey)) return { status: 400, out: { ok: false, result: 'bad_event', message: 'Unknown door: ' + (eventKey || '(none)') } };
        const gate = gateFor(eventKey);
        const gateLabel = (gate && gate.label) || eventKey;
        if (!gate) return { status: 400, out: { ok: false, result: 'bad_event', message: 'This door is not active: ' + eventKey } };
        if (!codeRaw || !String(codeRaw).trim()) return { status: 400, out: { ok: false, result: 'bad_code', message: 'Scan or type a code first.' } };

        const fail = (result, message, extra) => {
            logScan({ event_key: eventKey, code: codeRaw, result, method, actor: actorStr, device, rehearsal, is_override: override, override_reason: overrideReason });
            return { status: 200, out: Object.assign({ ok: false, result, message, event: eventKey, event_label: gateLabel, rehearsal }, extra || {}) };
        };

        // --- rehearsal TEST guests (never touch real tables) ---
        const codeStr = String(codeRaw).trim();
        let ticket = null, ref = null, regTable = null, partySize = 1;
        const testHit = rehearsal ? TEST_GUESTS.find(t => t.ref.toLowerCase() === codeStr.toLowerCase()) : null;
        if (testHit) {
            if (!testHit.paid && !override) return fail('not_paid', 'Payment not completed. Do NOT admit without an override.', { ticket: { name: testHit.name, meta: testHit.meta } });
            ref = testHit.ref; regTable = 'test'; partySize = testHit.party;
            ticket = { name: testHit.name, email: '', meta: testHit.meta, kind: 'test' };
        } else {
            const hit = resolveCode(codeStr, eventKey);
            if (!hit) return fail('not_found', 'No registration found for this code.');
            const fitted = fitForGate(hit, eventKey, override);
            if (fitted.block) {
                return fail(fitted.block, fitted.message, { ticket: { name: fullName(hit.row), email: hit.row.email || '', meta: metaFor(hit.table, hit.row, eventKey) } });
            }
            const use = fitted.hit || hit;
            // Per-edition Bridges doors: a Boston ticket must not admit at the Zagreb door and vice
            // versa (Alen 2026-09-01). CA plexus-form bridges sign-ups belong to the home edition.
            const bev = eventKey === 'bridges' ? String(b.bridges_event || '').trim() : '';
            if (bev && !override) {
                if (use.table === 'bridges_registrations' && String(use.row.event_id) !== bev) {
                    let evName = 'another Bridges edition';
                    try { evName = (q.get('SELECT name FROM bridges_events WHERE id = ?', [use.row.event_id]) || {}).name || evName; } catch (e) {}
                    return fail('wrong_event', `This ticket is for ${evName} — switch the Bridges door.`, { ticket: { name: fullName(use.row), email: use.row.email || '', meta: metaFor(use.table, use.row, eventKey) } });
                }
                if (use.table === 'croatians_abroad_registrations' && String(bev) !== String(homeBridgesId() || '')) {
                    return fail('wrong_event', 'A Plexus-week Bridges ticket (Zagreb) — not valid at this door.', { ticket: { name: fullName(use.row), email: use.row.email || '', meta: metaFor(use.table, use.row, eventKey) } });
                }
            }
            ref = String(use.row.id); regTable = use.table; partySize = party(use.row);
            ticket = { name: fullName(use.row), email: use.row.email || '', meta: metaFor(use.table, use.row, eventKey), kind: use.table };
            ticket.row = use.row; // internal — stripped before respond
        }

        // --- party ledger upsert (real → v2_checkin_admits; rehearsal → v2_checkin_rehearsal) ---
        if (!schemaReady) ensureSchema();
        const T = admitTableFor(rehearsal);
        const now = new Date().toISOString();
        let adm = null;
        try { adm = q.get(`SELECT * FROM ${T} WHERE registration_ref = ? AND event_key = ?`, [ref, eventKey]); } catch (e) {}
        const cur = adm ? Number(adm.admitted_count) || 0 : 0;

        if (cur >= partySize && !override) {
            // The clear crimson state: everyone on this booking is already inside.
            logScan({ event_key: eventKey, registration_ref: ref, code: codeRaw, result: 'over_capacity', admitted_count: cur, party_size: partySize, method, actor: actorStr, device, rehearsal });
            return { status: 200, out: { ok: false, result: 'over_capacity', event: eventKey, event_label: gateLabel, rehearsal,
                admitted_count: cur, party_size: partySize, remaining: 0,
                message: `All ${partySize} of this party are already in — do not admit again without an override.`,
                ticket: { name: ticket.name, email: ticket.email, meta: ticket.meta } } };
        }

        const delta = override ? admitN : Math.min(admitN, partySize - cur);
        const next = cur + delta;
        try {
            if (adm) {
                q.run(`UPDATE ${T} SET admitted_count = ?, party_size = ?, last_scan_at = ?, first_admit_at = COALESCE(first_admit_at, ?) WHERE id = ?`,
                    [next, partySize, now, now, adm.id]);
            } else {
                q.run(`INSERT INTO ${T} (id, registration_ref, reg_table, event_key, party_size, admitted_count, guest_name, guest_email, first_admit_at, last_scan_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)`,
                    [crypto.randomUUID(), ref, regTable, eventKey, partySize, next, ticket.name, ticket.email || null, now, now]);
            }
        } catch (e) {
            return { status: 500, out: { ok: false, result: 'error', message: 'Could not record the admit: ' + e.message } };
        }

        // Legacy flag — first admitted person only, never in rehearsal, never re-written after.
        if (!rehearsal && cur === 0 && next > 0 && ticket.row) flipLegacy(regTable, ticket.row, eventKey);

        const overCap = next > partySize;
        const result = overCap ? 'over_admitted' : (next >= partySize ? 'party_complete' : 'admitted');
        logScan({ event_key: eventKey, registration_ref: ref, code: codeRaw, result, admitted_delta: delta, admitted_count: next, party_size: partySize, method, actor: actorStr, device, rehearsal, is_override: override, override_reason: overrideReason });
        if (override && actor) {
            const u = typeof actor === 'string' ? { email: actor } : actor;
            audit(u.id ? u : { email: u.email || String(actor) }, 'eventday.override', `${eventKey} · ${ticket.name} · admitted ${next}/${partySize}${overrideReason ? ' — ' + overrideReason : ''}${rehearsal ? ' (rehearsal)' : ''}`);
        }
        const message = overCap
            ? `${next} admitted on a party of ${partySize} — over capacity, logged.`
            : next >= partySize
                ? (partySize === 1 ? `${ticket.name} checked in.` : `${next} of ${partySize} admitted — party complete.`)
                : `${next} of ${partySize} admitted — ${partySize - next} still to come.`;
        return { status: 200, out: { ok: true, result, event: eventKey, event_label: gateLabel, rehearsal,
            admitted_count: next, party_size: partySize, remaining: Math.max(0, partySize - next), admitted_delta: delta,
            message, ticket: { name: ticket.name, email: ticket.email, meta: ticket.meta } } };
    }

    // ---------------------------------------------------------------- counters + door list
    // ---- per-event Bridges doors (Alen 2026-09-01: Boston vs Zagreb must not share one door) ----
    function homeBridgesId() {
        try { return (q.get("SELECT id FROM bridges_events WHERE slug = 'building-bridges'") || {}).id || null; } catch (e) { return null; }
    }
    function bridgesEventList() {
        const donorId = donorEventId();
        try {
            const rows = q.all("SELECT id, name, city, event_date, event_time FROM bridges_events WHERE lower(COALESCE(status,'upcoming')) != 'cancelled' ORDER BY CASE WHEN COALESCE(event_date,'') = '' THEN 1 ELSE 0 END, event_date");
            return rows.filter(r => String(r.id) !== String(donorId || ''));
        } catch (e) { return []; }
    }
    function bridgesExpected(eventId) {
        const notTest = "AND (notes IS NULL OR (notes NOT LIKE '%SCANNER TEST%' AND notes NOT LIKE '%BUNDLE TEST%'))";
        let n = 0;
        try { n += (q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM bridges_registrations WHERE event_id = ? AND lower(COALESCE(status,'')) != 'cancelled'`, [eventId]) || {}).c || 0; } catch (e) {}
        if (String(eventId) === String(homeBridgesId() || '')) {
            try { n += (q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM croatians_abroad_registrations WHERE selected_bridges = 1 ${notTest}`) || {}).c || 0; } catch (e) {}
        }
        return n;
    }
    function bridgesAdmitted(eventId) {
        let n = 0;
        try { n += (q.get(`SELECT COALESCE(SUM(a.admitted_count),0) c FROM v2_checkin_admits a JOIN bridges_registrations b ON b.id = a.registration_ref WHERE a.event_key = 'bridges' AND b.event_id = ?`, [eventId]) || {}).c || 0; } catch (e) {}
        try { n += (q.get(`SELECT COUNT(*) c FROM bridges_registrations WHERE COALESCE(checked_in,0) = 1 AND event_id = ? AND id NOT IN (SELECT registration_ref FROM v2_checkin_admits WHERE event_key = 'bridges')`, [eventId]) || {}).c || 0; } catch (e) {}
        if (String(eventId) === String(homeBridgesId() || '')) {
            try { n += (q.get(`SELECT COUNT(*) c FROM croatians_abroad_registrations WHERE bridges_checked_in = 1 AND id NOT IN (SELECT registration_ref FROM v2_checkin_admits WHERE event_key = 'bridges')`) || {}).c || 0; } catch (e) {}
        }
        return n;
    }

    function expectedPeople(eventKey) {
        const donorId = donorEventId();
        const notTest = "AND (notes IS NULL OR (notes NOT LIKE '%SCANNER TEST%' AND notes NOT LIKE '%BUNDLE TEST%'))";
        try {
            if (eventKey === 'conference') {
                const a = q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM registrations WHERE COALESCE(revoked,0) = 0 AND lower(COALESCE(status,'')) != 'cancelled'`) || { c: 0 };
                const b = q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM croatians_abroad_registrations WHERE selected_conference = 1 ${notTest}`) || { c: 0 };
                return (a.c || 0) + (b.c || 0);
            }
            if (eventKey === 'gala') {
                const a = q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM gala_registrations WHERE payment_status IN ('paid','vip-comp')`) || { c: 0 };
                const b = q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM croatians_abroad_registrations WHERE selected_gala = 1 AND gala_registration_id IS NULL AND gala_payment_status = 'paid' ${notTest}`) || { c: 0 };
                return (a.c || 0) + (b.c || 0);
            }
            if (eventKey === 'donor') {
                if (!donorId) return 0;
                const a = q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM bridges_registrations WHERE event_id = ? AND lower(COALESCE(status,'')) != 'cancelled'`, [donorId]) || { c: 0 };
                return a.c || 0;
            }
            const w = donorId ? 'AND event_id != ?' : '', args = donorId ? [donorId] : [];
            const a = q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM bridges_registrations WHERE lower(COALESCE(status,'')) != 'cancelled' ${w}`, args) || { c: 0 };
            const b = q.get(`SELECT COALESCE(SUM(1 + COALESCE(guest_count,0)),0) c FROM croatians_abroad_registrations WHERE selected_bridges = 1 ${notTest}`) || { c: 0 };
            return (a.c || 0) + (b.c || 0);
        } catch (e) { return 0; }
    }
    function admittedPeople(eventKey) {
        let v2 = 0;
        try { v2 = (q.get('SELECT COALESCE(SUM(admitted_count),0) c FROM v2_checkin_admits WHERE event_key = ?', [eventKey]) || {}).c || 0; } catch (e) {}
        // Rows the OLD scanner admitted that v2 has never seen count as 1 person each — the two
        // scanners can run side by side without double counting.
        const legacyOnly = (sql, args = []) => {
            try { return (q.get(sql, args) || {}).c || 0; } catch (e) { return 0; }
        };
        const notIn = `AND id NOT IN (SELECT registration_ref FROM v2_checkin_admits WHERE event_key = ?)`;
        let legacy = 0;
        if (eventKey === 'conference') {
            legacy += legacyOnly(`SELECT COUNT(*) c FROM registrations WHERE (COALESCE(checked_in,0) = 1 OR id IN (SELECT registration_id FROM event_checkins WHERE event_key = 'conference')) ${notIn}`, [eventKey]);
            legacy += legacyOnly(`SELECT COUNT(*) c FROM croatians_abroad_registrations WHERE conference_checked_in = 1 ${notIn}`, [eventKey]);
        } else if (eventKey === 'gala') {
            legacy += legacyOnly(`SELECT COUNT(*) c FROM gala_registrations WHERE COALESCE(checked_in,0) = 1 ${notIn}`, [eventKey]);
        } else if (eventKey === 'donor' || eventKey === 'bridges') {
            const donorId = donorEventId();
            const w = donorId ? (eventKey === 'donor' ? 'AND event_id = ?' : 'AND event_id != ?') : '';
            legacy += legacyOnly(`SELECT COUNT(*) c FROM bridges_registrations WHERE COALESCE(checked_in,0) = 1 ${w} ${notIn}`, donorId ? [donorId, eventKey] : [eventKey]);
            if (eventKey === 'bridges') legacy += legacyOnly(`SELECT COUNT(*) c FROM croatians_abroad_registrations WHERE bridges_checked_in = 1 ${notIn}`, [eventKey]);
        }
        return v2 + legacy;
    }

    function doorRows(eventKey, qText, limit, bridgesEventId) {
        const donorId = donorEventId();
        const like = qText ? '%' + qText.toLowerCase() + '%' : null;
        const rows = [];
        const push = (table, r, sub) => {
            const name = fullName(r);
            if (like && !(name.toLowerCase().includes(like.slice(1, -1)) || String(r.email || '').toLowerCase().includes(like.slice(1, -1)))) return;
            rows.push({ ref: String(r.id), table, name, email: r.email || '', meta: sub, party_size: party(r), legacy_in: 0, sort: name.toLowerCase() });
        };
        try {
            if (eventKey === 'conference') {
                q.all(`SELECT * FROM registrations WHERE COALESCE(revoked,0) = 0 AND lower(COALESCE(status,'')) != 'cancelled' ORDER BY created_at DESC LIMIT 800`).forEach(r => push('registrations', r, metaFor('registrations', r, eventKey)));
                q.all(`SELECT * FROM croatians_abroad_registrations WHERE selected_conference = 1 AND (notes IS NULL OR (notes NOT LIKE '%SCANNER TEST%' AND notes NOT LIKE '%BUNDLE TEST%')) ORDER BY created_at DESC LIMIT 800`).forEach(r => push('croatians_abroad_registrations', r, metaFor('croatians_abroad_registrations', r, eventKey)));
            } else if (eventKey === 'gala') {
                q.all(`SELECT * FROM gala_registrations ORDER BY created_at DESC LIMIT 800`).forEach(r => push('gala_registrations', r, metaFor('gala_registrations', r, eventKey)));
                q.all(`SELECT * FROM croatians_abroad_registrations WHERE selected_gala = 1 AND gala_registration_id IS NULL AND (notes IS NULL OR (notes NOT LIKE '%SCANNER TEST%' AND notes NOT LIKE '%BUNDLE TEST%')) ORDER BY created_at DESC LIMIT 400`).forEach(r => push('croatians_abroad_registrations', r, metaFor('croatians_abroad_registrations', r, eventKey)));
            } else if (eventKey === 'donor') {
                if (donorId) q.all(`SELECT * FROM bridges_registrations WHERE event_id = ? AND lower(COALESCE(status,'')) != 'cancelled' ORDER BY registered_at DESC LIMIT 800`, [donorId]).forEach(r => push('bridges_registrations', r, metaFor('bridges_registrations', r, eventKey)));
            } else {
                let w = donorId ? 'AND event_id != ?' : '', args = donorId ? [donorId] : [];
                if (bridgesEventId) { w += ' AND event_id = ?'; args = args.concat([bridgesEventId]); }
                q.all(`SELECT * FROM bridges_registrations WHERE lower(COALESCE(status,'')) != 'cancelled' ${w} ORDER BY registered_at DESC LIMIT 800`, args).forEach(r => push('bridges_registrations', r, metaFor('bridges_registrations', r, eventKey)));
                // the Plexus-week /plexus form's bridges sign-ups belong to the home (Zagreb) edition only
                if (!bridgesEventId || String(bridgesEventId) === String(homeBridgesId() || '')) {
                    q.all(`SELECT * FROM croatians_abroad_registrations WHERE selected_bridges = 1 AND (notes IS NULL OR (notes NOT LIKE '%SCANNER TEST%' AND notes NOT LIKE '%BUNDLE TEST%')) ORDER BY created_at DESC LIMIT 400`).forEach(r => push('croatians_abroad_registrations', r, metaFor('croatians_abroad_registrations', r, eventKey)));
                }
            }
        } catch (e) { console.error('[v2/event-day] door list:', e.message); }
        // legacy checked-in state per table (so a row the old scanner admitted reads IN here too)
        const legacyIn = r => {
            try {
                if (r.table === 'registrations') { const x = q.get(`SELECT COALESCE(checked_in,0) c FROM registrations WHERE id = ?`, [r.ref]); return x && Number(x.c) ? 1 : 0; }
                if (r.table === 'gala_registrations') { const x = q.get(`SELECT COALESCE(checked_in,0) c FROM gala_registrations WHERE id = ?`, [r.ref]); return x && Number(x.c) ? 1 : 0; }
                if (r.table === 'croatians_abroad_registrations') {
                    const col = eventKey === 'conference' ? 'conference_checked_in' : (eventKey === 'bridges' ? 'bridges_checked_in' : null);
                    if (!col) return 0;
                    const x = q.get(`SELECT COALESCE(${col},0) c FROM croatians_abroad_registrations WHERE id = ?`, [r.ref]); return x && Number(x.c) ? 1 : 0;
                }
                const x = q.get(`SELECT COALESCE(checked_in,0) c FROM bridges_registrations WHERE id = ?`, [r.ref]); return x && Number(x.c) ? 1 : 0;
            } catch (e) { return 0; }
        };
        let admits = {};
        try { q.all('SELECT registration_ref, admitted_count, party_size, last_scan_at FROM v2_checkin_admits WHERE event_key = ?', [eventKey]).forEach(a => { admits[a.registration_ref] = a; }); } catch (e) {}
        const out = rows.map(r => {
            const a = admits[r.ref];
            const admitted = a ? Number(a.admitted_count) || 0 : 0;
            return {
                ref: r.ref, table: r.table, name: r.name, email: r.email, meta: r.meta,
                party_size: a ? Number(a.party_size) || r.party_size : r.party_size,
                admitted_count: admitted,
                legacy_in: admitted ? 1 : legacyIn(r),
                last_scan_at: a ? a.last_scan_at : null
            };
        });
        out.sort((x, y) => (x.admitted_count > 0 || x.legacy_in) === (y.admitted_count > 0 || y.legacy_in) ? x.name.localeCompare(y.name) : ((x.admitted_count > 0 || x.legacy_in) ? 1 : -1));
        return out.slice(0, limit || 400);
    }

    function rehearsalDoor() {
        let adm = {};
        try { q.all('SELECT * FROM v2_checkin_rehearsal').forEach(a => { adm[a.registration_ref + '|' + a.event_key] = a; }); } catch (e) {}
        const rows = TEST_GUESTS.map(t => {
            const a = adm[t.ref + '|' + t.events[0]] || adm[t.ref + '|conference'] || adm[t.ref + '|gala'];
            return { ref: t.ref, table: 'test', name: t.name, email: '', meta: t.meta, party_size: t.party,
                     admitted_count: a ? Number(a.admitted_count) || 0 : 0, legacy_in: 0, last_scan_at: a ? a.last_scan_at : null, event: t.events[0] };
        });
        // real codes scanned during rehearsal show up under their own names too
        try {
            q.all("SELECT * FROM v2_checkin_rehearsal WHERE registration_ref NOT LIKE 'TEST-%' ORDER BY last_scan_at DESC LIMIT 60").forEach(a => {
                rows.push({ ref: a.registration_ref, table: a.reg_table, name: a.guest_name || a.registration_ref.slice(0, 8), email: a.guest_email || '', meta: 'rehearsal scan', party_size: Number(a.party_size) || 1, admitted_count: Number(a.admitted_count) || 0, legacy_in: 0, last_scan_at: a.last_scan_at, event: a.event_key });
            });
        } catch (e) {}
        return rows;
    }

    // ---------------------------------------------------------------- routes (admin portal)
    app.get('/api/v2/eventday/overview', auth, staffOrAdmin, (req, res) => {
        try {
            const gs = gates();
            const active = defaultGateKey(gs);
            const rehearsalCount = (() => { try { return (q.get('SELECT COALESCE(SUM(admitted_count),0) c FROM v2_checkin_rehearsal') || {}).c || 0; } catch (e) { return 0; } })();
            res.json({
                today: new Date().toISOString().slice(0, 10),
                is_event_day: isEventDay(),
                default_event: active,
                rehearsal_admitted: rehearsalCount,
                gates: gs.map(g => ({
                    event_key: g.event_key, label: g.label, starts_at: g.starts_at, ends_at: g.ends_at,
                    expected: expectedPeople(g.event_key), admitted: admittedPeople(g.event_key)
                })),
                bridges_events: bridgesEventList().map(ev => ({
                    id: ev.id, label: (ev.city || ev.name || 'Bridges'), date: ev.event_date || '', time: ev.event_time || '',
                    expected: bridgesExpected(ev.id), admitted: bridgesAdmitted(ev.id),
                    home: String(ev.id) === String(homeBridgesId() || '')
                }))
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/v2/eventday/door', auth, staffOrAdmin, (req, res) => {
        try {
            const rehearsal = String(req.query.rehearsal || '') === '1';
            if (rehearsal) return res.json({ rehearsal: true, rows: rehearsalDoor() });
            const eventKey = GATE_KEYS.includes(String(req.query.event)) ? String(req.query.event) : defaultGateKey(gates());
            const bev = eventKey === 'bridges' ? String(req.query.bridges_event || '').trim() || null : null;
            res.json({ rehearsal: false, event: eventKey, bridges_event: bev, rows: doorRows(eventKey, String(req.query.q || '').trim(), 400, bev) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/v2/eventday/scan', auth, staffOrAdmin, (req, res) => {
        try {
            const r = doScan(req.body, { id: req.user.id, email: req.user.email });
            res.status(r.status).json(r.out);
        } catch (e) { console.error('[v2/event-day] scan:', e); res.status(500).json({ ok: false, result: 'error', message: e.message }); }
    });

    // ID-check scan (Alen's rule: identify FIRST, admit on an explicit tap). Resolves a code
    // against every door read-only — who this is, what they booked, paid state, party progress —
    // and never writes. The frontend then admits through the normal /scan with an event key.
    app.post('/api/v2/eventday/lookup', auth, staffOrAdmin, (req, res) => {
        try {
            const b = req.body || {};
            const code = String(b.code || '').trim();
            if (!code) return res.status(400).json({ ok: false, result: 'bad_code', message: 'Scan or type a code first.' });
            if (!schemaReady) ensureSchema();
            const T = admitTableFor(!!b.rehearsal);
            let person = null;
            const doors = [];
            for (const k of GATE_KEYS) {
                let hit = null;
                try { hit = resolveCode(code, k); } catch (e) {}
                if (!hit) continue;
                const fitted = fitForGate(hit, k, false);
                const use = (fitted.ok && (fitted.hit || hit)) || null;
                const row = (use || hit).row;
                if (!person) person = {
                    name: fullName(row), email: row.email || '',
                    institution: row.institution || row.organization || '',
                    country: row.country || ''
                };
                if (use) {
                    const ps = party(use.row);
                    let adm = null;
                    try { adm = q.get(`SELECT admitted_count, party_size FROM ${T} WHERE registration_ref = ? AND event_key = ?`, [String(use.row.id), k]); } catch (e) {}
                    const admitted = adm ? Number(adm.admitted_count) || 0 : 0;
                    doors.push({ event: k, label: (gateFor(k) || {}).label || k, registered: true, ok: true,
                        meta: metaFor(use.table, use.row, k), party_size: ps, admitted, remaining: Math.max(0, ps - admitted) });
                } else if (!['wrong_event', 'not_registered_for_event'].includes(fitted.block)) {
                    doors.push({ event: k, label: (gateFor(k) || {}).label || k, registered: true, ok: false,
                        block: fitted.block, message: fitted.message });
                }
            }
            if (!person) return res.json({ ok: false, result: 'not_found', message: 'No registration found for this code.' });
            res.json({ ok: true, person, doors });
        } catch (e) { console.error('[v2/event-day] lookup:', e); res.status(500).json({ ok: false, result: 'error', message: e.message }); }
    });

    app.post('/api/v2/eventday/rehearsal/reset', auth, staffOrAdmin, (req, res) => {
        try {
            q.run('DELETE FROM v2_checkin_rehearsal');
            audit(req.user, 'eventday.rehearsal_reset', 'rehearsal admits cleared');
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/v2/eventday/log', auth, staffOrAdmin, (req, res) => {
        try {
            const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 30));
            res.json({ scans: q.all('SELECT * FROM v2_checkin_log ORDER BY ts DESC LIMIT ?', [limit]) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Ops notes for the venue-map card (per gate; shared by the whole team).
    app.get('/api/v2/eventday/notes', auth, staffOrAdmin, (req, res) => {
        try {
            const key = GATE_KEYS.includes(String(req.query.event)) ? String(req.query.event) : 'conference';
            res.json(q.get('SELECT * FROM v2_eventday_notes WHERE event_key = ?', [key]) || { event_key: key, notes: '' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.put('/api/v2/eventday/notes', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const key = GATE_KEYS.includes(String(b.event)) ? String(b.event) : 'conference';
            const notes = String(b.notes == null ? '' : b.notes).slice(0, 4000);
            const now = new Date().toISOString();
            if (q.get('SELECT 1 x FROM v2_eventday_notes WHERE event_key = ?', [key])) {
                q.run('UPDATE v2_eventday_notes SET notes = ?, updated_at = ?, updated_by = ? WHERE event_key = ?', [notes, now, req.user.email, key]);
            } else {
                q.run('INSERT INTO v2_eventday_notes (event_key, notes, updated_at, updated_by) VALUES (?,?,?,?)', [key, notes, now, req.user.email]);
            }
            res.json({ ok: true, event_key: key, updated_at: now });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------------------------------------------------------------- door-staff tokens
    function tokenExpiry(gate) {
        if (gate && gate.ends_at && !isNaN(Date.parse(gate.ends_at))) {
            return new Date(Date.parse(gate.ends_at) + 3 * 3600 * 1000).toISOString(); // event end + 3 h of stragglers
        }
        return new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    }
    function tokenAlive(t) {
        if (!t || Number(t.revoked)) return false;
        if (t.expires_at && !isNaN(Date.parse(t.expires_at)) && Date.now() > Date.parse(t.expires_at)) return false;
        return true;
    }
    function doorUrl(req, token) {
        const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
        // behind the staging launcher this backend lives under /__admin (header set by launcher.js)
        const base = String(req.headers['x-medx-staging-prefix'] || '').replace(/\/$/, '');
        return `${proto}://${host}${base}/api/v2/door/${token}`;
    }

    app.get('/api/v2/eventday/door-tokens', auth, adminOnly, (req, res) => {
        try {
            const rows = q.all('SELECT * FROM v2_door_tokens ORDER BY created_at DESC LIMIT 30');
            res.json({ tokens: rows.map(t => ({ id: t.id, event_key: t.event_key, label: t.label, created_at: t.created_at, expires_at: t.expires_at, revoked: !!Number(t.revoked), alive: tokenAlive(t), url: doorUrl(req, t.token) })) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/v2/eventday/door-tokens', auth, adminOnly, async (req, res) => {
        try {
            const b = req.body || {};
            const key = GATE_KEYS.includes(String(b.event)) ? String(b.event) : defaultGateKey(gates());
            const gate = gateFor(key);
            if (!gate) return res.status(400).json({ error: 'Unknown door: ' + key });
            const token = crypto.randomBytes(18).toString('hex');
            const id = crypto.randomUUID();
            const expires = tokenExpiry(gate);
            q.run('INSERT INTO v2_door_tokens (id, token, event_key, label, created_by, expires_at) VALUES (?,?,?,?,?,?)',
                [id, token, key, gate.label || key, req.user.email, expires]);
            audit(req.user, 'eventday.door_token_mint', `${key} · expires ${expires}`);
            const url = doorUrl(req, token);
            let qr = null;
            try { qr = await require('qrcode').toDataURL(url, { margin: 1, width: 320 }); } catch (e) {}
            res.json({ ok: true, id, event_key: key, url, expires_at: expires, qr_data_url: qr });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/v2/eventday/door-tokens/:id/revoke', auth, adminOnly, (req, res) => {
        try {
            const t = q.get('SELECT * FROM v2_door_tokens WHERE id = ?', [req.params.id]);
            if (!t) return res.status(404).json({ error: 'No such link' });
            q.run('UPDATE v2_door_tokens SET revoked = 1 WHERE id = ?', [t.id]);
            audit(req.user, 'eventday.door_token_revoke', `${t.event_key} · ${String(t.token).slice(0, 6)}…`);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/v2/eventday/door-tokens/:id/qr', auth, adminOnly, async (req, res) => {
        try {
            const t = q.get('SELECT * FROM v2_door_tokens WHERE id = ?', [req.params.id]);
            if (!t) return res.status(404).json({ error: 'No such link' });
            const url = doorUrl(req, t.token);
            const qr = await require('qrcode').toDataURL(url, { margin: 1, width: 320 });
            res.json({ ok: true, url, qr_data_url: qr });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------------------------------------------------------------- public door scanner (tokenized, no account)
    function doorTokenRow(token) {
        const t = String(token || '').trim();
        if (!/^[0-9a-f]{24,64}$/i.test(t)) return null;
        try { return q.get('SELECT * FROM v2_door_tokens WHERE token = ?', [t]); } catch (e) { return null; }
    }
    const escHtml = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function doorEndedPage(reason) {
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Med&X — door link</title>
<style>body{margin:0;background:#191512;color:#f7f1e6;font-family:Inter,-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:32px}
.line{font-family:Georgia,serif;font-style:italic;font-size:30px;line-height:1.15;margin-top:16px}.why{font-size:14px;color:rgba(247,241,230,.7);margin-top:12px;line-height:1.6}</style></head>
<body><div><span style="display:inline-block;width:28px;height:1px;background:#c9a962"></span>
<div class="line">This door link has ended.</div>
<p class="why">${escHtml(reason)}<br>Ask the Med&X team for a fresh link if the door is still open.</p></div></body></html>`;
    }

    function doorScannerPage(t, req) {
        const gate = gateFor(t.event_key) || { label: t.label || t.event_key };
        const expires = t.expires_at ? new Date(t.expires_at) : null;
        const expLabel = expires ? expires.toLocaleString('en-GB', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'the end of the event';
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Med&X door — ${escHtml(gate.label)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#191512;color:#f7f1e6;font-family:Inter,-apple-system,sans-serif;min-height:100vh}
.wrap{max-width:440px;margin:0 auto;padding:22px 18px 40px;display:flex;flex-direction:column;gap:14px}
.micro{font:600 10px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase}
.gold{color:#c9a962}.soft{color:rgba(247,241,230,.65)}
.cam{position:relative;background:rgba(247,241,230,.06);border:1px solid rgba(247,241,230,.2);aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;overflow:hidden}
.cam video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.laser{position:absolute;left:14px;right:14px;top:50%;height:2px;background:rgba(155,27,34,.75)}
.btn{display:block;width:100%;padding:13px 16px;background:#9b1b22;color:#fff;font:600 11px Inter,sans-serif;letter-spacing:.15em;text-transform:uppercase;border:0;cursor:pointer;box-sizing:border-box;text-align:center}
.btn.ghost{background:transparent;border:1px solid rgba(247,241,230,.3);color:#f7f1e6}
.inp{width:100%;box-sizing:border-box;border:1px solid rgba(247,241,230,.3);background:rgba(247,241,230,.08);padding:12px;font:400 14px Inter,sans-serif;color:#f7f1e6}
.inp::placeholder{color:rgba(247,241,230,.45)}
.result{border:1px solid rgba(247,241,230,.2);padding:14px 16px;display:none;flex-direction:column;gap:6px}
.result.ok{border-color:#2f7d4f}.result.warn{border-color:#c9a962}.result.bad{border-color:#9b1b22;background:rgba(155,27,34,.14)}
.result .name{font-family:Fraunces,Georgia,serif;font-size:22px;line-height:1.1}
.badge{display:none;align-self:flex-start;background:#c9a962;color:#191512;padding:4px 9px;font:600 9.5px Inter,sans-serif;letter-spacing:.13em}
</style></head><body><div class="wrap">
<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
  <span class="micro gold">MED&amp;X · DOOR SCANNER</span><div style="flex:1"></div>
  <span class="micro soft" id="count">—</span>
</div>
<div style="font-family:Fraunces,Georgia,serif;font-size:26px;line-height:1.1">${escHtml(gate.label)}</div>
<div style="font-size:12px" class="soft">Scan the guest's QR — green means in. Works offline and syncs back. This link needs no account and stops working at ${escHtml(expLabel)}.</div>
<span class="badge" id="pending"></span>
<div class="cam" id="cam"><span class="micro soft" style="max-width:200px;text-align:center" id="camHint">tap START CAMERA and point at the QR</span><span class="laser"></span></div>
<button class="btn ghost" id="camBtn" type="button">START CAMERA</button>
<div class="result" id="res"><span class="micro" id="resState"></span><span class="name" id="resName"></span><span style="font-size:12.5px" class="soft" id="resMeta"></span><span style="font-size:13px" id="resMsg"></span><button class="btn" id="more" type="button" style="display:none;margin-top:6px">ADMIT ONE MORE</button></div>
<form id="manual" style="display:flex;flex-direction:column;gap:8px">
  <span class="micro soft">QR WON'T SCAN? TYPE THE CODE OR EMAIL</span>
  <input class="inp" id="code" autocomplete="off" placeholder="code under the QR, or the guest's email">
  <button class="btn" type="submit">ADMIT</button>
</form>
<span class="micro soft" style="margin-top:8px">JEDNA KARTA, SVA VRATA</span>
</div>
<script src="/vendor/jsqr.min.js"></script>
<script>
(function(){
  var TOKEN=${JSON.stringify(String(t.token))};
  var QKEY='medx_door_queue_'+TOKEN.slice(0,8);
  var lastCode='',lastAt=0,stream=null,video=null,raf=0;
  var $=function(id){return document.getElementById(id)};
  function queue(){try{return JSON.parse(localStorage.getItem(QKEY)||'[]')}catch(e){return[]}}
  function setQueue(a){try{localStorage.setItem(QKEY,JSON.stringify(a))}catch(e){}
    var b=$('pending');if(a.length){b.style.display='inline-block';b.textContent=a.length+' PENDING — SYNCS WHEN BACK ONLINE'}else{b.style.display='none'}}
  function show(state,out){var r=$('res');r.style.display='flex';r.className='result '+state;
    $('resState').textContent=(out.result||'').replace(/_/g,' ').toUpperCase();
    $('resState').style.color=state==='ok'?'#2f7d4f':state==='warn'?'#c9a962':'#ff8a8f';
    $('resName').textContent=(out.ticket&&out.ticket.name)||'';
    $('resMeta').textContent=(out.ticket&&out.ticket.meta)||'';
    $('resMsg').textContent=out.message||'';
    var m=$('more');if(out.ok&&out.remaining>0){m.style.display='block';m.onclick=function(){send(out._code||lastCode,1)}}else{m.style.display='none'}}
  function send(code,admit){
    fetch('/api/v2/door/'+TOKEN+'/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,admit:admit||1})})
    .then(function(r){if(r.status===410){document.body.innerHTML='<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:30px"><div><div style="font-family:Georgia,serif;font-style:italic;font-size:28px">This door link has ended.</div></div></div>';throw new Error('ended')}return r.json()})
    .then(function(out){out._code=code;show(out.ok?(out.remaining>0?'warn':'ok'):(out.result==='over_capacity'||out.result==='not_paid'||out.result==='revoked'?'bad':'warn'),out);refresh()})
    .catch(function(e){if(e&&e.message==='ended')return;var a=queue();a.push({code:code,admit:admit||1,ts:Date.now()});setQueue(a);
      show('warn',{result:'queued offline',message:'No connection — saved on this phone, syncs by itself when the network is back.',ticket:{name:code}})})}
  function flush(){var a=queue();if(!a.length)return;var item=a[0];
    fetch('/api/v2/door/'+TOKEN+'/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:item.code,admit:item.admit,method:'manual'})})
    .then(function(r){return r.json()}).then(function(){a.shift();setQueue(a);if(a.length)flush();else refresh()}).catch(function(){})}
  function refresh(){fetch('/api/v2/door/'+TOKEN+'/status').then(function(r){return r.json()}).then(function(s){if(s&&s.gate)$('count').textContent=s.gate.admitted+' OF '+s.gate.expected+' IN'}).catch(function(){})}
  function tick(){if(!video)return;raf=requestAnimationFrame(tick);
    if(video.readyState!==video.HAVE_ENOUGH_DATA)return;
    var c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;
    var x=c.getContext('2d');x.drawImage(video,0,0,c.width,c.height);
    try{var img=x.getImageData(0,0,c.width,c.height);var hit=window.jsQR&&jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
      if(hit&&hit.data){var now=Date.now();if(hit.data!==lastCode||now-lastAt>4000){lastCode=hit.data;lastAt=now;send(hit.data,1)}}}catch(e){}}
  $('camBtn').onclick=function(){
    if(stream){stream.getTracks().forEach(function(t){t.stop()});stream=null;video&&video.remove();video=null;cancelAnimationFrame(raf);$('camBtn').textContent='START CAMERA';$('camHint').style.display='';return}
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(s){stream=s;video=document.createElement('video');video.setAttribute('playsinline','');video.srcObject=s;video.play();$('cam').appendChild(video);$('camHint').style.display='none';$('camBtn').textContent='STOP CAMERA';tick()})
    .catch(function(){$('camHint').textContent='camera unavailable — type the code below'})};
  $('manual').addEventListener('submit',function(e){e.preventDefault();var v=$('code').value.trim();if(!v)return;lastCode=v;send(v,1);$('code').value=''});
  window.addEventListener('online',flush);setInterval(flush,20000);setQueue(queue());refresh();
})();
</script></body></html>`;
    }

    app.get('/api/v2/door/:token', (req, res) => {
        const t = doorTokenRow(req.params.token);
        if (!t) { res.status(404); return res.send(doorEndedPage('This link does not exist.')); }
        if (!tokenAlive(t)) { res.status(410); return res.send(doorEndedPage(Number(t.revoked) ? 'It was switched off by the team.' : 'The event this link was made for has ended.')); }
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.send(doorScannerPage(t, req));
    });

    app.get('/api/v2/door/:token/status', (req, res) => {
        const t = doorTokenRow(req.params.token);
        if (!t || !tokenAlive(t)) return res.status(410).json({ error: 'This door link has ended.' });
        try {
            res.json({ ok: true, gate: { event_key: t.event_key, expected: expectedPeople(t.event_key), admitted: admittedPeople(t.event_key) }, expires_at: t.expires_at });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/v2/door/:token/scan', (req, res) => {
        const t = doorTokenRow(req.params.token);
        if (!t || !tokenAlive(t)) return res.status(410).json({ ok: false, result: 'ended', error: 'This door link has ended.' });
        try {
            const b = Object.assign({}, req.body || {});
            b.event = t.event_key;           // a door token is scoped to ONE gate
            b.rehearsal = false;             // rehearsal never leaves the admin room
            b.override = false;              // overrides need a signed-in admin
            const r = doScan(b, 'door:' + String(t.token).slice(0, 6));
            res.status(r.status).json(r.out);
        } catch (e) { console.error('[v2/event-day] door scan:', e); res.status(500).json({ ok: false, result: 'error', message: e.message }); }
    });

    log('event-day: scan ledger + rehearsal + door tokens ready');
};
