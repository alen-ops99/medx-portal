/**
 * v2/apple-pass.js — Apple Wallet .pkpass generation for the member portal.
 *
 * Dual-natured on purpose (see v2/index.js):
 *   1) REGISTRY MOUNT — the default export is the usual `(app, ctx)` function; it only adds
 *      routes under /api/v2/apple/… and stashes ctx for the helpers:
 *        GET /api/v2/apple/pass/:token.pkpass — TOKENIZED, no login (for e-mail links). token =
 *            HMAC-signed (ctx.JWT_SECRET) {k: 'm'|'t', i: <user|item id>, x: <exp epoch s>};
 *            ownership was enforced when the token was minted, so possession = authorization.
 *        GET /api/v2/apple/link/:kind/:id    — authed helper (kind 'member'|'card'|'ticket');
 *            returns { configured, provider, url, expires_at } for the front end / e-mails.
 *   2) HELPERS for v2/wallet.js's two Apple gates (card pass + per-ticket pass):
 *        isConfigured(), respondMemberPass(req, res, {user, meta, qr}),
 *        respondTicketPass(req, res, {item, user, qrMessage}).
 *      Both respond* helpers stream the signed .pkpass — except to portal XHRs
 *      (Accept: application/json), which get { configured: true, save_url } pointing at the
 *      tokenized route, so js/views/me.js's handlePassResponse works unchanged.
 *
 * The .pkpass itself (Apple "PassKit Package"): a STORE-only ZIP of pass.json +
 * manifest.json (SHA-1 of every other file) + signature (detached PKCS#7/DER over
 * manifest.json, signed by the Pass Type ID cert with the WWDR G4 intermediate included)
 * + icon/logo (+ strip for event tickets) PNGs read from v2/apple-assets/. No new npm
 * dependency: the ZIP writer + CRC32 live below, and signing shells out to the `openssl`
 * binary (present on Render's image and macOS) with the PEMs from process.env written to
 * mode-600 files under os.tmpdir().
 *
 * Env (staging Render service already carries these; absent env → clean {configured:false}):
 *   APPLE_WALLET_CERT_PEM   — Pass Type ID certificate (CN pass.hr.medx.plexus)
 *   APPLE_WALLET_KEY_PEM    — its RSA private key (no passphrase)
 *   APPLE_WALLET_WWDR_PEM   — Apple WWDR G4 intermediate
 *   APPLE_WALLET_TEAM_ID    — 4XC4NRV538
 *   APPLE_WALLET_PASS_TYPE_ID — pass.hr.medx.plexus
 *
 * NOTE on the tokenized route's data access: it runs with no wallet.js closure available, so
 * the item/member resolution here MIRRORS v2/wallet.js (findItem bags, qrPayloadFor, memberQr,
 * memberMeta, ensureRegToken). Keep the two in sync — wallet.js is the source of truth; the
 * scanner contract (regId/evt payloads, raw checkin_token) is documented in its header.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const state = { ctx: null };                       // set by the registry mount (apple-pass < wallet alphabetically)
const ASSETS_DIR = path.join(__dirname, 'apple-assets');
const TOKEN_TTL_S = 30 * 24 * 3600;                // e-mail links stay valid for 30 days
const SUPPORT_EMAIL = 'laura.rodman@medx.hr';
const COLORS = { background: 'rgb(25,21,18)', foreground: 'rgb(247,241,230)', label: 'rgb(201,169,98)' };

// ---------------------------------------------------------------- env + PEM temp files
function isConfigured() {
    return !!(process.env.APPLE_WALLET_CERT_PEM && process.env.APPLE_WALLET_KEY_PEM &&
        process.env.APPLE_WALLET_WWDR_PEM && process.env.APPLE_WALLET_TEAM_ID &&
        process.env.APPLE_WALLET_PASS_TYPE_ID);
}
const normPem = v => {
    const s = String(v || '').trim();
    return (s.includes('-----') && !s.includes('\n')) ? s.replace(/\\n/g, '\n') : s;  // Render one-line paste
};
let pemDir = null;
function pemFiles() {
    if (pemDir && fs.existsSync(path.join(pemDir, 'cert.pem'))) {
        return { cert: path.join(pemDir, 'cert.pem'), key: path.join(pemDir, 'key.pem'), wwdr: path.join(pemDir, 'wwdr.pem') };
    }
    pemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medx-applepass-'));
    fs.chmodSync(pemDir, 0o700);
    fs.writeFileSync(path.join(pemDir, 'cert.pem'), normPem(process.env.APPLE_WALLET_CERT_PEM), { mode: 0o600 });
    fs.writeFileSync(path.join(pemDir, 'key.pem'), normPem(process.env.APPLE_WALLET_KEY_PEM), { mode: 0o600 });
    fs.writeFileSync(path.join(pemDir, 'wwdr.pem'), normPem(process.env.APPLE_WALLET_WWDR_PEM), { mode: 0o600 });
    return pemFiles();
}

// ---------------------------------------------------------------- STORE-only ZIP writer
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
    return t;
})();
function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (~c) >>> 0;
}
function zipStore(entries) {                        // entries: [{ name, data:Buffer }] → Buffer
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    const locals = [], central = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'ascii');
        const crc = crc32(data);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);          // local header, version 2.0
        lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);                    // flags, method 0 = STORE
        lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
        lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
        locals.push(lh, nameBuf, data);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);                   // flags, method STORE
        ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
        ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);                              // extra/comment/disk/attrs stay 0
        ch.writeUInt32LE(offset, 42);
        central.push(ch, nameBuf);
        offset += 30 + nameBuf.length + data.length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
}

// ---------------------------------------------------------------- manifest + detached PKCS#7
const sha1hex = buf => crypto.createHash('sha1').update(buf).digest('hex');
function signManifest(manifestBuf) {
    const { cert, key, wwdr } = pemFiles();
    const id = crypto.randomBytes(6).toString('hex');
    const inFile = path.join(os.tmpdir(), `medx-manifest-${id}.json`);
    const outFile = path.join(os.tmpdir(), `medx-signature-${id}.der`);
    try {
        fs.writeFileSync(inFile, manifestBuf, { mode: 0o600 });
        const r = spawnSync('openssl', [
            'smime', '-binary', '-sign', '-signer', cert, '-inkey', key, '-certfile', wwdr,
            '-in', inFile, '-out', outFile, '-outform', 'DER', '-noattr'
        ], { timeout: 15000 });
        if (r.error) throw r.error;
        if (r.status !== 0) throw new Error('openssl smime exited ' + r.status + ': ' + String(r.stderr || '').slice(0, 300));
        return fs.readFileSync(outFile);
    } finally {
        try { fs.unlinkSync(inFile); } catch (e) { /* already gone */ }
        try { fs.unlinkSync(outFile); } catch (e) { /* never written */ }
    }
}

// ---------------------------------------------------------------- images (committed in v2/apple-assets/)
const IMAGE_SETS = {
    base: ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png'],
    strip: ['strip.png', 'strip@2x.png', 'strip@3x.png']                    // event tickets only
};
let assetCache = null;
function assets() {
    if (assetCache) return assetCache;
    const out = {};
    for (const name of [...IMAGE_SETS.base, ...IMAGE_SETS.strip]) {
        const p = path.join(ASSETS_DIR, name);
        if (fs.existsSync(p)) out[name] = fs.readFileSync(p);
    }
    assetCache = out;
    return out;
}

// ---------------------------------------------------------------- pass.json + .pkpass assembly
// model: { style: 'eventTicket'|'generic', serial, description, fields: {primary, secondary,
//          auxiliary, back}, qrMessage, altText, relevantDate?, strip? }
function buildPkpass(model) {
    const img = assets();
    for (const name of IMAGE_SETS.base) if (!img[name]) throw new Error('missing pass asset ' + name);
    const pass = {
        formatVersion: 1,
        passTypeIdentifier: process.env.APPLE_WALLET_PASS_TYPE_ID,
        teamIdentifier: process.env.APPLE_WALLET_TEAM_ID,
        serialNumber: model.serial,
        organizationName: 'Med&X',
        description: model.description,
        backgroundColor: COLORS.background,
        foregroundColor: COLORS.foreground,
        labelColor: COLORS.label,
        barcode: { format: 'PKBarcodeFormatQR', message: model.qrMessage, messageEncoding: 'iso-8859-1', altText: model.altText || undefined },
        barcodes: [{ format: 'PKBarcodeFormatQR', message: model.qrMessage, messageEncoding: 'iso-8859-1', altText: model.altText || undefined }],
        [model.style]: {
            primaryFields: model.fields.primary,
            secondaryFields: model.fields.secondary,
            auxiliaryFields: model.fields.auxiliary,
            backFields: model.fields.back
        }
    };
    if (model.relevantDate) pass.relevantDate = model.relevantDate;
    const files = [{ name: 'pass.json', data: Buffer.from(JSON.stringify(pass, null, 2), 'utf8') }];
    for (const name of IMAGE_SETS.base) files.push({ name, data: img[name] });
    if (model.style === 'eventTicket' && model.strip !== false) {
        for (const name of IMAGE_SETS.strip) if (img[name]) files.push({ name, data: img[name] });
    }
    const manifest = {};
    for (const f of files) manifest[f.name] = sha1hex(f.data);
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    const signature = signManifest(manifestBuf);
    return zipStore([...files, { name: 'manifest.json', data: manifestBuf }, { name: 'signature', data: signature }]);
}
function sendPkpass(res, buf) {
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', 'attachment; filename="medx-plexus.pkpass"');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
}

// ---------------------------------------------------------------- signed download tokens
const b64u = buf => Buffer.from(buf).toString('base64url');
const hmac = payload => crypto.createHmac('sha256', String(state.ctx && state.ctx.JWT_SECRET || ''))
    .update('medx-apple-pass:' + payload).digest('base64url');
function mintToken(kind, id) {
    const payload = b64u(JSON.stringify({ k: kind === 'member' ? 'm' : 't', i: String(id), x: Math.floor(Date.now() / 1000) + TOKEN_TTL_S }));
    return payload + '.' + hmac(payload);
}
function verifyToken(token) {
    const dot = String(token || '').lastIndexOf('.');
    if (dot < 1) return null;
    const payload = token.slice(0, dot), sig = token.slice(dot + 1);
    const expect = hmac(payload);
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
    if (!claims || !claims.i || !['m', 't'].includes(claims.k)) return null;
    if (!Number.isFinite(claims.x) || claims.x < Math.floor(Date.now() / 1000)) return null;
    return { kind: claims.k === 'm' ? 'member' : 'ticket', id: String(claims.i), exp: claims.x };
}
function baseUrl(req) {
    return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}
const passUrl = (req, kind, id) => `${baseUrl(req)}/api/v2/apple/pass/${mintToken(kind, id)}.pkpass`;

// ---------------------------------------------------------------- db mirror of v2/wallet.js
// (findItem bags / qrPayloadFor / memberQr / memberMeta — only what a pass needs; the token
//  route has no wallet closure to lean on. wallet.js is the source of truth.)
function q() {
    const db = state.ctx.db();
    return {
        get(sql, params = []) {
            try {
                const stmt = db.prepare(sql);
                if (params.length) stmt.bind(params);
                if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
                stmt.free(); return null;
            } catch (e) { return null; }
        },
        all(sql, params = []) {
            try {
                const stmt = db.prepare(sql);
                if (params.length) stmt.bind(params);
                const rows = [];
                while (stmt.step()) rows.push(stmt.getAsObject());
                stmt.free(); return rows;
            } catch (e) { return []; }
        },
        run(sql, params = []) { try { db.run(sql, params); } catch (e) { /* read-only fallback */ } }
    };
}
function ensureRegToken(reg) {
    if (reg && reg.checkin_token) return reg.checkin_token;
    const tok = crypto.randomBytes(24).toString('hex');
    q().run('UPDATE registrations SET checkin_token = ? WHERE id = ?', [tok, reg.id]);
    return tok;
}
function qrPayloadFor(item) {                        // byte-compatible with wallet.js qrPayloadFor
    if (item.kind === 'gala') {
        const ca = q().get('SELECT * FROM croatians_abroad_registrations WHERE id = ? OR gala_registration_id = ?', [item.id, item.id]);
        if (ca) {
            const events = [ca.selected_conference ? 'conference' : null, ca.selected_bridges ? 'bridges' : null, ca.selected_gala ? 'gala' : null].filter(Boolean);
            const p = { type: 'MEDX_MEMBER', caRegId: ca.id, regId: ca.gala_registration_id || ca.id, email: ca.email, name: `${ca.first_name} ${ca.last_name || ''}`.trim(), evt: ca.selected_gala ? 'gala' : 'croatians-abroad', evtName: ca.selected_gala ? 'Plexus 2026 — Gala Evening' : 'Plexus 2026', events };
            if (ca.amount_paid) p.amt = ca.amount_paid;
            if (ca.dietary) p.diet = ca.dietary;
            return p;
        }
        return { type: 'MEDX_MEMBER', regId: item.id, evt: 'gala' };
    }
    const EVT = { plexus: 'plexus', bridges: 'bridges', donor: 'bridges', forum: 'forum', 'signup-form': 'signup-form' };
    return { type: 'MEDX_MEMBER', regId: item.id, evt: EVT[item.kind] || item.kind };
}
// Item bags by id, probed in wallet.js findItem order. owner = {id, email} enforces ownership
// (the authed /link route); null trusts the caller (a verified token).
function resolveItem(id, owner) {
    const Q = q();
    const uid = owner ? owner.id : null;
    const em = owner ? ((owner.email || '__none__').toLowerCase()) : null;
    let r = Q.get(`SELECT r.*, c.name AS conference_name, c.start_date, c.end_date, c.venue_name, c.venue_city,
                          t.name AS ticket_name, u.first_name AS u_first, u.last_name AS u_last, u.email AS u_email
                     FROM registrations r JOIN conferences c ON r.conference_id = c.id
                     LEFT JOIN ticket_types t ON r.ticket_type_id = t.id
                     LEFT JOIN users u ON r.user_id = u.id
                    WHERE r.id = ?` + (owner ? ' AND (r.user_id = ? OR lower(r.email) = ?)' : ''), owner ? [id, uid, em] : [id]);
    if (r) {
        const paid = r.payment_status === 'paid' || r.status === 'confirmed';
        const amount = Number(r.amount_paid || 0);
        return {
            kind: 'plexus', id: r.id, table: 'registrations', title: r.conference_name || 'Plexus Conference',
            ticket_name: r.ticket_name || r.registration_type || 'General', date: r.start_date, end_date: r.end_date,
            venue: [r.venue_name, r.venue_city].filter(Boolean).join(', '),
            guest_name: ((r.first_name || r.u_first || '') + ' ' + (r.last_name || r.u_last || '')).trim(),
            amount, invoice_number: r.invoice_number || null, includes_gala: !!Number(r.includes_gala),
            status: Number(r.revoked) ? 'revoked' : (r.status === 'cancelled' ? 'cancelled' : (paid ? (amount > 0 && r.payment_status === 'paid' ? 'paid' : 'confirmed') : 'pending')),
            qrMessage: ensureRegToken(r)
        };
    }
    r = Q.get('SELECT * FROM gala_registrations WHERE id = ?' + (owner ? ' AND (user_id = ? OR lower(email) = ?)' : ''), owner ? [id, uid, em] : [id]);
    if (r) {
        const g = Q.get("SELECT title, date, time, venue FROM gala_settings WHERE id = 'default'") || {};
        const paid = r.payment_status === 'paid' || r.payment_status === 'vip-comp';
        const confirmed = paid || ['confirmed', 'approved', 'vip-comp'].includes(String(r.status || ''));
        const bag = {
            kind: 'gala', id: r.id, table: 'gala_registrations', title: g.title || 'Gala Evening',
            ticket_name: r.pricing === 'bundle' ? 'Gala seat · bundle' : 'Gala seat', date: g.date || null, end_date: null, time: g.time || null,
            venue: g.venue || '', guest_name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(),
            amount: Number(r.amount_paid || 0), invoice_number: r.invoice_number || null,
            party: 1 + Math.max(0, parseInt(r.guest_count, 10) || 0), seat_number: r.seat_number || null,
            status: String(r.status || '') === 'cancelled' ? 'cancelled' : (paid ? (r.payment_status === 'vip-comp' ? 'vip' : 'paid') : (confirmed ? 'confirmed' : 'pending'))
        };
        bag.qrMessage = JSON.stringify(qrPayloadFor(bag));
        return bag;
    }
    r = Q.get(`SELECT br.*, e.name AS event_name, e.event_date, e.event_time, e.venue_name, e.city, e.slug
                 FROM bridges_registrations br JOIN bridges_events e ON br.event_id = e.id
                WHERE br.id = ?` + (owner ? ' AND (br.user_id = ? OR lower(br.email) = ?)' : ''), owner ? [id, uid, em] : [id]);
    if (r) {
        const bag = {
            kind: r.slug === 'donor-night' ? 'donor' : 'bridges', id: r.id, table: 'bridges_registrations',
            title: r.event_name || 'Building Bridges', ticket_name: 'Registration', date: r.event_date, end_date: null,
            time: r.event_time || null, venue: [r.venue_name, r.city].filter(Boolean).join(', '),
            guest_name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(), amount: Number(r.amount_paid || 0),
            invoice_number: null, status: String(r.status || '') === 'cancelled' ? 'cancelled' : 'confirmed'
        };
        bag.qrMessage = JSON.stringify(qrPayloadFor(bag));
        return bag;
    }
    r = Q.get(`SELECT fer.*, fe.title AS event_title, COALESCE(fe.start_date,'') AS event_date, fe.venue
                 FROM forum_event_registrations fer JOIN forum_events fe ON fer.event_id = fe.id
                WHERE fer.id = ?` + (owner ? ' AND lower(fer.email) = ?' : ''), owner ? [id, em] : [id]);
    if (r) {
        const paid = r.payment_status === 'paid' || !r.payment_status;
        const bag = {
            kind: 'forum', id: r.id, table: 'forum_event_registrations', title: r.event_title || 'Biomedical Forum',
            ticket_name: r.ticket_type || 'Forum', date: r.event_date, end_date: null, venue: r.venue || '',
            guest_name: (r.name || ((r.first_name || '') + ' ' + (r.last_name || '')).trim()), amount: Number(r.payment_amount || 0),
            invoice_number: r.invoice_number || null,
            status: String(r.status || '') === 'cancelled' ? 'cancelled' : (paid ? 'confirmed' : 'pending')
        };
        bag.qrMessage = JSON.stringify(qrPayloadFor(bag));
        return bag;
    }
    r = Q.get(`SELECT sr.*, sf.title AS form_title, sf.event_date, sf.event_time, sf.venue, sf.slug
                 FROM signup_form_responses sr JOIN signup_forms sf ON sr.form_id = sf.id
                WHERE sr.id = ?` + (owner ? ' AND lower(sr.email) = ?' : ''), owner ? [id, em] : [id]);
    if (r) {
        const bag = {
            kind: 'signup-form', id: r.id, table: 'signup_form_responses', title: r.form_title || 'Med&X event',
            ticket_name: 'Registration', date: r.event_date, end_date: null, time: r.event_time || null, venue: r.venue || '',
            guest_name: r.name || '', amount: 0, invoice_number: null,
            status: r.is_waitlisted ? 'waitlisted' : 'confirmed'
        };
        bag.qrMessage = JSON.stringify(qrPayloadFor(bag));
        return bag;
    }
    r = Q.get(`SELECT * FROM croatians_abroad_registrations WHERE id = ? AND selected_conference = 1` +
        (owner ? ' AND (user_id = ? OR lower(email) = ?)' : ''), owner ? [id, uid, em] : [id]);
    if (r) {
        const c = Q.get('SELECT name, start_date, end_date, venue_name, venue_city FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1') || {};
        const bag = {
            kind: 'plexus', id: r.id, table: 'croatians_abroad_registrations', title: c.name || 'Plexus Conference',
            ticket_name: 'Free registration', date: c.start_date, end_date: c.end_date,
            venue: [c.venue_name, c.venue_city].filter(Boolean).join(', '),
            guest_name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim(), amount: 0,
            invoice_number: r.invoice_number || null, includes_gala: !!Number(r.selected_gala),
            party: 1 + Math.max(0, parseInt(r.guest_count, 10) || 0),
            status: String(r.conference_status || '') === 'cancelled' ? 'cancelled' : 'confirmed'
        };
        bag.qrMessage = JSON.stringify(qrPayloadFor(bag));
        return bag;
    }
    return null;
}
function memberMeta(user) {                          // mirrors wallet.js memberMeta
    const TYPE = { student: 'Student', physician: 'Physician', senior_forum: 'Senior Forum Member', alumni: 'Alumni' };
    const STANDING = { good_standing: 'Member in good standing', pending: 'Standing under review', lapsed: 'Membership lapsed' };
    const m = q().get('SELECT member_type, member_since, standing FROM member_meta WHERE user_id = ?', [user.id]) || {};
    const sinceRaw = m.member_since || user.created_at || '';
    return {
        type_label: TYPE[m.member_type] || 'Member',
        since_year: sinceRaw ? String(sinceRaw).slice(0, 4) : String(new Date().getFullYear()),
        standing_label: STANDING[m.standing] || 'Member in good standing'
    };
}
function memberQrValue(user) {                       // mirrors wallet.js memberQr().value
    const Q = q();
    const reg = Q.get(`SELECT r.id, r.checkin_token FROM registrations r
                         JOIN conferences c ON r.conference_id = c.id
                        WHERE r.user_id = ? AND COALESCE(r.revoked,0) = 0 AND COALESCE(r.status,'') <> 'cancelled'
                        ORDER BY c.is_active DESC, c.year DESC, r.created_at DESC LIMIT 1`, [user.id]);
    if (reg) return ensureRegToken(reg);
    const em = (user.email || '__none__').toLowerCase();
    const others = [];
    Q.all(`SELECT id, created_at AS od, status, payment_status FROM gala_registrations
            WHERE (user_id = ? OR lower(email) = ?) AND COALESCE(status,'') NOT IN ('rejected','declined','cancelled')`, [user.id, em])
        .forEach(r2 => others.push({ kind: 'gala', id: r2.id, od: r2.od }));
    Q.all(`SELECT br.id, br.registered_at AS od, e.slug FROM bridges_registrations br
            JOIN bridges_events e ON br.event_id = e.id
            WHERE (br.user_id = ? OR lower(br.email) = ?) AND COALESCE(br.status,'') <> 'cancelled'`, [user.id, em])
        .forEach(r2 => others.push({ kind: r2.slug === 'donor-night' ? 'donor' : 'bridges', id: r2.id, od: r2.od }));
    Q.all(`SELECT id, registered_at AS od FROM forum_event_registrations
            WHERE lower(email) = ? AND COALESCE(status,'') <> 'cancelled'`, [em])
        .forEach(r2 => others.push({ kind: 'forum', id: r2.id, od: r2.od }));
    Q.all(`SELECT id, created_at AS od FROM signup_form_responses
            WHERE lower(email) = ? AND COALESCE(is_waitlisted,0) = 0`, [em])
        .forEach(r2 => others.push({ kind: 'signup-form', id: r2.id, od: r2.od }));
    const anyPlexusRow = Q.get('SELECT id FROM registrations WHERE user_id = ? OR lower(email) = ?', [user.id, em]);
    if (!anyPlexusRow) {
        Q.all(`SELECT id, created_at AS od FROM croatians_abroad_registrations
                WHERE selected_conference = 1 AND COALESCE(conference_status,'') <> 'cancelled'
                  AND (user_id = ? OR lower(email) = ?)`, [user.id, em])
            .forEach(r2 => others.push({ kind: 'plexus', id: r2.id, od: r2.od }));
    }
    others.sort((a, b) => String(b.od || '').localeCompare(String(a.od || '')));
    if (others.length) {
        const p = qrPayloadFor(others[0]);
        if (!p.email && user.email) p.email = user.email;
        return JSON.stringify(p);
    }
    return JSON.stringify({ type: 'MEDX_MEMBER', userId: user.id, email: user.email || '' });
}

// ---------------------------------------------------------------- pass models
function longDate(d) {
    if (!d) return '';
    try { return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return String(d); }
}
function dateRange(a, b) {
    if (!a) return '';
    if (!b || String(b).slice(0, 10) === String(a).slice(0, 10)) return longDate(a);
    const da = new Date(String(a).slice(0, 10) + 'T12:00:00'), db_ = new Date(String(b).slice(0, 10) + 'T12:00:00');
    if (da.getMonth() === db_.getMonth() && da.getFullYear() === db_.getFullYear()) {
        return da.toLocaleDateString('en-GB', { month: 'long' }) + ' ' + da.getDate() + '–' + db_.getDate() + ', ' + da.getFullYear();
    }
    return longDate(a) + ' – ' + longDate(b);
}
function relevantDateFor(item) {
    const d = item.date ? String(item.date).slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const month = Number(d.slice(5, 7));
    const offset = (month >= 4 && month <= 10) ? '+02:00' : '+01:00';       // Zagreb CEST/CET
    const time = /^\d{2}:\d{2}/.test(String(item.time || '')) ? String(item.time).slice(0, 5) : '09:00';
    return `${d}T${time}:00${offset}`;
}
const refNo = item => item.invoice_number || String(item.id).slice(0, 8).toUpperCase();
const SERIAL_CODE = {
    registrations: 'reg', gala_registrations: 'gala', bridges_registrations: 'br',
    forum_event_registrations: 'forum', signup_form_responses: 'form', croatians_abroad_registrations: 'ca'
};
function ticketModel(item, user, qrMessage) {
    // Enrich party/seat for gala + /plexus-form rows when the wallet.js bag doesn't carry them.
    if (item.party == null && (item.table === 'gala_registrations' || item.table === 'croatians_abroad_registrations')) {
        const r = q().get(`SELECT guest_count${item.table === 'gala_registrations' ? ', seat_number' : ''} FROM ${item.table} WHERE id = ?`, [item.id]);
        if (r) {
            item = { ...item, party: 1 + Math.max(0, parseInt(r.guest_count, 10) || 0) };
            if (r.seat_number) item.seat_number = r.seat_number;
        }
    }
    const when = (dateRange(item.date, item.end_date) + (item.time ? ` · ${String(item.time).slice(0, 5)}` : '')) || 'To be announced';
    const auxiliary = [
        { key: 'guest', label: 'GUEST', value: item.guest_name || (user ? (((user.first_name || '') + ' ' + (user.last_name || '')).trim() || 'Med&X Member') : 'Med&X Member') },
        { key: 'ref', label: 'N°', value: refNo(item) }
    ];
    if (Number(item.party) > 1) auxiliary.push({ key: 'party', label: 'PARTY OF', value: String(item.party) });
    const included = item.kind === 'gala'
        ? 'Gala Evening — dinner & programme' + (String(item.ticket_name || '').includes('bundle') ? ' (conference bundle)' : '')
        : (item.kind === 'plexus'
            ? 'Full conference programme' + (item.includes_gala ? ' · Gala Evening' : '')
            : `${item.title} — ${item.ticket_name || 'registration'}`);
    const back = [{ key: 'included', label: 'INCLUDED', value: included }];
    if (item.kind === 'gala') {
        back.push({ key: 'dress', label: 'DRESS CODE', value: 'Black tie' });
        back.push({ key: 'table', label: 'TABLE', value: item.seat_number ? `Table ${item.seat_number}` : 'Assigned at the door — show this pass.' });
    }
    back.push({ key: 'support', label: 'SUPPORT', value: `Questions? ${SUPPORT_EMAIL}` });
    return {
        style: 'eventTicket',
        serial: `medx-t-${SERIAL_CODE[item.table] || 'x'}-${item.id}`,
        description: item.kind === 'plexus' || item.kind === 'gala' ? 'Med&X — Plexus 2026 entry' : `Med&X — ${item.title}`,
        relevantDate: relevantDateFor(item),
        fields: {
            primary: [{ key: 'event', value: item.title }],
            secondary: [
                { key: 'when', label: 'WHEN', value: when },
                { key: 'where', label: 'WHERE', value: item.venue || 'To be announced' }
            ],
            auxiliary,
            back
        },
        qrMessage, altText: refNo(item)
    };
}
function memberModel(user, meta, qrValue) {
    const name = (((user.first_name || '') + ' ' + (user.last_name || '')).trim()) || 'Med&X Member';
    const memberNo = String(user.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
    return {
        style: 'generic',
        serial: `medx-m-${user.id}`,
        description: 'Med&X membership card',
        fields: {
            primary: [{ key: 'member', value: name }],
            secondary: [
                { key: 'no', label: 'MEMBER N°', value: memberNo },
                { key: 'since', label: 'MEMBER SINCE', value: meta.since_year || '' }
            ],
            auxiliary: [
                { key: 'type', label: 'TYPE', value: meta.type_label || 'Member' },
                { key: 'standing', label: 'STANDING', value: meta.standing_label || 'Member in good standing' }
            ],
            back: [
                { key: 'doors', label: 'ONE CARD, EVERY DOOR', value: 'Your member QR admits you at every Med&X door — the same code lives in My Med&X.' },
                { key: 'support', label: 'SUPPORT', value: `Questions? ${SUPPORT_EMAIL}` }
            ]
        },
        qrMessage: qrValue, altText: memberNo
    };
}

// ---------------------------------------------------------------- responders (also used by wallet.js)
const wantsJson = req => /\bapplication\/json\b/i.test(String(req.get('accept') || ''));
const NOT_CONFIGURED = { configured: false, provider: 'apple', reason: 'apple_wallet_not_configured', message_en: 'Apple Wallet is coming soon.' };
function respondWith(req, res, kind, id, buildModel) {
    try {
        if (!isConfigured()) return res.json({ ...NOT_CONFIGURED });
        if (wantsJson(req)) {
            // Portal XHRs get a save_url (the tokenized download) — me.js window.open()s it.
            return res.json({
                configured: true, provider: 'apple', save_url: passUrl(req, kind, id),
                filename: 'medx-plexus.pkpass', expires_at: new Date((Math.floor(Date.now() / 1000) + TOKEN_TTL_S) * 1000).toISOString()
            });
        }
        return sendPkpass(res, buildPkpass(buildModel()));
    } catch (e) {
        console.error('[v2 apple-pass] pass build failed:', e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Could not build the Apple Wallet pass' });
    }
}
// wallet.js member-card gate → { user, meta, qr } straight from its own memberMeta()/memberQr().
function respondMemberPass(req, res, { user, meta, qr }) {
    return respondWith(req, res, 'member', user.id, () => memberModel(user, meta, qr.value));
}
// wallet.js per-ticket gate → { item, user, qrMessage } — the SAME bag + barcode the Google path uses.
function respondTicketPass(req, res, { item, user, qrMessage }) {
    return respondWith(req, res, 'ticket', item.id, () => ticketModel(item, user, qrMessage));
}

// ---------------------------------------------------------------- registry mount (routes only)
module.exports = function mountApplePass(app, ctx) {
    state.ctx = ctx;
    const { auth, log } = ctx;

    // Tokenized, no-login download — safe for e-mails; ownership was proven when minting.
    app.get('/api/v2/apple/pass/:token.pkpass', (req, res) => {
        try {
            if (!isConfigured()) return res.status(503).json({ ...NOT_CONFIGURED });
            const t = verifyToken(String(req.params.token || ''));
            if (!t) return res.status(401).json({ error: 'This pass link is invalid or has expired — open My Med&X for a fresh one.' });
            if (t.kind === 'member') {
                const user = q().get('SELECT id, email, first_name, last_name, created_at FROM users WHERE id = ?', [t.id]);
                if (!user) return res.status(404).json({ error: 'Member not found' });
                user.email = String(user.email || '').toLowerCase();
                return sendPkpass(res, buildPkpass(memberModel(user, memberMeta(user), memberQrValue(user))));
            }
            const item = resolveItem(t.id, null);
            if (!item) return res.status(404).json({ error: 'Ticket not found' });
            return sendPkpass(res, buildPkpass(ticketModel(item, null, item.qrMessage)));
        } catch (e) {
            console.error('[v2 apple-pass] token pass failed:', e.message);
            if (!res.headersSent) res.status(500).json({ error: 'Could not build the Apple Wallet pass' });
        }
    });

    // Authed helper: mint the tokenized URL for the front end / ticket e-mails.
    app.get('/api/v2/apple/link/:kind/:id', auth, (req, res) => {
        try {
            if (!isConfigured()) return res.json({ ...NOT_CONFIGURED });
            const kind = String(req.params.kind || '');
            const id = String(req.params.id || '');
            let mintKind, mintId;
            if (kind === 'member' || kind === 'card') {
                if (id && id !== 'me' && id !== String(req.user.id)) return res.status(403).json({ error: 'You can only mint your own member card link.' });
                mintKind = 'member'; mintId = req.user.id;
            } else if (kind === 'ticket') {
                const user = q().get('SELECT id, email FROM users WHERE id = ?', [req.user.id]) || { id: req.user.id, email: req.user.email || '' };
                const item = resolveItem(id, { id: user.id, email: user.email });
                if (!item) return res.status(404).json({ error: 'We could not find that ticket on your account.' });
                if (['cancelled', 'revoked', 'waitlisted'].includes(item.status)) return res.status(400).json({ error: 'This registration is not active, so no pass can be issued.' });
                mintKind = 'ticket'; mintId = item.id;
            } else {
                return res.status(400).json({ error: 'kind must be member|card|ticket' });
            }
            res.json({
                configured: true, provider: 'apple', url: passUrl(req, mintKind, mintId),
                filename: 'medx-plexus.pkpass', expires_at: new Date((Math.floor(Date.now() / 1000) + TOKEN_TTL_S) * 1000).toISOString()
            });
        } catch (e) {
            console.error('[v2 apple-pass] link mint failed:', e.message);
            res.status(500).json({ error: 'Could not mint the pass link' });
        }
    });

    log(`apple-pass: tokenized .pkpass routes ready (${isConfigured() ? 'signing env present' : 'env absent — configured:false'})`);
};
module.exports.isConfigured = isConfigured;
module.exports.respondMemberPass = respondMemberPass;
module.exports.respondTicketPass = respondTicketPass;
