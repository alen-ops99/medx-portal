/**
 * v2/profile.js — Profile & Settings for the redesigned member portal
 * (frontend-v2/js/views/profile.js · artboard Profile.dc.html). Mounted by v2/index.js.
 *
 * Routes (all member JWT — `ctx.auth`; a member can only ever read/write their OWN row):
 *   GET    /api/v2/profile                      everything the screen needs, incl. `email_verified`
 *                                               and the completion block → { profile, completion }
 *   PATCH  /api/v2/profile                      save (whitelisted, validated, sanitised) → { success, profile, completion }
 *   POST   /api/v2/profile/photo                multipart field `photo` (or `file`) · jpg/png/webp · ≤ 5 MB
 *                                               → uploads/profile/<userId>.<ext> + users.photo_url → { success, photo_url, profile, completion }
 *   DELETE /api/v2/profile/photo                remove the portrait → { success, profile, completion }
 *   GET    /api/v2/profile/completion           { percent, items:[{key,label,done,weight}], complete } — the ONE
 *                                               source of truth for the Home nudge and the Profile checklist
 *   POST   /api/v2/profile/completion/preview   the same formula over an unsaved draft (body = PATCH body); never writes
 *
 * Completion formula (weights sum to 100; `percent` = sum of the weights of the items that are done):
 *   name 10 (first + last) · institution 10 · photo 20 · specialty 15 (≥ 1 tag) · bio 15 (≥ 60 characters) ·
 *   title 10 · country 10 · email 5 (users.email_verified = 1) · directory 5 (the member saved the account
 *   preferences at least once — users.profile_saved_at — i.e. made a directory-visibility decision).
 *
 * Schema (ALTER TABLE … ADD COLUMN in try/catch at load — both portals share ONE database, nothing is renamed
 * or dropped; the legacy routes keep working because their columns keep being written):
 *   users.title TEXT · users.city TEXT · users.specialties TEXT (JSON array of strings) ·
 *   users.updates_opt_in INTEGER DEFAULT 1 · users.profile_saved_at TEXT
 *   Mirrors kept for legacy readers: user_profiles.title / user_profiles.is_profile_public (Plexus attendee
 *   directory, member search) are upserted from the same save.
 *
 * Storage: local disk under user-portal/backend/uploads/profile/ (served by the existing /uploads static route).
 * When CLOUDINARY_URL is set the file is pushed to Cloudinary (folder medx/profile, public_id = user id) and the
 * secure URL is stored instead — on production without CLOUDINARY_URL the server-wide multipart gate in server.js
 * already answers 503 (ephemeral disk), so nothing here can silently lose a portrait.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'profile');
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LIMITS = { name: 80, title: 120, institution: 160, city: 80, country: 80, bio: 1000, tag: 40, tags: 12 };
const LOCALES = ['en', 'hr'];

// ---------------------------------------------------------------- helpers
function clean(v, max) {
    if (v === undefined || v === null) return null;
    const s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
}
function cleanBio(v, max) {
    if (v === undefined || v === null) return null;
    const s = String(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
}
function parseSpecialties(text) {
    if (Array.isArray(text)) return text;
    if (!text) return [];
    try { const a = JSON.parse(text); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()) : []; } catch (e) { return []; }
}
// tags are stored as UPPERCASE strings (the chips are uppercase micro-labels), deduped case-insensitively
function normaliseSpecialties(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const raw of list) {
        if (typeof raw !== 'string') continue;
        const t = clean(raw, LIMITS.tag);
        if (!t) continue;
        const up = t.toUpperCase();
        if (!out.includes(up)) out.push(up);
        if (out.length >= LIMITS.tags) break;
    }
    return out;
}
const bool = v => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') ? 1 : 0;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const safeId = id => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');

// ---------------------------------------------------------------- completion (the formula)
const ITEMS = [
    { key: 'name',        label: 'Name added',            weight: 10, done: r => !!(clean(r.first_name, 80) && clean(r.last_name, 80)) },
    { key: 'institution', label: 'Institution added',     weight: 10, done: r => !!clean(r.institution, 160) },
    { key: 'photo',       label: 'Portrait uploaded',     weight: 20, done: r => !!clean(r.photo_url, 2000) },
    { key: 'specialty',   label: 'Specialty selected',    weight: 15, done: r => parseSpecialties(r.specialties).length > 0 },
    { key: 'bio',         label: 'Short bio written',     weight: 15, done: r => (cleanBio(r.bio, 100000) || '').length >= 60, hint: 'At least 60 characters' },
    { key: 'title',       label: 'Title or role added',   weight: 10, done: r => !!clean(r.title, 120) },
    { key: 'country',     label: 'Country added',         weight: 10, done: r => !!clean(r.country, 80) },
    { key: 'email',       label: 'Email confirmed',       weight: 5,  done: r => Number(r.email_verified) === 1 },
    { key: 'directory',   label: 'Directory choice made', weight: 5,  done: r => !!r.profile_saved_at }
];
function completionFor(row) {
    const r = row || {};
    const items = ITEMS.map(i => { const d = !!i.done(r); return { key: i.key, label: i.label, weight: i.weight, done: d, hint: i.hint || null }; });
    const percent = items.reduce((n, i) => n + (i.done ? i.weight : 0), 0);
    const done = items.filter(i => i.done).length;
    return { percent, items, done, total: items.length, complete: percent >= 100, email_verified: Number(r.email_verified) === 1 };
}

module.exports = function mountProfile(app, ctx) {
    const { auth, log } = ctx;
    const db = () => ctx.db();
    const get = (sql, params = []) => { const st = db().prepare(sql); if (params.length) st.bind(params); let r = null; if (st.step()) r = st.getAsObject(); st.free(); return r; };
    const run = (sql, params = []) => db().run(sql, params);
    let syncTimer = null;
    // libsql persists locally at once; on Turso-backed deploys push the change like server.js › saveDb() does
    const persist = () => { try { if (process.env.TURSO_DATABASE_URL) { clearTimeout(syncTimer); syncTimer = setTimeout(() => { try { db().sync(); } catch (e) {} }, 2000); } } catch (e) {} };

    // ---- schema (idempotent) ----
    [
        'ALTER TABLE users ADD COLUMN title TEXT',
        'ALTER TABLE users ADD COLUMN city TEXT',
        'ALTER TABLE users ADD COLUMN specialties TEXT',
        'ALTER TABLE users ADD COLUMN updates_opt_in INTEGER DEFAULT 1',
        'ALTER TABLE users ADD COLUMN profile_saved_at TEXT'
    ].forEach(sql => { try { run(sql); } catch (e) { /* column already exists */ } });
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { log('profile: cannot create ' + UPLOAD_DIR + ': ' + e.message); }

    // ---- data access ----
    const COLS = 'id, email, email_verified, first_name, last_name, title, institution, city, country, bio, photo_url, specialties, is_public_profile, updates_opt_in, locale, profile_saved_at, created_at, is_admin';
    function loadRow(userId) {
        if (!userId) return null;
        try { return get(`SELECT ${COLS} FROM users WHERE id = ? AND deleted_at IS NULL`, [userId]); } catch (e) { return get(`SELECT ${COLS} FROM users WHERE id = ?`, [userId]); }
    }
    function shape(r) {
        return {
            id: r.id, email: r.email, email_verified: Number(r.email_verified) === 1 ? 1 : 0,
            first_name: r.first_name || '', last_name: r.last_name || '', title: r.title || '',
            institution: r.institution || '', city: r.city || '', country: r.country || '', bio: r.bio || '',
            photo_url: r.photo_url || null, specialties: parseSpecialties(r.specialties),
            is_public_profile: Number(r.is_public_profile) === 1,
            updates_opt_in: r.updates_opt_in === null || r.updates_opt_in === undefined ? true : Number(r.updates_opt_in) === 1,
            locale: LOCALES.includes(r.locale) ? r.locale : 'en',
            member_since: r.created_at ? String(r.created_at).slice(0, 4) : null,
            created_at: r.created_at || null,
            is_admin: Number(r.is_admin) === 1,
            profile_saved_at: r.profile_saved_at || null
        };
    }
    const payload = r => ({ profile: shape(r), completion: completionFor(r) });
    const fail = (res, e, what) => { console.error('[v2/profile] ' + what + ':', e); res.status(500).json({ error: 'Could not ' + what + ' — please try again.' }); };
    function requireRow(req, res) {
        const id = req.user && req.user.id;
        const row = id ? loadRow(id) : null;
        if (!row) { res.status(404).json({ error: 'No member profile is attached to this session — sign in again.' }); return null; }
        return row;
    }

    // ---- validation of a PATCH / preview body → { patch, errors } (only whitelisted keys, never email / is_admin) ----
    function validate(body) {
        const b = body && typeof body === 'object' ? body : {};
        const patch = {}; const errors = [];
        if (has(b, 'first_name')) { const v = clean(b.first_name, LIMITS.name); if (!v) errors.push('Add your first name.'); else patch.first_name = v; }
        if (has(b, 'last_name'))  { const v = clean(b.last_name, LIMITS.name);  if (!v) errors.push('Add your last name.');  else patch.last_name = v; }
        if (has(b, 'title'))       patch.title = clean(b.title, LIMITS.title);
        if (has(b, 'institution')) patch.institution = clean(b.institution, LIMITS.institution);
        if (has(b, 'city'))        patch.city = clean(b.city, LIMITS.city);
        if (has(b, 'country'))     patch.country = clean(b.country, LIMITS.country);
        if (has(b, 'bio')) {
            if (b.bio !== null && b.bio !== undefined && String(b.bio).length > LIMITS.bio) errors.push(`Keep the bio under ${LIMITS.bio} characters.`);
            else patch.bio = cleanBio(b.bio, LIMITS.bio);
        }
        if (has(b, 'specialties')) {
            if (b.specialties === null) patch.specialties = [];
            else if (!Array.isArray(b.specialties)) errors.push('Specialties must be a list of tags.');
            else patch.specialties = normaliseSpecialties(b.specialties);
        }
        if (has(b, 'is_public_profile')) patch.is_public_profile = bool(b.is_public_profile);
        if (has(b, 'updates_opt_in'))    patch.updates_opt_in = bool(b.updates_opt_in);
        if (has(b, 'locale')) { if (!LOCALES.includes(b.locale)) errors.push('Unsupported language.'); else patch.locale = b.locale; }
        return { patch, errors };
    }
    // merge a patch over a row (for previews and for the response after save)
    function merged(row, patch) {
        const r = Object.assign({}, row);
        Object.keys(patch).forEach(k => { r[k] = k === 'specialties' ? JSON.stringify(patch[k]) : patch[k]; });
        return r;
    }

    // ================================================================ GET /api/v2/profile
    app.get('/api/v2/profile', auth, (req, res) => {
        try {
            const row = requireRow(req, res); if (!row) return;
            res.json(payload(row));
        } catch (e) { fail(res, e, 'load your profile'); }
    });

    // ================================================================ GET /api/v2/profile/completion
    app.get('/api/v2/profile/completion', auth, (req, res) => {
        try {
            const row = loadRow(req.user && req.user.id);
            res.json(completionFor(row || {}));
        } catch (e) { fail(res, e, 'compute your profile completion'); }
    });

    // ================================================================ POST /api/v2/profile/completion/preview (dry run)
    app.post('/api/v2/profile/completion/preview', auth, (req, res) => {
        try {
            const row = requireRow(req, res); if (!row) return;
            const { patch } = validate(req.body);          // invalid values simply fall out of the preview
            res.json(completionFor(merged(row, patch)));
        } catch (e) { fail(res, e, 'compute your profile completion'); }
    });

    // ================================================================ PATCH /api/v2/profile
    app.patch('/api/v2/profile', auth, (req, res) => {
        try {
            const row = requireRow(req, res); if (!row) return;
            const { patch, errors } = validate(req.body);
            if (errors.length) return res.status(400).json({ error: errors[0], errors });
            const now = new Date().toISOString();
            const sets = []; const vals = [];
            Object.keys(patch).forEach(k => { sets.push(`${k} = ?`); vals.push(k === 'specialties' ? JSON.stringify(patch[k]) : patch[k]); });
            // any save = the member has looked at the account preferences → the directory decision is made
            sets.push('profile_saved_at = ?'); vals.push(now);
            vals.push(row.id);
            run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
            // legacy mirrors (Plexus attendee directory reads user_profiles.title / is_profile_public)
            if (has(patch, 'title') || has(patch, 'is_public_profile')) {
                try {
                    const fresh = loadRow(row.id) || row;
                    const exists = get('SELECT user_id FROM user_profiles WHERE user_id = ?', [row.id]);
                    if (exists) run('UPDATE user_profiles SET title = ?, is_profile_public = ? WHERE user_id = ?', [fresh.title || null, Number(fresh.is_public_profile) === 1 ? 1 : 0, row.id]);
                    else run('INSERT INTO user_profiles (user_id, title, is_profile_public) VALUES (?, ?, ?)', [row.id, fresh.title || null, Number(fresh.is_public_profile) === 1 ? 1 : 0]);
                } catch (e) { log('profile: user_profiles mirror skipped: ' + e.message); }
            }
            // profile-completion points, exactly like PUT /api/auth/profile (only when server.js hands awardPoints in ctx)
            try {
                const fresh = loadRow(row.id) || row;
                if (typeof ctx.awardPoints === 'function' && fresh.first_name && fresh.last_name && fresh.institution && fresh.country) {
                    const pts = typeof ctx.rewardsSettingNum === 'function' ? ctx.rewardsSettingNum('earn_profile', 50) : 50;
                    ctx.awardPoints(row.id, pts, 'profile', 'profile:' + row.id, 'Profile completed');
                }
            } catch (e) { /* never block a save on the rewards ledger */ }
            persist();
            res.json(Object.assign({ success: true }, payload(loadRow(row.id) || row)));
        } catch (e) { fail(res, e, 'save your profile'); }
    });

    // ================================================================ POST /api/v2/profile/photo (multipart)
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, `${safeId(req.user.id)}.${MIME_EXT[file.mimetype]}`)
    });
    const upload = multer({
        storage,
        limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
        fileFilter: (req, file, cb) => (MIME_EXT[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Use a JPG, PNG or WebP image.'), { code: 'BAD_TYPE' })))
    });
    // multer trusts the client MIME — check the magic bytes of what was actually written
    function sniff(filePath) {
        try {
            const fd = fs.openSync(filePath, 'r'); const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
            if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
            if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
            if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
        } catch (e) {}
        return null;
    }
    function removeLocalPhotos(userId, keep) {
        Object.values(MIME_EXT).forEach(ext => {
            const f = path.join(UPLOAD_DIR, `${safeId(userId)}.${ext}`);
            if (f !== keep) { try { fs.unlinkSync(f); } catch (e) {} }
        });
    }
    async function toCloud(filePath, userId) {
        if (!process.env.CLOUDINARY_URL) return null;
        try {
            const cloudinary = require('cloudinary').v2;
            const r = await cloudinary.uploader.upload(filePath, { folder: 'medx/profile', public_id: safeId(userId), overwrite: true, invalidate: true, resource_type: 'image' });
            return r && r.secure_url ? r.secure_url : null;
        } catch (e) { log('profile: Cloudinary upload failed, keeping local file: ' + e.message); return null; }
    }
    app.post('/api/v2/profile/photo', auth, (req, res, next) => {
        const row = requireRow(req, res); if (!row) return;
        req.v2Row = row;
        // field `photo` (the view) or `file` (the legacy upload convention) — one file either way
        upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, err => {
            if (!err && req.files) req.file = (req.files.photo && req.files.photo[0]) || (req.files.file && req.files.file[0]) || null;
            next(err);
        });
    }, (err, req, res, next) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That image is larger than 5 MB — pick a smaller one.' });
        if (err.code === 'BAD_TYPE') return res.status(400).json({ error: err.message });
        return res.status(400).json({ error: err.message || 'Upload failed.' });
    }, async (req, res) => {
        try {
            const row = req.v2Row;
            if (!req.file) return res.status(400).json({ error: 'Choose an image first.' });
            const ext = MIME_EXT[req.file.mimetype];
            const kind = sniff(req.file.path);
            if (!kind || kind !== ext) { try { fs.unlinkSync(req.file.path); } catch (e) {} return res.status(400).json({ error: 'That file is not a JPG, PNG or WebP image.' }); }
            removeLocalPhotos(row.id, req.file.path);
            let url = await toCloud(req.file.path, row.id);
            if (url) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
            else url = `/uploads/profile/${path.basename(req.file.path)}?v=${Date.now()}`;   // cache-buster: same name on replace
            run('UPDATE users SET photo_url = ? WHERE id = ?', [url, row.id]);
            persist();
            const fresh = loadRow(row.id) || row;
            res.json(Object.assign({ success: true, photo_url: url }, payload(fresh)));
        } catch (e) { fail(res, e, 'save your photo'); }
    });

    // ================================================================ DELETE /api/v2/profile/photo
    app.delete('/api/v2/profile/photo', auth, async (req, res) => {
        try {
            const row = requireRow(req, res); if (!row) return;
            removeLocalPhotos(row.id, null);
            if (process.env.CLOUDINARY_URL && row.photo_url && /res\.cloudinary\.com/.test(row.photo_url)) {
                try { await require('cloudinary').v2.uploader.destroy('medx/profile/' + safeId(row.id), { invalidate: true }); } catch (e) {}
            }
            run('UPDATE users SET photo_url = NULL WHERE id = ?', [row.id]);
            persist();
            res.json(Object.assign({ success: true }, payload(loadRow(row.id) || row)));
        } catch (e) { fail(res, e, 'remove your photo'); }
    });

    log('profile: /api/v2/profile · /photo · /completion(/preview) mounted; uploads → ' + UPLOAD_DIR);
};
module.exports.completionFor = completionFor;
module.exports.ITEMS = ITEMS;
