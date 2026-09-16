/**
 * v2/plexus-program-ops.js — the organizer's door to "Your Plexus Week 2026 program & ticket"
 * (user-portal/backend/plexus-program.js). Mirrors v2/boston-ops.js: every route here proxies to
 * the member portal's key-gated team routes, so the sending logic, the marker and the program
 * PDF live in ONE place — the member backend that also holds the rows — and this admin (or any
 * admin live in November) only presses the buttons.
 *
 *   GET  /api/v2/plexus-program                 status · settings · counts · rows
 *   POST /api/v2/plexus-program/program         multipart PDF → member → S3
 *   PUT  /api/v2/plexus-program/settings        { conference_venue, conference_start_date,
 *                                                 bridges_zagreb_date, bridges_zagreb_time, bridges_zagreb_venue }
 *   POST /api/v2/plexus-program/send            { to:'preview'|'all'|'<ca id>', variant? }
 *
 * The member key is the same HMAC both portals can derive from the shared JWT_SECRET
 * ('plexus-admin'); it is never logged and never reaches the browser. Section: 'plexus'.
 */
'use strict';

const crypto = require('crypto');
function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
const multerLib = tryRequire('multer');
const MAX_PROGRAM_BYTES = 10 * 1024 * 1024;

module.exports = function mountPlexusProgramOps(app, ctx) {
    const { db, auth, adminOnly } = ctx;
    const JWT_SECRET = ctx.JWT_SECRET || process.env.JWT_SECRET || 'medx-dev-secret';
    const log = ctx.log || ((...a) => console.log('[v2/plexus-program-ops]', ...a));

    function audit(req, action, detail) {
        try {
            db().run('INSERT INTO audit_log (id, actor_id, actor_email, action, detail, created_at) VALUES (?,?,?,?,?,?)',
                [crypto.randomUUID(), (req && req.user && req.user.id) || null, (req && req.user && req.user.email) || 'system',
                 action, String(detail || '').slice(0, 500), new Date().toISOString()]);
        } catch (e) { /* best-effort */ }
    }
    function memberBase() {
        if (process.env.USER_PORTAL_URL) return String(process.env.USER_PORTAL_URL).replace(/\/+$/, '');
        if (process.env.NODE_ENV === 'production' || process.env.RENDER) return 'https://medx-user-portal.onrender.com';
        return 'http://localhost:3010';
    }
    const adminKey = () => crypto.createHmac('sha256', String(JWT_SECRET)).update('plexus-admin').digest('hex').slice(0, 40);
    const keyed = (path) => memberBase() + path + (path.includes('?') ? '&' : '?') + 'key=' + adminKey();
    async function memberCall(method, path, body, raw) {
        const init = { method, headers: { Accept: 'application/json' } };
        if (raw) { init.headers['Content-Type'] = raw.contentType; init.body = raw.body; }
        else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
        const res = await fetch(keyed(path), init);
        const text = await res.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; } }
        if (!res.ok) { const err = new Error((data && (data.error || data.message)) || ('The member portal answered ' + res.status + '.')); err.status = res.status; err.data = data; throw err; }
        return data || {};
    }
    function multipartFile(filename, buf, mime) {
        const boundary = '----medx' + crypto.randomBytes(16).toString('hex');
        const safe = String(filename || 'file.pdf').replace(/[""\\\r\n]/g, '_');
        const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safe}"\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`, 'utf8');
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        return { body: Buffer.concat([head, buf, tail]), contentType: 'multipart/form-data; boundary=' + boundary };
    }
    const programUpload = multerLib ? multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: MAX_PROGRAM_BYTES, files: 1 } }).single('file') : null;
    function programParser(req, res, next) {
        if (!programUpload) return res.status(503).json({ error: 'Uploads are momentarily unavailable on this server.' });
        programUpload(req, res, err => {
            if (!err) return next();
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is over the 10 MB limit.' });
            return res.status(400).json({ error: 'We could not read that upload.' });
        });
    }
    const relay = (e, res) => res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message || 'The member portal did not answer.' });

    app.get('/api/v2/plexus-program', auth, adminOnly, async (req, res) => {
        try {
            const d = await memberCall('GET', '/api/plexus/program');
            res.set('Cache-Control', 'private, no-store');
            res.json({ ...d, member_base: memberBase() });
        } catch (e) { log('status failed:', e.message); relay(e, res); }
    });

    app.post('/api/v2/plexus-program/program', auth, adminOnly, programParser, async (req, res) => {
        try {
            const f = req.file;
            if (!f || !f.buffer || !f.buffer.length) return res.status(400).json({ error: 'Choose the program PDF first.' });
            if (!/\.pdf$/i.test(String(f.originalname || ''))) return res.status(400).json({ error: 'PDF only, please.' });
            const out = await memberCall('POST', '/api/plexus/program', undefined, multipartFile(f.originalname || 'program.pdf', f.buffer, 'application/pdf'));
            audit(req, 'plexus.program_uploaded', (f.originalname || 'program.pdf') + ' · ' + f.buffer.length + ' bytes');
            res.json({ success: true, size: Number(out.size) || f.buffer.length, uploaded_at: out.uploaded_at || new Date().toISOString() });
        } catch (e) { log('program upload failed:', e.message); relay(e, res); }
    });

    app.put('/api/v2/plexus-program/settings', auth, adminOnly, async (req, res) => {
        try {
            const out = await memberCall('PUT', '/api/plexus/program/settings', req.body || {});
            audit(req, 'plexus.program_settings', JSON.stringify(req.body || {}).slice(0, 300));
            res.json(out);
        } catch (e) { log('settings failed:', e.message); relay(e, res); }
    });

    app.post('/api/v2/plexus-program/send', auth, adminOnly, async (req, res) => {
        try {
            const body = req.body || {};
            const to = String(body.to || '').trim();
            if (!to) return res.status(400).json({ error: 'Say who: "preview", "all", or a registration id.' });
            const out = await memberCall('POST', '/api/plexus/program/send', { to, variant: body.variant, to_email: to === 'preview' ? (req.user && req.user.email) || undefined : undefined });
            audit(req, to === 'preview' ? 'plexus.program_preview' : (to === 'all' ? 'plexus.program_send_all' : 'plexus.program_send_one'),
                to === 'preview' ? `variant=${body.variant || 'all'} → ${out.preview_to || ''}` : `sent ${Array.isArray(out.sent) ? out.sent.length : 0}${to !== 'all' ? ' · ' + to : ''}`);
            res.json(out);
        } catch (e) { log('send failed:', e.message); relay(e, res); }
    });

    log('plexus-program-ops: proxy to the member portal ready');
};
