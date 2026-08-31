/**
 * v2/studio.js — server pieces for the STUDIO destination (Admin Studio.dc.html). Most of the
 * Studio rides on EXISTING routes untouched (print suite /api/admin/print/*, team files
 * /api/admin/files*, cards roster /api/admin/cards/*); this module adds only what the redesigned
 * screen needs and nothing else. Mounted by v2/index.js.
 *
 * Studio extras (team review Aug 2026, §C "Studio" — Laura + Miro):
 *
 *   GET    /api/v2/studio/attendance-cards       recent member attendance/share cards — reads the
 *          member portal's v2_attendance_cards table (ONE shared DB); images are served by the
 *          MEMBER origin at /api/v2/attendance-cards/:id/image (the frontend prefixes memberBase).
 *   GET    /api/v2/studio/certificates/summary   issued-certificate counts + the latest few rows.
 *   POST   /api/v2/studio/certificates/preview   { name?, type?, event_name? } → { html } — a
 *          brand-true A4-landscape certificate; READS the persisted `certs` settings (signature
 *          line on/off, signer name/title) so the generate button honors the settings drawer.
 *
 *   PHOTO LIBRARY (Laura's "build before December" pick) — table v2_studio_assets:
 *   GET    /api/v2/studio/library?tag=&q=        photos (deleted_at IS NULL), newest first
 *   POST   /api/v2/studio/library                multipart field `photo` (or `file`) · jpg/png/webp
 *          · ≤ 8 MB · magic-byte check. Storage mirrors user-portal/backend/v2/profile.js: local
 *          disk under <ROOT>/admin-portal/backend/uploads/studio-library (served by the existing
 *          /uploads static route); when CLOUDINARY_URL is set the file is pushed to Cloudinary
 *          (folder medx/studio) and the secure URL is stored instead. On production without
 *          CLOUDINARY_URL the server-wide multipart gate in server.js already answers 503.
 *   PATCH  /api/v2/studio/library/:id            { tag } → retag (gala/plexus/bridges/team/sponsor/misc)
 *   DELETE /api/v2/studio/library/:id            soft delete (deleted_at stamped, row + file kept)
 *
 *   SETTINGS (persisted key/value JSON) — table v2_studio_settings:
 *   GET    /api/v2/studio/settings               { settings: { badges, certs, print } } (defaults merged)
 *   PUT    /api/v2/studio/settings               { badges?, certs?, print? } → validated merge
 *
 *   BADGES, settings-aware. The legacy print engine (server.js /api/admin/print/*) hard-codes the
 *   badge trim at 90×55 mm (PS_BADGE_W/H) and its routes accept no dimension fields — so to thread
 *   the badge settings through FOR REAL these two routes build the sheet here, mirroring the
 *   engine's contracts (face geometry ← psBadgeFace, roster SQL ← psEventPeople, verify-QR ←
 *   psBadgeToken/psMemberQr, Chrome PDF ← psChromeBinary/psRenderPdf, saved asset ←
 *   psSaveAsset). Drift risk documented in deploy/staging/BUILD-STUDIO-2026-08-31.md.
 *   POST   /api/v2/studio/badges/preview         { event } → { html, pageW, pageH } (first 8 people)
 *   POST   /api/v2/studio/badges/render          { event, staff?, blanks? } → Chrome PDF saved as a
 *          content-studio asset → { success, url, … }; 503 print_engine_unavailable without Chrome.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TAGS = ['gala', 'plexus', 'bridges', 'team', 'sponsor', 'misc'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Badge trims (mm). 'std' = the legacy engine's 90×55; A6/A7 landscape per the team ask.
const BADGE_SIZES = { std: { w: 90, h: 55 }, a6: { w: 148, h: 105 }, a7: { w: 105, h: 74 } };
const SETTINGS_DEFAULTS = {
    badges: { size: 'std', w_mm: 90, h_mm: 55, sponsor_strip: false },
    certs: { signature_line: true, signer_name: 'Alen Juginović, MD', signer_title: 'President' },
    print: { banner_size: '100x200' }
};

// Palette + role bands, verbatim from the print engine (server.js PS_PAL / PS_ROLES).
const PAL = { navy: '#0f1c2e', navy2: '#091320', gold: '#C9A962', goldLight: '#e8c97a', burgundy: '#9b1b22', cream: '#faf7f2', ink: '#141414', paper: '#ffffff', muted: '#8a7f6f', line: '#ece5da' };
const ROLES = {
    attendee: { label: 'Attendee', band: PAL.navy, chipBg: PAL.gold, chipInk: '#15110f' },
    speaker: { label: 'Speaker', band: PAL.burgundy, chipBg: PAL.burgundy, chipInk: '#ffffff' },
    staff: { label: 'Team', band: '#15110f', chipBg: PAL.navy, chipInk: PAL.goldLight },
    guest: { label: 'Guest', band: '#2b2016', chipBg: PAL.gold, chipInk: '#15110f' }
};
const BLEED = 3; // mm, same as the engine

module.exports = function mountStudio(app, ctx) {
    const { db, auth, adminOnly, saveDb, ROOT, log } = ctx;

    const q = {
        get(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
        all(sql, p = []) { const s = db().prepare(sql); if (p.length) s.bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }
    };
    const run = (sql, p = []) => { db().run(sql, p); };
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const audit = (req, action, detail) => {
        try {
            run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail) VALUES (?,?,?,?,?)',
                [crypto.randomUUID(), (req.user && req.user.id) || null, (req.user && req.user.email) || 'admin', action, String(detail || '').slice(0, 300)]);
        } catch (e) { /* best-effort */ }
    };

    // ---- schema (idempotent, guarded — a transient SQLITE_BUSY must not cost a table) ----
    const DDL = [
        `CREATE TABLE IF NOT EXISTS v2_studio_assets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            mime TEXT NOT NULL,
            bytes INTEGER NOT NULL DEFAULT 0,
            tag TEXT NOT NULL DEFAULT 'misc',
            url TEXT NOT NULL,
            px_w INTEGER, px_h INTEGER,
            uploaded_by TEXT, uploaded_by_name TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            deleted_at TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS v2_studio_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT, updated_by TEXT
        )`
    ];
    let schemaReady = false;
    function ensureSchema() {
        if (schemaReady) return true;
        let ok = true;
        for (const sql of DDL) {
            try { run(sql); } catch (e) { ok = false; if (!/database is locked|SQLITE_BUSY/i.test(e.message)) console.error('[v2/studio] schema:', e.message); }
        }
        schemaReady = ok;
        return ok;
    }
    ensureSchema();

    // =============================================================== settings (key/value JSON)
    function readSettings() {
        ensureSchema();
        const out = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
        try {
            q.all('SELECT key, value FROM v2_studio_settings').forEach(r => {
                if (!Object.prototype.hasOwnProperty.call(out, r.key)) return;
                try { Object.assign(out[r.key], JSON.parse(r.value) || {}); } catch (e) { /* bad row: defaults stand */ }
            });
        } catch (e) { /* table missing: defaults stand */ }
        return out;
    }
    const clampNum = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
    const asBool = v => v === true || v === 1 || v === '1' || v === 'true';
    // per-key validators: whatever the client sends is clamped onto a known-good shape
    const VALIDATE = {
        badges(raw, cur) {
            const size = ['std', 'a6', 'a7', 'custom'].includes(String(raw.size)) ? String(raw.size) : cur.size;
            let w = cur.w_mm, h = cur.h_mm;
            if (size === 'custom') { w = clampNum(raw.w_mm, cur.w_mm, 60, 190); h = clampNum(raw.h_mm, cur.h_mm, 40, 130); }
            else { const t = BADGE_SIZES[size]; w = t.w; h = t.h; }
            return { size, w_mm: w, h_mm: h, sponsor_strip: 'sponsor_strip' in raw ? asBool(raw.sponsor_strip) : cur.sponsor_strip };
        },
        certs(raw, cur) {
            return {
                signature_line: 'signature_line' in raw ? asBool(raw.signature_line) : cur.signature_line,
                signer_name: ('signer_name' in raw ? String(raw.signer_name || '').trim().slice(0, 80) : cur.signer_name) || SETTINGS_DEFAULTS.certs.signer_name,
                signer_title: ('signer_title' in raw ? String(raw.signer_title || '').trim().slice(0, 80) : cur.signer_title) || SETTINGS_DEFAULTS.certs.signer_title
            };
        },
        print(raw, cur) {
            return { banner_size: ['100x200', '85x200'].includes(String(raw.banner_size)) ? String(raw.banner_size) : cur.banner_size };
        }
    };

    app.get('/api/v2/studio/settings', auth, adminOnly, (req, res) => {
        try { res.json({ settings: readSettings() }); }
        catch (e) { res.status(500).json({ error: 'Could not load the Studio settings.' }); }
    });

    app.put('/api/v2/studio/settings', auth, adminOnly, (req, res) => {
        try {
            if (!ensureSchema()) return res.status(503).json({ error: 'The settings table is not ready — try again in a moment.' });
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const cur = readSettings();
            const now = new Date().toISOString();
            const touched = [];
            for (const key of Object.keys(VALIDATE)) {
                if (!body[key] || typeof body[key] !== 'object') continue;
                const next = VALIDATE[key](body[key], cur[key]);
                cur[key] = next;
                run('INSERT OR REPLACE INTO v2_studio_settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)',
                    [key, JSON.stringify(next), now, (req.user && req.user.email) || null]);
                touched.push(key);
            }
            if (!touched.length) return res.status(400).json({ error: 'Nothing to save — send badges, certs or print.' });
            saveDb();
            audit(req, 'studio.settings', touched.map(k => `${k}=${JSON.stringify(cur[k])}`).join(' '));
            res.json({ success: true, settings: cur });
        } catch (e) { console.error('[v2/studio] settings save:', e.message); res.status(500).json({ error: 'Could not save the Studio settings.' }); }
    });

    // =============================================================== photo library
    const UPLOAD_DIR = path.join(ROOT, 'admin-portal', 'backend', 'uploads', 'studio-library');
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { log('studio: cannot create ' + UPLOAD_DIR + ': ' + e.message); }

    // magic-byte sniff of what was actually written (multer trusts the client MIME — profile.js pattern)
    function sniff(filePath) {
        try {
            const fd = fs.openSync(filePath, 'r'); const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
            if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
            if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
            if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
        } catch (e) {}
        return null;
    }
    // pixel size from the header bytes (PNG + JPEG; webp rows keep null — display-only nicety)
    function imageSizePx(filePath) {
        try {
            const buf = Buffer.alloc(131072);
            const fd = fs.openSync(filePath, 'r');
            const n = fs.readSync(fd, buf, 0, 131072, 0); fs.closeSync(fd);
            if (n >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
                return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
            if (n >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
                let o = 2;
                while (o < n - 9) {
                    if (buf[o] !== 0xff) { o++; continue; }
                    const m = buf[o + 1];
                    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
                    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
                        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
                    const len = buf.readUInt16BE(o + 2); if (len < 2) break; o += 2 + len;
                }
            }
        } catch (e) {}
        return null;
    }
    // Cloudinary in prod when configured — exactly the profile.js contract (guarded require; on any
    // failure the local file stands and the reason is logged).
    async function toCloud(filePath, id) {
        if (!process.env.CLOUDINARY_URL) return null;
        try {
            const cloudinary = require('cloudinary').v2;
            const r = await cloudinary.uploader.upload(filePath, { folder: 'medx/studio', public_id: id, overwrite: true, invalidate: true, resource_type: 'image' });
            return r && r.secure_url ? r.secure_url : null;
        } catch (e) { log('studio: Cloudinary upload failed, keeping local file: ' + e.message); return null; }
    }
    const photoRow = r => ({
        id: r.id, name: r.name, mime: r.mime, bytes: Number(r.bytes) || 0, tag: r.tag || 'misc',
        url: r.url, px_w: r.px_w || null, px_h: r.px_h || null,
        uploaded_by_name: r.uploaded_by_name || null, created_at: r.created_at || null
    });

    app.get('/api/v2/studio/library', auth, adminOnly, (req, res) => {
        try {
            ensureSchema();
            const tag = TAGS.includes(String(req.query.tag)) ? String(req.query.tag) : null;
            const needle = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
            let sql = 'SELECT * FROM v2_studio_assets WHERE deleted_at IS NULL';
            const p = [];
            if (tag) { sql += ' AND tag = ?'; p.push(tag); }
            if (needle) { sql += " AND lower(name) LIKE ? ESCAPE '\\'"; p.push('%' + needle.replace(/[\\%_]/g, m => '\\' + m) + '%'); }
            sql += ' ORDER BY created_at DESC LIMIT 200';
            res.json({ photos: q.all(sql, p).map(photoRow), tags: TAGS });
        } catch (e) { res.json({ photos: [], tags: TAGS, note: 'The photo library is empty until the first upload.' }); }
    });

    const multer = require('multer');
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `${req.v2AssetId}.${MIME_EXT[file.mimetype]}`)
    });
    const upload = multer({
        storage,
        limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
        fileFilter: (req, file, cb) => (MIME_EXT[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Use a JPG, PNG or WebP image.'), { code: 'BAD_TYPE' })))
    });

    app.post('/api/v2/studio/library', auth, adminOnly, (req, res, next) => {
        if (!ensureSchema()) return res.status(503).json({ error: 'The photo library is not ready — try again in a moment.' });
        req.v2AssetId = crypto.randomUUID();
        // field `photo` (the view) or `file` (legacy upload convention) — one file either way
        upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, err => {
            if (!err && req.files) req.file = (req.files.photo && req.files.photo[0]) || (req.files.file && req.files.file[0]) || null;
            next(err);
        });
    }, (err, req, res, next) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That image is larger than 8 MB — pick a smaller one.' });
        if (err.code === 'BAD_TYPE') return res.status(400).json({ error: err.message });
        return res.status(400).json({ error: err.message || 'Upload failed.' });
    }, async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'Choose an image first.' });
            const ext = MIME_EXT[req.file.mimetype];
            const kind = sniff(req.file.path);
            if (!kind || kind !== ext) { try { fs.unlinkSync(req.file.path); } catch (e) {} return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' }); }
            const id = req.v2AssetId;
            const px = imageSizePx(req.file.path);
            const tag = TAGS.includes(String(req.body && req.body.tag)) ? String(req.body.tag) : 'misc';
            const name = String(req.file.originalname || 'photo').replace(/[\/\\]/g, '_').trim().slice(0, 180) || 'photo';   // same sanitize as team_files
            let url = await toCloud(req.file.path, id);
            if (url) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
            else url = `/uploads/studio-library/${path.basename(req.file.path)}`;
            run(`INSERT INTO v2_studio_assets (id, name, mime, bytes, tag, url, px_w, px_h, uploaded_by, uploaded_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`,
                [id, name, req.file.mimetype, req.file.size, tag, url, px ? px.w : null, px ? px.h : null,
                 (req.user && req.user.id) || null, (req.user && (req.user.name || req.user.email)) || null]);
            saveDb();
            audit(req, 'studio.photo.upload', `${tag}/${name} (${req.file.size} bytes)`);
            res.json({ success: true, photo: photoRow(q.get('SELECT * FROM v2_studio_assets WHERE id = ?', [id])) });
        } catch (e) { console.error('[v2/studio] upload:', e.message); res.status(500).json({ error: 'Could not store the photo — please try again.' }); }
    });

    app.patch('/api/v2/studio/library/:id', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM v2_studio_assets WHERE id = ? AND deleted_at IS NULL', [String(req.params.id)]);
            if (!row) return res.status(404).json({ error: 'Photo not found.' });
            const tag = String(req.body && req.body.tag);
            if (!TAGS.includes(tag)) return res.status(400).json({ error: 'tag must be one of: ' + TAGS.join(', ') });
            run('UPDATE v2_studio_assets SET tag = ? WHERE id = ?', [tag, row.id]);
            saveDb();
            audit(req, 'studio.photo.retag', `${row.name} → ${tag}`);
            res.json({ success: true, photo: photoRow(q.get('SELECT * FROM v2_studio_assets WHERE id = ?', [row.id])) });
        } catch (e) { res.status(500).json({ error: 'Could not retag the photo.' }); }
    });

    app.delete('/api/v2/studio/library/:id', auth, adminOnly, (req, res) => {
        try {
            const row = q.get('SELECT * FROM v2_studio_assets WHERE id = ? AND deleted_at IS NULL', [String(req.params.id)]);
            if (!row) return res.status(404).json({ error: 'Photo not found.' });
            run("UPDATE v2_studio_assets SET deleted_at = datetime('now') WHERE id = ?", [row.id]);
            saveDb();
            audit(req, 'studio.photo.delete', `${row.tag}/${row.name}`);
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: 'Could not remove the photo.' }); }
    });

    // =============================================================== recent member share cards
    app.get('/api/v2/studio/attendance-cards', auth, adminOnly, (req, res) => {
        try {
            const rows = q.all(`SELECT id, kind, event_name, email_to, generated_at, emailed_at
                                FROM v2_attendance_cards ORDER BY generated_at DESC, created_at DESC LIMIT 12`);
            res.json({
                cards: rows.map(r => ({
                    id: r.id, kind: r.kind, event_name: r.event_name, email_to: r.email_to,
                    generated_at: r.generated_at, emailed_at: r.emailed_at,
                    image_path: `/api/v2/attendance-cards/${r.id}/image`   // MEMBER-origin path; client prefixes memberBase
                }))
            });
        } catch (e) {
            // the member portal owns this table — before its first boot it may not exist yet
            res.json({ cards: [], note: 'No cards yet — the member portal generates them on registration.' });
        }
    });

    // =============================================================== certificates
    app.get('/api/v2/studio/certificates/summary', auth, adminOnly, (req, res) => {
        try {
            const byType = q.all('SELECT certificate_type AS type, COUNT(*) AS n FROM certificates GROUP BY certificate_type ORDER BY n DESC');
            const recent = q.all('SELECT recipient_name, certificate_type, certificate_number, conference_name, issue_date FROM certificates ORDER BY issue_date DESC LIMIT 5');
            const total = byType.reduce((n, r) => n + (Number(r.n) || 0), 0);
            res.json({ total, by_type: byType, recent });
        } catch (e) { res.json({ total: 0, by_type: [], recent: [] }); }
    });

    app.post('/api/v2/studio/certificates/preview', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const cs = readSettings().certs;   // ← the settings drawer's values, read at generate time
            const type = ['attendance', 'speaker', 'cme'].includes(String(b.type)) ? String(b.type) : 'attendance';
            let name = String(b.name || '').trim().slice(0, 90);
            let eventName = String(b.event_name || '').trim().slice(0, 120);
            if (!eventName) {
                try { const c = q.get('SELECT name FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1'); eventName = (c && c.name) || 'Plexus Conference 2026'; } catch (e) { eventName = 'Plexus Conference 2026'; }
            }
            if (!name) {
                // prefer a real checked-in attendee; else a real issued certificate's recipient; else the sample
                try { const r = q.get("SELECT first_name, last_name FROM registrations WHERE checked_in = 1 AND COALESCE(first_name,'') != '' LIMIT 1"); if (r) name = `${r.first_name || ''} ${r.last_name || ''}`.trim(); } catch (e) {}
                if (!name) { try { const c = q.get("SELECT recipient_name FROM certificates WHERE COALESCE(recipient_name,'') != '' ORDER BY issue_date DESC LIMIT 1"); if (c) name = c.recipient_name; } catch (e) {} }
                if (!name) name = 'Ime i prezime';
            }
            const number = 'PLX26-CERT-PREVIEW';
            const title = type === 'speaker' ? 'Certificate of Appreciation' : type === 'cme' ? 'Certificate of Attendance · CME' : 'Certificate of Attendance';
            const line = type === 'speaker'
                ? `for speaking at ${esc(eventName)} and sharing knowledge with the Med&amp;X community`
                : `for attending ${esc(eventName)} in Zagreb, Croatia`;
            const signerLine = `${cs.signer_name} · ${cs.signer_title}`.toUpperCase();
            const foot = cs.signature_line
                ? `<div class="foot">
  <div class="sig"><span class="bar"></span><span>${esc(signerLine)}</span></div>
  <div class="sig"><span class="bar"></span><span>MED&amp;X ORGANISING TEAM</span></div>
</div>`
                : `<div class="foot">
  <div class="sig"><span class="bar"></span><span>MED&amp;X ORGANISING TEAM</span></div>
</div>`;
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>@page{size:A4 landscape;margin:0}body{margin:0;background:#f7f1e6;color:#191512;font-family:Inter,sans-serif}
.sheet{width:297mm;height:210mm;box-sizing:border-box;padding:16mm;display:flex}
.frame{flex:1;border:1px solid rgba(25,21,18,.35);outline:1px solid rgba(25,21,18,.16);outline-offset:-5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:14mm;gap:7mm;background:#fdfaf3}
.micro{font:600 10px Inter,sans-serif;letter-spacing:.3em;color:#9b1b22}
.rule{width:34mm;height:2px;background:linear-gradient(90deg,#9b1b22 50%,#c9a962 50%)}
h1{font-family:Fraunces,serif;font-weight:400;font-size:34px;margin:0}
.name{font-family:Fraunces,serif;font-style:italic;font-size:52px;line-height:1.05;margin:0}
.line{font-size:14px;color:#4a4239;max-width:150mm;line-height:1.6}
.foot{display:flex;gap:24mm;align-items:flex-end;margin-top:6mm}
.sig{display:flex;flex-direction:column;gap:2mm;align-items:center}
.sig .bar{width:52mm;border-top:1px solid rgba(25,21,18,.4)}
.sig span{font:600 8.5px Inter,sans-serif;letter-spacing:.16em;color:#6d6459}
.no{font:500 9px ui-monospace,monospace;color:#9a9086;letter-spacing:.08em}</style></head>
<body><div class="sheet"><div class="frame">
<span class="micro">MED&amp;X · ZAGREB</span>
<h1>${esc(title)}</h1><span class="rule"></span>
<p class="name">${esc(name)}</p>
<p class="line">${line}. Awarded with the appreciation of the Med&amp;X organising team.</p>
${foot}
<span class="no">${esc(number)} · verify at medx.hr</span>
</div></div></body></html>`;
            res.json({ ok: true, html, name, type, event_name: eventName, settings: cs });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // =============================================================== badges (settings-aware)
    // Everything below mirrors the print engine's contracts so the artwork matches the legacy
    // 90×55 output when the settings sit at STD — see the module header for the mirrored pieces.

    // -- event facts + roster (SQL mirrored from psEventFacts / psEventPeople, compacted) --
    function eventFacts(key) {
        const k = String(key || 'conference');
        let name = 'Med&X Event';
        try {
            if (k === 'conference') { const c = q.get('SELECT name FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1'); if (c && c.name) name = c.name; }
            else if (k === 'gala') name = 'Gala Evening';
            else if (k === 'donor') name = 'Plexus Donor Night';
            else name = 'Building Bridges';
        } catch (e) {}
        return { key: k, name };
    }
    function eventPeople(key, withStaff) {
        const k = String(key || 'conference');
        const seen = new Set(); const people = [];
        const staffEmails = new Set();
        try { q.all('SELECT lower(email) e FROM users WHERE COALESCE(is_staff,0)=1 OR COALESCE(is_admin,0)=1').forEach(r => { if (r.e) staffEmails.add(r.e); }); } catch (e) {}
        const push = (row) => {
            const email = String(row.email || '').trim().toLowerCase();
            const nm = String(row.name || '').trim();
            if (!nm && !email) return;
            const dk = email || ('n:' + nm.toLowerCase());
            if (seen.has(dk)) return; seen.add(dk);
            let role = row.role || 'attendee';
            if (role === 'attendee' && email && staffEmails.has(email)) role = 'staff';
            people.push({ name: nm || email, email, institution: String(row.institution || '').trim(), role, user_id: row.user_id || null });
        };
        try { q.all('SELECT name, title, institution FROM speakers WHERE is_confirmed = 1 AND is_published = 1 ORDER BY is_keynote DESC, sort_order LIMIT 60').forEach(s => { if (s.name) push({ name: s.name, institution: s.institution || s.title || '', role: 'speaker' }); }); } catch (e) {}
        try {
            let rows = [];
            if (k === 'conference') rows = q.all("SELECT COALESCE(NULLIF(TRIM(r.first_name||' '||r.last_name),''), NULLIF(TRIM(u.first_name||' '||u.last_name),''), NULLIF(r.email,''), u.email) name, COALESCE(NULLIF(r.email,''), u.email) email, COALESCE(NULLIF(r.institution,''), u.institution) institution, r.user_id, 'attendee' role FROM registrations r LEFT JOIN users u ON u.id = r.user_id WHERE COALESCE(r.status,'') NOT IN ('cancelled','refunded')");
            else if (k === 'gala') rows = q.all("SELECT COALESCE(NULLIF(TRIM(r.first_name||' '||r.last_name),''), NULLIF(TRIM(u.first_name||' '||u.last_name),''), NULLIF(r.email,''), u.email) name, COALESCE(NULLIF(r.email,''), u.email) email, COALESCE(NULLIF(r.institution,''), u.institution) institution, r.user_id, 'guest' role FROM gala_registrations r LEFT JOIN users u ON u.id = r.user_id WHERE COALESCE(r.status,'') NOT IN ('cancelled','refunded')");
            else rows = q.all("SELECT COALESCE(NULLIF(TRIM(br.first_name||' '||br.last_name),''), NULLIF(TRIM(u.first_name||' '||u.last_name),''), NULLIF(br.email,''), u.email) name, COALESCE(NULLIF(br.email,''), u.email) email, COALESCE(NULLIF(br.institution,''), u.institution) institution, br.user_id, 'attendee' role FROM bridges_registrations br LEFT JOIN bridges_events be ON br.event_id = be.id LEFT JOIN users u ON u.id = br.user_id WHERE COALESCE(br.status,'') NOT IN ('cancelled','refunded') AND " + (k === 'donor' ? "be.slug = 'donor-night'" : "COALESCE(be.slug,'') <> 'donor-night'"));
            rows.forEach(r => push(r));
        } catch (e) {}
        if (withStaff) {
            try { q.all('SELECT id, first_name, last_name, email, institution FROM users WHERE COALESCE(is_staff,0)=1 OR COALESCE(is_admin,0)=1').forEach(u => push({ name: ((u.first_name || '') + ' ' + (u.last_name || '')).trim(), email: u.email, institution: u.institution, user_id: u.id, role: 'staff' })); } catch (e) {}
        }
        return people;
    }

    // -- consent-aware member-verify QR (mirrors badgeVerifySecret / psBadgeToken / psMemberQr) --
    let _badgeSecret = null;
    function badgeVerifySecret() {
        if (_badgeSecret) return _badgeSecret;
        try {
            const row = q.get("SELECT value FROM rewards_settings WHERE key = 'badge_verify_secret'");
            if (row && row.value) { _badgeSecret = String(row.value); return _badgeSecret; }
            const gen = crypto.randomBytes(32).toString('hex');
            run("INSERT OR REPLACE INTO rewards_settings (key, value) VALUES ('badge_verify_secret', ?)", [gen]);
            saveDb();
            _badgeSecret = gen; return gen;
        } catch (e) { return ctx.JWT_SECRET || 'medx-badge'; }
    }
    function badgeToken(userId) {
        const uid = String(userId || ''); if (!uid) return '';
        const sig = crypto.createHmac('sha256', badgeVerifySecret()).update('medx-verify-badge:' + uid).digest('hex').slice(0, 24);
        return Buffer.from(uid, 'utf8').toString('base64url') + '.' + sig;
    }
    function verifyBase(req) {
        if (process.env.USER_PORTAL_URL) return process.env.USER_PORTAL_URL.replace(/\/+$/, '');
        const host = String((req && req.headers && req.headers.host) || '');
        if (/localhost|127\.0\.0\.1/.test(host)) return 'http://localhost:3001';
        return 'https://medx-user-portal.onrender.com';
    }
    function memberQrUrl(req, userId, email) {
        let user = null;
        try {
            if (userId) user = q.get('SELECT id, first_name, last_name, is_public_profile, deleted_at FROM users WHERE id = ?', [userId]);
            if (!user && email) user = q.get('SELECT id, first_name, last_name, is_public_profile, deleted_at FROM users WHERE lower(email) = ? LIMIT 1', [String(email).trim().toLowerCase()]);
        } catch (e) { user = null; }
        if (!user || user.deleted_at || !user.is_public_profile) return null;
        let standing = 'good_standing';
        try { const m = q.get('SELECT standing FROM member_meta WHERE user_id = ?', [user.id]); if (m && m.standing) standing = String(m.standing); } catch (e) {}
        if (standing !== 'good_standing') return null;
        const nm = ((user.first_name || '') + ' ' + (user.last_name || '')).trim();
        if (!nm || /^deleted user$/i.test(nm)) return null;
        return verifyBase(req) + '/verify/' + badgeToken(user.id);
    }
    // vector QR — filled 1×1 module rects, 4-module quiet zone (mirrors psQrSvg; stroke SVGs decode poorly)
    function qrSvg(text) {
        const QRCode = require('qrcode');
        const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
        const n = qr.modules.size, data = qr.modules.data, quiet = 4, dim = n + quiet * 2;
        let d = '';
        for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { if (data[y * n + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; } }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;shape-rendering:crispEdges;"><rect width="${dim}" height="${dim}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>`;
    }

    // -- assets on disk --
    function dataUri(filePath) {
        try {
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const mime = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : (ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'));
            return 'data:' + mime + ';base64,' + fs.readFileSync(filePath).toString('base64');
        } catch (e) { return null; }
    }
    function brandLogoSrc() {
        for (const rel of [['admin-portal', 'frontend', 'assets', 'logo.png'], ['admin-portal', 'frontend', 'assets', 'email-logo.png']]) {
            const p = path.join(ROOT, ...rel);
            if (fs.existsSync(p)) { const d = dataUri(p); if (d) return d; }
        }
        return '';
    }
    // sponsor-strip logos = the photo library, tag "sponsor" (local files ≤4MB embedded as data URIs
    // so the file://-rendered PDF sees them; larger ones are skipped; Cloudinary URLs ride as-is)
    function sponsorStripSrcs() {
        try {
            return q.all("SELECT url FROM v2_studio_assets WHERE tag = 'sponsor' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 6")
                .map(r => {
                    const u = String(r.url || '');
                    if (/^https?:\/\//i.test(u)) return u;
                    if (u.startsWith('/uploads/')) {
                        const p = path.join(ROOT, 'admin-portal', 'backend', 'uploads', u.slice('/uploads/'.length));
                        try { if (fs.existsSync(p) && fs.statSync(p).size <= 4 * 1024 * 1024) return dataUri(p); } catch (e) {}
                    }
                    return null;
                }).filter(Boolean);
        } catch (e) { return []; }
    }

    // -- badge artwork at the CONFIGURED trim (geometry ← psBadgeFace, scaled by k = min(W/90, H/55)) --
    function badgeFace(person, facts, logoSrc, W, H, sponsors) {
        const role = ROLES[String(person.role || 'attendee').toLowerCase()] || ROLES.attendee;
        const k = Math.min(W / 90, H / 55);
        const mm = v => (Math.round(v * k * 100) / 100) + 'mm';
        const pt = v => (Math.round(v * k * 10) / 10) + 'pt';
        const nm = esc(person.name || '');
        const inst = esc(person.institution || '');
        const evName = esc(facts.name || '');
        const nameSize = nm.length > 22 ? 15 : (nm.length > 16 ? 18 : 21);
        const stripH = sponsors && sponsors.length ? Math.max(8, Math.min(16, 9 * k)) : 0;   // mm
        const lift = stripH ? stripH + 1.5 : 0;                                              // content sits above the strip
        let qrHtml = '';
        if (person._qrSvg) {
            qrHtml = `<div style="position:absolute;right:${mm(4)};bottom:${4 * k + lift}mm;width:${mm(18)};height:${mm(18)};padding:${mm(1.4)};background:#fff;border:0.2mm solid ${PAL.line};border-radius:1mm;">${person._qrSvg}</div>
                      <div style="position:absolute;right:${mm(22)};bottom:${5.4 * k + lift}mm;width:${mm(34)};text-align:right;font-size:${pt(6)};letter-spacing:.04em;color:${PAL.muted};text-transform:uppercase;">Scan to verify<br>membership</div>`;
        }
        // Brand rule (engine, verbatim): the badge carries ONLY the real Med&X logo image — no typed fallback.
        const logoTag = logoSrc ? `<img src="${logoSrc}" style="position:absolute;right:${mm(4)};top:${mm(3.6)};height:${mm(5.4)};width:auto;" alt="">` : '';
        const strip = stripH ? `
        <div style="position:absolute;left:-${BLEED}mm;right:-${BLEED}mm;bottom:-${BLEED}mm;height:${stripH + BLEED}mm;background:#fff;border-top:0.2mm solid ${PAL.line};display:flex;align-items:center;justify-content:center;gap:${mm(4)};padding:0 ${mm(6)} ${BLEED}mm;box-sizing:border-box;">
            ${sponsors.map(s => `<img src="${s}" style="height:${Math.round(stripH * 0.52 * 10) / 10}mm;max-width:${mm(22)};object-fit:contain;" alt="">`).join('')}
        </div>` : '';
        return `
        <div style="position:absolute;inset:-${BLEED}mm;background:${PAL.cream};"></div>
        <div style="position:absolute;left:-${BLEED}mm;top:-${BLEED}mm;bottom:-${BLEED}mm;width:${6 * k + BLEED}mm;background:${role.band};"></div>
        <div style="position:absolute;left:${mm(9)};top:${mm(3.6)};font-size:${pt(7)};letter-spacing:.16em;text-transform:uppercase;color:${PAL.muted};max-width:${mm(56)};overflow:hidden;white-space:nowrap;">${evName}</div>
        ${logoTag}
        <div class="ps-serif" style="position:absolute;left:${mm(9)};top:${mm(16)};right:${mm(4)};font-size:${pt(nameSize)};font-weight:700;line-height:1.05;color:${PAL.ink};">${nm || '&nbsp;'}</div>
        ${inst ? `<div style="position:absolute;left:${mm(9)};top:${mm(30)};right:${mm(22)};font-size:${pt(8.5)};color:${PAL.muted};line-height:1.25;">${inst}</div>` : ''}
        <div style="position:absolute;left:${mm(9)};bottom:${4.5 * k + lift}mm;display:inline-block;background:${role.chipBg};color:${role.chipInk};font-size:${pt(7.5)};font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:${mm(1.4)} ${mm(3)};border-radius:1mm;">${esc(role.label)}</div>
        ${qrHtml}${strip}`;
    }
    function blankBadge(facts, logoSrc, W, H) {
        const k = Math.min(W / 90, H / 55);
        const mm = v => (Math.round(v * k * 100) / 100) + 'mm';
        const pt = v => (Math.round(v * k * 10) / 10) + 'pt';
        const evName = esc(facts.name || '');
        return `
        <div style="position:absolute;inset:-${BLEED}mm;background:${PAL.cream};"></div>
        <div style="position:absolute;left:-${BLEED}mm;top:-${BLEED}mm;bottom:-${BLEED}mm;width:${6 * k + BLEED}mm;background:${PAL.navy};"></div>
        <div style="position:absolute;left:${mm(9)};top:${mm(3.6)};font-size:${pt(7)};letter-spacing:.16em;text-transform:uppercase;color:${PAL.muted};">${evName}</div>
        ${logoSrc ? `<img src="${logoSrc}" style="position:absolute;right:${mm(4)};top:${mm(3.6)};height:${mm(5.4)};" alt="">` : ''}
        <div style="position:absolute;left:${mm(9)};right:${mm(6)};top:${mm(26)};border-bottom:0.3mm solid ${PAL.muted};"></div>
        <div style="position:absolute;left:${mm(9)};top:${mm(27)};font-size:${pt(6.5)};letter-spacing:.1em;text-transform:uppercase;color:${PAL.muted};">Name</div>
        <div style="position:absolute;left:${mm(9)};bottom:${mm(4.5)};font-size:${pt(7)};letter-spacing:.1em;text-transform:uppercase;color:${PAL.muted};">medx.hr</div>`;
    }
    function cropMarks() {
        const L = 4, off = BLEED, t = '0.2mm solid #000';
        const v = (css) => `<div style="position:absolute;width:0;height:${L}mm;border-left:${t};${css}"></div>`;
        const h = (css) => `<div style="position:absolute;height:0;width:${L}mm;border-top:${t};${css}"></div>`;
        return v(`left:0;top:-${off + L}mm`) + h(`top:0;left:-${off + L}mm`) +
            v(`right:0;top:-${off + L}mm`) + h(`top:0;right:-${off + L}mm`) +
            v(`left:0;bottom:-${off + L}mm`) + h(`bottom:0;left:-${off + L}mm`) +
            v(`right:0;bottom:-${off + L}mm`) + h(`bottom:0;right:-${off + L}mm`);
    }
    // imposition on A4 portrait — as many badges of the configured trim as fit (STD → the engine's 2×4)
    function badgeSheetPages(cells, W, H) {
        // 7mm outer minimum = the crop marks' reach (BLEED 3 + 4mm ticks); at STD 90×55 this yields
        // the legacy engine's exact 2×4 imposition with its 8mm side margins.
        const A4W = 210, A4H = 297, gut = 14, minM = 7;
        const cols = Math.max(1, Math.floor((A4W - 2 * minM + gut) / (W + gut)));
        const rows = Math.max(1, Math.floor((A4H - 2 * minM + gut) / (H + gut)));
        const perPage = cols * rows;
        const gridW = cols * W + (cols - 1) * gut, gridH = rows * H + (rows - 1) * gut;
        const mL = (A4W - gridW) / 2, mT = (A4H - gridH) / 2;
        const pages = [];
        for (let i = 0; i < cells.length; i += perPage) {
            const slice = cells.slice(i, i + perPage);
            let inner = '';
            slice.forEach((cell, j) => {
                const c = j % cols, r = Math.floor(j / cols);
                const x = mL + c * (W + gut), y = mT + r * (H + gut);
                inner += `<div style="position:absolute;left:${x}mm;top:${y}mm;width:${W}mm;height:${H}mm;">${cell}${cropMarks()}</div>`;
            });
            pages.push(`<div class="ps-page">${inner}</div>`);
        }
        return { pages, pageW: A4W, pageH: A4H, perPage, cols, rows };
    }
    function doc(pageWmm, pageHmm, bodyPages) {
        return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${pageWmm}mm ${pageHmm}mm; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; font-family: 'Helvetica Neue', Arial, sans-serif; color: ${PAL.ink}; }
.ps-serif { font-family: Georgia, 'Times New Roman', serif; }
.ps-page { position: relative; width: ${pageWmm}mm; height: ${pageHmm}mm; overflow: hidden; page-break-after: always; background: #fff; }
.ps-page:last-child { page-break-after: auto; }
</style></head><body>${bodyPages}</body></html>`;
    }

    function badgeTrim() {
        const s = readSettings().badges;
        if (s.size === 'custom') return { w: clampNum(s.w_mm, 90, 60, 190), h: clampNum(s.h_mm, 55, 40, 130), label: `${s.w_mm}×${s.h_mm}` };
        const t = BADGE_SIZES[s.size] || BADGE_SIZES.std;
        return { w: t.w, h: t.h, label: s.size === 'std' ? '90×55' : s.size.toUpperCase() };
    }
    function buildBadgeSheet(req, eventKey, opts) {
        const settings = readSettings().badges;
        const trim = badgeTrim();
        const facts = eventFacts(eventKey);
        const logo = brandLogoSrc();
        const sponsors = settings.sponsor_strip ? sponsorStripSrcs() : [];
        let people = eventPeople(eventKey, !!opts.staff);
        if (opts.limit) people = people.slice(0, opts.limit);
        people.forEach(p => {
            const u = memberQrUrl(req, p.user_id, p.email);
            if (u) { try { p._qrSvg = qrSvg(u); } catch (e) { p._qrSvg = null; } }
        });
        const cells = people.map(p => badgeFace(p, facts, logo, trim.w, trim.h, sponsors));
        const blanks = Math.max(0, Math.min(200, parseInt(opts.blanks, 10) || 0));
        for (let i = 0; i < blanks; i++) cells.push(blankBadge(facts, logo, trim.w, trim.h));
        while (cells.length < (opts.minCells || 1)) cells.push(blankBadge(facts, logo, trim.w, trim.h));
        const built = badgeSheetPages(cells, trim.w, trim.h);
        return { built, trim, facts, count: cells.length, sponsors: sponsors.length, settings };
    }

    app.post('/api/v2/studio/badges/preview', auth, adminOnly, (req, res) => {
        try {
            const b = req.body || {};
            const out = buildBadgeSheet(req, b.event, { staff: !!b.staff, limit: 8, minCells: 4 });
            res.json({
                html: doc(out.built.pageW, out.built.pageH, out.built.pages.join('')),
                pageW: out.built.pageW, pageH: out.built.pageH,
                trim: out.trim, per_page: out.built.perPage, sponsor_logos: out.sponsors
            });
        } catch (e) { console.error('[v2/studio] badges preview:', e.message); res.status(500).json({ error: 'Could not build the badge preview.' }); }
    });

    // -- headless-Chrome locator + PDF render (mirrors psChromeBinary / psRenderPdf) --
    let _chromeChecked = false, _chromePath = null;
    function chromeBinary() {
        if (_chromeChecked) return _chromePath;
        _chromeChecked = true;
        const cands = [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
            '/snap/bin/chromium'].filter(Boolean);
        for (const c of cands) { try { if (fs.existsSync(c)) { _chromePath = c; return _chromePath; } } catch (e) {} }
        const dirs = String(process.env.PATH || '').split(':');
        for (const n of ['google-chrome', 'chromium', 'chromium-browser', 'chrome']) {
            for (const d of dirs) { try { const p = path.join(d, n); if (d && fs.existsSync(p)) { _chromePath = p; return _chromePath; } } catch (e) {} }
        }
        return _chromePath;
    }
    function renderPdf(html, outPath) {
        return new Promise((resolve, reject) => {
            const chrome = chromeBinary();
            if (!chrome) return reject(new Error('print_engine_unavailable'));
            const os = require('os');
            const tmpHtml = outPath.replace(/\.pdf$/i, '') + '.src.html';
            const udd = path.join(os.tmpdir(), 'ps-chrome-' + crypto.randomUUID());
            try { fs.unlinkSync(outPath); } catch (e) { /* nothing to remove */ }
            try { fs.writeFileSync(tmpHtml, html); } catch (e) { return reject(e); }
            const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
                '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
                '--no-pdf-header-footer', '--print-to-pdf-no-header', '--run-all-compositor-stages-before-draw',
                '--virtual-time-budget=15000', '--hide-scrollbars', '--force-color-profile=srgb',
                '--user-data-dir=' + udd, '--print-to-pdf=' + outPath, 'file://' + tmpHtml];
            const child = require('child_process').spawn(chrome, args, { stdio: 'ignore' });
            let done = false, lastSize = -1, stable = 0;
            const cleanup = () => { try { fs.unlinkSync(tmpHtml); } catch (e) {} try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {} };
            const finish = (err) => {
                if (done) return; done = true;
                clearInterval(poll); clearTimeout(hard);
                try { child.kill('SIGKILL'); } catch (e) {}
                cleanup();
                let ok = false; try { ok = fs.existsSync(outPath) && fs.statSync(outPath).size > 0; } catch (e) {}
                if (!ok) return reject(err || new Error('pdf_not_written'));
                try {
                    const buf = fs.readFileSync(outPath);
                    let bad = null;
                    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') bad = 'output is not a PDF';
                    else if (buf.length < 5 * 1024) bad = 'output PDF is implausibly small (' + buf.length + ' bytes)';
                    else if (buf.length < 1024 * 1024 && buf.includes('ERR_')) bad = 'output PDF contains a Chrome error page (ERR_)';
                    if (bad) { try { fs.unlinkSync(outPath); } catch (e2) {} return reject(new Error('pdf_render_invalid: ' + bad)); }
                } catch (e3) { return reject(e3); }
                resolve(outPath);
            };
            const poll = setInterval(() => {
                try { if (fs.existsSync(outPath)) { const s = fs.statSync(outPath).size; if (s > 0 && s === lastSize) { stable++; if (stable >= 2) return finish(); } else { stable = 0; } lastSize = s; } } catch (e) {}
            }, 350);
            child.on('error', (e) => finish(e));
            child.on('exit', () => { setTimeout(() => finish(), 250); });
            const hard = setTimeout(() => finish(new Error('render_timeout')), 60000);
        });
    }

    app.post('/api/v2/studio/badges/render', auth, adminOnly, async (req, res) => {
        try {
            if (!chromeBinary()) return res.status(503).json({ error: 'print_engine_unavailable', message: 'The print engine (headless Chrome) is not available on this server. Set CHROME_PATH to a Chrome/Chromium binary to enable print-ready PDF export.' });
            const b = req.body || {};
            const eventKey = String(b.event || 'conference');
            const out = buildBadgeSheet(req, eventKey, { staff: !!b.staff, blanks: b.blanks, minCells: 1 });
            const html = doc(out.built.pageW, out.built.pageH, out.built.pages.join(''));
            const id = crypto.randomUUID();
            const dir = path.join(ROOT, 'admin-portal', 'backend', 'uploads', 'content-studio');
            try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
            const pdfPath = path.join(dir, 'ps-' + id + '.pdf');
            try { await renderPdf(html, pdfPath); }
            catch (e) { return res.status(500).json({ error: 'render_failed', message: 'Could not render the PDF: ' + e.message }); }
            const bytes = fs.statSync(pdfPath).size;
            const base = (() => { try { return `${req.protocol}://${req.get('host')}`; } catch (e) { return ''; } })();
            const url = `${base}/uploads/content-studio/ps-${id}.pdf`;
            const aspect = `${out.trim.w}x${out.trim.h}`;
            // same "recent creations" gallery row the legacy engine writes (psSaveAsset contract)
            try {
                run(`INSERT INTO content_studio_assets (id, kind, template, aspect, project, title, caption, asset_url, mime, bytes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
                    [id, 'print', 'badges-sheet', String(aspect).slice(0, 16), eventKey, (out.facts.name + ' badges (' + out.count + ') · ' + out.trim.label + ' mm').slice(0, 200), '', url, 'application/pdf', bytes, (req.user && req.user.id) || null]);
                saveDb();
            } catch (e) { /* gallery row is a nicety — the PDF stands */ }
            audit(req, 'print.render', `v2 badges/${eventKey} ${aspect}mm ${out.built.pages.length}p (${out.count} badge${out.count === 1 ? '' : 's'}${out.sponsors ? ', sponsor strip' : ''})`);
            res.json({ success: true, id, url, bytes, pages: out.built.pages.length, pageW: out.built.pageW, pageH: out.built.pageH, trim: out.trim, warnings: [] });
        } catch (e) { console.error('[v2/studio] badges render:', e.message); res.status(500).json({ error: 'render_failed', message: e.message }); }
    });

    log('studio: photo library + settings + settings-aware certificates/badges + attendance-card window ready');
};
